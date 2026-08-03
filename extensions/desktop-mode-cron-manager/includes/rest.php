<?php
/**
 * Cron Manager REST routes.
 *
 * REST namespace: `/desktop-mode-cron-manager/v1`.
 *
 * @package OpenStationCronManager
 */

defined( 'ABSPATH' ) || exit;

const OPENSTATION_CRON_MANAGER_REST_NAMESPACE = 'desktop-mode-cron-manager/v1';

/**
 * Register REST routes.
 */
function openstation_cron_manager_register_rest_routes() {
	register_rest_route(
		OPENSTATION_CRON_MANAGER_REST_NAMESPACE,
		'/events',
		array(
			array(
				'methods'             => WP_REST_Server::READABLE,
				'permission_callback' => 'openstation_cron_manager_rest_permission',
				'callback'            => 'openstation_cron_manager_rest_list_events',
			),
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => 'openstation_cron_manager_rest_permission',
				'callback'            => 'openstation_cron_manager_rest_create_event',
			),
			array(
				'methods'             => WP_REST_Server::EDITABLE,
				'permission_callback' => 'openstation_cron_manager_rest_permission',
				'callback'            => 'openstation_cron_manager_rest_update_event',
			),
			array(
				'methods'             => WP_REST_Server::DELETABLE,
				'permission_callback' => 'openstation_cron_manager_rest_permission',
				'callback'            => 'openstation_cron_manager_rest_delete_event',
			),
		)
	);

	register_rest_route(
		OPENSTATION_CRON_MANAGER_REST_NAMESPACE,
		'/schedules',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'permission_callback' => 'openstation_cron_manager_rest_permission',
			'callback'            => 'openstation_cron_manager_rest_list_schedules',
		)
	);

	register_rest_route(
		OPENSTATION_CRON_MANAGER_REST_NAMESPACE,
		'/events/run-now',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'permission_callback' => 'openstation_cron_manager_rest_permission',
			'callback'            => 'openstation_cron_manager_rest_run_now',
		)
	);
}
add_action( 'rest_api_init', 'openstation_cron_manager_register_rest_routes' );

/**
 * Permission gate for every Cron Manager REST route.
 *
 * @return true|WP_Error
 */
function openstation_cron_manager_rest_permission() {
	if ( ! is_user_logged_in() ) {
		return new WP_Error(
			'openstation_cron_unauthenticated',
			__( 'You must be logged in to manage cron jobs.', 'desktop-mode-cron-manager' ),
			array( 'status' => 401 )
		);
	}
	if ( ! openstation_cron_manager_user_can_use() ) {
		return new WP_Error(
			'openstation_cron_forbidden',
			__( 'You do not have permission to manage cron jobs.', 'desktop-mode-cron-manager' ),
			array( 'status' => 403 )
		);
	}
	return true;
}

/**
 * GET /events.
 *
 * @return WP_REST_Response
 */
function openstation_cron_manager_rest_list_events() {
	return rest_ensure_response(
		array(
			'events' => openstation_cron_manager_list_events(),
		)
	);
}

/**
 * GET /schedules.
 *
 * @return WP_REST_Response
 */
function openstation_cron_manager_rest_list_schedules() {
	return rest_ensure_response(
		array(
			'schedules' => openstation_cron_manager_get_schedules_payload(),
		)
	);
}

/**
 * POST /events.
 *
 * @param WP_REST_Request $request REST request.
 * @return WP_REST_Response|WP_Error
 */
function openstation_cron_manager_rest_create_event( WP_REST_Request $request ) {
	$result = openstation_cron_manager_create_event( $request->get_json_params() );
	if ( is_wp_error( $result ) ) {
		return $result;
	}
	return rest_ensure_response( $result );
}

/**
 * PUT/PATCH /events.
 *
 * @param WP_REST_Request $request REST request.
 * @return WP_REST_Response|WP_Error
 */
function openstation_cron_manager_rest_update_event( WP_REST_Request $request ) {
	$params   = $request->get_json_params();
	$identity = is_array( $params ) && isset( $params['identity'] ) ? $params['identity'] : null;
	$event    = is_array( $params ) && isset( $params['event'] ) ? $params['event'] : null;
	$result   = openstation_cron_manager_update_event( $identity, $event );
	if ( is_wp_error( $result ) ) {
		return $result;
	}
	return rest_ensure_response( $result );
}

/**
 * DELETE /events.
 *
 * @param WP_REST_Request $request REST request.
 * @return WP_REST_Response|WP_Error
 */
function openstation_cron_manager_rest_delete_event( WP_REST_Request $request ) {
	$params   = $request->get_json_params();
	$identity = is_array( $params ) && isset( $params['identity'] ) ? $params['identity'] : null;
	$result   = openstation_cron_manager_delete_event( $identity );
	if ( is_wp_error( $result ) ) {
		return $result;
	}
	return rest_ensure_response( $result );
}

/**
 * POST /events/run-now.
 *
 * @param WP_REST_Request $request REST request.
 * @return WP_REST_Response|WP_Error
 */
function openstation_cron_manager_rest_run_now( WP_REST_Request $request ) {
	$params   = $request->get_json_params();
	$identity = is_array( $params ) && isset( $params['identity'] ) ? $params['identity'] : null;
	$result   = openstation_cron_manager_run_event_now( $identity );
	if ( is_wp_error( $result ) ) {
		return $result;
	}
	return rest_ensure_response( $result );
}
