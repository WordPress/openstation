<?php
/**
 * Desktop Mode — Agents: identity layer (synthetic WordPress users).
 *
 * Each agent has a real row in `wp_users` so capability checks, edit
 * locks, comment attribution, and the standard WP audit trail work
 * without a parallel ACL. The row is "synthetic" only in that every
 * login path is blocked — the agent never authenticates; it is
 * invoked on the site's behalf.
 *
 * Blocked paths: the `authenticate` filter rejects password attempts
 * (covers wp-login.php and XML-RPC), `allow_password_reset` rejects
 * reset emails, application passwords are unavailable for agents, and
 * profile-change notification emails are suppressed. The wp-admin
 * Users list gains a "Type" column so administrators can tell
 * synthetic accounts apart.
 *
 * Meta constants live in store.php; this file owns the user row.
 *
 * @package WPDesktopMode
 */

defined( 'ABSPATH' ) || exit;

/**
 * Whether the given user is a Desktop Mode agent.
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
 * if a user with that login already exists.
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
 * @param string $slug Sanitized agent slug.
 * @return string
 */
function desktop_mode_agent_synthetic_email( $slug ) {
	$host = wp_parse_url( home_url( '/' ), PHP_URL_HOST );
	if ( ! is_string( $host ) || '' === $host ) {
		$host = 'invalid.local';
	}
	$email   = $slug . '@agents.' . $host;
	$counter = 1;
	while ( email_exists( $email ) ) {
		++$counter;
		$email = $slug . '+' . $counter . '@agents.' . $host;
	}
	return $email;
}

/**
 * Create a synthetic agent user row. Definition meta is written by the
 * `desktop_mode_agent_create()` orchestrator in store.php — call that,
 * not this, unless you only need the bare row.
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

	$user_id = wp_insert_user(
		array(
			'user_login'           => desktop_mode_agent_resolve_unique_login( $slug ),
			'user_email'           => desktop_mode_agent_synthetic_email( $slug ),
			'user_pass'            => wp_generate_password( 64, true, true ),
			'display_name'         => $name,
			'nickname'             => $name,
			'role'                 => $role,
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
 * Delete an agent user. Definition meta rows die with the user
 * (`wp_delete_user()` removes all usermeta). Content the agent
 * authored is NOT reassigned — pass a reassign id when the caller
 * wants to keep it.
 *
 * @param int      $user_id  Agent user id.
 * @param int|null $reassign Optional user id to reassign authored content to.
 * @return true|WP_Error
 */
function desktop_mode_agent_delete( $user_id, $reassign = null ) {
	if ( ! desktop_mode_agent_is_agent( $user_id ) ) {
		return new WP_Error(
			'desktop_mode_agent_not_an_agent',
			__( 'User is not a Desktop Mode agent.', 'desktop-mode' )
		);
	}

	if ( ! function_exists( 'wp_delete_user' ) ) {
		require_once ABSPATH . 'wp-admin/includes/user.php';
	}

	$deleted = wp_delete_user( (int) $user_id, $reassign );
	if ( ! $deleted ) {
		return new WP_Error(
			'desktop_mode_agent_delete_failed',
			__( 'Could not delete the agent user.', 'desktop-mode' )
		);
	}

	/**
	 * Fires after an agent is deleted.
	 *
	 * @param int $user_id  Agent user id (row no longer exists when this fires).
	 * @param int $actor_id User who deleted the agent.
	 */
	do_action( 'desktop_mode_agent_deleted', (int) $user_id, get_current_user_id() );

	return true;
}

// ---------------------------------------------------------------------------
// Login blocks
// ---------------------------------------------------------------------------

/**
 * Block password authentication for agent users.
 *
 * Returns a `WP_Error` instead of the user object so wp-login.php
 * surfaces the message inline. Covers XML-RPC too — it authenticates
 * through the same filter chain.
 *
 * @param WP_User|WP_Error|null $user Current candidate from the chain.
 * @return WP_User|WP_Error|null
 */
function desktop_mode_agent_block_authentication( $user ) {
	if ( $user instanceof WP_User && desktop_mode_agent_is_agent( $user ) ) {
		return new WP_Error(
			'desktop_mode_agent_login_blocked',
			__( 'This account is a Desktop Mode agent. Login is disabled.', 'desktop-mode' )
		);
	}
	return $user;
}
add_filter( 'authenticate', 'desktop_mode_agent_block_authentication', 30 );

/**
 * Block password-reset emails for agent users.
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
 * Application passwords are the one credential that could authenticate
 * a never-logs-in account over REST — refuse to make them available
 * for agents.
 *
 * @param bool    $available Whether application passwords are available.
 * @param WP_User $user      The user being checked.
 * @return bool
 */
function desktop_mode_agent_block_application_passwords( $available, $user ) {
	if ( $user instanceof WP_User && desktop_mode_agent_is_agent( $user ) ) {
		return false;
	}
	return $available;
}
add_filter( 'wp_is_application_passwords_available_for_user', 'desktop_mode_agent_block_application_passwords', 10, 2 );

/**
 * Suppress the password/email-changed notification emails for agents —
 * the synthetic address is never delivered to, and a bounced
 * notification per definition edit is pure noise in the mail log.
 *
 * @param bool  $send Whether to send the notification.
 * @param array $user The original user array before changes.
 * @return bool
 */
function desktop_mode_agent_suppress_change_emails( $send, $user ) {
	$user_id = is_array( $user ) && isset( $user['ID'] ) ? (int) $user['ID'] : 0;
	if ( $user_id > 0 && desktop_mode_agent_is_agent( $user_id ) ) {
		return false;
	}
	return $send;
}
add_filter( 'send_password_change_email', 'desktop_mode_agent_suppress_change_emails', 10, 2 );
add_filter( 'send_email_change_email', 'desktop_mode_agent_suppress_change_emails', 10, 2 );

// ---------------------------------------------------------------------------
// Identity surface
// ---------------------------------------------------------------------------

/**
 * Bot SVG used as the agent avatar.
 *
 * Byte-identical to the SVG painted on the My WordPress entity tile
 * and inside the agent renderer so the visual motif is consistent
 * across every surface that shows an agent.
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
	return 'data:image/svg+xml;base64,' . base64_encode( $svg ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode
}

/**
 * Substitute the bot glyph for agent avatars across the WP admin.
 *
 * @param array                         $args        Args being assembled by `get_avatar_data()`.
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
	} elseif ( is_string( $id_or_email ) && is_email( $id_or_email ) ) {
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
