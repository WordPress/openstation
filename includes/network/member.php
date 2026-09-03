<?php
/**
 * OpenStation — A member of a network: the hub it belongs to, and the
 * network's list as last fetched, which is what its switcher shows.
 *
 * Joining is one URL: the member fetches the hub's identity, pins its
 * key, then asks for the list with a signed request. The hub answers
 * only once the member has been added there, so the two steps can
 * happen in either order; until the hub knows this site, the member
 * shows it is waiting. The list is cached and refreshed in the
 * background when older than an hour, never on the request that
 * paints the shell.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/** The hub this install belongs to, with the list as last fetched. */
const OPENSTATION_NETWORK_HUB_OPTION = 'openstation_network_hub';

/** How old a cached list may be before a refresh is scheduled. */
const OPENSTATION_NETWORK_LIST_TTL = HOUR_IN_SECONDS;

/** The cron hook that refreshes the list. */
const OPENSTATION_NETWORK_REFRESH_HOOK = 'openstation_network_refresh_list';

/**
 * The hub this install belongs to, or null.
 *
 * @return array<string,mixed>|null `url`, `name`, `shellUrl`, `publicKey`, `joined`, `list`, `fetched`, `error`.
 */
function openstation_network_hub() {
	$hub = openstation_network_option_get( OPENSTATION_NETWORK_HUB_OPTION );
	if ( ! is_array( $hub ) || empty( $hub['url'] ) || empty( $hub['publicKey'] ) ) {
		return null;
	}
	return array(
		'url'       => (string) $hub['url'],
		'name'      => isset( $hub['name'] ) ? (string) $hub['name'] : (string) $hub['url'],
		'shellUrl'  => isset( $hub['shellUrl'] ) ? (string) $hub['shellUrl'] : '',
		'publicKey' => (string) $hub['publicKey'],
		'joined'    => isset( $hub['joined'] ) ? (int) $hub['joined'] : 0,
		'list'      => isset( $hub['list'] ) && is_array( $hub['list'] ) ? $hub['list'] : null,
		'fetched'   => isset( $hub['fetched'] ) ? (int) $hub['fetched'] : 0,
		'error'     => isset( $hub['error'] ) ? (string) $hub['error'] : '',
	);
}

/**
 * Whether this install belongs to a network.
 *
 * @return bool
 */
function openstation_network_is_member() {
	return null !== openstation_network_hub();
}

/**
 * Join a network: pin the hub, then ask it for the list.
 *
 * @param string $url The hub's URL, as typed.
 * @return array<string,mixed>|WP_Error The hub as stored, or why not.
 */
function openstation_network_join( $url ) {
	if ( is_multisite() ) {
		return new WP_Error( 'openstation_network_is_network', __( 'A network cannot join another network yet.', 'desktop-mode' ) );
	}
	$url = esc_url_raw( trim( (string) $url ) );
	if ( '' === $url || ! wp_parse_url( $url, PHP_URL_HOST ) ) {
		return new WP_Error( 'openstation_network_bad_url', __( 'Enter the network\'s address, starting with https://.', 'desktop-mode' ) );
	}
	if ( openstation_network_url_is_self( $url ) ) {
		return new WP_Error( 'openstation_network_self', __( 'That is this site itself.', 'desktop-mode' ) );
	}
	$identity = openstation_network_fetch_identity( $url );
	if ( is_wp_error( $identity ) ) {
		return $identity;
	}
	openstation_network_option_set(
		OPENSTATION_NETWORK_HUB_OPTION,
		array(
			'url'       => $identity['url'],
			'name'      => $identity['name'],
			'shellUrl'  => $identity['shellUrl'],
			'publicKey' => $identity['publicKey'],
			'joined'    => time(),
			'list'      => null,
			'fetched'   => 0,
			'error'     => '',
		)
	);
	openstation_network_refresh_list();
	return openstation_network_hub();
}

/**
 * Leave the network: forget the hub and its list.
 *
 * @return bool
 */
function openstation_network_leave() {
	wp_clear_scheduled_hook( OPENSTATION_NETWORK_REFRESH_HOOK );
	return openstation_network_option_delete( OPENSTATION_NETWORK_HUB_OPTION );
}

/**
 * Fetch the list from the hub with a signed request and cache it. A
 * failure is recorded on the hub entry, so the app can say why, and
 * the last good list stays in place.
 *
 * @return array<string,mixed>|WP_Error The list, or the error.
 */
