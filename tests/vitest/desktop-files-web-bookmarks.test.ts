import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

type BookmarkModule = typeof import( '../../src/desktop-files/web-bookmarks' );
type StoreModule = typeof import( '../../src/desktop-files/store' );
type RestModule = typeof import( '../../src/desktop-files/rest' );

const placement = ( overrides: Record< string, unknown > = {} ) => ( {
	id: 41,
	parentId: 0,
	x: 16,
	y: 16,
	sortOrder: 0,
	updatedAtMs: 10,
	meta: null,
	file: {
		type: 'embed',
		ref: 'https://example.com/',
		title: 'example.com',
		icon: 'dashicons-welcome-view-site',
		previewUrl: '',
		exists: true,
		url: 'https://example.com/',
	},
	...overrides,
} );

async function load(): Promise< {
	bookmarks: BookmarkModule;
	store: StoreModule;
	rest: RestModule;
} > {
	vi.resetModules();
	return {
		bookmarks: await import( '../../src/desktop-files/web-bookmarks' ),
		store: await import( '../../src/desktop-files/store' ),
		rest: await import( '../../src/desktop-files/rest' ),
	};
}

describe( 'persistent web bookmark creation', () => {
	beforeEach( () => {
		vi.stubGlobal( 'fetch', vi.fn() );
	} );

	afterEach( () => {
		vi.unstubAllGlobals();
	} );

	test( 'creates an embed with the optional custom name', async () => {
		const { bookmarks, store, rest } = await load();
		store.__resetFilesStoreForTests();
		rest.installRestDeps( { baseUrl: 'https://station.test/files', nonce: 'n' } );
		const created = placement( { meta: { name: 'My Example' } } );
		const enriched = placement( {
			meta: { name: 'My Example', iconUrl: 'data:image/png;base64,AA' },
			updatedAtMs: 11,
		} );
		const fetchSpy = vi.mocked( fetch );
		fetchSpy
			.mockResolvedValueOnce( new Response( JSON.stringify( created ), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			} ) )
			.mockResolvedValueOnce( new Response( JSON.stringify( enriched ), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			} ) );

		const result = await bookmarks.createWebBookmark( {
			folderId: 0,
			url: 'example.com',
			x: 16,
			y: 16,
			name: '  My Example  ',
		} );

		expect( result.created ).toBe( true );
		const createBody = JSON.parse( String( fetchSpy.mock.calls[ 0 ][ 1 ]?.body ) );
		expect( createBody ).toMatchObject( {
			type: 'embed',
			ref: 'https://example.com/',
			meta: { name: 'My Example' },
		} );
		expect( String( fetchSpy.mock.calls[ 1 ][ 0 ] ) ).toContain(
			'/placements/41/web-metadata',
		);
	} );

	test( 'paste selects an existing bookmark without moving or erasing metadata', async () => {
		const { bookmarks, store, rest } = await load();
		store.__resetFilesStoreForTests();
		rest.installRestDeps( { baseUrl: 'https://station.test/files', nonce: 'n' } );
		const existing = placement( {
			meta: {
				name: 'Renamed later',
				iconUrl: 'data:image/png;base64,AA',
				window: { x: 9, y: 8, width: 700, height: 500 },
			},
		} );
		store.setFolderPlacements( 0, [ existing ] );

		const result = await bookmarks.createWebBookmark( {
			folderId: 0,
			url: 'https://example.com/',
			x: 112,
			y: 16,
			repositionExisting: false,
		} );

		expect( result ).toEqual( { placement: existing, created: false } );
		expect( fetch ).not.toHaveBeenCalled();
	} );

	test( 'drop repositions an existing bookmark while preserving its metadata', async () => {
		const { bookmarks, store, rest } = await load();
		store.__resetFilesStoreForTests();
		rest.installRestDeps( { baseUrl: 'https://station.test/files', nonce: 'n' } );
		const meta = {
			name: 'Keep me',
			iconUrl: 'data:image/png;base64,AA',
			window: { x: 9, y: 8, width: 700, height: 500 },
		};
		const existing = placement( { meta } );
		const moved = placement( { x: 208, y: 112, meta, updatedAtMs: 12 } );
		store.setFolderPlacements( 0, [ existing ] );
		vi.mocked( fetch ).mockResolvedValueOnce(
			new Response( JSON.stringify( moved ), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			} ),
		);

		const result = await bookmarks.createWebBookmark( {
			folderId: 0,
			url: 'https://example.com/',
			x: 208,
			y: 112,
			repositionExisting: true,
		} );

		expect( result.placement.meta ).toEqual( meta );
		const updateBody = JSON.parse( String( vi.mocked( fetch ).mock.calls[ 0 ][ 1 ]?.body ) );
		expect( updateBody ).toEqual( { x: 208, y: 112 } );
	} );

	test( 'recovers a bookmark saved before a failed create response', async () => {
		const { bookmarks, store, rest } = await load();
		store.__resetFilesStoreForTests();
		rest.installRestDeps( { baseUrl: 'https://station.test/files', nonce: 'n' } );
		const recovered = placement( {
			meta: {
				name: 'Recovered example',
				iconUrl: 'data:image/png;base64,AA',
			},
		} );
		const fetchSpy = vi.mocked( fetch );
		fetchSpy
			.mockResolvedValueOnce( new Response( JSON.stringify( {
				code: 'desktop_mode_files_not_found_after_create',
				message: 'The bookmark was saved but could not be read back.',
			} ), {
				status: 500,
				headers: { 'Content-Type': 'application/json' },
			} ) )
			.mockResolvedValueOnce( new Response( JSON.stringify( {
				placements: [ recovered ],
				folderId: 0,
			} ), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			} ) );

		const result = await bookmarks.createWebBookmark( {
			folderId: 0,
			url: 'example.com',
			x: 16,
			y: 16,
		} );

		expect( result ).toEqual( { placement: recovered, created: true } );
		expect( fetchSpy ).toHaveBeenCalledTimes( 2 );
		expect( String( fetchSpy.mock.calls[ 1 ][ 0 ] ) ).toContain(
			'/placements?folder=0',
		);
		expect(
			store.getFilesState().placementsByFolder.get( 0 ),
		).toEqual( [ recovered ] );
	} );

	test( 'preserves a genuine create error when reconciliation finds nothing', async () => {
		const { bookmarks, store, rest } = await load();
		store.__resetFilesStoreForTests();
		rest.installRestDeps( { baseUrl: 'https://station.test/files', nonce: 'n' } );
		const fetchSpy = vi.mocked( fetch );
		fetchSpy
			.mockResolvedValueOnce( new Response( JSON.stringify( {
				code: 'desktop_mode_files_insert_failed',
				message: 'Failed to write placement.',
			} ), {
				status: 500,
				headers: { 'Content-Type': 'application/json' },
			} ) )
			.mockResolvedValueOnce( new Response( JSON.stringify( {
				placements: [],
				folderId: 0,
			} ), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			} ) );

		await expect( bookmarks.createWebBookmark( {
			folderId: 0,
			url: 'example.com',
			x: 16,
			y: 16,
		} ) ).rejects.toThrow( 'Failed to write placement.' );
		expect( fetchSpy ).toHaveBeenCalledTimes( 2 );
	} );
} );
