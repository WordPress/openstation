<?php
/**
 * Tests for desktop-theme fonts.
 *
 * `@font-face` is the ONLY at-rule this feature generates, which
 * makes it the one place where the "a theme is data, never code"
 * rule has to be defended by construction rather than by the value
 * grammar. Two author-supplied substrings reach the stylesheet — the
 * family name and the file path — so these tests concentrate on
 * proving that neither can escape:
 *
 *   - the family name is quoted, and nothing that could close the
 *     quote survives sanitization;
 *   - the path went through the FONT extension allowlist, which is
 *     disjoint from the image one;
 *   - every other descriptor is a closed enum or a numeric pattern.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-themes
 */
class Tests_DesktopMode_DesktopThemesFonts extends WP_UnitTestCase {

	/** Recursive delete for fixtures outside the themes base dir. */
	private function rrmdir( $dir ) {
		foreach ( (array) glob( $dir . '/*' ) as $entry ) {
			is_dir( $entry ) ? $this->rrmdir( $entry ) : unlink( $entry );
		}
		rmdir( $dir );
	}

	/** Resolver that accepts anything with a plausible extension. */
	private function permissive_resolver() {
		return static function ( $path ) {
			return (string) $path;
		};
	}

	private function sanitize_fonts( $raw, $resolver = null ) {
		return desktop_mode_sanitize_desktop_theme_fonts(
			$raw,
			$resolver ? $resolver : $this->permissive_resolver()
		);
	}

	private function compile( $fonts, $base = 'https://x.test/t', $version = '' ) {
		return desktop_mode_desktop_theme_compile_css(
			array(
				'manifestVersion' => 1,
				'id'              => 'acme/neon',
				'slug'            => 'acme-neon',
				'name'            => 'Neon',
				'tokens'          => array(),
				'icons'           => array(),
				'textures'        => array(),
				'fonts'           => $fonts,
			),
			'acme-neon',
			$base,
			$version
		);
	}

	// ------------------------------------------------------------------
	// Sanitizer.
	// ------------------------------------------------------------------

	/**
	 * @covers ::desktop_mode_sanitize_desktop_theme_fonts
	 */
	public function test_minimal_face_survives() {
		$fonts = $this->sanitize_fonts( array(
			array(
				'family' => 'Neon Grotesk',
				'src'    => 'fonts/neon.woff2',
			),
		) );

		$this->assertCount( 1, $fonts );
		$this->assertSame( 'Neon Grotesk', $fonts[0]['family'] );
		$this->assertSame(
			array( array( 'path' => 'fonts/neon.woff2', 'format' => 'woff2' ) ),
			$fonts[0]['src']
		);
	}

	/**
	 * The `format()` hint is DERIVED from the extension, never read
	 * from the author — one less free string in the output.
	 *
	 * @covers ::desktop_mode_desktop_theme_font_format
	 */
	public function test_format_is_derived_from_the_extension() {
		$this->assertSame( 'woff2', desktop_mode_desktop_theme_font_format( 'a/b.woff2' ) );
		$this->assertSame( 'woff', desktop_mode_desktop_theme_font_format( 'a/b.WOFF' ) );
		$this->assertSame( 'truetype', desktop_mode_desktop_theme_font_format( 'a/b.ttf' ) );
		$this->assertSame( 'opentype', desktop_mode_desktop_theme_font_format( 'a/b.otf' ) );
		$this->assertSame( '', desktop_mode_desktop_theme_font_format( 'a/b.png' ) );
		// URL form, query string discarded before the extension read.
		$this->assertSame(
			'woff2',
			desktop_mode_desktop_theme_font_format( 'https://x.test/f/n.woff2?ver=7' )
		);
	}

	/**
	 * An author-supplied `format` is ignored rather than trusted — the
	 * hint always comes from the extension.
	 *
	 * @covers ::desktop_mode_sanitize_desktop_theme_fonts
	 */
	public function test_author_supplied_format_is_ignored() {
		$fonts = $this->sanitize_fonts( array(
			array(
				'family' => 'Neon',
				'src'    => array(
					array( 'path' => 'fonts/neon.woff2', 'format' => 'woff2"); } body { display: none' ),
				),
			),
		) );

		$this->assertSame( 'woff2', $fonts[0]['src'][0]['format'] );
	}

