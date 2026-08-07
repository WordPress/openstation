/**
 * Pre-close "unsaved changes" query for iframe windows.
 *
 * Before destroying an iframe-backed (non-native) window, `close()`
 * posts `os-bridge-beforeunload-query` to the iframe and
 * waits for `os-bridge-beforeunload-response` before
 * proceeding — giving Gutenberg-style `beforeunload` guards a chance
 * to veto the close. A 500ms safety timer forces the close through
 * if the iframe never answers. Native windows are untouched — they
 * keep using the synchronous `NATIVE_WINDOW_BEFORE_CLOSE` filter.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { WindowManager } from '../../src/window-manager';
import { handleWindowMessage } from '../../src/window/iframe-bridge';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

function cfg( id: string, overrides: Record< string, unknown > = {} ) {
	return {
		id,
		url: `http://example.test/wp-admin/${ id }.php`,
		title: id,
		icon: 'dashicons-admin-generic',
		...overrides,
	};
}

function makeDesktop(): HTMLElement {
	const desktop = document.createElement( 'div' );
	Object.defineProperty( desktop, 'getBoundingClientRect', {
		value: () =>
			( {
				left: 0,
				top: 0,
				right: 1600,
				bottom: 900,
				width: 1600,
				height: 900,
				x: 0,
				y: 0,
				toJSON: () => ( {} ),
			} ) as DOMRect,
	} );
	Object.defineProperty( desktop, 'clientWidth', { value: 1600, configurable: true } );
	Object.defineProperty( desktop, 'clientHeight', { value: 900, configurable: true } );
	return desktop;
}

/** Simulate the iframe bridge announcing readiness. */
function markBridgeReady( win: { id: string; iframe: HTMLIFrameElement | null } ): void {
	handleWindowMessage(
		win as never,
		new MessageEvent( 'message', {
			data: { type: 'os-ready' },
			origin: window.location.origin,
			source: win.iframe?.contentWindow,
		} ),
	);
}

/** Simulate the iframe answering the pre-close query. */
function respondBeforeunload(
	win: { id: string; iframe: HTMLIFrameElement | null },
	response: { prevent: boolean; message?: string },
): void {
	handleWindowMessage(
		win as never,
		new MessageEvent( 'message', {
			data: { type: 'os-bridge-beforeunload-response', ...response },
			origin: window.location.origin,
			source: win.iframe?.contentWindow,
		} ),
	);
}

describe( 'Window.close() — iframe pre-close beforeunload query', () => {
	let desktop: HTMLElement;
	let manager: WindowManager;

	beforeEach( () => {
		installHooksStub();
		desktop = makeDesktop();
		document.body.appendChild( desktop );
		manager = new WindowManager( desktop );
	} );

	afterEach( () => {
		for ( const win of manager.getAll() ) {
			win.destroy();
		}
		desktop.remove();
		clearHooksStub();
		vi.useRealTimers();
	} );

	test( 'closes immediately when the bridge never announced readiness', async () => {
		const win = await manager.open( cfg( 'a' ) );
		const postSpy = vi.spyOn( win.iframe!.contentWindow!, 'postMessage' );

		win.close();

		expect(
			postSpy.mock.calls.some(
				( call ) => ( call[ 0 ] as { type?: string } )?.type === 'os-bridge-beforeunload-query',
			),
		).toBe( false );
		expect( win._isDestroyed ).toBe( true );
	} );

	test( 'bridge-ready window: close() queries the iframe and defers destroy', async () => {
		const win = await manager.open( cfg( 'a' ) );
		markBridgeReady( win );
		const postSpy = vi.spyOn( win.iframe!.contentWindow!, 'postMessage' );

		win.close();

		expect( postSpy ).toHaveBeenCalledWith(
			{ type: 'os-bridge-beforeunload-query' },
			window.location.origin,
		);
		expect( win._isDestroyed ).toBe( false );
		expect( win._closePending ).toBe( true );
	} );

	test( 'response with prevent: false destroys the window', async () => {
		const win = await manager.open( cfg( 'a' ) );
		markBridgeReady( win );

		win.close();
		expect( win._isDestroyed ).toBe( false );

		respondBeforeunload( win, { prevent: false } );
		await vi.waitFor( () => expect( win._isDestroyed ).toBe( true ) );
		expect( win._closePending ).toBe( false );
	} );

	test( 'a second close() call while a query is in flight is a no-op, not an immediate destroy', async () => {
		// Regression: double-clicking the close button (or any other
		// re-entrant close() trigger) before the iframe answers used
		// to fall through to the unconditional destroy code below,
		// bypassing the unsaved-changes check entirely.
		const win = await manager.open( cfg( 'a' ) );
		markBridgeReady( win );
		const postSpy = vi.spyOn( win.iframe!.contentWindow!, 'postMessage' );

		win.close(); // first click — query in flight
		win.close(); // double-click before the response arrives

		expect( win._isDestroyed ).toBe( false );
		expect(
			postSpy.mock.calls.filter(
				( call ) => ( call[ 0 ] as { type?: string } )?.type === 'os-bridge-beforeunload-query',
			),
		).toHaveLength( 1 );

		respondBeforeunload( win, { prevent: false } );
		await vi.waitFor( () => expect( win._isDestroyed ).toBe( true ) );
	} );

	test( 'no response within 500ms: safety timer forces the close through', async () => {
		vi.useFakeTimers();
		const win = await manager.open( cfg( 'a' ) );
		markBridgeReady( win );

		win.close();
		expect( win._isDestroyed ).toBe( false );

		vi.advanceTimersByTime( 500 );

		expect( win._isDestroyed ).toBe( true );
	} );

	test( 'native windows are unaffected — no query, no deferred destroy', async () => {
		const win = await manager.open( cfg( 'native-a', { native: true } ) );

		win.close();

		expect( win._isDestroyed ).toBe( true );
	} );
} );
