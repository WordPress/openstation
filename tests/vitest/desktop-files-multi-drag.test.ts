/**
 * Multi-item drag: lifting a selection carries the whole set, and the
 * drop targets act on all of it.
 *
 * The payload half is asserted directly (what the manager is handed),
 * because it is the contract every drop target — ours and a plugin's
 * — reads. The end-to-end drop is asserted through the REST calls the
 * canvas issues.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';
import {
	dragPlacements,
	dragShortcutItems,
} from '../../src/desktop-files/drag-payloads';

type LayerModule = typeof import( '../../src/desktop-files/layer' );
type StoreModule = typeof import( '../../src/desktop-files/store' );
type RestModule = typeof import( '../../src/desktop-files/rest' );

interface StartedDrag {
	payload: {
		type: string;
		source: HTMLElement;
		data: Record< string, unknown >;
		ghost?: {
			element?: HTMLElement;
			hint?: { accept?: string; neutral?: string };
		};
	};
}

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

const placement = (
	id: number,
	x: number,
	y: number,
	type: 'post' | 'folder' = 'post',
) => ( {
	id,
	parentId: 0,
	x,
	y,
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
	target?: HTMLElement,
): PointerEvent {
	const ev = new Event( type, { bubbles: true } );
	Object.defineProperty( ev, 'pointerId', { value: 1 } );
	Object.defineProperty( ev, 'button', { value: 0 } );
	Object.defineProperty( ev, 'clientX', { value: clientX } );
	Object.defineProperty( ev, 'clientY', { value: clientY } );
	if ( target ) {
		Object.defineProperty( ev, 'target', { value: target } );
	}
	return ev as unknown as PointerEvent;
}

function rect( el: HTMLElement, x: number, y: number, w: number, h: number ) {
	Object.defineProperty( el, 'getBoundingClientRect', {
		configurable: true,
		value: () =>
			( {
				left: x,
				top: y,
				right: x + w,
				bottom: y + h,
				width: w,
				height: h,
				x,
				y,
				toJSON: () => ( {} ),
			} ) as DOMRect,
	} );
}

/** A drag manager that records what it was asked to lift. */
function installRecordingManager(): StartedDrag[] {
	const started: StartedDrag[] = [];
	const w = window as unknown as { wp: Record< string, unknown > };
	w.wp = w.wp ?? {};
	( w.wp as { os?: Record< string, unknown > } ).os = {
		dragManager: {
			start: ( session: StartedDrag ) => {
				started.push( session );
				return session;
			},
			registerDropTarget: () => () => undefined,
			recentlyEndedDrag: () => false,
		},
	};
	return started;
}

async function mount( placements: ReturnType< typeof placement >[] ) {
	const { layer, store, rest } = await load();
	store.__resetFilesStoreForTests();
	rest.installRestDeps( {
		baseUrl: 'https://example.test/files',
		nonce: 'n',
	} );
	const fetchSpy = vi.fn(
		async () =>
			new Response( JSON.stringify( { placements: [], folderId: 0 } ), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			} ),
	);
	vi.stubGlobal( 'fetch', fetchSpy );
	store.setFolderPlacements( 0, placements as never );

	const host = document.createElement( 'div' );
	Object.defineProperty( host, 'clientWidth', {
		value: 1024,
		configurable: true,
	} );
	Object.defineProperty( host, 'clientHeight', {
		value: 768,
		configurable: true,
	} );
	document.body.appendChild( host );
	rect( host, 0, 0, 1024, 768 );
	const handle = layer.mountFilesLayer( host, 0 );
	const container = host.querySelector< HTMLElement >( '.os-files-layer' )!;
	rect( container, 0, 0, 1024, 768 );
	return { handle, host, container, fetchSpy, store };
}

function tileFor( host: HTMLElement, id: number ): HTMLElement {
	return host.querySelector< HTMLElement >( `[data-placement-id="${ id }"]` )!;
}

function click( el: Element, init: MouseEventInit = {} ): void {
	el.dispatchEvent( new MouseEvent( 'click', { bubbles: true, ...init } ) );
}

