<?php
/**
 * Desktop Mode — Agents: REST surface at /desktop-mode/v1/agents.
 *
 * Orchestrates the join across the three layers (`wp_users` row +
 * `wp_guideline` post + user meta) so the bundle has a single CRUD
 * surface instead of having to coordinate `/wp/v2/users` and
 * `/wp/v2/guidelines` from JS.
 *
 * Routes:
 *
 *   GET    /desktop-mode/v1/agents                  list
 *   POST   /desktop-mode/v1/agents                  create
 *   GET    /desktop-mode/v1/agents/(?P<id>\d+)      get
 *   POST   /desktop-mode/v1/agents/(?P<id>\d+)      patch
 *   DELETE /desktop-mode/v1/agents/(?P<id>\d+)      delete
 *   GET    /desktop-mode/v1/agents/abilities        abilities catalogue
 *   GET    /desktop-mode/v1/agents/hooks-catalogue  hook autocomplete
 *   GET    /desktop-mode/v1/agents/trigger-kinds    kinds catalogue
 *
 * Permission: `edit_users` (strictest of the caps the routes touch —
 * creating / deleting other-user accounts). The soft-gate also gates
 * every write path: when `desktop_mode_agents_storage_available()` is
 * false, mutations return 412 with a hint.
 *
 * @package WPDesktopMode
 * @since   0.23.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register REST routes on rest_api_init.
 *
 * @since 0.23.0
 *
 * @return void
 */
function desktop_mode_agents_register_rest_routes() {
	$namespace = 'desktop-mode/v1';

	register_rest_route(
		$namespace,
		'/agents',
		array(
			array(
				'methods'             => WP_REST_Server::READABLE,
				'permission_callback' => 'desktop_mode_agents_rest_read_permission',
				'callback'            => 'desktop_mode_agents_rest_list',
			),
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => 'desktop_mode_agents_rest_write_permission',
				'callback'            => 'desktop_mode_agents_rest_create',
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
					'status'       => array(
						'type'              => 'string',
						'default'           => 'publish',
						'enum'              => array( 'publish', 'private', 'draft' ),
						'sanitize_callback' => 'sanitize_key',
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
			'permission_callback' => 'desktop_mode_agents_rest_read_permission',
			'callback'            => 'desktop_mode_agents_rest_abilities_catalogue',
		)
	);

	register_rest_route(
		$namespace,
		'/agents/hooks-catalogue',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'permission_callback' => 'desktop_mode_agents_rest_read_permission',
			'callback'            => 'desktop_mode_agents_rest_hooks_catalogue',
		)
	);

	register_rest_route(
		$namespace,
		'/agents/trigger-kinds',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'permission_callback' => 'desktop_mode_agents_rest_read_permission',
			'callback'            => 'desktop_mode_agents_rest_trigger_kinds',
		)
	);

	register_rest_route(
		$namespace,
		'/agents/send-to-targets',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'permission_callback' => 'desktop_mode_agents_rest_read_permission',
			'callback'            => 'desktop_mode_agents_rest_send_to_targets',
		)
	);

	register_rest_route(
		$namespace,
		'/agents/(?P<id>\d+)',
		array(
			array(
				'methods'             => WP_REST_Server::READABLE,
				'permission_callback' => 'desktop_mode_agents_rest_read_permission',
				'callback'            => 'desktop_mode_agents_rest_get',
			),
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => 'desktop_mode_agents_rest_write_permission',
				'callback'            => 'desktop_mode_agents_rest_patch',
			),
			array(
				'methods'             => WP_REST_Server::DELETABLE,
				'permission_callback' => 'desktop_mode_agents_rest_write_permission',
				'callback'            => 'desktop_mode_agents_rest_delete',
			),
		)
	);

	register_rest_route(
		$namespace,
		'/agents/(?P<id>\d+)/invoke',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'permission_callback' => 'desktop_mode_agents_rest_invoke_permission',
			'callback'            => 'desktop_mode_agents_rest_invoke',
			'args'                => array(
				'message' => array(
					'type'              => 'string',
					'required'          => true,
					'sanitize_callback' => 'wp_kses_post',
				),
			),
		)
	);

	register_rest_route(
		$namespace,
		'/agents/(?P<id>\d+)/dossier',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'permission_callback' => 'desktop_mode_agents_rest_read_permission',
			'callback'            => 'desktop_mode_agents_rest_dossier',
		)
	);
}
add_action( 'rest_api_init', 'desktop_mode_agents_register_rest_routes' );

