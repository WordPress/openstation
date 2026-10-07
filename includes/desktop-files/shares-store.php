<?php

defined( 'ABSPATH' ) || exit;

function openstation_files_sharing_enabled_for( $user_id ) {
	$user_id = (int) $user_id;
	if ( $user_id <= 0 ) {
		return false;
	}
	$enabled = true;
	if ( function_exists( 'openstation_get_os_settings' ) ) {
		$settings = openstation_get_os_settings( $user_id );
		$enabled  = ! empty( $settings['foldersSharingEnabled'] );
	}

	return (bool) apply_filters( 'openstation_files_sharing_enabled_for', $enabled, $user_id );
}

function openstation_files_share_principal_types() {
	return array( 'user', 'role' );
}

function openstation_files_shareable_types() {

	$types = (array) apply_filters( 'openstation_files_shareable_types', array( 'folder', 'file' ) );
	return array_values( array_unique( array_filter( array_map( 'strval', $types ) ) ) );
}

function openstation_files_share_target_owner( $target_type, $target_id ) {
	$owner = 0;
	if ( 'folder' === $target_type ) {
		$folder = openstation_files_get_folder( (int) $target_id );
		if ( $folder ) {
			$owner = (int) $folder['owner_id'];
		}
	} elseif ( 'file' === $target_type && function_exists( 'openstation_stored_files_get' ) ) {
		$file = openstation_stored_files_get( (int) $target_id );
		if ( $file ) {
			$owner = (int) $file['owner_id'];
		}
	}

	return (int) apply_filters( 'openstation_files_share_target_owner', $owner, (string) $target_type, (string) $target_id );
}

function openstation_files_share_capabilities() {
	return array( 'read', 'write' );
}

function openstation_files_share_states() {
	return array( 'pending', 'accepted', 'denied' );
}

function openstation_files_share_eligible_roles() {
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

	$out = (array) apply_filters( 'openstation_files_share_eligible_roles', $out );
	return $out;
}

function openstation_files_share_user_is_eligible( $user ) {
	if ( ! $user instanceof WP_User || ! $user->exists() ) {
		return false;
	}
	return user_can( $user, 'edit_posts' ) && ! openstation_agent_is_agent( $user );
}

function openstation_files_share_can_manage( $folder_id, $user_id ) {
	$folder = openstation_files_get_folder( (int) $folder_id );
	$can    = $folder && (int) $folder['owner_id'] === (int) $user_id;

	return (bool) apply_filters( 'openstation_files_share_can_manage', $can, (int) $folder_id, (int) $user_id, $folder );
}

function openstation_files_normalize_share_row( $row ) {
	return array(
		'id'             => (int) $row['id'],

		'target_type'    => isset( $row['target_type'] ) && '' !== (string) $row['target_type']
			? (string) $row['target_type']
			: 'folder',
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

function openstation_files_get_share( $share_id ) {
	global $wpdb;
	$tables = openstation_files_table_names();
	$row    = $wpdb->get_row(
		$wpdb->prepare( "SELECT * FROM {$tables['shares']} WHERE id = %d", (int) $share_id ),
		ARRAY_A
	);
	if ( ! $row ) {
		return null;
	}
	return openstation_files_normalize_share_row( $row );
}

function openstation_files_folder_share_summary( $folder_row, $viewer_id = null ) {
	$summary = array(
		'shared'         => false,
		'recipientCount' => 0,
	);
	if ( ! is_array( $folder_row ) || ! isset( $folder_row['id'] ) ) {
		return $summary;
	}

	$folder_id = (int) $folder_row['id'];
	$viewer_id = null === $viewer_id ? get_current_user_id() : (int) $viewer_id;
	$has_all   = 'all' === (string) ( isset( $folder_row['share_mode'] ) ? $folder_row['share_mode'] : '' );

	$accepted = 0;
	foreach ( openstation_files_get_folder_shares( $folder_id ) as $share ) {
		if ( 'accepted' === $share['state'] ) {
			++$accepted;
		}
	}

	$summary['shared'] = $has_all || $accepted > 0;

	if ( $summary['shared'] && openstation_files_share_can_manage( $folder_id, $viewer_id ) ) {
		$summary['recipientCount'] = $accepted + ( $has_all ? 1 : 0 );
	}
	return $summary;
}

function openstation_files_get_folder_shares( $folder_id ) {
	global $wpdb;
	$tables = openstation_files_table_names();
	$rows   = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT * FROM {$tables['shares']} WHERE target_type = 'folder' AND folder_id = %d ORDER BY invited_at_ms ASC, id ASC",
			(int) $folder_id
		),
		ARRAY_A
	);
	$out    = array();
	foreach ( (array) $rows as $row ) {
		$out[] = openstation_files_normalize_share_row( $row );
	}
	return $out;
}

