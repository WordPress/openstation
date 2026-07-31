/**
 * The Living Tree — wind field.
 *
 * The only permanent animation once the tree has grown. A sum of three
 * sines (slow gust + mid breeze + fast shiver) scaled by `wind01`,
 * sampled per vertex / per leaf and multiplied by each element's
 * `compliance` so tips sway and the trunk stays still. Non-interactive.
 * Reduced-motion → strength 0. See `docs/living-tree-algorithm.md` §A.8.
 */

import type { Vec2 } from './types';

/** Peak horizontal sway at compliance 1 / strength 1, reference units. */
const SWAY_X = 16;

/** Peak vertical bob — small; trees sway sideways, not up and down. */
const SWAY_Y = 3.5;

export class WindField {
	/** Current strength, 0..1 (0 under reduced-motion). */
	private strength = 0;

	/**
	 * Sample the wind displacement at a point and time. Callers scale the
	 * result by the element's compliance before applying it.
	 *
	 * @param x Reference-space x.
	 * @param y Reference-space y.
	 * @param t Elapsed time (seconds).
	 * @return Displacement vector.
	 */
	public sample( x: number, y: number, t: number ): Vec2 {
		if ( this.strength <= 0 ) {
			return { x: 0, y: 0 };
		}
		// Phase drifts with position so the canopy ripples instead of
		// rocking rigidly. Gust (0.5Hz-ish) carries most of the energy.
		const gust = Math.sin( t * 0.9 + x * 0.004 + y * 0.003 );
		const breeze = Math.sin( t * 2.1 + y * 0.006 + 1.7 );
		const shiver = Math.sin( t * 5.3 + x * 0.01 + 4.1 );
		const s = this.strength;
		return {
			x: s * SWAY_X * ( 0.62 * gust + 0.28 * breeze + 0.1 * shiver ),
			y: s * SWAY_Y * ( 0.5 * breeze + 0.5 * shiver ),
		};
	}

	/**
	 * Retune wind strength live (e.g. after a traffic re-poll, or set to 0
	 * for reduced-motion).
	 *
	 * @param w01 Normalised wind strength, 0..1.
	 */
	public setStrength( w01: number ): void {
		this.strength = Math.min( 1, Math.max( 0, w01 ) );
	}
}
