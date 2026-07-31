<?php
/**
 * FeedBuddy REST controller.
 *
 * @package DesktopModeFeedBuddy
 */

defined( 'ABSPATH' ) || exit;

/**
 * Authenticated per-user REST API.
 */
class Feed_Buddy_REST_Controller {

	/**
	 * Feed service.
	 *
	 * @var Feed_Buddy_Service
	 */
	private $service;

	/**
	 * Store the feed service.
	 *
	 * @param Feed_Buddy_Service $service Feed service.
	 */
	public function __construct( Feed_Buddy_Service $service ) {
		$this->service = $service;
	}

	/**
	 * Register the WordPress hook.
	 */
	public function boot() {
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
	}

	/**
	 * Register the public plugin routes.
	 */
	public function register_routes() {
		$permission = array( $this, 'check_permission' );

		register_rest_route(
			'feed-buddy/v1',
			'/state',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_state' ),
					'permission_callback' => $permission,
				),
				array(
					'methods'             => WP_REST_Server::EDITABLE,
					'callback'            => array( $this, 'update_state' ),
					'permission_callback' => $permission,
				),
			)
		);

		register_rest_route(
			'feed-buddy/v1',
			'/subscriptions',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'create_subscription' ),
				'permission_callback' => $permission,
			)
		);

		register_rest_route(
			'feed-buddy/v1',
			'/subscriptions/(?P<id>[a-f0-9-]+)',
			array(
				array(
					'methods'             => WP_REST_Server::EDITABLE,
					'callback'            => array( $this, 'update_subscription' ),
					'permission_callback' => $permission,
				),
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'callback'            => array( $this, 'delete_subscription' ),
					'permission_callback' => $permission,
				),
			)
		);

		register_rest_route(
			'feed-buddy/v1',
			'/items',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'get_items' ),
				'permission_callback' => $permission,
				'args'                => array(
					'feed_id' => array( 'type' => 'string' ),
					'cursor'  => array(
						'type'    => 'integer',
						'default' => 0,
						'minimum' => 0,
					),
					'unread'  => array(
						'type'    => 'boolean',
						'default' => false,
					),
				),
			)
		);

		register_rest_route(
			'feed-buddy/v1',
			'/read',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'update_read_state' ),
				'permission_callback' => $permission,
			)
		);

		register_rest_route(
			'feed-buddy/v1',
			'/refresh',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'refresh' ),
				'permission_callback' => $permission,
			)
		);
	}

	/**
	 * Require an authenticated user with the baseline read capability.
	 *
	 * @return true|WP_Error
	 */
	public function check_permission() {
		if ( ! is_user_logged_in() ) {
			return new WP_Error(
				'rest_forbidden',
				__( 'You must be logged in.', 'desktop-mode-feed-buddy' ),
				array( 'status' => 401 )
			);
		}
		if ( ! current_user_can( 'read' ) ) {
			return new WP_Error(
				'rest_forbidden',
				__( 'You do not have permission to use SOL Inbound Monologue.', 'desktop-mode-feed-buddy' ),
				array( 'status' => 403 )
			);
		}
		return true;
	}

	/**
	 * Return the current user's subscriptions and summaries.
	 *
	 * @return WP_REST_Response
	 */
	public function get_state() {
		return rest_ensure_response( $this->service->get_state( get_current_user_id() ) );
	}

	/**
	 * Update supported user preferences.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response
	 */
	public function update_state( WP_REST_Request $request ) {
		$input = $request->get_json_params();
		$input = is_array( $input ) ? $input : array();
		return rest_ensure_response(
			$this->service->update_preferences( get_current_user_id(), $input )
		);
	}

	/**
	 * Create a subscription for the current user.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function create_subscription( WP_REST_Request $request ) {
		$input = $request->get_json_params();
		$input = is_array( $input ) ? $input : array();
		return rest_ensure_response(
			$this->service->add_subscription( get_current_user_id(), $input )
		);
	}

	/**
	 * Update a subscription owned by the current user.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function update_subscription( WP_REST_Request $request ) {
		$input = $request->get_json_params();
		$input = is_array( $input ) ? $input : array();
		return rest_ensure_response(
			$this->service->update_subscription(
				get_current_user_id(),
				(string) $request['id'],
				$input
			)
		);
	}

	/**
	 * Delete a subscription owned by the current user.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function delete_subscription( WP_REST_Request $request ) {
		return rest_ensure_response(
			$this->service->delete_subscription( get_current_user_id(), (string) $request['id'] )
		);
	}

	/**
	 * Return a cursor page of normalized feed items.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function get_items( WP_REST_Request $request ) {
		$feed_id = $request->get_param( 'feed_id' );
		return rest_ensure_response(
			$this->service->get_items(
				get_current_user_id(),
				$feed_id ? sanitize_text_field( (string) $feed_id ) : null,
				(int) $request->get_param( 'cursor' ),
				rest_sanitize_boolean( $request->get_param( 'unread' ) )
			)
		);
	}

	/**
	 * Update item, feed, or global read state.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function update_read_state( WP_REST_Request $request ) {
		$input = $request->get_json_params();
		$input = is_array( $input ) ? $input : array();
		return rest_ensure_response(
			$this->service->update_read_state( get_current_user_id(), $input )
		);
	}

	/**
	 * Refresh one or all subscriptions.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function refresh( WP_REST_Request $request ) {
		$input   = $request->get_json_params();
		$input   = is_array( $input ) ? $input : array();
		$feed_id = isset( $input['feedId'] ) ? sanitize_text_field( (string) $input['feedId'] ) : null;
		return rest_ensure_response( $this->service->refresh( get_current_user_id(), $feed_id ) );
	}
}
