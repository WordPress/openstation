<?php
/**
 * OpenStation — My WordPress: per-attachment "used in" endpoint.
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
 * Only the viewer-independent reference scan (post id => usedAs map)
 * is cached in a transient keyed on the attachment id; the per-row
 * `read_post` gate runs on every request, so a cached scan can never
 * leak rows across viewers with different capabilities. Cache is
 * busted whenever any post is saved or deleted.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register the route.
 */
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

/**
 * Cache TTL (seconds). Filterable so sites that bulk-import media
 * can shorten the window, or sites with stable libraries can
 * lengthen it.
 *
 * @param int $attachment_id Attachment id.
 * @return int
 */
function openstation_my_wordpress_media_usage_ttl( $attachment_id ) {
	/**
	 * Filter the media-usage transient TTL.
	 *
	 * @param int $seconds       Default 300 (5 minutes).
	 * @param int $attachment_id Attachment id the cache key is for.
	 */
	return (int) apply_filters( 'openstation_my_wordpress_media_usage_cache_ttl', 300, $attachment_id );
}

/**
 * Capability buckets the cache namespaces over. A second-tier
 * change to the gating logic must update this list — the busters
 * iterate over the same array, so the writer and the buster can
 * never go out of sync.
 *
 * @return string[]
 */
function openstation_my_wordpress_media_usage_cache_buckets() {
	return array( 'edit', 'read' );
}

/**
 * Bucket key for the current user — the writer's view of which
 * cache slot to read/write.
 *
 * @return string
 */
function openstation_my_wordpress_media_usage_current_bucket() {
	return current_user_can( 'edit_others_posts' ) ? 'edit' : 'read';
}

/**
 * Build the transient key — namespaces the cache by attachment id
 * AND a coarse capability bucket. The cached value is the
 * viewer-independent reference map (per-row capability gating runs
 * after the cache read), so the bucket is key hygiene rather than a
 * security boundary.
 *
 * @param int    $attachment_id Attachment id.
 * @param string $bucket        Optional bucket override. Defaults to
 *                              the current user's bucket.
 * @return string
 */
function openstation_my_wordpress_media_usage_cache_key( $attachment_id, $bucket = null ) {
	if ( null === $bucket ) {
		$bucket = openstation_my_wordpress_media_usage_current_bucket();
	}
	return 'dm_media_usage_' . (int) $attachment_id . '_' . $bucket . '_v1';
}

/**
 * Endpoint callback. See file docblock for payload shape.
 *
 * @param WP_REST_Request $request REST request.
 * @return array|WP_Error
 */
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

	/*
	 * The transient stores ONLY the viewer-independent reference map
	 * (post id => usedAs). Both the per-row `read_post` gate and the
	 * extension filter run on every request: the gate so a cache hit
	 * written during one viewer's request can never leak unreadable
	 * rows to another viewer, the filter so plugin extensions (ACF
	 * image meta, page-builder galleries, etc.) stay live while the
	 * heavy LIKE-scan portion stays cached. The base map only
	 * refreshes on the cache-bust events (save_post,
	 * before_delete_post, delete_attachment).
	 */
	$payload = openstation_my_wordpress_media_usage_build( $attachment, $rows_by_post );

	/**
	 * Filter the media-usage payload before returning to the bundle.
	 * Plugins (ACF, page builders, Yoast image meta) can append rows
	 * to `usedIn` describing their own attachment references.
	 *
	 * @param array $payload       Default payload.
	 * @param int   $attachment_id Subject attachment id.
	 */
	return apply_filters( 'openstation_my_wordpress_media_usage', $payload, $attachment_id );
}

/**
 * Collect the viewer-independent reference map for an attachment:
 * post id => 'featured'|'content'. This is the heavy SQL portion of
 * the payload and the ONLY part that gets transient-cached — the
 * per-row `read_post` gate lives in
 * `openstation_my_wordpress_media_usage_build()` and runs on every
 * request, so a cached map can never leak rows across viewers with
 * different capabilities.
 *
 * @param WP_Post $attachment Attachment post.
 * @return array<int,string> Map of post id => usedAs kind.
 */
