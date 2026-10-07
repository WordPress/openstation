import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { installHooksStub, clearHooksStub } from './helpers/hooks-stub';
import { clampWindowPosition, handleDragStart } from '../../src/window/pointer';
import { Window } from '../../src/window';
import type { WindowConfig } from '../../src/types';

function baseConfig( overrides: Partial< WindowConfig > = {} ): WindowConfig {
	return {
		id: 'w1',
		url: 'http://example.test/wp-admin/edit.php',
		title: 'Editor',
		icon: 'dashicons-admin-post',
		x: 40,
		y: 40,
		width: 800,
		height: 600,
		minWidth: 320,
		minHeight: 200,
		...overrides,
	};
}

function mountWindow( cfg: WindowConfig ): {
	win: Window;
	parent: HTMLElement;
	cleanup: () => void;
} {
	const parent = document.createElement( 'div' );
	Object.defineProperty( parent, 'clientWidth', { value: 1600, configurable: true } );
	Object.defineProperty( parent, 'clientHeight', { value: 900, configurable: true } );
	document.body.appendChild( parent );
	const win = new Window( cfg );
	parent.appendChild( win.element );

	Object.defineProperty( win.element, 'offsetWidth', {
		get: () => parseInt( win.element.style.width, 10 ) || 0,
		configurable: true,
	} );
	Object.defineProperty( win.element, 'offsetHeight', {
		get: () => parseInt( win.element.style.height, 10 ) || 0,
		configurable: true,
	} );

	return {
		win,
		parent,
		cleanup: () => parent.remove(),
	};
}

function fakePointer( target: HTMLElement, clientX: number, clientY: number ): PointerEvent {

	const e = new MouseEvent( 'pointerdown', { button: 0, bubbles: true } );
	Object.defineProperty( e, 'target', { value: target } );
	Object.defineProperty( e, 'pointerId', { value: 1 } );
	Object.defineProperty( e, 'clientX', { value: clientX } );
	Object.defineProperty( e, 'clientY', { value: clientY } );
	return e as unknown as PointerEvent;
}

function fakeMove( titleBar: HTMLElement, startX: number, startY: number, dx = 20, dy = 0 ): void {
	const ev = new Event( 'pointermove', { bubbles: true } );
	Object.defineProperty( ev, 'pointerId', { value: 1 } );
	Object.defineProperty( ev, 'clientX', { value: startX + dx } );
	Object.defineProperty( ev, 'clientY', { value: startY + dy } );
	Object.defineProperty( ev, 'button', { value: 0 } );
	titleBar.dispatchEvent( ev );
}

