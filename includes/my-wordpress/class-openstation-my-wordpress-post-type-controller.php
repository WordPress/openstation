<?php
/**
 * OpenStation — My WordPress: the non-REST post type bridge controller.
 *
 * Registration and the reasoning behind the bridge live in
 * `rest-post-type.php`; this file holds only the controller class.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Read-and-trash REST controller for a post type that is not exposed
 * on `wp/v2`.
 */
class OpenStation_My_WordPress_Post_Type_Controller extends WP_REST_Posts_Controller {

	/**
	 * Constructor.
	 *
	 * Core resolves the namespace and base from the post type object;
	 * for a non-REST type those are empty or point at `wp/v2`, so both
	 * are re-pointed at our own namespace.
	 *
	 * @param string $post_type Post type slug.
	 */
	public function __construct( $post_type ) {
		parent::__construct( $post_type );

		$this->namespace = OPENSTATION_MY_WORDPRESS_POST_TYPE_NAMESPACE;
		$this->rest_base = 'post-type/' . $post_type;
	}

	/**
	 * Register the read + trash routes.
	 *
	 * Deliberately not `parent::register_routes()` — that would add
	 * create/update endpoints for a type whose author never opted into
	 * a REST write surface.
	 *
	 * @return void
	 */
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

	/**
	 * Whether the current user may read this collection.
	 *
	 * Core allows public reads in `view` context. Because the type
	 * opted out of REST, this bridge requires the edit capability in
	 * every context instead.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return true|WP_Error
	 */
	public function get_items_permissions_check( $request ) {
		$denied = $this->openstation_require_edit_capability();
		if ( is_wp_error( $denied ) ) {
			return $denied;
		}
		return parent::get_items_permissions_check( $request );
	}

	/**
	 * Whether the current user may read a single item.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return true|WP_Error
	 */
	public function get_item_permissions_check( $request ) {
		$denied = $this->openstation_require_edit_capability();
		if ( is_wp_error( $denied ) ) {
			return $denied;
		}
		return parent::get_item_permissions_check( $request );
	}

	/**
	 * Whether the current user may trash a single item.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return true|WP_Error
	 */
	public function delete_item_permissions_check( $request ) {
		$denied = $this->openstation_require_edit_capability();
		if ( is_wp_error( $denied ) ) {
			return $denied;
		}
		return parent::delete_item_permissions_check( $request );
	}

	/**
	 * Treat this controller's own post type as REST-visible.
	 *
	 * Core uses `check_is_post_type_allowed()` as the "does this type
	 * have a REST collection at all" test, and it answers by reading
	 * `show_in_rest` — which is false by definition for everything this
	 * controller serves. Left inherited, `check_read_permission()` and
	 * `check_delete_permission()` reject every row and the collection
	 * comes back empty.
	 *
	 * The override is scoped to `$this->post_type` so the surrounding
	 * status and capability checks in those methods still run
	 * unchanged, and any other type still answers Core's way.
	 *
	 * @param string|WP_Post_Type $post_type Post type name or object.
	 * @return bool
	 */
	protected function check_is_post_type_allowed( $post_type ) {
		$name = is_object( $post_type ) ? $post_type->name : (string) $post_type;
		if ( $name === $this->post_type ) {
			return true;
		}
		return parent::check_is_post_type_allowed( $post_type );
	}

	/**
	 * Point `self` and `collection` at the bridge routes.
	 *
	 * `rest_get_route_for_post()` and `rest_get_route_for_post_type_items()`
	 * both return an empty string for a type that isn't `show_in_rest`,
	 * and both bail *before* applying their own filters — so there is
	 * no hook to correct them from. Without this the two links resolve
	 * to the bare REST root.
	 *
	 * `wp:featuredmedia` needs no fixing: it is built from the
	 * attachment's route, and `attachment` is REST-exposed.
	 *
	 * @param WP_Post $post Post object.
	 * @return array Links.
	 */
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

	/**
	 * Gate every route behind the post type's `edit_posts` capability.
	 *
	 * @return true|WP_Error
	 */
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
