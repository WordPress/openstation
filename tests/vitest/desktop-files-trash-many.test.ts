/**
 * Tests for `trashManyWithUndo` — trashing a selection as ONE action:
 * one toast, one Undo, one broadcast per kind.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

type TrashModule = typeof import( '../../src/desktop-files/trash' );
type StoreModule = typeof import( '../../src/desktop-files/store' );

const placement = (
	id: number,
	type: 'post' | 'folder' | 'shortcut' = 'post',
	ref = String( id ),
) => ( {
	id,
	parentId: 0,
	x: 0,
	y: 0,
	sortOrder: 0,
	updatedAtMs: 1,
	meta: null,
	file: {
		type,
		ref,
		title: `Item ${ id }`,
		icon: 'dashicons-admin-post',
		previewUrl: '',
		exists: true,
	},
} );

interface Toast {
	message: string;
	action?: { label: string; onClick: () => void };
}

const rest = {
	deletePlacement: vi.fn( async () => undefined ),
	deleteFolder: vi.fn( async () => undefined ),
	restoreTrashedItem: vi.fn( async () => undefined ),
	listPlacements: vi.fn( async () => ( { placements: [], folderId: 0 } ) ),
};

let toasts: Toast[] = [];
let broadcasts: Array< { topic: string; payload: Record< string, unknown > } > = [];

async function load(): Promise< {
	trash: TrashModule;
	store: StoreModule;
} > {
	vi.resetModules();
	toasts = [];
	broadcasts = [];
	for ( const fn of Object.values( rest ) ) {
		fn.mockClear();
	}
	const wp = ( window as unknown as { wp: Record< string, unknown > } ).wp;
	wp.os = {
		showToast: ( t: Toast ) => toasts.push( t ),
		broadcast: ( topic: string, payload: Record< string, unknown > ) =>
			broadcasts.push( { topic, payload } ),
	};
	const store = await import( '../../src/desktop-files/store' );
	store.__resetFilesStoreForTests();
	// `trash.ts` reads REST + the store through `layer-deps`; swapping
	// that one module is the whole seam.
	vi.doMock( '../../src/desktop-files/layer-deps', () => ( {
		rest,
		store: {
			getState: store.getFilesState,
			subscribe: store.subscribeFilesStore,
			setFolderPlacements: store.setFolderPlacements,
			upsertPlacement: store.upsertPlacement,
			upsertFolder: store.upsertFolder,
			removePlacement: store.removePlacement,
			removeFolder: store.removeFolder,
			currentPlacement: store.currentPlacement,
		},
	} ) );
	return { trash: await import( '../../src/desktop-files/trash' ), store };
}

describe( 'trashManyWithUndo', () => {
	beforeEach( () => {
		installHooksStub();
	} );
	afterEach( () => {
		clearHooksStub();
		vi.doUnmock( '../../src/desktop-files/layer-deps' );
		document.body.innerHTML = '';
	} );

	test( 'a single item routes to the per-item helper', async () => {
		const { trash, store } = await load();
		store.setFolderPlacements( 0, [ placement( 1 ) ] as never );
		await trash.trashManyWithUndo( [ placement( 1 ) as never ] );
		expect( rest.deletePlacement ).toHaveBeenCalledTimes( 1 );
		expect( toasts ).toHaveLength( 1 );
		expect( toasts[ 0 ].message ).toContain( '"Item 1" moved to Trash' );
	} );

	test( 'a set produces ONE toast with ONE undo', async () => {
		const { trash, store } = await load();
		const items = [ placement( 1 ), placement( 2 ), placement( 3 ) ];
		store.setFolderPlacements( 0, items as never );
		await trash.trashManyWithUndo( items as never );

		expect( rest.deletePlacement ).toHaveBeenCalledTimes( 3 );
		expect( toasts ).toHaveLength( 1 );
		expect( toasts[ 0 ].message ).toBe( '3 items moved to Trash' );
		// All three are gone from the store, optimistically.
		expect( store.getFilesState().placementsByFolder.get( 0 ) ).toEqual( [] );

		await toasts[ 0 ].action?.onClick();
		expect( rest.restoreTrashedItem ).toHaveBeenCalledTimes( 3 );
	} );

	test( 'folders go through the folder endpoint and broadcast separately', async () => {
		const { trash, store } = await load();
		const items = [ placement( 1, 'post' ), placement( 2, 'folder', '7' ) ];
		store.setFolderPlacements( 0, items as never );
		await trash.trashManyWithUndo( items as never );

		expect( rest.deletePlacement ).toHaveBeenCalledWith( 1 );
		expect( rest.deleteFolder ).toHaveBeenCalledWith( 7 );
		// Subscribers delta by `ids.length`, so a mixed set has to be
		// split by kind rather than flattened into one event.
		const trashed = broadcasts.filter(
			( b ) => b.payload.action === 'trashed',
		);
		expect( trashed.map( ( b ) => b.topic ).sort() ).toEqual( [
			'os.folder.changed',
			'os.placement.changed',
		] );
		expect(
			trashed.find( ( b ) => b.topic === 'os.folder.changed' )?.payload.ids,
		).toEqual( [ 7 ] );
	} );

	test( 'a partial failure still offers Undo for what survived', async () => {
		const { trash, store } = await load();
		rest.deletePlacement.mockImplementationOnce( async () => {
			throw new Error( 'forbidden' );
		} );
		const spy = vi
			.spyOn( console, 'error' )
			.mockImplementation( () => undefined );
		const items = [ placement( 1 ), placement( 2 ) ];
		store.setFolderPlacements( 0, items as never );
		await trash.trashManyWithUndo( items as never );

		expect( toasts ).toHaveLength( 1 );
		expect( toasts[ 0 ].message ).toBe(
			'1 item moved to Trash · 1 could not be moved',
		);
		// The optimistic eviction is reconciled against the server.
		expect( rest.listPlacements ).toHaveBeenCalledWith( 0 );
		spy.mockRestore();
	} );

	test( 'an empty set does nothing at all', async () => {
		const { trash } = await load();
		await trash.trashManyWithUndo( [] );
		expect( rest.deletePlacement ).not.toHaveBeenCalled();
		expect( toasts ).toHaveLength( 0 );
	} );
} );
