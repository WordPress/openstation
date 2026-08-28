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
		// The shell boots from its own screen; the asset hook paints
		// nothing anywhere else.
		set_current_screen( OPENSTATION_SHELL_SCREEN_ID );
		wp_set_current_user( self::$admin_id );
		openstation_flush_script_handle_registries();
	}

	public function tear_down() {
		delete_user_meta( self::$admin_id, 'desktop_mode_mode' );
		remove_all_filters( 'openstation_dock_items' );
		remove_all_filters( 'openstation_dock_item' );
		remove_all_filters( 'openstation_shell_config' );
		remove_all_filters( 'openstation_mode_enabled' );
		remove_all_actions( 'openstation_mode_init' );
		remove_all_actions( 'openstation_chromeless_styles' );
		unset( $_GET['openstation_chromeless'], $_GET[ OPENSTATION_PORTAL_FLAG ], $_GET[ OPENSTATION_PORTAL_INTENT_FLAG ], $_GET[ OPENSTATION_SHELL_TARGET_ARG ], $_GET[ OPENSTATION_SHELL_INTENT_ARG ] );
		parent::tear_down();
	}

	/**
	 * @covers ::openstation_build_dock_items
	 */
	public function test_openstation_dock_items_filter_receives_array() {
		global $menu;
		$menu = array(
			array( 'Posts', 'edit_posts', 'edit.php', '', '', 'menu-posts', 'dashicons-admin-post' ),
		);

		$received = null;
		add_filter(
			'openstation_dock_items',
			function ( $items ) use ( &$received ) {
				$received = $items;
				return $items;
			}
		);

		openstation_build_dock_items();

		$this->assertIsArray( $received );
		$this->assertCount( 1, $received );
	}

	/**
	 * @covers ::openstation_build_dock_items
	 */
	public function test_openstation_dock_item_filter_receives_item_and_slug() {
		global $menu;
		$menu = array(
			array( 'Posts', 'edit_posts', 'edit.php', '', '', 'menu-posts', 'dashicons-admin-post' ),
		);

		$received_item = null;
		$received_slug = null;
		add_filter(
			'openstation_dock_item',
			function ( $item, $slug ) use ( &$received_item, &$received_slug ) {
				$received_item = $item;
				$received_slug = $slug;
				return $item;
			},
			10,
			2
		);

		openstation_build_dock_items();

		$this->assertIsArray( $received_item );
		$this->assertSame( 'edit.php', $received_slug );
	}

	/**
	 * @covers ::openstation_enqueue_assets
	 */
	public function test_openstation_shell_config_filter_fires_with_expected_keys() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );

		$received = null;
		add_filter(
			'openstation_shell_config',
			function ( $config ) use ( &$received ) {
				$received = $config;
				return $config;
			}
		);

		openstation_enqueue_assets();

		$this->assertIsArray( $received );
		foreach ( array( 'currentPage', 'currentTitle', 'currentIcon', 'adminUrl', 'restUrl', 'colorScheme', 'dockItems', 'fromPortal', 'fromPortalIntent' ) as $key ) {
			$this->assertArrayHasKey( $key, $received, "Config missing key: $key" );
		}
	}

	/**
	 * The shell config derives `currentPage` from the screen's `target`
	 * arg and surfaces `fromPortalIntent` from its `intent` arg. The
	 * page carries no routing args of its own, so the URL-derived
	 * window id matches the dock's.
	 *
	 * @covers ::openstation_enqueue_assets
	 */
	public function test_openstation_shell_config_surfaces_target_and_intent() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET[ OPENSTATION_SHELL_TARGET_ARG ] = '/wp-admin/post.php?post=104&action=edit&' . OPENSTATION_PORTAL_FLAG . '=1';
		$_GET[ OPENSTATION_SHELL_INTENT_ARG ] = '1';

		$received = null;
		add_filter(
			'openstation_shell_config',
			function ( $config ) use ( &$received ) {
				$received = $config;
				return $config;
			}
		);

		openstation_enqueue_assets();

		$this->assertIsArray( $received );
		$this->assertTrue( $received['fromPortal'] );
		$this->assertTrue( $received['fromPortalIntent'] );
		$this->assertStringStartsWith( admin_url( 'post.php' ), $received['currentPage'] );
		$this->assertStringContainsString( 'post=104', $received['currentPage'] );
		$this->assertStringContainsString( 'action=edit', $received['currentPage'] );
		$this->assertStringNotContainsString( OPENSTATION_PORTAL_FLAG, $received['currentPage'] );
		$this->assertStringNotContainsString( OPENSTATION_SHELL_TARGET_ARG . '=', $received['currentPage'] );
	}

	/**
	 * A bare shell screen — no `target`, so no intent — must surface
	 * `fromPortalIntent=false` so the boot flow leaves the restored
	 * session alone.
	 *
	 * @covers ::openstation_enqueue_assets
	 */
	public function test_openstation_shell_config_intent_flag_defaults_false() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );

		$received = null;
		add_filter(
			'openstation_shell_config',
			function ( $config ) use ( &$received ) {
				$received = $config;
				return $config;
			}
		);

		openstation_enqueue_assets();

		$this->assertIsArray( $received );
		$this->assertTrue( $received['fromPortal'] );
		$this->assertFalse( $received['fromPortalIntent'] );
	}

	/**
	 * @covers ::openstation_enqueue_assets
	 */
	public function test_openstation_mode_init_action_fires_when_assets_enqueue() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );

		$fired = false;
		add_action(
			'openstation_mode_init',
			function () use ( &$fired ) {
				$fired = true;
			}
		);

		openstation_enqueue_assets();

		$this->assertTrue( $fired );
	}

	/**
	 * @covers ::openstation_enqueue_assets
	 */
	public function test_openstation_mode_init_does_not_fire_when_mode_off() {
		$fired = false;
		add_action(
			'openstation_mode_init',
			function () use ( &$fired ) {
				$fired = true;
			}
		);

		openstation_enqueue_assets();

		$this->assertFalse( $fired );
	}

	/**
	 * @covers ::openstation_enqueue_assets
	 */
	public function test_openstation_chromeless_styles_action_fires_on_chromeless_request() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['openstation_chromeless'] = '1';

		$fired = false;
		add_action(
			'openstation_chromeless_styles',
			function () use ( &$fired ) {
				$fired = true;
			}
		);

		openstation_enqueue_assets();

		$this->assertTrue( $fired );
	}

	/**
	 * @covers ::openstation_enqueue_assets
	 */
	public function test_openstation_chromeless_styles_does_not_fire_outside_chromeless() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );

		$fired = false;
		add_action(
			'openstation_chromeless_styles',
			function () use ( &$fired ) {
				$fired = true;
			}
		);

		openstation_enqueue_assets();

		$this->assertFalse( $fired );
	}
}
