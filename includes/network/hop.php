<?php
/**
 * OpenStation — The hop token: login on arrival across installs.
 *
 * A switch to a site on another origin is a navigation, and the browser
 * carries no login across origins. So the origin install vouches for
 * the user in the one channel the browser cannot block, the URL: a
 * token it signs with its own key, carrying who the user is (their
 * email) and where the token may be spent (the target's origin), for
 * sixty seconds and once. The target verifies the signature against
 * the key it pinned for that issuer when the two were paired, logs in
 * the local user with that email if nobody is logged in there, and
 * redirects to the clean shell URL before Core's `auth_redirect()` ever
 * runs. The token grants nothing beyond an account the target already
 * holds: an unknown email lands on the login screen as before, and a
 * browser logged in as someone else is left alone.
 *
 * Same origin needs none of this and never mints one. See
 * docs/network.md.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/** How long a minted token may be spent, in seconds. */
const OPENSTATION_NETWORK_HOP_TTL = 60;

/** Clock skew tolerated between two installs, in seconds. */
const OPENSTATION_NETWORK_HOP_SKEW = 60;

/** The token's query arg on the target's shell screen. */
const OPENSTATION_NETWORK_HOP_ARG = 'openstation_hop';

/** The slide direction the target lands with, after the token is spent. */
const OPENSTATION_NETWORK_HOP_FROM_ARG = 'openstation_hop_from';

/**
 * URL-safe base64, no padding.
 *
 * @param string $bin Bytes.
 * @return string
 */
function openstation_network_hop_encode( $bin ) {
	return sodium_bin2base64( (string) $bin, SODIUM_BASE64_VARIANT_URLSAFE_NO_PADDING );
}

/**
 * The inverse of {@see openstation_network_hop_encode()}, or null.
 *
 * @param string $text Encoded.
 * @return string|null
 */
function openstation_network_hop_decode( $text ) {
	try {
		return sodium_base642bin( (string) $text, SODIUM_BASE64_VARIANT_URLSAFE_NO_PADDING );
	} catch ( SodiumException $e ) {
		return null;
	}
}

/**
 * The origin (scheme, host, port) of a URL, lowercased, or ''.
 *
 * @param string $url URL.
 * @return string
 */
function openstation_network_origin( $url ) {
	$parts = wp_parse_url( (string) $url );
	if ( ! is_array( $parts ) || empty( $parts['scheme'] ) || empty( $parts['host'] ) ) {
		return '';
	}
	$origin = strtolower( $parts['scheme'] . '://' . $parts['host'] );
	if ( ! empty( $parts['port'] ) ) {
		$origin .= ':' . (int) $parts['port'];
	}
	return $origin;
}

/**
 * The shell URLs a token may be minted for: every entry of this
 * shell's switcher, and the network admin's shell. Nothing else — a
 * token is a login credential, and it is issued only towards a place
 * the switcher itself offers.
 *
 * @return string[]
 */
function openstation_network_hop_targets() {
	$block = openstation_multisite_payload();
	if ( ! is_array( $block ) ) {
		return array();
	}
	$targets = array();
	foreach ( (array) $block['sites'] as $site ) {
		if ( ! empty( $site['shellUrl'] ) ) {
			$targets[] = (string) $site['shellUrl'];
		}
	}
	if ( ! empty( $block['networkAdmin']['shellUrl'] ) ) {
		$targets[] = (string) $block['networkAdmin']['shellUrl'];
	}
	return $targets;
}

/**
 * Mint a token for the current user towards a target shell.
 *
 * @param string $target    The target's shell URL, as the switcher carries it.
 * @param string $direction `next`, `prev`, or ''.
 * @return array{token:string,url:string}|WP_Error
 */
