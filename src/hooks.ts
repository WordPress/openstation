/**
 * Desktop Mode — WordPress-style hooks bridge.
 *
 * The shell exposes extension points as `@wordpress/hooks` filters and
 * actions under the `wp-desktop.*` namespace. This file is a thin,
 * typed wrapper around `window.wp.hooks` — we depend on the standard
 * WordPress `wp-hooks` script handle via {@see includes/assets.php}
 * rather than bundling our own primitive, so third-party plugin
 * authors use the exact API they already know from Gutenberg.
 *
 * The module throws a readable error if `wp.hooks` is missing: in the
 * WordPress admin the script handle is registered core-side and listed
 * as a dependency of `wp-desktop`, so the failure mode is limited to
 * broken manual enqueues or unusual embeds.
 *
 * @since 0.6.0
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
			'[wp-desktop-mode] `window.wp.hooks` is not available. The ' +
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

/** Direct access to the underlying API — exposed on `wp.desktop.hooks`. */
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
	INIT: 'wp-desktop.init',

	/** Filter, receives the wallpaper registry array. */
	WALLPAPERS: 'wp-desktop.wallpapers',
	/** Action before a canvas wallpaper mounts. */
	WALLPAPER_MOUNTING: 'wp-desktop.wallpaper.mounting',
	/** Action after a canvas wallpaper mounts successfully. */
	WALLPAPER_MOUNTED: 'wp-desktop.wallpaper.mounted',
	/** Action before a canvas wallpaper tears down. */
	WALLPAPER_UNMOUNTING: 'wp-desktop.wallpaper.unmounting',
	/** Action when a canvas wallpaper's mount throws / rejects. */
	WALLPAPER_MOUNT_FAILED: 'wp-desktop.wallpaper.mount-failed',
	/** Action mirroring document.visibilitychange for active canvas wallpapers. */
	WALLPAPER_VISIBILITY: 'wp-desktop.wallpaper.visibility',

	// ------------------------------------------------------------------
	// Observability — iframe errors, iframe network, shell-side errors,
	// monitor entry aggregation. Designed for dashboard / debug widget
	// plugins that want genuine admin observability (Gutenberg save
	// failures, admin-ajax 500s, plugin exceptions) rather than just the
	// shell's own console-error surface.
	// ------------------------------------------------------------------

	/**
	 * Action, fires when a chromeless iframe's `error` or
	 * `unhandledrejection` handler catches an exception. Payload: `{
	 * windowId: string, kind: 'error' | 'unhandledrejection', message:
	 * string, filename: string | null, lineno: number | null, colno:
	 * number | null, stack: string | null }`. Origin-filtered at the
	 * parent shell; cross-origin iframe errors never reach here.
	 */
	/**
	 * Action, fires once per iframe when the chromeless bridge
	 * script has finished wiring its message listeners. Payload:
	 * `{ windowId: string }`. Subscribers get a reliable "safe to
	 * talk to this iframe" signal — the browser's native `load`
	 * event fires before our bridge attaches, so messages sent on
	 * `load` can be dropped on the floor. Use this instead when
	 * timing matters (first-focus dispatch, auto-fill handshakes).
	 *
	 * @since 0.11.0
	 */
	IFRAME_READY: 'wp-desktop.iframe.ready',
	IFRAME_ERROR: 'wp-desktop.iframe.error',
	/**
	 * Action, fires when a `fetch` or `XMLHttpRequest` inside a
	 * chromeless iframe completes (success OR failure). Payload: `{
	 * windowId: string, method: string, url: string, status: number,
	 * duration: number, failed: boolean }`. Subscribers get a faithful
	 * view of admin-ajax + REST calls that previously never left the
	 * iframe boundary. `status === 0` indicates a network failure with
	 * no response received.
	 */
	IFRAME_NETWORK_COMPLETED: 'wp-desktop.iframe.network-completed',
	/**
	 * Action, fires when one of the shell's own try/catch barriers
	 * catches an exception. Payload: `{ scope:
	 * 'widget-mount' | 'widget-teardown' | 'window-open' | 'wallpaper-mount' |
	 * 'wallpaper-teardown' | 'session-save' | 'menu-refresh' | string,
	 * id?: string, error: unknown }`. Paired with the existing
	 * `console.error` calls — a monitor widget can surface these as
	 * first-class entries.
	 */
	SHELL_ERROR: 'wp-desktop.shell.error',
	/**
	 * Action, fires once per `wp.desktop.broadcast()` call with the
	 * fully-resolved `{ topic, payload }` detail. Lets plugins log,
	 * mirror, or augment broadcast traffic without subscribing for
	 * every individual topic.
	 */
	BROADCAST: 'wp-desktop.broadcast',
	/**
	 * Filter, applies to a `MonitorEntry` before a monitor widget
	 * renders it. Plugins can mutate the entry (rewrite the message,
	 * add `extra` fields) or return `null` to suppress it. Used by
	 * monitor widgets to converge every plugin on the same shape —
	 * see `MonitorEntry` in `src/types.ts`.
	 */
	MONITOR_ENTRY: 'wp-desktop.monitor.entry',
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
	 * canvas mounted inside `#wp-desktop-wallpaper` reads.
	 */
	WALLPAPER_SURFACES: 'wp-desktop.wallpaper.surfaces',

	// ------------------------------------------------------------------
	// Window lifecycle actions. All payloads share a `windowId: string`
	// field; additional fields are documented per-hook in the JS
	// reference. These mirror the existing `wp-desktop-window-*`
	// CustomEvents but ship under the hook bus so plugins can use one
	// idiomatic API for everything the shell emits.
	// ------------------------------------------------------------------
	/** Action, fires when a window is added to the stack. */
	WINDOW_OPENED: 'wp-desktop.window.opened',
	/**
	 * Action, fires when a window's body enters the loading state — at
	 * construction (every window starts loading) and whenever a plugin
	 * calls {@link NativeRenderContext.window.markLoading} or
	 * `Window.markContentLoading()` mid-life. Payload: `{ windowId }`.
	 *
	 * The shell shows a `<wpd-spinner>` overlay while the window is in
	 * the loading state and fades content in on the loaded transition.
	 * Subscribe to this hook (or to {@link WINDOW_CONTENT_LOADED}) when
	 * you need to react to either edge — analytics, instrumentation,
	 * decorating the spinner with a per-window message.
	 *
	 * Edge-triggered: idempotent calls don't re-fire. The matching
	 * `wp-desktop-window-content-loading` CustomEvent dispatches on
	 * `document` with the same payload.
	 *
	 * @since 0.6.0
	 */
	WINDOW_CONTENT_LOADING: 'wp-desktop.window.content-loading',
	/**
	 * Action, fires when a window's body content becomes ready — for
	 * iframe windows the moment the chromeless bridge announces
	 * `wp-desktop-ready`, for native windows after the user's
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
	 * The matching `wp-desktop-window-content-loaded` CustomEvent
	 * dispatches on `document` with the same payload.
	 *
	 * @since 0.6.0
	 */
	WINDOW_CONTENT_LOADED: 'wp-desktop.window.content-loaded',
	/**
	 * Filter, applied to the loading-overlay HTMLElement just after
	 * the shell paints its default `<wpd-spinner>` and after any
	 * per-window inline customization (`config.loading.render`)
	 * runs. Receives the overlay element; context: `{ windowId,
	 * config }`. Plugins may mutate the element (e.g.
	 * `host.replaceChildren( myBrandedLoader )` to swap out the
	 * default entirely, or `host.querySelector('wpd-spinner')!.
	 * setAttribute('preset', 'comet')` to retune the spinner) or
	 * return a different element to replace the overlay wholesale.
	 *
	 * Use cases: a brand-skin plugin that overrides every window's
	 * spinner with its own logo; a status-bar plugin that adds
	 * "Loading… 47% — fetching posts" text; an A/B-test framework
	 * that swaps the loader during an experiment.
	 *
	 * Resolution order for the loading overlay:
	 *   1. Default content (`<wpd-spinner>`) is painted.
	 *   2. Per-window `config.loading.render( host, ctx )` runs.
	 *   3. This filter runs.
	 *   4. The result is appended to the window body.
	 *
	 * @since 0.6.0
	 */
	WINDOW_LOADING_OVERLAY: 'wp-desktop.window.loading-overlay',
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
	WINDOW_REOPENED: 'wp-desktop.window.reopened',
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
	WINDOW_CLOSING: 'wp-desktop.window.closing',
	/** Action, fires when a window is removed from the stack. */
	WINDOW_CLOSED: 'wp-desktop.window.closed',
	/** Action, fires when focus changes to a different window. */
	WINDOW_FOCUSED: 'wp-desktop.window.focused',
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
	 *
	 * @since 0.5.5
	 */
	WINDOW_BLURRED: 'wp-desktop.window.blurred',
	/** Action, fires when a window is minimized. */
	WINDOW_MINIMIZED: 'wp-desktop.window.minimized',
	/** Action, fires when a window is restored from minimized. */
	WINDOW_RESTORED: 'wp-desktop.window.restored',
	/** Action, fires when a window is maximized (fills desktop area). */
	WINDOW_MAXIMIZED: 'wp-desktop.window.maximized',
	/** Action, fires when a window exits maximized state. */
	WINDOW_UNMAXIMIZED: 'wp-desktop.window.unmaximized',
	/** Action, fires when a window enters fullscreen / focus mode. */
	WINDOW_FULLSCREEN_ENTERED: 'wp-desktop.window.fullscreen-entered',
	/** Action, fires when a window exits fullscreen / focus mode. */
	WINDOW_FULLSCREEN_EXITED: 'wp-desktop.window.fullscreen-exited',
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
	WINDOW_BOUNDS_CHANGED: 'wp-desktop.window.bounds-changed',
	/** Action, fires at drag-end with the final `{ x, y }` position. */
	WINDOW_MOVED: 'wp-desktop.window.moved',
	/** Action, fires at resize-end with the final `{ width, height }`. */
	WINDOW_RESIZED: 'wp-desktop.window.resized',
	/** Action, fires when title-bar drag begins. */
	WINDOW_DRAG_START: 'wp-desktop.window.drag-start',
	/** Action, fires when title-bar drag ends. Payload mirrors WINDOW_MOVED. */
	WINDOW_DRAG_END: 'wp-desktop.window.drag-end',
	/** Action, fires when the resize handle is first pressed. */
	WINDOW_RESIZE_START: 'wp-desktop.window.resize-start',
	/** Action, fires when resize completes. Payload mirrors WINDOW_RESIZED. */
	WINDOW_RESIZE_END: 'wp-desktop.window.resize-end',
	/** Action, fires when the user "detaches" a window to a classic tab. */
	WINDOW_DETACHED: 'wp-desktop.window.detached',
	/**
	 * Action, fires when the user clicks the title-bar reload button
	 * on an iframe-backed window. Payload: `{ windowId: string, url:
	 * string }` where `url` is the URL being reloaded (the active
	 * primary or external sub-tab). Subscribers can use this to
	 * invalidate their own cache, force a save before navigation,
	 * track usage as a UX signal, or sync state across companion
	 * surfaces. Native windows do not fire this — they own their
	 * DOM directly and the reload button doesn't apply.
	 */
	WINDOW_RELOADED: 'wp-desktop.window.reloaded',
	/** Action, fires when iframe title updates change the window title. */
	WINDOW_TITLE_CHANGED: 'wp-desktop.window.title-changed',
	/**
	 * Action, fires when a window's `setHighlight()` mode changes.
	 * Payload: `{ windowId: string, mode: 'preview' | 'persistent' | null,
	 * color?: string }`. Lets onboarding / guidance / drag-bridge
	 * plugins react when another module flagged one of their
	 * windows as the focus of a multi-step interaction without
	 * having to observe DOM mutations.
	 *
	 * @since 0.24.0
	 */
	WINDOW_HIGHLIGHT_CHANGED: 'wp-desktop.window.highlight-changed',
	/**
	 * Action, fires when a window's body element's dimensions
	 * change — mount, user resize, viewport reflow. Payload: `{
	 * windowId: string, width: number, height: number }`. Body
	 * dimensions exclude the title bar + tab strip, matching what a
	 * canvas or layout engine inside the body would measure.
	 */
	WINDOW_BODY_RESIZED: 'wp-desktop.window.body-resized',

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
	NATIVE_WINDOW_BEFORE_RENDER: 'wp-desktop.native-window.before-render',
	/**
	 * Action, fires AFTER a native window's `render( body )` callback
	 * returns. Payload: `{ windowId, body, config }`. Observability
	 * hook — analytics / auto-focus / post-render measurement.
	 */
	NATIVE_WINDOW_AFTER_RENDER: 'wp-desktop.native-window.after-render',
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
	NATIVE_WINDOW_BEFORE_CLOSE: 'wp-desktop.native-window.before-close',

	// ------------------------------------------------------------------
	// Window-chrome customization framework. Plugins drive per-window
	// appearance (theme, controls, slots, full chrome render) through
	// the `wp.desktop.registerWindow*` registries; these hooks expose
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
	 * Stable since 0.6.0.
	 */
	WINDOW_CHROME_THEME: 'wp-desktop.window.chrome.theme',
	/**
	 * Filter, applied to the resolved control list for a window.
	 * Receives `WindowControlDef[]`; context: `{ windowId, config,
	 * placement: 'left' | 'right' | 'controls' }`. Plugins return a
	 * mutated array to reorder, hide, or inject controls per-window.
	 *
	 * Stable since 0.6.0.
	 */
	WINDOW_CHROME_CONTROLS: 'wp-desktop.window.chrome.controls',
	/**
	 * Filter, applied per slot when the chrome paints. Receives the
	 * slot host element; context: `{ windowId, slot, config }`.
	 * Plugins can mutate `host` (append decorative children, set
	 * inline styles) without owning a `WindowSlotDef` registration.
	 * The shell never reads the return value — this is an action-
	 * shaped filter so existing `addFilter` plumbing applies.
	 *
	 * Stable since 0.6.0.
	 */
	WINDOW_CHROME_SLOT: 'wp-desktop.window.chrome.slot',
	/**
	 * Filter, applied to the chrome id selected for a window.
	 * Receives the resolved id (defaults to `'core/standard'`);
	 * context: `{ windowId, config }`. Returning a different id
	 * swaps the chrome registration. **Experimental** — chrome
	 * render contract may change.
	 *
	 * @since 0.6.0
	 */
	WINDOW_CHROME_RENDER: 'wp-desktop.window.chrome.render',
	/**
	 * Action, fires after a window's chrome has been mounted /
	 * remounted. Payload: `{ windowId, chromeId }`. Subscribers can
	 * post-decorate the chrome (attach observers, anchor pickers).
	 *
	 * @since 0.6.0
	 */
	WINDOW_CHROME_APPLIED: 'wp-desktop.window.chrome.applied',
	/**
	 * Action, fires after a window's theme tokens are applied to its
	 * outer element. Payload: `{ windowId, themeId, tokens }`. Lets
	 * plugins react to theme changes without diffing CSS variables.
	 *
	 * @since 0.6.0
	 */
	WINDOW_CHROME_THEME_CHANGED: 'wp-desktop.window.chrome.theme-changed',

	/**
	 * Action, fires when a user clicks a desktop icon (a shortcut
	 * tile registered server-side via `desktop_mode_register_icon()`
	 * and rendered on the wallpaper). Payload: `{ id: string,
	 * target: 'window' | 'url' }`. Fires BEFORE the default open
	 * action — plugins cannot cancel the open from this hook, but
	 * can use it to track click-throughs or augment behaviour (e.g.
	 * play a sound, surface a confirmation toast).
	 *
	 * @since 0.11.0
	 */
	DESKTOP_ICON_CLICKED: 'wp-desktop.desktop-icon.clicked',
	/**
	 * Action, fires after the wallpaper icon grid is rendered or
	 * re-rendered. Payload: `{ ids: string[] }` — the ids in the
	 * order they were painted. Plugins that decorate icons with
	 * surfaces the framework doesn't natively expose (drag handles,
	 * status dots) subscribe to this so their decorations survive a
	 * live menu refresh that legitimately rebuilds the grid.
	 *
	 * Notification badges have a first-class API since 0.24.0 —
	 * use `wp.desktop.icons.setBadge( id, count )` (and subscribe
	 * to {@link ICON_BADGE_CHANGED}) instead of decorating from
	 * here. The framework persists badge state across rebuilds, so
	 * a plugin that uses the API doesn't need to re-decorate on
	 * every render.
	 *
	 * Idempotent payload (`{ ids: [] }`) when the icon list is
	 * empty; suppressed entirely when the rendered DOM is
	 * unchanged from the previous call (the fingerprint short-
	 * circuit upstream skips both the rebuild and this signal).
	 *
	 * @since 0.21.0
	 */
	DESKTOP_ICONS_RENDERED: 'wp-desktop.desktop-icons.rendered',
	/**
	 * Action, fires whenever the badge count on a desktop icon
	 * changes. Payload: `{ iconId: string, count: number,
	 * previousCount: number }`. Symmetric to {@link DOCK_ITEM_APPENDED}
	 * and the dock/taskbar `wpd-dock-item-badge-changed` CustomEvent
	 * — the icon rail's lifecycle hook for badge transitions.
	 *
	 * Mirrors `wp-desktop/badge-changed` on the activity bus with
	 * `rail: 'icon'`. Subscribe to whichever surface fits — the
	 * activity channel composes across rails for global widgets,
	 * this hook fires only for icon-rail badges with the previous
	 * count carried alongside for delta-aware consumers.
	 *
	 * @since 0.24.0
	 */
	ICON_BADGE_CHANGED: 'wp-desktop.icon.badge-changed',

	// ------------------------------------------------------------------
	// Cross-plugin composition.
	// ------------------------------------------------------------------

	/**
	 * Action, fires ONCE after every shell-shipped `<wpd-*>` custom
	 * element has registered with `customElements`. Payload: `{
	 * tags: string[] }` — the list of registered tag names. Plugins
	 * that need to defer work until the component registry is
	 * complete (e.g. hydrate user content that uses these tags)
	 * subscribe here instead of polling `customElements.get()`.
	 */
	COMPONENTS_REGISTERED: 'wp-desktop.components.registered',
	/**
	 * Action, fires after `wp.desktop.registerSystemTile()` inserts
	 * a tile into the unified dock. Payload: `{ id: string }`. Useful
	 * for plugins that want to decorate tiles they didn't register
	 * themselves — analytics, theming, per-tile badges.
	 */
	DOCK_ITEM_APPENDED: 'wp-desktop.dock.item-appended',
	/**
	 * Action, fires after a system tile is removed from a rail
	 * via `Dock.removeSystemItem()` (typically the server-driven
	 * native-window-sync path on plugin deactivation). Payload:
	 * `{ id: string, placement: 'dock' | 'taskbar' }`. Symmetric
	 * to {@link DOCK_ITEM_APPENDED}; lets analytics / decorators /
	 * cleanup hooks see the full lifecycle without polling the DOM.
	 *
	 * @since 0.24.0
	 */
	DOCK_ITEM_REMOVED: 'wp-desktop.dock.item-removed',

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
	// `dockId` matches the host element's `id` (e.g. `'wp-desktop-dock'`
	// or `'wp-desktop-side-dock'`) and is the stable
	// disambiguator — `rail` and `orientation` are convenience
	// projections of where the renderer is painting.
	// ------------------------------------------------------------------

	/**
	 * Action, fires at the start of every dock paint pass — both the
	 * initial mount and every `replaceItems()` that follows on the
	 * live menu-refresh path. Payload `DockRenderContext`. Use this
	 * to invalidate cached per-render decoration state before the
	 * tiles repopulate.
	 *
	 * @since 0.18.0
	 */
	DOCK_BEFORE_RENDER: 'wp-desktop.dock.before-render',
	/**
	 * Action, fires once every menu and system tile has landed in
	 * the DOM for a paint pass. Payload `DockRenderContext` plus a
	 * frozen `tileElements: ReadonlyMap<string, HTMLElement>` so a
	 * plugin can decorate every tile in one sweep. Symmetric to
	 * {@link DOCK_BEFORE_RENDER}.
	 *
	 * @since 0.18.0
	 */
	DOCK_AFTER_RENDER: 'wp-desktop.dock.after-render',
	/**
	 * Filter, runs once per tile while the renderer is composing the
	 * className list. Plugins may add, remove, or reorder classes.
	 * Signature: `( classes: string[], detail: DockTileContext ) =>
	 * string[]`. Order is preserved.
	 *
	 * @since 0.18.0
	 */
	DOCK_TILE_CLASS: 'wp-desktop.dock.tile-class',
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
	 *
	 * @since 0.18.0
	 */
	DOCK_TILE_ELEMENT: 'wp-desktop.dock.tile-element',
	/**
	 * Action, fires once per tile after it has been inserted into
	 * the DOM. Payload `DockTileContext` plus the resolved `el`. Use
	 * for post-insertion decoration where computed layout matters
	 * (measurements, IntersectionObserver bindings, etc.).
	 *
	 * @since 0.18.0
	 */
	DOCK_TILE_RENDERED: 'wp-desktop.dock.tile-rendered',
	/**
	 * Filter, resolves the tooltip text for a tile. Runs once at
	 * bind time so the dock doesn't re-filter on every pointerenter.
	 * Signature: `( label: string, detail: DockTileContext ) =>
	 * string`. Return an empty string to suppress the tooltip.
	 *
	 * @since 0.18.0
	 */
	DOCK_TILE_TOOLTIP: 'wp-desktop.dock.tile-tooltip',

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
	OVERVIEW_ENTERING: 'wp-desktop.overview.entering',
	/** Action, fires once the overview enter animation has completed. */
	OVERVIEW_ENTERED: 'wp-desktop.overview.entered',
	/**
	 * Action, fires at the start of the overview-exit animation.
	 * Payload: `{ windowId?: string, reason: 'select' | 'cancel' }` —
	 * `windowId` set when the user clicked a thumbnail (reason
	 * 'select'); omitted when the user pressed Escape or clicked
	 * the backdrop (reason 'cancel').
	 */
	OVERVIEW_EXITING: 'wp-desktop.overview.exiting',
	/** Action, fires once the overview-exit animation has settled. */
	OVERVIEW_EXITED: 'wp-desktop.overview.exited',
	/** Action, fires when the cursor enters a thumbnail. Payload `{ windowId }`. */
	OVERVIEW_WINDOW_HOVER: 'wp-desktop.overview.window-hover',
	/** Action, fires when the cursor leaves a thumbnail. Payload `{ windowId }`. */
	OVERVIEW_WINDOW_UNHOVER: 'wp-desktop.overview.window-unhover',
	/** Action, fires the instant a thumbnail click is registered (before exit + maximize kick in). Payload `{ windowId }`. */
	OVERVIEW_WINDOW_CLICK: 'wp-desktop.overview.window-click',

	/** Action, fires before cascade computes + applies new positions. Payload `{ windowCount }`. */
	ARRANGE_CASCADE_STARTING: 'wp-desktop.arrange.cascade.starting',
	/** Action, fires after cascade has positioned every window. Payload `{ windowCount }`. */
	ARRANGE_CASCADE_APPLIED: 'wp-desktop.arrange.cascade.applied',
	/** Action, fires before tile computes + applies new positions. Payload `{ windowCount, cols, rows }`. */
	ARRANGE_TILE_STARTING: 'wp-desktop.arrange.tile.starting',
	/** Action, fires after tile has positioned every window. Payload `{ windowCount, cols, rows }`. */
	ARRANGE_TILE_APPLIED: 'wp-desktop.arrange.tile.applied',
	/**
	 * Filter on the tile-grid dimensions chosen by the built-in
	 * algorithm. Receives `{ cols, rows }` plus a context arg
	 * `{ windowCount, areaWidth, areaHeight }`. Plugins can return
	 * a different `{ cols, rows }` to enforce a custom layout
	 * (fixed-column newsroom, golden-ratio cells, etc.). Returned
	 * values are validated — non-positive integers, or a product
	 * smaller than `windowCount`, fall back to the original.
	 */
	ARRANGE_TILE_DIMENSIONS: 'wp-desktop.arrange.tile.dimensions',
	/** Action, fires when snap-to-grid is toggled. Payload `{ enabled }`. */
	ARRANGE_SNAP_CHANGED: 'wp-desktop.arrange.snap.changed',
	/**
	 * Filter on the snap-grid cell size. Receives
	 * `{ cellWidth, cellHeight }` plus a context arg
	 * `{ areaWidth, areaHeight }`. Plugins can return different
	 * dimensions to enforce a Tetris-style fixed grid, a musical
	 * staff aspect, etc. Non-positive returns fall back to the
	 * original.
	 */
	ARRANGE_SNAP_CELL_SIZE: 'wp-desktop.arrange.snap.cell-size',
	/**
	 * Action, fires when the user clicks a plugin-registered entry in
	 * the Arrange admin-bar submenu (items added via the
	 * `desktop_mode_arrange_menu_items` PHP filter). Payload `{ id }`
	 * where `id` is the item's `id` field as registered. Plugins
	 * subscribe here to run their custom arrangement logic.
	 */
	ARRANGE_CUSTOM_ACTION: 'wp-desktop.arrange.custom-action',

	// ------------------------------------------------------------------
	// Snap-zones — Windows-style edge snapping with a split-overview
	// picker to fill the opposite half after commit.
	// ------------------------------------------------------------------
	/**
	 * Action, fires when the drag cursor enters a snap zone and the
	 * shell shows the target-position preview. Payload
	 * `{ windowId, zone: 'left' | 'right' }`.
	 */
	SNAP_ZONE_PENDING: 'wp-desktop.snap.zone-pending',
	/**
	 * Action, fires when the drag cursor leaves the snap zone without
	 * releasing — the preview disappears. Payload `{ windowId }`.
	 */
	SNAP_ZONE_CANCELED: 'wp-desktop.snap.zone-canceled',
	/**
	 * Action, fires once the window has animated into its snapped
	 * bounds. Payload `{ windowId, zone: 'left' | 'right' }`.
	 */
	SNAP_ZONE_COMMITTED: 'wp-desktop.snap.zone-committed',
	/**
	 * Action, fires when a user picks a thumbnail from the split
	 * overview to fill the opposite half. Payload
	 * `{ windowId, zone: 'left' | 'right' }`.
	 */
	SNAP_SPLIT_FILLED: 'wp-desktop.snap.split-filled',

	// ------------------------------------------------------------------
	// Widgets — the right-side column. Widgets paint above the
	// wallpaper but beneath windows. Lifecycle mirrors canvas
	// wallpapers: register via filter, mount/unmount actions bracket
	// each paint, mount-failed fires on sync throws / async rejects.
	// ------------------------------------------------------------------
	/** Filter, receives the widget registry array. */
	WIDGETS: 'wp-desktop.widgets',
	/** Action before a widget mounts. Payload `{ id, container, ctx }`. */
	WIDGET_MOUNTING: 'wp-desktop.widget.mounting',
	/** Action after a widget mounts successfully. Payload `{ id, container, ctx }`. */
	WIDGET_MOUNTED: 'wp-desktop.widget.mounted',
	/** Action before a widget tears down. Payload `{ id }`. */
	WIDGET_UNMOUNTING: 'wp-desktop.widget.unmounting',
	/** Action when a widget's mount throws / rejects. Payload `{ id, error }`. */
	WIDGET_MOUNT_FAILED: 'wp-desktop.widget.mount-failed',
	/** Action when the user adds a widget via the picker. Payload `{ id }`. */
	WIDGET_ADDED: 'wp-desktop.widget.added',
	/** Action when the user removes a widget via the card's × button. Payload `{ id }`. */
	WIDGET_REMOVED: 'wp-desktop.widget.removed',

	// ------------------------------------------------------------------
	// Virtual-desktop ("Spaces") lifecycle actions.
	//
	// Spaces let users group windows into separate workspaces and flip
	// between them from the overview top bar. These hooks expose every
	// state change so plugins can persist per-space state, sync custom
	// indicators, or react to the user's workspace context.
	// ------------------------------------------------------------------
	/** Action, fires when a new desktop is created. Payload `{ desktopId }`. */
	DESKTOP_CREATED: 'wp-desktop.desktop.created',
	/** Action, fires when a desktop is closed. Payload `{ desktopId, migratedTo }`. */
	DESKTOP_CLOSED: 'wp-desktop.desktop.closed',
	/** Action, fires when the active desktop changes. Payload `{ from, to }`. */
	DESKTOP_SWITCHED: 'wp-desktop.desktop.switched',
	/**
	 * Filter. Returns the id of the "primary" desktop — the one the
	 * shell treats as canonical for batch operations. Receives the
	 * default (first desktop's id) and the full `Desktop[]` list.
	 * @since 0.14.0
	 */
	PRIMARY_DESKTOP_ID: 'wp-desktop.primary-desktop-id',

	// ------------------------------------------------------------------
	// Batch window operations.
	// ------------------------------------------------------------------
	/**
	 * Action, fires before {@link WindowManager.closeAll} starts
	 * iterating. Payload `{ candidates: Window[] }` — every window the
	 * shell is about to close (after `exceptIds` was applied).
	 * @since 0.14.0
	 */
	WINDOWS_BEFORE_CLOSE_ALL: 'wp-desktop.windows.before-close-all',
	/**
	 * Filter, runs inside {@link WindowManager.closeAll}. Receives the
	 * candidate `Window[]` list and returns the (possibly trimmed) list
	 * that will actually be closed. Plugins use this to PROTECT specific
	 * windows from a bulk close — e.g. keep the active draft open.
	 * Returning an empty array cancels the close entirely.
	 * @since 0.14.0
	 */
	WINDOWS_CLOSE_ALL: 'wp-desktop.windows.close-all',
	/**
	 * Action, fires after {@link WindowManager.closeAll} has finished.
	 * Payload `{ closed: number, skipped: Window[] }`.
	 * @since 0.14.0
	 */
	WINDOWS_AFTER_CLOSE_ALL: 'wp-desktop.windows.after-close-all',

	// ------------------------------------------------------------------
	// Slash-command lifecycle.
	// ------------------------------------------------------------------
	/**
	 * Filter. Runs immediately before a command's `run()` is invoked.
	 * Receives `{ proceed: true, slug, args, command }` and may return
	 * the same shape with `proceed: false` to cancel the run.
	 * @since 0.14.0
	 */
	COMMAND_BEFORE_RUN: 'wp-desktop.command.before-run',
	/**
	 * Action, fires after a command's `run()` resolves successfully.
	 * Payload `{ slug, args, command, result }`.
	 * @since 0.14.0
	 */
	COMMAND_AFTER_RUN: 'wp-desktop.command.after-run',
	/**
	 * Action, fires when a command's `run()` throws. Payload
	 * `{ slug, args, command, error }`.
	 * @since 0.14.0
	 */
	COMMAND_ERROR: 'wp-desktop.command.error',

	// ------------------------------------------------------------------
	// Shell-level lifecycle actions.
	// ------------------------------------------------------------------
	/**
	 * Action, fires (debounced) after the browser viewport stops
	 * resizing. Payload `{ width, height }` describes the shell's
	 * bounding rect — plugins that render canvas-driven UIs hook here
	 * to adjust their render surface.
	 */
	SHELL_RESIZED: 'wp-desktop.shell.resized',
	/**
	 * Action mirroring `document.visibilitychange` for the shell as a
	 * whole. Payload `{ state: 'visible' | 'hidden' }`. Different from
	 * the wallpaper-specific visibility action in that it fires
	 * regardless of which wallpaper (if any) is active.
	 */
	SHELL_VISIBILITY: 'wp-desktop.shell.visibility',
	/**
	 * Action — fires when a `wp.desktop.connect()` connection
	 * completes its iframe handshake. Payload:
	 * `{ connectionId, targetWindowId, topics }`.
	 *
	 * @since 0.17.0
	 */
	CONNECTION_OPENED: 'wp-desktop.connection.opened',
	/**
	 * Action — fires when a connection tears down. Payload:
	 * `{ connectionId, reason: 'disconnect' | 'window-closed' | 'navigated' }`.
	 *
	 * @since 0.17.0
	 */
	CONNECTION_CLOSED: 'wp-desktop.connection.closed',
	/**
	 * Action — fires for every message routed through a connection.
	 * Payload: `{ connectionId, topic, direction: 'in' | 'out' }`.
	 * Used for debug consoles + traffic auditing; high-volume topics
	 * fire this many times per second, so subscribers should be
	 * cheap.
	 *
	 * @since 0.17.0
	 */
	CONNECTION_MESSAGE: 'wp-desktop.connection.message',
	/**
	 * Filter — fires when an iframe calls
	 * `wp.desktop.iframe.requestConnection()`. Default value is
	 * `true` (accept). Return `false` to reject, or an object
	 * `{ topics: string[] }` to accept while narrowing the topic
	 * list. `$context` carries `{ windowId, requestId, topics }`.
	 *
	 * @since 0.18.0
	 */
	IFRAME_CONNECTION_REQUEST: 'wp-desktop.iframe.connection-request',

	// ------------------------------------------------------------------
	// Responsive / mobile mode (since 0.7.0).
	// ------------------------------------------------------------------
	/**
	 * Action — fires when the responsive mode flips between
	 * `'desktop'`, `'tablet'`, and `'mobile'`. Payload:
	 * `{ from: DesktopMode, to: DesktopMode, viewport: { width: number; height: number } }`.
	 * Plugins that maintain mode-specific UI (a sidebar that should
	 * collapse on phone widths, a toolbar that should reshape) listen
	 * here. The matching `wp-desktop-mode-changed` CustomEvent is
	 * dispatched on `document` with the same detail.
	 *
	 * @since 0.7.0
	 */
	RESPONSIVE_MODE_CHANGED: 'wp-desktop.responsive.mode-changed',
	/**
	 * Filter — gates whether a window may begin a drag session. Fires
	 * at the top of the title-bar pointerdown handler with default
	 * value `true`. Return `false` to suppress drag (used by mobile
	 * mode to make windows non-draggable). `$context` carries
	 * `{ windowId, mode, event }`.
	 *
	 * @since 0.7.0
	 */
	WINDOW_DRAG_ALLOWED: 'wp-desktop.window.drag-allowed',
	/**
	 * Filter — gates whether a window may begin a resize session.
	 * Fires at the top of the resize-handle pointerdown handler with
	 * default value `true`. Return `false` to suppress resize.
	 * `$context` carries `{ windowId, mode, event }`.
	 *
	 * @since 0.7.0
	 */
	WINDOW_RESIZE_ALLOWED: 'wp-desktop.window.resize-allowed',
} as const;

/**
 * Monotonic counter used to build a unique `addAction` namespace for
 * every `whenReady()` call. Using a fixed namespace (as a pre-0.14.0
 * bug did) meant two plugins calling `whenReady()` silently clobbered
 * each other — `wp.hooks.addAction` treats namespace as a de-dup key.
 */
let _whenReadySeq = 0;

/**
 * Convenience: run `cb` after `wp-desktop.init` has fired, either
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
	const ns = `wp-desktop-mode/when-ready-${ ++_whenReadySeq }`;
	addAction( HOOKS.INIT, ns, cb );
}

/**
 * Synchronous check: has the shell finished initialising? Returns true
 * after `wp-desktop.init` has fired, false before. Useful for plugin
 * code that wants to branch without scheduling a callback.
 *
 * ```javascript
 * if ( wp.desktop.isReady() ) {
 *     wp.desktop.registerCommand( { ... } );
 * } else {
 *     wp.desktop.whenReady( () => wp.desktop.registerCommand( { ... } ) );
 * }
 * ```
 *
 * @since 0.14.0
 */
export function isReady(): boolean {
	return didAction( HOOKS.INIT ) > 0;
}
