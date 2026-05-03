<?php
/**
 * Desktop Mode — Routines: REST routes.
 *
 * Routes (all under `/wp-desktop/v1/routines`, all `manage_options`):
 *
 *   GET    /                       — list routines
 *   POST   /                       — create
 *   GET    /<id>                   — read
 *   PATCH  /<id>                   — update
 *   DELETE /<id>                   — delete
 *   POST   /<id>/test              — dry-run with caller-supplied payload
 *   POST   /<id>/run               — fire the routine for real (admin nudge)
 *   POST   /<id>/enable            — enable/disable
 *   GET    /<id>/runs              — recent run history
 *   GET    /catalog                — triggers + actions + commands + ai-tools
 *   GET    /templates              — registered starter recipes
 *   POST   /from-template          — install a template into a CPT row
 *
 * @package WPDesktopMode
 * @since   0.22.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register REST routes.
 *
 * @since 0.22.0
 */
function wpdm_routine_register_rest_routes() {
	$ns = 'wp-desktop/v1';

	register_rest_route(
		$ns,
		'/routines',
		array(
			array(
				'methods'             => WP_REST_Server::READABLE,
				'permission_callback' => 'wpdm_routine_rest_permission',
				'callback'            => 'wpdm_routine_rest_list',
			),
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => 'wpdm_routine_rest_permission',
				'callback'            => 'wpdm_routine_rest_create',
			),
		)
	);

	register_rest_route(
		$ns,
		'/routines/(?P<id>\d+)',
		array(
			array(
				'methods'             => WP_REST_Server::READABLE,
				'permission_callback' => 'wpdm_routine_rest_permission',
				'callback'            => 'wpdm_routine_rest_read',
			),
			array(
				'methods'             => 'PATCH',
				'permission_callback' => 'wpdm_routine_rest_permission',
				'callback'            => 'wpdm_routine_rest_update',
			),
			array(
				'methods'             => WP_REST_Server::DELETABLE,
				'permission_callback' => 'wpdm_routine_rest_permission',
				'callback'            => 'wpdm_routine_rest_delete',
			),
		)
	);

	register_rest_route(
		$ns,
		'/routines/(?P<id>\d+)/test',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'permission_callback' => 'wpdm_routine_rest_permission',
			'callback'            => 'wpdm_routine_rest_test',
		)
	);

	register_rest_route(
		$ns,
		'/routines/(?P<id>\d+)/run',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'permission_callback' => 'wpdm_routine_rest_permission',
			'callback'            => 'wpdm_routine_rest_run',
		)
	);

	register_rest_route(
		$ns,
		'/routines/(?P<id>\d+)/enable',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'permission_callback' => 'wpdm_routine_rest_permission',
			'callback'            => 'wpdm_routine_rest_enable',
		)
	);

	register_rest_route(
		$ns,
		'/routines/(?P<id>\d+)/runs',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'permission_callback' => 'wpdm_routine_rest_permission',
			'callback'            => 'wpdm_routine_rest_runs',
		)
	);

	register_rest_route(
		$ns,
		'/routines/catalog',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'permission_callback' => 'wpdm_routine_rest_permission',
			'callback'            => 'wpdm_routine_rest_catalog',
		)
	);

	register_rest_route(
		$ns,
		'/routines/templates',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'permission_callback' => 'wpdm_routine_rest_permission',
			'callback'            => 'wpdm_routine_rest_templates',
		)
	);

	register_rest_route(
		$ns,
		'/routines/from-template',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'permission_callback' => 'wpdm_routine_rest_permission',
			'callback'            => 'wpdm_routine_rest_from_template',
		)
	);
}
add_action( 'rest_api_init', 'wpdm_routine_register_rest_routes' );

/**
 * Route-level permission gate.
 *
 * Routines are an admin-only surface. Per-step capability checks
 * happen *inside* the executor against the routine's run-as user;
 * here we only gate "can the caller see/edit routines at all".
 *
 * @since 0.22.0
 *
 * @return bool|WP_Error
 */
function wpdm_routine_rest_permission() {
	if ( ! is_user_logged_in() ) {
		return new WP_Error( 'rest_forbidden', __( 'Sorry, you must be logged in.', 'desktop-mode' ), array( 'status' => 401 ) );
	}
	if ( ! wpdm_routine_user_can_manage() ) {
		return new WP_Error( 'rest_forbidden', __( 'You do not have permission to manage routines.', 'desktop-mode' ), array( 'status' => 403 ) );
	}
	return true;
}

/**
 * GET /routines
 *
 * @since 0.22.0
 *
 * @param WP_REST_Request $request REST request.
 * @return WP_REST_Response
 */
