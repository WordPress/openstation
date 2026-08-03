<?php
/**
 * OpenStation — My WordPress: asset registration.
 *
 * Registers the bundle script + CSS handles. The bundle is lazy-loaded
 * by the native-window sync the first time the My WordPress window
 * opens, the same as the recycle-bin and posts-window modules.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register My WordPress CSS and JS handles.
 */
function open_station_my_wordpress_register_assets() {
	$version = OPEN_STATION_VERSION;
	$suffix  = open_station_asset_suffix();

	$css_path = OPEN_STATION_DIR . 'assets/css/my-wordpress.css';
	wp_register_style(
		'desktop-mode-my-wordpress',
		OPEN_STATION_URL . 'assets/css/my-wordpress.css',
		array( 'os-variables', 'dashicons' ),
		file_exists( $css_path ) ? (string) filemtime( $css_path ) : $version
	);

	$js_path = OPEN_STATION_DIR . 'assets/js/my-wordpress' . $suffix . '.js';
	wp_register_script(
		'desktop-mode-my-wordpress',
		OPEN_STATION_URL . 'assets/js/my-wordpress' . $suffix . '.js',
		array( 'wp-i18n' ),
		file_exists( $js_path ) ? (string) filemtime( $js_path ) : $version,
		true
	);
	wp_set_script_translations(
		'desktop-mode-my-wordpress',
		'desktop-mode',
		OPEN_STATION_DIR . 'languages'
	);
}
add_action( 'init', 'open_station_my_wordpress_register_assets', 5 );
