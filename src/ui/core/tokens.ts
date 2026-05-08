/**
 * wpd-ui — Design token catalogue.
 *
 * **Why this exists.** The 45-component web-component kit exposes
 * ~190 CSS custom properties (`--wpd-<component>-<token>`) that
 * theme each component. Each component declares its own
 * properties in its `.styles.ts` file, but until 0.8.1 there was
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
 * **Naming convention.** Every wpd-ui CSS variable follows:
 *
 *   --wpd-<component>-<token>            — component-local
 *   --wpd-<token>                        — kit-wide foundation
 *
 * Examples:
 *
 *   --wpd-button-bg, --wpd-button-fg     — wpd-button
 *   --wpd-badge-info-bg                  — wpd-badge
 *   --wpd-border, --wpd-border-strong    — kit-wide
 *
 * Plugin authors styling the kit MUST use names matching this
 * shape. Anything outside `--wpd-*` is not part of the contract
 * and may collide with WordPress's `--wp-admin-theme-color` etc.
 *
 * @since 0.8.1
 */

/**
 * Read a `--wpd-*` CSS variable's computed value off an element.
 *
 * Useful for components that need to mirror a token into JS
 * (e.g. resize a canvas to match a CSS-driven width). Returns
 * the trimmed string — caller decides how to coerce to number /
 * length.
 *
 * @param tokenName Full property name with the leading `--`
 *                  (e.g. `'--wpd-border-strong'`).
 * @param el        Element to read the resolved value from.
 *                  Defaults to `document.documentElement`.
 *
 * @since 0.8.1
 */
export function readToken(
	tokenName: `--wpd-${ string }`,
	el: Element = document.documentElement,
): string {
	const cs = getComputedStyle( el );
	return cs.getPropertyValue( tokenName ).trim();
}

/**
 * Write a `--wpd-*` CSS variable on an element's inline style.
 *
 * Equivalent to `el.style.setProperty(name, value)` but
 * type-narrowed so a typo'd token name fails at typecheck rather
 * than silently no-opping. Use sparingly — most theming should
 * happen in stylesheets so the cascade resolves predictably; the
 * inline-style escape hatch is for runtime values (a measured
 * dimension, a user-picked color) that can't be expressed in CSS.
 *
 * @since 0.8.1
 */
export function setToken(
	el: HTMLElement,
	tokenName: `--wpd-${ string }`,
	value: string,
): void {
	el.style.setProperty( tokenName, value );
}

/**
 * Token-name validator — runtime guard for code that accepts a
 * caller-supplied token (debug widgets, OS Settings tabs that let
 * users tweak a value).
 *
 * @since 0.8.1
 */
export function isWpdToken( name: string ): name is `--wpd-${ string }` {
	return /^--wpd-[a-z0-9-]+$/.test( name );
}

/**
 * Common foundation tokens shared across every component. Listed
 * here so authors have one stable handle for "I want to read the
 * shell's neutral border" rather than re-deriving it from each
 * component's stylesheet.
 *
 * @since 0.8.1
 */
export const WPD_FOUNDATION_TOKENS = {
	border: '--wpd-border',
	borderStrong: '--wpd-border-strong',
} as const;
