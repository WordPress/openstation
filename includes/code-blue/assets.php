<?php
/**
 * OpenStation — Code Blue: asset registration.
 *
 * The bundle script + CSS handles are registered on `init` priority
 * 5 and delivered entirely by the shell: the native-window sync
 * injects the registered style at boot (`ensureStyle`) and loads the
 * script the first time the Code Blue window opens. Deliberately no
 * eager `admin_enqueue_scripts` enqueue — it would ship the
 * stylesheet into every chromeless iframe page, where this window
 * can never mount.
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
