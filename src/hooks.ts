/**
 * OpenStation — WordPress-style hooks bridge.
 *
 * The shell exposes extension points as `@wordpress/hooks` filters and
 * actions under the `os.*` namespace. This file is a thin,
 * typed wrapper around `window.wp.hooks` — we depend on the standard
 * WordPress `wp-hooks` script handle via {@see includes/assets.php}
 * rather than bundling our own primitive, so third-party plugin
 * authors use the exact API they already know from Gutenberg.
 *
 * The module throws a readable error if `wp.hooks` is missing: in the
 * WordPress admin the script handle is registered core-side and listed
 * as a dependency of `openstation`, so the failure mode is limited to
 * broken manual enqueues or unusual embeds.
 */

/**
 * Minimal structural type for the `@wordpress/hooks` API surface we
 * actually use. The real module ships a much larger API (priorities,
 * runtime removal, private namespaces) that plugins can still reach
 * via `window.wp.hooks` directly — the exports here are just the
 * idiomatic subset.
 */
export interface WpHooks {
	addFilter: (
		hookName: string,
		namespace: string,
		callback: ( ...args: unknown[] ) => unknown,
		priority?: number
	) => void;
	addAction: (
		hookName: string,
		namespace: string,
		callback: ( ...args: unknown[] ) => void,
		priority?: number
	) => void;
	removeFilter: ( hookName: string, namespace: string ) => number;
	removeAction: ( hookName: string, namespace: string ) => number;
	applyFilters: ( hookName: string, value: unknown, ...args: unknown[] ) => unknown;
	doAction: ( hookName: string, ...args: unknown[] ) => void;
	didAction: ( hookName: string ) => number;
	didFilter: ( hookName: string ) => number;
	hasAction: ( hookName: string, namespace?: string ) => boolean | number;
	hasFilter: ( hookName: string, namespace?: string ) => boolean | number;
}

/**
 * Merged `window.wp` namespace. Each module that contributes to
 * `window.wp.*` extends this interface via declaration merging —
 * hooks.ts adds `hooks`, desktop.ts adds `desktop`, and so on.
 * TypeScript merges all such declarations into a single type.
 */
declare global {
	interface WpGlobal {
		hooks?: WpHooks;
	}
	interface Window {
		wp?: WpGlobal;
	}
}

/**
 * Resolve the global `wp.hooks` object or throw with an actionable
 * message. Kept as a function (not a top-level constant) so the error
 * only fires when something actually tries to hook — imports of this
 * module don't side-effect.
 */
function getWpHooks(): WpHooks {
	const hooks = window.wp?.hooks;
	if ( ! hooks ) {
		throw new Error(
			'[openstation] `window.wp.hooks` is not available. The ' +
				'plugin declares `wp-hooks` as a script dependency; if ' +
				'you are seeing this error, verify the enqueue order.',
		);
	}
	return hooks;
}

/**
 * Typed wrappers. Each preserves the full WP signature (name,
 * namespace, callback, optional priority) but narrows the generic
 * types for our common cases.
 */
export function addFilter<TValue, TArgs extends unknown[] = unknown[]>(
	hookName: string,
	namespace: string,
	callback: ( value: TValue, ...args: TArgs ) => TValue,
	priority?: number,
): void {
	getWpHooks().addFilter(
		hookName,
		namespace,
		callback as ( ...args: unknown[] ) => unknown,
		priority,
	);
}

export function addAction<TArgs extends unknown[] = unknown[]>(
	hookName: string,
	namespace: string,
	callback: ( ...args: TArgs ) => void,
	priority?: number,
): void {
	getWpHooks().addAction(
		hookName,
		namespace,
		callback as ( ...args: unknown[] ) => void,
		priority,
	);
}

/**
 * Remove every callback registered under `namespace` for
 * `hookName`. Returns the number of callbacks actually removed.
 * Thin wrapper over `window.wp.hooks.removeAction` — exists so
 * plugin authors can unsubscribe without importing the raw bus.
 */
export function removeAction( hookName: string, namespace: string ): number {
	return getWpHooks().removeAction( hookName, namespace ) as number;
}

/**
 * Counterpart of {@link addFilter}. Same contract as
 * {@link removeAction} but for the filter bus.
 */
export function removeFilter( hookName: string, namespace: string ): number {
	return getWpHooks().removeFilter( hookName, namespace ) as number;
}

export function applyFilters<TValue, TArgs extends unknown[] = unknown[]>(
	hookName: string,
	value: TValue,
	...args: TArgs
): TValue {
	return getWpHooks().applyFilters( hookName, value, ...args ) as TValue;
}

export function doAction<TArgs extends unknown[] = unknown[]>(
	hookName: string,
	...args: TArgs
): void {
	getWpHooks().doAction( hookName, ...args );
}

export function didAction( hookName: string ): number {
	return getWpHooks().didAction( hookName );
}

/** Direct access to the underlying API — exposed on `wp.os.hooks`. */
export function rawHooks(): WpHooks {
	return getWpHooks();
}

/**
 * Hook-name catalog. Centralized so a typo in one consumer becomes a
 * TS error everywhere instead of a silent miss at runtime. Use these
 * constants from TS; plugin authors use the string values directly.
 *
 * @public
 */
