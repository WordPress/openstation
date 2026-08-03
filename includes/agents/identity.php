<?php
/**
 * OpenStation — Agents: identity layer (synthetic WordPress users).
 *
 * Each agent has a real row in `wp_users` so capability checks, edit
 * locks, comment attribution, and the standard WP audit trail work
 * without a parallel ACL. The row is "synthetic" only in that every
 * login and session path is blocked — the agent never authenticates;
 * it is invoked on the site's behalf.
 *
 * Those blocks, and `openstation_agent_is_agent()` itself, live in
 * guard.php, which loads unconditionally. This file owns the row
 * lifecycle (create / delete) and the identity surface: the bot avatar
 * and the wp-admin Users list "Type" column, so administrators can
 * tell synthetic accounts apart.
 *
 * Definition meta constants live in store.php.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

require_once OPENSTATION_DIR . 'includes/agents/guard.php';

/**
 * Resolve a unique `user_login` for an agent given its desired slug.
 *
 * Returns the input prefixed with `agent-`, or appends a numeric suffix
 * if a user with that login already exists.
 *
 * @param string $slug Sanitized slug.
 * @return string
 */
function openstation_agent_resolve_unique_login( $slug ) {
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
function openstation_agent_synthetic_email( $slug ) {
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
 * `openstation_agent_create()` orchestrator in store.php — call that,
 * not this, unless you only need the bare row.
 *
 * @param array{name:string, role:string, slug?:string} $args Agent
 *        creation args. `role` MUST be one of the site's registered
 *        roles. `slug` defaults to `sanitize_title( $name )`.
 * @return WP_User|WP_Error
 */
function openstation_agent_create_user( $args ) {
	$name = isset( $args['name'] ) ? trim( (string) $args['name'] ) : '';
	$role = isset( $args['role'] ) ? sanitize_key( $args['role'] ) : '';
	$slug = isset( $args['slug'] ) ? sanitize_title( $args['slug'] ) : '';

	if ( '' === $name ) {
		return new WP_Error(
			'openstation_agent_invalid_name',
			__( 'Agent name is required.', 'desktop-mode' )
		);
	}

	$roles = wp_roles()->get_names();
	if ( '' === $role || ! isset( $roles[ $role ] ) ) {
		return new WP_Error(
			'openstation_agent_invalid_role',
			__( 'Pick a valid WordPress role for the agent.', 'desktop-mode' )
		);
	}

	if ( '' === $slug ) {
		$slug = sanitize_title( $name );
	}
	if ( '' === $slug ) {
		return new WP_Error(
			'openstation_agent_invalid_slug',
			__( 'Agent slug could not be derived from the name.', 'desktop-mode' )
		);
	}

	$user_id = wp_insert_user(
		array(
			'user_login'           => openstation_agent_resolve_unique_login( $slug ),
			'user_email'           => openstation_agent_synthetic_email( $slug ),
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

	update_user_meta( $user_id, OPENSTATION_AGENT_USER_MARKER_META, '1' );

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
function openstation_agent_delete( $user_id, $reassign = null ) {
	if ( ! openstation_agent_is_agent( $user_id ) ) {
		return new WP_Error(
			'openstation_agent_not_an_agent',
			__( 'User is not a OpenStation agent.', 'desktop-mode' )
		);
	}

	if ( ! function_exists( 'wp_delete_user' ) ) {
		require_once ABSPATH . 'wp-admin/includes/user.php';
	}

	$deleted = wp_delete_user( (int) $user_id, $reassign );
	if ( ! $deleted ) {
		return new WP_Error(
			'openstation_agent_delete_failed',
			__( 'Could not delete the agent user.', 'desktop-mode' )
		);
	}

	/**
	 * Fires after an agent is deleted.
	 *
	 * @param int $user_id  Agent user id (row no longer exists when this fires).
	 * @param int $actor_id User who deleted the agent.
	 */
	do_action( 'openstation_agent_deleted', (int) $user_id, get_current_user_id() );

	return true;
}

// ---------------------------------------------------------------------------
// Identity surface
// ---------------------------------------------------------------------------

/**
 * URL of the bot avatar as a real static file.
 *
 * The avatar MUST be a file URL, not the data URI: consumers routinely
 * run avatar URLs through `esc_url()` (wp-admin's `get_avatar()`, the
 * desktop user-tile renderer), and `data` is not in
 * `wp_allowed_protocols()` — the data URI silently becomes an empty
 * string and the avatar renders broken.
 *
 * @return string
 */
function openstation_agent_avatar_url() {
	return OPENSTATION_URL . 'assets/images/agent-avatar.svg';
}

/**
 * Substitute the bot glyph for agent avatars across the WP admin.
 *
 * @param array                         $args        Args being assembled by `get_avatar_data()`.
 * @param int|string|WP_User|WP_Comment $id_or_email Identifier the caller passed.
 * @return array
 */
function openstation_agent_avatar( $args, $id_or_email ) {
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

	if ( $user_id > 0 && openstation_agent_is_agent( $user_id ) ) {
		$args['url']          = openstation_agent_avatar_url();
		$args['found_avatar'] = true;
	}
	return $args;
}
add_filter( 'pre_get_avatar_data', 'openstation_agent_avatar', 10, 2 );

/**
 * Add a "Type" column to the wp-admin Users list that labels agents.
 *
 * @param string[] $columns Existing column id => label map.
 * @return string[]
 */
function openstation_agent_users_columns( $columns ) {
	$columns['openstation_agent_type'] = __( 'Type', 'desktop-mode' );
	return $columns;
}
add_filter( 'manage_users_columns', 'openstation_agent_users_columns' );

/**
 * Render the cell for the "Type" column.
 *
 * @param string $output      Existing rendered HTML.
 * @param string $column_name Column id.
 * @param int    $user_id     User id being rendered.
 * @return string
 */
function openstation_agent_users_custom_column( $output, $column_name, $user_id ) {
	if ( 'openstation_agent_type' !== $column_name ) {
		return $output;
	}
	if ( openstation_agent_is_agent( $user_id ) ) {
		return '<span class="os-agent-type" aria-label="' . esc_attr__( 'OpenStation agent', 'desktop-mode' ) . '">'
			. '<span class="dashicons dashicons-superhero" aria-hidden="true"></span> '
			. esc_html__( 'Agent', 'desktop-mode' )
			. '</span>';
	}
	return '<span class="os-agent-type-human">' . esc_html__( 'Person', 'desktop-mode' ) . '</span>';
}
add_filter( 'manage_users_custom_column', 'openstation_agent_users_custom_column', 10, 3 );
