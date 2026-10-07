<?php

defined( 'ABSPATH' ) || exit;

const OPENSTATION_DEFAULT_WINDOW_META = 'desktop_mode_default_window';

function openstation_get_default_window( $user_id = 0 ) {
	$user_id      = $user_id ? (int) $user_id : get_current_user_id();
	$fallback_url = admin_url( 'index.php' );
	$default      = array(
		'enabled' => true,
		'url'     => $fallback_url,
	);

	if ( ! $user_id ) {
		return $default;
	}

	$raw = get_user_meta( $user_id, OPENSTATION_DEFAULT_WINDOW_META, true );
	if ( ! is_array( $raw ) ) {
		return $default;
	}

	$enabled = ! empty( $raw['enabled'] );
	$url     = isset( $raw['url'] ) && is_string( $raw['url'] ) ? $raw['url'] : $fallback_url;
	if ( '' === $url ) {
		$url = $fallback_url;
	}

	return array(
		'enabled' => $enabled,
		'url'     => $url,
	);
}

function openstation_set_default_window( $user_id, $url ) {
	$user_id = (int) $user_id;
	if ( $user_id <= 0 ) {
		return false;
	}

	if ( null === $url ) {
		update_user_meta(
			$user_id,
			OPENSTATION_DEFAULT_WINDOW_META,
			array(
				'enabled' => false,
				'url'     => admin_url( 'index.php' ),
			)
		);
		return true;
	}

	$clean = openstation_validate_default_window_url( $url );
	if ( '' === $clean ) {
		return false;
	}

	update_user_meta(
		$user_id,
		OPENSTATION_DEFAULT_WINDOW_META,
		array(
			'enabled' => true,
			'url'     => $clean,
		)
	);
	return true;
}

function openstation_validate_default_window_url( $url ) {
	$url = trim( (string) $url );
	if ( '' === $url ) {
		return '';
	}

	if ( 0 === strpos( $url, 'native:' ) ) {
		$slug = substr( $url, strlen( 'native:' ) );
		if ( '' === $slug || ! preg_match( '/^[a-z0-9_\-]+$/i', $slug ) ) {
			return '';
		}
		return 'native:' . $slug;
	}

	$parsed = wp_parse_url( $url );
	if ( ! is_array( $parsed ) || empty( $parsed['path'] ) ) {
		return '';
	}

	$home_origin = wp_parse_url( home_url( '/' ) );
	$url_host    = isset( $parsed['host'] ) ? strtolower( $parsed['host'] ) : '';
	$url_scheme  = isset( $parsed['scheme'] ) ? strtolower( $parsed['scheme'] ) : '';
	$home_host   = is_array( $home_origin ) && isset( $home_origin['host'] ) ? strtolower( $home_origin['host'] ) : '';
	$home_scheme = is_array( $home_origin ) && isset( $home_origin['scheme'] ) ? strtolower( $home_origin['scheme'] ) : '';

	if ( '' !== $url_host && $url_host !== $home_host ) {
		return '';
	}
	if ( '' !== $url_scheme && ! in_array( $url_scheme, array( 'http', 'https' ), true ) ) {
		return '';
	}

	$admin_path = wp_parse_url( admin_url(), PHP_URL_PATH );
	if ( ! is_string( $admin_path ) ) {
		return '';
	}
	if ( 0 !== strpos( $parsed['path'], $admin_path ) ) {
		return '';
	}

	$query = isset( $parsed['query'] ) ? '?' . $parsed['query'] : '';
	return esc_url_raw( home_url( $parsed['path'] . $query ), array( $home_scheme ? $home_scheme : 'https', 'http', 'https' ) );
}

function openstation_register_default_window_routes() {
	register_rest_route(
		'desktop-mode/v1',
		'/default-window',
		array(
			'methods'             => 'POST',
			'callback'            => 'openstation_rest_set_default_window',

			'permission_callback' => 'openstation_rest_require_enabled',

			'args'                => array(
				'url' => array(
					'description' => __( 'Admin URL to open on portal entry, or null to disable.', 'desktop-mode' ),
				),
			),
		)
	);
}
add_action( 'rest_api_init', 'openstation_register_default_window_routes' );

function openstation_rest_set_default_window( $request ) {
	$user_id = get_current_user_id();
	$params  = $request->get_json_params();

	$has_url = is_array( $params ) && array_key_exists( 'url', $params );
	$url     = $has_url ? $params['url'] : null;

	if ( null === $url || '' === $url ) {
		openstation_set_default_window( $user_id, null );
		return rest_ensure_response( openstation_get_default_window( $user_id ) );
	}

	if ( ! is_string( $url ) ) {
		return new WP_Error(
			'openstation_invalid_url',
			__( 'The `url` parameter must be a string or null.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}

	$ok = openstation_set_default_window( $user_id, $url );
	if ( ! $ok ) {
		return new WP_Error(
			'openstation_invalid_url',
			__( 'The URL is not a valid same-origin wp-admin URL.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}

	return rest_ensure_response( openstation_get_default_window( $user_id ) );
}
