<?php

defined( 'ABSPATH' ) || exit;

const OPENSTATION_NONCE_REFRESH_FIELD = 'desktop_mode_nonces';

const OPENSTATION_AUTH_FIELD = 'desktop_mode_auth';

function openstation_nonce_refresh_build_payload() {
	$actions = array(
		'wp_rest',
		'desktop-mode-plugins',
		'updates',
	);

	$actions = (array) apply_filters( 'openstation_nonce_refresh_actions', $actions );

	$payload = array();
	foreach ( $actions as $action ) {
		if ( ! is_string( $action ) || '' === $action ) {
			continue;
		}
		$payload[ $action ] = wp_create_nonce( $action );
	}
	return $payload;
}

function openstation_nonce_refresh_heartbeat_received( $response, $data ) {
	unset( $data );
	if ( ! is_array( $response ) ) {
		$response = array();
	}
	if ( ! function_exists( 'openstation_is_enabled' ) || ! openstation_is_enabled() ) {
		return $response;
	}
	$response[ OPENSTATION_NONCE_REFRESH_FIELD ] = openstation_nonce_refresh_build_payload();
	$response[ OPENSTATION_AUTH_FIELD ]          = array( 'uid' => get_current_user_id() );
	return $response;
}
add_filter( 'heartbeat_received', 'openstation_nonce_refresh_heartbeat_received', 5, 2 );

function openstation_nonce_refresh_on_expired( $response ) {
	if ( ! is_array( $response ) ) {
		$response = array();
	}
	if ( ! function_exists( 'openstation_is_enabled' ) || ! openstation_is_enabled() ) {
		return $response;
	}
	$response[ OPENSTATION_NONCE_REFRESH_FIELD ] = openstation_nonce_refresh_build_payload();
	$response[ OPENSTATION_AUTH_FIELD ]          = array( 'uid' => get_current_user_id() );
	return $response;
}
add_filter( 'wp_refresh_nonces', 'openstation_nonce_refresh_on_expired', 5 );
