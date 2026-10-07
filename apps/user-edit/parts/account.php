<?php

defined( 'ABSPATH' ) || exit;

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

function openstation_user_edit_window_rest_permission( $req ) {
	return openstation_user_edit_window_can_edit( (int) get_current_user_id(), (int) $req->get_param( 'id' ) );
}

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

	delete_transient( 'dm_user_insights_' . $id );
	return rest_ensure_response( array( 'ok' => true ) );
}

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

function openstation_user_edit_window_rest_app_pw_list( $req ) {
	$id          = (int) $req->get_param( 'id' );
	$unavailable = openstation_user_edit_window_app_pw_unavailable( $id );
	if ( is_wp_error( $unavailable ) ) {
		return $unavailable;
	}
	return rest_ensure_response( array( 'items' => (array) WP_Application_Passwords::get_user_application_passwords( $id ) ) );
}

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
