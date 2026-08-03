<?php
/**
 * OpenStation — authenticated downloads for stored files.
 *
 * Two routes:
 *
 *   GET /desktop-mode/v1/files/uploads/(?P<id>\d+)/download
 *       Streams one stored file's bytes, unmodified.
 *   GET /desktop-mode/v1/files/folders/(?P<id>\d+)/download
 *       Builds an on-demand .zip of the folder's STORED-FILE
 *       contents (reference-type placements are skipped) and
 *       streams it.
 *
 * Auth: cookie + `_wpnonce` query parameter (the officially
 * supported GET form — an `<a>` navigation can't set the
 * `X-WP-Nonce` header). URLs are minted client-side at click time
 * and never persisted. The route also reads an optional `token`
 * param reserved for a future signed-link layer; it is currently
 * ignored.
 *
 * Byte serving happens in a `rest_pre_serve_request` short-circuit
 * — the REST server has already sent its JSON Content-Type header
 * by dispatch time, and `header()` replacement inside the filter is
 * the sanctioned way to take over the response (the same route
 * still keeps `permission_callback`, error JSON, and logging).
 *
 * Not-found and no-access are both 404 — a download probe must not
 * reveal that a file exists (the Drive behavior).
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register the download routes.
 */
function open_station_files_register_download_rest_routes() {
	$ns = 'desktop-mode/v1';
	register_rest_route( $ns, '/files/uploads/(?P<id>\d+)/download', array(
		'methods'             => WP_REST_Server::READABLE,
		'permission_callback' => 'open_station_files_rest_permission',
		'callback'            => 'open_station_files_rest_download_file',
	) );
	register_rest_route( $ns, '/files/folders/(?P<id>\d+)/download', array(
		'methods'             => WP_REST_Server::READABLE,
		'permission_callback' => 'open_station_files_rest_permission',
		'callback'            => 'open_station_files_rest_download_folder_zip',
	) );
}
add_action( 'rest_api_init', 'open_station_files_register_download_rest_routes' );

/**
 * The masked not-found error shared by every failure path that
 * must not leak existence.
 *
 * @return WP_Error
 */
function open_station_files_download_not_found() {
	return new WP_Error(
		'open_station_files_not_found',
		__( 'File not found.', 'desktop-mode' ),
		array( 'status' => 404 )
	);
}

/**
 * GET /files/uploads/<id>/download
 *
 * @param WP_REST_Request $req Request.
 * @return WP_REST_Response|WP_Error
 */
function open_station_files_rest_download_file( WP_REST_Request $req ) {
	$file_id = (int) $req['id'];
	$user_id = get_current_user_id();
	$row     = open_station_stored_files_get( $file_id );
	if ( ! $row || ! open_station_stored_file_user_can_read( $file_id, $user_id ) ) {
		return open_station_files_download_not_found();
	}
	$path = open_station_stored_file_path( $row );
	if ( ! $path || ! file_exists( $path ) ) {
		return open_station_files_download_not_found();
	}

	/**
	 * Fires when a stored-file download is about to be served.
	 *
	 * @param int $file_id Stored-file id.
	 * @param int $user_id Downloader.
	 */
	do_action( 'open_station_stored_file_downloaded', $file_id, $user_id );

	return open_station_files_download_stream_response(
		$path,
		$row['display_name'],
		$row['mime'],
		false
	);
}

/**
 * GET /files/folders/<id>/download — zip the folder's stored files.
 *
 * @param WP_REST_Request $req Request.
 * @return WP_REST_Response|WP_Error
 */
