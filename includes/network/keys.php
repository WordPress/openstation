<?php
/**
 * OpenStation — Network identity: one Ed25519 keypair per install.
 *
 * On a network of separate installs nothing is shared: no database, no
 * users, no salts. What one install can do is sign, and what another
 * can do is verify a signature against a public key it pinned when the
 * two were paired. Every install therefore owns one keypair, generated
 * on first use and kept in an option (a network option on a multisite,
 * where every site is the same install). The public half is published
 * on `GET /desktop-mode/v1/network/identity`; the secret half never
 * leaves the database.
 *
 * Two things are signed with it: a member's requests to its hub (a
 * timestamped line, so the hub knows which member is asking) and, in
 * the hop token, the identity handed to another install. Both sides
 * verify with `sodium_crypto_sign_verify_detached()`, which WordPress
 * guarantees through its bundled sodium polyfill.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/** Where the keypair lives: a network option on a multisite, a site option elsewhere. */
const OPENSTATION_NETWORK_KEYPAIR_OPTION = 'openstation_network_keypair';

/** How far a signed request's timestamp may drift from the receiver's clock, in seconds. */
const OPENSTATION_NETWORK_REQUEST_SKEW = 300;

/**
 * Read an install-wide option: the network's on a multisite, the site's
 * elsewhere. Network identity belongs to the install, not to a site.
 *
 * @param string $key     Option name.
 * @param mixed  $default Value when unset.
 * @return mixed
 */
function openstation_network_option_get( $key, $default = false ) {
	return is_multisite() ? get_network_option( null, $key, $default ) : get_option( $key, $default );
}

/**
 * Write an install-wide option. See {@see openstation_network_option_get()}.
 *
 * @param string $key   Option name.
 * @param mixed  $value Value.
 * @return bool
 */
function openstation_network_option_set( $key, $value ) {
	return is_multisite() ? (bool) update_network_option( null, $key, $value ) : (bool) update_option( $key, $value, false );
}

/**
 * Delete an install-wide option. See {@see openstation_network_option_get()}.
 *
 * @param string $key Option name.
 * @return bool
 */
function openstation_network_option_delete( $key ) {
	return is_multisite() ? (bool) delete_network_option( null, $key ) : (bool) delete_option( $key );
}

/**
 * This install's keypair, generated on first use.
 *
 * @return array{public:string,secret:string,created:int} Base64 keys.
 */
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

/**
 * This install's public key, base64.
 *
 * @return string
 */
function openstation_network_public_key() {
	$pair = openstation_network_keypair();
	return (string) $pair['public'];
}

/**
 * Whether a string is a well-formed base64 Ed25519 public key.
 *
 * @param mixed $key Candidate.
 * @return bool
 */
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

/**
 * Sign a message with this install's secret key.
 *
 * @param string $message Message.
 * @return string Base64 detached signature.
 */
function openstation_network_sign( $message ) {
	$pair   = openstation_network_keypair();
	$secret = sodium_base642bin( (string) $pair['secret'], SODIUM_BASE64_VARIANT_ORIGINAL );
	return sodium_bin2base64( sodium_crypto_sign_detached( (string) $message, $secret ), SODIUM_BASE64_VARIANT_ORIGINAL );
}

/**
 * Verify a detached signature against a public key. Malformed input of
 * any kind is a failed verification, never an exception.
 *
 * @param string $message    Message.
 * @param string $signature  Base64 signature.
 * @param string $public_key Base64 public key.
 * @return bool
 */
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

/**
 * The line a signed request signs: method, REST route, timestamp. The
 * route rather than the full URL, because the URL an install reaches
 * another by is not always the URL that install knows itself by
 * (a proxy, an internal hostname, a container).
 *
 * @param string $method    HTTP method.
 * @param string $route     REST route, `/desktop-mode/v1/network`.
 * @param int    $timestamp Unix time.
 * @return string
 */
function openstation_network_request_message( $method, $route, $timestamp ) {
	return strtoupper( (string) $method ) . "\n" . (string) $route . "\n" . (int) $timestamp;
}

/**
 * Headers that sign an outgoing request with this install's key.
 *
 * @param string $method HTTP method.
 * @param string $route  REST route.
 * @return array<string,string>
 */
function openstation_network_signed_headers( $method, $route ) {
	$timestamp = time();
	return array(
		'X-OpenStation-Key'       => openstation_network_public_key(),
		'X-OpenStation-Timestamp' => (string) $timestamp,
		'X-OpenStation-Signature' => openstation_network_sign( openstation_network_request_message( $method, $route, $timestamp ) ),
	);
}

/**
 * The public key that signed an incoming REST request, or '' when the
 * request is unsigned, stale, or its signature does not verify.
 *
 * Only says WHO signed; whether that key is trusted is the caller's
 * question (the hub answers it from its registry).
 *
 * @param WP_REST_Request $request Request.
 * @return string Base64 public key, or ''.
 */
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
