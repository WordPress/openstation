<?php

defined( 'ABSPATH' ) || exit;

function openstation_stored_files_dir( $user_id = 0 ) {
	$uploads = wp_get_upload_dir();
	$base    = trailingslashit( $uploads['basedir'] ) . 'desktop-mode-files';

	$base = (string) apply_filters( 'openstation_stored_files_base_dir', $base );
	if ( (int) $user_id > 0 ) {
		return $base . '/' . (int) $user_id;
	}
	return $base;
}

function openstation_stored_files_ensure_dir( $user_id ) {
	$user_id = (int) $user_id;
	if ( $user_id <= 0 ) {
		return new WP_Error( 'openstation_stored_files_invalid_user', __( 'A user id is required.', 'desktop-mode' ), array( 'status' => 400 ) );
	}
	$base = openstation_stored_files_dir();
	$dir  = openstation_stored_files_dir( $user_id );
	if ( ! wp_mkdir_p( $dir ) ) {
		return new WP_Error( 'openstation_stored_files_mkdir_failed', __( 'Could not create the storage directory.', 'desktop-mode' ), array( 'status' => 500 ) );
	}

	$htaccess = $base . '/.htaccess';
	if ( ! file_exists( $htaccess ) ) {
		$rules = "Options -Indexes\n"
			. "<IfModule mod_authz_core.c>\n"
			. "\tRequire all denied\n"
			. "</IfModule>\n"
			. "<IfModule !mod_authz_core.c>\n"
			. "\tOrder deny,allow\n"
			. "\tDeny from all\n"
			. "</IfModule>\n";

		file_put_contents( $htaccess, $rules );
	}
	foreach ( array( $base . '/index.php', $dir . '/index.php' ) as $index ) {
		if ( ! file_exists( $index ) ) {

			file_put_contents( $index, "<?php // Silence is golden.\n" );
		}
	}
	return $dir;
}

function openstation_stored_files_valid_disk_name( $disk_name ) {
	return (bool) preg_match( '/^[a-f0-9-]{16,64}$/', (string) $disk_name );
}

function openstation_stored_file_path( $row ) {
	if ( ! is_array( $row ) || empty( $row['owner_id'] ) || empty( $row['disk_name'] ) ) {
		return null;
	}
	if ( ! openstation_stored_files_valid_disk_name( $row['disk_name'] ) ) {
		return null;
	}
	$base = openstation_stored_files_dir();
	$path = openstation_stored_files_dir( (int) $row['owner_id'] ) . '/' . $row['disk_name'];

	$real_parent = realpath( dirname( $path ) );
	$real_base   = realpath( $base );
	if ( false === $real_parent || false === $real_base ) {

		return $path;
	}
	if ( 0 !== strpos( $real_parent . '/', $real_base . '/' ) ) {
		return null;
	}
	return $real_parent . '/' . $row['disk_name'];
}

function openstation_stored_files_create( $owner_id, $args ) {
	$id = openstation_stored_files_locked(
		static function () use ( $owner_id, $args ) {
			return openstation_stored_files_create_locked( $owner_id, $args );
		}
	);
	if ( ! is_wp_error( $id ) ) {

		do_action( 'openstation_stored_file_created', $id, (int) $owner_id );

	}
	return $id;
}

function openstation_stored_files_create_locked( $owner_id, $args ) {
	global $wpdb;
	$owner_id = (int) $owner_id;
	if ( $owner_id <= 0 ) {
		return new WP_Error( 'openstation_stored_files_invalid_user', __( 'A user id is required.', 'desktop-mode' ), array( 'status' => 400 ) );
	}
	$args = wp_parse_args(
		$args,
		array(
			'display_name' => '',
			'disk_name'    => '',
			'size_bytes'   => 0,
			'mime'         => '',
		)
	);
	if ( ! openstation_stored_files_valid_disk_name( $args['disk_name'] ) ) {
		return new WP_Error( 'openstation_stored_files_bad_disk_name', __( 'Invalid storage name.', 'desktop-mode' ), array( 'status' => 400 ) );
	}
	$display = sanitize_file_name( wp_strip_all_tags( (string) $args['display_name'] ) );
	if ( '' === $display ) {
		$display = __( 'file', 'desktop-mode' );
	}

	$tables = openstation_files_table_names();
	$now    = openstation_files_now_ms();
	$ok     = $wpdb->insert(
		$tables['stored_files'],
		array(
			'owner_id'      => $owner_id,
			'display_name'  => $display,
			'disk_name'     => (string) $args['disk_name'],
			'size_bytes'    => max( 0, (int) $args['size_bytes'] ),
			'mime'          => sanitize_mime_type( (string) $args['mime'] ),
			'created_at_ms' => $now,
			'updated_at_ms' => $now,
		),
		array( '%d', '%s', '%s', '%d', '%s', '%d', '%d' )
	);
	if ( false === $ok ) {
		return new WP_Error( 'openstation_stored_files_insert_failed', __( 'Failed to record the uploaded file.', 'desktop-mode' ), array( 'status' => 500 ) );
	}
	$id = (int) $wpdb->insert_id;

	return $id;
}

