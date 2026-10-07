<?php

defined( 'ABSPATH' ) || exit;

const OPENSTATION_NETWORK_HOP_TTL = 60;

const OPENSTATION_NETWORK_HOP_SKEW = 60;

const OPENSTATION_NETWORK_LINK_META = 'openstation_network_link';

const OPENSTATION_NETWORK_LINK_LABELS_META = 'openstation_network_link_labels';

const OPENSTATION_NETWORK_LINK_DECLINED_META = 'openstation_network_link_declined';

const OPENSTATION_NETWORK_LINK_OFFER_TTL = 10 * MINUTE_IN_SECONDS;

function openstation_network_hop_encode( $bin ) {
	return sodium_bin2base64( (string) $bin, SODIUM_BASE64_VARIANT_URLSAFE_NO_PADDING );
}

function openstation_network_hop_decode( $text ) {
	try {
		return sodium_base642bin( (string) $text, SODIUM_BASE64_VARIANT_URLSAFE_NO_PADDING );
	} catch ( SodiumException $e ) {
		return null;
	}
}

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

function openstation_network_hop_targets() {
	$targets = array();
	if ( is_multisite() || openstation_network_is_hub() ) {
		foreach ( openstation_network_members() as $member ) {
			if ( '' !== $member['shellUrl'] ) {
				$targets[ $member['shellUrl'] ] = $member['url'];
			}
		}
		return $targets;
	}
	$hub = openstation_network_hub();
	if ( null === $hub || null === $hub['list'] ) {
		return $targets;
	}
	$me = openstation_network_public_key();
	foreach ( $hub['list']['sites'] as $site ) {
		if ( '' === $site['shellUrl'] || ( '' !== $site['publicKey'] && hash_equals( $site['publicKey'], $me ) ) ) {
			continue;
		}
		$install = 'member' === $site['kind'] ? $site['url'] : $hub['url'];
		if ( '' !== $install ) {
			$targets[ $site['shellUrl'] ] = $install;
		}
	}
	if ( ! empty( $hub['list']['networkAdmin']['shellUrl'] ) ) {
		$targets[ $hub['list']['networkAdmin']['shellUrl'] ] = $hub['url'];
	}
	return $targets;
}

