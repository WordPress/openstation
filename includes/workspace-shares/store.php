<?php
/**
 * OpenStation — Shared workspaces: the share record.
 *
 * A workspace lives on a desktop inside its owner's session, and a
 * session belongs to one user. Sharing needs something that belongs to
 * nobody's session: a record holding a FROZEN copy of the workspace, a
 * link token, and a version the author bumps when they republish.
 *
 * That record is a private post type. It outlives the desk it was
 * shared from — the author can delete their own copy and every
 * recipient keeps theirs, because a recipient's desk is built from
 * this record, never from the author's session.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/** Post type holding shared workspaces. 20 characters — the post type ceiling. */
const OPENSTATION_WORKSPACE_SHARE_POST_TYPE = 'openstation_ws_share';

/** Post meta: the link token. */
const OPENSTATION_WORKSPACE_SHARE_TOKEN_META = '_openstation_ws_token';

/** Post meta: the author's desktop id the share was made from. */
const OPENSTATION_WORKSPACE_SHARE_DESKTOP_META = '_openstation_ws_desktop';

/** Post meta: the snapshot version, bumped on every republish. */
const OPENSTATION_WORKSPACE_SHARE_VERSION_META = '_openstation_ws_version';

/**
 * Post meta: the publishing client's fingerprint of the profile, so the
 * Workspaces app can tell a desk that changed since it was shared.
 * Opaque to the server.
 */
const OPENSTATION_WORKSPACE_SHARE_HASH_META = '_openstation_ws_hash';

/** Post meta: `'1'` while the link is disabled. */
const OPENSTATION_WORKSPACE_SHARE_DISABLED_META = '_openstation_ws_disabled';

/** Query arg carrying a share token on the link. */
const OPENSTATION_WORKSPACE_SHARE_QUERY_ARG = 'os_workspace';

/**
 * Registers the share post type. Private plumbing: no admin UI, no
 * front end, no REST controller of its own.
 *
 * `delete_with_user` is false on purpose: a recipient's desk is pinned
 * to this record, so a share must not vanish with the admin who made
 * it — that is exactly the case the fallback release exists for.
 *
 * @return void
 */
function openstation_workspace_shares_register_post_type() {
	register_post_type(
		OPENSTATION_WORKSPACE_SHARE_POST_TYPE,
		array(
			'label'               => __( 'Shared workspaces', 'desktop-mode' ),
			'public'              => false,
			'show_ui'             => false,
			'show_in_rest'        => false,
			'exclude_from_search' => true,
			'publicly_queryable'  => false,
			'rewrite'             => false,
			'query_var'           => false,
			'supports'            => array( 'title', 'author' ),
			'delete_with_user'    => false,
		)
	);
}
add_action( 'init', 'openstation_workspace_shares_register_post_type', 5 );

/**
 * The capability that may share workspaces and release recipients.
 *
 * Every holder is also exempt from being pinned: a link opened by
 * someone who can manage shares adds the workspace as an ordinary desk
 * instead of locking them into it. An admin clicking their own link to
 * check it must not lose their admin.
 *
 * @return string Capability name.
 */
function openstation_workspace_share_capability() {
	/**
	 * Filters the capability required to share workspaces and to
	 * release the users a shared workspace pins.
	 *
	 * @param string $capability Default 'manage_options'.
	 */
	$cap = apply_filters( 'openstation_workspace_share_capability', 'manage_options' );
	return is_string( $cap ) && '' !== $cap ? $cap : 'manage_options';
}

/**
 * Whether a user may share workspaces (and is therefore never pinned).
 *
 * @param int $user_id Optional. Defaults to the current user.
 * @return bool
 */
function openstation_workspace_user_can_share( $user_id = 0 ) {
	$user_id = $user_id ? (int) $user_id : get_current_user_id();
	return $user_id > 0 && user_can( $user_id, openstation_workspace_share_capability() );
}

/**
 * The capability a user needs to RECEIVE a shared workspace.
 *
 * A link is a way into someone's admin, so it is not for every account
 * that can log in: by default only people who write content
 * (`edit_posts` — Contributor and above, Shop Manager, and the like)
 * can claim one. A Subscriber or a store Customer who opens a link is
 * told it is not for them, and nothing about their account changes.
 *
 * @return string Capability name.
 */
