<?php
/**
 * Contract tests for the OpenStation filters and actions.
 *
 * These tests don't assert behavior — they guarantee the *hooks themselves*
 * fire with the documented signatures so plugin authors can rely on them.
 * Behavior is covered by the other test classes in this group.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 */
class Tests_OpenStation_OpenStationHooks extends WP_UnitTestCase {

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function set_up() {
		parent::set_up();
		set_current_screen( 'dashboard' );
		wp_set_current_user( self::$admin_id );
		open_station_flush_script_handle_registries();
	}

	public function tear_down() {
		delete_user_meta( self::$admin_id, 'desktop_mode_mode' );
		remove_all_filters( 'open_station_dock_items' );
		remove_all_filters( 'open_station_dock_item' );
		remove_all_filters( 'open_station_shell_config' );
		remove_all_filters( 'open_station_mode_enabled' );
		remove_all_actions( 'open_station_mode_init' );
		remove_all_actions( 'open_station_chromeless_styles' );
		unset( $_GET['open_station_chromeless'], $_GET[ OPEN_STATION_PORTAL_FLAG ], $_GET[ OPEN_STATION_PORTAL_INTENT_FLAG ] );
		parent::tear_down();
	}

	/**
	 * @covers ::open_station_build_dock_items
	 */
	public function test_open_station_dock_items_filter_receives_array() {
		global $menu;
		$menu = array(
			array( 'Posts', 'edit_posts', 'edit.php', '', '', 'menu-posts', 'dashicons-admin-post' ),
		);

		$received = null;
		add_filter(
			'open_station_dock_items',
			function ( $items ) use ( &$received ) {
				$received = $items;
				return $items;
			}
		);

		open_station_build_dock_items();

		$this->assertIsArray( $received );
		$this->assertCount( 1, $received );
	}

	/**
	 * @covers ::open_station_build_dock_items
	 */
	public function test_open_station_dock_item_filter_receives_item_and_slug() {
		global $menu;
		$menu = array(
			array( 'Posts', 'edit_posts', 'edit.php', '', '', 'menu-posts', 'dashicons-admin-post' ),
		);

		$received_item = null;
		$received_slug = null;
		add_filter(
			'open_station_dock_item',
			function ( $item, $slug ) use ( &$received_item, &$received_slug ) {
				$received_item = $item;
				$received_slug = $slug;
				return $item;
			},
			10,
			2
		);

		open_station_build_dock_items();

		$this->assertIsArray( $received_item );
		$this->assertSame( 'edit.php', $received_slug );
	}

	/**
	 * @covers ::open_station_enqueue_assets
	 */
	public function test_open_station_shell_config_filter_fires_with_expected_keys() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );

		$received = null;
		add_filter(
			'open_station_shell_config',
			function ( $config ) use ( &$received ) {
				$received = $config;
				return $config;
			}
		);

		open_station_enqueue_assets();

		$this->assertIsArray( $received );
		foreach ( array( 'currentPage', 'currentTitle', 'currentIcon', 'adminUrl', 'restUrl', 'colorScheme', 'dockItems', 'fromPortal', 'fromPortalIntent' ) as $key ) {
			$this->assertArrayHasKey( $key, $received, "Config missing key: $key" );
		}
	}

	/**
	 * The shell config surfaces `fromPortalIntent` mirroring the
	 * `desktop_mode_portal_intent` query flag, and strips it out of
	 * `currentPage` so the URL-derived window id matches the dock's.
	 *
	 * @covers ::open_station_enqueue_assets
	 */
	public function test_open_station_shell_config_surfaces_portal_intent_flag() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET[ OPEN_STATION_PORTAL_FLAG ]        = '1';
		$_GET[ OPEN_STATION_PORTAL_INTENT_FLAG ] = '1';
		$_GET['post']                            = '104';
		$_GET['action']                          = 'edit';

		$received = null;
		add_filter(
			'open_station_shell_config',
			function ( $config ) use ( &$received ) {
				$received = $config;
				return $config;
			}
		);

		try {
			open_station_enqueue_assets();
		} finally {
			unset( $_GET['post'], $_GET['action'] );
		}

		$this->assertIsArray( $received );
		$this->assertTrue( $received['fromPortal'] );
		$this->assertTrue( $received['fromPortalIntent'] );
		$this->assertStringNotContainsString( OPEN_STATION_PORTAL_FLAG, $received['currentPage'] );
		$this->assertStringNotContainsString( OPEN_STATION_PORTAL_INTENT_FLAG, $received['currentPage'] );
	}

	/**
	 * Bare portal entry — `fromPortal=true`, but no intent flag — must
	 * surface `fromPortalIntent=false` so the boot flow leaves the
	 * restored session alone.
	 *
	 * @covers ::open_station_enqueue_assets
	 */
	public function test_open_station_shell_config_intent_flag_defaults_false() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET[ OPEN_STATION_PORTAL_FLAG ] = '1';

		$received = null;
		add_filter(
			'open_station_shell_config',
			function ( $config ) use ( &$received ) {
				$received = $config;
				return $config;
			}
		);

		open_station_enqueue_assets();

		$this->assertIsArray( $received );
		$this->assertTrue( $received['fromPortal'] );
		$this->assertFalse( $received['fromPortalIntent'] );
	}

	/**
	 * @covers ::open_station_enqueue_assets
	 */
	public function test_open_station_mode_init_action_fires_when_assets_enqueue() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );

		$fired = false;
		add_action(
			'open_station_mode_init',
			function () use ( &$fired ) {
				$fired = true;
			}
		);

		open_station_enqueue_assets();

		$this->assertTrue( $fired );
	}

	/**
	 * @covers ::open_station_enqueue_assets
	 */
	public function test_open_station_mode_init_does_not_fire_when_mode_off() {
		$fired = false;
		add_action(
			'open_station_mode_init',
			function () use ( &$fired ) {
				$fired = true;
			}
		);

		open_station_enqueue_assets();

		$this->assertFalse( $fired );
	}

	/**
	 * @covers ::open_station_enqueue_assets
	 */
	public function test_open_station_chromeless_styles_action_fires_on_chromeless_request() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['open_station_chromeless'] = '1';

		$fired = false;
		add_action(
			'open_station_chromeless_styles',
			function () use ( &$fired ) {
				$fired = true;
			}
		);

		open_station_enqueue_assets();

		$this->assertTrue( $fired );
	}

	/**
	 * @covers ::open_station_enqueue_assets
	 */
	public function test_open_station_chromeless_styles_does_not_fire_outside_chromeless() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );

		$fired = false;
		add_action(
			'open_station_chromeless_styles',
			function () use ( &$fired ) {
				$fired = true;
			}
		);

		open_station_enqueue_assets();

		$this->assertFalse( $fired );
	}
}
