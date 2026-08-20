/**
 * OpenStation — Mio soft body.
 *
 * A pressurised mass-spring ring. `points` particles sit on a circle
 * and are wired together by three families of springs plus an
 * internal gas term:
 *
 *   - **Edge** (rim ↔ next rim) — surface tension; stops the rim
 *     from tearing open.
 *   - **Bend** (rim ↔ rim+2) — resists sharp creases, so a hard
 *     landing dents the blob instead of folding it.
 *   - **Shape** (rim ↔ centroid) — pulls every point back toward the
 *     rest radius, restoring roundness after a squash.
 *   - **Pressure** — an outward push proportional to how much area
 *     the polygon has lost against its rest area. This is what makes
 *     Mio *pancake outward* when it lands on a window rather
 *     than simply flattening into a line.
 *
 * **Why there is no core particle.** The obvious model — a heavy
 * centre mass with radial springs out to the rim — is bistable. Land
 * the blob hard enough and the centre punches through the contact
 * plane; the rim clamps on the window's top edge, the centre settles
 * *below* it, and the radial springs are perfectly happy there (a
 * hanging-bob equilibrium). Mio ends up as a dome welded to
 * the window edge and never recovers. Deriving the centre from the
 * rim instead — classic shape matching — removes the second
 * equilibrium entirely: there is no independent centre left to
 * invert.
 *
 * Because the centroid is derived, the shape and pressure terms
 * would inject spurious net momentum on an asymmetric silhouette, so
 * their mean is projected out before integration. Only genuinely
 * external accelerations (gravity, the idle float, the drag spring)
 * move the body as a whole.
 *
 * Integration is semi-implicit (symplectic) Euler over fixed
 * sub-steps: unconditionally stable at the stiffnesses we ship and,
 * unlike a variable-dt integrator, it produces the same squash for
 * the same landing regardless of frame rate.
 *
 * Damping is split deliberately. `physics.damping` acts on each
 * point's velocity **relative to the body's mean velocity**, so the
 * jiggle settles while the body keeps its momentum;
 * `physics.airDamping` acts on everything, so a throw eventually
 * comes to rest. One combined constant would make Mio feel
 * like it was falling through syrup.
 *
 * Pure and DOM-free: the renderer reads the resulting point cloud,
 * the tests drive it headlessly.
 */

import {
	clampToBounds,
	resolveObstacleCollisions,
	type MagnetPull,
	type Obstacle,
	type Particle,
} from './environment';
import type { MioPhysics } from './types';

/**
 * Speed (px/s) at which `physics.speedStretch` is fully applied.
 * Below it the stretch scales linearly, so a slow drag deforms the
 * Mio slightly and a fast flick deforms it fully.
 */
const STRETCH_FULL_SPEED = 1200;

/**
 * Width of the bump-stop zone around each hard limit, as a multiple
 * of the limit. `1.25` starts braking a point once it is within 25%
 * of its floor (or ceiling) and brakes harder the closer it gets.
 */
const BUMP_ZONE = 1.25;

/** One rim particle. `angle` is its rest position around the ring. */
export interface RimPoint extends Particle {
	angle: number;
}

/** Complete Mio body state. */
export interface SoftBody {
	/**
	 * Derived centre of mass — Mio's "position". Recomputed
	 * from the rim after every sub-step; writing to it does nothing.
	 * Use {@link translateBody} to move Mio.
	 */
	core: Particle;
	/** Rim particles, ordered counter-clockwise in screen space. */
	rim: RimPoint[];
	/** Rest radius. */
	radius: number;
	/**
	 * Rest silhouette as a multiplier on {@link radius}, so the body
	 * re-forms the right shape rather than a disc. `undefined` is a
	 * circle.
	 */
	profile?: ( angle: number ) => number;
	/** Rest area of the rim polygon, for the pressure term. */
	restArea: number;
	/** Seconds of simulated time, drives the idle float. */
	elapsed: number;
	/** Left-over frame time not yet consumed by a sub-step. */
	accumulator: number;
}

import { TAU, presetRimPoints, shapeProfile } from './shape';

// The rest shapes live in `shape.ts` so a still portrait can use them
// without dragging the simulation (and `environment.ts` behind it) in.
// Re-exported here because this is where callers have always found
// them.
export { presetRimPoints, shapeProfile };

/**
 * Build a body at rest, centred on `(cx, cy)`.
 *
 * `profile` is the rest silhouette — pass {@link shapeProfile} bound
 * to the live physics config so the body is *born* the right shape.
 * Leaving it out builds a disc, which the springs would then have to
 * pull into shape over the first few hundred milliseconds: fine for a
 * test, visible as a morph at boot and after every escape hop.
 */
export function createSoftBody(
	cx: number,
	cy: number,
	radius: number,
	count: number,
	profile?: ( angle: number ) => number,
): SoftBody {
	const n = Math.max( 3, Math.round( count ) );
	const rim: RimPoint[] = [];
	for ( let i = 0; i < n; i++ ) {
		const angle = ( i / n ) * Math.PI * 2;
		const r = radius * ( profile ? profile( angle ) : 1 );
		rim.push( {
			angle,
			x: cx + Math.cos( angle ) * r,
			y: cy + Math.sin( angle ) * r,
			vx: 0,
			vy: 0,
		} );
	}
	return {
		core: { x: cx, y: cy, vx: 0, vy: 0 },
		rim,
		radius,
		profile,
		// Area of the regular n-gon inscribed in the rest circle —
		// NOT πr². Using the circle's area would leave the polygon
		// permanently under-inflated and the pressure term would push
		// forever.
		restArea: 0.5 * n * radius * radius * Math.sin( ( 2 * Math.PI ) / n ),
		elapsed: 0,
		accumulator: 0,
	};
}

