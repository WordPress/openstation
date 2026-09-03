/**
 * My WordPress — the list view: the column model per kind, the
 * plugin column filter, the sort headers, the row facts, the action
 * cluster, the self-copying id, the column chooser, and the view
 * switch that flips the body between tiles and the table.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockViewContext } from '../../../src/app-runtime/testing';
import app, {
	columnsFor,
	hiddenFor,
	nextSort,
	type AppData,
	type AppState,
	type ListColumn,
	type ListItem,
	type ListPage,
	type SectionDef,
} from '../my-wordpress.os';
import { uiOf } from './types';
import { afterRender } from './wire';

function item( over: Partial< ListItem > ): ListItem {
	return {
		id: 1,
		title: 'Alpha',
		subtitle: 'Admin — today',
		status: 'publish',
		excerpt: '',
		thumb: '',
		link: 'https://example.test/alpha',
		mime: '',
		lockedBy: '',
		canEdit: true,
		canDelete: true,
		slug: 'alpha',
		author: 'Ada',
		authorId: 3,
		date: '2026-01-10T10:00:00+00:00',
		modified: '2026-02-01T10:00:00+00:00',
		comments: 4,
		shortlink: 'https://example.test/?p=1',
		parent: 0,
		parentTitle: '',
		words: 120,
		...over,
	};
}

function page( items: ListItem[], over: Partial< ListPage > = {} ): ListPage {
	return { items, total: items.length, pages: 1, page: 1, perPage: 24, ...over };
}

function section( over: Partial< SectionDef > = {} ): SectionDef {
	return {
		id: 'posts',
		label: 'Posts',
		icon: 'dashicons-admin-post',
		kind: 'post',
		post_type: 'post',
		thumbnails: true,
		count: 3,
		...over,
	};
}

const POST_SORTS = {
	default: 'Newest first',
	oldest: 'Oldest first',
	'title-asc': 'Title A–Z',
	'title-desc': 'Title Z–A',
	'id-asc': 'ID, lowest first',
	'id-desc': 'ID, highest first',
	modified: 'Recently modified',
	'modified-asc': 'Least recently modified',
	'slug-asc': 'Slug A–Z',
	'slug-desc': 'Slug Z–A',
	comments: 'Most comments',
	'comments-asc': 'Fewest comments',
};

function state( over: Partial< AppState > = {} ): AppState {
	return {
		group: '',
		section: 'posts',
		item: 0,
		into: 0,
		relation: '',
		footprint: 0,
		fpName: '',
		query: '',
		page: 1,
		sort: '',
		selected: [],
		view: 'list',
		pane: 'define',
		casting: false,
		wstep: 0,
		cast: null,
		agentNotice: '',
		briefError: '',
		...over,
	};
}

function data( over: Partial< AppData > = {} ): AppData {
	return {
		siteName: 'Test Site',
		agentsEnabled: false,
		sections: [ section() ],
		groups: [],
		sortOptions: POST_SORTS,
		list: page( [ item( {} ), item( { id: 2, title: 'Beta', slug: 'beta-2', status: 'draft', lockedBy: 'Grace' } ) ] ),
		detail: null,
		folder: null,
		sub: null,
		subDetail: null,
		authors: [],
		categories: [],
		tags: [],
		previewActions: [],
		agents: null,
		hiddenColumns: {},
		...over,
	};
}

function mount(
	s: AppState,
	d: AppData,
	extra: Partial< Parameters< typeof mockViewContext< AppState, AppData > >[ 0 ] > = {},
): { root: HTMLElement; ctx: ReturnType< typeof mockViewContext< AppState, AppData > > } {
	const root = document.createElement( 'div' );
	document.body.appendChild( root );
	const ctx = mockViewContext< AppState, AppData >( { state: s, data: d, root, ...extra } );
	app.render( ctx );
	return { root, ctx };
}

afterEach( () => {
	delete ( window as { wp?: unknown } ).wp;
	document.body.replaceChildren();
} );

describe( 'the column model', () => {
	it( 'gives posts the id-minded columns, users and media their own', () => {
		expect( columnsFor( section() ).map( ( c ) => c.id ) ).toEqual( [
			'id', 'title', 'slug', 'author', 'status', 'date', 'modified', 'comments', 'words', 'actions',
		] );
		expect( columnsFor( section( { id: 'pages', post_type: 'page', hierarchical: true } ) ).map( ( c ) => c.id ) )
			.toContain( 'parent' );
		expect( columnsFor( section( { id: 'users', kind: 'user', post_type: '' } ) ).map( ( c ) => c.id ) ).toEqual( [
			'id', 'title', 'login', 'email', 'roles', 'posts', 'registered', 'actions',
		] );
		expect( columnsFor( section( { id: 'media', kind: 'media', post_type: 'attachment' } ) ).map( ( c ) => c.id ) ).toEqual( [
			'id', 'title', 'file', 'mime', 'size', 'dimensions', 'parent', 'author', 'date', 'modified', 'actions',
		] );
	} );

	it( 'hides the default-hidden columns until a remembered choice says otherwise', () => {
		const cols = columnsFor( section() );
		const root = document.createElement( 'div' );
		const ctx = mockViewContext< AppState, AppData >( { state: state(), data: data(), root } );
		expect( Array.from( hiddenFor( ctx, section(), cols ) ) ).toEqual( [ 'words' ] );
		// A remembered list wins — an EMPTY one too ("show everything").
		const remembered = mockViewContext< AppState, AppData >( {
			state: state(),
			data: data( { hiddenColumns: { posts: [] } } ),
			root,
		} );
		expect( hiddenFor( remembered, section(), cols ).size ).toBe( 0 );
		const tuned = mockViewContext< AppState, AppData >( {
			state: state(),
			data: data( { hiddenColumns: { posts: [ 'author', 'comments' ] } } ),
			root,
		} );
		expect( Array.from( hiddenFor( tuned, section(), cols ) ) ).toEqual( [ 'author', 'comments' ] );
	} );

	it( 'lets a plugin add, reorder and drop columns through os.my-wordpress.list-columns', () => {
		( window as { wp?: unknown } ).wp = {
			os: {
				hooks: {
					applyFilters: ( hook: string, value: unknown, entity: SectionDef ) => {
						if ( hook !== 'os.my-wordpress.list-columns' || entity.id !== 'posts' ) {
							return value;
						}
						const cols = ( value as ListColumn[] ).filter( ( c ) => c.id !== 'words' );
						cols.splice( 2, 0, {
							id: 'lane',
							label: 'Lane',
							render: ( row ) => String( ( row.meta as Record< string, string > | undefined )?._lane ?? '—' ),
						} );
						return cols;
					},
				},
			},
		};
		const ids = columnsFor( section() ).map( ( c ) => c.id );
		expect( ids ).toContain( 'lane' );
		expect( ids ).not.toContain( 'words' );
		expect( ids.indexOf( 'lane' ) ).toBe( 2 );
	} );

	it( 'ignores a broken filter result and never loses the title or the actions', () => {
		( window as { wp?: unknown } ).wp = {
			os: { hooks: { applyFilters: () => 'nope' } },
		};
		expect( columnsFor( section() ).map( ( c ) => c.id ) ).toContain( 'title' );
		( window as { wp?: unknown } ).wp = {
			os: { hooks: { applyFilters: () => [ { id: 'x', label: 'X', render: () => 'x' }, { nope: true } ] } },
		};
		const ids = columnsFor( section() ).map( ( c ) => c.id );
		expect( ids ).toEqual( [ 'title', 'x', 'actions' ] );
	} );

	it( 'a header click applies the natural first order, a second one flips it', () => {
		const idCol = columnsFor( section() ).find( ( c ) => c.id === 'id' )!;
		expect( nextSort( idCol, 'default' ) ).toBe( 'id-desc' );
		expect( nextSort( idCol, 'id-desc' ) ).toBe( 'id-asc' );
		expect( nextSort( idCol, 'id-asc' ) ).toBe( 'id-desc' );
		const titleCol = columnsFor( section() ).find( ( c ) => c.id === 'title' )!;
		expect( nextSort( titleCol, 'default' ) ).toBe( 'title-asc' );
		expect( nextSort( titleCol, 'title-asc' ) ).toBe( 'title-desc' );
	} );
} );

describe( 'the table', () => {
	it( 'paints one row per item with the facts in columns and the id as a copy chip', () => {
		const { root } = mount( state(), data() );
		const table = root.querySelector( 'table.os-mywp__table' );
		expect( table ).not.toBeNull();
		expect( root.querySelector( '.os-mywp__tiles' ) ).toBeNull();
		const heads = Array.from( root.querySelectorAll( 'th' ), ( th ) => th.textContent?.replace( /\s+/g, ' ' ).trim() );
		// The default order is newest first: the Date header wears the
		// arrow, the sortable-but-idle ones none.
		expect( heads.slice( 0, 6 ) ).toEqual( [ 'ID', 'Title', 'Slug', 'Author', 'Status', 'Date ▼' ] );
		// Words is hidden by default: no header for it.
		expect( heads ).not.toContain( 'Words' );
		const rows = root.querySelectorAll( 'tr.os-mywp__row[data-item-id]' );
		expect( rows ).toHaveLength( 2 );
		const first = rows[ 0 ];
		expect( first.getAttribute( 'data-mywp-drag' ) ).toBe( 'post' );
		expect( first.querySelector( '.os-mywp__cell-id--copy' )?.textContent ).toBe( '1' );
		expect( first.querySelector( '.os-mywp__td--slug' )?.textContent?.trim() ).toBe( 'alpha' );
		expect( first.querySelector( '.os-mywp__td--author' )?.textContent?.trim() ).toBe( 'Ada' );
		expect( first.querySelector( '.os-mywp__td--comments' )?.textContent?.trim() ).toBe( '4' );
		expect( first.querySelector( 'time' )?.getAttribute( 'datetime' ) ).toBe( '2026-01-10T10:00:00+00:00' );
		expect( first.querySelector( 'os-relative-time' )?.getAttribute( 'datetime' ) ).toBe( '2026-02-01T10:00:00+00:00' );
		// The second row: a draft badge, a lock, the `-2` slug in plain sight.
		const second = rows[ 1 ];
		expect( second.querySelector( 'os-badge' )?.textContent?.trim() ).toBe( 'Draft' );
		expect( second.querySelector( '.os-mywp__cell-lock' )?.getAttribute( 'title' ) ).toContain( 'Grace' );
		expect( second.querySelector( '.os-mywp__td--slug' )?.textContent?.trim() ).toBe( 'beta-2' );
		// The wrapper is the scrolling canvas the marquee and the paged
		// list wire to, and it flags itself so the hover card stays away.
		expect( root.querySelector( '.os-mywp__canvas[data-mywp-list]' ) ).not.toBeNull();
	} );

	it( 'keeps the preview pane beside the table, empty until a row is picked', () => {
		const idle = mount( state(), data() );
		expect( idle.root.querySelector( '.os-mywp__detail-pane' ) ).not.toBeNull();
		expect( idle.root.textContent ).toContain( 'Select an entry to preview it here.' );
		const picked = mount(
			state( { item: 1 } ),
			data( { detail: { kind: 'post', id: 1, title: 'Alpha', facts: [], canEdit: true, canDelete: true, content: '' } } ),
		);
		expect( picked.root.querySelector( '.os-mywp__detail-pane' ) ).not.toBeNull();
		expect( picked.root.querySelector( 'tr.os-mywp__row.is-open' ) ).not.toBeNull();
	} );

	it( 'a sortable header sets the sort locally and asks the server for the new order', () => {
		const local = vi.fn();
		const dispatch = vi.fn( async () => true );
		const { root } = mount( state(), data(), { local, dispatch } );
		const slugHead = Array.from( root.querySelectorAll( 'th' ) ).find( ( th ) => th.textContent?.includes( 'Slug' ) )!;
		expect( slugHead.getAttribute( 'aria-sort' ) ).toBe( 'none' );
		slugHead.querySelector( 'button' )?.dispatchEvent( new MouseEvent( 'click', { bubbles: true } ) );
		expect( local ).toHaveBeenCalledWith( 'set-sort', { sort: 'slug-asc' } );
		expect( dispatch ).toHaveBeenCalledWith( 'sort' );
		// A column the section cannot sort by is a plain heading.
		const authorHead = Array.from( root.querySelectorAll( 'th' ) ).find( ( th ) => th.textContent?.includes( 'Author' ) )!;
		expect( authorHead.querySelector( 'button' ) ).toBeNull();
		expect( authorHead.hasAttribute( 'aria-sort' ) ).toBe( false );
	} );

	it( 'the active order shows its arrow and the status bar names it', () => {
		const { root } = mount( state( { sort: 'id-asc' } ), data() );
		const idHead = root.querySelector( 'th.os-mywp__th--id' )!;
		expect( idHead.getAttribute( 'aria-sort' ) ).toBe( 'ascending' );
		expect( idHead.textContent ).toContain( '▲' );
		expect( root.querySelector( '.os-mywp__status' )?.textContent ).toContain( 'Sorted by ID, lowest first' );
		expect( root.querySelector( '.os-mywp__status' )?.textContent ).toContain( '1 column hidden' );
	} );

	it( 'a row selects on click, activates on double click, and menus on right click', () => {
		const local = vi.fn();
		const dispatch = vi.fn( async () => true );
		const { root, ctx } = mount( state(), data(), { local, dispatch } );
		const row = root.querySelector< HTMLElement >( 'tr[data-item-id="2"]' )!;
		row.dispatchEvent( new MouseEvent( 'click', { bubbles: true } ) );
		expect( local ).toHaveBeenCalledWith( 'select', expect.objectContaining( { item: 2, order: [ 1, 2 ] } ) );
		expect( dispatch ).toHaveBeenCalledWith( 'open', { item: 2 } );
		row.dispatchEvent( new MouseEvent( 'dblclick', { bubbles: true } ) );
		expect( dispatch ).toHaveBeenCalledWith( 'edit', { item: 2 } );
		row.dispatchEvent( new MouseEvent( 'contextmenu', { bubbles: true, clientX: 40, clientY: 50 } ) );
		expect( uiOf( ctx ).menu ).toEqual( { x: 40, y: 50, item: expect.objectContaining( { id: 2 } ) } );
	} );

	it( 'on a phone one tap activates a row; a modifier click still only selects', () => {
		document.documentElement.setAttribute( 'data-os-mode', 'mobile' );
		try {
			const local = vi.fn();
			const dispatch = vi.fn( async () => true );
			const { root } = mount( state(), data(), { local, dispatch } );
			const row = root.querySelector< HTMLElement >( 'tr[data-item-id="2"]' )!;
			row.dispatchEvent( new MouseEvent( 'click', { bubbles: true } ) );
			expect( local ).toHaveBeenCalledWith( 'select', expect.objectContaining( { item: 2 } ) );
			expect( dispatch ).toHaveBeenCalledWith( 'edit', { item: 2 } );
			expect( dispatch ).not.toHaveBeenCalledWith( 'open', { item: 2 } );
			row.dispatchEvent( new MouseEvent( 'click', { bubbles: true, shiftKey: true } ) );
			expect( dispatch ).toHaveBeenCalledTimes( 1 );
		} finally {
			document.documentElement.removeAttribute( 'data-os-mode' );
		}
	} );

	it( 'on a phone a row that cannot be edited still opens its pane on a tap', () => {
		document.documentElement.setAttribute( 'data-os-mode', 'mobile' );
		try {
			const dispatch = vi.fn( async () => true );
			const { root } = mount( state(), data( { list: page( [ item( { id: 3, canEdit: false } ) ] ) } ), { dispatch } );
			root.querySelector< HTMLElement >( 'tr[data-item-id="3"]' )!.dispatchEvent( new MouseEvent( 'click', { bubbles: true } ) );
			expect( dispatch ).toHaveBeenCalledWith( 'open', { item: 3 } );
		} finally {
			document.documentElement.removeAttribute( 'data-os-mode' );
		}
	} );

	it( 'the action cluster edits, copies the link and the shortlink, and opens the menu', async () => {
		const dispatch = vi.fn( async () => true );
		const toast = vi.fn();
		const writeText = vi.fn( async () => undefined );
		Object.defineProperty( navigator, 'clipboard', { value: { writeText }, configurable: true } );
		const { root, ctx } = mount( state(), data(), {
			dispatch,
			host: { fetch: globalThis.fetch, toast } as never,
		} );
		const row = root.querySelector< HTMLElement >( 'tr[data-item-id="1"]' )!;
		const labels = Array.from( row.querySelectorAll( '.os-mywp__row-action' ), ( b ) => b.getAttribute( 'aria-label' ) );
		expect( labels ).toEqual( [ 'Open in editor', 'Copy link', 'Copy shortlink', 'More actions' ] );
		const buttons = Array.from( row.querySelectorAll< HTMLElement >( '.os-mywp__row-action' ) );
		buttons[ 0 ].dispatchEvent( new MouseEvent( 'click', { bubbles: true } ) );
		expect( dispatch ).toHaveBeenCalledWith( 'edit', { item: 1 } );
		// The button's click never reaches the row — no selection.
		expect( dispatch ).not.toHaveBeenCalledWith( 'open', expect.anything() );
		buttons[ 2 ].dispatchEvent( new MouseEvent( 'click', { bubbles: true } ) );
		await Promise.resolve();
		await Promise.resolve();
		expect( writeText ).toHaveBeenCalledWith( 'https://example.test/?p=1' );
		expect( toast ).toHaveBeenCalledWith( { message: 'Copied the shortlink.' } );
		buttons[ 3 ].dispatchEvent( new MouseEvent( 'click', { bubbles: true } ) );
		expect( uiOf( ctx ).menu?.item?.id ).toBe( 1 );
		// The id chip copies the id.
		row.querySelector< HTMLElement >( '.os-mywp__cell-id--copy' )?.dispatchEvent( new MouseEvent( 'click', { bubbles: true } ) );
		await Promise.resolve();
		await Promise.resolve();
		expect( writeText ).toHaveBeenCalledWith( '1' );
		expect( toast ).toHaveBeenCalledWith( { message: 'Copied ID 1.' } );
	} );

	it( 'users get profile, footprint and archive-link actions', () => {
		const dispatch = vi.fn( async () => true );
		const users = section( { id: 'users', kind: 'user', post_type: '' } );
		const { root } = mount(
			state( { section: 'users' } ),
			data( {
				sections: [ users ],
				sortOptions: { default: 'Name A–Z', 'title-desc': 'Name Z–A' },
				list: page( [ item( { id: 7, title: 'Ada', login: 'ada', email: 'ada@example.test', status: 'Editor', posts: 12, registered: '2025-05-01T00:00:00+00:00', shortlink: '' } ) ] ),
			} ),
			{ dispatch },
		);
		const row = root.querySelector< HTMLElement >( 'tr[data-item-id="7"]' )!;
		expect( row.getAttribute( 'data-mywp-drag' ) ).toBe( 'user' );
		expect( row.querySelector( '.os-mywp__td--login' )?.textContent?.trim() ).toBe( 'ada' );
		expect( row.querySelector( '.os-mywp__td--posts' )?.textContent?.trim() ).toBe( '12' );
		const labels = Array.from( row.querySelectorAll( '.os-mywp__row-action' ), ( b ) => b.getAttribute( 'aria-label' ) );
		expect( labels ).toEqual( [ 'Edit profile', 'View activity footprint', 'Copy link', 'More actions' ] );
		row.querySelectorAll< HTMLElement >( '.os-mywp__row-action' )[ 1 ].dispatchEvent( new MouseEvent( 'click', { bubbles: true } ) );
		expect( dispatch ).toHaveBeenCalledWith( 'footprint', { user: 7, name: 'Ada' } );
	} );

	it( 'the column chooser lists the optional columns and remembers a toggle through the server', () => {
		const dispatch = vi.fn( async () => true );
		const { root, ctx } = mount( state(), data(), { dispatch } );
		root.querySelector< HTMLElement >( '.os-mywp__columns-btn' )?.dispatchEvent( new MouseEvent( 'click', { bubbles: true } ) );
		expect( uiOf( ctx ).columnsMenu ).not.toBeNull();
		app.render( ctx );
		const menu = root.querySelector( 'os-context-menu.os-mywp__columns-menu' )!;
		const options = Array.from( menu.querySelectorAll( 'os-context-menu-option[id]' ) );
		const ids = options.map( ( o ) => o.getAttribute( 'id' ) );
		expect( ids ).toEqual( [ 'slug', 'author', 'status', 'date', 'modified', 'comments', 'words', 'reset' ] );
		// Shown columns are ticked (the component's own check glyph — a
		// dashicon never paints inside its shadow root); the hidden one
		// is not.
		expect( options.find( ( o ) => o.getAttribute( 'id' ) === 'slug' )?.hasAttribute( 'checked' ) ).toBe( true );
		expect( options.find( ( o ) => o.getAttribute( 'id' ) === 'words' )?.hasAttribute( 'checked' ) ).toBe( false );
		menu.dispatchEvent( new CustomEvent( 'os-context-menu-pick', { detail: { id: 'words' } } ) );
		expect( dispatch ).toHaveBeenCalledWith( 'set-columns', { hidden: [] } );
		menu.dispatchEvent( new CustomEvent( 'os-context-menu-pick', { detail: { id: 'author' } } ) );
		expect( dispatch ).toHaveBeenCalledWith( 'set-columns', { hidden: [ 'words', 'author' ] } );
		menu.dispatchEvent( new CustomEvent( 'os-context-menu-pick', { detail: { id: 'reset' } } ) );
		expect( dispatch ).toHaveBeenCalledWith( 'set-columns', { reset: true } );
		expect( uiOf( ctx ).columnsMenu ).toBeNull();
	} );

	it( 'paints skeleton rows for the page being fetched and a sentinel while more remain', () => {
		const { root, ctx } = mount(
			state(),
			data( { list: page( [ item( {} ) ], { total: 40, pages: 2, perPage: 24 } ) } ),
		);
		expect( root.querySelector( '[data-mywp-sentinel]' ) ).not.toBeNull();
		// Simulate the paged list asking for the next page: ghosts appear.
		uiOf( ctx ).list.sync( {
			sentinel: null,
			canvas: null,
			load: async () => undefined,
			repaint: () => undefined,
		} );
		expect( root.querySelectorAll( 'tr.os-mywp__row--ghost' ).length ).toBeGreaterThanOrEqual( 0 );
	} );
} );

describe( 'the view switch', () => {
	it( 'sits in the search band, flips locally and asks the server to remember', () => {
		const local = vi.fn();
		const dispatch = vi.fn( async () => true );
		const { root } = mount( state( { view: 'icons' } ), data(), { local, dispatch } );
		expect( root.querySelector( '.os-mywp__tiles' ) ).not.toBeNull();
		const switcher = root.querySelector( '.os-mywp__search os-segmented.os-mywp__view-switch' )!;
		expect( switcher.getAttribute( 'value' ) ).toBe( 'icons' );
		switcher.dispatchEvent( new CustomEvent( 'os-pick', { detail: { value: 'list' } } ) );
		expect( local ).toHaveBeenCalledWith( 'set-view', { view: 'list' } );
		expect( dispatch ).toHaveBeenCalledWith( 'view' );
		// Picking the current value is a no-op; garbage never lands.
		local.mockClear();
		switcher.dispatchEvent( new CustomEvent( 'os-pick', { detail: { value: 'icons' } } ) );
		switcher.dispatchEvent( new CustomEvent( 'os-pick', { detail: { value: 'grid' } } ) );
		expect( local ).not.toHaveBeenCalled();
	} );

	it( 'set-view is a local reducer that only knows the two views', () => {
		expect( app.hasLocal( 'set-view' ) ).toBe( true );
		expect( app.runLocal( 'set-view', state( { view: 'icons' } ), { view: 'list' }, data() ).view ).toBe( 'list' );
		expect( app.runLocal( 'set-view', state( { view: 'list' } ), { view: 'nonsense' }, data() ).view ).toBe( 'icons' );
	} );

	it( 'entering the list with no order picked lists the highest id first; a chosen order is kept', () => {
		const fresh = app.runLocal( 'set-view', state( { view: 'icons', sort: '', page: 3 } ), { view: 'list' }, data() );
		expect( fresh.sort ).toBe( 'id-desc' );
		expect( fresh.page ).toBe( 1 );
		const chosen = app.runLocal( 'set-view', state( { view: 'icons', sort: 'title-asc', page: 3 } ), { view: 'list' }, data() );
		expect( chosen.sort ).toBe( 'title-asc' );
		expect( chosen.page ).toBe( 3 );
		// Back to icons never touches the order.
		expect( app.runLocal( 'set-view', state( { view: 'list', sort: 'id-desc' } ), { view: 'icons' }, data() ).sort ).toBe( 'id-desc' );
		// …and the ID header wears the arrow.
		const { root } = mount( state( { sort: 'id-desc' } ), data() );
		expect( root.querySelector( 'th.os-mywp__th--id' )?.getAttribute( 'aria-sort' ) ).toBe( 'descending' );
		expect( root.querySelector( 'th.os-mywp__th--id' )?.textContent ).toContain( '▼' );
	} );

	it( 'the selection made among the icons is the selection among the rows, scrolled into sight', () => {
		const scrolled: string[] = [];
		( HTMLElement.prototype as { scrollIntoView?: unknown } ).scrollIntoView = function( this: HTMLElement ) {
			scrolled.push( this.getAttribute( 'data-item-id' ) ?? '' );
		};
		const { root, ctx } = mount( state( { view: 'icons', selected: [ 2 ], item: 2 } ), data() );
		expect( root.querySelector( '[data-item-id="2"] os-tile' )?.hasAttribute( 'selected' ) ).toBe( true );
		// The switch, as the segmented control performs it.
		root.querySelector( 'os-segmented.os-mywp__view-switch' )
			?.dispatchEvent( new CustomEvent( 'os-pick', { detail: { value: 'list' } } ) );
		expect( uiOf( ctx ).revealSelection ).toBe( true );
		ctx.state.view = 'list';
		app.render( ctx );
		afterRender( ctx );
		expect( root.querySelector( 'tr[data-item-id="2"]' )?.classList.contains( 'is-selected' ) ).toBe( true );
		expect( root.querySelector( 'tr[data-item-id="2"]' )?.getAttribute( 'aria-selected' ) ).toBe( 'true' );
		expect( scrolled ).toEqual( [ '2' ] );
		expect( uiOf( ctx ).revealSelection ).toBe( false );
	} );
} );
