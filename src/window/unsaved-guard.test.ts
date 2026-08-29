/**
 * Tests for the pre-navigation unsaved-changes guard.
 *
 * The behaviour being pinned is a negative one: a window whose page
 * is holding unsaved changes must NOT paint the navigation it is
 * about to attempt, because the browser's own "Leave site?" prompt
 * can cancel it and nothing ever fires to take the paint back.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	navigateWithUnsavedGuard,
	queryUnsavedGuard,
} from './unsaved-guard';
import type { Window } from './index';

type SentMessage = { type?: string; requestId?: string };

/**
 * A frame whose content window records what the guard posts and can
 * answer on demand — standing in for a bridge inside a real admin
 * document.
 */
function mockFrame(): {
	frame: { contentWindow: { postMessage: ( m: unknown ) => void } };
	sent: SentMessage[];
	answer: ( prevent: boolean, requestId?: string | null ) => void;
	} {
	const sent: SentMessage[] = [];
	const frame = {
		contentWindow: {
			postMessage: ( m: unknown ) => {
				sent.push( m as SentMessage );
			},
		},
	};
	// `requestId` omitted echoes the last query's id (the bridge's
	// normal behaviour); `null` answers with no id at all, which is
	// what the uncorrelated pre-close reply looks like.
	const answer = (
		prevent: boolean,
		requestId?: string | null,
	): void => {
		const id =
			requestId === undefined
				? sent[ sent.length - 1 ]?.requestId
				: requestId;
		const data: Record< string, unknown > = {
			type: 'os-bridge-beforeunload-response',
			prevent,
		};
		if ( typeof id === 'string' ) {
			data.requestId = id;
		}
		window.dispatchEvent(
			new MessageEvent( 'message', {
				data,
				origin: window.location.origin,
			} ),
		);
	};
	return { frame, sent, answer };
}

describe( 'queryUnsavedGuard', () => {
	test( 'a frame with no content window resolves "nothing is holding on"', async () => {
		await expect( queryUnsavedGuard( null ) ).resolves.toBe( false );
		await expect( queryUnsavedGuard( {} ) ).resolves.toBe( false );
	} );

	test( 'posts a correlated query and resolves the bridge answer', async () => {
		const { frame, sent, answer } = mockFrame();

		const pending = queryUnsavedGuard( frame );
		expect( sent ).toHaveLength( 1 );
		expect( sent[ 0 ].type ).toBe( 'os-bridge-beforeunload-query' );
		expect( sent[ 0 ].requestId ).toBeTruthy();

		answer( true );
		await expect( pending ).resolves.toBe( true );
	} );

	test( 'ignores a response carrying someone else’s id', async () => {
		const { frame, answer } = mockFrame();

		const pending = queryUnsavedGuard( frame, { timeoutMs: 20 } );
		// The pre-CLOSE query's uncorrelated reply, and a different
		// asker's correlated one. Neither is ours.
		answer( true, null );
		answer( true, 'os-unsaved-guard-someone-else' );

		await expect( pending ).resolves.toBe( false );
	} );

	test( 'a silent bridge times out as "nothing is holding on"', async () => {
		const { frame } = mockFrame();

		await expect(
			queryUnsavedGuard( frame, { timeoutMs: 5 } ),
		).resolves.toBe( false );
	} );

	test( 'a postMessage that throws resolves rather than rejecting', async () => {
		const frame = {
			contentWindow: {
				postMessage: () => {
					throw new Error( 'frame torn down' );
				},
			},
		};

		await expect( queryUnsavedGuard( frame ) ).resolves.toBe( false );
	} );

	test( 'drops its message listener once settled', async () => {
		const { frame, answer } = mockFrame();
		const removeSpy = vi.spyOn( window, 'removeEventListener' );

		const pending = queryUnsavedGuard( frame );
		answer( false );
		await pending;

		expect( removeSpy ).toHaveBeenCalledWith(
			'message',
			expect.any( Function ),
		);
		removeSpy.mockRestore();
	} );
} );

