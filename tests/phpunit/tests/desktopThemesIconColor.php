<?php
/**
 * Tests for desktop-theme icon tinting.
 *
 * A tint does more than recolour: it switches an image icon from
 * `<img>` rendering to a mask filled with the colour, so only the
 * artwork's alpha survives. That is what makes a black-stroked
 * silhouette set legible on a dark dock instead of invisible.
 *
 * The value reaches an inline `style` on the JS side, so the grammar
 * here is the security boundary — same posture as the token grammar,
 * narrowed to things that are actually colours.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-themes
 */
class Tests_OpenStation_DesktopThemesIconColor extends WP_UnitTestCase {

	private function permissive_resolver() {
		return static function ( $path ) {
			return (string) $path;
		};
	}

	private function sanitize( $raw ) {
		return open_station_sanitize_desktop_theme_manifest(
			array_merge(
				array(
					'manifestVersion' => 1,
					'id'              => 'acme/neon',
					'name'            => 'Neon',
				),
				$raw
			),
			$this->permissive_resolver()
		);
	}

	// ------------------------------------------------------------------
	// Colour grammar.
	// ------------------------------------------------------------------

	/**
	 * @dataProvider data_valid_colors
	 * @covers ::open_station_desktop_theme_is_color_value
	 */
	public function test_valid_colors_are_accepted( $value ) {
		$this->assertTrue(
			open_station_desktop_theme_is_color_value( $value ),
			'Should have been accepted: ' . $value
		);
	}

	public function data_valid_colors() {
		return array(
			array( '#fff' ),
			array( '#e9e7ff' ),
			array( '#e9e7ffcc' ),
			array( 'rgb(124, 92, 255)' ),
			array( 'rgba( 124, 92, 255, 0.8 )' ),
			array( 'hsl( 250, 100%, 68% )' ),
			array( 'oklch( 0.7 0.2 280 )' ),
			array( 'currentColor' ),
			array( 'currentcolor' ),
			array( 'transparent' ),
			array( 'rebeccapurple' ),
		);
	}

	/**
	 * @dataProvider data_invalid_colors
	 * @covers ::open_station_desktop_theme_is_color_value
	 */
	public function test_invalid_colors_are_rejected( $value ) {
		$this->assertFalse(
			open_station_desktop_theme_is_color_value( $value ),
			'Should have been rejected: ' . var_export( $value, true )
		);
	}

	public function data_invalid_colors() {
		return array(
			'declaration escape' => array( '#fff; background: url(x)' ),
			'brace'              => array( '#fff }' ),
			'at rule'            => array( '@import url(evil)' ),
			'var indirection'    => array( 'var( --secret )' ),
			'url'                => array( 'url(evil.png)' ),
			'javascript'         => array( 'javascript:alert(1)' ),
			'comment'            => array( '#fff/*x*/' ),
			'markup'             => array( '</style>' ),
			'a length'           => array( '14px' ),
			'too long'           => array( str_repeat( 'a', 65 ) ),
			'empty'              => array( '' ),
			'not a string'       => array( 42 ),
			'bad hex length'     => array( '#ff' ),
			'unbalanced paren'   => array( 'rgb( 1, 2, 3' ),
		);
	}

	/**
	 * `currentColor` is echoed back to authors through the payload and
	 * the JS API, so it comes out spelled the way CSS spells it.
	 *
	 * @covers ::open_station_desktop_theme_normalize_color
	 */
	public function test_current_color_is_normalized() {
		$this->assertSame(
			'currentColor',
			open_station_desktop_theme_normalize_color( 'CURRENTCOLOR' )
		);
		$this->assertSame(
			'#fff',
			open_station_desktop_theme_normalize_color( '#fff' )
		);
	}

	// ------------------------------------------------------------------
	// Manifest wiring.
	// ------------------------------------------------------------------

	/**
	 * @covers ::open_station_sanitize_desktop_theme_icons
	 */
	public function test_per_icon_color_survives() {
		$manifest = $this->sanitize( array(
			'icons' => array(
				'OS_SETTINGS' => array(
					'type'  => 'image',
					'path'  => 'icons/settings.svg',
					'color' => '#e9e7ff',
				),
				'RECYCLE_BIN' => array(
					'type'  => 'dashicon',
					'name'  => 'dashicons-trash',
					'color' => 'currentColor',
				),
			),
		) );

		$this->assertSame( '#e9e7ff', $manifest['icons']['OS_SETTINGS']['color'] );
		$this->assertSame( 'currentColor', $manifest['icons']['RECYCLE_BIN']['color'] );
	}

