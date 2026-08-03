/**
 * Unit tests for the challenges shared store
 * (`src/games/challenges-store.ts`) and the main-bundle client
 * (`src/games/challenges-client.ts`): heartbeat wiring, version
 * advancement, and the once-per-session notification policy.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';
import { _resetAllSharedStoresForTests } from '../../src/shared-store';
import type { GameChallengeRow } from '../../src/games/types';

const notifySpy = vi.fn();
const showToastSpy = vi.fn();

vi.mock( '../../src/pwa/notify', () => ( {
	notify: ( ...args: unknown[] ) => notifySpy( ...args ),
} ) );
vi.mock( '../../src/toast', () => ( {
	showToast: ( ...args: unknown[] ) => showToastSpy( ...args ),
} ) );

type Store = typeof import( '../../src/games/challenges-store' );
type Client = typeof import( '../../src/games/challenges-client' );
type Heartbeat = typeof import( '../../src/heartbeat' );

interface JQueryHandlers {
	[ event: string ]: ( ...args: unknown[] ) => void;
}

async function loadModules(): Promise< {
	store: Store;
	client: Client;
	heartbeat: Heartbeat;
} > {
	_resetAllSharedStoresForTests();
	vi.resetModules();
	const heartbeat = await import( '../../src/heartbeat' );
	heartbeat._resetHeartbeatBusForTests();
	return {
		store: await import( '../../src/games/challenges-store' ),
		client: await import( '../../src/games/challenges-client' ),
		heartbeat,
	};
}

function installJQueryStub(): JQueryHandlers {
	const handlers: JQueryHandlers = {};
	( window as unknown as { jQuery: unknown } ).jQuery = () => ( {
		on: ( event: string, handler: ( ...args: unknown[] ) => void ) => {
			handlers[ event ] = handler;
		},
	} );
	return handlers;
}

const makeRow = (
	overrides: Partial< GameChallengeRow > = {},
): GameChallengeRow => ( {
	id: 1,
	game: 'inkfall',
	challengerId: 10,
	challengerName: 'Challenger',
	challengerAvatar: '',
	recipientId: 20,
	recipientName: 'Recipient',
	recipientAvatar: '',
	scoreToBeat: 100,
	scoreMeta: {},
	state: 'pending',
	result: null,
	resultScore: null,
	resultMeta: {},
	createdAtMs: 1000,
	updatedAtMs: 1000,
	...overrides,
} );

describe( 'games/challenges-store.ts', () => {
	beforeEach( () => {
		installHooksStub();
	} );
	afterEach( () => {
		clearHooksStub();
		delete ( window as { jQuery?: unknown } ).jQuery;
	} );

	test( 'ingest upserts rows and advances the version high-water mark', async () => {
		const { store } = await loadModules();
		store.ingestChallenges( [ makeRow( { id: 1, updatedAtMs: 1000 } ) ] );
		store.ingestChallenges( [ makeRow( { id: 2, updatedAtMs: 3000 } ) ] );
		expect( store.challengesState().version ).toBe( 3000 );
		expect( store.allChallenges().map( ( r ) => r.id ) ).toEqual( [ 2, 1 ] );
	} );

	test( 'an updated row replaces the stale copy and notifies', async () => {
		const { store } = await loadModules();
		const listener = vi.fn();
		store.subscribeChallenges( listener );

		store.ingestChallenges( [ makeRow( { id: 1, updatedAtMs: 1000 } ) ] );
		// Same updatedAtMs → no change, no notify.
		store.ingestChallenges( [ makeRow( { id: 1, updatedAtMs: 1000 } ) ] );
		expect( listener ).toHaveBeenCalledTimes( 1 );

		store.ingestChallenges( [
			makeRow( { id: 1, state: 'accepted', updatedAtMs: 2000 } ),
		] );
		expect( listener ).toHaveBeenCalledTimes( 2 );
		expect( store.allChallenges()[ 0 ].state ).toBe( 'accepted' );
	} );
} );

describe( 'games/challenges-client.ts', () => {
	beforeEach( () => {
		installHooksStub();
		notifySpy.mockClear();
		showToastSpy.mockClear();
	} );
	afterEach( () => {
		clearHooksStub();
		delete ( window as { jQuery?: unknown } ).jQuery;
	} );

	test( 'contributes the version and ingests tick payloads', async () => {
		const handlers = installJQueryStub();
		const { store, client, heartbeat } = await loadModules();
		heartbeat.bootHeartbeatBus();
		client.bootGamesChallenges( { currentUserId: 20 } );

		// Outgoing tick carries the store's version.
		const data: Record< string, unknown > = {};
		handlers[ 'heartbeat-send' ]( null, data );
		expect( data.openstation_games_subscribe ).toEqual( {
			challengesVersion: 0,
		} );

		// Incoming tick feeds the store.
		handlers[ 'heartbeat-tick' ]( null, {
			openstation_games: {
				challenges: [ makeRow( { updatedAtMs: 5000 } ) ],
			},
		} );
		expect( store.challengesState().version ).toBe( 5000 );

		const next: Record< string, unknown > = {};
		handlers[ 'heartbeat-send' ]( null, next );
		expect( next.openstation_games_subscribe ).toEqual( {
			challengesVersion: 5000,
		} );
	} );

	test( 'recipient is prompted once per pending challenge', async () => {
		const { store, client } = await loadModules();
		client._resetGamesChallengesPromptsForTests();
		client.bootGamesChallenges( { currentUserId: 20 } );

		store.ingestChallenges( [ makeRow( { id: 7 } ) ] );
		expect( notifySpy ).toHaveBeenCalledTimes( 1 );
		expect( showToastSpy ).toHaveBeenCalledTimes( 1 );
		expect( showToastSpy.mock.calls[ 0 ][ 0 ] ).toMatchObject( {
			persistent: true,
			dismissible: true,
		} );

		// A re-delivery of the same row must not re-prompt.
		store.ingestChallenges( [ makeRow( { id: 7, updatedAtMs: 2000 } ) ] );
		expect( notifySpy ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'a challenge for someone else does not prompt', async () => {
		const { store, client } = await loadModules();
		client._resetGamesChallengesPromptsForTests();
		client.bootGamesChallenges( { currentUserId: 999 } );

		store.ingestChallenges( [ makeRow( { id: 8 } ) ] );
		expect( notifySpy ).not.toHaveBeenCalled();
	} );

	test( 'challenger is notified when the run completes', async () => {
		const { store, client } = await loadModules();
		client._resetGamesChallengesPromptsForTests();
		client.bootGamesChallenges( { currentUserId: 10 } );

		store.ingestChallenges( [
			makeRow( {
				id: 9,
				state: 'completed',
				result: 'beaten',
				resultScore: 150,
				updatedAtMs: 2000,
			} ),
		] );
		expect( notifySpy ).toHaveBeenCalledTimes( 1 );
		const toast = showToastSpy.mock.calls[ 0 ][ 0 ] as { message: string };
		expect( toast.message ).toContain( 'beat your score' );
	} );
} );
