<?php
/**
 * OpenStation — stored-files store (real per-user file storage).
 *
 * Backs the `upload` file type. One row per uploaded file in
 * `{$wpdb->prefix}desktop_mode_stored_files`; the bytes live flat on
 * disk under `uploads/desktop-mode-files/<owner_id>/<disk_name>`.
 *
 * Layout invariants (the security model depends on all three):
 *
 *   1. `disk_name` is a server-generated UUID with NO extension —
 *      user input never composes a disk path, and a direct hit on
 *      an unprotected server yields opaque bytes, not something a
 *      PHP handler would execute.
 *   2. The storage base is protected by `.htaccess` (both Apache
 *      2.2 and 2.4 syntaxes) + an empty `index.php`. nginx ignores
 *      `.htaccess`; the documented `deny all` location snippet plus
 *      invariants 1 and 3 are the floor there.
 *   3. Bytes are only ever served through the authenticated
 *      download endpoint (`includes/desktop-files/downloads.php`)
 *      with `Content-Disposition: attachment` + nosniff.
 *
 * Deletion contract — the deliberate exception to the desktop-files
 * "references, not copies" rule: for `upload` placements the
 * placement OWNS the entity. Soft-trash keeps the bytes; when the
 * owner's last placement of a file is permanently removed, the row,
 * the bytes, and every recipient placement are purged (see
 * {@see openstation_stored_files_handle_unplaced()}).
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Absolute path of the storage base dir (no trailing slash), or of
 * a user's subdirectory when `$user_id` is given. Purely a path
 * computation — nothing is created; see
 * {@see openstation_stored_files_ensure_dir()}.
 *
 * The `desktop-mode-files` segment is the pre-rebrand spelling and is
 * frozen: users' uploaded bytes already live there. Renaming it points
 * the plugin at an empty directory while every stored file stays on
 * disk, unreachable. The mismatch with the function name is deliberate.
 *
 * @param int $user_id Optional. Owner whose subdirectory to return.
 * @return string
 */
function openstation_stored_files_dir( $user_id = 0 ) {
	$uploads = wp_get_upload_dir();
	$base    = trailingslashit( $uploads['basedir'] ) . 'desktop-mode-files';
	/**
	 * Filters the storage base directory. Sites that can write
	 * outside the webroot can point this somewhere safer entirely.
	 *
	 * @param string $base Absolute path, no trailing slash.
	 */
	$base = (string) apply_filters( 'openstation_stored_files_base_dir', $base );
	if ( (int) $user_id > 0 ) {
		return $base . '/' . (int) $user_id;
	}
	return $base;
}

/**
 * Create (idempotently) the storage base + per-user dir and drop
 * the protection files into the base. Returns the user dir path or
 * a `WP_Error` when the filesystem refuses.
 *
 * @param int $user_id Owner.
 * @return string|WP_Error
 */
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

	// Protection files in the base. `Require all denied` alone 500s
	// on Apache 2.2 and `Deny from all` alone is ignored on pure
	// 2.4 — the IfModule guards make one file serve both. nginx
	// ignores all of this; extensionless UUID names + PHP-gated
	// serving are the floor there (documented in
	// docs/files-on-desktop.md along with a `deny all` snippet).
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
		// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents
		file_put_contents( $htaccess, $rules );
	}
	foreach ( array( $base . '/index.php', $dir . '/index.php' ) as $index ) {
		if ( ! file_exists( $index ) ) {
			// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents
			file_put_contents( $index, "<?php // Silence is golden.\n" );
		}
	}
	return $dir;
}

/**
 * Whether `$disk_name` is a well-formed server-generated name
 * (UUID v4, dashes allowed, no dots or separators — nothing a
 * traversal could ride on).
 *
 * @param string $disk_name Candidate.
 * @return bool
 */
function openstation_stored_files_valid_disk_name( $disk_name ) {
	return (bool) preg_match( '/^[a-f0-9-]{16,64}$/', (string) $disk_name );
}

