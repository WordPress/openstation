/**
 * Tests for the unified window-channel bus.
 *
 * These pin the abstraction the framework promises plugin authors:
 * regardless of whether a window is iframe-backed or pure-native,
 * `Window.send( channel, payload )` and `Window.on( channel, cb )`
 * behave identically. The plugin author never has to know the
 * window's rendering strategy.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	addNativeSubscriber,
	addParentSubscriber,
	clearWindowChannels,
	dispatchFromWindow,
	dispatchToNative,
	enqueueWindowSend,
	isWindowContentReady,
	markWindowContentReady,
	_resetWindowChannelsForTests,
} from '../../src/window-channels';

describe( 'window-channel bus', () => {
	beforeEach( () => {
		_resetWindowChannelsForTests();
	} );

	afterEach( () => {
		_resetWindowChannelsForTests();
	} );

	test( 'parent subscriber fires when window publishes', () => {
		const cb = vi.fn();
		const off = addParentSubscriber( 'win-1', 'changed', cb );
		dispatchFromWindow( 'win-1', 'changed', { id: 7 } );
		expect( cb ).toHaveBeenCalledTimes( 1 );
		expect( cb ).toHaveBeenCalledWith(
			{ id: 7 },
			{ channel: 'changed', windowId: 'win-1' },
		);
		off();
	} );

	test( 'parent subscriber is window-id scoped', () => {
		const a = vi.fn();
		const b = vi.fn();
		addParentSubscriber( 'win-1', 'changed', a );
		addParentSubscriber( 'win-2', 'changed', b );
		dispatchFromWindow( 'win-1', 'changed', 'one' );
		expect( a ).toHaveBeenCalledTimes( 1 );
		expect( b ).not.toHaveBeenCalled();
		dispatchFromWindow( 'win-2', 'changed', 'two' );
		expect( a ).toHaveBeenCalledTimes( 1 );
		expect( b ).toHaveBeenCalledWith( 'two', expect.any( Object ) );
	} );

	test( 'wildcard parent subscriber receives every channel for the window', () => {
		const wild = vi.fn();
		addParentSubscriber( 'win-1', '*', wild );
		dispatchFromWindow( 'win-1', 'a', 1 );
		dispatchFromWindow( 'win-1', 'b', 2 );
		dispatchFromWindow( 'win-2', 'a', 99 );
		expect( wild ).toHaveBeenCalledTimes( 2 );
		expect( wild ).toHaveBeenNthCalledWith( 1, 1, { channel: 'a', windowId: 'win-1' } );
		expect( wild ).toHaveBeenNthCalledWith( 2, 2, { channel: 'b', windowId: 'win-1' } );
	} );

	test( 'unsubscribe stops further parent fires', () => {
		const cb = vi.fn();
		const off = addParentSubscriber( 'win-1', 'changed', cb );
		dispatchFromWindow( 'win-1', 'changed', 1 );
		off();
		dispatchFromWindow( 'win-1', 'changed', 2 );
		expect( cb ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'native subscriber fires when parent dispatches to native', () => {
		const cb = vi.fn();
		addNativeSubscriber( 'win-1', 'reload', cb );
		dispatchToNative( 'win-1', 'reload', { force: true } );
		expect( cb ).toHaveBeenCalledWith(
			{ force: true },
			{ channel: 'reload', windowId: 'win-1' },
		);
	} );

	test( 'a throwing parent subscriber does not strand peers', () => {
		const survivor = vi.fn();
		addParentSubscriber( 'win-1', 'changed', () => {
			throw new Error( 'bad' );
		} );
		addParentSubscriber( 'win-1', 'changed', survivor );
		const errSpy = vi.spyOn( console, 'error' ).mockImplementation( () => {} );
		dispatchFromWindow( 'win-1', 'changed', 1 );
		expect( survivor ).toHaveBeenCalledTimes( 1 );
		errSpy.mockRestore();
	} );

	test( 'multiple parent subscribers compose for the same channel', () => {
		const a = vi.fn();
		const b = vi.fn();
		addParentSubscriber( 'win-1', 'changed', a );
		addParentSubscriber( 'win-1', 'changed', b );
		dispatchFromWindow( 'win-1', 'changed', 'x' );
		expect( a ).toHaveBeenCalledWith( 'x', expect.any( Object ) );
		expect( b ).toHaveBeenCalledWith( 'x', expect.any( Object ) );
	} );

	test( 'clearWindowChannels drops every subscriber for that id', () => {
		const a = vi.fn();
		const b = vi.fn();
		addParentSubscriber( 'win-1', 'changed', a );
		addNativeSubscriber( 'win-1', 'reload', b );
		clearWindowChannels( 'win-1' );
		dispatchFromWindow( 'win-1', 'changed', 1 );
		dispatchToNative( 'win-1', 'reload', 1 );
		expect( a ).not.toHaveBeenCalled();
		expect( b ).not.toHaveBeenCalled();
	} );

	test( 'unsubscribe is idempotent', () => {
		const cb = vi.fn();
		const off = addParentSubscriber( 'win-1', 'changed', cb );
		off();
		off();
		dispatchFromWindow( 'win-1', 'changed', 1 );
		expect( cb ).not.toHaveBeenCalled();
	} );

	test( 'pre-load sends queue + flush in FIFO order on markWindowContentReady', () => {
		const calls: Array< { channel: string; payload: unknown } > = [];
		const flushOf = ( channel: string, payload: unknown ) =>
			() => calls.push( { channel, payload } );

		expect( isWindowContentReady( 'win-1' ) ).toBe( false );
		enqueueWindowSend( 'win-1', 'init', { v: 1 }, flushOf( 'init', { v: 1 } ) );
		enqueueWindowSend( 'win-1', 'config', { v: 2 }, flushOf( 'config', { v: 2 } ) );
		enqueueWindowSend( 'win-1', 'go', { v: 3 }, flushOf( 'go', { v: 3 } ) );
		expect( calls ).toEqual( [] );

		markWindowContentReady( 'win-1' );
		expect( calls ).toEqual( [
			{ channel: 'init', payload: { v: 1 } },
			{ channel: 'config', payload: { v: 2 } },
			{ channel: 'go', payload: { v: 3 } },
		] );
		expect( isWindowContentReady( 'win-1' ) ).toBe( true );
	} );

	test( 'markWindowContentReady is idempotent', () => {
		const flush = vi.fn();
		enqueueWindowSend( 'win-1', 'a', null, flush );
		markWindowContentReady( 'win-1' );
		markWindowContentReady( 'win-1' );
		expect( flush ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'sends queued AFTER ready do NOT flush retroactively (caller delivers directly)', () => {
		// `enqueueWindowSend` is the queue-on-not-ready primitive.
		// `Window.send` only enqueues when isWindowContentReady is
		// false. Verify that once ready, the registry no longer
		// holds queued items that fire on subsequent ready signals.
		const flush = vi.fn();
		markWindowContentReady( 'win-1' );
		enqueueWindowSend( 'win-1', 'a', null, flush );
		// We did not call markWindowContentReady again — but it was
		// already ready so the queue stays. This documents that
		// nothing flushes the second-batch automatically.
		expect( flush ).not.toHaveBeenCalled();
	} );

	test( 'clearWindowChannels drops the ready flag + pending queue', () => {
		const flush = vi.fn();
		enqueueWindowSend( 'win-1', 'a', null, flush );
		markWindowContentReady( 'win-1' );
		clearWindowChannels( 'win-1' );
		expect( isWindowContentReady( 'win-1' ) ).toBe( false );
		// Re-queue + re-flush — the previous flush ran exactly once
		// during the ready signal; the post-clear state is fresh.
		enqueueWindowSend( 'win-1', 'b', null, flush );
		markWindowContentReady( 'win-1' );
		expect( flush ).toHaveBeenCalledTimes( 2 );
	} );

	test( 'a throwing flush does not strand later flushes in the queue', () => {
		const a = vi.fn().mockImplementation( () => {
			throw new Error( 'boom' );
		} );
		const b = vi.fn();
		enqueueWindowSend( 'win-1', 'a', null, a );
		enqueueWindowSend( 'win-1', 'b', null, b );
		const errSpy = vi.spyOn( console, 'error' ).mockImplementation( () => {} );
		markWindowContentReady( 'win-1' );
		expect( a ).toHaveBeenCalled();
		expect( b ).toHaveBeenCalled();
		errSpy.mockRestore();
	} );
} );
