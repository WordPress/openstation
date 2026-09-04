<?php
/**
 * OpenStation — Mio portraits.
 *
 * A Mio at rest, drawn as SVG by PHP. The twin of
 * `src/mio/portrait.ts`, and deliberately a twin rather than a shared
 * implementation: agents wear Mio looks, and an agent's face has to
 * appear where the shell bundle never loads: a comment author on the
 * front end, a row in the wp-admin Users list, a `get_avatar()` call
 * from any plugin. Those are PHP, with no JavaScript in the request at
 * all.
 *
 * The alternative was to render every face in the browser and post it
 * back, which puts a round trip on the one control in the agent wizard
 * that is supposed to feel instant, and still leaves the front end
 * with nothing to draw.
 *
 * **The two are held together by `tests/fixtures/mio-portraits.json`.**
 * Neither generates the other. `tests/vitest/mio-portrait.test.ts`
 * asserts the TypeScript side reproduces the fixture exactly, and
 * `Tests_OpenStation_MioPortrait` asserts this file reproduces its
 * structure exactly and its numbers to within a hundredth of a unit.
 *
 * The tolerance is deliberate and it is not slack. PHP and V8 do not
 * agree to the last bit on a chain of `pow`, `cos` and division, so a
 * coordinate that lands either side of a rounding boundary formats
 * differently for reasons that have nothing to do with the drawing.
 * Byte equality across two languages' floating point is not a contract
 * anyone can hold. A real drift (a dropped term, a wrong constant)
 * moves a coordinate by units, not by a hundredth.
 *
 * If you change the maths here, change it there, regenerate the fixture
 * with `UPDATE_MIO_PORTRAITS=1 npx vitest run mio-portrait`, and read
 * both diffs.
 *
 * **The output carries no text and no caller-supplied string.** Every
 * value written into the markup is a number computed here, and every
 * element name is a literal. That is a hard rule, not a style
 * preference: these files are written into uploads and served, so a
 * portrait that could carry an attacker's string would be a stored XSS
 * with a `.svg` extension.
 *
 * This file is NOT part of the agents module and does not sit behind
 * its feature flag: a portrait is a Mio capability that agents happen
 * to consume.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/** Rim samples used to trace the outline. Mirrors `RIM_SAMPLES`. */
const OPENSTATION_MIO_PORTRAIT_RIM_SAMPLES = 72;

/** Colour stops along the gradient. Mirrors `RING_SAMPLES`. */
const OPENSTATION_MIO_PORTRAIT_RING_SAMPLES = 16;

/**
 * Glow shells, outermost first: `[ spread, alpha ]`.
 *
 * A glow is a dilated silhouette, not a fat outline. One wide
 * low-alpha band is a slab with a visible edge however wide it gets; a
 * ramp of concentric strokes on the same path falls off.
 *
 * @return array<int, array{0: float, 1: float}>
 */
function openstation_mio_portrait_glow_shells() {
	return array(
		array( 1.0, 0.1 ),
		array( 0.6, 0.14 ),
		array( 0.28, 0.2 ),
	);
}

/**
 * Round to 2dp the same way the TypeScript `fix()` does.
 *
 * `number_format` is not enough on its own: PHP renders a negative
 * value that rounds to zero as `-0.00`, and so does JavaScript's
 * `toFixed`, so both sides normalise it. Two renderers reaching zero
 * from opposite sides have to agree.
 *
 * @param float $value Value to format.
 * @return string Fixed 2dp representation.
 */
function openstation_mio_portrait_fix( $value ) {
	$rounded = round( (float) $value, 2 );
	if ( 0.0 === $rounded ) {
		$rounded = 0.0;
	}
	return number_format( $rounded, 2, '.', '' );
}

/**
 * A 24-bit RGB int as `#rrggbb`.
 *
 * @param int $rgb Packed colour.
 * @return string Hex colour.
 */
function openstation_mio_portrait_hex( $rgb ) {
	return '#' . str_pad( dechex( (int) $rgb & 0xffffff ), 6, '0', STR_PAD_LEFT );
}

/**
 * HSL to packed 24-bit RGB. Mirrors `hslToRgbInt()` in `chroma.ts`.
 *
 * @param float $h Hue in degrees; wrapped, so -30 and 330 agree.
 * @param float $s Saturation, 0-1.
 * @param float $l Lightness, 0-1.
 * @return int Packed colour.
 */
