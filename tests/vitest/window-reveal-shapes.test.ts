/**
 * Unit tests for `src/reveals/shapes.ts`.
 *
 * The load-bearing property of this module is not what the shapes look
 * like — that is a visual judgement — but that every `{ from, to }`
 * pair it produces can actually be INTERPOLATED. CSS only animates a
 * `clip-path` between values using the same shape function, and for
 * `polygon()` the same vertex count. A pair that violates either rule
 * still "works": the browser jumps between the two values at the
 * halfway mark, which reads as a flicker on a window that just
 * finished loading, and is exactly the sort of bug that survives code
 * review because both values are individually valid.
 *
 * So these tests assert the invariant directly, for every built-in
 * pair and across the whole range of each builder's animated
 * dimension.
 */
import { describe, expect, test } from 'vitest';
import {
	blindsPair,
	blindsSurface,
	curtainPair,
	curtainSurface,
	diagonalPair,
	diamondPair,
	irisPair,
	irisSurface,
	mosaicPair,
	obturatorPair,
	obturatorSurface,
	polygonWithHoles,
	radarPair,
	risePair,
	shutterPair,
	slatsPair,
	sweepPair,
} from '../../src/reveals/shapes';

/** Leading shape function of a clip-path value (`polygon`, `inset`, …). */
function shapeFunction( value: string ): string {
	return ( /^\s*([a-zA-Z-]+)\s*\(/.exec( value ) ?? [ '', '' ] )[ 1 ];
}

/** Number of `x% y%` vertices in a shape value. */
function vertexCount( value: string ): number {
	const inner = value.slice( value.indexOf( '(' ) + 1, value.lastIndexOf( ')' ) );
	return inner.split( ',' ).filter( ( part ) => part.trim() !== '' ).length;
}

/** Every coordinate in a shape value, in source order. */
function coords( value: string ): number[] {
	return Array.from( value.matchAll( /(-?\d+(?:\.\d+)?)%/g ) ).map( ( m ) =>
		Number( m[ 1 ] ),
	);
}

const PAIRS = {
	sweep: sweepPair(),
	rise: risePair(),
	iris: irisPair(),
	curtain: curtainPair(),
	blinds: blindsPair(),
	diagonal: diagonalPair(),
	shutter: shutterPair(),
	slats: slatsPair(),
	diamond: diamondPair(),
	mosaic: mosaicPair(),
	radar: radarPair(),
	obturator: obturatorPair(),
};

describe( 'reveals/shapes.ts — the interpolation contract', () => {
	test.each( Object.entries( PAIRS ) )(
		'%s: from and to use the same shape function',
		( _name, pair ) => {
			expect( shapeFunction( pair.from ) ).toBe( shapeFunction( pair.to ) );
			expect( shapeFunction( pair.from ) ).not.toBe( '' );
		},
	);

	test.each( Object.entries( PAIRS ) )(
		'%s: from and to have the same vertex count',
		( _name, pair ) => {
			expect( vertexCount( pair.from ) ).toBe( vertexCount( pair.to ) );
		},
	);

	test.each( Object.entries( PAIRS ) )(
		'%s: neither endpoint carries an explicit fill rule',
		( _name, pair ) => {
			// Holes are made by reverse winding under the default
			// `nonzero` rule. An `evenodd` keyword creeping into one
			// endpoint and not the other is a silent non-interpolable
			// pair, so assert neither has one at all.
			expect( pair.from ).not.toMatch( /evenodd|nonzero/ );
			expect( pair.to ).not.toMatch( /evenodd|nonzero/ );
		},
	);

	test( 'vertex count is independent of the animated dimension', () => {
		// The whole point of holding ring structure constant: two calls
		// to the same builder with different dimensions must stay
		// interpolable, not just the two endpoints we happen to ship.
		for ( const r of [ 0, 1, 12.5, 40, 80 ] ) {
			expect( vertexCount( irisSurface( r ) ) ).toBe(
				vertexCount( irisSurface( 0 ) ),
			);
		}
		for ( const w of [ 0, 3, 25, 52 ] ) {
			expect( vertexCount( curtainSurface( w ) ) ).toBe(
				vertexCount( curtainSurface( 0 ) ),
			);
		}
		for ( const h of [ 0, 2, 9, 17.2 ] ) {
			expect( vertexCount( blindsSurface( h ) ) ).toBe(
				vertexCount( blindsSurface( 0 ) ),
			);
		}
	} );
} );

describe( 'reveals/shapes.ts — coverage at the endpoints', () => {
	test( 'sweep starts covering the whole box and ends fully inset', () => {
		expect( sweepPair().from ).toBe( 'inset( 0% 0% 0% 0% )' );
		expect( sweepPair().to ).toBe( 'inset( 0% 0% 0% 100% )' );
	} );

	test( 'iris starts with a zero-radius hole', () => {
		// Every hole vertex collapsed onto the centre — nothing is
		// uncovered, which is what "surface fully covering" means.
		const hole = coords( irisSurface( 0 ) ).slice( 10 );
		expect( hole.every( ( n ) => n === 50 || n === 0 || n === 100 ) ).toBe(
			true,
		);
	} );

	test( 'iris ends with a hole that clears the corners', () => {
		// A corner sits ~70.71% from the centre on both axes. The
		// inscribed polygon must reach past that or the reveal leaves
		// four dark wedges behind at the end of the animation.
		const all = coords( irisPair().to );
		const maxima = Math.max( ...all.map( ( n ) => Math.abs( n - 50 ) ) );
		expect( maxima ).toBeGreaterThan( 70.71 );
	} );

	test( 'curtain ends with panels fully off the box', () => {
		// Hole half-width overshoots 50, so the two remaining panels
		// have travelled past the window edges rather than meeting them.
		const xs = coords( curtainPair().to ).filter( ( _n, i ) => i % 2 === 0 );
		expect( Math.min( ...xs ) ).toBeLessThan( 0 );
		expect( Math.max( ...xs ) ).toBeGreaterThan( 100 );
	} );

	test( 'blinds slats overlap at the end so no hairline survives', () => {
		// Each of the six holes must end at least one band tall; equal
		// to a band would leave sub-pixel seams on fractional heights.
		expect( blindsPair().to ).toBe( blindsSurface( 100 / 6 + 0.5 ) );
	} );

	test( 'diagonal ends entirely at or beyond the trailing edge', () => {
		const xs = coords( diagonalPair().to ).filter( ( _n, i ) => i % 2 === 0 );
		expect( Math.min( ...xs ) ).toBeGreaterThanOrEqual( 100 );
	} );

	/**
	 * The six aperture blades, as `[x, y]` pairs.
	 *
	 * The value is `outer(4) + outer[0] + hole(6) + hole[0] + outer[0]`,
	 * so the blades are the 6 vertices starting at index 5 — the
	 * trailing bridge vertices have to be excluded or `0% 0%` gets read
	 * as a blade sitting on the window corner.
	 */
	function blades( value: string ): [ number, number ][] {
		const all = coords( value );
		const out: [ number, number ][] = [];
		for ( let i = 10; i < 22; i += 2 ) {
			out.push( [ all[ i ], all[ i + 1 ] ] );
		}
		return out;
	}

	test( 'the obturator aperture starts closed', () => {
		// Every blade collapsed onto the centre — nothing uncovered.
		expect(
			blades( obturatorSurface( 0 ) ).every(
				( [ x, y ] ) => x === 50 && y === 50,
			),
		).toBe( true );
	} );

	test( 'the obturator aperture ends past the corners', () => {
		// A hexagon's INSCRIBED radius is what has to clear a corner
		// (~70.71%), not its circumscribed one — the corner sits
		// opposite an edge, not a vertex.
		const inscribed = blades( obturatorPair().to ).map(
			( [ x, y ] ) => Math.hypot( x - 50, y - 50 ) * Math.cos( Math.PI / 6 ),
		);
		expect( Math.min( ...inscribed ) ).toBeGreaterThan( 70.71 );
	} );

	test( 'the obturator rotates as it opens', () => {
		// The pivot is what makes it read as a mechanical iris rather
		// than a growing hexagon. Track one blade's bearing across the
		// animation: it has to turn, not merely move outward.
		const bearing = ( t: number ): number => {
			const [ x, y ] = blades( obturatorSurface( t ) )[ 0 ];
			return Math.atan2( y - 50, x - 50 );
		};
		expect( bearing( 1 ) ).toBeGreaterThan( bearing( 0.5 ) );
		expect( bearing( 0.5 ) ).toBeGreaterThan( bearing( 0.25 ) );
	} );

	test( 'diagonal starts covering the box at both extremes of y', () => {
		// At y=0 and y=100 the covered span must reach x=0, otherwise a
		// wedge of content shows before the animation begins.
		const from = diagonalPair().from;
		expect( from ).toContain( '-60% 0%' );
		expect( from ).toContain( '0% 100%' );
	} );
} );

describe( 'reveals/shapes.ts — polygonWithHoles', () => {
	const OUTER = [
		[ 0, 0 ],
		[ 100, 0 ],
		[ 100, 100 ],
		[ 0, 100 ],
	] as const;

	test( 'emits a bare polygon() with no holes', () => {
		expect( polygonWithHoles( OUTER ) ).toBe(
			'polygon( 0% 0%, 100% 0%, 100% 100%, 0% 100% )',
		);
	} );

	test( 'bridges each hole back to the outer ring start', () => {
		// One hole ⇒ outer(4) + outer[0] + hole(4) + hole[0] + outer[0].
		const withHole = polygonWithHoles( OUTER, [
			[
				[ 10, 10 ],
				[ 10, 20 ],
				[ 20, 20 ],
				[ 20, 10 ],
			],
		] );
		expect( vertexCount( withHole ) ).toBe( 11 );
		expect( withHole.endsWith( '0% 0% )' ) ).toBe( true );
	} );

	test( 'each additional hole costs a constant number of vertices', () => {
		const one = vertexCount(
			polygonWithHoles( OUTER, [ [ [ 1, 1 ], [ 1, 2 ], [ 2, 2 ], [ 2, 1 ] ] ] ),
		);
		const two = vertexCount(
			polygonWithHoles( OUTER, [
				[ [ 1, 1 ], [ 1, 2 ], [ 2, 2 ], [ 2, 1 ] ],
				[ [ 5, 5 ], [ 5, 6 ], [ 6, 6 ], [ 6, 5 ] ],
			] ),
		);
		expect( two - one ).toBe( 6 );
	} );

	test( 'rounds coordinates to three decimals', () => {
		const value = polygonWithHoles( [ [ 1 / 3, 2 / 3 ] ] );
		expect( value ).toBe( 'polygon( 0.333% 0.667% )' );
	} );
} );
