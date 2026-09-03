<?php
/**
 * Users app — the mutations, and the REST routes that expose them.
 *
 * Five operations, each a plain function the app's actions call
 * directly and a `desktop-mode/v1` route wraps for other consumers:
 *
 *   - POST /users/bulk-role               { ids: int[], role: string }
 *   - POST /users/<id>/send-password-reset
 *   - POST /users/<id>/resend-welcome
 *   - POST /users                         { username, email, role?, … }
 *   - POST /users/bulk-delete             { ids: int[], reassign?: int }
 *
 * SECURITY POSTURE
 * ================
 *
 * Every path does TWO checks: the broad cap gate (`promote_users`,
 * `edit_users`, `create_users`, `delete_users` / `remove_users`) —
 * the route's `permission_callback`, the action's own check — and a
 * per-target re-validation inside the function: bulk-role and create
 * validate the requested role against the filtered
 * `openstation_users_window_assignable_roles()` list; bulk-delete
 * checks `delete_user` / `remove_user` per row; self-targeting is
 * refused on operations that could lock the requester out.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Positive integer ids out of a request value, capped so a runaway
 * client can't flood `wp_update_user` calls in one request.
 *
 * @param mixed $raw Anything a client sent.
 * @return int[]
 */
function openstation_users_window_clean_ids( $raw ) {
	$ids = array_values(
		array_filter(
			array_map( 'intval', (array) $raw ),
			static function ( $id ) {
				return $id > 0;
			}
		)
	);
	return array_slice( $ids, 0, 100 );
}

/**
 * Set one role on every id the viewer may edit.
 *
 * Partial success is the norm — a request to promote five users
 * where the requester can edit four of them succeeds for those four
 * and reports `forbidden` for the fifth.
 *
 * @param int[]  $ids  Target user ids.
 * @param string $role Role slug.
 * @return array{role:string,results:array<string,array{ok:bool,error?:string}>}|WP_Error
 */
function openstation_users_window_apply_bulk_role( array $ids, $role ) {
	$ids  = openstation_users_window_clean_ids( $ids );
	$role = sanitize_key( (string) $role );
	if ( empty( $ids ) ) {
		return new WP_Error( 'openstation_users_no_ids', __( 'No user ids supplied.', 'desktop-mode' ), array( 'status' => 400 ) );
	}
	$viewer_id = (int) get_current_user_id();
	if ( ! in_array( $role, openstation_users_window_assignable_roles( $viewer_id ), true ) ) {
		return new WP_Error( 'openstation_users_role_forbidden', __( 'You are not allowed to assign this role.', 'desktop-mode' ), array( 'status' => 403 ) );
	}

	$results = array();
	foreach ( $ids as $id ) {
		// `edit_user` encapsulates "can the viewer manage this user?".
		if ( ! current_user_can( 'edit_user', $id ) ) {
			$results[ (string) $id ] = array(
				'ok'    => false,
				'error' => 'forbidden',
			);
			continue;
		}
		$user = get_userdata( $id );
		if ( ! $user instanceof WP_User ) {
			$results[ (string) $id ] = array(
				'ok'    => false,
				'error' => 'not_found',
			);
			continue;
		}
		// Self-demotion guard: don't let the requester strip their own
		// admin role and lock themselves out (core's users.php posture).
		if ( $id === $viewer_id && in_array( 'administrator', (array) $user->roles, true ) && 'administrator' !== $role ) {
			$results[ (string) $id ] = array(
				'ok'    => false,
				'error' => 'self_demote',
			);
			continue;
		}
		// `set_role` replaces all roles with the single new one —
		// the classic "Change role to…" semantics.
		$user->set_role( $role );
		$results[ (string) $id ] = array( 'ok' => true );
	}

	return array(
		'role'    => $role,
		'results' => $results,
	);
}

/**
 * The target of a per-user email operation, or the error saying why not.
 *
 * @param int    $id      Target user id.
 * @param string $message The 403 message.
 * @return WP_User|WP_Error
 */
function openstation_users_window_email_target( $id, $message ) {
	$id   = (int) $id;
	$user = $id > 0 ? get_userdata( $id ) : null;
	if ( ! $user instanceof WP_User ) {
		return new WP_Error( 'openstation_users_not_found', __( 'User not found.', 'desktop-mode' ), array( 'status' => 404 ) );
	}
	if ( ! current_user_can( 'edit_user', $id ) ) {
		return new WP_Error( 'openstation_users_forbidden', $message, array( 'status' => 403 ) );
	}
	return $user;
}

