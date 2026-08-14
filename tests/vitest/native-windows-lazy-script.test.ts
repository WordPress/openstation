/**
 * A native window's bundle loads when the window opens, not when the
 * shell boots.
 *
 * The registry sync used to `await ensureScript( entry )` for every
 * entry it registered a tile for, which meant every window bundle in
 * the install — WP Explorer at 333 KB, Posts at 329 KB, Plugins at
 * 205 KB — downloaded and parsed on every admin page, whether or not
 * the user ever opened any of them. The shell reads a window's render
 * callback off `window.openStationNativeWindows[ id ]` at open time,
 * so none of that had to happen at boot.
 *
 * What these tests pin:
 *
 *   - Sync registers the tile without fetching the bundle.
 *   - The first open fetches it, and reads the render callback
 *     AFTERWARDS (a bundle that publishes its callback on load is
 *     the normal case, and reading before the load would find
 *     nothing).
 *   - Companion bundles land first, in declaration order.
 *   - `preloadScript` is the escape hatch for a bundle with a
 *     boot-time job.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Dock } from '../../src/dock';
import { createNativeWindowSync } from '../../src/native-windows';
import * as vendorLoader from '../../src/wallpapers/vendor-loader';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';
import { __resetNativeWindowGeometryForTests } from '../../src/window-manager/native-window-geometry';
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
		scriptUrl: `https://example.test/${ id }.js`,
		scriptHandle: id,
		ownerHandle: id,
		tabs: [],
		...overrides,
	};
}

/** Put the `<template>` the render path clones into the document. */
function installTemplate( e: NativeWindowServerEntry ): void {
	const tpl = document.createElement( 'template' );
	tpl.id = e.templateId;
	tpl.innerHTML = e.templateHtml;
	document.body.appendChild( tpl );
}

/** Run the render callback `manager.open` was handed. */
async function runRender(
	managerOpen: ReturnType< typeof vi.fn >,
	call = 0,
): Promise< void > {
	const config = managerOpen.mock.calls[ call ][ 0 ];
	const body = document.createElement( 'div' );
	document.body.appendChild( body );
	await config.render( body );
}

