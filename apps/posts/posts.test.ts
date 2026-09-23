/**
 * Posts app — the client view: the frame (tabs, toolbar, bulk bar,
 * table, pager, the phone footer), the table wiring and the mounted /
 * updated lifecycle, the column builders and hook registries, the
 * cells, the REST client over `ctx.fetch`, and the orderby mapping.
 * The Pages twin's copy is `pages.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockViewContext } from '../../src/app-runtime/testing';
import app from './posts.os';
import { createPostsApp } from './parts/app';
import { buildTitleCell } from './parts/cells/basic';
import { buildCategoriesCell } from './parts/cells/categories';
import type { CellEnv } from './parts/cells/env';
import { buildParentCell, buildSlugCell, buildTemplateCell, refreshParentTitleRoster } from './parts/cells/pages';
import { buildTagsCell } from './parts/cells/tags';
import { createPostsRestClient, type PostsRestClient } from './parts/rest';
import {
	buildAllColumns,
	buildColumns,
	columnLabels,
	defaultBulkActions,
	defaultStatusSegments,
	mapColumnToOrderby,
	mapOrderbyToColumn,
	renderMultiSelectFilter,
	resolveBulkActions,
	resolveStatusSegments,
} from './parts/columns';
import type { BulkAction, ListData, ListExtra, ListState, PostListItem, PostsWindowContext } from './parts/types';
import { runBulkAction } from './parts/window-context';

type TableEl = HTMLElement & {
	data?: PostListItem[];
	columns?: Array< { key: string } >;
	getRowId?: ( r: PostListItem ) => number;
	sort?: { key: string; direction: string } | null;
	selection?: Iterable< number | string >;
};

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

const POSTS_TABS = [
	{ id: 'posts', label: 'All posts' },
	{ id: 'new', label: 'Add Post' },
	{ id: 'categories', label: 'Categories' },
	{ id: 'tags', label: 'Tags' },
];

function state( over: Partial< ListState > = {} ): ListState {
	return { tab: 'posts', page: 1, perPage: 20, search: '', status: '', orderby: 'date', order: 'desc', author: [], tag: [], ...over };
}

function data( items: PostListItem[], over: Partial< ListData[ 'list' ] > = {} ): ListData {
	return { list: { items, total: items.length, pages: items.length ? 1 : 0, page: 1, perPage: 20, error: '', code: '', ...over } };
}

const json = ( body: unknown, headers: Record< string, string > = {} ) =>
	new Response( JSON.stringify( body ), { status: 200, headers: { 'Content-Type': 'application/json', ...headers } } );

/** A REST double answering the option fetches the app makes on mount. */
function restFetch() {
	return vi.fn( async ( input: RequestInfo | URL ) => {
		const path = String( input );
		if ( path.startsWith( 'wp/v2/users' ) ) {
			return json( [ { id: 1, name: 'Ann' } ] );
		}
		if ( path.startsWith( 'wp/v2/tags' ) ) {
			return json( [ { id: 7, name: 'featured', count: 2 } ], { 'X-WP-TotalPages': '1' } );
		}
		return json( [] );
	} );
}

function mount( s: Partial< ListState > = {}, d: ListData = data( [ row( 1 ), row( 2 ) ] ), extra: Partial< ListExtra > = {}, which = app, loading = false ) {
	const root = document.createElement( 'div' );
	document.body.appendChild( root );
	const dispatch = vi.fn( async () => true );
	const fetch = restFetch();
	const ctx = mockViewContext< ListState, ListData >( {
		state: state( s ),
		data: d,
		loading,
		root,
		// `menuTabs` is what `App::menu()` ships in the config extra, and
		// what the strip renders from — see `apps/posts/posts.os.php`.
		extra: { mode: 'posts', editPostUrlBase: 'http://x.test/wp-admin/post.php', newPostUrl: 'http://x.test/wp-admin/post-new.php', defaultOrderby: 'date', defaultOrder: 'desc', menuTabs: POSTS_TABS, ...extra },
		dispatch,
		fetch,
		host: { fetch, openUrl: vi.fn(), confirm: vi.fn( async () => true ), toast: vi.fn(), announce: vi.fn() },
	} );
	ctx.repaint = () => which.render( ctx );
	which.render( ctx );
	return { root, ctx, dispatch, fetch, table: () => root.querySelector( '[data-os-posts-table]' ) as TableEl };
}

const flush = () => new Promise( ( r ) => setTimeout( r, 0 ) );

function cellEnv( over: Partial< CellEnv > = {} ): CellEnv & { toast: ReturnType< typeof vi.fn >; announce: ReturnType< typeof vi.fn > } {
	return {
		extra: { mode: 'posts', editPostUrlBase: 'http://x.test/wp-admin/post.php' },
		client: createPostsRestClient( () => Promise.reject( new Error( 'no' ) ) ),
		cells: {},
		openUrl: vi.fn(),
		confirm: vi.fn( async () => true ),
		toast: vi.fn(),
		announce: vi.fn(),
		parentTitles: new Map(),
		categories: { tree: null, pickers: new Set() },
		...over,
	} as CellEnv & { toast: ReturnType< typeof vi.fn >; announce: ReturnType< typeof vi.fn > };
}

let unsubscribeSettings: ReturnType< typeof vi.fn >;
let settingsListener: ( () => void ) | null;
let busListener: ( ( payload: unknown ) => void ) | null;

beforeEach( () => {
	unsubscribeSettings = vi.fn();
	settingsListener = null;
	busListener = null;
	( window as unknown as { wp?: unknown } ).wp = {
		os: {
			getOsSettings: () => ( { nativePostsHiddenColumns: [] } ),
			updateOsSettings: vi.fn(),
			subscribeOsSettings: ( cb: () => void ) => {
				settingsListener = cb;
				return unsubscribeSettings;
			},
			subscribe: ( _channel: string, cb: ( payload: unknown ) => void ) => {
				busListener = cb;
				return () => undefined;
			},
			broadcast: vi.fn(),
		},
		hooks: { applyFilters: ( _n: string, v: unknown ) => v, doAction: vi.fn() },
	};
} );

