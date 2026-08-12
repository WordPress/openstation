/**
 * Unit tests for the "OpenStation stopped being active" watcher.
 *
 * The whole point of the module is that triggers may be wrong and the
 * confirmation is what decides, so most of these assert the NEGATIVE:
 * a healthy page, a front-end page, a cross-origin frame, a bare 404
 * and a network error must all leave the shell alone.
 *
 * `fetch` is stubbed on the global rather than mocking the
 * `tracked-fetch` module, so the real helper (and its `wp.os.fetch`
 * lookup) stays in the path — same approach as
 * `agents-dispatch.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	noteFrameLoaded,
	bootPluginPresenceWatch,
	_resetPluginPresenceForTests,
} from '../../src/plugin-presence';

const ADMIN_URL = 'http://localhost/wp-admin/';
const REST_URL = 'http://localhost/wp-json/';
const NAMESPACE_URL = 'http://localhost/wp-json/desktop-mode/v1';

let fetchMock: ReturnType< typeof vi.fn >;
let assign: ReturnType< typeof vi.fn >;

/** The body WordPress returns for an unregistered namespace. */
function goneResponse(): unknown {
	return {
		status: 404,
		json: () => Promise.resolve( { code: 'rest_no_route' } ),
	};
}

function aliveResponse(): unknown {
	return { status: 200, json: () => Promise.resolve( {} ) };
}

/** Stand-in for an iframe whose document we control. */
function frameWith( options: {
	pathname: string;
	chromeless: boolean;
} ): HTMLIFrameElement {
	const body = document.createElement( 'body' );
	if ( options.chromeless ) {
		body.classList.add( 'os-chromeless' );
	}
	// A plain stand-in rather than a real Document: jsdom's
	// `document.location` is non-configurable, so it can't be pointed
	// at an arbitrary path.
	const doc = { body, location: { pathname: options.pathname } };
	return { contentDocument: doc } as unknown as HTMLIFrameElement;
}

/** An iframe that throws on `contentDocument`, like a cross-origin one. */
function crossOriginFrame(): HTMLIFrameElement {
	return {
		get contentDocument(): Document {
			throw new Error( 'cross-origin' );
		},
	} as unknown as HTMLIFrameElement;
}

function adminFrame(): HTMLIFrameElement {
	return frameWith( {
		pathname: '/wp-admin/plugins.php',
		chromeless: false,
	} );
}

/** Install a jQuery stub and return the registered `heartbeat-tick` handler. */
function bootWithHeartbeat(): ( ...args: unknown[] ) => void {
	let handler: ( ( ...args: unknown[] ) => void ) | null = null;
	( window as unknown as { jQuery?: unknown } ).jQuery = () => ( {
		on: ( event: string, cb: ( ...args: unknown[] ) => void ) => {
			if ( event === 'heartbeat-tick' ) {
				handler = cb;
			}
		},
	} );
	bootPluginPresenceWatch();
	if ( ! handler ) {
		throw new Error( 'heartbeat-tick handler was never registered' );
	}
	return handler;
}

