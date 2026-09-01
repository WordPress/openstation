/**
 * OpenStation — Files-on-the-desktop drag payload contracts.
 *
 * Two payload shapes flow through the DragManager for desktop-files
 * gestures. Drop targets switch on `payload.type` and read the
 * matching `data` shape:
 *
 *   - `'desktop-file'` — an existing tile is being moved. The drop
 *     target either reposistions it (within the same folder) or
 *     re-parents it (drop on another folder, or drop on the
 *     wallpaper to move out of a folder).
 *
 *   - `'shortcut'`     — a new shortcut is being created. The
 *     payload carries the external entity reference (`kind` + `ref`,
 *     e.g. `kind: 'post', ref: '42'`) — the drop target POSTs a new
 *     placement.
 *
 * Both shapes are framework-internal but stable for plugin authors
 * who want to register their own drop targets that accept these.
 */

import type { RestPlacementShape } from './rest';
import type { DragBridgePayload } from '../drag-bridge';

export interface DesktopFileDragData {
	/**
	 * The placement being dragged — the one the user actually grabbed.
	 *
	 * Always present, even for a multi-item drag, and always a member
	 * of {@link DesktopFileDragData.placements}. Every drop target
	 * written before multi-drag existed reads this field and keeps
	 * working: it acts on the grabbed tile, which is the one the user
	 * pointed at.
	 */
	placement: RestPlacementShape;
	/**
	 * Every placement in the gesture, in visual order.
	 *
	 * Absent for a single-item drag. Targets that support sets read
	 * them through `dragPlacements( data )`, which falls back to
	 * `[ placement ]` — so "handle one" and "handle many" are the same
	 * code path with a different array length.
	 */
	placements?: RestPlacementShape[];
	/** Folder the source tile lives in, BEFORE the drop. */
	sourceFolderId: number;
	/**
	 * Optional cross-frame bridge payload, synthesized from the
	 * placement's file shape at drag start when the file type is
	 * bridgeable (attachment / post / user). Lets iframe receivers
	 * (Gutenberg drop-receiver) react to a desktop-file drop the
	 * same way they would a fresh shortcut drag — the user dragging
	 * an existing post shortcut from the wallpaper into Gutenberg
	 * gets the same `<a href>` insertion as dragging from My
	 * WordPress.
	 */
	bridgePayload?: DragBridgePayload;
}

/**
 * One entity in a shortcut drag. A single-item drag carries exactly
 * this shape at the top level; a multi-item drag repeats it in
 * `ShortcutDragData.items`.
 */
export interface ShortcutDragItem {
	/** File-type slug — `'post'`, `'page'`, `'user'`, plugin-defined. */
	kind: string;
	/** Opaque ref the file type resolves (post id as string, etc.). */
	ref: string;
	/** Optional human-readable label for diagnostics + ghost. */
	title?: string;
	/** Optional dashicon class for diagnostics + ghost. */
	icon?: string;
	/**
	 * Source-side My WordPress entity id (e.g. `'posts'`, `'pages'`,
	 * `'users'`, `'media'`). Populated when the drag originates from a
	 * My WordPress entity tile so drop targets that need to act on the
	 * source entity (e.g. the recycle bin trashing a post via its
	 * canonical REST endpoint) can resolve which entity the `ref`
	 * belongs to. `kind` alone is ambiguous — both Posts and Pages
	 * carry `kind: 'post'` but have different REST paths.
	 */
	entityId?: string;
	/**
	 * REST collection path for the source section (`wp/v2/posts`, a
	 * CPT's collection, the bridge route for a non-REST type). What
	 * the recycle bin DELETEs against — carried on the payload so a
	 * drop needs no window, no config blob and no cross-bundle API.
	 */
	restPath?: string;
	/**
	 * Optional cross-frame bridge payload. When present the shell
	 * fans this into `wp.os.dragBridge` at lift time so iframe
	 * receivers (e.g. the Gutenberg drop-receiver) can react to the
	 * drag — the receiver inserts a block built from this payload on
	 * `os-drop`. Tiles that omit it still drag-out for
	 * placement purposes; they just don't trigger any iframe-side
	 * drop behavior.
	 */
	bridgePayload?: DragBridgePayload;
}

/**
 * A shortcut drag. The top-level fields describe the entity the user
 * grabbed — unchanged, and what every pre-existing drop target reads.
 * `items` carries the whole set when the drag started from a
 * multi-selection.
 */
export interface ShortcutDragData extends ShortcutDragItem {
	/**
	 * Every entity in the gesture, in visual order. Absent for a
	 * single-item drag; read it through `dragShortcutItems( data )`,
	 * which falls back to the top-level fields.
	 */
	items?: ShortcutDragItem[];
}

/**
 * Placements a `'desktop-file'` drop should act on.
 *
 * The one call every drop target needs to make to support sets. A
 * target that keeps reading `data.placement` isn't broken, it just
 * acts on the grabbed tile alone.
 *
 * @public
 */
export function dragPlacements(
	data: DesktopFileDragData,
): RestPlacementShape[] {
	const many = data.placements;
	if ( Array.isArray( many ) && many.length > 0 ) {
		return many;
	}
	return data.placement ? [ data.placement ] : [];
}

/**
 * Entities a `'shortcut'` drop should act on. Mirror of
 * {@link dragPlacements}.
 *
 * @public
 */
export function dragShortcutItems(
	data: ShortcutDragData,
): ShortcutDragItem[] {
	const many = data.items;
	if ( Array.isArray( many ) && many.length > 0 ) {
		return many;
	}
	return data.ref ? [ data ] : [];
}

/** Concrete payload shapes consumed by drop targets. */
export interface DesktopFileDragPayload {
	type: 'desktop-file';
	source: HTMLElement;
	data: DesktopFileDragData;
}

export interface ShortcutDragPayload {
	type: 'shortcut';
	source: HTMLElement;
	data: ShortcutDragData;
}

export type DesktopFilesDragPayload =
	| DesktopFileDragPayload
	| ShortcutDragPayload;
