/**
 * Desktop Mode — Mio shared types.
 *
 * Split out of the implementation modules so the always-on shell
 * controller (`src/mio/controller.ts`, main bundle) and the lazy
 * PixiJS bundle (`src/mio/entry.ts`) agree on one contract without
 * the controller dragging the simulation into `desktop.min.js`.
 *
 * Everything here is data — no imports, no runtime. Third-party
 * plugins read these shapes off the public API
 * (`wp.desktop.mio`) and through the
 * `desktop-mode.mio.config` filter.
 */

/**
 * Visual identity of Mio: a near-black soft blob wrapped in a
 * neon "chroma" ring whose hue sweeps around the perimeter, with two
 * white pill eyes that track the pointer.
 *
 * @public
 */
export interface MioAppearance {
	/** Rest radius of the body, in CSS pixels. */
	radius: number;
	/** Body fill colour (24-bit RGB int). Near-black by design. */
	bodyColor: number;
	/** Body fill alpha. */
	bodyAlpha: number;
	/**
	 * Hue (degrees, 0–360) at the top of the ring. The chroma sweep
	 * runs clockwise from here through {@link hueSpan} degrees.
	 */
	hueStart: number;
	/**
	 * Degrees of hue traversed across the full perimeter. The
	 * reference design is a magenta → violet → blue sweep, i.e. a
	 * relatively narrow span rather than a full rainbow.
	 */
	hueSpan: number;
	/** Hue rotation, degrees per second. Keeps the ring alive. */
	hueDrift: number;
	/** Saturation of the ring, 0–1. */
	saturation: number;
	/** Lightness of the ring at its brightest point, 0–1. */
	lightness: number;
	/**
	 * Strength of the holographic response, `0`–`2`.
	 *
	 * `0` is a flat chroma ramp — the hue sweep and nothing else. Above
	 * that, the ring also colours by *viewing angle*: the hue shifts,
	 * a fine diffraction grating ripples around the perimeter, and a
	 * white-hot glint slides along the edge, all steered by the
	 * Mio's own motion. Values above `1` are deliberately
	 * over-driven.
	 */
	iridescence: number;
	/** Width of the crisp core stroke, in CSS pixels. */
	outlineWidth: number;
	/**
	 * Glow spread multiplier. `1` is the reference bloom; `0`
	 * disables the halo passes entirely (cheapest render).
	 */
	glow: number;
	/**
	 * Whether to run a `BlurFilter` over the halo passes. Softer, but
	 * costs a filter pass per frame — turned off automatically when
	 * the Pixi build in use has no `BlurFilter`.
	 */
	glowBlur: boolean;
	/** Eye fill colour (24-bit RGB int). */
	eyeColor: number;
	/** Eye height as a fraction of {@link radius}. */
	eyeScale: number;
}

/**
 * Named rest silhouettes. See {@link MioPhysics.shapePreset}.
 *
 * @public
 */
export type MioShapePreset =
	| 'circle'
	| 'blob'
	| 'ghost'
	| 'potato'
	| 'custom';

/**
 * Simulation constants. Exposed so a plugin can make Mio
 * heavier, bouncier, or stiffer without forking the bundle.
 *
 * @public
 */
