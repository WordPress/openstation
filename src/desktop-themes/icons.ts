/**
 * Themed-icon resolver — the hot path of the whole feature.
 *
 * Every icon the shell paints (dock tiles, desktop icons, window
 * title icons, window control glyphs, file tiles, recycle-bin row
 * actions) calls through here first. That makes its cost when NO
 * theme is active the single most important number in this module:
 * it is one `=== null` comparison, and nothing else. No store read
 * beyond a property access, no filter dispatch, no allocation.
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

/**
 * Resolve the fill colour an active desktop theme wants a slot's
 * glyph painted in.
 *
 * `null` means "the theme said nothing", which is NOT the same as
 * "paint it black": it is the signal to keep whatever rendering the
 * caller was already doing. A non-null value changes the rendering
 * MODE as well as the colour — an image icon becomes a
 * `background-color`-tinted CSS mask, so only its alpha survives.
 * That is what lets one silhouette iconset read correctly on a dark
 * dock, a light title bar, and a red danger-hover.
 *
 * The value is either a CSS colour or the literal `currentColor`,
 * which defers to whatever the surface is already using for text.
 *
 * @public
 *
 * @param slot Slot name (see `src/desktop-themes/slots.ts`).
 * @return A CSS colour, or `null`.
 */
export function resolveThemedIconColor( slot: string ): string | null {
	const state = getStore().state;
	if ( state.activeIconColors === null || ! slot ) {
		return null;
	}
	const raw = state.activeIconColors[ slot ];
	if ( typeof raw !== 'string' || raw === '' ) {
		return null;
	}
	const filtered = applyFilters< string, [ { slot: string; themeId: string } ] >(
		HOOKS.DESKTOP_THEME_ICON_COLOR,
		raw,
		{ slot, themeId: state.activeId ?? '' },
	);
	return typeof filtered === 'string' && filtered !== ''
		? sanitizeIconColor( filtered )
		: null;
}

/**
 * Gate a colour before it is written into an inline style.
 *
 * PHP already validated everything that arrived through a manifest;
 * this exists to contain what the filter above can hand back. Most
 * callers assign through `element.style.backgroundColor`, where the
 * CSSOM discards anything it can't parse — but one caller builds a
 * `cssText` string, and there a `;` or a brace would open a second
 * declaration. Those characters (plus quotes, angle brackets and the
 * backslash) are what this bans; parentheses and commas stay, because
 * `rgb( … )` and `oklch( … )` are ordinary values a theme is entitled
 * to use.
 *
 * @internal
 */
function sanitizeIconColor( value: string ): string | null {
	const trimmed = value.trim();
	if ( trimmed === '' || trimmed.length > 64 ) {
		return null;
	}
	if ( /[;{}<>"'\\]/.test( trimmed ) ) {
		return null;
	}
	// Balanced parentheses — an unbalanced one is malformed, never useful.
	let depth = 0;
	for ( const char of trimmed ) {
		if ( char === '(' ) {
			depth += 1;
		} else if ( char === ')' ) {
			depth -= 1;
			if ( depth < 0 ) {
				return null;
			}
		}
	}
	return depth === 0 ? trimmed : null;
}