describe( 'plugin-presence', () => {
	beforeEach( () => {
		_resetPluginPresenceForTests();
		fetchMock = vi.fn().mockResolvedValue( aliveResponse() );
		( globalThis as unknown as { fetch: unknown } ).fetch = fetchMock;
		assign = vi.fn();
		Object.defineProperty( window, 'top', {
			value: { location: { assign } },
			configurable: true,
			writable: true,
		} );
		( window as unknown as { wp?: unknown } ).wp = {
			os: { config: { adminUrl: ADMIN_URL, restUrl: REST_URL } },
		};
	} );

	afterEach( () => {
		vi.useRealTimers();
		delete ( window as unknown as { wp?: unknown } ).wp;
		delete ( window as unknown as { jQuery?: unknown } ).jQuery;
	} );

	test( 'a chromeless admin page pings nothing', () => {
		noteFrameLoaded(
			frameWith( { pathname: '/wp-admin/plugins.php', chromeless: true } ),
		);
		expect( fetchMock ).not.toHaveBeenCalled();
	} );

	test( 'a front-end page without the marker pings nothing', () => {
		noteFrameLoaded(
			frameWith( { pathname: '/2026/08/hello-world/', chromeless: false } ),
		);
		expect( fetchMock ).not.toHaveBeenCalled();
	} );

	test( 'a cross-origin frame pings nothing', () => {
		noteFrameLoaded( crossOriginFrame() );
		expect( fetchMock ).not.toHaveBeenCalled();
	} );

	test( 'an admin page missing the marker pings the namespace', () => {
		noteFrameLoaded( adminFrame() );
		expect( fetchMock ).toHaveBeenCalledTimes( 1 );
		expect( fetchMock.mock.calls[ 0 ][ 0 ] ).toBe( NAMESPACE_URL );
	} );

	test( 'no REST root in config means no ping at all', () => {
		( window as unknown as { wp?: unknown } ).wp = {
			os: { config: { adminUrl: ADMIN_URL } },
		};
		noteFrameLoaded( adminFrame() );
		expect( fetchMock ).not.toHaveBeenCalled();
	} );

	test( 'a 200 from the namespace leaves the shell alone', async () => {
		noteFrameLoaded( adminFrame() );
		await vi.waitFor( () => expect( fetchMock ).toHaveBeenCalled() );
		await Promise.resolve();
		expect( assign ).not.toHaveBeenCalled();
	} );

	test( 'a 404 without rest_no_route leaves the shell alone', async () => {
		// A hardening plugin or a firewall rule on /wp-json.
		fetchMock.mockResolvedValue( {
			status: 404,
			json: () => Promise.resolve( { code: 'rest_forbidden' } ),
		} );
		vi.useFakeTimers();
		noteFrameLoaded( adminFrame() );
		await vi.runAllTimersAsync();
		expect( assign ).not.toHaveBeenCalled();
	} );

	test( 'a 404 with a non-JSON body leaves the shell alone', async () => {
		fetchMock.mockResolvedValue( {
			status: 404,
			json: () => Promise.reject( new Error( 'not json' ) ),
		} );
		vi.useFakeTimers();
		noteFrameLoaded( adminFrame() );
		await vi.runAllTimersAsync();
		expect( assign ).not.toHaveBeenCalled();
	} );

	test( 'rest_no_route navigates the top frame to the dashboard', async () => {
		// Fake timers so the read-the-toast delay before the
		// navigation doesn't have to be waited out for real.
		vi.useFakeTimers();
		fetchMock.mockResolvedValue( goneResponse() );
		noteFrameLoaded( adminFrame() );
		await vi.runAllTimersAsync();
		expect( assign ).toHaveBeenCalledWith( ADMIN_URL );
	} );

	test( 'a second trigger after an exit cannot queue a second navigation', async () => {
		vi.useFakeTimers();
		fetchMock.mockResolvedValue( goneResponse() );
		noteFrameLoaded( adminFrame() );
		await vi.runAllTimersAsync();
		expect( assign ).toHaveBeenCalledTimes( 1 );

		noteFrameLoaded( adminFrame() );
		bootWithHeartbeat()( {}, { 'wp-auth-check': true } );
		await vi.runAllTimersAsync();
		expect( assign ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'a network error leaves the shell alone', async () => {
		fetchMock.mockRejectedValue( new Error( 'offline' ) );
		noteFrameLoaded( adminFrame() );
		await vi.waitFor( () => expect( fetchMock ).toHaveBeenCalled() );
		await Promise.resolve();
		expect( assign ).not.toHaveBeenCalled();
	} );

	test( 'repeat triggers inside the cooldown are throttled to one ping', async () => {
		noteFrameLoaded( adminFrame() );
		await vi.waitFor( () => expect( fetchMock ).toHaveBeenCalled() );
		noteFrameLoaded( adminFrame() );
		noteFrameLoaded( adminFrame() );
		expect( fetchMock ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'a trigger after the cooldown expires pings again', async () => {
		vi.useFakeTimers();
		noteFrameLoaded( adminFrame() );
		await vi.runAllTimersAsync();
		expect( fetchMock ).toHaveBeenCalledTimes( 1 );

		await vi.advanceTimersByTimeAsync( 31_000 );
		noteFrameLoaded( adminFrame() );
		await vi.runAllTimersAsync();
		expect( fetchMock ).toHaveBeenCalledTimes( 2 );
	} );

	test( 'the watcher gives up after repeated "still here" answers', async () => {
		vi.useFakeTimers();
		for ( let i = 0; i < 5; i++ ) {
			noteFrameLoaded( adminFrame() );
			await vi.runAllTimersAsync();
			await vi.advanceTimersByTimeAsync( 31_000 );
		}
		expect( fetchMock ).toHaveBeenCalledTimes( 3 );
	} );

	test( 'proof the plugin is alive resets the give-up counter', async () => {
		vi.useFakeTimers();
		for ( let i = 0; i < 5; i++ ) {
			noteFrameLoaded( adminFrame() );
			await vi.runAllTimersAsync();
			await vi.advanceTimersByTimeAsync( 31_000 );
			// A healthy chromeless page in between.
			noteFrameLoaded(
				frameWith( {
					pathname: '/wp-admin/index.php',
					chromeless: true,
				} ),
			);
		}
		expect( fetchMock ).toHaveBeenCalledTimes( 5 );
	} );

	test( 'a heartbeat tick without the nonce field pings the namespace', () => {
		const tick = bootWithHeartbeat();

		tick( {}, { desktop_mode_nonces: { wp_rest: 'abc' } } );
		expect( fetchMock ).not.toHaveBeenCalled();

		tick( {}, { 'wp-auth-check': true } );
		expect( fetchMock ).toHaveBeenCalledTimes( 1 );
	} );
} );
