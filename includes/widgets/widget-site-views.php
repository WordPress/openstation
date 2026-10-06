<?php
/**
 * OpenStation — Site Views Widget.
 *
 * Sparkline graph of page views over the last 7 days with
 * week-over-week delta. Tries Jetpack Stats first, falls back
 * to a _post_views_YYYY-MM-DD meta-key aggregator. Both sources are
 * read server side, one route each, and both answer their rows as
 * `days`: `{ date, views }`, oldest first.
 *
 * Refresh: every 10 minutes.
 * Requires: OpenStation 0.18.0+ (openstation_register_widget).
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register the widget's two REST endpoints, one per source.
 *
 * Route: GET /desktop-mode/v1/site-views-jetpack (Jetpack Stats)
 * Route: GET /desktop-mode/v1/site-views-meta    (plain-WP fallback,
 *        per-post `_post_views_YYYY-MM-DD` meta)
 * Permission: edit_posts on both. The Jetpack route then applies
 * Jetpack's own stats gate per caller, see
 * {@see openstation_site_views_jetpack_callback()}.
 */
function openstation_register_site_views_rest_route() {
	register_rest_route(
		'desktop-mode/v1',
		'/site-views-jetpack',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => 'openstation_site_views_jetpack_callback',
			'permission_callback' => static function () {
				return current_user_can( 'edit_posts' );
			},
		)
	);
	register_rest_route(
		'desktop-mode/v1',
		'/site-views-meta',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => 'openstation_site_views_meta_callback',
			'permission_callback' => static function () {
				return current_user_can( 'edit_posts' );
			},
		)
	);
}
add_action( 'rest_api_init', 'openstation_register_site_views_rest_route' );

/**
 * Last 14 days of site visits from Jetpack Stats.
 *
 * Jetpack registers no `jetpack/v4/stats/visits` route: its own
 * dashboard reads `jetpack/v4/stats-app/sites/<blog id>/stats/visits`,
 * which proxies `WPCOM_Stats::get_visits()`. Calling that method here
 * keeps the blog id on the server, and `WPCOM_Stats` already caches
 * the WordPress.com answer for five minutes per site.
 *
 * Answers `available: false` instead of an error when Jetpack cannot
 * serve this caller, so the client falls through to the meta source
 * without a failed request on every site that has no Jetpack:
 *
 * - The caller does not pass Jetpack's stats gate, see
 *   {@see openstation_site_views_user_can_read_jetpack()}. That answer
 *   also carries `restricted: true`, so the widget can say the numbers
 *   exist and are withheld instead of asking for a plugin that is
 *   already active.
 * - Jetpack is absent, the Stats module is off, or WordPress.com
 *   answered with an error (for example a site that is not connected).
 *
 * A successful answer is trusted even when every day is zero: Jetpack
 * is collecting, and a quiet week is a real answer.
 *
 * @return array{available:bool,restricted:bool,days:array}
 */
function openstation_site_views_jetpack_callback() {
	$restricted = openstation_site_views_jetpack_stats_active() && ! openstation_site_views_user_can_read_jetpack();
	$days       = $restricted ? null : openstation_site_views_jetpack_days();

	return array(
		'available'  => null !== $days,
		'restricted' => $restricted,
		'days'       => null === $days ? array() : $days,
	);
}

/**
 * Whether the current user passes Jetpack's own stats gate.
 *
 * Mirrors the `permission_callback` of Jetpack's stats-app REST
 * controller: `manage_options` or `view_stats` (the roles picked in
 * Jetpack's Stats settings). Every surface that serves a number read
 * from Jetpack Stats asks this, the Living Tree's traffic total
 * included, so OpenStation never hands out traffic Jetpack itself
 * withholds from the caller.
 *
 * @return bool
 */
function openstation_site_views_user_can_read_jetpack() {
	return current_user_can( 'manage_options' ) || current_user_can( 'view_stats' ); // phpcs:ignore WordPress.WP.Capabilities.Unknown -- Jetpack's stats capability, mapped by its Stats package.
}

/**
 * Whether Jetpack Stats is there to ask: its reader is loaded and the
 * Stats module is on.
 *
 * `WPCOM_Stats` is autoloaded whenever Jetpack is active, module on or
 * off, so its presence alone says nothing about whether the site is
 * counting. With the module off the recent days read as zero, which
 * would hide a post-views plugin that is counting. A site where the
 * module state cannot be read is treated as off for the same reason.
 *
 * @return bool
 */
function openstation_site_views_jetpack_stats_active() {
	return class_exists( '\Automattic\Jetpack\Stats\WPCOM_Stats' )
		&& class_exists( '\Automattic\Jetpack\Modules' )
		&& ( new \Automattic\Jetpack\Modules() )->is_active( 'stats' );
}