export const HOOKS = {
	/** Action, fires once after shell boot; plugins register here. */
	INIT: 'os.init',

	/** Filter, receives the wallpaper registry array. */
	WALLPAPERS: 'os.wallpapers',
	/**
	 * Filter, receives the games registry array (`GameRegistryEntry[]`)
	 * on every read. Mirrors the PHP-side `openstation_games` filter.
	 */
	GAMES: 'os.games',
	/** Filter, receives the unfocused-window effect registry array. */
	UNFOCUS_EFFECTS: 'os.unfocus-effects',
	/**
	 * Filter, receives the window-reveal registry array — the
	 * `clip-path` transitions that uncover a window's content once it
	 * has finished loading.
	 */
	WINDOW_REVEALS: 'os.window-reveals',
	/** Action before a canvas wallpaper mounts. */
	WALLPAPER_MOUNTING: 'os.wallpaper.mounting',
	/** Action after a canvas wallpaper mounts successfully. */
	WALLPAPER_MOUNTED: 'os.wallpaper.mounted',
	/** Action before a canvas wallpaper tears down. */
	WALLPAPER_UNMOUNTING: 'os.wallpaper.unmounting',
	/** Action when a canvas wallpaper's mount throws / rejects. */
	WALLPAPER_MOUNT_FAILED: 'os.wallpaper.mount-failed',
	/** Action mirroring document.visibilitychange for active canvas wallpapers. */
	WALLPAPER_VISIBILITY: 'os.wallpaper.visibility',
	/**
	 * Action, fires when the wallpaper enters or leaves the suspended
	 * state (`wp.os.wallpaper.suspend()/resume()` — e.g. while a
	 * game is running). Payload: `{ id, suspended, reasons }` — the
	 * active canvas wallpaper id (or null), whether the layer is now
	 * suspended, and the currently-held reason strings. Suspension also
	 * re-emits `WALLPAPER_VISIBILITY` with the effective state, so
	 * wallpapers that only wire the visibility action pause for free.
	 */
	WALLPAPER_SUSPEND: 'os.wallpaper.suspend',
	/**
	 * Filter, receives a wallpaper's preview params (seeded from the
	 * def's `previewParams`) before its `renderPreview` runs in the OS
	 * Settings picker. Args: `( params, wallpaperId )`.
	 */
	WALLPAPER_PREVIEW_PARAMS: 'os.wallpaper.preview-params',
	/**
	 * Action, fires after a wallpaper's persisted settings change (the
	 * user edited them through the wallpaper's config dialog in OS
	 * Settings). Payload: `{ id, settings }` — the wallpaper id and the
	 * full post-merge settings object. A mounted wallpaper subscribes to
	 * live-apply changes without a remount.
	 */
	WALLPAPER_SETTINGS_CHANGED: 'os.wallpaper.settings-changed',

	// ------------------------------------------------------------------
	// Observability — iframe errors, iframe network, shell-side errors,
	// monitor entry aggregation. Designed for dashboard / debug widget
	// plugins that want genuine admin observability (Gutenberg save
	// failures, admin-ajax 500s, plugin exceptions) rather than just the
	// shell's own console-error surface.
	// ------------------------------------------------------------------

	/**
	 * Action, fires once per iframe when the chromeless bridge
	 * script has finished wiring its message listeners. Payload:
	 * `{ windowId: string }`. Subscribers get a reliable "safe to
	 * talk to this iframe" signal — the browser's native `load`
	 * event fires before our bridge attaches, so messages sent on
	 * `load` can be dropped on the floor. Use this instead when
	 * timing matters (first-focus dispatch, auto-fill handshakes).
	 */
	IFRAME_READY: 'os.iframe.ready',
	/**
	 * Action, fires when a chromeless iframe's `error` or
	 * `unhandledrejection` handler catches an exception. Payload: `{
	 * windowId: string, kind: 'error' | 'unhandledrejection', message:
	 * string, filename: string | null, lineno: number | null, colno:
	 * number | null, stack: string | null }`. Origin-filtered at the
	 * parent shell; cross-origin iframe errors never reach here.
	 */
	IFRAME_ERROR: 'os.iframe.error',
	/**
	 * Action, fires when a `fetch` or `XMLHttpRequest` inside a
	 * chromeless iframe completes (success OR failure). Payload: `{
	 * windowId: string, method: string, url: string, status: number,
	 * duration: number, failed: boolean }`. Subscribers get a faithful
	 * view of admin-ajax + REST calls that previously never left the
	 * iframe boundary. `status === 0` indicates a network failure with
	 * no response received.
	 */
	IFRAME_NETWORK_COMPLETED: 'os.iframe.network-completed',
	/**
	 * Action, fires when one of the shell's own try/catch barriers
	 * catches an exception. Payload: `{ scope:
	 * 'widget-mount' | 'widget-teardown' | 'window-open' | 'wallpaper-mount' |
	 * 'wallpaper-teardown' | 'session-save' | 'menu-refresh' | string,
	 * id?: string, error: unknown }`. Paired with the existing
	 * `console.error` calls — a monitor widget can surface these as
	 * first-class entries.
	 */
	SHELL_ERROR: 'os.shell.error',
	/**
	 * Action, fires once per `wp.os.broadcast()` call with the
	 * fully-resolved `{ topic, payload }` detail. Lets plugins log,
	 * mirror, or augment broadcast traffic without subscribing for
	 * every individual topic.
	 */
	BROADCAST: 'os.broadcast',
	/**
	 * Filter, applies to a `MonitorEntry` before a monitor widget
	 * renders it. Plugins can mutate the entry (rewrite the message,
	 * add `extra` fields) or return `null` to suppress it. Used by
	 * monitor widgets to converge every plugin on the same shape —
	 * see `MonitorEntry` in `src/types.ts`.
	 */
	MONITOR_ENTRY: 'os.monitor.entry',
	/**
	 * Filter, applies to the list of "solid" surfaces wallpapers
	 * should consider for collision / accumulation effects (snow
	 * piling, leaves settling, rain splash). Seeded by the shell
	 * with: every visible (non-minimized) window's top edge; the
	 * desktop-area floor; the dock's outward-facing edge; and every
	 * mounted widget card's top edge.
	 *
	 * Plugins that own their own DOM (e.g. floating pickers,
	 * custom overlays) can push additional surfaces so snow
	 * accumulates on them too.
	 *
	 * Each entry is a `WallpaperSurface` — see
	 * `src/wallpapers/surfaces.ts` for the shape. Rects are in
	 * viewport coordinates (clientX / clientY), matching what a
	 * canvas mounted inside `#os-wallpaper` reads.
	 */
	WALLPAPER_SURFACES: 'os.wallpaper.surfaces',

	// ------------------------------------------------------------------
	// Desktop themes (whole-OS reskins — see docs/desktop-themes.md).
	// Distinct from WINDOW_THEME_* below, which are the per-window
	// chrome themes.
	// ------------------------------------------------------------------
	/**
	 * Action, fired after the active desktop theme actually changed.
	 * Does NOT fire on a redundant re-apply (boot, settings re-save
	 * with no theme change) — subscribers can treat every firing as
	 * "repaint anything that resolves a themed icon".
	 *
	 * Signature:
	 *
	 *     ( detail: { themeId: string | null; previous: string | null } )
	 *
	 * `null` means the system default. A CustomEvent with the same
	 * detail is dispatched on `document` as
	 * `os-desktop-theme-changed`.
	 */
	DESKTOP_THEME_CHANGED: 'os.os-theme.changed',
	/**
	 * Filter, applied to every themed icon the active desktop theme
	 * resolves — a `dashicons-*` class or an absolute image URL.
	 *
	 * Only runs while a theme is ACTIVE. With no theme the resolver
	 * short-circuits on a null check and never reaches the filter, so
	 * an unthemed shell pays nothing for having subscribers.
	 *
	 * Signature:
	 *
	 *     ( icon: string, ctx: { slot: string; themeId: string } ) => string
	 */
	DESKTOP_THEME_ICON: 'os.os-theme.icon',

	/**
	 * Filters the fill colour an active desktop theme wants a slot's
	 * glyph painted in.
	 *
	 * Returning a colour where the theme set none does more than
	 * recolour: it switches an image icon from `<img>` rendering to a
	 * tinted CSS mask, discarding the artwork's own colours and
	 * keeping only its alpha. `currentColor` defers to the surface.
	 *
	 * Same zero-cost guarantee as `DESKTOP_THEME_ICON` — the resolver
	 * short-circuits before the filter when no theme is active.
	 *
	 * Signature:
	 *
	 *     ( color: string, ctx: { slot: string; themeId: string } ) => string
	 */
	DESKTOP_THEME_ICON_COLOR: 'os.os-theme.icon-color',

	/**
	 * Fires when a server-side change hands the shell a fresh
	 * `serverWallpapers` list — today, installing or deleting a desktop
	 * theme that contributes wallpapers.
	 *
	 * The wallpaper registry sync lives in the always-on shell bundle
	 * while the OS Settings panel that performs the install is a lazy
	 * one, so this is the transport between them: the panel announces,
	 * the shell reconciles. Without it the picker only learned about a
	 * theme's wallpapers on the next page load.
	 *
	 * Signature:
	 *
	 *     ( payload: { wallpapers: DesktopWallpaperServerEntry[] } ) => void
	 */
	WALLPAPERS_SERVER_CHANGED: 'os.wallpapers.server-changed',

	/**
	 * An Extended Option was saved.
	 *
	 * Same shape of problem as `WALLPAPERS_SERVER_CHANGED`: the panel
	 * that writes the option and the surfaces that obey it are
	 * different bundles, and the option is only read out of the page
	 * config the server printed at load. Without an announcement, a
	 * feature switched off in Preferences stays switched on in every
	 * window already open. Worse, a window whose REST routes were
	 * unregistered by the same save starts answering "No route was
	 * found matching the URL" instead.
	 *
	 * So the panel announces and each surface reconciles: re-read the
	 * option, re-render, and be whatever the option now says. Fires
	 * once per successful save, carrying the whole saved set rather
	 * than the one that moved: the endpoint returns the set, and a
	 * listener that wants one key can read one key.
	 *
	 * Signature:
	 *
	 *     ( payload: { options: Record< string, boolean > } ) => void
	 */
	EXTENDED_OPTIONS_CHANGED: 'os.extended-options.changed',

	// ------------------------------------------------------------------
	// Window lifecycle actions. All payloads share a `windowId: string`
	// field; additional fields are documented per-hook in the JS
	// reference. These mirror the existing `os-window-*`
	// CustomEvents but ship under the hook bus so plugins can use one
	// idiomatic API for everything the shell emits.
	// ------------------------------------------------------------------
	/**
	 * Filter, last call before a window's resolved geometry (x, y,
	 * width, height, initialState) is baked into the `WindowConfig`
	 * passed to the `Window` constructor. Lets a plugin override
	 * default placement for windows it owns, snap restored bounds to
	 * a different region, or force a particular initial state.
	 *
	 * Signature:
	 *
	 *     ( geometry: ResolvedWindowGeometry, ctx: WindowGeometryContext )
	 *         => ResolvedWindowGeometry
	 *
	 * Where `ResolvedWindowGeometry = { x, y, width, height, state? }`
	 * and `ctx = { windowId, baseId, hasSavedGeometry, callerPinned,
	 * desktopRect, workArea }`.
	 *
	 * - `desktopRect` is the whole desktop area's `{ width, height }`;
	 *   `workArea` is the `{ x, y, width, height }` of it that no
	 *   shell chrome floats over (see `wp.os.workArea`), in
	 *   desktop-area-local coordinates. Place against `workArea` —
	 *   a corner computed from `desktopRect` lands under the dock.
	 * - `hasSavedGeometry` is `true` when the user previously
	 *   dragged or resized this window and the resolved geometry
	 *   includes those restored values. Plugins that want to
	 *   "leave the user's saved layout alone" should bail when
	 *   this is true.
	 * - `callerPinned` is `true` when the caller of `manager.open()`
	 *   passed at least one of `{ x, y, width, height, initialState }`
	 *   explicitly. For NATIVE windows this is usually true (the
	 *   framework's native-window opener passes the registry's
	 *   declared dimensions); for admin-page iframe windows opened
	 *   from the dock this is usually false. The filter is free to
	 *   override registry defaults — `callerPinned: true` does NOT
	 *   mean "leave it alone."
	 *
	 * The shell re-clamps `width`/`height` to the registered
	 * `minWidth`/`minHeight` after the filter returns — a buggy
	 * filter cannot ship a sub-minimum window. `x` and `y` are
	 * NOT re-clamped after the filter (plugins sometimes want to
	 * place windows partially off-screen for deliberate stylistic
	 * reasons); the filter is responsible for its own math when it
	 * cares, and `ctx.workArea` is the rect to clamp against.
	 *
	 * Companion of `openstation_register_window` server-side
	 * defaults — runs every time a window opens, not just at
	 * registration.
	 */
	WINDOW_GEOMETRY: 'os.window.geometry',
	/** Action, fires when a window is added to the stack. */
	WINDOW_OPENED: 'os.window.opened',
	/**
	 * Action, fires when a window's body enters the loading state — at
	 * construction (every window starts loading) and whenever a plugin
	 * calls {@link NativeRenderContext.window.markLoading} or
	 * `Window.markContentLoading()` mid-life. Payload: `{ windowId }`.
	 *
	 * The shell shows a `<os-spinner>` overlay while the window is in
	 * the loading state and fades content in on the loaded transition.
	 * Subscribe to this hook (or to {@link WINDOW_CONTENT_LOADED}) when
	 * you need to react to either edge — analytics, instrumentation,
	 * decorating the spinner with a per-window message.
	 *
	 * Edge-triggered: idempotent calls don't re-fire. The matching
	 * `os-window-content-loading` CustomEvent dispatches on
	 * `document` with the same payload.
	 */
	WINDOW_CONTENT_LOADING: 'os.window.content-loading',
	/**
	 * Action, fires when a window's body content becomes ready — for
	 * iframe windows the moment the chromeless bridge announces
	 * `os-ready`, for native windows after the user's
	 * `render( body )` callback (or its returned promise) resolves, and
	 * whenever a plugin calls {@link NativeRenderContext.window.markReady}
	 * or `Window.markContentLoaded()` mid-life. Payload: `{ windowId }`.
	 *
	 * The unified "window content is ready" signal across both render
	 * strategies — use this instead of branching on iframe vs. native.
	 * Iframe-only consumers can still subscribe to {@link IFRAME_READY},
	 * which fires alongside this hook for iframe windows. The shell
	 * removes the loading overlay and fades the content in on this
	 * transition.
	 *
	 * Edge-triggered: only fires on a loading → ready transition.
	 * The matching `os-window-content-loaded` CustomEvent
	 * dispatches on `document` with the same payload.
	 */
	WINDOW_CONTENT_LOADED: 'os.window.content-loaded',
	/**
	 * Filter, applied to the loading-overlay HTMLElement just after
	 * the shell paints its default `<os-spinner>` and after any
	 * per-window inline customization (`config.loading.render`)
	 * runs. Receives the overlay element; context: `{ windowId,
	 * config }`. Plugins may mutate the element (e.g.
	 * `host.replaceChildren( myBrandedLoader )` to swap out the
	 * default entirely, or `host.querySelector('os-spinner')!.
	 * setAttribute('preset', 'comet')` to retune the spinner) or
	 * return a different element to replace the overlay wholesale.
	 *
	 * Use cases: a brand-skin plugin that overrides every window's
	 * spinner with its own logo; a status-bar plugin that adds
	 * "Loading… 47% — fetching posts" text; an A/B-test framework
	 * that swaps the loader during an experiment.
	 *
	 * Resolution order for the loading overlay:
	 *   1. Default content (`<os-spinner>`) is painted.
	 *   2. Per-window `config.loading.render( host, ctx )` runs.
	 *   3. This filter runs.
	 *   4. The result is appended to the window body.
	 */
	WINDOW_LOADING_OVERLAY: 'os.window.loading-overlay',
	/**
	 * Action, fires when `manager.open(...)` is called for a baseId
	 * whose window already exists on the active desktop. This is the
	 * unambiguous "user requested to open this window again" signal
	 * — distinct from focus changes (which double-fire on alt-tab and
	 * skip when already focused) and from `WINDOW_OPENED` (which only
	 * fires on first creation). Payload:
	 * `{ windowId: string, baseId: string, wasMinimized: boolean }`.
	 *
	 * Plugins that hold per-window state (e.g. the code-editor's
	 * active file) should listen here to re-orient the existing
	 * window's content to whatever the caller wants to show — the
	 * open-window call is synchronous, so any state the caller sets
	 * BEFORE invoking `openWindow` is already in place when this
	 * fires.
	 */
	WINDOW_REOPENED: 'os.window.reopened',
	/**
	 * Action, fires when a window's ⋯ actions menu opens, after its
	 * rows have been painted. Payload:
	 * `{ windowId: string, element: HTMLElement }` — `element` is the
	 * `<os-menu>` panel.
	 *
	 * The moment to do work a menu's contents depend on but that is
	 * too expensive, or too perishable, to do up front: probing for
	 * something on the network, re-reading a permission, checking
	 * whether a companion app has started since the page loaded.
	 *
	 * Registering a window action from here is safe and repaints the
	 * open menu — the row appears under the pointer rather than on the
	 * next open. That is the whole reason this fires *after* painting
	 * rather than before.
	 */
	WINDOW_MENU_OPENED: 'os.window.menu-opened',
	/**
	 * Action, fires BEFORE the window's element is detached from the
	 * DOM but AFTER the manager has already removed it from the stack.
	 * Payload: `{ windowId: string, element: HTMLElement }`.
	 *
	 * Use this for cleanup that needs a reference to the live
	 * element (removing anchored snow, wallpaper particles pinned to
	 * window tops, measurement caches keyed by element). `WINDOW_CLOSED`
	 * fires immediately after and only carries the id, which means
	 * subscribers would otherwise have to re-query the DOM — by then
	 * the element is gone, so they can't match at all.
	 */
	WINDOW_CLOSING: 'os.window.closing',
	/** Action, fires when a window is removed from the stack. */
	WINDOW_CLOSED: 'os.window.closed',
	/** Action, fires when focus changes to a different window. */
	WINDOW_FOCUSED: 'os.window.focused',
	/**
	 * Action, fires for the window that LOST focus when another
	 * window takes over. Symmetric counterpart to
	 * `WINDOW_FOCUSED`. Payload: `{ windowId: string, focusedTo:
	 * string | null }` — `focusedTo` identifies the new top of
	 * the stack so blur subscribers can ignore alt-tabs to a
	 * sibling they own.
	 *
	 * No-op when there's no previously-focused window (initial
	 * boot, all-windows-closed). Manager fires this BEFORE
	 * `WINDOW_FOCUSED` so subscribers see "blur old, focus new"
	 * in deterministic order.
	 */
	WINDOW_BLURRED: 'os.window.blurred',
	/**
	 * Action, fires when a window is minimized. Payload:
	 * `{ windowId: string, element: HTMLElement }`.
	 *
	 * The element ride-along matches {@link WINDOW_CLOSING}'s shape so
	 * wallpaper plugins anchored to window tops (snow, leaves, rain
	 * splash) can match stuck particles by element identity and run
	 * their teardown — minimized windows render at `opacity: 0` so
	 * `offsetParent === null` checks miss them.
	 */
	WINDOW_MINIMIZED: 'os.window.minimized',
	/**
	 * Action, fires when a window is restored from minimized. Payload:
	 * `{ windowId: string, element: HTMLElement }`.
	 */
	WINDOW_RESTORED: 'os.window.restored',
	/**
	 * Action, fires when a focus request for an OWNER window was
	 * redirected to its child instead — the user tried to raise a
	 * window that has a child window open. Payload:
	 * `{ windowId: string, childWindowId: string }`, where `windowId`
	 * is the owner that stayed put.
	 *
	 * Subscribe to add your own "answer this first" affordance beyond
	 * the child's shake (a toast, a pulse on the child's field).
	 * Purely observational — the redirect has already happened by the
	 * time this fires, and returning anything does not change it.
	 */
	WINDOW_CHILD_BLOCKED: 'os.window.child-blocked',
	/**
	 * Action, fires when a window is maximized (fills desktop area).
	 * Payload: `{ windowId: string, element: HTMLElement }`.
	 */
	WINDOW_MAXIMIZED: 'os.window.maximized',
	/**
	 * Action, fires when a window exits maximized state. Payload:
	 * `{ windowId: string, element: HTMLElement }`.
	 */
	WINDOW_UNMAXIMIZED: 'os.window.unmaximized',
	/**
	 * Action, fires when a window enters fullscreen / focus mode.
	 * Payload: `{ windowId: string, element: HTMLElement }`.
	 */
	WINDOW_FULLSCREEN_ENTERED: 'os.window.fullscreen-entered',
	/**
	 * Action, fires when a window exits fullscreen / focus mode.
	 * Payload: `{ windowId: string, element: HTMLElement }`.
	 */
	WINDOW_FULLSCREEN_EXITED: 'os.window.fullscreen-exited',
	/**
	 * Filter, decides whether a fullscreen ("focus mode") window
	 * should auto-exit when focus moves to a different window.
	 *
	 * Default is `true` so a newly-focused window is never silently
	 * occluded by a fullscreen one (its `z-index` sits above all
	 * other windows). Plugins whose fullscreen surface is meant to
	 * persist across focus changes — slideshows, video players,
	 * immersive games — can return `false` to keep their window
	 * fullscreen.
	 *
	 * Signature:
	 *
	 *     ( shouldExit: boolean, ctx: {
	 *         windowId: string,    // the fullscreen window
	 *         focusedTo: string,   // the window gaining focus
	 *     } ) => boolean
	 */
	WINDOW_AUTO_EXIT_FULLSCREEN: 'os.window.auto-exit-fullscreen',
	/**
	 * Filter, decides whether the window under the cursor is raised
	 * (focused) after a short hover dwell during a drag — any drag,
	 * whatever its source: a shell DragManager session, a
	 * cross-iframe bridge drag, an OS file, or an arbitrary native
	 * HTML5 drag.
	 *
	 * Default is `true`: dragging a payload over a background window
	 * and resting there for ~250 ms brings it forward, so the user
	 * can see the drop target they're aiming at (macOS spring-loading
	 * style). Plugins whose windows must never steal z-order during a
	 * drag — pinned reference panels, HUD/palette windows — can
	 * return `false` for their window id.
	 *
	 * Signature:
	 *
	 *     ( shouldFocus: boolean, ctx: {
	 *         windowId: string,     // the hovered window
	 *         payloadType: string,  // DragManager payload `type`,
	 *                               // bridge payload `kind`,
	 *                               // 'os-file', or 'external'
	 *     } ) => boolean
	 */
	WINDOW_FOCUS_ON_DRAG_HOVER: 'os.window.focus-on-drag-hover',
	/**
	 * Action, fires at most once per animation frame during an
	 * active drag or resize with the live geometry. Payload: `{
	 * windowId: string, x: number, y: number, width: number,
	 * height: number, state: WindowState, phase: 'drag' | 'resize' }`.
	 *
	 * Intended for per-frame collision-aware wallpapers (snow piling
	 * on window tops, rain splash on edges) that would otherwise
	 * poll `getBoundingClientRect` every rAF. Coalesced via
	 * `requestAnimationFrame` so a pointermove storm collapses to
	 * one fire per paint — matches the cadence a wallpaper's own
	 * ticker runs at.
	 *
	 * NOT fired at drag/resize end — `WINDOW_DRAG_END` /
	 * `WINDOW_RESIZE_END` handle the settled geometry. Subscribers
	 * that only want the final position should listen to those
	 * instead.
	 */
	WINDOW_BOUNDS_CHANGED: 'os.window.bounds-changed',
	/** Action, fires at drag-end with the final `{ x, y }` position. */
	WINDOW_MOVED: 'os.window.moved',
	/** Action, fires at resize-end with the final `{ width, height }`. */
	WINDOW_RESIZED: 'os.window.resized',
	/** Action, fires when title-bar drag begins. */
	WINDOW_DRAG_START: 'os.window.drag-start',
	/** Action, fires when title-bar drag ends. Payload mirrors WINDOW_MOVED. */
	WINDOW_DRAG_END: 'os.window.drag-end',
	/** Action, fires when the resize handle is first pressed. */
	WINDOW_RESIZE_START: 'os.window.resize-start',
	/** Action, fires when resize completes. Payload mirrors WINDOW_RESIZED. */
	WINDOW_RESIZE_END: 'os.window.resize-end',
	/** Action, fires when the user "detaches" a window to a classic tab. */
	WINDOW_DETACHED: 'os.window.detached',
	/**
	 * Action, fires when the user clicks the title-bar reload button
	 * on an iframe-backed window. Payload: `{ windowId: string, url:
	 * string, silent?: boolean }` where `url` is the URL being
	 * reloaded (the active primary or external sub-tab). Subscribers
	 * can use this to invalidate their own cache, force a save before
	 * navigation, track usage as a UX signal, or sync state across
	 * companion surfaces. Native windows do not fire this — they own
	 * their DOM directly and the reload button doesn't apply.
	 *
	 * `silent: true` marks a programmatic
	 * `Window.swapReload()` — the double-buffered, overlay-free
	 * refresh the editor-preview companion uses after typing pauses.
	 * It fires on swap COMPLETION (the new content is already
	 * visible), where the classic reload fires when the reload
	 * starts.
	 */
	WINDOW_RELOADED: 'os.window.reloaded',
	/** Action, fires when iframe title updates change the window title. */
	WINDOW_TITLE_CHANGED: 'os.window.title-changed',
	/**
	 * Action, fires when a window's `setHighlight()` mode changes.
	 * Payload: `{ windowId: string, mode: 'preview' | 'persistent' | null,
	 * color?: string }`. Lets onboarding / guidance / drag-bridge
	 * plugins react when another module flagged one of their
	 * windows as the focus of a multi-step interaction without
	 * having to observe DOM mutations.
	 */
	WINDOW_HIGHLIGHT_CHANGED: 'os.window.highlight-changed',
	/**
	 * Action, fires when a window's body element's dimensions
	 * change — mount, user resize, viewport reflow. Payload: `{
	 * windowId: string, width: number, height: number }`. Body
	 * dimensions exclude the title bar + tab strip, matching what a
	 * canvas or layout engine inside the body would measure.
	 */
	WINDOW_BODY_RESIZED: 'os.window.body-resized',

	// ------------------------------------------------------------------
	// Native-window lifecycle. These fire ONLY for windows constructed
	// with `native: true` — iframe windows have no render phase to
	// intercept. Use them to wrap / instrument / cancel the paint of
	// plugin-contributed native windows (the Calculator, Jorvy, custom
	// native launchers).
	// ------------------------------------------------------------------

	/**
	 * Filter, applied to the body element a native window will render
	 * into, just BEFORE the user's `render( body )` callback runs.
	 * Payload: the `HTMLElement`; context: `{ windowId, config }`.
	 *
	 * Return the same element (or a wrapper) to intercept. Subscribers
	 * commonly use this to inject a consistent shell (padding,
	 * background, decorative chrome) around every native window
	 * without every plugin re-implementing the pattern.
	 */
	NATIVE_WINDOW_BEFORE_RENDER: 'os.native-window.before-render',
	/**
	 * Action, fires AFTER a native window's `render( body )` callback
	 * returns. Payload: `{ windowId, body, config }`. Observability
	 * hook — analytics / auto-focus / post-render measurement.
	 */
	NATIVE_WINDOW_AFTER_RENDER: 'os.native-window.after-render',
	/**
	 * Filter, applied when a native window is about to start its
	 * close animation. Return `false` to CANCEL the close — the
	 * window stays open. Payload: `true`; context: `{ windowId,
	 * config }`. Any non-`false` return (including `undefined`) lets
	 * the close proceed.
	 *
	 * Intended for "unsaved changes" guards: a calculator with a
	 * pending operation can prompt the user and abort the close
	 * mid-flight. Does NOT apply to iframe windows — their close is
	 * driven by browser navigation patterns the shell doesn't own.
	 */
	NATIVE_WINDOW_BEFORE_CLOSE: 'os.native-window.before-close',

	// ------------------------------------------------------------------
	// Window-chrome customization framework. Plugins drive per-window
	// appearance (theme, controls, slots, full chrome render) through
	// the `wp.os.registerWindow*` registries; these hooks expose
	// every resolution step so plugins can mutate or observe the
	// chrome pipeline without owning a registration.
	//
	// Layers 1-3 (theme, controls, slots) are Stable. Layer 4 (chrome
	// render) is Experimental — `WINDOW_CHROME_RENDER` may change.
	// ------------------------------------------------------------------

	/**
	 * Filter, applied to the resolved CSS-variable map for a window.
	 * Receives `Record< string, string >`; context: `{ windowId,
	 * config }`. Plugins return a mutated map to override or augment
	 * the per-window theme tokens — e.g. tint every Gutenberg
	 * window's title bar to brand colour.
	 *
	 * Stable.
	 */
	WINDOW_CHROME_THEME: 'os.window.chrome.theme',
	/**
	 * Filter, applied to the resolved control list for a window.
	 * Receives `WindowControlDef[]`; context: `{ windowId, config,
	 * placement: 'left' | 'right' | 'controls' }`. Plugins return a
	 * mutated array to reorder, hide, or inject controls per-window.
	 *
	 * Stable.
	 */
	WINDOW_CHROME_CONTROLS: 'os.window.chrome.controls',
	/**
	 * Filter, applied per slot when the chrome paints. Receives the
	 * slot host element; context: `{ windowId, slot, config }`.
	 * Plugins can mutate `host` (append decorative children, set
	 * inline styles) without owning a `WindowSlotDef` registration.
	 * The shell never reads the return value — this is an action-
	 * shaped filter so existing `addFilter` plumbing applies.
	 *
	 * Stable.
	 */
	WINDOW_CHROME_SLOT: 'os.window.chrome.slot',
	/**
	 * Filter, applied to the chrome id selected for a window.
	 * Receives the resolved id (defaults to `'core/standard'`);
	 * context: `{ windowId, config }`. Returning a different id
	 * swaps the chrome registration. **Experimental** — chrome
	 * render contract may change.
	 */
	WINDOW_CHROME_RENDER: 'os.window.chrome.render',
	/**
	 * Action, fires after a window chrome layer has been mounted /
	 * remounted. Payload: `{ windowId, layer: 'chrome' | 'controls'
	 * | 'slots', chromeId? }` — `chromeId` is present only when
	 * `layer` is `'chrome'`. Subscribers can post-decorate the
	 * chrome (attach observers, anchor pickers).
	 */
	WINDOW_CHROME_APPLIED: 'os.window.chrome.applied',
	/**
	 * Action, fires after a window's theme tokens are applied to its
	 * outer element. Payload: `{ windowId, themeId, tokens }`. Lets
	 * plugins react to theme changes without diffing CSS variables.
	 */
	WINDOW_CHROME_THEME_CHANGED: 'os.window.chrome.theme-changed',

	/**
	 * Action, fires when a user clicks a desktop icon (a shortcut
	 * tile registered server-side via `openstation_register_icon()`
	 * and rendered on the wallpaper). Payload: `{ id: string,
	 * target: 'window' | 'url' }`. Fires BEFORE the default open
	 * action — plugins cannot cancel the open from this hook, but
	 * can use it to track click-throughs or augment behaviour (e.g.
	 * play a sound, surface a confirmation toast).
	 */
	DESKTOP_ICON_CLICKED: 'os.os-icon.clicked',
	/**
	 * Action, fires after the wallpaper icon grid is rendered or
	 * re-rendered. Payload:
	 *
	 *     {
	 *         ids: string[];                          // paint order
	 *         container: HTMLElement;                  // <div class="os-icons">
	 *         tiles: ReadonlyMap<string, HTMLElement>; // id → tile <button>
	 *     }
	 *
	 * Plugins that decorate icons with surfaces the framework doesn't
	 * natively expose (drag handles, status dots, cursor adornments)
	 * subscribe here so their decorations survive a live menu refresh
	 * that legitimately rebuilds the grid. The `container` and
	 * `tiles` map mirror the {@link DOCK_AFTER_RENDER}
	 * `tileElements` contract — reach into them directly instead of
	 * re-`querySelector`ing the rendered DOM.
	 *
	 * Notification badges have a first-class API —
	 * use `wp.os.icons.setBadge( id, count )` (and subscribe
	 * to {@link ICON_BADGE_CHANGED}) instead of decorating from
	 * here. The framework persists badge state across rebuilds, so
	 * a plugin that uses the API doesn't need to re-decorate on
	 * every render.
	 *
	 * Suppressed entirely when the rendered DOM is unchanged from
	 * the previous call (the fingerprint short-circuit upstream
	 * skips both the rebuild and this signal). When the icon list
	 * is empty the hook does not fire at all — the previous
	 * container is removed and no new one is appended.
	 */
	DESKTOP_ICONS_RENDERED: 'os.os-icons.rendered',
	/**
	 * Action, fires whenever the badge count on a desktop icon
	 * changes. Payload: `{ iconId: string, count: number,
	 * previousCount: number }`. Symmetric to {@link DOCK_ITEM_APPENDED}
	 * and the dock/taskbar `os-dock-item-badge-changed` CustomEvent
	 * — the icon rail's lifecycle hook for badge transitions.
	 *
	 * Mirrors `os/badge-changed` on the activity bus with
	 * `rail: 'icon'`. Subscribe to whichever surface fits — the
	 * activity channel composes across rails for global widgets,
	 * this hook fires only for icon-rail badges with the previous
	 * count carried alongside for delta-aware consumers.
	 */
	ICON_BADGE_CHANGED: 'os.icon.badge-changed',

	// ------------------------------------------------------------------
	// Cross-plugin composition.
	// ------------------------------------------------------------------

	/**
	 * Action, fires ONCE after every shell-shipped `<os-*>` custom
	 * element has registered with `customElements`. Payload: `{
	 * tags: string[] }` — the list of registered tag names. Plugins
	 * that need to defer work until the component registry is
	 * complete (e.g. hydrate user content that uses these tags)
	 * subscribe here instead of polling `customElements.get()`.
	 */
	COMPONENTS_REGISTERED: 'os.components.registered',
	/**
	 * Action, fires after `wp.os.registerSystemTile()` inserts
	 * a tile into the unified dock. Payload: `{ id: string }`. Useful
	 * for plugins that want to decorate tiles they didn't register
	 * themselves — analytics, theming, per-tile badges.
	 */
	DOCK_ITEM_APPENDED: 'os.dock.item-appended',
	/**
	 * Action, fires after a system tile is removed from a rail
	 * via `Dock.removeSystemItem()` (typically the server-driven
	 * native-window-sync path on plugin deactivation). Payload:
	 * `{ id: string, placement: 'dock' | 'taskbar' }`. Symmetric
	 * to {@link DOCK_ITEM_APPENDED}; lets analytics / decorators /
	 * cleanup hooks see the full lifecycle without polling the DOM.
	 */
	DOCK_ITEM_REMOVED: 'os.dock.item-removed',

	// ------------------------------------------------------------------
	// Dock decoration hooks — render-pipeline filters and actions the
	// default `Dock` renderer fires while painting tiles. Plugins
	// compose decoration (animations, classNames, wrappers, tooltips)
	// without forking the renderer. Custom rail renderers SHOULD fire
	// the same hooks for ecosystem compatibility — see
	// `docs/examples/dock-decoration-hooks.md` for the contract.
	//
	// Every detail object carries `{ rail, orientation, dockId,
	// container }` so a single subscriber can disambiguate when two
	// rails coexist (Classic layout's left side bar + bottom dock).
	// `dockId` matches the host element's `id` (e.g. `'os-dock'`
	// or `'os-side-dock'`) and is the stable
	// disambiguator — `rail` and `orientation` are convenience
	// projections of where the renderer is painting.
	// ------------------------------------------------------------------

	/**
	 * Action, fires at the start of every dock paint pass — both the
	 * initial mount and every `replaceItems()` that follows on the
	 * live menu-refresh path. Payload `DockRenderContext`. Use this
	 * to invalidate cached per-render decoration state before the
	 * tiles repopulate.
	 */
	DOCK_BEFORE_RENDER: 'os.dock.before-render',
	/**
	 * Action, fires once every menu and system tile has landed in
	 * the DOM for a paint pass. Payload `DockRenderContext` plus a
	 * frozen `tileElements: ReadonlyMap<string, HTMLElement>` so a
	 * plugin can decorate every tile in one sweep. Symmetric to
	 * {@link DOCK_BEFORE_RENDER}.
	 */
	DOCK_AFTER_RENDER: 'os.dock.after-render',
	/**
	 * Action a plugin *fires* (rather than listens to) when the state
	 * behind a tile's active dot has changed for a reason the dock
	 * cannot observe.
	 *
	 * The dock repaints its indicators on window lifecycle events,
	 * which covers every tile whose `isOpen()` is a question about
	 * windows. A system tile answering some other question — the
	 * Mio's is "is the companion on screen?" — has no such event,
	 * and its dot would sit stale until the next unrelated window
	 * change. Fire this after flipping that state.
	 *
	 * No payload: the dock re-queries every tile.
	 */
	DOCK_REFRESH_ACTIVE: 'os.dock.refresh-active',
	/**
	 * Filter, runs once per tile while the renderer is composing the
	 * className list. Plugins may add, remove, or reorder classes.
	 * Signature: `( classes: string[], detail: DockTileContext ) =>
	 * string[]`. Order is preserved.
	 */
	DOCK_TILE_CLASS: 'os.dock.tile-class',
	/**
	 * Filter, runs once per tile after the renderer finishes building
	 * the element but before it lands in the DOM. Return the same
	 * element with mutations, or replace with a wrapper — the shell
	 * inserts whatever you return. Signature:
	 * `( el: HTMLElement, detail: DockTileContext ) => HTMLElement`.
	 *
	 * Returning a different node still has to expose a stable
	 * `[data-menu-slug="<id>"]` (or `[data-system-id="<id>"]`)
	 * descendant for active-state / badge updates to find the tile;
	 * wrap, don't replace.
	 */
	DOCK_TILE_ELEMENT: 'os.dock.tile-element',
	/**
	 * Action, fires once per tile after it has been inserted into
	 * the DOM. Payload `DockTileContext` plus the resolved `el`. Use
	 * for post-insertion decoration where computed layout matters
	 * (measurements, IntersectionObserver bindings, etc.).
	 */
	DOCK_TILE_RENDERED: 'os.dock.tile-rendered',
	/**
	 * Filter, resolves the tooltip text for a tile. Runs once at
	 * bind time so the dock doesn't re-filter on every pointerenter.
	 * Signature: `( label: string, detail: DockTileContext ) =>
	 * string`. Return an empty string to suppress the tooltip.
	 */
	DOCK_TILE_TOOLTIP: 'os.dock.tile-tooltip',
	/**
	 * Filter, resolves the body content of a single hover-peek card.
	 * Runs once per card build (i.e., on every show of the peek for
	 * a multi-instance dock tile that has ≥1 open window). Lets a
	 * plugin render a custom thumbnail, status block, or any other
	 * markup inside the card in place of (or alongside) the default
	 * mini-window styling.
	 *
	 * Signature:
	 *   ( body: HTMLElement, detail: DockPeekCardContext ) => HTMLElement
	 *
	 * Where `body` is the `<span class="os-dock-peek__card-body">`
	 * element that the peek would otherwise populate with ghosted
	 * content lines. The filter may:
	 *   - Mutate `body` in place (e.g., append a custom child) and
	 *     return it.
	 *   - Empty `body` and append plugin-owned children.
	 *   - Return an entirely different element to replace `body`.
	 *
	 * `detail.window` is the live `Window` instance the card represents
	 * — plugins can read `window.config`, call `window.getCurrentUrl()`,
	 * subscribe to lifecycle events, etc. `detail.item` is the dock
	 * item descriptor (id / title / icon / url).
	 *
	 * The filter is invoked under the `applyFilters` namespace
	 * `os.dock.peek-card-content`.
	 */
	DOCK_PEEK_CARD_CONTENT: 'os.dock.peek-card-content',
	/**
	 * Filter, runs once per peek card right before it's appended to
	 * the popover. Receives the fully-built default card (with its
	 * mini-window chrome already populated) and can return either
	 * the same node, a mutated version, or an entirely different
	 * element to replace the card outright. Use this when the
	 * `peek-card-content` body filter isn't enough — e.g., when a
	 * plugin wants to swap the whole card chrome (custom titlebar,
	 * different shape) or wrap the card in a third-party component.
	 *
	 * Signature:
	 *   ( card: HTMLElement, detail: DockPeekCardContext ) => HTMLElement
	 *
	 * If a plugin returns a brand-new node, it is responsible for
	 * preserving anything the peek relies on:
	 *   - The `os-dock-peek__card` class (used by the
	 *     fan-out animation timing + hover styles).
	 *   - A `click` handler if the card should still focus the
	 *     window. The default click handler lives on the original
	 *     node — replacing the node loses it.
	 */
	DOCK_PEEK_CARD_ELEMENT: 'os.dock.peek-card-element',

	// ------------------------------------------------------------------
	// Constellation — the hover-submenu flyout that the `openstation`
	// desktop layout fans out of a dock tile. Inert in every other
	// layout, so a subscriber can register unconditionally and simply
	// never hear from it while the user is on Classic.
	// ------------------------------------------------------------------

	/**
	 * Filter, runs once per flyout right before it's appended to the
	 * document. Receives the fully-built panel root — head, live-window
	 * group, submenu group, footer, beam — and can return the same
	 * node, a mutated version, or a replacement.
	 *
	 * Signature:
	 *   ( panel: HTMLElement, detail: ConstellationPanelContext )
	 *     => HTMLElement
	 *
	 * `detail` carries `{ item, instances, tile }`: the menu the flyout
	 * was opened for, the live windows currently open for it, and the
	 * dock tile it is anchored to. `item.menuItem` is the `DockItem`
	 * behind the menu, or `null` when the tile is a system tile whose
	 * submenu is a list of shell actions rather than admin pages. The
	 * panel has the same sections either way; a system tile resolves
	 * its `instances` from each row's `windowId` instead of from one
	 * menu key, so the list is populated whenever those windows are
	 * open.
	 *
	 * A plugin returning a brand-new node owns everything the flyout
	 * relies on: the `os-constellation` class (positioning + the
	 * open transition), `role="menu"`, and the `os-constellation__row`
	 * class on anything that should take part in arrow-key roving.
	 */
	CONSTELLATION_PANEL: 'os.constellation.panel',
	/**
	 * Action, fires immediately after a flyout is appended. Detail:
	 * `{ menuSlug: string, item: ConstellationMenu, instances:
	 * Window[], handoff: boolean }`. `handoff` is `true` when this
	 * panel replaced one that was already up — the pointer moved along
	 * the rail — rather than arriving on an empty desk.
	 *
	 * `menuSlug` is the admin-menu slug for a menu tile, and the
	 * system tile's id for a tile whose submenu is shell actions.
	 * Filter on `item.menuItem !== null` to handle only the admin-menu
	 * ones.
	 */
	CONSTELLATION_OPENED: 'os.constellation.opened',
	/**
	 * Action, fires when a flyout is dismissed — not when its node
	 * leaves the document, which happens once its exit has played.
	 *
	 * Detail: `{ menuSlug: string, handoff: boolean }`. `menuSlug` is
	 * the menu whose flyout closed — an admin-menu slug, or a system
	 * tile's id for an action menu — or `''` if the anchor tile had
	 * already been torn down. `handoff` is `true` when another tile is
	 * already taking over, so a subscriber can tell "the menu closed"
	 * from "the menu moved" without diffing against the next
	 * {@link CONSTELLATION_OPENED}.
	 */
	CONSTELLATION_CLOSED: 'os.constellation.closed',

	// ------------------------------------------------------------------
	// Overview / Arrange lifecycle actions.
	//
	// The "Arrange" admin-bar menu drives two layout algorithms —
	// Cascade (instantly reposition every window in a staggered
	// stack) and Overview (zoom-out grid view with click-to-focus).
	// These hooks surface the state transitions so plugins can
	// instrument analytics, apply custom transitions, override
	// thumbnail decorations, etc. All actions; a filter for
	// mutating the overview layout may be added later if plugins
	// want to reorder or group thumbnails.
	// ------------------------------------------------------------------

	/** Action, fires before the overview enter animation starts. */
	OVERVIEW_ENTERING: 'os.overview.entering',
	/** Action, fires once the overview enter animation has completed. */
	OVERVIEW_ENTERED: 'os.overview.entered',
	/**
	 * Action, fires at the start of the overview-exit animation.
	 * Payload: `{ windowId?: string, reason: 'select' | 'cancel' }` —
	 * `windowId` set when the user clicked a thumbnail (reason
	 * 'select'); omitted when the user pressed Escape or clicked
	 * the backdrop (reason 'cancel').
	 */
	OVERVIEW_EXITING: 'os.overview.exiting',
	/** Action, fires once the overview-exit animation has settled. */
	OVERVIEW_EXITED: 'os.overview.exited',
	/** Action, fires when the cursor enters a thumbnail. Payload `{ windowId }`. */
	OVERVIEW_WINDOW_HOVER: 'os.overview.window-hover',
	/** Action, fires when the cursor leaves a thumbnail. Payload `{ windowId }`. */
	OVERVIEW_WINDOW_UNHOVER: 'os.overview.window-unhover',
	/** Action, fires the instant a thumbnail click is registered (before exit + maximize kick in). Payload `{ windowId }`. */
	OVERVIEW_WINDOW_CLICK: 'os.overview.window-click',

	/**
	 * Action, fires after the work area — the part of the desktop
	 * area no shell chrome floats over — actually changed: the dock
	 * moved to another edge, grew, collapsed for the overview, the
	 * browser resized, the admin bar mode flipped. Never fires on a
	 * re-measure that lands on the same numbers.
	 *
	 * Payload is a `WorkAreaSnapshot` (see `src/work-area/index.ts`
	 * and `wp.os.workArea`):
	 *
	 *     { insets: { top, right, bottom, left },
	 *       rect: { x, y, width, height },      // desktop-area-local
	 *       viewport: { x, y, width, height },  // viewport coordinates
	 *       area: { width, height } }
	 *
	 * A CustomEvent with the same detail is dispatched on `document`
	 * as `os-work-area-changed`.
	 */
	WORK_AREA_CHANGED: 'os.work-area.changed',

	/** Action, fires before cascade computes + applies new positions. Payload `{ windowCount }`. */
	ARRANGE_CASCADE_STARTING: 'os.arrange.cascade.starting',
	/** Action, fires after cascade has positioned every window. Payload `{ windowCount }`. */
	ARRANGE_CASCADE_APPLIED: 'os.arrange.cascade.applied',
	/** Action, fires before tile computes + applies new positions. Payload `{ windowCount, cols, rows }`. */
	ARRANGE_TILE_STARTING: 'os.arrange.tile.starting',
	/** Action, fires after tile has positioned every window. Payload `{ windowCount, cols, rows }`. */
	ARRANGE_TILE_APPLIED: 'os.arrange.tile.applied',
	/**
	 * Filter on the tile-grid dimensions chosen by the built-in
	 * algorithm. Receives `{ cols, rows }` plus a context arg
	 * `{ windowCount, areaWidth, areaHeight }`. Plugins can return
	 * a different `{ cols, rows }` to enforce a custom layout
	 * (fixed-column newsroom, golden-ratio cells, etc.). Returned
	 * values are validated — non-positive integers, or a product
	 * smaller than `windowCount`, fall back to the original.
	 */
	ARRANGE_TILE_DIMENSIONS: 'os.arrange.tile.dimensions',
	/** Action, fires before columns computes + applies new positions. Payload `{ windowCount, cols }`. */
	ARRANGE_COLUMNS_STARTING: 'os.arrange.columns.starting',
	/** Action, fires after columns has positioned every window. Payload `{ windowCount, cols }`. */
	ARRANGE_COLUMNS_APPLIED: 'os.arrange.columns.applied',
	/**
	 * Filter on the share of the work area the focus arrangement gives
	 * its lead window, as a fraction between 0 and 1. Receives the
	 * default (0.64) plus a context arg `{ windowCount, areaWidth,
	 * areaHeight }`. Returns outside `[0.3, 0.9]` fall back to the
	 * default — a lead window that leaves no room for the stack, or no
	 * room for itself, is not an arrangement.
	 */
	ARRANGE_FOCUS_SPLIT: 'os.arrange.focus.split',
	/** Action, fires before focus computes + applies new positions. Payload `{ windowCount, split }`. */
	ARRANGE_FOCUS_STARTING: 'os.arrange.focus.starting',
	/** Action, fires after focus has positioned every window. Payload `{ windowCount, split }`. */
	ARRANGE_FOCUS_APPLIED: 'os.arrange.focus.applied',
	/** Action, fires when snap-to-grid is toggled. Payload `{ enabled }`. */
	ARRANGE_SNAP_CHANGED: 'os.arrange.snap.changed',
	/**
	 * Filter on the snap-grid cell size. Receives
	 * `{ cellWidth, cellHeight }` plus a context arg
	 * `{ areaWidth, areaHeight }`. Plugins can return different
	 * dimensions to enforce a Tetris-style fixed grid, a musical
	 * staff aspect, etc. Non-positive returns fall back to the
	 * original.
	 */
	ARRANGE_SNAP_CELL_SIZE: 'os.arrange.snap.cell-size',
	/**
	 * Action, fires when the user clicks a plugin-registered entry in
	 * the Arrange admin-bar submenu (items added via the
	 * `openstation_arrange_menu_items` PHP filter). Payload `{ id }`
	 * where `id` is the item's `id` field as registered. Plugins
	 * subscribe here to run their custom arrangement logic.
	 */
	ARRANGE_CUSTOM_ACTION: 'os.arrange.custom-action',

	// ------------------------------------------------------------------
	// Pointer gestures the platform does not have.
	// ------------------------------------------------------------------
	/**
	 * Action, fires when a pointer is shaken — rapid, sustained
	 * direction reversals while a button is held. Payload
	 * `{ x, y, durationMs, reversals, axis: 'x' | 'y', windowId? }`;
	 * `windowId` is set when the shake happened during a window drag.
	 * The same detail is dispatched as the `os-pointer-shake`
	 * CustomEvent on the element being dragged.
	 */
	POINTER_SHAKE: 'os.pointer.shake',

	// ------------------------------------------------------------------
	// Grid snap — hold Option / Alt while dragging and the desk becomes
	// a 6×6 grid; the window lands on the span from the cell the key
	// went down in to the cell under the pointer. A shake moves the
	// anchor to the cell it happened in.
	// ------------------------------------------------------------------
	/**
	 * Filter on the grid's dimensions. Receives `{ cols, rows }` (the
	 * shipped 6×6) plus a context arg `{ areaWidth, areaHeight }`.
	 * Returns must be positive integers no greater than 24; anything
	 * else falls back to the default rather than being clamped.
	 */
	GRID_SNAP_DIMENSIONS: 'os.grid-snap.dimensions',
	/** Action, fires when the modifier arms a grid snap. Payload `{ windowId, anchor: { col, row }, dims: { cols, rows } }`. */
	GRID_SNAP_ARMED: 'os.grid-snap.armed',
	/**
	 * Action, fires whenever the target span changes — on arm, on
	 * every cell the pointer crosses, on every anchor reset. Payload
	 * `{ windowId, anchor, cursor, rect: { x, y, width, height } }`,
	 * cells zero-indexed from the top-left, `rect` area-relative.
	 */
	GRID_SNAP_CHANGED: 'os.grid-snap.changed',
	/** Action, fires when the anchor moves. Payload `{ windowId, anchor, reason: 'modifier' | 'shake' }`. */
	GRID_SNAP_ANCHOR_RESET: 'os.grid-snap.anchor-reset',
	/** Action, fires when the modifier is released mid-drag, or the drag is cancelled, without landing. Payload `{ windowId }`. */
	GRID_SNAP_CANCELED: 'os.grid-snap.canceled',
	/**
	 * Action, fires once the window has been given its span. Payload
	 * `{ windowId, x, y, width, height, anchor, cursor, dims }`. The
	 * generic `os.window.moved` / `os.window.resized` fire too.
	 */
	GRID_SNAP_COMMITTED: 'os.grid-snap.committed',
	/**
	 * Action, fires after the work area changed and every grid-snapped
	 * window was put back on its cells. Payload `{ windowIds }` — the
	 * windows whose geometry actually moved. One per pass, not one per
	 * window; the per-window `os-window-changed` still fires so the
	 * session saves the new pixels.
	 */
	GRID_SNAP_REFLOWED: 'os.grid-snap.reflowed',

	// ------------------------------------------------------------------
	// Snap-zones — Windows-style edge snapping with a split-overview
	// picker to fill the opposite half after commit.
	// ------------------------------------------------------------------
	/**
	 * Action, fires when the drag cursor enters a snap zone and the
	 * shell shows the target-position preview. Payload
	 * `{ windowId, zone: 'left' | 'right' }`.
	 */
	SNAP_ZONE_PENDING: 'os.snap.zone-pending',
	/**
	 * Action, fires when the drag cursor leaves the snap zone without
	 * releasing — the preview disappears. Payload `{ windowId }`.
	 */
	SNAP_ZONE_CANCELED: 'os.snap.zone-canceled',
	/**
	 * Action, fires once the window has animated into its snapped
	 * bounds. Payload `{ windowId, zone: 'left' | 'right' }`.
	 */
	SNAP_ZONE_COMMITTED: 'os.snap.zone-committed',
	/**
	 * Action, fires when a user picks a thumbnail from the split
	 * overview to fill the opposite half. Payload
	 * `{ windowId, zone: 'left' | 'right' }`.
	 */
	SNAP_SPLIT_FILLED: 'os.snap.split-filled',

	// ------------------------------------------------------------------
	// Widgets — the right-side column. Widgets paint above the
	// wallpaper but beneath windows. Lifecycle mirrors canvas
	// wallpapers: register via filter, mount/unmount actions bracket
	// each paint, mount-failed fires on sync throws / async rejects.
	// ------------------------------------------------------------------
	/** Filter, receives the widget registry array. */
	WIDGETS: 'os.widgets',
	/** Action before a widget mounts. Payload `{ id, container, ctx }`. */
	WIDGET_MOUNTING: 'os.widget.mounting',
	/** Action after a widget mounts successfully. Payload `{ id, container, ctx }`. */
	WIDGET_MOUNTED: 'os.widget.mounted',
	/** Action before a widget tears down. Payload `{ id }`. */
	WIDGET_UNMOUNTING: 'os.widget.unmounting',
	/** Action when a widget's mount throws / rejects. Payload `{ id, error }`. */
	WIDGET_MOUNT_FAILED: 'os.widget.mount-failed',
	/** Action when the user adds a widget via the picker. Payload `{ id }`. */
	WIDGET_ADDED: 'os.widget.added',
	/** Action when the user removes a widget via the card's × button. Payload `{ id }`. */
	WIDGET_REMOVED: 'os.widget.removed',

	// ------------------------------------------------------------------
	// Virtual-desktop ("Spaces") lifecycle actions.
	//
	// Spaces let users group windows into separate workspaces and flip
	// between them from the overview top bar. These hooks expose every
	// state change so plugins can persist per-space state, sync custom
	// indicators, or react to the user's workspace context.
	// ------------------------------------------------------------------
	/** Action, fires when a new desktop is created. Payload `{ desktopId }`. */
	DESKTOP_CREATED: 'os.os.created',
	/** Action, fires when a desktop is closed. Payload `{ desktopId, migratedTo }`. */
	DESKTOP_CLOSED: 'os.os.closed',
	/** Action, fires when the active desktop changes. Payload `{ from, to }`. */
	DESKTOP_SWITCHED: 'os.os.switched',
	/** Action, fires when a desktop is renamed. Payload `{ desktopId, label, previousLabel }`. */
	DESKTOP_RENAMED: 'os.os.renamed',
	/**
	 * Filter. Returns the id of the "primary" desktop — the one the
	 * shell treats as canonical for batch operations. Receives the
	 * default (first desktop's id) and the full `Desktop[]` list.
	 */
	PRIMARY_DESKTOP_ID: 'os.primary-desktop-id',

	// ------------------------------------------------------------------
	// Workspaces — a desktop plus the answer to "what is this desk for".
	//
	// A workspace carries which apps belong on it, which windows it
	// opens with, and how they are arranged. See `docs/workspaces.md`.
	// ------------------------------------------------------------------
	/**
	 * Filter on the list of workspace templates offered in the
	 * switcher. Receives `WorkspacePreset[]` — the three shipped desks
	 * plus anything `registerWorkspacePreset()` added. Return a shorter
	 * list to drop a template the site has no use for, or a longer one
	 * to add your own.
	 */
	WORKSPACE_PRESETS: 'os.workspaces.presets',
	/**
	 * Filter on a profile the moment it is read off a template, before
	 * the desktop is created. Receives the `WorkspaceProfile` plus the
	 * `WorkspacePreset` it came from. The place to add an app to a
	 * shipped desk without redefining it.
	 */
	WORKSPACE_PROFILE: 'os.workspaces.profile',
	/** Action, fires when a workspace's profile changes. Payload `{ desktopId, profile }`. */
	WORKSPACE_UPDATED: 'os.workspaces.updated',
	/**
	 * Action, fires once per workspace, after its launch list has
	 * opened and its layout has been applied. Payload
	 * `{ desktopId, opened, layout }` — `opened` is the number of
	 * windows the launch list actually produced, which is smaller than
	 * the list whenever an app it names is not installed.
	 */
	WORKSPACE_PROVISIONED: 'os.workspaces.provisioned',

	// ------------------------------------------------------------------
	// Batch window operations.
	// ------------------------------------------------------------------
	/**
	 * Action, fires before {@link WindowManager.closeAll} starts
	 * iterating. Payload `{ candidates: Window[] }` — every window the
	 * shell is about to close (after `exceptIds` was applied).
	 */
	WINDOWS_BEFORE_CLOSE_ALL: 'os.windows.before-close-all',
	/**
	 * Filter, runs inside {@link WindowManager.closeAll}. Receives the
	 * candidate `Window[]` list and returns the (possibly trimmed) list
	 * that will actually be closed. Plugins use this to PROTECT specific
	 * windows from a bulk close — e.g. keep the active draft open.
	 * Returning an empty array cancels the close entirely.
	 */
	WINDOWS_CLOSE_ALL: 'os.windows.close-all',
	/**
	 * Action, fires after {@link WindowManager.closeAll} has finished.
	 * Payload `{ closed: number, skipped: Window[], refused: Window[] }`
	 * — `skipped` are the windows the filter protected, `refused` the
	 * ones that turned the close down themselves (a native window's
	 * `os.native-window.before-close` veto). Neither is counted in
	 * `closed`.
	 */
	WINDOWS_AFTER_CLOSE_ALL: 'os.windows.after-close-all',

	// ------------------------------------------------------------------
	// Slash-command lifecycle.
	// ------------------------------------------------------------------
	/**
	 * Filter. Runs immediately before a command's `run()` is invoked.
	 * Receives `{ proceed: true, slug, args, command }` and may return
	 * the same shape with `proceed: false` to cancel the run.
	 */
	COMMAND_BEFORE_RUN: 'os.command.before-run',
	/**
	 * Action, fires after a command's `run()` resolves successfully.
	 * Payload `{ slug, args, command, result }`.
	 */
	COMMAND_AFTER_RUN: 'os.command.after-run',
	/**
	 * Action, fires when a command's `run()` throws. Payload
	 * `{ slug, args, command, error }`.
	 */
	COMMAND_ERROR: 'os.command.error',

	// ------------------------------------------------------------------
	// Shell-level lifecycle actions.
	// ------------------------------------------------------------------
	/**
	 * Action, fires (debounced) after the browser viewport stops
	 * resizing. Payload `{ width, height }` describes the shell's
	 * bounding rect — plugins that render canvas-driven UIs hook here
	 * to adjust their render surface.
	 */
	SHELL_RESIZED: 'os.shell.resized',
	/**
	 * Action mirroring `document.visibilitychange` for the shell as a
	 * whole. Payload `{ state: 'visible' | 'hidden' }`. Different from
	 * the wallpaper-specific visibility action in that it fires
	 * regardless of which wallpaper (if any) is active.
	 */
	SHELL_VISIBILITY: 'os.shell.visibility',
	/**
	 * Action — fires when a `wp.os.connect()` connection
	 * completes its iframe handshake. Payload:
	 * `{ connectionId, targetWindowId, topics }`.
	 */
	CONNECTION_OPENED: 'os.connection.opened',
	/**
	 * Action — fires when a connection tears down. Payload:
	 * `{ connectionId, reason: 'disconnect' | 'window-closed' | 'navigated' }`.
	 */
	CONNECTION_CLOSED: 'os.connection.closed',
	/**
	 * Action — fires for every message routed through a connection.
	 * Payload: `{ connectionId, topic, direction: 'in' | 'out' }`.
	 * Used for debug consoles + traffic auditing; high-volume topics
	 * fire this many times per second, so subscribers should be
	 * cheap.
	 */
	CONNECTION_MESSAGE: 'os.connection.message',
	/**
	 * Filter — fires when an iframe calls
	 * `wp.os.iframe.requestConnection()`. Default value is
	 * `true` (accept). Return `false` to reject, or an object
	 * `{ topics: string[] }` to accept while narrowing the topic
	 * list. `$context` carries `{ windowId, requestId, topics }`.
	 */
	IFRAME_CONNECTION_REQUEST: 'os.iframe.connection-request',

	// ------------------------------------------------------------------
	// Window content relations & link renderers. A window
	// may carry a content identity ("I am comment 45 of post 123");
	// windows resolving to the same root form a relation group, and a
	// pluggable renderer draws the ties on the desktop. Engine:
	// `src/window-links/engine.ts`; registry:
	// `src/window-links/renderer-registry.ts`. See
	// `docs/examples/window-links.md`.
	// ------------------------------------------------------------------
	/**
	 * Action — fires when a window's content identity is set, replaced,
	 * or cleared. Payload: `{ windowId: string, content:
	 * WindowContentRef | null, previous: WindowContentRef | null,
	 * source: 'config' | 'bridge' | 'api' }`. The matching
	 * `os-window-content-changed` CustomEvent dispatches on
	 * `document` with the same payload.
	 */
	WINDOW_CONTENT_CHANGED: 'os.window-links.content-changed',
	/**
	 * Action — fires when relation-group MEMBERSHIP changes (a window
	 * gained/lost an identity, or a member window opened/closed).
	 * Payload: `{ groups: WindowLinkGroup[] }`. Deliberately NOT fired
	 * on move/resize (renderers get live geometry through their frame
	 * subscription) nor on focus-recency reordering. The matching
	 * `os-window-link-groups-changed` CustomEvent dispatches
	 * on `document` with the same payload.
	 */
	WINDOW_LINK_GROUPS_CHANGED: 'os.window-links.groups-changed',
	/**
	 * Filter — applied to every content identity as it is set, before
	 * storage. Signature: `( ref: WindowContentRef | null, ctx: {
	 * windowId: string, source: 'config' | 'bridge' | 'api' } ) =>
	 * WindowContentRef | null`. Return `null` to suppress the identity,
	 * or a rewritten ref to remap it (e.g. point a custom object type
	 * at your own root scheme).
	 */
	WINDOW_LINKS_CONTENT: 'os.window-links.content',
	/**
	 * Filter — applied to the computed relation-group list on every
	 * read (`wp.os.relations.groups()`). Signature:
	 * `( groups: WindowLinkGroup[] ) => WindowLinkGroup[]`. Merge,
	 * split, or inject groups here.
	 */
	WINDOW_LINK_GROUPS: 'os.window-links.groups',
	/**
	 * Filter — applied to the derived directed-edge list on every read
	 * (`wp.os.relations.edges()`). Signature: `( edges:
	 * WindowLinkEdge[] ) => WindowLinkEdge[]` where each edge is
	 * `{ fromWindowId, toWindowId, kind: 'child-root' | 'reference',
	 * bidirectional }`. Add, drop, or redirect ties here — this is
	 * what the render host feeds to the active renderer.
	 */
	WINDOW_LINK_EDGES: 'os.window-links.edges',
	/**
	 * Filter — applied to the related-entity navigation items resolved
	 * for a window, every time the title bar's "Related" button decides
	 * its visibility and every time its menu is built. Signature:
	 * `( items: RelatedEntityItem[], ctx: { windowId: string, content:
	 * WindowContentRef | null } ) => RelatedEntityItem[]` where each
	 * item is `{ id, group, label, url, groupLabel?, icon?, count? }`.
	 * The unfiltered list is whatever the window's content identity
	 * carried in `related` (built server-side; see the
	 * `openstation_window_related_entities` PHP filter). Add, drop, or
	 * relabel items here — return an empty array to hide the button.
	 */
	RELATED_ENTITIES_ITEMS: 'os.related-entities.items',
	/**
	 * Filter — applied to the registered window-link renderer list on
	 * every read (`wp.os.listWindowLinkRenderers()`). Signature:
	 * `( defs: WindowLinkRendererDef[] ) => WindowLinkRendererDef[]`.
	 */
	WINDOW_LINK_RENDERERS: 'os.window-links.renderers',
	/**
	 * Filter — applied to the resolved ACTIVE renderer id after the OS
	 * Settings selection is read, before the registry lookup.
	 * Signature: `( id: string ) => string`. Return a different
	 * registered id (or `'none'`) to force-swap the renderer without
	 * touching the user's setting.
	 */
	WINDOW_LINK_RENDERER: 'os.window-links.renderer',

	// ------------------------------------------------------------------
	// Editor preview. The title bar's "Preview" (eye)
	// button on post/page/CPT editor windows — snaps the editor to
	// the left half and opens the front-end preview as a companion
	// window snapped to the right half, autosaving the editor in
	// parallel (a landed save silently refreshes the companion).
	// Module: `src/editor-preview/index.ts`.
	// ------------------------------------------------------------------
	/**
	 * Filter — applied to the preview companion's `WindowConfig` right
	 * before `manager.open()`. Signature: `( config: WindowConfig, ctx:
	 * { editorWindowId: string, content: WindowContentRef } ) =>
	 * WindowConfig`. Rewrite geometry, `initialState`, the title — or
	 * the URL, though the engine already dropped any cross-origin
	 * `previewUrl` at identity time.
	 */
	EDITOR_PREVIEW_WINDOW_CONFIG: 'os.editor-preview.window-config',
	/**
	 * Filter — the live-update behavior of an open preview pairing.
	 * While the pairing is active the editor iframe watches its own
	 * content and, `debounceMs` after the last edit, autosaves and
	 * nudges the shell to reload the preview — so the preview tracks
	 * typing, not just explicit saves. Signature: `( config: {
	 * enabled: boolean, debounceMs: number }, ctx: { editorWindowId:
	 * string, content: WindowContentRef } ) => config`. Defaults:
	 * `{ enabled: true, debounceMs: 1500 }` (`debounceMs` clamps to
	 * 500–30000 iframe-side). Return `{ enabled: false }` to fall back
	 * to save-driven reloads only.
	 */
	EDITOR_PREVIEW_LIVE: 'os.editor-preview.live',
	/**
	 * Action — fires after the preview companion window opened and the
	 * editor↔preview pairing is recorded. Payload: `{ editorWindowId:
	 * string, previewWindowId: string, content: WindowContentRef }`.
	 * The matching `os-editor-preview-opened` CustomEvent
	 * dispatches on `document` with the same payload.
	 */
	EDITOR_PREVIEW_OPENED: 'os.editor-preview.opened',
	/**
	 * Action — fires when an editor↔preview pairing ends: the user
	 * toggled the eye off, closed either window, or navigated the
	 * editor window to different content. Payload: `{ editorWindowId:
	 * string, previewWindowId: string, reason: 'toggled' |
	 * 'editor-closed' | 'preview-closed' | 'content-changed' }`. The
	 * matching `os-editor-preview-closed` CustomEvent
	 * dispatches on `document` with the same payload.
	 */
	EDITOR_PREVIEW_CLOSED: 'os.editor-preview.closed',

	// ------------------------------------------------------------------
	// Revision browser. The "View revisions" row in the ⋯ menu of any
	// post / page / CPT editor window — Gutenberg or classic — opens
	// Core's revision browser as its own desktop window, placed clear
	// of the editor and tied to it by a window link. Visibility and
	// the count follow the identity's `revisionsUrl` /
	// `revisionCount` (see `openstation_window_revisions()` in
	// `includes/window-links.php`).
	// Module: `src/revisions/index.ts`.
	// ------------------------------------------------------------------
	/**
	 * Filter — applied to the revision window's `WindowConfig` right
	 * before `manager.open()`. Signature: `( config: WindowConfig, ctx:
	 * { editorWindowId: string, content: WindowContentRef } ) =>
	 * WindowConfig`. Rewrite geometry (the default placement is only
	 * computed for a window with no remembered geometry), the title, or
	 * the URL — though the engine already dropped a cross-origin
	 * `revisionsUrl` at identity time.
	 */
	REVISIONS_WINDOW_CONFIG: 'os.revisions.window-config',
	/**
	 * Action — fires after the revision window opened. Payload:
	 * `{ editorWindowId: string, revisionsWindowId: string, content:
	 * WindowContentRef }`. The matching `os-revisions-opened`
	 * CustomEvent dispatches on `document` with the same payload.
	 */
	REVISIONS_OPENED: 'os.revisions.opened',

	// ------------------------------------------------------------------
	// OS-file drop manager. Catches files dragged from
	// the user's host OS (Finder / Explorer / Nautilus) onto any
	// openstation surface and routes them through a confirmation
	// dialog before uploading to the Media Library. Authoritative
	// constants live in `src/os-file-drop/hooks.ts`; mirrored here so
	// every hook the shell fires is reachable from a single `HOOKS`
	// import. See `docs/examples/os-file-drop.md`.
	// ------------------------------------------------------------------
	/** Filter — `(files: File[], ctx) => File[]`, before mime/size check. */
	FILE_DROP_FILES_DETECTED: 'os.drop.files-detected',
	/** Action — `{ rejections, context }` for files that failed policy. */
	FILE_DROP_FILES_REJECTED: 'os.drop.files-rejected',
	/** Filter — `(entry, ctx) => entry`, per-file dialog defaults. */
	FILE_DROP_DIALOG_FIELDS: 'os.drop.dialog-fields',
	/** Filter — `(payload, ctx) => payload | null`, last call before POST. */
	FILE_DROP_BEFORE_UPLOAD: 'os.drop.before-upload',
	/** Action — `{ file, fields, context, abort }` once XHR is open and about to send. */
	FILE_DROP_UPLOAD_STARTED: 'os.drop.upload-started',
	/** Action — `{ file, fields, context, loaded, total, indeterminate }` per progress tick. */
	FILE_DROP_UPLOAD_PROGRESS: 'os.drop.upload-progress',
	/** Action — `{ file, result, fields, context }` after successful upload. */
	FILE_DROP_AFTER_UPLOAD: 'os.drop.after-upload',
	/** Action — `{ file, error, context }` on upload failure. */
	FILE_DROP_UPLOAD_FAILED: 'os.drop.upload-failed',

	// ------------------------------------------------------------------
	// Session / authentication. Fired by
	// `src/auth-recovery/index.ts` when the WordPress login session
	// expires and when it comes back. Mirrored as document
	// CustomEvents (`os-auth-lost` / `-restored`) for
	// listeners outside the hook bus.
	// ------------------------------------------------------------------
	/**
	 * Action, no payload — the Heartbeat `wp-auth-check` flag
	 * reported the session as expired. Fires once per outage.
	 * Pause pollers / mutations here; requests made while the
	 * session is down will 401.
	 */
	AUTH_LOST: 'os.auth.lost',
	/**
	 * Action, no payload — the session is authenticated again and
	 * the shell's cached nonces have been (or are about to be, same
	 * tick) refreshed in place. Resume pollers and re-fetch any
	 * state that may have failed during the outage. May fire
	 * without a preceding `AUTH_LOST` when re-auth was detected
	 * from an iframe or another browser tab before the shell's own
	 * heartbeat noticed the expiry.
	 */
	AUTH_RESTORED: 'os.auth.restored',
} as const;

