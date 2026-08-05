/**
 * Pinned-notes drop routes: the wallpaper canvas seam creates /
 * repositions notes, the recycle-bin seam gates on `canEdit` and
 * soft-trashes, and the coordinate math mirrors the ghost offsets.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	__resetCanvasPayloadHandlersForTests,
	canvasPayloadAccepts,
	canvasPayloadDrop,
} from '../../src/desktop-files/canvas-payloads';
import {
	__resetRecycleBinPayloadHandlersForTests,
	recycleBinPayloadAccepts,
	recycleBinPayloadDrop,
} from '../../src/desktop-files/recycle-bin-payloads';
import { installNoteDropHandlers } from '../../src/notes/drop-handlers';
import { NotesLayer } from '../../src/notes/layer';
import { __resetNotesRestForTests, installNotesRestDeps } from '../../src/notes/rest';
import {
	NOTE_DRAFT_PAYLOAD_TYPE,
	NOTE_PAYLOAD_TYPE,
	type Note,
} from '../../src/notes/types';
import type { DragPayload, DragSession } from '../../src/drag';

function makeNote( overrides: Partial< Note > = {} ): Note {
	return {
		id: 1,
		text: 'note',
		color: 'mint',
		x: 0.1,
		y: 0.1,
		z: 1,
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

function makeSession(
	type: string,
	data: Record< string, unknown >,
	ghost = { offsetX: 104, offsetY: 10 },
): DragSession {
	const payload: DragPayload = {
		type,
		source: document.createElement( 'div' ),
		data,
		ghost,
	};
	return {
		payload,
		isFinished: () => false,
		cancel: () => undefined,
	};
}

function makeLayer(): NotesLayer {
	const host = document.createElement( 'div' );
	// jsdom has no layout — pin down the geometry the math reads.
	Object.defineProperty( host, 'clientWidth', { value: 1000 } );
	Object.defineProperty( host, 'clientHeight', { value: 500 } );
	host.getBoundingClientRect = () =>
		( { left: 0, top: 0, width: 1000, height: 500, right: 1000, bottom: 500, x: 0, y: 0, toJSON: () => ( {} ) } ) as DOMRect;
	document.body.appendChild( host );
	return new NotesLayer( { host, pluginUrl: 'https://example.test/plugin' } );
}

describe( 'note drop handlers', () => {
	let layer: NotesLayer;
	let teardown: () => void;
	let fetchSpy: ReturnType< typeof vi.fn >;

	beforeEach( () => {
		__resetCanvasPayloadHandlersForTests();
		__resetRecycleBinPayloadHandlersForTests();
		__resetNotesRestForTests();
		installNotesRestDeps( { baseUrl: 'https://example.test/notes', nonce: 'n' } );
		fetchSpy = vi.fn( async () =>
			new Response(
				JSON.stringify( makeNote( { id: 42, updatedAtMs: 2000 } ) ),
				{ status: 200 },
			),
		);
		vi.stubGlobal( 'fetch', fetchSpy );
		layer = makeLayer();
		teardown = installNoteDropHandlers( layer );
	} );

	afterEach( () => {
		teardown();
		document.body.innerHTML = '';
		vi.unstubAllGlobals();
	} );

	test( 'draft payloads are accepted on the wallpaper root only', () => {
		const ctx = { folderId: 0, host: layer.host };
		const folderCtx = { folderId: 7, host: layer.host };
		const payload = makeSession( NOTE_DRAFT_PAYLOAD_TYPE, {
			text: 'hi',
			color: 'mint',
			isPublic: false,
		} ).payload;
		expect( canvasPayloadAccepts( payload, ctx ) ).toBe( true );
		expect( canvasPayloadAccepts( payload, folderCtx ) ).toBe( false );
	} );

	test( 'empty drafts are refused', () => {
		const ctx = { folderId: 0, host: layer.host };
		const payload = makeSession( NOTE_DRAFT_PAYLOAD_TYPE, {
			text: '   ',
			color: 'mint',
			isPublic: false,
		} ).payload;
		expect( canvasPayloadAccepts( payload, ctx ) ).toBe( false );
	} );

	test( 'draft drop creates a note at the ghost-adjusted position', async () => {
		const session = makeSession( NOTE_DRAFT_PAYLOAD_TYPE, {
			text: 'new note',
			color: 'lilac',
			isPublic: true,
		} );
		// Cursor at (304, 110) minus ghost offset (104, 10) → note
		// top-left at (200, 100) → normalized (0.2, 0.2).
		const handled = canvasPayloadDrop(
			session,
			{ clientX: 304, clientY: 110 },
			{ folderId: 0, host: layer.host },
		);
		expect( handled ).toBe( true );

		// Optimistic controller mounted immediately.
		const optimistic = document.querySelector( '.os-pinned-note' );
		expect( optimistic ).not.toBeNull();

		await new Promise( ( r ) => setTimeout( r, 10 ) );
		const createCall = fetchSpy.mock.calls.find(
			( call ) => ( call[ 1 ] as RequestInit | undefined )?.method === 'POST',
		);
		expect( createCall ).toBeDefined();
		const body = JSON.parse( String( ( createCall?.[ 1 ] as RequestInit ).body ) );
		expect( body.text ).toBe( 'new note' );
		expect( body.color ).toBe( 'lilac' );
		expect( body.public ).toBe( true );
		expect( body.x ).toBeCloseTo( 0.2, 5 );
		expect( body.y ).toBeCloseTo( 0.2, 5 );
		// Jitter seed: hashed from the text at creation and persisted.
		expect( body.seed ).toBeGreaterThan( 0 );
		// The optimistic temp id was rekeyed to the server id.
		expect( layer.has( 42 ) ).toBe( true );
	} );

	test( 'failed create removes the optimistic note', async () => {
		fetchSpy.mockResolvedValueOnce(
			new Response( JSON.stringify( { code: 'boom', message: 'nope' } ), { status: 500 } ),
		);
		const session = makeSession( NOTE_DRAFT_PAYLOAD_TYPE, {
			text: 'doomed',
			color: 'mint',
			isPublic: false,
		} );
		canvasPayloadDrop(
			session,
			{ clientX: 300, clientY: 100 },
			{ folderId: 0, host: layer.host },
		);
		expect( document.querySelector( '.os-pinned-note' ) ).not.toBeNull();
		await new Promise( ( r ) => setTimeout( r, 10 ) );
		expect( document.querySelector( '.os-pinned-note' ) ).toBeNull();
	} );

	test( 'note drop repositions an existing note and PATCHes', async () => {
		const controller = layer.upsertNote( makeNote( { id: 9 } ) );
		const session = makeSession( NOTE_PAYLOAD_TYPE, {
			noteId: 9,
			canEdit: true,
			updatedAtMs: 1000,
		} );
		canvasPayloadDrop(
			session,
			{ clientX: 604, clientY: 260 },
			{ folderId: 0, host: layer.host },
		);
		// (604-104)/1000 = 0.5, (260-10)/500 = 0.5.
		expect( controller.note.x ).toBeCloseTo( 0.5, 5 );
		expect( controller.note.y ).toBeCloseTo( 0.5, 5 );
		expect( parseFloat( controller.element.style.left ) ).toBeCloseTo( 50, 3 );

		await new Promise( ( r ) => setTimeout( r, 10 ) );
		const patch = fetchSpy.mock.calls.find(
			( call ) => ( call[ 1 ] as RequestInit | undefined )?.method === 'PATCH',
		);
		expect( patch ).toBeDefined();
		const body = JSON.parse( String( ( patch?.[ 1 ] as RequestInit ).body ) );
		expect( body.x ).toBeCloseTo( 0.5, 5 );
		expect( body.updatedAtMs ).toBe( 1000 );
	} );

	test( 'recycle bin accepts only editable notes', () => {
		const mine = makeSession( NOTE_PAYLOAD_TYPE, {
			noteId: 1,
			canEdit: true,
			updatedAtMs: 1,
		} ).payload;
		const theirs = makeSession( NOTE_PAYLOAD_TYPE, {
			noteId: 2,
			canEdit: false,
			updatedAtMs: 1,
		} ).payload;
		expect( recycleBinPayloadAccepts( mine ) ).toBe( true );
		expect( recycleBinPayloadAccepts( theirs ) ).toBe( false );
	} );

	test( 'recycle bin drop evicts + DELETEs the note', async () => {
		layer.upsertNote( makeNote( { id: 9 } ) );
		const session = makeSession( NOTE_PAYLOAD_TYPE, {
			noteId: 9,
			canEdit: true,
			updatedAtMs: 1000,
		} );
		const handled = recycleBinPayloadDrop( session, { clientX: 300, clientY: 300 } );
		expect( handled ).toBe( true );
		expect( layer.has( 9 ) ).toBe( false );
		await new Promise( ( r ) => setTimeout( r, 10 ) );
		expect(
			fetchSpy.mock.calls.some(
				( call ) =>
					( call[ 1 ] as RequestInit | undefined )?.method === 'DELETE' &&
					String( call[ 0 ] ).endsWith( '/notes/9' ),
			),
		).toBe( true );
	} );

	test( 'unknown payload types fall through both seams', () => {
		const alien = makeSession( 'desktop-file', { anything: true } ).payload;
		expect(
			canvasPayloadAccepts( alien, { folderId: 0, host: layer.host } ),
		).toBe( false );
		expect( recycleBinPayloadAccepts( alien ) ).toBe( false );
	} );
} );
