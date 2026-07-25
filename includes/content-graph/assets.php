<?php
/**
 * Desktop Mode — Content Graph: asset registration.
 *
 * Mirrors the my-wordpress / recycle-bin / posts-window modules: the
 * bundle script + CSS handles are registered on `init` priority 5, and
 * the native-window sync lazy-loads the script the first time the
 * Content Graph window opens. The CSS is enqueued eagerly in admin
 * context (cheap, ~3KB) so the empty-state spinner has its layout the
 * moment the window mounts.
 *
 * @package WPDesktopMode
 * @since   0.8.2
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register Content Graph CSS and JS handles.
 *
 * @since 0.8.2
 */
function desktop_mode_content_graph_register_assets() {
	$version = DESKTOP_MODE_VERSION;
	$suffix  = desktop_mode_asset_suffix();

	$css_path = DESKTOP_MODE_DIR . 'assets/css/content-graph.css';
	wp_register_style(
		'desktop-mode-content-graph',
		DESKTOP_MODE_URL . 'assets/css/content-graph.css',
		array( 'desktop-mode-variables', 'dashicons' ),
		file_exists( $css_path ) ? (string) filemtime( $css_path ) : $version
	);

	$js_path = DESKTOP_MODE_DIR . 'assets/js/content-graph' . $suffix . '.js';
	wp_register_script(
		'desktop-mode-content-graph',
		DESKTOP_MODE_URL . 'assets/js/content-graph' . $suffix . '.js',
		array( 'wp-i18n' ),
		file_exists( $js_path ) ? (string) filemtime( $js_path ) : $version,
		true
	);
	wp_set_script_translations(
		'desktop-mode-content-graph',
		'desktop-mode',
		DESKTOP_MODE_DIR . 'languages'
	);
}
add_action( 'init', 'desktop_mode_content_graph_register_assets', 5 );
