import { createSharedStore } from '../shared-store';
import type { DragPayload, DragSession } from '../drag';

export interface RecycleBinPayloadHandler {
	accept( data: Record< string, unknown > ): boolean;
	onDrop( session: DragSession, ev: { clientX: number; clientY: number } ): void;
}

const store = createSharedStore< {
	handlers: Map< string, RecycleBinPayloadHandler >;
} >( 'desktop-mode/recycle-bin-payload-handlers', () => ( {
	handlers: new Map(),
} ) );

function handlerMap(): Map< string, RecycleBinPayloadHandler > {
	return store.state.handlers;
}

export function registerRecycleBinPayloadHandler(
	type: string,
	handler: RecycleBinPayloadHandler,
): () => void {
	handlerMap().set( type, handler );
	return () => {
		if ( handlerMap().get( type ) === handler ) {
			handlerMap().delete( type );
		}
	};
}

export function recycleBinPayloadAccepts( payload: DragPayload ): boolean {
	const handler = handlerMap().get( payload.type );
	return handler
		? handler.accept( payload.data as Record< string, unknown > )
		: false;
}

export function recycleBinPayloadDrop(
	session: DragSession,
	ev: { clientX: number; clientY: number },
): boolean {
	const handler = handlerMap().get( session.payload.type );
	if ( ! handler ) {
		return false;
	}
	handler.onDrop( session, ev );
	return true;
}

export function __resetRecycleBinPayloadHandlersForTests(): void {
	handlerMap().clear();
}