/**
 * Absolute path of a stored file's bytes, with containment guard.
 * Returns `null` when the row/disk name is malformed or the
 * resolved path escapes the storage base (defense in depth — the
 * disk-name regex should already make escape impossible).
 *
 * @param array $row Normalized stored-file row.
 * @return string|null
 */
function openstation_stored_file_path( $row ) {
	if ( ! is_array( $row ) || empty( $row['owner_id'] ) || empty( $row['disk_name'] ) ) {
		return null;
	}
	if ( ! openstation_stored_files_valid_disk_name( $row['disk_name'] ) ) {
		return null;
	}
	$base = openstation_stored_files_dir();
	$path = openstation_stored_files_dir( (int) $row['owner_id'] ) . '/' . $row['disk_name'];

	// realpath() fails on not-yet-existing leaves; canonicalize the
	// parent instead and re-attach the (regex-validated) leaf.
	$real_parent = realpath( dirname( $path ) );
	$real_base   = realpath( $base );
	if ( false === $real_parent || false === $real_base ) {
		// Parent doesn't exist yet (nothing uploaded) — path is
		// structurally safe per the regex; return as computed.
		return $path;
	}
	if ( 0 !== strpos( $real_parent . '/', $real_base . '/' ) ) {
		return null;
	}
	return $real_parent . '/' . $row['disk_name'];
}

/**
 * Insert a stored-file row for bytes ALREADY on disk (the REST
 * intake moves them there via `wp_handle_upload()` first).
 *
 * @param int   $owner_id Owner.
 * @param array $args     `display_name`, `disk_name`, `size_bytes`, `mime`.
 * @return int|WP_Error Row id.
 */
function openstation_stored_files_create( $owner_id, $args ) {
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

	/**
	 * Fires after a stored-file row is created (bytes are already
	 * on disk at this point).
	 *
	 * @param int $id       Stored-file id.
	 * @param int $owner_id Owner.
	 */
	do_action( 'openstation_stored_file_created', $id, $owner_id );

	return $id;
}

/**
 * Read one stored-file row.
 *
 * @param int $file_id Row id.
 * @return array|null
 */
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

/**
 * Coerce wpdb's stringly-typed row. Internal helper.
 *
 * @internal
 *
 * @param array $row Raw wpdb row.
 * @return array
 */
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

/**
 * Rename the display name. The caller enforces WHO may rename
 * (owner-only — see the store gate in `store.php`); this only
 * validates and writes.
 *
 * @param int    $file_id Row id.
 * @param string $name    New display name.
 * @return true|WP_Error
 */
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

	// Bump every placement pointing at the file so the heartbeat
	// re-delivers each with a fresh `file.title` — same lock-step
	// rule the folder rename uses (tile titles are captured on the
	// placement shape, not read live).
	$wpdb->query(
		$wpdb->prepare(
			"UPDATE {$tables['placements']} SET updated_at_ms = %d
			WHERE file_type = %s AND file_ref = %s",
			$now,
			'upload',
			(string) $row['id']
		)
	);

	/**
	 * Fires after a stored file is renamed.
	 *
	 * @param int    $file_id  Stored-file id.
	 * @param string $new_name New display name.
	 * @param string $old_name Previous display name.
	 */
	do_action( 'openstation_stored_file_renamed', (int) $row['id'], $name, (string) $row['display_name'] );

	return true;
}

/**
 * Trash-gate filter (priority 20 — after the folder-share gate):
 * an `upload` placement is trashable ONLY by the stored file's
 * owner. Folder write-collaborators are read + download on
 * uploads; the `canTrash` shape flag, the trash flow, and the
 * recycle-bin drop target all consult this same filter.
 *
 * @param bool  $can     Decision so far.
 * @param int   $user_id Acting user.
 * @param array $row     Placement row.
 * @return bool
 */
