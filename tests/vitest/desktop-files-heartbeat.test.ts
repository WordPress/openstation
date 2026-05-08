/**
 * Phase-6 JS-side Heartbeat sync tests.
 *
 * The contributor / subscriber wiring goes through the framework
 * heartbeat bus; we hijack `heartbeat.subscribe` to capture the
 * registered callback and invoke it directly, sidestepping the
 * jQuery-based dispatch path.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

async function load(): Promise< {
	hb: typeof import( '../../src/desktop-files/heartbeat' );
	store: typeof import( '../../src/desktop-files/store' );
	rest: typeof import( '../../src/desktop-files/rest' );
	bus: typeof import( '../../src/heartbeat' );
} > {
	vi.resetModules();
	return {
		hb: await import( '../../src/desktop-files/heartbeat' ),
		store: await import( '../../src/desktop-files/store' ),
		rest: await import( '../../src/desktop-files/rest' ),
		bus: await import( '../../src/heartbeat' ),
	};
}

const placement = ( id: number, parentId = 0 ) => ( {
	id,
	parentId,
	x: 0,
	y: 0,
	sortOrder: 0,
	updatedAtMs: id * 100,
	meta: null,
	file: {
		type: 'post',
		ref: String( id ),
		title: `Post ${ id }`,
		icon: 'dashicons-admin-post',
		previewUrl: '',
		exists: true,
	},
} );

const folder = ( id: number, updatedAtMs = 100 ) => ( {
	id,
	ownerId: 1,
	name: `Folder ${ id }`,
	shareMode: 'private' as const,
	shareMeta: null,
	updatedAtMs,
} );

interface CapturedHandler {
	contribute?: () => unknown;
	subscribe?: ( payload: unknown ) => void;
}

function captureBusHandlers( bus: { heartbeat: { contribute: ( ...a: unknown[] ) => unknown; subscribe: ( ...a: unknown[] ) => unknown } } ): CapturedHandler {
	const handlers: CapturedHandler = {};
	const origContribute = bus.heartbeat.contribute;
	const origSubscribe = bus.heartbeat.subscribe;
	bus.heartbeat.contribute = ( field: string, supplier: () => unknown ) => {
		if ( field === 'desktop_mode_files_subscribe' ) {
			handlers.contribute = supplier;
		}
		return origContribute.call( bus.heartbeat, field, supplier );
	};
	bus.heartbeat.subscribe = ( field: string, cb: ( payload: unknown ) => void ) => {
		if ( field === 'desktop_mode_files' ) {
			handlers.subscribe = cb;
		}
		return origSubscribe.call( bus.heartbeat, field, cb );
	};
	return handlers;
}

describe( 'files Heartbeat sync', () => {
	beforeEach( () => {
		installHooksStub();
	} );

	afterEach( () => {
		clearHooksStub();
		vi.unstubAllGlobals();
	} );

	test( 'contribute supplies a versions block keyed by stored folders', async () => {
		const { hb, store, bus } = await load();
		hb.__resetFilesHeartbeatForTests();
		store.__resetFilesStoreForTests();
		store.upsertFolder( folder( 5, 999 ) );
		const handlers = captureBusHandlers( bus as never );
		hb.startFilesHeartbeat();
		const block = handlers.contribute!() as { folderVersions: Record< string, number > };
		expect( block.folderVersions[ '5' ] ).toBe( 999 );
	} );

	test( 'subscribed delta upserts folders + placements + applies removals', async () => {
		const { hb, store, bus } = await load();
		hb.__resetFilesHeartbeatForTests();
		store.__resetFilesStoreForTests();
		store.upsertPlacement( placement( 7, 0 ) );
		const handlers = captureBusHandlers( bus as never );
		hb.startFilesHeartbeat();

		handlers.subscribe!( {
			placements: [ placement( 1 ), placement( 2 ) ],
			folders: [ folder( 5, 200 ) ],
			removed: { placements: [ 7 ], folders: [] },
			serverTimeMs: 200,
		} );

		const state = store.getFilesState();
		expect( state.folders.get( 5 )?.name ).toBe( 'Folder 5' );
		expect(
			state.placementsByFolder.get( 0 )?.map( ( p ) => p.id ).sort(),
		).toEqual( [ 1, 2 ] );
	} );

	test( 'truncated triggers REST resync of every hydrated folder', async () => {
		const { hb, store, bus, rest } = await load();
		hb.__resetFilesHeartbeatForTests();
		store.__resetFilesStoreForTests();
		rest.installRestDeps( { baseUrl: 'https://example.test/files', nonce: 'n' } );
		const fetchSpy = vi.fn( async () =>
			new Response( JSON.stringify( { placements: [], folderId: 0 } ), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			} ),
		);
		vi.stubGlobal( 'fetch', fetchSpy );

		store.setFolderPlacements( 0, [] );
		store.setFolderPlacements( 5, [] );

		const handlers = captureBusHandlers( bus as never );
		hb.startFilesHeartbeat();
		handlers.subscribe!( {
			placements: [],
			folders: [],
			removed: { placements: [], folders: [] },
			serverTimeMs: 1,
			truncated: true,
		} );
		await Promise.resolve();
		expect( fetchSpy ).toHaveBeenCalledTimes( 2 );
	} );
} );
