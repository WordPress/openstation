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
import {
	createApplyPayload,
	REGISTRY_CHANGED_EVENT,
} from '../../src/menu-refresh-apply';
import type {
	MenuRefreshDeps,
	RegistryChangedDetail,
} from '../../src/menu-refresh-apply';
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
	const desktopArea = document.createElement( 'div' );
	const config = makeConfig();
	const syncs = {
		nativeWindows: vi.fn().mockResolvedValue( undefined ),
		widgets: vi.fn().mockResolvedValue( undefined ),
		wallpapers: vi.fn().mockResolvedValue( undefined ),
		commands: vi.fn().mockResolvedValue( undefined ),
		settingsTabs: vi.fn().mockResolvedValue( undefined ),
		titleBarButtons: vi.fn().mockResolvedValue( undefined ),
		dockRailRenderers: vi.fn().mockResolvedValue( undefined ),
	};
	const renderIcons = vi.fn();

	const deps: MenuRefreshDeps = {
		applyDockItems: ( items ) => dock.replaceItems( items ),
		desktopArea,
		config,
		syncNativeWindows: syncs.nativeWindows,
		syncServerWidgets: syncs.widgets,
		syncServerWallpapers: syncs.wallpapers,
		syncServerCommands: syncs.commands,
		syncServerSettingsTabs: syncs.settingsTabs,
		syncServerTitleBarButtons: syncs.titleBarButtons,
		syncServerDockRailRenderers: syncs.dockRailRenderers,
		renderIcons,
		...overrides,
	};
	return { deps, dock, desktopArea, config, syncs, renderIcons };
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

	// `desktop-mode-registry-changed` is the public CustomEvent
	// plugin authors subscribe to in order to react to peer plugins
	// being activated/deactivated mid-session. The event name is
	// project-prefixed (NOT `wp-desktop-*`) per WordPress plugin
	// reviewer guidelines that reserve `wp-` for Core.
	describe( 'desktop-mode-registry-changed CustomEvent', () => {
		function captureEvents(): {
			events: RegistryChangedDetail[];
			cleanup: () => void;
		} {
			const events: RegistryChangedDetail[] = [];
			const handler = ( e: Event ): void => {
				events.push(
					( e as CustomEvent< RegistryChangedDetail > ).detail,
				);
			};
			document.addEventListener( REGISTRY_CHANGED_EVENT, handler );
			return {
				events,
				cleanup: () =>
					document.removeEventListener( REGISTRY_CHANGED_EVENT, handler ),
			};
		}

		test( 'fires for native-windows added (plugin activated)', () => {
			const { deps } = makeDeps();
			const apply = createApplyPayload( deps );
			const { events, cleanup } = captureEvents();

			apply( {
				dockItems: [ ...MIN_DOCK ],
				nativeWindows: [ { id: 'jorvy' } ],
			} );

			cleanup();
			const nw = events.find( ( e ) => e.registry === 'native-windows' );
			expect( nw ).toBeDefined();
			expect( nw?.added ).toEqual( [ 'jorvy' ] );
			expect( nw?.removed ).toEqual( [] );
		} );

		test( 'fires for desktop-icons removed (plugin deactivated)', () => {
			const { deps, config } = makeDeps();
			config.desktopIcons = [
				{ id: 'jorvy', title: 'Jorvy', icon: 'dashicons-star-filled' },
			] as DesktopConfig[ 'desktopIcons' ];
			const apply = createApplyPayload( deps );
			const { events, cleanup } = captureEvents();

			apply( { dockItems: [ ...MIN_DOCK ], desktopIcons: [] } );

			cleanup();
			const di = events.find( ( e ) => e.registry === 'desktop-icons' );
			expect( di ).toBeDefined();
			expect( di?.added ).toEqual( [] );
			expect( di?.removed ).toEqual( [ 'jorvy' ] );
		} );

		test( 'fires for dock-items diff', () => {
			const { deps, config } = makeDeps();
			config.dockItems = [
				{ id: 'dashboard' },
				{ id: 'plugins' },
			] as DesktopConfig[ 'dockItems' ];
			const apply = createApplyPayload( deps );
			const { events, cleanup } = captureEvents();

			apply( {
				dockItems: [
					{ id: 'dashboard' },
					{ id: 'jorvy' },
				] as DesktopConfig[ 'dockItems' ],
			} );

			cleanup();
			const dock = events.find( ( e ) => e.registry === 'dock-items' );
			expect( dock ).toBeDefined();
			expect( dock?.added ).toEqual( [ 'jorvy' ] );
			expect( dock?.removed ).toEqual( [ 'plugins' ] );
		} );

		test( 'no event when ids unchanged (idempotent re-apply)', () => {
			const { deps, config } = makeDeps();
			config.nativeWindows = [
				{ id: 'jorvy' },
			] as DesktopConfig[ 'nativeWindows' ];
			const apply = createApplyPayload( deps );
			const { events, cleanup } = captureEvents();

			apply( {
				dockItems: [ ...MIN_DOCK ],
				nativeWindows: [ { id: 'jorvy' } ],
			} );

			cleanup();
			expect(
				events.filter( ( e ) => e.registry === 'native-windows' ),
			).toHaveLength( 0 );
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
// as a tile on the unified dock the moment its row arrives in
// `dockItems`, and disappear the moment its row leaves.
describe( 'menu-refresh-apply.createApplyPayload — end-to-end with real Dock', () => {
	function buildShell(): {
		dockEl: HTMLElement;
		desktopArea: HTMLElement;
		dock: Dock;
		config: DesktopConfig;
	} {
		document.body.innerHTML = '';
		const desktopArea = document.createElement( 'div' );
		desktopArea.id = 'wp-desktop-area';
		const dockEl = document.createElement( 'div' );
		dockEl.id = 'wp-desktop-dock';
		document.body.append( desktopArea, dockEl );

		const manager = {
			open: vi.fn(),
			getById: () => null,
			getFocused: () => null,
			getAll: () => [],
			getCount: () => 0,
			getActiveDesktopId: () => 'desktop-1',
		} as unknown as WindowManager;

		const dock = new Dock( dockEl, manager, [], '/wp-admin/', 'bottom' );

		const config = {
			dockItems: [],
			adminUrl: '/wp-admin/',
		} as unknown as DesktopConfig;

		return { dockEl, desktopArea, dock, config };
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
		desktopArea: HTMLElement,
		config: DesktopConfig,
	): MenuRefreshDeps {
		const noop = (): Promise< void > => Promise.resolve();
		return {
			applyDockItems: ( items ) => dock.replaceItems( items ),
			desktopArea,
			config,
			syncNativeWindows: noop,
			syncServerWidgets: noop,
			syncServerWallpapers: noop,
			syncServerCommands: noop,
			syncServerSettingsTabs: noop,
			syncServerTitleBarButtons: noop,
			syncServerDockRailRenderers: noop,
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

	const dashboard = { id: 'index.php', title: 'Dashboard', icon: 'dashicons-dashboard', url: '/wp-admin/index.php', isCore: true } as const;
	const yoast = { id: 'wpseo_dashboard', title: 'Yoast SEO', icon: 'dashicons-yoast', url: '/wp-admin/admin.php?page=wpseo_dashboard', isCore: false } as const;
	const woo = { id: 'woocommerce', title: 'WooCommerce', icon: 'dashicons-store', url: '/wp-admin/admin.php?page=woocommerce', isCore: false } as const;

	test( 'activation: a plugin top-level menu appears on the dock live', () => {
		const { dock, dockEl, desktopArea, config } = buildShell();
		const apply = createApplyPayload(
			makeNoopDeps( dock, desktopArea, config ),
		);

		apply( { dockItems: [ dashboard ] } );
		expect( tilesIn( dockEl, 'menu-slug' ) ).toEqual( [ 'index.php' ] );

		// Activate Yoast — bridge re-broadcasts with the new top-level
		// menu now appended to `dockItems`.
		apply( { dockItems: [ dashboard, yoast ] } );

		expect( tilesIn( dockEl, 'menu-slug' ).sort() ).toEqual( [
			'index.php',
			'wpseo_dashboard',
		] );
	} );

	test( 'activation/deactivation cycle: live dock tracks every step', () => {
		const { dock, dockEl, desktopArea, config } = buildShell();
		const apply = createApplyPayload(
			makeNoopDeps( dock, desktopArea, config ),
		);

		apply( { dockItems: [ dashboard ] } );
		apply( { dockItems: [ dashboard, yoast ] } );
		expect( tilesIn( dockEl, 'menu-slug' ).sort() ).toEqual( [
			'index.php',
			'wpseo_dashboard',
		] );

		apply( { dockItems: [ dashboard, yoast, woo ] } );
		expect( tilesIn( dockEl, 'menu-slug' ).sort() ).toEqual( [
			'index.php',
			'woocommerce',
			'wpseo_dashboard',
		] );

		apply( { dockItems: [ dashboard, woo ] } );
		expect( tilesIn( dockEl, 'menu-slug' ).sort() ).toEqual( [
			'index.php',
			'woocommerce',
		] );

		apply( { dockItems: [ dashboard ] } );
		expect( tilesIn( dockEl, 'menu-slug' ) ).toEqual( [ 'index.php' ] );
	} );

	test( 'system tiles survive a menu-derived replaceItems', () => {
		// The dock carries TWO kinds of tiles: menu-derived (`dockItems`,
		// removed/added wholesale via `replaceItems`) and JS-registered
		// system tiles (`appendSystemItem`, e.g. the OS Settings tile or
		// a plugin-registered native-window launcher). A live menu
		// refresh MUST NOT collateral-damage the system tiles.
		const { dock, dockEl, desktopArea, config } = buildShell();
		const apply = createApplyPayload(
			makeNoopDeps( dock, desktopArea, config ),
		);

		dock.appendSystemItem( {
			id: 'calculator',
			title: 'Calculator',
			icon: 'dashicons-calculator',
			isOpen: () => false,
			onOpen: () => {},
		} );
		expect( tilesIn( dockEl, 'system-id' ) ).toEqual( [ 'calculator' ] );

		apply( { dockItems: [ dashboard, yoast ] } );

		expect( tilesIn( dockEl, 'menu-slug' ).sort() ).toEqual( [
			'index.php',
			'wpseo_dashboard',
		] );
		expect( tilesIn( dockEl, 'system-id' ) ).toEqual( [ 'calculator' ] );

		apply( { dockItems: [ dashboard ] } );
		expect( tilesIn( dockEl, 'menu-slug' ) ).toEqual( [ 'index.php' ] );
		expect( tilesIn( dockEl, 'system-id' ) ).toEqual( [ 'calculator' ] );
	} );
} );
