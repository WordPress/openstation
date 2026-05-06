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
	$id = desktop_mode_files_place(
		get_current_user_id(),
		(int) $req->get_param( 'parentId' ),
		(string) $req->get_param( 'type' ),
		(string) $req->get_param( 'ref' ),
		array(
			'x'          => (int) $req->get_param( 'x' ),
			'y'          => (int) $req->get_param( 'y' ),
			'sort_order' => (int) $req->get_param( 'sortOrder' ),
			'meta'       => $req->get_param( 'meta' ),
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
	$ok = desktop_mode_files_remove( (int) $req['id'], get_current_user_id() );
	if ( is_wp_error( $ok ) ) {
		return $ok;
	}
	return rest_ensure_response( array( 'deleted' => true ) );
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
	$ok = desktop_mode_files_delete_folder( (int) $req['id'], get_current_user_id() );
	if ( is_wp_error( $ok ) ) {
		return $ok;
	}
	return rest_ensure_response( array( 'deleted' => true ) );
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
	return array(
		'id'           => (int) $row['id'],
		'parentId'     => (int) $row['parent_id'],
		'x'            => (int) $row['x'],
		'y'            => (int) $row['y'],
		'sortOrder'    => (int) $row['sort_order'],
		'updatedAtMs'  => (int) $row['updated_at_ms'],
		'meta'         => isset( $row['meta'] ) ? $row['meta'] : null,
		'file'         => $shape,
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
	return array(
		'id'           => (int) $row['id'],
		'ownerId'      => (int) $row['owner_id'],
		'name'         => (string) $row['name'],
		'shareMode'    => (string) $row['share_mode'],
		'shareMeta'    => isset( $row['share_meta'] ) ? $row['share_meta'] : null,
		'updatedAtMs'  => (int) $row['updated_at_ms'],
	);
}
