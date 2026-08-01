<?php
/**
 * Desktop Mode — Mascot.
 *
 * Server side of the desk companion: the appearance / physics
 * defaults shipped to the shell, and the filter plugins use to
 * restyle or re-tune it.
 *
 * The mascot itself is a lazy JS bundle (`assets/js/mascot[.min].js`)
 * that the shell injects the first time a user switches it on from
 * the wallpaper context menu. Nothing here enqueues anything — the
 * bundle URL travels in the shell config as `mascotBundleUrl`, and
 * the on/off preference lives in OS Settings as `mascotEnabled`.
 *
 * Every value is re-clamped client-side in
 * `src/mascot/config.ts::sanitizeMascotConfig()`, so a filter that
 * returns nonsense produces a plain-looking mascot rather than a
 * broken shell.
 *
 * @package WPDesktopMode
 */

defined( 'ABSPATH' ) || exit;

/**
 * Returns the mascot configuration for the current user.
 *
 * Shape mirrors `MascotConfig` in `src/mascot/types.ts`:
 *
 *     array(
 *         'appearance' => array( radius, bodyColor, bodyAlpha, hueStart,
 *                                hueSpan, hueDrift, saturation, lightness,
 *                                iridescence, outlineWidth, glow, glowBlur,
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
 * @return array Mascot configuration.
 */
function desktop_mode_mascot_config() {
	$defaults = array(
		'appearance' => array(
			'radius'       => 56,
			'bodyColor'    => '#03030a',
			'bodyAlpha'    => 1,
			// Blue at the lower right, magenta at the upper left.
			'hueStart'     => 235,
			'hueSpan'      => 125,
			'hueDrift'     => 6,
			'saturation'   => 1,
			'lightness'    => 0.75,
			'iridescence'  => 0.7,
			'outlineWidth' => 2,
			'glow'         => 3,
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
			// Seconds between the mascot picking a new silhouette at
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
	 * Filters the mascot's appearance and physics.
	 *
	 * Runs once per shell render. Returning a partial array is fine —
	 * anything missing falls back to the reference design, and every
	 * value is clamped client-side before it reaches the simulation.
	 *
	 * Example — a slower, heavier, teal mascot:
	 *
	 *     add_filter( 'desktop_mode_mascot_config', function ( $config ) {
	 *         $config['appearance']['hueStart']      = 170;
	 *         $config['appearance']['hueSpan']       = 40;
	 *         $config['physics']['magnetStrength']   = 3400;
	 *         return $config;
	 *     } );
	 *
	 * @param array $defaults Default configuration, as documented above.
	 */
	$config = apply_filters( 'desktop_mode_mascot_config', $defaults );

	return is_array( $config ) ? $config : $defaults;
}
