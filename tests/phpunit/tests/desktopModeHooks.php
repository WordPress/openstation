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
		wpdm_flush_script_handle_registries();
	}

	public function tear_down() {
		delete_user_meta( self::$admin_id, 'wp_desktop_mode' );
		remove_all_filters( 'wp_desktop_dock_items' );
		remove_all_filters( 'wp_desktop_dock_item' );
		remove_all_filters( 'wp_desktop_shell_config' );
		remove_all_filters( 'wp_desktop_mode_enabled' );
		remove_all_actions( 'wp_desktop_mode_init' );
		remove_all_actions( 'wp_desktop_chromeless_styles' );
		unset( $_GET['wp_desktop'] );
		parent::tear_down();
	}

	/**
	 * @covers ::wpdm_build_dock_items
	 */
	public function test_wp_desktop_dock_items_filter_receives_array() {
		global $menu;
		$menu = array(
			array( 'Posts', 'edit_posts', 'edit.php', '', '', 'menu-posts', 'dashicons-admin-post' ),
		);

		$received = null;
		add_filter(
			'wp_desktop_dock_items',
			function ( $items ) use ( &$received ) {
				$received = $items;
				return $items;
			}
		);

		wpdm_build_dock_items();

		$this->assertIsArray( $received );
		$this->assertCount( 1, $received );
	}

	/**
	 * @covers ::wpdm_build_dock_items
	 */
	public function test_wp_desktop_dock_item_filter_receives_item_and_slug() {
		global $menu;
		$menu = array(
			array( 'Posts', 'edit_posts', 'edit.php', '', '', 'menu-posts', 'dashicons-admin-post' ),
		);

		$received_item = null;
		$received_slug = null;
		add_filter(
			'wp_desktop_dock_item',
			function ( $item, $slug ) use ( &$received_item, &$received_slug ) {
				$received_item = $item;
				$received_slug = $slug;
				return $item;
			},
			10,
			2
		);

		wpdm_build_dock_items();

		$this->assertIsArray( $received_item );
		$this->assertSame( 'edit.php', $received_slug );
	}

	/**
	 * @covers ::wpdm_enqueue_assets
	 */
	public function test_wp_desktop_shell_config_filter_fires_with_expected_keys() {
		update_user_meta( self::$admin_id, 'wp_desktop_mode', '1' );

		$received = null;
		add_filter(
			'wp_desktop_shell_config',
			function ( $config ) use ( &$received ) {
				$received = $config;
				return $config;
			}
		);

		wpdm_enqueue_assets();

		$this->assertIsArray( $received );
		foreach ( array( 'currentPage', 'currentTitle', 'currentIcon', 'adminUrl', 'colorScheme', 'dockItems' ) as $key ) {
			$this->assertArrayHasKey( $key, $received, "Config missing key: $key" );
		}
	}

	/**
	 * @covers ::wpdm_enqueue_assets
	 */
	public function test_wp_desktop_mode_init_action_fires_when_assets_enqueue() {
		update_user_meta( self::$admin_id, 'wp_desktop_mode', '1' );

		$fired = false;
		add_action(
			'wp_desktop_mode_init',
			function () use ( &$fired ) {
				$fired = true;
			}
		);

		wpdm_enqueue_assets();

		$this->assertTrue( $fired );
	}

	/**
	 * @covers ::wpdm_enqueue_assets
	 */
	public function test_wp_desktop_mode_init_does_not_fire_when_mode_off() {
		$fired = false;
		add_action(
			'wp_desktop_mode_init',
			function () use ( &$fired ) {
				$fired = true;
			}
		);

		wpdm_enqueue_assets();

		$this->assertFalse( $fired );
	}

	/**
	 * @covers ::wpdm_enqueue_assets
	 */
	public function test_wp_desktop_chromeless_styles_action_fires_on_chromeless_request() {
		update_user_meta( self::$admin_id, 'wp_desktop_mode', '1' );
		$_GET['wp_desktop'] = '1';

		$fired = false;
		add_action(
			'wp_desktop_chromeless_styles',
			function () use ( &$fired ) {
				$fired = true;
			}
		);

		wpdm_enqueue_assets();

		$this->assertTrue( $fired );
	}

	/**
	 * @covers ::wpdm_enqueue_assets
	 */
	public function test_wp_desktop_chromeless_styles_does_not_fire_outside_chromeless() {
		update_user_meta( self::$admin_id, 'wp_desktop_mode', '1' );

		$fired = false;
		add_action(
			'wp_desktop_chromeless_styles',
			function () use ( &$fired ) {
				$fired = true;
			}
		);

		wpdm_enqueue_assets();

		$this->assertFalse( $fired );
	}
}
