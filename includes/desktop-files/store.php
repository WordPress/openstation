<?php
/**
 * Desktop Mode — Files placement store.
 *
 * CRUD primitives for the `_desktop_mode_file_placements` table.
 * Every read goes through `desktop_mode_files_query_args` so
 * plugins can scope what's visible (mirror of the recycle-bin's
 * filter pattern). Every write fires before / after actions so
 * other plugins can react and so Phase 6's Heartbeat sync has a
 * single subscription point.
 *
 * Capability gate is per-call: callers pass the `$user_id` they
 * intend to act for; the function consults
 * `desktop_mode_files_can_place` (filter) and the file's
 * `Desktop_Mode_File::can_read()` before writing.
 *
 * Tombstones are written for every successful remove / move-out
 * so the Phase-6 Heartbeat delta knows what to send.
 *
 * @package WPDesktopMode
 * @since   0.9.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Insert a placement.
 *
 * @since 0.9.0
 *
 * @param int    $user_id   Owner of the placement (the user the
 *                          tile lives on).
 * @param int    $parent_id Folder id, or 0 for the desktop root.
 * @param string $type      File-type slug.
 * @param string $ref       Entity reference.
 * @param array  $args      Optional. `x`, `y`, `sort_order`, `meta`.
 * @return int|WP_Error Placement id on success, `WP_Error` otherwise.
 */
