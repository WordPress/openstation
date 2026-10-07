<?php

defined( 'ABSPATH' ) || exit;

function openstation_mio_default_config() {
	return array(
		'appearance' => array(
			'radius'       => 56,

			'bodyColor'    => '#0c0b0f',
			'bodyAlpha'    => 1,

			'hueStart'     => 296.5,
			'hueSpan'      => -52.5,
			'hueAngle'     => 225,

			'hueDrift'     => 0,
			'hueSpin'      => 0,
			'hueLoop'      => true,
			'saturation'   => 1,

			'lightness'    => 0.75,

			'iridescence'  => 0,

			'outlineWidth' => 4,

			'linerWidth'   => 2,

			'linerColor'   => '#fffbff',

			'glow'         => 10,

			'glowBlur'     => true,

			'eyeColor'     => '#fffbff',
			'eyeScale'     => 0.3,
		),
		'physics'    => array(
			'points'          => 12,

			'shapePreset'     => 'blob',

			'shapeLobes'      => 3,
			'shapeAmount'     => 1,
			'shapeAngle'      => 0,

			'shapeShuffle'    => 60,
			'radialStiffness' => 460,
			'edgeStiffness'   => 540,
			'bendStiffness'   => 170,
			'pressure'        => 2400,
			'damping'         => 9,
			'airDamping'      => 0.5,
			'magnetStrength'  => 2200,
			'magnetRange'     => 260,
			'magnetGrip'      => 0.24,
			'magnetDamping'   => 7,
			'floatAmplitude'  => 10,
			'floatSpeed'      => 1.1,
			'idleWobble'      => 0.085,
			'idleWobbleSpeed' => 0.55,
			'speedStretch'    => 0.3,
			'friction'        => 0.86,
			'restitution'     => 0.2,
			'dragStiffness'   => 480,
			'throwBoost'      => 1,
			'minStretch'      => 0.55,
			'maxStretch'      => 1.7,
			'minAngularGap'   => 0.25,
			'limitIterations' => 3,
			'dragMaxAccel'    => 9000,
			'subStep'         => 1 / 240,
			'maxSubSteps'     => 8,
		),
	);
}

function openstation_mio_config() {
	$defaults = openstation_mio_default_config();

	$config = apply_filters( 'openstation_mio_config', $defaults );

	return is_array( $config ) ? $config : $defaults;
}

function openstation_mio_look_appearance_keys() {
	return array(
		'radius',
		'bodyColor',
		'bodyAlpha',
		'hueStart',
		'hueSpan',
		'hueDrift',
		'hueLoop',
		'hueAngle',
		'hueSpin',
		'saturation',
		'lightness',
		'iridescence',
		'outlineWidth',
		'linerWidth',
		'linerColor',
		'glow',
		'glowBlur',
		'eyeColor',
		'eyeScale',
	);
}

function openstation_mio_look_physics_keys() {
	return array(
		'shapePreset',
		'shapeLobes',
		'shapeAmount',
		'shapeAngle',
		'shapeShuffle',
		'idleWobble',
		'idleWobbleSpeed',
	);
}

function openstation_mio_look_limits() {
	return array(
		'radius'          => array( 16, 220 ),
		'bodyAlpha'       => array( 0, 1 ),
		'hueStart'        => array( -720, 720 ),
		'hueSpan'         => array( -360, 360 ),
		'hueDrift'        => array( -180, 180 ),
		'hueAngle'        => array( -360, 360 ),
		'hueSpin'         => array( -180, 180 ),
		'saturation'      => array( 0, 1 ),
		'lightness'       => array( 0.15, 1 ),
		'iridescence'     => array( 0, 2 ),
		'outlineWidth'    => array( 0.5, 24 ),
		'linerWidth'      => array( 0, 12 ),
		'glow'            => array( 0, 20 ),
		'eyeScale'        => array( 0.05, 0.6 ),
		'shapeLobes'      => array( 0, 8 ),
		'shapeAmount'     => array( 0, 1.4 ),
		'shapeAngle'      => array( -360, 360 ),
		'shapeShuffle'    => array( 0, 3600 ),
		'idleWobble'      => array( 0, 0.4 ),
		'idleWobbleSpeed' => array( 0, 8 ),
	);
}

