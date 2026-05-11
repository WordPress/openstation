/**
 * Unit tests for the cluster-attractor force added to ForceSim in
 * 0.9.0. Covers convergence, multi-cluster between-balance,
 * uncategorized fallback, pinned nodes, and the disable paths
 * (membership null / strength zero).
 */
import { describe, expect, test } from 'vitest';
import {
	DEFAULT_SIM_OPTIONS,
	ForceSim,
	type ClusterMembership,
} from '../../src/content-graph/sim';
import type { GraphEdge, GraphNode } from '../../src/content-graph/types';

function makeNode( id: number, x: number, y: number ): GraphNode {
	return {
		id,
		type: 'post',
		title: `n${ id }`,
		status: 'publish',
		slug: `n${ id }`,
		edit_url: '',
		terms: {},
		x,
		y,
		vx: 0,
		vy: 0,
		pinned: false,
		radius: 4,
		color: 0,
		degree: 0,
	};
}

function tickN( sim: ForceSim, n: number ): void {
	for ( let i = 0; i < n; i++ ) {
		sim.step( 1 );
	}
}

describe( 'ForceSim cluster attractor', () => {
	test( 'converges members toward a single cluster centroid', () => {
		// Three members in a wide ring around the origin; centroid sits
		// near origin and members should drift inward over time.
		const a = makeNode( 1, -200, 0 );
		const b = makeNode( 2, 200, 0 );
		const c = makeNode( 3, 0, 200 );
		const sim = new ForceSim(
			[ a, b, c ],
			[],
			{ ...DEFAULT_SIM_OPTIONS, attractorStrength: 0.05 },
		);
		const membership: ClusterMembership = new Map( [
			[ 1, [ 'cluster_a' ] ],
			[ 2, [ 'cluster_a' ] ],
			[ 3, [ 'cluster_a' ] ],
		] );
		sim.setClusters( membership );

		const initialSpread =
			Math.hypot( a.x - 0, a.y - 0 ) +
			Math.hypot( b.x - 0, b.y - 0 ) +
			Math.hypot( c.x - 0, c.y - 0 );
		tickN( sim, 200 );
		const finalSpread =
			Math.hypot( a.x - 0, a.y - 0 ) +
			Math.hypot( b.x - 0, b.y - 0 ) +
			Math.hypot( c.x - 0, c.y - 0 );
		expect( finalSpread ).toBeLessThan( initialSpread );
	} );

	test( 'multi-cluster node settles between cluster centroids (Covers AE1)', () => {
		// Two clusters separated on the x-axis, with a "shared" node
		// that belongs to both. The shared node should equilibrate
		// roughly on the line between the two cluster centroids.
		const left1 = makeNode( 1, -300, 0 );
		const left2 = makeNode( 2, -290, 30 );
		const right1 = makeNode( 3, 300, 0 );
		const right2 = makeNode( 4, 290, -30 );
		const shared = makeNode( 5, 0, 200 );
		const sim = new ForceSim(
			[ left1, left2, right1, right2, shared ],
			[],
			{ ...DEFAULT_SIM_OPTIONS, attractorStrength: 0.08 },
		);
		const membership: ClusterMembership = new Map( [
			[ 1, [ 'L' ] ],
			[ 2, [ 'L' ] ],
			[ 3, [ 'R' ] ],
			[ 4, [ 'R' ] ],
			[ 5, [ 'L', 'R' ] ],
		] );
		sim.setClusters( membership );
		tickN( sim, 400 );
		// Shared node settles closer to the x-axis than to either
		// extreme; |x| smaller than the cluster centroids' |x|.
		expect( Math.abs( shared.x ) ).toBeLessThan( 200 );
	} );

	test( 'uncategorized members orbit the uncategorized centroid', () => {
		// Two non-overlapping cluster keys. Members keyed only to
		// '__uncategorized__' should clump together separately from
		// the named cluster.
		const a = makeNode( 1, -200, -200 );
		const b = makeNode( 2, -200, 200 );
		const u1 = makeNode( 3, 200, 0 );
		const u2 = makeNode( 4, 250, 50 );
		const sim = new ForceSim(
			[ a, b, u1, u2 ],
			[],
			{ ...DEFAULT_SIM_OPTIONS, attractorStrength: 0.05 },
		);
		const membership: ClusterMembership = new Map( [
			[ 1, [ 'real' ] ],
			[ 2, [ 'real' ] ],
			[ 3, [ '__uncategorized__' ] ],
			[ 4, [ '__uncategorized__' ] ],
		] );
		sim.setClusters( membership );
		tickN( sim, 300 );
		// real-cluster members closer to each other than to the
		// uncategorized members.
		const realPairDist = Math.hypot( a.x - b.x, a.y - b.y );
		const crossDist1 = Math.hypot( a.x - u1.x, a.y - u1.y );
		const crossDist2 = Math.hypot( b.x - u2.x, b.y - u2.y );
		expect( realPairDist ).toBeLessThan( crossDist1 );
		expect( realPairDist ).toBeLessThan( crossDist2 );
	} );

	test( 'membership = null disables the force entirely', () => {
		const a = makeNode( 1, -100, 0 );
		const b = makeNode( 2, 100, 0 );
		const simOff = new ForceSim(
			[ a, b ],
			[],
			{ ...DEFAULT_SIM_OPTIONS, attractorStrength: 0.5 },
		);
		simOff.setClusters( null );
		const beforeDist = Math.hypot( a.x - b.x, a.y - b.y );
		tickN( simOff, 50 );
		const afterDist = Math.hypot( a.x - b.x, a.y - b.y );
		// With repulsion only and no attractor, distance grows or
		// stays put — definitely doesn't shrink dramatically.
		expect( afterDist ).toBeGreaterThanOrEqual( beforeDist - 1 );
	} );

	test( 'attractorStrength = 0 disables the force regardless of membership', () => {
		const a = makeNode( 1, -100, 0 );
		const b = makeNode( 2, 100, 0 );
		const sim = new ForceSim(
			[ a, b ],
			[],
			{ ...DEFAULT_SIM_OPTIONS, attractorStrength: 0 },
		);
		sim.setClusters(
			new Map( [
				[ 1, [ 'L' ] ],
				[ 2, [ 'L' ] ],
			] ),
		);
		const beforeDist = Math.hypot( a.x - b.x, a.y - b.y );
		tickN( sim, 50 );
		const afterDist = Math.hypot( a.x - b.x, a.y - b.y );
		// No attractor pull: gap should not collapse.
		expect( afterDist ).toBeGreaterThanOrEqual( beforeDist * 0.9 );
	} );

	test( 'pinned nodes are not displaced by the attractor', () => {
		const a = makeNode( 1, -200, -200 );
		a.pinned = true;
		const b = makeNode( 2, 200, 200 );
		const sim = new ForceSim(
			[ a, b ],
			[],
			{ ...DEFAULT_SIM_OPTIONS, attractorStrength: 0.5 },
		);
		sim.setClusters(
			new Map( [
				[ 1, [ 'L' ] ],
				[ 2, [ 'L' ] ],
			] ),
		);
		const ax = a.x;
		const ay = a.y;
		tickN( sim, 50 );
		expect( a.x ).toBe( ax );
		expect( a.y ).toBe( ay );
	} );

	test( 'setForceConfig allows live config swap', () => {
		const a = makeNode( 1, -100, 0 );
		const b = makeNode( 2, 100, 0 );
		const sim = new ForceSim(
			[ a, b ],
			[],
			{ ...DEFAULT_SIM_OPTIONS, attractorStrength: 0 },
		);
		sim.setClusters(
			new Map( [
				[ 1, [ 'L' ] ],
				[ 2, [ 'L' ] ],
			] ),
		);
		// Off → no convergence.
		const beforeDist = Math.hypot( a.x - b.x, a.y - b.y );
		tickN( sim, 50 );
		const midDist = Math.hypot( a.x - b.x, a.y - b.y );
		expect( midDist ).toBeGreaterThanOrEqual( beforeDist * 0.9 );

		// Flip strength on; expect convergence on subsequent ticks.
		sim.setForceConfig( { attractorStrength: 0.05 } );
		sim.reheat( 0.3, false );
		tickN( sim, 200 );
		const afterDist = Math.hypot( a.x - b.x, a.y - b.y );
		expect( afterDist ).toBeLessThan( midDist );
	} );
} );
