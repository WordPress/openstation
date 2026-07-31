/**
 * Unit tests for Alphabet Soup's daily seeds
 * (`src/games/alphabet-soup/seed.ts`).
 */
import { describe, expect, test } from 'vitest';
import {
	formatDailySeed,
	runSeedString,
	waveRng,
} from '../../src/games/alphabet-soup/seed';

describe( 'alphabet-soup/seed.ts', () => {
	test( 'formats the date as dd-mm-yyyy with padding', () => {
		expect( formatDailySeed( new Date( Date.UTC( 2026, 6, 18 ) ) ) ).toBe(
			'18-07-2026',
		);
		expect( formatDailySeed( new Date( Date.UTC( 2026, 0, 3 ) ) ) ).toBe(
			'03-01-2026',
		);
	} );

	test( 'uses the UTC calendar date, not the local one', () => {
		// 2026-07-19 02:00 UTC is still 2026-07-18 locally west of UTC,
		// and already 2026-07-19 locally east of UTC — the seed must
		// land on the UTC date for every player regardless of timezone.
		expect(
			formatDailySeed( new Date( Date.UTC( 2026, 6, 19, 2, 0, 0 ) ) ),
		).toBe( '19-07-2026' );
	} );

	test( 'every (mode, size) pair is its own pot from the same date', () => {
		expect( runSeedString( '18-07-2026', 'daily', 'small' ) ).toBe(
			'18-07-2026#small',
		);
		expect( runSeedString( '18-07-2026', 'time-attack', 'medium' ) ).toBe(
			'18-07-2026#time-attack#medium',
		);
		const seeds = new Set< string >();
		for ( const mode of [ 'daily', 'time-attack' ] as const ) {
			for ( const size of [ 'small', 'medium', 'big' ] as const ) {
				seeds.add( runSeedString( '18-07-2026', mode, size ) );
			}
		}
		expect( seeds.size ).toBe( 6 );
	} );

	test( 'waveRng is deterministic per (seed, wave)', () => {
		const a = waveRng( '18-07-2026', 2 );
		const b = waveRng( '18-07-2026', 2 );
		const streamA = [ a(), a(), a() ];
		const streamB = [ b(), b(), b() ];
		expect( streamA ).toEqual( streamB );
	} );

	test( 'different waves and different seeds diverge', () => {
		const wave1 = waveRng( '18-07-2026', 1 )();
		const wave2 = waveRng( '18-07-2026', 2 )();
		const other = waveRng( '19-07-2026', 1 )();
		expect( wave1 ).not.toBe( wave2 );
		expect( wave1 ).not.toBe( other );
	} );
} );
