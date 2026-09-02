/**
 * OpenStation — "Close all windows" shortcut.
 *
 * `⌥⌘W` on macOS, `Ctrl+Alt+W` everywhere else: the desktop's batch
 * close, on the chord the host OS already uses for it (Finder's
 * "Close All Windows" is Option-Command-W). `Cmd/Ctrl+Shift+W` — the
 * other obvious candidate — is the browser's own "close window" and
 * cannot be taken back from it, so the Alt variant is the one a page
 * can actually claim.
 *
 * The key is read off `e.code`, not `e.key`: Option+W on macOS types
 * `∑`, and on a non-US layout the W glyph moves. `code` doesn't.
 * `AltGraph` is the layout that has to be excluded rather than
 * followed: Windows and Linux report a physical AltGr press as
 * `ctrlKey` + `altKey`, so on a German, French, Polish, Spanish or
 * Nordic layout every AltGr-composed character would otherwise
 * satisfy this chord while the user is only typing.
 *
 * **It closes the ACTIVE desktop's windows, not every window
 * everywhere.** A desktop is the unit the user is looking at, and
 * with Workspaces landing it is a unit they switch between often; a
 * chord that reached across all of them would be a much bigger hammer
 * than the one being asked for. `closeAll()` itself is not
 * desktop-scoped, so the windows parked on other desktops are handed
 * to it as `exceptIds` — which also keeps them out of the
 * `os.windows.close-all` filter, where a plugin would otherwise be
 * asked to defend a window that was never in danger.
 *
 * Two things this module deliberately does NOT do:
 *
 *   - **Reimplement the close.** {@link WindowManager.closeAll} owns
 *     the hook chain (`os.windows.before-close-all`, the protection
 *     filter, `os.windows.after-close-all`) and the per-window
 *     `beforeunload` round trip that lets an iframe holding unsaved
 *     changes raise its own prompt. This is a caller.
 *   - **Gate on text-entry focus.** The chord carries Ctrl/Cmd *and*
 *     Alt, so it types nothing into a field — unlike the bare
 *     backtick of the window switcher, which has to yield (see
 *     `switcher.ts`). "Close everything" is also exactly the kind of
 *     thing a user asks for from inside the window they want gone.
 *
 * Because native keydown doesn't cross an iframe boundary, and every
 * admin window IS an iframe, the chromeless bridge forwards the same
 * chord up as {@link CLOSE_ALL_MESSAGE} — same shape as the Cmd+K and
 * backtick forwarders next to it in `src/chromeless-bridge.js`.
 *
 * The asking is a preference. The dialog carries a "Don't ask again"
 * checkbox, and ticking it writes `confirmCloseAllWindows: false`
 * through the {@link CloseAllPrefs} the shell hands in — user meta,
 * so the choice follows the user to their other browsers. Preferences
 * → Windows turns it back on, which is the half that makes the
 * checkbox a preference rather than a one-way door.
 */

import { __, _n, sprintf } from '../i18n';
import { osConfirm, type OsConfirmOptions } from '../os-confirm';
import { showToast } from '../toast';
import type { Window } from '../window';
import type { WindowManager } from './index';

/** postMessage type the chromeless bridge forwards the chord as. */
export const CLOSE_ALL_MESSAGE = 'os-window-close-all';

/**
 * True for `Ctrl/Cmd + Alt + W`. Shift is excluded rather than
 * ignored: `Cmd+Shift+Alt+W` belongs to whatever else claims it, and a
 * batch close is not something to fire on a near miss.
 *
 * The `AltGraph` check comes first because AltGr is not a near miss —
 * it is an exact match. Browsers on Windows and Linux synthesise
 * `ctrlKey: true, altKey: true` for it, so without this line typing
 * an AltGr-composed character on a non-US layout would close the
 * user's desktop. `getModifierState` is what tells the two apart.
 */
