<?php
/**
 * OpenStation — Cascade cleanup of placements on entity trash.
 *
 * When a WordPress entity that a desktop shortcut points at is
 * trashed or deleted, the matching placement rows are soft-trashed
 * so the wallpaper stops painting tiles that resolve to nothing.
 *
 * Hooks cover every route an entity can leave the live set by:
 *
 *   - `wp_trash_post`      — post / page / attachment moved to
 *                            WP trash (our drag-to-trash, our CMO,
 *                            WP admin, WP-CLI all funnel through
 *                            this).
 *   - `before_delete_post` — force-delete (bypasses the trash
 *                            stage when `EMPTY_TRASH_DAYS === 0`
 *                            or the caller passed `force_delete`).
 *   - `delete_attachment`  — hard-delete path for attachments that
 *                            skips `wp_trash_post`.
 *   - `deleted_user`       — user account removed (with or without
 *                            content reassignment).
 *
 * Implementation is a bulk UPDATE that bypasses the per-placement
 * permission check used by user-initiated trash. The trashing
 * action has already been authorized at the entity level (Core
 * gates the `wp_trash_post` cap, `delete_users`, etc.); cascading
 * to the desktop shortcuts is a downstream side-effect of that
 * authorized action, not a fresh user gesture.
 *
 * Soft-trash semantics: `trashed_at_ms` is set but the row stays
 * in the table. The placement surfaces in the Recycle Bin and the
 * user can restore it from there (independent of the source entity's
 * trash status — restoring a post does NOT auto-restore its shortcut).
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Soft-trash every live placement pointing at the given entity.
 *
 * Iterates `wp_desktop_mode_file_placements` for rows with the
 * matching `file_type` + `file_ref` whose `trashed_at_ms` is
 * unset, and stamps the trash columns. Each affected placement
 * fires `openstation_files_after_cascade_trash_placement` so
 * plugins (and the live UI refresh path) can react.
 *
 * Idempotent: re-running with an already-trashed entity is a
 * no-op because the `trashed_at_ms IS NULL` filter excludes
 * placements that were trashed by a previous pass.
 *
 * Bulk-friendly: the function tolerates an entity with many
 * placements across many users — the affected placement count
 * is unbounded by the API but bounded in practice by the number
 * of users who shortcutted the same entity.
 *
 * @param string     $file_type File-type slug — `'post'`,
 *                              `'attachment'`, `'user'`, plugin-
 *                              defined. Must match
 *                              {@see OpenStation_File::type()}.
 * @param string|int $file_ref  Entity ref (post id, user id, …).
 * @return int Number of placements soft-trashed.
 */
function openstation_files_cascade_trash_placements_for_entity( $file_type, $file_ref ) {
	global $wpdb;
	$file_type = (string) $file_type;
	$file_ref  = (string) $file_ref;
	if ( '' === $file_type || '' === $file_ref ) {
		return 0;
	}
	$tables = openstation_files_table_names();

	// SELECT the affected rows up front so we can fire a per-row
	// action without a second roundtrip. Restrict to live (not yet
	// trashed) placements — the cascade is idempotent and we don't
	// want to re-stamp `trashed_at_ms` on rows the user trashed
	// individually before the source entity was trashed.
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
		// `trashed_meta` carries the ancestry (so a restore knows
		// where to put the tile back) plus a cascade marker so the
		// recycle-bin UI can distinguish entity-cascade rows from
		// user-initiated trashes if a plugin ever wants to render
		// the source ("Trashed because the post was trashed.").
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
		$ok = $wpdb->update(
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

		/**
		 * Fires after a placement has been cascade-trashed because
		 * its source entity was trashed.
		 *
		 * @param int        $placement_id Placement id.
		 * @param int        $owner_id     Placement owner.
		 * @param string     $file_type    Source entity file type.
		 * @param string|int $file_ref     Source entity ref.
		 */
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

/**
 * Wrap a `(post_id)` Core action so it cascades against
 * `file_type='post'`. Both `wp_trash_post` and `before_delete_post`
 * pass the post id as the first arg.
 *
 * Attachments share the post-id space and CAN go through these
 * hooks too — but attachment placements use `file_type='attachment'`
 * (not `'post'`), so this wrapper would miss them. The separate
 * `delete_attachment` hook below covers attachments.
 *
 * @param int $post_id Post id.
 */
function openstation_files_cascade_on_post_trash( $post_id ) {
	$post_id = (int) $post_id;
	if ( $post_id <= 0 ) {
		return;
	}
	$post = get_post( $post_id );
	if ( ! $post instanceof WP_Post ) {
		return;
	}
	// Attachments route to the `attachment` file-type, NOT `post`,
	// so the post-keyed cascade would no-op on them. The dedicated
	// `delete_attachment` hook below catches the hard-delete path;
	// the soft-trash path for attachments (when `EMPTY_TRASH_DAYS`
	// is non-zero) also fires `wp_trash_post` — we cover it by
	// dispatching to the attachment cascade below.
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

/**
 * Force-delete path for attachments — Core's `wp_delete_attachment()`
 * fires this BEFORE the attachment row is gone, so `get_post()` is
 * still resolvable for any plugin that needs the metadata.
 *
 * @param int $attachment_id Attachment id.
 */
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

/**
 * User account removed — cascade-trash every shortcut whose
 * `file_type='user', file_ref='<id>'` pointed at the gone user.
 * Fires AFTER deletion (`deleted_user`) because user-deletion in
 * Core involves reassigning content; we don't need the live user
 * row, only its id.
 *
 * @param int $user_id Deleted user id.
 */
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
