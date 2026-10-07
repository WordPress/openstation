<?php

class Tests_OpenStation_MioPortrait extends WP_UnitTestCase {

	public function data_fixture_cases() {
		$path = dirname( __DIR__, 2 ) . '/fixtures/mio-portraits.json';
		$this->assertFileExists(
			$path,
			'The portrait fixture is missing. Regenerate with UPDATE_MIO_PORTRAITS=1 npx vitest run mio-portrait.'
		);
		$fixture = json_decode( file_get_contents( $path ), true );

		$out = array();
		foreach ( $fixture['cases'] as $case ) {
			$out[ $case['label'] ] = array(
				$case['config'],
				$case['size'],
				$case['label'],
				$case['svg'],
			);
		}
		return $out;
	}

	public function test_matches_the_typescript_renderer( $config, $size, $label, $want ) {
		$got = openstation_mio_portrait_svg( $config, $size, $label );
		$hint = "The PHP portrait for '{$label}' does not match the one TypeScript draws. "
			. 'Both renderers are pinned to tests/fixtures/mio-portraits.json; '
			. 'mirror the change rather than regenerating to make this pass.';

		$this->assertSame(
			preg_replace( '/-?\d+\.\d+/', '#', $want ),
			preg_replace( '/-?\d+\.\d+/', '#', $got ),
			$hint
		);

		preg_match_all( '/-?\d+\.\d+/', $want, $want_nums );
		preg_match_all( '/-?\d+\.\d+/', $got, $got_nums );
		$this->assertCount( count( $want_nums[0] ), $got_nums[0], $hint );
		foreach ( $want_nums[0] as $i => $expected ) {
			$this->assertEqualsWithDelta(
				(float) $expected,
				(float) $got_nums[0][ $i ],
				0.02,
				$hint . " (number #{$i})"
			);
		}
	}

	public function test_carries_no_text_and_no_caller_supplied_string() {

		$svg = openstation_mio_portrait_svg( array(), 96, 'x' );

		preg_match_all( '/<\/?([A-Za-z][\w:-]*)/', $svg, $m );

		$allowed = array( 'svg', 'defs', 'linearGradient', 'stop', 'path', 'use', 'rect', 'clipPath' );
		foreach ( array_unique( $m[1] ) as $tag ) {
			$this->assertContains( $tag, $allowed, "Unexpected <{$tag}> in a portrait." );
		}

		$this->assertSame( '', preg_replace( '/<[^>]*>/', '', $svg ) );
	}

	public function test_scopes_ids_so_several_can_share_one_document() {

		$a = openstation_mio_portrait_svg( array( 'physics' => array( 'shapePreset' => 'star' ) ), 96, 'a' );
		$b = openstation_mio_portrait_svg( array( 'physics' => array( 'shapePreset' => 'heart' ) ), 96, 'b' );

		$this->assertStringContainsString( 'id="sa"', $a );
		$this->assertStringContainsString( 'href="#sa"', $a );
		$this->assertStringContainsString( 'id="sb"', $b );
		$this->assertStringNotContainsString( 'id="sa"', $b );
	}

	public function test_a_suffix_cannot_break_out_of_the_attribute() {
		$svg = openstation_mio_portrait_svg( array(), 96, '" onload="alert(1)' );
		$this->assertStringContainsString( 'id="sonloadalert1"', $svg );
		$this->assertStringNotContainsString( 'onload=', $svg );
		$this->assertStringNotContainsString( 'alert(', $svg );
	}

	public function test_accepts_colours_as_hex_strings_or_ints() {

		$as_string = openstation_mio_portrait_svg(
			array( 'appearance' => array( 'bodyColor' => '#123456' ) ),
			96,
			'c'
		);
		$as_int = openstation_mio_portrait_svg(
			array( 'appearance' => array( 'bodyColor' => 0x123456 ) ),
			96,
			'c'
		);
		$this->assertSame( $as_string, $as_int );
		$this->assertStringContainsString( 'fill="#123456"', $as_int );
	}

	public function test_sizes_the_box_to_the_shape_not_to_a_circle() {
		$box = static function ( $preset ) {
			$svg = openstation_mio_portrait_svg( array( 'physics' => array( 'shapePreset' => $preset ) ) );
			preg_match( '/viewBox="-([\d.]+)/', $svg, $m );
			return (float) $m[1];
		};

		$this->assertGreaterThan( $box( 'star' ), $box( 'drop' ) );
		$this->assertGreaterThan( $box( 'circle' ), $box( 'star' ) );
	}

	public function test_clamp_holds_values_inside_their_ranges() {
		$look = openstation_mio_clamp_look(
			array(
				'appearance' => array(
					'outlineWidth' => -400,
					'glow'         => 1e9,
					'lightness'    => 0,
					'eyeScale'     => 99,
				),
				'physics'    => array( 'shapeAmount' => 1e12 ),
			)
		);

		$this->assertEquals( 0.5, $look['appearance']['outlineWidth'] );
		$this->assertEquals( 20, $look['appearance']['glow'] );
		$this->assertEquals( 0.15, $look['appearance']['lightness'] );
		$this->assertEquals( 0.6, $look['appearance']['eyeScale'] );
		$this->assertEquals( 1.4, $look['physics']['shapeAmount'] );
	}

	public function test_clamp_rejects_an_unknown_silhouette() {
		$look = openstation_mio_clamp_look(
			array( 'physics' => array( 'shapePreset' => 'trapezoid' ) )
		);
		$defaults = openstation_mio_default_config();
		$this->assertSame( $defaults['physics']['shapePreset'], $look['physics']['shapePreset'] );
	}

	public function test_clamp_drops_the_shuffle() {

		$look = openstation_mio_clamp_look(
			array( 'physics' => array( 'shapeShuffle' => 60 ) )
		);
		$this->assertEquals( 0, $look['physics']['shapeShuffle'] );
	}

	public function test_clamp_survives_junk() {
		foreach ( array( null, 'nope', 42, array( 'appearance' => 'no' ) ) as $junk ) {
			$look = openstation_mio_clamp_look( $junk );
			$this->assertIsArray( $look['appearance'] );
			$this->assertIsArray( $look['physics'] );

			$this->assertStringStartsWith( '<svg', openstation_mio_portrait_svg( $look, 48, 'j' ) );
		}
	}

	public function test_clamp_returns_colours_as_ints() {
		$look = openstation_mio_clamp_look( array( 'appearance' => array( 'bodyColor' => '#abcdef' ) ) );
		$this->assertSame( 0xabcdef, $look['appearance']['bodyColor'] );

		$this->assertIsInt( $look['appearance']['eyeColor'] );
	}
}
