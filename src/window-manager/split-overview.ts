/**
 * Desktop Mode — Split overview.
 *
 * After a snap commit, the shell shows an overview of every OTHER
 * non-minimized window on the active desktop, laid out as thumbnails
 * in the HALF opposite the snapped window. Clicking a thumbnail fills
 * that opposite half with the picked window (a "partner snap").
 * Clicking the desktop backdrop dismisses the overview without
 * picking — the user just keeps the single-snapped window.
 *
 * The flow reuses the same `computeOverviewLayout` grid + label
 * builders as full overview, but confines the grid to a rect (the
 * opposite half) and doesn't render the desktops top bar. Click
 * commit semantics differ: fill-half instead of maximize.
 *
 * @since 0.8.3
 */

import { doAction, HOOKS } from '../hooks';
import type { Window } from '../window';
import { computeOverviewLayout } from './geometry';
import { createOverviewLabel } from './overview';
import { oppositeHalfRect, type SnapZone } from './snap-zones';
import type { WindowManager } from './index';

/**
 * Mount the split overview for `anchor`'s opposite half. `anchor` is
 * the window that just snapped — it stays visible at its snapped
 * geometry, NOT participating in the overview grid.
 */
export function enterSplitOverview(
	mgr: WindowManager,
	anchor: Window,
	zone: SnapZone,
): void {
	if ( mgr._splitOverviewActive ) {
		return;
	}
	mgr._splitOverviewActive = true;
	mgr._splitOverviewAnchor = anchor;
	mgr._splitOverviewZone = zone;

	// Only non-minimized windows on the active desktop participate,
	// minus the anchor itself (it's already placed).
	const eligible = mgr._stack.filter(
		( w ) =>
			w !== anchor &&
			w.state !== 'minimized' &&
			w.config.desktopId === mgr._activeDesktopId,
	);
	if ( eligible.length === 0 ) {
		// Nothing to show. The snap committed; just exit silently so
		// the user isn't left looking for a picker that can't help.
		cleanupSplitOverviewState( mgr );
		return;
	}

	// Snapshot current transforms so dismiss can restore them.
	mgr._splitOverviewSnapshot.clear();
	for ( const w of eligible ) {
		mgr._splitOverviewSnapshot.set( w.id, {
			transform: w.element.style.transform || '',
			transition: w.element.style.transition || '',
		} );
	}

	// Lay out the grid in the opposite-half rect.
	mgr._desktop.classList.add( 'desktop-mode-area--split-overview' );
	const rect = oppositeHalfRect( mgr, zone );
	const layout = computeOverviewLayout( eligible, rect, 0 );

	mgr._splitOverviewLabels.clear();
	for ( const item of layout ) {
		const el = item.win.element;
		el.classList.add( 'desktop-mode-window--overview' );
		const dx = item.x - el.offsetLeft;
		const dy = item.y - el.offsetTop;
		el.style.transform = `translate(${ dx }px, ${ dy }px) scale(${ item.scale })`;

		const label = createOverviewLabel( item );
		el.insertAdjacentElement( 'afterend', label );
		mgr._splitOverviewLabels.set( item.win.id, label );
	}

	// Click routing.
	//
	// Thumbnails arm a fill-opposite-half commit. Anything else —
	// the backdrop, the snapped anchor window, a widget below, empty
	// space — arms a dismiss. The press-same-element invariant
	// (press target rect must contain the release point) keeps quick
	// drags from committing either flow by mistake, matching the
	// feel of regular overview click handling.
	const pressTargetForEvent = (
		e: PointerEvent,
	): { id: string; element: HTMLElement } | null => {
		const target = e.target as HTMLElement | null;
		const winEl = target?.closest<HTMLElement>(
			'.desktop-mode-window--overview',
		);
		if ( winEl ) {
			return {
				id: winEl.id.replace( /^wp-window-/, '' ),
				element: winEl,
			};
		}
		if ( target ) {
			// Any non-thumbnail target is a dismiss. We hit-test
			// against the desktop-area rect so the pointer-up commit
			// check (see below) only fires when the release also
			// lands somewhere in the desktop — consistent with how
			// regular overview treats backdrop presses.
			return { id: 'dismiss', element: mgr._desktop };
		}
		return null;
	};

	mgr._splitOverviewPointerDown = ( e: PointerEvent ) => {
		if ( e.button !== 0 ) {
			mgr._splitOverviewPressTarget = null;
			return;
		}
		mgr._splitOverviewPressTarget = pressTargetForEvent( e );
		if ( mgr._splitOverviewPressTarget ) {
			e.preventDefault();
			e.stopPropagation();
		}
	};

	mgr._splitOverviewPointerUp = ( e: PointerEvent ) => {
		if ( e.button !== 0 ) {
			return;
		}
		const pressed = mgr._splitOverviewPressTarget;
		mgr._splitOverviewPressTarget = null;
		if ( ! pressed ) {
			return;
		}
		const r = pressed.element.getBoundingClientRect();
		const inside =
			e.clientX >= r.left &&
			e.clientX <= r.right &&
			e.clientY >= r.top &&
			e.clientY <= r.bottom;
		if ( ! inside ) {
			return;
		}
		e.preventDefault();
		e.stopPropagation();

		if ( pressed.id === 'dismiss' ) {
			exitSplitOverview( mgr );
			return;
		}
		const selected = mgr.getById( pressed.id );
		if ( ! selected ) {
			exitSplitOverview( mgr );
			return;
		}
		fillOppositeHalfAndExit( mgr, selected );
	};

	mgr._splitOverviewKey = ( e: KeyboardEvent ) => {
		if ( e.key === 'Escape' ) {
			exitSplitOverview( mgr );
		}
	};

	mgr._splitOverviewClickBlocker = ( e: MouseEvent ) => {
		e.stopPropagation();
		e.preventDefault();
	};

	mgr._desktop.addEventListener(
		'pointerdown',
		mgr._splitOverviewPointerDown,
		true,
	);
	mgr._desktop.addEventListener(
		'pointerup',
		mgr._splitOverviewPointerUp,
		true,
	);
	mgr._desktop.addEventListener(
		'click',
		mgr._splitOverviewClickBlocker,
		true,
	);
	document.addEventListener( 'keydown', mgr._splitOverviewKey );
}

