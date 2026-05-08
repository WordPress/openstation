<?php
/**
 * Desktop Mode — Files-on-the-Desktop trash + restore + purge.
 *
 * Both placements and folders soft-trash before they ever hit the
 * physical row delete. Trashed rows live in the same tables (with
 * `trashed_at_ms` / `trashed_by` columns set; `trashed_via_folder`
 * on placements when the trash cascaded from a folder), so:
 *
 *   - Active queries always filter `trashed_at_ms IS NULL`.
 *   - The recycle bin lists `trashed_at_ms IS NOT NULL`.
 *   - Restore is a single column flip; no row resurrection.
 *   - Folder restore brings back its trashed-via-cascade children
 *     by their `trashed_via_folder` marker, so the original layout
 *     is preserved with no fuzzy time-window heuristics.
 *
 * Every public function gates on a permission filter and emits
 * before/after actions. Plugins can:
 *
 *   - Veto any trash / restore / purge (`*_user_can_*` filters).
 *   - Observe any state transition (`*_before_*` / `*_after_*`).
 *   - React to recycle-bin list / restore / purge of the new types
 *     via the existing recycle-bin hooks (`desktop_mode_recycle_bin_*`).
 *
 * @package WPDesktopMode
 * @since   0.8.0
 */

defined( 'ABSPATH' ) || exit;

/* ================================================================== *
 *  Capability gates.
 * ================================================================== */

/**
 * Whether the given user can trash a placement they own. Defaults
 * to ownership; plugins can broaden via filter.
 *
 * @since 0.8.0
 *
 * @param int   $user_id Acting user.
 * @param array $row     Placement row (raw from DB or normalized).
 * @return bool
 */
function desktop_mode_files_user_can_trash_placement( $user_id, $row ) {
	$user_id = (int) $user_id;
	$can     = ( $user_id > 0 )
		&& isset( $row['user_id'] )
		&& (int) $row['user_id'] === $user_id;
	/**
	 * Filter whether the user can trash this placement.
	 *
	 * @since 0.8.0
	 *
	 * @param bool  $can     Default: ownership match.
	 * @param int   $user_id Acting user.
	 * @param array $row     Placement row.
	 */
	return (bool) apply_filters(
		'desktop_mode_files_user_can_trash_placement',
		$can,
		$user_id,
		$row
	);
}

/**
 * Whether the given user can restore a trashed placement.
 *
 * @since 0.8.0
 *
 * @param int   $user_id Acting user.
 * @param array $row     Placement row (already trashed).
 * @return bool
 */
function desktop_mode_files_user_can_restore_placement( $user_id, $row ) {
	$user_id = (int) $user_id;
	$can     = ( $user_id > 0 )
		&& isset( $row['user_id'] )
		&& (int) $row['user_id'] === $user_id;
	/**
	 * @since 0.8.0
	 *
	 * @param bool  $can
	 * @param int   $user_id
	 * @param array $row
	 */
	return (bool) apply_filters(
		'desktop_mode_files_user_can_restore_placement',
		$can,
		$user_id,
		$row
	);
}

/**
 * Whether the given user can permanently purge a trashed placement.
 *
 * @since 0.8.0
 */
function desktop_mode_files_user_can_purge_placement( $user_id, $row ) {
	$user_id = (int) $user_id;
	$can     = ( $user_id > 0 )
		&& isset( $row['user_id'] )
		&& (int) $row['user_id'] === $user_id;
	/**
	 * @since 0.8.0
	 *
	 * @param bool  $can
	 * @param int   $user_id
	 * @param array $row
	 */
	return (bool) apply_filters(
		'desktop_mode_files_user_can_purge_placement',
		$can,
		$user_id,
		$row
	);
}

/**
 * Whether the given user can trash a folder. Default: folder owner.
 *
 * @since 0.8.0
 */
function desktop_mode_files_user_can_trash_folder( $user_id, $row ) {
	$user_id = (int) $user_id;
	$can     = ( $user_id > 0 )
		&& isset( $row['owner_id'] )
		&& (int) $row['owner_id'] === $user_id;
	/**
	 * @since 0.8.0
	 *
	 * @param bool  $can
	 * @param int   $user_id
	 * @param array $row
	 */
	return (bool) apply_filters(
		'desktop_mode_files_user_can_trash_folder',
		$can,
		$user_id,
		$row
	);
}

/**
 * Whether the given user can restore a trashed folder.
 *
 * @since 0.8.0
 */
function desktop_mode_files_user_can_restore_folder( $user_id, $row ) {
	$user_id = (int) $user_id;
	$can     = ( $user_id > 0 )
		&& isset( $row['owner_id'] )
		&& (int) $row['owner_id'] === $user_id;
	/**
	 * @since 0.8.0
	 *
	 * @param bool  $can
	 * @param int   $user_id
	 * @param array $row
	 */
	return (bool) apply_filters(
		'desktop_mode_files_user_can_restore_folder',
		$can,
		$user_id,
		$row
	);
}

