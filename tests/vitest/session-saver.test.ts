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

function deferred< T >() {
	let resolve!: ( v: T ) => void;
	const promise = new Promise< T >( ( r ) => {
		resolve = r;
	} );
	return { promise, resolve };
}

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

function windowIdsOfCall( call: number ): string[] {
	const init = trackedFetchMock.mock.calls[ call ][ 2 ] as RequestInit;
	const parsed = JSON.parse( init.body as string ) as { session: Session };
	return parsed.session.windows.map( ( w ) => w.id );
}

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

		const openIds = [ 'a', 'b' ];
		const save = createSessionSaver(
			fakeManager( openIds ),
			fakeConfig(),
		);

		const first = deferred< Response >();
		trackedFetchMock.mockReturnValueOnce( first.promise );

		save();
		await vi.advanceTimersByTimeAsync( 500 );
		expect( trackedFetchMock ).toHaveBeenCalledTimes( 1 );
		expect( windowIdsOfCall( 0 ) ).toEqual( [ 'a', 'b' ] );

		openIds.pop();
		save();
		await vi.advanceTimersByTimeAsync( 500 );

		expect( trackedFetchMock ).toHaveBeenCalledTimes( 1 );

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

		for ( let i = 0; i < 3; i++ ) {
			openIds.pop();
			save();
			await vi.advanceTimersByTimeAsync( 500 );
		}

		first.resolve( new Response( '{}' ) );
		await vi.advanceTimersByTimeAsync( 2000 );

		expect( trackedFetchMock ).toHaveBeenCalledTimes( 2 );
		expect( windowIdsOfCall( 1 ) ).toEqual( [ 'a' ] );
	} );

	test( 'closing several windows a beat apart is rate limited to one write', async () => {

		const openIds = [ 'a', 'b', 'c', 'd' ];
		const save = createSessionSaver(
			fakeManager( openIds ),
			fakeConfig(),
		);

		openIds.pop();
		save();
		await vi.advanceTimersByTimeAsync( 600 );

		expect( trackedFetchMock ).toHaveBeenCalledTimes( 1 );

		openIds.pop();
		save();
		await vi.advanceTimersByTimeAsync( 600 );
		openIds.pop();
		save();
		await vi.advanceTimersByTimeAsync( 600 );

		expect( trackedFetchMock ).toHaveBeenCalledTimes( 1 );

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

		save();
		await vi.advanceTimersByTimeAsync( 2000 );
		expect( trackedFetchMock ).toHaveBeenCalledTimes( 2 );
	} );

	test( 'an unchanged session is not written again, whoever asks', async () => {

		const save = createSessionSaver( fakeManager( [ 'a' ] ), fakeConfig() );

		save();
		await vi.advanceTimersByTimeAsync( 600 );
		expect( trackedFetchMock ).toHaveBeenCalledTimes( 1 );

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

		openIds.pop();
		window.dispatchEvent( new Event( 'pagehide' ) );

		expect( sendBeacon ).toHaveBeenCalledTimes( 1 );
		const url = sendBeacon.mock.calls[ 0 ][ 0 ] as string;

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
