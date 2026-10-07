<?php

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

		add_action( 'admin_print_scripts', 'print_emoji_detection_script' );
		add_action( 'admin_enqueue_scripts', 'wp_enqueue_emoji_styles' );
		parent::tear_down();
	}

	private function enter_chromeless() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['openstation_chromeless'] = '1';
	}

	public function test_defaults_cover_the_admin_bar_family() {
		$scripts = openstation_chromeless_trimmed_scripts();
		$styles  = openstation_chromeless_trimmed_styles();

		$this->assertContains( 'admin-bar', $scripts );
		$this->assertContains( 'os-admin-bar', $scripts );
		$this->assertContains( 'wpcom-admin-bar', $scripts );
		$this->assertContains( 'wpcom-notes-admin-bar', $scripts );
		$this->assertContains( 'admin-bar', $styles );
	}

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

	public function test_leaves_the_shell_untouched() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );

		wp_register_script( 'admin-bar', '/wp-includes/js/admin-bar.min.js', array(), '1', false );
		wp_enqueue_script( 'admin-bar' );

		openstation_chromeless_trim_assets();

		$this->assertTrue( wp_script_is( 'admin-bar', 'enqueued' ) );
	}

	public function test_trimmed_handles_stay_registered() {
		$this->enter_chromeless();

		wp_register_script( 'admin-bar', '/wp-includes/js/admin-bar.min.js', array(), '1', false );
		wp_enqueue_script( 'admin-bar' );

		openstation_chromeless_trim_assets();

		$this->assertTrue( wp_script_is( 'admin-bar', 'registered' ) );
	}

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

	public function test_filtered_out_handle_survives_the_trim() {
		$this->enter_chromeless();
		add_filter( 'openstation_chromeless_trimmed_scripts', '__return_empty_array' );

		wp_register_script( 'admin-bar', '/wp-includes/js/admin-bar.min.js', array(), '1', false );
		wp_enqueue_script( 'admin-bar' );

		openstation_chromeless_trim_assets();

		$this->assertTrue( wp_script_is( 'admin-bar', 'enqueued' ) );
	}

	public function test_print_list_filter_strips_trimmed_handles() {
		$this->enter_chromeless();

		$handles = array( 'jquery-core', 'admin-bar', 'wpcom-notes-admin-bar', 'common' );
		$out     = openstation_chromeless_filter_print_list( $handles, 'scripts' );

		$this->assertSame( array( 'jquery-core', 'common' ), $out );
	}

	public function test_print_list_filter_is_a_noop_outside_windows() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );

		$handles = array( 'jquery-core', 'admin-bar' );
		$this->assertSame(
			$handles,
			openstation_chromeless_filter_print_list( $handles, 'scripts' )
		);
	}

	public function test_print_list_filter_uses_the_matching_list() {
		$this->enter_chromeless();

		$out = openstation_chromeless_filter_print_list(
			array( 'admin-bar', 'os-admin-bar', 'colors' ),
			'styles'
		);

		$this->assertSame( array( 'os-admin-bar', 'colors' ), $out );
	}

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

	public function test_emoji_polyfill_kept_in_the_shell() {
		wp_set_current_user( self::$admin_id );
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );

		openstation_chromeless_suppress_emoji();

		$this->assertNotFalse(
			has_action( 'admin_print_scripts', 'print_emoji_detection_script' )
		);
	}

	public function test_emoji_trim_can_be_filtered_off() {
		$this->enter_chromeless();
		add_filter( 'openstation_chromeless_trim_emoji', '__return_false' );

		openstation_chromeless_suppress_emoji();

		$this->assertNotFalse(
			has_action( 'admin_print_scripts', 'print_emoji_detection_script' )
		);
	}

	public function test_own_toggle_assets_are_not_enqueued_in_a_window() {
		$this->enter_chromeless();
		set_current_screen( 'dashboard' );

		openstation_enqueue_toggle_assets();

		$this->assertFalse( wp_script_is( 'os-admin-bar', 'enqueued' ) );
	}
}
