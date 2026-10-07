<?php

defined( 'ABSPATH' ) || exit;

function openstation_my_wordpress_register_assets() {
	$version = OPENSTATION_VERSION;
	$suffix  = openstation_asset_suffix();

	$css_path = OPENSTATION_DIR . 'assets/css/my-wordpress.css';
	wp_register_style(
		'desktop-mode-my-wordpress',
		OPENSTATION_URL . 'assets/css/my-wordpress.css',
		array( 'os-variables', 'dashicons', 'os-files' ),
		file_exists( $css_path ) ? (string) filemtime( $css_path ) : $version
	);

	unset( $suffix );
}
add_action( 'init', 'openstation_my_wordpress_register_assets', 5 );

function openstation_my_wordpress_app_style( $window_args, $app_id ) {
	if ( 'my-wordpress' !== (string) $app_id || ! is_array( $window_args ) ) {
		return $window_args;
	}
	$styles                 = isset( $window_args['styles'] ) ? (array) $window_args['styles'] : array();
	$styles[]               = 'desktop-mode-my-wordpress';
	$window_args['styles']  = $styles;
	return $window_args;
}
add_filter( 'openstation_app_window_args', 'openstation_my_wordpress_app_style', 10, 2 );
