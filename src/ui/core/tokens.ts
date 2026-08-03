/**
 * os-ui — Design token catalogue.
 *
 * **Why this exists.** The 45-component web-component kit exposes
 * ~190 CSS custom properties (`--os-ui-<component>-<token>`) that
 * theme each component. Each component declares its own
 * properties in its `.styles.ts` file, but previously there was
 * no central index for plugin authors who want to know "what can
 * I theme?" without grepping the source.
 *
 * This module enumerates the **token name conventions** and gives
 * authors typed helpers for setting and reading them. It does NOT
 * declare every concrete property — those still live next to
 * each component, where the component's docblock documents what
 * each variable does. What this module guarantees is the
 * *naming convention* and the runtime accessor.
 *
 * **Naming convention.** Every os-ui CSS variable follows:
 *
 *   --os-ui-<component>-<token>            — component-local
 *   --os-ui-<token>                        — kit-wide foundation
 *
 * Examples:
 *
 *   --os-ui-button-bg, --os-ui-button-fg     — os-button
 *   --os-ui-badge-info-bg                  — os-badge
 *   --os-ui-border, --os-ui-border-strong    — kit-wide
 *
 * Plugin authors styling the kit MUST use names matching this
 * shape. Anything outside `--os-ui-*` is not part of the contract
 * and may collide with WordPress's `--wp-admin-theme-color` etc.
 */

/**
 * Read a `--os-ui-*` CSS variable's computed value off an element.
 *
 * Useful for components that need to mirror a token into JS
 * (e.g. resize a canvas to match a CSS-driven width). Returns
 * the trimmed string — caller decides how to coerce to number /
 * length.
 *
 * @param tokenName Full property name with the leading `--`
 *                  (e.g. `'--os-ui-border-strong'`).
 * @param el        Element to read the resolved value from.
 *                  Defaults to `document.documentElement`.
 */
export function readToken(
	tokenName: `--os-ui-${ string }`,
	el: Element = document.documentElement,
): string {
	const cs = getComputedStyle( el );
	return cs.getPropertyValue( tokenName ).trim();
}

/**
 * Write a `--os-ui-*` CSS variable on an element's inline style.
 *
 * Equivalent to `el.style.setProperty(name, value)` but
 * type-narrowed so a typo'd token name fails at typecheck rather
 * than silently no-opping. Use sparingly — most theming should
 * happen in stylesheets so the cascade resolves predictably; the
 * inline-style escape hatch is for runtime values (a measured
 * dimension, a user-picked color) that can't be expressed in CSS.
 */
export function setToken(
	el: HTMLElement,
	tokenName: `--os-ui-${ string }`,
	value: string,
): void {
	el.style.setProperty( tokenName, value );
}

/**
 * Token-name validator — runtime guard for code that accepts a
 * caller-supplied token (debug widgets, OS Settings tabs that let
 * users tweak a value).
 */
export function isOsUiToken( name: string ): name is `--os-ui-${ string }` {
	return /^--os-ui-[a-z0-9-]+$/.test( name );
}

/**
 * Common foundation tokens shared across every component. Listed
 * here so authors have one stable handle for "I want to read the
 * shell's neutral border" rather than re-deriving it from each
 * component's stylesheet.
 */
export const OS_FOUNDATION_TOKENS = {
	border: '--os-ui-border',
	borderStrong: '--os-ui-border-strong',
} as const;
