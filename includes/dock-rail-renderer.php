<?php
/**
 * Server-side opt-in for dock rail renderer scripts.
 *
 * Mirrors `includes/commands.php` exactly — a plugin enqueues a JS
 * bundle that registers a renderer with `wp.desktop.registerDockRailRenderer()`,
 * then calls `desktop_mode_register_dock_rail_renderer_script( $handle )`
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
 * @since 0.18.0
 *
 * @package WPDesktopMode
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register a script handle that contributes a dock rail renderer.
 *
 * Example:
 *
 * ```php
 * add_action( 'wp_desktop_shell_assets', function () {
 *     wp_register_script(
 *         'orbit-rail',
 *         plugin_dir_url( __FILE__ ) . 'orbit-rail.js',
 *         array( 'desktop-mode' ),
 *         '1.0.0',
 *         true
 *     );
 *     wp_enqueue_script( 'orbit-rail' );
 * } );
 * desktop_mode_register_dock_rail_renderer_script( 'orbit-rail' );
 * ```
 *
 * The script's JS side calls `wp.desktop.registerDockRailRenderer( { … } )`
 * with `owner: 'orbit-rail'` (matching the handle) so deactivation
 * cleanly removes the renderer.
 *
 * @since 0.18.0
 *
 * @param string $handle WP-registered script handle.
 * @return true|WP_Error `true` on success; `WP_Error` on validation failure.
 */
function desktop_mode_register_dock_rail_renderer_script( $handle ) {
	$handle = (string) $handle;
	if ( '' === $handle ) {
		return desktop_mode_registration_error(
			'desktop_mode_missing_handle',
			__( 'Dock rail renderer script registration requires a non-empty script handle.', 'desktop-mode' )
		);
	}

	desktop_mode_dock_rail_renderer_script_registry( $handle, true );

	/**
	 * Fires after a desktop dock rail renderer script handle is registered.
	 *
	 * @since 0.18.0
	 *
	 * @param string $handle The registered script handle.
	 */
	do_action( 'desktop_mode_dock_rail_renderer_script_registered', $handle );

	return true;
}

/**
 * Internal module-level registry for dock rail renderer script handles.
 * Read by the payload builder, written by the registration API.
 *
 * @since 0.18.0
 * @internal
 *
 * @param string    $handle Script handle to read or write.
 * @param bool|null $value  Pass `true` to register; `null` to read only.
 * @return array|bool When called with no args returns the full store.
 */
function desktop_mode_dock_rail_renderer_script_registry( $handle = '', $value = null ) {
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
 * Flush the registry. Tests call this in `set_up`.
 *
 * @since 0.18.0
 */
function desktop_mode_flush_dock_rail_renderer_script_registry() {
	desktop_mode_dock_rail_renderer_script_registry( '__flush__' );
}

/**
 * Build the payload fed to the shell. Resolves each registered handle
 * to a full `{ handle, scriptUrl, scriptBefore, scriptAfter, scriptL10n,
 * scriptTranslations }` entry; handles that aren't currently enqueued
 * (plugin not active this request) resolve to an empty URL and are
 * dropped.
 *
 * @since 0.18.0
 *
 * @return array[]
 */
function desktop_mode_build_dock_rail_renderer_scripts_payload() {
	$registry = desktop_mode_dock_rail_renderer_script_registry();
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
			desktop_mode_warn_unresolvable_script_handle(
				'desktop_mode_register_dock_rail_renderer_script',
				'Dock rail renderer',
				(string) $handle
			);
			continue;
		}
		$out[]            = array(
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
