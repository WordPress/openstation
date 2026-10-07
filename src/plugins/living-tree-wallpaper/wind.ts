import type { Vec2 } from './types';

const SWAY_X = 16;

const SWAY_Y = 3.5;

export class WindField {
	private strength = 0;

	public sample( x: number, y: number, t: number ): Vec2 {
		if ( this.strength <= 0 ) {
			return { x: 0, y: 0 };
		}

		const gust = Math.sin( t * 0.9 + x * 0.004 + y * 0.003 );
		const breeze = Math.sin( t * 2.1 + y * 0.006 + 1.7 );
		const shiver = Math.sin( t * 5.3 + x * 0.01 + 4.1 );
		const s = this.strength;
		return {
			x: s * SWAY_X * ( 0.62 * gust + 0.28 * breeze + 0.1 * shiver ),
			y: s * SWAY_Y * ( 0.5 * breeze + 0.5 * shiver ),
		};
	}

	public setStrength( w01: number ): void {
		this.strength = Math.min( 1, Math.max( 0, w01 ) );
	}
}
