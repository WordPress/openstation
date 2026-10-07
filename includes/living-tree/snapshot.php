<?php

defined( 'ABSPATH' ) || exit;

const OPENSTATION_LIVING_TREE_CACHE_KEY = 'desktop_mode_living_tree_snapshot';

const OPENSTATION_LIVING_TREE_CACHE_TTL = 6 * HOUR_IN_SECONDS;

const OPENSTATION_LIVING_TREE_GATED_TRAFFIC_KEY = 'trafficWithoutJetpack';

function openstation_living_tree_user_can_use() {
	$can = current_user_can( 'read' );

	return (bool) apply_filters( 'openstation_living_tree_user_can_use', $can );
}

function openstation_living_tree_register_routes() {
	register_rest_route(
		'desktop-mode/v1',
		'/living-tree/snapshot',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => 'openstation_living_tree_rest_snapshot',
			'permission_callback' => 'openstation_living_tree_user_can_use',
		)
	);
}
add_action( 'rest_api_init', 'openstation_living_tree_register_routes' );

function openstation_living_tree_rest_snapshot() {
	$snapshot = get_transient( OPENSTATION_LIVING_TREE_CACHE_KEY );

	if ( ! is_array( $snapshot ) || ! array_key_exists( OPENSTATION_LIVING_TREE_GATED_TRAFFIC_KEY, $snapshot ) ) {
		$snapshot = openstation_living_tree_build_cache_entry();
		set_transient(
			OPENSTATION_LIVING_TREE_CACHE_KEY,
			$snapshot,
			OPENSTATION_LIVING_TREE_CACHE_TTL
		);
	}

	return rest_ensure_response( openstation_living_tree_snapshot_for_caller( $snapshot ) );
}

function openstation_living_tree_snapshot_for_caller( $snapshot ) {
	$gated = isset( $snapshot[ OPENSTATION_LIVING_TREE_GATED_TRAFFIC_KEY ] )
		? (int) $snapshot[ OPENSTATION_LIVING_TREE_GATED_TRAFFIC_KEY ]
		: 0;
	unset( $snapshot[ OPENSTATION_LIVING_TREE_GATED_TRAFFIC_KEY ] );

	if ( ! openstation_site_views_user_can_read_jetpack() ) {
		$snapshot['traffic'] = $gated;
	}
	return $snapshot;
}

function openstation_living_tree_build_cache_entry() {
	$fields   = openstation_living_tree_snapshot_fields();
	$snapshot = openstation_living_tree_filter_snapshot( $fields );
	$gated    = $snapshot['traffic'] ?? 0;

	if ( openstation_site_views_jetpack_stats_active() ) {
		$fields['traffic'] = openstation_living_tree_traffic( false );
		$gated             = openstation_living_tree_filter_snapshot( $fields )['traffic'] ?? 0;
	}

	$snapshot[ OPENSTATION_LIVING_TREE_GATED_TRAFFIC_KEY ] = max( 0, (int) $gated );
	return $snapshot;
}

function openstation_living_tree_flush_cache() {
	delete_transient( OPENSTATION_LIVING_TREE_CACHE_KEY );
}
add_action( 'save_post', 'openstation_living_tree_flush_cache' );
add_action( 'deleted_post', 'openstation_living_tree_flush_cache' );
add_action( 'comment_post', 'openstation_living_tree_flush_cache' );

function openstation_living_tree_build_snapshot() {
	return openstation_living_tree_filter_snapshot( openstation_living_tree_snapshot_fields() );
}

function openstation_living_tree_snapshot_fields() {
	$posts    = wp_count_posts( 'post' );
	$pages    = wp_count_posts( 'page' );
	$comments = wp_count_comments();

	$categories = wp_count_terms( array( 'taxonomy' => 'category' ) );
	$tags       = wp_count_terms( array( 'taxonomy' => 'post_tag' ) );

	return array(
		'siteUrl'         => (string) home_url(),
		'siteName'        => (string) get_bloginfo( 'name' ),
		'installEpoch'    => openstation_living_tree_install_epoch(),
		'siteAgeDays'     => openstation_living_tree_site_age_days(),
		'totalPosts'      => isset( $posts->publish ) ? (int) $posts->publish : 0,
		'totalPages'      => isset( $pages->publish ) ? (int) $pages->publish : 0,
		'totalCategories' => is_wp_error( $categories ) ? 0 : (int) $categories,
		'totalTags'       => is_wp_error( $tags ) ? 0 : (int) $tags,
		'totalComments'   => isset( $comments->approved ) ? (int) $comments->approved : 0,
		'activeUsers'     => openstation_living_tree_active_users(),
		'traffic'         => openstation_living_tree_traffic(),
		'seoHealth'       => openstation_living_tree_seo_health(),
		'performance'     => openstation_living_tree_performance(),
		'branches'        => openstation_living_tree_branch_dna(),
	);
}

function openstation_living_tree_filter_snapshot( $snapshot ) {

	return apply_filters( 'openstation_living_tree_snapshot', $snapshot );
}
