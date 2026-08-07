/**
 * OpenStation — Shortcut/reference tile drop-payload handlers.
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

/**
 * Handlers per payload type, in registration order.
 *
 * A list rather than one handler per type: handlers are scoped to the
 * tiles they recognize via `appliesTo`, so several features can want
 * the same payload type on different icons — `'shortcut'` alone is
 * claimed by the agent drop targets in-tree, and by any plugin that
 * wants files dropped onto its own wallpaper icon. Keying one handler
 * per type meant the last registration silently replaced the others.
 *
 * Resolution is first-applies-wins, so a handler only ever competes
 * with another that claims the *same tile* for the *same type*.
 */
const handlers = new Map< string, TilePayloadHandler[] >();

/**
 * Register a handler for a payload `type`. Returns a deregister
 * function.
 *
 * Several handlers may share a type; the first whose `appliesTo`
 * matches the hovered tile wins. Register the narrowest predicate you
 * can — a handler whose `appliesTo` returns true for every placement
 * will shadow every handler registered after it.
 *
 * @param type    Drag payload type, e.g. `'shortcut'`, `'note'`.
 * @param handler The handler.
 * @return Deregister function.
 * @public
 */
export function registerTilePayloadHandler(
	type: string,
	handler: TilePayloadHandler,
): () => void {
	const list = handlers.get( type );
	if ( list ) {
		list.push( handler );
	} else {
		handlers.set( type, [ handler ] );
	}
	return () => {
		const current = handlers.get( type );
		if ( ! current ) {
			return;
		}
		const at = current.indexOf( handler );
		if ( at !== -1 ) {
			current.splice( at, 1 );
		}
		if ( current.length === 0 ) {
			handlers.delete( type );
		}
	};
}

/**
 * The first handler registered for `type` that claims this tile.
 *
 * @param type Payload type.
 * @param ctx  Tile context.
 * @return The handler, or undefined.
 */
function resolveTileHandler(
	type: string,
	ctx: TilePayloadContext,
): TilePayloadHandler | undefined {
	const list = handlers.get( type );
	if ( ! list ) {
		return undefined;
	}
	return list.find( ( handler ) => handler.appliesTo( ctx ) );
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
	return resolveTileHandler( type, ctx )?.acceptLabel;
}

/** Consulted by the tile target's `accept` for a concrete payload. */
export function tilePayloadAccepts(
	payload: DragPayload,
	ctx: TilePayloadContext,
): boolean {
	const handler = resolveTileHandler( payload.type, ctx );
	return handler
		? handler.accept( payload.data as Record< string, unknown >, ctx )
		: false;
}

/** Dispatch a drop for a handler-owned payload type. Returns whether handled. */
export function tilePayloadDrop(
	session: DragSession,
	ev: { clientX: number; clientY: number },
	ctx: TilePayloadContext,
): boolean {
	const handler = resolveTileHandler( session.payload.type, ctx );
	if ( ! handler ) {
		return false;
	}
	handler.onDrop( session, ev, ctx );
	return true;
}

/** Test-only. */
export function __resetTilePayloadHandlersForTests(): void {
	handlers.clear();
}
