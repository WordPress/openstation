/**
 * Inkfall — pure math for the tear/scatter effect.
 *
 * When a word is finished, a musical note glides up to it and the
 * word tears apart: each character gets an outward velocity and
 * tumbles away under gravity while fading. These helpers are pure
 * (seedable rng injected) so the trajectories are unit-testable;
 * `fx.ts` owns the Pixi objects.
 *
 * @since 0.9.6
 */

export interface ScatterParticle {
	/** Horizontal velocity, px/s. */
	vx: number;
	/** Vertical velocity, px/s (negative = upward). */
	vy: number;
	/** Angular velocity, radians/s. */
	spin: number;
}

/** Downward acceleration applied to scattering characters, px/s². */
export const SCATTER_GRAVITY = 900;

/** How long a scattered character lives, seconds. */
export const SCATTER_LIFETIME = 0.9;

/**
 * Initial velocities for each character of a tearing word. The
 * spread fans characters outward from the word's center: leftmost
 * characters kick left, rightmost right, everyone pops slightly
 * upward before gravity takes over.
 *
 * @param count Number of characters.
 * @param rng   `() => number` in [0,1).
 */
export function scatterVelocities(
	count: number,
	rng: () => number,
): ScatterParticle[] {
	const particles: ScatterParticle[] = [];
	for ( let i = 0; i < count; i++ ) {
		// -1 (leftmost) … +1 (rightmost); a lone character pops straight up.
		const lateral = count > 1 ? ( i / ( count - 1 ) ) * 2 - 1 : 0;
		particles.push( {
			vx: lateral * ( 80 + rng() * 60 ),
			vy: -( 120 + rng() * 120 ),
			spin: ( rng() * 2 - 1 ) * 6,
		} );
	}
	return particles;
}

/**
 * Advance one particle by `dt` seconds. Returns the position/state
 * deltas rather than mutating — callers apply them to their display
 * objects.
 */
export function integrateStep(
	particle: ScatterParticle,
	dt: number,
): { dx: number; dy: number; dRotation: number; vyNext: number } {
	const vyNext = particle.vy + SCATTER_GRAVITY * dt;
	return {
		dx: particle.vx * dt,
		// Trapezoidal-ish: average the old and new vertical velocity
		// over the step so coarse frames don't over-accelerate.
		dy: ( ( particle.vy + vyNext ) / 2 ) * dt,
		dRotation: particle.spin * dt,
		vyNext,
	};
}

/** Alpha for a particle at `age` seconds (1 → 0 over the lifetime). */
export function scatterAlpha( age: number ): number {
	return Math.max( 0, 1 - age / SCATTER_LIFETIME );
}
