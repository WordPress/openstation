/**
 * The navigation spec, as a table.
 *
 * Every rule about where a thing shows up lives in `computeNav`, so
 * every rule about where a thing shows up is asserted here. If a
 * surface starts disagreeing with this file, the surface is wrong.
 */

import { describe, expect, test } from 'vitest';
import { buildNavItems, computeNav } from '../../src/nav';
import type {
	NavItem,
	NavKind,
	NavLayout,
	NavPlacement,
	OpenWindow,
} from '../../src/nav';
import type { DockItem, SystemDockItem } from '../../src/dock';
import type { DesktopIconServerEntry } from '../../src/types';

function item(
	id: string,
	kind: NavKind,
	extra: Partial< NavItem > = {},
): NavItem {
	return { id, kind, title: id, icon: 'dashicons-admin-generic', ...extra };
}

function run(
	items: NavItem[],
	{
		placement = {},
		order = [],
		layout = 'unified',
		open = [],
	}: {
		placement?: Record< string, NavPlacement >;
		order?: string[];
		layout?: NavLayout;
		open?: Array< string | OpenWindow >;
	} = {},
) {
	return computeNav( {
		items,
		config: { placement, order },
		layout,
		openWindows: open.map( ( w ) =>
			'string' === typeof w
				? {
						id: w,
						title: w,
						icon: 'dashicons-admin-generic',
						// A bare id stands for an admin page: the
						// common case, and the one that must NOT mint
						// a tile of its own.
						fromAdminUrl: true,
					}
				: w,
		),
	} );
}

const ids = ( list: NavItem[] ): string[] => list.map( ( i ) => i.id );

describe( 'defaults by kind', () => {
	const items = [
		item( 'edit.php', 'core' ),
		item( 'woocommerce', 'plugin' ),
		item( 'games', 'app' ),
		item( 'os-overview', 'control' ),
	];

	test( 'unified: core and plugin menus and controls are on the dock, apps on the desktop', () => {
		const nav = run( items );
		expect( ids( nav.dock.core ) ).toEqual( [ 'edit.php' ] );
		expect( ids( nav.dock.apps ) ).toEqual( [ 'woocommerce' ] );
		expect( ids( nav.dock.controls ) ).toEqual( [ 'os-overview' ] );
		expect( ids( nav.sidebar ) ).toEqual( [] );
		expect( ids( nav.desktop ) ).toEqual( [ 'games' ] );
	} );

	test( 'split: only core menus move to the sidebar', () => {
		const nav = run( items, { layout: 'classic' } );
		expect( ids( nav.sidebar ) ).toEqual( [ 'edit.php' ] );
		expect( ids( nav.dock.core ) ).toEqual( [] );
		expect( ids( nav.dock.apps ) ).toEqual( [ 'woocommerce' ] );
		expect( ids( nav.dock.controls ) ).toEqual( [ 'os-overview' ] );
	} );

	test( 'the same stored value follows the layout with no migration', () => {
		const placement: Record< string, NavPlacement > = {
			'edit.php': 'rail',
		};
		expect(
			ids( run( [ item( 'edit.php', 'core' ) ], { placement } ).dock.core ),
		).toEqual( [ 'edit.php' ] );
		expect(
			ids(
				run( [ item( 'edit.php', 'core' ) ], {
					placement,
					layout: 'classic',
				} ).sidebar,
			),
		).toEqual( [ 'edit.php' ] );
	} );
} );

describe( 'placement values', () => {
	const cases: Array< [ NavPlacement, string[], string[] ] > = [
		[ 'rail', [ 'x' ], [] ],
		[ 'desktop', [], [ 'x' ] ],
		[ 'both', [ 'x' ], [ 'x' ] ],
		[ 'hidden', [], [] ],
	];

	for ( const [ placement, rail, desktop ] of cases ) {
		test( `${ placement }`, () => {
			const nav = run( [ item( 'x', 'plugin' ) ], {
				placement: { x: placement },
			} );
			expect( ids( nav.dock.apps ) ).toEqual( rail );
			expect( ids( nav.desktop ) ).toEqual( desktop );
		} );
	}
} );

describe( 'zones', () => {
	test( 'kind decides the zone, and nothing can change it', () => {
		const nav = run(
			[
				item( 'core-menu', 'core' ),
				item( 'plugin-menu', 'plugin' ),
				item( 'an-app', 'app', {} ),
				item( 'a-control', 'control' ),
			],
			{ placement: { 'an-app': 'rail' } },
		);
		expect( ids( nav.dock.core ) ).toEqual( [ 'core-menu' ] );
		expect( ids( nav.dock.apps ) ).toEqual( [ 'plugin-menu', 'an-app' ] );
		expect( ids( nav.dock.controls ) ).toEqual( [ 'a-control' ] );
	} );
} );

