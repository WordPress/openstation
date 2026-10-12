<?php
/**
 * OpenStation — stored files → the Media Library.
 *
 * A file dragged onto the desktop lives in the plugin's own storage,
 * outside the Media Library on purpose (see `stored-files-store.php`).
 * This module is the bridge back: a stored file the site would accept
 * as an upload can be COPIED into the Media Library as a regular
 * attachment, and — for media — used to start a new post or page
 * with the attachment already in place.
 *
 * Two routes:
 *
 *   POST /desktop-mode/v1/files/uploads/<id>/media
 *       Copy the bytes into the Media Library. Idempotent: the
 *       attachment remembers its source row in
 *       `_openstation_stored_file_id` post meta, and a second call
 *       returns the existing attachment instead of a duplicate.
 *
 *   POST /desktop-mode/v1/files/uploads/<id>/post   { postType }
 *       The same copy, then a fresh `auto-draft` of `postType` whose
 *       content is the attachment as a block (image / video / audio /
 *       file) and whose featured image is the attachment when it is
 *       an image. The response carries the edit URL; the client opens
 *       it in a window. `auto-draft` is exactly what `post-new.php`
 *       creates, so an abandoned "start a post" leaves nothing the
 *       daily auto-draft sweep will not clear.
 *
 * The stored file is never moved or altered — the placement keeps
 * owning it, and trashing the tile later does not touch the
 * attachment (nor the other way round).
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Attachment post-meta key naming the stored-file row an attachment
 * was copied from. One attachment per stored file, per site.
 */
const OPENSTATION_MEDIA_SOURCE_META = '_openstation_stored_file_id';

/**
 * Attachment post-meta key carrying the source row's disk name. The
 * row id alone is not a safe identity — ids can be reissued after
 * the table empties — but the disk name is a UUID, so the pair is.
 */
const OPENSTATION_MEDIA_SOURCE_KEY_META = '_openstation_stored_file_key';

/**
 * Whether a stored file is something the Media Library would accept.
 *
 * "Media" here is the WordPress definition — a MIME type on the
 * site's upload allow-list — rather than only images, so a PDF or
 * an audio file qualifies while an `.exe` never does.
 *
 * @param array $row Stored-file row.
 * @return bool
 */
function openstation_stored_file_is_media( $row ) {
	$mime     = is_array( $row ) ? strtolower( trim( (string) ( $row['mime'] ?? '' ) ) ) : '';
	$is_media = '' !== $mime && in_array( $mime, array_values( get_allowed_mime_types() ), true );

	/**
	 * Filters whether a stored file may be copied into the Media
	 * Library (and therefore whether the tile offers it).
	 *
	 * @param bool  $is_media Default: the MIME type is on the site's upload allow-list.
	 * @param array $row      Stored-file row.
	 */
	return (bool) apply_filters( 'openstation_stored_file_is_media', $is_media, $row );
}

/**
 * The attachment previously copied from a stored file, if any.
 *
 * @param array $row Stored-file row.
 * @return int Attachment id, or 0.
 */
function openstation_stored_file_find_attachment( $row ) {
	$file_id   = is_array( $row ) ? (int) ( $row['id'] ?? 0 ) : 0;
	$disk_name = is_array( $row ) ? (string) ( $row['disk_name'] ?? '' ) : '';
	if ( $file_id <= 0 || '' === $disk_name ) {
		return 0;
	}
	$found = get_posts(
		array(
			'post_type'      => 'attachment',
			'post_status'    => array( 'inherit', 'private' ),
			'posts_per_page' => 1,
			'fields'         => 'ids',
			'orderby'        => 'ID',
			'order'          => 'ASC',
			'no_found_rows'  => true,
			// phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query -- one attachment per stored file; the lookup is bounded to one row.
			'meta_query'     => array(
				array(
					'key'   => OPENSTATION_MEDIA_SOURCE_META,
					'value' => (string) $file_id,
				),
				array(
					'key'   => OPENSTATION_MEDIA_SOURCE_KEY_META,
					'value' => $disk_name,
				),
			),
		)
	);
	return $found ? (int) $found[0] : 0;
}

