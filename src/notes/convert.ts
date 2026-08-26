/**
 * OpenStation — Pinned notes "convert to post" flow.
 *
 * Spawn a draft post from a note (`POST /notes/:id/convert` server-side),
 * with optimistic eviction, auto-opening the draft in the block editor,
 * and an Undo toast that reverses BOTH sides — restoring the note and
 * discarding the draft (the server's restore route consumes the note→
 * draft link, see `openstation_notes_rest_restore`). Mirrors the trash
 * flow (`src/notes/trash.ts`); the layer injects eviction/restore
 * callbacks so this module stays DOM-free.
 */

import { __ } from '../i18n';
import { broadcastNotesChange } from './broadcast';
import { convertNote, restoreNote } from './rest';
import type { Note } from './types';

interface DesktopApi {
	showToast?: ( opts: {
		message: string;
		duration?: number;
		action?: { label: string; onClick: () => void };
	} ) => void;
	deriveWindowId?: ( url: string, adminUrl?: string ) => string;
	windowManager?: {
		open?: ( config: {
			id: string;
			baseId?: string;
			url: string;
			title?: string;
			icon?: string;
		} ) => unknown;
		getById?: ( id: string ) => { close?: () => void } | undefined;
	};
}

function getDesktopApi(): DesktopApi | null {
	return ( window as { wp?: { os?: DesktopApi } } ).wp?.os ?? null;
}

/**
 * Open the draft's admin edit URL as a chromeless window and return the
 * window id (so Undo can close it again). Falls back to a full-tab
 * navigation only if the window APIs are somehow absent — the shell
 * exposes both at boot, so that path is effectively dead.
 */
function openDraftEditor( url: string ): string | null {
	const api = getDesktopApi();
	if ( ! api?.windowManager?.open || ! api.deriveWindowId ) {
		window.location.href = url;
		return null;
	}
	const id = api.deriveWindowId( url );
	api.windowManager.open( {
		id,
		baseId: id,
		url,
		title: __( 'Edit draft', 'desktop-mode' ),
		icon: 'dashicons-admin-post',
	} );
	return id;
}

export interface ConvertNoteCallbacks {
	/** Remove the note from the wall (optimistic). */
	onEvict( noteId: number ): void;
	/** Put a restored note back (Undo succeeded, or convert failed). */
	onRestore( note: Note ): void;
}

/**
 * Convert with auto-open + Undo. On failure the note is put back so the
 * wall stays truthful. Undo restores the note and (server-side) trashes
 * the draft, then closes the editor window this flow opened.
 */
export async function convertNoteToPost(
	note: Note,
	callbacks: ConvertNoteCallbacks,
): Promise< void > {
	callbacks.onEvict( note.id );
	try {
		const result = await convertNote( note.id );
		// Convert trashes the source note, so the bin gained an item.
		broadcastNotesChange( 'trashed', [ note.id ] );
		const editorWindowId = openDraftEditor( result.editUrl );
		getDesktopApi()?.showToast?.( {
			message: __( 'Note converted to a draft post', 'desktop-mode' ),
			duration: 6000,
			action: {
				label: __( 'Undo', 'desktop-mode' ),
				onClick: () => {
					// Close the editor we auto-opened first — restoring
					// the note also trashes the draft server-side, so
					// leaving its window open would show a trashed post.
					if ( editorWindowId ) {
						getDesktopApi()
							?.windowManager?.getById?.( editorWindowId )
							?.close?.();
					}
					void restoreNote( note.id )
						.then( ( restored ) => {
							broadcastNotesChange( 'untrashed', [ note.id ] );
							callbacks.onRestore( restored );
						} )
						.catch( ( err: unknown ) => {
							// eslint-disable-next-line no-console
							console.error(
								'[openstation] notes: convert undo failed:',
								err,
							);
						} );
				},
			},
		} );
	} catch ( err ) {
		// eslint-disable-next-line no-console
		console.error( '[openstation] notes: convert failed:', err );
		callbacks.onRestore( note );
		getDesktopApi()?.showToast?.( {
			message: __( 'Could not convert the note to a post.', 'desktop-mode' ),
			duration: 5000,
		} );
	}
}
