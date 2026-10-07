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

				void controller.playCrumpleAt( ev.clientX, ev.clientY );
				layer.trashNote( note );
			},
		} ),
	);

	return () => {
		deregisters.forEach( ( deregister ) => deregister() );
	};
}
