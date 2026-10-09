/**
 * Users app — capability gates, people tabs, continuous loading,
 * selection and the preserved details table.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OsTable } from '../../src/ui/components/os-table/os-table';
import { mockViewContext } from '../../src/app-runtime/testing';
import { STATUS_SEGMENTS, applyStatusFilter, buildColumns, rowKey } from './parts/table';
import type { ProfileConfig, RowActions, UserListItem, UsersData, UsersState } from './parts/types';
import app from './users.os';

function user( over: Partial< UserListItem > = {} ): UserListItem {
	return {
		id: 2,
		name: 'Ada Lovelace',
		slug: 'ada',
		email: 'ada@example.com',
		roles: [ 'editor' ],
		registered_date: '2026-01-02T03:04:05+00:00',
		avatar_urls: {},
		openstation_user_stats: { posts: 3, pages: 1, comments: 2 },
		openstation_last_login: null,
		openstation_presence: 'offline',
		openstation_can_edit: true,
		...over,
	};
}

const facts: ProfileConfig = {
	currentUserId: 1,
	canEdit: true,
	canPromote: true,
	canCreate: true,
	canDelete: true,
	isMultisite: false,
	assignableRoles: { administrator: 'Administrator', editor: 'Editor' },
	allRoles: { administrator: 'Administrator', editor: 'Editor', subscriber: 'Subscriber' },
	locales: { '': 'Site default — en_US', en_US: 'en_US' },
	defaultRole: 'subscriber',
	contactMethods: {},
	colorSchemes: {},
};

/** The declaration's tab list, as the PHP side builds it. */
const usersTabs = ( cfg: ProfileConfig ) => [
	{ id: 'all', label: 'People' },
	{ id: 'roles', label: 'Roles' },
	{ id: 'activity', label: 'Activity' },
	...( cfg.canCreate === false ? [] : [ { id: 'add-new', label: 'Add new' } ] ),
	{ id: 'edit', label: 'Profile' },
];

const actions: RowActions = { onSendReset: () => undefined, onResendWelcome: () => undefined, toast: () => undefined };

function mount( state: Partial< UsersState > = {}, data: Partial< UsersData > = {}, extra: Partial< ProfileConfig > = {}, loading = false ) {
	const root = document.createElement( 'div' );
	document.body.appendChild( root );
	const ctx = mockViewContext< UsersState, UsersData >( {
		loading,
		state: {
			page: 1,
			perPage: 20,
			search: '',
			role: '',
			status: '',
			orderby: 'name',
			order: 'asc',
			tab: 'all',
			createError: '',
			createField: '',
			created: 0,
			...state,
		},
		data: { list: { items: [ user() ], total: 1, pages: 1, page: 1, perPage: 20 }, ...data },
		root,
		// `menuTabs` is what `App::menu()` ships in the config extra and
		// what the strip renders from, caps already applied — see
		// `apps/users/users.os.php`.
		extra: { menuTabs: usersTabs( { ...facts, ...extra } ), ...facts, ...extra } as Record< string, unknown >,
	} );
	ctx.repaint = () => app.render( ctx );
	ctx.dispatch = vi.fn( async () => true );
	app.render( ctx );
	return { root, ctx, table: root.querySelector< OsTable< UserListItem > >( 'os-table' ) };
}

beforeEach( () => {
	( window as unknown as { wp?: unknown } ).wp = { os: {} };
} );

afterEach( () => {
	document.body.replaceChildren();
	document.documentElement.removeAttribute( 'data-os-mode' );
	delete ( window as unknown as { wp?: unknown } ).wp;
} );

