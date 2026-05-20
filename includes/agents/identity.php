<?php
/**
 * Desktop Mode — Agents: identity layer (synthetic WordPress users).
 *
 * Each agent has a real row in `wp_users` so capability checks, edit
 * locks, comment attribution, and the standard WP audit trail work
 * without a parallel ACL. The row is "synthetic" only in that we block
 * every login path — the agent never authenticates as a human; it's
 * invoked on the site's behalf.
 *
 * Marker meta on the user row: `_desktop_mode_agent = '1'`.
 * Link to behaviour layer: `_desktop_mode_agent_guideline_id = <wp_guideline.ID>`.
 *
 * Login is blocked at three layers — `authenticate` filter rejects
 * password attempts, `allow_password_reset` filter rejects reset
 * emails, and the wp-admin Users list is annotated with an "Agent"
 * column so site administrators can tell synthetic accounts apart.
 *
 * @package WPDesktopMode
 * @since   0.23.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Meta keys owned by the identity layer. Listed here so other layers
 * can reuse the constants instead of typing the literals.
 *
 * @since 0.23.0
 */
const DESKTOP_MODE_AGENT_USER_MARKER_META    = '_desktop_mode_agent';
const DESKTOP_MODE_AGENT_USER_GUIDELINE_META = '_desktop_mode_agent_guideline_id';

/**
 * Whether the given user is a Desktop Mode agent.
 *
 * @since 0.23.0
 *
 * @param int|WP_User|null $user User id or object.
 * @return bool
 */
function desktop_mode_agent_is_agent( $user ) {
	$user_id = $user instanceof WP_User ? $user->ID : (int) $user;
	if ( $user_id <= 0 ) {
		return false;
	}
	return '1' === (string) get_user_meta( $user_id, DESKTOP_MODE_AGENT_USER_MARKER_META, true );
}

/**
 * Resolve a unique `user_login` for an agent given its desired slug.
 *
 * Returns the input prefixed with `agent-`, or appends a numeric suffix
 * if a user with that login already exists. Caller must already have
 * `sanitize_user( $slug, true )`'d the slug.
 *
 * @since 0.23.0
 *
 * @param string $slug Sanitized slug.
 * @return string
 */
function desktop_mode_agent_resolve_unique_login( $slug ) {
	$base    = 'agent-' . $slug;
	$login   = $base;
	$counter = 1;
	while ( username_exists( $login ) ) {
		++$counter;
		$login = $base . '-' . $counter;
	}
	return $login;
}

/**
 * Build a synthetic, RFC-shaped email for an agent.
 *
 * The address is never sent to — it just satisfies `wp_insert_user`'s
 * schema validation and reserves the slot so `email_exists()` stays
 * unique across agents.
 *
 * @since 0.23.0
 *
 * @param string $slug Sanitized agent slug.
 * @return string
 */
function desktop_mode_agent_synthetic_email( $slug ) {
	$host = wp_parse_url( home_url( '/' ), PHP_URL_HOST );
	if ( ! is_string( $host ) || '' === $host ) {
		$host = 'invalid.local';
	}
	$base    = $slug . '@agents.' . $host;
	$email   = $base;
	$counter = 1;
	while ( email_exists( $email ) ) {
		++$counter;
		$email = $slug . '+' . $counter . '@agents.' . $host;
	}
	return $email;
}

/**
 * Create a synthetic agent user.
 *
 * Returns the WP_User on success, WP_Error on failure. Caller is
 * responsible for creating the linked `wp_guideline` post and writing
 * the cross-link meta — see `desktop_mode_agent_link_guideline()`.
 *
 * @since 0.23.0
 *
 * @param array{name:string, role:string, slug?:string} $args Agent
 *        creation args. `role` MUST be one of the site's registered
 *        roles. `slug` defaults to `sanitize_title( $name )`.
 * @return WP_User|WP_Error
 */
function desktop_mode_agent_create_user( $args ) {
	$name = isset( $args['name'] ) ? trim( (string) $args['name'] ) : '';
	$role = isset( $args['role'] ) ? sanitize_key( $args['role'] ) : '';
	$slug = isset( $args['slug'] ) ? sanitize_title( $args['slug'] ) : '';

	if ( '' === $name ) {
		return new WP_Error(
			'desktop_mode_agent_invalid_name',
			__( 'Agent name is required.', 'desktop-mode' )
		);
	}

	$roles = wp_roles()->get_names();
	if ( '' === $role || ! isset( $roles[ $role ] ) ) {
		return new WP_Error(
			'desktop_mode_agent_invalid_role',
			__( 'Pick a valid WordPress role for the agent.', 'desktop-mode' )
		);
	}

	if ( '' === $slug ) {
		$slug = sanitize_title( $name );
	}
	if ( '' === $slug ) {
		return new WP_Error(
			'desktop_mode_agent_invalid_slug',
			__( 'Agent slug could not be derived from the name.', 'desktop-mode' )
		);
	}

	$user_login = desktop_mode_agent_resolve_unique_login( $slug );
	$user_email = desktop_mode_agent_synthetic_email( $slug );

	$user_id = wp_insert_user(
		array(
			'user_login'    => $user_login,
			'user_email'    => $user_email,
			'user_pass'     => wp_generate_password( 64, true, true ),
			'display_name'  => $name,
			'nickname'      => $name,
			'first_name'    => $name,
			'role'          => $role,
			'show_admin_bar_front' => false,
		)
	);

	if ( is_wp_error( $user_id ) ) {
		return $user_id;
	}

	update_user_meta( $user_id, DESKTOP_MODE_AGENT_USER_MARKER_META, '1' );

	return new WP_User( $user_id );
}