	/**
	 * @covers ::desktop_mode_sanitize_desktop_theme_fonts
	 */
	public function test_src_accepts_a_list_in_preference_order() {
		$fonts = $this->sanitize_fonts( array(
			array(
				'family' => 'Neon',
				'src'    => array( 'fonts/neon.woff2', 'fonts/neon.woff' ),
			),
		) );

		$this->assertSame( 'fonts/neon.woff2', $fonts[0]['src'][0]['path'] );
		$this->assertSame( 'fonts/neon.woff', $fonts[0]['src'][1]['path'] );
	}

	/**
	 * The family name is quoted verbatim by the compiler, so anything
	 * that could close the quote has to die here.
	 *
	 * @dataProvider data_bad_family_names
	 * @covers ::desktop_mode_sanitize_desktop_theme_fonts
	 */
	public function test_bad_family_names_drop_the_face( $family ) {
		$this->assertSame(
			array(),
			$this->sanitize_fonts( array(
				array( 'family' => $family, 'src' => 'fonts/n.woff2' ),
			) ),
			'Family name should have dropped the whole face: ' . $family
		);
	}

	public function data_bad_family_names() {
		return array(
			'quote breakout'  => array( 'Neon"; } body { display:none } @font-face { font-family: "x' ),
			'single quote'    => array( "Neon' " ),
			'semicolon'       => array( 'Neon; color: red' ),
			'brace'           => array( 'Neon}' ),
			'at rule'         => array( '@import url(x)' ),
			'backslash'       => array( 'Neon\\22 ' ),
			'comment'         => array( 'Neon/*x*/' ),
			'leading symbol'  => array( '-Neon' ),
			'empty'           => array( '' ),
			'too long'        => array( str_repeat( 'a', 65 ) ),
			'markup'          => array( '<script>' ),
		);
	}

	/**
	 * @covers ::desktop_mode_sanitize_desktop_theme_fonts
	 */
	public function test_face_with_no_usable_source_is_dropped() {
		$reject = static function () {
			return false;
		};

		$this->assertSame(
			array(),
			$this->sanitize_fonts( array( array( 'family' => 'Neon', 'src' => 'fonts/n.woff2' ) ), $reject )
		);
		$this->assertSame(
			array(),
			$this->sanitize_fonts( array( array( 'family' => 'Neon' ) ) ),
			'A face with no src at all is no face.'
		);
	}

	/**
	 * @covers ::desktop_mode_sanitize_desktop_theme_fonts
	 */
	public function test_descriptor_grammar() {
		$fonts = $this->sanitize_fonts( array(
			array(
				'family'       => 'Neon',
				'src'          => 'fonts/n.woff2',
				'weight'       => '100 900',
				'style'        => 'ITALIC',
				'display'      => 'swap',
				'stretch'      => 'semi-condensed',
				'unicodeRange' => 'u+0000-00ff, u+2000-206f',
			),
		) );

		$this->assertSame( '100 900', $fonts[0]['weight'] );
		$this->assertSame( 'italic', $fonts[0]['style'] );
		$this->assertSame( 'swap', $fonts[0]['display'] );
		$this->assertSame( 'semi-condensed', $fonts[0]['stretch'] );
		$this->assertSame( 'U+0000-00FF, U+2000-206F', $fonts[0]['unicodeRange'] );
	}

	/**
	 * A bad descriptor drops itself, not the face — same
	 * drops-and-continues contract as tokens and textures.
	 *
	 * @covers ::desktop_mode_sanitize_desktop_theme_fonts
	 */
	public function test_bad_descriptors_drop_without_dropping_the_face() {
		$fonts = $this->sanitize_fonts( array(
			array(
				'family'       => 'Neon',
				'src'          => 'fonts/n.woff2',
				'weight'       => '400; color: red',
				'style'        => 'sideways',
				'display'      => 'immediately',
				'stretch'      => 'very wide indeed',
				'unicodeRange' => 'U+GGGG',
			),
		) );

		$this->assertCount( 1, $fonts );
		$this->assertSame( 'Neon', $fonts[0]['family'] );
		foreach ( array( 'weight', 'style', 'display', 'stretch', 'unicodeRange' ) as $key ) {
			$this->assertArrayNotHasKey( $key, $fonts[0], $key . ' should have dropped.' );
		}
	}

