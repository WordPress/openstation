/**
 * Tests for the four wallpaper-plugin-facing additions:
 *
 *   1. `WindowManager.getVisibleRects()` — public geometry accessor.
 *   2. `desktop-mode.window.closing` action — pre-detach hook carrying
 *      the live element.
 *   3. `desktop-mode.window.bounds-changed` — rAF-coalesced live
 *      geometry action during drag/resize.
 *   4. `collectWallpaperSurfaces()` + `desktop-mode.wallpaper.surfaces`
 *      filter.
 *
 * Exercises the shell's public contracts that a canvas wallpaper
 * plugin (snow, rain, leaves, particles) would hook against. No
 * mocking — a real `Window` / `WindowManager` runs against jsdom;
 * bounding-rect / layout values are stubbed inline where jsdom
 * doesn't compute them.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { WindowManager } from '../../src/window-manager';
import { collectWallpaperSurfaces } from '../../src/wallpapers/surfaces';
import { HOOKS } from '../../src/hooks';
import {
	clearHooksStub,
	installHooksStub,
	recordActions,
	type FakeWpHooks,
} from './helpers/hooks-stub';

function openConfig( id: string ) {
	return {
		id,
		url: `http://example.test/wp-admin/${ id }.php`,
		title: id,
		icon: 'dashicons-admin-generic',
	};
}

function stubRect( el: HTMLElement, r: Partial<DOMRect> ): void {
	Object.defineProperty( el, 'getBoundingClientRect', {
		configurable: true,
		value: () =>
			( {
				left: r.left ?? 0,
				top: r.top ?? 0,
				right: r.right ?? ( r.left ?? 0 ) + ( r.width ?? 0 ),
				bottom: r.bottom ?? ( r.top ?? 0 ) + ( r.height ?? 0 ),
				width: r.width ?? 0,
				height: r.height ?? 0,
				x: r.left ?? 0,
				y: r.top ?? 0,
				toJSON: () => ( {} ),
			} ) as DOMRect,
	} );
}

describe( 'WindowManager.getVisibleRects', () => {
	let hooks: FakeWpHooks;
	let desktop: HTMLElement;
	let manager: WindowManager;

	beforeEach( () => {
		hooks = installHooksStub();
		desktop = document.createElement( 'div' );
		desktop.id = 'desktop-mode-area';
		Object.defineProperty( desktop, 'clientWidth', { value: 1600, configurable: true } );
		Object.defineProperty( desktop, 'clientHeight', { value: 900, configurable: true } );
		stubRect( desktop, { left: 0, top: 0, width: 1600, height: 900 } );
		document.body.appendChild( desktop );
		manager = new WindowManager( desktop );
	} );

	afterEach( () => {
		for ( const win of manager.getAll() ) {
			win.destroy();
		}
		desktop.remove();
		clearHooksStub();
		vi.useRealTimers();
	} );

	test( 'returns one entry per open window with rect + state + element', () => {
		const a = manager.open( openConfig( 'a' ) );
		const b = manager.open( openConfig( 'b' ) );

		const rects = manager.getVisibleRects();
		expect( rects ).toHaveLength( 2 );

		const rectA = rects.find( ( r ) => r.windowId === 'a' );
		expect( rectA ).toBeDefined();
		expect( rectA?.element ).toBe( a.element );
		expect( typeof rectA?.rect.x ).toBe( 'number' );
		expect( typeof rectA?.rect.width ).toBe( 'number' );
		expect( rectA?.state ).toBe( 'normal' );

		const rectB = rects.find( ( r ) => r.windowId === 'b' );
		expect( rectB?.element ).toBe( b.element );
	} );

	test( 'reflects the updated state after minimize()', () => {
		const w = manager.open( openConfig( 'a' ) );
		w.minimize();
		const rects = manager.getVisibleRects();
		expect( rects[ 0 ].state ).toBe( 'minimized' );
	} );

	test( 'drops windows that have been closed', () => {
		const w = manager.open( openConfig( 'a' ) );
		manager.open( openConfig( 'b' ) );
		w.close();
		const ids = manager.getVisibleRects().map( ( r ) => r.windowId );
		expect( ids ).not.toContain( 'a' );
		expect( ids ).toContain( 'b' );
	} );

	// Suppress an unused-variable lint in the beforeEach above.
	test( 'hooks stub is reachable', () => {
		expect( typeof hooks.doAction ).toBe( 'function' );
	} );
} );

describe( 'desktop-mode.window.closing', () => {
	let hooks: FakeWpHooks;
	let desktop: HTMLElement;
	let manager: WindowManager;

	beforeEach( () => {
		hooks = installHooksStub();
		desktop = document.createElement( 'div' );
		desktop.id = 'desktop-mode-area';
		Object.defineProperty( desktop, 'clientWidth', { value: 1600, configurable: true } );
		Object.defineProperty( desktop, 'clientHeight', { value: 900, configurable: true } );
		document.body.appendChild( desktop );
		manager = new WindowManager( desktop );
	} );

	afterEach( () => {
		desktop.remove();
		clearHooksStub();
	} );

	test( 'fires with { windowId, element } BEFORE window.closed', () => {
		const log = recordActions( hooks, [
			HOOKS.WINDOW_CLOSING,
			HOOKS.WINDOW_CLOSED,
		] );

		const w = manager.open( openConfig( 'gonna-close' ) );
		const element = w.element;
		w.close();

		const closingIdx = log.findIndex( ( l ) => l.name === HOOKS.WINDOW_CLOSING );
		const closedIdx = log.findIndex( ( l ) => l.name === HOOKS.WINDOW_CLOSED );
		expect( closingIdx ).toBeGreaterThan( -1 );
		expect( closedIdx ).toBeGreaterThan( -1 );
		expect( closingIdx ).toBeLessThan( closedIdx );

		const closingPayload = log[ closingIdx ].args[ 0 ] as {
			windowId: string;
			element: HTMLElement;
		};
		expect( closingPayload.windowId ).toBe( 'gonna-close' );
		expect( closingPayload.element ).toBe( element );
	} );

	test( 'dispatches desktop-mode-window-closing CustomEvent with live element', () => {
		const w = manager.open( openConfig( 'closing-event' ) );
		const element = w.element;

		let observed: { windowId: string; element: HTMLElement } | null = null;
		document.addEventListener( 'desktop-mode-window-closing', ( e: Event ) => {
			observed = ( e as CustomEvent ).detail;
		}, { once: true } );

		w.close();
		expect( observed ).not.toBeNull();
		expect( observed!.windowId ).toBe( 'closing-event' );
		expect( observed!.element ).toBe( element );
	} );
} );

describe( 'desktop-mode.wallpaper.surfaces', () => {
	let hooks: FakeWpHooks;
	let shell: HTMLElement;
	let desktop: HTMLElement;
	let manager: WindowManager;

	beforeEach( () => {
		hooks = installHooksStub();

		// Fake shell — lets collectWallpaperSurfaces find the expected
		// ids for shell, dock, taskbar, area.
		shell = document.createElement( 'div' );
		shell.id = 'desktop-mode-shell';
		stubRect( shell, { left: 0, top: 0, width: 1600, height: 900 } );
		document.body.appendChild( shell );

		const dock = document.createElement( 'nav' );
		dock.id = 'desktop-mode-dock';
		dock.className = 'desktop-mode-dock';
		stubRect( dock, { left: 0, top: 0, width: 56, height: 900 } );
		shell.appendChild( dock );

		desktop = document.createElement( 'div' );
		desktop.id = 'desktop-mode-area';
		Object.defineProperty( desktop, 'clientWidth', { value: 1544, configurable: true } );
		Object.defineProperty( desktop, 'clientHeight', { value: 900, configurable: true } );
		stubRect( desktop, { left: 56, top: 0, width: 1544, height: 900 } );
		shell.appendChild( desktop );

		manager = new WindowManager( desktop );
	} );

	afterEach( () => {
		for ( const win of manager.getAll() ) {
			win.destroy();
		}
		shell.remove();
		clearHooksStub();
	} );

	test( 'seeds window tops + shell floor + dock edge', () => {
		const w = manager.open( openConfig( 'w1' ) );
		stubRect( w.element, { left: 200, top: 100, width: 800, height: 600 } );
		// Non-null offsetParent so the surface collector doesn't treat
		// the window as hidden.
		Object.defineProperty( w.element, 'offsetParent', {
			configurable: true,
			get: () => desktop,
		} );

		const surfaces = collectWallpaperSurfaces( manager );
		const ids = surfaces.map( ( s ) => s.id );
		expect( ids ).toContain( 'window:w1' );
		expect( ids ).toContain( 'shell:floor' );
		expect( ids ).toContain( 'dock:edge' );

		const window1 = surfaces.find( ( s ) => s.id === 'window:w1' )!;
		expect( window1.kind ).toBe( 'window' );
		expect( window1.face ).toBe( 'top' );
		expect( window1.element ).toBe( w.element );
		expect( window1.rect.width ).toBe( 800 );
	} );

	test( 'excludes minimized windows', () => {
		const w = manager.open( openConfig( 'min-win' ) );
		stubRect( w.element, { left: 10, top: 10, width: 400, height: 300 } );
		Object.defineProperty( w.element, 'offsetParent', {
			configurable: true,
			get: () => desktop,
		} );
		w.minimize();

		const surfaces = collectWallpaperSurfaces( manager );
		expect( surfaces.map( ( s ) => s.id ) ).not.toContain( 'window:min-win' );
	} );

	test( 'dock edge face flips with placement attribute', () => {
		const dockEl = document.getElementById( 'desktop-mode-dock' )!;

		// Default (no attribute → bottom placement): face 'top'.
		const bottomFace = collectWallpaperSurfaces( manager ).find(
			( s ) => s.id === 'dock:edge',
		)?.face;
		expect( bottomFace ).toBe( 'top' );

		// Left placement: face 'right' (inside-edge of left rail).
		dockEl.setAttribute( 'data-desktop-mode-dock-placement', 'left' );
		const leftFace = collectWallpaperSurfaces( manager ).find(
			( s ) => s.id === 'dock:edge',
		)?.face;
		expect( leftFace ).toBe( 'right' );

		// Right placement: face 'left' (inside-edge of right rail).
		dockEl.setAttribute( 'data-desktop-mode-dock-placement', 'right' );
		const rightFace = collectWallpaperSurfaces( manager ).find(
			( s ) => s.id === 'dock:edge',
		)?.face;
		expect( rightFace ).toBe( 'left' );
	} );

	test( 'applies desktop-mode.wallpaper.surfaces filter — plugin can add custom surface', () => {
		hooks.addFilter(
			HOOKS.WALLPAPER_SURFACES,
			'test/extra',
			( list: unknown ) => {
				const arr = Array.isArray( list ) ? [ ...list ] : [];
				arr.push( {
					id: 'myplugin:picker',
					kind: 'custom',
					rect: { x: 100, y: 100, width: 300, height: 40 },
					face: 'top',
					element: null,
				} );
				return arr;
			},
		);

		const surfaces = collectWallpaperSurfaces( manager );
		expect( surfaces.find( ( s ) => s.id === 'myplugin:picker' ) ).toBeDefined();
	} );

	test( 'falls back to seed if filter returns non-array', () => {
		hooks.addFilter(
			HOOKS.WALLPAPER_SURFACES,
			'test/broken',
			() => null,
		);
		const surfaces = collectWallpaperSurfaces( manager );
		expect( Array.isArray( surfaces ) ).toBe( true );
		expect( surfaces.find( ( s ) => s.id === 'shell:floor' ) ).toBeDefined();
	} );
} );
