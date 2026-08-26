<?php
/**
 * OpenStation — Files REST routes.
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
 *   GET    /folders/(?P<id>\d+)/shares List a folder's shares
 *                                       (owner only).
 *   POST   /folders/(?P<id>\d+)/shares Invite a user/role (owner only).
 *   PATCH  /folders/(?P<id>\d+)/shares/(?P<shareId>\d+)
 *                                       Change a share's capability.
 *   DELETE /folders/(?P<id>\d+)/shares/(?P<shareId>\d+)
 *                                       Revoke a share.
 *   POST   /folders/(?P<id>\d+)/shares/(?P<shareId>\d+)/accept
 *                                       Accept an invite (recipient).
 *   POST   /folders/(?P<id>\d+)/shares/(?P<shareId>\d+)/deny
 *                                       Deny an invite (recipient).
 *   POST   /folders/(?P<id>\d+)/leave  Leave a shared folder
 *                                       (recipient).
 *
 *   GET    /users/search               Share-picker autocomplete.
 *   POST   /folder-sharing-tables/purge
 *                                       Drop the folder-sharing tables
 *                                       (site admin only).
 *
 *   PUT    /associations               Replace the viewer's full
 *                                       `{ type => opener_id }` map.
 *
 * Permission: every route requires a logged-in user with desktop
 * mode enabled. Per-row gating happens inside the store. On top of
 * that base, the share/accept/deny/leave routes also gate on the
 * viewer's folder-sharing OS Setting via
 * `openstation_files_rest_share_permission`, `/users/search`
 * additionally requires `edit_posts`, and the sharing-tables purge
 * requires `manage_options`.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Base permission check shared by the desktop-files REST routes:
 * requires a logged-in user with OpenStation enabled.
 */
function openstation_files_rest_permission() {
	if ( ! is_user_logged_in() ) {
		return new WP_Error( 'openstation_files_unauthenticated', __( 'You must be logged in.', 'desktop-mode' ), array( 'status' => 401 ) );
	}
	if ( function_exists( 'openstation_is_enabled' ) && ! openstation_is_enabled( get_current_user_id() ) ) {
		return new WP_Error( 'openstation_files_disabled', __( 'OpenStation is not enabled for this user.', 'desktop-mode' ), array( 'status' => 403 ) );
	}
	return true;
}

/**
 * Permission callback layered ON TOP of
 * `openstation_files_rest_permission` for every share-related
 * route. Returns a 404 (looks the same as a route that doesn't
 * exist) when the viewer has the folder-sharing feature toggled
 * off in OS Settings — no information leak about whether the
 * feature is even installed.
 */
