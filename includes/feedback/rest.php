<?php
/**
 * OpenStation — deactivation feedback REST route.
 *
 * `POST /desktop-mode/v1/feedback/deactivation` builds the payload,
 * forwards it and answers `{ sent: bool }`. It never errors on a
 * failed forward: the browser deactivates on any answer, and a red
 * response would only delay someone who is already leaving.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register the route.
 */
function openstation_register_deactivation_feedback_route() {
	register_rest_route(
		'desktop-mode/v1',
		'/feedback/deactivation',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'callback'            => 'openstation_rest_deactivation_feedback',
			'permission_callback' => 'openstation_rest_deactivation_feedback_permission',
			'args'                => array(
				'reasons' => array(
					'required' => true,
					'type'     => 'array',
					'minItems' => 1,
					'items'    => array(
						'type' => 'string',
						'enum' => OPENSTATION_FEEDBACK_REASONS,
					),
				),
				'details' => array(
					'type'    => 'string',
					'default' => '',
				),
				'context' => array(
					'type'    => 'string',
					'enum'    => OPENSTATION_FEEDBACK_CONTEXTS,
					'default' => 'classic',
				),
			),
		)
	);
}
add_action( 'rest_api_init', 'openstation_register_deactivation_feedback_route' );

/**
 * Permission gate: `activate_plugins` plus the feature flag.
 *
 * Deliberately NOT {@see openstation_rest_require_enabled()}: the
 * person deactivating usually does not have OpenStation on, and that
 * is the whole point of asking. There is no object-level check
 * because the route stores nothing on the site.
 *
 * @return true|WP_Error
 */
function openstation_rest_deactivation_feedback_permission() {
	if ( ! is_user_logged_in() ) {
		return new WP_Error(
			'rest_forbidden',
			__( 'Authentication required.', 'desktop-mode' ),
			array( 'status' => 401 )
		);
	}
	if ( ! current_user_can( 'activate_plugins' ) || ! openstation_deactivation_feedback_enabled() ) {
		return new WP_Error(
			'rest_forbidden',
			__( 'You are not allowed to do that.', 'desktop-mode' ),
			array( 'status' => 403 )
		);
	}
	return true;
}

/**
 * Handler: build, filter, forward.
 *
 * @param WP_REST_Request $request REST request.
 * @return WP_REST_Response
 */
function openstation_rest_deactivation_feedback( WP_REST_Request $request ) {
	$payload = openstation_deactivation_feedback_payload(
		(array) $request->get_param( 'reasons' ),
		(string) $request->get_param( 'details' ),
		(string) $request->get_param( 'context' )
	);

	/**
	 * Filters the payload before it is forwarded. Return an empty
	 * array to suppress the send entirely.
	 *
	 * @param array $payload The anonymous submission.
	 */
	$payload = (array) apply_filters( 'openstation_deactivation_feedback_payload', $payload );

	$sent = ! empty( $payload ) && openstation_deactivation_feedback_forward( $payload );

	return rest_ensure_response( array( 'sent' => (bool) $sent ) );
}
