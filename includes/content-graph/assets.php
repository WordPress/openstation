<?php

defined( 'ABSPATH' ) || exit;

function openstation_content_graph_register_assets() {
	$version = OPENSTATION_VERSION;
	$suffix  = openstation_asset_suffix();

	$css_path = OPENSTATION_DIR . 'assets/css/content-graph.css';
	wp_register_style(
		'desktop-mode-content-graph',
		OPENSTATION_URL . 'assets/css/content-graph.css',
		array( 'os-variables', 'dashicons' ),
		file_exists( $css_path ) ? (string) filemtime( $css_path ) : $version
	);

	$js_path = OPENSTATION_DIR . 'assets/js/content-graph' . $suffix . '.js';
	wp_register_script(
		'desktop-mode-content-graph',
		OPENSTATION_URL . 'assets/js/content-graph' . $suffix . '.js',
		array( 'wp-i18n' ),
		file_exists( $js_path ) ? (string) filemtime( $js_path ) : $version,
		true
	);
	wp_set_script_translations(
		'desktop-mode-content-graph',
		'desktop-mode',
		OPENSTATION_DIR . 'languages'
	);
}
add_action( 'init', 'openstation_content_graph_register_assets', 5 );
