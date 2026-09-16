import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import './os-split';

let resize: ResizeObserverCallback;
const disconnect = vi.fn();
const tick = async () => {
	await Promise.resolve(); await Promise.resolve();
};
let split: HTMLElement;
const measure = async ( width = 1008, height = 600 ) => {
	resize( [ { contentRect: { width, height } } ] as ResizeObserverEntry[], {} as ResizeObserver );
	await tick();
};
const divider = () => split.shadowRoot!.querySelector< HTMLElement >( '.divider' )!;
const key = async ( value: string, shiftKey = false ) => {
	divider().dispatchEvent( new KeyboardEvent( 'keydown', { key: value, shiftKey, bubbles: true, cancelable: true } ) );
	await tick();
};

beforeEach( async () => {
	vi.stubGlobal( 'ResizeObserver', class {
		constructor( cb: ResizeObserverCallback ) {
			resize = cb;
		}
		observe() {}
		disconnect = disconnect;
	} );
	split = document.createElement( 'os-split' );
	split.setAttribute( 'resizable', '' );
	split.setAttribute( 'label', 'Resize editor' );
	split.innerHTML = '<div slot="start">Editor</div><div slot="end">Preview</div>';
	document.body.appendChild( split );
	await measure();
} );
afterEach( () => {
	split.remove(); vi.unstubAllGlobals(); vi.clearAllMocks();
} );

describe( 'split layout and keyboard resizing', () => {
	test( 'exposes a named separator and obeys pixel minima', async () => {
		expect( divider().getAttribute( 'aria-label' ) ).toBe( 'Resize editor' );
		expect( divider().getAttribute( 'aria-controls' ) ).toBe( 'start' );
		const change = vi.fn();
		split.addEventListener( 'os-split-change', change );
		await key( 'ArrowRight' );
		expect( Number( split.getAttribute( 'position' ) ) ).toBe( 37 );
		await key( 'Home' );
		expect( Number( split.getAttribute( 'position' ) ) ).toBe( 16 );
		await key( 'End' );
		expect( Number( split.getAttribute( 'position' ) ) ).toBe( 84 );
		expect( change ).toHaveBeenCalledTimes( 3 );
		expect( change.mock.calls[ 2 ][ 0 ].detail ).toEqual( { position: 84 } );
		await key( 'End' );
		expect( change ).toHaveBeenCalledTimes( 3 );
	} );

	test( 'RTL keys follow the physical divider; vertical keys ignore RTL', async () => {
		split.style.direction = 'rtl';
		await key( 'ArrowLeft', true );
		expect( split.getAttribute( 'position' ) ).toBe( '45' );
		split.setAttribute( 'direction', 'vertical' );
		await tick();
		await key( 'ArrowDown' );
		expect( split.getAttribute( 'position' ) ).toBe( '47' );
		expect( divider().getAttribute( 'aria-orientation' ) ).toBe( 'horizontal' );
	} );

	test( 'narrow mode disables resizing and restores the previous position on widening', async () => {
		await key( 'ArrowRight' );
		split.setAttribute( 'narrow', 'end' );
		await measure( 400 );
		expect( split.shadowRoot!.querySelector( '.layout.compact.end' ) ).not.toBeNull();
		expect( divider().tabIndex ).toBe( -1 );
		await key( 'ArrowRight' );
		expect( split.getAttribute( 'position' ) ).toBe( '37' );
		await measure();
		expect( divider().getAttribute( 'aria-valuenow' ) ).toBe( '37' );
	} );

	test( 'invalid values fall back and impossible minima share the available space', async () => {
		split.setAttribute( 'position', 'garbage' );
		split.setAttribute( 'min-start', '600' );
		split.setAttribute( 'min-end', '600' );
		await tick();
		expect( divider().getAttribute( 'aria-valuenow' ) ).toBe( '50' );
		expect( divider().getAttribute( 'aria-valuemin' ) ).toBe( '50' );
		expect( divider().getAttribute( 'aria-valuemax' ) ).toBe( '50' );
		split.remove();
		expect( disconnect ).toHaveBeenCalled();
		document.body.appendChild( split );
		await measure();
		expect( divider().getAttribute( 'aria-valuenow' ) ).toBe( '50' );
	} );

	test( 'attribute changes do not emit a committed resize', async () => {
		const change = vi.fn();
		split.addEventListener( 'os-split-change', change );
		split.setAttribute( 'position', '60' );
		await measure();
		expect( change ).not.toHaveBeenCalled();
	} );
} );

