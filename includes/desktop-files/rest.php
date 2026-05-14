<?php
/**
 * Desktop Mode — Files REST routes.
 *
 * Routes under `/desktop-mode/v1/files`:
 *
 *   GET    /placements?folder=<id>     List the viewer's placements
 *                                       under `<id>` (0 for desktop root).
 *   POST   /placements                 Create a placement.
 *   PATCH  /placements/(?P<id>\d+)     Move / update a placement.
 *   DELETE /placements/(?P<id>\d+)     Remove a placement.
 *
 *   GET    /folders                    List folders visible to the viewer.
 *   POST   /folders                    Create a folder.
 *   PATCH  /folders/(?P<id>\d+)        Update a folder.
 *   DELETE /folders/(?P<id>\d+)        Delete a folder.
 *
 *   PUT    /associations               Replace the viewer's full
 *                                       `{ type => opener_id }` map.
 *
 * Permission: every route requires a logged-in user with desktop
 * mode enabled. Per-row gating happens inside the store.
 *
 * @package WPDesktopMode
 * @since   0.9.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * @since 0.9.0
 */
function desktop_mode_files_rest_permission() {
	if ( ! is_user_logged_in() ) {
		return new WP_Error( 'desktop_mode_files_unauthenticated', __( 'You must be logged in.', 'desktop-mode' ), array( 'status' => 401 ) );
	}
	if ( function_exists( 'desktop_mode_is_enabled' ) && ! desktop_mode_is_enabled( get_current_user_id() ) ) {
		return new WP_Error( 'desktop_mode_files_disabled', __( 'Desktop mode is not enabled for this user.', 'desktop-mode' ), array( 'status' => 403 ) );
	}
	return true;
}

/**
 * Register the routes.
 *
 * @since 0.9.0
 */