export function isCloseAllChord( e: KeyboardEvent ): boolean {
	if ( e.code !== 'KeyW' ) {
		return false;
	}
	if ( e.getModifierState?.( 'AltGraph' ) ) {
		return false;
	}
	if ( ! ( e.ctrlKey || e.metaKey ) ) {
		return false;
	}
	return e.altKey && ! e.shiftKey;
}

/**
 * How the shortcut reads and writes the "ask first" preference.
 *
 * An interface rather than an import of the settings singleton:
 * `OsSettings` is constructed inside `desktop.ts`'s `init()` and is
 * not reachable as a module-level instance, and a window-manager
 * module has no business knowing the shape of user meta anyway.
 * Omitted entirely — as tests and any embedder that has no settings
 * store do — the shortcut always asks.
 */
export interface CloseAllPrefs {
	/** Whether to raise the confirmation at all. */
	shouldAsk(): boolean;
	/** Persist the user's answer to "Don't ask again". */
	setAsk( ask: boolean ): void;
}

/**
 * True while a confirm dialog raised by this module is on screen.
 *
 * The chord is held down as easily as it is tapped, and every repeat
 * would otherwise stack another dialog on top of the one already
 * asking the question.
 */
let confirming = false;

/**
 * Every window living on the desktop the user is currently looking
 * at, minimized ones included — the set the chord acts on.
 *
 * A window carries no `desktopId` until it has been moved, so an
 * absent one reads as "wherever we are", the same rule
 * {@link WindowManager.minimizeAll} follows.
 */
export function windowsOnActiveDesktop( mgr: WindowManager ): Window[] {
	const activeId = mgr.getActiveDesktopId();
	return mgr
		.getAll()
		.filter( ( w ) => ( w.config.desktopId || activeId ) === activeId );
}

/**
 * Ask, then close every window on the ACTIVE desktop.
 *
 * Returns how many windows actually went — which is not the same as
 * how many were asked to go, and is why the number is measured rather
 * than predicted. See {@link countClosed}.
 *
 * The confirmation is not redundant with the per-window unsaved-changes
 * prompt: that one only fires for a page that actually holds unsaved
 * state, and says nothing about the other eleven windows the chord is
 * about to take with it.
 */
export async function closeAllWindows(
	mgr: WindowManager,
	prefs?: CloseAllPrefs,
): Promise< number > {
	if ( confirming ) {
		return 0;
	}
	const open = windowsOnActiveDesktop( mgr );
	if ( open.length === 0 ) {
		return 0;
	}

	if ( prefs && ! prefs.shouldAsk() ) {
		return runClose( mgr );
	}

	// No checkbox where there is nowhere to write the answer: an
	// opt-out that silently forgets itself is worse than never
	// offering one.
	const rememberOpts: Pick< OsConfirmOptions, 'rememberLabel' | 'onRemember' > =
		prefs
			? {
				rememberLabel: __( "Don't ask again" ),
				onRemember: ( dontAsk: boolean ): void => {
					if ( dontAsk ) {
						prefs.setAsk( false );
					}
				},
			}
			: {};

	confirming = true;
	let confirmed = false;
	try {
		confirmed = await osConfirm( {
			title: __( 'Close all windows?' ),
			message: sprintf(
				/* translators: %d: number of open windows on this desktop. */
				_n(
					'%d open window on this desktop will be closed.',
					'%d open windows on this desktop will be closed.',
					open.length,
				),
				open.length,
			),
			confirmLabel: __( 'Close all' ),
			danger: true,
			...rememberOpts,
		} );
	} finally {
		confirming = false;
	}
	if ( ! confirmed ) {
		return 0;
	}
	return runClose( mgr );
}

/**
 * How long to wait for the deferred closes before counting what went.
 *
 * `Window.close()` gives an iframe 500 ms to answer its
 * unsaved-changes query before forcing the close through, so this sits
 * just past that: by the deadline, every window that was going to
 * close without asking the user has closed.
 */
