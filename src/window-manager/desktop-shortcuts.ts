/**
 * OpenStation — Virtual-desktop arrow-key shortcuts.
 *
 * Bare arrow keys drive the four most common desktop-shell actions
 * when focus is outside a text-entry surface:
 *
 *   - ArrowLeft  → previous virtual desktop (no-op with one desktop or
 *                  when already on the leftmost).
 *   - ArrowRight → next virtual desktop (symmetrical no-op rules).
 *   - ArrowUp    → toggle the Overview grid (mirrors the
 *                  Arrange → Overview button).
 *   - ArrowDown  → toggle Show Desktop (mirrors the right-click
 *                  Show desktop action / wallpaper-click gesture).
 *
 * Bare arrows mean we lean hard on {@link isTextEntryFocus} to avoid
 * stealing keystrokes from inputs, textareas, contenteditable, and
 * nested iframes (where the inner document owns the keys — typing in
 * Gutenberg's block canvas, for instance). Same gate as the window
 * switcher in `switcher.ts`. We deliberately do NOT install an iframe
 * forwarder for these keys: arrow keys inside admin pages routinely
 * mean "navigate this list", "move caret", etc., and forwarding them
 * would surprise users.
 *
 * `preventDefault` only fires when we actually acted on the key —
 * otherwise plain ArrowDown on an empty desktop area would still
 * preventDefault a page-scroll the user expected.
 */

import { isTextEntryFocus } from './switcher';
import { refreshOverviewTopBar } from './overview';
import type { WindowManager } from './index';

export type DesktopDirection = 'prev' | 'next';

/**
 * Switch to the desktop immediately before or after the active one in
 * the registry order. Wraps at the ends — past the last desktop loops
 * back to the first and vice versa — so a user pressing ArrowRight
 * repeatedly always cycles through every desktop.
 *
 * Outside overview, this is the only navigation primitive. Inside
 * overview, callers route through {@link cycleOverviewCursor} instead
 * so the trailing "+" tile participates in the cycle.
 *
 * Returns `true` when a switch actually happened so the keydown
 * handler knows to `preventDefault`.
 */
export function switchToAdjacentDesktop(
	mgr: WindowManager,
	direction: DesktopDirection,
): boolean {
	const desktops = mgr.getDesktops();
	if ( desktops.length < 2 ) {
		return false;
	}
	const activeId = mgr.getActiveDesktopId();
	const idx = desktops.findIndex( ( d ) => d.id === activeId );
	if ( idx === -1 ) {
		return false;
	}
	const step = direction === 'next' ? 1 : -1;
	// `+ length` before modulo handles the negative step at idx 0.
	const targetIdx = ( idx + step + desktops.length ) % desktops.length;
	if ( targetIdx === idx ) {
		return false;
	}
	mgr.switchDesktop( desktops[ targetIdx ].id, { direction } );
	return true;
}

/**
 * Arrow navigation INSIDE overview. Cycle order is `[ ...desktops, + ]`
 * — pressing past the last desktop parks the cursor on the trailing
 * "+" tile (highlighted via `--cursor`); pressing once more wraps back
 * to the first desktop.
 *
 * Cursor-on-desktop also drives the active desktop (matches the
 * pre-existing "arrow switches active desktop in overview" behaviour
 * so the grid + top bar repaint as the cursor moves). Cursor-on-add
 * leaves the active desktop alone — there's nothing to switch to yet.
 * Pressing Enter while parked on "+" creates the desktop (see
 * `commitAddTile`).
 *
 * Returns `true` whenever the cycle moved, so the caller
 * `preventDefault`s only on real navigation.
 */
export function cycleOverviewCursor(
	mgr: WindowManager,
	direction: DesktopDirection,
): boolean {
	if ( ! mgr._overviewActive ) {
		return false;
	}
	const desktops = mgr.getDesktops();
	// Single desktop + "+" still produces a 2-element cycle, so unlike
	// `switchToAdjacentDesktop` we never bail on length.
	const cycleLength = desktops.length + 1;
	const ADD_INDEX = desktops.length;
	const currentIdx = mgr._overviewAddTileFocused
		? ADD_INDEX
		: desktops.findIndex( ( d ) => d.id === mgr.getActiveDesktopId() );
	if ( currentIdx === -1 ) {
		return false;
	}
	const step = direction === 'next' ? 1 : -1;
	const targetIdx = ( currentIdx + step + cycleLength ) % cycleLength;
	if ( targetIdx === currentIdx ) {
		return false;
	}

	if ( targetIdx === ADD_INDEX ) {
		// Move cursor onto the "+" tile. Don't touch active desktop —
		// there's no desktop to switch to. Just repaint the top bar so
		// the cursor highlight follows.
		mgr._overviewAddTileFocused = true;
		refreshOverviewTopBar( mgr );
		return true;
	}

	// Moving onto a real desktop tile — clear add-tile focus and route
	// through the standard switch so the grid + top-bar update via the
	// existing overview-aware path in `switchDesktop`.
	mgr._overviewAddTileFocused = false;
	mgr.switchDesktop( desktops[ targetIdx ].id, { direction } );
	return true;
}