	/**
	 * @covers ::desktop_mode_sanitize_desktop_theme_fonts
	 */
	public function test_face_and_source_caps_are_enforced() {
		$caps = desktop_mode_desktop_theme_font_caps();

		$faces = array();
		for ( $i = 0; $i < $caps['max_faces'] + 5; $i++ ) {
			$faces[] = array( 'family' => 'Neon ' . $i, 'src' => 'fonts/n.woff2' );
		}
		$this->assertCount( $caps['max_faces'], $this->sanitize_fonts( $faces ) );

		$sources = array_fill( 0, $caps['max_sources'] + 3, 'fonts/n.woff2' );
		$fonts   = $this->sanitize_fonts( array(
			array( 'family' => 'Neon', 'src' => $sources ),
		) );
		$this->assertCount( $caps['max_sources'], $fonts[0]['src'] );
	}

	/**
	 * @covers ::desktop_mode_sanitize_desktop_theme_manifest
	 */
	public function test_fonts_block_is_wired_into_the_manifest() {
		$manifest = desktop_mode_sanitize_desktop_theme_manifest(
			array(
				'manifestVersion' => 1,
				'id'              => 'acme/neon',
				'name'            => 'Neon',
				'fonts'           => array(
					array( 'family' => 'Neon', 'src' => 'fonts/n.woff2' ),
				),
			),
			$this->permissive_resolver()
		);

		$this->assertNotWPError( $manifest );
		$this->assertSame( 'Neon', $manifest['fonts'][0]['family'] );
	}

	/**
	 * A manifest that declares no fonts still gets the key, so every
	 * downstream consumer can iterate it unconditionally.
	 *
	 * @covers ::desktop_mode_sanitize_desktop_theme_manifest
	 */
	public function test_fonts_key_always_exists() {
		$manifest = desktop_mode_sanitize_desktop_theme_manifest(
			array( 'manifestVersion' => 1, 'id' => 'acme/neon', 'name' => 'Neon' ),
			$this->permissive_resolver()
		);

		$this->assertSame( array(), $manifest['fonts'] );
	}

	// ------------------------------------------------------------------
	// Extension allowlists.
	// ------------------------------------------------------------------

	/**
	 * @covers ::desktop_mode_desktop_theme_asset_extensions
	 */
	public function test_image_and_font_extension_lists_are_disjoint() {
		$images = desktop_mode_desktop_theme_asset_extensions( 'image' );
		$fonts  = desktop_mode_desktop_theme_asset_extensions( 'font' );

		$this->assertContains( 'svg', $images );
		$this->assertContains( 'woff2', $fonts );
		$this->assertSame( array(), array_intersect( $images, $fonts ) );
		$this->assertSame(
			array(),
			desktop_mode_desktop_theme_asset_extensions( 'nonsense' ),
			'An unknown kind fails closed.'
		);
	}

	/**
	 * A font path must not resolve through the image gate, and an
	 * image path must not resolve through the font gate.
	 *
	 * @covers ::desktop_mode_desktop_theme_staging_asset_resolver
	 */
	public function test_staging_resolver_separates_kinds() {
		$base = get_temp_dir() . 'dm-theme-fonts-' . wp_generate_uuid4();
		wp_mkdir_p( $base . '/fonts' );
		wp_mkdir_p( $base . '/icons' );
		file_put_contents( $base . '/fonts/n.woff2', 'wOF2' );
		file_put_contents( $base . '/icons/x.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>' );

		$resolve = desktop_mode_desktop_theme_staging_asset_resolver( $base );

		$this->assertSame( 'fonts/n.woff2', $resolve( 'fonts/n.woff2', 'font' ) );
		$this->assertFalse( $resolve( 'fonts/n.woff2', 'image' ), 'Font refused as an image.' );
		$this->assertSame( 'icons/x.svg', $resolve( 'icons/x.svg', 'image' ) );
		$this->assertFalse( $resolve( 'icons/x.svg', 'font' ), 'SVG refused as a font.' );
		// Containment still applies to fonts.
		$this->assertFalse( $resolve( '../n.woff2', 'font' ) );

		$this->rrmdir( $base );
	}

