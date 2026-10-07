<?php

defined( 'ABSPATH' ) || exit;

function openstation_network_identity() {
	$screen = 'admin.php?page=' . OPENSTATION_SHELL_PAGE_SLUG;
	if ( is_multisite() ) {
		$network = get_network();
		return array(
			'url'       => esc_url_raw( network_home_url( '/' ) ),
			'name'      => (string) ( $network ? $network->site_name : get_bloginfo( 'name' ) ),
			'shellUrl'  => esc_url_raw( network_admin_url( $screen ) ),
			'publicKey' => openstation_network_public_key(),
			'multisite' => true,
		);
	}
	return array(
		'url'       => esc_url_raw( home_url( '/' ) ),
		'name'      => (string) get_bloginfo( 'name' ),
		'shellUrl'  => esc_url_raw( admin_url( $screen ) ),
		'publicKey' => openstation_network_public_key(),
		'multisite' => false,
	);
}

function openstation_network_url_allowed( $url ) {
	$scheme = wp_parse_url( (string) $url, PHP_URL_SCHEME );
	if ( 'https' === $scheme ) {
		return true;
	}
	return 'http' === $scheme && in_array( wp_get_environment_type(), array( 'local', 'development' ), true );
}

function openstation_network_remote_get( $base, $route, array $headers = array() ) {
	$base = untrailingslashit( (string) $base );
	if ( ! openstation_network_url_allowed( $base ) ) {
		return new WP_Error( 'openstation_network_insecure', __( 'Sites in a network talk over HTTPS.', 'desktop-mode' ) );
	}
	$url = $base . '/wp-json' . $route;

	$url = (string) apply_filters( 'openstation_network_request_url', $url, $base );

	$response = wp_remote_get(
		$url,
		array(
			'timeout'     => 8,

			'redirection' => 0,
			'headers'     => array_merge( array( 'Accept' => 'application/json' ), $headers ),
		)
	);
	if ( is_wp_error( $response ) ) {
		return $response;
	}
	$code = (int) wp_remote_retrieve_response_code( $response );
	$body = json_decode( (string) wp_remote_retrieve_body( $response ), true );
	if ( 200 !== $code || ! is_array( $body ) ) {
		$message = is_array( $body ) && ! empty( $body['message'] ) ? (string) $body['message'] : '';
		return new WP_Error(
			'openstation_network_http_' . $code,
			'' !== $message
				? $message

				: sprintf( __( 'The site answered with HTTP %d.', 'desktop-mode' ), $code )
		);
	}
	return $body;
}

function openstation_network_fetch_identity( $url ) {
	$identity = openstation_network_remote_get( $url, '/desktop-mode/v1/network/identity' );
	if ( is_wp_error( $identity ) ) {
		return $identity;
	}
	foreach ( array( 'url', 'name', 'shellUrl', 'publicKey' ) as $key ) {
		if ( empty( $identity[ $key ] ) || ! is_string( $identity[ $key ] ) ) {
			return new WP_Error( 'openstation_network_no_identity', __( 'That site does not run OpenStation, or its network identity is unreachable.', 'desktop-mode' ) );
		}
	}
	if ( ! openstation_network_is_public_key( $identity['publicKey'] ) ) {
		return new WP_Error( 'openstation_network_bad_key', __( 'That site published a public key OpenStation cannot use.', 'desktop-mode' ) );
	}
	return array(
		'url'       => esc_url_raw( $identity['url'] ),
		'name'      => sanitize_text_field( $identity['name'] ),
		'shellUrl'  => esc_url_raw( $identity['shellUrl'] ),
		'publicKey' => $identity['publicKey'],
		'multisite' => ! empty( $identity['multisite'] ),
	);
}

function openstation_network_register_identity_route() {
	register_rest_route(
		'desktop-mode/v1',
		'/network/identity',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => 'openstation_rest_network_identity',
			'permission_callback' => '__return_true',
		)
	);
}
add_action( 'rest_api_init', 'openstation_network_register_identity_route' );

function openstation_rest_network_identity() {
	return rest_ensure_response( openstation_network_identity() );
}
