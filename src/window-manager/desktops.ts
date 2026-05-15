/**
 * Desktop Mode — Virtual desktops ("Spaces").
 *
 * Each desktop owns its own set of windows. Switching desktops hides
 * the previous group and shows the new one without destroying
 * anything — iframe state, scroll position, in-page JS state all
 * survive a switch. Only one desktop is active at any time.
 *
 * @since 0.8.1
 */

import { doAction, HOOKS } from '../hooks';
import { __, sprintf } from '../i18n';
import type { Desktop } from '../types';
import type { Window } from '../window';
import { computeOverviewLayout } from './geometry';
import { createOverviewLabel, refreshOverviewTopBar } from './overview';
import { OVERVIEW_TOP_BAR_RESERVE } from './overview-constants';
import type { WindowManager } from './index';

export function getDesktops( mgr: WindowManager ): Desktop[] {
	return [ ...mgr._desktops ];
}

/**
 * Currently active desktop. Always defined — there is always at least
 * one desktop in the registry.
 */
export function getActiveDesktop( mgr: WindowManager ): Desktop {
	const found = mgr._desktops.find( ( d ) => d.id === mgr._activeDesktopId );
	// Fallback to first if state ever drifts (e.g. activeDesktopId
	// pointed to a desktop that was removed without re-pointing).
	return found ?? mgr._desktops[ 0 ];
}

export function getActiveDesktopId( mgr: WindowManager ): string {
	return getActiveDesktop( mgr ).id;
}

/**
 * Show / hide a single window based on whether its desktop matches
 * the active one. Centralises the "windows on inactive desktops are
 * display:none" rule so any future tweak (e.g. opacity-fade instead
 * of hard hide) lives in one place.
 *
 * Native windows ride along with their desktop just like iframe
 * windows — there's no reason "OS Settings opened on Desktop 2"
 * should leak into Desktop 1.
 */
export function applyDesktopVisibility( mgr: WindowManager, win: Window ): void {
	const visible = win.config.desktopId === mgr._activeDesktopId;
	win.element.style.display = visible ? '' : 'none';
}

/**
 * Re-evaluate visibility for every window. Called after the active
 * desktop changes or after a window is reassigned to a different
 * desktop (e.g. when its previous desktop was closed and its windows
 * were migrated to the survivor).
 */
export function refreshDesktopVisibility( mgr: WindowManager ): void {
	for ( const w of mgr._stack ) {
		applyDesktopVisibility( mgr, w );
	}
}

/**
 * Append a brand-new desktop and return it. The new desktop's label
 * is auto-numbered (`Desktop 2`, `Desktop 3`, …) using the monotonic
 * seq counter so closing + reopening doesn't reuse the same id
 * mid-session.
 */
export function createDesktop( mgr: WindowManager ): Desktop {
	mgr._desktopSeq++;
	const desktop: Desktop = {
		id: `desktop-${ mgr._desktopSeq }`,
		// translators: %d is the desktop number (e.g., "Desktop 2")
		label: sprintf( __( 'Desktop %d' ), mgr._desktopSeq ),
	};
	mgr._desktops.push( desktop );
	doAction( HOOKS.DESKTOP_CREATED, { desktopId: desktop.id } );
	return desktop;
}

/**
 * Switch the active desktop. No-op if `id` is already active or
 * doesn't exist. Fires `desktop-mode.desktop.switched` with both the
 * leaving and entering desktop ids so plugins can sync per-desktop
 * state (active-desktop-aware indicators, custom widgets, etc.).
 */
/**
 * Optional shape `switchDesktop` accepts to drive the slide animation
 * direction. Callers that know the user's intent (the arrow-key
 * handler) pass `direction`; everyone else omits it and the switch is
 * instantaneous.
 */
export interface SwitchDesktopOptions {
	/**
	 * Visual slide direction.
	 *
	 *   - `'next'`: content slides in from the right. Matches a
	 *     rightward arrow press, including the wrap from last → first
	 *     (the user perceived a rightward motion regardless of the
	 *     index delta).
	 *   - `'prev'`: content slides in from the left.
	 *
	 * Omitting it (or passing nothing) skips the animation — fine for
	 * jump-to-desktop callers (tile click, plugin API) where there's
	 * no left/right metaphor to honour.
	 */
	direction?: 'next' | 'prev';
}

