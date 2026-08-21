<?php
/**
 * OpenStation — Code Blue: asset registration.
 *
 * Mirrors the content-graph / my-wordpress modules: the bundle
 * script + CSS handles are registered on `init` priority 5, and the
 * native-window sync lazy-loads the script the first time the
 * Code Blue window opens. The CSS is enqueued eagerly in admin
 * context (cheap) so the window has its layout the moment it mounts.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register Code Blue CSS and JS handles.
 */
function openstation_code_blue_register_assets() {
	$version = OPENSTATION_VERSION;
	$suffix  = openstation_asset_suffix();

	$css_path = OPENSTATION_DIR . 'assets/css/code-blue.css';
	wp_register_style(
		'openstation-code-blue',
		OPENSTATION_URL . 'assets/css/code-blue.css',
		array( 'os-variables' ),
		file_exists( $css_path ) ? (string) filemtime( $css_path ) : $version
	);

	$js_path = OPENSTATION_DIR . 'assets/js/code-blue' . $suffix . '.js';
	wp_register_script(
		'openstation-code-blue',
		OPENSTATION_URL . 'assets/js/code-blue' . $suffix . '.js',
		array( 'wp-i18n' ),
		file_exists( $js_path ) ? (string) filemtime( $js_path ) : $version,
		true
	);
	wp_set_script_translations(
		'openstation-code-blue',
		'desktop-mode',
		OPENSTATION_DIR . 'languages'
	);
}
add_action( 'init', 'openstation_code_blue_register_assets', 5 );

/**
 * Enqueue the bundle's CSS in admin context. The script is lazy-
 * loaded by the native-window sync.
 */
function openstation_code_blue_enqueue_styles() {
	if ( ! openstation_code_blue_user_can_use() ) {
		return;
	}
	wp_enqueue_style( 'openstation-code-blue' );
}
add_action( 'admin_enqueue_scripts', 'openstation_code_blue_enqueue_styles', 30 );
