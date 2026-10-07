<?php

defined( 'ABSPATH' ) || exit;

function openstation_register_comments_widget_assets() {
	$suffix  = openstation_asset_suffix();
	$version = defined( 'OPENSTATION_VERSION' ) ? OPENSTATION_VERSION : '0';

	$js_path  = OPENSTATION_DIR . 'assets/js/widget-recent-comments' . $suffix . '.js';
	$css_path = OPENSTATION_DIR . 'assets/js/widget-recent-comments' . $suffix . '.css';

	wp_register_style(
		'os-comments-widget',
		OPENSTATION_URL . 'assets/js/widget-recent-comments' . $suffix . '.css',
		array(),
		file_exists( $css_path ) ? (string) filemtime( $css_path ) : $version
	);

	wp_register_script(
		'os-comments-widget',
		OPENSTATION_URL . 'assets/js/widget-recent-comments' . $suffix . '.js',
		array( 'wp-api-fetch' ),
		file_exists( $js_path ) ? (string) filemtime( $js_path ) : $version,
		true
	);
}
add_action( 'init', 'openstation_register_comments_widget_assets', 5 );

function openstation_enqueue_comments_widget_styles() {
	if ( function_exists( 'openstation_is_enabled' ) && ! openstation_is_enabled() ) {
		return;
	}
	if ( function_exists( 'openstation_is_chromeless_request' ) && openstation_is_chromeless_request() ) {
		return;
	}
	wp_enqueue_style( 'os-comments-widget' );
}
add_action( 'admin_enqueue_scripts', 'openstation_enqueue_comments_widget_styles', 20 );

function openstation_register_comments_widget() {
	if ( ! function_exists( 'openstation_register_widget' ) ) {
		return;
	}
	openstation_register_widget(
		'desktop-mode/recent-comments',
		array(
			'label'          => __( 'Recent Comments', 'desktop-mode' ),
			'description'    => __( 'Live feed of the latest comments with pending count.', 'desktop-mode' ),
			'icon'           => 'dashicons-admin-comments',
			'script'         => 'os-comments-widget',
			'movable'        => true,
			'resizable'      => true,
			'min_width'      => 280,
			'min_height'     => 220,
			'default_width'  => 320,
			'default_height' => 380,
		)
	);
}
add_action( 'init', 'openstation_register_comments_widget', 6 );
