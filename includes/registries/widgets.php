<?php
/**
 * OpenStation — Widgets registry.
 *
 * Server-side registration API + payload builder + asset enqueue
 * for the right-column widget layer. Plugin-side JS publishes
 * the full widget def on `window.openStationWidgets[ id ]`; this
 * module is the PHP side that announces them and ships their
 * script handles into the boot payload.
 *
 * Extracted from `components.php` during the architecture-0.8.1
 * PHP slicing (phase 6).
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register a server-side desktop widget. Symmetric to
 * {@see openstation_register_window()} for the right-column widget
 * layer: plugin declares the widget's metadata + script handle in
 * PHP; shell syncs its registry from the live payload so
 * activation / deactivation map to picker add / remove without a
 * browser reload.
 *
 * The mount callback still lives in JS — not serializable across
 * the wire. Plugins register it on
 * `window.openStationWidgets[ <id> ]` as a `(container, ctx) =>
 * teardown` function. The shell reads that global once the
 * declared script loads and wraps it into a WidgetDef.
 *
 * Example:
 *
 * ```php
 * openstation_register_widget( 'myplugin/stats', array(
 *     'label'          => __( 'Stats', 'my-plugin' ),
 *     'description'    => __( 'Live analytics rollup', 'my-plugin' ),
 *     'icon'           => 'dashicons-chart-bar',
 *     'script'         => 'my-plugin-desktop-widgets',
 *     'movable'        => true,
 *     'resizable'      => true,
 *     'default_width'  => 280,
 *     'default_height' => 180,
 * ) );
 * ```
 *
 * ```js
 * // Inside my-plugin-desktop-widgets.js:
 * window.openStationWidgets = window.openStationWidgets || {};
 * window.openStationWidgets[ 'myplugin/stats' ] = function ( container, ctx ) {
 *     container.append( buildDOM() );
 *     return function teardown() { };
 * };
 * ```
 *
 * @param string $id   Widget id. Must match the key the JS side
 *                     uses on `window.openStationWidgets[ … ]`.
 * @param array  $args {
 *     @type string   $label          Human-readable picker label. Required.
 *     @type string   $description    Picker subtitle. Default empty.
 *     @type string   $icon           Dashicons class for the picker.
 *                                    Default 'dashicons-admin-generic'.
 *     @type string   $script         Enqueued script handle that owns
 *                                    the mount callback. Optional — omit
 *                                    when the mount callback is declared
 *                                    by a script already on the shell
 *                                    page. Default empty.
 *     @type bool     $movable        Allow drag out of the right column.
 *     @type bool     $resizable      Allow user resize.
 *     @type int      $min_width
 *     @type int      $min_height
 *     @type int      $max_width
 *     @type int      $max_height
 *     @type int      $default_width  First-mount floating width.
 *     @type int      $default_height First-mount floating height.
 *     @type string[] $capabilities   Gate: ALL caps must match. Any
 *                                    missed cap returns
 *                                    `WP_Error openstation_capability_denied`.
 * }
 * @return true|WP_Error `true` on success; `WP_Error` otherwise.
 */
