<?php
/**
 * OpenStation — single-file sharing (`target_type='file'`).
 *
 * Shares one stored upload with specific users. Reuses the folder-
 * sharing tables via the `target_type` column the schema shipped
 * for exactly this (the `folder_id` column carries the STORED-FILE
 * id on these rows — historical column name).
 *
 * Deliberate divergences from folder sharing:
 *
 *   - **Read tier only.** The capability is hard-forced to `read`
 *     — recipients get view + download, never move/rename/delete
 *     (DESKMOD-45's owner-locked model; the write tier does not
 *     exist for files).
 *   - **User principals only (v1).** No role invites.
 *
 * Lifecycle mirrors folders: invite (pending) → heartbeat delivers
 * → accept (placement planted at the recipient's desktop root) /
 * deny / leave / revoke, every removal scrubbing the recipient's
 * placement.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Whether `$user_id` may manage a stored file's shares. Owner-only
 * by default, filterable like the folder equivalent.
 *
 * @param int $file_id Stored-file id.
 * @param int $user_id Viewer.
 * @return bool
 */
function open_station_stored_files_share_can_manage( $file_id, $user_id ) {
	$file = open_station_stored_files_get( (int) $file_id );
	$can  = $file && (int) $file['owner_id'] === (int) $user_id;
	/**
	 * Filter who can manage a stored file's shares.
	 *
	 * @param bool       $can     Default: owner-only.
	 * @param int        $file_id Stored-file id.
	 * @param int        $user_id Viewer.
	 * @param array|null $file    Stored-file row (null when missing).
	 */
	return (bool) apply_filters( 'open_station_stored_files_share_can_manage', $can, (int) $file_id, (int) $user_id, $file );
}

/**
 * All share rows for one stored file (owner-internal view).
 *
 * @param int $file_id Stored-file id.
 * @return array[]
 */
function open_station_stored_files_get_file_shares( $file_id ) {
	global $wpdb;
	$tables = open_station_files_table_names();
	$rows   = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT * FROM {$tables['shares']} WHERE target_type = 'file' AND folder_id = %d ORDER BY invited_at_ms ASC, id ASC",
			(int) $file_id
		),
		ARRAY_A
	);
	$out = array();
	foreach ( (array) $rows as $row ) {
		$out[] = open_station_files_normalize_share_row( $row );
	}
	return $out;
}

/**
 * The viewer's state on a stored file: 'none' when no share row
 * targets them, else the row's state.
 *
 * @param int $file_id Stored-file id.
 * @param int $user_id Viewer.
 * @return string 'none' | 'pending' | 'accepted' | 'denied'
 */
function open_station_stored_file_share_state( $file_id, $user_id ) {
	global $wpdb;
	$tables = open_station_files_table_names();
	$state  = $wpdb->get_var(
		$wpdb->prepare(
			"SELECT state FROM {$tables['shares']}
			WHERE target_type = 'file' AND folder_id = %d
				AND principal_type = 'user' AND principal_ref = %s",
			(int) $file_id,
			(string) (int) $user_id
		)
	);
	return null === $state ? 'none' : (string) $state;
}

/**
 * Invite a user to a stored file. Capability is always `read`.
 *
 * @param int $file_id           Stored-file id.
 * @param int $actor_id          Actor (must manage the file's shares).
 * @param int $recipient_user_id Recipient.
 * @return int|WP_Error Share id.
 */
