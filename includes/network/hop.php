<?php
/**
 * OpenStation — The hop token: login on arrival across installs.
 *
 * A switch to another install is a navigation, and the browser carries
 * no login across installs. So the install the user leaves vouches for
 * them in the one channel the browser cannot block, the URL: a token it
 * signs with its own key, carrying who the user is there (their user
 * id, which they cannot edit) and which install the token is for, for
 * sixty seconds and once. The target verifies the signature against
 * the key it pinned for that issuer when the two were paired, and logs
 * in the local account that user has LINKED to, if nobody is logged in
 * there.
 *
 * The link is the whole point. An email is not proof of anything: on
 * the issuing install a user can set their own email to whatever they
 * like, an administrator's on the target included, so a token can only
 * ever name a source account, never claim a target one. A target
 * account is claimed once, by the person who holds it: arriving with a
 * token while logged in on the target offers to link the two, and the
 * accept is a nonced request from that logged-in session. From then on
 * a token from that source account logs that target account in. The
 * link is a row of user meta the target owns and can undo in the
 * Network window.
 *
 * A site of the same install needs none of this and never mints one;
 * a separate install on the same origin does, since it shares nothing
 * but a hostname. See docs/network.md.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/** How long a minted token may be spent, in seconds. */
const OPENSTATION_NETWORK_HOP_TTL = 60;

/** Clock skew tolerated between two installs, in seconds. */
const OPENSTATION_NETWORK_HOP_SKEW = 60;

/** User meta, one row per linked source account: `<issuer id>|<source user id>`. */
const OPENSTATION_NETWORK_LINK_META = 'openstation_network_link';

/** User meta: the labels of those links, keyed the same way, for the window that lists them. */
const OPENSTATION_NETWORK_LINK_LABELS_META = 'openstation_network_link_labels';

/** User meta: link keys the user declined, so they are not asked again. */
const OPENSTATION_NETWORK_LINK_DECLINED_META = 'openstation_network_link_declined';

