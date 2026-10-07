<?php

class Tests_OpenStation_BrandDefaults extends WP_UnitTestCase {

	const WALLPAPERS = array(
		'galaxy'    => 'galaxy.svg',
		'space'     => 'space.svg',
		'holomesh'  => 'holomesh.svg',
		'pulsemesh' => 'pulsemesh.svg',
	);

	public function tear_down() {
		remove_all_filters( 'openstation_wallpapers' );
		remove_all_filters( 'openstation_default_wallpaper' );
		remove_all_filters( 'openstation_accent_colors' );
		parent::tear_down();
	}

	public function test_brand_wallpapers_are_registered() {
		$registry = openstation_desktop_wallpaper_registry();

		foreach ( array_keys( self::WALLPAPERS ) as $id ) {
			$this->assertArrayHasKey( $id, $registry, $id . ' is registered' );
			$this->assertSame( 'css', $registry[ $id ]['type'], $id . ' paints from CSS, no canvas' );
		}
	}

	public function test_brand_wallpaper_artwork_ships_and_is_referenced() {
		foreach ( self::WALLPAPERS as $id => $file ) {
			$path = OPENSTATION_DIR . 'assets/wallpapers/' . $file;
			$this->assertFileExists( $path, $file . ' ships with the plugin' );

			$entry = openstation_desktop_wallpaper_registry( $id );
			$this->assertStringContainsString(
				'assets/wallpapers/' . $file,
				$entry['value'],
				$id . ' points at its own artwork'
			);
			$this->assertStringContainsString( 'cover', $entry['value'], $id . ' covers the desk' );
		}
	}

	public function test_galaxy_is_the_default_desk() {
		$this->assertSame( 'galaxy', openstation_get_default_wallpaper() );

		$defaults = openstation_default_os_settings();
		$this->assertSame( 'galaxy', $defaults['wallpaper'] );
		$this->assertArrayHasKey(
			'galaxy',
			openstation_desktop_wallpaper_registry(),
			'the default desk is one that actually exists'
		);
	}

	public function test_pulse_is_the_default_accent() {
		$defaults = openstation_default_os_settings();
		$this->assertSame( 'pulse', $defaults['accent'] );

		$accents = openstation_get_accent_colors();
		$byId    = array();
		foreach ( $accents as $accent ) {
			$byId[ $accent['id'] ] = $accent['value'];
		}

		$this->assertArrayHasKey( 'pulse', $byId, 'the default accent is one that exists' );
		$this->assertSame( '#f252fc', $byId['pulse'], 'Pulse, the identity accent' );
		$this->assertSame( '#fffbff', $byId['starlight'], 'Starlight, the colourless choice, is offered' );
		$this->assertSame( '#ec9bff', $byId['nebula'], 'Nebula, its softer twin' );
		$this->assertSame(
			'pulse',
			$accents[0]['id'],
			'the brand accent leads the picker'
		);
	}

	public function test_wordpress_accents_are_still_offered() {
		$ids = wp_list_pluck( openstation_get_accent_colors(), 'id' );

		foreach ( array( 'wp-blue', 'indigo', 'teal', 'emerald', 'amber', 'rose' ) as $id ) {
			$this->assertContains( $id, $ids );
		}
	}

	public function test_brand_typefaces_ship_with_the_plugin() {
		foreach ( array( 'Geist-Variable.woff2', 'GeistMono-Variable.woff2', 'OFL.txt' ) as $file ) {
			$this->assertFileExists( OPENSTATION_DIR . 'assets/fonts/' . $file );
		}
	}
}
