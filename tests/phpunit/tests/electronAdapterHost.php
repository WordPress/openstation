<?php

class Tests_OpenStation_ElectronAdapterHost extends WP_UnitTestCase {

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );

		if ( ! function_exists( 'openstation_electron_get_host' ) ) {
			require_once dirname( __DIR__, 3 ) . '/extensions/openstation-electron-adapter/includes/host.php';
		}
		if ( ! function_exists( 'openstation_electron_register_assets' ) ) {

			if ( ! defined( 'OPENSTATION_ELECTRON_DIR' ) ) {
				define(
					'OPENSTATION_ELECTRON_DIR',
					dirname( __DIR__, 3 ) . '/extensions/openstation-electron-adapter/'
				);
				define( 'OPENSTATION_ELECTRON_URL', 'http://example.org/electron-adapter/' );
				define( 'OPENSTATION_ELECTRON_VERSION', '1.0.0' );
			}
			require_once dirname( __DIR__, 3 ) . '/extensions/openstation-electron-adapter/includes/assets.php';
		}
	}

	public function test_adapter_script_defers_like_the_shell_handle_it_depends_on() {
		openstation_register_assets();
		openstation_electron_register_assets();

		$scripts = wp_scripts();
		$adapter = $scripts->registered['openstation-electron-adapter'] ?? null;
		$shell   = $scripts->registered['openstation'] ?? null;

		$this->assertNotNull( $adapter, 'The adapter script should be registered.' );
		$this->assertNotNull( $shell, 'The shell script should be registered.' );

		$this->assertContains(
			'openstation',
			$adapter->deps,
			'The adapter must declare the shell handle as a dependency.'
		);
		$this->assertSame(
			'defer',
			$shell->extra['strategy'] ?? null,
			'Guard assumption: the shell handle is deferred.'
		);
		$this->assertSame(
			$shell->extra['strategy'] ?? null,
			$adapter->extra['strategy'] ?? null,
			'The adapter must use the same loading strategy as the handle it depends on, '
				. 'or it executes before it and finds no wp.os.'
		);
	}

	public function set_up() {
		parent::set_up();
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );

		remove_action( 'rest_api_init', 'openstation_electron_register_routes' );
		add_action( 'rest_api_init', 'openstation_electron_register_routes' );

		global $wp_rest_server;
		$wp_rest_server = new WP_REST_Server();
		do_action( 'rest_api_init' );
	}

	public function tear_down() {
		global $wp_rest_server;
		$wp_rest_server = null;
		delete_user_meta( self::$admin_id, OPENSTATION_ELECTRON_HOST_META );
		delete_user_meta( self::$admin_id, 'desktop_mode_mode' );
		remove_all_filters( 'openstation_electron_enabled' );
		remove_all_filters( 'openstation_electron_heartbeat_interval' );
		remove_all_filters( 'openstation_electron_ttl' );
		remove_all_actions( 'openstation_electron_host_connected' );
		remove_all_actions( 'openstation_electron_host_heartbeat' );
		remove_all_actions( 'openstation_electron_host_disconnected' );
		parent::tear_down();
	}

	public function test_unconfigured_user_reads_as_disconnected() {
		$record = openstation_electron_get_host( self::$admin_id );

		$this->assertFalse( $record['connected'] );
		$this->assertSame( '', $record['hostId'] );
	}

	public function test_set_then_get_round_trips_a_record() {
		openstation_electron_set_host(
			self::$admin_id,
			array(
				'hostId'     => 'abc123',
				'platform'   => 'darwin',
				'appVersion' => '1.0.0',
				'protocol'   => 1,
			)
		);

		$record = openstation_electron_get_host( self::$admin_id );

		$this->assertTrue( $record['connected'] );
		$this->assertSame( 'abc123', $record['hostId'] );
		$this->assertSame( 'darwin', $record['platform'] );
		$this->assertSame( 'Mac', $record['osLabel'] );
		$this->assertSame( '1.0.0', $record['appVersion'] );
		$this->assertSame( 1, $record['protocol'] );
	}

	public function test_a_record_without_a_host_id_is_rejected() {
		$record = openstation_electron_set_host( self::$admin_id, array( 'platform' => 'darwin' ) );

		$this->assertFalse( $record['connected'] );
	}

	public function test_reconnecting_the_same_host_keeps_its_original_connected_at() {
		openstation_electron_set_host( self::$admin_id, array( 'hostId' => 'same-host' ) );
		$first = openstation_electron_get_host( self::$admin_id );

		$stored                = get_user_meta( self::$admin_id, OPENSTATION_ELECTRON_HOST_META, true );
		$stored['connectedAt'] = $first['connectedAt'] - 500;
		$stored['lastSeen']    = $first['lastSeen'] - 500;
		update_user_meta( self::$admin_id, OPENSTATION_ELECTRON_HOST_META, $stored );

		openstation_electron_set_host( self::$admin_id, array( 'hostId' => 'same-host' ) );
		$second = openstation_electron_get_host( self::$admin_id );

		$this->assertSame( $first['connectedAt'] - 500, $second['connectedAt'] );
		$this->assertGreaterThan( $second['connectedAt'], $second['lastSeen'] );
	}

	public function test_a_different_host_id_starts_a_new_connection() {
		openstation_electron_set_host( self::$admin_id, array( 'hostId' => 'host-one' ) );
		$stored                = get_user_meta( self::$admin_id, OPENSTATION_ELECTRON_HOST_META, true );
		$stored['connectedAt'] = $stored['connectedAt'] - 500;
		update_user_meta( self::$admin_id, OPENSTATION_ELECTRON_HOST_META, $stored );

		openstation_electron_set_host( self::$admin_id, array( 'hostId' => 'host-two' ) );
		$record = openstation_electron_get_host( self::$admin_id );

		$this->assertSame( 'host-two', $record['hostId'] );
		$this->assertSame( $record['lastSeen'], $record['connectedAt'] );
	}

	public function test_a_stale_record_reads_as_disconnected() {
		openstation_electron_set_host( self::$admin_id, array( 'hostId' => 'gone' ) );

		$stored             = get_user_meta( self::$admin_id, OPENSTATION_ELECTRON_HOST_META, true );
		$stored['lastSeen'] = time() - ( openstation_electron_ttl() + 60 );
		update_user_meta( self::$admin_id, OPENSTATION_ELECTRON_HOST_META, $stored );

		$this->assertFalse( openstation_electron_get_host( self::$admin_id )['connected'] );
	}

	public function test_clear_removes_the_record() {
		openstation_electron_set_host( self::$admin_id, array( 'hostId' => 'bye' ) );

		$this->assertTrue( openstation_electron_clear_host( self::$admin_id ) );
		$this->assertFalse( openstation_electron_get_host( self::$admin_id )['connected'] );
	}

	public function test_os_labels_cover_the_three_platforms() {
		$this->assertSame( 'Mac', openstation_electron_os_label( 'darwin' ) );
		$this->assertSame( 'Windows PC', openstation_electron_os_label( 'win32' ) );
		$this->assertSame( 'Linux desktop', openstation_electron_os_label( 'linux' ) );
		$this->assertSame( 'Linux desktop', openstation_electron_os_label( 'freebsd' ) );
	}

	public function test_interval_is_filterable_but_never_below_thirty_seconds() {
		$this->assertSame( 120, openstation_electron_interval() );

		add_filter( 'openstation_electron_heartbeat_interval', static fn() => 600 );
		$this->assertSame( 600, openstation_electron_interval() );
		remove_all_filters( 'openstation_electron_heartbeat_interval' );

		add_filter( 'openstation_electron_heartbeat_interval', static fn() => 1 );
		$this->assertSame( 30, openstation_electron_interval() );
	}

	public function test_ttl_always_spans_at_least_two_intervals() {
		add_filter( 'openstation_electron_heartbeat_interval', static fn() => 900 );
		$this->assertGreaterThanOrEqual( 1800, openstation_electron_ttl() );
	}

	public function test_enabled_is_filterable_per_user() {
		wp_set_current_user( self::$admin_id );
		$this->assertTrue( openstation_electron_enabled() );

		add_filter( 'openstation_electron_enabled', '__return_false' );
		$this->assertFalse( openstation_electron_enabled() );
	}

	public function test_config_carries_rest_coordinates_and_interval() {
		wp_set_current_user( self::$admin_id );

		$config = openstation_electron_config();

		$this->assertTrue( $config['enabled'] );
		$this->assertStringContainsString( 'openstation-electron/v1/host', $config['restUrl'] );
		$this->assertSame( 'openstation-electron/v1', $config['namespace'] );
		$this->assertSame( 120000, $config['interval'] );
		$this->assertSame( OPENSTATION_ELECTRON_PROTOCOL, $config['protocol'] );
		$this->assertSame( 'openstation_solo', $config['soloParam'] );
		$this->assertFalse( $config['last']['connected'] );
	}

	public function test_rest_handshake_registers_the_host_and_fires_the_action() {
		wp_set_current_user( self::$admin_id );

		$fired = 0;
		add_action(
			'openstation_electron_host_connected',
			static function () use ( &$fired ) {
				++$fired;
			}
		);

		$request = new WP_REST_Request( 'POST', '/openstation-electron/v1/host/handshake' );
		$request->set_body_params(
			array(
				'hostId'     => 'macbook01',
				'platform'   => 'darwin',
				'appVersion' => '1.0.0',
				'protocol'   => 1,
			)
		);
		$response = rest_do_request( $request );
		$data     = $response->get_data();

		$this->assertSame( 200, $response->get_status() );
		$this->assertTrue( $data['connected'] );
		$this->assertSame( 'macbook01', $data['hostId'] );
		$this->assertSame( 'Mac', $data['osLabel'] );
		$this->assertSame( 120000, $data['heartbeatInterval'] );
		$this->assertSame( 1, $fired );
	}

	public function test_agent_url_validation( $input, $expected ) {
		$this->assertSame( $expected, openstation_electron_sanitize_agent_url( $input ) );
	}

	public function data_agent_urls() {
		return array(
			'loopback v4'          => array( 'http://127.0.0.1:41234', 'http://127.0.0.1:41234' ),
			'localhost'            => array( 'http://localhost:41234', 'http://localhost:41234' ),
			'trailing slash'       => array( 'http://127.0.0.1:41234/', 'http://127.0.0.1:41234' ),
			'no port'              => array( 'http://127.0.0.1', '' ),
			'remote host'          => array( 'http://evil.test:41234', '' ),
			'lan address'          => array( 'http://192.168.1.10:41234', '' ),
			'https'                => array( 'https://127.0.0.1:41234', '' ),
			'a path'               => array( 'http://127.0.0.1:41234/free', '' ),
			'javascript'           => array( 'javascript:alert(1)', '' ),
			'empty'                => array( '', '' ),
			'nonsense'             => array( 'not a url', '' ),
		);
	}

	public function test_handshake_stores_the_agent_pairing() {
		openstation_electron_set_host(
			self::$admin_id,
			array(
				'hostId'     => 'macbook01',
				'agentUrl'   => 'http://127.0.0.1:41234',
				'agentToken' => str_repeat( 'a', 64 ),
			)
		);

		$record = openstation_electron_get_host( self::$admin_id );

		$this->assertSame( 'http://127.0.0.1:41234', $record['agentUrl'] );
		$this->assertSame( str_repeat( 'a', 64 ), $record['agentToken'] );
	}

	public function test_a_heartbeat_preserves_the_agent_pairing() {
		openstation_electron_set_host(
			self::$admin_id,
			array(
				'hostId'     => 'macbook01',
				'agentUrl'   => 'http://127.0.0.1:41234',
				'agentToken' => str_repeat( 'a', 64 ),
			)
		);

		openstation_electron_set_host( self::$admin_id, array( 'hostId' => 'macbook01' ) );

		$record = openstation_electron_get_host( self::$admin_id );
		$this->assertSame( 'http://127.0.0.1:41234', $record['agentUrl'] );
		$this->assertSame( str_repeat( 'a', 64 ), $record['agentToken'] );
	}

	public function test_config_exposes_the_pairing_only_while_a_host_is_live() {
		wp_set_current_user( self::$admin_id );

		$this->assertFalse( openstation_electron_config()['agent']['hasAgent'] );

		openstation_electron_set_host(
			self::$admin_id,
			array(
				'hostId'     => 'macbook01',
				'platform'   => 'darwin',
				'agentUrl'   => 'http://127.0.0.1:41234',
				'agentToken' => str_repeat( 'a', 64 ),
			)
		);

		$agent = openstation_electron_config()['agent'];
		$this->assertTrue( $agent['hasAgent'] );
		$this->assertSame( 'http://127.0.0.1:41234', $agent['url'] );
		$this->assertSame( str_repeat( 'a', 64 ), $agent['token'] );
		$this->assertSame( 'Mac', $agent['osLabel'] );

		$stored             = get_user_meta( self::$admin_id, OPENSTATION_ELECTRON_HOST_META, true );
		$stored['lastSeen'] = time() - ( openstation_electron_ttl() + 60 );
		update_user_meta( self::$admin_id, OPENSTATION_ELECTRON_HOST_META, $stored );

		$this->assertFalse( openstation_electron_config()['agent']['hasAgent'] );
	}

	public function test_the_descriptive_record_never_carries_the_token() {
		wp_set_current_user( self::$admin_id );
		openstation_electron_set_host(
			self::$admin_id,
			array(
				'hostId'     => 'macbook01',
				'agentUrl'   => 'http://127.0.0.1:41234',
				'agentToken' => str_repeat( 'a', 64 ),
			)
		);

		$config = openstation_electron_config();

		$this->assertArrayNotHasKey( 'agentToken', $config['last'] );
		$this->assertArrayHasKey( 'token', $config['agent'] );
	}

	public function test_a_non_loopback_agent_url_is_refused_at_the_edge() {
		openstation_electron_set_host(
			self::$admin_id,
			array(
				'hostId'     => 'macbook01',
				'agentUrl'   => 'http://evil.test:41234',
				'agentToken' => str_repeat( 'a', 64 ),
			)
		);

		$this->assertSame( '', openstation_electron_get_host( self::$admin_id )['agentUrl'] );
	}

	public function test_rest_handshake_declines_a_newer_protocol() {
		wp_set_current_user( self::$admin_id );

		$request = new WP_REST_Request( 'POST', '/openstation-electron/v1/host/handshake' );
		$request->set_body_params(
			array(
				'hostId'   => 'from-the-future',
				'protocol' => OPENSTATION_ELECTRON_PROTOCOL + 1,
			)
		);
		$response = rest_do_request( $request );

		$this->assertSame( 400, $response->get_status() );
		$this->assertFalse( openstation_electron_get_host( self::$admin_id )['connected'] );
	}

	public function test_rest_heartbeat_refreshes_an_existing_record() {
		wp_set_current_user( self::$admin_id );
		openstation_electron_set_host(
			self::$admin_id,
			array(
				'hostId'   => 'macbook01',
				'platform' => 'darwin',
			)
		);

		$stored             = get_user_meta( self::$admin_id, OPENSTATION_ELECTRON_HOST_META, true );
		$stored['lastSeen'] = time() - 100;
		update_user_meta( self::$admin_id, OPENSTATION_ELECTRON_HOST_META, $stored );

		$request = new WP_REST_Request( 'POST', '/openstation-electron/v1/host/heartbeat' );
		$request->set_body_params( array( 'hostId' => 'macbook01' ) );
		$response = rest_do_request( $request );
		$data     = $response->get_data();

		$this->assertSame( 200, $response->get_status() );
		$this->assertTrue( $data['connected'] );
		$this->assertGreaterThan( $stored['lastSeen'], $data['lastSeen'] );

		$this->assertSame( 'darwin', $data['platform'] );
	}

	public function test_rest_heartbeat_adopts_an_unknown_host_that_supplies_an_id() {
		wp_set_current_user( self::$admin_id );

		$request = new WP_REST_Request( 'POST', '/openstation-electron/v1/host/heartbeat' );
		$request->set_body_params( array( 'hostId' => 'orphan' ) );
		$response = rest_do_request( $request );

		$this->assertSame( 200, $response->get_status() );
		$this->assertTrue( $response->get_data()['connected'] );
	}

	public function test_rest_heartbeat_without_any_id_is_a_client_error() {
		wp_set_current_user( self::$admin_id );

		$request  = new WP_REST_Request( 'POST', '/openstation-electron/v1/host/heartbeat' );
		$response = rest_do_request( $request );

		$this->assertSame( 400, $response->get_status() );
	}

	public function test_rest_disconnect_clears_the_record_and_fires_the_action() {
		wp_set_current_user( self::$admin_id );
		openstation_electron_set_host( self::$admin_id, array( 'hostId' => 'macbook01' ) );

		$fired = 0;
		add_action(
			'openstation_electron_host_disconnected',
			static function () use ( &$fired ) {
				++$fired;
			}
		);

		$request  = new WP_REST_Request( 'DELETE', '/openstation-electron/v1/host' );
		$response = rest_do_request( $request );

		$this->assertSame( 200, $response->get_status() );
		$this->assertFalse( $response->get_data()['connected'] );
		$this->assertSame( 1, $fired );
	}

	public function test_routes_reject_a_logged_out_caller() {
		wp_set_current_user( 0 );

		$request = new WP_REST_Request( 'POST', '/openstation-electron/v1/host/handshake' );
		$request->set_body_params( array( 'hostId' => 'stranger' ) );
		$response = rest_do_request( $request );

		$this->assertSame( 401, $response->get_status() );
	}

	public function test_routes_reject_a_user_the_filter_disabled() {
		wp_set_current_user( self::$admin_id );
		add_filter( 'openstation_electron_enabled', '__return_false' );

		$request = new WP_REST_Request( 'POST', '/openstation-electron/v1/host/handshake' );
		$request->set_body_params( array( 'hostId' => 'macbook01' ) );
		$response = rest_do_request( $request );

		$this->assertSame( 403, $response->get_status() );
	}
}