/**
 * Change the rim resolution of a live body, in place, without losing
 * its pose.
 *
 * The counterpart to {@link presetRimPoints}: a silhouette that needs
 * forty mass points has to be able to get them *while Mio is on the
 * desk*, mid-morph, possibly mid-throw. Rebuilding the body instead
 * would drop the current deformation, the velocities and the
 * accumulated float phase on the floor — a visible pop, and exactly
 * the "it re-formed itself" artefact the morph exists to avoid.
 *
 * New points are interpolated around the existing ring and then
 * **corrected back onto the outline's own radius**. That correction is
 * the whole trick: a plain lerp puts new points on the chords between
 * old ones, which shrinks the body a little every time it is
 * resampled, and a shape that shuffles all day would deflate. Lerping
 * the radius separately and re-projecting is exact for a circle and
 * within a fraction of a pixel for anything else.
 *
 * @param body  Body to resample. Mutated.
 * @param count Desired number of rim points; clamped to at least 3.
 */
export function resampleBody( body: SoftBody, count: number ): void {
	const n = Math.max( 3, Math.round( count ) );
	const old = body.rim;
	const from = old.length;
	if ( n === from || from < 3 ) {
		return;
	}
	syncCore( body );
	const cx = body.core.x;
	const cy = body.core.y;

	const radius = ( p: Particle ): number => Math.hypot( p.x - cx, p.y - cy );

	const rim: RimPoint[] = new Array( n );
	for ( let i = 0; i < n; i++ ) {
		const u = ( i / n ) * from;
		const lo = Math.floor( u );
		const t = u - lo;
		const a = old[ lo % from ];
		const b = old[ ( lo + 1 ) % from ];
		let x = a.x + ( b.x - a.x ) * t;
		let y = a.y + ( b.y - a.y ) * t;
		// Re-project onto the interpolated radius. Skip it at the
		// centroid, where the direction is undefined and the point has
		// nowhere to be pushed to anyway.
		const dist = Math.hypot( x - cx, y - cy );
		if ( dist > 1e-6 ) {
			const want = radius( a ) + ( radius( b ) - radius( a ) ) * t;
			x = cx + ( ( x - cx ) / dist ) * want;
			y = cy + ( ( y - cy ) / dist ) * want;
		}
		rim[ i ] = {
			angle: ( i / n ) * TAU,
			x,
			y,
			vx: a.vx + ( b.vx - a.vx ) * t,
			vy: a.vy + ( b.vy - a.vy ) * t,
		};
	}

	body.rim = rim;
	// The rest area is the inscribed n-gon's, so it moves with the
	// resolution even though the body has not changed size. Leave it
	// stale and the pressure term inflates or deflates Mio to match a
	// polygon it no longer is.
	body.restArea =
		0.5 * n * body.radius * body.radius * Math.sin( ( 2 * Math.PI ) / n );
	syncCore( body );
}

/** Signed area of the rim polygon (shoelace). */
export function polygonArea( rim: readonly Particle[] ): number {
	let area = 0;
	for ( let i = 0; i < rim.length; i++ ) {
		const a = rim[ i ];
		const b = rim[ ( i + 1 ) % rim.length ];
		area += a.x * b.y - b.x * a.y;
	}
	return area / 2;
}

/** Mean of the rim points — the visual centre of the deformed blob. */
export function rimCentroid( rim: readonly Particle[] ): { x: number; y: number } {
	let x = 0;
	let y = 0;
	for ( const p of rim ) {
		x += p.x;
		y += p.y;
	}
	const n = rim.length || 1;
	return { x: x / n, y: y / n };
}

/** Recompute `body.core` (position + velocity) from the rim. */
export function syncCore( body: SoftBody ): void {
	let x = 0;
	let y = 0;
	let vx = 0;
	let vy = 0;
	for ( const p of body.rim ) {
		x += p.x;
		y += p.y;
		vx += p.vx;
		vy += p.vy;
	}
	const n = body.rim.length || 1;
	body.core.x = x / n;
	body.core.y = y / n;
	body.core.vx = vx / n;
	body.core.vy = vy / n;
}

/**
 * Teleport the whole body so its centroid lands on `(x, y)`,
 * preserving the current deformation.
 */
export function translateBody( body: SoftBody, x: number, y: number ): void {
	// Resync first: callers (and tests) may have poked the rim
	// directly since the last step, in which case the cached centre
	// is stale and the body would land off-target.
	syncCore( body );
	const dx = x - body.core.x;
	const dy = y - body.core.y;
	for ( const p of body.rim ) {
		p.x += dx;
		p.y += dy;
	}
	syncCore( body );
}

/**
 * Add a velocity to the whole body, preserving its deformation.
 *
 * Used to throw Mio on release: the drag spring alone leaves
 * it with whatever velocity the spring happened to have, which is
 * always less than the hand's. Injecting the pointer's own velocity
 * is what makes a flick feel like a flick.
 */
export function addVelocity( body: SoftBody, vx: number, vy: number ): void {
	for ( const p of body.rim ) {
		p.vx += vx;
		p.vy += vy;
	}
	syncCore( body );
}

