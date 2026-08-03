<?php
/**
 * Tests for the Divi script-dependency compat shim.
 *
 * Divi's `et-builder-gutenberg` bundle calls `wp.data.select(
 * 'core/editor' ).isCleanNewPost` at module-load time but only
 * declares `[ jquery, wp-hooks ]` as deps. When script load order
 * resolves against Divi, the call throws and Divi's React
 * integration never mounts. We add `wp-data` + `wp-editor` to the
 * existing registration so the loader prints the `core/editor`
 * store first. See includes/compat/divi.php.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 *
 * @covers ::openstation_compat_divi_fix_gutenberg_deps
 */
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

	/**
	 * Helper: simulate a chromeless request by priming the query
	 * arg + user meta that `openstation_is_chromeless_request()`
	 * checks. `tear_down()` resets the state.
	 */
	private function force_chromeless() {
		$_GET['openstation_chromeless'] = '1';
		$this->chromeless_user_id        = self::factory()->user->create( array( 'role' => 'administrator' ) );
		wp_set_current_user( $this->chromeless_user_id );
		update_user_meta( $this->chromeless_user_id, 'desktop_mode_mode', '1' );
	}

	/**
	 * Simulate Divi's registration shape, fire the compat hook,
	 * and assert the deps were extended.
	 */
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
		// Original deps survive the merge.
		$this->assertContains( 'jquery', $deps );
		$this->assertContains( 'wp-hooks', $deps );
	}

	/**
	 * Shim must be a no-op when Divi isn't installed — the script
	 * handle simply isn't registered.
	 */
	public function test_no_op_when_divi_not_registered() {
		$this->assertFalse( wp_script_is( 'et-builder-gutenberg', 'registered' ) );

		do_action( 'enqueue_block_editor_assets' );

		$this->assertFalse( wp_script_is( 'et-builder-gutenberg', 'registered' ) );
	}

	/**
	 * Idempotent: if Divi later fixes their deps upstream (or the
	 * shim runs twice for any reason), we must not duplicate the
	 * injected entries.
	 */
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

	/**
	 * Inside a chromeless iframe, we must append an inline `before`
	 * script that re-points `window.et_gb` at the iframe's own
	 * window. Divi's webpack externals resolve `@wordpress/data`
	 * via `window.et_gb.wp.data`, and Divi's own inline `before`
	 * sets `et_gb = window.top` — which is our desktop shell, a
	 * different document. We must override that assignment.
	 */
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

	/**
	 * In classic (non-chromeless) requests we must NOT override
	 * `window.et_gb` — Divi's original logic correctly points it at
	 * `window.top` for the Cypress-iframe case and at `window` for
	 * top-level page loads. Our override would clobber that.
	 */
	public function test_classic_request_does_not_append_et_gb_override() {
		// Ensure the chromeless query flag is not set; current user has no desktop meta.
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

	/**
	 * Helper: capture output of the wp_head-side VB signal function.
	 */
	private function capture_vb_signal_output() {
		ob_start();
		openstation_compat_divi_vb_iframe_signal();
		return ob_get_clean();
	}

	/**
	 * Front-end (`! is_admin()`) with a os-enabled user
	 * must emit the inline script that conditionally sets
	 * `__Cypress__` on the parent shell.
	 */
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

	/**
	 * Guard: the inline script must NOT be emitted on admin
	 * requests — admin uses the `et_gb` path; emitting both would
	 * confuse the Divi block-editor bundle that doesn't expect a
	 * Cypress flag on the shell.
	 */
	public function test_vb_iframe_signal_skips_admin_requests() {
		set_current_screen( 'edit-post' ); // primes is_admin() to true
		$this->chromeless_user_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
		wp_set_current_user( $this->chromeless_user_id );
		update_user_meta( $this->chromeless_user_id, 'desktop_mode_mode', '1' );

		$out = $this->capture_vb_signal_output();
		set_current_screen( 'front' );

		$this->assertSame( '', trim( $out ) );
	}

	/**
	 * Guard: no output for visitors who don't have OpenStation
	 * enabled. The shim only matters when our shell is what
	 * `window.top` points at.
	 */
	public function test_vb_iframe_signal_skips_when_openstation_disabled() {
		wp_set_current_user( 0 );

		$out = $this->capture_vb_signal_output();

		$this->assertSame( '', trim( $out ) );
	}

	/**
	 * The VB-top frame (no `app_window` flag) is what hosts the
	 * visible preloader. The emitted script MUST include the bridge
	 * logic — MutationObserver hook on `#et-vb-app-frame` plus the
	 * 30-second watchdog timeout — so the preloader gets stripped
	 * once Divi's React app de-classes the inner frame.
	 */
	public function test_vb_top_frame_emits_preloader_bridge() {
		$this->chromeless_user_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
		wp_set_current_user( $this->chromeless_user_id );
		update_user_meta( $this->chromeless_user_id, 'desktop_mode_mode', '1' );
		$this->activate_divi_theme();
		// Default request — no `app_window=1`, so this IS the VB-top.

		$out = $this->capture_vb_signal_output();

		$this->assertStringContainsString( '__Cypress__', $out );
		$this->assertStringContainsString( 'et-vb-app-frame', $out );
		$this->assertStringContainsString( 'et-fb-page-preloading', $out );
		$this->assertStringContainsString( 'MutationObserver', $out );
	}

	/**
	 * The inner app-frame (Divi sets `app_window=1` on the URL when
	 * it spawns its inner iframe) must NOT carry the bridge — only
	 * the `__Cypress__` signal. The bridge runs in the outer frame;
	 * emitting it in the inner one would set up a MutationObserver
	 * watching its own self via `getElementById( 'et-vb-app-frame' )`,
	 * which doesn't exist in the inner doc and is wasted work.
	 */
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

	/**
	 * Regression: the app-frame branch must bail BEFORE setting
	 * `__Cypress__` when `window.parent === window.top`. That's
	 * the top-level VB flow (2-deep). If we taint window.top
	 * there, Divi's frame-helpers picks the wrong top_window and
	 * the inner builder iframe never finishes mounting — VB
	 * preloader hangs forever for users on top-level Divi with
	 * OpenStation enabled but the chromeless flag stripped.
	 *
	 * Pin the bail guard so the bug can't regress.
	 */
	public function test_inner_app_frame_bails_when_parent_equals_top() {
		$this->chromeless_user_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
		wp_set_current_user( $this->chromeless_user_id );
		update_user_meta( $this->chromeless_user_id, 'desktop_mode_mode', '1' );
		$this->activate_divi_theme();
		$_GET['app_window'] = '1';

		$out = $this->capture_vb_signal_output();

		// The guard must appear BEFORE the __Cypress__ assignment.
		$guardPos   = strpos( $out, 'window.parent === window.top' );
		$cypressPos = strpos( $out, '__Cypress__ = window.top.__Cypress__' );
		$this->assertNotFalse( $guardPos, 'parent-equals-top guard must be present in the app-frame branch.' );
		$this->assertNotFalse( $cypressPos );
		$this->assertLessThan( $cypressPos, $guardPos, 'Guard must precede the __Cypress__ assignment so 2-deep top-level VB bails first.' );
	}

	/**
	 * Helper: prime "Divi is active" by switching the stylesheet
	 * and template options to "Divi" and clearing the theme cache.
	 */
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

	/**
	 * Iframe-side hijack: emitted only inside chromeless requests
	 * for users on Divi. The script must install a capture-phase
	 * click listener that matches by VB button text and emit our
	 * `os-divi-vb-handoff` message.
	 */
	public function test_iframe_patch_emits_in_chromeless_for_divi() {
		$this->force_chromeless();
		$this->activate_divi_theme();

		$out = $this->capture_iframe_patch_output();

		$this->assertStringContainsString( 'os-compat-divi-vb-handoff', $out );
		$this->assertStringContainsString( 'os-divi-vb-handoff', $out );
		// Button-text matcher — the load-bearing detection.
		$this->assertStringContainsString( 'use divi builder', $out );
		$this->assertStringContainsString( 'edit with the divi builder', $out );
		// Capture-phase click listener that wraps the matcher.
		$this->assertStringContainsString( "addEventListener( 'click'", $out );
	}

	/**
	 * Outside chromeless requests there's nothing to intercept —
	 * the parent shell loads its own navigation, not a Divi iframe.
	 */
	public function test_iframe_patch_skips_when_not_chromeless() {
		wp_set_current_user( 0 );
		$this->activate_divi_theme();

		$out = $this->capture_iframe_patch_output();

		$this->assertSame( '', trim( $out ) );
	}

	/**
	 * On non-Divi sites the patcher would never match its URL
	 * pattern, so we save the script weight entirely.
	 */
	public function test_iframe_patch_skips_without_divi() {
		$this->force_chromeless();
		// No theme activation — default test theme is whatever
		// the harness ships (twentytwentyfive in this environment).

		$out = $this->capture_iframe_patch_output();

		$this->assertSame( '', trim( $out ) );
	}

	/**
	 * Parent-shell listener: emitted on the shell admin page when
	 * OpenStation is on, the request is not chromeless / classic,
	 * AND Divi is active. Listens for the message and navigates
	 * `window.top.location.href` to the URL.
	 */
	public function test_parent_listener_emits_on_shell_for_divi() {
		$this->chromeless_user_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
		wp_set_current_user( $this->chromeless_user_id );
		update_user_meta( $this->chromeless_user_id, 'desktop_mode_mode', '1' );
		$this->activate_divi_theme();

		$out = $this->capture_parent_listener_output();

		$this->assertStringContainsString( 'os-compat-divi-vb-handoff-parent', $out );
		$this->assertStringContainsString( 'os-divi-vb-handoff', $out );
		$this->assertStringContainsString( 'window.top.location.href', $out );
		// Origin guard prevents foreign frames from triggering nav.
		$this->assertStringContainsString( 'ev.origin !== window.location.origin', $out );
		// Confirm dialog is the load-bearing UX explicit step.
		$this->assertStringContainsString( 'wp.os.confirm', $out );
		$this->assertStringContainsString( 'Open Divi in this tab', $out );
		// No "stay" button — the dialog explains there is no other
		// path and offers only Open + an X to dismiss.
		$this->assertStringContainsString( 'hideCancel: true', $out );
		$this->assertStringContainsString( 'dismissable: true', $out );
		// URL transform: strip chromeless flag, add classic flag.
		// Without this, top-level navigation hits the iframe URL's
		// `openstation_chromeless=1` and renders headless again.
		$this->assertStringContainsString( "searchParams.delete( 'openstation_chromeless' )", $out );
		$this->assertStringContainsString( "searchParams.set( 'desktop_mode_classic', '1' )", $out );
	}

	/**
	 * In a chromeless request we must NOT emit the parent listener
	 * — there's no parent shell at that level.
	 */
	public function test_parent_listener_skips_in_chromeless_request() {
		$this->force_chromeless();
		$this->activate_divi_theme();

		$out = $this->capture_parent_listener_output();

		$this->assertSame( '', trim( $out ) );
	}

	/**
	 * Visitors without OpenStation enabled get nothing.
	 */
	public function test_parent_listener_skips_when_openstation_disabled() {
		wp_set_current_user( 0 );
		$this->activate_divi_theme();

		$out = $this->capture_parent_listener_output();

		$this->assertSame( '', trim( $out ) );
	}

	/**
	 * Non-Divi sites get nothing — the listener would never fire.
	 */
	public function test_parent_listener_skips_without_divi() {
		$this->chromeless_user_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
		wp_set_current_user( $this->chromeless_user_id );
		update_user_meta( $this->chromeless_user_id, 'desktop_mode_mode', '1' );

		$out = $this->capture_parent_listener_output();

		$this->assertSame( '', trim( $out ) );
	}

	/**
	 * Divi-active detector: Divi theme.
	 */
	public function test_is_active_true_for_divi_theme() {
		$this->activate_divi_theme();
		$this->assertTrue( openstation_compat_divi_is_active() );
	}

	/**
	 * Divi-active detector: arbitrary other theme.
	 */
	public function test_is_active_false_for_other_theme() {
		$this->assertFalse( openstation_compat_divi_is_active() );
	}
}
