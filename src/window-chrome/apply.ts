/**
 * Per-window theme application — Layer 1 runtime.
 *
 * The shell calls {@link applyWindowTheme} on three occasions:
 *
 *   - **At construction time** — `Window` constructor invokes it once
 *     after the element exists. Resolves the active theme + writes
 *     CSS variables to `window.element.style`.
 *   - **On registry change** — the theme registry's subscribe fires
 *     when a plugin registers / unregisters a theme; the shell
 *     invokes this for every open window so live activation paints
 *     immediately.
 *   - **On runtime mutation** — `wp.desktop.window.applyTheme()` calls
 *     this directly with explicit overrides bypassing the registry.
 *
 * Tokens previously written by the shell are tracked in a
 * WeakMap-keyed bookkeeping store so a re-apply removes stale
 * variables before writing the new ones — otherwise a window that
 * goes from theme-A (with `--desktop-mode-titlebar-bg`) to theme-B
 * (without that token) would keep theme-A's colour, because
 * `setProperty` and `removeProperty` are independent operations.
 *
 * Every applied theme passes through the
 * `desktop-mode.window.chrome.theme` filter, letting plugins augment
 * or override the resolved tokens without owning a theme
 * registration.
 *
 * @since 0.6.0
 */

import { applyFilters, doAction, HOOKS } from '../hooks';
import { listWindowThemes, resolveWindowTheme } from './themes/registry';

import type { Window as DesktopWindow } from '../window';
import type { WindowThemeRef } from '../types';

interface AppliedThemeRecord {
	themeId: string | null;
	keys: Set< string >;
}

const applied = new WeakMap< HTMLElement, AppliedThemeRecord >();

/**
 * Resolve the active theme tokens for a window. Resolution order:
 *
 *   1. Explicit override (`override` argument) — used by
 *      `applyTheme()` runtime API and by `WindowConfig.appearance.theme`.
 *      Inline tokens (`override.tokens`) bypass the registry entirely;
 *      a `themeId` reference looks the theme up.
 *   2. Highest-priority registered theme whose `match` returns true.
 *
 * Returns `{ themeId, tokens }` even when no theme matches — `tokens`
 * is then an empty object and `themeId` is `null`. Always passed
 * through the `desktop-mode.window.chrome.theme` filter so plugins can
 * decorate the result.
 *
 * @internal
 */
export function resolveActiveTheme(
	win: DesktopWindow,
	override?: WindowThemeRef,
): { themeId: string | null; tokens: Record< string, string > } {
	let themeId: string | null = null;
	let tokens: Record< string, string > = {};

	if ( override && 'tokens' in override && override.tokens ) {
		// Inline override — caller provided tokens directly.
		themeId = null;
		tokens = { ...override.tokens };
	} else if ( override && 'themeId' in override && override.themeId ) {
		// Lookup by id. We import lazily to dodge a TS module-graph cycle
		// when `apply.ts` is imported from inside the registry barrel.
		const list = resolveByThemeId( override.themeId );
		if ( list ) {
			themeId = list.id;
			tokens = { ...list.tokens };
		}
	} else {
		const winner = resolveWindowTheme( win );
		if ( winner ) {
			themeId = winner.id;
			tokens = { ...winner.tokens };
		}
	}

	const filtered = applyFilters<
		Record< string, string >,
		[ { windowId: string; themeId: string | null; config: DesktopWindow[ 'config' ] } ]
	>(
		HOOKS.WINDOW_CHROME_THEME,
		tokens,
		{ windowId: win.id, themeId, config: win.config },
	);

	return { themeId, tokens: filtered };
}

/**
 * Apply a theme to a window's outer element. Removes any previously-
 * applied tokens before writing the new set so stale variables can't
 * linger across theme changes. Fires the
 * `desktop-mode.window.chrome.theme-changed` action after writing.
 *
 * @param win      Target window.
 * @param override Optional appearance override — same shape as
 *                 `WindowConfig.appearance.theme`.
 */
export function applyWindowTheme(
	win: DesktopWindow,
	override?: WindowThemeRef,
): void {
	const element = win.element;
	if ( ! element ) {
		return;
	}

	const previous = applied.get( element );
	const { themeId, tokens } = resolveActiveTheme( win, override );

	// Drop tokens written by a previous apply that aren't in the new
	// set. Tokens in BOTH stays put — `setProperty` is idempotent so
	// the no-op write is cheap.
	if ( previous ) {
		for ( const key of previous.keys ) {
			if ( ! ( key in tokens ) ) {
				try {
					element.style.removeProperty( key );
				} catch {
					// Browsers throw on invalid property names; the
					// window has already lost the variable.
				}
			}
		}
	}

	// Write the new tokens. Track the keys so the next apply can
	// remove any that disappear.
	const keys = new Set< string >();
	for ( const [ key, value ] of Object.entries( tokens ) ) {
		try {
			element.style.setProperty( key, value );
			keys.add( key );
		} catch ( err ) {
			doAction( HOOKS.SHELL_ERROR, {
				scope: 'window-theme-apply',
				windowId: win.id,
				key,
				error: err,
			} );
		}
	}
	applied.set( element, { themeId, keys } );

	doAction( HOOKS.WINDOW_CHROME_THEME_CHANGED, {
		windowId: win.id,
		themeId,
		tokens,
	} );
}

/**
 * Drop every theme variable the shell wrote to a window's element.
 * Called by the close path to clean up before the element leaves the
 * DOM — strictly belt-and-braces, since browsers tear down inline
 * styles when the element is removed, but it ensures the
 * applied-tokens bookkeeping doesn't leak via the WeakMap if the
 * window's element is referenced elsewhere.
 *
 * @internal
 */
export function clearWindowTheme( win: DesktopWindow ): void {
	const element = win.element;
	if ( ! element ) {
		return;
	}
	const previous = applied.get( element );
	if ( ! previous ) {
		return;
	}
	for ( const key of previous.keys ) {
		try {
			element.style.removeProperty( key );
		} catch {
			// see above.
		}
	}
	applied.delete( element );
}

/**
 * Lookup a registered theme by its id.
 *
 * @internal
 */
function resolveByThemeId(
	id: string,
): { id: string; tokens: Record< string, string > } | null {
	for ( const def of listWindowThemes() ) {
		if ( def.id === id ) {
			return { id: def.id, tokens: def.tokens };
		}
	}
	return null;
}