/**
 * Whether the given user can permanently purge a trashed folder.
 *
 * @since 0.8.0
 */
function desktop_mode_files_user_can_purge_folder( $user_id, $row ) {
	$user_id = (int) $user_id;
	$can     = ( $user_id > 0 )
		&& isset( $row['owner_id'] )
		&& (int) $row['owner_id'] === $user_id;
	/**
	 * @since 0.8.0
	 *
	 * @param bool  $can
	 * @param int   $user_id
	 * @param array $row
	 */
	return (bool) apply_filters(
		'desktop_mode_files_user_can_purge_folder',
		$can,
		$user_id,
		$row
	);
}

/* ================================================================== *
 *  Ancestry snapshot + resurrection.
 *
 *  When a placement is soft-trashed we capture every folder in
 *  its parent chain into a JSON blob on `placements.trashed_meta`.
 *  Restoring later walks that chain top-down: folders that are
 *  still alive are reused, trashed folders cascade-restore, and
 *  hard-deleted folders are recreated (with new ids; the chain is
 *  rewritten as it walks). The placement comes back at the same
 *  visual position inside the (possibly resurrected) parent.
 * ================================================================== */

/**
 * Walk up `$parent_id` through the folders + placements tables and
 * return the parent chain root-first.
 *
 * Each entry shape:
 *
 *     array(
 *         'folder_id'           => int,
 *         'folder_name'         => string,
 *         'folder_share_mode'   => string,
 *         'folder_share_meta'   => array|null,
 *         'folder_owner_id'     => int,
 *         'placement_parent_id' => int, // parent of this folder's placement
 *         'placement_x'         => int,
 *         'placement_y'         => int,
 *     )
 *
 * Returns `[]` for a root-level placement (`$parent_id === 0`).
 *
 * @since 0.8.0
 *
 * @param int $parent_id Immediate parent folder id.
 * @return array<int, array<string, mixed>>
 */
function desktop_mode_files_capture_ancestry( $parent_id ) {
	global $wpdb;
	$tables = desktop_mode_files_table_names();
	$chain  = array();
	$cursor = (int) $parent_id;
	$guard  = 0; // depth-bound — defends against accidental cycles.
	while ( $cursor > 0 && $guard < 32 ) {
		++$guard;
		$folder = $wpdb->get_row(
			$wpdb->prepare(
				"SELECT * FROM {$tables['folders']} WHERE id = %d",
				$cursor
			),
			ARRAY_A
		);
		if ( ! $folder ) {
			break;
		}
		// The folder's "where I sit on the desktop tree" lives on
		// its placement row. Pick any active or trashed placement
		// of this folder — we just need its parent_id + (x, y).
		$placement = $wpdb->get_row(
			$wpdb->prepare(
				"SELECT parent_id, x, y FROM {$tables['placements']}
				WHERE file_type = 'folder' AND file_ref = %s
				ORDER BY id ASC LIMIT 1",
				(string) $folder['id']
			),
			ARRAY_A
		);
		$share_meta_raw = isset( $folder['share_meta'] ) ? (string) $folder['share_meta'] : '';
		$share_meta     = '' !== $share_meta_raw ? json_decode( $share_meta_raw, true ) : null;
		$entry = array(
			'folder_id'           => (int) $folder['id'],
			'folder_name'         => (string) $folder['name'],
			'folder_share_mode'   => (string) $folder['share_mode'],
			'folder_share_meta'   => is_array( $share_meta ) ? $share_meta : null,
			'folder_owner_id'     => (int) $folder['owner_id'],
			'placement_parent_id' => $placement ? (int) $placement['parent_id'] : 0,
			'placement_x'         => $placement ? (int) $placement['x'] : 0,
			'placement_y'         => $placement ? (int) $placement['y'] : 0,
		);
		array_unshift( $chain, $entry ); // root-first.
		$cursor = $entry['placement_parent_id'];
	}
	return $chain;
}

/**
 * Walk an ancestry snapshot top-down and return the resolved
 * leaf folder id — every missing or trashed folder along the way
 * is resurrected. The map of `original_id => resolved_id` lets
 * downstream entries rewrite their `placement_parent_id` so a
 * deeper folder lands inside the correct (possibly recreated)
 * parent.
 *
 * @since 0.8.0
 *
 * @param int   $user_id  Acting user (used as owner for any
 *                        recreated folder).
 * @param array $ancestry Root-first chain captured at trash time.
 * @return int Resolved leaf parent id (0 when the placement was
 *             at desktop root).
 */
