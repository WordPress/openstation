/**
 * Resume-time menu refresh checks.
 *
 * An installed app on a phone rarely navigates, and iOS keeps the page
 * in memory across days. `bindResumeMenuRefresh` must ask for a menu
 * payload update whenever the page returns to the foreground — throttled,
 * and never while hidden — so tile badges (e.g. pending plugin updates)
 * ripen on their own.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	_resetResumeMenuCheck,
	bindResumeMenuRefresh,
	MENU_RESUME_CHECK_MIN_INTERVAL_MS,
	noteMenuRefreshed,
} from '../../src/boot/menu-refresh';

function setVisibility( state: 'visible' | 'hidden' ): void {
	Object.defineProperty( document, 'visibilityState', { value: state, configurable: true } );
	document.dispatchEvent( new Event( 'visibilitychange' ) );
}

describe( 'bindResumeMenuRefresh', () => {
	beforeEach( () => {
		_resetResumeMenuCheck();
		vi.useFakeTimers();
		vi.setSystemTime( new Date( '2026-06-01T10:00:00Z' ) );
	} );

	afterEach( () => {
		_resetResumeMenuCheck();
		Object.defineProperty( document, 'visibilityState', { value: 'visible', configurable: true } );
		vi.useRealTimers();
		vi.restoreAllMocks();
	} );

	test( 'triggers refresh when returning to foreground after interval has passed', async () => {
		const refresh = vi.fn( async () => undefined );
		bindResumeMenuRefresh( refresh );

		// Immediate return after registration is throttled.
		setVisibility( 'visible' );
		expect( refresh ).not.toHaveBeenCalled();

		vi.advanceTimersByTime( MENU_RESUME_CHECK_MIN_INTERVAL_MS + 1 );
		setVisibility( 'visible' );
		expect( refresh ).toHaveBeenCalledTimes( 1 );

		// Another return a minute later is inside the window.
		vi.advanceTimersByTime( 60_000 );
		setVisibility( 'visible' );
		expect( refresh ).toHaveBeenCalledTimes( 1 );

		// pageshow (back-forward cache resume) triggers refresh once interval passes.
		vi.advanceTimersByTime( MENU_RESUME_CHECK_MIN_INTERVAL_MS );
		window.dispatchEvent( new Event( 'pageshow' ) );
		expect( refresh ).toHaveBeenCalledTimes( 2 );
	} );

	test( 'never checks while the page is hidden', async () => {
		const refresh = vi.fn( async () => undefined );
		bindResumeMenuRefresh( refresh );

		vi.advanceTimersByTime( MENU_RESUME_CHECK_MIN_INTERVAL_MS + 1 );
		setVisibility( 'hidden' );
		expect( refresh ).not.toHaveBeenCalled();
	} );

	test( 'a failing/rejected refresh is swallowed and asked again next time', async () => {
		const refresh = vi.fn( async () => undefined );
		refresh.mockRejectedValueOnce( new Error( 'network error' ) );
		bindResumeMenuRefresh( refresh );

		vi.advanceTimersByTime( MENU_RESUME_CHECK_MIN_INTERVAL_MS + 1 );
		setVisibility( 'visible' );
		await Promise.resolve();
		expect( refresh ).toHaveBeenCalledTimes( 1 );

		vi.advanceTimersByTime( MENU_RESUME_CHECK_MIN_INTERVAL_MS + 1 );
		setVisibility( 'visible' );
		expect( refresh ).toHaveBeenCalledTimes( 2 );
	} );

	test( 'noteMenuRefreshed pushes the next resume check forward', async () => {
		const refresh = vi.fn( async () => undefined );
		bindResumeMenuRefresh( refresh );

		vi.advanceTimersByTime( MENU_RESUME_CHECK_MIN_INTERVAL_MS + 1 );
		// A manual or in-session refresh happens.
		noteMenuRefreshed();

		// Returning immediately is now within the new throttle window.
		setVisibility( 'visible' );
		expect( refresh ).not.toHaveBeenCalled();

		vi.advanceTimersByTime( MENU_RESUME_CHECK_MIN_INTERVAL_MS + 1 );
		setVisibility( 'visible' );
		expect( refresh ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'unbind cleans up all listeners', async () => {
		const refresh = vi.fn( async () => undefined );
		const unbind = bindResumeMenuRefresh( refresh );
		unbind();

		vi.advanceTimersByTime( MENU_RESUME_CHECK_MIN_INTERVAL_MS + 1 );
		setVisibility( 'visible' );
		window.dispatchEvent( new Event( 'pageshow' ) );
		expect( refresh ).not.toHaveBeenCalled();
	} );
} );

