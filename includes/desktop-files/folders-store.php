<?php
/**
 * Desktop Mode — Folders store.
 *
 * CRUD primitives for the `_desktop_mode_folders` table. Folders
 * are first-class files: they have an owner, a name, a share
 * mode, and a JSON `share_meta` column carrying the user / role
 * lists when `share_mode` is `users` or `roles`.
 *
 * Phase 2 ships private folders only. Phase 6 lights up the
 * other share modes plus the `desktop_mode_files_visible_folders`
 * filter that gates which folders a viewer can see.
 *
 * @package WPDesktopMode
 * @since   0.9.0
 */

defined( 'ABSPATH' ) || exit;

/** Allowed share-mode values. */
function desktop_mode_files_share_modes() {
	$modes = array( 'private', 'users', 'roles', 'all' );
	/**
	 * Filter the allowed `share_mode` values. Plugins can add
	 * (e.g. 'team') by registering both the value here and a
	 * matching visibility callback.
	 *
	 * @since 0.9.0
	 *
	 * @param string[] $modes Default modes.
	 */
	return (array) apply_filters( 'desktop_mode_files_share_modes', $modes );
}

/**
 * Create a folder.
 *
 * @since 0.9.0
 *
 * @param int   $owner_id Owner.
 * @param array $args     `name`, `share_mode`, `share_meta`.
 * @return int|WP_Error Folder id on success.
 */
function desktop_mode_files_create_folder( $owner_id, $args = array() ) {
	global $wpdb;

	$owner_id = (int) $owner_id;
	if ( $owner_id <= 0 ) {
		return new WP_Error( 'desktop_mode_files_invalid_user', __( 'A user id is required.', 'desktop-mode' ), array( 'status' => 400 ) );
	}

	$args = wp_parse_args( $args, array(
		'name'       => '',
		'share_mode' => 'private',
		'share_meta' => null,
	) );

	$name = sanitize_text_field( (string) $args['name'] );
	if ( '' === $name ) {
		return new WP_Error( 'desktop_mode_files_missing_name', __( 'Folder name is required.', 'desktop-mode' ), array( 'status' => 400 ) );
	}

	$mode  = (string) $args['share_mode'];
	$modes = desktop_mode_files_share_modes();
	if ( ! in_array( $mode, $modes, true ) ) {
		return new WP_Error( 'desktop_mode_files_invalid_share_mode', __( 'Invalid share mode.', 'desktop-mode' ), array( 'status' => 400, 'mode' => $mode ) );
	}

	$tables = desktop_mode_files_table_names();
	$now    = desktop_mode_files_now_ms();
	$row    = array(
		'owner_id'      => $owner_id,
		'name'          => $name,
		'share_mode'    => $mode,
		'share_meta'    => null === $args['share_meta'] ? null : wp_json_encode( $args['share_meta'] ),
		'updated_at_ms' => $now,
	);

	$ok = $wpdb->insert( $tables['folders'], $row, array( '%d', '%s', '%s', '%s', '%d' ) );
	if ( false === $ok ) {
		return new WP_Error( 'desktop_mode_files_insert_failed', __( 'Failed to create folder.', 'desktop-mode' ), array( 'status' => 500 ) );
	}
	$id = (int) $wpdb->insert_id;

	$row['id'] = $id;

	/**
	 * Fires after a folder is created.
	 *
	 * @since 0.9.0
	 *
	 * @param int   $id  Folder id.
	 * @param array $row Inserted row.
	 */
	do_action( 'desktop_mode_folder_created', $id, $row );

	return $id;
}

/**
 * Update a folder. Only the owner can update for now.
 *
 * @since 0.9.0
 *
 * @param int   $folder_id Folder id.
 * @param int   $user_id   Acting user.
 * @param array $changes   `name`, `share_mode`, `share_meta`.
 * @return true|WP_Error
 */
