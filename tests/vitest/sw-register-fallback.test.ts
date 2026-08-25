/**
 * Extensionless SW registration fallback.
 *
 * Some hosts' web servers (WordPress.com) 404 virtual `.js` paths
 * before WordPress runs, so registering the pretty `/openstation/sw.js`
 * URL throws. `registerServiceWorker` must retry once with
 * `config.swFallbackUrl` (`/?openstation_sw=1`), and a SW registered
 * through the fallback must not be mistaken for a foreign worker on the
 * next boot.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	_resetSwRegistration,
	getSwRegistrationStatus,
	registerServiceWorker,
} from '../../src/pwa/sw-register';
import type { PwaConfig } from '../../src/types';

type RegistrationLike = Pick<
	ServiceWorkerRegistration,
	'scope' | 'active' | 'installing'
>;

const SW_URL = 'https://example.test/openstation/sw.js';
const FALLBACK_URL = 'https://example.test/?openstation_sw=1';

function makeConfig(): PwaConfig {
	return {
		manifestUrl: 'https://example.test/openstation/manifest.webmanifest',
		swUrl: SW_URL,
		swFallbackUrl: FALLBACK_URL,
		stateUrl: 'https://example.test/wp-json/desktop-mode/v1/pwa-state',
		state: { installHintDismissed: false, notificationsEnabled: false },
	} as PwaConfig;
}

interface StubOptions {
	failUrls: string[];
	registrations?: RegistrationLike[];
}

function installSwStub( opts: StubOptions ) {
	const registrations: RegistrationLike[] = [
		...( opts.registrations ?? [] ),
	];
	const register = vi.fn( async ( url: string ) => {
		if ( opts.failUrls.includes( url ) ) {
			throw new TypeError(
				'Failed to register a ServiceWorker: A bad HTTP response code (404) was received when fetching the script.',
			);
		}
		const reg: RegistrationLike = {
			scope: '/',
			active: {
				scriptURL: url,
				state: 'activated',
			} as unknown as ServiceWorker,
			installing: null,
		};
		registrations.push( reg );
		return reg as unknown as ServiceWorkerRegistration;
	} );

	Object.defineProperty( window, 'isSecureContext', {
		value: true,
		configurable: true,
	} );
	Object.defineProperty( navigator, 'serviceWorker', {
		value: {
			register,
			getRegistrations: vi.fn( async () => registrations ),
			controller: null,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		},
		configurable: true,
	} );

	return { register };
}

function clearSwStub(): void {
	delete ( navigator as unknown as { serviceWorker?: unknown } )
		.serviceWorker;
}

describe( 'registerServiceWorker extensionless fallback', () => {
	beforeEach( () => {
		_resetSwRegistration();
	} );

	afterEach( () => {
		clearSwStub();
		vi.restoreAllMocks();
	} );

	test( 'retries with swFallbackUrl when the pretty URL 404s', async () => {
		const { register } = installSwStub( { failUrls: [ SW_URL ] } );
		const reg = await registerServiceWorker( makeConfig() );

		expect( reg ).not.toBeNull();
		expect( getSwRegistrationStatus() ).toBe( 'registered' );
		expect( register ).toHaveBeenCalledTimes( 2 );
		expect( register.mock.calls[ 0 ][ 0 ] ).toBe( SW_URL );
		expect( register.mock.calls[ 1 ][ 0 ] ).toBe( FALLBACK_URL );
	} );

	test( 'fails cleanly when both URLs are unregisterable', async () => {
		installSwStub( { failUrls: [ SW_URL, FALLBACK_URL ] } );
		const warn = vi
			.spyOn( console, 'warn' )
			.mockImplementation( () => undefined );
		const reg = await registerServiceWorker( makeConfig() );

		expect( reg ).toBeNull();
		expect( getSwRegistrationStatus() ).toBe( 'failed' );
		expect( warn ).toHaveBeenCalled();
	} );

	test( 'does not retry when no fallback URL is configured', async () => {
		const { register } = installSwStub( { failUrls: [ SW_URL ] } );
		vi.spyOn( console, 'warn' ).mockImplementation( () => undefined );
		const config = makeConfig();
		delete config.swFallbackUrl;
		const reg = await registerServiceWorker( config );

		expect( reg ).toBeNull();
		expect( register ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'a fallback-registered SW is ours, not foreign, on the next boot', async () => {
		const existing: RegistrationLike = {
			scope: '/',
			active: {
				scriptURL: FALLBACK_URL,
				state: 'activated',
			} as unknown as ServiceWorker,
			installing: null,
		};
		installSwStub( { failUrls: [], registrations: [ existing ] } );
		const reg = await registerServiceWorker( makeConfig() );

		expect( reg ).not.toBeNull();
		expect( getSwRegistrationStatus() ).toBe( 'registered' );
	} );
} );