/**
 * Whether the current user has the `read_guidelines` synthesized
 * capability — the new namespace introduced by Gutenberg PR #78296.
 *
 * Falls back to `edit_posts` when the capability isn't registered
 * yet (pre-#78296 Gutenberg). Both gates evaluate to the same effective
 * audience (Contributor+) so the fallback isn't a privilege escalation.
 *
 * @since 0.23.0
 *
 * @return bool
 */
function desktop_mode_agents_user_can_read_guidelines() {
	if ( current_user_can( 'read_guidelines' ) ) {
		return true;
	}
	return current_user_can( 'edit_posts' );
}

/**
 * Whether the current user can publish guidelines — Editor+ baseline
 * per PR #78296 (`publish_guidelines`), with a pre-PR fallback to
 * `publish_posts`.
 *
 * @since 0.23.0
 *
 * @return bool
 */
function desktop_mode_agents_user_can_publish_guidelines() {
	if ( current_user_can( 'publish_guidelines' ) ) {
		return true;
	}
	return current_user_can( 'publish_posts' );
}

/**
 * Whether the current user can edit guidelines owned by other authors
 * — Editor+ per the new policy, falling back to `edit_others_posts`.
 *
 * Used in delete + role-flip paths where the human admin acts on an
 * agent owned by the synthetic agent user.
 *
 * @since 0.23.0
 *
 * @return bool
 */
function desktop_mode_agents_user_can_edit_others_guidelines() {
	if ( current_user_can( 'edit_others_guidelines' ) ) {
		return true;
	}
	return current_user_can( 'edit_others_posts' );
}

/**
 * Read-route permission: list / catalogues.
 *
 * Aligned with Gutenberg PR #78296's synthesized capability
 * namespace: any role granted `read_guidelines` baseline (Contributor
 * and above, Subscribers excluded) can read. Per-item reads add a
 * `read_post` check on the linked guideline so private rows are
 * correctly gated.
 *
 * @since 0.23.0
 *
 * @return bool|WP_Error
 */
function desktop_mode_agents_rest_read_permission() {
	if ( ! desktop_mode_agents_user_can_read_guidelines() ) {
		return new WP_Error(
			'desktop_mode_agents_forbidden',
			__( 'You do not have permission to read Desktop Mode agents.', 'desktop-mode' ),
			array( 'status' => 403 )
		);
	}
	return true;
}

/**
 * Write-route permission: create / patch / delete.
 *
 * Three gates, in order:
 *
 *   1. `publish_guidelines` (or `publish_posts` fallback) — agents
 *      are stored as `publish`-status guidelines so the writer must
 *      have publishing rights. The new access policy makes this
 *      synthesized cap Editor+ baseline.
 *   2. `edit_users` — agents are paired with synthetic `wp_users`
 *      rows via `wp_insert_user` / `wp_delete_user`, which require
 *      the user-management cap. This is the stricter of the two and
 *      effectively constrains writes to administrators on default
 *      sites.
 *   3. Substrate availability — `wp_guideline` + `wp_guideline_type`
 *      must be registered. Otherwise 412 so the client can paint
 *      the soft-gate UI.
 *
 * @since 0.23.0
 *
 * @return bool|WP_Error
 */
function desktop_mode_agents_rest_write_permission() {
	if ( ! desktop_mode_agents_user_can_publish_guidelines() ) {
		return new WP_Error(
			'desktop_mode_agents_forbidden',
			__( 'You do not have permission to publish guidelines on this site.', 'desktop-mode' ),
			array( 'status' => 403 )
		);
	}
	if ( ! current_user_can( 'edit_users' ) ) {
		return new WP_Error(
			'desktop_mode_agents_forbidden',
			__( 'You do not have permission to manage Desktop Mode agents.', 'desktop-mode' ),
			array( 'status' => 403 )
		);
	}
	if ( ! desktop_mode_agents_storage_available() ) {
		return new WP_Error(
			'desktop_mode_agents_substrate_missing',
			__( 'The Gutenberg Guidelines experiment must be enabled to manage agents.', 'desktop-mode' ),
			array( 'status' => 412 )
		);
	}
	return true;
}

