/**
 * OpenStation — Pinned notes trash flow.
 *
 * Soft-trash a note (`wp_trash_post` server-side) with optimistic
 * eviction + an Undo toast, mirroring the desktop-files trash UX
 * (`src/desktop-files/trash.ts`). The layer injects eviction/restore
 * callbacks so this module stays DOM-free.
 */

import { beginTrashChange, trashItem } from '../desktop-files/trash-optimistic';
import { describeRestFailure } from '../core/rest-failure';
import { __ } from '../i18n';
import { broadcastNotesChange } from './broadcast';
import { deleteNote, restoreNote } from './rest';
import { NOTES_POST_TYPE, type Note } from './types';

interface ToastApi {
	showToast?: ( opts: {
		message: string;
		type?: string;
		duration?: number;
		action?: { label: string; onClick: () => void };
	} ) => void;
}

function getToastApi(): ToastApi | null {
	const api = (
		window as { wp?: { os?: ToastApi } }
	).wp?.os;
	return api && typeof api.showToast === 'function' ? api : null;
}

export interface TrashNoteCallbacks {
	/** Remove the note from the wall (optimistic). */
	onEvict( noteId: number ): void;
	/** Put a restored note back (Undo succeeded). */
	onRestore( note: Note ): void;
}

/**
 * Trash with Undo. Rollback on REST failure calls `onRestore` with
 * the original note so the wall stays truthful.
 */
export async function trashNoteWithUndo(
	note: Note,
	callbacks: TrashNoteCallbacks,
): Promise< void > {
	const optimistic = beginTrashChange( trashItem( { id: note.id, type: NOTES_POST_TYPE, title: note.text } ) );
	if ( ! optimistic ) {
		return;
	}
	callbacks.onEvict( note.id );
	try {
		await deleteNote( note.id );
		// The bin gained an item — tell its icon.
		broadcastNotesChange( 'trashed', [ note.id ] );
		void optimistic.finish( true );
		getToastApi()?.showToast?.( {
			message: __( 'Note moved to Trash', 'desktop-mode' ),
			duration: 6000,
			action: {
				label: __( 'Undo', 'desktop-mode' ),
				onClick: () => {
					const undo = beginTrashChange( trashItem( { id: note.id, type: NOTES_POST_TYPE, title: note.text } ), 'out' );
					void restoreNote( note.id )
						.then( ( restored ) => {
							broadcastNotesChange( 'untrashed', [ note.id ] );
							callbacks.onRestore( restored );
							void undo?.finish( true );
						} )
						.catch( ( err: unknown ) => {
							void undo?.finish( false );
							// eslint-disable-next-line no-console
							console.error(
								'[openstation] notes: restore failed:',
								err,
							);
							// The Undo toast is gone by now; say why the
							// note did not come back rather than nothing.
							getToastApi()?.showToast?.( {
								...describeRestFailure( err, {
									fallback: __( 'Could not restore the note.', 'desktop-mode' ),
								} ),
								duration: 5000,
							} );
						} );
				},
			},
		} );
	} catch ( err ) {
		// eslint-disable-next-line no-console
		console.error( '[openstation] notes: trash failed:', err );
		void optimistic.finish( false );
		callbacks.onRestore( note );
		getToastApi()?.showToast?.( {
			...describeRestFailure( err, {
				fallback: __( 'Could not move the note to the Trash.', 'desktop-mode' ),
			} ),
			duration: 5000,
		} );
	}
}