function openstation_folder_share_invite( $folder_id, $actor_id, $principal_type, $principal_ref, $capability = 'read' ) {
	global $wpdb;
	$folder_id      = (int) $folder_id;
	$actor_id       = (int) $actor_id;
	$principal_type = (string) $principal_type;
	$principal_ref  = (string) $principal_ref;
	$capability     = (string) $capability;

	if ( ! in_array( $principal_type, openstation_files_share_principal_types(), true ) ) {
		return new WP_Error( 'openstation_files_invalid_principal_type', __( 'Invalid principal type.', 'desktop-mode' ), array( 'status' => 400 ) );
	}
	if ( ! in_array( $capability, openstation_files_share_capabilities(), true ) ) {
		return new WP_Error( 'openstation_files_invalid_capability', __( 'Invalid capability.', 'desktop-mode' ), array( 'status' => 400 ) );
	}
	if ( ! openstation_files_share_can_manage( $folder_id, $actor_id ) ) {
		return new WP_Error( 'openstation_files_forbidden', __( 'You cannot manage shares for this folder.', 'desktop-mode' ), array( 'status' => 403 ) );
	}

	if ( 'user' === $principal_type ) {
		$uid = (int) $principal_ref;
		if ( $uid <= 0 ) {
			return new WP_Error( 'openstation_files_invalid_user', __( 'Invalid user id.', 'desktop-mode' ), array( 'status' => 400 ) );
		}
		$user = get_userdata( $uid );
		if ( ! $user ) {
			return new WP_Error( 'openstation_files_unknown_user', __( 'Unknown user.', 'desktop-mode' ), array( 'status' => 404 ) );
		}
		$folder   = openstation_files_get_folder( $folder_id );
		$owner_id = $folder ? (int) $folder['owner_id'] : 0;
		if ( $uid === $owner_id ) {
			return new WP_Error( 'openstation_files_share_owner', __( 'You cannot share with the folder owner.', 'desktop-mode' ), array( 'status' => 400 ) );
		}
		if ( ! openstation_files_share_user_is_eligible( $user ) ) {
			return new WP_Error( 'openstation_files_ineligible_principal', __( 'This user is not eligible.', 'desktop-mode' ), array( 'status' => 400 ) );
		}
		$principal_ref = (string) $uid;
	} else {
		$eligible = wp_list_pluck( openstation_files_share_eligible_roles(), 'slug' );
		if ( ! in_array( $principal_ref, $eligible, true ) ) {
			return new WP_Error( 'openstation_files_ineligible_role', __( 'This role is not eligible.', 'desktop-mode' ), array( 'status' => 400 ) );
		}
	}

	$tables = openstation_files_table_names();
	$now    = openstation_files_now_ms();

	$existing = $wpdb->get_row(
		$wpdb->prepare(
			"SELECT * FROM {$tables['shares']}
			WHERE target_type = 'folder' AND folder_id = %d AND principal_type = %s AND principal_ref = %s",
			$folder_id,
			$principal_type,
			$principal_ref
		),
		ARRAY_A
	);
	if ( $existing ) {
		$id         = (int) $existing['id'];
		$next_state = 'denied' === $existing['state'] ? 'pending' : $existing['state'];
		$next_cap   = $capability;
		$set        = array(
			'capability'    => $next_cap,
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
		$row = openstation_files_get_share( $id );
	} else {
		$ok = $wpdb->insert(
			$tables['shares'],
			array(
				'target_type'    => 'folder',
				'folder_id'      => $folder_id,
				'principal_type' => $principal_type,
				'principal_ref'  => $principal_ref,
				'capability'     => $capability,
				'state'          => 'pending',
				'invited_by'     => $actor_id,
				'invited_at_ms'  => $now,
			),
			array( '%s', '%d', '%s', '%s', '%s', '%s', '%d', '%d' )
		);
		if ( false === $ok ) {
			return new WP_Error( 'openstation_files_share_insert_failed', __( 'Failed to record share.', 'desktop-mode' ), array( 'status' => 500 ) );
		}
		$id  = (int) $wpdb->insert_id;
		$row = openstation_files_get_share( $id );
	}

	openstation_files_bump_folder_updated_at( $folder_id );

	do_action( 'openstation_files_share_invited', $id, $row, $actor_id );

	return $id;
}

function openstation_folder_share_revoke( $share_id, $actor_id ) {
	global $wpdb;
	$share_id = (int) $share_id;
	$actor_id = (int) $actor_id;
	$row      = openstation_files_get_share( $share_id );
	if ( ! $row ) {
		return new WP_Error( 'openstation_files_share_not_found', __( 'Share not found.', 'desktop-mode' ), array( 'status' => 404 ) );
	}
	if ( ! openstation_files_share_can_manage( $row['folder_id'], $actor_id ) ) {
		return new WP_Error( 'openstation_files_forbidden', __( 'You cannot manage shares for this folder.', 'desktop-mode' ), array( 'status' => 403 ) );
	}

	$tables = openstation_files_table_names();
	$wpdb->delete( $tables['shares'], array( 'id' => $share_id ), array( '%d' ) );

	$wpdb->delete( $tables['decisions'], array( 'share_id' => $share_id ), array( '%d' ) );

	openstation_files_bump_folder_updated_at( $row['folder_id'] );

	if ( 'user' === $row['principal_type'] && 'accepted' === $row['state'] ) {
		$uid = (int) $row['principal_ref'];
		if ( $uid > 0 ) {
			openstation_files_trash_folder_for_user( $row['folder_id'], $uid );
		}
	} elseif ( 'role' === $row['principal_type'] ) {
		$decided_users = $wpdb->get_col(
			$wpdb->prepare(
				"SELECT DISTINCT user_id FROM {$tables['decisions']} WHERE share_id = %d",
				$share_id
			)
		);
		foreach ( (array) $decided_users as $uid ) {
			openstation_files_trash_folder_for_user( $row['folder_id'], (int) $uid );
		}
	}

	do_action( 'openstation_files_share_revoked', $share_id, $row, $actor_id );

	return true;
}

function openstation_folder_share_update_capability( $share_id, $actor_id, $capability ) {
	global $wpdb;
	$share_id   = (int) $share_id;
	$actor_id   = (int) $actor_id;
	$capability = (string) $capability;

	if ( ! in_array( $capability, openstation_files_share_capabilities(), true ) ) {
		return new WP_Error( 'openstation_files_invalid_capability', __( 'Invalid capability.', 'desktop-mode' ), array( 'status' => 400 ) );
	}
	$row = openstation_files_get_share( $share_id );
	if ( ! $row ) {
		return new WP_Error( 'openstation_files_share_not_found', __( 'Share not found.', 'desktop-mode' ), array( 'status' => 404 ) );
	}
	if ( ! openstation_files_share_can_manage( $row['folder_id'], $actor_id ) ) {
		return new WP_Error( 'openstation_files_forbidden', __( 'You cannot manage shares for this folder.', 'desktop-mode' ), array( 'status' => 403 ) );
	}

	$tables = openstation_files_table_names();
	$wpdb->update( $tables['shares'], array( 'capability' => $capability ), array( 'id' => $share_id ), array( '%s' ), array( '%d' ) );

	openstation_files_bump_folder_updated_at( $row['folder_id'] );

	$next = openstation_files_get_share( $share_id );

	do_action( 'openstation_files_share_capability_changed', $share_id, $next, $row, $actor_id );

	return true;
}

function openstation_files_get_user_decision( $share_id, $user_id ) {
	global $wpdb;
	$tables = openstation_files_table_names();
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

function openstation_files_upsert_user_decision( $share_id, $user_id, $state ) {
	global $wpdb;
	$tables = openstation_files_table_names();
	$now    = openstation_files_now_ms();
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

function openstation_files_share_user_state( $share_row, $user_id ) {
	if ( 'user' === $share_row['principal_type'] ) {
		return (string) $share_row['state'];
	}
	if ( 'role' === $share_row['principal_type'] ) {
		$dec = openstation_files_get_user_decision( (int) $share_row['id'], (int) $user_id );
		if ( $dec ) {
			return (string) $dec['state'];
		}
		return 'pending';
	}
	return 'pending';
}

function openstation_folder_share_accept( $share_id, $user_id ) {
	global $wpdb;
	$share_id = (int) $share_id;
	$user_id  = (int) $user_id;
	$row      = openstation_files_get_share( $share_id );
	if ( ! $row || 'folder' !== $row['target_type'] ) {
		return new WP_Error( 'openstation_files_share_not_found', __( 'Share not found.', 'desktop-mode' ), array( 'status' => 404 ) );
	}
	if ( ! openstation_files_share_principal_matches_user( $row, $user_id ) ) {
		return new WP_Error( 'openstation_files_share_not_recipient', __( 'This invite is not for you.', 'desktop-mode' ), array( 'status' => 403 ) );
	}
	$state = openstation_files_share_user_state( $row, $user_id );
	if ( 'accepted' === $state ) {
		return $row;
	}
	if ( 'denied' === $state && 'user' === $row['principal_type'] ) {
		return new WP_Error( 'openstation_files_share_already_denied', __( 'This invite was denied.', 'desktop-mode' ), array( 'status' => 410 ) );
	}

	$tables = openstation_files_table_names();
	$now    = openstation_files_now_ms();

	if ( 'user' === $row['principal_type'] ) {
		$wpdb->update(
			$tables['shares'],
			array(
				'state'         => 'accepted',
				'decided_at_ms' => $now,
			),
			array( 'id' => $share_id ),
			array( '%s', '%d' ),
			array( '%d' )
		);
	} else {
		openstation_files_upsert_user_decision( $share_id, $user_id, 'accepted' );
	}

	openstation_files_bump_folder_updated_at( $row['folder_id'] );

	$parent_id = (int) apply_filters( 'openstation_folder_share_accept_default_parent', 0, $row['folder_id'], $user_id, $row );
	openstation_files_place_at_next_free_slot( $user_id, $parent_id, 'folder', (string) $row['folder_id'] );

	$next = openstation_files_get_share( $share_id );

	do_action( 'openstation_files_share_accepted', $share_id, $next, $user_id );

	return $next;
}

function openstation_folder_share_deny( $share_id, $user_id ) {
	global $wpdb;
	$share_id = (int) $share_id;
	$user_id  = (int) $user_id;
	$row      = openstation_files_get_share( $share_id );
	if ( ! $row || 'folder' !== $row['target_type'] ) {
		return new WP_Error( 'openstation_files_share_not_found', __( 'Share not found.', 'desktop-mode' ), array( 'status' => 404 ) );
	}
	if ( ! openstation_files_share_principal_matches_user( $row, $user_id ) ) {
		return new WP_Error( 'openstation_files_share_not_recipient', __( 'This invite is not for you.', 'desktop-mode' ), array( 'status' => 403 ) );
	}
	$state = openstation_files_share_user_state( $row, $user_id );
	if ( 'denied' === $state ) {
		return $row;
	}

	$tables = openstation_files_table_names();
	$now    = openstation_files_now_ms();

	if ( 'user' === $row['principal_type'] ) {
		$wpdb->update(
			$tables['shares'],
			array(
				'state'         => 'denied',
				'decided_at_ms' => $now,
			),
			array( 'id' => $share_id ),
			array( '%s', '%d' ),
			array( '%d' )
		);
	} else {

		openstation_files_upsert_user_decision( $share_id, $user_id, 'denied' );
	}

	openstation_files_bump_folder_updated_at( $row['folder_id'] );

	if ( 'accepted' === $state ) {
		openstation_files_trash_folder_for_user( $row['folder_id'], $user_id );
	}

	$next = openstation_files_get_share( $share_id );

	do_action( 'openstation_files_share_denied', $share_id, $next, $user_id );

	return $next;
}

function openstation_folder_share_leave( $folder_id, $user_id ) {
	global $wpdb;
	$folder_id = (int) $folder_id;
	$user_id   = (int) $user_id;
	if ( $folder_id <= 0 || $user_id <= 0 ) {
		return new WP_Error( 'openstation_files_bad_request', __( 'Invalid arguments.', 'desktop-mode' ), array( 'status' => 400 ) );
	}
	$folder = openstation_files_get_folder( $folder_id );
	if ( ! $folder ) {
		return new WP_Error( 'openstation_files_not_found', __( 'Folder not found.', 'desktop-mode' ), array( 'status' => 404 ) );
	}
	if ( (int) $folder['owner_id'] === $user_id ) {
		return new WP_Error( 'openstation_files_owner_cannot_leave', __( 'Owners cannot leave their own folder.', 'desktop-mode' ), array( 'status' => 400 ) );
	}

	$user  = get_userdata( $user_id );
	$roles = $user ? (array) $user->roles : array();

	$tables  = openstation_files_table_names();
	$rows    = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT * FROM {$tables['shares']} WHERE target_type = 'folder' AND folder_id = %d",
			$folder_id
		),
		ARRAY_A
	);
	$touched = 0;
	foreach ( (array) $rows as $raw ) {
		$row = openstation_files_normalize_share_row( $raw );
		if ( ! openstation_files_share_principal_matches_user( $row, $user_id ) ) {
			continue;
		}
		if ( 'user' === $row['principal_type'] ) {
			$wpdb->update(
				$tables['shares'],
				array(
					'state'         => 'denied',
					'decided_at_ms' => openstation_files_now_ms(),
				),
				array( 'id' => $row['id'] ),
				array( '%s', '%d' ),
				array( '%d' )
			);
		} else {
			openstation_files_upsert_user_decision( $row['id'], $user_id, 'denied' );
		}
		++$touched;

		do_action( 'openstation_files_share_left', $row['id'], $row, $user_id );
	}

	openstation_files_trash_folder_for_user( $folder_id, $user_id );
	openstation_files_bump_folder_updated_at( $folder_id );

	if ( 0 === $touched ) {
		return new WP_Error( 'openstation_files_not_member', __( 'You do not have access to this folder.', 'desktop-mode' ), array( 'status' => 404 ) );
	}
	return true;
}

function openstation_files_share_principal_matches_user( $share_row, $user_id ) {
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

function openstation_folder_share_user_capability( $folder_id, $user_id ) {
	$folder_id = (int) $folder_id;
	$user_id   = (int) $user_id;
	if ( $folder_id <= 0 || $user_id <= 0 ) {
		return 'none';
	}

	$folder = openstation_files_get_folder( $folder_id );
	if ( ! $folder ) {
		return 'none';
	}
	if ( (int) $folder['owner_id'] === $user_id ) {
		return 'write';
	}

	$cascade_cap = openstation_folder_share_user_capability_cascade( $folder_id, $user_id );
	if ( 'write' === $cascade_cap ) {
		return 'write';
	}

	$cap = 'none';
	if ( 'all' === $folder['share_mode'] ) {

		$cap = (string) apply_filters( 'openstation_files_share_all_default_capability', 'read', $folder_id, $user_id );
	}

	$user_roles = array();
	$user       = get_userdata( $user_id );
	if ( $user ) {
		$user_roles = (array) $user->roles;
	}

	global $wpdb;
	$tables = openstation_files_table_names();

	$rows = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT id, principal_type, principal_ref, capability FROM {$tables['shares']}
			WHERE target_type = 'folder' AND folder_id = %d AND principal_type = 'user' AND state = 'accepted'",
			$folder_id
		),
		ARRAY_A
	);

	$role_rows = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT s.id, s.principal_type, s.principal_ref, s.capability
			FROM {$tables['shares']} s
			INNER JOIN {$tables['decisions']} d ON d.share_id = s.id AND d.user_id = %d AND d.state = 'accepted'
			WHERE s.target_type = 'folder' AND s.folder_id = %d AND s.principal_type = 'role'",
			$user_id,
			$folder_id
		),
		ARRAY_A
	);
	$rows      = array_merge( (array) $rows, (array) $role_rows );
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
				break;
			}
			if ( 'read' === $row_cap && 'none' === $cap ) {
				$cap = 'read';
			}
		}
	}

	if ( 'read' === $cascade_cap && 'none' === $cap ) {
		$cap = 'read';
	}

	return (string) apply_filters( 'openstation_folder_share_user_capability', $cap, $folder_id, $user_id, $folder );
}

