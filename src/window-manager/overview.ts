/**
 * OpenStation — Overview (zoom-out grid).
 *
 * Animate every eligible window to a grid thumbnail, plus a top bar
 * showing one tile per virtual desktop. Clicking a thumbnail exits
 * overview, focusing and bringing the clicked window to the front. Pressing Escape or
 * clicking the backdrop exits without selection.
 *
 * The lifecycle is big (enter/exit + click + key handlers + top bar
 * + label builders) so it lives here rather than piling onto the
 * orchestrator. `desktops.ts` reaches back into `createOverviewLabel`
 * during mid-overview desktop closes; the resulting import cycle is
 * a function-level one (safe at runtime as long as neither side calls
 * the other at module-load time).
 */

import { doAction, HOOKS } from '../hooks';
import { _n, __, sprintf } from '../i18n';
import { osIconSvg } from '../ui/icons';
import type { Desktop } from '../types';
import { computeOverviewLayout, type OverviewLayoutItem } from './geometry';
import { OVERVIEW_TOP_BAR_RESERVE } from './overview-constants';
import {
	closeDesktop,
	createDesktop,
	renameDesktop,
	switchDesktop,
} from './desktops';
import type { Window } from '../window';
import { updateFullscreenBodyClass } from '../window/dom';
// Leaf import, not the `../workspaces` barrel: the bar needs the one
// control builder, and the barrel also carries the public API and the
// editor loader.
import {
	createWorkspaceFromOverview,
	editWorkspaceFromOverview,
	isWorkspaceOverviewInstalled,
	restoreWorkspace,
	workspaceCanRestore,
} from '../workspaces/overview-control';
import type { WindowManager } from './index';

/**
 * Element IDs of background chrome to make inert during overview.
 *
 * These elements sit in the DOM between `#wpadminbar` (deliberately
 * left active) and the overview-top-bar tiles. Without inert the
 * browser's Tab order would traverse them before reaching any
 * visible tile, wasting keyboard-user keystrokes on hidden UI
 * (admin menu, dock buttons, widget controls ).
 *
 * Each element is restored to non-inert on overview exit.
 */
const OVERVIEW_INERT_ELEMENTS = [
	'adminmenumain',
	'adminmenuback',
	'os-dock',
	'os-side-dock',
	'os-widgets',
];

const OVERVIEW_FULLSCREEN_DATA_KEY = 'osHadFullscreenBeforeOverview';

/**
 * Make a window usable as an overview thumbnail without changing its
 * logical state. Fullscreen styling and minimized render suppression
 * are restored when the window returns to its desktop layout.
 */
export function prepareWindowForOverviewLayout( w: Window ): void {
	if (
		w.state === 'fullscreen' ||
		w.element.classList.contains( 'os-window--fullscreen' )
	) {
		w.element.classList.remove( 'os-window--fullscreen' );
		w.element.dataset[ OVERVIEW_FULLSCREEN_DATA_KEY ] = 'true';
		updateFullscreenBodyClass();
	}
	if ( w.state !== 'minimized' ) {
		return;
	}
	w.element.style.removeProperty( 'content-visibility' );
	if ( w.iframe ) {
		w.iframe.style.visibility = '';
	}
}

function restoreOverviewFullscreenState( w: Window ): void {
	if ( w.element.dataset[ OVERVIEW_FULLSCREEN_DATA_KEY ] !== 'true' ) {
		return;
	}
	if ( w.state !== 'fullscreen' && w.state !== 'minimized' ) {
		delete w.element.dataset[ OVERVIEW_FULLSCREEN_DATA_KEY ];
		updateFullscreenBodyClass();
		return;
	}
	w.element.classList.add( 'os-window--fullscreen' );
	delete w.element.dataset[ OVERVIEW_FULLSCREEN_DATA_KEY ];
	updateFullscreenBodyClass();
}

/** Restore any render-suppression / state-class changes made for overview. */
export function restoreWindowAfterOverviewLayout(
	w: Window,
	restoreFullscreen = true,
): void {
	if ( restoreFullscreen ) {
		restoreOverviewFullscreenState( w );
	}
	if ( w.state === 'minimized' ) {
		w.element.style.setProperty( 'content-visibility', 'hidden' );
		if ( w.iframe ) {
			w.iframe.style.visibility = 'hidden';
		}
	}
}

/**
 * Toggle inert on every direct child of #wpbody-content so focus
 * can't land on hidden screen-options, help panels, or admin
 * notices during overview.
 */
function inertWpBodyContentChildren( inactive: boolean ): void {
	const content = document.getElementById( 'wpbody-content' );
	if ( ! content ) {
		return;
	}
	for ( const child of Array.from( content.children ) ) {
		( child as HTMLElement & { inert: boolean } ).inert = inactive;
	}
}

/**
 * Toggle inert on every direct child of window elements so keyboard focus
 * cannot land on inner controls / titlebar buttons / iframes during overview,
 * while leaving the window root element non-inert so thumbnail pointer hits succeed.
 */
function inertWindowChildren( mgr: WindowManager, inactive: boolean ): void {
	for ( const w of mgr._stack ) {
		for ( const child of Array.from( w.element.children ) ) {
			( child as HTMLElement & { inert: boolean } ).inert = inactive;
		}
	}
}

/**
 * Enter overview mode — animate every eligible window to a grid
 * thumbnail layout. Clicking a thumbnail exits overview,
 * focusing and bringing the clicked window to the front. Pressing Escape
 * or clicking the backdrop exits without selection.
 */
