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
			isBridgeEvent( { type: 'desktop-mode-title-change', title: 'X' } ),
		).toBe( true );
		expect( isBridgeEvent( { type: 'desktop-mode-focus' } ) ).toBe( true );
		expect(
			isBridgeEvent( {
				type: 'desktop-mode-bridge-publish',
				connectionId: 'c',
				topic: 't',
				payload: null,
			} ),
		).toBe( true );
	} );

	it( 'rejects non-objects, missing types, and unknown types', () => {
		expect( isBridgeEvent( null ) ).toBe( false );
		expect( isBridgeEvent( undefined ) ).toBe( false );
		expect( isBridgeEvent( 'desktop-mode-focus' ) ).toBe( false );
		expect( isBridgeEvent( {} ) ).toBe( false );
		expect( isBridgeEvent( { type: 12 } ) ).toBe( false );
		expect( isBridgeEvent( { type: 'random-event' } ) ).toBe( false );
	} );

	it( 'isBridgeEventFromIframe / isBridgeEventToIframe accept catalogued types', () => {
		expect(
			isBridgeEventFromIframe( { type: 'desktop-mode-title-change', title: 'a' } ),
		).toBe( true );
		expect( isBridgeEventToIframe( { type: 'desktop-mode-focus' } ) ).toBe( true );
	} );
} );

describe( 'assertBridgeEventType', () => {
	it( 'returns silently when the type matches', () => {
		expect( () =>
			assertBridgeEventType(
				{ type: 'desktop-mode-ready' },
				'desktop-mode-ready',
			),
		).not.toThrow();
	} );

	it( 'throws when the value is not a bridge event', () => {
		expect( () =>
			assertBridgeEventType( null, 'desktop-mode-ready' ),
		).toThrow( /non-bridge value/ );
	} );

	it( 'throws when the type does not match', () => {
		expect( () =>
			assertBridgeEventType(
				{ type: 'desktop-mode-focus' },
				'desktop-mode-ready',
			),
		).toThrow( /expected bridge event "desktop-mode-ready"/ );
	} );
} );
