<?php
/**
 * Posts app — the taxonomy surface the Categories and Tags canvases
 * read: the `openstation_count` / `openstation_is_default` REST fields
 * on category and post_tag, the shared terms cache version, and the
 * `/desktop-mode/v1/term-counts` and `/tag-cooccurrence` routes.
 *
 * Plain PHP part of `apps/posts/posts.os.php`, pulled in with
 * `require_once`; the function and hook names are the ones the docs
 * list, unchanged.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * The permission callback both routes share: the surface is the Posts
 * window's, so it opens to whoever can edit posts.
 *
 * @return bool
 */
function openstation_posts_window_rest_permission() {
	return current_user_can( 'edit_posts' );
}

/**
 * Surface a "non-trashed posts" count alongside core's `count` field
 * on category + post_tag REST responses.
 *
 * Core's `term_taxonomy.count` is updated by
 * `_update_post_term_count()`, which only includes posts in the
 * `publish` status by default. The Categories + Tags tabs in the
 * native Posts window want to surface DRAFT and PENDING posts too,
 * so the user can see "this category has 3 unpublished drafts" — a
 * detail core's count silently hides.
 *
 * The field is `openstation_count` and lives on the term object in
 * REST view context. The per-term query is one cheap COUNT(*) on a
 * pre-indexed join, so 50 terms = 50 light queries — acceptable for
 * an admin UI.
 */
function openstation_posts_window_register_count_field() {
	foreach ( array( 'category', 'post_tag' ) as $taxonomy ) {
		register_rest_field(
			$taxonomy,
			'openstation_count',
			array(
				'get_callback' => 'openstation_posts_window_term_count_any',
				'schema'       => array(
					'description' => __( 'Number of non-trashed posts (any status) in this term.', 'desktop-mode' ),
					'type'        => 'integer',
					'context'     => array( 'view', 'embed' ),
					'readonly'    => true,
				),
			)
		);
		// Mark the taxonomy's "default" term — the fallback that
		// receives uncategorised posts. Localised installs rename
		// the slug + name so a JS-side "uncategorized" string match
		// fails (Spanish: "Sin categoría"); the option is the only
		// reliable id.
		register_rest_field(
			$taxonomy,
			'openstation_is_default',
			array(
				'get_callback' => 'openstation_posts_window_term_is_default',
				'schema'       => array(
					'description' => __( 'Whether this term is the taxonomy\'s default (fallback) term.', 'desktop-mode' ),
					'type'        => 'boolean',
					'context'     => array( 'view', 'embed' ),
					'readonly'    => true,
				),
			)
		);
	}
}
add_action( 'rest_api_init', 'openstation_posts_window_register_count_field' );

/**
 * Shared site-wide cache version for any term-derived endpoint
 * payload (bulk counts, tag cooccurrence, …). Stored in a non-
 * autoloaded option and bumped by
 * `openstation_posts_window_terms_cache_invalidate()` whenever a
 * post/term change could move the derived data. The version is
 * baked into every transient cache key, so a single
 * `update_option()` retires the entire family of cached payloads
 * in one stroke — no enumerating keys, no race window where an
 * old entry might still be served. Stale entries fall out of the
 * DB naturally via the transient TTL.
 */
function openstation_posts_window_terms_cache_version() {
	$v = (int) get_option( 'desktop_mode_terms_cache_version', 0 );
	if ( $v <= 0 ) {
		$v = 1;
		// autoload = false so this doesn't ride on every page load.
		update_option( 'desktop_mode_terms_cache_version', $v, false );
	}
	return $v;
}

/**
 * Invalidate every cached terms-derived payload by incrementing
 * the shared version. The next call to any cached endpoint will
 * miss its transient lookup, recompute, and store under the new
 * key.
 *
 * Hooked to a handful of "post→term graph changed" actions below.
 * The signature is intentionally argument-tolerant — each hook
 * passes different positional args (object_id, term_id, taxonomy,
 * …) and PHP just ignores extras for a no-param target.
 */
