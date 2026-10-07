import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	installIframeDropTargets,
	__resetIframeDropTargetsForTests,
} from '../../src/drag/iframe-drop-targets';
import { DRAG_BRIDGE_EVENTS } from '../../src/drag-bridge';
import { DRAG_EVENTS, type DragManagerApi } from '../../src/drag';

const PAYLOAD = {
	kind: 'attachment' as const,
	id: 42,
	url: 'https://example.test/a.png',
	title: 'A photo',
	alt: '',
	mime: 'image/png',
};

function stubWpHooks(): void {
	( window as { wp?: unknown } ).wp = {
		hooks: {
			addAction: vi.fn(),
			removeAction: vi.fn(),
			doAction: vi.fn(),
			addFilter: vi.fn(),
			removeFilter: vi.fn(),
			applyFilters: ( _name: string, value: unknown ) => value,
		},
	};
}

const dragManagerStub = {
	start: vi.fn(),
	registerDropTarget: vi.fn( () => () => undefined ),
	getSession: vi.fn( () => null ),
} as unknown as DragManagerApi;

function fireDrop(): Event {
	const ev = new Event( 'drop', { bubbles: true, cancelable: true } );
	Object.defineProperty( ev, 'clientX', { value: 120 } );
	Object.defineProperty( ev, 'clientY', { value: 90 } );
	Object.defineProperty( ev, 'dataTransfer', {
		value: { types: [ 'text/uri-list' ], dropEffect: 'none' },
	} );
	document.body.dispatchEvent( ev );
	return ev;
}

function mountIframeWindowUnderCursor(): HTMLIFrameElement {
	const win = document.createElement( 'div' );
	win.className = 'os-window';
	win.id = 'wp-window-edit-php';
	const iframe = document.createElement( 'iframe' );
	iframe.className = 'os-window__iframe';
	win.appendChild( iframe );
	document.body.appendChild( win );
	document.elementFromPoint = () => iframe;
	return iframe;
}

describe( 'bridge drop intercept', () => {
	let downstream: ReturnType< typeof vi.fn >;

	beforeEach( () => {
		stubWpHooks();
		installIframeDropTargets( dragManagerStub );

		downstream = vi.fn();
		document.body.addEventListener( 'drop', downstream );
		document.elementFromPoint = () => null;
	} );

	afterEach( () => {
		document.body.removeEventListener( 'drop', downstream );
		__resetIframeDropTargetsForTests();
		document.body.innerHTML = '';
		delete ( window as { wp?: unknown } ).wp;
		vi.restoreAllMocks();
	} );

	function startBridgeSession(): void {
		document.dispatchEvent(
			new CustomEvent( DRAG_BRIDGE_EVENTS.START, {
				detail: { payload: PAYLOAD },
			} ),
		);
	}

	test( 'a drop with no iframe window under the cursor reaches the shell', () => {
		startBridgeSession();

		const ev = fireDrop();

		expect( downstream ).toHaveBeenCalledTimes( 1 );

		expect( ev.defaultPrevented ).toBe( true );
	} );

	test( 'a drop over an iframe window is claimed and delivered', () => {
		const iframe = mountIframeWindowUnderCursor();
		const post = vi.fn();
		Object.defineProperty( iframe, 'contentWindow', {
			value: { postMessage: post },
			configurable: true,
		} );
		startBridgeSession();

		fireDrop();

		expect( downstream ).not.toHaveBeenCalled();
		expect( post ).toHaveBeenCalledWith(
			expect.objectContaining( {
				type: 'os-drop',
				payload: PAYLOAD,
			} ),
			expect.anything(),
		);
	} );

	test( 'declining a drop ends the session, so the next drag starts clean', () => {
		startBridgeSession();
		fireDrop();

		const iframe = mountIframeWindowUnderCursor();
		const post = vi.fn();
		Object.defineProperty( iframe, 'contentWindow', {
			value: { postMessage: post },
			configurable: true,
		} );
		fireDrop();

		expect( post ).not.toHaveBeenCalled();
		expect( downstream ).toHaveBeenCalledTimes( 2 );
	} );

	test( 'with no session in flight the intercept is inert', () => {
		const ev = fireDrop();

		expect( downstream ).toHaveBeenCalledTimes( 1 );
		expect( ev.defaultPrevented ).toBe( false );
	} );

	test( 'iframe pointer-events are restored when a drop is declined', () => {
		const iframe = mountIframeWindowUnderCursor();
		document.elementFromPoint = () => null;
		startBridgeSession();
		expect( iframe.style.pointerEvents ).toBe( 'none' );

		fireDrop();

		expect( iframe.style.pointerEvents ).toBe( '' );
	} );
} );

describe( 'drag-start trace', () => {
	let info: ReturnType< typeof vi.spyOn >;

	beforeEach( () => {
		stubWpHooks();
		installIframeDropTargets( dragManagerStub );
		info = vi.spyOn( console, 'info' ).mockImplementation( () => undefined );
	} );

	afterEach( () => {
		__resetIframeDropTargetsForTests();
		window.localStorage.removeItem( 'openStationDragDebug' );
		delete ( window as { wp?: unknown } ).wp;
		vi.restoreAllMocks();
	} );

	function startDrag(): void {
		document.dispatchEvent(
			new CustomEvent( DRAG_EVENTS.START, {
				detail: { payload: { type: 'desktop-file', data: {} } },
			} ),
		);
	}

	test( 'an ordinary drag says nothing', () => {
		startDrag();

		expect( info ).not.toHaveBeenCalled();
	} );

	test( 'the debug flag turns the trace back on', () => {
		window.localStorage.setItem( 'openStationDragDebug', '1' );

		startDrag();

		expect( info ).toHaveBeenCalledWith(
			expect.stringContaining( 'drag-start' ),
			expect.anything(),
			expect.anything(),
			expect.anything(),
		);
	} );
} );
