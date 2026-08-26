/**
 * The two pure writes behind every placement change.
 *
 * `withRegion` is what the right-click menu and the Preferences rows
 * both call: add or remove ONE region, keep the other. Getting it
 * wrong is the "teleporting tile" bug — hiding a dock-only tile from
 * the dock used to write `'desktop'`, so it reappeared on the
 * wallpaper instead of disappearing.
 *
 * `reorderZone` is what a drag commits. The flat order list spans
 * every zone, so a drag in one zone must leave every other zone's
 * entries exactly where they were.
 */

import { describe, expect, test } from 'vitest';
import { reorderZone, withRegion } from '../../src/nav';
import type { NavPlacement } from '../../src/nav';

describe( 'withRegion', () => {
	const cases: Array<
		[ NavPlacement, 'rail' | 'desktop', boolean, NavPlacement ]
	> = [
		// Removing the only region hides the item — it does not
		// teleport to the other one.
		[ 'rail', 'rail', false, 'hidden' ],
		[ 'desktop', 'desktop', false, 'hidden' ],
		// An item on both keeps whichever region was not touched.
		[ 'both', 'rail', false, 'desktop' ],
		[ 'both', 'desktop', false, 'rail' ],
		// Adding the region it already has is a no-op.
		[ 'rail', 'rail', true, 'rail' ],
		[ 'both', 'desktop', true, 'both' ],
		// Adding the other region promotes to both.
		[ 'rail', 'desktop', true, 'both' ],
		[ 'desktop', 'rail', true, 'both' ],
		// From hidden, adding one region gives exactly that region.
		[ 'hidden', 'rail', true, 'rail' ],
		[ 'hidden', 'desktop', true, 'desktop' ],
		// Removing a region the item does not have changes nothing.
		[ 'hidden', 'rail', false, 'hidden' ],
		[ 'desktop', 'rail', false, 'desktop' ],
	];

	for ( const [ from, region, on, expected ] of cases ) {
		test( `${ from } ${ on ? '+' : '-' }${ region } → ${ expected }`, () => {
			expect( withRegion( from, region, on ) ).toBe( expected );
		} );
	}
} );

describe( 'reorderZone', () => {
	test( 'refills the zone’s own slots and leaves the rest alone', () => {
		// `a`/`c` belong to the dragged zone, `x`/`y` to another one.
		expect(
			reorderZone( [ 'x', 'a', 'y', 'c' ], [ 'c', 'a' ] ),
		).toEqual( [ 'x', 'c', 'y', 'a' ] );
	} );

	test( 'ids the zone gained are appended', () => {
		expect( reorderZone( [ 'a' ], [ 'a', 'b' ] ) ).toEqual( [ 'a', 'b' ] );
	} );

	test( 'ids no longer in the zone keep their slot', () => {
		// A deactivated plugin's position survives so reactivating it
		// puts the tile back where the user had it.
		expect(
			reorderZone( [ 'gone', 'a', 'b' ], [ 'b', 'a' ] ),
		).toEqual( [ 'gone', 'b', 'a' ] );
	} );

	test( 'an empty order takes the zone order verbatim', () => {
		expect( reorderZone( [], [ 'b', 'a' ] ) ).toEqual( [ 'b', 'a' ] );
	} );
} );
