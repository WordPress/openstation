<?php

defined( 'ABSPATH' ) || exit;

const OPENSTATION_FAVICON_MAX_BYTES = 256 * 1024;

const OPENSTATION_FAVICON_MAX_PAGE_BYTES = 1024 * 1024;

const OPENSTATION_FAVICON_TIMEOUT = 4;

function openstation_resolve_favicon( $page_url ) {
	$result = openstation_resolve_favicon_internal( (string) $page_url );

	$filtered = apply_filters( 'openstation_resolve_favicon', $result, (string) $page_url );

	if ( null === $filtered ) {
		return null;
	}
	return is_string( $filtered ) ? $filtered : null;
}

function openstation_resolve_favicon_internal( $page_url ) {
	$parts = wp_parse_url( $page_url );
	if ( ! is_array( $parts ) || empty( $parts['host'] ) ) {
		return null;
	}
	$scheme = isset( $parts['scheme'] ) ? strtolower( $parts['scheme'] ) : '';
	if ( 'http' !== $scheme && 'https' !== $scheme ) {
		return null;
	}

	$page_response = wp_safe_remote_get( $page_url, openstation_favicon_request_args( OPENSTATION_FAVICON_MAX_PAGE_BYTES ) );
	$page_body     = '';
	if ( ! is_wp_error( $page_response ) && 200 === (int) wp_remote_retrieve_response_code( $page_response ) ) {
		$page_body = (string) wp_remote_retrieve_body( $page_response );
	}

	$candidate_url = '' !== $page_body
		? openstation_favicon_extract_link_href( $page_body, $page_url )
		: '';
	if ( '' === $candidate_url ) {
		$candidate_url = $scheme . '://' . $parts['host'] . ( isset( $parts['port'] ) ? ':' . $parts['port'] : '' ) . '/favicon.ico';
	}

	return openstation_favicon_fetch_as_data_uri( $candidate_url );
}

function openstation_favicon_request_args( $limit_response_size = OPENSTATION_FAVICON_MAX_BYTES + 1 ) {
	return array(
		'timeout'             => OPENSTATION_FAVICON_TIMEOUT,
		'redirection'         => 3,
		'user-agent'          => 'WP OpenStation favicon resolver/1.0',
		'limit_response_size' => (int) $limit_response_size,
		'headers'             => array(
			'Accept' => 'text/html,application/xhtml+xml,image/*;q=0.9,*/*;q=0.5',
		),
	);
}

function openstation_favicon_extract_link_href( $html, $base_url ) {
	$dom         = new DOMDocument();
	$prev_errors = libxml_use_internal_errors( true );

	$dom->loadHTML( '<?xml encoding="UTF-8">' . $html, LIBXML_NOWARNING | LIBXML_NOERROR );
	libxml_clear_errors();
	libxml_use_internal_errors( $prev_errors );

	$links = $dom->getElementsByTagName( 'link' );
	if ( ! $links ) {
		return '';
	}

	$buckets = array(
		'icon'             => '',
		'shortcut icon'    => '',
		'apple-touch-icon' => '',
	);

	foreach ( $links as $link ) {
		if ( ! ( $link instanceof DOMElement ) ) {
			continue;
		}
		$rel  = strtolower( trim( (string) $link->getAttribute( 'rel' ) ) );
		$href = trim( (string) $link->getAttribute( 'href' ) );
		if ( '' === $rel || '' === $href ) {
			continue;
		}

		foreach ( $buckets as $key => $existing ) {
			if ( '' !== $existing ) {
				continue;
			}
			if ( $rel === $key || in_array( $key, preg_split( '/\s+/', $rel ), true ) ) {
				$buckets[ $key ] = $href;
				break;
			}
		}
	}

	foreach ( $buckets as $href ) {
		if ( '' === $href ) {
			continue;
		}
		$absolute = openstation_favicon_absolutize_url( $href, $base_url );
		if ( '' !== $absolute ) {
			return $absolute;
		}
	}
	return '';
}

function openstation_favicon_absolutize_url( $href, $base_url ) {
	$href = trim( $href );
	if ( '' === $href ) {
		return '';
	}
	if ( 0 === strpos( $href, 'data:' ) ) {

		return '';
	}

	if ( preg_match( '#^https?://#i', $href ) ) {
		return $href;
	}
	$base = wp_parse_url( $base_url );
	if ( ! is_array( $base ) || empty( $base['scheme'] ) || empty( $base['host'] ) ) {
		return '';
	}
	$origin = $base['scheme'] . '://' . $base['host'] . ( isset( $base['port'] ) ? ':' . $base['port'] : '' );

	if ( 0 === strpos( $href, '//' ) ) {
		return $base['scheme'] . ':' . $href;
	}

	if ( 0 === strpos( $href, '/' ) ) {
		return $origin . $href;
	}

	$path = isset( $base['path'] ) ? $base['path'] : '/';
	$dir  = '/' === substr( $path, -1 ) ? $path : ( '' === dirname( $path ) || '.' === dirname( $path ) ? '/' : dirname( $path ) . '/' );
	return $origin . $dir . $href;
}

function openstation_favicon_fetch_as_data_uri( $icon_url ) {
	if ( '' === $icon_url || ! preg_match( '#^https?://#i', $icon_url ) ) {
		return null;
	}
	$response = wp_safe_remote_get( $icon_url, openstation_favicon_request_args() );
	if ( is_wp_error( $response ) ) {
		return null;
	}
	if ( 200 !== (int) wp_remote_retrieve_response_code( $response ) ) {
		return null;
	}
	$content_type = strtolower( (string) wp_remote_retrieve_header( $response, 'content-type' ) );

	$content_type = trim( explode( ';', $content_type )[0] );
	if ( 0 !== strpos( $content_type, 'image/' ) ) {
		return null;
	}
	$body = (string) wp_remote_retrieve_body( $response );
	if ( '' === $body || strlen( $body ) > OPENSTATION_FAVICON_MAX_BYTES ) {
		return null;
	}
	$subtype = openstation_favicon_subtype_from_content_type( $content_type );
	if ( null === $subtype ) {
		return null;
	}

	if ( 'svg+xml' !== $subtype ) {
		$dimensions = @getimagesizefromstring( $body );
		if ( false === $dimensions ) {
			return null;
		}
	}
	return 'data:image/' . $subtype . ';base64,' . base64_encode( $body );
}

function openstation_favicon_subtype_from_content_type( $content_type ) {
	$map = array(
		'image/png'                => 'png',
		'image/jpeg'               => 'jpeg',
		'image/jpg'                => 'jpeg',
		'image/gif'                => 'gif',
		'image/webp'               => 'webp',
		'image/x-icon'             => 'x-icon',
		'image/vnd.microsoft.icon' => 'x-icon',
		'image/ico'                => 'x-icon',
		'image/svg+xml'            => 'svg+xml',
	);
	return isset( $map[ $content_type ] ) ? $map[ $content_type ] : null;
}
