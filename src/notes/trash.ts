/**
 * Desktop Mode — Pinned notes trash flow.
 *
 * Soft-trash a note (`wp_trash_post` server-side) with optimistic
 * eviction + an Undo toast, mirroring the desktop-files trash UX
 * (`src/desktop-files/trash.ts`). The layer injects eviction/restore
 * callbacks so this module stays DOM-free.
 */

import { __ } from '../i18n';
import { deleteNote, restoreNote } from './rest';
import type { Note } from './types';

interface ToastApi {
	showToast?: ( opts: {
		message: string;
		duration?: number;
		action?: { label: string; onClick: () => void };
	} ) => void;
}

function getToastApi(): ToastApi | null {
	const api = (
		window as { wp?: { desktop?: ToastApi } }
	).wp?.desktop;
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
	callbacks.onEvict( note.id );
	try {
		await deleteNote( note.id );
		getToastApi()?.showToast?.( {
			message: __( 'Note moved to Trash', 'desktop-mode' ),
			duration: 6000,
			action: {
				label: __( 'Undo', 'desktop-mode' ),
				onClick: () => {
					void restoreNote( note.id )
						.then( ( restored ) => callbacks.onRestore( restored ) )
						.catch( ( err: unknown ) => {
							// eslint-disable-next-line no-console
							console.error(
								'[desktop-mode] notes: restore failed:',
								err,
							);
						} );
				},
			},
		} );
	} catch ( err ) {
		// eslint-disable-next-line no-console
		console.error( '[desktop-mode] notes: trash failed:', err );
		callbacks.onRestore( note );
		getToastApi()?.showToast?.( {
			message: __( 'Could not move the note to the Trash.', 'desktop-mode' ),
			duration: 5000,
		} );
	}
}
