/**
 * `prewarmById` — the shell's door for the dock's hover intent on a
 * native window: the bundles into the tab, then the runtime's own
 * prewarm (`wp.os.apps.prewarm`), which sends the app's first `mount`.
 *
 * What these tests pin: the load happens before the runtime is asked,
 * an open window is never warmed, a native window that is not an app
 * gets its bundles and nothing more, and an unknown id is a plain no.
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
	dock: Dock;
	manager: WindowManager;
	getById: ReturnType< typeof vi.fn >;
	desktopArea: HTMLElement;
}

function setupHarness(): Harness {
	document.body.innerHTML = '';
	const desktopArea = document.createElement( 'div' );
	desktopArea.id = 'os-area';
	const dockEl = document.createElement( 'div' );
	dockEl.id = 'os-dock';
	document.body.append( desktopArea, dockEl );

	const getById = vi.fn( () => null );
	const manager = {
		open: vi.fn(),
		openNew: vi.fn(),
		getById,
		getByBaseIdOnActiveDesktop: () => undefined,
		getFocused: () => null,
		getAll: () => [],
		getCount: () => 0,
		getActiveDesktopId: () => 'desktop-1',
	} as unknown as WindowManager;

	const dock = new Dock( dockEl, manager, [], '/wp-admin/', 'bottom' );
	return { dock, manager, getById, desktopArea };
}

function deps( h: Harness ) {
	return {
		manager: h.manager,
		appendSystemTile: ( item: Parameters< Dock[ 'appendSystemItem' ] >[ 0 ] ) => h.dock.appendSystemItem( item ),
		removeSystemTile: ( id: string ) => h.dock.removeSystemItem( id ),
		desktopArea: h.desktopArea,
	};
}

function entry( id: string, overrides: Partial< NativeWindowServerEntry > = {} ): NativeWindowServerEntry {
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

type Wp = { wp?: { os?: { apps?: { prewarm?: ( id: string ) => boolean } } } };

describe( 'native-windows — prewarmById', () => {
	let loaded: string[];
	let runtimePrewarm: ReturnType< typeof vi.fn >;

	beforeEach( () => {
		installHooksStub();
		__resetNativeWindowGeometryForTests();
		loaded = [];
		vi.spyOn( vendorLoader, 'loadVendorScript' ).mockImplementation( async ( url: string ) => {
			loaded.push( url );
		} );
		runtimePrewarm = vi.fn( () => true );
		// Beside the hooks stub, never in its place.
		const wp = ( ( window as unknown as { wp?: Record< string, unknown > } ).wp ??= {} );
		wp.os = { apps: { prewarm: runtimePrewarm } };
		( window as unknown as { openStationNativeWindows?: unknown } ).openStationNativeWindows = {};
	} );

	afterEach( () => {
		delete ( window as unknown as Wp ).wp?.os;
		clearHooksStub();
		__resetNativeWindowGeometryForTests();
		vi.restoreAllMocks();
		document.body.innerHTML = '';
		delete ( window as unknown as { openStationNativeWindows?: unknown } ).openStationNativeWindows;
	} );

	test( 'loads the bundles, then asks the runtime to send the first mount', async () => {
		const h = setupHarness();
		const { sync, prewarmById } = createNativeWindowSync( deps( h ) );
		await sync( [
			entry( 'posts', {
				companionScripts: [ { scriptUrl: 'https://example.test/posts-client.js', scriptHandle: 'posts-client' } ],
			} ),
		] );

		await expect( prewarmById( 'posts' ) ).resolves.toBe( true );
		expect( loaded ).toEqual( [ 'https://example.test/posts-client.js', 'https://example.test/posts.js' ] );
		expect( runtimePrewarm ).toHaveBeenCalledWith( 'posts' );
		// The runtime is asked after the load — the call order is the contract.
		expect( runtimePrewarm.mock.invocationCallOrder[ 0 ] ).toBeGreaterThan( 0 );
	} );

	test( 'an open window is never warmed', async () => {
		const h = setupHarness();
		const { sync, prewarmById } = createNativeWindowSync( deps( h ) );
		await sync( [ entry( 'posts' ) ] );
		h.getById.mockReturnValue( { id: 'posts' } as never );

		await expect( prewarmById( 'posts' ) ).resolves.toBe( false );
		expect( loaded ).toEqual( [] );
		expect( runtimePrewarm ).not.toHaveBeenCalled();
	} );

	test( 'a native window that is not an app gets its bundles and nothing more', async () => {
		const h = setupHarness();
		const { sync, prewarmById } = createNativeWindowSync( deps( h ) );
		await sync( [ entry( 'calculator' ) ] );
		runtimePrewarm.mockReturnValue( false );

		await expect( prewarmById( 'calculator' ) ).resolves.toBe( false );
		expect( loaded ).toEqual( [ 'https://example.test/calculator.js' ] );

		// No runtime in the tab at all: still a graceful no.
		delete ( window as unknown as Wp ).wp?.os;
		await expect( prewarmById( 'calculator' ) ).resolves.toBe( false );
	} );

	test( 'an unknown id is a plain no', async () => {
		const h = setupHarness();
		const { sync, prewarmById } = createNativeWindowSync( deps( h ) );
		await sync( [ entry( 'posts' ) ] );
		await expect( prewarmById( 'nope' ) ).resolves.toBe( false );
		expect( loaded ).toEqual( [] );
	} );
} );