describe( 'running windows', () => {
	test( 'a desktop-only app gets an ephemeral dock tile while open', () => {
		const games = item( 'games', 'app', { windowId: 'games-window' } );
		const closed = run( [ games ] );
		expect( ids( closed.dock.apps ) ).toEqual( [] );

		const open = run( [ games ], { open: [ 'games-window' ] } );
		expect( ids( open.dock.apps ) ).toEqual( [ 'games' ] );
		expect( open.ephemeral.has( 'games' ) ).toBe( true );
		// It is on the dock only — the wallpaper still owns its
		// launcher, so it must not be listed twice.
		expect( ids( open.desktop ) ).toEqual( [ 'games' ] );
	} );

	test( 'a hidden item still gets a tile while its window is open', () => {
		const nav = run(
			[ item( 'x', 'app', { windowId: 'w' } ) ],
			{ placement: { x: 'hidden' }, open: [ 'w' ] },
		);
		expect( ids( nav.dock.apps ) ).toEqual( [ 'x' ] );
		expect( nav.ephemeral.has( 'x' ) ).toBe( true );
	} );

	test( 'an item already on a rail is never duplicated', () => {
		const nav = run( [ item( 'x', 'plugin', { windowId: 'w' } ) ], {
			open: [ 'w' ],
		} );
		expect( ids( nav.dock.apps ) ).toEqual( [ 'x' ] );
		expect( nav.ephemeral.has( 'x' ) ).toBe( false );
	} );

	test( 'a core menu in the sidebar does not also get a dock tile', () => {
		const nav = run( [ item( 'edit.php', 'core', { windowId: 'w' } ) ], {
			layout: 'classic',
			open: [ 'w' ],
		} );
		expect( ids( nav.sidebar ) ).toEqual( [ 'edit.php' ] );
		expect( ids( nav.dock.apps ) ).toEqual( [] );
	} );

	test( 'a desktop-only core menu lands on the dock, never the sidebar', () => {
		const nav = run( [ item( 'edit.php', 'core', { windowId: 'w' } ) ], {
			placement: { 'edit.php': 'desktop' },
			layout: 'classic',
			open: [ 'w' ],
		} );
		expect( ids( nav.sidebar ) ).toEqual( [] );
		expect( ids( nav.dock.apps ) ).toEqual( [ 'edit.php' ] );
	} );
} );

