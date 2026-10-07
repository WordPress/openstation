<?php

defined( 'ABSPATH' ) || exit;

function openstation_stored_files_denied_extensions() {
	$denied = array(
		'php',
		'php3',
		'php4',
		'php5',
		'php7',
		'php8',
		'phtml',
		'phar',
		'pht',
		'phps',
		'cgi',
		'pl',
		'asp',
		'aspx',
		'jsp',
		'shtml',
	);

	return (array) apply_filters( 'openstation_stored_files_denied_extensions', $denied );
}

function openstation_stored_files_is_denied_filename( $name ) {
	$name = strtolower( trim( (string) $name ) );
	if ( in_array( $name, array( '.htaccess', '.user.ini', 'web.config' ), true ) ) {
		return true;
	}
	$segments = explode( '.', $name );
	array_shift( $segments );
	$denied = openstation_stored_files_denied_extensions();
	foreach ( $segments as $segment ) {
		if ( in_array( $segment, $denied, true ) ) {
			return true;
		}
	}
	return false;
}

function openstation_stored_files_max_upload_bytes( $user_id ) {
	$max = (int) wp_max_upload_size();

	return max( 0, (int) apply_filters( 'openstation_stored_files_max_upload_bytes', $max, (int) $user_id ) );
}

function openstation_files_rest_uploads_permission() {
	$base = openstation_files_rest_permission();
	if ( is_wp_error( $base ) ) {
		return $base;
	}
	if ( ! current_user_can( openstation_stored_files_upload_capability() ) ) {
		return new WP_Error(
			'openstation_stored_files_cannot_upload',
			__( 'You are not allowed to upload files.', 'desktop-mode' ),
			array( 'status' => 403 )
		);
	}
	return true;
}

function openstation_files_register_upload_rest_routes() {
	register_rest_route(
		'desktop-mode/v1',
		'/files/uploads',
		array(

			'methods'             => WP_REST_Server::CREATABLE,
			'permission_callback' => 'openstation_files_rest_uploads_permission',
			'callback'            => 'openstation_files_rest_upload',
			'args'                => array(
				'parentId'     => array(
					'type'              => 'integer',
					'default'           => 0,
					'sanitize_callback' => 'absint',
				),
				'relativePath' => array(
					'type'    => 'string',
					'default' => '',
				),

				'x'            => array(
					'type'     => 'integer',
					'required' => false,
				),
				'y'            => array(
					'type'     => 'integer',
					'required' => false,
				),
			),
		)
	);

	register_rest_route(
		'desktop-mode/v1',
		'/files/uploads/paths',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'permission_callback' => 'openstation_files_rest_uploads_permission',
			'callback'            => 'openstation_files_rest_ensure_upload_path',
			'args'                => array(
				'parentId'     => array(
					'type'              => 'integer',
					'default'           => 0,
					'sanitize_callback' => 'absint',
				),
				'relativePath' => array(
					'type'     => 'string',
					'required' => true,
				),
			),
		)
	);

	register_rest_route(
		'desktop-mode/v1',
		'/files/uploads/(?P<id>\d+)',
		array(
			'methods'             => WP_REST_Server::EDITABLE,
			'permission_callback' => 'openstation_files_rest_permission',
			'callback'            => 'openstation_files_rest_rename_upload',
			'args'                => array(
				'name' => array(
					'type'     => 'string',
					'required' => true,
				),
			),
		)
	);
}

function openstation_files_rest_ensure_upload_path( WP_REST_Request $req ) {
	$rel = (string) $req->get_param( 'relativePath' );
	if ( '' === trim( $rel, " \t/" ) ) {
		return new WP_Error( 'openstation_stored_files_bad_path', __( 'Invalid path.', 'desktop-mode' ), array( 'status' => 400 ) );
	}
	if ( '/' !== substr( $rel, -1 ) ) {
		$rel .= '/';
	}
	$created   = array();
	$folder_id = openstation_files_resolve_relative_path(
		get_current_user_id(),
		(int) $req->get_param( 'parentId' ),
		$rel,
		$created
	);
	if ( is_wp_error( $folder_id ) ) {
		return $folder_id;
	}
	return rest_ensure_response(
		array(
			'folderId'       => (int) $folder_id,
			'createdFolders' => openstation_files_shape_created_folders( $created ),
		)
	);
}

