/**
 * Desktop Mode — Mascot shared types.
 *
 * Split out of the implementation modules so the always-on shell
 * controller (`src/mascot/controller.ts`, main bundle) and the lazy
 * PixiJS bundle (`src/mascot/entry.ts`) agree on one contract without
 * the controller dragging the simulation into `desktop.min.js`.
 *
 * Everything here is data — no imports, no runtime. Third-party
 * plugins read these shapes off the public API
 * (`wp.desktop.mascot`) and through the
 * `desktop-mode.mascot.config` filter.
 */

/**
 * Visual identity of the mascot: a near-black soft blob wrapped in a
 * neon "chroma" ring whose hue sweeps around the perimeter, with two
 * white pill eyes that track the pointer.
 *
 * @public
 */
export interface MascotAppearance {
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
	 * mascot's own motion. Values above `1` are deliberately
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
 * Simulation constants. Exposed so a plugin can make the mascot
 * heavier, bouncier, or stiffer without forking the bundle.
 *
 * @public
 */
export interface MascotPhysics {
	/** Perimeter resolution — number of mass points on the rim. */
	points: number;
	/**
	 * Corners in the mascot's rest shape. `3` is a rounded triangle,
	 * `4` a rounded square, `0` or `1` a circle.
	 *
	 * This is a *rest shape*, not a mask: it sets the length every
	 * spring family pulls toward, so the mascot squashes, stretches,
	 * breathes and recovers exactly as before — it just settles into a
	 * triangle instead of a disc.
	 */
	shapeLobes: number;
	/**
	 * How pronounced the corners are, as a fraction of the flat-sided
	 * limit.
	 *
	 * `0` is a circle. `1` is the most cornered a *convex* shape can
	 * be: the profile `1 + a·cos(kθ)` has exactly zero curvature at
	 * its side midpoints when `a = 1/(1 + k²)`, so `1` gives dead
	 * straight sides between rounded corners. Past that the sides bow
	 * inward and the shape reads as a clover rather than a polygon,
	 * which is why the range runs a little beyond `1` but not far.
	 */
	shapeAmount: number;
	/**
	 * Which way the rest shape's first corner points, in degrees,
	 * clockwise from the 3 o'clock direction (screen coordinates, so
	 * `90` is straight down).
	 *
	 * The body never rotates — rest angles are fixed in screen space —
	 * so this is the shape's permanent orientation. The default puts a
	 * corner at the top and a flat side along the bottom, which is
	 * both the most triangle-like reading and the one that rests
	 * neatly on the top edge of a window.
	 */
	shapeAngle: number;
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
	 * air-braking the mascot as a whole — higher is gooier, lower is
	 * wobblier.
	 */
	damping: number;
	/**
	 * Whole-body drag (per second). Bleeds off a throw so the mascot
	 * glides to a stop instead of pinballing forever.
	 */
	airDamping: number;
	/**
	 * Attraction (px/s²) toward the nearest window at full strength.
	 *
	 * Windows are **magnets**, not ground: the mascot is pulled to
	 * the closest point on the nearest window's edge from whatever
	 * direction it happens to be in, sticks there, and squashes
	 * against it. There is no global "down" — away from every window
	 * the mascot simply floats.
	 */
	magnetStrength: number;
	/**
	 * How close (CSS px) a window has to be before its magnet starts
	 * to bite, measured edge-to-edge. Beyond this the mascot floats
	 * freely.
	 */
	magnetRange: number;
	/**
	 * How hard the magnet holds the mascot against a window, as a
	 * fraction of the body radius pressed into the surface. This is
	 * the resting position of the magnet spring, so it's also what
	 * sets the squash: `0` rests the mascot exactly touching, with no
	 * deformation; `0.3` flattens it noticeably against the edge.
	 */
	magnetGrip: number;
	/**
	 * Contact damping (per second) while the magnet has hold. Kills
	 * the residual bounce and any tangential creep along the surface,
	 * so a stuck mascot reads as held rather than skating.
	 */
	magnetDamping: number;
	/** Amplitude (px) of the idle float bob. */
	floatAmplitude: number;
	/** Speed (radians/s) of the idle float bob. */
	floatSpeed: number;
	/**
	 * Idle wobble: how far the resting silhouette breathes, as a
	 * fraction of {@link MascotAppearance.radius}.
	 *
	 * A floating mascot shouldn't be a perfect circle. Three slow
	 * spatial harmonics drift around the rim at incommensurable
	 * speeds, continuously tensing and releasing the shape springs,
	 * so the outline is always softly changing without ever settling
	 * into a visible loop. Fades out as a magnet takes hold — a
	 * mascot stuck to a window holds still.
	 */
	idleWobble: number;
	/** Speed (radians/s) of the idle wobble's slowest harmonic. */
	idleWobbleSpeed: number;
	/**
	 * Squash and stretch: how far the body elongates along its
	 * velocity when moving, as a fraction of the radius at full
	 * speed. The classic animation cue — drag the mascot quickly and
	 * it draws out behind the cursor; let it settle and it rounds
	 * back off.
	 *
	 * Area-preserving: it stretches along the direction of travel and
	 * narrows across it by the reciprocal, so the mascot never looks
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
	 * How much of the pointer's velocity the mascot keeps when you
	 * let go. `1` throws it at exactly the speed your hand was
	 * moving; `0` drops it dead. Above `1` it out-runs your hand.
	 */
	throwBoost: number;
	/**
	 * Hard lower limit on every spring's length, as a fraction of its
	 * rest length. A spring may not be compressed past this no matter
	 * what force is applied — the mascot cannot be crushed flat.
	 */
	minStretch: number;
	/**
	 * Hard upper limit on every spring's length, as a fraction of its
	 * rest length. A spring may not be stretched past this — the
	 * mascot cannot be pulled into a spike or torn open.
	 */
	maxStretch: number;
	/**
	 * Minimum angular gap between consecutive rim points, as a
	 * fraction of their even spacing (`2π / points`).
	 *
	 * Stops the outline folding back through itself — the failure
	 * that turns the mascot into a permanent crescent, because a
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
	 * inside a window and the mascot is pressed into the glass with
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
 * Full mascot configuration. Merged server → filter → mount.
 *
 * @public
 */
export interface MascotConfig {
	appearance: MascotAppearance;
	physics: MascotPhysics;
}

/** Partial config as it arrives from PHP / a plugin filter. */
export type PartialMascotConfig = {
	appearance?: Partial< MascotAppearance >;
	physics?: Partial< MascotPhysics >;
};

/**
 * Options the shell controller hands the lazy bundle at mount.
 *
 * @public
 */
export interface MascotMountOptions {
	/** Layer element the Pixi canvas is appended to. Covers the shell. */
	host: HTMLElement;
	/** Resolved configuration. */
	config: MascotConfig;
	/**
	 * Last saved position in **viewport** coordinates, or `null` for a
	 * first run (the mascot picks a spot near the lower-inline edge).
	 */
	position: { x: number; y: number } | null;
	/** Persist a new resting position. Debounced by the caller. */
	savePosition: ( pos: { x: number; y: number } ) => void;
}

/**
 * What the lazy bundle hands back so the controller can drive and
 * eventually tear down the mascot.
 *
 * @public
 */
export interface MascotHandle {
	/** Current body centre, in viewport coordinates. */
	getPosition: () => { x: number; y: number };
	/** Teleport the body (keeps the soft-body deformation coherent). */
	setPosition: ( x: number, y: number ) => void;
	/** Pause / resume the simulation without unmounting. */
	setAnimating: ( animating: boolean ) => void;
	/** Live-apply a configuration change. */
	applyConfig: ( config: MascotConfig ) => void;
	/** Destroy the Pixi app, listeners, and DOM. Idempotent. */
	destroy: () => void;
}

/** Global published by the lazy mascot bundle. */
export type MascotMountFn = (
	options: MascotMountOptions,
) => Promise< MascotHandle | null >;

declare global {
	interface Window {
		/**
		 * Published by `assets/js/mascot[.min].js`. The shell-side
		 * controller script-injects that bundle and calls this.
		 */
		desktopModeMountMascot?: MascotMountFn;
	}
}
