<?php

defined( 'ABSPATH' ) || exit;

const OPENSTATION_MIO_PORTRAIT_RIM_SAMPLES = 72;

const OPENSTATION_MIO_PORTRAIT_RING_SAMPLES = 16;

function openstation_mio_portrait_glow_shells() {
	return array(
		array( 1.0, 0.1 ),
		array( 0.6, 0.14 ),
		array( 0.28, 0.2 ),
	);
}

function openstation_mio_portrait_fix( $value ) {
	$rounded = round( (float) $value, 2 );
	if ( 0.0 === $rounded ) {
		$rounded = 0.0;
	}
	return number_format( $rounded, 2, '.', '' );
}

function openstation_mio_portrait_hex( $rgb ) {
	return '#' . str_pad( dechex( (int) $rgb & 0xffffff ), 6, '0', STR_PAD_LEFT );
}

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

		return (int) min( 255, max( 0, floor( ( $v + $m ) * 255.0 + 0.5 ) ) );
	};
	return ( $to8( $r ) << 16 ) | ( $to8( $g ) << 8 ) | $to8( $b );
}

function openstation_mio_portrait_ring( $count, $appearance ) {
	$n   = max( 1, (int) round( $count ) );
	$out = array();
	for ( $i = 0; $i < $n; $i++ ) {
		$t = $i / $n;

		$shifted = fmod( fmod( $t - $appearance['hueAngle'] / 360.0, 1.0 ) + 1.0, 1.0 );
		$ramp    = $appearance['hueLoop']
			? 0.5 - 0.5 * cos( $shifted * M_PI * 2.0 )
			: $shifted;
		$hue     = $appearance['hueStart'] + $appearance['hueSpan'] * $ramp;

		$lift      = 0.5 + 0.5 * cos( ( $t - 1.0 / 3.0 ) * M_PI * 2.0 );
		$lightness = $appearance['lightness'] * ( 0.72 + 0.28 * $lift );
		$out[]     = openstation_mio_hsl_to_rgb_int( $hue, $appearance['saturation'], $lightness );
	}
	return $out;
}

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

			return 0.05 * cos( 3.0 * ( $angle + $half_pi ) );
	}
}

function openstation_mio_shape_profile( $angle, $physics ) {
	if ( $physics['shapeAmount'] <= 0 ) {
		return 1.0;
	}
	$upright = $angle - ( $physics['shapeAngle'] * M_PI ) / 180.0;
	return 1.0 + $physics['shapeAmount'] * openstation_mio_preset_deviation( $upright, $physics );
}

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

function openstation_mio_portrait_extent( $physics ) {
	$n   = OPENSTATION_MIO_PORTRAIT_RIM_SAMPLES;
	$max = 0.0;
	for ( $i = 0; $i < $n; $i++ ) {
		$max = max( $max, openstation_mio_shape_profile( ( $i / $n ) * M_PI * 2.0, $physics ) );
	}
	return $max;
}

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

	$appearance['bodyColor']  = openstation_mio_color_int( $appearance['bodyColor'] );
	$appearance['eyeColor']   = openstation_mio_color_int( $appearance['eyeColor'] );
	$appearance['linerColor'] = openstation_mio_color_int( $appearance['linerColor'] );

	$uid      = preg_replace( '/[^A-Za-z0-9_-]/', '', (string) $id_suffix );
	$ring_id  = 'r' . $uid;
	$shape_id = 's' . $uid;
	$clip_id  = 'c' . $uid;

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
