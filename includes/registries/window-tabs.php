<?php
/**
 * OpenStation — Native-window tabs registry.
 *
 * Multi-tab native windows are a sister-to-the-window
 * registration: a tab is owned by some window id and its content
 * is wrapped in `<os-tabpanel>` automatically by the shell. The
 * MAIN_TAB constant reserves the `'main'` value for the window's
 * own `template` callback so plugins can't accidentally collide
 * with the built-in main pane.
 *
 * Extracted from `components.php` during the architecture-0.8.1
 * PHP slicing (phase 6).
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Reserved tab value for the window's own `template` output. The
 * main tab always renders first, its markup comes from the window
 * registration's `template` callback, and its label is the
 * window's `main_tab_label` (falling back to the window `title`).
 *
 * Plugins cannot register an additional tab with this value —
 * {@see open_station_register_window_tab()} returns
 * `open_station_reserved_tab_value` when they try.
 */
const OPEN_STATION_NATIVE_WINDOW_MAIN_TAB = 'main';

/**
 * Register an additional tab on an existing native window.
 *
 * Mirrors the legacy iframe-window ergonomics where submenus
 * auto-become tabs below the title bar: the window's own
 * `template` renders as the first tab (labelled by `main_tab_label`
 * / `title`), and every call to this function adds another tab
 * alongside it. Cross-plugin extension is supported — a companion
 * plugin can attach a tab to someone else's window.
 *
 * Registering even a single tab turns on the auto-wrap path in
 * `open_station_build_native_window_template_html()`: the shell wraps the
 * window body in `<os-stack>` + `<os-tabs>` + `<os-tabpanel>`
 * elements automatically. Plugin authors no longer hand-write that
 * markup — the shell provides it and `<os-tabpanel>` auto-swap
 * handles visibility.
 *
 * ```php
 * // Plugin that owns the window declares its own tabs:
 * open_station_register_window( 'jorvy', array(
 *     'title'          => 'Jorvy',
 *     'main_tab_label' => 'Quotes',
 *     'template'       => function () { echo '<p class="quote"></p>'; },
 *     'script'         => 'jorvy-main',
 * ) );
 * open_station_register_window_tab( 'jorvy', array(
 *     'value'    => 'about',
 *     'label'    => 'About',
 *     'template' => function () { echo '<p>Marvel quotes, rotated every 10s.</p>'; },
 * ) );
 *
 * // A companion plugin attaches a tab to someone else's window:
 * open_station_register_window_tab( 'jorvy', array(
 *     'value'    => 'stats',
 *     'label'    => 'Stats',
 *     'template' => 'jorvy_stats_pane',
 *     'script'   => 'jorvy-stats',
 * ) );
 * ```
 *
 * @param string $window_id Id of the native window this tab belongs to.
 * @param array  $args {
 *     @type string   $value        Tab id (unique within the window).
 *                                  Required. Cannot equal the reserved
 *                                  value `main` — that's the window's
 *                                  own template tab.
 *     @type string   $label        Display label on the tab strip. Required.
 *     @type callable $template     Callback that echoes the tab's
 *                                  pane HTML. Wrapped in
 *                                  `<os-tabpanel for="<value>">` by
 *                                  the shell. Required.
 *     @type string   $script       Optional script handle enqueued
 *                                  when the window is active — useful
 *                                  when a tab needs its own JS module
 *                                  without bloating the main window
 *                                  script. Default empty.
 *     @type int      $position     Sort order among tabs on this
 *                                  window; lower renders earlier.
 *                                  Default 100.
 *     @type string[] $capabilities Gate: ALL caps must match. Any
 *                                  missed cap returns
 *                                  `WP_Error open_station_capability_denied`.
 * }
 * @return true|WP_Error `true` on success; `WP_Error` otherwise.
 */
