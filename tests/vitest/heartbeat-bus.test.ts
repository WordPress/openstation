/**
 * Tests for the cross-feature WordPress Heartbeat bus.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	bootHeartbeatBus,
	heartbeat,
	_resetHeartbeatBusForTests,
} from '../../src/heartbeat';

interface JQueryHandlers {
	'heartbeat-send'?: ( e: unknown, data: Record< string, unknown > ) => void;
	'heartbeat-tick'?: ( e: unknown, response: Record< string, unknown > ) => void;
}

function installFakeJQuery(): JQueryHandlers {
	const handlers: JQueryHandlers = {};
	( window as unknown as { jQuery: unknown } ).jQuery = (
		_: Document,
	): {
		on: ( ev: string, cb: ( ...args: unknown[] ) => void ) => void;
	} => ( {
		on( ev, cb ) {
			( handlers as Record< string, unknown > )[ ev ] = cb as unknown;
		},
	} );
	return handlers;
}

describe( 'heartbeat bus', () => {
	beforeEach( () => {
		_resetHeartbeatBusForTests();
		delete ( window as unknown as { jQuery?: unknown } ).jQuery;
	} );

	afterEach( () => {
		_resetHeartbeatBusForTests();
		delete ( window as unknown as { jQuery?: unknown } ).jQuery;
	} );

	test( 'contribute writes the supplier output to outgoing data', () => {
		const handlers = installFakeJQuery();
		bootHeartbeatBus();
		heartbeat.contribute( 'my-plugin/active', () => true );
		heartbeat.contribute( 'my-plugin/count', () => 7 );
		const data: Record< string, unknown > = {};
		handlers[ 'heartbeat-send' ]?.( {}, data );
		expect( data[ 'my-plugin/active' ] ).toBe( true );
		expect( data[ 'my-plugin/count' ] ).toBe( 7 );
	} );

	test( 'subscribe receives the field on incoming response', () => {
		const handlers = installFakeJQuery();
		bootHeartbeatBus();
		const cb = vi.fn();
		heartbeat.subscribe( 'my-plugin/payload', cb );
		handlers[ 'heartbeat-tick' ]?.(
			{},
			{ 'my-plugin/payload': { hello: 'world' } },
		);
		expect( cb ).toHaveBeenCalledWith( { hello: 'world' } );
	} );

	test( 'subscribe is a no-op when the field is missing on response', () => {
		const handlers = installFakeJQuery();
		bootHeartbeatBus();
		const cb = vi.fn();
		heartbeat.subscribe( 'my-plugin/payload', cb );
		handlers[ 'heartbeat-tick' ]?.( {}, { other: 'thing' } );
		expect( cb ).not.toHaveBeenCalled();
	} );

	test( 'unsubscribe stops further notifications', () => {
		const handlers = installFakeJQuery();
		bootHeartbeatBus();
		const cb = vi.fn();
		const off = heartbeat.subscribe( 'my-plugin/payload', cb );
		off();
		handlers[ 'heartbeat-tick' ]?.( {}, { 'my-plugin/payload': 1 } );
		expect( cb ).not.toHaveBeenCalled();
	} );

	test( 'multiple subscribers compose for the same field', () => {
		const handlers = installFakeJQuery();
		bootHeartbeatBus();
		const a = vi.fn();
		const b = vi.fn();
		heartbeat.subscribe( 'my-plugin/payload', a );
		heartbeat.subscribe( 'my-plugin/payload', b );
		handlers[ 'heartbeat-tick' ]?.( {}, { 'my-plugin/payload': 'hi' } );
		expect( a ).toHaveBeenCalledWith( 'hi' );
		expect( b ).toHaveBeenCalledWith( 'hi' );
	} );

	test( 'a throwing supplier does not strand the rest', () => {
		const handlers = installFakeJQuery();
		bootHeartbeatBus();
		heartbeat.contribute( 'a/throwing', () => {
			throw new Error( 'bad' );
		} );
		heartbeat.contribute( 'a/working', () => 42 );
		const errSpy = vi.spyOn( console, 'error' ).mockImplementation( () => {} );
		const data: Record< string, unknown > = {};
		handlers[ 'heartbeat-send' ]?.( {}, data );
		expect( data[ 'a/working' ] ).toBe( 42 );
		errSpy.mockRestore();
	} );

	test( 'a throwing subscriber does not strand peers', () => {
		const handlers = installFakeJQuery();
		bootHeartbeatBus();
		const survivor = vi.fn();
		heartbeat.subscribe( 'a/payload', () => {
			throw new Error( 'bad' );
		} );
		heartbeat.subscribe( 'a/payload', survivor );
		const errSpy = vi.spyOn( console, 'error' ).mockImplementation( () => {} );
		handlers[ 'heartbeat-tick' ]?.( {}, { 'a/payload': 'x' } );
		expect( survivor ).toHaveBeenCalledWith( 'x' );
		errSpy.mockRestore();
	} );

	test( 'bootHeartbeatBus is idempotent', () => {
		const handlers = installFakeJQuery();
		bootHeartbeatBus();
		const firstSend = handlers[ 'heartbeat-send' ];
		bootHeartbeatBus();
		// Second call should NOT re-bind another handler over the
		// fake jQuery — sanity-check by verifying the same handler
		// reference is still in place.
		expect( handlers[ 'heartbeat-send' ] ).toBe( firstSend );
	} );

	test( 'contribute returns an unsubscribe', () => {
		const handlers = installFakeJQuery();
		bootHeartbeatBus();
		const off = heartbeat.contribute( 'my/field', () => 'present' );
		const data: Record< string, unknown > = {};
		handlers[ 'heartbeat-send' ]?.( {}, data );
		expect( data[ 'my/field' ] ).toBe( 'present' );
		off();
		const data2: Record< string, unknown > = {};
		handlers[ 'heartbeat-send' ]?.( {}, data2 );
		expect( data2[ 'my/field' ] ).toBeUndefined();
	} );
} );