/** Pointer capture is native-browser behavior; these tests exercise the drag state machine. */
function pointer( type: string, clientX: number, pointerId = 1 ): void {
	const event = new MouseEvent( type, { clientX, clientY: 20, button: 0, bubbles: true, cancelable: true } );
	Object.defineProperty( event, 'pointerId', { value: pointerId } );
	divider().dispatchEvent( event );
}

function capture(): void {
	divider().setPointerCapture = vi.fn();
	divider().hasPointerCapture = vi.fn( () => true );
	divider().releasePointerCapture = vi.fn();
}

test( 'layout observations do not abort an active drag, including actual container reflow', async () => {
	capture();
	const change = vi.fn();
	split.addEventListener( 'os-split-change', change );
	pointer( 'pointerdown', 350 );
	pointer( 'pointermove', 400 );
	await tick();
	expect( split.getAttribute( 'position' ) ).toBe( '40' );
	split.setAttribute( 'label', 'Resize conversation list' );
	split.setAttribute( 'narrow', 'end' );
	await measure();
	expect( split.shadowRoot!.querySelector( '.shield' )!.hasAttribute( 'hidden' ) ).toBe( false );
	await measure( 808 );
	pointer( 'pointermove', 440 );
	pointer( 'pointerup', 440 );
	await tick();
	expect( Number( split.getAttribute( 'position' ) ) ).toBe( 45 );
	expect( change ).toHaveBeenCalledOnce();
	expect( change.mock.calls[ 0 ][ 0 ].detail ).toEqual( { position: 45 } );
	expect( split.shadowRoot!.querySelector( '.shield' )!.hasAttribute( 'hidden' ) ).toBe( true );
} );

test( 'Escape after reflow restores the original position, and the next drag works', async () => {
	capture();
	pointer( 'pointerdown', 350 );
	pointer( 'pointermove', 400 );
	await measure( 808 );
	await key( 'Escape' );
	expect( Number( split.getAttribute( 'position' ) ) ).toBe( 35 );
	pointer( 'pointerdown', 280 );
	pointer( 'pointermove', 320 );
	pointer( 'pointerup', 320 );
	await tick();
	expect( Number( split.getAttribute( 'position' ) ) ).toBe( 40 );
} );

test( 'only cancellation from the active pointer ends a drag', async () => {
	capture();
	const change = vi.fn();
	split.addEventListener( 'os-split-change', change );
	pointer( 'pointerdown', 350 );
	pointer( 'pointermove', 400 );
	pointer( 'pointercancel', 400, 2 );
	pointer( 'lostpointercapture', 400, 2 );
	await tick();
	expect( split.shadowRoot!.querySelector( '.shield' )!.hasAttribute( 'hidden' ) ).toBe( false );
	pointer( 'pointercancel', 400 );
	pointer( 'lostpointercapture', 400 );
	await tick();
	expect( Number( split.getAttribute( 'position' ) ) ).toBe( 35 );
	expect( split.shadowRoot!.querySelector( '.shield' )!.hasAttribute( 'hidden' ) ).toBe( true );
	expect( change ).not.toHaveBeenCalled();
} );

test( 'capture loss without pointerup commits the last visible position exactly once', async () => {
	capture();
	const change = vi.fn();
	split.addEventListener( 'os-split-change', change );
	// First release is normal; the next one only delivers capture loss.
	pointer( 'pointerdown', 350 );
	pointer( 'pointermove', 550 );
	pointer( 'pointerup', 550 );
	pointer( 'lostpointercapture', 550 );
	pointer( 'pointerdown', 550 );
	pointer( 'pointermove', 440 );
	await tick();
	expect( Number( split.getAttribute( 'position' ) ) ).toBe( 44 );
	// Capture-loss coordinates are not a new movement sample.
	pointer( 'lostpointercapture', 0 );
	await tick();
	expect( Number( split.getAttribute( 'position' ) ) ).toBe( 44 );
	expect( split.shadowRoot!.querySelector( '.shield' )!.hasAttribute( 'hidden' ) ).toBe( true );
	pointer( 'pointerup', 440 );
	pointer( 'lostpointercapture', 440 );
	expect( change.mock.calls.map( ( [ event ] ) => event.detail.position ) ).toEqual( [ 55, 44 ] );
	// Cleanup leaves the next gesture usable.
	pointer( 'pointerdown', 440 );
	pointer( 'pointermove', 480 );
	pointer( 'pointerup', 480 );
	await tick();
	expect( Number( split.getAttribute( 'position' ) ) ).toBe( 48 );
	expect( change ).toHaveBeenCalledTimes( 3 );
} );
