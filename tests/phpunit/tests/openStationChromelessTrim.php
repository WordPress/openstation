<?php
/**
 * Tests for the chromeless asset trim — dropping admin-bar assets
 * inside windows, where the bar is suppressed and its scripts and
 * styles would load, parse and execute against markup that never
 * reaches the DOM.
 *
 * @package OpenStation
 *
 * @group openstation
 */
class Tests_OpenStation_ChromelessTrim extends WP_UnitTestCase {

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function tear_down() {
		delete_user_meta( self::$admin_id, 'desktop_mode_mode' );
		unset( $_GET['openstation_chromeless'] );
		remove_all_filters( 'openstation_chromeless_trimmed_scripts' );
		remove_all_filters( 'openstation_chromeless_trimmed_styles' );
		parent::tear_down();
	}

	/**
	 * Puts the request into the chromeless state the window iframe
	 * creates: OpenStation enabled for the user, plus the flag.
	 */
	private function enter_chromeless() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['openstation_chromeless'] = '1';
	}

	/**
	 * @covers ::openstation_chromeless_trimmed_scripts
	 * @covers ::openstation_chromeless_trimmed_styles
	 */
	public function test_defaults_cover_the_admin_bar_family() {
		$scripts = openstation_chromeless_trimmed_scripts();
		$styles  = openstation_chromeless_trimmed_styles();

		// Core's bar, ours, and the host masterbar extras — the whole
		// family, because leaving one queued drags core's `admin-bar`
		// back in as its dependency and undoes the trim.
		$this->assertContains( 'admin-bar', $scripts );
		$this->assertContains( 'os-admin-bar', $scripts );
		$this->assertContains( 'wpcom-admin-bar', $scripts );
		$this->assertContains( 'wpcom-notes-admin-bar', $scripts );
		$this->assertContains( 'admin-bar', $styles );
	}

	/**
	 * @covers ::openstation_chromeless_trim_assets
	 */
	public function test_trims_admin_bar_assets_in_a_window() {
		$this->enter_chromeless();

		wp_register_script( 'admin-bar', '/wp-includes/js/admin-bar.min.js', array(), '1', false );
		wp_register_style( 'admin-bar', '/wp-includes/css/admin-bar.min.css', array(), '1' );
		wp_enqueue_script( 'admin-bar' );
		wp_enqueue_style( 'admin-bar' );

		openstation_chromeless_trim_assets();

		$this->assertFalse( wp_script_is( 'admin-bar', 'enqueued' ) );
		$this->assertFalse( wp_style_is( 'admin-bar', 'enqueued' ) );
	}

	/**
	 * The shell draws a real admin bar — the trim must never touch a
	 * non-chromeless request.
	 *
	 * @covers ::openstation_chromeless_trim_assets
	 */
	public function test_leaves_the_shell_untouched() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		// No chromeless flag: this is the shell document.

		wp_register_script( 'admin-bar', '/wp-includes/js/admin-bar.min.js', array(), '1', false );
		wp_enqueue_script( 'admin-bar' );

		openstation_chromeless_trim_assets();

		$this->assertTrue( wp_script_is( 'admin-bar', 'enqueued' ) );
	}

	/**
	 * Dequeued, never deregistered: a handle another script depends on
	 * must stay resolvable so the dependent keeps working.
	 *
	 * @covers ::openstation_chromeless_trim_assets
	 */
	public function test_trimmed_handles_stay_registered() {
		$this->enter_chromeless();

		wp_register_script( 'admin-bar', '/wp-includes/js/admin-bar.min.js', array(), '1', false );
		wp_enqueue_script( 'admin-bar' );

		openstation_chromeless_trim_assets();

		$this->assertTrue( wp_script_is( 'admin-bar', 'registered' ) );
	}

	/**
	 * @covers ::openstation_chromeless_trimmed_scripts
	 */
	public function test_filter_can_add_and_remove_handles() {
		add_filter(
			'openstation_chromeless_trimmed_scripts',
			static function ( $handles ) {
				$handles   = array_values( array_diff( $handles, array( 'admin-bar' ) ) );
				$handles[] = 'my-plugin-chrome';
				return $handles;
			}
		);

		$handles = openstation_chromeless_trimmed_scripts();
		$this->assertNotContains( 'admin-bar', $handles );
		$this->assertContains( 'my-plugin-chrome', $handles );
	}

	/**
	 * A site that filtered a handle back in must keep it — the filter
	 * is the escape hatch for anyone who genuinely needs bar assets
	 * inside a window.
	 *
	 * @covers ::openstation_chromeless_trim_assets
	 */
	public function test_filtered_out_handle_survives_the_trim() {
		$this->enter_chromeless();
		add_filter( 'openstation_chromeless_trimmed_scripts', '__return_empty_array' );

		wp_register_script( 'admin-bar', '/wp-includes/js/admin-bar.min.js', array(), '1', false );
		wp_enqueue_script( 'admin-bar' );

		openstation_chromeless_trim_assets();

		$this->assertTrue( wp_script_is( 'admin-bar', 'enqueued' ) );
	}

	/**
	 * Our own toggle bundle is the largest asset in the family, and it
	 * must not even be enqueued inside a window.
	 *
	 * @covers ::openstation_enqueue_toggle_assets
	 */
	public function test_own_toggle_assets_are_not_enqueued_in_a_window() {
		$this->enter_chromeless();
		set_current_screen( 'dashboard' );

		openstation_enqueue_toggle_assets();

		$this->assertFalse( wp_script_is( 'os-admin-bar', 'enqueued' ) );
	}
}
