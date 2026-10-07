<?php

defined( 'ABSPATH' ) || exit;

function openstation_recycle_bin_get_items( $args = array() ) {
	$args = wp_parse_args(
		$args,
		array(
			'per_page' => 100,
			'page'     => 1,
			'type'     => '',
			'search'   => '',
		)
	);

	$type     = (string) $args['type'];
	$per_page = max( 1, (int) $args['per_page'] );

	$items_posts    = array();
	$items_comments = array();

	$files_types      = array( 'desktop', 'placement', 'shortcut', 'folder' );
	$is_files_filter  = in_array( $type, $files_types, true );
	$wants_post_types = '' === $type
		|| ( 'comment' !== $type && ! $is_files_filter );
	$wants_comments   = ( '' === $type || 'comment' === $type )
		&& openstation_recycle_bin_comments_enabled();

	if ( $wants_post_types ) {
		$post_types = openstation_recycle_bin_capture_post_types();
		if ( '' !== $type && in_array( $type, $post_types, true ) ) {
			$post_types = array( $type );
		}

		$query_args = array(
			'post_type'        => $post_types,
			'post_status'      => 'trash',
			'posts_per_page'   => $per_page,
			'paged'            => max( 1, (int) $args['page'] ),
			'orderby'          => 'modified',
			'order'            => 'DESC',
			'suppress_filters' => false,
			's'                => (string) $args['search'],
		);

		$query_args = apply_filters( 'openstation_recycle_bin_query_args', $query_args, $args );

		$query = new WP_Query( $query_args );
		foreach ( $query->posts as $post ) {
			if ( ! openstation_recycle_bin_user_can_view( $post ) ) {
				continue;
			}
			$items_posts[] = openstation_recycle_bin_shape_item( $post );
		}
	}

	if ( $wants_comments ) {
		$comment_args = array(
			'status'  => 'trash',
			'number'  => $per_page,
			'orderby' => 'comment_date_gmt',
			'order'   => 'DESC',
		);
		if ( '' !== (string) $args['search'] ) {
			$comment_args['search'] = (string) $args['search'];
		}

		$comment_args = apply_filters(
			'openstation_recycle_bin_comment_query_args',
			$comment_args,
			$args
		);

		$comments = get_comments( $comment_args );
		if ( is_array( $comments ) ) {
			foreach ( $comments as $comment ) {
				if ( ! openstation_recycle_bin_user_can_view_comment( $comment ) ) {
					continue;
				}
				$items_comments[] = openstation_recycle_bin_shape_comment_item( $comment );
			}
		}
	}

	$items_files = array();

	$wanted_files_types = array();
	switch ( $type ) {
		case '':
		case 'desktop':
			$wanted_files_types = array( 'shortcut', 'folder', 'placement' );
			break;
		case 'shortcut':
		case 'placement':
		case 'folder':
			$wanted_files_types = array( $type );
			break;
	}
	if (
		! empty( $wanted_files_types )
		&& function_exists( 'openstation_files_list_trashed_for_recycle_bin' )
	) {
		$file_items = openstation_files_list_trashed_for_recycle_bin(
			get_current_user_id()
		);
		foreach ( (array) $file_items as $item ) {
			if ( ! in_array( (string) $item['type'], $wanted_files_types, true ) ) {
				continue;
			}
			$items_files[] = $item;
		}
	}

	$items = array_merge( $items_posts, $items_comments, $items_files );

	usort(
		$items,
		static function ( $a, $b ) {
			return strcmp( (string) $b['deleted_at'], (string) $a['deleted_at'] );
		}
	);

	$total = openstation_recycle_bin_count();

	$offset = max( 0, ( max( 1, (int) $args['page'] ) - 1 ) * $per_page );
	$sliced = array_slice( $items, $offset, $per_page );

	$sliced = apply_filters( 'openstation_recycle_bin_items', $sliced, null );

	return array(
		'items' => $sliced,
		'total' => $total,
	);
}