function openstation_workspace_claim_capability() {
	/**
	 * Filters the capability a user needs to claim a shared workspace.
	 *
	 * @param string $capability Default 'edit_posts'.
	 */
	$cap = apply_filters( 'openstation_workspace_claim_capability', 'edit_posts' );
	return is_string( $cap ) && '' !== $cap ? $cap : 'edit_posts';
}

/**
 * Whether a user may claim a shared workspace.
 *
 * @param int $user_id User id.
 * @return bool
 */
function openstation_workspace_user_can_claim( $user_id ) {
	$user_id = (int) $user_id;
	return $user_id > 0 && user_can( $user_id, openstation_workspace_claim_capability() );
}

/**
 * Gives a share a new link token. The old link stops working at once;
 * everyone who already claimed it keeps their desk, because a claim is
 * recorded against the share, never against its token.
 *
 * @param int $share_id Share id.
 * @return array|null The share with its new link, or null.
 */
function openstation_workspace_share_rotate_token( $share_id ) {
	if ( ! openstation_workspace_share_get( $share_id ) ) {
		return null;
	}
	update_post_meta( (int) $share_id, OPENSTATION_WORKSPACE_SHARE_TOKEN_META, openstation_workspace_share_new_token() );
	return openstation_workspace_share_get( $share_id );
}

/**
 * Generates a link token. Unguessable, URL-safe, never the post id —
 * a sequential id would let anyone holding one link walk to the rest.
 *
 * @return string
 */
function openstation_workspace_share_new_token() {
	return strtolower( wp_generate_password( 24, false, false ) );
}

/**
 * The shareable link for a token.
 *
 * @param string $token Share token.
 * @return string Absolute wp-admin URL.
 */
function openstation_workspace_share_link( $token ) {
	return add_query_arg( OPENSTATION_WORKSPACE_SHARE_QUERY_ARG, rawurlencode( $token ), admin_url() );
}

/**
 * Sanitizes the snapshot a share stores.
 *
 * Runs the same bounds a profile gets inside a session, then clears
 * `provisioned`: a snapshot is a definition, and every recipient's desk
 * has to open its windows the first time it is entered.
 *
 * @param mixed $raw Raw profile.
 * @return array|null Sanitized profile, or null when there isn't one.
 */
function openstation_workspace_share_sanitize_snapshot( $raw ) {
	$profile = openstation_sanitize_workspace_profile( $raw );
	if ( null === $profile ) {
		return null;
	}
	$profile['provisioned'] = false;

	// A workspace carries only the settings its author changed from the
	// defaults; the rest follow the author's own Preferences on their
	// desk. A share is a copy for someone else, so it carries every
	// setting — the ones left out at their defaults — and a pinned
	// recipient gets every one held, not whatever their account had.
	$profile['appearance'] = openstation_sanitize_workspace_appearance(
		array_merge(
			array_intersect_key( openstation_default_os_settings(), array_flip( openstation_workspace_setting_keys() ) ),
			(array) $profile['appearance']
		)
	);

	// The Workspaces app is where a workspace is managed, never part of
	// what one is for: a customer opening the link must not get it,
	// whatever the desk had open when it was saved.
	$never = array( 'openstation-workspaces' );
	$profile['windows'] = array_values(
		array_filter(
			$profile['windows'],
			static function ( $win ) use ( $never ) {
				return ! in_array( $win['match'], $never, true );
			}
		)
	);
	$profile['apps']['ids'] = array_values( array_diff( $profile['apps']['ids'], $never ) );
	return $profile;
}

/**
 * Normalizes a label the way a desktop label is stored.
 *
 * @param mixed $label Raw label.
 * @return string
 */
function openstation_workspace_share_sanitize_label( $label ) {
	$label = trim( wp_strip_all_tags( is_string( $label ) ? $label : '' ) );
	if ( '' === $label ) {
		$label = __( 'Workspace', 'desktop-mode' );
	}
	return substr( $label, 0, 64 );
}

/**
 * Reads a share into its public shape.
 *
 * @param int|WP_Post $post Share post or id.
 * @return array|null Share, or null when it is not one.
 */
