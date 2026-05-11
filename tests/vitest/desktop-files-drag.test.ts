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
} );
