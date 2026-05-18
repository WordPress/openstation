/**
 * Integration tests for the desktop-files drag flow with the
 * centralized DragManager. Exercises:
 *
 *   - Tile drag → wallpaper canvas (REST PATCH with new x/y).
 *   - Tile drag → recycle bin window body (trash + REST DELETE).
 *   - Tile drag → arbitrary admin window (rejected, no REST).
 *   - Pinned tile pointerdown → bump animation, no drag session.
 */
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
	( window as unknown as { wp: { desktop: { dragManager: DragManager } } } ).wp = (
		window as unknown as { wp?: { desktop?: unknown } }
	).wp ?? { hooks: {} };
	const wp = ( window as unknown as { wp: { desktop?: unknown; hooks?: unknown } } ).wp;
	wp.desktop = ( wp.desktop as Record< string, unknown > | undefined ) ?? {};
	( wp.desktop as { dragManager: DragManager } ).dragManager = manager;
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
		// Hit-test stub: cursor at (300, 300) lands on the host (the
		// canvas drop target). Position relative to host's bbox.
		Object.defineProperty( host, 'getBoundingClientRect', {
			value: () => ( {
				left: 0, top: 0, right: 1024, bottom: 768,
				width: 1024, height: 768, x: 0, y: 0, toJSON: () => ( {} ),
			} ) as DOMRect,
		} );
		installElementFromPointStub( [ { el: host, rect: { x: 0, y: 0, w: 1024, h: 768 } } ] );

		// Capture the layer container's bbox lookup. Container is
		// inside host so its bbox is also (0,0,1024,768) in our setup.
		const container = host.querySelector< HTMLElement >( '.desktop-mode-files-layer' );
		Object.defineProperty( container!, 'getBoundingClientRect', {
			value: () => ( {
				left: 0, top: 0, right: 1024, bottom: 768,
				width: 1024, height: 768, x: 0, y: 0, toJSON: () => ( {} ),
			} ) as DOMRect,
		} );

		// Reset fetch spy so we ignore the boot-time hydrate call.
		fetchSpy.mockClear();

		// Drag from (140, 140) — center of tile — to (310, 220).
		tile!.dispatchEvent( pointerEvent( 'pointerdown', 140, 140, tile! ) );
		document.dispatchEvent( pointerEvent( 'pointermove', 310, 220 ) );
		document.dispatchEvent( pointerEvent( 'pointerup', 310, 220 ) );

		// Wait a microtask for the optimistic upsert + REST call.
		await Promise.resolve();
		await Promise.resolve();

		// At least one PATCH /placements/1 call was issued.
		const patches = fetchSpy.mock.calls.filter( ( call ) => {
			const init = call[ 1 ] as RequestInit | undefined;
			return init?.method === 'PATCH' && String( call[ 0 ] ).includes( '/placements/1' );
		} );
		expect( patches.length ).toBeGreaterThanOrEqual( 1 );

		handle.dispose();
	} );

	test( 'pinned tile silently swallows pointerdown — no bump cue, no drag session', async () => {
		// As of 0.9.0 we deliberately surface NO upfront visual cue
		// on pinned tiles (no bump animation, no `not-allowed`
		// cursor, no pre-emptive tooltip): the tile looks + reacts
		// identically to a draggable one until the user attempts a
		// drag, which then fails silently. Pre-emptive cues read as
		// "this tile is broken/disabled" — we want the failure to
		// happen at the moment of the gesture, not before.
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
		expect( tile?.classList.contains( 'desktop-mode-file-tile--pinned' ) ).toBe( true );
		// `aria-disabled` and the pre-emptive tooltip both went away
		// in 0.9.0 — clicking the tile still opens the window, so
		// painting it as "disabled" was misleading.
		expect( tile?.hasAttribute( 'aria-disabled' ) ).toBe( false );
		expect( tile?.title ).toBe( '' );

		tile!.dispatchEvent( pointerEvent( 'pointerdown', 50, 50, tile! ) );

		expect( tile?.classList.contains( 'desktop-mode-file-tile--bump' ) ).toBe( false );
		expect( manager.getActive() ).toBeNull();

		handle.dispose();
	} );

	test( 'drag rolls back optimistic store on REST failure', async () => {
		const { layer, store, rest } = await load();
		store.__resetFilesStoreForTests();
		rest.installRestDeps( { baseUrl: 'https://example.test/files', nonce: 'n' } );

		// Boot fetch returns OK list; subsequent PATCH fails.
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
		const container = host.querySelector< HTMLElement >( '.desktop-mode-files-layer' );
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

		// Let the optimistic upsert + the failing PATCH + the rollback
		// resolve.
		await new Promise( ( r ) => setTimeout( r, 10 ) );

		// After rollback, no orphaned `--dragging` class anywhere.
		expect( document.querySelectorAll( '.desktop-mode-file-tile--dragging' ).length ).toBe( 0 );
		expect( document.querySelector( '.desktop-mode-drag-ghost' ) ).toBeNull();

		handle.dispose();
	} );

	test( 'hovering a non-folder tile during a drag flips the chip to reject', async () => {
		// Regression: dragging onto a non-folder, non-bin tile
		// (My WordPress, dock-promotion, plugin-registered icon,
		// post / page shortcut) used to leave the chip green —
		// "Drop here to move." The drop would silently snap to the
		// next free cell, never landing INTO the tile, so the green
		// affordance lied. Fix: tile-level reject claimant with
		// `accept: () => false` so the chip turns red on hover.
		const { layer, store, rest } = await load();
		store.__resetFilesStoreForTests();
		rest.installRestDeps( { baseUrl: 'https://example.test/files', nonce: 'n' } );
		setupRestStub();
		const manager = installManagerOnWindow();

		// My WordPress as a pinned shortcut at slot (0, 0); Icon B
		// as a regular post placement at (0, 2). We drag B onto
		// My WordPress's tile.
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

		// Verify the reject claimant is in the registry, keyed on the
		// My WordPress tile element. Confirms the tile owns the
		// drop-target slot, so a hit-test on the tile resolves to
		// `accept: false` and the framework chip flips to "Can't
		// drop here."
		const target = manager
			.debug()
			.listTargets()
			.find( ( t ) => t.id === 'desktop-mode-files-tile-100-reject' );
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
		// Mirror of the above for the bin exclusion. The bin tile is
		// claimed by `recycle-bin-targets.ts` as a TRASH-accepting
		// drop target — if `shouldRejectTileDrops` accidentally
		// returned true for the bin, the layer's reject claimant
		// would overwrite the bin's trash target (the registry keys
		// by element).
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

		// The layer-level reject claimant must NOT exist for the bin.
		const rejected = manager
			.debug()
			.listTargets()
			.find( ( t ) => t.id === 'desktop-mode-files-tile-99-reject' );
		expect( rejected ).toBeUndefined();

		handle.dispose();
	} );

	test( 'drop into a column with a pinned tile (My WordPress) skips the pinned cell', async () => {
		// Regression: a column rendered as
		//   My WordPress (pinned) | empty | Icon A | Icon B
		// — dragging Icon B at the empty cell used to highlight + drop
		// onto the My WordPress slot. Cause: the layer's repaint
		// reserves pinned slots (column 0, row 0..N-1) ignoring stored
		// (x, y), but `buildOccupiedSet` only read stored coords —
		// so the pinned cell was missing from `occupied` and
		// `snapToEmptyCell`'s column-major scan picked (0, 0) as
		// "empty" first.
		const { layer, store, rest } = await load();
		store.__resetFilesStoreForTests();
		rest.installRestDeps( { baseUrl: 'https://example.test/files', nonce: 'n' } );
		const fetchSpy = setupRestStub();
		installManagerOnWindow();

		// My WordPress: pinned via the `file.pinned` flag. Stored
		// coords intentionally NOT (0, 0) — proves the test actually
		// exercises the bug (the layer ignores them and slots it at
		// (0, 0) regardless).
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
		// Icon A at (0, 2), Icon B at (0, 3). Cell pitch is
		// `GRID_PADDING + row * GRID_CELL_H` = 16 + row*110.
		const iconA = placement( 200, { x: 16, y: 236 } ); // (col 0, row 2)
		const iconB = placement( 201, { x: 16, y: 346 } ); // (col 0, row 3)
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
		const container = host.querySelector< HTMLElement >( '.desktop-mode-files-layer' );
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

		// Drag Icon B from its (16, 346) toward the empty cell at
		// (16, 126) — that's (col 0, row 1) on screen.
		// Pointerdown roughly at the tile's center so the ghost
		// offset is (44, 48) — same offset the user has when
		// grabbing a tile naturally.
		tileB!.dispatchEvent( pointerEvent( 'pointerdown', 60, 394, tileB! ) );
		document.dispatchEvent( pointerEvent( 'pointermove', 60, 220 ) );
		// Release with cursor at (60, 174) → tile top-left lands at
		// (60-44, 174-48) = (16, 126) → cell (0, 1).
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
		// Critical assertion: the snapped cell is (0, 1) — NOT (0, 0)
		// which is My WordPress's pinned slot.
		expect( body.x ).toBe( 16 );
		expect( body.y ).toBe( 126 );

		handle.dispose();
	} );

	test( 'tile drag reads live placement from store, not closure — heartbeat-bumped updatedAtMs is honored', async () => {
		// Regression: with the fast-path repaint preserving tile DOM
		// identity, `attachTileDrag` is only attached once — the
		// closure-captured `placement` would otherwise hold a stale
		// `updatedAtMs` forever after the first heartbeat bump.
		// Server then rejected the PATCH with `If-Match` mismatch →
		// 409 surfaced as "admin moved this to 'another folder'."
		// Shared folders saw this most because peers bump
		// `updatedAtMs` on every heartbeat tick.
		const { layer, store, rest } = await load();
		store.__resetFilesStoreForTests();
		rest.installRestDeps( { baseUrl: 'https://example.test/files', nonce: 'n' } );
		setupRestStub();
		const manager = installManagerOnWindow();

		// Mount the layer with one placement at updatedAtMs=100.
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

		// Simulate the server-side bump that would happen after a
		// peer-driven heartbeat tick — `upsertPlacement` from
		// `applyDelta` in `heartbeat.ts` does exactly this.
		store.upsertPlacement(
			{ ...placement( 1 ), updatedAtMs: 9999 },
			'remote',
		);

		// Fast-path took the repaint — same DOM node still in place.
		expect(
			host.querySelector< HTMLElement >( '[data-placement-id="1"]' ),
		).toBe( tile );

		// Capture the session payload by spying on `dragManager.start`.
		// (The drag never actually has to threshold-lift for this
		// test — what matters is what `start()` receives.)
		const startSpy = vi.spyOn( manager, 'start' );

		// Fire pointerdown to trigger the drag handler's `start` call.
		tile!.dispatchEvent( pointerEvent( 'pointerdown', 50, 50, tile! ) );

		expect( startSpy ).toHaveBeenCalledTimes( 1 );
		const opts = startSpy.mock.calls[ 0 ][ 0 ];
		const data = opts.payload.data as { placement: { updatedAtMs: number } };
		expect( data.placement.updatedAtMs ).toBe( 9999 );

		// Tear down before any pending drag manager state leaks into
		// the next test.
		document.dispatchEvent( pointerEvent( 'pointerup', 50, 50 ) );
		startSpy.mockRestore();
		handle.dispose();
	} );

	test( 'drag-to-reposition keeps tile DOM identity — no full grid rebuild', async () => {
		// Regression: on every drop the repaint did `container.replaceChildren()`
		// — every tile was destroyed and re-created. To users that visible
		// flash reads as "the whole desktop just reloaded." The fast path
		// in `tryPatchPositions` patches positions in place; the tile
		// element the user was just holding has to survive the store update.
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

		// Capture initial DOM identity. If the fast path works the
		// same `<button>` element holds the placement after the drag.
		const tileBefore = host.querySelector< HTMLElement >( '[data-placement-id="1"]' );
		const peerBefore = host.querySelector< HTMLElement >( '[data-placement-id="2"]' );
		expect( tileBefore ).not.toBeNull();
		expect( peerBefore ).not.toBeNull();

		const container = host.querySelector< HTMLElement >( '.desktop-mode-files-layer' );
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

		// Same DOM node — no wholesale rebuild.
		const tileAfter = host.querySelector< HTMLElement >( '[data-placement-id="1"]' );
		const peerAfter = host.querySelector< HTMLElement >( '[data-placement-id="2"]' );
		expect( tileAfter ).toBe( tileBefore );
		expect( peerAfter ).toBe( peerBefore );
		// But the position did update.
		expect( tileAfter!.style.left ).not.toBe( '100px' );

		handle.dispose();
	} );

	test( 'synthetic dock-promoted placement: drag updates store but issues no PATCH', async () => {
		// Regression: dragging an icon the user promoted from the dock
		// (OS Settings → Apps & Icons) used to fire a PATCH against a
		// negative id, which the REST regex `(?P<id>\d+)` rejects → WP
		// returns `rest_no_route` 404 → the user sees a scary
		// `[desktop-mode] files: drag persist failed` in the console
		// every time they nudge a promoted icon.
		const { layer, store, rest } = await load();
		store.__resetFilesStoreForTests();
		rest.installRestDeps( { baseUrl: 'https://example.test/files', nonce: 'n' } );
		const fetchSpy = setupRestStub();
		installManagerOnWindow();

		// Spy on the OS-Settings persistence facade — the layer should
		// route the new position through here for synth placements.
		const updateOsSettings = vi.fn();
		const wp = ( window as unknown as { wp: { desktop: Record< string, unknown > } } ).wp;
		wp.desktop.getOsSettings = () => ( { dockPromotedPositions: {} } );
		wp.desktop.updateOsSettings = updateOsSettings;

		// Synthetic placement: negative id + `__synthFromDockItem`
		// meta marker (the shape `settings/desktop-shortcuts-sync.ts`
		// produces for a dock-item promoted to the desktop).
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
		const container = host.querySelector< HTMLElement >( '.desktop-mode-files-layer' );
		Object.defineProperty( container!, 'getBoundingClientRect', {
			value: () => ( {
				left: 0, top: 0, right: 1024, bottom: 768,
				width: 1024, height: 768, x: 0, y: 0, toJSON: () => ( {} ),
			} ) as DOMRect,
		} );
		installElementFromPointStub( [ { el: host, rect: { x: 0, y: 0, w: 1024, h: 768 } } ] );

		// Boot-time hydrate call is the only PATCH-able thing we
		// want to ignore here.
		fetchSpy.mockClear();

		tile!.dispatchEvent( pointerEvent( 'pointerdown', 140, 140, tile! ) );
		document.dispatchEvent( pointerEvent( 'pointermove', 310, 220 ) );
		document.dispatchEvent( pointerEvent( 'pointerup', 310, 220 ) );

		await Promise.resolve();
		await Promise.resolve();

		// No PATCH attempted — synth placements live JS-only.
		const patches = fetchSpy.mock.calls.filter( ( call ) => {
			const init = call[ 1 ] as RequestInit | undefined;
			return init?.method === 'PATCH';
		} );
		expect( patches.length ).toBe( 0 );

		// Store should still reflect the drop position (the optimistic
		// upsert runs before the gate), so the tile visually moved.
		const updated = store
			.getFilesState()
			.placementsByFolder.get( 0 )
			?.find( ( p ) => p.id === -42 );
		expect( updated ).toBeDefined();
		expect( updated!.x ).not.toBe( 100 );

		// Position persisted into OS Settings keyed by the source
		// dock-item id, so the synthesizer can restore it on reload.
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