/**
 * Toggle Overview — enter if not active, exit (without selecting a
 * window) if currently in overview. Always returns `true` since the
 * keypress is intentionally consumed in both directions.
 */
export function toggleOverview( mgr: WindowManager ): boolean {
	if ( mgr._overviewActive ) {
		mgr.exitOverview();
	} else {
		mgr.enterOverview();
	}
	return true;
}

/**
 * Toggle Show Desktop. Returns `false` when there are no live windows
 * (so ArrowDown doesn't preventDefault on a fresh, empty desktop) or
 * when overview is active — minimizing every window while the user is
 * looking at the overview grid would clash with the in-flight thumbnail
 * transforms and surprise the user mid-navigation. The caller routes
 * ArrowDown to {@link exitOverviewIfActive} first when in overview.
 */
export function toggleShowDesktop( mgr: WindowManager ): boolean {
	if ( mgr._overviewActive ) {
		return false;
	}
	if ( mgr.getAll().length === 0 ) {
		return false;
	}
	mgr.toggleShowDesktop();
	return true;
}

/**
 * Exit overview onto the currently active desktop without selecting a
 * specific window. Used by ArrowUp / ArrowDown when overview is active
 * so those keys feel like "get me out of overview" rather than firing
 * a second action on top of an already-mounted overview.
 *
 * Returns `true` when an exit actually happened (callers
 * `preventDefault` on a real action only).
 */
export function exitOverviewIfActive( mgr: WindowManager ): boolean {
	if ( ! mgr._overviewActive ) {
		return false;
	}
	mgr.exitOverview();
	return true;
}

/**
 * True when the shell is in the canonical "Show Desktop" state — at
 * least one window exists and every live window is minimized.
 * Mirrors the global check inside {@link WindowManager.toggleShowDesktop},
 * so the heuristic matches whatever flipped the user into the state
 * in the first place.
 */
function isShowDesktopActive( mgr: WindowManager ): boolean {
	const all = mgr.getAll();
	if ( all.length === 0 ) {
		return false;
	}
	return all.every( ( w ) => w.state === 'minimized' );
}

/**
 * Restore every window when the shell is in Show Desktop state. Used
 * by ArrowUp so the press feels like "bring my windows back" rather
 * than escalating into Overview — matching the symmetrical
 * ArrowDown-then-ArrowUp expectation. No-op (returns `false`) outside
 * Show Desktop so the caller can fall through to the next action.
 */
export function exitShowDesktopIfActive( mgr: WindowManager ): boolean {
	if ( ! isShowDesktopActive( mgr ) ) {
		return false;
	}
	// `toggleShowDesktop` already special-cases "every window minimized"
	// → restore all. Calling it is the contract-preserving way to exit
	// rather than duplicating the iteration here.
	mgr.toggleShowDesktop();
	return true;
}

// ---------------------------------------------------------------------------
// Global shortcut installer
// ---------------------------------------------------------------------------

let installed = false;

/**
 * Install the arrow-key desktop shortcuts. Idempotent — calling more
 * than once is a no-op so HMR / re-init paths don't stack listeners.
 */
export function installDesktopArrowShortcuts( mgr: WindowManager ): void {
	if ( installed ) {
		return;
	}
	installed = true;

	document.addEventListener(
		'keydown',
		( e: KeyboardEvent ) => {
			// Modified arrows are reserved — Shift-arrow extends
			// selections, Cmd/Ctrl/Alt-arrow are word-jumps or browser /
			// OS shortcuts. Bare arrow only.
			if ( e.ctrlKey || e.metaKey || e.altKey || e.shiftKey ) {
				return;
			}
			if (
				e.code !== 'ArrowLeft' &&
				e.code !== 'ArrowRight' &&
				e.code !== 'ArrowUp' &&
				e.code !== 'ArrowDown'
			) {
				return;
			}
			if ( isTextEntryFocus( document ) ) {
				return;
			}

			let handled = false;
			switch ( e.code ) {
				case 'ArrowLeft':
					handled = mgr._overviewActive
						? cycleOverviewCursor( mgr, 'prev' )
						: switchToAdjacentDesktop( mgr, 'prev' );
					break;
				case 'ArrowRight':
					handled = mgr._overviewActive
						? cycleOverviewCursor( mgr, 'next' )
						: switchToAdjacentDesktop( mgr, 'next' );
					break;
				case 'ArrowUp':
					// Priority chain:
					//   1. Overview active → exit (mirrors Enter-to-commit).
					//   2. Show Desktop active → restore windows (the
					//      symmetric undo for the ArrowDown gesture; the
					//      user expects "↓ hides, ↑ brings back" before
					//      they expect "↑ opens Overview").
					//   3. Default → enter Overview.
					handled =
						exitOverviewIfActive( mgr ) ||
						exitShowDesktopIfActive( mgr ) ||
						toggleOverview( mgr );
					break;
				case 'ArrowDown':
					// In overview, ArrowDown exits without minimizing —
					// the regular Show Desktop toggle is intentionally
					// suppressed (see `toggleShowDesktop`).
					handled = exitOverviewIfActive( mgr ) || toggleShowDesktop( mgr );
					break;
			}

			if ( handled ) {
				e.preventDefault();
			}
		},
		true,
	);
}