/**
 * Snap the body back to its clean rest shape at `(x, y)`, at rest.
 *
 * The recovery path for Mio a window opened on top of: by the
 * time we notice, the contact solver has been pushing opposite sides
 * of the rim toward opposite faces and the silhouette is mangled.
 * Re-forming is both cheaper and better-looking than trying to
 * relax it out.
 */
export function resetBody( body: SoftBody, x: number, y: number ): void {
	const n = body.rim.length;
	for ( let i = 0; i < n; i++ ) {
		const p = body.rim[ i ];
		const r = body.radius * ( body.profile ? body.profile( p.angle ) : 1 );
		p.x = x + Math.cos( p.angle ) * r;
		p.y = y + Math.sin( p.angle ) * r;
		p.vx = 0;
		p.vy = 0;
	}
	body.accumulator = 0;
	syncCore( body );
}

/** Per-frame inputs to {@link stepSoftBody}. */
export interface StepInput {
	physics: MioPhysics;
	/**
	 * Pull toward the nearest window, or `null` when the desk is
	 * empty around Mio and it should float.
	 */
	magnet: MagnetPull | null;
	/** Live obstacle set in layer coordinates. */
	obstacles: readonly Obstacle[];
	/** Layer size; the body is clamped inside it. */
	bounds: { width: number; height: number };
	/**
	 * Pointer target while the user is dragging Mio, in layer
	 * coordinates. `null` when not dragging.
	 */
	dragTarget: { x: number; y: number } | null;
}

/**
 * Advance the simulation by `frameSeconds` of wall-clock time.
 *
 * Time is consumed in fixed `physics.subStep` slices from an
 * accumulator, capped at `physics.maxSubSteps` per call so a
 * backgrounded tab that returns with a two-second delta doesn't
 * freeze the frame catching up.
 */
export function stepSoftBody(
	body: SoftBody,
	frameSeconds: number,
	input: StepInput,
): void {
	const { physics } = input;
	const dt = physics.subStep;
	// A negative, NaN, or absurd frame delta (tab restore, clock
	// skew) is clamped rather than trusted.
	const safe = Number.isFinite( frameSeconds ) ? frameSeconds : 0;
	const frame = Math.min( Math.max( safe, 0 ), dt * physics.maxSubSteps );
	body.accumulator += frame;

	let steps = 0;
	while ( body.accumulator >= dt && steps < physics.maxSubSteps ) {
		body.accumulator -= dt;
		steps++;
		substep( body, dt, input );
	}
	// Guard against an accumulator that can never drain (e.g. the
	// caller feeding huge deltas every frame).
	if ( body.accumulator > dt * physics.maxSubSteps ) {
		body.accumulator = 0;
	}
	syncCore( body );
}

