/**
 * Pinned-notes "convert to post" flow: optimistic eviction, auto-open
 * of the draft editor, and the Undo toast that restores the note and
 * closes the editor window it opened.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Note } from '../../src/notes/types';

const convertNoteMock = vi.fn();
const restoreNoteMock = vi.fn();

vi.mock( '../../src/notes/rest', () => ( {
	convertNote: ( ...args: unknown[] ) => convertNoteMock( ...args ),
	restoreNote: ( ...args: unknown[] ) => restoreNoteMock( ...args ),
} ) );

// Imported after the mock is registered.
import { convertNoteToPost } from '../../src/notes/convert';

const NOTE: Note = {
	id: 7,
	text: 'draft me',
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

describe( 'convertNoteToPost', () => {
	let showToast: ReturnType< typeof vi.fn >;
	let openWindow: ReturnType< typeof vi.fn >;
	let closeWindow: ReturnType< typeof vi.fn >;
	let getById: ReturnType< typeof vi.fn >;

	beforeEach( () => {
		convertNoteMock.mockReset();
		restoreNoteMock.mockReset();
		showToast = vi.fn();
		openWindow = vi.fn();
		closeWindow = vi.fn();
		getById = vi.fn( () => ( { close: closeWindow } ) );
		( window as unknown as { wp: unknown } ).wp = {
			desktop: {
				showToast,
				deriveWindowId: ( url: string ) => `win:${ url }`,
				windowManager: { open: openWindow, getById },
			},
		};
	} );

	afterEach( () => {
		delete ( window as unknown as { wp?: unknown } ).wp;
	} );

	test( 'evicts, opens the editor, and shows an Undo toast on success', async () => {
		convertNoteMock.mockResolvedValueOnce( {
			noteId: 7,
			postId: 99,
			editUrl: 'https://x.test/wp-admin/post.php?post=99&action=edit',
		} );
		const onEvict = vi.fn();
		const onRestore = vi.fn();

		await convertNoteToPost( NOTE, { onEvict, onRestore } );

		expect( onEvict ).toHaveBeenCalledWith( 7 );
		expect( convertNoteMock ).toHaveBeenCalledWith( 7 );
		expect( openWindow ).toHaveBeenCalledTimes( 1 );
		expect( openWindow.mock.calls[ 0 ][ 0 ].url ).toContain( 'post=99' );
		expect( showToast ).toHaveBeenCalledTimes( 1 );
		expect( showToast.mock.calls[ 0 ][ 0 ].action.label ).toBeTruthy();
	} );

	test( 'Undo restores the note and closes the editor window', async () => {
		convertNoteMock.mockResolvedValueOnce( {
			noteId: 7,
			postId: 99,
			editUrl: 'https://x.test/wp-admin/post.php?post=99&action=edit',
		} );
		restoreNoteMock.mockResolvedValueOnce( { ...NOTE } );
		const onRestore = vi.fn();

		await convertNoteToPost( NOTE, { onEvict: vi.fn(), onRestore } );
		// Fire the Undo action.
		await showToast.mock.calls[ 0 ][ 0 ].action.onClick();
		// Let the restore promise settle.
		await vi.waitFor( () => expect( onRestore ).toHaveBeenCalled() );

		expect( closeWindow ).toHaveBeenCalledTimes( 1 );
		expect( restoreNoteMock ).toHaveBeenCalledWith( 7 );
	} );

	test( 'a convert failure rolls the note back and warns', async () => {
		convertNoteMock.mockRejectedValueOnce( new Error( 'boom' ) );
		const onRestore = vi.fn();
		const errorSpy = vi.spyOn( console, 'error' ).mockImplementation( () => {} );

		await convertNoteToPost( NOTE, { onEvict: vi.fn(), onRestore } );

		expect( onRestore ).toHaveBeenCalledWith( NOTE );
		expect( openWindow ).not.toHaveBeenCalled();
		expect( showToast ).toHaveBeenCalledTimes( 1 );
		errorSpy.mockRestore();
	} );
} );
