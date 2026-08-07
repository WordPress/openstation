/**
 * Regression tests for floating-menu viewport clamping.
 *
 * The bug these pin: `<os-context-menu>` renders its shadow DOM in a
 * `queueMicrotask()`, so a `getBoundingClientRect()` taken on the
 * line after `appendChild()` measures an empty box. The clamp read
 * that empty box, decided the menu fit, and left it to paint at full
 * height off the bottom of the viewport, leaving a dead zone along
 * the bottom of the desktop that got proportionally worse on short
 * screens.
 *
 * jsdom has no layout engine, so the stub below reproduces the one
 * property that matters: an `<os-context-menu>` measures as an empty
 * box until its render microtask has populated the shadow root, and
 * at full size afterwards. Against a synchronous clamp every test
 * here fails, because the menu never moves.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

/** Tall enough that it cannot fit below a click near the bottom. */
const MENU_HEIGHT = 276;
const MENU_WIDTH = 200;

const originalRect = Element.prototype.getBoundingClientRect;

/** Animation-frame callbacks parked by the stub, flushed by `frame()`. */
let frames: FrameRequestCallback[] = [];

function makeRect( left: number, top: number, w: number, h: number ): DOMRect {
	return {
		left,
		top,
		width: w,
		height: h,
		right: left + w,
		bottom: top + h,
		x: left,
		y: top,
		toJSON: () => ( {} ),
	} as DOMRect;
}

/** Run every parked animation-frame callback. */
function frame(): void {
	const queued = frames;
	frames = [];
	for ( const cb of queued ) {
		cb( 0 );
	}
}

/**
 * Let the component's render microtask run, then deliver the frame
 * the placement is waiting on.
 */
async function renderAndFrame(): Promise< void > {
	await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
	frame();
}

describe( 'floating menus clamp to the viewport', () => {
	beforeEach( () => {
		installHooksStub();
		frames = [];
		vi.stubGlobal( 'requestAnimationFrame', ( cb: FrameRequestCallback ) => {
			frames.push( cb );
			return frames.length;
		} );
		Element.prototype.getBoundingClientRect = function (
			this: Element,
		): DOMRect {
			const el = this as HTMLElement;
			if ( el.tagName.toLowerCase() !== 'os-context-menu' ) {
				return originalRect.call( this );
			}
			// The timing hole: no size until the render microtask has
			// run. `<os-context-menu>` renders a single `<slot>`, and
			// the shadow root holds nothing else that carries content
			// (style adoption stamps a `<style>` tag synchronously, so
			// child count alone would report "rendered" far too early).
			const rendered = el.shadowRoot?.querySelector( 'slot' ) !== null;
			const left = parseFloat( el.style.left ) || 0;
			const top = parseFloat( el.style.top ) || 0;
			return rendered
				? makeRect( left, top, MENU_WIDTH, MENU_HEIGHT )
				: makeRect( left, top, 0, 0 );
		};
	} );

	afterEach( () => {
		Element.prototype.getBoundingClientRect = originalRect;
		vi.unstubAllGlobals();
		clearHooksStub();
		document.body.innerHTML = '';
	} );

	test( 'the wallpaper menu opened near the bottom edge ends up on screen', async () => {
		vi.resetModules();
		const { openWallpaperMenu } = await import(
			'../../src/desktop-files/wallpaper-menu'
		);
		// Well inside the viewport, but not by MENU_HEIGHT.
		const clickY = window.innerHeight - 60;
		openWallpaperMenu( document.body, { x: 20, y: clickY }, [
			{ id: 'a', label: 'A', onClick: () => {} },
			{ id: 'b', label: 'B', onClick: () => {} },
		] );
		const menu = document.querySelector< HTMLElement >( 'os-context-menu' )!;
		expect( menu ).not.toBeNull();

		await renderAndFrame();

		const top = parseFloat( menu.style.top );
		expect( top ).toBeLessThan( clickY );
		expect( top + MENU_HEIGHT ).toBeLessThanOrEqual( window.innerHeight );
	} );

	test( 'the menu stays hidden until it has been placed', async () => {
		vi.resetModules();
		const { openWallpaperMenu } = await import(
			'../../src/desktop-files/wallpaper-menu'
		);
		openWallpaperMenu(
			document.body,
			{ x: 20, y: window.innerHeight - 60 },
			[ { id: 'a', label: 'A', onClick: () => {} } ],
		);
		const menu = document.querySelector< HTMLElement >( 'os-context-menu' )!;
		expect( menu.style.visibility ).toBe( 'hidden' );

		await renderAndFrame();

		expect( menu.style.visibility ).toBe( '' );
	} );

	test( 'a menu closed before its frame lands does not throw', async () => {
		vi.resetModules();
		const { openWallpaperMenu, closeWallpaperMenu } = await import(
			'../../src/desktop-files/wallpaper-menu'
		);
		openWallpaperMenu(
			document.body,
			{ x: 20, y: window.innerHeight - 60 },
			[ { id: 'a', label: 'A', onClick: () => {} } ],
		);
		closeWallpaperMenu();
		expect( () => frame() ).not.toThrow();
	} );

	test( 'the icon-canvas menu opened near the bottom edge ends up on screen', async () => {
		vi.resetModules();
		const { attachIconCanvasMenu } = await import( '../../src/icon-canvas/menu' );
		const canvas = document.createElement( 'div' );
		document.body.appendChild( canvas );
		attachIconCanvasMenu( canvas, { scope: 'test', onSort: () => {} } );

		const clickY = window.innerHeight - 60;
		canvas.dispatchEvent(
			new MouseEvent( 'contextmenu', {
				bubbles: true,
				clientX: 20,
				clientY: clickY,
			} ),
		);
		const menu = document.querySelector< HTMLElement >( 'os-context-menu' )!;
		expect( menu ).not.toBeNull();

		await renderAndFrame();

		expect(
			parseFloat( menu.style.top ) + MENU_HEIGHT,
		).toBeLessThanOrEqual( window.innerHeight );
	} );

	test( 'a submenu opened against a low anchor rides up into view', async () => {
		vi.resetModules();
		const { positionFlyout } = await import(
			'../../src/ui/util/menu-position'
		);
		const anchor = document.createElement( 'div' );
		Object.defineProperty( anchor, 'getBoundingClientRect', {
			value: () => makeRect( 40, window.innerHeight - 40, 180, 32 ),
		} );
		document.body.appendChild( anchor );
		const fly = document.createElement( 'os-context-menu' );
		fly.setAttribute( 'open', '' );
		document.body.appendChild( fly );

		positionFlyout( fly, anchor );
		await renderAndFrame();

		expect(
			parseFloat( fly.style.top ) + MENU_HEIGHT,
		).toBeLessThanOrEqual( window.innerHeight );
	} );
} );