/**
 * The filename a copy of a stored file is registered under.
 *
 * The display name is what the user sees, but a rename can leave it
 * without an extension, and `wp_check_filetype_and_ext()` needs one
 * that agrees with the bytes — so a missing extension is derived
 * from the row's MIME type.
 *
 * @param array $row Stored-file row.
 * @return string
 */
function openstation_stored_file_media_filename( $row ) {
	$name = sanitize_file_name( (string) $row['display_name'] );
	if ( '' === $name ) {
		$name = 'file';
	}
	$check = wp_check_filetype( $name );
	if ( empty( $check['ext'] ) ) {
		$ext = wp_get_default_extension_for_mime_type( (string) $row['mime'] );
		if ( $ext ) {
			$name .= '.' . $ext;
		}
	}
	return $name;
}

/**
 * Copy a stored file into the Media Library as an attachment.
 *
 * Idempotent per stored file: a second call returns the attachment
 * the first one created. The caller is responsible for the
 * capability check (`upload_files`); this helper checks read access
 * to the stored file and the media policy.
 *
 * @param int $file_id Stored-file id.
 * @param int $user_id Acting user; becomes the attachment author.
 * @return array|WP_Error `{ attachment_id, created }`.
 */
function openstation_stored_file_to_attachment( $file_id, $user_id ) {
	$file_id = (int) $file_id;
	$user_id = (int) $user_id;
	$row     = openstation_stored_files_get( $file_id );
	if ( ! $row || ! openstation_stored_file_user_can_read( $file_id, $user_id ) ) {
		return openstation_files_download_not_found();
	}
	if ( ! openstation_stored_file_is_media( $row ) ) {
		return new WP_Error(
			'openstation_stored_file_not_media',
			__( 'This file type cannot be added to the Media Library.', 'desktop-mode' ),
			array( 'status' => 415 )
		);
	}

	$existing = openstation_stored_file_find_attachment( $row );
	if ( $existing > 0 ) {
		return array(
			'attachment_id' => $existing,
			'created'       => false,
		);
	}

	$path = openstation_stored_file_path( $row );
	if ( ! $path || ! file_exists( $path ) ) {
		return openstation_files_download_not_found();
	}

	require_once ABSPATH . 'wp-admin/includes/file.php';
	require_once ABSPATH . 'wp-admin/includes/media.php';
	require_once ABSPATH . 'wp-admin/includes/image.php';

	// The sideload consumes its input file, and the stored bytes
	// stay the placement's — so it gets a scratch copy.
	$name = openstation_stored_file_media_filename( $row );
	$tmp  = wp_tempnam( $name );
	if ( ! $tmp || ! copy( $path, $tmp ) ) {
		if ( $tmp ) {
			wp_delete_file( $tmp );
		}
		return new WP_Error(
			'openstation_stored_file_copy_failed',
			__( 'The file could not be copied.', 'desktop-mode' ),
			array( 'status' => 500 )
		);
	}

	$post_data = array(
		'post_author' => $user_id,
	);
	/**
	 * Filters the attachment post fields for a stored file copied into
	 * the Media Library (`post_title`, `post_excerpt` for the caption,
	 * `post_content` for the description, …).
	 *
	 * @param array $post_data Fields passed to `media_handle_sideload()`.
	 * @param array $row       Stored-file row.
	 * @param int   $user_id   Acting user.
	 */
	$post_data = (array) apply_filters( 'openstation_stored_file_media_post_data', $post_data, $row, $user_id );

	$attachment_id = media_handle_sideload(
		array(
			'name'     => $name,
			'tmp_name' => $tmp,
			'type'     => (string) $row['mime'],
			'size'     => (int) $row['size_bytes'],
		),
		0,
		null,
		$post_data
	);
	if ( is_wp_error( $attachment_id ) ) {
		if ( file_exists( $tmp ) ) {
			wp_delete_file( $tmp );
		}
		$attachment_id->add_data( array( 'status' => 400 ) );
		return $attachment_id;
	}
	$attachment_id = (int) $attachment_id;
	update_post_meta( $attachment_id, OPENSTATION_MEDIA_SOURCE_META, (string) $file_id );
	update_post_meta( $attachment_id, OPENSTATION_MEDIA_SOURCE_KEY_META, (string) $row['disk_name'] );

	/**
	 * Fires after a stored file has been copied into the Media Library.
	 *
	 * @param int $attachment_id The new attachment.
	 * @param int $file_id       Source stored-file id.
	 * @param int $user_id       Acting user.
	 */
	do_action( 'openstation_stored_file_added_to_media', $attachment_id, $file_id, $user_id );

	return array(
		'attachment_id' => $attachment_id,
		'created'       => true,
	);
}

