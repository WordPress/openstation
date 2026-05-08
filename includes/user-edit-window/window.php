<?php
/**
 * Desktop Mode — Native User Edit (single user) window.
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
 * (always read from the shared store; no fallback to current user).
 *
 * @package WPDesktopMode
 * @since   0.18.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Echoes the User Edit window's template body.
 *
 * @since 0.18.0
 */
function desktop_mode_user_edit_window_render_template() {
	ob_start();
	?>
	<div class="desktop-mode-user-edit-window" data-desktop-mode-user-edit-window-root>
		<?php /*
		 * The `<wpd-user-profile>` component reads its target
		 * user id from the `user-id` attribute and mounts the
		 * full profile surface (sidebar + form + activity) on
		 * its own. The render callback in `index.ts` sets the
		 * attribute after reading the shared store; absent that,
		 * the attribute is empty and the component idles until
		 * set. */ ?>
		<wpd-user-profile data-wpd-user-profile-host></wpd-user-profile>
	</div>
	<?php
	$html = (string) ob_get_clean();

	/**
	 * Filter the User Edit window's template HTML.
	 *
	 * @since 0.18.0
	 *
	 * @param string $html Default template HTML.
	 */
	$filtered = (string) apply_filters( 'desktop_mode_user_edit_window_template_html', $html );

	if ( function_exists( 'desktop_mode_kses_native_window_template' ) ) {
		echo desktop_mode_kses_native_window_template( $filtered ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- helper kses-escapes.
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
 * @since 0.18.0
 *
 * @return array<string,array{name:string,colors:array<int,string>,icon_colors?:array<string,string>}>
 */
function desktop_mode_user_edit_window_color_schemes() {
	$out = array();
	// Defensive: `register_admin_color_schemes` lives in
	// wp-admin/includes/admin.php and assumes admin context. On
	// `init` (which fires for every request including the front
	// end via REST) we may not be there yet, and pulling in the
	// whole admin include just to read the colour map is a
	// non-trivial side effect. Only attempt the registration when
	// we're already in admin AND the function is available; fall
	// back to a minimal "fresh" entry on the front end so the
	// window still registers.
	if ( is_admin() ) {
		if ( ! function_exists( 'register_admin_color_schemes' ) ) {
			$admin_inc = ABSPATH . 'wp-admin/includes/admin.php';
			if ( is_readable( $admin_inc ) ) {
				require_once $admin_inc;
			}
		}
		if ( function_exists( 'register_admin_color_schemes' ) ) {
			register_admin_color_schemes();
		}
	}
	global $_wp_admin_css_colors;
	if ( is_array( $_wp_admin_css_colors ) ) {
		foreach ( $_wp_admin_css_colors as $slug => $info ) {
			$out[ (string) $slug ] = array(
				'name'        => isset( $info->name )
					? (string) $info->name
					: (string) $slug,
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
 *
 * @since 0.18.0
 */
function desktop_mode_user_edit_window_register_window() {
	$viewer_id = (int) get_current_user_id();
	if ( $viewer_id <= 0 ) {
		return;
	}

	$window_args = array(
		'title'      => __( 'Edit user', 'desktop-mode' ),
		'icon'       => 'dashicons-admin-users',
		'template'   => 'desktop_mode_user_edit_window_render_template',
		// Reuses the Posts bundle. The render callback for
		// `desktop-mode-user-edit` lives in `index.ts` and dispatches
		// to `user-edit-render`'s mount points — same code the Users
		// window's Profile tab uses.
		'script'     => 'desktop-mode-posts-window',
		'style'      => 'desktop-mode-posts-window',
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
			'allRoles'         => function_exists( 'desktop_mode_users_window_all_roles_map' )
				? desktop_mode_users_window_all_roles_map()
				: array(),
			'locales'          => function_exists( 'desktop_mode_users_window_locales_map' )
				? desktop_mode_users_window_locales_map()
				: array( '' => __( 'Site default', 'desktop-mode' ) ),
			'contactMethods'   => (array) apply_filters( 'user_contactmethods', array(), null ),
			'colorSchemes'     => desktop_mode_user_edit_window_color_schemes(),
		),
	);

	$window_args = (array) apply_filters( 'desktop_mode_user_edit_window_args', $window_args );

	$registered = desktop_mode_register_window( 'desktop-mode-user-edit', $window_args );
	if ( is_wp_error( $registered ) ) {
		// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
		error_log( '[desktop-mode] User Edit window registration failed: ' . $registered->get_error_message() );
	}
}
add_action( 'init', 'desktop_mode_user_edit_window_register_window', 25 );
