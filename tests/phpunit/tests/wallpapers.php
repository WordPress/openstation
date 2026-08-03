<?php
/**
 * Tests for the PHP-registered built-in wallpaper presets and the
 * `openstation_wallpapers` filter.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-wallpapers
 */
class Tests_OpenStation_Wallpapers extends WP_UnitTestCase {

	public function tear_down() {
		remove_all_filters( 'openstation_wallpapers' );
		parent::tear_down();
	}

	/**
	 * @covers ::openstation_register_builtin_wallpapers
	 */
	public function test_builtins_are_registered_after_init() {
		// `init` has already fired by the time the first test runs,
		// so the registry should carry all five presets.
		$registry = openstation_desktop_wallpaper_registry();

		$this->assertIsArray( $registry );
		$this->assertArrayHasKey( 'dark', $registry );
		$this->assertArrayHasKey( 'aurora', $registry );
		$this->assertArrayHasKey( 'sunset', $registry );
		$this->assertArrayHasKey( 'forest', $registry );
		$this->assertArrayHasKey( 'mono', $registry );
	}

	/**
	 * @covers ::openstation_register_builtin_wallpapers
	 */
	public function test_builtins_are_css_type_with_value() {
		$dark = openstation_desktop_wallpaper_registry( 'dark' );

		$this->assertIsArray( $dark );
		$this->assertSame( 'css', $dark['type'] );
		$this->assertStringContainsString( 'linear-gradient', $dark['value'] );
		$this->assertSame( $dark['value'], $dark['preview'] );
		$this->assertSame( '', $dark['script'] );
	}

	/**
	 * The shell payload builder is what the client actually sees. It
	 * applies the `openstation_wallpapers` filter + shapes entries to
	 * match the TS `DesktopWallpaperServerEntry` contract.
	 *
	 * @covers ::openstation_build_desktop_wallpapers_payload
	 */
	public function test_payload_carries_value_for_css_builtins() {
		$payload = openstation_build_desktop_wallpapers_payload();

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
	 * @covers ::openstation_build_desktop_wallpapers_payload
	 */
	public function test_filter_can_add_entry_to_payload() {
		add_filter( 'openstation_wallpapers', static function ( $registry ) {
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

		$payload = openstation_build_desktop_wallpapers_payload();
		$ids     = wp_list_pluck( $payload, 'id' );

		$this->assertContains( 'brand', $ids );
	}

	/**
	 * @covers ::openstation_build_desktop_wallpapers_payload
	 */
	public function test_filter_can_remove_entry_from_payload() {
		add_filter( 'openstation_wallpapers', static function ( $registry ) {
			unset( $registry['sunset'] );
			return $registry;
		} );

		$payload = openstation_build_desktop_wallpapers_payload();
		$ids     = wp_list_pluck( $payload, 'id' );

		$this->assertNotContains( 'sunset', $ids );
		$this->assertContains( 'dark', $ids );
	}

	/**
	 * @covers ::openstation_build_desktop_wallpapers_payload
	 */
	public function test_filter_non_array_return_yields_empty_payload() {
		add_filter( 'openstation_wallpapers', static function () {
			return 'broken';
		} );

		$this->assertSame( array(), openstation_build_desktop_wallpapers_payload() );
	}

	/**
	 * `openstation_register_wallpaper()` defaults `value` to `preview`
	 * when callers omit it — keeps the common "same string for swatch
	 * and surface" case a one-field call.
	 *
	 * @covers ::openstation_register_wallpaper
	 */
	public function test_value_defaults_to_preview_when_omitted() {
		$result = openstation_register_wallpaper( 'test-default', array(
			'label'   => 'Test',
			'preview' => '#abcdef',
			'type'    => 'css',
		) );

		$this->assertTrue( $result );

		$entry = openstation_desktop_wallpaper_registry( 'test-default' );
		$this->assertSame( '#abcdef', $entry['value'] );
	}

	/**
	 * @covers ::openstation_register_wallpaper
	 */
	public function test_description_is_stored_sanitized_and_defaults_empty() {
		openstation_register_wallpaper( 'test-described', array(
			'label'       => 'Described',
			'preview'     => '#123456',
			'type'        => 'css',
			'description' => "A calm <script>alert(1)</script>backdrop\nfor focused work.",
		) );
		$entry = openstation_desktop_wallpaper_registry( 'test-described' );
		// Plain text by contract: tags stripped, no scripts survive.
		$this->assertStringNotContainsString( '<script>', $entry['description'] );
		$this->assertStringContainsString( 'A calm', $entry['description'] );
		$this->assertStringContainsString( 'backdrop', $entry['description'] );

		openstation_register_wallpaper( 'test-undescribed', array(
			'label'   => 'Silent',
			'preview' => '#654321',
			'type'    => 'css',
		) );
		$silent = openstation_desktop_wallpaper_registry( 'test-undescribed' );
		$this->assertSame( '', $silent['description'] );
	}

	/**
	 * @covers ::openstation_build_desktop_wallpapers_payload
	 */
	public function test_payload_carries_descriptions_for_builtins() {
		$payload = openstation_build_desktop_wallpapers_payload();
		$by_id   = array();
		foreach ( $payload as $entry ) {
			$by_id[ $entry['id'] ] = $entry;
		}

		// Every built-in ships a non-empty description…
		foreach ( array( 'dark', 'aurora', 'sunset', 'forest', 'mono', 'wp-animated-logo', 'wp-living-tree', 'wp-snow' ) as $id ) {
			$this->assertArrayHasKey( $id, $by_id );
			$this->assertNotSame( '', $by_id[ $id ]['description'], "{$id} should carry a description" );
		}
		// …and the Living Tree's is the open-source tribute.
		$this->assertStringContainsString( 'Matt Mullenweg', $by_id['wp-living-tree']['description'] );
		$this->assertStringContainsString( 'open source', $by_id['wp-living-tree']['description'] );
	}

	/**
	 * The Snow wallpaper is a canvas built-in: it must declare its
	 * script handle (the def with `mount` / `renderConfig` is published
	 * on the JS global by that script), and its picker swatch must
	 * match the default backdrop the JS side paints — the swatch
	 * renders before the wallpaper script has ever loaded, so a
	 * mismatch would show one sky in the picker and a different one
	 * once selected.
	 *
	 * @covers ::openstation_register_builtin_wallpapers
	 */
	public function test_snow_builtin_is_canvas_with_script_and_backdrop_preview() {
		$snow = openstation_desktop_wallpaper_registry( 'wp-snow' );

		$this->assertIsArray( $snow );
		$this->assertSame( 'canvas', $snow['type'] );
		$this->assertSame( 'os-snow-wallpaper', $snow['script'] );
		$this->assertTrue( wp_script_is( 'os-snow-wallpaper', 'registered' ) );
		$this->assertSame(
			'linear-gradient(180deg, #0c1a36 0%, #1d355e 55%, #425d8a 100%)',
			$snow['preview']
		);
	}
}
