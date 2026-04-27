<?php
/**
 * Tests for the PHP-registered built-in wallpaper presets and the
 * `desktop_mode_wallpapers` filter.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-wallpapers
 */
class Tests_DesktopMode_Wallpapers extends WP_UnitTestCase {

	public function tear_down() {
		remove_all_filters( 'desktop_mode_wallpapers' );
		parent::tear_down();
	}

	/**
	 * @covers ::desktop_mode_register_builtin_wallpapers
	 */
	public function test_builtins_are_registered_after_init() {
		// `init` has already fired by the time the first test runs,
		// so the registry should carry all five presets.
		$registry = desktop_mode_desktop_wallpaper_registry();

		$this->assertIsArray( $registry );
		$this->assertArrayHasKey( 'dark', $registry );
		$this->assertArrayHasKey( 'aurora', $registry );
		$this->assertArrayHasKey( 'sunset', $registry );
		$this->assertArrayHasKey( 'forest', $registry );
		$this->assertArrayHasKey( 'mono', $registry );
	}

	/**
	 * @covers ::desktop_mode_register_builtin_wallpapers
	 */
	public function test_builtins_are_css_type_with_value() {
		$dark = desktop_mode_desktop_wallpaper_registry( 'dark' );

		$this->assertIsArray( $dark );
		$this->assertSame( 'css', $dark['type'] );
		$this->assertStringContainsString( 'linear-gradient', $dark['value'] );
		$this->assertSame( $dark['value'], $dark['preview'] );
		$this->assertSame( '', $dark['script'] );
	}

	/**
	 * The shell payload builder is what the client actually sees. It
	 * applies the `desktop_mode_wallpapers` filter + shapes entries to
	 * match the TS `DesktopWallpaperServerEntry` contract.
	 *
	 * @covers ::desktop_mode_build_desktop_wallpapers_payload
	 */
	public function test_payload_carries_value_for_css_builtins() {
		$payload = desktop_mode_build_desktop_wallpapers_payload();

		$this->assertIsArray( $payload );
		$ids = wp_list_pluck( $payload, 'id' );
		$this->assertContains( 'dark', $ids );

		$dark = null;
		foreach ( $payload as $entry ) {
			if ( 'dark' === $entry['id'] ) {
				$dark = $entry;
				break;
			}
		}
		$this->assertNotNull( $dark );
		$this->assertSame( 'css', $dark['type'] );
		$this->assertNotEmpty( $dark['value'] );
		$this->assertSame( '', $dark['scriptHandle'] );
	}

	/**
	 * @covers ::desktop_mode_build_desktop_wallpapers_payload
	 */
	public function test_filter_can_add_entry_to_payload() {
		add_filter( 'desktop_mode_wallpapers', static function ( $registry ) {
			$registry['brand'] = array(
				'id'      => 'brand',
				'label'   => 'Brand',
				'preview' => '#ff00ff',
				'value'   => '#ff00ff',
				'type'    => 'css',
				'script'  => '',
			);
			return $registry;
		} );

		$payload = desktop_mode_build_desktop_wallpapers_payload();
		$ids     = wp_list_pluck( $payload, 'id' );

		$this->assertContains( 'brand', $ids );
	}

	/**
	 * @covers ::desktop_mode_build_desktop_wallpapers_payload
	 */
	public function test_filter_can_remove_entry_from_payload() {
		add_filter( 'desktop_mode_wallpapers', static function ( $registry ) {
			unset( $registry['sunset'] );
			return $registry;
		} );

		$payload = desktop_mode_build_desktop_wallpapers_payload();
		$ids     = wp_list_pluck( $payload, 'id' );

		$this->assertNotContains( 'sunset', $ids );
		$this->assertContains( 'dark', $ids );
	}

	/**
	 * @covers ::desktop_mode_build_desktop_wallpapers_payload
	 */
	public function test_filter_non_array_return_yields_empty_payload() {
		add_filter( 'desktop_mode_wallpapers', static function () {
			return 'broken';
		} );

		$this->assertSame( array(), desktop_mode_build_desktop_wallpapers_payload() );
	}

	/**
	 * `desktop_mode_register_wallpaper()` defaults `value` to `preview`
	 * when callers omit it — keeps the common "same string for swatch
	 * and surface" case a one-field call.
	 *
	 * @covers ::desktop_mode_register_wallpaper
	 */
	public function test_value_defaults_to_preview_when_omitted() {
		$result = desktop_mode_register_wallpaper( 'test-default', array(
			'label'   => 'Test',
			'preview' => '#abcdef',
			'type'    => 'css',
		) );

		$this->assertTrue( $result );

		$entry = desktop_mode_desktop_wallpaper_registry( 'test-default' );
		$this->assertSame( '#abcdef', $entry['value'] );
	}
}
