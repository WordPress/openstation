<?php
/**
 * Tests for the OpenStation brand defaults.
 *
 * The brand reaches the shell through three server-side decisions —
 * which wallpaper a new desk wears, which accent it uses, and what
 * artwork backs them — and each one is a value a future refactor
 * could silently revert to the pre-brand default without breaking
 * anything else. These pin them.
 *
 * The palette itself lives in `assets/css/variables.css` and is
 * covered from the JS side (`tests/vitest/brand-palette.test.ts`),
 * where the stylesheet text is readable.
 *
 * Brand reference: https://nuriapenya.github.io/open-station-brand/
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-brand
 */
class Tests_DesktopMode_BrandDefaults extends WP_UnitTestCase {

	/** The four brand surfaces, and the artwork each one ships. */
	const WALLPAPERS = array(
		'galaxy'    => 'galaxy.svg',
		'space'     => 'space.svg',
		'holomesh'  => 'holomesh.svg',
		'pulsemesh' => 'pulsemesh.svg',
	);

	public function tear_down() {
		remove_all_filters( 'desktop_mode_wallpapers' );
		remove_all_filters( 'desktop_mode_default_wallpaper' );
		remove_all_filters( 'desktop_mode_accent_colors' );
		parent::tear_down();
	}

	/**
	 * @covers ::desktop_mode_register_builtin_wallpapers
	 */
	public function test_brand_wallpapers_are_registered() {
		$registry = desktop_mode_desktop_wallpaper_registry();

		foreach ( array_keys( self::WALLPAPERS ) as $id ) {
			$this->assertArrayHasKey( $id, $registry, $id . ' is registered' );
			$this->assertSame( 'css', $registry[ $id ]['type'], $id . ' paints from CSS, no canvas' );
		}
	}

	/**
	 * Vector artwork, served from the plugin. An SVG scales to any
	 * desk at any DPI for a few kilobytes, which is why these are not
	 * raster files — and why a missing one would be invisible until
	 * someone opened the picker.
	 *
	 * @covers ::desktop_mode_register_builtin_wallpapers
	 */
	public function test_brand_wallpaper_artwork_ships_and_is_referenced() {
		foreach ( self::WALLPAPERS as $id => $file ) {
			$path = DESKTOP_MODE_DIR . 'assets/wallpapers/' . $file;
			$this->assertFileExists( $path, $file . ' ships with the plugin' );

			$entry = desktop_mode_desktop_wallpaper_registry( $id );
			$this->assertStringContainsString(
				'assets/wallpapers/' . $file,
				$entry['value'],
				$id . ' points at its own artwork'
			);
			$this->assertStringContainsString( 'cover', $entry['value'], $id . ' covers the desk' );
		}
	}

	/**
	 * Galaxy is the desk a new install wears. Both halves have to
	 * agree: the filterable helper the shell config reads, and the
	 * per-user settings default a fresh account is seeded with.
	 *
	 * @covers ::desktop_mode_get_default_wallpaper
	 * @covers ::desktop_mode_default_os_settings
	 */
	public function test_galaxy_is_the_default_desk() {
		$this->assertSame( 'galaxy', desktop_mode_get_default_wallpaper() );

		$defaults = desktop_mode_default_os_settings();
		$this->assertSame( 'galaxy', $defaults['wallpaper'] );
		$this->assertArrayHasKey(
			'galaxy',
			desktop_mode_desktop_wallpaper_registry(),
			'the default desk is one that actually exists'
		);
	}

	/**
	 * @covers ::desktop_mode_get_accent_colors
	 * @covers ::desktop_mode_default_os_settings
	 */
	public function test_pulse_is_the_default_accent() {
		$defaults = desktop_mode_default_os_settings();
		$this->assertSame( 'pulse', $defaults['accent'] );

		$accents = desktop_mode_get_accent_colors();
		$byId    = array();
		foreach ( $accents as $accent ) {
			$byId[ $accent['id'] ] = $accent['value'];
		}

		$this->assertArrayHasKey( 'pulse', $byId, 'the default accent is one that exists' );
		$this->assertSame( '#f252fc', $byId['pulse'], 'Pulse, the identity accent' );
		$this->assertSame( '#ec9bff', $byId['nebula'], 'Nebula, its softer twin' );
		$this->assertSame(
			'pulse',
			$accents[0]['id'],
			'the brand accent leads the picker'
		);
	}

	/**
	 * The WordPress swatches survive the rebrand. Someone who wants
	 * their admin blue keeps it — the brand is the default, not the
	 * only option.
	 *
	 * @covers ::desktop_mode_get_accent_colors
	 */
	public function test_wordpress_accents_are_still_offered() {
		$ids = wp_list_pluck( desktop_mode_get_accent_colors(), 'id' );

		foreach ( array( 'wp-blue', 'indigo', 'teal', 'emerald', 'amber', 'rose' ) as $id ) {
			$this->assertContains( $id, $ids );
		}
	}

	/**
	 * The brand faces are self-hosted, so the files have to be here —
	 * a `@font-face` pointing at a missing woff2 fails silently and
	 * the whole station quietly renders in the fallback stack.
	 */
	public function test_brand_typefaces_ship_with_the_plugin() {
		foreach ( array( 'Geist-Variable.woff2', 'GeistMono-Variable.woff2', 'OFL.txt' ) as $file ) {
			$this->assertFileExists( DESKTOP_MODE_DIR . 'assets/fonts/' . $file );
		}
	}
}