afterEach( () => {
	document.body.replaceChildren();
	document.documentElement.removeAttribute( 'data-os-mode' );
	delete ( window as unknown as { wp?: unknown } ).wp;
	vi.restoreAllMocks();
} );

/** Pick a tab the way the strip's own change event does. */
function tab( root: HTMLElement, value: string ): void {
	root.querySelector( 'os-tabs' )!.dispatchEvent(
		new CustomEvent( 'os-tab-change', { detail: { value } } ),
	);
}

/** An embedded page that answers the bridge query "yes, I am holding". */
function holdingFrame(): HTMLIFrameElement {
	const frame = document.createElement( 'iframe' );
	Object.defineProperty( frame, 'contentWindow', {
		value: {
			postMessage: ( message: { requestId?: string } ) => {
				window.dispatchEvent(
					new MessageEvent( 'message', {
						origin: window.location.origin,
						source: frame.contentWindow as unknown as Window,
						data: {
							type: 'os-bridge-beforeunload-response',
							requestId: message.requestId,
							prevent: true,
						},
					} ),
				);
			},
		},
	} );
	return frame;
}

/** A filter bus: the harness's stub returns the value unchanged. */
function stubFilters() {
	const registered: Array< ( ...a: unknown[] ) => unknown > = [];
	const previous = window.wp!.hooks;
	window.wp!.hooks = {
		...previous,
		addFilter: ( _n: string, _ns: string, cb: ( ...a: unknown[] ) => unknown ) => {
			registered.push( cb );
		},
		removeFilter: () => registered.splice( 0 ).length,
		applyFilters: ( _n: string, value: unknown, ...args: unknown[] ) =>
			registered.reduce( ( acc, cb ) => cb( acc, ...args ), value ),
	} as typeof previous;
	return {
		applyFilters: ( name: string, value: unknown, ...args: unknown[] ) =>
			( window.wp!.hooks as unknown as {
				applyFilters: ( n: string, v: unknown, ...a: unknown[] ) => unknown;
			} ).applyFilters( name, value, ...args ),
		restore: () => {
			window.wp!.hooks = previous;
		},
	};
}

/**
 * Stand in for the shell's `wp.os.embedAdminPage()`, which is what
 * puts the editor in the Add Post panel. Returns what it was asked to
 * embed, a count of teardowns, and the undo.
 */
function stubEmbed() {
	const embedded: Array< [ HTMLElement, string ] > = [];
	let teardowns = 0;
	const os = ( window as unknown as { wp?: { os?: Record< string, unknown > } } ).wp?.os;
	os!.embedAdminPage = ( host: HTMLElement, url: string ) => {
		embedded.push( [ host, url ] );
		return () => {
			teardowns++;
		};
	};
	return {
		embedded,
		torn: () => teardowns,
		restore: () => {
			delete os!.embedAdminPage;
		},
	};
}