function openstation_recycle_bin_count() {
	$post_types = openstation_recycle_bin_capture_post_types();

	$all_types = array();
	$own_types = array();
	foreach ( $post_types as $post_type ) {
		$post_type_obj = get_post_type_object( $post_type );
		if ( ! $post_type_obj ) {
			continue;
		}
		if ( ! current_user_can( $post_type_obj->cap->edit_posts ) ) {
			continue;
		}
		if ( current_user_can( $post_type_obj->cap->edit_others_posts ) ) {
			$all_types[] = $post_type;
		} else {
			$own_types[] = $post_type;
		}
	}

	$post_count = 0;
	if ( ! empty( $all_types ) ) {
		$post_query  = new WP_Query(
			array(
				'post_type'        => $all_types,
				'post_status'      => 'trash',
				'posts_per_page'   => 1,
				'fields'           => 'ids',
				'no_found_rows'    => false,
				'suppress_filters' => false,
			)
		);
		$post_count += (int) $post_query->found_posts;
	}
	if ( ! empty( $own_types ) ) {
		$own_query   = new WP_Query(
			array(
				'post_type'        => $own_types,
				'post_status'      => 'trash',
				'posts_per_page'   => 1,
				'fields'           => 'ids',
				'no_found_rows'    => false,
				'suppress_filters' => false,
				'author'           => get_current_user_id(),
			)
		);
		$post_count += (int) $own_query->found_posts;
	}

	$comment_count = 0;
	if ( openstation_recycle_bin_comments_enabled() ) {
		$comment_count = (int) get_comments(
			array(
				'status' => 'trash',
				'count'  => true,
			)
		);
	}

	$files_count = 0;
	if ( function_exists( 'openstation_files_count_trashed_for_recycle_bin' ) ) {
		$files_count = (int) openstation_files_count_trashed_for_recycle_bin( get_current_user_id() );
	}

	$total = $post_count + $comment_count + $files_count;

	return (int) apply_filters( 'openstation_recycle_bin_count', $total, $post_count, $comment_count, $files_count );
}

function openstation_recycle_bin_comments_enabled() {
	$on = current_user_can( 'moderate_comments' );

	return (bool) apply_filters( 'openstation_recycle_bin_comments_enabled', $on );
}

function openstation_recycle_bin_user_can_view( $post ) {
	$can = current_user_can( 'edit_post', $post->ID );

	return (bool) apply_filters( 'openstation_recycle_bin_user_can_view', $can, $post );
}

function openstation_recycle_bin_user_can_restore( $post ) {
	$can = current_user_can( 'delete_post', $post->ID );

	return (bool) apply_filters( 'openstation_recycle_bin_user_can_restore', $can, $post );
}

function openstation_recycle_bin_user_can_purge( $post ) {
	$can = current_user_can( 'delete_post', $post->ID );

	return (bool) apply_filters( 'openstation_recycle_bin_user_can_purge', $can, $post );
}

function openstation_recycle_bin_user_can_view_comment( $comment ) {
	$can = current_user_can( 'edit_comment', $comment->comment_ID );

	return (bool) apply_filters( 'openstation_recycle_bin_user_can_view_comment', $can, $comment );
}

function openstation_recycle_bin_user_can_restore_comment( $comment ) {
	$can = current_user_can( 'edit_comment', $comment->comment_ID );

	return (bool) apply_filters( 'openstation_recycle_bin_user_can_restore_comment', $can, $comment );
}

function openstation_recycle_bin_user_can_purge_comment( $comment ) {
	$can = current_user_can( 'edit_comment', $comment->comment_ID );

	return (bool) apply_filters( 'openstation_recycle_bin_user_can_purge_comment', $can, $comment );
}

function openstation_recycle_bin_shape_comment_item( $comment ) {
	$user_id    = (int) get_comment_meta( $comment->comment_ID, '_desktop_mode_trash_user_id', true );
	$deleted_at = (string) get_comment_meta( $comment->comment_ID, '_desktop_mode_trash_time_gmt', true );

	if ( '' === $deleted_at ) {
		$deleted_at = (string) $comment->comment_date_gmt;
	}

	$parent      = $comment->comment_post_ID ? get_post( (int) $comment->comment_post_ID ) : null;
	$parent_text = $parent ? openstation_recycle_bin_plain_text( get_the_title( $parent ) ) : '';
	$author      = $comment->comment_author
		? (string) $comment->comment_author
		: __( 'Anonymous', 'desktop-mode' );

	$title = '' !== $parent_text
		? sprintf(

			__( '%1$s on %2$s', 'desktop-mode' ),
			$author,
			$parent_text
		)
		: $author;

	$subtitle = openstation_recycle_bin_excerpt( (string) $comment->comment_content );

	$user      = $user_id ? get_userdata( $user_id ) : false;
	$user_name = $user ? $user->display_name : '';

	$item = array(
		'id'            => (int) $comment->comment_ID,
		'type'          => 'comment',
		'type_label'    => __( 'Comment', 'desktop-mode' ),
		'title'         => $title,
		'subtitle'      => $subtitle,
		'mime'          => '',
		'preview'       => '',
		'icon'          => 'dashicons-admin-comments',
		'deleted_at'    => $deleted_at,
		'deleted_by'    => $user_name,
		'deleted_by_id' => $user_id,
		'can_restore'   => openstation_recycle_bin_user_can_restore_comment( $comment ),
		'can_purge'     => openstation_recycle_bin_user_can_purge_comment( $comment ),
		'edit_link'     => (string) get_edit_comment_link( $comment->comment_ID ),
	);

	return (array) apply_filters( 'openstation_recycle_bin_comment_item', $item, $comment );
}

