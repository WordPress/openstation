import { describe, expect, test } from 'vitest';
import { ForceSim } from '../../src/content-graph/sim';
import type { GraphNode } from '../../src/content-graph/types';

function makeNode( id: number, x: number, y: number ): GraphNode {
	return {
		id,
		type: 'post',
		title: `Node ${ id }`,
		status: 'publish',
		slug: `node-${ id }`,
		edit_url: '',
		author_id: 0,
		contributor_ids: [],
		year: 2024,
		year_month: '2024-01',
		category_ids: [],
		tag_ids: [],
		x,
		y,
		vx: 0,
		vy: 0,
		pinned: false,
		radius: 8,
		color: 0,
		degree: 0,
	};
}

function distance( a: GraphNode, b: GraphNode ): number {
	const dx = a.x - b.x;
	const dy = a.y - b.y;
	return Math.sqrt( dx * dx + dy * dy );
}

function runTicks( sim: ForceSim, n: number ): void {
	for ( let i = 0; i < n; i++ ) {
		sim.step( 1 );
	}
}

describe( 'ForceSim cluster-attractor', () => {
	test( 'two nodes sharing one group key converge', () => {
		const a = makeNode( 1, -200, 0 );
		const b = makeNode( 2, 200, 0 );
		const sim = new ForceSim( [ a, b ], [] );
		const assignment = new Map< number, string[] >();
		assignment.set( 1, [ 'cat:1' ] );
		assignment.set( 2, [ 'cat:1' ] );
		sim.setGroupAssignment( assignment );

		const initial = distance( a, b );
		runTicks( sim, 200 );
		const final = distance( a, b );

		expect( final ).toBeLessThan( initial );
	} );

	test( 'nodes in different group keys do NOT converge', () => {

		const a = makeNode( 1, -300, 0 );
		const b = makeNode( 2, -250, 0 );
		const c = makeNode( 3, 250, 0 );
		const d = makeNode( 4, 300, 0 );
		const sim = new ForceSim( [ a, b, c, d ], [] );
		const assignment = new Map< number, string[] >();
		assignment.set( 1, [ 'cat:1' ] );
		assignment.set( 2, [ 'cat:1' ] );
		assignment.set( 3, [ 'cat:2' ] );
		assignment.set( 4, [ 'cat:2' ] );
		sim.setGroupAssignment( assignment );

		runTicks( sim, 200 );

		const intra = distance( a, b );
		const cross = distance( a, c );
		expect( intra ).toBeLessThan( cross );
	} );

	test( 'multi-membership node settles between two cluster centres', () => {

		const aMembers = [ makeNode( 1, -300, 0 ), makeNode( 2, -310, 30 ), makeNode( 3, -290, -30 ) ];
		const bMembers = [ makeNode( 4, 300, 0 ), makeNode( 5, 310, 30 ), makeNode( 6, 290, -30 ) ];
		const both = makeNode( 7, 0, 0 );
		const sim = new ForceSim( [ ...aMembers, ...bMembers, both ], [] );
		const assignment = new Map< number, string[] >();
		aMembers.forEach( ( n ) => assignment.set( n.id, [ 'cat:A' ] ) );
		bMembers.forEach( ( n ) => assignment.set( n.id, [ 'cat:B' ] ) );
		assignment.set( both.id, [ 'cat:A', 'cat:B' ] );
		sim.setGroupAssignment( assignment );

		runTicks( sim, 400 );

		const centroidA = {
			x: aMembers.reduce( ( s, n ) => s + n.x, 0 ) / aMembers.length,
			y: aMembers.reduce( ( s, n ) => s + n.y, 0 ) / aMembers.length,
		};
		const centroidB = {
			x: bMembers.reduce( ( s, n ) => s + n.x, 0 ) / bMembers.length,
			y: bMembers.reduce( ( s, n ) => s + n.y, 0 ) / bMembers.length,
		};
		const midpoint = {
			x: ( centroidA.x + centroidB.x ) / 2,
			y: ( centroidA.y + centroidB.y ) / 2,
		};

		const distToMid = Math.hypot( both.x - midpoint.x, both.y - midpoint.y );
		const distToA = Math.hypot( both.x - centroidA.x, both.y - centroidA.y );
		const distToB = Math.hypot( both.x - centroidB.x, both.y - centroidB.y );

		expect( distToMid ).toBeLessThan( distToA );
		expect( distToMid ).toBeLessThan( distToB );
	} );

	test( 'setGroupAssignment(null) disables the cluster force', () => {
		const a = makeNode( 1, -200, 0 );
		const b = makeNode( 2, 200, 0 );
		const sim = new ForceSim( [ a, b ], [] );
		const assignment = new Map< number, string[] >();
		assignment.set( 1, [ 'cat:1' ] );
		assignment.set( 2, [ 'cat:1' ] );
		sim.setGroupAssignment( assignment );
		runTicks( sim, 100 );
		const grouped = distance( a, b );

		sim.setGroupAssignment( null );

		a.x = -400;
		b.x = 400;
		runTicks( sim, 200 );
		const ungrouped = distance( a, b );

		expect( ungrouped ).toBeGreaterThan( grouped );
	} );

	test( 'groupOrder lays clusters out left-to-right', () => {

		const a1 = makeNode( 1, 50, 0 );
		const a2 = makeNode( 2, 60, 30 );
		const b1 = makeNode( 3, -200, 0 );
		const b2 = makeNode( 4, -210, 30 );
		const c1 = makeNode( 5, 400, 0 );
		const c2 = makeNode( 6, 410, 30 );
		const sim = new ForceSim( [ a1, a2, b1, b2, c1, c2 ], [] );
		const assignment = new Map< number, string[] >();
		assignment.set( 1, [ 'A' ] );
		assignment.set( 2, [ 'A' ] );
		assignment.set( 3, [ 'B' ] );
		assignment.set( 4, [ 'B' ] );
		assignment.set( 5, [ 'C' ] );
		assignment.set( 6, [ 'C' ] );
		sim.setGroupAssignment( assignment, [ 'A', 'B', 'C' ] );

		runTicks( sim, 400 );

		const avgX = ( ns: GraphNode[] ) =>
			ns.reduce( ( s, n ) => s + n.x, 0 ) / ns.length;
		const xa = avgX( [ a1, a2 ] );
		const xb = avgX( [ b1, b2 ] );
		const xc = avgX( [ c1, c2 ] );

		expect( xa ).toBeLessThan( xb );
		expect( xb ).toBeLessThan( xc );
	} );

	test( 'pinned nodes are not pulled by the cluster force', () => {
		const a = makeNode( 1, -200, 0 );
		const b = makeNode( 2, 200, 0 );
		a.pinned = true;
		const ax0 = a.x;
		const ay0 = a.y;
		const sim = new ForceSim( [ a, b ], [] );
		const assignment = new Map< number, string[] >();
		assignment.set( 1, [ 'cat:1' ] );
		assignment.set( 2, [ 'cat:1' ] );
		sim.setGroupAssignment( assignment );
		runTicks( sim, 100 );

		expect( a.x ).toBe( ax0 );
		expect( a.y ).toBe( ay0 );
	} );
} );
