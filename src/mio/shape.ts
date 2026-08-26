/**
 * OpenStation — Mio rest shapes.
 *
 * The silhouette half of the simulation, split out of `soft-body.ts`
 * so it can be used without it. A rest shape is a pure function of an
 * angle: no particles, no springs, no DOM, no PixiJS. That is what
 * lets a still portrait of a Mio be drawn from the same maths that
 * gives the live one its outline, instead of a second set of shapes
 * that drift out of agreement with it.
 *
 * `soft-body.ts` re-exports everything public here, so nothing that
 * imported these from there had to change.
 */

import type { MioPhysics } from './types';

/** Quarter turn, in radians. Screen coordinates: `+π/2` is down. */
export const HALF_PI = Math.PI / 2;

/** Full turn, in radians. */
export const TAU = Math.PI * 2;

/**
 * Amplitude of the `blob` preset.
 *
 * A three-lobe profile at half the flat-sided limit: nearly round,
 * with a shallow dimple at the bottom centre and a little extra
 * fullness at the lower left and right.
 */
const BLOB_AMPLITUDE = 0.05;

/**
 * Rest angle re-expressed so that **`0` is straight up**, wrapped to
 * `[0, 2π)`.
 *
 * Screen coordinates put `−π/2` at the top and `+π/2` at the bottom,
 * which is a miserable frame to author a silhouette in: every "this
 * bit points up" reads as a minus sign, and one dropped sign is a
 * shape that ships upside down. Every figurative preset below is
 * written against this phase instead, so `cos( kφ )` peaks at the
 * crown by construction and the feature that should point up cannot
 * quietly end up pointing down.
 *
 * Wrapping matters for {@link heartDeviation}, which folds the phase
 * about the vertical axis and needs a single, monotone turn to fold.
 */
function uprightPhase( angle: number ): number {
	return ( ( ( angle + HALF_PI ) % TAU ) + TAU ) % TAU;
}

/**
 * One crest of a `k`-lobed wave, `0`–`1`, sharpened by `power`.
 *
 * `cos( kφ )` alone gives lobes and valleys of equal width, which
 * reads as a flower whatever `k` is. Raising the half-shifted cosine
 * to a power narrows the crests and broadens the valleys between them
 * — the difference between a six-petal bloom and a five-pointed star.
 *
 * Callers subtract the wave's own mean so the result is a deviation
 * that averages to zero, i.e. so a preset changes Mio's shape without
 * also changing its size.
 */
function crest( cosine: number, power: number ): number {
	return Math.pow( 0.5 + 0.5 * cosine, power );
}

/**
 * The `ghost` silhouette's deviation from a circle.
 *
 * Two ideas, both windowed to the underside by `max( 0, sin θ )` so the
 * top stays a clean dome — which is what makes it read as a ghost
 * rather than as a gear:
 *
 *   - **Straight sides.** The superellipse exponent eases from `2` (a
 *     circle) at the top to `5.2` at the bottom, which pushes the lower
 *     diagonals out and gives the body its square shoulders. A constant
 *     exponent would square the head off too.
 *   - **Three feet.** `−cos( 6θ )` peaks at `π/6`, `π/2` and `5π/6` —
 *     three bulges along the underside with notches between them — and
 *     its own peaks at the sides fall exactly where the window is zero,
 *     so they cost nothing.
 *
 * Authored in the raw screen angle rather than {@link upright}: both
 * terms are windowed on `sin θ`, which is already the underside.
 */
function ghostDeviation( angle: number ): number {
	const under = Math.max( 0, Math.sin( angle ) );
	const n = 2 + 3.2 * under;
	const c = Math.abs( Math.cos( angle ) );
	const s = Math.abs( Math.sin( angle ) );
	const square =
		1 / Math.pow( Math.pow( c, n ) + Math.pow( s, n ), 1 / n ) - 1;
	const feet = -0.17 * Math.pow( under, 1.4 ) * Math.cos( 6 * angle );
	return square + feet;
}