	/**
	 * @covers ::desktop_mode_desktop_theme_url_asset_resolver
	 */
	public function test_url_resolver_separates_kinds() {
		$resolve = desktop_mode_desktop_theme_url_asset_resolver();

		$this->assertSame(
			'https://example.com/n.woff2',
			$resolve( 'https://example.com/n.woff2', 'font' )
		);
		$this->assertFalse( $resolve( 'https://example.com/n.woff2', 'image' ) );
		$this->assertFalse( $resolve( 'https://example.com/n.css', 'font' ) );
		$this->assertFalse( $resolve( 'fonts/n.woff2', 'font' ), 'Relative URL refused.' );
	}

	/**
	 * The ZIP allowlist has to admit fonts (and the licence file a
	 * bundled font obliges an author to ship) or the upload path is
	 * closed to them before the sanitizer ever runs.
	 *
	 * @covers ::desktop_mode_desktop_theme_zip_caps
	 */
	public function test_zip_caps_admit_fonts_and_licence_files() {
		$caps = desktop_mode_desktop_theme_zip_caps();

		foreach ( array( 'woff2', 'woff', 'ttf', 'otf' ) as $ext ) {
			$this->assertContains( $ext, $caps['extensions'] );
		}
		$this->assertContains( 'txt', $caps['extensions'], 'Licence notices ride along.' );
		foreach ( array( 'css', 'js', 'html', 'php' ) as $ext ) {
			$this->assertNotContains( $ext, $caps['extensions'] );
		}
	}

	// ------------------------------------------------------------------
	// Compiler.
	// ------------------------------------------------------------------

	/**
	 * @covers ::desktop_mode_desktop_theme_compile_css
	 */
	public function test_font_face_is_emitted() {
		$css = $this->compile( $this->sanitize_fonts( array(
			array(
				'family'  => 'Neon Grotesk',
				'src'     => array( 'fonts/neon.woff2', 'fonts/neon.woff' ),
				'weight'  => '400',
				'style'   => 'normal',
				'display' => 'swap',
			),
		) ) );

		$this->assertStringContainsString( '@font-face {', $css );
		$this->assertStringContainsString( 'font-family: "Neon Grotesk";', $css );
		$this->assertStringContainsString( 'font-weight: 400;', $css );
		$this->assertStringContainsString( 'font-display: swap;', $css );
		$this->assertStringContainsString(
			'url("https://x.test/t/fonts/neon.woff2") format("woff2")',
			$css
		);
		$this->assertStringContainsString(
			'url("https://x.test/t/fonts/neon.woff") format("woff")',
			$css
		);
	}

	/**
	 * A theme that ships fonts but sets no token still compiles — the
	 * faces are the whole payload.
	 *
	 * @covers ::desktop_mode_desktop_theme_compile_css
	 */
	public function test_fonts_alone_still_compile() {
		$css = $this->compile( $this->sanitize_fonts( array(
			array( 'family' => 'Neon', 'src' => 'fonts/n.woff2' ),
		) ) );

		$this->assertStringContainsString( '@font-face', $css );
		$this->assertStringNotContainsString( '.desktop-mode-shell[', $css );
	}

