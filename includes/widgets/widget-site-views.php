<?php
/**
 * Desktop Mode — Site Views Widget.
 *
 * Sparkline graph of page views over the last 7 days, plus a total
 * and a week-over-week delta arrow (up green / down red / flat grey).
 *
 * Data source priority:
 *   1. Jetpack Stats REST  /jetpack/v4/stats/visits?unit=day&quantity=14
 *   2. Meta key fallback via /desktop-mode/v1/site-views-meta
 *      (reads _post_views_YYYY-MM-DD meta keys written by post-views plugins)
 *
 * If neither source has data, the widget shows a clear message rather
 * than failing silently.
 *
 * Refresh: every 10 minutes.
 * Requires: Desktop Mode 0.18.0+ (desktop_mode_register_widget).
 *
 * This file ships as a reference/example implementation.
 * Copy it into your own plugin and replace the yourplugin_ prefix
 * and text domain before use.
 *
 * @package WPDesktopMode
 * @since   0.26.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register the REST endpoint that aggregates per-post view counts
 * from the _post_views_YYYY-MM-DD meta key. Used as the plain-WP
 * fallback when Jetpack Stats is not available.
 *
 * Route: GET /desktop-mode/v1/site-views-meta
 * Permission: edit_posts.
 *
 * @since 0.26.0
 */
function desktop_mode_register_site_views_rest_route() {
	register_rest_route(
		'desktop-mode/v1',
		'/site-views-meta',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => 'desktop_mode_site_views_meta_callback',
			'permission_callback' => static function () {
				return current_user_can( 'edit_posts' );
			},
		)
	);
}
add_action( 'rest_api_init', 'desktop_mode_register_site_views_rest_route' );

/**
 * Aggregate _post_views_YYYY-MM-DD meta across all posts for 14 days.
 *
 * @param WP_REST_Request $request REST request.
 * @return array
 */
function desktop_mode_site_views_meta_callback( $request ) {
	global $wpdb;

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

	return array(
		'source'   => 'post-meta',
		'has_data' => $has_data,
		'days'     => array_reverse( $rows ),
	);
}

/**
 * Register the JS asset.
 *
 * @since 0.26.0
 */
function desktop_mode_register_site_views_widget_assets() {
	$suffix  = ( defined( 'SCRIPT_DEBUG' ) && SCRIPT_DEBUG ) ? '' : '.min';
	$version = defined( 'DESKTOP_MODE_VERSION' ) ? DESKTOP_MODE_VERSION : '0';

	$js_path = DESKTOP_MODE_DIR . 'assets/js/widget-site-views' . $suffix . '.js';

	wp_register_script(
		'desktop-mode-site-views-widget',
		DESKTOP_MODE_URL . 'assets/js/widget-site-views' . $suffix . '.js',
		array( 'wp-api-fetch' ),
		file_exists( $js_path ) ? (string) filemtime( $js_path ) : $version,
		true
	);
}
add_action( 'init', 'desktop_mode_register_site_views_widget_assets', 5 );

/**
 * Register the widget definition.
 *
 * @since 0.26.0
 */
function desktop_mode_register_site_views_widget() {
	if ( ! function_exists( 'desktop_mode_register_widget' ) ) {
		return;
	}
	desktop_mode_register_widget(
		'desktop-mode/site-views',
		array(
			'label'          => __( 'Site Views', 'desktop-mode' ),
			'description'    => __( 'Sparkline of page views over the last 7 days with week-over-week delta.', 'desktop-mode' ),
			'icon'           => 'dashicons-chart-area',
			'script'         => 'desktop-mode-site-views-widget',
			'movable'        => true,
			'resizable'      => true,
			'min_width'      => 240,
			'min_height'     => 160,
			'default_width'  => 300,
			'default_height' => 200,
		)
	);
}
add_action( 'init', 'desktop_mode_register_site_views_widget', 6 );
