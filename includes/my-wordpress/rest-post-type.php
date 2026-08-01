<?php
/**
 * Desktop Mode — My WordPress: REST bridge for non-REST post types.
 *
 * Post types registered with `show_in_rest => false` have no `wp/v2`
 * collection, so the site window cannot browse them the way it browses
 * Posts or Products. This module re-exposes them under
 * `desktop-mode/v1/post-type/<slug>` by subclassing Core's own
 * `WP_REST_Posts_Controller`, which means `_fields`, `_embed`,
 * `search`, `status`, `X-WP-Total` and `X-WP-TotalPages` all behave
 * exactly as they do on `wp/v2` — the bundle needs no special-casing,
 * only a different `restPath`.
 *
 * ## Security
 *
 * These types opted out of REST deliberately, so the bridge is
 * deliberately narrower than Core's controller:
 *
 *   - Core's `get_items_permissions_check()` returns true for any
 *     non-`edit` context, i.e. public read. We override it (and the
 *     single-item check) to require the type's `edit_posts` capability
 *     in **every** context. Never anonymous, never subscriber-readable.
 *   - Only `GET` collection, `GET` item, and `DELETE` item (trash, for
 *     recycle-bin parity) are registered. No create, no update — a
 *     write schema the type's author never vetted is a footgun.
 *   - `desktop_mode_my_wordpress_post_type_rest_enabled` lets a site or
 *     the owning plugin veto the bridge per type.
 *
 * @package WPDesktopMode
 */

defined( 'ABSPATH' ) || exit;

/**
 * Read-and-trash REST controller for a post type that is not exposed
 * on `wp/v2`.
 */
class Desktop_Mode_My_WordPress_Post_Type_Controller extends WP_REST_Posts_Controller {

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

		$this->namespace = DESKTOP_MODE_MY_WORDPRESS_POST_TYPE_NAMESPACE;
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
		$denied = $this->desktop_mode_require_edit_capability();
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
		$denied = $this->desktop_mode_require_edit_capability();
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
		$denied = $this->desktop_mode_require_edit_capability();
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
	protected function desktop_mode_require_edit_capability() {
		$post_type = get_post_type_object( $this->post_type );
		if ( ! $post_type instanceof WP_Post_Type || empty( $post_type->cap->edit_posts ) ) {
			return new WP_Error(
				'desktop_mode_rest_unknown_post_type',
				__( 'Sorry, that content type is not available.', 'desktop-mode' ),
				array( 'status' => 404 )
			);
		}

		if ( ! current_user_can( $post_type->cap->edit_posts ) ) {
			return new WP_Error(
				'desktop_mode_rest_forbidden',
				__( 'Sorry, you are not allowed to browse this content type.', 'desktop-mode' ),
				array( 'status' => rest_authorization_required_code() )
			);
		}

		return true;
	}
}

/**
 * Register a bridge controller for every eligible non-REST post type.
 *
 * Runs on `rest_api_init`, which fires well after `init`, so post type
 * discovery is complete by the time this executes.
 *
 * @return void
 */
function desktop_mode_my_wordpress_register_post_type_routes() {
	if ( ! desktop_mode_my_wordpress_user_can_use() ) {
		return;
	}

	foreach ( desktop_mode_my_wordpress_eligible_post_types() as $name => $post_type ) {
		if ( ! empty( $post_type->show_in_rest ) ) {
			continue;
		}
		if ( ! desktop_mode_my_wordpress_post_type_is_bridged( $name ) ) {
			continue;
		}
		$controller = new Desktop_Mode_My_WordPress_Post_Type_Controller( $name );
		$controller->register_routes();
	}
}
add_action( 'rest_api_init', 'desktop_mode_my_wordpress_register_post_type_routes' );