describe( 'native-windows — deferred bundle loading', () => {
	let loaded: string[];

	beforeEach( () => {
		installHooksStub();
		__resetNativeWindowGeometryForTests();
		loaded = [];
		vi.spyOn( vendorLoader, 'loadVendorScript' ).mockImplementation(
			async ( url: string ) => {
				loaded.push( url );
			},
		);
		(
			window as unknown as { openStationNativeWindows?: unknown }
		).openStationNativeWindows = {};
	} );

	afterEach( () => {
		clearHooksStub();
		__resetNativeWindowGeometryForTests();
		vi.restoreAllMocks();
		document.body.innerHTML = '';
		delete ( window as unknown as { openStationNativeWindows?: unknown } )
			.openStationNativeWindows;
	} );

	test( 'sync registers the tile without fetching the bundle', async () => {
		const h = setupHarness();
		const { sync } = createNativeWindowSync( depsFromHarness( h ) );

		await sync( [ entry( 'calculator' ) ] );

		expect( h.dock.hasItems() ).toBe( true );
		expect( loaded ).toEqual( [] );
	} );

	test( 'placement:none entries stay unloaded too', async () => {
		const h = setupHarness();
		const { sync } = createNativeWindowSync( depsFromHarness( h ) );

		await sync( [ entry( 'headless', { placement: 'none' } ) ] );

		expect( loaded ).toEqual( [] );
	} );

	test( 'preloadScript opts a bundle back into the boot load', async () => {
		const h = setupHarness();
		const { sync } = createNativeWindowSync( depsFromHarness( h ) );

		await sync( [ entry( 'badge-poller', { preloadScript: true } ) ] );

		expect( loaded ).toEqual( [ 'https://example.test/badge-poller.js' ] );
	} );

	test( 'the first open fetches the bundle and reads the callback after it lands', async () => {
		const h = setupHarness();
		const e = entry( 'calculator' );
		installTemplate( e );
		const { sync, openById } = createNativeWindowSync( depsFromHarness( h ) );
		await sync( [ e ] );

		const render = vi.fn();
		// The bundle publishes its render callback as a load side
		// effect — mirror that, so a shell that read the registry
		// before loading would see `undefined` and never call it.
		vi.mocked( vendorLoader.loadVendorScript ).mockImplementation(
			async ( url: string ) => {
				loaded.push( url );
				(
					window as unknown as {
						openStationNativeWindows: Record< string, unknown >;
					}
				).openStationNativeWindows.calculator = render;
			},
		);

		expect( openById( 'calculator' ) ).toBe( true );
		await runRender( h.managerOpen );

		expect( loaded ).toEqual( [ 'https://example.test/calculator.js' ] );
		expect( render ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'the second open reuses the loaded bundle', async () => {
		const h = setupHarness();
		const e = entry( 'calculator' );
		installTemplate( e );
		const { sync, openById } = createNativeWindowSync( depsFromHarness( h ) );
		await sync( [ e ] );

		openById( 'calculator' );
		await runRender( h.managerOpen, 0 );
		openById( 'calculator' );
		await runRender( h.managerOpen, 1 );

		expect( loaded ).toEqual( [ 'https://example.test/calculator.js' ] );
	} );

	test( 'two opens in the same tick share one load', async () => {
		const h = setupHarness();
		const e = entry( 'calculator' );
		installTemplate( e );
		const { sync, openById } = createNativeWindowSync( depsFromHarness( h ) );
		await sync( [ e ] );

		openById( 'calculator' );
		openById( 'calculator' );
		await Promise.all( [
			runRender( h.managerOpen, 0 ),
			runRender( h.managerOpen, 1 ),
		] );

		expect( loaded ).toEqual( [ 'https://example.test/calculator.js' ] );
	} );

	test( 'companions load first, in declaration order', async () => {
		const h = setupHarness();
		const e = entry( 'explorer', {
			companionScripts: [
				{
					scriptUrl: 'https://example.test/woo.js',
					scriptHandle: 'woo',
				},
				{
					scriptUrl: 'https://example.test/extra.js',
					scriptHandle: 'extra',
				},
			],
		} );
		installTemplate( e );
		const { sync, openById } = createNativeWindowSync( depsFromHarness( h ) );
		await sync( [ e ] );

		expect( loaded ).toEqual( [] );

		openById( 'explorer' );
		await runRender( h.managerOpen );

		expect( loaded ).toEqual( [
			'https://example.test/woo.js',
			'https://example.test/extra.js',
			'https://example.test/explorer.js',
		] );
	} );

	test( 'loadScriptById brings a bundle in without opening its window', async () => {
		const h = setupHarness();
		const e = entry( 'explorer' );
		const { sync, loadScriptById } = createNativeWindowSync(
			depsFromHarness( h ),
		);
		await sync( [ e ] );

		await expect( loadScriptById( 'explorer' ) ).resolves.toBe( true );

		expect( loaded ).toEqual( [ 'https://example.test/explorer.js' ] );
		expect( h.managerOpen ).not.toHaveBeenCalled();
	} );

	test( 'loadScriptById on an unregistered id resolves false', async () => {
		const h = setupHarness();
		const { sync, loadScriptById } = createNativeWindowSync(
			depsFromHarness( h ),
		);
		await sync( [] );

		await expect( loadScriptById( 'nope' ) ).resolves.toBe( false );
		expect( loaded ).toEqual( [] );
	} );

	test( 'a window with no bundle still renders its template', async () => {
		const h = setupHarness();
		const e = entry( 'declarative', { scriptUrl: '', scriptHandle: '' } );
		installTemplate( e );
		const { sync, openById } = createNativeWindowSync( depsFromHarness( h ) );
		await sync( [ e ] );

		openById( 'declarative' );
		const config = h.managerOpen.mock.calls[ 0 ][ 0 ];
		const body = document.createElement( 'div' );
		await config.render( body );

		expect( loaded ).toEqual( [] );
		expect( body.querySelector( '[data-id="declarative"]' ) ).not.toBeNull();
	} );
} );