function openstation_mio_hsl_to_rgb_int( $h, $s, $l ) {
	$hue = fmod( fmod( (float) $h, 360.0 ) + 360.0, 360.0 );
	$sat = min( 1.0, max( 0.0, (float) $s ) );
	$lig = min( 1.0, max( 0.0, (float) $l ) );
	$c   = ( 1.0 - abs( 2.0 * $lig - 1.0 ) ) * $sat;
	$hp  = $hue / 60.0;
	$x   = $c * ( 1.0 - abs( fmod( $hp, 2.0 ) - 1.0 ) );

	$r = 0.0;
	$g = 0.0;
	$b = 0.0;
	if ( $hp < 1 ) {
		$r = $c;
		$g = $x;
	} elseif ( $hp < 2 ) {
		$r = $x;
		$g = $c;
	} elseif ( $hp < 3 ) {
		$g = $c;
		$b = $x;
	} elseif ( $hp < 4 ) {
		$g = $x;
		$b = $c;
	} elseif ( $hp < 5 ) {
		$r = $x;
		$b = $c;
	} else {
		$r = $c;
		$b = $x;
	}

	$m    = $lig - $c / 2.0;
	$to8  = static function ( $v ) use ( $m ) {
		// PHP rounds half away from zero and JS rounds half up. The
		// channel values here are never exactly .5 in practice, but
		// matching JS explicitly costs nothing and removes the doubt.
		return (int) min( 255, max( 0, floor( ( $v + $m ) * 255.0 + 0.5 ) ) );
	};
	return ( $to8( $r ) << 16 ) | ( $to8( $g ) << 8 ) | $to8( $b );
}

/**
 * The per-stop colour ramp. Mirrors `chromaRing()` with no hologram
 * (`view`), no drift (`phase`) and no spin, which is what a still
 * portrait has: nothing has elapsed.
 *
 * @param int   $count      Number of stops.
 * @param array $appearance Resolved appearance.
 * @return int[] Packed colours.
 */
function openstation_mio_portrait_ring( $count, $appearance ) {
	$n   = max( 1, (int) round( $count ) );
	$out = array();
	for ( $i = 0; $i < $n; $i++ ) {
		$t = $i / $n;
		// `hueLoop` walks the span out and back on a raised cosine, so
		// both ends of the ramp are the same colour by construction and
		// there is no seam. See the long note in `chroma.ts`.
		$shifted = fmod( fmod( $t - $appearance['hueAngle'] / 360.0, 1.0 ) + 1.0, 1.0 );
		$ramp    = $appearance['hueLoop']
			? 0.5 - 0.5 * cos( $shifted * M_PI * 2.0 )
			: $shifted;
		$hue     = $appearance['hueStart'] + $appearance['hueSpan'] * $ramp;
		// Cosine hump peaking at t = 1/3: the lit side of the ring.
		$lift      = 0.5 + 0.5 * cos( ( $t - 1.0 / 3.0 ) * M_PI * 2.0 );
		$lightness = $appearance['lightness'] * ( 0.72 + 0.28 * $lift );
		$out[]     = openstation_mio_hsl_to_rgb_int( $hue, $appearance['saturation'], $lightness );
	}
	return $out;
}

/**
 * The rest silhouette's deviation from a circle, at one angle.
 *
 * Mirrors `presetDeviation()` in `src/mio/shape.ts`. Every figurative
 * preset is authored against an "upright phase" where 0 is straight
 * up, because screen coordinates put -pi/2 at the top and one dropped
 * sign there is a shape that ships upside down.
 *
 * @param float $angle   Rest angle, radians.
 * @param array $physics Resolved physics.
 * @return float Deviation.
 */
