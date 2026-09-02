/**
 * Tests for the boot-time session saver — the pipeline that persists
 * open windows so a reload brings the desktop back the way the user
 * left it.
 *
 * The bugs these pin are all the same user-visible symptom: "I close a
 * window, refresh, and it's back." Each has a different cause.
 *
 *   1. A save triggered while another is on the wire used to be
 *      DROPPED — the debounce timer had already fired and cleared
 *      itself, so nothing retried and the mutation was lost.
 *   2. The unload beacon must carry a snapshot taken at unload time,
 *      with the nonce on the URL (WP REST reads it from `$_REQUEST`,
 *      never from a JSON body).
 *   3. `updated` is the server's stale-write ordering key, and at
 *      second resolution the `keepalive` fetch and the `pagehide`
 *      beacon tie — letting a stale payload win.
 *
 * And the opposite symptom, "I only clicked a tab and the network
 * panel shows a session write": a snapshot equal to the one the
 * server last accepted is never sent.
 */
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
	vi,
} from 'vitest';
import { createSessionSaver } from '../../src/boot/session-saver';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';
import type { WindowManager } from '../../src/window-manager';
import type { DesktopConfig, Session } from '../../src/types';

const trackedFetchMock = vi.hoisted( () => vi.fn() );

vi.mock( '../../src/boot/tracked-fetch', () => ( {
	trackedFetch: trackedFetchMock,
} ) );

const SESSION_URL = 'https://example.test/wp-json/desktop-mode/v1/session';
const NONCE = 'nonce-abc';

/** A deferred promise, so a test can hold a save "in flight". */
function deferred< T >() {
	let resolve!: ( v: T ) => void;
	const promise = new Promise< T >( ( r ) => {
		resolve = r;
	} );
	return { promise, resolve };
}

/**
 * Minimal WindowManager stand-in. `openIds` is mutable so a test can
 * change the desktop state between saves and assert which snapshot
 * each request carried.
 */
function fakeManager( openIds: string[] ) {
	return {
		snapshot: (): Session => ( {
			windows: openIds.map( ( id ) => ( {
				id,
				url: `https://example.test/wp-admin/${ id }.php`,
				title: id,
				icon: 'dashicons-admin-generic',
				state: 'normal',
				x: 0,
				y: 0,
				width: 800,
				height: 600,
			} ) ) as Session[ 'windows' ],
			desktops: [ { id: 'desktop-1', label: 'Desktop 1' } ],
			activeDesktop: 'desktop-1',
			focused: openIds[ openIds.length - 1 ] || '',
			updated: Date.now(),
		} ),
	} as unknown as WindowManager;
}

function fakeConfig(): DesktopConfig {
	return {
		sessionUrl: SESSION_URL,
		restNonce: NONCE,
	} as unknown as DesktopConfig;
}

/** Window ids in the body of the Nth trackedFetch call. */
function windowIdsOfCall( call: number ): string[] {
	const init = trackedFetchMock.mock.calls[ call ][ 2 ] as RequestInit;
	const parsed = JSON.parse( init.body as string ) as { session: Session };
	return parsed.session.windows.map( ( w ) => w.id );
}

/**
 * `createSessionSaver` binds `pagehide` / `visibilitychange` for the
 * life of the page and never unbinds — correct in production (one
 * saver per load) but the listeners accumulate on the shared jsdom
 * window across tests, so a later `pagehide` fires every previous
 * test's saver too. Record what each test binds and unbind it after.
 */
const boundListeners: Array<
	[ EventTarget, string, EventListenerOrEventListenerObject ]
> = [];

function trackListeners( target: EventTarget ): void {
	const original = target.addEventListener.bind( target );
	vi.spyOn( target, 'addEventListener' ).mockImplementation(
		( type, cb, opts ) => {
			if ( cb ) {
				boundListeners.push( [ target, type, cb ] );
			}
			original( type, cb, opts );
		},
	);
}

/** Install a `navigator.sendBeacon` without replacing all of `navigator`. */
function stubSendBeacon( impl: ( ...a: unknown[] ) => boolean ) {
	const mock = vi.fn( impl );
	Object.defineProperty( navigator, 'sendBeacon', {
		value: mock,
		configurable: true,
		writable: true,
	} );
	return mock;
}