function openstation_files_rest_share_permission() {
	$base = openstation_files_rest_permission();
	if ( is_wp_error( $base ) ) {
		return $base;
	}
	if (
		function_exists( 'openstation_files_sharing_enabled_for' )
		&& ! openstation_files_sharing_enabled_for( get_current_user_id() )
	) {
		return new WP_Error(
			'rest_no_route',
			__( 'No route was found matching the URL and request method.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}
	return true;
}

/**
 * Permission callback for the destructive site-admin actions
 * (currently: drop the folder-sharing tables). Requires
 * `manage_options` — site-wide schema mutation should never be
 * exposed below that capability.
 */
function openstation_files_rest_admin_permission() {
	if ( ! current_user_can( 'manage_options' ) ) {
		return new WP_Error(
			'openstation_files_forbidden',
			__( 'You do not have permission to perform this action.', 'desktop-mode' ),
			array( 'status' => 403 )
		);
	}
	return true;
}

/**
 * Register the routes.
 */
function openstation_files_register_rest_routes() {
	$ns = 'desktop-mode/v1';

	register_rest_route(
		$ns,
		'/files/placements',
		array(
			array(
				'methods'             => WP_REST_Server::READABLE,
				'permission_callback' => 'openstation_files_rest_permission',
				'callback'            => 'openstation_files_rest_list_placements',
				'args'                => array(
					'folder' => array(
						'type'              => 'integer',
						'default'           => 0,
						'sanitize_callback' => 'absint',
					),
				),
			),
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => 'openstation_files_rest_permission',
				'callback'            => 'openstation_files_rest_create_placement',
				'args'                => array(
					'parentId'  => array(
						'type'    => 'integer',
						'default' => 0,
					),
					'type'      => array(
						'type'     => 'string',
						'required' => true,
					),
					'ref'       => array(
						'type'     => 'string',
						'required' => true,
					),
					'x'         => array(
						'type'    => 'integer',
						'default' => 0,
					),
					'y'         => array(
						'type'    => 'integer',
						'default' => 0,
					),
					'sortOrder' => array(
						'type'    => 'integer',
						'default' => 0,
					),
					'meta'      => array(
						'type'     => 'object',
						'required' => false,
					),
				),
			),
		)
	);

	register_rest_route(
		$ns,
		'/files/placements/(?P<id>\d+)',
		array(
			array(
				'methods'             => WP_REST_Server::EDITABLE,
				'permission_callback' => 'openstation_files_rest_permission',
				'callback'            => 'openstation_files_rest_update_placement',
			),
			array(
				'methods'             => WP_REST_Server::DELETABLE,
				'permission_callback' => 'openstation_files_rest_permission',
				'callback'            => 'openstation_files_rest_delete_placement',
			),
		)
	);

	register_rest_route(
		$ns,
		'/files/folders',
		array(
			array(
				'methods'             => WP_REST_Server::READABLE,
				'permission_callback' => 'openstation_files_rest_permission',
				'callback'            => 'openstation_files_rest_list_folders',
			),
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => 'openstation_files_rest_permission',
				'callback'            => 'openstation_files_rest_create_folder',
				'args'                => array(
					'name'      => array(
						'type'     => 'string',
						'required' => true,
					),
					'shareMode' => array(
						'type'    => 'string',
						'default' => 'private',
					),
					'shareMeta' => array(
						'type'     => 'object',
						'required' => false,
					),
				),
			),
		)
	);

	register_rest_route(
		$ns,
		'/files/folders/(?P<id>\d+)',
		array(
			array(
				'methods'             => WP_REST_Server::EDITABLE,
				'permission_callback' => 'openstation_files_rest_permission',
				'callback'            => 'openstation_files_rest_update_folder',
			),
			array(
				'methods'             => WP_REST_Server::DELETABLE,
				'permission_callback' => 'openstation_files_rest_permission',
				'callback'            => 'openstation_files_rest_delete_folder',
			),
		)
	);

	register_rest_route(
		$ns,
		'/files/associations',
		array(
			'methods'             => 'PUT',
			'permission_callback' => 'openstation_files_rest_permission',
			'callback'            => 'openstation_files_rest_save_associations',
			'args'                => array(
				'associations' => array(
					'type'     => 'object',
					'required' => true,
				),
			),
		)
	);

	// Every share-related route gates on the user's
	// `foldersSharingEnabled` OS Setting via
	// `openstation_files_rest_share_permission` — when a user has
	// flipped sharing off, these routes return 404 (looks the same
	// as a feature that isn't installed; no info leak about the
	// kill switch's existence).
	register_rest_route(
		$ns,
		'/files/folders/(?P<id>\d+)/shares',
		array(
			array(
				'methods'             => WP_REST_Server::READABLE,
				'permission_callback' => 'openstation_files_rest_share_permission',
				'callback'            => 'openstation_files_rest_list_shares',
			),
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => 'openstation_files_rest_share_permission',
				'callback'            => 'openstation_files_rest_create_share',
				'args'                => array(
					'principalType' => array(
						'type'     => 'string',
						'enum'     => array( 'user', 'role' ),
						'required' => true,
					),
					'principalRef'  => array(
						'type'     => 'string',
						'required' => true,
					),
					'capability'    => array(
						'type'    => 'string',
						'enum'    => array( 'read', 'write' ),
						'default' => 'read',
					),
				),
			),
		)
	);

	register_rest_route(
		$ns,
		'/files/folders/(?P<id>\d+)/shares/(?P<shareId>\d+)',
		array(
			array(
				'methods'             => WP_REST_Server::EDITABLE,
				'permission_callback' => 'openstation_files_rest_share_permission',
				'callback'            => 'openstation_files_rest_update_share',
				'args'                => array(
					'capability' => array(
						'type'     => 'string',
						'enum'     => array( 'read', 'write' ),
						'required' => true,
					),
				),
			),
			array(
				'methods'             => WP_REST_Server::DELETABLE,
				'permission_callback' => 'openstation_files_rest_share_permission',
				'callback'            => 'openstation_files_rest_delete_share',
			),
		)
	);

	register_rest_route(
		$ns,
		'/files/folders/(?P<id>\d+)/shares/(?P<shareId>\d+)/accept',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'permission_callback' => 'openstation_files_rest_share_permission',
			'callback'            => 'openstation_files_rest_accept_share',
		)
	);

	register_rest_route(
		$ns,
		'/files/folders/(?P<id>\d+)/shares/(?P<shareId>\d+)/deny',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'permission_callback' => 'openstation_files_rest_share_permission',
			'callback'            => 'openstation_files_rest_deny_share',
		)
	);

	register_rest_route(
		$ns,
		'/files/folders/(?P<id>\d+)/leave',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'permission_callback' => 'openstation_files_rest_share_permission',
			'callback'            => 'openstation_files_rest_leave_folder',
		)
	);

	register_rest_route(
		$ns,
		'/files/users/search',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'permission_callback' => 'openstation_files_rest_search_users_permission',
			'callback'            => 'openstation_files_rest_search_users',
			'args'                => array(
				'q'       => array(
					'type'    => 'string',
					'default' => '',
				),
				'exclude' => array(
					'type'    => 'string',
					'default' => '',
				),
			),
		)
	);

	// Site-admin only: destructive cleanup that drops the folder-
	// sharing tables outright (legacy + current). Surfaced from
	// the OS Settings → Features → Advanced panel.
	register_rest_route(
		$ns,
		'/files/folder-sharing-tables/purge',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'permission_callback' => 'openstation_files_rest_admin_permission',
			'callback'            => 'openstation_files_rest_purge_sharing_tables',
		)
	);
}
add_action( 'rest_api_init', 'openstation_files_register_rest_routes' );

