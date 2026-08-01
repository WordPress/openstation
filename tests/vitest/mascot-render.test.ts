/**
 * Mascot renderer geometry — the resampled outline the whole ring is
 * built on, and the band tiling that keeps it continuous.
 *
 * The two properties worth defending here are the ones that were bugs
 * before the rewrite: the outline must be smooth regardless of how few
 * mass points the simulation runs, and consecutive quads of a band must
 * share their edges *exactly*, because any overlap doubles up under
 * additive blending and beads the ring at every joint.
 */
import { describe, expect, test } from 'vitest';
import { MASCOT_DEFAULTS } from '../../src/mascot/config';
import {
	buildRibbon,
	eyeLayout,
	fillBand,
	fillSheen,
	type RenderFrame,
	type RibbonSample,
} from '../../src/mascot/render';
import type { Particle } from '../../src/mascot/environment';

/** A rim of `n` points on a circle of `r` about the origin. */
function ring( n: number, r = 50 ): Particle[] {
	const out: Particle[] = [];
	for ( let i = 0; i < n; i++ ) {
		const a = ( i / n ) * Math.PI * 2;
		out.push( { x: Math.cos( a ) * r, y: Math.sin( a ) * r, vx: 0, vy: 0 } );
	}
	return out;
}

const CENTRE = { x: 0, y: 0 };

describe( 'buildRibbon', () => {
	test( 'resamples the rim at the requested density', () => {
		expect( buildRibbon( ring( 12 ), CENTRE, 3 ) ).toHaveLength( 36 );
	} );

	test( 'a rim too short to be a polygon draws nothing', () => {
		expect( buildRibbon( ring( 2 ), CENTRE ) ).toEqual( [] );
	} );

	test( 'normals are unit length and point outward', () => {
		for ( const s of buildRibbon( ring( 16 ), CENTRE ) ) {
			expect( Math.hypot( s.nx, s.ny ) ).toBeCloseTo( 1, 6 );
			// Outward means agreeing with the direction from the centre.
			expect( s.nx * s.x + s.ny * s.y ).toBeGreaterThan( 0 );
		}
	} );

	test( 'a degenerate rim still yields usable normals', () => {
		// Every point coincident: the curve has no tangent anywhere, so
		// the radial fallback is the only thing standing between this
		// and a NaN-poisoned frame.
		const collapsed: Particle[] = [
			{ x: 10, y: 0, vx: 0, vy: 0 },
			{ x: 10, y: 0, vx: 0, vy: 0 },
			{ x: 10, y: 0, vx: 0, vy: 0 },
		];
		for ( const s of buildRibbon( collapsed, CENTRE ) ) {
			expect( Number.isFinite( s.nx ) ).toBe( true );
			expect( Number.isFinite( s.ny ) ).toBe( true );
		}
	} );

	test( 'smoothing beats the polygon it came from', () => {
		// The sampled outline of a coarse circle sits closer to the true
		// circle than the raw rim does — that is the whole reason the
		// simulation can be coarsened without the edge going faceted.
		const rim = ring( 8 );
		const samples = buildRibbon( rim, CENTRE, 4 );
		const spread = ( radii: number[] ): number =>
			Math.max( ...radii ) - Math.min( ...radii );
		// Chaikin-style smoothing shrinks the shape slightly, so compare
		// how *round* each is rather than how big.
		const smoothed = samples.map( ( s ) => Math.hypot( s.x, s.y ) );
		const chords: number[] = [];
		for ( let i = 0; i < rim.length; i++ ) {
			const a = rim[ i ];
			const b = rim[ ( i + 1 ) % rim.length ];
			for ( let k = 0; k < 4; k++ ) {
				const u = k / 4;
				chords.push(
					Math.hypot( a.x + ( b.x - a.x ) * u, a.y + ( b.y - a.y ) * u ),
				);
			}
		}
		expect( spread( smoothed ) ).toBeLessThan( spread( chords ) );
	} );
} );

/** Minimal stand-in for the slice of `Graphics` the bands use. */
function recorder(): {
	quads: number[][];
	g: { poly: ( p: number[] ) => unknown; fill: ( s: unknown ) => unknown };
	colors: number[];
} {
	const quads: number[][] = [];
	const colors: number[] = [];
	const g = {
		poly: ( p: number[] ) => {
			quads.push( p );
			return g;
		},
		fill: ( style: unknown ) => {
			colors.push( ( style as { color: number } ).color );
			return g;
		},
	};
	return { quads, g, colors };
}

