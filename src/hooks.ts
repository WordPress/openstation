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
	/** Action, fires when iframe title updates change the window title. */
	WINDOW_TITLE_CHANGED: 'wp-desktop.window.title-changed',
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