function openstation_workspace_share_get( $post ) {
	$post = get_post( $post );
	if ( ! $post || OPENSTATION_WORKSPACE_SHARE_POST_TYPE !== $post->post_type ) {
		return null;
	}
	$profile = json_decode( (string) $post->post_content, true );
	$token   = (string) get_post_meta( $post->ID, OPENSTATION_WORKSPACE_SHARE_TOKEN_META, true );
	return array(
		'id'       => (int) $post->ID,
		'label'    => (string) $post->post_title,
		'author'   => (int) $post->post_author,
		'desktop'  => (string) get_post_meta( $post->ID, OPENSTATION_WORKSPACE_SHARE_DESKTOP_META, true ),
		'token'    => $token,
		'url'      => openstation_workspace_share_link( $token ),
		'version'  => max( 1, (int) get_post_meta( $post->ID, OPENSTATION_WORKSPACE_SHARE_VERSION_META, true ) ),
		'disabled' => '1' === get_post_meta( $post->ID, OPENSTATION_WORKSPACE_SHARE_DISABLED_META, true ),
		'hash'     => (string) get_post_meta( $post->ID, OPENSTATION_WORKSPACE_SHARE_HASH_META, true ),
		'created'  => (string) $post->post_date_gmt,
		'modified' => (string) $post->post_modified_gmt,
		'profile'  => is_array( $profile ) ? openstation_workspace_share_sanitize_snapshot( $profile ) : null,
	);
}

/**
 * Finds a share by its link token.
 *
 * @param string $token Share token.
 * @return array|null
 */
function openstation_workspace_share_find_by_token( $token ) {
	$token = preg_replace( '/[^a-z0-9]/', '', strtolower( (string) $token ) );
	if ( '' === $token ) {
		return null;
	}
	$ids = get_posts(
		array(
			'post_type'        => OPENSTATION_WORKSPACE_SHARE_POST_TYPE,
			'post_status'      => 'publish',
			'posts_per_page'   => 1,
			'fields'           => 'ids',
			'no_found_rows'    => true,
			'suppress_filters' => false,
			// phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query -- one indexed meta_key lookup per link visit.
			'meta_query'       => array(
				array(
					'key'   => OPENSTATION_WORKSPACE_SHARE_TOKEN_META,
					'value' => $token,
				),
			),
		)
	);
	if ( empty( $ids ) ) {
		return null;
	}
	$share = openstation_workspace_share_get( (int) $ids[0] );
	// Constant-time on the stored value, not the query's word for it.
	return $share && hash_equals( $share['token'], $token ) ? $share : null;
}

/**
 * Lists shares, newest first.
 *
 * @param int $author Optional. Only this author's shares; 0 for all.
 * @return array[]
 */
function openstation_workspace_shares_list( $author = 0 ) {
	$args = array(
		'post_type'        => OPENSTATION_WORKSPACE_SHARE_POST_TYPE,
		'post_status'      => 'publish',
		'posts_per_page'   => 200,
		'orderby'          => 'date',
		'order'            => 'DESC',
		'no_found_rows'    => true,
		'suppress_filters' => false,
	);
	if ( $author > 0 ) {
		$args['author'] = (int) $author;
	}
	return array_values( array_filter( array_map( 'openstation_workspace_share_get', get_posts( $args ) ) ) );
}

/**
 * The share an author made from one of their desktops, if any.
 *
 * @param int    $author     Author id.
 * @param string $desktop_id Desktop id in the author's session.
 * @return array|null
 */
function openstation_workspace_share_for_desktop( $author, $desktop_id ) {
	foreach ( openstation_workspace_shares_list( (int) $author ) as $share ) {
		if ( $share['desktop'] === $desktop_id ) {
			return $share;
		}
	}
	return null;
}

/**
 * Shares a workspace — or republishes it, when the author already
 * shared this desk.
 *
 * Republishing keeps the token (the link people already have keeps
 * working) and bumps the version, which is what tells every pinned
 * recipient's desk to take the new snapshot on its next load.
 *
 * @param int    $author     Author id.
 * @param string $desktop_id Desktop id the workspace lives on.
 * @param string $label      Workspace name.
 * @param mixed  $profile    Workspace profile.
 * @return array|WP_Error The share.
 */
