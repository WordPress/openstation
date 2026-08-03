<?php
/**
 * OpenStation — Recycle Bin: store.
 *
 * Read/restore/purge primitives that the REST layer wraps. Backed
 * entirely by core post-table state — no custom tables, no options
 * blob. "Trashed" items are exactly the rows with
 * `post_status = 'trash'` for the post types the bin tracks.
 *
 * Every read goes through `openstation_recycle_bin_query_args` so
 * plugins can scope the bin (e.g. show only the current user's
 * trash, or filter by author/role for compliance use cases).
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Returns the list of trashed items the current user is allowed to
 * see, shaped for the table component.
 *
 * @param array $args {
 *     Optional. Query overrides.
 *
 *     @type int    $per_page Default 100.
 *     @type int    $page     Default 1.
 *     @type string $type     One of '', 'post', 'page', 'attachment'.
 *     @type string $search   Free-text search over post_title.
 * }
 * @return array {
 *     @type array $items List of items shaped for the JS layer.
 *     @type int   $total Total matching rows (across pages).
 * }
 */
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

	// Two trash sources: posts (incl. pages and attachments) and
	// comments. Each is fetched independently then merged + sorted
	// by deleted-at desc — that way the bin reads as one chronological
	// timeline regardless of which entity was trashed.
	$items_posts    = array();
	$items_comments = array();

	// Source gates: each `$type` filter narrows down to the
	// owning store. `''` (All) loads every source. The files-on-
	// desktop sources (`shortcut` / `placement` / `folder`) live in
	// `openstation_files_list_trashed_for_recycle_bin` — never run
	// the WP-core post / comment queries when one of those is the
	// active filter, otherwise trashed posts leak into the
	// "Shortcuts" / "Folders" tabs.
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

		/**
		 * Filter the WP_Query args used to populate the recycle bin.
		 *
		 * @param array $query_args Args passed to WP_Query.
		 * @param array $args       Caller-provided args.
		 */
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

		/**
		 * Filter the `WP_Comment_Query` args used to populate the
		 * recycle bin's comments. Mirror of
		 * `openstation_recycle_bin_query_args` for comments.
		 *
		 * @param array $comment_args Args passed to `get_comments()`.
		 * @param array $args         Caller-provided args.
		 */
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

	// Files-on-the-Desktop trash — soft-trashed placements
	// (shortcuts) and folders. Returned in the same item shape so
	// the JS layer treats them uniformly. The `placement` and
	// `folder` types route to the desktop-files trash module on
	// restore / purge (see `openstation_recycle_bin_handle_files_*`).
	$items_files = array();
	// Map UI filter → set of `type` values to keep from the
	// files-on-desktop helper. The "Shortcuts" segment in the bin
	// UI now covers both registered icons (`shortcut`) AND user
	// folders (`folder`) — restore + purge dispatch still routes
	// each row by its individual type, so the merge is purely
	// visual.
	// "Desktop" is the unified bucket — every files-on-the-desktop
	// trash row regardless of internal type (shortcut / folder /
	// placement). Per-row dispatch on restore + purge still uses
	// the row's distinct `type` so the merge is purely visual.
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

	// Sort the merged list chronologically by deleted_at desc. The
	// shape always carries a sortable string in `deleted_at`, so a
	// straight string compare is enough (`Y-m-d H:i:s` is sortable
	// lexicographically).
	usort( $items, static function ( $a, $b ) {
		return strcmp( (string) $b['deleted_at'], (string) $a['deleted_at'] );
	} );

	// `total` reports the GLOBAL trash count (every type, every
	// row, ignoring the current filter / search). The dock-tile
	// + desktop-icon badge consume this directly — `setRecycleBinBadge`
	// only cares about "how many things are sitting in the bin
	// right now". A future paginated UI that needs a filtered
	// count can compute it from `count( $items )` itself.
	$total = openstation_recycle_bin_count();

	$offset = max( 0, ( max( 1, (int) $args['page'] ) - 1 ) * $per_page );
	$sliced = array_slice( $items, $offset, $per_page );

	/**
	 * Filter the final list of items returned to the JS layer.
	 *
	 * @param array      $items Shaped list (id, title, type, deleted_at, …).
	 * @param array|null $query Underlying post query, or null for the
	 *                          merged post+comment shape.
	 */
	$sliced = apply_filters( 'openstation_recycle_bin_items', $sliced, null );

	return array(
		'items' => $sliced,
		'total' => $total,
	);
}