function openstation_stored_files_gate_trash( $can, $user_id, $row ) {
	if ( ! is_array( $row ) || 'upload' !== (string) ( $row['file_type'] ?? '' ) ) {
		return $can;
	}
	$stored = openstation_stored_files_get( (int) $row['file_ref'] );
	if ( ! $stored ) {
		return $can; // Dangling tile — normal rules, so it stays cleanable.
	}
	return (int) $stored['owner_id'] === (int) $user_id;
}
add_filter( 'openstation_files_user_can_trash_placement', 'openstation_stored_files_gate_trash', 20, 3 );

/**
 * Delete a stored file: bytes first, then the row. Does NOT touch
 * placements — callers that need the full cascade go through
 * {@see openstation_stored_files_purge()}.
 *
 * @param int $file_id Row id.
 * @return true|WP_Error
 */
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

	/**
	 * Fires after a stored file (row + bytes) is deleted.
	 *
	 * @param int   $file_id Stored-file id.
	 * @param array $row     The row as it was before deletion.
	 */
	do_action( 'openstation_stored_file_deleted', (int) $row['id'], $row );

	return true;
}

/**
 * Full purge: delete the bytes, the row, every remaining placement
 * of the file (each with a tombstone so heartbeat scrubs recipient
 * tiles live), and every `target_type='file'` share row.
 *
 * @param int $file_id Row id.
 * @return true|WP_Error
 */
function openstation_stored_files_purge( $file_id ) {
	global $wpdb;
	$file_id = (int) $file_id;
	$row     = openstation_stored_files_get( $file_id );
	if ( ! $row ) {
		return new WP_Error( 'openstation_stored_files_not_found', __( 'Stored file not found.', 'desktop-mode' ), array( 'status' => 404 ) );
	}
	$tables = openstation_files_table_names();

	// Remaining placements (trashed included — the file is going
	// away for good, a recycle-bin restore must not resurrect a
	// tile pointing at deleted bytes).
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

	// File shares (target_type='file'). The shares table keys the
	// target id on the historically-named `folder_id` column.
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

/**
 * Sum of stored bytes for one owner.
 *
 * @param int $owner_id Owner.
 * @return int
 */
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

/**
 * Per-user quota in bytes. 0 = unlimited (the default). Sites
 * enforce a cap via the filter; the REST intake consults this
 * before accepting a new file.
 *
 * @param int $user_id User.
 * @return int
 */
function openstation_stored_files_user_quota_bytes( $user_id ) {
	/**
	 * Filters the per-user storage quota in bytes. Return 0 for
	 * unlimited.
	 *
	 * @param int $quota   Quota in bytes. Default 0 (unlimited).
	 * @param int $user_id User being checked.
	 */
	return max( 0, (int) apply_filters( 'openstation_stored_files_user_quota_bytes', 0, (int) $user_id ) );
}

/**
 * Capability required to upload. Defaults to WordPress's own
 * `upload_files`; sites that want desktop storage for lower-cap
 * roles loosen via the filter.
 *
 * @return string
 */
function openstation_stored_files_upload_capability() {
	/**
	 * Filters the capability required to upload desktop files.
	 *
	 * @param string $capability Default 'upload_files'.
	 */
	return (string) apply_filters( 'openstation_stored_files_upload_capability', 'upload_files' );
}

/**
 * Access resolver: can `$user_id` read (view / download) this
 * stored file?
 *
 *   - The owner always can.
 *   - A user with an accepted `target_type='file'` share can.
 *   - A user with at least read capability on any folder that
 *     contains a live placement of the file can (shared-folder
 *     contents are visible to the folder's audience).
 *
 * @param int $file_id Stored-file id.
 * @param int $user_id Viewer.
 * @return bool
 */
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

	// Accepted direct file share.
	if ( function_exists( 'openstation_stored_file_share_state' ) ) {
		if ( 'accepted' === openstation_stored_file_share_state( $file_id, $user_id ) ) {
			return true;
		}
	}

	// Read+ capability on a folder containing a live placement.
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

	/**
	 * Last-mile override for stored-file read access. Plugins with
	 * their own sharing concepts can widen (or veto) here.
	 *
	 * @param bool  $can     Resolved decision so far (false).
	 * @param int   $file_id Stored-file id.
	 * @param int   $user_id Viewer.
	 * @param array $row     Stored-file row.
	 */
	return (bool) apply_filters( 'openstation_stored_file_can_read', false, $file_id, $user_id, $row );
}

