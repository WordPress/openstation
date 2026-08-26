<?php
/**
 * OpenStation — Mio.
 *
 * Server side of the desk companion: the appearance / physics
 * defaults shipped to the shell, and the filter plugins use to
 * restyle or re-tune it.
 *
 * Mio itself is a lazy JS bundle (`assets/js/mio[.min].js`)
 * that the shell injects the first time a user switches it on from
 * the wallpaper context menu. Nothing here enqueues anything — the
 * bundle URL travels in the shell config as `mioBundleUrl`, and
 * the on/off preference lives in OS Settings as `mioEnabled`.
 *
 * Every value is re-clamped client-side in
 * `src/mio/config.ts::sanitizeMioConfig()`, so a filter that
 * returns nonsense produces a plain-looking Mio rather than a
 * broken shell.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Mio's shipped look and feel, before any filter.
 *
 * Split out of {@see openstation_mio_config()} so a consumer that is
 * NOT the current user's own companion can start from the reference
 * design. An agent's portrait is exactly that: `openstation_mio_config`
 * is a filter about the desk companion this person sees, and letting it
 * silently restyle every agent's face on the site would be a surprise
 * with no way to opt out.
 *
 * Shape mirrors `MIO_DEFAULTS` in `src/mio/config.ts`, and
 * `tests/vitest/mio-defaults-parity.test.ts` holds the two together.
 *
 * @return array Mio configuration.
 */
