/**
 * Content Graph — sparse-board layout contract.
 *
 * Pins the three decisions that keep a small board centred on
 * screen: deterministic seeding with the centroid on the origin, a
 * warm-up that runs small boards to rest before the first paint, and
 * framing maths that centres the bounds and refuses a 0×0 viewport.
 * All renderer-free — `layout.ts` is pure and the sim is plain maths.
 */

import { describe, expect, test } from 'vitest';
import {
	frameBounds,
	randomSeed,
	seedPositions,
	SETTLE_ON_LOAD_MAX_NODES,
	SETTLE_ON_LOAD_MAX_STEPS,
	SMALL_BOARD_MAX_NODES,
	warmupStepLimit,
	type Point,
} from '../../src/content-graph/layout';
import { ForceSim } from '../../src/content-graph/sim';
import type { GraphNode } from '../../src/content-graph/types';

function makeNode( id: number, p: Point ): GraphNode {
	return {
		id,
		type: 'post',
		title: `Node ${ id }`,
		status: 'publish',
		slug: `node-${ id }`,
		edit_url: '',
		author_id: 0,
		contributor_ids: [],
		year: 2026,
		year_month: '2026-08',
		category_ids: [],
		tag_ids: [],
		x: p.x,
		y: p.y,
		vx: 0,
		vy: 0,
		pinned: false,
		radius: 8,
		color: 0,
		degree: 0,
	};
}

function centroid( points: Point[] ): Point {
	const n = points.length;
	return {
		x: points.reduce( ( s, p ) => s + p.x, 0 ) / n,
		y: points.reduce( ( s, p ) => s + p.y, 0 ) / n,
	};
}

/** Deterministic stand-in for Math.random. */
function lcg( seed: number ): () => number {
	let s = seed >>> 0;
	return () => {
		s = ( s * 1664525 + 1013904223 ) >>> 0;
		return s / 0x100000000;
	};
}

describe( 'seedPositions', () => {
	test( 'nothing for an empty board', () => {
		expect( seedPositions( 0 ) ).toEqual( [] );
	} );

	test( 'a lone node sits on the origin', () => {
		expect( seedPositions( 1 ) ).toEqual( [ { x: 0, y: 0 } ] );
	} );

	test( 'a pair opens side by side, not stacked', () => {
		const [ a, b ] = seedPositions( 2 );
		// Same row, mirrored across the origin.
		expect( a.y ).toBeCloseTo( 0, 6 );
		expect( b.y ).toBeCloseTo( 0, 6 );
		expect( a.x ).toBeCloseTo( -b.x, 6 );
		expect( a.x ).toBeLessThan( 0 );
	} );

	test( 'small boards are deterministic and centred on the origin', () => {
		for ( let n = 2; n <= SMALL_BOARD_MAX_NODES; n++ ) {
			const first = seedPositions( n, () => {
				throw new Error( 'small boards must not consume randomness' );
			} );
			const again = seedPositions( n );
			expect( again ).toEqual( first );
			const c = centroid( first );
			expect( c.x ).toBeCloseTo( 0, 6 );
			expect( c.y ).toBeCloseTo( 0, 6 );
			// Evenly spaced: every neighbour pair is the same distance
			// apart, so no two cards open on top of each other.
			const d = ( p: Point, q: Point ) => Math.hypot( p.x - q.x, p.y - q.y );
			const step = d( first[ 0 ], first[ 1 ] );
			for ( let i = 0; i < n; i++ ) {
				expect( d( first[ i ], first[ ( i + 1 ) % n ] ) ).toBeCloseTo( step, 6 );
			}
			expect( step ).toBeGreaterThan( 40 );
		}
	} );

	test( 'large boards keep the random spread but are recentred', () => {
		const n = SMALL_BOARD_MAX_NODES + 30;
		const seeds = seedPositions( n, lcg( 42 ) );
		expect( seeds ).toHaveLength( n );
		const c = centroid( seeds );
		expect( c.x ).toBeCloseTo( 0, 6 );
		expect( c.y ).toBeCloseTo( 0, 6 );
		// Still a spread, not a ring: distances from the origin vary.
		const radii = seeds.map( ( p ) => Math.hypot( p.x, p.y ) );
		expect( Math.max( ...radii ) - Math.min( ...radii ) ).toBeGreaterThan( 50 );
	} );

	test( 'randomSeed lands in the historical periphery band', () => {
		for ( let i = 0; i < 50; i++ ) {
			const p = randomSeed( lcg( i ) );
			const r = Math.hypot( p.x, p.y );
			expect( r ).toBeGreaterThanOrEqual( 150 );
			expect( r ).toBeLessThanOrEqual( 400 );
		}
	} );
} );

