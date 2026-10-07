import { describe, expect, test } from 'vitest';
import { GraphScene, type NodeStyle } from '../../src/content-graph/scene';
import type { PostTypeDescriptor } from '../../src/content-graph/types';

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
];

interface SceneInternals {
	postTypeColor: Map< string, number >;
	nodeViews: Map< number, { discKey: string } >;
}

function makeScene( style?: NodeStyle ): GraphScene {
	return new GraphScene(
		document.createElement( 'div' ),
		{},
		() => {},
		POST_TYPES,
		style,
	);
}

describe( 'node style', () => {
	test( 'defaults to disc bodies', () => {
		expect( makeScene().getNodeStyle() ).toBe( 'disc' );
	} );

	test( 'honours the style passed at construction', () => {

		expect( makeScene( 'icon' ).getNodeStyle() ).toBe( 'icon' );
	} );

	test( 'setNodeStyle switches the style', () => {
		const scene = makeScene();
		scene.setNodeStyle( 'icon' );
		expect( scene.getNodeStyle() ).toBe( 'icon' );
		scene.setNodeStyle( 'disc' );
		expect( scene.getNodeStyle() ).toBe( 'disc' );
	} );

	test( 'setNodeStyle invalidates cached disc signatures', () => {
		const scene = makeScene();
		const internals = scene as unknown as SceneInternals;
		internals.nodeViews.set( 1, { discKey: 'painted' } );
		internals.nodeViews.set( 2, { discKey: 'painted' } );

		scene.setNodeStyle( 'icon' );

		expect(
			Array.from( internals.nodeViews.values() ).map( ( v ) => v.discKey ),
		).toEqual( [ '', '' ] );
	} );

	test( 'setNodeStyle to the current style leaves the cache alone', () => {

		const scene = makeScene();
		const internals = scene as unknown as SceneInternals;
		internals.nodeViews.set( 1, { discKey: 'painted' } );

		scene.setNodeStyle( 'disc' );

		expect( internals.nodeViews.get( 1 )?.discKey ).toBe( 'painted' );
	} );

	test( 'assigns a distinct palette colour per post type, in order', () => {
		const internals = makeScene() as unknown as SceneInternals;
		const post = internals.postTypeColor.get( 'post' );
		const page = internals.postTypeColor.get( 'page' );
		expect( post ).toBeTypeOf( 'number' );
		expect( page ).toBeTypeOf( 'number' );
		expect( post ).not.toBe( page );
	} );
} );