function desktop_mode_files_place( $user_id, $parent_id, $type, $ref, $args = array() ) {
	global $wpdb;

	$user_id   = (int) $user_id;
	$parent_id = (int) $parent_id;
	$type      = (string) $type;
	$ref       = (string) $ref;

	if ( $user_id <= 0 ) {
		return new WP_Error( 'desktop_mode_files_invalid_user', __( 'A user id is required.', 'desktop-mode' ), array( 'status' => 400 ) );
	}
	$entry = desktop_mode_get_file_type( $type );
	if ( ! $entry ) {
		return new WP_Error( 'desktop_mode_files_unknown_type', __( 'Unknown file type.', 'desktop-mode' ), array( 'status' => 400 ) );
	}

	/**
	 * Gate placement creation. Defaults to allowing the user to
	 * place any type they can read; plugins use this to enforce
	 * stricter rules (e.g. only admins may place users).
	 *
	 * @since 0.9.0
	 *
	 * @param bool   $can     Default: file's `can_read( $user_id )`.
	 * @param int    $user_id Owner.
	 * @param string $type    File-type slug.
	 * @param string $ref     Entity reference.
	 */
	$file = desktop_mode_resolve_file( $type, $ref );
	$can  = $file ? $file->can_read( $user_id ) : false;
	$can  = (bool) apply_filters( 'desktop_mode_files_can_place', $can, $user_id, $type, $ref );
	if ( ! $can ) {
		return new WP_Error( 'desktop_mode_files_forbidden', __( 'You are not allowed to place this file.', 'desktop-mode' ), array( 'status' => 403 ) );
	}

	// Write-gate: placing INTO a non-owned folder requires the
	// folder's `write` cap. Owner / desktop-root placements are
	// always allowed.
	if ( (int) $parent_id > 0 ) {
		$target_folder = desktop_mode_files_get_folder( (int) $parent_id );
		if ( $target_folder && (int) $target_folder['owner_id'] !== $user_id ) {
			$cap = function_exists( 'desktop_mode_folder_share_user_capability' )
				? desktop_mode_folder_share_user_capability( (int) $parent_id, $user_id )
				: 'none';
			if ( 'write' !== $cap ) {
				return new WP_Error(
					'desktop_mode_files_no_write_in_shared_folder',
					__( 'You only have read access to that folder.', 'desktop-mode' ),
					array( 'status' => 403 )
				);
			}
		}
	}

	$args = wp_parse_args(
		$args,
		array(
			'x'          => 0,
			'y'          => 0,
			'sort_order' => 0,
			'meta'       => null,
		)
	);

	$tables = desktop_mode_files_table_names();
	$now    = desktop_mode_files_now_ms();
	$row    = array(
		'user_id'       => $user_id,
		'parent_id'     => max( 0, $parent_id ),
		'file_type'     => $type,
		'file_ref'      => $ref,
		'x'             => (int) $args['x'],
		'y'             => (int) $args['y'],
		'sort_order'    => (int) $args['sort_order'],
		'updated_at_ms' => $now,
		'meta'          => null === $args['meta'] ? null : wp_json_encode( $args['meta'] ),
	);

	// Silence wpdb's HTML error block around the insert: a unique-key
	// collision is an expected (and recovered) outcome below, and the
	// default `WP_DEBUG_DISPLAY` behavior would otherwise prepend a
	// `<div class="wpdberror">…</div>` to the REST response body and
	// break `await response.json()` on the client. `$wpdb->last_error`
	// still holds the message, so genuine DB failures surface via the
	// `WP_Error` we return when no existing row is found.
	$prev_suppress = $wpdb->suppress_errors( true );
	$ok            = $wpdb->insert( $tables['placements'], $row, array( '%d', '%d', '%s', '%s', '%d', '%d', '%d', '%d', '%s' ) );
	$wpdb->suppress_errors( $prev_suppress );
	if ( false === $ok ) {
		// Disambiguate the two cases hidden behind a generic `false`:
		//   (a) The `placement_unique` index (since 0.8.0) collided
		//       with an existing row for this (user, parent, type,
		//       ref). The collider may be active (the orphan placer
		//       won a race against this caller, or a stale duplicate
		//       client request) or soft-trashed (the user removed a
		//       link tile and is now recreating the same URL).
		//   (b) Any other DB failure — connection, deadlock, bad
		//       column. The error must surface to the caller as-is.
		// We treat (a) idempotently: restore if trashed, then apply
		// the caller's coords / meta so the new placement lands
		// where the user clicked. Reported as #167.
		$existing = $wpdb->get_row(
			$wpdb->prepare(
				"SELECT * FROM {$tables['placements']}
				WHERE user_id = %d
					AND parent_id = %d
					AND file_type = %s
					AND file_ref = %s
				LIMIT 1",
				$user_id,
				max( 0, $parent_id ),
				$type,
				$ref
			),
			ARRAY_A
		);
		if ( ! $existing ) {
			return new WP_Error( 'desktop_mode_files_insert_failed', __( 'Failed to write placement.', 'desktop-mode' ), array( 'status' => 500 ) );
		}

		$existing_id = (int) $existing['id'];

		if ( ! empty( $existing['trashed_at_ms'] ) ) {
			$restore = desktop_mode_files_restore_placement( $user_id, $existing_id );
			if ( is_wp_error( $restore ) ) {
				return $restore;
			}
		}

		// Belt-and-suspenders: even on the non-trashed-revival branch
		// (caller re-placed an already-active row at new coords), any
		// stale tombstones for this id should be cleared so a fresh
		// heartbeat tick can't surface "alive + removed" together.
		// `restore_placement` already clears its own tombstones, so
		// this is a no-op in the soft-trashed branch above.
		desktop_mode_files_clear_tombstones_for( 'placement', $existing_id );

		$move = desktop_mode_files_move(
			$existing_id,
			$user_id,
			array(
				'parent_id'  => max( 0, $parent_id ),
				'x'          => (int) $args['x'],
				'y'          => (int) $args['y'],
				'sort_order' => (int) $args['sort_order'],
				'meta'       => $args['meta'],
			)
		);
		if ( is_wp_error( $move ) ) {
			return $move;
		}

		return $existing_id;
	}
	$id = (int) $wpdb->insert_id;

	$row['id'] = $id;

	/**
	 * Fires after a placement is created.
	 *
	 * @since 0.9.0
	 *
	 * @param int   $id  Placement id.
	 * @param array $row Inserted row.
	 */
	do_action( 'desktop_mode_file_placed', $id, $row );

	return $id;
}

