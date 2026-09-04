<?php
/**
 * User Edit app — the account routes and the personal-options meta.
 *
 *   - `register_meta()` for the personal options and the contact
 *     methods, with `show_in_rest`, so the profile form saves them
 *     through core's `PUT /wp/v2/users/<id>` `meta` field.
 *   - `POST /desktop-mode/v1/users/<id>/destroy-sessions` — log the
 *     user out elsewhere (or everywhere).
 *   - `GET|POST /desktop-mode/v1/users/<id>/application-passwords`
 *     and `DELETE …/application-passwords/<uuid>` — thin wrappers over
 *     `WP_Application_Passwords`.
 *
 * Every route re-checks `edit_user` on the target
 * ({@see openstation_user_edit_window_can_edit()}).
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register the personal-options user-meta keys and the contact
 * methods with `show_in_rest`. Without this the keys exist (core uses
 * them on the classic profile.php save) but the REST controller
 * silently drops `meta.rich_editing`, `meta.admin_color`, … on update.
 *
 * Runs on `rest_api_init`: this file loads DURING `init` @10, where
 * an `init` callback of the same priority can never fire (`WP_Hook`
 * snapshots the running priority), and REST is the only consumer.
 */
function openstation_user_edit_window_register_meta() {
	$keys = array(
		'rich_editing'         => 'string',
		'syntax_highlighting'  => 'string',
		'admin_color'          => 'string',
		'comment_shortcuts'    => 'string',
		'show_admin_bar_front' => 'string',
	);
	foreach ( array_keys( wp_get_user_contact_methods() ) as $method ) {
		$keys[ (string) $method ] = 'string';
	}
	foreach ( $keys as $meta_key => $type ) {
		register_meta(
			'user',
			$meta_key,
			array(
				'type'              => $type,
				'single'            => true,
				'show_in_rest'      => array(
					'schema' => array(
						'type'    => $type,
						'context' => array( 'view', 'edit' ),
					),
				),
				'auth_callback'     => static function ( $allowed, $meta_key2, $user_id ) {
					unset( $meta_key2 );
					return current_user_can( 'edit_user', (int) $user_id );
				},
				'sanitize_callback' => 'sanitize_text_field',
			)
		);
	}
}
add_action( 'rest_api_init', 'openstation_user_edit_window_register_meta', 5 );

/**
 * The `permission_callback` every account route shares.
 *
 * @param WP_REST_Request $req Request with `id`.
 * @return bool
 */
function openstation_user_edit_window_rest_permission( $req ) {
	return openstation_user_edit_window_can_edit( (int) get_current_user_id(), (int) $req->get_param( 'id' ) );
}

/**
 * Register the sessions and application-password routes.
 */
function openstation_user_edit_window_account_routes() {
	register_rest_route(
		'desktop-mode/v1',
		'/users/(?P<id>\d+)/destroy-sessions',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'callback'            => 'openstation_user_edit_window_rest_destroy_sessions',
			'permission_callback' => 'openstation_user_edit_window_rest_permission',
			'args'                => array(
				'id'    => array(
					'required' => true,
					'type'     => 'integer',
				),
				'scope' => array(
					'type'    => 'string',
					'default' => 'others',
				),
			),
		)
	);
	register_rest_route(
		'desktop-mode/v1',
		'/users/(?P<id>\d+)/application-passwords',
		array(
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => 'openstation_user_edit_window_rest_app_pw_list',
				'permission_callback' => 'openstation_user_edit_window_rest_permission',
			),
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => 'openstation_user_edit_window_rest_app_pw_create',
				'permission_callback' => 'openstation_user_edit_window_rest_permission',
				'args'                => array(
					'name' => array(
						'required' => true,
						'type'     => 'string',
					),
				),
			),
		)
	);
	register_rest_route(
		'desktop-mode/v1',
		'/users/(?P<id>\d+)/application-passwords/(?P<uuid>[a-f0-9-]+)',
		array(
			'methods'             => WP_REST_Server::DELETABLE,
			'callback'            => 'openstation_user_edit_window_rest_app_pw_revoke',
			'permission_callback' => 'openstation_user_edit_window_rest_permission',
		)
	);
}
add_action( 'rest_api_init', 'openstation_user_edit_window_account_routes' );