/**
 * Total number of items in the recycle bin, summed across every
 * tracked source (post types + comments).
 *
 * Cheaper than `openstation_recycle_bin_get_items()` because it never
 * loads the row data — just the COUNT(*) under the hood. Used by
 * the badge on the dock tile + desktop icon, and by the REST
 * `/count` endpoint subscribers refresh on broadcasts.
 *
 * The post component mirrors the per-item `edit_post` gate the list
 * applies, at the aggregate level: tracked types the user cannot edit
 * at all contribute zero, and types where the user can only edit their
 * own posts are counted author-scoped — so the badge never discloses
 * the global trash total to low-capability users.
 *
 * @return int
 */
function openstation_recycle_bin_count() {
	$post_types = openstation_recycle_bin_capture_post_types();

	// Bucket the tracked types by what the current user may edit:
	// full count when they hold the type's `edit_others_posts`,
	// author-scoped count when they only hold `edit_posts`, nothing
	// otherwise. At most two cheap COUNT(*) queries.
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

	/**
	 * Filter the total count surfaced to the badge.
	 *
	 * @param int $total         Default sum (posts + comments + files visible to the user).
	 * @param int $post_count    Items in trash from the post-type query, capability-scoped
	 *                           to what the current user can edit.
	 * @param int $comment_count Items in trash from the comment query.
	 * @param int $files_count   Items in trash from the desktop-files trash.
	 */
	return (int) apply_filters( 'openstation_recycle_bin_count', $total, $post_count, $comment_count, $files_count );
}

/**
 * Whether comments are part of the bin. Filterable so installs
 * that don't moderate comments at all (read-only blogs, headless
 * setups) can hide the segment without touching the JS.
 *
 * @return bool
 */
function openstation_recycle_bin_comments_enabled() {
	$on = current_user_can( 'moderate_comments' );

	/**
	 * Filter whether the recycle bin tracks comments.
	 *
	 * @param bool $on Default: current user has `moderate_comments`.
	 */
	return (bool) apply_filters( 'openstation_recycle_bin_comments_enabled', $on );
}

/**
 * Whether the current user can see a given trashed item.
 *
 * Mirrors `current_user_can( 'edit_post', $id )` for the consistent
 * "if you can edit it, you can manage its trash" rule. Filterable for
 * stricter / looser policies.
 *
 * @param WP_Post $post Trashed post.
 * @return bool
 */
function openstation_recycle_bin_user_can_view( $post ) {
	$can = current_user_can( 'edit_post', $post->ID );

	/**
	 * Filter whether the current user can see a given trashed item.
	 *
	 * @param bool    $can  Default: edit_post capability check.
	 * @param WP_Post $post Trashed post.
	 */
	return (bool) apply_filters( 'openstation_recycle_bin_user_can_view', $can, $post );
}

/**
 * Whether the current user can restore a given trashed item.
 *
 * @param WP_Post $post Trashed post.
 * @return bool
 */
function openstation_recycle_bin_user_can_restore( $post ) {
	$can = current_user_can( 'delete_post', $post->ID );

	/**
	 * Filter whether the current user can restore a given trashed item.
	 *
	 * @param bool    $can  Default: delete_post capability check (the same
	 *                      gate WP itself uses for trash/untrash).
	 * @param WP_Post $post Trashed post.
	 */
	return (bool) apply_filters( 'openstation_recycle_bin_user_can_restore', $can, $post );
}

/**
 * Whether the current user can permanently delete a trashed item.
 *
 * @param WP_Post $post Trashed post.
 * @return bool
 */
function openstation_recycle_bin_user_can_purge( $post ) {
	$can = current_user_can( 'delete_post', $post->ID );

	/**
	 * Filter whether the current user can permanently delete a trashed item.
	 *
	 * @param bool    $can  Default: delete_post capability check.
	 * @param WP_Post $post Trashed post.
	 */
	return (bool) apply_filters( 'openstation_recycle_bin_user_can_purge', $can, $post );
}

/**
 * Capability gates for trashed comments. Mirror of the post gates,
 * with `edit_comment`/`moderate_comments` as the WP-native checks.
 *
 * @param WP_Comment $comment Trashed comment.
 * @return bool
 */
