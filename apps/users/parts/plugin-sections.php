<?php
/**
 * Users: the profile sections other plugins add, inside the native profile.
 *
 * `profile.php` and `user-edit.php` print whatever plugins hook onto
 * `show_user_profile` / `edit_user_profile` (sign-in security options,
 * author fields, …), plus rows on `personal_options` (inside
 * core's Personal Options table) and `profile_personal_options` (right
 * after it), and save all of it through the classic POST
 * that fires `personal_options_update` / `edit_user_profile_update`.
 * `<os-user-profile>` edits the core fields over REST, which runs none
 * of that, so those sections would simply not exist in the window.
 *
 * The element embeds the real screen instead (`wp.os.embedAdminPage()`)
 * with the flag below, and this file narrows that page to the plugin
 * sections with CSS: core's form stays whole (its nonce, hidden
 * fields and submit button), so a plugin's markup, its scripts keyed
 * on the screen, its own nonces and its save hook all run untouched.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/** The request flag that narrows the profile screen to plugin sections. */
const OPENSTATION_PROFILE_SECTIONS_FLAG = 'openstation_profile_sections';

/**
 * Which profile screens carry plugin sections, and where they live:
 * the facts `<os-user-profile>` reads to decide whether to embed.
 *
 * @return array{own: bool, others: bool, adminUrl: string}
 */
function openstation_users_profile_plugin_sections() {
	$rows = (bool) has_action( 'personal_options' );
	return array(
		'own'      => $rows || has_action( 'show_user_profile' ) || has_action( 'profile_personal_options' ),
		'others'   => $rows || has_action( 'edit_user_profile' ),
		'adminUrl' => admin_url(),
	);
}

/**
 * Whether this request is the narrowed profile screen. Read from
 * `$_REQUEST`: the form posts to its own URL without the query string,
 * so a save carries the flag as a hidden field.
 *
 * @return bool
 */
function openstation_is_profile_sections_request() {
	global $pagenow;
	if ( ! in_array( $pagenow, array( 'profile.php', 'user-edit.php' ), true ) || ! openstation_is_chromeless_request() ) {
		return false;
	}
	// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only display flag; the save itself is core's nonce-checked handler.
	return isset( $_REQUEST[ OPENSTATION_PROFILE_SECTIONS_FLAG ] ) && '1' === sanitize_text_field( wp_unslash( $_REQUEST[ OPENSTATION_PROFILE_SECTIONS_FLAG ] ) );
}

/**
 * Wire the narrowed screen. On `admin_init`, so the plugin hooks the
 * facts count are never inflated by this file's own marker.
 *
 * @return void
 */
function openstation_profile_sections_setup() {
	if ( ! openstation_is_profile_sections_request() ) {
		return;
	}
	// Rows inside core's own Personal Options table, and the block a
	// plugin prints right after it, are marked only when a plugin hooks
	// them: a lone marker would show an empty core table.
	if ( has_action( 'personal_options' ) ) {
		add_action( 'personal_options', 'openstation_profile_sections_rows_marker', PHP_INT_MIN );
	}
	if ( has_action( 'profile_personal_options' ) ) {
		add_action( 'profile_personal_options', 'openstation_profile_sections_block_start', PHP_INT_MIN );
		add_action( 'profile_personal_options', 'openstation_profile_sections_block_end', PHP_INT_MAX );
	}
	add_action( 'show_user_profile', 'openstation_profile_sections_marker', PHP_INT_MIN );
	add_action( 'edit_user_profile', 'openstation_profile_sections_marker', PHP_INT_MIN );
	add_action( 'openstation_chromeless_styles', 'openstation_profile_sections_styles' );
	add_action( 'admin_head', 'openstation_profile_sections_link_script' );
	add_filter( 'admin_body_class', 'openstation_profile_sections_body_class' );
}
add_action( 'admin_init', 'openstation_profile_sections_setup' );

/**
 * Where core's sections end and the plugins' begin, plus the flag the
 * save posts back so the page it lands on is narrowed too.
 *
 * @return void
 */
