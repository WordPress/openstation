<?php
/**
 * Desktop Mode — Folder shares store.
 *
 * CRUD + ACL resolver for the v8 `_desktop_mode_folder_shares`
 * table. Each row is a single (folder, principal) grant carrying:
 *
 *   - `capability` (`read` | `write`) — what the recipient may do
 *     to the FOLDER ICON (move it, trash it, place icons inside).
 *     This is intentionally orthogonal to capabilities on the
 *     underlying item (sharing a folder that contains a post does
 *     NOT grant edit_posts on that post).
 *
 *   - `state` (`pending` | `accepted` | `denied`) — opt-in marker.
 *     A pending grant is visible to the recipient via the
 *     heartbeat `shares.pending` channel only; the folder itself
 *     does not appear in `compute_visible_folders` until accept.
 *
 * The owner of a folder (folders.owner_id) is the implicit "admin"
 * of its shares: always writes, never visible in the shares table.
 *
 * @package WPDesktopMode
 * @since   0.18.0
 */

defined( 'ABSPATH' ) || exit;

/** Allowed principal-type values. */
function desktop_mode_files_share_principal_types() {
	return array( 'user', 'role' );
}

/**
 * Target types that support sharing. The shares table carries a
 * `target_type` column on every row; this filter declares which
 * values the framework will accept on `desktop_mode_share_invite`
 * + friends.
 *
 * Default ships with `'folder'`. A plugin that wants to add
 * shareable posts (or any other entity) registers their type plus
 * an owner resolver:
 *
 * ```php
 * add_filter( 'desktop_mode_files_shareable_types', function ( $types ) {
 *     $types[] = 'post';
 *     return $types;
 * } );
 * add_filter( 'desktop_mode_files_share_target_owner', function ( $owner_id, $type, $ref ) {
 *     if ( 'post' === $type ) {
 *         return (int) get_post_field( 'post_author', (int) $ref );
 *     }
 *     return $owner_id;
 * }, 10, 3 );
 * ```
 *
 * v1 of the share-settings modal only knows about folders; the
 * REST routes live at `/folders/{id}/shares`. A future modal
 * generalisation (or a per-type opener) can hit the same store
 * functions with a different `$target_type`.
 *
 * @since 0.18.0
 *
 * @return string[]
 */
function desktop_mode_files_shareable_types() {
	/**
	 * Filter the list of target types that support sharing.
	 *
	 * @since 0.18.0
	 *
	 * @param string[] $types Default `[ 'folder' ]`.
	 */
	$types = (array) apply_filters( 'desktop_mode_files_shareable_types', array( 'folder' ) );
	return array_values( array_unique( array_filter( array_map( 'strval', $types ) ) ) );
}

/**
 * Owner of a shareable target. Defaults to the folder owner when
 * `$target_type === 'folder'`. Plugins extending the system to a
 * new type register a filter that returns the correct owner id.
 *
 * @since 0.18.0
 *
 * @param string $target_type Target type slug.
 * @param string $target_id   Target id (stringified — folder ids
 *                            are integers, but custom types may
 *                            use slugs).
 * @return int Owner user id, or 0 if unknown.
 */
function desktop_mode_files_share_target_owner( $target_type, $target_id ) {
	$owner = 0;
	if ( 'folder' === $target_type ) {
		$folder = desktop_mode_files_get_folder( (int) $target_id );
		if ( $folder ) {
			$owner = (int) $folder['owner_id'];
		}
	}
	/**
	 * Filter the owner of a shareable target.
	 *
	 * @since 0.18.0
	 *
	 * @param int    $owner       Default owner. 0 = unknown.
	 * @param string $target_type Target type slug.
	 * @param string $target_id   Target id.
	 */
	return (int) apply_filters( 'desktop_mode_files_share_target_owner', $owner, (string) $target_type, (string) $target_id );
}

/** Allowed capability values. */
function desktop_mode_files_share_capabilities() {
	return array( 'read', 'write' );
}

/** Allowed state values. */
function desktop_mode_files_share_states() {
	return array( 'pending', 'accepted', 'denied' );
}

/**
 * Roles eligible to appear in the share picker. Defaults to every
 * role on the site that carries `edit_posts`. Plugins can override
 * via the `desktop_mode_files_share_eligible_roles` filter — site
 * owners typically use this to whitelist a custom team role.
 *
 * @since 0.18.0
 *
 * @return array<int, array{ slug:string, name:string }>
 */
function desktop_mode_files_share_eligible_roles() {
	$out   = array();
	$roles = wp_roles();
	if ( $roles && is_array( $roles->roles ) ) {
		foreach ( $roles->roles as $slug => $info ) {
			$caps = isset( $info['capabilities'] ) ? (array) $info['capabilities'] : array();
			if ( ! empty( $caps['edit_posts'] ) ) {
				$out[] = array(
					'slug' => (string) $slug,
					'name' => isset( $info['name'] ) ? translate_user_role( (string) $info['name'] ) : (string) $slug,
				);
			}
		}
	}
	/**
	 * Filter the roles eligible to appear in the folder share picker.
	 *
	 * @since 0.18.0
	 *
	 * @param array<int, array{ slug:string, name:string }> $roles Default = roles with `edit_posts`.
	 */
	$out = (array) apply_filters( 'desktop_mode_files_share_eligible_roles', $out );
	return $out;
}

/**
 * Whether `$user_id` may manage the share rules of `$folder_id`.
 * Default: only the folder's owner. Plugins (e.g. a team-admin
 * extension) can broaden this via the filter.
 *
 * @since 0.18.0
 *
 * @param int $folder_id Folder id.
 * @param int $user_id   Viewer.
 * @return bool
 */
function desktop_mode_files_share_can_manage( $folder_id, $user_id ) {
	$folder = desktop_mode_files_get_folder( (int) $folder_id );
	$can    = $folder && (int) $folder['owner_id'] === (int) $user_id;
	/**
	 * Filter who can manage a folder's share rules.
	 *
	 * @since 0.18.0
	 *
	 * @param bool       $can     Default: owner-only.
	 * @param int        $folder_id Folder id.
	 * @param int        $user_id   Viewer.
	 * @param array|null $folder    Normalized folder row (null when missing).
	 */
	return (bool) apply_filters( 'desktop_mode_files_share_can_manage', $can, (int) $folder_id, (int) $user_id, $folder );
}