function desktop_mode_files_resurrect_ancestry( $user_id, $ancestry ) {
	if ( empty( $ancestry ) ) {
		return 0;
	}
	$user_id  = (int) $user_id;
	$id_map   = array(); // original_id => resolved_id.
	$resolved = 0;
	foreach ( $ancestry as $entry ) {
		$orig_id  = (int) $entry['folder_id'];
		$orig_par = (int) $entry['placement_parent_id'];
		// Rewrite: if our snapshot's recorded parent was ALSO an
		// ancestor we recreated, use the new id.
		$resolved_parent = isset( $id_map[ $orig_par ] )
			? (int) $id_map[ $orig_par ]
			: $orig_par;

		$folder = desktop_mode_files_get_folder( $orig_id, true );
		if ( $folder ) {
			// Folder still exists. If trashed, restore it (cascade
			// brings back its own children that were trashed via
			// folder cascade).
			if ( ! empty( $folder['trashed_at_ms'] ) ) {
				desktop_mode_files_restore_folder( $user_id, $orig_id );
			}
			$id_map[ $orig_id ] = $orig_id;
			$resolved           = $orig_id;
			continue;
		}

		// Folder is gone — recreate it and place it under the
		// resolved parent. Owner falls back to the acting user
		// when the original owner can't be inferred (shared-
		// folder edge case Phase 6 will revisit).
		$owner_id = (int) ( $entry['folder_owner_id'] ?: $user_id );
		$new_id   = desktop_mode_files_create_folder( $owner_id, array(
			'name'       => (string) $entry['folder_name'],
			'share_mode' => (string) $entry['folder_share_mode'],
			'share_meta' => $entry['folder_share_meta'],
		) );
		if ( is_wp_error( $new_id ) ) {
			// Fall back to root — restoring at the wrong place is
			// strictly better than failing the restore outright.
			$resolved = $resolved_parent;
			$id_map[ $orig_id ] = $resolved;
			continue;
		}
		// Place the recreated folder where the snapshot says.
		desktop_mode_files_place(
			$user_id,
			$resolved_parent,
			'folder',
			(string) $new_id,
			array(
				'x' => (int) $entry['placement_x'],
				'y' => (int) $entry['placement_y'],
			)
		);
		$id_map[ $orig_id ] = (int) $new_id;
		$resolved           = (int) $new_id;
	}
	return $resolved;
}

/* ================================================================== *
 *  Placement: trash / restore / purge.
 * ================================================================== */

/**
 * Soft-trash a placement. Sets `trashed_at_ms`, `trashed_by`. Returns
 * `true` on success, `WP_Error` on permission failure / missing row.
 *
 * Idempotent: trashing an already-trashed placement is a no-op
 * success.
 *
 * @since 0.8.0
 *
 * @param int $user_id      Acting user.
 * @param int $placement_id Placement id.
 * @return true|WP_Error
 */
