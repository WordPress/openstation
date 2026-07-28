/**
 * Desktop Mode — Extra canvas drop-payload handlers.
 *
 * The DragManager registry keys drop targets by ELEMENT — one target
 * per element (`drop-target-registry.ts`). The FilesLayer already
 * claims the wallpaper host with its canvas target, so any other
 * feature that wants drops on the bare wallpaper (pinned notes today)
 * cannot register its own target there; it registers a payload
 * handler here and the canvas target consults this registry for
 * payload types it doesn't own. This is the "registry consulted by
 * the existing target" seam anticipated in `layer.ts`.
 *
 * Internal for now (module-level map — the notes layer and the files
 * layer compile into the same main bundle). Promote via
 * `wp.desktop.files` + docs if third-party bundles ever need it.
 */

import type { DragPayload, DragSession } from '../drag';

export interface CanvasPayloadContext {
	/** Folder whose canvas the drop landed on (0 = wallpaper root). */
	folderId: number;
	/** The canvas host element. */
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

const handlers = new Map< string, CanvasPayloadHandler >();

/**
 * Register a handler for a payload `type`. Returns a deregister
 * function. Re-registering a type replaces the previous handler.
 */
export function registerCanvasPayloadHandler(
	type: string,
	handler: CanvasPayloadHandler,
): () => void {
	handlers.set( type, handler );
	return () => {
		if ( handlers.get( type ) === handler ) {
			handlers.delete( type );
		}
	};
}

/** Consulted by the FilesLayer canvas target for unknown types. */
export function canvasPayloadAccepts(
	payload: DragPayload,
	ctx: CanvasPayloadContext,
): boolean {
	const handler = handlers.get( payload.type );
	return handler
		? handler.accept( payload.data as Record< string, unknown >, ctx )
		: false;
}

/** Dispatch a drop for a handler-owned payload type. Returns whether handled. */
export function canvasPayloadDrop(
	session: DragSession,
	ev: { clientX: number; clientY: number },
	ctx: CanvasPayloadContext,
): boolean {
	const handler = handlers.get( session.payload.type );
	if ( ! handler ) {
		return false;
	}
	handler.onDrop( session, ev, ctx );
	return true;
}

/** Test-only. */
export function __resetCanvasPayloadHandlersForTests(): void {
	handlers.clear();
}
