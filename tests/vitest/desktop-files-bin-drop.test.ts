/**
 * Regression test for the recycle-bin DOCK ICON drop flow.
 *
 * The user reports: "Still not able to drop anything in the recycle
 * bin ICON, it reacts, but when releasing the button is not trashed."
 *
 * This test installs the bin drop targets the same way `desktop.ts`
 * does (via `installRecycleBinDropTargets( dragManager )`), simulates
 * a desktop-file drag onto a faked dock icon element, and verifies
 * (a) the icon onEnter highlight, (b) the onDrop firing, and (c) the
 * REST DELETE issued for the placement id.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { installHooksStub, clearHooksStub } from './helpers/hooks-stub';
import { DragManager } from '../../src/drag/manager';
import { __resetRecoveryForTests } from '../../src/drag/recovery';
import { HOOKS } from '../../src/hooks';

type StoreModule = typeof import( '../../src/desktop-files/store' );
type RestModule = typeof import( '../../src/desktop-files/rest' );
type BinTargetsModule = typeof import( '../../src/desktop-files/recycle-bin-targets' );

// We do NOT call `vi.resetModules()` here because `trash.ts` imports
// `rest` via `layer-deps`, and a reset would split the module graph
// (the trash code would see an un-installed REST while the test set
// up deps on a different `rest` instance). Sharing one module graph
// keeps the `rest.installRestDeps` call visible to both.
async function load(): Promise< {
	store: StoreModule;
	rest: RestModule;
	binTargets: BinTargetsModule;
} > {
	return {
		store: await import( '../../src/desktop-files/store' ),
		rest: await import( '../../src/desktop-files/rest' ),
		binTargets: await import( '../../src/desktop-files/recycle-bin-targets' ),
	};
}

const placement = ( id: number, type = 'post' ) => ( {
	id,
	parentId: 0,
	x: 100,
	y: 100,
	sortOrder: 0,
	updatedAtMs: 1,
	meta: null,
	file: {
		type,
		ref: String( id ),
		title: `Item ${ id }`,
		icon: 'dashicons-admin-post',
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

describe( 'recycle-bin dock icon drop (user regression)', () => {
	beforeEach( async () => {
		installHooksStub();
		__resetRecoveryForTests();
		const mod = await import( '../../src/desktop-files/recycle-bin-targets' );
		mod.__resetRecycleBinDropTargetsForTests();
	} );

	afterEach( () => {
		clearHooksStub();
		document.body.innerHTML = '';
		vi.unstubAllGlobals();
	} );

	test( 'dropping a desktop-file on the bin dock icon issues REST DELETE', async () => {
		const { store, rest, binTargets } = await load();
		store.__resetFilesStoreForTests();
		rest.installRestDeps( { baseUrl: 'https://example.test/files', nonce: 'n' } );

		const fetchSpy = vi.fn( async () =>
			new Response(
				JSON.stringify( { deleted: true } ),
				{ status: 200, headers: { 'Content-Type': 'application/json' } },
			),
		);
		vi.stubGlobal( 'fetch', fetchSpy );

		// 1. Mount the manager + install bin drop targets.
		const manager = new DragManager();
		installManagerOnWindow( manager );

		// 2. Build a fake dock icon BEFORE installing — the installer's
		//    initial probe should pick it up.
		const dockTile = document.createElement( 'div' );
		dockTile.classList.add(
			'os-dock__item',
			'os-dock__item--system',
		);
		dockTile.dataset.systemId = 'desktop-mode-recycle-bin';
		const innerBtn = document.createElement( 'button' );
		innerBtn.classList.add( 'os-dock__item-primary' );
		dockTile.appendChild( innerBtn );
		document.body.appendChild( dockTile );

		binTargets.installRecycleBinDropTargets( manager );

		// Verify the bin target is now in the registry.
		const targets = manager.debug().listTargets();
		expect( targets.find( ( t ) => t.id === 'recycle-bin-dock' ) ).toBeDefined();

		// 3. Seed a placement in the store. The user's drag-out will
		//    point at this object via session.payload.data.placement.
		const p = placement( 7, 'link' );
		store.setFolderPlacements( 0, [ p ] );

		// 4. Build a desktop file tile to act as the source.
		const sourceTile = document.createElement( 'div' );
		sourceTile.className = 'os-file-tile';
		document.body.appendChild( sourceTile );

		// 5. Hit-test stub: returns the bin tile inner element when
		//    the cursor is at (300, 300).
		document.elementFromPoint = ( x, y ) => {
			if ( x >= 280 && x < 340 && y >= 280 && y < 340 ) {
				return innerBtn;
			}
			return null;
		};

		// 6. Start a desktop-file drag from sourceTile.
		const onCommit = vi.fn();
		manager.start( {
			payload: {
				type: 'desktop-file',
				source: sourceTile,
				data: {
					placement: p,
					sourceFolderId: 0,
				},
				ghost: { offsetX: 30, offsetY: 30 },
			},
			origin: pointerEvent( 'pointerdown', 100, 100, sourceTile ),
			onCommit,
		} );

		// 7. Drag past threshold → over bin → release.
		document.dispatchEvent( pointerEvent( 'pointermove', 110, 100 ) );
		document.dispatchEvent( pointerEvent( 'pointermove', 300, 300 ) );
		// Verify the bin highlight applied via onEnter.
		expect(
			dockTile.hasAttribute( 'data-os-trash-drop-active' ),
		).toBe( true );
		document.dispatchEvent( pointerEvent( 'pointerup', 300, 300 ) );

		// 8. The drop should have committed.
		expect( onCommit ).toHaveBeenCalledTimes( 1 );

		// 9. Wait for trashByFileType → trashPlacementWithUndo → REST DELETE.
		await new Promise( ( r ) => setTimeout( r, 20 ) );

		// 10. Verify a DELETE was issued for placement id 7.
		const deletes = fetchSpy.mock.calls.filter( ( call ) => {
			const init = call[ 1 ] as RequestInit | undefined;
			return init?.method === 'DELETE' && String( call[ 0 ] ).endsWith( '/placements/7' );
		} );
		expect( deletes.length ).toBe( 1 );

		// 11. Optimistic eviction means the placement is gone from the
		//     store on the local side.
		expect(
			store.getFilesState().placementsByFolder.get( 0 )?.length,
		).toBe( 0 );

		// 12. The bin highlight class should be cleared.
		expect(
			dockTile.hasAttribute( 'data-os-trash-drop-active' ),
		).toBe( false );
	} );

	test( 'dropping a SET on the bin trashes every item in it', async () => {
		const { store, rest, binTargets } = await load();
		store.__resetFilesStoreForTests();
		rest.installRestDeps( {
			baseUrl: 'https://example.test/files',
			nonce: 'n',
		} );

		const fetchSpy = vi.fn(
			async () =>
				new Response( JSON.stringify( { deleted: true } ), {
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				} ),
		);
		vi.stubGlobal( 'fetch', fetchSpy );

		const manager = new DragManager();
		installManagerOnWindow( manager );

		const dockTile = document.createElement( 'div' );
		dockTile.classList.add( 'os-dock__item', 'os-dock__item--system' );
		dockTile.dataset.systemId = 'desktop-mode-recycle-bin';
		const innerBtn = document.createElement( 'button' );
		innerBtn.classList.add( 'os-dock__item-primary' );
		dockTile.appendChild( innerBtn );
		document.body.appendChild( dockTile );
		binTargets.installRecycleBinDropTargets( manager );

		const a = placement( 11, 'link' );
		const b = placement( 12, 'link' );
		const c = placement( 13, 'link' );
		store.setFolderPlacements( 0, [ a, b, c ] );

		const sourceTile = document.createElement( 'div' );
		sourceTile.className = 'os-file-tile';
		document.body.appendChild( sourceTile );
		document.elementFromPoint = ( x, y ) =>
			x >= 280 && x < 340 && y >= 280 && y < 340 ? innerBtn : null;

		manager.start( {
			payload: {
				type: 'desktop-file',
				source: sourceTile,
				data: {
					placement: a,
					placements: [ a, b, c ],
					sourceFolderId: 0,
				},
				ghost: { offsetX: 30, offsetY: 30 },
			},
			origin: pointerEvent( 'pointerdown', 100, 100, sourceTile ),
		} );
		document.dispatchEvent( pointerEvent( 'pointermove', 110, 100 ) );
		document.dispatchEvent( pointerEvent( 'pointermove', 300, 300 ) );
		document.dispatchEvent( pointerEvent( 'pointerup', 300, 300 ) );
		await new Promise( ( r ) => setTimeout( r, 20 ) );

		const deleted = fetchSpy.mock.calls
			.filter(
				( call ) =>
					( call[ 1 ] as RequestInit | undefined )?.method === 'DELETE',
			)
			.map( ( call ) => String( call[ 0 ] ) );
		for ( const id of [ 11, 12, 13 ] ) {
			expect(
				deleted.some( ( u ) => u.endsWith( `/placements/${ id }` ) ),
			).toBe( true );
		}
		// All three are gone locally, in one optimistic pass.
		expect(
			store.getFilesState().placementsByFolder.get( 0 )?.length,
		).toBe( 0 );
	} );

	test( 'a set containing an un-trashable item is refused whole', async () => {
		const { store, rest, binTargets } = await load();
		store.__resetFilesStoreForTests();
		rest.installRestDeps( {
			baseUrl: 'https://example.test/files',
			nonce: 'n',
		} );
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response( '{}', {
						status: 200,
						headers: { 'Content-Type': 'application/json' },
					} ),
			),
		);

		const manager = new DragManager();
		installManagerOnWindow( manager );
		const dockTile = document.createElement( 'div' );
		dockTile.classList.add( 'os-dock__item', 'os-dock__item--system' );
		dockTile.dataset.systemId = 'desktop-mode-recycle-bin';
		const innerBtn = document.createElement( 'button' );
		innerBtn.classList.add( 'os-dock__item-primary' );
		dockTile.appendChild( innerBtn );
		document.body.appendChild( dockTile );
		binTargets.installRecycleBinDropTargets( manager );

		const ok = placement( 21, 'link' );
		// Server says this one may not be trashed — a shared folder's
		// read-only item.
		const denied = { ...placement( 22, 'link' ), canTrash: false };
		const sourceTile = document.createElement( 'div' );
		sourceTile.className = 'os-file-tile';
		document.body.appendChild( sourceTile );
		document.elementFromPoint = ( x, y ) =>
			x >= 280 && x < 340 && y >= 280 && y < 340 ? innerBtn : null;

		const onCommit = vi.fn();
		manager.start( {
			payload: {
				type: 'desktop-file',
				source: sourceTile,
				data: {
					placement: ok,
					placements: [ ok, denied ],
					sourceFolderId: 0,
				},
				ghost: { offsetX: 30, offsetY: 30 },
			},
			origin: pointerEvent( 'pointerdown', 100, 100, sourceTile ),
			onCommit,
		} );
		document.dispatchEvent( pointerEvent( 'pointermove', 110, 100 ) );
		document.dispatchEvent( pointerEvent( 'pointermove', 300, 300 ) );
		// Refused up front: no highlight, and the release commits
		// nothing. Trashing the half that's allowed would report
		// success for an operation that half-happened.
		expect( dockTile.hasAttribute( 'data-os-trash-drop-active' ) ).toBe(
			false,
		);
		document.dispatchEvent( pointerEvent( 'pointerup', 300, 300 ) );
		expect( onCommit ).not.toHaveBeenCalled();
	} );

	test( 'dragging the recycle bin onto itself is rejected — no self-trash', async () => {
		// Regression: the bin tile (a `'shortcut'` placement with
		// `file.ref === 'desktop-mode-recycle-bin'`) is registered as
		// BOTH a drag source (every files-layer tile is) AND a drop
		// target (this module wires the bin icon up as one). Without
		// a guard in `accept()`, dragging the bin onto itself fires
		// `trashByFileType( binPlacement )` → the bin's own placement
		// gets soft-trashed and vanishes from the desktop.
		const { store, rest, binTargets } = await load();
		store.__resetFilesStoreForTests();
		rest.installRestDeps( { baseUrl: 'https://example.test/files', nonce: 'n' } );

		const fetchSpy = vi.fn( async () =>
			new Response(
				JSON.stringify( { deleted: true } ),
				{ status: 200, headers: { 'Content-Type': 'application/json' } },
			),
		);
		vi.stubGlobal( 'fetch', fetchSpy );

		const manager = new DragManager();
		installManagerOnWindow( manager );

		// Build the bin tile in the same DOM shape the files layer
		// produces — `.os-file-tile[data-file-ref="…"]`, which
		// registers under the `recycle-bin-tile` id.
		const binTile = document.createElement( 'div' );
		binTile.classList.add( 'os-file-tile' );
		binTile.dataset.fileRef = 'desktop-mode-recycle-bin';
		document.body.appendChild( binTile );

		binTargets.installRecycleBinDropTargets( manager );
		expect(
			manager.debug().listTargets().find( ( t ) => t.id === 'recycle-bin-tile' ),
		).toBeDefined();

		// The bin's placement: positive id (it's a real DB row) +
		// the `shortcut` file shape with the system ref.
		const binPlacement = {
			id: 99,
			parentId: 0,
			x: 0,
			y: 0,
			sortOrder: 0,
			updatedAtMs: 1,
			meta: null,
			file: {
				type: 'shortcut',
				ref: 'desktop-mode-recycle-bin',
				title: 'Recycle Bin',
				icon: 'dashicons-trash',
				previewUrl: '',
				exists: true,
			},
		};
		store.setFolderPlacements( 0, [ binPlacement ] );

		document.elementFromPoint = ( x, y ) => {
			if ( x >= 280 && x < 340 && y >= 280 && y < 340 ) {
				return binTile;
			}
			return null;
		};

		const onCommit = vi.fn();
		manager.start( {
			payload: {
				type: 'desktop-file',
				source: binTile,
				data: {
					placement: binPlacement,
					sourceFolderId: 0,
				},
				ghost: { offsetX: 30, offsetY: 30 },
			},
			origin: pointerEvent( 'pointerdown', 100, 100, binTile ),
			onCommit,
		} );

		document.dispatchEvent( pointerEvent( 'pointermove', 110, 100 ) );
		document.dispatchEvent( pointerEvent( 'pointermove', 300, 300 ) );

		// Hover highlight must NOT fire — `accept` returns false up
		// front so the drop target never lights up.
		expect(
			binTile.hasAttribute( 'data-os-trash-drop-active' ),
		).toBe( false );

		document.dispatchEvent( pointerEvent( 'pointerup', 300, 300 ) );

		// `onCommit` from the drag source side fires only on accepted
		// drops; rejected drops route through `_cancel`.
		expect( onCommit ).not.toHaveBeenCalled();

		await new Promise( ( r ) => setTimeout( r, 20 ) );

		// No REST DELETE issued — the bin's placement survives.
		const deletes = fetchSpy.mock.calls.filter( ( call ) => {
			const init = call[ 1 ] as RequestInit | undefined;
			return init?.method === 'DELETE';
		} );
		expect( deletes.length ).toBe( 0 );

		// Bin still in the store at the same id.
		const remaining = store.getFilesState().placementsByFolder.get( 0 ) ?? [];
		expect( remaining.find( ( p ) => p.id === 99 ) ).toBeDefined();
	} );

	test( 'bin drop target re-registers after a dock re-render', async () => {
		const { store, rest, binTargets } = await load();
		store.__resetFilesStoreForTests();
		rest.installRestDeps( { baseUrl: 'https://example.test/files', nonce: 'n' } );
		vi.stubGlobal( 'fetch', vi.fn( async () =>
			new Response( JSON.stringify( { deleted: true } ), { status: 200 } ),
		) );

		const manager = new DragManager();
		installManagerOnWindow( manager );

		// First dock render.
		const tile1 = document.createElement( 'div' );
		tile1.classList.add( 'os-dock__item' );
		tile1.dataset.systemId = 'desktop-mode-recycle-bin';
		document.body.appendChild( tile1 );

		binTargets.installRecycleBinDropTargets( manager );
		expect(
			manager
				.debug()
				.listTargets()
				.find( ( t ) => t.id === 'recycle-bin-dock' )?.element,
		).toBe( tile1 );

		// Dock re-renders — old tile detached, new one attached.
		tile1.remove();
		const tile2 = document.createElement( 'div' );
		tile2.classList.add( 'os-dock__item' );
		tile2.dataset.systemId = 'desktop-mode-recycle-bin';
		document.body.appendChild( tile2 );

		// Fire the dock-after-render hook the same way `dock.ts` does.
		( window as unknown as { wp: { hooks: { doAction: ( h: string, ...a: unknown[] ) => void } } } )
			.wp.hooks.doAction( HOOKS.DOCK_AFTER_RENDER, {} );

		// The drop target should now point at the NEW tile.
		expect(
			manager
				.debug()
				.listTargets()
				.find( ( t ) => t.id === 'recycle-bin-dock' )?.element,
		).toBe( tile2 );
	} );
	test( 'every bin surface gets its own target, not just the first', async () => {
		// The classic layout renders the bin BOTH as a wallpaper tile
		// and as a dock system tile, at the same time. Resolving "the"
		// bin to the first matching selector left the dock tile with no
		// drop target at all, so dragging a note (or a file) onto the
		// dock's Trash lit up nothing and did nothing on release.
		const { binTargets } = await load();
		const manager = new DragManager();
		installManagerOnWindow( manager );

		const wallpaperTile = document.createElement( 'div' );
		wallpaperTile.classList.add( 'os-file-tile' );
		wallpaperTile.dataset.fileRef = 'desktop-mode-recycle-bin';
		document.body.appendChild( wallpaperTile );

		const legacyIcon = document.createElement( 'button' );
		legacyIcon.dataset.iconId = 'desktop-mode-recycle-bin';
		document.body.appendChild( legacyIcon );

		const dockTile = document.createElement( 'div' );
		dockTile.classList.add( 'os-dock__item', 'os-dock__item--system' );
		dockTile.dataset.systemId = 'desktop-mode-recycle-bin';
		document.body.appendChild( dockTile );

		binTargets.installRecycleBinDropTargets( manager );

		const byId = ( id: string ) =>
			manager.debug().listTargets().find( ( t ) => t.id === id )?.element;
		expect( byId( 'recycle-bin-tile' ) ).toBe( wallpaperTile );
		expect( byId( 'recycle-bin-icon' ) ).toBe( legacyIcon );
		expect( byId( 'recycle-bin-dock' ) ).toBe( dockTile );

		// A surface that goes away drops its registration, and the
		// others keep theirs.
		wallpaperTile.remove();
		( window as unknown as { wp: { hooks: { doAction: ( h: string, ...a: unknown[] ) => void } } } )
			.wp.hooks.doAction( HOOKS.DOCK_AFTER_RENDER, {} );
		expect( byId( 'recycle-bin-tile' ) ).toBeUndefined();
		expect( byId( 'recycle-bin-dock' ) ).toBe( dockTile );
	} );
} );
