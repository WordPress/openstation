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

	// Pull every folder NOT owned by the viewer with a non-
	// private share mode. Then evaluate ACL in PHP — the JSON
	// `share_meta` makes a SQL filter awkward and the row count
	// is bounded by total folder rows, which is small.
	$candidates = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT * FROM {$tables['folders']} WHERE owner_id <> %d AND share_mode <> 'private'",
			$user_id
		),
		ARRAY_A
	);
	if ( ! is_array( $candidates ) ) {
		return is_array( $owned ) ? $owned : array();
	}

	$user        = get_userdata( $user_id );
	$user_roles  = $user ? array_values( (array) $user->roles ) : array();
	$known_modes = desktop_mode_files_share_modes();

	$visible = is_array( $owned ) ? $owned : array();
	foreach ( $candidates as $row ) {
		$row  = desktop_mode_files_normalize_folder_row( $row );
		$mode = (string) $row['share_mode'];
		if ( ! in_array( $mode, $known_modes, true ) ) {
			continue;
		}
		if ( desktop_mode_files_user_can_see_folder( $row, $user_id, $user_roles ) ) {
			$visible[] = $row;
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
	$meta = is_array( $folder['share_meta'] ) ? $folder['share_meta'] : array();

	switch ( $mode ) {
		case 'all':
			$can = true;
			break;
		case 'users':
			$users = isset( $meta['users'] ) && is_array( $meta['users'] )
				? array_map( 'intval', $meta['users'] )
				: array();
			$can   = in_array( (int) $user_id, $users, true );
			break;
		case 'roles':
			$roles = isset( $meta['roles'] ) && is_array( $meta['roles'] )
				? array_map( 'strval', $meta['roles'] )
				: array();
			$can   = (bool) array_intersect( $roles, (array) $user_roles );
			break;
		default:
			// Private / unknown — owner-only is already in the
			// pre-filter list.
			$can = false;
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
