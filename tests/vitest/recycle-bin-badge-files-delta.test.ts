/**
 * Regression test — files-on-desktop trash broadcast shape.
 *
 * Trashing a URL placement (or plugin shortcut / folder) MUST emit
 * the cross-window convention payload `{ source, action, ids }` so
 * the dock badge can delta-update synchronously. Before this fix
 * the helper emitted `{ reason: 'trash' }`, which the badge
 * subscriber couldn't decode — the badge then waited up to a full
 * Heartbeat tick (15–60 s) to learn there was a new item in trash.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { installHooksStub, clearHooksStub } from './helpers/hooks-stub';

async function load(): Promise< {
	trash: typeof import( '../../src/desktop-files/trash' );
	store: typeof import( '../../src/desktop-files/store' );
	rest: typeof import( '../../src/desktop-files/rest' );
	bc: typeof import( '../../src/broadcast' );
} > {
	return {
		trash: await import( '../../src/desktop-files/trash' ),
		store: await import( '../../src/desktop-files/store' ),
		rest: await import( '../../src/desktop-files/rest' ),
		bc: await import( '../../src/broadcast' ),
	};
}

function makePlacement( id: number, type = 'link' ) {
	return {
		id,
		parentId: 0,
		x: 0,
		y: 0,
		sortOrder: 0,
		updatedAtMs: 1,
		meta: null,
		file: {
			type,
			ref: 'https://example.com/',
			title: 'example.com',
			icon: 'dashicons-admin-links',
			previewUrl: '',
			exists: true,
		},
	};
}

describe( 'desktop-files trash — broadcast shape', () => {
	beforeEach( async () => {
		installHooksStub();
		// Mount a thin `wp.desktop.broadcast` shim that forwards to
		// the module-level broadcast — production wires this in
		// `desktop.ts` boot, but our test loads the trash helper in
		// isolation. Without it the broadcaster silently no-ops and
		// the bug we're regression-testing is invisible.
		const { bc } = await load();
		const w = window as unknown as { wp?: Record< string, unknown > };
		w.wp = {
			...( w.wp ?? {} ),
			desktop: {
				...( ( w.wp?.desktop as Record< string, unknown > | undefined ) ?? {} ),
				broadcast: bc.broadcast,
			},
		};
	} );

	afterEach( async () => {
		const { store } = await load();
		store.__resetFilesStoreForTests();
		clearHooksStub();
		vi.unstubAllGlobals();
		const w = window as unknown as { wp?: Record< string, unknown > };
		if ( w.wp ) {
			delete w.wp.desktop;
		}
	} );

	test( 'trashPlacementWithUndo broadcasts { action: "trashed", ids } on placement.changed', async () => {
		const { trash, store, rest, bc } = await load();
		store.__resetFilesStoreForTests();
		rest.installRestDeps( { baseUrl: 'https://example.test/files', nonce: 'n' } );

		const fetchSpy = vi.fn( async () =>
			new Response( JSON.stringify( { deleted: true } ), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			} ),
		);
		vi.stubGlobal( 'fetch', fetchSpy );

		const placementSub = vi.fn();
		bc.subscribe( 'desktop-mode.placement.changed', placementSub );

		const p = makePlacement( 42, 'link' );
		store.setFolderPlacements( 0, [ p ] );

		await trash.trashPlacementWithUndo( p );

		expect( placementSub ).toHaveBeenCalledTimes( 1 );
		expect( placementSub ).toHaveBeenCalledWith(
			{
				source: 'desktop-files',
				action: 'trashed',
				ids: [ 42 ],
			},
			expect.objectContaining( { topic: 'desktop-mode.placement.changed' } ),
		);
	} );

	test( 'trashPlacementWithUndo on a shortcut emits on shortcut.changed (not placement.changed)', async () => {
		const { trash, store, rest, bc } = await load();
		store.__resetFilesStoreForTests();
		rest.installRestDeps( { baseUrl: 'https://example.test/files', nonce: 'n' } );

		vi.stubGlobal(
			'fetch',
			vi.fn( async () =>
				new Response( JSON.stringify( { deleted: true } ), {
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				} ),
			),
		);

		const shortcutSub = vi.fn();
		const placementSub = vi.fn();
		bc.subscribe( 'desktop-mode.shortcut.changed', shortcutSub );
		bc.subscribe( 'desktop-mode.placement.changed', placementSub );

		const p = makePlacement( 17, 'shortcut' );
		store.setFolderPlacements( 0, [ p ] );

		await trash.trashPlacementWithUndo( p );

		expect( shortcutSub ).toHaveBeenCalledWith(
			{
				source: 'desktop-files',
				action: 'trashed',
				ids: [ 17 ],
			},
			expect.objectContaining( { topic: 'desktop-mode.shortcut.changed' } ),
		);
		expect( placementSub ).not.toHaveBeenCalled();
	} );

	test( 'trashFolderWithUndo emits on folder.changed with the folder id', async () => {
		const { trash, store, rest, bc } = await load();
		store.__resetFilesStoreForTests();
		rest.installRestDeps( { baseUrl: 'https://example.test/files', nonce: 'n' } );

		vi.stubGlobal(
			'fetch',
			vi.fn( async () =>
				new Response( JSON.stringify( { deleted: true } ), {
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				} ),
			),
		);

		const folderSub = vi.fn();
		bc.subscribe( 'desktop-mode.folder.changed', folderSub );

		const folderPlacement = {
			...makePlacement( 9, 'folder' ),
			file: {
				...makePlacement( 9, 'folder' ).file,
				ref: '5',
				icon: 'dashicons-portfolio',
				title: 'My Folder',
			},
		};
		store.setFolderPlacements( 0, [ folderPlacement ] );

		await trash.trashFolderWithUndo( folderPlacement );

		expect( folderSub ).toHaveBeenCalledWith(
			{
				source: 'desktop-files',
				action: 'trashed',
				ids: [ 5 ],
			},
			expect.objectContaining( { topic: 'desktop-mode.folder.changed' } ),
		);
	} );
} );
