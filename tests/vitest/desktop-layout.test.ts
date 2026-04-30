/**
 * Tests for `src/desktop-layout.ts` — the layout dispatcher that owns
 * the `Dock` instance(s) and the synthesized desktop icons across
 * Classic / Unified / Spatial.
 *
 * Pins down the user-visible shape of each layout:
 *
 * - Classic: TWO docks. Left side bar (id `#wp-desktop-side-dock`,
 *   `data-wp-desktop-dock-placement="left"`) holds `isCore` items;
 *   bottom dock (existing `#wp-desktop-dock`,
 *   `data-wp-desktop-dock-placement="bottom"`) holds the rest.
 * - Unified: ONE dock at the bottom; every menu item lives there.
 * - Spatial: ONE dock at the bottom with non-core items; core items
 *   are synthesized into the desktop-icons list and pushed through
 *   `renderIcons`. Server-registered icons are PRESERVED and concatenated
 *   ahead of synthesized ones so plugin icons aren't shadowed.
 *
 * Also pins layout transitions: switching layouts tears down the old
 * docks (no leaked DOM, no leaked side-dock element on switch away
 * from Classic) and emits a `wp-desktop-layout-changed` event so
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
	id: 'wp-desktop-os-settings',
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
	shellRoot.id = 'wp-desktop-shell';
	shellRoot.className = 'wp-desktop-shell';

	const shellBody = document.createElement( 'div' );
	shellBody.className = 'wp-desktop-shell__body';
	shellRoot.appendChild( shellBody );

	const bottomDockEl = document.createElement( 'nav' );
	bottomDockEl.id = 'wp-desktop-dock';
	bottomDockEl.className = 'wp-desktop-dock';
	shellBody.appendChild( bottomDockEl );

	const desktopArea = document.createElement( 'div' );
	desktopArea.id = 'wp-desktop-area';
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

	test( 'writes data-wp-desktop-layout to the shell root on init', () => {
		const { deps, shell } = makeDeps();
		createLayoutDispatcher( deps, 'unified', [ dashboard ], [] );
		expect(
			shell.shellRoot.getAttribute( 'data-wp-desktop-layout' ),
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
		const sideDock = document.getElementById( 'wp-desktop-side-dock' );
		expect( sideDock ).not.toBeNull();
		expect(
			sideDock?.getAttribute( 'data-wp-desktop-dock-placement' ),
		).toBe( 'left' );
		expect( sideDock?.classList.contains( 'wp-desktop-dock' ) ).toBe(
			true,
		);

		const bottomDock = document.getElementById( 'wp-desktop-dock' );
		expect(
			bottomDock?.getAttribute( 'data-wp-desktop-dock-placement' ),
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
				.getElementById( 'wp-desktop-side-dock' )!
				.querySelectorAll( '[data-menu-slug]' ),
		).map( ( el ) => ( el as HTMLElement ).dataset.menuSlug );
		expect( sideTiles ).toEqual(
			expect.arrayContaining( [ 'index.php', 'edit.php' ] ),
		);

		const bottomTiles = Array.from(
			document
				.getElementById( 'wp-desktop-dock' )!
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
		expect( document.getElementById( 'wp-desktop-side-dock' ) ).toBeNull();

		const bottomTiles = Array.from(
			document
				.getElementById( 'wp-desktop-dock' )!
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
		expect( document.getElementById( 'wp-desktop-side-dock' ) ).toBeNull();

		const bottomTiles = Array.from(
			document
				.getElementById( 'wp-desktop-dock' )!
				.querySelectorAll( '[data-menu-slug]' ),
		).map( ( el ) => ( el as HTMLElement ).dataset.menuSlug );
		expect( bottomTiles ).toEqual(
			expect.arrayContaining( [ 'wpseo_dashboard', 'woocommerce' ] ),
		);
		expect( bottomTiles ).not.toContain( 'index.php' );
		expect( bottomTiles ).not.toContain( 'edit.php' );
	} );

	test( 'spatial: renders only synthesized core icons, drops server icons', () => {
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
		// Server-registered plugin icons are deliberately suppressed
		// in Spatial — the wallpaper is the "core surface." Plugin
		// menus live in the bottom dock; doubling them up on the
		// wallpaper was the user-reported bug.
		expect( ids ).toEqual( [
			'dock-core:index.php',
			'dock-core:edit.php',
		] );
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
			document.getElementById( 'wp-desktop-side-dock' ),
		).not.toBeNull();
		dispatcher.setLayout( 'unified' );
		expect( document.getElementById( 'wp-desktop-side-dock' ) ).toBeNull();
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
		expect( document.getElementById( 'wp-desktop-side-dock' ) ).toBeNull();
		dispatcher.setLayout( 'classic' );
		expect(
			document.getElementById( 'wp-desktop-side-dock' ),
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
		document.addEventListener( 'wp-desktop-layout-changed', events );
		const sideBefore = dispatcher.getSide();
		dispatcher.setLayout( 'classic' );
		expect( events ).not.toHaveBeenCalled();
		expect( dispatcher.getSide() ).toBe( sideBefore );
		document.removeEventListener( 'wp-desktop-layout-changed', events );
	} );

	test( 'setLayout: emits wp-desktop-layout-changed with new primary/side', () => {
		const { deps } = makeDeps();
		const dispatcher = createLayoutDispatcher(
			deps,
			'unified',
			[ dashboard, yoast ],
			[],
		);
		let detail: { layout: string; primary: unknown; side: unknown } | null = null;
		document.addEventListener(
			'wp-desktop-layout-changed',
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
				.getElementById( 'wp-desktop-side-dock' )!
				.querySelectorAll( '[data-menu-slug]' ),
		).map( ( el ) => ( el as HTMLElement ).dataset.menuSlug );
		expect( sideTiles ).toEqual( [ 'edit.php' ] );

		const bottomTiles = Array.from(
			document
				.getElementById( 'wp-desktop-dock' )!
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
				.getElementById( 'wp-desktop-side-dock' )!
				.querySelector( `[data-system-id="${ noopTile.id }"]` ),
		).not.toBeNull();
		expect(
			document
				.getElementById( 'wp-desktop-dock' )!
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
				.getElementById( 'wp-desktop-dock' )!
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
				.getElementById( 'wp-desktop-dock' )!
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
				.getElementById( 'wp-desktop-dock' )!
				.querySelector( `[data-system-id="${ noopTile.id }"]` ),
		).not.toBeNull();
		expect(
			document
				.getElementById( 'wp-desktop-side-dock' )!
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
			document.getElementById( 'wp-desktop-side-dock' ),
		).toBeNull();
		expect(
			document
				.getElementById( 'wp-desktop-dock' )!
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
				.getElementById( 'wp-desktop-dock' )!
				.querySelector( `[data-system-id="${ noopTile.id }"]` ),
		).not.toBeNull();

		// Switch layout — the bottom dock is rebuilt; the tracked
		// system tile must re-attach to the new instance.
		dispatcher.setLayout( 'classic' );
		expect(
			document
				.getElementById( 'wp-desktop-dock' )!
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
				.getElementById( 'wp-desktop-dock' )!
				.querySelector( `[data-system-id="${ noopTile.id }"]` ),
		).toBeNull();

		// Layout rebuild must not resurrect the removed tile.
		dispatcher.setLayout( 'classic' );
		expect(
			document
				.getElementById( 'wp-desktop-dock' )!
				.querySelector( `[data-system-id="${ noopTile.id }"]` ),
		).toBeNull();
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
			document.getElementById( 'wp-desktop-side-dock' ),
		).not.toBeNull();
		dispatcher.destroy();
		expect( document.getElementById( 'wp-desktop-side-dock' ) ).toBeNull();
	} );
} );

describe( 'desktop-layout dispatcher — settings sanitization', () => {
	test( 'invalid desktopLayout in persisted state falls back to default', async () => {
		const stateModule = await import( '../../src/settings/state' );
		const constants = await import( '../../src/settings/constants' );
		// Drive `_parseRaw` via the public `loadState` path. Set the
		// global config so the server-snapshot branch fires.
		( window as unknown as { wpDesktopConfig?: unknown } ).wpDesktopConfig = {
			osSettings: {
				wallpaper: 'dark',
				accent: 'wp-blue',
				dockSize: 'default',
				desktopLayout: 'made-up-value',
			},
		};
		const state = stateModule.loadState();
		expect( state.desktopLayout ).toBe( constants.DEFAULTS.desktopLayout );
		( window as unknown as { wpDesktopConfig?: unknown } ).wpDesktopConfig =
			undefined;
	} );
} );
