/**
 * Foreign-SW install affordance — fix for GH #239.
 *
 * Covers:
 *   - `registerServiceWorker` tags `_status = 'foreign-sw'` when another
 *     root-scope SW is on the origin, leaves `_status = 'registered'`
 *     when ours wins, and respects `forceReplace: true` to bypass the
 *     guard.
 *   - `getInstallTileDef(...).onOpen` surfaces the foreign-SW-specific
 *     toast (rather than the generic "not available" fallback) once the
 *     status flips, so users see the actionable message naming the
 *     `openstation_pwa_force_replace_sw` filter.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	_resetSwRegistration,
	getSwRegistrationStatus,
	registerServiceWorker,
} from '../../src/pwa/sw-register';
import {
	_resetInstallAffordance,
	getInstallTileDef,
} from '../../src/pwa/install';

type RegistrationLike = Pick<
	ServiceWorkerRegistration,
	'scope' | 'active' | 'installing'
>;

interface SwTestHandle {
	registrations: RegistrationLike[];
	register: ReturnType< typeof vi.fn >;
}

function installSwStub( initial: RegistrationLike[] = [] ): SwTestHandle {
	const handle: SwTestHandle = {
		registrations: [ ...initial ],
		register: vi.fn( async ( url: string ) => {
			const reg: RegistrationLike = {
				scope: '/',
				active: {
					scriptURL: url,
					state: 'activated',
				} as unknown as ServiceWorker,
				installing: null,
			};
			handle.registrations.push( reg );
			return reg as unknown as ServiceWorkerRegistration;
		} ),
	};

	Object.defineProperty( window, 'isSecureContext', {
		value: true,
		configurable: true,
	} );

	const swStub = {
		register: handle.register,
		getRegistrations: vi.fn( async () => handle.registrations ),
		controller: null,
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
	};

	Object.defineProperty( navigator, 'serviceWorker', {
		value: swStub,
		configurable: true,
	} );

	return handle;
}

function clearSwStub(): void {
	// `delete` works because we set `configurable: true` above.
	delete ( navigator as unknown as { serviceWorker?: unknown } )
		.serviceWorker;
}

const SW_URL = 'https://example.test/desktop-mode/sw.js';
const FOREIGN_REG: RegistrationLike = {
	scope: '/',
	active: {
		scriptURL: 'https://example.test/wp-content/plugins/other-pwa/sw.js',
		state: 'activated',
	} as unknown as ServiceWorker,
	installing: null,
};

beforeEach( () => {
	_resetSwRegistration();
	_resetInstallAffordance();
} );

afterEach( () => {
	clearSwStub();
	_resetSwRegistration();
	_resetInstallAffordance();
} );

describe( 'registerServiceWorker — foreign SW detection', () => {
	test( 'status starts at "pending"', () => {
		expect( getSwRegistrationStatus() ).toBe( 'pending' );
	} );

	test( 'flips to "foreign-sw" when another root-scope SW is registered', async () => {
		installSwStub( [ FOREIGN_REG ] );
		const result = await registerServiceWorker( {
			manifestUrl: '',
			swUrl: SW_URL,
			stateUrl: '',
			state: {
				installHintDismissed: false,
				notificationsEnabled: false,
			},
			appName: 'Test',
		} );
		expect( result ).toBeNull();
		expect( getSwRegistrationStatus() ).toBe( 'foreign-sw' );
	} );

	test( 'flips to "registered" when no foreign SW is present', async () => {
		const handle = installSwStub( [] );
		const result = await registerServiceWorker( {
			manifestUrl: '',
			swUrl: SW_URL,
			stateUrl: '',
			state: {
				installHintDismissed: false,
				notificationsEnabled: false,
			},
			appName: 'Test',
		} );
		expect( result ).not.toBeNull();
		expect( getSwRegistrationStatus() ).toBe( 'registered' );
		expect( handle.register ).toHaveBeenCalledWith( SW_URL, {
			scope: '/',
			updateViaCache: 'none',
		} );
	} );

	test( 'forceReplace bypasses the foreign-SW guard and registers anyway', async () => {
		const handle = installSwStub( [ FOREIGN_REG ] );
		const result = await registerServiceWorker(
			{
				manifestUrl: '',
				swUrl: SW_URL,
				stateUrl: '',
				state: {
					installHintDismissed: false,
					notificationsEnabled: false,
				},
				appName: 'Test',
			},
			{ forceReplace: true },
		);
		expect( result ).not.toBeNull();
		expect( getSwRegistrationStatus() ).toBe( 'registered' );
		expect( handle.register ).toHaveBeenCalledTimes( 1 );
	} );
} );

describe( 'install tile — foreign-SW toast surfacing', () => {
	test( 'fires the foreign-SW-specific toast when status is "foreign-sw"', async () => {
		installSwStub( [ FOREIGN_REG ] );
		await registerServiceWorker( {
			manifestUrl: '',
			swUrl: SW_URL,
			stateUrl: '',
			state: {
				installHintDismissed: false,
				notificationsEnabled: false,
			},
			appName: 'Test Site',
		} );
		expect( getSwRegistrationStatus() ).toBe( 'foreign-sw' );

		const showToast = vi.fn( () => () => {} );
		const tile = getInstallTileDef( 'Test Site', showToast );
		tile.onOpen();
		// onTileClick runs async (isLikelyInstalled is awaited).
		await new Promise( ( r ) => setTimeout( r, 0 ) );

		expect( showToast ).toHaveBeenCalledTimes( 1 );
		const msg = ( showToast.mock.calls[ 0 ][ 0 ] as { message: string } )
			.message;
		expect( msg ).toMatch(
			/another plugin's service worker|openstation_pwa_force_replace_sw/,
		);
	} );

	test( 'falls back to the generic toast when status is not "foreign-sw"', async () => {
		// No foreign SW registered, no `beforeinstallprompt` fired → the
		// click handler hits the generic "Install isn't available right
		// now" branch.
		installSwStub( [] );
		// Don't call registerServiceWorker — leave status at 'pending'
		// so we exercise the non-foreign path.

		const showToast = vi.fn( () => () => {} );
		const tile = getInstallTileDef( 'Test Site', showToast );
		tile.onOpen();
		await new Promise( ( r ) => setTimeout( r, 0 ) );

		expect( showToast ).toHaveBeenCalledTimes( 1 );
		const msg = ( showToast.mock.calls[ 0 ][ 0 ] as { message: string } )
			.message;
		expect( msg ).not.toMatch( /openstation_pwa_force_replace_sw/ );
		expect( msg ).toMatch( /isn't available right now/ );
	} );
} );
