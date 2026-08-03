<?php
/**
 * OpenStation — Agents: REST surface at /desktop-mode/v1/agents.
 *
 * One CRUD surface over the two layers (user row + definition meta) so
 * the bundle never coordinates `/wp/v2/users` and raw meta from JS.
 *
 * Routes:
 *
 *   GET    /desktop-mode/v1/agents                  list
 *   POST   /desktop-mode/v1/agents                  create
 *   GET    /desktop-mode/v1/agents/(?P<id>\d+)      get
 *   POST   /desktop-mode/v1/agents/(?P<id>\d+)      patch
 *   DELETE /desktop-mode/v1/agents/(?P<id>\d+)      delete
 *   POST   /desktop-mode/v1/agents/(?P<id>\d+)/invoke  run (chat trigger)
 *   GET    /desktop-mode/v1/agents/abilities        abilities catalogue
 *   GET    /desktop-mode/v1/agents/trigger-kinds    trigger kinds catalogue
 *   GET    /desktop-mode/v1/agents/hooks-catalogue  hook autocomplete
 *   GET    /desktop-mode/v1/agents/roles            assignable roles (writers only)
 *
 * Permissions: reads and invokes default to `edit_posts` (the same
 * audience as the site folder window hosting the UI); writes require
 * `edit_users` (agents are real users — managing them is user
 * management). All three are filterable.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register REST routes on rest_api_init.
 *
 * @return void
 */
