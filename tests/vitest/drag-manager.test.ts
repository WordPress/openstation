/**
 * Unit tests for the centralized DragManager.
 *
 * Exercises the state machine: lift threshold, single-session
 * invariant, drop-target hit-testing + claim-boundary, ghost
 * lifecycle, click-only fallback for sub-threshold gestures.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { installHooksStub, clearHooksStub } from './helpers/hooks-stub';
import { DragManager } from '../../src/drag/manager';
import { __resetRecoveryForTests } from '../../src/drag/recovery';
import type { DragPayload, DropTarget } from '../../src/drag/types';

/**
 * jsdom doesn't construct `PointerEvent`s, so we synthesize a plain
 * Event with the fields the manager reads. Same trick `drag-unstate.test.ts`
 * uses for the title-bar drag tests.
 */
function pointerEvent(
	type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
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

function makeSource( id: string ): HTMLElement {
	const el = document.createElement( 'div' );
	el.id = id;
	el.className = 'desktop-mode-file-tile';
	el.style.position = 'absolute';
	el.style.width = '88px';
	el.style.height = '96px';
	document.body.appendChild( el );
	return el;
}

function makeTargetElement( id: string, rect: { x: number; y: number; w: number; h: number } ): HTMLElement {
	const el = document.createElement( 'div' );
	el.id = id;
	el.style.position = 'absolute';
	el.style.left = `${ rect.x }px`;
	el.style.top = `${ rect.y }px`;
	el.style.width = `${ rect.w }px`;
	el.style.height = `${ rect.h }px`;
	document.body.appendChild( el );
	// jsdom doesn't compute layouts, so `elementFromPoint` returns
	// nothing useful by default. Stub it on `document` to walk our
	// targets and return the first whose stored rect contains (x, y).
	return el;
}

interface Rect { x: number; y: number; w: number; h: number }

function installElementFromPointStub( regions: Array< { el: Element; rect: Rect } > ): void {
	const ordered = [ ...regions ];
	document.elementFromPoint = ( x: number, y: number ): Element | null => {
		// Search in REVERSE registration order so later registrations
		// win on overlap (matches "last appended is on top" intuition).
		for ( let i = ordered.length - 1; i >= 0; i -= 1 ) {
			const { el, rect } = ordered[ i ];
			if (
				x >= rect.x &&
				x < rect.x + rect.w &&
				y >= rect.y &&
				y < rect.y + rect.h
			) {
				return el;
			}
		}
		return null;
	};
}

describe( 'DragManager', () => {
	beforeEach( () => {
		installHooksStub();
		__resetRecoveryForTests();
		// jsdom default: no elementFromPoint. Tests that need a
		// specific hit-test result call `installElementFromPointStub`
		// to override; everything else gets null (no target found).
		document.elementFromPoint = () => null;
	} );

	afterEach( () => {
		clearHooksStub();
		document.body.innerHTML = '';
		vi.unstubAllGlobals();
	} );

	test( 'sub-threshold gesture fires onClickOnly without lifting the ghost', () => {
		const manager = new DragManager();
		const source = makeSource( 'src' );
		const onClickOnly = vi.fn();
		const onCommit = vi.fn();

		const session = manager.start( {
			payload: { type: 'desktop-file', source, data: {} },
			origin: pointerEvent( 'pointerdown', 100, 100, source ),
			onClickOnly,
			onCommit,
		} );
		expect( session ).not.toBeNull();
		expect( manager.isDragging() ).toBe( false ); // not lifted yet

		// Move 2px — below threshold.
		document.dispatchEvent( pointerEvent( 'pointermove', 102, 100 ) );
		expect( manager.isDragging() ).toBe( false );
		expect( document.querySelector( '.desktop-mode-drag-ghost' ) ).toBeNull();

		// Release.
		document.dispatchEvent( pointerEvent( 'pointerup', 102, 100 ) );
		expect( onClickOnly ).toHaveBeenCalledTimes( 1 );
		expect( onCommit ).not.toHaveBeenCalled();
		expect( manager.getActive() ).toBeNull();
	} );

	test( 'super-threshold gesture lifts ghost and applies --dragging to source', () => {
		const manager = new DragManager();
		const source = makeSource( 'src' );

		manager.start( {
			payload: { type: 'desktop-file', source, data: {} },
			origin: pointerEvent( 'pointerdown', 100, 100, source ),
		} );

		document.dispatchEvent( pointerEvent( 'pointermove', 110, 100 ) );
		expect( manager.isDragging() ).toBe( true );
		expect( source.classList.contains( 'desktop-mode-file-tile--dragging' ) ).toBe( true );
		const ghost = document.querySelector( '.desktop-mode-drag-ghost' );
		expect( ghost ).not.toBeNull();

		document.dispatchEvent( pointerEvent( 'pointerup', 110, 100 ) );
		// Cleanup.
		expect( source.classList.contains( 'desktop-mode-file-tile--dragging' ) ).toBe( false );
		expect( document.querySelector( '.desktop-mode-drag-ghost' ) ).toBeNull();
	} );

	test( 'second start() while dragging returns null', () => {
		const manager = new DragManager();
		const a = makeSource( 'a' );
		const b = makeSource( 'b' );

		manager.start( {
			payload: { type: 'desktop-file', source: a, data: {} },
			origin: pointerEvent( 'pointerdown', 50, 50, a ),
		} );
		document.dispatchEvent( pointerEvent( 'pointermove', 60, 50 ) );
		expect( manager.isDragging() ).toBe( true );

		const second = manager.start( {
			payload: { type: 'desktop-file', source: b, data: {} },
			origin: pointerEvent( 'pointerdown', 200, 200, b ),
		} );
		expect( second ).toBeNull();
	} );

	test( 'commit fires onDrop on the accepting target and onCommit on the source', () => {
		const manager = new DragManager();
		const source = makeSource( 'src' );
		const targetEl = makeTargetElement( 'tgt', { x: 200, y: 200, w: 100, h: 100 } );
		installElementFromPointStub( [ { el: targetEl, rect: { x: 200, y: 200, w: 100, h: 100 } } ] );

		const onDrop = vi.fn();
		const onCommit = vi.fn();
		const target: DropTarget = {
			id: 'tgt',
			element: targetEl,
			accept: () => true,
			onDrop,
		};
		const deregister = manager.registerDropTarget( target );
		const payload: DragPayload = { type: 'desktop-file', source, data: { foo: 'bar' } };

		manager.start( {
			payload,
			origin: pointerEvent( 'pointerdown', 50, 50, source ),
			onCommit,
		} );
		document.dispatchEvent( pointerEvent( 'pointermove', 250, 250 ) );
		document.dispatchEvent( pointerEvent( 'pointerup', 250, 250 ) );

		expect( onDrop ).toHaveBeenCalledTimes( 1 );
		expect( onDrop.mock.calls[ 0 ][ 1 ] ).toEqual( { clientX: 250, clientY: 250 } );
		expect( onCommit ).toHaveBeenCalledTimes( 1 );
		expect( onCommit.mock.calls[ 0 ][ 0 ] ).toBe( target );

		deregister();
	} );

	test( 'rejecting target prevents onDrop and reports rejected', () => {
		const manager = new DragManager();
		const source = makeSource( 'src' );
		const targetEl = makeTargetElement( 'tgt', { x: 200, y: 200, w: 100, h: 100 } );
		installElementFromPointStub( [ { el: targetEl, rect: { x: 200, y: 200, w: 100, h: 100 } } ] );

		const onDrop = vi.fn();
		const onCommit = vi.fn();
		const onCancel = vi.fn();
		manager.registerDropTarget( {
			id: 'tgt',
			element: targetEl,
			accept: () => false, // rejects
			onDrop,
		} );

		manager.start( {
			payload: { type: 'desktop-file', source, data: {} },
			origin: pointerEvent( 'pointerdown', 50, 50, source ),
			onCommit,
			onCancel,
		} );
		document.dispatchEvent( pointerEvent( 'pointermove', 250, 250 ) );
		document.dispatchEvent( pointerEvent( 'pointerup', 250, 250 ) );

		expect( onDrop ).not.toHaveBeenCalled();
		expect( onCommit ).not.toHaveBeenCalled();
		expect( onCancel ).toHaveBeenCalledWith( 'rejected' );
	} );

	test( 'no-target drop fires onCancel with no-target reason', () => {
		const manager = new DragManager();
		const source = makeSource( 'src' );
		installElementFromPointStub( [] );
		const onCancel = vi.fn();

		manager.start( {
			payload: { type: 'desktop-file', source, data: {} },
			origin: pointerEvent( 'pointerdown', 50, 50, source ),
			onCancel,
		} );
		document.dispatchEvent( pointerEvent( 'pointermove', 250, 250 ) );
		document.dispatchEvent( pointerEvent( 'pointerup', 250, 250 ) );

		expect( onCancel ).toHaveBeenCalledWith( 'no-target' );
	} );

	test( 'deregister removes the target from hit-testing', () => {
		const manager = new DragManager();
		const source = makeSource( 'src' );
		const targetEl = makeTargetElement( 'tgt', { x: 200, y: 200, w: 100, h: 100 } );
		installElementFromPointStub( [ { el: targetEl, rect: { x: 200, y: 200, w: 100, h: 100 } } ] );

		const onDrop = vi.fn();
		const deregister = manager.registerDropTarget( {
			id: 'tgt',
			element: targetEl,
			accept: () => true,
			onDrop,
		} );
		expect( manager.debug().listTargets().length ).toBe( 1 );

		deregister();
		expect( manager.debug().listTargets().length ).toBe( 0 );

		manager.start( {
			payload: { type: 'desktop-file', source, data: {} },
			origin: pointerEvent( 'pointerdown', 50, 50, source ),
		} );
		document.dispatchEvent( pointerEvent( 'pointermove', 250, 250 ) );
		document.dispatchEvent( pointerEvent( 'pointerup', 250, 250 ) );
		expect( onDrop ).not.toHaveBeenCalled();
	} );

	test( 'cancel() during drag tears down ghost and source class', () => {
		const manager = new DragManager();
		const source = makeSource( 'src' );

		const session = manager.start( {
			payload: { type: 'desktop-file', source, data: {} },
			origin: pointerEvent( 'pointerdown', 50, 50, source ),
		} );
		document.dispatchEvent( pointerEvent( 'pointermove', 60, 50 ) );
		expect( source.classList.contains( 'desktop-mode-file-tile--dragging' ) ).toBe( true );
		expect( document.querySelector( '.desktop-mode-drag-ghost' ) ).not.toBeNull();

		session?.cancel();
		expect( session?.isFinished() ).toBe( true );
		expect( source.classList.contains( 'desktop-mode-file-tile--dragging' ) ).toBe( false );
		expect( document.querySelector( '.desktop-mode-drag-ghost' ) ).toBeNull();
		expect( manager.getActive() ).toBeNull();
	} );

	test( 'cleanup is idempotent — double cancel is a no-op', () => {
		const manager = new DragManager();
		const source = makeSource( 'src' );
		const onCancel = vi.fn();

		const session = manager.start( {
			payload: { type: 'desktop-file', source, data: {} },
			origin: pointerEvent( 'pointerdown', 50, 50, source ),
			onCancel,
		} );
		document.dispatchEvent( pointerEvent( 'pointermove', 60, 50 ) );
		session?.cancel();
		session?.cancel(); // second call
		expect( onCancel ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'enter/leave fires once per transition', () => {
		const manager = new DragManager();
		const source = makeSource( 'src' );
		const a = makeTargetElement( 'a', { x: 200, y: 0, w: 100, h: 100 } );
		const b = makeTargetElement( 'b', { x: 400, y: 0, w: 100, h: 100 } );
		installElementFromPointStub( [
			{ el: a, rect: { x: 200, y: 0, w: 100, h: 100 } },
			{ el: b, rect: { x: 400, y: 0, w: 100, h: 100 } },
		] );

		const aEnter = vi.fn();
		const aLeave = vi.fn();
		const bEnter = vi.fn();
		manager.registerDropTarget( {
			id: 'a', element: a, accept: () => true, onDrop: () => undefined, onEnter: aEnter, onLeave: aLeave,
		} );
		manager.registerDropTarget( {
			id: 'b', element: b, accept: () => true, onDrop: () => undefined, onEnter: bEnter,
		} );

		manager.start( {
			payload: { type: 'desktop-file', source, data: {} },
			origin: pointerEvent( 'pointerdown', 50, 50, source ),
		} );
		document.dispatchEvent( pointerEvent( 'pointermove', 250, 50 ) ); // over A
		expect( aEnter ).toHaveBeenCalledTimes( 1 );
		document.dispatchEvent( pointerEvent( 'pointermove', 260, 50 ) ); // still over A
		expect( aEnter ).toHaveBeenCalledTimes( 1 );
		document.dispatchEvent( pointerEvent( 'pointermove', 450, 50 ) ); // over B
		expect( aLeave ).toHaveBeenCalledTimes( 1 );
		expect( bEnter ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'findOrphans returns elements with stale drag classes/attrs', () => {
		const manager = new DragManager();
		const dirty = makeSource( 'dirty' );
		dirty.classList.add( 'desktop-mode-file-tile--dragging' );
		const someBin = document.createElement( 'div' );
		someBin.setAttribute( 'data-desktop-mode-trash-drop-active', '' );
		document.body.appendChild( someBin );

		const orphans = manager.debug().findOrphans();
		expect( orphans ).toContain( dirty );
		expect( orphans ).toContain( someBin );
	} );
} );