function desktop_mode_files_register_rest_routes() {
	$ns = 'desktop-mode/v1';

	register_rest_route( $ns, '/files/placements', array(
		array(
			'methods'             => WP_REST_Server::READABLE,
			'permission_callback' => 'desktop_mode_files_rest_permission',
			'callback'            => 'desktop_mode_files_rest_list_placements',
			'args'                => array(
				'folder' => array( 'type' => 'integer', 'default' => 0, 'sanitize_callback' => 'absint' ),
			),
		),
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'permission_callback' => 'desktop_mode_files_rest_permission',
			'callback'            => 'desktop_mode_files_rest_create_placement',
			'args'                => array(
				'parentId'  => array( 'type' => 'integer', 'default' => 0 ),
				'type'      => array( 'type' => 'string', 'required' => true ),
				'ref'       => array( 'type' => 'string', 'required' => true ),
				'x'         => array( 'type' => 'integer', 'default' => 0 ),
				'y'         => array( 'type' => 'integer', 'default' => 0 ),
				'sortOrder' => array( 'type' => 'integer', 'default' => 0 ),
				'meta'      => array( 'type' => 'object', 'required' => false ),
			),
		),
	) );

	register_rest_route( $ns, '/files/placements/(?P<id>\d+)', array(
		array(
			'methods'             => WP_REST_Server::EDITABLE,
			'permission_callback' => 'desktop_mode_files_rest_permission',
			'callback'            => 'desktop_mode_files_rest_update_placement',
		),
		array(
			'methods'             => WP_REST_Server::DELETABLE,
			'permission_callback' => 'desktop_mode_files_rest_permission',
			'callback'            => 'desktop_mode_files_rest_delete_placement',
		),
	) );

	register_rest_route( $ns, '/files/folders', array(
		array(
			'methods'             => WP_REST_Server::READABLE,
			'permission_callback' => 'desktop_mode_files_rest_permission',
			'callback'            => 'desktop_mode_files_rest_list_folders',
		),
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'permission_callback' => 'desktop_mode_files_rest_permission',
			'callback'            => 'desktop_mode_files_rest_create_folder',
			'args'                => array(
				'name'       => array( 'type' => 'string', 'required' => true ),
				'shareMode'  => array( 'type' => 'string', 'default' => 'private' ),
				'shareMeta'  => array( 'type' => 'object', 'required' => false ),
			),
		),
	) );

	register_rest_route( $ns, '/files/folders/(?P<id>\d+)', array(
		array(
			'methods'             => WP_REST_Server::EDITABLE,
			'permission_callback' => 'desktop_mode_files_rest_permission',
			'callback'            => 'desktop_mode_files_rest_update_folder',
		),
		array(
			'methods'             => WP_REST_Server::DELETABLE,
			'permission_callback' => 'desktop_mode_files_rest_permission',
			'callback'            => 'desktop_mode_files_rest_delete_folder',
		),
	) );

	register_rest_route( $ns, '/files/associations', array(
		'methods'             => 'PUT',
		'permission_callback' => 'desktop_mode_files_rest_permission',
		'callback'            => 'desktop_mode_files_rest_save_associations',
		'args'                => array(
			'associations' => array( 'type' => 'object', 'required' => true ),
		),
	) );

	register_rest_route( $ns, '/files/folders/(?P<id>\d+)/shares', array(
		array(
			'methods'             => WP_REST_Server::READABLE,
			'permission_callback' => 'desktop_mode_files_rest_permission',
			'callback'            => 'desktop_mode_files_rest_list_shares',
		),
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'permission_callback' => 'desktop_mode_files_rest_permission',
			'callback'            => 'desktop_mode_files_rest_create_share',
			'args'                => array(
				'principalType' => array( 'type' => 'string', 'required' => true ),
				'principalRef'  => array( 'type' => 'string', 'required' => true ),
				'capability'    => array( 'type' => 'string', 'default'  => 'read' ),
			),
		),
	) );

	register_rest_route( $ns, '/files/folders/(?P<id>\d+)/shares/(?P<shareId>\d+)', array(
		array(
			'methods'             => WP_REST_Server::EDITABLE,
			'permission_callback' => 'desktop_mode_files_rest_permission',
			'callback'            => 'desktop_mode_files_rest_update_share',
			'args'                => array(
				'capability' => array( 'type' => 'string', 'required' => true ),
			),
		),
		array(
			'methods'             => WP_REST_Server::DELETABLE,
			'permission_callback' => 'desktop_mode_files_rest_permission',
			'callback'            => 'desktop_mode_files_rest_delete_share',
		),
	) );

	register_rest_route( $ns, '/files/folders/(?P<id>\d+)/shares/(?P<shareId>\d+)/accept', array(
		'methods'             => WP_REST_Server::CREATABLE,
		'permission_callback' => 'desktop_mode_files_rest_permission',
		'callback'            => 'desktop_mode_files_rest_accept_share',
	) );

	register_rest_route( $ns, '/files/folders/(?P<id>\d+)/shares/(?P<shareId>\d+)/deny', array(
		'methods'             => WP_REST_Server::CREATABLE,
		'permission_callback' => 'desktop_mode_files_rest_permission',
		'callback'            => 'desktop_mode_files_rest_deny_share',
	) );

	register_rest_route( $ns, '/files/folders/(?P<id>\d+)/leave', array(
		'methods'             => WP_REST_Server::CREATABLE,
		'permission_callback' => 'desktop_mode_files_rest_permission',
		'callback'            => 'desktop_mode_files_rest_leave_folder',
	) );

	register_rest_route( $ns, '/files/users/search', array(
		'methods'             => WP_REST_Server::READABLE,
		'permission_callback' => 'desktop_mode_files_rest_search_users_permission',
		'callback'            => 'desktop_mode_files_rest_search_users',
		'args'                => array(
			'q'       => array( 'type' => 'string', 'default' => '' ),
			'exclude' => array( 'type' => 'string', 'default' => '' ),
		),
	) );
}
add_action( 'rest_api_init', 'desktop_mode_files_register_rest_routes' );

