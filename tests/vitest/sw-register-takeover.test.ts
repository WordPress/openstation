/**
 * A new service worker, and what the shell does with it.
 *
 * The worker installs and WAITS; it never takes over on its own. The
 * shell asks it which shell build it was served with and compares that
 * with the page's own boot-time stamp. Same or unknown: the worker is
 * told to take over silently — caches refresh, nothing is shown. A real
 * difference — the shell's files changed on the server — reaches
 * `onShellUpdated`, once, and the worker keeps waiting until
 * `applyPendingUpdate()` (the user's Reload). Nothing in this module
 * reloads; the shell never reloads itself.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	_resetSwRegistration,
	applyPendingUpdate,
	registerServiceWorker,
	type ShellUpdateInfo,
} from '../../src/pwa/sw-register';
import type { PwaConfig } from '../../src/types';

const SW_URL = 'https://example.test/openstation/sw.js';
const CURRENT = 'aaaaaaaaaaaaaaaa';
const NEWER = 'bbbbbbbbbbbbbbbb';

/** `null` builds a payload from a server that sends no stamp at all. */
function makeConfig( shellBuild: string | null = CURRENT ): PwaConfig {
	return {
		manifestUrl: 'https://example.test/openstation/manifest.webmanifest',
		swUrl: SW_URL,
		swFallbackUrl: 'https://example.test/?openstation_sw=1',
		stateUrl: 'https://example.test/wp-json/desktop-mode/v1/pwa-state',
		state: { installHintDismissed: false, notificationsEnabled: false },
		...( shellBuild === null ? {} : { shellBuild } ),
	} as PwaConfig;
}

type Listener = ( ev: unknown ) => void;

/** A `ServiceWorker` stand-in whose state can be moved by hand. */
function makeWorker( state = 'installed' ) {
	const listeners = new Set< Listener >();
	const worker = {
		state,
		scriptURL: SW_URL,
		postMessage: vi.fn(),
		addEventListener: ( _type: string, cb: Listener ) => {
			listeners.add( cb );
		},
		setState( next: string ) {
			worker.state = next;
			for ( const cb of listeners ) {
				cb( {} );
			}
		},
		/** Messages of one type this worker was sent. */
		sent( type: string ) {
			return worker.postMessage.mock.calls.filter(
				( [ msg ] ) => ( msg as { type?: string } )?.type === type,
			).length;
		},
	};
	return worker;
}
type Worker = ReturnType< typeof makeWorker >;

/**
 * A `navigator.serviceWorker` + registration whose events can be fired
 * by hand. `controlled` decides whether the page starts with a
 * controller; `waiting` plants a worker already installed and waiting
 * when the page registers.
 */
function installSwStub( opts: { controlled?: boolean; waiting?: Worker | null } = {} ) {
	const controlled = opts.controlled ?? true;
	const containerListeners = new Map< string, Set< Listener > >();
	const registrationListeners = new Map< string, Set< Listener > >();
	const on = ( map: Map< string, Set< Listener > > ) => ( type: string, cb: Listener ) => {
		if ( ! map.has( type ) ) {
			map.set( type, new Set() );
		}
		map.get( type )!.add( cb );
	};
	const controller = controlled ? makeWorker( 'activated' ) : null;
	const reg = {
		scope: '/',
		active: { scriptURL: SW_URL, state: 'activated' },
		installing: null as Worker | null,
		waiting: opts.waiting ?? null,
		update: vi.fn( async () => undefined ),
		addEventListener: on( registrationListeners ),
	};
	Object.defineProperty( window, 'isSecureContext', { value: true, configurable: true } );
	Object.defineProperty( navigator, 'serviceWorker', {
		value: {
			register: vi.fn( async () => reg ),
			getRegistrations: vi.fn( async () => [] ),
			controller,
			addEventListener: on( containerListeners ),
			removeEventListener: ( type: string, cb: Listener ) => {
				containerListeners.get( type )?.delete( cb );
			},
		},
		configurable: true,
	} );
	const fire = ( map: Map< string, Set< Listener > >, type: string, ev: unknown = {} ): void => {
		for ( const cb of map.get( type ) ?? [] ) {
			cb( ev );
		}
	};
	return {
		reg,
		controller,
		/** The worker answers the build question. */
		reply: ( shellBuild: string ) =>
			fire( containerListeners, 'message', { data: { type: 'os-sw-build', shellBuild } } ),
		/** The swap happened: a worker took control of this page. */
		controllerChange: ( next?: Worker ) => {
			if ( next ) {
				( navigator.serviceWorker as unknown as { controller: Worker } ).controller = next;
			}
			fire( containerListeners, 'controllerchange' );
		},
		/** The browser found a new script and started installing it. */
		updateFound: ( installing: Worker ) => {
			reg.installing = installing;
			fire( registrationListeners, 'updatefound' );
		},
	};
}

