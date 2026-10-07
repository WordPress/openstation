<?php

if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

function openstation_plugins_window_featured_slugs() {
	$slugs = array(

		'odd-outlandish-desktop-decorator',
		'allterrain-forms',
		'allterrain-photo-editor',
		'allterrain-maia',
	);

	$slugs = (array) apply_filters( 'openstation_plugins_featured_slugs', $slugs );
	$slugs = array_values(
		array_unique(
			array_filter(
				array_map(
					static function ( $s ) {
						return sanitize_key( (string) $s );
					},
					$slugs
				)
			)
		)
	);
	return $slugs;
}

function openstation_plugins_window_ajax_featured() {
	$guard = openstation_plugins_window_ajax_guard( 'install_plugins' );
	if ( is_wp_error( $guard ) ) {
		openstation_plugins_window_ajax_error( $guard );
		return;
	}

	openstation_plugins_window_load_plugins_api();

	$cache_key = 'dm_pwfeatured_v1';
	$cached    = get_transient( $cache_key );
	if ( false !== $cached && is_array( $cached ) ) {
		wp_send_json_success( $cached );
		return;
	}

	$plugins    = array();
	$seen_slugs = array();
	$fields     = array(
		'icons'             => true,
		'banners'           => false,
		'short_description' => true,
		'description'       => false,
		'sections'          => false,
		'screenshots'       => false,
		'rating'            => true,
		'ratings'           => false,
		'num_ratings'       => true,
		'active_installs'   => true,
		'last_updated'      => true,
		'tested'            => true,
		'requires'          => true,
		'requires_php'      => true,
		'requires_plugins'  => true,
		'homepage'          => true,
		'compatibility'     => false,
		'group'             => false,
		'contributors'      => false,
		'donate_link'       => false,
	);

	$curated = openstation_plugins_window_featured_slugs();
	foreach ( $curated as $slug ) {
		if ( isset( $seen_slugs[ $slug ] ) ) {
			continue;
		}
		$info = plugins_api(
			'plugin_information',
			array(
				'slug'   => $slug,
				'fields' => $fields,
			)
		);
		if ( is_wp_error( $info ) || ! is_object( $info ) ) {

			continue;
		}
		$row                 = (array) $info;
		$row['featured']     = true;
		$plugins[]           = $row;
		$seen_slugs[ $slug ] = true;
	}

	$discovered = plugins_api(
		'query_plugins',
		array(
			'browse'   => 'popular',
			'page'     => 1,
			'per_page' => 100,
			'fields'   => $fields,
		)
	);
	if ( ! is_wp_error( $discovered ) && isset( $discovered->plugins ) && is_array( $discovered->plugins ) ) {
		foreach ( $discovered->plugins as $candidate ) {
			$candidate = (array) $candidate;
			$slug      = isset( $candidate['slug'] ) ? sanitize_key( (string) $candidate['slug'] ) : '';
			if ( '' === $slug || isset( $seen_slugs[ $slug ] ) ) {
				continue;
			}
			$requires = isset( $candidate['requires_plugins'] ) ? (array) $candidate['requires_plugins'] : array();

			if ( ! in_array( 'desktop-mode', $requires, true ) ) {
				continue;
			}
			$candidate['featured'] = false;
			$plugins[]             = $candidate;
			$seen_slugs[ $slug ]   = true;
		}
	}

	$payload = array(
		'plugins' => array_values( $plugins ),
		'info'    => array(
			'curated'    => count( $curated ),
			'discovered' => max( 0, count( $plugins ) - count( $curated ) ),
			'results'    => count( $plugins ),
		),
	);

	$payload = (array) apply_filters(
		'openstation_plugins_featured_response',
		$payload,
		$curated
	);

	set_transient( $cache_key, $payload, HOUR_IN_SECONDS );
	wp_send_json_success( $payload );
}
add_action( 'wp_ajax_openstation_plugins_featured', 'openstation_plugins_window_ajax_featured' );