function desktop_mode_files_update_folder( $folder_id, $user_id, $changes = array() ) {
	global $wpdb;

	$folder_id = (int) $folder_id;
	$user_id   = (int) $user_id;
	$prev      = desktop_mode_files_get_folder( $folder_id );
	if ( ! $prev ) {
		return new WP_Error( 'desktop_mode_files_not_found', __( 'Folder not found.', 'desktop-mode' ), array( 'status' => 404 ) );
	}
	if ( (int) $prev['owner_id'] !== $user_id ) {
		return new WP_Error( 'desktop_mode_files_forbidden', __( 'You cannot edit this folder.', 'desktop-mode' ), array( 'status' => 403 ) );
	}

	$set = array();
	$fmt = array();

	if ( isset( $changes['name'] ) ) {
		$name = sanitize_text_field( (string) $changes['name'] );
		if ( '' === $name ) {
			return new WP_Error( 'desktop_mode_files_missing_name', __( 'Folder name cannot be empty.', 'desktop-mode' ), array( 'status' => 400 ) );
		}
		$set['name'] = $name;
		$fmt[]       = '%s';
	}
	if ( isset( $changes['share_mode'] ) ) {
		$mode  = (string) $changes['share_mode'];
		$modes = desktop_mode_files_share_modes();
		if ( ! in_array( $mode, $modes, true ) ) {
			return new WP_Error( 'desktop_mode_files_invalid_share_mode', __( 'Invalid share mode.', 'desktop-mode' ), array( 'status' => 400 ) );
		}
		$set['share_mode'] = $mode;
		$fmt[]             = '%s';
	}
	if ( array_key_exists( 'share_meta', $changes ) ) {
		$set['share_meta'] = null === $changes['share_meta'] ? null : wp_json_encode( $changes['share_meta'] );
		$fmt[]             = '%s';
	}
	if ( empty( $set ) ) {
		return true;
	}

	$now                  = desktop_mode_files_now_ms();
	$set['updated_at_ms'] = $now;
	$fmt[]                = '%d';

	$tables = desktop_mode_files_table_names();
	$ok     = $wpdb->update( $tables['folders'], $set, array( 'id' => $folder_id ), $fmt, array( '%d' ) );
	if ( false === $ok ) {
		return new WP_Error( 'desktop_mode_files_update_failed', __( 'Failed to update folder.', 'desktop-mode' ), array( 'status' => 500 ) );
	}

	// Propagate rename to every placement that POINTS AT this folder
	// (file_type='folder', file_ref=folder_id) by bumping their
	// updated_at_ms so the heartbeat re-delivers them with a fresh
	// `file.title`. Without this, the folder row's updated_at_ms
	// bumps but the placements pointing at it don't, the heartbeat
	// `placements` query skips them, and recipient tiles keep showing
	// the OLD name until F5. The folder upsert alone is not enough —
	// the tile title is captured on `placement.file.title` at shape
	// time, and the client renders from the placement, not from the
	// folder row.
	if ( isset( $changes['name'] ) ) {
		/**
		 * Filter the placement rows whose `updated_at_ms` should be
		 * bumped when a folder is renamed. Default = every placement
		 * with `file_type='folder'` AND `file_ref=$folder_id` —
		 * every viewer's copy of the folder tile.
		 *
		 * Plugins that synthesize folder-like placements with a
		 * different `file_type` (e.g. an "alias" placement) can join
		 * the propagation by returning a non-null SQL fragment via
		 * this filter. Return `null` to opt OUT entirely (rare).
		 *
		 * @since 0.18.x
		 *
		 * @param string $where     Default WHERE clause body.
		 * @param int    $folder_id Folder being renamed.
		 * @param int    $user_id   Acting user (folder owner).
		 */
		$where = (string) apply_filters(
			'desktop_mode_folder_rename_bump_where',
			$wpdb->prepare(
				"file_type = 'folder' AND file_ref = %s",
				(string) $folder_id
			),
			$folder_id,
			$user_id
		);
		if ( '' !== $where ) {
			// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			$wpdb->query(
				$wpdb->prepare(
					"UPDATE {$tables['placements']} SET updated_at_ms = %d WHERE {$where}",
					$now
				)
			);
		}

		/**
		 * Fires after a folder has been renamed and the pointing
		 * placements have been bumped. Subscribers can react (e.g.
		 * dispatch their own cross-window broadcasts, refresh sidebar
		 * displays of the folder name).
		 *
		 * @since 0.18.x
		 *
		 * @param int    $folder_id Folder id.
		 * @param string $new_name  New name (sanitized).
		 * @param string $old_name  Previous name.
		 * @param int    $user_id   Acting user (folder owner).
		 */
		do_action(
			'desktop_mode_folder_renamed',
			$folder_id,
			(string) $set['name'],
			(string) $prev['name'],
			$user_id
		);
	}

	$next = desktop_mode_files_get_folder( $folder_id );

	/**
	 * Fires after a folder is updated.
	 *
	 * @since 0.9.0
	 *
	 * @param int   $id   Folder id.
	 * @param array $next Row after.
	 * @param array $prev Row before.
	 */
	do_action( 'desktop_mode_folder_updated', $folder_id, $next, $prev );

	if ( isset( $changes['share_mode'] ) || array_key_exists( 'share_meta', $changes ) ) {
		/**
		 * Fires after a folder's share state changes (mode or
		 * meta). Plugins listening for sharing events can subscribe
		 * to this rather than diff `desktop_mode_folder_updated`.
		 *
		 * @since 0.9.0
		 *
		 * @param int   $id   Folder id.
		 * @param array $next Row after.
		 * @param array $prev Row before.
		 */
		do_action( 'desktop_mode_folder_shared', $folder_id, $next, $prev );
	}

	return true;
}

