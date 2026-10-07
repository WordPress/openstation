<?php

defined( 'ABSPATH' ) || exit;

function openstation_files_place( $user_id, $parent_id, $type, $ref, $args = array() ) {
	global $wpdb;

	$user_id   = (int) $user_id;
	$parent_id = (int) $parent_id;
	$type      = (string) $type;
	$ref       = (string) $ref;

	if ( $user_id <= 0 ) {
		return new WP_Error( 'openstation_files_invalid_user', __( 'A user id is required.', 'desktop-mode' ), array( 'status' => 400 ) );
	}
	$entry = openstation_get_file_type( $type );
	if ( ! $entry ) {
		return new WP_Error( 'openstation_files_unknown_type', __( 'Unknown file type.', 'desktop-mode' ), array( 'status' => 400 ) );
	}

	$file = openstation_resolve_file( $type, $ref );
	$can  = $file ? $file->can_read( $user_id ) : false;
	$can  = (bool) apply_filters( 'openstation_files_can_place', $can, $user_id, $type, $ref );
	if ( ! $can ) {
		return new WP_Error( 'openstation_files_forbidden', __( 'You are not allowed to place this file.', 'desktop-mode' ), array( 'status' => 403 ) );
	}

	if ( (int) $parent_id > 0 ) {
		$target_folder = openstation_files_get_folder( (int) $parent_id );
		if ( $target_folder && (int) $target_folder['owner_id'] !== $user_id ) {
			$cap = function_exists( 'openstation_folder_share_user_capability' )
				? openstation_folder_share_user_capability( (int) $parent_id, $user_id )
				: 'none';
			if ( 'write' !== $cap ) {
				return new WP_Error(
					'openstation_files_no_write_in_shared_folder',
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

	$tables = openstation_files_table_names();
	$now    = openstation_files_now_ms();
	$row    = array(
		'owner_id'      => $user_id,
		'updated_by'    => $user_id,
		'parent_id'     => max( 0, $parent_id ),
		'file_type'     => $type,
		'file_ref'      => $ref,
		'x'             => (int) $args['x'],
		'y'             => (int) $args['y'],
		'sort_order'    => (int) $args['sort_order'],
		'updated_at_ms' => $now,
		'meta'          => null === $args['meta'] ? null : wp_json_encode( $args['meta'] ),
	);

	$insert = static function () use ( $tables, $row ) {
		global $wpdb;
		$prev_suppress = $wpdb->suppress_errors( true );
		$ok            = $wpdb->insert( $tables['placements'], $row, array( '%d', '%d', '%d', '%s', '%s', '%d', '%d', '%d', '%d', '%s' ) );
		$wpdb->suppress_errors( $prev_suppress );
		return array( $ok, (int) $wpdb->insert_id );
	};
	$result = 'upload' === $type ? openstation_stored_files_place_insert( $ref, $insert ) : $insert();
	if ( is_wp_error( $result ) ) {
		return $result;
	}
	list( $ok, $id ) = $result;
	if ( false === $ok ) {

		$existing = $wpdb->get_row(
			$wpdb->prepare(
				"SELECT * FROM {$tables['placements']}
				WHERE owner_id = %d
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
			return new WP_Error( 'openstation_files_insert_failed', __( 'Failed to write placement.', 'desktop-mode' ), array( 'status' => 500 ) );
		}

		$existing_id = (int) $existing['id'];

		if ( ! empty( $existing['trashed_at_ms'] ) ) {
			$restore = openstation_files_restore_placement( $user_id, $existing_id );
			if ( is_wp_error( $restore ) ) {
				return $restore;
			}
		}

		openstation_files_clear_tombstones_for( 'placement', $existing_id );

		$move = openstation_files_move(
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
	$row['id'] = $id;

	do_action( 'openstation_file_placed', $id, $row );

	return $id;
}

function openstation_files_move( $placement_id, $user_id, $changes = array() ) {
	global $wpdb;

	$placement_id = (int) $placement_id;
	$user_id      = (int) $user_id;
	if ( $placement_id <= 0 || $user_id <= 0 ) {
		return new WP_Error( 'openstation_files_bad_request', __( 'Invalid arguments.', 'desktop-mode' ), array( 'status' => 400 ) );
	}

	$row = openstation_files_get_placement( $placement_id );
	if ( ! $row ) {
		return new WP_Error( 'openstation_files_not_found', __( 'Placement not found.', 'desktop-mode' ), array( 'status' => 404 ) );
	}

	$upload_lock = openstation_files_upload_owner_lock( $row, $user_id );
	if ( is_wp_error( $upload_lock ) ) {
		return $upload_lock;
	}

	$is_row_owner = (int) $row['owner_id'] === $user_id;
	if ( (int) $row['parent_id'] > 0 ) {
		$source_folder = openstation_files_get_folder( (int) $row['parent_id'] );
		if ( $source_folder ) {
			$is_folder_owner = (int) $source_folder['owner_id'] === $user_id;
			$source_cap      = function_exists( 'openstation_folder_share_user_capability' )
				? openstation_folder_share_user_capability( (int) $row['parent_id'], $user_id )
				: 'none';
			if ( ! $is_row_owner && ! $is_folder_owner && 'write' !== $source_cap ) {
				return new WP_Error(
					'openstation_files_no_write_in_shared_folder',
					__( 'You only have read access to this folder.', 'desktop-mode' ),
					array( 'status' => 403 )
				);
			}

			if ( $is_row_owner && ! $is_folder_owner && 'write' !== $source_cap ) {
				return new WP_Error(
					'openstation_files_no_write_in_shared_folder',
					__( 'You only have read access to this folder.', 'desktop-mode' ),
					array( 'status' => 403 )
				);
			}
		}
	} elseif ( ! $is_row_owner ) {

		return new WP_Error( 'openstation_files_forbidden', __( 'You cannot edit this placement.', 'desktop-mode' ), array( 'status' => 403 ) );
	}
	if ( isset( $changes['parent_id'] ) ) {
		$target_parent = max( 0, (int) $changes['parent_id'] );
		if ( $target_parent > 0 ) {
			$target = openstation_files_get_folder( $target_parent );
			if ( $target && (int) $target['owner_id'] !== $user_id ) {
				$cap = function_exists( 'openstation_folder_share_user_capability' )
					? openstation_folder_share_user_capability( $target_parent, $user_id )
					: 'none';
				if ( 'write' !== $cap ) {
					return new WP_Error(
						'openstation_files_no_write_in_shared_folder',
						__( 'You only have read access to that folder.', 'desktop-mode' ),
						array( 'status' => 403 )
					);
				}
			}
		}

		if ( 'folder' === (string) $row['file_type'] && $target_parent > 0 ) {
			$moving_folder_id = (int) $row['file_ref'];
			if ( $moving_folder_id > 0 ) {
				if (
					openstation_files_would_create_folder_cycle(
						$user_id,
						$moving_folder_id,
						$target_parent
					)
				) {
					return new WP_Error(
						'openstation_files_folder_cycle',
						__( 'A folder cannot be placed inside itself or one of its descendants.', 'desktop-mode' ),
						array( 'status' => 409 )
					);
				}
			}
		}
	}

	$tables = openstation_files_table_names();
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
		return true;
	}

	$set['updated_at_ms'] = openstation_files_now_ms();
	$fmt[]                = '%d';

	$set['updated_by'] = $user_id;
	$fmt[]             = '%d';

	$ok = $wpdb->update( $tables['placements'], $set, array( 'id' => $placement_id ), $fmt, array( '%d' ) );
	if ( false === $ok ) {
		return new WP_Error( 'openstation_files_update_failed', __( 'Failed to update placement.', 'desktop-mode' ), array( 'status' => 500 ) );
	}

	$next = openstation_files_get_placement( $placement_id );

	do_action( 'openstation_file_moved', $placement_id, $next, $row );

	return true;
}

function openstation_files_remove( $placement_id, $user_id ) {
	global $wpdb;

	$placement_id = (int) $placement_id;
	$user_id      = (int) $user_id;
	$row          = openstation_files_get_placement( $placement_id );
	if ( ! $row ) {
		return new WP_Error( 'openstation_files_not_found', __( 'Placement not found.', 'desktop-mode' ), array( 'status' => 404 ) );
	}

	$upload_lock = openstation_files_upload_owner_lock( $row, $user_id );
	if ( is_wp_error( $upload_lock ) ) {
		return $upload_lock;
	}

	$is_row_owner = (int) $row['owner_id'] === $user_id;
	$allowed      = $is_row_owner;
	if ( ! $allowed && (int) $row['parent_id'] > 0 ) {
		$cap     = function_exists( 'openstation_folder_share_user_capability' )
			? openstation_folder_share_user_capability( (int) $row['parent_id'], $user_id )
			: 'none';
		$allowed = 'write' === $cap;
	}
	if ( ! $allowed ) {
		return new WP_Error( 'openstation_files_forbidden', __( 'You cannot remove this placement.', 'desktop-mode' ), array( 'status' => 403 ) );
	}

	$tables = openstation_files_table_names();
	$ok     = $wpdb->delete( $tables['placements'], array( 'id' => $placement_id ), array( '%d' ) );
	if ( false === $ok ) {
		return new WP_Error( 'openstation_files_delete_failed', __( 'Failed to remove placement.', 'desktop-mode' ), array( 'status' => 500 ) );
	}

	openstation_files_write_tombstone( 'placement', $placement_id );

	do_action( 'openstation_file_unplaced', $placement_id, $row );

	return true;
}

function openstation_files_upload_owner_lock( $row, $user_id ) {
	if ( ! is_array( $row ) || 'upload' !== (string) ( $row['file_type'] ?? '' ) ) {
		return true;
	}
	if ( ! function_exists( 'openstation_stored_files_get' ) ) {
		return true;
	}
	$stored = openstation_stored_files_get( (int) $row['file_ref'] );
	if ( ! $stored ) {
		return true;
	}
	if ( (int) $stored['owner_id'] === (int) $user_id ) {
		return true;
	}
	return new WP_Error(
		'openstation_files_upload_owner_locked',
		__( 'Only the file’s owner can move or delete an uploaded file.', 'desktop-mode' ),
		array( 'status' => 403 )
	);
}

function openstation_files_get_placement( $placement_id ) {
	global $wpdb;
	$tables = openstation_files_table_names();
	$row    = $wpdb->get_row(
		$wpdb->prepare( "SELECT * FROM {$tables['placements']} WHERE id = %d", (int) $placement_id ),
		ARRAY_A
	);
	if ( ! $row ) {
		return null;
	}
	return openstation_files_normalize_placement_row( $row );
}

function openstation_files_get_for_user_folder( $user_id, $parent_id = 0 ) {
	global $wpdb;
	$user_id   = (int) $user_id;
	$parent_id = max( 0, (int) $parent_id );
	if ( $user_id <= 0 ) {
		return array();
	}

	$tables = openstation_files_table_names();

	$share_view = false;
	if ( $parent_id > 0 ) {
		$folder = openstation_files_get_folder( $parent_id );
		if ( ! $folder ) {
			return array();
		}
		if ( (int) $folder['owner_id'] !== $user_id ) {
			$cap = function_exists( 'openstation_folder_share_user_capability' )
				? openstation_folder_share_user_capability( $parent_id, $user_id )
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

	$args = (array) apply_filters( 'openstation_files_query_args', $args, $user_id, $parent_id );

	if ( ! empty( $args['share_view'] ) || (int) $args['parent_id'] > 0 ) {

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
				WHERE owner_id = %d
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
		$normalized = openstation_files_normalize_placement_row( $row );
		$file       = openstation_resolve_file( $normalized['file_type'], $normalized['file_ref'] );
		if ( empty( $args['share_view'] ) ) {

			if ( $file && ! $file->can_read( $user_id ) ) {
				continue;
			}
		} elseif ( $file && ! $file->can_read( $user_id ) ) {

			$normalized['access_gated'] = true;
		}
		$out[] = $normalized;
	}
	return $out;
}

function openstation_files_auto_place_orphans( $user_id ) {
	global $wpdb;
	$user_id = (int) $user_id;
	if ( $user_id <= 0 ) {
		return 0;
	}

	$tables = openstation_files_table_names();

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

	$shortcut_ids = array();
	$registry     = function_exists( 'openstation_desktop_icon_registry' )
		? openstation_desktop_icon_registry()
		: array();
	if ( is_array( $registry ) ) {

		$registry = (array) apply_filters( 'openstation_icons', $registry );
	}
	if ( is_array( $registry ) && ! empty( $registry ) ) {
		$registered_ids = array_map( 'strval', array_keys( $registry ) );
		$placeholders   = implode( ',', array_fill( 0, count( $registered_ids ), '%s' ) );
		$args           = array_merge( array( $user_id ), $registered_ids );
		$placed_ids     = $wpdb->get_col(
			$wpdb->prepare(
				"SELECT file_ref FROM {$tables['placements']}
				WHERE owner_id = %d
					AND file_type = 'shortcut'
					AND trashed_at_ms IS NULL
					AND file_ref IN ($placeholders)",
				$args
			)
		);
		$placed_set     = array_flip( array_map( 'strval', (array) $placed_ids ) );
		foreach ( $registered_ids as $id ) {
			if ( ! isset( $placed_set[ $id ] ) ) {
				$shortcut_ids[] = $id;
			}
		}
	}

	if ( empty( $folder_rows ) && empty( $shortcut_ids ) ) {
		return 0;
	}

	$existing = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT x, y FROM {$tables['placements']}
			WHERE owner_id = %d
				AND parent_id = 0
				AND trashed_at_ms IS NULL",
			$user_id
		),
		ARRAY_A
	);
	$occupied = openstation_files_grid_occupied( $existing );

	$order = openstation_files_grid_order( 0 );

	$placed  = 0;
	$emit_at = function ( $type, $ref, $col, $row ) use ( $user_id, &$occupied, &$placed ) {
		$occupied[ "$col,$row" ] = true;
		$result                  = openstation_files_place(
			$user_id,
			0,
			$type,
			(string) $ref,
			openstation_files_grid_cell_to_point( $col, $row )
		);
		if ( ! is_wp_error( $result ) ) {
			++$placed;
		}
	};
	$emit_next = function ( $type, $ref ) use ( &$occupied, $order, $emit_at ) {
		list( $col, $row ) = openstation_files_grid_next_free( $occupied, $order );
		$emit_at( $type, $ref, $col, $row );
	};

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

		$occupied[ "0,$pinned_idx" ] = true;
		$emit_at( 'shortcut', $id, 0, $pinned_idx );
		++$pinned_idx;
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

function openstation_files_auto_place_orphan_folders( $user_id ) {
	return openstation_files_auto_place_orphans( $user_id );
}

function openstation_files_normalize_placement_row( $row ) {
	$meta_raw = isset( $row['meta'] ) ? (string) $row['meta'] : '';
	$meta     = '' !== $meta_raw ? json_decode( $meta_raw, true ) : null;
	return array(
		'id'            => (int) $row['id'],
		'owner_id'      => (int) $row['owner_id'],

		'updated_by'    => isset( $row['updated_by'] ) ? (int) $row['updated_by'] : null,
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

function openstation_files_write_tombstone( $kind, $ref ) {
	global $wpdb;
	$tables = openstation_files_table_names();
	$wpdb->insert(
		$tables['tombstones'],
		array(
			'kind'          => (string) $kind,
			'ref_id'        => (int) $ref,
			'removed_at_ms' => openstation_files_now_ms(),
		),
		array( '%s', '%d', '%d' )
	);
}

function openstation_files_clear_tombstones_for( $kind, $ref_id ) {
	global $wpdb;
	$ref_id = (int) $ref_id;
	if ( $ref_id <= 0 ) {
		return;
	}
	$tables = openstation_files_table_names();
	$wpdb->delete(
		$tables['tombstones'],
		array(
			'kind'   => (string) $kind,
			'ref_id' => $ref_id,
		),
		array( '%s', '%d' )
	);
}

function openstation_files_prune_tombstones() {
	global $wpdb;
	$tables = openstation_files_table_names();
	$cutoff = openstation_files_now_ms() - ( 7 * DAY_IN_SECONDS * 1000 );
	$wpdb->query( $wpdb->prepare( "DELETE FROM {$tables['tombstones']} WHERE removed_at_ms < %d", $cutoff ) );
}
add_action( 'desktop_mode_files_daily_prune', 'openstation_files_prune_tombstones' );

function openstation_files_schedule_prune() {
	if ( ! wp_next_scheduled( 'desktop_mode_files_daily_prune' ) ) {
		wp_schedule_event( time() + HOUR_IN_SECONDS, 'daily', 'desktop_mode_files_daily_prune' );
	}
}
add_action( 'init', 'openstation_files_schedule_prune' );

function openstation_files_would_create_folder_cycle( $user_id, $moving_folder_id, $target_parent_id ) {
	$moving_folder_id = (int) $moving_folder_id;
	$target_parent_id = (int) $target_parent_id;
	$user_id          = (int) $user_id;
	if ( $moving_folder_id <= 0 || $target_parent_id <= 0 || $user_id <= 0 ) {
		return false;
	}
	if ( $moving_folder_id === $target_parent_id ) {
		return true;
	}
	global $wpdb;
	$tables  = openstation_files_table_names();
	$visited = array();
	$cursor  = $target_parent_id;

	$max_depth = 256;
	while ( $cursor > 0 && $max_depth-- > 0 ) {
		if ( $cursor === $moving_folder_id ) {
			return true;
		}
		if ( isset( $visited[ $cursor ] ) ) {

			return true;
		}
		$visited[ $cursor ] = true;

		$parent_of_cursor = $wpdb->get_var(
			$wpdb->prepare(
				"SELECT parent_id FROM {$tables['placements']}
				WHERE owner_id = %d
					AND file_type = 'folder'
					AND file_ref = %s
					AND trashed_at_ms IS NULL
				LIMIT 1",
				$user_id,
				(string) $cursor
			)
		);
		if ( null === $parent_of_cursor ) {

			return false;
		}
		$cursor = (int) $parent_of_cursor;
	}
	return false;
}