function openstation_recycle_bin_plain_text( $text ) {
	return html_entity_decode(
		openstation_strip_all_tags( $text ),
		ENT_QUOTES,
		get_bloginfo( 'charset' )
	);
}

function openstation_recycle_bin_excerpt( $text ) {

	$text = str_replace( '<', "\x1A", openstation_recycle_bin_plain_text( $text ) );

	return str_replace( "\x1A", '<', wp_trim_words( $text, 18, '…' ) );
}

function openstation_recycle_bin_shape_item( $post ) {
	$user_id    = (int) get_post_meta( $post->ID, '_desktop_mode_trash_user_id', true );
	$deleted_at = (string) get_post_meta( $post->ID, '_desktop_mode_trash_time_gmt', true );

	if ( '' === $deleted_at ) {
		$deleted_at = (string) $post->post_modified_gmt;
	}

	$type     = (string) $post->post_type;
	$title    = openstation_recycle_bin_plain_text( (string) get_the_title( $post ) );
	$mime     = (string) $post->post_mime_type;
	$preview  = '';
	$icon     = '';
	$subtitle = '';

	if ( 'attachment' === $type ) {

		$thumb = wp_get_attachment_image_src( $post->ID, array( 64, 64 ), true );
		if ( is_array( $thumb ) ) {
			$preview = (string) $thumb[0];
		}
		$icon     = openstation_recycle_bin_icon_for_mime( $mime );
		$subtitle = $mime;
	} elseif ( 'post' === $type ) {
		$icon     = 'dashicons-admin-post';
		$excerpt  = (string) $post->post_excerpt;
		$subtitle = openstation_recycle_bin_excerpt( $excerpt ? $excerpt : (string) $post->post_content );
	} elseif ( 'page' === $type ) {
		$icon     = 'dashicons-admin-page';
		$subtitle = openstation_recycle_bin_excerpt( (string) $post->post_content );
	} else {

		$icon          = 'dashicons-media-default';
		$post_type_obj = get_post_type_object( $type );
		if (
			$post_type_obj
			&& is_string( $post_type_obj->menu_icon )
			&& str_starts_with( $post_type_obj->menu_icon, 'dashicons-' )
		) {
			$icon = $post_type_obj->menu_icon;
		}
		$excerpt  = (string) $post->post_excerpt;
		$subtitle = openstation_recycle_bin_excerpt( $excerpt ? $excerpt : (string) $post->post_content );
	}

	$user      = $user_id ? get_userdata( $user_id ) : false;
	$user_name = $user ? $user->display_name : '';

	if ( 'attachment' === $type ) {
		$type_label = __( 'Media', 'desktop-mode' );
	} else {
		$post_type_obj = get_post_type_object( $type );
		if ( $post_type_obj && isset( $post_type_obj->labels->singular_name ) && '' !== (string) $post_type_obj->labels->singular_name ) {
			$type_label = (string) $post_type_obj->labels->singular_name;
		} else {
			$type_label = ucwords( str_replace( array( '_', '-' ), ' ', $type ) );
		}
	}

	$item = array(
		'id'            => (int) $post->ID,
		'type'          => $type,
		'type_label'    => $type_label,
		'title'         => '' !== $title ? $title : sprintf( '#%d', $post->ID ),
		'subtitle'      => $subtitle,
		'mime'          => $mime,
		'preview'       => $preview,
		'icon'          => $icon,
		'deleted_at'    => $deleted_at,
		'deleted_by'    => $user_name,
		'deleted_by_id' => $user_id,
		'can_restore'   => openstation_recycle_bin_user_can_restore( $post ),
		'can_purge'     => openstation_recycle_bin_user_can_purge( $post ),
		'edit_link'     => (string) get_edit_post_link( $post->ID, 'raw' ),
	);

	return (array) apply_filters( 'openstation_recycle_bin_item', $item, $post );
}