export function enterOverview( mgr: WindowManager ): void {
	if ( mgr._overviewActive ) {
		return;
	}
	// A previous exit may still be mid-animation (the user double-tapped
	// the trigger). Settle it now so its timer can't fire inside the
	// session we're about to build. See `flushPendingOverviewExit`.
	flushPendingOverviewExit( mgr );
	// Overview shows windows on the active desktop, including minimized
	// ones. Minimized windows are rendered with a visual indicator
	// (lower opacity) so the user can see all their work at a glance.
	// Clicking a minimized thumbnail restores + focuses it on exit.
	const eligible = mgr._stack.filter(
		( w ) =>
			w.config.desktopId === mgr._activeDesktopId,
	);
	// Even with zero windows on the active desktop we still enter
	// overview — otherwise an empty desktop would have no way to
	// reach the top bar to switch to one with windows.
	mgr._overviewActive = true;

	doAction( HOOKS.OVERVIEW_ENTERING, {} );
	// The dock only re-reads system-tile predicates when told to.
	doAction( HOOKS.DOCK_REFRESH_ACTIVE, {} );

	// Make background left admin bar and the Dock inert so Tab focus doesn't traverse them.
	// We deliberately leave the top admin bar (wpadminbar) active and reachable.
	for ( const id of OVERVIEW_INERT_ELEMENTS ) {
		const el = document.getElementById( id );
		if ( el ) {
			( el as HTMLElement & { inert: boolean } ).inert = true;
		}
	}
	// Make all siblings of the shell inside wpbody-content inert
	// so focus doesn't land on hidden screen options / help buttons.
	inertWpBodyContentChildren( true );
	// Make all window children (iframes, titlebars, tabs) inert so
	// keyboard focus cannot traverse hidden window controls during
	// overview, while leaving window root elements non-inert for clicks.
	inertWindowChildren( mgr, true );

	// Snapshot current transform + transition so exit can restore
	// exactly — matters when plugins have applied custom transforms
	// of their own.
	mgr._overviewSnapshot.clear();
	for ( const w of eligible ) {
		mgr._overviewSnapshot.set( w.id, {
			transform: w.element.style.transform || '',
			transition: w.element.style.transition || '',
		} );
	}

	// Fullscreen-state windows escape the shell's stacking context;
	// suspend their visual class before computing layout so the
	// transform math stays consistent without changing their logical
	// state or saved geometry.
	for ( const w of eligible ) {
		prepareWindowForOverviewLayout( w );
	}

	// Target rect for the layout. `computeOverviewLayout` expects
	// area-relative coordinates (same space as `offsetLeft` /
	// `offsetTop`), so left + top are 0. Width accounts for the
	// dock rails' imminent collapse: every horizontally-placed
	// dock element (`#os-dock` when bottom-placed
	// doesn't affect width; `#os-side-dock` AND any
	// bottom dock placed left/right via the layout dispatcher do)
	// is about to shrink to width 0 over the next ~280 ms, and we
	// lay out as if the animation has already settled so
	// thumbnails land at their final positions in a single pass.
	//
	// Sum every visible `.os-dock` whose CURRENT bounding
	// rect overlaps the desktop area's vertical extent — those are
	// the rails actually consuming horizontal space right now.
	// Bottom-placed docks (full-width, sitting below the desktop
	// area) won't overlap the area's vertical extent except at
	// their top-edge fringe, so they're correctly excluded.
	const currentRect = mgr._desktop.getBoundingClientRect();
	const docks = Array.from(
		document.querySelectorAll< HTMLElement >( '.os-dock' ),
	);
	let reclaimedWidth = 0;
	for ( const d of docks ) {
		const r = d.getBoundingClientRect();
		const verticallyOverlaps =
			r.bottom > currentRect.top && r.top < currentRect.bottom;
		const isHorizontalRail = r.height > r.width;
		if ( verticallyOverlaps && isHorizontalRail ) {
			reclaimedWidth += r.width;
		}
	}
	const targetRect = new DOMRect(
		0,
		0,
		currentRect.width + reclaimedWidth,
		currentRect.height,
	);

	mgr._desktop.classList.add( 'os-area--overview' );
	const shell = document.getElementById( 'os-shell' );
	shell?.classList.add( 'os-shell--overview' );

	// Build + mount the top bar. Belongs INSIDE the desktop area so
	// it shares the dim backdrop, but its own clicks are allowed past
	// the click blocker (see below).
	mgr._overviewTopBar = buildOverviewTopBar( mgr );
	mgr._desktop.appendChild( mgr._overviewTopBar );

	// Reserve vertical space at the top for the bar so the grid
	// shifts down (and shrinks to fit) — thumbnails never land behind
	// the tile strip.
	const layout = computeOverviewLayout(
		eligible,
		targetRect,
		OVERVIEW_TOP_BAR_RESERVE,
	);

	mgr._overviewLabels.clear();
	for ( const item of layout ) {
		const el = item.win.element;
		el.classList.add( 'os-window--overview' );
		const dx = item.x - el.offsetLeft;
		const dy = item.y - el.offsetTop;
		// transform-origin: top left (set in CSS) so translate + scale
		// compose without drift.
		el.style.transform = `translate(${ dx }px, ${ dy }px) scale(${ item.scale })`;

		// Label above the thumbnail. Position in desktop-area
		// coordinates so it's unaffected by the window's transform —
		// critical for readability when thumbnails shrink to
		// icon-size. The `data-window-id` attribute enables the
		// adjacent-sibling CSS rule that keeps this label bright when
		// its window is hovered (see windows.css).
		const label = createOverviewLabel( item );
		// Insert immediately AFTER the window element so the
		// adjacent-sibling CSS selector ( `:hover + .label` ) can
		// target the right label.
		el.insertAdjacentElement( 'afterend', label );
		mgr._overviewLabels.set( item.win.id, label );
	}

	// Press-in-same-element semantics, commit-on-release. Matches how
	// native buttons / links feel: a press "arms" the element, and
	// the release either fires the action (if it lands inside the
	// armed element's visible bounds) or cancels (if the pointer
	// moved off). We deliberately skip the `click` event here because
	// its target is the common ancestor of the down/up pair, which
	// produced the "press on A, release on B → browser synthesizes
	// click on desktop → exits overview" bug we saw before.
	//
	// Hit-testing at release uses the pressed element's bounding rect
	// rather than `e.target` equality — bounding rect is forgiving of
	// a few pixels of finger drift during a quick tap, which strict
	// target equality rejected (noticeable on small thumbnails).
	const pressTargetForEvent = (
		e: PointerEvent,
	): { id: string; element: HTMLElement } | null => {
		const target = e.target as HTMLElement | null;
		const winEl = target?.closest<HTMLElement>(
			'.os-window--overview',
		);
		if ( winEl ) {
			return {
				id: winEl.id.replace( /^wp-window-/, '' ),
				element: winEl,
			};
		}
		if ( target === mgr._desktop ) {
			return { id: 'backdrop', element: mgr._desktop };
		}
		return null;
	};

	mgr._overviewPointerDownHandler = ( e: PointerEvent ) => {
		// Only primary button / single-touch — ignore right-click,
		// middle-click, and pen-eraser so they don't latch a press
		// target that a left-click up would then match against.
		if ( e.button !== 0 ) {
			mgr._overviewPressTarget = null;
			return;
		}
		mgr._overviewPressTarget = pressTargetForEvent( e );
		// Swallow the down so iframes / inner UI can't start a
		// drag-select or native focus operation while we're acting
		// as a click surface.
		if ( mgr._overviewPressTarget ) {
			e.preventDefault();
			e.stopPropagation();
		}
	};

	mgr._overviewPointerUpHandler = ( e: PointerEvent ) => {
		if ( e.button !== 0 ) {
			return;
		}
		const pressed = mgr._overviewPressTarget;
		mgr._overviewPressTarget = null;
		if ( ! pressed ) {
			return;
		}
		const rect = pressed.element.getBoundingClientRect();
		const inside =
			e.clientX >= rect.left &&
			e.clientX <= rect.right &&
			e.clientY >= rect.top &&
			e.clientY <= rect.bottom;
		if ( ! inside ) {
			// Release landed outside the pressed element's visible
			// bounds — treat as a drag-off cancel.
			return;
		}
		e.preventDefault();
		e.stopPropagation();
		if ( pressed.id === 'backdrop' ) {
			exitOverview( mgr );
			return;
		}
		const selected = mgr.getById( pressed.id );
		doAction( HOOKS.OVERVIEW_WINDOW_CLICK, { windowId: pressed.id } );
		exitOverview( mgr, selected );
	};

	mgr._overviewKeyHandler = ( e: KeyboardEvent ) => {
		if ( e.key === 'Escape' ) {
			exitOverview( mgr );
			return;
		}
		// Enter commits whatever the keyboard cursor is parked on:
		//
		//   - "+" tile  → create a new desktop and exit onto it.
		//   - desktop   → exit overview onto the currently active
		//                 desktop (arrow keys keep that in sync as the
		//                 cursor moves through tiles).
		if ( e.key === 'Enter' ) {
			// If the user is parked on an explicit button (like the close X or desktop tile),
			// let the native click event handle it.
			const target = e.target as HTMLElement | null;
			const doc = target?.ownerDocument || document;
			if ( doc.activeElement && doc.activeElement.tagName === 'BUTTON' ) {
				return;
			}
			e.preventDefault();
			if ( mgr._overviewAddTileFocused ) {
				commitAddTile( mgr );
				return;
			}
			exitOverview( mgr );
		}
	};
	mgr._desktop.addEventListener(
		'pointerdown',
		mgr._overviewPointerDownHandler,
		true,
	);
	mgr._desktop.addEventListener(
		'pointerup',
		mgr._overviewPointerUpHandler,
		true,
	);
	// Sticky capture-phase click blocker. Stops the browser-synthesized
	// click that follows every pointerdown+pointerup pair from ever
	// reaching the desktop area's "minimize every window" click
	// handler. Top-bar clicks are exempt — those are deliberate UI
	// interactions (switch desktop, create, close) that need their
	// own handlers to fire.
	mgr._overviewClickBlocker = ( e: MouseEvent ) => {
		const target = e.target as HTMLElement | null;
		if ( target?.closest( '.os-overview-top-bar' ) ) {
			return;
		}
		e.stopPropagation();
		e.preventDefault();
	};
	mgr._desktop.addEventListener(
		'click',
		mgr._overviewClickBlocker,
		true,
	);
	document.addEventListener( 'keydown', mgr._overviewKeyHandler );

	// Hover delegation — mouseover bubbles up to the desktop area, so
	// one handler covers every thumbnail. We track the last-hovered
	// window id so we can fire paired hover/unhover actions even when
	// the pointer moves directly from one thumbnail to the next
	// without crossing empty space.
	mgr._lastOverviewHoverId = null;
	mgr._overviewMouseHandler = ( e: MouseEvent ) => {
		const target = e.target as HTMLElement | null;
		const winEl = target?.closest<HTMLElement>(
			'.os-window--overview',
		);
		const newId = winEl
			? winEl.id.replace( /^wp-window-/, '' )
			: null;
		if ( newId === mgr._lastOverviewHoverId ) {
			return;
		}
		if ( mgr._lastOverviewHoverId ) {
			doAction( HOOKS.OVERVIEW_WINDOW_UNHOVER, {
				windowId: mgr._lastOverviewHoverId,
			} );
		}
		if ( newId ) {
			doAction( HOOKS.OVERVIEW_WINDOW_HOVER, { windowId: newId } );
		}
		mgr._lastOverviewHoverId = newId;
	};
	mgr._desktop.addEventListener( 'mouseover', mgr._overviewMouseHandler );

	// Signal "entered" after the grid animation settles. Matches the
	// 280 ms transform transition — plugins listening here can safely
	// read final layout positions. Handle is tracked so `destroy()`
	// can cancel it if the manager is discarded before it fires.
	mgr._overviewEnterTimeoutId = window.setTimeout( () => {
		mgr._overviewEnterTimeoutId = null;
		if ( mgr._overviewActive ) {
			doAction( HOOKS.OVERVIEW_ENTERED, {} );
		}
	}, 300 ) as unknown as number;
}

