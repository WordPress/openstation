<?php
/**
 * Failure-safe reconciliation of stored rows and upload bytes.
 *
 * @package OpenStation
 */
defined( 'ABSPATH' ) || exit;

require_once dirname( __DIR__ ) . '/storage-primary.php';

/**
 * Serialize upload registration, placement creation and each cleanup candidate.
 *
 * Connection-scoped MySQL locks work without committing a caller's transaction.
 * The name includes the database and site prefix; unrelated sites never wait.
 * Nested calls on this connection are balanced by MySQL's lock reference count.
 * No filesystem traversal is performed while the lock is held.
 *
 * @internal
 * @param callable $callback Operation to protect.
 * @param bool     $cleanup Require a real advisory lock for destructive reconciliation.
 * @return mixed|WP_Error Callback result, or a retryable lock error.
 */
function openstation_stored_files_locked( $callback, $cleanup = false ) {
	global $wpdb;
	openstation_storage_use_primary();
	$name = 'os-files-' . md5( $wpdb->dbname . ':' . $wpdb->prefix );
	// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- MySQL advisory lock; WordPress has no API for it, and a lock is never cached.
	$lock = $wpdb->get_var( $wpdb->prepare( 'SELECT GET_LOCK(%s, 5)', $name ) );
	// SQLite translates GET_LOCK to a successful no-op. Keep intake working,
	// but never run destructive reconciliation without mutual exclusion.
	if ( '1=1' === $lock && ! $cleanup ) {
		return $callback();
	}
	if ( '1' !== (string) $lock ) {
		return new WP_Error( 'openstation_storage_busy', __( 'File storage is busy. Please try again.', 'desktop-mode' ), array( 'status' => 503 ) );
	}
	try {
		return $callback();
	} finally {
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- MySQL advisory lock; WordPress has no API for it, and a lock is never cached.
		$wpdb->get_var( $wpdb->prepare( 'SELECT RELEASE_LOCK(%s)', $name ) );
	}
}

/**
 * Protect only the current reference check and placement insert.
 * Authorization, collision recovery and extension callbacks run outside the lock.
 *
 * @internal
 * @param string   $ref Stored-file reference.
 * @param callable $insert Placement insert.
 * @return array|WP_Error
 */
function openstation_stored_files_place_insert( $ref, $insert ) {
	return openstation_stored_files_locked(
		static function () use ( $ref, $insert ) {
			global $wpdb;
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- Plugin-owned table, no WP API; locking read under the storage lock, must be read fresh.
			$exists = $wpdb->get_var( $wpdb->prepare( "SELECT id FROM {$wpdb->desktop_mode_stored_files} WHERE id = %d FOR UPDATE", (int) $ref ) );
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

/**
 * Report a failed cleanup operation without exposing SQL or filesystem paths.
 *
 * @internal
 * @param string $stage Failed operation.
 * @return void
 */
function openstation_stored_files_reconcile_failed( $stage ) {
	/**
	 * Fires when reconciliation skips bytes or stops after a failed safety check.
	 *
	 * @param WP_Error $error Error whose data contains the failing stage.
	 */
	do_action(
		'openstation_stored_files_reconcile_failed',
		new WP_Error( 'openstation_reconcile_failed', __( 'A file cleanup operation could not be completed.', 'desktop-mode' ), array( 'stage' => $stage ) )
	);
}

/**
 * Remove one old placement-less row, rechecking under the upload writer lock.
 *
 * Delete the database row before bytes. A failed DELETE leaves bytes untouched;
 * a failed unlink leaves row-less bytes for a later sweep. Trashed placements
 * count as references, so cleanup never consumes the recycle bin's files.
 *
 * @internal
 * @param int $id Candidate id.
 * @param int $cutoff_ms Oldest retained creation timestamp.
 * @return bool Whether the check and any required deletion succeeded.
 */
function openstation_stored_files_reconcile_row( $id, $cutoff_ms ) {
	global $wpdb;
	// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- Plugin-owned tables, no WP API; rechecked under the storage lock, must be read fresh.
	$row = $wpdb->get_row(
		$wpdb->prepare(
			"SELECT sf.* FROM {$wpdb->desktop_mode_stored_files} sf
			WHERE sf.id = %d AND sf.created_at_ms < %d
			AND NOT EXISTS (SELECT 1 FROM {$wpdb->desktop_mode_file_placements} p
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
	// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- Plugin-owned tables, no WP API; write path, nothing caches these tables.
	$deleted = $wpdb->query(
		$wpdb->prepare(
			"DELETE sf FROM {$wpdb->desktop_mode_stored_files} sf
			WHERE sf.id = %d AND sf.created_at_ms < %d
			AND NOT EXISTS (SELECT 1 FROM {$wpdb->desktop_mode_file_placements} p
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
		/** This action is documented in includes/desktop-files/stored-files-store.php. */
		do_action( 'openstation_stored_file_deleted', (int) $row['id'], $row );
	}
	return true;
}

/**
 * Revalidate one row-less disk file against current DB state before unlinking.
 *
 * @internal
 * @param int    $owner_id Owner directory.
 * @param string $entry Candidate path.
 * @param int    $cutoff Unix seconds cutoff.
 * @return bool Whether the check succeeded.
 */
function openstation_stored_files_reconcile_bytes( $owner_id, $entry, $cutoff ) {
	global $wpdb;
	// A locking read sees current committed rows even inside a caller's
	// REPEATABLE READ transaction, rather than an earlier empty snapshot.
	// Engines that reject the changed snapshot take the failure path below.
	// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- Plugin-owned table, no WP API; locking read under the storage lock, must be read fresh.
	$known = $wpdb->get_var(
		$wpdb->prepare(
			"SELECT id FROM {$wpdb->desktop_mode_stored_files} WHERE owner_id = %d AND disk_name = %s LIMIT 1 FOR UPDATE",
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

/**
 * Daily reconciliation. Any failed lookup aborts the remaining sweep.
 *
 * The one-day grace period protects uploads between their filesystem move and
 * row insertion. Missing bytes retain their row, allowing manual recovery.
 *
 * @return void
 */
function openstation_stored_files_reconcile() {
	global $wpdb;
	$cutoff_ms = openstation_files_now_ms() - DAY_IN_SECONDS * 1000;
	// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- Plugin-owned tables, no WP API; picks rows to delete, must be read fresh.
	$orphans = $wpdb->get_col(
		$wpdb->prepare(
			"SELECT sf.id FROM {$wpdb->desktop_mode_stored_files} sf
			LEFT JOIN {$wpdb->desktop_mode_file_placements} p ON p.file_type = 'upload' AND p.file_ref = CAST(sf.id AS CHAR)
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
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- Plugin-owned table, no WP API; picks bytes to delete, must be read fresh.
		$known = $wpdb->get_col( $wpdb->prepare( "SELECT disk_name FROM {$wpdb->desktop_mode_stored_files} WHERE owner_id = %d", $owner_id ) );
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
