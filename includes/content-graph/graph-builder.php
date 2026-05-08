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

const DESKTOP_MODE_CONTENT_GRAPH_TRANSIENT_PREFIX = 'desktop_mode_cg_';
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
 *         slug: string, edit_url: string
 *     }>,
 *     edges: array<int, array{ from: int, to: int }>,
 *     stats: array{ nodes: int, edges: int, generated_at: int }
 * }
 */
function desktop_mode_content_graph_build( array $types ) {
	$types = desktop_mode_content_graph_normalize_types( $types );
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

	$cache_key = desktop_mode_content_graph_cache_key( $types );
	$cached    = get_transient( $cache_key );
	if ( is_array( $cached ) && isset( $cached['nodes'], $cached['edges'] ) ) {
		return $cached;
	}

	$rows = desktop_mode_content_graph_fetch_rows( $types );

	$nodes       = array();
	$nodes_by_id = array();
	foreach ( $rows as $row ) {
		$id   = (int) $row->ID;
		$node = array(
			'id'       => $id,
			'type'     => (string) $row->post_type,
			'title'    => (string) get_the_title( $row ),
			'status'   => (string) $row->post_status,
			'slug'     => (string) $row->post_name,
			'edit_url' => (string) get_edit_post_link( $id, 'raw' ),
		);
		$nodes[]            = $node;
		$nodes_by_id[ $id ] = true;
	}

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
	// phpcs:disable WordPress.DB.PreparedSQL.NotPrepared, WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
	$hash = (string) $wpdb->get_var(
		$wpdb->prepare(
			"SELECT MD5( GROUP_CONCAT( CONCAT( ID, ':', post_modified_gmt ) ORDER BY ID ) )
			 FROM {$wpdb->posts}
			 WHERE post_status IN ( 'publish', 'private' )
			 AND post_type IN ( {$placeholders} )",
			$types
		)
	);
	// phpcs:enable
	if ( '' === $hash || null === $hash ) {
		$hash = 'empty';
	}
	return DESKTOP_MODE_CONTENT_GRAPH_TRANSIENT_PREFIX . substr( md5( implode( ',', $types ) . '|' . $hash ), 0, 24 );
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
	// phpcs:disable WordPress.DB.PreparedSQL.NotPrepared, WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
	$rows = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT ID, post_type, post_status, post_title, post_name, post_content
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
	// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared
	$like = $wpdb->esc_like( '_transient_' . DESKTOP_MODE_CONTENT_GRAPH_TRANSIENT_PREFIX ) . '%';
	$wpdb->query( $wpdb->prepare( "DELETE FROM {$wpdb->options} WHERE option_name LIKE %s", $like ) );
	$timeout_like = $wpdb->esc_like( '_transient_timeout_' . DESKTOP_MODE_CONTENT_GRAPH_TRANSIENT_PREFIX ) . '%';
	$wpdb->query( $wpdb->prepare( "DELETE FROM {$wpdb->options} WHERE option_name LIKE %s", $timeout_like ) );
	// phpcs:enable
}
add_action( 'save_post', 'desktop_mode_content_graph_flush_cache' );
add_action( 'deleted_post', 'desktop_mode_content_graph_flush_cache' );
