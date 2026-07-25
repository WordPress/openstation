/**
 * Themed-icon resolver — the hot path of the whole feature.
 *
 * Every icon the shell paints (dock tiles, desktop icons, window
 * title icons, window control glyphs, file tiles, recycle-bin row
 * actions) calls through here first. That makes its cost when NO
 * theme is active the single most important number in this module:
 * it is one `=== null` comparison, and nothing else. No store read
 * beyond a property access, no filter dispatch, no allocation.
 *
 * @since 0.9.7
 */

import { applyFilters, HOOKS } from '../hooks';
import { getStore } from './registry';

/**
 * Resolve the icon an active desktop theme wants painted in `slot`.
 *
 * Returns `null` when there is no active theme, when the slot name
 * is empty, or when the active theme simply doesn't override that
 * slot — all three mean the same thing to callers: "carry on and
 * paint whatever you were going to paint".
 *
 * @public
 * @since 0.9.7
 *
 * @param slot Slot name (see `src/desktop-themes/slots.ts`).
 * @return A `dashicons-*` class, an absolute image URL, or `null`.
 */
export function resolveThemedIcon( slot: string ): string | null {
	const state = getStore().state;
	// The single null check that keeps an unthemed shell free.
	if ( state.activeIcons === null ) {
		return null;
	}
	if ( ! slot ) {
		return null;
	}
	const raw = state.activeIcons[ slot ];
	if ( typeof raw !== 'string' || raw === '' ) {
		return null;
	}
	const filtered = applyFilters< string, [ { slot: string; themeId: string } ] >(
		HOOKS.DESKTOP_THEME_ICON,
		raw,
		{ slot, themeId: state.activeId ?? '' },
	);
	return typeof filtered === 'string' && filtered !== '' ? filtered : null;
}