/**
 * Inline the root folder's placements into the boot-time shell
 * config so the desktop file grid hydrates without a REST
 * round-trip — this was the only REST call the shell had to await
 * before revealing the desktop. Mirrors the GET /placements handler
 * for `folder=0` exactly (same orphan backfill, same shape) so the
 * client store can't tell the difference; the JS consumer
 * (`src/desktop-files/layer.ts`) consumes the key one-shot, so any
 * later re-hydration still goes through REST for fresh state.
 *
 * The `openstation_shell_config` filter only runs while rendering
 * the shell for an enabled, logged-in user — the same gate the REST
 * permission callback enforces.
 *
 * @param array $config Shell config.
 * @return array
 */
function openstation_files_inject_boot_placements( $config ) {
	$user_id = get_current_user_id();
	if ( $user_id <= 0 ) {
		return $config;
	}
	openstation_files_auto_place_orphans( $user_id );
	$rows = openstation_files_get_for_user_folder( $user_id, 0 );
	$out  = array();
	foreach ( $rows as $row ) {
		$out[] = openstation_files_shape_placement( $row );
	}
	$config['filesBootPlacements'] = $out;
	return $config;
}
add_filter( 'openstation_shell_config', 'openstation_files_inject_boot_placements', 20 );

/**
 * Inline the viewer's visible folder rows into the boot-time shell
 * config, the same way the root placements are.
 *
 * The client keeps a folders map alongside its placements, and
 * anything that needs to know a folder's OWNER reads it there —
 * notably the "Share folder" title-bar button, which is owner-only
 * and has nothing but a window id to work from. Nothing on the
 * normal boot path filled that map: placement hydration populates
 * placements, and `listFolders()` only ran after a create, a rename
 * or an untrash. So a plain reload left every folder ownerless, and
 * the owner of a folder lost the one control that manages its
 * sharing until something happened to repopulate the map.
 *
 * Mirrors GET /folders exactly (same visibility resolution — owned
 * folders plus accepted shares plus `share_mode='all'` — same
 * shape), and the client consumes it one-shot, so any later
 * re-hydration still goes through REST for fresh state.
 *
 * @param array $config Shell config.
 * @return array
 */
function openstation_files_inject_boot_folders( $config ) {
	$user_id = get_current_user_id();
	if ( $user_id <= 0 ) {
		return $config;
	}
	$out = array();
	foreach ( openstation_files_get_visible_folders( $user_id ) as $row ) {
		$out[] = openstation_files_shape_folder( $row );
	}
	$config['filesBootFolders'] = $out;
	return $config;
}
add_filter( 'openstation_shell_config', 'openstation_files_inject_boot_folders', 20 );

/**
 * GET /placements
 */
function openstation_files_rest_list_placements( WP_REST_Request $req ) {
	$user_id   = get_current_user_id();
	$parent_id = (int) $req->get_param( 'folder' );
	// Self-healing backfill — see
	// `openstation_files_auto_place_orphan_folders` for the why.
	// Only runs at the root because that's the only context where
	// auto-placing an orphan folder as a tile is unambiguous.
	if ( 0 === $parent_id ) {
		openstation_files_auto_place_orphans( $user_id );
	}
	$rows = openstation_files_get_for_user_folder( $user_id, $parent_id );
	$out  = array();
	foreach ( $rows as $row ) {
		$out[] = openstation_files_shape_placement( $row );
	}
	return rest_ensure_response(
		array(
			'placements' => $out,
			'folderId'   => $parent_id,
		)
	);
}

/**
 * POST /placements
 */
