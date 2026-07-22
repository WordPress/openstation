/**
 * Desktop Mode — Shortcut/reference tile drop-payload handlers.
 *
 * Same seam shape as `recycle-bin-payloads.ts` and `canvas-payloads.ts`,
 * but for the per-tile "reject" claimants the files layer registers on
 * every non-folder tile (`shouldRejectTileDrops`). Those tiles otherwise
 * hard-reject every foreign payload so a drop doesn't fall through to the
 * wallpaper. This registry lets a feature opt a payload type INTO a tile
 * whose placement it recognizes — e.g. the pinned-notes "convert to post"
 * drop onto the Posts shortcut icon in the Spatial layout, where the
 * Posts menu item is a files-layer shortcut tile rather than a dock tile.
 *
 * The files layer owns the actual `DropTarget` on each tile (the registry
 * allows one target per element); it consults this registry for the
 * accept predicate, the chip label, and the drop dispatch, so a feature
 * never has to fight the claimant for the element.
 *
 * @since 0.9.6
 */

import type { DragPayload, DragSession } from '../drag';
import type { RestPlacementShape } from './rest';

export interface TilePayloadContext {
	/** The placement backing the tile under the cursor. */
	placement: RestPlacementShape;
}

export interface TilePayloadHandler {
	/**
	 * Cheap, payload-independent check on the placement — "is this a
	 * tile I care about?" (e.g. the Posts shortcut). Used at tile
	 * registration to choose the accept-chip label, and as a
	 * precondition of `accept`/`onDrop`.
	 */
	appliesTo( ctx: TilePayloadContext ): boolean;
	/** Whether a concrete payload is acceptable on this tile. */
	accept( data: Record< string, unknown >, ctx: TilePayloadContext ): boolean;
	/** Ghost-chip label shown while a matching payload hovers the tile. */
	acceptLabel: string;
	onDrop(
		session: DragSession,
		ev: { clientX: number; clientY: number },
		ctx: TilePayloadContext,
	): void;
}

const handlers = new Map< string, TilePayloadHandler >();

/**
 * Register a handler for a payload `type`. Returns a deregister
 * function. Re-registering a type replaces the previous handler.
 */
export function registerTilePayloadHandler(
	type: string,
	handler: TilePayloadHandler,
): () => void {
	handlers.set( type, handler );
	return () => {
		if ( handlers.get( type ) === handler ) {
			handlers.delete( type );
		}
	};
}

/**
 * The accept-chip label for the handler registered for `type`, when it
 * applies to this tile — or `undefined` otherwise. Keyed by payload type
 * (like `tilePayloadAccepts`) so the chip always reflects the handler
 * that actually accepted the hovered payload, never a different type's
 * handler that happens to also claim the tile. The files layer reads
 * this per-hover (via a getter) so a handler registered after the tile
 * mounted is picked up without a repaint.
 */
export function tilePayloadAcceptLabel(
	type: string,
	ctx: TilePayloadContext,
): string | undefined {
	const handler = handlers.get( type );
	return handler && handler.appliesTo( ctx ) ? handler.acceptLabel : undefined;
}

/** Consulted by the tile target's `accept` for a concrete payload. */
export function tilePayloadAccepts(
	payload: DragPayload,
	ctx: TilePayloadContext,
): boolean {
	const handler = handlers.get( payload.type );
	return handler
		? handler.appliesTo( ctx ) &&
				handler.accept( payload.data as Record< string, unknown >, ctx )
		: false;
}

/** Dispatch a drop for a handler-owned payload type. Returns whether handled. */
export function tilePayloadDrop(
	session: DragSession,
	ev: { clientX: number; clientY: number },
	ctx: TilePayloadContext,
): boolean {
	const handler = handlers.get( session.payload.type );
	if ( ! handler || ! handler.appliesTo( ctx ) ) {
		return false;
	}
	handler.onDrop( session, ev, ctx );
	return true;
}

/** Test-only. */
export function __resetTilePayloadHandlersForTests(): void {
	handlers.clear();
}
