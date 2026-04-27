/**
 * Live-refresh tests for `createNativeWindowSync` — the closure that
 * reconciles the bottom centered taskbar (and the left dock's system-
 * tile section) against the server's `nativeWindows` payload.
 *
 * The bug class this file guards against: a plugin that registers a
 * `desktop_mode_register_window( ... 'placement' => 'taskbar' )` should
 * appear on the bottom bar the moment it's activated from the
 * chromeless plugins.php iframe, and disappear the moment it's
 * deactivated — both without a page reload. The `applyPayload` path
 * forwards `nativeWindows` to this sync; if the sync's add/remove
 * contract slips, the bottom bar visibly stops tracking the install.
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
import type { WindowManager } from '../../src/window-manager';
import type { NativeWindowServerEntry } from '../../src/types';

interface Harness {
	dockEl: HTMLElement;
	taskbarEl: HTMLElement;
	desktopArea: HTMLElement;
	dock: Dock;
	taskbar: Dock;
	manager: WindowManager;
	managerOpen: ReturnType< typeof vi.fn >;
}

function setupHarness(): Harness {
	document.body.innerHTML = '';
	const desktopArea = document.createElement( 'div' );
	desktopArea.id = 'wp-desktop-area';
	const dockEl = document.createElement( 'div' );
	dockEl.id = 'wp-desktop-dock';
	const taskbarEl = document.createElement( 'div' );
	taskbarEl.id = 'wp-desktop-taskbar';
	taskbarEl.hidden = true;
	document.body.append( desktopArea, dockEl, taskbarEl );

	const managerOpen = vi.fn();
	const manager = {
		open: managerOpen,
		getById: () => null,
		getFocused: () => null,
		getAll: () => [],
		getCount: () => 0,
		getActiveDesktopId: () => 'desktop-1',
	} as unknown as WindowManager;

	const dock = new Dock( dockEl, manager, [], '/wp-admin/', 'left' );
	const taskbar = new Dock( taskbarEl, manager, [], '/wp-admin/', 'bottom' );

	return { dockEl, taskbarEl, desktopArea, dock, taskbar, manager, managerOpen };
}

function entry(
	id: string,
	overrides: Partial< NativeWindowServerEntry > = {},
): NativeWindowServerEntry {
	return {
		id,
		title: id,
		icon: 'dashicons-admin-generic',
		placement: 'taskbar',
		width: 520,
		height: 400,
		minWidth: 280,
		minHeight: 220,
		autofocus: false,
		templateId: `wpdm-native-window-${ id }`,
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
		// `loadVendorScript` is exercised when an entry has a non-empty
		// scriptUrl. We stub it so tests don't try to inject real
		// `<script>` tags. Most tests use scriptUrl='' and bypass it.
		vi.spyOn( vendorLoader, 'loadVendorScript' ).mockResolvedValue( undefined );
	} );
	afterEach( () => {
		clearHooksStub();
		vi.restoreAllMocks();
		document.body.innerHTML = '';
	} );

	test( 'boot: an empty list registers no tiles and the taskbar stays hidden', async () => {
		const h = setupHarness();
		const { sync } = createNativeWindowSync( {
			manager: h.manager,
			dock: h.dock,
			taskbar: h.taskbar,
			taskbarEl: h.taskbarEl,
			desktopArea: h.desktopArea,
		} );

		await sync( [] );

		expect( h.taskbar.hasItems() ).toBe( false );
		expect( h.dock.hasItems() ).toBe( false );
		expect( h.taskbarEl.hidden ).toBe( true );
	} );

	test( 'activation: a freshly-arrived entry adds a system tile to the taskbar and reveals the rail', async () => {
		const h = setupHarness();
		const { sync } = createNativeWindowSync( {
			manager: h.manager,
			dock: h.dock,
			taskbar: h.taskbar,
			taskbarEl: h.taskbarEl,
			desktopArea: h.desktopArea,
		} );

		// Boot: nothing.
		await sync( [] );
		expect( h.taskbarEl.hidden ).toBe( true );

		// Plugin activation lands a single new entry.
		await sync( [ entry( 'calculator' ) ] );

		expect( tilesIn( h.taskbarEl ) ).toEqual( [ 'calculator' ] );
		expect( h.taskbar.hasItems() ).toBe( true );
		// The shell hides the rail when empty; activating a taskbar-
		// placement plugin must un-hide it.
		expect( h.taskbarEl.hidden ).toBe( false );
		expect(
			h.desktopArea.classList.contains( 'wp-desktop-area--with-taskbar' ),
		).toBe( true );
	} );

	test( 'deactivation: an entry that disappears from the list pulls its taskbar tile', async () => {
		const h = setupHarness();
		const { sync } = createNativeWindowSync( {
			manager: h.manager,
			dock: h.dock,
			taskbar: h.taskbar,
			taskbarEl: h.taskbarEl,
			desktopArea: h.desktopArea,
		} );

		// Boot with three taskbar plugins (mirrors the user's screenshot:
		// calculator + home assistant + code editor).
		await sync( [
			entry( 'calculator' ),
			entry( 'home-assistant' ),
			entry( 'code-editor' ),
		] );
		expect( tilesIn( h.taskbarEl ).sort() ).toEqual( [
			'calculator',
			'code-editor',
			'home-assistant',
		] );

		// Deactivate "home-assistant" — the bridge re-broadcasts a payload
		// without that entry. The tile must be pulled from the DOM
		// without removing the surviving two.
		await sync( [ entry( 'calculator' ), entry( 'code-editor' ) ] );

		expect( tilesIn( h.taskbarEl ).sort() ).toEqual( [
			'calculator',
			'code-editor',
		] );
		// Surviving tiles still keep the rail visible.
		expect( h.taskbarEl.hidden ).toBe( false );
	} );

	test( 'deactivation of the last taskbar entry leaves no system tiles behind', async () => {
		const h = setupHarness();
		const { sync } = createNativeWindowSync( {
			manager: h.manager,
			dock: h.dock,
			taskbar: h.taskbar,
			taskbarEl: h.taskbarEl,
			desktopArea: h.desktopArea,
		} );

		await sync( [ entry( 'calculator' ) ] );
		expect( h.taskbar.hasItems() ).toBe( true );

		// All taskbar plugins gone.
		await sync( [] );

		expect( tilesIn( h.taskbarEl ) ).toEqual( [] );
		expect( h.taskbar.hasItems() ).toBe( false );
	} );

	test( 'placement="dock" routes the tile to the LEFT dock, not the bottom taskbar', async () => {
		const h = setupHarness();
		const { sync } = createNativeWindowSync( {
			manager: h.manager,
			dock: h.dock,
			taskbar: h.taskbar,
			taskbarEl: h.taskbarEl,
			desktopArea: h.desktopArea,
		} );

		await sync( [
			entry( 'left-tool', { placement: 'dock' } ),
			entry( 'bottom-tool', { placement: 'taskbar' } ),
		] );

		expect( tilesIn( h.dockEl ) ).toEqual( [ 'left-tool' ] );
		expect( tilesIn( h.taskbarEl ) ).toEqual( [ 'bottom-tool' ] );
	} );

	test( 're-syncing the same list is idempotent — no duplicate tiles', async () => {
		const h = setupHarness();
		const { sync } = createNativeWindowSync( {
			manager: h.manager,
			dock: h.dock,
			taskbar: h.taskbar,
			taskbarEl: h.taskbarEl,
			desktopArea: h.desktopArea,
		} );

		await sync( [ entry( 'calculator' ) ] );
		await sync( [ entry( 'calculator' ) ] );
		await sync( [ entry( 'calculator' ) ] );

		expect( tilesIn( h.taskbarEl ) ).toEqual( [ 'calculator' ] );
	} );

	test( 'reactivation: id leaves the list, then comes back — tile is re-registered', async () => {
		const h = setupHarness();
		const { sync } = createNativeWindowSync( {
			manager: h.manager,
			dock: h.dock,
			taskbar: h.taskbar,
			taskbarEl: h.taskbarEl,
			desktopArea: h.desktopArea,
		} );

		await sync( [ entry( 'calculator' ) ] );
		await sync( [] );
		expect( tilesIn( h.taskbarEl ) ).toEqual( [] );

		await sync( [ entry( 'calculator' ) ] );

		expect( tilesIn( h.taskbarEl ) ).toEqual( [ 'calculator' ] );
		expect( h.taskbarEl.hidden ).toBe( false );
	} );

	test( 'activating a taskbar-placement entry while the taskbar was previously hidden re-shows it', async () => {
		const h = setupHarness();
		// Simulate the worst-case sequence the shell can hit at live
		// refresh time: applyPayload's synchronous block sets
		// `taskbarEl.hidden = true` because the menu-derived items are
		// empty AND no system tiles existed yet. The async
		// syncNativeWindows fires next and MUST re-show the rail when it
		// adds a tile.
		h.taskbarEl.hidden = true;
		h.desktopArea.classList.remove( 'wp-desktop-area--with-taskbar' );

		const { sync } = createNativeWindowSync( {
			manager: h.manager,
			dock: h.dock,
			taskbar: h.taskbar,
			taskbarEl: h.taskbarEl,
			desktopArea: h.desktopArea,
		} );

		await sync( [ entry( 'calculator' ) ] );

		expect( h.taskbarEl.hidden ).toBe( false );
		expect(
			h.desktopArea.classList.contains( 'wp-desktop-area--with-taskbar' ),
		).toBe( true );
	} );

	test( 'placement="none" runs the script + template injection but registers no rail tile', async () => {
		const h = setupHarness();
		const { sync } = createNativeWindowSync( {
			manager: h.manager,
			dock: h.dock,
			taskbar: h.taskbar,
			taskbarEl: h.taskbarEl,
			desktopArea: h.desktopArea,
		} );

		await sync( [ entry( 'silent', { placement: 'none' } ) ] );

		expect( tilesIn( h.taskbarEl ) ).toEqual( [] );
		expect( tilesIn( h.dockEl ) ).toEqual( [] );
	} );

	test( 'openById opens a registered entry and rejects an unknown id', async () => {
		const h = setupHarness();
		const { sync, openById } = createNativeWindowSync( {
			manager: h.manager,
			dock: h.dock,
			taskbar: h.taskbar,
			taskbarEl: h.taskbarEl,
			desktopArea: h.desktopArea,
		} );

		await sync( [ entry( 'calculator' ) ] );
		expect( openById( 'calculator' ) ).toBe( true );
		expect( h.managerOpen ).toHaveBeenCalledTimes( 1 );

		await sync( [] );
		expect( openById( 'calculator' ) ).toBe( false );
	} );
} );
