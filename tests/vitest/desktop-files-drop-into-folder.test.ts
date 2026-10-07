import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { installHooksStub, clearHooksStub } from './helpers/hooks-stub';
import { DragManager } from '../../src/drag/manager';
import { __resetRecoveryForTests } from '../../src/drag/recovery';

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

const folderPlacement = ( id: number, parentId = 0, ref = '5' ) => ( {
	id,
	parentId,
	x: 100,
	y: 100,
	sortOrder: 0,
	updatedAtMs: 1,
	meta: null,
	file: {
		type: 'folder',
		ref,
		title: `Folder ${ ref }`,
		icon: 'dashicons-category',
		previewUrl: '',
		exists: true,
	},
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

function installManagerOnWindow( manager: DragManager ): void {
	const wp = ( window as unknown as { wp?: { hooks?: unknown; os?: Record< string, unknown > } } ).wp ?? {};
	wp.os = ( wp.os as Record< string, unknown > | undefined ) ?? {};
	( wp.os as { dragManager: DragManager } ).dragManager = manager;
	( window as unknown as { wp: typeof wp } ).wp = wp;
}

describe( 'drop shortcut on folder tile (user regression)', () => {
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

	test( 'drop creates placement that appears when folder is opened', async () => {
		const { layer, store, rest } = await load();
		store.__resetFilesStoreForTests();
		rest.installRestDeps( { baseUrl: 'https://example.test/files', nonce: 'n' } );

		const serverByFolder = new Map< number, Array< Record< string, unknown > > >();
		serverByFolder.set( 0, [ folderPlacement( 1, 0, '5' ) ] );
		let nextPlacementId = 1000;
		const fetchSpy = vi.fn( async ( url: unknown, init: RequestInit | undefined ) => {
			const u = String( url );
			if ( init?.method === 'POST' && u.endsWith( '/placements' ) ) {
				const body = JSON.parse( init.body as string );
				const newPlacement = {
					id: ++nextPlacementId,
					parentId: body.parentId,
					x: body.x,
					y: body.y,
					sortOrder: 0,
					updatedAtMs: Date.now(),
					meta: null,
					file: {
						type: body.type,
						ref: body.ref,
						title: `Item ${ body.ref }`,
						icon: 'dashicons-admin-post',
						previewUrl: '',
						exists: true,
					},
				};
				const bucket = serverByFolder.get( body.parentId ) ?? [];
				bucket.push( newPlacement );
				serverByFolder.set( body.parentId, bucket );
				return new Response( JSON.stringify( newPlacement ), {
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				} );
			}
			const folderMatch = u.match( /folder=(\d+)/ );
			const folderId = folderMatch ? parseInt( folderMatch[ 1 ], 10 ) : 0;
			const placements = serverByFolder.get( folderId ) ?? [];
			return new Response(
				JSON.stringify( { placements, folderId } ),
				{ status: 200, headers: { 'Content-Type': 'application/json' } },
			);
		} );
		vi.stubGlobal( 'fetch', fetchSpy );

		const manager = new DragManager();
		installManagerOnWindow( manager );

		store.setFolderPlacements( 0, [ folderPlacement( 1, 0, '5' ) ] );

		const wallpaper = document.createElement( 'div' );
		wallpaper.id = 'os-area';
		Object.defineProperty( wallpaper, 'clientWidth', { value: 1200, configurable: true } );
		Object.defineProperty( wallpaper, 'clientHeight', { value: 800, configurable: true } );
		Object.defineProperty( wallpaper, 'getBoundingClientRect', {
			value: () => ( {
				left: 0, top: 0, right: 1200, bottom: 800,
				width: 1200, height: 800, x: 0, y: 0, toJSON: () => ( {} ),
			} ) as DOMRect,
		} );
		document.body.appendChild( wallpaper );
		const wallpaperLayer = layer.mountFilesLayer( wallpaper, 0 );

		const folderTile = wallpaper.querySelector< HTMLElement >( '[data-placement-id="1"]' );
		expect( folderTile ).not.toBeNull();
		Object.defineProperty( folderTile!, 'getBoundingClientRect', {
			value: () => ( {
				left: 100, top: 100, right: 188, bottom: 196,
				width: 88, height: 96, x: 100, y: 100, toJSON: () => ( {} ),
			} ) as DOMRect,
		} );

		document.elementFromPoint = ( x, y ) => {
			if ( x >= 100 && x < 188 && y >= 100 && y < 196 ) {
				return folderTile;
			}
			if ( x >= 0 && x < 1200 && y >= 0 && y < 800 ) {
				return wallpaper;
			}
			return null;
		};

		const sourceTile = document.createElement( 'div' );
		sourceTile.className = 'os-my-wordpress__tile';
		document.body.appendChild( sourceTile );

		manager.start( {
			payload: {
				type: 'shortcut',
				source: sourceTile,
				data: {
					kind: 'post',
					ref: '42',
					title: 'My Post',
					icon: 'dashicons-admin-post',
				},
				ghost: { offsetX: 30, offsetY: 30 },
			},
			origin: pointerEvent( 'pointerdown', 200, 200, sourceTile ),
		} );

		document.dispatchEvent( pointerEvent( 'pointermove', 250, 250 ) );
		document.dispatchEvent( pointerEvent( 'pointermove', 140, 140 ) );
		document.dispatchEvent( pointerEvent( 'pointerup', 140, 140 ) );

		await new Promise( ( r ) => setTimeout( r, 20 ) );

		const folderBucket = store.getFilesState().placementsByFolder.get( 5 );
		expect( folderBucket?.length ).toBe( 1 );
		expect( folderBucket?.[ 0 ].file.type ).toBe( 'post' );
		expect( folderBucket?.[ 0 ].file.ref ).toBe( '42' );

		const folderHost = document.createElement( 'div' );
		folderHost.classList.add( 'os-window__body' );

		const folderWindow = document.createElement( 'div' );
		folderWindow.classList.add( 'os-window' );
		folderWindow.appendChild( folderHost );
		document.body.appendChild( folderWindow );
		Object.defineProperty( folderHost, 'clientWidth', { value: 600, configurable: true } );
		Object.defineProperty( folderHost, 'clientHeight', { value: 400, configurable: true } );

		const folderLayer = layer.mountFilesLayer( folderHost, 5 );

		await new Promise( ( r ) => setTimeout( r, 20 ) );

		const folderTiles = folderHost.querySelectorAll( '.os-file-tile' );
		expect( folderTiles.length ).toBe( 1 );

		wallpaperLayer.dispose();
		folderLayer.dispose();
	} );

	test( 'drop INSIDE an open folder window paints a tile immediately', async () => {
		const { layer, store, rest } = await load();
		store.__resetFilesStoreForTests();
		rest.installRestDeps( { baseUrl: 'https://example.test/files', nonce: 'n' } );
		const serverByFolder = new Map< number, Array< Record< string, unknown > > >();
		let nextPlacementId = 2000;
		const fetchSpy = vi.fn( async ( url: unknown, init: RequestInit | undefined ) => {
			const u = String( url );
			if ( init?.method === 'POST' && u.endsWith( '/placements' ) ) {
				const body = JSON.parse( init.body as string );
				const newPlacement = {
					id: ++nextPlacementId,
					parentId: body.parentId,
					x: body.x,
					y: body.y,
					sortOrder: 0,
					updatedAtMs: Date.now(),
					meta: null,
					file: {
						type: body.type,
						ref: body.ref,
						title: `Item ${ body.ref }`,
						icon: 'dashicons-admin-post',
						previewUrl: '',
						exists: true,
					},
				};
				const bucket = serverByFolder.get( body.parentId ) ?? [];
				bucket.push( newPlacement );
				serverByFolder.set( body.parentId, bucket );
				return new Response( JSON.stringify( newPlacement ), {
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				} );
			}
			const folderMatch = u.match( /folder=(\d+)/ );
			const folderId = folderMatch ? parseInt( folderMatch[ 1 ], 10 ) : 0;
			const placements = serverByFolder.get( folderId ) ?? [];
			return new Response(
				JSON.stringify( { placements, folderId } ),
				{ status: 200, headers: { 'Content-Type': 'application/json' } },
			);
		} );
		vi.stubGlobal( 'fetch', fetchSpy );

		const manager = new DragManager();
		installManagerOnWindow( manager );

		const folderWindow = document.createElement( 'div' );
		folderWindow.classList.add( 'os-window' );
		const folderHost = document.createElement( 'div' );
		folderHost.classList.add( 'os-window__body' );
		folderWindow.appendChild( folderHost );
		document.body.appendChild( folderWindow );
		Object.defineProperty( folderHost, 'clientWidth', { value: 600, configurable: true } );
		Object.defineProperty( folderHost, 'clientHeight', { value: 400, configurable: true } );
		Object.defineProperty( folderHost, 'getBoundingClientRect', {
			value: () => ( {
				left: 200, top: 100, right: 800, bottom: 500,
				width: 600, height: 400, x: 200, y: 100, toJSON: () => ( {} ),
			} ) as DOMRect,
		} );
		const folderLayer = layer.mountFilesLayer( folderHost, 7 );

		await new Promise( ( r ) => setTimeout( r, 20 ) );

		const sourceTile = document.createElement( 'div' );
		document.body.appendChild( sourceTile );

		document.elementFromPoint = ( x, y ) => {
			if ( x >= 200 && x < 800 && y >= 100 && y < 500 ) {
				return folderHost;
			}
			return null;
		};

		const container = folderHost.querySelector< HTMLElement >( '.os-files-layer' );
		Object.defineProperty( container!, 'getBoundingClientRect', {
			value: () => ( {
				left: 200, top: 100, right: 800, bottom: 500,
				width: 600, height: 400, x: 200, y: 100, toJSON: () => ( {} ),
			} ) as DOMRect,
		} );

		manager.start( {
			payload: {
				type: 'shortcut',
				source: sourceTile,
				data: {
					kind: 'post',
					ref: '99',
					title: 'Hello',
					icon: 'dashicons-admin-post',
				},
				ghost: { offsetX: 30, offsetY: 30 },
			},
			origin: pointerEvent( 'pointerdown', 0, 0, sourceTile ),
		} );
		document.dispatchEvent( pointerEvent( 'pointermove', 50, 50 ) );
		document.dispatchEvent( pointerEvent( 'pointermove', 400, 250 ) );
		document.dispatchEvent( pointerEvent( 'pointerup', 400, 250 ) );

		await new Promise( ( r ) => setTimeout( r, 20 ) );

		const folderBucket = store.getFilesState().placementsByFolder.get( 7 );
		expect( folderBucket?.length ).toBe( 1 );
		expect( folderBucket?.[ 0 ].file.ref ).toBe( '99' );

		const tilesAfter = folderHost.querySelectorAll( '.os-file-tile' );
		expect( tilesAfter.length ).toBe( 1 );

		folderLayer.dispose();
	} );
} );
