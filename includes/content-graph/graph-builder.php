<?php
/**
 * Desktop Mode — Content Graph: graph builder.
 *
 * Walks the WordPress post store to produce two arrays for the bundle:
 *
 *   - `nodes`  — one entry per post matching the requested types.
 *   - `edges`  — one entry per internal hyperlink found in any node's
 *                `post_content`, deduped, with self-edges suppressed.
 *
 * The expensive piece is the link extraction: every published post in
 * scope is parsed with `DOMDocument`, every `<a href>` is scanned, and
 * each href is resolved with `url_to_postid()`. We cache the full
 * `{ nodes, edges }` tuple in a transient keyed on the requested
 * `types`, the viewer's private-post privilege tier, plus a hash of
 * the relevant rows' `post_modified_gmt`. Any
 * change to a participating post invalidates the hash, so save_post
 * implicitly refreshes the graph the next time it's requested. We
 * also explicitly bust the cache on `save_post` and `deleted_post` so
 * editors don't see stale data even if some other process pre-warms
 * the transient.
 *
 * @package WPDesktopMode
 * @since   0.8.2
 */

defined( 'ABSPATH' ) || exit;

// Bump the suffix whenever the cached payload shape changes — older
// transients still alive at upgrade time would otherwise return the
// previous schema (e.g. missing per-node `contributor_ids`) and
// surface as runtime errors on the client. Each bump is a one-time
// cache miss for every site that updates the plugin.
const DESKTOP_MODE_CONTENT_GRAPH_TRANSIENT_PREFIX = 'desktop_mode_cg3_';
const DESKTOP_MODE_CONTENT_GRAPH_TRANSIENT_TTL    = 6 * HOUR_IN_SECONDS;

/**
 * Build (or reuse the cached version of) the graph payload for the
 * requested post types.
 *
 * @since 0.8.2
 *
 * @param string[] $types Post type slugs. Filtered against the public
 *                        post-type registry, attachments excluded.
 * @return array{
 *     nodes: array<int, array{
 *         id: int, type: string, title: string, status: string,
 *         slug: string, edit_url: string,
 *         author_id: int, contributor_ids: int[],
 *         year: int, year_month: string,
 *         category_ids: int[], tag_ids: int[]
 *     }>,
 *     edges: array<int, array{ from: int, to: int }>,
 *     groups: array{
 *         authors: array<int, array{ name: string }>,
 *         categories: array<int, array{ name: string }>,
 *         tags: array<int, array{ name: string }>
 *     },
 *     stats: array{ nodes: int, edges: int, generated_at: int }
 * }
 */