/**
 * Move / mutate a placement. Pass `null` for fields that should
 * stay untouched.
 *
 * @since 0.9.0
 *
 * @param int   $placement_id Placement id.
 * @param int   $user_id      Acting user (for capability gate).
 * @param array $changes      `parent_id`, `x`, `y`, `sort_order`, `meta`.
 * @return true|WP_Error
 */
function desktop_mode_files_move( $placement_id, $user_id, $changes = array() ) {
	global $wpdb;

	$placement_id = (int) $placement_id;
	$user_id      = (int) $user_id;
	if ( $placement_id <= 0 || $user_id <= 0 ) {
		return new WP_Error( 'desktop_mode_files_bad_request', __( 'Invalid arguments.', 'desktop-mode' ), array( 'status' => 400 ) );
	}

	$row = desktop_mode_files_get_placement( $placement_id );
	if ( ! $row ) {
		return new WP_Error( 'desktop_mode_files_not_found', __( 'Placement not found.', 'desktop-mode' ), array( 'status' => 404 ) );
	}

	// Permission check. Owner of the row is always allowed. For
	// rows inside a shared folder, the FOLDER's write cap is the
	// gate — anyone with write on the folder can move/rearrange
	// every icon in it, regardless of which user originally placed
	// the row (shared-namespace semantics).
	$is_row_owner = (int) $row['user_id'] === $user_id;
	if ( (int) $row['parent_id'] > 0 ) {
		$source_folder = desktop_mode_files_get_folder( (int) $row['parent_id'] );
		if ( $source_folder ) {
			$is_folder_owner = (int) $source_folder['owner_id'] === $user_id;
			$source_cap      = function_exists( 'desktop_mode_folder_share_user_capability' )
				? desktop_mode_folder_share_user_capability( (int) $row['parent_id'], $user_id )
				: 'none';
			if ( ! $is_row_owner && ! $is_folder_owner && 'write' !== $source_cap ) {
				return new WP_Error(
					'desktop_mode_files_no_write_in_shared_folder',
					__( 'You only have read access to this folder.', 'desktop-mode' ),
					array( 'status' => 403 )
				);
			}
			// Folder reader on their own row inside the folder — still no.
			if ( $is_row_owner && ! $is_folder_owner && 'write' !== $source_cap ) {
				return new WP_Error(
					'desktop_mode_files_no_write_in_shared_folder',
					__( 'You only have read access to this folder.', 'desktop-mode' ),
					array( 'status' => 403 )
				);
			}
		}
	} elseif ( ! $is_row_owner ) {
		// Row at root, viewer doesn't own it.
		return new WP_Error( 'desktop_mode_files_forbidden', __( 'You cannot edit this placement.', 'desktop-mode' ), array( 'status' => 403 ) );
	}
	if ( isset( $changes['parent_id'] ) ) {
		$target_parent = max( 0, (int) $changes['parent_id'] );
		if ( $target_parent > 0 ) {
			$target = desktop_mode_files_get_folder( $target_parent );
			if ( $target && (int) $target['owner_id'] !== $user_id ) {
				$cap = function_exists( 'desktop_mode_folder_share_user_capability' )
					? desktop_mode_folder_share_user_capability( $target_parent, $user_id )
					: 'none';
				if ( 'write' !== $cap ) {
					return new WP_Error(
						'desktop_mode_files_no_write_in_shared_folder',
						__( 'You only have read access to that folder.', 'desktop-mode' ),
						array( 'status' => 403 )
					);
				}
			}
		}
	}

	$tables = desktop_mode_files_table_names();
	$set    = array();
	$fmt    = array();

	if ( isset( $changes['parent_id'] ) ) {
		$set['parent_id'] = max( 0, (int) $changes['parent_id'] );
		$fmt[]            = '%d';
	}
	foreach ( array( 'x', 'y', 'sort_order' ) as $col ) {
		if ( isset( $changes[ $col ] ) ) {
			$set[ $col ] = (int) $changes[ $col ];
			$fmt[]       = '%d';
		}
	}
	if ( array_key_exists( 'meta', $changes ) ) {
		$set['meta'] = null === $changes['meta'] ? null : wp_json_encode( $changes['meta'] );
		$fmt[]       = '%s';
	}
	if ( empty( $set ) ) {
		return true; // No-op.
	}

	$set['updated_at_ms'] = desktop_mode_files_now_ms();
	$fmt[]                = '%d';

	$ok = $wpdb->update( $tables['placements'], $set, array( 'id' => $placement_id ), $fmt, array( '%d' ) );
	if ( false === $ok ) {
		return new WP_Error( 'desktop_mode_files_update_failed', __( 'Failed to update placement.', 'desktop-mode' ), array( 'status' => 500 ) );
	}

	$next = desktop_mode_files_get_placement( $placement_id );

	/**
	 * Fires after a placement is moved / mutated.
	 *
	 * @since 0.9.0
	 *
	 * @param int   $id   Placement id.
	 * @param array $next Row after the change.
	 * @param array $prev Row before the change.
	 */
	do_action( 'desktop_mode_file_moved', $placement_id, $next, $row );

	return true;
}

