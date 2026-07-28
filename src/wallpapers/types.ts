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
	/**
	 * The current user's persisted settings for this wallpaper — the
	 * values last written through the wallpaper's `renderConfig` dialog
	 * (empty object when the wallpaper has never been configured). The
	 * wallpaper owns the keys' meaning; treat every value as untrusted
	 * and fall back to defaults for missing/invalid entries.
	 *
	 * This is a snapshot taken when the context was created. To follow
	 * changes while mounted, subscribe to the
	 * `desktop-mode.wallpaper.settings-changed` action.
	 */
	settings: Record< string, unknown >;
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
 * Context object passed to {@link WallpaperPreview} callbacks —
 * everything {@link WallpaperContext} carries, plus the preview
 * parameters and the tile's pixel size so the wallpaper can pick a
 * cheap resolution.
 */
export interface WallpaperPreviewContext extends WallpaperContext {
	/**
	 * Free-form preview parameters. Seeded from the def's
	 * `previewParams`, then run through the
	 * `desktop-mode.wallpaper.preview-params` filter so plugins and
	 * site owners can override what the preview depicts (e.g. force a
	 * mature Living Tree on a day-old site). The wallpaper owns the
	 * keys' meaning; unknown keys must be ignored.
	 */
	params: Record< string, unknown >;
	/** Tile content width in CSS px at mount time. */
	width: number;
	/** Tile content height in CSS px at mount time. */
	height: number;
}

/**
 * Optional live preview rendered INSIDE the wallpaper's swatch tile in
 * OS Settings. Without it, canvas wallpapers preview as their static
 * CSS `preview` string — a flat gradient standing in for a living
 * scene. With it, the picker lazily mounts the real thing (or a cheap
 * facsimile) into the tile when it scrolls into view, and tears it
 * down when it leaves.
 *
 * Contract mirrors `mount`: return a teardown (sync or via Promise)
 * that releases every resource. Keep it light — previews share the
 * page's limited WebGL context budget, so the shell caps how many run
 * concurrently and falls back to the CSS `preview` beyond the cap.
 * Honor `ctx.prefersReducedMotion` by rendering a static frame.
 */
export type WallpaperPreview = (
	container: HTMLElement,
	ctx: WallpaperPreviewContext,
) => WallpaperMountResult;

/**
 * Context object passed to {@link WallpaperConfig} callbacks —
 * everything {@link WallpaperContext} carries, plus the write half of
 * the settings surface.
 */
export interface WallpaperConfigContext extends WallpaperContext {
	/**
	 * Merge a partial settings object into the wallpaper's persisted
	 * settings. The shell persists the result through the OS Settings
	 * save pipeline (localStorage + debounced user-meta sync) and fires
	 * the `desktop-mode.wallpaper.settings-changed` action with the
	 * post-merge object, so a mounted instance of the wallpaper can
	 * live-apply without a remount.
	 *
	 * Values must be scalars (string | number | boolean) — anything
	 * else is dropped by the server-side sanitizer on the next load.
	 */
	setSettings( partial: Record< string, string | number | boolean > ): void;
}

/**
 * Optional settings dialog for the wallpaper, opened from the
 * "Wallpaper settings" button in OS Settings (the button only renders
 * for the selected wallpaper and only when its def carries this
 * callback). The shell owns the dialog chrome (`<wpd-modal>`, focus
 * trap, close/done affordances); the callback renders the form
 * controls into the dialog body it receives.
 *
 * Contract mirrors `mount`: return a teardown (sync or via Promise)
 * that releases anything the form wired up. The teardown runs when
 * the dialog closes.
 *
 * Distinct from {@link WallpaperEditor} on purpose: `renderEditor` is
 * an always-visible inline panel below the picker grid (good for one
 * or two controls the user plays with constantly, like the custom
 * gradient's colors); `renderConfig` is a modal for a fuller settings
 * form that would crowd the panel.
 */
export type WallpaperConfig = (
	container: HTMLElement,
	ctx: WallpaperConfigContext,
) => WallpaperMountResult;

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
	 */
	description?: string;
	/**
	 * Optional in-panel editor, revealed in OS Settings when this
	 * wallpaper is selected.
	 */
	renderEditor?: WallpaperEditor;
	/**
	 * Optional live preview mounted inside the swatch tile in OS
	 * Settings. The CSS `preview` string still paints first (and stays
	 * as the fallback when the preview fails, is over the concurrency
	 * cap, or the browser lacks IntersectionObserver).
	 */
	renderPreview?: WallpaperPreview;
	/**
	 * Optional settings dialog, opened from the "Wallpaper settings"
	 * button OS Settings shows for the selected wallpaper. Wallpapers
	 * without this callback show no button. See {@link WallpaperConfig}.
	 */
	renderConfig?: WallpaperConfig;
	/**
	 * Author-declared default parameters for `renderPreview`, exposed
	 * to `ctx.params` after the `desktop-mode.wallpaper.preview-params`
	 * filter runs. Use them for anything the preview should idealize —
	 * e.g. the Living Tree previews a grown tree regardless of the real
	 * site's age.
	 */
	previewParams?: Record< string, unknown >;
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
