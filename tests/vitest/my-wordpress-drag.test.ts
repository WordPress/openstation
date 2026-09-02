/**
 * Regression test for the My WordPress entity-tile drag-out flow.
 *
 * The user-reported bug: "Posts & Pages tiles inside My WordPress are
 * forbidden — I can lift the tile but no drop target accepts it."
 *
 * Root cause was in `attachTileDrag` (since deleted) which called
 * `setPointerCapture` on a tile that was also `draggable=true`. Pointer
 * capture redirected pointer events to the tile, which prevented the
 * browser from firing `dragstart` — so the HTML5 drag never started,
 * the payload was never set on `DataTransfer`, and no drop target ever
 * saw it.
 *
 * The fix: pointerdown on the tile starts a DragManager session with
 * a `'shortcut'` payload. The manager owns the gesture; the
 * wallpaper's drop target accepts the payload and POSTs a placement.
 *
 * This test wires the same shape my-wordpress now uses (pointerdown
 * → dragManager.start) and verifies the drop target receives a typed
 * shortcut payload after a super-threshold gesture. It does NOT load
 * the full my-wordpress module — that would require the entire shell
 * boot. It tests the contract.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { installHooksStub, clearHooksStub } from './helpers/hooks-stub';
import { DragManager } from '../../src/drag/manager';
import { __resetRecoveryForTests } from '../../src/drag/recovery';
import type { ShortcutDragData } from '../../src/desktop-files/drag-payloads';

function pointerEvent(
	type: string,
	clientX: number,
	clientY: number,
	target: HTMLElement | Document = document,
): PointerEvent {
	const ev = new Event( type, { bubbles: true } );
	Object.defineProperty( ev, 'pointerId', { value: 1 } );
	Object.defineProperty( ev, 'button', { value: 0 } );
	Object.defineProperty( ev, 'clientX', { value: clientX } );
	Object.defineProperty( ev, 'clientY', { value: clientY } );
	if ( target instanceof HTMLElement ) {
		Object.defineProperty( ev, 'target', { value: target } );
	}
	return ev as unknown as PointerEvent;
}

function installElementFromPointStub( regions: Array< { el: Element; rect: { x: number; y: number; w: number; h: number } } > ): void {
	const ordered = [ ...regions ];
	document.elementFromPoint = ( x: number, y: number ): Element | null => {
		for ( let i = ordered.length - 1; i >= 0; i -= 1 ) {
			const { el, rect } = ordered[ i ];
			if ( x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h ) {
				return el;
			}
		}
		return null;
	};
}

/**
 * Replicates the exact pointerdown handler the WP Explorer app wires
 * onto each post / page tile (`apps/my-wordpress/parts/wire.ts`). If
 * this test passes, the pattern in production is sound.
 */
function attachMyWordpressEntityDrag(
	tile: HTMLElement,
	postId: number,
	postTitle: string,
	manager: DragManager,
): void {
	tile.addEventListener( 'pointerdown', ( e: PointerEvent ) => {
		if ( e.button !== 0 ) {
			return;
		}
		manager.start( {
			payload: {
				type: 'shortcut',
				source: tile,
				data: {
					kind: 'post',
					ref: String( postId ),
					title: postTitle,
					icon: 'dashicons-admin-post',
				} satisfies ShortcutDragData,
				ghost: { offsetX: 30, offsetY: 30 },
			},
			origin: e,
		} );
	} );
}

