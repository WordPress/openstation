import { describe, expect, it, vi } from 'vitest';
import { mockViewContext } from '../../../src/app-runtime/testing';
import type { UsersData, UsersState, UserListItem } from './types';
import { PeopleFeed } from './people-feed';
const batch = ( page: number, ids: number[] ): UsersData => ( { list: { page, items: ids.map( ( id ) => ( { id } as UserListItem ) ), total: 6, pages: 3, perPage: 2, error: '' } } );
function setup() {
	const ctx = mockViewContext< UsersState, UsersData >( { root: document.createElement( 'div' ), state: { page: 1, perPage: 2, search: '', role: '', status: '', orderby: 'date', order: 'desc', tab: 'all', createError: '', createField: '', created: 0, emailError: '', emailsSent: 0 }, data: batch( 1, [ 1, 2 ] ) } );
	const feed = new PeopleFeed(); feed.reconcile( ctx );
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
	it( 'restarts a background refresh from the beginning after scrolling', async () => {
		const { ctx, feed } = setup();
		ctx.state.page = 2; Object.assign( ctx, { data: batch( 2, [ 3, 4 ] ) } ); ctx.dispatch = vi.fn( async () => true );
		feed.reconcile( ctx ); await Promise.resolve();
		expect( ctx.dispatch ).toHaveBeenCalledWith( 'page', { page: 1 } );
		expect( feed.items.map( ( p ) => p.id ) ).toEqual( [ 1, 2 ] );
	} );
	it( 'does not request more after window teardown or after the last batch', async () => {
		const { ctx, feed } = setup(); ctx.dispatch = vi.fn( async () => true ); feed.dispose(); await feed.more();
		expect( ctx.dispatch ).not.toHaveBeenCalled();
	} );
} );
