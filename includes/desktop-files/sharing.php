<?php
/**
 * Desktop Mode — Folder sharing visibility logic.
 *
 * Computes which folders a viewer can see from each folder's
 * `share_mode` plus the shares / decisions tables:
 *
 *   - `private` — owner only.
 *   - `users` / `roles` — owner + principals holding an accepted
 *     grant in the `_desktop_mode_folder_shares` table (role grants
 *     additionally require a per-user accepted row in the decisions
 *     table). The folders row's `share_meta` column is
 *     diagnostic-only and is never consulted for visibility.
 *   - `all`     — every desktop-mode user on the site.
 *
 * Hooked at priority 5 on `desktop_mode_files_visible_folders`
 * so plugins layering custom share modes (registered via
 * `desktop_mode_files_share_modes`) can run later in the chain
 * without competing for the early slot.
 *
 * @package WPDesktopMode
 */

defined( 'ABSPATH' ) || exit;

/**
 * Filter callback that augments the owner-only list with folders
 * the viewer can see by virtue of a non-private share mode.
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

	// Source 2 — accepted user-principal shares. State lives on the
	// shares row: once the recipient clicks Accept we flip
	// `state='accepted'` directly.
	// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
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

	// Source 2b — role-principal shares the viewer has individually
	// accepted via the per-user decisions table. The shares row
	// itself intentionally stays `state='pending'` for role-principal
	// invites (we don't flip a role share to 'accepted' on behalf of
	// every member of the role — that would be a "first to click
	// decides for all" bug). The per-user acceptance lives in the
	// decisions table, mirroring the resolution logic in
	// `desktop_mode_folder_share_user_capability`.
	//
	// Without this join the role recipient could see the folder via
	// REST `list_placements` (which routes through
	// `_user_capability`, which DOES consult decisions) but their
	// heartbeat would miss live updates because the heartbeat
	// short-circuits on `compute_visible_folders` — leaving new
	// files the owner added invisible until F5.
	$role_share_rows = array();
	if ( ! empty( $roles ) ) {
		$placeholders = implode( ',', array_fill( 0, count( $roles ), '%s' ) );
		$role_args    = array_merge( array( $user_id, $user_id ), array_map( 'strval', $roles ) );
		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared,WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare
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
		// Non-owner viewer: the shares table is the single source
		// of truth. `share_meta` on the folders row is diagnostic
		// only — it is never consulted for visibility. (Earlier
		// drafts had a fallback that silently re-granted access
		// to revoked recipients; reviewer caught the
		// revocation-bypass and we dropped the fallback before
		// the feature shipped.)
		$cap = desktop_mode_folder_share_user_capability( (int) $folder['id'], (int) $user_id );
		$can = 'none' !== $cap;
	}

	/**
	 * Filter the per-folder visibility decision. Plugins layering
	 * custom share modes (e.g. 'team', 'workspace') can compute
	 * `$can` here.
	 *
	 * @param bool     $can     Default decision.
	 * @param array    $folder  Folder row.
	 * @param int      $user_id Viewer.
	 * @param string[] $roles   Viewer's roles.
	 */
	return (bool) apply_filters( 'desktop_mode_files_user_can_see_folder', $can, $folder, $user_id, $user_roles );
}
