<?php

class Tests_OpenStation_WelcomeDialog extends WP_UnitTestCase {

	protected static $user_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$user_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$user_id );

		set_current_screen( 'dashboard' );

		delete_user_meta( self::$user_id, 'desktop_mode_mode' );
		openstation_clear_seen_intros( self::$user_id );

		openstation_record_activator();
	}

	public function tear_down() {
		set_current_screen( 'front' );
		wp_set_current_user( 0 );
		parent::tear_down();
	}

	public function test_shows_for_a_fresh_classic_admin_user() {
		$this->assertTrue( openstation_should_show_welcome_dialog() );
	}

	public function test_hidden_once_openstation_is_enabled() {
		update_user_meta( self::$user_id, 'desktop_mode_mode', '1' );

		$this->assertFalse(
			openstation_should_show_welcome_dialog(),
			'The welcome promo must not render when OpenStation is already on.'
		);
	}

	public function test_hidden_after_intro_dismissed() {
		openstation_mark_intro_seen( self::$user_id, OPENSTATION_WELCOME_INTRO_SLUG );

		$this->assertFalse( openstation_should_show_welcome_dialog() );
	}

	public function test_hidden_for_users_who_did_not_activate_the_plugin() {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );

		$this->assertFalse( openstation_should_show_welcome_dialog() );
	}

	public function test_hidden_after_an_activation_without_a_user() {
		wp_set_current_user( 0 );
		openstation_record_activator();
		wp_set_current_user( self::$user_id );

		$this->assertFalse( openstation_should_show_welcome_dialog() );
	}

	public function test_filter_can_suppress_the_dialog() {
		add_filter( 'openstation_show_welcome_dialog', '__return_false' );

		$this->assertFalse( openstation_should_show_welcome_dialog() );
	}

	public function test_hidden_outside_admin_context() {
		set_current_screen( 'front' );

		$this->assertFalse( openstation_should_show_welcome_dialog() );
	}

	public function test_dismissal_is_sent_same_origin() {
		ob_start();
		openstation_render_welcome_dialog();
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
