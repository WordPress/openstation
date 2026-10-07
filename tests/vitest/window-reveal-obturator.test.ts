import { describe, expect, test } from 'vitest';
import {
	renderObturator,
	_obturatorCoversForTests as covers,
} from '../../src/reveals/obturator';

function leavesCovering( t: number, x: number, y: number ): number {
	let n = 0;
	for ( let i = 0; i < 6; i++ ) {
		if ( covers( i, t, x, y ) ) {
			n++;
		}
	}
	return n;
}

const GRID: [ number, number ][] = [];
for ( let x = 2; x <= 98; x += 4 ) {
	for ( let y = 2; y <= 98; y += 4 ) {
		GRID.push( [ x, y ] );
	}
}

describe( 'reveals/obturator.ts — the mechanism', () => {
	test( 'closed, the six wedges tile the whole window between them', () => {

		for ( const [ x, y ] of GRID ) {
			expect( leavesCovering( 0, x, y ), `${ x },${ y }` ).toBeGreaterThan(
				0,
			);
		}
	} );

	test( 'fully open, no wedge still covers any of the window', () => {

		for ( const [ x, y ] of GRID ) {
			expect( leavesCovering( 1, x, y ), `${ x },${ y }` ).toBe( 0 );
		}
	} );

	test( 'the wedges stay flush the whole way — no gap opens off-centre', () => {

		for ( const t of [ 0.15, 0.3, 0.45, 0.6, 0.8 ] ) {
			for ( const [ x, y ] of GRID ) {
				if ( leavesCovering( t, x, y ) !== 0 ) {
					continue;
				}
				for ( let step = 1; step < 12; step++ ) {
					const f = step / 12;
					const sx = 50 + ( x - 50 ) * f;
					const sy = 50 + ( y - 50 ) * f;
					expect(
						leavesCovering( t, sx, sy ),
						`t=${ t } path to ${ x },${ y }`,
					).toBe( 0 );
				}
			}
		}
	} );

	test( 'the aperture grows monotonically', () => {
		const open = [ 0, 0.25, 0.5, 0.75, 1 ].map(
			( t ) =>
				GRID.filter( ( [ x, y ] ) => leavesCovering( t, x, y ) === 0 )
					.length,
		);
		for ( let i = 1; i < open.length; i++ ) {
			expect( open[ i ] ).toBeGreaterThan( open[ i - 1 ] );
		}
	} );

	test( 'it opens from the centre and stays centred', () => {

		expect( leavesCovering( 0, 50, 50 ) ).toBeGreaterThan( 0 );
		for ( const t of [ 0.5, 0.75, 1 ] ) {
			expect( leavesCovering( t, 50, 50 ), `t=${ t }` ).toBe( 0 );
		}
	} );
} );

describe( 'reveals/obturator.ts — the rendering strategy', () => {
	test( 'renders six wedges, each also drawn into the mask', () => {
		const { element } = renderObturator();
		const svg = element.querySelector( 'svg' )!;
		expect( svg ).toBeTruthy();
		expect( svg.querySelectorAll( 'mask > g > path' ) ).toHaveLength( 6 );
		expect( svg.querySelectorAll( 'g[mask] > path' ) ).toHaveLength( 6 );
	} );

	test( 'the visible group is masked to the wedges’ union', () => {

		const { element } = renderObturator();
		const mask = element.querySelector( 'mask' )!;
		const group = element.querySelector( 'g[mask]' )!;
		expect( group.getAttribute( 'mask' ) ).toBe(
			`url(#${ mask.getAttribute( 'id' ) })`,
		);
	} );

	test( 'two windows never share a mask id', () => {

		const a = renderObturator().element.querySelector( 'mask' )!;
		const b = renderObturator().element.querySelector( 'mask' )!;
		expect( a.getAttribute( 'id' ) ).not.toBe( b.getAttribute( 'id' ) );
	} );

	test( 'every wedge is a triangle', () => {

		const { element } = renderObturator();
		for ( const wedge of Array.from(
			element.querySelectorAll< SVGPathElement >( 'g[mask] > path' ),
		) ) {
			const d = wedge.getAttribute( 'd' )!;
			expect( d.match( /-?\d+(\.\d+)?\s+-?\d+(\.\d+)?/g ) ).toHaveLength( 3 );
			expect( d.trim().endsWith( 'Z' ) ).toBe( true );
		}
	} );

	test( 'each wedge carries its own tone and a seam', () => {

		const { element } = renderObturator();
		const wedges = Array.from(
			element.querySelectorAll< SVGPathElement >( 'g[mask] > path' ),
		);
		const fills = wedges.map( ( l ) => l.getAttribute( 'fill' ) );
		expect( new Set( fills ).size ).toBe( 6 );
		for ( const wedge of wedges ) {
			expect( wedge.getAttribute( 'stroke' ) ).toBeTruthy();

			expect( wedge.getAttribute( 'vector-effect' ) ).toBe(
				'non-scaling-stroke',
			);
		}
	} );

	test( 'play animates translation ONLY, on every wedge and its mask twin', () => {

		const calls: { keyframes: Keyframe[]; options: KeyframeAnimationOptions }[] =
			[];
		( Element.prototype as unknown as { animate: unknown } ).animate =
			function ( keyframes: Keyframe[], options: KeyframeAnimationOptions ) {
				calls.push( { keyframes, options } );
				return { addEventListener: () => undefined, cancel: () => undefined };
			};

		const { play } = renderObturator();
		const animations = play( {
			duration: 500,
			easing: 'linear',
			delay: 120,
		} );

		expect( animations ).toHaveLength( 12 );
		expect( calls ).toHaveLength( 12 );
		const destinations = new Set< string >();
		for ( const call of calls ) {
			expect( Object.keys( call.keyframes[ 0 ] ) ).toEqual( [ 'transform' ] );
			expect( call.keyframes[ 0 ].transform ).toBe(
				'translate( 0px, 0px )',
			);
			expect( String( call.keyframes[ 1 ].transform ) ).toMatch(
				/^translate\( -?[\d.]+px, -?[\d.]+px \)$/,
			);
			destinations.add( String( call.keyframes[ 1 ].transform ) );
			expect( call.options.duration ).toBe( 500 );
			expect( call.options.easing ).toBe( 'linear' );
			expect( call.options.delay ).toBe( 120 );

			expect( call.options.fill ).toBe( 'both' );
		}

		expect( destinations.size ).toBe( 6 );

		delete ( Element.prototype as unknown as { animate?: unknown } ).animate;
	} );
} );
