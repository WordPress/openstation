<?php

defined( 'ABSPATH' ) || exit;

function openstation_files_register_download_rest_routes() {
	$ns = 'desktop-mode/v1';
	register_rest_route(
		$ns,
		'/files/uploads/(?P<id>\d+)/download',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'permission_callback' => 'openstation_files_rest_permission',
			'callback'            => 'openstation_files_rest_download_file',
		)
	);
	register_rest_route(
		$ns,
		'/files/folders/(?P<id>\d+)/download',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'permission_callback' => 'openstation_files_rest_permission',
			'callback'            => 'openstation_files_rest_download_folder_zip',
		)
	);
}
add_action( 'rest_api_init', 'openstation_files_register_download_rest_routes' );

function openstation_files_download_not_found() {
	return new WP_Error(
		'openstation_files_not_found',
		__( 'File not found.', 'desktop-mode' ),
		array( 'status' => 404 )
	);
}

function openstation_files_rest_download_file( WP_REST_Request $req ) {
	$file_id = (int) $req['id'];
	$user_id = get_current_user_id();
	$row     = openstation_stored_files_get( $file_id );
	if ( ! $row || ! openstation_stored_file_user_can_read( $file_id, $user_id ) ) {
		return openstation_files_download_not_found();
	}
	$path = openstation_stored_file_path( $row );
	if ( ! $path || ! file_exists( $path ) ) {
		return openstation_files_download_not_found();
	}

	do_action( 'openstation_stored_file_downloaded', $file_id, $user_id );

	return openstation_files_download_stream_response(
		$path,
		$row['display_name'],
		$row['mime'],
		false
	);
}

function openstation_files_rest_download_folder_zip( WP_REST_Request $req ) {
	$folder_id = (int) $req['id'];
	$user_id   = get_current_user_id();
	$folder    = openstation_files_get_folder( $folder_id );
	if ( ! $folder ) {
		return openstation_files_download_not_found();
	}
	$is_owner = (int) $folder['owner_id'] === $user_id;
	if ( ! $is_owner ) {
		$cap = function_exists( 'openstation_folder_share_user_capability' )
			? openstation_folder_share_user_capability( $folder_id, $user_id )
			: 'none';
		if ( 'none' === $cap ) {
			return openstation_files_download_not_found();
		}
	}
	if ( ! class_exists( 'ZipArchive' ) ) {
		return new WP_Error(
			'openstation_stored_files_no_zip',
			__( 'Folder download requires the PHP zip extension.', 'desktop-mode' ),
			array( 'status' => 501 )
		);
	}

	$manifest = array(
		'entries'     => array(),
		'empty_dirs'  => array(),
		'total_bytes' => 0,
	);
	$result   = openstation_files_collect_zip_entries( $folder_id, $user_id, '', $manifest, array( $folder_id => true ), 0 );
	if ( is_wp_error( $result ) ) {
		return $result;
	}
	$manifest = $result;

	require_once ABSPATH . 'wp-admin/includes/file.php';
	$tmp = wp_tempnam( 'os-folder-zip' );
	if ( ! $tmp ) {
		return new WP_Error( 'openstation_stored_files_zip_failed', __( 'Could not create the archive.', 'desktop-mode' ), array( 'status' => 500 ) );
	}

	register_shutdown_function( 'wp_delete_file', $tmp );

	$zip = new ZipArchive();
	if ( true !== $zip->open( $tmp, ZipArchive::OVERWRITE ) ) {
		wp_delete_file( $tmp );
		return new WP_Error( 'openstation_stored_files_zip_failed', __( 'Could not create the archive.', 'desktop-mode' ), array( 'status' => 500 ) );
	}
	foreach ( $manifest['empty_dirs'] as $dir_entry ) {
		$zip->addEmptyDir( $dir_entry );
	}
	foreach ( $manifest['entries'] as $entry_name => $abs_path ) {
		$zip->addFile( $abs_path, $entry_name );
		if ( method_exists( $zip, 'setCompressionName' ) ) {

			if ( preg_match( '/\.(zip|gz|bz2|7z|rar|jpe?g|png|gif|webp|avif|mp3|mp4|m4a|mov|webm|ogg|pdf)$/i', $entry_name ) ) {
				$zip->setCompressionName( $entry_name, ZipArchive::CM_STORE );
			}
		}
	}

	$is_empty = 0 === $zip->numFiles;
	if ( ! $zip->close() ) {
		wp_delete_file( $tmp );
		return new WP_Error( 'openstation_stored_files_zip_failed', __( 'Could not finish the archive (disk full?).', 'desktop-mode' ), array( 'status' => 500 ) );
	}
	if ( $is_empty ) {

		file_put_contents( $tmp, "PK\x05\x06" . str_repeat( "\0", 18 ) );
	}

	do_action( 'openstation_folder_zip_downloaded', $folder_id, $user_id, count( $manifest['entries'] ) );

	$zip_name = sanitize_file_name( '' !== (string) $folder['name'] ? (string) $folder['name'] : 'folder' ) . '.zip';
	return openstation_files_download_stream_response( $tmp, $zip_name, 'application/zip', true );
}

