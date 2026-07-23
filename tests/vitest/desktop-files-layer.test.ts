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

	test( 'heartbeat upsert arriving BEFORE REST hydration still surfaces in the open folder', async () => {
		// Corner case: layer mounted on an unhydrated folder, REST
		// listPlacements still in-flight, heartbeat arrives first
		// with a new placement. Both the heartbeat upsert AND the
		// REST hydration must end up reflected in the rendered DOM.
		const { layer, store, rest } = await load();
		store.__resetFilesStoreForTests();
		rest.installRestDeps( { baseUrl: 'https://example.test/files', nonce: 'n' } );

		// REST resolves to a list containing the SAME placement that
		// the heartbeat delivered out-of-band. setFolderPlacements
		// happens after our heartbeat upsert; the final state should
		// reflect REST as the authority but still include the
		// placement.
		let resolveRest: ( v: Response ) => void = () => undefined;
		const fetchSpy = vi.fn(
			() =>
				new Promise< Response >( ( res ) => {
					resolveRest = res;
				} ),
		);
		vi.stubGlobal( 'fetch', fetchSpy );

		const host = document.createElement( 'div' );
		document.body.appendChild( host );
		const handle = layer.mountFilesLayer( host, 9 );

		// Heartbeat upsert arrives first.
		store.upsertPlacement(
			{ ...placement( 100 ), parentId: 9 },
			'remote',
		);

		// Then REST hydration completes.
		resolveRest(
			new Response(
				JSON.stringify( {
					placements: [ { ...placement( 100 ), parentId: 9 } ],
					folderId: 9,
				} ),
				{ status: 200, headers: { 'Content-Type': 'application/json' } },
			),
		);
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();

		const tiles = host.querySelectorAll< HTMLElement >( '.desktop-mode-file-tile' );
		expect( tiles.length ).toBe( 1 );
		expect( tiles[ 0 ].getAttribute( 'data-placement-id' ) ).toBe( '100' );
		handle.dispose();
	} );

	test( 'live upsertPlacement repaints the open folder layer (heartbeat → live update)', async () => {
		// Simulates the user-reported scenario: recipient has the
		// shared folder window open, owner drops a new file inside,
		// the heartbeat brings the placement upsert, and the open
		// layer must paint the new tile WITHOUT a page refresh.
		const { layer, store, rest } = await load();
		store.__resetFilesStoreForTests();
		rest.installRestDeps( { baseUrl: 'https://example.test/files', nonce: 'n' } );
		setupRestStub();

		// Hydrate the shared folder with one initial placement
		// (everything the recipient saw before the owner's add).
		store.setFolderPlacements( 7, [
			{ ...placement( 1 ), parentId: 7 },
		] );

		// Recipient opens the folder window — mount a layer on it.
		const host = document.createElement( 'div' );
		document.body.appendChild( host );
		const handle = layer.mountFilesLayer( host, 7 );
		expect(
			host.querySelectorAll( '.desktop-mode-file-tile' ).length,
		).toBe( 1 );

		// Heartbeat tick: owner just dropped a new link into folder 7.
		// `upsertPlacement` is what `applyDelta` in heartbeat.ts calls
		// for every placement in the payload's `placements` array.
		store.upsertPlacement(
			{ ...placement( 42, { parentId: 7, file: { type: 'link', ref: 'https://example.com/', title: 'example.com', icon: 'dashicons-admin-links', previewUrl: '', exists: true } } ), parentId: 7 },
			'remote',
		);

		// The open layer must have repainted: the new placement's
		// tile should now be in the DOM.
		const tiles = host.querySelectorAll< HTMLElement >( '.desktop-mode-file-tile' );
		expect( tiles.length ).toBe( 2 );
		const ids = Array.from( tiles ).map(
			( t ) => t.getAttribute( 'data-placement-id' ),
		);
		expect( ids ).toContain( '1' );
		expect( ids ).toContain( '42' );
		handle.dispose();
	} );

	test( 'in-place rename repaints the tile label without rebuilding the tile', async () => {
		// The user-reported bug: rename a folder from the tile context
		// menu → the store gets the optimistic title patch, but the
		// position-only fast path (`tryPatchPositions`) reused the
		// tile DOM and never touched the label — the old name stuck
		// around until F5.
		const { layer, store, rest } = await load();
		store.__resetFilesStoreForTests();
		rest.installRestDeps( { baseUrl: 'https://example.test/files', nonce: 'n' } );
		setupRestStub();
		const folderFile = ( title: string ) => ( {
			type: 'folder',
			ref: '7',
			title,
			icon: 'dashicons-category',
			previewUrl: '',
			exists: true,
		} );
		store.setFolderPlacements( 0, [
			placement( 1, { file: folderFile( 'Old name' ) } ),
		] );

		const host = document.createElement( 'div' );
		document.body.appendChild( host );
		const handle = layer.mountFilesLayer( host, 0 );
		const tile = host.querySelector< HTMLElement >( '.desktop-mode-file-tile' )!;
		expect(
			tile.querySelector( '.desktop-mode-file-tile__label' )?.textContent,
		).toBe( 'Old name' );
		// Mark the node so we can prove DOM identity survived — the
		// rename must patch in place, not wholesale-rebuild.
		tile.dataset.testMark = 'kept';

		// Exactly what the rename dialog's onSubmit does before the
		// REST roundtrip resolves.
		store.upsertPlacement( placement( 1, { file: folderFile( 'New name' ) } ) );

		const after = host.querySelector< HTMLElement >( '.desktop-mode-file-tile' )!;
		expect( after.dataset.testMark ).toBe( 'kept' );
		expect( after.getAttribute( 'label' ) ).toBe( 'New name' );
		expect(
			after.querySelector( '.desktop-mode-file-tile__label' )?.textContent,
		).toBe( 'New name' );
		expect( after.getAttribute( 'aria-label' ) ).toBe( 'New name' );
		handle.dispose();
	} );

	test( 'rename arriving together with an add still repaints the label (incremental path)', async () => {
		const { layer, store, rest } = await load();
		store.__resetFilesStoreForTests();
		rest.installRestDeps( { baseUrl: 'https://example.test/files', nonce: 'n' } );
		setupRestStub();
		const folderFile = ( title: string ) => ( {
			type: 'folder',
			ref: '7',
			title,
			icon: 'dashicons-category',
			previewUrl: '',
			exists: true,
		} );
		store.setFolderPlacements( 0, [
			placement( 1, { file: folderFile( 'Old name' ) } ),
		] );

		const host = document.createElement( 'div' );
		document.body.appendChild( host );
		const handle = layer.mountFilesLayer( host, 0 );
		const tile = host.querySelector< HTMLElement >( '.desktop-mode-file-tile' )!;
		tile.dataset.testMark = 'kept';

		// One delta: the folder was renamed AND a sibling was added —
		// tile counts differ, so this exercises `tryPatchIncremental`.
		store.setFolderPlacements( 0, [
			placement( 1, { file: folderFile( 'New name' ) } ),
			placement( 2 ),
		] );

		const renamed = host.querySelector< HTMLElement >(
			'[data-placement-id="1"]',
		)!;
		expect( renamed.dataset.testMark ).toBe( 'kept' );
		expect(
			renamed.querySelector( '.desktop-mode-file-tile__label' )?.textContent,
		).toBe( 'New name' );
		expect(
			host.querySelectorAll( '.desktop-mode-file-tile' ).length,
		).toBe( 2 );
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