function openstation_network_mint_hop( $target, $direction = '' ) {
	$target = (string) $target;
	if ( ! in_array( $target, openstation_network_hop_targets(), true ) ) {
		return new WP_Error( 'openstation_hop_target', __( 'That is not a site of this network.', 'desktop-mode' ), array( 'status' => 400 ) );
	}
	$aud = openstation_network_origin( $target );
	if ( '' === $aud || openstation_network_origin( admin_url() ) === $aud ) {
		return new WP_Error( 'openstation_hop_same_origin', __( 'A site on this origin needs no token.', 'desktop-mode' ), array( 'status' => 400 ) );
	}
	if ( ! openstation_network_url_allowed( $target ) ) {
		return new WP_Error( 'openstation_hop_insecure', __( 'A login token only travels over HTTPS.', 'desktop-mode' ), array( 'status' => 400 ) );
	}
	$user = wp_get_current_user();
	if ( ! $user || ! $user->exists() || '' === (string) $user->user_email ) {
		return new WP_Error( 'openstation_hop_no_user', __( 'A token needs a logged-in user with an email address.', 'desktop-mode' ), array( 'status' => 401 ) );
	}
	$now     = time();
	$payload = array(
		'v'    => 1,
		'iss'  => openstation_network_identity()['url'],
		'aud'  => $aud,
		'sub'  => (string) $user->user_email,
		'name' => (string) $user->display_name,
		'dir'  => in_array( $direction, array( 'next', 'prev' ), true ) ? $direction : '',
		'iat'  => $now,
		'exp'  => $now + OPENSTATION_NETWORK_HOP_TTL,
		'jti'  => bin2hex( random_bytes( 16 ) ),
	);
	$json    = wp_json_encode( $payload );
	$token   = openstation_network_hop_encode( $json ) . '.' . openstation_network_hop_encode(
		sodium_crypto_sign_detached( $json, sodium_base642bin( openstation_network_keypair()['secret'], SODIUM_BASE64_VARIANT_ORIGINAL ) )
	);
	return array(
		'token' => $token,
		'url'   => add_query_arg(
			array(
				OPENSTATION_SHELL_OVERVIEW_ARG => '1',
				OPENSTATION_NETWORK_HOP_ARG    => $token,
			),
			$target
		),
	);
}

/**
 * The key this install pinned for an issuer: its own, its hub's, or a
 * member's — by the issuer's identity URL. '' when the issuer is nobody
 * this install trusts.
 *
 * @param string $iss Issuer identity URL.
 * @return string Base64 public key, or ''.
 */
function openstation_network_hop_issuer_key( $iss ) {
	$id = openstation_network_member_id( $iss );
	if ( openstation_network_member_id( openstation_network_identity()['url'] ) === $id ) {
		return openstation_network_public_key();
	}
	foreach ( openstation_network_members() as $member ) {
		if ( openstation_network_member_id( $member['url'] ) === $id ) {
			return $member['publicKey'];
		}
	}
	$hub = openstation_network_hub();
	if ( null !== $hub ) {
		if ( openstation_network_member_id( $hub['url'] ) === $id ) {
			return $hub['publicKey'];
		}
		if ( null !== $hub['list'] ) {
			foreach ( $hub['list']['sites'] as $site ) {
				if ( 'member' === $site['kind'] && '' !== $site['publicKey'] && '' !== $site['url'] && openstation_network_member_id( $site['url'] ) === $id ) {
					return $site['publicKey'];
				}
			}
		}
	}
	return '';
}

/**
 * Verify a token spent on this install: signature by a trusted issuer,
 * audience, lifetime, and never before. Consumes the token.
 *
 * @param string $token The token.
 * @return array<string,mixed>|WP_Error The payload, or why not.
 */
function openstation_network_verify_hop( $token ) {
	$parts = explode( '.', (string) $token, 2 );
	$json  = 2 === count( $parts ) ? openstation_network_hop_decode( $parts[0] ) : null;
	$sig   = 2 === count( $parts ) ? openstation_network_hop_decode( $parts[1] ) : null;
	$data  = null !== $json ? json_decode( $json, true ) : null;
	if ( null === $sig || ! is_array( $data ) || 1 !== ( isset( $data['v'] ) ? (int) $data['v'] : 0 ) ) {
		return new WP_Error( 'openstation_hop_malformed', __( 'That is not a hop token.', 'desktop-mode' ) );
	}
	foreach ( array( 'iss', 'aud', 'sub', 'jti' ) as $key ) {
		if ( empty( $data[ $key ] ) || ! is_string( $data[ $key ] ) ) {
			return new WP_Error( 'openstation_hop_malformed', __( 'That is not a hop token.', 'desktop-mode' ) );
		}
	}
	$now = time();
	$iat = isset( $data['iat'] ) ? (int) $data['iat'] : 0;
	$exp = isset( $data['exp'] ) ? (int) $data['exp'] : 0;
	if ( $exp <= 0 || $now > $exp + OPENSTATION_NETWORK_HOP_SKEW || $iat > $now + OPENSTATION_NETWORK_HOP_SKEW ) {
		return new WP_Error( 'openstation_hop_expired', __( 'That hop token has expired.', 'desktop-mode' ) );
	}
	if ( openstation_network_origin( admin_url() ) !== $data['aud'] ) {
		return new WP_Error( 'openstation_hop_audience', __( 'That hop token was minted for another site.', 'desktop-mode' ) );
	}
	$key = openstation_network_hop_issuer_key( $data['iss'] );
	if ( '' === $key ) {
		return new WP_Error( 'openstation_hop_issuer', __( 'That hop token comes from a site this one does not trust.', 'desktop-mode' ) );
	}
	if ( ! openstation_network_verify( $json, sodium_bin2base64( $sig, SODIUM_BASE64_VARIANT_ORIGINAL ), $key ) ) {
		return new WP_Error( 'openstation_hop_signature', __( 'That hop token is not signed by the site it names.', 'desktop-mode' ) );
	}
	$seen = 'openstation_hop_' . md5( $data['jti'] );
	if ( false !== get_transient( $seen ) ) {
		return new WP_Error( 'openstation_hop_replay', __( 'That hop token was already spent.', 'desktop-mode' ) );
	}
	set_transient( $seen, 1, OPENSTATION_NETWORK_HOP_TTL + 2 * OPENSTATION_NETWORK_HOP_SKEW );
	return $data;
}