/** One fixed-dt integration slice. */
function substep( body: SoftBody, dt: number, input: StepInput ): void {
	const { physics, obstacles, bounds, dragTarget } = input;
	const rim = body.rim;
	const n = rim.length;

	body.elapsed += dt;
	syncCore( body );
	const centre = body.core;

	// How strongly a window has hold of us, 0–1. Hoisted because it
	// gates both the external pull below and the idle wobble in the
	// shape springs: Mio clamped to a window should sit still
	// against it, not keep breathing.
	const pull = input.magnet;
	const strength = pull ? Math.min( 1, Math.max( 0, pull.strength ) ) : 0;
	const float = 1 - strength;
	// Being carried also stills the idle wobble — while the user has
	// hold of it the deformation should read as the drag, not as
	// ambient breathing.
	const wobbleFade = input.dragTarget ? 0 : float;

	// Internal accelerations (shape + pressure + edge + bend). Kept
	// separate from the external ones because their mean is projected
	// out below — internal forces must not translate the body.
	const ix = new Float64Array( n );
	const iy = new Float64Array( n );

	// --- Rest shape. --------------------------------------------------
	//
	// The rest radius isn't constant. Its base is the *rest profile* —
	// `shapeLobes` / `shapeAmount` / `shapeAngle`, a rounded polygon —
	// and `idleWobble` breathes on top of that, per
	// point, so a floating Mio is never a perfect circle. Three
	// spatial harmonics (2, 3 and 5 lobes) drift around the rim at
	// incommensurable temporal frequencies, which means the springs
	// are continuously tensing and releasing and the silhouette never
	// repeats a pose. Modulating the *rest length* rather than
	// displacing the points keeps it a real physical effect — a poke
	// or a landing still overrides it, and it settles back.
	//
	// CRITICAL: every spring family reads its rest length from this
	// same wobbled shape. Breathe the shape springs alone and the
	// edge springs go on defending the original perimeter, the two
	// fight at their natural frequency, and the outline buzzes
	// instead of breathing. One target shape, three families
	// agreeing on it.
	// The body's own profile wins when it has one. That indirection is
	// what lets the runtime morph between two silhouettes: it hands the
	// body a blend of both, and every spring family follows the blend
	// without knowing a transition is happening.
	const restR = new Float64Array( n );
	const shape = body.profile;
	for ( let i = 0; i < n; i++ ) {
		const a = rim[ i ].angle;
		restR[ i ] = body.radius * ( shape ? shape( a ) : shapeProfile( a, physics ) );
	}

	const wobble = physics.idleWobble * wobbleFade;
	if ( wobble > 0 ) {
		const t = physics.idleWobbleSpeed * body.elapsed;
		for ( let i = 0; i < n; i++ ) {
			const a = rim[ i ].angle;
			const breathe =
				0.55 * Math.sin( 2 * a + t ) +
				0.3 * Math.sin( 3 * a - t * 1.37 + 2.1 ) +
				0.15 * Math.sin( 5 * a + t * 0.71 + 4.2 );
			restR[ i ] *= 1 + wobble * breathe;
		}
	}

	// Squash and stretch. The rest shape becomes an ellipse elongated
	// along the direction of travel and narrowed across it by the
	// reciprocal — area-preserving, so Mio yanked across the
	// desk draws out behind the cursor without appearing to gain
	// mass, and rounds back off as it slows.
	//
	// The alignment is taken from each point's REST angle, not its
	// current position: reading the deformed geometry would feed the
	// stretch back into itself and the shape would run away.
	if ( physics.speedStretch > 0 ) {
		const speed = Math.hypot( centre.vx, centre.vy );
		if ( speed > 1 ) {
			const amount =
				physics.speedStretch * Math.min( 1, speed / STRETCH_FULL_SPEED );
			const k = 1 + amount;
			const kk = k * k;
			const dirX = centre.vx / speed;
			const dirY = centre.vy / speed;
			for ( let i = 0; i < n; i++ ) {
				const angle = rim[ i ].angle;
				// cos of the angle between this point and the heading.
				const a = Math.cos( angle ) * dirX + Math.sin( angle ) * dirY;
				const aa = a * a;
				// Polar radius of an ellipse with semi-axes k and 1/k.
				restR[ i ] /= Math.sqrt( aa / kk + kk * ( 1 - aa ) );
			}
		}
	}

	// Target area of the rest shape, exactly: the star polygon
	// through (restR_i, angle_i) with equally-spaced angles. Reduces
	// to `body.restArea` when nothing is deforming it, and — because
	// the stretch above is area-preserving — barely moves under it,
	// which is the point. A fixed target would have the gas fighting
	// the very shape the springs are asking for.
	let targetArea = 0;
	for ( let i = 0; i < n; i++ ) {
		targetArea += restR[ i ] * restR[ ( i + 1 ) % n ];
	}
	targetArea *= 0.5 * Math.sin( ( 2 * Math.PI ) / n );

	// --- Shape springs: rim ↔ centroid. -----------------------------
	if ( physics.radialStiffness > 0 ) {
		for ( let i = 0; i < n; i++ ) {
			const p = rim[ i ];
			let dx = p.x - centre.x;
			let dy = p.y - centre.y;
			let len = Math.hypot( dx, dy );
			if ( len < 1e-6 ) {
				// Degenerate — push the point back toward its rest
				// angle so the direction is defined next sub-step.
				dx = Math.cos( p.angle );
				dy = Math.sin( p.angle );
				len = 1;
			}
			const f = physics.radialStiffness * ( len - restR[ i ] );
			ix[ i ] -= ( f * dx ) / len;
			iy[ i ] -= ( f * dy ) / len;
		}
	}

	// --- Edge + bend springs. ---------------------------------------
	// Chord between two rim points `stride` apart on the wobbled
	// shape: `(rᵢ + rⱼ) · sin(stride·π/n)`, which collapses to the
	// familiar `2r·sin(…)` when the two radii agree.
	applyRingSprings(
		rim,
		ix,
		iy,
		1,
		restR,
		Math.sin( Math.PI / n ),
		physics.edgeStiffness,
	);
	if ( n > 4 && physics.bendStiffness > 0 ) {
		applyRingSprings(
			rim,
			ix,
			iy,
			2,
			restR,
			Math.sin( ( 2 * Math.PI ) / n ),
			physics.bendStiffness,
		);
	}

	// --- Pressure. ---------------------------------------------------
	// `restArea / area - 1` is positive when the blob has been
	// squashed; the gas pushes every EDGE along its own outward
	// normal. Clamped so a near-degenerate polygon can't produce an
	// infinite kick.
	//
	// The normals have to come from the edges, not from
	// "point minus centroid". A radial formulation looks equivalent
	// and silently kills Mio: squash the blob flat and every
	// radial direction becomes horizontal, so a fully collapsed
	// sliver is a perfect equilibrium of the shape springs, the edge
	// springs, the bend springs AND radial pressure at once —
	// gravity walks the body into it and it never comes back up.
	// Edge normals survive the degenerate case, because the top and
	// bottom chains of a flat sliver are traversed in opposite
	// directions and so push apart.
	if ( physics.pressure > 0 ) {
		const signed = polygonArea( rim );
		const area = Math.abs( signed );
		const deficit = Math.min(
			2,
			Math.max( -1, targetArea / Math.max( area, 1e-3 ) - 1 ),
		);
		if ( deficit !== 0 ) {
			// Orient normals off the current winding so a body that
			// briefly turns itself inside out still inflates outward.
			const wind = signed < 0 ? -1 : 1;
			// Normalised by the nominal edge length so `pressure`
			// keeps the same meaning at any rim resolution.
			const nominalEdge = 2 * body.radius * Math.sin( Math.PI / n );
			const push =
				( physics.pressure * deficit * wind ) / ( 2 * nominalEdge );
			for ( let i = 0; i < n; i++ ) {
				const a = rim[ i ];
				const b = rim[ ( i + 1 ) % n ];
				const dx = b.x - a.x;
				const dy = b.y - a.y;
				// Outward normal of a positively-wound edge is
				// (dy, -dx); scaling by the edge length (rather than
				// normalising) is what makes this a pressure — force
				// proportional to the area it acts on.
				const fx = dy * push;
				const fy = -dx * push;
				ix[ i ] += fx;
				iy[ i ] += fy;
				ix[ ( i + 1 ) % n ] += fx;
				iy[ ( i + 1 ) % n ] += fy;
			}
		}
	}

	// Project out the net internal acceleration. Edge and bend
	// springs already cancel pairwise; the centroid-referenced shape
	// and pressure terms don't, and an asymmetric silhouette would
	// otherwise self-propel across the desk.
	let meanIx = 0;
	let meanIy = 0;
	for ( let i = 0; i < n; i++ ) {
		meanIx += ix[ i ];
		meanIy += iy[ i ];
	}
	meanIx /= n;
	meanIy /= n;

	// ---------------------------------------------------------------
	// External acceleration.
	//
	// Windows are magnets, not ground: the pull points at the nearest
	// window's edge from wherever Mio happens to be, and fades
	// in with proximity. What's left over (`1 - strength`) is the
	// floating regime: simple harmonic motion, so Mio bobs
	// with amplitude `floatAmplitude` instead of drifting off-screen,
	// plus a slower, shallower sway at an incommensurable frequency
	// so the two never resolve into an obvious loop.
	//
	// The float is scaled down as the magnet takes hold — Mio
	// stuck to a window should sit still against it, not vibrate.
	// ---------------------------------------------------------------
	const w = physics.floatSpeed;
	const bobA = -physics.floatAmplitude * w * w * Math.sin( w * body.elapsed );
	const swayA =
		-0.17 *
		physics.floatAmplitude *
		w *
		w *
		Math.sin( w * 0.7 * body.elapsed + 1.1 );
	let extX = float * swayA;
	let extY = float * bobA;
	if ( pull ) {
		// The magnet is a SPRING WITH A REST POSITION, not a constant
		// press. A constant pull has no equilibrium: it drives the
		// body into the surface, the contact solver bounces it back,
		// and the pair limit-cycles forever. Against a flat face that
		// is invisible (the bounce is purely normal and friction eats
		// it), but in a corner the pull is diagonal, so every cycle
		// also slides the body along one face and Mio orbits
		// the corner, visibly wobbling and never settling.
		//
		// With a rest gap the force is zero exactly where Mio
		// should sit — `magnetGrip` of a radius pressed in, which is
		// what produces the squash — negative if it gets pushed
		// deeper, positive if it drifts off. A real equilibrium that
		// damping can actually settle into.
		const restGap = -body.radius * physics.magnetGrip;
		const soft = Math.max( 1, body.radius * 0.35 );
		const offset = Math.min( 1, Math.max( -1, ( pull.gap - restGap ) / soft ) );
		const magnet = physics.magnetStrength * strength * offset;
		extX += pull.dx * magnet;
		extY += pull.dy * magnet;

		// Contact damping. Scaled by grip strength, and applied to
		// the whole body rather than just the pull axis so tangential
		// creep along a face dies too — Mio stuck to a magnet
		// should feel held, not skating.
		const hold = physics.magnetDamping * strength;
		extX -= centre.vx * hold;
		extY -= centre.vy * hold;
	}

	// --- Drag. --------------------------------------------------------
	// A spring rather than a hard snap: the body lags the pointer and
	// the rim lags the body, so the blob trails the cursor like
	// something with mass. Critically damped-ish so it arrives
	// instead of orbiting.
	if ( dragTarget ) {
		// Clamp the target inside the layer. A target outside it is
		// an unopposed force pressing the body against a wall the rim
		// can't cross: every point piles onto the same edge and the
		// blob flattens to zero area. It recovers when the drag ends,
		// but it looks broken while it lasts, and the simulation
		// shouldn't depend on every caller remembering to clamp.
		const r = body.radius;
		const tx = clamp( dragTarget.x, r, Math.max( r, bounds.width - r ) );
		const ty = clamp( dragTarget.y, r, Math.max( r, bounds.height - r ) );
		const k = physics.dragStiffness;
		const c = 2 * Math.sqrt( k );
		let dragX = ( tx - centre.x ) * k - centre.vx * c;
		let dragY = ( ty - centre.y ) * k - centre.vy * c;

		// Cap it. The spring force grows without bound as the cursor
		// pulls away from a body that cannot follow — hold the
		// pointer inside a window and Mio is pressed into the
		// glass with arbitrary force until it flattens. Capped, it
		// presses firmly against the obstacle and stops there, which
		// is what pushing a jelly into a wall actually looks like.
		const magnitude = Math.hypot( dragX, dragY );
		if ( magnitude > physics.dragMaxAccel ) {
			const scale = physics.dragMaxAccel / magnitude;
			dragX *= scale;
			dragY *= scale;
		}
		extX += dragX;
		extY += dragY;
	}

	// --- Integrate. ----------------------------------------------------
	const internalDamp = 1 + physics.damping * dt;
	const airDamp = 1 + physics.airDamping * dt;
	const meanVx = centre.vx;
	const meanVy = centre.vy;
	for ( let i = 0; i < n; i++ ) {
		const p = rim[ i ];
		let vx = p.vx + ( ix[ i ] - meanIx + extX ) * dt;
		let vy = p.vy + ( iy[ i ] - meanIy + extY ) * dt;
		// Internal damping acts only on motion relative to the body.
		vx = meanVx + ( vx - meanVx ) / internalDamp;
		vy = meanVy + ( vy - meanVy ) / internalDamp;
		p.vx = vx / airDamp;
		p.vy = vy / airDamp;
		p.x += p.vx * dt;
		p.y += p.vy * dt;
	}

	// --- Hard limits + contact, solved together. -------------------------
	//
	// Springs decide how Mio feels; the limits decide what it
	// can never become. The two have to be *interleaved*, not
	// sequenced: run every limit and then every contact, and the
	// contact pass simply re-breaks the limits it was meant to
	// respect. Measured — dragging Mio into the corner of a
	// window that way crushed it to a third of its rest radius
	// despite a 0.55 floor.
	//
	// Alternating them lets each react to the other. Contact goes
	// last so it always has the final word: Mio a little past a
	// stretch limit is a cosmetic blip, one whose rim pokes through a
	// window is not.
	const contacting = new Uint8Array( n );
	const contactPass = (): void => {
		for ( let i = 0; i < n; i++ ) {
			const hit = resolveObstacleCollisions(
				rim[ i ],
				obstacles,
				physics.restitution,
				physics.friction,
			);
			const clamped = clampToBounds(
				rim[ i ],
				bounds.width,
				bounds.height,
				physics.restitution,
				physics.friction,
			);
			contacting[ i ] = hit || clamped ? 1 : 0;
		}
	};

	const solverPasses = Math.max( 1, physics.limitIterations );
	for ( let pass = 0; pass < solverPasses; pass++ ) {
		contactPass();
		if ( physics.limitIterations > 0 ) {
			enforceLimits( body, restR, physics );
		}
		enforceAngularOrder( body, physics.minAngularGap );
	}

	// Final reconciliation. Contact runs one more time so no rim
	// point is ever left inside a window — that is non-negotiable,
	// it's the artefact users actually notice. Then the limits get a
	// last word restricted to the points contact did NOT touch.
	//
	// That restriction is what makes both guarantees hold at once.
	// The points crushed by an impact are on the far side of the
	// body from the surface, and they are free — nothing is holding
	// them, they were simply carried in by momentum. Correcting only
	// those restores the silhouette without ever pushing a pinned
	// point back through the geometry that is pinning it.
	if ( physics.limitIterations > 0 ) {
		contactPass();
		enforceLimits( body, restR, physics, contacting );
	}
	// Angular order last, unconditionally. A fold is the one failure
	// the body cannot recover from on its own — every distance-based
	// constraint is perfectly happy with a folded ring, so once it
	// happens Mio stays a crescent forever. That outranks
	// everything else, including non-penetration.
	//
	// The cost is real but tiny: a repair rotates points about the
	// centroid, which can carry one across an obstacle edge. Measured
	// at 0.32 px worst case while deliberately shoving Mio
	// into a window, and it only runs at all when the ring is
	// actually broken — a healthy body returns from the first check.
	enforceAngularOrder( body, physics.minAngularGap );
}

