<?php

if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

function openstation_plugins_window_field_icon_url( $row ) {
	$plugin_file = openstation_plugins_window_row_plugin_file( $row );
	$entry       = openstation_plugins_window_update_entry( $plugin_file );
	$folder      = '' !== $plugin_file ? dirname( $plugin_file ) : '';
	$slug        = ( '' !== $folder && '.' !== $folder ) ? $folder : '';

	if ( null !== $entry && ! empty( $entry['slug'] ) ) {
		$slug = (string) $entry['slug'];
	} elseif ( '' === $slug ) {

		$slug = isset( $row['textdomain'] ) ? (string) $row['textdomain'] : '';
	}

	$slug = sanitize_key( $slug );
	if ( '' === $slug ) {
		return null;
	}

	$default = openstation_plugins_window_local_icon_url( $plugin_file );
	$no_art  = false;
	if ( null === $default && null !== $entry ) {
		$default = openstation_plugins_window_directory_icon_url( $entry );
		$no_art  = ( null === $default && ! empty( $entry['icons'] ) );
	}
	if ( null === $default && ! $no_art ) {

		$default = 'https://ps.w.org/' . $slug . '/assets/icon.svg';
	}

	return apply_filters( 'openstation_plugins_window_icon_url', $default, $slug, $row );
}

function openstation_plugins_window_directory_icon_url( $entry ) {
	if ( empty( $entry['icons'] ) || ! is_array( $entry['icons'] ) ) {
		return null;
	}
	$icons = $entry['icons'];
	foreach ( array( 'svg', '2x', '1x' ) as $size ) {
		if ( empty( $icons[ $size ] ) || ! is_string( $icons[ $size ] ) ) {
			continue;
		}
		$url = esc_url_raw( $icons[ $size ] );
		if ( '' !== $url ) {
			return $url;
		}
	}
	return null;
}

function openstation_plugins_window_local_icon_url( $plugin_file ) {
	if ( '' === $plugin_file ) {
		return null;
	}
	$folder = dirname( $plugin_file );
	if ( '' === $folder || '.' === $folder ) {

		return null;
	}

	$found = false;
	$memo  = wp_cache_get( 'icon:' . $plugin_file, OPENSTATION_PLUGINS_CACHE_GROUP, false, $found );
	if ( $found ) {
		return is_string( $memo ) ? $memo : null;
	}

	$candidates = apply_filters(
		'openstation_plugins_window_local_icon_candidates',
		array(
			'assets/icon.svg',
			'assets/icon-256x256.png',
			'assets/icon-256x256.jpg',
			'assets/icon-256x256.jpeg',
			'assets/icon-128x128.png',
			'assets/icon-128x128.jpg',
			'assets/icon-128x128.jpeg',
			'icon.svg',
			'icon-256x256.png',
			'icon-256x256.jpg',
			'icon-256x256.jpeg',
			'icon-128x128.png',
			'icon-128x128.jpg',
			'icon-128x128.jpeg',
		),
		$folder
	);

	$plugin_root = WP_PLUGIN_DIR . '/' . $folder;
	$has_assets  = is_dir( $plugin_root . '/assets' );
	$url         = null;
	foreach ( (array) $candidates as $relative ) {
		$relative = (string) $relative;
		if ( '' === $relative ) {
			continue;
		}
		if ( ! $has_assets && 0 === strpos( $relative, 'assets/' ) ) {
			continue;
		}
		if ( file_exists( $plugin_root . '/' . $relative ) ) {
			$url = plugins_url( $relative, WP_PLUGIN_DIR . '/' . $plugin_file );
			break;
		}
	}

	wp_cache_set( 'icon:' . $plugin_file, null === $url ? 0 : $url, OPENSTATION_PLUGINS_CACHE_GROUP );
	return $url;
}

add_action(
	'init',
	static function () {

		wp_cache_add_non_persistent_groups( OPENSTATION_PLUGINS_CACHE_GROUP );
	},
	0
);
