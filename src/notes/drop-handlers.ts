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

import {
	registerCanvasPayloadHandler,
	type CanvasPayloadContext,
} from '../desktop-files/canvas-payloads';
import { registerRecycleBinPayloadHandler } from '../desktop-files/recycle-bin-payloads';
import type { DragSession } from '../drag';
import {
	NOTE_DRAFT_PAYLOAD_TYPE,
	NOTE_PAYLOAD_TYPE,
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
	// The optimistic create (temp id, thunk, adopt-the-server-copy)
	// lives on the layer — the wallpaper context menu wants the exact
	// same dance, minus the ghost-offset math above.
	layer.createNoteAt( {
		x,
		y,
		text,
		color: String( data.color ?? '' ),
		isPublic: data.isPublic === true,
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
