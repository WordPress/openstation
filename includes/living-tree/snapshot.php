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
 * content changes (`save_post` / `deleted_post` / `comment_post`).
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
	$cached = get_transient( OPENSTATION_LIVING_TREE_CACHE_KEY );
	if ( is_array( $cached ) ) {
		return rest_ensure_response( $cached );
	}

	$snapshot = openstation_living_tree_build_snapshot();
	set_transient(
		OPENSTATION_LIVING_TREE_CACHE_KEY,
		$snapshot,
		OPENSTATION_LIVING_TREE_CACHE_TTL
	);

	return rest_ensure_response( $snapshot );
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
	$posts    = wp_count_posts( 'post' );
	$pages    = wp_count_posts( 'page' );
	$comments = wp_count_comments();

	$categories = wp_count_terms( array( 'taxonomy' => 'category' ) );
	$tags       = wp_count_terms( array( 'taxonomy' => 'post_tag' ) );

	$snapshot = array(
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
