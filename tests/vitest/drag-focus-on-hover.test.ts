/**
 * Unit tests for focus-on-drag-hover.
 *
 * The module is driven entirely by `DRAG_EVENTS` CustomEvents on
 * `document`, so no real DragManager is needed — the tests dispatch
 * MOVE/END directly and assert against a fake focus host.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { installHooksStub, clearHooksStub } from './helpers/hooks-stub';
import { addFilter, HOOKS } from '../../src/hooks';
import { DRAG_EVENTS } from '../../src/drag/types';
import { DRAG_BRIDGE_EVENTS } from '../../src/drag-bridge';
import {
	DRAG_HOVER_MESSAGE_TYPE,
	FOCUS_ON_DRAG_HOVER_DWELL_MS,
	FOCUS_ON_DRAG_HOVER_WATCHDOG_MS,
	installFocusWindowOnDragHover,
	__resetFocusWindowOnDragHoverForTests,
	type FocusableWindow,
} from '../../src/drag/focus-window-on-drag-hover';
import {
	findWindowRootAtPoint,
	windowIdFromRoot,
} from '../../src/drag/window-at-point';

interface Rect { x: number; y: number; w: number; h: number }

/**
 * Build a window root (`.os-window` + `wp-window-<id>`)
 * with an inner body element — `elementFromPoint` in the real shell
 * returns an inner element, never the root itself.
 */
function makeWindowRoot( id: string ): { root: HTMLElement; inner: HTMLElement } {
	const root = document.createElement( 'div' );
	root.className = 'os-window';
	root.id = `wp-window-${ id }`;
	const inner = document.createElement( 'div' );
	inner.className = 'os-window__body';
	root.appendChild( inner );
	document.body.appendChild( root );
	return { root, inner };
}

/**
 * jsdom computes no layout, so hit-testing is stubbed: each region
 * maps a client-space rect to the element `elementFromPoint` should
 * return there. Later regions win on overlap.
 */
function installElementFromPointStub( regions: Array< { el: Element; rect: Rect } > ): void {
	document.elementFromPoint = ( x: number, y: number ): Element | null => {
		for ( let i = regions.length - 1; i >= 0; i -= 1 ) {
			const { el, rect } = regions[ i ];
			if ( x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h ) {
				return el;
			}
		}
		return null;
	};
}

function makeFakeWindow( id: string, focused = false ): FocusableWindow & { id: string; focused: boolean } {
	return {
		id,
		focused,
		isFocused() {
			return this.focused;
		},
	};
}

function makeHost( windows: Array< ReturnType< typeof makeFakeWindow > > ) {
	return {
		windows,
		getById: vi.fn( ( id: string ) => windows.find( ( w ) => w.id === id ) ),
		focus: vi.fn(),
	};
}

function dispatchMove( clientX: number, clientY: number, payloadType = 'desktop-file' ): void {
	document.dispatchEvent(
		new CustomEvent( DRAG_EVENTS.MOVE, {
			detail: {
				payload: { type: payloadType, source: document.body, data: {} },
				clientX,
				clientY,
			},
		} ),
	);
}

function dispatchEnd(): void {
	document.dispatchEvent(
		new CustomEvent( DRAG_EVENTS.END, {
			detail: { payload: { type: 'desktop-file' }, reason: 'commit' },
		} ),
	);
}

/**
 * jsdom doesn't construct `DragEvent`s — synthesize a plain Event
 * with the fields the module reads, same trick as `pointerEvent` in
 * `drag-manager.test.ts`.
 */
function dragEvent(
	type: 'dragover' | 'drop' | 'dragend' | 'dragleave',
	opts: {
		clientX?: number;
		clientY?: number;
		relatedTarget?: EventTarget | null;
		types?: string[];
	} = {},
): Event {
	const ev = new Event( type, { bubbles: true } );
	Object.defineProperty( ev, 'clientX', { value: opts.clientX ?? 0 } );
	Object.defineProperty( ev, 'clientY', { value: opts.clientY ?? 0 } );
	Object.defineProperty( ev, 'relatedTarget', {
		value: opts.relatedTarget ?? null,
	} );
	Object.defineProperty( ev, 'dataTransfer', {
		value: { types: opts.types ?? [] },
	} );
	return ev;
}

