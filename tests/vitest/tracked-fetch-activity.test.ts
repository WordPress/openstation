/**
 * Tests for how `wp.os.fetch` reports outcomes on the window
 * activity indicator.
 *
 * The bug these pin: `fetch()` resolves normally for HTTP errors, so
 * tracking the raw promise settled the indicator as `saved` — a green
 * check in the title bar, and a "Saved" announcement to screen
 * readers — for a request the server had refused with a 500. The
 * indicator has to settle on the *response*, while the promise handed
 * back to the caller keeps native fetch semantics.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { trackedFetch } from '../../src/boot/tracked-fetch';
import type { WindowManager } from '../../src/window-manager';
import type { Window as DesktopWindow } from '../../src/window';

interface Settlement {
	ok: boolean;
	error?: string;
}

/**
 * A stand-in for the tracked window. `trackActivity` mirrors the real
 * one: resolve → success, reject → failure with the error message,
 * promise re-thrown either way.
 */
function makeTarget() {
	const settled: Settlement[] = [];
	const target = {
		trackActivity< T >( promise: Promise< T > ): Promise< T > {
			return promise.then(
				( value ) => {
					settled.push( { ok: true } );
					return value;
				},
				( err: unknown ) => {
					settled.push( {
						ok: false,
						error: err instanceof Error ? err.message : String( err ),
					} );
					throw err;
				},
			);
		},
	};
	const manager = {
		getById: () => null,
		getFocused: () => target as unknown as DesktopWindow,
	} as unknown as WindowManager;
	return { manager, settled };
}

function response( status: number, statusText: string ): Response {
	return {
		ok: status >= 200 && status < 300,
		status,
		statusText,
	} as Response;
}

/** Let the tracked `.then` chain run before asserting. */
async function flush(): Promise< void > {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
}

describe( 'trackedFetch — activity outcome', () => {
	beforeEach( () => {
		vi.restoreAllMocks();
	} );

	test( 'an HTTP 500 settles the indicator as failed', async () => {
		const { manager, settled } = makeTarget();
		vi.spyOn( window, 'fetch' ).mockResolvedValue(
			response( 500, 'Internal Server Error' ),
		);

		await trackedFetch( manager, '/wp-json/desktop-mode/v1/thing' );
		await flush();

		expect( settled ).toHaveLength( 1 );
		expect( settled[ 0 ].ok ).toBe( false );
		expect( settled[ 0 ].error ).toContain( '500' );
		expect( settled[ 0 ].error ).toContain( 'Internal Server Error' );
	} );

	test( 'the caller still gets the error response, not a rejection', async () => {
		const { manager } = makeTarget();
		vi.spyOn( window, 'fetch' ).mockResolvedValue(
			response( 500, 'Internal Server Error' ),
		);

		const res = await trackedFetch(
			manager,
			'/wp-json/desktop-mode/v1/thing',
		);

		expect( res.status ).toBe( 500 );
		expect( res.ok ).toBe( false );
	} );

	test( 'a 4xx settles as failed too', async () => {
		const { manager, settled } = makeTarget();
		vi.spyOn( window, 'fetch' ).mockResolvedValue(
			response( 400, 'Bad Request' ),
		);

		await trackedFetch( manager, '/wp-json/desktop-mode/v1/thing' );
		await flush();

		expect( settled[ 0 ].ok ).toBe( false );
	} );

	test( 'a 2xx still settles as saved', async () => {
		const { manager, settled } = makeTarget();
		vi.spyOn( window, 'fetch' ).mockResolvedValue( response( 200, 'OK' ) );

		await trackedFetch( manager, '/wp-json/desktop-mode/v1/thing' );
		await flush();

		expect( settled ).toEqual( [ { ok: true } ] );
	} );

	test( 'a network-level rejection keeps its own error message', async () => {
		const { manager, settled } = makeTarget();
		vi.spyOn( window, 'fetch' ).mockRejectedValue(
			new Error( 'Failed to fetch' ),
		);

		await expect(
			trackedFetch( manager, '/wp-json/desktop-mode/v1/thing' ),
		).rejects.toThrow( 'Failed to fetch' );
		await flush();

		expect( settled[ 0 ] ).toEqual( {
			ok: false,
			error: 'Failed to fetch',
		} );
	} );

	test( 'silent requests are not tracked at all', async () => {
		const { manager, settled } = makeTarget();
		vi.spyOn( window, 'fetch' ).mockResolvedValue(
			response( 500, 'Internal Server Error' ),
		);

		await trackedFetch(
			manager,
			'/wp-json/desktop-mode/v1/thing',
			undefined,
			{ silent: true },
		);
		await flush();

		expect( settled ).toHaveLength( 0 );
	} );
} );