/**
 * Coerce a raw wpdb shares row to typed values.
 *
 * @since 0.18.0
 * @internal
 *
 * @param array $row Raw wpdb row.
 * @return array
 */
function desktop_mode_files_normalize_share_row( $row ) {
	return array(
		'id'             => (int) $row['id'],
		'folder_id'      => (int) $row['folder_id'],
		'principal_type' => (string) $row['principal_type'],
		'principal_ref'  => (string) $row['principal_ref'],
		'capability'     => (string) $row['capability'],
		'state'          => (string) $row['state'],
		'invited_by'     => (int) $row['invited_by'],
		'invited_at_ms'  => (int) $row['invited_at_ms'],
		'decided_at_ms'  => isset( $row['decided_at_ms'] ) && null !== $row['decided_at_ms']
			? (int) $row['decided_at_ms']
			: null,
	);
}

/**
 * Read a single share row by id.
 *
 * @since 0.18.0
 *
 * @param int $share_id Share id.
 * @return array|null
 */
function desktop_mode_files_get_share( $share_id ) {
	global $wpdb;
	$tables = desktop_mode_files_table_names();
	$row    = $wpdb->get_row(
		$wpdb->prepare( "SELECT * FROM {$tables['shares']} WHERE id = %d", (int) $share_id ),
		ARRAY_A
	);
	if ( ! $row ) {
		return null;
	}
	return desktop_mode_files_normalize_share_row( $row );
}

/**
 * Every share row for a folder. Owner-internal view.
 *
 * @since 0.18.0
 *
 * @param int $folder_id Folder id.
 * @return array[]
 */
function desktop_mode_files_get_folder_shares( $folder_id ) {
	global $wpdb;
	$tables = desktop_mode_files_table_names();
	$rows   = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT * FROM {$tables['shares']} WHERE folder_id = %d ORDER BY invited_at_ms ASC, id ASC",
			(int) $folder_id
		),
		ARRAY_A
	);
	$out = array();
	foreach ( (array) $rows as $row ) {
		$out[] = desktop_mode_files_normalize_share_row( $row );
	}
	return $out;
}

/**
 * Invite a principal to a folder.
 *
 * @since 0.18.0
 *
 * @param int    $folder_id      Folder id.
 * @param int    $actor_id       Actor (must be able to manage the folder).
 * @param string $principal_type 'user' | 'role'.
 * @param string $principal_ref  User id (stringified) or role slug.
 * @param string $capability     'read' | 'write'.
 * @return int|WP_Error Share id on success.
 */
function desktop_mode_folder_share_invite( $folder_id, $actor_id, $principal_type, $principal_ref, $capability = 'read' ) {
	global $wpdb;
	$folder_id      = (int) $folder_id;
	$actor_id       = (int) $actor_id;
	$principal_type = (string) $principal_type;
	$principal_ref  = (string) $principal_ref;
	$capability     = (string) $capability;

	if ( ! in_array( $principal_type, desktop_mode_files_share_principal_types(), true ) ) {
		return new WP_Error( 'desktop_mode_files_invalid_principal_type', __( 'Invalid principal type.', 'desktop-mode' ), array( 'status' => 400 ) );
	}
	if ( ! in_array( $capability, desktop_mode_files_share_capabilities(), true ) ) {
		return new WP_Error( 'desktop_mode_files_invalid_capability', __( 'Invalid capability.', 'desktop-mode' ), array( 'status' => 400 ) );
	}
	if ( ! desktop_mode_files_share_can_manage( $folder_id, $actor_id ) ) {
		return new WP_Error( 'desktop_mode_files_forbidden', __( 'You cannot manage shares for this folder.', 'desktop-mode' ), array( 'status' => 403 ) );
	}

	// Eligibility gate. Users must have `edit_posts`; roles must
	// appear in the eligible-roles list. This is the only place
	// the "exclude low-tier roles" rule is enforced — visibility
	// is computed downstream from accepted rows on this table.
	if ( 'user' === $principal_type ) {
		$uid = (int) $principal_ref;
		if ( $uid <= 0 ) {
			return new WP_Error( 'desktop_mode_files_invalid_user', __( 'Invalid user id.', 'desktop-mode' ), array( 'status' => 400 ) );
		}
		$user = get_userdata( $uid );
		if ( ! $user ) {
			return new WP_Error( 'desktop_mode_files_unknown_user', __( 'Unknown user.', 'desktop-mode' ), array( 'status' => 404 ) );
		}
		$folder    = desktop_mode_files_get_folder( $folder_id );
		$owner_id  = $folder ? (int) $folder['owner_id'] : 0;
		if ( $uid === $owner_id ) {
			return new WP_Error( 'desktop_mode_files_share_owner', __( 'You cannot share with the folder owner.', 'desktop-mode' ), array( 'status' => 400 ) );
		}
		if ( ! user_can( $user, 'edit_posts' ) ) {
			return new WP_Error( 'desktop_mode_files_ineligible_principal', __( 'This user is not eligible.', 'desktop-mode' ), array( 'status' => 400 ) );
		}
		$principal_ref = (string) $uid;
	} else {
		$eligible = wp_list_pluck( desktop_mode_files_share_eligible_roles(), 'slug' );
		if ( ! in_array( $principal_ref, $eligible, true ) ) {
			return new WP_Error( 'desktop_mode_files_ineligible_role', __( 'This role is not eligible.', 'desktop-mode' ), array( 'status' => 400 ) );
		}
	}

	$tables = desktop_mode_files_table_names();
	$now    = desktop_mode_files_now_ms();

	// Idempotent invite: a pre-existing row with state='denied'
	// becomes 'pending' again (owner re-inviting after a no);
	// a pre-existing 'pending' or 'accepted' row keeps its state
	// but may have its capability bumped to the new value.
	$existing = $wpdb->get_row(
		$wpdb->prepare(
			"SELECT * FROM {$tables['shares']}
			WHERE folder_id = %d AND principal_type = %s AND principal_ref = %s",
			$folder_id,
			$principal_type,
			$principal_ref
		),
		ARRAY_A
	);
	if ( $existing ) {
		$id          = (int) $existing['id'];
		$next_state  = 'denied' === $existing['state'] ? 'pending' : $existing['state'];
		$next_cap    = $capability;
		$set         = array(
			'capability'    => $next_cap,
			'state'         => $next_state,
			'invited_by'    => $actor_id,
			'invited_at_ms' => $now,
		);
		$fmt         = array( '%s', '%s', '%d', '%d' );
		if ( 'denied' === $existing['state'] ) {
			$set['decided_at_ms'] = null;
			$fmt[]                = '%s';
		}
		$wpdb->update( $tables['shares'], $set, array( 'id' => $id ), $fmt, array( '%d' ) );
		$row = desktop_mode_files_get_share( $id );
	} else {
		$ok = $wpdb->insert(
			$tables['shares'],
			array(
				'folder_id'      => $folder_id,
				'principal_type' => $principal_type,
				'principal_ref'  => $principal_ref,
				'capability'     => $capability,
				'state'          => 'pending',
				'invited_by'     => $actor_id,
				'invited_at_ms'  => $now,
			),
			array( '%d', '%s', '%s', '%s', '%s', '%d', '%d' )
		);
		if ( false === $ok ) {
			return new WP_Error( 'desktop_mode_files_share_insert_failed', __( 'Failed to record share.', 'desktop-mode' ), array( 'status' => 500 ) );
		}
		$id  = (int) $wpdb->insert_id;
		$row = desktop_mode_files_get_share( $id );
	}

	desktop_mode_files_bump_folder_updated_at( $folder_id );

	/**
	 * Fires after a share is invited (or re-invited).
	 *
	 * @since 0.18.0
	 *
	 * @param int   $share_id Share id.
	 * @param array $row      Share row.
	 * @param int   $actor_id Acting user.
	 */
	do_action( 'desktop_mode_files_share_invited', $id, $row, $actor_id );

	return $id;
}

