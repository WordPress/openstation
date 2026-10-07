<?php

defined( 'ABSPATH' ) || exit;

const OPENSTATION_NETWORK_KEYPAIR_OPTION = 'openstation_network_keypair';

const OPENSTATION_NETWORK_REQUEST_SKEW = 300;

function openstation_network_option_get( $key, $default = false ) {
	return is_multisite() ? get_network_option( null, $key, $default ) : get_option( $key, $default );
}

function openstation_network_option_set( $key, $value ) {
	return is_multisite() ? (bool) update_network_option( null, $key, $value ) : (bool) update_option( $key, $value, false );
}

function openstation_network_option_delete( $key ) {
	return is_multisite() ? (bool) delete_network_option( null, $key ) : (bool) delete_option( $key );
}

function openstation_network_keypair() {
	$stored = openstation_network_option_get( OPENSTATION_NETWORK_KEYPAIR_OPTION );
	if ( is_array( $stored ) && ! empty( $stored['public'] ) && ! empty( $stored['secret'] ) ) {
		return $stored;
	}
	$pair   = sodium_crypto_sign_keypair();
	$stored = array(
		'public'  => sodium_bin2base64( sodium_crypto_sign_publickey( $pair ), SODIUM_BASE64_VARIANT_ORIGINAL ),
		'secret'  => sodium_bin2base64( sodium_crypto_sign_secretkey( $pair ), SODIUM_BASE64_VARIANT_ORIGINAL ),
		'created' => time(),
	);
	openstation_network_option_set( OPENSTATION_NETWORK_KEYPAIR_OPTION, $stored );
	return $stored;
}

function openstation_network_public_key() {
	$pair = openstation_network_keypair();
	return (string) $pair['public'];
}

function openstation_network_is_public_key( $key ) {
	if ( ! is_string( $key ) || '' === $key ) {
		return false;
	}
	try {
		$bin = sodium_base642bin( $key, SODIUM_BASE64_VARIANT_ORIGINAL );
	} catch ( SodiumException $e ) {
		return false;
	}
	return SODIUM_CRYPTO_SIGN_PUBLICKEYBYTES === strlen( $bin );
}

function openstation_network_sign( $message ) {
	$pair   = openstation_network_keypair();
	$secret = sodium_base642bin( (string) $pair['secret'], SODIUM_BASE64_VARIANT_ORIGINAL );
	return sodium_bin2base64( sodium_crypto_sign_detached( (string) $message, $secret ), SODIUM_BASE64_VARIANT_ORIGINAL );
}

function openstation_network_verify( $message, $signature, $public_key ) {
	if ( ! is_string( $signature ) || ! openstation_network_is_public_key( $public_key ) ) {
		return false;
	}
	try {
		$sig = sodium_base642bin( $signature, SODIUM_BASE64_VARIANT_ORIGINAL );
		$key = sodium_base642bin( $public_key, SODIUM_BASE64_VARIANT_ORIGINAL );
		if ( SODIUM_CRYPTO_SIGN_BYTES !== strlen( $sig ) ) {
			return false;
		}
		return sodium_crypto_sign_verify_detached( $sig, (string) $message, $key );
	} catch ( SodiumException $e ) {
		return false;
	}
}

function openstation_network_request_message( $method, $route, $timestamp ) {
	return strtoupper( (string) $method ) . "\n" . (string) $route . "\n" . (int) $timestamp;
}

function openstation_network_signed_headers( $method, $route ) {
	$timestamp = time();
	return array(
		'X-OpenStation-Key'       => openstation_network_public_key(),
		'X-OpenStation-Timestamp' => (string) $timestamp,
		'X-OpenStation-Signature' => openstation_network_sign( openstation_network_request_message( $method, $route, $timestamp ) ),
	);
}

function openstation_network_request_signer( WP_REST_Request $request ) {
	$key       = (string) $request->get_header( 'X-OpenStation-Key' );
	$timestamp = (int) $request->get_header( 'X-OpenStation-Timestamp' );
	$signature = (string) $request->get_header( 'X-OpenStation-Signature' );
	if ( '' === $key || '' === $signature || 0 === $timestamp ) {
		return '';
	}
	if ( abs( time() - $timestamp ) > OPENSTATION_NETWORK_REQUEST_SKEW ) {
		return '';
	}
	$message = openstation_network_request_message( $request->get_method(), $request->get_route(), $timestamp );
	return openstation_network_verify( $message, $signature, $key ) ? $key : '';
}