describe( 'drag auto-unstate', () => {
	beforeEach( () => {
		installHooksStub();
	} );
	afterEach( () => {
		clearHooksStub();
	} );

	test( 'drag from MAXIMIZED title bar applies --dragging before geometry change', () => {
		const handle = mountWindow( baseConfig() );
		const { win, cleanup } = handle;

		Object.defineProperty( win._titleBar, 'setPointerCapture', { value: () => {            } } );

		Object.defineProperty( win._titleBar, 'getBoundingClientRect', {
			value: () => ( {
				left: 0, top: 0, right: 1600, bottom: 40,
				width: 1600, height: 40, x: 0, y: 0, toJSON: () => ( {} ),
			} ) as DOMRect,
		} );

		win.state = 'maximized';
		win.element.classList.add( 'os-window--maximized' );
		win.element.style.left = '0px';
		win.element.style.top = '0px';
		win.element.style.width = '1600px';
		win.element.style.height = '900px';
		win._savedGeometry = { x: 40, y: 40, width: 800, height: 600 };

		handleDragStart( win, fakePointer( win._titleBar, 1200, 20 ) );

		expect( win.element.classList.contains( 'os-window--maximized' ) ).toBe( true );

		fakeMove( win._titleBar, 1200, 20, 20, 0 );

		expect( win.element.classList.contains( 'os-window--dragging' ) ).toBe( true );
		expect( win.element.classList.contains( 'os-window--maximized' ) ).toBe( false );

		expect( win.element.style.width ).toBe( '800px' );
		expect( win.element.style.height ).toBe( '600px' );

		const left = parseInt( win.element.style.left, 10 );
		expect( 1220 - left ).toBe( 600 );
		expect( win.state ).toBe( 'normal' );
		cleanup();
	} );

	test( 'drag from SNAPPED-LEFT title bar un-snaps + restores floating size under cursor', () => {
		const handle = mountWindow( baseConfig() );
		const { win, cleanup } = handle;
		Object.defineProperty( win._titleBar, 'setPointerCapture', { value: () => {            } } );
		Object.defineProperty( win._titleBar, 'getBoundingClientRect', {
			value: () => ( {
				left: 0, top: 0, right: 800, bottom: 40,
				width: 800, height: 40, x: 0, y: 0, toJSON: () => ( {} ),
			} ) as DOMRect,
		} );

		win.state = 'snapped-left';
		win.element.classList.add( 'os-window--snapped-left' );
		win.element.style.left = '0px';
		win.element.style.top = '0px';
		win.element.style.width = '800px';
		win.element.style.height = '900px';
		win._savedGeometry = { x: 40, y: 40, width: 640, height: 480 };

		handleDragStart( win, fakePointer( win._titleBar, 400, 20 ) );
		fakeMove( win._titleBar, 400, 20, 20, 0 );

		expect( win.element.classList.contains( 'os-window--snapped-left' ) ).toBe( false );
		expect( win.element.classList.contains( 'os-window--snapped-right' ) ).toBe( false );
		expect( win.element.classList.contains( 'os-window--dragging' ) ).toBe( true );
		expect( win.element.style.width ).toBe( '640px' );
		expect( win.element.style.height ).toBe( '480px' );
		expect( win.state ).toBe( 'normal' );
		cleanup();
	} );

	test( 'un-state position subtracts the desktop area origin (admin bar + dock)', () => {

		const handle = mountWindow( baseConfig() );
		const { win, parent, cleanup } = handle;
		Object.defineProperty( win._titleBar, 'setPointerCapture', { value: () => {            } } );
		Object.defineProperty( win._titleBar, 'getBoundingClientRect', {
			value: () => ( {

				left: 56, top: 32, right: 1600, bottom: 72,
				width: 1544, height: 40, x: 56, y: 32, toJSON: () => ( {} ),
			} ) as DOMRect,
		} );
		Object.defineProperty( parent, 'getBoundingClientRect', {
			value: () => ( {
				left: 56, top: 32, right: 1600, bottom: 900,
				width: 1544, height: 868, x: 56, y: 32, toJSON: () => ( {} ),
			} ) as DOMRect,
		} );

		win.state = 'maximized';
		win.element.classList.add( 'os-window--maximized' );
		win.element.style.left = '0px';
		win.element.style.top = '0px';
		win.element.style.width = '1544px';
		win.element.style.height = '868px';
		win._savedGeometry = { x: 100, y: 100, width: 800, height: 600 };

		handleDragStart( win, fakePointer( win._titleBar, 800, 52 ) );

		fakeMove( win._titleBar, 800, 52, 20, 0 );

		expect( win.element.style.top ).toBe( '0px' );

		const left = parseInt( win.element.style.left, 10 );

		expect( left ).toBeGreaterThanOrEqual( 378 );
		expect( left ).toBeLessThanOrEqual( 380 );
		cleanup();
	} );

	test( 'un-snap from SNAPPED-LEFT clamps the anchor at the edge — no drag dead zone', () => {

		const handle = mountWindow( baseConfig() );
		const { win, cleanup } = handle;
		Object.defineProperty( win._titleBar, 'setPointerCapture', { value: () => {            } } );

		Object.defineProperty( win._titleBar, 'getBoundingClientRect', {
			value: () => ( {
				left: 0, top: 0, right: 800, bottom: 40,
				width: 800, height: 40, x: 0, y: 0, toJSON: () => ( {} ),
			} ) as DOMRect,
		} );

		win.state = 'snapped-left';
		win.element.classList.add( 'os-window--snapped-left' );
		win.element.style.left = '0px';
		win.element.style.top = '0px';
		win.element.style.width = '800px';
		win.element.style.height = '900px';

		win._savedGeometry = { x: 40, y: 40, width: 1200, height: 700 };

		handleDragStart( win, fakePointer( win._titleBar, 400, 20 ) );
		fakeMove( win._titleBar, 400, 20, 20, 0 );

		expect( win.state ).toBe( 'normal' );
		expect( parseInt( win.element.style.left, 10 ) ).toBe( 0 );

		fakeMove( win._titleBar, 400, 20, 120, 0 );
		expect( parseInt( win.element.style.left, 10 ) ).toBe( 100 );
		cleanup();
	} );

	test( 'drag from maximized WITHOUT saved geometry falls back to 60% of parent', () => {
		const handle = mountWindow( baseConfig() );
		const { win, cleanup } = handle;
		Object.defineProperty( win._titleBar, 'setPointerCapture', { value: () => {            } } );
		Object.defineProperty( win._titleBar, 'getBoundingClientRect', {
			value: () => ( {
				left: 0, top: 0, right: 1600, bottom: 40,
				width: 1600, height: 40, x: 0, y: 0, toJSON: () => ( {} ),
			} ) as DOMRect,
		} );

		win.state = 'maximized';
		win.element.classList.add( 'os-window--maximized' );
		win.element.style.width = '1600px';
		win.element.style.height = '900px';
		win._savedGeometry = null;

		handleDragStart( win, fakePointer( win._titleBar, 800, 20 ) );
		fakeMove( win._titleBar, 800, 20, 20, 0 );

		expect( win.element.style.width ).toBe( '960px' );

		expect( win.element.style.height ).toBe( '630px' );
		cleanup();
	} );

	test( 'plain click (no movement) on maximized title bar leaves state untouched', () => {

		const handle = mountWindow( baseConfig() );
		const { win, cleanup } = handle;
		Object.defineProperty( win._titleBar, 'setPointerCapture', { value: () => {            } } );
		Object.defineProperty( win._titleBar, 'getBoundingClientRect', {
			value: () => ( {
				left: 0, top: 0, right: 1600, bottom: 40,
				width: 1600, height: 40, x: 0, y: 0, toJSON: () => ( {} ),
			} ) as DOMRect,
		} );

		win.state = 'maximized';
		win.element.classList.add( 'os-window--maximized' );
		win.element.style.width = '1600px';
		win.element.style.height = '900px';
		win._savedGeometry = { x: 40, y: 40, width: 800, height: 600 };

		handleDragStart( win, fakePointer( win._titleBar, 800, 20 ) );

		fakeMove( win._titleBar, 800, 20, 2, 0 );
		const up = new MouseEvent( 'pointerup', { bubbles: true } );
		Object.defineProperty( up, 'pointerId', { value: 1 } );
		win._titleBar.dispatchEvent( up );

		expect( win.state ).toBe( 'maximized' );
		expect( win.element.classList.contains( 'os-window--maximized' ) ).toBe( true );
		expect( win.element.classList.contains( 'os-window--dragging' ) ).toBe( false );
		expect( win._isDragging ).toBe( false );
		cleanup();
	} );

	test( 'drag bounds: allows bleeding off left, right, and bottom up to GRAB_MARGIN, locks top at y=0', () => {
		const handle = mountWindow( baseConfig() );
		const { win, cleanup } = handle;
		Object.defineProperty( win._titleBar, 'setPointerCapture', { value: () => {            } } );
		Object.defineProperty( win._titleBar, 'getBoundingClientRect', {
			value: () => ( {
				left: 100, top: 100, right: 900, bottom: 140,
				width: 800, height: 40, x: 100, y: 100, toJSON: () => ( {} ),
			} ) as DOMRect,
		} );

		win.element.style.left = '100px';
		win.element.style.top = '100px';
		win.element.style.width = '800px';
		win.element.style.height = '600px';

		handleDragStart( win, fakePointer( win._titleBar, 150, 110 ) );

		fakeMove( win._titleBar, 150, 110, -1000, 0 );
		expect( parseInt( win.element.style.left, 10 ) ).toBe( -760 );

		fakeMove( win._titleBar, 150, 110, 0, -1000 );
		expect( parseInt( win.element.style.top, 10 ) ).toBe( 0 );

		fakeMove( win._titleBar, 150, 110, 3000, 0 );
		expect( parseInt( win.element.style.left, 10 ) ).toBe( 1560 );

		fakeMove( win._titleBar, 150, 110, 0, 3000 );
		expect( parseInt( win.element.style.top, 10 ) ).toBe( 860 );

		cleanup();
	} );
} );

