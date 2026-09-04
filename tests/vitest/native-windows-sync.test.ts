/**
 * Live-refresh tests for `createNativeWindowSync` — the closure that
 * reconciles the unified dock's system-tile section against the
 * server's `nativeWindows` payload.
 *
 * The bug class this file guards against: a plugin that registers a
 * `openstation_register_window( … )` should appear on the dock the
 * moment it's activated from the chromeless plugins.php iframe, and
 * disappear the moment it's deactivated — both without a page reload.
 * The `applyPayload` path forwards `nativeWindows` to this sync; if
 * the sync's add/remove contract slips, the dock visibly stops
 * tracking the install.
 *
 * Tests deliberately stand up a real `Dock` (not a mock) so we exercise
 * the actual `appendSystemItem` / `removeSystemItem` / `hasItems`
 * surface the live-refresh path leans on.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Dock } from '../../src/dock';
import { createNativeWindowSync } from '../../src/native-windows';
import * as vendorLoader from '../../src/wallpapers/vendor-loader';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';
import {
	__resetNativeWindowGeometryForTests,
	loadNativeWindowGeometry,
	saveNativeWindowGeometry,
	setNativeWindowSavedState,
} from '../../src/window-manager/native-window-geometry';
import { HOOKS } from '../../src/hooks';
import type { WindowManager } from '../../src/window-manager';
import type { NativeWindowServerEntry } from '../../src/types';

interface Harness {
	dockEl: HTMLElement;
	desktopArea: HTMLElement;
	dock: Dock;
	manager: WindowManager;
	managerOpen: ReturnType< typeof vi.fn >;
}

function setupHarness(): Harness {
	document.body.innerHTML = '';
	const desktopArea = document.createElement( 'div' );
	desktopArea.id = 'os-area';
	const dockEl = document.createElement( 'div' );
	dockEl.id = 'os-dock';
	document.body.append( desktopArea, dockEl );

	const managerOpen = vi.fn();
	const manager = {
		open: managerOpen,
		openNew: managerOpen,
		getById: () => null,
		getByBaseIdOnActiveDesktop: () => undefined,
		getFocused: () => null,
		getAll: () => [],
		getCount: () => 0,
		getActiveDesktopId: () => 'desktop-1',
	} as unknown as WindowManager;

	const dock = new Dock( dockEl, manager, [], '/wp-admin/', 'bottom' );

	return { dockEl, desktopArea, dock, manager, managerOpen };
}

/**
 * Build the deps `createNativeWindowSync` expects from a harness —
 * the system-tile callbacks delegate to the harness's `Dock` instance
 * directly so the tests still assert against real DOM tiles.
 */
function depsFromHarness( h: Harness ) {
	return {
		manager: h.manager,
		appendSystemTile: ( item: Parameters< Dock[ 'appendSystemItem' ] >[ 0 ] ) =>
			h.dock.appendSystemItem( item ),
		removeSystemTile: ( id: string ) => h.dock.removeSystemItem( id ),
		desktopArea: h.desktopArea,
	};
}

function entry(
	id: string,
	overrides: Partial< NativeWindowServerEntry > = {},
): NativeWindowServerEntry {
	return {
		id,
		title: id,
		icon: 'dashicons-admin-generic',
		placement: 'dock',
		width: 520,
		height: 400,
		minWidth: 280,
		minHeight: 220,
		autofocus: false,
		templateId: `os-native-window-${ id }`,
		templateHtml: `<div data-id="${ id }">${ id }</div>`,
		scriptUrl: '',
		scriptHandle: '',
		tabs: [],
		...overrides,
	};
}

function tilesIn( el: HTMLElement ): string[] {
	return Array.from(
		el.querySelectorAll( '[data-system-id]' ),
	).map( ( e ) => ( e as HTMLElement ).dataset.systemId as string );
}

