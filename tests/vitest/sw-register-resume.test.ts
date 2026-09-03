/**
 * Resume-time update checks.
 *
 * An installed app on a phone rarely navigates, and the browser only
 * looks for a new service worker on a navigation. `registerServiceWorker`
 * must therefore ask for an update itself whenever the page comes back
 * to the foreground — throttled, and never while hidden — so a release
 * reaches a shell that has been open for days.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	_resetSwRegistration,
	registerServiceWorker,
	SW_RESUME_CHECK_MIN_INTERVAL_MS,
} from '../../src/pwa/sw-register';
import type { PwaConfig } from '../../src/types';

const SW_URL = 'https://example.test/openstation/sw.js';

function makeConfig(): PwaConfig {
	return {
		manifestUrl: 'https://example.test/openstation/manifest.webmanifest',
		swUrl: SW_URL,
		swFallbackUrl: 'https://example.test/?openstation_sw=1',
		stateUrl: 'https://example.test/wp-json/desktop-mode/v1/pwa-state',
		state: { installHintDismissed: false, notificationsEnabled: false },
	} as PwaConfig;
}

function installSwStub() {
	const update = vi.fn( async () => undefined );
	const reg = {
		scope: '/',
		active: { scriptURL: SW_URL, state: 'activated' },
		installing: null,
		update,
	};
	Object.defineProperty( window, 'isSecureContext', { value: true, configurable: true } );
	Object.defineProperty( navigator, 'serviceWorker', {
		value: {
			register: vi.fn( async () => reg ),
			getRegistrations: vi.fn( async () => [] ),
			controller: null,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		},
		configurable: true,
	} );
	return { update };
}

function setVisibility( state: 'visible' | 'hidden' ): void {
	Object.defineProperty( document, 'visibilityState', { value: state, configurable: true } );
	document.dispatchEvent( new Event( 'visibilitychange' ) );
}

describe( 'registerServiceWorker resume-time update check', () => {
	beforeEach( () => {
		_resetSwRegistration();
		vi.useFakeTimers();
		vi.setSystemTime( new Date( '2026-06-01T10:00:00Z' ) );
	} );

	afterEach( () => {
		delete ( navigator as unknown as { serviceWorker?: unknown } ).serviceWorker;
		Object.defineProperty( document, 'visibilityState', { value: 'visible', configurable: true } );
		vi.useRealTimers();
		vi.restoreAllMocks();
	} );

	test( 'asks the registration for an update when the page comes back, at most once per interval', async () => {
		const { update } = installSwStub();
		await registerServiceWorker( makeConfig() );

		// Registration itself counts as a check: coming back right away is free.
		setVisibility( 'visible' );
		expect( update ).not.toHaveBeenCalled();

		vi.advanceTimersByTime( SW_RESUME_CHECK_MIN_INTERVAL_MS + 1 );
		setVisibility( 'visible' );
		expect( update ).toHaveBeenCalledTimes( 1 );

		// Another return a minute later is inside the window.
		vi.advanceTimersByTime( 60_000 );
		setVisibility( 'visible' );
		expect( update ).toHaveBeenCalledTimes( 1 );

		// The back-forward cache restoring the page is a return too.
		vi.advanceTimersByTime( SW_RESUME_CHECK_MIN_INTERVAL_MS );
		window.dispatchEvent( new Event( 'pageshow' ) );
		expect( update ).toHaveBeenCalledTimes( 2 );
	} );

	test( 'never checks while the page is hidden', async () => {
		const { update } = installSwStub();
		await registerServiceWorker( makeConfig() );
		vi.advanceTimersByTime( SW_RESUME_CHECK_MIN_INTERVAL_MS + 1 );
		setVisibility( 'hidden' );
		expect( update ).not.toHaveBeenCalled();
	} );

	test( 'a rejected update is swallowed and asked again next time', async () => {
		const { update } = installSwStub();
		update.mockRejectedValueOnce( new TypeError( 'offline' ) );
		await registerServiceWorker( makeConfig() );
		vi.advanceTimersByTime( SW_RESUME_CHECK_MIN_INTERVAL_MS + 1 );
		setVisibility( 'visible' );
		await Promise.resolve();
		vi.advanceTimersByTime( SW_RESUME_CHECK_MIN_INTERVAL_MS + 1 );
		setVisibility( 'visible' );
		expect( update ).toHaveBeenCalledTimes( 2 );
	} );
} );