function openstation_network_mint_hop( $target, $direction = '' ) {
	$target  = (string) $target;
	$targets = openstation_network_hop_targets();
	if ( ! isset( $targets[ $target ] ) ) {
		return new WP_Error( 'openstation_hop_target', __( 'That is not another install of this network.', 'desktop-mode' ), array( 'status' => 400 ) );
	}
	if ( ! openstation_network_url_allowed( $target ) ) {
		return new WP_Error( 'openstation_hop_insecure', __( 'A login token only travels over HTTPS.', 'desktop-mode' ), array( 'status' => 400 ) );
	}
	$user = wp_get_current_user();
	if ( ! $user || ! $user->exists() ) {
		return new WP_Error( 'openstation_hop_no_user', __( 'A token needs a logged-in user.', 'desktop-mode' ), array( 'status' => 401 ) );
	}
	$now     = time();
	$payload = array(
		'v'     => 2,
		'iss'   => openstation_network_identity()['url'],
		'aud'   => $targets[ $target ],
		'sub'   => (string) $user->ID,
		'email' => (string) $user->user_email,
		'name'  => (string) $user->display_name,
		'dir'   => in_array( $direction, array( 'next', 'prev' ), true ) ? $direction : '',
		'iat'   => $now,
		'exp'   => $now + OPENSTATION_NETWORK_HOP_TTL,
		'jti'   => bin2hex( random_bytes( 16 ) ),
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

function openstation_network_verify_hop( $token ) {
	$parts = explode( '.', (string) $token, 2 );
	$json  = 2 === count( $parts ) ? openstation_network_hop_decode( $parts[0] ) : null;
	$sig   = 2 === count( $parts ) ? openstation_network_hop_decode( $parts[1] ) : null;
	$data  = null !== $json ? json_decode( $json, true ) : null;
	if ( null === $sig || ! is_array( $data ) || 2 !== ( isset( $data['v'] ) ? (int) $data['v'] : 0 ) ) {
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
	if ( openstation_network_member_id( $data['aud'] ) !== openstation_network_member_id( openstation_network_identity()['url'] ) ) {
		return new WP_Error( 'openstation_hop_audience', __( 'That hop token was minted for another install.', 'desktop-mode' ) );
	}
	$key = openstation_network_hop_issuer_key( $data['iss'] );
	if ( '' === $key ) {
		return new WP_Error( 'openstation_hop_issuer', __( 'That hop token comes from a site this one does not trust.', 'desktop-mode' ) );
	}
	if ( ! openstation_network_verify( $json, sodium_bin2base64( $sig, SODIUM_BASE64_VARIANT_ORIGINAL ), $key ) ) {
		return new WP_Error( 'openstation_hop_signature', __( 'That hop token is not signed by the site it names.', 'desktop-mode' ) );
	}
	if ( ! openstation_network_hop_claim( $data['jti'], $exp ) ) {
		return new WP_Error( 'openstation_hop_replay', __( 'That hop token was already spent.', 'desktop-mode' ) );
	}
	return $data;
}

function openstation_network_hop_claim( $jti, $exp ) {
	global $wpdb;
	$dead = time() - OPENSTATION_NETWORK_HOP_SKEW;

	$wpdb->query(
		$wpdb->prepare(
			"DELETE FROM {$wpdb->base_prefix}options WHERE option_name LIKE %s AND option_value < %d",
			$wpdb->esc_like( 'openstation_hop_' ) . '%',
			$dead
		)
	);
	$won = $wpdb->query(
		$wpdb->prepare(
			"INSERT IGNORE INTO {$wpdb->base_prefix}options (option_name, option_value, autoload) VALUES (%s, %s, 'off')",
			'openstation_hop_' . md5( (string) $jti ),
			(string) (int) $exp
		)
	);

	return 1 === (int) $won;
}

function openstation_network_link_key( $iss, $sub ) {
	return openstation_network_member_id( $iss ) . '|' . (string) $sub;
}

function openstation_network_hop_user( array $payload ) {
	$ids = get_users(
		array(
			'meta_key'   => OPENSTATION_NETWORK_LINK_META,
			'meta_value' => openstation_network_link_key( (string) $payload['iss'], (string) $payload['sub'] ),
			'number'     => 1,
			'fields'     => 'ID',
			'blog_id'    => 0,
		)
	);
	$user = $ids ? get_user_by( 'id', (int) $ids[0] ) : false;
	return $user instanceof WP_User ? $user : null;
}

function openstation_network_issuer_name( $iss ) {
	$id = openstation_network_member_id( $iss );
	foreach ( openstation_network_members() as $member ) {
		if ( openstation_network_member_id( $member['url'] ) === $id ) {
			return $member['name'];
		}
	}
	$hub = openstation_network_hub();
	if ( null !== $hub ) {
		if ( openstation_network_member_id( $hub['url'] ) === $id ) {
			return $hub['name'];
		}
		foreach ( null !== $hub['list'] ? $hub['list']['sites'] : array() as $site ) {
			if ( '' !== $site['url'] && openstation_network_member_id( $site['url'] ) === $id ) {
				return $site['name'];
			}
		}
	}
	return (string) wp_parse_url( $iss, PHP_URL_HOST );
}

function openstation_network_link( $user_id, array $offer ) {
	$key = openstation_network_link_key( (string) $offer['iss'], (string) $offer['sub'] );
	if ( in_array( $key, openstation_network_links( $user_id ), true ) ) {
		return false;
	}
	add_user_meta( $user_id, OPENSTATION_NETWORK_LINK_META, $key );
	$labels         = get_user_meta( $user_id, OPENSTATION_NETWORK_LINK_LABELS_META, true );
	$labels         = is_array( $labels ) ? $labels : array();
	$labels[ $key ] = array(
		'site'  => (string) $offer['site'],
		'name'  => (string) $offer['name'],
		'email' => (string) $offer['email'],
	);
	update_user_meta( $user_id, OPENSTATION_NETWORK_LINK_LABELS_META, $labels );
	return true;
}

function openstation_network_links( $user_id ) {
	$rows = get_user_meta( $user_id, OPENSTATION_NETWORK_LINK_META );
	return array_values( array_filter( array_map( 'strval', is_array( $rows ) ? $rows : array() ) ) );
}

function openstation_network_linked_accounts( $user_id ) {
	$labels = get_user_meta( $user_id, OPENSTATION_NETWORK_LINK_LABELS_META, true );
	$labels = is_array( $labels ) ? $labels : array();
	$out    = array();
	foreach ( openstation_network_links( $user_id ) as $key ) {
		$label       = isset( $labels[ $key ] ) && is_array( $labels[ $key ] ) ? $labels[ $key ] : array();
		$out[ $key ] = array(
			'site'  => isset( $label['site'] ) ? (string) $label['site'] : '',
			'name'  => isset( $label['name'] ) ? openstation_plain_text_title( $label['name'] ) : '',
			'email' => isset( $label['email'] ) ? (string) $label['email'] : '',
		);
	}
	return $out;
}

function openstation_network_unlink( $user_id, $key ) {
	if ( ! in_array( (string) $key, openstation_network_links( $user_id ), true ) ) {
		return false;
	}
	delete_user_meta( $user_id, OPENSTATION_NETWORK_LINK_META, (string) $key );
	$labels = get_user_meta( $user_id, OPENSTATION_NETWORK_LINK_LABELS_META, true );
	if ( is_array( $labels ) ) {
		unset( $labels[ (string) $key ] );
		update_user_meta( $user_id, OPENSTATION_NETWORK_LINK_LABELS_META, $labels );
	}
	return true;
}

function openstation_network_offer_link( $user_id, array $payload ) {
	$key      = openstation_network_link_key( (string) $payload['iss'], (string) $payload['sub'] );
	$declined = get_user_meta( $user_id, OPENSTATION_NETWORK_LINK_DECLINED_META, true );
	if ( is_array( $declined ) && in_array( $key, $declined, true ) ) {
		return;
	}
	set_transient(
		'openstation_hop_offer_' . (int) $user_id,
		array(
			'iss'   => (string) $payload['iss'],
			'sub'   => (string) $payload['sub'],
			'name'  => isset( $payload['name'] ) ? sanitize_text_field( (string) $payload['name'] ) : '',
			'email' => isset( $payload['email'] ) ? sanitize_email( (string) $payload['email'] ) : '',
			'site'  => openstation_network_issuer_name( (string) $payload['iss'] ),
		),
		OPENSTATION_NETWORK_LINK_OFFER_TTL
	);
}

function openstation_network_link_offer() {
	if ( ! is_user_logged_in() ) {
		return null;
	}
	$offer = get_transient( 'openstation_hop_offer_' . get_current_user_id() );
	if ( ! is_array( $offer ) || empty( $offer['iss'] ) || empty( $offer['sub'] ) ) {
		return null;
	}
	return array(
		'site'  => (string) $offer['site'],
		'name'  => openstation_plain_text_title( $offer['name'] ),
		'email' => (string) $offer['email'],
		'url'   => esc_url_raw( rest_url( 'desktop-mode/v1/network/link' ) ),
	);
}

function openstation_network_answer_link( $user_id, $accept ) {
	$name  = 'openstation_hop_offer_' . (int) $user_id;
	$offer = get_transient( $name );
	if ( ! is_array( $offer ) || empty( $offer['iss'] ) || empty( $offer['sub'] ) ) {
		return new WP_Error( 'openstation_hop_no_offer', __( 'There is nothing to link right now.', 'desktop-mode' ), array( 'status' => 404 ) );
	}
	delete_transient( $name );
	if ( $accept ) {
		openstation_network_link( $user_id, $offer );
		return array( 'linked' => true );
	}
	$declined   = get_user_meta( $user_id, OPENSTATION_NETWORK_LINK_DECLINED_META, true );
	$declined   = is_array( $declined ) ? $declined : array();
	$declined[] = openstation_network_link_key( (string) $offer['iss'], (string) $offer['sub'] );
	update_user_meta( $user_id, OPENSTATION_NETWORK_LINK_DECLINED_META, array_values( array_unique( $declined ) ) );
	return array( 'linked' => false );
}

function openstation_network_hop_landing( $direction = '' ) {

	$args = array(
		OPENSTATION_NETWORK_HOP_ARG      => false,
		OPENSTATION_NETWORK_HOP_FROM_ARG => false,
	);
	if ( in_array( $direction, array( 'next', 'prev' ), true ) ) {
		$args[ OPENSTATION_NETWORK_HOP_FROM_ARG ] = $direction;
	}
	return add_query_arg( $args );
}

function openstation_network_redeem_hop() {

	if ( ! is_admin() || empty( $_GET[ OPENSTATION_NETWORK_HOP_ARG ] ) || ! is_scalar( $_GET[ OPENSTATION_NETWORK_HOP_ARG ] ) ) {
		return;
	}
	$pagenow = isset( $GLOBALS['pagenow'] ) ? (string) $GLOBALS['pagenow'] : '';
	$page    = isset( $_GET['page'] ) && is_scalar( $_GET['page'] ) ? sanitize_key( wp_unslash( $_GET['page'] ) ) : '';
	if ( 'admin.php' !== $pagenow || OPENSTATION_SHELL_PAGE_SLUG !== $page ) {
		return;
	}
	$token = sanitize_text_field( wp_unslash( $_GET[ OPENSTATION_NETWORK_HOP_ARG ] ) );

	$payload   = openstation_network_verify_hop( $token );
	$direction = '';
	if ( ! is_wp_error( $payload ) ) {
		$direction = isset( $payload['dir'] ) ? (string) $payload['dir'] : '';
		$linked    = openstation_network_hop_user( $payload );
		if ( $linked && ! is_user_logged_in() ) {
			wp_set_auth_cookie( $linked->ID, false );
		} elseif ( ! $linked && is_user_logged_in() ) {
			openstation_network_offer_link( get_current_user_id(), $payload );
		}
	}
	wp_safe_redirect( openstation_network_hop_landing( $direction ) );
	exit;
}
add_action( 'init', 'openstation_network_redeem_hop', 5 );

function openstation_network_register_hop_route() {
	register_rest_route(
		'desktop-mode/v1',
		'/network/link',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'callback'            => 'openstation_rest_network_link',
			'permission_callback' => 'openstation_rest_require_enabled',
			'args'                => array(
				'accept' => array(
					'required' => true,
					'type'     => 'boolean',
				),
			),
		)
	);
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

function openstation_rest_network_hop( WP_REST_Request $request ) {
	$minted = openstation_network_mint_hop( (string) $request->get_param( 'target' ), (string) $request->get_param( 'direction' ) );
	return is_wp_error( $minted ) ? $minted : rest_ensure_response( $minted );
}

function openstation_rest_network_link( WP_REST_Request $request ) {
	$answer = openstation_network_answer_link( get_current_user_id(), (bool) $request->get_param( 'accept' ) );
	return is_wp_error( $answer ) ? $answer : rest_ensure_response( $answer );
}