function openstation_recycle_bin_icon_for_mime( $mime ) {
	if ( '' === $mime ) {
		return 'dashicons-media-default';
	}
	if ( str_starts_with( $mime, 'image/' ) ) {
		return 'dashicons-format-image';
	}
	if ( str_starts_with( $mime, 'video/' ) ) {
		return 'dashicons-format-video';
	}
	if ( str_starts_with( $mime, 'audio/' ) ) {
		return 'dashicons-format-audio';
	}
	switch ( $mime ) {
		case 'application/pdf':
			return 'dashicons-pdf';
		case 'application/zip':
		case 'application/x-zip-compressed':
		case 'application/x-tar':
		case 'application/x-rar-compressed':
			return 'dashicons-media-archive';
		case 'text/plain':
		case 'text/html':
		case 'text/csv':
			return 'dashicons-media-text';
		case 'application/msword':
		case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
			return 'dashicons-media-document';
		case 'application/vnd.ms-excel':
		case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
			return 'dashicons-media-spreadsheet';
		case 'application/json':
			return 'dashicons-media-code';
	}
	return 'dashicons-media-default';
}

function openstation_recycle_bin_restore( $id, $type = '' ) {
	$id = (int) $id;
	if ( 'comment' === $type ) {
		return openstation_recycle_bin_restore_comment( $id );
	}
	if ( ( 'placement' === $type || 'shortcut' === $type ) && function_exists( 'openstation_files_restore_placement' ) ) {
		return openstation_files_restore_placement( get_current_user_id(), $id );
	}
	if ( 'folder' === $type && function_exists( 'openstation_files_restore_folder' ) ) {
		return openstation_files_restore_folder( get_current_user_id(), $id );
	}

	$post = get_post( $id );
	if ( ! $post ) {
		return new WP_Error( 'openstation_recycle_bin_not_found', __( 'Item not found.', 'desktop-mode' ), array( 'status' => 404 ) );
	}
	if ( 'trash' !== $post->post_status ) {
		return new WP_Error( 'openstation_recycle_bin_not_trashed', __( 'Item is not in the trash.', 'desktop-mode' ), array( 'status' => 409 ) );
	}
	if ( ! openstation_recycle_bin_user_can_restore( $post ) ) {
		return new WP_Error( 'openstation_recycle_bin_forbidden', __( 'You are not allowed to restore this item.', 'desktop-mode' ), array( 'status' => 403 ) );
	}

	do_action( 'openstation_recycle_bin_before_restore', $id, $post );

	$ok = wp_untrash_post( $id );
	if ( ! $ok ) {
		return new WP_Error( 'openstation_recycle_bin_restore_failed', __( 'Failed to restore item.', 'desktop-mode' ), array( 'status' => 500 ) );
	}

	delete_post_meta( $id, '_desktop_mode_trash_user_id' );
	delete_post_meta( $id, '_desktop_mode_trash_time_gmt' );

	do_action( 'openstation_recycle_bin_after_restore', $id );

	return true;
}

function openstation_recycle_bin_restore_comment( $comment_id ) {
	$comment_id = (int) $comment_id;
	$comment    = get_comment( $comment_id );

	if ( ! $comment ) {
		return new WP_Error( 'openstation_recycle_bin_not_found', __( 'Comment not found.', 'desktop-mode' ), array( 'status' => 404 ) );
	}
	if ( 'trash' !== $comment->comment_approved ) {
		return new WP_Error( 'openstation_recycle_bin_not_trashed', __( 'Comment is not in the trash.', 'desktop-mode' ), array( 'status' => 409 ) );
	}
	if ( ! openstation_recycle_bin_user_can_restore_comment( $comment ) ) {
		return new WP_Error( 'openstation_recycle_bin_forbidden', __( 'You are not allowed to restore this comment.', 'desktop-mode' ), array( 'status' => 403 ) );
	}

	do_action( 'openstation_recycle_bin_before_restore_comment', $comment_id, $comment );

	$ok = wp_untrash_comment( $comment_id );
	if ( ! $ok ) {
		return new WP_Error( 'openstation_recycle_bin_restore_failed', __( 'Failed to restore comment.', 'desktop-mode' ), array( 'status' => 500 ) );
	}

	delete_comment_meta( $comment_id, '_desktop_mode_trash_user_id' );
	delete_comment_meta( $comment_id, '_desktop_mode_trash_time_gmt' );

	do_action( 'openstation_recycle_bin_after_restore_comment', $comment_id );

	return true;
}

