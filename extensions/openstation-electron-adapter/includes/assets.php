<?php

defined( 'ABSPATH' ) || exit;

function openstation_electron_register_assets() {
	$suffix = ( defined( 'SCRIPT_DEBUG' ) && SCRIPT_DEBUG ) ? '' : '.min';
	$script = 'assets/js/electron-adapter' . $suffix . '.js';
	$path   = OPENSTATION_ELECTRON_DIR . $script;

	wp_register_script(
		'openstation-electron-adapter',
		OPENSTATION_ELECTRON_URL . $script,
		array( 'openstation' ),
		file_exists( $path ) ? (string) filemtime( $path ) : OPENSTATION_ELECTRON_VERSION,

		array(
			'in_footer' => true,
			'strategy'  => 'defer',
		)
	);

	$style = 'assets/css/solo-host.css';
	wp_register_style(
		'openstation-electron-solo',
		OPENSTATION_ELECTRON_URL . $style,
		array(),
		file_exists( OPENSTATION_ELECTRON_DIR . $style )
			? (string) filemtime( OPENSTATION_ELECTRON_DIR . $style )
			: OPENSTATION_ELECTRON_VERSION
	);
}
add_action( 'init', 'openstation_electron_register_assets' );

function openstation_electron_enqueue() {
	if ( ! function_exists( 'openstation_is_enabled' ) || ! openstation_is_enabled() ) {
		return;
	}
	if ( function_exists( 'openstation_is_chromeless_request' ) && openstation_is_chromeless_request() ) {
		return;
	}
	if ( function_exists( 'openstation_is_classic_request' ) && openstation_is_classic_request() ) {
		return;
	}

	wp_enqueue_script( 'openstation-electron-adapter' );
	wp_add_inline_script(
		'openstation-electron-adapter',
		'window.openStationElectronConfig = ' . wp_json_encode( openstation_electron_config() ) . ';',
		'before'
	);

	if ( function_exists( 'openstation_is_solo_request' ) && openstation_is_solo_request() ) {
		wp_enqueue_style( 'openstation-electron-solo' );
	}
}
add_action( 'admin_enqueue_scripts', 'openstation_electron_enqueue', 20 );
