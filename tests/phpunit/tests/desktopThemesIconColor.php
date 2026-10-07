<?php

class Tests_OpenStation_DesktopThemesIconColor extends WP_UnitTestCase {

	private function permissive_resolver() {
		return static function ( $path ) {
			return (string) $path;
		};
	}

	private function sanitize( $raw ) {
		return openstation_sanitize_desktop_theme_manifest(
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

	public function test_valid_colors_are_accepted( $value ) {
		$this->assertTrue(
			openstation_desktop_theme_is_color_value( $value ),
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

	public function test_invalid_colors_are_rejected( $value ) {
		$this->assertFalse(
			openstation_desktop_theme_is_color_value( $value ),
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

	public function test_current_color_is_normalized() {
		$this->assertSame(
			'currentColor',
			openstation_desktop_theme_normalize_color( 'CURRENTCOLOR' )
		);
		$this->assertSame(
			'#fff',
			openstation_desktop_theme_normalize_color( '#fff' )
		);
	}

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

	public function test_per_icon_color_overrides_the_default() {
		$manifest = $this->sanitize( array(
			'iconColor' => 'currentColor',
			'icons'     => array(
				'OS_SETTINGS'       => array( 'type' => 'image', 'path' => 'a.svg' ),
				'EXIT_OPENSTATION' => array(
					'type'  => 'image',
					'path'  => 'b.svg',
					'color' => '#ff6b81',
				),
			),
		) );

		$this->assertSame( 'currentColor', $manifest['icons']['OS_SETTINGS']['color'] );
		$this->assertSame( '#ff6b81', $manifest['icons']['EXIT_OPENSTATION']['color'] );
	}

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

	public function test_bad_manifest_icon_color_is_dropped() {
		$manifest = $this->sanitize( array( 'iconColor' => 'url( evil.png )' ) );
		$this->assertSame( '', $manifest['iconColor'] );
	}

	public function test_payload_carries_tints_in_a_parallel_map() {
		openstation_register_desktop_theme( 'acme/tinted', array(
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

		$entry  = openstation_desktop_theme_registry( 'acme-tinted' );
		$shaped = openstation_shape_desktop_theme_payload_entry( $entry, 'code' );

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

		openstation_unregister_desktop_theme( 'acme/tinted' );
	}

	public function test_untinted_theme_ships_an_empty_map() {
		openstation_register_desktop_theme( 'acme/plain', array(
			'name'  => 'Plain',
			'icons' => array(
				'OS_SETTINGS' => array(
					'type' => 'image',
					'path' => 'https://cdn.test/settings.svg',
				),
			),
		) );

		$shaped = openstation_shape_desktop_theme_payload_entry(
			openstation_desktop_theme_registry( 'acme-plain' ),
			'code'
		);
		$this->assertSame( array(), $shaped['iconColors'] );

		openstation_unregister_desktop_theme( 'acme/plain' );
	}

	public function test_valid_positions_are_accepted( $value ) {
		$this->assertTrue(
			openstation_desktop_theme_is_position_value( $value ),
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

	public function test_invalid_positions_are_rejected( $value ) {
		$this->assertFalse(
			openstation_desktop_theme_is_position_value( $value ),
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
		$css = openstation_desktop_theme_compile_css( $manifest, 'acme-neon', 'https://x.test/t' );

		$this->assertStringContainsString(
			'--os-window-body-image-position: top left;',
			$css
		);
	}

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