function openstation_posts_window_terms_cache_invalidate() {
	$v = openstation_posts_window_terms_cache_version();
	update_option(
		'desktop_mode_terms_cache_version',
		$v + 1,
		false
	);
}
// Direct post→term graph changes. `set_object_terms` fires whenever
// `wp_set_object_terms()` runs — covers post saves that change
// terms, term-delete cleanup, REST PATCH on a post's tags array,
// classic-editor flows, the lot. It's the ground truth.
add_action( 'set_object_terms', 'openstation_posts_window_terms_cache_invalidate' );
// Term identity changes — a renamed term doesn't shift pair counts
// but a deleted term does (its relationships go away). Invalidating
// on every term mutation costs one option write per edit, which is
// fine for the typical category/tag edit cadence.
add_action( 'created_term', 'openstation_posts_window_terms_cache_invalidate' );
add_action( 'edited_term', 'openstation_posts_window_terms_cache_invalidate' );
add_action( 'delete_term', 'openstation_posts_window_terms_cache_invalidate' );
// Status flips that change what the SQL counts. Both endpoints
// exclude 'trash', 'auto-draft', and 'inherit'; trashing or
// restoring a post adds and removes counts/pairs from the graph.
add_action( 'wp_trash_post', 'openstation_posts_window_terms_cache_invalidate' );
add_action( 'untrashed_post', 'openstation_posts_window_terms_cache_invalidate' );
// Pre-delete fires while term_relationships still exist; the row
// will be gone by the time the next query runs. Belt-and-braces
// alongside set_object_terms (which fires during delete cleanup
// on most modern WP versions).
add_action( 'before_delete_post', 'openstation_posts_window_terms_cache_invalidate' );

/**
 * Bulk count endpoint — returns `{ term_id: count }` for every
 * requested term in one query. The `openstation_count` REST field
 * (per-term) is the canonical source, but on installs where the
 * field isn't reaching the response (caching, REST middleware,
 * stale `_fields` whitelist) the JS calls this endpoint as a
 * defensive fallback so node labels never silently show 0.
 *
 * Cached: a single transient holds `{ term_id: count }` for EVERY
 * term in the taxonomy. Each call projects the caller's requested
 * IDs out of that map, so all clients hit the same cache entry
 * regardless of which subset they ask for.
 *
 * GET `/desktop-mode/v1/term-counts?taxonomy=category&ids=1,4,7`
 */
function openstation_posts_window_register_term_counts_route() {
	register_rest_route(
		'desktop-mode/v1',
		'/term-counts',
		array(
			'methods'             => 'GET',
			'callback'            => 'openstation_posts_window_term_counts_callback',
			'permission_callback' => 'openstation_posts_window_rest_permission',
			'args'                => array(
				'taxonomy' => array(
					'required'          => true,
					'type'              => 'string',
					'sanitize_callback' => 'sanitize_key',
				),
				'ids'      => array(
					'required' => true,
					'type'     => 'string',
				),
			),
		)
	);
}
add_action( 'rest_api_init', 'openstation_posts_window_register_term_counts_route' );

/**
 * REST callback: return post counts for a batch of term IDs.
 *
 * Uses a cached full-taxonomy map so multiple windows with
 * different ID subsets share the same transient.
 *
 * @param WP_REST_Request $request Request with `taxonomy` and `ids`.
 * @return array|WP_Error Map of `term_id => count`, or error on bad taxonomy.
 */
