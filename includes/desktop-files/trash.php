<?php

defined( 'ABSPATH' ) || exit;

function openstation_files_user_owns_row( $user_id, $row ) {
	$user_id = (int) $user_id;
	return ( $user_id > 0 )
		&& isset( $row['owner_id'] )
		&& (int) $row['owner_id'] === $user_id;
}

function openstation_files_user_can_trash_placement( $user_id, $row ) {

	return (bool) apply_filters(
		'openstation_files_user_can_trash_placement',
		openstation_files_user_owns_row( $user_id, $row ),
		(int) $user_id,
		$row
	);
}

function openstation_files_user_can_restore_placement( $user_id, $row ) {

	return (bool) apply_filters(
		'openstation_files_user_can_restore_placement',
		openstation_files_user_owns_row( $user_id, $row ),
		(int) $user_id,
		$row
	);
}

function openstation_files_user_can_purge_placement( $user_id, $row ) {

	return (bool) apply_filters(
		'openstation_files_user_can_purge_placement',
		openstation_files_user_owns_row( $user_id, $row ),
		(int) $user_id,
		$row
	);
}

function openstation_files_user_can_trash_folder( $user_id, $row ) {

	return (bool) apply_filters(
		'openstation_files_user_can_trash_folder',
		openstation_files_user_owns_row( $user_id, $row ),
		(int) $user_id,
		$row
	);
}

function openstation_files_user_can_restore_folder( $user_id, $row ) {

	return (bool) apply_filters(
		'openstation_files_user_can_restore_folder',
		openstation_files_user_owns_row( $user_id, $row ),
		(int) $user_id,
		$row
	);
}

function openstation_files_user_can_purge_folder( $user_id, $row ) {

	return (bool) apply_filters(
		'openstation_files_user_can_purge_folder',
		openstation_files_user_owns_row( $user_id, $row ),
		(int) $user_id,
		$row
	);
}

function openstation_files_capture_ancestry( $parent_id ) {
	global $wpdb;
	$tables = openstation_files_table_names();
	$chain  = array();
	$cursor = (int) $parent_id;
	$guard  = 0;
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

		$placement      = $wpdb->get_row(
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
		$entry          = array(
			'folder_id'           => (int) $folder['id'],
			'folder_name'         => (string) $folder['name'],
			'folder_share_mode'   => (string) $folder['share_mode'],
			'folder_share_meta'   => is_array( $share_meta ) ? $share_meta : null,
			'folder_owner_id'     => (int) $folder['owner_id'],
			'placement_parent_id' => $placement ? (int) $placement['parent_id'] : 0,
			'placement_x'         => $placement ? (int) $placement['x'] : 0,
			'placement_y'         => $placement ? (int) $placement['y'] : 0,
		);
		array_unshift( $chain, $entry );
		$cursor = $entry['placement_parent_id'];
	}
	return $chain;
}

