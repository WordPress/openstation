<?php
/**
 * Desktop title-bar button registration API.
 *
 * Mirrors the command-script / settings-tab-script registration
 * pattern: minimum-ceremony PHP opt-in (`wp_desktop_register_titlebar_button_script`)
 * tells the shell which enqueued scripts contribute title-bar
 * buttons. The shell injects the script URL into the live-refresh
 * payload so a plugin activated mid-session paints its button
 * immediately, no F5 needed.
 *
 * Buttons themselves are declared JS-side via
 * `wp.desktop.registerTitleBarButton( … )` — the predicate, render,
 * and onClick all live in the plugin's TypeScript / JavaScript.
 *
 * @since 0.17.0
 * @package WPDesktopMode
 */

defined( 'ABSPATH' ) || exit;

/**
 * Declare a WP-registered script handle as a title-bar button
 * provider.
 *
 * Example:
 *
 * ```php
 * add_action( 'admin_enqueue_scripts', function () {
 *     wp_register_script(
 *         'my-plugin-titlebar',
 *         plugins_url( 'js/titlebar.js', __FILE__ ),
 *         array( 'wp-desktop-mode' ),
 *         '1.0.0',
 *         true
 *     );
 *     wp_enqueue_script( 'my-plugin-titlebar' );
 * } );
 * wp_desktop_register_titlebar_button_script( 'my-plugin-titlebar' );
 * ```
 *
 * For live unregistration on deactivation, the plugin's JS should
 * set `owner: 'my-plugin-titlebar'` on each `registerTitleBarButton`
 * call. Otherwise the button stays until the next page reload —
 * graceful backwards-compat.
 *
 * @since 0.17.0
 *
 * @param string $handle WP-registered script handle.
 * @return true|WP_Error `true` on success; `WP_Error` on validation failure.
 */
function wp_desktop_register_titlebar_button_script( $handle ) {
	$handle = (string) $handle;
	if ( '' === $handle ) {
		return wpdm_registration_error(
			'wp_desktop_missing_handle',
			__( 'Title-bar button script registration requires a non-empty script handle.', 'wp-desktop-mode' )
		);
	}

	wpdm_desktop_titlebar_button_script_registry( $handle, true );

	/**
	 * Fires after a desktop title-bar button script handle is registered.
	 *
	 * @since 0.17.0
	 *
	 * @param string $handle The registered script handle.
	 */
	do_action( 'wp_desktop_titlebar_button_script_registered', $handle );

	return true;
}

/**
 * Internal module-level registry for title-bar button script handles.
 *
 * @since 0.17.0
 * @internal
 *
 * @param string    $handle Script handle to read or write.
 * @param bool|null $value  Pass `true` to register; `null` to read only.
 * @return array|bool When called with no args returns the full store.
 */
function wpdm_desktop_titlebar_button_script_registry( $handle = '', $value = null ) {
	static $store = array();

	if ( '' === (string) $handle ) {
		return $store;
	}
	if ( null !== $value ) {
		$store[ (string) $handle ] = (bool) $value;
	}
	return isset( $store[ (string) $handle ] ) ? $store[ (string) $handle ] : false;
}

/**
 * Build the script-handle payload fed to the shell. Handles that
 * aren't currently enqueued resolve to an empty URL and are dropped.
 *
 * @since 0.17.0
 *
 * @return array[] List of `{ handle, scriptUrl }` entries.
 */
function wpdm_build_desktop_titlebar_button_scripts_payload() {
	$registry = wpdm_desktop_titlebar_button_script_registry();
	if ( ! is_array( $registry ) || empty( $registry ) ) {
		return array();
	}

	$out  = array();
	$seen = array();
	foreach ( $registry as $handle => $active ) {
		if ( ! $active || isset( $seen[ $handle ] ) ) {
			continue;
		}
		$url = wpdm_resolve_script_url( $handle );
		if ( '' === $url ) {
			// Loud diagnostic — visible under WP_DEBUG. Plugin
			// authors who pass a typo'd handle, or call
			// wp_desktop_register_titlebar_button_script() before
			// running wp_register_script(), used to silently
			// register nothing and stare at an empty title bar.
			_doing_it_wrong(
				'wp_desktop_register_titlebar_button_script',
				sprintf(
					/* translators: %s: script handle. */
					esc_html__( 'Title-bar button script handle "%s" is not registered with WordPress (no `wp_register_script` call found). The script will not load.', 'wp-desktop-mode' ),
					esc_html( (string) $handle )
				),
				'0.18.0'
			);
			continue;
		}
		$out[]           = array(
			'handle'    => (string) $handle,
			'scriptUrl' => $url,
		);
		$seen[ $handle ] = true;
	}
	return $out;
}
