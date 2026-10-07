<?php

defined( 'ABSPATH' ) || exit;

function openstation_register_jazz_quote_widget_assets() {
	$suffix  = openstation_asset_suffix();
	$version = defined( 'OPENSTATION_VERSION' ) ? OPENSTATION_VERSION : '0';

	$js_path  = OPENSTATION_DIR . 'assets/js/widget-jazz-quote' . $suffix . '.js';
	$css_path = OPENSTATION_DIR . 'assets/js/widget-jazz-quote' . $suffix . '.css';

	wp_register_style(
		'os-jazz-quote-widget',
		OPENSTATION_URL . 'assets/js/widget-jazz-quote' . $suffix . '.css',
		array(),
		file_exists( $css_path ) ? (string) filemtime( $css_path ) : $version
	);

	wp_register_script(
		'os-jazz-quote-widget',
		OPENSTATION_URL . 'assets/js/widget-jazz-quote' . $suffix . '.js',
		array(),
		file_exists( $js_path ) ? (string) filemtime( $js_path ) : $version,
		true
	);
}
add_action( 'init', 'openstation_register_jazz_quote_widget_assets', 5 );

function openstation_jazz_quote_inline_version() {
	if ( ! openstation_is_enabled() ) {
		return;
	}
	if ( openstation_is_chromeless_request() ) {
		return;
	}
	$main_handle = ( defined( 'SCRIPT_DEBUG' ) && SCRIPT_DEBUG )
		? 'openstation'
		: 'openstation';

	wp_add_inline_script(
		$main_handle,
		'window.openStationJazzQuote = { wpVersion: ' . wp_json_encode( get_bloginfo( 'version' ) ) . ' };',
		'before'
	);
}
add_action( 'admin_enqueue_scripts', 'openstation_jazz_quote_inline_version', 15 );

function openstation_enqueue_jazz_quote_widget_styles() {
	if ( function_exists( 'openstation_is_enabled' ) && ! openstation_is_enabled() ) {
		return;
	}
	if ( function_exists( 'openstation_is_chromeless_request' ) && openstation_is_chromeless_request() ) {
		return;
	}
	wp_enqueue_style( 'os-jazz-quote-widget' );
}
add_action( 'admin_enqueue_scripts', 'openstation_enqueue_jazz_quote_widget_styles', 20 );

function openstation_register_jazz_quote_widget() {
	if ( ! function_exists( 'openstation_register_widget' ) ) {
		return;
	}
	openstation_register_widget(
		'desktop-mode/jazz-quote',
		array(
			'label'          => __( 'Jazz Quote', 'desktop-mode' ),
			'description'    => __( 'A daily quote from the jazz musician behind your WordPress version.', 'desktop-mode' ),
			'icon'           => 'dashicons-format-audio',
			'script'         => 'os-jazz-quote-widget',
			'movable'        => true,
			'resizable'      => true,
			'min_width'      => 220,
			'min_height'     => 160,
			'default_width'  => 300,
			'default_height' => 220,
		)
	);
}
add_action( 'init', 'openstation_register_jazz_quote_widget', 6 );