	/**
	 * Faces print BEFORE the token rule, so reading the sheet top to
	 * bottom shows a family defined before it is named.
	 *
	 * @covers ::desktop_mode_desktop_theme_compile_css
	 */
	public function test_font_faces_precede_the_token_rule() {
		$css = desktop_mode_desktop_theme_compile_css(
			array(
				'manifestVersion' => 1,
				'id'              => 'acme/neon',
				'slug'            => 'acme-neon',
				'name'            => 'Neon',
				'tokens'          => array( '--desktop-mode-font' => '"Neon", sans-serif' ),
				'icons'           => array(),
				'textures'        => array(),
				'fonts'           => $this->sanitize_fonts( array(
					array( 'family' => 'Neon', 'src' => 'fonts/n.woff2' ),
				) ),
			),
			'acme-neon',
			'https://x.test/t'
		);

		$this->assertLessThan(
			strpos( $css, '.desktop-mode-shell[' ),
			strpos( $css, '@font-face' )
		);
	}

	/**
	 * Re-uploading a theme reuses the same paths by design, so font
	 * URLs need the same install-timestamp cache-buster the textures
	 * get — otherwise a re-upload swaps the CSS and keeps the old
	 * typeface.
	 *
	 * @covers ::desktop_mode_desktop_theme_compile_css
	 */
	public function test_font_urls_carry_the_cache_buster() {
		$css = $this->compile(
			$this->sanitize_fonts( array(
				array( 'family' => 'Neon', 'src' => 'fonts/n.woff2' ),
			) ),
			'https://x.test/t',
			'1700000000'
		);

		$this->assertStringContainsString(
			'url("https://x.test/t/fonts/n.woff2?ver=1700000000")',
			$css
		);
	}

	/**
	 * Absolute URLs (code-registered themes) pass through untouched —
	 * that plugin owns its own cache-busting.
	 *
	 * @covers ::desktop_mode_desktop_theme_compile_css
	 */
	public function test_code_theme_font_urls_pass_through() {
		$css = $this->compile(
			$this->sanitize_fonts(
				array( array( 'family' => 'Neon', 'src' => 'https://cdn.test/n.woff2' ) ),
				desktop_mode_desktop_theme_url_asset_resolver()
			),
			''
		);

		$this->assertStringContainsString( 'url("https://cdn.test/n.woff2")', $css );
	}

	/**
	 * The compiled sheet must contain exactly one at-rule keyword, and
	 * it must be ours. This is the regression guard for the whole
	 * "data, never code" posture: if an author string ever managed to
	 * become an at-rule, it shows up here.
	 *
	 * @covers ::desktop_mode_desktop_theme_compile_css
	 */
	public function test_no_at_rules_other_than_font_face() {
		$css = $this->compile( $this->sanitize_fonts( array(
			array(
				'family'       => 'Neon',
				'src'          => 'fonts/n.woff2',
				'unicodeRange' => 'U+0000-00FF',
			),
		) ) );

		preg_match_all( '/@[a-zA-Z-]+/', $css, $matches );
		$this->assertSame( array( '@font-face' ), array_unique( $matches[0] ) );
	}

	// ------------------------------------------------------------------
	// Registration + payload.
	// ------------------------------------------------------------------

	/**
	 * @covers ::desktop_mode_register_desktop_theme
	 */
	public function test_code_registration_accepts_fonts() {
		desktop_mode_register_desktop_theme( 'acme/fonted', array(
			'name'  => 'Fonted',
			'fonts' => array(
				array(
					'family' => 'Neon Grotesk',
					'src'    => array( 'https://cdn.test/neon.woff2' ),
				),
				// Same family at a second weight — one family, two faces.
				array(
					'family' => 'Neon Grotesk',
					'weight' => '700',
					'src'    => array( 'https://cdn.test/neon-bold.woff2' ),
				),
			),
		) );

		$entry = desktop_mode_desktop_theme_registry( 'acme-fonted' );
		$this->assertNotNull( $entry );
		$this->assertStringContainsString( 'font-family: "Neon Grotesk";', $entry['cssText'] );
		$this->assertStringContainsString( 'font-weight: 700;', $entry['cssText'] );

		$shaped = desktop_mode_shape_desktop_theme_payload_entry( $entry, 'code' );
		$this->assertSame(
			array( 'Neon Grotesk' ),
			$shaped['fonts'],
			'The payload lists distinct families, not faces.'
		);

		desktop_mode_unregister_desktop_theme( 'acme/fonted' );
	}
}