function openstation_mio_shape_presets() {
	return array(
		'circle',
		'blob',
		'ghost',
		'potato',
		'star',
		'flower',
		'heart',
		'diamond',
		'drop',
		'cloud',
		'custom',
	);
}

function openstation_mio_color_int( $candidate, $fallback = 0 ) {
	if ( is_int( $candidate ) || is_float( $candidate ) ) {
		if ( ! is_finite( (float) $candidate ) ) {
			return $fallback;
		}
		return (int) min( 0xffffff, max( 0, floor( $candidate ) ) );
	}
	if ( is_string( $candidate ) ) {
		$hex = ltrim( trim( $candidate ), '#' );
		if ( preg_match( '/^[0-9a-fA-F]{6}$/', $hex ) ) {
			return (int) hexdec( $hex );
		}
		if ( preg_match( '/^[0-9a-fA-F]{3}$/', $hex ) ) {
			return (int) hexdec( $hex[0] . $hex[0] . $hex[1] . $hex[1] . $hex[2] . $hex[2] );
		}
	}
	return $fallback;
}

function openstation_mio_clamp_look( $raw ) {
	$defaults = openstation_mio_default_config();
	$limits   = openstation_mio_look_limits();
	$look     = openstation_sanitize_mio_look( $raw );

	$resolve = static function ( $group, $overrides ) use ( $limits ) {
		$out = array();
		foreach ( $group as $key => $default ) {
			$value = array_key_exists( $key, $overrides ) ? $overrides[ $key ] : $default;

			if ( 'shapePreset' === $key ) {
				$presets      = openstation_mio_shape_presets();
				$out[ $key ] = in_array( $value, $presets, true ) ? $value : $default;
				continue;
			}
			if ( 'bodyColor' === $key || 'eyeColor' === $key || 'linerColor' === $key ) {
				$out[ $key ] = openstation_mio_color_int( $value, openstation_mio_color_int( $default ) );
				continue;
			}
			if ( is_bool( $default ) ) {
				$out[ $key ] = is_bool( $value ) ? $value : $default;
				continue;
			}
			if ( ! is_numeric( $value ) || ! is_finite( (float) $value ) ) {
				$value = $default;
			}
			if ( isset( $limits[ $key ] ) ) {
				$value = min( $limits[ $key ][1], max( $limits[ $key ][0], (float) $value ) );
			}
			$out[ $key ] = $value;
		}
		return $out;
	};

	$physics = $resolve( $defaults['physics'], $look['physics'] );

	$physics['shapeShuffle'] = 0;

	return array(
		'appearance' => $resolve( $defaults['appearance'], $look['appearance'] ),
		'physics'    => $physics,
	);
}

function openstation_sanitize_mio_look( $raw ) {
	$clean = array(
		'appearance' => array(),
		'physics'    => array(),
	);

	if ( ! is_array( $raw ) ) {
		return $clean;
	}

	$groups = array(
		'appearance' => openstation_mio_look_appearance_keys(),
		'physics'    => openstation_mio_look_physics_keys(),
	);

	foreach ( $groups as $group => $keys ) {
		if ( ! isset( $raw[ $group ] ) || ! is_array( $raw[ $group ] ) ) {
			continue;
		}
		foreach ( $keys as $key ) {
			if ( ! isset( $raw[ $group ][ $key ] ) ) {
				continue;
			}
			$value = $raw[ $group ][ $key ];
			if ( is_bool( $value ) ) {
				$clean[ $group ][ $key ] = $value;
			} elseif ( is_int( $value ) || is_float( $value ) ) {

				if ( is_finite( (float) $value ) ) {
					$clean[ $group ][ $key ] = 0 + $value;
				}
			} elseif ( is_string( $value ) ) {

				$clean[ $group ][ $key ] = sanitize_text_field( $value );
			}
		}
	}

	return $clean;
}

function openstation_mio_narrow_look( $raw ) {
	$look    = openstation_sanitize_mio_look( $raw );
	$clamped = openstation_mio_clamp_look( $look );
	$out     = array(
		'appearance' => array(),
		'physics'    => array(),
	);

	foreach ( array( 'appearance', 'physics' ) as $group ) {
		foreach ( array_keys( $look[ $group ] ) as $key ) {
			if ( array_key_exists( $key, $clamped[ $group ] ) ) {
				$out[ $group ][ $key ] = $clamped[ $group ][ $key ];
			}
		}
	}

	return $out;
}
