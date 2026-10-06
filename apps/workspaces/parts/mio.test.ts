/**
 * MIO in the Workspaces window: the scan, the grid, and the two writes.
 *
 * The request these tests hold the actions to is the one the feature
 * was asked for — "the posts list on the left half, Add New Post in the
 * top right, Orders in the last quadrant" — and the rule that anything
 * not on THIS site is refused before it runs.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { NavItem } from '../../../src/nav/types';
import { applyFields, scanApps, toGridSpan, toLaunches, validFields, workspacesMioAbilities } from './mio';
import type { WorkspaceDraft } from './draft';

const ADMIN = 'http://example.test/wp-admin/';

function menu( id: string, title: string, url: string, submenu: Array< { title: string; url: string } > = [] ): NavItem {
	return {
		id,
		kind: 'core',
		title,
		icon: 'dashicons-admin-generic',
		menu: { id, title, icon: '', url: ADMIN + url, badge: 0, submenu, isCore: true },
	} as NavItem;
}

const SITE: NavItem[] = [
	menu( 'menu-posts', 'Posts', 'edit.php', [ { title: 'Add New Post', url: ADMIN + 'post-new.php' } ] ),
	menu( 'woocommerce', 'WooCommerce', 'admin.php?page=wc-admin', [ { title: 'Orders', url: ADMIN + 'admin.php?page=wc-orders' } ] ),
	menu( 'menu-plugins', 'Plugins', 'plugins.php' ),
	{ id: 'os-overview', kind: 'control', title: 'Workspaces', icon: '' } as NavItem,
];

describe( 'MIO workspace actions', () => {
	const created: Array< Record< string, unknown > > = [];

	beforeEach( () => {
		created.length = 0;
		( window as unknown as { openStationConfig: unknown } ).openStationConfig = { adminUrl: ADMIN };
		( window as unknown as { wp: unknown } ).wp = {
			os: {
				getNavItems: () => SITE,
				workspaces: {
					isPinned: () => false,
					list: () => [ { id: 'desktop-1', label: 'Main' }, ...created.map( ( c, i ) => ( { id: `desktop-${ i + 2 }`, label: c.label, profile: c.profile } ) ) ],
					create: vi.fn( ( opts: Record< string, unknown > ) => {
						created.push( opts );
						return { id: `desktop-${ created.length + 1 }`, label: opts.label };
					} ),
				},
			},
		};
	} );

	afterEach( () => {
		delete ( window as unknown as { wp?: unknown } ).wp;
		delete ( window as unknown as { openStationConfig?: unknown } ).openStationConfig;
	} );

	test( 'the scan lists this site\'s apps and their pages, never the controls', () => {
		const apps = scanApps( SITE );
		expect( apps.map( ( a ) => a.id ) ).toEqual( [ 'menu-posts', 'woocommerce', 'menu-plugins' ] );
		expect( apps[ 0 ].pages ).toEqual( [
			{ title: 'Posts', url: 'edit.php' },
			{ title: 'Add New Post', url: 'post-new.php' },
		] );
	} );

	test( 'positions and cells land on the 6x6 grid, and nothing off it does', () => {
		expect( toGridSpan( { position: 'left-half' } ) ).toEqual( { anchor: { col: 0, row: 0 }, cursor: { col: 2, row: 5 }, cols: 6, rows: 6 } );
		expect( toGridSpan( { position: 'bottom-right' } )?.anchor ).toEqual( { col: 3, row: 3 } );
		expect( toGridSpan( { cells: { col: 4, row: 0, cols: 2, rows: 2 } } )?.cursor ).toEqual( { col: 5, row: 1 } );
		expect( toGridSpan( { cells: { col: 5, row: 0, cols: 2, rows: 1 } } ) ).toBeNull();
		expect( toGridSpan( { position: 'somewhere' } ) ).toBeNull();
	} );

	test( 'MIO reads the shell catalogue, and only dock apps go on the dock', () => {
		( window as unknown as { wp: { os: { workspaces: Record< string, unknown > } } } ).wp.os.workspaces.apps = () => [
			{ id: 'menu-posts', title: 'Posts', icon: '', pages: [ { title: 'Posts', url: 'edit.php' } ], dock: true },
			{ id: 'desktop-mode-recycle-bin', title: 'Trash', icon: '', pages: [], dock: true },
			{ id: 'desktop-mode-os-settings', title: 'OpenStation Preferences', icon: '', pages: [], dock: false },
		];
		const apps = scanApps();
		expect( apps.map( ( a ) => a.id ) ).toEqual( [ 'menu-posts', 'desktop-mode-recycle-bin', 'desktop-mode-os-settings' ] );
		expect( validFields( { apps: [ 'desktop-mode-recycle-bin' ] }, apps ) ).toBe( true );
		expect( validFields( { apps: [ 'desktop-mode-os-settings' ] }, apps ) ).toBe( false );
		expect( validFields( { windows: [ { app: 'desktop-mode-os-settings', position: 'right-half' } ] }, apps ) ).toBe( true );
		// "The posts app" is the app — no page, its main window.
		const posts = toLaunches( [ { app: 'menu-posts', position: 'left-half' } ], apps )[ 0 ];
		expect( posts ).toMatchObject( { match: 'menu-posts', title: 'Posts' } );
		expect( posts.url ).toBeUndefined();
		expect( toLaunches( [ { app: 'desktop-mode-os-settings' } ], apps )[ 0 ].url ).toBeUndefined();
	} );

	test( 'only apps and pages that exist here pass', () => {
		const apps = scanApps( SITE );
		expect( validFields( { windows: [ { app: 'menu-posts', page: 'post-new.php', position: 'top-right' } ] }, apps ) ).toBe( true );
		expect( validFields( { windows: [ { app: 'menu-posts', page: 'options.php' } ] }, apps ) ).toBe( false );
		expect( validFields( { windows: [ { app: 'nope' } ] }, apps ) ).toBe( false );
		expect( validFields( { apps: [ 'os-overview' ] }, apps ) ).toBe( false );
		expect( validFields( { windows: [ { app: 'menu-posts', extra: 1 } ] }, apps ) ).toBe( false );
	} );

	test( 'the asked-for desk, built one accepted step at a time', async () => {
		let draft: WorkspaceDraft | null = null;
		const changed = vi.fn();
		const tools = new Map(
			workspacesMioAbilities( { get: () => draft, set: ( d ) => {
				draft = d;
			}, changed } ).map( ( a ) => [ a.name, a ] ),
		);
		const run = async ( name: string, args: Record< string, unknown > = {} ) => {
			const tool = tools.get( name )!;
			expect( tool.validate( args ) ).toBe( true );
			return ( await tool.run( args, new AbortController().signal, {} as never ) ) as Record< string, unknown >;
		};

		// 1. The layout — a preview, not a desk.
		await run( 'propose_layout', {
			name: 'Editors',
			hide_settings: true,
			windows: [
				{ app: 'menu-posts', position: 'left-half' },
				{ app: 'menu-posts', page: 'post-new.php', position: 'top-right' },
				{ app: 'woocommerce', page: 'admin.php?page=wc-orders', position: 'bottom-right' },
			],
		} );
		expect( created ).toHaveLength( 0 );
		expect( changed ).toHaveBeenCalled();

		// Out of order is refused, not guessed.
		expect( ( await run( 'propose_apps', { apps: [ 'menu-plugins' ] } ) ).status ).toBe( 'rejected' );
		expect( ( await run( 'create_workspace' ) ).status ).toBe( 'rejected' );

		// 2. The dock — the windows' apps always come along.
		await run( 'accept_step', { step: 'layout' } );
		await run( 'propose_apps', { apps: [ 'menu-plugins' ] } );
		expect( draft!.apps!.sort() ).toEqual( [ 'menu-plugins', 'menu-posts', 'woocommerce' ] );

		// 3. The widgets.
		await run( 'accept_step', { step: 'apps' } );
		await run( 'propose_widgets', { widgets: [] } );
		await run( 'accept_step', { step: 'widgets' } );

		// 4. The notes — still not ready to create until they are accepted.
		expect( ( await run( 'create_workspace' ) ).status ).toBe( 'rejected' );
		await run( 'propose_notes', { notes: [ { text: 'Welcome! Orders are bottom right.', size: 'xl', position: 'bottom-left' } ] } );
		await run( 'accept_step', { step: 'notes' } );

		// Only now is anything made — a confirmed write with a receipt.
		const result = await run( 'create_workspace' );
		expect( result ).toMatchObject( { effect: 'write', status: 'confirmed' } );
		expect( created ).toHaveLength( 1 );
		const profile = created[ 0 ].profile as { windows: Array< { url?: string; gridSpan?: { anchor: unknown } } >; restricted: boolean };
		// The posts app is the app (no page); the named screens are pages.
		expect( profile.windows.map( ( w ) => w.url ) ).toEqual( [ undefined, 'post-new.php', 'admin.php?page=wc-orders' ] );
		expect( profile.windows[ 2 ].gridSpan?.anchor ).toEqual( { col: 3, row: 3 } );
		expect( profile.restricted ).toBe( true );
		const notes = ( created[ 0 ].profile as { notes: Array< { text: string; size: string; x: number; y: number } > } ).notes;
		expect( notes ).toHaveLength( 1 );
		expect( notes[ 0 ] ).toMatchObject( { text: 'Welcome! Orders are bottom right.', size: 'xl' } );
		expect( notes[ 0 ].y ).toBeGreaterThan( 0.5 );
		expect( draft ).toBeNull();
	} );

	test( 'MIO repeating an accepted layout does not send the draft back to step 1', async () => {
		let draft: WorkspaceDraft | null = null;
		const tools = new Map(
			workspacesMioAbilities( { get: () => draft, set: ( d ) => {
				draft = d;
			}, changed: () => undefined } ).map( ( a ) => [ a.name, a ] ),
		);
		const run = async ( name: string, args: Record< string, unknown > = {} ) =>
			( await tools.get( name )!.run( args, new AbortController().signal, {} as never ) ) as Record< string, unknown >;
		const layout = { windows: [ { app: 'menu-posts', position: 'left-half' } ] };

		await run( 'propose_layout', layout );
		await run( 'accept_step', { step: 'layout' } );
		await run( 'propose_apps', { apps: [] } );

		// The user says "yes"; MIO sends the same layout again.
		await run( 'propose_layout', layout );
		expect( draft!.accepted.layout ).toBe( true );
		expect( draft!.apps ).not.toBeNull();

		// …and accepting a step that is already accepted is harmless.
		expect( ( await run( 'accept_step', { step: 'layout' } ) ).status ).toBe( 'completed' );
		expect( draft!.accepted.layout ).toBe( true );

		// A layout that actually changed does start over.
		await run( 'propose_layout', { windows: [ { app: 'menu-posts', position: 'right-half' } ] } );
		expect( draft!.accepted.layout ).toBe( false );
	} );

	test( 'a field left out leaves the profile as it was', () => {
		const base = {
			preset: '',
			icon: 'dashicons-cart',
			color: '',
			apps: { mode: 'only' as const, ids: [ 'menu-posts' ] },
			windows: [],
			layout: 'free' as const,
		};
		const next = applyFields( base, { add_apps: [ 'menu-plugins' ] } );
		expect( next.icon ).toBe( 'dashicons-cart' );
		expect( next.apps.ids ).toEqual( [ 'menu-posts', 'menu-plugins' ] );
	} );
} );
