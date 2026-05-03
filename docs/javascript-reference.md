# JavaScript Reference

The browser-side contract. Four layers:

1. **WordPress-style hooks** via `window.wp.hooks` — the primary extension surface.
2. **CustomEvents** dispatched on `document` in the parent shell — for shell-side plugins.
3. **`window.wp.desktop`** — the in-tree JS API for the WindowManager, Dock, and hook helpers.
4. **`postMessage`** bridge — typed messages between the parent shell and iframe windows.

Status labels match the [Hooks Reference](./hooks-reference.md): **Stable / Experimental / Planned**.

---

## 1. CustomEvents

All events bubble from `document`. The shell dispatches them; plugins listen.

### `wp-desktop-init` — Stable
Fires once, after the shell has initialized and before any session restoration completes. `detail.restored` is `true` if a saved session was restored; `false` for a fresh session.

```javascript
document.addEventListener( 'wp-desktop-init', ( e ) => {
    const { config, restored } = e.detail;
    console.log( 'Desktop up; restored?', restored );
} );
```

**`detail` shape:**

```typescript
{ config: DesktopConfig, restored: boolean }
```

---

### `wp-desktop-window-opened` — Stable
Fires every time a window is added to the stack — both fresh opens and session-restored windows.

```javascript
document.addEventListener( 'wp-desktop-window-opened', ( e ) => {
    const { windowId, page, title } = e.detail;
} );
```

**`detail` shape:**

```typescript
{ windowId: string, page: string, title: string }
```

---

### `wp-desktop-window-reopened` — Stable
Fires when `wp.desktop.openWindow(id)` (or `windowManager.open(...)`) is called for a `baseId` whose window already exists on the active desktop. The framework just focuses + restores the existing window — the render callback does NOT re-run, and `wp-desktop-window-opened` does NOT fire again. This event is the unambiguous "user requested an open while already open" signal — exactly once per `open()` call on an existing instance.

