/**
 * Desktop Mode — Window-at-point resolution.
 *
 * Shared helper for modules that need to know which desktop window
 * the cursor is over during a DragManager session. The resolution is
 * a plain `elementFromPoint` walk, which is reliable mid-drag
 * because:
 *
 *   - The ghost element is permanently `pointer-events: none`
 *     (`ghost.ts`), so it never shadows the hit test.
 *   - Iframe windows have their iframe's `pointer-events` suppressed
 *     for the duration of a bridge drag (`iframe-drop-targets.ts`),
 *     so `elementFromPoint` returns the window body rather than the
 *     opaque iframe boundary.
 *   - Minimized and closing windows are `pointer-events: none` via
 *     CSS (`window-states.css`), so they never match.
 *
 * Every window root — iframe and native alike — is built by
 * `window/dom.ts` as `.desktop-mode-window` with the id
 * `wp-window-<windowId>`, which is what these helpers key off.
 */

/** Selector matching every window root element (iframe + native). */
export const WINDOW_ROOT_SELECTOR = '.desktop-mode-window';

/** Prefix of the DOM id stamped on every window root. */
export const WINDOW_ID_PREFIX = 'wp-window-';

/**
 * Find the window root element under the given client coordinates,
 * or `null` when the point is over the wallpaper, dock, or any other
 * non-window surface.
 *
 * @param clientX Pointer x in client (viewport) space.
 * @param clientY Pointer y in client (viewport) space.
 */
export function findWindowRootAtPoint(
	clientX: number,
	clientY: number,
): HTMLElement | null {
	const el = document.elementFromPoint( clientX, clientY );
	if ( ! el ) {
		return null;
	}
	const root = el.closest( WINDOW_ROOT_SELECTOR );
	return root instanceof HTMLElement ? root : null;
}

/**
 * Extract the window-manager id from a window root element
 * (`wp-window-<id>` → `<id>`), or `null` when the element has no
 * stamped id.
 *
 * @param root A window root element (see `WINDOW_ROOT_SELECTOR`).
 */
export function windowIdFromRoot( root: HTMLElement ): string | null {
	if ( ! root.id.startsWith( WINDOW_ID_PREFIX ) ) {
		return null;
	}
	const id = root.id.slice( WINDOW_ID_PREFIX.length );
	return id.length > 0 ? id : null;
}
