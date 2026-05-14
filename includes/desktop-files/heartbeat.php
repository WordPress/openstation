<?php
/**
 * Desktop Mode — Files Heartbeat sync (PHP).
 *
 * Piggybacks on the existing WordPress Heartbeat tick — the same
 * channel `presence.php` uses — so connected clients see folder
 * sharing changes and other users' placement edits inside one
 * cross-feature poll instead of N parallel ones.
 *
 * Wire format. Client sends `desktop_mode_files_subscribe` keyed
 * to two version markers:
 *
 *   {
 *       desktop_mode_files_subscribe: {
 *           folderVersions:    { '<folderId>': lastSeenUpdatedAtMs, ... },
 *           placementsVersion: lastSeenUpdatedAtMs
 *       }
 *   }
 *
 * Server responds with deltas + tombstones:
 *
 *   desktop_mode_files: {
 *       placements:   [ <RestPlacementShape> ],   // upserts
 *       folders:      [ <RestFolderShape>    ],   // upserts (incl. share-mode flips)
 *       removed: {
 *           placements: [ ids ],
 *           folders:    [ ids ]
 *       },
 *       serverTimeMs: int,
 *       truncated:    bool
 *   }
 *
 * Truncation kicks in when more than `desktop_mode_files_heartbeat_max_rows`
 * (default 200) rows match — clients fall back to a full REST
 * resync. The default cap is per-payload, not per-folder, so a
 * massive shared folder doesn't starve other folders' deltas.
 *
 * @package WPDesktopMode
 * @since   0.9.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * @since 0.9.0
 *
 * @param array $response Pre-filtered response.
 * @param array $data     Client-sent payload.
 * @return array
 */
function desktop_mode_files_heartbeat_received( $response, $data ) {
	if ( ! is_array( $response ) ) {
		$response = array();
	}
	if ( empty( $data['desktop_mode_files_subscribe'] ) || ! is_array( $data['desktop_mode_files_subscribe'] ) ) {
		return $response;
	}
	if ( ! function_exists( 'desktop_mode_is_enabled' ) || ! desktop_mode_is_enabled() ) {
		return $response;
	}

	$sub      = $data['desktop_mode_files_subscribe'];
	$folder_v = isset( $sub['folderVersions'] ) && is_array( $sub['folderVersions'] )
		? $sub['folderVersions']
		: array();
	$plc_v    = isset( $sub['placementsVersion'] ) ? (int) $sub['placementsVersion'] : 0;
	$shr_v    = isset( $sub['sharesVersion'] ) ? (int) $sub['sharesVersion'] : 0;

	$user_id = (int) get_current_user_id();
	if ( $user_id <= 0 ) {
		return $response;
	}

	/**
	 * Filter the per-payload row cap. Lower this on slow links
	 * to force REST fallback sooner; raise it for fast-LAN
	 * intranets where a fatter Heartbeat is fine.
	 *
	 * @since 0.9.0
	 *
	 * @param int $cap Default 200.
	 */
	$cap = max( 1, (int) apply_filters( 'desktop_mode_files_heartbeat_max_rows', 200 ) );

	$response['desktop_mode_files'] = desktop_mode_files_compute_heartbeat_delta(
		$user_id,
		$folder_v,
		$plc_v,
		$cap,
		$shr_v
	);
	return $response;
}
add_filter( 'heartbeat_received', 'desktop_mode_files_heartbeat_received', 5, 2 );

/**
 * Compute the delta payload for a viewer.
 *
 * @since 0.9.0
 *
 * @param int   $user_id            Viewer.
 * @param array $folder_versions    `{ folderId => lastSeenUpdatedAtMs }`.
 * @param int   $placements_version Last-seen `updated_at_ms` for placements.
 * @param int   $cap                Row cap.
 * @return array
 */