function openstation_workspace_share_publish( $author, $desktop_id, $label, $profile ) {
	$author     = (int) $author;
	$desktop_id = sanitize_key( (string) $desktop_id );
	$snapshot   = openstation_workspace_share_sanitize_snapshot( $profile );
	if ( null === $snapshot || '' === $desktop_id ) {
		return new WP_Error( 'openstation_workspace_share_invalid', __( 'That is not a workspace that can be shared.', 'desktop-mode' ), array( 'status' => 400 ) );
	}
	if ( ! openstation_workspace_user_can_share( $author ) ) {
		return new WP_Error( 'openstation_workspace_share_forbidden', __( 'You are not allowed to share workspaces.', 'desktop-mode' ), array( 'status' => 403 ) );
	}

	/**
	 * Filters the snapshot a share stores, before it is written.
	 *
	 * @param array  $snapshot   Sanitized workspace profile.
	 * @param int    $author     Author id.
	 * @param string $desktop_id Desktop the workspace was shared from.
	 */
	$snapshot = openstation_workspace_share_sanitize_snapshot(
		apply_filters( 'openstation_workspace_share_snapshot', $snapshot, $author, $desktop_id )
	);
	if ( null === $snapshot ) {
		return new WP_Error( 'openstation_workspace_share_invalid', __( 'That is not a workspace that can be shared.', 'desktop-mode' ), array( 'status' => 400 ) );
	}

	$existing = openstation_workspace_share_for_desktop( $author, $desktop_id );
	$postarr  = array(
		'post_type'    => OPENSTATION_WORKSPACE_SHARE_POST_TYPE,
		'post_status'  => 'publish',
		'post_author'  => $author,
		'post_title'   => openstation_workspace_share_sanitize_label( $label ),
		// Slashed: wp_insert_post() unslashes, and JSON is full of
		// backslashes a bare string would lose.
		'post_content' => wp_slash( wp_json_encode( $snapshot ) ),
	);
	if ( $existing ) {
		$postarr['ID'] = $existing['id'];
	}
	$id = $existing ? wp_update_post( $postarr, true ) : wp_insert_post( $postarr, true );
	if ( is_wp_error( $id ) ) {
		return $id;
	}

	if ( $existing ) {
		update_post_meta( $id, OPENSTATION_WORKSPACE_SHARE_VERSION_META, $existing['version'] + 1 );
	} else {
		update_post_meta( $id, OPENSTATION_WORKSPACE_SHARE_TOKEN_META, openstation_workspace_share_new_token() );
		update_post_meta( $id, OPENSTATION_WORKSPACE_SHARE_DESKTOP_META, $desktop_id );
		update_post_meta( $id, OPENSTATION_WORKSPACE_SHARE_VERSION_META, 1 );
	}

	$share = openstation_workspace_share_get( $id );

	/**
	 * Fires after a workspace is shared or republished.
	 *
	 * @param array $share       The share.
	 * @param bool  $republished Whether this updated an existing share.
	 */
	do_action( 'openstation_workspace_shared', $share, (bool) $existing );

	return $share;
}

/**
 * Disables or re-enables a share's link.
 *
 * A disabled link claims nothing new. The people it already pinned stay
 * pinned — releasing them is a separate, deliberate act.
 *
 * @param int  $share_id Share id.
 * @param bool $disabled Whether the link is disabled.
 * @return bool Whether the share exists.
 */
function openstation_workspace_share_set_disabled( $share_id, $disabled ) {
	if ( ! openstation_workspace_share_get( $share_id ) ) {
		return false;
	}
	if ( $disabled ) {
		update_post_meta( (int) $share_id, OPENSTATION_WORKSPACE_SHARE_DISABLED_META, '1' );
	} else {
		delete_post_meta( (int) $share_id, OPENSTATION_WORKSPACE_SHARE_DISABLED_META );
	}
	return true;
}

/**
 * Deletes a share, releasing everyone it pins first — a pin whose
 * share is gone would be a lock nobody can open.
 *
 * @param int $share_id Share id.
 * @return bool Whether it was deleted.
 */
function openstation_workspace_share_delete( $share_id ) {
	$share = openstation_workspace_share_get( $share_id );
	if ( ! $share ) {
		return false;
	}
	foreach ( openstation_workspace_share_pinned_users( $share['id'] ) as $user_id ) {
		openstation_workspace_pin_release( $user_id );
	}
	/**
	 * Fires before a share is deleted, after its recipients were released.
	 *
	 * @param array $share The share.
	 */
	do_action( 'openstation_workspace_share_deleting', $share );
	return (bool) wp_delete_post( $share['id'], true );
}
