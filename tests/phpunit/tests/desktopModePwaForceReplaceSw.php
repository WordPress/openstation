<?php
/**
 * Tests for `desktop_mode_pwa_force_replace_sw()` — the resolver behind
 * the `desktop_mode_pwa_force_replace_sw` filter that lets operators opt
 * desktop-mode in to replace a foreign root-scope SW.
 *
 * Fix for GH #239 — without the filter wired through, sites with another
 * PWA plugin's SW silently lose installability and the "Install <site>
 * as an app" tile falls back to a generic "not available" toast.
 *
 * @package WPDesktopMode
 *
 * @group desktop-mode
 */
class Tests_DesktopMode_PwaForceReplaceSw extends WP_UnitTestCase {

	public function tear_down() {
		remove_all_filters( 'desktop_mode_pwa_force_replace_sw' );
		parent::tear_down();
	}

	/**
	 * @covers ::desktop_mode_pwa_force_replace_sw
	 */
	public function test_defaults_to_false() {
		$this->assertFalse( desktop_mode_pwa_force_replace_sw() );
	}

	/**
	 * @covers ::desktop_mode_pwa_force_replace_sw
	 */
	public function test_filter_can_opt_in() {
		add_filter( 'desktop_mode_pwa_force_replace_sw', '__return_true' );
		$this->assertTrue( desktop_mode_pwa_force_replace_sw() );
	}

	/**
	 * Non-boolean filter return is coerced to a bool so the JS shell
	 * config carries a consistent type — without the cast a string like
	 * `'1'` would surface as `forceReplaceSw: '1'` rather than `true`.
	 *
	 * @covers ::desktop_mode_pwa_force_replace_sw
	 */
	public function test_non_boolean_return_is_coerced() {
		add_filter(
			'desktop_mode_pwa_force_replace_sw',
			static function () {
				return 1;
			}
		);
		$this->assertSame( true, desktop_mode_pwa_force_replace_sw() );

		remove_all_filters( 'desktop_mode_pwa_force_replace_sw' );

		add_filter(
			'desktop_mode_pwa_force_replace_sw',
			static function () {
				return '';
			}
		);
		$this->assertSame( false, desktop_mode_pwa_force_replace_sw() );
	}
}