function desktop_mode_files_compute_heartbeat_delta( $user_id, $folder_versions, $placements_version, $cap, $shares_version = 0 ) {
	global $wpdb;

	$tables    = desktop_mode_files_table_names();
	$truncated = false;

	// 1) Visible folders the viewer should know about. We send
	//    the FULL row when its `updated_at_ms` exceeds whatever
	//    the client last saw (or the client doesn't know about
	//    it at all).
	$visible = desktop_mode_files_get_visible_folders( $user_id );
	$folder_upserts = array();
	foreach ( $visible as $row ) {
		$id        = (int) $row['id'];
		$client_ts = isset( $folder_versions[ (string) $id ] )
			? (int) $folder_versions[ (string) $id ]
			: 0;
		if ( (int) $row['updated_at_ms'] > $client_ts ) {
			$folder_upserts[] = desktop_mode_files_shape_folder( $row );
			if ( count( $folder_upserts ) >= $cap ) {
				$truncated = true;
				break;
			}
		}
	}

	// 2) Placement upserts the viewer can see. We pull anything
	//    written since `placements_version` whose owner is the
	//    viewer (their own desktop) OR which lives in a folder
	//    the viewer can see (shared content).
	$visible_folder_ids = array_map( static function ( $f ) {
		return (int) $f['id'];
	}, $visible );
	// Always include the desktop root (parent_id=0) for the viewer.
	$placement_upserts = array();
	if ( ! $truncated ) {
		// Owner-or-visible-folder filter: WHERE (user_id = $user
		// OR parent_id IN visible_folder_ids) AND updated_at_ms >
		// $placements_version.
		$where_parts = array( $wpdb->prepare( 'user_id = %d', $user_id ) );
		if ( ! empty( $visible_folder_ids ) ) {
			$placeholders = implode( ',', array_fill( 0, count( $visible_folder_ids ), '%d' ) );
			$where_parts[] = $wpdb->prepare( "parent_id IN ($placeholders)", $visible_folder_ids );
		}
		$where_sql = '(' . implode( ' OR ', $where_parts ) . ')';
		// Active placements only — trashed rows leave the visible
		// surface via the `removed.placements` channel a few lines
		// down, NOT as upserts. Without this filter a heartbeat tick
		// fired right after a soft-trash would resurrect the tile in
		// the client store.
		$rows = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT * FROM {$tables['placements']} WHERE $where_sql AND updated_at_ms > %d AND trashed_at_ms IS NULL ORDER BY updated_at_ms ASC LIMIT %d",
				$placements_version,
				$cap
			),
			ARRAY_A
		);
		foreach ( (array) $rows as $row ) {
			$row = desktop_mode_files_normalize_placement_row( $row );
			// Per-placement read gate: shared folder shouldn't
			// surface a row the viewer's `can_read()` rejects.
			$file = desktop_mode_resolve_file( $row['file_type'], $row['file_ref'] );
			if ( $file && ! $file->can_read( $user_id ) ) {
				continue;
			}
			$placement_upserts[] = desktop_mode_files_shape_placement( $row );
		}
		if ( count( $placement_upserts ) >= $cap ) {
			$truncated = true;
		}
	}

	// 3) Tombstones since the last placements_version — gives the
	//    client the "this row is gone" signal.
	$tomb_rows = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT kind, ref_id FROM {$tables['tombstones']} WHERE removed_at_ms > %d ORDER BY removed_at_ms ASC LIMIT %d",
			$placements_version,
			$cap
		),
		ARRAY_A
	);
	$removed = array( 'placements' => array(), 'folders' => array() );
	foreach ( (array) $tomb_rows as $row ) {
		if ( 'folder' === $row['kind'] ) {
			$removed['folders'][] = (int) $row['ref_id'];
		} else {
			$removed['placements'][] = (int) $row['ref_id'];
		}
	}

	// 4) Soft-trash events. Tombstones only fire on hard delete, so
	//    a trashed placement / folder would otherwise stay in the
	//    client store between F5s. Surface every row whose
	//    `trashed_at_ms` is fresher than the client's high-water
	//    mark as a `removed.*` entry. Restoring (clearing
	//    `trashed_at_ms`) bumps `updated_at_ms` and the row will
	//    flow back through `placements` / `folders` upserts above.
	$trashed_placements = $wpdb->get_col(
		$wpdb->prepare(
			"SELECT id FROM {$tables['placements']}
			WHERE trashed_at_ms IS NOT NULL
				AND trashed_at_ms > %d
			ORDER BY trashed_at_ms ASC
			LIMIT %d",
			$placements_version,
			$cap
		)
	);
	foreach ( (array) $trashed_placements as $id ) {
		$removed['placements'][] = (int) $id;
	}
	$trashed_folders = $wpdb->get_col(
		$wpdb->prepare(
			"SELECT id FROM {$tables['folders']}
			WHERE trashed_at_ms IS NOT NULL
				AND trashed_at_ms > %d
			ORDER BY trashed_at_ms ASC
			LIMIT %d",
			$placements_version,
			$cap
		)
	);
	foreach ( (array) $trashed_folders as $id ) {
		$removed['folders'][] = (int) $id;
	}

	// 5) Pending share invites for this viewer (across every folder
	//    they're invited to). Owner-side share-status changes flow
	//    through the folder upserts above; this channel is for the
	//    recipient's "you've been invited" placeholder UI.
	$shares = array();
	if ( function_exists( 'desktop_mode_files_get_pending_shares_for_user' ) ) {
		$pending = desktop_mode_files_get_pending_shares_for_user( $user_id, $shares_version );
		foreach ( $pending as $row ) {
			$shape = desktop_mode_files_shape_share( $row );
			$folder = desktop_mode_files_get_folder( $row['folder_id'] );
			if ( $folder ) {
				$shape['folderName']    = (string) $folder['name'];
				$shape['ownerId']       = (int) $folder['owner_id'];
				$owner_user             = get_userdata( (int) $folder['owner_id'] );
				$shape['ownerName']     = $owner_user ? $owner_user->display_name : '';
				$shape['ownerAvatar']   = $owner_user ? get_avatar_url( $owner_user->ID, array( 'size' => 48 ) ) : '';
			}
			$shares[] = $shape;
			if ( count( $shares ) >= $cap ) {
				$truncated = true;
				break;
			}
		}
	}

	// Safety net: a row that is currently being delivered as an
	// upsert (alive) must NOT also appear in `removed.*`. Otherwise
	// the client applies upserts first, then removals, and the
	// alive row disappears every heartbeat tick.
	//
	// This can happen when stale tombstones linger after a
	// soft-trash → restore cycle (e.g. a recipient leaves a shared
	// folder, then re-accepts the invite — the placement row is
	// restored but any tombstones written in error during the trash
	// path stay in the table). Cleaning them up server-side prevents
	// the same client-side glitch on every subsequent tick.
	$upsert_placement_ids = array_map(
		static function ( $p ) { return (int) $p['id']; },
		$placement_upserts
	);
	$upsert_folder_ids = array_map(
		static function ( $f ) { return (int) $f['id']; },
		$folder_upserts
	);
	if ( ! empty( $upsert_placement_ids ) ) {
		$alive_placements = array_flip( $upsert_placement_ids );
		$removed['placements'] = array_values(
			array_filter(
				$removed['placements'],
				static function ( $id ) use ( $alive_placements ) {
					return ! isset( $alive_placements[ (int) $id ] );
				}
			)
		);
		// Cleanup: drop any tombstones referring to placement ids
		// that are demonstrably alive in this tick. Bounded by the
		// upsert set so the work is per-tick, not table-wide.
		desktop_mode_files_purge_stale_tombstones( 'placement', $upsert_placement_ids );
	}
	if ( ! empty( $upsert_folder_ids ) ) {
		$alive_folders = array_flip( $upsert_folder_ids );
		$removed['folders'] = array_values(
			array_filter(
				$removed['folders'],
				static function ( $id ) use ( $alive_folders ) {
					return ! isset( $alive_folders[ (int) $id ] );
				}
			)
		);
		desktop_mode_files_purge_stale_tombstones( 'folder', $upsert_folder_ids );
	}

	return array(
		'placements'   => $placement_upserts,
		'folders'      => $folder_upserts,
		'removed'      => $removed,
		'shares'       => array(
			'pending' => $shares,
		),
		'serverTimeMs' => desktop_mode_files_now_ms(),
		'truncated'    => $truncated,
	);
}

/**
 * Delete tombstones for refs that are currently alive (still
 * present in the placements / folders table without
 * `trashed_at_ms`). One-shot cleanup of stale rows written by
 * earlier buggy code paths — once removed, the heartbeat no longer
 * surfaces them every tick.
 *
 * @since 0.18.0
 *
 * @param string $kind 'placement' | 'folder'.
 * @param int[]  $ids  Ids known to be alive in the current tick.
 */
function desktop_mode_files_purge_stale_tombstones( $kind, $ids ) {
	if ( empty( $ids ) ) {
		return;
	}
	global $wpdb;
	$tables       = desktop_mode_files_table_names();
	$placeholders = implode( ',', array_fill( 0, count( $ids ), '%d' ) );
	// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
	$wpdb->query(
		$wpdb->prepare(
			"DELETE FROM {$tables['tombstones']}
			WHERE kind = %s
				AND ref_id IN ($placeholders)",
			array_merge( array( (string) $kind ), array_map( 'intval', $ids ) )
		)
	);
}
