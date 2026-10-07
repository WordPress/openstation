<?php

class Tests_OpenStation_DesktopThemesCompile extends WP_UnitTestCase {

	private function manifest( $overrides = array() ) {
		return array_merge(
			array(
				'manifestVersion' => 1,
				'id'              => 'acme/neon',
				'slug'            => 'acme-neon',
				'name'            => 'Neon',
				'tokens'          => array(),
				'icons'           => array(),
				'textures'        => array(),
			),
			$overrides
		);
	}

	public function test_empty_manifest_compiles_to_nothing() {
		$this->assertSame(
			'',
			openstation_desktop_theme_compile_css( $this->manifest(), 'acme-neon', 'https://x.test/t' )
		);
	}

	public function test_output_is_double_scoped() {
		$css = openstation_desktop_theme_compile_css(
			$this->manifest( array( 'tokens' => array( '--os-window-radius' => '14px' ) ) ),
			'acme-neon',
			'https://x.test/t'
		);
		$this->assertStringContainsString(
			'.os-shell[data-os-desktop-theme="acme-neon"]',
			$css
		);
		$this->assertStringContainsString( 'body.os-desktop-theme-acme-neon', $css );
	}

	public function test_tokens_become_declarations() {
		$css = openstation_desktop_theme_compile_css(
			$this->manifest( array(
				'tokens' => array(
					'--os-window-radius' => '14px',
					'--wp-admin-theme-color'       => '#7c5cff',
				),
			) ),
			'acme-neon',
			'https://x.test/t'
		);
		$this->assertStringContainsString( '--os-window-radius: 14px;', $css );
		$this->assertStringContainsString( '--wp-admin-theme-color: #7c5cff;', $css );
	}

	public function test_output_is_deterministic_regardless_of_authoring_order() {
		$a = openstation_desktop_theme_compile_css(
			$this->manifest( array(
				'tokens' => array( '--os-z' => '1px', '--os-a' => '2px' ),
			) ),
			'acme-neon',
			'https://x.test/t'
		);
		$b = openstation_desktop_theme_compile_css(
			$this->manifest( array(
				'tokens' => array( '--os-a' => '2px', '--os-z' => '1px' ),
			) ),
			'acme-neon',
			'https://x.test/t'
		);
		$this->assertSame( $a, $b );
	}

	public function test_textures_become_url_declarations() {
		$css = openstation_desktop_theme_compile_css(
			$this->manifest( array(
				'textures' => array(
					'TITLEBAR' => array(
						'type'   => 'image',
						'path'   => 'textures/t.png',
						'repeat' => 'repeat-x',
						'size'   => 'auto 100%',
					),
				),
			) ),
			'acme-neon',
			'https://x.test/t'
		);
		$this->assertStringContainsString(
			'--os-titlebar-image: url("https://x.test/t/textures/t.png");',
			$css
		);
		$this->assertStringContainsString( '--os-titlebar-image-repeat: repeat-x;', $css );
		$this->assertStringContainsString( '--os-titlebar-image-size: auto 100%;', $css );
	}

	public function test_border_image_textures() {
		$css = openstation_desktop_theme_compile_css(
			$this->manifest( array(
				'textures' => array(
					'WINDOW_FRAME' => array(
						'type'   => 'border-image',
						'path'   => 'f.png',
						'slice'  => '24 fill',
						'width'  => '12px',
						'repeat' => 'round',
					),
				),
			) ),
			'acme-neon',
			'https://x.test/t'
		);
		$this->assertStringContainsString( '--os-window-border-image-source: url(', $css );
		$this->assertStringContainsString( '--os-window-border-image-slice: 24 fill;', $css );
		$this->assertStringContainsString( '--os-window-border-image-width: 12px;', $css );
		$this->assertStringContainsString( '--os-window-border-image-repeat: round;', $css );
	}

	public function test_corner_slots_share_one_size_token() {
		$css = openstation_desktop_theme_compile_css(
			$this->manifest( array(
				'textures' => array(
					'WINDOW_CORNER_NE' => array( 'type' => 'image', 'path' => 'ne.png', 'size' => '20px' ),
					'WINDOW_CORNER_SW' => array( 'type' => 'image', 'path' => 'sw.png', 'size' => '40px' ),
				),
			) ),
			'acme-neon',
			'https://x.test/t'
		);
		$this->assertStringContainsString( '--os-window-corner-ne-image: url(', $css );
		$this->assertStringContainsString( '--os-window-corner-sw-image: url(', $css );
		$this->assertSame(
			1,
			substr_count( $css, '--os-window-corner-size:' ),
			'Exactly one shared corner-size declaration.'
		);
	}

	public function test_asset_paths_are_url_encoded() {
		$css = openstation_desktop_theme_compile_css(
			$this->manifest( array(
				'textures' => array(
					'DOCK' => array( 'type' => 'image', 'path' => 'my textures/a"b).png' ),
				),
			) ),
			'acme-neon',
			'https://x.test/t'
		);
		$this->assertStringNotContainsString( 'a"b)', $css );
		$this->assertStringContainsString( 'my%20textures', $css );
		$this->assertStringContainsString( '%22', $css );
	}

