<?php
/**
 * Tests for the admin-bar suppression inside windows.
 *
 * Removing the render stops the markup; it does not stop the work.
 * `_wp_admin_bar_init()` still runs on `admin_init` because
 * `is_admin_bar_showing()` short-circuits to true in admin, so every
 * window built a full `WP_Admin_Bar` — firing `admin_bar_menu` and
 * every callback on it — and threw it away. These pin the class swap
 * that stops that without leaving the global null.
 *
 * @package OpenStation
 *
 * @group openstation
 */
class Tests_OpenStation_ChromelessAdminBar extends WP_UnitTestCase {

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function tear_down() {
		delete_user_meta( self::$admin_id, 'desktop_mode_mode' );
		unset( $_GET['openstation_chromeless'] );
		remove_all_filters( 'openstation_chromeless_silence_admin_bar' );
		parent::tear_down();
	}

	private function enter_chromeless() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['openstation_chromeless'] = '1';
	}

	/**
	 * @covers ::openstation_chromeless_silence_admin_bar
	 */
	public function test_shell_keeps_the_real_admin_bar_class() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		// No chromeless flag: the shell draws a real bar.

		$this->assertSame(
			'WP_Admin_Bar',
			openstation_chromeless_silence_admin_bar( 'WP_Admin_Bar' )
		);
	}

	/**
	 * @covers ::openstation_chromeless_silence_admin_bar
	 */
	public function test_window_gets_the_silent_class() {
		$this->enter_chromeless();
		require_once ABSPATH . WPINC . '/class-wp-admin-bar.php';

		$this->assertSame(
			'OpenStation_Silent_Admin_Bar',
			openstation_chromeless_silence_admin_bar( 'WP_Admin_Bar' )
		);
	}

	/**
	 * The whole point: `add_menus()` is what fires `admin_bar_menu`
	 * and runs every core and plugin callback.
	 *
	 * @covers OpenStation_Silent_Admin_Bar::add_menus
	 */
	public function test_the_silent_class_never_fires_admin_bar_menu() {
		$this->enter_chromeless();
		require_once ABSPATH . WPINC . '/class-wp-admin-bar.php';
		openstation_chromeless_silence_admin_bar( 'WP_Admin_Bar' );

		$fired = 0;
		add_action(
			'admin_bar_menu',
			static function () use ( &$fired ) {
				++$fired;
			}
		);

		$bar = new OpenStation_Silent_Admin_Bar();
		$bar->initialize();
		$bar->add_menus();

		$this->assertSame( 0, $fired );
	}

	/**
	 * Swapping the class rather than unhooking the init is what keeps
	 * `$wp_admin_bar` a real object. A plugin touching the global
	 * outside the hook — bad practice, entirely real — must not fatal.
	 *
	 * @covers OpenStation_Silent_Admin_Bar::add_menus
	 */
	public function test_the_silent_class_is_still_a_working_admin_bar() {
		$this->enter_chromeless();
		require_once ABSPATH . WPINC . '/class-wp-admin-bar.php';
		openstation_chromeless_silence_admin_bar( 'WP_Admin_Bar' );

		$bar = new OpenStation_Silent_Admin_Bar();
		$bar->initialize();
		$bar->add_node(
			array(
				'id'    => 'os-test-node',
				'title' => 'Test',
			)
		);

		$this->assertInstanceOf( 'WP_Admin_Bar', $bar );
		$this->assertNotNull( $bar->get_node( 'os-test-node' ) );
	}

	/**
	 * @covers ::openstation_chromeless_silence_admin_bar
	 */
	public function test_silencing_can_be_filtered_off() {
		$this->enter_chromeless();
		add_filter( 'openstation_chromeless_silence_admin_bar', '__return_false' );

		$this->assertSame(
			'WP_Admin_Bar',
			openstation_chromeless_silence_admin_bar( 'WP_Admin_Bar' )
		);
	}
}
