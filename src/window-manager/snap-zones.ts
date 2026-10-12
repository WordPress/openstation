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
 *
 * ## Halves respect minimum widths
 *
 * "Half" is where the split starts, not a rule. A window whose
 * `minWidth` is wider than half the work area takes its minimum, and a
 * window snapped to the other side takes the remainder (see
 * `snapHalfRect` in `geometry.ts`). When the two minimums cannot both
 * fit, each keeps its own and stays against its edge, so the two
 * overlap in the middle rather than either going below its floor.
 * {@link installSnapPartnerReflow} re-lays the other side out whenever
 * a window enters or leaves a snapped state.
 */

import { doAction, HOOKS } from '../hooks';
import { workAreaRectOf } from '../work-area';
import type { Window } from '../window';
import { snapHalfRect } from './geometry';
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
 * The zone a window is snapped to, or `null` when it is not snapped.
 */
function snappedZoneOf( win: Window ): SnapZone | null {
	if ( win.state === 'snapped-left' ) {
		return 'left';
	}
	if ( win.state === 'snapped-right' ) {
		return 'right';
	}
	return null;
}

/**
 * The widest minimum among the windows snapped to the side opposite
 * `zone` on `win`'s desktop: what the other half needs to keep, and so
 * what `win` has to leave it. `0` when the other side is empty.
 */
export function snapPartnerMinWidth(
	mgr: WindowManager,
	win: Window,
	zone: SnapZone,
): number {
	const opposite: SnapZone = zone === 'left' ? 'right' : 'left';
	let min = 0;
	for ( const other of mgr._stack ) {
		if (
			other !== win &&
			other.config.desktopId === win.config.desktopId &&
			snappedZoneOf( other ) === opposite
		) {
			min = Math.max( min, other.config.minWidth || 0 );
		}
	}
	return min;
}

/**
 * Compute the final bounds (in desktop-area-local coordinates) for a
 * given snap zone. Half the work area's width and its full height,
 * keeping the dock's safe area clear. Rounded to whole pixels so the preview
 * rectangle and the committed window line up pixel-perfectly.
 *
 * Pass the window being snapped and the half widens to its minimum
 * width and leaves the other half what the window snapped there needs,
 * the same geometry {@link Window.applySnap} will commit.
 */
export function snapZoneBounds(
	mgr: WindowManager,
	zone: SnapZone,
	win?: Window,
): { x: number; y: number; width: number; height: number } {
	const rect = snapHalfRect(
		workAreaRectOf( mgr._desktop ),
		zone,
		win?.config.minWidth || 0,
		win ? snapPartnerMinWidth( mgr, win, zone ) : 0,
	);
	return { ...rect, height: Math.floor( rect.height ) };
}

/**
 * Write the snapped geometry for `win` without touching its state or
 * emitting a change: the window is still in the zone it was, only the
 * split moved. Writes nothing when the window is already there, so the
 * CSS transition only runs for a window that actually changes size.
 */
export function relayoutSnappedWindow( mgr: WindowManager, win: Window ): void {
	const zone = snappedZoneOf( win );
	const parent = win.element.parentElement;
	if ( ! zone || ! parent ) {
		return;
	}
	const rect = snapHalfRect(
		workAreaRectOf( parent ),
		zone,
		win.config.minWidth || 0,
		snapPartnerMinWidth( mgr, win, zone ),
	);
	const next = {
		left: `${ rect.x }px`,
		top: `${ rect.y }px`,
		width: `${ rect.width }px`,
		height: `${ rect.height }px`,
	};
	const style = win.element.style;
	if (
		style.left === next.left &&
		style.top === next.top &&
		style.width === next.width &&
		style.height === next.height
	) {
		return;
	}
	style.left = next.left;
	style.top = next.top;
	style.width = next.width;
	style.height = next.height;
}

/**
 * Keep the two halves of a split honest as windows come and go.
 *
 * A window's snapped width depends on what is snapped across from it,
 * so a window entering a half can narrow the other side (it needs more
 * than half) and one leaving it can widen the other side back to half.
 * Watches every window change and close, diffs which windows are
 * snapped where, and re-lays out the snapped windows of each desk where
 * that changed. Changes that leave every snap where it was (a move, an
 * arrangement, a focus) re-lay out nothing.
 *
 * Returns the teardown.
 */
export function installSnapPartnerReflow( mgr: WindowManager ): () => void {
	let snapshot = new Map< string, { zone: SnapZone; desktopId: string } >();

	const sync = (): void => {
		// Overview owns the geometry while it is up. The snapshot is left
		// as it was, so the next change after overview still sees the diff.
		if ( mgr._overviewActive ) {
			return;
		}
		const next = new Map< string, { zone: SnapZone; desktopId: string } >();
		for ( const w of mgr._stack ) {
			const zone = snappedZoneOf( w );
			if ( zone ) {
				next.set( w.id, { zone, desktopId: w.config.desktopId || '' } );
			}
		}
		// Every desk where a window entered, left or switched a half.
		const touched = new Set< string >();
		const diff = (
			from: typeof snapshot,
			to: typeof snapshot,
		): void => {
			for ( const [ id, entry ] of from ) {
				const other = to.get( id );
				if (
					! other ||
					other.zone !== entry.zone ||
					other.desktopId !== entry.desktopId
				) {
					touched.add( entry.desktopId );
				}
			}
		};
		diff( snapshot, next );
		diff( next, snapshot );
		snapshot = next;
		if ( touched.size === 0 ) {
			return;
		}
		// Every snapped window on the desk rather than working out which
		// side moved: one already where it belongs is left untouched.
		for ( const w of mgr._stack ) {
			const entry = next.get( w.id );
			if ( entry && touched.has( entry.desktopId ) ) {
				relayoutSnappedWindow( mgr, w );
			}
		}
	};

	document.addEventListener( 'os-window-changed', sync );
	document.addEventListener( 'os-window-closed', sync );
	return () => {
		document.removeEventListener( 'os-window-changed', sync );
		document.removeEventListener( 'os-window-closed', sync );
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
export function showSnapPreview(
	mgr: WindowManager,
	zone: SnapZone,
	win?: Window,
): void {
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
	const b = snapZoneBounds( mgr, zone, win );
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
		showSnapPreview( mgr, zone, win );
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

	// `snapTo` saves the pre-snap geometry first, so a subsequent drag
	// from the snapped title bar can shrink the window back to its
	// earlier floating size (mirrors how maximize saves geometry for
	// un-maximize), and skips the save when `_savedGeometry` already
	// represents some prior state — a snap after a maximize would
	// otherwise overwrite the pre-max bounds with the maximized ones.
	//
	// It then animates to the target bounds. The base window CSS
	// transition covers left/top/width/height transitions for ~250 ms,
	// so the inline styles written by `applySnap` trigger the slide.
	// Going through the shared method (not hand-written inline math)
	// keeps the live snap + session-restore + ResizeObserver paths
	// pixel-identical — any future tweak to "what does snapped-left
	// mean" lives in one place.
	win.snapTo( zone );

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
