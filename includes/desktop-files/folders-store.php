<?php

defined( 'ABSPATH' ) || exit;

function openstation_files_share_modes() {
	$modes = array( 'private', 'users', 'roles', 'all' );

	return (array) apply_filters( 'openstation_files_share_modes', $modes );
}

function openstation_files_create_folder( $owner_id, $args = array() ) {
	global $wpdb;

	$owner_id = (int) $owner_id;
	if ( $owner_id <= 0 ) {
		return new WP_Error( 'openstation_files_invalid_user', __( 'A user id is required.', 'desktop-mode' ), array( 'status' => 400 ) );
	}

	$args = wp_parse_args(
		$args,
		array(
			'name'       => '',
			'share_mode' => 'private',
			'share_meta' => null,
		)
	);

	$name = sanitize_text_field( (string) $args['name'] );
	if ( '' === $name ) {
		return new WP_Error( 'openstation_files_missing_name', __( 'Folder name is required.', 'desktop-mode' ), array( 'status' => 400 ) );
	}

	$mode  = (string) $args['share_mode'];
	$modes = openstation_files_share_modes();
	if ( ! in_array( $mode, $modes, true ) ) {
		return new WP_Error(
			'openstation_files_invalid_share_mode',
			__( 'Invalid share mode.', 'desktop-mode' ),
			array(
				'status' => 400,
				'mode'   => $mode,
			)
		);
	}

	$tables = openstation_files_table_names();
	$now    = openstation_files_now_ms();
	$row    = array(
		'owner_id'      => $owner_id,
		'name'          => $name,
		'share_mode'    => $mode,
		'share_meta'    => null === $args['share_meta'] ? null : wp_json_encode( $args['share_meta'] ),
		'updated_at_ms' => $now,
	);

	$ok = $wpdb->insert( $tables['folders'], $row, array( '%d', '%s', '%s', '%s', '%d' ) );
	if ( false === $ok ) {
		return new WP_Error( 'openstation_files_insert_failed', __( 'Failed to create folder.', 'desktop-mode' ), array( 'status' => 500 ) );
	}
	$id = (int) $wpdb->insert_id;

	$row['id'] = $id;

	do_action( 'openstation_folder_created', $id, $row );

	return $id;
}