/**
 * GET /placements
 */
function desktop_mode_files_rest_list_placements( WP_REST_Request $req ) {
	$user_id   = get_current_user_id();
	$parent_id = (int) $req->get_param( 'folder' );
	// Self-healing backfill — see
	// `desktop_mode_files_auto_place_orphan_folders` for the why.
	// Only runs at the root because that's the only context where
	// auto-placing an orphan folder as a tile is unambiguous.
	if ( 0 === $parent_id ) {
		desktop_mode_files_auto_place_orphans( $user_id );
	}
	$rows      = desktop_mode_files_get_for_user_folder( $user_id, $parent_id );
	$out       = array();
	foreach ( $rows as $row ) {
		$out[] = desktop_mode_files_shape_placement( $row );
	}
	return rest_ensure_response( array(
		'placements' => $out,
		'folderId'   => $parent_id,
	) );
}

/**
 * POST /placements
 */
function desktop_mode_files_rest_create_placement( WP_REST_Request $req ) {
	$type = (string) $req->get_param( 'type' );
	$ref  = (string) $req->get_param( 'ref' );
	$meta = $req->get_param( 'meta' );

	// `link` placements get a server-resolved favicon stuffed onto
	// `meta.iconUrl` so the tile renderer can paint it without the
	// browser making a third-party request on every render. Other
	// types skip the resolver entirely (no extra fetch latency).
	if ( 'link' === $type && '' !== $ref ) {
		$icon_data_uri = desktop_mode_resolve_favicon( $ref );
		if ( is_string( $icon_data_uri ) && '' !== $icon_data_uri ) {
			$meta_arr             = is_array( $meta ) ? $meta : array();
			$meta_arr['iconUrl']  = $icon_data_uri;
			$meta                 = $meta_arr;
		}
	}

	$id = desktop_mode_files_place(
		get_current_user_id(),
		(int) $req->get_param( 'parentId' ),
		$type,
		$ref,
		array(
			'x'          => (int) $req->get_param( 'x' ),
			'y'          => (int) $req->get_param( 'y' ),
			'sort_order' => (int) $req->get_param( 'sortOrder' ),
			'meta'       => $meta,
		)
	);
	if ( is_wp_error( $id ) ) {
		return $id;
	}
	$row = desktop_mode_files_get_placement( $id );
	return rest_ensure_response( desktop_mode_files_shape_placement( $row ) );
}

/**
 * PATCH /placements/<id>
 */
function desktop_mode_files_rest_update_placement( WP_REST_Request $req ) {
	$id      = (int) $req['id'];
	$body    = $req->get_json_params() ?: $req->get_params();
	$current = desktop_mode_files_get_placement( $id );
	if ( ! $current ) {
		return new WP_Error( 'desktop_mode_files_not_found', __( 'Placement not found.', 'desktop-mode' ), array( 'status' => 404 ) );
	}
	$conflict = desktop_mode_files_check_if_match( (int) $current['updated_at_ms'], $req, $current );
	if ( is_wp_error( $conflict ) ) {
		return $conflict;
	}
	$changes = array();
	foreach ( array( 'parentId' => 'parent_id', 'x' => 'x', 'y' => 'y', 'sortOrder' => 'sort_order', 'meta' => 'meta' ) as $in => $col ) {
		if ( array_key_exists( $in, $body ) ) {
			$changes[ $col ] = $body[ $in ];
		}
	}
	$ok = desktop_mode_files_move( $id, get_current_user_id(), $changes );
	if ( is_wp_error( $ok ) ) {
		return $ok;
	}
	return rest_ensure_response( desktop_mode_files_shape_placement( desktop_mode_files_get_placement( $id ) ) );
}

/**
 * DELETE /placements/<id>
 */