/** How long an offer to link waits for the user's answer, in seconds. */
const OPENSTATION_NETWORK_LINK_OFFER_TTL = 10 * MINUTE_IN_SECONDS;

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
 * The shells a token may be minted for, keyed by shell URL, each with
 * the identity URL of the install it belongs to (the token's audience).
 * Only entries of OTHER installs: a token is a login credential, and a
 * site of this very install shares its login already. Nothing beyond
 * what the switcher offers, either. On a hub those are its members; on
 * a member, the hub's sites, the hub's network admin and the other
 * members, everything but itself.
 *
 * Origin is not the line: two installs at `example.test/a/` and
 * `example.test/b/` share a hostname and nothing else, so what makes
 * an entry foreign is the install behind it, never its origin.
 *
 * @return array<string,string>
 */
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

/**
 * Mint a token for the current user towards a target shell.
 *
 * @param string $target    The target's shell URL, as the switcher carries it.
 * @param string $direction `next`, `prev`, or ''.
 * @return array{token:string,url:string}|WP_Error
 */
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

/**
 * Claim a token's id, once, install-wide. An INSERT IGNORE into the
 * main site's options table: its unique key on `option_name` is the one
 * atomic primitive every WordPress install has, so two requests racing
 * on the same token cannot both win, and on a multisite every site
 * shares that one table, where a per-site transient would let each
 * site of the origin spend the same token once more. Ids no token
 * could still carry are swept on the way; a row nothing reads back
 * needs no cache.
 *
 * @param string $jti Token id.
 * @param int    $exp The token's expiry, kept so the sweep knows when the row is dead.
 * @return bool Whether this request claimed it.
 */
function openstation_network_hop_claim( $jti, $exp ) {
	global $wpdb;
	$dead = time() - OPENSTATION_NETWORK_HOP_SKEW;
	// phpcs:disable WordPress.DB.DirectDatabaseQuery -- The unique key IS the check; there is no option cache to keep in step for rows nothing reads.
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
	// phpcs:enable WordPress.DB.DirectDatabaseQuery
	return 1 === (int) $won;
}

/**
 * The key a source account is linked under: the issuer's id (the same
 * one the registry derives from its URL) and the user's id there.
 *
 * @param string $iss Issuer identity URL.
 * @param string $sub The user's id on the issuer.
 * @return string
 */
function openstation_network_link_key( $iss, $sub ) {
	return openstation_network_member_id( $iss ) . '|' . (string) $sub;
}

/**
 * The local user a verified token logs in: the one who linked that
 * source account to theirs, and nobody else. Never an email match — an
 * email is editable on the issuer, so it proves nothing about who
 * holds an account here.
 *
 * @param array<string,mixed> $payload Verified payload.
 * @return WP_User|null
 */
function openstation_network_hop_user( array $payload ) {
	$ids = get_users(
		array(
			'meta_key'   => OPENSTATION_NETWORK_LINK_META, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key -- One exact row per link; this IS the index.
			'meta_value' => openstation_network_link_key( (string) $payload['iss'], (string) $payload['sub'] ), // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_value
			'number'     => 1,
			'fields'     => 'ID',
			'blog_id'    => 0,
		)
	);
	$user = $ids ? get_user_by( 'id', (int) $ids[0] ) : false;
	return $user instanceof WP_User ? $user : null;
}

/**
 * The name this install knows an issuer by: its hub, a member, a site
 * of the list, or the issuer's host when it is none of those.
 *
 * @param string $iss Issuer identity URL.
 * @return string
 */
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

/**
 * Link a source account to a local user, so a token from it logs that
 * user in. The caller has established that the person holds both: they
 * arrived with the token while logged in here, and accepted from that
 * session.
 *
 * @param int                 $user_id Local user.
 * @param array<string,mixed> $offer   `iss`, `sub`, `name`, `email`, `site`.
 * @return bool Whether a link was added (false when it already was).
 */
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

/**
 * The keys of a user's linked source accounts.
 *
 * @param int $user_id Local user.
 * @return string[]
 */
function openstation_network_links( $user_id ) {
	$rows = get_user_meta( $user_id, OPENSTATION_NETWORK_LINK_META );
	return array_values( array_filter( array_map( 'strval', is_array( $rows ) ? $rows : array() ) ) );
}

/**
 * A user's linked source accounts as the Network window lists them.
 *
 * @param int $user_id Local user.
 * @return array<string,array{site:string,name:string,email:string}> Keyed by link key.
 */
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

/**
 * Undo a link.
 *
 * @param int    $user_id Local user.
 * @param string $key     Link key.
 * @return bool Whether there was one.
 */
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

/**
 * Offer a logged-in user the link a token could not use yet: kept for
 * a few minutes, for the shell to ask about and the link route to act
 * on. Not offered again once declined.
 *
 * @param int                 $user_id The user logged in here.
 * @param array<string,mixed> $payload Verified payload.
 */
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

/**
 * The offer waiting for the current user, as the shell config carries
 * it: what to show, and where to answer. Null when there is none.
 *
 * @return array{site:string,name:string,email:string,url:string}|null
 */
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

/**
 * Answer the offer: link, or decline for good. The nonced request from
 * the logged-in session is the proof the link needs.
 *
 * @param int  $user_id The user answering.
 * @param bool $accept  Yes or no.
 * @return array{linked:bool}|WP_Error
 */
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

/**
 * Where the target lands after the token is spent: this request's URL
 * without the token, with the slide direction the token carried.
 *
 * @param string $direction `next`, `prev`, or ''.
 * @return string
 */
function openstation_network_hop_landing( $direction = '' ) {
	// The direction on the landing URL is the token's, never the
	// request's: a caller-supplied one goes with the token.
	$args = array(
		OPENSTATION_NETWORK_HOP_ARG      => false,
		OPENSTATION_NETWORK_HOP_FROM_ARG => false,
	);
	if ( in_array( $direction, array( 'next', 'prev' ), true ) ) {
		$args[ OPENSTATION_NETWORK_HOP_FROM_ARG ] = $direction;
	}
	return add_query_arg( $args );
}

/**
 * Spend a token on the shell screen: log in the user who linked that
 * source account, if nobody is logged in; offer the link to whoever is
 * logged in when there is none yet; and move on to the clean URL. On
 * `init`, which in wp-admin runs before `auth_redirect()` gets a chance
 * to send an anonymous request to the login screen. A token that fails
 * is dropped the same way, silently: the user lands where they would
 * have without it.
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

/**
 * Register the mint and link routes.
 */
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

/**
 * POST /desktop-mode/v1/network/link — answer the offer waiting for
 * the current user.
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response|WP_Error
 */
function openstation_rest_network_link( WP_REST_Request $request ) {
	$answer = openstation_network_answer_link( get_current_user_id(), (bool) $request->get_param( 'accept' ) );
	return is_wp_error( $answer ) ? $answer : rest_ensure_response( $answer );
}