/**
 * Remove a placement. Writes a tombstone for Phase-6 sync.
 *
 * @since 0.9.0
 *
 * @param int $placement_id Placement id.
 * @param int $user_id      Acting user.
 * @return true|WP_Error
 */
function desktop_mode_files_remove( $placement_id, $user_id ) {
	global $wpdb;

	$placement_id = (int) $placement_id;
	$user_id      = (int) $user_id;
	$row          = desktop_mode_files_get_placement( $placement_id );
	if ( ! $row ) {
		return new WP_Error( 'desktop_mode_files_not_found', __( 'Placement not found.', 'desktop-mode' ), array( 'status' => 404 ) );
	}
	// Same shared-namespace rule as the trash gate: owner of the
	// row OR write cap on the parent folder.
	$is_row_owner = (int) $row['user_id'] === $user_id;
	$allowed      = $is_row_owner;
	if ( ! $allowed && (int) $row['parent_id'] > 0 ) {
		$cap = function_exists( 'desktop_mode_folder_share_user_capability' )
			? desktop_mode_folder_share_user_capability( (int) $row['parent_id'], $user_id )
			: 'none';
		$allowed = 'write' === $cap;
	}
	if ( ! $allowed ) {
		return new WP_Error( 'desktop_mode_files_forbidden', __( 'You cannot remove this placement.', 'desktop-mode' ), array( 'status' => 403 ) );
	}

	$tables = desktop_mode_files_table_names();
	$ok     = $wpdb->delete( $tables['placements'], array( 'id' => $placement_id ), array( '%d' ) );
	if ( false === $ok ) {
		return new WP_Error( 'desktop_mode_files_delete_failed', __( 'Failed to remove placement.', 'desktop-mode' ), array( 'status' => 500 ) );
	}

	desktop_mode_files_write_tombstone( 'placement', $placement_id );

	/**
	 * Fires after a placement is removed.
	 *
	 * @since 0.9.0
	 *
	 * @param int   $id  Placement id.
	 * @param array $row Removed row.
	 */
	do_action( 'desktop_mode_file_unplaced', $placement_id, $row );

	return true;
}

/**
 * Read a single placement row by id.
 *
 * @since 0.9.0
 *
 * @param int $placement_id Placement id.
 * @return array|null
 */
function desktop_mode_files_get_placement( $placement_id ) {
	global $wpdb;
	$tables = desktop_mode_files_table_names();
	$row    = $wpdb->get_row(
		$wpdb->prepare( "SELECT * FROM {$tables['placements']} WHERE id = %d", (int) $placement_id ),
		ARRAY_A
	);
	if ( ! $row ) {
		return null;
	}
	return desktop_mode_files_normalize_placement_row( $row );
}