/**
 * A window stub with just the surface the guard reaches for, plus a
 * real implementation of the deferred-commit slot so the release path
 * can be exercised end to end.
 */
function mockWindow( overrides: Partial< Window > = {} ): Window {
	const win = {
		_iframeBridgeReady: true,
		_isDestroyed: false,
		_unsavedGuardPending: false,
		_deferredNavigationCommit: null as ( () => void ) | null,
		_deferNavigationCommit( commit: () => void ) {
			win._deferredNavigationCommit = commit;
		},
		_commitDeferredNavigation() {
			const commit = win._deferredNavigationCommit;
			win._deferredNavigationCommit = null;
			commit?.();
		},
		...overrides,
	} as unknown as Window & {
		_deferredNavigationCommit: ( () => void ) | null;
	};
	return win;
}

describe( 'navigateWithUnsavedGuard', () => {
	beforeEach( () => {
		vi.useRealTimers();
	} );
	afterEach( () => {
		vi.useRealTimers();
	} );

	test( 'a bridge-less window paints and navigates synchronously', () => {
		const commit = vi.fn();
		const navigate = vi.fn();
		const { frame } = mockFrame();
		const win = mockWindow( {
			_iframeBridgeReady: false,
			iframe: frame as unknown as HTMLIFrameElement,
		} );

		navigateWithUnsavedGuard( win, { commit, navigate } );

		// No await: a window whose bridge never announced itself must
		// not pay the query's latency on every navigation.
		expect( commit ).toHaveBeenCalledTimes( 1 );
		expect( navigate ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'a page with nothing to lose paints and navigates', async () => {
		const commit = vi.fn();
		const navigate = vi.fn();
		const { frame, answer } = mockFrame();
		const win = mockWindow( {
			iframe: frame as unknown as HTMLIFrameElement,
		} );

		navigateWithUnsavedGuard( win, { commit, navigate } );
		answer( false );
		await vi.waitFor( () => expect( navigate ).toHaveBeenCalledTimes( 1 ) );

		expect( commit ).toHaveBeenCalledTimes( 1 );
		expect( win._unsavedGuardPending ).toBe( false );
	} );

	test( 'a guarded page navigates but withholds the paint', async () => {
		const commit = vi.fn();
		const navigate = vi.fn();
		const { frame, answer } = mockFrame();
		const win = mockWindow( {
			iframe: frame as unknown as HTMLIFrameElement,
		} );

		navigateWithUnsavedGuard( win, { commit, navigate } );
		answer( true );
		await vi.waitFor( () => expect( navigate ).toHaveBeenCalledTimes( 1 ) );

		// The whole point: the prompt is still on screen and its answer
		// decides. Cancelling it leaves the window exactly as it was.
		expect( commit ).not.toHaveBeenCalled();

		// …and accepting it produces a real unload, which releases the
		// paint the shell was holding.
		win._commitDeferredNavigation();
		expect( commit ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'a destroyed window neither paints nor navigates', async () => {
		const commit = vi.fn();
		const navigate = vi.fn();
		const { frame, answer } = mockFrame();
		const win = mockWindow( {
			iframe: frame as unknown as HTMLIFrameElement,
		} );

		navigateWithUnsavedGuard( win, { commit, navigate } );
		( win as unknown as { _isDestroyed: boolean } )._isDestroyed = true;
		answer( false );
		await vi.waitFor( () =>
			expect( win._unsavedGuardPending ).toBe( false ),
		);

		expect( commit ).not.toHaveBeenCalled();
		expect( navigate ).not.toHaveBeenCalled();
	} );

	test( 'marks a query in flight so a double-click cannot slip past', () => {
		const { frame } = mockFrame();
		const win = mockWindow( {
			iframe: frame as unknown as HTMLIFrameElement,
		} );

		navigateWithUnsavedGuard( win, { commit: () => {}, navigate: () => {} } );

		expect( win._unsavedGuardPending ).toBe( true );
	} );
} );
