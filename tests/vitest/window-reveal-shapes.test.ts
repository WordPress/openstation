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
	polygonWithHoles,
	radarPair,
	risePair,
	shutterPair,
	slatsPair,
	sweepPair,
} from '../../src/reveals/shapes';

function shapeFunction( value: string ): string {
	return ( /^\s*([a-zA-Z-]+)\s*\(/.exec( value ) ?? [ '', '' ] )[ 1 ];
}

function vertexCount( value: string ): number {
	const inner = value.slice( value.indexOf( '(' ) + 1, value.lastIndexOf( ')' ) );
	return inner.split( ',' ).filter( ( part ) => part.trim() !== '' ).length;
}

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
};

function vertices( value: string ): [ number, number ][] {
	const inner = value.slice( value.indexOf( '(' ) + 1, value.lastIndexOf( ')' ) );
	return inner
		.split( ',' )
		.map( ( part ) => part.trim() )
		.filter( Boolean )
		.map( ( part ) => {
			const [ x, y ] = part.split( /\s+/ ).map( ( n ) => parseFloat( n ) );
			return [ x, y ] as [ number, number ];
		} );
}

function covers( value: string, x: number, y: number ): boolean {
	const pts = vertices( value );
	let inside = false;
	for ( let i = 0, j = pts.length - 1; i < pts.length; j = i++ ) {
		const [ xi, yi ] = pts[ i ];
		const [ xj, yj ] = pts[ j ];
		if (
			yi > y !== yj > y &&
			x < ( ( xj - xi ) * ( y - yi ) ) / ( yj - yi ) + xi
		) {
			inside = ! inside;
		}
	}
	return inside;
}

function bladesCovering( t: number, x: number, y: number ): number {
	let n = 0;
	for ( let i = 0; i < 6; i++ ) {
		if ( covers( obturatorBlade( i, t ), x, y ) ) {
			n++;
		}
	}
	return n;
}

const GRID: [ number, number ][] = [];
for ( let x = 2; x <= 98; x += 8 ) {
	for ( let y = 2; y <= 98; y += 8 ) {
		GRID.push( [ x, y ] );
	}
}

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

			expect( pair.from ).not.toMatch( /evenodd|nonzero/ );
			expect( pair.to ).not.toMatch( /evenodd|nonzero/ );
		},
	);

	test( 'vertex count is independent of the animated dimension', () => {

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

		const hole = coords( irisSurface( 0 ) ).slice( 10 );
		expect( hole.every( ( n ) => n === 50 || n === 0 || n === 100 ) ).toBe(
			true,
		);
	} );

	test( 'iris ends with a hole that clears the corners', () => {

		const all = coords( irisPair().to );
		const maxima = Math.max( ...all.map( ( n ) => Math.abs( n - 50 ) ) );
		expect( maxima ).toBeGreaterThan( 70.71 );
	} );

	test( 'curtain ends with panels fully off the box', () => {

		const xs = coords( curtainPair().to ).filter( ( _n, i ) => i % 2 === 0 );
		expect( Math.min( ...xs ) ).toBeLessThan( 0 );
		expect( Math.max( ...xs ) ).toBeGreaterThan( 100 );
	} );

	test( 'blinds slats overlap at the end so no hairline survives', () => {

		expect( blindsPair().to ).toBe( blindsSurface( 100 / 6 + 0.5 ) );
	} );

	test( 'diagonal ends entirely at or beyond the trailing edge', () => {
		const xs = coords( diagonalPair().to ).filter( ( _n, i ) => i % 2 === 0 );
		expect( Math.min( ...xs ) ).toBeGreaterThanOrEqual( 100 );
	} );

	function blades( value: string ): [ number, number ][] {
		const all = coords( value );
		const out: [ number, number ][] = [];
		for ( let i = 10; i < 22; i += 2 ) {
			out.push( [ all[ i ], all[ i + 1 ] ] );
		}
		return out;
	}

	test( 'diagonal starts covering the box at both extremes of y', () => {

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
