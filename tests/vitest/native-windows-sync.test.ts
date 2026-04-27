/**
 * Live-refresh tests for `createNativeWindowSync` — the closure that
 * reconciles the unified dock's system-tile section against the
 * server's `nativeWindows` payload.
 *
 * The bug class this file guards against: a plugin that registers a
 * `desktop_mode_register_window( … )` should appear on the dock the
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
	desktopArea.id = 'wp-desktop-area';
	const dockEl = document.createElement( 'div' );
	dockEl.id = 'wp-desktop-dock';
	document.body.append( desktopArea, dockEl );

	const managerOpen = vi.fn();
	const manager = {
		open: managerOpen,
		getById: () => null,
		getFocused: () => null,
		getAll: () => [],
		getCount: () => 0,
		getActiveDesktopId: () => 'desktop-1',
	} as unknown as WindowManager;

	const dock = new Dock( dockEl, manager, [], '/wp-admin/', 'bottom' );

	return { dockEl, desktopArea, dock, manager, managerOpen };
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

	test( 'boot: an empty list registers no tiles', async () => {
		const h = setupHarness();
		const { sync } = createNativeWindowSync( {
			manager: h.manager,
			dock: h.dock,
			desktopArea: h.desktopArea,
		} );

		await sync( [] );

		expect( h.dock.hasItems() ).toBe( false );
	} );

	test( 'activation: a freshly-arrived entry adds a system tile to the dock', async () => {
		const h = setupHarness();
		const { sync } = createNativeWindowSync( {
			manager: h.manager,
			dock: h.dock,
			desktopArea: h.desktopArea,
		} );

		await sync( [] );
		expect( tilesIn( h.dockEl ) ).toEqual( [] );

		await sync( [ entry( 'calculator' ) ] );

		expect( tilesIn( h.dockEl ) ).toEqual( [ 'calculator' ] );
		expect( h.dock.hasItems() ).toBe( true );
	} );

	test( 'deactivation: an entry that disappears from the list pulls its tile', async () => {
		const h = setupHarness();
		const { sync } = createNativeWindowSync( {
			manager: h.manager,
			dock: h.dock,
			desktopArea: h.desktopArea,
		} );

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
		const { sync } = createNativeWindowSync( {
			manager: h.manager,
			dock: h.dock,
			desktopArea: h.desktopArea,
		} );

		await sync( [ entry( 'calculator' ) ] );
		expect( h.dock.hasItems() ).toBe( true );

		await sync( [] );

		expect( tilesIn( h.dockEl ) ).toEqual( [] );
		expect( h.dock.hasItems() ).toBe( false );
	} );

	test( 're-syncing the same list is idempotent — no duplicate tiles', async () => {
		const h = setupHarness();
		const { sync } = createNativeWindowSync( {
			manager: h.manager,
			dock: h.dock,
			desktopArea: h.desktopArea,
		} );

		await sync( [ entry( 'calculator' ) ] );
		await sync( [ entry( 'calculator' ) ] );
		await sync( [ entry( 'calculator' ) ] );

		expect( tilesIn( h.dockEl ) ).toEqual( [ 'calculator' ] );
	} );

	test( 'reactivation: id leaves the list, then comes back — tile is re-registered', async () => {
		const h = setupHarness();
		const { sync } = createNativeWindowSync( {
			manager: h.manager,
			dock: h.dock,
			desktopArea: h.desktopArea,
		} );

		await sync( [ entry( 'calculator' ) ] );
		await sync( [] );
		expect( tilesIn( h.dockEl ) ).toEqual( [] );

		await sync( [ entry( 'calculator' ) ] );

		expect( tilesIn( h.dockEl ) ).toEqual( [ 'calculator' ] );
	} );

	test( 'placement="none" runs the script + template injection but registers no tile', async () => {
		const h = setupHarness();
		const { sync } = createNativeWindowSync( {
			manager: h.manager,
			dock: h.dock,
			desktopArea: h.desktopArea,
		} );

		await sync( [ entry( 'silent', { placement: 'none' } ) ] );

		expect( tilesIn( h.dockEl ) ).toEqual( [] );
	} );

	test( 'openById opens a registered entry and rejects an unknown id', async () => {
		const h = setupHarness();
		const { sync, openById } = createNativeWindowSync( {
			manager: h.manager,
			dock: h.dock,
			desktopArea: h.desktopArea,
		} );

		await sync( [ entry( 'calculator' ) ] );
		expect( openById( 'calculator' ) ).toBe( true );
		expect( h.managerOpen ).toHaveBeenCalledTimes( 1 );

		await sync( [] );
		expect( openById( 'calculator' ) ).toBe( false );
	} );
} );