async function settle(): Promise< void > {
	await vi.advanceTimersByTimeAsync( 0 );
}

describe( 'registerServiceWorker — a new worker', () => {
	beforeEach( () => {
		_resetSwRegistration();
		vi.useFakeTimers();
	} );

	afterEach( () => {
		delete ( navigator as unknown as { serviceWorker?: unknown } ).serviceWorker;
		vi.useRealTimers();
		vi.restoreAllMocks();
	} );

	test( 'a waiting worker with a new shell build is offered, once, and keeps waiting', async () => {
		const waiting = makeWorker();
		const stub = installSwStub( { waiting } );
		const onShellUpdated = vi.fn< ( info: ShellUpdateInfo ) => void >();
		await registerServiceWorker( makeConfig(), { onShellUpdated } );

		expect( waiting.sent( 'os-sw-get-build' ) ).toBe( 1 );
		stub.reply( NEWER );
		await settle();

		expect( onShellUpdated ).toHaveBeenCalledTimes( 1 );
		expect( onShellUpdated ).toHaveBeenCalledWith( { current: CURRENT, served: NEWER } );
		// Not told to take over: that is the user's call.
		expect( waiting.sent( 'os-sw-skip-waiting' ) ).toBe( 0 );

		// Taking the offer: the worker is told, and the promise settles
		// on the swap — before which the caller must not reload.
		let swapped = false;
		const applying = applyPendingUpdate().then( () => {
			swapped = true;
		} );
		expect( waiting.sent( 'os-sw-skip-waiting' ) ).toBe( 1 );
		await settle();
		expect( swapped ).toBe( false );
		stub.controllerChange( waiting );
		await applying;
		expect( swapped ).toBe( true );
		// The expected swap is not a takeover to investigate.
		expect( waiting.sent( 'os-sw-get-build' ) ).toBe( 1 );
	} );

	test( 'a waiting worker with the same shell build takes over silently', async () => {
		const waiting = makeWorker();
		const stub = installSwStub( { waiting } );
		const onShellUpdated = vi.fn();
		await registerServiceWorker( makeConfig(), { onShellUpdated } );

		stub.reply( CURRENT );
		await settle();

		expect( onShellUpdated ).not.toHaveBeenCalled();
		expect( waiting.sent( 'os-sw-skip-waiting' ) ).toBe( 1 );

		// The swap it asked for is not a takeover to investigate either.
		stub.controllerChange( waiting );
		await settle();
		expect( waiting.sent( 'os-sw-get-build' ) ).toBe( 1 );
		expect( onShellUpdated ).not.toHaveBeenCalled();
	} );

	test( 'an unknown build — no stamp, or no answer — is never a change, and swaps silently', async () => {
		const waiting = makeWorker();
		const stub = installSwStub( { waiting } );
		const onShellUpdated = vi.fn();
		await registerServiceWorker( makeConfig(), { onShellUpdated } );

		stub.reply( '' );
		await settle();
		expect( onShellUpdated ).not.toHaveBeenCalled();
		expect( waiting.sent( 'os-sw-skip-waiting' ) ).toBe( 1 );

		// A worker that never answers: the ask times out into the same.
		const silent = makeWorker();
		stub.updateFound( silent );
		silent.setState( 'installed' );
		await vi.advanceTimersByTimeAsync( 10_000 );
		expect( onShellUpdated ).not.toHaveBeenCalled();
		expect( silent.sent( 'os-sw-skip-waiting' ) ).toBe( 1 );
	} );

	test( 'a page from an older server, with no stamp of its own, swaps silently', async () => {
		const waiting = makeWorker();
		const stub = installSwStub( { waiting } );
		const onShellUpdated = vi.fn();
		await registerServiceWorker( makeConfig( null ), { onShellUpdated } );

		stub.reply( NEWER );
		await settle();

		expect( onShellUpdated ).not.toHaveBeenCalled();
		expect( waiting.sent( 'os-sw-skip-waiting' ) ).toBe( 1 );
	} );

	test( 'a worker arriving mid-session is considered once it has installed', async () => {
		const stub = installSwStub();
		const onShellUpdated = vi.fn();
		await registerServiceWorker( makeConfig(), { onShellUpdated } );

		const arriving = makeWorker( 'installing' );
		stub.updateFound( arriving );
		expect( arriving.sent( 'os-sw-get-build' ) ).toBe( 0 );

		arriving.setState( 'installed' );
		expect( arriving.sent( 'os-sw-get-build' ) ).toBe( 1 );
		stub.reply( NEWER );
		await settle();

		expect( onShellUpdated ).toHaveBeenCalledWith( { current: CURRENT, served: NEWER } );
		expect( arriving.sent( 'os-sw-skip-waiting' ) ).toBe( 0 );
	} );

	test( 'a first install is not a takeover', async () => {
		const stub = installSwStub( { controlled: false } );
		const onShellUpdated = vi.fn();
		await registerServiceWorker( makeConfig(), { onShellUpdated } );

		const first = makeWorker( 'installing' );
		stub.updateFound( first );
		first.setState( 'installed' );
		await settle();

		expect( first.sent( 'os-sw-get-build' ) ).toBe( 0 );
		expect( onShellUpdated ).not.toHaveBeenCalled();
	} );

	test( 'a swap another tab caused is compared against the new controller, and offered', async () => {
		const stub = installSwStub();
		const onShellUpdated = vi.fn();
		await registerServiceWorker( makeConfig(), { onShellUpdated } );

		const next = makeWorker( 'activated' );
		stub.controllerChange( next );
		expect( next.sent( 'os-sw-get-build' ) ).toBe( 1 );
		stub.reply( NEWER );
		await settle();

		expect( onShellUpdated ).toHaveBeenCalledTimes( 1 );
		// Nothing is waiting: taking the offer has nothing to swap and
		// settles at once, with no message sent.
		await applyPendingUpdate();
		expect( next.sent( 'os-sw-skip-waiting' ) ).toBe( 0 );
	} );

	test( 'taking the offer gives up on a swap that never comes, so the reload still happens', async () => {
		const waiting = makeWorker();
		const stub = installSwStub( { waiting } );
		await registerServiceWorker( makeConfig(), { onShellUpdated: vi.fn() } );
		stub.reply( NEWER );
		await settle();

		let swapped = false;
		const applying = applyPendingUpdate().then( () => {
			swapped = true;
		} );
		await vi.advanceTimersByTimeAsync( 2_000 );
		expect( swapped ).toBe( false );
		await vi.advanceTimersByTimeAsync( 1_500 );
		await applying;
		expect( swapped ).toBe( true );
	} );
} );

