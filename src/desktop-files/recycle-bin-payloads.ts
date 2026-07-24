/**
 * Desktop Mode — Extra recycle-bin drop-payload handlers.
 *
 * Same seam shape as `canvas-payloads.ts`, for the recycle-bin drop
 * surfaces: `recycle-bin-targets.ts` owns the drop targets on the
 * bin's wallpaper tile and the bin window body (the drop-target
 * registry allows only one target per element), and consults this
 * registry for payload types it doesn't know (`'note'` today — the
 * pinned-notes trash path).
 *
 * @since 0.9.6
 */

import type { DragPayload, DragSession } from '../drag';

export interface RecycleBinPayloadHandler {
	accept( data: Record< string, unknown > ): boolean;
	onDrop( session: DragSession, ev: { clientX: number; clientY: number } ): void;
}

const handlers = new Map< string, RecycleBinPayloadHandler >();

/**
 * Register a handler for a payload `type`. Returns a deregister
 * function. Re-registering a type replaces the previous handler.
 */
export function registerRecycleBinPayloadHandler(
	type: string,
	handler: RecycleBinPayloadHandler,
): () => void {
	handlers.set( type, handler );
	return () => {
		if ( handlers.get( type ) === handler ) {
			handlers.delete( type );
		}
	};
}

/** Consulted by the bin targets' `accept` for unknown types. */
export function recycleBinPayloadAccepts( payload: DragPayload ): boolean {
	const handler = handlers.get( payload.type );
	return handler
		? handler.accept( payload.data as Record< string, unknown > )
		: false;
}

/** Dispatch a drop for a handler-owned payload type. Returns whether handled. */
export function recycleBinPayloadDrop(
	session: DragSession,
	ev: { clientX: number; clientY: number },
): boolean {
	const handler = handlers.get( session.payload.type );
	if ( ! handler ) {
		return false;
	}
	handler.onDrop( session, ev );
	return true;
}

/** Test-only. */
export function __resetRecycleBinPayloadHandlersForTests(): void {
	handlers.clear();
}