const CLOSE_SETTLE_TIMEOUT_MS = 700;

/** How often to look, while waiting for that. */
const CLOSE_SETTLE_POLL_MS = 50;

/**
 * How many of `targets` are actually gone.
 *
 * `closeAll()` returns how many closes it *dispatched*, and a
 * dispatched close is not a closed window: a non-native window with a
 * live bridge defers behind its unsaved-changes query, and a page that
 * objects raises a prompt the user can answer with "keep it". Saying
 * "Closed 7 windows" over a screen where two of them are still sitting
 * there is the bug this avoids.
 *
 * So the count is measured, not predicted. Polling resolves the
 * instant the set empties — the same tick, for the windows that close
 * synchronously — and otherwise gives up at
 * {@link CLOSE_SETTLE_TIMEOUT_MS}. A window still open then is either
 * refused or waiting on the user's own answer; it is left out of the
 * count and closes on its own terms afterwards, which the user is
 * watching happen anyway.
 */
function countClosed( mgr: WindowManager, targets: string[] ): Promise< number > {
	const gone = (): number =>
		targets.filter( ( id ) => ! mgr.getById( id ) ).length;
	return new Promise( ( resolve ) => {
		const deadline = Date.now() + CLOSE_SETTLE_TIMEOUT_MS;
		const check = (): void => {
			const n = gone();
			if ( n === targets.length || Date.now() >= deadline ) {
				resolve( n );
				return;
			}
			setTimeout( check, CLOSE_SETTLE_POLL_MS );
		};
		check();
	} );
}

/** The close itself, once it is going to happen. */
async function runClose( mgr: WindowManager ): Promise< number > {
	// Overview frames the windows it is about to lose. Leaving it
	// first means the grid animates out over a desktop that still has
	// its thumbnails, rather than emptying under the user's cursor.
	if ( mgr._overviewActive ) {
		mgr.exitOverview();
	}

	const targets = windowsOnActiveDesktop( mgr ).map( ( w ) => w.id );
	// `closeAll()` is not desktop-scoped, so the other desktops' windows
	// are excluded by id. `exceptIds` skips them before the
	// `os.windows.close-all` filter runs, which is the right door: a
	// plugin protecting a window should be asked about the ones that
	// are actually in danger.
	const elsewhere = mgr
		.getAll()
		.map( ( w ) => w.id )
		.filter( ( id ) => ! targets.includes( id ) );

	mgr.closeAll( { exceptIds: elsewhere } );

	const closed = await countClosed( mgr, targets );
	if ( closed > 0 ) {
		showToast( {
			message: sprintf(
				/* translators: %d: number of windows closed. */
				_n( 'Closed %d window.', 'Closed %d windows.', closed ),
				closed,
			),
		} );
	}
	return closed;
}

let installed = false;

/**
 * Install the close-all chord. Idempotent — calling more than once is
 * a no-op so HMR / re-init paths don't stack listeners, matching
 * `installWindowSwitcherShortcut` and `installDesktopArrowShortcuts`.
 */
export function installCloseAllShortcut(
	mgr: WindowManager,
	prefs?: CloseAllPrefs,
): void {
	if ( installed ) {
		return;
	}
	installed = true;

	document.addEventListener(
		'keydown',
		( e: KeyboardEvent ) => {
			if ( ! isCloseAllChord( e ) ) {
				return;
			}
			e.preventDefault();
			e.stopImmediatePropagation();
			void closeAllWindows( mgr, prefs );
		},
		true,
	);

	const origin = window.location.origin;
	window.addEventListener( 'message', ( e: MessageEvent ) => {
		if ( e.origin !== origin ) {
			return;
		}
		const data = e.data as { type?: string } | null;
		if ( ! data || data.type !== CLOSE_ALL_MESSAGE ) {
			return;
		}
		void closeAllWindows( mgr, prefs );
	} );
}