	public function test_absolute_asset_urls_pass_through() {
		$this->assertSame(
			'https://cdn.test/x.png',
			openstation_desktop_theme_asset_url( 'https://cdn.test/x.png', '' )
		);
	}

	public function test_only_custom_property_declarations_are_emitted() {
		$css = openstation_desktop_theme_compile_css(
			$this->manifest( array(
				'name'   => '</style><script>alert(1)</script>',
				'tokens' => array( '--os-window-radius' => '14px' ),
			) ),
			'acme-neon',
			'https://x.test/t'
		);

		$this->assertStringNotContainsString( '<script', $css );
		$this->assertStringNotContainsString( '</style', $css );
		$this->assertStringNotContainsString( '@', $css );

		$lines = explode( "\n", $css );
		foreach ( $lines as $line ) {
			if ( '' === trim( $line ) || 0 === strpos( $line, '/*' ) ) {
				continue;
			}
			if ( false !== strpos( $line, '.os-shell[' ) ) {
				continue;
			}
			if ( false !== strpos( $line, 'body.os-desktop-theme-' ) ) {
				continue;
			}
			if ( '}' === trim( $line ) ) {
				continue;
			}
			$this->assertMatchesRegularExpression(
				'/^\t--[a-z0-9-]+: .+;$/',
				$line,
				"Unexpected line in compiled CSS: {$line}"
			);
		}
	}

	public function test_every_registered_slot_emits_its_property() {
		$slots = openstation_desktop_theme_texture_slots();

		foreach ( $slots as $slot => $definition ) {
			$type     = isset( $definition['type'] ) ? $definition['type'] : 'image';
			$prop     = $definition['prop'];
			$texture  = array( 'type' => $type, 'path' => 'x.png' );
			$expected = 'border-image' === $type ? $prop . '-source: url(' : $prop . ': url(';

			$css = openstation_desktop_theme_compile_css(
				$this->manifest( array( 'textures' => array( $slot => $texture ) ) ),
				'acme-neon',
				'https://x.test/t'
			);

			$this->assertStringContainsString(
				$expected,
				$css,
				"Slot {$slot} did not emit {$prop}."
			);
		}
	}

	public function test_a_filter_added_slot_compiles() {
		$add = static function ( $slots ) {
			$slots['ACME_SIDEBAR'] = array(
				'type' => 'image',
				'prop' => '--acme-sidebar-image',
			);
			return $slots;
		};
		add_filter( 'openstation_desktop_theme_texture_slots', $add );

		$manifest = openstation_sanitize_desktop_theme_manifest(
			array(
				'manifestVersion' => 1,
				'id'              => 'acme/neon',
				'name'            => 'Neon',
				'textures'        => array(
					'ACME_SIDEBAR' => array(
						'type'   => 'image',
						'path'   => 'side.png',
						'repeat' => 'repeat-y',
					),
				),
			),
			static function ( $path ) {
				return (string) $path;
			}
		);
		$css = openstation_desktop_theme_compile_css( $manifest, 'acme-neon', 'https://x.test/t' );

		remove_filter( 'openstation_desktop_theme_texture_slots', $add );

		$this->assertStringContainsString( '--acme-sidebar-image: url(', $css );
		$this->assertStringContainsString( '--acme-sidebar-image-repeat: repeat-y;', $css );
	}

	public function test_slot_without_a_prop_emits_nothing() {
		$add = static function ( $slots ) {
			$slots['ACME_PROPLESS'] = array( 'type' => 'image' );
			return $slots;
		};
		add_filter( 'openstation_desktop_theme_texture_slots', $add );

		$css = openstation_desktop_theme_compile_css(
			$this->manifest( array(
				'textures' => array(
					'ACME_PROPLESS' => array( 'type' => 'image', 'path' => 'x.png' ),
				),
			) ),
			'acme-neon',
			'https://x.test/t'
		);

		remove_filter( 'openstation_desktop_theme_texture_slots', $add );

		$this->assertSame( '', $css );
	}

	public function test_variant_slot_emits_no_companions() {
		$css = openstation_desktop_theme_compile_css(
			$this->manifest( array(
				'textures' => array(
					'TITLEBAR_FOCUSED' => array(
						'type'   => 'image',
						'path'   => 'tf.png',
						'repeat' => 'repeat-x',
						'size'   => 'cover',
					),
				),
			) ),
			'acme-neon',
			'https://x.test/t'
		);

		$this->assertStringContainsString( '--os-titlebar-image-focused: url(', $css );
		$this->assertStringNotContainsString( '-focused-repeat:', $css );
		$this->assertStringNotContainsString( '-focused-size:', $css );
	}

	public function test_empty_slug_compiles_to_nothing() {
		$this->assertSame(
			'',
			openstation_desktop_theme_compile_css(
				$this->manifest( array( 'tokens' => array( '--os-a' => '1px' ) ) ),
				'',
				'https://x.test/t'
			)
		);
	}
}