/**
 * Delete a folder. Owner-only.
 *
 * Cleanup cascades cover every piece of state that points at the
 * folder so a deletion leaves no orphans:
 *
 *   1. Sub-folders the owner owns get recursively deleted — their
 *      own shares, placements, and nested children clean up via the
 *      same recursive call. (Sub-folders OWNED BY ANOTHER USER —
 *      e.g. a writer recipient created their own folder inside a
 *      shared folder — are left alone; only their placement inside
 *      this folder is removed.)
 *   2. Every share row + per-user decision row for this folder is
 *      deleted, so recipients stop seeing it via the heartbeat's
 *      visible-folders set.
 *   3. Every placement POINTING AT this folder (file_type='folder',
 *      file_ref=$folder_id) is deleted across ALL users — including
 *      recipients' root placements created by their `accept`. Each
 *      gets a tombstone so the heartbeat removes the tile from
 *      every connected client.
 *   4. Every placement INSIDE the folder (parent_id=$folder_id) is
 *      deleted with tombstones.
 *   5. The folder row itself is deleted with a folder tombstone.
 *
 * @since 0.9.0
 *
 * @param int $folder_id Folder id.
 * @param int $user_id   Acting user.
 * @return true|WP_Error
 */
function desktop_mode_files_delete_folder( $folder_id, $user_id ) {
	$folder_id = (int) $folder_id;
	$user_id   = (int) $user_id;
	$row       = desktop_mode_files_get_folder( $folder_id );
	if ( ! $row ) {
		return new WP_Error( 'desktop_mode_files_not_found', __( 'Folder not found.', 'desktop-mode' ), array( 'status' => 404 ) );
	}
	if ( (int) $row['owner_id'] !== $user_id ) {
		return new WP_Error( 'desktop_mode_files_forbidden', __( 'You cannot delete this folder.', 'desktop-mode' ), array( 'status' => 403 ) );
	}

	/**
	 * Filter whether a folder delete is allowed to proceed. Default
	 * is `true` once the ownership check above has passed. Return
	 * `false` or a `WP_Error` to abort.
	 *
	 * Practical uses:
	 *   - Block delete when a folder has too many recipients (UX
	 *     guard for accidental cascades).
	 *   - Require a confirmation token / nonce stored in the user's
	 *     session.
	 *
	 * @since 0.18.x
	 *
	 * @param bool|WP_Error $can       Default `true`.
	 * @param int           $folder_id Folder id about to be deleted.
	 * @param int           $user_id   Acting user (folder owner).
	 * @param array         $row       Folder row.
	 */
	$can = apply_filters(
		'desktop_mode_files_can_delete_folder',
		true,
		$folder_id,
		$user_id,
		$row
	);
	if ( is_wp_error( $can ) ) {
		return $can;
	}
	if ( true !== $can ) {
		return new WP_Error(
			'desktop_mode_files_delete_vetoed',
			__( 'A plugin blocked this folder from being deleted.', 'desktop-mode' ),
			array( 'status' => 403 )
		);
	}

	/**
	 * Fires before the cascade delete walks the folder's sub-tree.
	 * Listeners can persist a snapshot, log an audit entry, or
	 * stage a notification to recipients ("the folder you had
	 * access to is being deleted in 10 s").
	 *
	 * @since 0.18.x
	 *
	 * @param int   $folder_id Folder being deleted.
	 * @param int   $user_id   Acting user.
	 * @param array $row       Folder row.
	 */
	do_action( 'desktop_mode_files_before_delete_folder', $folder_id, $user_id, $row );

	$visited = array();
	$summary = array(
		'folders_deleted'        => array(),
		'shares_revoked'         => array(),
		'placements_pointing'    => array(),
		'placements_inside'      => array(),
	);
	$result = desktop_mode_files_delete_folder_recursive( $folder_id, $user_id, $visited, $summary );
	if ( is_wp_error( $result ) ) {
		return $result;
	}

	/**
	 * Fires after the cascade delete completes, with a summary of
	 * every row that was removed. Useful for cross-window broadcast,
	 * recycle-bin badge updates, audit logging.
	 *
	 * `$summary`:
	 *   - `folders_deleted`      — folder ids removed (root + sub).
	 *   - `shares_revoked`       — share ids revoked.
	 *   - `placements_pointing`  — placement ids removed (rows with
	 *                              `file_type='folder'` pointing at
	 *                              any deleted folder, across users).
	 *   - `placements_inside`    — placement ids removed (contents of
	 *                              the deleted folders).
	 *
	 * @since 0.18.x
	 *
	 * @param int   $folder_id Root folder of the cascade.
	 * @param int   $user_id   Acting user.
	 * @param array $summary   Cascade summary (see above).
	 */
	do_action(
		'desktop_mode_files_after_delete_folder_cascade',
		$folder_id,
		$user_id,
		$summary
	);

	return true;
}