/**
 * List placements for a user under a given folder (0 = desktop
 * root). Honors the `desktop_mode_files_query_args` filter and
 * applies the file-type's `can_read()` per row.
 *
 * @since 0.9.0
 *
 * @param int $user_id   Viewer.
 * @param int $parent_id Folder id (0 for desktop root).
 * @return array[]
 */
function desktop_mode_files_get_for_user_folder( $user_id, $parent_id = 0 ) {
	global $wpdb;
	$user_id   = (int) $user_id;
	$parent_id = max( 0, (int) $parent_id );
	if ( $user_id <= 0 ) {
		return array();
	}

	$tables = desktop_mode_files_table_names();

	// Access gate + shared-namespace decision for non-root folders.
	// Desktop root (parent_id = 0) is always per-user. For sub-
	// folders, the contents of a SHARED folder are visible to every
	// user who has at least 'read' on it — the icons inside belong
	// to the folder, not to the user who originally placed them.
	$share_view = false;
	if ( $parent_id > 0 ) {
		$folder = desktop_mode_files_get_folder( $parent_id );
		if ( ! $folder ) {
			return array();
		}
		if ( (int) $folder['owner_id'] !== $user_id ) {
			$cap = function_exists( 'desktop_mode_folder_share_user_capability' )
				? desktop_mode_folder_share_user_capability( $parent_id, $user_id )
				: 'none';
			if ( 'none' === $cap ) {
				return array();
			}
			$share_view = true;
		}
	}

	$args = array(
		'user_id'    => $user_id,
		'parent_id'  => $parent_id,
		'share_view' => $share_view,
	);
	/**
	 * Filter the args used to read placements.
	 *
	 * @since 0.9.0
	 *
	 * @param array $args        Defaults: `{ user_id, parent_id, share_view }`.
	 * @param int   $user_id     Viewer.
	 * @param int   $parent_id   Folder id.
	 */
	$args = (array) apply_filters( 'desktop_mode_files_query_args', $args, $user_id, $parent_id );

	// Active queries always exclude trashed rows. Recycle-bin
	// callers reach for the dedicated trash store.
	if ( ! empty( $args['share_view'] ) ) {
		// Shared sub-folder — return every placement in the folder
		// regardless of which user originally placed it. The icons
		// are part of the folder; the user_id column is audit info,
		// not a permission gate.
		$rows = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT * FROM {$tables['placements']}
				WHERE parent_id = %d
					AND trashed_at_ms IS NULL
				ORDER BY sort_order ASC, id ASC",
				(int) $args['parent_id']
			),
			ARRAY_A
		);
	} else {
		$rows = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT * FROM {$tables['placements']}
				WHERE user_id = %d
					AND parent_id = %d
					AND trashed_at_ms IS NULL
				ORDER BY sort_order ASC, id ASC",
				(int) $args['user_id'],
				(int) $args['parent_id']
			),
			ARRAY_A
		);
	}
	if ( ! is_array( $rows ) ) {
		return array();
	}
	$out = array();
	foreach ( $rows as $row ) {
		$normalized = desktop_mode_files_normalize_placement_row( $row );
		$file       = desktop_mode_resolve_file( $normalized['file_type'], $normalized['file_ref'] );
		if ( empty( $args['share_view'] ) ) {
			// Private folder / desktop root — keep the existing
			// per-row read filter so stale/inaccessible entities
			// don't clutter the user's own view.
			if ( $file && ! $file->can_read( $user_id ) ) {
				continue;
			}
		} else {
			// Shared folder view — every placement the OWNER chose
			// to include is surfaced to the recipient. When the
			// recipient lacks read on the underlying entity, we
			// mark the row as `access_gated` so the tile renderer
			// can paint a lock overlay + tooltip + intercept the
			// open. Entity-level access enforcement still happens
			// at open time in each opener — this flag is just the
			// pre-emptive visual cue.
			if ( $file && ! $file->can_read( $user_id ) ) {
				$normalized['access_gated'] = true;
			}
		}
		$out[] = $normalized;
	}
	return $out;
}