function open_station_stored_file_share_invite( $file_id, $actor_id, $recipient_user_id ) {
	global $wpdb;
	$file_id  = (int) $file_id;
	$actor_id = (int) $actor_id;
	$uid      = (int) $recipient_user_id;

	$file = open_station_stored_files_get( $file_id );
	if ( ! $file ) {
		return new WP_Error( 'open_station_stored_files_not_found', __( 'Stored file not found.', 'desktop-mode' ), array( 'status' => 404 ) );
	}
	if ( ! open_station_stored_files_share_can_manage( $file_id, $actor_id ) ) {
		return new WP_Error( 'open_station_files_forbidden', __( 'You cannot manage shares for this file.', 'desktop-mode' ), array( 'status' => 403 ) );
	}
	if ( $uid <= 0 ) {
		return new WP_Error( 'open_station_files_invalid_user', __( 'Invalid user id.', 'desktop-mode' ), array( 'status' => 400 ) );
	}
	if ( $uid === (int) $file['owner_id'] ) {
		return new WP_Error( 'open_station_files_share_owner', __( 'You cannot share with the file owner.', 'desktop-mode' ), array( 'status' => 400 ) );
	}
	$user = get_userdata( $uid );
	if ( ! $user ) {
		return new WP_Error( 'open_station_files_unknown_user', __( 'Unknown user.', 'desktop-mode' ), array( 'status' => 404 ) );
	}
	if ( ! user_can( $user, 'edit_posts' ) ) {
		return new WP_Error( 'open_station_files_ineligible_principal', __( 'This user is not eligible.', 'desktop-mode' ), array( 'status' => 400 ) );
	}

	$tables = open_station_files_table_names();
	$now    = open_station_files_now_ms();

	// Idempotent invite, mirroring the folder rules: denied →
	// pending again; pending/accepted keep their state. Capability
	// stays 'read' unconditionally.
	$existing = $wpdb->get_row(
		$wpdb->prepare(
			"SELECT * FROM {$tables['shares']}
			WHERE target_type = 'file' AND folder_id = %d
				AND principal_type = 'user' AND principal_ref = %s",
			$file_id,
			(string) $uid
		),
		ARRAY_A
	);
	if ( $existing ) {
		$id         = (int) $existing['id'];
		$next_state = 'denied' === $existing['state'] ? 'pending' : $existing['state'];
		$set        = array(
			'capability'    => 'read',
			'state'         => $next_state,
			'invited_by'    => $actor_id,
			'invited_at_ms' => $now,
		);
		$fmt        = array( '%s', '%s', '%d', '%d' );
		if ( 'denied' === $existing['state'] ) {
			$set['decided_at_ms'] = null;
			$fmt[]                = '%s';
		}
		$wpdb->update( $tables['shares'], $set, array( 'id' => $id ), $fmt, array( '%d' ) );
	} else {
		$ok = $wpdb->insert(
			$tables['shares'],
			array(
				'target_type'    => 'file',
				'folder_id'      => $file_id,
				'principal_type' => 'user',
				'principal_ref'  => (string) $uid,
				'capability'     => 'read',
				'state'          => 'pending',
				'invited_by'     => $actor_id,
				'invited_at_ms'  => $now,
			),
			array( '%s', '%d', '%s', '%s', '%s', '%s', '%d', '%d' )
		);
		if ( false === $ok ) {
			return new WP_Error( 'open_station_files_share_insert_failed', __( 'Failed to record share.', 'desktop-mode' ), array( 'status' => 500 ) );
		}
		$id = (int) $wpdb->insert_id;
	}

	$row = open_station_files_get_share( $id );

	/** This action is documented in includes/desktop-files/shares-store.php */
	do_action( 'open_station_files_share_invited', $id, $row, $actor_id );

	return $id;
}

/**
 * Recipient accepts a file share. Plants an `upload` placement at
 * their desktop root.
 *
 * @param int $share_id Share id.
 * @param int $user_id  Recipient.
 * @return array|WP_Error Updated share row.
 */
function open_station_stored_file_share_accept( $share_id, $user_id ) {
	global $wpdb;
	$share_id = (int) $share_id;
	$user_id  = (int) $user_id;
	$row      = open_station_files_get_share( $share_id );
	if ( ! $row || 'file' !== $row['target_type'] ) {
		return new WP_Error( 'open_station_files_share_not_found', __( 'Share not found.', 'desktop-mode' ), array( 'status' => 404 ) );
	}
	if ( 'user' !== $row['principal_type'] || (int) $row['principal_ref'] !== $user_id ) {
		return new WP_Error( 'open_station_files_share_not_recipient', __( 'This invite is not for you.', 'desktop-mode' ), array( 'status' => 403 ) );
	}
	if ( 'accepted' === $row['state'] ) {
		return $row;
	}
	if ( 'denied' === $row['state'] ) {
		return new WP_Error( 'open_station_files_share_already_denied', __( 'This invite was denied.', 'desktop-mode' ), array( 'status' => 410 ) );
	}

	$tables = open_station_files_table_names();
	$wpdb->update(
		$tables['shares'],
		array(
			'state'         => 'accepted',
			'decided_at_ms' => open_station_files_now_ms(),
		),
		array( 'id' => $share_id ),
		array( '%s', '%d' ),
		array( '%d' )
	);

	// Plant the tile — AFTER the state flip so the placement's
	// `can_read` gate sees the accepted share.
	$file_id = (int) $row['folder_id'];
	/** This filter is documented in includes/desktop-files/shares-store.php */
	$parent_id = (int) apply_filters( 'open_station_folder_share_accept_default_parent', 0, $file_id, $user_id, $row );
	open_station_files_place_at_next_free_slot( $user_id, $parent_id, 'upload', (string) $file_id );

	$next = open_station_files_get_share( $share_id );

	/** This action is documented in includes/desktop-files/shares-store.php */
	do_action( 'open_station_files_share_accepted', $share_id, $next, $user_id );

	return $next;
}

