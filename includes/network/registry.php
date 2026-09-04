<?php
/**
 * OpenStation — Network registry: the installs that belong with this
 * one, as this one sees them.
 *
 * WordPress has one notion of a site in a network, a row it serves
 * itself. A member of an OpenStation network lives elsewhere, so it is
 * kept here instead: its URL, its name, its shell screen, and the public
 * key pinned when it was added. Pinned, not refreshed: a key that later
 * differs is flagged and refused, never silently accepted, because a
 * changed key is either a reinstall the admin should confirm or someone
 * else answering at that address.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/** The registry option: members keyed by id. */
const OPENSTATION_NETWORK_MEMBERS_OPTION = 'openstation_network_members';

/**
 * A member's id: derived from its canonical URL, so the same install
 * cannot be added twice under two spellings.
 *
 * @param string $url The install's URL.
 * @return string
 */
function openstation_network_member_id( $url ) {
	$parts = wp_parse_url( strtolower( trim( (string) $url ) ) );
	$host  = isset( $parts['host'] ) ? $parts['host'] : '';
	$port  = isset( $parts['port'] ) ? ':' . $parts['port'] : '';
	$path  = isset( $parts['path'] ) ? untrailingslashit( $parts['path'] ) : '';
	return substr( md5( $host . $port . $path ), 0, 12 );
}

/**
 * Whether a URL names this very install (the hub adding itself).
 *
 * @param string $url URL.
 * @return bool
 */
function openstation_network_url_is_self( $url ) {
	$self = is_multisite() ? network_home_url( '/' ) : home_url( '/' );
	return openstation_network_member_id( $url ) === openstation_network_member_id( $self );
}

/**
 * Every member, keyed by id, in the order added. Entries missing what a
 * member needs are dropped on read.
 *
 * @return array<string,array<string,mixed>>
 */
function openstation_network_members() {
	$stored  = openstation_network_option_get( OPENSTATION_NETWORK_MEMBERS_OPTION, array() );
	$members = array();
	if ( ! is_array( $stored ) ) {
		return $members;
	}
	foreach ( $stored as $member ) {
		if ( ! is_array( $member ) || empty( $member['id'] ) || empty( $member['url'] ) || empty( $member['publicKey'] ) ) {
			continue;
		}
		$members[ (string) $member['id'] ] = array(
			'id'        => (string) $member['id'],
			'url'       => (string) $member['url'],
			'name'      => isset( $member['name'] ) ? (string) $member['name'] : (string) $member['url'],
			'shellUrl'  => isset( $member['shellUrl'] ) ? (string) $member['shellUrl'] : '',
			'publicKey' => (string) $member['publicKey'],
			'status'    => isset( $member['status'] ) ? (string) $member['status'] : 'paired',
			'error'     => isset( $member['error'] ) ? (string) $member['error'] : '',
			'added'     => isset( $member['added'] ) ? (int) $member['added'] : 0,
			'checked'   => isset( $member['checked'] ) ? (int) $member['checked'] : 0,
		);
	}
	return $members;
}

/**
 * Persist the registry.
 *
 * @param array<string,array<string,mixed>> $members Members keyed by id.
 * @return bool
 */
function openstation_network_save_members( array $members ) {
	return openstation_network_option_set( OPENSTATION_NETWORK_MEMBERS_OPTION, array_values( $members ) );
}

/**
 * Add an install to the network: fetch its identity, pin its key.
 *
 * @param string $url The install's URL, as typed.
 * @return array<string,mixed>|WP_Error The member, or why not.
 */
function openstation_network_add_member( $url ) {
	$url = esc_url_raw( trim( (string) $url ) );
	if ( '' === $url || ! wp_parse_url( $url, PHP_URL_HOST ) ) {
		return new WP_Error( 'openstation_network_bad_url', __( 'Enter the site\'s address, starting with https://.', 'desktop-mode' ) );
	}
	if ( openstation_network_url_is_self( $url ) ) {
		return new WP_Error( 'openstation_network_self', __( 'That is this network itself.', 'desktop-mode' ) );
	}
	$identity = openstation_network_fetch_identity( $url );
	if ( is_wp_error( $identity ) ) {
		return $identity;
	}
	if ( $identity['multisite'] ) {
		return new WP_Error( 'openstation_network_is_network', __( 'That site is a network of its own; a network cannot join another yet.', 'desktop-mode' ) );
	}
	$members = openstation_network_members();
	$id      = openstation_network_member_id( $identity['url'] );
	if ( isset( $members[ $id ] ) ) {
		return new WP_Error( 'openstation_network_exists', __( 'That site is already in the network.', 'desktop-mode' ) );
	}
	$members[ $id ] = array(
		'id'        => $id,
		'url'       => $identity['url'],
		'name'      => $identity['name'],
		'shellUrl'  => $identity['shellUrl'],
		'publicKey' => $identity['publicKey'],
		'status'    => 'paired',
		'error'     => '',
		'added'     => time(),
		'checked'   => time(),
	);
	openstation_network_save_members( $members );
	return $members[ $id ];
}

/**
 * Remove a member.
 *
 * @param string $id Member id.
 * @return bool Whether there was one to remove.
 */
function openstation_network_remove_member( $id ) {
	$members = openstation_network_members();
	if ( ! isset( $members[ $id ] ) ) {
		return false;
	}
	unset( $members[ $id ] );
	openstation_network_save_members( $members );
	return true;
}

/**
 * Re-check one member against its live identity: the name and shell
 * follow it, the key is only compared. Unreachable and key-changed are
 * recorded as statuses the registry shows, not as removals.
 *
 * @param string $id Member id.
 * @return array<string,mixed>|null The member as re-checked, or null when unknown.
 */
function openstation_network_check_member( $id ) {
	$members = openstation_network_members();
	if ( ! isset( $members[ $id ] ) ) {
		return null;
	}
	$member   = $members[ $id ];
	$identity = openstation_network_fetch_identity( $member['url'] );
	if ( is_wp_error( $identity ) ) {
		$member['status'] = 'unreachable';
		$member['error']  = $identity->get_error_message();
	} elseif ( $identity['publicKey'] !== $member['publicKey'] ) {
		$member['status'] = 'key-changed';
		$member['error']  = __( 'The site now publishes a different key. Remove it and add it again if that is expected.', 'desktop-mode' );
	} else {
		$member['status']   = 'paired';
		$member['error']    = '';
		$member['name']     = $identity['name'];
		$member['shellUrl'] = $identity['shellUrl'];
	}
	$member['checked'] = time();
	$members[ $id ]    = $member;
	openstation_network_save_members( $members );
	return $member;
}

/**
 * Re-check every member.
 *
 * @return array<string,array<string,mixed>>
 */
function openstation_network_check_members() {
	foreach ( array_keys( openstation_network_members() ) as $id ) {
		openstation_network_check_member( $id );
	}
	return openstation_network_members();
}

/**
 * The member whose pinned key is this one, or null. Only the pinned key
 * counts: a member whose key changed still signs with the old one until
 * an admin re-pairs it, and nothing signed with the new one is trusted.
 *
 * @param string $public_key Base64 public key.
 * @return array<string,mixed>|null
 */
function openstation_network_member_by_key( $public_key ) {
	if ( '' === (string) $public_key ) {
		return null;
	}
	foreach ( openstation_network_members() as $member ) {
		if ( hash_equals( $member['publicKey'], (string) $public_key ) ) {
			return $member;
		}
	}
	return null;
}
