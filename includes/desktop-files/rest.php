<?php

defined( 'ABSPATH' ) || exit;

function openstation_files_rest_permission() {
	if ( ! is_user_logged_in() ) {
		return new WP_Error( 'openstation_files_unauthenticated', __( 'You must be logged in.', 'desktop-mode' ), array( 'status' => 401 ) );
	}
	if ( function_exists( 'openstation_is_enabled' ) && ! openstation_is_enabled( get_current_user_id() ) ) {
		return new WP_Error( 'openstation_files_disabled', __( 'OpenStation is not enabled for this user.', 'desktop-mode' ), array( 'status' => 403 ) );
	}
	return true;
}

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

function openstation_files_rest_list_placements( WP_REST_Request $req ) {
	$user_id   = get_current_user_id();
	$parent_id = (int) $req->get_param( 'folder' );

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

function openstation_files_rest_create_placement( WP_REST_Request $req ) {
	$type = (string) $req->get_param( 'type' );
	$ref  = (string) $req->get_param( 'ref' );
	$meta = $req->get_param( 'meta' );

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

function openstation_files_rest_delete_placement( WP_REST_Request $req ) {
	$id      = (int) $req['id'];
	$user_id = get_current_user_id();

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

function openstation_files_rest_list_folders() {
	$rows = openstation_files_get_visible_folders( get_current_user_id() );
	$out  = array();
	foreach ( $rows as $row ) {
		$out[] = openstation_files_shape_folder( $row );
	}
	return rest_ensure_response( array( 'folders' => $out ) );
}

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

function openstation_files_rest_delete_folder( WP_REST_Request $req ) {
	$id      = (int) $req['id'];
	$user_id = get_current_user_id();
	$force   = '1' === (string) $req->get_param( 'force' )
		|| true === $req->get_param( 'force' );

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

function openstation_files_shape_placement( $row ) {
	if ( ! is_array( $row ) ) {
		return array();
	}

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

		'accessGated' => $access_gated,
		'canTrash'    => $can_trash,
	);
}

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

	if ( function_exists( 'openstation_files_folder_share_summary' ) ) {
		$shape['shareSummary'] = openstation_files_folder_share_summary( $row );
	}
	return $shape;
}

function openstation_files_check_if_match( $current_ms, WP_REST_Request $req, $row ) {
	$header = $req->get_header( 'if_match' );
	if ( null === $header || '' === $header ) {
		return null;
	}
	$expected = (int) trim( str_replace( '"', '', (string) $header ) );
	if ( $expected === (int) $current_ms ) {
		return null;
	}

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
		'name'   => $viewer_can_see && $actor ? openstation_plain_text_title( $actor->display_name ) : '',
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
		$shape['displayName'] = $user ? openstation_plain_text_title( $user->display_name ) : '';
		$shape['avatarUrl']   = $user ? get_avatar_url( $uid, array( 'size' => 48 ) ) : '';
	} else {
		$roles                = wp_roles();
		$info                 = $roles && isset( $roles->roles[ $row['principal_ref'] ] ) ? $roles->roles[ $row['principal_ref'] ] : null;
		$shape['displayName'] = $info ? translate_user_role( (string) $info['name'] ) : (string) $row['principal_ref'];
		$shape['avatarUrl']   = '';
	}
	return $shape;
}

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

function openstation_files_rest_leave_folder( WP_REST_Request $req ) {
	$folder_id = (int) $req['id'];
	$ok        = openstation_folder_share_leave( $folder_id, get_current_user_id() );
	if ( is_wp_error( $ok ) ) {
		return $ok;
	}
	return rest_ensure_response( array( 'left' => true ) );
}

function openstation_files_rest_purge_sharing_tables() {
	global $wpdb;
	$tables = openstation_files_table_names();

	$to_drop = array( $tables['shares'], $tables['decisions'] );

	$to_drop = (array) apply_filters( 'openstation_files_sharing_tables_for_purge', $to_drop );

	$dropped = array();
	$skipped = array();
	$prefix  = (string) $wpdb->prefix;
	foreach ( $to_drop as $tbl ) {
		$tbl = (string) $tbl;
		if ( '' === $tbl ) {
			continue;
		}

		if (
			! preg_match( '/^[A-Za-z0-9_]+$/', $tbl ) ||
			0 !== strpos( $tbl, $prefix )
		) {
			$skipped[] = $tbl;
			continue;
		}
		$prev_suppress = $wpdb->suppress_errors( true );

		$wpdb->query( "DROP TABLE IF EXISTS `{$tbl}`" );
		$wpdb->suppress_errors( $prev_suppress );
		$dropped[] = $tbl;
	}

	delete_option( OPENSTATION_FILES_SCHEMA_OPTION );

	do_action( 'openstation_files_sharing_tables_purged', $dropped );

	return rest_ensure_response(
		array(
			'dropped' => $dropped,
			'skipped' => $skipped,
		)
	);
}

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

function openstation_files_rest_search_users( WP_REST_Request $req ) {
	$q       = trim( (string) $req->get_param( 'q' ) );
	$exclude = array_filter( array_map( 'intval', explode( ',', (string) $req->get_param( 'exclude' ) ) ) );

	$exclude[] = (int) get_current_user_id();
	$exclude   = array_values( array_unique( array_filter( $exclude ) ) );

	$args = array(
		'number'     => 20,
		'orderby'    => 'display_name',
		'order'      => 'ASC',
		'exclude'    => $exclude,
		'capability' => 'edit_posts',
		'meta_query' => array(
			array(
				'key'     => OPENSTATION_AGENT_USER_MARKER_META,
				'compare' => 'NOT EXISTS',
			),
		),

		'fields'     => 'all',
	);
	if ( '' !== $q ) {
		$args['search']         = '*' . $q . '*';
		$args['search_columns'] = array( 'user_login', 'user_email', 'display_name', 'user_nicename' );
	}

	$args = (array) apply_filters( 'openstation_files_share_user_query_args', $args, $req->get_params() );

	$query = new WP_User_Query( $args );
	$users = $query->get_results();
	$out   = array();
	foreach ( (array) $users as $user ) {
		if ( ! openstation_files_share_user_is_eligible( $user ) ) {
			continue;
		}

		$out[] = array(
			'id'        => (int) $user->ID,
			'name'      => openstation_plain_text_title( $user->display_name ),
			'slug'      => (string) $user->user_nicename,
			'avatarUrl' => get_avatar_url( $user->ID, array( 'size' => 48 ) ),
		);
	}
	return rest_ensure_response( array( 'users' => $out ) );
}
