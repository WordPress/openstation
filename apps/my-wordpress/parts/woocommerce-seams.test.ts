/**
 * The shared plugin seams the WooCommerce integration rides — fired
 * by the app exactly as WP Explorer fires them, so ONE subscriber
 * decorates both windows: `group-extras` over an open plugin folder,
 * `user-activate` on a person's double-click, the
 * `user-preview-actions` row, the `user-dossier-sections` fact
 * filter, and the flat-section rules that keep post mutations off
 * rows that are not posts (Woo's Orders).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockViewContext } from '../../../src/app-runtime/testing';
import app, {
	buildMenuOptions,
	type AppData,
	type AppState,
	type ListItem,
	type SectionDef,
} from '../my-wordpress.os';

type Cb = ( ...cbArgs: unknown[] ) => unknown;

const filters = new Map< string, Cb[] >();
const actions = new Map< string, Cb[] >();

function installHooks(): void {
	filters.clear();
	actions.clear();
	( window as unknown as { wp?: { os?: Record< string, unknown > } } ).wp = {
		os: {
			hooks: {
				applyFilters: ( hook: string, value: unknown, ...rest: unknown[] ) =>
					( filters.get( hook ) ?? [] ).reduce( ( acc, cb ) => cb( acc, ...rest ), value ),
				doAction: ( hook: string, ...rest: unknown[] ) =>
					( actions.get( hook ) ?? [] ).forEach( ( cb ) => cb( ...rest ) ),
				addAction: () => undefined,
				removeAction: () => undefined,
			},
		},
	};
}

function onFilter( hook: string, cb: Cb ): void {
	filters.set( hook, [ ...( filters.get( hook ) ?? [] ), cb ] );
}

function onAction( hook: string, cb: Cb ): void {
	actions.set( hook, [ ...( actions.get( hook ) ?? [] ), cb ] );
}

function item( over: Partial< ListItem > = {} ): ListItem {
	return {
		id: 8,
		title: 'Jordan',
		name: 'Jordan',
		subtitle: 'jordan@example.test',
		status: 'Customer',
		excerpt: '',
		thumb: '',
		link: 'https://example.test/author/jordan',
		mime: '',
		lockedBy: '',
		canEdit: true,
		canDelete: false,
		openstation_woo_customer: { band: 'vip', orders: 3, ordersUrl: 'https://example.test/orders' },
		...over,
	};
}

function section( over: Partial< SectionDef > = {} ): SectionDef {
	return {
		id: 'wc-customers',
		label: 'Customers',
		icon: 'dashicons-groups',
		kind: 'user',
		post_type: '',
		thumbnails: true,
		count: 1,
		group: 'plugin:woocommerce',
		...over,
	};
}

function state( over: Partial< AppState > = {} ): AppState {
	return {
		group: '',
		section: '',
		item: 0,
		into: 0,
		relation: '',
		footprint: 0,
		fpName: '',
		query: '',
		page: 1,
		sort: '',
		selected: [],
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
		siteName: 'Shop',
		agentsEnabled: false,
		sections: [ section() ],
		groups: [ { id: 'plugin:woocommerce', label: 'Woo', icon: 'dashicons-cart', order: 15 } ],
		sortOptions: { default: 'Top spenders first' },
		list: null,
		detail: null,
		folder: null,
		sub: null,
		subDetail: null,
		authors: [],
		categories: [],
		tags: [],
		previewActions: [],
		agents: null,
		...over,
	};
}

type Ctx = ReturnType< typeof mockViewContext< AppState, AppData > >;

function mount(
	s: AppState,
	d: AppData,
	dispatch: Ctx[ 'dispatch' ] = async () => true,
): Ctx {
	const root = document.createElement( 'div' );
	document.body.appendChild( root );
	const ctx = mockViewContext< AppState, AppData >( { state: s, data: d, root, dispatch } );
	app.render( ctx );
	return ctx;
}

beforeEach( () => {
	installHooks();
} );

afterEach( () => {
	document.body.replaceChildren();
	delete ( window as unknown as { wp?: unknown } ).wp;
} );

describe( 'group-extras', () => {
	it( 'fires once over an open plugin folder, with the folder and its member sections', () => {
		const seen: unknown[] = [];
		onAction( 'os.my-wordpress.group-extras', ( payload ) => {
			seen.push( payload );
			( payload as { container: HTMLElement } ).container.textContent = 'Store totals';
		} );

		// `app.render()` runs the after-render pass, seams included.
		const ctx = mount( state( { group: 'plugin:woocommerce' } ), data() );

		expect( seen ).toHaveLength( 1 );
		const payload = seen[ 0 ] as {
			container: HTMLElement;
			groupId: string;
			group: { label: string } | null;
			entityIds: string[];
		};
		expect( payload.groupId ).toBe( 'plugin:woocommerce' );
		expect( payload.group?.label ).toBe( 'Woo' );
		expect( payload.entityIds ).toEqual( [ 'wc-customers' ] );
		expect( payload.container.isConnected ).toBe( true );
		expect( ctx.root.textContent ).toContain( 'Store totals' );

		// Repaints must not re-fire (the panel would flicker and
		// duplicate its request) — the stamp keeps one firing per
		// folder.
		app.render( ctx );
		expect( seen ).toHaveLength( 1 );
	} );

	it( 'contains a throwing subscriber', () => {
		onAction( 'os.my-wordpress.group-extras', () => {
			throw new Error( 'plugin bug' );
		} );
		const spy = vi.spyOn( console, 'error' ).mockImplementation( () => undefined );

		expect( () => mount( state( { group: 'plugin:woocommerce' } ), data() ) ).not.toThrow();
		expect( spy ).toHaveBeenCalled();
		spy.mockRestore();
	} );
} );

describe( 'user-activate', () => {
	function mountList( dispatch: Ctx[ 'dispatch' ] ): Ctx {
		return mount(
			state( { section: 'wc-customers' } ),
			data( { list: { items: [ item() ], total: 1, pages: 1, page: 1, perPage: 24 } } ),
			dispatch,
		);
	}

	it( 'lets a subscriber claim the double-click on a person', () => {
		const opened: unknown[] = [];
		onFilter( 'os.my-wordpress.user-activate', ( _handled, payloadCtx ) => {
			opened.push( payloadCtx );
			return true;
		} );
		const dispatch = vi.fn( async () => true );

		const ctx = mountList( dispatch );
		ctx.root
			.querySelector( '[data-item-id="8"]' )!
			.dispatchEvent( new MouseEvent( 'dblclick', { bubbles: true } ) );

		expect( opened ).toHaveLength( 1 );
		const payloadCtx = opened[ 0 ] as { entityId: string; item: { name?: string } };
		expect( payloadCtx.entityId ).toBe( 'wc-customers' );
		expect( payloadCtx.item.name ).toBe( 'Jordan' );
		expect( dispatch ).not.toHaveBeenCalledWith( 'edit', { item: 8 } );
	} );

	it( 'falls through to the activity footprint when nobody claims it — never the profile editor', () => {
		const dispatch = vi.fn( async () => true );
		const ctx = mountList( dispatch );
		ctx.root
			.querySelector( '[data-item-id="8"]' )!
			.dispatchEvent( new MouseEvent( 'dblclick', { bubbles: true } ) );
		expect( dispatch ).toHaveBeenCalledWith( 'footprint', { user: 8, name: 'Jordan' } );
		expect( dispatch ).not.toHaveBeenCalledWith( 'edit', { item: 8 } );
	} );
} );

describe( 'user preview pane', () => {
	function userDetailData(): AppData {
		return data( {
			list: { items: [ item() ], total: 1, pages: 1, page: 1, perPage: 24 },
			detail: {
				kind: 'user',
				id: 8,
				title: 'Jordan',
				facts: [
					[ 'Email', 'jordan@example.test', 'bio' ],
					[ 'Posts', '0', 'stats' ],
					[ 'Comments', '0', 'stats' ],
				],
				canEdit: true,
				canDelete: false,
			},
		} );
	}

	it( 'runs the action row through user-preview-actions, item facts included', () => {
		let seen: Record< string, unknown > | null = null;
		onFilter( 'os.my-wordpress.user-preview-actions', ( base, payloadCtx ) => {
			seen = payloadCtx as Record< string, unknown >;
			const kept = ( base as Array< { id: string } > ).filter( ( a ) => a.id !== 'footprint' );
			return [
				{ id: 'wc-orders', label: 'View their orders', variant: 'primary', onSelect: () => undefined },
				...kept,
			];
		} );

		const ctx = mount( state( { section: 'wc-customers', item: 8 } ), userDetailData() );
		const labels = Array.from( ctx.root.querySelectorAll( '.os-mywp__actions os-button' ) ).map(
			( b ) => b.textContent?.trim(),
		);

		expect( labels ).toContain( 'View their orders' );
		expect( labels ).toContain( 'Edit profile' );
		expect( labels ).not.toContain( 'View activity footprint' );
		const seenCtx = seen as unknown as { entityId: string; item: Record< string, unknown > };
		expect( seenCtx.entityId ).toBe( 'wc-customers' );
		// The item the subscriber reads carries the row's facts under
		// the dossier's fields — where `ordersUrl` lives.
		expect( seenCtx.item.openstation_woo_customer ).toMatchObject( { band: 'vip' } );
	} );

	it( 'renders the built-in row when nobody filters', () => {
		const ctx = mount( state( { section: 'wc-customers', item: 8 } ), userDetailData() );
		const labels = Array.from( ctx.root.querySelectorAll( '.os-mywp__actions os-button' ) ).map(
			( b ) => b.textContent?.trim(),
		);
		expect( labels ).toContain( 'View activity footprint' );
		expect( labels ).toContain( 'Edit profile' );
	} );

	it( 'Edit profile opens the shared profile window, not a raw user-edit.php dispatch', () => {
		const dispatch = vi.fn( async () => true );
		const opened: string[] = [];
		( ( window as unknown as { wp: { os: Record< string, unknown > } } ).wp.os ).openWindow = (
			id: string,
		) => {
			opened.push( id );
			return true;
		};
		const ctx = mount( state( { section: 'wc-customers', item: 8 } ), userDetailData(), dispatch );
		const button = Array.from(
			ctx.root.querySelectorAll< HTMLElement >( '.os-mywp__actions os-button' ),
		).find( ( b ) => b.textContent?.trim() === 'Edit profile' );
		button!.dispatchEvent( new MouseEvent( 'click', { bubbles: true } ) );

		expect( opened ).toContain( 'desktop-mode-user-edit' );
		expect( dispatch ).not.toHaveBeenCalledWith( 'edit', { item: 8 } );
	} );

	it( 'drops the fact blocks a user-dossier-sections subscriber removed', () => {
		onFilter( 'os.my-wordpress.user-dossier-sections', () => [ 'bio' ] );

		const ctx = mount( state( { section: 'wc-customers', item: 8 } ), userDetailData() );

		expect( ctx.root.textContent ).toContain( 'Email' );
		expect( ctx.root.textContent ).not.toContain( 'Posts' );
		expect( ctx.root.textContent ).not.toContain( 'Comments' );
	} );

	it( 'renders the deep dossier blocks from stats — and the same filter gates them', () => {
		const withStats = (): AppData => {
			const d = userDetailData();
			d.detail!.stats = {
				profile: { registered: '2026-06-02T00:00:00', roleLabels: [ 'Author' ], link: 'https://example.test/author/jordan' },
				counts: {
					posts: { total: 104, publish: 103 },
					pages: { total: 2, publish: 2 },
					commentsReceived: 7,
					commentsLeft: 3,
				},
				activity: [ { ym: '2026-05', count: 4 } ],
				milestones: { firstPublished: '2025-06-01T00:00:00', lastPublished: '2026-05-01T00:00:00' },
				recent: [ { id: 3, title: 'Hello', date: '2026-05-01T00:00:00', status: 'publish' } ],
				topTerms: [ { id: 9, name: 'News', count: 12 } ],
			};
			return d;
		};

		const ctx = mount( state( { section: 'wc-customers', item: 8 } ), withStats() );
		const text = ctx.root.textContent ?? '';
		expect( text ).toContain( '104' );
		expect( text ).toContain( '103 published' );
		expect( text ).toContain( 'Comments received' );
		expect( text ).toContain( 'Comments left' );
		expect( text ).toContain( 'Activity (last 12 months)' );
		expect( text ).toContain( 'Member since' );
		expect( text ).toContain( 'First published' );
		expect( text ).toContain( 'Recent posts' );
		expect( text ).toContain( 'Top categories & tags' );
		expect( text ).toContain( 'News · 12' );
		expect( text ).toContain( 'AUTHOR' );
		expect( text ).toContain( 'Author archive' );

		// The Woo customer pane: same data, dossier stripped to bio —
		// identity stays, every publishing block goes.
		onFilter( 'os.my-wordpress.user-dossier-sections', () => [ 'bio' ] );
		const gated = mount( state( { section: 'wc-customers', item: 8 } ), withStats() );
		const gatedText = gated.root.textContent ?? '';
		expect( gatedText ).toContain( 'Email' );
		expect( gatedText ).toContain( 'AUTHOR' );
		expect( gatedText ).not.toContain( 'Comments received' );
		expect( gatedText ).not.toContain( 'Activity (last 12 months)' );
		expect( gatedText ).not.toContain( 'Recent posts' );
		expect( gatedText ).not.toContain( 'Top categories & tags' );
	} );
} );

describe( 'flat sections', () => {
	const orders = section( {
		id: 'wc-orders',
		label: 'Orders',
		icon: 'dashicons-cart',
		kind: 'post',
		post_type: 'shop_order',
		thumbnails: false,
		flat: true,
	} );

	it( 'keeps quick-edit, publish and trash out of the context menu', () => {
		const ids = buildMenuOptions(
			orders,
			item( { id: 41, title: '#41 · $12.00', status: 'publish', canEdit: true } ),
			[],
		).map( ( o ) => o.id );
		expect( ids ).toEqual( [ 'edit', 'open', 'copy-link' ] );
	} );

	it( 'hides Explore details on the pane — there is no folder behind an order', () => {
		const ctx = mount(
			state( { section: 'wc-orders', item: 41 } ),
			data( {
				sections: [ orders ],
				list: {
					items: [ item( { id: 41, title: '#41 · $12.00', wcStatus: 'processing' } ) ],
					total: 1,
					pages: 1,
					page: 1,
					perPage: 24,
				},
				detail: {
					kind: 'post',
					id: 41,
					title: '#41 · $12.00',
					facts: [ [ 'Placed', 'Jan 5, 2026' ] ],
					canEdit: true,
					canDelete: false,
				},
			} ),
		);
		expect( ctx.root.textContent ).not.toContain( 'Explore details' );
		expect( ctx.root.textContent ).toContain( 'Open in editor' );
	} );
} );
