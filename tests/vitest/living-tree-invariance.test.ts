/**
 * The Living Tree — the golden rule + gradual growth, encoded as tests.
 *
 * Two load-bearing guarantees:
 *
 * 1. **Topological invariance** ("WordPress emits hormones, never
 *    geometry", §A.1/§A.4): two sites of the SAME AGE grow the SAME
 *    skeleton regardless of how wildly their post / category / tag
 *    counts differ — content only changes decoration (leaf budget /
 *    colour), never morphology.
 *
 * 2. **Gradual, monotone growth** (§A.5): the canonical skeleton is a
 *    pure function of the seed; age only reveals a prefix of it. The
 *    tree at day N+1 must CONTAIN the tree at day N — never reshuffle.
 *    (A regression here is exactly the "different tree every day" bug.)
 */
import { describe, expect, test } from 'vitest';
import { ageCurve, buildHormones } from '../../src/plugins/living-tree-wallpaper/dna';
import {
	buildEnvelope,
	buildGrowthConfig,
	maxDepthForAge,
	revealCountForAge,
	trunkGirthForAge,
} from '../../src/plugins/living-tree-wallpaper/growth/envelope';
import {
	countWithinDepth,
	revealSkeleton,
} from '../../src/plugins/living-tree-wallpaper/growth/reveal';
import { GrowthSimulator } from '../../src/plugins/living-tree-wallpaper/growth/space-colonization';
import { computeIvyBudget } from '../../src/plugins/living-tree-wallpaper/render/ivy';
import { computeLeafBudget } from '../../src/plugins/living-tree-wallpaper/render/leaves';
import { hash32, mulberry32 } from '../../src/plugins/living-tree-wallpaper/rng';
import type {
	BranchNode,
	TreeSnapshot,
} from '../../src/plugins/living-tree-wallpaper/types';

/** A snapshot with every metric zeroed except the overrides. */
function snapshot( overrides: Partial< TreeSnapshot > = {} ): TreeSnapshot {
	return {
		siteUrl: 'https://example.com',
		installEpoch: 1_700_000_000,
		siteAgeDays: 0,
		totalPosts: 0,
		totalPages: 0,
		totalCategories: 0,
		totalTags: 0,
		totalComments: 0,
		activeUsers: 0,
		traffic: 0,
		seoHealth: 0.7,
		performance: 0.8,
		branches: [],
		tagCooccurrence: [],
		...overrides,
	};
}

// A tiny site and a huge site, SAME age, SAME seed inputs.
const sparse = snapshot( {
	siteAgeDays: 365,
	totalPosts: 5,
	totalCategories: 1,
	totalTags: 0,
} );
const dense = snapshot( {
	siteAgeDays: 365,
	totalPosts: 50_000,
	totalCategories: 2_000,
	totalTags: 8_000,
	totalComments: 120_000,
	traffic: 500_000,
} );

function seededRng( s: TreeSnapshot ): () => number {
	return mulberry32( hash32( `${ s.siteUrl }|${ s.installEpoch }` ) );
}

/** The canonical (mature) skeleton for a snapshot's seed. */
function growCanonical( s: TreeSnapshot ): BranchNode[] {
	const hormones = buildHormones( s );
	const rng = seededRng( s );
	const env = buildEnvelope( hormones.age01, hormones.vigor01, rng );
	const sim = new GrowthSimulator( env, buildGrowthConfig( env, hormones.vigor01 ), rng );
	let guard = 0;
	while ( ! sim.done && guard++ < 5000 ) {
		sim.step( 10 );
	}
	expect( sim.done ).toBe( true );
	return sim.nodes;
}

/** The revealed tree for a snapshot (what the scene actually renders). */
function reveal( s: TreeSnapshot ): BranchNode[] {
	const hormones = buildHormones( s );
	const full = growCanonical( s );
	const cap = maxDepthForAge( hormones.age01 );
	return revealSkeleton(
		full,
		revealCountForAge( countWithinDepth( full, cap ), hormones.age01 ),
		cap,
	);
}

describe( 'living-tree hormones', () => {
	test( 'buildHormones returns the full normalised set with an integer spark', () => {
		const h = buildHormones( snapshot( { totalPosts: 500 } ) );
		for ( const key of [
			'age01',
			'vigor01',
			'foliage01',
			'health01',
			'diversity01',
			'bloom01',
			'wind01',
			'structure01',
			'vitality01',
		] as const ) {
			expect( h[ key ] ).toBeGreaterThanOrEqual( 0 );
			expect( h[ key ] ).toBeLessThanOrEqual( 1 );
		}
		expect( Number.isInteger( h.spark ) ).toBe( true );
	} );
} );

