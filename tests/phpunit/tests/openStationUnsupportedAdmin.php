<?php
/**
 * Tests for the Network Admin / User Admin render gate.
 *
 * The desktop shell only covers site admin. Both other admin areas run
 * the same `admin_init` / `in_admin_header` / `admin_enqueue_scripts`
 * hooks, so without an explicit gate the shell renders over screens
 * whose menu it cannot address — and, worse, the portal redirect makes
 * them unreachable altogether (covered in openStationPortal.php).
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-render
 */
class Tests_OpenStation_UnsupportedAdmin extends WP_UnitTestCase {

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
	}

	public function tear_down() {
		delete_user_meta( self::$admin_id, 'desktop_mode_mode' );
		unset( $GLOBALS['current_screen'] );
		parent::tear_down();
	}

	/**
	 * `WP_Admin_Bar` is only loaded on requests that actually render the
	 * bar, which the PHPUnit bootstrap is not.
	 */
	private function make_admin_bar() {
		require_once ABSPATH . WPINC . '/class-wp-admin-bar.php';
		return new WP_Admin_Bar();
	}

	/**
	 * @covers ::openstation_is_unsupported_admin_request
	 */
	public function test_site_admin_screen_is_supported() {
		set_current_screen( 'edit-post' );

		$this->assertFalse( openstation_is_unsupported_admin_request() );
	}

	/**
	 * @covers ::openstation_is_unsupported_admin_request
	 */
	public function test_network_admin_screen_is_unsupported() {
		set_current_screen( 'sites-network' );

		$this->assertTrue( openstation_is_unsupported_admin_request() );
	}

	/**
	 * @covers ::openstation_is_unsupported_admin_request
	 */
	public function test_user_admin_screen_is_unsupported() {
		set_current_screen( 'profile-user' );

		$this->assertTrue( openstation_is_unsupported_admin_request() );
	}

	/**
	 * The shell markup must not render over Network Admin — the dock is
	 * built from the network `$menu` but every URL resolves through
	 * `admin_url()`, so it would point at the wrong screens.
	 *
	 * @covers ::openstation_render_shell
	 */
	public function test_shell_does_not_render_in_network_admin() {
		set_current_screen( 'sites-network' );

		ob_start();
		openstation_render_shell();
		$html = ob_get_clean();

		$this->assertSame( '', $html );
	}

	/**
	 * @covers ::openstation_render_shell
	 */
	public function test_shell_renders_on_a_site_admin_screen() {
		set_current_screen( 'edit-post' );

		ob_start();
		openstation_render_shell();
		$html = ob_get_clean();

		$this->assertStringContainsString( 'id="os-shell"', $html );
	}

	/**
	 * `os-active` hides the classic sidebar, content and footer. Adding
	 * it where no shell renders would leave a blank admin page.
	 *
	 * @covers ::openstation_admin_body_classes
	 */
	public function test_body_class_omits_os_active_in_network_admin() {
		set_current_screen( 'sites-network' );

		$this->assertStringNotContainsString(
			'os-active',
			openstation_admin_body_classes( 'wp-admin' )
		);
	}

	/**
	 * @covers ::openstation_admin_body_classes
	 */
	public function test_body_class_omits_os_active_in_user_admin() {
		set_current_screen( 'profile-user' );

		$this->assertStringNotContainsString(
			'os-active',
			openstation_admin_body_classes( 'wp-admin' )
		);
	}

	/**
	 * @covers ::openstation_admin_body_classes
	 */
	public function test_body_class_adds_os_active_on_a_site_admin_screen() {
		set_current_screen( 'edit-post' );

		$this->assertStringContainsString(
			'os-active',
			openstation_admin_body_classes( 'wp-admin' )
		);
	}

	/**
	 * The shell-only admin-bar controls (fullscreen, overview, keyboard
	 * shortcuts, Mio) hang off the same "currently viewing OpenStation"
	 * flag as the toggle label. With no shell on screen they would be
	 * dead buttons.
	 *
	 * @covers ::openstation_admin_bar_toggle
	 */
	public function test_admin_bar_offers_no_shell_controls_in_network_admin() {
		set_current_screen( 'sites-network' );

		$bar = $this->make_admin_bar();
		openstation_admin_bar_toggle( $bar );

		$this->assertNull( $bar->get_node( 'desktop-fullscreen' ) );

		$toggle = $bar->get_node( 'os-toggle' );
		$this->assertNotNull( $toggle );
		$this->assertStringContainsString( 'Switch to OpenStation', $toggle->title );
	}

	/**
	 * @covers ::openstation_admin_bar_toggle
	 */
	public function test_admin_bar_offers_shell_controls_on_a_site_admin_screen() {
		set_current_screen( 'edit-post' );

		$bar = $this->make_admin_bar();
		openstation_admin_bar_toggle( $bar );

		$this->assertNotNull( $bar->get_node( 'desktop-fullscreen' ) );

		$toggle = $bar->get_node( 'os-toggle' );
		$this->assertNotNull( $toggle );
		$this->assertStringContainsString( 'Switch to Classic Admin', $toggle->title );
	}
}