function desktop_mode_files_rest_delete_placement( WP_REST_Request $req ) {
	$id      = (int) $req['id'];
	$user_id = get_current_user_id();
	// `force=1` query param permanently deletes (purges the row).
	// Default DELETE soft-trashes — the row lands in the recycle
	// bin and the user can restore. Same convention WP core REST
	// uses on every other resource.
	$force = '1' === (string) $req->get_param( 'force' )
		|| true === $req->get_param( 'force' );
	$ok    = $force
		? desktop_mode_files_purge_placement( $user_id, $id )
		: desktop_mode_files_trash_placement( $user_id, $id );
	if ( is_wp_error( $ok ) ) {
		return $ok;
	}
	return rest_ensure_response(
		array(
			'deleted' => true,
			'force'   => $force,
		)
	);
}

/**
 * GET /folders
 */
function desktop_mode_files_rest_list_folders() {
	$rows = desktop_mode_files_get_visible_folders( get_current_user_id() );
	$out  = array();
	foreach ( $rows as $row ) {
		$out[] = desktop_mode_files_shape_folder( $row );
	}
	return rest_ensure_response( array( 'folders' => $out ) );
}

/**
 * POST /folders
 */
function desktop_mode_files_rest_create_folder( WP_REST_Request $req ) {
	$id = desktop_mode_files_create_folder(
		get_current_user_id(),
		array(
			'name'       => (string) $req->get_param( 'name' ),
			'share_mode' => (string) $req->get_param( 'shareMode' ),
			'share_meta' => $req->get_param( 'shareMeta' ),
		)
	);
	if ( is_wp_error( $id ) ) {
		return $id;
	}
	return rest_ensure_response( desktop_mode_files_shape_folder( desktop_mode_files_get_folder( $id ) ) );
}

/**
 * PATCH /folders/<id>
 */
function desktop_mode_files_rest_update_folder( WP_REST_Request $req ) {
	$id      = (int) $req['id'];
	$body    = $req->get_json_params() ?: $req->get_params();
	$current = desktop_mode_files_get_folder( $id );
	if ( ! $current ) {
		return new WP_Error( 'desktop_mode_files_not_found', __( 'Folder not found.', 'desktop-mode' ), array( 'status' => 404 ) );
	}
	$conflict = desktop_mode_files_check_if_match( (int) $current['updated_at_ms'], $req, $current );
	if ( is_wp_error( $conflict ) ) {
		return $conflict;
	}
	$changes = array();
	foreach ( array( 'name' => 'name', 'shareMode' => 'share_mode', 'shareMeta' => 'share_meta' ) as $in => $col ) {
		if ( array_key_exists( $in, $body ) ) {
			$changes[ $col ] = $body[ $in ];
		}
	}
	$ok = desktop_mode_files_update_folder( $id, get_current_user_id(), $changes );
	if ( is_wp_error( $ok ) ) {
		return $ok;
	}
	return rest_ensure_response( desktop_mode_files_shape_folder( desktop_mode_files_get_folder( $id ) ) );
}

/**
 * DELETE /folders/<id>
 */
function desktop_mode_files_rest_delete_folder( WP_REST_Request $req ) {
	$id      = (int) $req['id'];
	$user_id = get_current_user_id();
	$force   = '1' === (string) $req->get_param( 'force' )
		|| true === $req->get_param( 'force' );
	// Default DELETE soft-trashes the folder + cascades to child
	// placements (see `desktop_mode_files_trash_folder`). `force=1`
	// permanently deletes both the folder row AND every child
	// placement that was trashed via the cascade.
	$ok = $force
		? desktop_mode_files_purge_folder( $user_id, $id )
		: desktop_mode_files_trash_folder( $user_id, $id );
	if ( is_wp_error( $ok ) ) {
		return $ok;
	}
	return rest_ensure_response(
		array(
			'deleted' => true,
			'force'   => $force,
		)
	);
}

/**
 * PUT /associations — replaces the entire user-association map.
 */