/**
 * Recursive worker for {@see desktop_mode_files_delete_folder}.
 *
 * Walks the folder's sub-tree (sub-folders the same owner owns),
 * then on the way back up cleans up share rows, decisions,
 * pointing-at placements, contained placements, and the folder
 * row itself. Tombstones are written for every removed row so the
 * heartbeat tells connected clients what's gone.
 *
 * `$visited` guards against cycles in case the placement graph is
 * ever corrupted with one. The owner check happens at the public
 * entry point above; this worker trusts its caller.
 *
 * @since 0.18.x
 * @internal
 *
 * @param int   $folder_id Folder id to delete.
 * @param int   $user_id   Owner.
 * @param array $visited   Folder ids already processed.
 * @return true|WP_Error
 */
function desktop_mode_files_delete_folder_recursive( $folder_id, $user_id, &$visited, &$summary = null ) {
	global $wpdb;
	$folder_id = (int) $folder_id;
	if ( isset( $visited[ $folder_id ] ) ) {
		return true;
	}
	$visited[ $folder_id ] = true;
	$row = desktop_mode_files_get_folder( $folder_id );
	if ( ! $row ) {
		return true;
	}

	$tables = desktop_mode_files_table_names();
	if ( null === $summary || ! is_array( $summary ) ) {
		$summary = array(
			'folders_deleted'        => array(),
			'shares_revoked'         => array(),
			'placements_pointing'    => array(),
			'placements_inside'      => array(),
		);
	}

	// 1) Recurse into sub-folders the owner owns. A sub-folder
	//    owned by SOMEONE ELSE (e.g. a writer recipient who built
	//    their own folder inside this one) is left intact —
	//    deleting the parent only severs the containment for the
	//    owner; the sub-folder's owner can still reach it through
	//    their own placements.
	$sub_folder_refs = (array) $wpdb->get_col(
		$wpdb->prepare(
			"SELECT DISTINCT file_ref FROM {$tables['placements']}
			WHERE parent_id = %d
				AND file_type = 'folder'",
			$folder_id
		)
	);
	foreach ( $sub_folder_refs as $ref ) {
		$sub_id = (int) $ref;
		if ( $sub_id <= 0 || $sub_id === $folder_id ) {
			continue;
		}
		$sub_row = desktop_mode_files_get_folder( $sub_id );
		if ( $sub_row && (int) $sub_row['owner_id'] === $user_id ) {
			desktop_mode_files_delete_folder_recursive( $sub_id, $user_id, $visited, $summary );
		}
	}

	// 2) Revoke every share for this folder: shares table + per-
	//    user decisions table. The folder is going away, so the
	//    rows are obsolete; leaving them would let the heartbeat
	//    keep delivering a `removed` tombstone for ghost rows.
	$share_rows = (array) $wpdb->get_results(
		$wpdb->prepare(
			"SELECT * FROM {$tables['shares']} WHERE folder_id = %d",
			$folder_id
		),
		ARRAY_A
	);
	$share_ids = array();
	foreach ( $share_rows as $share_row ) {
		$share_ids[] = (int) $share_row['id'];
	}
	if ( ! empty( $share_ids ) ) {
		$placeholders = implode( ',', array_fill( 0, count( $share_ids ), '%d' ) );
		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		$wpdb->query(
			$wpdb->prepare(
				"DELETE FROM {$tables['decisions']} WHERE share_id IN ($placeholders)",
				$share_ids
			)
		);
		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		$wpdb->query(
			$wpdb->prepare(
				"DELETE FROM {$tables['shares']} WHERE id IN ($placeholders)",
				$share_ids
			)
		);
		// Fire the same share-revoked action each individual revoke
		// would have fired, so plugins listening for that signal
		// don't have to also subscribe to the cascade-specific
		// hook. `$row` carries the pre-delete share data so
		// listeners can read principal / capability for audit.
		foreach ( $share_rows as $share_row ) {
			/** @see desktop_mode_folder_share_revoke */
			do_action(
				'desktop_mode_files_share_revoked',
				(int) $share_row['id'],
				$share_row,
				$user_id
			);
		}
		$summary['shares_revoked'] = array_merge(
			$summary['shares_revoked'],
			$share_ids
		);
	}

	// 3) Placements POINTING AT this folder (every recipient's
	//    accept-created root placement, plus the owner's own).
	$pointing_ids = (array) $wpdb->get_col(
		$wpdb->prepare(
			"SELECT id FROM {$tables['placements']}
			WHERE file_type = 'folder' AND file_ref = %s",
			(string) $folder_id
		)
	);
	foreach ( $pointing_ids as $pid ) {
		desktop_mode_files_write_tombstone( 'placement', (int) $pid );
	}
	if ( ! empty( $pointing_ids ) ) {
		$placeholders = implode( ',', array_fill( 0, count( $pointing_ids ), '%d' ) );
		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		$wpdb->query(
			$wpdb->prepare(
				"DELETE FROM {$tables['placements']} WHERE id IN ($placeholders)",
				$pointing_ids
			)
		);
		$summary['placements_pointing'] = array_merge(
			$summary['placements_pointing'],
			array_map( 'intval', $pointing_ids )
		);
	}

	// 4) Placements INSIDE this folder. After step 1 the sub-folder
	//    placements have been recursively handled for owner-owned
	//    sub-folders; whatever remains here (loose post / link /
	//    user / etc. placements, plus orphan folder placements
	//    whose folder we did NOT recurse into because someone else
	//    owns it) gets deleted with a tombstone each.
	$inside_ids = (array) $wpdb->get_col(
		$wpdb->prepare(
			"SELECT id FROM {$tables['placements']} WHERE parent_id = %d",
			$folder_id
		)
	);
	foreach ( $inside_ids as $cid ) {
		desktop_mode_files_write_tombstone( 'placement', (int) $cid );
	}
	if ( ! empty( $inside_ids ) ) {
		$wpdb->delete( $tables['placements'], array( 'parent_id' => $folder_id ), array( '%d' ) );
		$summary['placements_inside'] = array_merge(
			$summary['placements_inside'],
			array_map( 'intval', $inside_ids )
		);
	}

	// 5) The folder row itself + its tombstone.
	$ok = $wpdb->delete( $tables['folders'], array( 'id' => $folder_id ), array( '%d' ) );
	if ( false === $ok ) {
		return new WP_Error( 'desktop_mode_files_delete_failed', __( 'Failed to delete folder.', 'desktop-mode' ), array( 'status' => 500 ) );
	}
	desktop_mode_files_write_tombstone( 'folder', $folder_id );
	$summary['folders_deleted'][] = $folder_id;

	/**
	 * Fires after a folder is deleted. Plugins listening for share
	 * lifecycle can subscribe alongside
	 * `desktop_mode_files_share_revoked` if they want to react to
	 * cascade-revokes triggered by folder deletion.
	 *
	 * @since 0.9.0
	 *
	 * @param int   $id  Folder id.
	 * @param array $row Removed row.
	 */
	do_action( 'desktop_mode_folder_deleted', $folder_id, $row );

	return true;
}

