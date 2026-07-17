/**
 * Unit tests for Inkfall's difficulty curve
 * (`src/games/inkfall/difficulty.ts`).
 */
import { describe, expect, test } from 'vitest';
import {
	MAX_RAMP_SECONDS,
	difficultyAt,
	fallSpeed,
	lengthBand,
	level,
	maxConcurrent,
	spawnIntervalMs,
} from '../../src/games/inkfall/difficulty';

describe( 'inkfall/difficulty.ts', () => {
	test( 'exact values at the tuning points', () => {
		expect( spawnIntervalMs( 0 ) ).toBe( 3200 );
		expect( spawnIntervalMs( 150 ) ).toBe( 2050 );
		expect( spawnIntervalMs( 300 ) ).toBe( 900 );

		expect( fallSpeed( 0 ) ).toBe( 40 );
		expect( fallSpeed( 150 ) ).toBe( 105 );
		expect( fallSpeed( 300 ) ).toBe( 170 );

		expect( maxConcurrent( 0 ) ).toBe( 1 );
		expect( maxConcurrent( 20 ) ).toBe( 2 );
		expect( maxConcurrent( 60 ) ).toBe( 3 );
		expect( maxConcurrent( 120 ) ).toBe( 4 );
		expect( maxConcurrent( 200 ) ).toBe( 5 );

		expect( lengthBand( 0 ) ).toEqual( { min: 3, max: 4 } );
		expect( lengthBand( 30 ) ).toEqual( { min: 3, max: 5 } );
		expect( lengthBand( 75 ) ).toEqual( { min: 3, max: 6 } );
		expect( lengthBand( 150 ) ).toEqual( { min: 4, max: 8 } );
		expect( lengthBand( 225 ) ).toEqual( { min: 5, max: 10 } );
		expect( lengthBand( 300 ) ).toEqual( { min: 6, max: 12 } );
	} );

	test( 'interval decreases and speed increases monotonically', () => {
		for ( let t = 0; t < MAX_RAMP_SECONDS; t += 10 ) {
			expect( spawnIntervalMs( t + 10 ) ).toBeLessThanOrEqual(
				spawnIntervalMs( t ),
			);
			expect( fallSpeed( t + 10 ) ).toBeGreaterThanOrEqual(
				fallSpeed( t ),
			);
		}
	} );

	test( 'everything clamps past the five-minute ceiling', () => {
		expect( spawnIntervalMs( 9999 ) ).toBe( spawnIntervalMs( 300 ) );
		expect( fallSpeed( 9999 ) ).toBe( fallSpeed( 300 ) );
		expect( maxConcurrent( 9999 ) ).toBe( 5 );
		expect( lengthBand( 9999 ) ).toEqual( { min: 6, max: 12 } );
	} );

	test( 'negative / NaN input is treated as t=0', () => {
		expect( spawnIntervalMs( -5 ) ).toBe( 3200 );
		expect( fallSpeed( Number.NaN ) ).toBe( 40 );
		expect( maxConcurrent( -1 ) ).toBe( 1 );
	} );

	test( 'level steps every 20s and caps at 15', () => {
		expect( level( 0 ) ).toBe( 0 );
		expect( level( 19.9 ) ).toBe( 0 );
		expect( level( 20 ) ).toBe( 1 );
		expect( level( 299 ) ).toBe( 14 );
		expect( level( 300 ) ).toBe( 15 );
		expect( level( 9999 ) ).toBe( 15 );
	} );

	test( 'difficultyAt bundles the pieces', () => {
		const snapshot = difficultyAt( 150 );
		expect( snapshot ).toEqual( {
			spawnIntervalMs: 2050,
			fallSpeed: 105,
			maxConcurrent: 4,
			minLength: 4,
			maxLength: 8,
			level: 7,
		} );
	} );

	test( 'medium and hard are strictly harder than easy at every point', () => {
		for ( let t = 0; t <= MAX_RAMP_SECONDS; t += 30 ) {
			expect( spawnIntervalMs( t, 'medium' ) ).toBeLessThan(
				spawnIntervalMs( t, 'easy' ),
			);
			expect( spawnIntervalMs( t, 'hard' ) ).toBeLessThan(
				spawnIntervalMs( t, 'medium' ),
			);
			expect( fallSpeed( t, 'medium' ) ).toBeGreaterThan(
				fallSpeed( t, 'easy' ),
			);
			expect( fallSpeed( t, 'hard' ) ).toBeGreaterThan(
				fallSpeed( t, 'medium' ),
			);
			expect( maxConcurrent( t, 'hard' ) ).toBeGreaterThanOrEqual(
				maxConcurrent( t, 'medium' ),
			);
			expect( maxConcurrent( t, 'medium' ) ).toBeGreaterThanOrEqual(
				maxConcurrent( t, 'easy' ),
			);
		}
	} );

	test( 'medium tuning points', () => {
		expect( spawnIntervalMs( 0, 'medium' ) ).toBe( 2400 );
		expect( spawnIntervalMs( 300, 'medium' ) ).toBe( 700 );
		expect( fallSpeed( 0, 'medium' ) ).toBe( 75 );
		expect( fallSpeed( 300, 'medium' ) ).toBe( 230 );
		expect( maxConcurrent( 0, 'medium' ) ).toBe( 1 );
		expect( maxConcurrent( 240, 'medium' ) ).toBe( 6 );
		expect( lengthBand( 0, 'medium' ) ).toEqual( { min: 3, max: 5 } );
		expect( lengthBand( 300, 'medium' ) ).toEqual( { min: 7, max: 12 } );
	} );

	test( 'hard tuning points', () => {
		expect( spawnIntervalMs( 0, 'hard' ) ).toBe( 1700 );
		expect( spawnIntervalMs( 300, 'hard' ) ).toBe( 550 );
		expect( fallSpeed( 0, 'hard' ) ).toBe( 110 );
		expect( fallSpeed( 300, 'hard' ) ).toBe( 300 );
		expect( maxConcurrent( 0, 'hard' ) ).toBe( 2 );
		expect( maxConcurrent( 200, 'hard' ) ).toBe( 7 );
		expect( lengthBand( 0, 'hard' ) ).toEqual( { min: 4, max: 6 } );
		expect( lengthBand( 150, 'hard' ) ).toEqual( { min: 8, max: 12 } );
	} );

	test( 'an unknown mode falls back to easy', () => {
		expect(
			spawnIntervalMs( 0, 'bogus' as unknown as 'easy' ),
		).toBe( 3200 );
	} );
} );
