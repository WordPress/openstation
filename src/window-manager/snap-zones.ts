/**
 * OpenStation — Snap zones.
 *
 * Windows-style edge snapping. While a window is being dragged, the
 * shell watches the cursor for proximity to the left or right edge
 * of the desktop area. When the cursor enters the edge threshold:
 *
 *   1. A translucent preview rectangle appears in the target half so
 *      the user sees where the window will land before committing.
 *   2. On pointerup inside the zone, the window animates to the
 *      target half via the base window CSS transition, state flips
 *      to `snapped-left` / `snapped-right`, and a hook fires.
 *   3. After the commit animation settles, the shell hands off to
 *      {@link ./split-overview.ts} which shows every OTHER window in
 *      the OPPOSITE half so the user can pick a partner for the
 *      split.
 *
 * All DOM + state mutation lives on the `WindowManager` instance via
 * the `_` prefixed internal fields. That way pointer.ts (in the
 * Window folder) can call into this module without reaching through
 * two class boundaries.
 */

import { doAction, HOOKS } from '../hooks';
import type { Window } from '../window';
import { enterSplitOverview } from './split-overview';
import type { WindowManager } from './index';

/** Cursor must be within this many pixels of the edge to arm a snap. */
export const SNAP_EDGE_THRESHOLD = 30;

/** Animation used by the preview fade + the commit slide. */
const SNAP_COMMIT_MS = 260;

/** Directions we snap to today. Corners / top come later. */
export type SnapZone = 'left' | 'right';

/**
 * Return the snap zone (if any) that `clientX` falls into, measured
 * against the desktop area's bounding rect. `null` means "dragging
 * somewhere in the middle — no snap pending."
 */
export function detectSnapZone(
	clientX: number,
	desktopRect: DOMRect,
): SnapZone | null {
	if ( clientX <= desktopRect.left + SNAP_EDGE_THRESHOLD ) {
		return 'left';
	}
	if ( clientX >= desktopRect.right - SNAP_EDGE_THRESHOLD ) {
		return 'right';
	}
	return null;
}

/**
 * Compute the final bounds (in desktop-area-local coordinates) for a
 * given snap zone. Always exactly half the desktop area's width,
 * full height. Rounded to whole pixels so the preview rectangle and
 * the committed window line up pixel-perfectly.
 */
export function snapZoneBounds(
	mgr: WindowManager,
	zone: SnapZone,
): { x: number; y: number; width: number; height: number } {
	const rect = mgr._desktop.getBoundingClientRect();
	const halfW = Math.floor( rect.width / 2 );
	const height = Math.floor( rect.height );
	return {
		x: zone === 'left' ? 0 : rect.width - halfW,
		y: 0,
		width: halfW,
		height,
	};
}

/**
 * Produce the opposite-half rect where the split overview lives.
 *
 * Returns **area-relative** coordinates (same space as
 * `offsetLeft` / `offsetTop` / `computeOverviewLayout`): the desktop
 * area's origin is `(0, 0)`, not its viewport-top-left.
 *
 * User snapped LEFT → overview fills the RIGHT half → rect.left = halfW.
 * User snapped RIGHT → overview fills the LEFT half → rect.left = 0.
 */
export function oppositeHalfRect(
	mgr: WindowManager,
	zone: SnapZone,
): DOMRect {
	const rect = mgr._desktop.getBoundingClientRect();
	const halfW = Math.floor( rect.width / 2 );
	const height = Math.floor( rect.height );
	if ( zone === 'left' ) {
		return new DOMRect( halfW, 0, halfW, height );
	}
	return new DOMRect( 0, 0, halfW, height );
}

/**
 * Show (or update) the translucent preview rectangle for `zone`.
 * Idempotent — calling repeatedly during a drag just moves the
 * overlay to the new zone without flickering.
 */
export function showSnapPreview( mgr: WindowManager, zone: SnapZone ): void {
	if ( mgr._snapPendingZone === zone && mgr._snapPreviewEl ) {
		return;
	}
	mgr._snapPendingZone = zone;
	if ( ! mgr._snapPreviewEl ) {
		const el = document.createElement( 'div' );
		el.className = 'os-snap-preview';
		el.setAttribute( 'aria-hidden', 'true' );
		mgr._desktop.appendChild( el );
		mgr._snapPreviewEl = el;
		// Kick the fade-in: class applied in a microtask so the
		// opacity transition has a frame to latch onto.
		Promise.resolve().then( () => {
			el.classList.add( 'os-snap-preview--visible' );
		} );
	}
	const b = snapZoneBounds( mgr, zone );
	mgr._snapPreviewEl.style.left = `${ b.x }px`;
	mgr._snapPreviewEl.style.top = `${ b.y }px`;
	mgr._snapPreviewEl.style.width = `${ b.width }px`;
	mgr._snapPreviewEl.style.height = `${ b.height }px`;
	mgr._snapPreviewEl.dataset.zone = zone;
}

