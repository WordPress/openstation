<?php
/**
 * Tests for the `openstation` icon collection handed to WordPress.
 *
 * The interesting assertions here are the sanitisation ones. WordPress runs
 * registered icon markup through `wp_kses` against a fixed allowlist, and
 * anything outside it is dropped in silence: no error, no warning, just an
 * icon that renders as a solid blob on a live site. These tests fail loudly
 * instead, and they run on every supported WordPress version because they only
 * need `wp_kses`, not the 7.1 registration API.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group icons
 */
class Tests_OpenStation_WpIconRegistry extends WP_UnitTestCase {

	/**
	 * WP_Icons_Registry::sanitize_icon_content(), verbatim.
	 *
	 * @var array<string, array<string, bool>>
	 */
	const CORE_ALLOWLIST = array(
		'svg'     => array(
			'class'       => true,
			'xmlns'       => true,
			'width'       => true,
			'height'      => true,
			'viewbox'     => true,
			'aria-hidden' => true,
			'role'        => true,
			'focusable'   => true,
		),
		'path'    => array(
			'fill'      => true,
			'fill-rule' => true,
			'd'         => true,
			'transform' => true,
		),
		'polygon' => array(
			'fill'      => true,
			'fill-rule' => true,
			'points'    => true,
			'transform' => true,
			'focusable' => true,
		),
	);

	/**
	 * Provides every icon slug in the collection.
	 *
	 * @return array<string, array{0: string}>
	 */
	public function data_icons() {
		$cases = array();
		foreach ( array_keys( openstation_wp_icon_collection() ) as $slug ) {
			$cases[ $slug ] = array( $slug );
		}
		return $cases;
	}

	/**
	 * Reads one icon off disk.
	 *
	 * @param string $slug Icon slug.
	 * @return string SVG markup.
	 */
	private function markup( $slug ) {
		return file_get_contents( OPENSTATION_DIR . 'assets/icons/' . $slug . '.svg' );
	}

	/**
	 * Every icon named in the collection ships as a readable file.
	 *
	 * @dataProvider data_icons
	 *
	 * @param string $slug Icon slug.
	 */
	public function test_icon_file_exists( $slug ) {
		$this->assertFileIsReadable( OPENSTATION_DIR . 'assets/icons/' . $slug . '.svg' );
	}

	/**
	 * And nothing ships that the collection does not name, so the directory
	 * and the registry cannot drift apart in either direction.
	 */
	public function test_no_orphan_icon_files() {
		$on_disk = glob( OPENSTATION_DIR . 'assets/icons/*.svg' );
		$on_disk = array_map(
			static function ( $path ) {
				return basename( $path, '.svg' );
			},
			$on_disk
		);
		sort( $on_disk );

		$registered = array_keys( openstation_wp_icon_collection() );
		sort( $registered );

		$this->assertSame( $registered, $on_disk );
	}

	/**
	 * The geometry survives Core's sanitiser.
	 *
	 * A stroked icon passes this file check but loses its stroke on the way
	 * in, so the assertion is that every path Core keeps still carries its
	 * own drawing instructions.
	 *
	 * @dataProvider data_icons
	 *
	 * @param string $slug Icon slug.
	 */
	public function test_icon_survives_core_sanitisation( $slug ) {
		$before = $this->markup( $slug );
		$after  = wp_kses( $before, self::CORE_ALLOWLIST );

		$this->assertSame(
			substr_count( $before, '<path' ),
			substr_count( $after, '<path' ),
			"Core's allowlist dropped a path from {$slug}."
		);
		$this->assertStringContainsString( ' d="', $after, "{$slug} lost its geometry." );
	}

	/**
	 * No icon relies on a stroke.
	 *
	 * `stroke` is not on the allowlist, anywhere, so a monoline icon added
	 * here as drawn would render as a solid blob. The drawings live in the
	 * brand repository; what ships here is the outline of the stroke.
	 *
	 * @dataProvider data_icons
	 *
	 * @param string $slug Icon slug.
	 */
	public function test_icon_does_not_rely_on_a_stroke( $slug ) {
		$this->assertStringNotContainsString(
			'stroke',
			$this->markup( $slug ),
			"{$slug} carries a stroke attribute, which Core drops on registration. "
			. 'Expand the stroke to a filled path first.'
		);
	}

	/**
	 * No icon relies on an element Core strips.
	 *
	 * @dataProvider data_icons
	 *
	 * @param string $slug Icon slug.
	 */
	public function test_icon_uses_only_allowed_elements( $slug ) {
		$markup = $this->markup( $slug );

		foreach ( array( '<rect', '<circle', '<ellipse', '<line', '<g ', '<title' ) as $element ) {
			$this->assertStringNotContainsString(
				$element,
				$markup,
				"{$slug} uses {$element}, which Core's allowlist strips."
			);
		}
	}

	/**
	 * Every shape asks for the surrounding text color.
	 *
	 * `wp_get_icon()` adds no fill of its own, so a path without one paints
	 * black and ignores the theme around it.
	 *
	 * @dataProvider data_icons
	 *
	 * @param string $slug Icon slug.
	 */
	public function test_icon_inherits_text_color( $slug ) {
		$markup = $this->markup( $slug );

		$this->assertSame(
			substr_count( $markup, '<path' ),
			substr_count( $markup, 'fill="currentColor"' ),
			"Every path in {$slug} needs fill=\"currentColor\", or it renders black."
		);
	}

	/**
	 * On WordPress 7.1 and newer the icons reach the registry.
	 */
	public function test_icons_register_on_supported_wordpress() {
		if ( ! function_exists( 'wp_register_icon_collection' ) || ! function_exists( 'wp_get_icon' ) ) {
			$this->markTestSkipped( 'The icon registration API landed in WordPress 7.1.' );
		}

		// The collection is registered on `init` during bootstrap, so start
		// from a clean slate rather than asserting against leftover state.
		if ( function_exists( 'wp_unregister_icon_collection' ) ) {
			wp_unregister_icon_collection( 'openstation' );
		}

		openstation_register_wp_icons();

		$icon = wp_get_icon( 'openstation/window' );

		$this->assertNotEmpty( $icon, 'openstation/window did not render.' );
		$this->assertStringContainsString( '<path', $icon );
	}

	/**
	 * Registering twice is a no-op rather than eleven doing-it-wrong notices.
	 */
	public function test_registering_twice_is_harmless() {
		if ( ! function_exists( 'wp_register_icon_collection' ) ) {
			$this->markTestSkipped( 'The icon registration API landed in WordPress 7.1.' );
		}

		openstation_register_wp_icons();
		openstation_register_wp_icons();

		$this->assertTrue( true );
	}
}