/**
 * The local user a verified token names, matched by email. Existing
 * users only: a URL never creates an account.
 *
 * @param array<string,mixed> $payload Verified payload.
 * @return WP_User|null
 */
function openstation_network_hop_user( array $payload ) {
	$user = get_user_by( 'email', (string) $payload['sub'] );
	return $user instanceof WP_User ? $user : null;
}

/**
 * Where the target lands after the token is spent: this request's URL
 * without the token, with the slide direction the token carried.
 *
 * @param string $direction `next`, `prev`, or ''.
 * @return string
 */
function openstation_network_hop_landing( $direction = '' ) {
	$args = array( OPENSTATION_NETWORK_HOP_ARG => false );
	if ( in_array( $direction, array( 'next', 'prev' ), true ) ) {
		$args[ OPENSTATION_NETWORK_HOP_FROM_ARG ] = $direction;
	}
	return add_query_arg( $args );
}

/**
 * Spend a token on the shell screen: log the user in if nobody is, and
 * move on to the clean URL. On `init`, which in wp-admin runs before
 * `auth_redirect()` gets a chance to send an anonymous request to the
 * login screen. A token that fails is dropped the same way, silently:
 * the user lands where they would have without it.
 */
function openstation_network_redeem_hop() {
	// phpcs:disable WordPress.Security.NonceVerification.Recommended -- The token IS the credential; every other arg is read-only routing.
	if ( ! is_admin() || empty( $_GET[ OPENSTATION_NETWORK_HOP_ARG ] ) || ! is_scalar( $_GET[ OPENSTATION_NETWORK_HOP_ARG ] ) ) {
		return;
	}
	$pagenow = isset( $GLOBALS['pagenow'] ) ? (string) $GLOBALS['pagenow'] : '';
	$page    = isset( $_GET['page'] ) && is_scalar( $_GET['page'] ) ? sanitize_key( wp_unslash( $_GET['page'] ) ) : '';
	if ( 'admin.php' !== $pagenow || OPENSTATION_SHELL_PAGE_SLUG !== $page ) {
		return;
	}
	$token = sanitize_text_field( wp_unslash( $_GET[ OPENSTATION_NETWORK_HOP_ARG ] ) );
	// phpcs:enable WordPress.Security.NonceVerification.Recommended

	$payload   = openstation_network_verify_hop( $token );
	$direction = '';
	if ( ! is_wp_error( $payload ) ) {
		$direction = isset( $payload['dir'] ) ? (string) $payload['dir'] : '';
		$user      = openstation_network_hop_user( $payload );
		if ( $user && ! is_user_logged_in() ) {
			wp_set_auth_cookie( $user->ID, false );
		}
	}
	wp_safe_redirect( openstation_network_hop_landing( $direction ) );
	exit;
}
add_action( 'init', 'openstation_network_redeem_hop', 5 );

/**
 * Register the mint route.
 */
function openstation_network_register_hop_route() {
	register_rest_route(
		'desktop-mode/v1',
		'/network/hop',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'callback'            => 'openstation_rest_network_hop',
			'permission_callback' => 'openstation_rest_require_enabled',
			'args'                => array(
				'target'    => array(
					'required' => true,
					'type'     => 'string',
				),
				'direction' => array(
					'type'    => 'string',
					'enum'    => array( 'next', 'prev', '' ),
					'default' => '',
				),
			),
		)
	);
}
add_action( 'rest_api_init', 'openstation_network_register_hop_route' );

/**
 * POST /desktop-mode/v1/network/hop
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response|WP_Error
 */
function openstation_rest_network_hop( WP_REST_Request $request ) {
	$minted = openstation_network_mint_hop( (string) $request->get_param( 'target' ), (string) $request->get_param( 'direction' ) );
	return is_wp_error( $minted ) ? $minted : rest_ensure_response( $minted );
}
