/**
 * Desktop Mode — Wallpaper registration types.
 *
 * A wallpaper is something that fills the desktop backdrop. Two
 * shapes ship today: `css` (a static CSS background value — gradient,
 * solid, or image URL) and `canvas` (a plugin-managed DOM subtree,
 * typically a WebGL/2D canvas driven by PixiJS, Three, or raw APIs).
 *
 * Third-party plugins register wallpapers via `wp.desktop.registerWallpaper`
 * (a convenience on top of the `desktop-mode.wallpapers` filter).
 *
 * @since 0.6.0
 */

/**
 * Context object passed to canvas wallpaper mount and editor render
 * callbacks. Exposes the bits a plugin typically needs without giving
 * it unfiltered access to internal shell state.
 */
export interface WallpaperContext {
	/** The wallpaper definition's id. */
	id: string;
	/**
	 * True when the user's OS or browser reports prefers-reduced-motion.
	 * Canvas wallpapers should render a static frame instead of starting
	 * animation loops when this is set.
	 */
	prefersReducedMotion: boolean;
	/**
	 * Current document visibility. Canvas wallpapers typically pause
	 * their tickers when `hidden`; the shell also fires
	 * `desktop-mode.wallpaper.visibility` on every change.
	 */
	visible: boolean;
	/**
	 * Base plugin URL (no trailing slash). Useful for building vendor
	 * asset paths — e.g. `${ctx.pluginUrl}/assets/vendor/pixi.min.js`.
	 */
	pluginUrl: string;
}

/**
 * Return value of a canvas mount or editor render callback. Either a
 * synchronous teardown function or a Promise resolving to one. The
 * shell always calls the teardown on unmount (wallpaper switch, page
 * close, settings reset) — even if the promise resolves after the
 * wallpaper has been switched, in which case teardown fires
 * immediately to prevent leaks.
 */
export type WallpaperTeardown = () => void;
export type WallpaperMountResult = WallpaperTeardown | Promise<WallpaperTeardown>;

/**
 * Optional in-panel editor rendered in OS Settings below the wallpaper
 * grid when this wallpaper is the active selection. Used today by the
 * custom-gradient wallpaper (color + angle controls). Third parties
 * can ship anything from a color picker to a full settings form.
 */
export type WallpaperEditor = ( container: HTMLElement, ctx: WallpaperContext ) => WallpaperMountResult;

/**
 * Shared fields on every wallpaper definition — identification, a
 * preview value for the swatch grid in OS Settings, and the optional
 * editor callback.
 */
interface WallpaperDefBase {
	/**
	 * Unique id. Required to be a valid CSS-identifier-ish string
	 * (lowercase letters, digits, hyphens). Persists to localStorage
	 * as the user's selected wallpaper.
	 */
	id: string;
	/** Human-readable label — used in the OS Settings swatch label and a11y. */
	label: string;
	/**
	 * CSS `background` value for the preview swatch in OS Settings.
	 * For canvas wallpapers this is the only way the user sees the
	 * wallpaper before selecting it, so put some love into it — a
	 * representative gradient, a thumbnail, or a data URI.
	 */
	preview: string;
	/**
	 * Optional plain-text description shown in OS Settings when this
	 * wallpaper is the active selection — a sentence or two about what
	 * the wallpaper is, where its data comes from, or the story behind
	 * it. Plain text only (no HTML); rendered by the shell in a styled
	 * card under the picker grid.
	 *
	 * Server-registered wallpapers can pass `description` to
	 * `desktop_mode_register_wallpaper()` instead — the shell overlays
	 * it onto the def if the JS side didn't set one.
	 *
	 * @since 0.9.4
	 */
	description?: string;
	/**
	 * Optional in-panel editor, revealed in OS Settings when this
	 * wallpaper is selected.
	 */
	renderEditor?: WallpaperEditor;
}

/**
 * CSS-background wallpaper. The `value` is written to the
 * `--desktop-mode-bg` custom property when this wallpaper is active.
 */
export interface CssWallpaperDef extends WallpaperDefBase {
	type: 'css';
	/**
	 * CSS `background` shorthand. Can be any valid value — a gradient,
	 * a solid color, a `url(...)` with layered fallback, anything.
	 * Use {@link resolveValue} for wallpapers whose value depends on
	 * runtime state (e.g. user-configured colors).
	 */
	value?: string;
	/**
	 * Called at apply-time to produce the CSS value. Takes precedence
	 * over `value` when both are set — used by the custom-gradient
	 * wallpaper, whose colors live in user preferences and need to be
	 * re-read on every apply.
	 */
	resolveValue?: ( ctx: WallpaperContext ) => string;
}

/**
 * Canvas / plugin-managed wallpaper. The shell calls `mount(container,
 * ctx)` when the wallpaper activates, and the returned teardown when
 * it deactivates.
 */
export interface CanvasWallpaperDef extends WallpaperDefBase {
	type: 'canvas';
	/**
	 * Declared module dependencies. The shell resolves each id through
	 * the module registry and ensures every declared module is loaded
	 * before `mount` fires. Unknown ids fail loudly via the
	 * `desktop-mode.wallpaper.mount-failed` action so authors don't
	 * chase silent non-activations.
	 *
	 * Example: `needs: ['pixijs']` — PixiJS is pre-registered by the
	 * shell; by the time `mount` runs, `window.PIXI` is defined.
	 */
	needs?: string[];
	/**
	 * Invoked once per activation. The container is the shell's
	 * wallpaper layer — a fresh, empty `<div>` sized to fill the
	 * shell. Return a teardown (sync or via Promise) that removes any
	 * resources, stops tickers, disconnects observers.
	 */
	mount: ( container: HTMLElement, ctx: WallpaperContext ) => WallpaperMountResult;
}

/** Discriminated union covering every wallpaper kind the shell knows. */
export type WallpaperDef = CssWallpaperDef | CanvasWallpaperDef;

/**
 * Filter signature: the `desktop-mode.wallpapers` hook receives a
 * readonly array of registered defs and returns (possibly the same,
 * possibly modified) list. Useful for plugins that need to reorder,
 * filter, or replace built-in entries rather than only adding.
 */
export type WallpapersFilter = ( list: WallpaperDef[] ) => WallpaperDef[];
