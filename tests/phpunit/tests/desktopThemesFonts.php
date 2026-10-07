<?php

class Tests_OpenStation_DesktopThemesFonts extends WP_UnitTestCase {

	private function rrmdir( $dir ) {
		foreach ( (array) glob( $dir . '/*' ) as $entry ) {
			is_dir( $entry ) ? $this->rrmdir( $entry ) : unlink( $entry );
		}
		rmdir( $dir );
	}

	private function permissive_resolver() {
		return static function ( $path ) {
			return (string) $path;
		};
	}

	private function sanitize_fonts( $raw, $resolver = null ) {
		return openstation_sanitize_desktop_theme_fonts(
			$raw,
			$resolver ? $resolver : $this->permissive_resolver()
		);
	}

	private function compile( $fonts, $base = 'https://x.test/t', $version = '' ) {
		return openstation_desktop_theme_compile_css(
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

	public function test_format_is_derived_from_the_extension() {
		$this->assertSame( 'woff2', openstation_desktop_theme_font_format( 'a/b.woff2' ) );
		$this->assertSame( 'woff', openstation_desktop_theme_font_format( 'a/b.WOFF' ) );
		$this->assertSame( 'truetype', openstation_desktop_theme_font_format( 'a/b.ttf' ) );
		$this->assertSame( 'opentype', openstation_desktop_theme_font_format( 'a/b.otf' ) );
		$this->assertSame( '', openstation_desktop_theme_font_format( 'a/b.png' ) );

		$this->assertSame(
			'woff2',
			openstation_desktop_theme_font_format( 'https://x.test/f/n.woff2?ver=7' )
		);
	}

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

	public function test_face_and_source_caps_are_enforced() {
		$caps = openstation_desktop_theme_font_caps();

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

	public function test_fonts_block_is_wired_into_the_manifest() {
		$manifest = openstation_sanitize_desktop_theme_manifest(
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

	public function test_fonts_key_always_exists() {
		$manifest = openstation_sanitize_desktop_theme_manifest(
			array( 'manifestVersion' => 1, 'id' => 'acme/neon', 'name' => 'Neon' ),
			$this->permissive_resolver()
		);

		$this->assertSame( array(), $manifest['fonts'] );
	}

	public function test_image_and_font_extension_lists_are_disjoint() {
		$images = openstation_desktop_theme_asset_extensions( 'image' );
		$fonts  = openstation_desktop_theme_asset_extensions( 'font' );

		$this->assertContains( 'svg', $images );
		$this->assertContains( 'woff2', $fonts );
		$this->assertSame( array(), array_intersect( $images, $fonts ) );
		$this->assertSame(
			array(),
			openstation_desktop_theme_asset_extensions( 'nonsense' ),
			'An unknown kind fails closed.'
		);
	}

	public function test_staging_resolver_separates_kinds() {
		$base = get_temp_dir() . 'dm-theme-fonts-' . wp_generate_uuid4();
		wp_mkdir_p( $base . '/fonts' );
		wp_mkdir_p( $base . '/icons' );
		file_put_contents( $base . '/fonts/n.woff2', 'wOF2' );
		file_put_contents( $base . '/icons/x.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>' );

		$resolve = openstation_desktop_theme_staging_asset_resolver( $base );

		$this->assertSame( 'fonts/n.woff2', $resolve( 'fonts/n.woff2', 'font' ) );
		$this->assertFalse( $resolve( 'fonts/n.woff2', 'image' ), 'Font refused as an image.' );
		$this->assertSame( 'icons/x.svg', $resolve( 'icons/x.svg', 'image' ) );
		$this->assertFalse( $resolve( 'icons/x.svg', 'font' ), 'SVG refused as a font.' );

		$this->assertFalse( $resolve( '../n.woff2', 'font' ) );

		$this->rrmdir( $base );
	}

	public function test_url_resolver_separates_kinds() {
		$resolve = openstation_desktop_theme_url_asset_resolver();

		$this->assertSame(
			'https://example.com/n.woff2',
			$resolve( 'https://example.com/n.woff2', 'font' )
		);
		$this->assertFalse( $resolve( 'https://example.com/n.woff2', 'image' ) );
		$this->assertFalse( $resolve( 'https://example.com/n.css', 'font' ) );
		$this->assertFalse( $resolve( 'fonts/n.woff2', 'font' ), 'Relative URL refused.' );
	}

	public function test_zip_caps_admit_fonts_and_licence_files() {
		$caps = openstation_desktop_theme_zip_caps();

		foreach ( array( 'woff2', 'woff', 'ttf', 'otf' ) as $ext ) {
			$this->assertContains( $ext, $caps['extensions'] );
		}
		$this->assertContains( 'txt', $caps['extensions'], 'Licence notices ride along.' );
		foreach ( array( 'css', 'js', 'html', 'php' ) as $ext ) {
			$this->assertNotContains( $ext, $caps['extensions'] );
		}
	}

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

	public function test_fonts_alone_still_compile() {
		$css = $this->compile( $this->sanitize_fonts( array(
			array( 'family' => 'Neon', 'src' => 'fonts/n.woff2' ),
		) ) );

		$this->assertStringContainsString( '@font-face', $css );
		$this->assertStringNotContainsString( '.os-shell[', $css );
	}

	public function test_font_faces_precede_the_token_rule() {
		$css = openstation_desktop_theme_compile_css(
			array(
				'manifestVersion' => 1,
				'id'              => 'acme/neon',
				'slug'            => 'acme-neon',
				'name'            => 'Neon',
				'tokens'          => array( '--os-font' => '"Neon", sans-serif' ),
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
			strpos( $css, '.os-shell[' ),
			strpos( $css, '@font-face' )
		);
	}

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

	public function test_code_theme_font_urls_pass_through() {
		$css = $this->compile(
			$this->sanitize_fonts(
				array( array( 'family' => 'Neon', 'src' => 'https://cdn.test/n.woff2' ) ),
				openstation_desktop_theme_url_asset_resolver()
			),
			''
		);

		$this->assertStringContainsString( 'url("https://cdn.test/n.woff2")', $css );
	}

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

	public function test_code_registration_accepts_fonts() {
		openstation_register_desktop_theme( 'acme/fonted', array(
			'name'  => 'Fonted',
			'fonts' => array(
				array(
					'family' => 'Neon Grotesk',
					'src'    => array( 'https://cdn.test/neon.woff2' ),
				),

				array(
					'family' => 'Neon Grotesk',
					'weight' => '700',
					'src'    => array( 'https://cdn.test/neon-bold.woff2' ),
				),
			),
		) );

		$entry = openstation_desktop_theme_registry( 'acme-fonted' );
		$this->assertNotNull( $entry );
		$this->assertStringContainsString( 'font-family: "Neon Grotesk";', $entry['cssText'] );
		$this->assertStringContainsString( 'font-weight: 700;', $entry['cssText'] );

		$shaped = openstation_shape_desktop_theme_payload_entry( $entry, 'code' );
		$this->assertSame(
			array( 'Neon Grotesk' ),
			$shaped['fonts'],
			'The payload lists distinct families, not faces.'
		);

		openstation_unregister_desktop_theme( 'acme/fonted' );
	}

	private function sanitize_wallpapers( $raw, $resolver = null ) {
		return openstation_sanitize_desktop_theme_wallpapers(
			$raw,
			$resolver ? $resolver : $this->permissive_resolver()
		);
	}

	public function test_every_author_shape_normalizes_to_a_list() {
		$bare = $this->sanitize_wallpapers( 'textures/desk.png' );
		$this->assertCount( 1, $bare );
		$this->assertSame( 'textures/desk.png', $bare[0]['path'] );

		$one = $this->sanitize_wallpapers( array( 'path' => 'textures/desk.png' ) );
		$this->assertCount( 1, $one );

		$list = $this->sanitize_wallpapers( array(
			'a.png',
			array( 'path' => 'b.png', 'label' => 'Dusk' ),
		) );
		$this->assertCount( 2, $list );
		$this->assertSame( 'Dusk', $list[1]['label'] );

		$map = $this->sanitize_wallpapers( array(
			'dusk' => array( 'path' => 'b.png' ),
			'dawn' => array( 'path' => 'c.png' ),
		) );
		$this->assertCount( 2, $map );
		$this->assertSame( array( 'dusk', 'dawn' ), wp_list_pluck( $map, 'id' ) );
	}

	public function test_ids_are_stable_not_positional() {
		$before = $this->sanitize_wallpapers( array( 'aurora.png', 'dusk.png' ) );
		$after  = $this->sanitize_wallpapers( array( 'dusk.png', 'aurora.png' ) );

		$this->assertSame( array( 'aurora', 'dusk' ), wp_list_pluck( $before, 'id' ) );
		$this->assertSame(
			array( 'dusk', 'aurora' ),
			wp_list_pluck( $after, 'id' ),
			'Reordering must not renumber ids.'
		);

		$explicit = $this->sanitize_wallpapers( array(
			array( 'path' => 'aurora.png', 'id' => 'keep-me' ),
		) );
		$this->assertSame( 'keep-me', $explicit[0]['id'] );

		$labelled = $this->sanitize_wallpapers( array(
			array( 'path' => 'x.png', 'label' => 'Deep Field' ),
		) );
		$this->assertSame( 'deep-field', $labelled[0]['id'] );
	}

	public function test_duplicate_ids_and_unresolvable_assets_drop() {
		$dupes = $this->sanitize_wallpapers( array( 'a.png', 'a.png' ) );
		$this->assertCount( 1, $dupes, 'A duplicate id drops rather than shadowing.' );

		$reject = static function () {
			return false;
		};
		$this->assertSame( array(), $this->sanitize_wallpapers( 'nope.png', $reject ) );
		$this->assertSame( array(), $this->sanitize_wallpapers( null ) );
	}

	public function test_wallpaper_count_is_capped() {
		$many = array();
		for ( $i = 0; $i < 40; $i++ ) {
			$many[] = "w{$i}.png";
		}
		$this->assertCount( 12, $this->sanitize_wallpapers( $many ) );

		$cap = static function () {
			return 3;
		};
		add_filter( 'openstation_desktop_theme_max_wallpapers', $cap );
		$this->assertCount( 3, $this->sanitize_wallpapers( $many ) );
		remove_filter( 'openstation_desktop_theme_max_wallpapers', $cap );
	}

	public function test_wallpapers_use_the_image_extension_gate() {
		$seen = array();
		$spy  = static function ( $path, $kind = 'image' ) use ( &$seen ) {
			$seen[] = $kind;
			return (string) $path;
		};
		$this->sanitize_wallpapers( 'a.png', $spy );
		$this->assertSame( array( 'image' ), $seen );
	}

	public function test_singular_and_plural_manifest_keys_both_work() {
		foreach ( array( 'wallpaper', 'wallpapers' ) as $key ) {
			$manifest = openstation_sanitize_desktop_theme_manifest(
				array(
					'manifestVersion' => 1,
					'id'              => 'acme/neon',
					'name'            => 'Neon',
					$key              => 'desk.png',
				),
				$this->permissive_resolver()
			);
			$this->assertCount( 1, $manifest['wallpapers'], $key . ' should have been read.' );
		}
	}

	public function test_wallpaper_css_is_a_background_shorthand() {
		$css = openstation_desktop_theme_wallpaper_css(
			array( 'path' => 'textures/desk.png' ),
			'https://x.test/t',
			'1700000000'
		);
		$this->assertSame(
			'url("https://x.test/t/textures/desk.png?ver=1700000000") center center / cover no-repeat',
			$css
		);

		$tiled = openstation_desktop_theme_wallpaper_css(
			array(
				'path'     => 'p.png',
				'size'     => '64px 64px',
				'repeat'   => 'repeat',
				'position' => 'top left',
			),
			'https://x.test/t'
		);
		$this->assertStringContainsString( 'top left / 64px 64px repeat', $tiled );

		$this->assertSame( '', openstation_desktop_theme_wallpaper_css( array(), '' ) );
	}

	public function test_wallpaper_label_marks_its_origin() {
		$this->assertSame(
			'Neon Glass - (theme)',
			openstation_desktop_theme_wallpaper_label( 'Neon Glass', 'neon-glass' )
		);
		$this->assertSame(
			'Neon Glass: Deep Field - (theme)',
			openstation_desktop_theme_wallpaper_label( 'Neon Glass', 'neon-glass', 'Deep Field' )
		);

		$filter = static function () {
			return 'custom';
		};
		add_filter( 'openstation_desktop_theme_wallpaper_label', $filter );
		$this->assertSame(
			'custom',
			openstation_desktop_theme_wallpaper_label( 'Neon Glass', 'neon-glass' )
		);
		remove_filter( 'openstation_desktop_theme_wallpaper_label', $filter );
	}

	public function test_theme_wallpapers_reach_the_picker() {
		openstation_register_desktop_theme( 'acme/papered', array(
			'name'       => 'Papered',
			'wallpapers' => array(
				'dusk' => array( 'path' => 'https://cdn.test/dusk.jpg', 'label' => 'Dusk' ),
				'dawn' => array( 'path' => 'https://cdn.test/dawn.jpg', 'label' => 'Dawn' ),
			),
		) );

		openstation_register_desktop_theme_wallpapers();

		$found = array();
		foreach ( openstation_build_desktop_wallpapers_payload() as $entry ) {
			if ( 0 === strpos( $entry['id'], 'desktop-theme/acme-papered/' ) ) {
				$found[ $entry['id'] ] = $entry;
			}
		}

		$this->assertCount( 2, $found, 'Both wallpapers should be pickable.' );
		$this->assertSame(
			'Papered: Dusk - (theme)',
			$found['desktop-theme/acme-papered/dusk']['label']
		);
		$this->assertSame( 'css', $found['desktop-theme/acme-papered/dawn']['type'] );
		$this->assertStringContainsString(
			'https://cdn.test/dawn.jpg',
			$found['desktop-theme/acme-papered/dawn']['value']
		);

		openstation_unregister_desktop_theme( 'acme/papered' );
	}

	public function test_install_response_carries_the_rebuilt_wallpaper_list() {
		$zip = $this->make_theme_zip( array(
			'manifestVersion' => 1,
			'id'              => 'acme/papered',
			'name'            => 'Papered',
			'wallpapers'      => array( 'dusk' => array( 'path' => 'desk.png' ) ),
		) );

		$entry = openstation_desktop_theme_install_from_zip( $zip );
		$this->assertNotWPError( $entry );

		openstation_register_desktop_theme_wallpapers();
		$ids = wp_list_pluck( openstation_build_desktop_wallpapers_payload(), 'id' );

		$this->assertContains(
			'desktop-theme/acme-papered/dusk',
			$ids,
			'A freshly installed theme’s wallpaper must be registerable within the same request.'
		);

		openstation_desktop_theme_delete( 'acme-papered' );
		unlink( $zip );
	}

	public function test_staging_sweep_collects_only_stale_orphans() {
		$base = openstation_desktop_themes_ensure_dir();
		$this->assertNotWPError( $base );

		$stale = $base . '/.staging-' . wp_generate_uuid4();
		$fresh = $base . '/.staging-' . wp_generate_uuid4();
		$theme = $base . '/not-a-staging-dir';
		wp_mkdir_p( $stale );
		wp_mkdir_p( $fresh );
		wp_mkdir_p( $theme );

		touch( $stale, time() - ( 2 * DAY_IN_SECONDS ) );

		$removed = openstation_desktop_theme_sweep_staging();

		$this->assertSame( 1, $removed );
		$this->assertDirectoryDoesNotExist( $stale, 'A stale orphan is collected.' );
		$this->assertDirectoryExists( $fresh, 'A concurrent upload is left alone.' );
		$this->assertDirectoryExists( $theme, 'Only .staging-* dirs are touched.' );

		openstation_desktop_theme_rmdir( $fresh );
		openstation_desktop_theme_rmdir( $theme );
	}

	public function test_quotes_are_allowed_but_cannot_break_out() {
		$this->assertTrue(
			openstation_desktop_theme_is_safe_css_value( '"Segoe UI", sans-serif' )
		);

		foreach ( array(
			'"; background: url( evil.png ); x: "',
			'"} body { display: none } .x{"',
			'"</style><script>alert(1)</script>"',
		) as $payload ) {
			$this->assertFalse(
				openstation_desktop_theme_is_safe_css_value( $payload ),
				'Should be rejected: ' . $payload
			);
		}
	}

	public function test_wallpaper_label_is_stripped_not_escaped() {
		openstation_register_wallpaper( 'acme/labelled', array(
			'label'   => '<b>Bold</b> Black & White',
			'preview' => '#000',
			'type'    => 'css',
		) );

		$found = null;
		foreach ( openstation_build_desktop_wallpapers_payload() as $entry ) {
			if ( 'acme/labelled' === $entry['id'] ) {
				$found = $entry;
			}
		}

		$this->assertNotNull( $found );
		$this->assertStringNotContainsString( '<b>', $found['label'], 'Tags stripped.' );
		$this->assertStringContainsString(
			'&',
			$found['label'],
			'An ampersand survives as itself — entity-encoding it would show &amp; to the user.'
		);
		$this->assertStringNotContainsString( '&amp;', $found['label'] );
	}

	private function make_theme_zip( $manifest ) {
		$dir = get_temp_dir() . 'dm-theme-zip-' . wp_generate_uuid4();
		wp_mkdir_p( $dir );
		file_put_contents( $dir . '/theme.json', wp_json_encode( $manifest ) );

		file_put_contents(
			$dir . '/desk.png',
			base64_decode( 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==' )
		);

		$zip_path = $dir . '.zip';
		$zip      = new ZipArchive();
		$zip->open( $zip_path, ZipArchive::CREATE );
		$zip->addFile( $dir . '/theme.json', 'theme.json' );
		$zip->addFile( $dir . '/desk.png', 'desk.png' );
		$zip->close();

		return $zip_path;
	}

	public function test_theme_without_a_wallpaper_adds_no_entry() {
		openstation_register_desktop_theme( 'acme/bare', array( 'name' => 'Bare' ) );
		openstation_register_desktop_theme_wallpapers();

		foreach ( openstation_build_desktop_wallpapers_payload() as $entry ) {
			$this->assertStringNotContainsString( 'acme-bare', $entry['id'] );
		}

		openstation_unregister_desktop_theme( 'acme/bare' );
	}
}
