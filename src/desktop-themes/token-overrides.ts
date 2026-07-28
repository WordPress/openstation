/**
 * Which design tokens the ACTIVE desktop theme has taken over.
 *
 * Some OS Settings controls work by writing a custom property as an
 * inline style on `<html>` — the window-corner preset writes
 * `--desktop-mode-window-radius`, the accent writes
 * `--wp-admin-theme-color`. A desktop theme can declare the same
 * property in its `tokens`, and when it does, the theme wins:
 * the compiled stylesheet's rule matches the shell root and the body
 * directly, while the inline `:root` value only reaches windows by
 * inheritance.
 *
 * That precedence is deliberate — a theme pinning its own corner
 * radius is a documented capability. What is NOT acceptable is the
 * control that lost pretending it still works. This module is how a
 * section asks "does the active theme own this value?" so it can say
 * so instead.
 */

import { getActiveDesktopThemeId, getDesktopTheme } from './registry';
import type { DesktopThemeEntry } from './types';

/** Custom property behind OS Settings → Appearance → Window corners. */
export const WINDOW_RADIUS_TOKEN = '--desktop-mode-window-radius';

/** What the active theme says about one token. */
export interface ThemeTokenOverride {
	/** The theme doing the overriding — for naming it in the UI. */
	theme: DesktopThemeEntry;
	/** The value it pins the token to. */
	value: string;
}

/**
 * The active theme's override for `token`, or `null` when no theme is
 * active or the active theme leaves that token alone.
 *
 * @public
 *
 * @param token Custom-property name, e.g. `--desktop-mode-window-radius`.
 */
export function findThemeTokenOverride(
	token: string,
): ThemeTokenOverride | null {
	const activeId = getActiveDesktopThemeId();
	if ( activeId === null ) {
		return null;
	}
	const theme = getDesktopTheme( activeId );
	if ( ! theme ) {
		return null;
	}
	// PHP lower-cases every token key during sanitization, so the
	// lookup does too rather than trusting the caller's spelling.
	const value = theme.tokens[ token.toLowerCase() ];
	if ( typeof value !== 'string' || value === '' ) {
		return null;
	}
	return { theme, value };
}