function clamp( v: number, lo: number, hi: number ): number {
	return Math.min( Math.max( v, lo ), Math.max( lo, hi ) );
}

/**
 * Keep the rim in angular order around the centroid.
 *
 * **This is what stops Mio turning into a crescent.** Bounding
 * how far each point may sit from the centre says nothing about the
 * *order* they sit in: let two neighbours swap angular places and the
 * outline folds back through itself, and the folded shape can satisfy
 * every radial limit, every edge limit and the pressure term at once.
 * It is a stable configuration — once folded, Mio stays a
 * comma shape forever, because nothing in a distance-only constraint
 * set can tell it apart from a legal blob.
 *
 * Enforcing a minimum angular gap between consecutive points makes
 * the fold unreachable. Combined with the radial limits it is also a
 * hard guarantee of a *simple* polygon: a ring whose vertex angles
 * strictly increase around an interior point is star-shaped, and a
 * star-shaped polygon cannot self-intersect.
 *
 * Corrections are rotations about the centroid, so they cost the
 * radial limits nothing — the two constraint families are orthogonal
 * and don't fight.
 */
function enforceAngularOrder( body: SoftBody, minGapFraction: number ): void {
	const rim = body.rim;
	const n = rim.length;
	if ( n < 3 || minGapFraction <= 0 || minGapFraction >= 1 ) {
		return;
	}
	syncCore( body );
	const cx = body.core.x;
	const cy = body.core.y;
	const even = ( 2 * Math.PI ) / n;
	const minGap = even * minGapFraction;

	// Current angles, and the gaps between consecutive points wrapped
	// into (-π, π]. A healthy ring's gaps are all positive and sum to
	// exactly 2π — it winds around the centroid exactly once.
	const angle = new Float64Array( n );
	const gap = new Float64Array( n );
	for ( let i = 0; i < n; i++ ) {
		angle[ i ] = Math.atan2( rim[ i ].y - cy, rim[ i ].x - cx );
	}
	let total = 0;
	let healthy = true;
	for ( let i = 0; i < n; i++ ) {
		let g = angle[ ( i + 1 ) % n ] - angle[ i ];
		while ( g <= -Math.PI ) {
			g += 2 * Math.PI;
		}
		while ( g > Math.PI ) {
			g -= 2 * Math.PI;
		}
		gap[ i ] = g;
		total += g;
		if ( g < minGap ) {
			healthy = false;
		}
	}
	// `total` is 2π × winding number. Anything but a single positive
	// turn means the rim has folded through itself.
	if ( healthy && Math.abs( total - 2 * Math.PI ) < 1e-6 ) {
		return;
	}

	// Project onto the nearest valid set of gaps: every gap at least
	// `minGap`, all of them summing to exactly one turn.
	//
	// This has to be global. Pushing individual pairs apart — the
	// obvious local fix — cannot work: the gaps are not independent,
	// they must total 2π, so widening one necessarily narrows another
	// and the sweep chases its own tail. A tangled ring stays
	// tangled.
	const slackBudget = 2 * Math.PI - n * minGap;
	let slackTotal = 0;
	for ( let i = 0; i < n; i++ ) {
		const clamped = Math.max( gap[ i ], minGap );
		gap[ i ] = clamped;
		slackTotal += clamped - minGap;
	}
	if ( slackTotal > 1e-9 ) {
		// Keep the shape's angular character — wide gaps stay
		// relatively wide — while forcing the total to one turn.
		const scale = slackBudget / slackTotal;
		for ( let i = 0; i < n; i++ ) {
			gap[ i ] = minGap + ( gap[ i ] - minGap ) * scale;
		}
	} else {
		gap.fill( even );
	}

	// Lay the points back out on the repaired angles. The base is
	// chosen so the total angular movement is zero — repairing a fold
	// must not also spin Mio.
	const target = new Float64Array( n );
	target[ 0 ] = angle[ 0 ];
	for ( let i = 1; i < n; i++ ) {
		target[ i ] = target[ i - 1 ] + gap[ i - 1 ];
	}
	let drift = 0;
	for ( let i = 0; i < n; i++ ) {
		let d = target[ i ] - angle[ i ];
		while ( d <= -Math.PI ) {
			d += 2 * Math.PI;
		}
		while ( d > Math.PI ) {
			d -= 2 * Math.PI;
		}
		drift += d;
	}
	drift /= n;

	for ( let i = 0; i < n; i++ ) {
		let delta = target[ i ] - drift - angle[ i ];
		while ( delta <= -Math.PI ) {
			delta += 2 * Math.PI;
		}
		while ( delta > Math.PI ) {
			delta -= 2 * Math.PI;
		}
		if ( delta !== 0 ) {
			// A pure rotation about the centroid: the point keeps its
			// radius, so this costs the stretch limits nothing.
			rotateAbout( rim[ i ], cx, cy, delta );
		}
	}
}

