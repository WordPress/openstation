/**
 * The connection state machine.
 *
 * The interesting behaviour here is timing, and timing that can only be
 * observed by waiting two minutes is timing nobody tests — which is why
 * `Connection` takes its transport, its timer and its clock through the
 * constructor. Every test below drives those directly.
 */

import { describe, expect, test, vi } from 'vitest';

import { Connection } from '../app/src/lib/connection';
import type { ConnectionState } from '../app/src/lib/protocol';

/** A fetch double with a scripted queue of responses. */
function fakeFetch(
	responses: Array< { status?: number; body?: Record< string, unknown > } >,
) {
	const calls: Array< { url: string; body: unknown } > = [];
	let i = 0;
	const fetch = vi.fn( async ( url: string, init: { body: string } ) => {
		calls.push( { url, body: JSON.parse( init.body ) } );
		const next = responses[ Math.min( i, responses.length - 1 ) ];
		i += 1;
		const status = next?.status ?? 200;
		return {
			ok: status >= 200 && status < 300,
			status,
			json: async () => next?.body ?? {},
		};
	} );
	return { fetch, calls };
}

/**
 * Build a Connection with a controllable timer.
 *
 * @param responses Scripted transport replies.
 * @param site      The paired site. Every `restUrl` below lives on
 *                  `https://example.test`, so this is what makes an
 *                  ordinary handshake pass its origin check.
 */
function harness(
	responses: Array< { status?: number; body?: Record< string, unknown > } >,
	site = 'https://example.test',
) {
	const { fetch, calls } = fakeFetch( responses );
	const states: ConnectionState[] = [];
	let pending: ( () => void ) | null = null;
	let lastDelay = 0;

	const connection = new Connection( {
		fetch: fetch as never,
		namespace: 'openstation-electron/v1',
		siteUrl: () => site,
		hostId: () => 'host-123',
		describe: () => ( { platform: 'darwin', appVersion: '1.0.0' } ),
		onChange: ( state ) => states.push( { ...state } ),
		setTimer: ( fn, ms ) => {
			pending = fn;
			lastDelay = ms;
			return 1;
		},
		clearTimer: () => {
			pending = null;
		},
		now: () => 1_700_000_000_000,
	} );

	return {
		connection,
		states,
		calls,
		fetch,
		delay: () => lastDelay,
		/** Fire the scheduled beat. */
		tick: async () => {
			const fn = pending;
			pending = null;
			fn?.();
			// Let the beat's promise chain settle.
			await Promise.resolve();
			await Promise.resolve();
			await Promise.resolve();
		},
	};
}

describe( 'handshake', () => {
	test( 'registers, adopts the server’s interval, and schedules a beat', async () => {
		const h = harness( [ { body: { heartbeatInterval: 300000, user: 'admin' } } ] );

		await h.connection.handshake( {
			restUrl: 'https://example.test/wp-json/',
			nonce: 'abc',
		} );

		expect( h.calls[ 0 ]?.url ).toBe(
			'https://example.test/wp-json/openstation-electron/v1/host/handshake',
		);
		expect( h.calls[ 0 ]?.body ).toMatchObject( {
			hostId: 'host-123',
			platform: 'darwin',
		} );
		expect( h.connection.getState().state ).toBe( 'connected' );
		expect( h.connection.getState().interval ).toBe( 300000 );
		expect( h.delay() ).toBe( 300000 );
	} );

	test( 'refuses to beat without REST coordinates', async () => {
		const h = harness( [ {} ] );

		await h.connection.handshake( { restUrl: '', nonce: '' } );

		expect( h.fetch ).not.toHaveBeenCalled();
		expect( h.connection.getState().state ).toBe( 'error' );
	} );

	test( 'floors an interval the server set below the minimum', async () => {
		const h = harness( [ { body: { heartbeatInterval: 1000 } } ] );
		await h.connection.handshake( {
			restUrl: 'https://example.test/wp-json/',
			nonce: 'abc',
		} );
		expect( h.connection.getState().interval ).toBe( 30000 );
	} );

	// The handshake body carries `describe()`, and `describe()` carries
	// the local agent's bearer token. `restUrl` decides where that goes
	// and arrives from a renderer, so it is checked against the paired
	// site — the same rule freed-window URLs and navigations are held to.
	describe( 'the REST root must be on the paired site', () => {
		test.each( [
			[ 'a different host', 'https://attacker.example/wp-json' ],
			[ 'a lookalike suffix', 'https://example.test.attacker.example/wp-json' ],
			[ 'a userinfo-prefixed host', 'https://example.test@attacker.example/wp-json' ],
			[ 'a downgraded scheme', 'http://example.test/wp-json' ],
			[ 'a non-http scheme', 'file:///etc/passwd' ],
		] )( 'refuses %s', async ( _label, restUrl ) => {
			const h = harness( [ {} ] );

			await h.connection.handshake( { restUrl, nonce: 'abc' } );

			// Nothing was sent at all — the check runs before the token
			// is even read out of `describe()`.
			expect( h.fetch ).not.toHaveBeenCalled();
			expect( h.connection.getState().state ).toBe( 'error' );
		} );

		test( 'a refused handshake does not keep an earlier one alive', async () => {
			const h = harness( [ { body: { heartbeatInterval: 120000 } } ] );
			await h.connection.handshake( {
				restUrl: 'https://example.test/wp-json/',
				nonce: 'abc',
			} );
			expect( h.connection.getState().state ).toBe( 'connected' );

			await h.connection.handshake( {
				restUrl: 'https://attacker.example/wp-json',
				nonce: 'abc',
			} );

			// One call, from the good handshake. The beat that the good
			// handshake scheduled must not fire against the old root
			// either: a page that navigated somewhere else does not get
			// to keep the heartbeat it inherited.
			expect( h.fetch ).toHaveBeenCalledTimes( 1 );
			await h.tick();
			expect( h.fetch ).toHaveBeenCalledTimes( 1 );
		} );

		test( 'the port is part of the identity, matching or not', async () => {
			const ok = harness( [ { body: {} } ], 'https://example.test:8443' );
			await ok.connection.handshake( {
				restUrl: 'https://example.test:8443/wp-json',
				nonce: 'abc',
			} );
			expect( ok.connection.getState().state ).toBe( 'connected' );

			const wrong = harness( [ { body: {} } ], 'https://example.test:8443' );
			await wrong.connection.handshake( {
				restUrl: 'https://example.test:9999/wp-json',
				nonce: 'abc',
			} );
			expect( wrong.fetch ).not.toHaveBeenCalled();
		} );
	} );
} );

