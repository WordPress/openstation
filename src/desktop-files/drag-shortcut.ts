/**
 * Desktop Mode — Cross-window shortcut drag protocol (legacy).
 *
 * @deprecated Superseded by the centralized
 * {@link DragManagerApi}. The shell no longer wires HTML5
 * `dragstart` / `drop` for in-shell tile gestures; everything routes
 * through `wp.desktop.dragManager`. This module remains for
 * backwards compatibility with third-party plugins that still emit
 * HTML5 drags with the legacy MIME `application/x-desktop-mode-shortcut+json`,
 * but new code SHOULD use the manager directly:
 *
 * ```ts
 * tile.addEventListener( 'pointerdown', ( e ) => {
 *     window.wp.desktop.dragManager.start( {
 *         payload: {
 *             type: 'shortcut',
 *             source: tile,
 *             data: { kind: 'post', ref: String( id ) },
 *         },
 *         origin: e,
 *     } );
 * } );
 * ```
 *
 * Why we left HTML5 drag behind:
 *
 *   1. `setPointerCapture` (used by tile-rearrange handlers) silently
 *      breaks HTML5 `dragstart` detection on `draggable=true` elements.
 *      The browser never fires `dragstart`, so payloads attached to
 *      `DataTransfer` never reach a drop target. This was the
 *      long-standing My WordPress entity-tile drag bug.
 *   2. HTML5 drag has no programmatic cancel. Pressing Escape, alt-
 *      tabbing, or system modals leave drag state stranded.
 *   3. The "Lift and Drop" cross-iframe pattern (see architecture.md)
 *      needs a parent-shell-controlled drag. Pointer-event-driven
 *      gives us a single mental model.
 *
 * @public
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
 * `dragstart`.
 *
 * @deprecated Use `dragManager.start()` instead.
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
 * Whether the drag event carries a shortcut payload.
 *
 * @deprecated Drop targets register via
 * `dragManager.registerDropTarget()` and switch on `payload.type`.
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
 *
 * @deprecated Drop targets receive the typed payload
 * directly via `DragSession.payload.data`.
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
