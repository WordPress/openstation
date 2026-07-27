<?php
/**
 * Desktop Mode — My WordPress: asset registration.
 *
 * Registers the bundle script + CSS handles. The bundle is lazy-loaded
 * by the native-window sync the first time the My WordPress window
 * opens, the same as the recycle-bin and posts-window modules.
 *
 * @package WPDesktopMode
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register My WordPress CSS and JS handles.
 */
function desktop_mode_my_wordpress_register_assets() {
	$version = DESKTOP_MODE_VERSION;
	$suffix  = desktop_mode_asset_suffix();

	$css_path = DESKTOP_MODE_DIR . 'assets/css/my-wordpress.css';
	wp_register_style(
		'desktop-mode-my-wordpress',
		DESKTOP_MODE_URL . 'assets/css/my-wordpress.css',
		array( 'desktop-mode-variables', 'dashicons' ),
		file_exists( $css_path ) ? (string) filemtime( $css_path ) : $version
	);

	$js_path = DESKTOP_MODE_DIR . 'assets/js/my-wordpress' . $suffix . '.js';
	wp_register_script(
		'desktop-mode-my-wordpress',
		DESKTOP_MODE_URL . 'assets/js/my-wordpress' . $suffix . '.js',
		array( 'wp-i18n' ),
		file_exists( $js_path ) ? (string) filemtime( $js_path ) : $version,
		true
	);
	wp_set_script_translations(
		'desktop-mode-my-wordpress',
		'desktop-mode',
		DESKTOP_MODE_DIR . 'languages'
	);
}
add_action( 'init', 'desktop_mode_my_wordpress_register_assets', 5 );