/**
 * Run the pending exit-animation cleanup now, cancelling its timer.
 *
 * The timer itself calls this; so does `enterOverview()`, because a
 * re-entry inside the 280 ms exit window would otherwise leave a live
 * timer that fires MID-session and undoes the new session's setup —
 * stripping `os-window--overview` from every thumbnail, re-adding
 * `os-window--fullscreen` to a window whose class was suspended for
 * layout (blowing one thumbnail up to fullscreen size and hiding the
 * admin bar with it), and removing the top bar that enter just built.
 *
 * Settling the outgoing session first is what makes double-tapping
 * the overview trigger safe: `OVERVIEW_EXITED` lands before
 * `OVERVIEW_ENTERING`, in the order a listener expects.
 *
 * No-op when nothing is pending.
 */
export function flushPendingOverviewExit( mgr: WindowManager ): void {
	if ( mgr._overviewExitTimeoutId !== null ) {
		window.clearTimeout( mgr._overviewExitTimeoutId );
		mgr._overviewExitTimeoutId = null;
	}
	const finalize = mgr._overviewExitFinalizer;
	mgr._overviewExitFinalizer = null;
	finalize?.();
}

/**
 * Cancel any pending overview transition timers without running their
 * callbacks. Called from `WindowManager.destroy()` so a discarded
 * manager can never fire a delayed `doAction()` that reaches for
 * globals torn down after the manager itself.
 */