function openstation_files_collect_zip_entries( $folder_id, $user_id, $prefix, $manifest, $visited, $depth ) {
	if ( $depth > 32 ) {
		return $manifest;
	}

	$caps = (array) apply_filters(
		'openstation_stored_files_zip_caps',
		array(
			'max_entries' => 1000,
			'max_bytes'   => 500 * MB_IN_BYTES,
		)
	);

	$rows       = openstation_files_get_for_user_folder( $user_id, $folder_id );
	$used_names = array();
	$had_child  = false;

	foreach ( $rows as $row ) {
		if ( 'folder' === $row['file_type'] ) {
			$sub_id = (int) $row['file_ref'];
			if ( $sub_id <= 0 || isset( $visited[ $sub_id ] ) ) {
				continue;
			}
			$sub = openstation_files_get_folder( $sub_id );
			if ( ! $sub ) {
				continue;
			}
			$dir_name           = openstation_files_zip_unique_name(
				sanitize_file_name( '' !== (string) $sub['name'] ? (string) $sub['name'] : 'folder' ),
				$used_names
			);
			$had_child          = true;
			$visited[ $sub_id ] = true;
			$before             = count( $manifest['entries'] ) + count( $manifest['empty_dirs'] );
			$manifest           = openstation_files_collect_zip_entries( $sub_id, $user_id, $prefix . $dir_name . '/', $manifest, $visited, $depth + 1 );
			if ( is_wp_error( $manifest ) ) {
				return $manifest;
			}
			if ( count( $manifest['entries'] ) + count( $manifest['empty_dirs'] ) === $before ) {

				$manifest['empty_dirs'][] = $prefix . $dir_name . '/';
			}
			continue;
		}
		if ( 'upload' !== $row['file_type'] ) {
			continue;
		}
		$file_id = (int) $row['file_ref'];
		$file    = openstation_stored_files_get( $file_id );
		if ( ! $file || ! openstation_stored_file_user_can_read( $file_id, $user_id ) ) {
			continue;
		}
		$path = openstation_stored_file_path( $file );
		if ( ! $path || ! file_exists( $path ) ) {
			continue;
		}
		$had_child  = true;
		$entry_name = openstation_files_zip_unique_name(
			sanitize_file_name( '' !== $file['display_name'] ? $file['display_name'] : 'file' ),
			$used_names
		);

		$manifest['total_bytes'] += (int) $file['size_bytes'];
		if ( count( $manifest['entries'] ) + 1 > (int) $caps['max_entries'] ) {
			return new WP_Error(
				'openstation_stored_files_zip_too_big',
				__( 'This folder has too many files to download as one archive.', 'desktop-mode' ),
				array( 'status' => 400 )
			);
		}
		if ( (int) $caps['max_bytes'] > 0 && $manifest['total_bytes'] > (int) $caps['max_bytes'] ) {
			return new WP_Error(
				'openstation_stored_files_zip_too_big',
				__( 'This folder is too large to download as one archive.', 'desktop-mode' ),
				array( 'status' => 400 )
			);
		}
		$manifest['entries'][ $prefix . $entry_name ] = $path;
	}

	unset( $had_child );

	return $manifest;
}