function openstation_register_widget( $id, $args = array() ) {
	$id = (string) $id;
	if ( '' === $id ) {
		return openstation_registration_error(
			'openstation_missing_id',
			__( 'Widget id is required.', 'desktop-mode' )
		);
	}

	$defaults = array(
		'label'          => '',
		'description'    => '',
		'icon'           => 'dashicons-admin-generic',
		'script'         => '',
		'movable'        => false,
		'resizable'      => false,
		'min_width'      => 0,
		'min_height'     => 0,
		'max_width'      => 0,
		'max_height'     => 0,
		'default_width'  => 0,
		'default_height' => 0,
		'capabilities'   => array(),
	);
	$args     = wp_parse_args( $args, $defaults );

	foreach ( (array) $args['capabilities'] as $cap ) {
		if ( ! current_user_can( (string) $cap ) ) {
			return openstation_registration_error(
				'openstation_capability_denied',
				sprintf(
					/* translators: %s: capability slug. */
					__( 'Current user lacks the %s capability required to register this widget.', 'desktop-mode' ),
					(string) $cap
				),
				array(
					'capability' => (string) $cap,
					'id'         => $id,
				)
			);
		}
	}

	// Required fields. The script handle isn't strictly required —
	// a plugin could register a widget whose mount callback is
	// declared on the shell page's own JS (edge case; still valid).
	if ( '' === (string) $args['label'] ) {
		return openstation_registration_error(
			'openstation_missing_label',
			__( 'Widget registration requires a non-empty `label`.', 'desktop-mode' ),
			array( 'id' => $id )
		);
	}

	$entry = array(
		'id'             => $id,
		'label'          => (string) $args['label'],
		'description'    => (string) $args['description'],
		'icon'           => (string) $args['icon'],
		'script'         => (string) $args['script'],
		'movable'        => (bool) $args['movable'],
		'resizable'      => (bool) $args['resizable'],
		'min_width'      => (int) $args['min_width'],
		'min_height'     => (int) $args['min_height'],
		'max_width'      => (int) $args['max_width'],
		'max_height'     => (int) $args['max_height'],
		'default_width'  => (int) $args['default_width'],
		'default_height' => (int) $args['default_height'],
	);
	openstation_desktop_widget_registry( $id, $entry );

	/**
	 * Fires after a desktop widget is successfully registered.
	 *
	 * Does NOT fire when `openstation_register_widget()` returns a
	 * `WP_Error`.
	 *
	 * @param string $id    The widget id.
	 * @param array  $entry The stored registry entry.
	 */
	do_action( 'openstation_widget_registered', $id, $entry );

	return true;
}

/**
 * Internal module-level registry for widgets registered via
 * {@see openstation_register_widget()}. Same pattern as
 * {@see openstation_native_window_registry()}.
 *
 * @internal
 */
function openstation_desktop_widget_registry( $id = '', $entry = null ) {
	static $store = array();

	if ( '' === (string) $id ) {
		return $store;
	}
	if ( null !== $entry ) {
		$store[ $id ] = $entry;
	}
	return isset( $store[ $id ] ) ? $store[ $id ] : null;
}

/**
 * Build the widget list for the shell payload. Runs through
 * every entry registered via `openstation_register_widget()` and
 * attaches the resolved script URL (`wp_scripts()` lookup) so
 * the shell can dynamically inject the script on mid-session
 * plugin activation.
 *
 * @return array[]
 */
function openstation_build_desktop_widgets_payload() {
	$registry = openstation_desktop_widget_registry();
	if ( ! is_array( $registry ) || empty( $registry ) ) {
		return array();
	}

	$out = array();
	foreach ( $registry as $entry ) {
		$script_payload = openstation_resolve_script_payload( $entry['script'] );

		$out[] = array(
			'id'                 => $entry['id'],
			'label'              => $entry['label'],
			'description'        => $entry['description'],
			'icon'               => $entry['icon'],
			'movable'            => $entry['movable'],
			'resizable'          => $entry['resizable'],
			'minWidth'           => $entry['min_width'],
			'minHeight'          => $entry['min_height'],
			'maxWidth'           => $entry['max_width'],
			'maxHeight'          => $entry['max_height'],
			'defaultWidth'       => $entry['default_width'],
			'defaultHeight'      => $entry['default_height'],
			'scriptUrl'          => $script_payload['url'],
			'scriptHandle'       => $entry['script'],
			'scriptBefore'       => $script_payload['before'],
			'scriptAfter'        => $script_payload['after'],
			'scriptL10n'         => $script_payload['l10n'],
			'scriptTranslations' => $script_payload['translations'],
		);
	}
	return $out;
}

/*
 * Widget scripts are NOT enqueued here, and that is deliberate.
 *
 * Everything the widget picker shows — label, description, icon,
 * size constraints — is metadata declared right here in PHP and
 * shipped in the boot payload. The only thing a plugin's bundle
 * contributes is the `mount` callback, so the shell assembles the
 * whole def from the payload and loads the script the first time
 * the widget is actually mounted.
 *
 * A widget the user has never enabled therefore costs a row in the
 * picker and nothing else. This file used to `wp_enqueue_script()`
 * every registered one on every admin page, which meant the nine
 * built-in widget bundles — Drafts at 46 KB, Focus Timer at 41 KB,
 * Notes at 31 KB, and the rest — were downloaded and parsed by
 * every user whether or not a single widget was on their desktop.
 *
 * See `src/widgets/server-sync.ts`. `scriptUrl` in the payload
 * (built above) is what makes that possible; nothing else on the
 * PHP side is involved.
 */