describe( 'living-tree topological invariance (the golden rule)', () => {
	test( 'the envelope is seed-only: identical for any age or content shape', () => {
		const hSparse = buildHormones( sparse );
		const hDense = buildHormones( dense );
		// Vigour genuinely differs — that's what makes this test bite.
		expect( hSparse.vigor01 ).not.toBe( hDense.vigor01 );
		const old = snapshot( { siteAgeDays: 7300 } );
		const envSparse = buildEnvelope( hSparse.age01, hSparse.vigor01, seededRng( sparse ) );
		const envDense = buildEnvelope( hDense.age01, hDense.vigor01, seededRng( dense ) );
		const envOld = buildEnvelope( 1, 0.5, seededRng( old ) );
		expect( envSparse ).toEqual( envDense );
		expect( envSparse ).toEqual( envOld );
	} );

	test( 'same age + same seed → identical revealed skeleton regardless of content', () => {
		const revealedSparse = reveal( sparse );
		const revealedDense = reveal( dense );
		expect( revealedSparse.length ).toBeGreaterThan( 3 );
		expect( revealedSparse.length ).toBe( revealedDense.length );
		// Not just the same count — the same geometry, node for node.
		expect( revealedSparse.map( ( n ) => n.pos ) ).toEqual(
			revealedDense.map( ( n ) => n.pos ),
		);
	} );

	test( 'content differences surface only in decoration (leaf budget), never in the skeleton', () => {
		const budgetSparse = computeLeafBudget( buildHormones( sparse ).foliage01 );
		const budgetDense = computeLeafBudget( buildHormones( dense ).foliage01 );
		expect( budgetDense ).toBeGreaterThan( budgetSparse );
	} );

	test( 'pages buy trunk ivy, monotonically, without touching geometry', () => {
		const bare = computeIvyBudget( buildHormones( snapshot() ).structure01 );
		const pageHeavy = computeIvyBudget(
			buildHormones( snapshot( { totalPages: 300 } ) ).structure01,
		);
		expect( bare ).toBe( 0 );
		expect( pageHeavy ).toBeGreaterThan( 100 );
	} );

	test( 'age unlocks branching levels per the §A.4 table', () => {
		expect( maxDepthForAge( ageCurve( 20 ) ) ).toBe( 2 );
		expect( maxDepthForAge( ageCurve( 3 * 365 ) ) ).toBe( 8 );
		expect( maxDepthForAge( ageCurve( 20 * 365 ) ) ).toBeGreaterThanOrEqual( 12 );
		// Girth follows the master clock too.
		expect( trunkGirthForAge( 0.2 ) ).toBeLessThan( trunkGirthForAge( 0.9 ) );
	} );

	test( 'different sites (different seeds) → different skeletons at the same age', () => {
		const siteA = snapshot( { siteAgeDays: 365 } );
		const siteB = snapshot( { siteAgeDays: 365, siteUrl: 'https://other.example' } );
		expect( reveal( siteA ).map( ( n ) => n.pos ) ).not.toEqual(
			reveal( siteB ).map( ( n ) => n.pos ),
		);
	} );

	test( 'an empty WordPress is a sprout, not an empty canvas (§A.9)', () => {
		const revealed = reveal( snapshot() );
		expect( revealed.length ).toBeGreaterThanOrEqual( 2 );
		expect( revealed.length ).toBeLessThan( 40 );
		// It grew upward: some node sits above the root.
		expect( Math.min( ...revealed.map( ( n ) => n.pos.y ) ) ).toBeLessThan( 0 );
	} );
} );

describe( 'living-tree gradual growth (no daily reshuffle)', () => {
	test( 'day N+1 CONTAINS day N: the reveal is a strict prefix, node for node', () => {
		const today = reveal( snapshot( { siteAgeDays: 1000 } ) );
		const tomorrow = reveal( snapshot( { siteAgeDays: 1001 } ) );
		expect( tomorrow.length ).toBeGreaterThanOrEqual( today.length );
		// Every node the tree had yesterday is EXACTLY where it was.
		for ( let i = 0; i < today.length; i++ ) {
			expect( tomorrow[ i ].pos ).toEqual( today[ i ].pos );
			expect( tomorrow[ i ].parent ).toBe( today[ i ].parent );
		}
	} );

	test( 'a year of growth only ever adds nodes, never moves them', () => {
		const base = reveal( snapshot( { siteAgeDays: 400 } ) );
		const later = reveal( snapshot( { siteAgeDays: 765 } ) );
		expect( later.length ).toBeGreaterThan( base.length );
		for ( let i = 0; i < base.length; i++ ) {
			expect( later[ i ].pos ).toEqual( base[ i ].pos );
		}
	} );

	test( 'revealCountForAge is monotone in age', () => {
		let prev = 0;
		for ( const days of [ 0, 10, 60, 200, 800, 2000, 5000 ] ) {
			const count = revealCountForAge( 1000, ageCurve( days ) );
			expect( count ).toBeGreaterThanOrEqual( prev );
			prev = count;
		}
		expect( revealCountForAge( 1000, 1 ) ).toBe( 1000 );
	} );

	test( 'revealSkeleton keeps the subtree connected and re-indexed', () => {
		const full = growCanonical( snapshot( { siteAgeDays: 3000 } ) );
		const revealed = revealSkeleton( full, 120, 6 );
		expect( revealed.length ).toBeLessThanOrEqual( 120 );
		revealed.forEach( ( node, i ) => {
			expect( node.id ).toBe( i );
			if ( node.parent !== null ) {
				expect( node.parent ).toBeLessThan( i );
				expect( node.depth ).toBeLessThanOrEqual( 6 );
			}
		} );
	} );
} );