/**
 * Lookup a folder row by id.
 *
 * @since 0.9.0
 *
 * @param int $folder_id Folder id.
 * @return array|null
 */
function desktop_mode_files_get_folder( $folder_id, $include_trashed = false ) {
	global $wpdb;
	$tables = desktop_mode_files_table_names();
	$row    = $wpdb->get_row(
		$wpdb->prepare( "SELECT * FROM {$tables['folders']} WHERE id = %d", (int) $folder_id ),
		ARRAY_A
	);
	if ( ! $row ) {
		return null;
	}
	// Trashed folders are invisible to active code paths by
	// default — recycle-bin callers pass `true` to opt in.
	if ( ! $include_trashed && ! empty( $row['trashed_at_ms'] ) ) {
		return null;
	}
	return desktop_mode_files_normalize_folder_row( $row );
}

/**
 * Folders visible to `$user_id`. Phase 2 ships private only —
 * the viewer is the owner. Phase 6 expands this with the
 * `desktop_mode_files_visible_folders` filter.
 *
 * @since 0.9.0
 *
 * @param int $user_id Viewer.
 * @return array[]
 */
function desktop_mode_files_get_visible_folders( $user_id ) {
	global $wpdb;
	$user_id = (int) $user_id;
	if ( $user_id <= 0 ) {
		return array();
	}

	$tables = desktop_mode_files_table_names();
	$rows   = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT * FROM {$tables['folders']}
			WHERE owner_id = %d AND trashed_at_ms IS NULL",
			$user_id
		),
		ARRAY_A
	);
	$out = array();
	foreach ( (array) $rows as $row ) {
		$out[] = desktop_mode_files_normalize_folder_row( $row );
	}

	/**
	 * Filter the folders visible to a viewer. Phase 6's sharing
	 * logic merges shared folders onto this list.
	 *
	 * @since 0.9.0
	 *
	 * @param array[] $folders Folders the viewer owns.
	 * @param int     $user_id Viewer.
	 */
	return (array) apply_filters( 'desktop_mode_files_visible_folders', $out, $user_id );
}

/**
 * @since 0.9.0
 * @internal
 *
 * @param array $row Raw wpdb row.
 * @return array
 */
function desktop_mode_files_normalize_folder_row( $row ) {
	$meta_raw = isset( $row['share_meta'] ) ? (string) $row['share_meta'] : '';
	$meta     = '' !== $meta_raw ? json_decode( $meta_raw, true ) : null;
	return array(
		'id'            => (int) $row['id'],
		'owner_id'      => (int) $row['owner_id'],
		'name'          => (string) $row['name'],
		'share_mode'    => (string) $row['share_mode'],
		'share_meta'    => is_array( $meta ) ? $meta : null,
		'updated_at_ms' => (int) $row['updated_at_ms'],
	);
}