export function cancelOverviewTimers( mgr: WindowManager ): void {
	if ( mgr._overviewEnterTimeoutId !== null ) {
		window.clearTimeout( mgr._overviewEnterTimeoutId );
		mgr._overviewEnterTimeoutId = null;
	}
	if ( mgr._overviewExitTimeoutId !== null ) {
		window.clearTimeout( mgr._overviewExitTimeoutId );
		mgr._overviewExitTimeoutId = null;
	}
	// Dropped, not run — `destroy()` wants the callback gone, and its
	// `doAction()` would reach for globals this teardown is removing.
	mgr._overviewExitFinalizer = null;
}

/** Build the overview top bar — a tile per virtual desktop plus "+". */
function buildOverviewTopBar( mgr: WindowManager ): HTMLElement {
	const bar = document.createElement( 'div' );
	bar.className = 'os-overview-top-bar';

	const list = document.createElement( 'div' );
	list.className = 'os-overview-top-bar__list';
	bar.appendChild( list );

	for ( const d of mgr._desktops ) {
		list.appendChild( buildDesktopTile( mgr, d ) );
	}

	// Trailing "+" tile.
	const addTile = document.createElement( 'button' );
	addTile.type = 'button';
	addTile.className =
		'os-overview-top-bar__tile os-overview-top-bar__tile--add';
	if ( mgr._overviewAddTileFocused ) {
		// Mirrors the `--active` highlight on the active desktop tile —
		// signals "this is where Enter will land". Distinct class name
		// so future styling can diverge from the active-desktop look
		// without touching click handlers.
		addTile.classList.add(
			'os-overview-top-bar__tile--cursor',
		);
	}
	addTile.setAttribute( 'aria-label', __( 'Add new desktop' ) );
	addTile.innerHTML =
		'<span class="os-overview-top-bar__tile-plus" aria-hidden="true">+</span>';
	addTile.addEventListener( 'click', ( e: MouseEvent ) => {
		e.preventDefault();
		e.stopPropagation();
		commitAddTile( mgr );
	} );
	list.appendChild( addTile );

	return bar;
}

/**
 * Create a new desktop, switch to it, and exit overview onto it.
 * Shared by the "+" tile click handler AND the Enter-key commit path
 * when the keyboard cursor is parked on the "+" tile. macOS Spaces
 * ergonomics — pressing "+" lands you on the freshly-created blank
 * space without an extra hop.
 */