/**
 * Recipient denies a file share.
 *
 * @param int $share_id Share id.
 * @param int $user_id  Recipient.
 * @return array|WP_Error Updated share row.
 */
function open_station_stored_file_share_deny( $share_id, $user_id ) {
	global $wpdb;
	$share_id = (int) $share_id;
	$user_id  = (int) $user_id;
	$row      = open_station_files_get_share( $share_id );
	if ( ! $row || 'file' !== $row['target_type'] ) {
		return new WP_Error( 'open_station_files_share_not_found', __( 'Share not found.', 'desktop-mode' ), array( 'status' => 404 ) );
	}
	if ( 'user' !== $row['principal_type'] || (int) $row['principal_ref'] !== $user_id ) {
		return new WP_Error( 'open_station_files_share_not_recipient', __( 'This invite is not for you.', 'desktop-mode' ), array( 'status' => 403 ) );
	}
	if ( 'denied' === $row['state'] ) {
		return $row;
	}
	$was_accepted = 'accepted' === $row['state'];

	$tables = open_station_files_table_names();
	$wpdb->update(
		$tables['shares'],
		array(
			'state'         => 'denied',
			'decided_at_ms' => open_station_files_now_ms(),
		),
		array( 'id' => $share_id ),
		array( '%s', '%d' ),
		array( '%d' )
	);
	if ( $was_accepted ) {
		open_station_files_trash_upload_for_user( (int) $row['folder_id'], $user_id );
	}

	$next = open_station_files_get_share( $share_id );

	/** This action is documented in includes/desktop-files/shares-store.php */
	do_action( 'open_station_files_share_denied', $share_id, $next, $user_id );

	return $next;
}

/**
 * Recipient leaves a previously accepted file share.
 *
 * @param int $file_id Stored-file id.
 * @param int $user_id Recipient.
 * @return true|WP_Error
 */
function open_station_stored_file_share_leave( $file_id, $user_id ) {
	global $wpdb;
	$file_id = (int) $file_id;
	$user_id = (int) $user_id;
	$file    = open_station_stored_files_get( $file_id );
	if ( ! $file ) {
		return new WP_Error( 'open_station_files_not_found', __( 'File not found.', 'desktop-mode' ), array( 'status' => 404 ) );
	}
	if ( (int) $file['owner_id'] === $user_id ) {
		return new WP_Error( 'open_station_files_owner_cannot_leave', __( 'Owners cannot leave their own file.', 'desktop-mode' ), array( 'status' => 400 ) );
	}

	$tables = open_station_files_table_names();
	$row    = $wpdb->get_row(
		$wpdb->prepare(
			"SELECT * FROM {$tables['shares']}
			WHERE target_type = 'file' AND folder_id = %d
				AND principal_type = 'user' AND principal_ref = %s",
			$file_id,
			(string) $user_id
		),
		ARRAY_A
	);

	// Scrub the recipient's tile regardless — lingering placements
	// from a previously revoked share must go too.
	open_station_files_trash_upload_for_user( $file_id, $user_id );

	if ( ! $row ) {
		return new WP_Error( 'open_station_files_not_member', __( 'You do not have access to this file.', 'desktop-mode' ), array( 'status' => 404 ) );
	}
	$normalized = open_station_files_normalize_share_row( $row );
	$wpdb->update(
		$tables['shares'],
		array(
			'state'         => 'denied',
			'decided_at_ms' => open_station_files_now_ms(),
		),
		array( 'id' => (int) $row['id'] ),
		array( '%s', '%d' ),
		array( '%d' )
	);

	/** This action is documented in includes/desktop-files/shares-store.php */
	do_action( 'open_station_files_share_left', (int) $row['id'], $normalized, $user_id );

	return true;
}

/**
 * Owner revokes a file share.
 *
 * @param int $share_id Share id.
 * @param int $actor_id Actor.
 * @return true|WP_Error
 */
