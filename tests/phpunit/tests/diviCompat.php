<?php

class Tests_OpenStation_DiviCompat extends WP_UnitTestCase {

	private $chromeless_user_id = 0;

	public function tear_down() {
		wp_deregister_script( 'et-builder-gutenberg' );
		unset( $_GET['openstation_chromeless'], $_GET['app_window'] );
		if ( $this->chromeless_user_id > 0 ) {
			delete_user_meta( $this->chromeless_user_id, 'desktop_mode_mode' );
			$this->chromeless_user_id = 0;
		}
		parent::tear_down();
	}

	private function force_chromeless() {
		$_GET['openstation_chromeless'] = '1';
		$this->chromeless_user_id        = self::factory()->user->create( array( 'role' => 'administrator' ) );
		wp_set_current_user( $this->chromeless_user_id );
		update_user_meta( $this->chromeless_user_id, 'desktop_mode_mode', '1' );
	}

	public function test_injects_missing_wp_editor_and_wp_data_deps() {
		wp_register_script(
			'et-builder-gutenberg',
			'https://example.test/divi-gutenberg.js',
			array( 'jquery', 'wp-hooks' ),
			'5.5.2',
			true
		);

		do_action( 'enqueue_block_editor_assets' );

		$deps = wp_scripts()->registered['et-builder-gutenberg']->deps;

		$this->assertContains( 'wp-data', $deps, 'wp-data must be injected so core/editor store registers first.' );
		$this->assertContains( 'wp-editor', $deps, 'wp-editor must be injected so the data store is populated before Divi runs.' );

		$this->assertContains( 'jquery', $deps );
		$this->assertContains( 'wp-hooks', $deps );
	}

	public function test_no_op_when_divi_not_registered() {
		$this->assertFalse( wp_script_is( 'et-builder-gutenberg', 'registered' ) );

		do_action( 'enqueue_block_editor_assets' );

		$this->assertFalse( wp_script_is( 'et-builder-gutenberg', 'registered' ) );
	}

	public function test_does_not_duplicate_deps_when_already_present() {
		wp_register_script(
			'et-builder-gutenberg',
			'https://example.test/divi-gutenberg.js',
			array( 'jquery', 'wp-hooks', 'wp-data', 'wp-editor' ),
			'5.5.2',
			true
		);

		do_action( 'enqueue_block_editor_assets' );
		do_action( 'enqueue_block_editor_assets' );

		$deps = wp_scripts()->registered['et-builder-gutenberg']->deps;

		$this->assertSame( 1, count( array_keys( $deps, 'wp-data', true ) ) );
		$this->assertSame( 1, count( array_keys( $deps, 'wp-editor', true ) ) );
	}

	public function test_chromeless_request_appends_et_gb_window_override() {
		$this->force_chromeless();
		wp_register_script(
			'et-builder-gutenberg',
			'https://example.test/divi-gutenberg.js',
			array( 'jquery', 'wp-hooks' ),
			'5.5.2',
			true
		);

		do_action( 'enqueue_block_editor_assets' );

		$before_inlines = (array) wp_scripts()->get_data( 'et-builder-gutenberg', 'before' );
		$joined         = implode( "\n", $before_inlines );

		$this->assertStringContainsString( 'window.et_gb = window;', $joined );
	}

	public function test_classic_request_does_not_append_et_gb_override() {

		wp_set_current_user( 0 );
		wp_register_script(
			'et-builder-gutenberg',
			'https://example.test/divi-gutenberg.js',
			array( 'jquery', 'wp-hooks' ),
			'5.5.2',
			true
		);

		do_action( 'enqueue_block_editor_assets' );

		$before_inlines = (array) wp_scripts()->get_data( 'et-builder-gutenberg', 'before' );
		$joined         = implode( "\n", $before_inlines );

		$this->assertStringNotContainsString( 'window.et_gb = window;', $joined );
	}

	private function capture_vb_signal_output() {
		ob_start();
		openstation_compat_divi_vb_iframe_signal();
		return ob_get_clean();
	}

	public function test_vb_iframe_signal_emits_on_front_end_for_desktop_user() {
		$this->chromeless_user_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
		wp_set_current_user( $this->chromeless_user_id );
		update_user_meta( $this->chromeless_user_id, 'desktop_mode_mode', '1' );
		$this->activate_divi_theme();

		$out = $this->capture_vb_signal_output();

		$this->assertStringContainsString( 'os-compat-divi-vb', $out );
		$this->assertStringContainsString( '__Cypress__', $out );
		$this->assertStringContainsString( 'window.top === window', $out );
	}

	public function test_vb_iframe_signal_skips_admin_requests() {
		set_current_screen( 'edit-post' );
		$this->chromeless_user_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
		wp_set_current_user( $this->chromeless_user_id );
		update_user_meta( $this->chromeless_user_id, 'desktop_mode_mode', '1' );

		$out = $this->capture_vb_signal_output();
		set_current_screen( 'front' );

		$this->assertSame( '', trim( $out ) );
	}

	public function test_vb_iframe_signal_skips_when_openstation_disabled() {
		wp_set_current_user( 0 );

		$out = $this->capture_vb_signal_output();

		$this->assertSame( '', trim( $out ) );
	}

	public function test_vb_top_frame_emits_preloader_bridge() {
		$this->chromeless_user_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
		wp_set_current_user( $this->chromeless_user_id );
		update_user_meta( $this->chromeless_user_id, 'desktop_mode_mode', '1' );
		$this->activate_divi_theme();

		$out = $this->capture_vb_signal_output();

		$this->assertStringContainsString( '__Cypress__', $out );
		$this->assertStringContainsString( 'et-vb-app-frame', $out );
		$this->assertStringContainsString( 'et-fb-page-preloading', $out );
		$this->assertStringContainsString( 'MutationObserver', $out );
	}

