/**
 * Unit tests for the "OpenStation stopped being active" watcher.
 *
 * The whole point of the module is that triggers may be wrong and the
 * confirmation ping is what decides, so most of these assert the
 * NEGATIVE: a healthy page, a front-end page, a cross-origin frame and
 * a network error must all leave the shell alone.
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

let fetchMock: ReturnType< typeof vi.fn >;
let assign: ReturnType< typeof vi.fn >;

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

describe( 'plugin-presence', () => {
	beforeEach( () => {
		_resetPluginPresenceForTests();
		fetchMock = vi.fn().mockResolvedValue( { status: 200 } );
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
		noteFrameLoaded(
			frameWith( { pathname: '/wp-admin/plugins.php', chromeless: false } ),
		);
		expect( fetchMock ).toHaveBeenCalledTimes( 1 );
		expect( fetchMock.mock.calls[ 0 ][ 0 ] ).toBe(
			'http://localhost/wp-json/desktop-mode/v1',
		);
	} );

	test( 'a 200 from the namespace leaves the shell alone', async () => {
		noteFrameLoaded(
			frameWith( { pathname: '/wp-admin/plugins.php', chromeless: false } ),
		);
		await vi.waitFor( () => expect( fetchMock ).toHaveBeenCalled() );
		await Promise.resolve();
		expect( assign ).not.toHaveBeenCalled();
	} );

	test( 'a 404 navigates the top frame to the dashboard', async () => {
		// Fake timers so the read-the-toast delay before the
		// navigation doesn't have to be waited out for real.
		vi.useFakeTimers();
		fetchMock.mockResolvedValue( { status: 404 } );
		noteFrameLoaded(
			frameWith( { pathname: '/wp-admin/plugins.php', chromeless: false } ),
		);
		await vi.runAllTimersAsync();
		expect( assign ).toHaveBeenCalledWith( ADMIN_URL );
	} );

	test( 'a network error leaves the shell alone', async () => {
		fetchMock.mockRejectedValue( new Error( 'offline' ) );
		noteFrameLoaded(
			frameWith( { pathname: '/wp-admin/plugins.php', chromeless: false } ),
		);
		await vi.waitFor( () => expect( fetchMock ).toHaveBeenCalled() );
		await Promise.resolve();
		expect( assign ).not.toHaveBeenCalled();
	} );

	test( 'repeat triggers are throttled to one ping', async () => {
		const frame = frameWith( {
			pathname: '/wp-admin/plugins.php',
			chromeless: false,
		} );
		noteFrameLoaded( frame );
		await vi.waitFor( () => expect( fetchMock ).toHaveBeenCalled() );
		noteFrameLoaded( frame );
		noteFrameLoaded( frame );
		expect( fetchMock ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'a heartbeat tick without the nonce field pings the namespace', () => {
		let tick: ( ( ...args: unknown[] ) => void ) | null = null;
		( window as unknown as { jQuery?: unknown } ).jQuery = () => ( {
			on: ( event: string, handler: ( ...args: unknown[] ) => void ) => {
				if ( event === 'heartbeat-tick' ) {
					tick = handler;
				}
			},
		} );
		bootPluginPresenceWatch();

		const fire = tick as unknown as ( ...args: unknown[] ) => void;
		fire( {}, { desktop_mode_nonces: { wp_rest: 'abc' } } );
		expect( fetchMock ).not.toHaveBeenCalled();

		fire( {}, { 'wp-auth-check': true } );
		expect( fetchMock ).toHaveBeenCalledTimes( 1 );
	} );
} );
