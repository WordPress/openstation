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

	$now = desktop_mode_files_now_ms();
	$wpdb->update(
		$tables['placements'],
		array(
			'trashed_at_ms' => $now,
			'trashed_by'    => $user_id,
			'updated_at_ms' => $now,
		),
		array( 'id' => $placement_id ),
		array( '%d', '%d', '%d' ),
		array( '%d' )
	);

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

	// If the parent folder is itself trashed, refuse — the user
	// must restore the parent first. Prevents zombie placements.
	$parent_id = (int) $row['parent_id'];
	if ( $parent_id > 0 ) {
		$parent_trashed = (int) $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(*) FROM {$tables['folders']} WHERE id = %d AND trashed_at_ms IS NOT NULL",
				$parent_id
			)
		);
		if ( $parent_trashed > 0 ) {
			return new WP_Error(
				'desktop_mode_files_parent_trashed',
				__( 'Restore the parent folder first.', 'desktop-mode' ),
				array( 'status' => 409 )
			);
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
			'trashed_at_ms'      => null,
			'trashed_by'         => null,
			'trashed_via_folder' => null,
			'updated_at_ms'      => desktop_mode_files_now_ms(),
		),
		array( 'id' => $placement_id ),
		array( null, null, null, '%d' ),
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
	// Trash the folder row.
	$wpdb->update(
		$tables['folders'],
		array(
			'trashed_at_ms' => $now,
			'trashed_by'    => $user_id,
			'updated_at_ms' => $now,
		),
		array( 'id' => $folder_id ),
		array( '%d', '%d', '%d' ),
		array( '%d' )
	);
	// Cascade to child placements that are still active. Mark
	// `trashed_via_folder` so the restore knows which children to
	// resurrect. Already-trashed children keep their state.
	$wpdb->query(
		$wpdb->prepare(
			"UPDATE {$tables['placements']}
			SET trashed_at_ms = %d,
				trashed_by = %d,
				trashed_via_folder = %d,
				updated_at_ms = %d
			WHERE parent_id = %d
				AND trashed_at_ms IS NULL",
			$now,
			$user_id,
			$folder_id,
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
			'updated_at_ms' => $now,
		),
		array( 'id' => $folder_id ),
		array( null, null, '%d' ),
		array( '%d' )
	);
	// Restore placements that this folder's trash had cascaded.
	$wpdb->query(
		$wpdb->prepare(
			"UPDATE {$tables['placements']}
			SET trashed_at_ms = NULL,
				trashed_by = NULL,
				trashed_via_folder = NULL,
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