describe( 'clampWindowPosition', () => {
	const bounds = { x: 0, y: 0, width: 1600, height: 900 };

	test( 'clamps left/right/bottom to GRAB_MARGIN and top to EDGE_MARGIN', () => {

		expect( clampWindowPosition( 100, 100, 800, bounds ) ).toEqual( { x: 100, y: 100 } );

		expect( clampWindowPosition( -1000, 100, 800, bounds ) ).toEqual( { x: -760, y: 100 } );

		expect( clampWindowPosition( 100, -500, 800, bounds ) ).toEqual( { x: 100, y: 0 } );

		expect( clampWindowPosition( 2000, 100, 800, bounds ) ).toEqual( { x: 1560, y: 100 } );

		expect( clampWindowPosition( 100, 2000, 800, bounds ) ).toEqual( { x: 100, y: 860 } );
	} );

	test( 'clamps against the work area, not the desktop area', () => {

		const workArea = { x: 60, y: 0, width: 1540, height: 820 };

		expect( clampWindowPosition( 100, 2000, 800, workArea ) ).toEqual( { x: 100, y: 780 } );

		expect( clampWindowPosition( -1000, 100, 800, workArea ) ).toEqual( { x: -700, y: 100 } );

		expect( clampWindowPosition( 2000, 100, 800, workArea ) ).toEqual( { x: 1560, y: 100 } );
	} );
} );