function desktop_mode_files_rest_save_associations( WP_REST_Request $req ) {
	$assoc = (array) $req->get_param( 'associations' );
	$clean = array();
	foreach ( $assoc as $type => $opener_id ) {
		$type      = sanitize_key( (string) $type );
		$opener_id = sanitize_key( (string) $opener_id );
		if ( '' === $type || '' === $opener_id ) {
			continue;
		}
		$clean[ $type ] = $opener_id;
	}
	update_user_meta( get_current_user_id(), DESKTOP_MODE_FILE_ASSOCIATIONS_META, $clean );
	return rest_ensure_response( array(
		'associations' => desktop_mode_get_user_file_associations( get_current_user_id() ),
	) );
}

/**
 * Shape a placement row for the wire — converts snake_case to
 * camelCase and merges in the resolved `Desktop_Mode_File`
 * shape so the JS side can render without a second fetch.
 *
 * @since 0.9.0
 *
 * @param array|null $row Normalized placement row.
 * @return array
 */
function desktop_mode_files_shape_placement( $row ) {
	if ( ! is_array( $row ) ) {
		return array();
	}
	$file  = desktop_mode_resolve_file( $row['file_type'], $row['file_ref'] );
	$shape = $file ? $file->serialize() : array(
		'type'       => $row['file_type'],
		'ref'        => $row['file_ref'],
		'title'      => '',
		'icon'       => 'dashicons-warning',
		'previewUrl' => '',
		'exists'     => false,
	);
	// `canTrash` carries the server's answer to "can the viewer
	// move this placement to the recycle bin?" so the client can
	// proactively suppress the trash affordance — both the tile's
	// right-click "Move to recycle bin" menu item and the trash
	// drop target's accept-check. Without it, the only feedback for
	// a forbidden drop was a 403 logged to the console, leaving the
	// user staring at a tile that wouldn't move. Falls back to
	// `false` when the helper isn't loaded (defensive — early-boot
	// REST calls before trash.php is required can't grant permission
	// they don't know about).
	$viewer_id  = (int) get_current_user_id();
	$can_trash  = false;
	if ( $viewer_id > 0 && function_exists( 'desktop_mode_files_user_can_trash_placement' ) ) {
		$can_trash = desktop_mode_files_user_can_trash_placement( $viewer_id, $row );
	}

	return array(
		'id'           => (int) $row['id'],
		'parentId'     => (int) $row['parent_id'],
		'x'            => (int) $row['x'],
		'y'            => (int) $row['y'],
		'sortOrder'    => (int) $row['sort_order'],
		'updatedAtMs'  => (int) $row['updated_at_ms'],
		'meta'         => isset( $row['meta'] ) ? $row['meta'] : null,
		'file'         => $shape,
		// `accessGated` is true when the viewer can't read the
		// underlying entity but the placement is shown anyway (the
		// shared-folder-view UX). Tile renderer surfaces it as a
		// lock overlay + tooltip.
		'accessGated'  => ! empty( $row['access_gated'] ),
		'canTrash'     => $can_trash,
	);
}

/**
 * @since 0.9.0
 *
 * @param array|null $row Folder row.
 * @return array
 */
function desktop_mode_files_shape_folder( $row ) {
	if ( ! is_array( $row ) ) {
		return array();
	}
	$shape = array(
		'id'           => (int) $row['id'],
		'ownerId'      => (int) $row['owner_id'],
		'name'         => (string) $row['name'],
		'shareMode'    => (string) $row['share_mode'],
		'shareMeta'    => isset( $row['share_meta'] ) ? $row['share_meta'] : null,
		'updatedAtMs'  => (int) $row['updated_at_ms'],
	);
	if ( function_exists( 'desktop_mode_files_get_folder_shares' ) ) {
		$shares = desktop_mode_files_get_folder_shares( (int) $row['id'] );
		$accepted_count = 0;
		$has_all        = 'all' === (string) $row['share_mode'];
		foreach ( $shares as $s ) {
			if ( 'accepted' === $s['state'] ) {
				$accepted_count++;
			}
		}
		$shape['shareSummary'] = array(
			'shared'         => $has_all || $accepted_count > 0,
			'recipientCount' => $accepted_count + ( $has_all ? 1 : 0 ),
		);
	}
	return $shape;
}