export function commitAddTile( mgr: WindowManager ): void {
	mgr._overviewAddTileFocused = false;
	// The `+` opens the wizard when a shell has wired one. Its first
	// step is a blank desktop, preselected and one Enter away, so the
	// fast path is as fast as it was — and the same `+` is now also
	// the way to a desk set up for a job. Overview is left first: the
	// wizard is a modal over the desk, and the desk it creates is
	// switched to on Create, which is a switch overview should not be
	// open for.
	if ( createWorkspaceFromOverview() ) {
		exitOverview( mgr );
		return;
	}
	// No wizard installed (a shell that never wired workspaces, or a
	// test building a bar on its own): the `+` is what it always was.
	const created = createDesktop( mgr );
	exitOverviewToDesktop( mgr, created.id );
}

/** Build a single desktop tile for the overview top bar. */
function buildDesktopTile( mgr: WindowManager, d: Desktop ): HTMLElement {
	const wrapper = document.createElement( 'div' );
	wrapper.className = 'os-overview-top-bar__tile-wrapper';

	const tile = document.createElement( 'button' );
	tile.type = 'button';
	tile.className = 'os-overview-top-bar__tile';
	tile.dataset.desktopId = d.id;
	// Active highlight follows the keyboard cursor: when the cursor is
	// parked on the "+" tile, no desktop tile should also light up.
	// The active desktop's windows still render in the grid behind the
	// bar, so there's still context — but the visual selection is
	// unambiguous: only the "+" reads as "Enter lands here".
	if ( d.id === mgr._activeDesktopId && ! mgr._overviewAddTileFocused ) {
		tile.classList.add( 'os-overview-top-bar__tile--active' );
	}
	// translators: %s is the desktop label
	tile.setAttribute( 'aria-label', sprintf( __( 'Switch to %s' ), d.label ) );

	// A workspace wears its identity here too, not only on the
	// switcher pill: overview is where the user compares desks, and a
	// row of identical grey tiles is exactly where "which one was the
	// shop?" gets asked. A plain Space has no profile and stays plain.
	const profile = d.profile;
	if ( profile?.color ) {
		wrapper.style.setProperty( '--os-workspace-accent', profile.color );
		tile.classList.add( 'os-overview-top-bar__tile--tinted' );
	}

	const preview = document.createElement( 'span' );
	preview.className = 'os-overview-top-bar__tile-preview';
	if ( profile?.icon ) {
		const glyph = document.createElement( 'span' );
		glyph.className = `os-overview-top-bar__tile-glyph dashicons ${ profile.icon }`;
		glyph.setAttribute( 'aria-hidden', 'true' );
		preview.appendChild( glyph );
	}
	// Window-count badge inside the preview area gives users a quick
	// "what's on this desktop" hint without needing real per-window
	// thumbnails (a follow-up enhancement). Includes native windows —
	// they're windows just like iframes from the user's
	// count-what's-open perspective.
	const count = mgr._stack.filter(
		( w ) => w.config.desktopId === d.id,
	).length;
	if ( count > 0 ) {
		const badge = document.createElement( 'span' );
		badge.className = 'os-overview-top-bar__tile-count';
		badge.textContent = String( count );
		preview.appendChild( badge );
	}
	tile.appendChild( preview );

	const label = document.createElement( 'span' );
	label.className = 'os-overview-top-bar__tile-label';
	label.textContent = d.label;
	tile.appendChild( label );

	tile.addEventListener( 'click', ( e: MouseEvent ) => {
		e.preventDefault();
		e.stopPropagation();
		// A space typed into the label activates this <button> — the
		// browser synthesises a click. That is a default action, so no
		// `stopPropagation` upstream reaches it; the click has to be
		// refused here.
		if ( label.hasAttribute( 'contenteditable' ) ) {
			return;
		}
		exitOverviewToDesktop( mgr, d.id );
	} );

	// Wrapper, not tile: a control nested in the tile's <button> is
	// invalid markup and unclickable.
	const renameBtn = document.createElement( 'button' );
	renameBtn.type = 'button';
	renameBtn.className = 'os-overview-top-bar__tile-rename';
	// translators: %s is the desktop label
	renameBtn.setAttribute( 'aria-label', sprintf( __( 'Rename %s' ), d.label ) );
	renameBtn.innerHTML = osIconSvg( 'edit', { size: 14 } );
	renameBtn.addEventListener( 'click', ( e: MouseEvent ) => {
		e.preventDefault();
		e.stopPropagation();
		beginRename( mgr, label, d );
	} );

	// Close X — hidden via CSS when only one desktop exists, so users
	// can't soft-lock themselves out of the last one. We still render
	// the button (rather than omitting) so its presence/absence
	// doesn't reflow the tile.
	const closeBtn = document.createElement( 'button' );
	closeBtn.type = 'button';
	closeBtn.className = 'os-overview-top-bar__tile-close';
	// translators: %s is the desktop label
	closeBtn.setAttribute( 'aria-label', sprintf( __( 'Close %s' ), d.label ) );
	closeBtn.innerHTML = osIconSvg( 'close', { size: 16 } );
	closeBtn.addEventListener( 'click', ( e: MouseEvent ) => {
		// stopPropagation so the wrapper's layout doesn't trigger
		// anything, though the tile is a sibling, not a parent.
		e.preventDefault();
		e.stopPropagation();
		closeDesktop( mgr, d.id );
		refreshOverviewTopBar( mgr );
	} );

	wrapper.appendChild( tile );
	wrapper.appendChild( renameBtn );
	wrapper.appendChild( closeBtn );

	// The desk's actions, in a column BELOW the tile — not over its
	// preview, which is the tile's picture of the desk, and not in the
	// corners, which rename and close already have. Two rows:
	//
	// - **Restore** — put the desk back the way its workspace defines
	//   it. Always visible, but only on a desk with something to
	//   restore (see `workspaceCanRestore`): a button that visibly does
	//   nothing is worse than no button, so its absence is information.
	// - **Edit** — open the wizard on this desk. Revealed on hover and
	//   keyboard focus, like rename and close: it is a way to change
	//   the desk rather than a thing about it, and a row of Edit
	//   buttons at rest would make the bar read as a form.
	//
	// The column keeps its height whether or not Restore is present,
	// so every tile box stays on the same line.
	const actions = document.createElement( 'div' );
	actions.className = 'os-overview-top-bar__tile-actions';

	if ( workspaceCanRestore( d ) ) {
		const restoreBtn = document.createElement( 'button' );
		restoreBtn.type = 'button';
		restoreBtn.className =
			'os-overview-top-bar__tile-action os-overview-top-bar__tile-restore';
		// The visible word is short; the accessible name is the whole
		// sentence, because "Restore" alone could be read as the
		// session restore the shell does at boot.
		restoreBtn.setAttribute(
			'aria-label',
			// translators: %s is the workspace name.
			sprintf( __( 'Restore %s — reopen its windows, widgets and look' ), d.label ),
		);
		restoreBtn.title = restoreBtn.getAttribute( 'aria-label' ) ?? '';
		restoreBtn.innerHTML = `${ osIconSvg( 'windows', { size: 12 } ) }<span>${ __( 'Restore' ) }</span>`;
		restoreBtn.addEventListener( 'click', ( e: MouseEvent ) => {
			e.preventDefault();
			e.stopPropagation();
			if ( restoreWorkspace( d.id ) ) {
				// Land on the desk being restored — the windows are
				// opening there, and watching that happen from inside
				// overview would show a grid mid-rebuild.
				exitOverview( mgr );
			}
		} );
		actions.appendChild( restoreBtn );
	}

	// Edit is offered on every desk, plain Spaces included: for one of
	// those it is how it BECOMES a workspace. Only painted when a shell
	// has wired the wizard, so a bar built without one is unchanged.
	if ( isWorkspaceOverviewInstalled() ) {
		const editBtn = document.createElement( 'button' );
		editBtn.type = 'button';
		editBtn.className =
			'os-overview-top-bar__tile-action os-overview-top-bar__tile-edit';
		editBtn.setAttribute(
			'aria-label',
			// translators: %s is the desktop name.
			sprintf( __( 'Edit %s — its apps, widgets, look and windows' ), d.label ),
		);
		editBtn.title = editBtn.getAttribute( 'aria-label' ) ?? '';
		editBtn.innerHTML = `${ osIconSvg( 'settings', { size: 12 } ) }<span>${ __( 'Edit' ) }</span>`;
		editBtn.addEventListener( 'click', ( e: MouseEvent ) => {
			e.preventDefault();
			e.stopPropagation();
			// Land on the desk first: the wizard's "Arrange now" and
			// "Use the windows I have open now" act on the active desk,
			// and a modal is not something overview should stay open
			// under.
			exitOverviewToDesktop( mgr, d.id );
			editWorkspaceFromOverview( d.id );
		} );
		actions.appendChild( editBtn );
	}

	if ( actions.childElementCount > 0 ) {
		wrapper.appendChild( actions );
	}

	return wrapper;
}

