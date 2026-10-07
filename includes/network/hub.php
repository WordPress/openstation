<?php

defined( 'ABSPATH' ) || exit;

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

function openstation_network_hub_list() {
	$identity = openstation_network_identity();
	$admin    = null;
	if ( is_multisite() ) {
		$admin = array(
			'url'      => esc_url_raw( network_admin_url() ),
			'shellUrl' => $identity['shellUrl'],

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

function openstation_network_is_hub() {
	return array() !== openstation_network_members();
}

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

function openstation_rest_network_list() {
	return rest_ensure_response( openstation_network_hub_list() );
}

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
			'kind'     => $entry['kind'],
			'foreign'  => 'member' === $entry['kind'],
		);
	}
	return array(
		'isNetworkAdmin' => false,
		'networkAdmin'   => null,
		'current'        => 'hub',
		'sites'          => $sites,
	);
}
