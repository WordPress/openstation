import { describe, expect, test } from 'vitest';
import { MIO_DEFAULTS } from '../../src/mio/config';
import {
	buildRibbon,
	drawMio,
	eyeLayout,
	fillBand,
	fillSheen,
	type MioLayers,
	type RenderFrame,
	type RibbonSample,
} from '../../src/mio/render';
import type { Particle } from '../../src/mio/environment';
import type { MioAppearance } from '../../src/mio/types';

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

		expect( buildRibbon( ring( 12 ), CENTRE, 100 ) ).toHaveLength( 120 );
		expect( buildRibbon( ring( 10 ), CENTRE, 40 ) ).toHaveLength( 40 );
	} );

	test( 'the ring keeps its resolution when the rim is coarsened', () => {

		const coarse = buildRibbon( ring( 9 ), CENTRE, 144 );
		const fine = buildRibbon( ring( 36 ), CENTRE, 144 );
		expect( coarse.length ).toBeGreaterThanOrEqual( 144 );
		expect( fine.length ).toBeGreaterThanOrEqual( 144 );
	} );

	test( 'always yields an even count per segment, for the curve midpoints', () => {

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

			expect( s.nx * s.x + s.ny * s.y ).toBeGreaterThan( 0 );
		}
	} );

	test( 'a degenerate rim still yields usable normals', () => {

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

		const rim = ring( 8 );
		const samples = buildRibbon( rim, CENTRE, 4 );
		const spread = ( radii: number[] ): number =>
			Math.max( ...radii ) - Math.min( ...radii );

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

interface Cmd {
	op: 'moveTo' | 'lineTo' | 'quadraticCurveTo' | 'closePath' | 'poly';
	args: number[];
}

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

function outerEdge( cell: Cmd[] ): { start: number[]; end: number[] } {
	const move = cell.find( ( c ) => 'moveTo' === c.op );
	const curve = cell.find( ( c ) => 'quadraticCurveTo' === c.op );
	return {
		start: move ? move.args : [],

		end: curve ? curve.args.slice( 2, 4 ) : [],
	};
}

describe( 'fillBand', () => {

	const samples: RibbonSample[] = buildRibbon( ring( 10 ), CENTRE, 40 );
	const colors = samples.map( ( _, i ) => i );

	test( 'emits one curved cell per pair of samples', () => {
		const rec = recorder();
		fillBand( rec.g as never, samples, colors, 6, 2, 1, 2 );
		expect( rec.cells ).toHaveLength( samples.length / 2 );

		for ( const cell of rec.cells ) {
			expect(
				cell.filter( ( c ) => 'quadraticCurveTo' === c.op ),
			).toHaveLength( 2 );
		}
	} );

	test( 'the curve passes through the halfway sample', () => {

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

		const last = cells[ cells.length - 1 ];
		expect( last.filter( ( c ) => 'quadraticCurveTo' === c.op ) ).toHaveLength(
			1,
		);
		expect( last.filter( ( c ) => 'lineTo' === c.op ) ).toHaveLength( 1 );
	} );

	function shells(): number[] {

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

describe( 'the inner line', () => {

	const NAMES = [
		'halo',
		'bloom',
		'body',
		'sheen',
		'liner',
		'core',
		'eyes',
	] as const;

	function draw(
		over: Partial< MioAppearance > = {},
	): Record< ( typeof NAMES )[ number ], ReturnType< typeof recorder > > {
		const recs = Object.fromEntries(
			NAMES.map( ( name ) => [ name, recorder() ] ),
		) as Record< ( typeof NAMES )[ number ], ReturnType< typeof recorder > >;
		const layers = Object.fromEntries(
			NAMES.map( ( name ) => {
				const g = recs[ name ].g;

				Object.assign( g, { clear: () => g, roundRect: () => g } );
				return [ name, g ];
			} ),
		) as unknown as MioLayers;

		drawMio(
			layers,
			{
				rim: ring( 12 ),
				centre: CENTRE,
				radius: 50,
				elapsed: 0,
				gaze: null,
				blink: 0,
				tilt: { x: 1, y: 0 },
			},
			{ ...MIO_DEFAULTS.appearance, ...over },
		);
		return recs;
	}

	test( 'the shipped Mio wears one, in one flat colour', () => {

		const { liner } = draw();
		expect( liner.cells.length ).toBeGreaterThan( 0 );
		expect( new Set( liner.colors ) ).toEqual(
			new Set( [ MIO_DEFAULTS.appearance.linerColor ] ),
		);
	} );

	test( 'meets the ring exactly — no seam, no overlap', () => {

		const { liner, core } = draw();
		expect( liner.cells ).toHaveLength( core.cells.length );

		for ( let i = 0; i < liner.cells.length; i++ ) {
			const inner = core.cells[ i ];
			const outer = liner.cells[ i ];

			const innerB = inner.find( ( c ) => 'lineTo' === c.op )!.args;
			const backToA = inner.filter(
				( c ) => 'quadraticCurveTo' === c.op,
			)[ 1 ].args;

			const outerA = outer.find( ( c ) => 'moveTo' === c.op )!.args;
			const toOuterB = outer.find(
				( c ) => 'quadraticCurveTo' === c.op,
			)!.args;

			expect( outerA ).toEqual( backToA.slice( 2, 4 ) );
			expect( toOuterB.slice( 2, 4 ) ).toEqual( innerB );

			expect( toOuterB.slice( 0, 2 ) ).toEqual( backToA.slice( 0, 2 ) );
		}
	} );

	test( 'reaches inward, so the ring keeps its own width', () => {

		const thin = draw( { linerWidth: 1 } );
		const fat = draw( { linerWidth: 9 } );
		expect( fat.core.cmds ).toEqual( thin.core.cmds );

		const reach = ( rec: ReturnType< typeof recorder > ): number => {
			const radii = rec.cmds
				.filter( ( c ) => 'moveTo' === c.op || 'lineTo' === c.op )
				.map( ( c ) => Math.hypot( c.args[ 0 ], c.args[ 1 ] ) );
			return Math.max( ...radii ) - Math.min( ...radii );
		};
		expect( reach( fat.liner ) ).toBeGreaterThan( reach( thin.liner ) );
	} );

	test( 'zero draws nothing at all', () => {
		expect( draw( { linerWidth: 0 } ).liner.cmds ).toHaveLength( 0 );
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
