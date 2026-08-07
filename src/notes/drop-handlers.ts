/**
 * OpenStation — Pinned notes drop handlers.
 *
 * Wires the note payloads into the desktop-files drop surfaces:
 *
 *   - Wallpaper canvas (Seam A, `canvas-payloads.ts`):
 *       `'note-draft'` → create a note where the sheet lands.
 *       `'note'`       → reposition an existing note.
 *     Both are gated to the wallpaper root (`folderId === 0`) —
 *     paper doesn't pin inside folder windows.
 *
 *   - Recycle bin (Seam B, `recycle-bin-payloads.ts`):
 *       `'note'` → crumple + soft-trash with Undo. `accept` is gated
 *       on `canEdit` — viewers can't start these drags anyway, but
 *       the payload is plain data, so verify at the drop side too.
 *
 * Deliberately NO drop target of our own: a drop landing on top of a
 * pinned note hit-tests through the note's ancestor chain to the
 * wallpaper host, which the FilesLayer canvas target claims — that
 * target natively accepts file payloads (notes never block file
 * drops) and consults Seam A for ours. Registering a notes-root
 * target here would claim-reject 'desktop-file'/'shortcut' drops
 * over every note (the registry has no fall-through).
 */

import { __ } from '../i18n';
import {
	registerCanvasPayloadHandler,
	type CanvasPayloadContext,
} from '../desktop-files/canvas-payloads';
import { registerRecycleBinPayloadHandler } from '../desktop-files/recycle-bin-payloads';
import type { DragSession } from '../drag';
import { sanitizeNoteColorSlug } from './colors';
import { hashNoteSeed } from './motion';
import { createNote } from './rest';
import {
	NOTE_DRAFT_PAYLOAD_TYPE,
	NOTE_PAYLOAD_TYPE,
	type Note,
	type NoteDraftDragData,
	type NoteDragData,
} from './types';
import type { NotesLayer } from './layer';

/**
 * Normalized top-left position for a drop: cursor minus the ghost's
 * grab offset, relative to the notes host. Mirrors the ghost-offset
 * math the files layer uses so the note lands exactly where the user
 * sees the ghost paper.
 */
function normalizedDropPosition(
	layer: NotesLayer,
	session: DragSession,
	ev: { clientX: number; clientY: number },
): { x: number; y: number } {
	const rect = layer.host.getBoundingClientRect();
	const offsetX = session.payload.ghost?.offsetX ?? 0;
	const offsetY = session.payload.ghost?.offsetY ?? 0;
	const { width, height } = layer.hostSize();
	return layer.clampPosition(
		( ev.clientX - offsetX - rect.left ) / width,
		( ev.clientY - offsetY - rect.top ) / height,
	);
}

function handleDraftDrop(
	layer: NotesLayer,
	session: DragSession,
	ev: { clientX: number; clientY: number },
): void {
	const data = session.payload.data as unknown as NoteDraftDragData;
	const text = String( data.text ?? '' );
	if ( ! text.trim() ) {
		return;
	}
	const { x, y } = normalizedDropPosition( layer, session, ev );
	const color = sanitizeNoteColorSlug( String( data.color ?? '' ) );
	const isPublic = data.isPublic === true;
	// Jitter seed: hashed from the text HERE, at creation — the
	// server persists it verbatim so the optimistic paper and every
	// future render share the exact same tilt.
	const seed = hashNoteSeed( text );

	// Optimistic: pin a temp note immediately (the thunk plays now),
	// then adopt the server copy.
	const tempId = layer.nextTempId();
	const optimistic: Note = {
		id: tempId,
		text,
		color,
		x,
		y,
		z: 1,
		public: isPublic,
		seed,
		ownerId: 0,
		ownerName: '',
		ownerAvatar: '',
		canEdit: true,
		updatedAtMs: 0,
	};
	const controller = layer.upsertNote( optimistic, { animate: 'thunk' } );
	layer.bringToFront( controller );

	void createNote( { text, color, x, y, public: isPublic, seed } )
		.then( ( note ) => {
			layer.bumpHighWater( note.updatedAtMs );
			// Keep the optimistic position — the server echoes what we
			// sent; the id + token are what we're after.
			controller.replace( note );
			layer.rekeyNote( tempId, controller );
			// Anything typed while the POST was in flight debounced
			// against the temp id and couldn't save — flush it now
			// that a real id exists.
			controller.flushPendingEdits();
		} )
		.catch( ( err: unknown ) => {
			layer.removeNote( tempId );
			layer.notifyError(
				__( 'Could not pin the note. Please try again.', 'desktop-mode' ),
			);
			// eslint-disable-next-line no-console
			console.error( '[openstation] notes: create failed:', err );
		} );
}

function handleNoteDrop(
	layer: NotesLayer,
	session: DragSession,
	ev: { clientX: number; clientY: number },
): void {
	const data = session.payload.data as unknown as NoteDragData;
	const controller = layer.get( data.noteId );
	if ( ! controller ) {
		return;
	}
	const { x, y } = normalizedDropPosition( layer, session, ev );
	controller.moveTo( x, y );
}

/**
 * Install every note drop route. Returns a teardown (tests).
 */
export function installNoteDropHandlers( layer: NotesLayer ): () => void {
	const deregisters: Array< () => void > = [];

	const canvasCtxOk = ( ctx: CanvasPayloadContext ): boolean =>
		ctx.folderId === 0;

	deregisters.push(
		registerCanvasPayloadHandler( NOTE_DRAFT_PAYLOAD_TYPE, {
			accept: ( data, ctx ) =>
				canvasCtxOk( ctx ) && Boolean( String( data.text ?? '' ).trim() ),
			onDrop: ( session, ev ) => handleDraftDrop( layer, session, ev ),
		} ),
	);

	deregisters.push(
		registerCanvasPayloadHandler( NOTE_PAYLOAD_TYPE, {
			accept: ( data, ctx ) => canvasCtxOk( ctx ) && data.canEdit === true,
			onDrop: ( session, ev ) => handleNoteDrop( layer, session, ev ),
		} ),
	);

	deregisters.push(
		registerRecycleBinPayloadHandler( NOTE_PAYLOAD_TYPE, {
			accept: ( data ) => data.canEdit === true,
			onDrop: ( session, ev ) => {
				const data = session.payload.data as unknown as NoteDragData;
				const controller = layer.get( data.noteId );
				if ( ! controller ) {
					return;
				}
				const note = controller.note;
				// Crumple at the release point; the trash (with its
				// Undo toast) runs immediately underneath it.
				void controller.playCrumpleAt( ev.clientX, ev.clientY );
				layer.trashNote( note );
			},
		} ),
	);

	return () => {
		deregisters.forEach( ( deregister ) => deregister() );
	};
}
