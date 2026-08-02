/**
 * Mio renderer geometry — the resampled outline the whole ring is
 * built on, and the band tiling that keeps it continuous.
 *
 * The two properties worth defending here are the ones that were bugs
 * before the rewrite: the outline must be smooth regardless of how few
 * mass points the simulation runs, and consecutive quads of a band must
 * share their edges *exactly*, because any overlap doubles up under
 * additive blending and beads the ring at every joint.
 */
import { describe, expect, test } from 'vitest';
import { MIO_DEFAULTS } from '../../src/mio/config';
import {
	buildRibbon,
	eyeLayout,
	fillBand,
	fillSheen,
	type RenderFrame,
	type RibbonSample,
} from '../../src/mio/render';
import type { Particle } from '../../src/mio/environment';

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
	test( 'hits the requested total, rounded up to an even per-segment', () => {
		// 100 / 12 = 8.33 → 10 per segment (9 rounded up to even).
		expect( buildRibbon( ring( 12 ), CENTRE, 100 ) ).toHaveLength( 120 );
		expect( buildRibbon( ring( 10 ), CENTRE, 40 ) ).toHaveLength( 40 );
	} );

	test( 'the ring keeps its resolution when the rim is coarsened', () => {
		// The point of a total rather than a per-segment multiplier:
		// dropping the simulation to nine mass points must not coarsen
		// the colour ramp with it.
		const coarse = buildRibbon( ring( 9 ), CENTRE, 144 );
		const fine = buildRibbon( ring( 36 ), CENTRE, 144 );
		expect( coarse.length ).toBeGreaterThanOrEqual( 144 );
		expect( fine.length ).toBeGreaterThanOrEqual( 144 );
	} );

	test( 'always yields an even count per segment, for the curve midpoints', () => {
		// A cell spans two samples and curves through the one between
		// them; an odd per-segment count would leave cells straddling a
		// segment boundary with no midpoint of their own.
		for ( const n of [ 7, 9, 11, 13 ] ) {
			expect( buildRibbon( ring( n ), CENTRE, 50 ).length % 2 ).toBe( 0 );
		}
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

/** One recorded path command. */
interface Cmd {
	op: 'moveTo' | 'lineTo' | 'quadraticCurveTo' | 'closePath' | 'poly';
	args: number[];
}

/**
 * Minimal stand-in for the slice of `Graphics` the renderer uses.
 *
 * Records the path commands verbatim so the tests can assert on the
 * geometry actually handed to Pixi rather than on a summary of it.
 */
function recorder(): {
	cmds: Cmd[];
	cells: Cmd[][];
	g: Record< string, ( ...args: never[] ) => unknown >;
	colors: number[];
} {
	const cmds: Cmd[] = [];
	const colors: number[] = [];
	const record =
		( op: Cmd[ 'op' ] ) =>
		( ...args: number[] ): unknown => {
			cmds.push( { op, args } );
			return g;
		};
	const g = {
		moveTo: record( 'moveTo' ),
		lineTo: record( 'lineTo' ),
		quadraticCurveTo: record( 'quadraticCurveTo' ),
		closePath: record( 'closePath' ),
		poly: ( p: number[] ): unknown => {
			cmds.push( { op: 'poly', args: p } );
			return g;
		},
		fill: ( style: unknown ): unknown => {
			colors.push( ( style as { color: number } ).color );
			return g;
		},
	} as unknown as Record< string, ( ...args: never[] ) => unknown >;

	return {
		cmds,
		// One group per `fill()`, i.e. per cell.
		get cells(): Cmd[][] {
			const out: Cmd[][] = [];
			let current: Cmd[] = [];
			for ( const c of cmds ) {
				current.push( c );
				if ( 'closePath' === c.op || 'poly' === c.op ) {
					out.push( current );
					current = [];
				}
			}
			return out;
		},
		g,
		colors,
	};
}

/** First and last anchor of a recorded cell's outer edge. */
function outerEdge( cell: Cmd[] ): { start: number[]; end: number[] } {
	const move = cell.find( ( c ) => 'moveTo' === c.op );
	const curve = cell.find( ( c ) => 'quadraticCurveTo' === c.op );
	return {
		start: move ? move.args : [],
		// `quadraticCurveTo( cx, cy, x, y, smoothness )` — the control
		// point, then the end anchor, then the tessellation tolerance.
		end: curve ? curve.args.slice( 2, 4 ) : [],
	};
}

describe( 'fillBand', () => {
	// Eight samples per rim segment, so a stride of 2 still leaves a
	// halfway sample for every cell.
	const samples: RibbonSample[] = buildRibbon( ring( 10 ), CENTRE, 40 );
	const colors = samples.map( ( _, i ) => i );

	test( 'emits one curved cell per pair of samples', () => {
		const rec = recorder();
		fillBand( rec.g as never, samples, colors, 6, 2, 1, 2 );
		expect( rec.cells ).toHaveLength( samples.length / 2 );
		// Two curved edges per cell — outer and inner. A cell with
		// straight edges here means the control-point path was skipped
		// and the facets are back.
		for ( const cell of rec.cells ) {
			expect(
				cell.filter( ( c ) => 'quadraticCurveTo' === c.op ),
			).toHaveLength( 2 );
		}
	} );

	test( 'the curve passes through the halfway sample', () => {
		// The whole point of the control-point solve: at t = 0.5 the
		// quadratic must sit exactly on the ribbon, not inside the chord.
		const rec = recorder();
		fillBand( rec.g as never, samples, colors, 6, 2, 1, 2 );
		const cell = rec.cells[ 0 ];
		const [ ax, ay ] = outerEdge( cell ).start;
		const curve = cell.find( ( c ) => 'quadraticCurveTo' === c.op ) as Cmd;
		const [ cx, cy, bx, by ] = curve.args;
		const midX = ( ax + 2 * cx + bx ) / 4;
		const midY = ( ay + 2 * cy + by ) / 4;
		const halfway = samples[ 1 ];
		expect( midX ).toBeCloseTo( halfway.x + halfway.nx * 6, 9 );
		expect( midY ).toBeCloseTo( halfway.y + halfway.ny * 6, 9 );
	} );

	test( 'consecutive cells share their edge exactly', () => {
		// This is the anti-beading invariant. Anything less than bit
		// equality here is either a seam of wallpaper showing through or
		// a double-covered joint glowing twice as bright.
		const rec = recorder();
		fillBand( rec.g as never, samples, colors, 6, 2, 1, 2 );
		const cells = rec.cells;
		for ( let i = 0; i < cells.length; i++ ) {
			const cur = outerEdge( cells[ i ] );
			const next = outerEdge( cells[ ( i + 1 ) % cells.length ] );
			expect( cur.end ).toEqual( next.start );
		}
	} );

	test( 'a wider stride decimates without breaking the loop', () => {
		const rec = recorder();
		fillBand( rec.g as never, samples, colors, 6, 2, 1, 4 );
		expect( rec.cells ).toHaveLength( samples.length / 4 );
		const cells = rec.cells;
		expect( outerEdge( cells[ cells.length - 1 ] ).end ).toEqual(
			outerEdge( cells[ 0 ] ).start,
		);
	} );

	test( 'an odd stride falls back to straight edges', () => {
		// No halfway sample to curve through, so the cell has to stay a
		// flat quad rather than inventing a control point.
		const rec = recorder();
		fillBand( rec.g as never, samples, colors, 6, 2, 1, 3 );
		expect( rec.cmds.every( ( c ) => 'poly' === c.op ) ).toBe( true );
	} );

	test( 'a transparent or zero-width band draws nothing', () => {
		const rec = recorder();
		fillBand( rec.g as never, samples, colors, 6, 2, 0 );
		fillBand( rec.g as never, samples, colors, 0, 0, 1 );
		expect( rec.cmds ).toHaveLength( 0 );
	} );
} );

describe( 'fillSheen', () => {
	const samples: RibbonSample[] = buildRibbon( ring( 12 ), CENTRE, 48 );
	const colors = samples.map( () => 0xff00ff );

	/** Every alpha the sheen asked for, in draw order. */
	function alphas( scale = 1 ): number[] {
		const seen: number[] = [];
		const noop = (): unknown => g;
		const g = {
			poly: noop,
			moveTo: noop,
			lineTo: noop,
			quadraticCurveTo: noop,
			closePath: noop,
			fill: ( style: unknown ) => {
				seen.push( ( style as { alpha: number } ).alpha );
				return g;
			},
		};
		fillSheen( g as never, samples, CENTRE, colors, scale );
		return seen;
	}

	test( 'the shells are drawn as curves, and the innermost as wedges', () => {
		const rec = recorder();
		fillSheen( rec.g as never, samples, CENTRE, colors, 1 );
		const cells = rec.cells;
		expect( cells.length ).toBeGreaterThan( 0 );
		expect( cells.every( ( c ) => c.some( ( x ) => 'quadraticCurveTo' === x.op ) ) )
			.toBe( true );
		// The innermost shell collapses to the centroid: one curved arc
		// closed by two straight radii, never a zero-length curve
		// between three coincident points.
		const last = cells[ cells.length - 1 ];
		expect( last.filter( ( c ) => 'quadraticCurveTo' === c.op ) ).toHaveLength(
			1,
		);
		expect( last.filter( ( c ) => 'lineTo' === c.op ) ).toHaveLength( 1 );
	} );

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
		const open = eyeLayout( frame(), MIO_DEFAULTS.appearance );
		const shut = eyeLayout( frame( { blink: 1 } ), MIO_DEFAULTS.appearance );
		expect( shut.height ).toBeLessThan( open.height * 0.1 );
		expect( shut.left ).toEqual( open.left );
	} );

	test( 'gaze saturates instead of sliding off the face', () => {
		const near = eyeLayout(
			frame( { gaze: { x: 120, y: 0 } } ),
			MIO_DEFAULTS.appearance,
		);
		const far = eyeLayout(
			frame( { gaze: { x: 9000, y: 0 } } ),
			MIO_DEFAULTS.appearance,
		);
		expect( far.left.x ).toBeGreaterThan( near.left.x );
		expect( far.left.x - near.left.x ).toBeLessThan( 5 );
	} );
} );