describe( 'the frame', () => {
	it( 'declares a placeholder: the frame paints before mount, on the declared page size, with no "No posts" for the beat', () => {
		const placeholder = app.placeholder!( state( { page: 2, perPage: 50 } ) ) as ListData;
		expect( placeholder ).toEqual( { list: { items: [], total: 0, pages: 0, page: 2, perPage: 50, error: '', code: '' } } );

		const summary = ( root: HTMLElement ): string => root.querySelector( '.os-app-list__pager-meta' )?.textContent?.trim() ?? '';
		const { root, table } = mount( { page: 2, perPage: 50 }, placeholder, {}, app, true );
		expect( root.querySelector( 'os-segmented' ) ).not.toBeNull();
		expect( table() ).not.toBeNull();
		expect( summary( root ) ).toBe( '' );

		const settled = mount( {}, data( [] ) );
		expect( settled.root.querySelector( '.os-posts-desk__empty h3' )?.textContent ).toBe( 'No posts found.' );
	} );

	it( 'paints the tabs, the toolbar bound to filter, the table and the pager', () => {
		const { root } = mount();
		expect( root.querySelector( '[data-os-posts-root]' )!.classList.contains( 'desktop-mode-posts' ) ).toBe( true );
		// The same list, in the same order, the Posts menu shows in the
		// dock: All posts, Add New Post, Categories, Tags.
		expect( Array.from( root.querySelectorAll( 'os-tab' ) ).map( ( t ) => t.getAttribute( 'value' ) ) ).toEqual( [ 'posts', 'new', 'categories', 'tags' ] );
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
		expect( root.querySelector( '.os-app-list__pager' ) ).toBeNull();
		expect( root.querySelector( '[data-content-feed-end]' )?.textContent ).toContain( 'caught up' );
		expect( root.querySelector( '[data-os-posts-cats-host]' )!.hasAttribute( 'os-preserve' ) ).toBe( true );
	} );

	it( 'shows an empty state without pagination when the collection is empty', () => {
		const { root } = mount( {}, data( [] ) );
		expect( root.querySelector( '.os-posts-desk__empty h3' )?.textContent ).toBe( 'No posts found.' );
		expect( root.querySelector( '.os-app-list__pager' ) ).toBeNull();
	} );

	it( 'the hero button and the Add Post tab both embed the editor', async () => {
		const embed = stubEmbed();
		try {
			const { root, ctx } = mount();
			const strip = root.querySelector( 'os-tabs' ) as HTMLElement & { value: string };
			( root.querySelector( '[data-os-posts-new]' ) as HTMLElement ).click();
			expect( strip.value ).toBe( 'new' );
			expect( embed.embedded ).toHaveLength( 1 );
			expect( embed.embedded[ 0 ][ 0 ] ).toBe( root.querySelector( '[data-os-posts-editor]' ) );
			expect( embed.embedded[ 0 ][ 1 ] ).toBe( 'http://x.test/wp-admin/post-new.php' );
			expect( ctx.host.openUrl ).not.toHaveBeenCalled();

			// Leaving asks the page whether it is holding anything.
			// Nothing here is, so the embed goes and the next visit
			// mounts a blank editor, the way post-new.php does in a
			// classic window.
			tab( root, 'posts' );
			await flush();
			expect( embed.torn() ).toBe( 1 );
			tab( root, 'new' );
			expect( embed.embedded ).toHaveLength( 2 );
		} finally {
			embed.restore();
		}
	} );

	it( 'a draft in progress is kept, and closing the window asks first', async () => {
		const embed = stubEmbed();
		const bus = stubFilters();
		const closed = vi.fn();
		const os = ( window as unknown as { wp: { os: Record< string, unknown > } } ).wp.os;
		os.windowManager = { getById: () => ( { close: closed } ) };
		try {
			const { root, ctx } = mount();
			app.mounted?.( ctx );
			tab( root, 'new' );
			root.querySelector( '[data-os-posts-editor]' )!.appendChild( holdingFrame() );

			// A page with unsaved changes is handed back, not dropped.
			tab( root, 'posts' );
			await flush();
			expect( embed.torn() ).toBe( 0 );
			tab( root, 'new' );
			expect( embed.embedded ).toHaveLength( 1 );

			// And the window cannot close without asking: the shell's
			// own query is for a window's iframe, which an embed is not.
			expect(
				bus.applyFilters( 'os.native-window.before-close', true, {
					windowId: ctx.windowId,
				} ),
			).toBe( false );
			await flush();
			expect( ctx.host.confirm ).toHaveBeenCalled();
			await flush();
			expect( closed ).toHaveBeenCalled();
		} finally {
			embed.restore();
			bus.restore();
			delete ( os as Record< string, unknown > ).windowManager;
		}
	} );

	it( 'opens on the tab the server named — the dock row that asked for it', () => {
		const embed = stubEmbed();
		try {
			// `{ tab: 'new' }` is what the Add Post row's remap passes.
			const { root } = mount( { tab: 'new' } );
			expect( ( root.querySelector( 'os-tabs' ) as HTMLElement & { value: string } ).value ).toBe( 'new' );
			expect( embed.embedded ).toHaveLength( 1 );
		} finally {
			embed.restore();
		}
	} );

	it( 'anchors the bulk bar below the workspace on desktop and phone', () => {
		const desk = mount();
		expect( desk.root.querySelector( '.os-app-list__toolbar [data-os-posts-bulk]' ) ).toBeNull();
		expect( desk.root.querySelector( '.os-app-list__bulk--footer' ) ).not.toBeNull();
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
		const { ctx, table } = mount( { orderby: 'title', order: 'asc' } );
		const t = table();
		expect( t.getRowId!( row( 9 ) ) ).toBe( 9 );
		expect( t.sort ).toEqual( { key: 'title', direction: 'asc' } );
		expect( t.data ).toHaveLength( 2 );
		expect( ( t.columns ?? [] ).map( ( c ) => c.key ) ).toEqual( [ 'title', 'author', 'categories', 'tags', 'date' ] );
		let assignments = 0;
		let stored = t.data;
		Object.defineProperty( t, 'data', {
			get: () => stored,
			set: ( v: PostListItem[] ) => {
				assignments++;
				stored = v;
			},
		} );
		app.render( ctx );
		expect( assignments ).toBe( 0 );
	} );

	it( 'a sort change dispatches `sort`; clearing it returns to the declared default', () => {
		const { dispatch, table } = mount( {}, undefined, { defaultOrderby: 'menu_order', defaultOrder: 'asc' } );
		table().dispatchEvent( new CustomEvent( 'os-table-sort-change', { detail: { sort: { key: 'comments', direction: 'asc' } } } ) );
		expect( dispatch ).toHaveBeenCalledWith( 'sort', { orderby: 'comment_count', order: 'asc' } );
		table().dispatchEvent( new CustomEvent( 'os-table-sort-change', { detail: { sort: { key: 'wordCount', direction: 'desc' } } } ) );
		expect( dispatch ).toHaveBeenCalledWith( 'sort', { orderby: 'menu_order', order: 'desc' } );
		table().dispatchEvent( new CustomEvent( 'os-table-sort-change', { detail: { sort: null } } ) );
		expect( dispatch ).toHaveBeenCalledWith( 'sort', { orderby: 'menu_order', order: 'asc' } );
	} );

	it( 'a column filter change writes the ids locally and dispatches `filter`', () => {
		const { ctx, dispatch, table } = mount();
		const local = vi.fn();
		ctx.local = local;
		table().dispatchEvent( new CustomEvent( 'os-table-filter-change', { detail: { filters: { author: '3, 5', tags: '' } } } ) );
		expect( local ).toHaveBeenCalledWith( 'set-column-filters', { author: [ 3, 5 ], tag: [] } );
		expect( dispatch ).toHaveBeenCalledWith( 'filter' );
		expect( app.runLocal( 'set-column-filters', state(), { author: [ 3 ], tag: [ 7 ] }, undefined ) ).toMatchObject( { author: [ 3 ], tag: [ 7 ] } );
	} );
} );