function openstation_recycle_bin_user_can_view_comment( $comment ) {
	$can = current_user_can( 'edit_comment', $comment->comment_ID );

	/**
	 * @param bool       $can     Default: edit_comment capability check.
	 * @param WP_Comment $comment Trashed comment.
	 */
	return (bool) apply_filters( 'openstation_recycle_bin_user_can_view_comment', $can, $comment );
}

/**
 * @param WP_Comment $comment Trashed comment.
 * @return bool
 */
function openstation_recycle_bin_user_can_restore_comment( $comment ) {
	$can = current_user_can( 'edit_comment', $comment->comment_ID );

	/**
	 * @param bool       $can     Default: edit_comment capability check.
	 * @param WP_Comment $comment Trashed comment.
	 */
	return (bool) apply_filters( 'openstation_recycle_bin_user_can_restore_comment', $can, $comment );
}

/**
 * @param WP_Comment $comment Trashed comment.
 * @return bool
 */
function openstation_recycle_bin_user_can_purge_comment( $comment ) {
	$can = current_user_can( 'edit_comment', $comment->comment_ID );

	/**
	 * @param bool       $can     Default: edit_comment capability check.
	 * @param WP_Comment $comment Trashed comment.
	 */
	return (bool) apply_filters( 'openstation_recycle_bin_user_can_purge_comment', $can, $comment );
}

/**
 * Shape a `WP_Comment` into the JSON the JS table consumes.
 *
 * Same field set as the post shape so the React-style table doesn't
 * have to special-case the row by `type`. The `title` reads as
 * "<author> on <post title>"; the `subtitle` carries a 100-char
 * excerpt of `comment_content`.
 *
 * @param WP_Comment $comment Trashed comment.
 * @return array
 */
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
			/* translators: 1: comment author. 2: parent post title. */
			__( '%1$s on %2$s', 'desktop-mode' ),
			$author,
			$parent_text
		)
		: $author;

	$subtitle = wp_trim_words( openstation_recycle_bin_plain_text( (string) $comment->comment_content ), 18, '…' );

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

	/**
	 * Filter the comment item shape.
	 *
	 * @param array      $item    Item shape.
	 * @param WP_Comment $comment Source comment.
	 */
	return (array) apply_filters( 'openstation_recycle_bin_comment_item', $item, $comment );
}

/**
 * Collapse a title/subtitle to plain text for the wire.
 *
 * `get_the_title()` runs the `the_title` filter chain, and
 * `wptexturize` in it encodes punctuation as numeric entities
 * (apostrophe → `&#8217;`, quotes, dashes) — correct for HTML
 * output, wrong for the bin table, which renders every cell via
 * `textContent` and would show the literal entity. Strip tags first,
 * then decode entities back to characters.
 *
 * @param string $text Raw filtered text.
 * @return string
 */
function openstation_recycle_bin_plain_text( $text ) {
	return html_entity_decode(
		wp_strip_all_tags( (string) $text ),
		ENT_QUOTES,
		get_bloginfo( 'charset' )
	);
}

/**
 * Shape one WP_Post into the JSON the JS table consumes.
 *
 * @param WP_Post $post Trashed post.
 * @return array
 */
