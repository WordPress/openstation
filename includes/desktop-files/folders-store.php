<?php
/**
 * Desktop Mode — Folders store.
 *
 * CRUD primitives for the `_desktop_mode_folders` table. Folders
 * are first-class files: they have an owner, a name, a share
 * mode, and a JSON `share_meta` column carrying the user / role
 * lists when `share_mode` is `users` or `roles`.
 *
 * Phase 2 ships private folders only. Phase 6 lights up the
 * other share modes plus the `desktop_mode_files_visible_folders`
 * filter that gates which folders a viewer can see.
 *
 * @package WPDesktopMode
 * @since   0.9.0
 */

defined( 'ABSPATH' ) || exit;

/** Allowed share-mode values. */
function desktop_mode_files_share_modes() {
	$modes = array( 'private', 'users', 'roles', 'all' );
	/**
	 * Filter the allowed `share_mode` values. Plugins can add
	 * (e.g. 'team') by registering both the value here and a
	 * matching visibility callback.
	 *
	 * @since 0.9.0
	 *
	 * @param string[] $modes Default modes.
	 */
	return (array) apply_filters( 'desktop_mode_files_share_modes', $modes );
}

/**
 * Create a folder.
 *
 * @since 0.9.0
 *
 * @param int   $owner_id Owner.
 * @param array $args     `name`, `share_mode`, `share_meta`.
 * @return int|WP_Error Folder id on success.
 */
function desktop_mode_files_create_folder( $owner_id, $args = array() ) {
	global $wpdb;

	$owner_id = (int) $owner_id;
	if ( $owner_id <= 0 ) {
		return new WP_Error( 'desktop_mode_files_invalid_user', __( 'A user id is required.', 'desktop-mode' ), array( 'status' => 400 ) );
	}

	$args = wp_parse_args( $args, array(
		'name'       => '',
		'share_mode' => 'private',
		'share_meta' => null,
	) );

	$name = sanitize_text_field( (string) $args['name'] );
	if ( '' === $name ) {
		return new WP_Error( 'desktop_mode_files_missing_name', __( 'Folder name is required.', 'desktop-mode' ), array( 'status' => 400 ) );
	}

	$mode  = (string) $args['share_mode'];
	$modes = desktop_mode_files_share_modes();
	if ( ! in_array( $mode, $modes, true ) ) {
		return new WP_Error( 'desktop_mode_files_invalid_share_mode', __( 'Invalid share mode.', 'desktop-mode' ), array( 'status' => 400, 'mode' => $mode ) );
	}

	$tables = desktop_mode_files_table_names();
	$now    = desktop_mode_files_now_ms();
	$row    = array(
		'owner_id'      => $owner_id,
		'name'          => $name,
		'share_mode'    => $mode,
		'share_meta'    => null === $args['share_meta'] ? null : wp_json_encode( $args['share_meta'] ),
		'updated_at_ms' => $now,
	);

	$ok = $wpdb->insert( $tables['folders'], $row, array( '%d', '%s', '%s', '%s', '%d' ) );
	if ( false === $ok ) {
		return new WP_Error( 'desktop_mode_files_insert_failed', __( 'Failed to create folder.', 'desktop-mode' ), array( 'status' => 500 ) );
	}
	$id = (int) $wpdb->insert_id;

	$row['id'] = $id;

	/**
	 * Fires after a folder is created.
	 *
	 * @since 0.9.0
	 *
	 * @param int   $id  Folder id.
	 * @param array $row Inserted row.
	 */
	do_action( 'desktop_mode_folder_created', $id, $row );

	return $id;
}

/**
 * Update a folder. Only the owner can update for now.
 *
 * @since 0.9.0
 *
 * @param int   $folder_id Folder id.
 * @param int   $user_id   Acting user.
 * @param array $changes   `name`, `share_mode`, `share_meta`.
 * @return true|WP_Error
 */