/**
 * `POST /users/<id>/destroy-sessions`. Editing another user, or self
 * with `scope=all`, destroys every session (the latter logs the
 * requester out); self with the default scope spares this device.
 *
 * @param WP_REST_Request $req Request with `id` and optional `scope`.
 * @return WP_REST_Response|WP_Error
 */
function openstation_user_edit_window_rest_destroy_sessions( $req ) {
	$id    = (int) $req->get_param( 'id' );
	$scope = (string) $req->get_param( 'scope' );
	if ( ! class_exists( 'WP_Session_Tokens' ) ) {
		return new WP_Error( 'openstation_users_no_sessions', __( 'Session manager unavailable.', 'desktop-mode' ), array( 'status' => 500 ) );
	}
	$manager = WP_Session_Tokens::get_instance( $id );
	if ( 'all' === $scope || (int) get_current_user_id() !== $id ) {
		$manager->destroy_all();
	} else {
		$manager->destroy_others( wp_get_session_token() );
	}
	// The sessions count in the insights payload is stale now.
	delete_transient( 'dm_user_insights_' . $id );
	return rest_ensure_response( array( 'ok' => true ) );
}

/**
 * Core's application-password availability policy for a target user
 * — site-wide and per user, both filterable by security plugins.
 *
 * @param int $user_id Target user id.
 * @return WP_Error|null Error when unavailable, null when allowed.
 */
function openstation_user_edit_window_app_pw_unavailable( $user_id ) {
	if (
		! class_exists( 'WP_Application_Passwords' )
		|| ! function_exists( 'wp_is_application_passwords_available' )
		|| ! wp_is_application_passwords_available()
		|| ! wp_is_application_passwords_available_for_user( (int) $user_id )
	) {
		return new WP_Error(
			'openstation_users_app_pw_unavailable',
			__( 'Application passwords are not available for this user.', 'desktop-mode' ),
			array( 'status' => 501 )
		);
	}
	return null;
}

/**
 * `GET /users/<id>/application-passwords`.
 *
 * @param WP_REST_Request $req Request with `id`.
 * @return WP_REST_Response|WP_Error
 */
function openstation_user_edit_window_rest_app_pw_list( $req ) {
	$id          = (int) $req->get_param( 'id' );
	$unavailable = openstation_user_edit_window_app_pw_unavailable( $id );
	if ( is_wp_error( $unavailable ) ) {
		return $unavailable;
	}
	return rest_ensure_response( array( 'items' => (array) WP_Application_Passwords::get_user_application_passwords( $id ) ) );
}

/**
 * `POST /users/<id>/application-passwords`.
 *
 * @param WP_REST_Request $req Request with `id` and `name`.
 * @return WP_REST_Response|WP_Error
 */
function openstation_user_edit_window_rest_app_pw_create( $req ) {
	$id          = (int) $req->get_param( 'id' );
	$unavailable = openstation_user_edit_window_app_pw_unavailable( $id );
	if ( is_wp_error( $unavailable ) ) {
		return $unavailable;
	}
	$name = sanitize_text_field( (string) $req->get_param( 'name' ) );
	if ( '' === $name ) {
		return new WP_Error( 'openstation_users_app_pw_name_required', __( 'Application password name is required.', 'desktop-mode' ), array( 'status' => 400 ) );
	}
	$created = WP_Application_Passwords::create_new_application_password( $id, array( 'name' => $name ) );
	if ( is_wp_error( $created ) ) {
		return $created;
	}
	list( $unhashed_password, $item ) = $created;
	delete_transient( 'dm_user_insights_' . $id );
	return rest_ensure_response(
		array(
			'ok'       => true,
			'password' => $unhashed_password,
			'item'     => $item,
		)
	);
}

/**
 * `DELETE /users/<id>/application-passwords/<uuid>`.
 *
 * @param WP_REST_Request $req Request with `id` and `uuid`.
 * @return WP_REST_Response|WP_Error
 */
function openstation_user_edit_window_rest_app_pw_revoke( $req ) {
	$id          = (int) $req->get_param( 'id' );
	$unavailable = openstation_user_edit_window_app_pw_unavailable( $id );
	if ( is_wp_error( $unavailable ) ) {
		return $unavailable;
	}
	$ok = WP_Application_Passwords::delete_application_password( $id, (string) $req->get_param( 'uuid' ) );
	if ( is_wp_error( $ok ) ) {
		return $ok;
	}
	delete_transient( 'dm_user_insights_' . $id );
	return rest_ensure_response( array( 'ok' => true ) );
}