/**
 * Revoke a share. Owner-side action.
 *
 * @since 0.18.0
 *
 * @param int $share_id Share id.
 * @param int $actor_id Actor.
 * @return true|WP_Error
 */
function desktop_mode_folder_share_revoke( $share_id, $actor_id ) {
	global $wpdb;
	$share_id = (int) $share_id;
	$actor_id = (int) $actor_id;
	$row      = desktop_mode_files_get_share( $share_id );
	if ( ! $row ) {
		return new WP_Error( 'desktop_mode_files_share_not_found', __( 'Share not found.', 'desktop-mode' ), array( 'status' => 404 ) );
	}
	if ( ! desktop_mode_files_share_can_manage( $row['folder_id'], $actor_id ) ) {
		return new WP_Error( 'desktop_mode_files_forbidden', __( 'You cannot manage shares for this folder.', 'desktop-mode' ), array( 'status' => 403 ) );
	}

	$tables = desktop_mode_files_table_names();
	$wpdb->delete( $tables['shares'], array( 'id' => $share_id ), array( '%d' ) );
	// Drop any per-user decision rows attached to this share so
	// they don't leak past the row deletion.
	$wpdb->delete( $tables['decisions'], array( 'share_id' => $share_id ), array( '%d' ) );

	desktop_mode_files_bump_folder_updated_at( $row['folder_id'] );

	// Scrub recipient's local view. For user-principal grants
	// that's the single recipient; for role-principal grants we
	// scrub every user who had a decision row (i.e. interacted
	// with the share). Users in the role who never interacted
	// also lose visibility but have no local placement to trash.
	if ( 'user' === $row['principal_type'] && 'accepted' === $row['state'] ) {
		$uid = (int) $row['principal_ref'];
		if ( $uid > 0 ) {
			desktop_mode_files_trash_folder_for_user( $row['folder_id'], $uid );
		}
	} elseif ( 'role' === $row['principal_type'] ) {
		$decided_users = $wpdb->get_col(
			$wpdb->prepare(
				"SELECT DISTINCT user_id FROM {$tables['decisions']} WHERE share_id = %d",
				$share_id
			)
		);
		foreach ( (array) $decided_users as $uid ) {
			desktop_mode_files_trash_folder_for_user( $row['folder_id'], (int) $uid );
		}
	}

	/**
	 * Fires after a share is revoked.
	 *
	 * @since 0.18.0
	 *
	 * @param int   $share_id Share id.
	 * @param array $row      Share row (last-known state).
	 * @param int   $actor_id Acting user.
	 */
	do_action( 'desktop_mode_files_share_revoked', $share_id, $row, $actor_id );

	return true;
}

/**
 * Update the capability on a share. Owner-side action.
 *
 * @since 0.18.0
 *
 * @param int    $share_id   Share id.
 * @param int    $actor_id   Actor.
 * @param string $capability New capability.
 * @return true|WP_Error
 */
function desktop_mode_folder_share_update_capability( $share_id, $actor_id, $capability ) {
	global $wpdb;
	$share_id   = (int) $share_id;
	$actor_id   = (int) $actor_id;
	$capability = (string) $capability;

	if ( ! in_array( $capability, desktop_mode_files_share_capabilities(), true ) ) {
		return new WP_Error( 'desktop_mode_files_invalid_capability', __( 'Invalid capability.', 'desktop-mode' ), array( 'status' => 400 ) );
	}
	$row = desktop_mode_files_get_share( $share_id );
	if ( ! $row ) {
		return new WP_Error( 'desktop_mode_files_share_not_found', __( 'Share not found.', 'desktop-mode' ), array( 'status' => 404 ) );
	}
	if ( ! desktop_mode_files_share_can_manage( $row['folder_id'], $actor_id ) ) {
		return new WP_Error( 'desktop_mode_files_forbidden', __( 'You cannot manage shares for this folder.', 'desktop-mode' ), array( 'status' => 403 ) );
	}

	$tables = desktop_mode_files_table_names();
	$wpdb->update( $tables['shares'], array( 'capability' => $capability ), array( 'id' => $share_id ), array( '%s' ), array( '%d' ) );

	desktop_mode_files_bump_folder_updated_at( $row['folder_id'] );

	$next = desktop_mode_files_get_share( $share_id );

	/**
	 * Fires after a share's capability is changed.
	 *
	 * @since 0.18.0
	 *
	 * @param int   $share_id Share id.
	 * @param array $next     Row after.
	 * @param array $prev     Row before.
	 * @param int   $actor_id Acting user.
	 */
	do_action( 'desktop_mode_files_share_capability_changed', $share_id, $next, $row, $actor_id );

	return true;
}

/**
 * Read this user's decision row for a share (role-principal only).
 *
 * @since 0.18.0
 * @internal
 *
 * @param int $share_id Share id.
 * @param int $user_id  User.
 * @return array|null Normalized decision row or null.
 */
