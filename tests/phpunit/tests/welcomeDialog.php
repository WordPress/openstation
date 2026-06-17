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
		// Start every test from a known baseline — Desktop Mode OFF and the
		// intro NOT dismissed. A test that enables DM or marks the intro seen
		// would otherwise leak that state forward, and a later test would
		// then return false via the wrong gate (e.g. the seen-intro / filter
		// tests passing via the desktop_mode_is_enabled() gate instead).
		delete_user_meta( self::$user_id, 'desktop_mode_mode' );
		desktop_mode_clear_seen_intros( self::$user_id );
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

	/**
	 * Regression: the dismissal must be sent to the origin the admin page was
	 * actually loaded from, not the absolute `site_url()` origin. When the
	 * admin is viewed through a different origin (reverse proxy, Flexible-SSL
	 * edge, mapped multisite domain, or an HTTPS dev proxy in front of an HTTP
	 * site), POSTing the absolute URL is cross-origin / mixed-content, the
	 * browser blocks it, the slug is never recorded, and the dialog re-renders
	 * on every classic-admin page load. Guard the same-origin reconstruction
	 * (and the `sendBeacon` delivery that survives the "Enable it now"
	 * navigation) so neither can silently regress.
	 *
	 * @covers ::desktop_mode_render_welcome_dialog
	 */
	public function test_dismissal_is_sent_same_origin() {
		ob_start();
		desktop_mode_render_welcome_dialog();
		$markup = ob_get_clean();

		$this->assertNotEmpty( $markup, 'The dialog should render for a fresh classic-admin user.' );
		$this->assertStringContainsString(
			'window.location.origin',
			$markup,
			'The dismissal request must be reissued onto the current browsing origin.'
		);
		$this->assertStringContainsString(
			'sendBeacon',
			$markup,
			'The dismissal should use sendBeacon so it survives the "Enable it now" navigation.'
		);
	}
}