function open_station_files_rest_download_folder_zip( WP_REST_Request $req ) {
	$folder_id = (int) $req['id'];
	$user_id   = get_current_user_id();
	$folder    = open_station_files_get_folder( $folder_id );
	if ( ! $folder ) {
		return open_station_files_download_not_found();
	}
	$is_owner = (int) $folder['owner_id'] === $user_id;
	if ( ! $is_owner ) {
		$cap = function_exists( 'open_station_folder_share_user_capability' )
			? open_station_folder_share_user_capability( $folder_id, $user_id )
			: 'none';
		if ( 'none' === $cap ) {
			return open_station_files_download_not_found();
		}
	}
	if ( ! class_exists( 'ZipArchive' ) ) {
		return new WP_Error(
			'open_station_stored_files_no_zip',
			__( 'Folder download requires the PHP zip extension.', 'desktop-mode' ),
			array( 'status' => 501 )
		);
	}

	$manifest = array(
		'entries'     => array(), // path-in-zip => absolute path.
		'empty_dirs'  => array(), // path-in-zip (with trailing /).
		'total_bytes' => 0,
	);
	$result   = open_station_files_collect_zip_entries( $folder_id, $user_id, '', $manifest, array( $folder_id => true ), 0 );
	if ( is_wp_error( $result ) ) {
		return $result;
	}
	$manifest = $result;

	require_once ABSPATH . 'wp-admin/includes/file.php';
	$tmp = wp_tempnam( 'os-folder-zip' );
	if ( ! $tmp ) {
		return new WP_Error( 'open_station_stored_files_zip_failed', __( 'Could not create the archive.', 'desktop-mode' ), array( 'status' => 500 ) );
	}
	// Belt and braces for aborted connections — the normal path
	// deletes right after streaming.
	register_shutdown_function( 'wp_delete_file', $tmp );

	$zip = new ZipArchive();
	if ( true !== $zip->open( $tmp, ZipArchive::OVERWRITE ) ) {
		wp_delete_file( $tmp );
		return new WP_Error( 'open_station_stored_files_zip_failed', __( 'Could not create the archive.', 'desktop-mode' ), array( 'status' => 500 ) );
	}
	foreach ( $manifest['empty_dirs'] as $dir_entry ) {
		$zip->addEmptyDir( $dir_entry );
	}
	foreach ( $manifest['entries'] as $entry_name => $abs_path ) {
		$zip->addFile( $abs_path, $entry_name );
		if ( method_exists( $zip, 'setCompressionName' ) ) {
			// Media / archives are already compressed; STORE saves
			// CPU for nothing lost. Cheap heuristic on the entry name.
			if ( preg_match( '/\.(zip|gz|bz2|7z|rar|jpe?g|png|gif|webp|avif|mp3|mp4|m4a|mov|webm|ogg|pdf)$/i', $entry_name ) ) {
				$zip->setCompressionName( $entry_name, ZipArchive::CM_STORE );
			}
		}
	}
	if ( ! $zip->close() ) {
		wp_delete_file( $tmp );
		return new WP_Error( 'open_station_stored_files_zip_failed', __( 'Could not finish the archive (disk full?).', 'desktop-mode' ), array( 'status' => 500 ) );
	}

	/**
	 * Fires when a folder-zip download is about to be served.
	 *
	 * @param int $folder_id Folder id.
	 * @param int $user_id   Downloader.
	 * @param int $count     Number of files in the archive.
	 */
	do_action( 'open_station_folder_zip_downloaded', $folder_id, $user_id, count( $manifest['entries'] ) );

	$zip_name = sanitize_file_name( '' !== (string) $folder['name'] ? (string) $folder['name'] : 'folder' ) . '.zip';
	return open_station_files_download_stream_response( $tmp, $zip_name, 'application/zip', true );
}

/**
 * Recursive manifest collector. Walks the folder's placements
 * (shared-namespace: every owner's rows), adds stored files the
 * viewer can read, recurses into sub-folders, records empty
 * directories, and enforces the caps.
 *
 * @internal
 *
 * @param int   $folder_id Folder to walk.
 * @param int   $user_id   Viewer.
 * @param string $prefix   Path prefix inside the zip ('' at root).
 * @param array $manifest  Accumulator (entries / empty_dirs / total_bytes).
 * @param array $visited   Folder ids already on the walk path (cycle guard).
 * @param int   $depth     Current depth.
 * @return array|WP_Error The updated manifest.
 */
