<?php

defined( 'ABSPATH' ) || exit;

require_once dirname( __DIR__ ) . '/storage-primary.php';

function openstation_stored_files_locked( $callback, $cleanup = false ) {
	global $wpdb;
	openstation_storage_use_primary();
	$name = 'os-files-' . md5( $wpdb->dbname . ':' . $wpdb->prefix );
	$lock = $wpdb->get_var( $wpdb->prepare( 'SELECT GET_LOCK(%s, 5)', $name ) );

	if ( '1=1' === $lock && ! $cleanup ) {
		return $callback();
	}
	if ( '1' !== (string) $lock ) {
		return new WP_Error( 'openstation_storage_busy', __( 'File storage is busy. Please try again.', 'desktop-mode' ), array( 'status' => 503 ) );
	}
	try {
		return $callback();
	} finally {
		$wpdb->get_var( $wpdb->prepare( 'SELECT RELEASE_LOCK(%s)', $name ) );
	}
}

function openstation_stored_files_place_insert( $ref, $insert ) {
	return openstation_stored_files_locked(
		static function () use ( $ref, $insert ) {
			global $wpdb;
			$tables = openstation_files_table_names();
			$exists = $wpdb->get_var( $wpdb->prepare( "SELECT id FROM {$tables['stored_files']} WHERE id = %d FOR UPDATE", (int) $ref ) );
			if ( '' !== $wpdb->last_error ) {
				return new WP_Error( 'openstation_storage_unavailable', __( 'File storage is unavailable. Please try again.', 'desktop-mode' ), array( 'status' => 503 ) );
			}
			if ( ! $exists ) {
				return new WP_Error( 'openstation_stored_files_not_found', __( 'Stored file not found.', 'desktop-mode' ), array( 'status' => 404 ) );
			}
			return $insert();
		}
	);
}

function openstation_stored_files_reconcile_failed( $stage ) {

	do_action(
		'openstation_stored_files_reconcile_failed',
		new WP_Error( 'openstation_reconcile_failed', __( 'A file cleanup operation could not be completed.', 'desktop-mode' ), array( 'stage' => $stage ) )
	);
}

function openstation_stored_files_reconcile_row( $id, $cutoff_ms ) {
	global $wpdb;
	$tables = openstation_files_table_names();
	$row    = $wpdb->get_row(
		$wpdb->prepare(
			"SELECT sf.* FROM {$tables['stored_files']} sf
			WHERE sf.id = %d AND sf.created_at_ms < %d
			AND NOT EXISTS (SELECT 1 FROM {$tables['placements']} p
				WHERE p.file_type = 'upload' AND p.file_ref = CAST(sf.id AS CHAR))",
			$id,
			$cutoff_ms
		),
		ARRAY_A
	);
	if ( '' !== $wpdb->last_error ) {
		return false;
	}
	if ( ! $row ) {
		return true;
	}
	$deleted = $wpdb->query(
		$wpdb->prepare(
			"DELETE sf FROM {$tables['stored_files']} sf
			WHERE sf.id = %d AND sf.created_at_ms < %d
			AND NOT EXISTS (SELECT 1 FROM {$tables['placements']} p
				WHERE p.file_type = 'upload' AND p.file_ref = CAST(sf.id AS CHAR))",
			$id,
			$cutoff_ms
		)
	);
	if ( false === $deleted ) {
		return false;
	}
	if ( 1 === $deleted ) {
		$row  = openstation_stored_files_normalize_row( $row );
		$path = openstation_stored_file_path( $row );
		if ( $path && is_file( $path ) ) {
			wp_delete_file( $path );
			clearstatcache( true, $path );
			if ( is_file( $path ) ) {
				openstation_stored_files_reconcile_failed( 'unlink_row_bytes' );
			}
		}

		do_action( 'openstation_stored_file_deleted', (int) $row['id'], $row );
	}
	return true;
}

function openstation_stored_files_reconcile_bytes( $owner_id, $entry, $cutoff ) {
	global $wpdb;
	$tables = openstation_files_table_names();

	$known = $wpdb->get_var(
		$wpdb->prepare(
			"SELECT id FROM {$tables['stored_files']} WHERE owner_id = %d AND disk_name = %s LIMIT 1 FOR UPDATE",
			$owner_id,
			basename( $entry )
		)
	);
	if ( '' !== $wpdb->last_error ) {
		return false;
	}
	clearstatcache( true, $entry );
	if ( null === $known && is_file( $entry ) && ! is_link( $entry ) ) {
		$mtime = filemtime( $entry );
		if ( false !== $mtime && $mtime > 0 && $mtime < $cutoff ) {
			wp_delete_file( $entry );
			clearstatcache( true, $entry );
			if ( is_file( $entry ) ) {
				openstation_stored_files_reconcile_failed( 'unlink_bytes' );
			}
			return true;
		}
	}
	return true;
}

function openstation_stored_files_reconcile() {
	global $wpdb;
	$tables    = openstation_files_table_names();
	$cutoff_ms = openstation_files_now_ms() - DAY_IN_SECONDS * 1000;
	$orphans   = $wpdb->get_col(
		$wpdb->prepare(
			"SELECT sf.id FROM {$tables['stored_files']} sf
			LEFT JOIN {$tables['placements']} p ON p.file_type = 'upload' AND p.file_ref = CAST(sf.id AS CHAR)
			WHERE p.id IS NULL AND sf.created_at_ms < %d",
			$cutoff_ms
		)
	);
	if ( '' !== $wpdb->last_error ) {
		openstation_stored_files_reconcile_failed( 'orphan_rows' );
		return;
	}
	foreach ( $orphans as $id ) {
		$result = openstation_stored_files_locked(
			static function () use ( $id, $cutoff_ms ) {
				return openstation_stored_files_reconcile_row( (int) $id, $cutoff_ms );
			},
			true
		);
		if ( true !== $result ) {
			openstation_stored_files_reconcile_failed( 'delete_row' );
			return;
		}
	}

	$base = openstation_stored_files_dir();
	if ( ! is_dir( $base ) || is_link( $base ) ) {
		return;
	}
	foreach ( (array) glob( $base . '/*', GLOB_ONLYDIR ) as $user_dir ) {
		$owner_id = (int) basename( $user_dir );
		if ( $owner_id <= 0 || basename( $user_dir ) !== (string) $owner_id || is_link( $user_dir ) ) {
			continue;
		}
		$known = $wpdb->get_col( $wpdb->prepare( "SELECT disk_name FROM {$tables['stored_files']} WHERE owner_id = %d", $owner_id ) );
		if ( '' !== $wpdb->last_error ) {
			openstation_stored_files_reconcile_failed( 'known_bytes' );
			return;
		}
		$known_set = array_fill_keys( $known, true );
		foreach ( (array) glob( $user_dir . '/*' ) as $entry ) {
			if ( isset( $known_set[ basename( $entry ) ] ) || ! openstation_stored_files_valid_disk_name( basename( $entry ) ) ) {
				continue;
			}
			clearstatcache( true, $entry );
			if ( ! is_file( $entry ) || is_link( $entry ) || filemtime( $entry ) >= time() - DAY_IN_SECONDS ) {
				continue;
			}
			$result = openstation_stored_files_locked(
				static function () use ( $owner_id, $entry ) {
					return openstation_stored_files_reconcile_bytes( $owner_id, $entry, time() - DAY_IN_SECONDS );
				},
				true
			);
			if ( true !== $result ) {
				openstation_stored_files_reconcile_failed( 'delete_bytes' );
				return;
			}
		}
	}
}
add_action( 'desktop_mode_files_daily_prune', 'openstation_stored_files_reconcile' );
