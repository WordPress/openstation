<?php
/**
 * Server-side opt-in for dock rail renderer scripts.
 *
 * Mirrors `includes/commands.php` exactly — a plugin enqueues a JS
 * bundle that registers a renderer with `wp.os.registerDockRailRenderer()`,
 * then calls `openstation_register_dock_rail_renderer_script( $handle )`
 * to opt the script into the live-refresh payload. The shell loads
 * the script over the chromeless bridge on activation, the JS calls
 * `registerDockRailRenderer()`, and the OS Settings → Dock style picker
 * surfaces the new option immediately — no F5.
 *
 * On deactivation (handle disappears from the payload), every renderer
 * tagged with `owner: '<handle>'` is unregistered. The active id falls
 * back through the registry's chain (user pick → `default`) and the
 * dispatcher rebuilds the rails with whatever resolves.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register a script handle that contributes a dock rail renderer.
 *
 * Example:
 *
 * ```php
 * add_action( 'openstation_shell_assets', function () {
 *     wp_register_script(
 *         'orbit-rail',
 *         plugin_dir_url( __FILE__ ) . 'orbit-rail.js',
 *         array( 'openstation' ),
 *         '1.0.0',
 *         true
 *     );
 *     wp_enqueue_script( 'orbit-rail' );
 * } );
 * openstation_register_dock_rail_renderer_script( 'orbit-rail' );
 * ```
 *
 * The script's JS side calls `wp.os.registerDockRailRenderer( { … } )`
 * with `owner: 'orbit-rail'` (matching the handle) so deactivation
 * cleanly removes the renderer.
 *
 * @param string $handle WP-registered script handle.
 * @return true|WP_Error `true` on success; `WP_Error` on validation failure.
 */
function openstation_register_dock_rail_renderer_script( $handle ) {
	$handle = (string) $handle;
	if ( '' === $handle ) {
		return openstation_registration_error(
			'openstation_missing_handle',
			__( 'Dock rail renderer script registration requires a non-empty script handle.', 'desktop-mode' )
		);
	}

	openstation_dock_rail_renderer_script_registry( $handle, true );

	/**
	 * Fires after a desktop dock rail renderer script handle is registered.
	 *
	 * @param string $handle The registered script handle.
	 */
	do_action( 'openstation_dock_rail_renderer_script_registered', $handle );

	return true;
}

/**
 * Internal module-level registry for dock rail renderer script handles.
 * Read by the payload builder, written by the registration API.
 *
 * @internal
 *
 * @param string    $handle Script handle to read or write.
 * @param bool|null $value  Pass `true` to register; `null` to read only.
 * @return array|bool When called with no args returns the full store.
 */
function openstation_dock_rail_renderer_script_registry( $handle = '', $value = null ) {
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
function openstation_flush_dock_rail_renderer_script_registry() {
	openstation_dock_rail_renderer_script_registry( '__flush__' );
}

/**
 * Build the payload fed to the shell. Resolves each registered handle
 * to a full `{ handle, scriptUrl, scriptBefore, scriptAfter, scriptL10n,
 * scriptTranslations }` entry; handles that aren't currently enqueued
 * (plugin not active this request) resolve to an empty URL and are
 * dropped.
 *
 * @return array[]
 */
function openstation_build_dock_rail_renderer_scripts_payload() {
	$registry = openstation_dock_rail_renderer_script_registry();
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
			openstation_warn_unresolvable_script_handle(
				'openstation_register_dock_rail_renderer_script',
				'Dock rail renderer',
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
