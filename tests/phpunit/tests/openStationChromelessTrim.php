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
		remove_all_filters( 'openstation_chromeless_trim_emoji' );
		// Restore Core's emoji hooks for any test that follows.
		add_action( 'admin_print_scripts', 'print_emoji_detection_script' );
		add_action( 'admin_enqueue_scripts', 'wp_enqueue_emoji_styles' );
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
	 * Late enqueues and dependency pull-back both survive the dequeue
	 * pass, so the print-list filter is the last word.
	 *
	 * @covers ::openstation_chromeless_filter_print_list
	 */
	public function test_print_list_filter_strips_trimmed_handles() {
		$this->enter_chromeless();

		$handles = array( 'jquery-core', 'admin-bar', 'wpcom-notes-admin-bar', 'common' );
		$out     = openstation_chromeless_filter_print_list( $handles, 'scripts' );

		$this->assertSame( array( 'jquery-core', 'common' ), $out );
	}

	/**
	 * @covers ::openstation_chromeless_filter_print_list
	 */
	public function test_print_list_filter_is_a_noop_outside_windows() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );

		$handles = array( 'jquery-core', 'admin-bar' );
		$this->assertSame(
			$handles,
			openstation_chromeless_filter_print_list( $handles, 'scripts' )
		);
	}

	/**
	 * Styles use their own list — a script-only handle must not be
	 * stripped from the stylesheet print list.
	 *
	 * @covers ::openstation_chromeless_filter_print_list
	 */
	public function test_print_list_filter_uses_the_matching_list() {
		$this->enter_chromeless();

		$out = openstation_chromeless_filter_print_list(
			array( 'admin-bar', 'os-admin-bar', 'colors' ),
			'styles'
		);

		// `os-admin-bar` is a script handle; the style list leaves it.
		$this->assertSame( array( 'os-admin-bar', 'colors' ), $out );
	}

	/**
	 * The emoji polyfill goes the way Core itself drops it on the
	 * block-editor screen.
	 *
	 * @covers ::openstation_chromeless_suppress_emoji
	 */
	public function test_emoji_polyfill_dropped_in_a_window() {
		$this->enter_chromeless();

		openstation_chromeless_suppress_emoji();

		$this->assertFalse(
			has_action( 'admin_print_scripts', 'print_emoji_detection_script' )
		);
		$this->assertFalse(
			has_action( 'admin_enqueue_scripts', 'wp_enqueue_emoji_styles' )
		);
	}

	/**
	 * @covers ::openstation_chromeless_suppress_emoji
	 */
	public function test_emoji_polyfill_kept_in_the_shell() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		// No chromeless flag.

		openstation_chromeless_suppress_emoji();

		$this->assertNotFalse(
			has_action( 'admin_print_scripts', 'print_emoji_detection_script' )
		);
	}

	/**
	 * @covers ::openstation_chromeless_suppress_emoji
	 */
	public function test_emoji_trim_can_be_filtered_off() {
		$this->enter_chromeless();
		add_filter( 'openstation_chromeless_trim_emoji', '__return_false' );

		openstation_chromeless_suppress_emoji();

		$this->assertNotFalse(
			has_action( 'admin_print_scripts', 'print_emoji_detection_script' )
		);
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