function openstation_stored_files_get( $file_id ) {
	global $wpdb;
	$file_id = (int) $file_id;
	if ( $file_id <= 0 ) {
		return null;
	}
	$tables = openstation_files_table_names();
	$row    = $wpdb->get_row(
		$wpdb->prepare( "SELECT * FROM {$tables['stored_files']} WHERE id = %d", $file_id ),
		ARRAY_A
	);
	if ( ! $row ) {
		return null;
	}
	return openstation_stored_files_normalize_row( $row );
}

function openstation_stored_files_normalize_row( $row ) {
	return array(
		'id'            => (int) $row['id'],
		'owner_id'      => (int) $row['owner_id'],
		'display_name'  => (string) $row['display_name'],
		'disk_name'     => (string) $row['disk_name'],
		'size_bytes'    => (int) $row['size_bytes'],
		'mime'          => (string) $row['mime'],
		'created_at_ms' => (int) $row['created_at_ms'],
		'updated_at_ms' => (int) $row['updated_at_ms'],
	);
}

function openstation_stored_files_rename( $file_id, $name ) {
	global $wpdb;
	$row = openstation_stored_files_get( $file_id );
	if ( ! $row ) {
		return new WP_Error( 'openstation_stored_files_not_found', __( 'Stored file not found.', 'desktop-mode' ), array( 'status' => 404 ) );
	}
	$name = sanitize_file_name( wp_strip_all_tags( (string) $name ) );
	if ( '' === $name ) {
		return new WP_Error( 'openstation_stored_files_bad_name', __( 'A file name is required.', 'desktop-mode' ), array( 'status' => 400 ) );
	}
	$tables = openstation_files_table_names();
	$now    = openstation_files_now_ms();
	$wpdb->update(
		$tables['stored_files'],
		array(
			'display_name'  => $name,
			'updated_at_ms' => $now,
		),
		array( 'id' => (int) $row['id'] ),
		array( '%s', '%d' ),
		array( '%d' )
	);

	$wpdb->query(
		$wpdb->prepare(
			"UPDATE {$tables['placements']} SET updated_at_ms = %d
			WHERE file_type = %s AND file_ref = %s",
			$now,
			'upload',
			(string) $row['id']
		)
	);

	do_action( 'openstation_stored_file_renamed', (int) $row['id'], $name, (string) $row['display_name'] );

	return true;
}

function openstation_stored_files_gate_trash( $can, $user_id, $row ) {
	if ( ! is_array( $row ) || 'upload' !== (string) ( $row['file_type'] ?? '' ) ) {
		return $can;
	}
	$stored = openstation_stored_files_get( (int) $row['file_ref'] );
	if ( ! $stored ) {
		return $can;
	}
	return (int) $stored['owner_id'] === (int) $user_id;
}
add_filter( 'openstation_files_user_can_trash_placement', 'openstation_stored_files_gate_trash', 20, 3 );

function openstation_stored_files_delete( $file_id ) {
	global $wpdb;
	$row = openstation_stored_files_get( $file_id );
	if ( ! $row ) {
		return new WP_Error( 'openstation_stored_files_not_found', __( 'Stored file not found.', 'desktop-mode' ), array( 'status' => 404 ) );
	}
	$path = openstation_stored_file_path( $row );
	if ( $path && file_exists( $path ) ) {
		wp_delete_file( $path );
	}
	$tables = openstation_files_table_names();
	$wpdb->delete( $tables['stored_files'], array( 'id' => (int) $row['id'] ), array( '%d' ) );

	do_action( 'openstation_stored_file_deleted', (int) $row['id'], $row );

	return true;
}

