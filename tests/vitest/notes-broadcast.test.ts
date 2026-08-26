/**
 * The Recycle Bin's icon tracks deltas off `os.<type>.changed` to know
 * whether it is holding anything. Notes never published it, so the bin
 * still looked empty after one was trashed.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { subscribe } from '../../src/broadcast';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';
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
	// Observed on the real bus, not a `wp.os` mock: the notes module
	// publishes through the shared `announceContentChange()` helper,
	// which rides the module-level broadcast directly.
	let published: Array< Record< string, unknown > >;
	let unsubscribe: () => void;
	let undoAction: ( () => void ) | null;

	beforeEach( () => {
		installHooksStub();
		__resetNotesRestForTests();
		installNotesRestDeps( { baseUrl: 'https://example.test/notes', nonce: 'n' } );
		published = [];
		unsubscribe = subscribe( `os.${ NOTES_POST_TYPE }.changed`, ( payload ) => {
			published.push( payload as Record< string, unknown > );
		} );
		undoAction = null;
		// Merge, never assign: `installHooksStub()` above parked
		// `wp.hooks` on the same global, and the real bus reads it.
		const w = window as unknown as { wp?: Record< string, unknown > };
		w.wp = {
			...( w.wp ?? {} ),
			os: {
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
		unsubscribe();
		vi.unstubAllGlobals();
		clearHooksStub();
		delete ( window as unknown as { wp?: unknown } ).wp;
	} );

	test( 'trashing publishes a trashed delta the bin can count', async () => {
		await trashNoteWithUndo( NOTE, { onEvict: () => undefined, onRestore: () => undefined } );
		expect( published ).toContainEqual(
			expect.objectContaining( { action: 'trashed', ids: [ 7 ] } ),
		);
	} );

	test( 'Undo publishes the matching untrashed delta', async () => {
		await trashNoteWithUndo( NOTE, { onEvict: () => undefined, onRestore: () => undefined } );
		published.length = 0;
		undoAction?.();
		await new Promise( ( r ) => setTimeout( r, 10 ) );
		expect( published ).toContainEqual(
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
		expect( published ).toEqual( [] );
	} );

	test( 'the topic matches the slug the bin config ships', () => {
		// Drift here stops the bin icon updating, silently.
		expect( NOTES_POST_TYPE ).toBe( 'wpd_note' );
	} );
} );
