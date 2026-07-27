<?php
/**
 * Desktop OS Settings tab registration APIs.
 *
 * Two entry points, mirroring the command-palette surface
 * ({@see includes/commands.php}):
 *
 *   - `desktop_mode_register_settings_tab_script( $handle )` — primary,
 *     minimum-ceremony opt-in. Tells the shell: "this enqueued script
 *     registers OS Settings tabs; include it in the plugins-changed
 *     payload so it gets injected mid-session without a full reload."
 *
 *   - `desktop_mode_register_settings_tab( $args )` — optional. Declares
 *     tab metadata server-side so the shell can live-unregister tabs on
 *     plugin deactivation without the JS having to tag every
 *     `registerSettingsTab()` with an `owner`.
 *
 * Both APIs feed `desktop_mode_build_desktop_settings_tab_scripts_payload()`
 * and `desktop_mode_build_desktop_settings_tabs_payload()`, which contribute
 * `serverSettingsTabScripts` and `serverSettingsTabs` to the shell
 * payload in `desktop_mode_build_menu_payload()`.
 *
 * The tab's `render` callback lives JS-side — the PHP layer only
 * ferries identity and metadata.
 *
 * @since 0.5.1
 * @package WPDesktopMode
 */

defined( 'ABSPATH' ) || exit;

/**
 * Declare a WP-registered script handle as an OS Settings tab provider.
 *
 * Example:
 *
 * ```php
 * add_action( 'admin_enqueue_scripts', function () {
 *     wp_register_script(
 *         'my-plugin-settings',
 *         plugins_url( 'js/settings.js', __FILE__ ),
 *         array( 'desktop-mode' ),
 *         '1.0.0',
 *         true
 *     );
 *     wp_enqueue_script( 'my-plugin-settings' );
 * } );
 * desktop_mode_register_settings_tab_script( 'my-plugin-settings' );
 * ```
 *
 * @since 0.5.1
 *
 * @param string $handle WP-registered script handle.
 * @return true|WP_Error `true` on success; `WP_Error` on validation failure.
 */
function desktop_mode_register_settings_tab_script( $handle ) {
	$handle = (string) $handle;
	if ( '' === $handle ) {
		return desktop_mode_registration_error(
			'desktop_mode_missing_handle',
			__( 'Settings tab script registration requires a non-empty script handle.', 'desktop-mode' )
		);
	}

	desktop_mode_desktop_settings_tab_script_registry( $handle, true );

	/**
	 * Fires after a desktop settings-tab script handle is registered.
	 *
	 * @since 0.5.1
	 *
	 * @param string $handle The registered script handle.
	 */
	do_action( 'desktop_mode_settings_tab_script_registered', $handle );

	return true;
}

/**
 * Declare an OS Settings tab server-side. Optional companion to
 * `desktop_mode_register_settings_tab_script()` — plugins that declare
 * their tab here get live-unregister-on-deactivate for free; plugins
 * that don't can still set `owner` on their JS `registerSettingsTab()`
 * call, or accept "tab stays until next reload" as graceful fallback.
 *
 * Example:
 *
 * ```php
 * desktop_mode_register_settings_tab( array(
 *     'id'         => 'my-plugin',
 *     'label'      => __( 'My Plugin', 'my-plugin' ),
 *     'capability' => 'manage_options',
 *     'order'      => 50,
 *     'script'     => 'my-plugin-settings',
 * ) );
 * ```
 *
 * Implicitly registers the `script` handle via
 * `desktop_mode_register_settings_tab_script()` when provided.
 *
 * @since 0.5.1
 *
 * @param array $args {
 *     @type string $id         Unique tab id, `[a-z0-9_-]+`. Required.
 *     @type string $label      Human-readable tab label. Required.
 *     @type string $capability Required capability to see the tab.
 *                              Shell today maps this to `isAdmin` gating
 *                              (`manage_options` → admin-only; anything
 *                              else → visible to everyone). Default empty.
 *     @type int    $order      Sort order relative to built-in tabs
 *                              (appearance=10, themes=12, features=25,
 *                              help=40). Default 100 (appended).
 *     @type string $script     WP script handle providing the
 *                              `registerSettingsTab()` call.
 *                              Registered implicitly when present.
 *                              Default empty.
 * }
 * @return true|WP_Error `true` on success; `WP_Error` on validation failure.
 */