/** Rotate a particle (position and velocity) about a pivot. */
function rotateAbout(
	p: Particle,
	cx: number,
	cy: number,
	angle: number,
): void {
	const cos = Math.cos( angle );
	const sin = Math.sin( angle );
	const dx = p.x - cx;
	const dy = p.y - cy;
	p.x = cx + dx * cos - dy * sin;
	p.y = cy + dx * sin + dy * cos;
	// Carry the velocity round with it, otherwise the correction
	// injects spurious tangential energy and the rim spins.
	const vx = p.vx;
	const vy = p.vy;
	p.vx = vx * cos - vy * sin;
	p.vy = vx * sin + vy * cos;
}

/**
 * Clamp the distance between two particles into `[minLen, maxLen]`.
 *
 * A positional projection, not a force: springs decide how the
 * Mio *feels*, limits decide what it can never *become*. Forces
 * alone can always be overwhelmed — a hard enough contact, a big
 * enough drag, an unlucky frame delta — and the failure looks
 * catastrophic (a blob crushed to a line, or torn into a spike)
 * rather than merely soft.
 *
 * Both particles move half the correction, so momentum is conserved.
 * The relative velocity along the axis is also killed when it is
 * feeding the violation — a limit is physically a string going
 * taut, and leaving the velocity in place would just re-violate the
 * limit on the next step and buzz.
 *
 * @return `true` if a correction was applied.
 */