/**
 * At most one email per (requester, target) pair per minute — stops
 * accidental double-clicks from firing two emails AND closes a small
 * abuse vector where an admin bot account could spam a victim.
 *
 * @param string $kind    `pw_reset` | `welcome`.
 * @param int    $id      Target user id.
 * @param string $message The 429 message.
 * @return WP_Error|null
 */
function openstation_users_window_email_throttle( $kind, $id, $message ) {
	$key  = sprintf( '_dm_%s_throttle_%d_%d', $kind, (int) get_current_user_id(), (int) $id );
	$last = (int) get_transient( $key );
	if ( $last > 0 && ( time() - $last ) < 60 ) {
		return new WP_Error( 'openstation_users_throttled', $message, array( 'status' => 429 ) );
	}
	set_transient( $key, time(), MINUTE_IN_SECONDS );
	return null;
}

/**
 * Email a password-reset link — core's `retrieve_password()`, so the
 * email matches the login screen's "Lost your password?" flow.
 *
 * @param int $id Target user id.
 * @return array{ok:bool,email:string}|WP_Error
 */
function openstation_users_window_send_password_reset( $id ) {
	$user = openstation_users_window_email_target( $id, __( 'You are not allowed to send a password reset for this user.', 'desktop-mode' ) );
	if ( is_wp_error( $user ) ) {
		return $user;
	}
	$throttled = openstation_users_window_email_throttle( 'pw_reset', $id, __( 'A reset email was already sent recently. Try again in a minute.', 'desktop-mode' ) );
	if ( $throttled ) {
		return $throttled;
	}
	$result = retrieve_password( $user->user_login );
	if ( is_wp_error( $result ) ) {
		return $result;
	}
	return array(
		'ok'    => true,
		'email' => $user->user_email,
	);
}

/**
 * Re-send the new-user notification email (the user keeps their
 * credentials — this resends the WELCOME email, not a password).
 *
 * @param int $id Target user id.
 * @return array{ok:bool,email:string}|WP_Error
 */
function openstation_users_window_resend_welcome( $id ) {
	$user = openstation_users_window_email_target( $id, __( 'You are not allowed to email this user.', 'desktop-mode' ) );
	if ( is_wp_error( $user ) ) {
		return $user;
	}
	$throttled = openstation_users_window_email_throttle( 'welcome', $id, __( 'A welcome email was already sent recently. Try again in a minute.', 'desktop-mode' ) );
	if ( $throttled ) {
		return $throttled;
	}
	wp_new_user_notification( (int) $id, null, 'user' );
	return array(
		'ok'    => true,
		'email' => $user->user_email,
	);
}

/**
 * Delete (single-site) or remove from the current site (multisite)
 * every id the viewer may, optionally reassigning content.
 *
 * @param int[] $ids      Target user ids.
 * @param int   $reassign User id to reassign content to, 0 for none.
 * @return array{results:array<string,array{ok:bool,error?:string}>}|WP_Error
 */
function openstation_users_window_apply_bulk_delete( array $ids, $reassign = 0 ) {
	$ids       = openstation_users_window_clean_ids( $ids );
	$reassign  = (int) $reassign;
	$viewer_id = (int) get_current_user_id();
	if ( empty( $ids ) ) {
		return new WP_Error( 'openstation_users_no_ids', __( 'No user ids supplied.', 'desktop-mode' ), array( 'status' => 400 ) );
	}
	if ( ! function_exists( 'wp_delete_user' ) ) {
		require_once ABSPATH . 'wp-admin/includes/user.php';
	}

	$results = array();
	foreach ( $ids as $id ) {
		// Self-delete guard — same posture as core's classic users.php.
		if ( $id === $viewer_id ) {
			$results[ (string) $id ] = array(
				'ok'    => false,
				'error' => 'self_delete',
			);
			continue;
		}
		$multisite = is_multisite();
		if ( ! current_user_can( $multisite ? 'remove_user' : 'delete_user', $id ) ) {
			$results[ (string) $id ] = array(
				'ok'    => false,
				'error' => 'forbidden',
			);
			continue;
		}
		$ok = $multisite
			? remove_user_from_blog( $id, get_current_blog_id(), $reassign > 0 ? $reassign : null )
			: wp_delete_user( $id, $reassign > 0 ? $reassign : null );
		$results[ (string) $id ] = $ok && ! is_wp_error( $ok )
			? array( 'ok' => true )
			: array(
				'ok'    => false,
				'error' => $multisite ? 'remove_failed' : 'delete_failed',
			);
	}

	return array( 'results' => $results );
}

