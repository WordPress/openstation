<?php
/**
 * Tests for the extension REST controller base
 * (Open_Station_Extension_Rest) — specifically the
 * permission-callback auto-fill in register_routes() for both
 * route shapes register_rest_route() accepts, and the
 * check_caps() 401/403 split.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 */

require_once dirname( __DIR__, 3 ) . '/extensions/base/includes/ExtensionRest.php';

class Tests_OpenStation_ExtensionRest extends WP_UnitTestCase {

	protected static $admin_id;
	protected static $subscriber_id;

	/**
	 * @var WP_REST_Server
	 */
	protected $server;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id      = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$subscriber_id = $factory->user->create( array( 'role' => 'subscriber' ) );
	}

	public function set_up() {
		parent::set_up();
		global $wp_rest_server;
		$wp_rest_server = new WP_REST_Server();
		$this->server   = $wp_rest_server;
		do_action( 'rest_api_init', $this->server );
	}

	public function tear_down() {
		global $wp_rest_server;
		$wp_rest_server = null;
		parent::tear_down();
	}

	/**
	 * Concrete subclass declaring one route of each shape plus a
	 * route with an explicit permission_callback.
	 */
	private function make_controller(): Open_Station_Extension_Rest {
		return new class() extends Open_Station_Extension_Rest {
			protected function namespace(): string {
				return 'os-test/v1';
			}

			protected function routes(): array {
				return array(
					// Single-endpoint shape, no permission_callback.
					'/single' => array(
						'methods'  => 'GET',
						'callback' => '__return_true',
					),
					// Multi-endpoint shape (one endpoint array per
					// HTTP method), no permission_callbacks, plus a
					// non-numeric common `args` route option.
					'/multi'  => array(
						array(
							'methods'  => 'GET',
							'callback' => '__return_true',
						),
						array(
							'methods'  => 'POST',
							'callback' => '__return_true',
						),
						'args' => array(
							'id' => array( 'type' => 'integer' ),
						),
					),
					// Explicit permission_callback must be kept.
					'/custom' => array(
						'methods'             => 'GET',
						'callback'            => '__return_true',
						'permission_callback' => '__return_true',
					),
				);
			}
		};
	}

	/**
	 * @covers Open_Station_Extension_Rest::register_routes
	 */
	public function test_single_endpoint_route_gets_check_caps_permission_callback() {
		$controller = $this->make_controller();
		$controller->register_routes();

		$routes = $this->server->get_routes();
		$this->assertArrayHasKey( '/os-test/v1/single', $routes );
		$this->assertSame(
			array( $controller, 'check_caps' ),
			$routes['/os-test/v1/single'][0]['permission_callback']
		);
	}

	/**
	 * @covers Open_Station_Extension_Rest::register_routes
	 */
	public function test_multi_endpoint_route_gets_check_caps_on_every_endpoint() {
		$controller = $this->make_controller();
		$controller->register_routes();

		$routes = $this->server->get_routes();
		$this->assertArrayHasKey( '/os-test/v1/multi', $routes );

		$endpoints = $routes['/os-test/v1/multi'];
		$this->assertCount( 2, $endpoints );
		foreach ( $endpoints as $endpoint ) {
			$this->assertSame(
				array( $controller, 'check_caps' ),
				$endpoint['permission_callback']
			);
		}
	}

	/**
	 * @covers Open_Station_Extension_Rest::register_routes
	 */
	public function test_explicit_permission_callback_is_not_overridden() {
		$controller = $this->make_controller();
		$controller->register_routes();

		$routes = $this->server->get_routes();
		$this->assertArrayHasKey( '/os-test/v1/custom', $routes );
		$this->assertSame(
			'__return_true',
			$routes['/os-test/v1/custom'][0]['permission_callback']
		);
	}

	/**
	 * @covers Open_Station_Extension_Rest::check_caps
	 */
	public function test_check_caps_returns_401_for_logged_out_users() {
		wp_set_current_user( 0 );

		$result = $this->make_controller()->check_caps();

		$this->assertWPError( $result );
		$this->assertSame( 401, $result->get_error_data()['status'] );
	}

	/**
	 * @covers Open_Station_Extension_Rest::check_caps
	 */
	public function test_check_caps_returns_403_for_users_missing_required_caps() {
		wp_set_current_user( self::$subscriber_id );

		$result = $this->make_controller()->check_caps();

		$this->assertWPError( $result );
		$this->assertSame( 403, $result->get_error_data()['status'] );
	}

	/**
	 * @covers Open_Station_Extension_Rest::check_caps
	 */
	public function test_check_caps_returns_true_for_users_with_required_caps() {
		wp_set_current_user( self::$admin_id );

		$this->assertTrue( $this->make_controller()->check_caps() );
	}
}
