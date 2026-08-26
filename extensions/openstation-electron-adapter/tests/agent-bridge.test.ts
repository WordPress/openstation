/**
 * Reaching the desktop app from a browser tab.
 *
 * The bridge has to be indistinguishable from the preload's, because
 * `boot()` is written against one interface and must not learn which
 * side it got. And it has to fail quietly: a browser with no app
 * running is the ordinary case, not an error.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';

import { connectToAgent } from '../src/agent-bridge';
import type { AgentPairing } from '../src/types';

const PAIRING: AgentPairing = {
	url: 'http://127.0.0.1:41234',
	token: 'a'.repeat( 64 ),
	hasAgent: true,
	osLabel: 'Mac',
	platform: 'darwin',
};

/**
 * Stub `fetch` with a route table.
 *
 * @param routes Path → response body (or a thrower / status object).
 */
function stubFetch(
	routes: Record< string, unknown | ( () => unknown ) >,
): ReturnType< typeof vi.fn > {
	const impl = vi.fn( async ( input: RequestInfo | URL ) => {
		const url = String( input );
		const path = url.replace( PAIRING.url, '' ).split( '?' )[ 0 ];
		const entry = routes[ path ];
		if ( undefined === entry ) {
			return { ok: false, status: 404, json: async () => ( {} ) };
		}
		const value = 'function' === typeof entry ? entry() : entry;
		if ( value instanceof Error ) {
			throw value;
		}
		return { ok: true, status: 200, json: async () => value };
	} );
	vi.stubGlobal( 'fetch', impl );
	return impl;
}

afterEach( () => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
} );

describe( 'connecting', () => {
	test( 'returns null when nothing is paired', async () => {
		expect( await connectToAgent( undefined ) ).toBeNull();
		expect(
			await connectToAgent( { url: '', token: '', hasAgent: false } ),
		).toBeNull();
	} );

	test( 'returns null when the pairing has no token', async () => {
		expect(
			await connectToAgent( { ...PAIRING, token: undefined } ),
		).toBeNull();
	} );

	test( 'returns null when the app is not running', async () => {
		// The ordinary case: a browser, no app. Must be silent, and must
		// not throw into the shell's boot.
		stubFetch( { '/ping': () => new Error( 'ECONNREFUSED' ) } );
		expect( await connectToAgent( PAIRING ) ).toBeNull();
	} );

	test( 'returns a bridge when the agent answers', async () => {
		stubFetch( {
			'/ping': {
				ok: true,
				protocol: 1,
				platform: 'darwin',
				osLabel: 'Mac',
				appVersion: '1.0.0',
				hostId: 'abc',
				freedWindows: [],
			},
		} );

		const bridge = await connectToAgent( PAIRING );

		expect( bridge ).not.toBeNull();
		expect( bridge?.isDesktopHost ).toBe( true );
		expect( bridge?.osLabel ).toBe( 'Mac' );
		expect( bridge?.protocol ).toBe( 1 );
	} );

	test( 'sends the bearer token on the probe', async () => {
		const impl = stubFetch( { '/ping': { ok: true, freedWindows: [] } } );
		await connectToAgent( PAIRING );

		const init = impl.mock.calls[ 0 ][ 1 ] as RequestInit;
		expect( ( init.headers as Record< string, string > ).Authorization ).toBe(
			`Bearer ${ PAIRING.token }`,
		);
	} );
} );