function open_station_agents_register_rest_routes() {
	$namespace = 'desktop-mode/v1';

	register_rest_route(
		$namespace,
		'/agents',
		array(
			array(
				'methods'             => WP_REST_Server::READABLE,
				'permission_callback' => 'open_station_agents_rest_read_permission',
				'callback'            => 'open_station_agents_rest_list',
			),
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => 'open_station_agents_rest_write_permission',
				'callback'            => 'open_station_agents_rest_create',
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
				),
			),
		)
	);

	register_rest_route(
		$namespace,
		'/agents/abilities',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'permission_callback' => 'open_station_agents_rest_read_permission',
			'callback'            => 'open_station_agents_rest_abilities_catalogue',
		)
	);

	register_rest_route(
		$namespace,
		'/agents/trigger-kinds',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'permission_callback' => 'open_station_agents_rest_read_permission',
			'callback'            => 'open_station_agents_rest_trigger_kinds',
		)
	);

	register_rest_route(
		$namespace,
		'/agents/hooks-catalogue',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'permission_callback' => 'open_station_agents_rest_read_permission',
			'callback'            => 'open_station_agents_rest_hooks_catalogue',
		)
	);

	register_rest_route(
		$namespace,
		'/agents/roles',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'permission_callback' => 'open_station_agents_rest_write_permission',
			'callback'            => 'open_station_agents_rest_roles',
		)
	);

	register_rest_route(
		$namespace,
		'/agents/(?P<id>\d+)',
		array(
			array(
				'methods'             => WP_REST_Server::READABLE,
				'permission_callback' => 'open_station_agents_rest_read_permission',
				'callback'            => 'open_station_agents_rest_get',
			),
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => 'open_station_agents_rest_write_permission',
				'callback'            => 'open_station_agents_rest_patch',
			),
			array(
				'methods'             => WP_REST_Server::DELETABLE,
				'permission_callback' => 'open_station_agents_rest_write_permission',
				'callback'            => 'open_station_agents_rest_delete',
			),
		)
	);

	register_rest_route(
		$namespace,
		'/agents/(?P<id>\d+)/invoke',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'permission_callback' => 'open_station_agents_rest_invoke_permission',
			'callback'            => 'open_station_agents_rest_invoke',
			'args'                => array(
				'message' => array(
					'type'              => 'string',
					'required'          => true,
					'sanitize_callback' => 'sanitize_textarea_field',
				),
				'source'  => array(
					'type'              => 'string',
					'default'           => 'chat',
					'enum'              => array( 'chat', 'drag', 'send-to' ),
					'sanitize_callback' => 'sanitize_key',
				),
				// Prior conversation turns, oldest first. Without these
				// every message is a contextless run — a follow-up like
				// "yes, do it" would be resolved against nothing and the
				// agent could act on the wrong entity entirely.
				'history' => array(
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
add_action( 'rest_api_init', 'open_station_agents_register_rest_routes' );

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

/**
 * Whether the current user can see agents.
 *
 * @return bool
 */
function open_station_agents_user_can_read() {
	/**
	 * Filter whether the current user can read OpenStation agents.
	 *
	 * @param bool $can Default: `edit_posts` capability.
	 */
	return (bool) apply_filters( 'open_station_agents_user_can_read', current_user_can( 'edit_posts' ) );
}

/**
 * Whether the current user can create / edit / delete agents.
 *
 * @return bool
 */
function open_station_agents_user_can_manage() {
	/**
	 * Filter whether the current user can manage OpenStation agents.
	 *
	 * @param bool $can Default: `edit_users` capability.
	 */
	return (bool) apply_filters( 'open_station_agents_user_can_manage', current_user_can( 'edit_users' ) );
}

/**
 * Whether the current user can invoke agents.
 *
 * @return bool
 */
function open_station_agents_user_can_invoke() {
	/**
	 * Filter whether the current user can invoke OpenStation agents.
	 *
	 * @param bool $can Default: `edit_posts` capability.
	 */
	return (bool) apply_filters( 'open_station_agents_user_can_invoke', current_user_can( 'edit_posts' ) );
}

/**
 * Read-route permission callback.
 *
 * @return bool|WP_Error
 */
function open_station_agents_rest_read_permission() {
	if ( ! is_user_logged_in() || ! open_station_agents_user_can_read() ) {
		return new WP_Error(
			'open_station_agents_forbidden',
			__( 'You do not have permission to read OpenStation agents.', 'desktop-mode' ),
			array( 'status' => rest_authorization_required_code() )
		);
	}
	return true;
}

/**
 * Write-route permission callback.
 *
 * @return bool|WP_Error
 */
function open_station_agents_rest_write_permission() {
	if ( ! is_user_logged_in() || ! open_station_agents_user_can_manage() ) {
		return new WP_Error(
			'open_station_agents_forbidden',
			__( 'You do not have permission to manage OpenStation agents.', 'desktop-mode' ),
			array( 'status' => rest_authorization_required_code() )
		);
	}
	return true;
}

/**
 * Invoke-route permission callback.
 *
 * @return bool|WP_Error
 */
function open_station_agents_rest_invoke_permission() {
	if ( ! is_user_logged_in() || ! open_station_agents_user_can_invoke() ) {
		return new WP_Error(
			'open_station_agents_forbidden',
			__( 'You do not have permission to invoke OpenStation agents.', 'desktop-mode' ),
			array( 'status' => rest_authorization_required_code() )
		);
	}
	return true;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/**
 * GET /agents — list every agent on the site.
 *
 * @return WP_REST_Response
 */
function open_station_agents_rest_list() {
	$out = array();
	foreach ( open_station_agent_get_agents() as $user ) {
		$shape = open_station_agents_rest_shape_user( $user );
		if ( $shape ) {
			$out[] = $shape;
		}
	}
	$response = rest_ensure_response( $out );
	// Standard collection headers — the site folder's root grid derives
	// its folder counts from `X-WP-Total`.
	$response->header( 'X-WP-Total', (string) count( $out ) );
	$response->header( 'X-WP-TotalPages', '1' );
	return $response;
}

/**
 * GET /agents/:id — fetch a single agent.
 *
 * @param WP_REST_Request $request REST request.
 * @return WP_REST_Response|WP_Error
 */
function open_station_agents_rest_get( WP_REST_Request $request ) {
	$user = get_userdata( (int) $request['id'] );
	if ( ! $user || ! open_station_agent_is_agent( $user ) ) {
		return new WP_Error(
			'open_station_agents_not_found',
			__( 'Agent not found.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}
	return rest_ensure_response( open_station_agents_rest_shape_user( $user ) );
}

/**
 * POST /agents — create.
 *
 * @param WP_REST_Request $request REST request.
 * @return WP_REST_Response|WP_Error
 */
function open_station_agents_rest_create( WP_REST_Request $request ) {
	$user = open_station_agent_create(
		array(
			'name'         => (string) $request['name'],
			'role'         => (string) $request['role'],
			'description'  => (string) $request['description'],
			'instructions' => (string) $request['instructions'],
			'abilities'    => (array) $request['abilities'],
		)
	);
	if ( is_wp_error( $user ) ) {
		$data = $user->get_error_data();
		if ( ! is_array( $data ) || ! isset( $data['status'] ) ) {
			$user->add_data( array( 'status' => 400 ) );
		}
		return $user;
	}

	$response = rest_ensure_response( open_station_agents_rest_shape_user( $user ) );
	$response->set_status( 201 );
	return $response;
}

/**
 * POST /agents/:id — patch any subset of the definition fields.
 *
 * @param WP_REST_Request $request REST request.
 * @return WP_REST_Response|WP_Error
 */
function open_station_agents_rest_patch( WP_REST_Request $request ) {
	$user = get_userdata( (int) $request['id'] );
	if ( ! $user || ! open_station_agent_is_agent( $user ) ) {
		return new WP_Error(
			'open_station_agents_not_found',
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
	$allowed = array( 'name', 'role', 'description', 'instructions', 'abilities', 'triggers', 'model', 'rateLimit' );
	foreach ( $allowed as $field ) {
		if ( array_key_exists( $field, $body ) ) {
			$fields[ $field ] = $body[ $field ];
		}
	}

	$updated = open_station_agent_update( (int) $user->ID, $fields );
	if ( is_wp_error( $updated ) ) {
		$updated->add_data( array( 'status' => 400 ) );
		return $updated;
	}

	return rest_ensure_response(
		open_station_agents_rest_shape_user( get_userdata( (int) $user->ID ) )
	);
}

/**
 * DELETE /agents/:id.
 *
 * @param WP_REST_Request $request REST request.
 * @return WP_REST_Response|WP_Error
 */
function open_station_agents_rest_delete( WP_REST_Request $request ) {
	$user_id = (int) $request['id'];
	$user    = get_userdata( $user_id );
	if ( ! $user || ! open_station_agent_is_agent( $user ) ) {
		return new WP_Error(
			'open_station_agents_not_found',
			__( 'Agent not found.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}

	$result = open_station_agent_delete( $user_id );
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

/**
 * POST /agents/:id/invoke — run the agent with the supplied message.
 *
 * @param WP_REST_Request $request REST request.
 * @return WP_REST_Response|WP_Error
 */
function open_station_agents_rest_invoke( WP_REST_Request $request ) {
	$user = get_userdata( (int) $request['id'] );
	if ( ! $user || ! open_station_agent_is_agent( $user ) ) {
		return new WP_Error(
			'open_station_agents_not_found',
			__( 'Agent not found.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}

	$source = (string) $request['source'];

	// Per-agent gate. The route's `permission_callback` cannot run this
	// one: it has no access to the resolved agent, and the capability an
	// agent requires is a property of that agent's trigger config.
	if ( ! open_station_agent_user_can_invoke_agent( (int) $user->ID, $source ) ) {
		return new WP_Error(
			'open_station_agents_forbidden',
			__( 'You do not have permission to invoke this agent.', 'desktop-mode' ),
			array( 'status' => rest_authorization_required_code() )
		);
	}

	$result = open_station_agent_invoke(
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

/**
 * GET /agents/abilities — the abilities catalogue for the picker.
 *
 * @return WP_REST_Response
 */
function open_station_agents_rest_abilities_catalogue() {
	return rest_ensure_response( open_station_agents_abilities_catalogue() );
}

/**
 * GET /agents/trigger-kinds — the trigger-kinds catalogue.
 *
 * @return WP_REST_Response
 */
function open_station_agents_rest_trigger_kinds() {
	return rest_ensure_response( open_station_agent_trigger_kinds() );
}

/**
 * GET /agents/hooks-catalogue — the curated WP hooks catalogue.
 *
 * @return WP_REST_Response
 */
function open_station_agents_rest_hooks_catalogue() {
	return rest_ensure_response( open_station_agent_hooks_catalogue() );
}

/**
 * GET /agents/roles — roles the current user may assign to an agent.
 *
 * @return WP_REST_Response
 */
function open_station_agents_rest_roles() {
	$names = wp_roles()->get_names();
	$out   = array();
	foreach ( open_station_agent_allowed_roles() as $slug ) {
		$out[] = array(
			'slug'  => $slug,
			'label' => isset( $names[ $slug ] ) ? translate_user_role( $names[ $slug ] ) : $slug,
		);
	}
	return rest_ensure_response( $out );
}

/**
 * Build the canonical REST shape for one agent.
 *
 * @param WP_User|null $user Agent user.
 * @return array|null Null when the user is not an agent.
 */
function open_station_agents_rest_shape_user( $user ) {
	if ( ! $user instanceof WP_User || ! open_station_agent_is_agent( $user ) ) {
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
		$avatar = open_station_agent_avatar_url();
	}

	return array(
		'id'           => (int) $user->ID,
		'slug'         => $slug,
		'name'         => (string) $user->display_name,
		'description'  => open_station_agent_get_description( (int) $user->ID ),
		'instructions' => open_station_agent_get_instructions( (int) $user->ID ),
		'role'         => $role,
		'abilities'    => open_station_agent_get_abilities( (int) $user->ID ),
		'triggers'     => open_station_agent_get_triggers( (int) $user->ID ),
		'model'        => open_station_agent_get_model( (int) $user->ID ),
		'rateLimit'    => open_station_agent_get_rate_limit( (int) $user->ID ),
		'avatarUrl'    => $avatar,
	);
}
