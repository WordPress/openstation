<?php
/**
 * OpenStation — Post Stats Widget.
 *
 * Bar chart of posts published per month for the last 6 months,
 * broken down by published / draft / pending status.
 *
 * Refresh: every 5 minutes.
 * Requires: OpenStation 0.18.0+ (open_station_register_widget).
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register the REST endpoint that aggregates per-month post counts
 * server-side. Replaces the widget's original client-side approach —
 * 3 statuses × up-to-100-per-page `/wp/v2/posts` requests every
 * refresh — with a single GROUP BY that's shared through a transient.
 *
 * Route: GET /desktop-mode/v1/post-stats
 * Permission: edit_posts.
 */
function open_station_register_post_stats_rest_route() {
	register_rest_route(
		'desktop-mode/v1',
		'/post-stats',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => 'open_station_post_stats_callback',
			'permission_callback' => static function () {
				return current_user_can( 'edit_posts' );
			},
		)
	);
}
add_action( 'rest_api_init', 'open_station_register_post_stats_rest_route' );

/**
 * Aggregate post counts per month × status for the last 6 months.
 *
 * Capability scoping mirrors what the widget's old `/wp/v2/posts`
 * queries returned: published posts count site-wide for anyone with
 * `edit_posts`, while draft / pending counts are scoped to the
 * current user's own posts unless they hold `edit_others_posts`
 * (core's REST posts controller applies the same visibility).
 *
 * Cached for 5 minutes per scope — the data is a trailing-6-month
 * aggregate, the widget refreshes every 5 minutes, and every viewer
 * in the same capability scope can share one computation.
 *
 * @return array{months:array<int,array{ym:string,publish:int,draft:int,pending:int}>}
 */
function open_station_post_stats_callback() {
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
	// First day of the earliest bucket, site timezone.
	$cutoff = gmdate(
		'Y-m-01 00:00:00',
		strtotime( current_time( 'Y-m-01' ) . ' -' . ( $months_back - 1 ) . ' months' )
	);

	// Two literal query branches (rather than a concatenated author
	// clause) so every byte of SQL inside prepare() is static —
	// keeps the PreparedSQL sniff able to verify it.
	if ( $see_others ) {
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- single aggregate GROUP BY, result cached in the transient below.
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
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- single aggregate GROUP BY, result cached in the transient below.
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

	// Emit exactly $months_back buckets, oldest first, zero-filled —
	// the widget renders a fixed axis and shouldn't have to guess at
	// missing months.
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

/**
 * Register the JS + CSS assets.
 */
function open_station_register_post_stats_widget_assets() {
	$suffix  = open_station_asset_suffix();
	$version = defined( 'OPEN_STATION_VERSION' ) ? OPEN_STATION_VERSION : '0';

	$js_path  = OPEN_STATION_DIR . 'assets/js/widget-post-stats' . $suffix . '.js';
	$css_path = OPEN_STATION_DIR . 'assets/js/widget-post-stats' . $suffix . '.css';

	wp_register_style(
		'os-post-stats-widget',
		OPEN_STATION_URL . 'assets/js/widget-post-stats' . $suffix . '.css',
		array(),
		file_exists( $css_path ) ? (string) filemtime( $css_path ) : $version
	);

	wp_register_script(
		'os-post-stats-widget',
		OPEN_STATION_URL . 'assets/js/widget-post-stats' . $suffix . '.js',
		array( 'wp-api-fetch' ),
		file_exists( $js_path ) ? (string) filemtime( $js_path ) : $version,
		true
	);
}
add_action( 'init', 'open_station_register_post_stats_widget_assets', 5 );

/**
 * Eagerly enqueue the CSS on shell pages.
 */
function open_station_enqueue_post_stats_widget_styles() {
	if ( function_exists( 'open_station_is_enabled' ) && ! open_station_is_enabled() ) {
		return;
	}
	if ( function_exists( 'open_station_is_chromeless_request' ) && open_station_is_chromeless_request() ) {
		return;
	}
	wp_enqueue_style( 'os-post-stats-widget' );
}
add_action( 'admin_enqueue_scripts', 'open_station_enqueue_post_stats_widget_styles', 20 );

/**
 * Register the widget definition.
 */
function open_station_register_post_stats_widget() {
	if ( ! function_exists( 'open_station_register_widget' ) ) {
		return;
	}
	open_station_register_widget(
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
add_action( 'init', 'open_station_register_post_stats_widget', 6 );
