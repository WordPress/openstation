<?php
/**
 * Desktop unfocused-window effect registration API.
 *
 * Mirrors the command-script / title-bar-button-script registration
 * pattern: minimum-ceremony PHP opt-in
 * (`openstation_register_unfocus_effect_script`) tells the shell which
 * enqueued scripts contribute unfocus effects. The shell injects the
 * script URL into the live-refresh payload so a plugin activated
 * mid-session surfaces its effect in OS Settings → Effects immediately,
 * no F5 needed.
 *
 * Effects themselves are declared JS-side via
 * `wp.os.registerUnfocusEffect( … )` — the CSS class, apply/clear
 * callbacks, and label all live in the plugin's TypeScript /
 * JavaScript. The built-in `darken` is registered through the very
 * same JS hook (see `src/effects/registry.ts`).
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Declare a WP-registered script handle as an unfocus-effect provider.
 *
 * Example:
 *
 * ```php
 * add_action( 'admin_enqueue_scripts', function () {
 *     wp_register_script(
 *         'my-plugin-effects',
 *         plugins_url( 'js/effects.js', __FILE__ ),
 *         array( 'openstation' ),
 *         '1.0.0',
 *         true
 *     );
 *     wp_enqueue_script( 'my-plugin-effects' );
 * }, 5 ); // Before the shell harvests the payload at priority 10.
 * openstation_register_unfocus_effect_script( 'my-plugin-effects' );
 * ```
 *
 * For live unregistration on deactivation, the plugin's JS should set
 * `owner: 'my-plugin-effects'` on each `registerUnfocusEffect` call.
 * Otherwise the effect stays until the next page reload — graceful
 * backwards-compat.
 *
 * @param string $handle WP-registered script handle.
 * @return true|WP_Error `true` on success; `WP_Error` on validation failure.
 */
function openstation_register_unfocus_effect_script( $handle ) {
	$handle = (string) $handle;
	if ( '' === $handle ) {
		return openstation_registration_error(
			'openstation_missing_handle',
			__( 'Unfocus effect script registration requires a non-empty script handle.', 'desktop-mode' )
		);
	}

	openstation_desktop_unfocus_effect_script_registry( $handle, true );

	/**
	 * Fires after a desktop unfocus-effect script handle is registered.
	 *
	 * @param string $handle The registered script handle.
	 */
	do_action( 'openstation_unfocus_effect_script_registered', $handle );

	return true;
}

/**
 * Internal module-level registry for unfocus-effect script handles.
 *
 * @internal
 *
 * @param string    $handle Script handle to read or write.
 * @param bool|null $value  Pass `true` to register; `null` to read only.
 * @return array|bool When called with no args returns the full store.
 */
function openstation_desktop_unfocus_effect_script_registry( $handle = '', $value = null ) {
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
 * {@see openstation_flush_script_handle_registries()}.
 */
function openstation_flush_desktop_unfocus_effect_script_registry() {
	openstation_desktop_unfocus_effect_script_registry( '__flush__' );
}

/**
 * Build the script-handle payload fed to the shell. Handles that
 * aren't currently enqueued resolve to an empty URL and are dropped.
 *
 * @return array[] List of `{ handle, scriptUrl, … }` entries.
 */
function openstation_build_desktop_unfocus_effect_scripts_payload() {
	$registry = openstation_desktop_unfocus_effect_script_registry();
	if ( ! is_array( $registry ) || empty( $registry ) ) {
		return array();
	}

	$out  = array();
	$seen = array();
	foreach ( $registry as $handle => $active ) {
		if ( ! $active || isset( $seen[ $handle ] ) ) {
			continue;
		}
		$payload = openstation_resolve_script_payload( $handle );
		if ( '' === $payload['url'] ) {
			// Loud diagnostic — visible under WP_DEBUG. Deduped by
			// `openstation_warn_unresolvable_script_handle` so the
			// notice fires once per handle per request.
			openstation_warn_unresolvable_script_handle(
				'openstation_register_unfocus_effect_script',
				'Unfocus effect',
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