/**
 * Self-healing backfill. Surfaces two kinds of orphans on the
 * desktop root:
 *
 *   1. Folders the viewer owns that have no placement anywhere.
 *      (Pre-fix folder-create flow could leak these; new flow
 *      writes the placement atomically.)
 *
 *   2. Plugin shortcuts (`desktop_mode_register_icon()`) the
 *      viewer hasn't placed yet. The unified-rail merge means
 *      every registered icon shows up as a `shortcut` placement
 *      on first hydrate so plugin shortcuts behave like any
 *      other tile (drag, sort, right-click, clean up).
 *
 * Idempotent on both axes: a folder/shortcut that already has
 * any placement is left alone. Coordinates use the column-major
 * grid that `src/desktop-files/grid.ts` mirrors on the JS side.
 *
 * Called by the placements list endpoint when the requested
 * folder is the root (`parent_id=0`).
 *
 * @since 0.9.0
 *
 * @param int $user_id Viewer.
 * @return int Total number of orphans that were auto-placed.
 */
function desktop_mode_files_auto_place_orphans( $user_id ) {
	global $wpdb;
	$user_id = (int) $user_id;
	if ( $user_id <= 0 ) {
		return 0;
	}

	$tables = desktop_mode_files_table_names();

	// 1) Owned folders without any placement. Skip trashed folders
	// and trashed placement rows so a recycled folder doesn't get
	// auto-placed back on the desktop on next hydrate.
	$folder_rows = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT f.id FROM {$tables['folders']} f
				LEFT JOIN {$tables['placements']} p
					ON p.file_type = 'folder'
					AND p.file_ref = CAST( f.id AS CHAR )
					AND p.trashed_at_ms IS NULL
				WHERE f.owner_id = %d
					AND f.trashed_at_ms IS NULL
					AND p.id IS NULL",
			$user_id
		),
		ARRAY_A
	);

	// 2) Registered plugin shortcuts the viewer hasn't placed yet.
	//    Pull the registered ids first, then ask the placements
	//    table which the viewer already has — set difference
	//    yields the orphans without a heavy join.
	$shortcut_ids   = array();
	$registry       = function_exists( 'desktop_mode_desktop_icon_registry' )
		? desktop_mode_desktop_icon_registry()
		: array();
	if ( is_array( $registry ) ) {
		// Run through the same `desktop_mode_icons` filter the
		// build-payload path uses so plugins (and tests) can inject
		// virtual entries.
		$registry = (array) apply_filters( 'desktop_mode_icons', $registry );
	}
	if ( is_array( $registry ) && ! empty( $registry ) ) {
		$registered_ids = array_map( 'strval', array_keys( $registry ) );
		$placeholders   = implode( ',', array_fill( 0, count( $registered_ids ), '%s' ) );
		$args           = array_merge( array( $user_id ), $registered_ids );
		$placed_ids     = $wpdb->get_col(
			$wpdb->prepare(
				"SELECT file_ref FROM {$tables['placements']}
				WHERE user_id = %d
					AND file_type = 'shortcut'
					AND trashed_at_ms IS NULL
					AND file_ref IN ($placeholders)",
				$args
			)
		);
		$placed_set = array_flip( array_map( 'strval', (array) $placed_ids ) );
		foreach ( $registered_ids as $id ) {
			if ( ! isset( $placed_set[ $id ] ) ) {
				$shortcut_ids[] = $id;
			}
		}
	}

	if ( empty( $folder_rows ) && empty( $shortcut_ids ) ) {
		return 0;
	}

	// Build an occupied set from EXISTING root placements so
	// we never drop an orphan on top of a tile the user
	// already has. Cell math mirrors `src/desktop-files/grid.ts`
	// (padding 16 + col 96 + row 110).
	$existing = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT x, y FROM {$tables['placements']}
			WHERE user_id = %d
				AND parent_id = 0
				AND trashed_at_ms IS NULL",
			$user_id
		),
		ARRAY_A
	);
	$occupied = array();
	foreach ( (array) $existing as $row ) {
		$col = max( 0, (int) round( ( (int) $row['x'] - 16 ) / 96 ) );
		$row_idx = max( 0, (int) round( ( (int) $row['y'] - 16 ) / 110 ) );
		$occupied[ "$col,$row_idx" ] = true;
	}

	$find_next = function () use ( &$occupied ) {
		for ( $col = 0; $col < 999; $col++ ) {
			for ( $row = 0; $row < 999; $row++ ) {
				$key = "$col,$row";
				if ( ! isset( $occupied[ $key ] ) ) {
					$occupied[ $key ] = true;
					return array( $col, $row );
				}
			}
		}
		return array( 0, 0 );
	};

	$placed = 0;
	$emit_at = function ( $type, $ref, $col, $row ) use ( $user_id, &$occupied, &$placed ) {
		$occupied[ "$col,$row" ] = true;
		$result = desktop_mode_files_place(
			$user_id,
			0,
			$type,
			(string) $ref,
			array(
				'x' => 16 + $col * 96,
				'y' => 16 + $row * 110,
			)
		);
		if ( ! is_wp_error( $result ) ) {
			$placed++;
		}
	};
	$emit_next = function ( $type, $ref ) use ( $find_next, $emit_at ) {
		list( $col, $row ) = $find_next();
		$emit_at( $type, $ref, $col, $row );
	};

	// Pinned shortcuts get reserved top-left slots. Anchored to
	// column 0 (x=16) so the JS layer's pinned-slot math
	// (`GRID_PADDING + n*GRID_CELL_H`) lines up with the row the
	// server picks. Mark the slot occupied BEFORE other orphans
	// flow in so a draggable tile never lands on top of the
	// anchored "My WordPress" icon.
	$pinned_ids = array();
	foreach ( $shortcut_ids as $id ) {
		$entry = is_array( $registry ) && isset( $registry[ $id ] ) ? $registry[ $id ] : null;
		if ( is_array( $entry ) && ! empty( $entry['pinned'] ) ) {
			$pinned_ids[] = $id;
		}
	}
	$pinned_set = array_flip( $pinned_ids );
	$pinned_idx = 0;
	foreach ( $pinned_ids as $id ) {
		// Force the slot at (col=0, row=$pinned_idx). Any pre-
		// existing occupant on that slot is left alone — the layer
		// re-renders the pinned tile on top via the
		// client-side override anyway, but a future cleanup pass
		// can compact the column.
		$occupied[ "0,$pinned_idx" ] = true;
		$emit_at( 'shortcut', $id, 0, $pinned_idx );
		$pinned_idx++;
	}

	foreach ( $folder_rows as $row ) {
		$emit_next( 'folder', $row['id'] );
	}
	foreach ( $shortcut_ids as $id ) {
		if ( isset( $pinned_set[ $id ] ) ) {
			continue;
		}
		$emit_next( 'shortcut', $id );
	}
	return $placed;
}

