<?php

defined( 'ABSPATH' ) || exit;

function openstation_register_starter_widget_assets() {
	$suffix  = openstation_asset_suffix();
	$version = defined( 'OPENSTATION_VERSION' ) ? OPENSTATION_VERSION : '0';

	$js_path  = OPENSTATION_DIR . 'assets/js/widget-starter' . $suffix . '.js';
	$css_path = OPENSTATION_DIR . 'assets/js/widget-starter' . $suffix . '.css';

	wp_register_style(
		'os-starter-widget',
		OPENSTATION_URL . 'assets/js/widget-starter' . $suffix . '.css',
		array(),
		file_exists( $css_path ) ? (string) filemtime( $css_path ) : $version
	);

	wp_register_script(
		'os-starter-widget',
		OPENSTATION_URL . 'assets/js/widget-starter' . $suffix . '.js',
		array( 'wp-api-fetch' ),

		file_exists( $js_path ) ? (string) filemtime( $js_path ) : $version,
		true
	);
}
add_action( 'init', 'openstation_register_starter_widget_assets', 5 );

function openstation_enqueue_starter_widget_styles() {
	if ( function_exists( 'openstation_is_enabled' ) && ! openstation_is_enabled() ) {
		return;
	}
	if ( function_exists( 'openstation_is_chromeless_request' ) && openstation_is_chromeless_request() ) {
		return;
	}
	wp_enqueue_style( 'os-starter-widget' );
}
add_action( 'admin_enqueue_scripts', 'openstation_enqueue_starter_widget_styles', 20 );

function openstation_register_starter_widget() {
	if ( ! function_exists( 'openstation_register_widget' ) ) {

		return;
	}

	openstation_register_widget(

		'desktop-mode/starter',
		array(
			'label'          => __( 'Starter Widget', 'desktop-mode' ),
			'description'    => __( 'A skeleton widget — copy this to build your own.', 'desktop-mode' ),
			'icon'           => 'dashicons-welcome-widgets-menus',
			'script'         => 'os-starter-widget',
			'movable'        => true,
			'resizable'      => true,
			'min_width'      => 200,
			'min_height'     => 140,
			'default_width'  => 280,
			'default_height' => 200,
		)
	);
}
add_action( 'init', 'openstation_register_starter_widget', 6 );