export function switchDesktop(
	mgr: WindowManager,
	id: string,
	opts?: SwitchDesktopOptions,
): void {
	if ( id === mgr._activeDesktopId ) {
		return;
	}
	if ( ! mgr._desktops.some( ( d ) => d.id === id ) ) {
		return;
	}
	const previousId = mgr._activeDesktopId;
	mgr._activeDesktopId = id;

	// Visibility + overview state must stay in sync. Outside overview
	// it's a plain show/hide refresh. Mid-overview, the grid has
	// already snapshotted the previous desktop's windows at scaled
	// transforms — flipping `display` alone would surface the new
	// desktop's windows at their saved (non-overview) geometry on top
	// of a still-visible overview backdrop. `relayoutOverviewForActiveDesktop`
	// clears the stale snapshot, surfaces the new desktop's windows
	// with overview transforms, and the top-bar refresh moves the
	// `--active` highlight to match. Without these two calls,
	// keyboard-driven desktop switching mid-overview looked like
	// "nothing happened" even though the underlying active id moved.
	if ( mgr._overviewActive ) {
		relayoutOverviewForActiveDesktop( mgr );
		refreshOverviewTopBar( mgr );
	} else {
		refreshDesktopVisibility( mgr );
		if ( opts?.direction ) {
			animateDesktopSwitch( mgr, opts.direction );
		}

		// Re-focus the topmost window on the new desktop. Without this,
		// focus / z-state would still point at the prior desktop's window
		// — invisible and confusing if the user then triggers a dock
		// action that reuses the focused window's context.
		const topOnNew = [ ...mgr._stack ]
			.reverse()
			.find(
				( w ) =>
					w.config.desktopId === id && w.state !== 'minimized',
			);
		if ( topOnNew ) {
			mgr.focus( topOnNew );
		}
	}

	doAction( HOOKS.DESKTOP_SWITCHED, {
		from: previousId,
		to: id,
	} );
}

/**
 * Play the one-shot slide-in animation on the desktop area itself.
 * The wallpaper layer is a sibling under `.desktop-mode-shell`, not
 * a child of `_desktop`, so sliding `_desktop` reveals the wallpaper
 * as a backdrop on the leading edge — no black gap, no flash.
 *
 * `void el.offsetWidth` forces a reflow so re-adding the class after a
 * removal actually restarts the keyframe. Without it, two consecutive
 * arrow presses would play the animation once and freeze on the
 * second.
 *
 * The `animationend` listener filters on `animationName` so child
 * animations (window-open, window-shake, …) bubbling up through the
 * desktop area don't strip our class mid-flight.
 */
function animateDesktopSwitch(
	mgr: WindowManager,
	direction: 'next' | 'prev',
): void {
	const el = mgr._desktop;
	const cls =
		direction === 'next'
			? 'desktop-mode-area--sliding-from-right'
			: 'desktop-mode-area--sliding-from-left';
	el.classList.remove(
		'desktop-mode-area--sliding-from-right',
		'desktop-mode-area--sliding-from-left',
	);
	void el.offsetWidth;
	el.classList.add( cls );
	const onEnd = ( e: AnimationEvent ): void => {
		if ( ! e.animationName.startsWith( 'desktop-mode-area-slide-from-' ) ) {
			return;
		}
		el.classList.remove( cls );
		el.removeEventListener( 'animationend', onEnd );
	};
	el.addEventListener( 'animationend', onEnd );
}

/**
 * Close a desktop. Refuses to close the last remaining desktop — the
 * shell needs at least one. Windows on the closed desktop migrate to
 * the surviving desktop the user lands on (the one to the left in
 * the bar, falling back to the first), so the user never silently
 * loses work to a misclick.
 */
export function closeDesktop( mgr: WindowManager, id: string ): void {
	if ( mgr._desktops.length <= 1 ) {
		return;
	}
	const idx = mgr._desktops.findIndex( ( d ) => d.id === id );
	if ( idx === -1 ) {
		return;
	}
	// Pick the destination for orphaned windows — and the next active
	// desktop if we're closing the active one. Prefer the neighbour to
	// the left so the user's eye stays anchored; fall back to the
	// right neighbour at index 0.
	const survivorIdx = idx > 0 ? idx - 1 : 1;
	const survivor = mgr._desktops[ survivorIdx ];

	for ( const w of mgr._stack ) {
		if ( w.config.desktopId === id ) {
			w.config.desktopId = survivor.id;
		}
	}

	mgr._desktops.splice( idx, 1 );

	const wasActive = mgr._activeDesktopId === id;
	if ( wasActive ) {
		mgr._activeDesktopId = survivor.id;
	}

	// Visibility update path. Two cases:
	//
	// 1. Not in overview — plain `refreshDesktopVisibility` is enough;
	//    windows show / hide via `display`, no transforms in play.
	//
	// 2. In overview — calling `refreshDesktopVisibility` alone would
	//    surface the survivor's windows at their saved geometry on
	//    top of an overview backdrop that's still showing, with the
	//    previously-active windows still carrying stale grid
	//    transforms + the `--overview` class.
	//    `relayoutOverviewForActiveDesktop` flips both sides cleanly:
	//    clears overview state from windows that just became inactive,
	//    and applies the grid transform + label to whichever windows
	//    are now on the active desktop.
	if ( mgr._overviewActive ) {
		relayoutOverviewForActiveDesktop( mgr );
	} else {
		refreshDesktopVisibility( mgr );
	}

	doAction( HOOKS.DESKTOP_CLOSED, {
		desktopId: id,
		migratedTo: survivor.id,
	} );
}

