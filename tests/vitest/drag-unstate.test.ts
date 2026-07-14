/**
 * Regression tests for title-bar drag starting from a maximized OR
 * snapped state. Dragging should un-state the window under the
 * cursor *without* a CSS transition wobble — the `--dragging` class
 * has to be applied BEFORE the geometry change so the base window
 * transition doesn't briefly interpolate between maximized and
 * floating bounds.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { installHooksStub, clearHooksStub } from './helpers/hooks-stub';
import { handleDragStart } from '../../src/window/pointer';
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
	return {
		win,
		parent,
		cleanup: () => parent.remove(),
	};
}

/**
 * Helper: synthesize a pointerdown on the title bar at the given
 * clientX/Y. jsdom has no PointerEvent constructor, so we use a
 * plain MouseEvent shape and cast — `handleDragStart` only reads
 * `clientX`, `clientY`, `target`, `pointerId`.
 */
function fakePointer( target: HTMLElement, clientX: number, clientY: number ): PointerEvent {
	// Same jsdom caveat as `fakeMove` — clientX / clientY only stick
	// via `defineProperty`, not the init dict.
	const e = new MouseEvent( 'pointerdown', { button: 0, bubbles: true } );
	Object.defineProperty( e, 'target', { value: target } );
	Object.defineProperty( e, 'pointerId', { value: 1 } );
	Object.defineProperty( e, 'clientX', { value: clientX } );
	Object.defineProperty( e, 'clientY', { value: clientY } );
	return e as unknown as PointerEvent;
}

