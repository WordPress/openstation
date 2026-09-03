<?php
/**
 * Desktop command registration APIs.
 *
 * Two entry points, mirroring the rest of the plugin surface but tuned
 * for the command-palette use case:
 *
 *   - `openstation_register_command_script( $handle )` — primary, minimum-
 *     ceremony opt-in. Tells the shell: "this enqueued script registers
 *     slash-commands; include it in the plugins-changed payload so it
 *     gets injected into the shell page mid-session when my plugin is
 *     installed or activated without a full reload."
 *
 *   - `openstation_register_command( $args )` — optional. Plugins that
 *     want to declare command metadata server-side (for discoverability
 *     tooling, REST enumeration, future pre-registration shims) use this.
 *     The `run` function still lives JS-side; metadata is advisory today.
 *
 * Both APIs feed `openstation_build_desktop_command_scripts_payload()` and
 * `openstation_build_desktop_commands_payload()`, which contribute
 * `serverCommandScripts` and `serverCommands` to the shell payload in
 * `openstation_build_menu_payload()`.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Declare a WP-registered script handle as a command-palette provider.
 *
 * Example:
 *
 * ```php
 * add_action( 'admin_enqueue_scripts', function () {
 *     wp_register_script(
 *         'home-assistant-commands',
 *         plugins_url( 'js/commands.js', __FILE__ ),
 *         array( 'openstation' ),
 *         '1.0.0',
 *         true
 *     );
 *     wp_enqueue_script( 'home-assistant-commands' );
 * }, 5 ); // Before the shell harvests the payload at priority 10.
 * openstation_register_command_script( 'home-assistant-commands' );
 * ```
 *
 * The script's JS side calls `wp.os.registerCommand( { … } )` as
 * usual. When a user installs or activates the plugin, the chromeless
 * bridge's `os-plugins-changed` payload includes the resolved
 * script URL; the shell's command-sync module injects the script into
 * the shell page and the new commands appear in the palette without a
 * full reload.
 *
 * @param string $handle WP-registered script handle.
 * @return true|WP_Error `true` on success; `WP_Error` on validation failure.
 */
function openstation_register_command_script( $handle ) {
	$handle = (string) $handle;
	if ( '' === $handle ) {
		return openstation_registration_error(
			'openstation_missing_handle',
			__( 'Command script registration requires a non-empty script handle.', 'desktop-mode' )
		);
	}

	openstation_desktop_command_script_registry( $handle, true );

	/**
	 * Fires after a desktop command script handle is registered.
	 *
	 * @param string $handle The registered script handle.
	 */
	do_action( 'openstation_command_script_registered', $handle );

	return true;
}

/**
 * Declare a desktop command server-side. Optional companion to
 * `openstation_register_command_script()` for plugins that want metadata
 * enumerable without JS execution (REST, future pre-registration, etc.).
 * The command's `run` function still lives JS-side; this function only
 * stores metadata.
 *
 * Example:
 *
 * ```php
 * openstation_register_command( array(
 *     'slug'        => 'ha-lights',
 *     'label'       => __( 'Home Assistant: Lights', 'home-assistant' ),
 *     'description' => __( 'Toggle smart lights from the palette.', 'home-assistant' ),
 *     'icon'        => 'dashicons-lightbulb',
 *     'hint'        => '[room]',
 *     'script'      => 'home-assistant-commands',
 * ) );
 * ```
 *
 * Implicitly registers the `script` handle via
 * `openstation_register_command_script()` when provided, so plugins using
 * this API don't need to call both functions.
 *
 * @param array $args {
 *     @type string $slug        Slash-command slug (without leading `/`). Required.
 *     @type string $label       Human-readable label. Required.
 *     @type string $description Subtitle shown in the palette. Default empty.
 *     @type string $icon        Dashicons class. Default `dashicons-arrow-right-alt`.
 *     @type string $hint        Argument hint rendered next to the slug. Default empty.
 *     @type string $script      WP script handle providing the `run` function.
 *                               Registered via `openstation_register_command_script()`
 *                               when present. Default empty (advisory registration only).
 * }
 * @return true|WP_Error `true` on success; `WP_Error` on validation failure.
 */