function desktop_mode_register_settings_tab( $args = array() ) {
	$defaults = array(
		'id'         => '',
		'label'      => '',
		'capability' => '',
		'order'      => 100,
		'script'     => '',
	);
	$args     = wp_parse_args( $args, $defaults );

	$id = (string) $args['id'];
	if ( '' === $id || ! preg_match( '/^[a-z0-9_\-]+$/', $id ) ) {
		return desktop_mode_registration_error(
			'desktop_mode_invalid_id',
			__( 'Settings tab registration requires a non-empty `id` matching [a-z0-9_-]+.', 'desktop-mode' ),
			array( 'id' => $id )
		);
	}
	if ( '' === (string) $args['label'] ) {
		return desktop_mode_registration_error(
			'desktop_mode_missing_label',
			__( 'Settings tab registration requires a non-empty `label`.', 'desktop-mode' ),
			array( 'id' => $id )
		);
	}

	$entry = array(
		'id'         => $id,
		'label'      => (string) $args['label'],
		'capability' => (string) $args['capability'],
		'order'      => (int) $args['order'],
		'script'     => (string) $args['script'],
	);
	desktop_mode_desktop_settings_tab_registry( $id, $entry );

	if ( '' !== $entry['script'] ) {
		desktop_mode_register_settings_tab_script( $entry['script'] );
	}

	/**
	 * Fires after a desktop settings tab is successfully registered.
	 *
	 * @since 0.5.1
	 *
	 * @param string $id    The tab id.
	 * @param array  $entry The stored registry entry.
	 */
	do_action( 'desktop_mode_settings_tab_registered', $id, $entry );

	return true;
}

/**
 * Internal module-level registry for settings-tab script handles
 * declared via {@see desktop_mode_register_settings_tab_script()}.
 *
 * @since 0.5.1
 * @internal
 *
 * @param string    $handle Script handle to read or write.
 * @param bool|null $value  Pass `true` to register; `null` to read only.
 * @return array|bool When called with no args returns the full store.
 */
function desktop_mode_desktop_settings_tab_script_registry( $handle = '', $value = null ) {
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
 * @since 0.5.2
 */
function desktop_mode_flush_desktop_settings_tab_script_registry() {
	desktop_mode_desktop_settings_tab_script_registry( '__flush__' );
}

/**
 * Internal module-level registry for tabs declared via
 * {@see desktop_mode_register_settings_tab()}.
 *
 * @since 0.5.1
 * @internal
 *
 * @param string     $id    Tab id to read or write.
 * @param array|null $entry Entry to store, or `null` to read.
 * @return array|null
 */
function desktop_mode_desktop_settings_tab_registry( $id = '', $entry = null ) {
	static $store = array();

	if ( '' === (string) $id ) {
		return $store;
	}
	if ( null !== $entry ) {
		$store[ (string) $id ] = $entry;
	}
	return isset( $store[ (string) $id ] ) ? $store[ (string) $id ] : null;
}

/**
 * Build the script-handle payload fed to the shell. Handles that
 * aren't currently enqueued resolve to an empty URL and are dropped —
 * matches the command-scripts payload builder.
 *
 * @since 0.5.1
 *
 * @return array[] List of `{ handle, scriptUrl, scriptBefore, scriptAfter, scriptL10n, scriptTranslations }` entries.
 */
function desktop_mode_build_desktop_settings_tab_scripts_payload() {
	$registry = desktop_mode_desktop_settings_tab_script_registry();
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
				'desktop_mode_register_settings_tab_script',
				'Settings-tab',
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

/**
 * Build the metadata payload for tabs declared via
 * {@see desktop_mode_register_settings_tab()}. Each entry carries the
 * resolved `scriptUrl` alongside metadata so the shell's sync can
 * unregister tabs attributable to a script handle that just left the
 * `serverSettingsTabScripts` payload.
 *
 * @since 0.5.1
 *
 * @return array[]
 */
function desktop_mode_build_desktop_settings_tabs_payload() {
	$registry = desktop_mode_desktop_settings_tab_registry();
	if ( ! is_array( $registry ) || empty( $registry ) ) {
		return array();
	}

	$out = array();
	foreach ( $registry as $entry ) {
		$handle  = (string) $entry['script'];
		$payload = '' !== $handle
			? desktop_mode_resolve_script_payload( $handle )
			: array(
				'url'          => '',
				'before'       => array(),
				'after'        => array(),
				'l10n'         => array(),
				'translations' => '',
			);
		$out[]  = array(
			'id'                => (string) $entry['id'],
			'label'             => (string) $entry['label'],
			'capability'        => (string) $entry['capability'],
			'order'             => (int) $entry['order'],
			'scriptUrl'         => $payload['url'],
			'scriptHandle'      => $handle,
			'scriptBefore'      => $payload['before'],
			'scriptAfter'       => $payload['after'],
			'scriptL10n'        => $payload['l10n'],
			'scriptTranslations' => $payload['translations'],
		);
	}
	return $out;
}
