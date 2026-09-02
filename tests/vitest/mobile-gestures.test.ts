/**
 * Tests for `src/mobile/gestures.ts` — the phone gestures.
 *
 * The decisions are pure (`swipeOutcome`, `edgeSwipeProgress`); the
 * binders are driven with synthetic PointerEvents in jsdom.
 */
import { describe, expect, test, vi } from 'vitest';
import {
	bindEdgeBack,
	bindSwipeDown,
	bindSwipeUp,
	EDGE_BACK_THRESHOLD,
	edgeSwipeProgress,
	SWIPE_COMMIT_FRACTION,
	swipeOutcome,
} from '../../src/mobile/gestures';

function pointer( type: string, init: { x: number; y: number; id?: number; pointerType?: string } ): PointerEvent {
	// jsdom lacks a PointerEvent constructor with the pointer fields;
	// a MouseEvent carrying them is enough for the binders.
	const e = new MouseEvent( type, { bubbles: true, clientX: init.x, clientY: init.y } ) as unknown as PointerEvent;
	Object.defineProperties( e, {
		pointerId: { value: init.id ?? 1 },
		isPrimary: { value: true },
		pointerType: { value: init.pointerType ?? 'touch' },
	} );
	return e;
}

describe( 'swipeOutcome', () => {
	test( 'a long enough travel commits', () => {
		expect( swipeOutcome( { dx: 300 * SWIPE_COMMIT_FRACTION, dy: 4, velocity: 0, width: 300 } ) ).toBe( 'commit' );
		expect( swipeOutcome( { dx: -300 * SWIPE_COMMIT_FRACTION, dy: 4, velocity: 0, width: 300 } ) ).toBe( 'commit' );
	} );

	test( 'a fast flick commits a short travel, in the flick direction only', () => {
		expect( swipeOutcome( { dx: 40, dy: 2, velocity: 0.9, width: 300 } ) ).toBe( 'commit' );
		expect( swipeOutcome( { dx: 40, dy: 2, velocity: -0.9, width: 300 } ) ).toBe( 'cancel' );
		expect( swipeOutcome( { dx: 10, dy: 2, velocity: 2, width: 300 } ) ).toBe( 'cancel' );
	} );

	test( 'a vertical drag never commits', () => {
		expect( swipeOutcome( { dx: 120, dy: 140, velocity: 1, width: 300 } ) ).toBe( 'cancel' );
	} );
} );

describe( 'edgeSwipeProgress', () => {
	test( 'clamps to 0..1', () => {
		expect( edgeSwipeProgress( -10 ) ).toBe( 0 );
		expect( edgeSwipeProgress( EDGE_BACK_THRESHOLD / 2 ) ).toBeCloseTo( 0.5 );
		expect( edgeSwipeProgress( EDGE_BACK_THRESHOLD * 3 ) ).toBe( 1 );
	} );
} );

describe( 'bindEdgeBack', () => {
	test( 'commits past the threshold, reports progress, and cancels a vertical drag', () => {
		const zone = document.createElement( 'div' );
		const onCommit = vi.fn();
		const onProgress = vi.fn();
		const unbind = bindEdgeBack( zone, { onCommit, onProgress, threshold: 50 } );

		zone.dispatchEvent( pointer( 'pointerdown', { x: 4, y: 100 } ) );
		zone.dispatchEvent( pointer( 'pointermove', { x: 29, y: 102 } ) );
		expect( onProgress ).toHaveBeenLastCalledWith( 0.5 );
		zone.dispatchEvent( pointer( 'pointerup', { x: 70, y: 103 } ) );
		expect( onCommit ).toHaveBeenCalledTimes( 1 );
		expect( onProgress ).toHaveBeenLastCalledWith( 0 );

		// A scroll that started at the edge.
		zone.dispatchEvent( pointer( 'pointerdown', { x: 4, y: 100 } ) );
		zone.dispatchEvent( pointer( 'pointermove', { x: 8, y: 140 } ) );
		zone.dispatchEvent( pointer( 'pointerup', { x: 90, y: 200 } ) );
		expect( onCommit ).toHaveBeenCalledTimes( 1 );

		unbind();
		zone.dispatchEvent( pointer( 'pointerdown', { x: 4, y: 100 } ) );
		zone.dispatchEvent( pointer( 'pointerup', { x: 200, y: 100 } ) );
		expect( onCommit ).toHaveBeenCalledTimes( 1 );
	} );
} );

describe( 'bindSwipeUp', () => {
	test( 'commits once on a flick up and swallows the click that follows', () => {
		const bar = document.createElement( 'nav' );
		const button = document.createElement( 'button' );
		bar.appendChild( button );
		document.body.appendChild( bar );
		const onCommit = vi.fn();
		const clicked = vi.fn();
		button.addEventListener( 'click', clicked );
		bindSwipeUp( bar, { onCommit, threshold: 40 } );

		button.dispatchEvent( pointer( 'pointerdown', { x: 50, y: 500 } ) );
		button.dispatchEvent( pointer( 'pointermove', { x: 52, y: 470 } ) );
		expect( onCommit ).not.toHaveBeenCalled();
		button.dispatchEvent( pointer( 'pointermove', { x: 54, y: 450 } ) );
		button.dispatchEvent( pointer( 'pointermove', { x: 54, y: 400 } ) );
		expect( onCommit ).toHaveBeenCalledTimes( 1 );
		button.dispatchEvent( pointer( 'pointerup', { x: 54, y: 400 } ) );
		button.click();
		expect( clicked ).not.toHaveBeenCalled();
		// The next tap is a real tap again.
		button.click();
		expect( clicked ).toHaveBeenCalledTimes( 1 );
		bar.remove();
	} );

	test( 'bindSwipeDown is the mirror', () => {
		const bar = document.createElement( 'header' );
		const onCommit = vi.fn();
		bindSwipeDown( bar, { onCommit, threshold: 40 } );
		bar.dispatchEvent( pointer( 'pointerdown', { x: 50, y: 20 } ) );
		bar.dispatchEvent( pointer( 'pointermove', { x: 52, y: 40 } ) );
		expect( onCommit ).not.toHaveBeenCalled();
		bar.dispatchEvent( pointer( 'pointermove', { x: 54, y: 70 } ) );
		expect( onCommit ).toHaveBeenCalledTimes( 1 );
		// An upward flick on the same binder does nothing.
		bar.dispatchEvent( pointer( 'pointerup', { x: 54, y: 70 } ) );
		bar.dispatchEvent( pointer( 'pointerdown', { x: 50, y: 200 } ) );
		bar.dispatchEvent( pointer( 'pointermove', { x: 50, y: 100 } ) );
		expect( onCommit ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'ignores a mouse', () => {
		const bar = document.createElement( 'nav' );
		const onCommit = vi.fn();
		bindSwipeUp( bar, { onCommit, threshold: 40 } );
		bar.dispatchEvent( pointer( 'pointerdown', { x: 50, y: 500, pointerType: 'mouse' } ) );
		bar.dispatchEvent( pointer( 'pointermove', { x: 50, y: 300, pointerType: 'mouse' } ) );
		expect( onCommit ).not.toHaveBeenCalled();
	} );
} );