describe( 'mounted and updated', () => {
	it( 'loads the filter options, fires the opened hook with a live context, and announces the data', async () => {
		const { ctx, fetch, table } = mount();
		const opened = vi.fn();
		document.addEventListener( 'os-posts-window-opened', opened, { once: true } );
		const teardown = app.mounted( ctx ) as () => void;
		await flush();
		const paths = fetch.mock.calls.map( ( c ) => String( c[ 0 ] ) );
		expect( paths.some( ( p ) => p.startsWith( 'wp/v2/users' ) ) ).toBe( true );
		expect( paths.some( ( p ) => p.startsWith( 'wp/v2/tags' ) ) ).toBe( true );
		expect( opened ).toHaveBeenCalledTimes( 1 );
		const context = ( opened.mock.calls[ 0 ][ 0 ] as CustomEvent< PostsWindowContext > ).detail;
		expect( context.table ).toBe( table() );
		expect( context.getCurrentParams() ).toMatchObject( { page: 1, perPage: 20, orderby: 'date' } );
		Object.assign( ctx, { state: state( { page: 2, search: 'updated' } ) } );
		expect( context.getCurrentParams() ).toMatchObject( { page: 2, search: 'updated' } );
		expect( ( window as unknown as { wp: { hooks: { doAction: ReturnType< typeof vi.fn > } } } ).wp.hooks.doAction ).toHaveBeenCalledWith( 'openstation.postsWindow.opened', context );
		expect( ( window as unknown as { wp: { hooks: { doAction: ReturnType< typeof vi.fn > } } } ).wp.hooks.doAction ).toHaveBeenCalledWith(
			'openstation.postsWindow.dataLoaded',
			expect.objectContaining( { total: 2, page: 1 } ),
		);
		teardown();
		expect( unsubscribeSettings ).toHaveBeenCalled();
	} );

	it( 'rebuilds the columns when the hidden set changes elsewhere, and repaints on a mode crossing', () => {
		const { ctx, table } = mount();
		app.mounted( ctx );
		expect( ( table().columns ?? [] ).map( ( c ) => c.key ) ).toContain( 'tags' );
		( window as unknown as { wp: { os: { getOsSettings: unknown } } } ).wp.os.getOsSettings = () => ( { nativePostsHiddenColumns: [ 'tags' ] } );
		settingsListener!();
		expect( ( table().columns ?? [] ).map( ( c ) => c.key ) ).toEqual( [ 'title', 'author', 'categories', 'date' ] );
		const repaint = vi.spyOn( ctx, 'repaint' );
		document.dispatchEvent( new CustomEvent( 'os-mode-changed' ) );
		expect( repaint ).toHaveBeenCalled();
	} );

	it( 'the ⋯ menu lists the togglable columns and a toggle writes the setting for this window', () => {
		const win = document.createElement( 'div' );
		win.className = 'os-window';
		const panel = document.createElement( 'div' );
		panel.className = 'os-window__menu-panel';
		win.appendChild( panel );
		document.body.appendChild( win );
		const { ctx, root } = mount();
		win.appendChild( root );
		app.mounted( ctx );
		const items = Array.from( panel.querySelectorAll( 'os-menu-item' ) ).map( ( el ) => el.getAttribute( 'value' ) );
		expect( items ).toEqual( [ 'desktop-mode-posts:author', 'desktop-mode-posts:categories', 'desktop-mode-posts:tags', 'desktop-mode-posts:date' ] );
		panel.dispatchEvent( new CustomEvent( 'os-menu-item-click', { detail: { value: 'desktop-mode-posts:tags' } } ) );
		const update = ( window as unknown as { wp: { os: { updateOsSettings: ReturnType< typeof vi.fn > } } } ).wp.os.updateOsSettings;
		expect( update ).toHaveBeenCalledWith( { nativePostsHiddenColumns: [ 'tags' ] }, { windowId: 'test-window' } );
	} );

	it( 'a category change on the bus refreshes the shared tree', async () => {
		const { ctx, fetch } = mount();
		app.mounted( ctx );
		await flush();
		fetch.mockClear();
		busListener!( { taxonomy: 'post_tag' } );
		await flush();
		expect( fetch ).not.toHaveBeenCalled();
		busListener!( { taxonomy: 'category' } );
		await flush();
		expect( fetch.mock.calls.some( ( c ) => String( c[ 0 ] ).startsWith( 'wp/v2/categories' ) ) ).toBe( true );
	} );

	it( 'a canvas that resolves after the window closed is torn down at once', async () => {
		let resolveCanvas: ( teardown: () => void ) => void = () => undefined;
		const canvasTeardown = vi.fn();
		const deferred = ( r: ( teardown: () => void ) => void ): void => {
			resolveCanvas = r;
		};
		const mountCanvas = vi.fn( (): Promise< () => void > => new Promise( deferred ) );
		const custom = createPostsApp( 'desktop-mode-posts', { terms: { categories: mountCanvas, tags: mountCanvas } } );
		const { ctx, root } = mount( {}, undefined, {}, custom );
		const teardown = custom.mounted( ctx ) as () => void;
		root.querySelector( 'os-tabs' )!.dispatchEvent( new CustomEvent( 'os-tab-change', { detail: { value: 'categories' } } ) );
		expect( mountCanvas ).toHaveBeenCalledTimes( 1 );
		expect( ( mountCanvas.mock.calls[ 0 ] as unknown as [ HTMLElement ] )[ 0 ] ).toBe( root.querySelector( '[data-os-posts-cats-host]' ) );
		// A second activation while the first load is in flight is not a second mount.
		root.querySelector( 'os-tabs' )!.dispatchEvent( new CustomEvent( 'os-tab-change', { detail: { value: 'categories' } } ) );
		expect( mountCanvas ).toHaveBeenCalledTimes( 1 );
		teardown();
		resolveCanvas( canvasTeardown );
		await flush();
		expect( canvasTeardown ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'hands a canvas its doors: the client, the toasts and the fullscreen exit', async () => {
		const toggleFullscreen = vi.fn();
		( window as unknown as { wp: { os: Record< string, unknown > } } ).wp.os.windowManager = {
			getById: ( id: string ) => ( id === 'test-window' ? { isFullscreen: () => true, toggleFullscreen } : null ),
		};
		const mountCanvas = vi.fn( async () => () => undefined );
		const custom = createPostsApp( 'desktop-mode-posts', { terms: { categories: mountCanvas, tags: mountCanvas } } );
		const { ctx, root } = mount( {}, undefined, {}, custom );
		custom.mounted( ctx );
		root.querySelector( 'os-tabs' )!.dispatchEvent( new CustomEvent( 'os-tab-change', { detail: { value: 'tags' } } ) );
		const env = ( mountCanvas.mock.calls[ 0 ] as unknown as [ HTMLElement, { leaveFullscreen: () => void; toast: ( t: string, e: unknown ) => void; extra: ListExtra } ] )[ 1 ];
		env.leaveFullscreen();
		expect( toggleFullscreen ).toHaveBeenCalled();
		env.toast( 'Couldn’t load tags:', new Error( 'boom' ) );
		expect( ctx.host.toast ).toHaveBeenCalledWith( { message: 'Couldn’t load tags: boom', type: 'error', duration: 6000 } );
		expect( env.extra.mode ).toBe( 'posts' );
	} );
} );

describe( 'the bulk bar', () => {
	it( 'shows the count for the selection and runs the trash action over it', async () => {
		const { ctx, root, dispatch, table } = mount();
		app.mounted( ctx );
		expect( ( root.querySelector( '[data-os-posts-bulk]' ) as HTMLElement ).hidden ).toBe( true );
		table().selection = [ 1, 2 ];
		table().dispatchEvent( new CustomEvent( 'os-table-selection-change' ) );
		expect( ( root.querySelector( '[data-os-posts-bulk]' ) as HTMLElement ).hidden ).toBe( false );
		expect( root.querySelector( '[data-os-posts-count]' )!.textContent ).toBe( '2 selected' );
		( root.querySelector( '[data-os-posts-bulk-action="trash"]' ) as HTMLElement ).click();
		await flush();
		expect( ctx.host.confirm ).toHaveBeenCalledWith( { message: 'Move 2 posts to the trash?', danger: true } );
		expect( dispatch ).toHaveBeenCalledWith( 'trash', { ids: [ 1, 2 ] } );
		expect( Array.from( table().selection ?? [] ) ).toEqual( [] );
	} );

	it( 'runBulkAction confirms, tolerates a throwing runner, and refreshes unless the runner opts out', async () => {
		const { ctx } = mount();
		const clearSelection = vi.fn();
		const refresh = vi.fn( async () => undefined );
		const postsCtx = { getSelectedIds: () => [ 4 ], table: { clearSelection }, refresh } as unknown as PostsWindowContext;
		const run = vi.fn( async () => undefined );
		const action: BulkAction = { id: 'x', label: 'X', confirm: 'Sure about %d?', run };
		( ctx.host.confirm as ReturnType< typeof vi.fn > ).mockResolvedValueOnce( false );
		await runBulkAction( ctx, action, postsCtx );
		expect( run ).not.toHaveBeenCalled();
		await runBulkAction( ctx, action, postsCtx );
		expect( ctx.host.confirm ).toHaveBeenLastCalledWith( { message: 'Sure about 1?', danger: true } );
		expect( run ).toHaveBeenCalledWith( [ 4 ], postsCtx );
		expect( clearSelection ).toHaveBeenCalledTimes( 1 );
		expect( refresh ).toHaveBeenCalledTimes( 1 );
		vi.spyOn( console, 'error' ).mockImplementation( () => undefined );
		const throwing: BulkAction = {
			id: 'y',
			label: 'Y',
			run: async () => {
				throw new Error( 'nope' );
			},
		};
		await runBulkAction( ctx, throwing, postsCtx );
		expect( refresh ).toHaveBeenCalledTimes( 2 );
		const optingOut: BulkAction = { id: 'z', label: 'Z', run: async (): Promise< false > => false };
		await runBulkAction( ctx, optingOut, postsCtx );
		expect( refresh ).toHaveBeenCalledTimes( 2 );
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

	it( 'hides user-hidden columns but never the title, narrows to the phone set, and lists the togglable ones', () => {
		const env = cellEnv( { cells: { tags: buildTagsCell, categories: buildCategoriesCell } } );
		expect( buildAllColumns( env, new Map() ).map( ( c ) => c.key ) ).toEqual( [ 'title', 'author', 'categories', 'tags', 'date' ] );
		expect( buildColumns( env, new Map(), undefined, false, new Set( [ 'title', 'tags' ] ) ).map( ( c ) => c.key ) ).toEqual( [ 'title', 'author', 'categories', 'date' ] );
		expect( buildColumns( env, new Map(), undefined, true, new Set() ).map( ( c ) => c.key ) ).toEqual( [ 'title', 'author', 'date' ] );
		expect( columnLabels( env ).map( ( c ) => c.key ) ).toEqual( [ 'author', 'categories', 'tags', 'date' ] );
		// The Pages bundle ships no taxonomy cells: the posts set shrinks to what it has.
		expect( buildAllColumns( cellEnv(), new Map() ).map( ( c ) => c.key ) ).toEqual( [ 'title', 'author', 'date' ] );
		const pages = cellEnv( { extra: { mode: 'pages' } } );
		expect( buildColumns( pages, new Map(), undefined, false, new Set() ).map( ( c ) => c.key ) ).toEqual( [ 'title', 'author', 'parent', 'template', 'slug', 'comments', 'date' ] );
	} );

	it( 'mounts a multiselect filter once and reconciles it after', () => {
		const host = document.createElement( 'td' );
		const setValue = vi.fn();
		const ctx = { value: '3', setValue };
		const setItems = vi.spyOn( customElements.get( 'os-multiselect' )!.prototype, 'items', 'set' );
		const opts = { label: 'All tags', ariaLabel: 'Filter by tag', dataKey: 'tags' };
		renderMultiSelectFilter( host, ctx, [ { id: 3, name: 'a' } ], opts );
		renderMultiSelectFilter( host, { ...ctx, value: '3,4' }, [ { id: 3, name: 'a' }, { id: 4, name: 'b' } ], { ...opts, hasMore: true } );
		const pickers = host.querySelectorAll( 'os-multiselect' );
		expect( pickers ).toHaveLength( 1 );
		const picker = pickers[ 0 ] as HTMLElement & { hasMore: boolean };
		expect( picker.getAttribute( 'value' ) ).toBe( '3,4' );
		expect( setItems ).toHaveBeenCalledTimes( 2 );
		expect( ( setItems.mock.calls[ 1 ] as unknown as [ Array< { value: string } > ] )[ 0 ].map( ( i ) => i.value ) ).toEqual( [ '3', '4' ] );
		expect( picker.hasMore ).toBe( true );
		picker.dispatchEvent( new CustomEvent( 'os-pick', { detail: { value: '4' } } ) );
		expect( setValue ).toHaveBeenCalledWith( '4' );
	} );

	it( 'maps column keys to REST orderby values and back', () => {
		expect( mapColumnToOrderby( 'title' ) ).toBe( 'title' );
		expect( mapColumnToOrderby( 'comments' ) ).toBe( 'comment_count' );
		expect( mapColumnToOrderby( 'wordCount' ) ).toBe( 'date' );
		expect( mapColumnToOrderby( 'wordCount', 'menu_order' ) ).toBe( 'menu_order' );
		expect( mapOrderbyToColumn( 'comment_count' ) ).toBe( 'comments' );
	} );
} );

describe( 'the cells', () => {
	it( 'the title cell paints the lock, the reading-page badges, the status and the View link', () => {
		const env = cellEnv( { extra: { mode: 'pages', editPostUrlBase: 'http://x.test/wp-admin/post.php', frontPageId: 5, postsPageId: 6 } } );
		const pills = ( cell: HTMLElement ) =>
			Array.from( cell.querySelectorAll( 'span[style*="border-radius"]' ) ).map( ( p ) => p.lastElementChild!.textContent );
		const front = buildTitleCell(
			row( 5, {
				title: { rendered: 'Home &amp; Away' },
				link: 'http://x.test/',
				openstation_lock: { userId: 2, userName: 'Bob', userAvatarUrl: '', time: '1' },
			} ),
			env,
		);
		expect( pills( front ) ).toEqual( [ 'Bob', 'Front page' ] );
		expect( front.querySelector( 'a[target="_blank"]' )!.textContent ).toBe( 'View' );
		const link = front.querySelector( 'a' )!;
		expect( link.textContent ).toBe( 'Home & Away' );
		link.click();
		expect( env.openUrl ).toHaveBeenCalledWith( 'http://x.test/wp-admin/post.php?post=5&action=edit', 'Home & Away', 'dashicons-admin-post' );

		const draft = buildTitleCell( row( 6, { status: 'draft', link: 'http://x.test/d' } ), env );
		expect( pills( draft ) ).toEqual( [ 'Posts page', 'Draft' ] );
		expect( draft.querySelector( 'a[target="_blank"]' ) ).toBeNull();
	} );

	it( 'the pages cells read the template map and the parent roster', () => {
		const env = cellEnv( { extra: { mode: 'pages', pageTemplates: { '': 'Default template', 'wide.php': 'Wide' } } } );
		expect( buildTemplateCell( row( 1, { template: '' } ), env ).textContent ).toBe( 'Default template' );
		expect( buildTemplateCell( row( 1, { template: 'wide.php' } ), env ).textContent ).toBe( 'Wide' );
		expect( buildTemplateCell( row( 1, { template: 'odd.php' } ), env ).textContent ).toBe( 'odd.php' );
		refreshParentTitleRoster( env, [ row( 1, { title: { rendered: 'About' } } ) ] );
		expect( buildParentCell( row( 2, { parent: 1 } ), env ).textContent ).toBe( '↳ About' );
		expect( buildParentCell( row( 3, { parent: 42 } ), env ).textContent ).toBe( '↳ #42' );
		expect( buildParentCell( row( 4, { parent: 0 } ), env ).textContent ).toBe( '—' );
	} );

	it( 'the slug cell copies on click and says so when the clipboard refuses', async () => {
		const env = cellEnv( { extra: { mode: 'pages' } } );
		const cell = buildSlugCell( row( 1, { slug: 'about-us' } ), env ) as HTMLButtonElement;
		expect( cell.textContent ).toBe( 'about-us' );
		Object.defineProperty( navigator, 'clipboard', { value: { writeText: vi.fn( async () => undefined ) }, configurable: true } );
		cell.click();
		await flush();
		expect( cell.textContent ).toBe( 'Copied!' );
		Object.defineProperty( navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue( new Error( 'denied' ) ) }, configurable: true } );
		( document as unknown as { execCommand?: unknown } ).execCommand = undefined;
		cell.click();
		await flush();
		expect( env.toast ).toHaveBeenCalledWith( 'Couldn’t copy the slug.', null );
		expect( ( buildSlugCell( row( 2, { slug: '' } ), env ) as HTMLButtonElement ).disabled ).toBe( true );
	} );

	it( 'the tags cell persists an add and rolls back on failure with a toast', async () => {
		const updatePostTags = vi.fn().mockResolvedValueOnce( undefined ).mockRejectedValueOnce( new Error( 'offline' ) );
		const client = { updatePostTags, searchTags: vi.fn( async () => [] ) } as unknown as PostsRestClient;
		const env = cellEnv( { client } );
		const cell = buildTagsCell( row( 1, { _embedded: { 'wp:term': [ [ { id: 3, name: 'news', taxonomy: 'post_tag', link: '' } ] ] } } ), env );
		const picker = cell.querySelector( 'os-tag-input' ) as HTMLElement & { value: Array< { id: number | string; label: string } > };
		expect( picker.value.map( ( t ) => t.label ) ).toEqual( [ 'news' ] );
		picker.dispatchEvent( new CustomEvent( 'os-tag-add', { detail: { tag: { id: 9, label: 'hot' }, isNew: false } } ) );
		await flush();
		expect( updatePostTags ).toHaveBeenCalledWith( 1, [ 3, 9 ] );
		expect( picker.value.map( ( t ) => t.id ) ).toEqual( [ 3, 9 ] );
		expect( env.announce ).toHaveBeenCalledWith( 'tagged', [ 1 ] );
		picker.dispatchEvent( new CustomEvent( 'os-tag-add', { detail: { tag: { id: 11, label: 'cold' }, isNew: false } } ) );
		await flush();
		expect( picker.value.map( ( t ) => t.label ) ).toEqual( [ 'news', 'hot' ] );
		expect( env.toast ).toHaveBeenCalledWith( 'Couldn’t add tag "cold".', expect.any( Error ) );
	} );

	it( 'the categories cell merges a dropped chain and ignores a drop with nothing new', async () => {
		const updatePostCategories = vi.fn( async () => undefined );
		const client = { updatePostCategories, fetchAllCategories: vi.fn( async () => [] ) } as unknown as PostsRestClient;
		const env = cellEnv( { client } );
		const cell = buildCategoriesCell( row( 1, { categories: [ 2 ] } ), env );
		expect( env.categories.pickers.size ).toBe( 1 );
		const drop = ( ids: number[] ) => {
			const payload = JSON.stringify( { ids, source: 'posts-window', sourcePostId: 7 } );
			const event = new Event( 'drop', { cancelable: true } ) as DragEvent;
			Object.defineProperty( event, 'dataTransfer', {
				value: { types: [ 'application/x-os-categories' ], getData: () => payload },
			} );
			cell.dispatchEvent( event );
		};
		drop( [ 2 ] );
		await flush();
		expect( updatePostCategories ).not.toHaveBeenCalled();
		drop( [ 2, 5 ] );
		await flush();
		expect( updatePostCategories ).toHaveBeenCalledWith( 1, [ 2, 5 ] );
		expect( env.announce ).toHaveBeenCalledWith( 'categorized', [ 1 ] );
	} );
} );

describe( 'the REST client', () => {
	it( 'fetches terms without the per-term count and walks every page', async () => {
		const fetch = vi.fn( async ( input: RequestInfo | URL ) => {
			const page = /[?&]page=(\d+)/.exec( String( input ) )?.[ 1 ];
			return json( [ { id: Number( page ), name: `T${ page }`, slug: `t${ page }`, parent: 0, count: 1, description: '', openstation_is_default: page === '1' } ], { 'X-WP-Total': '2', 'X-WP-TotalPages': '2' } );
		} );
		const client = createPostsRestClient( fetch );
		const all = await client.fetchAllTerms( 'categories' );
		expect( all.map( ( t ) => t.id ) ).toEqual( [ 1, 2 ] );
		expect( all[ 0 ] ).toMatchObject( { count: 1, isDefault: true } );
		const path = String( ( fetch.mock.calls[ 0 ] as unknown as [ string ] )[ 0 ] );
		expect( path.startsWith( 'wp/v2/categories?' ) ).toBe( true );
		expect( path ).toContain( 'per_page=100' );
		expect( path ).not.toContain( 'openstation_count' );
		expect( fetch ).toHaveBeenCalledTimes( 2 );
	} );

	it( 'surfaces the WP_Error message and recovers a term_exists create', async () => {
		const fetch = vi.fn()
			.mockResolvedValueOnce( new Response( JSON.stringify( { code: 'term_exists', message: 'Term exists.' } ), { status: 400, headers: { 'Content-Type': 'application/json' } } ) )
			.mockResolvedValueOnce( json( [ { id: 9, name: 'Featured', slug: 'featured' } ] ) );
		const client = createPostsRestClient( fetch );
		expect( await client.createTag( 'featured' ) ).toMatchObject( { id: 9 } );
		const failing = createPostsRestClient( async () => new Response( '<html>', { status: 500, statusText: 'Internal Server Error' } ) );
		await expect( failing.fetchAllCategories() ).rejects.toThrow( /500/ );
	} );

	it( 'updateTerm returns the normalised row and broadcasts the change', async () => {
		const fetch = vi.fn( async () => json( { id: 4, name: 'News', slug: 'news', parent: 0, count: 3, description: 'd' } ) );
		const client = createPostsRestClient( fetch );
		const updated = await client.updateTerm( 'categories', 4, { name: 'News' } );
		expect( updated ).toEqual( { id: 4, name: 'News', slug: 'news', parent: 0, count: 3, description: 'd', isDefault: false } );
		expect( ( window as unknown as { wp: { os: { broadcast: ReturnType< typeof vi.fn > } } } ).wp.os.broadcast ).toHaveBeenCalledWith(
			'os.term.changed',
			expect.objectContaining( { taxonomy: 'category', action: 'updated', id: 4 } ),
		);
	} );

	it( 'reads the satellite posts with the authoritative total', async () => {
		const fetch = vi.fn( async () => json( [ { id: 1, title: { rendered: 'A <b>b</b>' } } ], { 'X-WP-Total': '12', 'X-WP-TotalPages': '2' } ) );
		const client = createPostsRestClient( fetch );
		const res = await client.fetchTermPosts( 'tags', 5, 1, 10 );
		expect( String( ( fetch.mock.calls[ 0 ] as unknown as [ string ] )[ 0 ] ) ).toContain( 'tags=5' );
		expect( res ).toEqual( { items: [ { id: 1, title: 'A <b>b</b>' } ], totalPages: 2, total: 12 } );
	} );
} );

describe( 'the writing desk', () => {
	it.each( [ 'posts', 'pages' ] as const )( 'copies the %s card ID without selecting or opening the content', async ( mode ) => {
		const writeText = vi.fn( async () => undefined );
		Object.defineProperty( navigator, 'clipboard', { value: { writeText }, configurable: true } );
		const { root, ctx, table } = mount( {}, data( [ row( 123 ) ] ), { mode } );
		await flush();
		const chip = root.querySelector< HTMLElement >( '.os-posts-desk__id' )!;
		expect( chip.textContent ).toContain( '#123' );
		expect( chip.getAttribute( 'title' ) ).toBe( `Copy ${ mode === 'pages' ? 'page' : 'post' } ID 123` );
		chip.shadowRoot!.querySelector( 'button' )!.click();
		await flush();
		expect( writeText ).toHaveBeenCalledWith( '123' );
		expect( ctx.host.toast ).toHaveBeenCalledWith( { message: `Copied ${ mode === 'pages' ? 'page' : 'post' } ID #123.` } );
		expect( ctx.host.openUrl ).not.toHaveBeenCalled();
		expect( Array.from( table().selection ?? [] ) ).toEqual( [] );
	} );

	it( 'reports a failed ID copy honestly', async () => {
		Object.defineProperty( navigator, 'clipboard', { value: undefined, configurable: true } );
		const { root, ctx } = mount();
		root.querySelector< HTMLElement >( '.os-posts-desk__id' )!.click();
		await flush();
		expect( ctx.host.toast ).toHaveBeenCalledWith( { message: 'Couldn’t copy the ID. Please try again.' } );
	} );

	it( 'starts with story previews and keeps the extension table populated', () => {
		const { root, table } = mount( {}, data( [ row( 1, { excerpt: { rendered: '<p>A &amp; B <strong>story</strong></p>' } } ) ] ) );
		expect( root.querySelector( '.os-posts-desk__workspace' )?.hasAttribute( 'hidden' ) ).toBe( false );
		expect( root.querySelector( '[data-os-posts-body]' )?.hasAttribute( 'hidden' ) ).toBe( true );
		expect( table().data?.map( ( item ) => item.id ) ).toEqual( [ 1 ] );
		expect( root.querySelector( '.os-posts-desk__excerpt' )?.textContent ).toBe( 'A & B story' );
		expect( root.querySelector( '.os-posts-desk__excerpt strong' ) ).toBeNull();
		expect( root.querySelector( 'style' )?.textContent ).toContain( '.os-posts-desk__workspace' );
	} );

	it( 'shares selection and bulk actions across the desk and details table', async () => {
		const { root, table } = mount();
		await flush();
		const box = root.querySelector( '[data-story-id="2"] os-checkbox' )!;
		expect( box.shadowRoot?.querySelector( 'input' )?.getAttribute( 'aria-label' ) ).toBe( 'Select Row 2' );
		box.dispatchEvent( new CustomEvent( 'os-checkbox-change', { detail: { checked: true } } ) );
		expect( Array.from( table().selection ?? [] ) ).toEqual( [ 2 ] );
		expect( root.querySelector( '[data-os-posts-bulk]' )?.hasAttribute( 'hidden' ) ).toBe( false );
		root.querySelector( '[data-os-posts-view]' )!.dispatchEvent( new CustomEvent( 'os-pick', { detail: { value: 'table' } } ) );
		expect( root.querySelector( '[data-os-posts-body]' )?.hasAttribute( 'hidden' ) ).toBe( false );
		expect( root.querySelector( '.os-posts-desk__workspace' )?.hasAttribute( 'hidden' ) ).toBe( true );
		expect( Array.from( table().selection ?? [] ) ).toEqual( [ 2 ] );
	} );

	it( 'shows the chosen story and returns focus after closing details', async () => {
		const { root, ctx } = mount();
		( root.querySelector( '[data-inspect-id="2"]' ) as HTMLElement ).click();
		await flush();
		expect( root.querySelector( '.os-posts-desk__inspector h2' )?.textContent ).toBe( 'Row 2' );
		expect( root.querySelector( '.os-posts-desk__inspector.is-open' ) ).not.toBeNull();
		expect( root.ownerDocument.activeElement ).toBe( root.querySelector( '[data-os-posts-inspect-close]' ) );
		( root.querySelector( '.os-posts-desk__inspector-actions os-button' ) as HTMLElement ).click();
		expect( ctx.host.openUrl ).toHaveBeenCalledWith( 'http://x.test/wp-admin/post.php?post=2&action=edit', 'Row 2', 'dashicons-admin-post' );
		( root.querySelector( '[data-os-posts-inspect-close]' ) as HTMLElement ).click();
		await flush();
		expect( root.querySelector( '.os-posts-desk__inspector.is-open' ) ).toBeNull();
		expect( root.ownerDocument.activeElement ).toBe( root.querySelector( '[data-inspect-id="2"]' ) );
	} );

	it( 'drops hidden selections when the server query changes and keeps details current', async () => {
		const { root, ctx, table } = mount();
		root.querySelector( '[data-story-id="2"] os-checkbox' )!.dispatchEvent( new CustomEvent( 'os-checkbox-change', { detail: { checked: true } } ) );
		ctx.state.search = 'Row 1';
		( ctx as { data: ListData } ).data = data( [ row( 1 ) ] );
		ctx.repaint();
		await flush();
		expect( Array.from( table().selection ?? [] ) ).toEqual( [] );
		expect( root.querySelectorAll( '[data-story-id]' ) ).toHaveLength( 1 );
		expect( root.querySelector( '[data-os-posts-bulk]' )?.hasAttribute( 'hidden' ) ).toBe( true );
	} );

	it( 'sorts through the existing server action', () => {
		const { root, dispatch } = mount();
		root.querySelector( '.os-posts-desk__tools os-select' )!.dispatchEvent( new CustomEvent( 'os-pick', { detail: { value: 'modified:desc' } } ) );
		expect( dispatch ).toHaveBeenCalledWith( 'sort', { orderby: 'modified', order: 'desc' } );
	} );

	it( 'renders extension fields into a separate inspector node', () => {
		window.wp!.hooks!.applyFilters = ( name: string, value: unknown ) => name === 'openstation.postsWindow.columns' ? [ ...( value as unknown[] ), {
			key: 'review', label: 'Editorial review', render: () => {
				const el = document.createElement( 'span' ); el.textContent = 'Ready'; return el;
			},
		} ] : value;
		const { root, ctx } = mount();
		expect( root.querySelector( '[data-detail-field="review"]' ) ).toBeNull();
		( root.querySelector( '[data-inspect-id]' ) as HTMLElement ).click();
		const field = root.querySelector( '[data-detail-field="review"]' );
		expect( field?.textContent ).toContain( 'Ready' );
		ctx.repaint();
		expect( root.querySelector( '[data-detail-field="review"]' ) ).toBe( field );
		expect( field?.textContent ).toContain( 'Ready' );
	} );
} );