describe( 'session saver', () => {
	beforeEach( () => {
		vi.useFakeTimers();
		installHooksStub();
		trackedFetchMock.mockReset();
		trackedFetchMock.mockResolvedValue( new Response( '{}' ) );
		trackListeners( window );
		trackListeners( document );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
		for ( const [ target, type, cb ] of boundListeners ) {
			target.removeEventListener( type, cb );
		}
		boundListeners.length = 0;
		delete ( navigator as { sendBeacon?: unknown } ).sendBeacon;
		clearHooksStub();
		vi.useRealTimers();
	} );

	test( 'collapses a burst of changes into a single write', async () => {
		const save = createSessionSaver( fakeManager( [ 'a' ] ), fakeConfig() );

		save();
		save();
		save();
		await vi.advanceTimersByTimeAsync( 500 );

		expect( trackedFetchMock ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'a change during an in-flight save is re-sent, not dropped', async () => {
		// The regression: closing a second window while the first
		// close is still on the wire used to lose the second close
		// entirely, so a reload brought that window back.
		const openIds = [ 'a', 'b' ];
		const save = createSessionSaver(
			fakeManager( openIds ),
			fakeConfig(),
		);

		const first = deferred< Response >();
		trackedFetchMock.mockReturnValueOnce( first.promise );

		// Close nothing yet — first save carries both windows.
		save();
		await vi.advanceTimersByTimeAsync( 500 );
		expect( trackedFetchMock ).toHaveBeenCalledTimes( 1 );
		expect( windowIdsOfCall( 0 ) ).toEqual( [ 'a', 'b' ] );

		// User closes `b` while the first request is still open.
		openIds.pop();
		save();
		await vi.advanceTimersByTimeAsync( 500 );
		// Still only the in-flight request — the second is queued.
		expect( trackedFetchMock ).toHaveBeenCalledTimes( 1 );

		// First request settles → the queued save must run. It goes
		// back through the debounce + rate limit rather than firing
		// the instant the previous request lands.
		first.resolve( new Response( '{}' ) );
		await vi.advanceTimersByTimeAsync( 2000 );

		expect( trackedFetchMock ).toHaveBeenCalledTimes( 2 );
		expect( windowIdsOfCall( 1 ) ).toEqual( [ 'a' ] );
	} );

	test( 'a queued save runs once, not once per suppressed call', async () => {
		const openIds = [ 'a', 'b', 'c', 'd' ];
		const save = createSessionSaver( fakeManager( openIds ), fakeConfig() );
		const first = deferred< Response >();
		trackedFetchMock.mockReturnValueOnce( first.promise );

		save();
		await vi.advanceTimersByTimeAsync( 500 );

		// Three separate mutations while the request is in flight.
		for ( let i = 0; i < 3; i++ ) {
			openIds.pop();
			save();
			await vi.advanceTimersByTimeAsync( 500 );
		}

		first.resolve( new Response( '{}' ) );
		await vi.advanceTimersByTimeAsync( 2000 );

		// One catch-up write carrying the latest state — not three.
		expect( trackedFetchMock ).toHaveBeenCalledTimes( 2 );
		expect( windowIdsOfCall( 1 ) ).toEqual( [ 'a' ] );
	} );

	test( 'closing several windows a beat apart is rate limited to one write', async () => {
		// Each close is spaced wider than the 500ms debounce, so the
		// debounce alone would let all three through. The rate limit
		// underneath it collapses them.
		const openIds = [ 'a', 'b', 'c', 'd' ];
		const save = createSessionSaver(
			fakeManager( openIds ),
			fakeConfig(),
		);

		openIds.pop();
		save();
		await vi.advanceTimersByTimeAsync( 600 );
		// First close cleared the debounce and went out.
		expect( trackedFetchMock ).toHaveBeenCalledTimes( 1 );

		openIds.pop();
		save();
		await vi.advanceTimersByTimeAsync( 600 );
		openIds.pop();
		save();
		await vi.advanceTimersByTimeAsync( 600 );

		// Both later closes are still held behind the rate limit —
		// three closes, one write so far, where the debounce alone
		// would have sent three.
		expect( trackedFetchMock ).toHaveBeenCalledTimes( 1 );

		// …and the write that does go out carries the final state, so
		// nothing was dropped to achieve the throttling.
		await vi.advanceTimersByTimeAsync( 2000 );
		const calls = trackedFetchMock.mock.calls.length;
		expect( windowIdsOfCall( calls - 1 ) ).toEqual( [ 'a' ] );
	} );

	test( 'the rate limit never drops the final state', async () => {
		const openIds = [ 'a', 'b' ];
		const save = createSessionSaver(
			fakeManager( openIds ),
			fakeConfig(),
		);

		save();
		await vi.advanceTimersByTimeAsync( 600 );
		expect( trackedFetchMock ).toHaveBeenCalledTimes( 1 );

		// A change immediately after a write — the worst case for a
		// throttle that drops instead of delays.
		openIds.pop();
		save();
		await vi.advanceTimersByTimeAsync( 3000 );

		const calls = trackedFetchMock.mock.calls.length;
		expect( calls ).toBe( 2 );
		expect( windowIdsOfCall( calls - 1 ) ).toEqual( [ 'a' ] );
	} );

	test( 'a failed save still lets the next one through', async () => {
		const save = createSessionSaver( fakeManager( [ 'a' ] ), fakeConfig() );
		trackedFetchMock.mockRejectedValueOnce( new Error( 'offline' ) );

		save();
		await vi.advanceTimersByTimeAsync( 500 );
		expect( trackedFetchMock ).toHaveBeenCalledTimes( 1 );

		// `inFlight` must have been released in the `finally`, or the
		// saver deadlocks and nothing persists for the rest of the
		// session. Past the rate limit, not just the debounce.
		save();
		await vi.advanceTimersByTimeAsync( 2000 );
		expect( trackedFetchMock ).toHaveBeenCalledTimes( 2 );
	} );

	test( 'an unchanged session is not written again, whoever asks', async () => {
		// The regression: every pointerdown in a window re-focused it,
		// `os-window-focused` fired for a focus that never moved, and
		// each page switch inside OpenStation Preferences POSTed the
		// session the server already held.
		const save = createSessionSaver( fakeManager( [ 'a' ] ), fakeConfig() );

		save();
		await vi.advanceTimersByTimeAsync( 600 );
		expect( trackedFetchMock ).toHaveBeenCalledTimes( 1 );

		// Three "changes" that change nothing, spaced past the rate
		// limit so only the comparison can hold them back. `updated`
		// is a fresh `Date.now()` on every snapshot and must not count.
		for ( let i = 0; i < 3; i++ ) {
			save();
			await vi.advanceTimersByTimeAsync( 2000 );
		}
		expect( trackedFetchMock ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'a real change after suppressed no-ops still goes out', async () => {
		const openIds = [ 'a', 'b' ];
		const save = createSessionSaver( fakeManager( openIds ), fakeConfig() );

		save();
		await vi.advanceTimersByTimeAsync( 600 );
		save();
		await vi.advanceTimersByTimeAsync( 2000 );
		expect( trackedFetchMock ).toHaveBeenCalledTimes( 1 );

		openIds.pop();
		save();
		await vi.advanceTimersByTimeAsync( 2000 );
		expect( trackedFetchMock ).toHaveBeenCalledTimes( 2 );
		expect( windowIdsOfCall( 1 ) ).toEqual( [ 'a' ] );
	} );

	test( 'a write the server refused is not treated as accepted', async () => {
		// An expired nonce answers 403 without throwing. The server is
		// still on the older session, so the same snapshot must be
		// sent again on the next request — not deduplicated away.
		const save = createSessionSaver( fakeManager( [ 'a' ] ), fakeConfig() );
		trackedFetchMock.mockResolvedValueOnce(
			new Response( '{}', { status: 403 } ),
		);

		save();
		await vi.advanceTimersByTimeAsync( 600 );
		save();
		await vi.advanceTimersByTimeAsync( 2000 );
		expect( trackedFetchMock ).toHaveBeenCalledTimes( 2 );
	} );

	test( 'pagehide skips the beacon when the server already holds this session', async () => {
		const sendBeacon = stubSendBeacon( () => true );
		const save = createSessionSaver( fakeManager( [ 'a' ] ), fakeConfig() );

		save();
		await vi.advanceTimersByTimeAsync( 600 );
		expect( trackedFetchMock ).toHaveBeenCalledTimes( 1 );

		window.dispatchEvent( new Event( 'pagehide' ) );
		expect( sendBeacon ).not.toHaveBeenCalled();
	} );

	test( 'pagehide beacons the current snapshot with the nonce on the URL', () => {
		const sendBeacon = stubSendBeacon( () => true );

		const openIds = [ 'a', 'b' ];
		createSessionSaver( fakeManager( openIds ), fakeConfig() );

		// User closes `b`, then immediately reloads.
		openIds.pop();
		window.dispatchEvent( new Event( 'pagehide' ) );

		expect( sendBeacon ).toHaveBeenCalledTimes( 1 );
		const url = sendBeacon.mock.calls[ 0 ][ 0 ] as string;
		// WP REST cookie auth reads the nonce from `$_REQUEST`, so a
		// JSON body alone gets a 403 and the close never persists.
		expect( url ).toContain( `_wpnonce=${ NONCE }` );
		expect( url.startsWith( SESSION_URL ) ).toBe( true );
	} );

	test( 'pagehide cancels a pending debounce rather than double-writing', async () => {
		const sendBeacon = stubSendBeacon( () => true );

		const save = createSessionSaver( fakeManager( [ 'a' ] ), fakeConfig() );
		save();
		window.dispatchEvent( new Event( 'pagehide' ) );
		await vi.advanceTimersByTimeAsync( 1000 );

		expect( sendBeacon ).toHaveBeenCalledTimes( 1 );
		expect( trackedFetchMock ).not.toHaveBeenCalled();
	} );

	test( 'falls back to a normal POST when sendBeacon refuses', async () => {
		stubSendBeacon( () => false );

		createSessionSaver( fakeManager( [ 'a' ] ), fakeConfig() );
		window.dispatchEvent( new Event( 'pagehide' ) );
		await vi.advanceTimersByTimeAsync( 0 );

		expect( trackedFetchMock ).toHaveBeenCalledTimes( 1 );
	} );
} );