describe( 'native-windows.createNativeWindowSync — live activation / deactivation', () => {
	beforeEach( () => {
		installHooksStub();
		__resetNativeWindowGeometryForTests();
		// `loadVendorScript` is exercised when an entry has a non-empty
		// scriptUrl. We stub it so tests don't try to inject real
		// `<script>` tags. Most tests use scriptUrl='' and bypass it.
		vi.spyOn( vendorLoader, 'loadVendorScript' ).mockResolvedValue( undefined );
	} );
	afterEach( () => {
		clearHooksStub();
		__resetNativeWindowGeometryForTests();
		vi.restoreAllMocks();
		document.body.innerHTML = '';
	} );

	test( 'boot: an empty list registers no tiles', async () => {
		const h = setupHarness();
		const { sync } = createNativeWindowSync( depsFromHarness( h ) );

		await sync( [] );

		expect( h.dock.hasItems() ).toBe( false );
	} );

	test( 'activation: a freshly-arrived entry adds a system tile to the dock', async () => {
		const h = setupHarness();
		const { sync } = createNativeWindowSync( depsFromHarness( h ) );

		await sync( [] );
		expect( tilesIn( h.dockEl ) ).toEqual( [] );

		await sync( [ entry( 'calculator' ) ] );

		expect( tilesIn( h.dockEl ) ).toEqual( [ 'calculator' ] );
		expect( h.dock.hasItems() ).toBe( true );
	} );

	test( 'deactivation: an entry that disappears from the list pulls its tile', async () => {
		const h = setupHarness();
		const { sync } = createNativeWindowSync( depsFromHarness( h ) );

		await sync( [
			entry( 'calculator' ),
			entry( 'home-assistant' ),
			entry( 'code-editor' ),
		] );
		expect( tilesIn( h.dockEl ).sort() ).toEqual( [
			'calculator',
			'code-editor',
			'home-assistant',
		] );

		await sync( [ entry( 'calculator' ), entry( 'code-editor' ) ] );

		expect( tilesIn( h.dockEl ).sort() ).toEqual( [
			'calculator',
			'code-editor',
		] );
	} );

	test( 'deactivation of the last entry leaves no system tiles behind', async () => {
		const h = setupHarness();
		const { sync } = createNativeWindowSync( depsFromHarness( h ) );

		await sync( [ entry( 'calculator' ) ] );
		expect( h.dock.hasItems() ).toBe( true );

		await sync( [] );

		expect( tilesIn( h.dockEl ) ).toEqual( [] );
		expect( h.dock.hasItems() ).toBe( false );
	} );

	test( 're-syncing the same list is idempotent — no duplicate tiles', async () => {
		const h = setupHarness();
		const { sync } = createNativeWindowSync( depsFromHarness( h ) );

		await sync( [ entry( 'calculator' ) ] );
		await sync( [ entry( 'calculator' ) ] );
		await sync( [ entry( 'calculator' ) ] );

		expect( tilesIn( h.dockEl ) ).toEqual( [ 'calculator' ] );
	} );

	test( 'reactivation: id leaves the list, then comes back — tile is re-registered', async () => {
		const h = setupHarness();
		const { sync } = createNativeWindowSync( depsFromHarness( h ) );

		await sync( [ entry( 'calculator' ) ] );
		await sync( [] );
		expect( tilesIn( h.dockEl ) ).toEqual( [] );

		await sync( [ entry( 'calculator' ) ] );

		expect( tilesIn( h.dockEl ) ).toEqual( [ 'calculator' ] );
	} );

	test( 'placement="none" runs the script + template injection but registers no tile', async () => {
		const h = setupHarness();
		const { sync } = createNativeWindowSync( depsFromHarness( h ) );

		await sync( [ entry( 'silent', { placement: 'none' } ) ] );

		expect( tilesIn( h.dockEl ) ).toEqual( [] );
	} );

	// `styleUrl` lazy injection — closes the gap where a peer plugin
	// activated mid-session would render its window WITHOUT its CSS
	// because the parent shell already finished `wp_print_styles`.
	describe( 'styleUrl lazy injection', () => {
		beforeEach( () => {
			// Strip prior <link>/<style> nodes the parent describe's
			// harness/jsdom may have left in <head>; the lazy-loader's
			// "is this already there?" guard is global to <head>, so a
			// stale node would short-circuit injection.
			document.head
				.querySelectorAll( 'link[rel="stylesheet"], style[data-os-style-handle]' )
				.forEach( ( n ) => n.remove() );
		} );

		test( 'injects a <link rel="stylesheet"> for the entry styleUrl', async () => {
			const h = setupHarness();
			const { sync } = createNativeWindowSync( depsFromHarness( h ) );

			await sync( [
				entry( 'jorvy', {
					styleUrl: 'https://example.test/jorvy.css?ver=1',
					styleHandle: 'jorvy-style',
				} ),
			] );

			const link = document.head.querySelector< HTMLLinkElement >(
				'link[rel="stylesheet"][href="https://example.test/jorvy.css?ver=1"]',
			);
			expect( link ).not.toBeNull();
			expect( link?.dataset.osStyleHandle ).toBe( 'jorvy-style' );
		} );

		test( 're-syncing the same entry does not duplicate the link', async () => {
			const h = setupHarness();
			const { sync } = createNativeWindowSync( depsFromHarness( h ) );

			const e = entry( 'jorvy', {
				styleUrl: 'https://example.test/jorvy.css?ver=1',
			} );
			await sync( [ e ] );
			await sync( [ e ] );

			const links = document.head.querySelectorAll(
				'link[rel="stylesheet"][href="https://example.test/jorvy.css?ver=1"]',
			);
			expect( links.length ).toBe( 1 );
		} );

		test( 'wp_add_inline_style blobs land as <style> tags after the link', async () => {
			const h = setupHarness();
			const { sync } = createNativeWindowSync( depsFromHarness( h ) );

			await sync( [
				entry( 'jorvy', {
					styleUrl: 'https://example.test/jorvy.css',
					styleHandle: 'jorvy-style',
					styleInline: [ '.jorvy { color: red; }' ],
				} ),
			] );

			const style = document.head.querySelector< HTMLStyleElement >(
				'style[data-os-style-handle="jorvy-style"]',
			);
			expect( style?.textContent ).toBe( '.jorvy { color: red; }' );
		} );

		test( 'no styleUrl: no <link> injected', async () => {
			const h = setupHarness();
			const { sync } = createNativeWindowSync( depsFromHarness( h ) );

			await sync( [ entry( 'plain' ) ] );

			expect(
				document.head.querySelectorAll( 'link[rel="stylesheet"]' ),
			).toHaveLength( 0 );
		} );
	} );

	test( 'openById opens a registered entry and rejects an unknown id', async () => {
		const h = setupHarness();
		const { sync, openById } = createNativeWindowSync( depsFromHarness( h ) );

		await sync( [ entry( 'calculator' ) ] );
		expect( openById( 'calculator' ) ).toBe( true );
		expect( h.managerOpen ).toHaveBeenCalledTimes( 1 );

		await sync( [] );
		expect( openById( 'calculator' ) ).toBe( false );
	} );

	test( 'restoreById resolves a saved instance through its registered base id', async () => {
		const h = setupHarness();
		const { sync, restoreById } = createNativeWindowSync(
			depsFromHarness( h ),
		);

		await sync( [ entry( 'fleet-site' ) ] );
		expect(
			restoreById( 'fleet-site-4', 'fleet-site', {
				desktopId: 'desktop-2',
				params: { site: 'bravo' },
			} ),
		).toBe( true );

		expect( h.managerOpen ).toHaveBeenCalledWith(
			expect.objectContaining( {
				id: 'fleet-site-4',
				baseId: 'fleet-site',
				desktopId: 'desktop-2',
				params: { site: 'bravo' },
			} ),
		);
		expect( restoreById( 'gone-2', 'gone', {} ) ).toBe( false );
	} );

	describe( 'remembered window size (issue #203)', () => {
		test( 'openById uses the registered defaults when nothing is remembered', async () => {
			const h = setupHarness();
			const { sync, openById } = createNativeWindowSync(
				depsFromHarness( h ),
			);

			await sync( [
				entry( 'calculator', {
					width: 520,
					height: 400,
					minWidth: 280,
					minHeight: 220,
				} ),
			] );

			openById( 'calculator' );

			expect( h.managerOpen ).toHaveBeenCalledTimes( 1 );
			const call = h.managerOpen.mock.calls[ 0 ]?.[ 0 ] as {
				width: number;
				height: number;
			};
			expect( call.width ).toBe( 520 );
			expect( call.height ).toBe( 400 );
		} );

		test( 'openById prefers a previously-saved size over the registered defaults', async () => {
			saveNativeWindowGeometry( 'calculator', {
				width: 1500,
				height: 900,
			} );

			const h = setupHarness();
			const { sync, openById } = createNativeWindowSync(
				depsFromHarness( h ),
			);

			await sync( [
				entry( 'calculator', {
					width: 520,
					height: 400,
					minWidth: 280,
					minHeight: 220,
				} ),
			] );

			openById( 'calculator' );

			const call = h.managerOpen.mock.calls[ 0 ]?.[ 0 ] as {
				width: number;
				height: number;
			};
			expect( call.width ).toBe( 1500 );
			expect( call.height ).toBe( 900 );
		} );

		test( 'openById does not pin x / y, so createWindow can apply the saved position', async () => {
			// Regression: native open path used to hard-code
			// `x: 0, y: 0`, which short-circuited the saved-position
			// replay in `WindowManager.createWindow`. After dragging
			// a native window like Posts to the bottom-right, closing
			// it, and reopening from the dock, it would land back at
			// (0, 0) instead of the user's last position.
			const h = setupHarness();
			const { sync, openById } = createNativeWindowSync(
				depsFromHarness( h ),
			);

			await sync( [ entry( 'calculator' ) ] );

			openById( 'calculator' );

			const call = h.managerOpen.mock.calls[ 0 ]?.[ 0 ] as {
				x?: number;
				y?: number;
			};
			expect( call.x ).toBeUndefined();
			expect( call.y ).toBeUndefined();
		} );

		test( 'a stored size smaller than the current minimum is clamped up', async () => {
			// A previous version registered a smaller minimum and the
			// user resized down. After the plugin update raises
			// minWidth, the next open must respect the new floor.
			saveNativeWindowGeometry( 'calculator', {
				width: 320,
				height: 240,
			} );

			const h = setupHarness();
			const { sync, openById } = createNativeWindowSync(
				depsFromHarness( h ),
			);

			await sync( [
				entry( 'calculator', {
					width: 520,
					height: 400,
					minWidth: 500,
					minHeight: 350,
				} ),
			] );

			openById( 'calculator' );

			const call = h.managerOpen.mock.calls[ 0 ]?.[ 0 ] as {
				width: number;
				height: number;
			};
			expect( call.width ).toBe( 500 );
			expect( call.height ).toBe( 350 );
		} );

		test( 'WINDOW_RESIZE_END persists the new size for a native window in normal state', async () => {
			const h = setupHarness();
			const fakeWin = {
				id: 'calculator',
				state: 'normal' as const,
				config: { native: true, baseId: 'calculator' },
			};
			h.manager.getById = ( ( id: string ) =>
				id === 'calculator' ? fakeWin : null ) as WindowManager[ 'getById' ];

			createNativeWindowSync( depsFromHarness( h ) );

			window.wp!.hooks.doAction( HOOKS.WINDOW_RESIZE_END, {
				windowId: 'calculator',
				width: 1500,
				height: 900,
			} );

			expect( loadNativeWindowGeometry( 'calculator' ) ).toEqual( {
				width: 1500,
				height: 900,
			} );
		} );

		test( 'WINDOW_RESIZE_END persists the new size for classic (non-native) windows too', async () => {
			const h = setupHarness();
			h.manager.getById = ( () => ( {
				id: 'edit-php',
				state: 'normal' as const,
				config: { native: false, baseId: 'edit-php' },
			} ) ) as WindowManager[ 'getById' ];

			createNativeWindowSync( depsFromHarness( h ) );

			window.wp!.hooks.doAction( HOOKS.WINDOW_RESIZE_END, {
				windowId: 'edit-php',
				width: 1500,
				height: 900,
			} );

			expect( loadNativeWindowGeometry( 'edit-php' ) ).toEqual( {
				width: 1500,
				height: 900,
			} );
		} );

		test( 'WINDOW_RESIZE_END is ignored when the window is not in normal state', async () => {
			const h = setupHarness();
			h.manager.getById = ( () => ( {
				id: 'calculator',
				state: 'maximized' as const,
				config: { native: true, baseId: 'calculator' },
			} ) ) as WindowManager[ 'getById' ];

			createNativeWindowSync( depsFromHarness( h ) );

			window.wp!.hooks.doAction( HOOKS.WINDOW_RESIZE_END, {
				windowId: 'calculator',
				width: 1500,
				height: 900,
			} );

			expect( loadNativeWindowGeometry( 'calculator' ) ).toBeNull();
		} );

		test( 'WINDOW_MAXIMIZED records the maximize preference, preserving the floating size', async () => {
			saveNativeWindowGeometry( 'calculator', {
				width: 1500,
				height: 900,
			} );

			const h = setupHarness();
			h.manager.getById = ( () => ( {
				id: 'calculator',
				state: 'maximized' as const,
				config: { native: true, baseId: 'calculator' },
			} ) ) as WindowManager[ 'getById' ];

			const { sync } = createNativeWindowSync( depsFromHarness( h ) );
			await sync( [
				entry( 'calculator', { width: 520, height: 400 } ),
			] );

			window.wp!.hooks.doAction( HOOKS.WINDOW_MAXIMIZED, {
				windowId: 'calculator',
			} );

			expect( loadNativeWindowGeometry( 'calculator' ) ).toEqual( {
				width: 1500,
				height: 900,
				state: 'maximized',
			} );
		} );

		test( 'WINDOW_MAXIMIZED seeds floating size from entry defaults when nothing was stored', async () => {
			const h = setupHarness();
			h.manager.getById = ( () => ( {
				id: 'calculator',
				state: 'maximized' as const,
				config: { native: true, baseId: 'calculator' },
			} ) ) as WindowManager[ 'getById' ];

			const { sync } = createNativeWindowSync( depsFromHarness( h ) );
			await sync( [
				entry( 'calculator', { width: 520, height: 400 } ),
			] );

			window.wp!.hooks.doAction( HOOKS.WINDOW_MAXIMIZED, {
				windowId: 'calculator',
			} );

			expect( loadNativeWindowGeometry( 'calculator' ) ).toEqual( {
				width: 520,
				height: 400,
				state: 'maximized',
			} );
		} );

		test( 'WINDOW_DRAG_END seeds size + position even when nothing was previously stored', async () => {
			// Regression: open-drag-close (no manual resize) was
			// dropping the position because `saveNativeWindowPosition`
			// requires a prior entry to layer onto.
			const h = setupHarness();
			const element = document.createElement( 'div' );
			Object.defineProperty( element, 'offsetLeft', { value: 1200, configurable: true } );
			Object.defineProperty( element, 'offsetTop', { value: 700, configurable: true } );
			Object.defineProperty( element, 'offsetWidth', { value: 820, configurable: true } );
			Object.defineProperty( element, 'offsetHeight', { value: 540, configurable: true } );
			h.manager.getById = ( () => ( {
				id: 'edit-php',
				state: 'normal' as const,
				config: { native: false, baseId: 'edit-php' },
				element,
			} ) ) as WindowManager[ 'getById' ];

			createNativeWindowSync( depsFromHarness( h ) );

			window.wp!.hooks.doAction( HOOKS.WINDOW_DRAG_END, {
				windowId: 'edit-php',
				x: 1200,
				y: 700,
			} );

			expect( loadNativeWindowGeometry( 'edit-php' ) ).toEqual( {
				width: 820,
				height: 540,
				x: 1200,
				y: 700,
			} );
		} );

		test( 'WINDOW_UNMAXIMIZED clears the maximize preference, preserving the floating size', async () => {
			setNativeWindowSavedState( 'calculator', 'maximized', {
				width: 520,
				height: 400,
			} );
			saveNativeWindowGeometry( 'calculator', {
				width: 1500,
				height: 900,
			} );

			const h = setupHarness();
			h.manager.getById = ( () => ( {
				id: 'calculator',
				state: 'normal' as const,
				config: { native: true, baseId: 'calculator' },
			} ) ) as WindowManager[ 'getById' ];

			createNativeWindowSync( depsFromHarness( h ) );

			window.wp!.hooks.doAction( HOOKS.WINDOW_UNMAXIMIZED, {
				windowId: 'calculator',
			} );

			expect( loadNativeWindowGeometry( 'calculator' ) ).toEqual( {
				width: 1500,
				height: 900,
			} );
		} );

	} );
} );
