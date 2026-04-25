/**
 * Tests for the cross-window connection bridge (`src/connection`).
 *
 * Strategy: mock the `WindowManager` with a fake `getById` that
 * returns a stub window whose iframe captures `postMessage` calls.
 * For each test we drive the bridge by simulating the iframe's
 * handshake-ack / publish messages directly into
 * `routeIncomingFromIframe` — that's the only entry the bridge
 * needs from the outside; we don't need a real iframe.
 */
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
	vi,
} from 'vitest';
import { createConnectionBridge } from '../../src/connection';
import type { Window as DesktopWindow } from '../../src/window';
import type { WindowManager } from '../../src/window-manager';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

interface FakeIframe {
	contentWindow: { postMessage: ReturnType< typeof vi.fn > };
}
interface FakeWindow {
	id: string;
	iframe: FakeIframe | null;
}

function makeManager(
	windows: Record< string, FakeWindow >,
): WindowManager {
	return {
		getById: ( id: string ) => windows[ id ] as unknown as DesktopWindow | undefined,
	} as unknown as WindowManager;
}

function makeIframe(): FakeIframe {
	return {
		contentWindow: { postMessage: vi.fn() },
	};
}

describe( 'connection bridge', () => {
	let postedMessages: unknown[];

	beforeEach( () => {
		postedMessages = [];
		// `connect()` calls `doAction(HOOKS.CONNECTION_*)` which
		// reaches `window.wp.hooks`; install a fresh stub per test
		// so didAction counters don't leak.
		installHooksStub();
	} );

	afterEach( () => {
		clearHooksStub();
		vi.restoreAllMocks();
	} );

	test( 'connect() sends a handshake; ack opens the connection + flushes queue', () => {
		const iframe = makeIframe();
		const mgr = makeManager( { 'win-1': { id: 'win-1', iframe } } );
		const bridge = createConnectionBridge( mgr );

		const onOpen = vi.fn();
		const conn = bridge.connect( 'win-1', { topics: [ 'foo' ], onOpen } );

		// Handshake fired immediately.
		const calls = iframe.contentWindow.postMessage.mock.calls;
		expect( calls ).toHaveLength( 1 );
		expect( calls[ 0 ][ 0 ] ).toMatchObject( {
			type: 'wp-desktop-bridge-handshake',
			connectionId: conn.id,
			topics: [ 'foo' ],
		} );

		// Pre-handshake send goes into the queue (no second postMessage).
		conn.send( 'foo', { hello: 1 } );
		expect( iframe.contentWindow.postMessage.mock.calls ).toHaveLength( 1 );

		// Iframe acks → onOpen fires + queue flushes.
		bridge.routeIncomingFromIframe( {
			type: 'wp-desktop-bridge-handshake-ack',
			connectionId: conn.id,
		} );
		expect( onOpen ).toHaveBeenCalledTimes( 1 );
		expect( conn.isOpen() ).toBe( true );
		// Original handshake + flushed publish.
		expect( iframe.contentWindow.postMessage.mock.calls ).toHaveLength( 2 );
		expect( iframe.contentWindow.postMessage.mock.calls[ 1 ][ 0 ] ).toMatchObject( {
			type: 'wp-desktop-bridge-publish',
			topic: 'foo',
			payload: { hello: 1 },
		} );
	} );

	test( 'subscribe receives published payloads from the iframe', () => {
		const iframe = makeIframe();
		const mgr = makeManager( { 'win-1': { id: 'win-1', iframe } } );
		const bridge = createConnectionBridge( mgr );
		const conn = bridge.connect( 'win-1' );
		bridge.routeIncomingFromIframe( {
			type: 'wp-desktop-bridge-handshake-ack',
			connectionId: conn.id,
		} );

		const cb = vi.fn();
		conn.subscribe< { count: number } >( 'gutenberg:content', cb );

		bridge.routeIncomingFromIframe( {
			type: 'wp-desktop-bridge-publish',
			connectionId: conn.id,
			topic: 'gutenberg:content',
			payload: { count: 42 },
		} );

		expect( cb ).toHaveBeenCalledTimes( 1 );
		expect( cb ).toHaveBeenCalledWith(
			{ count: 42 },
			{ topic: 'gutenberg:content' },
		);
	} );

	test( 'wildcard subscriber sees every topic', () => {
		const iframe = makeIframe();
		const bridge = createConnectionBridge(
			makeManager( { 'w': { id: 'w', iframe } } ),
		);
		const conn = bridge.connect( 'w' );
		bridge.routeIncomingFromIframe( {
			type: 'wp-desktop-bridge-handshake-ack',
			connectionId: conn.id,
		} );

		const seen: string[] = [];
		conn.subscribe( '*', ( _p, m ) => seen.push( m.topic ) );

		bridge.routeIncomingFromIframe( {
			type: 'wp-desktop-bridge-publish',
			connectionId: conn.id,
			topic: 'a',
			payload: 1,
		} );
		bridge.routeIncomingFromIframe( {
			type: 'wp-desktop-bridge-publish',
			connectionId: conn.id,
			topic: 'b',
			payload: 2,
		} );
		expect( seen ).toEqual( [ 'a', 'b' ] );
	} );

	test( 'disconnect() fires onClose with reason `disconnect` + tells the iframe', () => {
		const iframe = makeIframe();
		const bridge = createConnectionBridge(
			makeManager( { 'w': { id: 'w', iframe } } ),
		);
		const onClose = vi.fn();
		const conn = bridge.connect( 'w', { onClose } );
		bridge.routeIncomingFromIframe( {
			type: 'wp-desktop-bridge-handshake-ack',
			connectionId: conn.id,
		} );

		conn.disconnect();

		expect( onClose ).toHaveBeenCalledWith( 'disconnect' );
		// Last postMessage was the disconnect signal.
		const last = iframe.contentWindow.postMessage.mock.calls.pop()?.[ 0 ];
		expect( last ).toMatchObject( {
			type: 'wp-desktop-bridge-disconnect',
			connectionId: conn.id,
		} );
	} );

	test( 'onWindowClosed tears down every connection targeting that id', () => {
		const iframe = makeIframe();
		const bridge = createConnectionBridge(
			makeManager( { 'w': { id: 'w', iframe } } ),
		);
		const closeA = vi.fn();
		const closeB = vi.fn();
		const a = bridge.connect( 'w', { onClose: closeA } );
		const b = bridge.connect( 'w', { onClose: closeB } );
		bridge.routeIncomingFromIframe( {
			type: 'wp-desktop-bridge-handshake-ack',
			connectionId: a.id,
		} );
		bridge.routeIncomingFromIframe( {
			type: 'wp-desktop-bridge-handshake-ack',
			connectionId: b.id,
		} );

		bridge.onWindowClosed( 'w' );

		expect( closeA ).toHaveBeenCalledWith( 'window-closed' );
		expect( closeB ).toHaveBeenCalledWith( 'window-closed' );
	} );

	test( 'subscriber that throws does not break the routing path', () => {
		const iframe = makeIframe();
		const bridge = createConnectionBridge(
			makeManager( { 'w': { id: 'w', iframe } } ),
		);
		const conn = bridge.connect( 'w' );
		bridge.routeIncomingFromIframe( {
			type: 'wp-desktop-bridge-handshake-ack',
			connectionId: conn.id,
		} );

		const errSpy = vi.spyOn( console, 'error' ).mockImplementation( () => void 0 );
		const ok = vi.fn();
		conn.subscribe( 't', () => {
			throw new Error( 'boom' );
		} );
		conn.subscribe( 't', ok );

		bridge.routeIncomingFromIframe( {
			type: 'wp-desktop-bridge-publish',
			connectionId: conn.id,
			topic: 't',
			payload: 1,
		} );

		expect( ok ).toHaveBeenCalledTimes( 1 );
		expect( errSpy ).toHaveBeenCalled();
		errSpy.mockRestore();
	} );

	test( 'messages with unknown connectionId are dropped', () => {
		const iframe = makeIframe();
		const bridge = createConnectionBridge(
			makeManager( { 'w': { id: 'w', iframe } } ),
		);
		// Should not throw.
		bridge.routeIncomingFromIframe( {
			type: 'wp-desktop-bridge-publish',
			connectionId: 'never-existed',
			topic: 't',
			payload: 1,
		} );
	} );
} );
