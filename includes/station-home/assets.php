<?php
/**
 * OpenStation — Station Home asset registration.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register the lazy Station Home stylesheet and render bundle.
 */
function openstation_station_home_register_assets() {
	$version = OPENSTATION_VERSION;
	$suffix  = openstation_asset_suffix();

	$css_path = OPENSTATION_DIR . 'assets/css/station-home.css';
	wp_register_style(
		'os-station-home',
		OPENSTATION_URL . 'assets/css/station-home.css',
		array( 'os-variables', 'dashicons' ),
		file_exists( $css_path ) ? (string) filemtime( $css_path ) : $version
	);

	$js_path = OPENSTATION_DIR . 'assets/js/station-home' . $suffix . '.js';
	wp_register_script(
		'os-station-home',
		OPENSTATION_URL . 'assets/js/station-home' . $suffix . '.js',
		array( 'wp-i18n' ),
		file_exists( $js_path ) ? (string) filemtime( $js_path ) : $version,
		true
	);
	wp_set_script_translations(
		'os-station-home',
		'desktop-mode',
		OPENSTATION_DIR . 'languages'
	);
}
add_action( 'init', 'openstation_station_home_register_assets', 5 );
