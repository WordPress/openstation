/**
 * Content Graph — the full-canvas loader only paints for a long wait.
 *
 * Same shape as the window shell's own threshold test
 * (`window-loading.test.ts`): arm, advance to one tick short of the
 * delay, assert nothing painted, advance one more, assert it did.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	createLoadingOverlay,
	LOADING_OVERLAY_DELAY_MS,
	LOADING_OVERLAY_VISIBLE_CLASS,
} from '../../src/content-graph/loading-overlay';

describe( 'createLoadingOverlay', () => {
	let el: HTMLElement;

	beforeEach( () => {
		vi.useFakeTimers();
		el = document.createElement( 'div' );
	} );

	afterEach( () => {
		vi.useRealTimers();
	} );

	test( 'starts invisible, whatever the template shipped', () => {
		el.hidden = true;
		el.classList.add( LOADING_OVERLAY_VISIBLE_CLASS );
		const overlay = createLoadingOverlay( el );
		expect( el.hidden ).toBe( false );
		expect( overlay.isVisible() ).toBe( false );
	} );

	test( 'a fetch that lands inside the delay never paints the wash', () => {
		const overlay = createLoadingOverlay( el );
		overlay.show();
		vi.advanceTimersByTime( LOADING_OVERLAY_DELAY_MS - 1 );
		expect( overlay.isVisible() ).toBe( false );
		overlay.hide();
		vi.advanceTimersByTime( LOADING_OVERLAY_DELAY_MS * 2 );
		expect( overlay.isVisible() ).toBe( false );
	} );

	test( 'a long fetch paints it once the delay elapses', () => {
		const overlay = createLoadingOverlay( el );
		overlay.show();
		vi.advanceTimersByTime( LOADING_OVERLAY_DELAY_MS - 1 );
		expect( overlay.isVisible() ).toBe( false );
		vi.advanceTimersByTime( 1 );
		expect( overlay.isVisible() ).toBe( true );
		expect( el.classList.contains( LOADING_OVERLAY_VISIBLE_CLASS ) ).toBe(
			true,
		);
	} );

	test( 'hide drops the wash immediately', () => {
		const overlay = createLoadingOverlay( el );
		overlay.show();
		vi.advanceTimersByTime( LOADING_OVERLAY_DELAY_MS );
		expect( overlay.isVisible() ).toBe( true );
		overlay.hide();
		expect( overlay.isVisible() ).toBe( false );
	} );

	test( 'a second show while armed does not restart the clock', () => {
		const overlay = createLoadingOverlay( el );
		overlay.show();
		vi.advanceTimersByTime( LOADING_OVERLAY_DELAY_MS - 50 );
		overlay.show();
		vi.advanceTimersByTime( 50 );
		expect( overlay.isVisible() ).toBe( true );
	} );

	test( 're-arms cleanly after a hide (the per-chip-toggle sequence)', () => {
		const overlay = createLoadingOverlay( el );
		// First fetch: long enough to paint.
		overlay.show();
		vi.advanceTimersByTime( LOADING_OVERLAY_DELAY_MS );
		expect( overlay.isVisible() ).toBe( true );
		overlay.hide();
		// Second fetch: the clock restarts from zero, not from the
		// first arm, and paints again once the full delay elapses.
		overlay.show();
		vi.advanceTimersByTime( LOADING_OVERLAY_DELAY_MS - 1 );
		expect( overlay.isVisible() ).toBe( false );
		vi.advanceTimersByTime( 1 );
		expect( overlay.isVisible() ).toBe( true );
	} );

	test( 'destroy disarms a pending show', () => {
		const overlay = createLoadingOverlay( el );
		overlay.show();
		overlay.destroy();
		vi.advanceTimersByTime( LOADING_OVERLAY_DELAY_MS * 2 );
		expect( overlay.isVisible() ).toBe( false );
	} );

	test( 'tolerates a missing element', () => {
		const overlay = createLoadingOverlay( null );
		expect( () => {
			overlay.show();
			vi.advanceTimersByTime( LOADING_OVERLAY_DELAY_MS );
			overlay.hide();
			overlay.destroy();
		} ).not.toThrow();
		expect( overlay.isVisible() ).toBe( false );
	} );
} );