function desktop_mode_files_get_user_decision( $share_id, $user_id ) {
	global $wpdb;
	$tables = desktop_mode_files_table_names();
	$row    = $wpdb->get_row(
		$wpdb->prepare(
			"SELECT * FROM {$tables['decisions']} WHERE share_id = %d AND user_id = %d",
			(int) $share_id,
			(int) $user_id
		),
		ARRAY_A
	);
	if ( ! $row ) {
		return null;
	}
	return array(
		'id'            => (int) $row['id'],
		'share_id'      => (int) $row['share_id'],
		'user_id'       => (int) $row['user_id'],
		'state'         => (string) $row['state'],
		'decided_at_ms' => (int) $row['decided_at_ms'],
	);
}

/**
 * Upsert a per-user decision (role-principal opt-in state).
 *
 * @since 0.18.0
 * @internal
 *
 * @param int    $share_id Share id.
 * @param int    $user_id  User.
 * @param string $state    'pending' | 'accepted' | 'denied'.
 */
function desktop_mode_files_upsert_user_decision( $share_id, $user_id, $state ) {
	global $wpdb;
	$tables = desktop_mode_files_table_names();
	$now    = desktop_mode_files_now_ms();
	$wpdb->query(
		$wpdb->prepare(
			"INSERT INTO {$tables['decisions']}
			(share_id, user_id, state, decided_at_ms)
			VALUES (%d, %d, %s, %d)
			ON DUPLICATE KEY UPDATE state = VALUES(state), decided_at_ms = VALUES(decided_at_ms)",
			(int) $share_id,
			(int) $user_id,
			(string) $state,
			$now
		)
	);
}

/**
 * Resolve this user's effective state on a share:
 *
 *   - user-principal: state lives on the share row itself.
 *   - role-principal: state lives on the per-user decisions
 *     table. Absence = 'pending' (user hasn't decided yet).
 *
 * @since 0.18.0
 *
 * @param array $share_row Normalized share row.
 * @param int   $user_id   Viewer.
 * @return string 'pending' | 'accepted' | 'denied'
 */
function desktop_mode_files_share_user_state( $share_row, $user_id ) {
	if ( 'user' === $share_row['principal_type'] ) {
		return (string) $share_row['state'];
	}
	if ( 'role' === $share_row['principal_type'] ) {
		$dec = desktop_mode_files_get_user_decision( (int) $share_row['id'], (int) $user_id );
		if ( $dec ) {
			return (string) $dec['state'];
		}
		return 'pending';
	}
	return 'pending';
}

/**
 * Recipient accepts a share. Creates the recipient's placement of
 * the folder at their desktop root.
 *
 * @since 0.18.0
 *
 * @param int $share_id Share id.
 * @param int $user_id  Acting user (must be the share's principal).
 * @return array|WP_Error Share row on success.
 */
function desktop_mode_folder_share_accept( $share_id, $user_id ) {
	global $wpdb;
	$share_id = (int) $share_id;
	$user_id  = (int) $user_id;
	$row      = desktop_mode_files_get_share( $share_id );
	if ( ! $row ) {
		return new WP_Error( 'desktop_mode_files_share_not_found', __( 'Share not found.', 'desktop-mode' ), array( 'status' => 404 ) );
	}
	if ( ! desktop_mode_files_share_principal_matches_user( $row, $user_id ) ) {
		return new WP_Error( 'desktop_mode_files_share_not_recipient', __( 'This invite is not for you.', 'desktop-mode' ), array( 'status' => 403 ) );
	}
	$state = desktop_mode_files_share_user_state( $row, $user_id );
	if ( 'accepted' === $state ) {
		return $row;
	}
	if ( 'denied' === $state && 'user' === $row['principal_type'] ) {
		return new WP_Error( 'desktop_mode_files_share_already_denied', __( 'This invite was denied.', 'desktop-mode' ), array( 'status' => 410 ) );
	}

	$tables = desktop_mode_files_table_names();
	$now    = desktop_mode_files_now_ms();

	if ( 'user' === $row['principal_type'] ) {
		$wpdb->update(
			$tables['shares'],
			array( 'state' => 'accepted', 'decided_at_ms' => $now ),
			array( 'id' => $share_id ),
			array( '%s', '%d' ),
			array( '%d' )
		);
	} else {
		desktop_mode_files_upsert_user_decision( $share_id, $user_id, 'accepted' );
	}

	desktop_mode_files_bump_folder_updated_at( $row['folder_id'] );

	// Place the folder on the recipient's desktop root.
	$parent_id = (int) apply_filters( 'desktop_mode_folder_share_accept_default_parent', 0, $row['folder_id'], $user_id, $row );
	desktop_mode_files_place_at_next_free_slot( $user_id, $parent_id, 'folder', (string) $row['folder_id'] );

	$next = desktop_mode_files_get_share( $share_id );

	/**
	 * Fires after a share is accepted by its recipient.
	 *
	 * @since 0.18.0
	 *
	 * @param int   $share_id Share id.
	 * @param array $row      Updated share row.
	 * @param int   $user_id  Acting user (recipient).
	 */
	do_action( 'desktop_mode_files_share_accepted', $share_id, $next, $user_id );

	return $next;
}

/**
 * Recipient denies a share.
 *
 * @since 0.18.0
 *
 * @param int $share_id Share id.
 * @param int $user_id  Recipient.
 * @return array|WP_Error Share row on success.
 */
