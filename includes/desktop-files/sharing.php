<?php
/**
 * Desktop Mode — Folder sharing visibility logic.
 *
 * Computes which folders a viewer can see based on each folder's
 * `share_mode` / `share_meta` columns:
 *
 *   - `private` — owner only.
 *   - `users`   — owner + ids in `share_meta.users`.
 *   - `roles`   — owner + users with any role in `share_meta.roles`.
 *   - `all`     — every desktop-mode user on the site.
 *
 * Hooked at priority 5 on `desktop_mode_files_visible_folders`
 * so plugins layering custom share modes (registered via
 * `desktop_mode_files_share_modes`) can run later in the chain
 * without competing for the early slot.
 *
 * @package WPDesktopMode
 * @since   0.9.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Filter callback that augments the owner-only list with folders
 * the viewer can see by virtue of a non-private share mode.
 *
 * @since 0.9.0
 *
 * @param array $owned   Owner-only folders (default from the store).
 * @param int   $user_id Viewer.
 * @return array
 */
function desktop_mode_files_compute_visible_folders( $owned, $user_id ) {
	global $wpdb;
	$user_id = (int) $user_id;
	if ( $user_id <= 0 ) {
		return is_array( $owned ) ? $owned : array();
	}

	$tables = desktop_mode_files_table_names();
	$user   = get_userdata( $user_id );
	$roles  = $user ? array_values( (array) $user->roles ) : array();

	// Source 1 — `share_mode='all'`. Pull straight from the folders
	// table; the shares table never carries 'all' rows.
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

	// Source 2 — accepted shares targeting this viewer (direct
	// user-principal OR matching role-principal).
	$conditions   = array( "(s.principal_type = 'user' AND s.principal_ref = %s)" );
	$prepare_args = array( (string) $user_id );
	if ( ! empty( $roles ) ) {
		$placeholders = implode( ',', array_fill( 0, count( $roles ), '%s' ) );
		$conditions[] = "(s.principal_type = 'role' AND s.principal_ref IN ($placeholders))";
		foreach ( $roles as $role ) {
			$prepare_args[] = (string) $role;
		}
	}
	$where = '(' . implode( ' OR ', $conditions ) . ')';

	// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
	$share_rows = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT DISTINCT f.* FROM {$tables['folders']} f
			INNER JOIN {$tables['shares']} s ON s.folder_id = f.id
			WHERE f.owner_id <> %d
				AND f.trashed_at_ms IS NULL
				AND s.state = 'accepted'
				AND $where",
			array_merge( array( $user_id ), $prepare_args )
		),
		ARRAY_A
	);

	// Source 3 — legacy `share_meta`-driven folders (no row on the
	// shares table yet because they pre-date the migration or were
	// written by an older code path). Evaluating in PHP keeps the
	// query simple; the candidate list is bounded by total folders.
	$legacy_rows = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT * FROM {$tables['folders']}
			WHERE owner_id <> %d
				AND share_mode IN ( 'users', 'roles' )
				AND trashed_at_ms IS NULL",
			$user_id
		),
		ARRAY_A
	);

	$visible  = is_array( $owned ) ? $owned : array();
	$seen_ids = array();
	foreach ( $visible as $row ) {
		$seen_ids[ (int) $row['id'] ] = true;
	}
	foreach ( array_merge( (array) $all_rows, (array) $share_rows, (array) $legacy_rows ) as $raw ) {
		$row = desktop_mode_files_normalize_folder_row( $raw );
		$id  = (int) $row['id'];
		if ( isset( $seen_ids[ $id ] ) ) {
			continue;
		}
		if ( desktop_mode_files_user_can_see_folder( $row, $user_id, $roles ) ) {
			$visible[] = $row;
			$seen_ids[ $id ] = true;
		}
	}
	return $visible;
}
add_filter( 'desktop_mode_files_visible_folders', 'desktop_mode_files_compute_visible_folders', 5, 2 );

/**
 * Whether the viewer's identity satisfies a folder's share rules.
 *
 * @since 0.9.0
 *
 * @param array    $folder      Normalized folder row.
 * @param int      $user_id     Viewer.
 * @param string[] $user_roles  Viewer's roles.
 * @return bool
 */
function desktop_mode_files_user_can_see_folder( $folder, $user_id, $user_roles ) {
	$mode = (string) $folder['share_mode'];

	// Owner always sees the folder.
	if ( (int) $folder['owner_id'] === (int) $user_id ) {
		$can = true;
	} elseif ( 'all' === $mode ) {
		$can = true;
	} else {
		// Any non-owner viewer needs either an accepted share row
		// targeting them OR a matching legacy `share_meta` entry.
		// `share_mode` is no longer the authority — it's a default
		// visibility hint preserved for back-compat.
		$cap = desktop_mode_folder_share_user_capability( (int) $folder['id'], (int) $user_id );
		$can = 'none' !== $cap;
		if ( ! $can ) {
			$meta = is_array( $folder['share_meta'] ) ? $folder['share_meta'] : array();
			if ( 'users' === $mode && isset( $meta['users'] ) && is_array( $meta['users'] ) ) {
				$users = array_map( 'intval', $meta['users'] );
				$can   = in_array( (int) $user_id, $users, true );
			} elseif ( 'roles' === $mode && isset( $meta['roles'] ) && is_array( $meta['roles'] ) ) {
				$roles = array_map( 'strval', $meta['roles'] );
				$can   = (bool) array_intersect( $roles, (array) $user_roles );
			}
		}
	}

	/**
	 * Filter the per-folder visibility decision. Plugins layering
	 * custom share modes (e.g. 'team', 'workspace') can compute
	 * `$can` here.
	 *
	 * @since 0.9.0
	 *
	 * @param bool     $can     Default decision.
	 * @param array    $folder  Folder row.
	 * @param int      $user_id Viewer.
	 * @param string[] $roles   Viewer's roles.
	 */
	return (bool) apply_filters( 'desktop_mode_files_user_can_see_folder', $can, $folder, $user_id, $user_roles );
}
