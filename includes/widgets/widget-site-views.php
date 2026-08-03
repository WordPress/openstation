<?php
/**
 * OpenStation — Site Views Widget.
 *
 * Sparkline graph of page views over the last 7 days with
 * week-over-week delta. Tries Jetpack Stats first, falls back
 * to a _post_views_YYYY-MM-DD meta-key aggregator.
 *
 * Refresh: every 10 minutes.
 * Requires: OpenStation 0.18.0+ (open_station_register_widget).
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register the REST endpoint that aggregates per-post view counts
 * from the _post_views_YYYY-MM-DD meta key (plain-WP fallback).
 *
 * Route: GET /desktop-mode/v1/site-views-meta
 * Permission: edit_posts.
 */
function open_station_register_site_views_rest_route() {
	register_rest_route(
		'desktop-mode/v1',
		'/site-views-meta',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => 'open_station_site_views_meta_callback',
			'permission_callback' => static function () {
				return current_user_can( 'edit_posts' );
			},
		)
	);
}
add_action( 'rest_api_init', 'open_station_register_site_views_rest_route' );

/**
 * Aggregate _post_views_YYYY-MM-DD meta across all posts for 14 days.
 *
 * The result is cached in a 5-minute transient: the aggregation runs
 * 14 SUM() queries over postmeta, the widget only refreshes every
 * 10 minutes, and the data is site-wide (not per-user) — so every
 * concurrent viewer can share one computation. View counts accrue
 * continuously, so a short TTL is the invalidation strategy; no
 * event-based purge is needed.
 *
 * @param WP_REST_Request $request REST request.
 * @return array
 */
function open_station_site_views_meta_callback( $request ) {
	global $wpdb;

	$cached = get_transient( 'desktop_mode_site_views_meta' );
	if ( is_array( $cached ) ) {
		return $cached;
	}

	$rows  = array();
	$today = current_time( 'Y-m-d' );

	for ( $i = 0; $i < 14; $i++ ) {
		$date     = gmdate( 'Y-m-d', strtotime( $today . ' -' . $i . ' days' ) );
		$meta_key = '_post_views_' . $date;
		$total    = (int) $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COALESCE( SUM( CAST( meta_value AS UNSIGNED ) ), 0 )
				FROM {$wpdb->postmeta}
				WHERE meta_key = %s",
				$meta_key
			)
		);
		$rows[] = array(
			'date'  => $date,
			'views' => $total,
		);
	}

	$has_data = array_sum( array_column( $rows, 'views' ) ) > 0;

	$result = array(
		'source'   => 'post-meta',
		'has_data' => $has_data,
		'days'     => array_reverse( $rows ),
	);

	set_transient( 'desktop_mode_site_views_meta', $result, 5 * MINUTE_IN_SECONDS );

	return $result;
}

/**
 * Register the JS + CSS assets.
 */
function open_station_register_site_views_widget_assets() {
	$suffix  = open_station_asset_suffix();
	$version = defined( 'OPEN_STATION_VERSION' ) ? OPEN_STATION_VERSION : '0';

	$js_path  = OPEN_STATION_DIR . 'assets/js/widget-site-views' . $suffix . '.js';
	$css_path = OPEN_STATION_DIR . 'assets/js/widget-site-views' . $suffix . '.css';

	wp_register_style(
		'os-site-views-widget',
		OPEN_STATION_URL . 'assets/js/widget-site-views' . $suffix . '.css',
		array(),
		file_exists( $css_path ) ? (string) filemtime( $css_path ) : $version
	);

	wp_register_script(
		'os-site-views-widget',
		OPEN_STATION_URL . 'assets/js/widget-site-views' . $suffix . '.js',
		array( 'wp-api-fetch' ),
		file_exists( $js_path ) ? (string) filemtime( $js_path ) : $version,
		true
	);
}
add_action( 'init', 'open_station_register_site_views_widget_assets', 5 );

/**
 * Eagerly enqueue the CSS on shell pages.
 */
function open_station_enqueue_site_views_widget_styles() {
	if ( function_exists( 'open_station_is_enabled' ) && ! open_station_is_enabled() ) {
		return;
	}
	if ( function_exists( 'open_station_is_chromeless_request' ) && open_station_is_chromeless_request() ) {
		return;
	}
	wp_enqueue_style( 'os-site-views-widget' );
}
add_action( 'admin_enqueue_scripts', 'open_station_enqueue_site_views_widget_styles', 20 );

/**
 * Register the widget definition.
 */
function open_station_register_site_views_widget() {
	if ( ! function_exists( 'open_station_register_widget' ) ) {
		return;
	}
	open_station_register_widget(
		'desktop-mode/site-views',
		array(
			'label'          => __( 'Site Views', 'desktop-mode' ),
			'description'    => __( 'Sparkline of page views over the last 7 days with week-over-week delta.', 'desktop-mode' ),
			'icon'           => 'dashicons-chart-area',
			'script'         => 'os-site-views-widget',
			'movable'        => true,
			'resizable'      => true,
			'min_width'      => 240,
			'min_height'     => 160,
			'default_width'  => 300,
			'default_height' => 200,
		)
	);
}
add_action( 'init', 'open_station_register_site_views_widget', 6 );
