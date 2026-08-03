/**
 * Pinned-notes layer: owner vs read-only rendering, z-order,
 * heartbeat deltas, and the trash/restore round trip.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { NotesLayer } from '../../src/notes/layer';
import { __resetNotesHeartbeatForTests } from '../../src/notes/heartbeat';
import { __resetNotesRestForTests, installNotesRestDeps } from '../../src/notes/rest';
import type { Note } from '../../src/notes/types';

function makeNote( overrides: Partial< Note > = {} ): Note {
	return {
		id: 1,
		text: 'buy milk',
		color: 'butter',
		x: 0.1,
		y: 0.2,
		z: 3,
		public: false,
		seed: 123,
		ownerId: 5,
		ownerName: 'Me',
		ownerAvatar: '',
		canEdit: true,
		updatedAtMs: 1000,
		...overrides,
	};
}

function makeLayer(): NotesLayer {
	const host = document.createElement( 'div' );
	document.body.appendChild( host );
	return new NotesLayer( { host, pluginUrl: 'https://example.test/plugin' } );
}

describe( 'NotesLayer', () => {
	beforeEach( () => {
		__resetNotesHeartbeatForTests();
		__resetNotesRestForTests();
		installNotesRestDeps( { baseUrl: 'https://example.test/notes', nonce: 'n' } );
		vi.stubGlobal(
			'fetch',
			vi.fn( async () =>
				new Response( JSON.stringify( { notes: [] } ), { status: 200 } ),
			),
		);
	} );

	afterEach( () => {
		document.body.innerHTML = '';
		vi.unstubAllGlobals();
	} );

	test( 'owner note renders an editable paper with a pin button', () => {
		const layer = makeLayer();
		const controller = layer.upsertNote( makeNote() );
		const el = controller.element;
		expect( el.classList.contains( 'os-pinned-note' ) ).toBe( true );
		expect( el.dataset.owner ).toBe( 'me' );
		expect( el.dataset.noteColor ).toBe( 'butter' );
		// Pin is a real, focusable button.
		const pin = el.querySelector( 'button.os-pinned-note__pin' );
		expect( pin ).not.toBeNull();
		expect( pin?.getAttribute( 'aria-pressed' ) ).toBe( 'false' );
		// Owner paper carries the editor, color dot, visibility toggle.
		expect( el.querySelector( 'os-textarea' ) ).not.toBeNull();
		expect( el.querySelector( '.os-pinned-note__color-dot' ) ).not.toBeNull();
		expect( el.querySelector( '.os-pinned-note__visibility' ) ).not.toBeNull();
		// The pushpin image points at the plugin asset.
		const img = el.querySelector( 'img' );
		expect( img?.getAttribute( 'src' ) ).toBe(
			'https://example.test/plugin/assets/images/pushpin.svg',
		);
		expect( img?.draggable ).toBe( false );
	} );

	test( 'read-only public note renders inert pin + attribution chip', () => {
		const layer = makeLayer();
		const controller = layer.upsertNote(
			makeNote( { id: 2, canEdit: false, public: true, ownerName: 'Ana García' } ),
		);
		const el = controller.element;
		expect( el.dataset.owner ).toBe( 'other' );
		expect( el.getAttribute( 'role' ) ).toBe( 'note' );
		expect( el.getAttribute( 'aria-label' ) ).toContain( 'Ana García' );
		// The pin is scenery: a span, hidden from the a11y tree.
		expect( el.querySelector( 'button.os-pinned-note__pin' ) ).toBeNull();
		const pin = el.querySelector( 'span.os-pinned-note__pin' );
		expect( pin?.getAttribute( 'aria-hidden' ) ).toBe( 'true' );
		// No editor, no owner chrome; a body div + attribution instead.
		expect( el.querySelector( 'os-textarea' ) ).toBeNull();
		expect( el.querySelector( '.os-pinned-note__color-dot' ) ).toBeNull();
		expect(
			el.querySelector( '.os-pinned-note__body' )?.textContent,
		).toBe( 'buy milk' );
		const chip = el.querySelector( '.os-pinned-note__attribution' );
		expect( chip?.textContent ).toContain( 'Ana García' );
		expect( chip?.querySelector( 'os-avatar' ) ).not.toBeNull();
	} );

	test( 'filter-added color slugs survive to the DOM unclamped', () => {
		// A plugin can extend openstation_notes_colors server-side and
		// ship its own [data-note-color="seafoam"] CSS — the client
		// must not rewrite the slug to a built-in.
		const layer = makeLayer();
		const controller = layer.upsertNote( makeNote( { color: 'seafoam' } ) );
		expect( controller.element.dataset.noteColor ).toBe( 'seafoam' );
	} );

	test( 'remote z changes apply to the element on replace', () => {
		const layer = makeLayer();
		const controller = layer.upsertNote( makeNote( { id: 1, z: 3 } ) );
		controller.replace( makeNote( { id: 1, z: 9, updatedAtMs: 2000 } ) );
		expect( controller.element.style.zIndex ).toBe( '9' );
	} );

	test( 'a truncated heartbeat delta triggers a full re-hydration', async () => {
		const fetchSpy = vi.fn( async () =>
			new Response(
				JSON.stringify( { notes: [ makeNote( { id: 5, text: 'missed', updatedAtMs: 100 } ) ] } ),
				{ status: 200 },
			),
		);
		vi.stubGlobal( 'fetch', fetchSpy );
		const layer = makeLayer();
		layer.applyHeartbeatPayload( { notes: [], serverTimeMs: 9000, truncated: true } );
		await new Promise( ( r ) => setTimeout( r, 10 ) );
		// The capped-out note arrived via the list fallback.
		expect( layer.has( 5 ) ).toBe( true );
	} );

	test( 'jitter comes from the creation seed and survives text edits', () => {
		const layer = makeLayer();
		const a = layer.upsertNote( makeNote( { id: 1, seed: 42 } ) );
		const rotation = a.element.style.getPropertyValue( '--dm-note-rot' );
		expect( rotation ).not.toBe( '' );
		// A text update (same seed) must NOT re-tilt the paper.
		a.replace( makeNote( { id: 1, seed: 42, text: 'edited', updatedAtMs: 2000 } ) );
		expect( a.element.style.getPropertyValue( '--dm-note-rot' ) ).toBe( rotation );
		// Two notes with different seeds get different tilts.
		const b = layer.upsertNote( makeNote( { id: 2, seed: 43 } ) );
		expect( b.element.style.getPropertyValue( '--dm-note-rot' ) ).not.toBe( rotation );
	} );

	test( 'bringToFront raises z above every other note', () => {
		const layer = makeLayer();
		const a = layer.upsertNote( makeNote( { id: 1, z: 5 } ) );
		const b = layer.upsertNote( makeNote( { id: 2, z: 9 } ) );
		layer.bringToFront( a );
		expect( Number( a.element.style.zIndex ) ).toBeGreaterThan( 9 );
		expect( Number( a.element.style.zIndex ) ).toBeGreaterThan(
			Number( b.element.style.zIndex ),
		);
	} );

	test( 'heartbeat payload adds, updates, and removes notes', () => {
		const layer = makeLayer();
		layer.upsertNote( makeNote( { id: 1 } ) );
		layer.upsertNote( makeNote( { id: 2, canEdit: false, ownerName: 'Bob' } ) );

		layer.applyHeartbeatPayload( {
			notes: [
				makeNote( { id: 2, canEdit: false, text: 'updated text', updatedAtMs: 5000 } ),
				makeNote( { id: 3, canEdit: false, text: 'brand new', updatedAtMs: 5000 } ),
			],
			removed: [ 1 ],
			serverTimeMs: 6000,
		} );

		expect( layer.has( 1 ) ).toBe( false );
		expect( layer.has( 3 ) ).toBe( true );
		expect(
			layer
				.get( 2 )
				?.element.querySelector( '.os-pinned-note__body' )
				?.textContent,
		).toBe( 'updated text' );
		// High-water advanced → next subscription echoes it.
		expect( layer.getHeartbeatSubscription()?.sinceMs ).toBe( 6000 );
		expect( layer.getHeartbeatSubscription()?.knownIds.sort() ).toEqual( [ 2, 3 ] );
	} );

	test( 'stale heartbeat copies never clobber a newer local note', () => {
		const layer = makeLayer();
		layer.upsertNote( makeNote( { id: 2, canEdit: false, text: 'newer', updatedAtMs: 9000 } ) );
		layer.applyHeartbeatPayload( {
			notes: [ makeNote( { id: 2, canEdit: false, text: 'older', updatedAtMs: 100 } ) ],
		} );
		expect(
			layer
				.get( 2 )
				?.element.querySelector( '.os-pinned-note__body' )
				?.textContent,
		).toBe( 'newer' );
	} );

	test( 'trashNote evicts optimistically, DELETEs, and Undo restores', async () => {
		const restored = makeNote( { id: 1, updatedAtMs: 7000 } );
		const fetchSpy = vi.fn( async ( url: string, init?: RequestInit ) => {
			if ( init?.method === 'DELETE' ) {
				return new Response( JSON.stringify( { trashed: true, id: 1 } ), { status: 200 } );
			}
			return new Response( JSON.stringify( restored ), { status: 200 } );
		} );
		vi.stubGlobal( 'fetch', fetchSpy );

		let undoAction: ( () => void ) | null = null;
		const showToast = vi.fn( ( opts: { action?: { onClick: () => void } } ) => {
			undoAction = opts.action?.onClick ?? null;
		} );
		( window as unknown as { wp: { os: { showToast: unknown } } } ).wp = {
			os: { showToast },
		};

		const layer = makeLayer();
		const note = makeNote( { id: 1 } );
		layer.upsertNote( note );
		layer.trashNote( note );

		// Optimistic eviction is synchronous.
		expect( layer.has( 1 ) ).toBe( false );

		await new Promise( ( r ) => setTimeout( r, 10 ) );
		expect(
			fetchSpy.mock.calls.some(
				( call ) =>
					( call[ 1 ] as RequestInit | undefined )?.method === 'DELETE' &&
					String( call[ 0 ] ).endsWith( '/notes/1' ),
			),
		).toBe( true );
		expect( showToast ).toHaveBeenCalledTimes( 1 );

		// Undo → POST /restore → the note returns to the wall.
		undoAction?.();
		await new Promise( ( r ) => setTimeout( r, 10 ) );
		expect(
			fetchSpy.mock.calls.some( ( call ) =>
				String( call[ 0 ] ).endsWith( '/notes/1/restore' ),
			),
		).toBe( true );
		expect( layer.has( 1 ) ).toBe( true );
	} );
} );
