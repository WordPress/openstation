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
function openstation_my_wordpress_register_assets() {
	$version = OPENSTATION_VERSION;
	$suffix  = openstation_asset_suffix();

	$css_path = OPENSTATION_DIR . 'assets/css/my-wordpress.css';
	wp_register_style(
		'desktop-mode-my-wordpress',
		OPENSTATION_URL . 'assets/css/my-wordpress.css',
		array( 'os-variables', 'dashicons' ),
		file_exists( $css_path ) ? (string) filemtime( $css_path ) : $version
	);

	$js_path = OPENSTATION_DIR . 'assets/js/my-wordpress' . $suffix . '.js';
	wp_register_script(
		'desktop-mode-my-wordpress',
		OPENSTATION_URL . 'assets/js/my-wordpress' . $suffix . '.js',
		array( 'wp-i18n' ),
		file_exists( $js_path ) ? (string) filemtime( $js_path ) : $version,
		true
	);
	wp_set_script_translations(
		'desktop-mode-my-wordpress',
		'desktop-mode',
		OPENSTATION_DIR . 'languages'
	);
}
add_action( 'init', 'openstation_my_wordpress_register_assets', 5 );
