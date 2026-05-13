<?php
/**
 * Contract tests for the desktop mode filters and actions.
 *
 * These tests don't assert behavior — they guarantee the *hooks themselves*
 * fire with the documented signatures so plugin authors can rely on them.
 * Behavior is covered by the other test classes in this group.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 */
class Tests_DesktopMode_DesktopModeHooks extends WP_UnitTestCase {

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function set_up() {
		parent::set_up();
		set_current_screen( 'dashboard' );
		wp_set_current_user( self::$admin_id );
		desktop_mode_flush_script_handle_registries();
	}

	public function tear_down() {
		delete_user_meta( self::$admin_id, 'desktop_mode_mode' );
		remove_all_filters( 'desktop_mode_dock_items' );
		remove_all_filters( 'desktop_mode_dock_item' );
		remove_all_filters( 'desktop_mode_shell_config' );
		remove_all_filters( 'desktop_mode_mode_enabled' );
		remove_all_actions( 'desktop_mode_mode_init' );
		remove_all_actions( 'desktop_mode_chromeless_styles' );
		unset( $_GET['desktop_mode_chromeless'], $_GET[ DESKTOP_MODE_PORTAL_FLAG ], $_GET[ DESKTOP_MODE_PORTAL_INTENT_FLAG ] );
		parent::tear_down();
	}

	/**
	 * @covers ::desktop_mode_build_dock_items
	 */
	public function test_desktop_mode_dock_items_filter_receives_array() {
		global $menu;
		$menu = array(
			array( 'Posts', 'edit_posts', 'edit.php', '', '', 'menu-posts', 'dashicons-admin-post' ),
		);

		$received = null;
		add_filter(
			'desktop_mode_dock_items',
			function ( $items ) use ( &$received ) {
				$received = $items;
				return $items;
			}
		);

		desktop_mode_build_dock_items();

		$this->assertIsArray( $received );
		$this->assertCount( 1, $received );
	}

	/**
	 * @covers ::desktop_mode_build_dock_items
	 */
	public function test_desktop_mode_dock_item_filter_receives_item_and_slug() {
		global $menu;
		$menu = array(
			array( 'Posts', 'edit_posts', 'edit.php', '', '', 'menu-posts', 'dashicons-admin-post' ),
		);

		$received_item = null;
		$received_slug = null;
		add_filter(
			'desktop_mode_dock_item',
			function ( $item, $slug ) use ( &$received_item, &$received_slug ) {
				$received_item = $item;
				$received_slug = $slug;
				return $item;
			},
			10,
			2
		);

		desktop_mode_build_dock_items();

		$this->assertIsArray( $received_item );
		$this->assertSame( 'edit.php', $received_slug );
	}

	/**
	 * @covers ::desktop_mode_enqueue_assets
	 */
	public function test_desktop_mode_shell_config_filter_fires_with_expected_keys() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );

		$received = null;
		add_filter(
			'desktop_mode_shell_config',
			function ( $config ) use ( &$received ) {
				$received = $config;
				return $config;
			}
		);

		desktop_mode_enqueue_assets();

		$this->assertIsArray( $received );
		foreach ( array( 'currentPage', 'currentTitle', 'currentIcon', 'adminUrl', 'colorScheme', 'dockItems', 'fromPortal', 'fromPortalIntent' ) as $key ) {
			$this->assertArrayHasKey( $key, $received, "Config missing key: $key" );
		}
	}

	/**
	 * The shell config surfaces `fromPortalIntent` mirroring the
	 * `desktop_mode_portal_intent` query flag, and strips it out of
	 * `currentPage` so the URL-derived window id matches the dock's.
	 *
	 * @covers ::desktop_mode_enqueue_assets
	 */
	public function test_desktop_mode_shell_config_surfaces_portal_intent_flag() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET[ DESKTOP_MODE_PORTAL_FLAG ]        = '1';
		$_GET[ DESKTOP_MODE_PORTAL_INTENT_FLAG ] = '1';
		$_GET['post']                            = '104';
		$_GET['action']                          = 'edit';

		$received = null;
		add_filter(
			'desktop_mode_shell_config',
			function ( $config ) use ( &$received ) {
				$received = $config;
				return $config;
			}
		);

		try {
			desktop_mode_enqueue_assets();
		} finally {
			unset( $_GET['post'], $_GET['action'] );
		}

		$this->assertIsArray( $received );
		$this->assertTrue( $received['fromPortal'] );
		$this->assertTrue( $received['fromPortalIntent'] );
		$this->assertStringNotContainsString( DESKTOP_MODE_PORTAL_FLAG, $received['currentPage'] );
		$this->assertStringNotContainsString( DESKTOP_MODE_PORTAL_INTENT_FLAG, $received['currentPage'] );
	}

	/**
	 * Bare portal entry — `fromPortal=true`, but no intent flag — must
	 * surface `fromPortalIntent=false` so the boot flow leaves the
	 * restored session alone.
	 *
	 * @covers ::desktop_mode_enqueue_assets
	 */
	public function test_desktop_mode_shell_config_intent_flag_defaults_false() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET[ DESKTOP_MODE_PORTAL_FLAG ] = '1';

		$received = null;
		add_filter(
			'desktop_mode_shell_config',
			function ( $config ) use ( &$received ) {
				$received = $config;
				return $config;
			}
		);

		desktop_mode_enqueue_assets();

		$this->assertIsArray( $received );
		$this->assertTrue( $received['fromPortal'] );
		$this->assertFalse( $received['fromPortalIntent'] );
	}

	/**
	 * @covers ::desktop_mode_enqueue_assets
	 */
	public function test_desktop_mode_mode_init_action_fires_when_assets_enqueue() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );

		$fired = false;
		add_action(
			'desktop_mode_mode_init',
			function () use ( &$fired ) {
				$fired = true;
			}
		);

		desktop_mode_enqueue_assets();

		$this->assertTrue( $fired );
	}

	/**
	 * @covers ::desktop_mode_enqueue_assets
	 */
	public function test_desktop_mode_mode_init_does_not_fire_when_mode_off() {
		$fired = false;
		add_action(
			'desktop_mode_mode_init',
			function () use ( &$fired ) {
				$fired = true;
			}
		);

		desktop_mode_enqueue_assets();

		$this->assertFalse( $fired );
	}

	/**
	 * @covers ::desktop_mode_enqueue_assets
	 */
	public function test_desktop_mode_chromeless_styles_action_fires_on_chromeless_request() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['desktop_mode_chromeless'] = '1';

		$fired = false;
		add_action(
			'desktop_mode_chromeless_styles',
			function () use ( &$fired ) {
				$fired = true;
			}
		);

		desktop_mode_enqueue_assets();

		$this->assertTrue( $fired );
	}

	/**
	 * @covers ::desktop_mode_enqueue_assets
	 */
	public function test_desktop_mode_chromeless_styles_does_not_fire_outside_chromeless() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );

		$fired = false;
		add_action(
			'desktop_mode_chromeless_styles',
			function () use ( &$fired ) {
				$fired = true;
			}
		);

		desktop_mode_enqueue_assets();

		$this->assertFalse( $fired );
	}
}