function desktop_mode_files_update_folder( $folder_id, $user_id, $changes = array() ) {
	global $wpdb;

	$folder_id = (int) $folder_id;
	$user_id   = (int) $user_id;
	$prev      = desktop_mode_files_get_folder( $folder_id );
	if ( ! $prev ) {
		return new WP_Error( 'desktop_mode_files_not_found', __( 'Folder not found.', 'desktop-mode' ), array( 'status' => 404 ) );
	}
	if ( (int) $prev['owner_id'] !== $user_id ) {
		return new WP_Error( 'desktop_mode_files_forbidden', __( 'You cannot edit this folder.', 'desktop-mode' ), array( 'status' => 403 ) );
	}

	$set = array();
	$fmt = array();

	if ( isset( $changes['name'] ) ) {
		$name = sanitize_text_field( (string) $changes['name'] );
		if ( '' === $name ) {
			return new WP_Error( 'desktop_mode_files_missing_name', __( 'Folder name cannot be empty.', 'desktop-mode' ), array( 'status' => 400 ) );
		}
		$set['name'] = $name;
		$fmt[]       = '%s';
	}
	if ( isset( $changes['share_mode'] ) ) {
		$mode  = (string) $changes['share_mode'];
		$modes = desktop_mode_files_share_modes();
		if ( ! in_array( $mode, $modes, true ) ) {
			return new WP_Error( 'desktop_mode_files_invalid_share_mode', __( 'Invalid share mode.', 'desktop-mode' ), array( 'status' => 400 ) );
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

	$set['updated_at_ms'] = desktop_mode_files_now_ms();
	$fmt[]                = '%d';

	$tables = desktop_mode_files_table_names();
	$ok     = $wpdb->update( $tables['folders'], $set, array( 'id' => $folder_id ), $fmt, array( '%d' ) );
	if ( false === $ok ) {
		return new WP_Error( 'desktop_mode_files_update_failed', __( 'Failed to update folder.', 'desktop-mode' ), array( 'status' => 500 ) );
	}

	$next = desktop_mode_files_get_folder( $folder_id );

	/**
	 * Fires after a folder is updated.
	 *
	 * @since 0.9.0
	 *
	 * @param int   $id   Folder id.
	 * @param array $next Row after.
	 * @param array $prev Row before.
	 */
	do_action( 'desktop_mode_folder_updated', $folder_id, $next, $prev );

	if ( isset( $changes['share_mode'] ) || array_key_exists( 'share_meta', $changes ) ) {
		/**
		 * Fires after a folder's share state changes (mode or
		 * meta). Plugins listening for sharing events can subscribe
		 * to this rather than diff `desktop_mode_folder_updated`.
		 *
		 * @since 0.9.0
		 *
		 * @param int   $id   Folder id.
		 * @param array $next Row after.
		 * @param array $prev Row before.
		 */
		do_action( 'desktop_mode_folder_shared', $folder_id, $next, $prev );
	}

	return true;
}

/**
 * Delete a folder. Cascades into any placements scoped to this
 * folder by writing tombstones for each. Children at multiple
 * depths are NOT recursively deleted in Phase 2 — that would
 * require a tree walk and we keep it explicit until Phase 3
 * validates the UX expectation.
 *
 * @since 0.9.0
 *
 * @param int $folder_id Folder id.
 * @param int $user_id   Acting user.
 * @return true|WP_Error
 */
function desktop_mode_files_delete_folder( $folder_id, $user_id ) {
	global $wpdb;

	$folder_id = (int) $folder_id;
	$user_id   = (int) $user_id;
	$row       = desktop_mode_files_get_folder( $folder_id );
	if ( ! $row ) {
		return new WP_Error( 'desktop_mode_files_not_found', __( 'Folder not found.', 'desktop-mode' ), array( 'status' => 404 ) );
	}
	if ( (int) $row['owner_id'] !== $user_id ) {
		return new WP_Error( 'desktop_mode_files_forbidden', __( 'You cannot delete this folder.', 'desktop-mode' ), array( 'status' => 403 ) );
	}

	$tables = desktop_mode_files_table_names();

	// Cascade: tombstone every placement that lived inside this folder.
	$child_ids = $wpdb->get_col(
		$wpdb->prepare( "SELECT id FROM {$tables['placements']} WHERE parent_id = %d", $folder_id )
	);
	foreach ( (array) $child_ids as $cid ) {
		desktop_mode_files_write_tombstone( 'placement', (int) $cid );
	}
	$wpdb->delete( $tables['placements'], array( 'parent_id' => $folder_id ), array( '%d' ) );

	$ok = $wpdb->delete( $tables['folders'], array( 'id' => $folder_id ), array( '%d' ) );
	if ( false === $ok ) {
		return new WP_Error( 'desktop_mode_files_delete_failed', __( 'Failed to delete folder.', 'desktop-mode' ), array( 'status' => 500 ) );
	}

	desktop_mode_files_write_tombstone( 'folder', $folder_id );

	/**
	 * Fires after a folder is deleted.
	 *
	 * @since 0.9.0
	 *
	 * @param int   $id  Folder id.
	 * @param array $row Removed row.
	 */
	do_action( 'desktop_mode_folder_deleted', $folder_id, $row );

	return true;
}

/**
 * Lookup a folder row by id.
 *
 * @since 0.9.0
 *
 * @param int $folder_id Folder id.
 * @return array|null
 */
function desktop_mode_files_get_folder( $folder_id, $include_trashed = false ) {
	global $wpdb;
	$tables = desktop_mode_files_table_names();
	$row    = $wpdb->get_row(
		$wpdb->prepare( "SELECT * FROM {$tables['folders']} WHERE id = %d", (int) $folder_id ),
		ARRAY_A
	);
	if ( ! $row ) {
		return null;
	}
	// Trashed folders are invisible to active code paths by
	// default — recycle-bin callers pass `true` to opt in.
	if ( ! $include_trashed && ! empty( $row['trashed_at_ms'] ) ) {
		return null;
	}
	return desktop_mode_files_normalize_folder_row( $row );
}

/**
 * Folders visible to `$user_id`. Phase 2 ships private only —
 * the viewer is the owner. Phase 6 expands this with the
 * `desktop_mode_files_visible_folders` filter.
 *
 * @since 0.9.0
 *
 * @param int $user_id Viewer.
 * @return array[]
 */
function desktop_mode_files_get_visible_folders( $user_id ) {
	global $wpdb;
	$user_id = (int) $user_id;
	if ( $user_id <= 0 ) {
		return array();
	}

	$tables = desktop_mode_files_table_names();
	$rows   = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT * FROM {$tables['folders']}
			WHERE owner_id = %d AND trashed_at_ms IS NULL",
			$user_id
		),
		ARRAY_A
	);
	$out = array();
	foreach ( (array) $rows as $row ) {
		$out[] = desktop_mode_files_normalize_folder_row( $row );
	}

	/**
	 * Filter the folders visible to a viewer. Phase 6's sharing
	 * logic merges shared folders onto this list.
	 *
	 * @since 0.9.0
	 *
	 * @param array[] $folders Folders the viewer owns.
	 * @param int     $user_id Viewer.
	 */
	return (array) apply_filters( 'desktop_mode_files_visible_folders', $out, $user_id );
}

/**
 * @since 0.9.0
 * @internal
 *
 * @param array $row Raw wpdb row.
 * @return array
 */
function desktop_mode_files_normalize_folder_row( $row ) {
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