/**
 * Conditional-write helper. Reads `If-Match` from the request and
 * returns a 409 `WP_Error` when the stored row's `updated_at_ms`
 * doesn't match the supplied value. Returns null in every other
 * case (header absent → back-compat last-write-wins; header
 * matches → caller proceeds).
 *
 * The 409 body carries a structured `data` payload the client
 * surfaces as a toast: `{ reason, actor: { id,name,avatar },
 * current: { parentId, parentName, updatedAtMs } }`.
 *
 * @since 0.18.0
 *
 * @param int             $current_ms Current `updated_at_ms` on the row.
 * @param WP_REST_Request $req        Inbound request.
 * @param array           $row        Normalized row (placement or folder).
 * @return WP_Error|null
 */
function desktop_mode_files_check_if_match( $current_ms, WP_REST_Request $req, $row ) {
	$header = $req->get_header( 'if_match' );
	if ( null === $header || '' === $header ) {
		return null;
	}
	$expected = (int) trim( str_replace( '"', '', (string) $header ) );
	if ( $expected === (int) $current_ms ) {
		return null;
	}
	$actor_id = isset( $row['user_id'] ) ? (int) $row['user_id'] : ( isset( $row['owner_id'] ) ? (int) $row['owner_id'] : 0 );
	$actor    = $actor_id ? get_userdata( $actor_id ) : null;

	$parent_id   = isset( $row['parent_id'] ) ? (int) $row['parent_id'] : 0;
	$parent_name = '';
	if ( $parent_id > 0 ) {
		$parent_folder = desktop_mode_files_get_folder( $parent_id );
		$parent_name   = $parent_folder ? (string) $parent_folder['name'] : '';
	}

	$reason = 'parent_changed';
	if ( ! empty( $row['trashed_at_ms'] ) ) {
		$reason = 'trashed';
	}

	return new WP_Error(
		'desktop_mode_files_conflict',
		__( 'This row was changed by another session.', 'desktop-mode' ),
		array(
			'status' => 409,
			'data'   => array(
				'reason'  => $reason,
				'actor'   => array(
					'id'     => $actor_id,
					'name'   => $actor ? $actor->display_name : '',
					'avatar' => $actor ? get_avatar_url( $actor->ID, array( 'size' => 32 ) ) : '',
				),
				'current' => array(
					'parentId'    => $parent_id,
					'parentName'  => $parent_name,
					'updatedAtMs' => (int) $current_ms,
				),
			),
		)
	);
}

/**
 * Shape a share row for the wire.
 *
 * @since 0.18.0
 *
 * @param array|null $row Normalized share row.
 * @return array
 */
function desktop_mode_files_shape_share( $row ) {
	if ( ! is_array( $row ) ) {
		return array();
	}
	$shape = array(
		'id'            => (int) $row['id'],
		'folderId'      => (int) $row['folder_id'],
		'principalType' => (string) $row['principal_type'],
		'principalRef'  => (string) $row['principal_ref'],
		'capability'    => (string) $row['capability'],
		'state'         => (string) $row['state'],
		'invitedBy'     => (int) $row['invited_by'],
		'invitedAtMs'   => (int) $row['invited_at_ms'],
		'decidedAtMs'   => isset( $row['decided_at_ms'] ) ? $row['decided_at_ms'] : null,
	);
	if ( 'user' === $row['principal_type'] ) {
		$uid  = (int) $row['principal_ref'];
		$user = $uid > 0 ? get_userdata( $uid ) : null;
		$shape['displayName'] = $user ? $user->display_name : '';
		$shape['avatarUrl']   = $user ? get_avatar_url( $uid, array( 'size' => 48 ) ) : '';
	} else {
		$roles = wp_roles();
		$info  = $roles && isset( $roles->roles[ $row['principal_ref'] ] ) ? $roles->roles[ $row['principal_ref'] ] : null;
		$shape['displayName'] = $info ? translate_user_role( (string) $info['name'] ) : (string) $row['principal_ref'];
		$shape['avatarUrl']   = '';
	}
	return $shape;
}