function open_station_stored_file_share_revoke( $share_id, $actor_id ) {
	global $wpdb;
	$share_id = (int) $share_id;
	$actor_id = (int) $actor_id;
	$row      = open_station_files_get_share( $share_id );
	if ( ! $row || 'file' !== $row['target_type'] ) {
		return new WP_Error( 'open_station_files_share_not_found', __( 'Share not found.', 'desktop-mode' ), array( 'status' => 404 ) );
	}
	if ( ! open_station_stored_files_share_can_manage( (int) $row['folder_id'], $actor_id ) ) {
		return new WP_Error( 'open_station_files_forbidden', __( 'You cannot manage shares for this file.', 'desktop-mode' ), array( 'status' => 403 ) );
	}

	$tables = open_station_files_table_names();
	$wpdb->delete( $tables['shares'], array( 'id' => $share_id ), array( '%d' ) );
	$wpdb->delete( $tables['decisions'], array( 'share_id' => $share_id ), array( '%d' ) );

	if ( 'accepted' === $row['state'] ) {
		open_station_files_trash_upload_for_user( (int) $row['folder_id'], (int) $row['principal_ref'] );
	}

	/** This action is documented in includes/desktop-files/shares-store.php */
	do_action( 'open_station_files_share_revoked', $share_id, $row, $actor_id );

	return true;
}

/**
 * Soft-trash a recipient's placements of an uploaded file (their
 * desktop tile). Direct DB update on purpose — the owner-lock trash
 * gate would (correctly) refuse a recipient-initiated trash through
 * the normal flow; this administrative scrub bypasses it. No
 * tombstones: soft-trash rides the heartbeat's `trashed_at_ms`
 * channel (same invariant as the folder scrub).
 *
 * @param int $file_id Stored-file id.
 * @param int $user_id Recipient whose placements to scrub.
 * @return int Rows scrubbed.
 */
function open_station_files_trash_upload_for_user( $file_id, $user_id ) {
	global $wpdb;
	$file_id = (int) $file_id;
	$user_id = (int) $user_id;
	if ( $file_id <= 0 || $user_id <= 0 ) {
		return 0;
	}
	$tables = open_station_files_table_names();
	$now    = open_station_files_now_ms();
	$rows   = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT id FROM {$tables['placements']}
			WHERE owner_id = %d
				AND file_type = 'upload'
				AND file_ref = %s
				AND trashed_at_ms IS NULL",
			$user_id,
			(string) $file_id
		),
		ARRAY_A
	);
	$count = 0;
	foreach ( (array) $rows as $row ) {
		$wpdb->update(
			$tables['placements'],
			array(
				'trashed_at_ms' => $now,
				'trashed_by'    => $user_id,
			),
			array( 'id' => (int) $row['id'] ),
			array( '%d', '%d' ),
			array( '%d' )
		);
		$count++;
	}
	return $count;
}

/**
 * Pending file-share invites for a user (heartbeat + shell-config
 * delivery). User-principal only.
 *
 * @param int $user_id  Viewer.
 * @param int $since_ms Only rows with `invited_at_ms > since`.
 * @return array[] Normalized share rows.
 */
function open_station_files_get_pending_file_shares_for_user( $user_id, $since_ms = 0 ) {
	global $wpdb;
	$user_id = (int) $user_id;
	if ( $user_id <= 0 ) {
		return array();
	}
	$tables = open_station_files_table_names();
	$rows   = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT s.* FROM {$tables['shares']} s
			INNER JOIN {$tables['stored_files']} sf ON sf.id = s.folder_id
			WHERE s.target_type = 'file'
				AND s.state = 'pending'
				AND s.invited_at_ms > %d
				AND s.principal_type = 'user'
				AND s.principal_ref = %s
			ORDER BY s.invited_at_ms ASC, s.id ASC",
			(int) $since_ms,
			(string) $user_id
		),
		ARRAY_A
	);
	$out = array();
	foreach ( (array) $rows as $row ) {
		$out[] = open_station_files_normalize_share_row( $row );
	}
	return $out;
}

/**
 * Wire shape for a file share, enriched for the invite banner.
 *
 * @param array $row Normalized share row (`target_type='file'`).
 * @return array
 */