function openstation_recycle_bin_shape_item( $post ) {
	$user_id    = (int) get_post_meta( $post->ID, '_desktop_mode_trash_user_id', true );
	$deleted_at = (string) get_post_meta( $post->ID, '_desktop_mode_trash_time_gmt', true );

	// Fall back to post_modified_gmt — set when wp_trash_post runs and
	// reasonable for items captured before the recycle bin existed.
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
		// Use the medium thumbnail when available, else core's default
		// "broken image" placeholder. `wp_get_attachment_image_src()`
		// returns false when the file is gone, so we always coerce.
		$thumb = wp_get_attachment_image_src( $post->ID, array( 64, 64 ), true );
		if ( is_array( $thumb ) ) {
			$preview = (string) $thumb[0];
		}
		$icon     = openstation_recycle_bin_icon_for_mime( $mime );
		$subtitle = $mime;
	} elseif ( 'post' === $type ) {
		$icon     = 'dashicons-admin-post';
		$subtitle = wp_trim_words( openstation_recycle_bin_plain_text( (string) $post->post_excerpt ?: (string) $post->post_content ), 18, '…' );
	} elseif ( 'page' === $type ) {
		$icon     = 'dashicons-admin-page';
		$subtitle = wp_trim_words( openstation_recycle_bin_plain_text( (string) $post->post_content ), 18, '…' );
	} else {
		// Custom post types: reuse the type's own menu Dashicon when it
		// registered one, so a trashed product row reads as a product
		// instead of a generic file. Content excerpt as the subtitle,
		// same as posts.
		$icon          = 'dashicons-media-default';
		$post_type_obj = get_post_type_object( $type );
		if (
			$post_type_obj
			&& is_string( $post_type_obj->menu_icon )
			&& str_starts_with( $post_type_obj->menu_icon, 'dashicons-' )
		) {
			$icon = $post_type_obj->menu_icon;
		}
		$subtitle = wp_trim_words( openstation_recycle_bin_plain_text( (string) $post->post_excerpt ?: (string) $post->post_content ), 18, '…' );
	}

	$user      = $user_id ? get_userdata( $user_id ) : false;
	$user_name = $user ? $user->display_name : '';

	// Resolve a human label for the type badge. `attachment` collapses
	// to "Media" to match the toolbar filter; every other registered
	// post type uses its singular label so CPTs read correctly (e.g.
	// "Product" for WooCommerce). Unknown types fall back to a
	// title-cased slug.
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

	/**
	 * Filter the item shape for the recycle bin table.
	 *
	 * Add custom columns or override the icon/preview for a custom
	 * post type. The id/type/deleted_at trio is load-bearing — keep
	 * them in the returned array.
	 *
	 * @param array   $item Item shape.
	 * @param WP_Post $post Source post.
	 */
	return (array) apply_filters( 'openstation_recycle_bin_item', $item, $post );
}

/**
 * Map a mime type to a Dashicon for the type cell.
 *
 * @param string $mime Mime type.
 * @return string Dashicon class.
 */
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

/**
 * Restore a single trashed item.
 *
 * Dispatches by `type`: comments go through `wp_untrash_comment`,
 * everything else through `wp_untrash_post`. The legacy single-arg
 * call (id only) defaults to `'post'` so older clients that haven't
 * migrated to the typed API keep working.
 *
 * @param int    $id   Post id (or comment id when `$type === 'comment'`).
 * @param string $type Entity type — '', 'post', 'page', 'attachment', or 'comment'.
 * @return true|WP_Error
 */
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

	/**
	 * Fires before a recycle-bin item is restored.
	 *
	 * @param int     $id   Post id about to be restored.
	 * @param WP_Post $post Trashed post object.
	 */
	do_action( 'openstation_recycle_bin_before_restore', $id, $post );

	$ok = wp_untrash_post( $id );
	if ( ! $ok ) {
		return new WP_Error( 'openstation_recycle_bin_restore_failed', __( 'Failed to restore item.', 'desktop-mode' ), array( 'status' => 500 ) );
	}

	delete_post_meta( $id, '_desktop_mode_trash_user_id' );
	delete_post_meta( $id, '_desktop_mode_trash_time_gmt' );

	/**
	 * Fires after a recycle-bin item is restored.
	 *
	 * @param int $id Post id that was restored.
	 */
	do_action( 'openstation_recycle_bin_after_restore', $id );

	return true;
}

/**
 * Restore a single trashed comment.
 *
 * @param int $comment_id Comment id.
 * @return true|WP_Error
 */
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

	/**
	 * Fires before a comment is restored from the recycle bin.
	 *
	 * @param int        $comment_id Comment id.
	 * @param WP_Comment $comment    Trashed comment.
	 */
	do_action( 'openstation_recycle_bin_before_restore_comment', $comment_id, $comment );

	$ok = wp_untrash_comment( $comment_id );
	if ( ! $ok ) {
		return new WP_Error( 'openstation_recycle_bin_restore_failed', __( 'Failed to restore comment.', 'desktop-mode' ), array( 'status' => 500 ) );
	}

	delete_comment_meta( $comment_id, '_desktop_mode_trash_user_id' );
	delete_comment_meta( $comment_id, '_desktop_mode_trash_time_gmt' );

	/**
	 * Fires after a comment is restored from the recycle bin.
	 *
	 * @param int $comment_id Comment id.
	 */
	do_action( 'openstation_recycle_bin_after_restore_comment', $comment_id );

	return true;
}

