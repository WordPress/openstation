/**
 * A deferred native window's bundles are prefetched once the shell is
 * idle — so the first open is served from the HTTP cache — and never
 * executed early.
 *
 * What these tests pin:
 *
 *   - After a sync settles, every deferred window's companion scripts,
 *     own script and companion styles get a `<link rel="prefetch">`,
 *     in that order, and nothing is loaded.
 *   - A `preloadScript` window, or one opened before the idle tick,
 *     is already in the tab and gets no hint.
 *   - One hint per URL, however many windows share it or how many
 *     syncs arrive.
 *   - Save-Data and a 2G link skip the whole thing.
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
	managerOpen: ReturnType< typeof vi.fn >;
	desktopArea: HTMLElement;
}

function setupHarness(): Harness {
	document.body.innerHTML = '';
	document.head.innerHTML = '';
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
	return { dock, manager, managerOpen, desktopArea };
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

function hints(): Array< { href: string; as: string } > {
	return Array.from( document.head.querySelectorAll< HTMLLinkElement >( 'link[rel="prefetch"]' ) ).map( ( l ) => ( {
		href: l.href,
		as: l.as,
	} ) );
}

function setConnection( value: { saveData?: boolean; effectiveType?: string } | undefined ): void {
	Object.defineProperty( navigator, 'connection', { value, configurable: true } );
}

describe( 'native-windows — prefetching the deferred bundles', () => {
	let loaded: string[];
	let idle: unknown;

	beforeEach( () => {
		installHooksStub();
		__resetNativeWindowGeometryForTests();
		vi.useFakeTimers();
		loaded = [];
		vi.spyOn( vendorLoader, 'loadVendorScript' ).mockImplementation( async ( url: string ) => {
			loaded.push( url );
		} );
		// jsdom has no idle callback; pin the timer fallback either way.
		idle = ( window as unknown as { requestIdleCallback?: unknown } ).requestIdleCallback;
		( window as unknown as { requestIdleCallback?: unknown } ).requestIdleCallback = undefined;
		( window as unknown as { openStationNativeWindows?: unknown } ).openStationNativeWindows = {};
	} );

	afterEach( () => {
		( window as unknown as { requestIdleCallback?: unknown } ).requestIdleCallback = idle;
		setConnection( undefined );
		vi.useRealTimers();
		clearHooksStub();
		__resetNativeWindowGeometryForTests();
		vi.restoreAllMocks();
		document.body.innerHTML = '';
		document.head.innerHTML = '';
		delete ( window as unknown as { openStationNativeWindows?: unknown } ).openStationNativeWindows;
	} );

	test( 'after the sync settles, every deferred asset gets a prefetch hint — companions, bundle, styles, in that order — and nothing loads', async () => {
		const h = setupHarness();
		const { sync } = createNativeWindowSync( deps( h ) );
		await sync( [
			entry( 'posts', {
				companionScripts: [ { scriptUrl: 'https://example.test/posts-client.js', scriptHandle: 'posts-client' } ],
				companionStyles: [ { styleUrl: 'https://example.test/posts.css' } ],
			} ),
		] );

		expect( hints() ).toEqual( [] );
		vi.runAllTimers();

		expect( hints() ).toEqual( [
			{ href: 'https://example.test/posts-client.js', as: 'script' },
			{ href: 'https://example.test/posts.js', as: 'script' },
			{ href: 'https://example.test/posts.css', as: 'style' },
		] );
		expect( loaded ).toEqual( [] );
		expect( document.head.querySelector( 'script' ) ).toBeNull();
	} );

	test( 'a preloadScript window is already in the tab: no hint for it', async () => {
		const h = setupHarness();
		const { sync } = createNativeWindowSync( deps( h ) );
		await sync( [ entry( 'badge-poller', { preloadScript: true } ), entry( 'calculator' ) ] );
		vi.runAllTimers();

		expect( loaded ).toEqual( [ 'https://example.test/badge-poller.js' ] );
		expect( hints() ).toEqual( [ { href: 'https://example.test/calculator.js', as: 'script' } ] );
	} );

	test( 'a window opened before the idle tick is not hinted either', async () => {
		const h = setupHarness();
		const e = entry( 'calculator' );
		const tpl = document.createElement( 'template' );
		tpl.id = e.templateId;
		tpl.innerHTML = e.templateHtml;
		document.body.appendChild( tpl );
		const { sync, openById } = createNativeWindowSync( deps( h ) );
		await sync( [ e ] );

		openById( 'calculator' );
		const body = document.createElement( 'div' );
		await h.managerOpen.mock.calls[ 0 ][ 0 ].render( body );
		expect( loaded ).toEqual( [ 'https://example.test/calculator.js' ] );

		vi.runAllTimers();
		expect( hints() ).toEqual( [] );
	} );

	test( 'one hint per URL: shared bundles and repeated syncs never double up', async () => {
		const h = setupHarness();
		const { sync } = createNativeWindowSync( deps( h ) );
		const runtime = 'https://example.test/app-runtime.js';
		await sync( [
			entry( 'posts', { scriptUrl: runtime, companionScripts: [ { scriptUrl: 'https://example.test/posts-client.js', scriptHandle: 'posts-client' } ] } ),
			entry( 'pages', { scriptUrl: runtime, companionScripts: [ { scriptUrl: 'https://example.test/pages-client.js', scriptHandle: 'pages-client' } ] } ),
		] );
		vi.runAllTimers();
		await sync( [ entry( 'posts', { scriptUrl: runtime } ), entry( 'pages', { scriptUrl: runtime } ), entry( 'trash', { scriptUrl: runtime } ) ] );
		vi.runAllTimers();

		expect( hints().map( ( l ) => l.href ) ).toEqual( [
			'https://example.test/posts-client.js',
			runtime,
			'https://example.test/pages-client.js',
		] );
	} );

	test( 'Save-Data and a 2G link skip the prefetch', async () => {
		for ( const connection of [ { saveData: true }, { effectiveType: 'slow-2g' }, { effectiveType: '2g' } ] ) {
			const h = setupHarness();
			setConnection( connection );
			const { sync } = createNativeWindowSync( deps( h ) );
			await sync( [ entry( 'calculator' ) ] );
			vi.runAllTimers();
			expect( hints() ).toEqual( [] );
		}
		const h = setupHarness();
		setConnection( { effectiveType: '4g' } );
		const { sync } = createNativeWindowSync( deps( h ) );
		await sync( [ entry( 'calculator' ) ] );
		vi.runAllTimers();
		expect( hints() ).toHaveLength( 1 );
	} );
} );