function desktop_mode_content_graph_build( array $types ) {
	$types = desktop_mode_content_graph_normalize_types( $types );
	if ( empty( $types ) ) {
		return array(
			'nodes'  => array(),
			'edges'  => array(),
			'groups' => array(
				'authors'    => array(),
				'categories' => array(),
				'tags'       => array(),
			),
			'stats'  => array(
				'nodes'        => 0,
				'edges'        => 0,
				'generated_at' => time(),
			),
		);
	}

	$cache_key = desktop_mode_content_graph_cache_key( $types );
	$cached    = get_transient( $cache_key );
	if ( is_array( $cached ) && isset( $cached['nodes'], $cached['edges'] ) ) {
		return $cached;
	}

	$rows = desktop_mode_content_graph_fetch_rows( $types );

	$post_ids = array();
	foreach ( $rows as $row ) {
		$post_ids[] = (int) $row->ID;
	}

	$terms_by_post = desktop_mode_content_graph_collect_post_terms( $post_ids );
	// Distinct revision authors per post — used to pull collaborator
	// posts toward both the primary author's cluster AND the
	// contributor's clusters when grouping by author. Bulk-queried so
	// we don't N+1 `wp_get_post_revisions` per node.
	$contribs_by_post = desktop_mode_content_graph_collect_post_contributors( $post_ids );

	$default_category = max( 1, (int) get_option( 'default_category', 1 ) );

	$nodes       = array();
	$nodes_by_id = array();
	$author_ids  = array();
	$cat_ids     = array();
	$tag_ids     = array();
	foreach ( $rows as $row ) {
		$id              = (int) $row->ID;
		$author_id       = (int) $row->post_author;
		$year            = 0;
		$year_month      = '';
		if ( ! empty( $row->post_date ) ) {
			// Use post_date (site-local) rather than post_date_gmt for the
			// "year published" / "year-month published" buckets — editors
			// think in their own timezone.
			$year       = (int) mysql2date( 'Y', $row->post_date, false );
			$year_month = (string) mysql2date( 'Y-m', $row->post_date, false );
		}
		$post_cats = isset( $terms_by_post[ $id ]['category'] )
			? $terms_by_post[ $id ]['category']
			: array();
		// A category-supporting post with zero terms is what WP treats
		// as "in the default category" at authoring time (core auto-
		// assigns it on save for `post`). Mirror that here so such
		// posts group under the real default-category cluster instead
		// of the client's synthetic "Uncategorized" pseudo-cluster
		// (`cat:uncat`, kept client-side only as a stale-payload
		// fallback).
		if ( empty( $post_cats ) && is_object_in_taxonomy( $row->post_type, 'category' ) ) {
			$post_cats = array( $default_category );
		}
		$post_tags = isset( $terms_by_post[ $id ]['post_tag'] )
			? $terms_by_post[ $id ]['post_tag']
			: array();
		$contribs = isset( $contribs_by_post[ $id ] )
			? $contribs_by_post[ $id ]
			: array();
		// Strip the primary author from the contributor list — the
		// node carries that separately in `author_id`, and surfacing
		// it twice on the client would push the post toward its own
		// primary cluster with no balancing contributor pull.
		if ( $author_id > 0 && ! empty( $contribs ) ) {
			$contribs = array_values(
				array_filter(
					$contribs,
					static function ( $cid ) use ( $author_id ) {
						return (int) $cid !== $author_id;
					}
				)
			);
		}

		$node = array(
			'id'              => $id,
			'type'            => (string) $row->post_type,
			'title'           => (string) get_the_title( $row ),
			'status'          => (string) $row->post_status,
			'slug'            => (string) $row->post_name,
			'edit_url'        => (string) get_edit_post_link( $id, 'raw' ),
			'author_id'       => $author_id,
			'contributor_ids' => $contribs,
			'year'            => $year,
			'year_month'      => $year_month,
			'category_ids'    => $post_cats,
			'tag_ids'         => $post_tags,
		);
		$nodes[]            = $node;
		$nodes_by_id[ $id ] = true;
		if ( $author_id > 0 ) {
			$author_ids[ $author_id ] = true;
		}
		foreach ( $contribs as $cid ) {
			if ( (int) $cid > 0 ) {
				$author_ids[ (int) $cid ] = true;
			}
		}
		foreach ( $post_cats as $tid ) {
			$cat_ids[ (int) $tid ] = true;
		}
		foreach ( $post_tags as $tid ) {
			$tag_ids[ (int) $tid ] = true;
		}
	}

	$groups = array(
		'authors'    => desktop_mode_content_graph_format_author_catalog( array_keys( $author_ids ) ),
		'categories' => desktop_mode_content_graph_format_term_catalog( array_keys( $cat_ids ), 'category' ),
		'tags'       => desktop_mode_content_graph_format_term_catalog( array_keys( $tag_ids ), 'post_tag' ),
	);

	$edges_seen = array();
	$edges      = array();
	foreach ( $rows as $row ) {
		$from = (int) $row->ID;
		$tos  = desktop_mode_content_graph_extract_internal_links( (string) $row->post_content );
		foreach ( $tos as $to ) {
			if ( $to === $from ) {
				continue;
			}
			if ( empty( $nodes_by_id[ $to ] ) ) {
				// Linked post exists but is not in the requested types
				// scope, or is not a published post. Skip; the user
				// can widen the filter to surface it.
				continue;
			}
			$key = $from . '->' . $to;
			if ( isset( $edges_seen[ $key ] ) ) {
				continue;
			}
			$edges_seen[ $key ] = true;
			$edges[]            = array(
				'from' => $from,
				'to'   => $to,
			);
		}
	}

	$payload = array(
		'nodes'  => $nodes,
		'edges'  => $edges,
		'groups' => $groups,
		'stats'  => array(
			'nodes'        => count( $nodes ),
			'edges'        => count( $edges ),
			'generated_at' => time(),
		),
	);

	set_transient( $cache_key, $payload, DESKTOP_MODE_CONTENT_GRAPH_TRANSIENT_TTL );

	return $payload;
}