function openstation_files_rest_rename_upload( WP_REST_Request $req ) {
	$file_id = (int) $req['id'];
	$user_id = get_current_user_id();
	$row     = openstation_stored_files_get( $file_id );
	if ( ! $row || (int) $row['owner_id'] !== $user_id ) {
		return openstation_files_download_not_found();
	}
	$ok = openstation_stored_files_rename( $file_id, (string) $req->get_param( 'name' ) );
	if ( is_wp_error( $ok ) ) {
		return $ok;
	}
	$row = openstation_stored_files_get( $file_id );
	return rest_ensure_response(
		array(
			'id'        => (int) $row['id'],
			'name'      => (string) $row['display_name'],
			'sizeBytes' => (int) $row['size_bytes'],
			'mime'      => (string) $row['mime'],
		)
	);
}
add_action( 'rest_api_init', 'openstation_files_register_upload_rest_routes' );

function openstation_files_rest_upload( WP_REST_Request $req ) {
	$user_id = get_current_user_id();
	$files   = $req->get_file_params();

	if ( empty( $files ) ) {
		$content_length = isset( $_SERVER['CONTENT_LENGTH'] ) ? (int) $_SERVER['CONTENT_LENGTH'] : 0;
		if ( $content_length > 0 ) {
			return new WP_Error(
				'openstation_stored_files_too_large',
				__( 'That file is larger than this server accepts.', 'desktop-mode' ),
				array( 'status' => 413 )
			);
		}
		return new WP_Error(
			'openstation_stored_files_no_file',
			__( 'No file was uploaded.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}
	if ( empty( $files['file'] ) || ! is_array( $files['file'] ) ) {
		return new WP_Error(
			'openstation_stored_files_no_file',
			__( 'No file was uploaded.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}

	$received = openstation_files_upload_receive( $files['file'], $user_id );
	if ( is_wp_error( $received ) ) {
		return $received;
	}

	$x      = $req->get_param( 'x' );
	$y      = $req->get_param( 'y' );
	$coords = ( null !== $x && null !== $y )
		? array(
			'x' => (int) $x,
			'y' => (int) $y,
		)
		: null;

	$registered = openstation_files_upload_register(
		$user_id,
		$received,
		(int) $req->get_param( 'parentId' ),
		(string) $req->get_param( 'relativePath' ),
		$coords
	);
	if ( is_wp_error( $registered ) ) {

		if ( ! empty( $received['path'] ) && file_exists( $received['path'] ) ) {
			wp_delete_file( $received['path'] );
		}
		return $registered;
	}

	$row = openstation_files_get_placement( $registered['placement_id'] );
	return rest_ensure_response(
		array(
			'placement'      => openstation_files_shape_placement( $row ),
			'storedFileId'   => (int) $registered['file_id'],
			'createdFolders' => openstation_files_shape_created_folders( $registered['created_folders'] ),
		)
	);
}

function openstation_files_shape_created_folders( $created ) {
	$out = array();
	foreach ( (array) $created as $entry ) {
		if ( empty( $entry['folder_id'] ) || empty( $entry['placement_id'] ) ) {
			continue;
		}
		$folder    = openstation_files_get_folder( (int) $entry['folder_id'] );
		$placement = openstation_files_get_placement( (int) $entry['placement_id'] );
		if ( ! $folder || ! $placement ) {
			continue;
		}
		$out[] = array(
			'folder'    => openstation_files_shape_folder( $folder ),
			'placement' => openstation_files_shape_placement( $placement ),
		);
	}
	return $out;
}

function openstation_files_upload_receive( $file, $user_id ) {
	$user_id     = (int) $user_id;
	$client_name = isset( $file['name'] ) ? (string) $file['name'] : '';

	if ( openstation_stored_files_is_denied_filename( $client_name ) ) {
		return new WP_Error(
			'openstation_stored_files_forbidden_type',
			__( 'This file type is not allowed.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}

	$size = isset( $file['size'] ) ? (int) $file['size'] : 0;
	$max  = openstation_stored_files_max_upload_bytes( $user_id );
	if ( $max > 0 && $size > $max ) {
		return new WP_Error(
			'openstation_stored_files_too_large',
			sprintf(

				__( 'That file is larger than the allowed maximum of %s.', 'desktop-mode' ),
				size_format( $max )
			),
			array( 'status' => 413 )
		);
	}

	$quota = openstation_stored_files_user_quota_bytes( $user_id );
	if ( $quota > 0 && ( openstation_stored_files_total_bytes( $user_id ) + $size ) > $quota ) {
		return new WP_Error(
			'openstation_stored_files_quota_exceeded',
			__( 'Your desktop storage is full.', 'desktop-mode' ),
			array( 'status' => 403 )
		);
	}

	$dir = openstation_stored_files_ensure_dir( $user_id );
	if ( is_wp_error( $dir ) ) {
		return $dir;
	}

	require_once ABSPATH . 'wp-admin/includes/file.php';

	$mimes = (array) apply_filters(
		'openstation_stored_files_allowed_mimes',
		get_allowed_mime_types( $user_id ),
		$user_id
	);

	$disk_name   = wp_generate_uuid4();
	$scoped_mime = static function () use ( $mimes ) {
		return $mimes;
	};
	$name_cb     = static function ( $dir_unused, $name_unused, $ext_unused ) use ( $disk_name ) {
		return $disk_name;
	};

	$target_base = openstation_stored_files_dir();
	$target_dir  = openstation_stored_files_dir( $user_id );
	$redirect    = static function ( $dirs ) use ( $user_id, $target_base, $target_dir ) {
		$dirs['subdir']  = '/' . $user_id;
		$dirs['path']    = $target_dir;
		$dirs['url']     = $dirs['baseurl'] . '/desktop-mode-files/' . $user_id;
		$dirs['basedir'] = $target_base;
		$dirs['baseurl'] = $dirs['baseurl'] . '/desktop-mode-files';
		return $dirs;
	};

	$overrides = (array) apply_filters(
		'openstation_stored_files_upload_overrides',
		array(
			'test_form'                => false,
			'mimes'                    => $mimes,
			'unique_filename_callback' => $name_cb,
		),
		$user_id
	);

	add_filter( 'upload_dir', $redirect );
	add_filter( 'upload_mimes', $scoped_mime );
	$result = wp_handle_upload( $file, $overrides );
	remove_filter( 'upload_mimes', $scoped_mime );
	remove_filter( 'upload_dir', $redirect );

	if ( isset( $result['error'] ) ) {
		return new WP_Error(
			'openstation_stored_files_upload_failed',
			(string) $result['error'],
			array( 'status' => 400 )
		);
	}

	$path = (string) $result['file'];
	return array(
		'path'         => $path,
		'disk_name'    => $disk_name,
		'display_name' => sanitize_file_name( $client_name ),
		'size_bytes'   => (int) @filesize( $path ),
		'mime'         => (string) $result['type'],
	);
}

function openstation_files_upload_register( $user_id, $received, $parent_id, $relative_path = '', $coords = null ) {
	$parent_id = max( 0, (int) $parent_id );
	$created   = array();

	if ( '' !== (string) $relative_path ) {
		$resolved = openstation_files_resolve_relative_path( (int) $user_id, $parent_id, (string) $relative_path, $created );
		if ( is_wp_error( $resolved ) ) {
			return $resolved;
		}
		$parent_id = $resolved;
	}

	$file_id = openstation_stored_files_create(
		(int) $user_id,
		array(
			'display_name' => $received['display_name'],
			'disk_name'    => $received['disk_name'],
			'size_bytes'   => $received['size_bytes'],
			'mime'         => $received['mime'],
		)
	);
	if ( is_wp_error( $file_id ) ) {
		return $file_id;
	}

	if ( is_array( $coords ) && isset( $coords['x'], $coords['y'] ) ) {
		$placement_id = openstation_files_place(
			(int) $user_id,
			$parent_id,
			'upload',
			(string) $file_id,
			array(
				'x' => (int) $coords['x'],
				'y' => (int) $coords['y'],
			)
		);
	} else {

		$placement_id = openstation_files_place_at_next_free_slot(
			(int) $user_id,
			$parent_id,
			'upload',
			(string) $file_id
		);
	}
	if ( is_wp_error( $placement_id ) ) {

		openstation_stored_files_delete( (int) $file_id );
		return $placement_id;
	}

	do_action( 'openstation_stored_file_uploaded', (int) $file_id, (int) $placement_id, (int) $user_id );

	return array(
		'file_id'         => (int) $file_id,
		'placement_id'    => (int) $placement_id,
		'created_folders' => $created,
	);
}

function openstation_files_resolve_relative_path( $user_id, $base_parent_id, $relative_path, &$created = null ) {
	global $wpdb;
	$user_id   = (int) $user_id;
	$parent_id = max( 0, (int) $base_parent_id );
	$path      = str_replace( '\\', '/', (string) $relative_path );

	if ( false !== strpos( $path, "\0" ) ) {
		return new WP_Error( 'openstation_stored_files_bad_path', __( 'Invalid path.', 'desktop-mode' ), array( 'status' => 400 ) );
	}

	$is_dir_path = '/' === substr( $path, -1 );
	$segments    = array_values( array_filter( explode( '/', $path ), 'strlen' ) );
	if ( ! $is_dir_path ) {
		array_pop( $segments );
	}
	if ( empty( $segments ) ) {
		return $parent_id;
	}
	if ( count( $segments ) > 32 ) {
		return new WP_Error( 'openstation_stored_files_path_too_deep', __( 'That folder tree is nested too deeply.', 'desktop-mode' ), array( 'status' => 400 ) );
	}

	$tables = openstation_files_table_names();
	foreach ( $segments as $segment ) {
		if ( '.' === $segment || '..' === $segment ) {
			return new WP_Error( 'openstation_stored_files_bad_path', __( 'Invalid path.', 'desktop-mode' ), array( 'status' => 400 ) );
		}
		$name = sanitize_file_name( wp_strip_all_tags( $segment ) );
		if ( '' === $name ) {
			return new WP_Error( 'openstation_stored_files_bad_path', __( 'Invalid path.', 'desktop-mode' ), array( 'status' => 400 ) );
		}

		$existing = $wpdb->get_var(
			$wpdb->prepare(
				"SELECT f.id FROM {$tables['folders']} f
				INNER JOIN {$tables['placements']} p
					ON p.file_type = 'folder'
					AND p.file_ref = CAST( f.id AS CHAR )
					AND p.trashed_at_ms IS NULL
				WHERE p.parent_id = %d
					AND p.owner_id = %d
					AND f.owner_id = %d
					AND f.trashed_at_ms IS NULL
					AND f.name = %s
				LIMIT 1",
				$parent_id,
				$user_id,
				$user_id,
				$name
			)
		);
		if ( $existing ) {
			$parent_id = (int) $existing;
			continue;
		}

		$folder_id = openstation_files_create_folder( $user_id, array( 'name' => $name ) );
		if ( is_wp_error( $folder_id ) ) {
			return $folder_id;
		}

		$placement = openstation_files_place_at_next_free_slot( $user_id, $parent_id, 'folder', (string) $folder_id );
		if ( is_wp_error( $placement ) ) {
			return $placement;
		}
		if ( is_array( $created ) ) {
			$created[] = array(
				'folder_id'    => (int) $folder_id,
				'placement_id' => (int) $placement,
			);
		}
		$parent_id = (int) $folder_id;
	}
	return $parent_id;
}

function openstation_stored_files_inject_shell_config( $config ) {
	$user_id                  = get_current_user_id();
	$config['desktopStorage'] = array(
		'canUpload'    => $user_id > 0 && current_user_can( openstation_stored_files_upload_capability() ),
		'maxBytes'     => openstation_stored_files_max_upload_bytes( $user_id ),
		'quotaBytes'   => openstation_stored_files_user_quota_bytes( $user_id ),
		'zipAvailable' => class_exists( 'ZipArchive' ),
	);
	return $config;
}
add_filter( 'openstation_shell_config', 'openstation_stored_files_inject_shell_config', 20 );
