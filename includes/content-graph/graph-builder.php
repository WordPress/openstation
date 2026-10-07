<?php

defined( 'ABSPATH' ) || exit;

const OPENSTATION_CONTENT_GRAPH_TRANSIENT_PREFIX = 'desktop_mode_cg3_';
const OPENSTATION_CONTENT_GRAPH_TRANSIENT_TTL    = 6 * HOUR_IN_SECONDS;

function openstation_content_graph_build( array $types ) {
	$types = openstation_content_graph_normalize_types( $types );
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

	$cache_key = openstation_content_graph_cache_key( $types );
	$cached    = get_transient( $cache_key );
	if ( is_array( $cached ) && isset( $cached['nodes'], $cached['edges'] ) ) {
		return $cached;
	}

	$rows = openstation_content_graph_fetch_rows( $types );

	$post_ids = array();
	foreach ( $rows as $row ) {
		$post_ids[] = (int) $row->ID;
	}

	$terms_by_post = openstation_content_graph_collect_post_terms( $post_ids );

	$contribs_by_post = openstation_content_graph_collect_post_contributors( $post_ids );

	$default_category = max( 1, (int) get_option( 'default_category', 1 ) );

	$nodes       = array();
	$nodes_by_id = array();
	$author_ids  = array();
	$cat_ids     = array();
	$tag_ids     = array();
	foreach ( $rows as $row ) {
		$id         = (int) $row->ID;
		$author_id  = (int) $row->post_author;
		$year       = 0;
		$year_month = '';
		if ( ! empty( $row->post_date ) ) {

			$year       = (int) mysql2date( 'Y', $row->post_date, false );
			$year_month = (string) mysql2date( 'Y-m', $row->post_date, false );
		}
		$post_cats = isset( $terms_by_post[ $id ]['category'] )
			? $terms_by_post[ $id ]['category']
			: array();

		if ( empty( $post_cats ) && is_object_in_taxonomy( $row->post_type, 'category' ) ) {
			$post_cats = array( $default_category );
		}
		$post_tags = isset( $terms_by_post[ $id ]['post_tag'] )
			? $terms_by_post[ $id ]['post_tag']
			: array();
		$contribs  = isset( $contribs_by_post[ $id ] )
			? $contribs_by_post[ $id ]
			: array();

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

		$node               = array(
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
		'authors'    => openstation_content_graph_format_author_catalog( array_keys( $author_ids ) ),
		'categories' => openstation_content_graph_format_term_catalog( array_keys( $cat_ids ), 'category' ),
		'tags'       => openstation_content_graph_format_term_catalog( array_keys( $tag_ids ), 'post_tag' ),
	);

	$edges_seen = array();
	$edges      = array();
	foreach ( $rows as $row ) {
		$from = (int) $row->ID;
		$tos  = openstation_content_graph_extract_internal_links( (string) $row->post_content );
		foreach ( $tos as $to ) {
			if ( $to === $from ) {
				continue;
			}
			if ( empty( $nodes_by_id[ $to ] ) ) {

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

	set_transient( $cache_key, $payload, OPENSTATION_CONTENT_GRAPH_TRANSIENT_TTL );

	return $payload;
}

function openstation_content_graph_normalize_types( array $types ) {
	$allowed = array();
	foreach ( openstation_content_graph_post_types() as $entry ) {
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

function openstation_content_graph_visibility_sql( array $types ) {
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

function openstation_content_graph_cache_key( array $types ) {
	global $wpdb;
	$visibility = openstation_content_graph_visibility_sql( $types );

	$hash = (string) $wpdb->get_var(
		$wpdb->prepare(
			"SELECT MD5( GROUP_CONCAT( CONCAT( ID, ':', post_modified_gmt ) ORDER BY ID ) )
			 FROM {$wpdb->posts}
			 WHERE {$visibility['where']}",
			$visibility['values']
		)
	);

	if ( '' === $hash || null === $hash ) {
		$hash = 'empty';
	}
	return OPENSTATION_CONTENT_GRAPH_TRANSIENT_PREFIX . substr( md5( implode( ',', $types ) . '|' . $visibility['key'] . '|' . $hash ), 0, 24 );
}

function openstation_content_graph_fetch_rows( array $types ) {
	global $wpdb;
	$visibility = openstation_content_graph_visibility_sql( $types );

	$rows = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT ID, post_type, post_status, post_title, post_name, post_content, post_author, post_date
			 FROM {$wpdb->posts}
			 WHERE {$visibility['where']}
			 ORDER BY post_date DESC",
			$visibility['values']
		)
	);

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

function openstation_content_graph_extract_internal_links( $content ) {
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

function openstation_content_graph_flush_cache() {
	global $wpdb;

	$prefix_like = $wpdb->esc_like( '_transient_' . OPENSTATION_CONTENT_GRAPH_TRANSIENT_PREFIX ) . '%';

	$option_names = $wpdb->get_col(
		$wpdb->prepare(
			"SELECT option_name FROM {$wpdb->options} WHERE option_name LIKE %s",
			$prefix_like
		)
	);

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
add_action( 'save_post', 'openstation_content_graph_flush_cache' );
add_action( 'deleted_post', 'openstation_content_graph_flush_cache' );

add_action( 'set_object_terms', 'openstation_content_graph_flush_cache' );

function openstation_content_graph_collect_post_terms( array $post_ids ) {
	$post_ids = array_values( array_filter( array_map( 'intval', $post_ids ) ) );
	if ( empty( $post_ids ) ) {
		return array();
	}
	global $wpdb;
	$placeholders = implode( ',', array_fill( 0, count( $post_ids ), '%d' ) );

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

function openstation_content_graph_collect_post_contributors( array $post_ids ) {
	$post_ids = array_values( array_filter( array_map( 'intval', $post_ids ) ) );
	if ( empty( $post_ids ) ) {
		return array();
	}
	global $wpdb;
	$placeholders = implode( ',', array_fill( 0, count( $post_ids ), '%d' ) );

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

function openstation_content_graph_format_author_catalog( array $author_ids ) {
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
	$out   = array();
	foreach ( (array) $query->get_results() as $user ) {
		$out[ (int) $user->ID ] = array(
			'name' => openstation_plain_text_title( $user->display_name ),
		);
	}
	return $out;
}

function openstation_content_graph_format_term_catalog( array $term_ids, $taxonomy ) {
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
	$out   = array();
	if ( is_wp_error( $terms ) || ! is_array( $terms ) ) {
		return $out;
	}
	foreach ( $terms as $term ) {
		$out[ (int) $term->term_id ] = array(
			'name' => openstation_plain_text_title( $term->name ),
		);
	}
	return $out;
}