/**
 * Edit a tile's label in place. Enter commits, Escape reverts, blur
 * commits.
 *
 * The label itself becomes editable rather than being covered by an
 * `<input>`: an overlay has to be re-measured onto the label's box and
 * font to keep the name from moving, and never matched exactly.
 */
function beginRename(
	mgr: WindowManager,
	label: HTMLElement,
	d: Desktop,
): void {
	if ( label.hasAttribute( 'contenteditable' ) ) {
		return;
	}
	// Attribute first: it is what the re-entry guard and `finish` read,
	// and the IDL setter below is a silent no-op on some engines.
	// `plaintext-only` keeps pasted markup out where supported.
	label.setAttribute( 'contenteditable', 'true' );
	try {
		label.contentEditable = 'plaintext-only';
	} catch {
		/* `true` stands. */
	}
	label.spellcheck = false;
	label.focus();

	const view = label.ownerDocument.defaultView;
	const range = label.ownerDocument.createRange();
	range.selectNodeContents( label );
	const selection = view?.getSelection();
	selection?.removeAllRanges();
	selection?.addRange( range );

	let settled = false;
	const finish = ( commit: boolean ): void => {
		if ( settled ) {
			return;
		}
		settled = true;
		label.removeAttribute( 'contenteditable' );
		if ( commit ) {
			renameDesktop( mgr, d.id, label.textContent ?? '' );
		}
		// Rebuild to restore the label from data, repaint the
		// aria-labels that embed the name, and drop these listeners
		// with the element. Not while closing: blur lands mid-teardown,
		// and replacing the bar there throws out of the exit finaliser.
		if ( mgr._overviewActive ) {
			refreshOverviewTopBar( mgr );
		}
	};

	label.addEventListener( 'keydown', ( e: KeyboardEvent ) => {
		// Overview reads Escape as "leave" and Enter as "commit the
		// cursor", both mid-edit. The shell's other bare-key shortcuts
		// listen in the capture phase, where this cannot reach them —
		// they guard themselves with `isTextEntryFocus`, which covers
		// contenteditable.
		e.stopPropagation();
		if ( e.key === 'Enter' || e.key === 'Escape' ) {
			e.preventDefault();
			finish( e.key === 'Enter' );
		}
	} );
	label.addEventListener( 'blur', () => finish( true ) );
	// Clicking to place the caret must not reach the tile beneath,
	// which switches desktops.
	label.addEventListener( 'click', ( e: MouseEvent ) => e.stopPropagation() );
}