/**
 * Monotonic counter used to build a unique `addAction` namespace for
 * every `whenReady()` call. Using a fixed namespace (as an earlier
 * bug did) meant two plugins calling `whenReady()` silently clobbered
 * each other — `wp.hooks.addAction` treats namespace as a de-dup key.
 */
let _whenReadySeq = 0;

/**
 * Convenience: run `cb` after `os.init` has fired, either
 * immediately (if it already did) or on the next firing. Mirrors the
 * ergonomics of `jQuery(document).ready()` but for our own init
 * signal — a late-enqueued plugin script doesn't miss the boat.
 *
 * Each call registers under a unique namespace so multiple plugins
 * can register their ready-callbacks without overwriting each other.
 */
export function whenReady( cb: () => void ): void {
	if ( didAction( HOOKS.INIT ) > 0 ) {
		// Schedule on the microtask queue so callers observe consistent
		// async behavior regardless of ordering.
		Promise.resolve().then( cb );
		return;
	}
	const ns = `desktop-mode/when-ready-${ ++_whenReadySeq }`;
	addAction( HOOKS.INIT, ns, cb );
}

/**
 * Synchronous check: has the shell finished initialising? Returns true
 * after `os.init` has fired, false before. Useful for plugin
 * code that wants to branch without scheduling a callback.
 *
 * ```javascript
 * if ( wp.os.isReady() ) {
 *     wp.os.registerCommand( { ... } );
 * } else {
 *     wp.os.whenReady( () => wp.os.registerCommand( { ... } ) );
 * }
 * ```
 */
export function isReady(): boolean {
	return didAction( HOOKS.INIT ) > 0;
}
