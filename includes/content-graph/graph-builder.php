<?php
/**
 * Desktop Mode — Content Graph: graph builder.
 *
 * Walks the WordPress post store to produce three arrays for the
 * bundle:
 *
 *   - `nodes`  — one entry per post matching the requested types. Each
 *                node carries a `terms` map from taxonomy slug to the
 *                term ids that node belongs to (scoped to the
 *                taxonomies the request asked about).
 *   - `edges`  — one entry per relationship in the requested edge
 *                kinds, keyed by `kind`:
 *                  * `link`      — internal hyperlink in `post_content`
 *                  * `co_tag`    — shared term in any taxonomy other
 *                                  than the active clustering taxonomy
 *                  * `co_author` — shared `post_author`
 *                  * `hierarchy` — `post_parent` relationships
 *                  * `menu`      — nav-menu items pointing to a post
 *                                  in scope (and to their parent menu
 *                                  item's referenced post when present)
 *   - `stats`  — counts for nodes/edges and a `generated_at` ts.
 *
 * The expensive piece is the link extraction: every published post in
 * scope is parsed with `DOMDocument`, every `<a href>` is scanned, and
 * each href is resolved with `url_to_postid()`. We cache the full
 * `{ nodes, edges, stats }` tuple in a transient keyed on the
 * requested `types`, requested `edge_kinds`, requested `taxonomies`,
 * AND a hash that bumps when any participating row's
 * `post_modified_gmt`, term-relationships state, or nav-menu state
 * changes. Any of those changes invalidates the hash, so editing
 * implicitly refreshes the graph the next time it's requested. We
 * also explicitly bust the cache on `save_post`, `deleted_post`,
 * `set_object_terms`, `wp_update_nav_menu`, and
 * `wp_update_nav_menu_item` so editors don't see stale data even if
 * some other process pre-warms the transient.
 *
 * @package WPDesktopMode
 * @since   0.8.2
 */

defined( 'ABSPATH' ) || exit;

const DESKTOP_MODE_CONTENT_GRAPH_TRANSIENT_PREFIX = 'desktop_mode_cg_';
const DESKTOP_MODE_CONTENT_GRAPH_TRANSIENT_TTL    = 6 * HOUR_IN_SECONDS;

/**
 * Defensive cap: a single post's `terms[<taxonomy>]` is truncated to
 * this many entries. Sites that genuinely store more terms per post
 * per taxonomy hit a documented limit and the truncation fires the
 * `desktop_mode_content_graph_terms_truncated` action with the
 * original count for observability.
 *
 * @since 0.9.0
 */
const DESKTOP_MODE_CONTENT_GRAPH_TERMS_PER_TAX_CAP = 50;

/**
 * Catalog of edge kinds the builder knows how to produce.
 *
 * @since 0.9.0
 *
 * @return string[]
 */
function desktop_mode_content_graph_edge_kinds() {
	return array( 'link', 'co_tag', 'co_author', 'hierarchy', 'menu' );
}

/**
 * Build (or reuse the cached version of) the graph payload for the
 * requested post types, edge kinds, and taxonomy scope.
 *
 * @since 0.8.2
 * @since 0.9.0 Added `$edge_kinds` and `$taxonomies` parameters.
 *
 * @param string[] $types       Post type slugs. Filtered against the
 *                              public post-type registry, attachments
 *                              excluded.
 * @param string[] $edge_kinds  Edge kinds to compute. Subset of
 *                              `desktop_mode_content_graph_edge_kinds()`.
 *                              Empty = all kinds.
 * @param string[] $taxonomies  Taxonomy slugs whose memberships should
 *                              ride along on each node's `terms` map.
 *                              Public taxonomies only. Empty = no
 *                              membership data emitted.
 * @return array{
 *     nodes: array<int, array{
 *         id: int, type: string, title: string, status: string,
 *         slug: string, edit_url: string,
 *         terms: array<string, int[]>
 *     }>,
 *     edges: array<int, array{ from: int, to: int, kind: string }>,
 *     stats: array{ nodes: int, edges: int, generated_at: int }
 * }
 */
