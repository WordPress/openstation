<?php
/**
 * Tests for the desktop-theme CSS compiler.
 *
 * The compiler is the second half of the security boundary: whatever
 * the sanitizer let through lands in a stylesheet here. The load-
 * bearing assertions are that it emits ONLY custom-property
 * declarations, that it generates every `url()` itself, and that its
 * output is deterministic.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-themes
 */
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

	/**
	 * @covers ::open_station_desktop_theme_compile_css
	 */
	public function test_empty_manifest_compiles_to_nothing() {
		$this->assertSame(
			'',
			open_station_desktop_theme_compile_css( $this->manifest(), 'acme-neon', 'https://x.test/t' )
		);
	}

	/**
	 * Both selectors are required: the shell root covers the desktop
	 * and windows, the body class covers toasts / dialogs / tooltips /
	 * context menus, which mount outside `#os-shell`.
	 *
	 * @covers ::open_station_desktop_theme_compile_css
	 */
	public function test_output_is_double_scoped() {
		$css = open_station_desktop_theme_compile_css(
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

	/**
	 * @covers ::open_station_desktop_theme_compile_css
	 */
	public function test_tokens_become_declarations() {
		$css = open_station_desktop_theme_compile_css(
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

	/**
	 * Same input must always produce byte-identical output — the
	 * compiled file is written on every install and an unstable
	 * ordering would churn it for no reason.
	 *
	 * @covers ::open_station_desktop_theme_compile_css
	 */
	public function test_output_is_deterministic_regardless_of_authoring_order() {
		$a = open_station_desktop_theme_compile_css(
			$this->manifest( array(
				'tokens' => array( '--os-z' => '1px', '--os-a' => '2px' ),
			) ),
			'acme-neon',
			'https://x.test/t'
		);
		$b = open_station_desktop_theme_compile_css(
			$this->manifest( array(
				'tokens' => array( '--os-a' => '2px', '--os-z' => '1px' ),
			) ),
			'acme-neon',
			'https://x.test/t'
		);
		$this->assertSame( $a, $b );
	}

	/**
	 * @covers ::open_station_desktop_theme_compile_css
	 */
	public function test_textures_become_url_declarations() {
		$css = open_station_desktop_theme_compile_css(
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

	/**
	 * @covers ::open_station_desktop_theme_compile_css
	 */
	public function test_border_image_textures() {
		$css = open_station_desktop_theme_compile_css(
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

	/**
	 * The four corner slots share one size token; the first declared
	 * (in key-sorted order) wins.
	 *
	 * @covers ::open_station_desktop_theme_compile_css
	 */
	public function test_corner_slots_share_one_size_token() {
		$css = open_station_desktop_theme_compile_css(
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

	/**
	 * Path segments are `rawurlencode`d, which is also what makes the
	 * `url("…")` wrapper unbreakable: no quote, paren, or whitespace
	 * can survive the encoding.
	 *
	 * @covers ::open_station_desktop_theme_asset_url
	 */
	public function test_asset_paths_are_url_encoded() {
		$css = open_station_desktop_theme_compile_css(
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

	/**
	 * Code-registered themes carry absolute URLs already; the compiler
	 * must pass those through instead of joining them to a base.
	 *
	 * @covers ::open_station_desktop_theme_asset_url
	 */
	public function test_absolute_asset_urls_pass_through() {
		$this->assertSame(
			'https://cdn.test/x.png',
			open_station_desktop_theme_asset_url( 'https://cdn.test/x.png', '' )
		);
	}

	/**
	 * Nothing an author wrote may become a selector, a property name,
	 * an at-rule, or an unescaped string. This is the "no author
	 * string escapes its declaration" regression test.
	 *
	 * @covers ::open_station_desktop_theme_compile_css
	 */
	public function test_only_custom_property_declarations_are_emitted() {
		$css = open_station_desktop_theme_compile_css(
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

		// Every line inside the block is `\t--prop: value;`.
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

	/**
	 * Every slot the registry declares must land on the property the
	 * registry names. This is the parity test for the table-driven
	 * compiler: add a slot, and it either works end to end or fails
	 * here.
	 *
	 * @covers ::open_station_desktop_theme_compile_css
	 */
	public function test_every_registered_slot_emits_its_property() {
		$slots = open_station_desktop_theme_texture_slots();

		foreach ( $slots as $slot => $definition ) {
			$type     = isset( $definition['type'] ) ? $definition['type'] : 'image';
			$prop     = $definition['prop'];
			$texture  = array( 'type' => $type, 'path' => 'x.png' );
			$expected = 'border-image' === $type ? $prop . '-source: url(' : $prop . ': url(';

			$css = open_station_desktop_theme_compile_css(
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

	/**
	 * The registry is the compiler's only input, so a plugin can
	 * texture a surface the framework has never heard of by adding one
	 * entry and shipping one CSS rule.
	 *
	 * @covers ::open_station_desktop_theme_compile_css
	 */
	public function test_a_filter_added_slot_compiles() {
		$add = static function ( $slots ) {
			$slots['ACME_SIDEBAR'] = array(
				'type' => 'image',
				'prop' => '--acme-sidebar-image',
			);
			return $slots;
		};
		add_filter( 'open_station_desktop_theme_texture_slots', $add );

		$manifest = open_station_sanitize_desktop_theme_manifest(
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
		$css = open_station_desktop_theme_compile_css( $manifest, 'acme-neon', 'https://x.test/t' );

		remove_filter( 'open_station_desktop_theme_texture_slots', $add );

		$this->assertStringContainsString( '--acme-sidebar-image: url(', $css );
		$this->assertStringContainsString( '--acme-sidebar-image-repeat: repeat-y;', $css );
	}

	/**
	 * A slot the allowlist accepts but gives no property to write is a
	 * bug in whoever added it — it must not emit a malformed
	 * declaration.
	 *
	 * @covers ::open_station_desktop_theme_compile_css
	 */
	public function test_slot_without_a_prop_emits_nothing() {
		$add = static function ( $slots ) {
			$slots['ACME_PROPLESS'] = array( 'type' => 'image' );
			return $slots;
		};
		add_filter( 'open_station_desktop_theme_texture_slots', $add );

		$css = open_station_desktop_theme_compile_css(
			$this->manifest( array(
				'textures' => array(
					'ACME_PROPLESS' => array( 'type' => 'image', 'path' => 'x.png' ),
				),
			) ),
			'acme-neon',
			'https://x.test/t'
		);

		remove_filter( 'open_station_desktop_theme_texture_slots', $add );

		$this->assertSame( '', $css );
	}

	/**
	 * TITLEBAR_FOCUSED is a variant slot: it contributes an image and
	 * inherits the base slot's repeat + size, so it must not emit
	 * companions of its own.
	 *
	 * @covers ::open_station_desktop_theme_compile_css
	 */
	public function test_variant_slot_emits_no_companions() {
		$css = open_station_desktop_theme_compile_css(
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

	/**
	 * @covers ::open_station_desktop_theme_compile_css
	 */
	public function test_empty_slug_compiles_to_nothing() {
		$this->assertSame(
			'',
			open_station_desktop_theme_compile_css(
				$this->manifest( array( 'tokens' => array( '--os-a' => '1px' ) ) ),
				'',
				'https://x.test/t'
			)
		);
	}
}
