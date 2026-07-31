/**
 * Unit tests for `src/reveals/obturator.ts` — the camera-shutter
 * reveal, the one built-in that renders its own DOM.
 *
 * Two things are worth defending here, and they are different in kind.
 *
 * **The mechanism.** Six equilateral wedges have to cover the window
 * when closed, clear every corner when open, and open a centred
 * aperture that grows monotonically in between — while staying flush
 * against each other the whole way, which is the property that makes
 * tangential sliding work at all. Those are geometric facts, asserted
 * by computing them rather than by reading the markup back.
 *
 * **The rendering strategy.** A lens iris has a cyclic overlap, which a
 * linear paint order cannot represent. This reveal therefore animates
 * ONLY a translation per wedge under a shared mask — no restacking, no
 * z-index, no re-clipping. Those are the properties that make it
 * deterministic and compositor-friendly, and a well-meaning refactor
 * could quietly undo any of them, so they are pinned too.
 */
import { describe, expect, test } from 'vitest';
import {
	renderObturator,
	_obturatorCoversForTests as covers,
} from '../../src/reveals/obturator';

/** How many wedges cover a point, in viewBox units, at openness `t`. */
function leavesCovering( t: number, x: number, y: number ): number {
	let n = 0;
	for ( let i = 0; i < 6; i++ ) {
		if ( covers( i, t, x, y ) ) {
			n++;
		}
	}
	return n;
}

/** A sample of points spread across the viewBox. */
const GRID: [ number, number ][] = [];
for ( let x = 2; x <= 98; x += 4 ) {
	for ( let y = 2; y <= 98; y += 4 ) {
		GRID.push( [ x, y ] );
	}
}

describe( 'reveals/obturator.ts — the mechanism', () => {
	test( 'closed, the six wedges tile the whole window between them', () => {
		// Any gap here shows page content before the reveal even starts.
		for ( const [ x, y ] of GRID ) {
			expect( leavesCovering( 0, x, y ), `${ x },${ y }` ).toBeGreaterThan(
				0,
			);
		}
	} );

	test( 'fully open, no wedge still covers any of the window', () => {
		// The corners are the hard case: they sit furthest from centre,
		// so they are the last thing the aperture reaches.
		for ( const [ x, y ] of GRID ) {
			expect( leavesCovering( 1, x, y ), `${ x },${ y }` ).toBe( 0 );
		}
	} );

	test( 'the wedges stay flush the whole way — no gap opens off-centre', () => {
		// The property the whole design rests on. Sliding a wedge
		// tangentially offsets its shared edge by cos( 30° ) × d, and
		// its neighbour offsets that same edge by exactly as much, so
		// the pair stays joined for the entire travel.
		//
		// If that symmetry ever broke, a slit would open along a seam
		// somewhere out from the middle and the page would show through
		// it early. Such a slit is, by definition, DISCONNECTED from the
		// central aperture — so assert the uncovered region is star-
		// shaped about the centre: every cleared point can be reached
		// from the middle without crossing a wedge. That catches a stray
		// gap anywhere, without assuming the aperture's shape.
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
		// The apexes leave the centre along six different tangents, so
		// the hole they spread open is centred by construction.
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
		// Without the mask, a wedge's seam bleeds into the aperture it
		// helps form — the seam would land on the page showing through.
		const { element } = renderObturator();
		const mask = element.querySelector( 'mask' )!;
		const group = element.querySelector( 'g[mask]' )!;
		expect( group.getAttribute( 'mask' ) ).toBe(
			`url(#${ mask.getAttribute( 'id' ) })`,
		);
	} );

	test( 'two windows never share a mask id', () => {
		// Ids are document-global; a collision would make one window's
		// iris drive another's.
		const a = renderObturator().element.querySelector( 'mask' )!;
		const b = renderObturator().element.querySelector( 'mask' )!;
		expect( a.getAttribute( 'id' ) ).not.toBe( b.getAttribute( 'id' ) );
	} );

	test( 'every wedge is a triangle', () => {
		// Three corners, one closing `Z`. The equilateral wedge is what
		// makes the flush-sliding symmetry hold.
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
		// The tones tell neighbouring wedges apart; the seam makes every
		// edge render regardless of what is painted on top of it.
		const { element } = renderObturator();
		const wedges = Array.from(
			element.querySelectorAll< SVGPathElement >( 'g[mask] > path' ),
		);
		const fills = wedges.map( ( l ) => l.getAttribute( 'fill' ) );
		expect( new Set( fills ).size ).toBe( 6 );
		for ( const wedge of wedges ) {
			expect( wedge.getAttribute( 'stroke' ) ).toBeTruthy();
			// The viewBox is stretched to the window's aspect; without
			// this the seam stretches with it.
			expect( wedge.getAttribute( 'vector-effect' ) ).toBe(
				'non-scaling-stroke',
			);
		}
	} );

	test( 'play animates translation ONLY, on every wedge and its mask twin', () => {
		// The whole point of the SVG approach: no restacking, no
		// z-index, no re-clipping — just a slide per wedge. Anything
		// else creeping into the keyframes is the strategy being lost.
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

		// Six wedges plus their six twins inside the mask, so the mask
		// tracks the mechanism exactly.
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
			// Holds the mechanism shut through the delay, so it does not
			// ease open under the still-fading spinner.
			expect( call.options.fill ).toBe( 'both' );
		}
		// Six tangents, six directions — and each wedge's mask twin
		// takes the identical one, which is why the mask keeps tracking.
		expect( destinations.size ).toBe( 6 );

		delete ( Element.prototype as unknown as { animate?: unknown } ).animate;
	} );
} );