describe( 'warmupStepLimit', () => {
	test( 'small boards get the full settle budget', () => {
		expect( warmupStepLimit( 1 ) ).toBe( SETTLE_ON_LOAD_MAX_STEPS );
		expect( warmupStepLimit( SETTLE_ON_LOAD_MAX_NODES ) ).toBe(
			SETTLE_ON_LOAD_MAX_STEPS,
		);
	} );

	test( 'large boards keep the short warm-start', () => {
		expect( warmupStepLimit( SETTLE_ON_LOAD_MAX_NODES + 1 ) ).toBe(
			Math.min( 90, 30 + SETTLE_ON_LOAD_MAX_NODES + 1 ),
		);
		expect( warmupStepLimit( 500 ) ).toBe( 90 );
	} );

	test( 'the settle budget actually settles a small board', () => {
		// The point of the budget: two posts open on their final layout,
		// symmetric about the origin, and nothing moves after first paint.
		const nodes = seedPositions( 2 ).map( ( p, i ) => makeNode( i + 1, p ) );
		const sim = new ForceSim( nodes, [] );
		sim.reheat( 0.12, false );
		let steps = 0;
		for ( ; steps < warmupStepLimit( 2 ) && ! sim.isSettled; steps++ ) {
			sim.step( 1 );
		}
		expect( sim.isSettled ).toBe( true );
		expect( steps ).toBeLessThan( SETTLE_ON_LOAD_MAX_STEPS );
		const [ a, b ] = nodes;
		expect( a.x + b.x ).toBeCloseTo( 0, 3 );
		expect( a.y + b.y ).toBeCloseTo( 0, 3 );
		expect( Math.abs( a.y ) ).toBeLessThan( 1e-3 );
		// Repulsion 26000/d² against gravity 0.0035·r rests a pair
		// ~246 units apart; the seed ring starts them near there.
		const d = Math.hypot( a.x - b.x, a.y - b.y );
		expect( d ).toBeGreaterThan( 200 );
		expect( d ).toBeLessThan( 320 );
	} );

	test( 'a full ring settles within the budget too', () => {
		const n = SMALL_BOARD_MAX_NODES;
		const nodes = seedPositions( n ).map( ( p, i ) => makeNode( i + 1, p ) );
		const sim = new ForceSim( nodes, [] );
		sim.reheat( 0.12, false );
		for ( let i = 0; i < warmupStepLimit( n ) && ! sim.isSettled; i++ ) {
			sim.step( 1 );
		}
		expect( sim.isSettled ).toBe( true );
		const c = centroid( nodes );
		expect( c.x ).toBeCloseTo( 0, 3 );
		expect( c.y ).toBeCloseTo( 0, 3 );
	} );
} );

describe( 'frameBounds', () => {
	const opts = { padding: 100, minScale: 0.15, maxScale: 1.5 };

	test( 'centres the bounds in the viewport at the fit zoom', () => {
		const target = frameBounds(
			[
				{ x: -123, y: 0 },
				{ x: 123, y: 0 },
			],
			{ width: 1080, height: 720 },
			opts,
		);
		expect( target ).not.toBeNull();
		// 446 world units wide fits at 2.4× — clamped to the fit cap.
		expect( target!.scale ).toBe( 1.5 );
		// The bounds' centre is the origin, so the origin lands mid-view.
		expect( target!.x ).toBeCloseTo( 540, 6 );
		expect( target!.y ).toBeCloseTo( 360, 6 );
	} );

	test( 'an off-origin cluster is still centred', () => {
		const target = frameBounds(
			[
				{ x: 300, y: 200 },
				{ x: 500, y: 200 },
			],
			{ width: 1000, height: 600 },
			opts,
		);
		expect( target ).not.toBeNull();
		// world (400, 200) → screen (500, 300).
		expect( 400 * target!.scale + target!.x ).toBeCloseTo( 500, 6 );
		expect( 200 * target!.scale + target!.y ).toBeCloseTo( 300, 6 );
	} );

	test( 'zooms out to fit a wide board and respects the floor', () => {
		const wide = frameBounds(
			[
				{ x: -2000, y: 0 },
				{ x: 2000, y: 0 },
			],
			{ width: 1000, height: 600 },
			opts,
		);
		expect( wide!.scale ).toBeCloseTo( 1000 / 4200, 6 );
		const huge = frameBounds(
			[
				{ x: -50000, y: 0 },
				{ x: 50000, y: 0 },
			],
			{ width: 1000, height: 600 },
			opts,
		);
		expect( huge!.scale ).toBe( 0.15 );
	} );

	test( 'refuses a viewport with no size', () => {
		const points = [ { x: 0, y: 0 } ];
		expect( frameBounds( points, { width: 0, height: 600 }, opts ) ).toBeNull();
		expect( frameBounds( points, { width: 800, height: 0 }, opts ) ).toBeNull();
	} );

	test( 'refuses an empty point set', () => {
		expect( frameBounds( [], { width: 800, height: 600 }, opts ) ).toBeNull();
	} );
} );
