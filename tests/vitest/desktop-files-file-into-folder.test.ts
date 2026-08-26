/**
 * Filing an EXISTING desktop tile into a folder by dropping it on
 * the folder's icon.
 *
 * The reported symptom was an agent tile vanishing: dragged onto a
 * folder, gone from the desktop, and nowhere to be seen inside the
 * folder either. The placement was there the whole time, at the
 * coordinates it had held on the wallpaper — `y: 616`, from low
 * down a tall desktop. No folder window is 616px tall, and the
 * files layer is `position: absolute; inset: 0` with no scroll, so
 * the tile wasn't below a fold; there was no fold. It was
 * unreachable.
 *
 * Two guarantees are pinned here:
 *
 *   1. Filing re-packs into the destination folder, so the tile
 *      lands somewhere a folder window can actually show.
 *   2. A tile already stored out of bounds is reflowed into view on
 *      sight — the rescue for rows written before (1), which is
 *      what makes an existing desktop self-heal rather than needing
 *      a migration.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { installHooksStub, clearHooksStub } from './helpers/hooks-stub';
import { DragManager } from '../../src/drag/manager';
import { __resetRecoveryForTests } from '../../src/drag/recovery';

type Modules = {
	layer: typeof import( '../../src/desktop-files/layer' );
	store: typeof import( '../../src/desktop-files/store' );
	rest: typeof import( '../../src/desktop-files/rest' );
};

async function load(): Promise< Modules > {
	vi.resetModules();
	return {
		layer: await import( '../../src/desktop-files/layer' ),
		store: await import( '../../src/desktop-files/store' ),
		rest: await import( '../../src/desktop-files/rest' ),
	};
}

const folderTilePlacement = ( id: number, ref: string ) => ( {
	id,
	parentId: 0,
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

/** A user (agent) tile sitting near the bottom of a tall desktop. */
const agentPlacement = ( id: number, y: number ) => ( {
	id,
	parentId: 0,
	x: 16,
	y,
	sortOrder: 6,
	updatedAtMs: 1,
	meta: null,
	file: {
		type: 'user',
		ref: '23',
		title: 'SEO Medic',
		icon: 'dashicons-admin-users',
		previewUrl: '',
		exists: true,
		isAgent: true,
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
	const wp =
		( window as unknown as {
			wp?: { hooks?: unknown; os?: Record< string, unknown > };
		} ).wp ?? {};
	wp.os = ( wp.os as Record< string, unknown > | undefined ) ?? {};
	( wp.os as { dragManager: DragManager } ).dragManager = manager;
	( window as unknown as { wp: typeof wp } ).wp = wp;
}

function sized(
	el: HTMLElement,
	width: number,
	height: number,
	left = 0,
	top = 0,
): HTMLElement {
	Object.defineProperty( el, 'clientWidth', {
		value: width,
		configurable: true,
	} );
	Object.defineProperty( el, 'clientHeight', {
		value: height,
		configurable: true,
	} );
	Object.defineProperty( el, 'getBoundingClientRect', {
		value: () =>
			( {
				left,
				top,
				right: left + width,
				bottom: top + height,
				width,
				height,
				x: left,
				y: top,
				toJSON: () => ( {} ),
			} ) as DOMRect,
		configurable: true,
	} );
	return el;
}

describe( 'filing a desktop tile into a folder', () => {
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

	test( 'the move re-packs into the folder instead of keeping desktop coordinates', async () => {
		const { layer, store, rest } = await load();
		store.__resetFilesStoreForTests();
		rest.installRestDeps( {
			baseUrl: 'https://example.test/files',
			nonce: 'n',
		} );

		const patches: Array< Record< string, unknown > > = [];
		const fetchSpy = vi.fn(
			async ( url: unknown, init: RequestInit | undefined ) => {
				if ( init?.method === 'PATCH' ) {
					const body = JSON.parse( init.body as string );
					patches.push( body );
					return new Response(
						JSON.stringify( {
							...agentPlacement( 158, body.y as number ),
							x: body.x,
							parentId: body.parentId,
							updatedAtMs: 2,
						} ),
						{
							status: 200,
							headers: { 'Content-Type': 'application/json' },
						},
					);
				}
				const folderMatch = String( url ).match( /folder=(\d+)/ );
				const folderId = folderMatch
					? parseInt( folderMatch[ 1 ], 10 )
					: 0;
				return new Response(
					JSON.stringify( { placements: [], folderId } ),
					{
						status: 200,
						headers: { 'Content-Type': 'application/json' },
					},
				);
			},
		);
		vi.stubGlobal( 'fetch', fetchSpy );

		const manager = new DragManager();
		installManagerOnWindow( manager );

		// A tall desktop: folder tile up top, agent tile way down.
		store.setFolderPlacements( 0, [
			folderTilePlacement( 1, '19' ),
			agentPlacement( 158, 616 ),
		] );

		const wallpaper = sized(
			document.createElement( 'div' ),
			1200,
			900,
		);
		wallpaper.id = 'os-area';
		document.body.appendChild( wallpaper );
		const wallpaperLayer = layer.mountFilesLayer( wallpaper, 0 );

		const folderTile = wallpaper.querySelector< HTMLElement >(
			'[data-placement-id="1"]',
		);
		const agentTile = wallpaper.querySelector< HTMLElement >(
			'[data-placement-id="158"]',
		);
		expect( folderTile ).not.toBeNull();
		expect( agentTile ).not.toBeNull();
		sized( folderTile!, 88, 96, 100, 100 );
		sized( agentTile!, 88, 96, 16, 616 );

		document.elementFromPoint = ( x, y ) => {
			if ( x >= 100 && x < 188 && y >= 100 && y < 196 ) {
				return folderTile;
			}
			if ( x >= 0 && x < 1200 && y >= 0 && y < 900 ) {
				return wallpaper;
			}
			return null;
		};

		manager.start( {
			payload: {
				type: 'desktop-file',
				source: agentTile!,
				data: {
					placement: store
						.getFilesState()
						.placementsByFolder.get( 0 )!
						.find( ( p ) => p.id === 158 ),
				},
				ghost: { offsetX: 30, offsetY: 30 },
			},
			origin: pointerEvent( 'pointerdown', 60, 660, agentTile! ),
		} );

		document.dispatchEvent( pointerEvent( 'pointermove', 90, 600 ) );
		document.dispatchEvent( pointerEvent( 'pointermove', 140, 140 ) );
		document.dispatchEvent( pointerEvent( 'pointerup', 140, 140 ) );

		await new Promise( ( r ) => setTimeout( r, 20 ) );

		expect( patches.length ).toBe( 1 );
		expect( patches[ 0 ].parentId ).toBe( 19 );
		// The whole point: NOT the 616 it came from. Row-major means
		// the first free cell, which is the folder's top-left.
		expect( patches[ 0 ].y ).toBe( 16 );
		expect( patches[ 0 ].x ).toBe( 16 );

		// The optimistic store entry agrees, so the tile is in a
		// visible cell even before the server answers.
		const filed = store
			.getFilesState()
			.placementsByFolder.get( 19 )
			?.find( ( p ) => p.id === 158 );
		expect( filed?.y ).toBe( 16 );

		wallpaperLayer.dispose();
	} );

	test( 'a tile stored past the bottom edge is reflowed into view', async () => {
		const { layer, store, rest } = await load();
		store.__resetFilesStoreForTests();
		rest.installRestDeps( {
			baseUrl: 'https://example.test/files',
			nonce: 'n',
		} );
		vi.stubGlobal(
			'fetch',
			vi.fn( async () =>
				new Response( JSON.stringify( { placements: [], folderId: 19 } ), {
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				} ),
			),
		);

		// Exactly the row found on the live install: filed into a
		// folder, still carrying its wallpaper `y`.
		store.setFolderPlacements( 19, [
			{ ...agentPlacement( 158, 616 ), parentId: 19 },
		] );

		const folderWindow = document.createElement( 'div' );
		folderWindow.classList.add( 'os-window' );
		const folderHost = sized(
			document.createElement( 'div' ),
			600,
			400,
			200,
			100,
		);
		folderHost.classList.add( 'os-window__body' );
		folderWindow.appendChild( folderHost );
		document.body.appendChild( folderWindow );

		const folderLayer = layer.mountFilesLayer( folderHost, 19 );
		await new Promise( ( r ) => setTimeout( r, 20 ) );

		const tile = folderHost.querySelector< HTMLElement >(
			'[data-placement-id="158"]',
		);
		expect( tile ).not.toBeNull();
		// Reflow is visual only — the stored placement is untouched
		// until the user drags or sorts.
		const top = parseInt( tile!.style.top || '0', 10 );
		expect( top ).toBeLessThan( 400 );
		expect(
			store.getFilesState().placementsByFolder.get( 19 )?.[ 0 ].y,
		).toBe( 616 );

		folderLayer.dispose();
	} );

	test( 'a tile that fits is left exactly where it was put', async () => {
		const { layer, store, rest } = await load();
		store.__resetFilesStoreForTests();
		rest.installRestDeps( {
			baseUrl: 'https://example.test/files',
			nonce: 'n',
		} );
		vi.stubGlobal(
			'fetch',
			vi.fn( async () =>
				new Response( JSON.stringify( { placements: [], folderId: 21 } ), {
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				} ),
			),
		);

		store.setFolderPlacements( 21, [
			{ ...agentPlacement( 200, 126 ), parentId: 21, x: 124 },
		] );

		const folderWindow = document.createElement( 'div' );
		folderWindow.classList.add( 'os-window' );
		const folderHost = sized(
			document.createElement( 'div' ),
			600,
			400,
			200,
			100,
		);
		folderHost.classList.add( 'os-window__body' );
		folderWindow.appendChild( folderHost );
		document.body.appendChild( folderWindow );

		const folderLayer = layer.mountFilesLayer( folderHost, 21 );
		await new Promise( ( r ) => setTimeout( r, 20 ) );

		const tile = folderHost.querySelector< HTMLElement >(
			'[data-placement-id="200"]',
		);
		expect( tile!.style.left ).toBe( '124px' );
		expect( tile!.style.top ).toBe( '126px' );

		folderLayer.dispose();
	} );
} );