describe( 'a window nothing launches', () => {
	test( 'gets a tile of its own while it is open', () => {
		// OpenStation Preferences is the shipped case: a native window
		// with no launcher anywhere. Without this it is unswitchable,
		// with nowhere to minimize back into.
		const nav = run( [], {
			open: [
				{
					id: 'desktop-mode-os-settings',
					title: 'OpenStation Preferences',
					icon: 'dashicons-admin-generic',
					fromAdminUrl: false,
				},
			],
		} );
		expect( ids( nav.dock.apps ) ).toEqual( [
			'desktop-mode-os-settings',
		] );
		expect( nav.dock.apps[ 0 ].transient ).toBe( true );
		expect( nav.ephemeral.has( 'desktop-mode-os-settings' ) ).toBe(
			true,
		);
		// Nowhere else — it has no launcher to place.
		expect( ids( nav.desktop ) ).toEqual( [] );
	} );

	test( 'an admin page gets none — its menu already answers for it', () => {
		// The post editor opens under its own key, and the Posts tile
		// lights up for it. A second tile would duplicate what the
		// menu's hover peek already fans out.
		const nav = run( [], { open: [ 'post-php' ] } );
		expect( ids( nav.dock.apps ) ).toEqual( [] );
	} );

	test( 'a tile answers for what its submenu rows open', () => {
		// The System tile carries OpenStation Preferences as a row, so
		// Preferences opening lights that tile instead of minting a
		// gear beside it. Before this, the dock grew a second tile for
		// a window the rail already represented.
		const system = item( 'os-system', 'control', {
			answersFor: [ 'desktop-mode-os-settings' ],
		} );
		const nav = run( [ system ], {
			open: [
				{
					id: 'desktop-mode-os-settings',
					title: 'OpenStation Preferences',
					icon: 'dashicons-admin-generic',
					fromAdminUrl: false,
				},
			],
		} );
		expect( ids( nav.dock.apps ) ).toEqual( [] );
		expect( ids( nav.dock.controls ) ).toEqual( [ 'os-system' ] );
	} );

	test( 'a launcher of its own wins over a tile standing in for it', () => {
		const nav = run(
			[
				item( 'os-system', 'control', { answersFor: [ 'w' ] } ),
				item( 'games', 'app', { windowId: 'w' } ),
			],
			{
				open: [
					{
						id: 'w',
						title: 'Games',
						icon: 'dashicons-games',
						fromAdminUrl: false,
					},
				],
			},
		);
		// Games is desktop-only, so it takes the transient tile rather
		// than leaving the window represented by System.
		expect( ids( nav.dock.apps ) ).toEqual( [ 'games' ] );
	} );

	test( 'a tile that answers for a window still gets one while it is desktop-only', () => {
		const nav = run(
			[ item( 'os-system', 'control', { answersFor: [ 'w' ] } ) ],
			{
				placement: { 'os-system': 'desktop' },
				open: [
					{
						id: 'w',
						title: 'Preferences',
						icon: 'dashicons-admin-generic',
						fromAdminUrl: false,
					},
				],
			},
		);
		// It answers for the window, so it is the thing that rides the
		// rail while that window is open.
		expect( ids( nav.dock.apps ) ).toEqual( [ 'os-system' ] );
		expect( nav.ephemeral.has( 'os-system' ) ).toBe( true );
	} );

	test( 'an item that claims the window keeps it', () => {
		const nav = run( [ item( 'games', 'app', { windowId: 'w' } ) ], {
			open: [
				{
					id: 'w',
					title: 'Games',
					icon: 'dashicons-games',
					fromAdminUrl: false,
				},
			],
		} );
		expect( ids( nav.dock.apps ) ).toEqual( [ 'games' ] );
		expect( nav.dock.apps[ 0 ].transient ).toBeUndefined();
	} );
} );

describe( 'locked items', () => {
	test( 'Exit ignores a stored placement', () => {
		const nav = run( [ item( 'os-exit', 'control', { locked: true } ) ], {
			placement: { 'os-exit': 'hidden' },
		} );
		expect( ids( nav.dock.controls ) ).toEqual( [ 'os-exit' ] );
		expect( ids( nav.desktop ) ).toEqual( [] );
	} );
} );

describe( 'ordering', () => {
	test( 'the flat order applies within each zone', () => {
		const nav = run(
			[
				item( 'a', 'plugin' ),
				item( 'b', 'plugin' ),
				item( 'c', 'core' ),
				item( 'd', 'core' ),
			],
			{ order: [ 'd', 'b' ] },
		);
		expect( ids( nav.dock.core ) ).toEqual( [ 'd', 'c' ] );
		expect( ids( nav.dock.apps ) ).toEqual( [ 'b', 'a' ] );
	} );

	test( 'the item\'s own order is the baseline within a zone', () => {
		// Registration order cannot express the shell's trailing
		// cluster: a launcher arrives whenever its lazy script
		// resolves, so the tile registered last in `desktop.ts` is not
		// last on the rail.
		const nav = run( [
			item( 'os-system', 'control', { order: 30 } ),
			item( 'os-mio', 'control', { order: 10 } ),
			item( 'trash', 'control', { order: 40 } ),
			item( 'os-overview', 'control', { order: 20 } ),
		] );
		expect( ids( nav.dock.controls ) ).toEqual( [
			'os-mio',
			'os-overview',
			'os-system',
			'trash',
		] );
	} );

	test( 'an unordered item leads the ordered cluster, ties keeping registration order', () => {
		const nav = run( [
			item( 'os-system', 'control', { order: 30 } ),
			item( 'plugin-a', 'control' ),
			item( 'plugin-b', 'control' ),
		] );
		expect( ids( nav.dock.controls ) ).toEqual( [
			'plugin-a',
			'plugin-b',
			'os-system',
		] );
	} );

	test( 'the user’s own order wins over the baseline', () => {
		const nav = run(
			[
				item( 'os-system', 'control', { order: 30 } ),
				item( 'os-mio', 'control', { order: 10 } ),
			],
			{ order: [ 'os-system', 'os-mio' ] },
		);
		expect( ids( nav.dock.controls ) ).toEqual( [ 'os-system', 'os-mio' ] );
	} );

	test( 'unlisted ids keep their registration order, after the listed ones', () => {
		const nav = run(
			[ item( 'a', 'plugin' ), item( 'b', 'plugin' ), item( 'c', 'plugin' ) ],
			{ order: [ 'c' ] },
		);
		expect( ids( nav.dock.apps ) ).toEqual( [ 'c', 'a', 'b' ] );
	} );
} );

