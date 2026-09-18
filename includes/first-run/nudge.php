<?php
/**
 * OpenStation — the activation nudge.
 *
 * A dismissible admin notice on the Dashboard and Plugins screens,
 * for administrators, while nobody on the site has turned OpenStation
 * on and the install is young. The welcome dialog
 * (`includes/welcome-dialog.php`) is the first touch; this is the
 * second, quieter one for the same admin after they dismissed the
 * modal, and it lives where plugin admins actually look. Both stop
 * the moment anyone on the site enables.
 *
 * It is a Core admin notice and not a shell surface because, by
 * definition, the shell is not running for the people it targets.
 * Dismissal persists through the seen-intros registry (slug
 * `activation-nudge`) via the same REST route the welcome dialog
 * uses — Core's `is-dismissible` is client-only and would bring the
 * notice back on the next load.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/** Slug stored in `desktop_mode_seen_intros` when "Not now" is clicked. */
const OPENSTATION_ACTIVATION_NUDGE_INTRO_SLUG = 'activation-nudge';

/** The nudge stops on its own once the install is this old. */
const OPENSTATION_ACTIVATION_NUDGE_MAX_AGE_DAYS = 14;

/**
 * Screens the nudge may appear on: the Dashboard and Plugins, plus
 * their network-admin twins.
 *
 * @return string[]
 */
function openstation_activation_nudge_screens() {
	return array( 'dashboard', 'plugins', 'dashboard-network', 'plugins-network' );
}

/**
 * Decides whether the nudge renders on the current request.
 *
 * Every gate has to hold:
 *
 * 1. The user can `activate_plugins` — the nudge is addressed to the
 *    person who installed the plugin, not to every account.
 * 2. OpenStation is not enabled for this user.
 * 3. Nobody on the site has ever enabled it (`openstation_first_enabled_at`
 *    absent). The nudge is about an install that never activated; one
 *    enabled user is an activated install.
 * 4. The install stamp is real (`via: activation`) and under
 *    {@see OPENSTATION_ACTIVATION_NUDGE_MAX_AGE_DAYS} old. A backfilled
 *    stamp belongs to an old install, and old installs are not nagged.
 * 5. The screen is one of {@see openstation_activation_nudge_screens()}.
 * 6. The request is not chromeless (an iframe inside the shell).
 * 7. The user has not clicked "Not now".
 * 8. The `openstation_show_activation_nudge` filter agrees.
 *
 * @return bool
 */
function openstation_should_show_activation_nudge() {
	if ( ! is_user_logged_in() || ! current_user_can( 'activate_plugins' ) ) {
		return false;
	}
	if ( openstation_is_enabled() ) {
		return false;
	}
	if ( null !== openstation_get_first_enabled_stamp() ) {
		return false;
	}
	$age = openstation_install_age_days();
	if ( null === $age || $age >= OPENSTATION_ACTIVATION_NUDGE_MAX_AGE_DAYS ) {
		return false;
	}
	$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
	if ( ! $screen || ! in_array( $screen->id, openstation_activation_nudge_screens(), true ) ) {
		return false;
	}
	if ( openstation_is_chromeless_request() ) {
		return false;
	}
	$user_id = get_current_user_id();
	if ( openstation_has_seen_intro( $user_id, OPENSTATION_ACTIVATION_NUDGE_INTRO_SLUG ) ) {
		return false;
	}

	/**
	 * Filters whether the activation nudge renders for the current
	 * user on the current request. Every earlier gate (capability,
	 * site never enabled, install age, screen, seen-state) has already
	 * passed when this fires.
	 *
	 * @param bool $show    Whether to render the notice. Default true.
	 * @param int  $user_id Current user ID.
	 */
	return (bool) apply_filters( 'openstation_show_activation_nudge', true, $user_id );
}

/**
 * The notice's inner markup: one sentence and two actions.
 *
 * @return string HTML.
 */
function openstation_activation_nudge_markup() {
	$portal_url = openstation_portal_url();

	$message = sprintf(
		'<strong>%s</strong> %s',
		esc_html__( 'OpenStation is installed but not turned on.', 'desktop-mode' ),
		esc_html__( 'It changes wp-admin only for the people who turn it on.', 'desktop-mode' )
	);

	$actions = sprintf(
		'<p class="os-activation-nudge__actions"><a class="button button-primary" href="%1$s">%2$s</a> <button type="button" class="button-link os-activation-nudge__dismiss">%3$s</button></p>',
		esc_url( $portal_url ),
		esc_html__( 'Turn on OpenStation', 'desktop-mode' ),
		esc_html__( 'Not now', 'desktop-mode' )
	);

	return '<p>' . $message . '</p>' . $actions;
}

/**
 * Prints the nudge on `admin_notices` / `network_admin_notices`.
 *
 * `wp_admin_notice()` when Core has it; the same `div.notice` markup
 * by hand on older versions (the plugin supports 6.0). The "Not now"
 * button carries a small inline script that POSTs the slug to the
 * seen-intros route and removes the notice, exactly as the welcome
 * dialog does.
 *
 * @return void
 */
function openstation_render_activation_nudge() {
	if ( ! openstation_should_show_activation_nudge() ) {
		return;
	}

	$markup = openstation_activation_nudge_markup();
	if ( function_exists( 'wp_admin_notice' ) ) {
		wp_admin_notice(
			$markup,
			array(
				'type'               => 'info',
				'id'                 => 'os-activation-nudge',
				'additional_classes' => array( 'os-activation-nudge' ),
				'paragraph_wrap'     => false,
			)
		);
	} else {
		echo '<div id="os-activation-nudge" class="notice notice-info os-activation-nudge">' . $markup . '</div>'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- built from escaped parts in openstation_activation_nudge_markup().
	}

	$rest_url   = esc_url_raw( rest_url( 'desktop-mode/v1/intros/seen' ) );
	$rest_nonce = wp_create_nonce( 'wp_rest' );
	?>
<style id="os-activation-nudge-style">
	.os-activation-nudge__actions { margin: 0.5em 0 0.75em; }
	.os-activation-nudge__actions .button-link { margin-left: 8px; }
</style>
<script id="os-activation-nudge-script">
( function () {
	var notice = document.getElementById( 'os-activation-nudge' );
	if ( ! notice ) {
		return;
	}
	var dismiss = notice.querySelector( '.os-activation-nudge__dismiss' );
	if ( ! dismiss ) {
		return;
	}
	dismiss.addEventListener( 'click', function () {
		notice.remove();
		try {
			fetch( <?php echo wp_json_encode( $rest_url ); ?>, {
				method: 'POST',
				credentials: 'same-origin',
				headers: {
					'Content-Type': 'application/json',
					'X-WP-Nonce': <?php echo wp_json_encode( $rest_nonce ); ?>
				},
				body: JSON.stringify( { slug: <?php echo wp_json_encode( OPENSTATION_ACTIVATION_NUDGE_INTRO_SLUG ); ?> } )
			} ).catch( function () {} );
		} catch ( e ) {}
	} );
} )();
</script>
	<?php
}
add_action( 'admin_notices', 'openstation_render_activation_nudge' );
add_action( 'network_admin_notices', 'openstation_render_activation_nudge' );