function desktop_mode_folder_share_deny( $share_id, $user_id ) {
	global $wpdb;
	$share_id = (int) $share_id;
	$user_id  = (int) $user_id;
	$row      = desktop_mode_files_get_share( $share_id );
	if ( ! $row ) {
		return new WP_Error( 'desktop_mode_files_share_not_found', __( 'Share not found.', 'desktop-mode' ), array( 'status' => 404 ) );
	}
	if ( ! desktop_mode_files_share_principal_matches_user( $row, $user_id ) ) {
		return new WP_Error( 'desktop_mode_files_share_not_recipient', __( 'This invite is not for you.', 'desktop-mode' ), array( 'status' => 403 ) );
	}
	$state = desktop_mode_files_share_user_state( $row, $user_id );
	if ( 'denied' === $state ) {
		return $row;
	}

	$tables = desktop_mode_files_table_names();
	$now    = desktop_mode_files_now_ms();

	if ( 'user' === $row['principal_type'] ) {
		$wpdb->update(
			$tables['shares'],
			array( 'state' => 'denied', 'decided_at_ms' => $now ),
			array( 'id' => $share_id ),
			array( '%s', '%d' ),
			array( '%d' )
		);
	} else {
		// Role-principal: per-user decision keeps other role members untouched.
		desktop_mode_files_upsert_user_decision( $share_id, $user_id, 'denied' );
	}

	desktop_mode_files_bump_folder_updated_at( $row['folder_id'] );

	// If the recipient had previously accepted and is now denying
	// (e.g. they hit deny on a placeholder they already opened),
	// scrub their local placement too. Works for BOTH user- and
	// role-principals since the trash helper is user-scoped.
	if ( 'accepted' === $state ) {
		desktop_mode_files_trash_folder_for_user( $row['folder_id'], $user_id );
	}

	$next = desktop_mode_files_get_share( $share_id );

	/**
	 * Fires after a share is denied.
	 *
	 * @since 0.18.0
	 *
	 * @param int   $share_id Share id.
	 * @param array $row      Updated share row.
	 * @param int   $user_id  Acting user (recipient).
	 */
	do_action( 'desktop_mode_files_share_denied', $share_id, $next, $user_id );

	return $next;
}

/**
 * Recipient-initiated leave. Finds whichever share row grants
 * the user access to `$folder_id` (user-principal or matching
 * role-principal) and marks them as denied, then scrubs their
 * local placements. Idempotent — no-op if the user has no share.
 *
 * @since 0.18.0
 *
 * @param int $folder_id Folder id.
 * @param int $user_id   Recipient leaving.
 * @return true|WP_Error
 */
function desktop_mode_folder_share_leave( $folder_id, $user_id ) {
	global $wpdb;
	$folder_id = (int) $folder_id;
	$user_id   = (int) $user_id;
	if ( $folder_id <= 0 || $user_id <= 0 ) {
		return new WP_Error( 'desktop_mode_files_bad_request', __( 'Invalid arguments.', 'desktop-mode' ), array( 'status' => 400 ) );
	}
	$folder = desktop_mode_files_get_folder( $folder_id );
	if ( ! $folder ) {
		return new WP_Error( 'desktop_mode_files_not_found', __( 'Folder not found.', 'desktop-mode' ), array( 'status' => 404 ) );
	}
	if ( (int) $folder['owner_id'] === $user_id ) {
		return new WP_Error( 'desktop_mode_files_owner_cannot_leave', __( 'Owners cannot leave their own folder.', 'desktop-mode' ), array( 'status' => 400 ) );
	}

	$user  = get_userdata( $user_id );
	$roles = $user ? (array) $user->roles : array();

	$tables = desktop_mode_files_table_names();
	$rows   = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT * FROM {$tables['shares']} WHERE folder_id = %d",
			$folder_id
		),
		ARRAY_A
	);
	$touched = 0;
	foreach ( (array) $rows as $raw ) {
		$row = desktop_mode_files_normalize_share_row( $raw );
		if ( ! desktop_mode_files_share_principal_matches_user( $row, $user_id ) ) {
			continue;
		}
		if ( 'user' === $row['principal_type'] ) {
			$wpdb->update(
				$tables['shares'],
				array( 'state' => 'denied', 'decided_at_ms' => desktop_mode_files_now_ms() ),
				array( 'id' => $row['id'] ),
				array( '%s', '%d' ),
				array( '%d' )
			);
		} else {
			desktop_mode_files_upsert_user_decision( $row['id'], $user_id, 'denied' );
		}
		$touched++;
		/**
		 * Fires after a recipient leaves a shared folder. Distinct
		 * from `_denied` (owner-side audit) because this is always
		 * recipient-initiated, after acceptance.
		 *
		 * @since 0.18.0
		 *
		 * @param int   $share_id Share id.
		 * @param array $row      Share row (last-known).
		 * @param int   $user_id  Recipient leaving.
		 */
		do_action( 'desktop_mode_files_share_left', $row['id'], $row, $user_id );
	}

	// Scrub the recipient's view regardless of whether a share row
	// matched (the user might have a placement from a previously
	// revoked share that lingered).
	desktop_mode_files_trash_folder_for_user( $folder_id, $user_id );
	desktop_mode_files_bump_folder_updated_at( $folder_id );

	if ( 0 === $touched ) {
		return new WP_Error( 'desktop_mode_files_not_member', __( 'You do not have access to this folder.', 'desktop-mode' ), array( 'status' => 404 ) );
	}
	return true;
}

/**
 * Does `$share_row` target `$user_id` (directly or by role)?
 *
 * @since 0.18.0
 * @internal
 *
 * @param array $share_row Normalized share row.
 * @param int   $user_id   User to test.
 * @return bool
 */
function desktop_mode_files_share_principal_matches_user( $share_row, $user_id ) {
	$user_id = (int) $user_id;
	if ( $user_id <= 0 ) {
		return false;
	}
	if ( 'user' === $share_row['principal_type'] ) {
		return (int) $share_row['principal_ref'] === $user_id;
	}
	if ( 'role' === $share_row['principal_type'] ) {
		$user = get_userdata( $user_id );
		if ( ! $user ) {
			return false;
		}
		return in_array( (string) $share_row['principal_ref'], (array) $user->roles, true );
	}
	return false;
}

/**
 * Capability `$user_id` holds on `$folder_id`. `write` beats `read`
 * beats `none`. Owner always returns `'write'`. `share_mode='all'`
 * yields a default of `'read'` (filterable).
 *
 * @since 0.18.0
 *
 * @param int $folder_id Folder id.
 * @param int $user_id   Viewer.
 * @return string 'none' | 'read' | 'write'
 */
