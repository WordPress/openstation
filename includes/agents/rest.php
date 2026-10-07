<?php

defined( 'ABSPATH' ) || exit;

function openstation_agents_register_rest_routes() {
	$namespace = 'desktop-mode/v1';

	register_rest_route(
		$namespace,
		'/agents',
		array(
			array(
				'methods'             => WP_REST_Server::READABLE,
				'permission_callback' => 'openstation_agents_rest_read_permission',
				'callback'            => 'openstation_agents_rest_list',
			),
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => 'openstation_agents_rest_write_permission',
				'callback'            => 'openstation_agents_rest_create',
				'args'                => array(
					'name'         => array(
						'type'              => 'string',
						'required'          => true,
						'sanitize_callback' => 'sanitize_text_field',
					),
					'role'         => array(
						'type'              => 'string',
						'required'          => true,
						'sanitize_callback' => 'sanitize_key',
					),
					'description'  => array(
						'type'              => 'string',
						'default'           => '',
						'sanitize_callback' => 'sanitize_text_field',
					),
					'instructions' => array(
						'type'    => 'string',
						'default' => '',
					),
					'abilities'    => array(
						'type'    => 'array',
						'default' => array(),
						'items'   => array( 'type' => 'string' ),
					),

					'triggers'     => array(
						'type'    => 'array',
						'default' => array(),
					),
					'vibes'        => array(
						'type'    => 'string',
						'default' => '',
					),

					'face'         => array(
						'type'    => 'object',
						'default' => null,
					),
					'faceSeed'     => array(
						'type'              => 'integer',
						'default'           => 0,
						'sanitize_callback' => 'absint',
					),
				),
			),
		)
	);

	register_rest_route(
		$namespace,
		'/agents/abilities',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'permission_callback' => 'openstation_agents_rest_read_permission',
			'callback'            => 'openstation_agents_rest_abilities_catalogue',
		)
	);

	register_rest_route(
		$namespace,
		'/agents/draft',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'permission_callback' => 'openstation_agents_rest_write_permission',
			'callback'            => 'openstation_agents_rest_draft',
			'args'                => array(
				'brief' => array(
					'type'              => 'string',
					'required'          => true,
					'sanitize_callback' => 'sanitize_textarea_field',
					'validate_callback' => 'openstation_agents_rest_validate_brief',
				),
			),
		)
	);

	register_rest_route(
		$namespace,
		'/agents/trigger-kinds',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'permission_callback' => 'openstation_agents_rest_read_permission',
			'callback'            => 'openstation_agents_rest_trigger_kinds',
		)
	);

	register_rest_route(
		$namespace,
		'/agents/hooks-catalogue',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'permission_callback' => 'openstation_agents_rest_read_permission',
			'callback'            => 'openstation_agents_rest_hooks_catalogue',
		)
	);

	register_rest_route(
		$namespace,
		'/agents/roles',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'permission_callback' => 'openstation_agents_rest_write_permission',
			'callback'            => 'openstation_agents_rest_roles',
		)
	);

	register_rest_route(
		$namespace,
		'/agents/(?P<id>\d+)',
		array(
			array(
				'methods'             => WP_REST_Server::READABLE,
				'permission_callback' => 'openstation_agents_rest_read_permission',
				'callback'            => 'openstation_agents_rest_get',
			),
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => 'openstation_agents_rest_write_permission',
				'callback'            => 'openstation_agents_rest_patch',
			),
			array(
				'methods'             => WP_REST_Server::DELETABLE,
				'permission_callback' => 'openstation_agents_rest_write_permission',
				'callback'            => 'openstation_agents_rest_delete',
			),
		)
	);

	register_rest_route(
		$namespace,
		'/agents/(?P<id>\d+)/invoke',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'permission_callback' => 'openstation_agents_rest_invoke_permission',
			'callback'            => 'openstation_agents_rest_invoke',
			'args'                => array(
				'async'     => array(
					'type'    => 'boolean',
					'default' => false,
				),
				'requestId' => array(
					'type'   => 'string',
					'format' => 'uuid',
				),
				'message'   => array(
					'type'              => 'string',
					'required'          => true,
					'sanitize_callback' => 'sanitize_textarea_field',
				),
				'source'    => array(
					'type'              => 'string',
					'default'           => 'chat',
					'enum'              => array( 'chat', 'drag', 'send-to' ),
					'sanitize_callback' => 'sanitize_key',
				),

				'history'   => array(
					'type'    => 'array',
					'default' => array(),
					'items'   => array(
						'type'       => 'object',
						'properties' => array(
							'role' => array(
								'type' => 'string',
								'enum' => array( 'user', 'agent' ),
							),
							'text' => array( 'type' => 'string' ),
						),
					),
				),
			),
		)
	);
}
add_action( 'rest_api_init', 'openstation_agents_register_rest_routes' );

