/**
 * OpenStation — Extra canvas drop-payload handlers.
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
 * `wp.os.files` + docs if third-party bundles ever need it.
 */

import { createSharedStore } from '../shared-store';
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

/**
 * The registry, shared across bundles.
 *
 * This module is compiled into the shell bundle AND into `notes.js`.
 * A plain module-level `Map` would therefore exist twice: the notes
 * bundle would register its handlers into its own copy while the
 * shell's `FilesLayer` consulted an empty one, and every drop of a note
 * onto the wallpaper was rejected with "Can't pin here" — the handler
 * was registered, just not into the map anyone asked.
 *
 * `createSharedStore` keys the map on the page instead of on the
 * module, so whichever bundle gets there first creates it and the rest
 * find it. See AGENTS.md, "Cross-bundle state".
 */
const store = createSharedStore< {
	handlers: Map< string, CanvasPayloadHandler >;
} >( 'desktop-mode/canvas-payload-handlers', () => ( {
	handlers: new Map(),
} ) );

/** The one live registry, whichever bundle is asking. */
function handlerMap(): Map< string, CanvasPayloadHandler > {
	return store.state.handlers;
}

/**
 * Register a handler for a payload `type`. Returns a deregister
 * function. Re-registering a type replaces the previous handler.
 */
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

/** Consulted by the FilesLayer canvas target for unknown types. */
export function canvasPayloadAccepts(
	payload: DragPayload,
	ctx: CanvasPayloadContext,
): boolean {
	const handler = handlerMap().get( payload.type );
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
	const handler = handlerMap().get( session.payload.type );
	if ( ! handler ) {
		return false;
	}
	handler.onDrop( session, ev, ctx );
	return true;
}

/** Test-only. */
export function __resetCanvasPayloadHandlersForTests(): void {
	handlerMap().clear();
}
