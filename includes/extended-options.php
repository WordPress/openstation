<?php

defined( 'ABSPATH' ) || exit;

const OPENSTATION_EXTENDED_OPTIONS_KEY = 'desktop_mode_extended_options';

function openstation_get_extended_options() {
	$defaults = array(
		'media_library_enhanced' => true,
		'window_prewarm'         => true,
		'admin_asset_cache'      => true,
		'games'                  => false,
		'agents'                 => false,
		'network'                => false,
	);
	$raw      = get_option( OPENSTATION_EXTENDED_OPTIONS_KEY, array() );
	if ( ! is_array( $raw ) ) {
		return $defaults;
	}

	$clean = array();
	foreach ( $defaults as $key => $default ) {
		$clean[ $key ] = array_key_exists( $key, $raw )
			? (bool) $raw[ $key ]
			: $default;
	}
	return $clean;
}

function openstation_save_extended_options( $raw ) {
	if ( ! is_array( $raw ) ) {
		return false;
	}

	$clean = openstation_get_extended_options();
	foreach ( $clean as $key => $current ) {
		if ( array_key_exists( $key, $raw ) ) {
			$clean[ $key ] = ! empty( $raw[ $key ] );
		}
	}
	return update_option( OPENSTATION_EXTENDED_OPTIONS_KEY, $clean, false );
}

function openstation_register_extended_options_rest_routes() {
	register_rest_route(
		'desktop-mode/v1',
		'/extended-options',
		array(
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => 'openstation_rest_get_extended_options',
				'permission_callback' => 'openstation_rest_extended_options_permission',
			),
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => 'openstation_rest_save_extended_options',
				'permission_callback' => 'openstation_rest_extended_options_permission',
				'args'                => array(
					'options' => array(
						'required' => true,
						'type'     => 'object',
					),
				),
			),
		)
	);
}
add_action( 'rest_api_init', 'openstation_register_extended_options_rest_routes' );

function openstation_rest_extended_options_permission() {
	if ( ! is_user_logged_in() || ! current_user_can( 'manage_options' ) ) {
		return new WP_Error(
			'openstation_extended_forbidden',
			'Only administrators can manage extended options.',
			array( 'status' => 403 )
		);
	}
	return true;
}

function openstation_rest_get_extended_options() {
	return rest_ensure_response( openstation_get_extended_options() );
}

function openstation_rest_save_extended_options( WP_REST_Request $request ) {
	$payload = $request->get_param( 'options' );
	openstation_save_extended_options( $payload );
	return rest_ensure_response( openstation_get_extended_options() );
}

function openstation_enqueue_media_library_enhancement() {
	if ( ! is_admin() || ! is_user_logged_in() ) {
		return;
	}

	$options = openstation_get_extended_options();
	if ( empty( $options['media_library_enhanced'] ) ) {
		return;
	}

	wp_enqueue_script(
		'os-media-library-enhanced',
		OPENSTATION_URL . 'assets/js/media-library-enhanced.js',
		array(),
		OPENSTATION_VERSION,
		true
	);
}
add_action( 'admin_enqueue_scripts', 'openstation_enqueue_media_library_enhancement', 20 );