/**
 * Hide the preview. Called when the cursor leaves the zone during
 * drag, OR as part of the commit flow (the preview blends into the
 * arriving window's own bounds).
 */
export function hideSnapPreview( mgr: WindowManager ): void {
	if ( ! mgr._snapPreviewEl ) {
		mgr._snapPendingZone = null;
		return;
	}
	const el = mgr._snapPreviewEl;
	mgr._snapPreviewEl = null;
	mgr._snapPendingZone = null;
	el.classList.remove( 'os-snap-preview--visible' );
	// Remove after the fade-out transition. Kept separate from
	// `hidden = true` so a re-enter during the fade can re-use the
	// element, but simpler to just remove + rebuild on re-arm.
	window.setTimeout( () => {
		el.remove();
	}, SNAP_COMMIT_MS );
}

/**
 * Entry point from the drag-move handler. Updates snap preview +
 * fires the `snap.zone-pending` / `snap.zone-canceled` hooks when the
 * zone transitions.
 */
export function updateSnapZoneForDrag(
	mgr: WindowManager,
	win: Window,
	clientX: number,
): void {
	if ( mgr._splitOverviewActive ) {
		// A previous snap already finished and the picker is up. No
		// new snap zone detection while the picker is active.
		return;
	}
	const rect = mgr._desktop.getBoundingClientRect();
	const zone = detectSnapZone( clientX, rect );
	const previous = mgr._snapPendingZone;
	if ( zone ) {
		showSnapPreview( mgr, zone );
		if ( previous !== zone ) {
			doAction( HOOKS.SNAP_ZONE_PENDING, {
				windowId: win.id,
				zone,
			} );
		}
	} else if ( previous ) {
		hideSnapPreview( mgr );
		doAction( HOOKS.SNAP_ZONE_CANCELED, { windowId: win.id } );
	}
}

/**
 * Entry point from the drag-end handler. Returns `true` if the drag
 * should be treated as a snap commit (the caller should suppress its
 * normal drag-end payload in favor of our own flow), `false` when the
 * drop happened outside any zone.
 */
export function commitSnapIfPending(
	mgr: WindowManager,
	win: Window,
): boolean {
	const zone = mgr._snapPendingZone;
	if ( ! zone ) {
		return false;
	}
	hideSnapPreview( mgr );

	// Save the pre-snap geometry so a subsequent drag from the
	// snapped title bar can shrink the window back to its earlier
	// floating size (mirrors how maximize saves geometry for
	// un-maximize). Skip the save if `_savedGeometry` already
	// represents some prior state — a snap after a maximize would
	// otherwise overwrite the pre-max bounds with the maximized
	// ones.
	if ( win.state === 'normal' ) {
		win._savedGeometry = {
			x: win.element.offsetLeft,
			y: win.element.offsetTop,
			width: win.element.offsetWidth,
			height: win.element.offsetHeight,
		};
	}

	// Animate to the target bounds. The base window CSS transition
	// covers left/top/width/height transitions for ~250 ms, so the
	// inline styles written by `applySnap` trigger the slide. Going
	// through the shared method (not hand-written inline math) keeps
	// the live snap + session-restore + ResizeObserver paths pixel-
	// identical — any future tweak to "what does snapped-left mean"
	// lives in one place.
	win.applySnap( zone );

	doAction( HOOKS.SNAP_ZONE_COMMITTED, {
		windowId: win.id,
		zone,
	} );

	// Hand off to phase 2: show a split overview of every other
	// window in the opposite half, so the user can pick a partner.
	// Defer one frame so the snap-slide animation has already started
	// — otherwise the overview's own transform on non-selected
	// windows would race the slide and visually stutter.
	window.requestAnimationFrame( () => {
		enterSplitOverview( mgr, win, zone );
	} );

	return true;
}

/**
 * Called from the drag handler when the pointer released OUTSIDE a
 * snap zone. Clears any half-armed preview state (edge case: user
 * grazed the edge, then released back in the middle).
 */
export function abortSnapIfPending( mgr: WindowManager ): void {
	if ( mgr._snapPendingZone ) {
		hideSnapPreview( mgr );
	}
}
