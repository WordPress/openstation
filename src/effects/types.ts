/**
 * Desktop Mode — Unfocused-window effect types.
 *
 * An "unfocus effect" is a visual treatment applied to every window
 * that is NOT the focused one — the first of a growing family of
 * desktop effects surfaced in OS Settings → Effects. The built-in
 * `darken` dims unfocused windows; plugins register their own through
 * the same public hook (`wp.desktop.registerUnfocusEffect`).
 *
 * An effect is intentionally tiny: it either toggles a CSS class on
 * the window root (the cheap, declarative path the built-in uses) or
 * runs `apply` / `clear` callbacks for effects that need to touch the
 * DOM directly. The engine (`unfocus-engine.ts`) owns *when* an effect
 * is applied; the def owns *what* it does.
 */

export interface UnfocusEffectDef {
	/**
	 * Unique id matching `/^[a-z0-9_/-]+$/` — lower-case alphanum plus
	 * hyphen, underscore, and slash so plugins can namespace
	 * `vendor/sub-id`, the same convention every other JS registry
	 * uses (`registerCommand`, `registerTitleBarButton`, …).
	 */
	id: string;
	/** Human-readable label shown in the OS Settings selector. */
	label: string;
	/** Optional one-line description shown under the selector. */
	description?: string;
	/**
	 * CSS class toggled on the window root (`.desktop-mode-window`)
	 * while the window is unfocused. The declarative path — ship the
	 * matching rule in your stylesheet. The built-in `darken` uses
	 * `desktop-mode-window--fx-darken`.
	 */
	className?: string;
	/**
	 * Imperative apply hook, called with the window root element when
	 * the window becomes (or starts) unfocused under this effect. Use
	 * for effects that can't be expressed as a single static class.
	 */
	apply?: ( el: HTMLElement ) => void;
	/**
	 * Imperative teardown, called with the window root element when the
	 * window regains focus or the effect is switched away. Must undo
	 * whatever `apply` did. The engine removes `className` for you.
	 */
	clear?: ( el: HTMLElement ) => void;
	/**
	 * Owner tag — the WordPress script handle that registered the
	 * effect. Set this when plugin deactivation should live-unregister
	 * the effect (mirrors commands / settings tabs / title-bar
	 * buttons). Effects without an owner survive until the next reload.
	 */
	owner?: string;
}