function openstation_folder_share_user_capability_cascade( $folder_id, $user_id ) {
	$user_id   = (int) $user_id;
	$ancestors = openstation_folder_ancestors( (int) $folder_id );
	if ( empty( $ancestors ) || $user_id <= 0 ) {
		return 'none';
	}

	global $wpdb;
	$tables = openstation_files_table_names();

	$ancestor_ids = array_values( array_unique( array_map( 'intval', $ancestors ) ) );
	$ids_csv      = implode( ',', $ancestor_ids );

	$folder_rows = $wpdb->get_results(
		"SELECT id, owner_id, share_mode FROM {$tables['folders']} WHERE id IN ($ids_csv)",
		ARRAY_A
	);

	$cap = 'none';
	foreach ( (array) $folder_rows as $f ) {
		if ( (int) $f['owner_id'] === $user_id ) {
			return 'write';
		}
		if ( 'all' === $f['share_mode'] ) {
			$all_cap = (string) apply_filters(
				'openstation_files_share_all_default_capability',
				'read',
				(int) $f['id'],
				$user_id
			);
			if ( 'write' === $all_cap ) {
				return 'write';
			}
			if ( 'read' === $all_cap && 'none' === $cap ) {
				$cap = 'read';
			}
		}
	}

	$user_rows = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT folder_id, capability FROM {$tables['shares']}
			WHERE target_type = 'folder'
				AND folder_id IN ($ids_csv)
				AND principal_type = 'user'
				AND principal_ref = %s
				AND state = 'accepted'",
			(string) $user_id
		),
		ARRAY_A
	);
	foreach ( (array) $user_rows as $row ) {
		$row_cap = (string) $row['capability'];
		if ( 'write' === $row_cap ) {
			return 'write';
		}
		if ( 'read' === $row_cap && 'none' === $cap ) {
			$cap = 'read';
		}
	}

	$user       = get_userdata( $user_id );
	$user_roles = $user ? (array) $user->roles : array();
	if ( ! empty( $user_roles ) ) {
		$role_placeholders = implode( ',', array_fill( 0, count( $user_roles ), '%s' ) );
		$args              = array_merge( array( $user_id ), $user_roles );

		$role_rows = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT s.folder_id, s.capability
				FROM {$tables['shares']} s
				INNER JOIN {$tables['decisions']} d ON d.share_id = s.id AND d.user_id = %d AND d.state = 'accepted'
				WHERE s.target_type = 'folder'
					AND s.folder_id IN ($ids_csv)
					AND s.principal_type = 'role'
					AND s.principal_ref IN ($role_placeholders)",
				$args
			),
			ARRAY_A
		);
		foreach ( (array) $role_rows as $row ) {
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

function openstation_folder_share_user_capability_direct( $folder_id, $user_id ) {
	$folder_id = (int) $folder_id;
	$user_id   = (int) $user_id;
	if ( $folder_id <= 0 || $user_id <= 0 ) {
		return 'none';
	}
	$folder = openstation_files_get_folder( $folder_id );
	if ( ! $folder ) {
		return 'none';
	}
	if ( (int) $folder['owner_id'] === $user_id ) {
		return 'write';
	}
	$cap = 'none';
	if ( 'all' === $folder['share_mode'] ) {
		$cap = (string) apply_filters( 'openstation_files_share_all_default_capability', 'read', $folder_id, $user_id );
	}

	$user_roles = array();
	$user       = get_userdata( $user_id );
	if ( $user ) {
		$user_roles = (array) $user->roles;
	}

	global $wpdb;
	$tables    = openstation_files_table_names();
	$rows      = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT id, principal_type, principal_ref, capability FROM {$tables['shares']}
			WHERE target_type = 'folder' AND folder_id = %d AND principal_type = 'user' AND state = 'accepted'",
			$folder_id
		),
		ARRAY_A
	);
	$role_rows = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT s.id, s.principal_type, s.principal_ref, s.capability
			FROM {$tables['shares']} s
			INNER JOIN {$tables['decisions']} d ON d.share_id = s.id AND d.user_id = %d AND d.state = 'accepted'
			WHERE s.target_type = 'folder' AND s.folder_id = %d AND s.principal_type = 'role'",
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

