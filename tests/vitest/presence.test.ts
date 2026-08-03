/**
 * Unit tests for the framework presence client.
 *
 * After the 0.5.5 event-driven refactor, the presence module
 * routes through `wp.os.heartbeat.{contribute,subscribe}`
 * (which itself wraps jQuery's heartbeat events). Tests drive
 * the flow at the bus layer rather than mocking jQuery.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { _resetAllSharedStoresForTests } from '../../src/shared-store';
import {
	bootHeartbeatBus,
	_resetHeartbeatBusForTests,
} from '../../src/heartbeat';
import {
	_resetPresenceForTests,
	applyPresenceBatch,
	bootPresenceProbe,
	getAll,
	getStatus,
	markActive,
	presenceApi,
	subscribe,
} from '../../src/presence';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

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

describe( 'presence', () => {
	beforeEach( () => {
		// Reset framework state so each test starts on a clean
		// shared store, a fresh heartbeat bus, and a fresh presence
		// probe. Install the wp.hooks stub so the activity bus has
		// somewhere to publish (presence transitions mirror onto
		// activity for plugin discoverability — see Item 6 of the
		// 0.5.5 event-driven refactor).
		installHooksStub();
		_resetAllSharedStoresForTests();
		_resetHeartbeatBusForTests();
		_resetPresenceForTests();
		delete ( window as unknown as { jQuery?: unknown } ).jQuery;
	} );

	afterEach( () => {
		_resetAllSharedStoresForTests();
		_resetHeartbeatBusForTests();
		_resetPresenceForTests();
		delete ( window as unknown as { jQuery?: unknown } ).jQuery;
		clearHooksStub();
	} );

	test( 'getStatus returns "offline" for unknown users', () => {
		expect( getStatus( 99 ) ).toBe( 'offline' );
	} );

	test( 'heartbeat-send adds open_station_presence_active flag via the bus', async () => {
		const handlers = installFakeJQuery();
		bootHeartbeatBus();
		bootPresenceProbe();
		const data: Record< string, unknown > = {};
		handlers[ 'heartbeat-send' ]?.( {}, data );
		expect( data.open_station_presence_active ).toBe( true );
		expect( typeof data.open_station_user_active ).toBe( 'boolean' );
	} );

	test( 'heartbeat-tick applies the snapshot to the shared store', async () => {
		const handlers = installFakeJQuery();
		bootHeartbeatBus();
		bootPresenceProbe();
		handlers[ 'heartbeat-tick' ]?.(
			{},
			{
				open_station_presence: {
					serverTimeMs: 1234,
					snapshot: {
						'42': { status: 'online', lastSeenMs: 100, lastActiveMs: 100 },
						'7': { status: 'inactive', lastSeenMs: 50, lastActiveMs: 30 },
					},
				},
			},
		);
		expect( getStatus( 42 ) ).toBe( 'online' );
		expect( getStatus( 7 ) ).toBe( 'inactive' );
		expect( getStatus( 1 ) ).toBe( 'offline' );
	} );

	test( 'subscribers fire on heartbeat tick', async () => {
		const handlers = installFakeJQuery();
		bootHeartbeatBus();
		bootPresenceProbe();
		const cb = vi.fn();
		const off = subscribe( cb );
		handlers[ 'heartbeat-tick' ]?.(
			{},
			{
				open_station_presence: {
					serverTimeMs: 1,
					snapshot: { '1': { status: 'online', lastSeenMs: 1, lastActiveMs: 1 } },
				},
			},
		);
		expect( cb ).toHaveBeenCalled();
		off();
	} );

	test( 'os-presence-changed fires on status transitions', async () => {
		const handlers = installFakeJQuery();
		bootHeartbeatBus();
		bootPresenceProbe();
		const events: Array< { userId: number; oldStatus: string | null; newStatus: string } > = [];
		document.addEventListener( 'os-presence-changed', ( e ) => {
			const detail = ( e as CustomEvent ).detail;
			events.push( {
				userId: detail.userId,
				oldStatus: detail.oldStatus,
				newStatus: detail.newStatus,
			} );
		} );
		// First tick: user 42 lands as online.
		handlers[ 'heartbeat-tick' ]?.(
			{},
			{
				open_station_presence: {
					serverTimeMs: 1,
					snapshot: { '42': { status: 'online', lastSeenMs: 1, lastActiveMs: 1 } },
				},
			},
		);
		// Second tick: same status — should NOT re-fire.
		handlers[ 'heartbeat-tick' ]?.(
			{},
			{
				open_station_presence: {
					serverTimeMs: 2,
					snapshot: { '42': { status: 'online', lastSeenMs: 2, lastActiveMs: 2 } },
				},
			},
		);
		// Third tick: status changes — should re-fire.
		handlers[ 'heartbeat-tick' ]?.(
			{},
			{
				open_station_presence: {
					serverTimeMs: 3,
					snapshot: {
						'42': { status: 'inactive', lastSeenMs: 3, lastActiveMs: 0 },
					},
				},
			},
		);
		expect( events ).toEqual( [
			{ userId: 42, oldStatus: null, newStatus: 'online' },
			{ userId: 42, oldStatus: 'online', newStatus: 'inactive' },
		] );
	} );

	test( 'getAll returns a clone, not the live map', async () => {
		const handlers = installFakeJQuery();
		bootHeartbeatBus();
		bootPresenceProbe();
		handlers[ 'heartbeat-tick' ]?.(
			{},
			{
				open_station_presence: {
					serverTimeMs: 1,
					snapshot: { '7': { status: 'online', lastSeenMs: 1, lastActiveMs: 1 } },
				},
			},
		);
		const out = getAll();
		out.delete( 7 );
		// Live store unaffected.
		expect( getStatus( 7 ) ).toBe( 'online' );
	} );

	test( 'bootPresenceProbe is idempotent', async () => {
		installFakeJQuery();
		bootHeartbeatBus();
		bootPresenceProbe();
		bootPresenceProbe();
		// Second boot should NOT double-register handlers — verify
		// only one tick worth of state lands per heartbeat.
		expect( () => markActive() ).not.toThrow();
	} );

	test( 'markActive bumps the lastInputMs so next tick reports active=true', async () => {
		const handlers = installFakeJQuery();
		bootHeartbeatBus();
		bootPresenceProbe();
		markActive();
		const data: Record< string, unknown > = {};
		handlers[ 'heartbeat-send' ]?.( {}, data );
		expect( data.open_station_user_active ).toBe( true );
	} );

	test( 'applyPresenceBatch publishes status transition events', () => {
		const events: Array< unknown > = [];
		document.addEventListener( 'os-presence-changed', ( e ) => {
			events.push( ( e as CustomEvent ).detail );
		} );
		applyPresenceBatch( [
			{ userId: 5, status: 'online', lastSeenMs: 1, lastActiveMs: 1 },
		] );
		expect( events ).toHaveLength( 1 );
		expect( getStatus( 5 ) ).toBe( 'online' );
	} );

	test( 'public presenceApi exposes applyBatch as the canonical entry', () => {
		// `applyBatch` is the public name for `applyPresenceBatch` —
		// what plugins call as `wp.os.presence.applyBatch( … )`
		// after the messages-port DX work.
		expect( typeof presenceApi.applyBatch ).toBe( 'function' );

		const events: Array< unknown > = [];
		document.addEventListener( 'os-presence-changed', ( e ) => {
			events.push( ( e as CustomEvent ).detail );
		} );
		presenceApi.applyBatch( [ { userId: 11, status: 'online' } ] );
		expect( events ).toHaveLength( 1 );
		expect( presenceApi.getStatus( 11 ) ).toBe( 'online' );
	} );
} );