/**
 * Block markup that places an attachment in a fresh post.
 *
 * @param int $attachment_id Attachment id.
 * @return string Serialized block.
 */
function openstation_attachment_block_markup( $attachment_id ) {
	$attachment_id = (int) $attachment_id;
	$mime          = (string) get_post_mime_type( $attachment_id );
	$url           = (string) wp_get_attachment_url( $attachment_id );
	$major         = strtok( $mime, '/' );

	if ( 'image' === $major ) {
		$src = wp_get_attachment_image_url( $attachment_id, 'large' );
		$src = $src ? $src : $url;
		return sprintf(
			'<!-- wp:image {"id":%1$d,"sizeSlug":"large","linkDestination":"none"} -->' .
			'<figure class="wp-block-image size-large"><img src="%2$s" alt="" class="wp-image-%1$d"/></figure>' .
			'<!-- /wp:image -->',
			$attachment_id,
			esc_url( $src )
		);
	}
	if ( 'video' === $major ) {
		return sprintf(
			'<!-- wp:video {"id":%1$d} --><figure class="wp-block-video"><video controls src="%2$s"></video></figure><!-- /wp:video -->',
			$attachment_id,
			esc_url( $url )
		);
	}
	if ( 'audio' === $major ) {
		return sprintf(
			'<!-- wp:audio {"id":%1$d} --><figure class="wp-block-audio"><audio controls src="%2$s"></audio></figure><!-- /wp:audio -->',
			$attachment_id,
			esc_url( $url )
		);
	}
	$title = get_the_title( $attachment_id );
	$title = '' !== $title ? $title : wp_basename( $url );
	return sprintf(
		'<!-- wp:file {"id":%1$d,"href":"%2$s"} --><div class="wp-block-file"><a href="%2$s">%3$s</a>' .
		'<a href="%2$s" class="wp-block-file__button wp-element-button" download>%4$s</a></div><!-- /wp:file -->',
		$attachment_id,
		esc_url( $url ),
		esc_html( $title ),
		esc_html__( 'Download', 'desktop-mode' )
	);
}

/**
 * Start a new post (or page, or any post type) from a stored file.
 *
 * Copies the file into the Media Library first (idempotently), then
 * inserts an `auto-draft` whose content is that attachment as a
 * block, with the attachment as the featured image when it is one.
 *
 * @param int    $file_id   Stored-file id.
 * @param string $post_type Post type to create.
 * @param int    $user_id   Acting user; becomes the author.
 * @return array|WP_Error `{ post_id, post_type, attachment_id, created, edit_url }`.
 */