function open_station_files_shape_file_share( $row ) {
	$file  = open_station_stored_files_get( (int) $row['folder_id'] );
	$shape = array(
		'id'            => (int) $row['id'],
		'targetType'    => 'file',
		'fileId'        => (int) $row['folder_id'],
		'principalType' => (string) $row['principal_type'],
		'principalRef'  => (string) $row['principal_ref'],
		'capability'    => 'read',
		'state'         => (string) $row['state'],
		'invitedBy'     => (int) $row['invited_by'],
		'invitedAtMs'   => (int) $row['invited_at_ms'],
		'decidedAtMs'   => isset( $row['decided_at_ms'] ) ? $row['decided_at_ms'] : null,
	);
	if ( $file ) {
		$shape['fileName'] = (string) $file['display_name'];
		$shape['ownerId']  = (int) $file['owner_id'];
		$owner             = get_userdata( (int) $file['owner_id'] );
		$shape['ownerName']   = $owner ? $owner->display_name : '';
		$shape['ownerAvatar'] = $owner ? get_avatar_url( $owner->ID, array( 'size' => 48 ) ) : '';
	}
	// Principal enrichment for the owner-side share list.
	$principal = get_userdata( (int) $row['principal_ref'] );
	$shape['displayName'] = $principal ? $principal->display_name : '';
	$shape['avatarUrl']   = $principal ? get_avatar_url( $principal->ID, array( 'size' => 48 ) ) : '';
	return $shape;
}

// ---------------------------------------------------------------------------
// REST routes.
// ---------------------------------------------------------------------------

/**
 * Register the file-share routes. Same 404-when-disabled gate as
 * every other share route (`open_station_files_rest_share_permission`).
 */
function open_station_files_register_file_share_rest_routes() {
	$ns = 'desktop-mode/v1';

	register_rest_route( $ns, '/files/uploads/(?P<id>\d+)/shares', array(
		array(
			'methods'             => WP_REST_Server::READABLE,
			'permission_callback' => 'open_station_files_rest_share_permission',
			'callback'            => 'open_station_files_rest_list_file_shares',
		),
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'permission_callback' => 'open_station_files_rest_share_permission',
			'callback'            => 'open_station_files_rest_create_file_share',
			'args'                => array(
				'userId' => array( 'type' => 'integer', 'required' => true ),
			),
		),
	) );
	register_rest_route( $ns, '/files/uploads/(?P<id>\d+)/shares/(?P<shareId>\d+)', array(
		'methods'             => WP_REST_Server::DELETABLE,
		'permission_callback' => 'open_station_files_rest_share_permission',
		'callback'            => 'open_station_files_rest_delete_file_share',
	) );
	register_rest_route( $ns, '/files/uploads/(?P<id>\d+)/shares/(?P<shareId>\d+)/accept', array(
		'methods'             => WP_REST_Server::CREATABLE,
		'permission_callback' => 'open_station_files_rest_share_permission',
		'callback'            => 'open_station_files_rest_accept_file_share',
	) );
	register_rest_route( $ns, '/files/uploads/(?P<id>\d+)/shares/(?P<shareId>\d+)/deny', array(
		'methods'             => WP_REST_Server::CREATABLE,
		'permission_callback' => 'open_station_files_rest_share_permission',
		'callback'            => 'open_station_files_rest_deny_file_share',
	) );
	register_rest_route( $ns, '/files/uploads/(?P<id>\d+)/leave', array(
		'methods'             => WP_REST_Server::CREATABLE,
		'permission_callback' => 'open_station_files_rest_share_permission',
		'callback'            => 'open_station_files_rest_leave_file_share',
	) );
}
add_action( 'rest_api_init', 'open_station_files_register_file_share_rest_routes' );

/**
 * Resolve the `{shareId}` inside `{id}` or fail with a masked 404.
 *
 * @internal
 *
 * @param WP_REST_Request $req Request.
 * @return array|WP_Error Normalized share row.
 */
function open_station_files_rest_resolve_file_share( WP_REST_Request $req ) {
	$row = open_station_files_get_share( (int) $req['shareId'] );
	if ( ! $row || 'file' !== $row['target_type'] || (int) $row['folder_id'] !== (int) $req['id'] ) {
		return new WP_Error( 'open_station_files_share_not_found', __( 'Share not found.', 'desktop-mode' ), array( 'status' => 404 ) );
	}
	return $row;
}

/**
 * GET /files/uploads/<id>/shares (managers only).
 */