function openstation_files_resurrect_ancestry( $user_id, $ancestry ) {
	if ( empty( $ancestry ) ) {
		return 0;
	}
	$user_id  = (int) $user_id;
	$id_map   = array();
	$resolved = 0;
	foreach ( $ancestry as $entry ) {
		$orig_id  = (int) $entry['folder_id'];
		$orig_par = (int) $entry['placement_parent_id'];

		$resolved_parent = isset( $id_map[ $orig_par ] )
			? (int) $id_map[ $orig_par ]
			: $orig_par;

		$folder = openstation_files_get_folder( $orig_id, true );
		if ( $folder ) {

			if ( ! empty( $folder['trashed_at_ms'] ) ) {
				openstation_files_restore_folder( $user_id, $orig_id );
			}
			$id_map[ $orig_id ] = $orig_id;
			$resolved           = $orig_id;
			continue;
		}

		$owner_id = (int) ( $entry['folder_owner_id'] ? $entry['folder_owner_id'] : $user_id );
		$new_id   = openstation_files_create_folder(
			$owner_id,
			array(
				'name'       => (string) $entry['folder_name'],
				'share_mode' => (string) $entry['folder_share_mode'],
				'share_meta' => $entry['folder_share_meta'],
			)
		);
		if ( is_wp_error( $new_id ) ) {

			$resolved           = $resolved_parent;
			$id_map[ $orig_id ] = $resolved;
			continue;
		}

		openstation_files_place(
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

function openstation_files_trash_placement( $user_id, $placement_id ) {
	global $wpdb;
	$user_id      = (int) $user_id;
	$placement_id = (int) $placement_id;
	$tables       = openstation_files_table_names();

	$row = $wpdb->get_row(
		$wpdb->prepare(
			"SELECT * FROM {$tables['placements']} WHERE id = %d",
			$placement_id
		),
		ARRAY_A
	);
	if ( ! $row ) {
		return new WP_Error(
			'openstation_files_placement_not_found',
			__( 'Placement not found.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}
	if ( null !== $row['trashed_at_ms'] && '' !== $row['trashed_at_ms'] ) {
		return true;
	}
	if ( ! openstation_files_user_can_trash_placement( $user_id, $row ) ) {
		return new WP_Error(
			'openstation_files_forbidden',
			__( 'You do not have permission to trash this item.', 'desktop-mode' ),
			array( 'status' => 403 )
		);
	}

	do_action( 'openstation_files_before_trash_placement', $placement_id, $user_id, $row );

	$now      = openstation_files_now_ms();
	$ancestry = openstation_files_capture_ancestry( (int) $row['parent_id'] );
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

	if ( false === $result ) {
		return new WP_Error(
			'openstation_files_trash_failed',
			isset( $wpdb->last_error ) && $wpdb->last_error
				? (string) $wpdb->last_error
				: __( 'Failed to write trash row.', 'desktop-mode' ),
			array( 'status' => 500 )
		);
	}

	do_action( 'openstation_files_after_trash_placement', $placement_id, $user_id );

	return true;
}

function openstation_files_restore_placement( $user_id, $placement_id ) {
	global $wpdb;
	$user_id      = (int) $user_id;
	$placement_id = (int) $placement_id;
	$tables       = openstation_files_table_names();

	$row = $wpdb->get_row(
		$wpdb->prepare(
			"SELECT * FROM {$tables['placements']} WHERE id = %d",
			$placement_id
		),
		ARRAY_A
	);
	if ( ! $row ) {
		return new WP_Error(
			'openstation_files_placement_not_found',
			__( 'Placement not found.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}
	if ( null === $row['trashed_at_ms'] || '' === $row['trashed_at_ms'] ) {
		return true;
	}
	if ( ! openstation_files_user_can_restore_placement( $user_id, $row ) ) {
		return new WP_Error(
			'openstation_files_forbidden',
			__( 'You do not have permission to restore this item.', 'desktop-mode' ),
			array( 'status' => 403 )
		);
	}

	$original_parent_id = (int) $row['parent_id'];
	$resolved_parent_id = $original_parent_id;
	if ( $original_parent_id > 0 ) {
		$parent_alive = openstation_files_get_folder( $original_parent_id, true );
		if ( $parent_alive ) {
			if ( ! empty( $parent_alive['trashed_at_ms'] ) ) {

				$folder_restore = openstation_files_restore_folder( $user_id, $original_parent_id );
				if ( is_wp_error( $folder_restore ) ) {
					return $folder_restore;
				}
			}
			$resolved_parent_id = $original_parent_id;
		} else {

			$meta_raw           = isset( $row['trashed_meta'] ) ? (string) $row['trashed_meta'] : '';
			$decoded            = '' !== $meta_raw ? json_decode( $meta_raw, true ) : null;
			$ancestry           = ( is_array( $decoded ) && isset( $decoded['ancestry'] ) && is_array( $decoded['ancestry'] ) )
				? $decoded['ancestry']
				: array();
			$resolved_parent_id = openstation_files_resurrect_ancestry( $user_id, $ancestry );
		}
	}

	do_action( 'openstation_files_before_restore_placement', $placement_id, $user_id, $row );

	$wpdb->update(
		$tables['placements'],
		array(
			'parent_id'          => $resolved_parent_id,
			'trashed_at_ms'      => null,
			'trashed_by'         => null,
			'trashed_via_folder' => null,
			'trashed_meta'       => null,
			'updated_at_ms'      => openstation_files_now_ms(),
		),
		array( 'id' => $placement_id ),
		array( '%d', null, null, null, null, '%d' ),
		array( '%d' )
	);

	openstation_files_clear_tombstones_for( 'placement', $placement_id );

	do_action( 'openstation_files_after_restore_placement', $placement_id, $user_id );

	return true;
}

function openstation_files_purge_placement( $user_id, $placement_id ) {
	global $wpdb;
	$user_id      = (int) $user_id;
	$placement_id = (int) $placement_id;
	$tables       = openstation_files_table_names();

	$row = $wpdb->get_row(
		$wpdb->prepare(
			"SELECT * FROM {$tables['placements']} WHERE id = %d",
			$placement_id
		),
		ARRAY_A
	);
	if ( ! $row ) {
		return true;
	}
	if ( ! openstation_files_user_can_purge_placement( $user_id, $row ) ) {
		return new WP_Error(
			'openstation_files_forbidden',
			__( 'You do not have permission to delete this item.', 'desktop-mode' ),
			array( 'status' => 403 )
		);
	}

	do_action( 'openstation_files_before_purge_placement', $placement_id, $user_id, $row );

	$wpdb->delete( $tables['placements'], array( 'id' => $placement_id ), array( '%d' ) );

	do_action(
		'openstation_file_unplaced',
		$placement_id,
		openstation_files_normalize_placement_row( $row )
	);

	do_action( 'openstation_files_after_purge_placement', $placement_id, $user_id );

	return true;
}

function openstation_files_trash_folder( $user_id, $folder_id ) {
	global $wpdb;
	$user_id   = (int) $user_id;
	$folder_id = (int) $folder_id;
	$tables    = openstation_files_table_names();

	$row = $wpdb->get_row(
		$wpdb->prepare(
			"SELECT * FROM {$tables['folders']} WHERE id = %d",
			$folder_id
		),
		ARRAY_A
	);
	if ( ! $row ) {
		return new WP_Error(
			'openstation_files_folder_not_found',
			__( 'Folder not found.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}
	if ( null !== $row['trashed_at_ms'] && '' !== $row['trashed_at_ms'] ) {
		return true;
	}
	if ( ! openstation_files_user_can_trash_folder( $user_id, $row ) ) {
		return new WP_Error(
			'openstation_files_forbidden',
			__( 'You do not have permission to trash this folder.', 'desktop-mode' ),
			array( 'status' => 403 )
		);
	}

	do_action( 'openstation_files_before_trash_folder', $folder_id, $user_id, $row );

	$now = openstation_files_now_ms();

	$folder_placement = $wpdb->get_row(
		$wpdb->prepare(
			"SELECT parent_id FROM {$tables['placements']}
			WHERE file_type = 'folder' AND file_ref = %s
			ORDER BY id ASC LIMIT 1",
			(string) $folder_id
		),
		ARRAY_A
	);
	$folder_ancestry  = $folder_placement
		? openstation_files_capture_ancestry( (int) $folder_placement['parent_id'] )
		: array();
	$folder_meta      = wp_json_encode( array( 'ancestry' => $folder_ancestry ) );

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
			'openstation_files_trash_failed',
			isset( $wpdb->last_error ) && $wpdb->last_error
				? (string) $wpdb->last_error
				: __( 'Failed to trash folder.', 'desktop-mode' ),
			array( 'status' => 500 )
		);
	}

	$ancestry = openstation_files_capture_ancestry( $folder_id );
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

	$child_folder_ids = $wpdb->get_col(
		$wpdb->prepare(
			"SELECT f.id FROM {$tables['folders']} f
			INNER JOIN {$tables['placements']} p ON p.file_type = 'folder' AND p.file_ref = CAST( f.id AS CHAR )
			WHERE p.parent_id = %d AND f.trashed_at_ms IS NULL",
			$folder_id
		)
	);
	foreach ( (array) $child_folder_ids as $child_id ) {
		openstation_files_trash_folder( $user_id, (int) $child_id );
	}

	do_action( 'openstation_files_after_trash_folder', $folder_id, $user_id );

	return true;
}

function openstation_files_restore_folder( $user_id, $folder_id ) {
	global $wpdb;
	$user_id   = (int) $user_id;
	$folder_id = (int) $folder_id;
	$tables    = openstation_files_table_names();

	$row = $wpdb->get_row(
		$wpdb->prepare(
			"SELECT * FROM {$tables['folders']} WHERE id = %d",
			$folder_id
		),
		ARRAY_A
	);
	if ( ! $row ) {
		return new WP_Error(
			'openstation_files_folder_not_found',
			__( 'Folder not found.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}
	if ( null === $row['trashed_at_ms'] || '' === $row['trashed_at_ms'] ) {
		return true;
	}
	if ( ! openstation_files_user_can_restore_folder( $user_id, $row ) ) {
		return new WP_Error(
			'openstation_files_forbidden',
			__( 'You do not have permission to restore this folder.', 'desktop-mode' ),
			array( 'status' => 403 )
		);
	}

	do_action( 'openstation_files_before_restore_folder', $folder_id, $user_id, $row );

	$now = openstation_files_now_ms();

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
				? openstation_files_get_folder( $origin_parent, true )
				: null;
			if ( $origin_parent > 0 && ! $alive ) {
				$resolved = openstation_files_resurrect_ancestry( $user_id, $ancestry );
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

	foreach ( (array) $nested_ids as $nid ) {
		openstation_files_restore_folder( $user_id, (int) $nid );
	}

	openstation_files_clear_tombstones_for( 'folder', $folder_id );
	$restored_placement_ids = $wpdb->get_col(
		$wpdb->prepare(
			"SELECT id FROM {$tables['placements']}
			WHERE trashed_via_folder IS NULL
				AND ( parent_id = %d OR ( file_type = 'folder' AND file_ref = %s ) )",
			$folder_id,
			(string) $folder_id
		)
	);
	foreach ( (array) $restored_placement_ids as $rpid ) {
		openstation_files_clear_tombstones_for( 'placement', (int) $rpid );
	}

	do_action( 'openstation_files_after_restore_folder', $folder_id, $user_id );

	return true;
}

function openstation_files_purge_folder( $user_id, $folder_id ) {
	global $wpdb;
	$user_id   = (int) $user_id;
	$folder_id = (int) $folder_id;
	$tables    = openstation_files_table_names();

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
	if ( ! openstation_files_user_can_purge_folder( $user_id, $row ) ) {
		return new WP_Error(
			'openstation_files_forbidden',
			__( 'You do not have permission to delete this folder.', 'desktop-mode' ),
			array( 'status' => 403 )
		);
	}

	do_action( 'openstation_files_before_purge_folder', $folder_id, $user_id, $row );

	$share_ids = (array) $wpdb->get_col(
		$wpdb->prepare(
			"SELECT id FROM {$tables['shares']} WHERE target_type = 'folder' AND folder_id = %d",
			$folder_id
		)
	);
	if ( ! empty( $share_ids ) ) {
		$placeholders = implode( ',', array_fill( 0, count( $share_ids ), '%d' ) );

		$wpdb->query(
			$wpdb->prepare(
				"DELETE FROM {$tables['decisions']} WHERE share_id IN ($placeholders)",
				$share_ids
			)
		);

		$wpdb->query(
			$wpdb->prepare(
				"DELETE FROM {$tables['shares']} WHERE id IN ($placeholders)",
				$share_ids
			)
		);
	}

	$pointing_ids = (array) $wpdb->get_col(
		$wpdb->prepare(
			"SELECT id FROM {$tables['placements']}
			WHERE file_type = 'folder' AND file_ref = %s",
			(string) $folder_id
		)
	);
	foreach ( $pointing_ids as $pid ) {
		openstation_files_write_tombstone( 'placement', (int) $pid );
	}
	if ( ! empty( $pointing_ids ) ) {
		$placeholders = implode( ',', array_fill( 0, count( $pointing_ids ), '%d' ) );

		$wpdb->query(
			$wpdb->prepare(
				"DELETE FROM {$tables['placements']} WHERE id IN ($placeholders)",
				$pointing_ids
			)
		);
	}

	$cascade_upload_rows = (array) $wpdb->get_results(
		$wpdb->prepare(
			"SELECT * FROM {$tables['placements']}
			WHERE trashed_via_folder = %d AND file_type = 'upload'",
			$folder_id
		),
		ARRAY_A
	);
	$wpdb->delete(
		$tables['placements'],
		array( 'trashed_via_folder' => $folder_id ),
		array( '%d' )
	);
	if ( function_exists( 'openstation_stored_files_handle_unplaced' ) ) {
		foreach ( $cascade_upload_rows as $upload_row ) {
			openstation_stored_files_handle_unplaced(
				(int) $upload_row['id'],
				openstation_files_normalize_placement_row( $upload_row )
			);
		}
	}
	$wpdb->delete( $tables['folders'], array( 'id' => $folder_id ), array( '%d' ) );

	do_action( 'openstation_files_after_purge_folder', $folder_id, $user_id );

	return true;
}

function openstation_files_count_trashed_for_recycle_bin( $user_id ) {
	global $wpdb;
	$user_id = (int) $user_id;
	if ( $user_id <= 0 ) {
		return 0;
	}
	$tables = openstation_files_table_names();

	$placements = (int) $wpdb->get_var(
		$wpdb->prepare(
			"SELECT COUNT(*) FROM {$tables['placements']}
			WHERE owner_id = %d
				AND trashed_at_ms IS NOT NULL
				AND trashed_via_folder IS NULL",
			$user_id
		)
	);
	$folders    = (int) $wpdb->get_var(
		$wpdb->prepare(
			"SELECT COUNT(*) FROM {$tables['folders']}
			WHERE owner_id = %d AND trashed_at_ms IS NOT NULL",
			$user_id
		)
	);
	return $placements + $folders;
}

function openstation_files_list_trashed_for_recycle_bin( $user_id ) {
	global $wpdb;
	$user_id = (int) $user_id;
	$tables  = openstation_files_table_names();
	$out     = array();

	$placements = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT * FROM {$tables['placements']}
			WHERE owner_id = %d AND trashed_at_ms IS NOT NULL
			ORDER BY trashed_at_ms DESC",
			$user_id
		),
		ARRAY_A
	);
	foreach ( (array) $placements as $row ) {

		if ( ! empty( $row['trashed_via_folder'] ) ) {
			continue;
		}
		$file  = function_exists( 'openstation_resolve_file' )
			? openstation_resolve_file( $row['file_type'], $row['file_ref'] )
			: null;
		$title = $file
			? openstation_plain_text_title( $file->title() )
			: (string) $row['file_type'];
		$icon  = $file ? (string) $file->icon() : 'dashicons-no-alt';

		$bucket   = ( 'shortcut' === (string) $row['file_type'] )
			? 'shortcut'
			: 'placement';
		$subtitle = ( 'shortcut' === $bucket )
			? __( 'Desktop shortcut', 'desktop-mode' )
			: sprintf(

				__( '%s on desktop', 'desktop-mode' ),
				(string) $row['file_type']
			);

		$item = array(
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
			'can_restore'   => openstation_files_user_can_restore_placement( $user_id, $row ),
			'can_purge'     => openstation_files_user_can_purge_placement( $user_id, $row ),
			'edit_link'     => '',
		);
		if ( 'link' === (string) $row['file_type'] ) {
			$item['type_label'] = __( 'URL', 'desktop-mode' );
		}
		$out[] = $item;
	}

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
		$out[]       = array(
			'id'            => (int) $row['id'],
			'type'          => 'folder',
			'title'         => (string) $row['name'],
			'subtitle'      => $child_count > 0
				? sprintf(

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
			'can_restore'   => openstation_files_user_can_restore_folder( $user_id, $row ),
			'can_purge'     => openstation_files_user_can_purge_folder( $user_id, $row ),
			'edit_link'     => '',
		);
	}

	$user_cache = array();
	foreach ( $out as &$item ) {
		$uid = (int) $item['deleted_by_id'];
		if ( $uid <= 0 ) {
			continue;
		}
		if ( ! isset( $user_cache[ $uid ] ) ) {
			$u                  = get_userdata( $uid );
			$user_cache[ $uid ] = $u ? $u->display_name : '';
		}
		$item['deleted_by'] = $user_cache[ $uid ];
	}
	unset( $item );

	return $out;
}