export interface MioPhysics {
	/** Perimeter resolution — number of mass points on the rim. */
	points: number;
	/**
	 * Which silhouette Mio settles into.
	 *
	 * This is a *rest shape*, not a mask: it sets the length every
	 * spring family pulls toward, so Mio squashes, stretches,
	 * breathes and recovers exactly as a round one does — it just
	 * settles into this shape when nothing is acting on it.
	 *
	 * | Preset | Silhouette |
	 * |---|---|
	 * | `circle` | A perfect disc. |
	 * | `blob` | Nearly round, with a shallow dimple at the bottom centre. |
	 * | `ghost` | Dome top, straight sides, three scalloped feet. |
	 * | `potato` | Lumpy and asymmetric. No symmetry at all. |
	 * | `custom` | Built from {@link shapeLobes}: a rounded polygon. |
	 *
	 * Every preset is authored **upright**, so {@link shapeAngle} is a
	 * rotation on top rather than part of the definition.
	 */
	shapePreset: MioShapePreset;
	/**
	 * Corners in the rest shape when {@link shapePreset} is `custom`.
	 * `3` is a rounded triangle, `4` a rounded square, `0` or `1` a
	 * circle. Ignored by every other preset.
	 */
	shapeLobes: number;
	/**
	 * How strongly the silhouette departs from a circle. `0` is a
	 * circle whatever the preset; `1` is the preset as designed.
	 *
	 * For `custom`, "as designed" is the most cornered a *convex* shape
	 * can be: the profile `1 + a·cos(kθ)` has exactly zero curvature at
	 * its side midpoints when `a = 1/(1 + k²)`, so `1` gives dead
	 * straight sides between rounded corners. Past that the sides bow
	 * inward and the shape reads as a clover rather than a polygon,
	 * which is why the range runs a little beyond `1` but not far.
	 */
	shapeAmount: number;
	/**
	 * Rotation applied to the rest shape, in degrees clockwise from
	 * upright (screen coordinates, so `90` turns it a quarter turn to
	 * put what was the bottom on the left).
	 *
	 * The body never rotates on its own — rest angles are fixed in
	 * screen space — so this is a permanent orientation, not a starting
	 * one. `0` leaves every preset the way it was authored.
	 */
	shapeAngle: number;
	/**
	 * Seconds between Mio picking a new silhouette at random and
	 * morphing into it. `0` holds whatever {@link shapePreset} says.
	 *
	 * The change is a spring target, not a redraw: Mio eases from
	 * one shape to the next over a couple of seconds, and can be poked,
	 * dragged or thrown throughout without the transition breaking.
	 * `custom` is never picked — it is a shape someone configured on
	 * purpose, not one of the stock silhouettes.
	 */
	shapeShuffle: number;
	/** Radial spring constant (rim point ↔ core). */
	radialStiffness: number;
	/** Perimeter spring constant (rim point ↔ neighbour). */
	edgeStiffness: number;
	/** Bending spring constant (rim point ↔ neighbour-of-neighbour). */
	bendStiffness: number;
	/** Internal pressure — resists collapse, restores roundness. */
	pressure: number;
	/**
	 * Internal damping (per second) applied to each rim point's
	 * velocity *relative to the body core*. Damps the jiggle without
	 * air-braking Mio as a whole — higher is gooier, lower is
	 * wobblier.
	 */
	damping: number;
	/**
	 * Whole-body drag (per second). Bleeds off a throw so Mio
	 * glides to a stop instead of pinballing forever.
	 */
	airDamping: number;
	/**
	 * Attraction (px/s²) toward the nearest window at full strength.
	 *
	 * Windows are **magnets**, not ground: Mio is pulled to
	 * the closest point on the nearest window's edge from whatever
	 * direction it happens to be in, sticks there, and squashes
	 * against it. There is no global "down" — away from every window
	 * Mio simply floats.
	 */
	magnetStrength: number;
	/**
	 * How close (CSS px) a window has to be before its magnet starts
	 * to bite, measured edge-to-edge. Beyond this Mio floats
	 * freely.
	 */
	magnetRange: number;
	/**
	 * How hard the magnet holds Mio against a window, as a
	 * fraction of the body radius pressed into the surface. This is
	 * the resting position of the magnet spring, so it's also what
	 * sets the squash: `0` rests Mio exactly touching, with no
	 * deformation; `0.3` flattens it noticeably against the edge.
	 */
	magnetGrip: number;
	/**
	 * Contact damping (per second) while the magnet has hold. Kills
	 * the residual bounce and any tangential creep along the surface,
	 * so a stuck Mio reads as held rather than skating.
	 */
	magnetDamping: number;
	/** Amplitude (px) of the idle float bob. */
	floatAmplitude: number;
	/** Speed (radians/s) of the idle float bob. */
	floatSpeed: number;
	/**
	 * Idle wobble: how far the resting silhouette breathes, as a
	 * fraction of {@link MioAppearance.radius}.
	 *
	 * A floating Mio shouldn't be a perfect circle. Three slow
	 * spatial harmonics drift around the rim at incommensurable
	 * speeds, continuously tensing and releasing the shape springs,
	 * so the outline is always softly changing without ever settling
	 * into a visible loop. Fades out as a magnet takes hold — a
	 * Mio stuck to a window holds still.
	 */
	idleWobble: number;
	/** Speed (radians/s) of the idle wobble's slowest harmonic. */
	idleWobbleSpeed: number;
	/**
	 * Squash and stretch: how far the body elongates along its
	 * velocity when moving, as a fraction of the radius at full
	 * speed. The classic animation cue — drag Mio quickly and
	 * it draws out behind the cursor; let it settle and it rounds
	 * back off.
	 *
	 * Area-preserving: it stretches along the direction of travel and
	 * narrows across it by the reciprocal, so Mio never looks
	 * like it gained mass. `0` disables it.
	 */
	speedStretch: number;
	/** Tangential velocity retained on contact, 0–1. */
	friction: number;
	/** Normal velocity reflected on contact, 0–1. */
	restitution: number;
	/** Spring constant pulling the body toward the drag pointer. */
	dragStiffness: number;
	/**
	 * How much of the pointer's velocity Mio keeps when you
	 * let go. `1` throws it at exactly the speed your hand was
	 * moving; `0` drops it dead. Above `1` it out-runs your hand.
	 */
	throwBoost: number;
	/**
	 * Hard lower limit on every spring's length, as a fraction of its
	 * rest length. A spring may not be compressed past this no matter
	 * what force is applied — Mio cannot be crushed flat.
	 */
	minStretch: number;
	/**
	 * Hard upper limit on every spring's length, as a fraction of its
	 * rest length. A spring may not be stretched past this — the
	 * Mio cannot be pulled into a spike or torn open.
	 */
	maxStretch: number;
	/**
	 * Minimum angular gap between consecutive rim points, as a
	 * fraction of their even spacing (`2π / points`).
	 *
	 * Stops the outline folding back through itself — the failure
	 * that turns Mio into a permanent crescent, because a
	 * folded ring satisfies every distance-based constraint and so
	 * never recovers. Together with the stretch limits it guarantees
	 * a star-shaped, non-self-intersecting silhouette. `0` disables.
	 */
	minAngularGap: number;
	/**
	 * How many relaxation passes enforce {@link minStretch} /
	 * {@link maxStretch} per sub-step. One pass is usually enough;
	 * more converges harder when many limits are violated at once.
	 */
	limitIterations: number;
	/**
	 * Ceiling on the acceleration the drag spring may apply (px/s²).
	 *
	 * Without it the spring force grows without bound as the cursor
	 * pulls away from a body that can't follow — hold the pointer
	 * inside a window and Mio is pressed into the glass with
	 * arbitrary force until it flattens. Capped, it presses firmly
	 * and stops there.
	 */
	dragMaxAccel: number;
	/** Fixed simulation sub-step, in seconds. */
	subStep: number;
	/** Maximum sub-steps consumed per frame (runaway guard). */
	maxSubSteps: number;
}