describe( 'the users app view', () => {
	it( 'registers its preserved table and renders rows without opening another app first', async () => {
		const { table } = mount();
		expect( customElements.get( 'os-table' ) ).toBeDefined();
		await Promise.resolve();
		expect( table?.shadowRoot?.textContent ).toContain( 'Ada Lovelace' );
	} );

	it( 'declares a placeholder: the frame paints before mount with the table in its skeleton and no page summary', () => {
		const placeholder = app.placeholder!( { page: 1, perPage: 20 } ) as UsersData;
		expect( placeholder ).toEqual( { list: { items: [], total: 0, pages: 0, page: 1, perPage: 20 } } );

		const { root, table } = mount( {}, placeholder, {}, true );
		expect( root.querySelector( '[data-os-users-toolbar] os-segmented' ) ).not.toBeNull();
		expect( table?.hasAttribute( 'loading' ) ).toBe( true );
		expect( root.textContent ).not.toContain( 'Page 1 of' );

		const settled = mount();
		expect( settled.table?.hasAttribute( 'loading' ) ).toBe( false );
		expect( settled.root.textContent ).toContain( '1 of 1 people loaded' );
	} );

	it( 'paints the people, insights and account tabs, and gates Add new on create_users', () => {
		const { root } = mount();
		const tabs = Array.from( root.querySelectorAll( 'os-tab' ) ).map( ( t ) => t.getAttribute( 'value' ) );
		expect( tabs ).toEqual( [ 'all', 'roles', 'activity', 'add-new', 'edit' ] );
		expect( root.querySelector( '[data-os-users-add-form]' ) ).not.toBeNull();
		expect( root.querySelector( '[data-os-users-new]' ) ).not.toBeNull();

		const readOnly = mount( {}, {}, { canCreate: false } );
		const tabs2 = Array.from( readOnly.root.querySelectorAll( 'os-tab' ) ).map( ( t ) => t.getAttribute( 'value' ) );
		expect( tabs2 ).toEqual( [ 'all', 'roles', 'activity', 'edit' ] );
		expect( readOnly.root.querySelector( '[data-os-users-add-form]' ) ).toBeNull();
	} );

	it( 'card selection uses the shared controller without changing card structure', () => {
		const { root, table } = mount();
		const card = root.querySelector( '[data-person-id="2"]' )!;
		const checkbox = card.querySelector( 'os-checkbox' )!;
		const structure = card.querySelectorAll( '*' ).length;
		checkbox.dispatchEvent( new CustomEvent( 'os-checkbox-change', { detail: { checked: true } } ) );
		expect( Array.from( table!.selection, String ) ).toEqual( [ '2' ] );
		expect( card.querySelectorAll( '*' ).length ).toBe( structure );
		expect( card.classList.contains( 'is-selected' ) ).toBe( true );
		expect( root.querySelector( '[data-os-users-bulk]' )?.hasAttribute( 'hidden' ) ).toBe( false );
		checkbox.dispatchEvent( new CustomEvent( 'os-checkbox-change', { detail: { checked: false } } ) );
		expect( Array.from( table!.selection ) ).toEqual( [] );
	} );

	it( 'the role filter is server state bound to filter, spelled as users.php spells it', () => {
		const { root, ctx } = mount( { role: 'editor' } );
		const select = root.querySelector( '[data-os-users-role]' );
		expect( select?.getAttribute( 'os-bind' ) ).toBe( 'role' );
		expect( select?.getAttribute( 'os-action' ) ).toBe( 'filter' );
		expect( ( select as { value?: string } | null )?.value ).toBe( 'editor' );
		expect( Array.from( root.querySelectorAll( '[data-os-users-role] os-option' ) ).map( ( o ) => o.getAttribute( 'value' ) ?? '' ) ).toEqual( [ '', 'none', 'administrator', 'editor', 'subscriber' ] );
		expect( root.querySelector( '.os-people__scope' )?.textContent ).toContain( 'match filters' );
		( root.querySelector( '[data-os-users-clear-role]' ) as HTMLElement ).click();
		expect( ctx.state.role ).toBe( '' );
		expect( ctx.dispatch ).toHaveBeenCalledWith( 'filter', {} );
	} );

	it( 'a Roles-tab group scopes the directory server-side, spelling No role as none', async () => {
		const snapshot = { total: 1, groups: [ { role: '', label: 'No role', total: 1, members: [ user( { id: 9, roles: [] } ) ] } ] };
		vi.stubGlobal( 'fetch', vi.fn( async () => new Response( JSON.stringify( snapshot ) ) ) );
		try {
			const { root, ctx } = mount( { tab: 'roles' } );
			ctx.local = vi.fn();
			await vi.waitFor( () => expect( root.querySelector( '.os-people__room os-button' ) ).not.toBeNull() );
			( root.querySelector( '.os-people__room os-button' ) as HTMLElement ).click();
			expect( ctx.local ).toHaveBeenCalledWith( 'tab', { value: 'all' } );
			expect( ctx.state.role ).toBe( 'none' );
			expect( ctx.dispatch ).toHaveBeenCalledWith( 'filter', {} );
		} finally {
			vi.unstubAllGlobals();
		}
	} );

	it( 'the root is the Users app’s, not the Posts window’s (no note→post drop target)', () => {
		const { root } = mount();
		expect( root.querySelector( '[data-os-users-root]' ) ).not.toBeNull();
		expect( root.querySelector( '[data-os-posts-root]' ) ).toBeNull();
		expect( root.querySelector( '.desktop-mode-posts' ) ).toBeNull();
		expect( root.querySelector( '[class*="os-posts__"]' ) ).toBeNull();
	} );

	it( 'the Profile tab hosts <os-user-profile> pinned to the viewer only while the tab is open, fed the app’s properties', () => {
		const { root, ctx } = mount();
		const profile = root.querySelector( 'os-user-profile[data-os-user-profile-self]' ) as HTMLElement & {
			config?: unknown;
			fetch?: unknown;
			toast?: unknown;
		};
		expect( profile.hasAttribute( 'user-id' ) ).toBe( false );
		expect( profile.config ).toEqual( ctx.extra );
		expect( profile.fetch ).toBe( ctx.fetch );
		expect( typeof profile.toast ).toBe( 'function' );
		expect( root.querySelector( 'os-tabs' )?.getAttribute( 'os-bind' ) ).toBe( 'tab' );
		expect( root.querySelector( 'os-tabpanel[for="edit"]' )?.hasAttribute( 'hidden' ) ).toBe( true );

		ctx.state.tab = 'edit';
		ctx.repaint();
		expect( profile.getAttribute( 'user-id' ) ).toBe( '1' );
		expect( root.querySelector( 'os-tabpanel[for="edit"]' )?.hasAttribute( 'hidden' ) ).toBe( false );
		expect( root.querySelector( 'os-tabpanel[for="all"]' )?.hasAttribute( 'hidden' ) ).toBe( true );
	} );

	it( 'the toolbar carries the presence segments bound to filter, and the debounced search', () => {
		const { root } = mount();
		const control = root.querySelector( '[data-os-users-toolbar] os-segmented' );
		expect( control?.getAttribute( 'os-bind' ) ).toBe( 'status' );
		expect( control?.getAttribute( 'os-action' ) ).toBe( 'filter' );
		expect( Array.from( root.querySelectorAll( '[data-os-users-toolbar] os-segment' ) ).map( ( s ) => s.textContent ) ).toEqual(
			STATUS_SEGMENTS().map( ( s ) => s.label ),
		);
		const search = root.querySelector( '[data-os-users-search]' );
		expect( search?.getAttribute( 'os-bind' ) ).toBe( 'search' );
		expect( search?.getAttribute( 'os-action' ) ).toBe( 'filter' );
		expect( root.querySelector( '[data-os-users-refresh]' )?.getAttribute( 'os-action' ) ).toBe( 'refresh' );
	} );

	it( 'uses continuous loading with explicit scope for filters', () => {
		const { root } = mount( {}, { list: { items: [ user() ], total: 45, pages: 3, page: 1, perPage: 20 } } );
		expect( root.querySelector( '.os-people__scope' )?.textContent ).toContain( '1 of 45 people loaded' );
		expect( root.querySelector( '.os-app-list__pager' ) ).toBeNull();
		expect( root.querySelector( '[data-users-feed-end]' )?.textContent ).toContain( 'Load more people' );
		const filtered = mount( { status: 'online' }, { list: { items: [ user( { id: 1, openstation_presence: 'online' } ), user() ], total: 45, pages: 3, page: 1, perPage: 20 } } );
		expect( filtered.root.querySelector( '.os-people__scope' )?.textContent ).toContain( '1 match filters' );
	} );

	it( 'the bulk bar sits at the bottom on a desk, hidden until a selection, with the role change, the reassign picker and Delete', () => {
		const { root, table } = mount();
		const bar = root.querySelector( '[data-os-users-bulk]' );
		expect( bar?.hasAttribute( 'hidden' ) ).toBe( true );
		expect( bar?.classList.contains( 'os-app-list__bulk--footer' ) ).toBe( true );
		expect( bar?.closest( 'header' ) ).toBeNull();
		// A selection paints the count, the role pick, who inherits the
		// content (the viewer by default), and Delete.
		table!.selection = [ '2', '3' ];
		table!.dispatchEvent( new CustomEvent( 'os-table-selection-change' ) );
		expect( bar?.hasAttribute( 'hidden' ) ).toBe( false );
		expect( root.querySelector( '[data-os-users-count]' )?.textContent ).toBe( '2 selected' );
		expect( root.querySelectorAll( '.os-users__bulk-role os-option' ).length ).toBe( 3 );
		expect( root.querySelector( '.os-users__reassign-name' )?.textContent ).toBe( 'you' );
		expect( root.querySelector( 'os-user-search' )?.getAttribute( 'exclude' ) ).toBe( '2,3' );
		expect( root.querySelector( 'os-button[variant="danger"]' )?.textContent ).toContain( 'Delete' );
	} );

	it( 'on multisite there is no reassign picker — a removal keeps the network account', () => {
		const { root, table } = mount( {}, {}, { isMultisite: true } );
		table!.selection = [ '2' ];
		table!.dispatchEvent( new CustomEvent( 'os-table-selection-change' ) );
		expect( root.querySelector( 'os-user-search' ) ).toBeNull();
		expect( root.querySelector( 'os-button[variant="danger"]' )?.textContent ).toContain( 'Remove from site' );
	} );

	it( 'a viewer who can neither promote nor delete gets no bulk actions and no checkboxes', () => {
		const { root } = mount( {}, {}, { canEdit: false, canPromote: false, canDelete: false } );
		expect( root.querySelector( '.os-users__bulk-role' ) ).toBeNull();
		expect( root.querySelector( 'os-button[variant="danger"]' ) ).toBeNull();
		expect( root.querySelector( '[data-os-users-table]' )?.hasAttribute( 'selectable' ) ).toBe( false );
	} );

	it( 'on a phone the bulk bar is a footer after the body, the status control is a picker, and the columns are the phone set', () => {
		document.documentElement.setAttribute( 'data-os-mode', 'mobile' );
		const { root, table } = mount();
		const bar = root.querySelector( '[data-os-users-bulk]' );
		expect( bar?.classList.contains( 'os-app-list__bulk--footer' ) ).toBe( true );
		expect( bar?.closest( 'header' ) ).toBeNull();
		expect( bar?.previousElementSibling?.classList.contains( 'os-app-list__body' ) ).toBe( true );
		expect( root.querySelector( 'os-select.os-app-list__status' ) ).not.toBeNull();
		expect( root.querySelector( '[data-os-users-toolbar] os-segmented' ) ).toBeNull();
		expect( table!.hasAttribute( 'stacked' ) ).toBe( true );
		expect( ( table!.columns as Array< { key: string } > ).map( ( c ) => c.key ) ).toEqual( [ 'identity', 'email', 'role', 'last_login', 'actions' ] );
	} );

	it( 'a list that could not load says so instead of an empty table', () => {
		const { root } = mount( {}, { list: { items: [], total: 0, pages: 1, page: 1, perPage: 20, error: 'nope' } } );
		expect( root.querySelector( 'os-notice[tone="danger"]' )?.textContent ).toContain( 'Could not load users' );
		expect( root.querySelector( '[data-os-users-table]' ) ).not.toBeNull();
	} );

	it( 'the tab local action flips the tab without a request', () => {
		expect( app.hasLocal( 'tab' ) ).toBe( true );
		const next = app.runLocal( 'tab', { tab: 'all' }, { value: 'add-new' }, undefined );
		expect( next.tab ).toBe( 'add-new' );
	} );
} );

