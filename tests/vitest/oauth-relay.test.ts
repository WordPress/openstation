/**
 * `wp.os.startOAuth` tests — pin the contract on the popup
 * orchestration: `/oauth/start` POST, popup open, postMessage
 * resolution, popup-closed-without-callback rejection, origin
 * validation.
 */
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
	vi,
} from 'vitest';
import { startOAuth } from '../../src/oauth-relay';

interface FakePopup {
	closed: boolean;
	postOrigin: string;
}

describe( 'startOAuth', () => {
	let originalFetch: typeof window.fetch;
	let originalOpen: typeof window.open;
	let popups: FakePopup[];

	beforeEach( () => {
		( window as unknown as { wp: { os?: unknown } } ).wp = {};
		( window as unknown as { openStationConfig?: unknown } ).openStationConfig = {
			restRoot: 'https://example.test/wp-json/',
			restNonce: 'fake-nonce',
		};
		originalFetch = window.fetch;
		originalOpen = window.open;
		popups = [];
		window.open = vi.fn(
			( _url?: string | URL, _target?: string ) => {
				const popup: FakePopup = { closed: false, postOrigin: window.location.origin };
				popups.push( popup );
				return popup as unknown as Window;
			},
		) as unknown as typeof window.open;
	} );

	afterEach( () => {
		window.fetch = originalFetch;
		window.open = originalOpen;
		delete ( window as unknown as { openStationConfig?: unknown } ).openStationConfig;
		( window as unknown as { wp?: unknown } ).wp = undefined;
	} );

	function stubFetch( body: unknown, ok = true ): void {
		// eslint-disable-next-line no-restricted-syntax -- test stub
		window.fetch = vi.fn( async () => {
			return new Response( JSON.stringify( body ), {
				status: ok ? 200 : 500,
				headers: { 'Content-Type': 'application/json' },
			} );
		} ) as typeof window.fetch;
	}

	test( 'rejects synchronously when service is empty', async () => {
		await expect( startOAuth( '' ) ).rejects.toThrow( /non-empty service slug/ );
	} );

	test( 'POSTs to /oauth/start with the service body and X-WP-Nonce header', async () => {
		stubFetch( {
			authorize_url: 'https://provider.example/oauth/authorize?client_id=cid&state=ST',
			state: 'ST',
		} );
		const promise = startOAuth( 'tumblrlike' );

		// Drain the start fetch + open the popup. Use a macrotask
		// boundary because trackedFetch awaits the Response then
		// awaits res.json() (one microtask each, plus Promise
		// chaining), so two microtasks isn't always enough.
		await new Promise( ( r ) => setTimeout( r, 0 ) );

		const fetchMock = window.fetch as unknown as ReturnType< typeof vi.fn >;
		expect( fetchMock ).toHaveBeenCalledTimes( 1 );
		const [ url, init ] = fetchMock.mock.calls[ 0 ] as [ string, RequestInit ];
		expect( url ).toBe( 'https://example.test/wp-json/desktop-mode/v1/oauth/start' );
		expect( init.method ).toBe( 'POST' );
		expect( ( init.headers as Record< string, string > )[ 'X-WP-Nonce' ] ).toBe(
			'fake-nonce',
		);
		expect( init.body ).toBe( JSON.stringify( { service: 'tumblrlike' } ) );

		// Resolve the flow so the test cleans up.
		window.dispatchEvent(
			new MessageEvent( 'message', {
				origin: window.location.origin,
				data: {
					type: 'os-oauth-callback',
					payload: { ok: true, service: 'tumblrlike' },
				},
			} ),
		);
		const result = await promise;
		expect( result.ok ).toBe( true );
	} );

	test( 'resolves with the success payload on a clean callback', async () => {
		stubFetch( {
			authorize_url: 'https://provider.example/oauth/authorize?state=ST',
			state: 'ST',
		} );
		const promise = startOAuth( 'tumblrlike' );
		await new Promise( ( r ) => setTimeout( r, 0 ) );

		window.dispatchEvent(
			new MessageEvent( 'message', {
				origin: window.location.origin,
				data: {
					type: 'os-oauth-callback',
					payload: { ok: true, service: 'tumblrlike' },
				},
			} ),
		);

		const result = await promise;
		expect( result ).toEqual( { ok: true, service: 'tumblrlike' } );
	} );

	test( 'rejects with cause when payload.ok is false', async () => {
		stubFetch( {
			authorize_url: 'https://provider.example/oauth/authorize?state=ST',
			state: 'ST',
		} );
		const promise = startOAuth( 'tumblrlike' );
		await new Promise( ( r ) => setTimeout( r, 0 ) );

		const failurePayload = {
			ok: false,
			service: 'tumblrlike',
			reason: 'token_exchange_failed',
			message: 'HTTP 401',
		};
		window.dispatchEvent(
			new MessageEvent( 'message', {
				origin: window.location.origin,
				data: {
					type: 'os-oauth-callback',
					payload: failurePayload,
				},
			} ),
		);

		await expect( promise ).rejects.toMatchObject( {
			message: expect.stringContaining( 'token_exchange_failed' ),
			cause: failurePayload,
		} );
	} );

	test( 'ignores postMessage events from the wrong origin', async () => {
		stubFetch( {
			authorize_url: 'https://provider.example/oauth/authorize?state=ST',
			state: 'ST',
		} );
		const promise = startOAuth( 'tumblrlike' );
		await new Promise( ( r ) => setTimeout( r, 0 ) );

		// Cross-origin attempt — must NOT resolve.
		window.dispatchEvent(
			new MessageEvent( 'message', {
				origin: 'https://attacker.example',
				data: {
					type: 'os-oauth-callback',
					payload: { ok: true },
				},
			} ),
		);
		// Then a legitimate same-origin success message.
		window.dispatchEvent(
			new MessageEvent( 'message', {
				origin: window.location.origin,
				data: {
					type: 'os-oauth-callback',
					payload: { ok: true, service: 'tumblrlike' },
				},
			} ),
		);
		await expect( promise ).resolves.toMatchObject( { ok: true, service: 'tumblrlike' } );
	} );

	test( 'ignores postMessage events of the wrong type', async () => {
		stubFetch( {
			authorize_url: 'https://provider.example/oauth/authorize?state=ST',
			state: 'ST',
		} );
		const promise = startOAuth( 'tumblrlike' );
		await new Promise( ( r ) => setTimeout( r, 0 ) );

		// Wrong type — must NOT resolve.
		window.dispatchEvent(
			new MessageEvent( 'message', {
				origin: window.location.origin,
				data: { type: 'random-other-postmessage', payload: { ok: true } },
			} ),
		);
		window.dispatchEvent(
			new MessageEvent( 'message', {
				origin: window.location.origin,
				data: {
					type: 'os-oauth-callback',
					payload: { ok: true, service: 'tumblrlike' },
				},
			} ),
		);
		await expect( promise ).resolves.toMatchObject( { ok: true } );
	} );

	test( 'rejects with popup-blocked when window.open returns null', async () => {
		stubFetch( {
			authorize_url: 'https://provider.example/oauth/authorize?state=ST',
			state: 'ST',
		} );
		window.open = vi.fn( () => null ) as unknown as typeof window.open;
		await expect( startOAuth( 'tumblrlike' ) ).rejects.toThrow( /popup blocked/i );
	} );

	test( 'rejects when the start endpoint returns a non-2xx response', async () => {
		stubFetch( { error: 'unknown_service' }, false );
		await expect( startOAuth( 'tumblrlike' ) ).rejects.toThrow( /OAuth start failed/ );
	} );
} );
