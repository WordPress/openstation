<?php
/**
 * Tests for the `/desktop-mode/v1/post-type/<slug>` bridge that lets
 * the site window browse post types registered with
 * `show_in_rest => false`.
 *
 * The bridge re-exposes content its author kept off the REST API, so
 * the capability gate is the most important thing here: Core's own
 * `WP_REST_Posts_Controller` permits public reads in `view` context,
 * and the subclass must not inherit that.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-my-wordpress
 */
class Tests_DesktopMode_MyWordpressPostTypeRest extends WP_UnitTestCase {

	protected static $admin_id;
	protected static $subscriber_id;

	protected $post_ids = array();

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id      = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$subscriber_id = $factory->user->create( array( 'role' => 'subscriber' ) );
	}

	public function set_up() {
		parent::set_up();

		wp_set_current_user( self::$admin_id );

		register_post_type(
			'dm_coupon',
			array(
				'label'        => 'Coupons',
				'public'       => true,
				'show_ui'      => true,
				'show_in_rest' => false,
				'supports'     => array( 'title', 'editor', 'thumbnail' ),
			)
		);

		// A REST-exposed sibling — must never get a bridge route.
		register_post_type(
			'dm_book',
			array(
				'label'        => 'Books',
				'public'       => true,
				'show_ui'      => true,
				'show_in_rest' => true,
				'supports'     => array( 'title' ),
			)
		);

		for ( $i = 0; $i < 3; $i++ ) {
			$this->post_ids[] = self::factory()->post->create(
				array(
					'post_type'   => 'dm_coupon',
					'post_status' => 'publish',
					'post_title'  => 'Coupon ' . $i,
				)
			);
		}

		// Routes are registered on `rest_api_init`, after discovery.
		do_action( 'rest_api_init' );
	}

	public function tear_down() {
		foreach ( array( 'dm_coupon', 'dm_book' ) as $type ) {
			if ( post_type_exists( $type ) ) {
				unregister_post_type( $type );
			}
		}
		remove_all_filters( 'desktop_mode_my_wordpress_post_type_rest_enabled' );
		remove_all_filters( 'desktop_mode_my_wordpress_user_can_use' );
		$this->post_ids = array();
		parent::tear_down();
	}

	/**
	 * @param string $method HTTP method.
	 * @param string $path   Route path.
	 * @return WP_REST_Response
	 */
	protected function dispatch( $method, $path ) {
		return rest_get_server()->dispatch( new WP_REST_Request( $method, $path ) );
	}

	/**
	 * @covers ::desktop_mode_my_wordpress_register_post_type_routes
	 */
	public function test_route_is_registered_for_non_rest_type() {
		$routes = rest_get_server()->get_routes();

		$this->assertArrayHasKey( '/desktop-mode/v1/post-type/dm_coupon', $routes );
	}

	/**
	 * A type that already has a `wp/v2` collection needs no bridge.
	 *
	 * @covers ::desktop_mode_my_wordpress_register_post_type_routes
	 */
	public function test_no_route_for_rest_exposed_type() {
		$routes = rest_get_server()->get_routes();

		$this->assertArrayNotHasKey( '/desktop-mode/v1/post-type/dm_book', $routes );
	}

	/**
	 * In production the route is never registered for a user who
	 * can't use the site window — they get a 404 before any
	 * permission callback runs. The 401/403 tests above cover the
	 * callback itself (defence in depth, since the routes are
	 * registered per-request); this covers the outer gate.
	 *
	 * @covers ::desktop_mode_my_wordpress_register_post_type_routes
	 */
	public function test_routes_are_not_registered_for_users_who_cannot_use_the_window() {
		foreach ( array( 0, self::$subscriber_id ) as $user_id ) {
			wp_set_current_user( $user_id );

			// Rebuild the server so registration re-runs as this user.
			global $wp_rest_server;
			$wp_rest_server = null;
			add_action( 'rest_api_init', 'desktop_mode_my_wordpress_register_post_type_routes' );

			$this->assertArrayNotHasKey(
				'/desktop-mode/v1/post-type/dm_coupon',
				rest_get_server()->get_routes(),
				'route registered for user ' . $user_id
			);
		}
	}

	/**
	 * @covers ::desktop_mode_my_wordpress_register_post_type_routes
	 */
	public function test_rest_enabled_filter_suppresses_registration() {
		remove_all_actions( 'rest_api_init' );
		rest_get_server()->override_by_default = false;

		add_filter( 'desktop_mode_my_wordpress_post_type_rest_enabled', '__return_false' );

		// Rebuild the server so route registration runs again.
		global $wp_rest_server;
		$wp_rest_server = null;
		require_once ABSPATH . WPINC . '/rest-api.php';
		add_action( 'rest_api_init', 'desktop_mode_my_wordpress_register_post_type_routes' );
		$routes = rest_get_server()->get_routes();

		$this->assertArrayNotHasKey( '/desktop-mode/v1/post-type/dm_coupon', $routes );
	}

	/**
	 * @covers Desktop_Mode_My_WordPress_Post_Type_Controller::get_items
	 */
	public function test_editor_can_list_items() {
		$response = $this->dispatch( 'GET', '/desktop-mode/v1/post-type/dm_coupon' );

		$this->assertSame( 200, $response->get_status() );
		$this->assertCount( 3, $response->get_data() );
	}

	/**
	 * Pagination headers are what the bundle's infinite scroll and
	 * folder counters read.
	 *
	 * @covers Desktop_Mode_My_WordPress_Post_Type_Controller::get_items
	 */
	public function test_list_sends_total_headers() {
		$request = new WP_REST_Request( 'GET', '/desktop-mode/v1/post-type/dm_coupon' );
		$request->set_param( 'per_page', 2 );
		$response = rest_get_server()->dispatch( $request );
		$headers  = $response->get_headers();

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 3, (int) $headers['X-WP-Total'] );
		$this->assertSame( 2, (int) $headers['X-WP-TotalPages'] );
	}

	/**
	 * The bridge exists so the shell can browse these types — it must
	 * never become a public read endpoint for content its author kept
	 * off the REST API.
	 *
	 * @covers Desktop_Mode_My_WordPress_Post_Type_Controller::get_items_permissions_check
	 */
	public function test_logged_out_is_denied() {
		wp_set_current_user( 0 );

		$response = $this->dispatch( 'GET', '/desktop-mode/v1/post-type/dm_coupon' );

		$this->assertSame( 401, $response->get_status() );
	}

	/**
	 * @covers Desktop_Mode_My_WordPress_Post_Type_Controller::get_items_permissions_check
	 */
	public function test_subscriber_is_denied() {
		wp_set_current_user( self::$subscriber_id );

		$response = $this->dispatch( 'GET', '/desktop-mode/v1/post-type/dm_coupon' );

		$this->assertSame( 403, $response->get_status() );
	}

	/**
	 * @covers Desktop_Mode_My_WordPress_Post_Type_Controller::get_item_permissions_check
	 */
	public function test_single_item_is_gated_too() {
		$id = $this->post_ids[0];

		$ok = $this->dispatch( 'GET', '/desktop-mode/v1/post-type/dm_coupon/' . $id );
		$this->assertSame( 200, $ok->get_status() );
		$this->assertSame( $id, $ok->get_data()['id'] );

		wp_set_current_user( 0 );
		$denied = $this->dispatch( 'GET', '/desktop-mode/v1/post-type/dm_coupon/' . $id );
		$this->assertSame( 401, $denied->get_status() );
	}

	/**
	 * Trash parity with `wp/v2` — the recycle bin drops tiles here.
	 *
	 * @covers Desktop_Mode_My_WordPress_Post_Type_Controller::register_routes
	 */
	public function test_delete_trashes_the_post() {
		$id = $this->post_ids[0];

		$response = $this->dispatch( 'DELETE', '/desktop-mode/v1/post-type/dm_coupon/' . $id );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 'trash', get_post_status( $id ) );
	}

	/**
	 * @covers Desktop_Mode_My_WordPress_Post_Type_Controller::delete_item_permissions_check
	 */
	public function test_subscriber_cannot_trash() {
		$id = $this->post_ids[0];
		wp_set_current_user( self::$subscriber_id );

		$response = $this->dispatch( 'DELETE', '/desktop-mode/v1/post-type/dm_coupon/' . $id );

		$this->assertSame( 403, $response->get_status() );
		$this->assertSame( 'publish', get_post_status( $id ) );
	}

	/**
	 * Only read + trash are registered. A write schema the type's
	 * author never vetted is not ours to expose.
	 *
	 * @covers Desktop_Mode_My_WordPress_Post_Type_Controller::register_routes
	 */
	public function test_create_and_update_are_not_registered() {
		$routes = rest_get_server()->get_routes();

		$collection = $routes['/desktop-mode/v1/post-type/dm_coupon'];
		$methods    = array();
		foreach ( $collection as $handler ) {
			if ( isset( $handler['methods'] ) ) {
				$methods = array_merge( $methods, array_keys( $handler['methods'] ) );
			}
		}
		$this->assertContains( 'GET', $methods );
		$this->assertNotContains( 'POST', $methods );

		$single = $routes['/desktop-mode/v1/post-type/dm_coupon/(?P<id>[\d]+)'];
		$methods = array();
		foreach ( $single as $handler ) {
			if ( isset( $handler['methods'] ) ) {
				$methods = array_merge( $methods, array_keys( $handler['methods'] ) );
			}
		}
		$this->assertContains( 'GET', $methods );
		$this->assertContains( 'DELETE', $methods );
		$this->assertNotContains( 'POST', $methods );
		$this->assertNotContains( 'PUT', $methods );
	}

	/**
	 * The featured image the bundle renders on tiles arrives through
	 * `_embed`, which resolves via `_links` — and the attachment's own
	 * route is `wp/v2`, so it works even though the parent type is not
	 * REST-exposed.
	 *
	 * @covers Desktop_Mode_My_WordPress_Post_Type_Controller::get_items
	 */
	public function test_featured_media_is_embeddable() {
		$attachment_id = self::factory()->attachment->create_object(
			'product.jpg',
			0,
			array(
				'post_mime_type' => 'image/jpeg',
				'post_type'      => 'attachment',
				'post_status'    => 'inherit',
			)
		);
		set_post_thumbnail( $this->post_ids[0], $attachment_id );

		$request = new WP_REST_Request( 'GET', '/desktop-mode/v1/post-type/dm_coupon/' . $this->post_ids[0] );
		$response = rest_get_server()->dispatch( $request );
		$links    = $response->get_links();

		$this->assertSame( 200, $response->get_status() );
		$this->assertArrayHasKey( 'https://api.w.org/featuredmedia', $links );
		$this->assertStringContainsString(
			'wp/v2/media/' . $attachment_id,
			$links['https://api.w.org/featuredmedia'][0]['href']
		);
	}

	/**
	 * Core's route helpers return an empty string for a non-REST type
	 * and bail before their own filters, so `self` / `collection` would
	 * otherwise resolve to the bare REST root.
	 *
	 * @covers Desktop_Mode_My_WordPress_Post_Type_Controller::prepare_links
	 */
	public function test_self_and_collection_links_point_at_the_bridge() {
		$id = $this->post_ids[0];

		$response = $this->dispatch( 'GET', '/desktop-mode/v1/post-type/dm_coupon/' . $id );
		$links    = $response->get_links();

		$this->assertSame( 200, $response->get_status() );
		$this->assertStringContainsString(
			'desktop-mode/v1/post-type/dm_coupon/' . $id,
			$links['self'][0]['href']
		);
		$this->assertStringContainsString(
			'desktop-mode/v1/post-type/dm_coupon',
			$links['collection'][0]['href']
		);
	}

	/**
	 * The override is scoped to the controller's own type — Core's
	 * routing for everything else is untouched.
	 *
	 * @covers Desktop_Mode_My_WordPress_Post_Type_Controller::prepare_links
	 */
	public function test_core_post_routes_are_untouched() {
		$post_id = self::factory()->post->create();

		$this->assertSame( '/wp/v2/posts/' . $post_id, rest_get_route_for_post( $post_id ) );
		$this->assertSame( '', rest_get_route_for_post( $this->post_ids[0] ) );
	}

	/**
	 * Desktop Mode's own REST fields follow the bridged type, so a
	 * bridged section shows lock badges like a `wp/v2` one.
	 *
	 * @covers ::desktop_mode_my_wordpress_rest_field_post_types
	 */
	public function test_bridged_types_carry_desktop_mode_rest_fields() {
		$types = desktop_mode_my_wordpress_rest_field_post_types();

		$this->assertContains( 'dm_coupon', $types );
		$this->assertContains( 'post', $types );
	}
}
