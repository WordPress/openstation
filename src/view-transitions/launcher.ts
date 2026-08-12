/**
 * OpenStation — Launcher detection.
 *
 * Answers one question: *what did the user press to make this happen?*
 *
 * The answer is what a window morphs out of when it opens. A window
 * that grows from the dock tile you clicked reads as caused by the
 * click; the same window fading in at the centre of the screen reads as
 * something the computer decided to do. The difference is entirely in
 * knowing which element to pair with.
 *
 * ## Why this is inferred rather than passed
 *
 * The obvious design is a `sourceElement` on `WindowConfig`, threaded
 * down from each caller. It was rejected for two reasons, and the
 * second is the deciding one:
 *
 * 1. Every existing launcher would need touching — the dock, wallpaper
 *    icons, the taskbar, the command palette, file tiles, the plugins
 *    window, session restore, `wp.os.openWindow()`.
 * 2. **Every FUTURE launcher would need to know to pass it.** A plugin
 *    that adds a button calling `wp.os.openWindow()` would silently get
 *    the un-morphed version, and would have no reason to suspect there
 *    was an argument it was missing.
 *
 * Inferring from the last pointer press inverts that: the animation
 * works by default and a plugin opts OUT (or refines) rather than in.
 * The one real cost is that a keyboard-driven or programmatic open has
 * no launcher — which is correct, because there was no click for the
 * window to have come from.
 */

import { applyFilters, HOOKS } from '../hooks';
import { getLastPointerElement } from './play';

/**
 * Selectors for the things a window can be launched FROM, most specific
 * first — the list is ordered, and the first match up the ancestor
 * chain wins.
 *
 * The order matters where launchers nest. A dock tile contains
 * `.os-dock__item-primary`; matching the button rather than the tile
 * gives a morph that starts from the icon glyph alone, which is both
 * smaller and better-looking than one starting from the whole tile
 * including its label and running indicator. So the inner element is
 * listed first.
 *
 * `[data-os-vt-launcher]` is the opt-in for anything not in this list.
 * A plugin puts it on its own button and gets the same morph as a
 * built-in launcher, with no JS at all. It also covers every `<os-*>`
 * web component for free: events crossing a shadow boundary are
 * retargeted to the host, so the host element is what arrives here, and
 * the attribute goes on the host.
 *
 * `.os-window` is last and is a genuine fallback rather than a
 * launcher: it catches a window opened by clicking a link inside
 * another window, where morphing out of the source window is a better
 * answer than morphing out of nothing.
 */
const LAUNCHER_SELECTORS = [
	'[data-os-vt-launcher]',
	'.os-dock__item-primary',
	'.os-dock__item',
	'.os-icon__image',
	'.os-icon',
	'.os-file-tile',
	'.os-taskbar__item',
	'.os-dock-peek__card',
	'.os-window',
] as const;

/**
 * Whether the shell is still painting its first frame.
 *
 * Session restore reopens every window the user had last time, through
 * the same funnel a click goes through — so without this gate, a
 * refresh would play one window transition per restored window, each
 * skipping the one before it, over a desktop area that PHP has
 * deliberately made invisible until hydration settles. The result is a
 * stutter at the exact moment the shell is trying to appear composed.
 *
 * `os-area--booting` is added by `includes/render/shell.php` before any
 * JS runs and removed once the root files layer hydrates, which makes
 * it the one flag that is already true at the moment restore begins.
 */
export function isShellBooting(): boolean {
	return !! document
		.getElementById( 'os-area' )
		?.classList.contains( 'os-area--booting' );
}

/**
 * The element a window opened by the current interaction should appear
 * to grow out of, or `null` when there is nothing sensible to use.
 *
 * Returns `null` — and callers then play an un-paired transition — for
 * every case where a morph would be a lie: a keyboard shortcut, session
 * restore at boot, a plugin calling `openWindow()` from a timer, or a
 * click on a launcher that has since been re-rendered away.
 *
 * Filterable via `os.view-transition-launcher`, which receives the
 * resolved element (or `null`) and the element actually pressed. Use it
 * to redirect a morph — a "recently opened" list might prefer to morph
 * from the app's dock tile rather than from the list row.
 *
 * @param excluded Element to refuse, if the resolved launcher turns out
 *                 to be it. Used by the window-lifecycle callers to
 *                 avoid morphing a window out of ITSELF when the click
 *                 that triggered the change was inside that window (a
 *                 close button, a title-bar double-click).
 * @return         The launcher element, or `null`.
 */
export function findLaunchSource( excluded?: Element | null ): Element | null {
	const pressed = getLastPointerElement();
	let resolved: Element | null = null;
	if ( pressed ) {
		for ( const selector of LAUNCHER_SELECTORS ) {
			const match = pressed.closest( selector );
			if ( match ) {
				resolved = match;
				break;
			}
		}
	}
	if ( excluded && resolved && ( resolved === excluded || excluded.contains( resolved ) ) ) {
		resolved = null;
	}
	return applyFilters< Element | null, [ Element | null ] >(
		HOOKS.VIEW_TRANSITION_LAUNCHER,
		resolved,
		pressed,
	);
}
