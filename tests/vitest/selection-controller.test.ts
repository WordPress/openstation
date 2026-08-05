/**
 * Tests for the selection controller — the gestures on the way in
 * and the `selected` attribute / ARIA roles on the way out.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { attachSelection } from '../../src/selection/controller';

let root: HTMLElement;
let background: HTMLElement;

function tile( key: string, x = 0, y = 0 ): HTMLElement {
	const el = document.createElement( 'div' );
	el.className = 'os-file-tile';
	el.dataset.key = key;
	el.style.left = `${ x }px`;
	el.style.top = `${ y }px`;
	root.appendChild( el );
	return el;
}

function attach( opts: Record< string, unknown > = {} ) {
	return attachSelection( root, {
		keyOf: ( el ) => el.dataset.key ?? null,
		background,
		...opts,
	} );
}

function click( el: Element, init: MouseEventInit = {} ): void {
	el.dispatchEvent(
		new MouseEvent( 'click', { bubbles: true, ...init } ),
	);
}

/**
 * jsdom ships no `PointerEvent` constructor, so pointer gestures are
 * synthesized the same way `desktop-files-drag.test.ts` does it.
 */
function pointerEvent(
	type: string,
	clientX: number,
	clientY: number,
): PointerEvent {
	const ev = new Event( type, { bubbles: true } );
	Object.defineProperty( ev, 'pointerId', { value: 1 } );
	Object.defineProperty( ev, 'button', { value: 0 } );
	Object.defineProperty( ev, 'isPrimary', { value: true } );
	Object.defineProperty( ev, 'clientX', { value: clientX } );
	Object.defineProperty( ev, 'clientY', { value: clientY } );
	return ev as unknown as PointerEvent;
}

/** Give an element a real rect — jsdom reports zeros for everything. */
function withRect(
	el: HTMLElement,
	rect: { left: number; top: number; width: number; height: number },
): void {
	el.getBoundingClientRect = () =>
		( {
			left: rect.left,
			top: rect.top,
			right: rect.left + rect.width,
			bottom: rect.top + rect.height,
			width: rect.width,
			height: rect.height,
			x: rect.left,
			y: rect.top,
			toJSON: () => ( {} ),
		} ) as DOMRect;
}