/**
 * Re-render the top bar in place. Called after any operation that
 * mutates the desktop list (create, close) so the bar reflects the
 * new state without a full overview exit/re-enter cycle. Exported so
 * cross-module callers (e.g. `switchDesktop` in `desktops.ts`) can
 * refresh the `--active` tile highlight when the user navigates
 * between desktops mid-overview.
 */
export function refreshOverviewTopBar( mgr: WindowManager ): void {
	if ( ! mgr._overviewTopBar ) {
		return;
	}
	const fresh = buildOverviewTopBar( mgr );
	mgr._overviewTopBar.replaceWith( fresh );
	mgr._overviewTopBar = fresh;
}

/**
 * Switch to the given desktop, then exit overview without a specific
 * window selection. Used by top-bar tile clicks and the post-create
 * flow.
 */
function exitOverviewToDesktop( mgr: WindowManager, desktopId: string ): void {
	switchDesktop( mgr, desktopId );
	// Exit overview WITHOUT selecting a specific window — the active
	// desktop has its own focus state that the switch already
	// restored.
	exitOverview( mgr );
}

/**
 * Build the floating caption that sits above an overview thumbnail.
 * Carries the window's icon + title, plus a secondary line with the
 * external-tab count when the window has any — so users can tell at a
 * glance "oh this one has 3 sub-tabs open" without expanding a
 * thumbnail.
 *
 * Label sits OUTSIDE the window's transform (as a sibling in the
 * desktop area), so scaling the thumbnail has no effect on its text
 * size.
 */
export function createOverviewLabel( item: OverviewLayoutItem ): HTMLElement {
	const label = document.createElement( 'div' );
	label.className = 'os-overview-label';
	label.dataset.windowId = item.win.id;

	// Position: horizontally aligned with the thumbnail, sitting just
	// above its top edge. The 34 px offset = label height (28) + a
	// 6 px gap. Width matches the thumbnail so the label ellipsizes
	// rather than overflowing into a neighbor.
	const thumbW = item.win.element.offsetWidth * item.scale;
	label.style.left = `${ item.x }px`;
	label.style.top = `${ item.y - 34 }px`;
	label.style.width = `${ thumbW }px`;

	// Icon — mirrors the dashicon the window's title bar uses.
	// `config.icon` is already a Dashicons class string by
	// construction, but guard against unexpected values.
	const iconClass = item.win.config.icon || 'dashicons-admin-generic';
	const icon = document.createElement( 'span' );
	icon.className = `os-overview-label__icon dashicons ${ iconClass }`;
	icon.setAttribute( 'aria-hidden', 'true' );
	label.appendChild( icon );

	const title = document.createElement( 'span' );
	title.className = 'os-overview-label__title';
	title.textContent = item.win.config.title;
	label.appendChild( title );

	// Secondary: external-tab count. Only appended when > 0 so we
	// don't waste visual weight on the common "no extras" case.
	const tabCount = item.win.getExternalTabCount();
	if ( tabCount > 0 ) {
		const meta = document.createElement( 'span' );
		meta.className = 'os-overview-label__meta';
		meta.textContent = sprintf(
			// translators: %d is the number of external sub-tabs open on this window.
			_n( '· %d open tab', '· %d open tabs', tabCount ),
			tabCount,
		);
		label.appendChild( meta );
	}

	return label;
}

/**
 * Exit overview mode. When `selected` is given and `maximize` is
 * true, the clicked window animates directly from its grid thumbnail
 * position to maximized bounds — one smooth pass, no back-to-original-
 * then-forward-to-maximized round trip.
 */