describe( 'My WordPress entity-tile drag (regression)', () => {
	beforeEach( () => {
		installHooksStub();
		__resetRecoveryForTests();
		document.elementFromPoint = () => null;
	} );

	afterEach( () => {
		clearHooksStub();
		document.body.innerHTML = '';
		vi.unstubAllGlobals();
	} );

	test( 'super-threshold drag fires onDrop on the wallpaper with a shortcut payload', () => {
		const manager = new DragManager();

		// Tile sits inside the (faked) My WordPress window.
		const myWordpressWindow = document.createElement( 'div' );
		myWordpressWindow.classList.add( 'os-window' );
		const tile = document.createElement( 'div' );
		tile.className = 'os-my-wordpress__tile';
		myWordpressWindow.appendChild( tile );
		document.body.appendChild( myWordpressWindow );

		// Wallpaper canvas is registered as a drop target.
		const wallpaper = document.createElement( 'div' );
		wallpaper.id = 'os-area';
		document.body.appendChild( wallpaper );

		const onDrop = vi.fn();
		manager.registerDropTarget( {
			id: 'wallpaper',
			element: wallpaper,
			accept: ( payload ) => payload.type === 'shortcut',
			onDrop,
		} );

		attachMyWordpressEntityDrag( tile, 42, 'Hello World', manager );

		// At pointer (50, 50) the cursor is over the tile (inside the
		// window). At (500, 500) it's over the wallpaper.
		installElementFromPointStub( [
			{ el: tile, rect: { x: 0, y: 0, w: 100, h: 100 } },
			{ el: myWordpressWindow, rect: { x: 0, y: 0, w: 200, h: 200 } },
			{ el: wallpaper, rect: { x: 400, y: 400, w: 800, h: 600 } },
		] );

		tile.dispatchEvent( pointerEvent( 'pointerdown', 50, 50, tile ) );
		// Cross threshold while still over the My WordPress window —
		// the window claim boundary should reject (no onEnter/onDrop).
		document.dispatchEvent( pointerEvent( 'pointermove', 80, 50 ) );
		expect( onDrop ).not.toHaveBeenCalled();
		// Move out over the wallpaper canvas.
		document.dispatchEvent( pointerEvent( 'pointermove', 500, 500 ) );
		// Release on wallpaper.
		document.dispatchEvent( pointerEvent( 'pointerup', 500, 500 ) );

		expect( onDrop ).toHaveBeenCalledTimes( 1 );
		const [ session, where ] = onDrop.mock.calls[ 0 ];
		expect( session.payload.type ).toBe( 'shortcut' );
		expect( ( session.payload.data as ShortcutDragData ).kind ).toBe( 'post' );
		expect( ( session.payload.data as ShortcutDragData ).ref ).toBe( '42' );
		expect( where ).toEqual( { clientX: 500, clientY: 500 } );
	} );

	test( 'sub-threshold pointer gesture does not fire any drop target', () => {
		const manager = new DragManager();
		const tile = document.createElement( 'div' );
		document.body.appendChild( tile );
		const wallpaper = document.createElement( 'div' );
		document.body.appendChild( wallpaper );
		const onDrop = vi.fn();
		manager.registerDropTarget( {
			id: 'wallpaper',
			element: wallpaper,
			accept: () => true,
			onDrop,
		} );
		attachMyWordpressEntityDrag( tile, 1, 'x', manager );
		installElementFromPointStub( [ { el: wallpaper, rect: { x: 0, y: 0, w: 1000, h: 1000 } } ] );

		tile.dispatchEvent( pointerEvent( 'pointerdown', 50, 50, tile ) );
		document.dispatchEvent( pointerEvent( 'pointermove', 51, 50 ) ); // sub-threshold
		document.dispatchEvent( pointerEvent( 'pointerup', 51, 50 ) );

		expect( onDrop ).not.toHaveBeenCalled();
	} );

	test( 'reject-claimant on the window body flips the hint chip to "Can\'t drop here"', () => {
		// Regression: the user reported "we can't drop anything into
		// MY WordPress app …" — and then "show the label CANT DROP
		// HERE as we show in other cases." This proves the
		// `accept: () => false` claimant on the window body is found
		// by the registry's walk-up, drives the ghost into reject
		// mode, and surfaces the hint chip with the framework's
		// default reject label.
		const manager = new DragManager();

		// Faked My WordPress window: outer `.os-window`
		// wraps a `.os-window__body` (the element our render
		// callback receives). The claimant registers on the body.
		const myWordpressWindow = document.createElement( 'div' );
		myWordpressWindow.classList.add( 'os-window' );
		const bodyEl = document.createElement( 'div' );
		bodyEl.classList.add( 'os-window__body' );
		myWordpressWindow.appendChild( bodyEl );
		document.body.appendChild( myWordpressWindow );

		// Mirror exactly what the app's drop-target wiring does
		// (`apps/my-wordpress/parts/wire.ts`) — the only thing that
		// matters for the chip text contract.
		manager.registerDropTarget( {
			id: 'os-my-wordpress-reject',
			element: bodyEl,
			accept: () => false,
			onDrop: () => {},
		} );

		// Source tile lives outside the window — typical scenario is a
		// desktop tile dragged onto My WordPress.
		const tile = document.createElement( 'div' );
		document.body.appendChild( tile );

		// Drag a desktop-file payload past the threshold. We DON'T
		// need a successful drop — what we're asserting is the hover
		// state mid-drag.
		manager.start( {
			payload: {
				type: 'desktop-file',
				source: tile,
				data: {
					placement: { id: 1 },
					sourceFolderId: 0,
				} as unknown as Record< string, unknown >,
				ghost: { offsetX: 30, offsetY: 30 },
			},
			origin: pointerEvent( 'pointerdown', 50, 50, tile ),
		} );

		installElementFromPointStub( [
			{ el: bodyEl, rect: { x: 0, y: 0, w: 500, h: 500 } },
		] );

		// Cross the lift threshold + hover the body — `_updateHover`
		// runs against the claimant and should flip the ghost.
		document.dispatchEvent( pointerEvent( 'pointermove', 200, 200 ) );

		const hint = document.querySelector( '.os-drag-hint' );
		expect( hint ).not.toBeNull();
		expect( hint!.classList.contains( 'os-drag-hint--reject' ) ).toBe( true );
		expect( hint!.textContent ).toBe( "Can’t drop here" );

		document.dispatchEvent( pointerEvent( 'pointerup', 200, 200 ) );
	} );

	test( 'Escape mid-drag aborts without firing onDrop', () => {
		const manager = new DragManager();
		const tile = document.createElement( 'div' );
		const wallpaper = document.createElement( 'div' );
		document.body.append( tile, wallpaper );
		const onDrop = vi.fn();
		manager.registerDropTarget( {
			id: 'wallpaper',
			element: wallpaper,
			accept: () => true,
			onDrop,
		} );
		attachMyWordpressEntityDrag( tile, 1, 'x', manager );
		installElementFromPointStub( [ { el: wallpaper, rect: { x: 0, y: 0, w: 1000, h: 1000 } } ] );

		tile.dispatchEvent( pointerEvent( 'pointerdown', 50, 50, tile ) );
		document.dispatchEvent( pointerEvent( 'pointermove', 200, 200 ) );
		document.dispatchEvent( new KeyboardEvent( 'keydown', { key: 'Escape' } ) );

		expect( onDrop ).not.toHaveBeenCalled();
		expect( manager.getActive() ).toBeNull();
		expect( manager.debug().findOrphans() ).toEqual( [] );
	} );
} );
