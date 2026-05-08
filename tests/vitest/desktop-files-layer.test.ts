/**
 * Unit tests for the Phase-3 FilesLayer + tile renderer.
 *
 * Tests run against jsdom — the layer DOM and the drag handlers
 * are exercised through synthesized Pointer events. REST is
 * stubbed at the `installRestDeps` boundary.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

type LayerModule = typeof import( '../../src/desktop-files/layer' );
type StoreModule = typeof import( '../../src/desktop-files/store' );
type RestModule = typeof import( '../../src/desktop-files/rest' );

async function load(): Promise< {
	layer: LayerModule;
	store: StoreModule;
	rest: RestModule;
} > {
	vi.resetModules();
	return {
		layer: await import( '../../src/desktop-files/layer' ),
		store: await import( '../../src/desktop-files/store' ),
		rest: await import( '../../src/desktop-files/rest' ),
	};
}

const placement = ( id: number, overrides: Record< string, unknown > = {} ) => ( {
	id,
	parentId: 0,
	x: id * 10,
	y: id * 20,
	sortOrder: 0,
	updatedAtMs: 1,
	meta: null,
	file: {
		type: 'post',
		ref: String( id ),
		title: `Post ${ id }`,
		icon: 'dashicons-admin-post',
		previewUrl: '',
		exists: true,
		...( overrides.file as Record< string, unknown > | undefined ),
	},
	...overrides,
} );

function setupRestStub() {
	const fetchSpy = vi.fn( async () =>
		new Response( JSON.stringify( { placements: [], folderId: 0 } ), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		} ),
	);
	vi.stubGlobal( 'fetch', fetchSpy );
	return fetchSpy;
}

describe( 'FilesLayer', () => {
	beforeEach( () => {
		installHooksStub();
	} );

	afterEach( () => {
		clearHooksStub();
		vi.unstubAllGlobals();
		document.body.innerHTML = '';
	} );

	test( 'mount creates a container with the right class', async () => {
		const { layer, store, rest } = await load();
		store.__resetFilesStoreForTests();
		rest.installRestDeps( { baseUrl: 'https://example.test/files', nonce: 'n' } );
		setupRestStub();

		const host = document.createElement( 'div' );
		document.body.appendChild( host );
		const handle = layer.mountFilesLayer( host, 0 );
		const containers = host.querySelectorAll( '.desktop-mode-files-layer' );
		expect( containers.length ).toBe( 1 );
		expect( containers[ 0 ].getAttribute( 'data-folder-id' ) ).toBe( '0' );
		handle.dispose();
	} );

	test( 'renders one tile per placement when the store is seeded', async () => {
		const { layer, store, rest } = await load();
		store.__resetFilesStoreForTests();
		rest.installRestDeps( { baseUrl: 'https://example.test/files', nonce: 'n' } );
		setupRestStub();
		store.setFolderPlacements( 0, [ placement( 1 ), placement( 2 ) ] );

		const host = document.createElement( 'div' );
		document.body.appendChild( host );
		const handle = layer.mountFilesLayer( host, 0 );
		const tiles = host.querySelectorAll( '.desktop-mode-file-tile' );
		expect( tiles.length ).toBe( 2 );
		const [ first, second ] = tiles;
		expect( first.getAttribute( 'data-placement-id' ) ).toBe( '1' );
		expect( second.getAttribute( 'data-placement-id' ) ).toBe( '2' );
		handle.dispose();
	} );

	test( 'tiles position from x/y', async () => {
		const { layer, store, rest } = await load();
		store.__resetFilesStoreForTests();
		rest.installRestDeps( { baseUrl: 'https://example.test/files', nonce: 'n' } );
		setupRestStub();
		store.setFolderPlacements( 0, [
			{ ...placement( 1 ), x: 100, y: 200 },
		] );

		const host = document.createElement( 'div' );
		document.body.appendChild( host );
		const handle = layer.mountFilesLayer( host, 0 );
		const tile = host.querySelector< HTMLElement >( '.desktop-mode-file-tile' );
		expect( tile?.style.left ).toBe( '100px' );
		expect( tile?.style.top ).toBe( '200px' );
		handle.dispose();
	} );

	test( 'mount calls REST listPlacements when the folder is unhydrated', async () => {
		const { layer, store, rest } = await load();
		store.__resetFilesStoreForTests();
		rest.installRestDeps( { baseUrl: 'https://example.test/files', nonce: 'n' } );
		const fetchSpy = setupRestStub();

		const host = document.createElement( 'div' );
		document.body.appendChild( host );
		const handle = layer.mountFilesLayer( host, 5 );
		// Microtask drain.
		await Promise.resolve();
		await Promise.resolve();
		expect( fetchSpy ).toHaveBeenCalled();
		const url = fetchSpy.mock.calls[ 0 ][ 0 ] as string;
		expect( url ).toContain( '/placements?folder=5' );
		handle.dispose();
	} );

	test( 'mount skips REST hydration when the folder is already in the store', async () => {
		const { layer, store, rest } = await load();
		store.__resetFilesStoreForTests();
		rest.installRestDeps( { baseUrl: 'https://example.test/files', nonce: 'n' } );
		store.setFolderPlacements( 0, [ placement( 1 ) ] );
		const fetchSpy = setupRestStub();

		const host = document.createElement( 'div' );
		document.body.appendChild( host );
		const handle = layer.mountFilesLayer( host, 0 );
		await Promise.resolve();
		expect( fetchSpy ).not.toHaveBeenCalled();
		handle.dispose();
	} );

	test( 'dispose removes the layer container and stops repaints', async () => {
		const { layer, store, rest } = await load();
		store.__resetFilesStoreForTests();
		rest.installRestDeps( { baseUrl: 'https://example.test/files', nonce: 'n' } );
		setupRestStub();

		const host = document.createElement( 'div' );
		document.body.appendChild( host );
		const handle = layer.mountFilesLayer( host, 0 );
		expect( host.querySelector( '.desktop-mode-files-layer' ) ).not.toBeNull();
		handle.dispose();
		expect( host.querySelector( '.desktop-mode-files-layer' ) ).toBeNull();

		// Subsequent store mutation should not touch the host DOM.
		store.setFolderPlacements( 0, [ placement( 99 ) ] );
		expect( host.querySelector( '.desktop-mode-file-tile' ) ).toBeNull();
	} );

	test( 'desktop-mode.files.grid-rendered fires on paint', async () => {
		const { layer, store, rest } = await load();
		store.__resetFilesStoreForTests();
		rest.installRestDeps( { baseUrl: 'https://example.test/files', nonce: 'n' } );
		setupRestStub();
		store.setFolderPlacements( 0, [ placement( 1 ) ] );

		const stub = ( window.wp as { hooks: { didAction: ( n: string ) => number } } ).hooks;
		const host = document.createElement( 'div' );
		document.body.appendChild( host );
		const handle = layer.mountFilesLayer( host, 0 );
		expect( stub.didAction( 'desktop-mode.files.grid-rendered' ) ).toBeGreaterThanOrEqual( 1 );
		handle.dispose();
	} );

	test( 'fingerprint short-circuit avoids rebuilding tiles when nothing changed', async () => {
		const { layer, store, rest } = await load();
		store.__resetFilesStoreForTests();
		rest.installRestDeps( { baseUrl: 'https://example.test/files', nonce: 'n' } );
		setupRestStub();
		store.setFolderPlacements( 0, [ placement( 1 ) ] );

		const host = document.createElement( 'div' );
		document.body.appendChild( host );
		const handle = layer.mountFilesLayer( host, 0 );
		const tile = host.querySelector< HTMLElement >( '.desktop-mode-file-tile' )!;
		// Decorate the tile manually — a plugin would do this on
		// the `tile-rendered` action. The fingerprint cache should
		// preserve our marker across no-op store notifications.
		tile.dataset.testMark = 'x';

		// Re-set the same payload — fingerprint identical.
		store.setFolderPlacements( 0, [ placement( 1 ) ] );
		expect(
			host.querySelector< HTMLElement >( '.desktop-mode-file-tile' )?.dataset.testMark,
		).toBe( 'x' );
		handle.dispose();
	} );
} );
