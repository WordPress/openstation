/**
 * Pinned-notes REST client: URL shapes, payload mapping, and the
 * typed 409 conflict error carrying the server's current copy.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	__resetNotesRestForTests,
	convertNote,
	createNote,
	deleteNote,
	installNotesRestDeps,
	isNotesConflict,
	listNotes,
	NotesConflictError,
	restoreNote,
	updateNote,
} from '../../src/notes/rest';
import type { Note } from '../../src/notes/types';

const NOTE: Note = {
	id: 12,
	text: 'hello',
	color: 'sky',
	x: 0.2,
	y: 0.3,
	z: 4,
	public: false,
	desktop: '',
	seed: 77,
	ownerId: 1,
	ownerName: 'Ana',
	ownerAvatar: '',
	canEdit: true,
	updatedAtMs: 1000,
};

function jsonResponse( body: unknown, status = 200 ): Response {
	return new Response( JSON.stringify( body ), {
		status,
		headers: { 'Content-Type': 'application/json' },
	} );
}

describe( 'notes REST client', () => {
	let fetchSpy: ReturnType< typeof vi.fn >;

	beforeEach( () => {
		__resetNotesRestForTests();
		installNotesRestDeps( {
			baseUrl: 'https://example.test/wp-json/desktop-mode/v1/notes',
			nonce: 'nonce-1',
		} );
		fetchSpy = vi.fn( async () => jsonResponse( { notes: [] } ) );
		vi.stubGlobal( 'fetch', fetchSpy );
	} );

	afterEach( () => {
		vi.unstubAllGlobals();
	} );

	test( 'listNotes hits the collection URL verbatim — no trailing slash', async () => {
		await listNotes();
		expect( fetchSpy ).toHaveBeenCalledTimes( 1 );
		expect( String( fetchSpy.mock.calls[ 0 ][ 0 ] ) ).toBe(
			'https://example.test/wp-json/desktop-mode/v1/notes',
		);
		const init = fetchSpy.mock.calls[ 0 ][ 1 ] as RequestInit;
		expect( ( init.headers as Headers ).get( 'X-WP-Nonce' ) ).toBe( 'nonce-1' );
	} );

	test( 'createNote POSTs the draft body', async () => {
		fetchSpy.mockResolvedValueOnce( jsonResponse( NOTE ) );
		const note = await createNote( {
			text: 'hello',
			color: 'sky',
			x: 0.2,
			y: 0.3,
			public: false,
			desktop: 'desktop-2',
		} );
		expect( note.id ).toBe( 12 );
		const init = fetchSpy.mock.calls[ 0 ][ 1 ] as RequestInit;
		expect( init.method ).toBe( 'POST' );
		expect( JSON.parse( String( init.body ) ) ).toEqual( {
			text: 'hello',
			color: 'sky',
			x: 0.2,
			y: 0.3,
			public: false,
			desktop: 'desktop-2',
		} );
	} );

	test( 'updateNote PATCHes the item route with the concurrency token', async () => {
		fetchSpy.mockResolvedValueOnce( jsonResponse( { ...NOTE, updatedAtMs: 2000 } ) );
		const note = await updateNote( 12, { x: 0.5, updatedAtMs: 1000 } );
		expect( note.updatedAtMs ).toBe( 2000 );
		expect( String( fetchSpy.mock.calls[ 0 ][ 0 ] ) ).toContain( '/notes/12' );
		const init = fetchSpy.mock.calls[ 0 ][ 1 ] as RequestInit;
		expect( init.method ).toBe( 'PATCH' );
	} );

	test( '409 becomes a NotesConflictError carrying the server copy', async () => {
		fetchSpy.mockResolvedValueOnce(
			jsonResponse(
				{
					code: 'openstation_notes_conflict',
					message: 'changed',
					data: { status: 409, current: { ...NOTE, text: 'server' } },
				},
				409,
			),
		);
		let caught: unknown = null;
		try {
			await updateNote( 12, { text: 'mine', updatedAtMs: 1 } );
		} catch ( err ) {
			caught = err;
		}
		expect( isNotesConflict( caught ) ).toBe( true );
		expect( ( caught as NotesConflictError ).current?.text ).toBe( 'server' );
	} );

	test( 'delete + restore hit the item routes', async () => {
		fetchSpy.mockResolvedValueOnce( jsonResponse( { trashed: true, id: 12 } ) );
		await deleteNote( 12 );
		fetchSpy.mockResolvedValueOnce( jsonResponse( NOTE ) );
		await restoreNote( 12 );
		expect( String( fetchSpy.mock.calls[ 0 ][ 0 ] ) ).toContain( '/notes/12' );
		expect( ( fetchSpy.mock.calls[ 0 ][ 1 ] as RequestInit ).method ).toBe( 'DELETE' );
		expect( String( fetchSpy.mock.calls[ 1 ][ 0 ] ) ).toContain( '/notes/12/restore' );
		expect( ( fetchSpy.mock.calls[ 1 ][ 1 ] as RequestInit ).method ).toBe( 'POST' );
	} );

	test( 'convertNote POSTs the convert route and returns the draft link', async () => {
		fetchSpy.mockResolvedValueOnce(
			jsonResponse( {
				noteId: 12,
				postId: 99,
				editUrl: 'https://example.test/wp-admin/post.php?post=99&action=edit',
			} ),
		);
		const result = await convertNote( 12 );
		expect( result.postId ).toBe( 99 );
		expect( result.editUrl ).toContain( 'post=99' );
		expect( String( fetchSpy.mock.calls[ 0 ][ 0 ] ) ).toContain(
			'/notes/12/convert',
		);
		expect( ( fetchSpy.mock.calls[ 0 ][ 1 ] as RequestInit ).method ).toBe(
			'POST',
		);
	} );

	test( 'non-409 errors surface code + message', async () => {
		fetchSpy.mockResolvedValueOnce(
			jsonResponse(
				{ code: 'openstation_notes_forbidden', message: 'Only the note owner can change it.' },
				403,
			),
		);
		await expect( updateNote( 12, { text: 'x' } ) ).rejects.toThrow(
			/403.*openstation_notes_forbidden/,
		);
	} );
} );