function openstation_files_zip_unique_name( $name, &$used_names ) {
	$key = strtolower( $name );
	if ( ! isset( $used_names[ $key ] ) ) {
		$used_names[ $key ] = 1;
		return $name;
	}
	++$used_names[ $key ];
	$n   = $used_names[ $key ];
	$dot = strrpos( $name, '.' );
	if ( false === $dot || 0 === $dot ) {
		return $name . " ($n)";
	}
	return substr( $name, 0, $dot ) . " ($n)" . substr( $name, $dot );
}

function openstation_files_download_stream_response( $path, $name, $mime, $delete_after ) {
	return new WP_REST_Response(
		array(
			'__openstation_stream' => array(
				'path'         => (string) $path,
				'name'         => (string) $name,
				'mime'         => (string) $mime,
				'delete_after' => (bool) $delete_after,
			),
		),
		200
	);
}

function openstation_files_serve_download( $served, $result, $request ) {
	if ( $served || ! $result instanceof WP_HTTP_Response ) {
		return $served;
	}
	$route = (string) $request->get_route();
	if ( ! preg_match( '#^/desktop-mode/v1/files/(uploads|folders)/\d+/download$#', $route ) ) {
		return $served;
	}
	$data = $result->get_data();
	if ( ! is_array( $data ) || empty( $data['__openstation_stream'] ) || 200 !== $result->get_status() ) {
		return $served;
	}
	$stream = $data['__openstation_stream'];
	$path   = (string) $stream['path'];
	if ( '' === $path || ! file_exists( $path ) || ! is_readable( $path ) ) {
		return $served;
	}

	openstation_files_emit_download( $path, (string) $stream['name'], (string) $stream['mime'] );

	if ( ! empty( $stream['delete_after'] ) ) {
		wp_delete_file( $path );
	}
	return true;
}
add_filter( 'rest_pre_serve_request', 'openstation_files_serve_download', 10, 3 );

function openstation_files_emit_download( $path, $name, $mime ) {
	$size = (int) filesize( $path );

	while ( ob_get_level() > 0 ) {
		ob_end_clean();
	}
	if ( function_exists( 'apache_setenv' ) ) {

		@apache_setenv( 'no-gzip', '1' );
	}

	@ini_set( 'zlib.output_compression', 'Off' );

	nocache_headers();
	header( 'X-Content-Type-Options: nosniff' );
	header( 'Content-Type: ' . ( '' !== $mime ? $mime : 'application/octet-stream' ) );
	header( 'Content-Length: ' . $size );
	header( 'Accept-Ranges: none' );

	$ascii = preg_replace( '/[^\x20-\x7E]/', '_', $name );
	$ascii = str_replace( array( '"', '\\' ), '_', (string) $ascii );
	header(
		'Content-Disposition: attachment; filename="' . $ascii . '"'
		. "; filename*=UTF-8''" . rawurlencode( $name )
	);

	readfile( $path );
}

function openstation_stored_files_sweep_zip_temps() {
	$entries = glob( trailingslashit( get_temp_dir() ) . 'os-folder-zip*' );
	foreach ( (array) $entries as $entry ) {
		if ( ! is_file( $entry ) ) {
			continue;
		}
		$mtime = (int) filemtime( $entry );
		if ( $mtime > 0 && ( time() - $mtime ) > DAY_IN_SECONDS ) {
			wp_delete_file( $entry );
		}
	}
}
add_action( 'desktop_mode_files_daily_prune', 'openstation_stored_files_sweep_zip_temps' );