function open_station_files_rest_list_file_shares( WP_REST_Request $req ) {
	$file_id = (int) $req['id'];
	$user_id = get_current_user_id();
	if ( ! open_station_stored_files_share_can_manage( $file_id, $user_id ) ) {
		return open_station_files_download_not_found();
	}
	$out = array();
	foreach ( open_station_stored_files_get_file_shares( $file_id ) as $row ) {
		$out[] = open_station_files_shape_file_share( $row );
	}
	return rest_ensure_response( array( 'shares' => $out ) );
}

/**
 * POST /files/uploads/<id>/shares — invite (read tier, always).
 * A `capability` param, if sent, must be `read` — `write` is 400.
 */
function open_station_files_rest_create_file_share( WP_REST_Request $req ) {
	$capability = $req->get_param( 'capability' );
	if ( null !== $capability && 'read' !== (string) $capability ) {
		return new WP_Error(
			'open_station_files_invalid_capability',
			__( 'Uploaded files can only be shared read-only.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}
	$id = open_station_stored_file_share_invite(
		(int) $req['id'],
		get_current_user_id(),
		(int) $req->get_param( 'userId' )
	);
	if ( is_wp_error( $id ) ) {
		return $id;
	}
	return rest_ensure_response( open_station_files_shape_file_share( open_station_files_get_share( $id ) ) );
}

/**
 * DELETE /files/uploads/<id>/shares/<shareId> — revoke.
 */
function open_station_files_rest_delete_file_share( WP_REST_Request $req ) {
	$row = open_station_files_rest_resolve_file_share( $req );
	if ( is_wp_error( $row ) ) {
		return $row;
	}
	$ok = open_station_stored_file_share_revoke( (int) $row['id'], get_current_user_id() );
	if ( is_wp_error( $ok ) ) {
		return $ok;
	}
	return rest_ensure_response( array( 'deleted' => true ) );
}

/**
 * POST .../accept
 */
function open_station_files_rest_accept_file_share( WP_REST_Request $req ) {
	$row = open_station_files_rest_resolve_file_share( $req );
	if ( is_wp_error( $row ) ) {
		return $row;
	}
	$next = open_station_stored_file_share_accept( (int) $row['id'], get_current_user_id() );
	if ( is_wp_error( $next ) ) {
		return $next;
	}
	return rest_ensure_response( open_station_files_shape_file_share( $next ) );
}

/**
 * POST .../deny
 */
function open_station_files_rest_deny_file_share( WP_REST_Request $req ) {
	$row = open_station_files_rest_resolve_file_share( $req );
	if ( is_wp_error( $row ) ) {
		return $row;
	}
	$next = open_station_stored_file_share_deny( (int) $row['id'], get_current_user_id() );
	if ( is_wp_error( $next ) ) {
		return $next;
	}
	return rest_ensure_response( open_station_files_shape_file_share( $next ) );
}

/**
 * POST /files/uploads/<id>/leave
 */
function open_station_files_rest_leave_file_share( WP_REST_Request $req ) {
	$ok = open_station_stored_file_share_leave( (int) $req['id'], get_current_user_id() );
	if ( is_wp_error( $ok ) ) {
		return $ok;
	}
	return rest_ensure_response( array( 'left' => true ) );
}

// ---------------------------------------------------------------------------
// Delivery: shell config + heartbeat.
// ---------------------------------------------------------------------------

/**
 * Append pending file-share invites to the boot-time
 * `serverPendingShares` array (after the folder injection at 20).
 * File shapes carry `targetType: 'file'` + `fileId` / `fileName`
 * so the invite banner can branch.
 *
 * @param array $config Shell config.
 * @return array
 */
function open_station_files_file_share_inject_shell_config( $config ) {
	$user_id         = get_current_user_id();
	$sharing_enabled = function_exists( 'open_station_files_sharing_enabled_for' )
		? open_station_files_sharing_enabled_for( $user_id )
		: true;
	if ( $user_id <= 0 || ! $sharing_enabled ) {
		return $config;
	}
	$pending = isset( $config['serverPendingShares'] ) && is_array( $config['serverPendingShares'] )
		? $config['serverPendingShares']
		: array();
	foreach ( open_station_files_get_pending_file_shares_for_user( $user_id, 0 ) as $row ) {
		$pending[] = open_station_files_shape_file_share( $row );
	}
	$config['serverPendingShares'] = $pending;
	return $config;
}
add_filter( 'open_station_shell_config', 'open_station_files_file_share_inject_shell_config', 21 );