/**
 * Read and normalise 14 daily rows from `WPCOM_Stats::get_visits()`.
 *
 * WordPress.com answers `{ fields: [ 'period', 'views', ... ], data:
 * [ [ 'YYYY-MM-DD', 12, ... ], ... ] }`. Rows are positional per
 * `fields`, so both columns are located by name. An answer that names
 * neither is not guessed at by position: another column read as views
 * is a wrong number, and no answer lets the meta source speak instead.
 *
 * Not gated on the caller: every caller that serves these rows, or a
 * total of them, asks {@see openstation_site_views_user_can_read_jetpack()}.
 *
 * @return array<int,array{date:string,views:int}>|null Rows oldest
 *         first, or null when Jetpack Stats cannot answer.
 */
function openstation_site_views_jetpack_days() {
	if ( ! openstation_site_views_jetpack_stats_active() ) {
		return null;
	}
	$wpcom_stats = new \Automattic\Jetpack\Stats\WPCOM_Stats();
	if ( ! method_exists( $wpcom_stats, 'get_visits' ) ) {
		return null;
	}

	try {
		$stats = $wpcom_stats->get_visits(
			array(
				'unit'     => 'day',
				'quantity' => 14,
			)
		);
	} catch ( \Throwable $e ) {
		return null;
	}
	if ( is_wp_error( $stats ) ) {
		return null;
	}

	// Jetpack versions differ on object-vs-assoc-array decoding.
	$stats = json_decode( wp_json_encode( $stats ), true );
	if ( ! is_array( $stats ) || empty( $stats['data'] ) || ! is_array( $stats['data'] ) ) {
		return null;
	}

	$fields      = isset( $stats['fields'] ) && is_array( $stats['fields'] ) ? $stats['fields'] : array();
	$date_index  = array_search( 'period', $fields, true );
	$views_index = array_search( 'views', $fields, true );
	if ( false === $date_index || false === $views_index ) {
		return null;
	}

	$days = array();
	foreach ( $stats['data'] as $row ) {
		if ( ! is_array( $row ) || ! isset( $row[ $date_index ] ) ) {
			continue;
		}
		$date = (string) $row[ $date_index ];
		if ( 1 !== preg_match( '/^\d{4}-\d{2}-\d{2}$/', $date ) ) {
			continue;
		}
		$views  = isset( $row[ $views_index ] ) && is_numeric( $row[ $views_index ] ) ? (int) $row[ $views_index ] : 0;
		$days[] = array(
			'date'  => $date,
			'views' => max( 0, $views ),
		);
	}
	if ( empty( $days ) ) {
		return null;
	}

	usort(
		$days,
		static function ( $a, $b ) {
			return strcmp( $a['date'], $b['date'] );
		}
	);
	return $days;
}

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
function openstation_site_views_meta_callback( $request ) {
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
		$rows[]   = array(
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
function openstation_register_site_views_widget_assets() {
	$suffix  = openstation_asset_suffix();
	$version = defined( 'OPENSTATION_VERSION' ) ? OPENSTATION_VERSION : '0';

	$js_path  = OPENSTATION_DIR . 'assets/js/widget-site-views' . $suffix . '.js';
	$css_path = OPENSTATION_DIR . 'assets/js/widget-site-views' . $suffix . '.css';

	wp_register_style(
		'os-site-views-widget',
		OPENSTATION_URL . 'assets/js/widget-site-views' . $suffix . '.css',
		array(),
		file_exists( $css_path ) ? (string) filemtime( $css_path ) : $version
	);

	wp_register_script(
		'os-site-views-widget',
		OPENSTATION_URL . 'assets/js/widget-site-views' . $suffix . '.js',
		array( 'wp-api-fetch' ),
		file_exists( $js_path ) ? (string) filemtime( $js_path ) : $version,
		true
	);
}
add_action( 'init', 'openstation_register_site_views_widget_assets', 5 );

/**
 * Eagerly enqueue the CSS on shell pages.
 */
function openstation_enqueue_site_views_widget_styles() {
	if ( function_exists( 'openstation_is_enabled' ) && ! openstation_is_enabled() ) {
		return;
	}
	if ( function_exists( 'openstation_is_chromeless_request' ) && openstation_is_chromeless_request() ) {
		return;
	}
	wp_enqueue_style( 'os-site-views-widget' );
}
add_action( 'admin_enqueue_scripts', 'openstation_enqueue_site_views_widget_styles', 20 );

/**
 * Register the widget definition.
 */
function openstation_register_site_views_widget() {
	if ( ! function_exists( 'openstation_register_widget' ) ) {
		return;
	}
	openstation_register_widget(
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
add_action( 'init', 'openstation_register_site_views_widget', 6 );
