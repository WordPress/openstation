/**
 * The Living Tree — meadow decoration budgets.
 *
 * Categories bloom as wildflower patches in the meadow; tags flutter as
 * butterflies working them. Both budgets are pure saturating functions
 * of a single aggregate count — bounded, monotone, and generous at the
 * low end (one category already earns a visible cluster, one tag a pair
 * of wings). These are decoration budgets: like the leaf budget, they
 * must never touch the skeleton (see the invariance suite).
 */
import { describe, expect, test } from 'vitest';
import { computeButterflyCount } from '../../src/plugins/living-tree-wallpaper/render/butterflies';
import { computeFlowerCount } from '../../src/plugins/living-tree-wallpaper/render/flowers';

describe( 'living-tree wildflowers (categories)', () => {
	test( 'no categories, no flowers', () => {
		expect( computeFlowerCount( 0 ) ).toBe( 0 );
		expect( computeFlowerCount( -3 ) ).toBe( 0 );
	} );

	test( 'a single category still earns a couple of blossoms', () => {
		expect( computeFlowerCount( 1 ) ).toBeGreaterThanOrEqual( 2 );
	} );

	test( 'the bed saturates: 2000 categories is a flowerbed, not a sprite storm', () => {
		expect( computeFlowerCount( 2000 ) ).toBeLessThanOrEqual( 80 );
		expect( computeFlowerCount( 2000 ) ).toBe( computeFlowerCount( 100000 ) );
	} );

	test( 'monotone in the category count', () => {
		let prev = 0;
		for ( const cats of [ 1, 2, 5, 12, 40, 150, 600, 2000 ] ) {
			const count = computeFlowerCount( cats );
			expect( count ).toBeGreaterThanOrEqual( prev );
			prev = count;
		}
	} );
} );

describe( 'living-tree butterflies (tags)', () => {
	test( 'no tags, no butterflies', () => {
		expect( computeButterflyCount( 0 ) ).toBe( 0 );
		expect( computeButterflyCount( -1 ) ).toBe( 0 );
	} );

	test( 'a single tag earns a pair of wings', () => {
		expect( computeButterflyCount( 1 ) ).toBeGreaterThanOrEqual( 2 );
	} );

	test( 'the population caps at a meadow, never a swarm', () => {
		expect( computeButterflyCount( 8000 ) ).toBeLessThanOrEqual( 8 );
		expect( computeButterflyCount( 8000 ) ).toBe( computeButterflyCount( 1_000_000 ) );
	} );

	test( 'monotone in the tag count', () => {
		let prev = 0;
		for ( const tags of [ 1, 4, 15, 50, 200, 1000 ] ) {
			const count = computeButterflyCount( tags );
			expect( count ).toBeGreaterThanOrEqual( prev );
			prev = count;
		}
	} );
} );
