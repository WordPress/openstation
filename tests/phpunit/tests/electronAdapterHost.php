<?php
/**
 * Tests for the Electron Adapter's host contract.
 *
 * The adapter is a separate plugin under `extensions/`, so this file
 * loads its host module directly — the same pattern the Cron Manager
 * and phpMyAdmin extension tests use.
 *
 * Covers the record helpers (write / read / expire / clear), the
 * interval and TTL filters, the config blob, and the REST surface the
 * desktop app talks to.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-electron-adapter
 */
class Tests_OpenStation_ElectronAdapterHost extends WP_UnitTestCase {

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );

		if ( ! function_exists( 'openstation_electron_get_host' ) ) {
			require_once dirname( __DIR__, 3 ) . '/extensions/openstation-electron-adapter/includes/host.php';
		}
		if ( ! function_exists( 'openstation_electron_register_assets' ) ) {
			// The asset module reads the plugin's own constants.
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

	/**
	 * The adapter bundle must be deferred, exactly like the shell handle
	 * it depends on.
	 *
	 * A declared dependency orders the *tags*, not the *execution*. The
	 * shell bundle is deferred, so it runs after the document is parsed
	 * — while a classic script runs the moment the parser reaches it.
	 * Registered without `defer`, the adapter executed BEFORE the thing
	 * it depends on, found no `window.wp.os`, and gave up: the app
	 * connected, the desktop loaded, and the ⋯ menu row was silently
	 * missing. That shipped. This is what catches it coming back.
	 *
	 * @covers ::openstation_electron_register_assets
	 */
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

		// The adapter's file was required in `wpSetUpBeforeClass`, so
		// its `add_action( 'rest_api_init', … )` ran mid-suite — after
		// the hook snapshot the test case restores on every tear_down,
		// which means the hook is stripped again before the second test
		// in this class. Re-adding it here is idempotent and survives
		// that restore.
		//
		// The route registration itself goes through the action rather
		// than being called directly: WordPress flags off-action
		// registration as incorrect usage, rightly, because it is
		// invisible to anything that enumerates routes.
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

	/**
	 * @covers ::openstation_electron_get_host
	 */
	public function test_unconfigured_user_reads_as_disconnected() {
		$record = openstation_electron_get_host( self::$admin_id );

		$this->assertFalse( $record['connected'] );
		$this->assertSame( '', $record['hostId'] );
	}

	/**
	 * @covers ::openstation_electron_set_host
	 * @covers ::openstation_electron_get_host
	 */
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

	/**
	 * @covers ::openstation_electron_set_host
	 */
	public function test_a_record_without_a_host_id_is_rejected() {
		$record = openstation_electron_set_host( self::$admin_id, array( 'platform' => 'darwin' ) );

		$this->assertFalse( $record['connected'] );
	}

	/**
	 * A reconnect from the same installation must not reset how long the
	 * desktop has been attached — that is why `connectedAt` is stored
	 * separately from `lastSeen`.
	 *
	 * @covers ::openstation_electron_set_host
	 */
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

	/**
	 * @covers ::openstation_electron_set_host
	 */
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

	/**
	 * A record older than the TTL reads as disconnected without any
	 * scheduled cleanup having to run.
	 *
	 * @covers ::openstation_electron_get_host
	 */
	public function test_a_stale_record_reads_as_disconnected() {
		openstation_electron_set_host( self::$admin_id, array( 'hostId' => 'gone' ) );

		$stored             = get_user_meta( self::$admin_id, OPENSTATION_ELECTRON_HOST_META, true );
		$stored['lastSeen'] = time() - ( openstation_electron_ttl() + 60 );
		update_user_meta( self::$admin_id, OPENSTATION_ELECTRON_HOST_META, $stored );

		$this->assertFalse( openstation_electron_get_host( self::$admin_id )['connected'] );
	}

	/**
	 * @covers ::openstation_electron_clear_host
	 */
	public function test_clear_removes_the_record() {
		openstation_electron_set_host( self::$admin_id, array( 'hostId' => 'bye' ) );

		$this->assertTrue( openstation_electron_clear_host( self::$admin_id ) );
		$this->assertFalse( openstation_electron_get_host( self::$admin_id )['connected'] );
	}

	/**
	 * @covers ::openstation_electron_os_label
	 */
	public function test_os_labels_cover_the_three_platforms() {
		$this->assertSame( 'Mac', openstation_electron_os_label( 'darwin' ) );
		$this->assertSame( 'Windows PC', openstation_electron_os_label( 'win32' ) );
		$this->assertSame( 'Linux desktop', openstation_electron_os_label( 'linux' ) );
		$this->assertSame( 'Linux desktop', openstation_electron_os_label( 'freebsd' ) );
	}

	/**
	 * @covers ::openstation_electron_interval
	 */
	public function test_interval_is_filterable_but_never_below_thirty_seconds() {
		$this->assertSame( 120, openstation_electron_interval() );

		add_filter( 'openstation_electron_heartbeat_interval', static fn() => 600 );
		$this->assertSame( 600, openstation_electron_interval() );
		remove_all_filters( 'openstation_electron_heartbeat_interval' );

		add_filter( 'openstation_electron_heartbeat_interval', static fn() => 1 );
		$this->assertSame( 30, openstation_electron_interval() );
	}

	/**
	 * A filter that widens the interval must not leave every host
	 * looking permanently disconnected — the TTL has to keep up.
	 *
	 * @covers ::openstation_electron_ttl
	 */
	public function test_ttl_always_spans_at_least_two_intervals() {
		add_filter( 'openstation_electron_heartbeat_interval', static fn() => 900 );
		$this->assertGreaterThanOrEqual( 1800, openstation_electron_ttl() );
	}

	/**
	 * @covers ::openstation_electron_enabled
	 */
	public function test_enabled_is_filterable_per_user() {
		wp_set_current_user( self::$admin_id );
		$this->assertTrue( openstation_electron_enabled() );

		add_filter( 'openstation_electron_enabled', '__return_false' );
		$this->assertFalse( openstation_electron_enabled() );
	}

	/**
	 * @covers ::openstation_electron_config
	 */
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

	/**
	 * @covers ::openstation_electron_rest_handshake
	 */
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

	/**
	 * The agent URL is printed back into an admin page for a browser to
	 * call, so it is validated on the way IN rather than trusted on the
	 * way out. Loopback, http, no path — the one shape the local agent
	 * ever advertises.
	 *
	 * @covers ::openstation_electron_sanitize_agent_url
	 * @dataProvider data_agent_urls
	 *
	 * @param string $input    Candidate URL.
	 * @param string $expected Normalized result, or '' when refused.
	 */
	public function test_agent_url_validation( $input, $expected ) {
		$this->assertSame( $expected, openstation_electron_sanitize_agent_url( $input ) );
	}

	/**
	 * @return array<string, array{0: string, 1: string}>
	 */
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

	/**
	 * @covers ::openstation_electron_set_host
	 */
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

	/**
	 * A heartbeat carries nothing but an id. Wiping the pairing on every
	 * beat would leave a browser able to free windows for exactly one
	 * interval after each handshake.
	 *
	 * @covers ::openstation_electron_set_host
	 */
	public function test_a_heartbeat_preserves_the_agent_pairing() {
		openstation_electron_set_host(
			self::$admin_id,
			array(
				'hostId'     => 'macbook01',
				'agentUrl'   => 'http://127.0.0.1:41234',
				'agentToken' => str_repeat( 'a', 64 ),
			)
		);

		// Exactly what the heartbeat route passes through.
		openstation_electron_set_host( self::$admin_id, array( 'hostId' => 'macbook01' ) );

		$record = openstation_electron_get_host( self::$admin_id );
		$this->assertSame( 'http://127.0.0.1:41234', $record['agentUrl'] );
		$this->assertSame( str_repeat( 'a', 64 ), $record['agentToken'] );
	}

	/**
	 * @covers ::openstation_electron_config
	 */
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

		// A host that stopped beating stops being reachable at the same
		// moment its record expires.
		$stored             = get_user_meta( self::$admin_id, OPENSTATION_ELECTRON_HOST_META, true );
		$stored['lastSeen'] = time() - ( openstation_electron_ttl() + 60 );
		update_user_meta( self::$admin_id, OPENSTATION_ELECTRON_HOST_META, $stored );

		$this->assertFalse( openstation_electron_config()['agent']['hasAgent'] );
	}

	/**
	 * `last` is descriptive — "your Mac was here two minutes ago" — and
	 * read by UI that has no business holding a capability.
	 *
	 * @covers ::openstation_electron_config
	 */
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

	/**
	 * @covers ::openstation_electron_set_host
	 */
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

	/**
	 * @covers ::openstation_electron_rest_handshake
	 */
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

	/**
	 * @covers ::openstation_electron_rest_heartbeat
	 */
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
		// Platform survives a heartbeat — the beat carries only an id.
		$this->assertSame( 'darwin', $data['platform'] );
	}

	/**
	 * A host that beats without ever handshaking (the plugin was
	 * reactivated under it) is upgraded rather than rejected: refusing
	 * would cost a second round trip for no gain.
	 *
	 * @covers ::openstation_electron_rest_heartbeat
	 */
	public function test_rest_heartbeat_adopts_an_unknown_host_that_supplies_an_id() {
		wp_set_current_user( self::$admin_id );

		$request = new WP_REST_Request( 'POST', '/openstation-electron/v1/host/heartbeat' );
		$request->set_body_params( array( 'hostId' => 'orphan' ) );
		$response = rest_do_request( $request );

		$this->assertSame( 200, $response->get_status() );
		$this->assertTrue( $response->get_data()['connected'] );
	}

	/**
	 * @covers ::openstation_electron_rest_heartbeat
	 */
	public function test_rest_heartbeat_without_any_id_is_a_client_error() {
		wp_set_current_user( self::$admin_id );

		$request  = new WP_REST_Request( 'POST', '/openstation-electron/v1/host/heartbeat' );
		$response = rest_do_request( $request );

		$this->assertSame( 400, $response->get_status() );
	}

	/**
	 * @covers ::openstation_electron_rest_disconnect
	 */
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

	/**
	 * @covers ::openstation_electron_register_routes
	 */
	public function test_routes_reject_a_logged_out_caller() {
		wp_set_current_user( 0 );

		$request = new WP_REST_Request( 'POST', '/openstation-electron/v1/host/handshake' );
		$request->set_body_params( array( 'hostId' => 'stranger' ) );
		$response = rest_do_request( $request );

		$this->assertSame( 401, $response->get_status() );
	}

	/**
	 * @covers ::openstation_electron_rest_handshake
	 */
	public function test_routes_reject_a_user_the_filter_disabled() {
		wp_set_current_user( self::$admin_id );
		add_filter( 'openstation_electron_enabled', '__return_false' );

		$request = new WP_REST_Request( 'POST', '/openstation-electron/v1/host/handshake' );
		$request->set_body_params( array( 'hostId' => 'macbook01' ) );
		$response = rest_do_request( $request );

		$this->assertSame( 403, $response->get_status() );
	}
}
