/**
 * Tests for the visibility-aware widget poller.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startVisibilityAwarePoller } from './poller';

/** Flip jsdom's document.hidden and fire visibilitychange. */
function setHidden( hidden: boolean ): void {
	Object.defineProperty( document, 'hidden', {
		configurable: true,
		get: () => hidden,
	} );
	document.dispatchEvent( new Event( 'visibilitychange' ) );
}

describe( 'startVisibilityAwarePoller', () => {
	beforeEach( () => {
		vi.useFakeTimers();
		Object.defineProperty( document, 'hidden', {
			configurable: true,
			get: () => false,
		} );
	} );

	afterEach( () => {
		vi.useRealTimers();
	} );

	it( 'polls on the interval while visible', () => {
		const refresh = vi.fn();
		const poller = startVisibilityAwarePoller( refresh, 1000 );

		vi.advanceTimersByTime( 3000 );
		expect( refresh ).toHaveBeenCalledTimes( 3 );
		poller.stop();
	} );

	it( 'stops polling while hidden and resumes on reveal', () => {
		const refresh = vi.fn();
		const poller = startVisibilityAwarePoller( refresh, 1000 );

		setHidden( true );
		vi.advanceTimersByTime( 5000 );
		expect( refresh ).not.toHaveBeenCalled();

		// Reveal after >1 interval hidden → immediate catch-up run,
		// then the timer cadence resumes.
		setHidden( false );
		expect( refresh ).toHaveBeenCalledTimes( 1 );
		vi.advanceTimersByTime( 1000 );
		expect( refresh ).toHaveBeenCalledTimes( 2 );
		poller.stop();
	} );

	it( 'does not catch-up refresh on a quick tab flip', () => {
		const refresh = vi.fn();
		const poller = startVisibilityAwarePoller( refresh, 60_000 );

		vi.advanceTimersByTime( 1000 );
		setHidden( true );
		vi.advanceTimersByTime( 1000 );
		setHidden( false );
		expect( refresh ).not.toHaveBeenCalled();
		poller.stop();
	} );

	it( 'stop() ends polling and detaches the listener', () => {
		const refresh = vi.fn();
		const poller = startVisibilityAwarePoller( refresh, 1000 );
		poller.stop();

		vi.advanceTimersByTime( 5000 );
		setHidden( true );
		setHidden( false );
		vi.advanceTimersByTime( 5000 );
		expect( refresh ).not.toHaveBeenCalled();
	} );

	it( 'does not start the timer when created while hidden', () => {
		setHidden( true );
		const refresh = vi.fn();
		const poller = startVisibilityAwarePoller( refresh, 1000 );

		vi.advanceTimersByTime( 5000 );
		expect( refresh ).not.toHaveBeenCalled();

		// First reveal: created-time counts as the last run, so a
		// >1-interval gap triggers the catch-up.
		setHidden( false );
		expect( refresh ).toHaveBeenCalledTimes( 1 );
		poller.stop();
	} );
} );