describe( 'heartbeat', () => {
	test( 'beats on schedule and stays connected', async () => {
		const h = harness( [
			{ body: { heartbeatInterval: 120000 } },
			{ body: { heartbeatInterval: 120000 } },
		] );
		await h.connection.handshake( {
			restUrl: 'https://example.test/wp-json/',
			nonce: 'abc',
		} );

		await h.tick();

		expect( h.calls[ 1 ]?.url ).toContain( '/host/heartbeat' );
		expect( h.connection.getState().state ).toBe( 'connected' );
	} );

	test( 'skips beats while idle, then beats anyway', async () => {
		const h = harness( [ { body: { heartbeatInterval: 120000 } } ] );
		await h.connection.handshake( {
			restUrl: 'https://example.test/wp-json/',
			nonce: 'abc',
		} );
		const afterHandshake = h.calls.length;

		// First beat consumes the "was active" flag set at construction.
		await h.tick();
		expect( h.calls.length ).toBe( afterHandshake + 1 );

		// Now genuinely idle: three skipped ticks, then one real beat.
		await h.tick();
		await h.tick();
		await h.tick();
		expect( h.calls.length ).toBe( afterHandshake + 1 );

		await h.tick();
		expect( h.calls.length ).toBe( afterHandshake + 2 );
	} );

	test( 'does not skip while a window is freed onto the desktop', async () => {
		const h = harness( [ { body: { heartbeatInterval: 120000 } } ] );
		await h.connection.handshake( {
			restUrl: 'https://example.test/wp-json/',
			nonce: 'abc',
		} );
		await h.tick();
		const before = h.calls.length;

		h.connection.setHasFreedWindows( true );
		await h.tick();
		await h.tick();

		expect( h.calls.length ).toBe( before + 2 );
	} );

	test( 'user activity cancels the idle throttle', async () => {
		const h = harness( [ { body: { heartbeatInterval: 120000 } } ] );
		await h.connection.handshake( {
			restUrl: 'https://example.test/wp-json/',
			nonce: 'abc',
		} );
		await h.tick();
		const before = h.calls.length;

		h.connection.markActive();
		await h.tick();

		expect( h.calls.length ).toBe( before + 1 );
	} );
} );

describe( 'failure handling', () => {
	test( 'an auth failure asks for a fresh nonce rather than erroring', async () => {
		// A nonce goes stale roughly every half-day and the shell owns
		// the refresh path, so this is a request, not a fault.
		const h = harness( [ { status: 403 } ] );

		await h.connection.handshake( {
			restUrl: 'https://example.test/wp-json/',
			nonce: 'stale',
		} );

		expect( h.connection.getState().state ).toBe( 'nonce-stale' );
	} );

	test( 'a server error backs off geometrically', async () => {
		const h = harness( [ { status: 500 } ] );

		await h.connection.handshake( {
			restUrl: 'https://example.test/wp-json/',
			nonce: 'abc',
		} );
		expect( h.connection.getState().state ).toBe( 'error' );
		const first = h.delay();

		await h.tick();
		expect( h.delay() ).toBeGreaterThan( first );
	} );

	test( 'recovers to the plain interval once a beat succeeds', async () => {
		const h = harness( [
			{ status: 500 },
			{ body: { heartbeatInterval: 120000 } },
		] );
		await h.connection.handshake( {
			restUrl: 'https://example.test/wp-json/',
			nonce: 'abc',
		} );

		await h.tick();

		expect( h.connection.getState().state ).toBe( 'connected' );
		expect( h.delay() ).toBe( 120000 );
	} );
} );

describe( 'lifecycle', () => {
	test( 'resume beats immediately rather than waiting out the interval', async () => {
		const h = harness( [ { body: { heartbeatInterval: 120000 } } ] );
		await h.connection.handshake( {
			restUrl: 'https://example.test/wp-json/',
			nonce: 'abc',
		} );
		const before = h.calls.length;

		h.connection.resume();
		await Promise.resolve();
		await Promise.resolve();

		expect( h.calls.length ).toBe( before + 1 );
	} );

	test( 'farewell tells the server and goes idle', async () => {
		const h = harness( [ { body: {} } ] );
		await h.connection.handshake( {
			restUrl: 'https://example.test/wp-json/',
			nonce: 'abc',
		} );

		await h.connection.farewell();

		expect( h.calls[ h.calls.length - 1 ]?.url ).toContain( '/host/disconnect' );
		expect( h.connection.getState().state ).toBe( 'idle' );
	} );

	test( 'a farewell that fails still goes idle — quitting must not hang', async () => {
		const h = harness( [
			{ body: { heartbeatInterval: 120000 } },
			{ status: 500 },
		] );
		await h.connection.handshake( {
			restUrl: 'https://example.test/wp-json/',
			nonce: 'abc',
		} );

		await h.connection.farewell();

		expect( h.connection.getState().state ).toBe( 'idle' );
	} );
} );
