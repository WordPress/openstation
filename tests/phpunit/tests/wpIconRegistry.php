<?php

class Tests_OpenStation_WpIconRegistry extends WP_UnitTestCase {

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

	public function data_icons() {
		$cases = array();
		foreach ( array_keys( openstation_wp_icon_collection() ) as $slug ) {
			$cases[ $slug ] = array( $slug );
		}
		return $cases;
	}

	private function markup( $slug ) {
		return file_get_contents( OPENSTATION_DIR . 'assets/icons/' . $slug . '.svg' );
	}

	public function test_icon_file_exists( $slug ) {
		$this->assertFileIsReadable( OPENSTATION_DIR . 'assets/icons/' . $slug . '.svg' );
	}

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

	public function test_icon_does_not_rely_on_a_stroke( $slug ) {
		$this->assertStringNotContainsString(
			'stroke',
			$this->markup( $slug ),
			"{$slug} carries a stroke attribute, which Core drops on registration. "
			. 'Expand the stroke to a filled path first.'
		);
	}

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

	public function test_icon_inherits_text_color( $slug ) {
		$markup = $this->markup( $slug );

		$this->assertSame(
			substr_count( $markup, '<path' ),
			substr_count( $markup, 'fill="currentColor"' ),
			"Every path in {$slug} needs fill=\"currentColor\", or it renders black."
		);
	}

	public function test_icons_register_on_supported_wordpress() {
		if ( ! function_exists( 'wp_register_icon_collection' ) || ! function_exists( 'wp_get_icon' ) ) {
			$this->markTestSkipped( 'The icon registration API landed in WordPress 7.1.' );
		}

		if ( function_exists( 'wp_unregister_icon_collection' ) ) {
			wp_unregister_icon_collection( 'openstation' );
		}

		openstation_register_wp_icons();

		$icon = wp_get_icon( 'openstation/window' );

		$this->assertNotEmpty( $icon, 'openstation/window did not render.' );
		$this->assertStringContainsString( '<path', $icon );
	}

	public function test_registering_twice_is_harmless() {
		if ( ! function_exists( 'wp_register_icon_collection' ) ) {
			$this->markTestSkipped( 'The icon registration API landed in WordPress 7.1.' );
		}

		openstation_register_wp_icons();
		openstation_register_wp_icons();
		openstation_register_wp_icons();

		foreach ( array_keys( openstation_wp_icon_collection() ) as $slug ) {
			$this->assertStringContainsString(
				'<path',
				(string) wp_get_icon( 'openstation/' . $slug ),
				"openstation/$slug stopped rendering after a repeat registration."
			);
		}
	}
}