function openstation_stored_file_start_post( $file_id, $post_type, $user_id ) {
	$file_id   = (int) $file_id;
	$user_id   = (int) $user_id;
	$post_type = sanitize_key( (string) $post_type );
	$pto       = get_post_type_object( $post_type );
	if ( ! $pto || ! post_type_supports( $post_type, 'editor' ) ) {
		return new WP_Error(
			'openstation_stored_file_bad_post_type',
			__( 'That post type cannot be started from a file.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}
	if ( ! user_can( $user_id, $pto->cap->create_posts ) ) {
		return new WP_Error(
			'openstation_stored_file_cannot_create_posts',
			__( 'You are not allowed to create this kind of content.', 'desktop-mode' ),
			array( 'status' => 403 )
		);
	}

	$attached = openstation_stored_file_to_attachment( $file_id, $user_id );
	if ( is_wp_error( $attached ) ) {
		return $attached;
	}
	$attachment_id = (int) $attached['attachment_id'];
	$row           = openstation_stored_files_get( $file_id );

	$content = openstation_attachment_block_markup( $attachment_id );
	/**
	 * Filters the initial content of a post started from a stored file.
	 *
	 * @param string $content       Serialized block markup.
	 * @param int    $attachment_id The Media Library copy.
	 * @param string $post_type     Post type being created.
	 * @param array  $row           Stored-file row.
	 */
	$content = (string) apply_filters( 'openstation_stored_file_start_post_content', $content, $attachment_id, $post_type, $row );

	$args = array(
		'post_type'    => $post_type,
		'post_status'  => 'auto-draft',
		'post_title'   => '',
		'post_content' => $content,
		'post_author'  => $user_id,
	);
	/**
	 * Filters the `wp_insert_post()` arguments of a post started from
	 * a stored file. Keep `post_status` at `auto-draft` unless you
	 * want abandoned starts to persist as drafts.
	 *
	 * @param array  $args          Insert arguments.
	 * @param int    $attachment_id The Media Library copy.
	 * @param string $post_type     Post type being created.
	 * @param array  $row           Stored-file row.
	 */
	$args = (array) apply_filters( 'openstation_stored_file_start_post_args', $args, $attachment_id, $post_type, $row );

	$post_id = wp_insert_post( wp_slash( $args ), true );
	if ( is_wp_error( $post_id ) ) {
		$post_id->add_data( array( 'status' => 500 ) );
		return $post_id;
	}
	$post_id = (int) $post_id;

	if ( wp_attachment_is_image( $attachment_id ) && post_type_supports( $post_type, 'thumbnail' ) ) {
		set_post_thumbnail( $post_id, $attachment_id );
	}

	/**
	 * Fires after a post has been started from a stored file.
	 *
	 * @param int    $post_id       The new auto-draft.
	 * @param int    $attachment_id The Media Library copy.
	 * @param int    $file_id       Source stored-file id.
	 * @param int    $user_id       Acting user.
	 */
	do_action( 'openstation_stored_file_post_started', $post_id, $attachment_id, $file_id, $user_id );

	return array(
		'post_id'       => $post_id,
		'post_type'     => $post_type,
		'attachment_id' => $attachment_id,
		'created'       => (bool) $attached['created'],
		'edit_url'      => admin_url( sprintf( 'post.php?post=%d&action=edit', $post_id ) ),
	);
}

/**
 * Put stored files into an existing post.
 *
 * Each file is copied into the Media Library (idempotently), its
 * block is appended to the post content when the post type has an
 * editor, it is attached to the post when it was attached to nothing,
 * and the first image becomes the featured image when the post type
 * supports one and the post has none. All-or-nothing on the copies:
 * a file that cannot be copied fails the request before the post is
 * touched.
 *
 * @param int   $post_id  Target post.
 * @param int[] $file_ids Stored-file ids, in the order they were dragged.
 * @param int   $user_id  Acting user; must be able to edit the post.
 * @return array|WP_Error `{ post_id, attachment_ids, appended, featured_image_set, edit_url }`.
 */
function openstation_stored_files_attach_to_post( $post_id, $file_ids, $user_id ) {
	$post_id  = (int) $post_id;
	$user_id  = (int) $user_id;
	$file_ids = array_values( array_unique( array_filter( array_map( 'intval', (array) $file_ids ) ) ) );
	$post     = get_post( $post_id );
	if ( ! $post || in_array( $post->post_type, array( 'attachment', 'revision' ), true ) ) {
		return new WP_Error(
			'openstation_stored_file_post_not_found',
			__( 'Post not found.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}
	if ( ! user_can( $user_id, 'edit_post', $post_id ) ) {
		return new WP_Error(
			'openstation_stored_file_cannot_edit_post',
			__( 'You are not allowed to edit this post.', 'desktop-mode' ),
			array( 'status' => 403 )
		);
	}
	if ( 'trash' === $post->post_status ) {
		return new WP_Error(
			'openstation_stored_file_post_trashed',
			__( 'That post is in the Trash.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}
	if ( empty( $file_ids ) ) {
		return new WP_Error(
			'openstation_stored_file_no_files',
			__( 'No files to add.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}

	$attachment_ids = array();
	foreach ( $file_ids as $file_id ) {
		$attached = openstation_stored_file_to_attachment( $file_id, $user_id );
		if ( is_wp_error( $attached ) ) {
			return $attached;
		}
		$attachment_ids[] = (int) $attached['attachment_id'];
	}

	$markup = implode( "\n\n", array_map( 'openstation_attachment_block_markup', $attachment_ids ) );
	/**
	 * Filters the block markup appended to a post when stored files
	 * are dropped onto it.
	 *
	 * @param string  $markup         Serialized blocks, one per attachment.
	 * @param int[]   $attachment_ids The Media Library copies, in drop order.
	 * @param WP_Post $post           The post being extended.
	 * @param int[]   $file_ids       Source stored-file ids.
	 */
	$markup = (string) apply_filters( 'openstation_stored_file_attach_content', $markup, $attachment_ids, $post, $file_ids );

	$appended = false;
	if ( post_type_supports( $post->post_type, 'editor' ) && '' !== $markup ) {
		$content = '' === trim( $post->post_content ) ? $markup : rtrim( $post->post_content ) . "\n\n" . $markup;
		$updated = wp_update_post(
			wp_slash(
				array(
					'ID'           => $post_id,
					'post_content' => $content,
				)
			),
			true
		);
		if ( is_wp_error( $updated ) ) {
			$updated->add_data( array( 'status' => 500 ) );
			return $updated;
		}
		$appended = true;
	}

	$featured_image_set = false;
	foreach ( $attachment_ids as $attachment_id ) {
		if ( 0 === (int) get_post_field( 'post_parent', $attachment_id ) ) {
			wp_update_post(
				array(
					'ID'          => $attachment_id,
					'post_parent' => $post_id,
				)
			);
		}
		if (
			! $featured_image_set &&
			post_type_supports( $post->post_type, 'thumbnail' ) &&
			! has_post_thumbnail( $post_id ) &&
			wp_attachment_is_image( $attachment_id )
		) {
			$featured_image_set = (bool) set_post_thumbnail( $post_id, $attachment_id );
		}
	}

	/**
	 * Fires after stored files have been put into a post.
	 *
	 * @param int   $post_id        The post.
	 * @param int[] $attachment_ids The Media Library copies, in drop order.
	 * @param int[] $file_ids       Source stored-file ids.
	 * @param int   $user_id        Acting user.
	 */
	do_action( 'openstation_stored_file_attached_to_post', $post_id, $attachment_ids, $file_ids, $user_id );

	return array(
		'post_id'            => $post_id,
		'attachment_ids'     => $attachment_ids,
		'appended'           => $appended,
		'featured_image_set' => $featured_image_set,
		'edit_url'           => admin_url( sprintf( 'post.php?post=%d&action=edit', $post_id ) ),
	);
}

/**
 * Permission callback: the base files gate plus WordPress's own
 * Media Library capability.
 *
 * @return true|WP_Error
 */
function openstation_files_rest_media_permission() {
	$base = openstation_files_rest_permission();
	if ( true !== $base ) {
		return $base;
	}
	if ( ! current_user_can( 'upload_files' ) ) {
		return new WP_Error(
			'openstation_stored_file_cannot_add_to_media',
			__( 'You are not allowed to add files to the Media Library.', 'desktop-mode' ),
			array( 'status' => 403 )
		);
	}
	return true;
}

/**
 * Register the two routes.
 */
function openstation_files_register_media_rest_routes() {
	register_rest_route(
		'desktop-mode/v1',
		'/files/uploads/(?P<id>\d+)/media',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'permission_callback' => 'openstation_files_rest_media_permission',
			'callback'            => 'openstation_files_rest_add_to_media',
		)
	);
	register_rest_route(
		'desktop-mode/v1',
		'/files/uploads/(?P<id>\d+)/post',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'permission_callback' => 'openstation_files_rest_media_permission',
			'callback'            => 'openstation_files_rest_start_post',
			'args'                => array(
				'postType' => array(
					'type'    => 'string',
					'default' => 'post',
				),
			),
		)
	);
	register_rest_route(
		'desktop-mode/v1',
		'/files/posts/(?P<id>\d+)/uploads',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'permission_callback' => 'openstation_files_rest_media_permission',
			'callback'            => 'openstation_files_rest_attach_to_post',
			'args'                => array(
				'fileIds' => array(
					'type'     => 'array',
					'required' => true,
					'items'    => array( 'type' => 'integer' ),
				),
			),
		)
	);
}
add_action( 'rest_api_init', 'openstation_files_register_media_rest_routes' );

/**
 * The attachment summary both routes return.
 *
 * @param int  $attachment_id Attachment id.
 * @param bool $created       Whether this request created it.
 * @return array
 */
function openstation_files_attachment_summary( $attachment_id, $created ) {
	$attachment_id = (int) $attachment_id;
	return array(
		'attachmentId' => $attachment_id,
		'created'      => (bool) $created,
		'title'        => openstation_plain_text_title( get_the_title( $attachment_id ) ),
		'url'          => (string) wp_get_attachment_url( $attachment_id ),
		'editUrl'      => admin_url( sprintf( 'post.php?post=%d&action=edit', $attachment_id ) ),
	);
}

/**
 * POST /files/uploads/<id>/media
 *
 * @param WP_REST_Request $req Request.
 * @return WP_REST_Response|WP_Error
 */
function openstation_files_rest_add_to_media( WP_REST_Request $req ) {
	$result = openstation_stored_file_to_attachment( (int) $req['id'], get_current_user_id() );
	if ( is_wp_error( $result ) ) {
		return $result;
	}
	return rest_ensure_response(
		openstation_files_attachment_summary( $result['attachment_id'], $result['created'] )
	);
}

/**
 * POST /files/uploads/<id>/post
 *
 * @param WP_REST_Request $req Request.
 * @return WP_REST_Response|WP_Error
 */
function openstation_files_rest_start_post( WP_REST_Request $req ) {
	$result = openstation_stored_file_start_post(
		(int) $req['id'],
		(string) $req->get_param( 'postType' ),
		get_current_user_id()
	);
	if ( is_wp_error( $result ) ) {
		return $result;
	}
	$summary = openstation_files_attachment_summary( $result['attachment_id'], $result['created'] );
	return rest_ensure_response(
		array(
			'postId'     => (int) $result['post_id'],
			'postType'   => (string) $result['post_type'],
			'editUrl'    => (string) $result['edit_url'],
			'attachment' => $summary,
		)
	);
}

/**
 * POST /files/posts/<id>/uploads   { fileIds }
 *
 * @param WP_REST_Request $req Request.
 * @return WP_REST_Response|WP_Error
 */
function openstation_files_rest_attach_to_post( WP_REST_Request $req ) {
	$result = openstation_stored_files_attach_to_post(
		(int) $req['id'],
		(array) $req->get_param( 'fileIds' ),
		get_current_user_id()
	);
	if ( is_wp_error( $result ) ) {
		return $result;
	}
	$attachments = array();
	foreach ( $result['attachment_ids'] as $attachment_id ) {
		$attachments[] = openstation_files_attachment_summary( $attachment_id, false );
	}
	return rest_ensure_response(
		array(
			'postId'           => (int) $result['post_id'],
			'title'            => openstation_plain_text_title( get_the_title( $result['post_id'] ) ),
			'editUrl'          => (string) $result['edit_url'],
			'appended'         => (bool) $result['appended'],
			'featuredImageSet' => (bool) $result['featured_image_set'],
			'attachments'      => $attachments,
		)
	);
}

/**
 * Whether the current user may start `$post_type` content.
 *
 * @param string $post_type Post type.
 * @return bool
 */
function openstation_user_can_start_post_type( $post_type ) {
	$pto = get_post_type_object( $post_type );
	return $pto && post_type_supports( $post_type, 'editor' ) && current_user_can( $pto->cap->create_posts );
}

/**
 * Shell-config injection: which of the media actions the viewer may
 * take, so the tile menu does not offer what the server would 403.
 *
 * @param array $config Shell config.
 * @return array
 */
function openstation_stored_files_inject_media_shell_config( $config ) {
	$storage = isset( $config['desktopStorage'] ) && is_array( $config['desktopStorage'] )
		? $config['desktopStorage']
		: array();
	$can_media                  = is_user_logged_in() && current_user_can( 'upload_files' );
	$storage['canAddToMedia']   = $can_media;
	$storage['canStartPost']    = $can_media && openstation_user_can_start_post_type( 'post' );
	$storage['canStartPage']    = $can_media && openstation_user_can_start_post_type( 'page' );
	$config['desktopStorage']   = $storage;
	return $config;
}
add_filter( 'openstation_shell_config', 'openstation_stored_files_inject_media_shell_config', 21 );
