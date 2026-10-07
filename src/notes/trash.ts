import { beginTrashChange, trashItem } from '../desktop-files/trash-optimistic';
import { toastRestFailure } from '../core/rest-failure';
import { shellToast } from '../core/shell-toast';
import { __ } from '../i18n';
import { broadcastNotesChange } from './broadcast';
import { deleteNote, restoreNote } from './rest';
import { NOTES_POST_TYPE, type Note } from './types';

export interface TrashNoteCallbacks {

	onEvict( noteId: number ): void;

	onRestore( note: Note ): void;
}

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

		broadcastNotesChange( 'trashed', [ note.id ] );
		void optimistic.finish( true );
		shellToast( {
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

							console.error(
								'[openstation] notes: restore failed:',
								err,
							);

							toastRestFailure( shellToast, err, {
								fallback: __( 'Could not restore the note.', 'desktop-mode' ),
								duration: 5000,
							} );
						} );
				},
			},
		} );
	} catch ( err ) {
		console.error( '[openstation] notes: trash failed:', err );
		void optimistic.finish( false );
		callbacks.onRestore( note );
		toastRestFailure( shellToast, err, {
			fallback: __( 'Could not move the note to the Trash.', 'desktop-mode' ),
			duration: 5000,
		} );
	}
}