/**
 * GET /folders/<id>/shares — owner only.
 */
function desktop_mode_files_rest_list_shares( WP_REST_Request $req ) {
	$folder_id = (int) $req['id'];
	$user_id   = get_current_user_id();
	if ( ! desktop_mode_files_share_can_manage( $folder_id, $user_id ) ) {
		return new WP_Error( 'desktop_mode_files_forbidden', __( 'You cannot view shares for this folder.', 'desktop-mode' ), array( 'status' => 403 ) );
	}
	$folder = desktop_mode_files_get_folder( $folder_id );
	if ( ! $folder ) {
		return new WP_Error( 'desktop_mode_files_not_found', __( 'Folder not found.', 'desktop-mode' ), array( 'status' => 404 ) );
	}
	$rows  = desktop_mode_files_get_folder_shares( $folder_id );
	$out   = array();
	foreach ( $rows as $row ) {
		$out[] = desktop_mode_files_shape_share( $row );
	}
	return rest_ensure_response(
		array(
			'shares'    => $out,
			'shareMode' => (string) $folder['share_mode'],
			'all'       => 'all' === (string) $folder['share_mode'],
		)
	);
}

/**
 * POST /folders/<id>/shares — owner only.
 */
function desktop_mode_files_rest_create_share( WP_REST_Request $req ) {
	$folder_id = (int) $req['id'];
	$actor_id  = get_current_user_id();
	$id = desktop_mode_folder_share_invite(
		$folder_id,
		$actor_id,
		(string) $req->get_param( 'principalType' ),
		(string) $req->get_param( 'principalRef' ),
		(string) $req->get_param( 'capability' )
	);
	if ( is_wp_error( $id ) ) {
		return $id;
	}
	return rest_ensure_response( desktop_mode_files_shape_share( desktop_mode_files_get_share( $id ) ) );
}

/**
 * PATCH /folders/<id>/shares/<shareId> — owner only.
 */
function desktop_mode_files_rest_update_share( WP_REST_Request $req ) {
	$share_id = (int) $req['shareId'];
	$ok = desktop_mode_folder_share_update_capability( $share_id, get_current_user_id(), (string) $req->get_param( 'capability' ) );
	if ( is_wp_error( $ok ) ) {
		return $ok;
	}
	return rest_ensure_response( desktop_mode_files_shape_share( desktop_mode_files_get_share( $share_id ) ) );
}

/**
 * DELETE /folders/<id>/shares/<shareId> — owner only.
 */
function desktop_mode_files_rest_delete_share( WP_REST_Request $req ) {
	$share_id = (int) $req['shareId'];
	$ok = desktop_mode_folder_share_revoke( $share_id, get_current_user_id() );
	if ( is_wp_error( $ok ) ) {
		return $ok;
	}
	return rest_ensure_response( array( 'deleted' => true ) );
}

/**
 * POST /folders/<id>/shares/<shareId>/accept — recipient only.
 */
function desktop_mode_files_rest_accept_share( WP_REST_Request $req ) {
	$share_id = (int) $req['shareId'];
	$row = desktop_mode_folder_share_accept( $share_id, get_current_user_id() );
	if ( is_wp_error( $row ) ) {
		return $row;
	}
	return rest_ensure_response( desktop_mode_files_shape_share( $row ) );
}

/**
 * POST /folders/<id>/shares/<shareId>/deny — recipient only.
 */
