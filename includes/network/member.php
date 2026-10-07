<?php

defined( 'ABSPATH' ) || exit;

const OPENSTATION_NETWORK_HUB_OPTION = 'openstation_network_hub';

const OPENSTATION_NETWORK_LIST_TTL = HOUR_IN_SECONDS;

const OPENSTATION_NETWORK_RETRY = 5 * MINUTE_IN_SECONDS;

const OPENSTATION_NETWORK_REFRESH_HOOK = 'openstation_network_refresh_list';

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
		'tried'     => isset( $hub['tried'] ) ? (int) $hub['tried'] : 0,
		'error'     => isset( $hub['error'] ) ? (string) $hub['error'] : '',
	);
}

function openstation_network_is_member() {
	return null !== openstation_network_hub();
}

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

function openstation_network_leave() {
	wp_clear_scheduled_hook( OPENSTATION_NETWORK_REFRESH_HOOK );
	return openstation_network_option_delete( OPENSTATION_NETWORK_HUB_OPTION );
}

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
	$stored['tried'] = time();
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

function openstation_network_schedule_refresh() {
	$hub = openstation_network_hub();
	if ( null === $hub ) {
		return;
	}
	$due = null === $hub['list']
		? $hub['tried'] + OPENSTATION_NETWORK_RETRY
		: $hub['fetched'] + OPENSTATION_NETWORK_LIST_TTL;
	if ( time() < $due ) {
		return;
	}
	if ( ! wp_next_scheduled( OPENSTATION_NETWORK_REFRESH_HOOK ) ) {
		wp_schedule_single_event( time(), OPENSTATION_NETWORK_REFRESH_HOOK );
	}
}

function openstation_network_member_payload() {
	$hub = openstation_network_hub();
	if ( null === $hub ) {
		return null;
	}

	openstation_network_schedule_refresh();
	if ( null === $hub['list'] ) {
		return null;
	}

	$me      = openstation_network_public_key();
	$current = '';
	$sites   = array();
	foreach ( $hub['list']['sites'] as $site ) {
		$mine = '' !== $site['publicKey'] && hash_equals( $site['publicKey'], $me );
		if ( $mine ) {
			$current = $site['id'];
		}
		$sites[] = array(
			'id'       => $site['id'],
			'name'     => $site['name'],
			'shellUrl' => $site['shellUrl'],
			'kind'     => $site['kind'],

			'foreign'  => ! $mine,
		);
	}
	if ( '' === $current ) {

		$current = 'member:self';
		$sites[] = array(
			'id'       => $current,
			'name'     => (string) get_bloginfo( 'name' ),
			'shellUrl' => esc_url_raw( admin_url( 'admin.php?page=' . OPENSTATION_SHELL_PAGE_SLUG ) ),
			'kind'     => 'member',
			'foreign'  => false,
		);
	}
	$admin = $hub['list']['networkAdmin'];
	if ( is_array( $admin ) ) {
		$admin['foreign'] = true;
	}
	return array(
		'isNetworkAdmin' => false,
		'networkAdmin'   => ( $admin && current_user_can( 'manage_options' ) ) ? $admin : null,
		'current'        => $current,
		'sites'          => $sites,
	);
}
