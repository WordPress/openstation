<?php
/**
 * Tests for the PHP Mio portrait renderer, and for the look clamp
 * that stands between stored data and it.
 *
 * The point of this file is the parity test. The renderer exists twice,
 * here and in `src/mio/portrait.ts`, because an agent's face has to be
 * drawn where the shell bundle never loads. Two implementations of the
 * same maths drift silently unless something holds them together, so
 * both are pinned to `tests/fixtures/mio-portraits.json` and neither
 * generates the other.
 *
 * Structure is compared exactly; numbers to within a hundredth of a
 * unit. See the note on the assertion for why byte equality is the
 * wrong contract to ask two languages for.
 *
 * If this fails after a deliberate change to the TypeScript renderer,
 * the fix is to mirror the change here, not to regenerate anything.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-mio
 */
class Tests_OpenStation_MioPortrait extends WP_UnitTestCase {

	/**
	 * The committed contract between the two renderers.
	 *
	 * @return array<string, array{0: array, 1: int, 2: string, 3: string}>
	 */
	public function data_fixture_cases() {
		$path = dirname( __DIR__, 2 ) . '/fixtures/mio-portraits.json';
		$this->assertFileExists(
			$path,
			'The portrait fixture is missing. Regenerate with UPDATE_MIO_PORTRAITS=1 npx vitest run mio-portrait.'
		);
		$fixture = json_decode( file_get_contents( $path ), true ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- Reading a test fixture off disk.

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

	/**
	 * @dataProvider data_fixture_cases
	 *
	 * @param array  $config Look to draw.
	 * @param int    $size   Rendered size.
	 * @param string $label  Id suffix, and the case name.
	 * @param string $want   Expected markup.
	 */
	public function test_matches_the_typescript_renderer( $config, $size, $label, $want ) {
		$got = openstation_mio_portrait_svg( $config, $size, $label );
		$hint = "The PHP portrait for '{$label}' does not match the one TypeScript draws. "
			. 'Both renderers are pinned to tests/fixtures/mio-portraits.json; '
			. 'mirror the change rather than regenerating to make this pass.';

		// Structure exactly, numbers within a tolerance. Byte equality
		// is the wrong contract between two languages: PHP and V8 do
		// not agree to the last bit on a chain of pow/cos/divide, and a
		// value that lands either side of a .005 boundary formats
		// differently for reasons that have nothing to do with the
		// drawing. A real drift moves a coordinate by far more than a
		// hundredth of a unit; ulp noise never does.
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
		// These files are written into uploads and served, so a
		// portrait that could carry an attacker's string would be
		// stored XSS with a .svg extension.
		$svg = openstation_mio_portrait_svg( array(), 96, 'x' );

		preg_match_all( '/<\/?([A-Za-z][\w:-]*)/', $svg, $m );
		// `clipPath` is the inner line: an SVG stroke is centred on its
		// path and cannot be offset to one side, so the line is drawn
		// at twice the width it needs and the outer half is clipped
		// away.
		$allowed = array( 'svg', 'defs', 'linearGradient', 'stop', 'path', 'use', 'rect', 'clipPath' );
		foreach ( array_unique( $m[1] ) as $tag ) {
			$this->assertContains( $tag, $allowed, "Unexpected <{$tag}> in a portrait." );
		}

		// No text nodes at all.
		$this->assertSame( '', preg_replace( '/<[^>]*>/', '', $svg ) );
	}

	public function test_scopes_ids_so_several_can_share_one_document() {
		// Fixed ids were a real bug: a picker inlining twelve
		// candidates rendered twelve copies of the first, because every
		// `use` resolved against the first `#s` in the document.
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
		// The shipped defaults write colours as CSS strings; a clamped
		// look carries ints. Both have to draw the same face.
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
		// A teardrop reaches 1.62x its mean radius; a box drawn for the
		// circle would amputate the tip.
		$this->assertGreaterThan( $box( 'star' ), $box( 'drop' ) );
		$this->assertGreaterThan( $box( 'circle' ), $box( 'star' ) );
	}

	// -----------------------------------------------------------------
	// The clamp
	// -----------------------------------------------------------------

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
		// A face that changed silhouette on a timer is not a portrait.
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
			// And the result still draws.
			$this->assertStringStartsWith( '<svg', openstation_mio_portrait_svg( $look, 48, 'j' ) );
		}
	}

	public function test_clamp_returns_colours_as_ints() {
		$look = openstation_mio_clamp_look( array( 'appearance' => array( 'bodyColor' => '#abcdef' ) ) );
		$this->assertSame( 0xabcdef, $look['appearance']['bodyColor'] );
		// And the default, which ships as a string, comes back an int.
		$this->assertIsInt( $look['appearance']['eyeColor'] );
	}
}