/**
 * GET /agents — list every agent on the site.
 *
 * Reads from `wp_users` joined with `wp_guideline` via the
 * `_desktop_mode_agent_guideline_id` user meta. If the substrate is
 * missing, returns an empty list (200) — the soft-gate UI in the
 * bundle decides what to paint based on the substrate config flag, not
 * this response.
 *
 * @since 0.23.0
 *
 * @return WP_REST_Response
 */
function desktop_mode_agents_rest_list() {
	$users = get_users(
		array(
			'meta_key'   => DESKTOP_MODE_AGENT_USER_MARKER_META, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key
			'meta_value' => '1', // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_value
			'orderby'    => 'display_name',
			'order'      => 'ASC',
			'number'     => 200,
		)
	);

	$out = array();
	foreach ( $users as $user ) {
		$shape = desktop_mode_agents_rest_shape_user( $user );
		if ( $shape ) {
			$out[] = $shape;
		}
	}

	return rest_ensure_response( $out );
}

/**
 * GET /agents/:id — fetch a single agent.
 *
 * @since 0.23.0
 *
 * @param WP_REST_Request $request REST request.
 * @return WP_REST_Response|WP_Error
 */
function desktop_mode_agents_rest_get( WP_REST_Request $request ) {
	$user = get_userdata( (int) $request['id'] );
	if ( ! $user || ! desktop_mode_agent_is_agent( $user ) ) {
		return new WP_Error(
			'desktop_mode_agents_not_found',
			__( 'Agent not found.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}
	// Per-row `read_post` gate — aligns with Gutenberg PR #78296's
	// "REST per-item reads route through read_post, which maps to the
	// right *_guidelines primitive based on the row's status and
	// ownership." Private agents are visible only to their author /
	// admins; published agents are visible to anyone who can read
	// guidelines.
	$guideline = desktop_mode_agents_get_guideline_for_user( $user->ID );
	if ( $guideline && ! current_user_can( 'read_post', $guideline->ID ) ) {
		return new WP_Error(
			'desktop_mode_agents_forbidden',
			__( 'You do not have permission to read this agent.', 'desktop-mode' ),
			array( 'status' => 403 )
		);
	}
	$shape = desktop_mode_agents_rest_shape_user( $user );
	if ( ! $shape ) {
		return new WP_Error(
			'desktop_mode_agents_not_found',
			__( 'Agent not found.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}
	return rest_ensure_response( $shape );
}

/**
 * POST /agents — create.
 *
 * @since 0.23.0
 *
 * @param WP_REST_Request $request REST request.
 * @return WP_REST_Response|WP_Error
 */
function desktop_mode_agents_rest_create( WP_REST_Request $request ) {
	$name         = (string) $request['name'];
	$role         = (string) $request['role'];
	$description  = (string) $request['description'];
	$instructions = (string) $request['instructions'];
	$status       = (string) ( $request['status'] ?? 'publish' );

	$slug = sanitize_title( $name );
	if ( '' === $slug ) {
		return new WP_Error(
			'desktop_mode_agents_invalid_name',
			__( 'Agent name is required.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}

	$user = desktop_mode_agent_create_user(
		array(
			'name' => $name,
			'role' => $role,
			'slug' => $slug,
		)
	);
	if ( is_wp_error( $user ) ) {
		$user->add_data( array( 'status' => 400 ) );
		return $user;
	}

	$source_id = desktop_mode_agents_build_source_id( $slug );
	// `wp_install_skill()` always wins against caller `$extras` for
	// `post_author` (protected key in the canonical Push MD
	// implementation), so we can't pass it as an extra — the agent
	// would still end up authored by the admin doing the create.
	// Instead, install first, then fix up the author below.
	$installed = wp_install_skill(
		$source_id,
		$name,
		$description,
		$instructions
	);

	if ( is_wp_error( $installed ) ) {
		// Roll back the user if the guideline failed.
		if ( ! function_exists( 'wp_delete_user' ) ) {
			require_once ABSPATH . 'wp-admin/includes/user.php';
		}
		wp_delete_user( $user->ID );
		$installed->add_data( array( 'status' => 500 ) );
		return $installed;
	}

	$guideline_id = (int) $installed['id'];

	// Always reauthor the guideline to the agent's wp_users row so
	// revisions, comments, and the standard WP audit trail attribute
	// activity to the agent itself (not to the human admin who
	// created it). Applies to both the `created=true` and
	// `created=false` branches. Also override post_status if the
	// caller requested anything other than `wp_install_skill`'s
	// canonical `publish` default.
	$post_update = array(
		'ID'          => $guideline_id,
		'post_author' => (int) $user->ID,
	);
	if ( 'publish' !== $status ) {
		$post_update['post_status'] = $status;
	}
	wp_update_post( $post_update );

	desktop_mode_agent_link_guideline( (int) $user->ID, $guideline_id );

	/**
	 * Fires after an agent is created.
	 *
	 * @since 0.23.0
	 *
	 * @param int   $user_id      Agent user id.
	 * @param int   $guideline_id Linked guideline post id.
	 * @param array $args         Create args.
	 */
	do_action(
		'desktop_mode_agent_created',
		(int) $user->ID,
		$guideline_id,
		array(
			'name'         => $name,
			'role'         => $role,
			'description'  => $description,
			'instructions' => $instructions,
		)
	);

	$shape = desktop_mode_agents_rest_shape_user( $user );
	$response = rest_ensure_response( $shape );
	$response->set_status( 201 );
	return $response;
}

/**
 * POST /agents/:id — patch.
 *
 * @since 0.23.0
 *
 * @param WP_REST_Request $request REST request.
 * @return WP_REST_Response|WP_Error
 */
function desktop_mode_agents_rest_patch( WP_REST_Request $request ) {
	$user = get_userdata( (int) $request['id'] );
	if ( ! $user || ! desktop_mode_agent_is_agent( $user ) ) {
		return new WP_Error(
			'desktop_mode_agents_not_found',
			__( 'Agent not found.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}

	$guideline = desktop_mode_agents_get_guideline_for_user( $user->ID );
	if ( ! $guideline ) {
		return new WP_Error(
			'desktop_mode_agents_no_guideline',
			__( 'Agent has no linked guideline.', 'desktop-mode' ),
			array( 'status' => 500 )
		);
	}

	$body = $request->get_json_params();
	if ( ! is_array( $body ) ) {
		$body = $request->get_body_params();
	}

	// Identity / behaviour fields.
	$post_update = array( 'ID' => (int) $guideline->ID );
	$user_update = array( 'ID' => (int) $user->ID );

	if ( isset( $body['name'] ) ) {
		$name = sanitize_text_field( (string) $body['name'] );
		if ( '' === $name ) {
			return new WP_Error(
				'desktop_mode_agents_invalid_name',
				__( 'Agent name cannot be empty.', 'desktop-mode' ),
				array( 'status' => 400 )
			);
		}
		$post_update['post_title'] = $name;
		$user_update['display_name'] = $name;
	}

	if ( isset( $body['description'] ) ) {
		$post_update['post_excerpt'] = sanitize_text_field( (string) $body['description'] );
	}

	if ( isset( $body['instructions'] ) ) {
		$post_update['post_content'] = wp_kses_post( (string) $body['instructions'] );
	}

	if ( isset( $body['role'] ) ) {
		$role  = sanitize_key( (string) $body['role'] );
		$roles = wp_roles()->get_names();
		if ( ! isset( $roles[ $role ] ) ) {
			return new WP_Error(
				'desktop_mode_agents_invalid_role',
				__( 'Pick a valid WordPress role for the agent.', 'desktop-mode' ),
				array( 'status' => 400 )
			);
		}
		$user->set_role( $role );
	}

	if ( isset( $body['status'] ) ) {
		$status = sanitize_key( (string) $body['status'] );
		if ( ! in_array( $status, array( 'publish', 'private', 'draft' ), true ) ) {
			return new WP_Error(
				'desktop_mode_agents_invalid_status',
				__( 'Status must be publish, private, or draft.', 'desktop-mode' ),
				array( 'status' => 400 )
			);
		}
		$post_update['post_status'] = $status;
	}

	if ( count( $user_update ) > 1 ) {
		wp_update_user( $user_update );
	}

	if ( count( $post_update ) > 1 ) {
		$updated = wp_update_post( $post_update, true );
		if ( is_wp_error( $updated ) ) {
			$updated->add_data( array( 'status' => 400 ) );
			return $updated;
		}
	}

	// Abilities (behaviour layer).
	if ( isset( $body['abilities'] ) && is_array( $body['abilities'] ) ) {
		desktop_mode_agents_set_abilities( (int) $guideline->ID, $body['abilities'] );
	}

	// Bindings layer.
	if ( isset( $body['triggers'] ) ) {
		desktop_mode_agent_set_triggers( (int) $user->ID, $body['triggers'] );
	}
	if ( isset( $body['model'] ) ) {
		desktop_mode_agent_set_model( (int) $user->ID, (string) $body['model'] );
	}
	if ( isset( $body['rateLimit'] ) ) {
		desktop_mode_agent_set_rate_limit( (int) $user->ID, (int) $body['rateLimit'] );
	}

	$shape = desktop_mode_agents_rest_shape_user( get_userdata( (int) $user->ID ) );
	return rest_ensure_response( $shape );
}

/**
 * DELETE /agents/:id — destructive delete (cascades guideline).
 *
 * @since 0.23.0
 *
 * @param WP_REST_Request $request REST request.
 * @return WP_REST_Response|WP_Error
 */
function desktop_mode_agents_rest_delete( WP_REST_Request $request ) {
	$user_id = (int) $request['id'];
	$user    = get_userdata( $user_id );
	if ( ! $user || ! desktop_mode_agent_is_agent( $user ) ) {
		return new WP_Error(
			'desktop_mode_agents_not_found',
			__( 'Agent not found.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}

	$result = desktop_mode_agent_delete( $user_id );
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
 * GET /agents/abilities — return the abilities catalogue.
 *
 * @since 0.23.0
 *
 * @return WP_REST_Response
 */
function desktop_mode_agents_rest_abilities_catalogue() {
	return rest_ensure_response( desktop_mode_agents_abilities_catalogue() );
}

/**
 * GET /agents/hooks-catalogue — return the curated WP hooks catalogue.
 *
 * @since 0.23.0
 *
 * @return WP_REST_Response
 */
function desktop_mode_agents_rest_hooks_catalogue() {
	return rest_ensure_response( desktop_mode_agent_hooks_catalogue() );
}

/**
 * GET /agents/trigger-kinds — return the trigger-kinds catalogue.
 *
 * @since 0.23.0
 *
 * @return WP_REST_Response
 */
function desktop_mode_agents_rest_trigger_kinds() {
	return rest_ensure_response( desktop_mode_agent_trigger_kinds() );
}

/**
 * GET /agents/send-to-targets — return every agent with at least one
 * `send-to` trigger, projected for the bundle's context-menu filter.
 *
 * @since 0.23.0
 *
 * @return WP_REST_Response
 */
function desktop_mode_agents_rest_send_to_targets() {
	return rest_ensure_response( desktop_mode_agents_collect_send_to_targets() );
}

/**
 * Permission gate for `/agents/<id>/invoke` — anyone with the
 * `edit_posts` baseline (Contributor+) can invoke a publish-status
 * agent. The REST endpoint validates the agent exists; the runtime
 * switches into the agent's identity for ability dispatch.
 *
 * @since 0.23.0
 *
 * @return bool|WP_Error
 */
function desktop_mode_agents_rest_invoke_permission() {
	if ( ! desktop_mode_agents_user_can_read_guidelines() ) {
		return new WP_Error(
			'desktop_mode_agents_forbidden',
			__( 'You do not have permission to invoke Desktop Mode agents.', 'desktop-mode' ),
			array( 'status' => 403 )
		);
	}
	if ( ! desktop_mode_agents_storage_available() ) {
		return new WP_Error(
			'desktop_mode_agents_substrate_missing',
			__( 'The Gutenberg Guidelines experiment must be enabled.', 'desktop-mode' ),
			array( 'status' => 412 )
		);
	}
	return true;
}

/**
 * POST /agents/<id>/invoke — run the agent with the supplied
 * message. Returns the final assistant text plus the tool-call
 * trace for the bundle to render.
 *
 * @since 0.23.0
 *
 * @param WP_REST_Request $request REST request.
 * @return WP_REST_Response|WP_Error
 */
function desktop_mode_agents_rest_invoke( WP_REST_Request $request ) {
	$user = get_userdata( (int) $request['id'] );
	if ( ! $user || ! desktop_mode_agent_is_agent( $user ) ) {
		return new WP_Error(
			'desktop_mode_agents_not_found',
			__( 'Agent not found.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}
	$guideline = desktop_mode_agents_get_guideline_for_user( $user->ID );
	if ( $guideline && ! current_user_can( 'read_post', $guideline->ID ) ) {
		return new WP_Error(
			'desktop_mode_agents_forbidden',
			__( 'You do not have permission to invoke this agent.', 'desktop-mode' ),
			array( 'status' => 403 )
		);
	}

	$message = (string) $request['message'];
	$result  = desktop_mode_agent_invoke( (int) $user->ID, $message );
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
 * GET /agents/<id>/dossier — extended view used by the "Navigate
 * into" surface in My WordPress. Returns the canonical agent shape
 * plus activity / audit information that the editing panel doesn't
 * need to carry on every list paint.
 *
 * @since 0.23.0
 *
 * @param WP_REST_Request $request REST request.
 * @return WP_REST_Response|WP_Error
 */
function desktop_mode_agents_rest_dossier( WP_REST_Request $request ) {
	$user = get_userdata( (int) $request['id'] );
	if ( ! $user || ! desktop_mode_agent_is_agent( $user ) ) {
		return new WP_Error(
			'desktop_mode_agents_not_found',
			__( 'Agent not found.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}
	$guideline = desktop_mode_agents_get_guideline_for_user( $user->ID );
	if ( $guideline && ! current_user_can( 'read_post', $guideline->ID ) ) {
		return new WP_Error(
			'desktop_mode_agents_forbidden',
			__( 'You do not have permission to read this agent.', 'desktop-mode' ),
			array( 'status' => 403 )
		);
	}

	$shape = desktop_mode_agents_rest_shape_user( $user );
	if ( ! $shape ) {
		return new WP_Error(
			'desktop_mode_agents_not_found',
			__( 'Agent not found.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}

	// Revisions on the guideline (only the count + most-recent
	// metadata — full diffs belong in the standard wp-admin
	// revision UI).
	$revisions = array();
	$revision_count = 0;
	if ( $guideline ) {
		$rev_posts = wp_get_post_revisions( $guideline->ID, array( 'numberposts' => 5 ) );
		$revision_count = count( wp_get_post_revisions( $guideline->ID, array( 'numberposts' => -1 ) ) );
		foreach ( $rev_posts as $rev ) {
			$rev_author = get_userdata( (int) $rev->post_author );
			$revisions[] = array(
				'id'         => (int) $rev->ID,
				'date'       => (string) $rev->post_date_gmt,
				'authorId'   => (int) $rev->post_author,
				'authorName' => $rev_author ? (string) $rev_author->display_name : '',
			);
		}
	}

	// Posts authored by this synthetic agent user. Tells the human
	// operator "the agent has touched X content rows since it was
	// created", which is the closest we get to a usage log without a
	// dedicated activity store.
	$authored = get_posts(
		array(
			'author'         => (int) $user->ID,
			'post_type'      => array( 'post', 'page' ),
			'post_status'    => array( 'publish', 'private', 'draft', 'pending', 'future' ),
			'posts_per_page' => 10,
			'orderby'        => 'modified',
			'order'          => 'DESC',
		)
	);
	$authored_total = (int) wp_count_posts( 'post' )->publish + 0; // cheap; the array carries detail.
	$authored_list  = array();
	foreach ( $authored as $p ) {
		$authored_list[] = array(
			'id'       => (int) $p->ID,
			'type'     => (string) $p->post_type,
			'title'    => (string) get_the_title( $p ),
			'status'   => (string) $p->post_status,
			'modified' => (string) $p->post_modified_gmt,
			'editLink' => (string) get_edit_post_link( $p->ID, 'raw' ),
		);
	}

	// Project the abilities catalogue rows the agent has enabled so
	// the dossier can paint slug + label + description without a
	// second round-trip.
	$catalogue = function_exists( 'desktop_mode_agents_abilities_catalogue' )
		? desktop_mode_agents_abilities_catalogue()
		: array();
	$cat_by_slug = array();
	foreach ( $catalogue as $row ) {
		if ( isset( $row['slug'] ) ) {
			$cat_by_slug[ (string) $row['slug'] ] = $row;
		}
	}
	$enabled_abilities = array();
	foreach ( $shape['abilities'] as $slug ) {
		$enabled_abilities[] = isset( $cat_by_slug[ $slug ] )
			? $cat_by_slug[ $slug ]
			: array( 'slug' => $slug, 'label' => $slug, 'description' => '' );
	}

	$activity_log = function_exists( 'desktop_mode_agent_runner_get_log' )
		? desktop_mode_agent_runner_get_log( (int) $user->ID )
		: array();

	$dossier = array_merge(
		$shape,
		array(
			'activity'         => array(
				'total'  => count( $activity_log ),
				'recent' => array_slice( $activity_log, 0, 25 ),
			),
			'identity'         => array(
				'login'      => (string) $user->user_login,
				'email'      => (string) $user->user_email,
				'registered' => (string) $user->user_registered,
				'loginBlocked'    => true,
				'pwResetBlocked'  => true,
			),
			'guideline'        => $guideline
				? array(
					'id'         => (int) $guideline->ID,
					'slug'       => (string) $guideline->post_name,
					'status'     => (string) $guideline->post_status,
					'modified'   => (string) $guideline->post_modified_gmt,
					'created'    => (string) $guideline->post_date_gmt,
					'source'     => (string) get_post_meta( $guideline->ID, 'guideline_source', true ),
					'editLink'   => (string) get_edit_post_link( $guideline->ID, 'raw' ),
				)
				: null,
			'enabledAbilities' => $enabled_abilities,
			'revisions'        => array(
				'count'  => $revision_count,
				'recent' => $revisions,
			),
			'authored'         => array(
				'total'  => count( $authored_list ),
				'recent' => $authored_list,
			),
		)
	);

	return rest_ensure_response( $dossier );
}

/**
 * Build the canonical REST shape for one agent.
 *
 * @since 0.23.0
 *
 * @param WP_User|null $user Agent user.
 * @return array|null Null if the user has no linked guideline.
 */
function desktop_mode_agents_rest_shape_user( $user ) {
	if ( ! $user instanceof WP_User ) {
		return null;
	}
	if ( ! desktop_mode_agent_is_agent( $user ) ) {
		return null;
	}

	$guideline    = desktop_mode_agents_get_guideline_for_user( $user->ID );
	$guideline_id = $guideline instanceof WP_Post ? (int) $guideline->ID : 0;

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
		$avatar = desktop_mode_agent_avatar_data_uri();
	}

	return array(
		'id'            => (int) $user->ID,
		'slug'          => $slug,
		'name'          => (string) $user->display_name,
		'description'   => $guideline ? (string) $guideline->post_excerpt : '',
		'instructions'  => $guideline ? (string) $guideline->post_content : '',
		'role'          => $role,
		'guidelineId'   => $guideline_id,
		'guidelineLink' => $guideline_id ? get_edit_post_link( $guideline_id, 'raw' ) : '',
		// `publish` = ecosystem-visible (pushmd projection, Dolly's
		// discovery loop). `private` = only the author/admin can see
		// + pushmd skips it. Aligns with PR #78296's per-row
		// `read_post` gate; we return it so the bundle can paint a
		// privacy toggle in the agent editor.
		'status'        => $guideline ? (string) $guideline->post_status : 'publish',
		'abilities'     => $guideline_id ? desktop_mode_agents_get_abilities( $guideline_id ) : array(),
		'triggers'      => desktop_mode_agent_get_triggers( (int) $user->ID ),
		'model'         => desktop_mode_agent_get_model( (int) $user->ID ),
		'rateLimit'     => desktop_mode_agent_get_rate_limit( (int) $user->ID ),
		'avatarUrl'     => $avatar,
	);
}
