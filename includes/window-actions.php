<?php
/**
 * Window actions-menu registration API.
 *
 * Mirrors the title-bar-button / command / settings-tab script
 * registration pattern: minimum-ceremony PHP opt-in
 * (`openstation_register_window_action_script`) tells the shell which
 * enqueued scripts contribute rows to a window's ⋯ menu. The shell
 * injects the script URL into the live-refresh payload, so a plugin
 * activated mid-session gets its row on the next menu open with no F5
 * — and, more to the point, a plugin *deactivated* mid-session loses
 * it just as promptly.
 *
 * That second half is the reason this file exists. `WindowActionDef`
 * has always documented an `owner` field as the handle to unregister
 * by on deactivation, and the registry has always implemented
 * `unregisterWindowActionsByOwner()`. Nothing called it: without a
 * server-side opt-in there was no payload key to diff, so the promise
 * in the docs described behaviour no code performed.
 *
 * Actions themselves are declared JS-side via
 * `wp.os.registerWindowAction( … )` — label, icon, predicate and
 * handler all live in the plugin's TypeScript / JavaScript, because
 * all four are read per menu open against a live window object.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Declare a WP-registered script handle as a window-action provider.
 *
 * Example:
 *
 * ```php
 * add_action( 'admin_enqueue_scripts', function () {
 *     wp_register_script(
 *         'my-plugin-window-actions',
 *         plugins_url( 'js/window-actions.js', __FILE__ ),
 *         array( 'openstation' ),
 *         '1.0.0',
 *         true
 *     );
 *     wp_enqueue_script( 'my-plugin-window-actions' );
 * } );
 * openstation_register_window_action_script( 'my-plugin-window-actions' );
 * ```
 *
 * For live unregistration on deactivation, the plugin's JS should set
 * `owner: 'my-plugin-window-actions'` on each `registerWindowAction`
 * call. Otherwise the row stays until the next page reload — graceful
 * backwards-compat, the same bargain commands and title-bar buttons
 * offer.
 *
 * @param string $handle WP-registered script handle.
 * @return true|WP_Error `true` on success; `WP_Error` on validation failure.
 */
function openstation_register_window_action_script( $handle ) {
	$handle = (string) $handle;
	if ( '' === $handle ) {
		return openstation_registration_error(
			'openstation_missing_handle',
			__( 'Window action script registration requires a non-empty script handle.', 'desktop-mode' )
		);
	}

	openstation_desktop_window_action_script_registry( $handle, true );

	/**
	 * Fires after a window action script handle is registered.
	 *
	 * @param string $handle The registered script handle.
	 */
	do_action( 'openstation_window_action_script_registered', $handle );

	return true;
}

/**
 * Internal module-level registry for window action script handles.
 *
 * @internal
 *
 * @param string    $handle Script handle to read or write.
 * @param bool|null $value  Pass `true` to register; `null` to read only.
 * @return array|bool When called with no args returns the full store.
 */
function openstation_desktop_window_action_script_registry( $handle = '', $value = null ) {
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
function openstation_flush_desktop_window_action_script_registry() {
	openstation_desktop_window_action_script_registry( '__flush__' );
}

/**
 * Build the script-handle payload fed to the shell. Handles that
 * aren't currently enqueued resolve to an empty URL and are dropped.
 *
 * @return array[] List of `{ handle, scriptUrl, scriptBefore, scriptAfter, scriptL10n, scriptTranslations }` entries.
 */
function openstation_build_desktop_window_action_scripts_payload() {
	$registry = openstation_desktop_window_action_script_registry();
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
			// Loud diagnostic — visible under WP_DEBUG. A typo'd handle,
			// or a register call made before `wp_register_script()`,
			// otherwise registers nothing and leaves the author staring
			// at a ⋯ menu that never grew a row.
			openstation_warn_unresolvable_script_handle(
				'openstation_register_window_action_script',
				'Window action',
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
