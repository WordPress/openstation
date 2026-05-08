/**
 * Desktop Mode — Cross-window shortcut drag protocol.
 *
 * A drag source (e.g. the My WordPress entity-list post tiles)
 * sets `application/x-desktop-mode-shortcut+json` on its
 * `dataTransfer` with a `{ type, ref, title, icon }` payload.
 * Drop targets (the FilesLayer on the wallpaper or inside any
 * folder window) read it on `dragover` / `drop` and turn it into
 * a placement at the drop coordinates.
 *
 * Native HTML5 drag is the right choice here because it crosses
 * any DOM boundary uniformly — wallpaper, folder windows, future
 * native windows all share the same protocol with no shell-internal
 * plumbing.
 *
 * This module is deliberately tiny and dependency-free so feature
 * bundles (My WordPress, future Posts/Users windows) can import the
 * helper without dragging in the FilesLayer module's full graph.
 *
 * @public
 * @since 0.8.0
 */

export const DROP_MIME = 'application/x-desktop-mode-shortcut+json';

export interface DesktopShortcutDragPayload {
	type: string;
	ref: string;
	title: string;
	icon?: string;
}

/**
 * Stamp a shortcut payload on a dataTransfer object during a
 * `dragstart`. Sets a `text/plain` fallback so dragging into a
 * plain-text field (notes app, address bar) yields the title rather
 * than `[object Object]`. Marks the drag as `copy` because we never
 * MOVE a tile out of My WordPress — the source survives.
 */
export function setShortcutDragPayload(
	dt: DataTransfer,
	payload: DesktopShortcutDragPayload,
): void {
	try {
		dt.setData( DROP_MIME, JSON.stringify( payload ) );
		dt.setData( 'text/plain', payload.title );
		dt.effectAllowed = 'copy';
	} catch {
		// Some browsers throw on setData mid-drag; ignore.
	}
}

/**
 * Whether the drag event carries a shortcut payload. Drop targets
 * use this on `dragover` to decide whether to call
 * `e.preventDefault()` (and so accept the drop).
 */
export function hasShortcutPayload( e: DragEvent ): boolean {
	const types = e.dataTransfer?.types;
	if ( ! types ) {
		return false;
	}
	for ( let i = 0; i < types.length; i += 1 ) {
		if ( types[ i ] === DROP_MIME ) {
			return true;
		}
	}
	return false;
}

/**
 * Read a shortcut payload from a `drop` event. Returns `null` for
 * malformed / missing data — caller should bail.
 */
export function readShortcutPayload(
	e: DragEvent,
): DesktopShortcutDragPayload | null {
	const raw = e.dataTransfer?.getData( DROP_MIME );
	if ( ! raw ) {
		return null;
	}
	try {
		const parsed = JSON.parse( raw );
		if (
			parsed &&
			typeof parsed.type === 'string' &&
			typeof parsed.ref === 'string'
		) {
			return parsed as DesktopShortcutDragPayload;
		}
	} catch {
		// Bad payload — ignore.
	}
	return null;
}
