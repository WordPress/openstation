<?php
/**
 * Desktop Mode — Native Users Window: REST mutation routes.
 *
 * Five endpoints under `desktop-mode/v1`:
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
 * Every route does TWO checks:
 *
 *   1. `permission_callback` — the broad cap gate (`promote_users`,
 *      `edit_users`, `delete_users` / `remove_users`). Stops a
 *      non-admin from even reaching the callback.
 *
 *   2. Per-target re-validation inside the callback:
 *        - bulk-role and create validate the requested role against
 *          the filtered `desktop_mode_users_window_assignable_roles()`
 *          list and reject any role outside it. What stops an Editor
 *          from forging a promote-to-Administrator request is the
 *          `promote_users` permission_callback — and, as defense in
 *          depth, the helper itself returns an empty array for
 *          viewers without `promote_users`.
 *        - bulk-delete checks `current_user_can( 'delete_user', $id )`
 *          per row. Multisite uses `remove_user_from_blog` instead.
 *        - mutation routes refuse self-targeting on operations that
 *          could lock the requester out (demote-self-from-admin,
 *          delete-self).
 *
 * @package WPDesktopMode
 * @since   0.8.1
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register the five routes.
 *
 * @since 0.8.1
 */
function desktop_mode_users_window_register_rest_routes() {
	register_rest_route(
		'desktop-mode/v1',
		'/users/bulk-role',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'callback'            => 'desktop_mode_users_window_rest_bulk_role',
			'permission_callback' => static function () {
				return current_user_can( 'promote_users' );
			},
			'args'                => array(
				'ids'  => array(
					'required' => true,
					'type'     => 'array',
					'items'    => array( 'type' => 'integer' ),
				),
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
			'callback'            => 'desktop_mode_users_window_rest_send_password_reset',
			'permission_callback' => static function () {
				return current_user_can( 'edit_users' );
			},
			'args'                => array(
				'id' => array(
					'required' => true,
					'type'     => 'integer',
				),
			),
		)
	);

	register_rest_route(
		'desktop-mode/v1',
		'/users/(?P<id>\d+)/resend-welcome',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'callback'            => 'desktop_mode_users_window_rest_resend_welcome',
			'permission_callback' => static function () {
				return current_user_can( 'edit_users' );
			},
			'args'                => array(
				'id' => array(
					'required' => true,
					'type'     => 'integer',
				),
			),
		)
	);

	register_rest_route(
		'desktop-mode/v1',
		'/users',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'callback'            => 'desktop_mode_users_window_rest_create',
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
			'callback'            => 'desktop_mode_users_window_rest_bulk_delete',
			'permission_callback' => static function () {
				return is_multisite()
					? current_user_can( 'remove_users' )
					: current_user_can( 'delete_users' );
			},
			'args'                => array(
				'ids'      => array(
					'required' => true,
					'type'     => 'array',
					'items'    => array( 'type' => 'integer' ),
				),
				'reassign' => array(
					'required' => false,
					'type'     => 'integer',
				),
			),
		)
	);
}
add_action( 'rest_api_init', 'desktop_mode_users_window_register_rest_routes' );

/**
 * `POST /users/bulk-role`
 *
 * Body: `{ ids: int[], role: string }`. Returns a per-id result map:
 * `{ <id>: { ok: bool, error?: string } }`. Partial success is the
 * norm — a request to promote five users where the requester can
 * edit four of them succeeds for those four and reports `forbidden`
 * for the fifth.
 *
 * @since 0.8.1
 *
 * @param WP_REST_Request $req
 * @return WP_REST_Response|WP_Error
 */