/**
 * Filter, sanitize, and uniquify the requested type slugs against the
 * public post-type registry. Returned slugs are guaranteed to exist
 * AND to be among the slugs declared by
 * `desktop_mode_content_graph_post_types()`.
 *
 * @since 0.8.2
 *
 * @param string[] $types
 * @return string[]
 */
function desktop_mode_content_graph_normalize_types( array $types ) {
	$allowed = array();
	foreach ( desktop_mode_content_graph_post_types() as $entry ) {
		if ( ! empty( $entry['slug'] ) ) {
			$allowed[ (string) $entry['slug'] ] = true;
		}
	}
	$out = array();
	foreach ( $types as $slug ) {
		$slug = sanitize_key( (string) $slug );
		if ( '' !== $slug && isset( $allowed[ $slug ] ) ) {
			$out[ $slug ] = true;
		}
	}
	return array_keys( $out );
}

/**
 * Build the SQL WHERE fragment (plus its `prepare()` values and a
 * cache-key signature) scoping graph rows to posts the current user
 * is allowed to read.
 *
 * Published posts are always in scope. Private posts of a type are
 * only included when the user holds that type's `read_private_posts`
 * capability; for the remaining types the user still sees their OWN
 * private posts (mirroring core's `WP_Query` status semantics for
 * logged-in users).
 *
 * The `key` element encodes the resulting privilege tier (and, when
 * the own-author clause is active, the user id) so cached payloads
 * are never served across privilege levels.
 *
 * @since 0.9.2
 *
 * @param string[] $types Already normalized.
 * @return array{ where: string, values: array, key: string }
 */
function desktop_mode_content_graph_visibility_sql( array $types ) {
	$placeholders = implode( ',', array_fill( 0, count( $types ), '%s' ) );
	$values       = $types;

	$priv_types = array();
	foreach ( $types as $type ) {
		$type_obj = get_post_type_object( $type );
		$cap      = ( $type_obj && ! empty( $type_obj->cap->read_private_posts ) )
			? $type_obj->cap->read_private_posts
			: 'read_private_posts';
		if ( current_user_can( $cap ) ) {
			$priv_types[] = $type;
		}
	}

	$status_clauses = array( "post_status = 'publish'" );
	$key_parts      = array( 'priv=' . implode( ',', $priv_types ) );

	if ( ! empty( $priv_types ) ) {
		$priv_placeholders = implode( ',', array_fill( 0, count( $priv_types ), '%s' ) );
		$status_clauses[]  = "( post_status = 'private' AND post_type IN ( {$priv_placeholders} ) )";
		$values            = array_merge( $values, $priv_types );
	}

	$user_id = get_current_user_id();
	if ( $user_id > 0 && count( $priv_types ) < count( $types ) ) {
		$status_clauses[] = "( post_status = 'private' AND post_author = %d )";
		$values[]         = $user_id;
		$key_parts[]      = 'own=' . $user_id;
	}

	$where = "post_type IN ( {$placeholders} ) AND ( " . implode( ' OR ', $status_clauses ) . ' )';

	return array(
		'where'  => $where,
		'values' => $values,
		'key'    => implode( '|', $key_parts ),
	);
}

/**
 * Cache key for `{ nodes, edges }` for a given type set. Includes a
 * short hash of the participating rows' post_modified_gmt so any
 * relevant edit busts the cache implicitly, plus the viewer's
 * privilege-tier signature so a payload built for a user who can read
 * private posts is never served to one who can't (and vice versa).
 *
 * @since 0.8.2
 *
 * @param string[] $types Already normalized.
 * @return string
 */