function desktop_mode_folder_share_user_capability( $folder_id, $user_id ) {
	$folder_id = (int) $folder_id;
	$user_id   = (int) $user_id;
	if ( $folder_id <= 0 || $user_id <= 0 ) {
		return 'none';
	}

	$folder = desktop_mode_files_get_folder( $folder_id );
	if ( ! $folder ) {
		return 'none';
	}
	if ( (int) $folder['owner_id'] === $user_id ) {
		return 'write';
	}

	// Cascade — walk the folder's ancestor chain. A folder nested
	// inside a shared folder inherits the share. The most permissive
	// ancestor cap wins. Bail out as soon as we hit 'write'.
	$cascade_cap = desktop_mode_folder_share_user_capability_cascade( $folder_id, $user_id );
	if ( 'write' === $cascade_cap ) {
		return 'write';
	}

	$cap = 'none';
	if ( 'all' === $folder['share_mode'] ) {
		/**
		 * Filter the default capability for `share_mode='all'`.
		 *
		 * @since 0.18.0
		 *
		 * @param string $cap     Default 'read'.
		 * @param int    $folder_id Folder id.
		 * @param int    $user_id   Viewer.
		 */
		$cap = (string) apply_filters( 'desktop_mode_files_share_all_default_capability', 'read', $folder_id, $user_id );
	}

	$user_roles = array();
	$user       = get_userdata( $user_id );
	if ( $user ) {
		$user_roles = (array) $user->roles;
	}

	global $wpdb;
	$tables = desktop_mode_files_table_names();
	// User-principal grants — state lives on the shares row.
	$rows = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT id, principal_type, principal_ref, capability FROM {$tables['shares']}
			WHERE folder_id = %d AND principal_type = 'user' AND state = 'accepted'",
			$folder_id
		),
		ARRAY_A
	);
	// Role-principal grants — opt-in is per-user via the decisions
	// table. We join so a role member only gets a hit if they've
	// individually accepted (no "first to click decides for all").
	$role_rows = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT s.id, s.principal_type, s.principal_ref, s.capability
			FROM {$tables['shares']} s
			INNER JOIN {$tables['decisions']} d ON d.share_id = s.id AND d.user_id = %d AND d.state = 'accepted'
			WHERE s.folder_id = %d AND s.principal_type = 'role'",
			$user_id,
			$folder_id
		),
		ARRAY_A
	);
	$rows = array_merge( (array) $rows, (array) $role_rows );
	foreach ( $rows as $row ) {
		$matches = false;
		if ( 'user' === $row['principal_type'] && (int) $row['principal_ref'] === $user_id ) {
			$matches = true;
		} elseif ( 'role' === $row['principal_type'] && in_array( (string) $row['principal_ref'], $user_roles, true ) ) {
			$matches = true;
		}
		if ( $matches ) {
			$row_cap = (string) $row['capability'];
			if ( 'write' === $row_cap ) {
				$cap = 'write';
				break; // Most permissive wins; can't beat 'write'.
			}
			if ( 'read' === $row_cap && 'none' === $cap ) {
				$cap = 'read';
			}
		}
	}

	// Fold the cascaded ancestor cap into the result if it beats
	// what direct shares granted. (`cascade_cap` was computed above
	// before the early-write-bail — we already know it's not 'write'
	// at this point, otherwise we returned earlier.)
	if ( 'read' === $cascade_cap && 'none' === $cap ) {
		$cap = 'read';
	}

	/**
	 * Filter the resolved capability.
	 *
	 * @since 0.18.0
	 *
	 * @param string $cap     'none' | 'read' | 'write'.
	 * @param int    $folder_id Folder id.
	 * @param int    $user_id   Viewer.
	 * @param array  $folder    Normalized folder row.
	 */
	return (string) apply_filters( 'desktop_mode_folder_share_user_capability', $cap, $folder_id, $user_id, $folder );
}

/**
 * Walk the ancestor chain of `$folder_id` and return the most
 * permissive DIRECT share cap any ancestor has for `$user_id`.
 * Used by `desktop_mode_folder_share_user_capability` to cascade
 * a share grant from a parent folder into every folder nested
 * inside it.
 *
 * "Direct" means the share row exists for that ancestor — we
 * don't recurse the cascade resolver to avoid infinite loops
 * and quadratic complexity.
 *
 * @since 0.18.0
 *
 * @param int $folder_id Folder whose ancestors to walk.
 * @param int $user_id   Viewer.
 * @return string 'none' | 'read' | 'write'
 */
function desktop_mode_folder_share_user_capability_cascade( $folder_id, $user_id ) {
	$ancestors = desktop_mode_folder_ancestors( (int) $folder_id );
	if ( empty( $ancestors ) ) {
		return 'none';
	}
	$cap = 'none';
	foreach ( $ancestors as $ancestor_id ) {
		$ancestor_cap = desktop_mode_folder_share_user_capability_direct( $ancestor_id, (int) $user_id );
		if ( 'write' === $ancestor_cap ) {
			return 'write';
		}
		if ( 'read' === $ancestor_cap && 'none' === $cap ) {
			$cap = 'read';
		}
	}
	return $cap;
}

/**
 * Direct (non-cascading) capability resolver. Same logic as
 * `desktop_mode_folder_share_user_capability` minus the cascade
 * walk — owner / share rows / role decisions only.
 *
 * Cascade callers use this to query a single ancestor without
 * triggering another cascade walk underneath.
 *
 * @since 0.18.0
 * @internal
 */
function desktop_mode_folder_share_user_capability_direct( $folder_id, $user_id ) {
	$folder_id = (int) $folder_id;
	$user_id   = (int) $user_id;
	if ( $folder_id <= 0 || $user_id <= 0 ) {
		return 'none';
	}
	$folder = desktop_mode_files_get_folder( $folder_id );
	if ( ! $folder ) {
		return 'none';
	}
	if ( (int) $folder['owner_id'] === $user_id ) {
		return 'write';
	}
	$cap = 'none';
	if ( 'all' === $folder['share_mode'] ) {
		$cap = (string) apply_filters( 'desktop_mode_files_share_all_default_capability', 'read', $folder_id, $user_id );
	}

	$user_roles = array();
	$user       = get_userdata( $user_id );
	if ( $user ) {
		$user_roles = (array) $user->roles;
	}

	global $wpdb;
	$tables = desktop_mode_files_table_names();
	$rows   = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT id, principal_type, principal_ref, capability FROM {$tables['shares']}
			WHERE folder_id = %d AND principal_type = 'user' AND state = 'accepted'",
			$folder_id
		),
		ARRAY_A
	);
	$role_rows = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT s.id, s.principal_type, s.principal_ref, s.capability
			FROM {$tables['shares']} s
			INNER JOIN {$tables['decisions']} d ON d.share_id = s.id AND d.user_id = %d AND d.state = 'accepted'
			WHERE s.folder_id = %d AND s.principal_type = 'role'",
			$user_id,
			$folder_id
		),
		ARRAY_A
	);
	foreach ( array_merge( (array) $rows, (array) $role_rows ) as $row ) {
		$matches = false;
		if ( 'user' === $row['principal_type'] && (int) $row['principal_ref'] === $user_id ) {
			$matches = true;
		} elseif ( 'role' === $row['principal_type'] && in_array( (string) $row['principal_ref'], $user_roles, true ) ) {
			$matches = true;
		}
		if ( $matches ) {
			$row_cap = (string) $row['capability'];
			if ( 'write' === $row_cap ) {
				return 'write';
			}
			if ( 'read' === $row_cap && 'none' === $cap ) {
				$cap = 'read';
			}
		}
	}
	return $cap;
}

