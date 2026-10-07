import {
	BRIDGE_EVENT_TYPES,
	type BridgeEvent,
	type BridgeEventFromIframe,
	type BridgeEventToIframe,
	type BridgeEventType,
} from './window-messages';

interface MessageLike {
	type?: unknown;
}

export function isBridgeEvent( data: unknown ): data is BridgeEvent {
	if ( typeof data !== 'object' || data === null ) {
		return false;
	}
	const t = ( data as MessageLike ).type;
	return typeof t === 'string' && BRIDGE_EVENT_TYPES.has( t as BridgeEventType );
}

export function isBridgeEventFromIframe(
	data: unknown,
): data is BridgeEventFromIframe {
	return isBridgeEvent( data );
}

export function isBridgeEventToIframe(
	data: unknown,
): data is BridgeEventToIframe {
	return isBridgeEvent( data );
}

export function assertBridgeEventType< T extends BridgeEventType >(
	data: unknown,
	expected: T,
): asserts data is Extract< BridgeEvent, { type: T } > {
	if ( ! isBridgeEvent( data ) ) {
		throw new TypeError(
			`[desktop-mode/protocol] expected bridge event "${ expected }", got non-bridge value`,
		);
	}
	if ( data.type !== expected ) {
		throw new TypeError(
			`[desktop-mode/protocol] expected bridge event "${ expected }", got "${ data.type }"`,
		);
	}
}