function wpdm_routine_rest_list( $request ) {
	$enabled = $request->get_param( 'enabled' );
	$args    = array();
	if ( null !== $enabled ) {
		$args['enabled'] = rest_sanitize_boolean( $enabled );
	}
	$rows = wpdm_routine_get_all( $args );
	return rest_ensure_response( array( 'items' => $rows ) );
}

/**
 * POST /routines
 *
 * @since 0.22.0
 *
 * @param WP_REST_Request $request REST request.
 * @return WP_REST_Response|WP_Error
 */
function wpdm_routine_rest_create( $request ) {
	$body = $request->get_json_params();
	$id   = wpdm_routine_save(
		array(
			'id'      => 0,
			'title'   => isset( $body['title'] ) ? (string) $body['title'] : '',
			'enabled' => ! empty( $body['enabled'] ),
			'def'     => isset( $body['def'] ) ? $body['def'] : array(),
		)
	);
	if ( is_wp_error( $id ) ) {
		return $id;
	}
	return rest_ensure_response( wpdm_routine_get( (int) $id ) );
}

/**
 * GET /routines/<id>
 *
 * @since 0.22.0
 *
 * @param WP_REST_Request $request REST request.
 * @return WP_REST_Response|WP_Error
 */
function wpdm_routine_rest_read( $request ) {
	$row = wpdm_routine_get( (int) $request['id'] );
	if ( null === $row ) {
		return new WP_Error( 'wpdm_routine_not_found', '', array( 'status' => 404 ) );
	}
	return rest_ensure_response( $row );
}

/**
 * PATCH /routines/<id>
 *
 * Accepts partial updates: title, enabled, def. Anything missing
 * is left untouched.
 *
 * @since 0.22.0
 *
 * @param WP_REST_Request $request REST request.
 * @return WP_REST_Response|WP_Error
 */
function wpdm_routine_rest_update( $request ) {
	$id   = (int) $request['id'];
	$prev = wpdm_routine_get( $id );
	if ( null === $prev ) {
		return new WP_Error( 'wpdm_routine_not_found', '', array( 'status' => 404 ) );
	}
	$body = $request->get_json_params();

	$updated_id = wpdm_routine_save(
		array(
			'id'      => $id,
			'title'   => isset( $body['title'] ) ? (string) $body['title'] : $prev['title'],
			'enabled' => array_key_exists( 'enabled', (array) $body ) ? (bool) $body['enabled'] : $prev['enabled'],
			'def'     => isset( $body['def'] ) ? (array) $body['def'] : $prev['def'],
		)
	);
	if ( is_wp_error( $updated_id ) ) {
		return $updated_id;
	}
	return rest_ensure_response( wpdm_routine_get( (int) $updated_id ) );
}

/**
 * DELETE /routines/<id>
 *
 * @since 0.22.0
 *
 * @param WP_REST_Request $request REST request.
 * @return WP_REST_Response|WP_Error
 */
function wpdm_routine_rest_delete( $request ) {
	$ok = wpdm_routine_delete( (int) $request['id'] );
	if ( is_wp_error( $ok ) ) {
		return $ok;
	}
	return rest_ensure_response( array( 'deleted' => true ) );
}

/**
 * POST /routines/<id>/test  → dry-run with caller-supplied payload.
 *
 * Body: `{ payload: {...} }`.
 *
 * @since 0.22.0
 *
 * @param WP_REST_Request $request REST request.
 * @return WP_REST_Response|WP_Error
 */
function wpdm_routine_rest_test( $request ) {
	$body    = $request->get_json_params();
	$payload = isset( $body['payload'] ) && is_array( $body['payload'] ) ? $body['payload'] : array();
	$result  = wpdm_routine_run( (int) $request['id'], $payload, 'test', true );
	return rest_ensure_response( $result );
}

/**
 * POST /routines/<id>/run  → fire for real.
 *
 * @since 0.22.0
 *
 * @param WP_REST_Request $request REST request.
 * @return WP_REST_Response|WP_Error
 */
function wpdm_routine_rest_run( $request ) {
	$body    = $request->get_json_params();
	$payload = isset( $body['payload'] ) && is_array( $body['payload'] ) ? $body['payload'] : array();
	$result  = wpdm_routine_run( (int) $request['id'], $payload, 'manual', false );
	return rest_ensure_response( $result );
}

/**
 * POST /routines/<id>/enable  → flip the enabled bit.
 *
 * @since 0.22.0
 *
 * @param WP_REST_Request $request REST request.
 * @return WP_REST_Response|WP_Error
 */
function wpdm_routine_rest_enable( $request ) {
	$id  = (int) $request['id'];
	$row = wpdm_routine_get( $id );
	if ( null === $row ) {
		return new WP_Error( 'wpdm_routine_not_found', '', array( 'status' => 404 ) );
	}
	$body    = $request->get_json_params();
	$enabled = array_key_exists( 'enabled', (array) $body ) ? (bool) $body['enabled'] : ! $row['enabled'];
	update_post_meta( $id, WPDM_ROUTINE_ENABLED_META, $enabled ? '1' : '' );
	if ( $enabled ) {
		wpdm_routine_install_one_trigger( wpdm_routine_get( $id ) );
	}
	return rest_ensure_response( wpdm_routine_get( $id ) );
}

