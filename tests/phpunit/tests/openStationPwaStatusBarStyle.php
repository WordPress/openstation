<?php
/**
 * Tests for the installed app's iOS status-bar style —
 * `openstation_pwa_status_bar_style()` and the head tags that carry
 * it and the theme colour.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-pwa
 */
class Tests_OpenStation_PwaStatusBarStyle extends WP_UnitTestCase {

	public function tear_down() {
		remove_all_filters( 'openstation_pwa_status_bar_style' );
		parent::tear_down();
	}

	/**
	 * @covers ::openstation_pwa_status_bar_style
	 */
	public function test_defaults_to_an_opaque_black_bar() {
		$this->assertSame( 'black', openstation_pwa_status_bar_style() );
	}

	/**
	 * @covers ::openstation_pwa_status_bar_style
	 */
	public function test_filter_can_pick_any_of_the_three() {
		foreach ( array( 'black-translucent', 'default', 'black' ) as $style ) {
			add_filter(
				'openstation_pwa_status_bar_style',
				static function () use ( $style ) {
					return $style;
				}
			);
			$this->assertSame( $style, openstation_pwa_status_bar_style() );
			remove_all_filters( 'openstation_pwa_status_bar_style' );
		}
	}

	/**
	 * @covers ::openstation_pwa_status_bar_style
	 */
	public function test_junk_from_the_filter_falls_back() {
		add_filter( 'openstation_pwa_status_bar_style', '__return_empty_string' );
		$this->assertSame( 'black', openstation_pwa_status_bar_style() );

		remove_all_filters( 'openstation_pwa_status_bar_style' );
		add_filter(
			'openstation_pwa_status_bar_style',
			static function () {
				return 'liquid-glass';
			}
		);
		$this->assertSame( 'black', openstation_pwa_status_bar_style() );
	}

	/**
	 * The manifest and the meta paint the same colour: the backstop.
	 *
	 * @covers ::openstation_pwa_build_manifest
	 */
	public function test_manifest_colours_are_the_backstop() {
		$manifest = openstation_pwa_build_manifest();
		$this->assertSame( OPENSTATION_PWA_THEME_COLOR, $manifest['theme_color'] );
		$this->assertSame( OPENSTATION_PWA_THEME_COLOR, $manifest['background_color'] );
		$this->assertSame( '#0c0b0f', OPENSTATION_PWA_THEME_COLOR );
	}
}