describe( 'focus-on-drag-hover', () => {
	beforeEach( () => {
		installHooksStub();
		vi.useFakeTimers();
		document.elementFromPoint = () => null;
	} );

	afterEach( () => {
		__resetFocusWindowOnDragHoverForTests();
		vi.useRealTimers();
		clearHooksStub();
		document.body.innerHTML = '';
	} );

	test( 'hovering an unfocused window for the dwell raises it once', () => {
		const b = makeWindowRoot( 'b' );
		installElementFromPointStub( [ { el: b.inner, rect: { x: 0, y: 0, w: 100, h: 100 } } ] );
		const winB = makeFakeWindow( 'b' );
		const host = makeHost( [ winB ] );
		installFocusWindowOnDragHover( host );

		dispatchMove( 50, 50 );
		expect( host.focus ).not.toHaveBeenCalled();

		vi.advanceTimersByTime( FOCUS_ON_DRAG_HOVER_DWELL_MS );
		expect( host.focus ).toHaveBeenCalledTimes( 1 );
		expect( host.focus ).toHaveBeenCalledWith( winB );
	} );

	test( 'leaving for the wallpaper before the dwell elapses cancels the raise', () => {
		const b = makeWindowRoot( 'b' );
		installElementFromPointStub( [ { el: b.inner, rect: { x: 0, y: 0, w: 100, h: 100 } } ] );
		const host = makeHost( [ makeFakeWindow( 'b' ) ] );
		installFocusWindowOnDragHover( host );

		dispatchMove( 50, 50 );
		vi.advanceTimersByTime( FOCUS_ON_DRAG_HOVER_DWELL_MS - 50 );
		dispatchMove( 500, 500 ); // wallpaper — no window
		vi.advanceTimersByTime( 1000 );
		expect( host.focus ).not.toHaveBeenCalled();
	} );

	test( 'crossing B then C within the dwell focuses only C', () => {
		const b = makeWindowRoot( 'b' );
		const c = makeWindowRoot( 'c' );
		installElementFromPointStub( [
			{ el: b.inner, rect: { x: 0, y: 0, w: 100, h: 100 } },
			{ el: c.inner, rect: { x: 100, y: 0, w: 100, h: 100 } },
		] );
		const winB = makeFakeWindow( 'b' );
		const winC = makeFakeWindow( 'c' );
		const host = makeHost( [ winB, winC ] );
		installFocusWindowOnDragHover( host );

		dispatchMove( 50, 50 ); // over B
		vi.advanceTimersByTime( FOCUS_ON_DRAG_HOVER_DWELL_MS - 50 );
		dispatchMove( 150, 50 ); // over C — restarts the dwell
		vi.advanceTimersByTime( FOCUS_ON_DRAG_HOVER_DWELL_MS );
		expect( host.focus ).toHaveBeenCalledTimes( 1 );
		expect( host.focus ).toHaveBeenCalledWith( winC );
	} );

	test( 'repeated moves over the same window do not restart the dwell', () => {
		const b = makeWindowRoot( 'b' );
		installElementFromPointStub( [ { el: b.inner, rect: { x: 0, y: 0, w: 100, h: 100 } } ] );
		const host = makeHost( [ makeFakeWindow( 'b' ) ] );
		installFocusWindowOnDragHover( host );

		dispatchMove( 20, 20 );
		vi.advanceTimersByTime( FOCUS_ON_DRAG_HOVER_DWELL_MS / 2 );
		dispatchMove( 60, 60 ); // still over B
		vi.advanceTimersByTime( FOCUS_ON_DRAG_HOVER_DWELL_MS / 2 );
		// Fires at the original deadline — the second move didn't reset it.
		expect( host.focus ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'an already-focused window (the drag source) is not re-focused', () => {
		const a = makeWindowRoot( 'a' );
		installElementFromPointStub( [ { el: a.inner, rect: { x: 0, y: 0, w: 100, h: 100 } } ] );
		const host = makeHost( [ makeFakeWindow( 'a', true ) ] );
		installFocusWindowOnDragHover( host );

		dispatchMove( 50, 50 );
		vi.advanceTimersByTime( FOCUS_ON_DRAG_HOVER_DWELL_MS );
		expect( host.focus ).not.toHaveBeenCalled();
	} );

	test( 'DRAG_EVENTS.END mid-dwell clears the pending raise', () => {
		const b = makeWindowRoot( 'b' );
		installElementFromPointStub( [ { el: b.inner, rect: { x: 0, y: 0, w: 100, h: 100 } } ] );
		const host = makeHost( [ makeFakeWindow( 'b' ) ] );
		installFocusWindowOnDragHover( host );

		dispatchMove( 50, 50 );
		dispatchEnd();
		vi.advanceTimersByTime( 1000 );
		expect( host.focus ).not.toHaveBeenCalled();
	} );

	test( 'the focus-on-drag-hover filter can veto, and receives the ctx', () => {
		const b = makeWindowRoot( 'b' );
		installElementFromPointStub( [ { el: b.inner, rect: { x: 0, y: 0, w: 100, h: 100 } } ] );
		const host = makeHost( [ makeFakeWindow( 'b' ) ] );
		installFocusWindowOnDragHover( host );

		const seenCtx: unknown[] = [];
		addFilter< boolean, [ { windowId: string; payloadType: string } ] >(
			HOOKS.WINDOW_FOCUS_ON_DRAG_HOVER,
			'test/veto',
			( _value, ctx ) => {
				seenCtx.push( ctx );
				return false;
			},
		);

		dispatchMove( 50, 50, 'shortcut' );
		vi.advanceTimersByTime( FOCUS_ON_DRAG_HOVER_DWELL_MS );
		expect( host.focus ).not.toHaveBeenCalled();
		expect( seenCtx ).toEqual( [ { windowId: 'b', payloadType: 'shortcut' } ] );
	} );

	test( 'window closed mid-dwell is a silent no-op', () => {
		const b = makeWindowRoot( 'b' );
		installElementFromPointStub( [ { el: b.inner, rect: { x: 0, y: 0, w: 100, h: 100 } } ] );
		const host = makeHost( [] ); // getById finds nothing
		installFocusWindowOnDragHover( host );

		dispatchMove( 50, 50 );
		expect( () => vi.advanceTimersByTime( FOCUS_ON_DRAG_HOVER_DWELL_MS ) ).not.toThrow();
		expect( host.focus ).not.toHaveBeenCalled();
	} );

	test( 're-hovering a window it already focused does not re-fire', () => {
		const b = makeWindowRoot( 'b' );
		installElementFromPointStub( [ { el: b.inner, rect: { x: 0, y: 0, w: 100, h: 100 } } ] );
		const winB = makeFakeWindow( 'b' );
		const host = makeHost( [ winB ] );
		host.focus.mockImplementation( () => {
			winB.focused = true;
		} );
		installFocusWindowOnDragHover( host );

		dispatchMove( 50, 50 );
		vi.advanceTimersByTime( FOCUS_ON_DRAG_HOVER_DWELL_MS );
		expect( host.focus ).toHaveBeenCalledTimes( 1 );

		// Leave, then come back — the window is focused now, so the
		// second dwell resolves to a no-op.
		dispatchMove( 500, 500 );
		dispatchMove( 50, 50 );
		vi.advanceTimersByTime( FOCUS_ON_DRAG_HOVER_DWELL_MS );
		expect( host.focus ).toHaveBeenCalledTimes( 1 );
	} );
} );

describe( 'focus-on-drag-hover — native HTML5 channel', () => {
	beforeEach( () => {
		installHooksStub();
		vi.useFakeTimers();
		document.elementFromPoint = () => null;
	} );

	afterEach( () => {
		__resetFocusWindowOnDragHoverForTests();
		vi.useRealTimers();
		clearHooksStub();
		document.body.innerHTML = '';
	} );

	test( 'a plain dragover hover raises the window after the dwell', () => {
		const b = makeWindowRoot( 'b' );
		installElementFromPointStub( [ { el: b.inner, rect: { x: 0, y: 0, w: 100, h: 100 } } ] );
		const winB = makeFakeWindow( 'b' );
		const host = makeHost( [ winB ] );
		installFocusWindowOnDragHover( host );

		document.dispatchEvent( dragEvent( 'dragover', { clientX: 50, clientY: 50 } ) );
		vi.advanceTimersByTime( FOCUS_ON_DRAG_HOVER_DWELL_MS );
		expect( host.focus ).toHaveBeenCalledTimes( 1 );
		expect( host.focus ).toHaveBeenCalledWith( winB );
	} );

	test( 'payloadType is os-file for Files drags, external otherwise, bridge kind when a session is live', () => {
		const b = makeWindowRoot( 'b' );
		installElementFromPointStub( [ { el: b.inner, rect: { x: 0, y: 0, w: 100, h: 100 } } ] );
		const winB = makeFakeWindow( 'b' );
		const host = makeHost( [ winB ] );
		installFocusWindowOnDragHover( host );

		const seenTypes: string[] = [];
		addFilter< boolean, [ { windowId: string; payloadType: string } ] >(
			HOOKS.WINDOW_FOCUS_ON_DRAG_HOVER,
			'test/collect',
			( value, ctx ) => {
				seenTypes.push( ctx.payloadType );
				return value;
			},
		);

		// OS file drag.
		document.dispatchEvent( dragEvent( 'dragover', { clientX: 50, clientY: 50, types: [ 'Files' ] } ) );
		vi.advanceTimersByTime( FOCUS_ON_DRAG_HOVER_DWELL_MS );
		document.dispatchEvent( dragEvent( 'drop' ) );

		// Arbitrary external drag (text/html).
		document.dispatchEvent( dragEvent( 'dragover', { clientX: 50, clientY: 50, types: [ 'text/html' ] } ) );
		vi.advanceTimersByTime( FOCUS_ON_DRAG_HOVER_DWELL_MS );
		document.dispatchEvent( dragEvent( 'dragend' ) );

		// Bridge session — kind takes precedence over DataTransfer sniffing.
		document.dispatchEvent(
			new CustomEvent( DRAG_BRIDGE_EVENTS.START, {
				detail: { payload: { kind: 'attachment', id: 1, url: '', title: '', alt: '', mime: 'image/jpeg' } },
			} ),
		);
		document.dispatchEvent( dragEvent( 'dragover', { clientX: 50, clientY: 50 } ) );
		vi.advanceTimersByTime( FOCUS_ON_DRAG_HOVER_DWELL_MS );

		expect( seenTypes ).toEqual( [ 'os-file', 'external', 'attachment' ] );
	} );

	test( 'drop and dragend clear a pending dwell', () => {
		const b = makeWindowRoot( 'b' );
		installElementFromPointStub( [ { el: b.inner, rect: { x: 0, y: 0, w: 100, h: 100 } } ] );
		const host = makeHost( [ makeFakeWindow( 'b' ) ] );
		installFocusWindowOnDragHover( host );

		document.dispatchEvent( dragEvent( 'dragover', { clientX: 50, clientY: 50 } ) );
		document.dispatchEvent( dragEvent( 'drop' ) );
		vi.advanceTimersByTime( 5000 );
		expect( host.focus ).not.toHaveBeenCalled();

		document.dispatchEvent( dragEvent( 'dragover', { clientX: 50, clientY: 50 } ) );
		document.dispatchEvent( dragEvent( 'dragend' ) );
		vi.advanceTimersByTime( 5000 );
		expect( host.focus ).not.toHaveBeenCalled();
	} );

	test( 'dragleave out of the document clears a pending dwell', () => {
		const b = makeWindowRoot( 'b' );
		installElementFromPointStub( [ { el: b.inner, rect: { x: 0, y: 0, w: 100, h: 100 } } ] );
		const host = makeHost( [ makeFakeWindow( 'b' ) ] );
		installFocusWindowOnDragHover( host );

		document.dispatchEvent( dragEvent( 'dragover', { clientX: 50, clientY: 50 } ) );
		document.dispatchEvent( dragEvent( 'dragleave', { relatedTarget: null } ) );
		vi.advanceTimersByTime( 5000 );
		expect( host.focus ).not.toHaveBeenCalled();
	} );

	test( 'a dragleave into another element does NOT clear the dwell', () => {
		const b = makeWindowRoot( 'b' );
		installElementFromPointStub( [ { el: b.inner, rect: { x: 0, y: 0, w: 100, h: 100 } } ] );
		const host = makeHost( [ makeFakeWindow( 'b' ) ] );
		installFocusWindowOnDragHover( host );

		document.dispatchEvent( dragEvent( 'dragover', { clientX: 50, clientY: 50 } ) );
		document.dispatchEvent( dragEvent( 'dragleave', { relatedTarget: b.inner } ) );
		vi.advanceTimersByTime( FOCUS_ON_DRAG_HOVER_DWELL_MS );
		expect( host.focus ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'watchdog silence resets the hover state so a later drag re-tracks', () => {
		const b = makeWindowRoot( 'b' );
		installElementFromPointStub( [ { el: b.inner, rect: { x: 0, y: 0, w: 100, h: 100 } } ] );
		const winB = makeFakeWindow( 'b' );
		const host = makeHost( [ winB ] );
		installFocusWindowOnDragHover( host );

		document.dispatchEvent( dragEvent( 'dragover', { clientX: 50, clientY: 50 } ) );
		vi.advanceTimersByTime( FOCUS_ON_DRAG_HOVER_DWELL_MS );
		expect( host.focus ).toHaveBeenCalledTimes( 1 );

		// Signals stop (drag ended out of sight). After the watchdog,
		// a fresh drag over the same still-unfocused window must
		// re-run the dwell rather than being swallowed by the
		// same-window check.
		vi.advanceTimersByTime( FOCUS_ON_DRAG_HOVER_WATCHDOG_MS );
		document.dispatchEvent( dragEvent( 'dragover', { clientX: 50, clientY: 50 } ) );
		vi.advanceTimersByTime( FOCUS_ON_DRAG_HOVER_DWELL_MS );
		expect( host.focus ).toHaveBeenCalledTimes( 2 );
	} );
} );

describe( 'focus-on-drag-hover — iframe message channel', () => {
	beforeEach( () => {
		installHooksStub();
		vi.useFakeTimers();
		document.elementFromPoint = () => null;
	} );

	afterEach( () => {
		__resetFocusWindowOnDragHoverForTests();
		vi.useRealTimers();
		clearHooksStub();
		document.body.innerHTML = '';
	} );

	/** Build a window host carrying an iframe, jsdom-style. */
	function makeIframeWindow( id: string ): HTMLIFrameElement {
		const hostEl = document.createElement( 'div' );
		hostEl.className = 'os-window';
		hostEl.id = `wp-window-${ id }`;
		hostEl.setAttribute( 'data-window-id', id );
		const iframe = document.createElement( 'iframe' );
		hostEl.appendChild( iframe );
		document.body.appendChild( hostEl );
		return iframe;
	}

	function dispatchHoverMessage(
		source: MessageEventSource | null,
		origin: string = window.location.origin,
		payloadType = 'os-file',
	): void {
		window.dispatchEvent(
			new MessageEvent( 'message', {
				origin,
				source,
				data: { type: DRAG_HOVER_MESSAGE_TYPE, payloadType },
			} ),
		);
	}

	test( 'a hover heartbeat from an iframe window raises that window after the dwell', () => {
		const iframe = makeIframeWindow( 'post-editor' );
		const win = makeFakeWindow( 'post-editor' );
		const host = makeHost( [ win ] );
		installFocusWindowOnDragHover( host );

		dispatchHoverMessage( iframe.contentWindow );
		expect( host.focus ).not.toHaveBeenCalled();
		vi.advanceTimersByTime( FOCUS_ON_DRAG_HOVER_DWELL_MS );
		expect( host.focus ).toHaveBeenCalledTimes( 1 );
		expect( host.focus ).toHaveBeenCalledWith( win );
	} );

	test( 'repeated heartbeats from the same iframe do not restart the dwell', () => {
		const iframe = makeIframeWindow( 'post-editor' );
		const host = makeHost( [ makeFakeWindow( 'post-editor' ) ] );
		installFocusWindowOnDragHover( host );

		dispatchHoverMessage( iframe.contentWindow );
		vi.advanceTimersByTime( FOCUS_ON_DRAG_HOVER_DWELL_MS / 2 );
		dispatchHoverMessage( iframe.contentWindow );
		vi.advanceTimersByTime( FOCUS_ON_DRAG_HOVER_DWELL_MS / 2 );
		expect( host.focus ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'cross-origin and unresolvable-source messages are ignored', () => {
		const iframe = makeIframeWindow( 'post-editor' );
		const host = makeHost( [ makeFakeWindow( 'post-editor' ) ] );
		installFocusWindowOnDragHover( host );

		dispatchHoverMessage( iframe.contentWindow, 'https://evil.example' );
		dispatchHoverMessage( null );
		vi.advanceTimersByTime( 5000 );
		expect( host.focus ).not.toHaveBeenCalled();
	} );

	test( 'the filter ctx carries the forwarded payloadType', () => {
		const iframe = makeIframeWindow( 'post-editor' );
		const host = makeHost( [ makeFakeWindow( 'post-editor' ) ] );
		installFocusWindowOnDragHover( host );

		const seenCtx: unknown[] = [];
		addFilter< boolean, [ { windowId: string; payloadType: string } ] >(
			HOOKS.WINDOW_FOCUS_ON_DRAG_HOVER,
			'test/ctx',
			( value, ctx ) => {
				seenCtx.push( ctx );
				return value;
			},
		);

		dispatchHoverMessage( iframe.contentWindow, window.location.origin, 'external' );
		vi.advanceTimersByTime( FOCUS_ON_DRAG_HOVER_DWELL_MS );
		expect( seenCtx ).toEqual( [ { windowId: 'post-editor', payloadType: 'external' } ] );
	} );
} );

describe( 'window-at-point', () => {
	afterEach( () => {
		document.body.innerHTML = '';
	} );

	test( 'resolves the window root from a nested element', () => {
		const b = makeWindowRoot( 'b' );
		installElementFromPointStub( [ { el: b.inner, rect: { x: 0, y: 0, w: 100, h: 100 } } ] );
		expect( findWindowRootAtPoint( 50, 50 ) ).toBe( b.root );
	} );

	test( 'returns null over the wallpaper', () => {
		document.elementFromPoint = () => null;
		expect( findWindowRootAtPoint( 50, 50 ) ).toBeNull();
	} );

	test( 'windowIdFromRoot parses the wp-window- prefix', () => {
		const { root } = makeWindowRoot( 'edit-php' );
		expect( windowIdFromRoot( root ) ).toBe( 'edit-php' );
	} );

	test( 'windowIdFromRoot returns null for unstamped roots', () => {
		const el = document.createElement( 'div' );
		el.className = 'os-window';
		expect( windowIdFromRoot( el ) ).toBeNull();
		el.id = 'wp-window-'; // prefix with no id
		expect( windowIdFromRoot( el ) ).toBeNull();
	} );
} );
