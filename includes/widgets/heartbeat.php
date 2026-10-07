<?php

defined( 'ABSPATH' ) || exit;

function openstation_register_heartbeat_widget_assets() {
	$suffix  = openstation_asset_suffix();
	$version = defined( 'OPENSTATION_VERSION' ) ? OPENSTATION_VERSION : '0';

	$js_path  = OPENSTATION_DIR . 'assets/js/widget-heartbeat' . $suffix . '.js';
	$css_path = OPENSTATION_DIR . 'assets/js/widget-heartbeat' . $suffix . '.css';

	wp_register_style(
		'os-heartbeat-widget',
		OPENSTATION_URL . 'assets/js/widget-heartbeat' . $suffix . '.css',
		array(),
		file_exists( $css_path ) ? (string) filemtime( $css_path ) : $version
	);
	wp_register_script(
		'os-heartbeat-widget',
		OPENSTATION_URL . 'assets/js/widget-heartbeat' . $suffix . '.js',
		array( 'wp-hooks' ),
		file_exists( $js_path ) ? (string) filemtime( $js_path ) : $version,
		true
	);
}
add_action( 'init', 'openstation_register_heartbeat_widget_assets', 5 );

function openstation_register_heartbeat_widget() {
	if ( ! function_exists( 'openstation_register_widget' ) ) {
		return;
	}
	openstation_register_widget(
		'desktop-mode/heartbeat',
		array(
			'label'          => __( 'Heartbeat', 'desktop-mode' ),
			'description'    => __(
				'A gently beating heart that pulses with the WordPress Heartbeat. The bar fills as the next tick approaches.',
				'desktop-mode'
			),
			'icon'           => 'dashicons-heart',
			'script'         => 'os-heartbeat-widget',
			'movable'        => true,
			'resizable'      => false,
			'min_width'      => 310,
			'max_width'      => 310,
			'min_height'     => 230,
			'max_height'     => 230,
			'default_width'  => 310,
			'default_height' => 230,
		)
	);
}
add_action( 'init', 'openstation_register_heartbeat_widget', 6 );

function openstation_enqueue_heartbeat_widget_styles() {
	if ( function_exists( 'openstation_is_enabled' ) && ! openstation_is_enabled() ) {
		return;
	}

	if (
		function_exists( 'openstation_is_chromeless_request' )
		&& openstation_is_chromeless_request()
	) {
		return;
	}

	$eager = (bool) apply_filters( 'openstation_heartbeat_widget_eager_css', true );
	if ( ! $eager ) {
		return;
	}
	wp_enqueue_style( 'os-heartbeat-widget' );
}
add_action( 'admin_enqueue_scripts', 'openstation_enqueue_heartbeat_widget_styles', 20 );
