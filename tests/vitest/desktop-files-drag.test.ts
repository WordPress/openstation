import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { installHooksStub, clearHooksStub } from './helpers/hooks-stub';
import { DragManager } from '../../src/drag/manager';
import { __resetRecoveryForTests } from '../../src/drag/recovery';
import { GRID_CELL_H, GRID_PADDING } from '../../src/desktop-files/grid';

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
	x: 100,
	y: 100,
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

function pointerEvent(
	type: string,
	clientX: number,
	clientY: number,
	target: HTMLElement | Document = document,
): PointerEvent {
	const ev = new Event( type, { bubbles: true } );
	Object.defineProperty( ev, 'pointerId', { value: 1 } );
	Object.defineProperty( ev, 'button', { value: 0 } );
	Object.defineProperty( ev, 'clientX', { value: clientX } );
	Object.defineProperty( ev, 'clientY', { value: clientY } );
	if ( target instanceof HTMLElement ) {
		Object.defineProperty( ev, 'target', { value: target } );
	}
	return ev as unknown as PointerEvent;
}

interface Rect { x: number; y: number; w: number; h: number }

function installElementFromPointStub( regions: Array< { el: Element; rect: Rect } > ): void {
	const ordered = [ ...regions ];
	document.elementFromPoint = ( x: number, y: number ): Element | null => {
		for ( let i = ordered.length - 1; i >= 0; i -= 1 ) {
			const { el, rect } = ordered[ i ];
			if (
				x >= rect.x &&
				x < rect.x + rect.w &&
				y >= rect.y &&
				y < rect.y + rect.h
			) {
				return el;
			}
		}
		return null;
	};
}

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

function installManagerOnWindow(): DragManager {
	const manager = new DragManager();
	( window as unknown as { wp: { os: { dragManager: DragManager } } } ).wp = (
		window as unknown as { wp?: { os?: unknown } }
	).wp ?? { hooks: {} };
	const wp = ( window as unknown as { wp: { os?: unknown; hooks?: unknown } } ).wp;
	wp.os = ( wp.os as Record< string, unknown > | undefined ) ?? {};
	( wp.os as { dragManager: DragManager } ).dragManager = manager;
	return manager;
}