describe( 'updated() keeps the preserved table in step', () => {
	it( 'assigns the rows once, wires the sort, and dispatches a server sort on a header click', () => {
		const { table, ctx } = mount();
		expect( table!.data.map( ( r ) => r.id ) ).toEqual( [ 2 ] );
		expect( table!.sort ).toEqual( { key: 'identity', direction: 'asc' } );
		const before = table!.data;
		ctx.repaint();
		expect( table!.data ).toBe( before );

		table!.dispatchEvent( new CustomEvent( 'os-table-sort-change', { detail: { sort: { key: 'registered', direction: 'desc' } } } ) );
		expect( ctx.dispatch ).toHaveBeenCalledWith( 'sort', { orderby: 'registered_date', order: 'desc' } );
		table!.dispatchEvent( new CustomEvent( 'os-table-sort-change', { detail: { sort: null } } ) );
		expect( ctx.dispatch ).toHaveBeenLastCalledWith( 'sort', { orderby: 'name', order: 'asc' } );
	} );

	it( 'a query change clears the selection; a row leaving the page prunes it', async () => {
		const { table, ctx } = mount( {}, { list: { items: [ user( { id: 2 } ), user( { id: 3 } ) ], total: 2, pages: 1, page: 1, perPage: 20 } } );
		table!.selection = [ '2', '3' ];
		table!.dispatchEvent( new CustomEvent( 'os-table-selection-change' ) );

		Object.assign( ctx, { data: { list: { items: [ user( { id: 2 } ) ], total: 1, pages: 1, page: 1, perPage: 20 } } } );
		ctx.repaint();
		await Promise.resolve();
		expect( Array.from( table!.selection, String ) ).toEqual( [ '2' ] );

		ctx.state.search = 'ada';
		ctx.repaint();
		expect( table!.selection.size ).toBe( 0 );
	} );

	it( 'only a changed row rebuilds its cells', () => {
		const { table, ctx } = mount( {}, { list: { items: [ user( { id: 2 } ), user( { id: 3, name: 'Bob' } ) ], total: 2, pages: 1, page: 1, perPage: 20 } } );
		const cols = table!.columns as Array< { key: string; render: ( v: unknown, row: UserListItem, i: number ) => Node } >;
		const identity = cols.find( ( c ) => c.key === 'identity' )!;
		const adaCell = identity.render( undefined, table!.data[ 0 ], 0 );
		const bobCell = identity.render( undefined, table!.data[ 1 ], 1 );

		Object.assign( ctx, { data: { list: { items: [ user( { id: 2 } ), user( { id: 3, name: 'Robert' } ) ], total: 2, pages: 1, page: 1, perPage: 20 } } } );
		ctx.repaint();
		expect( identity.render( undefined, table!.data[ 0 ], 0 ) ).toBe( adaCell );
		expect( identity.render( undefined, table!.data[ 1 ], 1 ) ).not.toBe( bobCell );
	} );
} );

