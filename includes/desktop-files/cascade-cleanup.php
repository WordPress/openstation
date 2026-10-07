<?php

defined( 'ABSPATH' ) || exit;

function openstation_files_cascade_trash_placements_for_entity( $file_type, $file_ref ) {
	global $wpdb;
	$file_type = (string) $file_type;
	$file_ref  = (string) $file_ref;
	if ( '' === $file_type || '' === $file_ref ) {
		return 0;
	}
	$tables = openstation_files_table_names();

	$rows = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT id, owner_id, parent_id
			FROM {$tables['placements']}
			WHERE file_type = %s
				AND file_ref = %s
				AND trashed_at_ms IS NULL",
			$file_type,
			$file_ref
		),
		ARRAY_A
	);
	if ( empty( $rows ) ) {
		return 0;
	}

	$now     = openstation_files_now_ms();
	$trashed = 0;
	foreach ( $rows as $row ) {
		$placement_id = (int) $row['id'];
		$owner_id     = (int) $row['owner_id'];
		$ancestry     = openstation_files_capture_ancestry( (int) $row['parent_id'] );

		$meta = wp_json_encode(
			array(
				'ancestry' => $ancestry,
				'cascade'  => array(
					'reason'    => $file_type . '_trashed',
					'file_type' => $file_type,
					'file_ref'  => $file_ref,
				),
			)
		);
		$ok   = $wpdb->update(
			$tables['placements'],
			array(
				'trashed_at_ms' => $now,
				'trashed_by'    => $owner_id,
				'trashed_meta'  => $meta,
				'updated_at_ms' => $now,
			),
			array( 'id' => $placement_id ),
			array( '%d', '%d', '%s', '%d' ),
			array( '%d' )
		);
		if ( false === $ok ) {
			continue;
		}
		++$trashed;

		do_action(
			'openstation_files_after_cascade_trash_placement',
			$placement_id,
			$owner_id,
			$file_type,
			$file_ref
		);
	}

	return $trashed;
}

function openstation_files_cascade_on_post_trash( $post_id ) {
	$post_id = (int) $post_id;
	if ( $post_id <= 0 ) {
		return;
	}
	$post = get_post( $post_id );
	if ( ! $post instanceof WP_Post ) {
		return;
	}

	if ( 'attachment' === $post->post_type ) {
		openstation_files_cascade_trash_placements_for_entity(
			'attachment',
			(string) $post_id
		);
		return;
	}
	openstation_files_cascade_trash_placements_for_entity( 'post', (string) $post_id );
}

add_action( 'wp_trash_post', 'openstation_files_cascade_on_post_trash', 10, 1 );
add_action( 'before_delete_post', 'openstation_files_cascade_on_post_trash', 10, 1 );

function openstation_files_cascade_on_attachment_delete( $attachment_id ) {
	$attachment_id = (int) $attachment_id;
	if ( $attachment_id <= 0 ) {
		return;
	}
	openstation_files_cascade_trash_placements_for_entity(
		'attachment',
		(string) $attachment_id
	);
}

add_action( 'delete_attachment', 'openstation_files_cascade_on_attachment_delete', 10, 1 );

function openstation_files_cascade_on_user_delete( $user_id ) {
	$user_id = (int) $user_id;
	if ( $user_id <= 0 ) {
		return;
	}
	openstation_files_cascade_trash_placements_for_entity(
		'user',
		(string) $user_id
	);
}

add_action( 'deleted_user', 'openstation_files_cascade_on_user_delete', 10, 1 );
