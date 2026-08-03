<?php
/**
 * OpenStation — Content Graph: asset registration.
 *
 * Mirrors the my-wordpress / recycle-bin / posts-window modules: the
 * bundle script + CSS handles are registered on `init` priority 5, and
 * the native-window sync lazy-loads the script the first time the
 * Content Graph window opens. The CSS is enqueued eagerly in admin
 * context (cheap, ~3KB) so the empty-state spinner has its layout the
 * moment the window mounts.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register Content Graph CSS and JS handles.
 */
function open_station_content_graph_register_assets() {
	$version = OPEN_STATION_VERSION;
	$suffix  = open_station_asset_suffix();

	$css_path = OPEN_STATION_DIR . 'assets/css/content-graph.css';
	wp_register_style(
		'desktop-mode-content-graph',
		OPEN_STATION_URL . 'assets/css/content-graph.css',
		array( 'os-variables', 'dashicons' ),
		file_exists( $css_path ) ? (string) filemtime( $css_path ) : $version
	);

	$js_path = OPEN_STATION_DIR . 'assets/js/content-graph' . $suffix . '.js';
	wp_register_script(
		'desktop-mode-content-graph',
		OPEN_STATION_URL . 'assets/js/content-graph' . $suffix . '.js',
		array( 'wp-i18n' ),
		file_exists( $js_path ) ? (string) filemtime( $js_path ) : $version,
		true
	);
	wp_set_script_translations(
		'desktop-mode-content-graph',
		'desktop-mode',
		OPEN_STATION_DIR . 'languages'
	);
}
add_action( 'init', 'open_station_content_graph_register_assets', 5 );
