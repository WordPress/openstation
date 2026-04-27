/**
 * Unit tests for `src/menu-refresh-apply.ts`.
 *
 * `createApplyPayload()` is the single function the chromeless bridge
 * goes through after a plugin activates / deactivates inside a windowed
 * `plugins.php`. Every payload key it accepts is part of the live-
 * refresh contract — when a key is in the payload, the corresponding
 * surface MUST update without a page reload.
 *
 * Recurrent regressions in this file have all looked the same: a new
 * payload key landed in PHP + boot path but the live applier was never
 * wired, so plugin activation appeared in the dock but the icon /
 * widget / wallpaper / setting tab silently lagged until F5. These
 * tests pin down each payload key end-to-end.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Dock } from '../../src/dock';
import { createApplyPayload } from '../../src/menu-refresh-apply';
import type { MenuRefreshDeps } from '../../src/menu-refresh-apply';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';
import type { DesktopConfig } from '../../src/types';
import type { WindowManager } from '../../src/window-manager';

interface FakeDock {
	replaceItems: ReturnType< typeof vi.fn >;
	hasItems: ReturnType< typeof vi.fn >;
}

function makeDock( hasItems = true ): FakeDock {
	return {
		replaceItems: vi.fn(),
		hasItems: vi.fn().mockReturnValue( hasItems ),
	};
}

function makeConfig(): DesktopConfig {
	// Only the fields the applier touches matter; the rest of
	// DesktopConfig is irrelevant here. We deliberately pass an `as`
	// to keep the test focused on what the applier writes.
	return {
		dockItems: [],
		taskbarItems: [],
		nativeWindows: [],
		serverWidgets: [],
		serverWallpapers: [],
		serverCommandScripts: [],
		serverCommands: [],
		serverSettingsTabScripts: [],
		serverSettingsTabs: [],
		serverTitleBarButtonScripts: [],
		desktopIcons: [],
	} as unknown as DesktopConfig;
}

function makeDeps( overrides: Partial< MenuRefreshDeps > = {} ): {
	deps: MenuRefreshDeps;
	dock: FakeDock;
	taskbar: FakeDock;
	taskbarEl: HTMLElement;
	desktopArea: HTMLElement;
	config: DesktopConfig;
	syncs: {
		nativeWindows: ReturnType< typeof vi.fn >;
		widgets: ReturnType< typeof vi.fn >;
		wallpapers: ReturnType< typeof vi.fn >;
		commands: ReturnType< typeof vi.fn >;
		settingsTabs: ReturnType< typeof vi.fn >;
		titleBarButtons: ReturnType< typeof vi.fn >;
	};
	renderIcons: ReturnType< typeof vi.fn >;
} {
	const dock = makeDock();
	const taskbar = makeDock();
	const taskbarEl = document.createElement( 'div' );
	const desktopArea = document.createElement( 'div' );
	const config = makeConfig();
	const syncs = {
		nativeWindows: vi.fn().mockResolvedValue( undefined ),
		widgets: vi.fn().mockResolvedValue( undefined ),
		wallpapers: vi.fn().mockResolvedValue( undefined ),
		commands: vi.fn().mockResolvedValue( undefined ),
		settingsTabs: vi.fn().mockResolvedValue( undefined ),
		titleBarButtons: vi.fn().mockResolvedValue( undefined ),
	};
	const renderIcons = vi.fn();

	const deps: MenuRefreshDeps = {
		dock: dock as unknown as MenuRefreshDeps[ 'dock' ],
		taskbar: taskbar as unknown as MenuRefreshDeps[ 'taskbar' ],
		taskbarEl,
		desktopArea,
		config,
		syncNativeWindows: syncs.nativeWindows,
		syncServerWidgets: syncs.widgets,
		syncServerWallpapers: syncs.wallpapers,
		syncServerCommands: syncs.commands,
		syncServerSettingsTabs: syncs.settingsTabs,
		syncServerTitleBarButtons: syncs.titleBarButtons,
		renderIcons,
		...overrides,
	};
	return { deps, dock, taskbar, taskbarEl, desktopArea, config, syncs, renderIcons };
}

const MIN_DOCK = [ { id: 'dashboard', title: 'Dashboard' } ] as const;

describe( 'menu-refresh-apply.createApplyPayload', () => {
	beforeEach( () => {
		installHooksStub();
	} );
	afterEach( () => {
		clearHooksStub();
		vi.restoreAllMocks();
	} );

	test( 'no-ops when dockItems is missing or empty (degraded REST response)', () => {
		const { deps, dock, syncs, renderIcons } = makeDeps();
		const apply = createApplyPayload( deps );

		apply( {} );
		apply( { dockItems: [] } );

		expect( dock.replaceItems ).not.toHaveBeenCalled();
		expect( syncs.nativeWindows ).not.toHaveBeenCalled();
		expect( renderIcons ).not.toHaveBeenCalled();
	} );

	test( 'rebuilds the dock from a fresh dockItems array', () => {
		const { deps, dock, config } = makeDeps();
		const apply = createApplyPayload( deps );

		const items = [ ...MIN_DOCK, { id: 'plugins', title: 'Plugins' } ];
		apply( { dockItems: items } );

		expect( dock.replaceItems ).toHaveBeenCalledTimes( 1 );
		expect( dock.replaceItems ).toHaveBeenCalledWith( items );
		expect( config.dockItems ).toBe( items );
	} );

	test( 'taskbar visibility tracks the post-apply hasItems result', () => {
		// Empty taskbar + no system tiles → hide rail
		const { deps, taskbarEl, desktopArea, taskbar } = makeDeps();
		taskbar.hasItems.mockReturnValue( false );
		const apply = createApplyPayload( deps );

		apply( { dockItems: [ ...MIN_DOCK ], taskbarItems: [] } );

		expect( taskbarEl.hidden ).toBe( true );
		expect(
			desktopArea.classList.contains( 'wp-desktop-area--with-taskbar' ),
		).toBe( false );

		// Now a tile is present (e.g. plugin activated) → show rail
		taskbar.hasItems.mockReturnValue( true );
		apply( {
			dockItems: [ ...MIN_DOCK ],
			taskbarItems: [ { id: 'plugin-x', title: 'Plugin X' } ],
		} );

		expect( taskbarEl.hidden ).toBe( false );
		expect(
			desktopArea.classList.contains( 'wp-desktop-area--with-taskbar' ),
		).toBe( true );
	} );

	test( 'forwards every server-* array to its dedicated sync', () => {
		const { deps, syncs } = makeDeps();
		const apply = createApplyPayload( deps );

		const nativeWindows = [ { id: 'calc' } ];
		const widgets = [ { id: 'clock' } ];
		const wallpapers = [ { id: 'starfield' } ];
		const cmdScripts = [ { handle: 'p-a', scriptUrl: 'a.js' } ];
		const cmds = [ { id: 'cmd1' } ];
		const tabScripts = [ { handle: 'p-b', scriptUrl: 'b.js' } ];
		const tabs = [ { id: 'tab1' } ];
		const titleScripts = [ { handle: 'p-c', scriptUrl: 'c.js' } ];

		apply( {
			dockItems: [ ...MIN_DOCK ],
			nativeWindows,
			serverWidgets: widgets,
			serverWallpapers: wallpapers,
			serverCommandScripts: cmdScripts,
			serverCommands: cmds,
			serverSettingsTabScripts: tabScripts,
			serverSettingsTabs: tabs,
			serverTitleBarButtonScripts: titleScripts,
		} );

		expect( syncs.nativeWindows ).toHaveBeenCalledWith( nativeWindows );
		expect( syncs.widgets ).toHaveBeenCalledWith( widgets );
		expect( syncs.wallpapers ).toHaveBeenCalledWith( wallpapers );
		expect( syncs.commands ).toHaveBeenCalledWith( cmdScripts, cmds );
		expect( syncs.settingsTabs ).toHaveBeenCalledWith( tabScripts, tabs );
		expect( syncs.titleBarButtons ).toHaveBeenCalledWith( titleScripts );
	} );

	// THE PRIMARY REGRESSION GUARD.
	//
	// `desktopIcons` is in the PHP payload (`desktop_mode_build_menu_payload`)
	// and was rendered at boot, but the live applier never read it —
	// so a plugin that registered a wallpaper icon via
	// `desktop_mode_register_icon()` only appeared after F5 and likewise
	// stayed on the wallpaper after deactivation. This test pins both
	// halves of the contract.
	describe( 'desktopIcons live-refresh (regression)', () => {
		test( 'activation: a fresh icon list is forwarded to renderIcons and stored on config', () => {
			const { deps, renderIcons, config } = makeDeps();
			const apply = createApplyPayload( deps );

			const icons = [
				{ id: 'jorvy', title: 'Jorvy', icon: 'dashicons-star-filled' },
			];
			apply( { dockItems: [ ...MIN_DOCK ], desktopIcons: icons } );

			expect( renderIcons ).toHaveBeenCalledTimes( 1 );
			expect( renderIcons ).toHaveBeenCalledWith( icons );
			expect( config.desktopIcons ).toBe( icons );
		} );

		test( 'deactivation: an empty icon list re-renders to clear the grid', () => {
			const { deps, renderIcons, config } = makeDeps();
			// Seed a prior icon to mirror "icon was on the wallpaper".
			config.desktopIcons = [
				{ id: 'jorvy', title: 'Jorvy', icon: 'dashicons-star-filled' },
			] as DesktopConfig[ 'desktopIcons' ];
			const apply = createApplyPayload( deps );

			apply( { dockItems: [ ...MIN_DOCK ], desktopIcons: [] } );

			// renderIcons MUST be called even when the array is empty
			// — the renderer is what wipes the prior container. Skipping
			// the call leaves a stale icon on the wallpaper after the
			// owning plugin deactivates.
			expect( renderIcons ).toHaveBeenCalledTimes( 1 );
			expect( renderIcons ).toHaveBeenCalledWith( [] );
			expect( config.desktopIcons ).toEqual( [] );
		} );

		test( 'missing key: leaves prior icon state untouched', () => {
			const { deps, renderIcons, config } = makeDeps();
			const prior = [
				{ id: 'jorvy', title: 'Jorvy', icon: 'dashicons-star-filled' },
			];
			config.desktopIcons = prior as DesktopConfig[ 'desktopIcons' ];
			const apply = createApplyPayload( deps );

			// Older bridges may emit dock-only payloads — those must
			// NOT touch the icon grid.
			apply( { dockItems: [ ...MIN_DOCK ] } );

			expect( renderIcons ).not.toHaveBeenCalled();
			expect( config.desktopIcons ).toBe( prior );
		} );
	} );

	test( 'serverTitleBarButtonScripts: live-refresh contract', () => {
		// Same shape of regression risk as desktopIcons — recently
		// added payload key, easy to forget to wire on the live
		// applier side.
		const { deps, syncs, config } = makeDeps();
		const apply = createApplyPayload( deps );

		const scripts = [ { handle: 'plugin-d', scriptUrl: 'd.js' } ];
		apply( {
			dockItems: [ ...MIN_DOCK ],
			serverTitleBarButtonScripts: scripts,
		} );

		expect( syncs.titleBarButtons ).toHaveBeenCalledWith( scripts );
		expect( config.serverTitleBarButtonScripts ).toBe( scripts );
	} );
} );

// End-to-end live-refresh — REAL Dock instance, REAL DOM, real
// applyPayload pipeline. Pins the user-visible behaviour: a plugin
// (Yoast SEO, etc.) that adds a top-level admin menu MUST surface
// as a tile on the bottom centered taskbar the moment its row in
// `taskbarItems` arrives, and disappear from the rail the moment
// its row leaves. Same for the left dock when a core menu item
// appears / disappears (rare but possible — multisite, role-gated
// menus, etc.).
//
// This is the regression class the user kept hitting: the previous
// generation of this code had `taskbar.replaceItems` wired but
// no test actually verified the full message-to-DOM hop, so quiet
// breakage in any link of the chain (the applier, the dock, the
// hidden-rail re-show) only showed up in production.
describe( 'menu-refresh-apply.createApplyPayload — end-to-end with real Dock', () => {
	function buildShell(): {
		dockEl: HTMLElement;
		taskbarEl: HTMLElement;
		desktopArea: HTMLElement;
		dock: Dock;
		taskbar: Dock;
		config: DesktopConfig;
	} {
		document.body.innerHTML = '';
		const desktopArea = document.createElement( 'div' );
		desktopArea.id = 'wp-desktop-area';
		const dockEl = document.createElement( 'div' );
		dockEl.id = 'wp-desktop-dock';
		const taskbarEl = document.createElement( 'div' );
		taskbarEl.id = 'wp-desktop-taskbar';
		taskbarEl.hidden = true;
		document.body.append( desktopArea, dockEl, taskbarEl );

		const manager = {
			open: vi.fn(),
			getById: () => null,
			getFocused: () => null,
			getAll: () => [],
			getCount: () => 0,
			getActiveDesktopId: () => 'desktop-1',
		} as unknown as WindowManager;

		const dock = new Dock( dockEl, manager, [], '/wp-admin/', 'left' );
		const taskbar = new Dock( taskbarEl, manager, [], '/wp-admin/', 'bottom' );

		const config = {
			dockItems: [],
			taskbarItems: [],
			adminUrl: '/wp-admin/',
		} as unknown as DesktopConfig;

		return { dockEl, taskbarEl, desktopArea, dock, taskbar, config };
	}

	function tilesIn( el: HTMLElement, attr: 'menu-slug' | 'system-id' ): string[] {
		return Array.from(
			el.querySelectorAll( `[data-${ attr }]` ),
		).map( ( e ) => {
			const ds = ( e as HTMLElement ).dataset;
			return attr === 'menu-slug' ? ( ds.menuSlug as string ) : ( ds.systemId as string );
		} );
	}

	function makeNoopDeps(
		dock: Dock,
		taskbar: Dock,
		taskbarEl: HTMLElement,
		desktopArea: HTMLElement,
		config: DesktopConfig,
	): MenuRefreshDeps {
		const noop = (): Promise< void > => Promise.resolve();
		return {
			dock,
			taskbar,
			taskbarEl,
			desktopArea,
			config,
			syncNativeWindows: noop,
			syncServerWidgets: noop,
			syncServerWallpapers: noop,
			syncServerCommands: noop,
			syncServerSettingsTabs: noop,
			syncServerTitleBarButtons: noop,
			renderIcons: () => {},
		};
	}

	beforeEach( () => {
		installHooksStub();
	} );
	afterEach( () => {
		clearHooksStub();
		vi.restoreAllMocks();
		document.body.innerHTML = '';
	} );

	test( 'activation: a plugin top-level menu (e.g. Yoast SEO) appears on the bottom taskbar live', () => {
		const { dock, taskbar, taskbarEl, desktopArea, config } = buildShell();
		const apply = createApplyPayload(
			makeNoopDeps( dock, taskbar, taskbarEl, desktopArea, config ),
		);

		// Boot — Dashboard alone, taskbar empty, rail hidden.
		apply( {
			dockItems: [ { id: 'index.php', title: 'Dashboard', icon: 'dashicons-dashboard', url: '/wp-admin/index.php' } ],
			taskbarItems: [],
		} );
		expect( taskbarEl.hidden ).toBe( true );
		expect( tilesIn( taskbarEl, 'menu-slug' ) ).toEqual( [] );

		// Activate Yoast — bridge re-broadcasts with the new top-level
		// menu now in `taskbarItems`.
		apply( {
			dockItems: [ { id: 'index.php', title: 'Dashboard', icon: 'dashicons-dashboard', url: '/wp-admin/index.php' } ],
			taskbarItems: [
				{ id: 'wpseo_dashboard', title: 'Yoast SEO', icon: 'dashicons-yoast', url: '/wp-admin/admin.php?page=wpseo_dashboard' },
			],
		} );

		expect( tilesIn( taskbarEl, 'menu-slug' ) ).toEqual( [ 'wpseo_dashboard' ] );
		expect( taskbarEl.hidden ).toBe( false );
		expect(
			desktopArea.classList.contains( 'wp-desktop-area--with-taskbar' ),
		).toBe( true );
	} );

	test( 'deactivation: the same plugin disappears from the bottom taskbar live', () => {
		const { dock, taskbar, taskbarEl, desktopArea, config } = buildShell();
		const apply = createApplyPayload(
			makeNoopDeps( dock, taskbar, taskbarEl, desktopArea, config ),
		);

		// Boot with Yoast already on the rail.
		apply( {
			dockItems: [ { id: 'index.php', title: 'Dashboard', icon: 'dashicons-dashboard', url: '/wp-admin/index.php' } ],
			taskbarItems: [
				{ id: 'wpseo_dashboard', title: 'Yoast SEO', icon: 'dashicons-yoast', url: '/wp-admin/admin.php?page=wpseo_dashboard' },
			],
		} );
		expect( tilesIn( taskbarEl, 'menu-slug' ) ).toEqual( [ 'wpseo_dashboard' ] );

		// Deactivate Yoast — bridge re-broadcasts with the entry gone.
		apply( {
			dockItems: [ { id: 'index.php', title: 'Dashboard', icon: 'dashicons-dashboard', url: '/wp-admin/index.php' } ],
			taskbarItems: [],
		} );

		expect( tilesIn( taskbarEl, 'menu-slug' ) ).toEqual( [] );
		// With no menu tiles AND no system tiles, the rail hides itself.
		expect( taskbarEl.hidden ).toBe( true );
		expect(
			desktopArea.classList.contains( 'wp-desktop-area--with-taskbar' ),
		).toBe( false );
	} );

	test( 'activation/deactivation cycle: live taskbar tracks every step', () => {
		const { dock, taskbar, taskbarEl, desktopArea, config } = buildShell();
		const apply = createApplyPayload(
			makeNoopDeps( dock, taskbar, taskbarEl, desktopArea, config ),
		);

		const dashboard = { id: 'index.php', title: 'Dashboard', icon: 'dashicons-dashboard', url: '/wp-admin/index.php' };
		const yoast = {
			id: 'wpseo_dashboard',
			title: 'Yoast SEO',
			icon: 'dashicons-yoast',
			url: '/wp-admin/admin.php?page=wpseo_dashboard',
		};
		const woo = {
			id: 'woocommerce',
			title: 'WooCommerce',
			icon: 'dashicons-store',
			url: '/wp-admin/admin.php?page=woocommerce',
		};

		apply( { dockItems: [ dashboard ], taskbarItems: [] } );
		apply( { dockItems: [ dashboard ], taskbarItems: [ yoast ] } );
		expect( tilesIn( taskbarEl, 'menu-slug' ) ).toEqual( [ 'wpseo_dashboard' ] );

		apply( {
			dockItems: [ dashboard ],
			taskbarItems: [ yoast, woo ],
		} );
		expect( tilesIn( taskbarEl, 'menu-slug' ).sort() ).toEqual( [
			'woocommerce',
			'wpseo_dashboard',
		] );

		apply( {
			dockItems: [ dashboard ],
			taskbarItems: [ woo ],
		} );
		expect( tilesIn( taskbarEl, 'menu-slug' ) ).toEqual( [ 'woocommerce' ] );

		apply( { dockItems: [ dashboard ], taskbarItems: [] } );
		expect( tilesIn( taskbarEl, 'menu-slug' ) ).toEqual( [] );
		expect( taskbarEl.hidden ).toBe( true );
	} );

	test( 'native-window tiles on the same rail survive a menu-derived replaceItems', () => {
		// The bottom taskbar carries TWO kinds of tiles: menu-derived
		// (`taskbarItems`, removed/added wholesale via `replaceItems`)
		// and JS-registered system tiles (`appendSystemItem`, e.g. the
		// Calculator native window). A live menu refresh that fires
		// `taskbar.replaceItems` MUST NOT collateral-damage the system
		// tiles — that's the contract Dock guards via the separate
		// `systemItemElements` map. Pinning it here keeps any future
		// "rewrite the dock" PR honest.
		const { dock, taskbar, taskbarEl, desktopArea, config } = buildShell();
		const apply = createApplyPayload(
			makeNoopDeps( dock, taskbar, taskbarEl, desktopArea, config ),
		);

		// Calculator tile lands first, the way native-windows.ts would.
		taskbar.appendSystemItem( {
			id: 'calculator',
			title: 'Calculator',
			icon: 'dashicons-calculator',
			isOpen: () => false,
			onOpen: () => {},
		} );
		expect( tilesIn( taskbarEl, 'system-id' ) ).toEqual( [ 'calculator' ] );

		// Then a plugin activates and adds a menu tile.
		apply( {
			dockItems: [ { id: 'index.php', title: 'Dashboard', icon: 'dashicons-dashboard', url: '/wp-admin/index.php' } ],
			taskbarItems: [
				{ id: 'wpseo_dashboard', title: 'Yoast SEO', icon: 'dashicons-yoast', url: '/wp-admin/admin.php?page=wpseo_dashboard' },
			],
		} );

		expect( tilesIn( taskbarEl, 'menu-slug' ) ).toEqual( [ 'wpseo_dashboard' ] );
		// SYSTEM tile must still be present.
		expect( tilesIn( taskbarEl, 'system-id' ) ).toEqual( [ 'calculator' ] );

		// Plugin deactivates — system tile keeps the rail alive.
		apply( {
			dockItems: [ { id: 'index.php', title: 'Dashboard', icon: 'dashicons-dashboard', url: '/wp-admin/index.php' } ],
			taskbarItems: [],
		} );
		expect( tilesIn( taskbarEl, 'menu-slug' ) ).toEqual( [] );
		expect( tilesIn( taskbarEl, 'system-id' ) ).toEqual( [ 'calculator' ] );
		// System tile keeps it visible.
		expect( taskbarEl.hidden ).toBe( false );
	} );
} );