function openstation_folder_ancestors( $folder_id, $limit = 16 ) {
	global $wpdb;
	$folder_id = (int) $folder_id;
	if ( $folder_id <= 0 ) {
		return array();
	}
	$tables    = openstation_files_table_names();
	$ancestors = array();
	$current   = $folder_id;
	$visited   = array();
	$depth     = 0;
	while ( $depth < $limit ) {
		if ( isset( $visited[ $current ] ) ) {
			break;
		}
		$visited[ $current ] = true;
		$folder              = openstation_files_get_folder( $current );
		if ( ! $folder ) {
			break;
		}
		$owner = (int) $folder['owner_id'];
		$row   = $wpdb->get_row(
			$wpdb->prepare(
				"SELECT parent_id FROM {$tables['placements']}
				WHERE owner_id = %d
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
		++$depth;
	}
	return $ancestors;
}

function openstation_files_get_pending_shares_for_user( $user_id, $since_ms = 0 ) {
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

	$tables = openstation_files_table_names();

	$user_pending = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT s.* FROM {$tables['shares']} s
			INNER JOIN {$tables['folders']} f ON f.id = s.folder_id AND f.trashed_at_ms IS NULL
			WHERE s.target_type = 'folder'
				AND s.state = 'pending'
				AND s.invited_at_ms > %d
				AND s.principal_type = 'user'
				AND s.principal_ref = %s
			ORDER BY s.invited_at_ms ASC, s.id ASC",
			$since_ms,
			(string) $user_id
		),
		ARRAY_A
	);

	$role_pending = array();
	if ( ! empty( $roles ) ) {
		$placeholders = implode( ',', array_fill( 0, count( $roles ), '%s' ) );
		$prepare      = array_merge( array( $user_id, $since_ms ), $roles );

		$role_pending = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT s.* FROM {$tables['shares']} s
				INNER JOIN {$tables['folders']} f ON f.id = s.folder_id AND f.trashed_at_ms IS NULL
				LEFT JOIN {$tables['decisions']} d ON d.share_id = s.id AND d.user_id = %d
				WHERE s.target_type = 'folder'
					AND s.invited_at_ms > %d
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
		$out[] = openstation_files_normalize_share_row( $row );
	}
	return $out;
}