function limitDistance(
	a: Particle,
	b: Particle,
	minLen: number,
	maxLen: number,
): boolean {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const len = Math.hypot( dx, dy );
	if ( len < 1e-6 ) {
		return false;
	}
	let target = 0;
	if ( len > maxLen ) {
		target = maxLen;
	} else if ( len < minLen ) {
		target = minLen;
	} else {
		return false;
	}

	const nx = dx / len;
	const ny = dy / len;
	const shift = ( len - target ) * 0.5;
	a.x += nx * shift;
	a.y += ny * shift;
	b.x -= nx * shift;
	b.y -= ny * shift;

	const relative = ( b.vx - a.vx ) * nx + ( b.vy - a.vy ) * ny;
	const feeding = target === maxLen ? relative > 0 : relative < 0;
	if ( feeding ) {
		const half = relative * 0.5;
		a.vx += nx * half;
		a.vy += ny * half;
		b.vx -= nx * half;
		b.vy -= ny * half;
	}
	return true;
}

/**
 * Enforce the hard length limits on both constraint families.
 *
 * **Radial** (rim ↔ centroid) is the one that actually bounds the
 * silhouette: no point may sit closer than `minStretch` or further
 * than `maxStretch` of its target radius, so the outline is
 * guaranteed to stay inside an annulus around the rest shape.
 * **Edge** (rim ↔ neighbour) stops the rim from bunching up or
 * tearing between two points that are each individually legal.
 *
 * The centroid is derived, not a particle, so a radial correction
 * has nothing to push back against and would translate the whole
 * body. The corrections are collected and their mean removed —
 * the same projection the internal forces use.
 */
