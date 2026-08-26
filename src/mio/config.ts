/**
 * OpenStation — Mio configuration defaults + sanitizer.
 *
 * Mio's look and physics are configurable from three places,
 * highest priority last:
 *
 *   1. {@link MIO_DEFAULTS} — the reference design.
 *   2. PHP — `openstation_mio_config` filter, shipped in the
 *      shell config as `openStationConfig.mio`.
 *   3. JS — the `os.mio.config` filter, applied by the
 *      controller right before mount.
 *
 * Every value that reaches the simulation goes through
 * {@link sanitizeMioConfig} first: a plugin returning a negative
 * radius or 4,000 rim points should get a clamped Mio, not a
 * hung tab.
 */

import type {
	MioAppearance,
	MioConfig,
	MioPhysics,
	MioShapePreset,
	PartialMioConfig,
} from './types';

/**
 * The reference Mio, wearing the brand: a Void blob ringed in Miomesh
 * — Pulse through violet into blue — with two Starlight pill eyes.
 * Every colour here is derived from the OpenStation brand guidelines
 * and pinned by `tests/vitest/mio-brand-fidelity.test.ts`; see
 * "Mio wears the brand" in `docs/mio.md` before retuning any of them.
 */
export const MIO_DEFAULTS: MioConfig = {
	appearance: {
		radius: 56,
		/*
		 * Void, the palette's base — not `#000000`.
		 *
		 * The brand's own Mio is `fill="none"`: a stroked outline with
		 * no body at all, drawn over the Void page. The shell cannot
		 * copy that, because Mio floats over whatever wallpaper the
		 * user picked and a transparent body would show it through. So
		 * the body is filled with the colour the artwork's own
		 * background is. Pure black is not in the palette.
		 */
		bodyColor: 0x0c0b0f,
		bodyAlpha: 1,
		/*
		 * Read off Miomesh, Mio's own gradient in the OpenStation brand
		 * guidelines — `assets/miomesh.svg`, and the `mioGrad` the
		 * mascot on that page is stroked with. Four stops:
		 *
		 *   #F252FC  hue 296.5  Pulse    at the gradient's start
		 *   #AA67FF  hue 266.4  violet   48% along
		 *   #A580FF  hue 257.5  violet   71% along
		 *   #4B3EFF  hue 244.0  blue     at the end
		 *
		 * so the sweep is 296.5 → 244, a span of −52.5. Two numbers
		 * reproduce four stops here because the brand's own ramp is
		 * near-linear in hue: the middle pair land within ~5° of where
		 * this puts them.
		 *
		 * **Pulse belongs at the upper left.** `mioGrad` runs
		 * `(0%,10%) → (90%,100%)`, so its start sits on the upper-left
		 * shoulder and its end on the lower-right. `hueAngle` is where
		 * `hueStart` is pinned, in degrees clockwise from 3 o'clock —
		 * upper-left is 225.
		 */
		hueStart: 296.5,
		hueSpan: -52.5,
		hueAngle: 225,
		// The official Mio holds still. `hueLoop` is what lets it: a
		// straight ramp ends a span away from where it started, and
		// with no rotation to keep that seam moving it just sits there.
		/*
		 * Both still, and they are not the same kind of still.
		 *
		 * `hueDrift` rewrites the hues, so Mio cycles through colours
		 * that are not its own — that is the one thing the official
		 * palette must never do. `hueSpin` turns the same
		 * magenta→violet→blue sweep around the ring, which keeps the
		 * palette exactly and is the most a default Mio should ever
		 * animate. Shipped at zero to match the artwork; the panel has
		 * a slider for anyone who wants the ring to turn.
		 */
		hueDrift: 0,
		hueSpin: 0,
		hueLoop: true,
		// Miomesh's stops run 0.966–1. Pulse is the only one under
		// full, by three hundredths, which is not a difference anything
		// downstream could show.
		saturation: 1,
		/*
		 * The *brightest* point of the ring, not its average:
		 * `chromaRing` rides a cosine hump over this, from `0.72 ×` on
		 * the shaded side to `1 ×` on the lit one.
		 *
		 * So this is Miomesh's brightest stop, `#A580FF` at `0.751`.
		 * At the old `0.66` the whole ring rendered below the brand —
		 * `0.475`–`0.661` against Miomesh's `0.622`–`0.751`, every part
		 * of it darker than the darkest stop of the gradient it was
		 * supposed to be reproducing.
		 */
		lightness: 0.75,
		/*
		 * Off, because the brand's Mio has no hologram: Miomesh is a
		 * flat four-stop gradient, and this is the value that
		 * reproduces it. Zero also switches off the interior sheen,
		 * which the artwork likewise doesn't have.
		 *
		 * The effect is not gone, just not the default — "Make it
		 * yours" has a slider, and one number here brings it back for a
		 * whole site.
		 */
		iridescence: 0,
		// The artwork strokes its ring at 13 units on a body of roughly
		// 240 — 5.4%, which at this radius is 3px.
		outlineWidth: 3,
		// Reach of the light, as a multiple of Mio's own radius (see
		// `GLOW_REACH` in `render.ts`): `10` carries the wash about one
		// and a half radii past the outline.
		//
		// Deliberately generous. `mio.svg` is a flat piece of artwork
		// on white and its own glow is a pair of soft washes at 34%;
		// the shell puts Mio on a dark desk, where the glow is the
		// thing that makes her read as lit rather than drawn. The
		// slider runs to `20` from here.
		//
		// Must match `openstation_mio_config()` in `includes/mio.php`.
		glow: 10,
		glowBlur: true,
		// Starlight, the palette's white — what the brand's own mascot
		// fills its two eye pills with. `#ffffff` is not in the
		// palette; Starlight is a hair warm of it.
		eyeColor: 0xfffbff,
		eyeScale: 0.3,
	},
	physics: {
		// The rim is a simulation resolution, not a drawing one: the
		// renderer resamples it into a smooth curve, so points beyond
		// what the shape needs buy nothing but per-frame cost and a
		// busier, twitchier silhouette.
		points: 12,
		// Nearly round, with a shallow dimple at the bottom centre and a
		// little extra fullness at the lower left and right — the
		// reference silhouette. `idleWobble` supplies the asymmetry that
		// keeps it from looking constructed.
		shapePreset: 'blob',
		// Only read by the `custom` preset.
		shapeLobes: 3,
		shapeAmount: 1,
		shapeAngle: 0,
		// Restless by design: a companion that is exactly the same shape
		// every time you look at it stops being a companion.
		shapeShuffle: 60,
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
	hueAngle: [ -360, 360 ],
	hueSpin: [ -180, 180 ],
	saturation: [ 0, 1 ],
	lightness: [ 0.15, 1 ],
	iridescence: [ 0, 2 ],
	outlineWidth: [ 0.5, 24 ],
	// Reach is a multiple of Mio's radius now, not of the outline
	// width, so the ceiling had to move: the old `3` used to mean
	// "three times a stroke that could itself be 24 px", and on its own
	// it barely clears the ring. At `20` the halo carries a little over
	// three radii past the outline, which is as much light as a desk
	// companion should be throwing before it starts lighting the
	// wallpaper more than itself.
	glow: [ 0, 20 ],
	eyeScale: [ 0.05, 0.6 ],
	points: [ 12, 128 ],
	shapeLobes: [ 0, 8 ],
	shapeAmount: [ 0, 1.4 ],
	shapeAngle: [ -360, 360 ],
	shapeShuffle: [ 0, 3600 ],
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

/** Every silhouette {@link MioPhysics.shapePreset} accepts. */
const SHAPE_PRESETS: readonly MioShapePreset[] = [
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
];

/**
 * Coerce a shape preset.
 *
 * Unknown names fall back rather than throwing, in keeping with the
 * rest of the sanitizer: a plugin naming a preset we removed — or one
 * from a newer build — should get the shipped silhouette, not Mio
 * that fails to mount.
 */
function preset(
	candidate: unknown,
	fallback: MioShapePreset,
): MioShapePreset {
	return SHAPE_PRESETS.includes( candidate as MioShapePreset )
		? ( candidate as MioShapePreset )
		: fallback;
}

/**
 * Merge an untrusted partial config over the defaults and clamp every
 * field. Always returns a complete, safe {@link MioConfig}.
 */
export function sanitizeMioConfig(
	raw: unknown,
	base: MioConfig = MIO_DEFAULTS,
): MioConfig {
	const partial: PartialMioConfig =
		raw && typeof raw === 'object' && ! Array.isArray( raw )
			? ( raw as PartialMioConfig )
			: {};
	const a = partial.appearance ?? {};
	const p = partial.physics ?? {};

	const appearance: MioAppearance = {
		radius: num( a.radius, base.appearance.radius, LIMITS.radius ),
		bodyColor: color( a.bodyColor, base.appearance.bodyColor ),
		bodyAlpha: num( a.bodyAlpha, base.appearance.bodyAlpha, LIMITS.bodyAlpha ),
		hueStart: num( a.hueStart, base.appearance.hueStart, LIMITS.hueStart ),
		hueSpan: num( a.hueSpan, base.appearance.hueSpan, LIMITS.hueSpan ),
		hueDrift: num( a.hueDrift, base.appearance.hueDrift, LIMITS.hueDrift ),
		hueLoop: bool( a.hueLoop, base.appearance.hueLoop ),
		hueAngle: num( a.hueAngle, base.appearance.hueAngle, LIMITS.hueAngle ),
		hueSpin: num( a.hueSpin, base.appearance.hueSpin, LIMITS.hueSpin ),
		saturation: num(
			a.saturation,
			base.appearance.saturation,
			LIMITS.saturation,
		),
		lightness: num( a.lightness, base.appearance.lightness, LIMITS.lightness ),
		iridescence: num(
			a.iridescence,
			base.appearance.iridescence,
			LIMITS.iridescence,
		),
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

	const physics: MioPhysics = {
		// Rim resolution is rounded — a fractional point count would
		// break the neighbour indexing in the soft body.
		points: Math.round( num( p.points, base.physics.points, LIMITS.points ) ),
		shapePreset: preset( p.shapePreset, base.physics.shapePreset ),
		// Lobes are rounded for the same reason: the profile is
		// evaluated as `cos( lobes · θ )`, and a fractional lobe count
		// would leave the rest shape discontinuous where the ring
		// closes — a permanent kink the springs would fight forever.
		shapeLobes: Math.round(
			num( p.shapeLobes, base.physics.shapeLobes, LIMITS.shapeLobes ),
		),
		shapeAmount: num(
			p.shapeAmount,
			base.physics.shapeAmount,
			LIMITS.shapeAmount,
		),
		shapeAngle: num( p.shapeAngle, base.physics.shapeAngle, LIMITS.shapeAngle ),
		shapeShuffle: num(
			p.shapeShuffle,
			base.physics.shapeShuffle,
			LIMITS.shapeShuffle,
		),
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