/**
 * Dispatch a synthetic pointermove on the title bar. Crosses the
 * DRAG_THRESHOLD (5 px) by default so the deferred un-state fires.
 * Pass `dx`/`dy` = 0 to simulate a click (no movement) without
 * triggering drag commit.
 *
 * jsdom's MouseEvent constructor doesn't always honor `clientX` /
 * `clientY` in the init dict, and `defineProperty` on a MouseEvent
 * object doesn't always stick either — the DOM's native getters
 * override. Use a plain `Event` whose custom props we fully own.
 */
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
		// Fake setPointerCapture — jsdom's titleBar doesn't implement
		// the Pointer Capture API.
		Object.defineProperty( win._titleBar, 'setPointerCapture', { value: () => { /* noop */ } } );
		// Fake getBoundingClientRect for the title bar so the cursor
		// ratio math is deterministic.
		Object.defineProperty( win._titleBar, 'getBoundingClientRect', {
			value: () => ( {
				left: 0, top: 0, right: 1600, bottom: 40,
				width: 1600, height: 40, x: 0, y: 0, toJSON: () => ( {} ),
			} ) as DOMRect,
		} );

		// Put the window in maximized state with saved floating
		// geometry. Inline styles reflect the maximized bounds.
		win.state = 'maximized';
		win.element.classList.add( 'desktop-mode-window--maximized' );
		win.element.style.left = '0px';
		win.element.style.top = '0px';
		win.element.style.width = '1600px';
		win.element.style.height = '900px';
		win._savedGeometry = { x: 40, y: 40, width: 800, height: 600 };

		// Grab at 75% of the title bar. Drag is armed but not
		// committed yet (threshold-gated).
		handleDragStart( win, fakePointer( win._titleBar, 1200, 20 ) );
		// Before the threshold crosses, the window stays maximized.
		expect( win.element.classList.contains( 'desktop-mode-window--maximized' ) ).toBe( true );

		// Move the pointer past the drag threshold so the un-state
		// commits. The anchor uses the CURRENT cursor position so
		// the window lands exactly under the pointer after the
		// commit — no catch-up frame.
		fakeMove( win._titleBar, 1200, 20, 20, 0 );

		// --dragging class present (transitions disabled) AND
		// --maximized class gone (un-state fired).
		expect( win.element.classList.contains( 'desktop-mode-window--dragging' ) ).toBe( true );
		expect( win.element.classList.contains( 'desktop-mode-window--maximized' ) ).toBe( false );
		// Floating size restored from the saved geometry.
		expect( win.element.style.width ).toBe( '800px' );
		expect( win.element.style.height ).toBe( '600px' );
		// Cursor ratio preserved. Cursor is now at clientX=1220
		// (started at 1200, dx=20). 75 % into an 800 px bar = 600 px,
		// so the new left = 1220 - 600 = 620.
		const left = parseInt( win.element.style.left, 10 );
		expect( 1220 - left ).toBe( 600 );
		expect( win.state ).toBe( 'normal' );
		cleanup();
	} );

	test( 'drag from SNAPPED-LEFT title bar un-snaps + restores floating size under cursor', () => {
		const handle = mountWindow( baseConfig() );
		const { win, cleanup } = handle;
		Object.defineProperty( win._titleBar, 'setPointerCapture', { value: () => { /* noop */ } } );
		Object.defineProperty( win._titleBar, 'getBoundingClientRect', {
			value: () => ( {
				left: 0, top: 0, right: 800, bottom: 40,
				width: 800, height: 40, x: 0, y: 0, toJSON: () => ( {} ),
			} ) as DOMRect,
		} );

		// Put the window in snapped-left state with saved floating
		// geometry that the snap commit stashed.
		win.state = 'snapped-left';
		win.element.classList.add( 'desktop-mode-window--snapped-left' );
		win.element.style.left = '0px';
		win.element.style.top = '0px';
		win.element.style.width = '800px';
		win.element.style.height = '900px';
		win._savedGeometry = { x: 40, y: 40, width: 640, height: 480 };

		handleDragStart( win, fakePointer( win._titleBar, 400, 20 ) );
		fakeMove( win._titleBar, 400, 20, 20, 0 );

		// All state classes cleared; window is floating again.
		expect( win.element.classList.contains( 'desktop-mode-window--snapped-left' ) ).toBe( false );
		expect( win.element.classList.contains( 'desktop-mode-window--snapped-right' ) ).toBe( false );
		expect( win.element.classList.contains( 'desktop-mode-window--dragging' ) ).toBe( true );
		expect( win.element.style.width ).toBe( '640px' );
		expect( win.element.style.height ).toBe( '480px' );
		expect( win.state ).toBe( 'normal' );
		cleanup();
	} );

	test( 'un-state position subtracts the desktop area origin (admin bar + dock)', () => {
		// Regression: clientX/Y are viewport-relative but style.left /
		// style.top resolve against the offsetParent (desktop area).
		// If an admin bar sits above the area and a dock to its left,
		// the un-state jump used to land the window that much lower /
		// more to the right than the cursor. Subtracting the parent's
		// `getBoundingClientRect().{left, top}` normalizes both sides
		// of the equation back to area-local space.
		const handle = mountWindow( baseConfig() );
		const { win, parent, cleanup } = handle;
		Object.defineProperty( win._titleBar, 'setPointerCapture', { value: () => { /* noop */ } } );
		Object.defineProperty( win._titleBar, 'getBoundingClientRect', {
			value: () => ( {
				// Maximized title bar lives at the top-left of the
				// desktop area, which itself sits at viewport
				// (56, 32) — 32 px admin bar + 56 px dock.
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
		win.element.classList.add( 'desktop-mode-window--maximized' );
		win.element.style.left = '0px';
		win.element.style.top = '0px';
		win.element.style.width = '1544px';
		win.element.style.height = '868px';
		win._savedGeometry = { x: 100, y: 100, width: 800, height: 600 };

		// Grab at viewport (800, 52). Title bar is 1544 wide starting
		// at x=56; cursor ratio = (800-56)/1544 ≈ 0.482.
		handleDragStart( win, fakePointer( win._titleBar, 800, 52 ) );
		// Cross the threshold with a 20 px right-move. Anchor uses
		// the CURRENT cursor position (820, 52).
		fakeMove( win._titleBar, 800, 52, 20, 0 );

		// Expected area-relative top: current cursor viewport y (52)
		// minus area top (32) minus half the title-bar height (20) = 0.
		expect( win.element.style.top ).toBe( '0px' );

		// Expected area-relative left: cursor viewport x (820) minus
		// area left (56) minus w * cursorRatio. w = 800, ratio ≈
		// 0.482, so left ≈ 820 - 56 - 385 ≈ 379.
		const left = parseInt( win.element.style.left, 10 );
		// Tolerance of 1 px for the ratio rounding.
		expect( left ).toBeGreaterThanOrEqual( 378 );
		expect( left ).toBeLessThanOrEqual( 380 );
		cleanup();
	} );

	test( 'un-snap from SNAPPED-LEFT clamps the anchor at the edge — no drag dead zone', () => {
		// Regression (DESKMOD-24): a snapped-LEFT window whose saved
		// floating width exceeds the half-screen used to re-anchor at
		// a NEGATIVE left. The drag offsets derived from that
		// unclamped position, so the move-loop clamp pinned the window
		// at x=0 until the cursor had traveled the whole overshoot —
		// the window slid along the left edge instead of following
		// the pointer.
		const handle = mountWindow( baseConfig() );
		const { win, cleanup } = handle;
		Object.defineProperty( win._titleBar, 'setPointerCapture', { value: () => { /* noop */ } } );
		// Snapped-left title bar spans the LEFT HALF of a 1600 px
		// desktop area.
		Object.defineProperty( win._titleBar, 'getBoundingClientRect', {
			value: () => ( {
				left: 0, top: 0, right: 800, bottom: 40,
				width: 800, height: 40, x: 0, y: 0, toJSON: () => ( {} ),
			} ) as DOMRect,
		} );

		win.state = 'snapped-left';
		win.element.classList.add( 'desktop-mode-window--snapped-left' );
		win.element.style.left = '0px';
		win.element.style.top = '0px';
		win.element.style.width = '800px';
		win.element.style.height = '900px';
		// Saved floating width (1200) is WIDER than the half-screen
		// (800) — the mid-bar grab ratio would anchor left at
		// 420 - 0.5 * 1200 = -180 without the clamp.
		win._savedGeometry = { x: 40, y: 40, width: 1200, height: 700 };

		handleDragStart( win, fakePointer( win._titleBar, 400, 20 ) );
		fakeMove( win._titleBar, 400, 20, 20, 0 );

		// The un-state committed at the clamped edge, not off-screen.
		expect( win.state ).toBe( 'normal' );
		expect( parseInt( win.element.style.left, 10 ) ).toBe( 0 );

		// The VERY NEXT move must translate 1:1 — cursor +100 px right
		// puts the window at left=100. Before the fix the offset math
		// kept x negative (clamped back to 0) until the cursor passed
		// the whole -180 px overshoot.
		fakeMove( win._titleBar, 400, 20, 120, 0 );
		expect( parseInt( win.element.style.left, 10 ) ).toBe( 100 );
		cleanup();
	} );

	test( 'drag from maximized WITHOUT saved geometry falls back to 60% of parent', () => {
		const handle = mountWindow( baseConfig() );
		const { win, cleanup } = handle;
		Object.defineProperty( win._titleBar, 'setPointerCapture', { value: () => { /* noop */ } } );
		Object.defineProperty( win._titleBar, 'getBoundingClientRect', {
			value: () => ( {
				left: 0, top: 0, right: 1600, bottom: 40,
				width: 1600, height: 40, x: 0, y: 0, toJSON: () => ( {} ),
			} ) as DOMRect,
		} );

		win.state = 'maximized';
		win.element.classList.add( 'desktop-mode-window--maximized' );
		win.element.style.width = '1600px';
		win.element.style.height = '900px';
		win._savedGeometry = null;

		handleDragStart( win, fakePointer( win._titleBar, 800, 20 ) );
		fakeMove( win._titleBar, 800, 20, 20, 0 );

		// Fallback is min(960, 60 % of 1600) = 960 clamped to 60 %.
		// parent.clientWidth = 1600 → 0.6 * 1600 = 960 → min(960,960) = 960.
		expect( win.element.style.width ).toBe( '960px' );
		// parent.clientHeight = 900 → 0.7 * 900 = 630 → min(640, 630) = 630.
		expect( win.element.style.height ).toBe( '630px' );
		cleanup();
	} );

	test( 'plain click (no movement) on maximized title bar leaves state untouched', () => {
		// THIS is the regression this whole refactor addresses: a
		// stationary click on a snapped/maximized title bar used to
		// un-state the window even when the user never meant to drag.
		const handle = mountWindow( baseConfig() );
		const { win, cleanup } = handle;
		Object.defineProperty( win._titleBar, 'setPointerCapture', { value: () => { /* noop */ } } );
		Object.defineProperty( win._titleBar, 'getBoundingClientRect', {
			value: () => ( {
				left: 0, top: 0, right: 1600, bottom: 40,
				width: 1600, height: 40, x: 0, y: 0, toJSON: () => ( {} ),
			} ) as DOMRect,
		} );

		win.state = 'maximized';
		win.element.classList.add( 'desktop-mode-window--maximized' );
		win.element.style.width = '1600px';
		win.element.style.height = '900px';
		win._savedGeometry = { x: 40, y: 40, width: 800, height: 600 };

		handleDragStart( win, fakePointer( win._titleBar, 800, 20 ) );
		// Simulate a 2 px jitter (below the 5 px threshold). Release.
		fakeMove( win._titleBar, 800, 20, 2, 0 );
		const up = new MouseEvent( 'pointerup', { bubbles: true } );
		Object.defineProperty( up, 'pointerId', { value: 1 } );
		win._titleBar.dispatchEvent( up );

		// Window remained maximized the whole time — no state change
		// fired, no classes removed, no `_isDragging` flip.
		expect( win.state ).toBe( 'maximized' );
		expect( win.element.classList.contains( 'desktop-mode-window--maximized' ) ).toBe( true );
		expect( win.element.classList.contains( 'desktop-mode-window--dragging' ) ).toBe( false );
		expect( win._isDragging ).toBe( false );
		cleanup();
	} );
} );
