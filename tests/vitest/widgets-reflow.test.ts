import { describe, expect, it } from 'vitest';
import { clusterGeometry, reflowGeometry } from '../../src/widgets/reflow';

const card = ( x: number, y: number, width = 260, height = 200 ) => ( { x, y, width, height } );
const from = { width: 1600, height: 1000 };
const wider = { width: 2000, height: 1000 };

describe( 'widget reflow', () => {
	it( 'groups touching cards transitively and keeps loners apart', () => {
		const groups = clusterGeometry( {
			a: card( 500, 20 ),
			b: card( 780, 20 ),
			c: card( 1060, 20 ),
			far: card( 20, 700 ),
		} );
		expect( groups.map( ( g ) => g.sort() ).sort() ).toEqual( [ [ 'a', 'b', 'c' ], [ 'far' ] ] );
	} );

	it( 'moves a right-leaning group rigidly with the right edge', () => {
		const out = reflowGeometry( { a: card( 900, 20 ), b: card( 1180, 20 ) }, from, wider );
		expect( out.a.x ).toBe( 1300 );
		expect( out.b.x - out.a.x ).toBe( 280 );
		expect( out.a.y ).toBe( 20 );
	} );

	it( 'leaves a left group in place and keeps a centred one centred', () => {
		const out = reflowGeometry( { l: card( 20, 20 ), c: card( 670, 400 ) }, from, wider );
		expect( out.l.x ).toBe( 20 );
		expect( out.c.x ).toBe( 870 );
	} );

	it( 'is a no-op when the size did not change', () => {
		const g = { a: card( 900, 20 ) };
		expect( reflowGeometry( g, from, from ) ).toEqual( g );
	} );
} );
