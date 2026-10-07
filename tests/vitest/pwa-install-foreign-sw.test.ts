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

	test( 'a sibling site\'s OpenStation SW is not foreign, and swScope routes the registration', async () => {

		const siblingReg: RegistrationLike = {
			scope: '/',
			active: {
				scriptURL: 'https://example.test/openstation/sw.js',
				state: 'activated',
			} as unknown as ServiceWorker,
			installing: null,
		};
		const handle = installSwStub( [ siblingReg ] );
		const result = await registerServiceWorker( {
			manifestUrl: '',
			swUrl: 'https://example.test/site2/openstation/sw.js',
			swScope: '/site2/',
			stateUrl: '',
			state: {
				installHintDismissed: false,
				notificationsEnabled: false,
			},
			appName: 'Test',
		} );
		expect( result ).not.toBeNull();
		expect( getSwRegistrationStatus() ).toBe( 'registered' );
		expect( handle.register ).toHaveBeenCalledWith(
			'https://example.test/site2/openstation/sw.js',
			{
				scope: '/site2/',
				updateViaCache: 'none',
			},
		);
	} );

	test( 'the extensionless fallback shape of a sibling is not foreign either', async () => {
		const siblingReg: RegistrationLike = {
			scope: '/',
			active: {
				scriptURL: 'https://example.test/?openstation_sw=1',
				state: 'activated',
			} as unknown as ServiceWorker,
			installing: null,
		};
		installSwStub( [ siblingReg ] );
		const result = await registerServiceWorker( {
			manifestUrl: '',
			swUrl: 'https://example.test/site2/openstation/sw.js',
			swScope: '/site2/',
			stateUrl: '',
			state: {
				installHintDismissed: false,
				notificationsEnabled: false,
			},
			appName: 'Test',
		} );
		expect( result ).not.toBeNull();
		expect( getSwRegistrationStatus() ).toBe( 'registered' );
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

		await new Promise( ( r ) => setTimeout( r, 0 ) );

		expect( showToast ).toHaveBeenCalledTimes( 1 );
		const msg = ( showToast.mock.calls[ 0 ][ 0 ] as { message: string } )
			.message;
		expect( msg ).toMatch(
			/another plugin's service worker|openstation_pwa_force_replace_sw/,
		);
	} );

	test( 'falls back to the generic toast when status is not "foreign-sw"', async () => {

		installSwStub( [] );

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