/**
 * Backwards-compat alias for the older folder-only name.
 *
 * @deprecated 0.9.0 Use {@see desktop_mode_files_auto_place_orphans}.
 *
 * @param int $user_id Viewer.
 * @return int
 */
function desktop_mode_files_auto_place_orphan_folders( $user_id ) {
	return desktop_mode_files_auto_place_orphans( $user_id );
}

/**
 * Coerce wpdb's stringly-typed row into typed values + decoded
 * meta. Internal helper.
 *
 * @since 0.9.0
 * @internal
 *
 * @param array $row Raw wpdb row.
 * @return array
 */
function desktop_mode_files_normalize_placement_row( $row ) {
	$meta_raw = isset( $row['meta'] ) ? (string) $row['meta'] : '';
	$meta     = '' !== $meta_raw ? json_decode( $meta_raw, true ) : null;
	return array(
		'id'            => (int) $row['id'],
		'user_id'       => (int) $row['user_id'],
		'parent_id'     => (int) $row['parent_id'],
		'file_type'     => (string) $row['file_type'],
		'file_ref'      => (string) $row['file_ref'],
		'x'             => (int) $row['x'],
		'y'             => (int) $row['y'],
		'sort_order'    => (int) $row['sort_order'],
		'updated_at_ms' => (int) $row['updated_at_ms'],
		'meta'          => is_array( $meta ) ? $meta : null,
	);
}