describe( 'the table parts', () => {
	it( 'builds the desk columns with Actions for a viewer who can edit, and the phone set otherwise', () => {
		const desk = buildColumns( new Map(), facts, actions, false ).map( ( c ) => c.key );
		expect( desk ).toEqual( [ 'identity', 'email', 'role', 'stats', 'last_login', 'registered', 'actions' ] );
		const readOnly = buildColumns( new Map(), { ...facts, canEdit: false }, actions, false ).map( ( c ) => c.key );
		expect( readOnly ).not.toContain( 'actions' );
		const phone = buildColumns( new Map(), facts, actions, true ).map( ( c ) => c.key );
		expect( phone ).toEqual( [ 'identity', 'email', 'role', 'last_login', 'actions' ] );
	} );

	it( 'renders cells the legacy way: labelled role chips, stats, "Never" for no login, a ticking time, a copy button for the email', () => {
		const cols = buildColumns( new Map(), facts, actions, false );
		const row = user();
		const cell = ( key: string ): HTMLElement => cols.find( ( c ) => c.key === key )!.render!( undefined, row, 0 ) as HTMLElement;
		expect( cell( 'role' ).textContent ).toBe( 'Editor' );
		expect( cell( 'last_login' ).textContent ).toBe( 'Never' );
		expect( cell( 'registered' ).querySelector( 'os-relative-time' )?.getAttribute( 'datetime' ) ).toBe( '2026-01-02T03:04:05.000Z' );
		expect( cell( 'stats' ).textContent ).toBe( '312' );
		expect( ( cell( 'email' ) as HTMLButtonElement ).textContent ).toBe( 'ada@example.com' );
		expect( cell( 'identity' ).querySelector( 'os-avatar' )?.getAttribute( 'presence' ) ).toBe( 'offline' );
		const buttons = cell( 'actions' ).querySelectorAll( 'button' );
		expect( buttons.length ).toBe( 2 );
		// The face resolves through the palette, never an inherited
		// colour on a white fallback — that painted white glyphs on a
		// white chip under the dark palette.
		for ( const btn of Array.from( buttons ) ) {
			expect( btn.hasAttribute( 'data-noclick' ) ).toBe( true );
			expect( btn.style.background ).toContain( '--os-ui-surface' );
			expect( btn.style.color ).toContain( '--os-ui-fg-muted' );
			expect( btn.style.color ).not.toBe( 'inherit' );
			expect( btn.querySelector( 'os-icon' ) ).not.toBeNull();
		}
		const locked = cols.find( ( c ) => c.key === 'actions' )!.render!( undefined, user( { id: 5, openstation_can_edit: false } ), 0 ) as HTMLElement;
		expect( locked.textContent ).toBe( '—' );
	} );

	it( 'slices the page by presence the way the legacy view did', () => {
		const now = Math.floor( Date.now() / 1000 );
		const rows = [
			user( { id: 1, openstation_presence: 'online', openstation_last_login: now - 10 } ),
			user( { id: 2, openstation_last_login: now - 86400 * 5 } ),
			user( { id: 3, openstation_last_login: now - 86400 * 60 } ),
			user( { id: 4, openstation_last_login: null } ),
		];
		expect( applyStatusFilter( rows, '' ).map( ( r ) => r.id ) ).toEqual( [ 1, 2, 3, 4 ] );
		expect( applyStatusFilter( rows, 'online' ).map( ( r ) => r.id ) ).toEqual( [ 1 ] );
		expect( applyStatusFilter( rows, 'recent' ).map( ( r ) => r.id ) ).toEqual( [ 1, 2 ] );
		expect( applyStatusFilter( rows, 'never' ).map( ( r ) => r.id ) ).toEqual( [ 4 ] );
	} );

	it( 'the row key reads what a row paints', () => {
		expect( rowKey( user() ) ).toBe( rowKey( user() ) );
		expect( rowKey( user( { roles: [ 'author' ] } ) ) ).not.toBe( rowKey( user() ) );
		expect( rowKey( user( { openstation_user_stats: { posts: 4, pages: 1, comments: 2 } } ) ) ).not.toBe( rowKey( user() ) );
	} );
} );

it( 'shows automatic gathering instead of partial Activity totals or a Load more control', () => {
	const { root } = mount( { tab: 'activity' }, { list: { items: [ user() ], total: 138, pages: 7, page: 1, perPage: 20 } } );
	const panel = root.querySelector( 'os-tabpanel[for="activity"]' )!;
	expect( panel.textContent ).toContain( 'Bringing everyone together' );
	expect( panel.textContent ).not.toContain( 'people gathered' );
	expect( panel.textContent ).not.toContain( 'Load more' );
	expect( panel.querySelector( '.os-community__metrics' ) ).toBeNull();
	expect( panel.querySelector( '.os-community__spotlight' ) ).toBeNull();
} );