describe( 'buildNavItems', () => {
	const menu = ( id: string, isCore: boolean ): DockItem => ( {
		id,
		title: id,
		icon: 'dashicons-admin-generic',
		url: `${ id }`,
		badge: 0,
		submenu: [],
		isCore,
	} );
	const tile = ( id: string ): SystemDockItem => ( {
		id,
		title: id,
		icon: 'dashicons-admin-generic',
		onOpen: () => {},
	} );
	const icon = (
		id: string,
		windowId = '',
	): DesktopIconServerEntry => ( {
		id,
		title: id,
		icon: 'dashicons-admin-generic',
		window: windowId,
		url: '',
		position: 10,
	} );

	test( 'classifies admin menus by isCore', () => {
		const items = buildNavItems( {
			menuItems: [ menu( 'edit.php', true ), menu( 'wc', false ) ],
			systemTiles: [],
			icons: [],
		} );
		expect( items.map( ( i ) => [ i.id, i.kind ] ) ).toEqual( [
			[ 'edit.php', 'core' ],
			[ 'wc', 'plugin' ],
		] );
	} );

	test( 'an app registered as both a window tile and a desktop icon is ONE item', () => {
		const items = buildNavItems( {
			menuItems: [],
			systemTiles: [ { item: tile( 'desktop-mode-games' ), kind: 'app' } ],
			icons: [ icon( 'desktop-mode-games', 'desktop-mode-games' ) ],
		} );
		expect( items ).toHaveLength( 1 );
		expect( items[ 0 ].kind ).toBe( 'app' );
		expect( items[ 0 ].tile ).toBeTruthy();
		expect( items[ 0 ].entry ).toBeTruthy();
		// And it defaults to the desktop, which is what Preferences
		// claimed all along while the dock painted a tile anyway.
		const nav = run( items );
		expect( ids( nav.dock.apps ) ).toEqual( [] );
		expect( ids( nav.desktop ) ).toEqual( [ 'desktop-mode-games' ] );
	} );

	test( 'an icon merges onto the tile its window names, under the icon id', () => {
		const items = buildNavItems( {
			menuItems: [],
			systemTiles: [ { item: tile( 'plugin-window' ), kind: 'app' } ],
			icons: [ icon( 'plugin-icon', 'plugin-window' ) ],
		} );
		expect( items ).toHaveLength( 1 );
		expect( items[ 0 ].id ).toBe( 'plugin-window' );
		expect( items[ 0 ].entry?.id ).toBe( 'plugin-icon' );
	} );

	test( 'a window that asked for a launcher keeps it on the rail', () => {
		// `openstation_register_window( 'placement' => 'dock' )` is a
		// proposal, and it has to reach the model: apps default to the
		// wallpaper, so without it a plugin's launcher would silently
		// move off the dock it has always been on.
		const items = buildNavItems( {
			menuItems: [],
			systemTiles: [
				{
					item: { ...tile( 'my-app' ), defaultPlacement: 'rail' },
					kind: 'app',
				},
			],
			icons: [],
		} );
		expect( items[ 0 ].defaultPlacement ).toBe( 'rail' );
		expect( ids( run( items ).dock.apps ) ).toEqual( [ 'my-app' ] );

		// And the user still outranks it.
		expect(
			ids( run( items, { placement: { 'my-app': 'desktop' } } ).dock.apps ),
		).toEqual( [] );
	} );

	test( 'a window with no launcher leaves its app on the wallpaper', () => {
		const items = buildNavItems( {
			menuItems: [],
			systemTiles: [],
			icons: [ icon( 'my-app', 'my-app-window' ) ],
		} );
		expect( items[ 0 ].defaultPlacement ).toBeUndefined();
		expect( ids( run( items ).desktop ) ).toEqual( [ 'my-app' ] );
	} );

	test( 'shell tiles keep their declared kind and lock', () => {
		const items = buildNavItems( {
			menuItems: [],
			systemTiles: [
				{ item: tile( 'os-exit' ), kind: 'control', locked: true },
				{ item: tile( 'desktop-mode-games' ), kind: 'app' },
			],
			icons: [],
		} );
		expect( items[ 0 ].locked ).toBe( true );
		expect( items[ 0 ].kind ).toBe( 'control' );
		expect( items[ 1 ].kind ).toBe( 'app' );
	} );
} );