function openstation_network_refresh_list() {
	$hub = openstation_network_hub();
	if ( null === $hub ) {
		return new WP_Error( 'openstation_network_no_hub', __( 'This site does not belong to a network.', 'desktop-mode' ) );
	}
	$route = '/desktop-mode/v1/network';
	$list  = openstation_network_remote_get( $hub['url'], $route, openstation_network_signed_headers( 'GET', $route ) );
	if ( ! is_wp_error( $list ) && ( empty( $list['sites'] ) || ! is_array( $list['sites'] ) ) ) {
		$list = new WP_Error( 'openstation_network_bad_list', __( 'The network answered without a site list.', 'desktop-mode' ) );
	}
	$stored = openstation_network_option_get( OPENSTATION_NETWORK_HUB_OPTION );
	if ( ! is_array( $stored ) ) {
		$stored = array();
	}
	if ( is_wp_error( $list ) ) {
		$stored['error'] = $list->get_error_message();
		openstation_network_option_set( OPENSTATION_NETWORK_HUB_OPTION, $stored );
		return $list;
	}
	$sites = array();
	foreach ( $list['sites'] as $site ) {
		if ( ! is_array( $site ) || empty( $site['id'] ) || empty( $site['shellUrl'] ) ) {
			continue;
		}
		$sites[] = array(
			'id'        => (string) $site['id'],
			'name'      => isset( $site['name'] ) ? sanitize_text_field( (string) $site['name'] ) : (string) $site['id'],
			'shellUrl'  => esc_url_raw( (string) $site['shellUrl'] ),
			'url'       => isset( $site['url'] ) ? esc_url_raw( (string) $site['url'] ) : '',
			'publicKey' => isset( $site['publicKey'] ) && openstation_network_is_public_key( $site['publicKey'] ) ? (string) $site['publicKey'] : '',
			'kind'      => isset( $site['kind'] ) && 'member' === $site['kind'] ? 'member' : 'local',
		);
	}
	$admin = null;
	if ( ! empty( $list['networkAdmin'] ) && is_array( $list['networkAdmin'] ) && ! empty( $list['networkAdmin']['shellUrl'] ) ) {
		$rows = array();
		if ( ! empty( $list['networkAdmin']['rows'] ) && is_array( $list['networkAdmin']['rows'] ) ) {
			foreach ( $list['networkAdmin']['rows'] as $row ) {
				if ( is_array( $row ) && ! empty( $row['title'] ) && ! empty( $row['url'] ) ) {
					$rows[] = array(
						'title' => sanitize_text_field( (string) $row['title'] ),
						'url'   => esc_url_raw( (string) $row['url'] ),
					);
				}
			}
		}
		$admin = array(
			'url'      => isset( $list['networkAdmin']['url'] ) ? esc_url_raw( (string) $list['networkAdmin']['url'] ) : '',
			'shellUrl' => esc_url_raw( (string) $list['networkAdmin']['shellUrl'] ),
			'rows'     => $rows,
		);
	}
	$stored['list']    = array(
		'name'         => isset( $list['name'] ) ? sanitize_text_field( (string) $list['name'] ) : $hub['name'],
		'networkAdmin' => $admin,
		'sites'        => $sites,
	);
	$stored['name']    = $stored['list']['name'];
	$stored['fetched'] = time();
	$stored['error']   = '';
	openstation_network_option_set( OPENSTATION_NETWORK_HUB_OPTION, $stored );
	return $stored['list'];
}
add_action( OPENSTATION_NETWORK_REFRESH_HOOK, 'openstation_network_refresh_list' );

/**
 * Schedule a background refresh when the cached list is stale. Never
 * fetches on the request that paints the shell.
 */
function openstation_network_schedule_refresh() {
	$hub = openstation_network_hub();
	if ( null === $hub || time() - $hub['fetched'] < OPENSTATION_NETWORK_LIST_TTL ) {
		return;
	}
	if ( ! wp_next_scheduled( OPENSTATION_NETWORK_REFRESH_HOOK ) ) {
		wp_schedule_single_event( time(), OPENSTATION_NETWORK_REFRESH_HOOK );
	}
}

/**
 * The multisite block a member's shell boots with, built from the
 * cached list: the network's sites, this site current, the hub's
 * Network Admin for administrators. Null when this site is not a
 * member or has no list yet.
 *
 * @return array<string,mixed>|null
 */
function openstation_network_member_payload() {
	$hub = openstation_network_hub();
	if ( null === $hub || null === $hub['list'] ) {
		return null;
	}
	openstation_network_schedule_refresh();

	$me      = openstation_network_public_key();
	$current = '';
	$sites   = array();
	foreach ( $hub['list']['sites'] as $site ) {
		if ( '' !== $site['publicKey'] && hash_equals( $site['publicKey'], $me ) ) {
			$current = $site['id'];
		}
		$sites[] = array(
			'id'       => $site['id'],
			'name'     => $site['name'],
			'shellUrl' => $site['shellUrl'],
		);
	}
	if ( '' === $current ) {
		// Listed by the hub or not, this site is where the user stands.
		$current = 'member:self';
		$sites[] = array(
			'id'       => $current,
			'name'     => (string) get_bloginfo( 'name' ),
			'shellUrl' => esc_url_raw( admin_url( 'admin.php?page=' . OPENSTATION_SHELL_PAGE_SLUG ) ),
		);
	}
	$admin = $hub['list']['networkAdmin'];
	return array(
		'isNetworkAdmin' => false,
		'networkAdmin'   => ( $admin && current_user_can( 'manage_options' ) ) ? $admin : null,
		'current'        => $current,
		'sites'          => $sites,
	);
}