/**
 * Link an agent user to its `wp_guideline` post (the behaviour layer).
 *
 * @since 0.23.0
 *
 * @param int $user_id      Agent user id.
 * @param int $guideline_id `wp_guideline.ID`.
 * @return void
 */
function desktop_mode_agent_link_guideline( $user_id, $guideline_id ) {
	update_user_meta( $user_id, DESKTOP_MODE_AGENT_USER_GUIDELINE_META, (int) $guideline_id );
}

/**
 * Delete an agent user and the linked `wp_guideline`.
 *
 * Always trashes the guideline first (so the cascade survives a partial
 * failure when `wp_delete_user` errors), then deletes the user with
 * `reassign = null` (no post-author reassignment — guideline is already
 * gone, agent shouldn't have other posts).
 *
 * @since 0.23.0
 *
 * @param int $user_id Agent user id.
 * @return true|WP_Error
 */
function desktop_mode_agent_delete( $user_id ) {
	if ( ! desktop_mode_agent_is_agent( $user_id ) ) {
		return new WP_Error(
			'desktop_mode_agent_not_an_agent',
			__( 'User is not a Desktop Mode agent.', 'desktop-mode' )
		);
	}

	$guideline_id = (int) get_user_meta( $user_id, DESKTOP_MODE_AGENT_USER_GUIDELINE_META, true );

	if ( $guideline_id > 0 ) {
		// Use force-delete so the row is gone, not just trashed —
		// agents are cheap to recreate and orphan guidelines confuse
		// the listing UX.
		wp_delete_post( $guideline_id, true );
	}

	if ( ! function_exists( 'wp_delete_user' ) ) {
		require_once ABSPATH . 'wp-admin/includes/user.php';
	}

	$deleted = wp_delete_user( $user_id );

	if ( ! $deleted ) {
		return new WP_Error(
			'desktop_mode_agent_delete_failed',
			__( 'Could not delete the agent user.', 'desktop-mode' )
		);
	}

	/**
	 * Fires after an agent is deleted.
	 *
	 * @since 0.23.0
	 *
	 * @param int $user_id      Agent user id (no longer exists when this fires).
	 * @param int $guideline_id Guideline post id (no longer exists when this fires).
	 */
	do_action( 'desktop_mode_agent_deleted', $user_id, $guideline_id );

	return true;
}

/**
 * Cascade-delete the guideline when an agent user is deleted through
 * any path (wp-admin Users list, wp-cli, REST `DELETE /wp/v2/users`).
 *
 * The dedicated `desktop_mode_agent_delete()` already handles the
 * cascade, but if an admin deletes the user via a non-Desktop-Mode
 * path the guideline would orphan otherwise.
 *
 * @since 0.23.0
 *
 * @param int $user_id User id about to be deleted.
 * @return void
 */
function desktop_mode_agent_cascade_pre_delete_user( $user_id ) {
	if ( ! desktop_mode_agent_is_agent( $user_id ) ) {
		return;
	}
	$guideline_id = (int) get_user_meta( $user_id, DESKTOP_MODE_AGENT_USER_GUIDELINE_META, true );
	if ( $guideline_id > 0 && get_post( $guideline_id ) instanceof WP_Post ) {
		wp_delete_post( $guideline_id, true );
	}
}
add_action( 'delete_user', 'desktop_mode_agent_cascade_pre_delete_user', 10, 1 );

/**
 * Block password authentication for agent users.
 *
 * Returns a `WP_Error` instead of the user object so wp-login.php
 * surfaces the message inline. No 404 / redirect tricks — the
 * authentication chain handles error rendering.
 *
 * @since 0.23.0
 *
 * @param WP_User|WP_Error|null $user     Current candidate from the chain.
 * @param string                $username Login string the user typed.
 * @param string                $password Password the user typed.
 * @return WP_User|WP_Error|null
 */
