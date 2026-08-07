/**
 * OpenStation. Viewport placement for floating menus.
 *
 * Every floating menu in the shell is an `<os-context-menu>`, and
 * every one of them has to answer the same question the moment it
 * is appended: does it fit? Answering needs a measurement, and the
 * measurement is the trap. `Component` paints its shadow DOM inside
 * a `queueMicrotask()` (see `src/ui/core/component.ts`), so a
 * `getBoundingClientRect()` taken on the line after `appendChild()`
 * measures an empty box. A near-zero height never trips
 * `rect.bottom > window.innerHeight`, the clamp is skipped, and the
 * menu then paints at full height straight off the bottom edge. The
 * taller the menu and the shorter the screen, the bigger the dead
 * zone along the bottom of the desktop.
 *
 * {@link placeAfterRender} is the fix: it defers the measurement to
 * the next animation frame, which lands after the render microtask.
 * The two placements the shell needs are built on it, so there is
 * one definition of "measure a menu" rather than one per call site.
 *
 * The horizontal axis was never visibly broken, but only because
 * `<os-context-menu>` carries a `min-width`: the empty box still
 * measured ~180px wide. That is luck, not correctness, and it stops
 * holding the moment a menu is wider than its minimum.
 */

/** Gap kept between a placed menu and the viewport edge. */
const MARGIN = 8;

/**
 * Run `place` with the menu's real, post-render rect.
 *
 * The menu is hidden for the frame between append and placement so
 * the unplaced position never paints.
 */
export function placeAfterRender(
	menu: HTMLElement,
	place: ( rect: DOMRect ) => void,
): void {
	menu.style.visibility = 'hidden';
	const run = (): void => {
		// Closed before the frame arrived. A superseded menu counts as
		// closed too, since every close path removes the node.
		if ( ! menu.isConnected ) {
			return;
		}
		place( menu.getBoundingClientRect() );
		menu.style.visibility = '';
	};
	if ( typeof requestAnimationFrame === 'function' ) {
		requestAnimationFrame( run );
	} else {
		// No frame loop to wait for (non-browser host). Measuring
		// synchronously is no worse than not measuring at all.
		run();
	}
}

/**
 * Pull an already-positioned menu back inside the viewport, so a
 * click near an edge doesn't open half off-screen.
 *
 * The caller sets `left` / `top` from the pointer first; this only
 * moves the menu when it would overflow.
 */
export function clampToViewport( menu: HTMLElement ): void {
	placeAfterRender( menu, ( rect ) => {
		if ( rect.right > window.innerWidth ) {
			menu.style.left = `${ Math.max(
				0,
				window.innerWidth - rect.width - MARGIN,
			) }px`;
		}
		if ( rect.bottom > window.innerHeight ) {
			menu.style.top = `${ Math.max(
				0,
				window.innerHeight - rect.height - MARGIN,
			) }px`;
		}
	} );
}

/**
 * Place a submenu against the option that opened it: to the right,
 * top-aligned, flipping to the left when it would run past the
 * right edge and riding up when it would run past the bottom.
 */
export function positionFlyout( fly: HTMLElement, anchor: HTMLElement ): void {
	const ar = anchor.getBoundingClientRect();
	// Default: open to the right, top-aligned with the anchor.
	fly.style.position = 'fixed';
	fly.style.left = `${ ar.right }px`;
	fly.style.top = `${ ar.top }px`;
	placeAfterRender( fly, ( rect ) => {
		if ( rect.right > window.innerWidth ) {
			fly.style.left = `${ Math.max( 0, ar.left - rect.width ) }px`;
		}
		if ( rect.bottom > window.innerHeight ) {
			fly.style.top = `${ Math.max(
				0,
				window.innerHeight - rect.height - MARGIN,
			) }px`;
		}
	} );
}