function enforceLimits(
	body: SoftBody,
	restR: Float64Array,
	physics: MioPhysics,
	pinned: Uint8Array | null = null,
): void {
	const rim = body.rim;
	const n = rim.length;
	const chord = Math.sin( Math.PI / n );
	const min = physics.minStretch;
	const max = physics.maxStretch;

	// --- Edge limits. Symmetric, so momentum takes care of itself.
	for ( let i = 0; i < n; i++ ) {
		const j = ( i + 1 ) % n;
		if ( pinned && ( pinned[ i ] || pinned[ j ] ) ) {
			continue;
		}
		const rest = ( restR[ i ] + restR[ j ] ) * chord;
		limitDistance( rim[ i ], rim[ j ], rest * min, rest * max );
	}

	// --- Radial limits, against the live centroid.
	syncCore( body );
	const cx = body.core.x;
	const cy = body.core.y;
	let shiftX = 0;
	let shiftY = 0;
	let touched = false;
	for ( let i = 0; i < n; i++ ) {
		if ( pinned && pinned[ i ] ) {
			continue;
		}
		const p = rim[ i ];
		const dx = p.x - cx;
		const dy = p.y - cy;
		const len = Math.hypot( dx, dy );
		if ( len < 1e-6 ) {
			continue;
		}
		const lo = restR[ i ] * min;
		const hi = restR[ i ] * max;
		const ux = dx / len;
		const uy = dy / len;
		const radial = p.vx * ux + p.vy * uy;

		// --- Bump stop. -------------------------------------------
		// Bleed the radial velocity as a point *approaches* its
		// limit, not only once it has broken through. Positional
		// correction alone always loses a race it enters late: the
		// contact solver runs after us and gets the final word, so a
		// hard impact lands the visible frame mid-violation. Braking
		// on approach means the violation mostly never happens —
		// physically a hydraulic bump stop, and it reads as the
		// Mio having a firm core rather than a hard clamp.
		const zoneLo = lo * BUMP_ZONE;
		const zoneHi = hi / BUMP_ZONE;
		if ( len < zoneLo && radial < 0 && zoneLo > lo ) {
			const t = Math.min( 1, ( zoneLo - len ) / ( zoneLo - lo ) );
			p.vx -= ux * radial * t;
			p.vy -= uy * radial * t;
		} else if ( len > zoneHi && radial > 0 && hi > zoneHi ) {
			const t = Math.min( 1, ( len - zoneHi ) / ( hi - zoneHi ) );
			p.vx -= ux * radial * t;
			p.vy -= uy * radial * t;
		}

		// --- Hard limit. ------------------------------------------
		let target = 0;
		if ( len < lo ) {
			target = lo;
		} else if ( len > hi ) {
			target = hi;
		} else {
			continue;
		}
		const scale = target / len;
		const nx = dx * ( scale - 1 );
		const ny = dy * ( scale - 1 );
		p.x += nx;
		p.y += ny;
		shiftX += nx;
		shiftY += ny;
		touched = true;

		// Kill whatever radial velocity was still feeding the
		// violation, so the next step doesn't immediately re-break it.
		const after = p.vx * ux + p.vy * uy;
		if ( target === lo ? after < 0 : after > 0 ) {
			p.vx -= ux * after;
			p.vy -= uy * after;
		}
	}
	if ( touched ) {
		// Remove the net translation the corrections introduced,
		// spreading it over the points that are free to move.
		//
		// Pinned points are excluded on purpose. They are held by the
		// world — a window face, the layer edge — and the world
		// absorbs the reaction, exactly as a body resting on the
		// ground doesn't have to conserve its own momentum. Nudging
		// them anyway pushes them a fraction of a pixel back inside
		// the geometry contact just evicted them from.
		let movable = n;
		if ( pinned ) {
			movable = 0;
			for ( let i = 0; i < n; i++ ) {
				if ( ! pinned[ i ] ) {
					movable++;
				}
			}
		}
		if ( movable > 0 ) {
			const meanX = shiftX / movable;
			const meanY = shiftY / movable;
			for ( let i = 0; i < n; i++ ) {
				if ( pinned && pinned[ i ] ) {
					continue;
				}
				rim[ i ].x -= meanX;
				rim[ i ].y -= meanY;
			}
		}
	}
	syncCore( body );
}

/**
 * Apply a spring between every rim point and the neighbour `stride`
 * positions away, accumulating into `ax` / `ay`.
 *
 * The rest length is derived per pair from the current rest shape
 * (`restR`) rather than passed as a constant, so the ring stays in
 * agreement with the shape springs while the body breathes.
 *
 * @param rim         Rim particles.
 * @param ax          X acceleration accumulator.
 * @param ay          Y acceleration accumulator.
 * @param stride      Neighbour distance around the ring.
 * @param restR       Per-point rest radius of the current target shape.
 * @param chordFactor `sin( stride · π / n )` — precomputed by the caller.
 * @param stiffness   Spring constant.
 */
function applyRingSprings(
	rim: readonly RimPoint[],
	ax: Float64Array,
	ay: Float64Array,
	stride: number,
	restR: Float64Array,
	chordFactor: number,
	stiffness: number,
): void {
	if ( stiffness <= 0 ) {
		return;
	}
	const n = rim.length;
	for ( let i = 0; i < n; i++ ) {
		const j = ( i + stride ) % n;
		const a = rim[ i ];
		const b = rim[ j ];
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		const len = Math.hypot( dx, dy );
		if ( len < 1e-6 ) {
			continue;
		}
		const rest = ( restR[ i ] + restR[ j ] ) * chordFactor;
		const f = ( stiffness * ( len - rest ) ) / 2;
		const nx = dx / len;
		const ny = dy / len;
		ax[ i ] += f * nx;
		ay[ i ] += f * ny;
		ax[ j ] -= f * nx;
		ay[ j ] -= f * ny;
	}
}