function openstation_my_wordpress_media_usage_collect( $attachment ) {
	global $wpdb;

	$attachment_id = (int) $attachment->ID;
	$file_url      = (string) wp_get_attachment_url( $attachment_id );
	$file_basename = '' !== $file_url ? wp_basename( $file_url ) : '';

	$public_types = array_values( get_post_types( array( 'public' => true ), 'names' ) );
	// Filter out `attachment` from the search — attachments don't
	// reference other attachments in a meaningful way for this view.
	$public_types = array_values( array_diff( $public_types, array( 'attachment' ) ) );
	if ( empty( $public_types ) ) {
		return array();
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
	// We need to match the file basename AND its variants — WP
	// auto-generates `image-scaled.jpg` for big uploads and stores
	// THAT as `_wp_attached_file`, while editors emit the original
	// URL in `<img src>`. Without trying both, a post embedding the
	// unscaled URL never matches a `-scaled` attachment.
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

		// Build the OR-arms — one for class, N for URL variants.
		$pattern_args   = array_merge( array( $class_pattern ), $url_patterns );
		$pattern_clause = implode( ' OR ', array_fill( 0, count( $pattern_args ), 'post_content LIKE %s' ) );
		$type_holders   = implode( ',', array_fill( 0, count( $public_types ), '%s' ) );
		$query_args     = array_merge( $pattern_args, $public_types );

		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$content_rows = $wpdb->get_col(
			$wpdb->prepare(
				"SELECT ID FROM {$wpdb->posts}
				 WHERE ( {$pattern_clause} )
				   AND post_status NOT IN ( 'auto-draft', 'inherit', 'trash' )
				   AND post_type IN ( {$type_holders} )",
				$query_args
			)
		);

		// Build the URL-variant list (canonical + unscaled) for the
		// confirmation pass below. `wp_get_attachment_image_src` is
		// unaware of these — we precompute them here.
		$url_variants = array();
		if ( '' !== $file_url ) {
			$url_variants[] = $file_url;
			if ( preg_match( '/^(.*)-scaled(\.[a-zA-Z0-9]+)$/', $file_url, $m ) ) {
				$url_variants[] = $m[1] . $m[2];
			} elseif ( preg_match( '/^(.*)(\.[a-zA-Z0-9]+)$/', $file_url, $m ) ) {
				$url_variants[] = $m[1] . '-scaled' . $m[2];
			}
		}

		// The LIKE scan over-fetches: `%wp-image-12%` matches
		// `wp-image-123`. Re-check each candidate with a word-
		// boundary regex (matches `wp-image-12` followed by any
		// non-digit, or end of string), AND accept any post that
		// contains any of the URL variants.
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

/**
 * Build the payload for the CURRENT viewer. The reference map can be
 * passed in (typically straight from the transient); when omitted
 * it's collected fresh. Row building applies
 * `current_user_can( 'read_post' )` per row on every call — never
 * cache this function's output, it is viewer-specific.
 *
 * @param WP_Post                $attachment   Attachment post.
 * @param array<int,string>|null $rows_by_post Optional precollected map of
 *                                             post id => usedAs kind.
 * @return array
 */
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
	// Filter out `attachment` from the search — attachments don't
	// reference other attachments in a meaningful way for this view.
	$public_types = array_values( array_diff( $public_types, array( 'attachment' ) ) );

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
 * Per-post stash of attachment ids referenced BEFORE an in-progress
 * update. Populated on `pre_post_update` (where the DB row still
 * reflects the previous state), drained on `save_post` so the
 * buster can union pre + post sets — otherwise removing a
 * `wp-image-N` block from a post would leave the cache for
 * attachment N stale until the TTL expires.
 *
 * @var array<int,array<int,true>>
 */
$GLOBALS['openstation_media_usage_pre_save_refs'] = array();

/**
 * Extract attachment ids referenced by a post — featured image plus
 * everything resolvable from `post_content`. Defers to the canonical
 * resolver in `attached-media.php` so this buster catches the same
 * cases the REST field does (block-class scan, classic `[caption]`
 * shortcodes, `data-id` / `data-attachment-id`, and raw `<img src>`
 * URL resolution including `-scaled.jpg` ↔ original swaps), plus
 * any ids appended via the `openstation_my_wordpress_attached_media`
 * filter (ACF, page builders, post-meta galleries). Without this
 * delegation, editing a post to add or remove a raw URL embed
 * wouldn't bust the affected attachment's media-usage cache until
 * the TTL expired.
 *
 * @param int|WP_Post $post Post id or object.
 * @return array<int,true> Set of attachment ids keyed for dedup.
 */
function openstation_my_wordpress_media_usage_extract_refs( $post ) {
	$ids = array();
	$obj = is_object( $post ) ? $post : get_post( (int) $post );
	if ( ! $obj || ! isset( $obj->ID ) ) {
		return $ids;
	}
	if ( ! function_exists( 'openstation_my_wordpress_post_attached_media' ) ) {
		// Defensive: bootstrap order should always load
		// attached-media.php before this can be called from a save
		// hook, but fall back to the legacy minimal scan just in
		// case so the buster never silently no-ops.
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

/**
 * Snapshot the attachment refs of a post just before it's updated.
 * Fired by `pre_post_update`, which runs before the DB row mutates,
 * so `get_post` here returns the OLD content. We stash the ref set
 * in a per-request global and read it back in the `save_post` hook.
 *
 * @param int $post_id Post id about to be updated.
 */
function openstation_my_wordpress_media_usage_snapshot_pre_save( $post_id ) {
	$post_id = (int) $post_id;
	if ( $post_id <= 0 ) {
		return;
	}
	$GLOBALS['openstation_media_usage_pre_save_refs'][ $post_id ] =
		openstation_my_wordpress_media_usage_extract_refs( $post_id );
}
add_action( 'pre_post_update', 'openstation_my_wordpress_media_usage_snapshot_pre_save' );

/**
 * Bust the transient when a post changes. The cache key is
 * per-attachment, so we don't know which entries reference what —
 * the correct move is to delete cache for every attachment
 * referenced by the saved/deleted post. The union of:
 *
 *   - pre-save refs (captured by `pre_post_update` above) so a
 *     reference removal still busts the dropped attachment's cache,
 *   - post-save refs (read here) so a freshly-added reference
 *     busts the cache too.
 *
 * Bounded by the actual count of `wp-image-N` matches in either
 * version of the content + the post's `_thumbnail_id`.
 *
 * @param int $post_id Post id that was just modified.
 */
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
// `before_delete_post`, NOT `deleted_post`. By the time `deleted_post`
// fires, `delete_all_meta_for_post` has already wiped `_thumbnail_id`
// and the row itself is gone — `extract_refs()` would return an empty
// set, so the cache for any referenced attachment would survive until
// its 5-minute TTL. `before_delete_post` fires while the post + meta
// are still readable. Signature matches (we only consume the first
// arg, the post id).
add_action( 'before_delete_post', 'openstation_my_wordpress_media_usage_bust_for_post' );
// New posts skip `pre_post_update` but still go through `save_post`,
// so the buster works as-is — the pre-snapshot is just empty.

/**
 * Bust the transient when the attachment itself is deleted.
 *
 * @param int $post_id Attachment id.
 */
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
