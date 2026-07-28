/**
 * Tests for `src/desktop-layout.ts` — the layout dispatcher that owns
 * the `Dock` instance(s) and the synthesized desktop icons across
 * Classic / Unified / Spatial.
 *
 * Pins down the user-visible shape of each layout:
 *
 * - Classic: TWO docks. Left side bar (id `#desktop-mode-side-dock`,
 *   `data-desktop-mode-dock-placement="left"`) holds `isCore` items;
 *   bottom dock (existing `#desktop-mode-dock`,
 *   `data-desktop-mode-dock-placement="bottom"`) holds the rest.
 * - Unified: ONE dock at the bottom; every menu item lives there.
 * - Spatial: ONE dock at the bottom with non-core items; core items
 *   are synthesized into the desktop-icons list and pushed through
 *   `renderIcons`. Server-registered icons are PRESERVED and concatenated
 *   ahead of synthesized ones so plugin icons aren't shadowed.
 *
 * Also pins layout transitions: switching layouts tears down the old
 * docks (no leaked DOM, no leaked side-dock element on switch away
 * from Classic) and emits a `desktop-mode-layout-changed` event so
 * plugins that cache `wp.desktop.dock` can refresh their reference.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createLayoutDispatcher } from '../../src/desktop-layout';
import { type DockItem, type SystemDockItem } from '../../src/dock';
import {
	_resetDockRailRenderersForTests,
	installDefaultDockRailRenderer,
} from '../../src/dock-rail';
import { installHooksStub, clearHooksStub } from './helpers/hooks-stub';
import type { WindowManager } from '../../src/window-manager';
import type { DesktopIconServerEntry } from '../../src/types';

function makeManagerStub(): WindowManager {
	return {
		getFocused: () => null,
		getAllByBaseId: () => [],
		getAll: () => [],
		getById: () => undefined,
		getActiveDesktopId: () => 'default-1',
	} as unknown as WindowManager;
}

function makeItem( overrides: Partial< DockItem > = {} ): DockItem {
	return {
		id: 'item',
		title: 'Item',
		icon: 'dashicons-admin-generic',
		url: 'http://localhost/wp-admin/admin.php?page=item',
		badge: 0,
		submenu: [],
		multi: false,
		isCore: false,
		...overrides,
	};
}

const dashboard = makeItem( {
	id: 'index.php',
	title: 'Dashboard',
	url: '/wp-admin/index.php',
	isCore: true,
} );
const posts = makeItem( {
	id: 'edit.php',
	title: 'Posts',
	url: '/wp-admin/edit.php',
	isCore: true,
} );
const yoast = makeItem( {
	id: 'wpseo_dashboard',
	title: 'Yoast SEO',
	url: '/wp-admin/admin.php?page=wpseo_dashboard',
	isCore: false,
} );
const woo = makeItem( {
	id: 'woocommerce',
	title: 'WooCommerce',
	url: '/wp-admin/admin.php?page=woocommerce',
	isCore: false,
} );

const noopTile: SystemDockItem = {
	id: 'desktop-mode-os-settings',
	title: 'OS Settings',
	icon: 'dashicons-desktop',
	onOpen: () => {},
};

function setupShell(): {
	shellRoot: HTMLElement;
	shellBody: HTMLElement;
	bottomDockEl: HTMLElement;
	desktopArea: HTMLElement;
} {
	document.body.innerHTML = '';
	const shellRoot = document.createElement( 'div' );
	shellRoot.id = 'desktop-mode-shell';
	shellRoot.className = 'desktop-mode-shell';

	const shellBody = document.createElement( 'div' );
	shellBody.className = 'desktop-mode-shell__body';
	shellRoot.appendChild( shellBody );

	const bottomDockEl = document.createElement( 'nav' );
	bottomDockEl.id = 'desktop-mode-dock';
	bottomDockEl.className = 'desktop-mode-dock';
	shellBody.appendChild( bottomDockEl );

	const desktopArea = document.createElement( 'div' );
	desktopArea.id = 'desktop-mode-area';
	shellBody.appendChild( desktopArea );

	document.body.appendChild( shellRoot );
	return { shellRoot, shellBody, bottomDockEl, desktopArea };
}

function makeDeps(
	overrides: Partial< Parameters< typeof createLayoutDispatcher >[ 0 ] > = {},
): {
	deps: Parameters< typeof createLayoutDispatcher >[ 0 ];
	renderIcons: ReturnType< typeof vi.fn >;
	shell: ReturnType< typeof setupShell >;
} {
	const shell = setupShell();
	const renderIcons = vi.fn();
	const deps: Parameters< typeof createLayoutDispatcher >[ 0 ] = {
		shellRoot: shell.shellRoot,
		shellBody: shell.shellBody,
		bottomDockEl: shell.bottomDockEl,
		desktopArea: shell.desktopArea,
		windowManager: makeManagerStub(),
		adminUrl: '/wp-admin/',
		renderIcons,
		...overrides,
	};
	return { deps, renderIcons, shell };
}

describe( 'desktop-layout dispatcher', () => {
	beforeEach( () => {
		installHooksStub();
		_resetDockRailRenderersForTests();
		installDefaultDockRailRenderer();
	} );
	afterEach( () => {
		clearHooksStub();
		_resetDockRailRenderersForTests();
		document.body.innerHTML = '';
	} );

	test( 'writes data-desktop-mode-layout to the shell root on init', () => {
		const { deps, shell } = makeDeps();
		createLayoutDispatcher( deps, 'unified', [ dashboard ], [] );
		expect(
			shell.shellRoot.getAttribute( 'data-desktop-mode-layout' ),
		).toBe( 'unified' );
	} );

	test( 'classic: creates two docks (side + bottom) with correct placements', () => {
		const { deps } = makeDeps();
		createLayoutDispatcher(
			deps,
			'classic',
			[ dashboard, posts, yoast, woo ],
			[],
		);
		const sideDock = document.getElementById( 'desktop-mode-side-dock' );
		expect( sideDock ).not.toBeNull();
		expect(
			sideDock?.getAttribute( 'data-desktop-mode-dock-placement' ),
		).toBe( 'left' );
		expect( sideDock?.classList.contains( 'desktop-mode-dock' ) ).toBe(
			true,
		);

		const bottomDock = document.getElementById( 'desktop-mode-dock' );
		expect(
			bottomDock?.getAttribute( 'data-desktop-mode-dock-placement' ),
		).toBe( 'bottom' );
	} );

	test( 'classic: routes core items to side dock, plugin items to bottom dock', () => {
		const { deps } = makeDeps();
		createLayoutDispatcher(
			deps,
			'classic',
			[ dashboard, posts, yoast, woo ],
			[],
		);

		const sideTiles = Array.from(
			document
				.getElementById( 'desktop-mode-side-dock' )!
				.querySelectorAll( '[data-menu-slug]' ),
		).map( ( el ) => ( el as HTMLElement ).dataset.menuSlug );
		expect( sideTiles ).toEqual(
			expect.arrayContaining( [ 'index.php', 'edit.php' ] ),
		);

		const bottomTiles = Array.from(
			document
				.getElementById( 'desktop-mode-dock' )!
				.querySelectorAll( '[data-menu-slug]' ),
		).map( ( el ) => ( el as HTMLElement ).dataset.menuSlug );
		expect( bottomTiles ).toEqual(
			expect.arrayContaining( [ 'wpseo_dashboard', 'woocommerce' ] ),
		);
		expect( bottomTiles ).not.toContain( 'index.php' );
	} );

	test( 'unified: single bottom dock holds every item, no side dock element', () => {
		const { deps } = makeDeps();
		createLayoutDispatcher(
			deps,
			'unified',
			[ dashboard, posts, yoast, woo ],
			[],
		);
		expect( document.getElementById( 'desktop-mode-side-dock' ) ).toBeNull();

		const bottomTiles = Array.from(
			document
				.getElementById( 'desktop-mode-dock' )!
				.querySelectorAll( '[data-menu-slug]' ),
		).map( ( el ) => ( el as HTMLElement ).dataset.menuSlug );
		expect( bottomTiles ).toEqual(
			expect.arrayContaining( [
				'index.php',
				'edit.php',
				'wpseo_dashboard',
				'woocommerce',
			] ),
		);
	} );

	test( 'spatial: bottom dock holds plugin items only, no side dock element', () => {
		const { deps } = makeDeps();
		createLayoutDispatcher(
			deps,
			'spatial',
			[ dashboard, posts, yoast, woo ],
			[],
		);
		expect( document.getElementById( 'desktop-mode-side-dock' ) ).toBeNull();

		const bottomTiles = Array.from(
			document
				.getElementById( 'desktop-mode-dock' )!
				.querySelectorAll( '[data-menu-slug]' ),
		).map( ( el ) => ( el as HTMLElement ).dataset.menuSlug );
		expect( bottomTiles ).toEqual(
			expect.arrayContaining( [ 'wpseo_dashboard', 'woocommerce' ] ),
		);
		expect( bottomTiles ).not.toContain( 'index.php' );
		expect( bottomTiles ).not.toContain( 'edit.php' );
	} );

	test( 'spatial: drops non-pinned server icons without an override', () => {
		const { deps, renderIcons } = makeDeps();
		const serverIcons: DesktopIconServerEntry[] = [
			{
				id: 'plugin:icon',
				title: 'Plugin',
				icon: 'dashicons-admin-plugins',
				window: 'plugin-window',
				url: '',
				position: 50,
			},
		];
		createLayoutDispatcher(
			deps,
			'spatial',
			[ dashboard, posts, yoast, woo ],
			serverIcons,
		);

		expect( renderIcons ).toHaveBeenCalled();
		const lastCall = renderIcons.mock.calls.at( -1 )![ 0 ];
		const ids = ( lastCall as DesktopIconServerEntry[] ).map(
			( i ) => i.id,
		);
		// Plugin icons with no explicit placement override stay
		// suppressed in Spatial — the wallpaper is the "core surface,"
		// and their admin menu lives in the bottom dock. Doubling them
		// up on the wallpaper was the original user-reported bug.
		expect( ids ).toEqual( [
			'dock-core:index.php',
			'dock-core:edit.php',
		] );
	} );

	test( 'spatial: keeps pinned server icons (e.g. My WordPress)', () => {
		const { deps, renderIcons } = makeDeps();
		const serverIcons: DesktopIconServerEntry[] = [
			{
				id: 'desktop-mode-my-wordpress',
				title: 'My WordPress',
				icon: 'dashicons-wordpress',
				window: 'desktop-mode-my-wordpress',
				url: '',
				position: -1,
				pinned: true,
			},
		];
		createLayoutDispatcher(
			deps,
			'spatial',
			[ dashboard, posts ],
			serverIcons,
		);

		const ids = (
			renderIcons.mock.calls.at( -1 )![ 0 ] as DesktopIconServerEntry[]
		).map( ( i ) => i.id );
		// Regression guard: a framework-owned pinned icon must survive
		// the Spatial layout. Suppressing it made My WordPress vanish
		// from the wallpaper on installs using Spatial.
		expect( ids ).toContain( 'desktop-mode-my-wordpress' );
	} );

	test( 'spatial: keeps server icons the user explicitly promoted to the desktop', () => {
		const { deps, renderIcons } = makeDeps( {
			getSettings: () => ( {
				itemVisibility: { 'plugin-icon': 'desktop' },
				dockOrder: [],
			} ),
		} );
		const serverIcons: DesktopIconServerEntry[] = [
			{
				id: 'plugin-icon',
				title: 'Plugin',
				icon: 'dashicons-admin-plugins',
				window: 'plugin-window',
				url: '',
				position: 50,
			},
		];
		createLayoutDispatcher(
			deps,
			'spatial',
			[ dashboard, posts ],
			serverIcons,
		);

		const ids = (
			renderIcons.mock.calls.at( -1 )![ 0 ] as DesktopIconServerEntry[]
		).map( ( i ) => i.id );
		// The OS Settings → Apps & Icons "On the desktop" choice must
		// not silently no-op in Spatial.
		expect( ids ).toContain( 'plugin-icon' );
	} );

	test( 'classic + unified: renderIcons gets only the server list (no synthesis)', () => {
		const { deps, renderIcons } = makeDeps();
		const serverIcons: DesktopIconServerEntry[] = [
			{
				id: 'plugin:icon',
				title: 'Plugin',
				icon: 'dashicons-admin-plugins',
				window: 'plugin-window',
				url: '',
				position: 50,
			},
		];
		createLayoutDispatcher(
			deps,
			'classic',
			[ dashboard, posts, yoast ],
			serverIcons,
		);
		const lastCall = renderIcons.mock.calls.at( -1 )![ 0 ];
		expect(
			( lastCall as DesktopIconServerEntry[] ).map( ( i ) => i.id ),
		).toEqual( [ 'plugin:icon' ] );
	} );

	test( 'setLayout: classic → unified tears down side dock', () => {
		const { deps } = makeDeps();
		const dispatcher = createLayoutDispatcher(
			deps,
			'classic',
			[ dashboard, yoast ],
			[],
		);
		expect(
			document.getElementById( 'desktop-mode-side-dock' ),
		).not.toBeNull();
		dispatcher.setLayout( 'unified' );
		expect( document.getElementById( 'desktop-mode-side-dock' ) ).toBeNull();
		expect( dispatcher.getSide() ).toBeNull();
		expect( dispatcher.getPrimary() ).not.toBeNull();
		expect( dispatcher.getLayout() ).toBe( 'unified' );
	} );

	test( 'setLayout: unified → classic creates side dock', () => {
		const { deps } = makeDeps();
		const dispatcher = createLayoutDispatcher(
			deps,
			'unified',
			[ dashboard, yoast ],
			[],
		);
		expect( document.getElementById( 'desktop-mode-side-dock' ) ).toBeNull();
		dispatcher.setLayout( 'classic' );
		expect(
			document.getElementById( 'desktop-mode-side-dock' ),
		).not.toBeNull();
		expect( dispatcher.getSide() ).not.toBeNull();
	} );

	test( 'setLayout: same value is a no-op (no event, no rebuild)', () => {
		const { deps } = makeDeps();
		const dispatcher = createLayoutDispatcher(
			deps,
			'classic',
			[ dashboard, yoast ],
			[],
		);
		const events = vi.fn();
		document.addEventListener( 'desktop-mode-layout-changed', events );
		const sideBefore = dispatcher.getSide();
		dispatcher.setLayout( 'classic' );
		expect( events ).not.toHaveBeenCalled();
		expect( dispatcher.getSide() ).toBe( sideBefore );
		document.removeEventListener( 'desktop-mode-layout-changed', events );
	} );

	test( 'setLayout: emits desktop-mode-layout-changed with new primary/side', () => {
		const { deps } = makeDeps();
		const dispatcher = createLayoutDispatcher(
			deps,
			'unified',
			[ dashboard, yoast ],
			[],
		);
		let detail: { layout: string; primary: unknown; side: unknown } | null = null;
		document.addEventListener(
			'desktop-mode-layout-changed',
			( e ) => {
				detail = ( e as CustomEvent ).detail;
			},
			{ once: true },
		);
		dispatcher.setLayout( 'classic' );
		expect( detail ).not.toBeNull();
		expect( detail!.layout ).toBe( 'classic' );
		expect( detail!.primary ).toBe( dispatcher.getPrimary() );
		expect( detail!.side ).toBe( dispatcher.getSide() );
	} );

	test( 'applyDockItems: classic re-routes a fresh list to the right rails', () => {
		const { deps } = makeDeps();
		const dispatcher = createLayoutDispatcher(
			deps,
			'classic',
			[ dashboard, yoast ],
			[],
		);
		dispatcher.applyDockItems( [ posts, woo ] );

		const sideTiles = Array.from(
			document
				.getElementById( 'desktop-mode-side-dock' )!
				.querySelectorAll( '[data-menu-slug]' ),
		).map( ( el ) => ( el as HTMLElement ).dataset.menuSlug );
		expect( sideTiles ).toEqual( [ 'edit.php' ] );

		const bottomTiles = Array.from(
			document
				.getElementById( 'desktop-mode-dock' )!
				.querySelectorAll( '[data-menu-slug]' ),
		).map( ( el ) => ( el as HTMLElement ).dataset.menuSlug );
		expect( bottomTiles ).toEqual( [ 'woocommerce' ] );
	} );

	test( 'applyDesktopIcons: spatial ignores server icons, keeps synthesized core only', () => {
		const { deps, renderIcons } = makeDeps();
		const dispatcher = createLayoutDispatcher(
			deps,
			'spatial',
			[ dashboard, yoast ],
			[],
		);
		renderIcons.mockClear();

		const updatedServerIcons: DesktopIconServerEntry[] = [
			{
				id: 'plugin:newer',
				title: 'Newer Plugin',
				icon: 'dashicons-admin-plugins',
				window: 'newer',
				url: '',
				position: 80,
			},
		];
		dispatcher.applyDesktopIcons( updatedServerIcons );

		expect( renderIcons ).toHaveBeenCalledTimes( 1 );
		const lastCall = renderIcons.mock.calls.at( -1 )![ 0 ];
		const ids = ( lastCall as DesktopIconServerEntry[] ).map(
			( i ) => i.id,
		);
		// Updated server icons stored but suppressed in Spatial — only
		// the synthesized core menu icon is on the wallpaper. Switching
		// to a layout that includes server icons would surface them.
		expect( ids ).toEqual( [ 'dock-core:index.php' ] );
	} );

	test( 'appendSystemTile: core affinity lands on the side dock in classic', () => {
		const { deps } = makeDeps();
		const dispatcher = createLayoutDispatcher(
			deps,
			'classic',
			[ dashboard, yoast ],
			[],
		);
		dispatcher.appendSystemTile( noopTile, 'core' );
		expect(
			document
				.getElementById( 'desktop-mode-side-dock' )!
				.querySelector( `[data-system-id="${ noopTile.id }"]` ),
		).not.toBeNull();
		expect(
			document
				.getElementById( 'desktop-mode-dock' )!
				.querySelector( `[data-system-id="${ noopTile.id }"]` ),
		).toBeNull();
	} );

	test( 'appendSystemTile: core affinity falls back to primary in unified', () => {
		const { deps } = makeDeps();
		const dispatcher = createLayoutDispatcher(
			deps,
			'unified',
			[ dashboard, yoast ],
			[],
		);
		dispatcher.appendSystemTile( noopTile, 'core' );
		expect(
			document
				.getElementById( 'desktop-mode-dock' )!
				.querySelector( `[data-system-id="${ noopTile.id }"]` ),
		).not.toBeNull();
	} );

	test( 'appendSystemTile: core affinity falls back to primary in spatial', () => {
		const { deps } = makeDeps();
		const dispatcher = createLayoutDispatcher(
			deps,
			'spatial',
			[ dashboard, yoast ],
			[],
		);
		dispatcher.appendSystemTile( noopTile, 'core' );
		expect(
			document
				.getElementById( 'desktop-mode-dock' )!
				.querySelector( `[data-system-id="${ noopTile.id }"]` ),
		).not.toBeNull();
	} );

	test( 'appendSystemTile: plugin affinity (default) always goes to primary', () => {
		const { deps } = makeDeps();
		const dispatcher = createLayoutDispatcher(
			deps,
			'classic',
			[ dashboard, yoast ],
			[],
		);
		dispatcher.appendSystemTile( noopTile );
		expect(
			document
				.getElementById( 'desktop-mode-dock' )!
				.querySelector( `[data-system-id="${ noopTile.id }"]` ),
		).not.toBeNull();
		expect(
			document
				.getElementById( 'desktop-mode-side-dock' )!
				.querySelector( `[data-system-id="${ noopTile.id }"]` ),
		).toBeNull();
	} );

	test( 'core-affinity tile follows the layout: classic side → unified primary', () => {
		const { deps } = makeDeps();
		const dispatcher = createLayoutDispatcher(
			deps,
			'classic',
			[ dashboard, yoast ],
			[],
		);
		dispatcher.appendSystemTile( noopTile, 'core' );
		dispatcher.setLayout( 'unified' );
		// Side dock element is gone; tile should re-attach to the
		// rebuilt primary (bottom) dock since there's no side rail
		// in unified.
		expect(
			document.getElementById( 'desktop-mode-side-dock' ),
		).toBeNull();
		expect(
			document
				.getElementById( 'desktop-mode-dock' )!
				.querySelector( `[data-system-id="${ noopTile.id }"]` ),
		).not.toBeNull();
	} );

	test( 'appendSystemTile: tracked tiles survive a layout rebuild', () => {
		const { deps } = makeDeps();
		const dispatcher = createLayoutDispatcher(
			deps,
			'unified',
			[ dashboard, yoast ],
			[],
		);
		dispatcher.appendSystemTile( noopTile );
		expect(
			document
				.getElementById( 'desktop-mode-dock' )!
				.querySelector( `[data-system-id="${ noopTile.id }"]` ),
		).not.toBeNull();

		// Switch layout — the bottom dock is rebuilt; the tracked
		// system tile must re-attach to the new instance.
		dispatcher.setLayout( 'classic' );
		expect(
			document
				.getElementById( 'desktop-mode-dock' )!
				.querySelector( `[data-system-id="${ noopTile.id }"]` ),
		).not.toBeNull();
	} );

	test( 'removeSystemTile: drops the tile from tracking and from the live rail', () => {
		const { deps } = makeDeps();
		const dispatcher = createLayoutDispatcher(
			deps,
			'unified',
			[ dashboard, yoast ],
			[],
		);
		dispatcher.appendSystemTile( noopTile );
		dispatcher.removeSystemTile( noopTile.id );
		expect(
			document
				.getElementById( 'desktop-mode-dock' )!
				.querySelector( `[data-system-id="${ noopTile.id }"]` ),
		).toBeNull();

		// Layout rebuild must not resurrect the removed tile.
		dispatcher.setLayout( 'classic' );
		expect(
			document
				.getElementById( 'desktop-mode-dock' )!
				.querySelector( `[data-system-id="${ noopTile.id }"]` ),
		).toBeNull();
	} );

	// Regression tests for https://github.com/WordPress/desktop-mode/issues/405 —
	// native windows registered with `placement: 'dock'` (Games) land on
	// the rails as system tiles, which used to bypass the Apps & Icons
	// `itemVisibility` overrides entirely: hiding the item removed the
	// wallpaper icon but the dock tile stayed.
	describe( 'system tiles honor Apps & Icons visibility overrides', () => {
		const gamesTile: SystemDockItem = {
			id: 'desktop-mode-games',
			title: 'Games',
			icon: 'dashicons-games',
			onOpen: () => {},
		};
		const tileSelector = `[data-system-id="${ gamesTile.id }"]`;

		test( 'a pre-existing "hidden" override keeps the tile off the dock but tracked', () => {
			const { deps } = makeDeps( {
				getSettings: () => ( {
					itemVisibility: { 'desktop-mode-games': 'hidden' },
					dockOrder: [],
				} ),
			} );
			const dispatcher = createLayoutDispatcher(
				deps,
				'unified',
				[ dashboard, yoast ],
				[],
			);
			dispatcher.appendSystemTile( gamesTile );
			expect(
				document
					.getElementById( 'desktop-mode-dock' )!
					.querySelector( tileSelector ),
			).toBeNull();
			// Still tracked — flipping the setting back must restore it.
			expect(
				dispatcher.listSystemTiles().map( ( t ) => t.id ),
			).toContain( gamesTile.id );
		} );

		test( 'a "desktop"-only override also keeps the tile off the dock', () => {
			const { deps } = makeDeps( {
				getSettings: () => ( {
					itemVisibility: { 'desktop-mode-games': 'desktop' },
					dockOrder: [],
				} ),
			} );
			const dispatcher = createLayoutDispatcher(
				deps,
				'unified',
				[ dashboard, yoast ],
				[],
			);
			dispatcher.appendSystemTile( gamesTile );
			expect(
				document
					.getElementById( 'desktop-mode-dock' )!
					.querySelector( tileSelector ),
			).toBeNull();
		} );

		test( 'refresh() detaches a live tile on hide and re-attaches it on unhide', () => {
			const visibility: Record< string, 'both' | 'dock' | 'desktop' | 'hidden' > =
				{};
			const { deps } = makeDeps( {
				getSettings: () => ( { itemVisibility: visibility, dockOrder: [] } ),
			} );
			const dispatcher = createLayoutDispatcher(
				deps,
				'unified',
				[ dashboard, yoast ],
				[],
			);
			dispatcher.appendSystemTile( gamesTile );
			const dock = document.getElementById( 'desktop-mode-dock' )!;
			expect( dock.querySelector( tileSelector ) ).not.toBeNull();

			// User picks "Hidden" in OS Settings → Apps & Icons; the
			// settings subscription calls refresh().
			visibility[ 'desktop-mode-games' ] = 'hidden';
			dispatcher.refresh();
			expect( dock.querySelector( tileSelector ) ).toBeNull();

			// And back.
			visibility[ 'desktop-mode-games' ] = 'both';
			dispatcher.refresh();
			expect( dock.querySelector( tileSelector ) ).not.toBeNull();
		} );

		test( 'a layout rebuild does not resurrect a hidden tile', () => {
			const { deps } = makeDeps( {
				getSettings: () => ( {
					itemVisibility: { 'desktop-mode-games': 'hidden' },
					dockOrder: [],
				} ),
			} );
			const dispatcher = createLayoutDispatcher(
				deps,
				'unified',
				[ dashboard, yoast ],
				[],
			);
			dispatcher.appendSystemTile( gamesTile );
			dispatcher.setLayout( 'classic' );
			expect(
				document
					.getElementById( 'desktop-mode-dock' )!
					.querySelector( tileSelector ),
			).toBeNull();
		} );

		test( 'an override keyed by the desktop icon targeting the window hides the tile', () => {
			// The Apps & Icons tab keys its rows by icon id, which may
			// differ from the native-window id the tile is keyed by.
			const { deps } = makeDeps( {
				getSettings: () => ( {
					itemVisibility: { 'games-icon': 'hidden' },
					dockOrder: [],
				} ),
			} );
			const serverIcons: DesktopIconServerEntry[] = [
				{
					id: 'games-icon',
					title: 'Games',
					icon: 'dashicons-games',
					window: 'desktop-mode-games',
					url: '',
					position: 85,
				},
			];
			const dispatcher = createLayoutDispatcher(
				deps,
				'unified',
				[ dashboard, yoast ],
				serverIcons,
			);
			dispatcher.appendSystemTile( gamesTile );
			expect(
				document
					.getElementById( 'desktop-mode-dock' )!
					.querySelector( tileSelector ),
			).toBeNull();
		} );
	} );

	test( 'destroy: tears down both docks and removes the side dock element', () => {
		const { deps } = makeDeps();
		const dispatcher = createLayoutDispatcher(
			deps,
			'classic',
			[ dashboard, yoast ],
			[],
		);
		expect(
			document.getElementById( 'desktop-mode-side-dock' ),
		).not.toBeNull();
		dispatcher.destroy();
		expect( document.getElementById( 'desktop-mode-side-dock' ) ).toBeNull();
	} );
} );

describe( 'desktop-layout dispatcher — settings sanitization', () => {
	test( 'invalid desktopLayout in persisted state falls back to default', async () => {
		const stateModule = await import( '../../src/settings/state' );
		const constants = await import( '../../src/settings/constants' );
		// Drive `_parseRaw` via the public `loadState` path. Set the
		// global config so the server-snapshot branch fires.
		( window as unknown as { desktopModeConfig?: unknown } ).desktopModeConfig = {
			osSettings: {
				wallpaper: 'dark',
				accent: 'wp-blue',
				dockSize: 'default',
				desktopLayout: 'made-up-value',
			},
		};
		const state = stateModule.loadState();
		expect( state.desktopLayout ).toBe( constants.DEFAULTS.desktopLayout );
		( window as unknown as { desktopModeConfig?: unknown } ).desktopModeConfig =
			undefined;
	} );
} );
