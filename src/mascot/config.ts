/**
 * Desktop Mode — Mascot configuration defaults + sanitizer.
 *
 * The mascot's look and physics are configurable from three places,
 * highest priority last:
 *
 *   1. {@link MASCOT_DEFAULTS} — the reference design.
 *   2. PHP — `desktop_mode_mascot_config` filter, shipped in the
 *      shell config as `desktopModeConfig.mascot`.
 *   3. JS — the `desktop-mode.mascot.config` filter, applied by the
 *      controller right before mount.
 *
 * Every value that reaches the simulation goes through
 * {@link sanitizeMascotConfig} first: a plugin returning a negative
 * radius or 4,000 rim points should get a clamped mascot, not a
 * hung tab.
 */

import type {
	MascotAppearance,
	MascotConfig,
	MascotPhysics,
	PartialMascotConfig,
} from './types';

/**
 * The reference mascot: a black blob with a magenta→violet neon ring
 * and two white pill eyes.
 */
export const MASCOT_DEFAULTS: MascotConfig = {
	appearance: {
		radius: 52,
		bodyColor: 0x05050a,
		bodyAlpha: 1,
		// Hot magenta at the top of the ring sweeping through violet
		// into blue at the bottom — the reference gradient.
		hueStart: 310,
		hueSpan: -80,
		hueDrift: 6,
		saturation: 1,
		lightness: 0.66,
		outlineWidth: 4.5,
		glow: 1,
		glowBlur: true,
		eyeColor: 0xffffff,
		eyeScale: 0.3,
	},
	physics: {
		points: 34,
		// Deliberately soft and SLOW. Spring frequency is √k, so
		// these set how fast the outline chases the shape underneath
		// it: at k≈500 the rim answers at ~3.5 Hz, which reads as a
		// gel settling. Triple them and the same motion becomes a
		// 6-plus-Hz buzz — technically the same simulation, visually
		// a shiver.
		radialStiffness: 460,
		edgeStiffness: 540,
		bendStiffness: 170,
		pressure: 2400,
		// The companion to the above: enough internal damping that
		// the rim is closer to critically damped than to ringing.
		// Low damping here is what reads as "too many springs".
		damping: 9,
		airDamping: 0.5,
		magnetStrength: 2200,
		magnetRange: 260,
		magnetGrip: 0.24,
		magnetDamping: 7,
		floatAmplitude: 10,
		floatSpeed: 1.1,
		idleWobble: 0.085,
		idleWobbleSpeed: 0.55,
		speedStretch: 0.3,
		friction: 0.86,
		restitution: 0.2,
		dragStiffness: 480,
		throwBoost: 1,
		minStretch: 0.55,
		maxStretch: 1.7,
		minAngularGap: 0.25,
		limitIterations: 3,
		dragMaxAccel: 9000,
		subStep: 1 / 240,
		maxSubSteps: 8,
	},
};

/** Hard bounds. Anything outside is clamped, never rejected. */
const LIMITS = {
	radius: [ 16, 220 ],
	bodyAlpha: [ 0, 1 ],
	hueStart: [ -720, 720 ],
	hueSpan: [ -360, 360 ],
	hueDrift: [ -180, 180 ],
	saturation: [ 0, 1 ],
	lightness: [ 0.15, 1 ],
	outlineWidth: [ 0.5, 24 ],
	glow: [ 0, 3 ],
	eyeScale: [ 0.05, 0.6 ],
	points: [ 12, 128 ],
	radialStiffness: [ 0, 2000 ],
	edgeStiffness: [ 0, 4000 ],
	bendStiffness: [ 0, 2000 ],
	pressure: [ 0, 8000 ],
	damping: [ 0, 30 ],
	airDamping: [ 0, 20 ],
	magnetStrength: [ 0, 8000 ],
	magnetRange: [ 0, 2000 ],
	magnetGrip: [ 0, 0.6 ],
	magnetDamping: [ 0, 40 ],
	floatAmplitude: [ 0, 200 ],
	floatSpeed: [ 0, 20 ],
	idleWobble: [ 0, 0.4 ],
	idleWobbleSpeed: [ 0, 8 ],
	speedStretch: [ 0, 0.8 ],
	friction: [ 0, 1 ],
	restitution: [ 0, 1 ],
	dragStiffness: [ 1, 4000 ],
	throwBoost: [ 0, 4 ],
	minStretch: [ 0.1, 1 ],
	maxStretch: [ 1, 4 ],
	minAngularGap: [ 0, 0.9 ],
	limitIterations: [ 0, 8 ],
	dragMaxAccel: [ 100, 200000 ],
	subStep: [ 1 / 1000, 1 / 30 ],
	maxSubSteps: [ 1, 32 ],
} as const satisfies Record< string, readonly [ number, number ] >;