function openstation_files_bump_folder_updated_at( $folder_id ) {
	global $wpdb;
	$tables = openstation_files_table_names();
	$wpdb->update(
		$tables['folders'],
		array( 'updated_at_ms' => openstation_files_now_ms() ),
		array( 'id' => (int) $folder_id ),
		array( '%d' ),
		array( '%d' )
	);
}

function openstation_files_trash_folder_for_user( $folder_id, $user_id ) {
	global $wpdb;
	$folder_id = (int) $folder_id;
	$user_id   = (int) $user_id;
	if ( $folder_id <= 0 || $user_id <= 0 ) {
		return 0;
	}
	$tables = openstation_files_table_names();
	$now    = openstation_files_now_ms();

	$rows  = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT id FROM {$tables['placements']}
			WHERE owner_id = %d
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

		++$count;
	}
	return $count;
}

function openstation_files_share_gate_trash( $can, $user_id, $row ) {
	$parent_id = isset( $row['parent_id'] ) ? (int) $row['parent_id'] : 0;
	$user_id   = (int) $user_id;

	if (
		$parent_id <= 0 &&
		isset( $row['file_type'] ) &&
		'folder' === (string) $row['file_type'] &&
		isset( $row['file_ref'] )
	) {
		$folder_ref = (int) $row['file_ref'];
		if ( $folder_ref > 0 ) {
			$folder_row = openstation_files_get_folder( $folder_ref );
			if (
				$folder_row &&
				(int) $folder_row['owner_id'] !== $user_id
			) {

				$root_cap = openstation_folder_share_user_capability( $folder_ref, $user_id );
				if ( 'none' !== $root_cap ) {
					return false;
				}
			}
		}
		return $can;
	}

	if ( $parent_id <= 0 ) {

		return $can;
	}
	$folder = openstation_files_get_folder( $parent_id );
	if ( ! $folder ) {
		return $can;
	}
	$is_owner = (int) $folder['owner_id'] === $user_id;
	$cap      = openstation_folder_share_user_capability( $parent_id, $user_id );

	if ( $is_owner ) {
		return true;
	}

	return 'write' === $cap;
}
add_filter( 'openstation_files_user_can_trash_placement', 'openstation_files_share_gate_trash', 10, 3 );