function open_station_register_window_tab( $window_id, $args = array() ) {
	$window_id = sanitize_key( (string) $window_id );
	if ( '' === $window_id ) {
		return open_station_registration_error(
			'open_station_missing_window_id',
			__( 'Window id is required when registering a tab.', 'desktop-mode' )
		);
	}

	$defaults = array(
		'value'        => '',
		'label'        => '',
		'template'     => null,
		'script'       => '',
		'position'     => 100,
		'capabilities' => array(),
	);
	$args = wp_parse_args( $args, $defaults );

	foreach ( (array) $args['capabilities'] as $cap ) {
		if ( ! current_user_can( (string) $cap ) ) {
			return open_station_registration_error(
				'open_station_capability_denied',
				sprintf(
					/* translators: %s: capability slug. */
					__( 'Current user lacks the %s capability required to register this window tab.', 'desktop-mode' ),
					(string) $cap
				),
				array( 'capability' => (string) $cap, 'window_id' => $window_id )
			);
		}
	}

	// Tab values accept both flat slugs ('convert') and a single
	// `vendor/sub-id` namespace ('plugin/convert') so two plugins
	// targeting the same window can ship same-named tabs without
	// stomping each other in the registry. The downstream uses
	// (`os-tabpanel[for="…"]`, `<os-tab value="…">`) all pass the
	// value through esc_attr and use it as an attribute selector,
	// which tolerates the slash.
	$value_raw = strtolower( trim( (string) $args['value'] ) );
	if ( '' === $value_raw ) {
		return open_station_registration_error(
			'open_station_missing_tab_value',
			__( 'Window tab registration requires a non-empty `value`.', 'desktop-mode' ),
			array( 'window_id' => $window_id )
		);
	}
	if ( ! preg_match( '/^[a-z0-9_-]+(\/[a-z0-9_-]+)?$/', $value_raw ) ) {
		return open_station_registration_error(
			'open_station_invalid_tab_value',
			sprintf(
				/* translators: %s: the invalid value. */
				__( 'Window tab `value` "%s" must match /^[a-z0-9_-]+(\/[a-z0-9_-]+)?$/ — lowercase alphanum + hyphen/underscore, with at most one `vendor/sub-id` slash.', 'desktop-mode' ),
				$value_raw
			),
			array( 'window_id' => $window_id, 'value' => $value_raw )
		);
	}
	$value = $value_raw;
	if ( OPEN_STATION_NATIVE_WINDOW_MAIN_TAB === $value ) {
		return open_station_registration_error(
			'open_station_reserved_tab_value',
			sprintf(
				/* translators: %s: the reserved value. */
				__( 'The tab value "%s" is reserved for the window\'s own template tab.', 'desktop-mode' ),
				OPEN_STATION_NATIVE_WINDOW_MAIN_TAB
			),
			array( 'window_id' => $window_id, 'value' => $value )
		);
	}
	if ( '' === (string) $args['label'] ) {
		return open_station_registration_error(
			'open_station_missing_label',
			__( 'Window tab registration requires a non-empty `label`.', 'desktop-mode' ),
			array( 'window_id' => $window_id )
		);
	}
	if ( ! is_callable( $args['template'] ) ) {
		return open_station_registration_error(
			'open_station_invalid_template',
			__( 'Window tab registration requires a callable `template` that echoes the pane body.', 'desktop-mode' ),
			array( 'window_id' => $window_id )
		);
	}

	$entry = array(
		'value'    => $value,
		'label'    => (string) $args['label'],
		'template' => $args['template'],
		'script'   => (string) $args['script'],
		'position' => (int) $args['position'],
	);
	open_station_desktop_window_tab_registry( $window_id, $value, $entry );

	/**
	 * Fires after a native window tab is successfully registered.
	 *
	 * Does NOT fire when `open_station_register_window_tab()` returns
	 * a `WP_Error`.
	 *
	 * @param string $window_id The window this tab belongs to.
	 * @param string $value     The tab value.
	 * @param array  $entry     The stored registry entry.
	 */
	do_action( 'open_station_window_tab_registered', $window_id, $value, $entry );

	return true;
}

