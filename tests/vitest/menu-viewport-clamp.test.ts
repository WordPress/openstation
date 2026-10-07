import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { menuStyles } from '../../src/ui/components/os-context-menu/os-context-menu.styles';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

const MENU_HEIGHT = 276;
const MENU_WIDTH = 200;

const originalRect = Element.prototype.getBoundingClientRect;

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

function frame(): void {
	const queued = frames;
	frames = [];
	for ( const cb of queued ) {
		cb( 0 );
	}
}

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

	test( 'the shared selection menu opened near the bottom edge ends up on screen', async () => {
		vi.resetModules();
		const { openActionMenu } = await import( '../../src/selection/menu' );
		const clickY = window.innerHeight - 60;

		openActionMenu(
			{ x: 20, y: clickY },
			{
				scope: 'test',
				actions: [
					{ id: 'open', label: 'Open', onClick: () => {} },
					{ id: 'rename', label: 'Rename', onClick: () => {} },
					{ id: 'trash', label: 'Trash', onClick: () => {} },
				],
			},
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

describe( 'a menu taller than the screen', () => {

	test( 'caps itself to the viewport and scrolls inside', () => {
		const open = menuStyles.cssText.split( ':host( [ open ] ) {' )[ 1 ]?.split( '}' )[ 0 ] ?? '';
		expect( open ).toContain( 'max-block-size: calc( 100vh - 16px )' );
		expect( open ).toContain( 'max-block-size: calc( 100dvh - 16px )' );
		expect( open ).toContain( 'overflow-y: auto' );
		expect( open ).toContain( 'box-sizing: border-box' );
	} );
} );