/**
 * The `potato` silhouette's deviation from a circle.
 *
 * Four harmonics at incommensurable frequencies with unrelated phases,
 * which is the cheapest honest way to get "no symmetry at all": any two
 * of them would still read as a squashed something.
 *
 * The amplitudes sit just inside each harmonic's own convexity limit
 * (`1/(1 + k²)`), so the lumps stay lumps. They can still sum past it
 * where two crests coincide, which is exactly the shallow dent a potato
 * ought to have — and the angular-gap constraint guarantees the outline
 * cannot fold however they land.
 */
function potatoDeviation( angle: number ): number {
	return (
		0.16 * Math.cos( 2 * angle + 0.9 ) +
		0.095 * Math.cos( 3 * angle - 2.1 ) +
		0.036 * Math.cos( 5 * angle + 1.3 ) +
		0.019 * Math.cos( 7 * angle - 0.4 )
	);
}

/**
 * The `star` silhouette: five narrow points, one of them straight up.
 *
 * A cubed crest is what makes it a star rather than a five-petal
 * flower — the points occupy roughly a third of the perimeter and the
 * valleys between them are broad and shallow, which is also what keeps
 * the shape inside what the springs can hold. `0.3125` is the cubed
 * crest's own mean, subtracted so the star is the same size as the
 * circle it replaces.
 */
function starDeviation( phase: number ): number {
	return 0.58 * ( crest( Math.cos( 5 * phase ), 3 ) - 0.3125 );
}

/** The `flower` silhouette: six rounded petals, one pointing up. */
function flowerDeviation( phase: number ): number {
	return 0.34 * ( crest( Math.cos( 6 * phase ), 2 ) - 0.375 );
}

/** The `diamond` silhouette: four points — up, down, and both sides. */
function diamondDeviation( phase: number ): number {
	return 0.34 * ( crest( Math.cos( 4 * phase ), 2 ) - 0.375 );
}

/**
 * The `drop` silhouette: a teardrop, tip up.
 *
 * A single very narrow crest (`cos⁸`) rather than a lobed wave — the
 * whole shape is "circle, plus one spike". The eighth power is what
 * separates a teardrop from an egg: anything gentler spreads the tip
 * into a dome.
 */
function dropDeviation( phase: number ): number {
	return 0.72 * ( Math.pow( Math.max( 0, Math.cos( phase ) ), 8 ) - 0.1367 );
}

/**
 * The `cloud` silhouette: three billows across the top, flat below.
 *
 * The upper window is `√( cos φ )` rather than `cos φ` so the billows
 * keep their height almost all the way out to the shoulders instead of
 * fading into the sides, and the underside is pulled in by a squared
 * window so the cloud sits on a flat base.
 */
function cloudDeviation( phase: number ): number {
	const up = Math.max( 0, Math.cos( phase ) );
	const down = Math.max( 0, -Math.cos( phase ) );
	return (
		0.34 *
		( Math.sqrt( up ) * ( 0.5 + 0.5 * Math.cos( 5 * phase ) ) -
			0.7 * down * down -
			0.0247 )
	);
}

/**
 * The `heart` silhouette: cleft at the crown, point at the foot.
 *
 * Three narrow terms rather than harmonics, because a heart is a shape
 * with three named features and no periodicity worth exploiting:
 *
 *   - **Cleft** — a deep, narrow notch exactly at the crown.
 *   - **Lobes** — a bulge one radian either side of it. The phase is
 *     folded about the vertical axis first, which is what guarantees
 *     the two lobes are mirror images rather than two separately-tuned
 *     bumps that drift apart.
 *   - **Tip** — a very narrow spike at the foot.
 */
function heartDeviation( phase: number ): number {
	const fold = phase > Math.PI ? TAU - phase : phase;
	const cleft = -0.34 * Math.pow( Math.max( 0, Math.cos( phase ) ), 6 );
	const lobes = 0.3 * Math.pow( Math.max( 0, Math.cos( fold - 1 ) ), 3 );
	const tip = 0.34 * Math.pow( Math.max( 0, -Math.cos( phase ) ), 8 );
	return cleft + lobes + tip + 0.02;
}