describe( 'selection controller', () => {
	beforeEach( () => {
		background = document.createElement( 'div' );
		root = document.createElement( 'div' );
		background.appendChild( root );
		document.body.appendChild( background );
	} );
	afterEach( () => {
		document.body.innerHTML = '';
	} );

	test( 'marks the container as a multi-selectable listbox', () => {
		attach();
		expect( root.getAttribute( 'role' ) ).toBe( 'listbox' );
		expect( root.getAttribute( 'aria-multiselectable' ) ).toBe( 'true' );
	} );

	test( 'plain click replaces the selection', () => {
		const a = tile( 'a' );
		const b = tile( 'b' );
		const handle = attach();
		click( a );
		expect( handle.keys() ).toEqual( [ 'a' ] );
		click( b );
		expect( handle.keys() ).toEqual( [ 'b' ] );
	} );

	test( 'selected state rides the attribute, not a hand-set class', () => {
		const a = tile( 'a' );
		const handle = attach();
		click( a );
		expect( a.hasAttribute( 'selected' ) ).toBe( true );
		expect( a.getAttribute( 'aria-selected' ) ).toBe( 'true' );
		// `selectable` is what flips `<os-tile>` to role=option.
		expect( a.hasAttribute( 'selectable' ) ).toBe( true );
		handle.model.clear();
		expect( a.hasAttribute( 'selected' ) ).toBe( false );
		expect( a.getAttribute( 'aria-selected' ) ).toBe( 'false' );
	} );

	test( 'ctrl / meta click toggles', () => {
		const a = tile( 'a' );
		const b = tile( 'b' );
		const handle = attach();
		click( a );
		click( b, { metaKey: true } );
		expect( handle.keys() ).toEqual( [ 'a', 'b' ] );
		click( a, { ctrlKey: true } );
		expect( handle.keys() ).toEqual( [ 'b' ] );
	} );

	test( 'shift click extends from the anchor', () => {
		const a = tile( 'a', 0, 0 );
		tile( 'b', 100, 0 );
		const c = tile( 'c', 200, 0 );
		const handle = attach();
		click( a );
		click( c, { shiftKey: true } );
		expect( handle.keys() ).toEqual( [ 'a', 'b', 'c' ] );
	} );

	test( 'visual order drives the range, not DOM order', () => {
		// Appended out of visual order — 'c' is painted first.
		const a = tile( 'a', 200, 0 );
		const b = tile( 'b', 100, 0 );
		tile( 'c', 0, 0 );
		const handle = attach();
		click( b );
		click( a, { shiftKey: true } );
		expect( handle.keys() ).toEqual( [ 'b', 'a' ] );
		// ...and 'c', which sits to the left of both, is untouched.
		expect( handle.keys() ).not.toContain( 'c' );
	} );

	test( 'ranges do not span two canvases in one step', () => {
		// A banded list: two canvases, each with its own coordinate
		// space starting at zero. Grouping by parent keeps a range
		// from interleaving the bands.
		const bandA = document.createElement( 'div' );
		const bandB = document.createElement( 'div' );
		root.append( bandA, bandB );
		const mk = ( parent: HTMLElement, key: string, y: number ) => {
			const el = document.createElement( 'div' );
			el.className = 'os-file-tile';
			el.dataset.key = key;
			el.style.top = `${ y }px`;
			el.style.left = '0px';
			parent.appendChild( el );
			return el;
		};
		mk( bandA, 'a1', 0 );
		const a2 = mk( bandA, 'a2', 100 );
		const b1 = mk( bandB, 'b1', 0 );
		mk( bandB, 'b2', 100 );
		const handle = attach();
		click( a2 );
		click( b1, { shiftKey: true } );
		// Band A's rows come first as a group, so a2 → b1 is exactly
		// those two — b2 (top: 0, same as b1) is not swept in.
		expect( handle.keys() ).toEqual( [ 'a2', 'b1' ] );
	} );

	test( 'clicking empty background clears', () => {
		const a = tile( 'a' );
		const handle = attach();
		click( a );
		click( background );
		expect( handle.keys() ).toEqual( [] );
	} );

	test( 'ctrl/cmd+A selects all and Escape clears', () => {
		tile( 'a' );
		tile( 'b' );
		const handle = attach();
		root.dispatchEvent(
			new KeyboardEvent( 'keydown', {
				key: 'a',
				metaKey: true,
				bubbles: true,
			} ),
		);
		expect( handle.keys() ).toEqual( [ 'a', 'b' ] );
		root.dispatchEvent(
			new KeyboardEvent( 'keydown', { key: 'Escape', bubbles: true } ),
		);
		expect( handle.keys() ).toEqual( [] );
	} );

	test( 'arrow keys move a cursor that shift+arrow extends from', () => {
		tile( 'a', 0, 0 );
		tile( 'b', 100, 0 );
		tile( 'c', 200, 0 );
		const handle = attach();
		const arrow = ( key: string, shiftKey = false ) =>
			root.dispatchEvent(
				new KeyboardEvent( 'keydown', { key, shiftKey, bubbles: true } ),
			);
		arrow( 'ArrowRight' );
		expect( handle.keys() ).toEqual( [ 'a' ] );
		arrow( 'ArrowRight' );
		expect( handle.keys() ).toEqual( [ 'b' ] );
		arrow( 'ArrowRight', true );
		// Extends b..c rather than jumping — the lead moved, the
		// anchor didn't.
		expect( handle.keys() ).toEqual( [ 'b', 'c' ] );
	} );

	test( 'refresh prunes keys whose tiles are gone and re-paints the rest', () => {
		const a = tile( 'a' );
		const b = tile( 'b' );
		const handle = attach();
		click( a );
		click( b, { metaKey: true } );
		// Simulate a repaint that dropped one tile and rebuilt the
		// other — a fresh node with no `selected` attribute.
		a.remove();
		b.removeAttribute( 'selected' );
		handle.refresh();
		expect( handle.keys() ).toEqual( [ 'b' ] );
		expect( b.hasAttribute( 'selected' ) ).toBe( true );
	} );

	test( 'onChange reports the selection and a document event carries it', () => {
		const a = tile( 'a' );
		const onChange = vi.fn();
		const seen: unknown[] = [];
		document.addEventListener( 'os-selection-changed', ( e ) => {
			seen.push( ( e as CustomEvent ).detail );
		} );
		attach( { onChange, surface: 'test', scope: '7' } );
		click( a );
		expect( onChange ).toHaveBeenCalledWith( [ 'a' ] );
		expect( seen ).toEqual( [
			{ surface: 'test', scope: '7', keys: [ 'a' ], count: 1 },
		] );
	} );

	test( 'a marquee selects every tile it covers', () => {
		const a = tile( 'a' );
		const b = tile( 'b' );
		const c = tile( 'c' );
		withRect( background, { left: 0, top: 0, width: 500, height: 500 } );
		withRect( a, { left: 10, top: 10, width: 50, height: 50 } );
		withRect( b, { left: 100, top: 10, width: 50, height: 50 } );
		withRect( c, { left: 300, top: 300, width: 50, height: 50 } );
		const handle = attach();

		background.dispatchEvent( pointerEvent( 'pointerdown', 5, 5 ) );
		document.dispatchEvent( pointerEvent( 'pointermove', 200, 200 ) );
		expect( handle.keys() ).toEqual( [ 'a', 'b' ] );
		expect(
			document.querySelector( '.os-selection-marquee' ),
		).not.toBeNull();

		document.dispatchEvent( pointerEvent( 'pointerup', 200, 200 ) );
		expect( document.querySelector( '.os-selection-marquee' ) ).toBeNull();
	} );

	test( 'the click that ends a marquee does not clear the selection', () => {
		const a = tile( 'a' );
		withRect( background, { left: 0, top: 0, width: 500, height: 500 } );
		withRect( a, { left: 10, top: 10, width: 50, height: 50 } );
		const handle = attach();

		background.dispatchEvent( pointerEvent( 'pointerdown', 5, 5 ) );
		document.dispatchEvent( pointerEvent( 'pointermove', 200, 200 ) );
		document.dispatchEvent( pointerEvent( 'pointerup', 200, 200 ) );
		// The browser synthesizes this on the common ancestor.
		click( background );
		expect( handle.keys() ).toEqual( [ 'a' ] );
	} );

	test( 'a press on a window never starts a marquee', () => {
		// Windows live INSIDE the desktop area, so their pointer
		// events bubble to the wallpaper's own listener. Without the
		// exclusion, dragging a title bar would rubber-band the icons
		// behind the window.
		const win = document.createElement( 'div' );
		win.className = 'os-window';
		const titleBar = document.createElement( 'div' );
		win.appendChild( titleBar );
		background.appendChild( win );
		tile( 'a' );
		withRect( background, { left: 0, top: 0, width: 500, height: 500 } );
		const handle = attach();

		const down = pointerEvent( 'pointerdown', 5, 5 );
		titleBar.dispatchEvent( down );
		document.dispatchEvent( pointerEvent( 'pointermove', 200, 200 ) );
		expect( document.querySelector( '.os-selection-marquee' ) ).toBeNull();
		expect( handle.keys() ).toEqual( [] );
	} );

	test( 'a canvas INSIDE a window still marquees', () => {
		// Regression: the wallpaper exclusion (windows are children of
		// the desktop area) also matched every canvas that lives
		// inside a window, because there `.os-window` is an ancestor
		// rather than a descendant. Folder windows and every My
		// WordPress list lost the marquee entirely.
		const win = document.createElement( 'div' );
		win.className = 'os-window';
		document.body.appendChild( win );
		// Re-home the canvas inside the window.
		win.appendChild( background );

		const a = tile( 'a' );
		withRect( background, { left: 0, top: 0, width: 400, height: 400 } );
		withRect( a, { left: 10, top: 10, width: 50, height: 50 } );
		const handle = attach();

		background.dispatchEvent( pointerEvent( 'pointerdown', 5, 5 ) );
		document.dispatchEvent( pointerEvent( 'pointermove', 200, 200 ) );
		expect(
			document.querySelector( '.os-selection-marquee' ),
		).not.toBeNull();
		expect( handle.keys() ).toEqual( [ 'a' ] );
		document.dispatchEvent( pointerEvent( 'pointerup', 200, 200 ) );
	} );

	test( 'scrolling mid-marquee grows the band and catches what scrolls in', () => {
		// The band's anchor belongs to the CONTENT, not the viewport.
		// Held still while the canvas scrolls, it has to grow — and
		// sweep up whatever slides into it. Stored in viewport space
		// the box froze at its original size and the selection stopped
		// changing, which is the bug this pins.
		const a = tile( 'a' );
		const b = tile( 'b' );
		withRect( background, { left: 0, top: 0, width: 400, height: 200 } );
		// `a` starts inside the band's reach, `b` is below the fold.
		withRect( a, { left: 10, top: 20, width: 50, height: 50 } );
		withRect( b, { left: 10, top: 400, width: 50, height: 50 } );
		Object.defineProperty( background, 'scrollHeight', {
			value: 800,
			configurable: true,
		} );
		Object.defineProperty( background, 'clientHeight', {
			value: 200,
			configurable: true,
		} );
		const handle = attach();

		background.dispatchEvent( pointerEvent( 'pointerdown', 5, 5 ) );
		document.dispatchEvent( pointerEvent( 'pointermove', 200, 150 ) );
		expect( handle.keys() ).toEqual( [ 'a' ] );
		const box = document.querySelector< HTMLElement >(
			'.os-selection-marquee',
		)!;
		expect( box.style.height ).toBe( '145px' );

		// Scroll 300px without moving the pointer. `b` rides up into
		// view; the anchor stays pinned to the content it was drawn
		// from, so the band is now 300px taller.
		background.scrollTop = 300;
		withRect( b, { left: 10, top: 100, width: 50, height: 50 } );
		background.dispatchEvent( new Event( 'scroll' ) );

		expect( box.style.height ).toBe( '445px' );
		expect( handle.keys() ).toEqual( [ 'a', 'b' ] );

		document.dispatchEvent( pointerEvent( 'pointerup', 200, 150 ) );
	} );

	test( 'the scroll listener is dropped with the gesture', () => {
		tile( 'a' );
		withRect( background, { left: 0, top: 0, width: 400, height: 200 } );
		const handle = attach();
		background.dispatchEvent( pointerEvent( 'pointerdown', 5, 5 ) );
		document.dispatchEvent( pointerEvent( 'pointermove', 200, 150 ) );
		document.dispatchEvent( pointerEvent( 'pointerup', 200, 150 ) );
		handle.model.clear();

		// A scroll after the drag must not resurrect the band.
		background.scrollTop = 300;
		background.dispatchEvent( new Event( 'scroll' ) );
		expect( document.querySelector( '.os-selection-marquee' ) ).toBeNull();
		expect( handle.keys() ).toEqual( [] );
	} );

	test( 'the browser cannot run a text selection under the band', () => {
		// Drag a band out past the window it started in and the
		// browser's own selection — begun on the same press, because
		// bare canvas is selectable where a tile is not — starts
		// highlighting whatever is behind, in blue, mid-gesture.
		tile( 'a' );
		withRect( background, { left: 0, top: 0, width: 400, height: 400 } );
		attach();

		expect( document.body.hasAttribute( 'data-os-marquee' ) ).toBe( false );

		background.dispatchEvent( pointerEvent( 'pointerdown', 5, 5 ) );
		document.dispatchEvent( pointerEvent( 'pointermove', 200, 200 ) );

		expect( document.body.hasAttribute( 'data-os-marquee' ) ).toBe( true );
		// Any selection the browser tries to begin from here is
		// refused — including one starting in another window.
		const attempt = new Event( 'selectstart', {
			bubbles: true,
			cancelable: true,
		} );
		document.body.dispatchEvent( attempt );
		expect( attempt.defaultPrevented ).toBe( true );

		document.dispatchEvent( pointerEvent( 'pointerup', 200, 200 ) );
		expect( document.body.hasAttribute( 'data-os-marquee' ) ).toBe( false );
		// …and normal selection works again the moment the band drops.
		const after = new Event( 'selectstart', {
			bubbles: true,
			cancelable: true,
		} );
		document.body.dispatchEvent( after );
		expect( after.defaultPrevented ).toBe( false );
	} );

	test( 'a press that never becomes a band leaves selection alone', () => {
		tile( 'a' );
		withRect( background, { left: 0, top: 0, width: 400, height: 400 } );
		attach();
		background.dispatchEvent( pointerEvent( 'pointerdown', 5, 5 ) );
		// Sub-threshold: this is a click, and clicking must not stop
		// the user selecting text on the surfaces around it.
		document.dispatchEvent( pointerEvent( 'pointermove', 6, 6 ) );
		expect( document.body.hasAttribute( 'data-os-marquee' ) ).toBe( false );
		document.dispatchEvent( pointerEvent( 'pointerup', 6, 6 ) );
	} );

	test( 'suppression is released even when the band is cancelled', () => {
		tile( 'a' );
		withRect( background, { left: 0, top: 0, width: 400, height: 400 } );
		attach();
		background.dispatchEvent( pointerEvent( 'pointerdown', 5, 5 ) );
		document.dispatchEvent( pointerEvent( 'pointermove', 200, 200 ) );
		expect( document.body.hasAttribute( 'data-os-marquee' ) ).toBe( true );
		// Escape mid-drag must not leave the shell unselectable.
		root.dispatchEvent(
			new KeyboardEvent( 'keydown', { key: 'Escape', bubbles: true } ),
		);
		expect( document.body.hasAttribute( 'data-os-marquee' ) ).toBe( false );
	} );

	test( 'the band takes pointer capture so the release comes home', () => {
		// Release over an IFRAME — a chromeless admin window — and the
		// `pointerup` fires in THAT document; the listeners out here
		// never hear it and the band follows a button the user already
		// let go of. Capture retargets the rest of the gesture to this
		// canvas, whatever it happens over.
		const captured: number[] = [];
		const released: number[] = [];
		background.setPointerCapture = ( id: number ) => {
			captured.push( id );
		};
		background.releasePointerCapture = ( id: number ) => {
			released.push( id );
		};
		background.hasPointerCapture = ( id: number ) =>
			captured.includes( id ) && ! released.includes( id );

		tile( 'a' );
		withRect( background, { left: 0, top: 0, width: 400, height: 400 } );
		attach();

		background.dispatchEvent( pointerEvent( 'pointerdown', 5, 5 ) );
		expect( captured ).toEqual( [ 1 ] );

		document.dispatchEvent( pointerEvent( 'pointermove', 200, 200 ) );
		document.dispatchEvent( pointerEvent( 'pointerup', 200, 200 ) );
		expect( released ).toEqual( [ 1 ] );
	} );

	test( 'losing the capture ends the band rather than stranding it', () => {
		background.setPointerCapture = () => undefined;
		background.releasePointerCapture = () => undefined;
		background.hasPointerCapture = () => false;
		tile( 'a' );
		withRect( background, { left: 0, top: 0, width: 400, height: 400 } );
		attach();

		background.dispatchEvent( pointerEvent( 'pointerdown', 5, 5 ) );
		document.dispatchEvent( pointerEvent( 'pointermove', 200, 200 ) );
		expect(
			document.querySelector( '.os-selection-marquee' ),
		).not.toBeNull();

		// The browser can hand capture back on its own — an alert, a
		// native context menu, a touch interruption.
		background.dispatchEvent(
			new Event( 'lostpointercapture', { bubbles: true } ),
		);
		expect( document.querySelector( '.os-selection-marquee' ) ).toBeNull();
		expect( document.body.hasAttribute( 'data-os-marquee' ) ).toBe( false );
	} );

	test( 'focus leaving the shell ends the band', () => {
		// What a click landing inside an iframe looks like from out
		// here. Without this the band outlives the gesture.
		background.setPointerCapture = () => undefined;
		background.releasePointerCapture = () => undefined;
		background.hasPointerCapture = () => false;
		tile( 'a' );
		withRect( background, { left: 0, top: 0, width: 400, height: 400 } );
		attach();

		background.dispatchEvent( pointerEvent( 'pointerdown', 5, 5 ) );
		document.dispatchEvent( pointerEvent( 'pointermove', 200, 200 ) );
		window.dispatchEvent( new Event( 'blur' ) );
		expect( document.querySelector( '.os-selection-marquee' ) ).toBeNull();
		expect( document.body.hasAttribute( 'data-os-marquee' ) ).toBe( false );
	} );

	test( 'marquee can be disabled', () => {
		tile( 'a' );
		withRect( background, { left: 0, top: 0, width: 500, height: 500 } );
		attach( { marquee: false } );
		background.dispatchEvent( pointerEvent( 'pointerdown', 5, 5 ) );
		document.dispatchEvent( pointerEvent( 'pointermove', 200, 200 ) );
		expect( document.querySelector( '.os-selection-marquee' ) ).toBeNull();
	} );

	test( 'destroy unbinds the gestures', () => {
		const a = tile( 'a' );
		const handle = attach();
		handle.destroy();
		click( a );
		expect( handle.keys() ).toEqual( [] );
	} );
} );
