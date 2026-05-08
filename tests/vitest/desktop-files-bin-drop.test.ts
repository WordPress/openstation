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
	const wp = ( window as unknown as { wp?: { hooks?: unknown; desktop?: Record< string, unknown > } } ).wp ?? {};
	wp.desktop = ( wp.desktop as Record< string, unknown > | undefined ) ?? {};
	( wp.desktop as { dragManager: DragManager } ).dragManager = manager;
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
			'desktop-mode-dock__item',
			'desktop-mode-dock__item--system',
		);
		dockTile.dataset.systemId = 'desktop-mode-recycle-bin';
		const innerBtn = document.createElement( 'button' );
		innerBtn.classList.add( 'desktop-mode-dock__item-primary' );
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
		sourceTile.className = 'desktop-mode-file-tile';
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
			dockTile.hasAttribute( 'data-desktop-mode-trash-drop-active' ),
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
			dockTile.hasAttribute( 'data-desktop-mode-trash-drop-active' ),
		).toBe( false );
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
		tile1.classList.add( 'desktop-mode-dock__item' );
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
		tile2.classList.add( 'desktop-mode-dock__item' );
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
} );
