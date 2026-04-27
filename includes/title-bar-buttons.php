<?php
/**
 * Desktop title-bar button registration API.
 *
 * Mirrors the command-script / settings-tab-script registration
 * pattern: minimum-ceremony PHP opt-in (`desktop_mode_register_titlebar_button_script`)
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
 *         array( 'desktop-mode' ),
 *         '1.0.0',
 *         true
 *     );
 *     wp_enqueue_script( 'my-plugin-titlebar' );
 * } );
 * desktop_mode_register_titlebar_button_script( 'my-plugin-titlebar' );
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
function desktop_mode_register_titlebar_button_script( $handle ) {
	$handle = (string) $handle;
	if ( '' === $handle ) {
		return desktop_mode_registration_error(
			'desktop_mode_missing_handle',
			__( 'Title-bar button script registration requires a non-empty script handle.', 'desktop-mode' )
		);
	}

	desktop_mode_desktop_titlebar_button_script_registry( $handle, true );

	/**
	 * Fires after a desktop title-bar button script handle is registered.
	 *
	 * @since 0.17.0
	 *
	 * @param string $handle The registered script handle.
	 */
	do_action( 'desktop_mode_titlebar_button_script_registered', $handle );

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
function desktop_mode_desktop_titlebar_button_script_registry( $handle = '', $value = null ) {
	static $store = array();

	if ( '__flush__' === (string) $handle ) {
		$store = array();
		return array();
	}
	if ( '' === (string) $handle ) {
		return $store;
	}
	if ( null !== $value ) {
		$store[ (string) $handle ] = (bool) $value;
	}
	return isset( $store[ (string) $handle ] ) ? $store[ (string) $handle ] : false;
}

/**
 * Test-only: clear the registry between PHPUnit cases. See
 * {@see desktop_mode_flush_script_handle_registries()}.
 *
 * @since 0.18.0
 */
function desktop_mode_flush_desktop_titlebar_button_script_registry() {
	desktop_mode_desktop_titlebar_button_script_registry( '__flush__' );
}

/**
 * Build the script-handle payload fed to the shell. Handles that
 * aren't currently enqueued resolve to an empty URL and are dropped.
 *
 * @since 0.17.0
 *
 * @return array[] List of `{ handle, scriptUrl }` entries.
 */
function desktop_mode_build_desktop_titlebar_button_scripts_payload() {
	$registry = desktop_mode_desktop_titlebar_button_script_registry();
	if ( ! is_array( $registry ) || empty( $registry ) ) {
		return array();
	}

	$out  = array();
	$seen = array();
	foreach ( $registry as $handle => $active ) {
		if ( ! $active || isset( $seen[ $handle ] ) ) {
			continue;
		}
		$url = desktop_mode_resolve_script_url( $handle );
		if ( '' === $url ) {
			// Loud diagnostic — visible under WP_DEBUG. Plugin
			// authors who pass a typo'd handle, or call our
			// register helper before `wp_register_script()`, used
			// to silently register nothing and stare at an empty
			// title bar. Deduped by `desktop_mode_warn_unresolvable_script_handle`
			// so the notice fires exactly once per handle per
			// request, not on every shell-config rebuild.
			desktop_mode_warn_unresolvable_script_handle(
				'desktop_mode_register_titlebar_button_script',
				'Title-bar button',
				(string) $handle
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
