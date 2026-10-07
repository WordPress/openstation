import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createPointerTracker } from '../../src/mio/pointer';

const ORIGIN = 'http://localhost:3000';

function fakeIframe( rect: { left: number; top: number } ): {
	el: HTMLIFrameElement;
	source: Window;
	posted: Array< unknown >;
} {
	const el = document.createElement( 'iframe' );
	const posted: unknown[] = [];
	const source = {
		postMessage: ( data: unknown ) => posted.push( data ),
	} as unknown as Window;
	Object.defineProperty( el, 'contentWindow', {
		value: source,
		configurable: true,
	} );
	el.getBoundingClientRect = () =>
		( { left: rect.left, top: rect.top } as DOMRect );
	document.body.appendChild( el );
	return { el, source, posted };
}

function movePointer( x: number, y: number ): void {
	window.dispatchEvent(
		new MouseEvent( 'pointermove', { clientX: x, clientY: y } ),
	);
}

function post( source: Window | null, data: unknown, origin = ORIGIN ): void {
	const event = new MessageEvent( 'message', { data, origin } );
	Object.defineProperty( event, 'source', { value: source } );
	window.dispatchEvent( event );
}

beforeEach( () => {
	vi.useFakeTimers();
	Object.defineProperty( window, 'location', {
		value: { ...window.location, origin: ORIGIN },
		configurable: true,
	} );
} );

afterEach( () => {
	vi.useRealTimers();
	document.body.innerHTML = '';
} );

describe( 'createPointerTracker', () => {
	test( 'starts with no known position', () => {
		const tracker = createPointerTracker();
		expect( tracker.get() ).toBeNull();
		tracker.destroy();
	} );

	test( 'follows pointermove on the shell document', () => {
		const tracker = createPointerTracker();
		movePointer( 120, 340 );
		expect( tracker.get() ).toEqual( { x: 120, y: 340 } );
		tracker.destroy();
	} );

	test( 'arms every live iframe on start and disarms on destroy', () => {
		const frame = fakeIframe( { left: 0, top: 0 } );
		const tracker = createPointerTracker();
		expect( frame.posted ).toEqual( [
			{ type: 'os-pointer-track', enabled: true },
		] );
		tracker.destroy();
		expect( frame.posted ).toEqual( [
			{ type: 'os-pointer-track', enabled: true },
			{ type: 'os-pointer-track', enabled: false },
		] );
	} );

	test( 'arms an iframe that announces itself later', () => {
		const tracker = createPointerTracker();
		const frame = fakeIframe( { left: 0, top: 0 } );
		expect( frame.posted ).toEqual( [] );
		post( frame.source, { type: 'os-bridge-ready' } );
		expect( frame.posted ).toEqual( [
			{ type: 'os-pointer-track', enabled: true },
		] );
		tracker.destroy();
	} );

	test( 'rebases forwarded iframe coordinates into the viewport', () => {
		const frame = fakeIframe( { left: 300, top: 120 } );
		const tracker = createPointerTracker();
		post( frame.source, { type: 'os-pointer-move', x: 40, y: 60 } );
		expect( tracker.get() ).toEqual( { x: 340, y: 180 } );
		tracker.destroy();
	} );

	test( 'ignores messages from another origin', () => {
		const frame = fakeIframe( { left: 300, top: 120 } );
		const tracker = createPointerTracker();
		post(
			frame.source,
			{ type: 'os-pointer-move', x: 40, y: 60 },
			'https://evil.example',
		);
		expect( tracker.get() ).toBeNull();
		tracker.destroy();
	} );

	test( 'ignores a forwarded position from an unknown frame', () => {
		const tracker = createPointerTracker();
		post(
			{ postMessage: () => undefined } as unknown as Window,
			{ type: 'os-pointer-move', x: 40, y: 60 },
		);
		expect( tracker.get() ).toBeNull();
		tracker.destroy();
	} );

	test( 'ignores malformed coordinates', () => {
		const frame = fakeIframe( { left: 0, top: 0 } );
		const tracker = createPointerTracker();
		post( frame.source, { type: 'os-pointer-move', x: 'a', y: 1 } );
		post( frame.source, { type: 'os-pointer-move' } );
		expect( tracker.get() ).toBeNull();
		tracker.destroy();
	} );

	test( 'clears the position when the cursor leaves the browser', () => {
		const tracker = createPointerTracker();
		movePointer( 10, 10 );
		document.documentElement.dispatchEvent( new MouseEvent( 'mouseleave' ) );

		expect( tracker.get() ).not.toBeNull();
		vi.advanceTimersByTime( 300 );
		expect( tracker.get() ).toBeNull();
		tracker.destroy();
	} );

	test( 'an iframe forward inside the grace period cancels the clear', () => {
		const frame = fakeIframe( { left: 500, top: 0 } );
		const tracker = createPointerTracker();
		movePointer( 10, 10 );
		document.documentElement.dispatchEvent( new MouseEvent( 'mouseleave' ) );
		vi.advanceTimersByTime( 100 );
		post( frame.source, { type: 'os-pointer-move', x: 5, y: 7 } );
		vi.advanceTimersByTime( 500 );
		expect( tracker.get() ).toEqual( { x: 505, y: 7 } );
		tracker.destroy();
	} );

	test( 'stops updating after destroy', () => {
		const frame = fakeIframe( { left: 0, top: 0 } );
		const tracker = createPointerTracker();
		tracker.destroy();
		movePointer( 55, 66 );
		post( frame.source, { type: 'os-pointer-move', x: 1, y: 2 } );
		expect( tracker.get() ).toBeNull();
	} );
} );
