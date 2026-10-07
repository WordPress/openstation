import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	installIframeDropTargets,
	__resetIframeDropTargetsForTests,
} from '../../src/drag/iframe-drop-targets';
import { DRAG_BRIDGE_EVENTS } from '../../src/drag-bridge';
import { DRAG_EVENTS, type DragManagerApi, type DropTarget } from '../../src/drag';

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

function installSyncRaf(): void {
	window.requestAnimationFrame = ( cb: FrameRequestCallback ) => {
		cb( 0 );
		return 1;
	};
	window.cancelAnimationFrame = () => undefined;
}

function mountIframeWindow(): { iframe: HTMLIFrameElement; posted: Array< Record< string, unknown > > } {
	const win = document.createElement( 'div' );
	win.className = 'os-window';
	win.id = 'wp-window-post-php';
	const iframe = document.createElement( 'iframe' );
	iframe.className = 'os-window__iframe';
	win.appendChild( iframe );
	document.body.appendChild( win );
	iframe.getBoundingClientRect = () =>
		( { left: 100, top: 50, width: 800, height: 600, right: 900, bottom: 650, x: 100, y: 50, toJSON: () => ( {} ) } ) as DOMRect;
	const posted: Array< Record< string, unknown > > = [];
	vi.spyOn( iframe.contentWindow as Window, 'postMessage' ).mockImplementation( ( msg: unknown ) => {
		posted.push( msg as Record< string, unknown > );
	} );
	return { iframe, posted };
}

describe( 'os-drag-move stream', () => {
	let targets: DropTarget[];

	beforeEach( () => {
		stubWpHooks();
		installSyncRaf();
		targets = [];
		const dragManager = {
			start: vi.fn(),
			registerDropTarget: vi.fn( ( t: DropTarget ) => {
				targets.push( t );
				return () => undefined;
			} ),
			getSession: vi.fn( () => null ),
		} as unknown as DragManagerApi;
		installIframeDropTargets( dragManager );
	} );

	afterEach( () => {
		__resetIframeDropTargetsForTests();
		document.body.innerHTML = '';
		delete ( window as { wp?: unknown } ).wp;
		vi.restoreAllMocks();
	} );

	test( 'a DragManager session streams positions only while over the window', () => {
		const { iframe, posted } = mountIframeWindow();
		const payload = { type: 'desktop-file', source: document.body, data: { bridgePayload: PAYLOAD } };
		document.dispatchEvent( new CustomEvent( DRAG_EVENTS.START, { detail: { payload } } ) );
		expect( targets ).toHaveLength( 1 );

		document.dispatchEvent( new CustomEvent( DRAG_EVENTS.MOVE, { detail: { payload, clientX: 10, clientY: 10 } } ) );
		expect( posted.some( ( m ) => m.type === 'os-drag-move' ) ).toBe( false );

		targets[ 0 ].onEnter?.( { payload } as never );
		document.dispatchEvent( new CustomEvent( DRAG_EVENTS.MOVE, { detail: { payload, clientX: 340, clientY: 250 } } ) );
		const move = posted.find( ( m ) => m.type === 'os-drag-move' );

		expect( move ).toEqual( { type: 'os-drag-move', position: { x: 240, y: 200 } } );

		targets[ 0 ].onLeave?.( { payload } as never );
		const before = posted.length;
		document.dispatchEvent( new CustomEvent( DRAG_EVENTS.MOVE, { detail: { payload, clientX: 350, clientY: 260 } } ) );
		expect( posted.length ).toBe( before );
		expect( iframe.isConnected ).toBe( true );
	} );

	test( 'the native bridge intercept streams positions on dragover', () => {
		const { iframe, posted } = mountIframeWindow();
		document.elementFromPoint = () => iframe;
		document.dispatchEvent( new CustomEvent( DRAG_BRIDGE_EVENTS.START, { detail: { payload: PAYLOAD } } ) );

		const over = new Event( 'dragover', { bubbles: true, cancelable: true } );
		Object.defineProperty( over, 'clientX', { value: 300 } );
		Object.defineProperty( over, 'clientY', { value: 150 } );
		Object.defineProperty( over, 'dataTransfer', { value: { dropEffect: 'none' } } );
		document.body.dispatchEvent( over );

		const types = posted.map( ( m ) => m.type );
		expect( types ).toContain( 'os-drag-over' );
		expect( posted.find( ( m ) => m.type === 'os-drag-move' ) ).toEqual( {
			type: 'os-drag-move',
			position: { x: 200, y: 100 },
		} );
	} );
} );
