/**
 * Unit tests for Inkfall's scatter math
 * (`src/games/inkfall/fx-math.ts`).
 */
import { describe, expect, test } from 'vitest';
import {
	SCATTER_GRAVITY,
	SCATTER_LIFETIME,
	integrateStep,
	scatterAlpha,
	scatterVelocities,
} from '../../src/games/inkfall/fx-math';

const zeroRng = (): number => 0;
const maxRng = (): number => 0.999999;

describe( 'inkfall/fx-math.ts', () => {
	test( 'velocities fan outward from the word center', () => {
		const particles = scatterVelocities( 5, zeroRng );
		expect( particles ).toHaveLength( 5 );
		// Leftmost kicks left, middle stays put, rightmost kicks right.
		expect( particles[ 0 ].vx ).toBeLessThan( 0 );
		expect( particles[ 2 ].vx ).toBe( 0 );
		expect( particles[ 4 ].vx ).toBeGreaterThan( 0 );
		// Everyone pops upward first.
		for ( const particle of particles ) {
			expect( particle.vy ).toBeLessThan( 0 );
		}
	} );

	test( 'velocity magnitudes stay inside the tuned bounds', () => {
		for ( const rng of [ zeroRng, maxRng ] ) {
			for ( const particle of scatterVelocities( 8, rng ) ) {
				expect( Math.abs( particle.vx ) ).toBeLessThanOrEqual( 140 );
				expect( particle.vy ).toBeGreaterThanOrEqual( -240 );
				expect( particle.vy ).toBeLessThanOrEqual( -120 );
				expect( Math.abs( particle.spin ) ).toBeLessThanOrEqual( 6 );
			}
		}
	} );

	test( 'a single character pops straight up', () => {
		const [ particle ] = scatterVelocities( 1, zeroRng );
		expect( particle.vx ).toBe( 0 );
	} );

	test( 'gravity integration accelerates downward', () => {
		const particle = { vx: 10, vy: -100, spin: 2 };
		const step = integrateStep( particle, 0.1 );
		expect( step.dx ).toBeCloseTo( 1 );
		expect( step.vyNext ).toBeCloseTo( -100 + SCATTER_GRAVITY * 0.1 );
		// Trapezoidal: dy uses the average of old/new vy.
		expect( step.dy ).toBeCloseTo( ( ( -100 + step.vyNext ) / 2 ) * 0.1 );
		expect( step.dRotation ).toBeCloseTo( 0.2 );
	} );

	test( 'alpha fades from 1 to 0 over the lifetime', () => {
		expect( scatterAlpha( 0 ) ).toBe( 1 );
		expect( scatterAlpha( SCATTER_LIFETIME / 2 ) ).toBeCloseTo( 0.5 );
		expect( scatterAlpha( SCATTER_LIFETIME ) ).toBe( 0 );
		expect( scatterAlpha( SCATTER_LIFETIME * 2 ) ).toBe( 0 );
	} );
} );