/**
 * Create a WordPress user from the Add User form's fields.
 *
 * Mirrors the field set core gathers in `wp-admin/user-new.php`.
 * Per-target gates in addition to `create_users`: the role must be
 * assignable by the requester (an Editor can't create an
 * Administrator); the user must not already exist by username OR
 * email; inputs go through core's sanitizers.
 *
 * @param array<string,mixed> $args `username`, `email`, `first_name`, `last_name`, `url`, `locale`, `password`, `role`, `send_notification`.
 * @return array{ok:bool,user_id:int,email:string}|WP_Error
 */
function openstation_users_window_create_user( array $args ) {
	$username = sanitize_user( (string) ( $args['username'] ?? '' ), true );
	$email    = sanitize_email( (string) ( $args['email'] ?? '' ) );
	$locale   = (string) ( $args['locale'] ?? '' );
	$password = (string) ( $args['password'] ?? '' );
	$role     = sanitize_key( (string) ( $args['role'] ?? '' ) );
	$notify   = ! empty( $args['send_notification'] );

	if ( '' === $username ) {
		return new WP_Error( 'openstation_users_username_required', __( 'Username is required.', 'desktop-mode' ), array( 'status' => 400 ) );
	}
	if ( ! validate_username( $username ) ) {
		return new WP_Error( 'openstation_users_username_invalid', __( 'Username is not valid.', 'desktop-mode' ), array( 'status' => 400 ) );
	}
	if ( '' === $email || ! is_email( $email ) ) {
		return new WP_Error( 'openstation_users_email_invalid', __( 'A valid email address is required.', 'desktop-mode' ), array( 'status' => 400 ) );
	}
	if ( username_exists( $username ) ) {
		return new WP_Error( 'openstation_users_username_exists', __( 'That username is already in use.', 'desktop-mode' ), array( 'status' => 409 ) );
	}
	if ( email_exists( $email ) ) {
		return new WP_Error( 'openstation_users_email_exists', __( 'That email is already in use.', 'desktop-mode' ), array( 'status' => 409 ) );
	}

	// Role gate. Empty role → the site default. A non-empty role MUST
	// be assignable by the requester. Viewers with `create_users` but
	// not `promote_users` may assign the default role only.
	$default_role = (string) get_option( 'default_role', 'subscriber' );
	if ( '' === $role ) {
		$role = $default_role;
	}
	$assignable = openstation_users_window_assignable_roles( (int) get_current_user_id() );
	if ( empty( $assignable ) ) {
		$assignable = array( $default_role );
	}
	if ( ! in_array( $role, $assignable, true ) ) {
		return new WP_Error( 'openstation_users_role_forbidden', __( 'You are not allowed to assign that role.', 'desktop-mode' ), array( 'status' => 403 ) );
	}

	$userdata = array(
		'user_login' => $username,
		'user_email' => $email,
		'user_pass'  => '' === $password ? wp_generate_password( 24, true, true ) : $password,
		'first_name' => sanitize_text_field( (string) ( $args['first_name'] ?? '' ) ),
		'last_name'  => sanitize_text_field( (string) ( $args['last_name'] ?? '' ) ),
		'user_url'   => esc_url_raw( (string) ( $args['url'] ?? '' ) ),
		'role'       => $role,
	);

	$user_id = wp_insert_user( $userdata );
	if ( is_wp_error( $user_id ) ) {
		// Core's error code lets the client map `existing_user_login`
		// / `existing_user_email` to localized messages.
		return $user_id;
	}

	// Locale (post-create — `wp_insert_user` doesn't take it).
	if ( '' !== $locale && in_array( $locale, array_keys( openstation_users_window_locales_map() ), true ) ) {
		update_user_meta( (int) $user_id, 'locale', $locale );
	}
	if ( $notify ) {
		// `'both'` — admin + user, the flag classic users.php sets when
		// "Send the new user an email about their account" is checked.
		wp_new_user_notification( (int) $user_id, null, 'both' );
	}

	/**
	 * Fires after the Users window has created a new account.
	 *
	 * @param int     $user_id
	 * @param WP_User $user    Wrapped user object.
	 * @param array   $args    Sanitized args used for creation.
	 */
	do_action( 'openstation_users_window_user_created', (int) $user_id, get_userdata( (int) $user_id ), $userdata );

	return array(
		'ok'      => true,
		'user_id' => (int) $user_id,
		'email'   => $email,
	);
}

// --------------------------------------------------------------- routes

/**
 * Register the five routes.
 */