function open_station_files_collect_zip_entries( $folder_id, $user_id, $prefix, $manifest, $visited, $depth ) {
	if ( $depth > 32 ) {
		return $manifest; // Depth cap — quietly stop descending.
	}

	/**
	 * Filters the zip caps. `max_entries` bounds file count,
	 * `max_bytes` bounds the SUM of input sizes.
	 *
	 * @param array $caps `{ max_entries: int, max_bytes: int }`.
	 */
	$caps = (array) apply_filters(
		'open_station_stored_files_zip_caps',
		array(
			'max_entries' => 1000,
			'max_bytes'   => 500 * MB_IN_BYTES,
		)
	);

	$rows       = open_station_files_get_for_user_folder( $user_id, $folder_id );
	$used_names = array(); // lowercase name => count, per directory.
	$had_child  = false;

	foreach ( $rows as $row ) {
		if ( 'folder' === $row['file_type'] ) {
			$sub_id = (int) $row['file_ref'];
			if ( $sub_id <= 0 || isset( $visited[ $sub_id ] ) ) {
				continue;
			}
			$sub = open_station_files_get_folder( $sub_id );
			if ( ! $sub ) {
				continue;
			}
			$dir_name = open_station_files_zip_unique_name(
				sanitize_file_name( '' !== (string) $sub['name'] ? (string) $sub['name'] : 'folder' ),
				$used_names
			);
			$had_child          = true;
			$visited[ $sub_id ] = true;
			$before             = count( $manifest['entries'] ) + count( $manifest['empty_dirs'] );
			$manifest           = open_station_files_collect_zip_entries( $sub_id, $user_id, $prefix . $dir_name . '/', $manifest, $visited, $depth + 1 );
			if ( is_wp_error( $manifest ) ) {
				return $manifest;
			}
			if ( count( $manifest['entries'] ) + count( $manifest['empty_dirs'] ) === $before ) {
				// Nothing inside — record the empty directory so the
				// tree round-trips.
				$manifest['empty_dirs'][] = $prefix . $dir_name . '/';
			}
			continue;
		}
		if ( 'upload' !== $row['file_type'] ) {
			continue; // References are not bytes; skipped by design.
		}
		$file_id = (int) $row['file_ref'];
		$file    = open_station_stored_files_get( $file_id );
		if ( ! $file || ! open_station_stored_file_user_can_read( $file_id, $user_id ) ) {
			continue;
		}
		$path = open_station_stored_file_path( $file );
		if ( ! $path || ! file_exists( $path ) ) {
			continue;
		}
		$had_child  = true;
		$entry_name = open_station_files_zip_unique_name(
			sanitize_file_name( '' !== $file['display_name'] ? $file['display_name'] : 'file' ),
			$used_names
		);

		$manifest['total_bytes'] += (int) $file['size_bytes'];
		if ( count( $manifest['entries'] ) + 1 > (int) $caps['max_entries'] ) {
			return new WP_Error(
				'open_station_stored_files_zip_too_big',
				__( 'This folder has too many files to download as one archive.', 'desktop-mode' ),
				array( 'status' => 400 )
			);
		}
		if ( (int) $caps['max_bytes'] > 0 && $manifest['total_bytes'] > (int) $caps['max_bytes'] ) {
			return new WP_Error(
				'open_station_stored_files_zip_too_big',
				__( 'This folder is too large to download as one archive.', 'desktop-mode' ),
				array( 'status' => 400 )
			);
		}
		$manifest['entries'][ $prefix . $entry_name ] = $path;
	}

	// An entirely empty folder at the walk root still yields a
	// well-formed (empty) zip; sub-folder emptiness is recorded by
	// the caller. Nothing to do here when $had_child is false.
	unset( $had_child );

	return $manifest;
}

/**
 * Per-directory case-insensitive dedupe: `report.pdf`,
 * `Report.pdf` → `report.pdf`, `Report (2).pdf` so extraction on
 * case-folding filesystems (Windows, macOS) never collides.
 *
 * @internal
 *
 * @param string $name       Sanitized candidate name.
 * @param array  $used_names By-ref lowercase tally for the directory.
 * @return string
 */
function open_station_files_zip_unique_name( $name, &$used_names ) {
	$key = strtolower( $name );
	if ( ! isset( $used_names[ $key ] ) ) {
		$used_names[ $key ] = 1;
		return $name;
	}
	$used_names[ $key ]++;
	$n   = $used_names[ $key ];
	$dot = strrpos( $name, '.' );
	if ( false === $dot || 0 === $dot ) {
		return $name . " ($n)";
	}
	return substr( $name, 0, $dot ) . " ($n)" . substr( $name, $dot );
}

