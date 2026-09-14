import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render } from '../../../src/ui/core/html';
import { mockViewContext } from '../../../src/app-runtime/testing';
import { pluginColumns } from './columns';
import { freshDesk, renderDesk } from './desk';
import type { CellEnv } from './cells/env';
import type { ListData, ListState, PostListItem } from './types';

/**
 * #812 — a column a plugin appends through `openstation.postsWindow.columns`
 * paints on the writing-desk card, the same set the inspector paints,
 * governed by the same Show columns preference.
 */

type Hooks = { addFilter: ( n: string, ns: string, cb: ( v: unknown ) => unknown ) => void; removeFilter: ( n: string, ns: string ) => void; applyFilters: ( n: string, v: unknown ) => unknown };

function installHooks(): Hooks {
	const filters = new Map< string, Array<( v: unknown ) => unknown > >();
	const hooks: Hooks = {
		addFilter: ( n, _ns, cb ) => filters.set( n, [ ...( filters.get( n ) ?? [] ), cb ] ),
		removeFilter: ( n ) => filters.delete( n ),
		applyFilters: ( n, v ) => ( filters.get( n ) ?? [] ).reduce( ( acc, cb ) => cb( acc ), v ),
	};
	( window as unknown as { wp: { hooks: Hooks } } ).wp = { hooks };
	return hooks;
}

const env = { extra: { mode: 'posts' }, cells: { categories: () => '', tags: () => '' } } as unknown as CellEnv;
const row = ( id: number, extra: Record< string, unknown > = {} ): PostListItem =>
	( { id, title: { rendered: `Post ${ id }` }, status: 'publish', date_gmt: '2026-01-01T00:00:00', modified_gmt: '2026-01-01T00:00:00', tags: [], ...extra } as unknown as PostListItem );

function paint( items: PostListItem[] ): HTMLElement {
	const root = document.createElement( 'div' );
	const ctx = mockViewContext< ListState, ListData >( {
		root,
		state: { page: 1, perPage: 20, search: '', status: '', orderby: 'date', order: 'desc', author: [], tag: [] },
		data: { list: { page: 1, items, total: items.length, pages: 1, perPage: 20, error: '', code: '' } },
		extra: { mode: 'posts' },
	} );
	render( renderDesk( ctx, freshDesk(), env, { authors: [], tags: [] }, new Set() ), root );
	return root;
}

describe( 'plugin columns on the writing-desk card', () => {
	let hooks: Hooks;
	beforeEach( () => {
		hooks = installHooks();
	} );
	afterEach( () => {
		hooks.removeFilter( 'openstation.postsWindow.columns', 'test' );
	} );

	it( 'pluginColumns() is the registered set minus the shell\'s own, minus the hidden', () => {
		hooks.addFilter( 'openstation.postsWindow.columns', 'test', ( cols ) => ( cols as unknown[] ).concat( [ { key: 'x', label: 'X' }, { key: 'y', label: 'Y' } ] ) );
		expect( pluginColumns( env, { authors: [], tags: [] }, new Set() ).map( ( c ) => c.key ) ).toEqual( [ 'x', 'y' ] );
		expect( pluginColumns( env, { authors: [], tags: [] }, new Set( [ 'y', 'date' ] ) ).map( ( c ) => c.key ) ).toEqual( [ 'x' ] );
		expect( pluginColumns( env, { authors: [], tags: [] }, new Set( [ 'x', 'y' ] ) ) ).toEqual( [] );
	} );

	it( 'paints a plugin column beside Words / Comments / Tags, one node per card, and nothing for an empty render', () => {
		let calls = 0;
		hooks.addFilter( 'openstation.postsWindow.columns', 'test', ( cols ) => ( cols as unknown[] ).concat( [ {
			key: 'x',
			label: 'Provenance',
			render: ( value: unknown ) => {
				calls++;
				const node = document.createElement( 'span' );
				if ( value ) {
					node.textContent = `v${ String( value ) }`;
				}
				return node; // empty when absent — the documented "keep the column aligned" shape
			},
		} ] ) );
		const root = paint( [ row( 1, { x: 3 } ), row( 2 ) ] );
		const stats = root.querySelectorAll( '.os-posts-desk__plugin-stat[data-column="x"]' );
		expect( stats ).toHaveLength( 1 );
		expect( stats[ 0 ].closest( '[data-story-id]' )?.getAttribute( 'data-story-id' ) ).toBe( '1' );
		expect( stats[ 0 ].querySelector( '.os-posts-desk__plugin-stat-value' )?.textContent ).toBe( 'v3' );
		expect( stats[ 0 ].querySelector( '.os-posts-desk__plugin-stat-label' )?.textContent ).toBe( 'Provenance' );
		expect( stats[ 0 ].parentElement?.classList.contains( 'os-posts-desk__metrics' ) ).toBe( true );
		expect( calls ).toBe( 2 ); // once per card, no singleton reuse
		const nodes = [ ...root.querySelectorAll( '.os-posts-desk__plugin-stat-value > span' ) ];
		expect( new Set( nodes ).size ).toBe( nodes.length );
	} );

	it( 'a site with no plugin columns paints exactly what it painted before', () => {
		const root = paint( [ row( 1 ) ] );
		expect( root.querySelectorAll( '.os-posts-desk__plugin-stat' ) ).toHaveLength( 0 );
		expect( root.querySelectorAll( '.os-posts-desk__metrics os-stat' ) ).toHaveLength( 3 );
	} );
} );