/**
 * Tear down + re-apply the overview grid for whichever desktop is
 * currently active. Used by `closeDesktop` when the close happens
 * mid-overview — without it, the post-close visual state is a
 * mismatch (top bar visible, but windows at non-overview positions).
 *
 * Steps:
 *   1. Clear overview state from every window that was in the
 *      previous snapshot (transform → restored, class removed, label
 *      dropped).
 *   2. Re-evaluate `display` per window so the new active desktop's
 *      windows surface and the rest hide.
 *   3. Snapshot + lay out the new active desktop's eligible windows
 *      in the overview grid.
 *
 * If the new active desktop has no eligible windows (empty desktop),
 * the overview just shows the top bar over the dim backdrop — the
 * user can still pick another desktop or hit Escape.
 */
export function relayoutOverviewForActiveDesktop( mgr: WindowManager ): void {
	// 1. Clear stale overview state.
	for ( const [ winId, snap ] of mgr._overviewSnapshot ) {
		const w = mgr.getById( winId );
		if ( w ) {
			w.element.style.transform = snap.transform;
			w.element.style.transition = snap.transition;
			w.element.classList.remove( 'desktop-mode-window--overview' );
		}
	}
	for ( const label of mgr._overviewLabels.values() ) {
		label.remove();
	}
	mgr._overviewLabels.clear();
	mgr._overviewSnapshot.clear();

	// 2. Surface / hide windows for the new active desktop.
	refreshDesktopVisibility( mgr );

	// 3. Lay out the new active desktop's windows in the grid. Native
	//    windows (OS Settings, plugin-registered panels) participate
	//    just like iframe windows — from overview's point of view
	//    they're windows with content, nothing special.
	const eligible = mgr._stack.filter(
		( w ) =>
			w.state !== 'minimized' &&
			w.config.desktopId === mgr._activeDesktopId,
	);
	if ( eligible.length === 0 ) {
		return;
	}

	for ( const w of eligible ) {
		mgr._overviewSnapshot.set( w.id, {
			transform: w.element.style.transform || '',
			transition: w.element.style.transition || '',
		} );
	}

	// At this point the dock has already collapsed (we're mid-
	// overview), so the desktop area's bounding rect already reflects
	// the post-collapse width. `computeOverviewLayout` takes an
	// area-relative rect — left/top = 0, dimensions straight from
	// the live bounding rect.
	const live = mgr._desktop.getBoundingClientRect();
	const targetRect = new DOMRect( 0, 0, live.width, live.height );
	const layout = computeOverviewLayout(
		eligible,
		targetRect,
		OVERVIEW_TOP_BAR_RESERVE,
	);
	for ( const item of layout ) {
		const el = item.win.element;
		el.classList.add( 'desktop-mode-window--overview' );
		const dx = item.x - el.offsetLeft;
		const dy = item.y - el.offsetTop;
		el.style.transform = `translate(${ dx }px, ${ dy }px) scale(${ item.scale })`;
		const label = createOverviewLabel( item );
		el.insertAdjacentElement( 'afterend', label );
		mgr._overviewLabels.set( item.win.id, label );
	}
}

/**
 * Replace the in-memory desktops list with a server-restored
 * snapshot. Called once during shell boot, BEFORE any windows are
 * recreated, so the per-window `desktopId` assignments line up with
 * desktop ids that actually exist.
 *
 * Defends against an empty list — the shell can't function with zero
 * desktops, so an empty payload falls back to the default. The seq
 * counter advances past the highest numeric suffix in the restored
 * list so newly created desktops don't collide.
 */
export function seedDesktops(
	mgr: WindowManager,
	desktops: Desktop[],
	activeDesktopId: string,
): void {
	if ( desktops.length === 0 ) {
		return;
	}
	mgr._desktops = desktops.map( ( d ) => ( { ...d } ) );
	mgr._activeDesktopId = desktops.some( ( d ) => d.id === activeDesktopId )
		? activeDesktopId
		: desktops[ 0 ].id;

	// Advance the seq counter past the highest existing numeric
	// suffix (`desktop-3` → seq 3) so the next createDesktop()
	// produces a fresh id.
	let highest = 0;
	for ( const d of desktops ) {
		const match = d.id.match( /^desktop-(\d+)$/ );
		if ( match ) {
			const n = parseInt( match[ 1 ], 10 );
			if ( Number.isFinite( n ) && n > highest ) {
				highest = n;
			}
		}
	}
	mgr._desktopSeq = Math.max( mgr._desktopSeq, highest );
}