/**
 * Full Mio configuration. Merged server → filter → mount.
 *
 * @public
 */
export interface MioConfig {
	appearance: MioAppearance;
	physics: MioPhysics;
}

/** Partial config as it arrives from PHP / a plugin filter. */
export type PartialMioConfig = {
	appearance?: Partial< MioAppearance >;
	physics?: Partial< MioPhysics >;
};

/**
 * Options the shell controller hands the lazy bundle at mount.
 *
 * @public
 */
export interface MioMountOptions {
	/** Layer element the Pixi canvas is appended to. Covers the shell. */
	host: HTMLElement;
	/** Resolved configuration. */
	config: MioConfig;
	/**
	 * Last saved position in **viewport** coordinates, or `null` for a
	 * first run (Mio picks a spot near the lower-inline edge).
	 */
	position: { x: number; y: number } | null;
	/** Persist a new resting position. Debounced by the caller. */
	savePosition: ( pos: { x: number; y: number } ) => void;
}

/**
 * What the lazy bundle hands back so the controller can drive and
 * eventually tear down Mio.
 *
 * @public
 */
export interface MioHandle {
	/** Current body centre, in viewport coordinates. */
	getPosition: () => { x: number; y: number };
	/** Teleport the body (keeps the soft-body deformation coherent). */
	setPosition: ( x: number, y: number ) => void;
	/** Pause / resume the simulation without unmounting. */
	setAnimating: ( animating: boolean ) => void;
	/** Live-apply a configuration change. */
	applyConfig: ( config: MioConfig ) => void;
	/** Destroy the Pixi app, listeners, and DOM. Idempotent. */
	destroy: () => void;
}

/** Global published by the lazy Mio bundle. */
export type MioMountFn = (
	options: MioMountOptions,
) => Promise< MioHandle | null >;

declare global {
	interface Window {
		/**
		 * Published by `assets/js/mio[.min].js`. The shell-side
		 * controller script-injects that bundle and calls this.
		 */
		desktopModeMountMio?: MioMountFn;
	}
}
