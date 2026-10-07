<?php

defined( 'ABSPATH' ) || exit;

function openstation_living_tree_register_assets() {
	$version = OPENSTATION_VERSION;
	$suffix  = openstation_asset_suffix();

	$js_path = OPENSTATION_DIR . 'assets/js/living-tree-wallpaper' . $suffix . '.js';
	wp_register_script(
		'os-living-tree-wallpaper',
		OPENSTATION_URL . 'assets/js/living-tree-wallpaper' . $suffix . '.js',
		array( 'wp-hooks', 'wp-i18n' ),
		file_exists( $js_path ) ? (string) filemtime( $js_path ) : $version,
		true
	);
	wp_set_script_translations(
		'os-living-tree-wallpaper',
		'desktop-mode',
		OPENSTATION_DIR . 'languages'
	);
}
add_action( 'init', 'openstation_living_tree_register_assets', 5 );
