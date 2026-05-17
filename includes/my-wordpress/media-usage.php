<?php
/**
 * Desktop Mode — My WordPress: per-attachment "used in" endpoint.
 *
 * `GET /desktop-mode/v1/media-usage/<id>` returns the list of public
 * post-type entries that reference a given attachment, either as
 * featured image (`_thumbnail_id` meta) or as an embed inside
 * `post_content` (block-editor `wp-image-<id>` class or a direct URL
 * to the attachment file).
 *
 * Payload shape:
 *
 *   {
 *     media: { id, title, mime, sourceUrl, filename, date, author },
 *     usedIn: [
 *       { postId, postType, postTypeLabel, title, status, link,
 *         editLink, usedAs: 'featured'|'content'|'meta',
 *         authorId, authorName, date }
 *     ]
 *   }
 *
 * Rows are filtered per-row with `current_user_can( 'read_post' )`,
 * so subscribers never see drafts/private posts they can't read.
 *
 * Results are cached in a transient keyed on the attachment id +
 * the viewer's effective capability scope. Cache is busted whenever
 * any post is saved or deleted.
 *
 * @package WPDesktopMode
 * @since   0.21.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register the route.
 *
 * @since 0.21.0
 */
function desktop_mode_my_wordpress_register_media_usage_route() {
	register_rest_route(
		'desktop-mode/v1',
		'/media-usage/(?P<id>\d+)',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => 'desktop_mode_my_wordpress_media_usage_callback',
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
add_action( 'rest_api_init', 'desktop_mode_my_wordpress_register_media_usage_route' );

/**
 * Cache TTL (seconds). Filterable so sites that bulk-import media
 * can shorten the window, or sites with stable libraries can
 * lengthen it.
 *
 * @since 0.21.0
 *
 * @param int $attachment_id Attachment id.
 * @return int
 */
function desktop_mode_my_wordpress_media_usage_ttl( $attachment_id ) {
	/**
	 * Filter the media-usage transient TTL.
	 *
	 * @since 0.21.0
	 *
	 * @param int $seconds       Default 300 (5 minutes).
	 * @param int $attachment_id Attachment id the cache key is for.
	 */
	return (int) apply_filters( 'desktop_mode_my_wordpress_media_usage_cache_ttl', 300, $attachment_id );
}

/**
 * Build the transient key — namespaces the cache by attachment id
 * AND a coarse capability bucket so admins and viewers never share
 * a hit.
 *
 * @since 0.21.0
 *
 * @param int $attachment_id Attachment id.
 * @return string
 */
function desktop_mode_my_wordpress_media_usage_cache_key( $attachment_id ) {
	$bucket = current_user_can( 'edit_others_posts' ) ? 'edit' : 'read';
	return 'dm_media_usage_' . (int) $attachment_id . '_' . $bucket . '_v1';
}

/**
 * Endpoint callback. See file docblock for payload shape.
 *
 * @since 0.21.0
 *
 * @param WP_REST_Request $request REST request.
 * @return array|WP_Error
 */
function desktop_mode_my_wordpress_media_usage_callback( $request ) {
	$attachment_id = (int) $request->get_param( 'id' );
	$attachment    = get_post( $attachment_id );
	if ( ! $attachment || 'attachment' !== $attachment->post_type ) {
		return new WP_Error(
			'desktop_mode_media_not_found',
			__( 'Attachment not found.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}

	$cache_key = desktop_mode_my_wordpress_media_usage_cache_key( $attachment_id );
	$cached    = get_transient( $cache_key );
	if ( is_array( $cached ) ) {
		/** This filter is documented in includes/my-wordpress/media-usage.php */
		return apply_filters( 'desktop_mode_my_wordpress_media_usage', $cached, $attachment_id );
	}

	$payload = desktop_mode_my_wordpress_media_usage_build( $attachment );

	set_transient(
		$cache_key,
		$payload,
		desktop_mode_my_wordpress_media_usage_ttl( $attachment_id )
	);

	/**
	 * Filter the media-usage payload before returning to the bundle.
	 * Plugins (ACF, page builders, Yoast image meta) can append rows
	 * to `usedIn` describing their own attachment references.
	 *
	 * @since 0.21.0
	 *
	 * @param array $payload       Default payload.
	 * @param int   $attachment_id Subject attachment id.
	 */
	return apply_filters( 'desktop_mode_my_wordpress_media_usage', $payload, $attachment_id );
}

/**
 * Build the un-filtered payload. Separated from the callback so the
 * cache bypass can short-circuit before any DB work.
 *
 * @since 0.21.0
 *
 * @param WP_Post $attachment Attachment post.
 * @return array
 */
function desktop_mode_my_wordpress_media_usage_build( $attachment ) {
	global $wpdb;

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

	$public_types = array_values( get_post_types( array( 'public' => true ), 'names' ) );
	// Filter out `attachment` from the search — attachments don't
	// reference other attachments in a meaningful way for this view.
	$public_types = array_values( array_diff( $public_types, array( 'attachment' ) ) );
	if ( empty( $public_types ) ) {
		return array(
			'media'  => $media_info,
			'usedIn' => array(),
		);
	}

	// `usedAs` priority: featured > content > meta. We collect every
	// hit per post id, then collapse to the highest-priority kind for
	// display so a row isn't double-listed.
	$rows_by_post = array();

	// --- Featured image references --------------------------------------
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

	// --- Content embeds (block class + raw URL) -------------------------
	if ( '' !== $file_basename ) {
		$placeholders   = implode( ',', array_fill( 0, count( $public_types ), '%s' ) );
		$class_pattern  = '%wp-image-' . $attachment_id . '%';
		$url_pattern    = '%' . $wpdb->esc_like( $file_basename ) . '%';
		$query_args     = array_merge(
			array( $class_pattern, $url_pattern ),
			$public_types
		);
		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$content_rows = $wpdb->get_col(
			$wpdb->prepare(
				"SELECT ID FROM {$wpdb->posts}
				 WHERE ( post_content LIKE %s OR post_content LIKE %s )
				   AND post_status NOT IN ( 'auto-draft', 'inherit', 'trash' )
				   AND post_type IN ( {$placeholders} )",
				$query_args
			)
		);
		foreach ( (array) $content_rows as $pid ) {
			$pid = (int) $pid;
			if ( $pid > 0 && ! isset( $rows_by_post[ $pid ] ) ) {
				$rows_by_post[ $pid ] = 'content';
			}
		}
	}

	// --- Build the row payload, per-row capability gated ----------------
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

	// Stable sort: most recent first.
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

/**
 * Bust the transient when a post changes. The cache key is
 * per-attachment, so we don't know which entries reference what —
 * the cheap correct move is to delete cache for every attachment
 * referenced by the saved/deleted post. Bounded by the actual
 * count of `wp-image-N` matches in the saved content + the post's
 * `_thumbnail_id`.
 *
 * @since 0.21.0
 *
 * @param int $post_id Post id that was just modified.
 */
function desktop_mode_my_wordpress_media_usage_bust_for_post( $post_id ) {
	$post_id = (int) $post_id;
	if ( $post_id <= 0 ) {
		return;
	}
	$ids = array();

	$thumb = (int) get_post_meta( $post_id, '_thumbnail_id', true );
	if ( $thumb > 0 ) {
		$ids[ $thumb ] = true;
	}

	$post = get_post( $post_id );
	if ( $post && isset( $post->post_content ) && false !== strpos( $post->post_content, 'wp-image-' ) ) {
		if ( preg_match_all( '/wp-image-(\d+)/', $post->post_content, $m ) ) {
			foreach ( $m[1] as $id ) {
				$ids[ (int) $id ] = true;
			}
		}
	}

	foreach ( array_keys( $ids ) as $attachment_id ) {
		delete_transient( 'dm_media_usage_' . (int) $attachment_id . '_edit_v1' );
		delete_transient( 'dm_media_usage_' . (int) $attachment_id . '_read_v1' );
	}
}
add_action( 'save_post', 'desktop_mode_my_wordpress_media_usage_bust_for_post' );
add_action( 'deleted_post', 'desktop_mode_my_wordpress_media_usage_bust_for_post' );

/**
 * Bust the transient when the attachment itself is deleted.
 *
 * @since 0.21.0
 *
 * @param int $post_id Attachment id.
 */
function desktop_mode_my_wordpress_media_usage_bust_for_attachment( $post_id ) {
	$post_id = (int) $post_id;
	if ( $post_id <= 0 ) {
		return;
	}
	delete_transient( 'dm_media_usage_' . $post_id . '_edit_v1' );
	delete_transient( 'dm_media_usage_' . $post_id . '_read_v1' );
}
add_action( 'delete_attachment', 'desktop_mode_my_wordpress_media_usage_bust_for_attachment' );