function desktop_mode_content_graph_cache_key( array $types ) {
	global $wpdb;
	$visibility = desktop_mode_content_graph_visibility_sql( $types );
	// phpcs:disable WordPress.DB.PreparedSQL.NotPrepared, WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
	$hash = (string) $wpdb->get_var(
		$wpdb->prepare(
			"SELECT MD5( GROUP_CONCAT( CONCAT( ID, ':', post_modified_gmt ) ORDER BY ID ) )
			 FROM {$wpdb->posts}
			 WHERE {$visibility['where']}",
			$visibility['values']
		)
	);
	// phpcs:enable
	if ( '' === $hash || null === $hash ) {
		$hash = 'empty';
	}
	return DESKTOP_MODE_CONTENT_GRAPH_TRANSIENT_PREFIX . substr( md5( implode( ',', $types ) . '|' . $visibility['key'] . '|' . $hash ), 0, 24 );
}

/**
 * Fetch the participating posts in a single query. Returns full rows
 * (including `post_content`) so the link extractor can run without N+1
 * `get_post()` calls.
 *
 * Rows are scoped to what the current user can read: published posts,
 * plus private posts only where the user holds the type's
 * `read_private_posts` capability (or authored the post). See
 * `desktop_mode_content_graph_visibility_sql()`.
 *
 * @since 0.8.2
 *
 * @param string[] $types Already normalized.
 * @return WP_Post[]
 */
function desktop_mode_content_graph_fetch_rows( array $types ) {
	global $wpdb;
	$visibility = desktop_mode_content_graph_visibility_sql( $types );
	// phpcs:disable WordPress.DB.PreparedSQL.NotPrepared, WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
	$rows = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT ID, post_type, post_status, post_title, post_name, post_content, post_author, post_date
			 FROM {$wpdb->posts}
			 WHERE {$visibility['where']}
			 ORDER BY post_date DESC",
			$visibility['values']
		)
	);
	// phpcs:enable

	if ( ! is_array( $rows ) ) {
		return array();
	}

	// Hydrate as WP_Post so get_the_title()/get_edit_post_link() work
	// without additional queries. update_post_caches() warms the
	// objects so subsequent helper calls hit the cache.
	$posts = array();
	foreach ( $rows as $row ) {
		$post    = new WP_Post( $row );
		$posts[] = $post;
	}
	if ( ! empty( $posts ) ) {
		update_post_caches( $posts, '', false, false );
	}
	return $posts;
}

/**
 * Pull every internal-target post id out of a chunk of post_content.
 * Uses DOMDocument for robustness against malformed HTML, then
 * `url_to_postid()` to resolve each href.
 *
 * @since 0.8.2
 *
 * @param string $content
 * @return int[] Unique target post ids (order preserved).
 */
function desktop_mode_content_graph_extract_internal_links( $content ) {
	if ( '' === trim( (string) $content ) ) {
		return array();
	}

	// `<base>` shenanigans aside, url_to_postid() handles relative,
	// absolute, query-string, pretty, and ?p= forms uniformly.
	$ids  = array();
	$seen = array();
	$prev = libxml_use_internal_errors( true );
	$dom  = new DOMDocument();
	// `loadHTML` insists on a charset hint to avoid mangling utf-8.
	$loaded = $dom->loadHTML( '<?xml encoding="utf-8"?>' . $content );
	libxml_clear_errors();
	libxml_use_internal_errors( $prev );
	if ( ! $loaded ) {
		return array();
	}

	$anchors = $dom->getElementsByTagName( 'a' );
	foreach ( $anchors as $anchor ) {
		/** @var DOMElement $anchor */
		$href = trim( (string) $anchor->getAttribute( 'href' ) );
		if ( '' === $href ) {
			continue;
		}
		// Skip obvious non-internal targets fast.
		if ( 0 === strpos( $href, '#' ) ) {
			continue;
		}
		if ( preg_match( '#^(mailto:|tel:|javascript:|data:)#i', $href ) ) {
			continue;
		}
		$post_id = (int) url_to_postid( $href );
		if ( $post_id <= 0 || isset( $seen[ $post_id ] ) ) {
			continue;
		}
		$seen[ $post_id ] = true;
		$ids[]            = $post_id;
	}

	return $ids;
}