function openstation_files_update_folder( $folder_id, $user_id, $changes = array() ) {
	global $wpdb;

	$folder_id = (int) $folder_id;
	$user_id   = (int) $user_id;
	$prev      = openstation_files_get_folder( $folder_id );
	if ( ! $prev ) {
		return new WP_Error( 'openstation_files_not_found', __( 'Folder not found.', 'desktop-mode' ), array( 'status' => 404 ) );
	}
	if ( (int) $prev['owner_id'] !== $user_id ) {
		return new WP_Error( 'openstation_files_forbidden', __( 'You cannot edit this folder.', 'desktop-mode' ), array( 'status' => 403 ) );
	}

	$set = array();
	$fmt = array();

	if ( isset( $changes['name'] ) ) {
		$name = sanitize_text_field( (string) $changes['name'] );
		if ( '' === $name ) {
			return new WP_Error( 'openstation_files_missing_name', __( 'Folder name cannot be empty.', 'desktop-mode' ), array( 'status' => 400 ) );
		}
		$set['name'] = $name;
		$fmt[]       = '%s';
	}
	if ( isset( $changes['share_mode'] ) ) {
		$mode  = (string) $changes['share_mode'];
		$modes = openstation_files_share_modes();
		if ( ! in_array( $mode, $modes, true ) ) {
			return new WP_Error( 'openstation_files_invalid_share_mode', __( 'Invalid share mode.', 'desktop-mode' ), array( 'status' => 400 ) );
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

	$now                  = openstation_files_now_ms();
	$set['updated_at_ms'] = $now;
	$fmt[]                = '%d';

	$tables = openstation_files_table_names();
	$ok     = $wpdb->update( $tables['folders'], $set, array( 'id' => $folder_id ), $fmt, array( '%d' ) );
	if ( false === $ok ) {
		return new WP_Error( 'openstation_files_update_failed', __( 'Failed to update folder.', 'desktop-mode' ), array( 'status' => 500 ) );
	}

	if ( isset( $changes['name'] ) ) {

		$where = (string) apply_filters(
			'openstation_folder_rename_bump_where',
			$wpdb->prepare(
				"file_type = 'folder' AND file_ref = %s",
				(string) $folder_id
			),
			$folder_id,
			$user_id
		);
		if ( '' !== $where ) {

			$wpdb->query(
				$wpdb->prepare(
					"UPDATE {$tables['placements']} SET updated_at_ms = %d WHERE {$where}",
					$now
				)
			);
		}

		do_action(
			'openstation_folder_renamed',
			$folder_id,
			(string) $set['name'],
			(string) $prev['name'],
			$user_id
		);
	}

	$next = openstation_files_get_folder( $folder_id );

	do_action( 'openstation_folder_updated', $folder_id, $next, $prev );

	if ( isset( $changes['share_mode'] ) || array_key_exists( 'share_meta', $changes ) ) {

		do_action( 'openstation_folder_shared', $folder_id, $next, $prev );
	}

	return true;
}

function openstation_files_delete_folder( $folder_id, $user_id ) {
	$folder_id = (int) $folder_id;
	$user_id   = (int) $user_id;
	$row       = openstation_files_get_folder( $folder_id );
	if ( ! $row ) {
		return new WP_Error( 'openstation_files_not_found', __( 'Folder not found.', 'desktop-mode' ), array( 'status' => 404 ) );
	}
	if ( (int) $row['owner_id'] !== $user_id ) {
		return new WP_Error( 'openstation_files_forbidden', __( 'You cannot delete this folder.', 'desktop-mode' ), array( 'status' => 403 ) );
	}

	$can = apply_filters(
		'openstation_files_can_delete_folder',
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
			'openstation_files_delete_vetoed',
			__( 'A plugin blocked this folder from being deleted.', 'desktop-mode' ),
			array( 'status' => 403 )
		);
	}

	do_action( 'openstation_files_before_delete_folder', $folder_id, $user_id, $row );

	$visited = array();
	$summary = array(
		'folders_deleted'     => array(),
		'shares_revoked'      => array(),
		'placements_pointing' => array(),
		'placements_inside'   => array(),
	);
	$result  = openstation_files_delete_folder_recursive( $folder_id, $user_id, $visited, $summary );
	if ( is_wp_error( $result ) ) {
		return $result;
	}

	do_action(
		'openstation_files_after_delete_folder_cascade',
		$folder_id,
		$user_id,
		$summary
	);

	return true;
}

function openstation_files_delete_folder_recursive( $folder_id, $user_id, &$visited, &$summary = null ) {
	global $wpdb;
	$folder_id = (int) $folder_id;
	if ( isset( $visited[ $folder_id ] ) ) {
		return true;
	}
	$visited[ $folder_id ] = true;
	$row                   = openstation_files_get_folder( $folder_id );
	if ( ! $row ) {
		return true;
	}

	$tables = openstation_files_table_names();
	if ( null === $summary || ! is_array( $summary ) ) {
		$summary = array(
			'folders_deleted'     => array(),
			'shares_revoked'      => array(),
			'placements_pointing' => array(),
			'placements_inside'   => array(),
		);
	}

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
		$sub_row = openstation_files_get_folder( $sub_id );
		if ( $sub_row && (int) $sub_row['owner_id'] === $user_id ) {
			openstation_files_delete_folder_recursive( $sub_id, $user_id, $visited, $summary );
		}
	}

	$share_rows = (array) $wpdb->get_results(
		$wpdb->prepare(
			"SELECT * FROM {$tables['shares']} WHERE target_type = 'folder' AND folder_id = %d",
			$folder_id
		),
		ARRAY_A
	);
	$share_ids  = array();
	foreach ( $share_rows as $share_row ) {
		$share_ids[] = (int) $share_row['id'];
	}
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

		foreach ( $share_rows as $share_row ) {

			do_action(
				'openstation_files_share_revoked',
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
		$summary['placements_pointing'] = array_merge(
			$summary['placements_pointing'],
			array_map( 'intval', $pointing_ids )
		);
	}

	$inside_rows = (array) $wpdb->get_results(
		$wpdb->prepare(
			"SELECT * FROM {$tables['placements']} WHERE parent_id = %d",
			$folder_id
		),
		ARRAY_A
	);
	$inside_ids  = array();
	foreach ( $inside_rows as $inside_row ) {
		$inside_ids[] = (int) $inside_row['id'];
		openstation_files_write_tombstone( 'placement', (int) $inside_row['id'] );
	}
	if ( ! empty( $inside_ids ) ) {
		$wpdb->delete( $tables['placements'], array( 'parent_id' => $folder_id ), array( '%d' ) );

		if ( function_exists( 'openstation_stored_files_handle_unplaced' ) ) {
			foreach ( $inside_rows as $inside_row ) {
				if ( 'upload' === (string) $inside_row['file_type'] ) {
					openstation_stored_files_handle_unplaced(
						(int) $inside_row['id'],
						openstation_files_normalize_placement_row( $inside_row )
					);
				}
			}
		}
		$summary['placements_inside'] = array_merge(
			$summary['placements_inside'],
			array_map( 'intval', $inside_ids )
		);
	}

	$ok = $wpdb->delete( $tables['folders'], array( 'id' => $folder_id ), array( '%d' ) );
	if ( false === $ok ) {
		return new WP_Error( 'openstation_files_delete_failed', __( 'Failed to delete folder.', 'desktop-mode' ), array( 'status' => 500 ) );
	}
	openstation_files_write_tombstone( 'folder', $folder_id );
	$summary['folders_deleted'][] = $folder_id;

	do_action( 'openstation_folder_deleted', $folder_id, $row );

	return true;
}

function openstation_files_get_folder( $folder_id, $include_trashed = false ) {
	global $wpdb;
	$tables = openstation_files_table_names();
	$row    = $wpdb->get_row(
		$wpdb->prepare( "SELECT * FROM {$tables['folders']} WHERE id = %d", (int) $folder_id ),
		ARRAY_A
	);
	if ( ! $row ) {
		return null;
	}

	if ( ! $include_trashed && ! empty( $row['trashed_at_ms'] ) ) {
		return null;
	}
	return openstation_files_normalize_folder_row( $row );
}

function openstation_files_get_visible_folders( $user_id ) {
	global $wpdb;
	$user_id = (int) $user_id;
	if ( $user_id <= 0 ) {
		return array();
	}

	$tables = openstation_files_table_names();
	$rows   = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT * FROM {$tables['folders']}
			WHERE owner_id = %d AND trashed_at_ms IS NULL",
			$user_id
		),
		ARRAY_A
	);
	$out    = array();
	foreach ( (array) $rows as $row ) {
		$out[] = openstation_files_normalize_folder_row( $row );
	}

	return (array) apply_filters( 'openstation_files_visible_folders', $out, $user_id );
}

function openstation_files_normalize_folder_row( $row ) {
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
