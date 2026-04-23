var wpDesktop = function(exports) {
  "use strict";
  function getWpHooks() {
    const hooks = window.wp?.hooks;
    if (!hooks) {
      throw new Error(
        "[wp-desktop-mode] `window.wp.hooks` is not available. The plugin declares `wp-hooks` as a script dependency; if you are seeing this error, verify the enqueue order."
      );
    }
    return hooks;
  }
  function addAction(hookName, namespace, callback, priority) {
    getWpHooks().addAction(
      hookName,
      namespace,
      callback,
      priority
    );
  }
  function removeAction(hookName, namespace) {
    return getWpHooks().removeAction(hookName, namespace);
  }
  function applyFilters(hookName, value, ...args) {
    return getWpHooks().applyFilters(hookName, value, ...args);
  }
  function doAction(hookName, ...args) {
    getWpHooks().doAction(hookName, ...args);
  }
  function didAction(hookName) {
    return getWpHooks().didAction(hookName);
  }
  function rawHooks() {
    return getWpHooks();
  }
  const HOOKS = {
    /** Action, fires once after shell boot; plugins register here. */
    INIT: "wp-desktop.init",
    /** Filter, receives the wallpaper registry array. */
    WALLPAPERS: "wp-desktop.wallpapers",
    /** Action before a canvas wallpaper mounts. */
    WALLPAPER_MOUNTING: "wp-desktop.wallpaper.mounting",
    /** Action after a canvas wallpaper mounts successfully. */
    WALLPAPER_MOUNTED: "wp-desktop.wallpaper.mounted",
    /** Action before a canvas wallpaper tears down. */
    WALLPAPER_UNMOUNTING: "wp-desktop.wallpaper.unmounting",
    /** Action when a canvas wallpaper's mount throws / rejects. */
    WALLPAPER_MOUNT_FAILED: "wp-desktop.wallpaper.mount-failed",
    /** Action mirroring document.visibilitychange for active canvas wallpapers. */
    WALLPAPER_VISIBILITY: "wp-desktop.wallpaper.visibility",
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
    IFRAME_READY: "wp-desktop.iframe.ready",
    IFRAME_ERROR: "wp-desktop.iframe.error",
    /**
     * Action, fires when a `fetch` or `XMLHttpRequest` inside a
     * chromeless iframe completes (success OR failure). Payload: `{
     * windowId: string, method: string, url: string, status: number,
     * duration: number, failed: boolean }`. Subscribers get a faithful
     * view of admin-ajax + REST calls that previously never left the
     * iframe boundary. `status === 0` indicates a network failure with
     * no response received.
     */
    IFRAME_NETWORK_COMPLETED: "wp-desktop.iframe.network-completed",
    /**
     * Action, fires when one of the shell's own try/catch barriers
     * catches an exception. Payload: `{ scope:
     * 'widget-mount' | 'widget-teardown' | 'window-open' | 'wallpaper-mount' |
     * 'wallpaper-teardown' | 'session-save' | 'menu-refresh' | string,
     * id?: string, error: unknown }`. Paired with the existing
     * `console.error` calls — a monitor widget can surface these as
     * first-class entries.
     */
    SHELL_ERROR: "wp-desktop.shell.error",
    /**
     * Filter, applies to a `MonitorEntry` before a monitor widget
     * renders it. Plugins can mutate the entry (rewrite the message,
     * add `extra` fields) or return `null` to suppress it. Used by
     * monitor widgets to converge every plugin on the same shape —
     * see `MonitorEntry` in `src/types.ts`.
     */
    MONITOR_ENTRY: "wp-desktop.monitor.entry",
    /**
     * Filter, applies to the list of "solid" surfaces wallpapers
     * should consider for collision / accumulation effects (snow
     * piling, leaves settling, rain splash). Seeded by the shell
     * with: every visible (non-minimized) window's top edge; the
     * desktop-area floor; the taskbar top when present; the dock's
     * inline edge; and every mounted widget card's top edge.
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
    WALLPAPER_SURFACES: "wp-desktop.wallpaper.surfaces",
    // ------------------------------------------------------------------
    // Window lifecycle actions. All payloads share a `windowId: string`
    // field; additional fields are documented per-hook in the JS
    // reference. These mirror the existing `wp-desktop-window-*`
    // CustomEvents but ship under the hook bus so plugins can use one
    // idiomatic API for everything the shell emits.
    // ------------------------------------------------------------------
    /** Action, fires when a window is added to the stack. */
    WINDOW_OPENED: "wp-desktop.window.opened",
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
    WINDOW_CLOSING: "wp-desktop.window.closing",
    /** Action, fires when a window is removed from the stack. */
    WINDOW_CLOSED: "wp-desktop.window.closed",
    /** Action, fires when focus changes to a different window. */
    WINDOW_FOCUSED: "wp-desktop.window.focused",
    /** Action, fires when a window is minimized. */
    WINDOW_MINIMIZED: "wp-desktop.window.minimized",
    /** Action, fires when a window is restored from minimized. */
    WINDOW_RESTORED: "wp-desktop.window.restored",
    /** Action, fires when a window is maximized (fills desktop area). */
    WINDOW_MAXIMIZED: "wp-desktop.window.maximized",
    /** Action, fires when a window exits maximized state. */
    WINDOW_UNMAXIMIZED: "wp-desktop.window.unmaximized",
    /** Action, fires when a window enters fullscreen / focus mode. */
    WINDOW_FULLSCREEN_ENTERED: "wp-desktop.window.fullscreen-entered",
    /** Action, fires when a window exits fullscreen / focus mode. */
    WINDOW_FULLSCREEN_EXITED: "wp-desktop.window.fullscreen-exited",
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
    WINDOW_BOUNDS_CHANGED: "wp-desktop.window.bounds-changed",
    /** Action, fires at drag-end with the final `{ x, y }` position. */
    WINDOW_MOVED: "wp-desktop.window.moved",
    /** Action, fires at resize-end with the final `{ width, height }`. */
    WINDOW_RESIZED: "wp-desktop.window.resized",
    /** Action, fires when title-bar drag begins. */
    WINDOW_DRAG_START: "wp-desktop.window.drag-start",
    /** Action, fires when title-bar drag ends. Payload mirrors WINDOW_MOVED. */
    WINDOW_DRAG_END: "wp-desktop.window.drag-end",
    /** Action, fires when the resize handle is first pressed. */
    WINDOW_RESIZE_START: "wp-desktop.window.resize-start",
    /** Action, fires when resize completes. Payload mirrors WINDOW_RESIZED. */
    WINDOW_RESIZE_END: "wp-desktop.window.resize-end",
    /** Action, fires when the user "detaches" a window to a classic tab. */
    WINDOW_DETACHED: "wp-desktop.window.detached",
    /** Action, fires when iframe title updates change the window title. */
    WINDOW_TITLE_CHANGED: "wp-desktop.window.title-changed",
    /**
     * Action, fires when a window's body element's dimensions
     * change — mount, user resize, viewport reflow. Payload: `{
     * windowId: string, width: number, height: number }`. Body
     * dimensions exclude the title bar + tab strip, matching what a
     * canvas or layout engine inside the body would measure.
     */
    WINDOW_BODY_RESIZED: "wp-desktop.window.body-resized",
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
    NATIVE_WINDOW_BEFORE_RENDER: "wp-desktop.native-window.before-render",
    /**
     * Action, fires AFTER a native window's `render( body )` callback
     * returns. Payload: `{ windowId, body, config }`. Observability
     * hook — analytics / auto-focus / post-render measurement.
     */
    NATIVE_WINDOW_AFTER_RENDER: "wp-desktop.native-window.after-render",
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
    NATIVE_WINDOW_BEFORE_CLOSE: "wp-desktop.native-window.before-close",
    /**
     * Action, fires when a user clicks a desktop icon (a shortcut
     * tile registered server-side via `wp_register_desktop_icon()`
     * and rendered on the wallpaper). Payload: `{ id: string,
     * target: 'window' | 'url' }`. Fires BEFORE the default open
     * action — plugins cannot cancel the open from this hook, but
     * can use it to track click-throughs or augment behaviour (e.g.
     * play a sound, surface a confirmation toast).
     *
     * @since 0.11.0
     */
    DESKTOP_ICON_CLICKED: "wp-desktop.desktop-icon.clicked",
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
    COMPONENTS_REGISTERED: "wp-desktop.components.registered",
    /**
     * Action, fires after `wp.desktop.registerSystemTile()` inserts
     * a tile into the dock or taskbar. Payload: `{ id: string,
     * placement: 'dock' | 'taskbar' }`. Useful for plugins that
     * want to decorate tiles they didn't register themselves —
     * analytics, theming, per-tile badges.
     */
    DOCK_ITEM_APPENDED: "wp-desktop.dock.item-appended",
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
    OVERVIEW_ENTERING: "wp-desktop.overview.entering",
    /** Action, fires once the overview enter animation has completed. */
    OVERVIEW_ENTERED: "wp-desktop.overview.entered",
    /**
     * Action, fires at the start of the overview-exit animation.
     * Payload: `{ windowId?: string, reason: 'select' | 'cancel' }` —
     * `windowId` set when the user clicked a thumbnail (reason
     * 'select'); omitted when the user pressed Escape or clicked
     * the backdrop (reason 'cancel').
     */
    OVERVIEW_EXITING: "wp-desktop.overview.exiting",
    /** Action, fires once the overview-exit animation has settled. */
    OVERVIEW_EXITED: "wp-desktop.overview.exited",
    /** Action, fires when the cursor enters a thumbnail. Payload `{ windowId }`. */
    OVERVIEW_WINDOW_HOVER: "wp-desktop.overview.window-hover",
    /** Action, fires when the cursor leaves a thumbnail. Payload `{ windowId }`. */
    OVERVIEW_WINDOW_UNHOVER: "wp-desktop.overview.window-unhover",
    /** Action, fires the instant a thumbnail click is registered (before exit + maximize kick in). Payload `{ windowId }`. */
    OVERVIEW_WINDOW_CLICK: "wp-desktop.overview.window-click",
    /** Action, fires before cascade computes + applies new positions. Payload `{ windowCount }`. */
    ARRANGE_CASCADE_STARTING: "wp-desktop.arrange.cascade.starting",
    /** Action, fires after cascade has positioned every window. Payload `{ windowCount }`. */
    ARRANGE_CASCADE_APPLIED: "wp-desktop.arrange.cascade.applied",
    /** Action, fires before tile computes + applies new positions. Payload `{ windowCount, cols, rows }`. */
    ARRANGE_TILE_STARTING: "wp-desktop.arrange.tile.starting",
    /** Action, fires after tile has positioned every window. Payload `{ windowCount, cols, rows }`. */
    ARRANGE_TILE_APPLIED: "wp-desktop.arrange.tile.applied",
    /**
     * Filter on the tile-grid dimensions chosen by the built-in
     * algorithm. Receives `{ cols, rows }` plus a context arg
     * `{ windowCount, areaWidth, areaHeight }`. Plugins can return
     * a different `{ cols, rows }` to enforce a custom layout
     * (fixed-column newsroom, golden-ratio cells, etc.). Returned
     * values are validated — non-positive integers, or a product
     * smaller than `windowCount`, fall back to the original.
     */
    ARRANGE_TILE_DIMENSIONS: "wp-desktop.arrange.tile.dimensions",
    /** Action, fires when snap-to-grid is toggled. Payload `{ enabled }`. */
    ARRANGE_SNAP_CHANGED: "wp-desktop.arrange.snap.changed",
    /**
     * Filter on the snap-grid cell size. Receives
     * `{ cellWidth, cellHeight }` plus a context arg
     * `{ areaWidth, areaHeight }`. Plugins can return different
     * dimensions to enforce a Tetris-style fixed grid, a musical
     * staff aspect, etc. Non-positive returns fall back to the
     * original.
     */
    ARRANGE_SNAP_CELL_SIZE: "wp-desktop.arrange.snap.cell-size",
    /**
     * Action, fires when the user clicks a plugin-registered entry in
     * the Arrange admin-bar submenu (items added via the
     * `wp_desktop_arrange_menu_items` PHP filter). Payload `{ id }`
     * where `id` is the item's `id` field as registered. Plugins
     * subscribe here to run their custom arrangement logic.
     */
    ARRANGE_CUSTOM_ACTION: "wp-desktop.arrange.custom-action",
    // ------------------------------------------------------------------
    // Snap-zones — Windows-style edge snapping with a split-overview
    // picker to fill the opposite half after commit.
    // ------------------------------------------------------------------
    /**
     * Action, fires when the drag cursor enters a snap zone and the
     * shell shows the target-position preview. Payload
     * `{ windowId, zone: 'left' | 'right' }`.
     */
    SNAP_ZONE_PENDING: "wp-desktop.snap.zone-pending",
    /**
     * Action, fires when the drag cursor leaves the snap zone without
     * releasing — the preview disappears. Payload `{ windowId }`.
     */
    SNAP_ZONE_CANCELED: "wp-desktop.snap.zone-canceled",
    /**
     * Action, fires once the window has animated into its snapped
     * bounds. Payload `{ windowId, zone: 'left' | 'right' }`.
     */
    SNAP_ZONE_COMMITTED: "wp-desktop.snap.zone-committed",
    /**
     * Action, fires when a user picks a thumbnail from the split
     * overview to fill the opposite half. Payload
     * `{ windowId, zone: 'left' | 'right' }`.
     */
    SNAP_SPLIT_FILLED: "wp-desktop.snap.split-filled",
    // ------------------------------------------------------------------
    // Widgets — the right-side column. Widgets paint above the
    // wallpaper but beneath windows. Lifecycle mirrors canvas
    // wallpapers: register via filter, mount/unmount actions bracket
    // each paint, mount-failed fires on sync throws / async rejects.
    // ------------------------------------------------------------------
    /** Filter, receives the widget registry array. */
    WIDGETS: "wp-desktop.widgets",
    /** Action before a widget mounts. Payload `{ id, container, ctx }`. */
    WIDGET_MOUNTING: "wp-desktop.widget.mounting",
    /** Action after a widget mounts successfully. Payload `{ id, container, ctx }`. */
    WIDGET_MOUNTED: "wp-desktop.widget.mounted",
    /** Action before a widget tears down. Payload `{ id }`. */
    WIDGET_UNMOUNTING: "wp-desktop.widget.unmounting",
    /** Action when a widget's mount throws / rejects. Payload `{ id, error }`. */
    WIDGET_MOUNT_FAILED: "wp-desktop.widget.mount-failed",
    /** Action when the user adds a widget via the picker. Payload `{ id }`. */
    WIDGET_ADDED: "wp-desktop.widget.added",
    /** Action when the user removes a widget via the card's × button. Payload `{ id }`. */
    WIDGET_REMOVED: "wp-desktop.widget.removed",
    // ------------------------------------------------------------------
    // Virtual-desktop ("Spaces") lifecycle actions.
    //
    // Spaces let users group windows into separate workspaces and flip
    // between them from the overview top bar. These hooks expose every
    // state change so plugins can persist per-space state, sync custom
    // indicators, or react to the user's workspace context.
    // ------------------------------------------------------------------
    /** Action, fires when a new desktop is created. Payload `{ desktopId }`. */
    DESKTOP_CREATED: "wp-desktop.desktop.created",
    /** Action, fires when a desktop is closed. Payload `{ desktopId, migratedTo }`. */
    DESKTOP_CLOSED: "wp-desktop.desktop.closed",
    /** Action, fires when the active desktop changes. Payload `{ from, to }`. */
    DESKTOP_SWITCHED: "wp-desktop.desktop.switched",
    /**
     * Filter. Returns the id of the "primary" desktop — the one the
     * shell treats as canonical for batch operations. Receives the
     * default (first desktop's id) and the full `Desktop[]` list.
     * @since 0.14.0
     */
    PRIMARY_DESKTOP_ID: "wp-desktop.primary-desktop-id",
    // ------------------------------------------------------------------
    // Batch window operations.
    // ------------------------------------------------------------------
    /**
     * Action, fires before {@link WindowManager.closeAll} starts
     * iterating. Payload `{ candidates: Window[] }` — every window the
     * shell is about to close (after `exceptIds` was applied).
     * @since 0.14.0
     */
    WINDOWS_BEFORE_CLOSE_ALL: "wp-desktop.windows.before-close-all",
    /**
     * Filter, runs inside {@link WindowManager.closeAll}. Receives the
     * candidate `Window[]` list and returns the (possibly trimmed) list
     * that will actually be closed. Plugins use this to PROTECT specific
     * windows from a bulk close — e.g. keep the active draft open.
     * Returning an empty array cancels the close entirely.
     * @since 0.14.0
     */
    WINDOWS_CLOSE_ALL: "wp-desktop.windows.close-all",
    /**
     * Action, fires after {@link WindowManager.closeAll} has finished.
     * Payload `{ closed: number, skipped: Window[] }`.
     * @since 0.14.0
     */
    WINDOWS_AFTER_CLOSE_ALL: "wp-desktop.windows.after-close-all",
    // ------------------------------------------------------------------
    // Slash-command lifecycle.
    // ------------------------------------------------------------------
    /**
     * Filter. Runs immediately before a command's `run()` is invoked.
     * Receives `{ proceed: true, slug, args, command }` and may return
     * the same shape with `proceed: false` to cancel the run.
     * @since 0.14.0
     */
    COMMAND_BEFORE_RUN: "wp-desktop.command.before-run",
    /**
     * Action, fires after a command's `run()` resolves successfully.
     * Payload `{ slug, args, command, result }`.
     * @since 0.14.0
     */
    COMMAND_AFTER_RUN: "wp-desktop.command.after-run",
    /**
     * Action, fires when a command's `run()` throws. Payload
     * `{ slug, args, command, error }`.
     * @since 0.14.0
     */
    COMMAND_ERROR: "wp-desktop.command.error",
    // ------------------------------------------------------------------
    // Shell-level lifecycle actions.
    // ------------------------------------------------------------------
    /**
     * Action, fires (debounced) after the browser viewport stops
     * resizing. Payload `{ width, height }` describes the shell's
     * bounding rect — plugins that render canvas-driven UIs hook here
     * to adjust their render surface.
     */
    SHELL_RESIZED: "wp-desktop.shell.resized",
    /**
     * Action mirroring `document.visibilitychange` for the shell as a
     * whole. Payload `{ state: 'visible' | 'hidden' }`. Different from
     * the wallpaper-specific visibility action in that it fires
     * regardless of which wallpaper (if any) is active.
     */
    SHELL_VISIBILITY: "wp-desktop.shell.visibility"
  };
  let _whenReadySeq = 0;
  function whenReady(cb) {
    if (didAction(HOOKS.INIT) > 0) {
      Promise.resolve().then(cb);
      return;
    }
    const ns = `wp-desktop-mode/when-ready-${++_whenReadySeq}`;
    addAction(HOOKS.INIT, ns, cb);
  }
  function isReady() {
    return didAction(HOOKS.INIT) > 0;
  }
  const TEXT_DOMAIN = "wp-desktop-mode";
  function i18n() {
    return window.wp?.i18n;
  }
  function __(text, domain = TEXT_DOMAIN) {
    return i18n()?.__(text, domain) ?? text;
  }
  function _n(single, plural, number, domain = TEXT_DOMAIN) {
    return i18n()?._n(single, plural, number, domain) ?? (number === 1 ? single : plural);
  }
  function sprintf(format, ...args) {
    const impl = i18n()?.sprintf;
    if (impl) {
      return impl(format, ...args);
    }
    let i = 0;
    return format.replace(/%[sd]/g, () => String(args[i++] ?? ""));
  }
  function html(strings, ...values) {
    return { __wpdHtml: true, strings, values };
  }
  function isTemplateResult(v) {
    return !!v && v.__wpdHtml === true;
  }
  const MARKER_PREFIX = "$$wpd$$";
  const MARKER_RE = /\$\$wpd\$\$(\d+)\$\$/g;
  function joinWithMarkers(strings) {
    let out = strings[0];
    for (let i = 1; i < strings.length; i++) {
      out += `${MARKER_PREFIX}${i - 1}$$` + strings[i];
    }
    return out;
  }
  const compiledCache = /* @__PURE__ */ new WeakMap();
  function compile(strings) {
    const cached = compiledCache.get(strings);
    if (cached) {
      return cached;
    }
    const template = document.createElement("template");
    template.innerHTML = joinWithMarkers(strings);
    const recipes = [];
    const walk = (node, path) => {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node;
        for (const attr of Array.from(el.attributes)) {
          const rawName = attr.name;
          const rawValue = attr.value;
          const prefix = rawName[0];
          if (MARKER_RE.test(rawValue)) {
            MARKER_RE.lastIndex = 0;
            if (prefix === "@") {
              const match = MARKER_RE.exec(rawValue);
              MARKER_RE.lastIndex = 0;
              recipes.push({
                path,
                kind: "event",
                name: rawName.slice(1),
                valueIndex: match ? Number(match[1]) : 0
              });
              el.removeAttribute(rawName);
            } else if (prefix === ".") {
              const match = MARKER_RE.exec(rawValue);
              MARKER_RE.lastIndex = 0;
              recipes.push({
                path,
                kind: "prop",
                name: rawName.slice(1),
                valueIndex: match ? Number(match[1]) : 0
              });
              el.removeAttribute(rawName);
            } else if (prefix === "?") {
              const match = MARKER_RE.exec(rawValue);
              MARKER_RE.lastIndex = 0;
              recipes.push({
                path,
                kind: "bool",
                name: rawName.slice(1),
                valueIndex: match ? Number(match[1]) : 0
              });
              el.removeAttribute(rawName);
            } else {
              const fragments = [];
              const indices = [];
              let lastEnd = 0;
              let m;
              MARKER_RE.lastIndex = 0;
              while ((m = MARKER_RE.exec(rawValue)) !== null) {
                fragments.push(rawValue.slice(lastEnd, m.index));
                indices.push(Number(m[1]));
                lastEnd = m.index + m[0].length;
              }
              fragments.push(rawValue.slice(lastEnd));
              recipes.push({
                path,
                kind: "attr",
                name: rawName,
                template: fragments,
                valueIndices: indices
              });
              el.setAttribute(rawName, "");
            }
          }
        }
      }
      const children = Array.from(node.childNodes);
      let shift = 0;
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        const liveIndex = i + shift;
        if (child.nodeType === Node.TEXT_NODE) {
          const text = child.textContent || "";
          if (!MARKER_RE.test(text)) {
            MARKER_RE.lastIndex = 0;
            continue;
          }
          MARKER_RE.lastIndex = 0;
          const parent = child.parentNode;
          let lastEnd = 0;
          let m;
          const newNodes = [];
          const newRecipes = [];
          MARKER_RE.lastIndex = 0;
          while ((m = MARKER_RE.exec(text)) !== null) {
            if (m.index > lastEnd) {
              newNodes.push(document.createTextNode(text.slice(lastEnd, m.index)));
            }
            const placeholder = document.createTextNode("");
            newNodes.push(placeholder);
            newRecipes.push({
              path: [...path, liveIndex + newNodes.length - 1],
              kind: "node",
              valueIndex: Number(m[1])
            });
            lastEnd = m.index + m[0].length;
          }
          if (lastEnd < text.length) {
            newNodes.push(document.createTextNode(text.slice(lastEnd)));
          }
          for (const nn of newNodes) {
            parent.insertBefore(nn, child);
          }
          parent.removeChild(child);
          shift += newNodes.length - 1;
          recipes.push(...newRecipes);
        } else {
          walk(child, [...path, liveIndex]);
        }
      }
    };
    walk(template.content, []);
    const buildParts = (fragment) => {
      const out = [];
      for (const r of recipes) {
        let node = fragment;
        for (const idx of r.path) {
          node = node.childNodes[idx];
        }
        if (r.kind === "node") {
          out.push({
            kind: "node",
            valueIndex: r.valueIndex,
            child: {
              anchor: node,
              state: null
            }
          });
        } else if (r.kind === "attr") {
          out.push({
            kind: "attr",
            element: node,
            name: r.name,
            template: r.template,
            valueIndices: r.valueIndices
          });
        } else if (r.kind === "event") {
          out.push({
            kind: "event",
            valueIndex: r.valueIndex,
            element: node,
            name: r.name
          });
        } else if (r.kind === "prop") {
          out.push({
            kind: "prop",
            valueIndex: r.valueIndex,
            element: node,
            name: r.name
          });
        } else if (r.kind === "bool") {
          out.push({
            kind: "bool",
            valueIndex: r.valueIndex,
            element: node,
            name: r.name
          });
        }
      }
      return out;
    };
    const entry = { template, buildParts };
    compiledCache.set(strings, entry);
    return entry;
  }
  const mountState = /* @__PURE__ */ new WeakMap();
  function render(result, container) {
    const existing = mountState.get(container);
    if (existing && existing.strings === result.strings) {
      applyValues(existing.parts, result.values);
      return;
    }
    const compiled = compile(result.strings);
    const fragment = compiled.template.content.cloneNode(true);
    const parts = compiled.buildParts(fragment);
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }
    container.appendChild(fragment);
    applyValues(parts, result.values);
    mountState.set(container, { strings: result.strings, parts });
  }
  function applyValues(parts, values) {
    for (const part of parts) {
      if (part.kind === "node") {
        updateChildPart(part.child, values[part.valueIndex]);
      } else if (part.kind === "attr") {
        let composed = part.template[0];
        for (let i = 0; i < part.valueIndices.length; i++) {
          composed += formatText(values[part.valueIndices[i]]);
          composed += part.template[i + 1];
        }
        if (composed !== part.last) {
          part.last = composed;
          if (composed === "") {
            part.element.removeAttribute(part.name);
          } else {
            part.element.setAttribute(part.name, composed);
          }
        }
      } else if (part.kind === "event") {
        const next = values[part.valueIndex];
        if (next !== part.current) {
          if (part.current) {
            part.element.removeEventListener(part.name, part.current);
          }
          if (next) {
            part.element.addEventListener(part.name, next);
          }
          part.current = next;
        }
      } else if (part.kind === "prop") {
        const next = values[part.valueIndex];
        if (next !== part.last) {
          part.last = next;
          part.element[part.name] = next;
        }
      } else if (part.kind === "bool") {
        const next = !!values[part.valueIndex];
        if (next !== part.last) {
          part.last = next;
          if (next) {
            part.element.setAttribute(part.name, "");
          } else {
            part.element.removeAttribute(part.name);
          }
        }
      }
    }
  }
  function updateChildPart(child, value) {
    if (value === null || value === void 0 || value === false) {
      if (child.state) {
        disposeChildState(child.state);
        child.state = null;
      }
      return;
    }
    if (Array.isArray(value)) {
      updateArrayChild(child, value);
      return;
    }
    if (isTemplateResult(value)) {
      updateTemplateChild(child, value);
      return;
    }
    if (value instanceof Node) {
      updateNodeChild(child, value);
      return;
    }
    updateTextChild(child, formatText(value));
  }
  function updateNodeChild(child, node) {
    const old = child.state;
    if (old?.shape === "node" && old.node === node) {
      return;
    }
    if (old) {
      disposeChildState(old);
    }
    insertBeforeAnchor(child, [node]);
    child.state = { shape: "node", node };
  }
  function updateTextChild(child, text) {
    const old = child.state;
    if (old?.shape === "text") {
      if (old.text !== text) {
        old.node.textContent = text;
        old.text = text;
      }
      return;
    }
    if (old) {
      disposeChildState(old);
    }
    const node = document.createTextNode(text);
    insertBeforeAnchor(child, [node]);
    child.state = { shape: "text", node, text };
  }
  function updateTemplateChild(child, result) {
    const old = child.state;
    if (old?.shape === "template" && old.strings === result.strings) {
      applyValues(old.parts, result.values);
      return;
    }
    if (old) {
      disposeChildState(old);
    }
    const compiled = compile(result.strings);
    const fragment = compiled.template.content.cloneNode(true);
    const parts = compiled.buildParts(fragment);
    const topNodes = Array.from(fragment.childNodes);
    insertBeforeAnchor(child, [fragment]);
    applyValues(parts, result.values);
    child.state = {
      shape: "template",
      strings: result.strings,
      parts,
      nodes: topNodes
    };
  }
  function updateArrayChild(child, arr) {
    const old = child.state;
    if (old?.shape === "array" && old.entries.length === arr.length) {
      for (let i = 0; i < arr.length; i++) {
        updateChildPart(old.entries[i], arr[i]);
      }
      return;
    }
    if (old) {
      disposeChildState(old);
    }
    const entries = [];
    for (const v of arr) {
      const entryAnchor = document.createTextNode("");
      insertBeforeAnchor(child, [entryAnchor]);
      const entry = { anchor: entryAnchor, state: null };
      updateChildPart(entry, v);
      entries.push(entry);
    }
    child.state = { shape: "array", entries };
  }
  function insertBeforeAnchor(child, nodes) {
    const parent = child.anchor.parentNode;
    if (!parent) {
      return;
    }
    for (const node of nodes) {
      parent.insertBefore(node, child.anchor);
    }
  }
  function disposeChildState(state) {
    if (state.shape === "text") {
      state.node.remove();
      return;
    }
    if (state.shape === "template") {
      for (const node of state.nodes) {
        if (node.parentNode) {
          node.parentNode.removeChild(node);
        }
      }
      return;
    }
    if (state.shape === "node") {
      if (state.node.parentNode) {
        state.node.parentNode.removeChild(state.node);
      }
      return;
    }
    for (const entry of state.entries) {
      if (entry.state) {
        disposeChildState(entry.state);
      }
      entry.anchor.remove();
    }
  }
  function formatText(v) {
    if (v === null || v === void 0 || v === false) {
      return "";
    }
    return String(v);
  }
  const _Component = class _Component extends HTMLElement {
    constructor() {
      super();
      this._renderScheduled = false;
      this._propValues = {};
      const ctor = this.constructor;
      if (ctor.shadow) {
        this.attachShadow({ mode: "open" });
        this._renderRoot = this.shadowRoot;
      } else {
        this._renderRoot = this;
      }
      this._installPropAccessors();
    }
    static get observedAttributes() {
      return this.props.map(kebab);
    }
    connectedCallback() {
      this._adoptStyles();
      this._scheduleRender();
    }
    attributeChangedCallback(name, oldValue, newValue) {
      if (oldValue === newValue) {
        return;
      }
      const prop = camel(name);
      this._propValues[prop] = newValue;
      this._scheduleRender();
    }
    /**
     * Declarative class-name setter. Assign an array (or a
     * space-separated string) and the host's `class` attribute is
     * rewritten to match. Intended for programmatic styling — when
     * a plugin has enqueued its own stylesheet and wants to apply
     * one of those classes to a shell component:
     *
     * ```js
     * element.classNames = [ 'my-plugin-brand', 'is-active' ];
     * // → <wpd-select class="my-plugin-brand is-active">
     * ```
     *
     * The plain HTML `class="…"` attribute works just the same and
     * is always preferred when writing markup by hand — this setter
     * exists for the JS-API case where the caller has an array of
     * conditional classes in hand.
     *
     * Getter returns the current `classList` as a plain array for
     * symmetric read/write.
     *
     * @since 0.13.0
     */
    get classNames() {
      return Array.from(this.classList);
    }
    set classNames(next) {
      if (next === null || next === void 0) {
        this.removeAttribute("class");
        return;
      }
      const list = Array.isArray(next) ? next : String(next).split(/\s+/);
      const cleaned = list.map((s) => String(s).trim()).filter((s) => s !== "");
      this.className = cleaned.join(" ");
    }
    /**
     * Request a re-render explicitly. Components rarely need this —
     * declare state via props + attribute observers and the render
     * loop picks up changes automatically.
     */
    requestUpdate() {
      this._scheduleRender();
    }
    /**
     * Dispatch a `CustomEvent` with a `detail`. Bubbles + composed
     * by default (matches typical WC UX — events cross shadow
     * boundaries, parents can listen without knowing about internal
     * structure).
     */
    emit(name, detail) {
      return this.dispatchEvent(
        new CustomEvent(name, {
          detail,
          bubbles: true,
          composed: true
        })
      );
    }
    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------
    /**
     * Wire every `static props` entry to a matched property getter +
     * setter on the element. Setting the property reflects into the
     * attribute (so downstream observers + CSS selectors see it);
     * reading the property falls back to the attribute.
     */
    _installPropAccessors() {
      const ctor = this.constructor;
      for (const prop of ctor.props) {
        if (Object.getOwnPropertyDescriptor(this, prop)) {
          continue;
        }
        const attr = kebab(prop);
        Object.defineProperty(this, prop, {
          get: () => {
            if (prop in this._propValues) {
              return this._propValues[prop];
            }
            return this.getAttribute(attr);
          },
          set: (value) => {
            const str = value === null || value === void 0 ? null : String(value);
            this._propValues[prop] = str;
            if (str === null) {
              this.removeAttribute(attr);
            } else {
              this.setAttribute(attr, str);
            }
            this._scheduleRender();
          },
          enumerable: true,
          configurable: true
        });
      }
    }
    /**
     * Schedule a render on the next microtask. Multiple property
     * assignments in the same tick collapse into a single render.
     */
    _scheduleRender() {
      if (this._renderScheduled || !this.isConnected) {
        return;
      }
      this._renderScheduled = true;
      queueMicrotask(() => {
        this._renderScheduled = false;
        if (!this.isConnected) {
          return;
        }
        render(this.render(), this._renderRoot);
      });
    }
    /**
     * Mount adoptable stylesheets onto the shadow root (via
     * `adoptedStyleSheets`) or the light DOM (via one `<style>`
     * tag per def). No-op if `static styles` is empty.
     */
    _adoptStyles() {
      const ctor = this.constructor;
      if (ctor.styles.length === 0) {
        return;
      }
      if (ctor.shadow && this.shadowRoot) {
        const sheets = ctor.styles.map((s) => s.sheet).filter((s) => s !== null);
        this.shadowRoot.adoptedStyleSheets = sheets;
        if (sheets.length !== ctor.styles.length) {
          for (const s of ctor.styles) {
            if (!s.sheet) {
              const tag = document.createElement("style");
              tag.textContent = s.cssText;
              this.shadowRoot.appendChild(tag);
            }
          }
        }
      } else {
        this._adoptLightStyles(ctor);
      }
    }
    _adoptLightStyles(ctor) {
      if (_Component._lightStylesAdopted.has(ctor)) {
        return;
      }
      _Component._lightStylesAdopted.add(ctor);
      for (const s of ctor.styles) {
        const tag = document.createElement("style");
        tag.dataset.wpdUi = this.tagName.toLowerCase();
        tag.textContent = s.cssText;
        document.head.appendChild(tag);
      }
    }
  };
  _Component.props = [];
  _Component.styles = [];
  _Component.shadow = true;
  _Component._lightStylesAdopted = /* @__PURE__ */ new WeakSet();
  let Component = _Component;
  function defineComponent(tag, ctor) {
    if (customElements.get(tag)) {
      return;
    }
    customElements.define(tag, ctor);
  }
  function kebab(s) {
    return s.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
  }
  function camel(s) {
    return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  }
  const SUPPORTS_CONSTRUCTABLE_SHEETS = (() => {
    try {
      const s = new CSSStyleSheet();
      return typeof s.replaceSync === "function";
    } catch {
      return false;
    }
  })();
  function css(strings, ...values) {
    let text = strings[0];
    for (let i = 1; i < strings.length; i++) {
      const v = values[i - 1];
      if (typeof v === "string" || typeof v === "number") {
        text += String(v);
      } else if (v && v.__wpdCss) {
        text += v.cssText;
      } else {
        throw new TypeError(
          "[wpd-ui] css`` interpolations must be strings, numbers, or other css`` results. Got: " + typeof v
        );
      }
      text += strings[i];
    }
    if (SUPPORTS_CONSTRUCTABLE_SHEETS) {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(text);
      return { __wpdCss: true, sheet, cssText: text };
    }
    return { __wpdCss: true, sheet: null, cssText: text };
  }
  function computeAutoId(element) {
    const parts = [];
    const tabs = [];
    let windowId = null;
    let node = element.parentElement;
    while (node) {
      if (node === document.body || node === document.documentElement) {
        break;
      }
      const id = node.id || "";
      if (id.startsWith("wp-window-")) {
        windowId = id.slice("wp-window-".length);
        break;
      }
      if (node.tagName.toLowerCase() === "wpd-tabpanel") {
        const forValue = node.getAttribute("for");
        if (forValue) {
          tabs.unshift(forValue);
        }
      }
      node = node.parentElement;
    }
    if (windowId) {
      parts.push(slugify$1(windowId));
    }
    for (const tab of tabs) {
      parts.push("tab-" + slugify$1(tab));
    }
    const label = element.getAttribute("label");
    if (label) {
      parts.push(slugify$1(label));
    }
    if (parts.length === 0) {
      return "wpd-unnamed";
    }
    return "wpd-" + parts.filter((p) => p !== "").join("-");
  }
  function slugify$1(s) {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }
  function ensureAutoId(element) {
    if (element.id) {
      return element.id;
    }
    const id = computeAutoId(element);
    element.id = id;
    return id;
  }
  const styles$j = css`
	:host {
		display: inline-flex;
	}
	button {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		padding: 0;
		border: none;
		border-radius: 5px;
		background: transparent;
		color: var( --wpd-btn-color, currentColor );
		cursor: pointer;
		transition: background-color 0.15s ease, color 0.15s ease;
	}
	button:hover {
		color: var( --wpd-btn-color-hover, currentColor );
		background: var( --wpd-btn-bg-hover, rgba( 0, 0, 0, 0.06 ) );
	}
	button:focus-visible {
		color: var( --wpd-btn-color-hover, currentColor );
		background: var( --wpd-btn-bg-hover, rgba( 0, 0, 0, 0.06 ) );
		outline: 2px solid var( --wpd-btn-outline, currentColor );
		outline-offset: 1px;
	}
	:host( [ active ] ) button {
		color: var( --wpd-btn-color-hover, currentColor );
		background: var( --wpd-btn-bg-active, rgba( 0, 0, 0, 0.08 ) );
	}
	:host( [ danger ] ) button:hover {
		color: #fff;
		background: var( --wpd-btn-danger-hover, #d63638 );
	}
	svg {
		display: block;
		pointer-events: none;
		flex-shrink: 0;
	}
`;
  const ICONS$1 = {
    minimize: '<path d="M3 6h6" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>',
    maximize: '<rect x="3" y="3" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.25" fill="none"/>',
    fullscreen: '<path d="M4.5 2H2v2.5M10 4.5V2H7.5M4.5 10H2V7.5M10 7.5V10H7.5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
    "fullscreen-exit": '<path d="M2 4.5H4.5V2M7.5 2V4.5H10M2 7.5H4.5V10M7.5 10V7.5H10" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
    detach: '<path d="M5 2H2.5v7.5H10V7M6.5 2H10v3.5M10 2L5.5 6.5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
    close: '<path d="M3.25 3.25l5.5 5.5M3.25 8.75l5.5-5.5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>',
    menu: '<circle cx="3" cy="6" r="1.2" fill="currentColor"/><circle cx="6" cy="6" r="1.2" fill="currentColor"/><circle cx="9" cy="6" r="1.2" fill="currentColor"/>'
  };
  const _WpdWindowButton = class _WpdWindowButton extends Component {
    render() {
      const iconKey = this.icon || "";
      const svgInner = ICONS$1[iconKey] || "";
      return html`
			<button type="button">
				<svg
					width="14"
					height="14"
					viewBox="0 0 12 12"
					aria-hidden="true"
					focusable="false"
				></svg>
				<slot></slot>
			</button>
			<span data-svg-buffer style="display:none">${svgInner}</span>
		`;
    }
    /**
     * After each render, copy the raw SVG markup into the actual
     * `<svg>` element. The templater only writes text into slots,
     * so we stash the intended markup in a hidden buffer and
     * `innerHTML = ` the svg once here — a one-shot post-render
     * hook that keeps the declarative template honest.
     */
    connectedCallback() {
      super.connectedCallback();
      queueMicrotask(() => this._paintSvg());
    }
    attributeChangedCallback(name, oldValue, newValue) {
      super.attributeChangedCallback(name, oldValue, newValue);
      queueMicrotask(() => this._paintSvg());
    }
    _paintSvg() {
      const root = this.shadowRoot;
      if (!root) {
        return;
      }
      const svg = root.querySelector("svg");
      const buffer = root.querySelector("[data-svg-buffer]");
      if (svg && buffer) {
        const markup = buffer.textContent || "";
        if (svg.innerHTML !== markup) {
          svg.innerHTML = markup;
        }
      }
    }
  };
  _WpdWindowButton.props = ["icon", "active", "danger"];
  _WpdWindowButton.styles = [styles$j];
  let WpdWindowButton = _WpdWindowButton;
  defineComponent("wpd-window-button", WpdWindowButton);
  const menuStyles = css`
	:host {
		display: block;
		min-width: 220px;
		padding: 4px;
		background: var( --wp-desktop-window-bg, #fff );
		color: var( --wp-desktop-text, #1d2327 );
		border: 1px solid var( --wp-desktop-window-border, #c3c4c7 );
		border-radius: 8px;
		box-shadow: 0 8px 24px rgba( 0, 0, 0, 0.18 ),
			0 2px 6px rgba( 0, 0, 0, 0.08 );
	}
	:host( [ hidden ] ) {
		display: none;
	}
`;
  const menuItemStyles = css`
	:host {
		display: block;
	}
	button {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		min-height: 32px;
		padding: 6px 10px;
		border: none;
		border-radius: 6px;
		background: transparent;
		color: inherit;
		font: inherit;
		font-size: 13px;
		line-height: 1.3;
		text-align: start;
		cursor: pointer;
		transition: background-color 0.12s ease, color 0.12s ease;
	}
	button:hover,
	button:focus-visible {
		background: rgba( 0, 0, 0, 0.06 );
		color: #000;
		outline: none;
	}
	button:focus-visible {
		outline: 2px solid var( --wp-admin-theme-color, #2271b1 );
		outline-offset: -2px;
	}
	.wpd-menu-item__icon {
		flex-shrink: 0;
		width: 18px;
		height: 18px;
		font-size: 18px;
		line-height: 1;
		color: var( --wp-admin-theme-color, #2271b1 );
	}
	.wpd-menu-item__icon[ hidden ] {
		display: none;
	}
	.wpd-menu-item__label {
		flex: 1;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	/*
	 * Check indicator for role="menuitemcheckbox" variants. Small
	 * 16 px square so unchecked items align with icon-bearing items.
	 */
	.wpd-menu-item__check {
		flex-shrink: 0;
		width: 16px;
		height: 16px;
		border-radius: 3px;
		border: 1.5px solid rgba( 0, 0, 0, 0.25 );
		position: relative;
		background: transparent;
		transition: background-color 0.12s ease, border-color 0.12s ease;
	}
	.wpd-menu-item__check[ hidden ] {
		display: none;
	}
	:host( [ checked ] ) .wpd-menu-item__check {
		background: var( --wp-admin-theme-color, #2271b1 );
		border-color: var( --wp-admin-theme-color, #2271b1 );
	}
	:host( [ checked ] ) .wpd-menu-item__check::after {
		content: '';
		position: absolute;
		top: 1px;
		left: 4px;
		width: 4px;
		height: 8px;
		border: solid #fff;
		border-width: 0 2px 2px 0;
		transform: rotate( 45deg );
	}
`;
  const _WpdMenu = class _WpdMenu extends Component {
    connectedCallback() {
      super.connectedCallback();
      this.setAttribute("role", "menu");
    }
    render() {
      return html`<slot></slot>`;
    }
  };
  _WpdMenu.styles = [menuStyles];
  let WpdMenu = _WpdMenu;
  defineComponent("wpd-menu", WpdMenu);
  const _WpdMenuItem = class _WpdMenuItem extends Component {
    connectedCallback() {
      super.connectedCallback();
      if (!this.hasAttribute("role")) {
        this.setAttribute("role", "menuitem");
      }
    }
    render() {
      const icon = this.icon || "";
      const isCheckbox = this.getAttribute("role") === "menuitemcheckbox";
      const checked = this.checked !== null;
      if (isCheckbox) {
        this.setAttribute("aria-checked", checked ? "true" : "false");
      }
      return html`
			<button type="button" @click=${(e) => this._onPick(e)}>
				<span
					class="wpd-menu-item__check"
					?hidden=${!isCheckbox}
				></span>
				<span
					class="wpd-menu-item__icon dashicons ${icon}"
					aria-hidden="true"
					?hidden=${isCheckbox || !icon}
				></span>
				<span class="wpd-menu-item__label">
					<slot></slot>
				</span>
			</button>
		`;
    }
    _onPick(e) {
      e.preventDefault();
      this.emit("wpd-menu-item-click", {
        value: this.value
      });
    }
  };
  _WpdMenuItem.props = ["icon", "value", "checked"];
  _WpdMenuItem.styles = [menuItemStyles];
  let WpdMenuItem = _WpdMenuItem;
  defineComponent("wpd-menu-item", WpdMenuItem);
  const styles$i = css`
	:host {
		display: inline-flex;
	}
	button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		padding: 0;
		border: none;
		border-radius: 4px;
		background: transparent;
		color: rgba( 0, 0, 0, 0.45 );
		cursor: pointer;
		transition: background-color 0.15s ease, color 0.15s ease,
			transform 0.12s ease;
	}
	/* Detach (lift + soft accent wash) */
	:host( [ variant='detach' ] ) button:hover {
		color: var( --wp-admin-theme-color, #2271b1 );
		background: rgba( 34, 113, 177, 0.12 );
		transform: translateY( -1px );
	}
	:host( [ variant='detach' ] ) button:focus-visible {
		outline: 2px solid var( --wp-admin-theme-color, #2271b1 );
		outline-offset: 1px;
	}
	/* Close (red destructive wash) */
	:host( [ variant='close' ] ) button:hover {
		color: #fff;
		background: #d63638;
	}
	:host( [ variant='close' ] ) button:focus-visible {
		color: #fff;
		background: #d63638;
		outline: 2px solid rgba( 214, 54, 56, 0.6 );
		outline-offset: 1px;
	}
	svg {
		display: block;
		pointer-events: none;
		width: 12px;
		height: 12px;
	}
	@media ( prefers-reduced-motion: reduce ) {
		button {
			transition-duration: 0.01ms;
		}
		:host( [ variant='detach' ] ) button:hover {
			transform: none;
		}
	}
`;
  const ICONS = {
    detach: '<path d="M5 2H2.5v7.5H10V7M6.5 2H10v3.5M10 2L5.5 6.5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
    close: '<path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>'
  };
  const _WpdTabChip = class _WpdTabChip extends Component {
    render() {
      const variant = this.variant || "";
      const svgInner = ICONS[variant] || "";
      return html`
			<button type="button">
				<svg
					viewBox="0 0 12 12"
					aria-hidden="true"
					focusable="false"
				></svg>
				<slot></slot>
			</button>
			<span data-svg-buffer style="display:none">${svgInner}</span>
		`;
    }
    connectedCallback() {
      super.connectedCallback();
      queueMicrotask(() => this._paintSvg());
    }
    attributeChangedCallback(name, oldValue, newValue) {
      super.attributeChangedCallback(name, oldValue, newValue);
      queueMicrotask(() => this._paintSvg());
    }
    _paintSvg() {
      const root = this.shadowRoot;
      if (!root) {
        return;
      }
      const svg = root.querySelector("svg");
      const buffer = root.querySelector("[data-svg-buffer]");
      if (svg && buffer) {
        const markup = buffer.textContent || "";
        if (svg.innerHTML !== markup) {
          svg.innerHTML = markup;
        }
      }
    }
  };
  _WpdTabChip.props = ["variant"];
  _WpdTabChip.styles = [styles$i];
  let WpdTabChip = _WpdTabChip;
  defineComponent("wpd-tab-chip", WpdTabChip);
  const IDENTITY_PARAMS = ["post_type", "page", "taxonomy"];
  function slugify(path) {
    return path.replace(/\.php/g, "-php").replace(/[?&=]/g, "-").replace(/[^a-zA-Z0-9_-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "") || "index";
  }
  function deriveWindowId(url, adminUrl) {
    let parsed = null;
    try {
      parsed = new URL(url, adminUrl);
    } catch (err) {
      parsed = null;
    }
    if (parsed) {
      const basePath = new URL(adminUrl).pathname;
      const filename = parsed.pathname.replace(basePath, "").replace(/^\/+/, "");
      const significant = new URLSearchParams();
      for (const key of IDENTITY_PARAMS) {
        const value = parsed.searchParams.get(key);
        if (value) {
          significant.set(key, value);
        }
      }
      const query = significant.toString();
      return slugify(query ? `${filename}?${query}` : filename);
    }
    let path = url.replace(adminUrl, "");
    if (path.startsWith("/")) {
      path = path.substring(1);
    }
    return slugify(path);
  }
  function sanitizeClassName(value) {
    return value.replace(/[^a-zA-Z0-9_-]/g, "");
  }
  function urlMatchKey(url) {
    try {
      const parsed = new URL(url, window.location.origin);
      parsed.searchParams.delete("wp_desktop");
      parsed.searchParams.delete("wp_desktop_portal");
      return parsed.pathname.replace(/\/+$/, "") + "?" + parsed.searchParams.toString();
    } catch {
      return url;
    }
  }
  const INITIAL_ORIGIN$3 = window.location.origin;
  function withChromelessParam(url) {
    const parsed = new URL(url, INITIAL_ORIGIN$3);
    if (parsed.origin !== INITIAL_ORIGIN$3) {
      return null;
    }
    parsed.searchParams.set("wp_desktop", "1");
    return parsed.toString();
  }
  function updateFullscreenBodyClass() {
    const hasFullscreen = document.querySelectorAll(".wp-desktop-window--fullscreen").length > 0;
    document.body.classList.toggle("wp-desktop-has-fullscreen-window", hasFullscreen);
  }
  function createControlButton(variant, label, icon) {
    const btn = document.createElement("wpd-window-button");
    btn.setAttribute("icon", icon);
    btn.setAttribute("aria-label", label);
    btn.classList.add("wp-desktop-window__btn");
    btn.classList.add(`wp-desktop-window__btn--${variant}`);
    if (variant === "close") {
      btn.setAttribute("danger", "");
    }
    return btn;
  }
  function createWindowElement(config) {
    const el = document.createElement("div");
    el.className = "wp-desktop-window";
    if (config.native) {
      el.classList.add("wp-desktop-window--native");
    }
    el.id = `wp-window-${config.id}`;
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-labelledby", `wp-window-title-${config.id}`);
    el.style.left = `${config.x}px`;
    el.style.top = `${config.y}px`;
    el.style.width = `${config.width}px`;
    el.style.height = `${config.height}px`;
    const titleBar = document.createElement("div");
    titleBar.className = "wp-desktop-window__titlebar";
    let menuBtn = null;
    let menuPanel = null;
    if (!config.native) {
      menuBtn = document.createElement("wpd-window-button");
      menuBtn.setAttribute("icon", "menu");
      menuBtn.setAttribute("aria-label", __("Window actions"));
      menuBtn.setAttribute("aria-haspopup", "menu");
      menuBtn.setAttribute("aria-expanded", "false");
      menuBtn.classList.add("wp-desktop-window__btn");
      menuBtn.classList.add("wp-desktop-window__menu-btn");
      menuPanel = document.createElement("wpd-menu");
      menuPanel.classList.add("wp-desktop-window__menu-panel");
      menuPanel.hidden = true;
      const startup = document.createElement("wpd-menu-item");
      startup.setAttribute("role", "menuitemcheckbox");
      startup.setAttribute("value", "startup");
      startup.classList.add("wp-desktop-window__menu-item");
      startup.classList.add("wp-desktop-window__menu-item--startup");
      startup.textContent = __("Open on startup");
      menuPanel.appendChild(startup);
      if (config.multi) {
        const openAnother = document.createElement("wpd-menu-item");
        openAnother.setAttribute("role", "menuitem");
        openAnother.setAttribute("value", "open-another");
        openAnother.setAttribute("icon", "dashicons-plus-alt2");
        openAnother.classList.add("wp-desktop-window__menu-item");
        openAnother.classList.add(
          "wp-desktop-window__menu-item--open-another"
        );
        openAnother.textContent = sprintf(
          // translators: %s is the window's admin-page name (e.g., "Posts")
          __("Open another %s"),
          config.title
        );
        menuPanel.appendChild(openAnother);
      }
    }
    const iconEl = document.createElement("span");
    iconEl.className = `wp-desktop-window__icon dashicons ${sanitizeClassName(config.icon)}`;
    iconEl.setAttribute("aria-hidden", "true");
    const titleEl = document.createElement("span");
    titleEl.className = "wp-desktop-window__title";
    titleEl.id = `wp-window-title-${config.id}`;
    titleEl.textContent = config.title;
    const controls = document.createElement("div");
    controls.className = "wp-desktop-window__controls";
    const btnMin = createControlButton("minimize", __("Minimize"), "minimize");
    const btnMax = createControlButton("maximize", __("Maximize"), "maximize");
    const btnFocus = createControlButton("focus", __("Enter fullscreen"), "fullscreen");
    const btnDetach = createControlButton("detach", __("Detach to new tab"), "detach");
    const btnClose = createControlButton("close", __("Close"), "close");
    controls.appendChild(btnMin);
    controls.appendChild(btnMax);
    controls.appendChild(btnFocus);
    if (!config.native) {
      controls.appendChild(btnDetach);
    }
    controls.appendChild(btnClose);
    const screenMeta = document.createElement("div");
    screenMeta.className = "wp-desktop-window__screen-meta";
    titleBar.appendChild(iconEl);
    titleBar.appendChild(titleEl);
    titleBar.appendChild(screenMeta);
    if (menuBtn && menuPanel && menuPanel.children.length > 0) {
      titleBar.appendChild(menuBtn);
      titleBar.appendChild(menuPanel);
    }
    titleBar.appendChild(controls);
    const body = document.createElement("div");
    body.className = "wp-desktop-window__body";
    if (!config.native) {
      const iframe = document.createElement("iframe");
      iframe.className = "wp-desktop-window__iframe";
      iframe.setAttribute("name", `wp-desktop-frame-${config.id}`);
      const chromelessSrc = config.url ? withChromelessParam(config.url) : null;
      iframe.src = chromelessSrc ?? "about:blank";
      body.appendChild(iframe);
    } else {
      body.classList.add("wp-desktop-window__body--native");
    }
    const resizeHandles = [];
    for (const dir of ["ne", "nw", "se", "sw"]) {
      const h = document.createElement("div");
      h.className = `wp-desktop-window__resize-handle wp-desktop-window__resize-handle--${dir}`;
      h.dataset.dir = dir;
      h.setAttribute("aria-hidden", "true");
      resizeHandles.push(h);
    }
    el.appendChild(titleBar);
    if (!config.native) {
      const tabs = document.createElement("nav");
      tabs.className = "wp-desktop-window__tabs";
      tabs.setAttribute("role", "tablist");
      tabs.setAttribute("aria-label", sprintf(__("%s sub-pages"), config.title));
      if (config.submenu && config.submenu.length > 0 && config.url) {
        const initialKey = urlMatchKey(config.url);
        for (const sub of config.submenu) {
          const tab = document.createElement("button");
          tab.className = "wp-desktop-window__tab";
          tab.dataset.kind = "submenu";
          tab.setAttribute("type", "button");
          tab.setAttribute("role", "tab");
          tab.dataset.url = sub.url;
          tab.textContent = sub.title;
          if (urlMatchKey(sub.url) === initialKey) {
            tab.classList.add("wp-desktop-window__tab--active");
            tab.setAttribute("aria-selected", "true");
          } else {
            tab.setAttribute("aria-selected", "false");
          }
          tabs.appendChild(tab);
        }
      }
      el.appendChild(tabs);
    }
    el.appendChild(body);
    for (const h of resizeHandles) {
      el.appendChild(h);
    }
    return el;
  }
  const containerStyles = css`
	:host {
		position: fixed;
		top: calc( var( --wp-admin--admin-bar--height, 32px ) + 16px );
		inset-inline-end: 16px;
		display: flex;
		flex-direction: column;
		gap: 8px;
		z-index: calc( var( --wp-desktop-z-fullscreen, 99999 ) + 10 );
		pointer-events: none;
	}
`;
  const toastStyles = css`
	:host {
		display: flex;
		align-items: center;
		gap: 12px;
		min-width: 280px;
		max-width: 420px;
		padding: 10px 14px;
		background: #1d2327;
		color: #fff;
		border-radius: 8px;
		box-shadow: 0 8px 24px rgba( 0, 0, 0, 0.2 ),
			0 2px 6px rgba( 0, 0, 0, 0.1 );
		font-size: 13px;
		line-height: 1.4;
		opacity: 0;
		transform: translateY( -8px );
		transition: opacity 0.18s ease, transform 0.18s ease;
		pointer-events: auto;
	}
	:host( [ state='in' ] ) {
		opacity: 1;
		transform: translateY( 0 );
	}
	:host( [ state='out' ] ) {
		opacity: 0;
		transform: translateY( -8px );
	}
	.wpd-toast__label {
		flex: 1;
	}
	button {
		flex-shrink: 0;
		padding: 4px 10px;
		border: none;
		border-radius: 4px;
		background: rgba( 255, 255, 255, 0.12 );
		color: #fff;
		font: inherit;
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		transition: background-color 0.12s ease;
	}
	button:hover {
		background: rgba( 255, 255, 255, 0.22 );
	}
	button:focus-visible {
		outline: 2px solid rgba( 255, 255, 255, 0.6 );
		outline-offset: 2px;
	}
	@media ( prefers-reduced-motion: reduce ) {
		:host {
			transition-duration: 0.01ms;
		}
	}
`;
  const _WpdToastContainer = class _WpdToastContainer extends Component {
    connectedCallback() {
      super.connectedCallback();
      this.setAttribute("aria-live", "polite");
    }
    render() {
      return html`<slot></slot>`;
    }
  };
  _WpdToastContainer.styles = [containerStyles];
  let WpdToastContainer = _WpdToastContainer;
  defineComponent("wpd-toast-container", WpdToastContainer);
  const _WpdToast = class _WpdToast extends Component {
    connectedCallback() {
      super.connectedCallback();
      if (!this.hasAttribute("role")) {
        this.setAttribute("role", "status");
      }
    }
    render() {
      const action = this.action || "";
      return html`
			<span class="wpd-toast__label"><slot></slot></span>
			<button
				type="button"
				?hidden=${!action}
				@click=${(e) => this._onAction(e)}
			>
				${action}
			</button>
		`;
    }
    _onAction(e) {
      e.preventDefault();
      e.stopPropagation();
      this.emit("wpd-toast-action", {});
    }
  };
  _WpdToast.props = ["action", "state"];
  _WpdToast.styles = [toastStyles];
  let WpdToast = _WpdToast;
  defineComponent("wpd-toast", WpdToast);
  const DEFAULT_DURATION_MS = 4e3;
  const FADE_OUT_MS = 200;
  function showToast(options) {
    const container = ensureContainer();
    const toast = document.createElement("wpd-toast");
    toast.textContent = options.message;
    if (options.action) {
      toast.setAttribute("action", options.action.label);
      toast.addEventListener("wpd-toast-action", () => {
        options.action?.onClick();
        dismiss();
      });
    }
    container.appendChild(toast);
    let dismissed = false;
    let dismissTimer = null;
    const dismiss = () => {
      if (dismissed) {
        return;
      }
      dismissed = true;
      if (dismissTimer !== null) {
        window.clearTimeout(dismissTimer);
        dismissTimer = null;
      }
      toast.setAttribute("state", "out");
      window.setTimeout(() => {
        toast.remove();
      }, FADE_OUT_MS);
    };
    requestAnimationFrame(() => {
      toast.setAttribute("state", "in");
    });
    dismissTimer = window.setTimeout(
      dismiss,
      options.duration ?? DEFAULT_DURATION_MS
    );
    return dismiss;
  }
  function ensureContainer() {
    const existing = document.querySelector(
      "wpd-toast-container"
    );
    if (existing) {
      return existing;
    }
    const el = document.createElement("wpd-toast-container");
    document.body.appendChild(el);
    return el;
  }
  const EDGE_MARGIN = 0;
  const DRAG_THRESHOLD_PX$1 = 5;
  const DRAG_THRESHOLD_SQUARED$1 = DRAG_THRESHOLD_PX$1 * DRAG_THRESHOLD_PX$1;
  const EXTERNAL_IFRAME_READY_TIMEOUT_MS = 3e3;
  function syncActiveTab(win, currentUrl) {
    const submenuTabs = win.element.querySelectorAll(
      '.wp-desktop-window__tab[data-kind="submenu"]'
    );
    if (!submenuTabs.length) {
      return;
    }
    if (win._activeTabId !== "primary") {
      for (const tab of submenuTabs) {
        tab.classList.remove("wp-desktop-window__tab--active");
        tab.setAttribute("aria-selected", "false");
      }
      return;
    }
    const activeKey = urlMatchKey(currentUrl);
    for (const tab of submenuTabs) {
      const tabUrl = tab.dataset.url;
      const isActive = !!tabUrl && urlMatchKey(tabUrl) === activeKey;
      tab.classList.toggle("wp-desktop-window__tab--active", isActive);
      tab.setAttribute("aria-selected", isActive ? "true" : "false");
    }
  }
  function addExternalTab(win, url, label) {
    if (!win.iframe) {
      return;
    }
    const tabStrip = win.element.querySelector(
      ".wp-desktop-window__tabs"
    );
    const body = win.element.querySelector(
      ".wp-desktop-window__body"
    );
    if (!tabStrip || !body) {
      return;
    }
    ensureMainTab(win, tabStrip);
    const tabId = `ext-${++win._externalTabSeq}`;
    const tabEl = document.createElement("button");
    tabEl.className = "wp-desktop-window__tab wp-desktop-window__tab--external";
    tabEl.dataset.kind = "external";
    tabEl.dataset.tabId = tabId;
    tabEl.setAttribute("type", "button");
    tabEl.setAttribute("role", "tab");
    tabEl.setAttribute("aria-selected", "false");
    tabEl.title = url;
    const labelEl = document.createElement("span");
    labelEl.className = "wp-desktop-window__tab-label";
    labelEl.textContent = label;
    tabEl.appendChild(labelEl);
    const detachBtn = document.createElement("wpd-tab-chip");
    detachBtn.setAttribute("variant", "detach");
    detachBtn.dataset.tabAction = "detach";
    detachBtn.dataset.tabId = tabId;
    detachBtn.setAttribute("aria-label", __("Open in a new browser tab"));
    detachBtn.title = __("Open in a new browser tab");
    tabEl.appendChild(detachBtn);
    const closeBtn = document.createElement("wpd-tab-chip");
    closeBtn.setAttribute("variant", "close");
    closeBtn.dataset.tabAction = "close";
    closeBtn.dataset.tabId = tabId;
    closeBtn.setAttribute("aria-label", __("Close tab"));
    closeBtn.title = __("Close tab");
    tabEl.appendChild(closeBtn);
    tabStrip.appendChild(tabEl);
    const iframe = document.createElement("iframe");
    iframe.className = "wp-desktop-window__iframe wp-desktop-window__iframe--external";
    iframe.dataset.tabId = tabId;
    iframe.style.display = "none";
    iframe.src = url;
    body.appendChild(iframe);
    let loaded = false;
    const onLoad = () => {
      loaded = true;
    };
    iframe.addEventListener("load", onLoad, { once: true });
    const probeTimer = window.setTimeout(() => {
      if (loaded) {
        return;
      }
      iframe.removeEventListener("load", onLoad);
      fallbackToBrowserTab(win, tabId);
    }, EXTERNAL_IFRAME_READY_TIMEOUT_MS);
    const cancelProbe = () => {
      iframe.removeEventListener("load", onLoad);
      window.clearTimeout(probeTimer);
    };
    win._externalTabs.set(tabId, {
      tabEl,
      iframe,
      url,
      label,
      cancelProbe
    });
    switchToTab(win, tabId);
    tabEl.scrollIntoView({ behavior: "smooth", inline: "end", block: "nearest" });
    win._emitChange("state");
  }
  function ensureMainTab(win, tabStrip) {
    if (tabStrip.querySelector('[data-kind="main"]')) {
      return;
    }
    if (tabStrip.querySelector('[data-kind="submenu"]')) {
      return;
    }
    const main = document.createElement("button");
    main.className = "wp-desktop-window__tab wp-desktop-window__tab--main wp-desktop-window__tab--active";
    main.dataset.kind = "main";
    main.setAttribute("type", "button");
    main.setAttribute("role", "tab");
    main.setAttribute("aria-selected", "true");
    main.textContent = win.config.title || "Main";
    tabStrip.prepend(main);
  }
  function switchToTab(win, tabId) {
    if (win._activeTabId === tabId) {
      return;
    }
    win._activeTabId = tabId;
    if (win.iframe) {
      win.iframe.style.display = tabId === "primary" ? "" : "none";
    }
    for (const [id, entry] of win._externalTabs) {
      entry.iframe.style.display = tabId === id ? "" : "none";
    }
    const tabEls = win.element.querySelectorAll(
      ".wp-desktop-window__tab"
    );
    tabEls.forEach((t) => {
      let isActive;
      if (t.dataset.kind === "main") {
        isActive = tabId === "primary";
      } else if (t.dataset.kind === "external") {
        isActive = t.dataset.tabId === tabId;
      } else {
        isActive = tabId === "primary" && t.classList.contains("wp-desktop-window__tab--active");
      }
      t.classList.toggle("wp-desktop-window__tab--active", isActive);
      t.setAttribute("aria-selected", isActive ? "true" : "false");
    });
  }
  function closeExternalTab(win, tabId) {
    const entry = win._externalTabs.get(tabId);
    if (!entry) {
      return;
    }
    entry.cancelProbe();
    entry.tabEl.remove();
    entry.iframe.remove();
    win._externalTabs.delete(tabId);
    if (win._activeTabId === tabId) {
      switchToTab(win, "primary");
    }
    if (win._externalTabs.size === 0) {
      const main = win.element.querySelector(
        ".wp-desktop-window__tab--main"
      );
      main?.remove();
    }
    win._emitChange("state");
  }
  function detachExternalTab(win, tabId) {
    const entry = win._externalTabs.get(tabId);
    if (!entry) {
      return;
    }
    let url = entry.url;
    try {
      const href = entry.iframe.contentWindow?.location.href;
      if (href && href !== "about:blank") {
        url = href;
      }
    } catch {
    }
    window.open(url, "_blank", "noopener");
    closeExternalTab(win, tabId);
  }
  function fallbackToBrowserTab(win, tabId) {
    const entry = win._externalTabs.get(tabId);
    if (!entry) {
      return;
    }
    const { url, label } = entry;
    closeExternalTab(win, tabId);
    showToast({
      message: sprintf(
        // translators: %s is the external site's title or URL.
        __(
          `Opened "%s" in a new browser tab — this site doesn't allow embedding.`
        ),
        label
      ),
      action: {
        label: __("Open"),
        onClick: () => {
          window.open(url, "_blank", "noopener");
        }
      }
    });
    window.open(url, "_blank", "noopener");
  }
  function externalTabCount(win) {
    return win._externalTabs.size;
  }
  function externalTabsSnapshot(win) {
    const out = [];
    for (const entry of win._externalTabs.values()) {
      let url = entry.url;
      try {
        const href = entry.iframe.contentWindow?.location.href;
        if (href && href !== "about:blank") {
          url = href;
        }
      } catch {
      }
      out.push({ url, label: entry.label });
    }
    return out;
  }
  function handleTabStripClick(win, e) {
    const target = e.target;
    const chip = target.closest("[data-tab-action]");
    if (chip) {
      e.stopPropagation();
      const action = chip.dataset.tabAction;
      const tabId2 = chip.dataset.tabId;
      if (!tabId2) {
        return;
      }
      if (action === "close") {
        closeExternalTab(win, tabId2);
      } else if (action === "detach") {
        detachExternalTab(win, tabId2);
      }
      return;
    }
    const tab = target.closest(".wp-desktop-window__tab");
    if (!tab) {
      return;
    }
    e.stopPropagation();
    const kind = tab.dataset.kind;
    const tabId = tab.dataset.tabId;
    if (kind === "external" && tabId) {
      switchToTab(win, tabId);
      return;
    }
    if (kind === "main") {
      switchToTab(win, "primary");
      return;
    }
    if (tab.dataset.url) {
      const next = withChromelessParam(tab.dataset.url);
      if (next && win.iframe) {
        win.iframe.src = next;
      }
      switchToTab(win, "primary");
    }
  }
  const INITIAL_ORIGIN$2 = window.location.origin;
  function handleWindowMessage(win, event) {
    if (event.origin !== INITIAL_ORIGIN$2) {
      return;
    }
    if (!win.iframe || event.source !== win.iframe.contentWindow) {
      return;
    }
    const data = event.data;
    if (!data || typeof data.type !== "string") {
      return;
    }
    if (data.type === "wp-desktop-title-change" && typeof data.title === "string") {
      win.setTitle(data.title);
    }
    if (data.type === "wp-desktop-ready") {
      doAction(HOOKS.IFRAME_READY, { windowId: win.id });
    }
    if (data.type === "wp-desktop-navigate" && typeof data.url === "string" && data.url !== "") {
      handleDesktopNavigate(
        win,
        data.url,
        data.target === "new" ? "new" : "self"
      );
    }
    if (data.type === "wp-desktop-notification" && typeof data.title === "string" && data.title !== "") {
      handleDesktopNotification(
        data.title,
        typeof data.body === "string" ? data.body : ""
      );
    }
    if (data.type === "wp-desktop-focus-request") {
      if (!win.element.classList.contains("wp-desktop-window--overview")) {
        win.onFocusRequest?.(win);
      }
    }
    if (data.type === "wp-desktop-screen-meta" && Array.isArray(data.panels)) {
      addScreenMetaButtons(win, data.panels);
    }
    if (data.type === "wp-desktop-screen-meta-state") {
      setActiveScreenMetaPanel(
        win,
        typeof data.open === "string" ? data.open : null
      );
    }
    if (data.type === "wp-desktop-external-link" && typeof data.url === "string" && data.url !== "") {
      const label = typeof data.label === "string" && data.label !== "" ? data.label : data.url;
      addExternalTab(win, data.url, label);
    }
    if (data.type === "wp-desktop-iframe-error") {
      doAction(HOOKS.IFRAME_ERROR, {
        windowId: win.id,
        kind: data.kind === "unhandledrejection" ? "unhandledrejection" : "error",
        message: typeof data.message === "string" ? data.message : "",
        filename: typeof data.filename === "string" ? data.filename : null,
        lineno: typeof data.lineno === "number" ? data.lineno : null,
        colno: typeof data.colno === "number" ? data.colno : null,
        stack: typeof data.stack === "string" ? data.stack : null
      });
    }
    if (data.type === "wp-desktop-iframe-network") {
      doAction(HOOKS.IFRAME_NETWORK_COMPLETED, {
        windowId: win.id,
        method: typeof data.method === "string" ? data.method : "GET",
        url: typeof data.url === "string" ? data.url : "",
        status: typeof data.status === "number" ? data.status : 0,
        duration: typeof data.duration === "number" ? data.duration : 0,
        failed: !!data.failed
      });
    }
  }
  function handleDesktopNavigate(win, rawUrl, target) {
    let url;
    try {
      url = new URL(rawUrl, INITIAL_ORIGIN$2);
    } catch {
      return;
    }
    if (url.origin !== INITIAL_ORIGIN$2) {
      return;
    }
    if (target === "new") {
      window.open(url.toString(), "_blank", "noopener,noreferrer");
      return;
    }
    if (win.iframe) {
      win.iframe.src = url.toString();
    }
  }
  function handleDesktopNotification(title, body) {
    const message = body !== "" ? `${title} — ${body}` : title;
    showToast({ message });
  }
  function addScreenMetaButtons(win, panels) {
    const container = win.element.querySelector(".wp-desktop-window__screen-meta");
    if (!container) {
      return;
    }
    container.innerHTML = "";
    const panelConfig = {
      "screen-options": { icon: "dashicons-admin-generic", label: "Screen Options" },
      help: { icon: "dashicons-editor-help", label: "Help" }
    };
    for (const panel of panels) {
      const cfg = panelConfig[panel];
      if (!cfg) {
        continue;
      }
      const btn = document.createElement("button");
      btn.className = "wp-desktop-window__meta-btn";
      btn.setAttribute("type", "button");
      btn.setAttribute("aria-label", cfg.label);
      btn.setAttribute("aria-pressed", "false");
      btn.dataset.panel = panel;
      btn.innerHTML = `<span class="dashicons ${cfg.icon}" aria-hidden="true"></span>`;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        win.iframe?.contentWindow?.postMessage(
          { type: "wp-desktop-toggle-panel", panel },
          INITIAL_ORIGIN$2
        );
      });
      container.appendChild(btn);
    }
  }
  function setActiveScreenMetaPanel(win, panel) {
    const container = win.element.querySelector(".wp-desktop-window__screen-meta");
    if (!container) {
      return;
    }
    container.querySelectorAll(".wp-desktop-window__meta-btn").forEach((btn) => {
      const isActive = btn.dataset.panel === panel;
      btn.classList.toggle("wp-desktop-window__meta-btn--active", isActive);
      btn.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
  }
  function toggleActionsMenu(win) {
    const panel = win.element.querySelector(
      ".wp-desktop-window__menu-panel"
    );
    if (!panel) {
      return;
    }
    if (panel.hidden) {
      openActionsMenu(win);
    } else {
      closeActionsMenu(win);
    }
  }
  function openActionsMenu(win) {
    const panel = win.element.querySelector(
      ".wp-desktop-window__menu-panel"
    );
    const btn = win.element.querySelector(
      ".wp-desktop-window__menu-btn"
    );
    if (!panel || !btn) {
      return;
    }
    panel.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    const startup = panel.querySelector(
      ".wp-desktop-window__menu-item--startup"
    );
    if (startup) {
      refreshStartupCheckState(win, startup);
    }
    if (!win._boundOnDocumentPointerDown) {
      win._boundOnDocumentPointerDown = (e) => {
        const target = e.target;
        if (!target) {
          return;
        }
        if (panel.contains(target) || btn.contains(target)) {
          return;
        }
        closeActionsMenu(win);
      };
    }
    setTimeout(() => {
      if (win._boundOnDocumentPointerDown) {
        document.addEventListener(
          "pointerdown",
          win._boundOnDocumentPointerDown,
          true
        );
      }
    }, 0);
    const firstItem = panel.querySelector('[role="menuitem"]');
    firstItem?.focus();
  }
  function closeActionsMenu(win) {
    const panel = win.element.querySelector(
      ".wp-desktop-window__menu-panel"
    );
    const btn = win.element.querySelector(
      ".wp-desktop-window__menu-btn"
    );
    if (panel) {
      panel.hidden = true;
    }
    if (btn) {
      btn.setAttribute("aria-expanded", "false");
    }
    if (win._boundOnDocumentPointerDown) {
      document.removeEventListener(
        "pointerdown",
        win._boundOnDocumentPointerDown,
        true
      );
    }
  }
  function flipStartupCheckOptimistically(item) {
    const isChecked = item.hasAttribute("checked");
    if (isChecked) {
      item.removeAttribute("checked");
    } else {
      item.setAttribute("checked", "");
    }
  }
  function refreshStartupCheckState(win, item) {
    const pref = window.wp?.desktop?.config?.defaultWindow;
    let isDefault = false;
    if (pref && pref.enabled && typeof pref.url === "string") {
      try {
        const currentKey = urlMatchKey(win.getCurrentUrl());
        const prefKey = urlMatchKey(pref.url);
        isDefault = currentKey === prefKey;
      } catch {
        isDefault = false;
      }
    }
    if (isDefault) {
      item.setAttribute("checked", "");
    } else {
      item.removeAttribute("checked");
    }
  }
  function makeBoundsEmitter(win, phase) {
    let pending2 = false;
    return () => {
      if (pending2) {
        return;
      }
      pending2 = true;
      requestAnimationFrame(() => {
        pending2 = false;
        if (phase === "drag" && !win._isDragging) {
          return;
        }
        if (phase === "resize" && !win._isResizing) {
          return;
        }
        if (win._isDestroyed || !win.element.isConnected) {
          return;
        }
        try {
          doAction(HOOKS.WINDOW_BOUNDS_CHANGED, {
            windowId: win.id,
            x: win.element.offsetLeft,
            y: win.element.offsetTop,
            width: win.element.offsetWidth,
            height: win.element.offsetHeight,
            state: win.state,
            phase
          });
        } catch {
        }
      });
    };
  }
  function handleDragStart(win, e) {
    const target = e.target;
    if (target.closest(".wp-desktop-window__controls") || target.closest(".wp-desktop-window__screen-meta") || target.closest(".wp-desktop-window__menu-btn") || target.closest(".wp-desktop-window__menu-panel")) {
      return;
    }
    const isMaximized = win.state === "maximized";
    const isSnapped = win.state === "snapped-left" || win.state === "snapped-right";
    const needsUnstate = isMaximized || isSnapped;
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const pointerId = e.pointerId;
    const unstateParams = needsUnstate ? captureUnstateParams(win, e) : null;
    win._titleBar.setPointerCapture(pointerId);
    const snap = win.snapConfigProvider?.() ?? { enabled: false, cellWidth: 0, cellHeight: 0 };
    const emitBoundsChanged = makeBoundsEmitter(win, "drag");
    let started = false;
    const beginDrag = (cursorX, cursorY) => {
      if (started) {
        return;
      }
      started = true;
      let newLeft;
      let newTop;
      if (unstateParams) {
        const placed = commitUnstate(win, unstateParams, cursorX, cursorY);
        newLeft = placed.left;
        newTop = placed.top;
      } else {
        newLeft = win.element.offsetLeft;
        newTop = win.element.offsetTop;
      }
      win.element.classList.add("wp-desktop-window--dragging");
      if (snap.enabled) {
        win.element.classList.add("wp-desktop-window--snap-drag");
      }
      win._isDragging = true;
      win._dragOffsetX = cursorX - newLeft;
      win._dragOffsetY = cursorY - newTop;
      doAction(HOOKS.WINDOW_DRAG_START, { windowId: win.id });
    };
    if (!needsUnstate) {
      beginDrag(startClientX, startClientY);
    }
    const onDragMove = (ev) => {
      if (!started) {
        const dx = ev.clientX - startClientX;
        const dy = ev.clientY - startClientY;
        if (dx * dx + dy * dy < DRAG_THRESHOLD_SQUARED$1) {
          return;
        }
        beginDrag(ev.clientX, ev.clientY);
      }
      if (!win._isDragging) {
        return;
      }
      let x = ev.clientX - win._dragOffsetX;
      let y = ev.clientY - win._dragOffsetY;
      const desktop = win.element.parentElement;
      if (desktop) {
        x = Math.max(EDGE_MARGIN, Math.min(x, desktop.clientWidth - EDGE_MARGIN));
        y = Math.max(EDGE_MARGIN, Math.min(y, desktop.clientHeight - EDGE_MARGIN));
      }
      if (snap.enabled) {
        x = Math.round(x / snap.cellWidth) * snap.cellWidth;
        y = Math.round(y / snap.cellHeight) * snap.cellHeight;
      }
      win.element.style.left = `${x}px`;
      win.element.style.top = `${y}px`;
      win.onDragMove?.(win, ev.clientX, ev.clientY);
      emitBoundsChanged();
    };
    const releaseCapture = () => {
      try {
        win._titleBar.releasePointerCapture(pointerId);
      } catch {
      }
    };
    const detachListeners = () => {
      win._titleBar.removeEventListener("pointermove", onDragMove);
      win._titleBar.removeEventListener("pointerup", onDragEnd);
      win._titleBar.removeEventListener("pointercancel", onDragEnd);
      win._titleBar.removeEventListener("lostpointercapture", onDragEnd);
    };
    const onDragEnd = () => {
      if (!started) {
        releaseCapture();
        detachListeners();
        return;
      }
      if (!win._isDragging) {
        return;
      }
      win._isDragging = false;
      win.element.classList.remove("wp-desktop-window--dragging");
      win.element.classList.remove("wp-desktop-window--snap-drag");
      releaseCapture();
      detachListeners();
      const consumed = win.onDragEnd?.(win) ?? false;
      if (consumed) {
        return;
      }
      win._emitChange("moved");
      const payload = {
        windowId: win.id,
        x: win.element.offsetLeft,
        y: win.element.offsetTop
      };
      doAction(HOOKS.WINDOW_DRAG_END, payload);
      doAction(HOOKS.WINDOW_MOVED, payload);
    };
    win._titleBar.addEventListener("pointermove", onDragMove);
    win._titleBar.addEventListener("pointerup", onDragEnd);
    win._titleBar.addEventListener("pointercancel", onDragEnd);
    win._titleBar.addEventListener("lostpointercapture", onDragEnd);
  }
  function captureUnstateParams(win, e) {
    const titleRect = win._titleBar.getBoundingClientRect();
    const cursorRatioX = titleRect.width > 0 ? (e.clientX - titleRect.left) / titleRect.width : 0.5;
    const parent = win.element.parentElement;
    const fallbackW = parent ? Math.min(960, Math.round(parent.clientWidth * 0.6)) : 640;
    const fallbackH = parent ? Math.min(640, Math.round(parent.clientHeight * 0.7)) : 480;
    const w = win._savedGeometry?.width ?? fallbackW;
    const h = win._savedGeometry?.height ?? fallbackH;
    const parentRect = parent?.getBoundingClientRect();
    return {
      isMaximized: win.state === "maximized",
      cursorRatioX,
      titleBarHeight: titleRect.height,
      // `clientX` / `clientY` are viewport-relative but
      // `style.left` / `.top` resolve against the window's
      // offsetParent (the desktop area). Subtract the area's own
      // viewport origin so the re-anchor math lands in the right
      // space — otherwise an admin bar above + a dock on the left
      // would shift the window below + right of the cursor.
      areaLeft: parentRect?.left ?? 0,
      areaTop: parentRect?.top ?? 0,
      targetW: w,
      targetH: h
    };
  }
  function commitUnstate(win, params, cursorX, cursorY) {
    win.element.classList.remove(
      "wp-desktop-window--maximized",
      "wp-desktop-window--snapped-left",
      "wp-desktop-window--snapped-right"
    );
    win.element.style.width = `${params.targetW}px`;
    win.element.style.height = `${params.targetH}px`;
    const left = Math.round(
      cursorX - params.areaLeft - params.targetW * params.cursorRatioX
    );
    const top = Math.round(
      cursorY - params.areaTop - params.titleBarHeight / 2
    );
    win.element.style.left = `${left}px`;
    win.element.style.top = `${top}px`;
    win.state = "normal";
    win._emitChange("state");
    if (params.isMaximized) {
      doAction(HOOKS.WINDOW_UNMAXIMIZED, { windowId: win.id });
    }
    return { left, top };
  }
  function handleResizeStart(win, e) {
    if (win.state === "maximized" || win.state === "fullscreen") {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const handle = e.target;
    const dir = handle.dataset.dir ?? "se";
    win._isResizing = true;
    win._resizeStartX = e.clientX;
    win._resizeStartY = e.clientY;
    win._resizeStartW = win.element.offsetWidth;
    win._resizeStartH = win.element.offsetHeight;
    const startLeft = win.element.offsetLeft;
    const startTop = win.element.offsetTop;
    handle.setPointerCapture(e.pointerId);
    win.element.classList.add("wp-desktop-window--resizing");
    doAction(HOOKS.WINDOW_RESIZE_START, { windowId: win.id });
    const emitBoundsChanged = makeBoundsEmitter(win, "resize");
    const snap = win.snapConfigProvider?.() ?? { enabled: false, cellWidth: 0, cellHeight: 0 };
    if (snap.enabled) {
      win.element.classList.add("wp-desktop-window--snap-drag");
    }
    if (win.state === "snapped-left" || win.state === "snapped-right") {
      win.element.classList.remove(
        "wp-desktop-window--snapped-left",
        "wp-desktop-window--snapped-right"
      );
      win.state = "normal";
    }
    const onResizeMove = (ev) => {
      if (!win._isResizing) {
        return;
      }
      const dx = ev.clientX - win._resizeStartX;
      const dy = ev.clientY - win._resizeStartY;
      const geom = computeResize$1(
        dir,
        dx,
        dy,
        startLeft,
        startTop,
        win._resizeStartW,
        win._resizeStartH,
        win.config.minWidth,
        win.config.minHeight,
        snap
      );
      win.element.style.left = `${geom.x}px`;
      win.element.style.top = `${geom.y}px`;
      win.element.style.width = `${geom.width}px`;
      win.element.style.height = `${geom.height}px`;
      emitBoundsChanged();
    };
    const onResizeEnd = () => {
      if (!win._isResizing) {
        return;
      }
      win._isResizing = false;
      win.element.classList.remove("wp-desktop-window--resizing");
      win.element.classList.remove("wp-desktop-window--snap-drag");
      handle.removeEventListener("pointermove", onResizeMove);
      handle.removeEventListener("pointerup", onResizeEnd);
      handle.removeEventListener("pointercancel", onResizeEnd);
      handle.removeEventListener("lostpointercapture", onResizeEnd);
      win._emitChange("resized");
      const payload = {
        windowId: win.id,
        width: win.element.offsetWidth,
        height: win.element.offsetHeight
      };
      doAction(HOOKS.WINDOW_RESIZE_END, payload);
      doAction(HOOKS.WINDOW_RESIZED, payload);
    };
    handle.addEventListener("pointermove", onResizeMove);
    handle.addEventListener("pointerup", onResizeEnd);
    handle.addEventListener("pointercancel", onResizeEnd);
    handle.addEventListener("lostpointercapture", onResizeEnd);
  }
  function computeResize$1(dir, dx, dy, startLeft, startTop, startW, startH, minWidth, minHeight, snap) {
    let width = startW;
    let height = startH;
    let x = startLeft;
    let y = startTop;
    if (dir === "ne" || dir === "se") {
      width = Math.max(minWidth, startW + dx);
    }
    if (dir === "nw" || dir === "sw") {
      const nextWidth = Math.max(minWidth, startW - dx);
      x = startLeft + (startW - nextWidth);
      width = nextWidth;
    }
    if (dir === "se" || dir === "sw") {
      height = Math.max(minHeight, startH + dy);
    }
    if (dir === "ne" || dir === "nw") {
      const nextHeight = Math.max(minHeight, startH - dy);
      y = startTop + (startH - nextHeight);
      height = nextHeight;
    }
    if (snap.enabled) {
      const nextWidth = Math.max(
        minWidth,
        Math.round(width / snap.cellWidth) * snap.cellWidth
      );
      const nextHeight = Math.max(
        minHeight,
        Math.round(height / snap.cellHeight) * snap.cellHeight
      );
      if (dir === "nw" || dir === "sw") {
        x = startLeft + (width - nextWidth);
      }
      if (dir === "nw" || dir === "ne") {
        y = startTop + (height - nextHeight);
      }
      width = nextWidth;
      height = nextHeight;
    }
    return { x, y, width, height };
  }
  const INITIAL_ORIGIN$1 = window.location.origin;
  class Window {
    constructor(config) {
      this.state = "normal";
      this._isDragging = false;
      this._isResizing = false;
      this._isDestroyed = false;
      this._dragOffsetX = 0;
      this._dragOffsetY = 0;
      this._resizeStartX = 0;
      this._resizeStartY = 0;
      this._resizeStartW = 0;
      this._resizeStartH = 0;
      this._savedGeometry = null;
      this._savedFullscreenState = null;
      this._externalTabs = /* @__PURE__ */ new Map();
      this._externalTabSeq = 0;
      this._activeTabId = "primary";
      this.onFocusRequest = null;
      this.onClose = null;
      this.onMinimize = null;
      this.onOpenAnother = null;
      this.onToggleStartup = null;
      this.snapConfigProvider = null;
      this.onDragMove = null;
      this.onDragEnd = null;
      this._boundOnDocumentPointerDown = null;
      this._bodyResizeObserver = null;
      this.id = config.id;
      this.config = config;
      this.element = createWindowElement(config);
      this.iframe = config.native ? null : this.element.querySelector(".wp-desktop-window__iframe");
      this._titleBar = this.element.querySelector(".wp-desktop-window__titlebar");
      this._titleEl = this.element.querySelector(".wp-desktop-window__title");
      this._boundOnMessage = (e) => handleWindowMessage(this, e);
      this.bindEvents();
      this._bodyResizeObserver = this.installBodyResizeObserver();
      if (config.initialState === "minimized") {
        this.state = "minimized";
        this.element.classList.add("wp-desktop-window--minimized");
        if (this.iframe) {
          this.iframe.style.visibility = "hidden";
        }
        return;
      }
      if (config.initialState === "snapped-left" || config.initialState === "snapped-right") {
        this.element.classList.add(
          `wp-desktop-window--${config.initialState}`
        );
      }
      this.element.classList.add("wp-desktop-window--opening");
      this.element.addEventListener("animationend", () => {
        this.element.classList.remove("wp-desktop-window--opening");
      }, { once: true });
      if (config.initialState && config.initialState !== "normal") {
        requestAnimationFrame(() => this.applyInitialState(config.initialState));
      }
    }
    /**
     * Run the plugin's render callback for a native window.
     *
     * Called by the window manager immediately after appending the
     * window element to the desktop. At that point the element (and
     * everything reachable inside it) is connected to the document,
     * so custom elements upgrade synchronously — a prerequisite for
     * the declarative component-kit API (`element.items = […]`) to
     * reach the class setter instead of creating a shadowing own
     * data property on the pre-upgrade instance.
     *
     * No-op for iframe windows.
     *
     * Per-event contract preserved from 0.10.x:
     *   - `NATIVE_WINDOW_BEFORE_RENDER` filter fires, same args.
     *   - `NATIVE_WINDOW_AFTER_RENDER` action fires, same args.
     *   - `config.autofocus` is honoured with a `requestAnimationFrame`
     *     defer so layout side-effects of `render()` settle before
     *     `.focus()` resolves.
     *
     * @since 0.12.0
     * @internal
     */
    hydrateNative() {
      if (!this.config.native || !this.config.render) {
        return;
      }
      const rawBody = this.element.querySelector(
        ".wp-desktop-window__body"
      );
      if (!rawBody) {
        return;
      }
      const filtered = applyFilters(
        HOOKS.NATIVE_WINDOW_BEFORE_RENDER,
        rawBody,
        { windowId: this.id, config: this.config }
      );
      const body = filtered instanceof HTMLElement ? filtered : rawBody;
      this.config.render(body);
      doAction(HOOKS.NATIVE_WINDOW_AFTER_RENDER, {
        windowId: this.id,
        body,
        config: this.config
      });
      const autofocus = this.config.autofocus;
      if (autofocus) {
        requestAnimationFrame(() => {
          if (this._isDestroyed) {
            return;
          }
          if (typeof autofocus === "string") {
            const target = body.querySelector(
              autofocus
            );
            target?.focus();
            return;
          }
          const hadTabIndex = body.hasAttribute("tabindex");
          if (!hadTabIndex) {
            body.tabIndex = -1;
          }
          body.focus();
        });
      }
    }
    /**
     * Apply a state restored from the session. Called once, after
     * construction.
     */
    applyInitialState(state) {
      if (state === "minimized") {
        this.minimize();
      } else if (state === "maximized") {
        this.toggleMaximize();
      } else if (state === "fullscreen") {
        this.toggleFullscreen();
      } else if (state === "snapped-left") {
        this.applySnap("left");
      } else if (state === "snapped-right") {
        this.applySnap("right");
      }
    }
    /**
     * Dispatch a `wp-desktop-window-changed` event so the session-save
     * path can schedule a debounced write.
     *
     * Called after any state change that should end up persisted: drag
     * end, resize end, minimize, restore, maximize toggle, fullscreen
     * toggle. Exposed as `_emitChange` so sibling modules (tabs,
     * pointer) can fire the same event.
     *
     * @internal
     */
    _emitChange(reason) {
      document.dispatchEvent(
        new CustomEvent("wp-desktop-window-changed", {
          detail: { windowId: this.id, reason, state: this.state }
        })
      );
    }
    /**
     * Round an `{ x, y, width, height }` rect onto the live snap grid
     * when snap-to-grid is enabled, otherwise return it unchanged.
     *
     * Used by both the un-maximize restore (so geometry saved while
     * snap was off doesn't leave the window off-grid when snap is on)
     * and any other code path that wants "the current geometry, but
     * grid-aligned." Width/height are floored to whole cells to avoid
     * crossing the EDGE_MARGIN constraint after rounding up.
     */
    snapGeometry(g) {
      const snap = this.snapConfigProvider?.();
      if (!snap || !snap.enabled) {
        return g;
      }
      const width = Math.max(
        this.config.minWidth,
        Math.round(g.width / snap.cellWidth) * snap.cellWidth
      );
      const height = Math.max(
        this.config.minHeight,
        Math.round(g.height / snap.cellHeight) * snap.cellHeight
      );
      return {
        x: Math.round(g.x / snap.cellWidth) * snap.cellWidth,
        y: Math.round(g.y / snap.cellHeight) * snap.cellHeight,
        width,
        height
      };
    }
    /**
     * Returns the current resolved URL of the iframe — preferring the
     * content window's location (reflects in-window navigation) and
     * falling back to the iframe's src attribute for cases where the
     * content document isn't yet reachable (cross-origin edge, early
     * load).
     */
    getCurrentUrl() {
      if (!this.iframe) {
        return this.config.url || `#${this.id}`;
      }
      try {
        const href = this.iframe.contentWindow?.location.href;
        if (href && href !== "about:blank") {
          return href;
        }
      } catch {
      }
      return this.iframe.src;
    }
    /** Bind all DOM event handlers. */
    bindEvents() {
      this.element.addEventListener("pointerdown", () => {
        if (this.element.classList.contains("wp-desktop-window--overview")) {
          return;
        }
        this.onFocusRequest?.(this);
      });
      this.element.addEventListener("focusin", () => {
        if (this.element.classList.contains("wp-desktop-window--overview")) {
          return;
        }
        this.onFocusRequest?.(this);
      });
      this._titleBar.addEventListener(
        "pointerdown",
        (e) => handleDragStart(this, e)
      );
      const resizeHandles = this.element.querySelectorAll(
        ".wp-desktop-window__resize-handle"
      );
      resizeHandles.forEach((handle) => {
        handle.addEventListener(
          "pointerdown",
          (e) => handleResizeStart(this, e)
        );
      });
      const btnMin = this.element.querySelector(".wp-desktop-window__btn--minimize");
      const btnMax = this.element.querySelector(".wp-desktop-window__btn--maximize");
      const btnFocus = this.element.querySelector(".wp-desktop-window__btn--focus");
      const btnDetach = this.element.querySelector(
        ".wp-desktop-window__btn--detach"
      );
      const btnClose = this.element.querySelector(".wp-desktop-window__btn--close");
      const menuBtn = this.element.querySelector(
        ".wp-desktop-window__menu-btn"
      );
      const menuPanel = this.element.querySelector(
        ".wp-desktop-window__menu-panel"
      );
      if (menuBtn && menuPanel) {
        menuBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          toggleActionsMenu(this);
        });
        const openAnother = menuPanel.querySelector(
          ".wp-desktop-window__menu-item--open-another"
        );
        if (openAnother) {
          openAnother.addEventListener("wpd-menu-item-click", (e) => {
            e.stopPropagation();
            closeActionsMenu(this);
            this.onOpenAnother?.(this);
          });
        }
        const startup = menuPanel.querySelector(
          ".wp-desktop-window__menu-item--startup"
        );
        if (startup) {
          refreshStartupCheckState(this, startup);
          startup.addEventListener("wpd-menu-item-click", (e) => {
            e.stopPropagation();
            flipStartupCheckOptimistically(startup);
            this.onToggleStartup?.(this);
          });
          document.addEventListener(
            "wp-desktop-default-window-changed",
            () => {
              refreshStartupCheckState(this, startup);
            }
          );
        }
        menuPanel.addEventListener("keydown", (e) => {
          const kev = e;
          if (kev.key === "Escape") {
            e.stopPropagation();
            closeActionsMenu(this);
            menuBtn.focus();
          }
        });
      }
      btnMin.addEventListener("click", (e) => {
        e.stopPropagation();
        this.minimize();
      });
      btnMax.addEventListener("click", (e) => {
        e.stopPropagation();
        this.toggleMaximize();
      });
      btnFocus.addEventListener("click", (e) => {
        e.stopPropagation();
        this.toggleFullscreen();
      });
      btnDetach?.addEventListener("click", (e) => {
        e.stopPropagation();
        this.detach();
      });
      btnClose.addEventListener("click", (e) => {
        e.stopPropagation();
        this.close();
      });
      this._titleBar.addEventListener("dblclick", () => {
        this.toggleMaximize();
      });
      if (this.iframe) {
        const iframe = this.iframe;
        const tabs = this.element.querySelector(".wp-desktop-window__tabs");
        if (tabs) {
          tabs.addEventListener(
            "click",
            (e) => handleTabStripClick(this, e)
          );
        }
        iframe.addEventListener("load", () => {
          try {
            const href = iframe.contentWindow?.location.href;
            if (href) {
              syncActiveTab(this, href);
            }
          } catch {
          }
        });
        window.addEventListener("message", this._boundOnMessage);
      }
    }
    /** Add a closeable+detachable sub-tab hosting an external URL. */
    addExternalTab(url, label) {
      addExternalTab(this, url, label);
    }
    /** Set the z-index of this window. */
    setZIndex(z) {
      this.element.style.zIndex = String(z);
    }
    /** Mark this window as focused or unfocused. */
    setFocused(focused) {
      this.element.classList.toggle("wp-desktop-window--focused", focused);
    }
    /** Update the window title. */
    setTitle(title) {
      this._titleEl.textContent = title;
      doAction(HOOKS.WINDOW_TITLE_CHANGED, { windowId: this.id, title });
    }
    /** Minimize the window. */
    /**
     * Write the half-screen snap geometry for `zone` and apply the
     * corresponding state class. Shared by session-restore (which
     * calls it from `applyInitialState`) and the manager's live-snap
     * commit path so both enter the "snapped" state via identical
     * geometry math — and the ResizeObserver that reflows stateful
     * windows on desktop-area size changes.
     */
    applySnap(zone) {
      const parent = this.element.parentElement;
      if (!parent) {
        return;
      }
      const halfW = Math.floor(parent.clientWidth / 2);
      const height = parent.clientHeight;
      this.element.classList.remove(
        "wp-desktop-window--maximized",
        "wp-desktop-window--snapped-left",
        "wp-desktop-window--snapped-right"
      );
      this.element.classList.add(`wp-desktop-window--snapped-${zone}`);
      this.element.style.left = zone === "left" ? "0px" : `${halfW}px`;
      this.element.style.top = "0px";
      this.element.style.width = `${halfW}px`;
      this.element.style.height = `${height}px`;
      this.state = zone === "left" ? "snapped-left" : "snapped-right";
      this._emitChange("state");
    }
    minimize() {
      this.state = "minimized";
      this.element.classList.add("wp-desktop-window--minimized");
      if (this.iframe) {
        const iframe = this.iframe;
        this.element.addEventListener("transitionend", (e) => {
          if (e.propertyName === "opacity" && this.state === "minimized") {
            iframe.style.visibility = "hidden";
          }
        }, { once: true });
      }
      this.onMinimize?.(this);
      this._emitChange("state");
      doAction(HOOKS.WINDOW_MINIMIZED, { windowId: this.id });
    }
    /** Restore the window from minimized state. */
    restore() {
      if (this.iframe) {
        this.iframe.style.visibility = "";
      }
      const wasMinimized = this.state === "minimized";
      this.element.classList.remove("wp-desktop-window--minimized");
      if (wasMinimized) {
        this.state = "normal";
      }
      this.onFocusRequest?.(this);
      this._emitChange("state");
      if (wasMinimized) {
        doAction(HOOKS.WINDOW_RESTORED, { windowId: this.id });
      }
    }
    /**
     * Enter maximized state idempotently.
     *
     * Different from `toggleMaximize` in that it's a one-way: a caller
     * that wants the window maximized can call this without worrying
     * about the current state. No-op if already maximized.
     *
     * Used by the Overview-exit path so clicking a thumbnail can
     * animate directly from the grid position to maximized in one
     * co-animation, rather than the two chained animations a
     * `toggleMaximize` call would produce (first back-to-normal, then
     * normal-to-maximized).
     */
    maximize() {
      if (this.state === "maximized") {
        return;
      }
      const parent = this.element.parentElement;
      if (!parent) {
        return;
      }
      this._savedGeometry = {
        x: this.element.offsetLeft,
        y: this.element.offsetTop,
        width: this.element.offsetWidth,
        height: this.element.offsetHeight
      };
      this.element.classList.add("wp-desktop-window--maximized");
      this.element.style.left = "0px";
      this.element.style.top = "0px";
      this.element.style.width = `${parent.clientWidth}px`;
      this.element.style.height = `${parent.clientHeight}px`;
      this.state = "maximized";
      this._emitChange("state");
      doAction(HOOKS.WINDOW_MAXIMIZED, { windowId: this.id });
    }
    /** Toggle between maximized and normal states. */
    toggleMaximize() {
      const parent = this.element.parentElement;
      if (!parent) {
        return;
      }
      if (this.state === "maximized") {
        this.element.classList.remove("wp-desktop-window--maximized");
        if (this._savedGeometry) {
          const restored = this.snapGeometry(this._savedGeometry);
          this.element.style.left = `${restored.x}px`;
          this.element.style.top = `${restored.y}px`;
          this.element.style.width = `${restored.width}px`;
          this.element.style.height = `${restored.height}px`;
          this._savedGeometry = restored;
        }
        this.state = "normal";
        this._emitChange("state");
        doAction(HOOKS.WINDOW_UNMAXIMIZED, { windowId: this.id });
      } else {
        this._savedGeometry = {
          x: this.element.offsetLeft,
          y: this.element.offsetTop,
          width: this.element.offsetWidth,
          height: this.element.offsetHeight
        };
        this.element.classList.add("wp-desktop-window--maximized");
        this.element.style.left = "0px";
        this.element.style.top = "0px";
        this.element.style.width = `${parent.clientWidth}px`;
        this.element.style.height = `${parent.clientHeight}px`;
        this.state = "maximized";
        this._emitChange("state");
        doAction(HOOKS.WINDOW_MAXIMIZED, { windowId: this.id });
      }
    }
    /**
     * Toggle fullscreen ("focus") mode — the window covers the entire
     * viewport, hiding the admin bar, dock, and taskbar behind it.
     *
     * This is the equivalent of macOS's green zoom-to-fullscreen: an
     * immersive mode distinct from maximize (which only fills the
     * desktop area between dock and taskbar).
     */
    toggleFullscreen() {
      if (this.state === "fullscreen") {
        this.element.classList.remove("wp-desktop-window--fullscreen");
        if (this._savedFullscreenState) {
          const s = this._savedFullscreenState;
          this.element.style.left = `${s.x}px`;
          this.element.style.top = `${s.y}px`;
          this.element.style.width = `${s.width}px`;
          this.element.style.height = `${s.height}px`;
          this.element.classList.toggle(
            "wp-desktop-window--maximized",
            s.state === "maximized"
          );
          this.state = s.state;
          this._savedFullscreenState = null;
        } else {
          this.state = "normal";
        }
      } else {
        this._savedFullscreenState = {
          state: this.state,
          x: this.element.offsetLeft,
          y: this.element.offsetTop,
          width: this.element.offsetWidth,
          height: this.element.offsetHeight
        };
        this.element.classList.add("wp-desktop-window--fullscreen");
        this.state = "fullscreen";
      }
      updateFullscreenBodyClass();
      this.updateFocusButtonState();
      this._emitChange("state");
      doAction(
        this.state === "fullscreen" ? HOOKS.WINDOW_FULLSCREEN_ENTERED : HOOKS.WINDOW_FULLSCREEN_EXITED,
        { windowId: this.id }
      );
    }
    /**
     * Reflect fullscreen state on the focus-mode button (active class,
     * aria-pressed, and label).
     */
    updateFocusButtonState() {
      const btn = this.element.querySelector(
        ".wp-desktop-window__btn--focus"
      );
      if (!btn) {
        return;
      }
      const isFullscreen = this.state === "fullscreen";
      btn.classList.toggle("wp-desktop-window__btn--active", isFullscreen);
      btn.setAttribute("aria-pressed", isFullscreen ? "true" : "false");
      btn.setAttribute(
        "aria-label",
        isFullscreen ? __("Exit fullscreen") : __("Enter fullscreen")
      );
    }
    /**
     * Open the window's current URL in a new browser tab as classic
     * wp-admin.
     *
     * Strips the chromeless `wp_desktop` flag and the transient
     * `wp_desktop_portal` flag, and tags the URL with
     * `wp_desktop_classic=1` so the server-side admin_init redirect
     * (which otherwise forwards plain admin URLs to `/wp-desktop/`)
     * lets the request through. The tag only has to survive the first
     * request; once the browser renders the page, the user's in-tab
     * navigation returns to normal admin flow.
     *
     * The desktop window itself stays open — detach is a branch, not
     * a move. If the user wants to close it afterwards, they can.
     */
    detach() {
      const current = this.getCurrentUrl();
      let url;
      try {
        url = new URL(current, INITIAL_ORIGIN$1);
      } catch {
        return;
      }
      if (url.origin !== INITIAL_ORIGIN$1) {
        return;
      }
      url.searchParams.delete("wp_desktop");
      url.searchParams.delete("wp_desktop_portal");
      url.searchParams.set("wp_desktop_classic", "1");
      window.open(url.toString(), "_blank", "noopener");
      doAction(HOOKS.WINDOW_DETACHED, { windowId: this.id, url: url.toString() });
    }
    /**
     * Close and destroy the window.
     *
     * Plays a subtle closing animation before removing the element.
     */
    close() {
      if (this._isDestroyed) {
        return;
      }
      if (this.config.native) {
        const proceed = applyFilters(
          HOOKS.NATIVE_WINDOW_BEFORE_CLOSE,
          true,
          { windowId: this.id, config: this.config }
        );
        if (proceed === false) {
          return;
        }
      }
      this._isDestroyed = true;
      this._bodyResizeObserver?.disconnect();
      this._bodyResizeObserver = null;
      try {
        this.config.onClose?.();
      } catch (err) {
        doAction(HOOKS.SHELL_ERROR, {
          scope: "native-window-close",
          id: this.id,
          error: err
        });
      }
      this.onClose?.(this);
      this.element.classList.add("wp-desktop-window--closing");
      let removed = false;
      const onDone = () => {
        if (removed) {
          return;
        }
        removed = true;
        window.removeEventListener("message", this._boundOnMessage);
        if (this._boundOnDocumentPointerDown) {
          document.removeEventListener(
            "pointerdown",
            this._boundOnDocumentPointerDown,
            true
          );
        }
        this.element.remove();
        updateFullscreenBodyClass();
      };
      const onTransitionEnd = (e) => {
        if (e.propertyName === "opacity") {
          this.element.removeEventListener("transitionend", onTransitionEnd);
          onDone();
        }
      };
      this.element.addEventListener("transitionend", onTransitionEnd);
      setTimeout(onDone, 300);
    }
    /**
     * Wire up a ResizeObserver on the body element. Fires the
     * inline `config.onResize` callback AND the
     * `WINDOW_BODY_RESIZED` hook on every size change. Returns the
     * observer so `close()` can disconnect it; returns null when
     * the body element is missing or the environment has no
     * ResizeObserver (jsdom without a shim, older browsers).
     */
    installBodyResizeObserver() {
      const body = this.element.querySelector(
        ".wp-desktop-window__body"
      );
      if (!body) {
        return null;
      }
      if (typeof ResizeObserver === "undefined") {
        return null;
      }
      const observer = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (!entry) {
          return;
        }
        const cr = entry.contentRect;
        const width = Math.round(cr.width);
        const height = Math.round(cr.height);
        try {
          this.config.onResize?.(width, height);
        } catch (err) {
          doAction(HOOKS.SHELL_ERROR, {
            scope: "native-window-resize",
            id: this.id,
            error: err
          });
        }
        doAction(HOOKS.WINDOW_BODY_RESIZED, {
          windowId: this.id,
          width,
          height
        });
      });
      observer.observe(body);
      return observer;
    }
    /** Get a snapshot of the window state for persistence. */
    getSnapshot() {
      const isHidden = this.element.offsetParent === null;
      if (isHidden) {
        const parse = (raw) => {
          const n = parseFloat(raw);
          return Number.isFinite(n) ? Math.round(n) : 0;
        };
        return {
          id: this.id,
          x: parse(this.element.style.left),
          y: parse(this.element.style.top),
          width: parse(this.element.style.width),
          height: parse(this.element.style.height),
          state: this.state
        };
      }
      return {
        id: this.id,
        x: this.element.offsetLeft,
        y: this.element.offsetTop,
        width: this.element.offsetWidth,
        height: this.element.offsetHeight,
        state: this.state
      };
    }
    /** Number of external sub-tabs currently open on this window. */
    getExternalTabCount() {
      return externalTabCount(this);
    }
    /** Serializable snapshot of this window's external sub-tabs. */
    getExternalTabsSnapshot() {
      return externalTabsSnapshot(this);
    }
    /**
     * Toggle the actions menu from an external caller (e.g., keyboard
     * shortcut). Kept here so the panel-focus + outside-click wiring
     * lives in a single place.
     */
    toggleActionsMenu() {
      toggleActionsMenu(this);
    }
    /** Close the actions menu from an external caller. */
    closeActionsMenu() {
      closeActionsMenu(this);
    }
    /** Open the actions menu from an external caller. */
    openActionsMenu() {
      openActionsMenu(this);
    }
  }
  function isValidGrid(candidate, windowCount) {
    if (!candidate || typeof candidate !== "object") {
      return false;
    }
    const c = candidate.cols;
    const r = candidate.rows;
    if (typeof c !== "number" || typeof r !== "number") {
      return false;
    }
    if (!Number.isFinite(c) || !Number.isFinite(r)) {
      return false;
    }
    if (c < 1 || r < 1) {
      return false;
    }
    return Math.floor(c) * Math.floor(r) >= windowCount;
  }
  function isValidCellSize(candidate) {
    if (!candidate || typeof candidate !== "object") {
      return false;
    }
    const w = candidate.cellWidth;
    const h = candidate.cellHeight;
    if (typeof w !== "number" || typeof h !== "number") {
      return false;
    }
    if (!Number.isFinite(w) || !Number.isFinite(h)) {
      return false;
    }
    return w > 0 && h > 0;
  }
  function pickGridDimensions(n, width, height) {
    if (n <= 1) {
      return { cols: 1, rows: 1 };
    }
    const areaAspect = width / Math.max(1, height);
    const max = 6;
    let best = { cols: n, rows: 1, score: Infinity };
    for (let cols = 1; cols <= Math.min(max, n); cols++) {
      const rows = Math.min(max, Math.ceil(n / cols));
      if (cols * rows < n) {
        continue;
      }
      const cellAspect = width / cols / Math.max(1, height / rows);
      const aspectDelta = Math.abs(cellAspect - areaAspect);
      const emptyCells = cols * rows - n;
      const score = aspectDelta + emptyCells * 0.05;
      if (score < best.score) {
        best = { cols, rows, score };
      }
    }
    return { cols: best.cols, rows: best.rows };
  }
  function computeOverviewLayout(windows, rect, topInset = 0) {
    const n = windows.length;
    if (n === 0) {
      return [];
    }
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    const padding = 40;
    const gap = 24;
    const labelReserve = 34;
    const cellWidth = (rect.width - padding * 2 - gap * (cols - 1)) / cols;
    const cellHeight = (rect.height - padding * 2 - topInset - gap * (rows - 1)) / rows;
    const thumbCellHeight = Math.max(40, cellHeight - labelReserve);
    return windows.map((win, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const cellX = rect.left + padding + col * (cellWidth + gap);
      const cellY = rect.top + topInset + padding + row * (cellHeight + gap) + labelReserve;
      const sourceW = win.element.offsetWidth;
      const sourceH = win.element.offsetHeight;
      const scale = Math.min(
        cellWidth / sourceW,
        thumbCellHeight / sourceH
      );
      const scaledW = sourceW * scale;
      const scaledH = sourceH * scale;
      return {
        win,
        x: cellX + (cellWidth - scaledW) / 2,
        y: cellY + (thumbCellHeight - scaledH) / 2,
        scale
      };
    });
  }
  const OVERVIEW_TOP_BAR_RESERVE = 120;
  function enterOverview(mgr) {
    if (mgr._overviewActive) {
      return;
    }
    const eligible = mgr._stack.filter(
      (w) => w.state !== "minimized" && w.config.desktopId === mgr._activeDesktopId
    );
    mgr._overviewActive = true;
    doAction(HOOKS.OVERVIEW_ENTERING, {});
    mgr._overviewSnapshot.clear();
    for (const w of eligible) {
      mgr._overviewSnapshot.set(w.id, {
        transform: w.element.style.transform || "",
        transition: w.element.style.transition || ""
      });
    }
    for (const w of eligible) {
      if (w.state === "fullscreen") {
        w.toggleFullscreen();
      }
    }
    const dockEl = document.getElementById("wp-desktop-dock");
    const dockWidth = dockEl ? dockEl.offsetWidth : 0;
    const currentRect = mgr._desktop.getBoundingClientRect();
    const targetRect = new DOMRect(
      0,
      0,
      currentRect.width + dockWidth,
      currentRect.height
    );
    mgr._desktop.classList.add("wp-desktop-area--overview");
    const shell = document.getElementById("wp-desktop-shell");
    shell?.classList.add("wp-desktop-shell--overview");
    mgr._overviewTopBar = buildOverviewTopBar(mgr);
    mgr._desktop.appendChild(mgr._overviewTopBar);
    const layout = computeOverviewLayout(
      eligible,
      targetRect,
      OVERVIEW_TOP_BAR_RESERVE
    );
    mgr._overviewLabels.clear();
    for (const item of layout) {
      const el = item.win.element;
      el.classList.add("wp-desktop-window--overview");
      const dx = item.x - el.offsetLeft;
      const dy = item.y - el.offsetTop;
      el.style.transform = `translate(${dx}px, ${dy}px) scale(${item.scale})`;
      const label = createOverviewLabel(item);
      el.insertAdjacentElement("afterend", label);
      mgr._overviewLabels.set(item.win.id, label);
    }
    const pressTargetForEvent = (e) => {
      const target = e.target;
      const winEl = target?.closest(
        ".wp-desktop-window--overview"
      );
      if (winEl) {
        return {
          id: winEl.id.replace(/^wp-window-/, ""),
          element: winEl
        };
      }
      if (target === mgr._desktop) {
        return { id: "backdrop", element: mgr._desktop };
      }
      return null;
    };
    mgr._overviewPointerDownHandler = (e) => {
      if (e.button !== 0) {
        mgr._overviewPressTarget = null;
        return;
      }
      mgr._overviewPressTarget = pressTargetForEvent(e);
      if (mgr._overviewPressTarget) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    mgr._overviewPointerUpHandler = (e) => {
      if (e.button !== 0) {
        return;
      }
      const pressed = mgr._overviewPressTarget;
      mgr._overviewPressTarget = null;
      if (!pressed) {
        return;
      }
      const rect = pressed.element.getBoundingClientRect();
      const inside = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
      if (!inside) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (pressed.id === "backdrop") {
        exitOverview(mgr);
        return;
      }
      const selected = mgr.getById(pressed.id);
      doAction(HOOKS.OVERVIEW_WINDOW_CLICK, { windowId: pressed.id });
      exitOverview(mgr, selected, true);
    };
    mgr._overviewKeyHandler = (e) => {
      if (e.key === "Escape") {
        exitOverview(mgr);
      }
    };
    mgr._desktop.addEventListener(
      "pointerdown",
      mgr._overviewPointerDownHandler,
      true
    );
    mgr._desktop.addEventListener(
      "pointerup",
      mgr._overviewPointerUpHandler,
      true
    );
    mgr._overviewClickBlocker = (e) => {
      const target = e.target;
      if (target?.closest(".wp-desktop-overview-top-bar")) {
        return;
      }
      e.stopPropagation();
      e.preventDefault();
    };
    mgr._desktop.addEventListener(
      "click",
      mgr._overviewClickBlocker,
      true
    );
    document.addEventListener("keydown", mgr._overviewKeyHandler);
    mgr._lastOverviewHoverId = null;
    mgr._overviewMouseHandler = (e) => {
      const target = e.target;
      const winEl = target?.closest(
        ".wp-desktop-window--overview"
      );
      const newId = winEl ? winEl.id.replace(/^wp-window-/, "") : null;
      if (newId === mgr._lastOverviewHoverId) {
        return;
      }
      if (mgr._lastOverviewHoverId) {
        doAction(HOOKS.OVERVIEW_WINDOW_UNHOVER, {
          windowId: mgr._lastOverviewHoverId
        });
      }
      if (newId) {
        doAction(HOOKS.OVERVIEW_WINDOW_HOVER, { windowId: newId });
      }
      mgr._lastOverviewHoverId = newId;
    };
    mgr._desktop.addEventListener("mouseover", mgr._overviewMouseHandler);
    window.setTimeout(() => {
      if (mgr._overviewActive) {
        doAction(HOOKS.OVERVIEW_ENTERED, {});
      }
    }, 300);
  }
  function buildOverviewTopBar(mgr) {
    const bar = document.createElement("div");
    bar.className = "wp-desktop-overview-top-bar";
    const list = document.createElement("div");
    list.className = "wp-desktop-overview-top-bar__list";
    bar.appendChild(list);
    for (const d of mgr._desktops) {
      list.appendChild(buildDesktopTile(mgr, d));
    }
    const addTile = document.createElement("button");
    addTile.type = "button";
    addTile.className = "wp-desktop-overview-top-bar__tile wp-desktop-overview-top-bar__tile--add";
    addTile.setAttribute("aria-label", __("Add new desktop"));
    addTile.innerHTML = '<span class="wp-desktop-overview-top-bar__tile-plus" aria-hidden="true">+</span>';
    addTile.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const created = createDesktop(mgr);
      exitOverviewToDesktop(mgr, created.id);
    });
    list.appendChild(addTile);
    return bar;
  }
  function buildDesktopTile(mgr, d) {
    const tile2 = document.createElement("button");
    tile2.type = "button";
    tile2.className = "wp-desktop-overview-top-bar__tile";
    tile2.dataset.desktopId = d.id;
    if (d.id === mgr._activeDesktopId) {
      tile2.classList.add("wp-desktop-overview-top-bar__tile--active");
    }
    tile2.setAttribute("aria-label", sprintf(__("Switch to %s"), d.label));
    const preview = document.createElement("span");
    preview.className = "wp-desktop-overview-top-bar__tile-preview";
    const count = mgr._stack.filter(
      (w) => w.config.desktopId === d.id
    ).length;
    if (count > 0) {
      const badge = document.createElement("span");
      badge.className = "wp-desktop-overview-top-bar__tile-count";
      badge.textContent = String(count);
      preview.appendChild(badge);
    }
    tile2.appendChild(preview);
    const label = document.createElement("span");
    label.className = "wp-desktop-overview-top-bar__tile-label";
    label.textContent = d.label;
    tile2.appendChild(label);
    const closeBtn = document.createElement("span");
    closeBtn.className = "wp-desktop-overview-top-bar__tile-close";
    closeBtn.setAttribute("role", "button");
    closeBtn.setAttribute("tabindex", "0");
    closeBtn.setAttribute("aria-label", sprintf(__("Close %s"), d.label));
    closeBtn.innerHTML = '<svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
    closeBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeDesktop(mgr, d.id);
      refreshOverviewTopBar(mgr);
    });
    tile2.appendChild(closeBtn);
    tile2.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      exitOverviewToDesktop(mgr, d.id);
    });
    return tile2;
  }
  function refreshOverviewTopBar(mgr) {
    if (!mgr._overviewTopBar) {
      return;
    }
    const fresh = buildOverviewTopBar(mgr);
    mgr._overviewTopBar.replaceWith(fresh);
    mgr._overviewTopBar = fresh;
  }
  function exitOverviewToDesktop(mgr, desktopId) {
    switchDesktop(mgr, desktopId);
    exitOverview(mgr);
  }
  function createOverviewLabel(item) {
    const label = document.createElement("div");
    label.className = "wp-desktop-overview-label";
    label.dataset.windowId = item.win.id;
    const thumbW = item.win.element.offsetWidth * item.scale;
    label.style.left = `${item.x}px`;
    label.style.top = `${item.y - 34}px`;
    label.style.width = `${thumbW}px`;
    const iconClass = item.win.config.icon || "dashicons-admin-generic";
    const icon = document.createElement("span");
    icon.className = `wp-desktop-overview-label__icon dashicons ${iconClass}`;
    icon.setAttribute("aria-hidden", "true");
    label.appendChild(icon);
    const title = document.createElement("span");
    title.className = "wp-desktop-overview-label__title";
    title.textContent = item.win.config.title;
    label.appendChild(title);
    const tabCount = item.win.getExternalTabCount();
    if (tabCount > 0) {
      const meta = document.createElement("span");
      meta.className = "wp-desktop-overview-label__meta";
      meta.textContent = sprintf(
        // translators: %d is the number of external sub-tabs open on this window.
        _n("· %d open tab", "· %d open tabs", tabCount),
        tabCount
      );
      label.appendChild(meta);
    }
    return label;
  }
  function exitOverview(mgr, selected, maximize = false) {
    if (!mgr._overviewActive) {
      return;
    }
    mgr._overviewActive = false;
    doAction(HOOKS.OVERVIEW_EXITING, {
      windowId: selected && maximize ? selected.id : void 0,
      reason: selected && maximize ? "select" : "cancel"
    });
    mgr._desktop.classList.remove("wp-desktop-area--overview");
    const shell = document.getElementById("wp-desktop-shell");
    shell?.classList.remove("wp-desktop-shell--overview");
    for (const [id, snap] of mgr._overviewSnapshot) {
      const w = mgr.getById(id);
      if (!w) {
        continue;
      }
      w.element.style.transform = snap.transform;
    }
    if (selected && maximize) {
      mgr.focus(selected);
      selected.maximize();
    }
    for (const label of mgr._overviewLabels.values()) {
      label.classList.add("wp-desktop-overview-label--out");
    }
    if (mgr._overviewTopBar) {
      mgr._overviewTopBar.classList.add(
        "wp-desktop-overview-top-bar--out"
      );
    }
    const ANIMATION_MS = 280;
    window.setTimeout(() => {
      for (const w of mgr._stack) {
        w.element.classList.remove("wp-desktop-window--overview");
      }
      for (const label of mgr._overviewLabels.values()) {
        label.remove();
      }
      mgr._overviewLabels.clear();
      mgr._overviewSnapshot.clear();
      if (mgr._overviewTopBar) {
        mgr._overviewTopBar.remove();
        mgr._overviewTopBar = null;
      }
      if (mgr._overviewClickBlocker) {
        mgr._desktop.removeEventListener(
          "click",
          mgr._overviewClickBlocker,
          true
        );
        mgr._overviewClickBlocker = null;
      }
      doAction(HOOKS.OVERVIEW_EXITED, {
        windowId: selected && maximize ? selected.id : void 0,
        reason: selected && maximize ? "select" : "cancel"
      });
    }, ANIMATION_MS);
    if (mgr._overviewPointerDownHandler) {
      mgr._desktop.removeEventListener(
        "pointerdown",
        mgr._overviewPointerDownHandler,
        true
      );
      mgr._overviewPointerDownHandler = null;
    }
    if (mgr._overviewPointerUpHandler) {
      mgr._desktop.removeEventListener(
        "pointerup",
        mgr._overviewPointerUpHandler,
        true
      );
      mgr._overviewPointerUpHandler = null;
    }
    mgr._overviewPressTarget = null;
    if (mgr._overviewKeyHandler) {
      document.removeEventListener("keydown", mgr._overviewKeyHandler);
      mgr._overviewKeyHandler = null;
    }
    if (mgr._overviewMouseHandler) {
      mgr._desktop.removeEventListener(
        "mouseover",
        mgr._overviewMouseHandler
      );
      mgr._overviewMouseHandler = null;
    }
    if (mgr._lastOverviewHoverId) {
      doAction(HOOKS.OVERVIEW_WINDOW_UNHOVER, {
        windowId: mgr._lastOverviewHoverId
      });
      mgr._lastOverviewHoverId = null;
    }
  }
  function getDesktops(mgr) {
    return [...mgr._desktops];
  }
  function getActiveDesktop(mgr) {
    const found = mgr._desktops.find((d) => d.id === mgr._activeDesktopId);
    return found ?? mgr._desktops[0];
  }
  function getActiveDesktopId(mgr) {
    return getActiveDesktop(mgr).id;
  }
  function applyDesktopVisibility(mgr, win) {
    const visible = win.config.desktopId === mgr._activeDesktopId;
    win.element.style.display = visible ? "" : "none";
  }
  function refreshDesktopVisibility(mgr) {
    for (const w of mgr._stack) {
      applyDesktopVisibility(mgr, w);
    }
  }
  function createDesktop(mgr) {
    mgr._desktopSeq++;
    const desktop = {
      id: `desktop-${mgr._desktopSeq}`,
      // translators: %d is the desktop number (e.g., "Desktop 2")
      label: sprintf(__("Desktop %d"), mgr._desktopSeq)
    };
    mgr._desktops.push(desktop);
    doAction(HOOKS.DESKTOP_CREATED, { desktopId: desktop.id });
    return desktop;
  }
  function switchDesktop(mgr, id) {
    if (id === mgr._activeDesktopId) {
      return;
    }
    if (!mgr._desktops.some((d) => d.id === id)) {
      return;
    }
    const previousId = mgr._activeDesktopId;
    mgr._activeDesktopId = id;
    refreshDesktopVisibility(mgr);
    const topOnNew = [...mgr._stack].reverse().find(
      (w) => w.config.desktopId === id && w.state !== "minimized"
    );
    if (topOnNew) {
      mgr.focus(topOnNew);
    }
    doAction(HOOKS.DESKTOP_SWITCHED, {
      from: previousId,
      to: id
    });
  }
  function closeDesktop(mgr, id) {
    if (mgr._desktops.length <= 1) {
      return;
    }
    const idx = mgr._desktops.findIndex((d) => d.id === id);
    if (idx === -1) {
      return;
    }
    const survivorIdx = idx > 0 ? idx - 1 : 1;
    const survivor = mgr._desktops[survivorIdx];
    for (const w of mgr._stack) {
      if (w.config.desktopId === id) {
        w.config.desktopId = survivor.id;
      }
    }
    mgr._desktops.splice(idx, 1);
    const wasActive = mgr._activeDesktopId === id;
    if (wasActive) {
      mgr._activeDesktopId = survivor.id;
    }
    if (mgr._overviewActive) {
      relayoutOverviewForActiveDesktop(mgr);
    } else {
      refreshDesktopVisibility(mgr);
    }
    doAction(HOOKS.DESKTOP_CLOSED, {
      desktopId: id,
      migratedTo: survivor.id
    });
  }
  function relayoutOverviewForActiveDesktop(mgr) {
    for (const [winId, snap] of mgr._overviewSnapshot) {
      const w = mgr.getById(winId);
      if (w) {
        w.element.style.transform = snap.transform;
        w.element.style.transition = snap.transition;
        w.element.classList.remove("wp-desktop-window--overview");
      }
    }
    for (const label of mgr._overviewLabels.values()) {
      label.remove();
    }
    mgr._overviewLabels.clear();
    mgr._overviewSnapshot.clear();
    refreshDesktopVisibility(mgr);
    const eligible = mgr._stack.filter(
      (w) => w.state !== "minimized" && w.config.desktopId === mgr._activeDesktopId
    );
    if (eligible.length === 0) {
      return;
    }
    for (const w of eligible) {
      mgr._overviewSnapshot.set(w.id, {
        transform: w.element.style.transform || "",
        transition: w.element.style.transition || ""
      });
    }
    const live = mgr._desktop.getBoundingClientRect();
    const targetRect = new DOMRect(0, 0, live.width, live.height);
    const layout = computeOverviewLayout(
      eligible,
      targetRect,
      OVERVIEW_TOP_BAR_RESERVE
    );
    for (const item of layout) {
      const el = item.win.element;
      el.classList.add("wp-desktop-window--overview");
      const dx = item.x - el.offsetLeft;
      const dy = item.y - el.offsetTop;
      el.style.transform = `translate(${dx}px, ${dy}px) scale(${item.scale})`;
      const label = createOverviewLabel(item);
      el.insertAdjacentElement("afterend", label);
      mgr._overviewLabels.set(item.win.id, label);
    }
  }
  function seedDesktops(mgr, desktops, activeDesktopId) {
    if (desktops.length === 0) {
      return;
    }
    mgr._desktops = desktops.map((d) => ({ ...d }));
    mgr._activeDesktopId = desktops.some((d) => d.id === activeDesktopId) ? activeDesktopId : desktops[0].id;
    let highest = 0;
    for (const d of desktops) {
      const match = d.id.match(/^desktop-(\d+)$/);
      if (match) {
        const n = parseInt(match[1], 10);
        if (Number.isFinite(n) && n > highest) {
          highest = n;
        }
      }
    }
    mgr._desktopSeq = Math.max(mgr._desktopSeq, highest);
  }
  function cascade(mgr) {
    const eligible = mgr._stack.filter(
      (w) => w.config.desktopId === mgr._activeDesktopId
    );
    if (eligible.length === 0) {
      return;
    }
    doAction(HOOKS.ARRANGE_CASCADE_STARTING, {
      windowCount: eligible.length
    });
    for (const w of eligible) {
      if (w.state === "fullscreen") {
        w.toggleFullscreen();
      }
      if (w.state === "maximized") {
        w.toggleMaximize();
      }
      if (w.state === "minimized") {
        w.restore();
      }
    }
    const rect = mgr._desktop.getBoundingClientRect();
    const padding = 30;
    const offset = 30;
    const targetWidth = Math.min(Math.round(rect.width * 0.7), 1100);
    const targetHeight = Math.min(Math.round(rect.height * 0.75), 750);
    const maxStepsX = Math.max(
      1,
      Math.floor((rect.width - targetWidth - padding) / offset)
    );
    const maxStepsY = Math.max(
      1,
      Math.floor((rect.height - targetHeight - padding) / offset)
    );
    const maxSteps = Math.min(maxStepsX, maxStepsY);
    eligible.forEach((w, i) => {
      const step2 = i % Math.max(1, maxSteps);
      w.element.style.left = `${padding + step2 * offset}px`;
      w.element.style.top = `${padding + step2 * offset}px`;
      w.element.style.width = `${targetWidth}px`;
      w.element.style.height = `${targetHeight}px`;
    });
    const focused = mgr.getFocused();
    if (focused) {
      mgr.focus(focused);
    }
    document.dispatchEvent(
      new CustomEvent("wp-desktop-window-changed", {
        detail: { reason: "cascade" }
      })
    );
    doAction(HOOKS.ARRANGE_CASCADE_APPLIED, {
      windowCount: eligible.length
    });
  }
  function tile(mgr) {
    const eligible = mgr._stack.filter(
      (w) => w.config.desktopId === mgr._activeDesktopId
    );
    if (eligible.length === 0) {
      return;
    }
    for (const w of eligible) {
      if (w.state === "fullscreen") {
        w.toggleFullscreen();
      }
      if (w.state === "maximized") {
        w.toggleMaximize();
      }
      if (w.state === "minimized") {
        w.restore();
      }
    }
    const rect = mgr._desktop.getBoundingClientRect();
    const auto = pickGridDimensions(
      eligible.length,
      rect.width,
      rect.height
    );
    const filtered = applyFilters(
      HOOKS.ARRANGE_TILE_DIMENSIONS,
      auto,
      {
        windowCount: eligible.length,
        areaWidth: rect.width,
        areaHeight: rect.height
      }
    );
    const { cols, rows } = isValidGrid(filtered, eligible.length) ? { cols: Math.floor(filtered.cols), rows: Math.floor(filtered.rows) } : auto;
    doAction(HOOKS.ARRANGE_TILE_STARTING, {
      windowCount: eligible.length,
      cols,
      rows
    });
    const padding = 16;
    const gap = 12;
    const cellWidth = Math.floor(
      (rect.width - padding * 2 - gap * (cols - 1)) / cols
    );
    const cellHeight = Math.floor(
      (rect.height - padding * 2 - gap * (rows - 1)) / rows
    );
    eligible.forEach((w, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      w.element.style.left = `${padding + col * (cellWidth + gap)}px`;
      w.element.style.top = `${padding + row * (cellHeight + gap)}px`;
      w.element.style.width = `${cellWidth}px`;
      w.element.style.height = `${cellHeight}px`;
    });
    const focused = mgr.getFocused();
    if (focused) {
      mgr.focus(focused);
    }
    document.dispatchEvent(
      new CustomEvent("wp-desktop-window-changed", {
        detail: { reason: "tile" }
      })
    );
    doAction(HOOKS.ARRANGE_TILE_APPLIED, {
      windowCount: eligible.length,
      cols,
      rows
    });
  }
  const SNAP_STORAGE_KEY = "wp-desktop-snap-to-grid";
  function loadSnapEnabled() {
    try {
      return window.localStorage.getItem(SNAP_STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  }
  function setSnapEnabled(mgr, enabled) {
    if (mgr._snapEnabled === enabled) {
      return;
    }
    mgr._snapEnabled = enabled;
    try {
      window.localStorage.setItem(SNAP_STORAGE_KEY, enabled ? "1" : "0");
    } catch {
    }
    doAction(HOOKS.ARRANGE_SNAP_CHANGED, { enabled });
  }
  function getSnapConfig(mgr) {
    if (!mgr._snapEnabled) {
      return { enabled: false, cellWidth: 0, cellHeight: 0 };
    }
    const rect = mgr._desktop.getBoundingClientRect();
    const targetCols = rect.width >= rect.height ? 12 : 8;
    const auto = {
      cellWidth: Math.max(40, Math.round(rect.width / targetCols)),
      cellHeight: Math.max(
        40,
        Math.round(rect.height / Math.round(targetCols * 0.66))
      )
    };
    const filtered = applyFilters(
      HOOKS.ARRANGE_SNAP_CELL_SIZE,
      auto,
      { areaWidth: rect.width, areaHeight: rect.height }
    );
    const { cellWidth, cellHeight } = isValidCellSize(filtered) ? filtered : auto;
    return { enabled: true, cellWidth, cellHeight };
  }
  function enterSplitOverview(mgr, anchor, zone) {
    if (mgr._splitOverviewActive) {
      return;
    }
    mgr._splitOverviewActive = true;
    mgr._splitOverviewAnchor = anchor;
    mgr._splitOverviewZone = zone;
    const eligible = mgr._stack.filter(
      (w) => w !== anchor && w.state !== "minimized" && w.config.desktopId === mgr._activeDesktopId
    );
    if (eligible.length === 0) {
      cleanupSplitOverviewState(mgr);
      return;
    }
    mgr._splitOverviewSnapshot.clear();
    for (const w of eligible) {
      mgr._splitOverviewSnapshot.set(w.id, {
        transform: w.element.style.transform || "",
        transition: w.element.style.transition || ""
      });
    }
    mgr._desktop.classList.add("wp-desktop-area--split-overview");
    const rect = oppositeHalfRect(mgr, zone);
    const layout = computeOverviewLayout(eligible, rect, 0);
    mgr._splitOverviewLabels.clear();
    for (const item of layout) {
      const el = item.win.element;
      el.classList.add("wp-desktop-window--overview");
      const dx = item.x - el.offsetLeft;
      const dy = item.y - el.offsetTop;
      el.style.transform = `translate(${dx}px, ${dy}px) scale(${item.scale})`;
      const label = createOverviewLabel(item);
      el.insertAdjacentElement("afterend", label);
      mgr._splitOverviewLabels.set(item.win.id, label);
    }
    const pressTargetForEvent = (e) => {
      const target = e.target;
      const winEl = target?.closest(
        ".wp-desktop-window--overview"
      );
      if (winEl) {
        return {
          id: winEl.id.replace(/^wp-window-/, ""),
          element: winEl
        };
      }
      if (target) {
        return { id: "dismiss", element: mgr._desktop };
      }
      return null;
    };
    mgr._splitOverviewPointerDown = (e) => {
      if (e.button !== 0) {
        mgr._splitOverviewPressTarget = null;
        return;
      }
      mgr._splitOverviewPressTarget = pressTargetForEvent(e);
      if (mgr._splitOverviewPressTarget) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    mgr._splitOverviewPointerUp = (e) => {
      if (e.button !== 0) {
        return;
      }
      const pressed = mgr._splitOverviewPressTarget;
      mgr._splitOverviewPressTarget = null;
      if (!pressed) {
        return;
      }
      const r = pressed.element.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (!inside) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (pressed.id === "dismiss") {
        exitSplitOverview(mgr);
        return;
      }
      const selected = mgr.getById(pressed.id);
      if (!selected) {
        exitSplitOverview(mgr);
        return;
      }
      fillOppositeHalfAndExit(mgr, selected);
    };
    mgr._splitOverviewKey = (e) => {
      if (e.key === "Escape") {
        exitSplitOverview(mgr);
      }
    };
    mgr._splitOverviewClickBlocker = (e) => {
      e.stopPropagation();
      e.preventDefault();
    };
    mgr._desktop.addEventListener(
      "pointerdown",
      mgr._splitOverviewPointerDown,
      true
    );
    mgr._desktop.addEventListener(
      "pointerup",
      mgr._splitOverviewPointerUp,
      true
    );
    mgr._desktop.addEventListener(
      "click",
      mgr._splitOverviewClickBlocker,
      true
    );
    document.addEventListener("keydown", mgr._splitOverviewKey);
  }
  function fillOppositeHalfAndExit(mgr, selected) {
    const anchorZone = mgr._splitOverviewZone;
    if (!anchorZone) {
      exitSplitOverview(mgr);
      return;
    }
    const partnerZone = anchorZone === "left" ? "right" : "left";
    selected.element.style.transform = "";
    selected.element.classList.remove("wp-desktop-window--overview");
    selected.applySnap(partnerZone);
    mgr._splitOverviewSnapshot.delete(selected.id);
    mgr.focus(selected);
    doAction(HOOKS.SNAP_SPLIT_FILLED, {
      windowId: selected.id,
      zone: partnerZone
    });
    exitSplitOverview(mgr);
  }
  function exitSplitOverview(mgr) {
    if (!mgr._splitOverviewActive) {
      return;
    }
    mgr._splitOverviewActive = false;
    for (const [id, snap] of mgr._splitOverviewSnapshot) {
      const w = mgr.getById(id);
      if (!w) {
        continue;
      }
      w.element.style.transform = snap.transform;
    }
    for (const label of mgr._splitOverviewLabels.values()) {
      label.classList.add("wp-desktop-overview-label--out");
    }
    mgr._desktop.classList.remove("wp-desktop-area--split-overview");
    const ANIMATION_MS = 260;
    window.setTimeout(() => {
      for (const w of mgr._stack) {
        if (mgr._splitOverviewSnapshot.has(w.id)) {
          w.element.classList.remove("wp-desktop-window--overview");
        }
      }
      for (const label of mgr._splitOverviewLabels.values()) {
        label.remove();
      }
      cleanupSplitOverviewState(mgr);
    }, ANIMATION_MS);
    if (mgr._splitOverviewPointerDown) {
      mgr._desktop.removeEventListener(
        "pointerdown",
        mgr._splitOverviewPointerDown,
        true
      );
      mgr._splitOverviewPointerDown = null;
    }
    if (mgr._splitOverviewPointerUp) {
      mgr._desktop.removeEventListener(
        "pointerup",
        mgr._splitOverviewPointerUp,
        true
      );
      mgr._splitOverviewPointerUp = null;
    }
    if (mgr._splitOverviewClickBlocker) {
      mgr._desktop.removeEventListener(
        "click",
        mgr._splitOverviewClickBlocker,
        true
      );
      mgr._splitOverviewClickBlocker = null;
    }
    if (mgr._splitOverviewKey) {
      document.removeEventListener("keydown", mgr._splitOverviewKey);
      mgr._splitOverviewKey = null;
    }
    mgr._splitOverviewPressTarget = null;
  }
  function cleanupSplitOverviewState(mgr) {
    mgr._splitOverviewSnapshot.clear();
    mgr._splitOverviewLabels.clear();
    mgr._splitOverviewAnchor = null;
    mgr._splitOverviewZone = null;
    mgr._splitOverviewActive = false;
  }
  const SNAP_EDGE_THRESHOLD = 30;
  const SNAP_COMMIT_MS = 260;
  function detectSnapZone(clientX, desktopRect) {
    if (clientX <= desktopRect.left + SNAP_EDGE_THRESHOLD) {
      return "left";
    }
    if (clientX >= desktopRect.right - SNAP_EDGE_THRESHOLD) {
      return "right";
    }
    return null;
  }
  function snapZoneBounds(mgr, zone) {
    const rect = mgr._desktop.getBoundingClientRect();
    const halfW = Math.floor(rect.width / 2);
    const height = Math.floor(rect.height);
    return {
      x: zone === "left" ? 0 : rect.width - halfW,
      y: 0,
      width: halfW,
      height
    };
  }
  function oppositeHalfRect(mgr, zone) {
    const rect = mgr._desktop.getBoundingClientRect();
    const halfW = Math.floor(rect.width / 2);
    const height = Math.floor(rect.height);
    if (zone === "left") {
      return new DOMRect(halfW, 0, halfW, height);
    }
    return new DOMRect(0, 0, halfW, height);
  }
  function showSnapPreview(mgr, zone) {
    if (mgr._snapPendingZone === zone && mgr._snapPreviewEl) {
      return;
    }
    mgr._snapPendingZone = zone;
    if (!mgr._snapPreviewEl) {
      const el = document.createElement("div");
      el.className = "wp-desktop-snap-preview";
      el.setAttribute("aria-hidden", "true");
      mgr._desktop.appendChild(el);
      mgr._snapPreviewEl = el;
      Promise.resolve().then(() => {
        el.classList.add("wp-desktop-snap-preview--visible");
      });
    }
    const b = snapZoneBounds(mgr, zone);
    mgr._snapPreviewEl.style.left = `${b.x}px`;
    mgr._snapPreviewEl.style.top = `${b.y}px`;
    mgr._snapPreviewEl.style.width = `${b.width}px`;
    mgr._snapPreviewEl.style.height = `${b.height}px`;
    mgr._snapPreviewEl.dataset.zone = zone;
  }
  function hideSnapPreview(mgr) {
    if (!mgr._snapPreviewEl) {
      mgr._snapPendingZone = null;
      return;
    }
    const el = mgr._snapPreviewEl;
    mgr._snapPreviewEl = null;
    mgr._snapPendingZone = null;
    el.classList.remove("wp-desktop-snap-preview--visible");
    window.setTimeout(() => {
      el.remove();
    }, SNAP_COMMIT_MS);
  }
  function updateSnapZoneForDrag(mgr, win, clientX) {
    if (mgr._splitOverviewActive) {
      return;
    }
    const rect = mgr._desktop.getBoundingClientRect();
    const zone = detectSnapZone(clientX, rect);
    const previous = mgr._snapPendingZone;
    if (zone) {
      showSnapPreview(mgr, zone);
      if (previous !== zone) {
        doAction(HOOKS.SNAP_ZONE_PENDING, {
          windowId: win.id,
          zone
        });
      }
    } else if (previous) {
      hideSnapPreview(mgr);
      doAction(HOOKS.SNAP_ZONE_CANCELED, { windowId: win.id });
    }
  }
  function commitSnapIfPending(mgr, win) {
    const zone = mgr._snapPendingZone;
    if (!zone) {
      return false;
    }
    hideSnapPreview(mgr);
    if (win.state === "normal") {
      win._savedGeometry = {
        x: win.element.offsetLeft,
        y: win.element.offsetTop,
        width: win.element.offsetWidth,
        height: win.element.offsetHeight
      };
    }
    win.applySnap(zone);
    doAction(HOOKS.SNAP_ZONE_COMMITTED, {
      windowId: win.id,
      zone
    });
    window.requestAnimationFrame(() => {
      enterSplitOverview(mgr, win, zone);
    });
    return true;
  }
  function abortSnapIfPending(mgr) {
    if (mgr._snapPendingZone) {
      hideSnapPreview(mgr);
    }
  }
  const BASE_Z_INDEX = 100;
  const CASCADE_OFFSET = 30;
  class WindowManager {
    constructor(desktop) {
      this._stack = [];
      this.cascadeIndex = 0;
      this._desktops = [
        // translators: default desktop name — "Desktop 1"
        { id: "desktop-1", label: "Desktop 1" }
      ];
      this._activeDesktopId = "desktop-1";
      this._desktopSeq = 1;
      this.onToggleStartupRequested = null;
      this.desktopResizeObserver = null;
      this._reflowRestoreTimer = null;
      this._snapEnabled = loadSnapEnabled();
      this._overviewActive = false;
      this._overviewSnapshot = /* @__PURE__ */ new Map();
      this._overviewLabels = /* @__PURE__ */ new Map();
      this._overviewPointerDownHandler = null;
      this._overviewPointerUpHandler = null;
      this._overviewKeyHandler = null;
      this._overviewPressTarget = null;
      this._overviewClickBlocker = null;
      this._overviewTopBar = null;
      this._overviewMouseHandler = null;
      this._lastOverviewHoverId = null;
      this._snapPendingZone = null;
      this._snapPreviewEl = null;
      this._splitOverviewActive = false;
      this._splitOverviewAnchor = null;
      this._splitOverviewZone = null;
      this._splitOverviewSnapshot = /* @__PURE__ */ new Map();
      this._splitOverviewLabels = /* @__PURE__ */ new Map();
      this._splitOverviewPointerDown = null;
      this._splitOverviewPointerUp = null;
      this._splitOverviewPressTarget = null;
      this._splitOverviewClickBlocker = null;
      this._splitOverviewKey = null;
      this._desktop = desktop;
      if (typeof ResizeObserver !== "undefined") {
        this.desktopResizeObserver = new ResizeObserver(
          () => this.reflowStatefulWindows()
        );
        this.desktopResizeObserver.observe(desktop);
      }
      this.installIframeFocusBridge();
    }
    /**
     * Clicks inside an iframe don't cross the browsing-context
     * boundary — pointerdown / focusin in the iframe's document never
     * reach the parent. BUT the parent `window` does lose focus,
     * because focus moves to the iframe's content window.
     *
     * We use that signal: listen for `window.blur` on the parent,
     * check `document.activeElement` — if it's an iframe, walk up to
     * its owning `.wp-desktop-window`, find the matching Window in
     * our stack, and focus it. Covers clicks on the primary iframe
     * AND any external-tab sub-iframes mounted as descendants of the
     * window element.
     */
    installIframeFocusBridge() {
      window.addEventListener("blur", () => {
        window.setTimeout(() => {
          const active2 = this._desktop.ownerDocument?.activeElement ?? null;
          if (!active2 || active2.tagName !== "IFRAME") {
            return;
          }
          const winEl = active2.closest(
            ".wp-desktop-window"
          );
          if (!winEl) {
            return;
          }
          const id = winEl.id.replace(/^wp-window-/, "");
          const win = this.getById(id);
          if (!win) {
            return;
          }
          if (this._overviewActive) {
            return;
          }
          if (this.getFocused() === win) {
            return;
          }
          this.focus(win);
        }, 0);
      });
    }
    /**
     * Re-apply state-driven bounds to any window whose geometry is
     * derived from the desktop area's dimensions: maximized (full
     * area) and snapped-left / snapped-right (half area). Called from
     * the desktop-area ResizeObserver so shrinking the browser window
     * drags the stateful windows along with it.
     *
     * Inlines the geometry writes instead of calling `applySnap` —
     * that method emits `_emitChange('state')` which would spam the
     * session saver on every resize tick. Viewport resize is an
     * INCOMING shape change (the shell reshaped us), not an outgoing
     * user action worth persisting.
     *
     * Also toggles `wp-desktop-window--reflowing` so the base
     * left/top/width/height transition doesn't interpolate between
     * every ResizeObserver tick — without that, the windows would
     * always lag ~250 ms behind a browser edge-drag.
     *
     * Skipped while overview is active — windows are mid-transform
     * and touching their inline geometry would desync the live
     * transform math; overview exit re-applies state correctly via
     * its own path.
     */
    reflowStatefulWindows() {
      if (this._overviewActive) {
        return;
      }
      for (const w of this._stack) {
        const parent = w.element.parentElement;
        if (!parent) {
          continue;
        }
        if (w.state === "maximized") {
          w.element.classList.add("wp-desktop-window--reflowing");
          w.element.style.width = `${parent.clientWidth}px`;
          w.element.style.height = `${parent.clientHeight}px`;
        } else if (w.state === "snapped-left" || w.state === "snapped-right") {
          w.element.classList.add("wp-desktop-window--reflowing");
          const halfW = Math.floor(parent.clientWidth / 2);
          const height = parent.clientHeight;
          const left = w.state === "snapped-left" ? 0 : halfW;
          w.element.style.left = `${left}px`;
          w.element.style.top = "0px";
          w.element.style.width = `${halfW}px`;
          w.element.style.height = `${height}px`;
        }
      }
      if (this._reflowRestoreTimer !== null) {
        window.clearTimeout(this._reflowRestoreTimer);
      }
      this._reflowRestoreTimer = window.setTimeout(() => {
        this._reflowRestoreTimer = null;
        for (const w of this._stack) {
          w.element.classList.remove("wp-desktop-window--reflowing");
        }
      }, 140);
    }
    /**
     * Open a new window — or focus an existing one — for the given
     * page.
     *
     * Matches any existing window sharing the same `baseId`
     * (defaulting to the config's `id`). For singleton pages
     * (Settings, Dashboard, …) `baseId === id`, so this behaves
     * exactly like strict id matching. For multi pages, clicking the
     * dock icon while a window is already open focuses the
     * most-recent instance rather than creating a twin.
     *
     * To force a brand-new instance alongside an existing one, use
     * {@link openNew}.
     */
    open(config) {
      const baseId = config.baseId || config.id;
      const existing = this.getByBaseIdOnActiveDesktop(baseId);
      if (existing) {
        this.focus(existing);
        if (existing.state === "minimized") {
          existing.restore();
        }
        return existing;
      }
      const id = this.getByBaseId(baseId) ? this.nextInstanceId(baseId) : config.id;
      return this.createWindow({ ...config, id, baseId });
    }
    /**
     * Open a brand-new window even if one is already open for this
     * page. Only makes sense for pages flagged `multi`.
     */
    openNew(config) {
      const baseId = config.baseId || config.id;
      const nextId = this.nextInstanceId(baseId);
      return this.createWindow({ ...config, id: nextId, baseId });
    }
    /**
     * Build and mount a window element. Common tail shared by
     * `open()` and `openNew()`.
     */
    createWindow(config) {
      const desktopRect = this._desktop.getBoundingClientRect();
      const defaultWidth = Math.min(Math.round(desktopRect.width * 0.8), 1200);
      const defaultHeight = Math.min(Math.round(desktopRect.height * 0.8), 800);
      const cascadeX = 40 + this.cascadeIndex % 8 * CASCADE_OFFSET;
      const cascadeY = 40 + this.cascadeIndex % 8 * CASCADE_OFFSET;
      const fullConfig = {
        icon: config.icon || "dashicons-admin-generic",
        x: config.x ?? cascadeX,
        y: config.y ?? cascadeY,
        width: config.width ?? defaultWidth,
        height: config.height ?? defaultHeight,
        minWidth: config.minWidth ?? 320,
        minHeight: config.minHeight ?? 200,
        ...config,
        baseId: config.baseId || config.id,
        // New windows always join the active desktop. A caller can
        // pre-seed `desktopId` (e.g. session restore) by passing it
        // in `config`, which the spread above preserves.
        desktopId: config.desktopId || this._activeDesktopId
      };
      this.cascadeIndex++;
      const win = new Window(fullConfig);
      win.onFocusRequest = (w) => this.focus(w);
      win.onClose = (w) => this.remove(w);
      win.onMinimize = () => {
        const visible = this._stack.filter((w) => w.state !== "minimized");
        if (visible.length > 0) {
          this.focus(visible[visible.length - 1]);
        }
      };
      win.onOpenAnother = (w) => {
        this.openNew({
          id: w.config.baseId || w.id,
          baseId: w.config.baseId || w.id,
          url: w.config.url || "",
          title: w.config.title,
          icon: w.config.icon,
          submenu: w.config.submenu,
          multi: true
        });
      };
      win.onToggleStartup = (w) => {
        this.onToggleStartupRequested?.(w);
      };
      win.snapConfigProvider = () => this.getSnapConfig();
      win.onDragMove = (w, clientX) => {
        updateSnapZoneForDrag(this, w, clientX);
      };
      win.onDragEnd = (w) => {
        if (this._snapPendingZone) {
          return commitSnapIfPending(this, w);
        }
        abortSnapIfPending(this);
        return false;
      };
      this._stack.push(win);
      this._desktop.appendChild(win.element);
      applyDesktopVisibility(this, win);
      win.hydrateNative();
      this.focus(win);
      const openedDetail = {
        windowId: win.id,
        page: config.url,
        title: config.title,
        url: config.url
      };
      document.dispatchEvent(
        new CustomEvent("wp-desktop-window-opened", { detail: openedDetail })
      );
      doAction(HOOKS.WINDOW_OPENED, openedDetail);
      return win;
    }
    /**
     * Find the next unused suffixed id for a given baseId. Prefers
     * the bare baseId itself if free (user closed the original), then
     * walks `-2`, `-3`, … until it lands on one not currently in the
     * stack.
     */
    nextInstanceId(baseId) {
      const taken = new Set(this._stack.map((w) => w.id));
      if (!taken.has(baseId)) {
        return baseId;
      }
      let n = 2;
      while (taken.has(`${baseId}-${n}`)) {
        n++;
      }
      return `${baseId}-${n}`;
    }
    /** Focus a window: bring it to top of z-stack. */
    focus(win) {
      const idx = this._stack.indexOf(win);
      if (idx > -1) {
        this._stack.splice(idx, 1);
      }
      this._stack.push(win);
      this._stack.forEach((w, i) => {
        w.setZIndex(BASE_Z_INDEX + i);
        w.setFocused(i === this._stack.length - 1);
      });
      const focusedDetail = { windowId: win.id };
      document.dispatchEvent(
        new CustomEvent("wp-desktop-window-focused", { detail: focusedDetail })
      );
      doAction(HOOKS.WINDOW_FOCUSED, focusedDetail);
    }
    /** Remove a window from the stack and DOM. */
    remove(win) {
      const idx = this._stack.indexOf(win);
      if (idx > -1) {
        this._stack.splice(idx, 1);
      }
      if (this._stack.length > 0) {
        this.focus(this._stack[this._stack.length - 1]);
      }
      const closingDetail = { windowId: win.id, element: win.element };
      document.dispatchEvent(
        new CustomEvent("wp-desktop-window-closing", { detail: closingDetail })
      );
      doAction(HOOKS.WINDOW_CLOSING, closingDetail);
      const closedDetail = { windowId: win.id };
      document.dispatchEvent(
        new CustomEvent("wp-desktop-window-closed", { detail: closedDetail })
      );
      doAction(HOOKS.WINDOW_CLOSED, closedDetail);
    }
    /** Get a window by its ID. */
    getById(id) {
      return this._stack.find((w) => w.id === id);
    }
    /**
     * Get the most-recently-focused window for a given baseId.
     *
     * Multi-instance windows share a baseId; the stack is ordered
     * bottom to top by focus, so iterating from the end finds the
     * best candidate to bring forward when the user re-clicks the
     * dock icon.
     */
    getByBaseId(baseId) {
      for (let i = this._stack.length - 1; i >= 0; i--) {
        const w = this._stack[i];
        if ((w.config.baseId || w.id) === baseId) {
          return w;
        }
      }
      return void 0;
    }
    /**
     * Like {@link getByBaseId} but only considers windows on the
     * currently-active virtual desktop. The dock's "open or focus"
     * path uses this — a Plugins instance that lives on Desktop 2 is
     * invisible from Desktop 1's dock click, so clicking Plugins on
     * Desktop 1 should open a fresh instance there instead of trying
     * to focus the far-off sibling (which would silently do nothing
     * because the other desktop's windows are display: none here).
     */
    getByBaseIdOnActiveDesktop(baseId) {
      for (let i = this._stack.length - 1; i >= 0; i--) {
        const w = this._stack[i];
        if ((w.config.baseId || w.id) !== baseId) {
          continue;
        }
        const winDesktop = w.config.desktopId || this._activeDesktopId;
        if (winDesktop === this._activeDesktopId) {
          return w;
        }
      }
      return void 0;
    }
    /**
     * Get every open window sharing the given baseId, ordered by
     * instance slot (bare baseId first, then `-2`, `-3`, …) rather
     * than z-order — so the dock's instance rail keeps a stable
     * left-to-right order even as the user focuses between windows.
     */
    getAllByBaseId(baseId) {
      const instanceSlot = (id) => {
        if (id === baseId) {
          return 1;
        }
        const prefix = `${baseId}-`;
        if (id.startsWith(prefix)) {
          const n = parseInt(id.slice(prefix.length), 10);
          return Number.isFinite(n) ? n : 999;
        }
        return 999;
      };
      return this._stack.filter((w) => (w.config.baseId || w.id) === baseId).sort((a, b) => instanceSlot(a.id) - instanceSlot(b.id));
    }
    /** Get all open windows. */
    getAll() {
      return [...this._stack];
    }
    /** Get the currently focused (topmost) window. */
    getFocused() {
      return this._stack.length > 0 ? this._stack[this._stack.length - 1] : void 0;
    }
    // ---- Virtual desktop delegations ----
    getDesktops() {
      return getDesktops(this);
    }
    getActiveDesktop() {
      return getActiveDesktop(this);
    }
    getActiveDesktopId() {
      return getActiveDesktopId(this);
    }
    createDesktop() {
      return createDesktop(this);
    }
    switchDesktop(id) {
      switchDesktop(this, id);
    }
    closeDesktop(id) {
      closeDesktop(this, id);
    }
    /**
     * Returns the "primary" desktop id — the one new sessions land on
     * and that batch operations like {@link closeAll} treat as the
     * survivor when an `onlyOnPrimary` mode is requested.
     *
     * Default: the first desktop in `getDesktops()`. Filterable via
     * `wp-desktop.primary-desktop-id` so downstream code that wants a
     * different convention (e.g. a pinned "Inbox" desktop) can override
     * without having to fork the manager.
     *
     * @since 0.14.0
     */
    getPrimaryDesktopId() {
      const all2 = this.getDesktops();
      const fallback = all2.length > 0 ? all2[0].id : "desktop-1";
      const filtered = applyFilters(
        HOOKS.PRIMARY_DESKTOP_ID,
        fallback,
        all2
      );
      if (typeof filtered !== "string" || filtered === "") {
        return fallback;
      }
      const exists = all2.some((d) => d.id === filtered);
      return exists ? filtered : fallback;
    }
    /**
     * Close every open window in batch.
     *
     * Hook chain:
     *
     *   1. `wp-desktop.windows.before-close-all` — action. Subscribers
     *      can prepare for the wipe (cancel pending saves, dismiss
     *      menus, etc.). Detail: `{ candidates: Window[] }`.
     *
     *   2. `wp-desktop.windows.close-all` — filter. Receives the
     *      candidate Window list and returns the (possibly smaller) list
     *      that will actually be closed. Plugins use this to PROTECT
     *      specific windows — e.g. keep a draft post window open during
     *      a "Close all" operation. Returning an empty array cancels
     *      the close entirely.
     *
     *   3. Each surviving window's `close()` is called.
     *
     *   4. `wp-desktop.windows.after-close-all` — action. Detail:
     *      `{ closed: number, skipped: Window[] }`.
     *
     * @since 0.14.0
     *
     * @param options           Close options.
     * @param options.exceptIds Window ids to skip even before the filter runs.
     * @return Number of windows actually closed.
     */
    closeAll(options) {
      const exceptSet = new Set(options?.exceptIds ?? []);
      const initialCandidates = this._stack.filter(
        (w) => !exceptSet.has(w.id)
      );
      doAction(HOOKS.WINDOWS_BEFORE_CLOSE_ALL, { candidates: initialCandidates });
      const filtered = applyFilters(
        HOOKS.WINDOWS_CLOSE_ALL,
        initialCandidates
      );
      const finalList = Array.isArray(filtered) ? filtered : initialCandidates;
      const skipped = initialCandidates.filter((w) => !finalList.includes(w));
      let closed = 0;
      for (const win of finalList.slice()) {
        try {
          win.close();
          closed++;
        } catch (err) {
          if (typeof console !== "undefined") {
            console.error(
              "[wp-desktop-mode] closeAll: window.close() threw for",
              win.id,
              err
            );
          }
        }
      }
      doAction(HOOKS.WINDOWS_AFTER_CLOSE_ALL, { closed, skipped });
      return closed;
    }
    // ---- Arrange + snap delegations ----
    cascade() {
      cascade(this);
    }
    tile() {
      tile(this);
    }
    isSnapEnabled() {
      return this._snapEnabled;
    }
    setSnapEnabled(enabled) {
      setSnapEnabled(this, enabled);
    }
    getSnapConfig() {
      return getSnapConfig(this);
    }
    // ---- Overview delegations ----
    enterOverview() {
      enterOverview(this);
    }
    exitOverview(selected, maximize = false) {
      exitOverview(this, selected, maximize);
    }
    /**
     * Snapshot every open window's current geometry + state.
     *
     * Returns a plain array of `{ windowId, rect, state, element }`
     * entries — one per window in the stack, regardless of which
     * virtual desktop owns it. Rect coordinates are in desktop-area
     * space (the same coordinate space the windows themselves use
     * inline-style left/top); `state` is the live `WindowState`, and
     * `element` is the window's outer DOM node.
     *
     * Intended for wallpaper / overlay plugins that used to scrape
     * `document.querySelectorAll('.wp-desktop-window')` + read the
     * `--minimized` / `--maximized` modifier classes by name. The
     * accessor decouples plugin code from the shell's CSS class
     * naming, so a future refactor of modifier prefixes is not an
     * ecosystem break.
     *
     * The array contains every window in the stack — callers filter
     * on `state` if they want only "actually visible" (typically
     * `state !== 'minimized'`). Minimized windows are included so
     * plugins that care about the "will be restored to X geometry"
     * case still have the data; filtering them out would be a
     * subtraction the caller can do but the provider can't reverse.
     *
     * Order matches the internal z-stack: earliest-opened first,
     * focused window last.
     */
    getVisibleRects() {
      return this._stack.map((w) => {
        const snap = w.getSnapshot();
        return {
          windowId: w.id,
          rect: {
            x: snap.x,
            y: snap.y,
            width: snap.width,
            height: snap.height
          },
          state: snap.state,
          element: w.element
        };
      });
    }
    /**
     * Serialize the current window stack for session persistence.
     *
     * Order in the returned `windows` array mirrors z-order (earliest
     * opened / lowest-z first, focused last) so restoring preserves
     * the stacking the user left behind.
     */
    snapshot() {
      const focused = this.getFocused();
      const persistable = this._stack.filter((w) => !w.config.native);
      const windows = persistable.map((w) => {
        const snap = w.getSnapshot();
        const externalTabs = w.getExternalTabsSnapshot();
        return {
          id: w.id,
          baseId: w.config.baseId || w.id,
          desktopId: w.config.desktopId || this._activeDesktopId,
          url: w.getCurrentUrl(),
          title: w.config.title,
          icon: w.config.icon,
          state: snap.state,
          x: snap.x,
          y: snap.y,
          width: snap.width,
          height: snap.height,
          ...externalTabs.length > 0 ? { externalTabs } : {}
        };
      });
      const focusedId = focused && !focused.config.native ? focused.id : "";
      return {
        windows,
        desktops: this.getDesktops(),
        activeDesktop: this._activeDesktopId,
        focused: focusedId,
        updated: Math.floor(Date.now() / 1e3)
      };
    }
    seedDesktops(desktops, activeDesktopId) {
      seedDesktops(this, desktops, activeDesktopId);
    }
  }
  function hashTitleToHue(title) {
    if (!title) {
      return 214;
    }
    let hash = 5381;
    for (let i = 0; i < title.length; i++) {
      hash = Math.imul(hash, 33) + title.charCodeAt(i);
    }
    return (hash % 360 + 360) % 360;
  }
  const _Dock = class _Dock {
    constructor(container, windowManager, items, adminUrl, orientation = "left") {
      this.itemElements = /* @__PURE__ */ new Map();
      this.systemItems = [];
      this.systemItemElements = /* @__PURE__ */ new Map();
      this.systemSeparator = null;
      this.container = container;
      this.windowManager = windowManager;
      this.items = items;
      this.adminUrl = adminUrl;
      this.orientation = orientation;
      this.container.classList.add(
        orientation === "bottom" ? "wp-desktop-dock--horizontal" : "wp-desktop-dock--vertical"
      );
      this.tooltip = document.createElement("div");
      this.tooltip.className = "wp-desktop-dock__tooltip";
      this.tooltip.setAttribute("role", "tooltip");
      if (orientation === "bottom") {
        this.tooltip.classList.add("wp-desktop-dock__tooltip--above");
      }
      document.body.appendChild(this.tooltip);
      this.render();
      this.bindWindowEvents();
    }
    /**
     * Replace the menu-derived tile list with a fresh one, preserving
     * any JS-registered system tiles (OS Settings today, Jorvy /
     * widgets later). Used by the live menu-refresh path: after a
     * plugin is activated or deactivated, the shell refetches the
     * split payload from `/wp-desktop/v1/menu` and calls this on
     * both rails so the dock + taskbar repaint without a tab reload.
     *
     * Old menu tiles are removed from both the DOM and the lookup
     * map; new tiles are inserted before the system separator (or
     * appended at the end if none exists yet), so the menu-items →
     * hairline → system-items ordering stays intact. Active-state
     * classes are re-computed once the new tiles are in place so
     * window indicators survive the swap.
     *
     * @param items New DockItem list. Pass `[]` to clear everything
     *              menu-derived — common when the last plugin on the
     *              taskbar is deactivated.
     */
    replaceItems(items) {
      for (const el of this.itemElements.values()) {
        el.remove();
      }
      this.itemElements.clear();
      this.items = items;
      for (const item of items) {
        const btn = this.createItemButton(item);
        this.itemElements.set(item.id, btn);
        if (this.systemSeparator) {
          this.container.insertBefore(btn, this.systemSeparator);
        } else {
          this.container.appendChild(btn);
        }
      }
      this.updateActiveStates();
    }
    /**
     * True when the rail currently has ANY renderable tile —
     * either a menu-derived item or a JS-registered system item.
     * Lets callers (the shell's live-refresh path) decide whether
     * to hide the whole rail without having to peek into two
     * internal maps. "System tiles keep the rail alive even when
     * menu items are empty" is the user-visible contract we enforce.
     */
    hasItems() {
      return this.itemElements.size > 0 || this.systemItemElements.size > 0;
    }
    /**
     * Remove a previously-registered system item. Used by the
     * server-driven native-window sync path — when a plugin is
     * deactivated, its native-window entry disappears from the
     * server's payload and the shell calls this to pull the tile
     * back off the rail without a reload.
     *
     * Idempotent: an unknown id is a silent no-op. The system
     * separator is kept in place as long as at least one system
     * item remains; removing the last system item also strips the
     * separator so the rail doesn't dangle a divider under nothing.
     */
    removeSystemItem(id) {
      const tile2 = this.systemItemElements.get(id);
      if (!tile2) {
        return;
      }
      tile2.remove();
      this.systemItemElements.delete(id);
      this.systemItems = this.systemItems.filter((s) => s.id !== id);
      if (this.systemItemElements.size === 0 && this.systemSeparator) {
        this.systemSeparator.remove();
        this.systemSeparator = null;
      }
    }
    /**
     * Append a JS-registered system item to the dock.
     *
     * System items render after the menu-derived items, separated by a
     * hairline divider. Use for shell affordances that don't live in
     * the admin menu: OS Settings today, Jorvy and desktop widgets
     * later. Callers supply their own `onOpen` — the dock doesn't
     * assume the item opens a window at all.
     */
    appendSystemItem(item) {
      this.systemItems.push(item);
      if (!this.systemSeparator) {
        this.systemSeparator = document.createElement("div");
        this.systemSeparator.className = "wp-desktop-dock__separator";
        this.systemSeparator.setAttribute("aria-hidden", "true");
        this.container.appendChild(this.systemSeparator);
      }
      const tile2 = this.createSystemItemButton(item);
      this.systemItemElements.set(item.id, tile2);
      this.container.appendChild(tile2);
      this.updateActiveStates();
    }
    /**
     * Render the dock contents.
     */
    render() {
      this.container.innerHTML = "";
      for (const item of this.items) {
        const btn = this.createItemButton(item);
        this.itemElements.set(item.id, btn);
        this.container.appendChild(btn);
      }
    }
    /**
     * Create a tile for a JS-registered system item. Structurally simpler
     * than a menu tile — no submenu, no multi-instance rail, no badge —
     * but uses the same base classes so the hover / focus / active
     * styling is shared.
     */
    createSystemItemButton(item) {
      const tile2 = document.createElement("div");
      tile2.className = "wp-desktop-dock__item wp-desktop-dock__item--system";
      tile2.dataset.systemId = item.id;
      const primary = document.createElement("button");
      primary.className = "wp-desktop-dock__item-primary";
      primary.setAttribute("type", "button");
      primary.setAttribute("aria-label", item.title);
      primary.appendChild(this.resolveIcon(item.icon, item.title));
      primary.addEventListener("click", () => item.onOpen());
      tile2.appendChild(primary);
      this.bindTooltip(tile2, item.title);
      return tile2;
    }
    /**
     * Create a single dock icon tile.
     *
     * A tile is a vertical stack: the primary icon button, plus — for
     * multi-capable pages — an instance rail rendered below it showing one
     * dot per open window and a trailing "+" to open another. The rail is
     * hydrated by {@link updateActiveStates}; here we only place the empty
     * container so the DOM is stable.
     */
    createItemButton(item) {
      const tile2 = document.createElement("div");
      tile2.className = "wp-desktop-dock__item";
      tile2.dataset.menuSlug = item.id;
      if (item.multi) {
        tile2.classList.add("wp-desktop-dock__item--multi");
      }
      const primary = document.createElement("button");
      primary.className = "wp-desktop-dock__item-primary";
      primary.setAttribute("type", "button");
      primary.setAttribute("aria-label", item.title);
      const iconEl = this.resolveIcon(item.icon, item.title, item.url);
      primary.appendChild(iconEl);
      if (item.badge > 0) {
        const displayCount = item.badge > 99 ? "99+" : String(item.badge);
        const badge = document.createElement("span");
        badge.className = "wp-desktop-dock__badge";
        badge.textContent = displayCount;
        badge.setAttribute(
          "aria-label",
          sprintf(
            // translators: %d is the number of pending updates / items.
            _n("%d update", "%d updates", item.badge),
            item.badge
          )
        );
        primary.appendChild(badge);
      }
      primary.addEventListener("click", () => {
        this.openPage(item);
      });
      tile2.appendChild(primary);
      if (item.multi) {
        const addBtn = document.createElement("button");
        addBtn.type = "button";
        addBtn.className = "wp-desktop-dock__item-new";
        addBtn.hidden = true;
        addBtn.setAttribute(
          "aria-label",
          // translators: %s is the admin-page title (e.g., "Posts")
          sprintf(__("Open another %s"), item.title)
        );
        addBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M6 2v8M2 6h8" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/></svg>';
        addBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.openNewInstance(item);
        });
        addBtn.addEventListener("pointerenter", () => {
          this.positionTooltip(
            addBtn,
            // translators: %s is the admin-page title (e.g., "Posts")
            sprintf(__("Open new %s"), item.title)
          );
          this.tooltip.classList.add("wp-desktop-dock__tooltip--visible");
        });
        addBtn.addEventListener("pointerleave", (e) => {
          const next = e.relatedTarget;
          if (next && tile2.contains(next)) {
            this.positionTooltip(tile2, item.title);
            return;
          }
          this.tooltip.classList.remove("wp-desktop-dock__tooltip--visible");
        });
        tile2.appendChild(addBtn);
      }
      this.bindTooltip(tile2, item.title);
      return tile2;
    }
    /**
     * Resolve a registered icon value into a DOM element.
     *
     * Priority: dashicons class → inline SVG data URI → image URL →
     * letter badge derived from the item's title. The letter fallback is
     * important for the taskbar: plugin authors routinely register
     * top-level menus with `add_menu_page()` and omit the icon argument
     * (defaulting to `'div'` or empty), which would otherwise render as
     * an indistinguishable wall of generic wrenches. A colored letter
     * tile gives each plugin a stable, unique-ish visual identity with
     * zero plugin-side effort — the hue derives deterministically from
     * the title so the same plugin always gets the same color.
     *
     * @param icon  The icon value from the menu entry.
     * @param title Human-readable title, used when falling back to a
     *              letter badge.
     */
    resolveIcon(icon, title, url) {
      if (icon.startsWith("dashicons-") && icon !== "dashicons-admin-generic") {
        const el = document.createElement("span");
        el.className = `dashicons ${icon}`;
        el.setAttribute("aria-hidden", "true");
        return el;
      }
      if (icon.startsWith("data:image/svg+xml;base64,")) {
        const base64Part = icon.slice("data:image/svg+xml;base64,".length);
        if (/^[A-Za-z0-9+/=]+$/.test(base64Part)) {
          return this._makeSvgIcon(icon);
        }
      }
      if (icon.startsWith("http://") || icon.startsWith("https://")) {
        const img = document.createElement("img");
        img.className = "wp-desktop-dock__item-img";
        img.src = icon;
        img.alt = "";
        img.setAttribute("aria-hidden", "true");
        return img;
      }
      if (url) {
        const native = this._extractNativeMenuIcon(url);
        if (native) {
          return native;
        }
      }
      if (icon === "dashicons-admin-generic") {
        const el = document.createElement("span");
        el.className = "dashicons dashicons-admin-generic";
        el.setAttribute("aria-hidden", "true");
        return el;
      }
      return this.createLetterBadge(title);
    }
    /**
     * Build an SVG-background icon tile. Shared between the data-URI
     * branch of {@link resolveIcon} and the native-menu extractor.
     */
    _makeSvgIcon(bgValue) {
      const el = document.createElement("span");
      el.className = "wp-desktop-dock__item-svg";
      el.style.backgroundImage = bgValue.startsWith("url(") ? bgValue : `url("${bgValue}")`;
      el.style.backgroundSize = "contain";
      el.style.backgroundRepeat = "no-repeat";
      el.style.backgroundPosition = "center";
      el.setAttribute("aria-hidden", "true");
      return el;
    }
    /**
     * Extract a plugin's icon from the hidden `#adminmenu` that still
     * exists in the parent shell DOM (display:none'd by desktop.css).
     * Handles the three shapes plugins commonly use when the menu-page
     * icon_url is 'none' or 'div':
     *
     *   (a) `<img src="...">` nested inside `.wp-menu-image`
     *   (b) a dashicon class on `.wp-menu-image` itself
     *   (c) a CSS background-image on `.wp-menu-image::before` (the
     *       `menu-icon-XYZ` pattern Yoast, WooCommerce, Jetpack, etc. use)
     *
     * Returns null when the URL doesn't match any admin-menu entry or
     * none of the three shapes are detectable.
     */
    _extractNativeMenuIcon(url) {
      const adminMenu = document.getElementById("adminmenu");
      if (!adminMenu) {
        return null;
      }
      let target;
      try {
        const u = new URL(url, window.location.href);
        const filename = u.pathname.split("/").pop() || "";
        target = filename + u.search;
      } catch {
        return null;
      }
      if (!target) {
        return null;
      }
      const links = adminMenu.querySelectorAll("li.menu-top > a");
      let matchLi = null;
      for (const link of Array.from(links)) {
        if (link.href.endsWith(target)) {
          matchLi = link.closest("li.menu-top");
          break;
        }
      }
      if (!matchLi) {
        return null;
      }
      const imgWrap = matchLi.querySelector(".wp-menu-image");
      if (!imgWrap) {
        return null;
      }
      const img = imgWrap.querySelector("img");
      if (img && img.src) {
        const el = document.createElement("img");
        el.className = "wp-desktop-dock__item-img";
        el.src = img.src;
        el.alt = "";
        el.setAttribute("aria-hidden", "true");
        return el;
      }
      const dashMatch = imgWrap.className.match(/\bdashicons-[\w-]+\b/);
      if (dashMatch && dashMatch[0] !== "dashicons-before") {
        const el = document.createElement("span");
        el.className = `dashicons ${dashMatch[0]}`;
        el.setAttribute("aria-hidden", "true");
        return el;
      }
      const before = window.getComputedStyle(imgWrap, "::before");
      const bg = before.backgroundImage;
      if (bg && bg !== "none" && !bg.includes('url("")')) {
        return this._makeSvgIcon(bg);
      }
      const bgWrap = window.getComputedStyle(imgWrap).backgroundImage;
      if (bgWrap && bgWrap !== "none" && !bgWrap.includes('url("")')) {
        return this._makeSvgIcon(bgWrap);
      }
      return null;
    }
    /**
     * Create a letter-badge icon — a rounded square tinted with a
     * deterministic hue derived from the title, displaying the first
     * letter of the title. Mirrors the "app icon placeholder" look
     * macOS uses when an app ships without artwork.
     *
     * The title always drives both the letter and the hue — same plugin,
     * same color across reloads. An empty title falls through to a `?`
     * on a neutral gray tile, but the menu builder upstream guards
     * against empty titles, so this is a defensive branch.
     */
    createLetterBadge(title) {
      const el = document.createElement("span");
      el.className = "wp-desktop-dock__item-letter";
      el.setAttribute("aria-hidden", "true");
      const trimmed = title.trim();
      const firstCodePoint = trimmed ? Array.from(trimmed)[0] : "?";
      el.textContent = firstCodePoint.toUpperCase();
      const hue = hashTitleToHue(trimmed);
      el.style.background = `linear-gradient(135deg, hsl(${hue} 62% 55%), hsl(${(hue + 24) % 360} 58% 42%))`;
      return el;
    }
    /**
     * Bind tooltip show/hide on hover. Tooltip anchor differs per
     * orientation: left dock → vertically centered on the tile, placed
     * to its right via CSS; bottom taskbar → horizontally centered,
     * placed above the tile via CSS. We set the relevant coordinate
     * inline each enter; the CSS takes care of the rest.
     */
    bindTooltip(el, text) {
      el.addEventListener("pointerenter", () => {
        this.positionTooltip(el, text);
        this.tooltip.classList.add("wp-desktop-dock__tooltip--visible");
      });
      el.addEventListener("pointerleave", () => {
        this.tooltip.classList.remove("wp-desktop-dock__tooltip--visible");
      });
    }
    /**
     * Write the tooltip text + anchor coordinate for `el`. Split out
     * because the multi-instance chip's pointerenter handler also
     * needs to anchor to a specific element (the chip, not the tile).
     */
    positionTooltip(el, text) {
      const rect = el.getBoundingClientRect();
      this.tooltip.textContent = text;
      if (this.orientation === "bottom") {
        this.tooltip.style.left = `${rect.left + rect.width / 2}px`;
        this.tooltip.style.top = `${rect.top - 14}px`;
      } else {
        this.tooltip.style.top = `${rect.top + rect.height / 2 - 14}px`;
        this.tooltip.style.left = "";
      }
    }
    /**
     * Open an admin page in a window (or focus if already open).
     */
    openPage(item) {
      const baseId = this.deriveWindowId(item.url);
      this.windowManager.open({
        id: baseId,
        baseId,
        url: item.url,
        title: item.title,
        icon: item.icon.startsWith("dashicons-") ? item.icon : "dashicons-admin-generic",
        submenu: item.submenu,
        multi: !!item.multi
      });
    }
    /**
     * Open a brand-new instance of a multi-capable page, even if one is
     * already open. Invoked by the "+" chip on the dock icon.
     */
    openNewInstance(item) {
      const baseId = this.deriveWindowId(item.url);
      this.windowManager.openNew({
        id: baseId,
        baseId,
        url: item.url,
        title: item.title,
        icon: item.icon.startsWith("dashicons-") ? item.icon : "dashicons-admin-generic",
        submenu: item.submenu,
        multi: true
      });
    }
    /**
     * Derive a window ID from an admin page URL.
     */
    deriveWindowId(url) {
      return deriveWindowId(url, this.adminUrl);
    }
    /**
     * Listen to window events to update active/focused indicators on dock items.
     *
     * The event detail isn't used — we just need to re-query the
     * window manager on every change — so the handlers take no
     * argument and the type cast is gone with it.
     */
    bindWindowEvents() {
      const refresh = () => this.updateActiveStates();
      document.addEventListener("wp-desktop-window-opened", refresh);
      document.addEventListener("wp-desktop-window-closed", refresh);
      document.addEventListener("wp-desktop-window-focused", refresh);
      const ns = `wp-desktop-mode/dock-${this.orientation}-${++_Dock._instanceSeq}`;
      window.wp?.hooks?.addAction?.(
        "wp-desktop.desktop.switched",
        ns,
        refresh
      );
      window.wp?.hooks?.addAction?.(
        "wp-desktop.desktop.closed",
        ns,
        refresh
      );
    }
    /**
     * Update the active/focused classes and multi-instance rail on every
     * dock item in response to a window lifecycle event.
     *
     * For singletons the rail is absent; "active" means "the one window
     * is open". For multi-capable items, active means "≥1 instance is
     * open" and focused means "the focused window belongs to this item".
     */
    updateActiveStates() {
      const focused = this.windowManager.getFocused();
      const focusedBaseId = focused ? focused.config.baseId || focused.id : null;
      const activeDesktopId = this.windowManager.getActiveDesktopId();
      const onActiveDesktop = (w) => (w.config.desktopId || activeDesktopId) === activeDesktopId;
      for (const item of this.items) {
        const tile2 = this.itemElements.get(item.id);
        if (!tile2) {
          continue;
        }
        const baseId = this.deriveWindowId(item.url);
        const instances = item.multi ? this.windowManager.getAllByBaseId(baseId).filter(onActiveDesktop) : [];
        const single = this.windowManager.getById(baseId);
        const singleOpen = !item.multi && !!single && onActiveDesktop(single);
        const isOpen = item.multi ? instances.length > 0 : singleOpen;
        const isFocused = focusedBaseId === baseId && !!focused && onActiveDesktop(focused);
        tile2.classList.toggle("wp-desktop-dock__item--active", isOpen);
        tile2.classList.toggle("wp-desktop-dock__item--focused", isFocused);
        if (item.multi) {
          const addBtn = tile2.querySelector(
            ".wp-desktop-dock__item-new"
          );
          if (addBtn) {
            addBtn.hidden = instances.length === 0;
          }
        }
      }
      for (const sys of this.systemItems) {
        const tile2 = this.systemItemElements.get(sys.id);
        if (!tile2) {
          continue;
        }
        const isOpen = sys.isOpen ? sys.isOpen() : false;
        const isFocused = !!focused && focused.id === sys.id;
        tile2.classList.toggle("wp-desktop-dock__item--active", isOpen);
        tile2.classList.toggle("wp-desktop-dock__item--focused", isFocused);
      }
    }
  };
  _Dock._instanceSeq = 0;
  let Dock = _Dock;
  const styles$h = css`
	:host {
		display: block;
		margin-block-end: 28px;
	}
	:host( [ hidden ] ) {
		display: none;
	}
	.wpd-section__heading {
		margin: 0 0 2px;
		font-size: 14px;
		font-weight: 600;
		color: var( --wp-desktop-text, #1d2327 );
	}
	.wpd-section__description {
		margin: 0 0 14px;
		font-size: 12px;
		color: var( --wp-desktop-muted, #646970 );
		line-height: 1.45;
	}
	/* Collapse the description node when no text was
	 * supplied — avoids stray margin under the heading. */
	.wpd-section__description:empty {
		display: none;
	}
`;
  const _WpdSection = class _WpdSection extends Component {
    render() {
      const heading = this.heading || "";
      const description = this.description || "";
      return html`
			<h3 class="wpd-section__heading">${heading}</h3>
			<p class="wpd-section__description">${description}</p>
			<slot></slot>
		`;
    }
  };
  _WpdSection.props = ["heading", "description"];
  _WpdSection.styles = [styles$h];
  let WpdSection = _WpdSection;
  defineComponent("wpd-section", WpdSection);
  const styles$g = css`
	:host {
		display: inline-flex;
	}
	:host( [ fill-cell ] ) {
		display: flex;
		width: 100%;
	}
	button {
		appearance: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		padding: var( --wpd-button-padding, 6px 12px );
		border-radius: var( --wpd-button-border-radius, 6px );
		font: inherit;
		font-weight: 500;
		cursor: pointer;
		transition: background-color 0.12s ease, color 0.12s ease,
			border-color 0.12s ease;
		/* Ghost (default) */
		background: var( --wpd-button-bg, transparent );
		color: var( --wpd-button-fg, var( --wp-desktop-text, #1d2327 ) );
		border: var(
			--wpd-button-border,
			1px solid var( --wp-desktop-border, #c3c4c7 )
		);
	}
	:host( [ fill-cell ] ) button {
		width: 100%;
		min-height: var( --wpd-button-min-height, 44px );
	}
	button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	button:hover:not( :disabled ) {
		background: rgba( 0, 0, 0, 0.04 );
	}
	/* Primary */
	:host( [ variant='primary' ] ) button {
		background: var( --wpd-button-bg, var( --wp-admin-theme-color, #2271b1 ) );
		color: var( --wpd-button-fg, #fff );
		border: var( --wpd-button-border, 1px solid transparent );
	}
	:host( [ variant='primary' ] ) button:hover:not( :disabled ) {
		filter: brightness( 1.06 );
		background: var( --wpd-button-bg, var( --wp-admin-theme-color, #2271b1 ) );
	}
	/* Secondary — quiet filled control. Neutral chrome, no underline.
	 * Semantic fit for "not the primary action but also not a
	 * destructive one" (AC / ± / % on a calculator; Cancel in a
	 * two-button dialog). */
	:host( [ variant='secondary' ] ) button {
		background: var( --wpd-button-bg, rgba( 0, 0, 0, 0.06 ) );
		color: var( --wpd-button-fg, var( --wp-desktop-text, #1d2327 ) );
		border: var( --wpd-button-border, 1px solid transparent );
	}
	:host( [ variant='secondary' ] ) button:hover:not( :disabled ) {
		background: var( --wpd-button-bg-hover, rgba( 0, 0, 0, 0.1 ) );
	}
	/* Danger */
	:host( [ variant='danger' ] ) button {
		background: var( --wpd-button-bg, transparent );
		color: var( --wpd-button-fg, #d63638 );
		border: var( --wpd-button-border, 1px solid currentColor );
	}
	:host( [ variant='danger' ] ) button:hover:not( :disabled ) {
		background: #d63638;
		color: #fff;
	}
	/* Link */
	:host( [ variant='link' ] ) button {
		background: transparent;
		color: var( --wpd-button-fg, var( --wp-admin-theme-color, #2271b1 ) );
		border: 0;
		padding: 0;
		text-decoration: underline;
	}
	:host( [ busy ] ) button {
		pointer-events: none;
		opacity: 0.75;
	}
`;
  const _WpdButton = class _WpdButton extends Component {
    render() {
      const disabled = this.disabled !== null;
      const type = this.type || "button";
      return html`
			<button part="button" type=${type} ?disabled=${disabled}>
				<slot></slot>
			</button>
		`;
    }
  };
  _WpdButton.props = ["variant", "disabled", "type", "busy", "fill-cell"];
  _WpdButton.styles = [styles$g];
  let WpdButton = _WpdButton;
  defineComponent("wpd-button", WpdButton);
  const styles$f = css`
	:host {
		display: block;
		width: 100%;
		aspect-ratio: 4 / 3;
	}
	:host( [ size='small' ] ) {
		display: inline-block;
		width: 32px;
		height: 32px;
		aspect-ratio: 1 / 1;
		flex: 0 0 auto;
	}
	/*
	 * Wallpaper variant: 16:9 aspect (matches most desktop
	 * displays), and positions slotted overlay content (e.g. a
	 * label chip) at the bottom-left so it reads like a
	 * photo-corner caption. Caller owns the label's own visual
	 * treatment — we just place it.
	 */
	:host( [ variant='wallpaper' ] ) {
		aspect-ratio: 16 / 9;
	}
	:host( [ variant='wallpaper' ] ) button {
		display: flex;
		align-items: flex-end;
		justify-content: flex-start;
		padding: 6px 8px;
		overflow: hidden;
	}
	button {
		appearance: none;
		width: 100%;
		height: 100%;
		padding: 0;
		border-radius: 10px;
		border: 2px solid transparent;
		cursor: pointer;
		background-color: #eee;
		background-size: cover;
		background-position: center;
		transition: transform 0.15s ease, border-color 0.15s ease,
			box-shadow 0.15s ease;
	}
	:host( [ size='small' ] ) button {
		border-radius: 50%;
	}
	button:hover {
		transform: scale( 1.04 );
	}
	button[ aria-pressed='true' ] {
		border-color: var( --wp-admin-theme-color, #2271b1 );
		box-shadow: 0 0 0 2px var( --wp-admin-theme-color, #2271b1 );
	}
	/*
	 * Wallpaper variant uses a softer lift to pair with the
	 * larger visible surface — hover scale on a 200 px tile can
	 * feel cartoonish.
	 */
	:host( [ variant='wallpaper' ] ) button:hover {
		transform: translateY( -1px );
	}
`;
  const _WpdSwatch = class _WpdSwatch extends Component {
    render() {
      const selected = this.selected !== null;
      const label = this.label || "";
      const preview = this.preview || "";
      return html`
			<button
				type="button"
				aria-pressed=${selected ? "true" : "false"}
				aria-label=${label}
				title=${label}
				style="background: ${preview}"
				@click=${() => this._onPick()}
			>
				<slot></slot>
			</button>
		`;
    }
    _onPick() {
      this.emit("wpd-pick", {
        value: this.value
      });
    }
  };
  _WpdSwatch.props = ["value", "label", "selected", "preview", "size", "variant"];
  _WpdSwatch.styles = [styles$f];
  let WpdSwatch = _WpdSwatch;
  defineComponent("wpd-swatch", WpdSwatch);
  const styles$e = css`
	:host {
		display: grid;
		grid-template-columns: repeat(
			var( --wpd-swatch-grid-cols, 4 ),
			1fr
		);
		gap: 12px;
	}
	:host( [ mode='row' ] ) {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px;
	}
`;
  const _WpdSwatchGrid = class _WpdSwatchGrid extends Component {
    render() {
      const label = this.label || "";
      const cols = this.columns || "";
      if (cols) {
        this.style.setProperty("--wpd-swatch-grid-cols", cols);
      }
      this.setAttribute("role", "radiogroup");
      if (label) {
        this.setAttribute("aria-label", label);
      }
      return html`<slot></slot>`;
    }
  };
  _WpdSwatchGrid.props = ["label", "columns", "mode"];
  _WpdSwatchGrid.styles = [styles$e];
  let WpdSwatchGrid = _WpdSwatchGrid;
  defineComponent("wpd-swatch-grid", WpdSwatchGrid);
  const segmentedStyles = css`
	:host {
		display: inline-flex;
		padding: 3px;
		background: rgba( 0, 0, 0, 0.05 );
		border-radius: 7px;
		gap: 2px;
	}
`;
  const segmentStyles = css`
	:host {
		flex: 1;
	}
	button {
		appearance: none;
		display: block;
		width: 100%;
		padding: 8px 12px;
		background: transparent;
		border: 0;
		font: inherit;
		font-size: 13px;
		color: var( --wp-desktop-muted, #646970 );
		cursor: pointer;
		border-radius: 5px;
		transition: background-color 0.12s ease, color 0.12s ease;
	}
	:host( [ aria-checked='true' ] ) button {
		background: var( --wp-desktop-window-bg, #fff );
		color: var( --wp-desktop-text, #1d2327 );
		box-shadow: 0 1px 3px rgba( 0, 0, 0, 0.12 );
		font-weight: 500;
	}
`;
  const _WpdSegment = class _WpdSegment extends Component {
    render() {
      this.setAttribute("role", "radio");
      return html`
			<button type="button" @click=${() => this._onPick()}>
				<slot></slot>
			</button>
		`;
    }
    _onPick() {
      this.emit("wpd-segment-pick", {
        value: this.value
      });
    }
  };
  _WpdSegment.props = ["value"];
  _WpdSegment.styles = [segmentStyles];
  let WpdSegment = _WpdSegment;
  defineComponent("wpd-segment", WpdSegment);
  const _WpdSegmented = class _WpdSegmented extends Component {
    connectedCallback() {
      super.connectedCallback();
      this.addEventListener("wpd-segment-pick", (e) => {
        const detail = e.detail;
        e.stopPropagation();
        this.value = detail.value;
        this.emit("wpd-pick", { value: detail.value });
      });
    }
    /**
     * Declarative item-list setter. Replaces the existing
     * `<wpd-segment>` children with a fresh set built from a
     * `{ value, label }` array; preserves the current selection
     * when the value still matches an entry, otherwise falls back
     * to the first item.
     *
     * Collapses the pre-0.11 imperative dance (clear children,
     * `createElement`, set `textContent`, `appendChild`, then
     * `setAttribute('value', …)` on the group — order matters) to
     * a single assignment:
     *
     * ```js
     * segmented.items = [
     *   { value: 'm',  label: 'm' },
     *   { value: 'km', label: 'km' },
     * ];
     * ```
     *
     * @since 0.11.0
     */
    set items(list) {
      const existing = this.querySelectorAll(":scope > wpd-segment");
      for (const el of Array.from(existing)) {
        el.remove();
      }
      for (const item of list) {
        const seg = document.createElement("wpd-segment");
        seg.setAttribute("value", item.value);
        seg.textContent = item.label;
        this.appendChild(seg);
      }
      const current = this.value;
      const stillValid = current !== null && list.some((i) => i.value === current);
      if (!stillValid && list.length > 0) {
        this.value = list[0].value;
      } else {
        this.requestUpdate();
      }
    }
    render() {
      const label = this.label || "";
      if (label) {
        this.setAttribute("aria-label", label);
      }
      this.setAttribute("role", "radiogroup");
      const current = this.value;
      queueMicrotask(() => {
        const segs = this.querySelectorAll("wpd-segment");
        for (const seg of Array.from(segs)) {
          const v = seg.getAttribute("value");
          seg.setAttribute(
            "aria-checked",
            v === current ? "true" : "false"
          );
        }
      });
      return html`<slot></slot>`;
    }
  };
  _WpdSegmented.props = ["value", "label"];
  _WpdSegmented.styles = [segmentedStyles];
  let WpdSegmented = _WpdSegmented;
  defineComponent("wpd-segmented", WpdSegmented);
  const selectStyles = css`
	/*
	 * Host is block-level flex so the component fills its parent
	 * cell (grid row col=N, flex container, plain block container).
	 * Inline-flex was the 0.11 default, but stretched grid cells
	 * left the native <select> at its intrinsic width while the
	 * host spanned the full cell — the absolutely-positioned
	 * chevron then floated against the cell's right edge rather
	 * than hugging the select. Block-level flex removes the gap.
	 */
	:host {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 13px;
		color: var( --wp-desktop-text, #1d2327 );
		min-width: 0;
	}

	:host( [ hidden ] ) {
		display: none;
	}

	.wpd-select__label {
		font-size: 12px;
		color: var( --wp-desktop-muted, #646970 );
	}

	.wpd-select__wrap {
		position: relative;
		display: flex;
		align-items: center;
		width: 100%;
	}

	select {
		appearance: none;
		-webkit-appearance: none;
		display: block;
		width: 100%;
		min-width: 0;
		padding: 7px 28px 7px 12px;
		background: rgba( 0, 0, 0, 0.05 );
		border: 1px solid transparent;
		border-radius: 7px;
		font: inherit;
		font-size: 13px;
		color: var( --wp-desktop-text, #1d2327 );
		cursor: pointer;
		transition: background-color 0.12s ease, border-color 0.12s ease,
			box-shadow 0.12s ease;
	}

	select:hover {
		background: rgba( 0, 0, 0, 0.08 );
	}

	select:focus-visible {
		outline: none;
		border-color: var( --wp-admin-theme-color, #2271b1 );
		box-shadow: 0 0 0 1px var( --wp-admin-theme-color, #2271b1 );
	}

	select:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* Chevron — inline SVG sized to match the 12px viewBox.
	 * Positioned over the right edge of the native select so the
	 * caret is consistent across platforms. aria-hidden keeps it
	 * out of the accessibility tree; the native select retains its
	 * aria-label for screen readers. */
	.wpd-select__chevron {
		position: absolute;
		inset-inline-end: 10px;
		top: 50%;
		transform: translateY( -50% );
		pointer-events: none;
		color: var( --wp-desktop-muted, #646970 );
		display: inline-block;
	}

	/* Slight chevron tint on hover + focus — matches the select's
	 * own border transition so the two feel like one affordance. */
	select:hover ~ .wpd-select__chevron,
	select:focus-visible ~ .wpd-select__chevron {
		color: var( --wp-desktop-text, #1d2327 );
	}
`;
  const optionStyles = css`
	/*
	 * Data-carrier only — children of <wpd-select> that convey
	 * value + label. The parent reads textContent + the value
	 * attribute to build the native select; the element itself
	 * never paints.
	 */
	:host {
		display: none;
	}
`;
  const _WpdOption = class _WpdOption extends Component {
    render() {
      return html``;
    }
  };
  _WpdOption.props = ["value", "disabled"];
  _WpdOption.styles = [optionStyles];
  let WpdOption = _WpdOption;
  defineComponent("wpd-option", WpdOption);
  const _WpdSelect = class _WpdSelect extends Component {
    constructor() {
      super(...arguments);
      this._optionObserver = null;
    }
    /**
     * Declarative item-list setter. Replaces the existing
     * `<wpd-option>` children with a fresh set; preserves `value`
     * when it still matches, otherwise clears to the placeholder.
     *
     * Same shape as the setter on `<wpd-segmented>` so callers can
     * swap tag names (segmented ↔ select) without touching the
     * populate code when an option list outgrows the pill bar.
     *
     * ```js
     * select.items = [
     *   { value: 'eur', label: 'Euro' },
     *   { value: 'usd', label: 'US Dollar' },
     * ];
     * ```
     *
     * @since 0.11.0
     */
    set items(list) {
      const existing = this.querySelectorAll(":scope > wpd-option");
      for (const el of Array.from(existing)) {
        el.remove();
      }
      for (const item of list) {
        const opt = document.createElement("wpd-option");
        opt.setAttribute("value", item.value);
        opt.textContent = item.label;
        this.appendChild(opt);
      }
      const current = this.value;
      const stillValid = current !== null && list.some((i) => i.value === current);
      if (!stillValid && list.length > 0) {
        this.value = list[0].value;
      }
      this.requestUpdate();
    }
    connectedCallback() {
      super.connectedCallback();
      ensureAutoId(this);
      this._optionObserver = new MutationObserver(() => this.requestUpdate());
      this._optionObserver.observe(this, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["value", "disabled"],
        characterData: true
      });
    }
    disconnectedCallback() {
      this._optionObserver?.disconnect();
      this._optionObserver = null;
    }
    render() {
      const label = this.label || "";
      const current = this.value;
      const placeholder = this.placeholder || "";
      const disabled = this.disabled !== null;
      const name = this.name || "";
      if (label) {
        this.setAttribute("aria-label", label);
      } else {
        this.removeAttribute("aria-label");
      }
      const selectAriaLabel = label || placeholder;
      const options = this._readOptions();
      const hostId = this.id || "wpd-unnamed";
      const selectId = `${hostId}__input`;
      return html`
			${label ? html`<label
						class="wpd-select__label"
						for=${selectId}
					>${label}</label>` : html``}
			<span class="wpd-select__wrap">
				<select
					id=${selectId}
					?disabled=${disabled}
					aria-label=${selectAriaLabel}
					name=${name}
					@change=${(e) => this._onChange(e)}
				>
					${placeholder && !current ? html`<option value="" disabled selected>
								${placeholder}
						  </option>` : html``}
					${options.map(
        (o) => html`
							<option
								value=${o.value}
								?disabled=${o.disabled}
								?selected=${o.value === current}
							>
								${o.label}
							</option>
						`
      )}
				</select>
				<!--
					Inline SVG — the previous dashicons-classed span
					never painted because the global Dashicons font
					stylesheet cannot cross the shadow-root boundary.
					An inline SVG lives inside the shadow tree, inherits
					currentColor via the stroke attribute, and needs
					no external CSS.
				-->
				<svg
					class="wpd-select__chevron"
					viewBox="0 0 12 12"
					width="12"
					height="12"
					aria-hidden="true"
					focusable="false"
				>
					<path
						d="M3 5l3 3 3-3"
						stroke="currentColor"
						stroke-width="1.4"
						stroke-linecap="round"
						stroke-linejoin="round"
						fill="none"
					></path>
				</svg>
			</span>
		`;
    }
    _readOptions() {
      const out = [];
      const children = this.querySelectorAll(":scope > wpd-option");
      for (const child of Array.from(children)) {
        const value = child.getAttribute("value");
        if (value === null) {
          continue;
        }
        out.push({
          value,
          label: (child.textContent || value).trim(),
          disabled: child.hasAttribute("disabled")
        });
      }
      return out;
    }
    _onChange(e) {
      const sel = e.target;
      const next = sel.value;
      this.value = next;
      this.emit("wpd-pick", { value: next });
    }
  };
  _WpdSelect.props = [
    "value",
    "label",
    "placeholder",
    "disabled",
    "name"
  ];
  _WpdSelect.styles = [selectStyles];
  let WpdSelect = _WpdSelect;
  defineComponent("wpd-select", WpdSelect);
  const styles$d = css`
	:host {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
		color: var( --wp-desktop-muted, #646970 );
	}
	label {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}
	input[ type='color' ] {
		width: 28px;
		height: 28px;
		padding: 0;
		border: 1px solid var( --wp-desktop-border, #c3c4c7 );
		border-radius: 6px;
		background: transparent;
		cursor: pointer;
	}
	/*
	 * Block variant: the host fills its parent, the input stretches
	 * to take the remaining row after the label. Used by the
	 * gradient editor where each field lives in a 1fr flex column.
	 */
	:host( [ variant='block' ] ) {
		display: flex;
		width: 100%;
	}
	:host( [ variant='block' ] ) label {
		display: flex;
		flex: 1;
		align-items: center;
	}
	:host( [ variant='block' ] ) input[ type='color' ] {
		flex: 1;
		width: auto;
		height: 32px;
	}
	/*
	 * WebKit paints the color swatch inside an extra wrapper with
	 * a default 4 px border — strip it so the input reads as a
	 * flat colored panel matching the rest of OS Settings.
	 */
	:host( [ variant='block' ] ) input[ type='color' ]::-webkit-color-swatch-wrapper {
		padding: 2px;
	}
	:host( [ variant='block' ] ) input[ type='color' ]::-webkit-color-swatch {
		border: none;
		border-radius: 2px;
	}
`;
  const _WpdColorField = class _WpdColorField extends Component {
    render() {
      const label = this.label || "";
      const value = this.value || "#000000";
      return html`
			<label>
				<span class="wpd-color-field__label">${label}</span>
				<input
					type="color"
					.value=${value}
					@input=${(e) => this._onInput(e)}
				/>
			</label>
		`;
    }
    _onInput(e) {
      const input = e.target;
      this.value = input.value;
      this.emit("wpd-color-change", { value: input.value });
    }
  };
  _WpdColorField.props = ["label", "value", "variant"];
  _WpdColorField.styles = [styles$d];
  let WpdColorField = _WpdColorField;
  defineComponent("wpd-color-field", WpdColorField);
  const styles$c = css`
	:host {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 12px;
		color: var( --wp-desktop-muted, #646970 );
	}
	input[ type='range' ] {
		flex: 1;
		accent-color: var( --wp-admin-theme-color, #2271b1 );
	}
	.wpd-range-field__value {
		min-width: 3ch;
		text-align: end;
		font-variant-numeric: tabular-nums;
		color: var( --wp-desktop-text, #1d2327 );
	}
`;
  const _WpdRangeField = class _WpdRangeField extends Component {
    render() {
      const label = this.label || "";
      const value = this.value || "0";
      const min = this.min || "0";
      const max = this.max || "100";
      const step2 = this.step || "1";
      const suffix = this.suffix || "";
      return html`
			<label class="wpd-range-field__label">${label}</label>
			<input
				type="range"
				min=${min}
				max=${max}
				step=${step2}
				.value=${value}
				@input=${(e) => this._onInput(e)}
			/>
			<span class="wpd-range-field__value">${value}${suffix}</span>
		`;
    }
    _onInput(e) {
      const input = e.target;
      const n = parseFloat(input.value);
      if (!Number.isFinite(n)) {
        return;
      }
      this.value = String(n);
      this.emit("wpd-range-change", { value: n });
    }
  };
  _WpdRangeField.props = ["label", "value", "min", "max", "step", "suffix"];
  _WpdRangeField.styles = [styles$c];
  let WpdRangeField = _WpdRangeField;
  defineComponent("wpd-range-field", WpdRangeField);
  const textFieldStyles = css`
	/*
	 * Host is block-level flex so the field fills its parent cell
	 * (grid row col=N, flex container, plain block container). The
	 * pre-0.12 inline-flex default left the native <input> at its
	 * intrinsic width while the host spanned the full cell, which
	 * looked wrong inside a wpd-row.
	 */
	:host {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 13px;
		color: var( --wp-desktop-text, #1d2327 );
		min-width: 0;
	}
	:host( [ hidden ] ) {
		display: none;
	}

	.wpd-text-field__label {
		font-size: 12px;
		color: var( --wp-desktop-muted, #646970 );
	}

	.wpd-text-field__row {
		position: relative;
		display: flex;
		align-items: center;
		width: 100%;
	}

	input {
		appearance: none;
		-webkit-appearance: none;
		display: block;
		width: 100%;
		min-width: 0;
		padding: 7px 10px;
		background: var( --wp-desktop-window-bg, #fff );
		border: 1px solid var( --wp-desktop-border, #dcdcde );
		border-radius: 6px;
		font: inherit;
		font-size: 13px;
		color: var( --wp-desktop-text, #1d2327 );
		transition: border-color 0.12s ease, box-shadow 0.12s ease;
	}

	/* Suffix slot for units / currency badges — rendered when the
	 * component has a suffix attribute. Inline-end anchored so RTL
	 * locales flip automatically via logical properties. */
	.wpd-text-field__suffix {
		position: absolute;
		inset-inline-end: 10px;
		top: 50%;
		transform: translateY( -50% );
		pointer-events: none;
		font-size: 12px;
		color: var( --wp-desktop-muted, #646970 );
	}

	/* Reveal (show/hide) toggle — only rendered on password-type fields
	 * that carry the reveal attribute. Sits at the inline-end of the
	 * row; the input grows extra padding when the button is present so
	 * typed text doesn't slide under it. */
	.wpd-text-field__row--has-reveal input {
		padding-inline-end: 36px;
	}

	.wpd-text-field__reveal {
		position: absolute;
		inset-inline-end: 0;
		top: 0;
		bottom: 0;
		width: 34px;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		border: none;
		background: transparent;
		color: var( --wp-desktop-muted, #646970 );
		cursor: pointer;
		border-radius: 0 6px 6px 0;
		transition: color 0.12s ease;
	}
	.wpd-text-field__reveal:hover {
		color: var( --wp-admin-theme-color, #2271b1 );
	}
	.wpd-text-field__reveal:focus-visible {
		outline: 2px solid var( --wp-admin-theme-color, #2271b1 );
		outline-offset: -2px;
		border-radius: 0 6px 6px 0;
	}
	.wpd-text-field__reveal:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	input:hover {
		border-color: var( --wp-desktop-muted, #8c8f94 );
	}
	input:focus-visible {
		outline: none;
		border-color: var( --wp-admin-theme-color, #2271b1 );
		box-shadow: 0 0 0 1px var( --wp-admin-theme-color, #2271b1 );
	}
	input:disabled {
		opacity: 0.55;
		cursor: not-allowed;
		background: rgba( 0, 0, 0, 0.03 );
	}

	input[ aria-invalid='true' ] {
		border-color: #d63638;
	}
	input[ aria-invalid='true' ]:focus-visible {
		box-shadow: 0 0 0 1px #d63638;
	}

	/* Hide the native spinner on number inputs — the suffix slot and
	 * the keypad (when present) already handle increment / decrement.
	 * Callers that need spinners can unset this by restyling. */
	input[ type='number' ]::-webkit-inner-spin-button,
	input[ type='number' ]::-webkit-outer-spin-button {
		-webkit-appearance: none;
		margin: 0;
	}
	input[ type='number' ] {
		-moz-appearance: textfield;
	}
`;
  const _WpdTextField = class _WpdTextField extends Component {
    constructor() {
      super(...arguments);
      this._revealed = false;
    }
    connectedCallback() {
      super.connectedCallback();
      ensureAutoId(this);
    }
    render() {
      const label = this.label || "";
      const value = this.value ?? "";
      const placeholder = this.placeholder || "";
      const disabled = this.disabled !== null;
      const readonly = this.readonly !== null;
      const autocomplete = this.autocomplete || "off";
      const declaredType = this.type || "text";
      const maxLength = this.maxlength;
      const minLength = this.minlength;
      const pattern = this.pattern || "";
      const name = this.name || "";
      const suffix = this.suffix || "";
      const invalid = this.invalid !== null;
      const reveal = this.reveal !== null;
      const effectiveType = reveal && this._revealed ? "text" : declaredType;
      const rowClass = reveal ? "wpd-text-field__row wpd-text-field__row--has-reveal" : "wpd-text-field__row";
      const hostId = this.id || "wpd-unnamed";
      const inputId = `${hostId}__input`;
      return html`
			${label ? html`<label
						class="wpd-text-field__label"
						for=${inputId}
					>${label}</label>` : html``}
			<span class=${rowClass}>
				<input
					id=${inputId}
					type=${effectiveType}
					.value=${value}
					placeholder=${placeholder}
					?disabled=${disabled}
					?readonly=${readonly}
					autocomplete=${autocomplete}
					maxlength=${maxLength ?? ""}
					minlength=${minLength ?? ""}
					pattern=${pattern}
					name=${name}
					aria-invalid=${invalid ? "true" : "false"}
					aria-label=${label || ""}
					@input=${(e) => this._onInput(e)}
					@change=${(e) => this._onChange(e)}
					@keydown=${(e) => this._onKeyDown(e)}
				/>
				${suffix ? html`<span class="wpd-text-field__suffix">${suffix}</span>` : html``}
				${reveal ? this._renderRevealButton(disabled) : html``}
			</span>
		`;
    }
    _renderRevealButton(disabled) {
      const label = this._revealed ? "Hide" : "Show";
      return html`
			<button
				type="button"
				class="wpd-text-field__reveal"
				aria-label=${label}
				aria-pressed=${this._revealed ? "true" : "false"}
				?disabled=${disabled}
				tabindex="0"
				@click=${() => this._onToggleReveal()}
			>
				${this._revealed ? _iconEyeOff() : _iconEye()}
			</button>
		`;
    }
    _onToggleReveal() {
      this._revealed = !this._revealed;
      this.requestUpdate();
    }
    _onInput(e) {
      const input = e.target;
      this.value = input.value;
      this.emit("wpd-input-change", { value: input.value });
    }
    _onChange(e) {
      const input = e.target;
      this.emit("wpd-input-commit", { value: input.value });
    }
    _onKeyDown(e) {
      if (e.key === "Enter" && !e.shiftKey && !e.altKey && !e.metaKey) {
        const input = e.target;
        this.emit("wpd-submit", { value: input.value });
      }
    }
  };
  _WpdTextField.props = [
    "label",
    "value",
    "placeholder",
    "disabled",
    "readonly",
    "autocomplete",
    "type",
    "maxlength",
    "minlength",
    "pattern",
    "name",
    "suffix",
    "invalid",
    "reveal"
  ];
  _WpdTextField.styles = [textFieldStyles];
  let WpdTextField = _WpdTextField;
  defineComponent("wpd-text-field", WpdTextField);
  function _iconEye() {
    return html`
		<svg
			viewBox="0 0 16 16"
			width="14"
			height="14"
			fill="none"
			stroke="currentColor"
			stroke-width="1.5"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
			focusable="false"
		>
			<path d="M1 8C1 8 3.5 3 8 3s7 5 7 5-2.5 5-7 5S1 8 1 8z" />
			<circle cx="8" cy="8" r="2" />
		</svg>
	`;
  }
  function _iconEyeOff() {
    return html`
		<svg
			viewBox="0 0 16 16"
			width="14"
			height="14"
			fill="none"
			stroke="currentColor"
			stroke-width="1.5"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
			focusable="false"
		>
			<path d="M1 8C1 8 3.5 3 8 3s7 5 7 5-2.5 5-7 5S1 8 1 8z" />
			<circle cx="8" cy="8" r="2" />
			<line x1="2" y1="2" x2="14" y2="14" />
		</svg>
	`;
  }
  const _WpdNumberField = class _WpdNumberField extends Component {
    connectedCallback() {
      super.connectedCallback();
      ensureAutoId(this);
    }
    render() {
      const label = this.label || "";
      const value = this.value ?? "";
      const placeholder = this.placeholder || "";
      const disabled = this.disabled !== null;
      const readonly = this.readonly !== null;
      const name = this.name || "";
      const suffix = this.suffix || "";
      const min = this.min;
      const max = this.max;
      const step2 = this.step || "any";
      const invalid = this.invalid !== null;
      const hostId = this.id || "wpd-unnamed";
      const inputId = `${hostId}__input`;
      return html`
			${label ? html`<label
						class="wpd-text-field__label"
						for=${inputId}
					>${label}</label>` : html``}
			<span class="wpd-text-field__row">
				<input
					id=${inputId}
					type="number"
					.value=${value}
					placeholder=${placeholder}
					?disabled=${disabled}
					?readonly=${readonly}
					inputmode="decimal"
					autocomplete="off"
					min=${min ?? ""}
					max=${max ?? ""}
					step=${step2}
					name=${name}
					aria-invalid=${invalid ? "true" : "false"}
					aria-label=${label || ""}
					@input=${(e) => this._onInput(e)}
					@change=${(e) => this._onCommit(e)}
					@keydown=${(e) => this._onKeyDown(e)}
				/>
				${suffix ? html`<span class="wpd-text-field__suffix">${suffix}</span>` : html``}
			</span>
		`;
    }
    _readRange() {
      const rawMin = this.min;
      const rawMax = this.max;
      const min = rawMin !== null ? parseFloat(rawMin) : -Infinity;
      const max = rawMax !== null ? parseFloat(rawMax) : Infinity;
      return {
        min: Number.isFinite(min) ? min : -Infinity,
        max: Number.isFinite(max) ? max : Infinity
      };
    }
    _clamp(value) {
      const { min, max } = this._readRange();
      if (value < min) {
        return min;
      }
      if (value > max) {
        return max;
      }
      return value;
    }
    _onInput(e) {
      const input = e.target;
      const n = parseFloat(input.value);
      if (!Number.isFinite(n)) {
        return;
      }
      this.value = String(n);
      this.emit("wpd-input-change", { value: n });
    }
    _onCommit(e) {
      const input = e.target;
      const n = parseFloat(input.value);
      if (!Number.isFinite(n)) {
        return;
      }
      const clamped = this._clamp(n);
      if (clamped !== n) {
        input.value = String(clamped);
        this.value = String(clamped);
      }
      this.emit("wpd-input-commit", { value: clamped });
    }
    _onKeyDown(e) {
      if (e.key === "Enter" && !e.shiftKey && !e.altKey && !e.metaKey) {
        const input = e.target;
        const n = parseFloat(input.value);
        if (!Number.isFinite(n)) {
          return;
        }
        const clamped = this._clamp(n);
        if (clamped !== n) {
          input.value = String(clamped);
          this.value = String(clamped);
        }
        this.emit("wpd-submit", { value: clamped });
      }
    }
  };
  _WpdNumberField.props = [
    "label",
    "value",
    "placeholder",
    "disabled",
    "readonly",
    "name",
    "suffix",
    "min",
    "max",
    "step",
    "invalid"
  ];
  _WpdNumberField.styles = [textFieldStyles];
  let WpdNumberField = _WpdNumberField;
  defineComponent("wpd-number-field", WpdNumberField);
  const styles$b = css`
	:host {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 13px;
		color: var( --wp-desktop-text, #1d2327 );
		cursor: pointer;
	}

	:host( [ disabled ] ) {
		cursor: not-allowed;
		opacity: 0.55;
	}

	label {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		cursor: inherit;
	}

	input[ type='checkbox' ] {
		appearance: auto;
		-webkit-appearance: auto;
		accent-color: var( --wp-admin-theme-color, #2271b1 );
		width: 16px;
		height: 16px;
		margin: 0;
		cursor: inherit;
	}

	input[ type='checkbox' ]:focus-visible {
		outline: 2px solid var( --wp-admin-theme-color, #2271b1 );
		outline-offset: 2px;
	}

	.wpd-checkbox__label {
		line-height: 1.3;
	}

	/* When no label is passed, collapse the label wrapper so the
	 * component is exactly one 16 px box — useful when the caller
	 * is supplying its own label elsewhere (a table cell, a
	 * separate <label for>, a settings row with a custom layout). */
	.wpd-checkbox__label:empty {
		display: none;
	}
`;
  const _WpdCheckbox = class _WpdCheckbox extends Component {
    render() {
      const checked = this.checked !== null;
      const disabled = this.disabled !== null;
      const label = this.label || "";
      const value = this.value;
      return html`
			<label>
				<input
					type="checkbox"
					?checked=${checked}
					?disabled=${disabled}
					.value=${value ?? ""}
					@change=${(e) => this._onChange(e)}
				/>
				<span class="wpd-checkbox__label">${label}</span>
			</label>
		`;
    }
    _onChange(e) {
      const input = e.target;
      const next = input.checked;
      if (next) {
        this.setAttribute("checked", "");
      } else {
        this.removeAttribute("checked");
      }
      this.emit("wpd-checkbox-change", {
        checked: next,
        value: this.value
      });
    }
  };
  _WpdCheckbox.props = ["checked", "value", "label", "disabled"];
  _WpdCheckbox.styles = [styles$b];
  let WpdCheckbox = _WpdCheckbox;
  defineComponent("wpd-checkbox", WpdCheckbox);
  const styles$a = css`
	:host {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		color: var( --wp-desktop-text, #1d2327 );
		cursor: pointer;
	}
	label {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		cursor: pointer;
	}
	input[ type='checkbox' ] {
		accent-color: var( --wp-admin-theme-color, #2271b1 );
		cursor: pointer;
	}
`;
  const _WpdCheckboxLabel = class _WpdCheckboxLabel extends Component {
    render() {
      const label = this.label || "";
      const checked = this.checked !== null;
      return html`
			<label>
				<input
					type="checkbox"
					?checked=${checked}
					@change=${(e) => this._onChange(e)}
				/>
				<span class="wpd-checkbox-label__text">${label}</span>
			</label>
		`;
    }
    _onChange(e) {
      const next = e.target.checked;
      if (next) {
        this.setAttribute("checked", "");
      } else {
        this.removeAttribute("checked");
      }
      this.emit("wpd-checkbox-change", { checked: next });
    }
  };
  _WpdCheckboxLabel.props = ["label", "checked"];
  _WpdCheckboxLabel.styles = [styles$a];
  let WpdCheckboxLabel = _WpdCheckboxLabel;
  defineComponent("wpd-checkbox-label", WpdCheckboxLabel);
  const tabsStyles = css`
	:host {
		display: flex;
		gap: 4px;
		margin-bottom: 10px;
		border-bottom: 1px solid var( --wp-desktop-border, #dcdcde );
	}
`;
  const tabPanelStyles = css`
	/*
	 * Shadow-DOM styles. :host targets the panel element; slotted
	 * light children flow through the single <slot> in the render.
	 * The :host([hidden]) rule spells out display: none because the
	 * :host block above sets display: block and that would otherwise
	 * beat the UA [hidden] { display: none } rule.
	 */
	:host {
		display: block;
	}
	:host( [ hidden ] ) {
		display: none;
	}
	:host( :focus-visible ) {
		outline: 2px solid var( --wp-admin-theme-color, #2271b1 );
		outline-offset: 4px;
		border-radius: 4px;
	}
`;
  const tabStyles = css`
	:host {
		display: inline-block;
	}
	button {
		appearance: none;
		padding: 6px 10px;
		border: none;
		background: transparent;
		color: var( --wp-desktop-muted, #50575e );
		font: inherit;
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		border-bottom: 2px solid transparent;
		margin-bottom: -1px;
		transition: color 0.15s ease, border-color 0.15s ease;
	}
	button:hover {
		color: var( --wp-admin-theme-color, #2271b1 );
	}
	button:focus-visible {
		outline: 2px solid var( --wp-admin-theme-color, #2271b1 );
		outline-offset: 2px;
	}
	:host( [ aria-selected='true' ] ) button {
		color: var( --wp-admin-theme-color, #2271b1 );
		border-bottom-color: var( --wp-admin-theme-color, #2271b1 );
	}
`;
  const _WpdTab = class _WpdTab extends Component {
    render() {
      this.setAttribute("role", "tab");
      return html`
			<button type="button" @click=${() => this._onPick()}>
				<slot></slot>
			</button>
		`;
    }
    _onPick() {
      this.emit("wpd-tab-pick", {
        value: this.value
      });
    }
  };
  _WpdTab.props = ["value"];
  _WpdTab.styles = [tabStyles];
  let WpdTab = _WpdTab;
  defineComponent("wpd-tab", WpdTab);
  const _WpdTabs = class _WpdTabs extends Component {
    connectedCallback() {
      super.connectedCallback();
      this.addEventListener("wpd-tab-pick", (e) => {
        const detail = e.detail;
        e.stopPropagation();
        this.value = detail.value;
        this.emit("wpd-tab-change", { value: detail.value });
      });
    }
    /**
     * Declarative item-list setter. Replaces the existing `<wpd-tab>`
     * children with a fresh set built from a `{ value, label }`
     * array. The `value` prop is preserved if it still matches a new
     * entry; otherwise it falls back to the first item.
     *
     * Lets plugins that populate tabs dynamically (route-driven
     * admin screens, filtered lists) replace the declarative
     * markup with a one-liner:
     *
     * ```js
     * tabs.items = [
     *   { value: 'calc',    label: 'Calc' },
     *   { value: 'convert', label: 'Convert' },
     * ];
     * ```
     *
     * @since 0.11.0
     */
    set items(list) {
      replaceChildren(this, "wpd-tab", list);
      const current = this.value;
      const stillValid = current !== null && list.some((i) => i.value === current);
      if (!stillValid && list.length > 0) {
        this.value = list[0].value;
      } else {
        this.requestUpdate();
      }
    }
    render() {
      this.setAttribute("role", "tablist");
      const label = this.label || "";
      if (label) {
        this.setAttribute("aria-label", label);
      }
      const current = this.value;
      queueMicrotask(() => {
        const tabs = this.querySelectorAll("wpd-tab");
        for (const tab of Array.from(tabs)) {
          const v = tab.getAttribute("value");
          tab.setAttribute(
            "aria-selected",
            v === current ? "true" : "false"
          );
          tab.setAttribute("tabindex", v === current ? "0" : "-1");
        }
        syncTabpanels(this, current);
      });
      return html`<slot></slot>`;
    }
  };
  _WpdTabs.props = ["value", "label"];
  _WpdTabs.styles = [tabsStyles];
  let WpdTabs = _WpdTabs;
  defineComponent("wpd-tabs", WpdTabs);
  const _WpdTabPanel = class _WpdTabPanel extends Component {
    // Shadow DOM — the render target for this component is its
    // own shadow root, which holds a single `<slot>` that projects
    // whatever the caller placed between the `<wpd-tabpanel>` open
    // and close tags. Slotted children remain light-DOM descendants
    // of the panel element (the slot rendering mechanism doesn't
    // move them), so `panel.querySelector(...)` from plugin render
    // callbacks keeps working.
    //
    // Earlier 0.11.0 builds of this component used light DOM with
    // a `<slot>` render, which wiped the panel's server-rendered
    // template content on first mount — every `render()` writes
    // into `_renderRoot`, and with light DOM that's the panel
    // itself. Shadow DOM isolates the render surface.
    connectedCallback() {
      super.connectedCallback();
      this.setAttribute("role", "tabpanel");
      if (!this.hasAttribute("tabindex")) {
        this.setAttribute("tabindex", "0");
      }
      const owner = findOwningTabs(this);
      if (owner) {
        syncTabpanels(owner, owner.getAttribute("value"));
      }
    }
    render() {
      return html`<slot></slot>`;
    }
  };
  _WpdTabPanel.props = ["for"];
  _WpdTabPanel.styles = [tabPanelStyles];
  let WpdTabPanel = _WpdTabPanel;
  defineComponent("wpd-tabpanel", WpdTabPanel);
  function replaceChildren(host, tag, items) {
    const existing = host.querySelectorAll(`:scope > ${tag}`);
    for (const el of Array.from(existing)) {
      el.remove();
    }
    for (const item of items) {
      const el = document.createElement(tag);
      el.setAttribute("value", item.value);
      el.textContent = item.label;
      host.appendChild(el);
    }
  }
  function findOwningTabs(panel) {
    const parent = panel.parentElement;
    if (!parent) {
      return null;
    }
    const sibling = parent.querySelector(":scope > wpd-tabs");
    if (sibling) {
      return sibling;
    }
    return panel.closest("wpd-tabs");
  }
  function syncTabpanels(tabs, value) {
    const parent = tabs.parentElement;
    if (!parent) {
      return;
    }
    const panels = parent.querySelectorAll(":scope > wpd-tabpanel");
    for (const panel of Array.from(panels)) {
      const pfor = panel.getAttribute("for");
      const active2 = pfor !== null && pfor === value;
      if (active2) {
        panel.removeAttribute("hidden");
      } else {
        panel.setAttribute("hidden", "");
      }
      panel.setAttribute("aria-hidden", active2 ? "false" : "true");
    }
  }
  const styles$9 = css`
	:host {
		display: flex;
		flex-direction: column;
		gap: var( --wpd-stack-gap, 12px );
		align-items: var( --wpd-stack-align, stretch );
	}
	:host( [ hidden ] ) {
		display: none;
	}
`;
  const _WpdStack = class _WpdStack extends Component {
    render() {
      const gap = this.gap;
      const align = this.align;
      const gapPx = gap && /^\d+$/.test(gap) ? `${gap}px` : "";
      if (gapPx) {
        this.style.setProperty("--wpd-stack-gap", gapPx);
      }
      if (align) {
        this.style.setProperty("--wpd-stack-align", align);
      }
      return html`<slot></slot>`;
    }
  };
  _WpdStack.props = ["gap", "align"];
  _WpdStack.styles = [styles$9];
  let WpdStack = _WpdStack;
  defineComponent("wpd-stack", WpdStack);
  const styles$8 = css`
	:host {
		display: flex;
		flex-direction: row;
		flex-wrap: wrap;
		gap: var( --wpd-cluster-gap, 8px );
		justify-content: var( --wpd-cluster-justify, flex-start );
		align-items: var( --wpd-cluster-align, center );
	}
	:host( [ hidden ] ) {
		display: none;
	}
`;
  const _WpdCluster = class _WpdCluster extends Component {
    render() {
      const gap = this.gap;
      const justify = this.justify;
      const align = this.align;
      const gapPx = gap && /^\d+$/.test(gap) ? `${gap}px` : "";
      if (gapPx) {
        this.style.setProperty("--wpd-cluster-gap", gapPx);
      }
      if (justify) {
        this.style.setProperty("--wpd-cluster-justify", justify);
      }
      if (align) {
        this.style.setProperty("--wpd-cluster-align", align);
      }
      return html`<slot></slot>`;
    }
  };
  _WpdCluster.props = ["gap", "justify", "align"];
  _WpdCluster.styles = [styles$8];
  let WpdCluster = _WpdCluster;
  defineComponent("wpd-cluster", WpdCluster);
  const styles$7 = css`
	:host {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: var( --wpd-icon-size, 16px );
		height: var( --wpd-icon-size, 16px );
		color: inherit;
		line-height: 1;
	}
	:host( [ hidden ] ) {
		display: none;
	}
	.wpd-icon__glyph {
		font-size: var( --wpd-icon-size, 16px );
		width: var( --wpd-icon-size, 16px );
		height: var( --wpd-icon-size, 16px );
		line-height: 1;
		color: inherit;
	}
`;
  const _WpdIcon = class _WpdIcon extends Component {
    render() {
      const rawName = this.name || "";
      const slug = rawName.startsWith("dashicons-") ? rawName.slice("dashicons-".length) : rawName;
      const size = this.size;
      if (size && /^\d+$/.test(size)) {
        this.style.setProperty("--wpd-icon-size", `${size}px`);
      }
      return html`<span
			class="wpd-icon__glyph dashicons dashicons-${slug}"
			aria-hidden="true"
		></span>`;
    }
  };
  _WpdIcon.props = ["name", "size"];
  _WpdIcon.styles = [styles$7];
  let WpdIcon = _WpdIcon;
  defineComponent("wpd-icon", WpdIcon);
  const styles$6 = css`
	:host {
		display: flex;
		flex-direction: column;
		gap: var( --wpd-body-gap, 12px );
		padding: var( --wpd-body-padding, 16px );
		box-sizing: border-box;
		width: 100%;
		height: 100%;
		min-width: 0;
		min-height: 0;
	}

	:host( [ scroll ] ) {
		overflow: auto;
	}

	:host( [ hidden ] ) {
		display: none;
	}

	/*
	 * Children with a col attribute look like they should span a
	 * 12-column grid — but wpd-body itself is a flex column, not a
	 * grid. Plugin authors wanting 12-col layout wrap their
	 * children in a wpd-row. This rule catches the accidental
	 * "I put col on a wpd-body child" case and still renders the
	 * element full-width rather than squashed to nothing.
	 */
	::slotted( * ) {
		min-width: 0;
	}
`;
  const _WpdBody = class _WpdBody extends Component {
    render() {
      const gap = this.gap;
      const padding = this.padding;
      if (gap && /^\d+$/.test(gap)) {
        this.style.setProperty("--wpd-body-gap", `${gap}px`);
      }
      if (padding && /^\d+$/.test(padding)) {
        this.style.setProperty("--wpd-body-padding", `${padding}px`);
      }
      return html`<slot></slot>`;
    }
  };
  _WpdBody.props = ["gap", "padding", "scroll"];
  _WpdBody.styles = [styles$6];
  let WpdBody = _WpdBody;
  defineComponent("wpd-body", WpdBody);
  const styles$5 = css`
	:host {
		display: flex;
		flex-direction: column;
		gap: var( --wpd-panel-gap, 12px );
		padding: var( --wpd-panel-padding, 16px );
		box-sizing: border-box;
	}
	:host( [ hidden ] ) {
		display: none;
	}
`;
  const _WpdPanel = class _WpdPanel extends Component {
    render() {
      const gap = this.gap;
      const padding = this.padding;
      if (gap && /^\d+$/.test(gap)) {
        this.style.setProperty("--wpd-panel-gap", `${gap}px`);
      }
      if (padding && /^\d+$/.test(padding)) {
        this.style.setProperty("--wpd-panel-padding", `${padding}px`);
      }
      return html`<slot></slot>`;
    }
  };
  _WpdPanel.props = ["gap", "padding"];
  _WpdPanel.styles = [styles$5];
  let WpdPanel = _WpdPanel;
  defineComponent("wpd-panel", WpdPanel);
  const styles$4 = css`
	:host {
		display: grid;
		grid-template-columns: repeat( 12, minmax( 0, 1fr ) );
		gap: var( --wpd-row-gap, 12px );
		row-gap: var( --wpd-row-row-gap, var( --wpd-row-gap, 12px ) );
		column-gap: var( --wpd-row-column-gap, var( --wpd-row-gap, 12px ) );
		width: 100%;
		min-width: 0;
	}

	:host( [ hidden ] ) {
		display: none;
	}

	/*
	 * Explicit col spans. Each rule is tiny; keeping 12 of them
	 * is simpler than a more magical matching scheme (and the
	 * compiled stylesheet is still a few hundred bytes).
	 */
	::slotted( [ col='1' ] )  { grid-column: span 1; }
	::slotted( [ col='2' ] )  { grid-column: span 2; }
	::slotted( [ col='3' ] )  { grid-column: span 3; }
	::slotted( [ col='4' ] )  { grid-column: span 4; }
	::slotted( [ col='5' ] )  { grid-column: span 5; }
	::slotted( [ col='6' ] )  { grid-column: span 6; }
	::slotted( [ col='7' ] )  { grid-column: span 7; }
	::slotted( [ col='8' ] )  { grid-column: span 8; }
	::slotted( [ col='9' ] )  { grid-column: span 9; }
	::slotted( [ col='10' ] ) { grid-column: span 10; }
	::slotted( [ col='11' ] ) { grid-column: span 11; }
	::slotted( [ col='12' ] ) { grid-column: span 12; }

	/*
	 * Children without a col attribute default to spanning the
	 * full row — matches the intuition that dropping a single
	 * element into a row shouldn't shrink it to 1/12 of the
	 * width. Plugin authors who want auto-fit per-child sizing
	 * should reach for <wpd-grid> instead.
	 */
	::slotted( :not( [ col ] ) ) {
		grid-column: 1 / -1;
	}

	/*
	 * Tiny min-width guard — flex/grid children default to
	 * min-width: auto which lets overflowing content push the
	 * track wider than its assigned fraction. The minmax(0, 1fr)
	 * above already helps; this makes sure long option labels
	 * inside a wpd-select don't burst the row.
	 */
	::slotted( * ) {
		min-width: 0;
	}
`;
  const _WpdRow = class _WpdRow extends Component {
    render() {
      const gap = this.gap;
      const cg = this["column-gap"];
      const rg = this["row-gap"];
      if (gap && /^\d+$/.test(gap)) {
        this.style.setProperty("--wpd-row-gap", `${gap}px`);
      }
      if (cg && /^\d+$/.test(cg)) {
        this.style.setProperty("--wpd-row-column-gap", `${cg}px`);
      }
      if (rg && /^\d+$/.test(rg)) {
        this.style.setProperty("--wpd-row-row-gap", `${rg}px`);
      }
      return html`<slot></slot>`;
    }
  };
  _WpdRow.props = ["gap", "column-gap", "row-gap"];
  _WpdRow.styles = [styles$4];
  let WpdRow = _WpdRow;
  defineComponent("wpd-row", WpdRow);
  const styles$3 = css`
	:host {
		display: grid;
		grid-template-columns: var( --wpd-grid-columns, 1fr );
		grid-template-rows: var( --wpd-grid-rows, auto );
		gap: var( --wpd-grid-gap, 8px );
		column-gap: var( --wpd-grid-column-gap, var( --wpd-grid-gap, 8px ) );
		row-gap: var( --wpd-grid-row-gap, var( --wpd-grid-gap, 8px ) );
	}
	:host( [ hidden ] ) {
		display: none;
	}
`;
  const _WpdGrid = class _WpdGrid extends Component {
    render() {
      const columns = this.columns;
      const rows = this.rows;
      const gap = this.gap;
      const cg = this["column-gap"];
      const rg = this["row-gap"];
      if (columns && /^\d+$/.test(columns)) {
        this.style.setProperty(
          "--wpd-grid-columns",
          `repeat(${columns}, minmax(0, 1fr))`
        );
      }
      if (rows && /^\d+$/.test(rows)) {
        this.style.setProperty(
          "--wpd-grid-rows",
          `repeat(${rows}, minmax(0, 1fr))`
        );
      }
      if (gap && /^\d+$/.test(gap)) {
        this.style.setProperty("--wpd-grid-gap", `${gap}px`);
      }
      if (cg && /^\d+$/.test(cg)) {
        this.style.setProperty("--wpd-grid-column-gap", `${cg}px`);
      }
      if (rg && /^\d+$/.test(rg)) {
        this.style.setProperty("--wpd-grid-row-gap", `${rg}px`);
      }
      return html`<slot></slot>`;
    }
  };
  _WpdGrid.props = ["columns", "rows", "gap", "column-gap", "row-gap"];
  _WpdGrid.styles = [styles$3];
  let WpdGrid = _WpdGrid;
  defineComponent("wpd-grid", WpdGrid);
  const styles$2 = css`
	:host {
		display: flex;
		align-items: center;
		justify-content: var( --wpd-display-align, flex-end );
		width: 100%;
		min-height: calc( var( --wpd-display-size, 28px ) * 1.4 );
		padding: 8px 14px;
		box-sizing: border-box;
		font-size: var( --wpd-display-size, 28px );
		font-variant-numeric: tabular-nums;
		font-weight: 500;
		letter-spacing: 0.01em;
		color: var( --wpd-display-fg, var( --wp-desktop-text, #1d2327 ) );
		background: var( --wpd-display-bg, transparent );
		border-radius: var( --wpd-display-border-radius, 0 );
		line-height: 1.1;
		overflow: hidden;
		/* A readout SHOULD truncate on overflow — a numeric display
		 * that silently wraps is a UX bug. Callers that want the full
		 * value visible size their display or cap their input upstream. */
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	:host( [ hidden ] ) {
		display: none;
	}
	.wpd-display__output {
		display: block;
		font: inherit;
		color: inherit;
		text-align: var( --wpd-display-align, end );
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}
`;
  const SIZE_PX = {
    sm: "16px",
    md: "20px",
    lg: "28px",
    xl: "40px"
  };
  const _WpdDisplay = class _WpdDisplay extends Component {
    connectedCallback() {
      super.connectedCallback?.();
      if (!this.hasAttribute("aria-live")) {
        this.setAttribute("aria-live", "polite");
      }
      if (!this.hasAttribute("role")) {
        this.setAttribute("role", "status");
      }
    }
    render() {
      const value = this.value;
      const size = this.size || "lg";
      const align = this.align || "end";
      this.style.setProperty("--wpd-display-size", SIZE_PX[size] || SIZE_PX.lg);
      this.style.setProperty("--wpd-display-align", align);
      return html`
			<output part="output" class="wpd-display__output">
				${value !== null && value !== void 0 ? value : html`<slot></slot>`}
			</output>
		`;
    }
  };
  _WpdDisplay.props = ["value", "size", "align"];
  _WpdDisplay.styles = [styles$2];
  let WpdDisplay = _WpdDisplay;
  defineComponent("wpd-display", WpdDisplay);
  const styles$1 = css`
	:host {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 6px;
		padding: 32px 24px;
		text-align: center;
		color: var( --wpd-empty-state-fg, var( --wp-desktop-muted, #646970 ) );
	}
	:host( [ hidden ] ) {
		display: none;
	}
	.wpd-empty-state__icon {
		margin-bottom: 4px;
		color: var( --wpd-empty-state-icon-color, currentColor );
		opacity: 0.75;
	}
	.wpd-empty-state__heading {
		margin: 0;
		font-size: 14px;
		font-weight: 600;
		color: var( --wp-desktop-text, #1d2327 );
	}
	.wpd-empty-state__description {
		margin: 0;
		font-size: 12px;
		line-height: 1.4;
		max-width: 48ch;
	}
	.wpd-empty-state__description:empty {
		display: none;
	}
	.wpd-empty-state__cta {
		margin-top: 8px;
	}
	.wpd-empty-state__cta:empty {
		display: none;
	}
`;
  const _WpdEmptyState = class _WpdEmptyState extends Component {
    render() {
      const icon = this.icon || "";
      const heading = this.heading || "";
      const description = this.description || "";
      return html`
			${icon ? html`<wpd-icon
						class="wpd-empty-state__icon"
						name=${icon}
						size="28"
				  ></wpd-icon>` : null}
			<h3 class="wpd-empty-state__heading">${heading}</h3>
			<p class="wpd-empty-state__description">${description}</p>
			<div class="wpd-empty-state__cta">
				<slot name="cta"></slot>
			</div>
			<slot></slot>
		`;
    }
  };
  _WpdEmptyState.props = ["icon", "heading", "description"];
  _WpdEmptyState.styles = [styles$1];
  let WpdEmptyState = _WpdEmptyState;
  defineComponent("wpd-empty-state", WpdEmptyState);
  const styles = css`
	:host {
		display: inline-flex;
		user-select: none;
	}
	:host( [ fill-cell ] ),
	:host {
		/* Keys default to filling their cell; the calculator use
		 * case is the common one. Callers who want an inline key
		 * tile can override with display:inline-flex and width:auto
		 * on the host. */
		display: flex;
		width: 100%;
	}
	:host( [ hidden ] ) {
		display: none;
	}
	button {
		width: 100%;
		min-height: var( --wpd-key-min-height, 48px );
		appearance: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: var( --wpd-key-padding, 8px 12px );
		font: inherit;
		font-size: var( --wpd-key-font-size, 16px );
		font-weight: 500;
		cursor: pointer;
		border-radius: var( --wpd-key-border-radius, 8px );
		background: var( --wpd-key-bg, rgba( 0, 0, 0, 0.06 ) );
		color: var( --wpd-key-fg, var( --wp-desktop-text, #1d2327 ) );
		border: var( --wpd-key-border, 1px solid transparent );
		transition:
			transform 0.08s ease,
			background-color 0.12s ease,
			box-shadow 0.12s ease;
	}
	button:hover:not( :disabled ) {
		background: var( --wpd-key-bg-hover, rgba( 0, 0, 0, 0.1 ) );
	}
	:host( [ variant='primary' ] ) button {
		background: var( --wpd-key-bg, var( --wp-admin-theme-color, #2271b1 ) );
		color: var( --wpd-key-fg, #fff );
	}
	:host( [ variant='primary' ] ) button:hover:not( :disabled ) {
		filter: brightness( 1.06 );
	}
	:host( [ variant='secondary' ] ) button {
		background: var( --wpd-key-bg, rgba( 0, 0, 0, 0.04 ) );
	}
	:host( [ variant='ghost' ] ) button {
		background: transparent;
		border: var( --wpd-key-border, 1px solid var( --wp-desktop-border, #c3c4c7 ) );
	}
	:host( [ variant='danger' ] ) button {
		background: transparent;
		color: #d63638;
		border: 1px solid currentColor;
	}
	/* Pressed — both click-flash and keyboard-hold resolve here. The
	 * visual is deliberately tactile: inset shadow + subtle scale-down
	 * so the key reads as "squeezed" rather than "disappeared." */
	:host( .wpd-key--pressed ) button,
	button:active:not( :disabled ) {
		transform: scale( 0.96 );
		box-shadow: inset 0 1px 2px rgba( 0, 0, 0, 0.22 );
		background: var( --wpd-key-bg-pressed, rgba( 0, 0, 0, 0.14 ) );
	}
	button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
`;
  const PRESSED_CLASS = "wpd-key--pressed";
  const _WpdKey = class _WpdKey extends Component {
    constructor() {
      super(...arguments);
      this._onKeyDown = null;
      this._onKeyUp = null;
      this._keyHeldByKeyboard = false;
    }
    connectedCallback() {
      super.connectedCallback?.();
      this._onKeyDown = (e) => this.handleKeyboardDown(e);
      this._onKeyUp = (e) => this.handleKeyboardUp(e);
      document.addEventListener("keydown", this._onKeyDown);
      document.addEventListener("keyup", this._onKeyUp);
    }
    disconnectedCallback() {
      if (this._onKeyDown) {
        document.removeEventListener("keydown", this._onKeyDown);
      }
      if (this._onKeyUp) {
        document.removeEventListener("keyup", this._onKeyUp);
      }
    }
    render() {
      const label = this.label;
      const disabled = this.disabled !== null;
      return html`
			<button
				part="button"
				type="button"
				?disabled=${disabled}
				@click=${(e) => this.handleClick(e)}
			>
				${label !== null && label !== void 0 && label !== "" ? label : html`<slot></slot>`}
			</button>
		`;
    }
    handleClick(e) {
      if (this.isDisabled()) {
        return;
      }
      const detail = this.buildDetail("click");
      this.flashPressed();
      if (this.hasAttribute("hold")) {
        this.emitKey("wpd-key-down", detail);
        this.emitKey("wpd-key-up", detail);
      } else {
        this.emitKey("wpd-key", detail);
      }
      e.stopPropagation();
    }
    handleKeyboardDown(e) {
      if (this.isDisabled() || !this.matchesEvent(e)) {
        return;
      }
      if (this._keyHeldByKeyboard) {
        return;
      }
      this._keyHeldByKeyboard = true;
      this.classList.add(PRESSED_CLASS);
      const detail = this.buildDetail("keyboard");
      if (this.hasAttribute("hold")) {
        this.emitKey("wpd-key-down", detail);
      } else {
        this.emitKey("wpd-key", detail);
      }
    }
    handleKeyboardUp(e) {
      if (!this._keyHeldByKeyboard || !this.matchesEvent(
        e,
        /* up */
        true
      )) {
        return;
      }
      this._keyHeldByKeyboard = false;
      this.classList.remove(PRESSED_CLASS);
      if (this.hasAttribute("hold")) {
        this.emitKey("wpd-key-up", this.buildDetail("keyboard"));
      }
    }
    /**
     * Decide whether an incoming KeyboardEvent matches the key cap.
     * Prefers `code` (positional) when set, falls back to `key`
     * (character / named). Modifier-matching is strict: if
     * `modifier` is absent, no modifier may be held; if present,
     * ALL listed modifiers must be held. Prevents a bare `7` key
     * from firing when the user presses Ctrl+7.
     */
    matchesEvent(e, _isUp = false) {
      const expectedCode = this.code || "";
      const expectedKey = this.key || "";
      if (expectedCode) {
        if (e.code !== expectedCode) {
          return false;
        }
      } else if (expectedKey) {
        if (e.key !== expectedKey) {
          return false;
        }
      } else {
        return false;
      }
      const rawMod = this.modifier || "";
      const required = new Set(
        rawMod.split("+").map((s) => s.trim().toLowerCase()).filter(Boolean)
      );
      const expectCtrl = required.has("ctrl") || required.has("control");
      const expectAlt = required.has("alt");
      const expectShift = required.has("shift");
      const expectMeta = required.has("meta") || required.has("cmd") || required.has("command");
      return e.ctrlKey === expectCtrl && e.altKey === expectAlt && e.shiftKey === expectShift && e.metaKey === expectMeta;
    }
    buildDetail(source) {
      const label = this.label || this.textContent?.trim() || "";
      return {
        key: this.key || "",
        code: this.code || "",
        label,
        source
      };
    }
    isDisabled() {
      return this.disabled !== null;
    }
    emitKey(type, detail) {
      this.dispatchEvent(
        new CustomEvent(type, {
          detail,
          bubbles: true,
          composed: true
        })
      );
    }
    /**
     * Brief visual press flash for click-driven presses — keyboard
     * presses get the pressed class via the keydown/keyup pair.
     * Timeout matches the CSS transition so the paint window
     * roughly aligns with the state flip.
     */
    flashPressed() {
      this.classList.add(PRESSED_CLASS);
      window.setTimeout(() => {
        this.classList.remove(PRESSED_CLASS);
      }, 120);
    }
  };
  _WpdKey.props = [
    "key",
    "code",
    "label",
    "variant",
    "fill-cell",
    "hold",
    "modifier",
    "disabled"
  ];
  _WpdKey.styles = [styles];
  let WpdKey = _WpdKey;
  defineComponent("wpd-key", WpdKey);
  const WPD_COMPONENT_TAGS = [
    "wpd-section",
    "wpd-button",
    "wpd-swatch",
    "wpd-swatch-grid",
    "wpd-segmented",
    "wpd-segment",
    "wpd-select",
    "wpd-option",
    "wpd-color-field",
    "wpd-range-field",
    "wpd-text-field",
    "wpd-number-field",
    "wpd-checkbox",
    "wpd-checkbox-label",
    "wpd-toast",
    "wpd-toast-container",
    "wpd-tabs",
    "wpd-tab",
    "wpd-tabpanel",
    "wpd-window-button",
    "wpd-menu",
    "wpd-menu-item",
    "wpd-tab-chip",
    "wpd-stack",
    "wpd-cluster",
    "wpd-icon",
    "wpd-body",
    "wpd-panel",
    "wpd-row",
    "wpd-grid",
    "wpd-display",
    "wpd-empty-state",
    "wpd-key"
  ];
  function collectRegistrationErrors(def, checks) {
    if (!def || typeof def !== "object") {
      return ["def (not an object)"];
    }
    const d = def;
    const errors = [];
    for (const check of checks) {
      if (!check.valid(d)) {
        errors.push(`${check.field} (${check.message})`);
      }
    }
    return errors;
  }
  function logRegistrationErrors(kind, errors, def) {
    if (typeof console === "undefined") {
      return;
    }
    console.warn(
      `[wp-desktop-mode] ${kind} registration rejected — fields: ` + errors.join(", ") + ".",
      def
    );
  }
  const seed$1 = [];
  function register$1(def) {
    const errors = collectRegistrationErrors(def, WALLPAPER_CHECKS);
    if (errors.length > 0) {
      logRegistrationErrors("Wallpaper", errors, def);
      return;
    }
    const idx = seed$1.findIndex((w) => w.id === def.id);
    if (idx >= 0) {
      seed$1[idx] = def;
    } else {
      seed$1.push(def);
    }
    notify$2();
  }
  function unregister$1(id) {
    const idx = seed$1.findIndex((w) => w.id === id);
    if (idx >= 0) {
      seed$1.splice(idx, 1);
      notify$2();
    }
  }
  const listeners$2 = /* @__PURE__ */ new Set();
  function subscribe(cb) {
    listeners$2.add(cb);
    return () => {
      listeners$2.delete(cb);
    };
  }
  function notify$2() {
    const snapshot = Array.from(listeners$2);
    for (const cb of snapshot) {
      try {
        cb();
      } catch (err) {
        if (typeof console !== "undefined") {
          console.error(
            "[wp-desktop-mode] wallpaper registry listener threw:",
            err
          );
        }
      }
    }
  }
  function all$1() {
    const copy = seed$1.slice();
    const filtered = applyFilters(HOOKS.WALLPAPERS, copy);
    if (!Array.isArray(filtered)) {
      if (typeof console !== "undefined") {
        console.warn(
          "[wp-desktop-mode] `wp-desktop.wallpapers` filter returned a non-array; falling back to seed list."
        );
      }
      return copy;
    }
    return filtered.filter(isValidDef$1);
  }
  function get$1(id) {
    return all$1().find((w) => w.id === id);
  }
  const WALLPAPER_CHECKS = [
    {
      field: "id",
      message: "missing or not a non-empty string",
      valid: (d) => typeof d.id === "string" && d.id !== ""
    },
    {
      field: "label",
      message: "missing or not a non-empty string",
      valid: (d) => typeof d.label === "string" && d.label !== ""
    },
    {
      field: "preview",
      message: "missing or not a non-empty string",
      valid: (d) => typeof d.preview === "string" && d.preview !== ""
    },
    {
      field: "type",
      message: 'must be "css" or "canvas"',
      valid: (d) => d.type === "css" || d.type === "canvas"
    },
    {
      field: "value/resolveValue/mount",
      message: "css types need `value` or `resolveValue`; canvas types need `mount`",
      valid: (d) => {
        if (d.type === "css") {
          return typeof d.value === "string" || typeof d.resolveValue === "function";
        }
        if (d.type === "canvas") {
          return typeof d.mount === "function";
        }
        return true;
      }
    }
  ];
  function isValidDef$1(def) {
    return collectRegistrationErrors(def, WALLPAPER_CHECKS).length === 0;
  }
  const STORAGE_KEY = "wp-desktop-os-settings";
  const HD_MIN_WIDTH = 1920;
  const HD_MIN_HEIGHT = 1080;
  const MEDIA_PER_PAGE = 40;
  const SEARCH_DEBOUNCE_MS = 300;
  const CUSTOM_GRADIENT_ID = "custom-gradient";
  const CUSTOM_IMAGE_ID = "custom-image";
  const DEFAULT_WALLPAPER_ID = "dark";
  const DEFAULT_ACCENTS = [
    { id: "wp-blue", label: "WordPress Blue", value: "#2271b1" },
    { id: "indigo", label: "Indigo", value: "#3858e9" },
    { id: "teal", label: "Teal", value: "#04a4cc" },
    { id: "emerald", label: "Emerald", value: "#059669" },
    { id: "amber", label: "Amber", value: "#d97706" },
    { id: "rose", label: "Rose", value: "#e11d48" }
  ];
  function getAccents() {
    const config = window.wp?.desktop?.config;
    const raw = config?.accentColors;
    if (!Array.isArray(raw) || raw.length === 0) {
      return DEFAULT_ACCENTS;
    }
    const clean = [];
    for (const entry of raw) {
      if (entry && typeof entry === "object" && typeof entry.id === "string" && typeof entry.label === "string" && typeof entry.value === "string" && entry.id !== "" && entry.label !== "" && /^#[0-9a-f]{3,8}$/i.test(entry.value)) {
        clean.push({ id: entry.id, label: entry.label, value: entry.value });
      }
    }
    return clean.length > 0 ? clean : DEFAULT_ACCENTS;
  }
  function getDefaultWallpaperId() {
    const config = window.wp?.desktop?.config;
    const raw = config?.defaultWallpaper;
    if (typeof raw === "string" && raw !== "") {
      return raw;
    }
    return DEFAULT_WALLPAPER_ID;
  }
  const DOCK_SIZES = [
    { id: "compact", label: "Compact", width: 48, icon: 18 },
    { id: "default", label: "Default", width: 56, icon: 20 },
    { id: "large", label: "Large", width: 72, icon: 26 }
  ];
  const DEFAULTS = {
    wallpaper: DEFAULT_WALLPAPER_ID,
    accent: "wp-blue",
    dockSize: "default",
    customGradient: {
      from: "#2271b1",
      to: "#7c3aed",
      angle: 135
    },
    customImage: null,
    libraryHdOnly: true,
    ai: {
      enabled: false,
      provider: "openai",
      apiKey: ""
    }
  };
  const AI_PROVIDERS = [
    { id: "openai", label: "OpenAI" }
  ];
  function isPromise(value) {
    return !!value && typeof value === "object" && typeof value.then === "function";
  }
  function isHexColor(value) {
    return typeof value === "string" && /^#[0-9a-f]{3,8}$/i.test(value);
  }
  function sanitizeFilename(name) {
    const cleaned = name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
    return cleaned || "wallpaper";
  }
  function isUsableImage(item) {
    if (!item || typeof item.id !== "number" || !item.source_url) {
      return false;
    }
    const d = item.media_details;
    return !!d && typeof d.width === "number" && typeof d.height === "number" && d.width > 0 && d.height > 0;
  }
  function stripHtml(markup) {
    if (!markup) {
      return "";
    }
    const el = document.createElement("div");
    el.innerHTML = markup;
    return el.textContent?.trim() || "";
  }
  function loadState() {
    const serverRaw = _readServerSettings();
    if (serverRaw) {
      const state = _parseRaw(serverRaw);
      _writeLocalStorage(state);
      return state;
    }
    try {
      const cached = window.localStorage.getItem(STORAGE_KEY);
      if (cached) {
        return _parseRaw(JSON.parse(cached));
      }
    } catch {
    }
    return structuredDefaults();
  }
  function _readServerSettings() {
    const config = window.wpDesktopConfig;
    const raw = config?.osSettings;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return null;
    }
    return raw;
  }
  function _parseRaw(parsed) {
    const accents = getAccents();
    return {
      wallpaper: typeof parsed.wallpaper === "string" && parsed.wallpaper !== "" ? parsed.wallpaper : getDefaultWallpaperId(),
      accent: accents.some((a) => a.id === parsed.accent) ? parsed.accent : DEFAULTS.accent,
      dockSize: DOCK_SIZES.some((d) => d.id === parsed.dockSize) ? parsed.dockSize : DEFAULTS.dockSize,
      customGradient: sanitizeCustomGradient(parsed.customGradient),
      customImage: sanitizeCustomImage(parsed.customImage),
      libraryHdOnly: typeof parsed.libraryHdOnly === "boolean" ? parsed.libraryHdOnly : DEFAULTS.libraryHdOnly,
      ai: sanitizeAi(parsed.ai)
    };
  }
  let _syncTimer = null;
  const SYNC_DEBOUNCE_MS = 1500;
  function saveState(state) {
    _writeLocalStorage(state);
    _scheduleSyncToServer(state);
  }
  function _writeLocalStorage(state) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
    }
  }
  function _scheduleSyncToServer(state) {
    if (_syncTimer !== null) {
      clearTimeout(_syncTimer);
    }
    _syncTimer = setTimeout(() => {
      _syncTimer = null;
      _postToServer(state);
    }, SYNC_DEBOUNCE_MS);
  }
  function _postToServer(state) {
    const config = window.wpDesktopConfig;
    const url = config?.osSettingsUrl;
    const nonce = config?.restNonce;
    if (!url || !nonce) {
      return;
    }
    fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-WP-Nonce": nonce
      },
      body: JSON.stringify({ settings: state })
    }).catch(() => {
    });
  }
  function structuredDefaults() {
    return {
      ...DEFAULTS,
      customGradient: { ...DEFAULTS.customGradient },
      customImage: null,
      ai: { ...DEFAULTS.ai }
    };
  }
  function sanitizeAi(raw) {
    if (!raw || typeof raw !== "object") {
      return { ...DEFAULTS.ai };
    }
    const { enabled, provider, apiKey } = raw;
    const validProvider = AI_PROVIDERS.some((p) => p.id === provider) ? provider : DEFAULTS.ai.provider;
    return {
      enabled: typeof enabled === "boolean" ? enabled : DEFAULTS.ai.enabled,
      provider: validProvider,
      apiKey: typeof apiKey === "string" ? apiKey : DEFAULTS.ai.apiKey
    };
  }
  function sanitizeCustomGradient(raw) {
    if (!raw || typeof raw !== "object") {
      return { ...DEFAULTS.customGradient };
    }
    const { from, to, angle } = raw;
    return {
      from: isHexColor(from) ? from : DEFAULTS.customGradient.from,
      to: isHexColor(to) ? to : DEFAULTS.customGradient.to,
      angle: typeof angle === "number" && Number.isFinite(angle) && angle >= 0 && angle <= 360 ? angle : DEFAULTS.customGradient.angle
    };
  }
  function sanitizeCustomImage(raw) {
    if (!raw || typeof raw !== "object") {
      return null;
    }
    const { id, url } = raw;
    if (typeof id !== "number" || !Number.isFinite(id) || id <= 0) {
      return null;
    }
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) {
      return null;
    }
    return { id, url };
  }
  function translateAccentLabel(id, fallback) {
    switch (id) {
      case "wp-blue":
        return __("WordPress Blue");
      case "indigo":
        return __("Indigo");
      case "teal":
        return __("Teal");
      case "emerald":
        return __("Emerald");
      case "amber":
        return __("Amber");
      case "rose":
        return __("Rose");
      default:
        return fallback;
    }
  }
  function translateDockSizeLabel(id, fallback) {
    switch (id) {
      case "compact":
        return __("Compact");
      case "default":
        return __("Default");
      case "large":
        return __("Large");
      default:
        return fallback;
    }
  }
  function buildAccentSection(ctx) {
    const onPick = (e) => {
      const id = e.detail?.value ?? "";
      if (!getAccents().some((a) => a.id === id)) {
        return;
      }
      ctx.state.accent = id;
      ctx.save();
      ctx.apply();
      paint();
    };
    const wrapper = document.createElement("div");
    const paint = () => render(
      html`
				<wpd-section
					heading=${__("Accent color")}
					description=${__("Used in focused window title bars, buttons, and focus rings.")}
				>
					<wpd-swatch-grid
						label=${__("Accent color")}
						mode="row"
						@wpd-pick=${onPick}
					>
						${getAccents().map(
        (a) => html`<wpd-swatch
								value=${a.id}
								label=${translateAccentLabel(a.id, a.label)}
								preview=${a.value}
								size="small"
								?selected=${ctx.state.accent === a.id}
							></wpd-swatch>`
      )}
					</wpd-swatch-grid>
				</wpd-section>
			`,
      wrapper
    );
    paint();
    return wrapper;
  }
  function buildAiSection(ctx) {
    const wrapper = document.createElement("div");
    const onToggle = (e) => {
      const checked = e.detail?.checked === true;
      ctx.state.ai = { ...ctx.state.ai, enabled: checked };
      ctx.save();
      paint();
    };
    const onProvider = (e) => {
      const id = e.detail?.value ?? "";
      if (!AI_PROVIDERS.some((p) => p.id === id)) {
        return;
      }
      ctx.state.ai = { ...ctx.state.ai, provider: id };
      ctx.save();
    };
    const onApiKey = (e) => {
      const value = e.detail?.value ?? "";
      ctx.state.ai = { ...ctx.state.ai, apiKey: value };
      ctx.save();
    };
    const paint = () => {
      const platformEnabled = ctx.config.aiPlatformSettings?.enabled === true && !!ctx.config.aiPlatformSettings?.apiKey;
      render(
        html`
				<wpd-section
					heading=${__("AI integration")}
					description=${platformEnabled ? __("A platform-wide AI key is configured. You can optionally set a personal key below to override it.") : __("Connect an AI provider to power assistive features across the desktop.")}
				>
					<wpd-checkbox-label
						label=${__("Enable AI features")}
						?checked=${ctx.state.ai.enabled}
						@wpd-checkbox-change=${onToggle}
					></wpd-checkbox-label>

					<wpd-select
						label=${__("Provider")}
						value=${ctx.state.ai.provider}
						?disabled=${!ctx.state.ai.enabled}
						@wpd-pick=${onProvider}
					>
						${AI_PROVIDERS.map(
          (p) => html`<wpd-option value=${p.id}>${p.label}</wpd-option>`
        )}
					</wpd-select>

					<wpd-text-field
						label=${__("API key")}
						type="password"
						reveal
						autocomplete="off"
						placeholder=${platformEnabled ? __("Using platform key — enter to override") : __("sk-…")}
						value=${ctx.state.ai.apiKey}
						?disabled=${!ctx.state.ai.enabled}
						@wpd-input-change=${onApiKey}
					></wpd-text-field>
				</wpd-section>

				${ctx.config.isAdmin ? _buildGlobalSection(ctx) : html``}
			`,
        wrapper
      );
    };
    paint();
    return wrapper;
  }
  function _buildGlobalSection(ctx) {
    const { aiPlatformSettingsUrl: url, restNonce: nonce, aiPlatformSettings: initial } = ctx.config;
    const state = {
      enabled: initial?.enabled ?? false,
      provider: initial?.provider ?? "openai",
      apiKey: initial?.apiKey ?? "",
      saving: false,
      error: ""
    };
    const el = document.createElement("div");
    const save = async () => {
      if (!url || !nonce || state.saving) {
        return;
      }
      state.saving = true;
      state.error = "";
      paint();
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-WP-Nonce": nonce
          },
          body: JSON.stringify({
            settings: {
              enabled: state.enabled,
              provider: state.provider,
              apiKey: state.apiKey
            }
          })
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          state.error = err.message ?? `Error ${res.status}`;
        } else {
          const saved = await res.json().catch(() => null);
          if (saved && typeof saved === "object") {
            ctx.config.aiPlatformSettings = saved;
          }
        }
      } catch {
        state.error = __("Network error — check your connection.");
      } finally {
        state.saving = false;
        paint();
      }
    };
    const onToggle = (e) => {
      state.enabled = e.detail?.checked === true;
      save();
    };
    const onProvider = (e) => {
      const id = e.detail?.value ?? "";
      if (!AI_PROVIDERS.some((p) => p.id === id)) {
        return;
      }
      state.provider = id;
      save();
    };
    const onApiKey = (e) => {
      state.apiKey = e.detail?.value ?? "";
    };
    const onApiKeyCommit = () => {
      save();
    };
    const paint = () => render(
      html`
				<wpd-section
					heading=${__("Global settings")}
					description=${__("Platform-wide AI configuration. Applies to all users and to background jobs (cron, WP-CLI, anonymous comments). Individual users can override with their own key above.")}
				>
					<wpd-checkbox-label
						label=${__("Enable AI for all users")}
						?checked=${state.enabled}
						@wpd-checkbox-change=${onToggle}
					></wpd-checkbox-label>

					<wpd-select
						label=${__("Provider")}
						value=${state.provider}
						?disabled=${!state.enabled || state.saving}
						@wpd-pick=${onProvider}
					>
						${AI_PROVIDERS.map(
        (p) => html`<wpd-option value=${p.id}>${p.label}</wpd-option>`
      )}
					</wpd-select>

					<wpd-text-field
						label=${__("Platform API key")}
						type="password"
						reveal
						autocomplete="off"
						placeholder=${__("sk-…")}
						value=${state.apiKey}
						?disabled=${!state.enabled || state.saving}
						@wpd-input-change=${onApiKey}
						@wpd-input-commit=${onApiKeyCommit}
						@wpd-submit=${onApiKeyCommit}
					></wpd-text-field>

					${state.error ? html`<p class="wp-desktop-ai-settings__error">${state.error}</p>` : html``}
					${state.saving ? html`<p class="wp-desktop-ai-settings__saving">${__("Saving…")}</p>` : html``}
				</wpd-section>
			`,
      el
    );
    paint();
    return el;
  }
  function buildDockSizeSection(ctx) {
    const onPick = (e) => {
      const id = e.detail?.value ?? "";
      if (!DOCK_SIZES.some((d) => d.id === id)) {
        return;
      }
      ctx.state.dockSize = id;
      ctx.save();
      ctx.apply();
      paint();
    };
    const wrapper = document.createElement("div");
    const paint = () => render(
      html`
				<wpd-section
					heading=${__("Dock size")}
					description=${__("Width of the dock and size of its icons.")}
				>
					<wpd-segmented
						value=${ctx.state.dockSize}
						label=${__("Dock size")}
						@wpd-pick=${onPick}
					>
						${DOCK_SIZES.map(
        (s) => html`<wpd-segment value=${s.id}
								>${translateDockSizeLabel(s.id, s.label)}</wpd-segment
							>`
      )}
					</wpd-segmented>
				</wpd-section>
			`,
      wrapper
    );
    paint();
    return wrapper;
  }
  function buildExtendedSection(ctx) {
    const { extendedOptions, extendedOptionsUrl, restNonce } = ctx.config;
    const state = {
      media_library_enhanced: extendedOptions?.media_library_enhanced === true,
      saving: false,
      error: ""
    };
    const el = document.createElement("div");
    const save = async () => {
      if (!extendedOptionsUrl || !restNonce || state.saving) {
        return;
      }
      state.saving = true;
      state.error = "";
      paint();
      try {
        const res = await fetch(extendedOptionsUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-WP-Nonce": restNonce
          },
          body: JSON.stringify({
            options: {
              media_library_enhanced: state.media_library_enhanced
            }
          })
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          state.error = err.message ?? `Error ${res.status}`;
        } else {
          const saved = await res.json().catch(() => null);
          if (saved && typeof saved === "object") {
            ctx.config.extendedOptions = saved;
          }
        }
      } catch {
        state.error = __("Network error — check your connection.");
      } finally {
        state.saving = false;
        paint();
      }
    };
    const onMediaToggle = (e) => {
      state.media_library_enhanced = e.detail?.checked === true;
      save();
    };
    const paint = () => render(
      html`
				<wpd-section
					heading=${__("Extended options")}
					description=${__(
        "Site-wide enhancements that apply to every user. Toggling requires the affected page to be reloaded for the change to take effect."
      )}
				>
					<wpd-checkbox-label
						label=${__("Enable drag-and-drop in the Media Library")}
						?checked=${state.media_library_enhanced}
						@wpd-checkbox-change=${onMediaToggle}
					></wpd-checkbox-label>

					<p class="wp-desktop-ext__hint">
						${__(
        "Makes every item in the WordPress Media Library draggable. Drop a media item into text fields, rich-text editors, Gutenberg blocks, or any target that accepts images or files. No replacement of the library — just a drag-and-drop layer on top of the one you already know."
      )}
					</p>

					${state.error ? html`<p class="wp-desktop-ext__error">${state.error}</p>` : html``}
					${state.saving ? html`<p class="wp-desktop-ext__saving">${__("Saving…")}</p>` : html``}
				</wpd-section>
			`,
      el
    );
    paint();
    return el;
  }
  async function fetchMediaPage(config, page, search, hdOnly) {
    const url = new URL(config.mediaUrl);
    url.searchParams.set("media_type", "image");
    url.searchParams.set("per_page", String(MEDIA_PER_PAGE));
    url.searchParams.set("page", String(page));
    url.searchParams.set("orderby", "date");
    url.searchParams.set("order", "desc");
    url.searchParams.set(
      "_fields",
      "id,source_url,alt_text,title,media_details"
    );
    if (search) {
      url.searchParams.set("search", search);
    }
    if (hdOnly) {
      url.searchParams.set("wpdm_min_width", String(HD_MIN_WIDTH));
      url.searchParams.set("wpdm_min_height", String(HD_MIN_HEIGHT));
    }
    const response = await fetch(url.toString(), {
      credentials: "same-origin",
      headers: { "X-WP-Nonce": config.restNonce }
    });
    if (!response.ok) {
      let message = `HTTP ${response.status}`;
      try {
        const data = await response.json();
        if (data && typeof data.message === "string") {
          message = data.message;
        }
      } catch {
      }
      throw new Error(message);
    }
    const totalPagesHeader = response.headers.get("X-WP-TotalPages");
    const totalPages = totalPagesHeader ? parseInt(totalPagesHeader, 10) : 1;
    const items = await response.json();
    return { items: items.filter(isUsableImage), totalPages: totalPages || 1 };
  }
  async function uploadImage(config, file) {
    const response = await fetch(config.mediaUrl, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "X-WP-Nonce": config.restNonce,
        "Content-Type": file.type,
        "Content-Disposition": `attachment; filename="${sanitizeFilename(file.name)}"`
      },
      body: file
    });
    if (!response.ok) {
      let message = `Upload failed (HTTP ${response.status}).`;
      try {
        const data2 = await response.json();
        if (data2 && typeof data2.message === "string") {
          message = data2.message;
        }
      } catch {
      }
      throw new Error(message);
    }
    const data = await response.json();
    return { id: data.id, url: data.source_url };
  }
  function buildCustomImageSection(ctx, body) {
    const tabDefs = [];
    const pane = document.createElement("div");
    pane.className = "wp-desktop-os-settings__tab-pane";
    if (ctx.config.canUpload) {
      tabDefs.push({
        key: "upload",
        label: __("Upload new"),
        render: () => renderUploadPane(ctx, pane, body)
      });
    }
    tabDefs.push({
      key: "library",
      label: __("Media Library"),
      render: () => renderLibraryPane(ctx, pane, body)
    });
    const initialKey = tabDefs[0].key;
    const onTabChange = (e) => {
      const key = e.detail.value;
      tabDefs.find((t) => t.key === key)?.render();
    };
    const wrap = document.createElement("div");
    render(
      html`
			<div class="wp-desktop-os-settings__uploader">
				<h4 class="wp-desktop-os-settings__uploader-heading">
					${__("Or use your own image")}
				</h4>
				${tabDefs.length > 1 ? html`<wpd-tabs
							value=${initialKey}
							label=${__("Image source")}
							@wpd-tab-change=${onTabChange}
						>
							${tabDefs.map(
        (def) => html`<wpd-tab value=${def.key}
									>${def.label}</wpd-tab
								>`
      )}
						</wpd-tabs>` : null}
				${pane}
			</div>
		`,
      wrap
    );
    tabDefs.find((t) => t.key === initialKey)?.render();
    return wrap.firstElementChild;
  }
  function renderUploadPane(ctx, pane, body) {
    const tile2 = document.createElement("div");
    tile2.className = "wp-desktop-os-settings__upload-tile";
    tile2.dataset.wallpaperId = CUSTOM_IMAGE_ID;
    tile2.setAttribute(
      "aria-pressed",
      ctx.state.wallpaper === CUSTOM_IMAGE_ID ? "true" : "false"
    );
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.className = "wp-desktop-os-settings__file-input";
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      if (file) {
        void handleImageFile(ctx, file, tile2, body);
      }
      fileInput.value = "";
    });
    render(html`${fileInput}${tile2}`, pane);
    renderUploadTile(ctx, tile2, fileInput, body);
  }
  function renderUploadTile(ctx, tile2, fileInput, body) {
    tile2.classList.remove("wp-desktop-os-settings__upload-tile--filled");
    tile2.classList.remove("wp-desktop-os-settings__upload-tile--dragover");
    tile2.classList.remove("wp-desktop-os-settings__upload-tile--busy");
    tile2.removeAttribute("aria-label");
    const hasImage = !!ctx.state.customImage;
    if (hasImage) {
      tile2.classList.add("wp-desktop-os-settings__upload-tile--filled");
      tile2.setAttribute("aria-label", __("Custom image wallpaper"));
      tile2.style.backgroundImage = `url("${encodeURI(ctx.state.customImage.url)}")`;
    } else {
      tile2.style.backgroundImage = "";
      tile2.setAttribute("aria-label", __("Upload a wallpaper image"));
    }
    const onRemove = (e) => {
      e.stopPropagation();
      ctx.state.customImage = null;
      if (ctx.state.wallpaper === CUSTOM_IMAGE_ID) {
        ctx.state.wallpaper = DEFAULT_WALLPAPER_ID;
      }
      registerCustomImageIfPresent(ctx.state);
      ctx.save();
      ctx.apply();
      renderUploadTile(ctx, tile2, fileInput, body);
      refreshWallpaperPressedState(ctx, body);
    };
    render(
      hasImage ? html`
					<wpd-button
						variant="danger"
						class="wp-desktop-os-settings__upload-remove"
						aria-label=${__("Remove custom image")}
						@click=${onRemove}
						>${__("Remove")}</wpd-button
					>
				` : html`
					<div class="wp-desktop-os-settings__upload-inner">
						<span
							class="wp-desktop-os-settings__upload-plus"
							aria-hidden="true"
							>+</span
						>
						<span class="wp-desktop-os-settings__upload-prompt"
							>${__("Drop an image here, or click to upload")}</span
						>
						<span class="wp-desktop-os-settings__upload-hint"
							>${__(
        "JPEG, PNG, or WebP · goes straight to your Media Library"
      )}</span
						>
					</div>
				`,
      tile2
    );
    tile2.onclick = () => {
      if (tile2.classList.contains("wp-desktop-os-settings__upload-tile--busy")) {
        return;
      }
      if (ctx.state.customImage) {
        selectWallpaper(ctx, CUSTOM_IMAGE_ID, body);
        return;
      }
      fileInput.click();
    };
    tile2.ondragover = (e) => {
      e.preventDefault();
      tile2.classList.add("wp-desktop-os-settings__upload-tile--dragover");
    };
    tile2.ondragleave = () => {
      tile2.classList.remove("wp-desktop-os-settings__upload-tile--dragover");
    };
    tile2.ondrop = (e) => {
      e.preventDefault();
      tile2.classList.remove("wp-desktop-os-settings__upload-tile--dragover");
      const file = e.dataTransfer?.files?.[0];
      if (file) {
        void handleImageFile(ctx, file, tile2, body);
      }
    };
  }
  async function handleImageFile(ctx, file, tile2, body) {
    if (!file.type.startsWith("image/")) {
      showUploadError(tile2, __("That file isn’t an image."));
      return;
    }
    tile2.classList.add("wp-desktop-os-settings__upload-tile--busy");
    render(
      html`<span class="wp-desktop-os-settings__upload-status"
			>${__("Uploading…")}</span
		>`,
      tile2
    );
    const fileInput = tile2.parentElement?.querySelector(
      ".wp-desktop-os-settings__file-input"
    );
    try {
      const media = await uploadImage(ctx.config, file);
      ctx.state.customImage = { id: media.id, url: media.url };
      ctx.state.wallpaper = CUSTOM_IMAGE_ID;
      registerCustomImageIfPresent(ctx.state);
      ctx.save();
      ctx.apply();
      if (fileInput) {
        renderUploadTile(ctx, tile2, fileInput, body);
      }
      refreshWallpaperPressedState(ctx, body);
    } catch (err) {
      tile2.classList.remove("wp-desktop-os-settings__upload-tile--busy");
      if (fileInput) {
        renderUploadTile(ctx, tile2, fileInput, body);
      }
      const message = err instanceof Error ? err.message : __("Upload failed.");
      showUploadError(tile2, message);
    }
  }
  function showUploadError(tile2, message) {
    let err = tile2.querySelector(".wp-desktop-os-settings__upload-error");
    if (!err) {
      err = document.createElement("span");
      err.className = "wp-desktop-os-settings__upload-error";
      err.setAttribute("role", "status");
      tile2.appendChild(err);
    }
    err.textContent = message;
    window.setTimeout(() => {
      err?.remove();
    }, 4e3);
  }
  function renderLibraryPane(ctx, pane, body) {
    const search = document.createElement("input");
    search.type = "search";
    search.placeholder = __("Search your media");
    search.className = "wp-desktop-os-settings__library-search";
    search.setAttribute("aria-label", __("Search media"));
    const grid = document.createElement("div");
    grid.className = "wp-desktop-os-settings__library-grid";
    const meta = document.createElement("span");
    meta.className = "wp-desktop-os-settings__library-meta";
    const loadMore = document.createElement("wpd-button");
    loadMore.setAttribute("variant", "ghost");
    loadMore.textContent = __("Load more");
    let query = "";
    let page = 0;
    let totalPages = 0;
    let loaded = [];
    let hiddenByHd = 0;
    let loading = false;
    const onHdToggle = (e) => {
      ctx.state.libraryHdOnly = e.detail.checked;
      ctx.save();
      resetAndReload();
    };
    render(
      html`
			<div class="wp-desktop-os-settings__library">
				<div class="wp-desktop-os-settings__library-toolbar">
					${search}
					<wpd-checkbox-label
						label=${sprintf(
        // translators: %1$d is the HD minimum width in px, %2$d is the minimum height.
        __("Only HD (≥%1$d×%2$d)"),
        HD_MIN_WIDTH,
        HD_MIN_HEIGHT
      )}
						?checked=${ctx.state.libraryHdOnly}
						@wpd-checkbox-change=${onHdToggle}
					></wpd-checkbox-label>
				</div>
				${grid}
				<div class="wp-desktop-os-settings__library-footer">
					${meta}${loadMore}
				</div>
			</div>
		`,
      pane
    );
    const updateMeta = () => {
      const visible = visibleLibraryItems(ctx.state, loaded).length;
      const parts = [
        // translators: %d is the number of media items currently visible.
        sprintf(__("Showing %d"), visible)
      ];
      if (ctx.state.libraryHdOnly && hiddenByHd > 0) {
        parts.push(
          // translators: %d is the number of images filtered out by the HD toggle.
          sprintf(__("%d hidden by HD filter"), hiddenByHd)
        );
      }
      meta.textContent = parts.join(" · ");
      loadMore.hidden = page >= totalPages;
      if (loading) {
        loadMore.setAttribute("disabled", "");
      } else {
        loadMore.removeAttribute("disabled");
      }
    };
    const renderGrid = () => {
      const visible = visibleLibraryItems(ctx.state, loaded);
      hiddenByHd = loaded.length - visible.length;
      if (visible.length === 0 && !loading) {
        render(
          html`<p class="wp-desktop-os-settings__library-empty">
					${ctx.state.libraryHdOnly ? __(
            "No HD images found. Try unchecking the filter, or upload a larger image."
          ) : __("No images in your Media Library yet.")}
				</p>`,
          grid
        );
      } else {
        grid.innerHTML = "";
        for (const item of visible) {
          grid.appendChild(buildLibraryTile(ctx, item, body));
        }
      }
      updateMeta();
    };
    const loadNextPage = async () => {
      if (loading || totalPages > 0 && page >= totalPages) {
        return;
      }
      loading = true;
      updateMeta();
      if (page === 0) {
        render(
          html`${Array.from(
            { length: 8 },
            () => html`<div
						class="wp-desktop-os-settings__library-tile wp-desktop-os-settings__library-tile--skeleton"
					></div>`
          )}`,
          grid
        );
      }
      try {
        const result = await fetchMediaPage(
          ctx.config,
          page + 1,
          query,
          ctx.state.libraryHdOnly
        );
        page = page + 1;
        totalPages = result.totalPages;
        loaded = loaded.concat(result.items);
        renderGrid();
      } catch (err) {
        render(
          html`<p class="wp-desktop-os-settings__library-error">
					${err instanceof Error ? sprintf(
            // translators: %s is the browser-supplied error message.
            __("Couldn’t load your media: %s"),
            err.message
          ) : __("Couldn’t load your media.")}
				</p>`,
          grid
        );
      } finally {
        loading = false;
        updateMeta();
      }
    };
    const resetAndReload = () => {
      page = 0;
      totalPages = 0;
      loaded = [];
      hiddenByHd = 0;
      void loadNextPage();
    };
    let searchTimer = null;
    search.addEventListener("input", () => {
      if (searchTimer !== null) {
        window.clearTimeout(searchTimer);
      }
      searchTimer = window.setTimeout(() => {
        searchTimer = null;
        query = search.value.trim();
        resetAndReload();
      }, SEARCH_DEBOUNCE_MS);
    });
    loadMore.addEventListener("click", () => {
      void loadNextPage();
    });
    void loadNextPage();
  }
  function visibleLibraryItems(state, items) {
    if (!state.libraryHdOnly) {
      return items;
    }
    return items.filter(
      (it) => it.media_details.width >= HD_MIN_WIDTH && it.media_details.height >= HD_MIN_HEIGHT
    );
  }
  function buildLibraryTile(ctx, item, body) {
    const isSelected = ctx.state.wallpaper === CUSTOM_IMAGE_ID && ctx.state.customImage?.id === item.id;
    const sizes = item.media_details.sizes || {};
    const thumbUrl = sizes.medium?.source_url || sizes.thumbnail?.source_url || sizes.large?.source_url || item.source_url;
    const altOrTitle = item.alt_text || stripHtml(item.title?.rendered || "") || `Image #${item.id}`;
    const onClick = () => {
      ctx.state.customImage = { id: item.id, url: item.source_url };
      ctx.state.wallpaper = CUSTOM_IMAGE_ID;
      registerCustomImageIfPresent(ctx.state);
      ctx.save();
      ctx.apply();
      refreshWallpaperPressedState(ctx, body);
      const tileGrid = wrapper.firstElementChild?.parentElement;
      if (tileGrid) {
        tileGrid.querySelectorAll("[data-media-id]").forEach((el) => {
          const selected = el.dataset.mediaId === String(item.id);
          el.setAttribute("aria-pressed", selected ? "true" : "false");
          el.classList.toggle(
            "wp-desktop-os-settings__library-tile--selected",
            selected
          );
        });
      }
    };
    const wrapper = document.createElement("div");
    render(
      html`
			<button
				type="button"
				class=${isSelected ? "wp-desktop-os-settings__library-tile wp-desktop-os-settings__library-tile--selected" : "wp-desktop-os-settings__library-tile"}
				data-media-id=${String(item.id)}
				aria-pressed=${isSelected ? "true" : "false"}
				aria-label=${altOrTitle}
				title=${altOrTitle}
				style=${`background-image: url("${encodeURI(thumbUrl)}")`}
				@click=${onClick}
			>
				<span class="wp-desktop-os-settings__library-tile-dims"
					>${item.media_details.width}×${item.media_details.height}</span
				>
			</button>
		`,
      wrapper
    );
    return wrapper.firstElementChild;
  }
  function customGradientCss(state) {
    const { from, to, angle } = state.customGradient;
    return `linear-gradient(${angle}deg, ${from}, ${to})`;
  }
  function registerCustomGradient(ctx) {
    register$1({
      id: CUSTOM_GRADIENT_ID,
      label: __("Custom gradient"),
      type: "css",
      preview: customGradientCss(ctx.state),
      resolveValue: () => customGradientCss(ctx.state),
      renderEditor: (container) => renderCustomGradientEditor(ctx, container)
    });
  }
  function registerCustomImageIfPresent(state) {
    if (!state.customImage) {
      unregister$1(CUSTOM_IMAGE_ID);
      return;
    }
    const safeUrl = encodeURI(state.customImage.url);
    const value = `url("${safeUrl}") center/cover no-repeat, #1d2327`;
    register$1({
      id: CUSTOM_IMAGE_ID,
      label: __("Custom image"),
      type: "css",
      value,
      preview: value
    });
  }
  function selectWallpaper(ctx, id, body) {
    ctx.state.wallpaper = id;
    ctx.save();
    ctx.apply();
    refreshWallpaperPressedState(ctx, body);
  }
  function refreshWallpaperPressedState(ctx, body) {
    body.querySelectorAll("[data-wallpaper-id]").forEach((el) => {
      const selected = el.dataset.wallpaperId === ctx.state.wallpaper;
      if (selected) {
        el.setAttribute("selected", "");
      } else {
        el.removeAttribute("selected");
      }
      el.setAttribute("aria-pressed", selected ? "true" : "false");
    });
  }
  function syncEditorSlot(ctx, slot, inner, def) {
    teardownEditor(ctx);
    inner.innerHTML = "";
    if (!def.renderEditor) {
      slot.dataset.expanded = "false";
      return;
    }
    const editorCtx = {
      id: def.id,
      pluginUrl: "",
      prefersReducedMotion: typeof window.matchMedia === "function" && window.matchMedia("( prefers-reduced-motion: reduce )").matches,
      visible: !document.hidden
    };
    try {
      const result = def.renderEditor(inner, editorCtx);
      if (isPromise(result)) {
        result.then((teardown) => {
          ctx.activeEditorTeardown = teardown;
        });
      } else {
        ctx.activeEditorTeardown = result;
      }
    } catch (err) {
      if (typeof console !== "undefined") {
        console.error(
          `[wp-desktop-mode] Wallpaper "${def.id}" renderEditor threw:`,
          err
        );
      }
    }
    slot.dataset.expanded = "true";
  }
  function teardownEditor(ctx) {
    if (ctx.activeEditorTeardown) {
      try {
        ctx.activeEditorTeardown();
      } catch (err) {
        if (typeof console !== "undefined") {
          console.error(
            "[wp-desktop-mode] Wallpaper editor teardown threw:",
            err
          );
        }
      }
      ctx.activeEditorTeardown = null;
    }
  }
  function renderCustomGradientEditor(ctx, container) {
    container.classList.add("wp-desktop-os-settings__gradient-editor-inner");
    const onFrom = (e) => {
      ctx.state.customGradient.from = e.detail.value;
      onChange();
    };
    const onTo = (e) => {
      ctx.state.customGradient.to = e.detail.value;
      onChange();
    };
    const onAngle = (e) => {
      ctx.state.customGradient.angle = e.detail.value;
      onChange();
    };
    const onChange = () => {
      ctx.save();
      ctx.apply();
      syncGradientPreviewSwatch(ctx, container);
      paint();
    };
    const paint = () => render(
      html`
				<div class="wp-desktop-os-settings__gradient-row">
					<wpd-color-field
						variant="block"
						label=${__("From")}
						value=${ctx.state.customGradient.from}
						@wpd-color-change=${onFrom}
					></wpd-color-field>
					<wpd-color-field
						variant="block"
						label=${__("To")}
						value=${ctx.state.customGradient.to}
						@wpd-color-change=${onTo}
					></wpd-color-field>
				</div>
				<wpd-range-field
					label=${__("Angle")}
					min="0"
					max="360"
					step="1"
					suffix="°"
					value=${String(ctx.state.customGradient.angle)}
					@wpd-range-change=${onAngle}
				></wpd-range-field>
			`,
      container
    );
    paint();
    return () => {
    };
  }
  function syncGradientPreviewSwatch(ctx, editorEl) {
    const section = editorEl.closest("wpd-section");
    const preview = section?.querySelector(
      `[data-wallpaper-id="${CUSTOM_GRADIENT_ID}"]`
    );
    if (preview) {
      preview.style.background = customGradientCss(ctx.state);
    }
  }
  function buildWallpaperSection(ctx, body) {
    const editorSlot = document.createElement("div");
    editorSlot.className = "wp-desktop-os-settings__editor-slot";
    editorSlot.dataset.expanded = "false";
    const editorInner = document.createElement("div");
    editorInner.className = "wp-desktop-os-settings__editor-slot-inner";
    editorSlot.appendChild(editorInner);
    const onPick = (e) => {
      const id = e.detail?.value ?? "";
      const def = get$1(id);
      if (!def || def.id === CUSTOM_IMAGE_ID) {
        return;
      }
      selectWallpaper(ctx, def.id, body);
      syncEditorSlot(ctx, editorSlot, editorInner, def);
      paint();
    };
    const customImageSection = buildCustomImageSection(ctx, body);
    const wrapper = document.createElement("div");
    const paint = () => render(
      html`
				<wpd-section
					heading=${__("Wallpaper")}
					description=${__(
        "The backdrop behind your windows. Pick a preset, mix your own gradient, or drop in an image."
      )}
				>
					<div
						class="wp-desktop-os-settings__grid wp-desktop-os-settings__grid--wallpapers"
						@wpd-pick=${onPick}
					>
						${all$1().filter((def) => def.id !== CUSTOM_IMAGE_ID).map(
        (def) => html`<wpd-swatch
									value=${def.id}
									label=${def.label}
									preview=${def.preview}
									variant="wallpaper"
									data-wallpaper-id=${def.id}
									?selected=${ctx.state.wallpaper === def.id}
								>
									<span class="wp-desktop-os-settings__swatch-label"
										>${def.label}</span
									>
								</wpd-swatch>`
      )}
					</div>
					${editorSlot} ${customImageSection}
				</wpd-section>
			`,
      wrapper
    );
    paint();
    const active2 = get$1(ctx.state.wallpaper);
    if (active2) {
      syncEditorSlot(ctx, editorSlot, editorInner, active2);
    }
    const unsubscribe = subscribe(() => {
      if (!wrapper.isConnected) {
        unsubscribe();
        return;
      }
      paint();
      const now = get$1(ctx.state.wallpaper);
      if (now) {
        syncEditorSlot(ctx, editorSlot, editorInner, now);
      }
    });
    return wrapper;
  }
  class OsSettings {
    constructor(config, layer) {
      this.activeEditorTeardown = null;
      this.config = config;
      this.layer = layer;
      this.state = loadState();
      registerCustomGradient(this);
      registerCustomImageIfPresent(this.state);
    }
    /**
     * Apply the current state: wallpaper via the layer, accent + dock
     * size as CSS custom properties on the shell.
     *
     * Safe to call repeatedly — calls into `layer.apply` dedupe via
     * generation counter; CSS property writes are idempotent.
     */
    apply() {
      const shell = document.getElementById("wp-desktop-shell");
      if (!shell) {
        return;
      }
      const def = get$1(this.state.wallpaper) || get$1(getDefaultWallpaperId()) || get$1(DEFAULT_WALLPAPER_ID) || all$1()[0];
      if (def) {
        this.layer.apply(def);
      }
      const accents = getAccents();
      const accent = accents.find((a) => a.id === this.state.accent) ?? accents[0];
      const dockSize = DOCK_SIZES.find((d) => d.id === this.state.dockSize) ?? DOCK_SIZES[1];
      const root = document.documentElement;
      root.style.setProperty("--wp-admin-theme-color", accent.value);
      root.style.setProperty("--wp-desktop-dock-width", `${dockSize.width}px`);
      root.style.setProperty("--wp-desktop-dock-icon-size", `${dockSize.icon}px`);
    }
    save() {
      saveState(this.state);
    }
    /**
     * Render the settings panel into the given native-window body.
     *
     * Builds three sections (wallpaper, accent, dock size) and wires
     * each to save/apply on change. The panel is a one-shot build per
     * window open — closing and re-opening renders a fresh tree.
     */
    renderPanel(body) {
      teardownEditor(this);
      body.classList.add("wp-desktop-os-settings");
      const onReset = () => {
        const preservedImage = this.state.customImage;
        this.state = { ...DEFAULTS, customImage: preservedImage };
        this.save();
        this.apply();
        this.renderPanel(body);
      };
      render(
        html`
				<p class="wp-desktop-os-settings__intro">
					${__(
          "Personalize your desktop. Changes apply instantly and are saved to this browser."
        )}
				</p>
				<wpd-tabs value="appearance" label=${__("Settings sections")}>
					<wpd-tab value="appearance"
						>${__("Appearance")}</wpd-tab
					>
					<wpd-tab value="ai">${__("AI Settings")}</wpd-tab>
					${this.config.isAdmin ? html`<wpd-tab value="extended">${__("Extended Options")}</wpd-tab>` : html``}
				</wpd-tabs>
				<wpd-tabpanel for="appearance">
					${buildWallpaperSection(this, body)}
					${buildAccentSection(this)}
					${buildDockSizeSection(this)}
				</wpd-tabpanel>
				<wpd-tabpanel for="ai">
					${buildAiSection(this)}
				</wpd-tabpanel>
				${this.config.isAdmin ? html`<wpd-tabpanel for="extended">
							${buildExtendedSection(this)}
						</wpd-tabpanel>` : html``}
				<div class="wp-desktop-os-settings__footer">
					<wpd-button variant="ghost" @click=${onReset}
						>${__("Reset to defaults")}</wpd-button
					>
				</div>
			`,
        body
      );
    }
  }
  const pending = /* @__PURE__ */ new Map();
  function loadVendorScript(url) {
    const existing = pending.get(url);
    if (existing) {
      return existing;
    }
    const promise = new Promise((resolve, reject) => {
      const selector = `script[data-wp-desktop-vendor="${cssEscape(url)}"]`;
      const preexisting = document.querySelector(selector);
      if (preexisting) {
        if (preexisting.dataset.loaded === "1") {
          resolve();
          return;
        }
        preexisting.addEventListener("load", () => resolve(), { once: true });
        preexisting.addEventListener(
          "error",
          () => reject(new Error(`Failed to load ${url}`)),
          { once: true }
        );
        return;
      }
      const script = document.createElement("script");
      script.src = url;
      script.async = true;
      script.dataset.wpDesktopVendor = url;
      script.addEventListener(
        "load",
        () => {
          script.dataset.loaded = "1";
          resolve();
        },
        { once: true }
      );
      script.addEventListener(
        "error",
        () => {
          pending.delete(url);
          script.remove();
          reject(new Error(`Failed to load ${url}`));
        },
        { once: true }
      );
      document.head.appendChild(script);
    });
    pending.set(url, promise);
    return promise;
  }
  function cssEscape(value) {
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
      return CSS.escape(value);
    }
    return value.replace(/["\\]/g, "\\$&");
  }
  const registry$1 = /* @__PURE__ */ new Map();
  function registerModule(def) {
    if (!def || typeof def.id !== "string" || def.id === "") {
      if (typeof console !== "undefined") {
        console.warn("[wp-desktop-mode] Ignored invalid module registration:", def);
      }
      return;
    }
    if (typeof def.url !== "string" || def.url === "") {
      if (typeof console !== "undefined") {
        console.warn(
          `[wp-desktop-mode] Module "${def.id}" has no url; ignored.`
        );
      }
      return;
    }
    registry$1.set(def.id, def);
  }
  function moduleIds() {
    return Array.from(registry$1.keys());
  }
  async function loadModules(ids) {
    if (!ids || ids.length === 0) {
      return;
    }
    const unknown = ids.filter((id) => !registry$1.has(id));
    if (unknown.length > 0) {
      throw new Error(
        `[wp-desktop-mode] Unknown module(s) in needs: ${unknown.map((id) => `"${id}"`).join(", ")}. Known modules: ${moduleIds().join(", ") || "(none)"}.`
      );
    }
    await Promise.all(
      ids.map((id) => {
        const def = registry$1.get(id);
        if (!def) {
          return Promise.resolve();
        }
        if (def.isReady && def.isReady()) {
          return Promise.resolve();
        }
        return loadVendorScript(def.url);
      })
    );
  }
  function createContext(id, pluginUrl) {
    return {
      id,
      pluginUrl,
      prefersReducedMotion: prefersReducedMotion(),
      visible: !document.hidden
    };
  }
  function prefersReducedMotion() {
    if (typeof window.matchMedia !== "function") {
      return false;
    }
    return window.matchMedia("( prefers-reduced-motion: reduce )").matches;
  }
  class WallpaperLayer {
    constructor(element, pluginUrl) {
      this.generation = 0;
      this.active = null;
      this.boundVisibilityChange = () => {
        if (!this.active) {
          return;
        }
        doAction(HOOKS.WALLPAPER_VISIBILITY, {
          id: this.active.id,
          state: document.hidden ? "hidden" : "visible"
        });
      };
      this.element = element;
      this.pluginUrl = pluginUrl;
      document.addEventListener("visibilitychange", this.boundVisibilityChange);
    }
    /**
     * Apply a wallpaper definition. Safe to call from any event
     * handler — handles type dispatch, teardown of the prior active
     * canvas, and race-safe async mounts.
     */
    apply(def) {
      const gen = ++this.generation;
      this.teardownActive();
      if (def.type === "css") {
        this.applyCss(def);
        return;
      }
      this.applyCanvas(def, gen);
    }
    /**
     * Imperative teardown entry point — called from desktop.ts on
     * `pagehide` so a canvas wallpaper's ticker doesn't compete with
     * the session-beacon flush at unload.
     */
    teardownActive() {
      if (!this.active) {
        return;
      }
      const { id, teardown } = this.active;
      this.active = null;
      doAction(HOOKS.WALLPAPER_UNMOUNTING, { id });
      try {
        teardown();
      } catch (err) {
        doAction(HOOKS.SHELL_ERROR, { scope: "wallpaper-teardown", id, error: err });
        if (typeof console !== "undefined") {
          console.error(
            `[wp-desktop-mode] Wallpaper "${id}" teardown threw:`,
            err
          );
        }
      }
      this.element.innerHTML = "";
    }
    /** Remove listeners. Not called in normal flow — reserved for tests. */
    dispose() {
      this.teardownActive();
      document.removeEventListener("visibilitychange", this.boundVisibilityChange);
    }
    applyCss(def) {
      const value = def.resolveValue ? def.resolveValue(createContext(def.id, this.pluginUrl)) : def.value;
      if (typeof value === "string") {
        this.element.style.setProperty("--wp-desktop-bg", value);
        const shell = document.getElementById("wp-desktop-shell");
        shell?.style.setProperty("--wp-desktop-bg", value);
      }
    }
    applyCanvas(def, gen) {
      const ctx = createContext(def.id, this.pluginUrl);
      doAction(HOOKS.WALLPAPER_MOUNTING, { id: def.id, container: this.element, ctx });
      const depsReady = def.needs && def.needs.length > 0 ? loadModules(def.needs) : Promise.resolve();
      const onResolve = (teardown) => {
        if (gen !== this.generation) {
          try {
            teardown();
          } catch {
          }
          return;
        }
        this.active = { id: def.id, teardown };
        doAction(HOOKS.WALLPAPER_MOUNTED, { id: def.id, container: this.element, ctx });
      };
      depsReady.then(
        () => {
          if (gen !== this.generation) {
            return;
          }
          let result;
          try {
            result = def.mount(this.element, ctx);
          } catch (err) {
            this.handleMountFailure(def.id, err);
            return;
          }
          if (isThenable$1(result)) {
            result.then(onResolve, (err) => {
              if (gen !== this.generation) {
                return;
              }
              this.handleMountFailure(def.id, err);
            });
            return;
          }
          onResolve(result);
        },
        (err) => {
          if (gen !== this.generation) {
            return;
          }
          this.handleMountFailure(def.id, err);
        }
      );
    }
    handleMountFailure(id, err) {
      this.element.innerHTML = "";
      doAction(HOOKS.WALLPAPER_MOUNT_FAILED, { id, error: err });
      doAction(HOOKS.SHELL_ERROR, { scope: "wallpaper-mount", id, error: err });
      if (typeof console !== "undefined") {
        console.error(
          `[wp-desktop-mode] Wallpaper "${id}" failed to mount:`,
          err
        );
      }
    }
  }
  function isThenable$1(value) {
    return !!value && typeof value === "object" && typeof value.then === "function";
  }
  function createWallpaperRegistrySync(deps) {
    const { osSettings } = deps;
    const registered = /* @__PURE__ */ new Set();
    const loadedScripts = /* @__PURE__ */ new Set();
    const ensureScript = async (entry) => {
      if (!entry.scriptUrl || loadedScripts.has(entry.scriptUrl)) {
        return;
      }
      try {
        await loadVendorScript(entry.scriptUrl);
      } catch (err) {
        doAction(HOOKS.SHELL_ERROR, {
          scope: "wallpaper-script-load",
          id: entry.id,
          error: err
        });
      }
      loadedScripts.add(entry.scriptUrl);
    };
    const readDef = (id) => {
      const globals = window.wpDesktopWallpapers || {};
      return globals[id] ?? null;
    };
    const defFromCssEntry = (entry) => {
      if (entry.type !== "css" || entry.value === "") {
        return null;
      }
      return {
        id: entry.id,
        label: entry.label,
        type: "css",
        value: entry.value,
        preview: entry.preview !== "" ? entry.preview : entry.value
      };
    };
    const registerEntry = async (entry) => {
      if (registered.has(entry.id)) {
        return;
      }
      const cssDef = defFromCssEntry(entry);
      if (cssDef) {
        register$1(cssDef);
        registered.add(entry.id);
        osSettings.apply();
        return;
      }
      await ensureScript(entry);
      const def = readDef(entry.id);
      if (!def) {
        doAction(HOOKS.SHELL_ERROR, {
          scope: "wallpaper-missing-def",
          id: entry.id,
          error: new Error(
            `[wp-desktop-mode] No wallpaper def on window.wpDesktopWallpapers["${entry.id}"]. Script loaded but didn't publish a def — check the plugin's enqueue + global assignment.`
          )
        });
        return;
      }
      register$1(def);
      registered.add(entry.id);
      osSettings.apply();
    };
    const unregisterEntry = (id) => {
      if (!registered.has(id)) {
        return;
      }
      unregister$1(id);
      registered.delete(id);
      osSettings.apply();
    };
    return async (list) => {
      const incoming = /* @__PURE__ */ new Set();
      for (const entry of list) {
        incoming.add(entry.id);
      }
      for (const id of Array.from(registered)) {
        if (!incoming.has(id)) {
          unregisterEntry(id);
        }
      }
      for (const entry of list) {
        if (!registered.has(entry.id)) {
          await registerEntry(entry);
        }
      }
    };
  }
  const registry = /* @__PURE__ */ new Map();
  const listeners$1 = /* @__PURE__ */ new Set();
  function registerCommand(cmd) {
    if (!cmd || typeof cmd.slug !== "string" || cmd.slug.trim() === "") {
      return;
    }
    if (typeof cmd.label !== "string" || cmd.label.trim() === "") {
      return;
    }
    if (typeof cmd.run !== "function") {
      return;
    }
    const slug = cmd.slug.trim().toLowerCase();
    if (!/^[a-z0-9_\-]+$/.test(slug)) {
      if (typeof console !== "undefined") {
        console.warn(
          "[wp-desktop-mode] registerCommand: slug must be [a-z0-9_-]+, got",
          cmd.slug
        );
      }
      return;
    }
    registry.set(slug, { ...cmd, slug });
    notify$1();
  }
  function unregisterCommand(slug) {
    if (registry.delete(slug.toLowerCase())) {
      notify$1();
    }
  }
  function listCommands() {
    return Array.from(registry.values());
  }
  function findCommand(slug) {
    return registry.get(slug.toLowerCase()) ?? null;
  }
  function filterCommands(query) {
    const q = query.trim().toLowerCase();
    if (q === "") {
      return listCommands();
    }
    return listCommands().filter(
      (c) => c.slug.toLowerCase().startsWith(q) || c.label.toLowerCase().includes(q)
    );
  }
  function subscribeCommands(cb) {
    listeners$1.add(cb);
    return () => {
      listeners$1.delete(cb);
    };
  }
  function notify$1() {
    const snapshot = Array.from(listeners$1);
    for (const cb of snapshot) {
      try {
        cb();
      } catch (err) {
        if (typeof console !== "undefined") {
          console.error("[wp-desktop-mode] command-registry listener threw:", err);
        }
      }
    }
  }
  function parseCommandInput(input) {
    if (!input.startsWith("/")) {
      return { isCommand: false, slug: "", args: "", hasArgsPart: false };
    }
    const rest = input.slice(1);
    const spaceIdx = rest.indexOf(" ");
    if (spaceIdx === -1) {
      return { isCommand: true, slug: rest, args: "", hasArgsPart: false };
    }
    return {
      isCommand: true,
      slug: rest.slice(0, spaceIdx),
      args: rest.slice(spaceIdx + 1),
      hasArgsPart: true
    };
  }
  function createCommandRegistrySync() {
    const loadedHandles = /* @__PURE__ */ new Set();
    const loadedUrls = /* @__PURE__ */ new Set();
    let prevSlugsByHandle = /* @__PURE__ */ new Map();
    const ensureScript = async (entry) => {
      if (!entry.scriptUrl || loadedUrls.has(entry.scriptUrl)) {
        loadedHandles.add(entry.handle);
        return;
      }
      try {
        await loadVendorScript(entry.scriptUrl);
      } catch (err) {
        doAction(HOOKS.SHELL_ERROR, {
          scope: "command-script-load",
          handle: entry.handle,
          url: entry.scriptUrl,
          error: err
        });
        return;
      }
      loadedUrls.add(entry.scriptUrl);
      loadedHandles.add(entry.handle);
    };
    const slugsByHandleFrom = (commands) => {
      const map = /* @__PURE__ */ new Map();
      if (!commands) {
        return map;
      }
      for (const entry of commands) {
        if (!entry.scriptHandle || !entry.slug) {
          continue;
        }
        let set = map.get(entry.scriptHandle);
        if (!set) {
          set = /* @__PURE__ */ new Set();
          map.set(entry.scriptHandle, set);
        }
        set.add(entry.slug);
      }
      return map;
    };
    const collectSlugsToRemove = (handle) => {
      const slugs = /* @__PURE__ */ new Set();
      for (const cmd of listCommands()) {
        if (cmd.owner === handle) {
          slugs.add(cmd.slug);
        }
      }
      const declared = prevSlugsByHandle.get(handle);
      if (declared) {
        for (const slug of declared) {
          slugs.add(slug);
        }
      }
      return slugs;
    };
    return async (scripts, commands) => {
      const incomingHandles = /* @__PURE__ */ new Set();
      for (const entry of scripts) {
        if (entry.handle) {
          incomingHandles.add(entry.handle);
        }
      }
      for (const handle of Array.from(loadedHandles)) {
        if (incomingHandles.has(handle)) {
          continue;
        }
        for (const slug of collectSlugsToRemove(handle)) {
          unregisterCommand(slug);
        }
        loadedHandles.delete(handle);
      }
      for (const entry of scripts) {
        if (!entry.handle || loadedHandles.has(entry.handle)) {
          continue;
        }
        await ensureScript(entry);
      }
      prevSlugsByHandle = slugsByHandleFrom(commands);
    };
  }
  function collectWallpaperSurfaces(manager) {
    const seed2 = [];
    for (const w of manager.getVisibleRects()) {
      if (w.state === "minimized") {
        continue;
      }
      if (w.element.offsetParent === null) {
        continue;
      }
      const r = w.element.getBoundingClientRect();
      seed2.push({
        id: `window:${w.windowId}`,
        kind: "window",
        rect: rectFromDom(r),
        face: "top",
        element: w.element
      });
    }
    const shellEl = document.getElementById("wp-desktop-shell");
    if (shellEl) {
      const r = shellEl.getBoundingClientRect();
      seed2.push({
        id: "shell:floor",
        kind: "shell",
        rect: {
          x: r.left,
          y: r.bottom - 1,
          width: r.width,
          height: 1
        },
        face: "top",
        element: shellEl
      });
    }
    const taskbarEl = document.getElementById("wp-desktop-taskbar");
    if (taskbarEl && !taskbarEl.hidden) {
      const r = taskbarEl.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        seed2.push({
          id: "taskbar:top",
          kind: "taskbar",
          rect: rectFromDom(r),
          face: "top",
          element: taskbarEl
        });
      }
    }
    const dockEl = document.getElementById("wp-desktop-dock");
    if (dockEl) {
      const r = dockEl.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        seed2.push({
          id: "dock:edge",
          kind: "dock",
          rect: {
            x: r.right - 1,
            y: r.top,
            width: 1,
            height: r.height
          },
          face: "right",
          element: dockEl
        });
      }
    }
    const widgetCards = document.querySelectorAll(
      ".wp-desktop-widgets__card"
    );
    let widgetIndex = 0;
    widgetCards.forEach((card) => {
      const r = card.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) {
        return;
      }
      const id = card.dataset.widgetId ?? String(widgetIndex++);
      seed2.push({
        id: `widget:${id}`,
        kind: "widget",
        rect: rectFromDom(r),
        face: "top",
        element: card
      });
    });
    const filtered = applyFilters(HOOKS.WALLPAPER_SURFACES, seed2);
    return Array.isArray(filtered) ? filtered : seed2;
  }
  function rectFromDom(r) {
    return {
      x: r.left,
      y: r.top,
      width: r.width,
      height: r.height
    };
  }
  const seed = [];
  function register(def) {
    const errors = collectRegistrationErrors(def, WIDGET_CHECKS);
    if (errors.length > 0) {
      logRegistrationErrors("Widget", errors, def);
      return;
    }
    const idx = seed.findIndex((w) => w.id === def.id);
    if (idx >= 0) {
      seed[idx] = def;
    } else {
      seed.push(def);
    }
  }
  function unregister(id) {
    const idx = seed.findIndex((w) => w.id === id);
    if (idx >= 0) {
      seed.splice(idx, 1);
    }
  }
  function all() {
    const copy = seed.slice();
    const filtered = applyFilters(HOOKS.WIDGETS, copy);
    if (!Array.isArray(filtered)) {
      if (typeof console !== "undefined") {
        console.warn(
          "[wp-desktop-mode] `wp-desktop.widgets` filter returned a non-array; falling back to seed list."
        );
      }
      return copy;
    }
    return filtered.filter(isValidDef);
  }
  function get(id) {
    return all().find((w) => w.id === id);
  }
  const WIDGET_CHECKS = [
    {
      field: "id",
      message: "missing or not a non-empty string",
      valid: (d) => typeof d.id === "string" && d.id !== ""
    },
    {
      field: "label",
      message: "missing or not a non-empty string",
      valid: (d) => typeof d.label === "string" && d.label !== ""
    },
    {
      field: "description",
      message: "not a string",
      valid: (d) => typeof d.description === "string"
    },
    {
      field: "icon",
      message: "missing or not a non-empty string",
      valid: (d) => typeof d.icon === "string" && d.icon !== ""
    },
    {
      field: "mount",
      message: "not a function",
      valid: (d) => typeof d.mount === "function"
    }
  ];
  function isValidDef(def) {
    return collectRegistrationErrors(def, WIDGET_CHECKS).length === 0;
  }
  let active = null;
  function openWidgetPicker(options) {
    if (active) {
      return;
    }
    const panel = document.createElement("div");
    panel.className = "wp-desktop-widget-picker";
    panel.setAttribute("role", "menu");
    panel.setAttribute("aria-label", __("Add widget"));
    const title = document.createElement("div");
    title.className = "wp-desktop-widget-picker__title";
    title.textContent = __("Add widget");
    panel.appendChild(title);
    const list = document.createElement("div");
    list.className = "wp-desktop-widget-picker__list";
    panel.appendChild(list);
    paintList(list, options);
    document.body.appendChild(panel);
    positionPanel(panel, options.anchor);
    const onOutsidePointerDown = (e) => {
      const target = e.target;
      if (!target) {
        return;
      }
      if (panel.contains(target) || options.anchor.contains(target)) {
        return;
      }
      closeWidgetPicker();
    };
    window.setTimeout(() => {
      document.addEventListener("pointerdown", onOutsidePointerDown, true);
    }, 0);
    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        closeWidgetPicker();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    active = { panel, options, onOutsidePointerDown, onKeyDown };
    const first = list.querySelector(
      "button:not([disabled])"
    );
    first?.focus();
  }
  function refreshWidgetPicker() {
    if (!active) {
      return;
    }
    const list = active.panel.querySelector(
      ".wp-desktop-widget-picker__list"
    );
    if (list) {
      paintList(list, active.options);
    }
  }
  function closeWidgetPicker() {
    if (!active) {
      return;
    }
    document.removeEventListener(
      "pointerdown",
      active.onOutsidePointerDown,
      true
    );
    document.removeEventListener("keydown", active.onKeyDown);
    active.panel.remove();
    active = null;
  }
  function paintList(list, options) {
    list.innerHTML = "";
    const enabled = new Set(options.enabledIds());
    const defs = options.registry();
    if (defs.length === 0) {
      const empty = document.createElement("div");
      empty.className = "wp-desktop-widget-picker__empty";
      empty.textContent = __(
        "No widgets available. Activate a plugin that registers one, or see the docs for the registerWidget API."
      );
      list.appendChild(empty);
      return;
    }
    for (const def of defs) {
      const entry = document.createElement("button");
      entry.type = "button";
      entry.className = "wp-desktop-widget-picker__entry";
      const isAdded = enabled.has(def.id);
      if (isAdded) {
        entry.classList.add(
          "wp-desktop-widget-picker__entry--added"
        );
        entry.disabled = true;
        entry.setAttribute("aria-disabled", "true");
      }
      entry.setAttribute("role", "menuitem");
      let ariaLabel;
      if (isAdded) {
        ariaLabel = sprintf(__("%s (already added)"), def.label);
      } else {
        ariaLabel = sprintf(__("Add %s"), def.label);
      }
      entry.setAttribute("aria-label", ariaLabel);
      const icon = document.createElement("span");
      icon.className = `wp-desktop-widget-picker__entry-icon dashicons ${def.icon}`;
      icon.setAttribute("aria-hidden", "true");
      entry.appendChild(icon);
      const textWrap = document.createElement("span");
      textWrap.className = "wp-desktop-widget-picker__entry-text";
      const label = document.createElement("span");
      label.className = "wp-desktop-widget-picker__entry-label";
      label.textContent = def.label;
      textWrap.appendChild(label);
      if (def.description) {
        const desc = document.createElement("span");
        desc.className = "wp-desktop-widget-picker__entry-description";
        desc.textContent = def.description;
        textWrap.appendChild(desc);
      }
      entry.appendChild(textWrap);
      if (isAdded) {
        const status = document.createElement("span");
        status.className = "wp-desktop-widget-picker__entry-status";
        status.textContent = __("Added");
        entry.appendChild(status);
      }
      if (!isAdded) {
        entry.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          options.onAdd(def.id);
        });
      }
      list.appendChild(entry);
    }
  }
  function positionPanel(panel, anchor) {
    const rect = anchor.getBoundingClientRect();
    panel.style.position = "fixed";
    panel.style.left = "0px";
    panel.style.top = "0px";
    panel.style.visibility = "hidden";
    const panelRect = panel.getBoundingClientRect();
    const width = panelRect.width || 320;
    const height = panelRect.height || 200;
    const gap = 6;
    let left = rect.right - width;
    let top = rect.top - height - gap;
    if (left < 8) {
      left = 8;
    }
    if (top < 8) {
      top = rect.bottom + gap;
    }
    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;
    panel.style.visibility = "";
  }
  const FLOATING_CLASS = "wp-desktop-widgets__card--floating";
  const MOVABLE_CLASS = "wp-desktop-widgets__card--movable";
  const RESIZABLE_CLASS = "wp-desktop-widgets__card--resizable";
  const DRAGGING_CLASS = "wp-desktop-widgets__card--dragging";
  const RESIZING_CLASS = "wp-desktop-widgets__card--resizing";
  const DEFAULT_MIN_WIDTH = 160;
  const DEFAULT_MIN_HEIGHT = 80;
  const DEFAULT_WIDTH = 280;
  const DEFAULT_HEIGHT = 180;
  const VIEWPORT_MARGIN = 20;
  const DRAG_THRESHOLD_PX = 5;
  const DRAG_THRESHOLD_SQUARED = DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX;
  const DRAG_EXCLUDED_SELECTORS = 'input, textarea, select, button, a, [contenteditable="true"]';
  function buildFrame(def, ctx, handlers) {
    const card = document.createElement("div");
    card.className = "wp-desktop-widgets__card";
    card.dataset.widgetId = def.id;
    const movable = def.movable === true;
    const resizable = def.resizable === true;
    if (movable) {
      card.classList.add(MOVABLE_CLASS);
    }
    if (resizable) {
      card.classList.add(RESIZABLE_CLASS);
    }
    if (movable) {
      card.appendChild(buildChrome(def, handlers.onRemove, handlers.onRedock));
    } else {
      card.appendChild(buildCornerClose(def, handlers.onRemove));
    }
    const body = document.createElement("div");
    body.className = "wp-desktop-widgets__card-body";
    card.appendChild(body);
    let isFloating = false;
    if (ctx.geometry) {
      applyGeometry(card, ctx.geometry);
      card.classList.add(FLOATING_CLASS);
      isFloating = true;
    }
    const resizeCleanups = [];
    if (resizable) {
      for (const dir of allHandleDirs()) {
        const handle = document.createElement("div");
        handle.className = `wp-desktop-widgets__resize wp-desktop-widgets__resize--${dir}`;
        handle.setAttribute("aria-hidden", "true");
        handle.dataset.dir = dir;
        card.appendChild(handle);
        resizeCleanups.push(
          attachResize(card, handle, dir, def, ctx, handlers, () => isFloating)
        );
      }
    }
    let dragCleanup = null;
    if (movable) {
      const chrome = card.querySelector(
        ".wp-desktop-widgets__chrome"
      );
      if (chrome) {
        dragCleanup = attachDrag(card, chrome, def, ctx, handlers, (next) => {
          isFloating = next;
        });
      }
    }
    return {
      card,
      body,
      dispose: () => {
        for (const fn of resizeCleanups) {
          try {
            fn();
          } catch {
          }
        }
        if (dragCleanup) {
          try {
            dragCleanup();
          } catch {
          }
        }
        card.remove();
      }
    };
  }
  function buildChrome(def, onRemove, onRedock) {
    const chrome = document.createElement("header");
    chrome.className = "wp-desktop-widgets__chrome";
    const grip = document.createElement("span");
    grip.className = "wp-desktop-widgets__grip";
    grip.setAttribute("aria-hidden", "true");
    chrome.appendChild(grip);
    const title = document.createElement("span");
    title.className = "wp-desktop-widgets__title";
    title.textContent = def.label;
    chrome.appendChild(title);
    chrome.appendChild(buildRedockButton(def, onRedock));
    const close = buildCloseButton(def, onRemove);
    chrome.appendChild(close);
    return chrome;
  }
  function buildRedockButton(def, onRedock) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "wp-desktop-widgets__card-redock";
    btn.setAttribute(
      "aria-label",
      // translators: %s is the widget label (e.g., "Clock")
      sprintf(__("Dock %s back to widget column"), def.label)
    );
    btn.innerHTML = '<svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M2 6h6M5.5 3.5L8 6l-2.5 2.5M10 2.5v7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>';
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onRedock();
    });
    btn.dataset.noDrag = "true";
    return btn;
  }
  function buildCornerClose(def, onRemove) {
    const close = buildCloseButton(def, onRemove);
    close.classList.add("wp-desktop-widgets__card-close--corner");
    return close;
  }
  function buildCloseButton(def, onRemove) {
    const close = document.createElement("button");
    close.type = "button";
    close.className = "wp-desktop-widgets__card-close";
    close.setAttribute("aria-label", sprintf(__("Remove %s"), def.label));
    close.innerHTML = '<svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
    close.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onRemove();
    });
    return close;
  }
  function attachDrag(card, chrome, def, ctx, handlers, setFloating) {
    let pointerId = null;
    let startX = 0;
    let startY = 0;
    let initialLeft = 0;
    let initialTop = 0;
    let committed = false;
    const onDown = (e) => {
      if (e.button !== 0) {
        return;
      }
      const target = e.target;
      if (target && target.closest(DRAG_EXCLUDED_SELECTORS)) {
        return;
      }
      e.preventDefault();
      pointerId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      committed = false;
      initialLeft = parseFloat(card.style.left) || 0;
      initialTop = parseFloat(card.style.top) || 0;
      chrome.setPointerCapture(pointerId);
    };
    const commitDrag = () => {
      if (!card.classList.contains(FLOATING_CLASS)) {
        const parentRect = ctx.floatingParent.getBoundingClientRect();
        const rect = card.getBoundingClientRect();
        const initial = {
          x: rect.left - parentRect.left,
          y: rect.top - parentRect.top,
          width: def.defaultWidth ?? (rect.width || DEFAULT_WIDTH),
          height: def.defaultHeight ?? (rect.height || DEFAULT_HEIGHT)
        };
        applyGeometry(card, initial);
        card.classList.add(FLOATING_CLASS);
        setFloating(true);
        handlers.onLiberate(initial);
        initialLeft = parseFloat(card.style.left) || 0;
        initialTop = parseFloat(card.style.top) || 0;
      }
      card.classList.add(DRAGGING_CLASS);
    };
    const onMove = (e) => {
      if (pointerId === null || e.pointerId !== pointerId) {
        return;
      }
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!committed) {
        if (dx * dx + dy * dy < DRAG_THRESHOLD_SQUARED) {
          return;
        }
        committed = true;
        commitDrag();
      }
      const clamped = clampToParent(
        initialLeft + dx,
        initialTop + dy,
        card.offsetWidth,
        card.offsetHeight,
        ctx.floatingParent
      );
      card.style.left = `${clamped.x}px`;
      card.style.top = `${clamped.y}px`;
    };
    const onUp = (e) => {
      if (pointerId === null || e.pointerId !== pointerId) {
        return;
      }
      try {
        chrome.releasePointerCapture(pointerId);
      } catch {
      }
      pointerId = null;
      if (!committed) {
        return;
      }
      committed = false;
      card.classList.remove(DRAGGING_CLASS);
      handlers.onGeometryChanged(currentGeometry(card));
    };
    chrome.addEventListener("pointerdown", onDown);
    chrome.addEventListener("pointermove", onMove);
    chrome.addEventListener("pointerup", onUp);
    chrome.addEventListener("pointercancel", onUp);
    return () => {
      chrome.removeEventListener("pointerdown", onDown);
      chrome.removeEventListener("pointermove", onMove);
      chrome.removeEventListener("pointerup", onUp);
      chrome.removeEventListener("pointercancel", onUp);
    };
  }
  function attachResize(card, handle, dir, def, ctx, handlers, isFloating) {
    let pointerId = null;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    let startW = 0;
    let startH = 0;
    const onDown = (e) => {
      if (e.button !== 0) {
        return;
      }
      if (!isFloating() && !isHeightOnlyDir(dir)) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      pointerId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      const rect = card.getBoundingClientRect();
      const parentRect = ctx.floatingParent.getBoundingClientRect();
      startLeft = rect.left - parentRect.left;
      startTop = rect.top - parentRect.top;
      startW = rect.width;
      startH = rect.height;
      handle.setPointerCapture(pointerId);
      card.classList.add(RESIZING_CLASS);
    };
    const onMove = (e) => {
      if (pointerId === null || e.pointerId !== pointerId) {
        return;
      }
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const next = computeResize(
        dir,
        dx,
        dy,
        startLeft,
        startTop,
        startW,
        startH,
        def,
        ctx.floatingParent,
        isFloating()
      );
      if (isFloating()) {
        card.style.left = `${next.x}px`;
        card.style.top = `${next.y}px`;
        card.style.width = `${next.width}px`;
      }
      card.style.height = `${next.height}px`;
    };
    const onUp = (e) => {
      if (pointerId === null || e.pointerId !== pointerId) {
        return;
      }
      try {
        handle.releasePointerCapture(pointerId);
      } catch {
      }
      pointerId = null;
      card.classList.remove(RESIZING_CLASS);
      handlers.onGeometryChanged(currentGeometry(card));
    };
    handle.addEventListener("pointerdown", onDown);
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
    return () => {
      handle.removeEventListener("pointerdown", onDown);
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
    };
  }
  function allHandleDirs() {
    return ["n", "e", "s", "w", "ne", "nw", "se", "sw"];
  }
  function isHeightOnlyDir(dir) {
    return dir === "s";
  }
  function applyGeometry(card, geometry) {
    card.style.left = `${geometry.x}px`;
    card.style.top = `${geometry.y}px`;
    card.style.width = `${geometry.width}px`;
    card.style.height = `${geometry.height}px`;
  }
  function currentGeometry(card) {
    return {
      x: parseFloat(card.style.left) || 0,
      y: parseFloat(card.style.top) || 0,
      width: card.offsetWidth,
      height: card.offsetHeight
    };
  }
  function clampToParent(x, y, width, height, parent) {
    const parentWidth = parent.clientWidth || parent.getBoundingClientRect().width;
    const parentHeight = parent.clientHeight || parent.getBoundingClientRect().height;
    const maxX = Math.max(0, parentWidth - width - VIEWPORT_MARGIN);
    const maxY = Math.max(0, parentHeight - height - VIEWPORT_MARGIN);
    return {
      x: Math.min(Math.max(VIEWPORT_MARGIN, x), maxX),
      y: Math.min(Math.max(VIEWPORT_MARGIN, y), maxY)
    };
  }
  function computeResize(dir, dx, dy, startLeft, startTop, startW, startH, def, parent, floating) {
    const minW = def.minWidth ?? DEFAULT_MIN_WIDTH;
    const minH = def.minHeight ?? DEFAULT_MIN_HEIGHT;
    const maxW = def.maxWidth ?? Infinity;
    const maxH = def.maxHeight ?? Infinity;
    const parentWidth = parent.clientWidth || parent.getBoundingClientRect().width;
    const parentHeight = parent.clientHeight || parent.getBoundingClientRect().height;
    let x = startLeft;
    let y = startTop;
    let width = startW;
    let height = startH;
    if (dir === "e" || dir === "ne" || dir === "se") {
      width = clamp(startW + dx, minW, Math.min(maxW, parentWidth - startLeft));
    }
    if (dir === "w" || dir === "nw" || dir === "sw") {
      const nextWidth = clamp(startW - dx, minW, Math.min(maxW, startLeft + startW));
      x = startLeft + (startW - nextWidth);
      width = nextWidth;
    }
    if (dir === "s" || dir === "se" || dir === "sw") {
      height = clamp(
        startH + dy,
        minH,
        Math.min(maxH, parentHeight - startTop)
      );
    }
    if (dir === "n" || dir === "ne" || dir === "nw") {
      const nextHeight = clamp(startH - dy, minH, Math.min(maxH, startTop + startH));
      y = startTop + (startH - nextHeight);
      height = nextHeight;
    }
    if (!floating) {
      width = startW;
      x = startLeft;
    }
    return { x, y, width, height };
  }
  function clamp(value, min, max) {
    if (max < min) {
      return min;
    }
    return Math.min(Math.max(value, min), max);
  }
  const IDS_KEY = "wp-desktop-widgets";
  const GEOMETRY_KEY = "wp-desktop-widgets-geometry";
  function readRawEnabled() {
    try {
      return window.localStorage.getItem(IDS_KEY);
    } catch {
      return null;
    }
  }
  function loadEnabledIds() {
    const raw = readRawEnabled();
    if (raw === null) {
      return [];
    }
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed.filter((x) => typeof x === "string");
    } catch {
      return [];
    }
  }
  function saveEnabledIds(ids) {
    try {
      window.localStorage.setItem(IDS_KEY, JSON.stringify(ids));
    } catch {
    }
  }
  function loadGeometry() {
    try {
      const raw = window.localStorage.getItem(GEOMETRY_KEY);
      if (!raw) {
        return {};
      }
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") {
        return {};
      }
      const out = {};
      for (const [id, rawEntry] of Object.entries(parsed)) {
        const entry = sanitizeGeometry(rawEntry);
        if (entry) {
          out[id] = entry;
        }
      }
      return out;
    } catch {
      return {};
    }
  }
  function saveGeometry(geometry) {
    try {
      window.localStorage.setItem(GEOMETRY_KEY, JSON.stringify(geometry));
    } catch {
    }
  }
  function sanitizeGeometry(raw) {
    if (!raw || typeof raw !== "object") {
      return null;
    }
    const { x, y, width, height } = raw;
    if (typeof x !== "number" || !Number.isFinite(x) || typeof y !== "number" || !Number.isFinite(y) || typeof width !== "number" || !Number.isFinite(width) || width <= 0 || typeof height !== "number" || !Number.isFinite(height) || height <= 0) {
      return null;
    }
    return { x, y, width, height };
  }
  function createWidgetStorage(widgetId) {
    const prefix = `wp-desktop.widget.${widgetId}.`;
    const safeGet = (key) => {
      try {
        return localStorage.getItem(prefix + key);
      } catch {
        return null;
      }
    };
    return {
      get(key) {
        const raw = safeGet(key);
        if (raw === null) {
          return null;
        }
        try {
          return JSON.parse(raw);
        } catch {
          return null;
        }
      },
      set(key, value) {
        try {
          localStorage.setItem(prefix + key, JSON.stringify(value));
        } catch {
        }
      },
      remove(key) {
        try {
          localStorage.removeItem(prefix + key);
        } catch {
        }
      },
      clear() {
        try {
          for (let i = localStorage.length - 1; i >= 0; i--) {
            const key = localStorage.key(i);
            if (key && key.startsWith(prefix)) {
              localStorage.removeItem(key);
            }
          }
        } catch {
        }
      }
    };
  }
  const DEFAULT_ENABLED_IDS = ["clock"];
  class WidgetLayer {
    /**
     * @param root         The column element (`#wp-desktop-widgets`).
     * @param pluginUrl    Absolute plugin URL — passed to widget ctx.
     * @param floatingHost Parent for liberated (floating) widgets.
     *                     Defaults to the column's parent (the desktop
     *                     area) so floats are bounded by the visible
     *                     desktop, not the 320 px-wide column.
     */
    constructor(root, pluginUrl, floatingHost) {
      this.mounted = /* @__PURE__ */ new Map();
      this.generation = 0;
      this.root = root;
      this.pluginUrl = pluginUrl;
      this.enabledIds = loadEnabledIds();
      this.geometry = loadGeometry();
      this.floatingHost = floatingHost ?? root.parentElement ?? root;
      this.listEl = document.createElement("div");
      this.listEl.className = "wp-desktop-widgets__list";
      this.root.appendChild(this.listEl);
      this.addTile = this.buildAddTile();
      this.root.appendChild(this.addTile);
      this.paintEmptyState();
    }
    /**
     * Mount every widget the user has enabled (per localStorage).
     * Called once during shell boot, AFTER the registry seed has run
     * so built-ins are available. Safe to call multiple times — the
     * `mounted` map dedupes.
     */
    hydrate() {
      if (readRawEnabled() === null) {
        this.enabledIds = DEFAULT_ENABLED_IDS.filter(
          (id) => !!get(id)
        );
        saveEnabledIds(this.enabledIds);
      }
      for (const id of this.enabledIds) {
        if (this.mounted.has(id)) {
          continue;
        }
        this.mountById(id);
      }
      this.paintEmptyState();
    }
    /**
     * Add a widget by id — called by the picker after the user
     * selects an available entry. Idempotent.
     */
    add(id) {
      if (this.enabledIds.includes(id)) {
        return;
      }
      if (!get(id)) {
        return;
      }
      this.enabledIds.push(id);
      saveEnabledIds(this.enabledIds);
      this.mountById(id);
      this.paintEmptyState();
      doAction(HOOKS.WIDGET_ADDED, { id });
      refreshWidgetPicker();
    }
    /**
     * Remove a widget by id — called from the card's × button and
     * from the picker. Idempotent.
     */
    remove(id) {
      const before = this.enabledIds.length;
      this.enabledIds = this.enabledIds.filter((e) => e !== id);
      if (this.enabledIds.length === before) {
        return;
      }
      saveEnabledIds(this.enabledIds);
      if (this.geometry[id]) {
        delete this.geometry[id];
        saveGeometry(this.geometry);
      }
      this.unmountById(id);
      this.paintEmptyState();
      doAction(HOOKS.WIDGET_REMOVED, { id });
      refreshWidgetPicker();
    }
    /** Public read for the picker / external callers. */
    getEnabledIds() {
      return [...this.enabledIds];
    }
    /**
     * Mount a widget ONLY if it's already in the user's enabled
     * list AND not currently mounted. No-op when the widget isn't
     * enabled (user never opted in) and no-op when it's already on
     * screen. Used by the server-driven sync: when a plugin
     * activates mid-session, its widget def registers via the
     * sync's path; if the user had previously enabled that widget
     * (in a prior session or before the plugin was deactivated),
     * we want to bring it back on screen without toggling the
     * "enabled" state or firing a `WIDGET_ADDED` action.
     *
     * The net behaviour is "rehydrate this one widget now that
     * its def is finally registered," which is subtly different
     * from `ensureMounted` (which OPT-INs the user into enabling
     * the widget for the first time).
     */
    mountIfEnabled(id) {
      if (!get(id)) {
        return;
      }
      if (!this.enabledIds.includes(id)) {
        return;
      }
      if (this.mounted.has(id)) {
        return;
      }
      this.mountById(id);
      this.paintEmptyState();
    }
    /**
     * Unmount a widget without touching the persisted enablement.
     * Used by the server-driven widget-registry sync: when a plugin
     * deactivates mid-session, its widget defs disappear from the
     * registry and we need to pull any mounted instance off the
     * screen — but we deliberately KEEP the id in the user's
     * enabled list so re-activating the plugin re-mounts it
     * automatically through `hydrate()`.
     *
     * Idempotent; a no-op when the widget isn't currently mounted.
     */
    unmount(id) {
      if (!this.mounted.has(id)) {
        return;
      }
      this.unmountById(id);
      this.paintEmptyState();
    }
    /**
     * Guarantee the widget identified by `id` is currently mounted,
     * adding it to the enabled list if it isn't. No-op when the
     * widget is already on screen. Intended for companion plugins
     * that want to pin their widget programmatically — a monitor
     * plugin that auto-pins itself on the first error burst, a
     * first-run onboarding flow that ensures the quick-start widget
     * is present, etc.
     *
     * Returns `true` when the widget is mounted (either newly added
     * or already present), `false` when the id isn't registered —
     * callers can branch on the failure without having to maintain
     * their own registry snapshot.
     */
    ensureMounted(id) {
      if (!get(id)) {
        return false;
      }
      if (this.enabledIds.includes(id)) {
        return true;
      }
      this.add(id);
      return true;
    }
    /**
     * Tear down every widget. Called on shell unload via `pagehide`
     * so intervals / RAF loops stop before the beacon flush.
     */
    disposeAll() {
      for (const id of Array.from(this.mounted.keys())) {
        this.unmountById(id);
      }
    }
    // --- Internal ---------------------------------------------------
    mountById(id) {
      const def = get(id);
      if (!def) {
        return;
      }
      const gen = ++this.generation;
      const initialGeometry = def.movable === true ? this.geometry[id] : void 0;
      const frame = buildFrame(
        def,
        { floatingParent: this.floatingHost, geometry: initialGeometry },
        {
          onRemove: () => this.remove(id),
          onGeometryChanged: (geom) => this.persistGeometry(id, geom),
          onLiberate: (geom) => this.liberate(id, geom),
          onRedock: () => this.redock(id)
        }
      );
      const floating = !!initialGeometry;
      const record = {
        id,
        frame,
        generation: gen,
        teardown: null,
        floating
      };
      this.mounted.set(id, record);
      this.placeCard(frame.card, floating);
      const ctx = {
        id,
        pluginUrl: this.pluginUrl,
        storage: createWidgetStorage(id)
      };
      doAction(HOOKS.WIDGET_MOUNTING, { id, container: frame.body, ctx });
      const onResolve = (teardown) => {
        const current = this.mounted.get(id);
        if (!current || current.generation !== gen) {
          try {
            teardown();
          } catch {
          }
          return;
        }
        current.teardown = teardown;
        doAction(HOOKS.WIDGET_MOUNTED, { id, container: frame.body, ctx });
      };
      let result;
      try {
        result = def.mount(frame.body, ctx);
      } catch (err) {
        this.handleMountFailure(id, err);
        return;
      }
      if (isThenable(result)) {
        result.then(onResolve, (err) => {
          if (this.mounted.get(id)?.generation === gen) {
            this.handleMountFailure(id, err);
          }
        });
        return;
      }
      onResolve(result);
    }
    unmountById(id) {
      const record = this.mounted.get(id);
      if (!record) {
        return;
      }
      doAction(HOOKS.WIDGET_UNMOUNTING, { id });
      try {
        record.teardown?.();
      } catch (err) {
        doAction(HOOKS.SHELL_ERROR, { scope: "widget-teardown", id, error: err });
        if (typeof console !== "undefined") {
          console.error(
            `[wp-desktop-mode] Widget "${id}" teardown threw:`,
            err
          );
        }
      }
      this.generation++;
      record.frame.dispose();
      this.mounted.delete(id);
    }
    handleMountFailure(id, err) {
      const record = this.mounted.get(id);
      if (record) {
        record.frame.dispose();
        this.mounted.delete(id);
      }
      doAction(HOOKS.WIDGET_MOUNT_FAILED, { id, error: err });
      doAction(HOOKS.SHELL_ERROR, { scope: "widget-mount", id, error: err });
      if (typeof console !== "undefined") {
        console.error(
          `[wp-desktop-mode] Widget "${id}" failed to mount:`,
          err
        );
      }
    }
    buildAddTile() {
      const tile2 = document.createElement("button");
      tile2.type = "button";
      tile2.className = "wp-desktop-widgets__add";
      tile2.setAttribute("aria-label", __("Add widget"));
      const plus = document.createElement("span");
      plus.className = "wp-desktop-widgets__add-plus";
      plus.setAttribute("aria-hidden", "true");
      plus.textContent = "+";
      const label = document.createElement("span");
      label.className = "wp-desktop-widgets__add-label";
      label.textContent = __("Add widget");
      tile2.appendChild(plus);
      tile2.appendChild(label);
      tile2.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openWidgetPicker({
          anchor: tile2,
          registry: () => all(),
          enabledIds: () => [...this.enabledIds],
          onAdd: (id) => this.add(id)
        });
      });
      return tile2;
    }
    /**
     * Drop a card into the right parent based on its floating state.
     * Docked cards append to the column list above the `+` tile;
     * floating cards append to the desktop-area-level host so they
     * sit above the wallpaper and can range across the viewport.
     */
    placeCard(card, floating) {
      if (floating) {
        this.floatingHost.appendChild(card);
      } else {
        this.listEl.appendChild(card);
      }
    }
    /**
     * Move a widget from the column into the floating host. Called by
     * the frame on the user's first drag of a movable widget.
     */
    liberate(id, geometry) {
      const record = this.mounted.get(id);
      if (!record || record.floating) {
        return;
      }
      record.floating = true;
      this.floatingHost.appendChild(record.frame.card);
      applyGeometry(record.frame.card, geometry);
      this.persistGeometry(id, geometry);
      this.paintEmptyState();
    }
    /**
     * Inverse of {@link liberate}: move a floating card back into
     * the column and drop its persisted geometry so a subsequent
     * shell boot brings it up docked. Called when the user clicks
     * the re-dock button in the card's chrome header.
     *
     * Idempotent — a docked widget silently no-ops. The `--floating`
     * class on the card is removed as part of the same write so CSS
     * rules that depend on it (re-dock button visibility, absolute
     * positioning) flip back in one paint.
     */
    redock(id) {
      const record = this.mounted.get(id);
      if (!record || !record.floating) {
        return;
      }
      record.floating = false;
      if (this.geometry[id]) {
        delete this.geometry[id];
        saveGeometry(this.geometry);
      }
      const card = record.frame.card;
      card.classList.remove("wp-desktop-widgets__card--floating");
      card.style.left = "";
      card.style.top = "";
      card.style.width = "";
      card.style.height = "";
      this.listEl.appendChild(card);
      this.paintEmptyState();
    }
    persistGeometry(id, geometry) {
      this.geometry[id] = geometry;
      saveGeometry(this.geometry);
    }
    /**
     * Toggle a `--has-widgets` modifier so CSS can hide the column's
     * decorative backdrop when nothing's mounted (keeps the empty
     * state clean — just the `+` tile floating in the corner).
     *
     * Floating widgets don't count toward "has widgets" in the column
     * sense — if every enabled widget is floating, the column itself
     * shows only the empty state + add tile.
     */
    paintEmptyState() {
      let docked = 0;
      for (const record of this.mounted.values()) {
        if (!record.floating) {
          docked++;
        }
      }
      this.root.classList.toggle(
        "wp-desktop-widgets--has-widgets",
        docked > 0
      );
    }
  }
  function isThenable(x) {
    return !!x && (typeof x === "object" || typeof x === "function") && typeof x.then === "function";
  }
  const DEFAULT_NATIVE_MIN_WIDTH = 280;
  const DEFAULT_NATIVE_MIN_HEIGHT = 220;
  const DEFAULT_NATIVE_WIDTH = 520;
  const DEFAULT_NATIVE_HEIGHT = 400;
  function createRegisterWindow(manager) {
    return (def) => {
      return manager.open({
        id: def.id,
        baseId: def.baseId || def.id,
        native: true,
        url: def.url || `#${def.id}`,
        title: def.title,
        icon: def.icon,
        x: def.x ?? 0,
        y: def.y ?? 0,
        width: def.width ?? DEFAULT_NATIVE_WIDTH,
        height: def.height ?? DEFAULT_NATIVE_HEIGHT,
        minWidth: def.minWidth ?? DEFAULT_NATIVE_MIN_WIDTH,
        minHeight: def.minHeight ?? DEFAULT_NATIVE_MIN_HEIGHT,
        render: def.render,
        onClose: def.onClose,
        onResize: def.onResize,
        autofocus: def.autofocus,
        initialState: def.initialState,
        multi: def.multi,
        desktopId: def.desktopId
      });
    };
  }
  let onWindowInstanceCounter = 0;
  function onWindow(id, handlers) {
    const namespace = `wp-desktop-mode/on-window/${id}/${++onWindowInstanceCounter}`;
    const bindings = [
      ["opened", HOOKS.WINDOW_OPENED],
      ["focused", HOOKS.WINDOW_FOCUSED],
      ["closing", HOOKS.WINDOW_CLOSING],
      ["closed", HOOKS.WINDOW_CLOSED],
      ["minimized", HOOKS.WINDOW_MINIMIZED],
      ["restored", HOOKS.WINDOW_RESTORED],
      ["maximized", HOOKS.WINDOW_MAXIMIZED],
      ["resized", HOOKS.WINDOW_RESIZED],
      ["bodyResized", HOOKS.WINDOW_BODY_RESIZED],
      ["boundsChanged", HOOKS.WINDOW_BOUNDS_CHANGED]
    ];
    const registered = [];
    let disposed = false;
    const unsubscribe = () => {
      if (disposed) {
        return;
      }
      disposed = true;
      for (const hookName of registered) {
        removeAction(hookName, namespace);
      }
    };
    for (const [key, hookName] of bindings) {
      const handler = handlers[key];
      if (!handler) {
        continue;
      }
      registered.push(hookName);
      addAction(hookName, namespace, (payload) => {
        const p = payload;
        if (p.windowId !== id) {
          return;
        }
        const { windowId: _w, ...rest } = p;
        handler(rest);
        if (key === "closed") {
          unsubscribe();
        }
      });
    }
    return unsubscribe;
  }
  function createNativeWindowSync(deps) {
    const { manager, dock, taskbar, taskbarEl, desktopArea } = deps;
    const registered = /* @__PURE__ */ new Set();
    const injectedTemplates = /* @__PURE__ */ new Set();
    const loadedScripts = /* @__PURE__ */ new Set();
    const ensureTaskbarVisible = () => {
      if (taskbarEl && taskbarEl.hidden) {
        taskbarEl.hidden = false;
        desktopArea.classList.add("wp-desktop-area--with-taskbar");
      }
    };
    const ensureTemplate = (entry) => {
      if (injectedTemplates.has(entry.templateId)) {
        return;
      }
      if (document.getElementById(entry.templateId)) {
        injectedTemplates.add(entry.templateId);
        return;
      }
      if (!entry.templateHtml) {
        return;
      }
      const tpl = document.createElement("template");
      tpl.id = entry.templateId;
      tpl.innerHTML = entry.templateHtml;
      document.body.appendChild(tpl);
      injectedTemplates.add(entry.templateId);
    };
    const ensureScript = async (entry) => {
      if (!entry.scriptUrl || loadedScripts.has(entry.scriptUrl)) {
        return;
      }
      try {
        await loadVendorScript(entry.scriptUrl);
      } catch (err) {
        doAction(HOOKS.SHELL_ERROR, {
          scope: "native-window-script-load",
          id: entry.id,
          error: err
        });
      }
      loadedScripts.add(entry.scriptUrl);
    };
    const openFromEntry = (entry) => {
      const globalRegistry = window.wpDesktopNativeWindows || {};
      const render2 = globalRegistry[entry.id];
      const finalRender = render2 ? render2 : (body) => {
        try {
          body.appendChild(cloneTemplate(entry.templateId));
        } catch {
        }
      };
      manager.open({
        id: entry.id,
        baseId: entry.id,
        native: true,
        url: `#${entry.id}`,
        title: entry.title,
        icon: entry.icon,
        x: 0,
        y: 0,
        width: entry.width,
        height: entry.height,
        minWidth: entry.minWidth,
        minHeight: entry.minHeight,
        render: finalRender,
        autofocus: entry.autofocus
      });
    };
    const registerTile = async (entry) => {
      if (registered.has(entry.id)) {
        return;
      }
      if ("none" === entry.placement) {
        ensureTemplate(entry);
        await ensureScript(entry);
        registered.add(entry.id);
        return;
      }
      ensureTemplate(entry);
      await ensureScript(entry);
      const rail = "dock" === entry.placement ? dock : taskbar;
      if (!rail) {
        dock?.appendSystemItem({
          id: entry.id,
          title: entry.title,
          icon: entry.icon,
          isOpen: () => !!manager.getById(entry.id),
          onOpen: () => openFromEntry(entry)
        });
      } else {
        rail.appendSystemItem({
          id: entry.id,
          title: entry.title,
          icon: entry.icon,
          isOpen: () => !!manager.getById(entry.id),
          onOpen: () => openFromEntry(entry)
        });
        if (rail === taskbar) {
          ensureTaskbarVisible();
        }
      }
      doAction(HOOKS.DOCK_ITEM_APPENDED, {
        id: entry.id,
        placement: "dock" === entry.placement ? "dock" : "taskbar"
      });
      registered.add(entry.id);
    };
    const unregisterTile = (id) => {
      if (!registered.has(id)) {
        return;
      }
      dock?.removeSystemItem(id);
      taskbar?.removeSystemItem(id);
      registered.delete(id);
    };
    return async (list) => {
      const incoming = /* @__PURE__ */ new Set();
      for (const entry of list) {
        incoming.add(entry.id);
      }
      for (const id of Array.from(registered)) {
        if (!incoming.has(id)) {
          unregisterTile(id);
        }
      }
      for (const entry of list) {
        if (!registered.has(entry.id)) {
          await registerTile(entry);
        }
      }
    };
  }
  function cloneTemplate(template) {
    let tpl = null;
    if (typeof template === "string") {
      const found = document.getElementById(template);
      if (found instanceof HTMLTemplateElement) {
        tpl = found;
      }
    } else {
      tpl = template;
    }
    if (!tpl) {
      throw new Error(
        `[wp-desktop-mode] cloneTemplate: no <template> found for ${typeof template === "string" ? `#${template}` : "<reference>"}`
      );
    }
    return tpl.content.cloneNode(true);
  }
  function renderDesktopIcons(host, icons, deps) {
    const existing = host.querySelector(":scope > .wp-desktop-icons");
    if (existing) {
      existing.remove();
    }
    if (!icons || icons.length === 0) {
      return;
    }
    const container = document.createElement("div");
    container.className = "wp-desktop-icons";
    container.setAttribute("role", "list");
    container.setAttribute("aria-label", "Desktop icons");
    for (const entry of icons) {
      container.appendChild(buildIcon(entry, deps));
    }
    host.appendChild(container);
  }
  function buildIcon(entry, deps) {
    const tile2 = document.createElement("button");
    tile2.type = "button";
    tile2.className = "wp-desktop-icon";
    tile2.dataset.iconId = entry.id;
    tile2.setAttribute("role", "listitem");
    tile2.setAttribute("aria-label", entry.title);
    const icon = document.createElement("span");
    if (entry.icon.startsWith("http://") || entry.icon.startsWith("https://")) {
      const img = document.createElement("img");
      img.src = entry.icon;
      img.alt = "";
      icon.className = "wp-desktop-icon__image";
      icon.appendChild(img);
    } else {
      icon.className = `wp-desktop-icon__image dashicons ${sanitizeClassName(entry.icon)}`;
      icon.setAttribute("aria-hidden", "true");
    }
    tile2.appendChild(icon);
    const label = document.createElement("span");
    label.className = "wp-desktop-icon__label";
    label.textContent = entry.title;
    tile2.appendChild(label);
    tile2.addEventListener("click", (e) => {
      e.stopPropagation();
      doAction(HOOKS.DESKTOP_ICON_CLICKED, {
        id: entry.id,
        target: entry.window ? "window" : "url"
      });
      openTarget(entry, deps);
    });
    return tile2;
  }
  function openTarget(entry, deps) {
    if (entry.window) {
      const opened = deps.openWindow(entry.window);
      if (!opened) {
        return;
      }
      return;
    }
    if (entry.url) {
      try {
        const parsed = new URL(entry.url, window.location.origin);
        if (parsed.origin !== window.location.origin) {
          window.open(parsed.toString(), "_blank", "noopener,noreferrer");
          return;
        }
        deps.manager.open({
          id: `desktop-icon-${entry.id}`,
          url: parsed.toString(),
          title: entry.title,
          icon: entry.icon
        });
      } catch {
      }
    }
  }
  function escapeHtmlForMd(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function renderInlineMd(s) {
    return s.replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      (_m, label, url) => {
        if (!/^https?:\/\//i.test(url.trim())) {
          return label;
        }
        return `<a href="${url.trim()}" target="_blank" rel="noopener noreferrer">${label}</a>`;
      }
    ).replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>").replace(/(?<![*\w])\*([^*\n]+?)\*(?![*\w])/g, "<em>$1</em>").replace(/(?<![_\w])_([^_\n]+?)_(?![_\w])/g, "<em>$1</em>").replace(/`([^`\n]+?)`/g, "<code>$1</code>");
  }
  function renderMarkdown(md) {
    if (!md) {
      return "";
    }
    const safe = escapeHtmlForMd(md);
    const blocks = safe.split(/\n\s*\n/);
    const out = [];
    for (const raw of blocks) {
      const lines = raw.split(/\n/).map((l) => l.trim()).filter((l) => l !== "");
      if (lines.length === 0) {
        continue;
      }
      const isUL = lines.every((l) => /^[-*]\s+/.test(l));
      const isOL = lines.every((l) => /^\d+\.\s+/.test(l));
      if (isUL) {
        const items = lines.map(
          (l) => `<li>${renderInlineMd(l.replace(/^[-*]\s+/, ""))}</li>`
        );
        out.push(`<ul>${items.join("")}</ul>`);
      } else if (isOL) {
        const items = lines.map(
          (l) => `<li>${renderInlineMd(l.replace(/^\d+\.\s+/, ""))}</li>`
        );
        out.push(`<ol>${items.join("")}</ol>`);
      } else {
        out.push(`<p>${renderInlineMd(lines.join("<br>"))}</p>`);
      }
    }
    return out.join("");
  }
  const ICON_SPARKLE = `<svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true" focusable="false" fill="currentColor">
	<path d="M10 2 L11.8 7.8 L17.5 9.5 L11.8 11.2 L10 17 L8.2 11.2 L2.5 9.5 L8.2 7.8 Z"/>
</svg>`;
  const ICON_CLOSE = `<svg viewBox="0 0 14 14" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false">
	<line x1="2" y1="2" x2="12" y2="12"/>
	<line x1="12" y1="2" x2="2" y2="12"/>
</svg>`;
  const ICON_RETURN = `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
	<polyline points="14,4 14,10 3,10"/>
	<polyline points="6,7 3,10 6,13"/>
</svg>`;
  const ICON_SPINNER = `<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="wp-desktop-ai__spinner-icon">
	<circle cx="10" cy="10" r="7" stroke-opacity="0.25"/>
	<path d="M10 3 A7 7 0 0 1 17 10" stroke-opacity="1"/>
</svg>`;
  const ICON_ARROW = `<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
	<polyline points="6,3 11,8 6,13"/>
</svg>`;
  const SUGGESTED_PROMPTS = [
    "Find my post about…",
    "Where can I see categories?",
    "Do I have any spam comments?",
    "Take me to plugin settings"
  ];
  class AiAssistant {
    constructor(config) {
      this._isOpen = false;
      this._isSearching = false;
      this._previousFocus = null;
      this._currentStream = null;
      this._selectedCommand = 0;
      this._selectedSuggestion = 0;
      this._currentSuggestions = [];
      this._suggestToken = 0;
      this._aiSearchUrl = config.aiSearchUrl;
      this._aiSearchStreamUrl = config.aiSearchStreamUrl;
      this._restNonce = config.restNonce;
      this._el = this._buildDOM();
      document.body.appendChild(this._el);
      this._input = this._el.querySelector(".wp-desktop-ai__input");
      this._submitBtn = this._el.querySelector(".wp-desktop-ai__submit");
      this._closeBtn = this._el.querySelector(".wp-desktop-ai__close");
      this._resultsEl = this._el.querySelector(".wp-desktop-ai__results");
      this._bindEvents();
      this._renderSuggestions();
      subscribeCommands(() => {
        if (this._isOpen && this._input.value.startsWith("/")) {
          this._renderCommandMode();
        }
      });
    }
    // ------------------------------------------------------------------
    // Public API
    // ------------------------------------------------------------------
    open() {
      if (this._isOpen) {
        this._input.focus();
        this._input.select();
        return;
      }
      this._isOpen = true;
      this._previousFocus = this._el.ownerDocument.activeElement;
      this._input.value = "";
      this._selectedCommand = 0;
      this._submitBtn.classList.remove("has-value");
      this._renderSuggestions();
      this._el.removeAttribute("hidden");
      void this._el.offsetHeight;
      this._el.classList.add("is-open");
      this._el.setAttribute("aria-hidden", "false");
      requestAnimationFrame(() => this._input.focus());
    }
    close() {
      if (!this._isOpen) {
        return;
      }
      this._isOpen = false;
      this._el.classList.remove("is-open");
      this._el.setAttribute("aria-hidden", "true");
      this._closeStream();
      this._isSearching = false;
      this._submitBtn.disabled = false;
      this._input.disabled = false;
      const onEnd = (e) => {
        if (e.target !== this._el || e.propertyName !== "opacity") {
          return;
        }
        this._el.setAttribute("hidden", "");
        this._el.removeEventListener("transitionend", onEnd);
        if (this._previousFocus instanceof HTMLElement) {
          this._previousFocus.focus();
        }
      };
      this._el.addEventListener("transitionend", onEnd);
    }
    toggle() {
      if (this._isOpen) {
        this.close();
      } else {
        this.open();
      }
    }
    get isOpen() {
      return this._isOpen;
    }
    // ------------------------------------------------------------------
    // Events
    // ------------------------------------------------------------------
    _bindEvents() {
      this._el.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          this.close();
        }
      });
      this._el.addEventListener("keydown", (e) => {
        if (e.key !== "Tab") {
          return;
        }
        const focusable = [this._closeBtn, this._input, this._submitBtn].filter((el) => !el.disabled);
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active2 = this._el.ownerDocument.activeElement;
        if (e.shiftKey && active2 === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active2 === last) {
          e.preventDefault();
          first.focus();
        }
      });
      document.addEventListener("wp-desktop-open-ai", () => this.open());
      this._closeBtn.addEventListener("click", () => this.close());
      this._submitBtn.addEventListener("click", () => this._onSubmit());
      this._input.addEventListener("keydown", (e) => {
        const parsed = parseCommandInput(this._input.value);
        if (parsed.isCommand && !parsed.hasArgsPart) {
          const matches = filterCommands(parsed.slug);
          if (e.key === "ArrowDown") {
            e.preventDefault();
            this._selectedCommand = Math.min(
              this._selectedCommand + 1,
              Math.max(0, matches.length - 1)
            );
            this._renderCommandMode();
            return;
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            this._selectedCommand = Math.max(0, this._selectedCommand - 1);
            this._renderCommandMode();
            return;
          }
          if (e.key === "Tab" && matches.length > 0) {
            e.preventDefault();
            const pick = matches[this._selectedCommand] ?? matches[0];
            this._input.value = `/${pick.slug} `;
            this._submitBtn.classList.add("has-value");
            this._selectedSuggestion = 0;
            this._renderCommandMode();
            return;
          }
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (matches.length === 0) {
              this._showError(`Unknown command: /${parsed.slug}`);
              return;
            }
            const pick = matches[this._selectedCommand] ?? matches[0];
            this._runCommand(pick, "");
            return;
          }
        }
        if (parsed.isCommand && parsed.hasArgsPart) {
          const cmd = findCommand(parsed.slug);
          const hasSuggest = !!cmd && typeof cmd.suggest === "function";
          if (hasSuggest && this._currentSuggestions.length > 0) {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              this._selectedSuggestion = Math.min(
                this._selectedSuggestion + 1,
                this._currentSuggestions.length - 1
              );
              this._paintSuggestionSelection();
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              this._selectedSuggestion = Math.max(0, this._selectedSuggestion - 1);
              this._paintSuggestionSelection();
              return;
            }
            if (e.key === "Tab") {
              e.preventDefault();
              const pick = this._currentSuggestions[this._selectedSuggestion];
              if (pick) {
                this._input.value = `/${parsed.slug} ${pick.value}`;
              }
              return;
            }
            if (e.key === "Enter" && !e.shiftKey && cmd) {
              e.preventDefault();
              const pick = this._currentSuggestions[this._selectedSuggestion];
              const finalArgs = pick ? pick.value : parsed.args;
              this._runCommand(cmd, finalArgs);
              return;
            }
          }
        }
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          this._onSubmit();
        }
      });
      this._input.addEventListener("input", () => {
        const hasValue = this._input.value.trim().length > 0;
        this._submitBtn.classList.toggle("has-value", hasValue);
        this._selectedCommand = 0;
        this._selectedSuggestion = 0;
        if (this._input.value.startsWith("/")) {
          this._renderCommandMode();
        } else if (!hasValue) {
          this._renderSuggestions();
        } else ;
      });
    }
    // ------------------------------------------------------------------
    // Flow
    // ------------------------------------------------------------------
    async _onSubmit() {
      const raw = this._input.value.trim();
      if (!raw || this._isSearching) {
        return;
      }
      const parsed = parseCommandInput(this._input.value);
      if (parsed.isCommand) {
        const cmd = findCommand(parsed.slug);
        if (!cmd) {
          this._showError(`Unknown command: /${parsed.slug}`);
          return;
        }
        await this._runCommand(cmd, parsed.args);
        return;
      }
      await this._runSearch(raw, null, 0);
    }
    /**
     * Invoke a plugin-registered command. Handles both sync and async
     * handlers, renders the return value the same way we render an AI
     * answer, and surfaces thrown errors as an error-state bubble.
     */
    async _runCommand(cmd, args) {
      if (this._isSearching) {
        return;
      }
      const gate = applyFilters(HOOKS.COMMAND_BEFORE_RUN, {
        proceed: true,
        slug: cmd.slug,
        args,
        command: cmd
      });
      if (gate && gate.proceed === false) {
        this._showError(
          gate.reason ?? `Command /${cmd.slug} was cancelled.`
        );
        return;
      }
      this._isSearching = true;
      this._submitBtn.disabled = true;
      this._input.disabled = true;
      this._showThinking(`Running /${cmd.slug}…`);
      const ctx = {
        close: () => this.close(),
        openInWindow: (url, title, icon) => this._openInLegacyWindow(url, title, icon),
        confirm: (msg, details) => this._confirm(msg, details)
      };
      try {
        const result = await Promise.resolve(cmd.run(args, ctx));
        this._renderCommandResult(cmd, result);
        doAction(HOOKS.COMMAND_AFTER_RUN, {
          slug: cmd.slug,
          args,
          command: cmd,
          result
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this._showError(`Command /${cmd.slug} failed: ${msg}`);
        doAction(HOOKS.COMMAND_ERROR, {
          slug: cmd.slug,
          args,
          command: cmd,
          error: err
        });
      } finally {
        this._isSearching = false;
        this._submitBtn.disabled = false;
        this._input.disabled = false;
        this._input.focus();
      }
    }
    /**
     * Default `ctx.confirm()` — uses the browser's native confirm
     * dialog. Combined message + details into one string because
     * window.confirm() only takes one. The shell can swap a custom
     * dialog in later (the Promise<boolean> contract is stable).
     */
    _confirm(message, details) {
      const text = details ? `${message}

${details}` : message;
      return Promise.resolve(window.confirm(text));
    }
    /**
     * Render the value returned by a command. A `void` return means
     * the command performed a side-effect (e.g. opened a window) and
     * doesn't need a bubble; in that case we clear the results area.
     * A plain string is shorthand for `{ message: string }`.
     */
    _renderCommandResult(_cmd, result) {
      if (result === void 0 || result === null) {
        this._resultsEl.innerHTML = "";
        this._resultsEl.hidden = true;
        return;
      }
      const answer = typeof result === "string" ? {
        answer_type: "chat",
        message: result,
        entity: null,
        admin_links: null,
        iterations: 0,
        exhausted: true,
        continue: null
      } : {
        answer_type: result.answer_type ?? "chat",
        message: result.message,
        entity: result.entity ?? null,
        admin_links: result.admin_links ?? null,
        iterations: 0,
        exhausted: true,
        continue: null
      };
      this._showResult("", answer);
    }
    _runSearch(query, resumeTool, startOffset) {
      if (this._isSearching) {
        return;
      }
      this._isSearching = true;
      this._submitBtn.disabled = true;
      this._input.disabled = true;
      this._showThinking("Thinking…");
      if (typeof EventSource !== "undefined" && this._aiSearchStreamUrl) {
        this._runSearchStream(query, resumeTool, startOffset);
      } else {
        this._runSearchFetch(query, resumeTool, startOffset);
      }
    }
    /**
     * EventSource-based streaming — the preferred path. Shows real-time
     * progress messages as the agent picks tools and runs them.
     */
    _runSearchStream(query, resumeTool, startOffset) {
      const url = new URL(this._aiSearchStreamUrl, window.location.origin);
      url.searchParams.set("nonce", this._restNonce);
      url.searchParams.set("query", query);
      if (resumeTool) {
        url.searchParams.set("resume_tool", resumeTool);
        url.searchParams.set("start_offset", String(startOffset));
      }
      this._closeStream();
      const es = new EventSource(url.toString());
      this._currentStream = es;
      const finish = () => {
        es.close();
        this._currentStream = null;
        this._isSearching = false;
        this._submitBtn.disabled = false;
        this._input.disabled = false;
        this._input.focus();
      };
      es.onmessage = (ev) => {
        let data;
        try {
          data = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (!data || typeof data !== "object") {
          return;
        }
        switch (data.event) {
          case "open":
            break;
          case "progress":
            if (typeof data.message === "string") {
              this._showThinking(data.message);
            }
            break;
          case "done":
            if (data.result) {
              this._showResult(query, data.result);
            }
            finish();
            break;
          case "error":
            this._showError(data.message ?? "Something went wrong.");
            finish();
            break;
        }
      };
      es.onerror = () => {
        if (this._currentStream === es) {
          this._showError("Lost connection to the assistant. Please try again.");
          finish();
        }
      };
    }
    /**
     * Legacy fetch path — used when EventSource is not available.
     */
    async _runSearchFetch(query, resumeTool, startOffset) {
      try {
        const body = { query };
        if (resumeTool) {
          body.resume_tool = resumeTool;
          body.start_offset = startOffset;
        }
        const res = await fetch(this._aiSearchUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-WP-Nonce": this._restNonce
          },
          body: JSON.stringify(body)
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          this._showError(err.message ?? `Server returned ${res.status}`);
          return;
        }
        this._showResult(query, await res.json());
      } catch {
        this._showError("Network error — please check your connection and try again.");
      } finally {
        this._isSearching = false;
        this._submitBtn.disabled = false;
        this._input.disabled = false;
        this._input.focus();
      }
    }
    _closeStream() {
      if (this._currentStream) {
        this._currentStream.close();
        this._currentStream = null;
      }
    }
    // ------------------------------------------------------------------
    // Open helpers — everything opens as a legacy iframe window, not a
    // new browser tab, so the admin experience stays inside the desktop.
    // ------------------------------------------------------------------
    _getWindowManager() {
      const wm = window.wp?.desktop?.windowManager;
      return wm ?? null;
    }
    _openInLegacyWindow(url, title, icon) {
      const wm = this._getWindowManager();
      if (!wm) {
        window.open(url, "_blank", "noopener");
        return;
      }
      wm.open({ url, title, icon: icon ?? "dashicons-admin-generic" });
      this.close();
    }
    // ------------------------------------------------------------------
    // Rendering
    // ------------------------------------------------------------------
    /**
     * Render the slash-command palette — filtered list of commands
     * matching the current input. If the user has typed a slug followed
     * by a space, we're in "args" mode so we only show the one locked-in
     * command with a hint rather than a filterable list.
     */
    _renderCommandMode() {
      this._resultsEl.hidden = false;
      const parsed = parseCommandInput(this._input.value);
      if (parsed.hasArgsPart) {
        const cmd = findCommand(parsed.slug);
        if (cmd) {
          this._renderArgsMode(cmd, parsed.args);
          return;
        }
      }
      const matches = filterCommands(parsed.slug);
      if (matches.length === 0) {
        this._resultsEl.innerHTML = `
				<div class="wp-desktop-ai__state wp-desktop-ai__state--empty">
					<span>No commands matching <strong>/${this._esc(parsed.slug)}</strong>.</span>
				</div>
			`;
        return;
      }
      if (this._selectedCommand >= matches.length) {
        this._selectedCommand = 0;
      }
      const items = matches.map((c, i) => {
        const selected = i === this._selectedCommand ? " is-selected" : "";
        return `
					<button
						type="button"
						class="wp-desktop-ai__cmd-item${selected}"
						data-slug="${this._esc(c.slug)}"
						data-index="${i}"
					>
						<span class="wp-desktop-ai__cmd-icon dashicons ${this._esc(
          c.icon ?? "dashicons-arrow-right-alt"
        )}" aria-hidden="true"></span>
						<span class="wp-desktop-ai__cmd-body">
							<span class="wp-desktop-ai__cmd-title">
								/${this._esc(c.slug)}
								${c.hint ? `<span class="wp-desktop-ai__cmd-hint">${this._esc(c.hint)}</span>` : ""}
							</span>
							${c.description ? `<span class="wp-desktop-ai__cmd-desc">${this._esc(c.description)}</span>` : ""}
						</span>
					</button>
				`;
      }).join("");
      this._resultsEl.innerHTML = `
			<div class="wp-desktop-ai__cmd-list">
				<p class="wp-desktop-ai__suggestions-label">Commands</p>
				${items}
			</div>
		`;
      this._resultsEl.querySelectorAll(".wp-desktop-ai__cmd-item").forEach((btn) => {
        btn.addEventListener("click", () => {
          const slug = btn.dataset.slug ?? "";
          this._input.value = `/${slug} `;
          this._submitBtn.classList.add("has-value");
          this._input.focus();
          this._renderCommandMode();
        });
        btn.addEventListener("mouseenter", () => {
          const idx = parseInt(btn.dataset.index ?? "0", 10);
          if (!Number.isNaN(idx)) {
            this._selectedCommand = idx;
            this._resultsEl.querySelectorAll(".wp-desktop-ai__cmd-item").forEach((el, i) => el.classList.toggle("is-selected", i === idx));
          }
        });
      });
    }
    /**
     * Render args-mode UI for a locked-in command. If the command has a
     * `suggest()` handler, fetch it (sync or async) and render the
     * returned list. Otherwise fall back to a single-row "Press Enter
     * to run" card.
     */
    _renderArgsMode(cmd, args) {
      if (typeof cmd.suggest !== "function") {
        this._currentSuggestions = [];
        this._resultsEl.innerHTML = this._renderCommandHeader(cmd, true);
        return;
      }
      const myToken = ++this._suggestToken;
      const ctx = {
        close: () => this.close(),
        openInWindow: (url, title, icon) => this._openInLegacyWindow(url, title, icon),
        confirm: (msg, details) => this._confirm(msg, details)
      };
      let result;
      try {
        result = cmd.suggest(args, ctx);
      } catch {
        result = [];
      }
      const render2 = (suggestions) => {
        if (myToken !== this._suggestToken) {
          return;
        }
        this._currentSuggestions = suggestions;
        if (this._selectedSuggestion >= suggestions.length) {
          this._selectedSuggestion = 0;
        }
        this._resultsEl.innerHTML = this._renderCommandHeader(cmd, false) + this._renderSuggestionList(suggestions);
        this._resultsEl.querySelectorAll(".wp-desktop-ai__cmd-suggest-item").forEach((btn) => {
          btn.addEventListener("click", () => {
            const idx = parseInt(btn.dataset.index ?? "0", 10);
            const pick = suggestions[idx];
            if (pick) {
              this._input.value = `/${cmd.slug} ${pick.value}`;
              this._runCommand(cmd, pick.value);
            }
          });
          btn.addEventListener("mouseenter", () => {
            const idx = parseInt(btn.dataset.index ?? "0", 10);
            if (!Number.isNaN(idx)) {
              this._selectedSuggestion = idx;
              this._paintSuggestionSelection();
            }
          });
        });
      };
      if (result && typeof result.then === "function") {
        this._resultsEl.innerHTML = this._renderCommandHeader(cmd, false);
        result.then((r) => render2(Array.isArray(r) ? r : [])).catch(() => render2([]));
      } else {
        render2(Array.isArray(result) ? result : []);
      }
    }
    /** Render the command banner used at the top of args-mode. */
    _renderCommandHeader(cmd, standalone) {
      return `
			<div class="wp-desktop-ai__cmd-active">
				<span class="wp-desktop-ai__cmd-icon dashicons ${this._esc(
        cmd.icon ?? "dashicons-arrow-right-alt"
      )}" aria-hidden="true"></span>
				<div class="wp-desktop-ai__cmd-body">
					<span class="wp-desktop-ai__cmd-title">
						/${this._esc(cmd.slug)}
						${cmd.hint ? `<span class="wp-desktop-ai__cmd-hint">${this._esc(cmd.hint)}</span>` : ""}
					</span>
					${cmd.description ? `<span class="wp-desktop-ai__cmd-desc">${this._esc(cmd.description)}</span>` : ""}
					${standalone ? '<span class="wp-desktop-ai__cmd-enter-hint">Press <kbd>↵</kbd> to run</span>' : ""}
				</div>
			</div>
		`;
    }
    /** Render the list of suggestions under the command header. */
    _renderSuggestionList(suggestions) {
      if (suggestions.length === 0) {
        return `
				<div class="wp-desktop-ai__state wp-desktop-ai__state--empty">
					<span>No suggestions — press <kbd>↵</kbd> to run with the text you typed.</span>
				</div>
			`;
      }
      const items = suggestions.map((s, i) => {
        const selected = i === this._selectedSuggestion ? " is-selected" : "";
        return `
					<button
						type="button"
						class="wp-desktop-ai__cmd-suggest-item${selected}"
						data-index="${i}"
					>
						<span class="wp-desktop-ai__cmd-icon dashicons ${this._esc(
          s.icon ?? "dashicons-arrow-right-alt"
        )}" aria-hidden="true"></span>
						<span class="wp-desktop-ai__cmd-body">
							<span class="wp-desktop-ai__cmd-suggest-label">${this._esc(s.label)}</span>
							${s.description ? `<span class="wp-desktop-ai__cmd-desc">${this._esc(s.description)}</span>` : ""}
						</span>
					</button>
				`;
      }).join("");
      return `<div class="wp-desktop-ai__cmd-suggest-list">${items}</div>`;
    }
    /** Flip the is-selected class on the suggestion rows without re-rendering the whole list. */
    _paintSuggestionSelection() {
      this._resultsEl.querySelectorAll(".wp-desktop-ai__cmd-suggest-item").forEach((el, i) => {
        el.classList.toggle("is-selected", i === this._selectedSuggestion);
      });
    }
    _renderSuggestions() {
      this._resultsEl.hidden = false;
      this._resultsEl.innerHTML = `
			<div class="wp-desktop-ai__suggestions">
				<p class="wp-desktop-ai__suggestions-label">${this._esc("Try asking")}</p>
				<div class="wp-desktop-ai__suggestions-list">
					${SUGGESTED_PROMPTS.map(
        (p) => `<button type="button" class="wp-desktop-ai__suggestion" data-prompt="${this._esc(p)}">
							${this._esc(p)}
						</button>`
      ).join("")}
				</div>
			</div>
		`;
      this._resultsEl.querySelectorAll(".wp-desktop-ai__suggestion").forEach((btn) => {
        btn.addEventListener("click", () => {
          const prompt = btn.dataset.prompt ?? "";
          this._input.value = prompt;
          this._submitBtn.classList.add("has-value");
          this._input.focus();
        });
      });
    }
    _showThinking(message = "Thinking…") {
      this._resultsEl.hidden = false;
      this._resultsEl.innerHTML = `
			<div class="wp-desktop-ai__state wp-desktop-ai__state--thinking">
				${ICON_SPINNER}
				<span>${this._esc(message)}</span>
			</div>
		`;
    }
    _showError(message) {
      this._resultsEl.hidden = false;
      this._resultsEl.innerHTML = `
			<div class="wp-desktop-ai__state wp-desktop-ai__state--error">
				<span>${this._esc(message)}</span>
			</div>
		`;
    }
    _showResult(query, data) {
      this._resultsEl.hidden = false;
      const messageHtml = `
			<div class="wp-desktop-ai__bubble">
				<span class="wp-desktop-ai__bubble-icon">${ICON_SPARKLE}</span>
				<div class="wp-desktop-ai__bubble-text">${renderMarkdown(data.message || "")}</div>
			</div>
		`;
      let bodyHtml = "";
      if (data.answer_type === "entity" && data.entity) {
        bodyHtml = this._renderEntityCard(data.entity);
      } else if (data.answer_type === "navigation" && data.admin_links && data.admin_links.length > 0) {
        bodyHtml = this._renderAdminLinks(data.admin_links);
      }
      if (data.continue) {
        bodyHtml += `
				<button type="button" class="wp-desktop-ai__continue-btn"
					data-tool="${this._esc(data.continue.tool)}"
					data-offset="${data.continue.offset}"
					data-query="${this._esc(query)}">
					${this._esc(data.continue.label)}
				</button>
			`;
      }
      this._resultsEl.innerHTML = messageHtml + bodyHtml;
      this._resultsEl.querySelectorAll(
        ".wp-desktop-ai__entity-open"
      ).forEach((btn) => {
        btn.addEventListener("click", () => {
          const url = btn.dataset.url ?? "";
          const title = btn.dataset.title ?? "";
          const icon = btn.dataset.icon ?? "dashicons-admin-generic";
          if (url) {
            this._openInLegacyWindow(url, title, icon);
          }
        });
      });
      this._resultsEl.querySelectorAll(
        ".wp-desktop-ai__admin-link"
      ).forEach((btn) => {
        btn.addEventListener("click", () => {
          const url = btn.dataset.url ?? "";
          const title = btn.dataset.title ?? "";
          const icon = btn.dataset.icon ?? "dashicons-admin-generic";
          if (url) {
            this._openInLegacyWindow(url, title, icon);
          }
        });
      });
      const cont = this._resultsEl.querySelector(".wp-desktop-ai__continue-btn");
      if (cont) {
        cont.addEventListener("click", () => {
          const tool = cont.dataset.tool ?? null;
          const offset = parseInt(cont.dataset.offset ?? "0", 10);
          const q = cont.dataset.query ?? query;
          this._runSearch(q, tool, offset);
        });
      }
    }
    _renderEntityCard(e) {
      const isComment = e.type === "comment";
      const title = isComment ? `Comment on “${this._esc(e.post_title ?? "post")}”` : this._esc(e.title ?? "Untitled");
      const summary = this._esc(e.ai_summary || e.excerpt || "");
      const typeLabel = e.type.charAt(0).toUpperCase() + e.type.slice(1);
      const topicChip = e.topic ? `<span class="wp-desktop-ai__entity-topic">${this._esc(e.topic)}</span>` : "";
      let icon;
      if (isComment) {
        icon = "dashicons-admin-comments";
      } else if (e.type === "page") {
        icon = "dashicons-admin-page";
      } else {
        icon = "dashicons-admin-post";
      }
      return `
			<div class="wp-desktop-ai__entity">
				<div class="wp-desktop-ai__entity-header">
					${topicChip}
					<span class="wp-desktop-ai__entity-type">${this._esc(typeLabel)}</span>
				</div>
				<h3 class="wp-desktop-ai__entity-title">${title}</h3>
				<p class="wp-desktop-ai__entity-summary">${summary}</p>
				<button type="button"
					class="wp-desktop-ai__entity-open"
					data-url="${this._esc(e.edit_url)}"
					data-title="${this._esc(e.title ?? e.post_title ?? typeLabel)}"
					data-icon="${icon}">
					<span>${this._esc(`Open ${typeLabel.toLowerCase()} in desktop`)}</span>
					${ICON_ARROW}
				</button>
			</div>
		`;
    }
    _renderAdminLinks(links) {
      const items = links.map((link) => `
			<button type="button"
				class="wp-desktop-ai__admin-link"
				data-url="${this._esc(link.url)}"
				data-title="${this._esc(link.title)}"
				data-icon="${this._esc(link.icon)}">
				<span class="wp-desktop-ai__admin-link-icon dashicons ${this._esc(link.icon)}" aria-hidden="true"></span>
				<span class="wp-desktop-ai__admin-link-body">
					<span class="wp-desktop-ai__admin-link-title">${this._esc(link.title)}</span>
					<span class="wp-desktop-ai__admin-link-desc">${this._esc(link.description)}</span>
				</span>
				<span class="wp-desktop-ai__admin-link-arrow">${ICON_ARROW}</span>
			</button>
		`).join("");
      return `<div class="wp-desktop-ai__admin-links">${items}</div>`;
    }
    /** Minimal HTML escaping for text interpolated into innerHTML. */
    _esc(str) {
      return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }
    // ------------------------------------------------------------------
    // DOM scaffold
    // ------------------------------------------------------------------
    _buildDOM() {
      const el = document.createElement("div");
      el.id = "wp-desktop-ai-assistant";
      el.className = "wp-desktop-ai";
      el.setAttribute("role", "dialog");
      el.setAttribute("aria-modal", "true");
      el.setAttribute("aria-label", "AI Assistant");
      el.setAttribute("aria-hidden", "true");
      el.setAttribute("hidden", "");
      el.innerHTML = `
			<div class="wp-desktop-ai__backdrop" aria-hidden="true"></div>
			<div class="wp-desktop-ai__panel">
				<div class="wp-desktop-ai__header">
					<span class="wp-desktop-ai__header-icon">${ICON_SPARKLE}</span>
					<span class="wp-desktop-ai__header-label">AI Assistant</span>
					<button type="button" class="wp-desktop-ai__close" aria-label="Close">
						${ICON_CLOSE}
					</button>
				</div>
				<div class="wp-desktop-ai__input-wrap">
					<span class="wp-desktop-ai__input-icon">${ICON_SPARKLE}</span>
					<input
						class="wp-desktop-ai__input"
						type="text"
						placeholder="How can I help?"
						autocomplete="off"
						spellcheck="false"
						aria-label="Ask the AI assistant"
					/>
					<button type="button" class="wp-desktop-ai__submit" aria-label="Send">
						${ICON_RETURN}
					</button>
				</div>
				<div class="wp-desktop-ai__results" hidden></div>
				<div class="wp-desktop-ai__footer">
					<span class="wp-desktop-ai__footer-hint">
						Your assistant for finding content and navigating wp-admin
					</span>
					<span class="wp-desktop-ai__footer-keys" aria-hidden="true">
						<kbd>&#8629;</kbd> ask
					</span>
				</div>
			</div>
		`;
      return el;
    }
  }
  const DRAG_BRIDGE_EVENTS = {
    START: "wp-desktop-cross-frame-drag-start",
    END: "wp-desktop-cross-frame-drag-end"
  };
  function isStart(m) {
    return !!m && typeof m === "object" && m.type === "wp-desktop-drag-start" && !!m.payload && typeof m.payload === "object";
  }
  function isEnd(m) {
    return !!m && typeof m === "object" && m.type === "wp-desktop-drag-end";
  }
  function isPayloadRequest(m) {
    return !!m && typeof m === "object" && m.type === "wp-desktop-drag-payload-request";
  }
  class DragBridge {
    constructor() {
      this._payload = null;
      this._onMessage = (e) => {
        if (e.origin !== this._origin) {
          return;
        }
        const msg = e.data;
        if (isStart(msg)) {
          this._startDrag(msg.payload, e.source ?? null);
          return;
        }
        if (isEnd(msg)) {
          this._endDrag();
          return;
        }
        if (isPayloadRequest(msg) && this._payload && e.source) {
          try {
            e.source.postMessage(
              { type: "wp-desktop-drag-payload", payload: this._payload },
              this._origin
            );
          } catch {
          }
        }
      };
      this._origin = window.location.origin;
      window.addEventListener("message", this._onMessage);
    }
    getPayload() {
      return this._payload;
    }
    isDragging() {
      return this._payload !== null;
    }
    _startDrag(payload, _source) {
      this._payload = payload;
      document.dispatchEvent(
        new CustomEvent(DRAG_BRIDGE_EVENTS.START, { detail: { payload } })
      );
    }
    _endDrag() {
      if (this._payload === null) {
        return;
      }
      const payload = this._payload;
      this._payload = null;
      document.dispatchEvent(
        new CustomEvent(DRAG_BRIDGE_EVENTS.END, { detail: { payload } })
      );
    }
  }
  function collectOpenables() {
    const desktop = window.wp?.desktop;
    if (!desktop) {
      return [];
    }
    const wm = desktop.windowManager;
    const config = desktop.config;
    if (!wm || !config) {
      return [];
    }
    const items = [];
    const fromMenu = (item, group) => ({
      id: item.id,
      label: item.title,
      description: group,
      icon: item.icon,
      open: () => wm.open({
        id: item.id,
        baseId: item.id,
        url: item.url,
        title: item.title,
        icon: item.icon
      })
    });
    for (const item of config.dockItems ?? []) {
      items.push(fromMenu(item, "Admin menu"));
    }
    for (const item of config.taskbarItems ?? []) {
      items.push(fromMenu(item, "Plugin"));
    }
    const filtered = applyFilters(
      "wp-desktop.open-command.items",
      items
    );
    return Array.isArray(filtered) ? filtered : items;
  }
  const openCommand = {
    slug: "open",
    label: "Open",
    description: "Open an admin page or registered window.",
    hint: "[window]",
    icon: "dashicons-external",
    /**
     * Suggest matching windows as the user types args. Simple
     * case-insensitive substring match against label AND id so
     * "add" finds "Add New Post" and "jorvy" finds Jorvy whether
     * the plugin listed it with a friendly label or the slug.
     */
    suggest(args) {
      const q = args.trim().toLowerCase();
      const list = collectOpenables();
      const hits = q === "" ? list : list.filter(
        (w) => w.label.toLowerCase().includes(q) || w.id.toLowerCase().includes(q)
      );
      return hits.slice(0, 12).map((w) => ({
        value: w.label,
        label: w.label,
        description: w.description,
        icon: w.icon ?? "dashicons-external"
      }));
    },
    run(args, ctx) {
      const q = args.trim();
      if (!q) {
        return "Type the name of a window to open, for example `/open Posts`.";
      }
      const list = collectOpenables();
      const ql = q.toLowerCase();
      const match = list.find((w) => w.label.toLowerCase() === ql || w.id.toLowerCase() === ql) ?? list.find(
        (w) => w.label.toLowerCase().includes(ql) || w.id.toLowerCase().includes(ql)
      );
      if (!match) {
        return `No window matching **${q}** — try \`/open\` alone to see available options.`;
      }
      match.open();
      ctx.close();
    }
  };
  function registerBuiltInCommands() {
    registerCommand(openCommand);
  }
  const palettes = [];
  const listeners = /* @__PURE__ */ new Set();
  function registerPalette(p) {
    if (!p || typeof p.id !== "string" || p.id === "") {
      return () => {
      };
    }
    if (typeof p.open !== "function" || typeof p.close !== "function" || typeof p.isOpen !== "function") {
      return () => {
      };
    }
    const idx = palettes.findIndex((x) => x.id === p.id);
    if (idx >= 0) {
      palettes[idx] = p;
    } else {
      palettes.push(p);
    }
    notify();
    return () => {
      const i = palettes.findIndex((x) => x.id === p.id);
      if (i >= 0) {
        palettes.splice(i, 1);
        notify();
      }
    };
  }
  function unregisterPalette(id) {
    const idx = palettes.findIndex((x) => x.id === id);
    if (idx >= 0) {
      palettes.splice(idx, 1);
      notify();
    }
  }
  function listPalettes() {
    return palettes.slice();
  }
  function notify() {
    for (const cb of Array.from(listeners)) {
      try {
        cb();
      } catch (err) {
        if (typeof console !== "undefined") {
          console.error("[wp-desktop-mode] palette-registry listener threw:", err);
        }
      }
    }
  }
  function cyclePalettes() {
    if (palettes.length === 0) {
      return;
    }
    const cur = palettes.findIndex((p) => {
      try {
        return p.isOpen();
      } catch {
        return false;
      }
    });
    if (cur === -1) {
      try {
        palettes[0].open();
      } catch {
      }
      return;
    }
    try {
      palettes[cur].close();
    } catch {
    }
    const next = cur + 1;
    if (next < palettes.length) {
      try {
        palettes[next].open();
      } catch {
      }
    }
  }
  function openPaletteOnly(id) {
    const target = palettes.find((p) => p.id === id);
    if (!target) {
      return;
    }
    for (const p of palettes) {
      if (p.id !== id) {
        try {
          if (p.isOpen()) {
            p.close();
          }
        } catch {
        }
      }
    }
    try {
      target.open();
    } catch {
    }
  }
  let installed = false;
  function installPaletteShortcut() {
    if (installed) {
      return;
    }
    installed = true;
    document.addEventListener(
      "keydown",
      (e) => {
        if (!(e.metaKey || e.ctrlKey) || e.key !== "k") {
          return;
        }
        if (e.shiftKey || e.altKey) {
          return;
        }
        e.preventDefault();
        cyclePalettes();
      },
      true
    );
    const origin = window.location.origin;
    window.addEventListener("message", (e) => {
      if (e.origin !== origin) {
        return;
      }
      const data = e.data;
      if (data && data.type === "wp-desktop-palette-cycle") {
        cyclePalettes();
      }
    });
  }
  const clock = {
    id: "clock",
    // Labels/descriptions on built-in defs stay string-literal at
    // module-eval time so the extract-pot pass picks them up. The
    // values are wrapped in `__()` so they translate at runtime.
    get label() {
      return __("Clock");
    },
    get description() {
      return __("Local time and date, refreshed every second.");
    },
    icon: "dashicons-clock",
    mount: (container) => {
      container.classList.add("wp-desktop-widget-clock");
      const time = document.createElement("div");
      time.className = "wp-desktop-widget-clock__time";
      container.appendChild(time);
      const date = document.createElement("div");
      date.className = "wp-desktop-widget-clock__date";
      container.appendChild(date);
      const render2 = () => {
        const now = /* @__PURE__ */ new Date();
        time.textContent = now.toLocaleTimeString(void 0, {
          hour: "2-digit",
          minute: "2-digit"
        });
        date.textContent = now.toLocaleDateString(void 0, {
          weekday: "long",
          month: "short",
          day: "numeric"
        });
      };
      render2();
      const msUntilNextSecond = 1e3 - Date.now() % 1e3;
      let interval = null;
      const kickoff = window.setTimeout(() => {
        render2();
        interval = window.setInterval(render2, 1e3);
      }, msUntilNextSecond);
      return () => {
        window.clearTimeout(kickoff);
        if (interval !== null) {
          window.clearInterval(interval);
        }
      };
    }
  };
  function registerBuiltInWidgets() {
    register(clock);
  }
  function createWidgetRegistrySync(deps) {
    const { layer } = deps;
    const registered = /* @__PURE__ */ new Set();
    const loadedScripts = /* @__PURE__ */ new Set();
    const ensureScript = async (entry) => {
      if (!entry.scriptUrl || loadedScripts.has(entry.scriptUrl)) {
        return;
      }
      try {
        await loadVendorScript(entry.scriptUrl);
      } catch (err) {
        doAction(HOOKS.SHELL_ERROR, {
          scope: "widget-script-load",
          id: entry.id,
          error: err
        });
      }
      loadedScripts.add(entry.scriptUrl);
    };
    const buildDefFromEntry = (entry) => {
      const globals = window.wpDesktopWidgets || {};
      const mount = globals[entry.id];
      if (!mount) {
        doAction(HOOKS.SHELL_ERROR, {
          scope: "widget-missing-mount",
          id: entry.id,
          error: new Error(
            `[wp-desktop-mode] No mount callback on window.wpDesktopWidgets["${entry.id}"]. Plugin script loaded but didn't register. Check the plugin's enqueue + global assignment.`
          )
        });
        return null;
      }
      return {
        id: entry.id,
        label: entry.label,
        description: entry.description,
        icon: entry.icon,
        movable: entry.movable,
        resizable: entry.resizable,
        minWidth: entry.minWidth || void 0,
        minHeight: entry.minHeight || void 0,
        maxWidth: entry.maxWidth || void 0,
        maxHeight: entry.maxHeight || void 0,
        defaultWidth: entry.defaultWidth || void 0,
        defaultHeight: entry.defaultHeight || void 0,
        mount
      };
    };
    const registerEntry = async (entry) => {
      if (registered.has(entry.id)) {
        return;
      }
      await ensureScript(entry);
      const def = buildDefFromEntry(entry);
      if (!def) {
        return;
      }
      register(def);
      registered.add(entry.id);
      refreshWidgetPicker();
      if (layer) {
        layer.mountIfEnabled(entry.id);
      }
    };
    const unregisterEntry = (id) => {
      if (!registered.has(id)) {
        return;
      }
      layer?.unmount(id);
      unregister(id);
      registered.delete(id);
      refreshWidgetPicker();
    };
    return async (list) => {
      const incoming = /* @__PURE__ */ new Set();
      for (const entry of list) {
        incoming.add(entry.id);
      }
      for (const id of Array.from(registered)) {
        if (!incoming.has(id)) {
          unregisterEntry(id);
        }
      }
      for (const entry of list) {
        if (!registered.has(entry.id)) {
          await registerEntry(entry);
        }
      }
    };
  }
  const CONFIG = {
    /** Grid stride when sampling the logo PNG. Smaller → denser particle field → heavier frame cost. */
    sampleStride: 7,
    /** Alpha threshold (0–255) for "this pixel is part of the logo." */
    alphaThreshold: 128,
    /**
     * Target logo rendering width in CSS pixels. Capped at this value
     * on huge screens; on normal screens we take 72% of the smaller
     * shell axis so the logo reads as "hero-sized" without cropping.
     */
    targetLogoWidth: 1e3,
    /** Fraction of the smaller shell dimension the logo is allowed to occupy. */
    logoShellFraction: 0.72,
    /**
     * Spring stiffness — how hard a particle pulls back to its home.
     * Lower = slower, floatier return. At 0.015 the natural-frequency
     * period is ~50 frames (~0.85 s at 60 fps), so particles visibly
     * drift back after a cursor flick rather than snapping home.
     */
    springK: 0.015,
    /** Velocity damping per tick. 1 = no damping, 0 = instant stop. */
    damping: 0.86,
    /**
     * Velocity floor below which a particle is considered at rest —
     * its position snaps to its home and its velocity zeroes out. Kills
     * the subpixel jitter that made the resting logo flicker.
     */
    restVelocityEpsilon: 0.02,
    /**
     * Sand-drag brush radius in CSS pixels. Particles within this
     * distance of the cursor pick up a fraction of the cursor's
     * per-frame displacement — they're carried in the direction the
     * cursor is moving, not pushed away from its position. Beyond
     * the radius the cursor has no effect.
     */
    dragRadius: 150,
    /**
     * Base fraction of the cursor's per-frame displacement that a
     * particle inherits when it's at the dead center of the brush.
     * At 0.22 a particle in the brush core picks up roughly a
     * quarter of the cursor's velocity per frame — enough to read
     * as "dragged" without the particles chasing the cursor.
     */
    dragStrength: 0.22,
    /**
     * Super-linear speed boost. For every {@link dragBoostRefSpeed}
     * pixels-per-frame of cursor speed, the applied drag force is
     * additionally scaled by this factor. Kept gentle (0.3) so fast
     * flicks feel a bit punchier than linear without flinging
     * particles across the screen.
     */
    dragBoost: 0.3,
    /** Reference cursor speed for the boost curve (CSS px / frame). */
    dragBoostRefSpeed: 40,
    /**
     * Cap on the mouse delta a single frame can accumulate. Prevents
     * a wild delta from a stale pointer (e.g. first pointermove after
     * the cursor entered from offscreen) from launching particles
     * into orbit. A real fast mouse rarely exceeds 80 px/frame.
     */
    maxMouseDelta: 80,
    /**
     * Radial-gradient brush texture size. Larger = smoother edges at
     * the cost of texture memory. 128px is plenty — sprites scale
     * down to 10–30 px range for rendering so we have headroom.
     */
    brushSize: 128,
    /** Min/max sprite scale relative to the brush texture size. */
    spriteScaleMin: 0.1,
    spriteScaleMax: 0.26,
    /** Min/max per-particle alpha. */
    spriteAlphaMin: 0.55,
    spriteAlphaMax: 0.92
  };
  const PARTICLE_PALETTE = [
    // Rainbow six (higher weight — the flag's main body).
    16726843,
    16726843,
    // red
    16747562,
    16747562,
    // orange
    16767293,
    16767293,
    // yellow
    5036388,
    5036388,
    // green
    4104447,
    4104447,
    // blue
    11037695,
    11037695,
    // purple
    // Trans flag stripes.
    16757703,
    // pink
    8380415,
    // light blue
    16777215,
    // white
    // POC inclusion stripe.
    13140042
    // warm brown (boosted for visibility under additive)
  ];
  const BACKDROP_CSS = "radial-gradient(circle at 50% 50%, #1e40af 0%, #152a6b 45%, #0a1024 100%)";
  async function mountScene({ container, logoUrl, prefersReducedMotion: prefersReducedMotion2 }) {
    const pixi = window.PIXI;
    if (!pixi) {
      throw new Error(
        "[animated-logo-wallpaper] window.PIXI is undefined; declare `needs: ['pixijs']` on the wallpaper def so the shell loads it before mount."
      );
    }
    const homes = await sampleLogoHomes(logoUrl);
    const priorBackground = container.style.background;
    container.style.background = BACKDROP_CSS;
    const app = new pixi.Application();
    await app.init({
      resizeTo: container,
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2)
    });
    container.appendChild(app.canvas);
    applyCanvasLayout(app.canvas);
    const brushTexture = buildBrushTexture(pixi);
    const particleLayer = new pixi.Container();
    app.stage.addChild(particleLayer);
    const n = homes.length;
    const homeX = new Float32Array(n);
    const homeY = new Float32Array(n);
    const x = new Float32Array(n);
    const y = new Float32Array(n);
    const vx = new Float32Array(n);
    const vy = new Float32Array(n);
    const sprites = new Array(n);
    for (let i = 0; i < n; i++) {
      const sprite = new pixi.Sprite(brushTexture);
      sprite.anchor.set(0.5);
      sprite.blendMode = "add";
      sprite.tint = PARTICLE_PALETTE[Math.floor(Math.random() * PARTICLE_PALETTE.length)];
      const scale = CONFIG.spriteScaleMin + Math.random() * (CONFIG.spriteScaleMax - CONFIG.spriteScaleMin);
      sprite.scale.set(scale);
      sprite.alpha = CONFIG.spriteAlphaMin + Math.random() * (CONFIG.spriteAlphaMax - CONFIG.spriteAlphaMin);
      particleLayer.addChild(sprite);
      sprites[i] = sprite;
    }
    let logoScale = 1;
    let logoOffsetX = 0;
    let logoOffsetY = 0;
    const computeLayout = () => {
      const w = app.canvas.clientWidth;
      const h = app.canvas.clientHeight;
      const target = Math.min(
        CONFIG.targetLogoWidth,
        Math.min(w, h) * CONFIG.logoShellFraction
      );
      logoScale = target;
      logoOffsetX = (w - target) / 2;
      logoOffsetY = (h - target) / 2;
      for (let i = 0; i < n; i++) {
        homeX[i] = logoOffsetX + homes[i][0] * logoScale;
        homeY[i] = logoOffsetY + homes[i][1] * logoScale;
        if (x[i] === 0 && y[i] === 0) {
          x[i] = homeX[i];
          y[i] = homeY[i];
        }
      }
    };
    computeLayout();
    const resizeObserver = new ResizeObserver(() => computeLayout());
    resizeObserver.observe(container);
    let pointerX = -1e6;
    let pointerY = -1e6;
    let pointerActive = false;
    let mouseDx = 0;
    let mouseDy = 0;
    const onPointerMove = (e) => {
      const rect = app.canvas.getBoundingClientRect();
      const nx = e.clientX - rect.left;
      const ny = e.clientY - rect.top;
      if (pointerActive) {
        const rawDx = nx - pointerX;
        const rawDy = ny - pointerY;
        const cap = CONFIG.maxMouseDelta;
        mouseDx += Math.max(-cap, Math.min(cap, rawDx));
        mouseDy += Math.max(-cap, Math.min(cap, rawDy));
      }
      pointerX = nx;
      pointerY = ny;
      pointerActive = true;
    };
    const onPointerLeave = () => {
      pointerX = -1e6;
      pointerY = -1e6;
      pointerActive = false;
      mouseDx = 0;
      mouseDy = 0;
    };
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerleave", onPointerLeave);
    let animating = !prefersReducedMotion2;
    const syncSprites = () => {
      for (let i = 0; i < n; i++) {
        sprites[i].x = x[i];
        sprites[i].y = y[i];
      }
    };
    const tick = () => {
      if (animating) {
        step(
          n,
          homeX,
          homeY,
          x,
          y,
          vx,
          vy,
          pointerX,
          pointerY,
          pointerActive ? mouseDx : 0,
          pointerActive ? mouseDy : 0
        );
      }
      mouseDx = 0;
      mouseDy = 0;
      syncSprites();
    };
    app.ticker.add(tick);
    syncSprites();
    if (!animating) {
      app.renderer.render(app.stage);
      app.ticker.stop();
    }
    return {
      destroy() {
        resizeObserver.disconnect();
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerleave", onPointerLeave);
        app.destroy(true, {
          children: true,
          texture: true,
          textureSource: true,
          context: true
        });
        try {
          brushTexture.destroy(true);
        } catch {
        }
        container.style.background = priorBackground;
      },
      setAnimating(playing) {
        animating = playing && !prefersReducedMotion2;
        if (animating) {
          app.ticker.start();
        } else {
          app.ticker.stop();
        }
      }
    };
  }
  function step(n, homeX, homeY, x, y, vx, vy, pointerX, pointerY, mouseDx, mouseDy) {
    const {
      springK,
      damping,
      dragRadius,
      dragStrength,
      dragBoost,
      dragBoostRefSpeed,
      restVelocityEpsilon
    } = CONFIG;
    const dragRadiusSq = dragRadius * dragRadius;
    const restEpsSq = restVelocityEpsilon * restVelocityEpsilon;
    const restPosEps = 0.25;
    const restPosEpsSq = restPosEps * restPosEps;
    const mouseSpeed = Math.sqrt(mouseDx * mouseDx + mouseDy * mouseDy);
    const speedMultiplier = 1 + mouseSpeed / dragBoostRefSpeed * dragBoost;
    const dragFx = mouseDx * dragStrength * speedMultiplier;
    const dragFy = mouseDy * dragStrength * speedMultiplier;
    const cursorMoving = mouseDx !== 0 || mouseDy !== 0;
    for (let i = 0; i < n; i++) {
      const dhx = homeX[i] - x[i];
      const dhy = homeY[i] - y[i];
      let fx = dhx * springK;
      let fy = dhy * springK;
      const dx = x[i] - pointerX;
      const dy = y[i] - pointerY;
      const distSq = dx * dx + dy * dy;
      let disturbed = false;
      if (cursorMoving && distSq < dragRadiusSq) {
        const t = 1 - Math.sqrt(distSq) / dragRadius;
        const falloff = t * t;
        fx += dragFx * falloff;
        fy += dragFy * falloff;
        disturbed = true;
      }
      const nvx = (vx[i] + fx) * damping;
      const nvy = (vy[i] + fy) * damping;
      if (!disturbed && nvx * nvx + nvy * nvy < restEpsSq && dhx * dhx + dhy * dhy < restPosEpsSq) {
        x[i] = homeX[i];
        y[i] = homeY[i];
        vx[i] = 0;
        vy[i] = 0;
        continue;
      }
      vx[i] = nvx;
      vy[i] = nvy;
      x[i] += nvx;
      y[i] += nvy;
    }
  }
  function buildBrushTexture(pixi) {
    const size = CONFIG.brushSize;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("[animated-logo-wallpaper] 2D canvas context unavailable.");
    }
    const center = size / 2;
    const gradient = ctx.createRadialGradient(
      center,
      center,
      0,
      center,
      center,
      center
    );
    gradient.addColorStop(0, "rgba(255, 255, 255, 1)");
    gradient.addColorStop(0.18, "rgba(255, 255, 255, 0.85)");
    gradient.addColorStop(0.42, "rgba(255, 255, 255, 0.28)");
    gradient.addColorStop(0.75, "rgba(255, 255, 255, 0.06)");
    gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    return pixi.Texture.from(canvas);
  }
  async function sampleLogoHomes(url) {
    const img = await loadImage(url);
    const maxSide = 400;
    const ratio = img.naturalWidth / img.naturalHeight;
    const sampleWidth = ratio >= 1 ? maxSide : Math.round(maxSide * ratio);
    const sampleHeight = ratio >= 1 ? Math.round(maxSide / ratio) : maxSide;
    const off = document.createElement("canvas");
    off.width = sampleWidth;
    off.height = sampleHeight;
    const ctx = off.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      return [];
    }
    ctx.drawImage(img, 0, 0, sampleWidth, sampleHeight);
    const data = ctx.getImageData(0, 0, sampleWidth, sampleHeight).data;
    const homes = [];
    const stride = CONFIG.sampleStride;
    const threshold = CONFIG.alphaThreshold;
    for (let row = 0; row < sampleHeight; row += stride) {
      const rowOffset = row / stride % 2 === 0 ? 0 : stride / 2;
      for (let col = 0; col < sampleWidth; col += stride) {
        const px = Math.min(sampleWidth - 1, Math.round(col + rowOffset));
        const py = row;
        const alpha = data[(py * sampleWidth + px) * 4 + 3];
        if (alpha > threshold) {
          homes.push([px / sampleWidth, py / sampleHeight]);
        }
      }
    }
    return homes;
  }
  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Failed to load logo: ${url}`));
      img.src = url;
    });
  }
  function applyCanvasLayout(canvas) {
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
  }
  const WALLPAPER_ID = "wp-animated-logo";
  const NAMESPACE = "wp-desktop-mode/animated-logo";
  const PREVIEW = "radial-gradient(circle at 50% 50%, #1e3a8a 0%, #0b0f25 100%)";
  addAction(
    HOOKS.INIT,
    NAMESPACE,
    () => {
      const api = window.wp?.desktop;
      if (!api || typeof api.registerWallpaper !== "function") {
        return;
      }
      api.registerWallpaper({
        id: WALLPAPER_ID,
        label: "Animated WordPress Logo",
        type: "canvas",
        preview: PREVIEW,
        needs: ["pixijs"],
        mount: async (container, ctx) => {
          const logoUrl = `${ctx.pluginUrl}/assets/images/wp-logo.png`;
          const scene = await mountScene({
            container,
            logoUrl,
            prefersReducedMotion: ctx.prefersReducedMotion
          });
          const visibilityHandler = (...args) => {
            const detail = args[0];
            if (!detail || detail.id !== WALLPAPER_ID) {
              return;
            }
            scene.setAnimating(detail.state === "visible");
          };
          api.hooks.addAction(
            HOOKS.WALLPAPER_VISIBILITY,
            `${NAMESPACE}/visibility`,
            visibilityHandler
          );
          return () => {
            api.hooks.removeAction(
              HOOKS.WALLPAPER_VISIBILITY,
              `${NAMESPACE}/visibility`
            );
            scene.destroy();
          };
        }
      });
    }
  );
  const INITIAL_ORIGIN = window.location.origin;
  const OS_SETTINGS_WINDOW_ID = "wp-desktop-os-settings";
  const SESSION_SAVE_DEBOUNCE_MS = 500;
  const VIEWPORT_CLAMP_MARGIN = 12;
  function init() {
    const config = window.wpDesktopConfig;
    if (!config) {
      return;
    }
    const desktopArea = document.getElementById("wp-desktop-area");
    if (!desktopArea) {
      return;
    }
    const manager = new WindowManager(desktopArea);
    const wallpaperEl = document.getElementById("wp-desktop-wallpaper");
    const pluginUrl = config.pluginUrl || "";
    let wallpaperLayer = null;
    if (wallpaperEl) {
      wallpaperLayer = new WallpaperLayer(wallpaperEl, pluginUrl);
    }
    const widgetsEl = document.getElementById("wp-desktop-widgets");
    let widgetLayer = null;
    registerBuiltInWidgets();
    if (widgetsEl) {
      widgetLayer = new WidgetLayer(widgetsEl, pluginUrl);
    }
    registerModule({
      id: "pixijs",
      url: `${pluginUrl}/assets/vendor/pixi.min.js`,
      isReady: () => typeof window.PIXI !== "undefined"
    });
    const osSettings = new OsSettings(
      {
        mediaUrl: config.mediaUrl,
        restNonce: config.restNonce,
        canUpload: !!config.canUpload,
        isAdmin: !!config.currentUserIsAdmin,
        aiPlatformSettings: config.aiPlatformSettings ?? null,
        aiPlatformSettingsUrl: config.aiPlatformSettingsUrl ?? "",
        extendedOptions: config.extendedOptions ?? null,
        extendedOptionsUrl: config.extendedOptionsUrl ?? ""
      },
      wallpaperLayer ?? new WallpaperLayer(document.createElement("div"), pluginUrl)
    );
    osSettings.apply();
    const aiAssistant = new AiAssistant({
      aiSearchUrl: config.aiSearchUrl ?? "",
      aiSearchStreamUrl: config.aiSearchStreamUrl ?? "",
      restNonce: config.restNonce
    });
    const dragBridge = new DragBridge();
    registerPalette({
      id: "wp-desktop-ai-assistant",
      label: "AI Assistant",
      open: () => aiAssistant.open(),
      close: () => aiAssistant.close(),
      isOpen: () => aiAssistant.isOpen
    });
    installPaletteShortcut();
    document.addEventListener("wp-desktop-open-ai", () => {
      openPaletteOnly("wp-desktop-ai-assistant");
    });
    const dockEl = document.getElementById("wp-desktop-dock");
    let dock = null;
    if (dockEl && config.dockItems) {
      dock = new Dock(dockEl, manager, config.dockItems, config.adminUrl, "left");
      desktopArea.classList.add("wp-desktop-area--with-dock");
      dock.appendSystemItem({
        id: OS_SETTINGS_WINDOW_ID,
        title: "OS Settings",
        icon: "dashicons-desktop",
        // "Open" for the dock dot means "open on the currently
        // active desktop." OS Settings on another desktop
        // shouldn't paint the dot on the active view.
        isOpen: () => {
          const win = manager.getById(OS_SETTINGS_WINDOW_ID);
          if (!win) {
            return false;
          }
          return (win.config.desktopId || manager.getActiveDesktopId()) === manager.getActiveDesktopId();
        },
        onOpen: () => {
          manager.open({
            id: OS_SETTINGS_WINDOW_ID,
            baseId: OS_SETTINGS_WINDOW_ID,
            url: "#os-settings",
            title: "OS Settings",
            icon: "dashicons-desktop",
            native: true,
            render: (body) => osSettings.renderPanel(body),
            // Sized to comfortably fit three wallpaper swatches
            // across plus the media-library grid showing 5–6
            // thumbnails per row — smaller defaults forced the
            // sections into a single narrow column.
            width: 820,
            height: 720,
            minWidth: 560,
            minHeight: 480
          });
        }
      });
    }
    const taskbarEl = document.getElementById("wp-desktop-taskbar");
    let taskbar = null;
    if (taskbarEl) {
      const initialTaskbarItems = Array.isArray(config.taskbarItems) ? config.taskbarItems : [];
      taskbar = new Dock(
        taskbarEl,
        manager,
        initialTaskbarItems,
        config.adminUrl,
        "bottom"
      );
      taskbarEl.hidden = initialTaskbarItems.length === 0;
      if (initialTaskbarItems.length > 0) {
        desktopArea.classList.add("wp-desktop-area--with-taskbar");
      }
    }
    const hasSession = !!(config.session && config.session.windows && config.session.windows.length > 0);
    if (hasSession) {
      restoreSession(manager, config, desktopArea);
    }
    const defaultEnabled = config.defaultWindow?.enabled !== false;
    const suppressAutoOpen = config.fromPortal && (hasSession || !defaultEnabled);
    if (!suppressAutoOpen) {
      openCurrentPage(manager, config);
    }
    const saveSession = createSessionSaver(manager, config);
    wireSessionEvents(saveSession);
    const setDefaultWindow = async (url) => {
      try {
        const response = await fetch(config.defaultWindowUrl, {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            "X-WP-Nonce": config.restNonce
          },
          body: JSON.stringify({ url })
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        config.defaultWindow = data;
        document.dispatchEvent(
          new CustomEvent("wp-desktop-default-window-changed", {
            detail: data
          })
        );
      } catch (err) {
        doAction(HOOKS.SHELL_ERROR, { scope: "default-window-save", error: err });
        if (typeof console !== "undefined") {
          console.error(
            "[wp-desktop-mode] Failed to save default window:",
            err
          );
        }
      }
    };
    manager.onToggleStartupRequested = (win) => {
      const currentPref = config.defaultWindow;
      const winUrl = win.getCurrentUrl();
      const alreadyDefault = !!currentPref?.enabled && urlMatchKey(currentPref.url) === urlMatchKey(winUrl);
      void setDefaultWindow(alreadyDefault ? null : winUrl);
    };
    const placeSystemTile = (item, placement) => {
      if (placement === "dock") {
        dock?.appendSystemItem(item);
        return "dock";
      }
      if (!taskbar) {
        dock?.appendSystemItem(item);
        return "dock";
      }
      taskbar.appendSystemItem(item);
      if (taskbarEl && taskbarEl.hidden) {
        taskbarEl.hidden = false;
        desktopArea.classList.add("wp-desktop-area--with-taskbar");
      }
      return "taskbar";
    };
    const syncNativeWindows = createNativeWindowSync({
      manager,
      dock,
      taskbar,
      taskbarEl,
      desktopArea
    });
    void syncNativeWindows(
      Array.isArray(config.nativeWindows) ? config.nativeWindows : []
    );
    const syncServerWidgets = createWidgetRegistrySync({
      layer: widgetLayer
    });
    void syncServerWidgets(
      Array.isArray(config.serverWidgets) ? config.serverWidgets : []
    );
    const syncServerWallpapers = createWallpaperRegistrySync({
      osSettings
    });
    void syncServerWallpapers(
      Array.isArray(config.serverWallpapers) ? config.serverWallpapers : []
    );
    const syncServerCommands = createCommandRegistrySync();
    void syncServerCommands(
      Array.isArray(config.serverCommandScripts) ? config.serverCommandScripts : [],
      Array.isArray(config.serverCommands) ? config.serverCommands : []
    );
    const registerWindow = createRegisterWindow(manager);
    const openRegisteredNativeWindow = (id) => {
      const def = Array.isArray(config.nativeWindows) ? config.nativeWindows.find((w) => w.id === id) : null;
      if (!def) {
        return false;
      }
      registerWindow({
        id: def.id,
        title: def.title,
        icon: def.icon,
        width: def.width,
        height: def.height,
        minWidth: def.minWidth,
        minHeight: def.minHeight,
        autofocus: def.autofocus,
        render: (body) => {
          const nativeRegistry = window.wpDesktopNativeWindows;
          const render2 = nativeRegistry?.[def.id];
          if (render2) {
            render2(body);
          }
        }
      });
      return true;
    };
    if (Array.isArray(config.desktopIcons) && config.desktopIcons.length > 0) {
      renderDesktopIcons(desktopArea, config.desktopIcons, {
        openWindow: openRegisteredNativeWindow,
        manager
      });
    }
    const refreshMenu = bindMenuRefresh(
      dock,
      taskbar,
      taskbarEl,
      desktopArea,
      config,
      syncNativeWindows,
      syncServerWidgets,
      syncServerWallpapers,
      syncServerCommands
    );
    window.wp = window.wp || {};
    window.wp.desktop = {
      windowManager: manager,
      dock,
      taskbar,
      saveSession,
      hooks: rawHooks(),
      HOOKS,
      isActive: () => !!document.getElementById("wp-desktop-shell"),
      registerWallpaper: (def) => {
        register$1(def);
        osSettings.apply();
      },
      registerWidget: (def) => {
        register(def);
      },
      widgetLayer,
      loadVendorScript,
      getWallpaperSurfaces: () => collectWallpaperSurfaces(manager),
      registerWindow,
      cloneTemplate,
      onWindow,
      registerSystemTile: (item, placement = "taskbar") => {
        const resolved = placeSystemTile(item, placement);
        doAction(HOOKS.DOCK_ITEM_APPENDED, { id: item.id, placement: resolved });
        return resolved;
      },
      registerModule,
      loadModules,
      whenReady,
      isReady,
      setDefaultWindow,
      refreshMenu,
      config,
      ai: aiAssistant,
      dragBridge,
      registerCommand,
      unregisterCommand,
      listCommands,
      registerPalette,
      unregisterPalette,
      listPalettes,
      openPalette: openPaletteOnly
    };
    doAction(HOOKS.COMPONENTS_REGISTERED, { tags: [...WPD_COMPONENT_TAGS] });
    registerBuiltInCommands();
    doAction(HOOKS.INIT, { config });
    osSettings.apply();
    widgetLayer?.hydrate();
    window.addEventListener("pagehide", () => {
      wallpaperLayer?.teardownActive();
      widgetLayer?.disposeAll();
    });
    bindShellLifecycle();
    bindTopWindowLinkInterceptor(manager, config);
    desktopArea.addEventListener("click", (e) => {
      if (e.target !== desktopArea) {
        return;
      }
      if (desktopArea.classList.contains("wp-desktop-area--overview")) {
        return;
      }
      const windows = manager.getAll();
      const allMinimized = windows.length > 0 && windows.every((w) => w.state === "minimized");
      if (allMinimized) {
        for (const win of windows) {
          win.restore();
        }
      } else {
        for (const win of windows) {
          if (win.state !== "minimized") {
            win.minimize();
          }
        }
      }
    });
    document.dispatchEvent(
      new CustomEvent("wp-desktop-init", {
        detail: { config, restored: hasSession }
      })
    );
  }
  function restoreSession(manager, config, desktopArea) {
    const rect = desktopArea.getBoundingClientRect();
    if (Array.isArray(config.session.desktops) && config.session.desktops.length > 0) {
      manager.seedDesktops(
        config.session.desktops,
        config.session.activeDesktop || config.session.desktops[0].id
      );
    }
    for (const win of config.session.windows) {
      const clamped = clampGeometryToViewport(win, rect);
      const dockEntry = findDockEntryForUrl(win.url, config);
      const opened = manager.open({
        id: win.id,
        baseId: win.baseId || win.id,
        desktopId: win.desktopId,
        multi: !!dockEntry?.multi,
        url: win.url,
        title: win.title,
        icon: win.icon || "dashicons-admin-generic",
        x: clamped.x,
        y: clamped.y,
        width: clamped.width,
        height: clamped.height,
        initialState: win.state,
        submenu: dockEntry?.submenu
      });
      if (Array.isArray(win.externalTabs)) {
        for (const ext of win.externalTabs) {
          if (ext && typeof ext.url === "string" && ext.url !== "") {
            opened.addExternalTab(
              ext.url,
              typeof ext.label === "string" && ext.label !== "" ? ext.label : ext.url
            );
          }
        }
      }
    }
    if (config.session.focused) {
      const focused = manager.getById(config.session.focused);
      if (focused) {
        manager.focus(focused);
      }
    }
  }
  function openCurrentPage(manager, config) {
    const windowId = deriveWindowId(config.currentPage, config.adminUrl);
    const dockEntry = findDockEntryForUrl(config.currentPage, config);
    manager.open({
      id: windowId,
      baseId: windowId,
      multi: !!dockEntry?.multi,
      url: config.currentPage,
      title: config.currentTitle,
      icon: config.currentIcon,
      submenu: dockEntry?.submenu
    });
  }
  function bindTopWindowLinkInterceptor(manager, config) {
    document.addEventListener(
      "click",
      (e) => {
        if (e.defaultPrevented) {
          return;
        }
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
          return;
        }
        const target = e.target;
        const link = target && target.closest ? target.closest("a[href]") : null;
        if (!link) {
          return;
        }
        const anchor = link;
        const linkTarget = anchor.getAttribute("target");
        if (linkTarget && linkTarget !== "" && linkTarget !== "_self") {
          return;
        }
        if (anchor.hasAttribute("download")) {
          return;
        }
        const rawHref = anchor.getAttribute("href");
        if (!rawHref || rawHref.charAt(0) === "#") {
          return;
        }
        if (/^(mailto:|tel:|javascript:|data:)/i.test(rawHref)) {
          return;
        }
        let url;
        try {
          url = new URL(rawHref, window.location.href);
        } catch (err) {
          if (typeof console !== "undefined") {
            console.warn(
              "[wp-desktop-mode] Couldn’t parse href; letting the browser handle the click:",
              rawHref,
              err
            );
          }
          return;
        }
        if (url.origin !== INITIAL_ORIGIN) {
          return;
        }
        let adminPath;
        try {
          adminPath = new URL(config.adminUrl).pathname;
        } catch (err) {
          if (typeof console !== "undefined") {
            console.error(
              "[wp-desktop-mode] config.adminUrl is not a valid URL; falling back to /wp-admin/:",
              config.adminUrl,
              err
            );
          }
          adminPath = "/wp-admin/";
        }
        if (!url.pathname.startsWith(adminPath)) {
          return;
        }
        if (/\/(admin-post|admin-ajax)\.php$/.test(url.pathname)) {
          return;
        }
        if (url.searchParams.has("action") && url.searchParams.get("action") === "logout") {
          return;
        }
        if (url.searchParams.has("wp_desktop_classic")) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        const windowId = deriveWindowId(url.href, config.adminUrl);
        const dockEntry = findDockEntryForUrl(url.href, config);
        const fallbackTitle = (anchor.textContent || "").trim() || dockEntry?.title || "";
        manager.open({
          id: windowId,
          baseId: windowId,
          multi: !!dockEntry?.multi,
          url: url.href,
          title: dockEntry?.title || fallbackTitle,
          icon: dockEntry?.icon || "dashicons-admin-generic",
          submenu: dockEntry?.submenu
        });
      },
      true
    );
  }
  function findDockEntryForUrl(url, config) {
    const windowId = deriveWindowId(url, config.adminUrl);
    return (config.dockItems || []).find(
      (i) => deriveWindowId(i.url, config.adminUrl) === windowId || (i.submenu || []).some(
        (s) => deriveWindowId(s.url, config.adminUrl) === windowId
      )
    );
  }
  function clampGeometryToViewport(win, rect) {
    const maxW = Math.max(200, rect.width - VIEWPORT_CLAMP_MARGIN * 2);
    const maxH = Math.max(200, rect.height - VIEWPORT_CLAMP_MARGIN * 2);
    const width = Math.min(win.width, maxW);
    const height = Math.min(win.height, maxH);
    const maxX = Math.max(0, rect.width - width - VIEWPORT_CLAMP_MARGIN);
    const maxY = Math.max(0, rect.height - height - VIEWPORT_CLAMP_MARGIN);
    const x = Math.max(VIEWPORT_CLAMP_MARGIN, Math.min(win.x, maxX));
    const y = Math.max(VIEWPORT_CLAMP_MARGIN, Math.min(win.y, maxY));
    return { x, y, width, height };
  }
  function createSessionSaver(manager, config) {
    let debounceTimer = null;
    let inFlight = false;
    const doSave = async () => {
      if (inFlight) {
        return;
      }
      const payload = manager.snapshot();
      inFlight = true;
      try {
        await fetch(config.sessionUrl, {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            "X-WP-Nonce": config.restNonce
          },
          body: JSON.stringify({ session: payload }),
          // Best-effort: we don't block the UI on persistence.
          keepalive: true
        });
      } catch (err) {
        doAction(HOOKS.SHELL_ERROR, { scope: "session-save", error: err });
      } finally {
        inFlight = false;
      }
    };
    const flushImmediately = () => {
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      const payload = manager.snapshot();
      const body = new Blob(
        [JSON.stringify({ session: payload })],
        { type: "application/json" }
      );
      const beaconUrl = config.sessionUrl + (config.sessionUrl.includes("?") ? "&" : "?") + "_wpnonce=" + encodeURIComponent(config.restNonce);
      if (navigator.sendBeacon && navigator.sendBeacon(beaconUrl, body)) {
        return;
      }
      void doSave();
    };
    const schedule = () => {
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
      }
      debounceTimer = window.setTimeout(() => {
        debounceTimer = null;
        void doSave();
      }, SESSION_SAVE_DEBOUNCE_MS);
    };
    window.addEventListener("pagehide", flushImmediately);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        flushImmediately();
      }
    });
    return schedule;
  }
  function wireSessionEvents(save) {
    document.addEventListener("wp-desktop-window-opened", save);
    document.addEventListener("wp-desktop-window-closed", save);
    document.addEventListener("wp-desktop-window-focused", save);
    document.addEventListener("wp-desktop-window-changed", save);
  }
  const SHELL_RESIZE_DEBOUNCE_MS = 120;
  function bindShellLifecycle() {
    const shellEl = document.getElementById("wp-desktop-shell");
    let resizeTimer = null;
    const fireShellResize = () => {
      resizeTimer = null;
      const rect = shellEl ? shellEl.getBoundingClientRect() : null;
      doAction(HOOKS.SHELL_RESIZED, {
        width: rect ? Math.round(rect.width) : window.innerWidth,
        height: rect ? Math.round(rect.height) : window.innerHeight
      });
    };
    window.addEventListener("resize", () => {
      if (resizeTimer !== null) {
        window.clearTimeout(resizeTimer);
      }
      resizeTimer = window.setTimeout(fireShellResize, SHELL_RESIZE_DEBOUNCE_MS);
    });
    document.addEventListener("visibilitychange", () => {
      doAction(HOOKS.SHELL_VISIBILITY, {
        state: document.hidden ? "hidden" : "visible"
      });
    });
  }
  const MENU_REFRESH_DEBOUNCE_MS = 250;
  function bindMenuRefresh(dock, taskbar, taskbarEl, desktopArea, config, syncNativeWindows, syncServerWidgets, syncServerWallpapers, syncServerCommands) {
    const applyPayload = (payload) => {
      const dockItems = payload.dockItems;
      const taskbarItems = payload.taskbarItems;
      const nativeWindows = payload.nativeWindows;
      const serverWidgets = payload.serverWidgets;
      const serverWallpapers = payload.serverWallpapers;
      const serverCommandScripts = payload.serverCommandScripts;
      const serverCommands = payload.serverCommands;
      if (!Array.isArray(dockItems) || dockItems.length === 0) {
        return;
      }
      if (dock) {
        dock.replaceItems(dockItems);
        config.dockItems = dockItems;
      }
      if (Array.isArray(taskbarItems)) {
        taskbar?.replaceItems(
          taskbarItems
        );
        config.taskbarItems = taskbarItems;
        const hasAnyTaskbarTile = taskbar?.hasItems() ?? false;
        if (taskbarEl) {
          taskbarEl.hidden = !hasAnyTaskbarTile;
        }
        desktopArea.classList.toggle(
          "wp-desktop-area--with-taskbar",
          hasAnyTaskbarTile
        );
      }
      if (Array.isArray(nativeWindows)) {
        void syncNativeWindows(
          nativeWindows
        );
        config.nativeWindows = nativeWindows;
      }
      if (Array.isArray(serverWidgets)) {
        void syncServerWidgets(
          serverWidgets
        );
        config.serverWidgets = serverWidgets;
      }
      if (Array.isArray(serverWallpapers)) {
        void syncServerWallpapers(
          serverWallpapers
        );
        config.serverWallpapers = serverWallpapers;
      }
      if (Array.isArray(serverCommandScripts)) {
        void syncServerCommands(
          serverCommandScripts,
          Array.isArray(serverCommands) ? serverCommands : void 0
        );
        config.serverCommandScripts = serverCommandScripts;
        if (Array.isArray(serverCommands)) {
          config.serverCommands = serverCommands;
        }
      }
    };
    const refresh = async () => {
      if (!config.menuUrl) {
        return;
      }
      try {
        const res = await fetch(config.menuUrl, {
          method: "GET",
          credentials: "same-origin",
          headers: { "X-WP-Nonce": config.restNonce }
        });
        if (!res.ok) {
          return;
        }
        const data = await res.json();
        applyPayload(data);
      } catch (err) {
        doAction(HOOKS.SHELL_ERROR, { scope: "menu-refresh", error: err });
      }
    };
    let debounceTimer = null;
    window.addEventListener("message", (e) => {
      if (e.origin !== INITIAL_ORIGIN) {
        return;
      }
      const data = e.data;
      if (!data || data.type !== "wp-desktop-plugins-changed") {
        return;
      }
      if (data.payload) {
        applyPayload(data.payload);
        return;
      }
      if (!config.menuUrl) {
        return;
      }
      if (debounceTimer !== null) {
        window.clearTimeout(debounceTimer);
      }
      debounceTimer = window.setTimeout(() => {
        debounceTimer = null;
        void refresh();
      }, MENU_REFRESH_DEBOUNCE_MS);
    });
    return refresh;
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
  exports.clampGeometryToViewport = clampGeometryToViewport;
  Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
  return exports;
}({});