export function exitOverview(
	mgr: WindowManager,
	selected?: Window,
	maximize = false,
): void {
	if ( ! mgr._overviewActive ) {
		return;
	}
	mgr._overviewActive = false;
	// Drop the keyboard cursor's "+ focused" state so the next overview
	// session starts with the cursor on the active desktop, not on
	// whatever tile the previous session left it on.
	mgr._overviewAddTileFocused = false;

	doAction( HOOKS.OVERVIEW_EXITING, {
		windowId: selected ? selected.id : undefined,
		reason: selected ? 'select' : 'cancel',
	} );
	// Must fire AFTER the flag drops: an exit via desktop switch has
	// already refreshed the dock from `switchDesktop`, while overview
	// was still active, leaving the dot lit on a closed overview.
	doAction( HOOKS.DOCK_REFRESH_ACTIVE, {} );

	// Remove area + shell classes AT T=0 so the backdrop fades and
	// the dock slides back in IN PARALLEL with the windows animating
	// home. Previously these were deferred to the end of the window
	// animation — producing a visible two-phase unwind (windows
	// first, then dock) that felt sequential. The only class we
	// DON'T remove yet is `os-window--overview` on each
	// window: it carries `transform-origin: top left`, needed for
	// the in-flight transform transition. Yanking it here would
	// shift the origin to center mid-animation and wobble the path.
	mgr._desktop.classList.remove( 'os-area--overview' );
	const shell = document.getElementById( 'os-shell' );
	shell?.classList.remove( 'os-shell--overview' );

	for ( const id of OVERVIEW_INERT_ELEMENTS ) {
		const el = document.getElementById( id );
		if ( el ) {
			( el as HTMLElement & { inert: boolean } ).inert = false;
		}
	}
	inertWpBodyContentChildren( false );
	inertWindowChildren( mgr, false );

	// Unselected windows: transform → '' (snaps back to their
	// pre-overview inline geometry). Selected window (if any):
	// transform is cleared the same way, AND focused to top of stack.
	for ( const [ id, snap ] of mgr._overviewSnapshot ) {
		const w = mgr.getById( id );
		if ( ! w ) {
			continue;
		}
		w.element.style.transform = snap.transform;
	}
	if ( selected ) {
		// Restore minimized windows before focusing so the user lands
		// on a visible window, not an invisible-but-focused one.
		if ( selected.state === 'minimized' ) {
			restoreOverviewFullscreenState( selected );
			selected.restore();
		}
		// Focus first so z-index and focused-class are right from the
		// moment the animation starts — no pop-to-top late in the
		// transition.
		mgr.focus( selected );
		if ( maximize ) {
			selected.maximize();
		}
	}

	// Remove overview class immediately for windows that are STILL minimized
	// (unselected ones). This strips the opacity override and transform-origin,
	// allowing them to smoothly fade out and shrink into their minimized state
	// during the 280ms transition, instead of staying visible and snapping away.
	for ( const w of mgr._stack ) {
		if ( w.state === 'minimized' ) {
			w.element.classList.remove( 'os-window--overview' );
		}
	}

	// Start labels fading immediately — they overshoot the area when
	// a selected window focuses, and we don't want them lingering
	// over it during the 300ms transition. Opacity transition is CSS-side
	// (see `.os-overview-label--out`).
	for ( const label of mgr._overviewLabels.values() ) {
		label.classList.add( 'os-overview-label--out' );
	}

	// Top bar fades out in parallel with the windows. Removed fully
	// when the animation settles (in the setTimeout below).
	if ( mgr._overviewTopBar ) {
		mgr._overviewTopBar.classList.add(
			'os-overview-top-bar--out',
		);
	}

	// After the animation completes, strip the per-window overview
	// class (kept in place through the transition for the
	// transform-origin reason noted above) and the labels. Handle is
	// tracked so `destroy()` can cancel it if the manager is
	// discarded before it fires.
	const ANIMATION_MS = 280;
	mgr._overviewExitFinalizer = () => {
		for ( const w of mgr._stack ) {
			w.element.classList.remove( 'os-window--overview' );
			restoreWindowAfterOverviewLayout(
				w,
				w.config.desktopId === mgr._activeDesktopId,
			);
		}
		for ( const label of mgr._overviewLabels.values() ) {
			label.remove();
		}
		mgr._overviewLabels.clear();
		mgr._overviewSnapshot.clear();
		if ( mgr._overviewTopBar ) {
			mgr._overviewTopBar.remove();
			mgr._overviewTopBar = null;
		}
		// Click blocker lifts LAST, on the same tick the overview
		// officially ends. By this point the browser-synthesized
		// click that followed the user's final pointerup has long
		// fired and been swallowed — releasing earlier would let
		// that click through to "minimize all".
		if ( mgr._overviewClickBlocker ) {
			mgr._desktop.removeEventListener(
				'click',
				mgr._overviewClickBlocker,
				true,
			);
			mgr._overviewClickBlocker = null;
		}
		doAction( HOOKS.OVERVIEW_EXITED, {
			windowId: selected ? selected.id : undefined,
			reason: selected ? 'select' : 'cancel',
		} );
	};
	mgr._overviewExitTimeoutId = window.setTimeout(
		() => flushPendingOverviewExit( mgr ),
		ANIMATION_MS,
	) as unknown as number;

	if ( mgr._overviewPointerDownHandler ) {
		mgr._desktop.removeEventListener(
			'pointerdown',
			mgr._overviewPointerDownHandler,
			true,
		);
		mgr._overviewPointerDownHandler = null;
	}
	if ( mgr._overviewPointerUpHandler ) {
		mgr._desktop.removeEventListener(
			'pointerup',
			mgr._overviewPointerUpHandler,
			true,
		);
		mgr._overviewPointerUpHandler = null;
	}
	mgr._overviewPressTarget = null;
	if ( mgr._overviewKeyHandler ) {
		document.removeEventListener( 'keydown', mgr._overviewKeyHandler );
		mgr._overviewKeyHandler = null;
	}
	if ( mgr._overviewMouseHandler ) {
		mgr._desktop.removeEventListener(
			'mouseover',
			mgr._overviewMouseHandler,
		);
		mgr._overviewMouseHandler = null;
	}
	// Fire a final unhover if pointer was over a thumbnail when exit
	// kicked in — paired-hover guarantee for plugin authors doing
	// accounting.
	if ( mgr._lastOverviewHoverId ) {
		doAction( HOOKS.OVERVIEW_WINDOW_UNHOVER, {
			windowId: mgr._lastOverviewHoverId,
		} );
		mgr._lastOverviewHoverId = null;
	}
}
