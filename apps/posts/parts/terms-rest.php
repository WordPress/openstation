<?php

defined( 'ABSPATH' ) || exit;

function openstation_posts_window_rest_permission() {
	return current_user_can( 'edit_posts' );
}

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

function openstation_posts_window_terms_cache_version() {
	$v = (int) get_option( 'desktop_mode_terms_cache_version', 0 );
	if ( $v <= 0 ) {
		$v = 1;

		update_option( 'desktop_mode_terms_cache_version', $v, false );
	}
	return $v;
}

function openstation_posts_window_terms_cache_invalidate() {
	$v = openstation_posts_window_terms_cache_version();
	update_option(
		'desktop_mode_terms_cache_version',
		$v + 1,
		false
	);
}

add_action( 'set_object_terms', 'openstation_posts_window_terms_cache_invalidate' );

add_action( 'created_term', 'openstation_posts_window_terms_cache_invalidate' );
add_action( 'edited_term', 'openstation_posts_window_terms_cache_invalidate' );
add_action( 'delete_term', 'openstation_posts_window_terms_cache_invalidate' );

add_action( 'wp_trash_post', 'openstation_posts_window_terms_cache_invalidate' );
add_action( 'untrashed_post', 'openstation_posts_window_terms_cache_invalidate' );

add_action( 'before_delete_post', 'openstation_posts_window_terms_cache_invalidate' );

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

	$ids = array_slice( $ids, 0, 500 );

	$cache_version = openstation_posts_window_terms_cache_version();
	$cache_key     = sprintf( 'dmtcnt_v%d_%s', $cache_version, $taxonomy );
	$counts        = get_transient( $cache_key );
	if ( ! is_array( $counts ) ) {

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

	$out = array();
	foreach ( $ids as $id ) {
		$key         = (string) $id;
		$out[ $key ] = isset( $counts[ $key ] ) ? (int) $counts[ $key ] : 0;
	}
	return $out;
}

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

	$limit = min( 24, $limit );

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

	$pairs       = array();
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

	set_transient( $cache_key, $payload, DAY_IN_SECONDS );

	return rest_ensure_response( $payload );
}

function openstation_posts_window_term_is_default( $term ) {
	$taxonomy = isset( $term['taxonomy'] ) ? (string) $term['taxonomy'] : '';
	$term_id  = isset( $term['id'] ) ? (int) $term['id'] : 0;
	if ( '' === $taxonomy || $term_id <= 0 ) {
		return false;
	}
	$option_key = 'default_' . $taxonomy;
	$default_id = (int) get_option( $option_key, 0 );
	return $default_id > 0 && $default_id === $term_id;
}

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
