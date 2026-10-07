import { describe, expect, test } from 'vitest';
import { reorderZone, withRegion } from '../../src/nav';
import type { NavPlacement } from '../../src/nav';

describe( 'withRegion', () => {
	const cases: Array<
		[ NavPlacement, 'rail' | 'desktop', boolean, NavPlacement ]
	> = [

		[ 'rail', 'rail', false, 'hidden' ],
		[ 'desktop', 'desktop', false, 'hidden' ],

		[ 'both', 'rail', false, 'desktop' ],
		[ 'both', 'desktop', false, 'rail' ],

		[ 'rail', 'rail', true, 'rail' ],
		[ 'both', 'desktop', true, 'both' ],

		[ 'rail', 'desktop', true, 'both' ],
		[ 'desktop', 'rail', true, 'both' ],

		[ 'hidden', 'rail', true, 'rail' ],
		[ 'hidden', 'desktop', true, 'desktop' ],

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

		expect(
			reorderZone( [ 'x', 'a', 'y', 'c' ], [ 'c', 'a' ] ),
		).toEqual( [ 'x', 'c', 'y', 'a' ] );
	} );

	test( 'ids the zone gained are appended', () => {
		expect( reorderZone( [ 'a' ], [ 'a', 'b' ] ) ).toEqual( [ 'a', 'b' ] );
	} );

	test( 'ids no longer in the zone keep their slot', () => {

		expect(
			reorderZone( [ 'gone', 'a', 'b' ], [ 'b', 'a' ] ),
		).toEqual( [ 'gone', 'b', 'a' ] );
	} );

	test( 'an empty order takes the zone order verbatim', () => {
		expect( reorderZone( [], [ 'b', 'a' ] ) ).toEqual( [ 'b', 'a' ] );
	} );
} );