/**
 * GET /routines/<id>/runs
 *
 * @since 0.22.0
 *
 * @param WP_REST_Request $request REST request.
 * @return WP_REST_Response
 */
function wpdm_routine_rest_runs( $request ) {
	$limit = (int) ( $request->get_param( 'limit' ) ?: 50 );
	$rows  = wpdm_routine_get_runs( (int) $request['id'], $limit );
	return rest_ensure_response( array( 'items' => $rows ) );
}

/**
 * GET /routines/catalog
 *
 * Single round-trip the visual builder uses to populate every
 * picker: triggers, actions, commands, AI tools.
 *
 * @since 0.22.0
 *
 * @param WP_REST_Request $request REST request.
 * @return WP_REST_Response
 */
function wpdm_routine_rest_catalog( $request ) {
	$triggers = array();
	foreach ( (array) wpdm_routine_trigger_registry() as $entry ) {
		$triggers[] = array(
			'id'             => $entry['id'],
			'label'          => $entry['label'],
			'group'          => $entry['group'],
			'icon'           => $entry['icon'],
			'kind'           => $entry['kind'],
			'priority'       => $entry['priority'],
			'accepted_args'  => $entry['accepted_args'],
			'payload_schema' => $entry['payload_schema'],
			'sample_payload' => $entry['sample_payload'],
		);
	}

	$actions = array();
	foreach ( (array) wpdm_routine_action_registry() as $entry ) {
		$actions[] = array(
			'id'          => $entry['id'],
			'label'       => $entry['label'],
			'description' => $entry['description'],
			'icon'        => $entry['icon'],
			'group'       => $entry['group'],
			'capability'  => $entry['capability'],
			'args_schema' => $entry['args_schema'],
		);
	}

	$ai_tools = array();
	if ( function_exists( 'desktop_mode_get_registered_ai_tools_for_user' ) ) {
		$user_id = get_current_user_id();
		foreach ( (array) desktop_mode_get_registered_ai_tools_for_user( $user_id ) as $entry ) {
			$ai_tools[] = array(
				'name'        => (string) $entry['name'],
				'description' => (string) $entry['description'],
				'parameters'  => $entry['parameters'],
				'capability'  => (string) ( $entry['capability'] ?? '' ),
			);
		}
	}

	return rest_ensure_response(
		array(
			'triggers'  => $triggers,
			'actions'   => $actions,
			'ai_tools'  => $ai_tools,
			'operators' => wpdm_routine_known_operators(),
			'kinds'     => wpdm_routine_known_step_kinds(),
		)
	);
}

/**
 * GET /routines/templates
 *
 * @since 0.22.0
 *
 * @param WP_REST_Request $request REST request.
 * @return WP_REST_Response
 */
function wpdm_routine_rest_templates( $request ) {
	$templates = array();
	foreach ( (array) wpdm_routine_template_registry() as $entry ) {
		$templates[] = array(
			'id'          => $entry['id'],
			'title'       => $entry['title'],
			'description' => $entry['description'],
			'icon'        => $entry['icon'],
			'group'       => $entry['group'],
			'def'         => $entry['def'],
		);
	}
	return rest_ensure_response( array( 'items' => $templates ) );
}

/**
 * POST /routines/from-template  → install a template as a draft routine.
 *
 * Body: `{ template_id, title? }`. The new routine is created
 * disabled, so admins can review and tweak before enabling.
 *
 * @since 0.22.0
 *
 * @param WP_REST_Request $request REST request.
 * @return WP_REST_Response|WP_Error
 */
function wpdm_routine_rest_from_template( $request ) {
	$body        = $request->get_json_params();
	$template_id = isset( $body['template_id'] ) ? sanitize_key( (string) $body['template_id'] ) : '';
	$entry       = wpdm_routine_template_registry( $template_id );
	if ( ! is_array( $entry ) ) {
		return new WP_Error( 'wpdm_routine_template_unknown', sprintf( 'Template `%s` is not registered.', $template_id ), array( 'status' => 404 ) );
	}
	$title = isset( $body['title'] ) ? (string) $body['title'] : (string) $entry['title'];
	$id    = wpdm_routine_save(
		array(
			'id'      => 0,
			'title'   => $title,
			'enabled' => false,
			'def'     => $entry['def'],
		)
	);
	if ( is_wp_error( $id ) ) {
		return $id;
	}
	return rest_ensure_response( wpdm_routine_get( (int) $id ) );
}
