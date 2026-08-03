<?php
/**
 * OpenStation — Focus Timer widget PHP registration.
 *
 * Registers the widget's JS bundle + CSS, enqueues the CSS eagerly on
 * shell pages, and announces the widget to OpenStation so it appears in
 * the widget picker. All behaviour lives in the JS
 * (src/plugins/focus-timer-widget/); this file only declares the widget.
 *
 * The timer runs entirely in the browser — no REST routes, no server
 * state, no external services — so the script declares no dependencies.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register the Focus Timer widget's script + style handles.
 *
 * @return void
 */
function open_station_register_focus_timer_widget_assets() {
	$suffix  = open_station_asset_suffix();
	$version = defined( 'OPEN_STATION_VERSION' ) ? OPEN_STATION_VERSION : '0';

	$js_path  = OPEN_STATION_DIR . 'assets/js/widget-focus-timer' . $suffix . '.js';
	$css_path = OPEN_STATION_DIR . 'assets/js/widget-focus-timer' . $suffix . '.css';

	wp_register_style(
		'os-focus-timer-widget',
		OPEN_STATION_URL . 'assets/js/widget-focus-timer' . $suffix . '.css',
		array(),
		file_exists( $css_path ) ? (string) filemtime( $css_path ) : $version
	);

	wp_register_script(
		'os-focus-timer-widget',
		OPEN_STATION_URL . 'assets/js/widget-focus-timer' . $suffix . '.js',
		array(),
		file_exists( $js_path ) ? (string) filemtime( $js_path ) : $version,
		true
	);
}
add_action( 'init', 'open_station_register_focus_timer_widget_assets', 5 );

/**
 * Eagerly enqueue the CSS on OpenStation shell pages (avoids a flash of
 * unstyled content before the lazy JS mounts).
 *
 * @return void
 */
function open_station_enqueue_focus_timer_widget_styles() {
	if ( function_exists( 'open_station_is_enabled' ) && ! open_station_is_enabled() ) {
		return;
	}
	if ( function_exists( 'open_station_is_chromeless_request' ) && open_station_is_chromeless_request() ) {
		return;
	}
	wp_enqueue_style( 'os-focus-timer-widget' );
}
add_action( 'admin_enqueue_scripts', 'open_station_enqueue_focus_timer_widget_styles', 20 );

/**
 * Announce the widget to OpenStation.
 *
 * @return void
 */
function open_station_register_focus_timer_widget() {
	if ( ! function_exists( 'open_station_register_widget' ) ) {
		return;
	}

	open_station_register_widget(
		'desktop-mode/focus-timer',
		array(
			'label'          => __( 'Focus Timer', 'desktop-mode' ),
			'description'    => __( 'A focus countdown. Link it to a window and get a shake + alarm when time is up.', 'desktop-mode' ),
			'icon'           => 'dashicons-clock',
			'script'         => 'os-focus-timer-widget',
			'movable'        => true,
			'resizable'      => true,
			'min_width'      => 240,
			'min_height'     => 200,
			'default_width'  => 300,
			'default_height' => 300,
		)
	);
}
add_action( 'init', 'open_station_register_focus_timer_widget', 6 );
