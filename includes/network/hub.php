<?php
/**
 * OpenStation — The hub: the network as one list, served to its
 * members.
 *
 * `GET /desktop-mode/v1/network` is what a member fetches to show the
 * same switcher the hub's own sites show: the network's name and key,
 * its Network Admin, every local site and every member. A member asks
 * with a signed request (`openstation_network_signed_headers()`), and
 * only a pinned key is answered; a logged-in network administrator may
 * read it too.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * The switcher entries for the registry's members.
 *
 * @return array<int,array<string,mixed>> Each `id` (`member:<id>`), `name`, `shellUrl`, `url`, `publicKey`, `kind`, `status`.
 */
function openstation_network_member_entries() {
	$entries = array();
	foreach ( openstation_network_members() as $member ) {
		$entries[] = array(
			'id'        => 'member:' . $member['id'],
			'name'      => $member['name'],
			'shellUrl'  => $member['shellUrl'],
			'url'       => $member['url'],
			'publicKey' => $member['publicKey'],
			'kind'      => 'member',
			'status'    => $member['status'],
		);
	}
	return $entries;
}

/**
 * The hub's own sites as switcher entries: every site of the network
 * on a multisite (by path, capped as the super admin's row is), or the
 * one site of a single-site hub.
 *
 * @return array<int,array<string,mixed>>
 */
function openstation_network_local_entries() {
	$screen = 'admin.php?page=' . OPENSTATION_SHELL_PAGE_SLUG;
	if ( ! is_multisite() ) {
		return array(
			array(
				'id'       => 'hub',
				'name'     => (string) get_bloginfo( 'name' ),
				'shellUrl' => esc_url_raw( admin_url( $screen ) ),
				'url'      => esc_url_raw( home_url( '/' ) ),
				'kind'     => 'local',
				'status'   => 'paired',
			),
		);
	}
	$entries = array();
	foreach ( openstation_multisite_network_sites() as $blog_id => $name ) {
		$entries[] = array(
			'id'       => (string) $blog_id,
			'name'     => $name,
			'shellUrl' => esc_url_raw( get_admin_url( $blog_id, $screen ) ),
			'url'      => esc_url_raw( get_home_url( $blog_id, '/' ) ),
			'kind'     => 'local',
			'status'   => 'paired',
		);
	}
	return $entries;
}

/**
 * The network as one list: identity, Network Admin, every site.
 *
 * @return array<string,mixed>
 */
function openstation_network_hub_list() {
	$identity = openstation_network_identity();
	$admin    = null;
	if ( is_multisite() ) {
		$admin = array(
			'url'      => esc_url_raw( network_admin_url() ),
			'shellUrl' => $identity['shellUrl'],
			// Every row: the hub gates them by capability on arrival,
			// and a member cannot know a user's network role.
			'rows'     => openstation_multisite_network_admin_rows( true ),
		);
	}
	return array(
		'name'         => $identity['name'],
		'url'          => $identity['url'],
		'shellUrl'     => $identity['shellUrl'],
		'publicKey'    => $identity['publicKey'],
		'networkAdmin' => $admin,
		'sites'        => array_merge( openstation_network_local_entries(), openstation_network_member_entries() ),
	);
}

/**
 * Whether this install is a hub: it has members.
 *
 * @return bool
 */
function openstation_network_is_hub() {
	return array() !== openstation_network_members();
}

/**
 * Register the list route.
 */
function openstation_network_register_hub_route() {
	register_rest_route(
		'desktop-mode/v1',
		'/network',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => 'openstation_rest_network_list',
			'permission_callback' => 'openstation_rest_network_list_permission',
		)
	);
}
add_action( 'rest_api_init', 'openstation_network_register_hub_route' );

/**
 * Who may read the list: a member signing with its pinned key, or a
 * logged-in administrator of the hub.
 *
 * @param WP_REST_Request $request Request.
 * @return true|WP_Error
 */
function openstation_rest_network_list_permission( WP_REST_Request $request ) {
	if ( current_user_can( is_multisite() ? 'manage_network' : 'manage_options' ) ) {
		return true;
	}
	$signer = openstation_network_request_signer( $request );
	if ( '' !== $signer && null !== openstation_network_member_by_key( $signer ) ) {
		return true;
	}
	return new WP_Error(
		'openstation_network_not_member',
		__( 'This site is not a member of the network. Add it on the network first.', 'desktop-mode' ),
		array( 'status' => 403 )
	);
}

/**
 * GET /desktop-mode/v1/network
 *
 * @return WP_REST_Response
 */
function openstation_rest_network_list() {
	return rest_ensure_response( openstation_network_hub_list() );
}

/**
 * The multisite block a single-site hub's shell boots with: itself
 * first, then its members. A multisite hub builds its own block in
 * `openstation_multisite_payload()`, where the members are appended
 * to the network's sites.
 *
 * @return array<string,mixed>|null Null when this install has no members.
 */
function openstation_network_hub_payload() {
	if ( is_multisite() || ! openstation_network_is_hub() ) {
		return null;
	}
	$sites = array();
	foreach ( array_merge( openstation_network_local_entries(), openstation_network_member_entries() ) as $entry ) {
		$sites[] = array(
			'id'       => $entry['id'],
			'name'     => $entry['name'],
			'shellUrl' => $entry['shellUrl'],
		);
	}
	return array(
		'isNetworkAdmin' => false,
		'networkAdmin'   => null,
		'current'        => 'hub',
		'sites'          => $sites,
	);
}
