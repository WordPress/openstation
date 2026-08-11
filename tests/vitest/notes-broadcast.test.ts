/**
 * The Recycle Bin badge counts deltas off `os.<type>.changed`. Notes
 * never published it, so the badge went stale on every trash.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { trashNoteWithUndo } from '../../src/notes/trash';
import { NOTES_POST_TYPE, type Note } from '../../src/notes/types';
import {
	__resetNotesRestForTests,
	installNotesRestDeps,
} from '../../src/notes/rest';

const NOTE: Note = {
	id: 7,
	text: 'bin me',
	color: 'sky',
	x: 0.2,
	y: 0.3,
	z: 4,
	public: false,
	seed: 77,
	ownerId: 1,
	ownerName: 'Ana',
	ownerAvatar: '',
	canEdit: true,
	updatedAtMs: 1000,
};

describe( 'notes bin broadcast', () => {
	let broadcast: ReturnType< typeof vi.fn >;
	let undoAction: ( () => void ) | null;

	beforeEach( () => {
		__resetNotesRestForTests();
		installNotesRestDeps( { baseUrl: 'https://example.test/notes', nonce: 'n' } );
		broadcast = vi.fn();
		undoAction = null;
		( window as unknown as { wp: { os: Record< string, unknown > } } ).wp = {
			os: {
				broadcast,
				showToast: ( opts: { action?: { onClick: () => void } } ) => {
					undoAction = opts.action?.onClick ?? null;
				},
			},
		};
		vi.stubGlobal(
			'fetch',
			vi.fn( async ( _url: string, init?: RequestInit ) =>
				init?.method === 'DELETE'
					? new Response( JSON.stringify( { trashed: true, id: 7 } ), { status: 200 } )
					: new Response( JSON.stringify( NOTE ), { status: 200 } ),
			),
		);
	} );

	afterEach( () => {
		vi.unstubAllGlobals();
		delete ( window as unknown as { wp?: unknown } ).wp;
	} );

	test( 'trashing publishes a trashed delta the badge can count', async () => {
		await trashNoteWithUndo( NOTE, { onEvict: () => undefined, onRestore: () => undefined } );
		expect( broadcast ).toHaveBeenCalledWith(
			`os.${ NOTES_POST_TYPE }.changed`,
			expect.objectContaining( { action: 'trashed', ids: [ 7 ] } ),
		);
	} );

	test( 'Undo publishes the matching untrashed delta', async () => {
		await trashNoteWithUndo( NOTE, { onEvict: () => undefined, onRestore: () => undefined } );
		broadcast.mockClear();
		undoAction?.();
		await new Promise( ( r ) => setTimeout( r, 10 ) );
		expect( broadcast ).toHaveBeenCalledWith(
			`os.${ NOTES_POST_TYPE }.changed`,
			expect.objectContaining( { action: 'untrashed', ids: [ 7 ] } ),
		);
	} );

	test( 'a failed trash publishes nothing — the note never left the wall', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn( async () => new Response( '{"code":"nope"}', { status: 500 } ) ),
		);
		vi.spyOn( console, 'error' ).mockImplementation( () => undefined );
		await trashNoteWithUndo( NOTE, { onEvict: () => undefined, onRestore: () => undefined } );
		expect( broadcast ).not.toHaveBeenCalled();
	} );

	test( 'the topic matches the slug the bin config ships', () => {
		// Drift here stops the badge updating, silently.
		expect( NOTES_POST_TYPE ).toBe( 'wpd_note' );
	} );
} );