	public function test_inner_app_frame_skips_preloader_bridge() {
		$this->chromeless_user_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
		wp_set_current_user( $this->chromeless_user_id );
		update_user_meta( $this->chromeless_user_id, 'desktop_mode_mode', '1' );
		$this->activate_divi_theme();
		$_GET['app_window'] = '1';

		$out = $this->capture_vb_signal_output();

		$this->assertStringContainsString( '__Cypress__', $out );
		$this->assertStringNotContainsString( 'et-vb-app-frame', $out );
		$this->assertStringNotContainsString( 'MutationObserver', $out );
	}

	public function test_inner_app_frame_bails_when_parent_equals_top() {
		$this->chromeless_user_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
		wp_set_current_user( $this->chromeless_user_id );
		update_user_meta( $this->chromeless_user_id, 'desktop_mode_mode', '1' );
		$this->activate_divi_theme();
		$_GET['app_window'] = '1';

		$out = $this->capture_vb_signal_output();

		$guardPos   = strpos( $out, 'window.parent === window.top' );
		$cypressPos = strpos( $out, '__Cypress__ = window.top.__Cypress__' );
		$this->assertNotFalse( $guardPos, 'parent-equals-top guard must be present in the app-frame branch.' );
		$this->assertNotFalse( $cypressPos );
		$this->assertLessThan( $cypressPos, $guardPos, 'Guard must precede the __Cypress__ assignment so 2-deep top-level VB bails first.' );
	}

	private function activate_divi_theme() {
		update_option( 'stylesheet', 'Divi' );
		update_option( 'template', 'Divi' );
		wp_clean_themes_cache();
	}

	private function capture_iframe_patch_output() {
		ob_start();
		openstation_compat_divi_eject_iframe_patch();
		return ob_get_clean();
	}

	private function capture_parent_listener_output() {
		ob_start();
		openstation_compat_divi_eject_parent_listener();
		return ob_get_clean();
	}

	public function test_iframe_patch_emits_in_chromeless_for_divi() {
		$this->force_chromeless();
		$this->activate_divi_theme();

		$out = $this->capture_iframe_patch_output();

		$this->assertStringContainsString( 'os-compat-divi-vb-handoff', $out );
		$this->assertStringContainsString( 'os-divi-vb-handoff', $out );

		$this->assertStringContainsString( 'use divi builder', $out );
		$this->assertStringContainsString( 'edit with the divi builder', $out );

		$this->assertStringContainsString( "addEventListener( 'click'", $out );
	}

	public function test_iframe_patch_skips_when_not_chromeless() {
		wp_set_current_user( 0 );
		$this->activate_divi_theme();

		$out = $this->capture_iframe_patch_output();

		$this->assertSame( '', trim( $out ) );
	}

	public function test_iframe_patch_skips_without_divi() {
		$this->force_chromeless();

		$out = $this->capture_iframe_patch_output();

		$this->assertSame( '', trim( $out ) );
	}

	public function test_parent_listener_emits_on_shell_for_divi() {
		$this->chromeless_user_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
		wp_set_current_user( $this->chromeless_user_id );
		update_user_meta( $this->chromeless_user_id, 'desktop_mode_mode', '1' );
		set_current_screen( OPENSTATION_SHELL_SCREEN_ID );
		$this->activate_divi_theme();

		$out = $this->capture_parent_listener_output();

		$this->assertStringContainsString( 'os-compat-divi-vb-handoff-parent', $out );
		$this->assertStringContainsString( 'os-divi-vb-handoff', $out );
		$this->assertStringContainsString( 'window.top.location.href', $out );

		$this->assertStringContainsString( 'ev.origin !== window.location.origin', $out );

		$this->assertStringContainsString( 'wp.os.confirm', $out );
		$this->assertStringContainsString( 'Open Divi in this tab', $out );

		$this->assertStringContainsString( 'hideCancel: true', $out );
		$this->assertStringContainsString( 'dismissable: true', $out );

		$this->assertStringContainsString( "searchParams.delete( 'openstation_chromeless' )", $out );
		$this->assertStringContainsString( "searchParams.set( 'desktop_mode_classic', '1' )", $out );
	}

	public function test_parent_listener_skips_in_chromeless_request() {
		$this->force_chromeless();
		$this->activate_divi_theme();

		$out = $this->capture_parent_listener_output();

		$this->assertSame( '', trim( $out ) );
	}

	public function test_parent_listener_skips_when_openstation_disabled() {
		wp_set_current_user( 0 );
		$this->activate_divi_theme();

		$out = $this->capture_parent_listener_output();

		$this->assertSame( '', trim( $out ) );
	}

	public function test_parent_listener_skips_without_divi() {
		$this->chromeless_user_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
		wp_set_current_user( $this->chromeless_user_id );
		update_user_meta( $this->chromeless_user_id, 'desktop_mode_mode', '1' );

		$out = $this->capture_parent_listener_output();

		$this->assertSame( '', trim( $out ) );
	}

	public function test_is_active_true_for_divi_theme() {
		$this->activate_divi_theme();
		$this->assertTrue( openstation_compat_divi_is_active() );
	}

	public function test_is_active_false_for_other_theme() {
		$this->assertFalse( openstation_compat_divi_is_active() );
	}
}