/**
 * Placement-removal listener — the deletion contract.
 *
 * When an `upload` placement is PERMANENTLY removed and the row's
 * owner is the stored file's owner, check whether the owner has any
 * placement of the file left (trashed ones count — they can be
 * restored). If none remain, the file is unreachable for its owner:
 * purge bytes, row, shares, and every recipient placement.
 *
 * Recipient placements going away never delete bytes.
 *
 * @param int   $placement_id Removed placement id.
 * @param array $row          The removed row.
 */
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
		return; // A recipient's tile went away; bytes stay.
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

/**
 * Daily reconciliation sweep, both directions:
 *
 *   a) Rows with no placement at all (crashed uploads, interrupted
 *      purges) older than the grace period → delete row + bytes.
 *   b) Bytes on disk with no matching row (interrupted deletes)
 *      whose mtime is older than the grace period → delete bytes.
 *
 * Rows whose bytes are missing are left alone — `exists()` still
 * renders the tile so the user can see and remove it.
 */
function openstation_stored_files_reconcile() {
	global $wpdb;
	$tables = openstation_files_table_names();
	$grace  = DAY_IN_SECONDS;

	// a) Placement-less rows past grace.
	$cutoff_ms = openstation_files_now_ms() - ( $grace * 1000 );
	$orphans   = $wpdb->get_col(
		$wpdb->prepare(
			"SELECT sf.id FROM {$tables['stored_files']} sf
			LEFT JOIN {$tables['placements']} p
				ON p.file_type = 'upload'
				AND p.file_ref = CAST( sf.id AS CHAR )
			WHERE p.id IS NULL
				AND sf.created_at_ms < %d",
			$cutoff_ms
		)
	);
	foreach ( (array) $orphans as $orphan_id ) {
		openstation_stored_files_delete( (int) $orphan_id );
	}

	// b) Row-less bytes past grace. The flat layout makes this a
	// two-level scan: <base>/<user_id>/<disk_name>.
	$base = openstation_stored_files_dir();
	if ( ! is_dir( $base ) ) {
		return;
	}
	$user_dirs = glob( $base . '/*', GLOB_ONLYDIR );
	foreach ( (array) $user_dirs as $user_dir ) {
		$owner_id = (int) basename( $user_dir );
		if ( $owner_id <= 0 ) {
			continue;
		}
		$known     = $wpdb->get_col(
			$wpdb->prepare(
				"SELECT disk_name FROM {$tables['stored_files']} WHERE owner_id = %d",
				$owner_id
			)
		);
		$known_set = array_flip( array_map( 'strval', (array) $known ) );
		$entries   = glob( $user_dir . '/*' );
		foreach ( (array) $entries as $entry ) {
			$name = basename( $entry );
			if ( 'index.php' === $name || ! is_file( $entry ) ) {
				continue;
			}
			if ( isset( $known_set[ $name ] ) ) {
				continue;
			}
			if ( ! openstation_stored_files_valid_disk_name( $name ) ) {
				continue; // Not ours — leave foreign files alone.
			}
			$mtime = (int) filemtime( $entry );
			if ( $mtime > 0 && ( time() - $mtime ) > $grace ) {
				wp_delete_file( $entry );
			}
		}
	}
}
add_action( 'desktop_mode_files_daily_prune', 'openstation_stored_files_reconcile' );

/**
 * When a WordPress user is deleted, purge their stored files (rows,
 * bytes, shares, recipient placements) and remove their directory.
 *
 * @param int $user_id Deleted user id.
 */
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
		// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_rmdir
		@rmdir( $dir ); // Only succeeds when empty — leftovers are the sweep's job.
	}
}
add_action( 'deleted_user', 'openstation_stored_files_handle_deleted_user' );
