<?php
/**
 * OpenStation — Native User Edit (single user) window.
 *
 * Singleton native window that opens when an admin clicks an
 * OTHER user's row in the Users table (or when the URL remap for
 * `user-edit.php?user_id=N` fires). The Users window's "Profile"
 * tab handles the **current** user's own profile in-place — this
 * window is the dedicated surface for editing OTHER users.
 *
 * Reuses the same JS render functions
 * (`mountProfileFormAt`, `mountProfileAsideAt`,
 * `mountProfileActivityAt`) that power the Profile tab; the only
 * difference is the wrapper template (no Users tab strip; just
 * the sidebar layout) and the way the target user id is resolved
 * (read from the shared store when a row click / URL remap set a
 * target, falling back to the viewer's own id — which is how
 * `profile.php` opens).
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Echoes the User Edit window's template body.
 */
function openstation_user_edit_window_render_template() {
	ob_start();
	?>
	<div class="os-user-edit-window" data-os-user-edit-window-root>
		<?php /*
		 * The `<os-user-profile>` component reads its target
		 * user id from the `user-id` attribute and mounts the
		 * full profile surface (sidebar + form + activity) on
		 * its own. The render callback in `index.ts` sets the
		 * attribute after reading the shared store; absent that,
		 * the attribute is empty and the component idles until
		 * set. */ ?>
		<os-user-profile data-os-user-profile-host></os-user-profile>
	</div>
	<?php
	$html = (string) ob_get_clean();

	/**
	 * Filter the User Edit window's template HTML.
	 *
	 * @param string $html Default template HTML.
	 */
	$filtered = (string) apply_filters( 'openstation_user_edit_window_template_html', $html );

	if ( function_exists( 'openstation_kses_native_window_template' ) ) {
		echo openstation_kses_native_window_template( $filtered ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- helper kses-escapes.
	} else {
		echo wp_kses( $filtered, wp_kses_allowed_html( 'post' ) );
	}
}

/**
 * Build the admin colour scheme list with full colour tuples for
 * each scheme. Mirrors what WP core feeds the
 * `admin_color_scheme_picker` action: each entry carries the
 * scheme `name` and a `colors` tuple (typically 3-4 hex strings)
 * used to render mini-swatch previews — not just a slug list.
 *
 * @return array<string,array{name:string,colors:array<int,string>,icon_colors?:array<string,string>}>
 */
function openstation_user_edit_window_color_schemes() {
	$out = array();
	// Always pull in `wp-admin/includes/admin.php` if needed so the
	// admin colour scheme registry is available — the user-edit
	// window may render via REST (where `is_admin()` returns false
	// but `current_user_can( 'edit_user', … )` is the real gate).
	// The include is guarded by `is_readable` so a stripped-down
	// install without admin/ on disk still degrades gracefully.
	if ( ! function_exists( 'register_admin_color_schemes' ) ) {
		$admin_inc = ABSPATH . 'wp-admin/includes/admin.php';
		if ( is_readable( $admin_inc ) ) {
			require_once $admin_inc;
		}
	}
	if ( function_exists( 'register_admin_color_schemes' ) ) {
		register_admin_color_schemes();
	}
	global $_wp_admin_css_colors;
	if ( is_array( $_wp_admin_css_colors ) ) {
		foreach ( $_wp_admin_css_colors as $slug => $info ) {
			$out[ (string) $slug ] = array(
				'name'        => isset( $info->name )
					? (string) $info->name
					: (string) $slug,
				// The colors stylesheet URL — required for the live
				// preview swap on self-edit. Matches what core's
				// `wp-admin/js/user-profile.js` reads off the
				// `.css_url` hidden field per scheme tile.
				'url'         => isset( $info->url )
					? esc_url_raw( (string) $info->url )
					: '',
				'colors'      => isset( $info->colors )
					? array_values( (array) $info->colors )
					: array(),
				'icon_colors' => isset( $info->icon_colors )
					? (array) $info->icon_colors
					: array(),
			);
		}
	}
	if ( empty( $out ) ) {
		// Fallback so the picker still shows ONE option even when
		// $_wp_admin_css_colors hasn't populated.
		$out['fresh'] = array(
			'name'   => __( 'Default', 'desktop-mode' ),
			'colors' => array( '#1d2327', '#2c3338', '#2271b1', '#72aee6' ),
		);
	}
	return $out;
}

/**
 * Register the User Edit native window on `init`.
 */
function openstation_user_edit_window_register_window() {
	if ( ! openstation_user_edit_window_user_can_register() ) {
		return;
	}
	$viewer_id = (int) get_current_user_id();

	$window_args = array(
		'title'      => __( 'Edit user', 'desktop-mode' ),
		'icon'       => 'dashicons-admin-users',
		'template'   => 'openstation_user_edit_window_render_template',
		// Reuses the Posts bundle. The render callback for
		// `desktop-mode-user-edit` lives in `index.ts` and dispatches
		// to `user-edit-render`'s mount points — same code the Users
		// window's Profile tab uses.
		'script'     => 'os-posts-window',
		'style'      => 'os-posts-window',
		'width'      => 1100,
		'height'     => 760,
		'min_width'  => 720,
		'min_height' => 520,
		'placement'  => 'none',
		'config'     => array(
			'mode'             => 'user-edit',
			'restRoot'         => esc_url_raw( rest_url() ),
			'restNonce'        => wp_create_nonce( 'wp_rest' ),
			'usersUrl'         => esc_url_raw( rest_url( 'wp/v2/users' ) ),
			'currentUserId'    => $viewer_id,
			'insightsUrlBase'  => esc_url_raw( rest_url( 'desktop-mode/v1/users/' ) ),
			'editPostUrlBase'  => esc_url_raw( admin_url( 'post.php' ) ),
			// Capability flag so the JS can hide the role select for
			// viewers without `promote_users`. Server-side `update_item`
			// re-checks regardless; this is UX polish.
			'canPromote'       => current_user_can( 'promote_users' ),
			// Roles the viewer is allowed to assign — the role select
			// reads this first and falls back to {@see allRoles} for
			// older configs. Surfacing only assignable roles in the
			// dropdown prevents a "pick a role, hit save, get rejected"
			// loop for viewers with `promote_users` but a narrowed
			// `editable_roles` filter (e.g. site managers who can't
			// promote anyone to administrator).
			'assignableRoles'  => function_exists( 'openstation_users_window_role_label_map' )
				? openstation_users_window_role_label_map( $viewer_id )
				: array(),
			'allRoles'         => function_exists( 'openstation_users_window_all_roles_map' )
				? openstation_users_window_all_roles_map()
				: array(),
			'locales'          => function_exists( 'openstation_users_window_locales_map' )
				? openstation_users_window_locales_map()
				: array( '' => __( 'Site default', 'desktop-mode' ) ),
			'contactMethods'   => (array) apply_filters( 'user_contactmethods', array(), null ),
			'colorSchemes'     => openstation_user_edit_window_color_schemes(),
		),
	);

	$window_args = (array) apply_filters( 'openstation_user_edit_window_args', $window_args );

	$registered = openstation_register_window( 'desktop-mode-user-edit', $window_args );
	if ( is_wp_error( $registered ) ) {
		// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
		error_log( '[openstation] User Edit window registration failed: ' . $registered->get_error_message() );
	}
}
add_action( 'init', 'openstation_user_edit_window_register_window', 25 );
