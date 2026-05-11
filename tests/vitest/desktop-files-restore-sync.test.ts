/**
 * Restore-from-bin sync tests.
 *
 * The recycle-bin window emits
 * `desktop-mode.{placement,shortcut,folder}.changed` with
 * `action: 'untrashed'` after a successful restore. This module's
 * subscriber must refetch `listFolders()` once and `listPlacements()`
 * for every still-hydrated folder so the local store catches up
 * without waiting for the next Heartbeat tick.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

/**
 * One shared module graph across tests. We deliberately DON'T call
 * `vi.resetModules()` between tests: the broadcast bus attaches
 * listeners to `document`, and `vi.resetModules` would orphan the
 * previous test's listeners (they'd keep firing on every broadcast).
 * `afterEach` calls `__resetFilesRestoreSyncForTests` which
 * unregisters them properly.
 */
async function load(): Promise< {
	rs: typeof import( '../../src/desktop-files/restore-sync' );
	store: typeof import( '../../src/desktop-files/store' );
	rest: typeof import( '../../src/desktop-files/rest' );
	bc: typeof import( '../../src/broadcast' );
} > {
	return {
		rs: await import( '../../src/desktop-files/restore-sync' ),
		store: await import( '../../src/desktop-files/store' ),
		rest: await import( '../../src/desktop-files/rest' ),
		bc: await import( '../../src/broadcast' ),
	};
}

interface MockResponse {
	body: unknown;
}

async function flushMicrotasks(): Promise< void > {
	// `fetch` mock resolves through a JSON parsing chain that needs
	// a few microtask hops to settle. Five drains is plenty for our
	// 2-3-step pipeline (response → .json() → store mutator).
	for ( let i = 0; i < 5; i += 1 ) {
		// eslint-disable-next-line no-await-in-loop
		await Promise.resolve();
	}
}

function fetchSpy( responses: MockResponse[] ): ReturnType< typeof vi.fn > {
	let i = 0;
	return vi.fn( async () => {
		const next = responses[ i ] ?? { body: {} };
		i += 1;
		return new Response( JSON.stringify( next.body ), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		} );
	} );
}

describe( 'files restore-sync', () => {
	beforeEach( () => {
		installHooksStub();
	} );

	afterEach( async () => {
		const { rs, store } = await load();
		rs.__resetFilesRestoreSyncForTests();
		store.__resetFilesStoreForTests();
		clearHooksStub();
		vi.unstubAllGlobals();
	} );

	test( 'untrashed broadcast refetches folders + every hydrated placement folder', async () => {
		const { rs, store, rest, bc } = await load();
		rs.__resetFilesRestoreSyncForTests();
		store.__resetFilesStoreForTests();
		rest.installRestDeps( { baseUrl: 'https://example.test/files', nonce: 'n' } );

		// Two hydrated folders: root + an open sub-folder.
		store.setFolderPlacements( 0, [] );
		store.setFolderPlacements( 5, [] );

		const spy = fetchSpy( [
			{ body: { folders: [] } }, // listFolders
			{ body: { placements: [], folderId: 0 } }, // listPlacements(0)
			{ body: { placements: [], folderId: 5 } }, // listPlacements(5)
		] );
		vi.stubGlobal( 'fetch', spy );

		rs.startFilesRestoreSync();
		bc.broadcast( 'desktop-mode.folder.changed', {
			source: 'recycle-bin',
			action: 'untrashed',
			ids: [ 5 ],
		} );

		await flushMicrotasks();

		// 1 listFolders + 2 listPlacements.
		expect( spy ).toHaveBeenCalledTimes( 3 );
	} );

	test( 'non-untrash actions are ignored', async () => {
		const { rs, store, rest, bc } = await load();
		rs.__resetFilesRestoreSyncForTests();
		store.__resetFilesStoreForTests();
		rest.installRestDeps( { baseUrl: 'https://example.test/files', nonce: 'n' } );
		store.setFolderPlacements( 0, [] );
		const spy = fetchSpy( [] );
		vi.stubGlobal( 'fetch', spy );

		rs.startFilesRestoreSync();
		bc.broadcast( 'desktop-mode.placement.changed', {
			source: 'recycle-bin',
			action: 'trashed',
			ids: [ 1 ],
		} );
		bc.broadcast( 'desktop-mode.placement.changed', {
			source: 'recycle-bin',
			action: 'deleted',
			ids: [ 1 ],
		} );

		await flushMicrotasks();
		expect( spy ).not.toHaveBeenCalled();
	} );

	test( 'restored placement upserts populate the store', async () => {
		const { rs, store, rest, bc } = await load();
		rs.__resetFilesRestoreSyncForTests();
		store.__resetFilesStoreForTests();
		rest.installRestDeps( { baseUrl: 'https://example.test/files', nonce: 'n' } );
		store.setFolderPlacements( 0, [] );

		const restored = {
			id: 42,
			parentId: 0,
			x: 0,
			y: 0,
			sortOrder: 0,
			updatedAtMs: 1000,
			meta: null,
			file: {
				type: 'folder',
				ref: '7',
				title: 'My folder',
				icon: 'dashicons-portfolio',
				previewUrl: '',
				exists: true,
			},
		};
		const folderRow = {
			id: 7,
			ownerId: 1,
			name: 'My folder',
			shareMode: 'private' as const,
			shareMeta: null,
			updatedAtMs: 1000,
		};
		const spy = fetchSpy( [
			{ body: { folders: [ folderRow ] } },
			{ body: { placements: [ restored ], folderId: 0 } },
		] );
		vi.stubGlobal( 'fetch', spy );

		rs.startFilesRestoreSync();
		bc.broadcast( 'desktop-mode.folder.changed', {
			source: 'recycle-bin',
			action: 'untrashed',
			ids: [ 7 ],
		} );

		await flushMicrotasks();

		const state = store.getFilesState();
		expect( state.folders.get( 7 )?.name ).toBe( 'My folder' );
		expect(
			state.placementsByFolder.get( 0 )?.map( ( p ) => p.id ),
		).toEqual( [ 42 ] );
	} );

	test( 'subscribes to placement/shortcut/folder topics', async () => {
		const { rs, store, rest, bc } = await load();
		rs.__resetFilesRestoreSyncForTests();
		store.__resetFilesStoreForTests();
		rest.installRestDeps( { baseUrl: 'https://example.test/files', nonce: 'n' } );
		store.setFolderPlacements( 0, [] );

		const spy = fetchSpy( [
			{ body: { folders: [] } },
			{ body: { placements: [], folderId: 0 } },
			{ body: { folders: [] } },
			{ body: { placements: [], folderId: 0 } },
			{ body: { folders: [] } },
			{ body: { placements: [], folderId: 0 } },
		] );
		vi.stubGlobal( 'fetch', spy );

		rs.startFilesRestoreSync();
		bc.broadcast( 'desktop-mode.placement.changed', {
			source: 'recycle-bin',
			action: 'untrashed',
			ids: [ 1 ],
		} );
		bc.broadcast( 'desktop-mode.shortcut.changed', {
			source: 'recycle-bin',
			action: 'untrashed',
			ids: [ 2 ],
		} );
		bc.broadcast( 'desktop-mode.folder.changed', {
			source: 'recycle-bin',
			action: 'untrashed',
			ids: [ 3 ],
		} );

		await flushMicrotasks();

		// Each broadcast triggers 1 listFolders + 1 listPlacements(0).
		expect( spy ).toHaveBeenCalledTimes( 6 );
	} );
} );