	/**
	 * The manifest-wide default is what makes a monochrome iconset one
	 * line instead of twenty-odd repetitions.
	 *
	 * @covers ::open_station_sanitize_desktop_theme_manifest
	 */
	public function test_manifest_wide_icon_color_applies_to_every_icon() {
		$manifest = $this->sanitize( array(
			'iconColor' => 'currentColor',
			'icons'     => array(
				'OS_SETTINGS'  => array( 'type' => 'image', 'path' => 'a.svg' ),
				'RECYCLE_BIN'  => array( 'type' => 'image', 'path' => 'b.svg' ),
				'APP:edit-php' => array( 'type' => 'dashicon', 'name' => 'dashicons-edit' ),
			),
		) );

		$this->assertSame( 'currentColor', $manifest['iconColor'] );
		foreach ( array( 'OS_SETTINGS', 'RECYCLE_BIN', 'APP:edit-php' ) as $slot ) {
			$this->assertSame(
				'currentColor',
				$manifest['icons'][ $slot ]['color'],
				$slot . ' should have inherited the manifest default.'
			);
		}
	}

	/**
	 * @covers ::open_station_sanitize_desktop_theme_icons
	 */
	public function test_per_icon_color_overrides_the_default() {
		$manifest = $this->sanitize( array(
			'iconColor' => 'currentColor',
			'icons'     => array(
				'OS_SETTINGS'       => array( 'type' => 'image', 'path' => 'a.svg' ),
				'EXIT_OPEN_STATION' => array(
					'type'  => 'image',
					'path'  => 'b.svg',
					'color' => '#ff6b81',
				),
			),
		) );

		$this->assertSame( 'currentColor', $manifest['icons']['OS_SETTINGS']['color'] );
		$this->assertSame( '#ff6b81', $manifest['icons']['EXIT_OPEN_STATION']['color'] );
	}

	/**
	 * `"color": "none"` is the opt-OUT — it lets one multi-colour icon
	 * keep its own artwork inside an otherwise-tinted set, without the
	 * author having to abandon the manifest-wide default.
	 *
	 * @covers ::open_station_sanitize_desktop_theme_icons
	 */
	public function test_color_none_opts_a_single_icon_out() {
		$manifest = $this->sanitize( array(
			'iconColor' => 'currentColor',
			'icons'     => array(
				'OS_SETTINGS' => array( 'type' => 'image', 'path' => 'a.svg' ),
				'RECYCLE_BIN' => array(
					'type'  => 'image',
					'path'  => 'b.svg',
					'color' => 'none',
				),
			),
		) );

		$this->assertSame( 'currentColor', $manifest['icons']['OS_SETTINGS']['color'] );
		$this->assertArrayNotHasKey(
			'color',
			$manifest['icons']['RECYCLE_BIN'],
			'"none" must leave the icon untinted.'
		);
	}

	/**
	 * A bad colour drops the colour, never the icon.
	 *
	 * @covers ::open_station_sanitize_desktop_theme_icons
	 */
	public function test_bad_color_drops_without_dropping_the_icon() {
		$manifest = $this->sanitize( array(
			'icons' => array(
				'OS_SETTINGS' => array(
					'type'  => 'image',
					'path'  => 'icons/settings.svg',
					'color' => '#fff; background: url( evil.png )',
				),
			),
		) );

		$this->assertSame( 'icons/settings.svg', $manifest['icons']['OS_SETTINGS']['path'] );
		$this->assertArrayNotHasKey( 'color', $manifest['icons']['OS_SETTINGS'] );
	}

	/**
	 * @covers ::open_station_sanitize_desktop_theme_manifest
	 */
	public function test_bad_manifest_icon_color_is_dropped() {
		$manifest = $this->sanitize( array( 'iconColor' => 'url( evil.png )' ) );
		$this->assertSame( '', $manifest['iconColor'] );
	}

	// ------------------------------------------------------------------
	// Payload.
	// ------------------------------------------------------------------

	/**
	 * Tints ride in a PARALLEL map so `icons` stays slot => paintable
	 * string — the shape `resolveIcon()` and the JS icon filter are
	 * typed against.
	 *
	 * @covers ::open_station_shape_desktop_theme_payload_entry
	 */
	public function test_payload_carries_tints_in_a_parallel_map() {
		open_station_register_desktop_theme( 'acme/tinted', array(
			'name'      => 'Tinted',
			'iconColor' => 'currentColor',
			'icons'     => array(
				'OS_SETTINGS' => array(
					'type' => 'image',
					'path' => 'https://cdn.test/settings.svg',
				),
				'RECYCLE_BIN' => array(
					'type'  => 'image',
					'path'  => 'https://cdn.test/trash.svg',
					'color' => 'none',
				),
			),
		) );

		$entry  = open_station_desktop_theme_registry( 'acme-tinted' );
		$shaped = open_station_shape_desktop_theme_payload_entry( $entry, 'code' );

		$this->assertSame(
			'https://cdn.test/settings.svg',
			$shaped['icons']['OS_SETTINGS'],
			'icons stays a map of paintable strings.'
		);
		$this->assertSame( 'currentColor', $shaped['iconColors']['OS_SETTINGS'] );
		$this->assertArrayHasKey(
			'RECYCLE_BIN',
			$shaped['icons'],
			'An opted-out icon is still painted, just untinted.'
		);
		$this->assertArrayNotHasKey( 'RECYCLE_BIN', $shaped['iconColors'] );

		open_station_unregister_desktop_theme( 'acme/tinted' );
	}

