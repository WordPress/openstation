<?php

defined( 'ABSPATH' ) || exit;

function openstation_my_wordpress_register_media_usage_route() {
	register_rest_route(
		'desktop-mode/v1',
		'/media-usage/(?P<id>\d+)',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => 'openstation_my_wordpress_media_usage_callback',
			'permission_callback' => static function ( $request ) {
				$id = (int) $request->get_param( 'id' );
				if ( $id <= 0 ) {
					return false;
				}
				$post = get_post( $id );
				if ( ! $post || 'attachment' !== $post->post_type ) {
					return false;
				}
				return current_user_can( 'read_post', $id );
			},
			'args'                => array(
				'id' => array(
					'required'          => true,
					'type'              => 'integer',
					'sanitize_callback' => 'absint',
				),
			),
		)
	);
}
add_action( 'rest_api_init', 'openstation_my_wordpress_register_media_usage_route' );

function openstation_my_wordpress_media_usage_ttl( $attachment_id ) {

	return (int) apply_filters( 'openstation_my_wordpress_media_usage_cache_ttl', 300, $attachment_id );
}

function openstation_my_wordpress_media_usage_cache_buckets() {
	return array( 'edit', 'read' );
}

function openstation_my_wordpress_media_usage_current_bucket() {
	return current_user_can( 'edit_others_posts' ) ? 'edit' : 'read';
}

function openstation_my_wordpress_media_usage_cache_key( $attachment_id, $bucket = null ) {
	if ( null === $bucket ) {
		$bucket = openstation_my_wordpress_media_usage_current_bucket();
	}
	return 'dm_media_usage_' . (int) $attachment_id . '_' . $bucket . '_v1';
}

