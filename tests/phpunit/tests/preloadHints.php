<?php
/**
 * Tests for the critical-path resource preload/prefetch hints.
 *
 * @group desktop-mode
 * @group desktop-mode-preload
 */
class Tests_DesktopMode_PreloadHints extends WP_UnitTestCase {

	protected static $user_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$user_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$user_id );
		// `desktop_mode_print_preload_hints()` gates on `is_admin()`.
		set_current_screen( 'dashboard' );
		// Re-establish the enabled baseline every test. The disabled-state
		// test below flips the meta to '' for its assertion; setting it here
		// (rather than once in wpSetUpBeforeClass) means it doesn't have to
		// restore the value afterwards — so a failed assertion can't leave
		// later tests stuck in a disabled-DM state.
		update_user_meta( self::$user_id, 'desktop_mode_mode', '1' );
		// Ensure the style handles are registered so the version-match
		// assertion can read the registered stylesheet version.
		desktop_mode_register_assets();
	}

	public function tear_down() {
		set_current_screen( 'front' );
		wp_set_current_user( 0 );
		parent::tear_down();
	}

	protected function capture_hints() {
		ob_start();
		desktop_mode_print_preload_hints();
		return (string) ob_get_clean();
	}

	/**
	 * Critical assets (shell bundle + base CSS) are `preload`; the lazy
	 * bundles injected later are `prefetch` — otherwise Chrome warns the
	 * preloads went unused within a few seconds of load.
	 *
	 * @covers ::desktop_mode_print_preload_hints
	 */
	public function test_lazy_bundles_use_prefetch_and_critical_use_preload() {
		$html = $this->capture_hints();
		$this->assertNotEmpty( $html );

		$lines = array_filter( array_map( 'trim', explode( "\n", $html ) ) );
		$line_for = function ( $needle ) use ( $lines ) {
			foreach ( $lines as $line ) {
				if ( false !== strpos( $line, $needle ) ) {
					return $line;
				}
			}
			return '';
		};

		$this->assertStringContainsString( 'rel="preload"', $line_for( 'assets/js/desktop' ) );
		$this->assertStringContainsString( 'rel="preload"', $line_for( 'assets/css/desktop.css' ) );
		$this->assertStringContainsString( 'rel="prefetch"', $line_for( 'assets/js/window-system' ) );
		$this->assertStringContainsString( 'rel="prefetch"', $line_for( 'assets/js/shell-overlays' ) );
	}

	/**
	 * The regression: the `desktop.css` preload hint must carry the same
	 * `?ver=` as the registered stylesheet, or the browser never matches
	 * them and reports the preload as unused.
	 *
	 * @covers ::desktop_mode_print_preload_hints
	 */
	public function test_desktop_css_preload_version_matches_registered_stylesheet() {
		$css_path     = DESKTOP_MODE_DIR . 'assets/css/desktop.css';
		$expected_ver = file_exists( $css_path )
			? (string) filemtime( $css_path )
			: DESKTOP_MODE_VERSION;

		$styles = wp_styles();
		$this->assertArrayHasKey( 'desktop-mode', $styles->registered );
		$this->assertSame(
			$expected_ver,
			(string) $styles->registered['desktop-mode']->ver,
			'The desktop.css stylesheet must be filemtime-stamped to match its preload hint.'
		);

		$html = $this->capture_hints();
		$this->assertStringContainsString(
			'assets/css/desktop.css?ver=' . $expected_ver,
			$html,
			'The preload hint must point at the same versioned URL as the stylesheet.'
		);
	}

	/**
	 * @covers ::desktop_mode_print_preload_hints
	 */
	public function test_no_hints_when_desktop_mode_disabled() {
		// set_up() re-enables Desktop Mode before the next test, so there's
		// no need to restore the meta here — and no risk of leaking the
		// disabled state if this assertion fails.
		update_user_meta( self::$user_id, 'desktop_mode_mode', '' );

		$this->assertSame( '', $this->capture_hints() );
	}
}