/**
 * Internal nested registry for native-window tabs keyed by
 * `[window_id][value]`. Pass `$entry = null` and any non-empty
 * `$value` to read a single entry; pass both `$window_id` and
 * `$value` empty to get the full registry.
 *
 * @internal
 *
 * @param string     $window_id Window id (or '' to read everything).
 * @param string     $value     Tab value (or '' to read every tab
 *                              on the given window).
 * @param array|null $entry     Entry to store, or null to just read.
 * @return array|null
 */
function open_station_desktop_window_tab_registry( $window_id = '', $value = '', $entry = null ) {
	static $store = array();

	if ( '' === (string) $window_id ) {
		return $store;
	}
	if ( ! isset( $store[ $window_id ] ) ) {
		$store[ $window_id ] = array();
	}
	if ( '' === (string) $value ) {
		return $store[ $window_id ];
	}
	if ( null !== $entry ) {
		$store[ $window_id ][ $value ] = $entry;
	}
	return isset( $store[ $window_id ][ $value ] )
		? $store[ $window_id ][ $value ]
		: null;
}

/**
 * Return the ordered list of tab descriptors for a window. The
 * main tab (reserved value `main`) is always first; additional
 * tabs follow in `position` order (ties broken by registration
 * order).
 *
 * Shape per entry: `{ value, label, template, script, is_main, position }`.
 *
 * Filterable via `open_station_window_tabs` so a late-loading plugin
 * can reorder, hide, or relabel tabs another plugin registered —
 * mirrors the `open_station_wallpapers` filter discipline.
 *
 * @param string $window_id Window id.
 * @return array[]
 */
function open_station_get_native_window_tabs( $window_id ) {
	$window = open_station_native_window_registry( (string) $window_id );
	if ( ! is_array( $window ) ) {
		return array();
	}

	$extras = open_station_desktop_window_tab_registry( $window_id );
	if ( ! is_array( $extras ) ) {
		$extras = array();
	}

	// Main tab first — label falls back to the window title when no
	// `main_tab_label` was set during registration.
	$main_label = '' !== (string) $window['main_tab_label']
		? (string) $window['main_tab_label']
		: (string) $window['title'];
	$tabs = array(
		array(
			'value'    => OPEN_STATION_NATIVE_WINDOW_MAIN_TAB,
			'label'    => $main_label,
			'template' => $window['template'],
			'script'   => '',
			'is_main'  => true,
			'position' => 0,
		),
	);

	// Additional tabs sorted by position. Values are trusted — they
	// were validated against /^[a-z0-9_-]+(\/[a-z0-9_-]+)?$/ at
	// registration time (sanitize_key would strip the namespace slash).
	$sorted = array_values( $extras );
	usort( $sorted, static function ( $a, $b ) {
		if ( $a['position'] === $b['position'] ) {
			return 0;
		}
		return $a['position'] < $b['position'] ? -1 : 1;
	} );
	foreach ( $sorted as $tab ) {
		$tabs[] = array(
			'value'    => $tab['value'],
			'label'    => $tab['label'],
			'template' => $tab['template'],
			'script'   => $tab['script'],
			'is_main'  => false,
			'position' => $tab['position'],
		);
	}

	/**
	 * Filters the full ordered tab list for a native window right
	 * before the shell renders it. Return a reshaped array to
	 * reorder, hide, or rename tabs — same shape as the input.
	 *
	 * The main tab's `template` is the window's own template
	 * callback; replacing it at filter time is supported but
	 * unusual — prefer updating the window registration itself.
	 *
	 * @param array[] $tabs      Ordered tab descriptors.
	 * @param string  $window_id Window id.
	 */
	$filtered = apply_filters( 'open_station_window_tabs', $tabs, $window_id );
	return is_array( $filtered ) ? $filtered : $tabs;
}
