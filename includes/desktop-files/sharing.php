<?php

defined( 'ABSPATH' ) || exit;

function openstation_files_compute_visible_folders( $owned, $user_id ) {
	global $wpdb;
	$user_id = (int) $user_id;
	if ( $user_id <= 0 ) {
		return is_array( $owned ) ? $owned : array();
	}

	$tables = openstation_files_table_names();
	$user   = get_userdata( $user_id );
	$roles  = $user ? array_values( (array) $user->roles ) : array();

	$all_rows = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT * FROM {$tables['folders']}
			WHERE owner_id <> %d
				AND share_mode = 'all'
				AND trashed_at_ms IS NULL",
			$user_id
		),
		ARRAY_A
	);

	$user_share_rows = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT DISTINCT f.* FROM {$tables['folders']} f
			INNER JOIN {$tables['shares']} s ON s.folder_id = f.id
			WHERE f.owner_id <> %d
				AND f.trashed_at_ms IS NULL
				AND s.state = 'accepted'
				AND s.principal_type = 'user'
				AND s.principal_ref = %s",
			$user_id,
			(string) $user_id
		),
		ARRAY_A
	);

	$role_share_rows = array();
	if ( ! empty( $roles ) ) {
		$placeholders = implode( ',', array_fill( 0, count( $roles ), '%s' ) );
		$role_args    = array_merge( array( $user_id, $user_id ), array_map( 'strval', $roles ) );

		$role_share_rows = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT DISTINCT f.* FROM {$tables['folders']} f
				INNER JOIN {$tables['shares']} s ON s.folder_id = f.id
				INNER JOIN {$tables['decisions']} d
					ON d.share_id = s.id
					AND d.user_id = %d
					AND d.state = 'accepted'
				WHERE f.owner_id <> %d
					AND f.trashed_at_ms IS NULL
					AND s.principal_type = 'role'
					AND s.principal_ref IN ($placeholders)",
				$role_args
			),
			ARRAY_A
		);
	}

	$share_rows = array_merge( (array) $user_share_rows, (array) $role_share_rows );

	$visible  = is_array( $owned ) ? $owned : array();
	$seen_ids = array();
	foreach ( $visible as $row ) {
		$seen_ids[ (int) $row['id'] ] = true;
	}
	foreach ( array_merge( (array) $all_rows, (array) $share_rows ) as $raw ) {
		$row = openstation_files_normalize_folder_row( $raw );
		$id  = (int) $row['id'];
		if ( isset( $seen_ids[ $id ] ) ) {
			continue;
		}
		if ( openstation_files_user_can_see_folder( $row, $user_id, $roles ) ) {
			$visible[]       = $row;
			$seen_ids[ $id ] = true;
		}
	}
	return $visible;
}
add_filter( 'openstation_files_visible_folders', 'openstation_files_compute_visible_folders', 5, 2 );

function openstation_files_user_can_see_folder( $folder, $user_id, $user_roles ) {
	$mode = (string) $folder['share_mode'];

	if ( (int) $folder['owner_id'] === (int) $user_id ) {
		$can = true;
	} elseif ( 'all' === $mode ) {
		$can = true;
	} else {

		$cap = openstation_folder_share_user_capability( (int) $folder['id'], (int) $user_id );
		$can = 'none' !== $cap;
	}

	return (bool) apply_filters( 'openstation_files_user_can_see_folder', $can, $folder, $user_id, $user_roles );
}
