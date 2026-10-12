<?php
/**
 * OpenStation — Living Tree: REST snapshot endpoint.
 *
 * One route: `GET desktop-mode/v1/living-tree/snapshot`. Returns the
 * compact site DNA (`TreeSnapshot` in the JS types) — aggregate counts
 * and branch hints — never the full post list. The client turns this
 * into hormones and never sees rows.
 *
 * `siteUrl` + `siteName` + `installEpoch` together form the determinism
 * seed. The site NAME is deliberately part of it: two different blogs can
 * share a URL shape (two installs on localhost, staging clones), and
 * their trees must still be individuals.
 *
 * The response is cached in a transient (TTL 6h) and invalidated whenever
 * content changes (`save_post` / `deleted_post` / `comment_post`). One
 * field is settled per caller after the cache: `traffic`, when it comes
 * from Jetpack Stats, see {@see openstation_living_tree_snapshot_for_caller()}.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Transient key the built snapshot is cached under.
 *
 * The VALUE keeps its pre-rebrand spelling on purpose, so live caches
 * stay addressable. The mismatch between this constant's name and its
 * value is deliberate — it is NOT a half-finished rename.
 *
 * Not to be confused with the `openstation_living_tree_snapshot` filter,
 * which once shared this string and is now deliberately decoupled.
 */
const OPENSTATION_LIVING_TREE_CACHE_KEY = 'desktop_mode_living_tree_snapshot';

/** Cache lifetime for the snapshot. */
const OPENSTATION_LIVING_TREE_CACHE_TTL = 6 * HOUR_IN_SECONDS;

/**
 * Key the cached snapshot keeps its second `traffic` value under: the
 * one resolved without Jetpack Stats, for a caller outside Jetpack's
 * stats gate. Never served, see
 * {@see openstation_living_tree_snapshot_for_caller()}.
 */
const OPENSTATION_LIVING_TREE_GATED_TRAFFIC_KEY = 'trafficWithoutJetpack';

/**
 * Whether the current user may read the Living Tree snapshot.
 *
 * Defaults to `read` — anyone who can see the admin can see the wallpaper
 * of their own site. Filterable so a site can widen or restrict it.
 *
 * @return bool
 */
function openstation_living_tree_user_can_use() {
	$can = current_user_can( 'read' );

	/**
	 * Filter whether the current user can read the Living Tree snapshot.
	 *
	 * @param bool $can Default: the `read` capability.
	 */
	return (bool) apply_filters( 'openstation_living_tree_user_can_use', $can );
}

/**
 * Register the snapshot route.
 */
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

/**
 * GET /living-tree/snapshot — cached snapshot response.
 *
 * @return WP_REST_Response
 */
function openstation_living_tree_rest_snapshot() {
	$snapshot = get_transient( OPENSTATION_LIVING_TREE_CACHE_KEY );
	// A cache entry without the gated value was built before it existed,
	// and could hand a Jetpack total to the wrong caller: build it again.
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

/**
 * The snapshot as the current caller may read it.
 *
 * On a site where Jetpack Stats is counting, `traffic` is the sum of
 * the daily rows the site-views widget serves only behind Jetpack's
 * stats gate, and a total over withheld rows gives away what the rows
 * hide. A caller outside that gate gets the value the cache entry
 * keeps for them instead, resolved without Jetpack, see
 * {@see openstation_living_tree_build_cache_entry()}.
 *
 * Runs on the way out, after the cache, so the transient stays the
 * same for every caller and nothing is read again per request.
 *
 * @param array $snapshot The cache entry.
 * @return array The snapshot as served, without the gated value's key.
 */
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

/**
 * Build the snapshot as it is cached: the served snapshot plus the
 * `traffic` a caller outside Jetpack's stats gate gets.
 *
 * Where Jetpack Stats is on, that value comes from the traffic ladder
 * without Jetpack (the post-views meta, then the
 * `openstation_living_tree_traffic` filter) and goes through the
 * `openstation_living_tree_snapshot` filter like the served one, so the
 * filter runs twice per build. Elsewhere the two are the same value.
 *
 * Both are worked out here, once per cache build, so serving a caller
 * outside the gate costs no reads.
 *
 * @return array
 */
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

/**
 * Invalidate the cached snapshot. Wired to the content-mutation hooks so
 * the tree re-DNAs on the next load after the site changes.
 */
function openstation_living_tree_flush_cache() {
	delete_transient( OPENSTATION_LIVING_TREE_CACHE_KEY );
}
add_action( 'save_post', 'openstation_living_tree_flush_cache' );
add_action( 'deleted_post', 'openstation_living_tree_flush_cache' );
add_action( 'comment_post', 'openstation_living_tree_flush_cache' );

/**
 * Build the compact site DNA snapshot.
 *
 * Aggregates only. Every metric is capped / normalised so any topology
 * yields a well-formed snapshot — the golden rule (WordPress emits
 * hormones, never geometry) lives here: this function must never leak a
 * per-post coordinate or identity into the payload.
 *
 * @return array The snapshot, matching the JS `TreeSnapshot` shape.
 */
function openstation_living_tree_build_snapshot() {
	return openstation_living_tree_filter_snapshot( openstation_living_tree_snapshot_fields() );
}

/**
 * The snapshot's fields as read from the site, before the
 * `openstation_living_tree_snapshot` filter.
 *
 * @return array
 */
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

/**
 * Run the snapshot filter over a set of fields.
 *
 * @param array $snapshot The fields from {@see openstation_living_tree_snapshot_fields()}.
 * @return array
 */
function openstation_living_tree_filter_snapshot( $snapshot ) {
	/**
	 * Filter the Living Tree snapshot before it is cached and served.
	 * Keep the shape intact — the JS client validates nothing; it trusts
	 * this contract. Aggregates only: never add per-post identities or
	 * coordinates (the golden rule).
	 *
	 * @param array $snapshot The compact site DNA.
	 */
	return apply_filters( 'openstation_living_tree_snapshot', $snapshot );
}
