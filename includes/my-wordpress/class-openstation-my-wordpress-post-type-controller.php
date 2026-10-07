<?php

defined( 'ABSPATH' ) || exit;

class OpenStation_My_WordPress_Post_Type_Controller extends WP_REST_Posts_Controller {

	public function __construct( $post_type ) {
		parent::__construct( $post_type );

		$this->namespace = OPENSTATION_MY_WORDPRESS_POST_TYPE_NAMESPACE;
		$this->rest_base = 'post-type/' . $post_type;
	}

	public function register_routes() {
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base,
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_items' ),
					'permission_callback' => array( $this, 'get_items_permissions_check' ),
					'args'                => $this->get_collection_params(),
				),
				'schema' => array( $this, 'get_public_item_schema' ),
			)
		);

		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/(?P<id>[\d]+)',
			array(
				'args'   => array(
					'id' => array(
						'description' => __( 'Unique identifier for the post.', 'desktop-mode' ),
						'type'        => 'integer',
					),
				),
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_item' ),
					'permission_callback' => array( $this, 'get_item_permissions_check' ),
					'args'                => array(
						'context'  => $this->get_context_param( array( 'default' => 'view' ) ),
						'password' => array(
							'description' => __( 'The password for the post if it is password protected.', 'desktop-mode' ),
							'type'        => 'string',
						),
					),
				),
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'callback'            => array( $this, 'delete_item' ),
					'permission_callback' => array( $this, 'delete_item_permissions_check' ),
					'args'                => array(
						'force' => array(
							'type'        => 'boolean',
							'default'     => false,
							'description' => __( 'Whether to bypass Trash and force deletion.', 'desktop-mode' ),
						),
					),
				),
				'schema' => array( $this, 'get_public_item_schema' ),
			)
		);
	}

	public function get_items_permissions_check( $request ) {
		$denied = $this->openstation_require_edit_capability();
		if ( is_wp_error( $denied ) ) {
			return $denied;
		}
		return parent::get_items_permissions_check( $request );
	}

	public function get_item_permissions_check( $request ) {
		$denied = $this->openstation_require_edit_capability();
		if ( is_wp_error( $denied ) ) {
			return $denied;
		}
		return parent::get_item_permissions_check( $request );
	}

	public function delete_item_permissions_check( $request ) {
		$denied = $this->openstation_require_edit_capability();
		if ( is_wp_error( $denied ) ) {
			return $denied;
		}
		return parent::delete_item_permissions_check( $request );
	}

	protected function check_is_post_type_allowed( $post_type ) {
		$name = is_object( $post_type ) ? $post_type->name : (string) $post_type;
		if ( $name === $this->post_type ) {
			return true;
		}
		return parent::check_is_post_type_allowed( $post_type );
	}

	protected function prepare_links( $post ) {
		$links = parent::prepare_links( $post );

		$links['self']['href']       = rest_url(
			sprintf( '%s/%s/%d', $this->namespace, $this->rest_base, $post->ID )
		);
		$links['collection']['href'] = rest_url(
			sprintf( '%s/%s', $this->namespace, $this->rest_base )
		);

		return $links;
	}

	protected function openstation_require_edit_capability() {
		$post_type = get_post_type_object( $this->post_type );
		if ( ! $post_type instanceof WP_Post_Type || empty( $post_type->cap->edit_posts ) ) {
			return new WP_Error(
				'openstation_rest_unknown_post_type',
				__( 'Sorry, that content type is not available.', 'desktop-mode' ),
				array( 'status' => 404 )
			);
		}

		if ( ! current_user_can( $post_type->cap->edit_posts ) ) {
			return new WP_Error(
				'openstation_rest_forbidden',
				__( 'Sorry, you are not allowed to browse this content type.', 'desktop-mode' ),
				array( 'status' => rest_authorization_required_code() )
			);
		}

		return true;
	}
}
