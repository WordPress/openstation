/**
 * Tests for the content-changes Heartbeat catch-all: handshake
 * semantics, re-broadcast fan-out, high-water-mark advance, and
 * malformed-entry hygiene.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	bootHeartbeatBus,
	_resetHeartbeatBusForTests,
} from '../../src/heartbeat';
import {
	bootContentChangesHeartbeat,
	_resetContentChangesHeartbeatForTests,
} from '../../src/content-changes/heartbeat';
import { subscribe } from '../../src/broadcast';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

interface JQueryHandlers {
	'heartbeat-send'?: ( e: unknown, data: Record< string, unknown > ) => void;
	'heartbeat-tick'?: (
		e: unknown,
		response: Record< string, unknown >,
	) => void;
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

function boot(): JQueryHandlers {
	const handlers = installFakeJQuery();
	bootHeartbeatBus();
	bootContentChangesHeartbeat();
	return handlers;
}

function sentSeenTs( handlers: JQueryHandlers ): unknown {
	const data: Record< string, unknown > = {};
	handlers[ 'heartbeat-send' ]?.( {}, data );
	return data.open_station_content_changes_seen_ts;
}

function tick(
	handlers: JQueryHandlers,
	block: unknown,
): void {
	handlers[ 'heartbeat-tick' ]?.( {}, {
		open_station_content_changes: block,
	} );
}

describe( 'content-changes heartbeat', () => {
	beforeEach( () => {
		installHooksStub();
		_resetHeartbeatBusForTests();
		_resetContentChangesHeartbeatForTests();
		delete ( window as unknown as { jQuery?: unknown } ).jQuery;
	} );

	afterEach( () => {
		clearHooksStub();
		_resetHeartbeatBusForTests();
		_resetContentChangesHeartbeatForTests();
		delete ( window as unknown as { jQuery?: unknown } ).jQuery;
	} );

	test( 'first tick is a handshake: sends 0, adopts server ts, broadcasts nothing', () => {
		const handlers = boot();
		const seen = vi.fn();
		const off = subscribe( '*', seen );

		expect( sentSeenTs( handlers ) ).toBe( 0 );

		tick( handlers, {
			ts: 5000,
			entries: [ { ts: 4000, type: 'post', action: 'updated', ids: [ 7 ] } ],
		} );

		expect( seen ).not.toHaveBeenCalled();
		expect( sentSeenTs( handlers ) ).toBe( 5000 );
		off();
	} );

	test( 'post-handshake entries re-broadcast as os.<type>.changed', () => {
		const handlers = boot();
		tick( handlers, { ts: 1000, entries: [] } );

		const onOrder = vi.fn();
		const off = subscribe( 'os.shop_order.changed', onOrder );

		tick( handlers, {
			ts: 2000,
			entries: [
				{ ts: 2000, type: 'shop_order', action: 'created', ids: [ 42 ] },
			],
		} );

		expect( onOrder ).toHaveBeenCalledTimes( 1 );
		expect( onOrder.mock.calls[ 0 ][ 0 ] ).toEqual( {
			source: 'heartbeat',
			action: 'created',
			ids: [ 42 ],
		} );
		off();
	} );

	test( 'entries at or below the high-water mark are not re-broadcast', () => {
		const handlers = boot();
		tick( handlers, { ts: 1000, entries: [] } );

		const seen = vi.fn();
		const off = subscribe( 'os.post.changed', seen );

		const block = {
			ts: 3000,
			entries: [ { ts: 3000, type: 'post', action: 'updated', ids: [ 1 ] } ],
		};
		tick( handlers, block );
		expect( seen ).toHaveBeenCalledTimes( 1 );

		// The same block on the next tick is stale — seenTs advanced.
		tick( handlers, block );
		expect( seen ).toHaveBeenCalledTimes( 1 );
		expect( sentSeenTs( handlers ) ).toBe( 3000 );
		off();
	} );

	test( 'high-water mark advances from block.ts even with no entries', () => {
		const handlers = boot();
		tick( handlers, { ts: 1000, entries: [] } );
		tick( handlers, { ts: 9000, entries: [] } );
		expect( sentSeenTs( handlers ) ).toBe( 9000 );
	} );

	test( 'malformed entries are skipped without stranding valid ones', () => {
		const handlers = boot();
		tick( handlers, { ts: 1000, entries: [] } );

		const seen = vi.fn();
		const off = subscribe( '*', seen );

		tick( handlers, {
			ts: 2000,
			entries: [
				null,
				{ ts: 2000, type: '', action: 'updated', ids: [ 1 ] },
				{ type: 'post', action: 'updated', ids: [ 1 ] },
				{ ts: 2000, type: 'page', action: '', ids: [ 'x', 3, -1 ] },
			],
		} );

		expect( seen ).toHaveBeenCalledTimes( 1 );
		expect( seen.mock.calls[ 0 ][ 0 ] ).toEqual( {
			source: 'heartbeat',
			action: 'updated',
			ids: [ 3 ],
		} );
		expect( seen.mock.calls[ 0 ][ 1 ] ).toEqual( {
			topic: 'os.page.changed',
		} );
		off();
	} );

	test( 'a malformed block is ignored entirely', () => {
		const handlers = boot();
		tick( handlers, { ts: 1000, entries: [] } );

		const seen = vi.fn();
		const off = subscribe( '*', seen );
		tick( handlers, null );
		tick( handlers, { entries: [ { ts: 2000, type: 'post', ids: [ 1 ] } ] } );
		expect( seen ).not.toHaveBeenCalled();
		expect( sentSeenTs( handlers ) ).toBe( 1000 );
		off();
	} );
} );