/**
 * Permanently delete a single trashed item. Dispatches by `$type`.
 *
 * @param int    $id   Post id (or comment id when `$type === 'comment'`).
 * @param string $type Entity type — '', 'post', 'page', 'attachment', or 'comment'.
 * @return true|WP_Error
 */
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

	/**
	 * Fires before a recycle-bin item is permanently deleted.
	 *
	 * @param int     $id   Post id about to be deleted.
	 * @param WP_Post $post Trashed post object.
	 */
	do_action( 'openstation_recycle_bin_before_purge', $id, $post );

	if ( 'attachment' === $post->post_type ) {
		// Force-delete (`true`) removes the attachment and its file
		// permanently. (The item is already trashed, so even with
		// MEDIA_TRASH enabled core would not re-route it to trash;
		// `true` simply makes the purge intent explicit.)
		$result = wp_delete_attachment( $id, true );
	} else {
		$result = wp_delete_post( $id, true );
	}

	if ( ! $result ) {
		return new WP_Error( 'openstation_recycle_bin_purge_failed', __( 'Failed to permanently delete item.', 'desktop-mode' ), array( 'status' => 500 ) );
	}

	/**
	 * Fires after a recycle-bin item is permanently deleted.
	 *
	 * @param int    $id   Post id that was purged.
	 * @param string $type Post type of the purged item.
	 */
	do_action( 'openstation_recycle_bin_after_purge', $id, $post->post_type );

	return true;
}

/**
 * Permanently delete a single trashed comment.
 *
 * @param int $comment_id Comment id.
 * @return true|WP_Error
 */
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

	/**
	 * Fires before a comment is permanently deleted via the bin.
	 *
	 * @param int        $comment_id Comment id.
	 * @param WP_Comment $comment    Trashed comment.
	 */
	do_action( 'openstation_recycle_bin_before_purge_comment', $comment_id, $comment );

	$result = wp_delete_comment( $comment_id, true );

	if ( ! $result ) {
		return new WP_Error( 'openstation_recycle_bin_purge_failed', __( 'Failed to permanently delete comment.', 'desktop-mode' ), array( 'status' => 500 ) );
	}

	/**
	 * Fires after a comment is permanently deleted via the bin.
	 *
	 * @param int $comment_id Comment id.
	 */
	do_action( 'openstation_recycle_bin_after_purge_comment', $comment_id );

	return true;
}

/**
 * Empty the recycle bin for the current user.
 *
 * Honors the same capability gate as a single purge — items the user
 * can't permanently delete are skipped (not silently dropped).
 *
 * Processes at most one chunk per call. The cap protects against PHP
 * timeouts on large bins; the client iterates while `remaining > 0`
 * (and bails when `remaining === skipped`, i.e. nothing the user can
 * purge is left). Site owners with longer execution budgets can tune
 * the chunk size via the `openstation_recycle_bin_empty_chunk_size`
 * filter.
 *
 * @return array {
 *     @type int $purged    Items successfully purged in this call.
 *     @type int $skipped   Items skipped (capability or error).
 *     @type int $remaining Items still in the bin after this call (across pages).
 * }
 */
function openstation_recycle_bin_empty() {
	$purged  = 0;
	$skipped = 0;

	/**
	 * Filter the per-call chunk size for the empty-bin loop.
	 *
	 * `openstation_recycle_bin_empty()` only purges this many items
	 * per invocation. The client iterates while `remaining > 0`. The
	 * default (200) is conservative for shared hosts; sites with
	 * generous PHP execution limits can raise it to make emptying a
	 * large bin take fewer roundtrips.
	 *
	 * @param int $chunk_size Items processed per call. Default 200.
	 */
	$chunk_size = (int) apply_filters( 'openstation_recycle_bin_empty_chunk_size', 200 );
	if ( $chunk_size < 1 ) {
		$chunk_size = 1;
	}

	// Loop in chunks — `wp_delete_post()` is cheap individually but
	// hammering it on a 10k-item bin without yielding back to PHP can
	// still time out. The client re-invokes us until `remaining` hits
	// zero (or stalls at `skipped`).
	$batch = openstation_recycle_bin_get_items( array( 'per_page' => $chunk_size, 'page' => 1 ) );
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

	/**
	 * Fires after the recycle bin is emptied.
	 *
	 * @param int $purged  Items successfully purged in this call.
	 * @param int $skipped Items skipped (capability or error).
	 */
	do_action( 'openstation_recycle_bin_emptied', $purged, $skipped );

	return array(
		'purged'    => $purged,
		'skipped'   => $skipped,
		'remaining' => max( 0, $batch['total'] - $purged ),
	);
}