function openstation_mio_default_config() {
	return array(
		'appearance' => array(
			'radius'       => 56,
			// Void, the palette's base. The brand's own Mio is
			// `fill="none"` over the Void page; the shell floats over
			// whatever wallpaper the user picked, so it fills the body
			// with the colour that background is. Not '#000000', which
			// is not in the palette.
			'bodyColor'    => '#0c0b0f',
			'bodyAlpha'    => 1,
			// Read off Miomesh, Mio's own gradient in the OpenStation
			// brand guidelines: four stops from #F252FC (Pulse, hue
			// 296.5) through #AA67FF and #A580FF to #4B3EFF (hue 244).
			// `hueAngle` pins Pulse where `mioGrad` starts, on the
			// upper-left shoulder — 225 degrees clockwise from 3
			// o'clock.
			'hueStart'     => 296.5,
			'hueSpan'      => -52.5,
			'hueAngle'     => 225,
			// The official Mio holds still; hueLoop is what lets it,
			// by walking the span out and back so the ring meets
			// itself instead of ending a span away with a visible seam.
			// Two kinds of still. hueDrift rewrites the hues, so Mio
			// cycles through colours that are not its own — the one
			// thing the official palette must never do. hueSpin turns
			// the same sweep around the ring, keeping the palette, and
			// is the most a default Mio should ever animate.
			'hueDrift'     => 0,
			'hueSpin'      => 0,
			'hueLoop'      => true,
			'saturation'   => 1,
			// The ring's brightest point, not its average — the
			// renderer rides a cosine hump from 0.72x to 1x over this.
			// Miomesh's brightest stop, #A580FF, is 0.751.
			'lightness'    => 0.75,
			// The official artwork has no hologram and no interior
			// sheen — a flat gradient over dead black. One number here
			// turns both back on for a whole site.
			'iridescence'  => 0,
			'outlineWidth' => 3,
			// Reach of the light, as a multiple of Mio's own radius:
			// `10` carries the wash about one and a half radii past the
			// outline. Deliberately generous — Mio sits on a dark desk
			// and the glow is the thing that makes her read as lit
			// rather than drawn. The slider runs to `20`.
			//
			// Must match `MIO_DEFAULTS` in `src/mio/config.ts`; this is
			// the value the shell renders before a user has a look of
			// their own, and the two disagreeing means Mio changes
			// appearance the first time anything is saved.
			'glow'         => 10,
			// No UI switches this off. Each glow pass is a ramp of
			// concentric shells, and unblurred that ramp shows as the
			// contour rings it is built from. It is here so a site that
			// needs the two filter passes back for performance can drop
			// them.
			'glowBlur'     => true,
			// Starlight, the palette's white — what the brand's mascot
			// fills its two eye pills with. Not '#ffffff'.
			'eyeColor'     => '#fffbff',
			'eyeScale'     => 0.3,
		),
		'physics'    => array(
			'points'          => 12,
			// Silhouette: 'circle', 'blob', 'ghost', 'potato' or
			// 'custom'. Nearly round, with a shallow dimple at the
			// bottom centre.
			'shapePreset'     => 'blob',
			// Only read by the 'custom' preset.
			'shapeLobes'      => 3,
			'shapeAmount'     => 1,
			'shapeAngle'      => 0,
			// Seconds between Mio picking a new silhouette at
			// random and morphing into it. 0 holds shapePreset.
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

/**
 * Returns Mio configuration for the current user.
 *
 * Shape mirrors `MioConfig` in `src/mio/types.ts`:
 *
 *     array(
 *         'appearance' => array( radius, bodyColor, bodyAlpha, hueStart,
 *                                hueSpan, hueDrift, hueLoop, hueAngle,
 *                                saturation, lightness, iridescence,
 *                                outlineWidth, glow, glowBlur,
 *                                eyeColor, eyeScale ),
 *         'physics'    => array( points, shapePreset, shapeLobes,
 *                                shapeAmount, shapeAngle, shapeShuffle,
 *                                radialStiffness, edgeStiffness,
 *                                bendStiffness, pressure, damping,
 *                                airDamping, magnetStrength, magnetRange,
 *                                magnetGrip, magnetDamping, floatAmplitude,
 *                                floatSpeed, idleWobble, idleWobbleSpeed,
 *                                speedStretch, friction, restitution,
 *                                dragStiffness, throwBoost, minStretch,
 *                                maxStretch, minAngularGap,
 *                                limitIterations, dragMaxAccel, subStep,
 *                                maxSubSteps ),
 *     )
 *
 * Colours may be given as integers (`0x05050a`) or CSS hex strings
 * (`'#05050a'`); the client accepts both.
 *
 * @return array Mio configuration.
 */
function openstation_mio_config() {
	$defaults = openstation_mio_default_config();

	/**
	 * Filters Mio's appearance and physics.
	 *
	 * Runs once per shell render. Returning a partial array is fine —
	 * anything missing falls back to the reference design, and every
	 * value is clamped client-side before it reaches the simulation.
	 *
	 * Example — a slower, heavier, teal mio:
	 *
	 *     add_filter( 'openstation_mio_config', function ( $config ) {
	 *         $config['appearance']['hueStart']      = 170;
	 *         $config['appearance']['hueSpan']       = 40;
	 *         $config['physics']['magnetStrength']   = 3400;
	 *         return $config;
	 *     } );
	 *
	 * @param array $defaults Default configuration, as documented above.
	 */
	$config = apply_filters( 'openstation_mio_config', $defaults );

	return is_array( $config ) ? $config : $defaults;
}

/**
 * Appearance keys a stored user look may carry.
 *
 * Mirrors `APPEARANCE_KEYS` in `src/mio/look.ts`. A whitelist rather
 * than "whatever the client sent", because this lands in user meta:
 * an unbounded key set is an unbounded row.
 *
 * @return string[]
 */
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
		'glow',
		'glowBlur',
		'eyeColor',
		'eyeScale',
	);
}

/**
 * Physics keys a stored user look may carry.
 *
 * Mirrors `LOOK_PHYSICS_KEYS` in `src/mio/look.ts`. Every one of them
 * modulates a rest length. The spring constants are deliberately
 * absent: they are the site's, they interact, and a stored preference
 * that could reach them would be a way for a corrupt row to make Mio
 * unstable.
 *
 * @return string[]
 */
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

/**
 * Numeric ranges every look value is held inside.
 *
 * Mirrors `LIMITS` in `src/mio/config.ts`, and exists for the same
 * reason the client one does: the shipped values are a design, not a
 * boundary, and everything downstream of them assumes a sane number.
 *
 * Only the keys a stored look may carry are listed. The rest of
 * `MioPhysics` is spring constants the panel deliberately never
 * exposes.
 *
 * @return array<string, array{0: float, 1: float}>
 */
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

/**
 * Every silhouette `shapePreset` accepts. Mirrors `SHAPE_PRESETS`.
 *
 * @return string[]
 */
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

/**
 * Coerce a colour to a 24-bit int. Mirrors `color()` in `config.ts`.
 *
 * The shipped defaults write colours as CSS hex strings because that is
 * what reads well in a config array; the renderers want integers.
 *
 * @param mixed $candidate Colour as int or `#rrggbb` / `#rgb` string.
 * @param int   $fallback  Value to use when the candidate is unusable.
 * @return int Packed 24-bit colour.
 */
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

/**
 * Hold a look inside its ranges and resolve it against the defaults.
 *
 * `openstation_sanitize_mio_look()` is a SHAPE check: right keys,
 * right kinds. That was enough while every look was handed straight to
 * the client, where `sanitizeMioConfig()` clamped it before anything
 * drew with it. It is not enough now. A stored look reaches a PHP
 * renderer that samples trigonometry and builds a path, so an
 * `outlineWidth` of -400 or a `shapeAmount` of 1e9 arrives as a number
 * nobody checked.
 *
 * The result is a COMPLETE config with integer colours, ready to draw:
 * unlike the sanitizer, this is not what you store.
 *
 * `shapeShuffle` is dropped rather than clamped. It means "pick a new
 * silhouette every so often", which is meaningless in a still portrait
 * and would be a bug if anything ever honoured it there.
 *
 * @param mixed $raw Stored look, or anything at all.
 * @return array Complete `array( 'appearance' => ..., 'physics' => ... )`.
 */
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
			if ( 'bodyColor' === $key || 'eyeColor' === $key ) {
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
	// A face that changed silhouette on a timer is not a portrait.
	$physics['shapeShuffle'] = 0;

	return array(
		'appearance' => $resolve( $defaults['appearance'], $look['appearance'] ),
		'physics'    => $physics,
	);
}

/**
 * Sanitizes a user's saved Mio look for storage in user meta.
 *
 * **A shape check, not a clamp.** It answers "are these the right keys
 * carrying the right kinds of value" and nothing more. Deciding what a
 * legal hue, silhouette or spring constant is stays with
 * `sanitizeMioConfig()` in `src/mio/config.ts`, which runs on
 * everything headed for the simulation whatever route it arrived by.
 * Two validators with overlapping opinions about ranges is how ranges
 * drift apart.
 *
 * Only the keys the user actually changed are kept, so a site that
 * later ships a different Mio still shows through everywhere its users
 * have no opinion.
 *
 * @param mixed $raw Raw look from the client or user meta.
 * @return array {
 *     @type array $appearance Partial appearance overrides.
 *     @type array $physics    Partial silhouette + idle overrides.
 * }
 */
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
				// Reject non-finite floats outright: they survive JSON
				// round-trips as `null` and would land in the blob as a
				// key the client then has to defend against.
				if ( is_finite( (float) $value ) ) {
					$clean[ $group ][ $key ] = 0 + $value;
				}
			} elseif ( is_string( $value ) ) {
				// The only string-valued keys are `shapePreset` and the
				// two colours in `#rrggbb` form.
				$clean[ $group ][ $key ] = sanitize_text_field( $value );
			}
		}
	}

	return $clean;
}

/**
 * Narrow a partial look to the keys it carried, with every number in range.
 *
 * Two passes that answer different questions.
 * {@see openstation_sanitize_mio_look()} asks "are these the right keys
 * carrying the right kinds of value", and keeps only what was actually
 * set. {@see openstation_mio_clamp_look()} then asks "is every number
 * inside its range", because a stored look now reaches a PHP renderer
 * that samples trigonometry and builds a path. The clamp resolves
 * against the defaults and hands back a *complete* config, which is
 * what you draw with and not what you store, so the carried keys are
 * picked back out of it afterwards.
 *
 * Keeping only the overridden keys is what lets a future change to the
 * shipped Mio still show through wherever nobody had an opinion.
 *
 * Lives here rather than beside the agent store because two callers on
 * different sides of the feature flag need it: the store, when an agent
 * saves a face, and the WP Explorer config, when the flag is off and
 * the section previews the cast it would seed. One owner of the rule
 * means the preview cannot draw a face the seeder would not store.
 *
 * @param mixed $raw Raw look (array), from the client or from our own data.
 * @return array {
 *     @type array $appearance Clamped appearance overrides.
 *     @type array $physics    Clamped silhouette + idle overrides.
 * }
 */
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
