/**
 * Desktop Mode — Files-on-the-desktop drag payload contracts.
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
 *
 * @since 0.18.0
 */

import type { RestPlacementShape } from './rest';

export interface DesktopFileDragData {
	/** The placement being dragged (full record). */
	placement: RestPlacementShape;
	/** Folder the source tile lives in, BEFORE the drop. */
	sourceFolderId: number;
}

export interface ShortcutDragData {
	/** File-type slug — `'post'`, `'page'`, `'user'`, plugin-defined. */
	kind: string;
	/** Opaque ref the file type resolves (post id as string, etc.). */
	ref: string;
	/** Optional human-readable label for diagnostics + ghost. */
	title?: string;
	/** Optional dashicon class for diagnostics + ghost. */
	icon?: string;
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
