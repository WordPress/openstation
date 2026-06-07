<?php
/**
 * Tests for the first-run "Welcome to Desktop Mode" classic-admin dialog gate.
 *
 * @group desktop-mode
 * @group desktop-mode-welcome
 */
class Tests_DesktopMode_WelcomeDialog extends WP_UnitTestCase {

	protected static $user_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$user_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$user_id );
		// `desktop_mode_should_show_welcome_dialog()` gates on `is_admin()`;
		// a dashboard screen makes that return true under PHPUnit.
		set_current_screen( 'dashboard' );
	}

	public function tear_down() {
		set_current_screen( 'front' );
		wp_set_current_user( 0 );
		parent::tear_down();
	}

	/**
	 * @covers ::desktop_mode_should_show_welcome_dialog
	 */
	public function test_shows_for_a_fresh_classic_admin_user() {
		$this->assertTrue( desktop_mode_should_show_welcome_dialog() );
	}

	/**
	 * The regression: the promo is a "switch to Desktop Mode" pitch, so it
	 * must never render once the user is already in the shell — otherwise it
	 * re-appears on the shell parent page right after "Enable it now".
	 *
	 * @covers ::desktop_mode_should_show_welcome_dialog
	 */
	public function test_hidden_once_desktop_mode_is_enabled() {
		update_user_meta( self::$user_id, 'desktop_mode_mode', '1' );

		$this->assertFalse(
			desktop_mode_should_show_welcome_dialog(),
			'The welcome promo must not render when Desktop Mode is already on.'
		);
	}

	/**
	 * @covers ::desktop_mode_should_show_welcome_dialog
	 */
	public function test_hidden_after_intro_dismissed() {
		desktop_mode_mark_intro_seen( self::$user_id, DESKTOP_MODE_WELCOME_INTRO_SLUG );

		$this->assertFalse( desktop_mode_should_show_welcome_dialog() );
	}

	/**
	 * @covers ::desktop_mode_should_show_welcome_dialog
	 */
	public function test_filter_can_suppress_the_dialog() {
		add_filter( 'desktop_mode_show_welcome_dialog', '__return_false' );

		$this->assertFalse( desktop_mode_should_show_welcome_dialog() );
	}

	/**
	 * @covers ::desktop_mode_should_show_welcome_dialog
	 */
	public function test_hidden_outside_admin_context() {
		set_current_screen( 'front' );

		$this->assertFalse( desktop_mode_should_show_welcome_dialog() );
	}
}