describe( 'the shell never reloads itself', () => {
	/**
	 * The rule, pinned at the source: nothing under `src/pwa/` may call
	 * `location.reload()`. The one reload the shell performs after a
	 * deploy is the user's, from the toast's action, and it lives with
	 * the session flush in `src/desktop.ts`.
	 */
	test( 'nothing under src/pwa/ calls location.reload()', () => {
		const dir = join( __dirname, '..', '..', 'src', 'pwa' );
		const offenders: string[] = [];
		const walk = ( d: string ): void => {
			for ( const name of readdirSync( d ) ) {
				const full = join( d, name );
				if ( statSync( full ).isDirectory() ) {
					walk( full );
				} else if ( /\.ts$/.test( name ) && /location\.reload\(/.test( readFileSync( full, 'utf8' ) ) ) {
					offenders.push( full );
				}
			}
		};
		walk( dir );
		expect( offenders ).toEqual( [] );
	} );

	/** And the worker never takes over uninvited. */
	test( 'the worker only skipWaiting()s on the shell\'s message', () => {
		const source = readFileSync( join( __dirname, '..', '..', 'src', 'pwa', 'sw.ts' ), 'utf8' );
		const calls = source.match( /\bsw\.skipWaiting\(\)/g ) ?? [];
		expect( calls ).toHaveLength( 1 );
		expect( source ).toMatch( /os-sw-skip-waiting[\s\S]{0,120}sw\.skipWaiting\(\)/ );
	} );
} );
