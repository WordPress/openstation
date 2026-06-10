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
 * @since 0.5.1
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
 * keystrokes as text — INPUT (text-ish types), TEXTAREA, anything
 * with `contenteditable`, or a nested IFRAME (focus is inside some
 * child frame that owns its own keyboard handling; we must not
 * steal keystrokes from it).
 *
 * The IFRAME case is what catches Gutenberg: the block canvas is a
 * nested iframe, and Gutenberg re-dispatches a cloned keydown up to
 * the outer document for its shortcut system. Without this branch
 * we'd cycle windows while the user is typing into a block.
 *
 * SELECT, checkbox / radio / button INPUTs are treated as non-text:
 * they don't accept character input, so stealing `` ` `` from them
 * is fine.
 *
 * Shadow-DOM gotcha: when focus lands on an input INSIDE an open
 * shadow root (every `<wpd-*>` component does this — `Component`
 * defaults `static shadow = true`), `doc.activeElement` returns the
 * host element, not the inner input. A naïve `instanceof
 * HTMLInputElement` check would miss it and the gate would say "not
 * text" while the user is typing — bare arrow / `` ` `` then fires.
 * We walk through each open shadow root's own `activeElement` until
 * we land on the real focused leaf. Closed shadow roots stop the
 * loop on their own (their `activeElement` is `null` from outside).
 */
export function isTextEntryFocus( doc: Document ): boolean {
	let el: Element | null = doc.activeElement;
	while ( el && el.shadowRoot && el.shadowRoot.activeElement ) {
		el = el.shadowRoot.activeElement;
	}
	if ( ! el ) {
		return false;
	}
	if ( el instanceof HTMLIFrameElement ) {
		return true;
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
	if ( el instanceof HTMLElement && el.isContentEditable === true ) {
		return true;
	}
	// Fallback for environments (jsdom) that don't implement
	// `HTMLElement.isContentEditable` — check the attribute directly.
	const ce = el.getAttribute( 'contenteditable' );
	return ce !== null && ce !== 'false';
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
 * `desktop-mode-window-switch` so presses inside a wp-admin iframe reach
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
		if ( ! data || data.type !== 'desktop-mode-window-switch' ) {
			return;
		}
		cycleFocus( mgr, data.direction === 'prev' ? 'prev' : 'next' );
	} );
}