function openstation_posts_window_term_counts_callback( $request ) {
	global $wpdb;
	$taxonomy = sanitize_key( (string) $request->get_param( 'taxonomy' ) );
	$tax_obj  = get_taxonomy( $taxonomy );
	if ( ! $tax_obj ) {
		return new WP_Error(
			'openstation_invalid_taxonomy',
			__( 'Unknown taxonomy.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}
	$raw   = (string) $request->get_param( 'ids' );
	$parts = array_map( 'intval', explode( ',', $raw ) );
	$ids   = array_values(
		array_filter(
			$parts,
			function ( $id ) {
				return $id > 0;
			}
		)
	);
	if ( count( $ids ) === 0 ) {
		return array();
	}
	// Cap to avoid runaway IN-clauses if a malicious caller inflates
	// the param. 500 is far above any plausible category/tag count.
	$ids = array_slice( $ids, 0, 500 );

	// Cache strategy: one transient holds the FULL taxonomy's
	// { term_id => count } map. All clients project their requested
	// ID subset out of the same cached map, so a window that asks
	// for IDs [1, 4, 7] and one that asks for [4, 11, 22] share the
	// same cache hit. Key shape: `dmtcnt_v<version>_<taxonomy>`.
	$cache_version = openstation_posts_window_terms_cache_version();
	$cache_key     = sprintf( 'dmtcnt_v%d_%s', $cache_version, $taxonomy );
	$counts        = get_transient( $cache_key );
	if ( ! is_array( $counts ) ) {
		// Mirror WP core's `_update_post_term_count` filtering —
		// limit to the taxonomy's `object_type` (e.g. `post` for
		// category) and exclude statuses core treats as non-counting:
		// - 'trash' + 'auto-draft' → user-not-published-and-never-will-be
		// - 'inherit' → attachment-only status; excluded so attachments
		// aren't double-counted via parent inheritance
		// Everything else (publish, draft, pending, future, private)
		// is included so the user sees a "real" post count, not
		// WP's publish-only term_taxonomy.count.
		$object_types = array_map(
			'sanitize_key',
			(array) $tax_obj->object_type
		);
		$object_types = array_filter( $object_types, 'post_type_exists' );
		if ( empty( $object_types ) ) {
			$object_types = array( 'post' );
		}
		$type_placeholders = implode( ',', array_fill( 0, count( $object_types ), '%s' ) );
		$rows              = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT tt.term_id, COUNT(p.ID) AS cnt
				 FROM {$wpdb->term_taxonomy} tt
				 LEFT JOIN {$wpdb->term_relationships} tr
				   ON tr.term_taxonomy_id = tt.term_taxonomy_id
				 LEFT JOIN {$wpdb->posts} p
				   ON p.ID = tr.object_id
				   AND p.post_status NOT IN ( 'trash', 'auto-draft', 'inherit' )
				   AND p.post_type IN ( $type_placeholders )
				 WHERE tt.taxonomy = %s
				 GROUP BY tt.term_id",
				array_merge( $object_types, array( $taxonomy ) )
			),
			ARRAY_A
		);
		$counts            = array();
		foreach ( (array) $rows as $row ) {
			$counts[ (string) (int) $row['term_id'] ] = (int) $row['cnt'];
		}
		set_transient( $cache_key, $counts, DAY_IN_SECONDS );
	}

	// Project the caller's requested IDs out of the (cached or
	// fresh) full map. Missing IDs return 0 to match the legacy
	// shape — a caller looking up a term that no longer exists or
	// has no associated posts still gets a zero, not a missing key.
	$out = array();
	foreach ( $ids as $id ) {
		$key         = (string) $id;
		$out[ $key ] = isset( $counts[ $key ] ) ? (int) $counts[ $key ] : 0;
	}
	return $out;
}

/**
 * REST: tag co-occurrence aggregator. Returns, for each tag, its
 * top-N most frequently co-occurring sibling tags + the shared
 * post count. Used by the Tags window to precluster the pixi
 * cloud — tags that appear together on the same post get pulled
 * toward each other after the spiral pack.
 *
 * GET `/desktop-mode/v1/tag-cooccurrence?taxonomy=post_tag&limit=8`
 *
 * Response:
 *   { "pairs": { "<tagId>": [ { "id": <neighborId>, "shared": N }, … ] } }
 *
 * Status filtering mirrors `_update_post_term_count` (exclude
 * trash, auto-draft, inherit). Post type is bounded to the
 * taxonomy's declared `object_type` so e.g. page-attached terms
 * don't bleed into the post-tag graph.
 */
function openstation_posts_window_register_tag_cooccurrence_route() {
	register_rest_route(
		'desktop-mode/v1',
		'/tag-cooccurrence',
		array(
			'methods'             => 'GET',
			'callback'            => 'openstation_posts_window_tag_cooccurrence_callback',
			'permission_callback' => 'openstation_posts_window_rest_permission',
			'args'                => array(
				'taxonomy' => array(
					'required'          => false,
					'type'              => 'string',
					'default'           => 'post_tag',
					'sanitize_callback' => 'sanitize_key',
				),
				'limit'    => array(
					'required' => false,
					'type'     => 'integer',
					'default'  => 8,
				),
			),
		)
	);
}
add_action( 'rest_api_init', 'openstation_posts_window_register_tag_cooccurrence_route' );

/**
 * REST callback: return tag co-occurrence data for the pixi
 * cloud. For each tag, returns its top-N most frequently
 * co-occurring sibling tags with the shared post count.
 *
 * @param WP_REST_Request $request Request with `taxonomy` and `limit`.
 * @return WP_REST_Response|WP_Error
 */
function openstation_posts_window_tag_cooccurrence_callback( $request ) {
	global $wpdb;

	$taxonomy = sanitize_key( (string) $request->get_param( 'taxonomy' ) );
	$tax_obj  = get_taxonomy( $taxonomy );
	if ( ! $tax_obj ) {
		return new WP_Error(
			'openstation_invalid_taxonomy',
			__( 'Unknown taxonomy.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}

	$limit = (int) $request->get_param( 'limit' );
	if ( $limit <= 0 ) {
		$limit = 8;
	}
	// Cap so a malicious caller can't fan out the response. 24 is
	// far more neighbors than any layout pass actually consumes.
	$limit = min( 24, $limit );

	// Cache lookup. The key bakes in the current version so a single
	// option bump makes every old entry unreachable without us
	// having to enumerate keys. Taxonomy + limit are part of the key
	// because they change the response shape.
	$cache_version = openstation_posts_window_terms_cache_version();
	$cache_key     = sprintf(
		'dmwco_v%d_%s_l%d',
		$cache_version,
		$taxonomy,
		$limit
	);
	$cached        = get_transient( $cache_key );
	if ( is_array( $cached ) && isset( $cached['pairs'] ) ) {
		return rest_ensure_response( $cached );
	}

	$object_types = array_map(
		'sanitize_key',
		(array) $tax_obj->object_type
	);
	$object_types = array_filter( $object_types, 'post_type_exists' );
	if ( empty( $object_types ) ) {
		$object_types = array( 'post' );
	}
	$type_placeholders = implode( ',', array_fill( 0, count( $object_types ), '%s' ) );

	// One scan: every (post, term) row in the taxonomy on a
	// non-trashed, non-attachment-inherited post of the right type.
	// Sorted by post so we can walk in O(n) and emit pairs per post.
	$rows = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT tr.object_id, tt.term_id
			 FROM {$wpdb->term_relationships} tr
			 INNER JOIN {$wpdb->term_taxonomy} tt
			   ON tr.term_taxonomy_id = tt.term_taxonomy_id
			 INNER JOIN {$wpdb->posts} p
			   ON p.ID = tr.object_id
			   AND p.post_status NOT IN ( 'trash', 'auto-draft', 'inherit' )
			   AND p.post_type IN ( $type_placeholders )
			 WHERE tt.taxonomy = %s
			 ORDER BY tr.object_id",
			array_merge( $object_types, array( $taxonomy ) )
		),
		ARRAY_A
	);

	// Group term ids per post, then emit pair counts. Sort each
	// post's term list so we can walk i<j and double-write into the
	// symmetric pair map (a→b and b→a both get incremented).
	$pairs       = array(); // term_id => array( neighbor_id => shared_count )
	$current_id  = 0;
	$current_set = array();
	$flush       = function () use ( &$current_set, &$pairs ) {
		$ids = array_values( array_unique( $current_set ) );
		$n   = count( $ids );
		if ( $n < 2 ) {
			return;
		}
		sort( $ids, SORT_NUMERIC );
		for ( $i = 0; $i < $n; $i++ ) {
			$a = $ids[ $i ];
			for ( $j = $i + 1; $j < $n; $j++ ) {
				$b = $ids[ $j ];
				if ( ! isset( $pairs[ $a ][ $b ] ) ) {
					$pairs[ $a ][ $b ] = 0;
				}
				if ( ! isset( $pairs[ $b ][ $a ] ) ) {
					$pairs[ $b ][ $a ] = 0;
				}
				++$pairs[ $a ][ $b ];
				++$pairs[ $b ][ $a ];
			}
		}
	};
	foreach ( (array) $rows as $row ) {
		$post_id = (int) $row['object_id'];
		$term_id = (int) $row['term_id'];
		if ( $post_id !== $current_id ) {
			$flush();
			$current_id  = $post_id;
			$current_set = array();
		}
		$current_set[] = $term_id;
	}
	$flush();

	// Trim each tag's neighbor list to top-N by shared count, then
	// reshape into the response payload. Keep string keys so JSON
	// preserves them as numeric-looking object properties.
	$result = array();
	foreach ( $pairs as $tag_id => $neighbors ) {
		arsort( $neighbors, SORT_NUMERIC );
		$top  = array_slice( $neighbors, 0, $limit, true );
		$list = array();
		foreach ( $top as $neighbor_id => $shared ) {
			$list[] = array(
				'id'     => (int) $neighbor_id,
				'shared' => (int) $shared,
			);
		}
		$result[ (string) (int) $tag_id ] = $list;
	}

	$payload = array( 'pairs' => $result );
	// Store under the version-stamped key. TTL is a day; an
	// invalidation hook bump retires the key sooner. The DAY ceiling
	// is the floor on cache staleness if every invalidation hook
	// somehow missed firing.
	set_transient( $cache_key, $payload, DAY_IN_SECONDS );

	return rest_ensure_response( $payload );
}

/**
 * REST get_callback for `openstation_is_default`. Reads the
 * taxonomy's default-term option (e.g. `default_category`) and
 * compares against the current term's id.
 *
 * @param array $term Term array as serialized by core's REST term controller.
 * @return bool
 */
function openstation_posts_window_term_is_default( $term ) {
	$taxonomy = isset( $term['taxonomy'] ) ? (string) $term['taxonomy'] : '';
	$term_id  = isset( $term['id'] ) ? (int) $term['id'] : 0;
	if ( '' === $taxonomy || $term_id <= 0 ) {
		return false;
	}
	$option_key = 'default_' . $taxonomy; // 'default_category', 'default_post_tag', …
	$default_id = (int) get_option( $option_key, 0 );
	return $default_id > 0 && $default_id === $term_id;
}

/**
 * REST get_callback for `openstation_count`. Counts every post in
 * the term except trashed + auto-draft (mirrors what users
 * conceptually mean by "posts in this category").
 *
 * @param array $term Term array as serialized by core's REST term controller.
 * @return int
 */
function openstation_posts_window_term_count_any( $term ) {
	global $wpdb;
	$taxonomy = isset( $term['taxonomy'] ) ? (string) $term['taxonomy'] : '';
	$term_id  = isset( $term['id'] ) ? (int) $term['id'] : 0;
	$tt_id    = isset( $term['term_taxonomy_id'] ) ? (int) $term['term_taxonomy_id'] : 0;
	if ( $tt_id <= 0 && $term_id > 0 && '' !== $taxonomy ) {
		$tt_id = (int) $wpdb->get_var(
			$wpdb->prepare(
				"SELECT term_taxonomy_id FROM {$wpdb->term_taxonomy} WHERE term_id = %d AND taxonomy = %s LIMIT 1",
				$term_id,
				$taxonomy
			)
		);
	}
	if ( $tt_id <= 0 ) {
		return 0;
	}
	// Match WP core's `_update_post_term_count` filtering — limit to
	// the taxonomy's registered object_type and exclude statuses
	// core treats as non-counting (trash / auto-draft / inherit).
	$tax_obj      = $taxonomy ? get_taxonomy( $taxonomy ) : null;
	$object_types = $tax_obj
		? array_filter( (array) $tax_obj->object_type, 'post_type_exists' )
		: array( 'post' );
	if ( empty( $object_types ) ) {
		$object_types = array( 'post' );
	}
	$type_placeholders = implode( ',', array_fill( 0, count( $object_types ), '%s' ) );
	return (int) $wpdb->get_var(
		$wpdb->prepare(
			"SELECT COUNT(*) FROM {$wpdb->term_relationships} tr
			 JOIN {$wpdb->posts} p ON p.ID = tr.object_id
			 WHERE tr.term_taxonomy_id = %d
			 AND p.post_status NOT IN ( 'trash', 'auto-draft', 'inherit' )
			 AND p.post_type IN ( $type_placeholders )",
			array_merge( array( $tt_id ), $object_types )
		)
	);
}