function openstation_recycle_bin_purge( $id, $type = '' ) {
	$id = (int) $id;
	if ( 'comment' === $type ) {
		return openstation_recycle_bin_purge_comment( $id );
	}
	if ( ( 'placement' === $type || 'shortcut' === $type ) && function_exists( 'openstation_files_purge_placement' ) ) {
		return openstation_files_purge_placement( get_current_user_id(), $id );
	}
	if ( 'folder' === $type && function_exists( 'openstation_files_purge_folder' ) ) {
		return openstation_files_purge_folder( get_current_user_id(), $id );
	}

	$post = get_post( $id );
	if ( ! $post ) {
		return new WP_Error( 'openstation_recycle_bin_not_found', __( 'Item not found.', 'desktop-mode' ), array( 'status' => 404 ) );
	}
	if ( 'trash' !== $post->post_status ) {
		return new WP_Error( 'openstation_recycle_bin_not_trashed', __( 'Item is not in the trash.', 'desktop-mode' ), array( 'status' => 409 ) );
	}
	if ( ! openstation_recycle_bin_user_can_purge( $post ) ) {
		return new WP_Error( 'openstation_recycle_bin_forbidden', __( 'You are not allowed to permanently delete this item.', 'desktop-mode' ), array( 'status' => 403 ) );
	}

	do_action( 'openstation_recycle_bin_before_purge', $id, $post );

	if ( 'attachment' === $post->post_type ) {

		$result = wp_delete_attachment( $id, true );
	} else {
		$result = wp_delete_post( $id, true );
	}

	if ( ! $result ) {
		return new WP_Error( 'openstation_recycle_bin_purge_failed', __( 'Failed to permanently delete item.', 'desktop-mode' ), array( 'status' => 500 ) );
	}

	do_action( 'openstation_recycle_bin_after_purge', $id, $post->post_type );

	return true;
}

function openstation_recycle_bin_purge_comment( $comment_id ) {
	$comment_id = (int) $comment_id;
	$comment    = get_comment( $comment_id );

	if ( ! $comment ) {
		return new WP_Error( 'openstation_recycle_bin_not_found', __( 'Comment not found.', 'desktop-mode' ), array( 'status' => 404 ) );
	}
	if ( 'trash' !== $comment->comment_approved ) {
		return new WP_Error( 'openstation_recycle_bin_not_trashed', __( 'Comment is not in the trash.', 'desktop-mode' ), array( 'status' => 409 ) );
	}
	if ( ! openstation_recycle_bin_user_can_purge_comment( $comment ) ) {
		return new WP_Error( 'openstation_recycle_bin_forbidden', __( 'You are not allowed to permanently delete this comment.', 'desktop-mode' ), array( 'status' => 403 ) );
	}

	do_action( 'openstation_recycle_bin_before_purge_comment', $comment_id, $comment );

	$result = wp_delete_comment( $comment_id, true );

	if ( ! $result ) {
		return new WP_Error( 'openstation_recycle_bin_purge_failed', __( 'Failed to permanently delete comment.', 'desktop-mode' ), array( 'status' => 500 ) );
	}

	do_action( 'openstation_recycle_bin_after_purge_comment', $comment_id );

	return true;
}

function openstation_recycle_bin_empty() {
	$purged  = 0;
	$skipped = 0;

	$chunk_size = (int) apply_filters( 'openstation_recycle_bin_empty_chunk_size', 200 );
	if ( $chunk_size < 1 ) {
		$chunk_size = 1;
	}

	$batch = openstation_recycle_bin_get_items(
		array(
			'per_page' => $chunk_size,
			'page'     => 1,
		)
	);
	foreach ( $batch['items'] as $item ) {
		$result = openstation_recycle_bin_purge(
			(int) $item['id'],
			(string) ( $item['type'] ?? '' )
		);
		if ( is_wp_error( $result ) ) {
			++$skipped;
		} else {
			++$purged;
		}
	}

	do_action( 'openstation_recycle_bin_emptied', $purged, $skipped );

	return array(
		'purged'    => $purged,
		'skipped'   => $skipped,
		'remaining' => max( 0, $batch['total'] - $purged ),
	);
}