function openstation_files_rest_create_placement( WP_REST_Request $req ) {
	$type = (string) $req->get_param( 'type' );
	$ref  = (string) $req->get_param( 'ref' );
	$meta = $req->get_param( 'meta' );

	// `link` placements get a server-resolved favicon stuffed onto
	// `meta.iconUrl` so the tile renderer can paint it without the
	// browser making a third-party request on every render. Other
	// types skip the resolver entirely (no extra fetch latency).
	if ( 'link' === $type && '' !== $ref ) {
		$icon_data_uri = openstation_resolve_favicon( $ref );
		if ( is_string( $icon_data_uri ) && '' !== $icon_data_uri ) {
			$meta_arr            = is_array( $meta ) ? $meta : array();
			$meta_arr['iconUrl'] = $icon_data_uri;
			$meta                = $meta_arr;
		}
	}

	$id = openstation_files_place(
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
	$row = openstation_files_get_placement( $id );
	return rest_ensure_response( openstation_files_shape_placement( $row ) );
}

/**
 * PATCH /placements/<id>
 */
function openstation_files_rest_update_placement( WP_REST_Request $req ) {
	$id      = (int) $req['id'];
	$json    = $req->get_json_params();
	$body    = $json ? $json : $req->get_params();
	$current = openstation_files_get_placement( $id );
	if ( ! $current ) {
		return new WP_Error( 'openstation_files_not_found', __( 'Placement not found.', 'desktop-mode' ), array( 'status' => 404 ) );
	}
	$conflict = openstation_files_check_if_match( (int) $current['updated_at_ms'], $req, $current );
	if ( is_wp_error( $conflict ) ) {
		return $conflict;
	}
	$changes = array();
	foreach ( array(
		'parentId'  => 'parent_id',
		'x'         => 'x',
		'y'         => 'y',
		'sortOrder' => 'sort_order',
		'meta'      => 'meta',
	) as $in => $col ) {
		if ( array_key_exists( $in, $body ) ) {
			$changes[ $col ] = $body[ $in ];
		}
	}
	$ok = openstation_files_move( $id, get_current_user_id(), $changes );
	if ( is_wp_error( $ok ) ) {
		return $ok;
	}
	return rest_ensure_response( openstation_files_shape_placement( openstation_files_get_placement( $id ) ) );
}

/**
 * DELETE /placements/<id>
 */
function openstation_files_rest_delete_placement( WP_REST_Request $req ) {
	$id      = (int) $req['id'];
	$user_id = get_current_user_id();
	// `force=1` query param permanently deletes (purges the row).
	// Default DELETE soft-trashes — the row lands in the recycle
	// bin and the user can restore. Same convention WP core REST
	// uses on every other resource.
	$force = '1' === (string) $req->get_param( 'force' )
		|| true === $req->get_param( 'force' );
	$ok    = $force
		? openstation_files_purge_placement( $user_id, $id )
		: openstation_files_trash_placement( $user_id, $id );
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
function openstation_files_rest_list_folders() {
	$rows = openstation_files_get_visible_folders( get_current_user_id() );
	$out  = array();
	foreach ( $rows as $row ) {
		$out[] = openstation_files_shape_folder( $row );
	}
	return rest_ensure_response( array( 'folders' => $out ) );
}

/**
 * POST /folders
 */
function openstation_files_rest_create_folder( WP_REST_Request $req ) {
	$id = openstation_files_create_folder(
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
	return rest_ensure_response( openstation_files_shape_folder( openstation_files_get_folder( $id ) ) );
}

/**
 * PATCH /folders/<id>
 */
function openstation_files_rest_update_folder( WP_REST_Request $req ) {
	$id      = (int) $req['id'];
	$json    = $req->get_json_params();
	$body    = $json ? $json : $req->get_params();
	$current = openstation_files_get_folder( $id );
	if ( ! $current ) {
		return new WP_Error( 'openstation_files_not_found', __( 'Folder not found.', 'desktop-mode' ), array( 'status' => 404 ) );
	}
	$conflict = openstation_files_check_if_match( (int) $current['updated_at_ms'], $req, $current );
	if ( is_wp_error( $conflict ) ) {
		return $conflict;
	}
	$changes = array();
	foreach ( array(
		'name'      => 'name',
		'shareMode' => 'share_mode',
		'shareMeta' => 'share_meta',
	) as $in => $col ) {
		if ( array_key_exists( $in, $body ) ) {
			$changes[ $col ] = $body[ $in ];
		}
	}
	$ok = openstation_files_update_folder( $id, get_current_user_id(), $changes );
	if ( is_wp_error( $ok ) ) {
		return $ok;
	}
	return rest_ensure_response( openstation_files_shape_folder( openstation_files_get_folder( $id ) ) );
}

/**
 * DELETE /folders/<id>
 */
function openstation_files_rest_delete_folder( WP_REST_Request $req ) {
	$id      = (int) $req['id'];
	$user_id = get_current_user_id();
	$force   = '1' === (string) $req->get_param( 'force' )
		|| true === $req->get_param( 'force' );
	// Default DELETE soft-trashes the folder + cascades to child
	// placements (see `openstation_files_trash_folder`). `force=1`
	// permanently deletes both the folder row AND every child
	// placement that was trashed via the cascade.
	$ok = $force
		? openstation_files_purge_folder( $user_id, $id )
		: openstation_files_trash_folder( $user_id, $id );
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
function openstation_files_rest_save_associations( WP_REST_Request $req ) {
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
	update_user_meta( get_current_user_id(), OPENSTATION_FILE_ASSOCIATIONS_META, $clean );
	return rest_ensure_response(
		array(
			'associations' => openstation_get_user_file_associations( get_current_user_id() ),
		)
	);
}

/**
 * Shape a placement row for the wire — converts snake_case to
 * camelCase and merges in the resolved `OpenStation_File`
 * shape so the JS side can render without a second fetch.
 *
 * @param array|null $row Normalized placement row.
 * @return array
 */
function openstation_files_shape_placement( $row ) {
	if ( ! is_array( $row ) ) {
		return array();
	}
	// Access-gated rows (shared-folder view, viewer lacks read on
	// the underlying entity) get a redacted shape — the viewer may
	// learn THAT the owner placed something here, not WHAT it is.
	// Skipping the resolver keeps entity metadata (title, permalink,
	// status, roles, …) from crossing the read-access boundary; the
	// tile renderer paints the lock overlay off `accessGated`.
	$access_gated = ! empty( $row['access_gated'] );
	if ( $access_gated ) {
		$shape = array(
			'type'       => $row['file_type'],
			'ref'        => $row['file_ref'],
			'title'      => __( 'Restricted item', 'desktop-mode' ),
			'icon'       => 'dashicons-lock',
			'previewUrl' => '',
			'exists'     => true,
		);
	} else {
		$file  = openstation_resolve_file( $row['file_type'], $row['file_ref'] );
		$shape = $file ? $file->serialize() : array(
			'type'       => $row['file_type'],
			'ref'        => $row['file_ref'],
			'title'      => '',
			'icon'       => 'dashicons-warning',
			'previewUrl' => '',
			'exists'     => false,
		);
	}
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
	$viewer_id = (int) get_current_user_id();
	$can_trash = false;
	if ( $viewer_id > 0 && function_exists( 'openstation_files_user_can_trash_placement' ) ) {
		$can_trash = openstation_files_user_can_trash_placement( $viewer_id, $row );
	}

	return array(
		'id'          => (int) $row['id'],
		'parentId'    => (int) $row['parent_id'],
		'x'           => (int) $row['x'],
		'y'           => (int) $row['y'],
		'sortOrder'   => (int) $row['sort_order'],
		'updatedAtMs' => (int) $row['updated_at_ms'],
		'meta'        => isset( $row['meta'] ) ? $row['meta'] : null,
		'file'        => $shape,
		// `accessGated` is true when the viewer can't read the
		// underlying entity but the placement is shown anyway (the
		// shared-folder-view UX). Tile renderer surfaces it as a
		// lock overlay + tooltip; the `file` shape above is redacted.
		'accessGated' => $access_gated,
		'canTrash'    => $can_trash,
	);
}

/**
 * @param array|null $row Folder row.
 * @return array
 */
function openstation_files_shape_folder( $row ) {
	if ( ! is_array( $row ) ) {
		return array();
	}
	$shape = array(
		'id'          => (int) $row['id'],
		'ownerId'     => (int) $row['owner_id'],
		'name'        => (string) $row['name'],
		'shareMode'   => (string) $row['share_mode'],
		'shareMeta'   => isset( $row['share_meta'] ) ? $row['share_meta'] : null,
		'updatedAtMs' => (int) $row['updated_at_ms'],
	);
	// Same summary `OpenStation_Folder_File::serialize()` puts on a
	// folder PLACEMENT, so a tile paints identically whichever
	// response it came from.
	if ( function_exists( 'openstation_files_folder_share_summary' ) ) {
		$shape['shareSummary'] = openstation_files_folder_share_summary( $row );
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
 * @param int             $current_ms Current `updated_at_ms` on the row.
 * @param WP_REST_Request $req        Inbound request.
 * @param array           $row        Normalized row (placement or folder).
 * @return WP_Error|null
 */
function openstation_files_check_if_match( $current_ms, WP_REST_Request $req, $row ) {
	$header = $req->get_header( 'if_match' );
	if ( null === $header || '' === $header ) {
		return null;
	}
	$expected = (int) trim( str_replace( '"', '', (string) $header ) );
	if ( $expected === (int) $current_ms ) {
		return null;
	}
	// Prefer `updated_by` (v10+) so the conflict toast attributes
	// the change to the SESSION that won the race. Falls back to
	// `owner_id` (placement creator / folder owner) for legacy
	// rows from before the v10 `updated_by` column was added — in
	// a non-shared-write workflow that still happens to be the
	// right person; in shared-write the toast may be slightly
	// misleading for the lifetime of pre-v10 rows. New mutations
	// stamp the column accurately. See
	// `openstation_files_ensure_updated_by_column`.
	$actor_id = 0;
	if ( isset( $row['updated_by'] ) && (int) $row['updated_by'] > 0 ) {
		$actor_id = (int) $row['updated_by'];
	} elseif ( isset( $row['owner_id'] ) ) {
		$actor_id = (int) $row['owner_id'];
	}
	$actor = $actor_id ? get_userdata( $actor_id ) : null;

	$parent_id   = isset( $row['parent_id'] ) ? (int) $row['parent_id'] : 0;
	$parent_name = '';
	if ( $parent_id > 0 ) {
		$parent_folder = openstation_files_get_folder( $parent_id );
		$parent_name   = $parent_folder ? (string) $parent_folder['name'] : '';
	}

	$reason = 'parent_changed';
	if ( ! empty( $row['trashed_at_ms'] ) ) {
		$reason = 'trashed';
	}

	// PII gate. The conflict toast names the actor (display name +
	// avatar) and the row's parent folder only when the requesting
	// viewer is in the same collaboration scope as the actor — i.e.
	// owns the row, owns the parent folder, or has at least read
	// access to the parent folder via the shares table. For any
	// other viewer the actor degrades to a generic "another
	// session" — `id: 0`, empty name + avatar — and `current`
	// drops the parent id/name, so a write attempt can't be used
	// to enumerate other users' display names or folder names
	// (this check runs BEFORE the store's ownership gate, so the
	// 409 body must not leak what the later 403 would protect).
	$viewer_id       = (int) get_current_user_id();
	$viewer_owns_row = isset( $row['owner_id'] ) && (int) $row['owner_id'] === $viewer_id;
	$viewer_can_see  = $viewer_owns_row;
	if ( ! $viewer_can_see && $parent_id > 0 && isset( $parent_folder ) && $parent_folder ) {
		if ( (int) $parent_folder['owner_id'] === $viewer_id ) {
			$viewer_can_see = true;
		} elseif ( function_exists( 'openstation_folder_share_user_capability' ) ) {
			$viewer_can_see = 'none' !== openstation_folder_share_user_capability( $parent_id, $viewer_id );
		}
	}
	$actor_payload = array(
		'id'     => $viewer_can_see ? $actor_id : 0,
		'name'   => $viewer_can_see && $actor ? $actor->display_name : '',
		'avatar' => $viewer_can_see && $actor ? get_avatar_url( $actor->ID, array( 'size' => 32 ) ) : '',
	);

	return new WP_Error(
		'openstation_files_conflict',
		__( 'This row was changed by another session.', 'desktop-mode' ),
		array(
			'status' => 409,
			'data'   => array(
				'reason'  => $reason,
				'actor'   => $actor_payload,
				'current' => array(
					'parentId'    => $viewer_can_see ? $parent_id : 0,
					'parentName'  => $viewer_can_see ? $parent_name : '',
					'updatedAtMs' => (int) $current_ms,
				),
			),
		)
	);
}

/**
 * Shape a share row for the wire.
 *
 * @param array|null $row Normalized share row.
 * @return array
 */
function openstation_files_shape_share( $row ) {
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
		$uid                  = (int) $row['principal_ref'];
		$user                 = $uid > 0 ? get_userdata( $uid ) : null;
		$shape['displayName'] = $user ? $user->display_name : '';
		$shape['avatarUrl']   = $user ? get_avatar_url( $uid, array( 'size' => 48 ) ) : '';
	} else {
		$roles                = wp_roles();
		$info                 = $roles && isset( $roles->roles[ $row['principal_ref'] ] ) ? $roles->roles[ $row['principal_ref'] ] : null;
		$shape['displayName'] = $info ? translate_user_role( (string) $info['name'] ) : (string) $row['principal_ref'];
		$shape['avatarUrl']   = '';
	}
	return $shape;
}

/**
 * GET /folders/<id>/shares — owner only.
 */
function openstation_files_rest_list_shares( WP_REST_Request $req ) {
	$folder_id = (int) $req['id'];
	$user_id   = get_current_user_id();
	if ( ! openstation_files_share_can_manage( $folder_id, $user_id ) ) {
		return new WP_Error( 'openstation_files_forbidden', __( 'You cannot view shares for this folder.', 'desktop-mode' ), array( 'status' => 403 ) );
	}
	$folder = openstation_files_get_folder( $folder_id );
	if ( ! $folder ) {
		return new WP_Error( 'openstation_files_not_found', __( 'Folder not found.', 'desktop-mode' ), array( 'status' => 404 ) );
	}
	$rows = openstation_files_get_folder_shares( $folder_id );
	$out  = array();
	foreach ( $rows as $row ) {
		$out[] = openstation_files_shape_share( $row );
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
function openstation_files_rest_create_share( WP_REST_Request $req ) {
	$folder_id = (int) $req['id'];
	$actor_id  = get_current_user_id();
	$id        = openstation_folder_share_invite(
		$folder_id,
		$actor_id,
		(string) $req->get_param( 'principalType' ),
		(string) $req->get_param( 'principalRef' ),
		(string) $req->get_param( 'capability' )
	);
	if ( is_wp_error( $id ) ) {
		return $id;
	}
	return rest_ensure_response( openstation_files_shape_share( openstation_files_get_share( $id ) ) );
}

/**
 * Verify that the share id in the URL actually belongs to the
 * folder id in the URL. Returns the loaded share row or a
 * `WP_Error` (404 unknown share / 404 mismatch). The underlying
 * mutation functions still gate on the share's true folder, so a
 * mismatched URL never escalates permission — but the routes are
 * hierarchical (`/folders/{id}/shares/{shareId}/…`), so honoring
 * both path segments is the contract callers expect.
 *
 * @param WP_REST_Request $req Request.
 * @return array|WP_Error
 */
function openstation_files_rest_resolve_share_in_folder( WP_REST_Request $req ) {
	$folder_id = (int) $req['id'];
	$share_id  = (int) $req['shareId'];
	$share     = openstation_files_get_share( $share_id );
	if ( ! $share ) {
		return new WP_Error(
			'openstation_files_not_found',
			__( 'Share not found.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}
	if ( (int) $share['folder_id'] !== $folder_id ) {
		return new WP_Error(
			'openstation_files_not_found',
			__( 'Share not found in this folder.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}
	return $share;
}

/**
 * PATCH /folders/<id>/shares/<shareId> — owner only.
 */
function openstation_files_rest_update_share( WP_REST_Request $req ) {
	$share = openstation_files_rest_resolve_share_in_folder( $req );
	if ( is_wp_error( $share ) ) {
		return $share;
	}
	$share_id = (int) $share['id'];
	$ok       = openstation_folder_share_update_capability( $share_id, get_current_user_id(), (string) $req->get_param( 'capability' ) );
	if ( is_wp_error( $ok ) ) {
		return $ok;
	}
	return rest_ensure_response( openstation_files_shape_share( openstation_files_get_share( $share_id ) ) );
}

/**
 * DELETE /folders/<id>/shares/<shareId> — owner only.
 */
function openstation_files_rest_delete_share( WP_REST_Request $req ) {
	$share = openstation_files_rest_resolve_share_in_folder( $req );
	if ( is_wp_error( $share ) ) {
		return $share;
	}
	$ok = openstation_folder_share_revoke( (int) $share['id'], get_current_user_id() );
	if ( is_wp_error( $ok ) ) {
		return $ok;
	}
	return rest_ensure_response( array( 'deleted' => true ) );
}

/**
 * POST /folders/<id>/shares/<shareId>/accept — recipient only.
 */
function openstation_files_rest_accept_share( WP_REST_Request $req ) {
	$share = openstation_files_rest_resolve_share_in_folder( $req );
	if ( is_wp_error( $share ) ) {
		return $share;
	}
	$row = openstation_folder_share_accept( (int) $share['id'], get_current_user_id() );
	if ( is_wp_error( $row ) ) {
		return $row;
	}
	return rest_ensure_response( openstation_files_shape_share( $row ) );
}

/**
 * POST /folders/<id>/shares/<shareId>/deny — recipient only.
 */
function openstation_files_rest_deny_share( WP_REST_Request $req ) {
	$share = openstation_files_rest_resolve_share_in_folder( $req );
	if ( is_wp_error( $share ) ) {
		return $share;
	}
	$row = openstation_folder_share_deny( (int) $share['id'], get_current_user_id() );
	if ( is_wp_error( $row ) ) {
		return $row;
	}
	return rest_ensure_response( openstation_files_shape_share( $row ) );
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
function openstation_files_rest_leave_folder( WP_REST_Request $req ) {
	$folder_id = (int) $req['id'];
	$ok        = openstation_folder_share_leave( $folder_id, get_current_user_id() );
	if ( is_wp_error( $ok ) ) {
		return $ok;
	}
	return rest_ensure_response( array( 'left' => true ) );
}

/**
 * POST /files/folder-sharing-tables/purge — destructive cleanup
 * that drops every table the folder-sharing feature ever created
 * (current `folder_shares` + `share_user_decisions`, plus any
 * future variants enumerated via the
 * `openstation_files_sharing_tables_for_purge` filter).
 *
 * Restricted to `manage_options` by the permission callback. The
 * schema-version option is cleared so the next admin-init runs
 * `install_schema` and recreates the empty tables — keeps the
 * code path that ASSUMES the tables exist (e.g. heartbeat
 * delivery queries) working even after a purge.
 */
function openstation_files_rest_purge_sharing_tables() {
	global $wpdb;
	$tables = openstation_files_table_names();

	$to_drop = array( $tables['shares'], $tables['decisions'] );
	/**
	 * Filter the list of table names dropped by the
	 * "Delete folder sharing data" admin action.
	 *
	 * @param string[] $tables Default = shares + decisions.
	 */
	$to_drop = (array) apply_filters( 'openstation_files_sharing_tables_for_purge', $to_drop );

	$dropped = array();
	$skipped = array();
	$prefix  = (string) $wpdb->prefix;
	foreach ( $to_drop as $tbl ) {
		$tbl = (string) $tbl;
		if ( '' === $tbl ) {
			continue;
		}
		// Defense-in-depth: a misbehaving filter could push any
		// string into `$to_drop` and we're about to interpolate
		// the value directly into a `DROP TABLE` statement (wpdb
		// has no placeholder for identifiers). Two gates:
		// 1. Must match the `[A-Za-z0-9_]+` identifier pattern —
		// keeps quotes/backticks/spaces out of the SQL even
		// if a filter author smuggled them in.
		// 2. Must start with the wpdb prefix — keeps a malicious
		// filter from dropping system tables (`wp_users`,
		// `wp_options`, …) on a multi-prefix install.
		if (
			! preg_match( '/^[A-Za-z0-9_]+$/', $tbl ) ||
			0 !== strpos( $tbl, $prefix )
		) {
			$skipped[] = $tbl;
			continue;
		}
		$prev_suppress = $wpdb->suppress_errors( true );
		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$wpdb->query( "DROP TABLE IF EXISTS `{$tbl}`" );
		$wpdb->suppress_errors( $prev_suppress );
		$dropped[] = $tbl;
	}

	// Force the next admin-init / rest-init to re-run
	// `install_schema` so the tables are recreated empty. Code
	// paths that JOIN against them (heartbeat, sharing.php
	// visibility) keep working without a per-request existence
	// check.
	delete_option( OPENSTATION_FILES_SCHEMA_OPTION );

	/**
	 * Fires after the folder-sharing tables are purged. Plugins
	 * that mirror share state into their own storage can react
	 * here.
	 *
	 * @param string[] $dropped Table names that were dropped.
	 */
	do_action( 'openstation_files_sharing_tables_purged', $dropped );

	return rest_ensure_response(
		array(
			'dropped' => $dropped,
			'skipped' => $skipped,
		)
	);
}

/**
 * Permission gate for /users/search. Requires `edit_posts` —
 * `openstation_files_rest_permission` would let any logged-in
 * openstation user pull the directory, which is too broad for an
 * autocomplete that exposes display names + emails.
 */
function openstation_files_rest_search_users_permission() {
	$base = openstation_files_rest_permission();
	if ( is_wp_error( $base ) ) {
		return $base;
	}
	if ( ! current_user_can( 'edit_posts' ) ) {
		return new WP_Error( 'openstation_files_forbidden', __( 'You cannot search users.', 'desktop-mode' ), array( 'status' => 403 ) );
	}
	return true;
}

/**
 * GET /files/users/search?q=<>&exclude=<csv> — autocomplete for the
 * folder share picker.
 */
function openstation_files_rest_search_users( WP_REST_Request $req ) {
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
	 * @param array $args Default args.
	 * @param array $req  Request params (`q`, `exclude`).
	 */
	$args = (array) apply_filters( 'openstation_files_share_user_query_args', $args, $req->get_params() );

	$query = new WP_User_Query( $args );
	$users = $query->get_results();
	$out   = array();
	foreach ( (array) $users as $user ) {
		if ( ! user_can( $user, 'edit_posts' ) ) {
			continue;
		}
		// Disambiguation handle uses `user_nicename` (the public
		// URL slug) instead of `user_login` — the login is the auth
		// credential and exposing it to every `edit_posts` user is
		// broader than needed for a share picker. Matches the
		// `slug` field WP's own `/wp/v2/users` endpoint surfaces.
		$out[] = array(
			'id'        => (int) $user->ID,
			'name'      => (string) $user->display_name,
			'slug'      => (string) $user->user_nicename,
			'avatarUrl' => get_avatar_url( $user->ID, array( 'size' => 48 ) ),
		);
	}
	return rest_ensure_response( array( 'users' => $out ) );
}