describe( 'the bridge surface', () => {
	/** @return A connected bridge over a stubbed agent. */
	async function connected( freedWindows: string[] = [] ) {
		const state = { freed: [ ...freedWindows ] };
		const impl = stubFetch( {
			'/ping': () => ( { ok: true, protocol: 1, freedWindows: state.freed } ),
			'/windows': () => ( { windowIds: state.freed } ),
			'/free': () => ( { ok: true, windowId: 'edit-php', reused: false } ),
			'/dock': () => ( { ok: true } ),
			'/focus': () => ( { ok: true } ),
		} );
		const bridge = await connectToAgent( PAIRING );
		return { bridge: bridge!, impl, state };
	}

	test( 'freeWindow posts the request', async () => {
		const { bridge, impl } = await connected();

		const result = await bridge.freeWindow( {
			windowId: 'edit-php',
			url: 'https://example.test/wp-admin/edit.php',
		} );

		expect( result.ok ).toBe( true );
		const call = impl.mock.calls.find( ( c ) => String( c[ 0 ] ).endsWith( '/free' ) );
		expect( ( call![ 1 ] as RequestInit ).method ).toBe( 'POST' );
		expect( JSON.parse( String( ( call![ 1 ] as RequestInit ).body ) ) ).toMatchObject( {
			windowId: 'edit-php',
		} );
	} );

	test( 'dockWindow and focusWindow round-trip', async () => {
		const { bridge } = await connected();
		expect( await bridge.dockWindow( 'edit-php' ) ).toEqual( { ok: true } );
		expect( await bridge.focusWindow( 'edit-php' ) ).toEqual( { ok: true } );
	} );

	test( 'getInfo reports what is currently freed', async () => {
		const { bridge } = await connected( [ 'edit-php' ] );
		const info = await bridge.getInfo();
		expect( info.freedWindows ).toEqual( [ 'edit-php' ] );
	} );

	test( 'the server-connection methods are inert', async () => {
		// The app owns its own connection to WordPress. A browser tab
		// speaking for it would be a tab speaking for a process it does
		// not own.
		const { bridge } = await connected();
		expect( ( await bridge.handshake( { restUrl: 'x', nonce: 'y' } ) ).state ).toBe( 'idle' );
		expect( ( await bridge.getConnection() ).state ).toBe( 'idle' );
		expect( await bridge.disconnect() ).toEqual( { ok: false } );
	} );

	test( 'unsubscribing a listener stops it firing', async () => {
		const { bridge } = await connected();
		const cb = vi.fn();
		const off = bridge.onWindowDocked( cb );
		off();
		// Nothing to assert beyond "no throw and no call" — the polling
		// path is covered below.
		expect( cb ).not.toHaveBeenCalled();
	} );
} );

describe( 'the synthesised push channel', () => {
	test( 'reports a window the user closed on the desktop', async () => {
		vi.useFakeTimers();
		const state = { freed: [ 'edit-php' ] };
		stubFetch( {
			'/ping': () => ( { ok: true, protocol: 1, freedWindows: state.freed } ),
			'/windows': () => ( { windowIds: state.freed } ),
		} );

		const bridge = ( await connectToAgent( PAIRING ) )!;
		const docked = vi.fn();
		bridge.onWindowDocked( docked );

		// The user closes the native window.
		state.freed = [];
		await vi.advanceTimersByTimeAsync( 2500 );

		expect( docked ).toHaveBeenCalledWith( { windowId: 'edit-php' } );
	} );

	test( 'treats the app going away as everything docking back', async () => {
		// Otherwise the shell keeps windows minimized and marked as
		// freed, pointing at a process that no longer exists.
		vi.useFakeTimers();
		let alive = true;
		stubFetch( {
			'/ping': () => ( { ok: true, protocol: 1, freedWindows: [ 'edit-php' ] } ),
			'/windows': () => {
				if ( ! alive ) {
					return new Error( 'ECONNREFUSED' );
				}
				return { windowIds: [ 'edit-php' ] };
			},
		} );

		const bridge = ( await connectToAgent( PAIRING ) )!;
		const docked = vi.fn();
		bridge.onWindowDocked( docked );

		alive = false;
		await vi.advanceTimersByTimeAsync( 2500 );

		expect( docked ).toHaveBeenCalledWith( { windowId: 'edit-php' } );
	} );

	test( 'does not poll when nothing is out on the desktop', async () => {
		vi.useFakeTimers();
		const impl = stubFetch( {
			'/ping': { ok: true, protocol: 1, freedWindows: [] },
			'/windows': { windowIds: [] },
		} );

		await connectToAgent( PAIRING );
		const afterConnect = impl.mock.calls.length;
		await vi.advanceTimersByTimeAsync( 10000 );

		// An idle browser tab must not sit there making requests.
		expect( impl.mock.calls.length ).toBe( afterConnect );
	} );
} );