function openstation_users_window_register_rest_routes() {
	$id_arg = array(
		'id' => array(
			'required' => true,
			'type'     => 'integer',
		),
	);
	$ids    = array(
		'required' => true,
		'type'     => 'array',
		'items'    => array( 'type' => 'integer' ),
	);

	register_rest_route(
		'desktop-mode/v1',
		'/users/bulk-role',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'callback'            => 'openstation_users_window_rest_bulk_role',
			'permission_callback' => static function () {
				return current_user_can( 'promote_users' );
			},
			'args'                => array(
				'ids'  => $ids,
				'role' => array(
					'required' => true,
					'type'     => 'string',
				),
			),
		)
	);
	register_rest_route(
		'desktop-mode/v1',
		'/users/(?P<id>\d+)/send-password-reset',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'callback'            => 'openstation_users_window_rest_send_password_reset',
			'permission_callback' => static function () {
				return current_user_can( 'edit_users' );
			},
			'args'                => $id_arg,
		)
	);
	register_rest_route(
		'desktop-mode/v1',
		'/users/(?P<id>\d+)/resend-welcome',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'callback'            => 'openstation_users_window_rest_resend_welcome',
			'permission_callback' => static function () {
				return current_user_can( 'edit_users' );
			},
			'args'                => $id_arg,
		)
	);
	register_rest_route(
		'desktop-mode/v1',
		'/users',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'callback'            => 'openstation_users_window_rest_create',
			'permission_callback' => static function () {
				return current_user_can( 'create_users' );
			},
			'args'                => array(
				'username'          => array(
					'required' => true,
					'type'     => 'string',
				),
				'email'             => array(
					'required' => true,
					'type'     => 'string',
				),
				'first_name'        => array( 'type' => 'string' ),
				'last_name'         => array( 'type' => 'string' ),
				'url'               => array( 'type' => 'string' ),
				'locale'            => array( 'type' => 'string' ),
				'password'          => array( 'type' => 'string' ),
				'role'              => array( 'type' => 'string' ),
				'send_notification' => array( 'type' => 'boolean' ),
			),
		)
	);
	register_rest_route(
		'desktop-mode/v1',
		'/users/bulk-delete',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'callback'            => 'openstation_users_window_rest_bulk_delete',
			'permission_callback' => static function () {
				return is_multisite() ? current_user_can( 'remove_users' ) : current_user_can( 'delete_users' );
			},
			'args'                => array(
				'ids'      => $ids,
				'reassign' => array(
					'required' => false,
					'type'     => 'integer',
				),
			),
		)
	);
}
add_action( 'rest_api_init', 'openstation_users_window_register_rest_routes' );

/**
 * `POST /users/bulk-role`.
 *
 * @param WP_REST_Request $req Request.
 * @return WP_REST_Response|WP_Error
 */
function openstation_users_window_rest_bulk_role( $req ) {
	$result = openstation_users_window_apply_bulk_role( (array) $req->get_param( 'ids' ), (string) $req->get_param( 'role' ) );
	return is_wp_error( $result ) ? $result : rest_ensure_response( $result );
}

/**
 * `POST /users/<id>/send-password-reset`.
 *
 * @param WP_REST_Request $req Request.
 * @return WP_REST_Response|WP_Error
 */
function openstation_users_window_rest_send_password_reset( $req ) {
	$result = openstation_users_window_send_password_reset( (int) $req->get_param( 'id' ) );
	return is_wp_error( $result ) ? $result : rest_ensure_response( $result );
}

/**
 * `POST /users/<id>/resend-welcome`.
 *
 * @param WP_REST_Request $req Request.
 * @return WP_REST_Response|WP_Error
 */
function openstation_users_window_rest_resend_welcome( $req ) {
	$result = openstation_users_window_resend_welcome( (int) $req->get_param( 'id' ) );
	return is_wp_error( $result ) ? $result : rest_ensure_response( $result );
}

/**
 * `POST /users/bulk-delete`.
 *
 * @param WP_REST_Request $req Request.
 * @return WP_REST_Response|WP_Error
 */
function openstation_users_window_rest_bulk_delete( $req ) {
	$result = openstation_users_window_apply_bulk_delete( (array) $req->get_param( 'ids' ), (int) $req->get_param( 'reassign' ) );
	return is_wp_error( $result ) ? $result : rest_ensure_response( $result );
}

/**
 * `POST /users` — create a new WordPress user.
 *
 * @param WP_REST_Request $req Request.
 * @return WP_REST_Response|WP_Error
 */
function openstation_users_window_rest_create( $req ) {
	$args = array();
	foreach ( array( 'username', 'email', 'first_name', 'last_name', 'url', 'locale', 'password', 'role', 'send_notification' ) as $key ) {
		$args[ $key ] = $req->get_param( $key );
	}
	$result = openstation_users_window_create_user( $args );
	return is_wp_error( $result ) ? $result : rest_ensure_response( $result );
}