function openstation_mio_preset_deviation( $angle, $physics ) {
	$half_pi = M_PI / 2.0;
	$tau     = M_PI * 2.0;
	$upright = fmod( fmod( $angle + $half_pi, $tau ) + $tau, $tau );

	$crest = static function ( $cosine, $power ) {
		return pow( 0.5 + 0.5 * $cosine, $power );
	};

	switch ( $physics['shapePreset'] ) {
		case 'circle':
			return 0.0;

		case 'ghost':
			// Authored in the raw screen angle: both terms are windowed
			// on sin(theta), which is already the underside.
			$under  = max( 0.0, sin( $angle ) );
			$n      = 2.0 + 3.2 * $under;
			$c      = abs( cos( $angle ) );
			$s      = abs( sin( $angle ) );
			$square = 1.0 / pow( pow( $c, $n ) + pow( $s, $n ), 1.0 / $n ) - 1.0;
			$feet   = -0.17 * pow( $under, 1.4 ) * cos( 6.0 * $angle );
			return $square + $feet;

		case 'potato':
			return 0.16 * cos( 2.0 * $angle + 0.9 )
				+ 0.095 * cos( 3.0 * $angle - 2.1 )
				+ 0.036 * cos( 5.0 * $angle + 1.3 )
				+ 0.019 * cos( 7.0 * $angle - 0.4 );

		case 'star':
			return 0.58 * ( $crest( cos( 5.0 * $upright ), 3 ) - 0.3125 );

		case 'flower':
			return 0.34 * ( $crest( cos( 6.0 * $upright ), 2 ) - 0.375 );

		case 'diamond':
			return 0.34 * ( $crest( cos( 4.0 * $upright ), 2 ) - 0.375 );

		case 'drop':
			return 0.72 * ( pow( max( 0.0, cos( $upright ) ), 8 ) - 0.1367 );

		case 'cloud':
			$up   = max( 0.0, cos( $upright ) );
			$down = max( 0.0, -cos( $upright ) );
			return 0.34 * (
				sqrt( $up ) * ( 0.5 + 0.5 * cos( 5.0 * $upright ) )
				- 0.7 * $down * $down
				- 0.0247
			);

		case 'heart':
			$fold  = $upright > M_PI ? $tau - $upright : $upright;
			$cleft = -0.34 * pow( max( 0.0, cos( $upright ) ), 6 );
			$lobes = 0.3 * pow( max( 0.0, cos( $fold - 1.0 ) ), 3 );
			$tip   = 0.34 * pow( max( 0.0, -cos( $upright ) ), 8 );
			return $cleft + $lobes + $tip + 0.02;

		case 'custom':
			$lobes = (int) round( $physics['shapeLobes'] );
			if ( $lobes < 2 ) {
				return 0.0;
			}
			return ( 1.0 / ( 1.0 + $lobes * $lobes ) ) * cos( $lobes * $angle );

		default:
			// 'blob': a corner up, so a flat side sits along the bottom.
			return 0.05 * cos( 3.0 * ( $angle + $half_pi ) );
	}
}

/**
 * The rest silhouette as a multiplier on the radius, at one angle.
 *
 * Mirrors `shapeProfile()`.
 *
 * @param float $angle   Rest angle, radians.
 * @param array $physics Resolved physics.
 * @return float Radius multiplier.
 */
function openstation_mio_shape_profile( $angle, $physics ) {
	if ( $physics['shapeAmount'] <= 0 ) {
		return 1.0;
	}
	$upright = $angle - ( $physics['shapeAngle'] * M_PI ) / 180.0;
	return 1.0 + $physics['shapeAmount'] * openstation_mio_preset_deviation( $upright, $physics );
}

/**
 * The closed outline, as a cubic path centred on the origin.
 *
 * Sampled from the rest profile and joined with the Catmull-Rom to
 * bezier conversion the live renderer applies to its rim; sampling
 * alone reads as a polygon at these sizes.
 *
 * @param array $physics Resolved physics.
 * @param float $radius  Base radius.
 * @return string SVG path data.
 */
function openstation_mio_portrait_path( $physics, $radius ) {
	$n   = OPENSTATION_MIO_PORTRAIT_RIM_SAMPLES;
	$pts = array();
	for ( $i = 0; $i < $n; $i++ ) {
		$angle = ( $i / $n ) * M_PI * 2.0;
		$r     = $radius * openstation_mio_shape_profile( $angle, $physics );
		$pts[] = array( $r * cos( $angle ), $r * sin( $angle ) );
	}

	$at = static function ( $i ) use ( $pts, $n ) {
		return $pts[ ( ( $i % $n ) + $n ) % $n ];
	};

	$d = 'M' . openstation_mio_portrait_fix( $pts[0][0] ) . ' ' . openstation_mio_portrait_fix( $pts[0][1] );
	for ( $i = 0; $i < $n; $i++ ) {
		$p0  = $at( $i - 1 );
		$p1  = $at( $i );
		$p2  = $at( $i + 1 );
		$p3  = $at( $i + 2 );
		$c1x = $p1[0] + ( $p2[0] - $p0[0] ) / 6.0;
		$c1y = $p1[1] + ( $p2[1] - $p0[1] ) / 6.0;
		$c2x = $p2[0] - ( $p3[0] - $p1[0] ) / 6.0;
		$c2y = $p2[1] - ( $p3[1] - $p1[1] ) / 6.0;
		$d  .= 'C' . openstation_mio_portrait_fix( $c1x ) . ' ' . openstation_mio_portrait_fix( $c1y )
			. ',' . openstation_mio_portrait_fix( $c2x ) . ' ' . openstation_mio_portrait_fix( $c2y )
			. ',' . openstation_mio_portrait_fix( $p2[0] ) . ' ' . openstation_mio_portrait_fix( $p2[1] );
	}
	return $d . 'Z';
}