function desktop_mode_users_window_rest_bulk_role( $req ) {
	$ids  = array_values(
		array_filter(
			array_map( 'intval', (array) $req->get_param( 'ids' ) ),
			static function ( $id ) {
				return $id > 0;
			}
		)
	);
	$role = sanitize_key( (string) $req->get_param( 'role' ) );

	if ( empty( $ids ) ) {
		return new WP_Error(
			'desktop_mode_users_no_ids',
			__( 'No user ids supplied.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}

	// Cap to a sane upper bound so a runaway client can't flood
	// `wp_update_user` calls in one request.
	$ids = array_slice( $ids, 0, 100 );

	$viewer_id = (int) get_current_user_id();
	$assignable = desktop_mode_users_window_assignable_roles( $viewer_id );
	if ( ! in_array( $role, $assignable, true ) ) {
		return new WP_Error(
			'desktop_mode_users_role_forbidden',
			__( 'You are not allowed to assign this role.', 'desktop-mode' ),
			array( 'status' => 403 )
		);
	}

	$results = array();
	foreach ( $ids as $id ) {
		$id = (int) $id;
		// Per-target permission. `edit_user` already encapsulates the
		// "can the viewer manage this specific user?" check.
		if ( ! current_user_can( 'edit_user', $id ) ) {
			$results[ (string) $id ] = array(
				'ok'    => false,
				'error' => 'forbidden',
			);
			continue;
		}

		// Self-demotion guard: don't let the requester strip their
		// own admin role and lock themselves out. Match WP core's
		// behaviour in the classic users.php flow.
		if ( $id === $viewer_id ) {
			$existing = (array) ( get_userdata( $id )->roles ?? array() );
			$is_admin = in_array( 'administrator', $existing, true );
			if ( $is_admin && 'administrator' !== $role ) {
				$results[ (string) $id ] = array(
					'ok'    => false,
					'error' => 'self_demote',
				);
				continue;
			}
		}

		$user = get_userdata( $id );
		if ( ! $user instanceof WP_User ) {
			$results[ (string) $id ] = array(
				'ok'    => false,
				'error' => 'not_found',
			);
			continue;
		}

		// `set_role` replaces all roles with the single new one —
		// matches the classic users.php "Change role to…" semantics.
		$user->set_role( $role );

		$results[ (string) $id ] = array( 'ok' => true );
	}

	return rest_ensure_response(
		array(
			'role'    => $role,
			'results' => $results,
		)
	);
}

/**
 * `POST /users/<id>/send-password-reset`
 *
 * Triggers WP's standard password-reset email flow. We delegate to
 * core's `retrieve_password()` so the email format stays consistent
 * with the login screen's "Lost your password?" link.
 *
 * @since 0.8.1
 *
 * @param WP_REST_Request $req
 * @return WP_REST_Response|WP_Error
 */
function desktop_mode_users_window_rest_send_password_reset( $req ) {
	$id   = (int) $req->get_param( 'id' );
	$user = $id > 0 ? get_userdata( $id ) : null;
	if ( ! $user instanceof WP_User ) {
		return new WP_Error(
			'desktop_mode_users_not_found',
			__( 'User not found.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}
	if ( ! current_user_can( 'edit_user', $id ) ) {
		return new WP_Error(
			'desktop_mode_users_forbidden',
			__( 'You are not allowed to send a password reset for this user.', 'desktop-mode' ),
			array( 'status' => 403 )
		);
	}

	// Lightweight throttle: at most one reset email per (requester,
	// target) pair per minute. Stops accidental double-clicks from
	// firing two emails AND closes a small abuse vector where an
	// admin bot account could spam reset emails to a victim.
	$throttle_key = sprintf(
		'_dm_pw_reset_throttle_%d_%d',
		(int) get_current_user_id(),
		$id
	);
	$last         = (int) get_transient( $throttle_key );
	if ( $last > 0 && ( time() - $last ) < 60 ) {
		return new WP_Error(
			'desktop_mode_users_throttled',
			__( 'A reset email was already sent recently. Try again in a minute.', 'desktop-mode' ),
			array( 'status' => 429 )
		);
	}
	set_transient( $throttle_key, time(), MINUTE_IN_SECONDS );

	// `retrieve_password( $login )` returns true on success or
	// WP_Error on mailer/db failure. It also fires the standard
	// `retrieve_password` action so plugins (audit logs, 2FA flows)
	// see this as a normal reset-request event.
	$result = retrieve_password( $user->user_login );
	if ( is_wp_error( $result ) ) {
		return $result;
	}

	return rest_ensure_response(
		array(
			'ok'    => true,
			'email' => $user->user_email,
		)
	);
}

/**
 * `POST /users/<id>/resend-welcome`
 *
 * Re-sends the new-user notification email. Useful for users who
 * never opened the original (filtered to spam, typo'd address that's
 * since been corrected, …).
 *
 * @since 0.8.1
 *
 * @param WP_REST_Request $req
 * @return WP_REST_Response|WP_Error
 */
function desktop_mode_users_window_rest_resend_welcome( $req ) {
	$id   = (int) $req->get_param( 'id' );
	$user = $id > 0 ? get_userdata( $id ) : null;
	if ( ! $user instanceof WP_User ) {
		return new WP_Error(
			'desktop_mode_users_not_found',
			__( 'User not found.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}
	if ( ! current_user_can( 'edit_user', $id ) ) {
		return new WP_Error(
			'desktop_mode_users_forbidden',
			__( 'You are not allowed to email this user.', 'desktop-mode' ),
			array( 'status' => 403 )
		);
	}

	// Same throttle as the password-reset route — stops repeated
	// "Resend" clicks from spamming the mailer.
	$throttle_key = sprintf(
		'_dm_welcome_throttle_%d_%d',
		(int) get_current_user_id(),
		$id
	);
	$last         = (int) get_transient( $throttle_key );
	if ( $last > 0 && ( time() - $last ) < 60 ) {
		return new WP_Error(
			'desktop_mode_users_throttled',
			__( 'A welcome email was already sent recently. Try again in a minute.', 'desktop-mode' ),
			array( 'status' => 429 )
		);
	}
	set_transient( $throttle_key, time(), MINUTE_IN_SECONDS );

	// Notify only the user; pass an empty password placeholder so
	// core sends the user-facing welcome variant. The user keeps
	// their existing credentials — this resends the WELCOME email,
	// not a password.
	wp_new_user_notification( $id, null, 'user' );

	return rest_ensure_response(
		array(
			'ok'    => true,
			'email' => $user->user_email,
		)
	);
}

/**
 * `POST /users/bulk-delete`
 *
 * Single-site: hard-deletes the user account, optionally
 * reassigning their content to `reassign`.
 * Multisite: removes the user from the current site (network user
 * record stays). Per-target re-validation either way.
 *
 * @since 0.8.1
 *
 * @param WP_REST_Request $req
 * @return WP_REST_Response|WP_Error
 */
function desktop_mode_users_window_rest_bulk_delete( $req ) {
	$ids       = array_values(
		array_filter(
			array_map( 'intval', (array) $req->get_param( 'ids' ) ),
			static function ( $id ) {
				return $id > 0;
			}
		)
	);
	$reassign  = (int) $req->get_param( 'reassign' );
	$viewer_id = (int) get_current_user_id();

	if ( empty( $ids ) ) {
		return new WP_Error(
			'desktop_mode_users_no_ids',
			__( 'No user ids supplied.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}
	$ids = array_slice( $ids, 0, 100 );

	if ( ! function_exists( 'wp_delete_user' ) ) {
		require_once ABSPATH . 'wp-admin/includes/user.php';
	}

	$results = array();
	foreach ( $ids as $id ) {
		$id = (int) $id;

		// Self-delete guard — same posture as core's classic users.php.
		if ( $id === $viewer_id ) {
			$results[ (string) $id ] = array(
				'ok'    => false,
				'error' => 'self_delete',
			);
			continue;
		}

		if ( is_multisite() ) {
			if ( ! current_user_can( 'remove_user', $id ) ) {
				$results[ (string) $id ] = array(
					'ok'    => false,
					'error' => 'forbidden',
				);
				continue;
			}
			$ok = remove_user_from_blog( $id, get_current_blog_id(), $reassign > 0 ? $reassign : null );
			$results[ (string) $id ] = $ok && ! is_wp_error( $ok )
				? array( 'ok' => true )
				: array(
					'ok'    => false,
					'error' => 'remove_failed',
				);
			continue;
		}

		// Single-site path.
		if ( ! current_user_can( 'delete_user', $id ) ) {
			$results[ (string) $id ] = array(
				'ok'    => false,
				'error' => 'forbidden',
			);
			continue;
		}
		$ok = wp_delete_user( $id, $reassign > 0 ? $reassign : null );
		$results[ (string) $id ] = $ok
			? array( 'ok' => true )
			: array(
				'ok'    => false,
				'error' => 'delete_failed',
			);
	}

	return rest_ensure_response(
		array(
			'results' => $results,
		)
	);
}

/**
 * `POST /users` — create a new WordPress user.
 *
 * Mirrors the field set core gathers in `wp-admin/user-new.php`:
 * username (required), email (required), first/last name, website,
 * locale, password (auto-generated when omitted), role, and a
 * "send notification email" toggle.
 *
 * Capability gate: `create_users`. Per-target gates in addition:
 *
 *   - role (if supplied) must be in the requester's
 *     `editable_roles()` map. An Editor can't create an
 *     Administrator even with `create_users` granted.
 *   - the user must not already exist by username OR email.
 *   - inputs are sanitized through core's `sanitize_user`,
 *     `sanitize_email`, `esc_url_raw`, `sanitize_text_field`.
 *
 * On success returns `{ ok: true, user_id: int, email: string }`.
 * On failure returns the matching `WP_Error` (404/400/403/409
 * depending on cause).
 *
 * @since 0.8.1
 *
 * @param WP_REST_Request $req
 * @return WP_REST_Response|WP_Error
 */
function desktop_mode_users_window_rest_create( $req ) {
	$username = sanitize_user( (string) $req->get_param( 'username' ), true );
	$email    = sanitize_email( (string) $req->get_param( 'email' ) );
	$first    = sanitize_text_field( (string) $req->get_param( 'first_name' ) );
	$last     = sanitize_text_field( (string) $req->get_param( 'last_name' ) );
	$url      = esc_url_raw( (string) $req->get_param( 'url' ) );
	$locale   = (string) $req->get_param( 'locale' );
	$password = (string) $req->get_param( 'password' );
	$role     = sanitize_key( (string) $req->get_param( 'role' ) );
	$notify   = (bool) $req->get_param( 'send_notification' );

	if ( '' === $username ) {
		return new WP_Error(
			'desktop_mode_users_username_required',
			__( 'Username is required.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}
	if ( ! validate_username( $username ) ) {
		return new WP_Error(
			'desktop_mode_users_username_invalid',
			__( 'Username is not valid.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}
	if ( '' === $email || ! is_email( $email ) ) {
		return new WP_Error(
			'desktop_mode_users_email_invalid',
			__( 'A valid email address is required.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}
	if ( username_exists( $username ) ) {
		return new WP_Error(
			'desktop_mode_users_username_exists',
			__( 'That username is already in use.', 'desktop-mode' ),
			array( 'status' => 409 )
		);
	}
	if ( email_exists( $email ) ) {
		return new WP_Error(
			'desktop_mode_users_email_exists',
			__( 'That email is already in use.', 'desktop-mode' ),
			array( 'status' => 409 )
		);
	}

	// Role gate. Empty role → fall back to the site default. A
	// non-empty role MUST be in `editable_roles()` for the requester
	// — same protection as the bulk-role endpoint, applied at create
	// time so an Editor can't create an Administrator.
	if ( '' === $role ) {
		$role = (string) get_option( 'default_role', 'subscriber' );
	}
	$assignable = desktop_mode_users_window_assignable_roles( (int) get_current_user_id() );
	// `desktop_mode_users_window_assignable_roles` is gated on
	// `promote_users` — viewers with `create_users` but not
	// `promote_users` need a fallback. Allow them to assign the
	// default role only.
	if ( empty( $assignable ) ) {
		$assignable = array( (string) get_option( 'default_role', 'subscriber' ) );
	}
	if ( ! in_array( $role, $assignable, true ) ) {
		return new WP_Error(
			'desktop_mode_users_role_forbidden',
			__( 'You are not allowed to assign that role.', 'desktop-mode' ),
			array( 'status' => 403 )
		);
	}

	// Auto-generate a password when none supplied; matches core's
	// classic behaviour. The user can complete the password reset
	// via the email notification.
	if ( '' === $password ) {
		$password = wp_generate_password( 24, true, true );
	}

	$userdata = array(
		'user_login' => $username,
		'user_email' => $email,
		'user_pass'  => $password,
		'first_name' => $first,
		'last_name'  => $last,
		'user_url'   => $url,
		'role'       => $role,
	);

	$user_id = wp_insert_user( $userdata );
	if ( is_wp_error( $user_id ) ) {
		// Keep core's error code so the JS can map common cases
		// (`existing_user_login`, `existing_user_email`) to
		// localized messages.
		return $user_id;
	}

	// Locale (post-create — `wp_insert_user` doesn't take it).
	if ( '' !== $locale ) {
		$locale_slugs = array_keys( desktop_mode_users_window_locales_map() );
		if ( in_array( $locale, $locale_slugs, true ) ) {
			update_user_meta( (int) $user_id, 'locale', $locale );
		}
	}

	if ( $notify ) {
		// `'both'` — admin + user. Same flag classic users.php sets
		// when "Send the new user an email about their account" is
		// checked.
		wp_new_user_notification( (int) $user_id, null, 'both' );
	}

	/**
	 * Fires after the Users window has created a new account.
	 *
	 * @since 0.8.1
	 *
	 * @param int     $user_id
	 * @param WP_User $user    Wrapped user object.
	 * @param array   $args    Sanitized args used for creation.
	 */
	do_action(
		'desktop_mode_users_window_user_created',
		(int) $user_id,
		get_userdata( (int) $user_id ),
		$userdata
	);

	return rest_ensure_response(
		array(
			'ok'      => true,
			'user_id' => (int) $user_id,
			'email'   => $email,
		)
	);
}