/**
 * A preset's deviation from a circle, in its own upright frame.
 *
 * Returning a *deviation* rather than a multiplier is what lets
 * `shapeAmount` mean the same thing for every preset: it scales this,
 * so `0` is always a circle and `1` is always the shape as authored.
 */
function presetDeviation( angle: number, physics: MioPhysics ): number {
	switch ( physics.shapePreset ) {
		case 'circle':
			return 0;
		case 'ghost':
			return ghostDeviation( angle );
		case 'potato':
			return potatoDeviation( angle );
		case 'star':
			return starDeviation( uprightPhase( angle ) );
		case 'flower':
			return flowerDeviation( uprightPhase( angle ) );
		case 'diamond':
			return diamondDeviation( uprightPhase( angle ) );
		case 'drop':
			return dropDeviation( uprightPhase( angle ) );
		case 'cloud':
			return cloudDeviation( uprightPhase( angle ) );
		case 'heart':
			return heartDeviation( uprightPhase( angle ) );
		case 'custom': {
			const lobes = Math.round( physics.shapeLobes );
			if ( lobes < 2 ) {
				return 0;
			}
			// The flat-sided limit: where the curvature at the side
			// midpoints reaches exactly zero, so `shapeAmount` of 1 means
			// "dead straight sides between rounded corners" at any lobe
			// count. One number that means the same thing for a triangle
			// and a hexagon beats an amplitude re-derived per lobe count.
			return ( 1 / ( 1 + lobes * lobes ) ) * Math.cos( lobes * angle );
		}
		default:
			// 'blob' — a corner up, so a flat side sits along the bottom.
			return BLOB_AMPLITUDE * Math.cos( 3 * ( angle + HALF_PI ) );
	}
}

/**
 * The rim resolution a silhouette needs to actually be that
 * silhouette.
 *
 * **A rest shape can only be as detailed as the ring carrying it.**
 * The profile is evaluated once per mass point, so a five-pointed star
 * on the shipped twelve-point rim gets 2.4 samples per point — below
 * the two it takes to represent one at all. What comes out is not a
 * faint star, it is a *different, lumpy shape* whose lumps land
 * wherever the sampling phase puts them: the reason detailed presets
 * used to read as vaguely-wrong blobs, and as often as not upside
 * down. The renderer's smoothing pass then rounds off what little
 * survived.
 *
 * So each preset declares the resolution it needs and the runtime
 * densifies the rim to it (see `resampleBody`), which keeps the
 * shipped twelve points for the shapes that are happy with twelve and
 * spends more only while a demanding shape is on screen. Roughly six
 * samples per feature, which is where the smoothed outline stops
 * losing amplitude.
 *
 * @param physics Simulation constants — the preset and, for `custom`,
 *                its lobe count.
 * @return Minimum number of rim points.
 */
export function presetRimPoints( physics: MioPhysics ): number {
	switch ( physics.shapePreset ) {
		case 'star':
			return 40;
		case 'flower':
			return 36;
		case 'heart':
		case 'cloud':
			return 32;
		case 'drop':
			return 28;
		case 'ghost':
			return 26;
		case 'potato':
		case 'diamond':
			return 24;
		case 'custom':
			return Math.max( 12, Math.round( physics.shapeLobes ) * 7 );
		default:
			// 'circle' and 'blob' — three lobes at most; twelve points
			// carry them with room to spare.
			return 12;
	}
}

/**
 * Mio's rest silhouette, as a multiplier on `radius` at one
 * angle around the ring.
 *
 * Written the only way a soft body can usefully carry a shape — as a
 * **rest length**, not a mask. Every spring family reads its target
 * from this, so Mio squashes, stretches, breathes, is thrown and
 * recovers exactly as a disc-shaped one does; it simply settles into
 * this silhouette when nothing is acting on it.
 *
 * @param angle   Rest angle of the point, in radians.
 * @param physics Simulation constants.
 */
export function shapeProfile( angle: number, physics: MioPhysics ): number {
	if ( physics.shapeAmount <= 0 ) {
		return 1;
	}
	const upright = angle - ( physics.shapeAngle * Math.PI ) / 180;
	return 1 + physics.shapeAmount * presetDeviation( upright, physics );
}
