/**
 * Unit tests for the Phase-2 store helpers + REST client.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

type StoreModule = typeof import( '../../src/desktop-files/store' );
type RestModule = typeof import( '../../src/desktop-files/rest' );

async function loadStore(): Promise< StoreModule > {
	vi.resetModules();
	return await import( '../../src/desktop-files/store' );
}

async function loadRest(): Promise< RestModule > {
	vi.resetModules();
	return await import( '../../src/desktop-files/rest' );
}

const samplePlacement = ( overrides: Partial< import( '../../src/desktop-files/rest' ).RestPlacementShape > = {} ) => ( {
	id: 1,
	parentId: 0,
	x: 0,
	y: 0,
	sortOrder: 0,
	updatedAtMs: 1,
	meta: null,
	file: {
		type: 'post',
		ref: '42',
		title: 'Hello',
		icon: 'dashicons-admin-post',
		previewUrl: '',
		exists: true,
	},
	...overrides,
} );

describe( 'desktop-files store', () => {
	beforeEach( () => {
		installHooksStub();
	} );

	afterEach( () => {
		clearHooksStub();
	} );

	test( 'setFolderPlacements seeds the folder bucket', async () => {
		const store = await loadStore();
		store.__resetFilesStoreForTests();
		store.setFolderPlacements( 0, [ samplePlacement() ] );
		const state = store.getFilesState();
		expect( state.placementsByFolder.get( 0 )?.length ).toBe( 1 );
		expect( state.hydratedFolders.has( 0 ) ).toBe( true );
	} );

	test( 'upsertPlacement adds to the right folder bucket', async () => {
		const store = await loadStore();
		store.__resetFilesStoreForTests();
		store.upsertPlacement( samplePlacement( { id: 1, parentId: 0 } ) );
		store.upsertPlacement( samplePlacement( { id: 2, parentId: 5 } ) );
		const state = store.getFilesState();
		expect( state.placementsByFolder.get( 0 )?.length ).toBe( 1 );
		expect( state.placementsByFolder.get( 5 )?.length ).toBe( 1 );
	} );

	test( 'upsertPlacement moves a placement when parent changes', async () => {
		const store = await loadStore();
		store.__resetFilesStoreForTests();
		store.upsertPlacement( samplePlacement( { id: 1, parentId: 0 } ) );
		store.upsertPlacement( samplePlacement( { id: 1, parentId: 5 } ) );
		const state = store.getFilesState();
		expect( state.placementsByFolder.get( 0 )?.length ?? 0 ).toBe( 0 );
		expect( state.placementsByFolder.get( 5 )?.length ).toBe( 1 );
	} );

	test( 'removePlacement evicts from every bucket', async () => {
		const store = await loadStore();
		store.__resetFilesStoreForTests();
		store.upsertPlacement( samplePlacement( { id: 1, parentId: 0 } ) );
		store.removePlacement( 1 );
		expect( store.getFilesState().placementsByFolder.get( 0 )?.length ?? 0 ).toBe( 0 );
	} );

	test( 'os-files-changed CustomEvent fires on mutation', async () => {
		const store = await loadStore();
		store.__resetFilesStoreForTests();
		const seen: Array< { kind: string; placementId?: number } > = [];
		const listener = ( e: Event ) => {
			const detail = ( e as CustomEvent< { kind: string; placementId?: number } > ).detail;
			seen.push( detail );
		};
		document.addEventListener( 'os-files-changed', listener );
		store.upsertPlacement( samplePlacement( { id: 1 } ) );
		store.removePlacement( 1 );
		document.removeEventListener( 'os-files-changed', listener );
		expect( seen.map( ( s ) => s.kind ) ).toEqual( [ 'placement-upserted', 'placement-removed' ] );
		expect( seen[ 1 ].placementId ).toBe( 1 );
	} );

	test( 'folder helpers round-trip', async () => {
		const store = await loadStore();
		store.__resetFilesStoreForTests();
		store.upsertFolder( {
			id: 7,
			ownerId: 1,
			name: 'X',
			shareMode: 'private',
			shareMeta: null,
			updatedAtMs: 1,
		} );
		expect( store.getFilesState().folders.get( 7 )?.name ).toBe( 'X' );
		store.removeFolder( 7 );
		expect( store.getFilesState().folders.has( 7 ) ).toBe( false );
	} );
} );

describe( 'desktop-files REST client', () => {
	beforeEach( () => {
		installHooksStub();
	} );

	afterEach( () => {
		clearHooksStub();
		vi.unstubAllGlobals();
	} );

	test( 'listPlacements hits the right URL with the nonce header', async () => {
		const rest = await loadRest();
		rest.installRestDeps( { baseUrl: 'https://example.test/wp-json/desktop-mode/v1/files', nonce: 'abc123' } );

		const fetchSpy = vi.fn( async () =>
			new Response( JSON.stringify( { placements: [], folderId: 0 } ), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			} ),
		);
		vi.stubGlobal( 'fetch', fetchSpy );

		const out = await rest.listPlacements( 0 );
		expect( out.folderId ).toBe( 0 );
		expect( fetchSpy ).toHaveBeenCalledTimes( 1 );
		const init = fetchSpy.mock.calls[ 0 ][ 1 ] as RequestInit;
		const headers = new Headers( init.headers );
		expect( headers.get( 'X-WP-Nonce' ) ).toBe( 'abc123' );
		expect( fetchSpy.mock.calls[ 0 ][ 0 ] ).toContain( '/placements?folder=0' );
	} );

	test( 'createPlacement POSTs JSON body and returns the parsed response', async () => {
		const rest = await loadRest();
		rest.installRestDeps( { baseUrl: 'https://example.test/wp-json/desktop-mode/v1/files', nonce: 'n' } );
		const fetchSpy = vi.fn( async () =>
			new Response( JSON.stringify( samplePlacement( { id: 99 } ) ), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			} ),
		);
		vi.stubGlobal( 'fetch', fetchSpy );
		const result = await rest.createPlacement( { type: 'post', ref: '1' } );
		expect( result.id ).toBe( 99 );
		const init = fetchSpy.mock.calls[ 0 ][ 1 ] as RequestInit;
		expect( init.method ).toBe( 'POST' );
	} );

	test( 'non-2xx responses throw', async () => {
		const rest = await loadRest();
		rest.installRestDeps( { baseUrl: 'https://example.test/wp-json/desktop-mode/v1/files', nonce: 'n' } );
		vi.stubGlobal(
			'fetch',
			vi.fn( async () =>
				new Response( JSON.stringify( { code: 'open_station_files_forbidden', message: 'No.' } ), {
					status: 403,
					headers: { 'Content-Type': 'application/json' },
				} ),
			),
		);
		await expect( rest.createPlacement( { type: 'post', ref: '1' } ) ).rejects.toThrow(
			/open_station_files_forbidden/,
		);
	} );
} );