function desktop_mode_content_graph_build( array $types, array $edge_kinds = array(), array $taxonomies = array() ) {
	$types      = desktop_mode_content_graph_normalize_types( $types );
	$edge_kinds = desktop_mode_content_graph_normalize_edge_kinds( $edge_kinds );
	$taxonomies = desktop_mode_content_graph_normalize_taxonomies( $taxonomies );

	if ( empty( $types ) ) {
		return array(
			'nodes' => array(),
			'edges' => array(),
			'stats' => array(
				'nodes'        => 0,
				'edges'        => 0,
				'generated_at' => time(),
			),
		);
	}

	$cache_key = desktop_mode_content_graph_cache_key( $types, $edge_kinds, $taxonomies );
	$cached    = get_transient( $cache_key );
	if ( is_array( $cached ) && isset( $cached['nodes'], $cached['edges'] ) ) {
		return $cached;
	}

	$rows        = desktop_mode_content_graph_fetch_rows( $types );
	$ids_in_scope = array();
	foreach ( $rows as $row ) {
		$ids_in_scope[ (int) $row->ID ] = true;
	}

	// Collect per-node taxonomy membership ONCE, indexed by post id.
	// The co-tag extractor and the per-node `terms` map are derived
	// from the same data so we can produce both with a single pass.
	$terms_by_post = empty( $taxonomies )
		? array()
		: desktop_mode_content_graph_collect_terms_by_post( array_keys( $ids_in_scope ), $taxonomies );

	$nodes = array();
	foreach ( $rows as $row ) {
		$id    = (int) $row->ID;
		$nodes[] = array(
			'id'       => $id,
			'type'     => (string) $row->post_type,
			'title'    => (string) get_the_title( $row ),
			'status'   => (string) $row->post_status,
			'slug'     => (string) $row->post_name,
			'edit_url' => (string) get_edit_post_link( $id, 'raw' ),
			'terms'    => isset( $terms_by_post[ $id ] ) ? $terms_by_post[ $id ] : (object) array(),
		);
	}

	$edges = array();
	if ( in_array( 'link', $edge_kinds, true ) ) {
		$edges = array_merge(
			$edges,
			desktop_mode_content_graph_extract_link_edges( $rows, $ids_in_scope )
		);
	}
	if ( in_array( 'co_author', $edge_kinds, true ) ) {
		$edges = array_merge(
			$edges,
			desktop_mode_content_graph_extract_co_author_edges( $rows )
		);
	}
	if ( in_array( 'hierarchy', $edge_kinds, true ) ) {
		$edges = array_merge(
			$edges,
			desktop_mode_content_graph_extract_hierarchy_edges( $rows, $ids_in_scope )
		);
	}
	if ( in_array( 'co_tag', $edge_kinds, true ) ) {
		$edges = array_merge(
			$edges,
			desktop_mode_content_graph_extract_co_tag_edges( $terms_by_post )
		);
	}
	if ( in_array( 'menu', $edge_kinds, true ) ) {
		$edges = array_merge(
			$edges,
			desktop_mode_content_graph_extract_menu_edges( $ids_in_scope )
		);
	}

	$payload = array(
		'nodes' => $nodes,
		'edges' => $edges,
		'stats' => array(
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
 * public post-type registry.
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
 * Filter, sanitize, and uniquify requested edge kinds.
 *
 * Empty input returns just `['link']` for backwards compatibility:
 * before 0.9.0 the builder produced only hyperlink edges, and any
 * pre-existing caller (including a stale browser-cached client) is
 * expected to keep getting that behavior until they opt in to the
 * new edge kinds via the `edges` query parameter.
 *
 * @since 0.9.0
 *
 * @param string[] $edge_kinds
 * @return string[]
 */
function desktop_mode_content_graph_normalize_edge_kinds( array $edge_kinds ) {
	$allowed = array_flip( desktop_mode_content_graph_edge_kinds() );
	if ( empty( $edge_kinds ) ) {
		return array( 'link' );
	}
	$out = array();
	foreach ( $edge_kinds as $k ) {
		$k = sanitize_key( (string) $k );
		if ( '' !== $k && isset( $allowed[ $k ] ) ) {
			$out[ $k ] = true;
		}
	}
	return array_keys( $out );
}

/**
 * Filter, sanitize, and uniquify requested taxonomy slugs against the
 * registered public taxonomy registry.
 *
 * @since 0.9.0
 *
 * @param string[] $taxonomies
 * @return string[]
 */
function desktop_mode_content_graph_normalize_taxonomies( array $taxonomies ) {
	if ( empty( $taxonomies ) ) {
		return array();
	}
	$registered = get_taxonomies( array( 'public' => true ), 'names' );
	$allowed    = is_array( $registered ) ? array_flip( $registered ) : array();
	$out        = array();
	foreach ( $taxonomies as $tax ) {
		$tax = sanitize_key( (string) $tax );
		if ( '' !== $tax && isset( $allowed[ $tax ] ) ) {
			$out[ $tax ] = true;
		}
	}
	return array_keys( $out );
}

/**
 * Cache key for `{ nodes, edges, stats }` for the given type set,
 * edge-kind set, and taxonomy scope. Includes hashes that bump when
 * any of: (a) a participating row's `post_modified_gmt` changes, (b)
 * any term-relationship for an in-scope post changes, (c) any nav
 * menu definition changes (when nav-menu edges are requested).
 *
 * @since 0.8.2
 * @since 0.9.0 Hash domain expanded for new edge kinds and taxonomies.
 *
 * @param string[] $types       Already normalized.
 * @param string[] $edge_kinds  Already normalized.
 * @param string[] $taxonomies  Already normalized.
 * @return string
 */
function desktop_mode_content_graph_cache_key( array $types, array $edge_kinds, array $taxonomies ) {
	global $wpdb;
	$placeholders = implode( ',', array_fill( 0, count( $types ), '%s' ) );
	// phpcs:disable WordPress.DB.PreparedSQL.NotPrepared, WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
	$rows_hash = (string) $wpdb->get_var(
		$wpdb->prepare(
			"SELECT MD5( GROUP_CONCAT( CONCAT( ID, ':', post_modified_gmt ) ORDER BY ID ) )
			 FROM {$wpdb->posts}
			 WHERE post_status IN ( 'publish', 'private' )
			 AND post_type IN ( {$placeholders} )",
			$types
		)
	);
	$tr_hash    = '';
	$menu_hash  = '';
	if ( in_array( 'co_tag', $edge_kinds, true ) || ! empty( $taxonomies ) ) {
		// Term-relationship state: a digest of (object_id, term_taxonomy_id)
		// over the in-scope posts. Cheap enough for a single MD5 over a
		// GROUP_CONCAT; the rows_hash join keeps the workspace small.
		$tr_hash = (string) $wpdb->get_var(
			$wpdb->prepare(
				"SELECT MD5( GROUP_CONCAT( CONCAT( tr.object_id, ':', tr.term_taxonomy_id ) ORDER BY tr.object_id, tr.term_taxonomy_id ) )
				 FROM {$wpdb->term_relationships} tr
				 INNER JOIN {$wpdb->posts} p ON p.ID = tr.object_id
				 WHERE p.post_status IN ( 'publish', 'private' )
				 AND p.post_type IN ( {$placeholders} )",
				$types
			)
		);
	}
	if ( in_array( 'menu', $edge_kinds, true ) ) {
		// Nav-menu state digest: every nav_menu_item's id +
		// post_modified_gmt. Editing any menu item bumps the row's
		// post_modified_gmt, which bumps the hash.
		$menu_hash = (string) $wpdb->get_var(
			"SELECT MD5( GROUP_CONCAT( CONCAT( ID, ':', post_modified_gmt ) ORDER BY ID ) )
			 FROM {$wpdb->posts}
			 WHERE post_type = 'nav_menu_item'"
		);
	}
	// phpcs:enable
	if ( '' === $rows_hash || null === $rows_hash ) {
		$rows_hash = 'empty';
	}
	$composite = implode(
		'|',
		array(
			'types=' . implode( ',', $types ),
			'edges=' . implode( ',', $edge_kinds ),
			'taxes=' . implode( ',', $taxonomies ),
			'rows=' . $rows_hash,
			'tr=' . $tr_hash,
			'menu=' . $menu_hash,
		)
	);
	return DESKTOP_MODE_CONTENT_GRAPH_TRANSIENT_PREFIX . substr( md5( $composite ), 0, 24 );
}

/**
 * Fetch the participating posts in a single query. Returns full rows
 * including `post_content`, `post_parent`, and `post_author` so the
 * link extractor and the cheap derived edge extractors can run
 * without N+1 `get_post()` calls.
 *
 * @since 0.8.2
 * @since 0.9.0 Adds `post_parent`, `post_author` to the SELECT.
 *
 * @param string[] $types Already normalized.
 * @return WP_Post[]
 */
function desktop_mode_content_graph_fetch_rows( array $types ) {
	global $wpdb;
	$placeholders = implode( ',', array_fill( 0, count( $types ), '%s' ) );
	// phpcs:disable WordPress.DB.PreparedSQL.NotPrepared, WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
	$rows = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT ID, post_type, post_status, post_title, post_name, post_content, post_parent, post_author
			 FROM {$wpdb->posts}
			 WHERE post_status IN ( 'publish', 'private' )
			 AND post_type IN ( {$placeholders} )
			 ORDER BY post_date DESC",
			$types
		)
	);
	// phpcs:enable

	if ( ! is_array( $rows ) ) {
		return array();
	}

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
 * Per-node taxonomy membership map. Returns
 * `array<post_id, array<taxonomy_slug, int[]>>` covering only the
 * requested taxonomies and the in-scope post ids. One bulk JOIN; no
 * N+1.
 *
 * Truncates per-(post, taxonomy) entries to the
 * `DESKTOP_MODE_CONTENT_GRAPH_TERMS_PER_TAX_CAP` limit and fires the
 * `desktop_mode_content_graph_terms_truncated` action when the cap
 * applies.
 *
 * @since 0.9.0
 *
 * @param int[]    $post_ids   In-scope post ids.
 * @param string[] $taxonomies Already normalized public taxonomy slugs.
 * @return array<int, array<string, int[]>>
 */
function desktop_mode_content_graph_collect_terms_by_post( array $post_ids, array $taxonomies ) {
	if ( empty( $post_ids ) || empty( $taxonomies ) ) {
		return array();
	}
	global $wpdb;
	$id_placeholders  = implode( ',', array_fill( 0, count( $post_ids ), '%d' ) );
	$tax_placeholders = implode( ',', array_fill( 0, count( $taxonomies ), '%s' ) );
	$args             = array_merge( array_map( 'intval', $post_ids ), $taxonomies );
	// phpcs:disable WordPress.DB.PreparedSQL.NotPrepared, WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
	$rows = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT tr.object_id AS post_id, tt.taxonomy AS taxonomy, tt.term_id AS term_id
			 FROM {$wpdb->term_relationships} tr
			 INNER JOIN {$wpdb->term_taxonomy} tt ON tt.term_taxonomy_id = tr.term_taxonomy_id
			 WHERE tr.object_id IN ( {$id_placeholders} )
			 AND tt.taxonomy IN ( {$tax_placeholders} )",
			$args
		)
	);
	// phpcs:enable
	if ( ! is_array( $rows ) ) {
		return array();
	}
	$out = array();
	foreach ( $rows as $row ) {
		$pid = (int) $row->post_id;
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
	// Apply per-(post, taxonomy) truncation cap.
	foreach ( $out as $pid => $by_tax ) {
		foreach ( $by_tax as $tax => $ids ) {
			$count = count( $ids );
			if ( $count > DESKTOP_MODE_CONTENT_GRAPH_TERMS_PER_TAX_CAP ) {
				$out[ $pid ][ $tax ] = array_slice( $ids, 0, DESKTOP_MODE_CONTENT_GRAPH_TERMS_PER_TAX_CAP );
				/**
				 * Fires once per (post, taxonomy) tuple whose membership
				 * exceeds the cap.
				 *
				 * @since 0.9.0
				 *
				 * @param int    $post_id  Post whose terms were truncated.
				 * @param string $taxonomy Taxonomy slug.
				 * @param int    $count    Original (pre-truncation) term count.
				 */
				do_action( 'desktop_mode_content_graph_terms_truncated', $pid, $tax, $count );
			}
		}
	}
	return $out;
}

/**
 * Internal-link edges, extracted from `post_content` via DOMDocument.
 *
 * @since 0.9.0 Factored out of `build()`.
 *
 * @param WP_Post[] $rows         All in-scope posts.
 * @param bool[]    $ids_in_scope Map of in-scope post id => true.
 * @return array<int, array{ from: int, to: int, kind: string }>
 */
function desktop_mode_content_graph_extract_link_edges( array $rows, array $ids_in_scope ) {
	$edges_seen = array();
	$edges      = array();
	foreach ( $rows as $row ) {
		$from = (int) $row->ID;
		$tos  = desktop_mode_content_graph_extract_internal_links( (string) $row->post_content );
		foreach ( $tos as $to ) {
			if ( $to === $from ) {
				continue;
			}
			if ( empty( $ids_in_scope[ $to ] ) ) {
				continue;
			}
			$key = 'link:' . $from . '->' . $to;
			if ( isset( $edges_seen[ $key ] ) ) {
				continue;
			}
			$edges_seen[ $key ] = true;
			$edges[]            = array(
				'from' => $from,
				'to'   => $to,
				'kind' => 'link',
			);
		}
	}
	return $edges;
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

	$ids  = array();
	$seen = array();
	$prev = libxml_use_internal_errors( true );
	$dom  = new DOMDocument();
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
 * Co-author edges: pairs of in-scope posts sharing `post_author`.
 * Symmetric, deduped on ordered (min, max) pairs.
 *
 * @since 0.9.0
 *
 * @param WP_Post[] $rows
 * @return array<int, array{ from: int, to: int, kind: string }>
 */
function desktop_mode_content_graph_extract_co_author_edges( array $rows ) {
	$by_author = array();
	foreach ( $rows as $row ) {
		$uid = (int) $row->post_author;
		if ( $uid <= 0 ) {
			continue;
		}
		if ( ! isset( $by_author[ $uid ] ) ) {
			$by_author[ $uid ] = array();
		}
		$by_author[ $uid ][] = (int) $row->ID;
	}
	$edges = array();
	$seen  = array();
	foreach ( $by_author as $ids ) {
		$count = count( $ids );
		if ( $count < 2 ) {
			continue;
		}
		for ( $i = 0; $i < $count; $i++ ) {
			for ( $j = $i + 1; $j < $count; $j++ ) {
				$a = $ids[ $i ];
				$b = $ids[ $j ];
				if ( $a === $b ) {
					continue;
				}
				$lo  = $a < $b ? $a : $b;
				$hi  = $a < $b ? $b : $a;
				$key = 'co_author:' . $lo . '->' . $hi;
				if ( isset( $seen[ $key ] ) ) {
					continue;
				}
				$seen[ $key ] = true;
				$edges[]      = array(
					'from' => $lo,
					'to'   => $hi,
					'kind' => 'co_author',
				);
			}
		}
	}
	return $edges;
}

/**
 * Hierarchy edges: `post_parent` relationships for in-scope posts
 * whose parent is also in scope. Directed (parent -> child).
 *
 * @since 0.9.0
 *
 * @param WP_Post[] $rows
 * @param bool[]    $ids_in_scope
 * @return array<int, array{ from: int, to: int, kind: string }>
 */
function desktop_mode_content_graph_extract_hierarchy_edges( array $rows, array $ids_in_scope ) {
	$edges = array();
	$seen  = array();
	foreach ( $rows as $row ) {
		$child  = (int) $row->ID;
		$parent = (int) $row->post_parent;
		if ( $parent <= 0 || $parent === $child ) {
			continue;
		}
		if ( empty( $ids_in_scope[ $parent ] ) ) {
			continue;
		}
		$key = 'hierarchy:' . $parent . '->' . $child;
		if ( isset( $seen[ $key ] ) ) {
			continue;
		}
		$seen[ $key ] = true;
		$edges[]      = array(
			'from' => $parent,
			'to'   => $child,
			'kind' => 'hierarchy',
		);
	}
	return $edges;
}

/**
 * Co-tag edges: pairs of in-scope posts sharing at least one term in
 * any of the taxonomies for which we collected memberships. Symmetric,
 * deduped on ordered (min, max) pairs.
 *
 * The full taxonomy scope is whatever the request asked about; the
 * caller (build()) is responsible for excluding the active clustering
 * taxonomy if that is the desired behavior.
 *
 * @since 0.9.0
 *
 * @param array<int, array<string, int[]>> $terms_by_post
 * @return array<int, array{ from: int, to: int, kind: string }>
 */
function desktop_mode_content_graph_extract_co_tag_edges( array $terms_by_post ) {
	// Build an index: term_taxonomy -> [post_id, ...]
	$by_term = array();
	foreach ( $terms_by_post as $pid => $by_tax ) {
		foreach ( $by_tax as $tax => $term_ids ) {
			foreach ( $term_ids as $tid ) {
				$key = $tax . ':' . (int) $tid;
				if ( ! isset( $by_term[ $key ] ) ) {
					$by_term[ $key ] = array();
				}
				$by_term[ $key ][ (int) $pid ] = true;
			}
		}
	}
	$edges = array();
	$seen  = array();
	foreach ( $by_term as $post_set ) {
		$ids   = array_keys( $post_set );
		$count = count( $ids );
		if ( $count < 2 ) {
			continue;
		}
		for ( $i = 0; $i < $count; $i++ ) {
			for ( $j = $i + 1; $j < $count; $j++ ) {
				$a   = $ids[ $i ];
				$b   = $ids[ $j ];
				$lo  = $a < $b ? $a : $b;
				$hi  = $a < $b ? $b : $a;
				$key = 'co_tag:' . $lo . '->' . $hi;
				if ( isset( $seen[ $key ] ) ) {
					continue;
				}
				$seen[ $key ] = true;
				$edges[]      = array(
					'from' => $lo,
					'to'   => $hi,
					'kind' => 'co_tag',
				);
			}
		}
	}
	return $edges;
}

/**
 * Menu edges: nav-menu items whose target is an in-scope post produce
 * an edge from the menu item's parent menu item's target post (if any
 * and in scope) to the target post. When the menu item is at the top
 * level of its menu, the edge is dropped; we only emit edges between
 * pairs of in-scope content posts.
 *
 * @since 0.9.0
 *
 * @param bool[] $ids_in_scope Map of in-scope post id => true.
 * @return array<int, array{ from: int, to: int, kind: string }>
 */
function desktop_mode_content_graph_extract_menu_edges( array $ids_in_scope ) {
	if ( empty( $ids_in_scope ) || ! function_exists( 'wp_get_nav_menus' ) ) {
		return array();
	}
	$menus = wp_get_nav_menus();
	if ( empty( $menus ) || is_wp_error( $menus ) ) {
		return array();
	}
	$edges = array();
	$seen  = array();
	foreach ( $menus as $menu ) {
		$items = wp_get_nav_menu_items( $menu );
		if ( empty( $items ) || is_wp_error( $items ) ) {
			continue;
		}
		// Build a per-menu map: menu_item_id -> resolved target post id
		// (only when the item is `post_type` AND points at an in-scope
		// post). Items pointing at terms or custom URLs are excluded.
		$item_target = array();
		foreach ( $items as $item ) {
			if ( 'post_type' !== (string) $item->type ) {
				continue;
			}
			$target = (int) $item->object_id;
			if ( $target <= 0 || empty( $ids_in_scope[ $target ] ) ) {
				continue;
			}
			$item_target[ (int) $item->ID ] = $target;
		}
		// Now emit edges from each item's parent-menu-item's target
		// (when present and resolved) to the item's target.
		foreach ( $items as $item ) {
			$item_id = (int) $item->ID;
			if ( ! isset( $item_target[ $item_id ] ) ) {
				continue;
			}
			$parent_item_id = (int) $item->menu_item_parent;
			if ( $parent_item_id <= 0 || ! isset( $item_target[ $parent_item_id ] ) ) {
				continue;
			}
			$from = $item_target[ $parent_item_id ];
			$to   = $item_target[ $item_id ];
			if ( $from === $to ) {
				continue;
			}
			$key = 'menu:' . $from . '->' . $to;
			if ( isset( $seen[ $key ] ) ) {
				continue;
			}
			$seen[ $key ] = true;
			$edges[]      = array(
				'from' => $from,
				'to'   => $to,
				'kind' => 'menu',
			);
		}
	}
	return $edges;
}

/**
 * Cache invalidation. Any post / term-relationship / nav-menu change
 * wipes every transient carrying the `desktop_mode_cg_` prefix. We
 * don't have a per-type or per-taxonomy index so we wipe globally;
 * the cost is one extra build on next open which dominates the time
 * savings on subsequent opens.
 *
 * @since 0.8.2
 */
function desktop_mode_content_graph_flush_cache() {
	global $wpdb;
	// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared
	$like = $wpdb->esc_like( '_transient_' . DESKTOP_MODE_CONTENT_GRAPH_TRANSIENT_PREFIX ) . '%';
	$wpdb->query( $wpdb->prepare( "DELETE FROM {$wpdb->options} WHERE option_name LIKE %s", $like ) );
	$timeout_like = $wpdb->esc_like( '_transient_timeout_' . DESKTOP_MODE_CONTENT_GRAPH_TRANSIENT_PREFIX ) . '%';
	$wpdb->query( $wpdb->prepare( "DELETE FROM {$wpdb->options} WHERE option_name LIKE %s", $timeout_like ) );
	// phpcs:enable
}
add_action( 'save_post', 'desktop_mode_content_graph_flush_cache' );
add_action( 'deleted_post', 'desktop_mode_content_graph_flush_cache' );
add_action( 'set_object_terms', 'desktop_mode_content_graph_flush_cache' );
add_action( 'wp_update_nav_menu', 'desktop_mode_content_graph_flush_cache' );
add_action( 'wp_update_nav_menu_item', 'desktop_mode_content_graph_flush_cache' );