function desktop_mode_files_rest_deny_share( WP_REST_Request $req ) {
	$share_id = (int) $req['shareId'];
	$row = desktop_mode_folder_share_deny( $share_id, get_current_user_id() );
	if ( is_wp_error( $row ) ) {
		return $row;
	}
	return rest_ensure_response( desktop_mode_files_shape_share( $row ) );
}

/**
 * POST /folders/<id>/leave — recipient-initiated leave.
 *
 * Unlike `/shares/{id}/deny` which targets a specific share row,
 * this endpoint finds whichever grant currently lets the user
 * see the folder (user-principal or role-principal) and removes
 * their access — for role shares without affecting other role
 * members, via the per-user decisions table.
 */
function desktop_mode_files_rest_leave_folder( WP_REST_Request $req ) {
	$folder_id = (int) $req['id'];
	$ok = desktop_mode_folder_share_leave( $folder_id, get_current_user_id() );
	if ( is_wp_error( $ok ) ) {
		return $ok;
	}
	return rest_ensure_response( array( 'left' => true ) );
}

/**
 * Permission gate for /users/search. Requires `edit_posts` —
 * `desktop_mode_files_rest_permission` would let any logged-in
 * desktop-mode user pull the directory, which is too broad for an
 * autocomplete that exposes display names + emails.
 *
 * @since 0.18.0
 */
function desktop_mode_files_rest_search_users_permission() {
	$base = desktop_mode_files_rest_permission();
	if ( is_wp_error( $base ) ) {
		return $base;
	}
	if ( ! current_user_can( 'edit_posts' ) ) {
		return new WP_Error( 'desktop_mode_files_forbidden', __( 'You cannot search users.', 'desktop-mode' ), array( 'status' => 403 ) );
	}
	return true;
}

/**
 * GET /files/users/search?q=<>&exclude=<csv> — autocomplete for the
 * folder share picker.
 *
 * @since 0.18.0
 */
function desktop_mode_files_rest_search_users( WP_REST_Request $req ) {
	$q       = trim( (string) $req->get_param( 'q' ) );
	$exclude = array_filter( array_map( 'intval', explode( ',', (string) $req->get_param( 'exclude' ) ) ) );

	// Always exclude the current viewer — sharing with yourself is
	// a no-op the modal already rejects, no point spending a slot
	// in the dropdown on it.
	$exclude[] = (int) get_current_user_id();
	$exclude   = array_values( array_unique( array_filter( $exclude ) ) );

	$args = array(
		'number'  => 20,
		'orderby' => 'display_name',
		'order'   => 'ASC',
		'exclude' => $exclude,
		// `fields => 'all'` returns full WP_User objects so the
		// capability check below resolves role caps correctly. A
		// stdClass with stripped fields breaks `user_can()` on
		// some WordPress versions and silently drops every row.
		'fields'  => 'all',
	);
	if ( '' !== $q ) {
		$args['search']         = '*' . $q . '*';
		$args['search_columns'] = array( 'user_login', 'user_email', 'display_name', 'user_nicename' );
	}

	/**
	 * Filter the WP_User_Query args used by the share picker.
	 *
	 * @since 0.18.0
	 *
	 * @param array $args Default args.
	 * @param array $req  Request params (`q`, `exclude`).
	 */
	$args = (array) apply_filters( 'desktop_mode_files_share_user_query_args', $args, $req->get_params() );

	$query = new WP_User_Query( $args );
	$users = $query->get_results();
	$out   = array();
	foreach ( (array) $users as $user ) {
		if ( ! user_can( $user, 'edit_posts' ) ) {
			continue;
		}
		$out[] = array(
			'id'        => (int) $user->ID,
			'name'      => (string) $user->display_name,
			'login'     => (string) $user->user_login,
			'avatarUrl' => get_avatar_url( $user->ID, array( 'size' => 48 ) ),
		);
	}
	return rest_ensure_response( array( 'users' => $out ) );
}