/**
 * Cache invalidation. Any post-type change wipes every transient
 * carrying the `desktop_mode_cg_` prefix. We don't have a per-type
 * index so we wipe globally, the cost is one extra build on next
 * open which dominates the time-savings on subsequent opens.
 *
 * @since 0.8.2
 */
function desktop_mode_content_graph_flush_cache() {
	global $wpdb;
	// Enumerate matching transient option names first, then route each
	// through `delete_transient()` so WP's transient/options cache
	// invalidation runs alongside the wp_options delete. The earlier
	// raw `$wpdb->query("DELETE FROM ...")` only cleared the table —
	// any subsequent `get_transient()` in the same process still hit
	// the in-memory options cache and returned the stale payload.
	// This bit the `set_object_terms` invalidation path because that
	// hook doesn't update `post_modified_gmt`, so the cache key stayed
	// identical and `get_transient` (cache hit) returned pre-retag data.
	$prefix_like = $wpdb->esc_like( '_transient_' . DESKTOP_MODE_CONTENT_GRAPH_TRANSIENT_PREFIX ) . '%';
	// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
	$option_names = $wpdb->get_col(
		$wpdb->prepare(
			"SELECT option_name FROM {$wpdb->options} WHERE option_name LIKE %s",
			$prefix_like
		)
	);
	// phpcs:enable
	if ( ! is_array( $option_names ) || empty( $option_names ) ) {
		return;
	}
	$prefix_len = strlen( '_transient_' );
	foreach ( $option_names as $option_name ) {
		$transient = substr( (string) $option_name, $prefix_len );
		if ( '' !== $transient ) {
			delete_transient( $transient );
		}
	}
}
add_action( 'save_post', 'desktop_mode_content_graph_flush_cache' );
add_action( 'deleted_post', 'desktop_mode_content_graph_flush_cache' );
// Term assignments can change outside the post-edit path (CLI, bulk
// quick-edit, REST). Without this the per-node `category_ids` / `tag_ids`
// the group-by UI reads would go stale until the 6h TTL expires.
add_action( 'set_object_terms', 'desktop_mode_content_graph_flush_cache' );

/**
 * Bulk-fetch every (post_id → taxonomy → term_ids[]) mapping for the
 * `category` and `post_tag` taxonomies in a single query. Used to
 * populate the per-node `category_ids` / `tag_ids` arrays without N+1
 * `wp_get_object_terms` calls.
 *
 * @since 0.8.6
 *
 * @param int[] $post_ids
 * @return array<int, array<string, int[]>>  Outer key = post id; inner
 *         key = taxonomy slug; value = term ids the post is in.
 */
function desktop_mode_content_graph_collect_post_terms( array $post_ids ) {
	$post_ids = array_values( array_filter( array_map( 'intval', $post_ids ) ) );
	if ( empty( $post_ids ) ) {
		return array();
	}
	global $wpdb;
	$placeholders = implode( ',', array_fill( 0, count( $post_ids ), '%d' ) );
	// phpcs:disable WordPress.DB.PreparedSQL.NotPrepared, WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
	$rows = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT tr.object_id, tt.term_id, tt.taxonomy
			 FROM {$wpdb->term_relationships} tr
			 INNER JOIN {$wpdb->term_taxonomy} tt
			   ON tr.term_taxonomy_id = tt.term_taxonomy_id
			 WHERE tr.object_id IN ( {$placeholders} )
			 AND tt.taxonomy IN ( 'category', 'post_tag' )",
			$post_ids
		)
	);
	// phpcs:enable
	$out = array();
	if ( ! is_array( $rows ) ) {
		return $out;
	}
	foreach ( $rows as $row ) {
		$pid = (int) $row->object_id;
		$tax = (string) $row->taxonomy;
		$tid = (int) $row->term_id;
		if ( ! isset( $out[ $pid ] ) ) {
			$out[ $pid ] = array();
		}
		if ( ! isset( $out[ $pid ][ $tax ] ) ) {
			$out[ $pid ][ $tax ] = array();
		}
		$out[ $pid ][ $tax ][] = $tid;
	}
	return $out;
}