	/**
	 * A theme with no tints ships an empty map, not a missing key —
	 * the shell iterates it unconditionally.
	 *
	 * @covers ::open_station_shape_desktop_theme_payload_entry
	 */
	public function test_untinted_theme_ships_an_empty_map() {
		open_station_register_desktop_theme( 'acme/plain', array(
			'name'  => 'Plain',
			'icons' => array(
				'OS_SETTINGS' => array(
					'type' => 'image',
					'path' => 'https://cdn.test/settings.svg',
				),
			),
		) );

		$shaped = open_station_shape_desktop_theme_payload_entry(
			open_station_desktop_theme_registry( 'acme-plain' ),
			'code'
		);
		$this->assertSame( array(), $shaped['iconColors'] );

		open_station_unregister_desktop_theme( 'acme/plain' );
	}

	// ------------------------------------------------------------------
	// Texture `position`.
	// ------------------------------------------------------------------

	/**
	 * @dataProvider data_valid_positions
	 * @covers ::open_station_desktop_theme_is_position_value
	 */
	public function test_valid_positions_are_accepted( $value ) {
		$this->assertTrue(
			open_station_desktop_theme_is_position_value( $value ),
			'Should have been accepted: ' . $value
		);
	}

	public function data_valid_positions() {
		return array(
			array( 'center' ),
			array( 'top left' ),
			array( 'bottom right' ),
			array( '50% 0' ),
			array( '0 0' ),
			array( '12px center' ),
			array( '-4px -4px' ),
			array( '1.5rem 2em' ),
		);
	}

	/**
	 * @dataProvider data_invalid_positions
	 * @covers ::open_station_desktop_theme_is_position_value
	 */
	public function test_invalid_positions_are_rejected( $value ) {
		$this->assertFalse(
			open_station_desktop_theme_is_position_value( $value ),
			'Should have been rejected: ' . $value
		);
	}

	public function data_invalid_positions() {
		return array(
			array( 'center; background: red' ),
			array( 'url( x.png )' ),
			array( 'top left bottom' ),
			array( 'middle' ),
			array( 'calc( 100% - 4px )' ),
			array( '' ),
		);
	}

	/**
	 * A grid texture has to be anchored, not centred — `position` is
	 * what stops the lattice sliding every time a window resizes.
	 *
	 * @covers ::open_station_desktop_theme_compile_css
	 */
	public function test_position_compiles_to_a_background_position() {
		$manifest = $this->sanitize( array(
			'textures' => array(
				'WINDOW_BODY' => array(
					'type'     => 'image',
					'path'     => 'grid.png',
					'repeat'   => 'repeat',
					'position' => 'TOP LEFT',
				),
			),
		) );
		$css = open_station_desktop_theme_compile_css( $manifest, 'acme-neon', 'https://x.test/t' );

		$this->assertStringContainsString(
			'--os-window-body-image-position: top left;',
			$css
		);
	}

	/**
	 * @covers ::open_station_sanitize_desktop_theme_textures
	 */
	public function test_bad_position_drops_without_dropping_the_texture() {
		$manifest = $this->sanitize( array(
			'textures' => array(
				'DESKTOP' => array(
					'type'     => 'image',
					'path'     => 'bg.png',
					'position' => 'center; background: url( evil.png )',
				),
			),
		) );

		$this->assertSame( 'bg.png', $manifest['textures']['DESKTOP']['path'] );
		$this->assertArrayNotHasKey( 'position', $manifest['textures']['DESKTOP'] );
	}

	/**
	 * `border-image` slots have no position — the descriptor grammar
	 * for them is slice / width / repeat, and a stray `position` must
	 * not leak into the output.
	 *
	 * @covers ::open_station_sanitize_desktop_theme_textures
	 */
	public function test_border_image_slots_take_no_position() {
		$manifest = $this->sanitize( array(
			'textures' => array(
				'WINDOW_FRAME' => array(
					'type'     => 'border-image',
					'path'     => 'frame.png',
					'position' => 'top left',
				),
			),
		) );

		$this->assertArrayNotHasKey( 'position', $manifest['textures']['WINDOW_FRAME'] );
	}
}
