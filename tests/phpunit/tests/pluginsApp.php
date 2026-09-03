<?php
/**
 * Tests for the Plugins app — the App Framework port of the native
 * Plugins window: the manifest, the gate, the `data()` payload (an
 * in-process read of `/wp/v2/plugins` with the app's REST fields),
 * the landing tab a window param asks for (on `mount` and `reopen`),
 * and the activate / deactivate dispatch cycle end to end.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-plugins-window
 */

class Tests_OpenStation_PluginsApp extends WP_UnitTestCase {

	protected static $admin_id;
	protected static $editor_id;

	/** A throwaway plugin on disk the activate / deactivate cycle runs on. */
	const FIXTURE = 'dm-plugins-app-fixture/dm-plugins-app-fixture.php';

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id  = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$editor_id = $factory->user->create( array( 'role' => 'editor' ) );
		// On multisite a plain administrator holds no plugin caps; the
		// "user allowed to manage plugins here" persona is a super admin.
		if ( is_multisite() ) {
			grant_super_admin( self::$admin_id );
		}
		$root = WP_PLUGIN_DIR . '/' . dirname( self::FIXTURE );
		wp_mkdir_p( $root );
		file_put_contents(
			WP_PLUGIN_DIR . '/' . self::FIXTURE,
			"<?php\n/**\n * Plugin Name: Plugins App Fixture\n * Version: 1.0.0\n * Text Domain: dm-plugins-app-fixture\n */\n"
		);
		wp_cache_delete( 'plugins', 'plugins' );
	}

	public static function wpTearDownAfterClass() {
		deactivate_plugins( self::FIXTURE, true );
		$file = WP_PLUGIN_DIR . '/' . self::FIXTURE;
		if ( file_exists( $file ) ) {
			unlink( $file );
			rmdir( dirname( $file ) );
		}
		wp_cache_delete( 'plugins', 'plugins' );
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$admin_id );
		// A fresh-looking transient so no field callback reaches wp.org.
		set_site_transient(
			'update_plugins',
			(object) array(
				'last_checked' => time(),
				'response'     => array(),
				'no_update'    => array(),
			)
		);
	}

	public function tear_down() {
		remove_all_filters( 'openstation_plugins_window_user_can_register' );
		foreach ( array_keys( openstation_apps_registry()->all() ) as $id ) {
			openstation_unregister_icon( $id );
		}
		parent::tear_down();
	}

	/**
	 * Run one dispatch against the registered app.
	 *
	 * @param string $action Action name.
	 * @param array  $state  Client state.
	 * @param array  $args   Action args.
	 * @param array  $params The window's open-time params.
	 * @return array Runtime response.
	 */
	protected function dispatch( $action, array $state = array(), array $args = array(), array $params = array() ) {
		return openstation_apps_runtime()->dispatch(
			'desktop-mode-plugins',
			array(
				'action' => $action,
				'state'  => $state,
				'args'   => $args,
				'params' => $params,
			),
			openstation_apps_os()
		);
	}

	/**
	 * @covers \OpenStation\App::manifest
	 */
	public function test_manifest_mirrors_the_legacy_windows_registration() {
		$app = openstation_apps_registry()->get( 'desktop-mode-plugins' );
		$this->assertNotNull( $app );
		$manifest = $app->manifest();
		$this->assertSame( 'Plugins', $manifest['title'] );
		$this->assertSame( 'dashicons-admin-plugins', $manifest['icon'] );
		$this->assertSame( 1180, $manifest['width'] );
		$this->assertSame( 760, $manifest['height'] );
		$this->assertSame( 760, $manifest['min_width'] );
		$this->assertSame( 480, $manifest['min_height'] );
		// The Plugins dock tile comes from `$menu` + the URL remap.
		$this->assertSame( 'none', $manifest['placement'] );
		$this->assertSame(
			array( 'reopen', 'reload', 'activate', 'deactivate', 'delete', 'bulk' ),
			$manifest['actions']
		);
		$this->assertSame( array( 'reopen' ), $manifest['lifecycle'] );
		$this->assertSame( 'installed', $manifest['state']['tab'] );
		$this->assertSame( 'featured', $manifest['state']['browse'] );

		// The config blob the client reads: the static half plus the
		// per-viewer half (caps, nonces, the auto-updates gate).
		$config = $manifest['config'];
		foreach ( array( 'ajaxUrl', 'ajaxNonce', 'updatesNonce', 'caps', 'autoUpdatesEnabled', 'currentUserId', 'selfPluginFile', 'adminUrl' ) as $key ) {
			$this->assertArrayHasKey( $key, $config, $key );
		}
		$this->assertSame( openstation_plugins_window_caps( self::$admin_id ), $config['caps'] );
		$this->assertSame( self::$admin_id, $config['currentUserId'] );
		$this->assertStringEndsWith( 'admin-ajax.php', $config['ajaxUrl'] );
		$this->assertSame( substr( plugin_basename( OPENSTATION_FILE ), 0, -4 ), $config['selfPluginFile'] );
		$this->assertStringEndsNotWith( '.php', $config['selfPluginFile'] );
		$this->assertSame( 1, wp_verify_nonce( $config['ajaxNonce'], 'desktop-mode-plugins' ) );
		$this->assertSame( 1, wp_verify_nonce( $config['updatesNonce'], 'updates' ) );
	}

	/**
	 * @covers \OpenStation\App::allows
	 */
	public function test_gate_follows_the_legacy_capability_filter() {
		$app = openstation_apps_registry()->get( 'desktop-mode-plugins' );
		$this->assertTrue( $app->allows( openstation_apps_os() ) );

		add_filter( 'openstation_plugins_window_user_can_register', '__return_false' );
		$this->assertFalse( $app->allows( openstation_apps_os() ) );
		remove_filter( 'openstation_plugins_window_user_can_register', '__return_false' );

		wp_set_current_user( self::$editor_id );
		$this->assertFalse( $app->allows( openstation_apps_os() ) );
	}

	/**
	 * @covers \OpenStation\App\Runtime::dispatch
	 */
	public function test_mount_serves_the_installed_plugins_with_the_apps_rest_fields() {
		$response = $this->dispatch( 'mount' );
		$this->assertTrue( $response['ok'] );
		$this->assertSame( '', $response['data']['error'] );
		$rows = $response['data']['installed'];
		$this->assertNotEmpty( $rows );
		$fixture = null;
		foreach ( $rows as $row ) {
			if ( self::FIXTURE === $row['plugin'] . '.php' ) {
				$fixture = $row;
			}
		}
		$this->assertNotNull( $fixture, 'The fixture plugin is in the list, keyed without `.php` as Core spells it.' );
		$this->assertSame( 'inactive', $fixture['status'] );
		foreach ( array( 'openstation_update_available', 'openstation_can_manage', 'openstation_icon_url', 'openstation_size_kb', 'openstation_auto_update' ) as $field ) {
			$this->assertArrayHasKey( $field, $fixture, $field );
		}
		$this->assertArrayHasKey( 'openstation_wporg_slug', $fixture );
		$this->assertNull( $fixture['openstation_wporg_slug'] );
		$this->assertTrue( $fixture['openstation_can_manage']['activate'] );
	}

	/**
	 * @covers \OpenStation\App\Runtime::dispatch
	 */
	public function test_the_tab_param_lands_the_window_on_browse_and_reopen_switches_it() {
		$response = $this->dispatch( 'mount', array(), array(), array( 'tab' => 'browse' ) );
		$this->assertTrue( $response['ok'] );
		$caps = openstation_plugins_window_caps( self::$admin_id );
		// On multisite the marketplace is network-managed: the tab
		// exists for no one there, and the param is refused.
		$this->assertSame( $caps['install'] ? 'browse' : 'installed', $response['state']['tab'] );

		$response = $this->dispatch( 'reopen', array( 'tab' => 'browse' ), array(), array( 'tab' => 'installed' ) );
		$this->assertSame( 'installed', $response['state']['tab'] );

		$response = $this->dispatch( 'reopen', array( 'tab' => 'installed' ), array(), array( 'tab' => 'featured' ) );
		$this->assertSame( $caps['install'] ? 'featured' : 'installed', $response['state']['tab'] );

		// An unknown tab and no param leave the state alone.
		$response = $this->dispatch( 'mount', array( 'tab' => 'installed' ), array(), array( 'tab' => 'nope' ) );
		$this->assertSame( 'installed', $response['state']['tab'] );
		$response = $this->dispatch( 'reopen', array( 'tab' => 'installed' ) );
		$this->assertSame( 'installed', $response['state']['tab'] );
	}

	/**
	 * @covers \OpenStation\App\Runtime::dispatch
	 */
	public function test_activate_and_deactivate_run_cores_controller_and_refresh_the_dock() {
		$plugin = substr( self::FIXTURE, 0, -4 );

		$response = $this->dispatch( 'activate', array(), array( 'plugin' => $plugin ) );
		$this->assertTrue( $response['ok'] );
		$this->assertTrue( is_plugin_active( self::FIXTURE ) );
		$types = wp_list_pluck( $response['effects'], 'type' );
		$this->assertContains( 'toast', $types );
		$this->assertContains( 'refresh_menu', $types );
		$this->assertStringContainsString( 'activated', $response['effects'][0]['message'] );
		// The fresh list rode the same response.
		$this->assertContains( 'active', wp_list_pluck( $response['data']['installed'], 'status', 'plugin' ) );

		$response = $this->dispatch( 'deactivate', array(), array( 'plugin' => $plugin . '.php' ) );
		$this->assertTrue( $response['ok'] );
		$this->assertFalse( is_plugin_active( self::FIXTURE ) );
		$this->assertStringContainsString( 'deactivated', $response['effects'][0]['message'] );
	}

	/**
	 * @covers \OpenStation\App\Runtime::dispatch
	 */
	public function test_bulk_activates_the_selection_and_reports_the_count() {
		$plugin   = substr( self::FIXTURE, 0, -4 );
		$response = $this->dispatch(
			'bulk',
			array(),
			array(
				'plugins' => array( $plugin, 'not-installed/not-installed' ),
				'do'      => 'activate',
			)
		);
		$this->assertTrue( $response['ok'] );
		$this->assertTrue( is_plugin_active( self::FIXTURE ) );
		$this->assertSame( '1 activated, 1 failed.', $response['effects'][0]['message'] );
		$this->assertContains( 'refresh_menu', wp_list_pluck( $response['effects'], 'type' ) );

		$response = $this->dispatch( 'bulk', array(), array( 'plugins' => array( $plugin ), 'do' => 'deactivate' ) );
		$this->assertFalse( is_plugin_active( self::FIXTURE ) );
		$this->assertSame( '1 plugin(s) deactivated.', $response['effects'][0]['message'] );
	}

	/**
	 * @covers \OpenStation\App\Runtime::dispatch
	 */
	public function test_a_bad_plugin_argument_is_a_toast_not_a_mutation() {
		$response = $this->dispatch( 'activate', array(), array( 'plugin' => '../../wp-config' ) );
		$this->assertTrue( $response['ok'] );
		$this->assertSame( 'toast', $response['effects'][0]['type'] );
		$this->assertSame( 'Missing plugin.', $response['effects'][0]['message'] );
		$this->assertNotContains( 'refresh_menu', wp_list_pluck( $response['effects'], 'type' ) );
	}

	/**
	 * @covers \OpenStation\App\Runtime::dispatch
	 */
	public function test_an_editor_is_refused_at_the_gate() {
		wp_set_current_user( self::$editor_id );
		$response = $this->dispatch( 'activate', array(), array( 'plugin' => substr( self::FIXTURE, 0, -4 ) ) );
		$this->assertFalse( $response['ok'] );
		$this->assertSame( 'forbidden', $response['error'] );
		$this->assertFalse( is_plugin_active( self::FIXTURE ) );
	}

	/**
	 * The Refresh button's action forces a fresh wp.org check (the
	 * filter that opts a host out of wp.org sees `$force = true`) and
	 * repaints the dock from the same snapshot.
	 *
	 * @covers \OpenStation\App\Runtime::dispatch
	 */
	public function test_reload_forces_the_update_check_and_refreshes_the_menu() {
		$saw_force = null;
		add_filter(
			'openstation_plugins_window_refresh_updates',
			static function ( $refresh, $force ) use ( &$saw_force ) {
				$saw_force = $force;
				return false;
			},
			10,
			2
		);
		try {
			$response = $this->dispatch( 'reload' );
		} finally {
			remove_all_filters( 'openstation_plugins_window_refresh_updates' );
		}
		$this->assertTrue( $response['ok'] );
		$this->assertTrue( $saw_force );
		$this->assertContains( 'refresh_menu', wp_list_pluck( $response['effects'], 'type' ) );
	}
}