/**
 * Bulk-fetch distinct revision authors per post for the requested
 * post ids. Used by `desktop_mode_content_graph_build()` to populate
 * each node's `contributor_ids` array so the cluster-attractor force
 * can pull collaborator posts toward both the primary author's
 * cluster AND each contributor's cluster (weighted so the primary
 * still wins).
 *
 * Returns the distinct `post_author` values from each in-scope post's
 * revision children. Includes the primary author if they also
 * authored a revision; the caller is expected to filter that out.
 *
 * @since 0.8.6
 *
 * @param int[] $post_ids
 * @return array<int, int[]>  post_id => list of contributor user ids.
 */
function desktop_mode_content_graph_collect_post_contributors( array $post_ids ) {
	$post_ids = array_values( array_filter( array_map( 'intval', $post_ids ) ) );
	if ( empty( $post_ids ) ) {
		return array();
	}
	global $wpdb;
	$placeholders = implode( ',', array_fill( 0, count( $post_ids ), '%d' ) );
	// phpcs:disable WordPress.DB.PreparedSQL.NotPrepared, WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
	$rows = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT post_parent AS post_id, post_author
			 FROM {$wpdb->posts}
			 WHERE post_type = 'revision'
			 AND post_parent IN ( {$placeholders} )
			 AND post_author > 0
			 GROUP BY post_parent, post_author",
			$post_ids
		)
	);
	// phpcs:enable
	$out = array();
	if ( ! is_array( $rows ) ) {
		return $out;
	}
	foreach ( $rows as $row ) {
		$pid = (int) $row->post_id;
		$uid = (int) $row->post_author;
		if ( ! isset( $out[ $pid ] ) ) {
			$out[ $pid ] = array();
		}
		$out[ $pid ][] = $uid;
	}
	return $out;
}

/**
 * Build a `{ id => { name } }` catalog for the given author ids.
 * Uses one `WP_User_Query` rather than per-id `get_userdata` calls.
 *
 * @since 0.8.6
 *
 * @param int[] $author_ids
 * @return array<int, array{ name: string }>
 */
function desktop_mode_content_graph_format_author_catalog( array $author_ids ) {
	$author_ids = array_values( array_unique( array_filter( array_map( 'intval', $author_ids ) ) ) );
	if ( empty( $author_ids ) ) {
		return array();
	}
	$query = new WP_User_Query(
		array(
			'include' => $author_ids,
			'fields'  => array( 'ID', 'display_name' ),
			'number'  => count( $author_ids ),
		)
	);
	$out = array();
	foreach ( (array) $query->get_results() as $user ) {
		$out[ (int) $user->ID ] = array(
			'name' => (string) $user->display_name,
		);
	}
	return $out;
}

/**
 * Build a `{ id => { name } }` catalog for the given term ids in a
 * single taxonomy. Uses `get_terms` with `include` so the names come
 * back in one query.
 *
 * @since 0.8.6
 *
 * @param int[]  $term_ids
 * @param string $taxonomy
 * @return array<int, array{ name: string }>
 */
function desktop_mode_content_graph_format_term_catalog( array $term_ids, $taxonomy ) {
	$term_ids = array_values( array_unique( array_filter( array_map( 'intval', $term_ids ) ) ) );
	if ( empty( $term_ids ) ) {
		return array();
	}
	$terms = get_terms(
		array(
			'taxonomy'   => (string) $taxonomy,
			'include'    => $term_ids,
			'hide_empty' => false,
			'number'     => count( $term_ids ),
		)
	);
	$out = array();
	if ( is_wp_error( $terms ) || ! is_array( $terms ) ) {
		return $out;
	}
	foreach ( $terms as $term ) {
		$out[ (int) $term->term_id ] = array(
			'name' => (string) $term->name,
		);
	}
	return $out;
}