describe( 'desktop-files drag (DragManager-backed)', () => {
	beforeEach( () => {
		installHooksStub();
		__resetRecoveryForTests();
		document.elementFromPoint = () => null;
	} );

	afterEach( () => {
		clearHooksStub();
		document.body.innerHTML = '';
		vi.unstubAllGlobals();
	} );

	test( 'super-threshold drag PATCHes the placement with the snapped cell', async () => {
		const { layer, store, rest } = await load();
		store.__resetFilesStoreForTests();
		rest.installRestDeps( { baseUrl: 'https://example.test/files', nonce: 'n' } );
		const fetchSpy = setupRestStub();
		const manager = installManagerOnWindow();
		void manager;

		store.setFolderPlacements( 0, [ placement( 1 ) ] );

		const host = document.createElement( 'div' );
		Object.defineProperty( host, 'clientWidth', { value: 1024, configurable: true } );
		Object.defineProperty( host, 'clientHeight', { value: 768, configurable: true } );
		document.body.appendChild( host );
		const handle = layer.mountFilesLayer( host, 0 );
		const tile = host.querySelector< HTMLElement >( '[data-placement-id="1"]' );
		expect( tile ).not.toBeNull();
		tile!.style.left = '100px';
		tile!.style.top = '100px';
		Object.defineProperty( tile!, 'getBoundingClientRect', {
			value: () => ( {
				left: 100, top: 100, right: 188, bottom: 196,
				width: 88, height: 96, x: 100, y: 100, toJSON: () => ( {} ),
			} ) as DOMRect,
		} );

		Object.defineProperty( host, 'getBoundingClientRect', {
			value: () => ( {
				left: 0, top: 0, right: 1024, bottom: 768,
				width: 1024, height: 768, x: 0, y: 0, toJSON: () => ( {} ),
			} ) as DOMRect,
		} );
		installElementFromPointStub( [ { el: host, rect: { x: 0, y: 0, w: 1024, h: 768 } } ] );

		const container = host.querySelector< HTMLElement >( '.os-files-layer' );
		Object.defineProperty( container!, 'getBoundingClientRect', {
			value: () => ( {
				left: 0, top: 0, right: 1024, bottom: 768,
				width: 1024, height: 768, x: 0, y: 0, toJSON: () => ( {} ),
			} ) as DOMRect,
		} );

		fetchSpy.mockClear();

		tile!.dispatchEvent( pointerEvent( 'pointerdown', 140, 140, tile! ) );
		document.dispatchEvent( pointerEvent( 'pointermove', 310, 220 ) );
		document.dispatchEvent( pointerEvent( 'pointerup', 310, 220 ) );

		await Promise.resolve();
		await Promise.resolve();

		const patches = fetchSpy.mock.calls.filter( ( call ) => {
			const init = call[ 1 ] as RequestInit | undefined;
			return init?.method === 'PATCH' && String( call[ 0 ] ).includes( '/placements/1' );
		} );
		expect( patches.length ).toBeGreaterThanOrEqual( 1 );

		handle.dispose();
	} );

	test( 'pinned tile silently swallows pointerdown — no bump cue, no drag session', async () => {

		const { layer, store, rest } = await load();
		store.__resetFilesStoreForTests();
		rest.installRestDeps( { baseUrl: 'https://example.test/files', nonce: 'n' } );
		setupRestStub();
		const manager = installManagerOnWindow();

		store.setFolderPlacements( 0, [
			placement( 1, { file: { type: 'shortcut', ref: '1', title: 'Pinned', icon: 'dashicons-admin-home', previewUrl: '', exists: true, pinned: true } } ),
		] );

		const host = document.createElement( 'div' );
		Object.defineProperty( host, 'clientWidth', { value: 1024, configurable: true } );
		Object.defineProperty( host, 'clientHeight', { value: 768, configurable: true } );
		document.body.appendChild( host );
		const handle = layer.mountFilesLayer( host, 0 );
		const tile = host.querySelector< HTMLElement >( '[data-placement-id="1"]' );
		expect( tile?.classList.contains( 'os-file-tile--pinned' ) ).toBe( true );

		expect( tile?.hasAttribute( 'aria-disabled' ) ).toBe( false );
		expect( tile?.title ).toBe( '' );

		tile!.dispatchEvent( pointerEvent( 'pointerdown', 50, 50, tile! ) );

		expect( tile?.classList.contains( 'os-file-tile--bump' ) ).toBe( false );
		expect( manager.getActive() ).toBeNull();

		handle.dispose();
	} );

	test( 'drag rolls back optimistic store on REST failure', async () => {
		const { layer, store, rest } = await load();
		store.__resetFilesStoreForTests();
		rest.installRestDeps( { baseUrl: 'https://example.test/files', nonce: 'n' } );

		let firstCallSeen = false;
		const fetchSpy = vi.fn( async ( _url: unknown, init: RequestInit | undefined ) => {
			if ( init?.method === 'PATCH' || firstCallSeen ) {
				firstCallSeen = true;
				return new Response( JSON.stringify( { code: 'fail' } ), { status: 500 } );
			}
			firstCallSeen = true;
			return new Response(
				JSON.stringify( { placements: [], folderId: 0 } ),
				{ status: 200, headers: { 'Content-Type': 'application/json' } },
			);
		} );
		vi.stubGlobal( 'fetch', fetchSpy );
		installManagerOnWindow();

		store.setFolderPlacements( 0, [ placement( 1 ) ] );

		const host = document.createElement( 'div' );
		Object.defineProperty( host, 'clientWidth', { value: 1024, configurable: true } );
		Object.defineProperty( host, 'clientHeight', { value: 768, configurable: true } );
		document.body.appendChild( host );
		Object.defineProperty( host, 'getBoundingClientRect', {
			value: () => ( {
				left: 0, top: 0, right: 1024, bottom: 768,
				width: 1024, height: 768, x: 0, y: 0, toJSON: () => ( {} ),
			} ) as DOMRect,
		} );
		const handle = layer.mountFilesLayer( host, 0 );
		const tile = host.querySelector< HTMLElement >( '[data-placement-id="1"]' );
		const container = host.querySelector< HTMLElement >( '.os-files-layer' );
		Object.defineProperty( container!, 'getBoundingClientRect', {
			value: () => ( {
				left: 0, top: 0, right: 1024, bottom: 768,
				width: 1024, height: 768, x: 0, y: 0, toJSON: () => ( {} ),
			} ) as DOMRect,
		} );
		Object.defineProperty( tile!, 'getBoundingClientRect', {
			value: () => ( {
				left: 100, top: 100, right: 188, bottom: 196,
				width: 88, height: 96, x: 100, y: 100, toJSON: () => ( {} ),
			} ) as DOMRect,
		} );
		installElementFromPointStub( [ { el: host, rect: { x: 0, y: 0, w: 1024, h: 768 } } ] );
		tile!.style.left = '100px';
		tile!.style.top = '100px';

		tile!.dispatchEvent( pointerEvent( 'pointerdown', 140, 140, tile! ) );
		document.dispatchEvent( pointerEvent( 'pointermove', 310, 220 ) );
		document.dispatchEvent( pointerEvent( 'pointerup', 310, 220 ) );

		await new Promise( ( r ) => setTimeout( r, 10 ) );

		expect( document.querySelectorAll( '.os-file-tile--dragging' ).length ).toBe( 0 );
		expect( document.querySelector( '.os-drag-ghost' ) ).toBeNull();

		handle.dispose();
	} );

	test( 'hovering a non-folder tile during a drag flips the chip to reject', async () => {

		const { layer, store, rest } = await load();
		store.__resetFilesStoreForTests();
		rest.installRestDeps( { baseUrl: 'https://example.test/files', nonce: 'n' } );
		setupRestStub();
		const manager = installManagerOnWindow();

		const myWp = placement( 100, {
			file: {
				type: 'shortcut',
				ref: 'desktop-mode-my-wordpress',
				title: 'My WordPress',
				icon: 'dashicons-wordpress',
				previewUrl: '',
				exists: true,
				pinned: true,
			},
		} );
		const iconB = placement( 200, { x: 16, y: 236 } );
		store.setFolderPlacements( 0, [ myWp, iconB ] );

		const host = document.createElement( 'div' );
		Object.defineProperty( host, 'clientWidth', { value: 1024, configurable: true } );
		Object.defineProperty( host, 'clientHeight', { value: 768, configurable: true } );
		document.body.appendChild( host );
		const handle = layer.mountFilesLayer( host, 0 );
		const myWpTile = host.querySelector< HTMLElement >(
			'[data-placement-id="100"]',
		);
		expect( myWpTile ).not.toBeNull();

		const target = manager
			.debug()
			.listTargets()
			.find( ( t ) => t.id === 'os-files-tile-100-reject' );
		expect( target ).toBeDefined();
		expect( target!.element ).toBe( myWpTile );
		expect(
			target!.accept( {
				type: 'desktop-file',
				source: host,
				data: { placement: iconB, sourceFolderId: 0 },
			} ),
		).toBe( false );

		handle.dispose();
	} );

	test( 'recycle-bin tile is NOT reject-claimed — its trash target survives', async () => {

		const { layer, store, rest } = await load();
		store.__resetFilesStoreForTests();
		rest.installRestDeps( { baseUrl: 'https://example.test/files', nonce: 'n' } );
		setupRestStub();
		const manager = installManagerOnWindow();

		const bin = placement( 99, {
			file: {
				type: 'shortcut',
				ref: 'desktop-mode-recycle-bin',
				title: 'Recycle Bin',
				icon: 'dashicons-trash',
				previewUrl: '',
				exists: true,
				pinned: true,
			},
		} );
		store.setFolderPlacements( 0, [ bin ] );

		const host = document.createElement( 'div' );
		Object.defineProperty( host, 'clientWidth', { value: 1024, configurable: true } );
		Object.defineProperty( host, 'clientHeight', { value: 768, configurable: true } );
		document.body.appendChild( host );
		const handle = layer.mountFilesLayer( host, 0 );

		const rejected = manager
			.debug()
			.listTargets()
			.find( ( t ) => t.id === 'os-files-tile-99-reject' );
		expect( rejected ).toBeUndefined();

		handle.dispose();
	} );

	test( 'drop into a column with a pinned tile (My WordPress) skips the pinned cell', async () => {

		const { layer, store, rest } = await load();
		store.__resetFilesStoreForTests();
		rest.installRestDeps( { baseUrl: 'https://example.test/files', nonce: 'n' } );
		const fetchSpy = setupRestStub();
		installManagerOnWindow();

		const myWp = placement( 100, {
			x: 9999,
			y: 9999,
			file: {
				type: 'shortcut',
				ref: 'desktop-mode-my-wordpress',
				title: 'My WordPress',
				icon: 'dashicons-wordpress',
				previewUrl: '',
				exists: true,
				pinned: true,
			},
		} );

		const iconA = placement( 200, { x: 16, y: 236 } );
		const iconB = placement( 201, { x: 16, y: 346 } );
		store.setFolderPlacements( 0, [ myWp, iconA, iconB ] );

		const host = document.createElement( 'div' );
		Object.defineProperty( host, 'clientWidth', { value: 1024, configurable: true } );
		Object.defineProperty( host, 'clientHeight', { value: 768, configurable: true } );
		document.body.appendChild( host );
		Object.defineProperty( host, 'getBoundingClientRect', {
			value: () => ( {
				left: 0, top: 0, right: 1024, bottom: 768,
				width: 1024, height: 768, x: 0, y: 0, toJSON: () => ( {} ),
			} ) as DOMRect,
		} );
		const handle = layer.mountFilesLayer( host, 0 );
		const tileB = host.querySelector< HTMLElement >( '[data-placement-id="201"]' );
		expect( tileB ).not.toBeNull();
		const container = host.querySelector< HTMLElement >( '.os-files-layer' );
		Object.defineProperty( container!, 'getBoundingClientRect', {
			value: () => ( {
				left: 0, top: 0, right: 1024, bottom: 768,
				width: 1024, height: 768, x: 0, y: 0, toJSON: () => ( {} ),
			} ) as DOMRect,
		} );
		Object.defineProperty( tileB!, 'getBoundingClientRect', {
			value: () => ( {
				left: 16, top: 346, right: 104, bottom: 442,
				width: 88, height: 96, x: 16, y: 346, toJSON: () => ( {} ),
			} ) as DOMRect,
		} );
		installElementFromPointStub( [ { el: host, rect: { x: 0, y: 0, w: 1024, h: 768 } } ] );

		fetchSpy.mockClear();

		tileB!.dispatchEvent( pointerEvent( 'pointerdown', 60, 394, tileB! ) );
		document.dispatchEvent( pointerEvent( 'pointermove', 60, 220 ) );

		document.dispatchEvent( pointerEvent( 'pointerup', 60, 174 ) );

		await Promise.resolve();
		await Promise.resolve();

		const patch = fetchSpy.mock.calls.find( ( call ) => {
			const init = call[ 1 ] as RequestInit | undefined;
			return init?.method === 'PATCH' && String( call[ 0 ] ).includes( '/placements/201' );
		} );
		expect( patch ).toBeDefined();
		const body = JSON.parse(
			( patch![ 1 ] as RequestInit ).body as string,
		) as { x: number; y: number; parentId: number };

		expect( body.x ).toBe( GRID_PADDING );
		expect( body.y ).toBe( GRID_PADDING + GRID_CELL_H );

		handle.dispose();
	} );

	test( 'tile drag reads live placement from store, not closure — heartbeat-bumped updatedAtMs is honored', async () => {

		const { layer, store, rest } = await load();
		store.__resetFilesStoreForTests();
		rest.installRestDeps( { baseUrl: 'https://example.test/files', nonce: 'n' } );
		setupRestStub();
		const manager = installManagerOnWindow();

		store.setFolderPlacements( 0, [
			placement( 1 ),
		] );

		const host = document.createElement( 'div' );
		Object.defineProperty( host, 'clientWidth', { value: 1024, configurable: true } );
		Object.defineProperty( host, 'clientHeight', { value: 768, configurable: true } );
		document.body.appendChild( host );
		const handle = layer.mountFilesLayer( host, 0 );
		const tile = host.querySelector< HTMLElement >( '[data-placement-id="1"]' );
		expect( tile ).not.toBeNull();

		store.upsertPlacement(
			{ ...placement( 1 ), updatedAtMs: 9999 },
			'remote',
		);

		expect(
			host.querySelector< HTMLElement >( '[data-placement-id="1"]' ),
		).toBe( tile );

		const startSpy = vi.spyOn( manager, 'start' );

		tile!.dispatchEvent( pointerEvent( 'pointerdown', 50, 50, tile! ) );

		expect( startSpy ).toHaveBeenCalledTimes( 1 );
		const opts = startSpy.mock.calls[ 0 ][ 0 ];
		const data = opts.payload.data as { placement: { updatedAtMs: number } };
		expect( data.placement.updatedAtMs ).toBe( 9999 );

		document.dispatchEvent( pointerEvent( 'pointerup', 50, 50 ) );
		startSpy.mockRestore();
		handle.dispose();
	} );

	test( 'drag-to-reposition keeps tile DOM identity — no full grid rebuild', async () => {

		const { layer, store, rest } = await load();
		store.__resetFilesStoreForTests();
		rest.installRestDeps( { baseUrl: 'https://example.test/files', nonce: 'n' } );
		setupRestStub();
		installManagerOnWindow();

		store.setFolderPlacements( 0, [ placement( 1 ), placement( 2 ) ] );

		const host = document.createElement( 'div' );
		Object.defineProperty( host, 'clientWidth', { value: 1024, configurable: true } );
		Object.defineProperty( host, 'clientHeight', { value: 768, configurable: true } );
		document.body.appendChild( host );
		Object.defineProperty( host, 'getBoundingClientRect', {
			value: () => ( {
				left: 0, top: 0, right: 1024, bottom: 768,
				width: 1024, height: 768, x: 0, y: 0, toJSON: () => ( {} ),
			} ) as DOMRect,
		} );
		const handle = layer.mountFilesLayer( host, 0 );

		const tileBefore = host.querySelector< HTMLElement >( '[data-placement-id="1"]' );
		const peerBefore = host.querySelector< HTMLElement >( '[data-placement-id="2"]' );
		expect( tileBefore ).not.toBeNull();
		expect( peerBefore ).not.toBeNull();

		const container = host.querySelector< HTMLElement >( '.os-files-layer' );
		Object.defineProperty( container!, 'getBoundingClientRect', {
			value: () => ( {
				left: 0, top: 0, right: 1024, bottom: 768,
				width: 1024, height: 768, x: 0, y: 0, toJSON: () => ( {} ),
			} ) as DOMRect,
		} );
		Object.defineProperty( tileBefore!, 'getBoundingClientRect', {
			value: () => ( {
				left: 100, top: 100, right: 188, bottom: 196,
				width: 88, height: 96, x: 100, y: 100, toJSON: () => ( {} ),
			} ) as DOMRect,
		} );
		installElementFromPointStub( [ { el: host, rect: { x: 0, y: 0, w: 1024, h: 768 } } ] );
		tileBefore!.style.left = '100px';
		tileBefore!.style.top = '100px';

		tileBefore!.dispatchEvent( pointerEvent( 'pointerdown', 140, 140, tileBefore! ) );
		document.dispatchEvent( pointerEvent( 'pointermove', 410, 320 ) );
		document.dispatchEvent( pointerEvent( 'pointerup', 410, 320 ) );

		await Promise.resolve();
		await Promise.resolve();

		const tileAfter = host.querySelector< HTMLElement >( '[data-placement-id="1"]' );
		const peerAfter = host.querySelector< HTMLElement >( '[data-placement-id="2"]' );
		expect( tileAfter ).toBe( tileBefore );
		expect( peerAfter ).toBe( peerBefore );

		expect( tileAfter!.style.left ).not.toBe( '100px' );

		handle.dispose();
	} );

	test( 'synthetic dock-promoted placement: drag updates store but issues no PATCH', async () => {

		const { layer, store, rest } = await load();
		store.__resetFilesStoreForTests();
		rest.installRestDeps( { baseUrl: 'https://example.test/files', nonce: 'n' } );
		const fetchSpy = setupRestStub();
		installManagerOnWindow();

		const updateOsSettings = vi.fn();
		const wp = ( window as unknown as { wp: { os: Record< string, unknown > } } ).wp;
		wp.os.getOsSettings = () => ( { dockPromotedPositions: {} } );
		wp.os.updateOsSettings = updateOsSettings;

		store.setFolderPlacements( 0, [
			placement( -42, {
				meta: { __synthFromDockItem: 'edit-php' },
				file: {
					type: 'shortcut',
					ref: 'dock-promoted:edit-php',
					title: 'Posts',
					icon: 'dashicons-admin-post',
					previewUrl: '',
					exists: true,
				},
			} ),
		] );

		const host = document.createElement( 'div' );
		Object.defineProperty( host, 'clientWidth', { value: 1024, configurable: true } );
		Object.defineProperty( host, 'clientHeight', { value: 768, configurable: true } );
		document.body.appendChild( host );
		Object.defineProperty( host, 'getBoundingClientRect', {
			value: () => ( {
				left: 0, top: 0, right: 1024, bottom: 768,
				width: 1024, height: 768, x: 0, y: 0, toJSON: () => ( {} ),
			} ) as DOMRect,
		} );
		const handle = layer.mountFilesLayer( host, 0 );
		const tile = host.querySelector< HTMLElement >( '[data-placement-id="-42"]' );
		expect( tile ).not.toBeNull();
		tile!.style.left = '100px';
		tile!.style.top = '100px';
		Object.defineProperty( tile!, 'getBoundingClientRect', {
			value: () => ( {
				left: 100, top: 100, right: 188, bottom: 196,
				width: 88, height: 96, x: 100, y: 100, toJSON: () => ( {} ),
			} ) as DOMRect,
		} );
		const container = host.querySelector< HTMLElement >( '.os-files-layer' );
		Object.defineProperty( container!, 'getBoundingClientRect', {
			value: () => ( {
				left: 0, top: 0, right: 1024, bottom: 768,
				width: 1024, height: 768, x: 0, y: 0, toJSON: () => ( {} ),
			} ) as DOMRect,
		} );
		installElementFromPointStub( [ { el: host, rect: { x: 0, y: 0, w: 1024, h: 768 } } ] );

		fetchSpy.mockClear();

		tile!.dispatchEvent( pointerEvent( 'pointerdown', 140, 140, tile! ) );
		document.dispatchEvent( pointerEvent( 'pointermove', 310, 220 ) );
		document.dispatchEvent( pointerEvent( 'pointerup', 310, 220 ) );

		await Promise.resolve();
		await Promise.resolve();

		const patches = fetchSpy.mock.calls.filter( ( call ) => {
			const init = call[ 1 ] as RequestInit | undefined;
			return init?.method === 'PATCH';
		} );
		expect( patches.length ).toBe( 0 );

		const updated = store
			.getFilesState()
			.placementsByFolder.get( 0 )
			?.find( ( p ) => p.id === -42 );
		expect( updated ).toBeDefined();
		expect( updated!.x ).not.toBe( 100 );

		expect( updateOsSettings ).toHaveBeenCalledTimes( 1 );
		const patch = updateOsSettings.mock.calls[ 0 ][ 0 ] as {
			dockPromotedPositions: Record< string, { x: number; y: number } >;
		};
		expect( patch.dockPromotedPositions ).toBeDefined();
		expect( patch.dockPromotedPositions[ 'edit-php' ] ).toEqual( {
			x: updated!.x,
			y: updated!.y,
		} );

		handle.dispose();
	} );
} );
