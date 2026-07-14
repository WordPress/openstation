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
 * `types` plus a hash of the relevant rows' `post_modified_gmt`. Any
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
 *         category_ids: int[], tag_ids: int[],
 *         comment_count: int, word_count: int, modified_ts: int
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

		// Word count for the Galaxy view's brightness encoding. Strip
		// shortcodes + tags first so a 200-word post drowning in HTML
		// markup doesn't read as a 2000-word post. `str_word_count` is
		// locale-aware enough for our needs (we only use it as a relative
		// brightness signal, not for editorial display).
		$plain      = wp_strip_all_tags( strip_shortcodes( (string) $row->post_content ), true );
		$word_count = $plain === '' ? 0 : (int) str_word_count( $plain );
		// Modified-time as unix ts (GMT). The Galaxy view's "Recent" tab
		// filters on `now - 30 days`; comparing seconds is faster + safer
		// across the wire than parsing a date string client-side.
		// Never-updated drafts carry a zero-date `post_modified_gmt`
		// (WordPress only stamps the GMT columns on update), so fall
		// back to the local `post_date` — for a fresh draft the two
		// describe the same instant. Without this, brand-new drafts
		// never twinkle and never qualify for the "Recent" tab.
		$modified_gmt = isset( $row->post_modified_gmt ) ? (string) $row->post_modified_gmt : '';
		if ( '' === $modified_gmt || '0000-00-00 00:00:00' === $modified_gmt ) {
			$modified_gmt = (string) get_gmt_from_date( (string) $row->post_date );
		}
		$modified_ts = (int) mysql2date( 'U', $modified_gmt . ' UTC', false );

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
			'comment_count'   => (int) ( isset( $row->comment_count ) ? $row->comment_count : 0 ),
			'word_count'      => $word_count,
			'modified_ts'     => $modified_ts,
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
 * Cache key for `{ nodes, edges }` for a given type set. Includes a
 * short hash of the participating rows' post_modified_gmt so any
 * relevant edit busts the cache implicitly.
 *
 * @since 0.8.2
 *
 * @param string[] $types Already normalized.
 * @return string
 */
function desktop_mode_content_graph_cache_key( array $types ) {
	global $wpdb;
	$placeholders = implode( ',', array_fill( 0, count( $types ), '%s' ) );
	// Hash MUST match the set of rows fetched in
	// `desktop_mode_content_graph_fetch_rows()` — including this user's
	// own drafts when logged in, so cache invalidates on draft edits too.
	// The shared status-clause helper keeps the two row sets in lockstep.
	list( $status_sql, $draft_args ) = desktop_mode_content_graph_status_clause();
	$current_user_id                 = (int) get_current_user_id();
	// phpcs:disable WordPress.DB.PreparedSQL.NotPrepared, WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
	$hash = (string) $wpdb->get_var(
		$wpdb->prepare(
			// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- $status_sql is composed of literals in desktop_mode_content_graph_status_clause().
			"SELECT MD5( GROUP_CONCAT( CONCAT( ID, ':', post_modified_gmt ) ORDER BY ID ) )
			 FROM {$wpdb->posts}
			 WHERE {$status_sql}
			 AND post_type IN ( {$placeholders} )",
			array_merge( $draft_args, $types )
		)
	);
	// phpcs:enable
	if ( '' === $hash || null === $hash ) {
		$hash = 'empty';
	}
	// Bucket the cache key by user so two editors see independently-built
	// payloads (their own drafts won't bleed into each other's view).
	return DESKTOP_MODE_CONTENT_GRAPH_TRANSIENT_PREFIX . substr(
		md5( implode( ',', $types ) . '|u' . $current_user_id . '|' . $hash ),
		0,
		24
	);
}

/**
 * Post-status WHERE clause shared by the cache-key hash and the row
 * fetch. Published + private posts for everyone, plus the current
 * user's own drafts when logged in (other users' drafts must never
 * surface). The two call sites MUST select the same row set — the
 * cache key hashes exactly the rows the fetch would return — which is
 * why the clause lives in one place.
 *
 * @since 0.9.2
 *
 * @return array{0: string, 1: int[]} SQL fragment (may contain a `%d`
 *                                    placeholder) + its prepare() args.
 */
function desktop_mode_content_graph_status_clause() {
	$current_user_id = (int) get_current_user_id();
	if ( $current_user_id > 0 ) {
		return array(
			"( post_status IN ( 'publish', 'private' ) OR ( post_status = 'draft' AND post_author = %d ) )",
			array( $current_user_id ),
		);
	}
	return array( "post_status IN ( 'publish', 'private' )", array() );
}

/**
 * Fetch the participating posts in a single query. Returns full rows
 * (including `post_content`) so the link extractor can run without N+1
 * `get_post()` calls.
 *
 * @since 0.8.2
 *
 * @param string[] $types Already normalized.
 * @return WP_Post[]
 */
function desktop_mode_content_graph_fetch_rows( array $types ) {
	global $wpdb;
	$placeholders = implode( ',', array_fill( 0, count( $types ), '%s' ) );
	// Include the current user's own drafts so the Galaxy view's
	// "Drafts" tab has something to surface without exposing other
	// users' unpublished work. Other-user drafts stay invisible.
	list( $status_sql, $draft_args ) = desktop_mode_content_graph_status_clause();
	// phpcs:disable WordPress.DB.PreparedSQL.NotPrepared, WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
	$rows = $wpdb->get_results(
		$wpdb->prepare(
			// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- $status_sql is composed of literals in desktop_mode_content_graph_status_clause().
			"SELECT ID, post_type, post_status, post_title, post_name, post_content, post_author, post_date, post_modified_gmt, comment_count
			 FROM {$wpdb->posts}
			 WHERE {$status_sql}
			 AND post_type IN ( {$placeholders} )
			 ORDER BY post_date DESC",
			array_merge( $draft_args, $types )
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
