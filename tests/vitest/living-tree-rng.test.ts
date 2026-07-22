/**
 * The Living Tree — determinism of the seeded PRNG.
 *
 * The whole "same site → same skeleton, different sites → different
 * trees" guarantee (docs/living-tree-algorithm.md §A.2) rests on
 * `hash32` + `mulberry32` being deterministic and well-behaved. Unlike
 * the growth/render modules (scaffold stubs), these two are implemented,
 * so these tests are live.
 */
import { describe, expect, test } from 'vitest';
import { hash32, mulberry32 } from '../../src/plugins/living-tree-wallpaper/rng';

function take( gen: () => number, n: number ): number[] {
	const out: number[] = [];
	for ( let i = 0; i < n; i++ ) {
		out.push( gen() );
	}
	return out;
}

describe( 'living-tree hash32', () => {
	test( 'is stable for the same input', () => {
		expect( hash32( 'https://example.com|1700000000' ) ).toBe(
			hash32( 'https://example.com|1700000000' ),
		);
	} );

	test( 'returns an unsigned 32-bit integer', () => {
		const h = hash32( 'anything' );
		expect( Number.isInteger( h ) ).toBe( true );
		expect( h ).toBeGreaterThanOrEqual( 0 );
		expect( h ).toBeLessThanOrEqual( 0xffffffff );
	} );

	test( 'diverges for different inputs (two sites never collide here)', () => {
		expect( hash32( 'https://alice.example|100' ) ).not.toBe(
			hash32( 'https://bob.example|100' ),
		);
	} );
} );

describe( 'living-tree mulberry32', () => {
	test( 'same seed yields the same sequence', () => {
		const seed = hash32( 'https://example.com|1700000000' );
		const a = take( mulberry32( seed ), 16 );
		const b = take( mulberry32( seed ), 16 );
		expect( a ).toEqual( b );
	} );

	test( 'different seeds yield different sequences', () => {
		const a = take( mulberry32( hash32( 'siteA' ) ), 16 );
		const b = take( mulberry32( hash32( 'siteB' ) ), 16 );
		expect( a ).not.toEqual( b );
	} );

	test( 'every draw is in [0, 1)', () => {
		const gen = mulberry32( hash32( 'range-check' ) );
		for ( const v of take( gen, 1000 ) ) {
			expect( v ).toBeGreaterThanOrEqual( 0 );
			expect( v ).toBeLessThan( 1 );
		}
	} );
} );