function openstation_agents_rest_read_permission() {
	if ( ! is_user_logged_in() || ! openstation_agents_user_can_read() ) {
		return new WP_Error(
			'openstation_agents_forbidden',
			__( 'You do not have permission to read OpenStation agents.', 'desktop-mode' ),
			array( 'status' => rest_authorization_required_code() )
		);
	}
	return true;
}

function openstation_agents_rest_write_permission() {
	if ( ! is_user_logged_in() || ! openstation_agents_user_can_manage() ) {
		return new WP_Error(
			'openstation_agents_forbidden',
			__( 'You do not have permission to manage OpenStation agents.', 'desktop-mode' ),
			array( 'status' => rest_authorization_required_code() )
		);
	}
	return true;
}

function openstation_agents_rest_invoke_permission() {
	if ( ! is_user_logged_in() || ! openstation_agents_user_can_invoke() ) {
		return new WP_Error(
			'openstation_agents_forbidden',
			__( 'You do not have permission to invoke OpenStation agents.', 'desktop-mode' ),
			array( 'status' => rest_authorization_required_code() )
		);
	}
	return true;
}

function openstation_agents_rest_list() {
	$out = array();
	foreach ( openstation_agent_get_agents() as $user ) {
		$shape = openstation_agents_rest_shape_user( $user );
		if ( $shape ) {
			$out[] = $shape;
		}
	}
	$response = rest_ensure_response( $out );

	$response->header( 'X-WP-Total', (string) count( $out ) );
	$response->header( 'X-WP-TotalPages', '1' );
	return $response;
}

