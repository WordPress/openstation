/**
 * Pinned-notes layer: owner vs read-only rendering, z-order,
 * heartbeat deltas, virtual-desktop scoping, the wallpaper-menu
 * create path, and the trash/restore round trip.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { NotesLayer } from '../../src/notes/layer';
import { __resetNotesHeartbeatForTests } from '../../src/notes/heartbeat';
import { __resetNotesRestForTests, installNotesRestDeps } from '../../src/notes/rest';
import type { Note } from '../../src/notes/types';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

function makeNote( overrides: Partial< Note > = {} ): Note {
	return {
		id: 1,
		text: 'buy milk',
		color: 'butter',
		x: 0.1,
		y: 0.2,
		z: 3,
		public: false,
		desktop: '',
		seed: 123,
		ownerId: 5,
		ownerName: 'Me',
		ownerAvatar: '',
		canEdit: true,
		updatedAtMs: 1000,
		...overrides,
	};
}

function makeLayer(
	options: {
		activeDesktopId?: string;
		desktopIds?: string[];
	} = {},
): NotesLayer {
	const host = document.createElement( 'div' );
	// jsdom has no layout — pin down the geometry the position math reads.
	Object.defineProperty( host, 'clientWidth', { value: 1000 } );
	Object.defineProperty( host, 'clientHeight', { value: 500 } );
	host.getBoundingClientRect = () =>
		( {
			left: 0,
			top: 0,
			width: 1000,
			height: 500,
			right: 1000,
			bottom: 500,
			x: 0,
			y: 0,
			toJSON: () => ( {} ),
		} ) as DOMRect;
	document.body.appendChild( host );
	return new NotesLayer( {
		host,
		pluginUrl: 'https://example.test/plugin',
		getActiveDesktopId: () => options.activeDesktopId ?? 'desktop-1',
		getDesktopIds: () => options.desktopIds ?? [ 'desktop-1' ],
	} );
}

describe( 'NotesLayer', () => {
	beforeEach( () => {
		installHooksStub();
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
		clearHooksStub();
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

	test( 'a note bound to another desktop is hidden from the wall', () => {
		const layer = makeLayer( {
			activeDesktopId: 'desktop-1',
			desktopIds: [ 'desktop-1', 'desktop-2' ],
		} );
		const here = layer.upsertNote( makeNote( { id: 1, desktop: 'desktop-1' } ) );
		const elsewhere = layer.upsertNote( makeNote( { id: 2, desktop: 'desktop-2' } ) );
		const everywhere = layer.upsertNote( makeNote( { id: 3, desktop: '' } ) );
		expect( here.element.hasAttribute( 'hidden' ) ).toBe( false );
		expect( elsewhere.element.hasAttribute( 'hidden' ) ).toBe( true );
		expect( everywhere.element.hasAttribute( 'hidden' ) ).toBe( false );
	} );

	test( 'a binding naming no existing desktop shows everywhere', () => {
		// Another session closed desktop-4 while this one was shut; the
		// migration hook never reached us. Stranding the note on no
		// wall at all would leave no way to get it back.
		const layer = makeLayer( {
			activeDesktopId: 'desktop-1',
			desktopIds: [ 'desktop-1', 'desktop-2' ],
		} );
		const orphan = layer.upsertNote( makeNote( { id: 1, desktop: 'desktop-4' } ) );
		expect( orphan.element.hasAttribute( 'hidden' ) ).toBe( false );
	} );

	test( 'a public note ignores its desktop binding', () => {
		// The id was minted on the author's shell; scoping a shared note
		// by it would hide it from the people it was shared with.
		const layer = makeLayer( { activeDesktopId: 'desktop-1' } );
		const controller = layer.upsertNote(
			makeNote( { id: 1, public: true, desktop: 'desktop-9', canEdit: false } ),
		);
		expect( controller.element.hasAttribute( 'hidden' ) ).toBe( false );
	} );

	test( 'the desktop toggle only renders with more than one desktop', () => {
		const single = makeLayer( { desktopIds: [ 'desktop-1' ] } );
		expect(
			single.upsertNote( makeNote() ).element.querySelector(
				'.os-pinned-note__desktop',
			),
		).toBeNull();

		const multi = makeLayer( {
			desktopIds: [ 'desktop-1', 'desktop-2', 'desktop-3' ],
		} );
		const button = multi
			.upsertNote( makeNote() )
			.element.querySelector( '.os-pinned-note__desktop' );
		expect( button ).not.toBeNull();
		// Unbound note → the control offers to pin it here.
		expect( button?.getAttribute( 'title' ) ).toContain( 'pin to this desktop' );
		// It lives in the footer, clear of the pushpin's 56px band.
		expect( button?.parentElement?.className ).toBe( 'os-pinned-note__footer' );
	} );

	test( 'adding a desktop mid-session grows the toggle in', async () => {
		// The control is built once, at paint. If its presence were
		// decided there too, a note pinned while the session had one
		// desktop would be stranded: hidden on the new desktop, with no
		// control on the old one to unbind it, until a reload.
		let desktops = [ 'desktop-1' ];
		const host = document.createElement( 'div' );
		document.body.appendChild( host );
		const layer = new NotesLayer( {
			host,
			pluginUrl: 'https://example.test/plugin',
			getActiveDesktopId: () => 'desktop-1',
			getDesktopIds: () => desktops,
		} );
		await layer.boot();

		const controller = layer.upsertNote( makeNote( { desktop: 'desktop-1' } ) );
		expect(
			controller.element.querySelector( '.os-pinned-note__desktop' ),
		).toBeNull();

		const { doAction, HOOKS } = await import( '../../src/hooks' );
		desktops = [ 'desktop-1', 'desktop-2' ];
		doAction( HOOKS.DESKTOP_CREATED, { desktopId: 'desktop-2' } );

		const button = controller.element.querySelector( '.os-pinned-note__desktop' );
		expect( button ).not.toBeNull();
		expect( button?.getAttribute( 'title' ) ).toContain( 'show on all desktops' );

		// And closing back down to one desktop takes it away again.
		desktops = [ 'desktop-1' ];
		doAction( HOOKS.DESKTOP_CLOSED, {
			desktopId: 'desktop-2',
			migratedTo: 'desktop-1',
		} );
		expect(
			controller.element.querySelector( '.os-pinned-note__desktop' ),
		).toBeNull();
	} );

	test( 'a public note carries no desktop toggle at all', () => {
		// Not a disabled one: <os-window-button> has no disabled state,
		// so a greyed-out button would still be keyboard-reachable and
		// do nothing.
		const layer = makeLayer( { desktopIds: [ 'desktop-1', 'desktop-2' ] } );
		const controller = layer.upsertNote( makeNote( { public: true } ) );
		expect(
			controller.element.querySelector( '.os-pinned-note__desktop' ),
		).toBeNull();

		// Made private again, the control comes back in the footer.
		controller.replace( makeNote( { public: false, updatedAtMs: 2000 } ) );
		const button = controller.element.querySelector( '.os-pinned-note__desktop' );
		expect( button ).not.toBeNull();
		expect( button?.parentElement?.className ).toBe( 'os-pinned-note__footer' );
	} );

	test( 'setDesktop re-scopes the note and PATCHes the binding', async () => {
		const fetchSpy = vi.fn( async () =>
			new Response( JSON.stringify( makeNote( { desktop: 'desktop-2', updatedAtMs: 2000 } ) ), {
				status: 200,
			} ),
		);
		vi.stubGlobal( 'fetch', fetchSpy );

		const layer = makeLayer( {
			activeDesktopId: 'desktop-1',
			desktopIds: [ 'desktop-1', 'desktop-2' ],
		} );
		const controller = layer.upsertNote( makeNote( { id: 1 } ) );
		controller.setDesktop( 'desktop-2' );

		// Bound elsewhere → off this wall immediately.
		expect( controller.element.hasAttribute( 'hidden' ) ).toBe( true );
		await new Promise( ( r ) => setTimeout( r, 10 ) );
		const patch = fetchSpy.mock.calls.find(
			( call ) => ( call[ 1 ] as RequestInit | undefined )?.method === 'PATCH',
		);
		expect( patch ).toBeDefined();
		expect(
			JSON.parse( String( ( patch?.[ 1 ] as RequestInit ).body ) ).desktop,
		).toBe( 'desktop-2' );
	} );

	test( 'closing a desktop re-homes its notes onto the survivor', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn( async () =>
				new Response( JSON.stringify( makeNote( { desktop: 'desktop-1' } ) ), {
					status: 200,
				} ),
			),
		);
		const layer = makeLayer( {
			activeDesktopId: 'desktop-1',
			desktopIds: [ 'desktop-1', 'desktop-2' ],
		} );
		await layer.boot();
		const mine = layer.upsertNote( makeNote( { id: 1, desktop: 'desktop-2' } ) );
		const theirs = layer.upsertNote(
			makeNote( { id: 2, desktop: 'desktop-2', canEdit: false } ),
		);

		const { doAction, HOOKS } = await import( '../../src/hooks' );
		doAction( HOOKS.DESKTOP_CLOSED, {
			desktopId: 'desktop-2',
			migratedTo: 'desktop-1',
		} );

		expect( mine.note.desktop ).toBe( 'desktop-1' );
		expect( mine.element.hasAttribute( 'hidden' ) ).toBe( false );
		// Someone else's note isn't ours to re-home.
		expect( theirs.note.desktop ).toBe( 'desktop-2' );
	} );

	test( 'createNoteAt pins optimistically, binds the desktop, and POSTs', async () => {
		const fetchSpy = vi.fn( async () =>
			new Response(
				JSON.stringify(
					makeNote( { id: 77, text: '', desktop: 'desktop-2', updatedAtMs: 3000 } ),
				),
				{ status: 200 },
			),
		);
		vi.stubGlobal( 'fetch', fetchSpy );

		const layer = makeLayer( {
			activeDesktopId: 'desktop-2',
			desktopIds: [ 'desktop-1', 'desktop-2' ],
		} );
		const controller = layer.createNoteAt( { x: 0.4, y: 0.6, focus: true } );

		// Paper is on the wall before the network answers.
		expect( controller.element.isConnected ).toBe( true );
		expect( controller.note.id ).toBeLessThan( 0 );
		expect( controller.note.desktop ).toBe( 'desktop-2' );

		await new Promise( ( r ) => setTimeout( r, 10 ) );
		const post = fetchSpy.mock.calls.find(
			( call ) => ( call[ 1 ] as RequestInit | undefined )?.method === 'POST',
		);
		expect( post ).toBeDefined();
		const body = JSON.parse( String( ( post?.[ 1 ] as RequestInit ).body ) );
		expect( body.desktop ).toBe( 'desktop-2' );
		expect( body.x ).toBeCloseTo( 0.4 );
		// The temp id gave way to the server's.
		expect( layer.has( 77 ) ).toBe( true );
	} );

	test( 'empty notes still get distinct tilts', () => {
		// The wallpaper-menu path always starts with empty text, and
		// hashNoteSeed('') is a constant, so seeding from text alone
		// would give every note from the primary creation path the same
		// tilt and pin offset. A wall of parallel paper is exactly what
		// the seed exists to prevent.
		const layer = makeLayer();
		const a = layer.createNoteAt( { x: 0.2, y: 0.3 } );
		const b = layer.createNoteAt( { x: 0.6, y: 0.7 } );
		expect( a.note.seed ).not.toBe( b.note.seed );
		expect( a.element.style.getPropertyValue( '--dm-note-rot' ) ).not.toBe(
			b.element.style.getPropertyValue( '--dm-note-rot' ),
		);
		// Notes WITH text keep hashing from the text — the documented
		// invariant the drop path relies on.
		const c = layer.createNoteAt( { x: 0.2, y: 0.3, text: 'buy milk' } );
		expect( c.note.seed ).not.toBe( a.note.seed );
	} );

	test( 'notes created public, or on a single-desktop session, stay unbound', () => {
		const multi = makeLayer( {
			activeDesktopId: 'desktop-2',
			desktopIds: [ 'desktop-1', 'desktop-2' ],
		} );
		expect(
			multi.createNoteAt( { x: 0.1, y: 0.1, text: 'shared', isPublic: true } )
				.note.desktop,
		).toBe( '' );

		// One desktop means no choice to record — and binding here
		// would leave a later second desktop mysteriously bare.
		const single = makeLayer( { desktopIds: [ 'desktop-1' ] } );
		expect(
			single.createNoteAt( { x: 0.1, y: 0.1, text: 'solo' } ).note.desktop,
		).toBe( '' );
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
		// Merge, don't replace — the hooks stub lives on `window.wp` too.
		( window as unknown as { wp: { os: { showToast: unknown } } } ).wp.os = {
			showToast,
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