describe( 'multi-item drag', () => {
	beforeEach( () => {
		installHooksStub();
	} );
	afterEach( () => {
		clearHooksStub();
		vi.unstubAllGlobals();
		document.body.innerHTML = '';
		delete ( window as unknown as { wp?: unknown } ).wp;
	} );

	test( 'a single-item drag carries no `placements` at all', async () => {
		const started = installRecordingManager();
		const { host, handle } = await mount( [
			placement( 1, 0, 0 ),
			placement( 2, 100, 0 ),
		] );
		const tile = tileFor( host, 1 );
		rect( tile, 0, 0, 88, 96 );
		click( tile );
		tile.dispatchEvent( pointerEvent( 'pointerdown', 40, 40, tile ) );

		expect( started ).toHaveLength( 1 );
		const data = started[ 0 ].payload.data;
		// Byte-identical to what every pre-multi-drag target expects.
		expect( data.placements ).toBeUndefined();
		expect( ( data.placement as { id: number } ).id ).toBe( 1 );
		// …and the shared reader still reports the one item.
		expect( dragPlacements( data as never ).map( ( p ) => p.id ) ).toEqual( [
			1,
		] );
		handle.dispose();
	} );

	test( 'grabbing a selected tile lifts the whole selection', async () => {
		const started = installRecordingManager();
		const { host, handle } = await mount( [
			placement( 1, 0, 0 ),
			placement( 2, 100, 0 ),
			placement( 3, 200, 0 ),
		] );
		const tile = tileFor( host, 2 );
		rect( tile, 100, 0, 88, 96 );
		click( tileFor( host, 1 ) );
		click( tile, { metaKey: true } );
		tile.dispatchEvent( pointerEvent( 'pointerdown', 140, 40, tile ) );

		const data = started[ 0 ].payload.data;
		expect( dragPlacements( data as never ).map( ( p ) => p.id ) ).toEqual( [
			1, 2,
		] );
		// The grabbed tile stays the primary, so a target that only
		// reads `placement` acts on what the user pointed at.
		expect( ( data.placement as { id: number } ).id ).toBe( 2 );
		handle.dispose();
	} );

	test( 'grabbing an unselected tile drags one and leaves the selection alone until the drag lifts', async () => {
		const started = installRecordingManager();
		const { host, handle } = await mount( [
			placement( 1, 0, 0 ),
			placement( 2, 100, 0 ),
			placement( 3, 200, 0 ),
		] );
		click( tileFor( host, 1 ) );
		click( tileFor( host, 2 ), { metaKey: true } );

		const tile = tileFor( host, 3 );
		rect( tile, 200, 0, 88, 96 );
		tile.dispatchEvent( pointerEvent( 'pointerdown', 240, 40, tile ) );

		const data = started[ 0 ].payload.data;
		expect( dragPlacements( data as never ).map( ( p ) => p.id ) ).toEqual( [
			3,
		] );
		// Crucially the selection has NOT moved yet: mutating it here
		// repaints the tile mid-gesture and costs the user their
		// click (and therefore their double-click).
		expect( handle.getSelection().map( ( p ) => p.id ) ).toEqual( [ 1, 2 ] );

		// Once the gesture proves itself a drag, the highlight catches
		// up with what's moving.
		document.dispatchEvent( new CustomEvent( 'os.drag.start' ) );
		expect( handle.getSelection().map( ( p ) => p.id ) ).toEqual( [ 3 ] );
		handle.dispose();
	} );

	test( 'a press that turns out to be a click never moves the selection', async () => {
		installRecordingManager();
		const { host, handle } = await mount( [
			placement( 1, 0, 0 ),
			placement( 2, 100, 0 ),
		] );
		click( tileFor( host, 1 ) );

		const tile = tileFor( host, 2 );
		rect( tile, 100, 0, 88, 96 );
		tile.dispatchEvent( pointerEvent( 'pointerdown', 140, 40, tile ) );
		document.dispatchEvent( pointerEvent( 'pointerup', 140, 40 ) );
		// The armed sync must be dropped on pointerup, or an unrelated
		// drag later in the session would apply it.
		document.dispatchEvent( new CustomEvent( 'os.drag.start' ) );
		expect( handle.getSelection().map( ( p ) => p.id ) ).toEqual( [ 1 ] );
		handle.dispose();
	} );

	test( 'a selection change never rebuilds the tile’s children', async () => {
		// The regression this guards: `<os-tile>._paint()` replaces the
		// visual + label on every attribute change. If that happens
		// between `mousedown` and `mouseup`, the browser synthesizes no
		// `click` — so no `dblclick`, and the tile can no longer be
		// opened. A folder that had just been dropped on was the first
		// place it showed up.
		installRecordingManager();
		const { host, handle } = await mount( [
			placement( 1, 0, 0 ),
			placement( 2, 100, 0 ),
		] );
		const tile = tileFor( host, 1 );
		const visualBefore = tile.querySelector( '.os-file-tile__visual' );
		const labelBefore = tile.querySelector( '.os-file-tile__label' );
		expect( visualBefore ).not.toBeNull();

		click( tile );
		expect( tile.hasAttribute( 'selected' ) ).toBe( true );
		// Same nodes — only classes and ARIA moved.
		expect( tile.querySelector( '.os-file-tile__visual' ) ).toBe(
			visualBefore,
		);
		expect( tile.querySelector( '.os-file-tile__label' ) ).toBe(
			labelBefore,
		);
		expect( tile.classList.contains( 'os-file-tile--selected' ) ).toBe(
			true,
		);
		expect( tile.getAttribute( 'aria-selected' ) ).toBe( 'true' );

		click( tileFor( host, 2 ) );
		expect( tile.querySelector( '.os-file-tile__visual' ) ).toBe(
			visualBefore,
		);
		expect( tile.getAttribute( 'aria-selected' ) ).toBe( 'false' );
		handle.dispose();
	} );

	test( 'double-click still opens a tile that was not selected first', async () => {
		installRecordingManager();
		const { host, handle } = await mount( [ placement( 1, 0, 0, 'folder' ) ] );
		const tile = tileFor( host, 1 );
		const opened: unknown[] = [];
		tile.addEventListener( 'dblclick', ( e ) => opened.push( e ) );

		// The full gesture: press, release, click, click, dblclick.
		// Nothing in it may destroy the node the events are landing on.
		rect( tile, 0, 0, 88, 96 );
		tile.dispatchEvent( pointerEvent( 'pointerdown', 40, 40, tile ) );
		const visual = tile.querySelector( '.os-file-tile__visual' );
		document.dispatchEvent( pointerEvent( 'pointerup', 40, 40 ) );
		click( tile );
		expect( tile.querySelector( '.os-file-tile__visual' ) ).toBe( visual );
		click( tile );
		tile.dispatchEvent( new MouseEvent( 'dblclick', { bubbles: true } ) );
		expect( opened ).toHaveLength( 1 );
		handle.dispose();
	} );

	test( 'a multi-drag ghost states the count and dims the whole set', async () => {
		const started = installRecordingManager();
		const { host, handle } = await mount( [
			placement( 1, 0, 0 ),
			placement( 2, 100, 0 ),
			placement( 3, 200, 0 ),
		] );
		const tile = tileFor( host, 1 );
		rect( tile, 0, 0, 88, 96 );
		click( tile );
		click( tileFor( host, 2 ), { metaKey: true } );
		click( tileFor( host, 3 ), { metaKey: true } );
		tile.dispatchEvent( pointerEvent( 'pointerdown', 40, 40, tile ) );

		const ghost = started[ 0 ].payload.ghost;
		expect(
			ghost?.element?.querySelector( '.os-drag-stack__count' )?.textContent,
		).toBe( '3' );
		expect( ghost?.hint?.neutral ).toBe( 'Moving 3 items' );

		// Dimming waits for the lift — a press that turns out to be a
		// click must leave the canvas as it found it.
		expect(
			tileFor( host, 2 ).classList.contains( 'os-file-tile--dragging' ),
		).toBe( false );
		document.dispatchEvent( new CustomEvent( 'os.drag.start' ) );
		// The other two tiles dim too — the manager only knows about
		// the source.
		expect(
			tileFor( host, 2 ).classList.contains( 'os-file-tile--dragging' ),
		).toBe( true );

		document.dispatchEvent( new CustomEvent( 'os.drag.end' ) );
		expect(
			tileFor( host, 2 ).classList.contains( 'os-file-tile--dragging' ),
		).toBe( false );
		handle.dispose();
	} );

	test( 'the ghost clone never carries the selected state', async () => {
		const started = installRecordingManager();
		const { host, handle } = await mount( [
			placement( 1, 0, 0 ),
			placement( 2, 100, 0 ),
		] );
		const tile = tileFor( host, 1 );
		rect( tile, 0, 0, 88, 96 );
		click( tile );
		click( tileFor( host, 2 ), { metaKey: true } );
		tile.dispatchEvent( pointerEvent( 'pointerdown', 40, 40, tile ) );

		const clone = started[ 0 ].payload.ghost?.element?.querySelector(
			'.os-file-tile',
		);
		expect( clone?.hasAttribute( 'selected' ) ).toBe( false );
		handle.dispose();
	} );

	test( 'a modifier-click never lifts anything', async () => {
		const started = installRecordingManager();
		const { host, handle } = await mount( [
			placement( 1, 0, 0 ),
			placement( 2, 100, 0 ),
		] );
		const tile = tileFor( host, 2 );
		rect( tile, 100, 0, 88, 96 );
		const ev = pointerEvent( 'pointerdown', 140, 40, tile );
		Object.defineProperty( ev, 'metaKey', { value: true } );
		tile.dispatchEvent( ev );
		expect( started ).toHaveLength( 0 );
		handle.dispose();
	} );

	test( 'dropping a set on the canvas moves every item', async () => {
		// Real manager this time, so the canvas drop target runs.
		const { DragManager } = await import( '../../src/drag/manager' );
		const { __resetRecoveryForTests } = await import(
			'../../src/drag/recovery'
		);
		__resetRecoveryForTests();
		const manager = new DragManager();
		const w = window as unknown as { wp: Record< string, unknown > };
		w.wp = w.wp ?? {};
		( w.wp as { os?: Record< string, unknown > } ).os = {
			dragManager: manager,
		};

		const { host, handle, fetchSpy } = await mount( [
			placement( 1, 0, 0 ),
			placement( 2, 96, 0 ),
		] );
		const one = tileFor( host, 1 );
		const two = tileFor( host, 2 );
		rect( one, 0, 0, 88, 96 );
		rect( two, 96, 0, 88, 96 );
		document.elementFromPoint = () => host;

		click( one );
		click( two, { metaKey: true } );
		fetchSpy.mockClear();

		one.dispatchEvent( pointerEvent( 'pointerdown', 40, 40, one ) );
		document.dispatchEvent( pointerEvent( 'pointermove', 400, 300 ) );
		document.dispatchEvent( pointerEvent( 'pointerup', 400, 300 ) );
		await Promise.resolve();
		await Promise.resolve();

		const patched = fetchSpy.mock.calls
			.filter(
				( call ) =>
					( call[ 1 ] as RequestInit | undefined )?.method === 'PATCH',
			)
			.map( ( call ) => String( call[ 0 ] ) );
		// BOTH placements were persisted, not just the grabbed one.
		expect( patched.some( ( u ) => u.includes( '/placements/1' ) ) ).toBe(
			true,
		);
		expect( patched.some( ( u ) => u.includes( '/placements/2' ) ) ).toBe(
			true,
		);
		handle.dispose();
	} );

	test( 'a dropped set keeps its shape', async () => {
		const { DragManager } = await import( '../../src/drag/manager' );
		const { __resetRecoveryForTests } = await import(
			'../../src/drag/recovery'
		);
		__resetRecoveryForTests();
		const manager = new DragManager();
		const w = window as unknown as { wp: Record< string, unknown > };
		w.wp = w.wp ?? {};
		( w.wp as { os?: Record< string, unknown > } ).os = {
			dragManager: manager,
		};

		// Two tiles side by side, one grid cell apart.
		const { host, handle, store } = await mount( [
			placement( 1, 0, 0 ),
			placement( 2, 96, 0 ),
		] );
		const one = tileFor( host, 1 );
		const two = tileFor( host, 2 );
		rect( one, 0, 0, 88, 96 );
		rect( two, 96, 0, 88, 96 );
		document.elementFromPoint = () => host;

		click( one );
		click( two, { metaKey: true } );
		one.dispatchEvent( pointerEvent( 'pointerdown', 40, 40, one ) );
		document.dispatchEvent( pointerEvent( 'pointermove', 400, 300 ) );
		document.dispatchEvent( pointerEvent( 'pointerup', 400, 300 ) );
		await Promise.resolve();

		const list = store.getFilesState().placementsByFolder.get( 0 ) ?? [];
		const a = list.find( ( p ) => p.id === 1 )!;
		const b = list.find( ( p ) => p.id === 2 )!;
		// Still on the same row, still one cell apart — three icons
		// dropped in a row give you three icons in a row.
		expect( b.y ).toBe( a.y );
		expect( b.x ).toBeGreaterThan( a.x );
		handle.dispose();
	} );

	test( 'shortcut payloads expose their set the same way', () => {
		// Single item: the top-level fields ARE the one item.
		expect(
			dragShortcutItems( { kind: 'post', ref: '7' } ).map( ( i ) => i.ref ),
		).toEqual( [ '7' ] );
		// Multi: the `items` array wins.
		expect(
			dragShortcutItems( {
				kind: 'post',
				ref: '7',
				items: [
					{ kind: 'post', ref: '7' },
					{ kind: 'post', ref: '8' },
				],
			} ).map( ( i ) => i.ref ),
		).toEqual( [ '7', '8' ] );
	} );
} );
