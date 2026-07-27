<?php
/**
 * Desktop screen-effect registration API.
 *
 * A "screen effect" is a fragment shader the canvas stage runs over the
 * whole desktop — the built-in scanlines, CRT tube and pixel-art
 * effects, plus anything a plugin adds. See
 * `docs/screen-effects.md` for the full contract.
 *
 * Mirrors the unfocus-effect / command / title-bar-button script
 * registration pattern: minimum-ceremony PHP opt-in
 * (`desktop_mode_register_screen_effect_script`) tells the shell which
 * enqueued scripts contribute screen effects. The shell injects the
 * script URL into the live-refresh payload so a plugin activated
 * mid-session surfaces its effect in OS Settings → Experimental
 * immediately, no F5 needed.
 *
 * Effects themselves are declared JS-side via
 * `wp.desktop.stage.registerScreenEffect( … )` — the shader, its
 * parameters and its label all live in the plugin's JavaScript. The
 * three built-ins are registered through that very same JS hook (see
 * `src/stage/entry.ts`).
 *
 * @since 0.9.8
 * @package WPDesktopMode
 */

defined( 'ABSPATH' ) || exit;

/**
 * Declare a WP-registered script handle as a screen-effect provider.
 *
 * Example:
 *
 * ```php
 * add_action( 'admin_enqueue_scripts', function () {
 *     wp_register_script(
 *         'my-plugin-screen-effects',
 *         plugins_url( 'js/screen-effects.js', __FILE__ ),
 *         array( 'desktop-mode' ),
 *         '1.0.0',
 *         true
 *     );
 *     wp_enqueue_script( 'my-plugin-screen-effects' );
 * } );
 * desktop_mode_register_screen_effect_script( 'my-plugin-screen-effects' );
 * ```
 *
 * For live unregistration on deactivation, the plugin's JS should set
 * `owner: 'my-plugin-screen-effects'` on each `registerScreenEffect`
 * call. Otherwise the effect stays until the next page reload —
 * graceful backwards-compat.
 *
 * @since 0.9.8
 *
 * @param string $handle WP-registered script handle.
 * @return true|WP_Error `true` on success; `WP_Error` on validation failure.
 */
function desktop_mode_register_screen_effect_script( $handle ) {
	$handle = (string) $handle;
	if ( '' === $handle ) {
		return desktop_mode_registration_error(
			'desktop_mode_missing_handle',
			__( 'Screen effect script registration requires a non-empty script handle.', 'desktop-mode' )
		);
	}

	desktop_mode_desktop_screen_effect_script_registry( $handle, true );

	/**
	 * Fires after a desktop screen-effect script handle is registered.
	 *
	 * @since 0.9.8
	 *
	 * @param string $handle The registered script handle.
	 */
	do_action( 'desktop_mode_screen_effect_script_registered', $handle );

	return true;
}

/**
 * Internal module-level registry for screen-effect script handles.
 *
 * @since 0.9.8
 * @internal
 *
 * @param string    $handle Script handle to read or write.
 * @param bool|null $value  Pass `true` to register; `null` to read only.
 * @return array|bool When called with no args returns the full store.
 */
function desktop_mode_desktop_screen_effect_script_registry( $handle = '', $value = null ) {
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
 * @since 0.9.8
 */
function desktop_mode_flush_desktop_screen_effect_script_registry() {
	desktop_mode_desktop_screen_effect_script_registry( '__flush__' );
}

/**
 * Build the script-handle payload fed to the shell. Handles that
 * aren't currently enqueued resolve to an empty URL and are dropped.
 *
 * @since 0.9.8
 *
 * @return array[] List of `{ handle, scriptUrl, … }` entries.
 */
function desktop_mode_build_desktop_screen_effect_scripts_payload() {
	$registry = desktop_mode_desktop_screen_effect_script_registry();
	if ( ! is_array( $registry ) || empty( $registry ) ) {
		return array();
	}

	$out  = array();
	$seen = array();
	foreach ( $registry as $handle => $active ) {
		if ( ! $active || isset( $seen[ $handle ] ) ) {
			continue;
		}
		$payload = desktop_mode_resolve_script_payload( $handle );
		if ( '' === $payload['url'] ) {
			// Loud diagnostic — visible under WP_DEBUG. Deduped by
			// `desktop_mode_warn_unresolvable_script_handle` so the
			// notice fires once per handle per request.
			desktop_mode_warn_unresolvable_script_handle(
				'desktop_mode_register_screen_effect_script',
				'Screen effect',
				(string) $handle
			);
			continue;
		}
		$out[]           = array(
			'handle'             => (string) $handle,
			'scriptUrl'          => $payload['url'],
			'scriptBefore'       => $payload['before'],
			'scriptAfter'        => $payload['after'],
			'scriptL10n'         => $payload['l10n'],
			'scriptTranslations' => $payload['translations'],
		);
		$seen[ $handle ] = true;
	}
	return $out;
}
