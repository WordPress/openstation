/**
 * Content Graph — group-key derivation + cluster label contract.
 *
 * Pins the `cat:type_<slug>` / `tag:type_<slug>` isolation behavior
 * for post types that don't support a taxonomy (and for descriptors
 * missing `taxonomies` entirely — the pre-normalization legacy
 * shape), without dragging Pixi into the test: the scene constructor
 * is renderer-free, all the heavy work lives in `mount()`.
 */

import { describe, expect, test } from 'vitest';
import { GraphScene } from '../../src/content-graph/scene';
import type {
	GraphNode,
	GroupFacet,
	PostTypeDescriptor,
} from '../../src/content-graph/types';

const POST_TYPES: PostTypeDescriptor[] = [
	{
		slug: 'post',
		label: 'Posts',
		icon: 'dashicons-admin-post',
		count: 3,
		taxonomies: { category: true, post_tag: true },
	},
	{
		slug: 'page',
		label: 'Pages',
		icon: 'dashicons-admin-page',
		count: 2,
		taxonomies: { category: false, post_tag: false },
	},
	{
		slug: 'legacy',
		label: 'Legacy',
		icon: 'dashicons-book',
		count: 1,
		// No `taxonomies` — a descriptor from a filter written to the
		// pre-taxonomies contract that bypassed server normalization.
	},
];

// The methods under test are private; reach in through a structural
// cast so the contract stays testable without widening the public API.
interface GroupingInternals {
	deriveGroupKeys: ( n: GraphNode, facet: GroupFacet ) => string[];
	labelForGroupKey: ( key: string ) => string;
}

function makeScene(): GroupingInternals {
	return new GraphScene(
		document.createElement( 'div' ),
		{},
		() => {},
		POST_TYPES,
	) as unknown as GroupingInternals;
}

function makeNode( overrides: Partial< GraphNode > ): GraphNode {
	return {
		id: 1,
		type: 'post',
		title: 'Node',
		status: 'publish',
		slug: 'node',
		edit_url: '',
		author_id: 1,
		contributor_ids: [],
		year: 2026,
		year_month: '2026-07',
		category_ids: [],
		tag_ids: [],
		x: 0,
		y: 0,
		vx: 0,
		vy: 0,
		pinned: false,
		radius: 4,
		color: 0,
		degree: 0,
		...overrides,
	};
}

describe( 'deriveGroupKeys — taxonomy-support isolation', () => {
	test( 'category: non-supporting type gets its own type cluster', () => {
		const scene = makeScene();
		const keys = scene.deriveGroupKeys(
			makeNode( { type: 'page' } ),
			'category',
		);
		expect( keys ).toEqual( [ 'cat:type_page' ] );
	} );

	test( 'category: supporting type with no terms falls back to uncat', () => {
		const scene = makeScene();
		const keys = scene.deriveGroupKeys(
			makeNode( { type: 'post', category_ids: [] } ),
			'category',
		);
		expect( keys ).toEqual( [ 'cat:uncat' ] );
	} );

	test( 'category: supporting type maps term ids', () => {
		const scene = makeScene();
		const keys = scene.deriveGroupKeys(
			makeNode( { type: 'post', category_ids: [ 4, 5 ] } ),
			'category',
		);
		expect( keys ).toEqual( [ 'cat:4', 'cat:5' ] );
	} );

	test( 'category: descriptor without taxonomies is treated as non-supporting', () => {
		const scene = makeScene();
		const keys = scene.deriveGroupKeys(
			makeNode( { type: 'legacy', category_ids: [ 4 ] } ),
			'category',
		);
		expect( keys ).toEqual( [ 'cat:type_legacy' ] );
	} );

	test( 'category: unknown type gets its own type cluster', () => {
		const scene = makeScene();
		const keys = scene.deriveGroupKeys(
			makeNode( { type: 'ghost' } ),
			'category',
		);
		expect( keys ).toEqual( [ 'cat:type_ghost' ] );
	} );

	test( 'tag: non-supporting type gets its own type cluster', () => {
		const scene = makeScene();
		const keys = scene.deriveGroupKeys(
			makeNode( { type: 'page' } ),
			'tag',
		);
		expect( keys ).toEqual( [ 'tag:type_page' ] );
	} );

	test( 'tag: supporting type with no terms falls back to untagged', () => {
		const scene = makeScene();
		const keys = scene.deriveGroupKeys(
			makeNode( { type: 'post', tag_ids: [] } ),
			'tag',
		);
		expect( keys ).toEqual( [ 'tag:untagged' ] );
	} );

	test( 'tag: supporting type maps term ids', () => {
		const scene = makeScene();
		const keys = scene.deriveGroupKeys(
			makeNode( { type: 'post', tag_ids: [ 7 ] } ),
			'tag',
		);
		expect( keys ).toEqual( [ 'tag:7' ] );
	} );
} );

describe( 'labelForGroupKey — type-cluster labels', () => {
	test( 'resolves the post type label for type clusters', () => {
		const scene = makeScene();
		expect( scene.labelForGroupKey( 'cat:type_page' ) ).toBe( 'Pages' );
		expect( scene.labelForGroupKey( 'tag:type_page' ) ).toBe( 'Pages' );
	} );

	test( 'falls back to the raw slug for unknown types', () => {
		const scene = makeScene();
		expect( scene.labelForGroupKey( 'cat:type_ghost' ) ).toBe( 'ghost' );
	} );

	test( 'keeps the shared fallback cluster labels', () => {
		const scene = makeScene();
		expect( scene.labelForGroupKey( 'cat:uncat' ) ).toBe( 'Uncategorized' );
		expect( scene.labelForGroupKey( 'tag:untagged' ) ).toBe( 'Untagged' );
	} );
} );
