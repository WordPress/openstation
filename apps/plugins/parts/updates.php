<?php

if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

function openstation_plugins_window_maybe_refresh_update_transient( $force = false ) {

	if ( ! apply_filters( 'openstation_plugins_window_refresh_updates', true, $force ) ) {
		return;
	}

	if ( ! function_exists( 'wp_update_plugins' ) ) {

		return;
	}

	if ( $force ) {

		if ( function_exists( 'wp_clean_plugins_cache' ) ) {
			wp_clean_plugins_cache( true );
		} else {
			delete_site_transient( 'update_plugins' );
		}
		wp_update_plugins();
		return;
	}

	$current = get_site_transient( 'update_plugins' );
	if (
		is_object( $current ) &&
		isset( $current->last_checked ) &&
		12 * HOUR_IN_SECONDS > ( time() - (int) $current->last_checked )
	) {

		return;
	}

	wp_update_plugins();
}

function openstation_plugins_window_prime_updates_once( $force = false ) {
	static $primed = false;
	if ( $primed && ! $force ) {
		return;
	}
	$primed = true;
	openstation_plugins_window_maybe_refresh_update_transient( $force );
}

function openstation_plugins_window_updates() {
	openstation_plugins_window_prime_updates_once();
	$updates = get_site_transient( 'update_plugins' );
	return is_object( $updates ) ? $updates : null;
}

function openstation_plugins_window_field_update_available( $row ) {
	$none        = array(
		'available'   => false,
		'new_version' => null,
		'package'     => '',
		'slug'        => '',
	);
	$plugin_file = openstation_plugins_window_row_plugin_file( $row );
	if ( '' === $plugin_file ) {
		return $none;
	}

	$updates = openstation_plugins_window_updates();
	if ( null === $updates || empty( $updates->response ) || ! is_array( $updates->response ) ) {
		return $none;
	}
	if ( ! isset( $updates->response[ $plugin_file ] ) ) {
		return $none;
	}

	$entry = $updates->response[ $plugin_file ];
	return array(
		'available'   => true,
		'new_version' => is_object( $entry ) && isset( $entry->new_version ) ? (string) $entry->new_version : null,

		'package'     => is_object( $entry ) && ! empty( $entry->package ) ? (string) $entry->package : '',

		'slug'        => is_object( $entry ) && ! empty( $entry->slug ) ? (string) $entry->slug : '',
	);
}

function openstation_plugins_window_count_visible_updates() {
	$updates = get_site_transient( 'update_plugins' );
	if ( ! is_object( $updates ) || empty( $updates->response ) || ! is_array( $updates->response ) ) {
		return 0;
	}

	if ( ! function_exists( 'get_plugins' ) ) {
		require_once ABSPATH . 'wp-admin/includes/plugin.php';
	}
	$installed = get_plugins();

	$count = 0;
	foreach ( array_keys( $updates->response ) as $plugin_file ) {
		if ( isset( $installed[ $plugin_file ] ) ) {
			++$count;
		}
	}
	return $count;
}

function openstation_plugins_window_update_entry( $plugin_file ) {
	if ( '' === $plugin_file ) {
		return null;
	}
	$updates = openstation_plugins_window_updates();
	if ( null === $updates ) {
		return null;
	}
	if ( isset( $updates->response[ $plugin_file ] ) ) {
		return (array) $updates->response[ $plugin_file ];
	}
	if ( isset( $updates->no_update[ $plugin_file ] ) ) {
		return (array) $updates->no_update[ $plugin_file ];
	}
	return null;
}

function openstation_plugins_window_field_wporg_slug( $row ) {
	$entry = openstation_plugins_window_update_entry(
		openstation_plugins_window_row_plugin_file( $row )
	);
	if ( null === $entry || empty( $entry['slug'] ) ) {
		return null;
	}
	$slug = sanitize_key( (string) $entry['slug'] );
	return '' !== $slug ? $slug : null;
}

function openstation_plugins_window_field_auto_update( $row ) {
	$plugin_file = openstation_plugins_window_row_plugin_file( $row );
	if ( '' === $plugin_file ) {
		return array(
			'enabled'   => false,
			'forced'    => null,
			'supported' => false,
		);
	}

	$auto_updates = (array) get_site_option( 'auto_update_plugins', array() );
	$enabled      = in_array( $plugin_file, $auto_updates, true );
	$supported    = null !== openstation_plugins_window_update_entry( $plugin_file );

	$filter_payload           = wp_parse_args(
		$row,
		array(
			'id'            => $plugin_file,
			'slug'          => isset( $row['textdomain'] ) ? (string) $row['textdomain'] : '',
			'plugin'        => $plugin_file,
			'new_version'   => '',
			'url'           => '',
			'package'       => '',
			'icons'         => array(),
			'banners'       => array(),
			'banners_rtl'   => array(),
			'tested'        => '',
			'requires_php'  => '',
			'compatibility' => new stdClass(),
		)
	);
	$filter_payload['plugin'] = $plugin_file;
	$filter_payload['id']     = $plugin_file;
	$filter_payload           = (object) $filter_payload;

	$forced = apply_filters( 'auto_update_plugin', null, $filter_payload );
	if ( null !== $forced ) {
		$forced = (bool) $forced;

		$enabled = $forced;
	}

	return array(
		'enabled'   => (bool) $enabled,
		'forced'    => $forced,
		'supported' => $supported,
	);
}
