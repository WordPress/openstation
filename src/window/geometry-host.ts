/**
 * Desktop Mode — which element a window's geometry resolves against.
 *
 * Every piece of window geometry — drag clamping, maximize, snap
 * halves — sizes itself against the window's parent, which is the
 * desktop area (`#desktop-mode-area`) for the window's whole life…
 * with one exception. While a window transition effect with a live
 * texture plays, the canvas stage PROMOTES the window element to a
 * direct child of the stage `<canvas>` (the HTML-in-Canvas API only
 * draws direct children — see `src/stage/window-fx/promote.ts`).
 *
 * The canvas covers the whole shell, dock included, so it is wider
 * than the area — sizing a maximize or a snap half against it while
 * promoted would leave the window dock-width too large. This helper
 * answers with the desktop area in that case, and with the plain
 * parent everywhere else, so callers never need to know whether a
 * window is currently promoted.
 *
 * @since 0.9.8
 */

/**
 * The element to measure window geometry against.
 *
 * @param element A window element.
 * @return The desktop area while the window is promoted into the
 *         stage canvas; otherwise the window's parent element.
 */
export function geometryHostOf( element: HTMLElement ): HTMLElement | null {
	const parent = element.parentElement;
	if ( parent instanceof HTMLCanvasElement ) {
		return (
			element.ownerDocument?.getElementById( 'desktop-mode-area' ) ??
			parent
		);
	}
	return parent;
}