describe( 'fillBand', () => {
	const samples: RibbonSample[] = buildRibbon( ring( 10 ), CENTRE, 2 );
	const colors = samples.map( ( _, i ) => i );

	test( 'emits one quad per sample and closes the ring', () => {
		const rec = recorder();
		fillBand(
			rec.g as never,
			samples,
			colors,
			6,
			2,
			1,
		);
		expect( rec.quads ).toHaveLength( samples.length );
		expect( rec.colors ).toEqual( colors );
	} );

	test( 'consecutive quads share their edge exactly', () => {
		// This is the anti-beading invariant. Anything less than bit
		// equality here is either a seam of wallpaper showing through or
		// a double-covered joint glowing twice as bright.
		const rec = recorder();
		fillBand( rec.g as never, samples, colors, 6, 2, 1 );
		for ( let i = 0; i < rec.quads.length; i++ ) {
			const cur = rec.quads[ i ];
			const next = rec.quads[ ( i + 1 ) % rec.quads.length ];
			// Current quad's trailing outer/inner pair is the next
			// quad's leading pair.
			expect( [ cur[ 2 ], cur[ 3 ] ] ).toEqual( [ next[ 0 ], next[ 1 ] ] );
			expect( [ cur[ 4 ], cur[ 5 ] ] ).toEqual( [ next[ 6 ], next[ 7 ] ] );
		}
	} );

	test( 'stride decimates without breaking the loop', () => {
		const rec = recorder();
		fillBand( rec.g as never, samples, colors, 6, 2, 1, 2 );
		expect( rec.quads ).toHaveLength( samples.length / 2 );
		const last = rec.quads[ rec.quads.length - 1 ];
		const first = rec.quads[ 0 ];
		expect( [ last[ 2 ], last[ 3 ] ] ).toEqual( [ first[ 0 ], first[ 1 ] ] );
	} );

	test( 'a transparent or zero-width band draws nothing', () => {
		const rec = recorder();
		fillBand( rec.g as never, samples, colors, 6, 2, 0 );
		fillBand( rec.g as never, samples, colors, 0, 0, 1 );
		expect( rec.quads ).toHaveLength( 0 );
	} );
} );

describe( 'fillSheen', () => {
	const samples: RibbonSample[] = buildRibbon( ring( 12 ), CENTRE, 2 );
	const colors = samples.map( () => 0xff00ff );

	/** Every alpha the sheen asked for, in draw order. */
	function alphas( scale = 1 ): number[] {
		const seen: number[] = [];
		const g = {
			poly: () => g,
			fill: ( style: unknown ) => {
				seen.push( ( style as { alpha: number } ).alpha );
				return g;
			},
		};
		fillSheen( g as never, samples, CENTRE, colors, scale );
		return seen;
	}

	/** Shell alphas in order, outermost first. */
	function shells(): number[] {
		// Each shell is drawn in full before the next one starts.
		return [ ...new Set( alphas() ) ];
	}

	test( 'the shells fade inward', () => {
		const ordered = shells();
		expect( ordered.length ).toBeGreaterThan( 3 );
		for ( let i = 1; i < ordered.length; i++ ) {
			expect( ordered[ i ] ).toBeLessThan( ordered[ i - 1 ] );
		}
	} );

	test( 'the body still reads as black', () => {
		// The shells are adjacent rather than nested, so the brightest
		// lift anywhere inside the body is simply the largest alpha. The
		// sheen is a film over black, not a paint job — well under half
		// coverage even at its hottest.
		expect( Math.max( ...shells() ) ).toBeLessThan( 0.4 );
	} );

	test( 'strength scales every shell and zero draws nothing', () => {
		expect( Math.max( ...alphas( 0.5 ) ) ).toBeCloseTo(
			Math.max( ...alphas() ) * 0.5,
			6,
		);
		expect( alphas( 0 ) ).toHaveLength( 0 );
	} );
} );

describe( 'eyeLayout', () => {
	const frame = ( over: Partial< RenderFrame > = {} ): RenderFrame => ( {
		rim: ring( 20 ),
		centre: CENTRE,
		radius: 50,
		elapsed: 0,
		gaze: null,
		blink: 0,
		tilt: { x: 1, y: 0 },
		...over,
	} );

	test( 'a blink collapses the pills without moving them', () => {
		const open = eyeLayout( frame(), MASCOT_DEFAULTS.appearance );
		const shut = eyeLayout( frame( { blink: 1 } ), MASCOT_DEFAULTS.appearance );
		expect( shut.height ).toBeLessThan( open.height * 0.1 );
		expect( shut.left ).toEqual( open.left );
	} );

	test( 'gaze saturates instead of sliding off the face', () => {
		const near = eyeLayout(
			frame( { gaze: { x: 120, y: 0 } } ),
			MASCOT_DEFAULTS.appearance,
		);
		const far = eyeLayout(
			frame( { gaze: { x: 9000, y: 0 } } ),
			MASCOT_DEFAULTS.appearance,
		);
		expect( far.left.x ).toBeGreaterThan( near.left.x );
		expect( far.left.x - near.left.x ).toBeLessThan( 5 );
	} );
} );