/**
 * Clamp a numeric candidate into a known range, falling back to
 * `fallback` when the candidate isn't a finite number.
 */
function num(
	candidate: unknown,
	fallback: number,
	range: readonly [ number, number ],
): number {
	if ( typeof candidate !== 'number' || ! Number.isFinite( candidate ) ) {
		return fallback;
	}
	return Math.min( range[ 1 ], Math.max( range[ 0 ], candidate ) );
}

/** Coerce a colour candidate into a 24-bit RGB int. */
function color( candidate: unknown, fallback: number ): number {
	if ( typeof candidate === 'number' && Number.isFinite( candidate ) ) {
		return Math.min( 0xffffff, Math.max( 0, Math.floor( candidate ) ) );
	}
	if ( typeof candidate === 'string' ) {
		const hex = candidate.trim().replace( /^#/, '' );
		if ( /^[0-9a-fA-F]{6}$/.test( hex ) ) {
			return Number.parseInt( hex, 16 );
		}
		if ( /^[0-9a-fA-F]{3}$/.test( hex ) ) {
			const [ r, g, b ] = hex.split( '' );
			return Number.parseInt( `${ r }${ r }${ g }${ g }${ b }${ b }`, 16 );
		}
	}
	return fallback;
}

/** Coerce a boolean candidate, preserving the default when absent. */
function bool( candidate: unknown, fallback: boolean ): boolean {
	return typeof candidate === 'boolean' ? candidate : fallback;
}

/**
 * Merge an untrusted partial config over the defaults and clamp every
 * field. Always returns a complete, safe {@link MascotConfig}.
 */
export function sanitizeMascotConfig(
	raw: unknown,
	base: MascotConfig = MASCOT_DEFAULTS,
): MascotConfig {
	const partial: PartialMascotConfig =
		raw && typeof raw === 'object' && ! Array.isArray( raw )
			? ( raw as PartialMascotConfig )
			: {};
	const a = partial.appearance ?? {};
	const p = partial.physics ?? {};

	const appearance: MascotAppearance = {
		radius: num( a.radius, base.appearance.radius, LIMITS.radius ),
		bodyColor: color( a.bodyColor, base.appearance.bodyColor ),
		bodyAlpha: num( a.bodyAlpha, base.appearance.bodyAlpha, LIMITS.bodyAlpha ),
		hueStart: num( a.hueStart, base.appearance.hueStart, LIMITS.hueStart ),
		hueSpan: num( a.hueSpan, base.appearance.hueSpan, LIMITS.hueSpan ),
		hueDrift: num( a.hueDrift, base.appearance.hueDrift, LIMITS.hueDrift ),
		saturation: num(
			a.saturation,
			base.appearance.saturation,
			LIMITS.saturation,
		),
		lightness: num( a.lightness, base.appearance.lightness, LIMITS.lightness ),
		outlineWidth: num(
			a.outlineWidth,
			base.appearance.outlineWidth,
			LIMITS.outlineWidth,
		),
		glow: num( a.glow, base.appearance.glow, LIMITS.glow ),
		glowBlur: bool( a.glowBlur, base.appearance.glowBlur ),
		eyeColor: color( a.eyeColor, base.appearance.eyeColor ),
		eyeScale: num( a.eyeScale, base.appearance.eyeScale, LIMITS.eyeScale ),
	};

	const physics: MascotPhysics = {
		// Rim resolution is rounded — a fractional point count would
		// break the neighbour indexing in the soft body.
		points: Math.round( num( p.points, base.physics.points, LIMITS.points ) ),
		radialStiffness: num(
			p.radialStiffness,
			base.physics.radialStiffness,
			LIMITS.radialStiffness,
		),
		edgeStiffness: num(
			p.edgeStiffness,
			base.physics.edgeStiffness,
			LIMITS.edgeStiffness,
		),
		bendStiffness: num(
			p.bendStiffness,
			base.physics.bendStiffness,
			LIMITS.bendStiffness,
		),
		pressure: num( p.pressure, base.physics.pressure, LIMITS.pressure ),
		damping: num( p.damping, base.physics.damping, LIMITS.damping ),
		airDamping: num(
			p.airDamping,
			base.physics.airDamping,
			LIMITS.airDamping,
		),
		magnetStrength: num(
			p.magnetStrength,
			base.physics.magnetStrength,
			LIMITS.magnetStrength,
		),
		magnetRange: num(
			p.magnetRange,
			base.physics.magnetRange,
			LIMITS.magnetRange,
		),
		magnetGrip: num( p.magnetGrip, base.physics.magnetGrip, LIMITS.magnetGrip ),
		magnetDamping: num(
			p.magnetDamping,
			base.physics.magnetDamping,
			LIMITS.magnetDamping,
		),
		floatAmplitude: num(
			p.floatAmplitude,
			base.physics.floatAmplitude,
			LIMITS.floatAmplitude,
		),
		floatSpeed: num( p.floatSpeed, base.physics.floatSpeed, LIMITS.floatSpeed ),
		idleWobble: num( p.idleWobble, base.physics.idleWobble, LIMITS.idleWobble ),
		idleWobbleSpeed: num(
			p.idleWobbleSpeed,
			base.physics.idleWobbleSpeed,
			LIMITS.idleWobbleSpeed,
		),
		speedStretch: num(
			p.speedStretch,
			base.physics.speedStretch,
			LIMITS.speedStretch,
		),
		friction: num( p.friction, base.physics.friction, LIMITS.friction ),
		restitution: num(
			p.restitution,
			base.physics.restitution,
			LIMITS.restitution,
		),
		dragStiffness: num(
			p.dragStiffness,
			base.physics.dragStiffness,
			LIMITS.dragStiffness,
		),
		throwBoost: num( p.throwBoost, base.physics.throwBoost, LIMITS.throwBoost ),
		// The two ranges are deliberately disjoint around 1 — a floor
		// is at most the rest length, a ceiling is at least it — so
		// they can never cross and hand the relaxation pass a pair of
		// unsatisfiable limits to oscillate between.
		minStretch: num( p.minStretch, base.physics.minStretch, LIMITS.minStretch ),
		maxStretch: num( p.maxStretch, base.physics.maxStretch, LIMITS.maxStretch ),
		minAngularGap: num(
			p.minAngularGap,
			base.physics.minAngularGap,
			LIMITS.minAngularGap,
		),
		dragMaxAccel: num(
			p.dragMaxAccel,
			base.physics.dragMaxAccel,
			LIMITS.dragMaxAccel,
		),
		limitIterations: Math.round(
			num(
				p.limitIterations,
				base.physics.limitIterations,
				LIMITS.limitIterations,
			),
		),
		subStep: num( p.subStep, base.physics.subStep, LIMITS.subStep ),
		maxSubSteps: Math.round(
			num( p.maxSubSteps, base.physics.maxSubSteps, LIMITS.maxSubSteps ),
		),
	};

	return { appearance, physics };
}