/**
 * Commit: snap the selected window into the half opposite the
 * anchor's half. Then tear down the split overview.
 *
 * Exported (marked `@internal`) so the test suite can drive the
 * partner-fill path without synthesizing PointerEvents, which jsdom
 * doesn't ship. Not part of the public API — callers outside this
 * folder should never touch it; only the pointer handler in
 * `enterSplitOverview` routes here during real user input.
 *
 * @internal
 */
export function fillOppositeHalfAndExit( mgr: WindowManager, selected: Window ): void {
	const anchorZone = mgr._splitOverviewZone;
	if ( ! anchorZone ) {
		exitSplitOverview( mgr );
		return;
	}
	const partnerZone: SnapZone = anchorZone === 'left' ? 'right' : 'left';

	// Clear the overview transform FIRST so the slide starts from the
	// thumbnail's current visual position, not from `(0,0)`. The base
	// transition covers both `transform → ''` and the new inline
	// left/top/width/height, so they animate as one composite pass.
	selected.element.style.transform = '';
	// Drop the overview class on the picked window so its iframe +
	// title bar go back to normal pointer-events. Without this,
	// clicks on the picked window silently early-return from
	// `Window.bindEvents` (which skips the focus request when
	// `--overview` is set) and children are unclickable — the user
	// sees a window that won't activate.
	selected.element.classList.remove( 'desktop-mode-window--overview' );

	// Run through the shared snap applier so the partner fill uses
	// the exact same geometry + class + state logic as a live edge
	// snap or a session-restore. One source of truth for
	// "half-screen snapped."
	selected.applySnap( partnerZone );

	// Drop the picked window out of the overview snapshot — we just
	// moved it, so the exit path shouldn't snap its transform back to
	// whatever it was before the overview began.
	mgr._splitOverviewSnapshot.delete( selected.id );

	mgr.focus( selected );

	doAction( HOOKS.SNAP_SPLIT_FILLED, {
		windowId: selected.id,
		zone: partnerZone,
	} );
	// `applySnap` already fired `_emitChange('state')` → the session
	// saver is queued. No extra dispatch here.

	exitSplitOverview( mgr );
}

/**
 * Tear down the split overview. Restores each non-picked window's
 * pre-overview transform so the fade-back is smooth.
 */
export function exitSplitOverview( mgr: WindowManager ): void {
	if ( ! mgr._splitOverviewActive ) {
		return;
	}
	mgr._splitOverviewActive = false;

	for ( const [ id, snap ] of mgr._splitOverviewSnapshot ) {
		const w = mgr.getById( id );
		if ( ! w ) {
			continue;
		}
		w.element.style.transform = snap.transform;
	}

	for ( const label of mgr._splitOverviewLabels.values() ) {
		label.classList.add( 'desktop-mode-overview-label--out' );
	}
	mgr._desktop.classList.remove( 'desktop-mode-area--split-overview' );

	const ANIMATION_MS = 260;
	window.setTimeout( () => {
		for ( const w of mgr._stack ) {
			// Only clear overview from windows that were in the
			// snapshot — anchor + newly-snapped partner never had the
			// class.
			if ( mgr._splitOverviewSnapshot.has( w.id ) ) {
				w.element.classList.remove( 'desktop-mode-window--overview' );
			}
		}
		for ( const label of mgr._splitOverviewLabels.values() ) {
			label.remove();
		}
		cleanupSplitOverviewState( mgr );
	}, ANIMATION_MS );

	if ( mgr._splitOverviewPointerDown ) {
		mgr._desktop.removeEventListener(
			'pointerdown',
			mgr._splitOverviewPointerDown,
			true,
		);
		mgr._splitOverviewPointerDown = null;
	}
	if ( mgr._splitOverviewPointerUp ) {
		mgr._desktop.removeEventListener(
			'pointerup',
			mgr._splitOverviewPointerUp,
			true,
		);
		mgr._splitOverviewPointerUp = null;
	}
	if ( mgr._splitOverviewClickBlocker ) {
		mgr._desktop.removeEventListener(
			'click',
			mgr._splitOverviewClickBlocker,
			true,
		);
		mgr._splitOverviewClickBlocker = null;
	}
	if ( mgr._splitOverviewKey ) {
		document.removeEventListener( 'keydown', mgr._splitOverviewKey );
		mgr._splitOverviewKey = null;
	}
	mgr._splitOverviewPressTarget = null;
}

function cleanupSplitOverviewState( mgr: WindowManager ): void {
	mgr._splitOverviewSnapshot.clear();
	mgr._splitOverviewLabels.clear();
	mgr._splitOverviewAnchor = null;
	mgr._splitOverviewZone = null;
	mgr._splitOverviewActive = false;
}