function desktop_mode_files_trash_placement( $user_id, $placement_id ) {
	global $wpdb;
	$user_id      = (int) $user_id;
	$placement_id = (int) $placement_id;
	$tables       = desktop_mode_files_table_names();

	$row = $wpdb->get_row(
		$wpdb->prepare(
			"SELECT * FROM {$tables['placements']} WHERE id = %d",
			$placement_id
		),
		ARRAY_A
	);
	if ( ! $row ) {
		return new WP_Error(
			'desktop_mode_files_placement_not_found',
			__( 'Placement not found.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}
	if ( null !== $row['trashed_at_ms'] && '' !== $row['trashed_at_ms'] ) {
		return true;
	}
	if ( ! desktop_mode_files_user_can_trash_placement( $user_id, $row ) ) {
		return new WP_Error(
			'desktop_mode_files_forbidden',
			__( 'You do not have permission to trash this item.', 'desktop-mode' ),
			array( 'status' => 403 )
		);
	}

	/**
	 * Fires before a placement is trashed.
	 *
	 * @since 0.8.0
	 *
	 * @param int   $placement_id Placement id.
	 * @param int   $user_id      Acting user.
	 * @param array $row          Placement row.
	 */
	do_action( 'desktop_mode_files_before_trash_placement', $placement_id, $user_id, $row );

	$now      = desktop_mode_files_now_ms();
	$ancestry = desktop_mode_files_capture_ancestry( (int) $row['parent_id'] );
	$meta     = wp_json_encode( array( 'ancestry' => $ancestry ) );
	$result   = $wpdb->update(
		$tables['placements'],
		array(
			'trashed_at_ms' => $now,
			'trashed_by'    => $user_id,
			'trashed_meta'  => $meta,
			'updated_at_ms' => $now,
		),
		array( 'id' => $placement_id ),
		array( '%d', '%d', '%s', '%d' ),
		array( '%d' )
	);
	// `$wpdb->update` returns `false` on schema mismatch (e.g. the
	// migration didn't add the column the function writes to). The
	// REST layer would otherwise translate the silent no-op into a
	// 200 OK and the UI would show "moved to trash" with nothing
	// actually trashed.
	if ( false === $result ) {
		return new WP_Error(
			'desktop_mode_files_trash_failed',
			isset( $wpdb->last_error ) && $wpdb->last_error
				? (string) $wpdb->last_error
				: __( 'Failed to write trash row.', 'desktop-mode' ),
			array( 'status' => 500 )
		);
	}

	/**
	 * Fires after a placement is trashed.
	 *
	 * @since 0.8.0
	 *
	 * @param int $placement_id Placement id.
	 * @param int $user_id      Acting user.
	 */
	do_action( 'desktop_mode_files_after_trash_placement', $placement_id, $user_id );

	return true;
}

/**
 * Restore a trashed placement back to its original folder + (x, y).
 *
 * @since 0.8.0
 *
 * @param int $user_id      Acting user.
 * @param int $placement_id Placement id.
 * @return true|WP_Error
 */
function desktop_mode_files_restore_placement( $user_id, $placement_id ) {
	global $wpdb;
	$user_id      = (int) $user_id;
	$placement_id = (int) $placement_id;
	$tables       = desktop_mode_files_table_names();

	$row = $wpdb->get_row(
		$wpdb->prepare(
			"SELECT * FROM {$tables['placements']} WHERE id = %d",
			$placement_id
		),
		ARRAY_A
	);
	if ( ! $row ) {
		return new WP_Error(
			'desktop_mode_files_placement_not_found',
			__( 'Placement not found.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}
	if ( null === $row['trashed_at_ms'] || '' === $row['trashed_at_ms'] ) {
		return true; // Already active — idempotent.
	}
	if ( ! desktop_mode_files_user_can_restore_placement( $user_id, $row ) ) {
		return new WP_Error(
			'desktop_mode_files_forbidden',
			__( 'You do not have permission to restore this item.', 'desktop-mode' ),
			array( 'status' => 403 )
		);
	}

	// Resolve the parent folder. Three branches:
	//   - parent is alive  → reuse the same id
	//   - parent is trashed → cascade-restore it (and rest of the
	//                         chain) before placing the leaf
	//   - parent is gone    → walk the captured ancestry and
	//                         recreate every missing folder in
	//                         the chain
	$original_parent_id = (int) $row['parent_id'];
	$resolved_parent_id = $original_parent_id;
	if ( $original_parent_id > 0 ) {
		$parent_alive = desktop_mode_files_get_folder( $original_parent_id, true );
		if ( $parent_alive ) {
			if ( ! empty( $parent_alive['trashed_at_ms'] ) ) {
				// Cascade restore — reach into the snapshot the
				// folder itself stored at trash time so any chain
				// above it is also resurrected.
				$folder_restore = desktop_mode_files_restore_folder( $user_id, $original_parent_id );
				if ( is_wp_error( $folder_restore ) ) {
					return $folder_restore;
				}
			}
			$resolved_parent_id = $original_parent_id;
		} else {
			// Hard-deleted parent — read the ancestry snapshot we
			// stored at trash time and resurrect the chain.
			$meta_raw = isset( $row['trashed_meta'] ) ? (string) $row['trashed_meta'] : '';
			$decoded  = '' !== $meta_raw ? json_decode( $meta_raw, true ) : null;
			$ancestry = ( is_array( $decoded ) && isset( $decoded['ancestry'] ) && is_array( $decoded['ancestry'] ) )
				? $decoded['ancestry']
				: array();
			$resolved_parent_id = desktop_mode_files_resurrect_ancestry( $user_id, $ancestry );
		}
	}

	/**
	 * Fires before a placement is restored.
	 *
	 * @since 0.8.0
	 *
	 * @param int   $placement_id
	 * @param int   $user_id
	 * @param array $row
	 */
	do_action( 'desktop_mode_files_before_restore_placement', $placement_id, $user_id, $row );

	$wpdb->update(
		$tables['placements'],
		array(
			'parent_id'          => $resolved_parent_id,
			'trashed_at_ms'      => null,
			'trashed_by'         => null,
			'trashed_via_folder' => null,
			'trashed_meta'       => null,
			'updated_at_ms'      => desktop_mode_files_now_ms(),
		),
		array( 'id' => $placement_id ),
		array( '%d', null, null, null, null, '%d' ),
		array( '%d' )
	);

	/**
	 * @since 0.8.0
	 *
	 * @param int $placement_id
	 * @param int $user_id
	 */
	do_action( 'desktop_mode_files_after_restore_placement', $placement_id, $user_id );

	return true;
}

/**
 * Permanently delete a trashed placement.
 *
 * @since 0.8.0
 *
 * @param int $user_id
 * @param int $placement_id
 * @return true|WP_Error
 */
function desktop_mode_files_purge_placement( $user_id, $placement_id ) {
	global $wpdb;
	$user_id      = (int) $user_id;
	$placement_id = (int) $placement_id;
	$tables       = desktop_mode_files_table_names();

	$row = $wpdb->get_row(
		$wpdb->prepare(
			"SELECT * FROM {$tables['placements']} WHERE id = %d",
			$placement_id
		),
		ARRAY_A
	);
	if ( ! $row ) {
		return true; // Already gone — idempotent.
	}
	if ( ! desktop_mode_files_user_can_purge_placement( $user_id, $row ) ) {
		return new WP_Error(
			'desktop_mode_files_forbidden',
			__( 'You do not have permission to delete this item.', 'desktop-mode' ),
			array( 'status' => 403 )
		);
	}

	/**
	 * @since 0.8.0
	 *
	 * @param int   $placement_id
	 * @param int   $user_id
	 * @param array $row
	 */
	do_action( 'desktop_mode_files_before_purge_placement', $placement_id, $user_id, $row );

	$wpdb->delete( $tables['placements'], array( 'id' => $placement_id ), array( '%d' ) );

	/**
	 * @since 0.8.0
	 *
	 * @param int $placement_id
	 * @param int $user_id
	 */
	do_action( 'desktop_mode_files_after_purge_placement', $placement_id, $user_id );

	return true;
}

/* ================================================================== *
 *  Folder: trash / restore / purge (cascades to child placements).
 * ================================================================== */

/**
 * Soft-trash a folder. Cascades to every child placement (any
 * placement whose `parent_id = folder_id`), marking them with
 * `trashed_via_folder = folder_id` so a later restore brings back
 * the same set without time-window heuristics.
 *
 * Idempotent on already-trashed.
 *
 * @since 0.8.0
 *
 * @param int $user_id
 * @param int $folder_id
 * @return true|WP_Error
 */
function desktop_mode_files_trash_folder( $user_id, $folder_id ) {
	global $wpdb;
	$user_id   = (int) $user_id;
	$folder_id = (int) $folder_id;
	$tables    = desktop_mode_files_table_names();

	$row = $wpdb->get_row(
		$wpdb->prepare(
			"SELECT * FROM {$tables['folders']} WHERE id = %d",
			$folder_id
		),
		ARRAY_A
	);
	if ( ! $row ) {
		return new WP_Error(
			'desktop_mode_files_folder_not_found',
			__( 'Folder not found.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}
	if ( null !== $row['trashed_at_ms'] && '' !== $row['trashed_at_ms'] ) {
		return true;
	}
	if ( ! desktop_mode_files_user_can_trash_folder( $user_id, $row ) ) {
		return new WP_Error(
			'desktop_mode_files_forbidden',
			__( 'You do not have permission to trash this folder.', 'desktop-mode' ),
			array( 'status' => 403 )
		);
	}

	/**
	 * @since 0.8.0
	 *
	 * @param int   $folder_id
	 * @param int   $user_id
	 * @param array $row
	 */
	do_action( 'desktop_mode_files_before_trash_folder', $folder_id, $user_id, $row );

	$now = desktop_mode_files_now_ms();
	// Capture the folder's own placement-chain ancestry so a future
	// restore can resurrect any parent folders that got hard-deleted
	// while this one was sitting in trash.
	$folder_placement = $wpdb->get_row(
		$wpdb->prepare(
			"SELECT parent_id FROM {$tables['placements']}
			WHERE file_type = 'folder' AND file_ref = %s
			ORDER BY id ASC LIMIT 1",
			(string) $folder_id
		),
		ARRAY_A
	);
	$folder_ancestry = $folder_placement
		? desktop_mode_files_capture_ancestry( (int) $folder_placement['parent_id'] )
		: array();
	$folder_meta = wp_json_encode( array( 'ancestry' => $folder_ancestry ) );

	// Trash the folder row.
	$folder_update = $wpdb->update(
		$tables['folders'],
		array(
			'trashed_at_ms' => $now,
			'trashed_by'    => $user_id,
			'trashed_meta'  => $folder_meta,
			'updated_at_ms' => $now,
		),
		array( 'id' => $folder_id ),
		array( '%d', '%d', '%s', '%d' ),
		array( '%d' )
	);
	if ( false === $folder_update ) {
		return new WP_Error(
			'desktop_mode_files_trash_failed',
			isset( $wpdb->last_error ) && $wpdb->last_error
				? (string) $wpdb->last_error
				: __( 'Failed to trash folder.', 'desktop-mode' ),
			array( 'status' => 500 )
		);
	}
	// Cascade to child placements that are still active. Mark
	// `trashed_via_folder` so the restore knows which children to
	// resurrect. Already-trashed children keep their state.
	//
	// Each child also gets its own ancestry snapshot so restoring
	// just one child later (after the parent folder was hard-
	// deleted) can still recreate the chain — same shape as a
	// direct trash. Captured per-row because every child shares
	// the same parent chain, so we compute once.
	$ancestry = desktop_mode_files_capture_ancestry( $folder_id );
	$meta     = wp_json_encode( array( 'ancestry' => $ancestry ) );
	$wpdb->query(
		$wpdb->prepare(
			"UPDATE {$tables['placements']}
			SET trashed_at_ms = %d,
				trashed_by = %d,
				trashed_via_folder = %d,
				trashed_meta = %s,
				updated_at_ms = %d
			WHERE parent_id = %d
				AND trashed_at_ms IS NULL",
			$now,
			$user_id,
			$folder_id,
			$meta,
			$now,
			$folder_id
		)
	);
	// Cascade trash to nested folders too. Recurses one level via
	// IDs; deep folder trees iterate.
	$child_folder_ids = $wpdb->get_col(
		$wpdb->prepare(
			"SELECT id FROM {$tables['folders']} f
			INNER JOIN {$tables['placements']} p ON p.file_type = 'folder' AND p.file_ref = CAST( f.id AS CHAR )
			WHERE p.parent_id = %d AND f.trashed_at_ms IS NULL",
			$folder_id
		)
	);
	foreach ( (array) $child_folder_ids as $child_id ) {
		desktop_mode_files_trash_folder( $user_id, (int) $child_id );
	}

	/**
	 * @since 0.8.0
	 *
	 * @param int $folder_id
	 * @param int $user_id
	 */
	do_action( 'desktop_mode_files_after_trash_folder', $folder_id, $user_id );

	return true;
}

/**
 * Restore a trashed folder + every placement that was trashed via
 * its cascade. Items that were trashed BEFORE the folder cascade
 * (i.e. `trashed_via_folder IS NULL`) stay in the recycle bin —
 * the user trashed them deliberately, separate from the folder.
 *
 * @since 0.8.0
 *
 * @param int $user_id
 * @param int $folder_id
 * @return true|WP_Error
 */
function desktop_mode_files_restore_folder( $user_id, $folder_id ) {
	global $wpdb;
	$user_id   = (int) $user_id;
	$folder_id = (int) $folder_id;
	$tables    = desktop_mode_files_table_names();

	$row = $wpdb->get_row(
		$wpdb->prepare(
			"SELECT * FROM {$tables['folders']} WHERE id = %d",
			$folder_id
		),
		ARRAY_A
	);
	if ( ! $row ) {
		return new WP_Error(
			'desktop_mode_files_folder_not_found',
			__( 'Folder not found.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}
	if ( null === $row['trashed_at_ms'] || '' === $row['trashed_at_ms'] ) {
		return true;
	}
	if ( ! desktop_mode_files_user_can_restore_folder( $user_id, $row ) ) {
		return new WP_Error(
			'desktop_mode_files_forbidden',
			__( 'You do not have permission to restore this folder.', 'desktop-mode' ),
			array( 'status' => 403 )
		);
	}

	/**
	 * @since 0.8.0
	 *
	 * @param int   $folder_id
	 * @param int   $user_id
	 * @param array $row
	 */
	do_action( 'desktop_mode_files_before_restore_folder', $folder_id, $user_id, $row );

	$now = desktop_mode_files_now_ms();
	// Snapshot nested folder ids BEFORE we null `trashed_via_folder`
	// on the placements — that column is the only stable link from
	// a child folder's placement back to the parent cascade.
	$nested_ids = $wpdb->get_col(
		$wpdb->prepare(
			"SELECT DISTINCT CAST( p.file_ref AS UNSIGNED ) AS fid
			FROM {$tables['placements']} p
			WHERE p.file_type = 'folder'
				AND p.parent_id = %d
				AND p.trashed_via_folder = %d",
			$folder_id,
			$folder_id
		)
	);

	$wpdb->update(
		$tables['folders'],
		array(
			'trashed_at_ms' => null,
			'trashed_by'    => null,
			'trashed_meta'  => null,
			'updated_at_ms' => $now,
		),
		array( 'id' => $folder_id ),
		array( null, null, null, '%d' ),
		array( '%d' )
	);
	// If the folder's own placement points at a parent_id that's
	// been hard-deleted in the meantime, resurrect the chain from
	// the snapshot taken at trash time.
	$meta_raw = isset( $row['trashed_meta'] ) ? (string) $row['trashed_meta'] : '';
	$decoded  = '' !== $meta_raw ? json_decode( $meta_raw, true ) : null;
	$ancestry = ( is_array( $decoded ) && isset( $decoded['ancestry'] ) && is_array( $decoded['ancestry'] ) )
		? $decoded['ancestry']
		: array();
	if ( ! empty( $ancestry ) ) {
		$folder_placement_row = $wpdb->get_row(
			$wpdb->prepare(
				"SELECT id, parent_id FROM {$tables['placements']}
				WHERE file_type = 'folder' AND file_ref = %s
				ORDER BY id ASC LIMIT 1",
				(string) $folder_id
			),
			ARRAY_A
		);
		if ( $folder_placement_row ) {
			$origin_parent = (int) $folder_placement_row['parent_id'];
			$alive         = $origin_parent > 0
				? desktop_mode_files_get_folder( $origin_parent, true )
				: null;
			if ( $origin_parent > 0 && ! $alive ) {
				$resolved = desktop_mode_files_resurrect_ancestry( $user_id, $ancestry );
				$wpdb->update(
					$tables['placements'],
					array(
						'parent_id'     => $resolved,
						'updated_at_ms' => $now,
					),
					array( 'id' => (int) $folder_placement_row['id'] ),
					array( '%d', '%d' ),
					array( '%d' )
				);
			}
		}
	}
	// Restore placements that this folder's trash had cascaded.
	$wpdb->query(
		$wpdb->prepare(
			"UPDATE {$tables['placements']}
			SET trashed_at_ms = NULL,
				trashed_by = NULL,
				trashed_via_folder = NULL,
				trashed_meta = NULL,
				updated_at_ms = %d
			WHERE trashed_via_folder = %d",
			$now,
			$folder_id
		)
	);
	// Recursively restore nested folders captured in the snapshot.
	foreach ( (array) $nested_ids as $nid ) {
		desktop_mode_files_restore_folder( $user_id, (int) $nid );
	}

	/**
	 * @since 0.8.0
	 *
	 * @param int $folder_id
	 * @param int $user_id
	 */
	do_action( 'desktop_mode_files_after_restore_folder', $folder_id, $user_id );

	return true;
}

/**
 * Permanently delete a trashed folder and all its trashed-via-
 * cascade child placements. Independent placements that landed in
 * the trash separately stay there.
 *
 * @since 0.8.0
 *
 * @param int $user_id
 * @param int $folder_id
 * @return true|WP_Error
 */
function desktop_mode_files_purge_folder( $user_id, $folder_id ) {
	global $wpdb;
	$user_id   = (int) $user_id;
	$folder_id = (int) $folder_id;
	$tables    = desktop_mode_files_table_names();

	$row = $wpdb->get_row(
		$wpdb->prepare(
			"SELECT * FROM {$tables['folders']} WHERE id = %d",
			$folder_id
		),
		ARRAY_A
	);
	if ( ! $row ) {
		return true;
	}
	if ( ! desktop_mode_files_user_can_purge_folder( $user_id, $row ) ) {
		return new WP_Error(
			'desktop_mode_files_forbidden',
			__( 'You do not have permission to delete this folder.', 'desktop-mode' ),
			array( 'status' => 403 )
		);
	}

	/**
	 * @since 0.8.0
	 *
	 * @param int   $folder_id
	 * @param int   $user_id
	 * @param array $row
	 */
	do_action( 'desktop_mode_files_before_purge_folder', $folder_id, $user_id, $row );

	$wpdb->delete(
		$tables['placements'],
		array( 'trashed_via_folder' => $folder_id ),
		array( '%d' )
	);
	$wpdb->delete( $tables['folders'], array( 'id' => $folder_id ), array( '%d' ) );

	/**
	 * @since 0.8.0
	 *
	 * @param int $folder_id
	 * @param int $user_id
	 */
	do_action( 'desktop_mode_files_after_purge_folder', $folder_id, $user_id );

	return true;
}

/* ================================================================== *
 *  Recycle-bin list builder.
 * ================================================================== */

/**
 * Count of trashed placements + folders surfaced to the recycle bin
 * for `$user_id`. Mirrors `_list_trashed_for_recycle_bin`'s "skip
 * cascaded children" rule so the badge matches the visible list.
 *
 * @since 0.8.0
 *
 * @param int $user_id Owner.
 * @return int
 */
function desktop_mode_files_count_trashed_for_recycle_bin( $user_id ) {
	global $wpdb;
	$user_id = (int) $user_id;
	if ( $user_id <= 0 ) {
		return 0;
	}
	$tables = desktop_mode_files_table_names();

	$placements = (int) $wpdb->get_var(
		$wpdb->prepare(
			"SELECT COUNT(*) FROM {$tables['placements']}
			WHERE user_id = %d
				AND trashed_at_ms IS NOT NULL
				AND trashed_via_folder IS NULL",
			$user_id
		)
	);
	$folders = (int) $wpdb->get_var(
		$wpdb->prepare(
			"SELECT COUNT(*) FROM {$tables['folders']}
			WHERE owner_id = %d AND trashed_at_ms IS NOT NULL",
			$user_id
		)
	);
	return $placements + $folders;
}

/**
 * Return the trashed placements + folders for a user, shaped as
 * recycle-bin items. Used by the recycle bin's REST list endpoint
 * to merge files-on-the-desktop trash with the WP-core trash.
 *
 * @since 0.8.0
 *
 * @param int $user_id Owner.
 * @return array[] List of recycle-bin item shapes.
 */
function desktop_mode_files_list_trashed_for_recycle_bin( $user_id ) {
	global $wpdb;
	$user_id = (int) $user_id;
	$tables  = desktop_mode_files_table_names();
	$out     = array();

	// Trashed placements owned by this user.
	$placements = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT * FROM {$tables['placements']}
			WHERE user_id = %d AND trashed_at_ms IS NOT NULL
			ORDER BY trashed_at_ms DESC",
			$user_id
		),
		ARRAY_A
	);
	foreach ( (array) $placements as $row ) {
		// Skip cascaded children — the parent folder represents
		// the whole bundle in the recycle bin.
		if ( ! empty( $row['trashed_via_folder'] ) ) {
			continue;
		}
		$file = function_exists( 'desktop_mode_resolve_file' )
			? desktop_mode_resolve_file( $row['file_type'], $row['file_ref'] )
			: null;
		$title = $file ? (string) $file->title() : (string) $row['file_type'];
		$icon  = $file ? (string) $file->icon() : 'dashicons-no-alt';
		// Two recycle-bin buckets:
		//   - `shortcut`  → plugin-registered icons (file_type='shortcut')
		//   - `placement` → every other placement (post / page /
		//                   attachment / user / term / comment / …)
		// Lets the bin's type-filter tabs split "Shortcuts" from
		// "Files" without overloading either label.
		$bucket = ( 'shortcut' === (string) $row['file_type'] )
			? 'shortcut'
			: 'placement';
		$subtitle = ( 'shortcut' === $bucket )
			? __( 'Desktop shortcut', 'desktop-mode' )
			: sprintf(
				/* translators: %s: file-type slug like 'post', 'attachment'. */
				__( '%s on desktop', 'desktop-mode' ),
				(string) $row['file_type']
			);
		$out[] = array(
			'id'            => (int) $row['id'],
			'type'          => $bucket,
			'title'         => $title,
			'subtitle'      => $subtitle,
			'mime'          => '',
			'preview'       => $file ? (string) $file->preview_url() : '',
			'icon'          => $icon,
			'deleted_at'    => gmdate( 'c', (int) round( (int) $row['trashed_at_ms'] / 1000 ) ),
			'deleted_by'    => '',
			'deleted_by_id' => (int) $row['trashed_by'],
			'can_restore'   => desktop_mode_files_user_can_restore_placement( $user_id, $row ),
			'can_purge'     => desktop_mode_files_user_can_purge_placement( $user_id, $row ),
			'edit_link'     => '',
		);
	}

	// Trashed folders owned by this user.
	$folders = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT * FROM {$tables['folders']}
			WHERE owner_id = %d AND trashed_at_ms IS NOT NULL
			ORDER BY trashed_at_ms DESC",
			$user_id
		),
		ARRAY_A
	);
	foreach ( (array) $folders as $row ) {
		$child_count = (int) $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(*) FROM {$tables['placements']}
				WHERE trashed_via_folder = %d",
				(int) $row['id']
			)
		);
		$out[] = array(
			'id'            => (int) $row['id'],
			'type'          => 'folder',
			'title'         => (string) $row['name'],
			'subtitle'      => $child_count > 0
				? sprintf(
					/* translators: %d: number of items inside the trashed folder. */
					_n( 'Folder · %d item inside', 'Folder · %d items inside', $child_count, 'desktop-mode' ),
					$child_count
				)
				: __( 'Folder · empty', 'desktop-mode' ),
			'mime'          => '',
			'preview'       => '',
			'icon'          => 'dashicons-portfolio',
			'deleted_at'    => gmdate( 'c', (int) round( (int) $row['trashed_at_ms'] / 1000 ) ),
			'deleted_by'    => '',
			'deleted_by_id' => (int) $row['trashed_by'],
			'can_restore'   => desktop_mode_files_user_can_restore_folder( $user_id, $row ),
			'can_purge'     => desktop_mode_files_user_can_purge_folder( $user_id, $row ),
			'edit_link'     => '',
		);
	}

	// Resolve display-name for the deleted-by id once per user.
	$user_cache = array();
	foreach ( $out as &$item ) {
		$uid = (int) $item['deleted_by_id'];
		if ( $uid <= 0 ) {
			continue;
		}
		if ( ! isset( $user_cache[ $uid ] ) ) {
			$u                 = get_userdata( $uid );
			$user_cache[ $uid ] = $u ? $u->display_name : '';
		}
		$item['deleted_by'] = $user_cache[ $uid ];
	}
	unset( $item );

	return $out;
}
