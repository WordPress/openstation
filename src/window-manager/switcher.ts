/**
 * Desktop Mode — Window switcher shortcut.
 *
 * Cycles focus between open windows on the active desktop via bare
 * `` ` `` (next) and `Shift+` ` ` (previous), on both macOS and
 * Windows/Linux. Uses no modifier because Chrome and macOS between
 * them swallow almost every Cmd/Ctrl-based window-management combo
 * (`Cmd+` ` ` is OS-level, `Ctrl+Tab` collides with tab-cycling, etc.).
 *
 * Because bare `` ` `` is a printable character, the handler skips the
 * cycle when focus is inside a text-entry element (INPUT, TEXTAREA,
 * contenteditable) — typing a backtick into a field still produces a
 * backtick. Presses landing on the desktop, dock, window chrome, or
 * anywhere else trigger the switch.
 *
 * Mirrors the shell-wide palette shortcut pattern in
 * `src/palette-registry.ts`: a capture-phase listener on `document`
 * handles presses that land on the shell, and a `postMessage` bridge
 * from the chromeless iframe (`includes/render.php`) covers presses
 * that land inside a wp-admin iframe (where the iframe applies its
 * own text-entry gate before forwarding).
 *
 * @since 0.16.0
 */

import type { Window } from '../window';
import type { WindowManager } from './index';

export type CycleDirection = 'next' | 'prev';

/**
 * Windows eligible for focus cycling, ordered by DOM insertion —
 * a stable order independent of z-stack / MRU, so repeated presses
 * advance through all windows instead of ping-ponging between the
 * top two.
 *
 * Filters to the active desktop only: windows parked on hidden
 * virtual desktops are `display: none` and would visually no-op.
 */
function cycleableWindows( mgr: WindowManager ): Window[] {
	const activeDesktopId = mgr.getActiveDesktopId();
	const domOrder = Array.from( mgr._desktop.children );
	return mgr
		.getAll()
		.filter( ( w ) => {
			const winDesktop = w.config.desktopId || activeDesktopId;
			return winDesktop === activeDesktopId;
		} )
		.sort(
			( a, b ) =>
				domOrder.indexOf( a.element ) - domOrder.indexOf( b.element ),
		);
}

/**
 * Focus the next (or previous) window on the active desktop,
 * wrapping at the ends. Minimized targets are restored on the way in,
 * matching what a user expects from a "next window" shortcut.
 *
 * No-op during overview mode — that UI owns keyboard focus and has
 * its own click/enter-to-select flow.
 */
export function cycleFocus( mgr: WindowManager, direction: CycleDirection ): void {
	if ( mgr._overviewActive ) {
		return;
	}
	const list = cycleableWindows( mgr );
	if ( list.length < 2 ) {
		return;
	}

	const focused = mgr.getFocused();
	const currentIdx = focused ? list.indexOf( focused ) : -1;
	const step = direction === 'next' ? 1 : -1;
	// `+ list.length` before modulo handles the negative case for 'prev'
	// when currentIdx is 0 (or -1 — fall through to last/first as a sensible
	// starting point when somehow nothing is focused).
	const nextIdx = ( currentIdx + step + list.length ) % list.length;
	const target = list[ nextIdx ];

	if ( target.state === 'minimized' ) {
		target.restore();
	} else {
		mgr.focus( target );
	}
}

// ---------------------------------------------------------------------------
// Global shortcut installer
// ---------------------------------------------------------------------------

let installed = false;

/**
 * True when the given document's focused element consumes bare
 * keystrokes as text — INPUT (text-ish types), TEXTAREA, or anything
 * with `contenteditable`. Caller uses this to skip the window-cycle
 * when the user is typing, so `` ` `` still reaches the field.
 *
 * We deliberately treat SELECT, checkbox / radio / button INPUTs as
 * non-text: they don't accept character input, so stealing `` ` `` from
 * them is fine.
 */
function isTextEntryFocus( doc: Document ): boolean {
	const el = doc.activeElement as HTMLElement | null;
	if ( ! el ) {
		return false;
	}
	if ( el instanceof HTMLTextAreaElement ) {
		return true;
	}
	if ( el instanceof HTMLInputElement ) {
		// Types that accept character input. Anything not in this set
		// (checkbox, radio, button, file, color, range, submit, reset,
		// image, hidden) can't show a backtick anyway.
		const textTypes = new Set( [
			'text',
			'search',
			'url',
			'email',
			'password',
			'tel',
			'number',
			'date',
			'datetime-local',
			'month',
			'week',
			'time',
		] );
		return textTypes.has( el.type );
	}
	return el.isContentEditable;
}

/**
 * Install the `` ` `` / `Shift+` ` ` window-switcher shortcut. Idempotent.
 *
 * Uses `e.code === 'Backquote'` for layout stability — on AZERTY or
 * other non-US layouts the backtick glyph lives on a different
 * physical key, but `code` doesn't move. Skips the cycle when focus
 * is in a text-entry element so typing `` ` `` into fields still works.
 *
 * The iframe forwarder lives in `includes/render.php`: it postMessages
 * `wp-desktop-window-switch` so presses inside a wp-admin iframe reach
 * this handler even though native keydown events don't cross iframe
 * boundaries. The iframe applies its own text-entry gate before
 * forwarding, so a backtick typed into the block editor or a plain
 * admin input still reaches that field unmodified.
 */
export function installWindowSwitcherShortcut( mgr: WindowManager ): void {
	if ( installed ) {
		return;
	}
	installed = true;

	document.addEventListener(
		'keydown',
		( e: KeyboardEvent ) => {
			if ( e.ctrlKey || e.metaKey || e.altKey ) {
				return;
			}
			if ( e.code !== 'Backquote' ) {
				return;
			}
			if ( isTextEntryFocus( document ) ) {
				return;
			}
			e.preventDefault();
			cycleFocus( mgr, e.shiftKey ? 'prev' : 'next' );
		},
		true,
	);

	const origin = window.location.origin;
	window.addEventListener( 'message', ( e: MessageEvent ) => {
		if ( e.origin !== origin ) {
			return;
		}
		const data = e.data as
			| { type?: string; direction?: CycleDirection }
			| null;
		if ( ! data || data.type !== 'wp-desktop-window-switch' ) {
			return;
		}
		cycleFocus( mgr, data.direction === 'prev' ? 'prev' : 'next' );
	} );
}
