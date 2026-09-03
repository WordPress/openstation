/**
 * `SessionSaver.flush()` — write now, resolve when the server answers.
 *
 * The one caller is the reload the shell offers after a deploy changed
 * its files: the navigation must wait for the session to land, or the
 * request that reads it back can beat the write and the desktop comes
 * back as the older snapshot.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createSessionSaver } from '../../src/boot/session-saver';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';
import type { WindowManager } from '../../src/window-manager';
import type { DesktopConfig, Session } from '../../src/types';

const trackedFetchMock = vi.hoisted( () => vi.fn() );

vi.mock( '../../src/boot/tracked-fetch', () => ( {
	trackedFetch: trackedFetchMock,
} ) );

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
		sessionUrl: 'https://example.test/wp-json/desktop-mode/v1/session',
		restNonce: 'nonce-abc',
	} as unknown as DesktopConfig;
}

function windowIdsOfCall( call: number ): string[] {
	const init = trackedFetchMock.mock.calls[ call ][ 2 ] as RequestInit;
	const parsed = JSON.parse( init.body as string ) as { session: Session };
	return parsed.session.windows.map( ( w ) => w.id );
}

describe( 'session saver — flush()', () => {
	beforeEach( () => {
		vi.useFakeTimers();
		installHooksStub();
		trackedFetchMock.mockReset();
		trackedFetchMock.mockResolvedValue( new Response( '{}' ) );
	} );

	afterEach( () => {
		clearHooksStub();
		vi.useRealTimers();
		vi.restoreAllMocks();
	} );

	test( 'writes immediately, ahead of the debounce, and resolves after the response', async () => {
		const save = createSessionSaver( fakeManager( [ 'a', 'b' ] ), fakeConfig() );
		const response = deferred< Response >();
		trackedFetchMock.mockReturnValueOnce( response.promise );

		save();
		let settled = false;
		const flushing = save.flush().then( () => {
			settled = true;
		} );
		await vi.advanceTimersByTimeAsync( 0 );

		// The debounced write was folded into the flush: one request,
		// sent at once, carrying the current desktop.
		expect( trackedFetchMock ).toHaveBeenCalledTimes( 1 );
		expect( windowIdsOfCall( 0 ) ).toEqual( [ 'a', 'b' ] );
		expect( settled ).toBe( false );

		response.resolve( new Response( '{}' ) );
		await flushing;
		expect( settled ).toBe( true );

		// The debounce timer was cleared, not left to fire a duplicate.
		await vi.advanceTimersByTimeAsync( 5_000 );
		expect( trackedFetchMock ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'lets a write already on the wire finish, then sends the latest state', async () => {
		const openIds = [ 'a', 'b' ];
		const save = createSessionSaver( fakeManager( openIds ), fakeConfig() );
		const first = deferred< Response >();
		trackedFetchMock.mockReturnValueOnce( first.promise );

		save();
		await vi.advanceTimersByTimeAsync( 500 );
		expect( trackedFetchMock ).toHaveBeenCalledTimes( 1 );

		// A window closes while the first save is in flight; the flush
		// must carry that, not the state the first save took.
		openIds.pop();
		const flushing = save.flush();
		await vi.advanceTimersByTimeAsync( 0 );
		expect( trackedFetchMock ).toHaveBeenCalledTimes( 1 );

		first.resolve( new Response( '{}' ) );
		await flushing;

		expect( trackedFetchMock ).toHaveBeenCalledTimes( 2 );
		expect( windowIdsOfCall( 1 ) ).toEqual( [ 'a' ] );
	} );

	test( 'sends nothing when the server already holds this session', async () => {
		const save = createSessionSaver( fakeManager( [ 'a' ] ), fakeConfig() );
		save();
		await vi.advanceTimersByTimeAsync( 500 );
		expect( trackedFetchMock ).toHaveBeenCalledTimes( 1 );

		await save.flush();
		expect( trackedFetchMock ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'never rejects — a failed write is best-effort, and the caller moves on', async () => {
		const save = createSessionSaver( fakeManager( [ 'a' ] ), fakeConfig() );
		trackedFetchMock.mockRejectedValueOnce( new TypeError( 'offline' ) );

		await expect( save.flush() ).resolves.toBeUndefined();
	} );
} );