/**
 * Return the chain of ancestor folder ids above `$folder_id`,
 * walking the owner's canonical placement. The first element is
 * the immediate parent; the last is the root-most ancestor.
 *
 * Why owner's placement: a folder can be placed in multiple
 * locations (one per user), so "parent" is ambiguous. The owner's
 * placement is the canonical one (the owner decides the tree).
 *
 * Hard-capped at 16 levels deep + a visited set to make pathological
 * inputs (cycles, deep nests) bounded.
 *
 * @since 0.18.0
 *
 * @param int $folder_id Folder whose ancestors to walk.
 * @param int $limit     Max ancestor count (default 16).
 * @return int[]
 */
function desktop_mode_folder_ancestors( $folder_id, $limit = 16 ) {
	global $wpdb;
	$folder_id = (int) $folder_id;
	if ( $folder_id <= 0 ) {
		return array();
	}
	$tables    = desktop_mode_files_table_names();
	$ancestors = array();
	$current   = $folder_id;
	$visited   = array();
	$depth     = 0;
	while ( $depth < $limit ) {
		if ( isset( $visited[ $current ] ) ) {
			break;
		}
		$visited[ $current ] = true;
		$folder = desktop_mode_files_get_folder( $current );
		if ( ! $folder ) {
			break;
		}
		$owner = (int) $folder['owner_id'];
		$row   = $wpdb->get_row(
			$wpdb->prepare(
				"SELECT parent_id FROM {$tables['placements']}
				WHERE user_id = %d
					AND file_type = 'folder'
					AND file_ref = %s
					AND trashed_at_ms IS NULL
				ORDER BY id ASC
				LIMIT 1",
				$owner,
				(string) $current
			),
			ARRAY_A
		);
		if ( ! $row ) {
			break;
		}
		$parent_id = (int) $row['parent_id'];
		if ( $parent_id <= 0 ) {
			break;
		}
		$ancestors[] = $parent_id;
		$current     = $parent_id;
		$depth++;
	}
	return $ancestors;
}

/**
 * Pending invites for `$user_id` across every folder. Used by the
 * heartbeat `shares.pending` payload.
 *
 * @since 0.18.0
 *
 * @param int $user_id Viewer.
 * @param int $since_ms Optional. Only include rows with `invited_at_ms > since`.
 * @return array[]
 */
function desktop_mode_files_get_pending_shares_for_user( $user_id, $since_ms = 0 ) {
	global $wpdb;
	$user_id  = (int) $user_id;
	$since_ms = (int) $since_ms;
	if ( $user_id <= 0 ) {
		return array();
	}
	$user = get_userdata( $user_id );
	if ( ! $user ) {
		return array();
	}
	$roles = (array) $user->roles;

	$tables = desktop_mode_files_table_names();

	// User-principal: state lives on the share row. Surface where
	// state='pending' AND principal_ref matches the user.
	$user_pending = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT s.* FROM {$tables['shares']} s
			INNER JOIN {$tables['folders']} f ON f.id = s.folder_id AND f.trashed_at_ms IS NULL
			WHERE s.state = 'pending'
				AND s.invited_at_ms > %d
				AND s.principal_type = 'user'
				AND s.principal_ref = %s
			ORDER BY s.invited_at_ms ASC, s.id ASC",
			$since_ms,
			(string) $user_id
		),
		ARRAY_A
	);

	// Role-principal: surface every role-share the user matches
	// where they have NO decision row yet OR their decision is
	// 'pending'. Denied/accepted decisions suppress the prompt.
	$role_pending = array();
	if ( ! empty( $roles ) ) {
		$placeholders = implode( ',', array_fill( 0, count( $roles ), '%s' ) );
		$prepare      = array_merge( array( $user_id, $since_ms ), $roles );
		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		$role_pending = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT s.* FROM {$tables['shares']} s
				INNER JOIN {$tables['folders']} f ON f.id = s.folder_id AND f.trashed_at_ms IS NULL
				LEFT JOIN {$tables['decisions']} d ON d.share_id = s.id AND d.user_id = %d
				WHERE s.invited_at_ms > %d
					AND s.principal_type = 'role'
					AND s.principal_ref IN ($placeholders)
					AND ( d.state IS NULL OR d.state = 'pending' )
				ORDER BY s.invited_at_ms ASC, s.id ASC",
				$prepare
			),
			ARRAY_A
		);
	}

	$out = array();
	foreach ( array_merge( (array) $user_pending, (array) $role_pending ) as $row ) {
		$out[] = desktop_mode_files_normalize_share_row( $row );
	}
	return $out;
}

/**
 * Bump a folder's `updated_at_ms`. Internal helper — every share
 * mutation should bump the parent folder so heartbeat clients pick
 * up the change in the same delta window.
 *
 * @since 0.18.0
 * @internal
 *
 * @param int $folder_id Folder id.
 */
function desktop_mode_files_bump_folder_updated_at( $folder_id ) {
	global $wpdb;
	$tables = desktop_mode_files_table_names();
	$wpdb->update(
		$tables['folders'],
		array( 'updated_at_ms' => desktop_mode_files_now_ms() ),
		array( 'id' => (int) $folder_id ),
		array( '%d' ),
		array( '%d' )
	);
}

/**
 * Recipient-scoped trash. Removes the recipient's placement of the
 * folder + their placements INSIDE the folder. Does NOT cascade
 * into the shared icon namespace (other users' placements survive).
 *
 * @since 0.18.0
 *
 * @param int $folder_id Folder id.
 * @param int $user_id   Recipient.
 * @return int Number of placement rows trashed.
 */
