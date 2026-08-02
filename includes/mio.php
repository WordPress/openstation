<?php
/**
 * Desktop Mode — Mio.
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
 * @package WPDesktopMode
 */

defined( 'ABSPATH' ) || exit;

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
function desktop_mode_mio_config() {
	$defaults = array(
		'appearance' => array(
			'radius'       => 56,
			'bodyColor'    => '#000000',
			'bodyAlpha'    => 1,
			// Read off the official `mio.svg`: a three-stop gradient
			// from #EF42E8 (hue 302) through #AA67FF to #5E8BFF
			// (hue 223), on an axis about 23 degrees off horizontal.
			'hueStart'     => 302,
			'hueSpan'      => -79,
			'hueAngle'     => 23,
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
			'lightness'    => 0.66,
			// The official artwork has no hologram and no interior
			// sheen — a flat gradient over dead black. One number here
			// turns both back on for a whole site.
			'iridescence'  => 0,
			'outlineWidth' => 3,
			// The artwork's glow is a pair of soft radial washes at 34%
			// opacity, not a neon bloom hugging the ring.
			'glow'         => 1,
			'glowBlur'     => true,
			'eyeColor'     => '#ffffff',
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

	/**
	 * Filters Mio's appearance and physics.
	 *
	 * Runs once per shell render. Returning a partial array is fine —
	 * anything missing falls back to the reference design, and every
	 * value is clamped client-side before it reaches the simulation.
	 *
	 * Example — a slower, heavier, teal mio:
	 *
	 *     add_filter( 'desktop_mode_mio_config', function ( $config ) {
	 *         $config['appearance']['hueStart']      = 170;
	 *         $config['appearance']['hueSpan']       = 40;
	 *         $config['physics']['magnetStrength']   = 3400;
	 *         return $config;
	 *     } );
	 *
	 * @param array $defaults Default configuration, as documented above.
	 */
	$config = apply_filters( 'desktop_mode_mio_config', $defaults );

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
function desktop_mode_mio_look_appearance_keys() {
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
function desktop_mode_mio_look_physics_keys() {
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
function desktop_mode_sanitize_mio_look( $raw ) {
	$clean = array(
		'appearance' => array(),
		'physics'    => array(),
	);

	if ( ! is_array( $raw ) ) {
		return $clean;
	}

	$groups = array(
		'appearance' => desktop_mode_mio_look_appearance_keys(),
		'physics'    => desktop_mode_mio_look_physics_keys(),
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
