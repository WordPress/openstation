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
		windowActions: ReturnType< typeof vi.fn >;
		games: ReturnType< typeof vi.fn >;
	};
	renderIcons: ReturnType< typeof vi.fn >;
	syncShortcuts: ReturnType< typeof vi.fn >;
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
		windowActions: vi.fn().mockResolvedValue( undefined ),
		dockRailRenderers: vi.fn().mockResolvedValue( undefined ),
		games: vi.fn().mockResolvedValue( undefined ),
	};
	const renderIcons = vi.fn();
	const syncShortcuts = vi.fn();

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
		syncServerWindowActions: syncs.windowActions,
		syncServerDockRailRenderers: syncs.dockRailRenderers,
		syncServerGames: syncs.games,
		renderIcons,
		syncShortcuts,
		...overrides,
	};
	return { deps, dock, desktopArea, config, syncs, renderIcons, syncShortcuts };
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
		const { deps, dock, syncs, renderIcons, syncShortcuts } = makeDeps();
		const apply = createApplyPayload( deps );

		apply( {} );
		apply( { dockItems: [] } );

		expect( dock.replaceItems ).not.toHaveBeenCalled();
		expect( syncs.nativeWindows ).not.toHaveBeenCalled();
		expect( renderIcons ).not.toHaveBeenCalled();
		expect( syncShortcuts ).not.toHaveBeenCalled();
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

	test( 'an icon the bridge harvested survives the refresh probe’s gear placeholder', () => {
		const { deps, dock } = makeDeps();
		const apply = createApplyPayload( deps );
		const url = 'http://localhost/wp-admin/admin.php?page=elementor-home';
		const harvested = 'url("data:image/svg+xml;base64,PHN2Zy8+")';

		apply( { dockItems: [ ...MIN_DOCK, { id: 'elementor', title: 'Elementor', url, icon: harvested } ] } );
		apply( { dockItems: [ ...MIN_DOCK, { id: 'elementor', title: 'Elementor', url, icon: 'dashicons-admin-generic' } ] } );

		const applied = dock.replaceItems.mock.calls[ 1 ][ 0 ] as Array< { id: string; icon?: string } >;
		expect( applied.find( ( item ) => item.id === 'elementor' )?.icon ).toBe( harvested );
	} );

	test( 'syncShortcuts runs after a fresh dockItems array is applied', () => {
		const { deps, dock, syncShortcuts } = makeDeps();
		const apply = createApplyPayload( deps );

		apply( { dockItems: [ ...MIN_DOCK ] } );

		expect( syncShortcuts ).toHaveBeenCalledTimes( 1 );
		expect( dock.replaceItems ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'syncShortcuts is optional — omitting it does not throw', () => {
		const { deps } = makeDeps( { syncShortcuts: undefined } );
		const apply = createApplyPayload( deps );

		expect( () => apply( { dockItems: [ ...MIN_DOCK ] } ) ).not.toThrow();
	} );

	test( 'forwards every server-* array to its dedicated sync', () => {
		const { deps, syncs, config } = makeDeps();
		const apply = createApplyPayload( deps );

		const nativeWindows = [ { id: 'calc' } ];
		const scriptData = {
			'os-calc': { url: 'https://example.test/calc.js' },
		};
		const widgets = [ { id: 'clock' } ];
		const wallpapers = [ { id: 'starfield' } ];
		const cmdScripts = [ { handle: 'p-a', scriptUrl: 'a.js' } ];
		const cmds = [ { id: 'cmd1' } ];
		const tabScripts = [ { handle: 'p-b', scriptUrl: 'b.js' } ];
		const tabs = [ { id: 'tab1' } ];
		const titleScripts = [ { handle: 'p-c', scriptUrl: 'c.js' } ];
		const games = [ { id: 'inkfall' } ];

		apply( {
			dockItems: [ ...MIN_DOCK ],
			nativeWindows,
			nativeWindowScriptData: scriptData,
			serverWidgets: widgets,
			serverWallpapers: wallpapers,
			serverCommandScripts: cmdScripts,
			serverCommands: cmds,
			serverSettingsTabScripts: tabScripts,
			serverSettingsTabs: tabs,
			serverTitleBarButtonScripts: titleScripts,
			serverGames: games,
		} );

		expect( syncs.nativeWindows ).toHaveBeenCalledWith( [
			expect.objectContaining( { id: 'calc', scriptUrl: '' } ),
		] );

		expect( config.nativeWindowScriptData ).toEqual( scriptData );
		expect( syncs.widgets ).toHaveBeenCalledWith( widgets );
		expect( syncs.wallpapers ).toHaveBeenCalledWith( wallpapers );
		expect( syncs.commands ).toHaveBeenCalledWith( cmdScripts, cmds );
		expect( syncs.settingsTabs ).toHaveBeenCalledWith( tabScripts, tabs );
		expect( syncs.titleBarButtons ).toHaveBeenCalledWith( titleScripts );
		expect( syncs.games ).toHaveBeenCalledWith( games );
	} );

	test( 'serverGames payload updates config.serverGames', () => {
		const { deps, syncs, config } = makeDeps();
		const apply = createApplyPayload( deps );
		const games = [ { id: 'inkfall' } ];

		apply( { dockItems: [ ...MIN_DOCK ], serverGames: games } );

		expect( syncs.games ).toHaveBeenCalledWith( games );
		expect( config.serverGames ).toEqual( games );

		syncs.games.mockClear();
		apply( { dockItems: [ ...MIN_DOCK ] } );
		expect( syncs.games ).not.toHaveBeenCalled();
		expect( config.serverGames ).toEqual( games );
	} );

	describe( 'the multisite block', () => {
		const block = {
			isNetworkAdmin: false,
			networkAdmin: null,
			current: '1',
			sites: [ { id: '1', name: 'Main', shellUrl: 'http://example.test/wp-admin/admin.php?page=openstation', kind: 'local' as const } ],
		};

		test( 'a payload carrying it hands it on; null says the shell has no network', () => {
			const applyMultisite = vi.fn();
			const { deps } = makeDeps( { applyMultisite } );
			const apply = createApplyPayload( deps );

			apply( { dockItems: [ ...MIN_DOCK ], multisite: block } );
			expect( applyMultisite ).toHaveBeenCalledWith( block );

			apply( { dockItems: [ ...MIN_DOCK ], multisite: null } );
			expect( applyMultisite ).toHaveBeenLastCalledWith( null );
		} );

		test( 'an older payload without the key means no change', () => {
			const applyMultisite = vi.fn();
			const { deps } = makeDeps( { applyMultisite } );
			createApplyPayload( deps )( { dockItems: [ ...MIN_DOCK ] } );
			expect( applyMultisite ).not.toHaveBeenCalled();
		} );
	} );

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

			config.desktopIcons = [
				{ id: 'jorvy', title: 'Jorvy', icon: 'dashicons-star-filled' },
			] as DesktopConfig[ 'desktopIcons' ];
			const apply = createApplyPayload( deps );

			apply( { dockItems: [ ...MIN_DOCK ], desktopIcons: [] } );

			expect( renderIcons ).toHaveBeenCalledTimes( 1 );
			expect( renderIcons ).toHaveBeenCalledWith( [] );
			expect( config.desktopIcons ).toEqual( [] );
		} );

		test( 'the dispatcher and the files-layer sync both learn about new icons', () => {

			const calls: string[] = [];
			const applyDesktopIcons = vi.fn( () => {
				calls.push( 'applyDesktopIcons' );
			} );
			const { deps, syncShortcuts } = makeDeps( { applyDesktopIcons } );
			syncShortcuts.mockImplementation( () => {
				calls.push( 'syncShortcuts' );
			} );
			const apply = createApplyPayload( deps );

			const icons = [
				{ id: 'jorvy', title: 'Jorvy', icon: 'dashicons-star-filled' },
			];
			apply( { dockItems: [ ...MIN_DOCK ], desktopIcons: icons } );

			expect( applyDesktopIcons ).toHaveBeenCalledWith( icons );

			expect( calls[ calls.length - 1 ] ).toBe( 'syncShortcuts' );
			expect(
				calls.indexOf( 'applyDesktopIcons' ),
			).toBeLessThan( calls.lastIndexOf( 'syncShortcuts' ) );
		} );

		test( 'a changed icon id-set triggers the root-placements refetch', () => {

			const refreshRootPlacements = vi.fn();
			const { deps, config } = makeDeps( { refreshRootPlacements } );
			const apply = createApplyPayload( deps );

			apply( {
				dockItems: [ ...MIN_DOCK ],
				desktopIcons: [
					{ id: 'jorvy', title: 'Jorvy', icon: 'dashicons-star-filled' },
				],
			} );
			expect( refreshRootPlacements ).toHaveBeenCalledTimes( 1 );

			expect( refreshRootPlacements ).toHaveBeenLastCalledWith( [ 'jorvy' ] );

			apply( {
				dockItems: [ ...MIN_DOCK ],
				desktopIcons: [
					{ id: 'jorvy', title: 'Jorvy', icon: 'dashicons-star-filled' },
				],
			} );
			expect( refreshRootPlacements ).toHaveBeenCalledTimes( 1 );

			apply( { dockItems: [ ...MIN_DOCK ], desktopIcons: [] } );
			expect( refreshRootPlacements ).toHaveBeenCalledTimes( 2 );
			expect( refreshRootPlacements ).toHaveBeenLastCalledWith( [] );
			expect( config.desktopIcons ).toEqual( [] );
		} );

		test( 'applyDesktopIcons is optional — omitting it does not throw', () => {
			const { deps } = makeDeps( { applyDesktopIcons: undefined } );
			const apply = createApplyPayload( deps );
			expect( () =>
				apply( {
					dockItems: [ ...MIN_DOCK ],
					desktopIcons: [
						{ id: 'x', title: 'X', icon: 'dashicons-star-filled' },
					],
				} ),
			).not.toThrow();
		} );

		test( 'missing key: leaves prior icon state untouched', () => {
			const { deps, renderIcons, config } = makeDeps();
			const prior = [
				{ id: 'jorvy', title: 'Jorvy', icon: 'dashicons-star-filled' },
			];
			config.desktopIcons = prior as DesktopConfig[ 'desktopIcons' ];
			const apply = createApplyPayload( deps );

			apply( { dockItems: [ ...MIN_DOCK ] } );

			expect( renderIcons ).not.toHaveBeenCalled();
			expect( config.desktopIcons ).toBe( prior );
		} );
	} );

	describe( 'os-registry-changed CustomEvent', () => {
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

	describe( 'updateCounts live-refresh (GH#296)', () => {
		test( 'fresh counts repaint #wp-admin-bar-updates; zero hides it', () => {
			document.body.innerHTML = `
				<ul id="wp-admin-bar-root-default">
					<li id="wp-admin-bar-updates">
						<a class="ab-item" href="https://example.test/wp-admin/update-core.php">
							<span class="ab-icon" aria-hidden="true"></span>
							<span class="ab-label" aria-hidden="true">3</span>
							<span class="screen-reader-text updates-available-text">3 updates available</span>
						</a>
					</li>
				</ul>
			`;
			const { deps } = makeDeps();
			const apply = createApplyPayload( deps );

			apply( {
				dockItems: [ ...MIN_DOCK ],
				updateCounts: {
					total: 0,
					formatted: '0',
					text: '0 updates available',
					url: 'https://example.test/wp-admin/update-core.php',
				},
			} );

			const node = document.getElementById( 'wp-admin-bar-updates' )!;
			expect( node.style.display ).toBe( 'none' );
			document.body.innerHTML = '';
		} );

		test( 'missing key (older bridge): leaves the node untouched', () => {
			document.body.innerHTML = `
				<ul id="wp-admin-bar-root-default">
					<li id="wp-admin-bar-updates">
						<a class="ab-item" href="#"><span class="ab-label">3</span></a>
					</li>
				</ul>
			`;
			const { deps } = makeDeps();
			const apply = createApplyPayload( deps );

			apply( { dockItems: [ ...MIN_DOCK ] } );

			const node = document.getElementById( 'wp-admin-bar-updates' )!;
			expect( node.style.display ).not.toBe( 'none' );
			expect( node.querySelector( '.ab-label' )?.textContent ).toBe( '3' );
			document.body.innerHTML = '';
		} );
	} );

	test( 'serverTitleBarButtonScripts: live-refresh contract', () => {

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

	test( 'serverWindowActionScripts: live-refresh contract', () => {

		const { deps, syncs, config } = makeDeps();
		const apply = createApplyPayload( deps );

		const scripts = [ { handle: 'plugin-e', scriptUrl: 'e.js' } ];
		apply( {
			dockItems: [ ...MIN_DOCK ],
			serverWindowActionScripts: scripts,
		} );

		expect( syncs.windowActions ).toHaveBeenCalledWith( scripts );
		expect( config.serverWindowActionScripts ).toBe( scripts );
	} );
} );

describe( 'menu-refresh-apply.createApplyPayload — end-to-end with real Dock', () => {
	function buildShell(): {
		dockEl: HTMLElement;
		desktopArea: HTMLElement;
		dock: Dock;
		config: DesktopConfig;
	} {
		document.body.innerHTML = '';
		const desktopArea = document.createElement( 'div' );
		desktopArea.id = 'os-area';
		const dockEl = document.createElement( 'div' );
		dockEl.id = 'os-dock';
		document.body.append( desktopArea, dockEl );

		const manager = {
			open: vi.fn(),
			getById: () => null,
			getFocused: () => null,
			getAll: () => [],
			getAllByBaseId: () => [],
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
