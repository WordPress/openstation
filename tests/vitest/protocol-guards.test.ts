import { describe, expect, it } from 'vitest';
import {
	assertBridgeEventType,
	isBridgeEvent,
	isBridgeEventFromIframe,
	isBridgeEventToIframe,
} from '../../src/protocol/guards';

describe( 'isBridgeEvent', () => {
	it( 'recognises every catalogued message type', () => {
		expect(
			isBridgeEvent( { type: 'os-title-change', title: 'X' } ),
		).toBe( true );
		expect( isBridgeEvent( { type: 'os-focus' } ) ).toBe( true );
		expect(
			isBridgeEvent( {
				type: 'os-bridge-publish',
				connectionId: 'c',
				topic: 't',
				payload: null,
			} ),
		).toBe( true );
	} );

	it( 'rejects non-objects, missing types, and unknown types', () => {
		expect( isBridgeEvent( null ) ).toBe( false );
		expect( isBridgeEvent( undefined ) ).toBe( false );
		expect( isBridgeEvent( 'os-focus' ) ).toBe( false );
		expect( isBridgeEvent( {} ) ).toBe( false );
		expect( isBridgeEvent( { type: 12 } ) ).toBe( false );
		expect( isBridgeEvent( { type: 'random-event' } ) ).toBe( false );
	} );

	it( 'isBridgeEventFromIframe / isBridgeEventToIframe accept catalogued types', () => {
		expect(
			isBridgeEventFromIframe( { type: 'os-title-change', title: 'a' } ),
		).toBe( true );
		expect( isBridgeEventToIframe( { type: 'os-focus' } ) ).toBe( true );
	} );
} );

describe( 'assertBridgeEventType', () => {
	it( 'returns silently when the type matches', () => {
		expect( () =>
			assertBridgeEventType(
				{ type: 'os-ready' },
				'os-ready',
			),
		).not.toThrow();
	} );

	it( 'throws when the value is not a bridge event', () => {
		expect( () =>
			assertBridgeEventType( null, 'os-ready' ),
		).toThrow( /non-bridge value/ );
	} );

	it( 'throws when the type does not match', () => {
		expect( () =>
			assertBridgeEventType(
				{ type: 'os-focus' },
				'os-ready',
			),
		).toThrow( /expected bridge event "os-ready"/ );
	} );
} );