function openstation_files_share_inject_shell_config( $config ) {
	if ( ! is_array( $config ) ) {
		$config = array();
	}
	$config['shareEligibleRoles']  = openstation_files_share_eligible_roles();
	$config['filesUsersSearchUrl'] = esc_url_raw( rest_url( 'desktop-mode/v1/files/users/search' ) );
	$config['folderSharesUrl']     = esc_url_raw( rest_url( 'desktop-mode/v1/files/folders' ) );
	$user_id                       = (int) get_current_user_id();
	if ( ! isset( $config['currentUserId'] ) ) {
		$config['currentUserId'] = $user_id;
	}

	$pending         = array();
	$sharing_enabled = function_exists( 'openstation_files_sharing_enabled_for' )
		? openstation_files_sharing_enabled_for( $user_id )
		: true;
	if (
		$user_id > 0 &&
		$sharing_enabled &&
		function_exists( 'openstation_files_get_pending_shares_for_user' )
	) {
		$rows = openstation_files_get_pending_shares_for_user( $user_id, 0 );
		foreach ( $rows as $row ) {
			$shape  = openstation_files_shape_share( $row );
			$folder = openstation_files_get_folder( $row['folder_id'] );
			if ( $folder ) {
				$shape['folderName']  = (string) $folder['name'];
				$shape['ownerId']     = (int) $folder['owner_id'];
				$owner_user           = get_userdata( (int) $folder['owner_id'] );
				$shape['ownerName']   = $owner_user ? openstation_plain_text_title( $owner_user->display_name ) : '';
				$shape['ownerAvatar'] = $owner_user ? get_avatar_url( $owner_user->ID, array( 'size' => 48 ) ) : '';
			}
			$pending[] = $shape;
		}
	}
	$config['serverPendingShares'] = $pending;

	return $config;
}
add_filter( 'openstation_shell_config', 'openstation_files_share_inject_shell_config', 20 );

function openstation_files_place_at_next_free_slot( $user_id, $parent_id, $type, $ref ) {
	global $wpdb;
	$user_id   = (int) $user_id;
	$parent_id = max( 0, (int) $parent_id );

	$tables   = openstation_files_table_names();
	$existing = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT x, y FROM {$tables['placements']}
			WHERE owner_id = %d
				AND parent_id = %d
				AND trashed_at_ms IS NULL",
			$user_id,
			$parent_id
		),
		ARRAY_A
	);
	$occupied = openstation_files_grid_occupied( $existing );

	list( $pick_col, $pick_row ) = openstation_files_grid_next_free(
		$occupied,
		openstation_files_grid_order( $parent_id )
	);

	return openstation_files_place(
		$user_id,
		$parent_id,
		$type,
		$ref,
		openstation_files_grid_cell_to_point( $pick_col, $pick_row )
	);
}
