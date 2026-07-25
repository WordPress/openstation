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
 * @group desktop-mode
 * @group desktop-mode-themes
 */
class Tests_DesktopMode_DesktopThemesCompile extends WP_UnitTestCase {

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
	 * @covers ::desktop_mode_desktop_theme_compile_css
	 */
	public function test_empty_manifest_compiles_to_nothing() {
		$this->assertSame(
			'',
			desktop_mode_desktop_theme_compile_css( $this->manifest(), 'acme-neon', 'https://x.test/t' )
		);
	}

	/**
	 * Both selectors are required: the shell root covers the desktop
	 * and windows, the body class covers toasts / dialogs / tooltips /
	 * context menus, which mount outside `#desktop-mode-shell`.
	 *
	 * @covers ::desktop_mode_desktop_theme_compile_css
	 */
	public function test_output_is_double_scoped() {
		$css = desktop_mode_desktop_theme_compile_css(
			$this->manifest( array( 'tokens' => array( '--desktop-mode-window-radius' => '14px' ) ) ),
			'acme-neon',
			'https://x.test/t'
		);
		$this->assertStringContainsString(
			'.desktop-mode-shell[data-desktop-mode-desktop-theme="acme-neon"]',
			$css
		);
		$this->assertStringContainsString( 'body.desktop-mode-desktop-theme-acme-neon', $css );
	}

	/**
	 * @covers ::desktop_mode_desktop_theme_compile_css
	 */
	public function test_tokens_become_declarations() {
		$css = desktop_mode_desktop_theme_compile_css(
			$this->manifest( array(
				'tokens' => array(
					'--desktop-mode-window-radius' => '14px',
					'--wp-admin-theme-color'       => '#7c5cff',
				),
			) ),
			'acme-neon',
			'https://x.test/t'
		);
		$this->assertStringContainsString( '--desktop-mode-window-radius: 14px;', $css );
		$this->assertStringContainsString( '--wp-admin-theme-color: #7c5cff;', $css );
	}

	/**
	 * Same input must always produce byte-identical output — the
	 * compiled file is written on every install and an unstable
	 * ordering would churn it for no reason.
	 *
	 * @covers ::desktop_mode_desktop_theme_compile_css
	 */
	public function test_output_is_deterministic_regardless_of_authoring_order() {
		$a = desktop_mode_desktop_theme_compile_css(
			$this->manifest( array(
				'tokens' => array( '--desktop-mode-z' => '1px', '--desktop-mode-a' => '2px' ),
			) ),
			'acme-neon',
			'https://x.test/t'
		);
		$b = desktop_mode_desktop_theme_compile_css(
			$this->manifest( array(
				'tokens' => array( '--desktop-mode-a' => '2px', '--desktop-mode-z' => '1px' ),
			) ),
			'acme-neon',
			'https://x.test/t'
		);
		$this->assertSame( $a, $b );
	}

	/**
	 * @covers ::desktop_mode_desktop_theme_compile_css
	 */
	public function test_textures_become_url_declarations() {
		$css = desktop_mode_desktop_theme_compile_css(
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
			'--desktop-mode-titlebar-image: url("https://x.test/t/textures/t.png");',
			$css
		);
		$this->assertStringContainsString( '--desktop-mode-titlebar-image-repeat: repeat-x;', $css );
		$this->assertStringContainsString( '--desktop-mode-titlebar-image-size: auto 100%;', $css );
	}

	/**
	 * @covers ::desktop_mode_desktop_theme_compile_css
	 */
	public function test_border_image_textures() {
		$css = desktop_mode_desktop_theme_compile_css(
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
		$this->assertStringContainsString( '--desktop-mode-window-border-image-source: url(', $css );
		$this->assertStringContainsString( '--desktop-mode-window-border-image-slice: 24 fill;', $css );
		$this->assertStringContainsString( '--desktop-mode-window-border-image-width: 12px;', $css );
		$this->assertStringContainsString( '--desktop-mode-window-border-image-repeat: round;', $css );
	}

	/**
	 * The four corner slots share one size token; the first declared
	 * (in key-sorted order) wins.
	 *
	 * @covers ::desktop_mode_desktop_theme_compile_css
	 */
	public function test_corner_slots_share_one_size_token() {
		$css = desktop_mode_desktop_theme_compile_css(
			$this->manifest( array(
				'textures' => array(
					'WINDOW_CORNER_NE' => array( 'type' => 'image', 'path' => 'ne.png', 'size' => '20px' ),
					'WINDOW_CORNER_SW' => array( 'type' => 'image', 'path' => 'sw.png', 'size' => '40px' ),
				),
			) ),
			'acme-neon',
			'https://x.test/t'
		);
		$this->assertStringContainsString( '--desktop-mode-window-corner-ne-image: url(', $css );
		$this->assertStringContainsString( '--desktop-mode-window-corner-sw-image: url(', $css );
		$this->assertSame(
			1,
			substr_count( $css, '--desktop-mode-window-corner-size:' ),
			'Exactly one shared corner-size declaration.'
		);
	}

	/**
	 * Path segments are `rawurlencode`d, which is also what makes the
	 * `url("…")` wrapper unbreakable: no quote, paren, or whitespace
	 * can survive the encoding.
	 *
	 * @covers ::desktop_mode_desktop_theme_asset_url
	 */
	public function test_asset_paths_are_url_encoded() {
		$css = desktop_mode_desktop_theme_compile_css(
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
	 * @covers ::desktop_mode_desktop_theme_asset_url
	 */
	public function test_absolute_asset_urls_pass_through() {
		$this->assertSame(
			'https://cdn.test/x.png',
			desktop_mode_desktop_theme_asset_url( 'https://cdn.test/x.png', '' )
		);
	}

	/**
	 * Nothing an author wrote may become a selector, a property name,
	 * an at-rule, or an unescaped string. This is the "no author
	 * string escapes its declaration" regression test.
	 *
	 * @covers ::desktop_mode_desktop_theme_compile_css
	 */
	public function test_only_custom_property_declarations_are_emitted() {
		$css = desktop_mode_desktop_theme_compile_css(
			$this->manifest( array(
				'name'   => '</style><script>alert(1)</script>',
				'tokens' => array( '--desktop-mode-window-radius' => '14px' ),
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
			if ( false !== strpos( $line, '.desktop-mode-shell[' ) ) {
				continue;
			}
			if ( false !== strpos( $line, 'body.desktop-mode-desktop-theme-' ) ) {
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
	 * @covers ::desktop_mode_desktop_theme_compile_css
	 */
	public function test_empty_slug_compiles_to_nothing() {
		$this->assertSame(
			'',
			desktop_mode_desktop_theme_compile_css(
				$this->manifest( array( 'tokens' => array( '--desktop-mode-a' => '1px' ) ) ),
				'',
				'https://x.test/t'
			)
		);
	}
}
