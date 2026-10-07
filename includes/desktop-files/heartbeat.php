<?php

defined( 'ABSPATH' ) || exit;

function openstation_files_heartbeat_received( $response, $data ) {
	if ( ! is_array( $response ) ) {
		$response = array();
	}
	if ( empty( $data['openstation_files_subscribe'] ) || ! is_array( $data['openstation_files_subscribe'] ) ) {
		return $response;
	}
	if ( ! function_exists( 'openstation_is_enabled' ) || ! openstation_is_enabled() ) {
		return $response;
	}

	$sub      = $data['openstation_files_subscribe'];
	$folder_v = isset( $sub['folderVersions'] ) && is_array( $sub['folderVersions'] )
		? $sub['folderVersions']
		: array();
	$plc_v    = isset( $sub['placementsVersion'] ) ? (int) $sub['placementsVersion'] : 0;
	$shr_v    = isset( $sub['sharesVersion'] ) ? (int) $sub['sharesVersion'] : 0;

	$user_id = (int) get_current_user_id();
	if ( $user_id <= 0 ) {
		return $response;
	}

	$cap = max( 1, (int) apply_filters( 'openstation_files_heartbeat_max_rows', 200 ) );

	$response['openstation_files'] = openstation_files_compute_heartbeat_delta(
		$user_id,
		$folder_v,
		$plc_v,
		$cap,
		$shr_v
	);
	return $response;
}
add_filter( 'heartbeat_received', 'openstation_files_heartbeat_received', 5, 2 );