function desktop_mode_files_trash_folder_for_user( $folder_id, $user_id ) {
	global $wpdb;
	$folder_id = (int) $folder_id;
	$user_id   = (int) $user_id;
	if ( $folder_id <= 0 || $user_id <= 0 ) {
		return 0;
	}
	$tables = desktop_mode_files_table_names();
	$now    = desktop_mode_files_now_ms();

	// The recipient's folder-shortcut placement (parent_id=0,
	// file_type='folder', file_ref=$folder_id) + every placement
	// they own INSIDE this folder (parent_id=$folder_id).
	$rows = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT id FROM {$tables['placements']}
			WHERE user_id = %d
				AND trashed_at_ms IS NULL
				AND (
					( file_type = 'folder' AND file_ref = %s AND parent_id = 0 )
					OR parent_id = %d
				)",
			$user_id,
			(string) $folder_id,
			$folder_id
		),
		ARRAY_A
	);
	$count = 0;
	foreach ( (array) $rows as $row ) {
		$pid = (int) $row['id'];
		$wpdb->update(
			$tables['placements'],
			array(
				'trashed_at_ms' => $now,
				'trashed_by'    => $user_id,
			),
			array( 'id' => $pid ),
			array( '%d', '%d' ),
			array( '%d' )
		);
		// Soft-trash only — DO NOT write a tombstone here.
		// Tombstones represent permanent removal (hard delete); the
		// heartbeat already surfaces soft-trashed rows via the
		// `trashed_at_ms IS NOT NULL` query in
		// `desktop_mode_files_compute_heartbeat_delta`. Writing a
		// tombstone on every soft-trash conflates the two states and,
		// when the row is later restored (e.g. the recipient re-
		// accepts the same share), the lingering tombstone keeps
		// telling clients "this is gone" while the same placement
		// row is also being upserted as alive — causing the row to
		// disappear from the desktop on every heartbeat tick. See
		// the user-reported "shared folder vanishes after refresh"
		// bug fixed in 0.18.x.
		$count++;
	}
	return $count;
}

/**
 * Hook into the trash gate so a read-only recipient cannot trash
 * placements they "own" inside a shared folder. The ownership
 * check at the placement level passes (each user has their own
 * placement row), so the gate needs an extra read-only veto.
 *
 * @since 0.18.0
 *
 * @param bool  $can     Default decision (ownership match).
 * @param int   $user_id Acting user.
 * @param array $row     Placement row.
 * @return bool
 */
function desktop_mode_files_share_gate_trash( $can, $user_id, $row ) {
	$parent_id = isset( $row['parent_id'] ) ? (int) $row['parent_id'] : 0;
	if ( $parent_id <= 0 ) {
		// Root placement — default ownership rule stands.
		return $can;
	}
	$folder = desktop_mode_files_get_folder( $parent_id );
	if ( ! $folder ) {
		return $can;
	}
	$user_id  = (int) $user_id;
	$is_owner = (int) $folder['owner_id'] === $user_id;
	$cap      = desktop_mode_folder_share_user_capability( $parent_id, $user_id );

	// Folder owner can always trash anything inside their folder.
	if ( $is_owner ) {
		return true;
	}
	// Non-owner: require write cap on the folder, regardless of
	// who originally placed the row. This is the upgrade path —
	// writers can trash any icon in the shared folder. Readers
	// can't trash anything (even their own placement in this folder).
	return 'write' === $cap;
}
add_filter( 'desktop_mode_files_user_can_trash_placement', 'desktop_mode_files_share_gate_trash', 10, 3 );

/**
 * Inject share-related state into the shell config so the share
 * settings modal + role picker have what they need without
 * round-tripping.
 *
 * @since 0.18.0
 *
 * @param array $config Shell config.
 * @return array
 */
function desktop_mode_files_share_inject_shell_config( $config ) {
	if ( ! is_array( $config ) ) {
		$config = array();
	}
	$config['shareEligibleRoles']  = desktop_mode_files_share_eligible_roles();
	$config['filesUsersSearchUrl'] = esc_url_raw( rest_url( 'desktop-mode/v1/files/users/search' ) );
	$config['folderSharesUrl']     = esc_url_raw( rest_url( 'desktop-mode/v1/files/folders' ) );
	if ( ! isset( $config['currentUserId'] ) ) {
		$config['currentUserId'] = (int) get_current_user_id();
	}
	return $config;
}
add_filter( 'desktop_mode_shell_config', 'desktop_mode_files_share_inject_shell_config', 20 );

/**
 * Place an icon at the next free row-major slot in a user's view
 * of `$parent_id`. Internal helper used by share-accept and
 * fan-out. Mirrors the grid math in `src/desktop-files/grid.ts`
 * (padding 16 + col 96 + row 110).
 *
 * @since 0.18.0
 *
 * @param int    $user_id   Viewer.
 * @param int    $parent_id Folder id (0 = desktop root).
 * @param string $type      File-type slug.
 * @param string $ref       Entity reference.
 * @return int|WP_Error Placement id or error.
 */
function desktop_mode_files_place_at_next_free_slot( $user_id, $parent_id, $type, $ref ) {
	global $wpdb;
	$user_id   = (int) $user_id;
	$parent_id = max( 0, (int) $parent_id );

	$tables   = desktop_mode_files_table_names();
	$existing = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT x, y FROM {$tables['placements']}
			WHERE user_id = %d
				AND parent_id = %d
				AND trashed_at_ms IS NULL",
			$user_id,
			$parent_id
		),
		ARRAY_A
	);
	$occupied = array();
	foreach ( (array) $existing as $row ) {
		$col = max( 0, (int) round( ( (int) $row['x'] - 16 ) / 96 ) );
		$r   = max( 0, (int) round( ( (int) $row['y'] - 16 ) / 110 ) );
		$occupied[ "$col,$r" ] = true;
	}

	$pick_col = 0;
	$pick_row = 0;
	for ( $r = 0; $r < 999; $r++ ) {
		for ( $col = 0; $col < 999; $col++ ) {
			if ( ! isset( $occupied[ "$col,$r" ] ) ) {
				$pick_col = $col;
				$pick_row = $r;
				break 2;
			}
		}
	}

	return desktop_mode_files_place(
		$user_id,
		$parent_id,
		$type,
		$ref,
		array(
			'x' => 16 + $pick_col * 96,
			'y' => 16 + $pick_row * 110,
		)
	);
}
