<?php
/**
 * Cron Manager REST routes.
 *
 * REST namespace: `/desktop-mode-cron-manager/v1`.
 *
 * @package DesktopModeCronManager
 * @since   0.22.0
 */

defined( 'ABSPATH' ) || exit;

const DESKTOP_MODE_CRON_MANAGER_REST_NAMESPACE = 'desktop-mode-cron-manager/v1';

/**
 * Register REST routes.
 *
 * @since 0.22.0
 */
function desktop_mode_cron_manager_register_rest_routes() {
	register_rest_route(
		DESKTOP_MODE_CRON_MANAGER_REST_NAMESPACE,
		'/events',
		array(
			array(
				'methods'             => WP_REST_Server::READABLE,
				'permission_callback' => 'desktop_mode_cron_manager_rest_permission',
				'callback'            => 'desktop_mode_cron_manager_rest_list_events',
			),
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => 'desktop_mode_cron_manager_rest_permission',
				'callback'            => 'desktop_mode_cron_manager_rest_create_event',
			),
			array(
				'methods'             => WP_REST_Server::EDITABLE,
				'permission_callback' => 'desktop_mode_cron_manager_rest_permission',
				'callback'            => 'desktop_mode_cron_manager_rest_update_event',
			),
			array(
				'methods'             => WP_REST_Server::DELETABLE,
				'permission_callback' => 'desktop_mode_cron_manager_rest_permission',
				'callback'            => 'desktop_mode_cron_manager_rest_delete_event',
			),
		)
	);

	register_rest_route(
		DESKTOP_MODE_CRON_MANAGER_REST_NAMESPACE,
		'/schedules',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'permission_callback' => 'desktop_mode_cron_manager_rest_permission',
			'callback'            => 'desktop_mode_cron_manager_rest_list_schedules',
		)
	);

	register_rest_route(
		DESKTOP_MODE_CRON_MANAGER_REST_NAMESPACE,
		'/events/run-now',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'permission_callback' => 'desktop_mode_cron_manager_rest_permission',
			'callback'            => 'desktop_mode_cron_manager_rest_run_now',
		)
	);
}
add_action( 'rest_api_init', 'desktop_mode_cron_manager_register_rest_routes' );

/**
 * Permission gate for every Cron Manager REST route.
 *
 * @since 0.22.0
 *
 * @return true|WP_Error
 */
function desktop_mode_cron_manager_rest_permission() {
	if ( ! is_user_logged_in() ) {
		return new WP_Error(
			'desktop_mode_cron_unauthenticated',
			__( 'You must be logged in to manage cron jobs.', 'desktop-mode-cron-manager' ),
			array( 'status' => 401 )
		);
	}
	if ( ! desktop_mode_cron_manager_user_can_use() ) {
		return new WP_Error(
			'desktop_mode_cron_forbidden',
			__( 'You do not have permission to manage cron jobs.', 'desktop-mode-cron-manager' ),
			array( 'status' => 403 )
		);
	}
	return true;
}

/**
 * GET /events.
 *
 * @since 0.22.0
 *
 * @return WP_REST_Response
 */
function desktop_mode_cron_manager_rest_list_events() {
	return rest_ensure_response(
		array(
			'events' => desktop_mode_cron_manager_list_events(),
		)
	);
}

/**
 * GET /schedules.
 *
 * @since 0.22.0
 *
 * @return WP_REST_Response
 */
function desktop_mode_cron_manager_rest_list_schedules() {
	return rest_ensure_response(
		array(
			'schedules' => desktop_mode_cron_manager_get_schedules_payload(),
		)
	);
}

/**
 * POST /events.
 *
 * @since 0.22.0
 *
 * @param WP_REST_Request $request REST request.
 * @return WP_REST_Response|WP_Error
 */
function desktop_mode_cron_manager_rest_create_event( WP_REST_Request $request ) {
	$result = desktop_mode_cron_manager_create_event( $request->get_json_params() );
	if ( is_wp_error( $result ) ) {
		return $result;
	}
	return rest_ensure_response( $result );
}

/**
 * PUT/PATCH /events.
 *
 * @since 0.22.0
 *
 * @param WP_REST_Request $request REST request.
 * @return WP_REST_Response|WP_Error
 */
function desktop_mode_cron_manager_rest_update_event( WP_REST_Request $request ) {
	$params   = $request->get_json_params();
	$identity = is_array( $params ) && isset( $params['identity'] ) ? $params['identity'] : null;
	$event    = is_array( $params ) && isset( $params['event'] ) ? $params['event'] : null;
	$result   = desktop_mode_cron_manager_update_event( $identity, $event );
	if ( is_wp_error( $result ) ) {
		return $result;
	}
	return rest_ensure_response( $result );
}

/**
 * DELETE /events.
 *
 * @since 0.22.0
 *
 * @param WP_REST_Request $request REST request.
 * @return WP_REST_Response|WP_Error
 */
function desktop_mode_cron_manager_rest_delete_event( WP_REST_Request $request ) {
	$params   = $request->get_json_params();
	$identity = is_array( $params ) && isset( $params['identity'] ) ? $params['identity'] : null;
	$result   = desktop_mode_cron_manager_delete_event( $identity );
	if ( is_wp_error( $result ) ) {
		return $result;
	}
	return rest_ensure_response( $result );
}

/**
 * POST /events/run-now.
 *
 * @since 0.22.0
 *
 * @param WP_REST_Request $request REST request.
 * @return WP_REST_Response|WP_Error
 */
function desktop_mode_cron_manager_rest_run_now( WP_REST_Request $request ) {
	$params   = $request->get_json_params();
	$identity = is_array( $params ) && isset( $params['identity'] ) ? $params['identity'] : null;
	$result   = desktop_mode_cron_manager_run_event_now( $identity );
	if ( is_wp_error( $result ) ) {
		return $result;
	}
	return rest_ensure_response( $result );
}
