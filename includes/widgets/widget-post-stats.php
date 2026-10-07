<?php

defined( 'ABSPATH' ) || exit;

function openstation_register_post_stats_rest_route() {
	register_rest_route(
		'desktop-mode/v1',
		'/post-stats',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => 'openstation_post_stats_callback',
			'permission_callback' => static function () {
				return current_user_can( 'edit_posts' );
			},
		)
	);
}
add_action( 'rest_api_init', 'openstation_register_post_stats_rest_route' );

function openstation_post_stats_callback() {
	global $wpdb;

	$see_others = current_user_can( 'edit_others_posts' );
	$cache_key  = $see_others
		? 'desktop_mode_post_stats_all'
		: 'desktop_mode_post_stats_own_' . get_current_user_id();

	$cached = get_transient( $cache_key );
	if ( is_array( $cached ) ) {
		return $cached;
	}

	$months_back = 6;

	$cutoff = gmdate(
		'Y-m-01 00:00:00',
		strtotime( current_time( 'Y-m-01' ) . ' -' . ( $months_back - 1 ) . ' months' )
	);

	if ( $see_others ) {

		$rows = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT DATE_FORMAT( post_date, '%%Y-%%m' ) AS ym, post_status, COUNT(*) AS cnt
				 FROM {$wpdb->posts}
				 WHERE post_type = %s
				   AND post_status IN ( 'publish', 'draft', 'pending' )
				   AND post_date >= %s
				 GROUP BY ym, post_status",
				'post',
				$cutoff
			),
			ARRAY_A
		);
	} else {

		$rows = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT DATE_FORMAT( post_date, '%%Y-%%m' ) AS ym, post_status, COUNT(*) AS cnt
				 FROM {$wpdb->posts}
				 WHERE post_type = %s
				   AND post_status IN ( 'publish', 'draft', 'pending' )
				   AND post_date >= %s
				   AND ( post_status = %s OR post_author = %d )
				 GROUP BY ym, post_status",
				'post',
				$cutoff,
				'publish',
				get_current_user_id()
			),
			ARRAY_A
		);
	}

	$buckets = array();
	for ( $i = $months_back - 1; $i >= 0; $i-- ) {
		$ym             = gmdate( 'Y-m', strtotime( current_time( 'Y-m-01' ) . ' -' . $i . ' months' ) );
		$buckets[ $ym ] = array(
			'ym'      => $ym,
			'publish' => 0,
			'draft'   => 0,
			'pending' => 0,
		);
	}
	foreach ( (array) $rows as $row ) {
		$ym     = isset( $row['ym'] ) ? (string) $row['ym'] : '';
		$status = isset( $row['post_status'] ) ? (string) $row['post_status'] : '';
		if ( isset( $buckets[ $ym ][ $status ] ) ) {
			$buckets[ $ym ][ $status ] = (int) $row['cnt'];
		}
	}

	$result = array( 'months' => array_values( $buckets ) );

	set_transient( $cache_key, $result, 5 * MINUTE_IN_SECONDS );

	return $result;
}

function openstation_register_post_stats_widget_assets() {
	$suffix  = openstation_asset_suffix();
	$version = defined( 'OPENSTATION_VERSION' ) ? OPENSTATION_VERSION : '0';

	$js_path  = OPENSTATION_DIR . 'assets/js/widget-post-stats' . $suffix . '.js';
	$css_path = OPENSTATION_DIR . 'assets/js/widget-post-stats' . $suffix . '.css';

	wp_register_style(
		'os-post-stats-widget',
		OPENSTATION_URL . 'assets/js/widget-post-stats' . $suffix . '.css',
		array(),
		file_exists( $css_path ) ? (string) filemtime( $css_path ) : $version
	);

	wp_register_script(
		'os-post-stats-widget',
		OPENSTATION_URL . 'assets/js/widget-post-stats' . $suffix . '.js',
		array( 'wp-api-fetch' ),
		file_exists( $js_path ) ? (string) filemtime( $js_path ) : $version,
		true
	);
}
add_action( 'init', 'openstation_register_post_stats_widget_assets', 5 );

function openstation_enqueue_post_stats_widget_styles() {
	if ( function_exists( 'openstation_is_enabled' ) && ! openstation_is_enabled() ) {
		return;
	}
	if ( function_exists( 'openstation_is_chromeless_request' ) && openstation_is_chromeless_request() ) {
		return;
	}
	wp_enqueue_style( 'os-post-stats-widget' );
}
add_action( 'admin_enqueue_scripts', 'openstation_enqueue_post_stats_widget_styles', 20 );

function openstation_register_post_stats_widget() {
	if ( ! function_exists( 'openstation_register_widget' ) ) {
		return;
	}
	openstation_register_widget(
		'desktop-mode/post-stats',
		array(
			'label'          => __( 'Post Stats', 'desktop-mode' ),
			'description'    => __( 'Bar chart of posts per month over the last 6 months.', 'desktop-mode' ),
			'icon'           => 'dashicons-chart-bar',
			'script'         => 'os-post-stats-widget',
			'movable'        => true,
			'resizable'      => true,
			'min_width'      => 260,
			'min_height'     => 200,
			'default_width'  => 320,
			'default_height' => 260,
		)
	);
}
add_action( 'init', 'openstation_register_post_stats_widget', 6 );