/**
 * How far the outline reaches, as a multiple of the radius.
 *
 * Every preset subtracts its own mean, so they share an average radius
 * but not a peak: a teardrop reaches 1.62x, a star 1.40x, a circle
 * 1.00x. A box drawn for the circle amputates the teardrop's tip, so
 * the box is measured rather than assumed.
 *
 * @param array $physics Resolved physics.
 * @return float Peak multiplier.
 */
function openstation_mio_portrait_extent( $physics ) {
	$n   = OPENSTATION_MIO_PORTRAIT_RIM_SAMPLES;
	$max = 0.0;
	for ( $i = 0; $i < $n; $i++ ) {
		$max = max( $max, openstation_mio_shape_profile( ( $i / $n ) * M_PI * 2.0, $physics ) );
	}
	return $max;
}

/**
 * Draw a Mio at rest.
 *
 * The look is taken as given: callers hand it the output of
 * `openstation_mio_clamp_look()`, never raw storage.
 *
 * `$id_suffix` is appended to every internal id. The markup defines
 * the outline and the gradient once and references them, so two
 * portraits inlined into one document with the same ids would both
 * render the first one's shape, silently. A portrait written to its
 * own file or used as an `img` source is its own document and needs
 * nothing.
 *
 * @param array  $look      Partial look: `appearance` and `physics`.
 * @param int    $size      Rendered width and height, in pixels.
 * @param string $id_suffix Appended to internal ids.
 * @return string SVG markup.
 */
