/**
 * Posts app — the client view: the frame (tabs, toolbar, bulk bar,
 * table, pager, the phone footer), the table wiring, the column
 * builders and hook registries, the REST client over `ctx.fetch`,
 * and the orderby mapping. The Pages twin's copy is `pages.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockViewContext } from '../../src/app-runtime/testing';
import app from './posts.os';
import { createPostsRestClient } from './parts/rest';
import {
	buildAllColumns,
	buildColumns,
	defaultBulkActions,
	defaultStatusSegments,
	mapColumnToOrderby,
	mapOrderbyToColumn,
	resolveBulkActions,
	resolveStatusSegments,
} from './parts/columns';
import type { ListData, ListState, PostListItem } from './parts/types';

function row( id: number, over: Partial< PostListItem > = {} ): PostListItem {
	return {
		id,
		title: { rendered: `Row ${ id }` },
		status: 'publish',
		date: '2026-01-01T00:00:00',
		date_gmt: '2026-01-01T00:00:00',
		modified: '2026-01-01T00:00:00',
		modified_gmt: '2026-01-01T00:00:00',
		author: 1,
		categories: [],
		tags: [],
		comment_status: 'open',
		...over,
	};
}

function state( over: Partial< ListState > = {} ): ListState {
	return { page: 1, perPage: 20, search: '', status: '', orderby: 'date', order: 'desc', author: [], tag: [], ...over };
}

function data( items: PostListItem[], over: Partial< ListData[ 'list' ] > = {} ): ListData {
	return { list: { items, total: items.length, pages: items.length ? 1 : 0, page: 1, perPage: 20, error: '', ...over } };
}

function mount( s: Partial< ListState > = {}, d: ListData = data( [ row( 1 ), row( 2 ) ] ), extra: Record< string, unknown > = {} ) {
	const root = document.createElement( 'div' );
	document.body.appendChild( root );
	const dispatch = vi.fn( async () => true );
	const ctx = mockViewContext< ListState, ListData >( {
		state: state( s ),
		data: d,
		root,
		extra: { mode: 'posts', editPostUrlBase: 'http://x.test/wp-admin/post.php', newPostUrl: 'http://x.test/wp-admin/post-new.php', ...extra },
		dispatch,
		host: { fetch: ( input, init ) => globalThis.fetch( input, init ), openUrl: vi.fn(), confirm: vi.fn( async () => true ) },
	} );
	ctx.repaint = () => app.render( ctx );
	app.render( ctx );
	return { root, ctx, dispatch };
}

beforeEach( () => {
	( window as unknown as { wp?: unknown } ).wp = {
		os: { getOsSettings: () => ( { nativePostsHiddenColumns: [] } ) },
		hooks: { applyFilters: ( _n: string, v: unknown ) => v, doAction: () => undefined },
	};
} );

afterEach( () => {
	document.body.replaceChildren();
	document.documentElement.removeAttribute( 'data-os-mode' );
	delete ( window as unknown as { wp?: unknown } ).wp;
	vi.restoreAllMocks();
} );

describe( 'the frame', () => {
	it( 'paints the tabs, the toolbar bound to filter, the table and the pager', () => {
		const { root } = mount();
		expect( root.querySelector( '[data-os-posts-root]' )!.classList.contains( 'os-app-list' ) ).toBe( true );
		expect( Array.from( root.querySelectorAll( 'os-tab' ) ).map( ( t ) => t.getAttribute( 'value' ) ) ).toEqual( [ 'posts', 'categories', 'tags' ] );
		const status = root.querySelector( 'os-segmented' )!;
		expect( status.getAttribute( 'os-bind' ) ).toBe( 'status' );
		expect( status.getAttribute( 'os-action' ) ).toBe( 'filter' );
		expect( Array.from( status.querySelectorAll( 'os-segment' ) ).map( ( s ) => s.textContent ) ).toEqual( [ 'All', 'Published', 'Drafts', 'Pending', 'Scheduled', 'Trash' ] );
		const search = root.querySelector( '[data-os-posts-search]' )!;
		expect( search.getAttribute( 'os-bind' ) ).toBe( 'search' );
		expect( search.getAttribute( 'os-action' ) ).toBe( 'filter' );
		expect( search.getAttribute( 'os-debounce' ) ).toBe( '250' );
		expect( search.getAttribute( 'placeholder' ) ).toBe( 'Search posts…' );
		expect( root.querySelector( '[data-os-posts-refresh]' )!.getAttribute( 'os-action' ) ).toBe( 'refresh' );
		expect( root.querySelector( '[data-os-posts-table]' )!.hasAttribute( 'os-preserve' ) ).toBe( true );
		expect( root.querySelector( '.os-app-list__pager-meta' )!.textContent!.trim() ).toBe( 'Page 1 of 1 · 2 posts' );
		expect( root.querySelector( '[data-os-posts-cats-host]' )!.hasAttribute( 'os-preserve' ) ).toBe( true );
	} );

	it( 'says "No posts" for an empty page and disables both pager buttons', () => {
		const { root } = mount( {}, data( [] ) );
		expect( root.querySelector( '.os-app-list__pager-meta' )!.textContent!.trim() ).toBe( 'No posts' );
		const buttons = root.querySelectorAll( '.os-app-list__pager-nav os-button' );
		expect( buttons[ 0 ].hasAttribute( 'disabled' ) ).toBe( true );
		expect( buttons[ 1 ].hasAttribute( 'disabled' ) ).toBe( true );
	} );

	it( 'Add New opens the editor URL in a window with the post copy', () => {
		const { root, ctx } = mount();
		( root.querySelector( '[data-os-posts-new]' ) as HTMLElement ).click();
		expect( ctx.host.openUrl ).toHaveBeenCalledWith( 'http://x.test/wp-admin/post-new.php', 'Add New Post', 'dashicons-admin-post' );
	} );

	it( 'keeps the bulk bar in the toolbar on a desk and moves it to a footer on a phone', () => {
		const desk = mount();
		expect( desk.root.querySelector( '.os-app-list__toolbar [data-os-posts-bulk]' ) ).not.toBeNull();
		expect( desk.root.querySelector( '.os-app-list__bulk--footer' ) ).toBeNull();
		document.documentElement.setAttribute( 'data-os-mode', 'mobile' );
		const phone = mount();
		expect( phone.root.querySelector( '.os-app-list__toolbar [data-os-posts-bulk]' ) ).toBeNull();
		expect( phone.root.querySelector( '.os-app-list__bulk--footer' ) ).not.toBeNull();
		expect( phone.root.querySelector( 'os-select.os-app-list__status' ) ).not.toBeNull();
	} );

	it( 'shows the server error as a notice', () => {
		const { root } = mount( {}, data( [], { error: 'Nope.' } ) );
		expect( root.querySelector( 'os-notice' )!.textContent ).toBe( 'Nope.' );
	} );
} );

describe( 'the table', () => {
	it( 'is wired once with the row identity, the sort and the data', () => {
		const { root, ctx } = mount( { orderby: 'title', order: 'asc' } );
		const table = root.querySelector( '[data-os-posts-table]' ) as HTMLElement & {
			data?: PostListItem[];
			columns?: Array< { key: string } >;
			getRowId?: ( r: PostListItem ) => number;
			sort?: { key: string; direction: string };
		};
		expect( table.getRowId!( row( 9 ) ) ).toBe( 9 );
		expect( table.sort ).toEqual( { key: 'title', direction: 'asc' } );
		expect( table.data ).toHaveLength( 2 );
		expect( ( table.columns ?? [] ).map( ( c ) => c.key ) ).toEqual( [ 'title', 'author', 'categories', 'tags', 'date' ] );
		let assignments = 0;
		let stored = table.data;
		Object.defineProperty( table, 'data', {
			get: () => stored,
			set: ( v: PostListItem[] ) => {
				assignments++;
				stored = v;
			},
		} );
		app.render( ctx );
		expect( assignments ).toBe( 0 );
	} );

	it( 'a sort change dispatches `sort` with the mapped orderby', () => {
		const { root, dispatch } = mount();
		const table = root.querySelector( '[data-os-posts-table]' )!;
		table.dispatchEvent( new CustomEvent( 'os-table-sort-change', { detail: { sort: { key: 'comments', direction: 'asc' } } } ) );
		expect( dispatch ).toHaveBeenCalledWith( 'sort', { orderby: 'comment_count', order: 'asc' } );
		table.dispatchEvent( new CustomEvent( 'os-table-sort-change', { detail: { sort: null } } ) );
		expect( dispatch ).toHaveBeenCalledWith( 'sort', { orderby: 'date', order: 'desc' } );
	} );

	it( 'a column filter change writes the ids locally and dispatches `filter`', () => {
		const { root, ctx, dispatch } = mount();
		const local = vi.fn();
		ctx.local = local;
		root.querySelector( '[data-os-posts-table]' )!.dispatchEvent(
			new CustomEvent( 'os-table-filter-change', { detail: { filters: { author: '3, 5', tags: '' } } } ),
		);
		expect( local ).toHaveBeenCalledWith( 'set-column-filters', { author: [ 3, 5 ], tag: [] } );
		expect( dispatch ).toHaveBeenCalledWith( 'filter' );
		expect( app.runLocal( 'set-column-filters', state(), { author: [ 3 ], tag: [ 7 ] }, undefined ) ).toMatchObject( { author: [ 3 ], tag: [ 7 ] } );
	} );
} );

describe( 'the registries', () => {
	it( 'ships the six status segments and lets the filter replace them', () => {
		expect( defaultStatusSegments().map( ( s ) => s.value ) ).toEqual( [ '', 'publish', 'draft', 'pending', 'future', 'trash' ] );
		( window as unknown as { wp: { hooks: { applyFilters: unknown } } } ).wp.hooks.applyFilters = () => [ { value: 'x', label: 'X' } ];
		expect( resolveStatusSegments() ).toEqual( [ { value: 'x', label: 'X' } ] );
		( window as unknown as { wp: { hooks: { applyFilters: unknown } } } ).wp.hooks.applyFilters = () => [];
		expect( resolveStatusSegments() ).toHaveLength( 6 );
	} );

	it( 'the trash bulk action pluralises per mode, skips trashed rows and opts out of the auto-refresh', async () => {
		const trash = vi.fn( async () => true );
		const [ action ] = defaultBulkActions( 'posts', trash );
		expect( typeof action.confirm === 'function' && action.confirm( 1 ) ).toBe( 'Move 1 post to the trash?' );
		expect( typeof action.confirm === 'function' && action.confirm( 3 ) ).toBe( 'Move 3 posts to the trash?' );
		const [ pages ] = defaultBulkActions( 'pages', trash );
		expect( typeof pages.confirm === 'function' && pages.confirm( 2 ) ).toBe( 'Move 2 pages to the trash?' );
		const clearSelection = vi.fn();
		const result = await action.run( [ 1, 2 ], {
			table: { data: [ row( 1 ), row( 2, { status: 'trash' } ) ], clearSelection } as never,
		} as never );
		expect( trash ).toHaveBeenCalledWith( [ 1 ] );
		expect( clearSelection ).toHaveBeenCalled();
		expect( result ).toBe( false );
		expect( resolveBulkActions( [ action ] ) ).toEqual( [ action ] );
	} );

	it( 'hides user-hidden columns but never the title, and narrows to the phone set', () => {
		( window as unknown as { wp: { os: { getOsSettings: unknown } } } ).wp.os.getOsSettings = () => ( { nativePostsHiddenColumns: [ 'title', 'tags' ] } );
		const env = { extra: { mode: 'posts' as const }, client: createPostsRestClient( () => Promise.reject( new Error( 'no' ) ) ), openUrl: () => undefined, confirm: async () => false };
		expect( buildAllColumns( env, new Map() ).map( ( c ) => c.key ) ).toEqual( [ 'title', 'author', 'categories', 'tags', 'date' ] );
		expect( buildColumns( env, new Map() ).map( ( c ) => c.key ) ).toEqual( [ 'title', 'author', 'categories', 'date' ] );
		expect( buildColumns( env, new Map(), undefined, true ).map( ( c ) => c.key ) ).toEqual( [ 'title', 'author', 'date' ] );
		expect( buildColumns( { ...env, extra: { mode: 'pages' } }, new Map() ).map( ( c ) => c.key ) ).toEqual( [ 'title', 'author', 'parent', 'template', 'slug', 'comments', 'date' ] );
	} );

	it( 'maps column keys to REST orderby values and back', () => {
		expect( mapColumnToOrderby( 'title' ) ).toBe( 'title' );
		expect( mapColumnToOrderby( 'comments' ) ).toBe( 'comment_count' );
		expect( mapColumnToOrderby( 'wordCount' ) ).toBe( 'date' );
		expect( mapOrderbyToColumn( 'comment_count' ) ).toBe( 'comments' );
	} );
} );

describe( 'the REST client', () => {
	const json = ( body: unknown, headers: Record< string, string > = {} ) =>
		new Response( JSON.stringify( body ), { status: 200, headers: { 'Content-Type': 'application/json', ...headers } } );

	it( 'fetches terms with the projection and maps the any-status count', async () => {
		const fetch = vi.fn( async () => json( [ { id: 4, name: 'News', slug: 'news', parent: 0, count: 1, description: '', openstation_count: 3, openstation_is_default: true } ], { 'X-WP-Total': '1', 'X-WP-TotalPages': '1' } ) );
		const client = createPostsRestClient( fetch );
		const page = await client.fetchTerms( 'categories', { page: 2, perPage: 100 } );
		const path = String( ( fetch.mock.calls[ 0 ] as unknown as [ string ] )[ 0 ] );
		expect( path.startsWith( 'wp/v2/categories?' ) ).toBe( true );
		expect( path ).toContain( 'per_page=100' );
		expect( path ).toContain( 'page=2' );
		expect( path ).toContain( 'openstation_count' );
		expect( page.items[ 0 ] ).toMatchObject( { id: 4, count: 3, isDefault: true } );
		expect( page.totalPages ).toBe( 1 );
	} );

	it( 'surfaces the WP_Error message and recovers a term_exists create', async () => {
		const fetch = vi.fn()
			.mockResolvedValueOnce( new Response( JSON.stringify( { code: 'term_exists', message: 'Term exists.' } ), { status: 400, headers: { 'Content-Type': 'application/json' } } ) )
			.mockResolvedValueOnce( json( [ { id: 9, name: 'Featured', slug: 'featured' } ] ) );
		( window as unknown as { wp: { os: { broadcast?: unknown } } } ).wp.os.broadcast = vi.fn();
		const client = createPostsRestClient( fetch );
		expect( await client.createTag( 'featured' ) ).toMatchObject( { id: 9 } );
		const failing = createPostsRestClient( async () => new Response( '<html>', { status: 500, statusText: 'Internal Server Error' } ) );
		await expect( failing.fetchAllCategories() ).rejects.toThrow( /500/ );
	} );

	it( 'reads the satellite posts with the authoritative total', async () => {
		const fetch = vi.fn( async () => json( [ { id: 1, title: { rendered: 'A <b>b</b>' } } ], { 'X-WP-Total': '12', 'X-WP-TotalPages': '2' } ) );
		const client = createPostsRestClient( fetch );
		const res = await client.fetchTermPosts( 'tags', 5, 1, 10 );
		expect( String( ( fetch.mock.calls[ 0 ] as unknown as [ string ] )[ 0 ] ) ).toContain( 'tags=5' );
		expect( res ).toEqual( { items: [ { id: 1, title: 'A <b>b</b>' } ], totalPages: 2, total: 12 } );
	} );
} );