/**
 * Build the marker response the `rest_pre_serve_request` filter
 * streams. The marker payload never reaches the client — the
 * filter takes over the output entirely.
 *
 * @internal
 *
 * @param string $path         Absolute file path.
 * @param string $name         Download filename shown to the user.
 * @param string $mime         MIME type ('' = octet-stream).
 * @param bool   $delete_after Delete `$path` after streaming (zip temp).
 * @return WP_REST_Response
 */
function open_station_files_download_stream_response( $path, $name, $mime, $delete_after ) {
	return new WP_REST_Response(
		array(
			'__open_station_stream' => array(
				'path'         => (string) $path,
				'name'         => (string) $name,
				'mime'         => (string) $mime,
				'delete_after' => (bool) $delete_after,
			),
		),
		200
	);
}

/**
 * `rest_pre_serve_request` short-circuit: stream the file the
 * download callbacks resolved. Non-stream results (errors included)
 * fall through to normal JSON serving.
 *
 * @param bool             $served  Whether the request is already served.
 * @param WP_HTTP_Response $result  Result to send.
 * @param WP_REST_Request  $request Request used.
 * @return bool
 */
function open_station_files_serve_download( $served, $result, $request ) {
	if ( $served || ! $result instanceof WP_HTTP_Response ) {
		return $served;
	}
	$route = (string) $request->get_route();
	if ( ! preg_match( '#^/desktop-mode/v1/files/(uploads|folders)/\d+/download$#', $route ) ) {
		return $served;
	}
	$data = $result->get_data();
	if ( ! is_array( $data ) || empty( $data['__open_station_stream'] ) || 200 !== $result->get_status() ) {
		return $served; // Error shapes serialize as normal JSON.
	}
	$stream = $data['__open_station_stream'];
	$path   = (string) $stream['path'];
	if ( '' === $path || ! file_exists( $path ) || ! is_readable( $path ) ) {
		return $served;
	}

	open_station_files_emit_download( $path, (string) $stream['name'], (string) $stream['mime'] );

	if ( ! empty( $stream['delete_after'] ) ) {
		wp_delete_file( $path );
	}
	return true;
}
add_filter( 'rest_pre_serve_request', 'open_station_files_serve_download', 10, 3 );

/**
 * Send the headers and the bytes. Split out so PHPUnit can target
 * the header/name logic without hijacking output.
 *
 * @internal
 *
 * @param string $path Absolute file path.
 * @param string $name Download filename.
 * @param string $mime MIME type.
 */
function open_station_files_emit_download( $path, $name, $mime ) {
	$size = (int) filesize( $path );

	// Kill every output buffer + compression layer so
	// Content-Length stays exact and readfile streams instead of
	// ballooning through a buffer.
	// phpcs:ignore Generic.CodeAnalysis.EmptyStatement
	while ( ob_get_level() > 0 ) {
		ob_end_clean();
	}
	if ( function_exists( 'apache_setenv' ) ) {
		// phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
		@apache_setenv( 'no-gzip', '1' );
	}
	// phpcs:ignore WordPress.PHP.IniSet.Risky
	@ini_set( 'zlib.output_compression', 'Off' ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged

	nocache_headers();
	header( 'X-Content-Type-Options: nosniff' );
	header( 'Content-Type: ' . ( '' !== $mime ? $mime : 'application/octet-stream' ) );
	header( 'Content-Length: ' . $size );
	header( 'Accept-Ranges: none' );

	// RFC 6266: ASCII fallback + RFC 5987 UTF-8 form. Always
	// `attachment` — uploaded SVG/HTML must never render from this
	// origin.
	$ascii = preg_replace( '/[^\x20-\x7E]/', '_', $name );
	$ascii = str_replace( array( '"', '\\' ), '_', (string) $ascii );
	header(
		'Content-Disposition: attachment; filename="' . $ascii . '"'
		. "; filename*=UTF-8''" . rawurlencode( $name )
	);

	// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_readfile
	readfile( $path );
}

/**
 * Daily sweep of stale zip temp files (aborted downloads whose
 * shutdown cleanup never ran).
 */
function open_station_stored_files_sweep_zip_temps() {
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
add_action( 'desktop_mode_files_daily_prune', 'open_station_stored_files_sweep_zip_temps' );
