import { createSharedStore } from '../shared-store';
import type { DragPayload, DragSession } from '../drag';

export interface CanvasPayloadContext {

	folderId: number;

	host: HTMLElement;
}

export interface CanvasPayloadHandler {
	accept( data: Record< string, unknown >, ctx: CanvasPayloadContext ): boolean;
	onDrop(
		session: DragSession,
		ev: { clientX: number; clientY: number },
		ctx: CanvasPayloadContext,
	): void;
}

const store = createSharedStore< {
	handlers: Map< string, CanvasPayloadHandler >;
} >( 'desktop-mode/canvas-payload-handlers', () => ( {
	handlers: new Map(),
} ) );

function handlerMap(): Map< string, CanvasPayloadHandler > {
	return store.state.handlers;
}

export function registerCanvasPayloadHandler(
	type: string,
	handler: CanvasPayloadHandler,
): () => void {
	handlerMap().set( type, handler );
	return () => {
		if ( handlerMap().get( type ) === handler ) {
			handlerMap().delete( type );
		}
	};
}

export function canvasPayloadAccepts(
	payload: DragPayload,
	ctx: CanvasPayloadContext,
): boolean {
	const handler = handlerMap().get( payload.type );
	return handler
		? handler.accept( payload.data as Record< string, unknown >, ctx )
		: false;
}

export function canvasPayloadDrop(
	session: DragSession,
	ev: { clientX: number; clientY: number },
	ctx: CanvasPayloadContext,
): boolean {
	const handler = handlerMap().get( session.payload.type );
	if ( ! handler ) {
		return false;
	}
	handler.onDrop( session, ev, ctx );
	return true;
}

export function __resetCanvasPayloadHandlersForTests(): void {
	handlerMap().clear();
}
