/**
 * Users app — the client view: the tab strip and its capability
 * gates, the toolbar (presence segments, search, Add new), the bulk
 * bar on a desk and as a phone footer, the pager, the columns and the
 * presence slice.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mockViewContext } from '../../src/app-runtime/testing';
import { STATUS_SEGMENTS, applyStatusFilter, buildColumns } from './parts/table';
import type { ProfileConfig, UserListItem, UsersData, UsersState } from './parts/types';
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
		openstation_assignable_roles: [ 'editor', 'author' ],
		...over,
	};
}

const facts: ProfileConfig = {
	currentUserId: 1,
	editPostUrlBase: 'http://localhost/wp-admin/user-edit.php',
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

function mount( state: Partial< UsersState > = {}, data: Partial< UsersData > = {}, extra: Partial< ProfileConfig > = {} ) {
	const root = document.createElement( 'div' );
	document.body.appendChild( root );
	const ctx = mockViewContext< UsersState, UsersData >( {
		state: {
			page: 1,
			perPage: 20,
			search: '',
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
		extra: { ...facts, ...extra } as Record< string, unknown >,
	} );
	ctx.repaint = () => app.render( ctx );
	app.render( ctx );
	return { root, ctx };
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
	it( 'paints the three tabs, and gates Add new on create_users', () => {
		const { root } = mount();
		const tabs = Array.from( root.querySelectorAll( 'os-tab' ) ).map( ( t ) => t.getAttribute( 'value' ) );
		expect( tabs ).toEqual( [ 'all', 'add-new', 'edit' ] );
		expect( root.querySelector( '[data-os-users-add-form]' ) ).not.toBeNull();
		expect( root.querySelector( '[data-os-posts-new]' ) ).not.toBeNull();

		const readOnly = mount( {}, {}, { canCreate: false } );
		const tabs2 = Array.from( readOnly.root.querySelectorAll( 'os-tab' ) ).map( ( t ) => t.getAttribute( 'value' ) );
		expect( tabs2 ).toEqual( [ 'all', 'edit' ] );
		expect( readOnly.root.querySelector( '[data-os-users-add-form]' ) ).toBeNull();
		expect( readOnly.root.querySelector( '[data-os-posts-new]' ) ).toBeNull();
	} );

	it( 'the Profile tab hosts <os-user-profile> pinned to the viewer, and the tab strip binds the state', () => {
		const { root } = mount();
		const profile = root.querySelector( 'os-user-profile[data-os-user-profile-self]' );
		expect( profile?.getAttribute( 'user-id' ) ).toBe( '1' );
		expect( root.querySelector( 'os-tabs' )?.getAttribute( 'os-bind' ) ).toBe( 'tab' );
		expect( root.querySelector( 'os-tabpanel[for="edit"]' )?.hasAttribute( 'hidden' ) ).toBe( true );
		const onEdit = mount( { tab: 'edit' } );
		expect( onEdit.root.querySelector( 'os-tabpanel[for="edit"]' )?.hasAttribute( 'hidden' ) ).toBe( false );
		expect( onEdit.root.querySelector( 'os-tabpanel[for="all"]' )?.hasAttribute( 'hidden' ) ).toBe( true );
	} );

	it( 'the toolbar carries the presence segments bound to filter, and the debounced search', () => {
		const { root } = mount();
		const control = root.querySelector( 'os-segmented' );
		expect( control?.getAttribute( 'os-bind' ) ).toBe( 'status' );
		expect( control?.getAttribute( 'os-action' ) ).toBe( 'filter' );
		expect( Array.from( root.querySelectorAll( 'os-segment' ) ).map( ( s ) => s.textContent ) ).toEqual(
			STATUS_SEGMENTS().map( ( s ) => s.label ),
		);
		const search = root.querySelector( '[data-os-posts-search]' );
		expect( search?.getAttribute( 'os-bind' ) ).toBe( 'search' );
		expect( search?.getAttribute( 'os-action' ) ).toBe( 'filter' );
		expect( root.querySelector( '[data-os-posts-refresh]' )?.getAttribute( 'os-action' ) ).toBe( 'refresh' );
	} );

	it( 'the pager reads the page envelope', () => {
		const { root } = mount( { page: 2 }, { list: { items: [ user() ], total: 45, pages: 3, page: 2, perPage: 20 } } );
		expect( root.querySelector( '.os-app-list__pager-meta' )?.textContent?.trim() ).toBe( 'Page 2 of 3 · 45 users' );
		const buttons = Array.from( root.querySelectorAll( '.os-app-list__pager os-button' ) );
		expect( buttons[ 0 ].getAttribute( 'os-arg-page' ) ).toBe( '1' );
		expect( buttons[ 1 ].getAttribute( 'os-arg-page' ) ).toBe( '3' );
	} );

	it( 'the bulk bar sits in the toolbar on a desk, hidden until a selection, with the role change and Delete', () => {
		const { root, ctx } = mount();
		const bar = root.querySelector( '[data-os-posts-bulk]' );
		expect( bar?.hasAttribute( 'hidden' ) ).toBe( true );
		expect( bar?.classList.contains( 'os-app-list__bulk--footer' ) ).toBe( false );
		expect( bar?.closest( 'header' ) ).not.toBeNull();
		// A selection paints the count, the role pick and the delete.
		ctx.ui( () => ( {} ) );
		const ui = ( ctx.ui as unknown as ( f: () => unknown ) => { selected: number[] } )( () => ( {} ) );
		ui.selected = [ 2, 3 ];
		ctx.repaint();
		expect( bar?.hasAttribute( 'hidden' ) ).toBe( false );
		expect( root.querySelector( '[data-os-posts-count]' )?.textContent ).toBe( '2 selected' );
		expect( root.querySelectorAll( '.os-users__bulk-role option' ).length ).toBe( 3 );
		expect( root.querySelector( 'os-button[variant="danger"]' )?.textContent ).toContain( 'Delete' );
	} );

	it( 'a viewer who can neither promote nor delete gets no bulk actions and no checkboxes', () => {
		const { root } = mount( {}, {}, { canEdit: false, canPromote: false, canDelete: false } );
		expect( root.querySelector( '.os-users__bulk-role' ) ).toBeNull();
		expect( root.querySelector( 'os-button[variant="danger"]' ) ).toBeNull();
		expect( root.querySelector( '[data-os-posts-table]' )?.hasAttribute( 'selectable' ) ).toBe( false );
	} );

	it( 'on a phone the bulk bar is a footer after the body and the status control is a picker', () => {
		document.documentElement.setAttribute( 'data-os-mode', 'mobile' );
		const { root } = mount();
		const bar = root.querySelector( '[data-os-posts-bulk]' );
		expect( bar?.classList.contains( 'os-app-list__bulk--footer' ) ).toBe( true );
		expect( bar?.closest( 'header' ) ).toBeNull();
		expect( bar?.previousElementSibling?.classList.contains( 'os-app-list__body' ) ).toBe( true );
		expect( root.querySelector( 'os-select.os-app-list__status' ) ).not.toBeNull();
		expect( root.querySelector( 'os-segmented' ) ).toBeNull();
	} );

	it( 'a list that could not load says so instead of an empty table', () => {
		const { root } = mount( {}, { list: { items: [], total: 0, pages: 1, page: 1, perPage: 20, error: 'nope' } } );
		expect( root.querySelector( 'os-notice[tone="danger"]' )?.textContent ).toContain( 'Could not load users' );
		expect( root.querySelector( '[data-os-posts-table]' ) ).toBeNull();
	} );

	it( 'the tab local action flips the tab without a request', () => {
		expect( app.hasLocal( 'tab' ) ).toBe( true );
		const next = app.runLocal( 'tab', { tab: 'all' }, { value: 'add-new' }, undefined );
		expect( next.tab ).toBe( 'add-new' );
	} );
} );

describe( 'the table parts', () => {
	it( 'builds the desk columns with Actions for a viewer who can edit, and the phone set otherwise', () => {
		const actions = { onSendReset: () => undefined, onResendWelcome: () => undefined };
		const desk = buildColumns( new Map(), facts, actions, false ).map( ( c ) => c.key );
		expect( desk ).toEqual( [ 'identity', 'email', 'role', 'stats', 'last_login', 'registered', 'actions' ] );
		const readOnly = buildColumns( new Map(), { ...facts, canEdit: false }, actions, false ).map( ( c ) => c.key );
		expect( readOnly ).not.toContain( 'actions' );
		const phone = buildColumns( new Map(), facts, actions, true ).map( ( c ) => c.key );
		expect( phone ).toEqual( [ 'identity', 'email', 'role', 'last_login', 'actions' ] );
	} );

	it( 'renders cells the legacy way: role chips, stats, "Never" for no login, a copy button for the email', () => {
		const cols = buildColumns( new Map(), facts, { onSendReset: () => undefined, onResendWelcome: () => undefined }, false );
		const row = user();
		const cell = ( key: string ): HTMLElement =>
			cols.find( ( c ) => c.key === key )!.render!( undefined, row, 0 ) as HTMLElement;
		expect( cell( 'role' ).textContent ).toBe( 'Editor' );
		expect( cell( 'last_login' ).textContent ).toBe( 'Never' );
		expect( cell( 'stats' ).textContent ).toBe( '312' );
		expect( ( cell( 'email' ) as HTMLButtonElement ).textContent ).toBe( 'ada@example.com' );
		expect( cell( 'identity' ).querySelector( 'os-avatar' )?.getAttribute( 'presence' ) ).toBe( 'offline' );
		expect( cell( 'actions' ).querySelectorAll( 'button' ).length ).toBe( 2 );
		const locked = cols.find( ( c ) => c.key === 'actions' )!.render!(
			undefined,
			user( { openstation_can_edit: false } ),
			0,
		) as HTMLElement;
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
} );
