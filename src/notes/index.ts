/**
 * Desktop Mode — Pinned notes boot.
 *
 * Composes the feature: REST deps, the layer, the drop-handler
 * routes, and the cross-bundle "note created elsewhere" listener
 * (the Note Pad widget POSTs directly when the user pins via the
 * keyboard path and announces the new note with a CustomEvent).
 */

import type { DesktopConfig } from '../types';
import { NotesLayer } from './layer';
import { installNoteDropHandlers } from './drop-handlers';
import { installNotesPostsDropTarget } from './posts-drop-target';
import { installNotesRestDeps } from './rest';
import { NOTE_CREATED_EVENT, type Note } from './types';

export { NotesLayer, NoteController } from './layer';
export { NOTE_CREATED_EVENT } from './types';
export type { Note } from './types';

export interface BootNotesOptions {
	host: HTMLElement;
	config: DesktopConfig;
	onError?: ( message: string ) => void;
}

export function bootNotes( options: BootNotesOptions ): NotesLayer | null {
	const notesUrl = options.config.notesUrl;
	if ( typeof notesUrl !== 'string' || ! notesUrl ) {
		// Older server payload — the routes don't exist; don't probe.
		return null;
	}
	installNotesRestDeps( {
		baseUrl: notesUrl,
		nonce: options.config.restNonce ?? '',
	} );
	const layer = new NotesLayer( {
		host: options.host,
		pluginUrl: options.config.pluginUrl ?? '',
		canCreatePosts: options.config.canCreatePosts ?? false,
		onError: options.onError,
	} );
	installNoteDropHandlers( layer );
	installNotesPostsDropTarget( layer );
	document.addEventListener( NOTE_CREATED_EVENT, ( ev ) => {
		const note = ( ev as CustomEvent< { note?: Note } > ).detail?.note;
		if ( note && typeof note.id === 'number' ) {
			layer.bumpHighWater( note.updatedAtMs );
			const controller = layer.upsertNote( note, { animate: 'thunk' } );
			layer.bringToFront( controller );
			controller.focusEditor();
		}
	} );
	void layer.boot();
	return layer;
}