function openstation_register_command( $args = array() ) {
	$defaults = array(
		'slug'        => '',
		'label'       => '',
		'description' => '',
		'icon'        => 'dashicons-arrow-right-alt',
		'hint'        => '',
		'script'      => '',
	);
	$args     = wp_parse_args( $args, $defaults );

	$slug = (string) $args['slug'];
	if ( '' === $slug ) {
		return openstation_registration_error(
			'openstation_missing_slug',
			__( 'Command registration requires a non-empty `slug`.', 'desktop-mode' )
		);
	}
	if ( '' === (string) $args['label'] ) {
		return openstation_registration_error(
			'openstation_missing_label',
			__( 'Command registration requires a non-empty `label`.', 'desktop-mode' ),
			array( 'slug' => $slug )
		);
	}

	$entry = array(
		'slug'        => $slug,
		'label'       => (string) $args['label'],
		'description' => (string) $args['description'],
		'icon'        => (string) $args['icon'],
		'hint'        => (string) $args['hint'],
		'script'      => (string) $args['script'],
	);
	openstation_desktop_command_registry( $slug, $entry );

	if ( '' !== $entry['script'] ) {
		openstation_register_command_script( $entry['script'] );
	}

	/**
	 * Fires after a desktop command is successfully registered.
	 *
	 * @param string $slug  The command slug.
	 * @param array  $entry The stored registry entry.
	 */
	do_action( 'openstation_command_registered', $slug, $entry );

	return true;
}

/**
 * Internal module-level registry for command script handles declared
 * via {@see openstation_register_command_script()}. Accessed by both the
 * registration API (write) and the payload builder (read).
 *
 * @internal
 *
 * @param string    $handle Script handle to read or write.
 * @param bool|null $value  Pass `true` to register; `null` to read only.
 * @return array|bool When called with no args returns the full store.
 */
function openstation_desktop_command_script_registry( $handle = '', $value = null ) {
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
 * Flush the command-script registry. Tests call this in `set_up` so
 * a previous test's stale handle doesn't leak into the next test's
 * payload-build assertions. No production caller.
 */
function openstation_flush_desktop_command_script_registry() {
	openstation_desktop_command_script_registry( '__flush__' );
}

/**
 * Internal module-level registry for commands declared via
 * {@see openstation_register_command()}.
 *
 * @internal
 *
 * @param string     $slug  Slug to read or write.
 * @param array|null $entry Entry to store, or `null` to read.
 * @return array|null
 */
function openstation_desktop_command_registry( $slug = '', $entry = null ) {
	static $store = array();

	if ( '' === (string) $slug ) {
		return $store;
	}
	if ( null !== $entry ) {
		$store[ (string) $slug ] = $entry;
	}
	return isset( $store[ (string) $slug ] ) ? $store[ (string) $slug ] : null;
}

/**
 * Build the script-handle payload fed to the shell. Resolves each
 * registered handle to a full payload via {@see openstation_resolve_script_payload()};
 * handles that aren't currently enqueued (plugin not active this request)
 * resolve to an empty URL and are dropped. The harvested `extra` data
 * (localize / inline / translations) ships alongside the URL so the
 * shell's lazy `<script>` injection doesn't drop it the way a bare
 * `<script src="…">` append would.
 *
 * @return array[] List of `{ handle, scriptUrl, scriptBefore, scriptAfter, scriptL10n, scriptTranslations }` entries.
 */
function openstation_build_desktop_command_scripts_payload() {
	$registry = openstation_desktop_command_script_registry();
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
				'openstation_register_command_script',
				'Command',
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
 * Build the metadata payload for commands declared via
 * {@see openstation_register_command()}. Each entry carries the resolved
 * `scriptUrl` alongside metadata so the shell's sync knows which script
 * contributed it — enables future pre-registration shims without a round
 * trip.
 *
 * @return array[]
 */
function openstation_build_desktop_commands_payload() {
	$registry = openstation_desktop_command_registry();
	if ( ! is_array( $registry ) || empty( $registry ) ) {
		return array();
	}

	$out = array();
	foreach ( $registry as $entry ) {
		$handle  = (string) $entry['script'];
		$payload = '' !== $handle
			? openstation_resolve_script_payload( $handle )
			: array(
				'url'          => '',
				'before'       => array(),
				'after'        => array(),
				'l10n'         => array(),
				'translations' => '',
			);
		$out[]   = array(
			'slug'               => (string) $entry['slug'],
			'label'              => (string) $entry['label'],
			'description'        => (string) $entry['description'],
			'icon'               => (string) $entry['icon'],
			'hint'               => (string) $entry['hint'],
			'scriptUrl'          => $payload['url'],
			'scriptHandle'       => $handle,
			'scriptBefore'       => $payload['before'],
			'scriptAfter'        => $payload['after'],
			'scriptL10n'         => $payload['l10n'],
			'scriptTranslations' => $payload['translations'],
		);
	}
	return $out;
}