/**
 * Write a tombstone row.
 *
 * Invariant (enforced by callers): tombstones may exist only for
 * ids of PERMANENTLY-DELETED rows. Never write one for a soft-
 * trashed row — soft-trash is reversible and the heartbeat already
 * surfaces it via the `trashed_at_ms IS NOT NULL` query in
 * `desktop_mode_files_compute_heartbeat_delta`. A tombstone on a
 * soft-trashed row lingers past restore and tells clients the row
 * is gone while it is in fact alive — see the "shared folder
 * disappears on refresh" bug fixed in 0.18.x.
 *
 * Pair every revival path (`desktop_mode_files_restore_placement`,
 * `desktop_mode_files_restore_folder`, and the duplicate-key
 * revival branch in `desktop_mode_files_place`) with
 * {@see desktop_mode_files_clear_tombstones_for} so a row coming
 * back to life never carries lingering tombstones from a previous
 * removal that turned out to be reversible.
 *
 * @since 0.9.0
 *
 * @param string $kind 'placement' | 'folder'.
 * @param int    $ref  Removed id.
 */
function desktop_mode_files_write_tombstone( $kind, $ref ) {
	global $wpdb;
	$tables = desktop_mode_files_table_names();
	$wpdb->insert(
		$tables['tombstones'],
		array(
			'kind'          => (string) $kind,
			'ref_id'        => (int) $ref,
			'removed_at_ms' => desktop_mode_files_now_ms(),
		),
		array( '%s', '%d', '%d' )
	);
}

/**
 * Drop every tombstone referring to `($kind, $ref_id)`. Called from
 * the row-revival paths so a placement/folder coming back to life
 * never carries lingering "this is gone" tombstones from a
 * previous removal that turned out to be reversible.
 *
 * Idempotent — running it on a ref with no tombstones is a no-op.
 *
 * @since 0.18.0
 *
 * @param string $kind 'placement' | 'folder'.
 * @param int    $ref_id Row id whose tombstones should be dropped.
 */
function desktop_mode_files_clear_tombstones_for( $kind, $ref_id ) {
	global $wpdb;
	$ref_id = (int) $ref_id;
	if ( $ref_id <= 0 ) {
		return;
	}
	$tables = desktop_mode_files_table_names();
	$wpdb->delete(
		$tables['tombstones'],
		array(
			'kind'   => (string) $kind,
			'ref_id' => $ref_id,
		),
		array( '%s', '%d' )
	);
}

/**
 * Daily prune of tombstones older than 7 days. Phase 6 may tune
 * the retention window when the Heartbeat sync lands; for now 7d
 * is plenty since a client that's been offline that long will
 * always need a full REST resync anyway.
 *
 * @since 0.9.0
 */
function desktop_mode_files_prune_tombstones() {
	global $wpdb;
	$tables = desktop_mode_files_table_names();
	$cutoff = desktop_mode_files_now_ms() - ( 7 * DAY_IN_SECONDS * 1000 );
	$wpdb->query( $wpdb->prepare( "DELETE FROM {$tables['tombstones']} WHERE removed_at_ms < %d", $cutoff ) );
}
add_action( 'desktop_mode_files_daily_prune', 'desktop_mode_files_prune_tombstones' );

/**
 * Schedule the daily prune on activation.
 *
 * @since 0.9.0
 */
function desktop_mode_files_schedule_prune() {
	if ( ! wp_next_scheduled( 'desktop_mode_files_daily_prune' ) ) {
		wp_schedule_event( time() + HOUR_IN_SECONDS, 'daily', 'desktop_mode_files_daily_prune' );
	}
}
add_action( 'init', 'desktop_mode_files_schedule_prune' );