function openstation_my_wordpress_media_usage_callback( $request ) {
	$attachment_id = (int) $request->get_param( 'id' );
	$attachment    = get_post( $attachment_id );
	if ( ! $attachment || 'attachment' !== $attachment->post_type ) {
		return new WP_Error(
			'openstation_media_not_found',
			__( 'Attachment not found.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}

	$cache_key    = openstation_my_wordpress_media_usage_cache_key( $attachment_id );
	$rows_by_post = get_transient( $cache_key );
	if ( ! is_array( $rows_by_post ) ) {
		$rows_by_post = openstation_my_wordpress_media_usage_collect( $attachment );
		set_transient(
			$cache_key,
			$rows_by_post,
			openstation_my_wordpress_media_usage_ttl( $attachment_id )
		);
	}

	$payload = openstation_my_wordpress_media_usage_build( $attachment, $rows_by_post );

	return apply_filters( 'openstation_my_wordpress_media_usage', $payload, $attachment_id );
}

function openstation_my_wordpress_media_usage_collect( $attachment ) {
	global $wpdb;

	$attachment_id = (int) $attachment->ID;
	$file_url      = (string) wp_get_attachment_url( $attachment_id );
	$file_basename = '' !== $file_url ? wp_basename( $file_url ) : '';

	$public_types = array_values( get_post_types( array( 'public' => true ), 'names' ) );

	$public_types = array_values( array_diff( $public_types, array( 'attachment' ) ) );
	if ( empty( $public_types ) ) {
		return array();
	}

	$rows_by_post = array();

	$thumb_post_ids = $wpdb->get_col(
		$wpdb->prepare(
			"SELECT post_id FROM {$wpdb->postmeta}
			 WHERE meta_key = '_thumbnail_id' AND meta_value = %s",
			(string) $attachment_id
		)
	);
	foreach ( (array) $thumb_post_ids as $pid ) {
		$pid = (int) $pid;
		if ( $pid > 0 ) {
			$rows_by_post[ $pid ] = 'featured';
		}
	}

	if ( '' !== $file_basename ) {
		$basename_variants = array( $file_basename );
		if ( preg_match( '/^(.*)-scaled(\.[a-zA-Z0-9]+)$/', $file_basename, $m ) ) {
			$basename_variants[] = $m[1] . $m[2];
		}
		$basename_variants = array_values( array_unique( $basename_variants ) );

		$class_pattern = '%wp-image-' . $attachment_id . '%';
		$url_patterns  = array();
		foreach ( $basename_variants as $variant ) {
			$url_patterns[] = '%' . $wpdb->esc_like( $variant ) . '%';
		}

		$pattern_args   = array_merge( array( $class_pattern ), $url_patterns );
		$pattern_clause = implode( ' OR ', array_fill( 0, count( $pattern_args ), 'post_content LIKE %s' ) );
		$type_holders   = implode( ',', array_fill( 0, count( $public_types ), '%s' ) );
		$query_args     = array_merge( $pattern_args, $public_types );

		$content_rows = $wpdb->get_col(
			$wpdb->prepare(
				"SELECT ID FROM {$wpdb->posts}
				 WHERE ( {$pattern_clause} )
				   AND post_status NOT IN ( 'auto-draft', 'inherit', 'trash' )
				   AND post_type IN ( {$type_holders} )",
				$query_args
			)
		);

		$url_variants = array();
		if ( '' !== $file_url ) {
			$url_variants[] = $file_url;
			if ( preg_match( '/^(.*)-scaled(\.[a-zA-Z0-9]+)$/', $file_url, $m ) ) {
				$url_variants[] = $m[1] . $m[2];
			} elseif ( preg_match( '/^(.*)(\.[a-zA-Z0-9]+)$/', $file_url, $m ) ) {
				$url_variants[] = $m[1] . '-scaled' . $m[2];
			}
		}

		$class_re = '/wp-image-' . $attachment_id . '(?!\d)/';
		foreach ( (array) $content_rows as $pid ) {
			$pid = (int) $pid;
			if ( $pid <= 0 || isset( $rows_by_post[ $pid ] ) ) {
				continue;
			}
			$content_post = get_post( $pid );
			if ( ! $content_post || ! isset( $content_post->post_content ) ) {
				continue;
			}
			$haystack  = (string) $content_post->post_content;
			$has_class = (bool) preg_match( $class_re, $haystack );
			$has_url   = false;
			foreach ( $url_variants as $variant ) {
				if ( '' !== $variant && false !== strpos( $haystack, $variant ) ) {
					$has_url = true;
					break;
				}
			}
			if ( ! $has_class && ! $has_url ) {
				continue;
			}
			$rows_by_post[ $pid ] = 'content';
		}
	}

	return $rows_by_post;
}

function openstation_my_wordpress_media_usage_build( $attachment, $rows_by_post = null ) {
	$attachment_id = (int) $attachment->ID;
	$file_url      = (string) wp_get_attachment_url( $attachment_id );
	$file_basename = '' !== $file_url ? wp_basename( $file_url ) : '';

	$author     = get_userdata( (int) $attachment->post_author );
	$media_info = array(
		'id'        => $attachment_id,
		'title'     => (string) get_the_title( $attachment_id ),
		'mime'      => (string) $attachment->post_mime_type,
		'sourceUrl' => $file_url,
		'filename'  => $file_basename,
		'date'      => mysql2date( 'c', $attachment->post_date_gmt, false ),
		'author'    => array(
			'id'   => (int) $attachment->post_author,
			'name' => $author ? (string) $author->display_name : '',
		),
	);

	if ( ! is_array( $rows_by_post ) ) {
		$rows_by_post = openstation_my_wordpress_media_usage_collect( $attachment );
	}

	$public_types = array_values( get_post_types( array( 'public' => true ), 'names' ) );

	$public_types = array_values( array_diff( $public_types, array( 'attachment' ) ) );

	$type_objects = array();
	foreach ( $public_types as $type ) {
		$type_objects[ $type ] = get_post_type_object( $type );
	}

	$used_in = array();
	foreach ( $rows_by_post as $post_id => $used_as ) {
		$post = get_post( $post_id );
		if ( ! $post ) {
			continue;
		}
		if ( ! in_array( $post->post_type, $public_types, true ) ) {
			continue;
		}
		if ( ! current_user_can( 'read_post', $post_id ) ) {
			continue;
		}
		$author_obj = get_userdata( (int) $post->post_author );
		$type_obj   = isset( $type_objects[ $post->post_type ] ) ? $type_objects[ $post->post_type ] : null;
		$used_in[]  = array(
			'postId'        => (int) $post->ID,
			'postType'      => (string) $post->post_type,
			'postTypeLabel' => $type_obj && isset( $type_obj->labels->singular_name )
				? (string) $type_obj->labels->singular_name
				: (string) $post->post_type,
			'title'         => (string) get_the_title( $post ),
			'status'        => (string) $post->post_status,
			'link'          => (string) get_permalink( $post ),
			'editLink'      => (string) get_edit_post_link( $post->ID, 'raw' ),
			'usedAs'        => $used_as,
			'authorId'      => (int) $post->post_author,
			'authorName'    => $author_obj ? (string) $author_obj->display_name : '',
			'date'          => mysql2date( 'c', $post->post_date_gmt, false ),
		);
	}

	usort(
		$used_in,
		static function ( $a, $b ) {
			return strcmp( (string) $b['date'], (string) $a['date'] );
		}
	);

	return array(
		'media'  => $media_info,
		'usedIn' => $used_in,
	);
}

$GLOBALS['openstation_media_usage_pre_save_refs'] = array();

function openstation_my_wordpress_media_usage_extract_refs( $post ) {
	$ids = array();
	$obj = is_object( $post ) ? $post : get_post( (int) $post );
	if ( ! $obj || ! isset( $obj->ID ) ) {
		return $ids;
	}
	if ( ! function_exists( 'openstation_my_wordpress_post_attached_media' ) ) {

		$thumb = (int) get_post_meta( (int) $obj->ID, '_thumbnail_id', true );
		if ( $thumb > 0 ) {
			$ids[ $thumb ] = true;
		}
		$content = isset( $obj->post_content ) ? (string) $obj->post_content : '';
		if ( '' !== $content && preg_match_all( '/wp-image-(\d+)/', $content, $m ) ) {
			foreach ( $m[1] as $id ) {
				$ids[ (int) $id ] = true;
			}
		}
		return $ids;
	}
	foreach ( openstation_my_wordpress_post_attached_media( (int) $obj->ID ) as $id ) {
		$id = (int) $id;
		if ( $id > 0 ) {
			$ids[ $id ] = true;
		}
	}
	return $ids;
}

function openstation_my_wordpress_media_usage_snapshot_pre_save( $post_id ) {
	$post_id = (int) $post_id;
	if ( $post_id <= 0 ) {
		return;
	}
	$GLOBALS['openstation_media_usage_pre_save_refs'][ $post_id ] =
		openstation_my_wordpress_media_usage_extract_refs( $post_id );
}
add_action( 'pre_post_update', 'openstation_my_wordpress_media_usage_snapshot_pre_save' );

function openstation_my_wordpress_media_usage_bust_for_post( $post_id ) {
	$post_id = (int) $post_id;
	if ( $post_id <= 0 ) {
		return;
	}

	$ids = openstation_my_wordpress_media_usage_extract_refs( $post_id );

	if ( isset( $GLOBALS['openstation_media_usage_pre_save_refs'][ $post_id ] ) ) {
		$ids += $GLOBALS['openstation_media_usage_pre_save_refs'][ $post_id ];
		unset( $GLOBALS['openstation_media_usage_pre_save_refs'][ $post_id ] );
	}

	foreach ( array_keys( $ids ) as $attachment_id ) {
		foreach ( openstation_my_wordpress_media_usage_cache_buckets() as $bucket ) {
			delete_transient(
				openstation_my_wordpress_media_usage_cache_key( (int) $attachment_id, $bucket )
			);
		}
	}
}
add_action( 'save_post', 'openstation_my_wordpress_media_usage_bust_for_post' );

add_action( 'before_delete_post', 'openstation_my_wordpress_media_usage_bust_for_post' );

function openstation_my_wordpress_media_usage_bust_for_attachment( $post_id ) {
	$post_id = (int) $post_id;
	if ( $post_id <= 0 ) {
		return;
	}
	foreach ( openstation_my_wordpress_media_usage_cache_buckets() as $bucket ) {
		delete_transient(
			openstation_my_wordpress_media_usage_cache_key( $post_id, $bucket )
		);
	}
}
add_action( 'delete_attachment', 'openstation_my_wordpress_media_usage_bust_for_attachment' );