function openstation_profile_sections_marker() {
	printf(
		'<input type="hidden" name="%1$s" value="1" /><span id="os-profile-sections-start" hidden></span>',
		esc_attr( OPENSTATION_PROFILE_SECTIONS_FLAG )
	);
}

/**
 * Where plugin rows begin inside core's Personal Options table.
 *
 * @return void
 */
function openstation_profile_sections_rows_marker() {
	echo '<tr id="os-profile-rows-start" hidden></tr>';
}

/**
 * Where the `profile_personal_options` block begins.
 *
 * @return void
 */
function openstation_profile_sections_block_start() {
	echo '<span id="os-profile-block-start" hidden></span>';
}

/**
 * Where the `profile_personal_options` block ends.
 *
 * @return void
 */
function openstation_profile_sections_block_end() {
	echo '<span id="os-profile-block-end" hidden></span>';
}

/**
 * Hide the page heading and every child of the form that is not plugin
 * output: before the section marker, outside the `profile_personal_options`
 * block, and core's own rows of the Personal Options table.
 * Nothing is removed: hidden fields still post, notices still show.
 *
 * @return void
 */
function openstation_profile_sections_styles() {
	wp_add_inline_style(
		'os-chromeless',
		'body.os-profile-sections #profile-page > h1,'
		. 'body.os-profile-sections #profile-page > .page-title-action,'
		. 'body.os-profile-sections #profile-page > .wp-header-end,'
		. 'body.os-profile-sections #your-profile > :not( #os-profile-sections-start ~ * )'
		. ':not( #os-profile-block-start ~ :not( #os-profile-block-end ~ * ) )'
		. ':not( table:has( #os-profile-rows-start ) ):not( h2:has( + table #os-profile-rows-start ) ),'
		. 'body.os-profile-sections #your-profile table:has( #os-profile-rows-start ) tr:not( #os-profile-rows-start ~ tr ) { display: none !important; }'
	);
}

/**
 * Keep a plugin's links to this screen, or to `wp-login.php` for a
 * re-authentication that returns here, inside the embed. The chromeless
 * bridge hands every admin link to the shell, which would open the
 * profile as a window of its own; this listener runs first (on the
 * window, in the capture phase) and lets the browser follow the link.
 *
 * @return void
 */
function openstation_profile_sections_link_script() {
	wp_print_inline_script_tag(
		'window.addEventListener( "click", function ( e ) {'
		. 'if ( e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey ) { return; }'
		. 'var a = e.target && e.target.closest ? e.target.closest( "a[href]" ) : null;'
		. 'if ( ! a || ( a.target && a.target !== "_self" ) || a.hasAttribute( "download" ) ) { return; }'
		. 'var u; try { u = new URL( a.href, location.href ); } catch ( err ) { return; }'
		. 'if ( u.origin === location.origin && /\/(profile|user-edit|wp-login)\.php$/.test( u.pathname ) ) { e.stopImmediatePropagation(); }'
		. '}, true );'
	);
}

/**
 * Scope class for the styles above.
 *
 * @param string $classes Space-separated body classes.
 * @return string
 */
function openstation_profile_sections_body_class( $classes ) {
	return $classes . ' os-profile-sections';
}

/**
 * Keep the flag through the save's redirect back to the profile, so
 * the embed does not land on the whole screen after "Update Profile".
 *
 * @param string $location The redirect URL.
 * @return string
 */
function openstation_profile_sections_preserve_redirect( $location ) {
	if ( empty( $location ) || ! openstation_is_profile_sections_request() || ! openstation_is_admin_redirect_target( $location ) ) {
		return $location;
	}
	$path = (string) wp_parse_url( $location, PHP_URL_PATH );
	if ( ! preg_match( '#/(profile|user-edit)\.php$#', $path ) || false !== strpos( $location, OPENSTATION_PROFILE_SECTIONS_FLAG . '=' ) ) {
		return $location;
	}
	return add_query_arg( OPENSTATION_PROFILE_SECTIONS_FLAG, '1', $location );
}
add_filter( 'wp_redirect', 'openstation_profile_sections_preserve_redirect', 999 );