function openstation_stored_files_purge( $file_id ) {
	global $wpdb;
	$file_id = (int) $file_id;
	$row     = openstation_stored_files_get( $file_id );
	if ( ! $row ) {
		return new WP_Error( 'openstation_stored_files_not_found', __( 'Stored file not found.', 'desktop-mode' ), array( 'status' => 404 ) );
	}
	$tables = openstation_files_table_names();

	$placement_ids = $wpdb->get_col(
		$wpdb->prepare(
			"SELECT id FROM {$tables['placements']}
			WHERE file_type = %s AND file_ref = %s",
			'upload',
			(string) $file_id
		)
	);
	foreach ( (array) $placement_ids as $pid ) {
		$wpdb->delete( $tables['placements'], array( 'id' => (int) $pid ), array( '%d' ) );
		openstation_files_write_tombstone( 'placement', (int) $pid );
	}

	$wpdb->delete(
		$tables['shares'],
		array(
			'target_type' => 'file',
			'folder_id'   => $file_id,
		),
		array( '%s', '%d' )
	);

	return openstation_stored_files_delete( $file_id );
}

function openstation_stored_files_total_bytes( $owner_id ) {
	global $wpdb;
	$tables = openstation_files_table_names();
	return (int) $wpdb->get_var(
		$wpdb->prepare(
			"SELECT COALESCE( SUM( size_bytes ), 0 ) FROM {$tables['stored_files']} WHERE owner_id = %d",
			(int) $owner_id
		)
	);
}

function openstation_stored_files_user_quota_bytes( $user_id ) {

	return max( 0, (int) apply_filters( 'openstation_stored_files_user_quota_bytes', 0, (int) $user_id ) );
}

function openstation_stored_files_upload_capability() {

	return (string) apply_filters( 'openstation_stored_files_upload_capability', 'upload_files' );
}

function openstation_stored_file_user_can_read( $file_id, $user_id ) {
	global $wpdb;
	$file_id = (int) $file_id;
	$user_id = (int) $user_id;
	if ( $file_id <= 0 || $user_id <= 0 ) {
		return false;
	}
	$row = openstation_stored_files_get( $file_id );
	if ( ! $row ) {
		return false;
	}
	if ( (int) $row['owner_id'] === $user_id ) {
		return true;
	}

	if ( function_exists( 'openstation_stored_file_share_state' ) ) {
		if ( 'accepted' === openstation_stored_file_share_state( $file_id, $user_id ) ) {
			return true;
		}
	}

	$tables  = openstation_files_table_names();
	$parents = $wpdb->get_col(
		$wpdb->prepare(
			"SELECT DISTINCT parent_id FROM {$tables['placements']}
			WHERE file_type = %s AND file_ref = %s
				AND parent_id > 0
				AND trashed_at_ms IS NULL",
			'upload',
			(string) $file_id
		)
	);
	if ( function_exists( 'openstation_folder_share_user_capability' ) ) {
		foreach ( (array) $parents as $parent_id ) {
			if ( 'none' !== openstation_folder_share_user_capability( (int) $parent_id, $user_id ) ) {
				return true;
			}
		}
	}

	return (bool) apply_filters( 'openstation_stored_file_can_read', false, $file_id, $user_id, $row );
}

function openstation_stored_files_handle_unplaced( $placement_id, $row ) {
	global $wpdb;
	if ( ! is_array( $row ) || 'upload' !== (string) ( $row['file_type'] ?? '' ) ) {
		return;
	}
	$file_id = (int) $row['file_ref'];
	$file    = openstation_stored_files_get( $file_id );
	if ( ! $file ) {
		return;
	}
	if ( (int) $row['owner_id'] !== (int) $file['owner_id'] ) {
		return;
	}
	$tables    = openstation_files_table_names();
	$remaining = (int) $wpdb->get_var(
		$wpdb->prepare(
			"SELECT COUNT(*) FROM {$tables['placements']}
			WHERE file_type = %s AND file_ref = %s AND owner_id = %d",
			'upload',
			(string) $file_id,
			(int) $file['owner_id']
		)
	);
	if ( $remaining > 0 ) {
		return;
	}
	openstation_stored_files_purge( $file_id );
}
add_action( 'openstation_file_unplaced', 'openstation_stored_files_handle_unplaced', 10, 2 );

function openstation_stored_files_handle_deleted_user( $user_id ) {
	global $wpdb;
	$user_id = (int) $user_id;
	if ( $user_id <= 0 ) {
		return;
	}
	$tables = openstation_files_table_names();
	$ids    = $wpdb->get_col(
		$wpdb->prepare( "SELECT id FROM {$tables['stored_files']} WHERE owner_id = %d", $user_id )
	);
	foreach ( (array) $ids as $file_id ) {
		openstation_stored_files_purge( (int) $file_id );
	}
	$dir = openstation_stored_files_dir( $user_id );
	if ( is_dir( $dir ) ) {
		$index = $dir . '/index.php';
		if ( file_exists( $index ) ) {
			wp_delete_file( $index );
		}

		@rmdir( $dir );
	}
}
add_action( 'deleted_user', 'openstation_stored_files_handle_deleted_user' );