function openstation_agents_rest_get( WP_REST_Request $request ) {
	$user = get_userdata( (int) $request['id'] );
	if ( ! $user || ! openstation_agent_is_agent( $user ) ) {
		return new WP_Error(
			'openstation_agents_not_found',
			__( 'Agent not found.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}
	return rest_ensure_response( openstation_agents_rest_shape_user( $user ) );
}

function openstation_agents_rest_create( WP_REST_Request $request ) {

	$user = openstation_agent_create(
		array(
			'name'         => (string) $request['name'],
			'role'         => (string) $request['role'],
			'description'  => (string) $request['description'],
			'instructions' => (string) $request['instructions'],
			'abilities'    => (array) $request['abilities'],
			'triggers'     => (array) $request['triggers'],
			'vibes'        => (string) $request['vibes'],
			'face'         => $request['face'],
			'faceSeed'     => (int) $request['faceSeed'],
		)
	);
	if ( is_wp_error( $user ) ) {
		$data = $user->get_error_data();
		if ( ! is_array( $data ) || ! isset( $data['status'] ) ) {
			$user->add_data( array( 'status' => 400 ) );
		}
		return $user;
	}

	$response = rest_ensure_response( openstation_agents_rest_shape_user( $user ) );
	$response->set_status( 201 );
	return $response;
}

function openstation_agents_rest_patch( WP_REST_Request $request ) {
	$user = get_userdata( (int) $request['id'] );
	if ( ! $user || ! openstation_agent_is_agent( $user ) ) {
		return new WP_Error(
			'openstation_agents_not_found',
			__( 'Agent not found.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}

	$body = $request->get_json_params();
	if ( ! is_array( $body ) ) {
		$body = $request->get_body_params();
	}
	if ( ! is_array( $body ) ) {
		$body = array();
	}

	$fields  = array();
	$allowed = array(
		'name',
		'role',
		'description',
		'instructions',
		'abilities',
		'triggers',
		'model',
		'rateLimit',
		'vibes',
		'face',
		'faceSeed',
	);
	foreach ( $allowed as $field ) {
		if ( array_key_exists( $field, $body ) ) {
			$fields[ $field ] = $body[ $field ];
		}
	}

	$updated = openstation_agent_update( (int) $user->ID, $fields );
	if ( is_wp_error( $updated ) ) {
		$updated->add_data( array( 'status' => 400 ) );
		return $updated;
	}

	return rest_ensure_response(
		openstation_agents_rest_shape_user( get_userdata( (int) $user->ID ) )
	);
}

function openstation_agents_rest_delete( WP_REST_Request $request ) {
	$user_id = (int) $request['id'];
	$user    = get_userdata( $user_id );
	if ( ! $user || ! openstation_agent_is_agent( $user ) ) {
		return new WP_Error(
			'openstation_agents_not_found',
			__( 'Agent not found.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}

	$result = openstation_agent_delete( $user_id );
	if ( is_wp_error( $result ) ) {
		$result->add_data( array( 'status' => 500 ) );
		return $result;
	}

	return rest_ensure_response(
		array(
			'deleted' => true,
			'id'      => $user_id,
		)
	);
}

function openstation_agents_rest_invoke( WP_REST_Request $request ) {
	$user = get_userdata( (int) $request['id'] );
	if ( ! $user || ! openstation_agent_is_agent( $user ) ) {
		return new WP_Error(
			'openstation_agents_not_found',
			__( 'Agent not found.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}

	$source = (string) $request['source'];

	if ( ! openstation_agent_user_can_invoke_agent( (int) $user->ID, $source ) ) {
		return new WP_Error(
			'openstation_agents_forbidden',
			__( 'You do not have permission to invoke this agent.', 'desktop-mode' ),
			array( 'status' => rest_authorization_required_code() )
		);
	}

	if ( $request['async'] ) {
		return openstation_agents_rest_enqueue_job( $request );
	}

	$result = openstation_agent_invoke(
		(int) $user->ID,
		(string) $request['message'],
		array(
			'source'  => $source,
			'invoker' => get_current_user_id(),
			'history' => (array) $request['history'],
		)
	);
	if ( is_wp_error( $result ) ) {
		$data = $result->get_error_data();
		if ( ! is_array( $data ) || ! isset( $data['status'] ) ) {
			$result->add_data( array( 'status' => 500 ) );
		}
		return $result;
	}
	return rest_ensure_response( $result );
}

function openstation_agents_rest_abilities_catalogue() {
	return rest_ensure_response( openstation_agents_abilities_catalogue() );
}

function openstation_agents_rest_validate_brief( $value ) {
	return is_string( $value )
		&& '' !== trim( $value )
		&& mb_strlen( $value ) <= OPENSTATION_AGENT_DRAFT_BRIEF_MAX;
}

function openstation_agents_rest_draft( WP_REST_Request $request ) {
	$draft = openstation_agent_draft( (string) $request['brief'], get_current_user_id() );
	if ( is_wp_error( $draft ) ) {
		return $draft;
	}
	return rest_ensure_response( $draft );
}

function openstation_agents_rest_trigger_kinds() {
	return rest_ensure_response( openstation_agent_trigger_kinds() );
}

function openstation_agents_rest_hooks_catalogue() {
	return rest_ensure_response( openstation_agent_hooks_catalogue() );
}

function openstation_agents_rest_roles() {
	$names = wp_roles()->get_names();
	$out   = array();
	foreach ( openstation_agent_allowed_roles() as $slug ) {
		$out[] = array(
			'slug'  => $slug,
			'label' => isset( $names[ $slug ] ) ? translate_user_role( $names[ $slug ] ) : $slug,
		);
	}
	return rest_ensure_response( $out );
}

function openstation_agents_rest_shape_user( $user ) {
	if ( ! $user instanceof WP_User || ! openstation_agent_is_agent( $user ) ) {
		return null;
	}

	$slug = (string) $user->user_login;
	if ( 0 === strpos( $slug, 'agent-' ) ) {
		$slug = substr( $slug, strlen( 'agent-' ) );
	}

	$role = '';
	if ( is_array( $user->roles ) && ! empty( $user->roles ) ) {
		$role = (string) reset( $user->roles );
	}

	$avatar = get_avatar_url( $user->ID, array( 'size' => 96 ) );
	if ( ! is_string( $avatar ) || '' === $avatar ) {
		$avatar = openstation_agent_avatar_url( (int) $user->ID );
	}

	return array(
		'id'           => (int) $user->ID,
		'slug'         => $slug,
		'name'         => openstation_plain_text_title( $user->display_name ),
		'description'  => openstation_agent_get_description( (int) $user->ID ),
		'instructions' => openstation_agent_get_instructions( (int) $user->ID ),
		'role'         => $role,
		'abilities'    => openstation_agent_get_abilities( (int) $user->ID ),
		'triggers'     => openstation_agent_get_triggers( (int) $user->ID ),
		'model'        => openstation_agent_get_model( (int) $user->ID ),
		'rateLimit'    => openstation_agent_get_rate_limit( (int) $user->ID ),
		'vibes'        => openstation_agent_get_vibes( (int) $user->ID ),
		'face'         => openstation_agent_get_face( (int) $user->ID ),
		'faceSeed'     => openstation_agent_get_face_seed( (int) $user->ID ),
		'avatarUrl'    => $avatar,
	);
}