function openstation_mio_portrait_svg( $look = array(), $size = 96, $id_suffix = '' ) {
	$defaults   = openstation_mio_default_config();
	$appearance = array_merge(
		$defaults['appearance'],
		isset( $look['appearance'] ) && is_array( $look['appearance'] ) ? $look['appearance'] : array()
	);
	$physics    = array_merge(
		$defaults['physics'],
		isset( $look['physics'] ) && is_array( $look['physics'] ) ? $look['physics'] : array()
	);

	// The shipped defaults write colours as CSS hex strings because
	// that is what reads well in a config array; a clamped look carries
	// them as ints. Normalise so this draws the same either way.
	$appearance['bodyColor']  = openstation_mio_color_int( $appearance['bodyColor'] );
	$appearance['eyeColor']   = openstation_mio_color_int( $appearance['eyeColor'] );
	$appearance['linerColor'] = openstation_mio_color_int( $appearance['linerColor'] );

	// Only [A-Za-z0-9_-] survives, so a caller cannot close the
	// attribute and write markup through this parameter.
	$uid      = preg_replace( '/[^A-Za-z0-9_-]/', '', (string) $id_suffix );
	$ring_id  = 'r' . $uid;
	$shape_id = 's' . $uid;
	$clip_id  = 'c' . $uid;

	// Work on a canonical 100-unit radius and let the viewBox scale it,
	// so the same path serves a 24px avatar and a 176px hero.
	$radius = 100.0;
	$scale  = $radius / $defaults['appearance']['radius'];
	$stroke = $appearance['outlineWidth'] * $scale;
	$liner  = $appearance['linerWidth'] * $scale;
	$reach  = ( $appearance['glow'] / 10.0 ) * $radius * 0.18;
	$shells = openstation_mio_portrait_glow_shells();
	$half   = $radius * openstation_mio_portrait_extent( $physics )
		+ $stroke / 2.0
		+ $reach * $shells[0][0];

	$box  = openstation_mio_portrait_fix( $half );
	$span = openstation_mio_portrait_fix( $half * 2.0 );
	$d    = openstation_mio_portrait_path( $physics, $radius );
	$ring = openstation_mio_portrait_ring( OPENSTATION_MIO_PORTRAIT_RING_SAMPLES, $appearance );

	$stops = '';
	$last  = count( $ring ) - 1;
	foreach ( $ring as $i => $rgb ) {
		$offset = openstation_mio_portrait_fix( ( $i / $last ) * 100.0 );
		$stops .= '<stop offset="' . $offset . '%" stop-color="' . openstation_mio_portrait_hex( $rgb ) . '"/>';
	}

	$glow = '';
	foreach ( $shells as $shell ) {
		list( $spread, $alpha ) = $shell;
		$glow                  .= '<use href="#' . $shape_id . '" fill="none" stroke="url(#' . $ring_id . ')"'
			. ' stroke-width="' . openstation_mio_portrait_fix( $stroke + $reach * $spread * 2.0 ) . '"'
			. ' stroke-opacity="' . openstation_mio_portrait_fix( $alpha ) . '" stroke-linejoin="round"/>';
	}

	// At rest the body is undeformed, so every squash factor in
	// `eyeLayout()` is exactly 1 and the gaze and blink terms are zero.
	// What is left is the resting face.
	$eye_h   = $radius * $appearance['eyeScale'];
	$eye_w   = $eye_h * 0.46;
	$eye_gap = $radius * 0.28;
	$eye_y   = -$radius * 0.02 - $eye_h / 2.0;
	$eye     = static function ( $cx ) use ( $eye_w, $eye_h, $eye_y, $appearance ) {
		return '<rect x="' . openstation_mio_portrait_fix( $cx - $eye_w / 2.0 ) . '"'
			. ' y="' . openstation_mio_portrait_fix( $eye_y ) . '"'
			. ' width="' . openstation_mio_portrait_fix( $eye_w ) . '"'
			. ' height="' . openstation_mio_portrait_fix( $eye_h ) . '"'
			. ' rx="' . openstation_mio_portrait_fix( $eye_w / 2.0 ) . '"'
			. ' fill="' . openstation_mio_portrait_hex( $appearance['eyeColor'] ) . '"/>';
	};

	// The inner line, clipped to the body.
	//
	// SVG strokes are centred on their path and cannot be offset to one
	// side, so the line is drawn at the full width it would need if it
	// reached both ways — `stroke + liner * 2` — and the clip throws
	// the outer half away. What is left runs from the outline inward,
	// and the chroma stroke below is painted over its inner reach, so
	// the visible white is exactly the band between the two. That is
	// the same geometry `fillLiner()` produces in the live renderer, by
	// the only means SVG offers.
	$line = '';
	if ( $liner > 0 ) {
		$line = '<use href="#' . $shape_id . '" fill="none"'
			. ' stroke="' . openstation_mio_portrait_hex( $appearance['linerColor'] ) . '"'
			. ' stroke-width="' . openstation_mio_portrait_fix( $stroke + $liner * 2.0 ) . '"'
			. ' stroke-linejoin="round" clip-path="url(#' . $clip_id . ')"/>';
	}

	return '<svg xmlns="http://www.w3.org/2000/svg" width="' . (int) $size . '" height="' . (int) $size . '"'
		. ' viewBox="-' . $box . ' -' . $box . ' ' . $span . ' ' . $span . '">'
		. '<defs><linearGradient id="' . $ring_id . '" x1="0" y1="0" x2="0.85" y2="1">' . $stops . '</linearGradient>'
		. '<path id="' . $shape_id . '" d="' . $d . '"/>'
		. '<clipPath id="' . $clip_id . '"><use href="#' . $shape_id . '"/></clipPath></defs>'
		. $glow
		. '<use href="#' . $shape_id . '" fill="' . openstation_mio_portrait_hex( $appearance['bodyColor'] ) . '"'
		. ' fill-opacity="' . openstation_mio_portrait_fix( $appearance['bodyAlpha'] ) . '"/>'
		. $line
		. '<use href="#' . $shape_id . '" fill="none" stroke="url(#' . $ring_id . ')"'
		. ' stroke-width="' . openstation_mio_portrait_fix( $stroke ) . '" stroke-linejoin="round"/>'
		. $eye( -$eye_gap )
		. $eye( $eye_gap )
		. '</svg>';
}
