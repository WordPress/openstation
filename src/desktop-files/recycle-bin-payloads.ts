/**
 * OpenStation — Extra recycle-bin drop-payload handlers.
 *
 * Same seam shape as `canvas-payloads.ts`, for the recycle-bin drop
 * surfaces: `recycle-bin-targets.ts` owns the drop targets on the
 * bin's wallpaper tile and the bin window body (the drop-target
 * registry allows only one target per element), and consults this
 * registry for payload types it doesn't know (`'note'` today — the
 * pinned-notes trash path).
 */

import { createSharedStore } from '../shared-store';
import type { DragPayload, DragSession } from '../drag';

export interface RecycleBinPayloadHandler {
	accept( data: Record< string, unknown > ): boolean;
	onDrop( session: DragSession, ev: { clientX: number; clientY: number } ): void;
}

/**
 * Shared across bundles — this module is compiled into the shell AND
 * into `notes.js`. Two module-level copies meant the notes bundle
 * registered its handler into one map while the shell's Trash tile
 * consulted the other, and dropping a note on Trash was rejected.
 * See AGENTS.md, "Cross-bundle state".
 */
const store = createSharedStore< {
	handlers: Map< string, RecycleBinPayloadHandler >;
} >( 'desktop-mode/recycle-bin-payload-handlers', () => ( {
	handlers: new Map(),
} ) );

/** The one live registry, whichever bundle is asking. */
function handlerMap(): Map< string, RecycleBinPayloadHandler > {
	return store.state.handlers;
}

/**
 * Register a handler for a payload `type`. Returns a deregister
 * function. Re-registering a type replaces the previous handler.
 */
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

/** Consulted by the bin targets' `accept` for unknown types. */
export function recycleBinPayloadAccepts( payload: DragPayload ): boolean {
	const handler = handlerMap().get( payload.type );
	return handler
		? handler.accept( payload.data as Record< string, unknown > )
		: false;
}

/** Dispatch a drop for a handler-owned payload type. Returns whether handled. */
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

/** Test-only. */
export function __resetRecycleBinPayloadHandlersForTests(): void {
	handlerMap().clear();
}
