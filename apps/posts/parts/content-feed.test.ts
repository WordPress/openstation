import { describe, expect, it, vi } from 'vitest';
import { mockViewContext } from '../../../src/app-runtime/testing';
import type { ListData, ListState, PostListItem } from './types';
import { ContentFeed } from './content-feed';
const batch = ( page: number, ids: number[] ): ListData => ( { list: { page, items: ids.map( ( id ) => ( { id } as PostListItem ) ), total: 6, pages: 3, perPage: 2, error: '', code: '' } } );
function setup() {
	const ctx = mockViewContext< ListState, ListData >( { root: document.createElement( 'div' ), state: { tab: 'posts', page: 1, perPage: 2, search: '', status: '', orderby: 'date', order: 'desc', author: [], tag: [] }, data: batch( 1, [ 1, 2 ] ) } );
	const feed = new ContentFeed(); feed.reconcile( ctx );
	return { ctx, feed };
}
describe( 'continuous content feed', () => {
	it( 'appends through the server page action, deduplicates overlapping IDs and retains previous items', async () => {
		const { ctx, feed } = setup();
		ctx.dispatch = vi.fn( async ( _action, args ) => {
			ctx.state.page = Number( args?.page ); Object.assign( ctx, { data: batch( 2, [ 2, 3, 4 ] ) } ); feed.reconcile( ctx ); return true;
		} );
		await feed.more();
		expect( ctx.dispatch ).toHaveBeenCalledWith( 'page', { page: 2 } );
		expect( feed.items.map( ( item ) => item.id ) ).toEqual( [ 1, 2, 3, 4 ] );
	} );
	it( 'resets on filters and ignores old data while the new query is loading', () => {
		const { ctx, feed } = setup();
		Object.assign( ctx, { loading: true } ); ctx.state.search = 'new'; feed.reconcile( ctx );
		expect( feed.items ).toEqual( [] );
		Object.assign( ctx, { loading: false, data: batch( 1, [ 5 ] ) } ); feed.reconcile( ctx );
		expect( feed.items.map( ( p ) => p.id ) ).toEqual( [ 5 ] );
	} );
	it( 'keeps loaded content on failure, offers retry and prevents overlapping loads', async () => {
		const { ctx, feed } = setup();
		let finish!: ( value: boolean ) => void;
		ctx.dispatch = vi.fn( () => new Promise< boolean >( ( resolve ) => {
			finish = resolve;
		} ) );
		const first = feed.more(); await feed.more();
		expect( ctx.dispatch ).toHaveBeenCalledTimes( 1 );
		finish( false ); await first;
		expect( feed.error ).toBe( true ); expect( feed.items ).toHaveLength( 2 );
	} );
	it( 'refreshes the loaded range in one response without resetting pagination', () => {
		const { ctx, feed } = setup();
		ctx.state.page = 2; Object.assign( ctx, { data: batch( 2, [ 3, 4 ] ) } ); feed.reconcile( ctx );
		const refreshed = batch( 2, [ 1, 2, 4, 5 ] ); refreshed.list.replace = true;
		Object.assign( ctx, { data: refreshed } ); ctx.dispatch = vi.fn( async () => true ); feed.reconcile( ctx );
		expect( ctx.dispatch ).not.toHaveBeenCalled();
		expect( feed.items.map( ( p ) => p.id ) ).toEqual( [ 1, 2, 4, 5 ] );
		expect( feed.hasMore ).toBe( true );
	} );
	it( 'rejects old-query rows even when the runtime preserves the new state', () => {
		const { ctx, feed } = setup();
		const oldQuery = { ...ctx.state };
		ctx.state.search = 'new'; ctx.state.page = 2;
		Object.assign( ctx, { data: { ...batch( 2, [ 3, 4 ] ), query: oldQuery } } ); feed.reconcile( ctx );
		expect( feed.items ).toEqual( [] );
		ctx.state.page = 1;
		Object.assign( ctx, { data: { ...batch( 1, [ 1, 2 ] ), query: oldQuery } } ); feed.reconcile( ctx );
		expect( feed.items ).toEqual( [] );
		Object.assign( ctx, { data: { ...batch( 1, [ 5 ] ), query: { ...ctx.state } } } ); feed.reconcile( ctx );
		expect( feed.items.map( ( p ) => p.id ) ).toEqual( [ 5 ] );
	} );
	it( 'contains rejected continuations and ignores errors belonging to an old query', async () => {
		const { ctx, feed } = setup();
		ctx.dispatch = vi.fn( async () => {
			throw new Error( 'Offline' );
		} );
		await feed.more(); expect( feed.error ).toBe( true ); expect( feed.items ).toHaveLength( 2 );
		ctx.dispatch = vi.fn( async () => {
			ctx.state.search = 'new'; feed.reconcile( ctx ); throw new Error( 'Old request' );
		} );
		await feed.more(); expect( feed.error ).toBe( false );
	} );
	it( 'does not request more after window teardown or after the last batch', async () => {
		const { ctx, feed } = setup(); ctx.dispatch = vi.fn( async () => true ); feed.dispose(); await feed.more();
		expect( ctx.dispatch ).not.toHaveBeenCalled();
	} );
} );