function openstation_files_compute_heartbeat_delta( $user_id, $folder_versions, $placements_version, $cap, $shares_version = 0 ) {
	global $wpdb;

	$tables    = openstation_files_table_names();
	$truncated = false;

	$visible        = openstation_files_get_visible_folders( $user_id );
	$folder_upserts = array();
	foreach ( $visible as $row ) {
		$id        = (int) $row['id'];
		$client_ts = isset( $folder_versions[ (string) $id ] )
			? (int) $folder_versions[ (string) $id ]
			: 0;
		if ( (int) $row['updated_at_ms'] > $client_ts ) {
			$folder_upserts[] = openstation_files_shape_folder( $row );
			if ( count( $folder_upserts ) >= $cap ) {
				$truncated = true;
				break;
			}
		}
	}

	$visible_folder_ids = array_map(
		static function ( $f ) {
			return (int) $f['id'];
		},
		$visible
	);

	$placement_upserts = array();
	if ( ! $truncated ) {

		if ( empty( $visible_folder_ids ) ) {
			$rows = $wpdb->get_results(
				$wpdb->prepare(
					"SELECT * FROM {$tables['placements']}
					WHERE owner_id = %d
						AND updated_at_ms > %d
						AND trashed_at_ms IS NULL
					ORDER BY updated_at_ms ASC
					LIMIT %d",
					$user_id,
					$placements_version,
					$cap
				),
				ARRAY_A
			);
		} else {
			$placeholders = implode( ',', array_fill( 0, count( $visible_folder_ids ), '%d' ) );
			$args         = array_merge(
				array( $user_id ),
				array_map( 'intval', $visible_folder_ids ),
				array( $placements_version, $cap )
			);

			$rows = $wpdb->get_results(
				$wpdb->prepare(
					"SELECT * FROM {$tables['placements']}
					WHERE ( owner_id = %d OR parent_id IN ($placeholders) )
						AND updated_at_ms > %d
						AND trashed_at_ms IS NULL
					ORDER BY updated_at_ms ASC
					LIMIT %d",
					$args
				),
				ARRAY_A
			);
		}
		foreach ( (array) $rows as $row ) {
			$row = openstation_files_normalize_placement_row( $row );

			$file = openstation_resolve_file( $row['file_type'], $row['file_ref'] );
			if ( $file && ! $file->can_read( $user_id ) ) {
				continue;
			}
			$placement_upserts[] = openstation_files_shape_placement( $row );
		}
		if ( count( $placement_upserts ) >= $cap ) {
			$truncated = true;
		}
	}

	$tomb_rows = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT kind, ref_id FROM {$tables['tombstones']} WHERE removed_at_ms > %d ORDER BY removed_at_ms ASC LIMIT %d",
			$placements_version,
			$cap
		),
		ARRAY_A
	);
	$removed   = array(
		'placements' => array(),
		'folders'    => array(),
	);
	foreach ( (array) $tomb_rows as $row ) {
		if ( 'folder' === $row['kind'] ) {
			$removed['folders'][] = (int) $row['ref_id'];
		} else {
			$removed['placements'][] = (int) $row['ref_id'];
		}
	}

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

	$shares          = array();
	$sharing_enabled = function_exists( 'openstation_files_sharing_enabled_for' )
		? openstation_files_sharing_enabled_for( $user_id )
		: true;
	if ( $sharing_enabled && function_exists( 'openstation_files_get_pending_shares_for_user' ) ) {
		$pending = openstation_files_get_pending_shares_for_user( $user_id, $shares_version );
		foreach ( $pending as $row ) {
			$shape  = openstation_files_shape_share( $row );
			$folder = openstation_files_get_folder( $row['folder_id'] );
			if ( $folder ) {
				$shape['folderName']  = (string) $folder['name'];
				$shape['ownerId']     = (int) $folder['owner_id'];
				$owner_user           = get_userdata( (int) $folder['owner_id'] );
				$shape['ownerName']   = $owner_user ? openstation_plain_text_title( $owner_user->display_name ) : '';
				$shape['ownerAvatar'] = $owner_user ? get_avatar_url( $owner_user->ID, array( 'size' => 48 ) ) : '';
			}
			$shares[] = $shape;
			if ( count( $shares ) >= $cap ) {
				$truncated = true;
				break;
			}
		}
	}

	if ( $sharing_enabled && ! $truncated && function_exists( 'openstation_files_get_pending_file_shares_for_user' ) ) {
		$pending_files = openstation_files_get_pending_file_shares_for_user( $user_id, $shares_version );
		foreach ( $pending_files as $row ) {
			$shares[] = openstation_files_shape_file_share( $row );
			if ( count( $shares ) >= $cap ) {
				$truncated = true;
				break;
			}
		}
	}

	$upsert_placement_ids = array_map(
		static function ( $p ) {
			return (int) $p['id']; },
		$placement_upserts
	);
	$upsert_folder_ids    = array_map(
		static function ( $f ) {
			return (int) $f['id']; },
		$folder_upserts
	);
	if ( ! empty( $upsert_placement_ids ) ) {
		$alive_placements      = array_flip( $upsert_placement_ids );
		$removed['placements'] = array_values(
			array_filter(
				$removed['placements'],
				static function ( $id ) use ( $alive_placements ) {
					return ! isset( $alive_placements[ (int) $id ] );
				}
			)
		);

		openstation_files_purge_stale_tombstones( 'placement', $upsert_placement_ids );
	}
	if ( ! empty( $upsert_folder_ids ) ) {
		$alive_folders      = array_flip( $upsert_folder_ids );
		$removed['folders'] = array_values(
			array_filter(
				$removed['folders'],
				static function ( $id ) use ( $alive_folders ) {
					return ! isset( $alive_folders[ (int) $id ] );
				}
			)
		);
		openstation_files_purge_stale_tombstones( 'folder', $upsert_folder_ids );
	}

	return array(
		'placements'   => $placement_upserts,
		'folders'      => $folder_upserts,
		'removed'      => $removed,
		'shares'       => array(
			'pending' => $shares,
		),
		'serverTimeMs' => openstation_files_now_ms(),
		'truncated'    => $truncated,
	);
}

function openstation_files_purge_stale_tombstones( $kind, $ids ) {
	if ( empty( $ids ) ) {
		return;
	}
	global $wpdb;
	$tables       = openstation_files_table_names();
	$placeholders = implode( ',', array_fill( 0, count( $ids ), '%d' ) );

	$wpdb->query(
		$wpdb->prepare(
			"DELETE FROM {$tables['tombstones']}
			WHERE kind = %s
				AND ref_id IN ($placeholders)",
			array_merge( array( (string) $kind ), array_map( 'intval', $ids ) )
		)
	);
}
