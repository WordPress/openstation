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
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { trackedFetch } from '../../src/boot/tracked-fetch';
import type { WindowManager } from '../../src/window-manager';
import type { Window as DesktopWindow } from '../../src/window';
import { activity } from '../../src/activity';
import { installHooksStub, clearHooksStub } from './helpers/hooks-stub';


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
		id: 'focused',
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

/**
 * The activity-bus half of what `wp.os.fetch` documents. Before
 * `os/request-settled` existed, `opts.source` was declared on the
 * options type, described in four places in the JavaScript
 * reference, and passed by a dozen in-tree callers — and read by
 * nothing. These pin the publish, not the argument.
 */
describe( 'os/request-settled', () => {
	beforeEach( () => {
		vi.restoreAllMocks();
		installHooksStub();
	} );
	afterEach( () => clearHooksStub() );

	test( 'a tagged request reaches the activity bus', async () => {
		const { manager } = makeTarget();
		vi.spyOn( window, 'fetch' ).mockResolvedValue( response( 200, 'OK' ) );
		const seen: unknown[] = [];
		const off = activity.subscribe( 'os/request-settled', ( p ) =>
			seen.push( p ),
		);
		await trackedFetch( manager, '/wp-json/x/v1/y', undefined, {
			source: 'probe/x',
		} );
		await flush();
		off();
		expect( seen ).toHaveLength( 1 );
		expect( seen[ 0 ] ).toMatchObject( {
			source: 'probe/x',
			ok: true,
			status: 200,
			method: 'GET',
			url: '/wp-json/x/v1/y',
			silent: false,
		} );
	} );

	test( 'an untagged request publishes with no source key at all', async () => {
		const { manager } = makeTarget();
		vi.spyOn( window, 'fetch' ).mockResolvedValue( response( 200, 'OK' ) );
		const seen: Record< string, unknown >[] = [];
		const off = activity.subscribe( 'os/request-settled', ( p ) =>
			seen.push( p as Record< string, unknown > ),
		);
		await trackedFetch( manager, '/wp-json/x/v1/y' );
		await flush();
		off();
		// Absent rather than undefined: a subscriber grouping by tag
		// should see "untagged", not a key whose value is nothing.
		expect( seen[ 0 ] ).not.toHaveProperty( 'source' );
	} );

	test( 'a refused response publishes ok:false with its status', async () => {
		const { manager } = makeTarget();
		vi.spyOn( window, 'fetch' ).mockResolvedValue(
			response( 500, 'Internal Server Error' ),
		);
		const seen: unknown[] = [];
		const off = activity.subscribe( 'os/request-settled', ( p ) =>
			seen.push( p ),
		);
		await trackedFetch( manager, '/wp-json/x/v1/y', { method: 'post' } );
		await flush();
		off();
		// The method is normalised, so a subscriber can group on it
		// without case-folding every row itself.
		expect( seen[ 0 ] ).toMatchObject( {
			ok: false,
			status: 500,
			method: 'POST',
		} );
	} );

	test( 'a network rejection publishes the reason and no status', async () => {
		const { manager } = makeTarget();
		vi.spyOn( window, 'fetch' ).mockRejectedValue( new Error( 'offline' ) );
		const seen: Record< string, unknown >[] = [];
		const off = activity.subscribe( 'os/request-settled', ( p ) =>
			seen.push( p as Record< string, unknown > ),
		);
		await expect(
			trackedFetch( manager, '/wp-json/x/v1/y', undefined, {
				source: 'probe/x',
			} ),
		).rejects.toThrow( 'offline' );
		await flush();
		off();
		expect( seen[ 0 ] ).toMatchObject( { error: 'offline', source: 'probe/x' } );
		// There was no response, so `status` and `ok` are left off
		// rather than faked as 0 / false, which a subscriber could not
		// tell apart from a server that really answered.
		expect( seen[ 0 ] ).not.toHaveProperty( 'status' );
		expect( seen[ 0 ] ).not.toHaveProperty( 'ok' );
	} );

	test( 'a silent request still reaches the bus, flagged silent', async () => {
		const { manager, settled } = makeTarget();
		vi.spyOn( window, 'fetch' ).mockResolvedValue( response( 200, 'OK' ) );
		const seen: unknown[] = [];
		const off = activity.subscribe( 'os/request-settled', ( p ) =>
			seen.push( p ),
		);
		await trackedFetch( manager, '/wp-json/x/v1/y', undefined, {
			silent: true,
			source: 'probe/x',
		} );
		await flush();
		off();
		// `silent` suppresses the title-bar ring, which is a question
		// about the window's chrome, not about whether the request
		// happened. The indicator stays quiet; the bus does not.
		expect( settled ).toHaveLength( 0 );
		expect( seen ).toHaveLength( 1 );
		expect( seen[ 0 ] ).toMatchObject( { silent: true, source: 'probe/x' } );
	} );

	test( 'windowId names the window the request is attributed to', async () => {
		const { manager } = makeTarget();
		vi.spyOn( window, 'fetch' ).mockResolvedValue( response( 200, 'OK' ) );
		const seen: { windowId: string | null }[] = [];
		const off = activity.subscribe( 'os/request-settled', ( p ) =>
			seen.push( p ),
		);
		const named = { id: 'notes' } as unknown as DesktopWindow;
		// Foreground and unnamed: the focused window, whose ring moves.
		await trackedFetch( manager, '/a' );
		// Silent and unnamed: no ring, so no window. Otherwise every
		// background poll lands on whatever the user clicked last.
		await trackedFetch( manager, '/b', undefined, { silent: true } );
		// Silent but named: the caller's own attribution stands.
		await trackedFetch( manager, '/c', undefined, { silent: true, window: named } );
		// Named but closed, silent: not re-pinned on the focused window.
		await trackedFetch( manager, '/d', undefined, { silent: true, windowId: 'gone' } );
		await flush();
		off();
		expect( seen.map( ( p ) => p.windowId ) ).toEqual( [
			'focused',
			null,
			'notes',
			null,
		] );
	} );

	test( 'a cancelled request is flagged aborted, a failed one is not', async () => {
		const { manager } = makeTarget();
		const seen: Record< string, unknown >[] = [];
		const off = activity.subscribe( 'os/request-settled', ( p ) =>
			seen.push( p as Record< string, unknown > ),
		);
		// `abort( reason )` rejects with the reason, not an AbortError,
		// so only the signal can tell.
		const controller = new AbortController();
		controller.abort( 'superseded' );
		vi.spyOn( window, 'fetch' ).mockRejectedValueOnce( 'superseded' );
		await expect(
			trackedFetch( manager, '/a', { signal: controller.signal } ),
		).rejects.toBe( 'superseded' );
		vi.spyOn( window, 'fetch' ).mockRejectedValueOnce( new Error( 'offline' ) );
		await expect( trackedFetch( manager, '/b' ) ).rejects.toThrow( 'offline' );
		await flush();
		off();
		expect( seen[ 0 ] ).toMatchObject( { error: 'superseded', aborted: true } );
		expect( seen[ 1 ] ).toMatchObject( { error: 'offline' } );
		expect( seen[ 1 ] ).not.toHaveProperty( 'aborted' );
	} );

	test( 'a subscriber that throws does not break the request', async () => {
		const { manager, settled } = makeTarget();
		vi.spyOn( window, 'fetch' ).mockResolvedValue( response( 200, 'OK' ) );
		const off = activity.subscribe( 'os/request-settled', () => {
			throw new Error( 'bad subscriber' );
		} );
		// `publish` calls subscribers synchronously and goes through
		// `wp.hooks`, and this runs on every request the shell makes —
		// so an unguarded publish would hang an unhandled rejection off
		// the caller's fetch. The observability channel must not be
		// able to break the thing it observes.
		const rejections: unknown[] = [];
		const onRejection = ( err: unknown ) => rejections.push( err );
		process.on( 'unhandledRejection', onRejection );
		const res = await trackedFetch( manager, '/wp-json/x/v1/y' );
		// Building the payload is inside the same guard: a rejection
		// value with no string form must not escape either.
		vi.spyOn( window, 'fetch' ).mockRejectedValueOnce( Object.create( null ) );
		await trackedFetch( manager, '/wp-json/x/v1/z', undefined, {
			silent: true,
		} ).catch( () => {} );
		await flush();
		// A rejection is reported on the next macrotask, not the next
		// microtask, so the flush above is not enough to see one.
		await new Promise( ( r ) => setTimeout( r, 0 ) );
		process.off( 'unhandledRejection', onRejection );
		off();
		expect( rejections ).toEqual( [] );
		expect( res.status ).toBe( 200 );
		expect( settled ).toEqual( [ { ok: true } ] );
	} );
} );
