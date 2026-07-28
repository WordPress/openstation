/**
 * Type guards for the bridge protocol.
 *
 * Intended to replace the ~20 inline `data?.type === 'desktop-mode-*'`
 * checks spread across the iframe bridge, the connection bridge,
 * the commands harvester, the recycle-bin realtime channel, the
 * drag-bridge, and the various extension consumers. Adoption is
 * incremental — most consumers still hand-check the literals; new
 * code should import a guard from `@protocol/guards`, which gives it:
 *
 *   - Single source of truth for the message-type string set.
 *   - Narrowed unknown → BridgeEvent so the calling code drops a
 *     pile of `as Bridge…` casts.
 *   - One assertion path (`assertBridgeEventType`) for handlers
 *     that demand a specific variant.
 */

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

/** True if the value is a `desktop-mode-*` bridge message of any direction. */
export function isBridgeEvent( data: unknown ): data is BridgeEvent {
	if ( typeof data !== 'object' || data === null ) {
		return false;
	}
	const t = ( data as MessageLike ).type;
	return typeof t === 'string' && BRIDGE_EVENT_TYPES.has( t as BridgeEventType );
}

/**
 * True if the value is a bridge message in the iframe→parent
 * direction. The boundary checks the `type` against the union but
 * cannot disambiguate iframe→parent from parent→iframe variants
 * that share a name (`desktop-mode-bridge-publish` /
 * `desktop-mode-bridge-disconnect`); those names appear in both
 * directions and are treated as iframe→parent here for safety —
 * routing logic sits in the shell which owns the disambiguation
 * via posting source.
 */
export function isBridgeEventFromIframe(
	data: unknown,
): data is BridgeEventFromIframe {
	return isBridgeEvent( data );
}

/** Same caveat as {@link isBridgeEventFromIframe} but in reverse. */
export function isBridgeEventToIframe(
	data: unknown,
): data is BridgeEventToIframe {
	return isBridgeEvent( data );
}

/**
 * Narrowing assertion for handlers that expect a specific bridge
 * variant. Throws (with a stable message format) if the value is
 * not the expected message — caller catches or lets it propagate.
 */
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