Plugins that hold per-window state (e.g. the code editor's active file) should listen here to re-orient the existing window's content to whatever the caller wants to show. The open call is synchronous, so any state the caller sets BEFORE invoking `openWindow` is already in place when this fires.

```javascript
document.addEventListener( 'wp-desktop-window-reopened', ( e ) => {
    if ( e.detail.windowId !== 'my-plugin/inbox' ) return;
    // Re-orient the window's main pane to whatever the caller
    // wanted to show.
    refreshFocusedItem();
} );
```

**`detail` shape:**

```typescript
{ windowId: string, baseId: string, wasMinimized: boolean }
```

`wasMinimized` reflects the state at the moment of the call, BEFORE the framework's automatic restore-from-minimized happens. Useful for animating "popped from the dock".

---

### `wp-desktop-window-content-loading` — Stable *(since 0.6.0)*

Fires every time a window enters the **loading** state — at construction (every window starts loading) and whenever a plugin calls `Window.markContentLoading()` or the native render context's `ctx.window.markLoading()` mid-life (e.g. before refetching data).

The shell paints a `<wpd-spinner>` overlay over the body while the window is loading and fades the body content out. The overlay's spinner is sized responsively (`clamp(96px, 14vw, 192px)`) so it scales with the window's width.

**Edge-triggered.** Idempotent calls don't re-fire — a plugin that calls `markLoading()` twice in a row sees the event exactly once.

```javascript
document.addEventListener( 'wp-desktop-window-content-loading', ( e ) => {
    if ( e.detail.windowId === 'my-plugin/inbox' ) {
        analytics.start( 'inbox-load' );
    }
} );
```

**`detail` shape:** `{ windowId: string }`

Companion `wp.hooks` action: `HOOKS.WINDOW_CONTENT_LOADING` (`wp-desktop.window.content-loading`).

---

### `wp-desktop-window-content-loaded` — Stable *(since 0.6.0)*

Fires when a window's body content becomes ready — for iframe windows the moment the chromeless bridge announces `wp-desktop-ready`, for native windows after the user's `render( body )` callback (or its returned Promise) resolves, and whenever a plugin calls `Window.markContentLoaded()` or `ctx.window.markReady()` mid-life. The shell removes the loading overlay and fades the body content in on this transition.

**Use this instead of branching on iframe vs. native.** The unified signal across both render strategies. Iframe-only consumers can still subscribe to `wp-desktop.iframe.ready`, which fires alongside this event for iframe windows.

**Edge-triggered.** Only fires on a loading → ready transition. A plugin that arms loading via `markContentLoading()` and then calls `markContentLoaded()` again will see a fresh event each cycle.

```javascript
document.addEventListener( 'wp-desktop-window-content-loaded', ( e ) => {
    if ( e.detail.windowId === 'my-plugin/inbox' ) {
        analytics.complete( 'inbox-load' );
    }
} );
```

**`detail` shape:** `{ windowId: string }`

Companion `wp.hooks` action: `HOOKS.WINDOW_CONTENT_LOADED` (`wp-desktop.window.content-loaded`).

---

### `wp-desktop-window-focused` — Stable
Fires when a window is focused (promoted to topmost z-index).

```javascript
document.addEventListener( 'wp-desktop-window-focused', ( e ) => {
    console.log( 'Focused', e.detail.windowId );
} );
```

**`detail` shape:** `{ windowId: string }`

---

### `wp-desktop-window-blurred` — Stable *(since 0.5.5)*

Fires on the window that **lost** focus when another window is promoted to topmost. Pairs with `wp-desktop-window-focused` for the symmetric "I am no longer the active window" signal — without this event, apps had to track focus transitions themselves to derive blur. Useful for badge policies, attention timers, and any "render differently when not active" UI.

```javascript
document.addEventListener( 'wp-desktop-window-blurred', ( e ) => {
    const { windowId, focusedTo } = e.detail;
    if ( windowId === 'my-app' ) {
        repaintBadge();
    }
} );
```

**`detail` shape:**

```typescript
{
    windowId:  string,            // the window that lost focus
    focusedTo: string | null,     // the window that took focus, or null
}
```

Companion `wp.hooks` action: `HOOKS.WINDOW_BLURRED` (`wp-desktop.window.blurred`).

---

### `wp-desktop-window-closing` — Stable
Fires when the user closes a window, BEFORE the outer element is detached from the DOM. Subscribers needing an element reference (wallpaper overlays anchored to specific windows, snow that has piled on the window top, measurement caches) should listen here rather than to `wp-desktop-window-closed` — by the time the `closed` handler runs the element may be mid-fade-out.

**`detail` shape:** `{ windowId: string, element: HTMLElement }`

---

### `wp-desktop-window-closed` — Stable
Fires after the window is removed from the stack and begins its closing animation. Payload intentionally minimal; use `wp-desktop-window-closing` above when you need the element reference.

**`detail` shape:** `{ windowId: string }`

---

### `wp-desktop-window-changed` — Experimental
Internal event used by the session saver. Fires for geometry changes (drag-end, resize-end) and state transitions (minimize, maximize, fullscreen, restore). Signature may change — prefer the per-operation events above for external use.

**`detail` shape:**

```typescript
{ windowId: string, reason: 'moved' | 'resized' | 'state', state: WindowState }
```

---

### `wp-desktop-presence-changed` — Stable *(since 0.5.5)*

Fires when a tracked user's presence transitions between `online`,
`inactive`, and `offline`. Does NOT fire on stable ticks where the
status didn't change — listeners only see real transitions, so
"user came online" / "user went away" UIs hook here without
debouncing themselves.

The viewer-side filter (`wp_desktop_presence_visible_users`) gates
which users surface in any one viewer's tab — a transition for a
user the viewer can't see produces no event.

```javascript
document.addEventListener( 'wp-desktop-presence-changed', ( e ) => {
    const { userId, oldStatus, newStatus, lastSeenMs } = e.detail;
    if ( oldStatus !== 'online' && newStatus === 'online' ) {
        toast( `${ userId } is online` );
    }
} );
```

**`detail` shape:**

```typescript
{
    userId:       number,
    oldStatus:    'online' | 'inactive' | 'offline' | null,  // null on first sighting
    newStatus:    'online' | 'inactive' | 'offline',
    lastSeenMs:   number,
    lastActiveMs: number,
}
```

---

### `wp-desktop-layout-changed` — Stable *(since 0.18.0)*
Fires when the user picks a new top-level desktop layout in OS Settings → Appearance. The shell tears down and rebuilds the dock(s) before the event fires; plugins that cached `wp.desktop.dock` should re-fetch from the event detail (or read `wp.desktop.dock` again — it's mutated in place). The shell root reflects the new value in `data-wp-desktop-layout` attribute by the time this fires, so CSS selectors keyed on it will already match.

```javascript
document.addEventListener( 'wp-desktop-layout-changed', ( e ) => {
    const { layout, primary, side } = e.detail;
    console.log( 'Desktop layout is now', layout );
} );
```

**`detail` shape:**

```typescript
{
    layout: 'classic' | 'unified' | 'spatial',
    primary: Dock | null,   // bottom dock — always present
    side:    Dock | null,   // left side bar — non-null only in classic
}
```

---

### `wp-desktop-drag-start` — Planned (Phase 8)
Will fire when a drag operation escalates across window boundaries.

```typescript
{ sourceWindowId: string, payload: { id, url, title, thumbnail } }
```

---

### `wp-desktop-drop` — Planned (Phase 8)
Will fire when a cross-window drop completes.

```typescript
{ sourceWindowId: string, targetWindowId: string, payload: { ... } }
```

---

## 2. `window.wp.desktop` API

Populated after `wp-desktop-init`. Do not access before that event fires.

```typescript
window.wp.desktop = {
    // Window management
    windowManager:     WindowManager,
    openWindow:        ( id, opts? ) => boolean,
    onWindow:          ( id, handlers, opts? ) => () => void,

    // Surfaces
    dock:              Dock | null,                            // primary (bottom)
    sideDock:          Dock | null,                            // since 0.18.0 — left, classic only
    desktopLayout:     'classic' | 'unified' | 'spatial',       // since 0.18.0
    icons:             IconsApi,                                // since 0.24.0
    saveSession:       () => void,

    // Cross-bundle / cross-window primitives                  // since 0.5.5
    createSharedStore: < T >( key, init ) => SharedStore< T >,
    activity:          ActivityApi,                            // typed pub/sub
    heartbeat:         HeartbeatBus,                           // wp Heartbeat bus
    broadcast:         < T >( topic, payload ) => void,        // cross-window
    subscribe:         ( topic, cb ) => () => void,            // cross-window

    // Framework features
    presence:          PresenceApi,                            // since 0.5.5
    ai:                AiApi,
    devtools:          DevtoolsApi,

    // Native-window glue                                      // since 0.6.0
    getWindowConfig:   < T >( id ) => T | undefined,
    debug:             { window: ( id ) => DesktopDebugWindow | null },

    // Lifecycle
    whenReady / ready: ( cb ) => void,
    isReady:           () => boolean,
    config:            DesktopConfig,
};
```

The full surface is broader; the table above lists the core primitives most plugins reach for. See the per-API sections below for shapes.

### `windowManager` — Stable

Exposed instance of the `WindowManager` class.

**Methods:**

```typescript
// Open / focus
manager.open( config ): Window;
manager.openNew( config ): Window;
manager.focus( win: Window ): void;

// Lookup
manager.getById( id: string ): Window | undefined;
manager.getByBaseId( baseId: string ): Window | undefined;
manager.getAll(): Window[];
manager.getFocused(): Window | undefined;

// Snapshot / surface
manager.snapshot(): Session;
manager.getVisibleRects(): VisibleWindowRect[];

// Batch operations
manager.closeAll( options?: { exceptIds?: string[] } ): number;          // since 0.14.0
manager.cascade(): void;
manager.tile(): void;

// Virtual desktops ("Spaces")
manager.getDesktops(): Desktop[];                                        // since 0.6
manager.getActiveDesktop(): Desktop;                                     // since 0.6
manager.getActiveDesktopId(): string;                                    // since 0.6
manager.getPrimaryDesktopId(): string;                                   // since 0.14.0
manager.createDesktop(): Desktop;                                        // since 0.6
manager.switchDesktop( id: string ): void;                               // since 0.6
manager.closeDesktop( id: string ): void;                                // since 0.6
```

**`config` shape passed to `open()` / `openNew()`:**

```typescript
{
    id:            string;
    baseId?:       string;
    multi?:        boolean;
    url:           string;
    title:         string;
    icon?:         string;
    x?:            number;
    y?:            number;
    width?:        number;
    height?:       number;
    initialState?: 'normal' | 'minimized' | 'maximized' | 'fullscreen';
    submenu?:      { title: string; url: string }[];
}
```

**`getVisibleRects()`** — snapshot every open window's current geometry + state. One entry per window in the stack (regardless of virtual desktop), carrying a live element reference. Intended for wallpaper / overlay plugins that previously scraped `document.querySelectorAll( '.wp-desktop-window' )` and sniffed modifier class names to derive state. Callers filter on `state` themselves — minimized windows are included so the consumer can decide.

```typescript
interface VisibleWindowRect {
    windowId: string;
    rect: { x: number; y: number; width: number; height: number };
    state: WindowState;
    element: HTMLElement;
}
```

**Example — open a window from your own code:**

```javascript
document.addEventListener( 'wp-desktop-init', () => {
    window.wp.desktop.windowManager.open( {
        id:    'my-ext-window',
        url:   '/wp-admin/admin.php?page=my-analytics',
        title: 'Analytics',
        icon:  'dashicons-chart-bar',
    } );
} );
```

Calling `open()` with an id (or `baseId`) that's already on screen focuses the existing window and restores it if minimized.

**Multi-instance windows.** When `multi: true` is passed, the window gets an extra actions menu in its title bar (leading edge, before the icon) whose "Open another" item calls `openNew()`. `openNew()` always creates a fresh window — even when one with the same `baseId` is already open — assigning a suffixed id (`${baseId}-2`, `${baseId}-3`, …) so every instance can be tracked independently while the dock still groups them under the same icon.

```javascript
// Open a second Posts list alongside the first.
window.wp.desktop.windowManager.openNew( {
    id:      'edit-php',
    baseId:  'edit-php',
    url:     '/wp-admin/edit.php',
    title:   'Posts',
    icon:    'dashicons-admin-post',
    multi:   true,
} );
```

The server-side `desktop_mode_dock_item_multi` filter controls which admin pages ship with `multi: true` by default — see the [Hooks reference](./hooks-reference.md#desktop_mode_dock_item_multi--stable).

---

#### `Window` instance methods

The objects returned by `manager.open()`, `getById()`, `getAll()`, etc. are `Window` instances. Public surface:

```typescript
interface Window {
    readonly id:      string;     // stable identifier
    readonly config:  WindowConfig;
    readonly element: HTMLElement; // outer .wp-desktop-window node
    state: 'normal' | 'minimized' | 'maximized' | 'fullscreen';

    // Lifecycle
    close(): void;
    minimize(): void;
    restore(): void;
    maximize(): void;
    detach(): void;          // pop into a new browser tab (iframe windows only)

    // Unified channel API — works for iframe AND native windows.
    send< T = unknown >( channel: string, payload?: T ): void;
    on< T = unknown >(
        channel: string,
        cb: ( payload: T, meta: { channel: string; windowId: string } ) => void,
    ): () => void;
}
```

The `state` property is read-only-ish — mutate via the methods (`minimize()`, `restore()`, `maximize()`) so the manager fires the right lifecycle hooks (`wp-desktop.window.minimized`, etc.). Reading it is fine and cheap.

```javascript
const win = wp.desktop.windowManager.getById( 'edit-php' );
if ( win && win.state === 'normal' ) win.minimize();
```

#### `Window.send( channel, payload? )` — Stable *(since 0.5.5)*

Publish a payload into this window's content. **The unified abstraction over iframe `postMessage` and native render-callback dispatch — plugin authors write the same call regardless of how the window is rendered.**

For iframe windows (real iframes OR `iframeContent`-shorthand natives) the payload is delivered as `wp-desktop-window-send` via `postMessage` and surfaces inside the iframe via `wp.desktop.on( channel, cb )` (the iframe-bridge installs the API on `wp.desktop`). For pure-native windows the payload is dispatched in-process to subscribers the render callback registered through its `windowApi.on( channel, cb )`.

```javascript
const win = wp.desktop.windowManager.getById( 'wpdc-editor' );
win.send( 'editor:open-file', { path: 'plugins/foo/bar.php', line: 42 } );
```

Plugin authors **never** branch on window type, **never** reach for `postMessage`, **never** read `win.iframe` to decide a code path. Same call, same channel, same payload — the framework picks the right delivery mechanism.

#### `Window.on( channel, cb )` — Stable *(since 0.5.5)*

Subscribe to a channel published BY this window's content. Mirror of `send()` for the inbound direction. Iframe content publishes via `wp.desktop.send( channel, payload )` (installed by the iframe-bridge); native render code publishes via the `windowApi.send` it received in the render context. Both land here.

Use `'*'` for a wildcard subscription that fires on every channel from this window.

```javascript
const win = wp.desktop.windowManager.getById( 'wpdc-editor' );
const off = win.on( 'editor:saved', ( { path } ) => {
    toast( `${ path } saved.` );
} );
```

Returns an unsubscribe handle. Subscribers are dropped automatically when the window closes — no leak even if the caller forgets to detach.

#### Cross-window peer connections — `wp.desktop.connect()` works for both types *(since 0.5.5)*

`wp.desktop.connect( windowId )` opens a typed pub/sub channel with a peer window. As of 0.5.5, **the connection works identically whether the target is iframe or native**: for iframe targets the bridge negotiates a handshake then crosses the iframe boundary via `postMessage`; for native targets it routes synchronously through the same in-process channel bus that powers `Window.send/on`. The caller writes the same `conn.send(topic, payload)` / `conn.subscribe(topic, cb)` regardless.

```javascript
const conn = wp.desktop.connect( 'jorvy', {
    topics: [ 'jorvy:quote-changed' ],
    onOpen: () => conn.send( 'jorvy:next-quote', {} ),
} );
conn.subscribe( 'jorvy:quote-changed', ( payload ) => {
    repaintQuoteWidget( payload );
} );
```

Native targets fire `onOpen` on the next microtask (no handshake to wait for); iframe targets fire it after the iframe acks the handshake. `isOpen()`, `disconnect()`, and the `wp-desktop.connection.*` hook lifecycle behave identically for both kinds.

---

### `wp.desktop.openWindow( id, opts? )` — Stable (since 0.18.0)

Open (or focus) a server-registered native window by id. Symmetric with `desktop_mode_register_window( $id, ... )` — pass the same string.

```typescript
wp.desktop.openWindow(
    id:    string,
    opts?: { source?: string },
): boolean;
```

Returns `true` if a window with that id is registered and was opened (or already open and focused), `false` otherwise.

Goes through the same canonical opener as the dock click + the wallpaper-icon click — so the body comes pre-populated with the cloned `<template>` declared at registration time. Plugin authors can rely on the same render-callback contract no matter which entry point opens the window.

**`opts.source`** *(since 0.5.5)* — optional string identifying who triggered the open. The framework publishes `wp-desktop/open-requested` on the activity bus *before* the open is processed, so analytics, do-not-disturb modes, and audit subscribers can observe the user's intent independently of the outcome:

```javascript
wp.desktop.openWindow( 'my-plugin/inbox', { source: 'global-search' } );

wp.desktop.activity.subscribe( 'wp-desktop/open-requested', ( { windowId, source } ) => {
    track( 'window.open.requested', { windowId, source } );
} );
```

Conventional `source` values: `'dock'`, `'taskbar'`, `'icon'`, `'shortcut'`, `'palette'`, `'api'` (default when omitted). Custom strings are fine — pick one that matches the surface the user clicked.

```javascript
// Open the Code editor (requires the desktop-mode-code-editor extension).
wp.desktop.openWindow( 'wpdc-editor' );

// Cross-plugin: surface a sister plugin's monitoring dashboard.
if ( ! wp.desktop.openWindow( 'alcazaba-monitor' ) ) {
    // Sibling plugin isn't active — handle gracefully.
}
```

The Code editor ships as the standalone **Desktop Mode — Code Editor** extension; `wpdc-editor` only resolves when that plugin is active.

For programmatic deep-linking into the **Code editor** specifically (open + jump to a path/line), pair `openWindow` with the [`wp-desktop-code-open` postMessage](./examples/code-editor-open.md) protocol. The shortcut `Ctrl/Cmd+Shift+E` does the same thing the user-facing way.

---

### `wp.desktop.getWindowConfig( id )` — Stable *(since 0.6.0)*

Read the bundle-bound config blob shipped via the `'config'` arg on `desktop_mode_register_window( $id, [ 'config' => … ] )`. Returns `undefined` when no config was registered for `id`.

```js
const cfg = wp.desktop.getWindowConfig( 'my-plugin/cron' );
// → { restNonce: '…', eventsUrl: 'https://…', … }
```

The blob is delivered through the same payload path as `wp_localize_script` `extra['data']` — it lands on both eager and lazy script-load paths, so it's the recommended way to ship REST URLs / nonces / capability flags / anything session-bound to a native-window bundle.

See [`examples/window-with-config.md`](./examples/window-with-config.md) for a full recipe.

### `wp.desktop.debug.window( id )` — Stable *(since 0.6.0)*

Read-only diagnostic snapshot of what the shell knows about a registered native window:

```js
wp.desktop.debug.window( 'my-plugin/cron' );
// → {
//     id: 'my-plugin/cron',
//     scriptHandle: 'my-plugin-cron',
//     scriptUrl: 'https://…/cron.min.js?ver=…',
//     loadPath: 'eager' | 'lazy' | 'unknown',
//     tagInDom: true,
//     configPresent: true,
//     extras: {
//         hasTranslations: false,
//         l10nCount: 1,
//         beforeCount: 0,
//         afterCount: 0,
//     },
//   }
```

Returns `null` when `id` is not in the `nativeWindows` payload (plugin not active, capability gate, id typo).

`loadPath`:
- `'eager'` — a `<script>` tag printed by `wp_print_scripts` was found in the document for this URL.
- `'lazy'` — only the shell-injected `<script data-wp-desktop-vendor>` tag is present.
- `'unknown'` — neither (script never loaded yet, or empty URL).

Use this when integration debugging — particularly when a bundle's config global is missing. `loadPath: 'lazy'` plus `configPresent: false` is the historical mid-session-activation bug that 0.6.0 fixed by harvesting `extra` data into the payload; if you still see this in a current install, the integration is the place to look.

---

#### Virtual desktops ("Spaces")

Multiple "Spaces" with windows distributed across them. Each desktop has an id, a label, and (server-side) a position in the persisted session.

```typescript
interface Desktop {
    id:    string;
    label: string;
}

manager.getDesktops(): Desktop[];          // every desktop, in order
manager.getActiveDesktop(): Desktop;       // the one currently visible
manager.getActiveDesktopId(): string;
manager.getPrimaryDesktopId(): string;     // since 0.14.0 — see below
manager.createDesktop(): Desktop;          // append a new one + return it
manager.switchDesktop( id ): void;         // make `id` the active desktop
manager.closeDesktop( id ): void;          // delete `id`; its windows migrate to the active desktop
```

Lifecycle hooks fire on each operation: `HOOKS.DESKTOP_CREATED`, `HOOKS.DESKTOP_CLOSED { desktopId, migratedTo }`, `HOOKS.DESKTOP_SWITCHED { from, to }`.

##### Primary desktop — `getPrimaryDesktopId()` *(since 0.14.0)*

The "primary" desktop is the canonical one batch operations and migration logic treat as the survivor. Default: the first desktop returned by `getDesktops()` (typically `desktop-1`). Filterable via the `wp-desktop.primary-desktop-id` filter so plugins that pin a different convention (e.g. an "Inbox" desktop) can override:

```javascript
wp.hooks.addFilter(
    'wp-desktop.primary-desktop-id',
    'my-plugin',
    ( defaultId, desktops ) => {
        const inbox = desktops.find( ( d ) => d.label === 'Inbox' );
        return inbox ? inbox.id : defaultId;
    }
);
```

Filter receives `( defaultId: string, desktops: Desktop[] )` and must return a string id that matches one of the existing desktops — the manager validates the result and falls back to `defaultId` on any miss.

---

#### Batch close — `closeAll()` *(since 0.14.0)*

```typescript
manager.closeAll( options?: { exceptIds?: string[] } ): number;
```

Closes every open window (across all desktops) and returns the number actually closed. Optional `exceptIds` skips specific windows entirely — never even passed to the filter.

**Hook chain:**

| Hook | Type | Payload | Use |
|---|---|---|---|
| `wp-desktop.windows.before-close-all` | action | `{ candidates: Window[] }` | Cleanup, dismiss menus, cancel pending saves |
| `wp-desktop.windows.close-all` | filter | `Window[]` → `Window[]` | **Protect specific windows** by removing them from the list. Returning `[]` cancels the close entirely. |
| `wp-desktop.windows.after-close-all` | action | `{ closed: number, skipped: Window[] }` | Toast, telemetry, refocus a tile |

```javascript
// Protect any window with unsaved Gutenberg edits.
wp.hooks.addFilter(
    'wp-desktop.windows.close-all',
    'my-plugin/protect-drafts',
    ( windows ) => windows.filter( ( w ) => ! w.element.dataset.hasUnsaved )
);
```

```javascript
// Run from a slash-command handler:
const closed = wp.desktop.windowManager.closeAll();
return `Closed ${ closed } window${ closed === 1 ? '' : 's' }.`;
```

If a `Window.close()` throws, the loop catches and continues — one bad window can't abort the batch.

---

### `dock` — Stable
The **primary (bottom) `Dock` instance** (or `null` if the dock element wasn't in the DOM). Always present once the shell has booted. What it holds depends on the active `desktopLayout`:

- **Classic** — plugin-contributed top-level menus only (core menus go to `sideDock`).
- **Unified** — every menu, core and plugin alike, sharing one rail.
- **Spatial** — plugin menus only (core menus are rendered as wallpaper icons).

`setBadge( id, count )` is the canonical way to surface a numeric count on a tile; calls fire `wp-desktop/badge-changed` on the activity bus with `rail: 'dock'` *(since 0.24.0)*. `Dock.removeSystemItem( id )` fires `HOOKS.DOCK_ITEM_REMOVED` *(since 0.24.0)* — the symmetric counterpart of `HOOKS.DOCK_ITEM_APPENDED`. See [`docs/examples/dock-badge.md`](./examples/dock-badge.md).

> **Layout switching note** — the underlying instance is replaced when the user picks a new layout in OS Settings → Appearance. `wp.desktop.dock` is mutated in place so a fresh property read returns the current dock; plugins that **cache** the reference earlier should listen for `wp-desktop-layout-changed` and refresh.

---

### `sideDock` — Stable *(since 0.18.0)*
Secondary `Dock` instance that hosts **core WordPress admin menus** (Dashboard, Posts, Pages, Media, Users, Settings, CPTs, taxonomies) along the **left edge**. Non-null only when `desktopLayout === 'classic'` — `null` in Unified and Spatial.

Same `Dock` API as `dock`, just with `data-wp-desktop-dock-placement="left"` so its CSS selectors don't collide with the bottom rail.

```js
wp.desktop.sideDock?.setBadge( 'edit.php', 3 );
```

**Icon fallback:** as with the primary dock, a menu without dashicon / SVG / URL renders a letter badge in a hue derived from the title — same plugin, same colour across reloads.

---

### `desktopLayout` — Stable *(since 0.18.0)*
Currently-active top-level layout. One of `'classic' | 'unified' | 'spatial'`. Mirrors the user's OS Settings → Appearance pick and the `data-wp-desktop-layout` attribute on the shell root.

```js
if ( wp.desktop.desktopLayout === 'spatial' ) {
    // Core menus are wallpaper icons; expect `sideDock` to be null.
}
```

Listen for `wp-desktop-layout-changed` to react to a switch.

---

### `icons` — Stable *(since 0.24.0)*

The wallpaper-icon rail — second badge surface alongside `dock`. Mirrors the dock's `setBadge` shape exactly so plugin authors can fan a count to whichever rail happens to host their tile (also `sideDock` in Classic layout):

```ts
interface IconsApi {
    setBadge:   ( iconId: string, count: number ) => void;
    clearBadge: ( iconId: string ) => void;
    getBadge:   ( iconId: string ) => number;
}
```

```js
wp.desktop.icons.setBadge(   'wpdm-messages', 5 );
wp.desktop.icons.clearBadge( 'wpdm-messages' );
wp.desktop.icons.getBadge(   'wpdm-messages' ); // → 0
```

- **Idempotent.** Same count twice = no DOM mutation, no re-emit.
- **Silent no-op when the id isn't on the rail.** Lets the fan-to-all-rails pattern work without triple-emitting.
- **Survives a full grid rebuild.** Plugin-set badges persist across plugin activations / live menu refreshes — set once, the renderer re-paints from internal state.
- **`>99` renders as `99+`**.

Every applied change publishes on:

- `wp-desktop/badge-changed` activity channel with `{ itemId, count, rail: 'icon' }`.
- `HOOKS.ICON_BADGE_CHANGED` action with `{ iconId, count, previousCount }`.

The rail does NOT auto-suppress badges based on window state — that's a per-app UX policy. See [`docs/examples/dock-badge.md`](./examples/dock-badge.md) for the canonical "show 0 while my window is active" recipe.

---

### `saveSession` — Stable
A debounced function that schedules a session write. Call it after mutating window state from your own code.

```javascript
window.wp.desktop.windowManager.focus( someWindow );
window.wp.desktop.saveSession();
```

---

### `presence` — Stable *(since 0.5.5)*

Framework-level presence tracking — who's currently in the desktop-mode WP-Admin and what their state is. Always available, regardless of which feature plugins (chat, collaboration, …) happen to be installed. Useful for any UI that wants to surface who's around: avatar dots, "online now" lists, collaborative cursors, real-time co-editing indicators, etc.

The probe boots automatically on `wp-desktop-init` and piggy-backs the WordPress Heartbeat — every tick (~15 s default in admin) the client sends `wp_desktop_presence_active: true` plus `wp_desktop_user_active: <bool>` (true when the user moused / typed within the last 5 minutes), and the server responds with the visible-users snapshot.

```javascript
// Synchronous lookup for a single user.
wp.desktop.presence.getStatus( userId );          // 'online' | 'inactive' | 'offline'

// Full snapshot (clone — safe to iterate).
const map = wp.desktop.presence.getAll();          // Map<number, { status, lastSeenMs, lastActiveMs }>

// Single-user record or null.
const entry = wp.desktop.presence.getEntry( userId );

// React to changes.
const off = wp.desktop.presence.subscribe( ( state ) => {
    // state.byUser is a ReadonlyMap. Fires on every tick that lands a snapshot.
    repaintBadges( state.byUser );
} );

// Force the next heartbeat tick to flag the current user as active.
wp.desktop.presence.markActive();

// Push a batch of presence updates into the framework store. Use this
// when your plugin has a faster delivery channel than the heartbeat
// (e.g. an SSE stream that emits per-conversation presence events) and
// you want every consumer of `wp.desktop.presence.*` — including
// `getStatus()` callers in unrelated plugins — to see the freshest data.
// `lastSeenMs` / `lastActiveMs` are optional; when omitted, the existing
// timestamps are preserved.
wp.desktop.presence.applyBatch( [
    { userId: 7, status: 'online' },
    { userId: 12, status: 'inactive', lastSeenMs: Date.now() - 90_000 },
] );
```

**State machine:**

| Status     | Meaning                                                                                     |
|------------|---------------------------------------------------------------------------------------------|
| `online`   | Heartbeat within `wp_desktop_presence_offline_after` AND user input within `wp_desktop_presence_inactive_after`. |
| `inactive` | Heartbeat present, but no input within `wp_desktop_presence_inactive_after` (default 5 min). |
| `offline`  | No heartbeat in `wp_desktop_presence_offline_after` (default 2 min).                        |

**Visibility:**

The server-side `wp_desktop_presence_visible_users` filter gates which users surface to a given viewer. By default everyone tracked is visible to everyone tracked; plugins can narrow (e.g. "subscribers only see other subscribers") without the client knowing.

**Companion CustomEvent:** [`wp-desktop-presence-changed`](#wp-desktop-presence-changed--stable-since-055) fires once per status transition per user, with a `null` oldStatus on first sighting.

**See also:** [`docs/examples/presence.md`](./examples/presence.md) for an end-to-end recipe.

---

### `createSharedStore( key, initialState )` — Stable *(since 0.5.5)*

Cross-bundle reactive state primitive. Every plugin in Desktop Mode is typically built as its own Vite IIFE bundle, and module-level state defined in one bundle is **invisible** to another bundle even when both import the same source file — each bundle ends up with its own compiled copy. `createSharedStore` solves this by attaching state to a window-level slot keyed by the string you pass; the first call with a given key creates the store, every subsequent call (in any bundle) returns the SAME store. Mutations propagate; subscribers from any bundle fire on any mutation.

You only need this when you split your plugin's JS across more than one bundle. A plugin that ships a single bundle can use plain module-level state and skip the primitive entirely.

```javascript
const store = wp.desktop.createSharedStore( 'my-plugin/state', () => ( {
    selectedId: null,
    items: [],
} ) );

// Reactive reads
const off = store.subscribe( ( s ) => repaint( s ) );

// Mutate-then-notify (no immutable updates, no reducer enum)
store.state.selectedId = 7;
store.state.items.push( newItem );
store.notify();

// Read-only snapshot (same reference, narrower type)
const current = store.getState();

// Stop listening
off();
```

**API shape:**

```typescript
interface SharedStore< T > {
    state: T;                                       // mutable
    getState(): Readonly< T >;                      // narrowed read view
    notify(): void;                                 // wake subscribers
    subscribe( cb: ( s: Readonly< T > ) => void ): () => void;
    reset(): void;                                  // tests only
}

wp.desktop.createSharedStore< T >(
    key:          string,                           // 'plugin/purpose'
    initialState: () => T,                          // thunk; runs once
): SharedStore< T >;
```

**Key conventions:**

- Use `'<plugin>/<purpose>'` (e.g. `'my-plugin/state'`) so accidental collisions across plugins are unlikely.
- The same key from any bundle returns the same store. Use distinct keys for genuinely separate stores.
- The `initialState` thunk is **only called once per key** — re-calls return the existing instance.
- `reset()` preserves the outer object identity for object state, so consumers that captured `const s = store.state;` keep working after a reset.

**Why a primitive instead of "just use a window global":**

Plugin authors were rolling their own `window.__myPluginShared` slots and reinventing the same dedupe + subscribe + notify wiring every time. This standardises the pattern, removes the sharp edges (stale captures across reset, stranded subscribers when one bundle throws), and gives every plugin one predictable place to look.

---

### `onWindow( id, handlers, options? )` — Stable *(since 0.5.5)*

The typed wrapper for "subscribe to *this one* window's lifecycle." Filters every action by `windowId`, lets you bind every event in one shot, and returns a single unsubscribe handle. Use this instead of hand-rolling `addAction(HOOKS.WINDOW_*)` calls + windowId checks unless you specifically want lifetime control over each subscription.

```typescript
wp.desktop.onWindow(
    id:       string,
    handlers: WindowLifecycleHandlers,
    options?: { persistent?: boolean },
): () => void;

interface WindowLifecycleHandlers {
    opened?:            ( e: { windowId, page, title, url } ) => void;
    reopened?:          ( e: { windowId, baseId, wasMinimized } ) => void;
    focused?:           ( e: { windowId } ) => void;
    blurred?:           ( e: { windowId, focusedTo } ) => void;
    closing?:           ( e: { windowId, element } ) => void;
    closed?:            ( e: { windowId } ) => void;
    minimized?:         ( e: { windowId } ) => void;
    restored?:          ( e: { windowId } ) => void;
    maximized?:         ( e: { windowId } ) => void;
    unmaximized?:       ( e: { windowId } ) => void;
    fullscreenEntered?: ( e: { windowId } ) => void;
    fullscreenExited?:  ( e: { windowId } ) => void;
    resized?:           ( e: { windowId, x, y, width, height } ) => void;
    bodyResized?:       ( e: { windowId, width, height } ) => void;
    boundsChanged?:     ( e: { windowId, x, y, width, height } ) => void;
}
```

**`options.persistent`** — default `false`. The framework auto-unsubscribes on `closed` so a per-instance subscription (an undo toast that vanishes when the window closes) doesn't leak handlers when the window is recreated. **Set `persistent: true`** for app-level subscriptions that need to keep firing for every open / close cycle of the page — badge policies, do-not-disturb modes, anything that depends on the *current* state of the window over the lifetime of the tab.

```javascript
// Per-instance — auto-unsubscribes on close.
const off = wp.desktop.onWindow( 'my-plugin/inbox', {
    focused:   () => clearAttention(),
    blurred:   () => repaintBadge(),
    closed:    () => recordSession(),
} );

// App-lifetime — keeps firing every time the window reopens.
wp.desktop.onWindow(
    'my-plugin/inbox',
    {
        opened:    () => repaintBadge(),
        focused:   () => repaintBadge(),
        blurred:   () => repaintBadge(),
        minimized: () => repaintBadge(),
        restored:  () => repaintBadge(),
        closed:    () => repaintBadge(),
        reopened:  () => repaintBadge(),
    },
    { persistent: true },
);
```

**The `persistent` footgun.** Without `persistent: true`, your handler stops firing after the first close. A common bug: a badge policy module subscribes once at boot, the user closes + reopens the window, and badges stop updating. If you're confused about why your subscription stopped working, this is almost always why.

---

### `activity` — Stable *(since 0.5.5)*

Cross-plugin activity bus. The transport layer for "thing X happened in plugin A; plugin B might care." Built on top of `wp.hooks` with three benefits over raw `doAction`/`addAction`:

1. **A documented naming convention** (`<plugin>/<event>`).
2. **A predictable hook prefix** (`wp-desktop.activity.<channel>`) so devtools can list activity traffic as a discrete group.
3. **Type-safe payloads** via the `ActivityChannelMap` interface (extend in your own `.d.ts`).

```typescript
interface ActivityApi {
    publish< K extends keyof ActivityChannelMap >(
        channel: K,
        payload?: ActivityChannelMap[ K ],
    ): void;
    subscribe< K extends keyof ActivityChannelMap >(
        channel: K,
        cb:      ( payload: ActivityChannelMap[ K ] ) => void,
    ): () => void;
    filter< K extends keyof ActivityChannelMap >(
        channel: K,
        value:   ActivityChannelMap[ K ],
        ...args: unknown[]
    ): ActivityChannelMap[ K ];
}
```

**Built-in channels** *(since 0.5.5)* — every framework primitive that publishes mirrors here:

| Channel | Direction | Payload | Filterable? |
|---|---|---|---|
| `wp-desktop/toast-requested` | Pre-show — `showToast()` calls run through this. | `{ message, action?, duration?, source?, meta?, cancel? }` | **Yes.** Set `cancel: true` to drop the toast. Mutate `message`/`duration`/`action` to rewrite. |
| `wp-desktop/toast-shown` | Fire-and-forget — fires after the toast lands in the DOM. | Same shape as above. | No (filtering is too late). |
| `wp-desktop/window-attention-requested` | Pre-attention — `Window.requestAttention()` and `dock.setAttention()` calls run through this. | `{ windowId, mode, durationMs?, intensity?, source?, cancel? }` | **Yes.** Set `cancel: true` for DND. Mutate `mode`/`durationMs`/`intensity` to scale the animation. |
| `wp-desktop/badge-changed` | Fire-and-forget — every `setBadge()` on dock / taskbar / icons mirrors here on every change. | `{ itemId, count, rail?: 'dock' \| 'taskbar' \| 'icon' }` *(rail since 0.24.0)* | No. |
| `wp-desktop/open-requested` | Fire-and-forget — `wp.desktop.openWindow()` publishes here BEFORE deciding `opened` vs `reopened`. | `{ windowId, source }` | No. |
| `wp-desktop/presence-changed` | Per-transition mirror of the `wp-desktop-presence-changed` CustomEvent. | `{ userId, oldStatus, newStatus, lastSeenMs, lastActiveMs }` | No. |
| `wp-desktop/presence-snapshot-applied` | Batch-level — fires after every presence snapshot OR `applyPresenceBatch()`. | `{ applied: number, transitions: number }` | No. |

**Plugin channels** — pick a `<plugin>/<event>` slug and publish. Augment `ActivityChannelMap` for compile-time payload checking:

```ts
declare module 'wp-desktop-mode/activity' {
    interface ActivityChannelMap {
        'my-plugin/something-happened': { id: number; reason: string };
    }
}
```

```javascript
// Publish — peers see it immediately.
wp.desktop.activity.publish( 'inbox/unread-changed', { total: 5 } );

// Subscribe.
const off = wp.desktop.activity.subscribe(
    'inbox/unread-changed',
    ( { total } ) => repaintWidget( total ),
);

// Filter — let plugins veto / shape a value before peers see it.
const safeOutgoing = wp.desktop.activity.filter(
    'inbox/outgoing-payload',
    payload,
    { author: currentUserId },
);
```

**See also:** [`docs/event-driven-framework.md`](./event-driven-framework.md) for the bigger pattern.

---

### `heartbeat` — Stable *(since 0.5.5)*

Cross-feature WordPress Heartbeat bus. Wraps the global jQuery Heartbeat (`heartbeat-send` / `heartbeat-tick`) in a typed pub/sub so multiple plugins can read AND write per-tick payloads without each one re-implementing the jQuery boilerplate. The framework wires the underlying jQuery events exactly once.

```typescript
interface HeartbeatBus {
    contribute< T = unknown >(
        field:    string,
        supplier: () => T | undefined,    // return undefined to skip this tick
    ): () => void;                         // unsubscribe
    subscribe< T = unknown >(
        field: string,
        cb:    ( value: T ) => void,
    ): () => void;                         // unsubscribe
}
```

**Outgoing — `contribute`.** Add a field to the next `heartbeat-send` payload by registering a supplier. The supplier runs once per tick; return `undefined` to skip the field for that tick. **Last writer wins** — re-contributing the same field replaces the previous supplier (use this if you want to swap policies cleanly).

```javascript
// Tell the server "I'm at the desk" every tick.
const off = wp.desktop.heartbeat.contribute(
    'my-plugin/active',
    () => isActive() ? true : undefined,
);
```

**Incoming — `subscribe`.** React to a field on the `heartbeat-tick` response. Multiple subscribers compose; one failing subscriber doesn't strand peers (errors go to `console.error`).

```javascript
const off = wp.desktop.heartbeat.subscribe( 'my-plugin/payload', ( v ) => {
    applyServerSnapshot( v );
} );
```

**Why this exists.** Without a shared bus, every feature that wants to ride Heartbeat re-binds `jQuery(document).on('heartbeat-send', …)` itself. Three problems: (1) the boilerplate is identical, (2) no plugin can see what other plugins are contributing on the same tick, (3) a thrown error in any handler can strand later handlers on the same event. The bus consolidates the wiring, exposes the typed channel surface, and isolates errors per supplier/subscriber.

**Built-in consumer.** `presence` contributes `wp_desktop_presence_active` + `wp_desktop_user_active` and subscribes to `wp_desktop_presence`. Read [`src/presence/index.ts`](../src/presence/index.ts) for the canonical pattern.

---

### `broadcast` / `subscribe` — Stable *(since 0.21.0)*

Cross-window pub/sub. Fan-out fan-in primitive — any module can publish on a topic and every subscriber (in the parent shell, in any open iframe, in any other tab via `BroadcastChannel`) receives the payload. Distinct from `wp.desktop.activity` in two ways: it crosses iframe boundaries, and it has no `<plugin>/<event>` typing — topics are free-form strings.

```typescript
wp.desktop.broadcast< T >( topic: string, payload: T ): void;

wp.desktop.subscribe< T >(
    topic: string,                         // or '*' for wildcard
    cb:    ( payload: T, meta: { topic: string } ) => void,
): () => void;
```

```javascript
// Notify every window that a record changed.
wp.desktop.broadcast( 'posts/updated', { id: 42 } );

// React across windows.
wp.desktop.subscribe( 'posts/updated', ( { id } ) => {
    refetchIfShowing( id );
} );
```

**Mirror onto activity** *(since 0.5.5)* — every `broadcast()` *also* publishes on the activity bus under the same topic name (so long as it matches the `<plugin>/<event>` shape), so in-tab subscribers can use the unified `activity.subscribe` surface without knowing whether the producer ran broadcast vs activity. Cross-tab + cross-iframe fan-out stays the broadcast bus's job.

---

### `showToast( opts )` — Stable *(since 0.23.0)*

Show a transient top-of-shell toast. Returns a dismiss callback the caller can invoke early — useful when the state the toast was reporting changes (e.g. dismiss "X arrived" toasts the moment the related window mounts).

```typescript
wp.desktop.showToast( {
    message: string;
    duration?: number;                                     // ms; default 4000
    action?: { label: string; onClick: () => void };       // optional CTA
} ): () => void;
```

```javascript
const dismiss = wp.desktop.showToast( {
    message: 'Saved',
    duration: 3000,
    action: { label: 'Undo', onClick: () => undo() },
} );

// Tear it down early if the underlying state changes:
windowOpenedCallback( () => dismiss() );
```

Routes through the `wp-desktop/toast-requested` activity filter before painting; plugins can register a filter that returns `null` (or sets `cancel: true`) to suppress, or mutates the payload to amplify / quiet the toast.

---

### `repaintLoadingOverlays()` — Stable *(since 0.6.0)*

Re-paint every currently-loading window's spinner overlay through the customization pipeline (per-window `config.loading.render` + `WINDOW_LOADING_OVERLAY` filter).

**You almost never need this.** Filters registered inside `wp.desktop.whenReady( … )` are picked up automatically by the shell's post-`HOOKS.INIT` sweep, including for F5 / session-restored windows that were constructed before the plugin script ran. The canonical plugin shape:

```js
wp.desktop.whenReady( () => {
    wp.desktop.hooks.addFilter(
        'wp-desktop.window.loading-overlay',
        'my-skin/branded',
        ( host ) => { /* … */ },
    );
} );
```

just works on F5 with no extra plumbing.

`repaintLoadingOverlays()` exists as an escape hatch for plugins that register their `WINDOW_LOADING_OVERLAY` filter **mid-life** — after a deferred async import, a runtime feature-flag flip, or a settings change. Call it after `addFilter` and the shell will sweep every still-loading window through the pipeline:

```js
async function activateBrandSkin() {
    const { brandRenderer } = await import( './brand-renderer.js' );
    wp.desktop.hooks.addFilter(
        'wp-desktop.window.loading-overlay',
        'my-skin/lazy-branded',
        brandRenderer,
    );
    wp.desktop.repaintLoadingOverlays();
}
```

Idempotent + cheap — windows that already finished loading are unaffected.

---

### `renderKeyedList( host, items, opts )` / `clearKeyedList( host )` — Stable *(since 0.23.0)*

Keyed-list reconciler for any plugin that paints a dynamic list of items into a DOM container. Reuses element instances when keys match across renders so event listeners survive data updates — the only reliable way to keep clicks working on rows that may re-render mid-press.

```javascript
wp.desktop.renderKeyedList( hostEl, items, {
    keyOf:    ( item ) => item.id,
    buildItem ( item ) {
        const li = document.createElement( 'li' );
        li.dataset.id = String( item.id );
        // mousedown survives across re-renders because the element does:
        li.addEventListener( 'mousedown', () => onSelect( item ) );
        return li;
    },
    updateItem( el, item ) {
        el.querySelector( '.title' ).textContent = item.title;
    },
} );

// On unmount:
wp.desktop.clearKeyedList( hostEl );
```

**Why this matters.** Without keyed reconciliation, list re-renders typically do `host.innerHTML = ''` followed by a full rebuild. If the user is mid-press on a row when the repaint happens, `mousedown` fires on the OLD node, the rebuild destroys it, and `mouseup` lands on a new node — the browser does NOT synthesize a `click` and the user's tap silently does nothing. Use `mousedown` (not `click`) for selection-style listeners on elements that may be removed by future state changes.

---

### `registerNamespace( name, api )` — Stable *(since 0.23.0)*

Bless a plugin-owned subnamespace under `wp.desktop`. Plugins that ship their own public surface (`wp.desktop.<your-plugin>`) call this once at boot to publish their api object on the shell.

```javascript
wp.desktop.registerNamespace( 'my-plugin', {
    open:  () => { /* ... */ },
    close: () => { /* ... */ },
    state: () => readState(),
} );

// Later, in any other plugin:
wp.desktop[ 'my-plugin' ].open();
```

- **Re-registration is idempotent.** Calling with the same name replaces the previous registration so a plugin reload does the right thing.
- **Reserved names refuse to register.** Built-in keys (`windowManager`, `dock`, `presence`, `activity`, …) console.warn and are no-ops so a plugin can't accidentally shadow a built-in. Any non-conflicting name is allowed; conventional pattern is your plugin slug.

---

### `registerCommand( def )` — Stable
Registers a slash-command that appears in the AI Assistant palette (⌘K). The user types `/<slug>` to invoke your handler; arguments are whatever they type after the slug.

Registrations are live — if the palette is open when you call this, the new command shows up immediately. Re-registering the same slug replaces the previous definition.

**Definition shape:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `slug` | `string` | yes | Must match `/^[a-z0-9_-]+$/` |
| `label` | `string` | yes | Human-readable name shown in the palette |
| `description` | `string` | no | One-line description under the label |
| `hint` | `string` | no | Argument hint, e.g. `"[post id]"` |
| `icon` | `string` | no | Dashicons class, default `dashicons-arrow-right-alt` |
| `iconSvg` | `string` | no | *Since 0.16.0.* Raw `<svg>…</svg>` markup rendered inline; takes precedence over `icon`. Used internally by the iframe-command bridge to forward `@wordpress/icons` elements; plugins may set it when shipping a one-off glyph is easier than enqueueing a dashicon. |
| `eager` | `boolean` | no | *Since 0.16.0.* When `true`, the command appears on the empty-input palette without the user typing `/`. When falsy (default), it only surfaces after `/`. Eager and slash-only surfaces are **disjoint** — typing `/` hides eager commands. Use `eager: true` for contextual / always-relevant actions (block editor shortcuts, site-wide toggles); leave it off for utility commands the user deliberately invokes. |
| `owner` | `string` | no | Optional tag for grouped eviction via `unregisterByOwner()`. The iframe bridge uses `iframe:<windowId>`; plugins typically pass their script handle. |
| `suggest( args, ctx )` | `function` | no | Argument autocomplete. Returns or resolves to `CommandSuggestion[]`. When present, the palette renders a live list the user can navigate with ↑/↓ and commit with Tab / Enter. |
| `run( args, ctx )` | `function` | yes | Handler. `args` is the raw text after `/<slug> `. May be async. |

**`CommandSuggestion` shape:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `value` | `string` | yes | Inserted into the input when Tab-completed; received as `args` by `run()` when the user commits this suggestion. |
| `label` | `string` | yes | Rendered in the list. |
| `description` | `string` | no | Muted second line. |
| `icon` | `string` | no | Dashicons class. |

**`CommandContext` passed to `run` and `suggest`:**

- `ctx.close()` — dismiss the AI Assistant panel.
- `ctx.openInWindow( url, title, icon? )` — open a wp-admin URL in a legacy iframe window on the desktop.
- `ctx.confirm( message, details? ) → Promise<boolean>` *(since 0.14.0)* — ask the user to confirm a destructive action. Default implementation uses `window.confirm()`; the shell may swap a custom dialog later (the `Promise<boolean>` contract is stable). Use this from any command whose `run()` does something irreversible.

  ```javascript
  run: async ( args, ctx ) => {
      const ok = await ctx.confirm(
          'Close every open window?',
          'You will lose any unsaved iframe state.'
      );
      if ( ! ok ) return 'Cancelled.';
      const closed = wp.desktop.windowManager.closeAll();
      return `Closed ${ closed } window${ closed === 1 ? '' : 's' }.`;
  }
  ```

**Command lifecycle hooks** *(since 0.14.0)* — fire around every `run()`. Subscribe via `wp.hooks`:

| Hook | Type | Payload | Use |
|---|---|---|---|
| `wp-desktop.command.before-run` | filter | `{ proceed: true, slug, args, command }` → return same shape with `proceed: false` (and optional `reason`) to cancel | Capability gates, audit log, "developer mode only" commands |
| `wp-desktop.command.after-run` | action | `{ slug, args, command, result }` | Telemetry, post-run toast |
| `wp-desktop.command.error` | action | `{ slug, args, command, error }` | Centralised error reporting |

```javascript
// Block /close_all_windows for non-admin users.
wp.hooks.addFilter(
    'wp-desktop.command.before-run',
    'my-plugin/gate',
    ( gate ) => {
        if ( gate.slug === 'close_all_windows' && ! wpDesktopConfig.currentUserIsAdmin ) {
            return { ...gate, proceed: false, reason: 'Admins only.' };
        }
        return gate;
    }
);
```

When `proceed` is `false` the assistant renders the optional `reason` (or a generic "cancelled" message) and never invokes the handler.

**Return value** — the handler may return any of:

- `void` / `undefined` — silent success. Useful when you've called `ctx.close()` or performed a side-effect.
- `"a string"` — shorthand for a plain chat bubble.
- `{ message, answer_type?, admin_links?, entity? }` — full AI-answer shape. `answer_type` is `"chat"` by default.

**Minimal example — `/echo hello → hello`:**

```javascript
window.wp.desktop.registerCommand( {
    slug: 'echo',
    label: 'Echo',
    description: 'Repeat the arguments back as a message.',
    hint: '[text]',
    icon: 'dashicons-format-chat',
    run: ( args ) => args.trim() || 'Usage: /echo [text]',
} );
```

Type `/echo hello` → the assistant replies with `hello`. Type `/echo` with no args → it replies with the usage hint.

**Richer example — `/turn_on_comments` with a REST call:**

```javascript
window.wp.desktop.registerCommand( {
    slug: 'turn_on_comments',
    label: 'Turn on comments',
    description: 'Re-enable the comments section on a given post.',
    hint: '[post id]',
    icon: 'dashicons-admin-comments',
    run: async ( args, ctx ) => {
        const id = parseInt( args.trim(), 10 );
        if ( ! id ) return 'Usage: /turn_on_comments [post id]';

        await fetch( `/wp-json/my-plugin/v1/enable-comments/${ id }`, {
            method:  'POST',
            headers: { 'X-WP-Nonce': wpDesktopConfig.restNonce },
        } );

        ctx.close();
        return `Comments enabled on post ${ id }.`;
    },
} );
```

**Errors** thrown from `run` are caught and rendered as an error bubble — the panel doesn't crash.

**Live-refresh on plugin install/activate.** If your plugin's script is declared via `desktop_mode_register_command_script()` (see the PHP docs), the shell injects it into the current shell page when the user installs or activates your plugin — your commands appear in the palette **without a reload**. For live *unregistration* on deactivation, set `owner` to the same WordPress script handle:

```javascript
window.wp.desktop.registerCommand( {
    slug:  'ha-lights',
    label: 'Home Assistant: Lights',
    owner: 'home-assistant-commands', // must match the WP script handle
    run:   ( args, ctx ) => { /* … */ },
} );
```

Commands without `owner` still register live on activation; they only persist past a deactivation until the next page reload (graceful backwards-compat).

---

### `unregisterCommand( slug )` — Stable
Remove a previously registered command. Idempotent.

```javascript
window.wp.desktop.unregisterCommand( 'echo' );
```

---

### `listCommands()` — Stable
Returns a snapshot of every currently registered command as an array. Useful for a debug console or a "help" meta-command.

```javascript
window.wp.desktop.listCommands().forEach( ( c ) => console.log( `/${ c.slug } — ${ c.label }` ) );
```

---

### `wp.desktop.ai.ask( query, opts? )` — Experimental  *(since 0.17.0)*

Programmatic access to the AI Copilot — same endpoint the built-in overlay talks to. Resolves to an `AskResult`; rejects on network errors, HTTP failures, or abort.

```javascript
const res = await wp.desktop.ai.ask( 'where do I manage categories?' );
// res = { answer_type: 'navigation', message: '…', admin_links: [ … ], request_id: '…' }
```

**`AskOptions`:**

| Field | Type | Notes |
|---|---|---|
| `signal` | `AbortSignal` | Cancels the underlying `fetch`. Rejections are `DOMException('AbortError')` — handle them separately from real errors. |
| `resumeTool` | `'search_posts' \| 'search_pages' \| 'search_comments'` | Continue an exhausted search. Pass the `tool` from a prior `res.continue`. |
| `startOffset` | `number` | Accompanies `resumeTool`. |
| `tools` | `false \| 'aiCallable' \| string[] \| (slug) => boolean` | Opt into command-as-tool dispatch. See "Commands as AI tools" below. |
| `followUp` | `boolean` | Default `false`. When `true`, after a command runs, `ask()` fires a **second** `/ai/search` request carrying the tool's return value so the AI can compose a natural-language confirmation in the voice of the system prompt. See "Natural-language replies" below. |
| `systemPrompt` | `string \| { mode: 'append' \| 'replace', text: string }` | Override the system prompt. String shorthand = append. `replace` requires `manage_options` server-side; non-admin callers get a silent downgrade to append. |
| `commandContext` | `CommandContext` | Passed to any command's `run()` when the AI invokes one. Defaults to a minimal stub (closes assistant, opens URLs in legacy windows). |

**`AskResult`:**

```ts
{
    answer_type: 'entity' | 'navigation' | 'chat' | 'tool_call';
    message: string;
    entity?: CommandEntity | null;
    admin_links?: CommandAdminLink[] | null;
    toolCall?: {                    // present only when answer_type === 'tool_call'
        slug: string;
        args: string;
        result: CommandResult | { error: string };
    };
    request_id?: string;            // server-issued UUID for tracing
    continue?: { tool, offset, label } | null;
}
```

**Commands as AI tools.**

Mark a command `aiCallable: true` to opt it in, then pass `tools: 'aiCallable'` (or a predicate) when calling `ask()`:

```javascript
wp.desktop.ready( () => {
    wp.desktop.registerCommand( {
        slug: 'turn_lights',
        label: 'Turn lights on/off',
        description: 'Toggle smart lights.',
        hint: 'ON or OFF',
        aiCallable: true,                     // ← opt-in
        run: ( args, ctx ) => {
            const state = args.trim().toUpperCase();
            // ...call Home Assistant...
            return `Lights ${ state }.`;
        },
    } );
} );

// Later — from a voice plugin, a chat widget, an automation:
const res = await wp.desktop.ai.ask( 'hey turn on the lights', {
    tools: 'aiCallable',
} );
// res.answer_type === 'tool_call'
// res.toolCall === { slug: 'turn_lights', args: 'ON', result: 'Lights ON.' }
// res.message   === 'Lights ON.'  // string returns are lifted into message
```

Why opt-in: AI tool-calling is a paraphrasing channel, and handing the model every registered command (including destructive ones like `/delete_all_posts`) would turn a typo into a catastrophe. `aiCallable` is the single flag each command author decides for themselves. The PHP-side filter `desktop_mode_ai_command_allowed` provides a second line of defence for per-role gating.

**Security notes.**

1. The server never executes a client-harvested command — it returns `{ answer_type: 'tool_call', tool: { slug, args } }` and the client invokes `run()` locally. The model can't reach through to any server-side code via this path.
2. For server-side tools, use [`desktop_mode_register_ai_tool()`](./hooks-reference.md#desktop_mode_register_ai_tool-args--stable-php-function-since-0170). Handlers are capability-gated and the registry is invisible to callers who don't have the cap.
3. Command `description` is fed to the model verbatim — treat it as untrusted surface for plugin authors exactly as you'd treat any other plugin string.

**Natural-language replies — `followUp: true`**

By default, `ask()` runs in **one-shot** mode: when the AI picks a command, `res.message` is whatever the command's `run()` returned (typically a short status string like `"Light is ON."`). That's fast and cheap — one OpenAI round-trip — but the AI never actually writes anything about the action.

Opt into **agentic** mode with `followUp: true` and `ask()` fires a second `/ai/search` request after the command runs. The server summarises the outcome in the voice of the system prompt:

```javascript
const res = await wp.desktop.ai.ask( 'hey turn on the office light', {
    tools:     'aiCallable',
    followUp:  true,
} );

// Before (one-shot):
// res.message === 'Light is ON.'                            ← raw run() return

// After (followUp):
// res.message === 'Done — your office light is on now. Anything else?'
```

- **Cost:** one extra OpenAI call per command invocation.
- **Latency:** roughly doubles (call 1 + local run + call 2).
- **Degradation:** if the second leg fails (network, API), `ask()` **does not throw** — `res.toolCall.result` is preserved and `res.message` falls back to the one-shot string. The command *ran*; losing the composed reply is a degraded experience, not an error.
- **AbortSignal:** aborting during either leg rejects with `AbortError` as usual.
- **Irrelevant for non-tool_call responses:** if the AI answers with `entity`, `navigation`, or `chat`, `followUp: true` is a no-op (there's no tool outcome to summarise).

When to use it:
- **Yes — voice / chat / assistant surfaces.** Users expect a conversational reply.
- **Yes — wrap around plugin commands that return objects, not strings.** `{ total: 42, items: [...] }` is not a user-friendly message; let the AI phrase it.
- **Skip — one-tap "execute" buttons.** Raw `run()` return is already fine and users don't need extra latency.

**AbortSignal example:**

```javascript
const controller = new AbortController();
setTimeout( () => controller.abort(), 5000 );

try {
    const res = await wp.desktop.ai.ask( 'find my post about málaga', {
        signal: controller.signal,
    } );
} catch ( err ) {
    if ( err instanceof DOMException && err.name === 'AbortError' ) {
        // user-visible cancellation
    } else {
        throw err;
    }
}
```

See also: [`docs/examples/ai-ask.md`](./examples/ai-ask.md).

---

### `registerTitleBarButton( def )` — Experimental  *(since 0.17.0)*

Add a custom button to the title bar of any matching window. The right surface for cross-window verbs ("connect to", "live preview", "broadcast"). Predicate decides which windows show the button; you can render an `<wpd-window-button>` with a click handler, or own the host entirely with a custom `render`.

**Returns** `true` on success, `false` on validation failure (a `console.warn` names the bad field, so you can branch on the return value AND log goes through your own monitor pipeline).

**`TitleBarButtonDef`:**

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | Unique. `[a-z0-9_/-]+` — same `vendor/sub-id` shape that `desktop_mode_register_window` / `desktop_mode_register_widget` accept (slashes welcome). Wider than `registerCommand`'s slug or `registerSettingsTab`'s id, which can't use slashes (those values are also used in slash-command parsing / CSS selectors). Re-registering replaces. |
| `label` | `string` | Tooltip + aria-label. |
| `icon` | `string` | Dashicons class (`'dashicons-foo'`), inline SVG (`'<svg>…</svg>'`), or built-in key (`'minimize'` / `'menu'` / etc.). |
| `placement` | `'left' \| 'right'` | Default `'left'` (next to title). `'right'` lands before the window controls. |
| `order` | `number` | Default 100. Sorts within placement. |
| `match` | `( window ) => boolean` | Predicate against the live `Window` instance. Throwing equals not-matching. |
| `onClick` | `( window, ev ) => void` | Optional. Fires **exactly once per user activation** — wired to the button's `wpd-button-activate` CustomEvent (not raw `click`), so no doubles, no swallowed events when the title-bar drag tracker races. Skip if you use `render`. |
| `render` | `( host, window ) => void` | Optional. Owns the `<wpd-window-button>` host entirely; bind your own click + dropdown. |
| `owner` | `string` | Optional. Set to your script handle for live-unregister-on-deactivate. |

```javascript
wp.desktop.ready( () => {
    wp.desktop.registerTitleBarButton( {
        id:    'live-preview/connect',
        label: 'Live preview',
        icon:  'dashicons-visibility',
        match: ( w ) => w.config.url?.includes( 'post.php' ) ?? false,
        onClick: ( hostWindow ) => {
            // Show a popover of other open windows; on hover, highlight; on click, connect.
        },
        owner: 'my-plugin-titlebar',
    } );
} );
```

PHP companion (so plugins activated mid-session paint live):

```php
desktop_mode_register_titlebar_button_script( 'my-plugin-titlebar' );
```

---

### `Window.setTitle( title )` — Stable

Update a window's title bar from outside it. Useful for plugins that want to retitle a preview window as the user types ("Live Preview — My Post"), prefix with status, etc. Fires `wp-desktop.window.title-changed` with `{ windowId, title }` so other subscribers can react.

```javascript
const w = wp.desktop.windowManager.getById( 'my-preview' );
w.setTitle( `Live Preview — ${ postTitle }` );
```

---

### `Window.markContentLoading()` / `Window.markContentLoaded()` — Stable *(since 0.6.0)*

Drive the spinner overlay over a window's body programmatically. Mirrors the `ctx.window.markLoading` / `ctx.window.markReady` pair available inside a native `render` callback — these methods are the equivalent for code that holds a `Window` instance from outside.

```javascript
const w = wp.desktop.windowManager.getById( 'my-app' );

// Show the spinner (e.g. before refetching the body's data).
w.markContentLoading();

await refetchData();
w.appendBody( renderTable( data ) );

// Hide the spinner, fade the content in.
w.markContentLoaded();
```

Idempotent: calling `markContentLoading()` twice in a row only fires `WINDOW_CONTENT_LOADING` once; the same edge-trigger logic applies to `markContentLoaded()`.

The framework calls `markContentLoaded()` automatically when:
- An iframe window's chromeless bridge posts `wp-desktop-ready`.
- A native window's `render( body )` callback returns synchronously (next animation frame).
- A native window's `render( body )` returns a `Promise` (when the promise resolves).

Plugins only need to call these directly for **refetch** patterns or for **event-listener-driven async loads** the framework can't observe.

See also: [the `wp-desktop-window-content-loaded` CustomEvent](#wp-desktop-window-content-loaded--stable-since-060) and the [`HOOKS.WINDOW_CONTENT_LOADED`](#hookswindow_content_loaded) action.

---

### `Window.setHighlight( mode, opts? )` — Experimental  *(since 0.17.0)*

Toggle a visual ring on a window from outside it.

```javascript
const w = wp.desktop.windowManager.getById( 'edit-post' );
w.setHighlight( 'preview' );           // temporary ring (clear yourself on mouseleave)
w.setHighlight( 'persistent' );        // sticky ring
w.setHighlight( null );                // clear
w.setHighlight( 'preview', { color: '#f59e0b' } );  // override colour
```

`'preview'` and `'persistent'` are visually distinct; the shell does NOT auto-clear either — that's the caller's responsibility. CSS variable: `--wp-window-highlight-color` (default `--wp-admin-theme-color`).

Every change fires `HOOKS.WINDOW_HIGHLIGHT_CHANGED` on the hook bus *(since 0.24.0)* with `{ windowId, mode, color? }`, so onboarding / drag-bridge / guidance plugins can react without observing DOM mutations:

```js
wp.desktop.hooks.addAction(
    wp.desktop.HOOKS.WINDOW_HIGHLIGHT_CHANGED,
    'my-plugin/highlight-tracker',
    ( { windowId, mode } ) => { /* … */ },
);
```

---

### `Window.shake()` — Stable *(since 0.22.11)*

Briefly jiggle the window element horizontally — the classic MSN-Messenger nudge affordance. Lets any plugin request "look at me" attention on its own window programmatically (e.g. a chat plugin on inbound nudge, a CI plugin on a broken build).

```javascript
const w = wp.desktop.windowManager.getById( 'my-window' );
w.shake();
```

Composes with the inline `left`/`top` the window manager writes (the shake is a CSS `transform`, not a position change). Auto-clears on `animationend`. If a second shake is requested while one is mid-flight, the class is removed and re-added so the animation restarts.

**Reduced-motion fallback:** a static accent ring for the same duration. Plugins that want to mute shakes for a specific window can register a `wp-desktop.window.shake` filter that returns `false`:

```javascript
wp.hooks.addFilter(
    'wp-desktop.window.shake',
    'my-plugin/no-shake',
    ( allow, { windowId } ) => ( windowId === 'my-window' ? false : allow ),
);
```

---

### `wp.desktop.connect( windowId, opts? )` — Experimental  *(since 0.17.0)*

Open a typed pub/sub channel with another window's iframe. Returns a `WindowConnection`. Ideal for plugins that need to listen to or talk to content inside an iframe — first use case: live-preview a Gutenberg editor.

```javascript
const conn = wp.desktop.connect( 'edit-post', {
    topics: [ 'gutenberg:content' ],
    onOpen: () => console.log( 'iframe handshake done' ),
    onClose: ( reason ) => console.log( 'closed:', reason ),
} );

const off = conn.subscribe( 'gutenberg:content', ( html ) => {
    document.querySelector( '#preview' ).innerHTML = html;
} );

conn.send( 'preview:zoom', { factor: 1.5 } );
off();              // unsubscribe single topic
conn.disconnect();  // tear the whole connection down
```

**`WindowConnection` shape:**

| Field | Notes |
|---|---|
| `id` | Unique connection id (for trace correlation). |
| `target` | The window id this connection points at. |
| `isOpen()` | `true` after the iframe acks the handshake. |
| `subscribe( topic, cb )` | Returns unsubscribe. Use `'*'` for a wildcard. |
| `send( topic, payload )` | Messages sent before the iframe acks are queued and flushed in order. |
| `disconnect()` | Idempotent. Fires `onClose( 'disconnect' )`. |

**Lifecycle reasons handed to `onClose`:** `'disconnect'`, `'window-closed'`, `'navigated'`.

Cross-origin guard: every postMessage is sent + accepted only on the shell's `window.location.origin`. Plugin-provided topic names + payloads pass through verbatim — sanitise before publishing if the payload could include user-typed HTML.

---

### `wp.desktop.send` / `wp.desktop.on` — Stable *(since 0.5.5)*

**Window-side counterpart to `Window.send/on`.** Available on every chromeless wp-admin page (the shell injects it into the page footer) AND inside every native render's render context. **The single, unified API plugin authors use to talk to / from a window's content — same shape regardless of whether the window is an iframe or a pure-native render.**

**Inside an iframe** (chromeless wp-admin page or `iframeContent` body):

```javascript
// Tell the parent that the editor saved.
wp.desktop.send( 'editor:saved', { path: '/wp-content/...', size: 1234 } );

// Listen for parent → window messages.
const off = wp.desktop.on( 'editor:open-file', ( { path, line } ) => {
    openFile( path, line );
} );
```

**Inside a native render callback** — the second arg of the render carries a window-scoped binding so plugin authors don't need to look up their own window:

```javascript
wp.desktop.registerWindow( {
    id: 'my-tool',
    render: ( body, { window } ) => {
        body.querySelector( 'button.save' ).addEventListener( 'click', () => {
            window.send( 'tool:saved', { id: 42 } );
        } );
        const off = window.on( 'tool:reset', () => { /* … */ } );
        return () => off();
    },
} );
```

**On the parent side** (anywhere outside the window), use `Window.send/on` — the symmetric counterpart. The same channel name reaches the same subscribers.

```javascript
const win = wp.desktop.windowManager.getById( 'my-tool' );
win.send( 'tool:reset', {} );           // → wp.desktop.on( 'tool:reset' ) inside the window
win.on( 'tool:saved', ( payload ) => {  // ← wp.desktop.send( 'tool:saved' ) inside the window
    log( 'saved', payload );
} );
```

**Why this matters.** Pre-0.5.5 the iframe-side API was namespaced as `wp.desktop.iframe.*` and pure-native windows had no equivalent — plugin authors targeting native windows had to reach into the DOM. The `send/on` pair removes the leak: same code on either side, same code regardless of render strategy.

---

### `wp.desktop.iframe.publish` / `subscribe` / `onConnection` — Experimental  *(since 0.17.0)*

Iframe-side counterpart to `wp.desktop.connect()` — the older multi-listener / handshake-aware bridge. Most plugin code should reach for [`wp.desktop.send` / `wp.desktop.on`](#wpdesktopsend--wpdesktopon--stable-since-055) instead; this surface is only useful when (a) the iframe wants to know how many parent-side callers are listening (`onConnection`), or (b) the iframe wants to broadcast on a topic that fans out to every open `connect()` rather than to a single window-scoped channel.

```javascript
// Inside an iframe — e.g. a plugin script that runs on post.php:
wp.desktop.iframe.onConnection( () => {
    const editor = wp.data.select( 'core/editor' );
    wp.data.subscribe( () => {
        wp.desktop.iframe.publish(
            'gutenberg:content',
            editor.getEditedPostContent(),
        );
    } );
} );

// Receive parent → iframe traffic too:
wp.desktop.iframe.subscribe( 'preview:zoom', ( payload ) => {
    document.body.style.zoom = String( payload.factor );
} );
```

`publish( topic, payload )` fans the message out to every parent-side connection currently open against this iframe. `onConnection` callbacks are replayed for currently-open connections, so a late registration still sees who's already there.

**Lifecycle hooks** (parent-side, observability):

```javascript
wp.desktop.hooks.addAction( 'wp-desktop.connection.opened', 'me', ( e ) => {
    // e = { connectionId, targetWindowId, topics }
} );
wp.desktop.hooks.addAction( 'wp-desktop.connection.closed', 'me', ( e ) => {
    // e = { connectionId, reason }
} );
wp.desktop.hooks.addAction( 'wp-desktop.connection.message', 'me', ( e ) => {
    // e = { connectionId, topic, direction: 'in' | 'out' }
    // High-volume — keep subscribers cheap.
} );
```

See [`docs/examples/connect-to-window.md`](./examples/connect-to-window.md) for the full live-preview recipe.

---

### `registerSettingsTab( def )` — Stable *(since 0.17.0)*

Register a tab in the OS Settings window. The tab is appended (or sorted-in by `order`) alongside the built-in tabs — Appearance, AI Settings, Extended Options, Help — and renders its body via your `render( body, ctx )` callback.

**Definition shape:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | `string` | yes | Unique. `[a-z0-9_-]+`. Re-registering with the same id replaces the previous entry. |
| `label` | `string` | yes | Tab label. |
| `capability` | `string` | no | Gates visibility. `'manage_options'` → admin-only; any other value (including omitting) → visible to everyone. |
| `order` | `number` | no | Default `100`. Built-ins: appearance=10, ai=20, extended=30, help=40. |
| `owner` | `string` | no | When set, plugin deactivation live-unregisters every tab with this owner. Typically matches the WordPress script handle registered with `desktop_mode_register_settings_tab_script()`. |
| `render( body, ctx )` | `function` | yes | Receives the tabpanel body element and a ctx object (see below). Must be idempotent — the panel rebuilds on state resets. |

**`ctx` shape:**

| Field | Type | Notes |
|---|---|---|
| `isAdmin` | `boolean` | `true` when current user has `manage_options`. |
| `getOsSettings()` | `function` | Snapshot of the persisted OS Settings state — `{ wallpaper, accent, dockSize, ai: { enabled, provider, apiKey } }`. Read-only; returns a defensive copy. Equivalent to what the built-in AI tab sees. |
| `subscribeOsSettings( cb )` | `function` | Subscribe to in-panel OS Settings changes (user edits the AI key in the adjacent AI tab, etc.). Returns an unsubscribe function. Fires on local edits only — cross-device changes arrive on the next page load. |

```javascript
// Use `wp.desktop.ready()` (not `addAction( 'wp-desktop.init', … )`) —
// plugin settings scripts are loaded via server-sync AFTER
// `wp-desktop.init` has already fired, so a raw addAction callback
// would never run. `ready()` handles both the already-fired and
// not-yet-fired cases. See "Bootstrap" above for the full story.
wp.desktop.ready( () => {
    wp.desktop.registerSettingsTab( {
        id:         'my-plugin',
        label:      'My Plugin',
        capability: 'manage_options',
        order:      50,
        owner:      'my-plugin-settings',
        render( body, ctx ) {
            // Layout: use <wpd-section stack> (or <wpd-stack> inside a
            // vanilla <wpd-section>) so children get consistent gap.
            // The default slot of <wpd-section> has no gap — cramped
            // is the default without opt-in.
            body.innerHTML = `
                <wpd-section
                    heading="My Plugin"
                    description="Configure the plugin."
                    stack
                >
                    <wpd-text-field label="Name"></wpd-text-field>
                    <wpd-button>Save</wpd-button>
                </wpd-section>
            `;

            // Read current AI settings configured in the adjacent AI tab.
            const { apiKey } = ctx.getOsSettings().ai;
            console.log( 'current OpenAI key length:', apiKey.length );

            // Re-read when the user edits settings elsewhere in the
            // panel. Unsubscribe on next re-render / window close.
            const off = ctx.subscribeOsSettings( ( next ) => {
                console.log( 'settings changed — new key len:', next.ai.apiKey.length );
            } );

            // Clean up if the body is detached (window closed, reset clicked).
            const mo = new MutationObserver( () => {
                if ( ! body.isConnected ) {
                    off();
                    mo.disconnect();
                }
            } );
            mo.observe( body.parentNode ?? body, { childList: true } );
        },
    } );
} );
```

Tabs registered after the OS Settings window is already open repaint live — the panel subscribes to the registry.

**Layout tip — `<wpd-section stack>`**

The default slot of `<wpd-section>` has no gap between children. For third-party tabs that put raw fields directly in the slot, opt into flex-column layout with the `stack` attribute:

```html
<wpd-section heading="Settings" stack>
    <wpd-text-field label="Name"></wpd-text-field>
    <wpd-checkbox-label label="Enabled"></wpd-checkbox-label>
    <wpd-button>Save</wpd-button>
</wpd-section>
```

Gap is `--wpd-section-gap` (default `12px`). Alternative: wrap the content in an explicit `<wpd-stack>`. Built-in sections omit `stack` because their slotted components already carry their own `margin-block-end`.

**Inline code — `<wpd-code>`**  *(since 0.17.0)*

Use `<wpd-code>` for inline URLs, flag names, slugs, or any monospace string. **Don't** use `<wpd-key>` for these: `<wpd-key>` installs a global `keydown` listener so the tile flashes on matching keystrokes — rendering `chrome://flags` inside a `<wpd-key>` would steal `c`, `h`, `r`, `o`, `m`, `e`. `<wpd-code>` has no listeners.

```html
Open <wpd-code>chrome://flags</wpd-code> and enable
<wpd-code>experimental-web-platform-features</wpd-code>.

<wpd-code block>
desktop_mode_register_settings_tab( array(
    'id'    => 'my-plugin',
    'label' => 'My Plugin',
) );
</wpd-code>
```

**Ordered steps — `<wpd-steps>` + `<wpd-step>`**  *(since 0.17.0)*

Auto-numbered setup / onboarding flows. Numbers come from a CSS counter, so inserting or removing a `<wpd-step>` renumbers the rest automatically. Set `done` on a step to render a ✓ chip instead of the number.

```html
<wpd-steps>
    <wpd-step title="Install the plugin">
        Search the plugin directory for “My Plugin” and click Install.
    </wpd-step>
    <wpd-step title="Open Settings">
        Go to <wpd-code>Settings → My Plugin</wpd-code>.
    </wpd-step>
    <wpd-step title="Enter your API key" done>
        Already done earlier in this flow.
    </wpd-step>
</wpd-steps>
```

For live *unregistration on deactivation*, either set `owner` (as above) to your script handle, or declare the tab with `desktop_mode_register_settings_tab()` in PHP.

---

### `unregisterSettingsTab( id )` — Stable *(since 0.17.0)*

Remove a previously registered tab. Idempotent.

```javascript
wp.desktop.unregisterSettingsTab( 'my-plugin' );
```

---

### `listSettingsTabs()` — Stable *(since 0.17.0)*

Snapshot of every currently registered third-party settings tab, sorted by `order`. Built-in tabs are not included.

---

### `registerPalette( def )` — Stable  *(since 0.14.0)*

Register a Cmd+K-triggered overlay ("palette"). The shell owns a single global shortcut handler that **cycles** through every registered palette — first press opens palette 0, second press closes it and opens palette 1, and so on. Pressing Cmd+K when the last palette is open closes it entirely; the next press re-opens palette 0.

This means multiple plugin palettes, plus the built-in AI Assistant, coexist without stealing each other's keybinding.

**Definition shape:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | `string` | yes | Stable identifier. Re-registering the same id replaces the previous entry. |
| `label` | `string` | no | For debug / a future picker UI. |
| `open()` | `function` | yes | Show the palette UI. |
| `close()` | `function` | yes | Hide the palette UI. |
| `isOpen()` | `function` | yes | Synchronous — return `true` if the palette is currently visible. The cycle reads this on every Cmd+K press. |

Returns an **unsubscribe function**. Plugins that register at shell-load time typically don't need it, but HMR / late teardown use cases should call it.

```javascript
wp.desktop.ready( () => {
    const unregister = wp.desktop.registerPalette( {
        id:     'my-plugin/launcher',
        label:  'My Quick Launcher',
        open:   () => myLauncher.show(),
        close:  () => myLauncher.hide(),
        isOpen: () => myLauncher.visible,
    } );
} );
```

The built-in AI Assistant is already registered as palette 0 (`id: 'wp-desktop-ai-assistant'`) — your palette lands at position 1 and the cycle goes AI → yours → closed → AI → …

---

### `unregisterPalette( id )` — Stable  *(since 0.14.0)*

Remove a palette from the cycle. Idempotent.

```javascript
window.wp.desktop.unregisterPalette( 'my-plugin/launcher' );
```

---

### `listPalettes()` — Stable  *(since 0.14.0)*

Snapshot of all palettes in registration order.

---

### `openPalette( id )` — Stable  *(since 0.14.0)*

Open one palette by id, closing any other palette that's currently visible. Useful for deeplinks, menu items, or programmatic triggers that should target a specific palette rather than advance the cycle.

```javascript
window.wp.desktop.openPalette( 'my-plugin/launcher' );
```

---

### Built-in `/open` — Stable
The shell registers one built-in command at boot: `/open [window]`. It opens any admin menu entry (dock or taskbar) in a legacy iframe window — `/open Posts`, `/open Plugins`, `/open Media`, etc. Autocomplete starts empty; as the user types, the list filters by case-insensitive substring match against label and id.

Plugins extend the `/open` autocomplete via the **`wp-desktop.open-command.items`** filter:

```javascript
wp.hooks.addFilter(
    'wp-desktop.open-command.items',
    'my-plugin',
    ( items ) => [
        ...items,
        {
            id: 'jorvy',
            label: 'Jorvy',
            description: 'Marvel quotes',
            icon: 'dashicons-star-filled',
            open: () => wp.desktop.windowManager.focus( 'jorvy' ),
        },
    ],
);
```

Each entry is `{ id, label, description?, icon?, open }`. The filter runs every time the user opens the palette, so a plugin can show/hide entries dynamically (e.g. by user capability).

---

### Example: a command with `suggest()` autocomplete

```javascript
window.wp.desktop.registerCommand( {
    slug:  'assign_author',
    label: 'Assign author',
    hint:  '[post id] [username]',
    icon:  'dashicons-admin-users',

    // Async suggestions — fetch users from the REST API as the
    // user types the second argument.
    suggest: async ( args ) => {
        const parts = args.split( /\s+/ );
        if ( parts.length < 2 ) return [];  // still typing post id
        const q = parts[ 1 ];
        if ( q.length < 2 ) return [];

        const res = await fetch( `/wp-json/wp/v2/users?search=${ encodeURIComponent( q ) }` );
        const users = await res.json();
        return users.map( ( u ) => ( {
            value: `${ parts[ 0 ] } ${ u.slug }`,
            label: u.name,
            description: `@${ u.slug }`,
            icon: 'dashicons-admin-users',
        } ) );
    },

    run: async ( args, ctx ) => {
        // ...
    },
} );
```

---

## 3. `postMessage` bridge

For communication between the parent shell and iframe admin pages. Every message is validated for `event.origin === window.location.origin`.

> **Most plugin authors should never look at this section.** The unified [`Window.send/on`](#windowsend-channel-payload---stable-since-055) and iframe-side [`wp.desktop.send/on`](#wpdesktopsend--wpdesktopon--stable-since-055) hide every postMessage type catalogued below. This section is for: (a) debugging the bridge, (b) writing low-level shell internals, (c) integrating an iframe page that doesn't enqueue the standard `wp-desktop-iframe-bridge` script. If your goal is "tell my window's content something happened," reach for `Window.send/on` first.

### iframe → parent

All messages are dispatched via `window.parent.postMessage( { type, ... }, window.location.origin )` from inside the chromeless admin iframe.

#### `wp-desktop-window-publish` — Stable *(since 0.5.5)*

The unified channel-API outbound primitive. Posted internally by `wp.desktop.send( channel, payload )` inside the iframe. The parent shell forwards every match to `Window.on( channel, cb )` subscribers for this iframe's window. **Plugin authors should call `wp.desktop.send` instead of posting this manually** — the latter is documented for debugging.

```typescript
{ type: 'wp-desktop-window-publish'; channel: string; payload?: unknown }
```

#### `wp-desktop-title-change` — Stable
Update the window's title bar.

```typescript
{ type: 'wp-desktop-title-change'; title: string }
```

#### `wp-desktop-navigate` — Stable
Request a navigation from the iframe. `target: 'new'` opens a new browser tab (with `noopener,noreferrer`); `'self'` replaces the iframe's current page. The URL is validated same-origin against the shell's origin snapshot — cross-origin URLs are silently refused, so an iframe cannot use this to break out of the shell.

```typescript
{ type: 'wp-desktop-navigate'; url: string; target: 'self' | 'new' }
```

#### `wp-desktop-notification` — Stable
Raise a transient toast at the parent-shell level. The toast survives the iframe's lifecycle — a "Settings saved" message stays visible even after the user closes the window that triggered it. Title is required; body is optional (concatenated with an em-dash when present). Empty titles are dropped.

```typescript
{ type: 'wp-desktop-notification'; title: string; body?: string }
```

#### `wp-desktop-ready` — Stable
Posted once by the chromeless bridge script when its message listeners are attached. Dispatches `HOOKS.IFRAME_READY` on the parent with `{ windowId }`. Prefer subscribing to `IFRAME_READY` over the browser's native iframe `load` event when timing matters — `load` fires before our bridge wires up, so messages sent on `load` can race the listener and drop.

```typescript
{ type: 'wp-desktop-ready' }
```

#### `wp-desktop-focus-request` — Stable
Posted by the chromeless bridge on every pointerdown inside the iframe. The parent focuses the window, unless it's currently in the overview grid (where clicks are absorbed by the grid controller).

```typescript
{ type: 'wp-desktop-focus-request' }
```

#### `wp-desktop-external-link` — Stable
Posted when a link inside the iframe points off-site; the parent opens an external-tab card inside the window's tab strip.

```typescript
{ type: 'wp-desktop-external-link'; url: string; label?: string }
```

#### `wp-desktop-iframe-error` — Stable
Posted from inside the chromeless iframe's `error` / `unhandledrejection` handlers. The parent re-dispatches as `HOOKS.IFRAME_ERROR` with `{ windowId, kind, message, filename, lineno, colno, stack }` so monitor widgets can subscribe.

```typescript
{
    type: 'wp-desktop-iframe-error';
    kind: 'error' | 'unhandledrejection';
    message: string;
    filename?: string;
    lineno?: number;
    colno?: number;
    stack?: string;
}
```

#### `wp-desktop-iframe-network` — Stable
Posted by the chromeless bridge's `fetch` and `XMLHttpRequest` wrappers whenever an HTTP call completes (success or failure). The parent re-dispatches as `HOOKS.IFRAME_NETWORK_COMPLETED` with `{ windowId, method, url, status, duration, failed }`. `status === 0` indicates a network-level failure before a response arrived.

```typescript
{
    type: 'wp-desktop-iframe-network';
    method: string;
    url: string;
    status: number;
    duration: number;
    failed: boolean;
}
```

#### `wp-desktop-screen-meta` — Stable
Announces the screen-meta panels (Screen Options / Help) that the iframe page exposes. The parent renders corresponding title-bar buttons.

```typescript
{ type: 'wp-desktop-screen-meta'; panels: ( 'screen-options' | 'help' )[] }
```

#### `wp-desktop-screen-meta-state` — Stable
Reports which screen-meta panel (if any) is currently open inside the iframe.

```typescript
{ type: 'wp-desktop-screen-meta-state'; open: 'screen-options' | 'help' | null }
```

#### `wp-desktop-commands-list` — Experimental
Reports the current `wp.data.select('core/commands')` registry of this iframe to the parent shell. Emitted after the iframe receives `wp-desktop-commands-subscribe`, and then re-emitted (de-duplicated) whenever a re-render of the in-iframe React harvester changes the merged list. The parent re-publishes each entry as a slash-command in the shell palette tagged `owner: 'iframe:<windowId>'` and `eager: true` so the command surfaces before the user types `/`.

Collection spans tier-2 (context-scoped `getCommands(true)`) and tier-3 (dynamic `getCommandLoaders(true)` hooks — invoked inside a mounted React tree so the rules of hooks hold). Global tier-1 navigation commands are deliberately skipped: the user already has them via the dock.

Each `HarvestedCommand` carries a `kind` field the iframe computes by **statically matching** `callback.toString()` against a string-literal navigation target (`location.href = '…'`, `.assign('…')`, `.replace('…')`). An earlier dry-run approach triggered infinite window spawning because `Location.prototype.href` is non-configurable — the shim silently failed and every nav callback actually navigated. Computed URLs fall back to `action` and proxy back into the iframe via `wp-desktop-commands-invoke`.

`iconSvg` carries the `@wordpress/icons` React element flattened to SVG markup via `wp.element.renderToString`; the structured-clone algorithm behind `postMessage` would refuse the raw element.

```typescript
{
    type: 'wp-desktop-commands-list';
    commands: Array<{
        name: string;
        label: string;
        icon?: string;     // dashicons class, if the source icon was a string
        iconSvg?: string;  // rendered <svg>…</svg> markup for React icons
        context?: string;
        kind: 'navigate' | 'action';
        url?: string;
    }>;
}
```

---

### parent → iframe

```javascript
iframe.contentWindow.postMessage( { type, ... }, window.location.origin );
```

#### `wp-desktop-window-send` — Stable *(since 0.5.5)*

The unified channel-API inbound primitive. Posted internally by `Window.send( channel, payload )` for iframe targets. Inside the iframe the bridge forwards each match to `wp.desktop.on( channel, cb )` subscribers. **Plugin authors should call `Window.send` instead of posting this manually** — the latter is documented for debugging.

```typescript
{ type: 'wp-desktop-window-send'; channel: string; payload?: unknown }
```

#### `wp-desktop-focus` — Stable
Instructs the iframe that its containing window has been focused.

```typescript
{ type: 'wp-desktop-focus' }
```

#### `wp-desktop-color-scheme` — Stable
Notifies the iframe of a parent-side color scheme change so CSS Custom Properties can be synced.

```typescript
{ type: 'wp-desktop-color-scheme'; scheme: string }
```

#### `wp-desktop-toggle-panel` — Stable
Asks the iframe to toggle a named screen-meta panel. The iframe is the authority — it responds by emitting a `wp-desktop-screen-meta-state` message.

```typescript
{ type: 'wp-desktop-toggle-panel'; panel: 'screen-options' | 'help' }
```

#### `wp-desktop-commands-subscribe` — Experimental
Tells the iframe to begin streaming its `wp.data.select('core/commands')` registry to the parent via `wp-desktop-commands-list`. The shell sends this to the iframe owned by the currently focused window and rescinds it (`wp-desktop-commands-unsubscribe`) when focus moves elsewhere.

```typescript
{ type: 'wp-desktop-commands-subscribe' }
```

#### `wp-desktop-commands-unsubscribe` — Experimental
Tells the iframe to stop streaming its command list. The parent unregisters any shell-palette entries still tagged with this window's owner.

```typescript
{ type: 'wp-desktop-commands-unsubscribe' }
```

#### `wp-desktop-commands-invoke` — Experimental
Asks the iframe to run a previously harvested `action`-kind command. Sent when the user selects the command from the shell palette. Navigation-kind commands are handled parent-side by opening a new desktop window — the iframe never sees them.

```typescript
{ type: 'wp-desktop-commands-invoke'; name: string }
```

---

### Safety guidelines for bridge messages

- **Always validate `event.origin`** against `window.location.origin`. Cross-origin messages are rejected by the parent today; your iframe adapter should do the same.
- **Never pass raw HTML** through the bridge. If you need to display text, pass a string and let the parent render it via `textContent`.
- **Be idempotent.** A bridge message may arrive twice during navigations. Design payloads so the second arrival is a no-op.

---

## 4. Hooks — `wp-desktop.*`

Desktop Mode exposes WordPress-style filters and actions via the standard `@wordpress/hooks` package. The plugin declares `wp-hooks` as a script dependency so `window.wp.hooks` is always available before the shell boots, and all hook names live in the `wp-desktop.` namespace to avoid collisions with Core or Gutenberg.

If you've used `addFilter` / `addAction` in Gutenberg, you already know how these work — there's nothing new to learn.

### Bootstrap

**Recommended:** use `wp.desktop.ready( fn )` — it mirrors `jQuery( fn )` and is safe for scripts loaded at any point in the lifecycle, including scripts injected mid-session by the server-sync modules (widgets, wallpapers, commands, settings tabs).

```javascript
wp.desktop.ready( () => {
    // wp.desktop is fully populated; register away.
    wp.desktop.registerWallpaper( myWallpaper );
    wp.desktop.registerSettingsTab( { ... } );
} );
```

`ready()` runs the callback **synchronously via a microtask** if `wp-desktop.init` has already fired, or queues it via `addAction( 'wp-desktop.init', … )` otherwise. It's a shorter alias of `wp.desktop.whenReady()` (both have been Stable since 0.14.0; the `ready` name ships in 0.17.0).

> **Why not `wp.hooks.addAction( 'wp-desktop.init', … )` directly?**
>
> `addAction()` queues a callback for *future* firings of the action. When a plugin script is loaded **after** `wp-desktop.init` has already fired — the normal case for anything registered by a server-sync module — the callback is never invoked. `ready()` handles both cases: already-fired (call immediately) and not-yet-fired (queue on the action). Use `ready()` as the default; reach for `addAction()` directly only if you specifically want multi-fire semantics.

If you need a synchronous check (e.g. to branch between "register directly" and "schedule"), use `wp.desktop.isReady()`:

```javascript
if ( wp.desktop.isReady() ) {
    wp.desktop.registerCommand( myCommand );
} else {
    wp.desktop.ready( () => wp.desktop.registerCommand( myCommand ) );
}
```

### Hooks catalog

#### Shell & wallpapers

| Hook | Kind | Status | Payload |
|---|---|---|---|
| `wp-desktop.init` | action | Stable | `{ config: DesktopConfig }` |
| `wp-desktop.shell.resized` | action | Stable | `{ width, height }` — debounced ~120 ms after the browser stops resizing |
| `wp-desktop.shell.visibility` | action | Stable | `{ state: 'visible' \| 'hidden' }` — mirrors `document.visibilitychange` |
| `wp-desktop.wallpapers` | filter | Stable | `WallpaperDef[] → WallpaperDef[]` |
| `wp-desktop.wallpaper.mounting` | action | Stable | `{ id, container, ctx }` |
| `wp-desktop.wallpaper.mounted` | action | Stable | `{ id, container, ctx }` |
| `wp-desktop.wallpaper.unmounting` | action | Stable | `{ id }` |
| `wp-desktop.wallpaper.mount-failed` | action | Stable | `{ id, error }` |
| `wp-desktop.wallpaper.visibility` | action | Stable | `{ id, state: 'visible' \| 'hidden' }` |
| `wp-desktop.wallpaper.surfaces` | filter | Stable | `WallpaperSurface[] → WallpaperSurface[]` — see below |

#### Arrange & Overview

Fired by the admin-bar "Arrange" menu's layout algorithms. The overview hooks come in pairs (enter/exit, hover/unhover) so plugins can maintain accurate state counts.

| Hook | Kind | Status | Payload |
|---|---|---|---|
| `wp-desktop.overview.entering` | action | Stable | `{}` — before the enter animation starts |
| `wp-desktop.overview.entered` | action | Stable | `{}` — fires ~300 ms later, after the grid settles |
| `wp-desktop.overview.exiting` | action | Stable | `{ windowId?: string, reason: 'select' \| 'cancel' }` |
| `wp-desktop.overview.exited` | action | Stable | same payload as `exiting` |
| `wp-desktop.overview.window-hover` | action | Stable | `{ windowId }` |
| `wp-desktop.overview.window-unhover` | action | Stable | `{ windowId }` |
| `wp-desktop.overview.window-click` | action | Stable | `{ windowId }` — fires just before `exiting` when a thumbnail is clicked |
| `wp-desktop.arrange.cascade.starting` | action | Stable | `{ windowCount }` |
| `wp-desktop.arrange.cascade.applied` | action | Stable | `{ windowCount }` |
| `wp-desktop.arrange.tile.starting` | action | Stable | `{ windowCount, cols, rows }` — before tile lays out the grid |
| `wp-desktop.arrange.tile.applied` | action | Stable | `{ windowCount, cols, rows }` |
| `wp-desktop.arrange.tile.dimensions` | filter | Stable | filters `{ cols, rows }`; context `{ windowCount, areaWidth, areaHeight }`. Override the auto-chosen grid (e.g., force a 3-column newsroom layout). Returns must be positive integers and `cols * rows >= windowCount`, otherwise the filter is ignored. |
| `wp-desktop.arrange.snap.changed` | action | Stable | `{ enabled }` — fires when the user toggles "Snap to grid" |
| `wp-desktop.arrange.snap.cell-size` | filter | Stable | filters `{ cellWidth, cellHeight }`; context `{ areaWidth, areaHeight }`. Override the auto-computed snap cell size (e.g., enforce a fixed 100×100 grid). Non-positive returns are ignored. |
| `wp-desktop.arrange.custom-action` | action | Stable | `{ id }` — fires when the user clicks a plugin-registered Arrange-menu item (registered server-side via the `desktop_mode_arrange_menu_items` PHP filter). The `id` matches the `id` field the plugin supplied. |

#### Virtual desktops ("Spaces")

Each user can have multiple desktops, each owning its own set of windows. Switching desktops swaps which windows are visible without destroying any. The overview top bar surfaces tile-per-desktop UI for switching, creating, and closing.

| Hook | Kind | Status | Payload |
|---|---|---|---|
| `wp-desktop.desktop.created` | action | Stable | `{ desktopId }` — fires after a new desktop joins the registry |
| `wp-desktop.desktop.closed` | action | Stable | `{ desktopId, migratedTo }` — `migratedTo` is the desktop that received any orphaned windows |
| `wp-desktop.desktop.switched` | action | Stable | `{ from, to }` — the active desktop changed |

Closing the last remaining desktop is rejected silently (the shell needs at least one). Closing a desktop that has windows migrates them to the surviving desktop on its left (falling back to the right when the leftmost is closed) — no work is silently destroyed.

#### Widgets

Small cards that paint in the right-side column above the wallpaper but beneath every window. Lifecycle mirrors canvas wallpapers — `mount(container)` returns a teardown the layer calls on remove / page unload.

Register via the public helper:

```js
wp.desktop.registerWidget( {
    id: 'jorvy/quote',
    label: 'Marvel Quote',
    description: 'A random quote, refreshed every 10 seconds.',
    icon: 'dashicons-format-quote',
    mount: ( container ) => {
        const el = document.createElement( 'p' );
        el.textContent = '"I am Iron Man."';
        container.appendChild( el );
        return () => {
            el.remove();
        };
    },
} );
```

**Optional placement / sizing fields** (all default off, fully back-compat with 0.7.x widgets):

| Field | Type | What it does |
|---|---|---|
| `movable` | `boolean` | Show a thin chrome header at the top of the card with a drag grip + label + × button. The user can drag the card from the chrome to place the widget anywhere on the desktop (first drag "liberates" it from the right-side column). Text inputs / buttons inside the widget body are unaffected — drag only initiates from the chrome. |
| `resizable` | `boolean` | Add resize handles. With `movable: true`, 8 handles (corners + edges). Without it, only the bottom edge is draggable so width stays locked to the column. |
| `minWidth`, `minHeight` | `number` | Lower bounds enforced during user resize (px). |
| `maxWidth`, `maxHeight` | `number` | Upper bounds enforced during user resize (px). |
| `defaultWidth`, `defaultHeight` | `number` | Initial floating size — used the first time the widget is liberated. |

```js
wp.desktop.registerWidget( {
    id: 'my/notes',
    label: 'Sticky notes',
    description: 'A quick scratchpad you can drop anywhere.',
    icon: 'dashicons-welcome-write-blog',
    movable: true,
    resizable: true,
    minWidth: 200,
    minHeight: 120,
    defaultWidth: 280,
    defaultHeight: 220,
    mount: ( container ) => {
        const ta = document.createElement( 'textarea' );
        ta.value = window.localStorage.getItem( 'my-notes' ) || '';
        ta.oninput = () =>
            window.localStorage.setItem( 'my-notes', ta.value );
        container.appendChild( ta );
        return () => ta.remove();
    },
} );
```

User-placed geometry (position + size of liberated widgets) persists per-user in `localStorage` under `wp-desktop-widgets-geometry`. Removing a widget clears its stored geometry so a re-add starts docked in the column again.

| Hook | Kind | Status | Payload |
|---|---|---|---|
| `wp-desktop.widgets` | filter | Stable | the registry array |
| `wp-desktop.widget.mounting` | action | Stable | `{ id, container, ctx }` — before paint |
| `wp-desktop.widget.mounted` | action | Stable | `{ id, container, ctx }` — after paint |
| `wp-desktop.widget.unmounting` | action | Stable | `{ id }` — before teardown |
| `wp-desktop.widget.mount-failed` | action | Stable | `{ id, error }` |
| `wp-desktop.widget.added` | action | Stable | `{ id }` — user added via the picker |
| `wp-desktop.widget.removed` | action | Stable | `{ id }` — user removed via the card's × |

The `ctx` argument exposes `{ id, pluginUrl }` — the same shape canvas wallpapers receive. Enabled widgets persist per-user in `localStorage` (`wp-desktop-widgets`).

#### Window lifecycle

All window actions include at minimum `{ windowId: string }` — additional fields called out in the payload column.

| Hook | Kind | Status | Payload |
|---|---|---|---|
| `wp-desktop.window.opened` | action | Stable | `{ windowId, page, title, url }` |
| `wp-desktop.window.reopened` | action | Stable | `{ windowId, baseId, wasMinimized }` — fires when `openWindow()` is called for an already-open window |
| `wp-desktop.window.content-loading` | action | Stable *(0.6.0)* | `{ windowId }` — fires on the loading entry edge (construction + every `markContentLoading()`). Edge-triggered. |
| `wp-desktop.window.content-loaded` | action | Stable *(0.6.0)* | `{ windowId }` — fires on the loading → ready transition (iframe `load` / `wp-desktop-ready`, native render Promise resolves, or `markContentLoaded()`). Edge-triggered. |
| `wp-desktop.window.loading-overlay` | filter | Stable *(0.6.0)* | `(host: HTMLElement, ctx: { windowId, config }) → HTMLElement`. Receives the default overlay element (or whatever a per-window `config.loading.render` produced) and may mutate it or return a replacement. Plugins use this to brand every window's loader, swap the spinner preset, append status text. |
| `wp-desktop.window.closing` | action | Stable | `{ windowId, element }` — fires BEFORE the element is detached (use this when you need an element reference, e.g. for anchored wallpaper overlays) |
| `wp-desktop.window.closed` | action | Stable | `{ windowId }` |
| `wp-desktop.window.focused` | action | Stable | `{ windowId }` — fires on focus changes |
| `wp-desktop.window.blurred` | action | Stable *(0.5.5)* | `{ windowId, focusedTo }` — fires on the window that lost focus when another window is promoted |
| `wp-desktop.window.title-changed` | action | Stable | `{ windowId, title }` — iframe-sourced title updates |
| `wp-desktop.window.minimized` | action | Stable | `{ windowId }` |
| `wp-desktop.window.restored` | action | Stable | `{ windowId }` — restored from minimized |
| `wp-desktop.window.maximized` | action | Stable | `{ windowId }` |
| `wp-desktop.window.unmaximized` | action | Stable | `{ windowId }` |
| `wp-desktop.window.fullscreen-entered` | action | Stable | `{ windowId }` |
| `wp-desktop.window.fullscreen-exited` | action | Stable | `{ windowId }` |
| `wp-desktop.window.drag-start` | action | Stable | `{ windowId }` |
| `wp-desktop.window.drag-end` | action | Stable | `{ windowId, x, y }` |
| `wp-desktop.window.moved` | action | Stable | `{ windowId, x, y }` — fires with drag-end |
| `wp-desktop.window.resize-start` | action | Stable | `{ windowId }` |
| `wp-desktop.window.resize-end` | action | Stable | `{ windowId, width, height }` |
| `wp-desktop.window.resized` | action | Stable | `{ windowId, width, height }` — fires with resize-end |
| `wp-desktop.window.bounds-changed` | action | Stable | `{ windowId, x, y, width, height, state, phase: 'drag' \| 'resize' }` — rAF-coalesced, fires at most once per animation frame during an active drag or resize. See below. |
| `wp-desktop.window.detached` | action | Stable | `{ windowId, url }` — user opened in a classic-admin tab |

**About `bounds-changed`.** Intended for per-frame collision-aware effects (snow piling on window tops, rain splashes, physics-driven overlays). Coalesced via `requestAnimationFrame` so a pointermove storm collapses to one fire per paint — matches the cadence a canvas wallpaper's own ticker runs at, and replaces the "poll `getBoundingClientRect` every rAF" pattern. NOT fired at drag/resize end — use `wp-desktop.window.drag-end` / `wp-desktop.window.resize-end` for settled geometry.

The window hooks fan out alongside the existing `wp-desktop-window-*` CustomEvents (see section 2) — both APIs fire for every state change. New code should prefer the hook bus.

All hooks can be listed via `wp.hooks.hasAction()` / `hasFilter()` for defensive checks.

#### Iframe observability

Lifecycle + instrumentation for the chromeless iframe inside each window. Re-dispatched from `postMessage` payloads the iframe bridge forwards, so subscribers get a unified event stream without juggling the lower-level message bus themselves.

| Hook | Kind | Status | Payload |
|---|---|---|---|
| `wp-desktop.iframe.ready` | action | Stable | `{ windowId }` — fires once per iframe when the chromeless bridge script has attached its listeners. Use this instead of the iframe's `load` event when timing matters (the native `load` fires before our bridge attaches, so messages sent on `load` can miss the listener). |
| `wp-desktop.iframe.error` | action | Stable | `{ windowId, kind: 'error' \| 'unhandledrejection', message, filename, lineno, colno, stack }` — bridged from the iframe's `error` / `unhandledrejection` handlers. Cross-origin iframe errors are origin-filtered at the bridge and never reach this hook. |
| `wp-desktop.iframe.network-completed` | action | Stable | `{ windowId, method, url, status, duration, failed }` — every `fetch` + `XMLHttpRequest` call inside the iframe. `status === 0` indicates a network-level failure with no response received. |

Use `IFRAME_READY` when you need to send a `wp-desktop-focus` (or any parent→iframe message) as early as possible without racing the bridge setup. Use `IFRAME_ERROR` / `IFRAME_NETWORK_COMPLETED` to build a monitor widget that surfaces per-window reliability data.

#### Native-window lifecycle

These hooks fire only for native windows (`wp.desktop.registerWindow({ native: true, render })`). They let a plugin wrap or decorate another plugin's render output — e.g. injecting a consistent panel theme around every native window, or tagging the body for test automation.

| Hook | Kind | Status | Payload |
|---|---|---|---|
| `wp-desktop.native-window.before-render` | filter | Stable | body `HTMLElement`, context `{ windowId, config }` — return the same element or a new wrapper the plugin should render into |
| `wp-desktop.native-window.after-render` | action | Stable | `{ windowId, body, config }` — fires after the plugin's `render` callback has painted |
| `wp-desktop.native-window.before-close` | action | Stable | `{ windowId, config }` — fires before the window element is detached, mirroring `wp-desktop.window.closing` for iframe windows |

#### Window body resize

| Hook | Kind | Status | Payload |
|---|---|---|---|
| `wp-desktop.window.body-resized` | action | Stable | `{ windowId, width, height }` — fires when the window body element's size actually changes (mount, resize, reflow). Coalesced by the underlying `ResizeObserver`; use this instead of polling from inside a native-window render. |

### Filter: `wp-desktop.wallpapers`

Receives the registered wallpaper list. Plugins can add entries, remove entries, or reorder — callback returns the (possibly modified) array.

```javascript
// Remove the 'aurora' preset from the picker grid.
wp.hooks.addFilter(
    'wp-desktop.wallpapers',
    'my-plugin/hide-aurora',
    ( list ) => list.filter( ( w ) => w.id !== 'aurora' )
);
```

In practice most plugins use the `wp.desktop.registerWallpaper()` convenience — internally it adds a filter callback under a namespace the shell generates for you, so the raw filter API is only needed for non-additive operations.

---

## 5. Wallpaper registration API

The shell ships a registry-driven wallpaper picker: every entry in the registry becomes a swatch in the OS Settings panel, and the WallpaperLayer resolves whichever is currently selected onto the desktop. Plugins register their own via `wp.desktop.registerWallpaper()` (or the `wp-desktop.wallpapers` filter).

Two shapes ship today: `css` (a static CSS background value) and `canvas` (a plugin-managed DOM subtree, typically a WebGL/2D canvas).

### Shape

```typescript
type WallpaperDef =
    | {
          type: 'css';
          id: string;
          label: string;
          preview: string;            // CSS `background` value for the swatch
          value?: string;             // Applied to --wp-desktop-bg
          resolveValue?: ( ctx: WallpaperContext ) => string;  // Dynamic alternative
          renderEditor?: WallpaperEditor;
      }
    | {
          type: 'canvas';
          id: string;
          label: string;
          preview: string;            // CSS `background` for the swatch (pre-mount)
          mount: ( container: HTMLElement, ctx: WallpaperContext ) =>
                  ( () => void ) | Promise<() => void>;
          renderEditor?: WallpaperEditor;
      };

interface WallpaperContext {
    id: string;
    pluginUrl: string;                // no trailing slash
    prefersReducedMotion: boolean;
    visible: boolean;                 // current document visibility
}
```

### Minimal CSS wallpaper

```javascript
wp.desktop.ready( () => {
    wp.desktop.registerWallpaper( {
        id: 'my-plugin/ocean',
        label: 'Ocean',
        type: 'css',
        value: 'linear-gradient(180deg, #0ea5e9, #1e3a8a)',
        preview: 'linear-gradient(180deg, #0ea5e9, #1e3a8a)',
    } );
} );
```

### Canvas wallpaper with a declared dependency

Don't hardcode URLs to vendor libraries — declare them by module id. The shell pre-registers common modules (`pixijs` today), and plugins can register their own. When the wallpaper activates, the shell loads every listed module before `mount` fires; concurrent activations dedupe through the memoized script loader.

```javascript
wp.desktop.ready( () => {
    wp.desktop.registerWallpaper( {
        id: 'my-plugin/spinner',
        label: 'Spinner',
        type: 'canvas',
        preview: '#0a0a1a',
        needs: [ 'pixijs' ],        // ← shell loads this before mount
        mount: async ( container, ctx ) => {
            // window.PIXI is guaranteed defined at this point.
            const app = new window.PIXI.Application();
            await app.init( { resizeTo: container } );
            container.appendChild( app.canvas );

            if ( ctx.prefersReducedMotion ) {
                // Render a still frame; never start the ticker.
                app.ticker.stop();
            }

            return () => app.destroy( true );
        },
    } );
} );
```

Unknown module ids fail loudly via `wp-desktop.wallpaper.mount-failed` — no silent non-activations.

### Registering your own module

If your plugin ships a library other plugins might want to share, register it once and let them `needs:` it by id.

```javascript
wp.desktop.registerModule( {
    id: 'three-js',
    url: `${ wp.desktop.config.pluginUrl }/vendor/three.min.js`,
    // Optional: skip re-loading if already present (e.g. Core shipped it).
    isReady: () => typeof window.THREE !== 'undefined',
} );
```

### Lifecycle guarantees

The shell protects against mount/unmount races with a monotonic generation counter. Rapid wallpaper switching is safe — a mount that resolves after the user has already picked something else tears itself down immediately and doesn't pollute the DOM.

Canvas wallpapers receive `ctx.prefersReducedMotion` and should render a single static frame rather than starting an animation loop when it's true. The shell also fires `wp-desktop.wallpaper.visibility` on every `document.visibilitychange` so wallpapers can pause their tickers when the tab is backgrounded.

### `renderEditor` — in-panel controls

Any wallpaper can ship a `renderEditor` callback — when that wallpaper is the selected swatch in OS Settings, a collapsible panel opens below the grid and the editor is rendered into it. Same animation as the built-in custom-gradient editor.

```javascript
wp.desktop.registerWallpaper( {
    id: 'my-plugin/tunable',
    label: 'Tunable',
    type: 'css',
    preview: '#334155',
    resolveValue: () => myState.currentColor,
    renderEditor: ( container, ctx ) => {
        const picker = makeColorPicker( myState.currentColor );
        picker.onChange = ( v ) => {
            myState.currentColor = v;
            // Registered with resolveValue, so the shell re-reads it
            // on the next apply — just re-apply to repaint.
            // (A future API may add a helper for this pattern.)
        };
        container.appendChild( picker.el );
        return () => picker.destroy();
    },
} );
```

### `window.wp.desktop` members

| Member | Status | Notes |
|---|---|---|
| `windowManager` | Stable | WindowManager instance |
| `dock` | Stable | Dock instance (null if no dock element) |
| `saveSession()` | Stable | Force a session write |
| `hooks` | Stable | Alias of `window.wp.hooks` |
| `taskbar` | Stable | Bottom-edge Dock instance (null if no element or no plugin menus routed to taskbar) |
| `registerWallpaper( def )` | Stable | Add a wallpaper to the registry + re-apply |
| `registerWidget( def )` | Stable | Add a widget to the registry |
| `registerSystemTile( item, placement? )` | Stable | Add a JS-owned launcher tile to the taskbar (default) or dock. Returns the resolved placement. See "System tiles" below. |
| `loadVendorScript( url )` | Stable | Memoized `<script>` injector. Low-level; most plugins use `needs` instead. |
| `getWallpaperSurfaces()` | Stable | Live `WallpaperSurface[]` for collision-aware wallpapers. See "Wallpaper surfaces" below. |
| `registerModule( def )` | Stable | Register a shared vendor library under a stable id. |
| `loadModules( ids )` | Stable | Imperatively load registered modules. Usually unnecessary — canvas wallpapers declare `needs[]` and the shell resolves. |
| `ready( cb )` | Experimental *(since 0.17.0)* | **Recommended bootstrap entry point.** Run `cb` after `wp-desktop.init` has fired — immediately (via microtask) if it already fired, queued otherwise. Safe for scripts loaded at any point in the lifecycle, including server-sync-injected plugin scripts. Short alias of `whenReady( cb )`. |
| `whenReady( cb )` | Stable | Original name for `ready( cb )` — same behaviour; keep using it if you've already adopted it. |
| `isReady()` | Stable | Synchronous boolean — has `wp-desktop.init` fired yet. Branch between "register directly" and "schedule via `ready`" without racing. |
| `refreshMenu()` | Stable | Force a refetch of the live admin-menu split. Auto-fired on plugin activation / deactivation. |
| `setDefaultWindow( url \| null )` | Stable | Update the user's "open on startup" preference. |
| `config` | Stable | The `DesktopConfig` that booted the shell |

### System tiles

A **system tile** is a JS-owned launcher that isn't part of the admin menu — Jorvy, a plugin's native-window quick tool, a custom shortcut. The shell keeps these on one of the two rails:

- **Taskbar (default for plugins)** — bottom macOS-style pill, alongside installed-plugin admin menus.
- **Dock** — left-edge rail, reserved for core WordPress and shell-owned affordances like OS Settings.

Register via `wp.desktop.registerSystemTile()`:

```javascript
wp.desktop.whenReady( () => {
    wp.desktop.registerSystemTile( {
        id:     'jorvy',
        title:  'Jorvy',
        icon:   'dashicons-star-filled',
        onOpen: () => {
            wp.desktop.windowManager.open( {
                id: 'jorvy',
                url: '#jorvy',
                title: 'Jorvy',
                icon: 'dashicons-star-filled',
                native: true,
                render: ( body ) => { /* paint the native window body */ },
                width: 360,
                height: 240,
                minWidth: 280,
                minHeight: 200,
            } );
        },
        isOpen: () => !! wp.desktop.windowManager.getById( 'jorvy' ),
    } );
    // Returns 'taskbar' by default. Pass 'dock' explicitly for the
    // left rail (rare — reserved for shell-owned tiles).
} );
```

**Why the default is `taskbar`:** plugin-contributed admin menus live in the bottom pill already (see `desktop_mode_dock_placement`). Putting plugin-contributed shell launchers next to them keeps "everything plugin" in one place and keeps the left dock focused on core WP. If you want the left rail, pass `placement: 'dock'` explicitly — the shell will honor it without coercion.

**Taskbar auto-unhide.** When a system tile lands on a previously-empty taskbar (no plugin menus, no prior tiles), the rail automatically un-hides and the desktop area picks up the `--with-taskbar` CSS modifier. Subsequent tiles reuse the already-shown pill.

---

### Wallpaper surfaces

Collision-aware wallpapers (snow, rain, leaves, particle effects) need to know where things can "land" — window tops, the desktop floor, the taskbar top, the dock's inline edge, widget cards. Rather than having every wallpaper hand-query the shell's DOM + hope the class names don't move, the shell emits a live surface list through `wp.desktop.getWallpaperSurfaces()`.

```typescript
interface WallpaperSurface {
    id: string;             // 'window:foo', 'shell:floor', 'taskbar:top', 'dock:edge', 'widget:clock', or plugin-supplied
    kind: 'window' | 'shell' | 'taskbar' | 'dock' | 'widget' | 'custom';
    rect: { x: number; y: number; width: number; height: number };  // viewport coordinates
    face: 'top' | 'bottom' | 'left' | 'right';  // which edge is solid
    element: HTMLElement | null;                // null for synthetic surfaces
}
```

**Shell-seeded surfaces** (the baseline, before the filter runs):

- `window:<id>` — every non-minimized window's top edge (`face: 'top'`), one per window.
- `shell:floor` — bottom edge of the shell container.
- `taskbar:top` — top of the bottom taskbar pill, when present.
- `dock:edge` — right (inline-end) edge of the left-edge dock.
- `widget:<id>` — top edge of every mounted widget card.

**Adding a custom surface.** Plugins that own floating DOM use the `wp-desktop.wallpaper.surfaces` filter:

```javascript
wp.hooks.addFilter(
    'wp-desktop.wallpaper.surfaces',
    'myplugin/picker',
    ( surfaces ) => {
        const picker = document.querySelector( '.myplugin-picker' );
        if ( ! picker ) return surfaces;
        const r = picker.getBoundingClientRect();
        return [
            ...surfaces,
            {
                id: 'myplugin:picker',
                kind: 'custom',
                rect: { x: r.left, y: r.top, width: r.width, height: r.height },
                face: 'top',
                element: picker,
            },
        ];
    }
);
```

**Usage from a canvas wallpaper:**

```javascript
function onTick() {
    const surfaces = wp.desktop.getWallpaperSurfaces();
    // Rebuild collision cache from `surfaces`, run physics step, draw.
}
```

Call it each frame (or throttled — the function is cheap but it does walk the DOM). Rects are in viewport coordinates so a canvas mounted inside `#wp-desktop-wallpaper` can translate to its own drawing space using the wallpaper element's own `getBoundingClientRect()`.

**Pair with `wp-desktop.window.bounds-changed`.** During a drag or resize the shell fires `bounds-changed` once per animation frame with the live `{ x, y, width, height }`. Subscribe there to invalidate your surface cache instead of polling `getBoundingClientRect()` each tick.

### Pre-registered modules

| id | ships from | global |
|---|---|---|
| `pixijs` | `assets/vendor/pixi.min.js` (PixiJS v8) | `window.PIXI` |

---

## DevTools / cross-plugin instrumentation (since 0.6.0)

`wp.desktop.devtools` is the supported surface for third-party plugins that instrument windows registered by other plugins (SQL inspector, perf profiler, request logger). Reach for these primitives instead of wrapping `iframe.contentWindow` globals — multiple devtools can compose against the same window without fighting each other.

### `wp.desktop.devtools.addRequestHeader( windowId, name, value )` — Experimental

Contribute an HTTP header that the target window's iframe attaches to every fetch / XHR / sendBeacon. Returns a disposer.

```js
const stop = wp.desktop.devtools.addRequestHeader(
    'wp-window-edit-php',
    'X-WP-Debug-Session',
    sessionId,
);
// later:
stop();
```

`value` may be a literal string or a `() => string` thunk that recomputes per-request. Multiple contributors to the same name are joined with `, ` per RFC 7230. The header is removed when the last contributor disposes.

### `wp.desktop.devtools.onRequest( windowId, cb, { observe } )` — Experimental

Subscribe to every completed request from the target window. Returns a disposer.

```js
const stop = wp.desktop.devtools.onRequest(
    windowId,
    ( req ) => console.log( req.method, req.url, req.status ),
    { observe: true }, // include request + response headers
);
```

Default payload: `{ windowId, method, url, status, duration, failed }`. With `observe: true`: also `requestHeaders`, `responseHeaders`. The shell aggregates — as long as any active subscriber wants `observe`, the iframe runs in observation mode; otherwise it ships only the privacy-conscious summary.

### `wp.desktop.devtools.reloadWithDebugSession( windowId, sessionId, opts? )` — Experimental

Reload a window's iframe with a debug session id baked into both the URL and the request-header contribution registry. Bundles four boilerplate steps every devtool would otherwise re-derive:

```js
const sessionId = wp.desktop.devtools.debug.startSession();
const handle = wp.desktop.devtools.reloadWithDebugSession( windowId, sessionId );
// later:
handle.dispose(); // removes header + cleans up
```

What it does:

1. Adds an `X-WP-Debug-Session: <sessionId>` header contribution (overridable via `opts.headerName`).
2. Rewrites `iframe.src` with a `wp_debug_session=<sessionId>` query-arg (overridable via `opts.queryArg`) so the document load itself carries the session — HTTP headers can't ride along on full-document navigations, only the URL can.
3. Re-pushes the header contribution on the iframe's native `load` event so a fresh document picks up its instrumentation deterministically. (This was a real timing race plugins were hitting — a manual `iframe.src = newUrl` could land with `__wpdInstrument.headers` empty.)
4. Returns a single disposer that tears down everything.

Returns `null` when the window doesn't exist or has no iframe (native windows).

Server side, read the URL flag in your capture hook:

```php
add_action( 'init', function () {
    $sid = desktop_mode_debug_session_for_request();
    if ( '' === $sid && isset( $_GET['wp_debug_session'] ) ) {
        $sid = sanitize_key( wp_unslash( $_GET['wp_debug_session'] ) );
    }
    if ( '' === $sid ) {
        return;
    }
    if ( ! defined( 'SAVEQUERIES' ) ) {
        define( 'SAVEQUERIES', true );
    }
    // … shutdown hook publishes via desktop_mode_debug_publish( $sid, … )
}, 1 );
```

### `wp.desktop.devtools.debug` — Experimental

Generic per-session pub/sub bus. Pair with PHP `desktop_mode_debug_publish()`.

```js
const sessionId = wp.desktop.devtools.debug.startSession();   // opaque uuid

// Tag every request with this session.
wp.desktop.devtools.addRequestHeader( windowId, 'X-WP-Debug-Session', sessionId );

// Subscribe to a channel.
const stop = wp.desktop.devtools.debug.subscribe(
    sessionId, 'query',
    ( ev ) => console.log( ev.payload ),
);

// Optional — local-echo without a server round-trip.
wp.desktop.devtools.debug.publish( sessionId, 'query', { sql: '…' } );
```

The shell polls `GET /wp-desktop/v1/debug?sessionId=…&since=…` every 1 s while at least one subscription is active for the session, and stops polling when the last subscription disposes.

### `Window.config.ownerHandle` — Experimental

The script handle of the plugin that registered a native window. Read for attribution:

```js
wp.desktop.registerTitleBarButton( {
    id: 'sql-inspector/attach',
    match: ( win ) => win.config.ownerHandle !== '',
    // ...
} );
```

Always populated for windows registered via PHP `desktop_mode_register_window( $args )` (carries `$args['script']`); undefined for iframe windows backed by a core admin page.

### postMessage protocol additions

| Type | Direction | Payload |
|---|---|---|
| `wp-desktop-instrument-set` | parent → iframe | `{ headers: { name: value, … }, observe: boolean }`. Replaces the iframe's instrumentation slot wholesale on every change. |
| `wp-desktop-iframe-network` | iframe → parent | Existing payload + optional `requestHeaders`, `responseHeaders` when the parent has set `observe: true`. |

See [`docs/examples/devtools-instrumentation.md`](./examples/devtools-instrumentation.md) for a complete worked example.

---

## Window attention API

**Stable** — shipped 0.22.0. See
[`examples/window-request-attention.md`](./examples/window-request-attention.md)
for the worked example.

```ts
class Window {
    requestAttention(
        mode: 'pulse' | 'shake' | 'bounce' | null,
        opts?: {
            durationMs?: number;          // default 4000; 0 = until cleared
            intensity?: 'subtle' | 'normal' | 'strong'; // default 'normal'
        },
    ): void;
}

class Dock {
    setBadge( itemId: string, count: number ): void;
    clearBadge( itemId: string ): void;
    setAttention(
        itemId: string,
        mode: 'pulse' | 'shake' | 'bounce' | null,
        opts?: { durationMs?: number; intensity?: 'subtle' | 'normal' | 'strong' },
    ): void;
}
```

`Window.requestAttention()` resolves the tile (dock or taskbar based
on registered `placement`) and routes to `Dock.setAttention()`. For
`placement: 'none'` windows, falls back to `setHighlight('persistent')`
auto-cleared after `durationMs`.

JS filter: `wp-desktop.window.attention( mode, { windowId, opts } )`
— return `null` to mute the request (Do Not Disturb integration).

All three rails (`dock`, `taskbar`, `icons`) emit on the
activity bus channel `wp-desktop/badge-changed` with payload
`{ itemId, count, rail }`. The icon rail also fires
`HOOKS.ICON_BADGE_CHANGED` on the hook bus with
`{ iconId, count, previousCount }` for callers that only care
about the icon surface.

## `wp.desktop.icons` — the wallpaper-icon rail *(since 0.24.0)*

**Stable.** Third badge surface, sibling of `wp.desktop.dock`
and `wp.desktop.taskbar`. Same `setBadge( id, count )` shape, so
plugin authors can fan a count to every rail with one wrapper
function.

```ts
interface IconsApi {
    setBadge:   ( iconId: string, count: number ) => void;
    clearBadge: ( iconId: string ) => void;
    getBadge:   ( iconId: string ) => number;
}
```

```js
wp.desktop.icons.setBadge(   'wpdm-messages', 5 );
wp.desktop.icons.clearBadge( 'wpdm-messages' );
wp.desktop.icons.getBadge(   'wpdm-messages' ); // → 0 (after clear)
```

- **Idempotent.** Same count twice = no DOM mutation, no re-emit.
- **Silent no-op when the id isn't on the rail.** Lets the
  fan-to-all-rails pattern work without triple-emitting.
- **Survives a full grid rebuild.** The framework persists the
  badge across plugin activations / live menu refreshes — set
  once, the renderer re-paints from internal state.
- **`>99` renders as `99+`** so the pill stays compact.

Every applied change publishes on:

- `wp-desktop/badge-changed` activity channel with
  `{ itemId, count, rail: 'icon' }`.
- `HOOKS.ICON_BADGE_CHANGED` action with
  `{ iconId, count, previousCount }`.

### Apps own the "show 0 while my window is active" rule

The framework does NOT auto-suppress badges based on window
state. That decision belongs to the app — a "5 unread" badge
should hide while the inbox is focused; a "5 failed deploys"
badge should NOT. Subscribe to the relevant window-lifecycle
hook and decide for yourself; see
[`docs/examples/dock-badge.md`](./examples/dock-badge.md) for
the canonical recipe.

## `<wpd-avatar>` — Stable (0.22.0)

```html
<wpd-avatar
    src="https://…/me.jpg"
    name="Daniel López"
    size="40"               <!-- px or 'xs' | 'sm' | 'md' | 'lg' | 'xl' -->
    presence="online"       <!-- 'online' | 'inactive' | 'offline' -->
    user-id="42"            <!-- auto-subscribes to wp-desktop-presence-changed -->
></wpd-avatar>
```

Falls back to a deterministic-hue letter tile when `src` is empty
or fails to load. Emits `wpd-avatar-click` `{ userId: number | null }`.

## `<wpd-textarea>` — Stable (0.22.0)

```html
<wpd-textarea
    label="Message"
    rows="2"
    auto-grow
    max-rows="8"
    submit-on-enter        <!-- Enter sends; Shift+Enter newlines -->
    maxlength="4000"
></wpd-textarea>
```

Same event shape as `<wpd-text-field>`: `wpd-input-change`,
`wpd-input-commit`, `wpd-submit`. Imperative methods:
`focusInput()`, `clear()`, `refreshAutosize()`.

---

## Window-chrome customization framework (since 0.6.0)

Per-window appearance customization across four layers. Layers 1-3
are Stable; Layer 4 is **Experimental**. Recipes live in dedicated
example docs (linked at the bottom).

### `WindowConfig.appearance` — Stable (Layer 4 Experimental)

A new optional field on every window declaration:

```ts
interface WindowAppearance {
    theme?: WindowThemeRef;                       // Layer 1
    controls?: WindowControlsConfig;              // Layer 2
    slots?: Partial< Record< WindowSlotName, WindowSlotConfig > >; // Layer 3
    chrome?: string;                              // Layer 4 — Experimental
}
```

### Public APIs on `wp.desktop.*`

```ts
// Layer 1 — Themes (Stable)
wp.desktop.registerWindowTheme( def );          // throws RegistrationError on bad input
wp.desktop.unregisterWindowTheme( id );
wp.desktop.listWindowThemes();
wp.desktop.applyWindowTheme( windowId, override );

// Layer 2 — Controls (Stable)
wp.desktop.registerWindowControl( def );
wp.desktop.unregisterWindowControl( id );       // pass 'core/close' to hide globally
wp.desktop.listWindowControls();
wp.desktop.applyWindowControls( windowId, override );

// Layer 3 — Slots (Stable)
wp.desktop.registerWindowSlot( def );
wp.desktop.unregisterWindowSlot( id );
wp.desktop.listWindowSlots();
wp.desktop.applyWindowSlot( windowId, slot, config );

// Layer 4 — Custom chrome (Experimental)
wp.desktop.registerWindowChrome( def );
wp.desktop.unregisterWindowChrome( id );
wp.desktop.listWindowChromes();
wp.desktop.applyWindowChrome( windowId, chromeId );
```

### JS hooks (under `wp.hooks` / `addFilter`-`addAction`)

| Name | Type | Status | Notes |
|------|------|--------|-------|
| `wp-desktop.window.chrome.theme` | filter | Stable | Mutate the resolved CSS-variable map per window. |
| `wp-desktop.window.chrome.theme-changed` | action | Stable | Fires after each successful theme apply. |
| `wp-desktop.window.chrome.controls` | filter | Stable | Mutate the resolved per-placement control list. |
| `wp-desktop.window.chrome.slot` | filter | Stable | Mutate the host element of each slot after content settles. |
| `wp-desktop.window.chrome.render` | filter | Experimental | Mutate the chrome id selected for a window. |
| `wp-desktop.window.chrome.applied` | action | Stable | Fires per layer after a paint completes. `layer` is `'controls' \| 'slots' \| 'chrome'`. |

### Iframe-side bridge (`wp.desktop.iframe.chrome.*`) — Stable

Inside any chromeless iframe, plugin code can drive its own window's chrome via these helpers (parent-side handlers route them to the matching `Window.setAppearance*` methods):

```ts
wp.desktop.iframe.chrome.setTheme( tokens );    // CSS-var map
wp.desktop.iframe.chrome.setControls( config ); // WindowControlsConfig
wp.desktop.iframe.chrome.setSlot( name, html ); // sandboxed via textContent
```

### postMessage protocol additions

```ts
// iframe → parent
{ type: 'wp-desktop-chrome-theme',    tokens: Record< string, string > }
{ type: 'wp-desktop-chrome-controls', config: WindowControlsConfig }
{ type: 'wp-desktop-chrome-slot',     slot: string, html: string }
```

Each is origin-gated to the parent shell's origin and source-gated to the matching window's iframe `contentWindow`.

---

## See also

- [Hooks Reference](./hooks-reference.md) — the PHP side of the API.
- [Examples — React to window events](./examples/react-to-window-events.md)
- [Examples — Add a dock badge](./examples/dock-badge.md)
- [Examples — Register a wallpaper](./examples/register-wallpaper.md)
- [Examples — Cross-window devtools](./examples/devtools-instrumentation.md)
- [Examples — Send a chat message](./examples/messaging-send.md)
- [Examples — Pulse a window's icon](./examples/window-request-attention.md)
- [Examples — Window themes](./examples/window-theme.md)
- [Examples — Window controls](./examples/window-controls.md)
- [Examples — Window slots](./examples/window-slot.md)
- [Examples — Custom window chrome (Experimental)](./examples/custom-chrome.md)