function desktop_mode_agent_block_authentication( $user, $username, $password ) {
	if ( $user instanceof WP_User && desktop_mode_agent_is_agent( $user ) ) {
		return new WP_Error(
			'desktop_mode_agent_login_blocked',
			__( 'This account is a Desktop Mode agent. Login is disabled.', 'desktop-mode' )
		);
	}
	return $user;
}
add_filter( 'authenticate', 'desktop_mode_agent_block_authentication', 30, 3 );

/**
 * Block password-reset emails for agent users.
 *
 * @since 0.23.0
 *
 * @param bool $allow   Whether to allow the reset.
 * @param int  $user_id Target user id.
 * @return bool
 */
function desktop_mode_agent_block_password_reset( $allow, $user_id ) {
	if ( desktop_mode_agent_is_agent( $user_id ) ) {
		return false;
	}
	return $allow;
}
add_filter( 'allow_password_reset', 'desktop_mode_agent_block_password_reset', 10, 2 );

/**
 * Bot SVG used as the agent avatar.
 *
 * Byte-identical to the SVG painted on the My WordPress entity tile
 * and inside the agent renderer so the visual motif is consistent
 * across every surface that shows an agent.
 *
 * Kept in a function rather than a constant so the closure-equivalent
 * `pre_get_avatar_data` filter can read it without re-encoding.
 *
 * @since 0.23.0
 *
 * @return string Data URI.
 */
function desktop_mode_agent_avatar_data_uri() {
	$svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#1d2327" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">'
		. '<circle cx="12" cy="3.25" r="0.95" fill="#1d2327"/>'
		. '<line x1="12" y1="4.25" x2="12" y2="7"/>'
		. '<rect x="4" y="7" width="16" height="12" rx="2.5"/>'
		. '<line x1="2" y1="12.5" x2="4" y2="12.5"/>'
		. '<line x1="20" y1="12.5" x2="22" y2="12.5"/>'
		. '<circle cx="9" cy="12" r="1.15" fill="#1d2327"/>'
		. '<circle cx="15" cy="12" r="1.15" fill="#1d2327"/>'
		. '<path d="M9.25 15.5 Q12 17 14.75 15.5"/>'
		. '</svg>';
	return 'data:image/svg+xml;base64,' . base64_encode( $svg );
}

/**
 * Substitute the bot glyph for agent avatars across the WP admin.
 *
 * @since 0.23.0
 *
 * @param array            $args        Args being assembled by `get_avatar_data()`.
 * @param int|string|WP_User|WP_Comment $id_or_email Identifier the caller passed.
 * @return array
 */
function desktop_mode_agent_avatar( $args, $id_or_email ) {
	$user_id = 0;
	if ( is_numeric( $id_or_email ) ) {
		$user_id = (int) $id_or_email;
	} elseif ( $id_or_email instanceof WP_User ) {
		$user_id = (int) $id_or_email->ID;
	} elseif ( $id_or_email instanceof WP_Comment ) {
		$user_id = (int) $id_or_email->user_id;
	} elseif ( is_string( $id_or_email ) ) {
		$user = get_user_by( 'email', $id_or_email );
		if ( $user ) {
			$user_id = (int) $user->ID;
		}
	}

	if ( $user_id > 0 && desktop_mode_agent_is_agent( $user_id ) ) {
		$args['url']          = desktop_mode_agent_avatar_data_uri();
		$args['found_avatar'] = true;
	}
	return $args;
}
add_filter( 'pre_get_avatar_data', 'desktop_mode_agent_avatar', 10, 2 );

/**
 * Add a "Type" column to the wp-admin Users list that labels agents.
 *
 * @since 0.23.0
 *
 * @param string[] $columns Existing column id => label map.
 * @return string[]
 */
function desktop_mode_agent_users_columns( $columns ) {
	$columns['desktop_mode_agent_type'] = __( 'Type', 'desktop-mode' );
	return $columns;
}
add_filter( 'manage_users_columns', 'desktop_mode_agent_users_columns' );

/**
 * Render the cell for the "Type" column.
 *
 * @since 0.23.0
 *
 * @param string $output      Existing rendered HTML.
 * @param string $column_name Column id.
 * @param int    $user_id     User id being rendered.
 * @return string
 */
function desktop_mode_agent_users_custom_column( $output, $column_name, $user_id ) {
	if ( 'desktop_mode_agent_type' !== $column_name ) {
		return $output;
	}
	if ( desktop_mode_agent_is_agent( $user_id ) ) {
		return '<span class="desktop-mode-agent-type" aria-label="' . esc_attr__( 'Desktop Mode agent', 'desktop-mode' ) . '">'
			. '<span class="dashicons dashicons-superhero" aria-hidden="true"></span> '
			. esc_html__( 'Agent', 'desktop-mode' )
			. '</span>';
	}
	return '<span class="desktop-mode-agent-type-human">' . esc_html__( 'Person', 'desktop-mode' ) . '</span>';
}
add_filter( 'manage_users_custom_column', 'desktop_mode_agent_users_custom_column', 10, 3 );
