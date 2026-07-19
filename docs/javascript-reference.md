# JavaScript Reference

The browser-side contract. Four layers:

1. **WordPress-style hooks** via `window.wp.hooks` — the primary extension surface.
2. **CustomEvents** dispatched on `document` in the parent shell — for shell-side plugins.
3. **`window.wp.desktop`** — the in-tree JS API for the WindowManager, Dock, and hook helpers.
4. **`postMessage`** bridge — typed messages between the parent shell and iframe windows.

Status labels match the [Hooks Reference](./hooks-reference.md): **Stable / Experimental / Planned**.

> **Looking for the full inventory?** [`api-index.md`](./api-index.md) lists every `wp.desktop.*` method, CustomEvent, and `postMessage` type with its current status — one table, one place to grep.

## Must-know APIs

These four cover ~90% of plugin code. Reach for them before anything else:

| API | Use it for | Status |
|---|---|---|
| [`wp.desktop.fetch( input, init?, opts? )`](#wpdesktopfetch-input-init-opts---stable-since-080) | **Every HTTP call from a plugin.** Routes through the framework so the active window's title-bar pulse + activity bus light up automatically. ESLint forbids raw `fetch()` in-tree. | **Stable** *(since 0.8.0)* |
| [`wp.desktop.confirm( opts )`](#wpdesktopconfirm--stable-since-090) / [`wpdConfirm()`](#wpdesktopconfirm--stable-since-090) | Modal Yes/No replacement for `window.confirm()`. ESLint forbids `confirm`/`alert`/`prompt` — use this. | **Stable** *(since 0.9.0)* |
| [`wp.desktop.ready( cb )`](#whenready--ready--isready) | Run a callback once the shell has booted (or immediately if already booted). Idiomatic boot pattern for any script enqueued with the `desktop-mode` dep. | **Stable** *(since 0.5.1)* |
| [`wp.desktop.openWindow( id, opts? )`](#wpdesktopopenwindow-id-opts---stable-since-060) | Open or focus a registered native window by id. Symmetric with `desktop_mode_register_window( $id, … )` PHP-side. | **Stable** *(since 0.6.0)* |

---

## 1. CustomEvents

All events bubble from `document`. The shell dispatches them; plugins listen.

### `desktop-mode-init` — Stable
Fires once, after the shell has initialized and before any session restoration completes. `detail.restored` is `true` if a saved session was restored; `false` for a fresh session.

```javascript
document.addEventListener( 'desktop-mode-init', ( e ) => {
    const { config, restored } = e.detail;
    console.log( 'Desktop up; restored?', restored );
} );
```

**`detail` shape:**

```typescript
{ config: DesktopConfig, restored: boolean }
```

> **Use `wp.desktop.ready( cb )` for bootstrap, not this event.** `ready()` (and its alias `whenReady()`) handles both the already-fired and not-yet-fired cases — a script loaded after `desktop-mode-init` (server-sync-injected widgets, settings tabs, command scripts) still gets its callback invoked via microtask. A raw `addEventListener( 'desktop-mode-init', cb )` listener registered after the event has dispatched silently never fires. The CustomEvent stays around for non-bootstrap analytics / instrumentation; bootstrap goes through `ready`. See ["Bootstrap" under Hooks](#bootstrap) for the full story.

---

### `desktop-mode-window-opened` — Stable
Fires every time a window is added to the stack — both fresh opens and session-restored windows.

```javascript
document.addEventListener( 'desktop-mode-window-opened', ( e ) => {
    const { windowId, page, title } = e.detail;
} );
```

**`detail` shape:**

```typescript
{ windowId: string, page: string, title: string, url: string }
```

`page` and `url` currently carry the same value (the window's URL).

---

### `desktop-mode-window-reopened` — Stable
Fires when `wp.desktop.openWindow(id)` (or `windowManager.open(...)`) is called for a `baseId` whose window already exists on the active desktop. The framework focuses + restores the existing window — the render callback does NOT re-run, and `desktop-mode-window-opened` does NOT fire again. This event is the unambiguous "user requested an open while already open" signal — exactly once per `open()` call on an existing instance.

Since 0.9.4 the reuse is **URL-aware**: when the `open()` call carries a URL the window is not already showing — and it isn't the window's home / dock landing URL — the framework also navigates the existing iframe to that URL in place (so e.g. `plugins.php?action=activate&plugin=…&_wpnonce=…` actually runs instead of being dropped by a bare focus). The `navigated` flag in the detail reports which path was taken.

Plugins that hold per-window state (e.g. the code editor's active file) should listen here to re-orient the existing window's content to whatever the caller wants to show. The open call is synchronous, so any state the caller sets BEFORE invoking `openWindow` is already in place when this fires.

```javascript
document.addEventListener( 'desktop-mode-window-reopened', ( e ) => {
    if ( e.detail.windowId !== 'my-plugin/inbox' ) return;
    // Re-orient the window's main pane to whatever the caller
    // wanted to show.
    refreshFocusedItem();
} );
```

**`detail` shape:**

```typescript
{ windowId: string, baseId: string, wasMinimized: boolean, navigated: boolean }
```

`wasMinimized` reflects the state at the moment of the call, BEFORE the framework's automatic restore-from-minimized happens. Useful for animating "popped from the dock".

`navigated` *(since 0.9.4)* is `true` when the open request carried a URL the window wasn't already showing and the framework navigated the existing iframe to it in place. Always `false` for native windows and for re-opens that resolve to a plain focus.

---

### `desktop-mode-window-content-loading` — Stable *(since 0.6.0)*

Fires every time a window enters the **loading** state — at construction (every window starts loading) and whenever a plugin calls `Window.markContentLoading()` or the native render context's `ctx.window.markLoading()` mid-life (e.g. before refetching data).

The shell paints a `<wpd-spinner>` overlay over the body while the window is loading and fades the body content out. The overlay's spinner is sized responsively (`clamp(96px, 14vw, 192px)`) so it scales with the window's width.

**Edge-triggered.** Idempotent calls don't re-fire — a plugin that calls `markLoading()` twice in a row sees the event exactly once.

```javascript
document.addEventListener( 'desktop-mode-window-content-loading', ( e ) => {
    if ( e.detail.windowId === 'my-plugin/inbox' ) {
        analytics.start( 'inbox-load' );
    }
} );
```

**`detail` shape:** `{ windowId: string }`

Companion `wp.hooks` action: `HOOKS.WINDOW_CONTENT_LOADING` (`desktop-mode.window.content-loading`).

---

### `desktop-mode-window-content-loaded` — Stable *(since 0.6.0)*

Fires when a window's body content becomes ready — for iframe windows the moment the chromeless bridge announces `desktop-mode-ready`, for native windows after the user's `render( body )` callback (or its returned Promise) resolves, and whenever a plugin calls `Window.markContentLoaded()` or `ctx.window.markReady()` mid-life. The shell removes the loading overlay and fades the body content in on this transition.

**Use this instead of branching on iframe vs. native.** The unified signal across both render strategies. Iframe-only consumers can still subscribe to `desktop-mode.iframe.ready`, which fires alongside this event for iframe windows.

**Edge-triggered.** Only fires on a loading → ready transition. A plugin that arms loading via `markContentLoading()` and then calls `markContentLoaded()` again will see a fresh event each cycle.

```javascript
document.addEventListener( 'desktop-mode-window-content-loaded', ( e ) => {
    if ( e.detail.windowId === 'my-plugin/inbox' ) {
        analytics.complete( 'inbox-load' );
    }
} );
```

**`detail` shape:** `{ windowId: string }`

Companion `wp.hooks` action: `HOOKS.WINDOW_CONTENT_LOADED` (`desktop-mode.window.content-loaded`).

#### Programmatic equivalent — `Window.whenContentReady()` *(since 0.8.8)*

For code paths that don't want to wire a CustomEvent listener (e.g. a plugin coordinating with an `iframeContent: { bridge: true }` native window before its first `send`), the `Window` facade exposes a Promise-returning version:

```javascript
wp.desktop.openWindow( 'my-plugin/inbox' ); // returns boolean, not the Window

// The Window instance is registered asynchronously — grab it via the
// `opened` lifecycle, or directly when it was already open.
const init = async ( win ) => {
    await win.whenContentReady();
    // Bridge listeners are guaranteed wired here; safe to send / connect.
    win.send( 'init', { … } );
};

const existing = wp.desktop.windowManager.getById( 'my-plugin/inbox' );
if ( existing ) {
    init( existing );
} else {
    wp.desktop.onWindow( 'my-plugin/inbox', {
        opened: () => init( wp.desktop.windowManager.getById( 'my-plugin/inbox' ) ),
    } );
}
```

Resolves immediately for windows that are already ready, otherwise on the next matching `desktop-mode-window-content-loaded` for this window's id. Mirrors `HOOKS.WINDOW_CONTENT_LOADED` semantics — works for both iframe and native windows.

---

### `desktop-mode-window-focused` — Stable
Fires when a window is focused (promoted to topmost z-index).

```javascript
document.addEventListener( 'desktop-mode-window-focused', ( e ) => {
    console.log( 'Focused', e.detail.windowId );
} );
```

**`detail` shape:** `{ windowId: string }`

---

### `desktop-mode-window-blurred` — Stable *(since 0.5.5)*

Fires on the window that **lost** focus when another window is promoted to topmost. Pairs with `desktop-mode-window-focused` for the symmetric "I am no longer the active window" signal — without this event, apps had to track focus transitions themselves to derive blur. Useful for badge policies, attention timers, and any "render differently when not active" UI.

```javascript
document.addEventListener( 'desktop-mode-window-blurred', ( e ) => {
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

Companion `wp.hooks` action: `HOOKS.WINDOW_BLURRED` (`desktop-mode.window.blurred`).

---

### `desktop-mode-window-closing` — Stable
Fires when the user closes a window, BEFORE the outer element is detached from the DOM. Subscribers needing an element reference (wallpaper overlays anchored to specific windows, snow that has piled on the window top, measurement caches) should listen here rather than to `desktop-mode-window-closed` — by the time the `closed` handler runs the element may be mid-fade-out.

**`detail` shape:** `{ windowId: string, element: HTMLElement }`

---

### `desktop-mode-window-closed` — Stable
Fires after the window is removed from the stack and begins its closing animation. Payload intentionally minimal; use `desktop-mode-window-closing` above when you need the element reference.

**`detail` shape:** `{ windowId: string }`

---

### `desktop-mode-window-changed` — Experimental
Internal event used by the session saver. Fires for geometry changes (drag-end, resize-end) and state transitions (minimize, maximize, fullscreen, restore). Signature may change — prefer the per-operation events above for external use.

**`detail` shape:**

```typescript
{ windowId?: string, reason: 'moved' | 'resized' | 'state' | 'cascade' | 'tile', state?: WindowState }
```

Batch-arrange dispatches (`reason: 'cascade'` / `'tile'`) omit `windowId` and `state` — only the per-window dispatches (`'moved'`, `'resized'`, `'state'`) carry them.

---

### `desktop-mode-presence-changed` — Stable *(since 0.5.5)*

Fires when a tracked user's presence transitions between `online`,
`inactive`, and `offline`. Does NOT fire on stable ticks where the
status didn't change — listeners only see real transitions, so
"user came online" / "user went away" UIs hook here without
debouncing themselves.

The viewer-side filter (`desktop_mode_presence_visible_users`) gates
which users surface in any one viewer's tab — a transition for a
user the viewer can't see produces no event.

```javascript
document.addEventListener( 'desktop-mode-presence-changed', ( e ) => {
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

### `desktop-mode-layout-changed` — Stable *(since 0.6.0)*
Fires when the user picks a new top-level desktop layout in OS Settings → Appearance. The shell tears down and rebuilds the dock(s) before the event fires; plugins that cached `wp.desktop.dock` should re-fetch from the event detail (or read `wp.desktop.dock` again — it's mutated in place). The shell root reflects the new value in `data-desktop-mode-layout` attribute by the time this fires, so CSS selectors keyed on it will already match.

```javascript
document.addEventListener( 'desktop-mode-layout-changed', ( e ) => {
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

### Drag-and-drop CustomEvents — Stable *(since 0.8.1)*

Fired on `document` by `wp.desktop.dragManager` for every in-shell
drag gesture (file tile, entity tile, plugin-defined sources). All
share `event.detail.payload` carrying the originating
`{ type, source, data, ghost? }`.

```javascript
document.addEventListener( 'desktop-mode.drag.start', ( e ) => {
    // The drag has crossed the threshold; ghost is mounted.
    // e.detail.payload — see `DragPayload`.
} );
document.addEventListener( 'desktop-mode.drag.move', ( e ) => {
    // Each pointermove past lift. e.detail.{ payload, clientX, clientY }
} );
document.addEventListener( 'desktop-mode.drag.enter', ( e ) => {
    // Cursor entered an accepting target. e.detail.{ payload, targetId }
} );
document.addEventListener( 'desktop-mode.drag.leave', ( e ) => {
    // Cursor left an accepting target. e.detail.{ payload, targetId }
} );
document.addEventListener( 'desktop-mode.drag.rejected', ( e ) => {
    // Cursor over a registered target whose accept() returned false.
    // e.detail.{ payload, targetId }
} );
document.addEventListener( 'desktop-mode.drag.commit', ( e ) => {
    // Drop landed; target.onDrop has fired.
    // e.detail.{ payload, targetId }
} );
document.addEventListener( 'desktop-mode.drag.cancel', ( e ) => {
    // Drag aborted (Escape, blur, no-target, rejected, …).
    // e.detail.{ payload, reason }
} );
document.addEventListener( 'desktop-mode.drag.end', ( e ) => {
    // Always fires last — pair with .start for symmetric bookkeeping.
    // e.detail.{ payload, reason }
} );
```

The cross-iframe `desktop-mode-drag-*` / `desktop-mode-drop`
postMessages and the `desktop-mode-cross-frame-drag-start` /
`-end` CustomEvents from `wp.desktop.dragBridge` (Media Library
payload channel) are a separate, lower-level surface and remain
Stable since 0.5.0.

**Focus follows the drag** *(since 0.9.4)*: while a drag is in
flight — any drag, whatever its source or payload: a DragManager
session, a cross-iframe bridge drag (Media Library), an OS file, an
image or text selection lifted from anywhere — the window under the
cursor is raised (focused) after a ~250 ms hover dwell, macOS
spring-loading style, so the drop target comes forward. Sweeping
across a window without resting on it does not raise it. Drags
hovering an iframe window from outside a bridge session are detected
via the `desktop-mode-drag-hover` heartbeat the chromeless bridge
forwards (see `bridge-protocol.md`). Plugins can veto per activation
via the `desktop-mode.window.focus-on-drag-hover` filter (see the
[window lifecycle hooks table](#window-lifecycle)).

### Pinned-note drag payloads — Experimental *(since 0.9.6)*

The pinned-notes feature (the Note Pad widget + the wallpaper notes
layer) rides the DragManager with two payload `type` slugs:

| `payload.type` | Source | `payload.data` shape |
| --- | --- | --- |
| `'note-draft'` | The Note Pad widget's top sheet being torn off | `{ text: string, color: string, isPublic: boolean }` |
| `'note'` | An existing pinned note carried by its pushpin | `{ noteId: number, canEdit: boolean, updatedAtMs: number }` |

Both are consumed by the wallpaper canvas target (create / reposition
— wallpaper root only) and, for `'note'`, by the recycle-bin targets
(soft-trash with Undo; `accept` is gated on `data.canEdit`). Plugin
drop targets can filter on these slugs like any other payload type.

A `'note'` drag is also accepted by the **Posts** drop targets, which
convert the note to a draft post — the drag counterpart of the inline
"Convert to post" button (`src/notes/posts-drop-target.ts`). Three
surfaces, registered only when `desktopModeConfig.canCreatePosts` is
true (the current user has `edit_posts`):

1. The Posts **dock tile** (`[data-menu-slug="menu-posts"]`) and
2. the open **native Posts window** body (`[data-desktop-mode-posts-root]`)
   — both get a real `DropTarget` and set
   `data-desktop-mode-posts-drop-active` while a note hovers.
3. The Posts **shortcut tile in the Spatial layout**. There the core
   menu icons are files-layer shortcut tiles already claimed by the
   files layer's per-tile reject target, so notes can't register their
   own target. Instead the files layer exposes a **tile-payload seam**
   (`registerTilePayloadHandler( type, { appliesTo, accept, acceptLabel,
   onDrop } )` in `src/desktop-files/tile-payloads.ts`); the reject
   target consults it, so a feature can opt a payload type into a tile
   whose placement it recognizes. Notes register a `'note'` handler
   scoped to tiles whose `file.shortcutUrl` points at the Posts screen.
   The same seam is available to any plugin that wants to accept a drop
   on its own shortcut icon.

One companion CustomEvent (document-level):

```javascript
// A note was created outside the layer (the widget's keyboard
// "Pin to desktop" path POSTs from its own bundle) — the layer
// listens and pins it with the insertion animation.
document.addEventListener( 'desktop-mode-note-created', ( e ) => {
    // e.detail.note — the REST `Note` shape from /desktop-mode/v1/notes.
} );
```

The REST base is surfaced to the shell as `desktopModeConfig.notesUrl`
(`/desktop-mode/v1/notes`); the notes layer only boots when it is
present. The controller's routes are `GET`/`POST /notes`, `PATCH`/
`DELETE /notes/:id`, `POST /notes/:id/restore`, and — since 0.9.6 —
`POST /notes/:id/convert`, which spawns a draft post from the note,
trashes the note, and returns `{ noteId, postId, editUrl }`. The
convert route is owner-only and requires the `edit_posts` capability;
the shell exposes whether the current user qualifies as
`desktopModeConfig.canCreatePosts` (since 0.9.6) so the "Convert to
post" affordances only render for eligible users. Restoring a
convert-trashed note (the Undo path) also discards the draft it
spawned.

### `wp.desktop.dragBridge` — cross-iframe drag — Stable *(since 0.6.0)*

The bridge is the postMessage channel that lets shell-side drags
(My WordPress media tiles, post tiles, user tiles) land inside iframe
windows (the Gutenberg editor, the site editor). When a DragManager
session begins on a shell tile carrying a `bridgePayload`, the shell
fans the payload into `dragBridge.start(payload)`. While the gesture
is in flight, the shell routes pointer events through a per-window
overlay (`src/drag/iframe-drop-targets.ts`) and posts the following
messages into the iframe under the cursor:

| postMessage type | Direction | When | Payload shape |
| --- | --- | --- | --- |
| `desktop-mode-drag-over` | parent → iframe | cursor entered the iframe | `{ type, payload: DragBridgePayload }` |
| `desktop-mode-drag-leave` | parent → iframe | cursor left the iframe | `{ type }` |
| `desktop-mode-drop` | parent → iframe | pointerup over the iframe | `{ type, payload: DragBridgePayload, position: { x, y } }` |
| `desktop-mode-drag-start` | iframe → parent | iframe initiated its own drag | `{ type, payload: DragBridgePayload }` |
| `desktop-mode-drag-end` | iframe → parent | iframe-initiated drag ended | `{ type }` |
| `desktop-mode-drag-payload-request` | iframe → parent | iframe wants the current payload | reply: `{ type: 'desktop-mode-drag-payload', payload }` |

`DragBridgePayload` is a discriminated union keyed on `kind`:

```ts
type DragBridgePayload =
  | { kind: 'attachment'; id: number; url: string; title: string;
      alt: string; mime: string; thumbnailUrl?: string;
      sizes?: Record<string, unknown> }
  | { kind: 'post'; id: number; postType: string; url: string;
      title: string }
  | { kind: 'user'; id: number; url: string; title: string };
```

Public `DragBridgeApi` surface:

```ts
interface DragBridgeApi {
  getPayload(): DragBridgePayload | null;
  isDragging(): boolean;
  start( payload: DragBridgePayload ): void;
  end(): void;
}
```

`start` / `end` let in-process code (e.g. a plugin's own drag source)
drive the bridge directly without postMessage round-trips. The shell
calls these automatically when a `'shortcut'` DragManager session
starts/ends with a `bridgePayload` attached.

Same-origin messages only — the bridge checks `e.origin` against the
parent's own origin before storing payloads or responding.

The built-in Gutenberg drop receiver (`assets/js/gutenberg-drop-receiver.min.js`,
enqueued on `post.php` / `post-new.php`; `site-editor.php` is
currently excluded because the FSE block-editor store isn't
available until a template is open in the canvas)
listens for `desktop-mode-drop` and inserts a block:

- `attachment` `image/*` → `core/image`
- `attachment` `video/*` → `core/video`
- `attachment` `audio/*` → `core/audio`
- `attachment` other → `core/file`
- `post` / `user` → `core/paragraph` with `<a href="URL">title</a>`

### OS-file drop hooks — Experimental *(since 0.8.6)*

When the user drags a file in from the host operating system
(Finder, Explorer, Nautilus) onto any surface in Desktop Mode
— the wallpaper, a folder, a native window, or a chromeless
admin iframe — the shell catches it and routes it through a
confirmation dialog. The full pipeline is hookable via
`window.wp.hooks`:

| Hook | Kind | Notes |
| --- | --- | --- |
| `desktop-mode.drop.files-detected` | filter | `(files: File[], ctx) => File[]` — before mime / size filter. Return `[]` to abort. |
| `desktop-mode.drop.files-rejected` | action | `{ rejections, context }` — files that failed the allow-list. |
| `desktop-mode.drop.dialog-fields` | filter | `(entry, ctx) => entry` — mutate per-file defaults. |
| `desktop-mode.drop.before-upload` | filter | `(payload, ctx) => payload \| null` — last call before `wp/v2/media`; `null` cancels. |
| `desktop-mode.drop.after-upload` | action | `{ result, fields, context }` |
| `desktop-mode.drop.upload-failed` | action | `{ file, error, context }` |

Iframes forward OS drops to the parent shell via
`postMessage` of type `desktop-mode-os-file-drop` with a
`{ files: File[], x, y }` payload — same-origin only.

See [`docs/examples/os-file-drop.md`](examples/os-file-drop.md)
for two end-to-end recipes (stamping the active folder on
every upload, hand-off to a CSV importer).

---

### `desktop-mode-registry-changed` — Stable *(since 0.7.0)*

Fires when a server-side registry (dock items, native windows, desktop icons) is mutated by the live-refresh applier — i.e. when the chromeless `plugins.php` iframe `postMessage`s `desktop-mode-plugins-changed` after a peer plugin is activated or deactivated. The shell diffs the new payload against its prior snapshot by `id` and dispatches one event per registry that actually changed. No event fires when the diff is empty.

> **Naming.** This event uses the `desktop-mode-` prefix — not a `wp-` prefix, which is reserved for WordPress Core per plugin reviewer guidelines.

```javascript
document.addEventListener( 'desktop-mode-registry-changed', ( e ) => {
    const { registry, added, removed } = e.detail;
    if ( registry === 'native-windows' && added.includes( 'jorvy' ) ) {
        // A peer plugin's native window just appeared mid-session.
        // Hydrate any state that depends on it being present.
    }
} );
```

**`detail` shape:**

```typescript
{
    registry: 'dock-items' | 'native-windows' | 'desktop-icons',
    added:    string[],   // ids present in the new payload but not the prior snapshot
    removed:  string[],   // ids that were in the prior snapshot but are gone
}
```

**When it fires:**

- A user activates a peer plugin via `plugins.php` rendered inside the open shell — `added` lists the new ids.
- A user deactivates a peer plugin from the same place — `removed` lists the gone ids.
- An idempotent re-apply (same payload, same ids) does NOT fire the event.

**When it does NOT fire (known gap):**

- Activation outside the open shell (another browser tab, `wp-cli plugin activate`, REST). The broadcast is bound to the chromeless `plugins.php` iframe's load — there is no cross-tab or out-of-band push today. Plugins that need to handle that case can call `wp.desktop.refreshMenu()` themselves on a signal of their own choosing.

The `server*` registries (commands, settings tabs, widgets, wallpapers, …) already publish their own per-registry subscribe APIs — those are the right surface for plugin authors hooking into those layers, not this event.

---

### `desktop-mode-os-settings-save-lifecycle` — Stable *(since 0.7.2)*

Fires on every phase transition of an OS Settings save — both the built-in panel's edits and programmatic patches via [`wp.desktop.updateOsSettings()`](#updateossettings-patch-opts---stable-since-072).

**`detail` shape:**

```typescript
{
    phase: 'pending' | 'saving' | 'saved' | 'failed',
    error?: string,            // 'failed' only — the error message
    rolledBackTo?: OsSettingsState,  // 'failed' only — see below
}
```

The phases:

- `pending` — a change has been made; the debounced REST sync is queued (250 ms window).
- `saving` — the REST request is in flight.
- `saved` — the REST request returned OK.
- `failed` — the REST request errored. `error` carries the message; `rolledBackTo` carries the last server-confirmed snapshot listeners should restore to (it may be absent when no save has ever succeeded yet — a rare first-load failure). The framework has already reverted `localStorage` and the in-memory state to that snapshot; listeners that own UI keyed off the settings state should repaint from it so the controls visually revert to the last-confirmed values.

`<wpd-save-status auto>` subscribes to exactly this event by default — drop the component into a settings surface and the saving / saved / failed indicator wires itself.

---

### `desktop-mode-default-window-changed` — Stable *(since 0.7.0)*

Fires after `wp.desktop.setDefaultWindow( url | null )` **successfully** persists the user's "open on startup" preference through the REST endpoint. No event fires when the save errors. The same payload is assigned to `wp.desktop.config.defaultWindow` in place; the ⋯-menu listens here to repaint its checkmarks live.

**`detail` shape:**

```typescript
{
    enabled: boolean,  // false when the default was cleared via setDefaultWindow( null )
    url: string,
}
```

---

### `desktop-mode-open-ai` — Experimental *(since 0.7.0)*

**Direction inverted:** plugins dispatch this one; the shell listens. Dispatching it on `document` opens the AI Assistant spotlight overlay — equivalent to `wp.desktop.ai.open()` for code that runs without a `wp.desktop` reference in scope (the admin-bar "Ask AI ⌘K" button is the in-tree dispatcher). No detail payload. The shell routes the open through the palette cycle, so any other open palette is dismissed first (single-palette-at-a-time invariant).

```javascript
document.dispatchEvent( new CustomEvent( 'desktop-mode-open-ai' ) );
```

---

### `desktop-mode-intros-reset` — Experimental *(since 0.8.3)*

Fires after the user resets the first-run intro flags in **OS Settings → Features** and the REST delete succeeds. The shell has already mirrored the reset into every in-memory `window.desktopModeWindowConfig` blob (`introSeen: false`), so the next window-open re-fires its intro; already-loaded bundles that cache their own intro-state should listen here and invalidate it so their intro replays without an F5. No detail payload.

---

## 2. `window.wp.desktop` API

Populated after `desktop-mode-init`. Do not access before that event fires.

```typescript
window.wp.desktop = {
    // Window management
    windowManager:     WindowManager,
    openWindow:        ( id, opts? ) => boolean,
    onWindow:          ( id, handlers, opts? ) => () => void,

    // Surfaces
    dock:              Dock | null,                            // primary (bottom)
    sideDock:          Dock | null,                            // since 0.6.0 — left, classic only
    desktopLayout:     'classic' | 'unified' | 'spatial',       // since 0.6.0
    icons:             IconsApi,                                // since 0.6.0
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
manager.open( config ): Promise< Window >;
manager.openNew( config ): Promise< Window >;
manager.focus( win: Window ): void;
manager.raise( windowId: string ): void;                                 // since 0.9.4 — restack to just below the top WITHOUT focusing; no focus/blur events

// Lookup
manager.getById( id: string ): Window | undefined;
manager.getByBaseId( baseId: string ): Window | undefined;
manager.getAllByBaseId( baseId: string ): Window[];                      // every instance sharing baseId, any desktop
manager.getAllByBaseIdOnActiveDesktop( baseId: string ): Window[];       // since 0.9.4 — same, filtered to the active desktop
manager.getAll(): Window[];
manager.getFocused(): Window | undefined;
manager.isActive( id: string ): boolean;                                 // exists, not minimized, focused, on the active desktop
manager.isActiveByBaseId( baseId: string ): boolean;                     // since 0.9.4 — isActive() for any instance sharing baseId

// Snapshot / surface
manager.snapshot(): Session;
manager.getVisibleRects(): VisibleWindowRect[];

// Batch operations
manager.closeAll( options?: { exceptIds?: string[] } ): number;          // since 0.5.0
manager.minimizeAll(): Window[];                                         // since 0.6.0
manager.restoreFrom( windows: Window[] ): void;                          // since 0.6.0
manager.toggleShowDesktop(): boolean;                                    // since 0.6.0
manager.cascade(): void;
manager.tile(): void;

// Virtual desktops ("Spaces")
manager.getDesktops(): Desktop[];                                        // since 0.6
manager.getActiveDesktop(): Desktop;                                     // since 0.6
manager.getActiveDesktopId(): string;                                    // since 0.6
manager.getPrimaryDesktopId(): string;                                   // since 0.5.0
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

> **`open()` requires a config object.** Passing a URL string used to silently produce a window stuck on a loading spinner with no error in the console. Since 0.6.0 the manager throws `TypeError` at the call site if `config` isn't an object, or if `id` / `url` / `title` are missing or wrong-typed. Build the config; don't shorthand it.

**`config.submenu`** — when present, the shell renders the array as an in-window tab strip below the title bar so the user can navigate child pages without leaving the window. Pass `item.submenu` whenever you open a window from a dock context — `openItem` and `openSubmenuPick` (in custom rail renderers) propagate it for you. Skip it for native windows that don't have admin sub-pages. The shell strips WordPress's auto-prepended self-link entry server-side, so `submenu.length > 0` reliably means "has real children" (no defensive filtering needed in your code). Since 0.6.x the shell prepends a synthetic "back to parent" tab (label = `config.title`, URL = `config.url`) as the first tab so the user can return to the parent listing without closing the window. If a caller-supplied submenu entry already points at `config.url` the synthetic tab is suppressed to avoid two tabs claiming the same URL.

**`minimizeAll()` / `restoreFrom( windows )` / `toggleShowDesktop()`** — the "Show Desktop" gesture decomposed into reusable primitives. `minimizeAll()` returns the windows it actually minimized (skipping windows already in the `'minimized'` state), so you can pair it with a later `restoreFrom( minimizedSet )` that touches only what you minimized. `toggleShowDesktop()` is the higher-level call mirroring the wallpaper-click behaviour exactly — minimize when anything is visible, restore when everything's hidden. Returns `true` when the new state is "showing the desktop." Since 0.9.4, all three are scoped to the **active virtual desktop only** — a window parked on a Space the user isn't currently viewing is left alone, unlike `closeAll()` below, which still acts across every desktop.

```js
// Plugin building an expand/collapse UI.
let parked = [];
function expand() {
    parked = wp.desktop.windowManager.minimizeAll();
}
function collapse() {
    wp.desktop.windowManager.restoreFrom( parked );
    parked = [];
}
```

**`getVisibleRects()`** — snapshot every open window's current geometry + state. One entry per window in the stack (regardless of virtual desktop), carrying a live element reference. Intended for wallpaper / overlay plugins that previously scraped `document.querySelectorAll( '.desktop-mode-window' )` and sniffed modifier class names to derive state. Callers filter on `state` themselves — minimized windows are included so the consumer can decide.

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
document.addEventListener( 'desktop-mode-init', () => {
    window.wp.desktop.windowManager.open( {
        id:    'my-ext-window',
        url:   '/wp-admin/admin.php?page=my-analytics',
        title: 'Analytics',
        icon:  'dashicons-chart-bar',
    } );
} );
```

Calling `open()` with an id (or `baseId`) that's already on screen focuses the existing window and restores it if minimized.

**URL-aware reuse** *(since 0.9.4)*: focusing is the whole story only when the requested URL is one the window is already showing — its live iframe URL, the URL it was opened with, or its home / dock landing URL (`parentUrl`); the comparison ignores the chromeless / portal flags, `_wp_http_referer`, and param order. Any *other* URL is treated as a real navigation request: the existing iframe navigates to it in place (via `location.assign()`, so in-frame Back still works) instead of the URL being silently dropped. This is what makes action links routed through `open()` — e.g. the post-install **Activate** link `plugins.php?action=activate&plugin=…&_wpnonce=…` while a Plugins window is already open — actually execute. Dock clicks keep their old behavior: clicking a tile whose window has sub-navigated only focuses it (the tile's URL is the window's home URL), never yanks it back to the landing page. The `desktop-mode-window-reopened` detail reports the outcome via `navigated`.

**Title-bar actions menu (iframe windows).** Every iframe-backed window renders a three-dots actions menu on the leading edge of its title bar. Built-in items:

- **"Open on startup"** — checkable; toggles this window as the user's default-window preference.
- **"Open another <Page>"** — only when the window was opened with `multi: true`. Calls `openNew()` with the window's *original* landing URL.
- **"Open in new window"** — opens a fresh sibling window seeded with the *current* iframe URL (post in-window navigation). Useful when the user has drilled into a sub-page (e.g. editing a specific post) and wants to peel a copy off without losing their place. The new window cascades and uses the same multi-instance id suffixing as `openNew()`.

**Multi-instance windows.** When `multi: true` is passed, the window gets the "Open another" item described above. `openNew()` always creates a fresh window — even when one with the same `baseId` is already open — assigning a suffixed id (`${baseId}-2`, `${baseId}-3`, …) so every instance can be tracked independently while the dock still groups them under the same icon.

**Dock hover-peek.** Multi-capable dock tiles render a hover-reveal *peek* popover instead of the legacy "+" chip. Hovering a multi tile that has at least one open instance fans out a stack of cards next to the tile (works on left, right, and bottom dock orientations):

- **Instance cards** — one per currently open window of this dock item **on the active virtual desktop** (since 0.9.4 — an instance parked on another Space doesn't clutter the peek for a desktop it isn't on), styled as miniature windows: faux titlebar with traffic-light dots, the page icon, the live window title (titlebar background uses `--desktop-mode-titlebar-bg-focused` so the mini-window matches the real window's chrome), plus a hash-tinted body. **Hovering an instance card raises that window to front** ("scrub through windows" — Mission Control / Aero Peek). **Clicking** focuses the window through `document.startViewTransition()` so the card morphs into the window position.
- **Ghost Card** — the trailing card with a dashed outline and a slow breathing pulse. Clicking it calls `windowManager.openNew()` for this tile, also animated through `startViewTransition()` (graceful fade fallback otherwise).

The popover caps at `min(80vh, 480px)` and **scrolls internally** when more cards exist than fit. After mount, JS measures and clamps the popover position so it never overflows the viewport edges (top/bottom/sides).

The peek is mouse-only — touch and pen pointers fall back to plain tap-to-focus / tap-to-open. It also suppresses itself for singleton tiles (no Ghost Card is meaningful) and for multi tiles with zero open instances (a plain click already does the only useful thing). The icon itself springs up + magnifies on hover for tactile feedback even when the peek isn't shown. `prefers-reduced-motion` disables every animation.

**Customizing peek cards.** Two filters let plugins reshape what each card looks like:

- `desktop-mode.dock.peek-card-content` — receives the default body element (`<span class="desktop-mode-dock-peek__card-body">`) and a `{ window, item }` context. Return a different element to replace just the body — perfect for rendering a real thumbnail, a status block, a chart, or anything else inside the card while keeping the default mini-window chrome (titlebar with dots + icon + title). When a plugin returns a non-default body, the peek adds a `--custom` modifier class so the default tinted background and ghost-line padding drop out, giving the plugin a clean canvas.
- `desktop-mode.dock.peek-card-element` — receives the fully-built default card and the same `{ window, item }` context. Return a different element to replace the **whole card** (chrome included). Plugins that take this path are responsible for preserving the `desktop-mode-dock-peek__card` class (the fan-out animation keys off it) and for re-wiring the click handler if focus-on-click should still work. Use `peek-card-content` when you only need to swap the body; reach for `peek-card-element` when you need to control titlebar + body together.

```javascript
window.wp.hooks.addFilter(
    'desktop-mode.dock.peek-card-content',
    'my-plugin/thumbnail',
    ( body, { window: win } ) => {
        const img = document.createElement( 'img' );
        img.src = `/wp-json/my-plugin/v1/thumbnail/${ win.id }`;
        img.alt = win.config.title;
        return img;
    }
);
```

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

`manager.open()` / `openNew()` resolve to, and `getById()`, `getAll()`, etc. synchronously return, `Window` instances. Public surface:

```typescript
interface Window {
    readonly id:      string;     // stable identifier
    readonly config:  WindowConfig;
    readonly element: HTMLElement; // outer .desktop-mode-window node
    state: 'normal' | 'minimized' | 'maximized' | 'fullscreen' | 'snapped-left' | 'snapped-right';

    // State predicates — added 0.6.0; equivalent to `state === '…'`
    // but easier to discover and harder to misspell at the call site.
    isMinimized():  boolean;
    isMaximized():  boolean;
    isFullscreen(): boolean;
    isSnapped( side?: 'left' | 'right' ): boolean;
    isFocused():    boolean;        // mirrors the desktop-mode-window--focused class

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

The `state` property is read-only-ish — mutate via the methods (`minimize()`, `restore()`, `maximize()`) so the manager fires the right lifecycle hooks (`desktop-mode.window.minimized`, etc.). Reading it is fine and cheap; the `is…()` predicates are equivalent and added in 0.6.0 so you don't have to remember the canonical state-string values.

```javascript
const win = wp.desktop.windowManager.getById( 'edit-php' );
// Both work; the predicate is harder to misuse than `! win.isMinimized?.()`
// (which used to silently coerce undefined → true on every plugin author's
// first attempt before the predicates landed).
if ( win && ! win.isMinimized() ) win.minimize();
```

#### `Window.send( channel, payload? )` — Stable *(since 0.5.5)*

Publish a payload into this window's content. **The unified abstraction over iframe `postMessage` and native render-callback dispatch — plugin authors write the same call regardless of how the window is rendered.**

For iframe windows (real iframes OR `iframeContent`-shorthand natives) the payload is delivered as `desktop-mode-window-send` via `postMessage` and surfaces inside the iframe via `wp.desktop.on( channel, cb )` (the iframe-bridge installs the API on `wp.desktop`). For pure-native windows the payload is dispatched in-process to subscribers the render callback registered through its `windowApi.on( channel, cb )`.

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

Native targets fire `onOpen` on the next microtask (no handshake to wait for); iframe targets fire it after the iframe acks the handshake. `isOpen()`, `disconnect()`, and the `desktop-mode.connection.*` hook lifecycle behave identically for both kinds.

---

### `wp.desktop.openWindow( id, opts? )` — Stable (since 0.6.0)

Open (or focus) a server-registered native window by id. Symmetric with `desktop_mode_register_window( $id, ... )` — pass the same string.

```typescript
wp.desktop.openWindow(
    id:    string,
    opts?: { source?: string },
): boolean;
```

Returns `true` if a window with that id is registered and was opened (or already open and focused), `false` otherwise.

Goes through the same canonical opener as the dock click + the wallpaper-icon click — so the body comes pre-populated with the cloned `<template>` declared at registration time. Plugin authors can rely on the same render-callback contract no matter which entry point opens the window.

> **Render-callback registry — `window.desktopModeNativeWindows`.** A PHP-registered native window pairs its `<template>` with an optional JS render callback the plugin's `script` registers at `window.desktopModeNativeWindows[ <id> ]`; the shell looks it up by id and invokes it with the window body. `window.wpDesktopNativeWindows` is a **deprecated compat alias** for bundles built before the rename — the shell merges both bags at read time when opening a native window, with the canonical `desktopModeNativeWindows` winning on id collisions. New code must register on `desktopModeNativeWindows`.

**`opts.source`** *(since 0.5.5)* — optional string identifying who triggered the open. The framework publishes `desktop-mode/open-requested` on the activity bus *before* the open is processed, so analytics, do-not-disturb modes, and audit subscribers can observe the user's intent independently of the outcome:

```javascript
wp.desktop.openWindow( 'my-plugin/inbox', { source: 'global-search' } );

wp.desktop.activity.subscribe( 'desktop-mode/open-requested', ( { windowId, source } ) => {
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

### `wp.desktop.openNewWindow( id, opts? )` — Stable *(since 0.8.3)*

Spawn a **brand-new instance** of a registered native window — even when one is already open. Where `openWindow` focuses an existing instance, `openNewWindow` always mounts a duplicate.

```typescript
wp.desktop.openNewWindow(
    id:    string,
    opts?: { source?: string },
): boolean;
```

Returns `true` when the registry matched the id (a fresh window with id `<base>-2` / `-3` / … is now mounted), `false` when no native window is registered with that id.

Powers the dock-peek "+" button for native windows so they behave like iframe windows do: every "+" yields a duplicate. `opts.source` carries the same semantics as `openWindow`'s — it tags the `desktop-mode/open-requested` activity-bus publish.

---

### `wp.desktop.fetch( input, init?, opts? )` — Stable *(since 0.8.0)*

Drop-in wrapper around the global `fetch()` that lights up the target window's title-bar **modem activity dot** while the request is in flight. Same return type and resolution semantics as native `fetch()` — callers can `.then(r => r.json())` / `await` / `catch` unchanged.

```js
// In any window's render callback / event handler:
const res = await wp.desktop.fetch( '/wp-json/myplugin/v1/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify( payload ),
} );
```

That's the whole pattern. The dot blinks for the duration of the round-trip, flashes green when the request completes (any HTTP status — native `fetch` semantics, so a `404`/`500` response still flashes green) and red when the fetch rejects (network error, CORS, abort — with the `Error.message` exposed as the dot's tooltip), then settles back to the always-on idle ring. **No CSS, no per-window plumbing, no DOM.**

#### Auto X-WP-Nonce *(since 0.8.2)*

`wp.desktop.fetch` automatically attaches `X-WP-Nonce: desktopModeConfig.restNonce` to **same-origin** requests whose URL targets a WordPress REST endpoint — either pretty-permalink (`/wp-json/...`) or plain-permalink (`?rest_route=...`). Without the header, WordPress's `rest_cookie_check_errors()` demotes the cookie session to anonymous and any capability-gated route returns `401`. You no longer need to remember to attach it by hand.

When composing REST URLs inside the shell, prefer the server-provided
`desktopModeConfig.restUrl` root over hard-coded `/wp-json/` paths so
plain-permalink installs route correctly too.

Rules:
- **Same-origin only.** Cross-origin requests never receive the header — the nonce is a credential for this site.
- **Caller wins.** If you pass `headers: { 'X-WP-Nonce': '...' }` (or the input `Request` already carries the header), the framework does not overwrite it.
- **REST endpoints only.** `admin-ajax.php` and other non-REST URLs are left alone — admin-ajax uses per-action `_wpnonce` parameters, not the `wp_rest` nonce.

#### Arguments

| Arg | Type | Description |
|---|---|---|
| `input` | `RequestInfo \| URL` | Same as native `fetch`. |
| `init` | `RequestInit?` | Same as native `fetch`. |
| `opts` | `{ windowId?: string; window?: Window; silent?: boolean }?` | Attribution + opt-out. |

`opts` is the only addition. Resolution order for "which window's title bar pulses":

1. **`opts.window`** — explicit `Window` reference. Use when you have the handle in scope (e.g. inside a render callback that received `ctx.window`).
2. **`opts.windowId`** — id looked up via `wp.desktop.windowManager.getById(id)`. Use when you have the id but not the instance (it's the most common case for native-window bundles — they know their own id from `desktop_mode_register_window( '…' )`).
3. **focused window** — `manager.getFocused()`. Default. So inside a click handler, the click already focused the window and the fetch attributes to it without any extra wiring.

`opts.silent: true` skips the indicator entirely. Reserved for background polls (heartbeat, presence, count-bumps) that shouldn't blink the title bar every tick. The fetch is otherwise identical.

#### Why it works

Internally, `wp.desktop.fetch` calls `Window.trackActivity( promise )` on the resolved target. The window enforces a **minimum saving-display time of 1.2s** so even a 50ms fetch shows a visible modem-blink before flashing green — fast successes don't get lost between the click and the next paint. Concurrent fetches reference-count: 5 in-flight settle as one burst when the **last** one lands, and the burst settles **failed** if **any** of them failed (the most recent error becomes the tooltip) — even when the final fetch itself succeeded — matching the user's "did everything go through?" mental model.

#### Migration tip

You don't need to migrate everything. Bundles that currently call native `fetch` keep working unchanged — they just don't show a title-bar pulse. Adopt `wp.desktop.fetch` per call where the indicator is valuable: REST mutations (saves, deletes, tag-add/remove), data refreshes that take more than a frame, anything users would otherwise wonder "did that work?". Keep using native `fetch` for fire-and-forget telemetry, prefetches, anything users shouldn't notice.

#### Source

`src/desktop.ts` `trackedFetch`. The component the dot is rendered with is [`<wpd-save-status>`](#wpd-save-status--experimental-since-080) — read on for the standalone component, plus `Window.trackActivity` / `Window.markActivity` for non-fetch async work.

See also [`examples/window-activity.md`](./examples/window-activity.md) for end-to-end recipes.

---

### `Window.trackActivity( promise )` — Experimental *(since 0.8.0)*

The lower-level primitive `wp.desktop.fetch()` is built on. Call it directly when you have a Promise from a non-fetch source — a `postMessage` handshake, an IndexedDB transaction, a `BroadcastChannel` round-trip, a long client-side computation wrapped in `requestAnimationFrame` chains.

```js
const win = wp.desktop.windowManager.getById( 'my-plugin/inbox' );
await win.trackActivity( indexedDbWrite( record ) );
```

Returns the Promise unchanged so callers can chain. Multiple concurrent calls are reference-counted and the **minimum 1.2s saving-display floor** still applies — so even a 100ms IDB write shows a visible modem blink.

### `Window.markActivity( phase, opts? )` — Experimental *(since 0.8.0)*

Manual escape hatch when the activity isn't a single Promise. Phases:

- `'idle'`    — clear. Indicator resets to the always-on green ring.
- `'pending'` / `'saving'` — modem-blink with a soft glow. Stays in this phase until you transition out.
- `'saved'`   — brief green flash. Auto-clears to `idle` after ~2.2s.
- `'failed'`  — red dot. `opts.error` becomes the host's `title` attribute (and so the native browser tooltip on hover). Auto-clears after ~6s.

```js
win.markActivity( 'saving' );
streamingSubscriber.on( 'data', () => {
    /* … */
} );
streamingSubscriber.on( 'end', () => win.markActivity( 'saved' ) );
streamingSubscriber.on( 'error', ( err ) => {
    win.markActivity( 'failed', { error: err.message } );
} );
```

Idempotent. Setting the same phase twice is a no-op except for resetting the auto-clear timer.

---

### `wp.desktop.getWindowConfig( id )` — Stable *(since 0.6.0)*

Read the bundle-bound config blob shipped via the `'config'` arg on `desktop_mode_register_window( $id, [ 'config' => … ] )`. Returns `undefined` when no config was registered for `id`.

```js
const cfg = wp.desktop.getWindowConfig( 'my-plugin-cron' );
// → { restNonce: '…', eventsUrl: 'https://…', … }
```

The blob is delivered through the same payload path as `wp_localize_script` `extra['data']` — it lands on both eager and lazy script-load paths, so it's the recommended way to ship REST URLs / nonces / capability flags / anything session-bound to a native-window bundle.

See [`examples/window-with-config.md`](./examples/window-with-config.md) for a full recipe.

### `wp.desktop.debug.window( id )` — Stable *(since 0.6.0)*

Read-only diagnostic snapshot of what the shell knows about a registered native window:

```js
wp.desktop.debug.window( 'my-plugin-cron' );
// → {
//     id: 'my-plugin-cron',
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
- `'lazy'` — only the shell-injected `<script data-desktop-mode-vendor>` tag is present.
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
manager.getPrimaryDesktopId(): string;     // since 0.5.0 — see below
manager.createDesktop(): Desktop;          // append a new one + return it
manager.switchDesktop( id ): void;         // make `id` the active desktop
manager.closeDesktop( id ): void;          // delete `id`; its windows migrate to the active desktop
```

Lifecycle hooks fire on each operation: `HOOKS.DESKTOP_CREATED`, `HOOKS.DESKTOP_CLOSED { desktopId, migratedTo }`, `HOOKS.DESKTOP_SWITCHED { from, to }`.

##### Primary desktop — `getPrimaryDesktopId()` *(since 0.5.0)*

The "primary" desktop is the canonical one batch operations and migration logic treat as the survivor. Default: the first desktop returned by `getDesktops()` (typically `desktop-1`). Filterable via the `desktop-mode.primary-desktop-id` filter so plugins that pin a different convention (e.g. an "Inbox" desktop) can override:

```javascript
wp.hooks.addFilter(
    'desktop-mode.primary-desktop-id',
    'my-plugin',
    ( defaultId, desktops ) => {
        const inbox = desktops.find( ( d ) => d.label === 'Inbox' );
        return inbox ? inbox.id : defaultId;
    }
);
```

Filter receives `( defaultId: string, desktops: Desktop[] )` and must return a string id that matches one of the existing desktops — the manager validates the result and falls back to `defaultId` on any miss.

---

#### Batch close — `closeAll()` *(since 0.5.0)*

```typescript
manager.closeAll( options?: { exceptIds?: string[] } ): number;
```

Closes every open window (across all desktops) and returns the number actually closed. Optional `exceptIds` skips specific windows entirely — never even passed to the filter. Unlike `minimizeAll()` / `restoreFrom()` / `toggleShowDesktop()` (above, active-desktop-only since 0.9.4), `closeAll()` is not desktop-scoped.

**Hook chain:**

| Hook | Type | Payload | Use |
|---|---|---|---|
| `desktop-mode.windows.before-close-all` | action | `{ candidates: Window[] }` | Cleanup, dismiss menus, cancel pending saves |
| `desktop-mode.windows.close-all` | filter | `Window[]` → `Window[]` | **Protect specific windows** by removing them from the list. Returning `[]` cancels the close entirely. |
| `desktop-mode.windows.after-close-all` | action | `{ closed: number, skipped: Window[] }` | Toast, telemetry, refocus a tile |

```javascript
// Protect any window with unsaved Gutenberg edits.
wp.hooks.addFilter(
    'desktop-mode.windows.close-all',
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

`setBadge( id, count )` is the canonical way to surface a numeric count on a tile; calls fire `desktop-mode/badge-changed` on the activity bus with the rail discriminator — `rail: 'taskbar'` for this bottom primary rail, `rail: 'dock'` for the Classic-layout side rail (`sideDock`) *(since 0.6.0)*. `Dock.removeSystemItem( id )` fires `HOOKS.DOCK_ITEM_REMOVED` *(since 0.6.0)* — the symmetric counterpart of `HOOKS.DOCK_ITEM_APPENDED`. See [`docs/examples/dock-badge.md`](./examples/dock-badge.md).

> **Layout switching note** — the underlying instance is replaced when the user picks a new layout in OS Settings → Appearance. `wp.desktop.dock` is mutated in place so a fresh property read returns the current dock; plugins that **cache** the reference earlier should listen for `desktop-mode-layout-changed` and refresh.

---

### `sideDock` — Stable *(since 0.6.0)*
Secondary `Dock` instance that hosts **core WordPress admin menus** (Dashboard, Posts, Pages, Media, Users, Settings, CPTs, taxonomies) along the **left edge**. Non-null only when `desktopLayout === 'classic'` — `null` in Unified and Spatial.

Same `Dock` API as `dock`, just with `data-desktop-mode-dock-placement="left"` so its CSS selectors don't collide with the bottom rail.

```js
wp.desktop.sideDock?.setBadge( 'edit.php', 3 );
```

**Icon fallback:** as with the primary dock, a menu without dashicon / SVG / URL renders a letter badge in a hue derived from the title — same plugin, same colour across reloads.

---

### `desktopLayout` — Stable *(since 0.6.0)*
Currently-active top-level layout. One of `'classic' | 'unified' | 'spatial'`. Mirrors the user's OS Settings → Appearance pick and the `data-desktop-mode-layout` attribute on the shell root.

```js
if ( wp.desktop.desktopLayout === 'spatial' ) {
    // Core menus are wallpaper icons; expect `sideDock` to be null.
}
```

Listen for `desktop-mode-layout-changed` to react to a switch.

---

### `setBadge` — Stable *(since 0.6.0)*

Three rails — the primary (bottom) dock, the Classic-layout side dock, and the wallpaper icons — share the same `setBadge( id, count )` shape. **The id space is unified** (a dock item's `slug`, a system tile's id, or a desktop icon's id), so plugin authors fan a count to every rail without branching to figure out which one happens to host the tile under the user's current layout:

```js
function setOrdersBadge( count ) {
    wp.desktop.dock?.setBadge?.(     'my-orders', count );
    wp.desktop.sideDock?.setBadge?.( 'my-orders', count );
    wp.desktop.icons?.setBadge?.(    'my-orders', count );
}
setOrdersBadge( 7 );
setOrdersBadge( 0 );  // clear
```

Three calls; the rail that owns the id paints, the others bow out silently. Each call:

- **Idempotent on the icon rail** — same count twice = no DOM mutation, no re-emit. The two Dock rails currently re-paint and re-publish `desktop-mode/badge-changed` on every call, so avoid hot-looping `setBadge` with an unchanged count.
- **`0` clears** — and on the two Dock rails it also drops the client-side override so the server-declared `item.badge` resumes ownership on the next live menu refresh.
- **`> 99` renders as `99+`**.
- **Silent no-op when the id isn't on this rail** — keeps the fan-to-all-rails pattern from triple-emitting.
- **Survives a full grid rebuild** — plugin-set values persist across plugin activations / live menu refreshes.

Every applied change publishes on:

- `desktop-mode/badge-changed` activity channel with `{ itemId, count, rail: 'dock' | 'taskbar' | 'icon' }`.
- `HOOKS.ICON_BADGE_CHANGED` action with `{ iconId, count, previousCount }` *(icon rail only)*.

The rails do NOT auto-suppress based on window state — that's per-app UX policy. The canonical "show 0 while my window is active" recipe lives in [`docs/examples/dock-badge.md`](./examples/dock-badge.md).

### `icons` — Stable *(since 0.6.0)*

The wallpaper-icon rail. Same `setBadge` shape as `dock` / `sideDock`, plus two read helpers:

```ts
interface IconsApi {
    setBadge:   ( iconId: string, count: number ) => void;
    clearBadge: ( iconId: string ) => void;
    getBadge:   ( iconId: string ) => number;
}
```

```js
wp.desktop.icons.setBadge(   'desktop-mode-messages', 5 );
wp.desktop.icons.clearBadge( 'desktop-mode-messages' );
wp.desktop.icons.getBadge(   'desktop-mode-messages' ); // → 0
```

See [`setBadge`](#setbadge--stable-since-060) above for the full rules across all three rails.

#### `DesktopIconServerEntry.pinned` — Stable *(since 0.8.0)*

Server-declared icons (registered via `desktop_mode_register_icon( $id, [ 'pinned' => true ] )`) ship a boolean `pinned` flag in `config.desktopIcons[ n ].pinned`. Pinned icons render before any unpinned icon regardless of `position`, and the framework treats them as a stable system surface — built-in shortcuts like the **My WordPress** folder use it. Plugins that decorate icons (drag handles, custom menus) should opt out for tiles where `pinned === true`.

---

### `saveSession` — Stable
A debounced function that schedules a session write. The shell calls it automatically for window lifecycle and virtual-desktop lifecycle changes; call it after mutating session-backed state from your own code.

```javascript
window.wp.desktop.windowManager.focus( someWindow );
window.wp.desktop.saveSession();
```

---

### `presence` — Stable *(since 0.5.5)*

Framework-level presence tracking — who's currently in the desktop-mode WP-Admin and what their state is. Always available, regardless of which feature plugins (chat, collaboration, …) happen to be installed. Useful for any UI that wants to surface who's around: avatar dots, "online now" lists, collaborative cursors, real-time co-editing indicators, etc.

The probe boots automatically on `desktop-mode-init` and piggy-backs the WordPress Heartbeat — every tick (~15 s default in admin) the client sends `desktop_mode_presence_active: true` plus `desktop_mode_user_active: <bool>` (true when the user moused / typed within the last 5 minutes), and the server responds with the visible-users snapshot.

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
| `online`   | Heartbeat within `desktop_mode_presence_offline_after` AND user input within `desktop_mode_presence_inactive_after`. |
| `inactive` | Heartbeat present, but no input within `desktop_mode_presence_inactive_after` (default 5 min). |
| `offline`  | No heartbeat in `desktop_mode_presence_offline_after` (default 2 min).                        |

**Visibility:**

The server-side `desktop_mode_presence_visible_users` filter gates which users surface to a given viewer. By default everyone tracked is visible to everyone tracked; plugins can narrow (e.g. "subscribers only see other subscribers") without the client knowing.

**Companion CustomEvent:** [`desktop-mode-presence-changed`](#desktop-mode-presence-changed--stable-since-055) fires once per status transition per user, with a `null` oldStatus on first sighting.

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
    setState( patch: Partial< T > ): void;          // patch + notify in one call (since 0.8.1;
                                                    // object-shaped state only — warns and
                                                    // no-ops on primitive-shaped stores)
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
    opened?:            () => void;
    reopened?:          ( e: { baseId, wasMinimized, navigated } ) => void;
    focused?:           () => void;
    blurred?:           ( e: { focusedTo } ) => void;
    closing?:           ( e: { element } ) => void;
    closed?:            () => void;
    minimized?:         () => void;
    restored?:          () => void;
    maximized?:         () => void;
    unmaximized?:       () => void;
    fullscreenEntered?: () => void;
    fullscreenExited?:  () => void;
    resized?:           ( e: { width, height } ) => void;
    bodyResized?:       ( e: { width, height } ) => void;
    boundsChanged?:     ( e: { x, y, width, height } ) => void;
}
```

Payloads match the corresponding hook payloads minus `windowId` — it is implied by the `id` argument and stripped before your handler runs.

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
2. **A predictable hook prefix** (`desktop-mode.activity.<channel>`) so devtools can list activity traffic as a discrete group.
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
| `desktop-mode/toast-requested` | Pre-show — `showToast()` calls run through this. | `{ message, action?, duration?, persistent?, source?, meta?, cancel? }` | **Yes.** Set `cancel: true` to drop the toast. Mutate `message`/`duration`/`action`/`persistent` to rewrite. |
| `desktop-mode/toast-shown` | Fire-and-forget — fires after the toast lands in the DOM. | Same shape as above. | No (filtering is too late). |
| `desktop-mode/window-attention-requested` | Pre-attention — `Window.requestAttention()` runs through this filter, then routes the filtered result to the rails' `setAttention()`; direct `dock.setAttention()` / `taskbar.setAttention()` calls bypass it. | `{ windowId, mode, durationMs?, intensity?, source?, cancel? }` | **Yes.** Set `cancel: true` for DND. Mutate `mode`/`durationMs`/`intensity` to scale the animation. |
| `desktop-mode/badge-changed` | Fire-and-forget — every `setBadge()` on dock / taskbar / icons mirrors here on every change. | `{ itemId, count, rail?: 'dock' \| 'taskbar' \| 'icon' }` *(rail since 0.6.0)* | No. |
| `desktop-mode/open-requested` | Fire-and-forget — `wp.desktop.openWindow()` publishes here BEFORE deciding `opened` vs `reopened`. | `{ windowId, source }` | No. |
| `desktop-mode/presence-changed` | Per-transition mirror of the `desktop-mode-presence-changed` CustomEvent. | `{ userId, oldStatus, newStatus, lastSeenMs, lastActiveMs }` | No. |
| `desktop-mode/presence-snapshot-applied` | Batch-level — fires after every presence snapshot OR `applyPresenceBatch()`. | `{ applied: number, transitions: number }` | No. |

**Plugin channels** — pick a `<plugin>/<event>` slug and publish. Augment `ActivityChannelMap` for compile-time payload checking:

```ts
declare module 'desktop-mode/activity' {
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

**Comments window channels (since 0.8.3)** — the native Comments window publishes on:

- `desktop-mode-comments/approved` — `{ ids: number[]; counts: CommentCounts }`
- `desktop-mode-comments/unapproved` — same payload shape
- `desktop-mode-comments/spamd` / `desktop-mode-comments/unspamd` — same
- `desktop-mode-comments/trashd` / `desktop-mode-comments/untrashd` — same
- `desktop-mode-comments/replied` — `{ parentId: number; postId: number }`
- `desktop-mode-comments/edited` — `{ id: number }`
- `desktop-mode-comments/insights-opened` — `{ email: string }`

Subscribe to drive plugin badges, audit logs, or to refresh widgets that surface pending counts.

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

**Built-in consumer.** `presence` contributes `desktop_mode_presence_active` + `desktop_mode_user_active` and subscribes to `desktop_mode_presence`. Read [`src/presence/index.ts`](../src/presence/index.ts) for the canonical pattern.

---

### `wp.desktop.wallpaper` — suspend / resume — Experimental *(since 0.9.6)*

Pause the animated wallpaper while a foreground surface (a game, a heavy canvas tool) renders its own scene, without tearing the wallpaper down.

```typescript
interface WallpaperSuspendApi {
    suspend( reason: string ): void;   // hold a reason (refcounted)
    resume( reason: string ): void;    // release one hold on the reason
    isSuspended(): boolean;            // any reason currently held?
}
```

Refcounted per reason string: two `suspend( 'my-plugin/thing' )` calls need two `resume( 'my-plugin/thing' )` calls; distinct reasons stack independently. On the first held reason the shell freezes the current frame into a bitmap overlay (best-effort — WebGL capture can fail on some drivers, in which case the stopped canvas simply keeps its last frame) and re-emits **`desktop-mode.wallpaper.visibility`** with the *effective* state (`document.hidden || suspended`), so every wallpaper that wires the standard visibility action pauses its ticker with zero changes. A tab re-focus while suspended keeps reporting `hidden` — suspension wins. The scene is never destroyed.

The precise signal is the companion action **`desktop-mode.wallpaper.suspend`** *(Experimental, since 0.9.6)*, fired on every suspended/resumed transition with `{ id, suspended, reasons }` (`id` = active canvas wallpaper id or `null`; `reasons` = currently held reason strings). Wallpapers that want to distinguish "tab hidden" from "game running" subscribe to it via `wp.desktop.hooks`.

The games framework calls `suspend( 'game:<windowId>' )` / `resume(…)` around every game window automatically.

---

### `wp.desktop.games` — Experimental *(since 0.9.6)*

The desktop games surface: a shared registry (the hub's game grid + per-game detail panel repaint live), and a launcher that opens games in native windows.

```typescript
interface GamesApi {
    register( entry: GameRegistryEntry ): void;
    unregister( id: string ): void;
    list(): GameRegistryEntry[];              // `desktop-mode.games` filter applied
    get( id: string ): GameRegistryEntry | undefined;
    subscribe( cb: () => void ): () => void;  // registry-change listener
    launch( id: string, opts?: { challenge?: GameChallengeContext } ): Promise< void >;
    getPlaytime(): Promise< Record< string, number > >;  // my `game id => total seconds`
}
```

**Registration model.** The canonical path is PHP: `desktop_mode_register_game( $id, $args )` declares the discovery metadata (title, icon, description, `score_columns`, `config`) plus a `script` handle. The shell registers a metadata **stub** at boot — enough to paint the hub tile and the game's scoreboard — and `launch()` loads the script lazily on first play. The loaded script publishes the full def on the global:

```javascript
// Inside the game bundle (window.desktopModeGames is the games
// analogue of window.desktopModeWallpapers):
window.desktopModeGames = window.desktopModeGames || {};
window.desktopModeGames[ 'my-plugin-puzzle' ] = {
    id:           'my-plugin-puzzle',
    title:        'Puzzle',
    icon:         'dashicons-screenoptions',
    scoreColumns: [ { key: 'score', label: 'Score', type: 'number' } ],
    window:       { width: 800, height: 600 },   // hosting-window sizing
    render( ctx ) {                              // runs once per window open
        // ctx: { windowId, container, config, challenge?, submitScore, close }
        return () => { /* teardown — runs on every close path */ };
    },
};
```

`render` receives a `GameLaunchContext`: `container` (the window body), `config` (the PHP-registered blob), `challenge` (set when the run is an accepted score-to-beat challenge: `{ id, scoreToBeat, scoreMeta, challengerName }`), `submitScore( { score, meta } )` (routes to the leaderboard, or to the challenge-completion endpoint in challenge mode), and `close()`. The framework suspends the wallpaper for the window's lifetime and opens the window as `desktop-mode-game-<id>` (no dock tile).

**Framework config keys** *(since 0.9.8)*. For server-registered games, the payload merges framework-level keys underneath the game's own `config` (the game's keys win): **`config.wordsUrl`** is the URL of the shared ~20k-word dictionary asset (`assets/games/words.txt`) — identical for every player, so seeded games (Alphabet Soup's date-seeded daily puzzle) generate the same grid worldwide. Parse it with the framework loader (`src/games/dictionary.ts` — `loadDictionary( url )` → `{ size, pick( minLen, maxLen, rng ) }`); the PHP-side URL + filter is `desktop_mode_games_words_url` in [hooks-reference.md](./hooks-reference.md).

**Share cards** *(since 0.9.8)*. `src/games/share-card.ts` renders a finished run as a 1200×630 PNG on a plain canvas (`renderShareCard( canvas, data )`) and `shareScoreCard( canvas, filename, title )` runs the one-tap chain: native share sheet with the file attached → clipboard image → download, reporting which path ran. Deliberately image-only — no URL, no caption. Alphabet Soup's game-over panel is the reference integration.

JS-only registrations (passing `render` directly to `register()`) work for the launcher, but scores/challenges only persist for games also registered server-side — the REST routes 404 unknown ids.

The registry mirrors onto the **`desktop-mode.games`** JS filter (constant `HOOKS.GAMES`), applied on every `list()` read.

**Play time** *(since 0.9.7)*. The launcher automatically tracks how long each game window is in front of the player — the clock pauses while the window is minimized — and flushes whole-second increments to `POST /desktop-mode/v1/games/{game}/playtime` (silently, roughly once a minute plus once on close). Totals are per user per game and accumulate for life across sessions and days; increments are also bucketed per site-timezone day (rolling window, default 30 days). `getPlaytime()` returns the current user's lifetime map; the full `GET /desktop-mode/v1/games/playtime` response is `{ playtime: { <game>: seconds }, daily: { <game>: { 'YYYY-MM-DD': seconds } }, today: 'YYYY-MM-DD' }`. The hub's detail panel renders a Steam-style strip from it — "Play time (last two weeks)" + "Play time (total)". Games don't need to do anything to participate. Server-side see `desktop_mode_games_get_playtime()` / `desktop_mode_games_get_playtime_daily()` and the `desktop_mode_game_playtime_recorded` action in [hooks-reference.md](./hooks-reference.md).

**Heartbeat channel.** Challenges deliver live over the shared bus: the shell contributes `desktop_mode_games_subscribe: { challengesVersion: <lastSeenUpdatedAtMs> }` on every tick and the server answers with `desktop_mode_games: { challenges: GameChallengeRow[], serverTimeMs, truncated }` — version-gated (quiet ticks carry nothing) and capped via the `desktop_mode_games_heartbeat_max_rows` PHP filter. Recipients of a fresh challenge get a browser notification (toast fallback) + a persistent **Accept & Play** toast; challengers are notified when their challenge completes.

**Config global.** The Games hub bundle reads `window.desktopModeGamesConfig` (`restNonce`, `gamesUrlBase`, `challengesUrl`, `usersSearchUrl`), localized onto the `desktop-mode-games` handle.

---

### `broadcast` / `subscribe` — Stable *(since 0.6.0)*

Cross-window pub/sub. Fan-out fan-in primitive — any module can publish on a topic and every subscriber (in the parent shell, in any open iframe) receives the payload. Distinct from `wp.desktop.activity` in two ways: it crosses iframe boundaries, and it has no `<plugin>/<event>` typing — topics are free-form strings.

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

**Mirror onto activity** *(since 0.5.5)* — every `broadcast()` *also* publishes on the activity bus under the same topic name (so long as it matches the `<plugin>/<event>` shape), so in-tab subscribers can use the unified `activity.subscribe` surface without knowing whether the producer ran broadcast vs activity. Cross-iframe fan-out stays the broadcast bus's job.

---

### `showToast( opts )` — Stable *(since 0.6.0)*

Show a top-of-shell toast. Returns a dismiss callback the caller can invoke early — useful when the state the toast was reporting changes (e.g. dismiss "X arrived" toasts the moment the related window mounts).

```typescript
wp.desktop.showToast( {
    message: string;
    duration?: number;                                     // ms; default 4000. Ignored when persistent.
    action?: { label: string; onClick: () => void };       // optional CTA
    persistent?: boolean;                                  // since 0.9.4 — never auto-dismiss
    dismissible?: boolean;                                 // since 0.9.4 — show a close (×) button
    onDismiss?: () => void;                                // since 0.9.4 — called when × is clicked
} ): () => void;
```

```javascript
// Transient (default) — auto-dismisses after `duration`.
const dismiss = wp.desktop.showToast( {
    message: 'Saved',
    duration: 3000,
    action: { label: 'Undo', onClick: () => undo() },
} );

// Persistent — never auto-dismisses; stays until the user acts on it
// or a caller invokes the returned dismiss fn. This is how the shell
// surfaces a pending WordPress core update (once, instead of the
// per-window nag). Add `dismissible` for a close (×) button, and
// `onDismiss` to persist the fact it was closed.
const clear = wp.desktop.showToast( {
    message: 'WordPress 7.0.2 is available.',
    persistent: true,
    dismissible: true,
    onDismiss: () => rememberDismissed(),
    action: { label: 'Update now', onClick: () => openUpdateScreen() },
} );
```

A `persistent` toast has no auto-dismiss timer — clear it via the action button (which dismisses on click), the close (×) button when `dismissible` is set, or the returned dismiss callback. `duration` is ignored when `persistent` is set.

Routes through the `desktop-mode/toast-requested` activity filter before painting; plugins can register a filter that returns `null` (or sets `cancel: true`) to suppress, or mutates the payload to amplify / quiet the toast.

---

### `repaintLoadingOverlays()` — Stable *(since 0.6.0)*

Re-paint every currently-loading window's spinner overlay through the customization pipeline (per-window `config.loading.render` + `WINDOW_LOADING_OVERLAY` filter).

**You almost never need this.** Filters registered inside `wp.desktop.whenReady( … )` are picked up automatically by the shell's post-`HOOKS.INIT` sweep, including for F5 / session-restored windows that were constructed before the plugin script ran. The canonical plugin shape:

```js
wp.desktop.whenReady( () => {
    wp.desktop.hooks.addFilter(
        'desktop-mode.window.loading-overlay',
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
        'desktop-mode.window.loading-overlay',
        'my-skin/lazy-branded',
        brandRenderer,
    );
    wp.desktop.repaintLoadingOverlays();
}
```

Idempotent + cheap — windows that already finished loading are unaffected.

---

### `renderKeyedList( host, items, opts )` / `clearKeyedList( host )` — Stable *(since 0.6.0)*

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

### `registerNamespace( name, api )` — Stable *(since 0.6.0)*

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
| `slug` | `string` | yes | Must match `/^[a-z0-9_/-]+$/` (lowercase alphanum, hyphens, underscores; optional `vendor/sub-id` slash form so two plugins can ship a `convert` command without colliding) |
| `label` | `string` | yes | Human-readable name shown in the palette |
| `description` | `string` | no | One-line description under the label |
| `hint` | `string` | no | Argument hint, e.g. `"[post id]"` |
| `icon` | `string` | no | Dashicons class, default `dashicons-arrow-right-alt` |
| `iconSvg` | `string` | no | *Since 0.5.1.* Raw `<svg>…</svg>` markup rendered inline; takes precedence over `icon`. Used internally by the iframe-command bridge to forward `@wordpress/icons` elements; plugins may set it when shipping a one-off glyph is easier than enqueueing a dashicon. |
| `eager` | `boolean` | no | *Since 0.5.1.* When `true`, the command appears on the empty-input palette without the user typing `/`. When falsy (default), it only surfaces after `/`. Eager and slash-only surfaces are **disjoint** — typing `/` hides eager commands. Use `eager: true` for contextual / always-relevant actions (block editor shortcuts, site-wide toggles); leave it off for utility commands the user deliberately invokes. |
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
- `ctx.confirm( message, details? ) → Promise<boolean>` *(since 0.5.0)* — ask the user to confirm a destructive action. Default implementation renders the framework's `<wpd-confirm-dialog>` (same surface as `wp.desktop.confirm`); the `Promise<boolean>` contract is stable. Use this from any command whose `run()` does something irreversible.

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

**Command lifecycle hooks** *(since 0.5.0)* — fire around every `run()`. Subscribe via `wp.hooks`:

| Hook | Type | Payload | Use |
|---|---|---|---|
| `desktop-mode.command.before-run` | filter | `{ proceed: true, slug, args, command }` → return same shape with `proceed: false` (and optional `reason`) to cancel | Capability gates, audit log, "developer mode only" commands |
| `desktop-mode.command.after-run` | action | `{ slug, args, command, result }` | Telemetry, post-run toast |
| `desktop-mode.command.error` | action | `{ slug, args, command, error }` | Centralised error reporting |

```javascript
// Block /close_all_windows for non-admin users.
wp.hooks.addFilter(
    'desktop-mode.command.before-run',
    'my-plugin/gate',
    ( gate ) => {
        if ( gate.slug === 'close_all_windows' && ! desktopModeConfig.currentUserIsAdmin ) {
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
            headers: { 'X-WP-Nonce': desktopModeConfig.restNonce },
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

### `registerDestructiveAdminAction( entry )` — Stable  *(since 0.8.4)*

Mark a wp-admin URL pattern as a **destructive (redirect-back) action** so a click on that URL navigates the *source* iframe in place instead of opening a new window. The same UX vanilla wp-admin gives for Trash / Untrash / Delete row actions — the row disappears, the list refreshes with an "Undo" notice on the same screen.

Built-ins are pinned with no opt-in: Core's `trash`, `untrash`, `delete` on posts plus the comment-moderation set (`spam`, `unspam`, `spamcomment`, `unspamcomment`, `trashcomment`, `untrashcomment`, `deletecomment`, `approvecomment`, `unapprovecomment`). Register a predicate for any plugin-specific equivalent.

```javascript
const unregister = window.wp.desktop.registerDestructiveAdminAction( {
    id: 'woocommerce/trash-order',
    matches: ( _url, parsed ) =>
        parsed.pathname.endsWith( '/admin.php' ) &&
        parsed.searchParams.get( 'page' ) === 'wc-orders' &&
        parsed.searchParams.get( 'action' ) === 'trash' &&
        parsed.searchParams.has( '_wpnonce' ),
} );
```

**Entry shape:**

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | Globally-unique, recommended `<plugin>/<action-slug>`. Re-registering the same id replaces the prior entry. |
| `matches` | `( url: string, parsed: URL ) => boolean` | Predicate. Receives the raw URL string + a parsed URL object (the dispatcher parses once and shares). Return `true` to claim the URL. Predicates SHOULD also check for nonce presence — a URL with the action name but no nonce won't perform a side-effect on the server, and the in-place reload would be wasted. |

**Returns:** an unregister function. Calling it removes the entry by id. `unregisterDestructiveAdminAction( id )` does the same.

**When not to register:**
- Built-ins are already covered — no need for `trash` / `untrash` / `delete` on Core post types.
- Actions that genuinely *navigate* to a different screen (Edit, Settings deep links) should NOT be marked destructive — let them open a new window.
- Bulk-action POSTs handled via `<form>` submission are out of scope (forms don't go through this dispatcher).

**Cross-bundle:** the registry routes through `wp.desktop.createSharedStore`. A `register…` call from a plugin's own Vite IIFE is visible to the dispatcher (which runs inside the shell's `window-system` bundle). See `AGENTS.md` § "Cross-bundle state".

---

### `unregisterDestructiveAdminAction( id )` — Stable  *(since 0.8.4)*

Remove a previously registered predicate. Idempotent — no-op when the id is unknown.

```javascript
window.wp.desktop.unregisterDestructiveAdminAction( 'woocommerce/trash-order' );
```

---

### `listDestructiveAdminActions()` — Stable  *(since 0.8.4)*

Snapshot (defensive copy) of every plugin-registered destructive-admin-action predicate. Built-in Core whitelist entries are NOT included — they're not registry entries.

```javascript
window.wp.desktop.listDestructiveAdminActions().forEach( ( e ) => console.log( e.id ) );
```

---

### `wp.desktop.ai.ask( query, opts? )` — Experimental  *(since 0.5.1)*

Programmatic access to the AI Copilot — same endpoint the built-in overlay talks to. Resolves to an `AskResult`; rejects on network errors, HTTP failures, or abort.

The built-in content tools (`search_posts`, `search_pages`, `search_comments`, `search_comments_by_post`) run WordPress's native keyword search — the model derives a `query` from the user's request and the tools return matching titles + excerpts. (Posts, pages, and terms are no longer pre-analyzed; comment spam scoring is the only automatic AI analysis.) When you continue an exhausted search with `resumeTool` / `startOffset`, the original query is reused automatically.

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
2. For server-side tools, register a read-only [WordPress Ability](https://developer.wordpress.org/apis/abilities-api/) with `wp_register_ability()` — the assistant picks up every read-only ability automatically. Its `permission_callback` gates execution and input/output are schema-validated by Core.
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

### `registerTitleBarButton( def )` — Experimental  *(since 0.5.2)*

Add a custom button to the title bar of any matching window. The right surface for cross-window verbs ("connect to", "live preview", "broadcast"). Predicate decides which windows show the button; you can render an `<wpd-window-button>` with a click handler, or own the host entirely with a custom `render`.

**Returns** nothing on success. **Throws** a `RegistrationError` on validation failure — the error message names the bad fields, so wrap the call in `try`/`catch` if you need to branch or route it through your own monitor pipeline.

**`TitleBarButtonDef`:**

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | Unique. `[a-z0-9_/-]+` — same `vendor/sub-id` shape that `desktop_mode_register_window` / `desktop_mode_register_widget` accept (slashes welcome). Wider than `registerSettingsTab`'s id, which can't use slashes (that value is also used in CSS selectors). Re-registering replaces. |
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

### `unregisterTitleBarButton( id )` / `listTitleBarButtons()` — Experimental

Remove a title-bar button by id, or read a snapshot of every registered button def (sorted by `order`). Unregistering is idempotent — unknown ids are silent no-ops — and every open window's title bar repaints to drop the button. Buttons registered with an `owner` are also auto-unregistered when the owning plugin deactivates.

---

### `registerUnfocusEffect( def )` — Experimental  *(since 0.9.1)*

Register a visual treatment applied to every window that **isn't** focused — surfaced in **OS Settings → Effects → "Unfocused windows"**. The built-in effects (`darken` dims, `frost` blurs to frosted glass, `grayscale` drains colour) are registered through this same hook; plugins add their own the identical way. The framework owns *when* the effect runs (focus changes, the user's selection, minimized-window exclusion); your def owns *what* it does.

**Throws** a `RegistrationError` on validation failure (bad/missing `id`, the reserved id `'none'`, or neither `className` nor `apply` provided).

**`UnfocusEffectDef`:**

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | Unique. `[a-z0-9_/-]+` (slashes welcome for `vendor/sub-id`). `'none'` is reserved (it is the selector's "no effect" sentinel). Re-registering replaces. |
| `label` | `string` | Shown in the selector. |
| `description` | `string` | Optional. Shown under the selector when this effect is active. |
| `className` | `string` | Optional. CSS class toggled on the window root (`.desktop-mode-window`) while unfocused. The cheap, declarative path — ship the matching rule in your stylesheet. |
| `apply` | `( el ) => void` | Optional. Imperative apply, called with the window root when it becomes unfocused under this effect. Use when a static class isn't enough. |
| `clear` | `( el ) => void` | Optional. Teardown, called when the window regains focus or the effect is switched away. Must undo `apply`; the framework removes `className` for you. |
| `owner` | `string` | Optional. Set to your script handle for live-unregister-on-deactivate. |

At least one of `className` / `apply` is required.

> **Windows hosting a WebGL `<canvas>` are exempt.** Native Pixi scenes (content graph, posts mind-map / tag-cloud, the About scene) render a live WebGL canvas in the parent DOM; a CSS `filter` over such an element can trigger a GPU context loss that crashes the canvas's render loop. The engine detects a `<canvas>` in the window root and skips the effect for that window. Canvases inside *iframe* windows live in a separate document and aren't affected.

```javascript
wp.desktop.ready( () => {
    wp.desktop.registerUnfocusEffect( {
        id:        'acme/blur',
        label:     'Blur',
        className: 'acme-window--blur', // ship `.acme-window--blur { filter: blur(2px); }`
        owner:     'my-plugin-effects',
    } );
} );
```

PHP companion (so plugins activated mid-session surface in the selector live):

```php
desktop_mode_register_unfocus_effect_script( 'my-plugin-effects' );
```

The raw `desktop-mode.unfocus-effects` JS filter receives the registry array on every read, mirroring `desktop-mode.wallpapers` — use it to reorder, remove, or conditionally swap effects. The user's selection persists in the `unfocusEffect` OS-settings key (effect id or `'none'`; default `'darken'`), readable via `getOsSettings().unfocusEffect`.

### `unregisterUnfocusEffect( id )` / `listUnfocusEffects()` — Experimental  *(since 0.9.1)*

Remove an effect by id, or read the current list (post-filter). `listUnfocusEffects()` always includes the built-ins (`darken`, `frost`, `grayscale`) unless a filter removed them.

---

### `wp.desktop.relations` — Experimental  *(since 0.9.4)*

Window content relations: which piece of content each window shows, and how windows group around a shared **root** (a post edit window is the root; its comment / media windows are children). The shell draws visual ties between group members — see [`registerWindowLinkRenderer`](#registerwindowlinkrenderer-def--experimental-since-094) for the pluggable rendering and [`docs/examples/window-links.md`](./examples/window-links.md) for recipes.

**`WindowContentRef`** — the per-window identity record:

| Field | Type | Notes |
|---|---|---|
| `type` | `string` | Object type: any post type slug, `comment`, `media`, or your namespaced `vendor/order`. Must match `/^[a-z0-9_/-]+$/`. |
| `id` | `number \| string` | Object id. |
| `root` | `{ type, id }` | Optional. The root object this window's content belongs to. Omit when this window IS the root. |
| `links` | `Array<{ type, id, rel? }>` | Optional. Outbound references from this content to OTHER objects (the bridge fills these for post editors automatically, capped at 32). `rel: 'references'` (default) draws the tie FROM this window TO the target ("my content points at that" — hyperlinks, terms); `rel: 'child'` reverses it ("that belongs to ME" — a post's embedded/featured media) and renders as a `child-root` edge, identical to a `root` tie. Links never re-root anything. |
| `label` | `string` | Optional human label for renderers/tooltips. |
| `related` | `RelatedEntityItem[]` | Optional *(since 0.9.6)*. Ready-to-open navigation targets related to this content — what the title bar's **"Related" button** lists (see below). Built server-side for posts/pages and capped at 64; never affects group membership or edges. |
| `source` | `'config' \| 'bridge' \| 'api'` | Stamped by the engine — never set it yourself. |

**API:**

| Method | Returns | Notes |
|---|---|---|
| `get( windowId )` | `WindowContentRef \| undefined` | Current identity of a window. |
| `set( windowId, ref \| null )` | `void` | Set or clear an identity. Throws a `RegistrationError` on a malformed ref. The `desktop-mode.window-links.content` JS filter runs on every set. |
| `groups()` | `WindowLinkGroup[]` | Every relation group: `{ key, root, rootWindowIds, children }`. `rootWindowIds` is focus-recency ordered and may be empty (children open, root closed). The `desktop-mode.window-links.groups` filter applies on every read. |
| `edges()` | `WindowLinkEdge[]` | The derived directed ties between open windows — `{ fromWindowId, toWindowId, kind: 'child-root' \| 'reference', bidirectional }`. `child-root` points a child at its root ("belongs to" — the built-in renderer puts its larger endpoint dot there); `reference` points at a window showing something this content `links` to; mutual references merge into ONE edge with `bidirectional: true` (large dots at both ends). The `desktop-mode.window-links.edges` filter applies on every read. This is what the render host feeds to the active renderer. |
| `groupOf( windowId )` | `WindowLinkGroup \| undefined` | The group a window belongs to. |
| `related( windowId )` | `string[]` | The other window ids tied to this one — same-group members plus reference-edge endpoints. |
| `subscribe( cb )` | `() => void` | Fires on identity/membership changes; returns an unsubscribe. |

**How identities arrive** (any of the three):

1. **Automatically** — the chromeless bridge announces the identity of every admin iframe page ([`desktop-mode-content-identity`](./bridge-protocol.md)), resolved server-side in real admin context: post/page/CPT editors are roots; comment-edit and attached-media screens arrive pre-rooted at their parent post. PHP plugins extend this via the `desktop_mode_window_content_identity` filter (see [hooks-reference](./hooks-reference.md)).
2. **At open time** — `WindowConfig.content?: WindowContentRef` seeds the identity the moment a window opens (native windows, session restores).
3. **Programmatically** — `wp.desktop.relations.set( windowId, ref )`.

```javascript
wp.desktop.relations.set( myWindowId, {
    type: 'acme/order',
    id: 77,
    root: { type: 'acme/customer', id: 12 },
    label: 'Order #77',
} );
wp.desktop.relations.related( myWindowId ); // → sibling window ids
```

**Events** — both dispatched as document CustomEvents and on the hook bus:

| CustomEvent | Hook | Detail |
|---|---|---|
| `desktop-mode-window-content-changed` | `desktop-mode.window-links.content-changed` | `{ windowId, content, previous, source }` |
| `desktop-mode-window-link-groups-changed` | `desktop-mode.window-links.groups-changed` | `{ groups }` — fires on MEMBERSHIP change only, never on move/resize or focus reorder. |

**JS filters:** `desktop-mode.window-links.content` (`( ref, { windowId, source } ) => ref | null` — rewrite or suppress an identity as it's set), `desktop-mode.window-links.groups` (reshape the computed group list on read), `desktop-mode.window-links.edges` (reshape the derived directed-edge list on read — add, drop, or redirect ties), `desktop-mode.window-links.renderers` (the renderer registry list), `desktop-mode.window-links.renderer` (`( id ) => id` — force-swap the active renderer without touching the user's setting).

### The "Related" title-bar button — Experimental  *(since 0.9.6)*

Any window whose content identity carries `related` items shows a **Related** button (network icon, right side of the title bar, registered through the public `registerTitleBarButton` surface as `desktop-mode/related-entities`). Clicking it opens a dropdown grouped by `item.group` — built-in groups render first (`comments`, then `terms/*`, then `media`), vendor groups after in arrival order, each headed by its `groupLabel` — and picking an item opens `item.url` as its own desktop window. Native URL remaps are deliberately **not** consulted: the menu exists for filtered deep links (`edit-comments.php?p={id}`), which a native window opened by id would drop — so the classic filtered screen always opens, even when a native replacement is enabled. The button appears/disappears live as the identity changes (iframe navigation re-announces it) and hides whenever the resolved list is empty.

**`RelatedEntityItem`:**

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | Unique in the list, e.g. `'comments'`, `'term-category-7'`, `'media-42'`; namespace yours `vendor/sub-id`. |
| `group` | `string` | Menu section key. Built-ins: `'comments'`, `'terms/{taxonomy}'`, `'media'`. |
| `groupLabel` | `string` | Optional translated section header. |
| `label` | `string` | Translated item label. |
| `icon` | `string` | Optional Dashicons class (also used as the opened window's icon). |
| `url` | `string` | Admin URL the item opens. |
| `count` | `number` | Optional count suffix — renders as `Comments (4)`. |

**Where items come from:** the server builds them for posts/pages during the admin page render (comments with count, assigned terms, associated media) and any screen can contribute via the `desktop_mode_window_related_entities` PHP filter (see [hooks-reference](./hooks-reference.md)). Client-side, the resolved list runs through the **`desktop-mode.related-entities.items` JS filter** on every visibility check and menu build:

```javascript
// ( items, { windowId, content } ) => items
wp.hooks.addFilter(
    'desktop-mode.related-entities.items',
    'my-plugin/audit-trail',
    ( items, { content } ) => {
        if ( content?.type === 'post' ) {
            items.push( {
                id: 'my-plugin/audit',
                group: 'my-plugin/audit',
                groupLabel: 'Audit',
                label: 'Audit trail',
                icon: 'dashicons-backup',
                url: `${ myPlugin.adminUrl }admin.php?page=my-plugin-audit&post=${ content.id }`,
            } );
        }
        return items;
    },
);
```

Malformed entries are dropped item-wise; a non-array return falls back to the identity's own list. Read a window's current items via `wp.desktop.relations.get( windowId )?.related`. Recipes: [`docs/examples/related-entities.md`](./examples/related-entities.md).

### `registerWindowLinkRenderer( def )` — Experimental  *(since 0.9.4)*

Register (or replace) a **window-link renderer** — how the relation ties between related windows are drawn. The built-in `svg-splines` (curved connectors terminated by circular dots on a `pointer-events: none` layer *behind* the windows: the larger dot marks a child's root, both ends large for mutual references — circles are rotation-invariant, so ties look right at any approach angle) registers through this same hook. The user picks the active renderer in **OS Settings → Effects → Window links**; only one renderer is mounted at a time.

**`WindowLinkRendererDef`:**

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | Unique, `/^[a-z0-9_/-]+$/`; namespace yours `vendor/sub-id`. `none` is reserved. |
| `label` | `string` | Shown in the OS Settings selector. |
| `description` | `string` | Optional, shown under the selector. |
| `mount` | `( ctx ) => teardown` | Mount into the link layer; return (or resolve to) a teardown. |
| `owner` | `string` | Optional script handle for live unregistration on plugin deactivation. |

**`WindowLinkRendererContext`** (the `ctx` handed to `mount`): `container` (the BASE link layer — always behind every window; you own its children), `elevatedContainer` (a sibling layer the host lifts to the focused group's z-ceiling — draw an edge here when `edge.elevated` is true so the focused window's ties ride above other windows; ignore it entirely for the old everything-behind-windows behavior), `getFrame()` (pull the current `WindowLinkFrame` snapshot), `onFrame( cb )` (push subscription — fires rAF-coalesced during window drag/resize and on group-structure changes; returns an unsubscribe).

**`WindowLinkFrame`**: `{ groups, edges, obstacles, container: { width, height } }`. **`edges` is what renderers should iterate** — `[ { fromWindowId, toWindowId, kind, bidirectional, focused, elevated, from, to, fromZIndex, toZIndex } ]` with direction and mutual-merging already resolved (`elevated` marks edges touching the focused window — route those to `ctx.elevatedContainer`); `from`/`to` are `{ x, y, width, height }` rects relative to the layer, `null` when that endpoint is minimized / snapped into split view (`snapped-left` / `snapped-right` — a half-screen tile draws no ties; they reappear the moment the window is dragged back out) / on another virtual desktop (skip the edge). `obstacles` (`[ { windowId, rect, zIndex } ]`) lists EVERY visible window on the desk for occlusion-aware anchoring. The built-in renderer anchors each endpoint by preference: (1) the **shortest edge-to-edge connection** between the two windows (side-by-side windows connect straight across the gap at the overlap midpoint, offset windows via their facing corners) when that point is visible; (2) the classic center-ray border anchor while visible; (3) the midpoint of the closest visible border stretch when a higher window covers both — so a tie never appears to sprout from a window that is hiding its real endpoint. The pure helpers (`closestBorderAnchors`, `visibleBorderAnchor`, `isPointVisible`, `anchorOnBorder`, `controlPoint`) are exported from `src/window-links/geometry.ts` for custom renderers. `groups` (`[ { key, root, members: [ { windowId, role, content, rect, focused, state } ] } ]`) remains available for renderers that want group-level visuals (hulls, badges).

The dual pull/push contract makes SVG/DOM **and** canvas/Pixi renderers first-class: DOM renderers redraw in `onFrame`; a Pixi renderer appends its canvas to `container`, runs its own ticker, and polls `getFrame()` (load Pixi via `wp.desktop.loadModules( [ 'pixijs' ] )`). See [`docs/examples/window-links.md`](./examples/window-links.md) for both shapes, plus the PHP `desktop_mode_register_window_link_renderer_script()` opt-in that live-loads your renderer on plugin activation.

The user's choices persist in OS-settings keys, all readable via `getOsSettings()`:

| Key | Values | Where |
|---|---|---|
| `windowLinksEnabled` | `boolean` (default `true`) — master switch; off unmounts the visuals and disables the group behaviors | Features |
| `windowLinkRaiseOnFocus` | `boolean` (default `true`) — raise directly-tied windows when a group member is focused | Features |
| `windowLinkHighlight` | `boolean` (default `true`) — outline + glow on related windows of the focused member | Features |
| `windowLinkRenderer` | renderer id or `'none'` (default `'svg-splines'`; unknown ids fall back to the built-in) | Effects |
| `windowLinkVisibility` | `'always'` (default) \| `'focus'` \| `'off'` | Effects |

Whatever the visibility setting, the link layers **hide while Overview runs** (fading out on `desktop-mode.overview.entering`, back in on `desktop-mode.overview.exited`): overview lays windows out as scaled CSS-transform thumbnails, which the offset-based frame geometry can't see, so ties would keep pointing at the pre-overview positions.

While a group member is focused (and the switches allow it), the render host stamps `desktop-mode-window--linked` on its relative windows (an accent outline plus a soft halo, themeable via `--desktop-mode-window-link-accent` / `--desktop-mode-window-link-glow`) and **raises the windows directly tied to it** via `windowManager.raise()` (a silent restack; no focus events, minimized windows stay minimized). The raise is direction-aware, following the derived edges rather than raw group membership: focusing the **root** surfaces every child and reference peer (each carries an edge to it); focusing a **child** surfaces its parent and reference peers only — its siblings share the group (and still get the highlight) but stay where they are. And the ELEVATED link layer lifts to the group's z-ceiling so the ties **touching the focused window** draw over every other window, the group's own lower members included (a root-focused group shows its lines across the children); only the top window paints above them, and since edges anchor on window borders its endpoint dots sit right on its edge. Ties between two unfocused windows stay on the base layer, behind everything — an edge never draws over a window just because that window shares a group with the focused one. Focus a window with no ties and both layers rest behind all windows.

### `unregisterWindowLinkRenderer( id )` / `listWindowLinkRenderers()` — Experimental  *(since 0.9.4)*

Remove a renderer by id, or read the current list (post-filter). `listWindowLinkRenderers()` always includes the built-in `svg-splines` unless a filter removed it.

---

### `Window.setTitle( title )` — Stable

Update a window's title bar from outside it. Useful for plugins that want to retitle a preview window as the user types ("Live Preview — My Post"), prefix with status, etc. Fires `desktop-mode.window.title-changed` with `{ windowId, title }` so other subscribers can react.

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
- An iframe window's chromeless bridge posts `desktop-mode-ready`.
- A native window's `render( body )` callback returns synchronously (next animation frame).
- A native window's `render( body )` returns a `Promise` (when the promise resolves).

Plugins only need to call these directly for **refetch** patterns or for **event-listener-driven async loads** the framework can't observe.

See also: [the `desktop-mode-window-content-loaded` CustomEvent](#desktop-mode-window-content-loaded--stable-since-060) and the [`HOOKS.WINDOW_CONTENT_LOADED`](#hookswindow_content_loaded) action.

---

### `Window.setHighlight( mode, opts? )` — Experimental  *(since 0.5.2)*

Toggle a visual ring on a window from outside it.

```javascript
const w = wp.desktop.windowManager.getById( 'edit-post' );
w.setHighlight( 'preview' );           // temporary ring (clear yourself on mouseleave)
w.setHighlight( 'persistent' );        // sticky ring
w.setHighlight( null );                // clear
w.setHighlight( 'preview', { color: '#f59e0b' } );  // override colour
```

`'preview'` and `'persistent'` are visually distinct; the shell does NOT auto-clear either — that's the caller's responsibility. CSS variable: `--wp-window-highlight-color` (default `--wp-admin-theme-color`).

Every change fires `HOOKS.WINDOW_HIGHLIGHT_CHANGED` on the hook bus *(since 0.6.0)* with `{ windowId, mode, color? }`, so onboarding / drag-bridge / guidance plugins can react without observing DOM mutations:

```js
wp.desktop.hooks.addAction(
    wp.desktop.HOOKS.WINDOW_HIGHLIGHT_CHANGED,
    'my-plugin/highlight-tracker',
    ( { windowId, mode } ) => { /* … */ },
);
```

---

### `Window.shake()` — Stable *(since 0.6.0)*

Briefly jiggle the window element horizontally — the classic MSN-Messenger nudge affordance. Lets any plugin request "look at me" attention on its own window programmatically (e.g. a chat plugin on inbound nudge, a CI plugin on a broken build).

```javascript
const w = wp.desktop.windowManager.getById( 'my-window' );
w.shake();
```

Composes with the inline `left`/`top` the window manager writes (the shake is a CSS `transform`, not a position change). Auto-clears on `animationend`. If a second shake is requested while one is mid-flight, the class is removed and re-added so the animation restarts.

**Reduced-motion fallback:** a static accent ring for the same duration. Plugins that want to mute shakes for a specific window can register a `desktop-mode.window.shake` filter that returns `false`:

```javascript
wp.hooks.addFilter(
    'desktop-mode.window.shake',
    'my-plugin/no-shake',
    ( allow, { windowId } ) => ( windowId === 'my-window' ? false : allow ),
);
```

---

### `wp.desktop.connect( windowId, opts? )` — Experimental  *(since 0.5.2)*

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

**Lifecycle reasons handed to `onClose`:** `'disconnect'`, `'window-closed'`, `'navigated'`. The `'navigated'` reason is reserved in the type union — no code path emits it yet, so today `onClose` only ever observes the first two.

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

### `wp.desktop.iframe.publish` / `subscribe` / `onConnection` — Experimental  *(since 0.5.2)*

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

`publish( topic, payload )` fans the message out to every parent-side connection currently open against this iframe. **As of 0.8.8, calls with zero open connections log a `console.warn`** — the previous silent drop was a recurring footgun for plugin authors publishing before the parent's `connect()` lands. `onConnection` callbacks are replayed for currently-open connections, so a late registration still sees who's already there.

#### `wp.desktop.iframe.windowId` / `whenWindowId()` — Stable *(since 0.8.8)*

The id of the native window the parent shell opened to host this iframe. Populated automatically once the parent issues the first connection handshake (the handshake carries `targetWindowId`); `null` until then. Removes the cross-origin-fragile `iframe.contentWindow ===` walk that parent-side plugin code used to identify iframes.

```javascript
// Inside the iframe:
const id = wp.desktop.iframe.windowId; // string | null

// Or wait for it (Promise resolves once known):
const id = await wp.desktop.iframe.whenWindowId();
wp.desktop.iframe.publish( 'sidebar-opened', { windowId: id } );
```

The id is exactly what `wp.desktop.openWindow(...)` returns parent-side and what `Window.id` exposes — a stable cross-side handle for self-identification.

**Lifecycle hooks** (parent-side, observability):

```javascript
wp.desktop.hooks.addAction( 'desktop-mode.connection.opened', 'me', ( e ) => {
    // e = { connectionId, targetWindowId, topics, connection? }
    // `connection` is the live WindowConnection (since 0.8.8) —
    // subscribe to it directly without a `getConnection` round-trip.
    // Caveat: connections to pure-native windows (no iframe) omit
    // `connection`; fall back to
    // `wp.desktop.getConnection( e.connectionId )` for those.
    e.connection?.subscribe( 'live-pings', ( payload ) => { … } );
} );
wp.desktop.hooks.addAction( 'desktop-mode.connection.closed', 'me', ( e ) => {
    // e = { connectionId, reason }
} );
wp.desktop.hooks.addAction( 'desktop-mode.connection.message', 'me', ( e ) => {
    // e = { connectionId, topic, direction: 'in' | 'out' }
    // High-volume — keep subscribers cheap.
} );
```

For connections opened by the iframe (`requestConnection`), the parent can later look up the live connection by id:

```javascript
const conn = wp.desktop.getConnection( connectionId );
if ( conn ) {
    conn.subscribe( 'topic', cb );
}
```

`wp.desktop.getConnection( id )` returns the same `WindowConnection` reference the `connect()` factory produces (or what `CONNECTION_OPENED` ships as `connection`). Returns `null` for unknown / destroyed ids.

See [`docs/examples/connect-to-window.md`](./examples/connect-to-window.md) for the full live-preview recipe.

---

### `registerSettingsTab( def )` — Stable *(since 0.5.2)*

Register a tab in the OS Settings window. The tab is appended (or sorted-in by `order`) alongside the built-in tabs — Appearance, AI Settings, Apps & Icons, Features, Effects, Components, About — and renders its body via your `render( body, ctx )` callback.

**Definition shape:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | `string` | yes | Unique. `[a-z0-9_-]+`. Re-registering with the same id replaces the previous entry. |
| `label` | `string` | yes | Tab label. |
| `capability` | `string` | no | Gates visibility. `'manage_options'` → admin-only; any other value (including omitting) → visible to everyone. |
| `order` | `number` | no | Default `100`. Built-ins: appearance=10, ai=20, apps-icons=22, features=25, effects=27, help=40 (Components is admin-only; About is pinned last with a sentinel order). |
| `owner` | `string` | no | When set, plugin deactivation live-unregisters every tab with this owner. Typically matches the WordPress script handle registered with `desktop_mode_register_settings_tab_script()`. |
| `render( body, ctx )` | `function` | yes | Receives the tabpanel body element and a ctx object (see below). Must be idempotent — the panel rebuilds on state resets. |

**`ctx` shape:**

| Field | Type | Notes |
|---|---|---|
| `isAdmin` | `boolean` | `true` when current user has `manage_options`. |
| `getOsSettings()` | `function` | Snapshot of the persisted OS Settings state — `{ wallpaper, accent, dockSize, unfocusEffect, ai: { enabled } }` plus `desktopLayout`, `dockRailRenderer`, the native-window opt-ins (`nativePostsEnabled`, `nativePostsHiddenColumns`, `nativePagesEnabled`, `nativeUsersEnabled`, `nativePluginsEnabled`, `nativeCommentsEnabled`), `developerModeEnabled`, `foldersSharingEnabled`, `itemVisibility`, `dockOrder`, and `dockPromotedPositions` — see `OsSettingsSnapshot` in `src/settings/registry.ts` for the authoritative shape. `unfocusEffect` is the active unfocused-window effect id (`'darken'` default, `'none'` disables). `ai.enabled` is the per-user AI assistant toggle (opt-in, default off; enable-able only once a provider is configured in Settings → Connectors). `developerModeEnabled` (default `false`) gates developer-facing surfaces — the Starter Widget in the add-widget picker and the OS Settings → Components tab's missing-import-warner demo — set from OS Settings → Features. **Changed in 0.9.4:** `ai.apiKey`, `ai.transport`, `ai.provider` and `ai.model` were removed — credentials live in WordPress Core's Settings → Connectors and provider + model selection is delegated to the Core AI Client. Read-only; returns a defensive copy. |
| `subscribeOsSettings( cb )` | `function` | Subscribe to in-panel OS Settings changes (user toggles a feature in the Features tab, etc.). Returns an unsubscribe function. Fires on local edits only — cross-device changes arrive on the next page load. |

```javascript
// Use `wp.desktop.ready()` (not `addAction( 'desktop-mode.init', … )`) —
// plugin settings scripts are loaded via server-sync AFTER
// `desktop-mode.init` has already fired, so a raw addAction callback
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

            // Read the current AI assistant preference (Features tab).
            const { enabled } = ctx.getOsSettings().ai;
            console.log( 'assistant on:', enabled );

            // Re-read when the user edits settings elsewhere in the
            // panel. Unsubscribe on next re-render / window close.
            const off = ctx.subscribeOsSettings( ( next ) => {
                console.log( 'settings changed — assistant on:', next.ai.enabled );
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

**Inline code — `<wpd-code>`**  *(since 0.5.2)*

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

**Ordered steps — `<wpd-steps>` + `<wpd-step>`**  *(since 0.5.2)*

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

### `unregisterSettingsTab( id )` — Stable *(since 0.5.2)*

Remove a previously registered tab. Idempotent.

```javascript
wp.desktop.unregisterSettingsTab( 'my-plugin' );
```

---

### `listSettingsTabs()` — Stable *(since 0.5.2)*

Snapshot of every currently registered third-party settings tab, sorted by `order`. Built-in tabs are not included.

---

### `registerDockRailRenderer( def )` — Stable *(since 0.6.0)*

Register a renderer that **replaces the dock rail entirely**. The default `'default'` renderer is the shipped icon-strip backed by the `Dock` class; plugin authors can ship anything from a circular ring to a Stage-Manager-style stack to a floating cluster. The user picks among registered renderers in OS Settings → Appearance → Dock style (persisted to user meta as `dockRailRenderer`).

The active renderer is mounted into the dock container by the layout dispatcher; the controller it returns drives every subsequent live update (live menu refresh, system tile add/remove, badge updates, attention animations). A renderer that throws from `mount()` is caught — the failure is logged via `HOOKS.SHELL_ERROR` and the dispatcher falls back to the built-in `'default'` so the user never sees an empty dock.

**Definition shape:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | `string` | yes | Unique. `[a-z0-9_-]+`. Re-registering with the same id replaces the previous entry. `'default'` is reserved for the shipped icon-strip renderer; a plugin that registers `id: 'default'` replaces the baseline. |
| `label` | `string` | yes | Shown in the OS Settings picker. |
| `description` | `string` | no | One-line preview text for the picker. |
| `icon` | `string` | no | Dashicon class for the picker icon. |
| `apiVersion` | `1` | no | Reserved for forward-compat. Omit to match the current contract. |
| `owner` | `string` | no | Plugin-deactivation auto-unregisters every renderer with this tag. |
| `mount( deps )` | `function` | yes | Build the rail UI. Return a controller. See below. |

**`mount( deps )` contract — `deps` shape:**

| Field | Type | Notes |
|---|---|---|
| `container` | `HTMLElement` | The rail's host element. The renderer owns everything inside it; the shell does not paint here after `mount()` returns. |
| `items` | `DockItem[]` | Initial menu-derived tile list — the rail-scoped slice the active layout routes to this rail (Classic splits core to the side rail, plugins to the primary rail). |
| `fullMenu` | `DockItem[]` | The COMPLETE admin-menu list, including items routed to other rails or the wallpaper-icon grid. Read this when the renderer wants a unified view of the entire admin regardless of the layout's partitioning. Updates with every live menu refresh. |
| `fullSystemTiles` | `SystemDockItem[]` | Snapshot of every JS-registered system tile across both rails at mount time (OS Settings, plugin-owned launchers, recycle bin, …). Live updates still flow through the controller's `appendSystemItem` / `removeSystemItem`. |
| `orientation` | `'left' \| 'right' \| 'bottom'` | Reflected on the container's `data-desktop-mode-dock-placement` attribute. |
| `openItem( item )` | `function` | Primary tile click. Routes through the same `windowManager.open()` the default renderer uses (multi-instance, submenu propagation, session restore). Renderers SHOULD use this instead of calling the manager directly. |
| `openSubmenuPick( item, sub )` | `function` | Submenu pick — opens the child URL while preserving the parent's identity for `baseId`, icon, and the in-window tab strip. Renderers that surface submenus (popovers, fan-outs) call this instead of deriving window ids themselves. |
| `openSystemItem( item )` | `function` | System-tile click (OS Settings, plugin-owned native windows). Mirrors `openItem` for the non-menu cohort. |
| `windowManager` | `WindowManager` | Full instance. Use sparingly; prefer the routing callbacks. |
| `adminUrl` | `string` | Admin URL prefix for window-id derivation. |

**Returned controller — `DockRailController`:**

Required: `replaceItems`, `appendSystemItem`, `removeSystemItem`, `destroy`. Optional: `setBadge`, `setAttention`, `setOrientation`. Optional methods are silently skipped when the active renderer doesn't implement them — a renderer without a badge surface still works; those signals just don't paint.

```javascript
wp.desktop.ready( () => {
    wp.desktop.registerDockRailRenderer( {
        id:    'my-ring',
        label: 'Ring',
        owner: 'my-plugin',
        mount( { container, items, openItem } ) {
            // … paint items on a circle, click → openItem(item) …
            return {
                replaceItems( next )  { /* repaint */ },
                appendSystemItem( i ) { /* add a system tile */ },
                removeSystemItem( id ){ /* remove it */ },
                destroy()             { container.innerHTML = ''; },
            };
        },
    } );
} );
```

See the full walk-through in [`docs/examples/dock-rail-renderer.md`](./examples/dock-rail-renderer.md).

> **`wp.desktop.dock` with a custom renderer.** When the default renderer is active, `wp.desktop.dock` / `wp.desktop.sideDock` continue to return the underlying `Dock` instance (backwards compat). With a custom renderer active, both return `null` — plugins that need renderer-agnostic access should reach for `windowManager`, `activity`, or the public hook surface instead.

---

### `unregisterDockRailRenderer( id )` — Stable *(since 0.6.0)*

Remove a rail renderer by id. Idempotent — unknown ids are silent no-ops.

---

### `listDockRailRenderers()` — Stable *(since 0.6.0)*

Snapshot of every currently registered rail renderer in registration order. Used by the OS Settings picker; plugin authors rarely need it directly.

---

### `openOsSettings( opts? )` — Stable *(since 0.6.0)*

Open (or focus, if already open) the shell's OS Settings window. Routes through the same `windowManager.open()` call the dock's OS Settings tile uses, so a window opened via `wp.desktop.openOsSettings()` is indistinguishable from one opened by clicking the dock tile — same id, same render callback, same dimensions, same focus / minimize behaviour.

```js
wp.desktop.openOsSettings();
```

Pass `{ tabId }` to land directly on a specific settings tab. The built-in tab ids are `'appearance'`, `'ai'`, `'apps-icons'`, `'features'`, `'effects'`, `'help'`, and `'about'`; a tab registered via `registerSettingsTab()` is addressable by its own id. (`'extended'` is accepted as a legacy alias for `'features'` — the Extended Options tab merged into the Features tab in 0.9.5.) The tab is selected before the window opens, and if OS Settings is already open the live tab strip switches in place:

```js
// Deep-link straight to the AI Settings tab.
wp.desktop.openOsSettings( { tabId: 'ai' } );
```

| Param | Type | Notes |
|---|---|---|
| `opts.tabId` | `string` (optional) | Settings tab to activate. On a fresh open, unknown ids fall back to the default tab; passing an unknown id while OS Settings is already open deselects every tab in the live strip — validate the id first. |

The motivating use case: a custom dock rail renderer in **Classic** layout doesn't see the OS Settings tile (it lives on the side rail with the core menus, not the primary rail the custom renderer owns). Opening OS Settings from inside the renderer used to require DOM-scraping `[data-system-id="desktop-mode-os-settings"]` and clicking it; this method is the documented portable path.

---

### `updateOsSettings( patch, opts? )` — Stable *(since 0.7.2)*

Patch the OS Settings state and persist it — the programmatic equivalent of the user flipping a control in the OS Settings panel.

```typescript
wp.desktop.updateOsSettings(
    patch: Partial< OsSettingsSnapshot >,
    opts?: { windowId?: string },
): void;
```

- **Whitelist semantics.** Only keys present on the public `OsSettingsSnapshot` shape are honored; unknown (or wrong-typed) keys are silently ignored, so a typo'd field can't bloat the persisted state. Collection fields are sanitized on the way in (`nativePostsHiddenColumns` / `dockOrder` entries must be non-empty strings, `itemVisibility` values must be one of `'both' | 'dock' | 'desktop' | 'hidden'`, `dockPromotedPositions` values must be finite `{ x, y }` coordinates).
- **Persistence.** The write runs through the same pipeline as the panel: a `localStorage` cache write plus a debounced REST sync (250 ms window).
- **Subscribers fire.** Both the top-level `wp.desktop.subscribeOsSettings( cb )` and every settings tab's `ctx.subscribeOsSettings` see the new snapshot.
- **Observable save lifecycle.** Each phase fires on `document` as [`desktop-mode-os-settings-save-lifecycle`](#desktop-mode-os-settings-save-lifecycle--stable-since-072) (`'pending'` → `'saving'` → `'saved'` / `'failed'`), same as a built-in tab's save. `<wpd-save-status auto>` renders it for free.
- **`opts.windowId`** attributes the in-flight REST sync to a specific window's title-bar activity dot (defaults to the OS Settings window).

The read-side companions are also top-level members: `wp.desktop.getOsSettings()` returns a defensive copy of the current snapshot and `wp.desktop.subscribeOsSettings( cb )` returns an unsubscribe function — both mirror the settings-tab `ctx.getOsSettings` / `ctx.subscribeOsSettings` API documented under [`registerSettingsTab`](#registersettingstab-def---stable-since-052), usable from any feature plugin without registering a tab.

---

### `deriveWindowId( url, adminUrl? )` — Stable *(since 0.6.0)*

Derive a stable window id from an admin URL — the same id the default rail renderer uses when it opens a tile. Matches the shell's internal slugifier; a custom renderer that calls `wp.desktop.deriveWindowId( url )` and `wp.desktop.windowManager.open( { id, … } )` addresses the same window the default renderer would. Switching renderer mid-session preserves the user's open windows because both renderers agree on ids.

`adminUrl` defaults to `wp.desktop.config.adminUrl` so callers normally pass just the URL:

```js
const id = wp.desktop.deriveWindowId( '/wp-admin/edit.php' );
// → 'edit-php' (or whatever the shell's slugifier produces)
wp.desktop.windowManager.open( { id, baseId: id, url: '/wp-admin/edit.php', /* … */ } );
```

> **For rail renderers** — prefer `openItem( item )` / `openSubmenuPick( item, sub )` from `DockRailMountDeps`. They call `deriveWindowId` internally with the right `adminUrl` and build the rest of the window config for you. Only reach for `deriveWindowId` directly when you need the id for something other than `windowManager.open()` (e.g., an indicator, a deep-link, an analytics event).

> **Don't pass a string to `windowManager.open()`.** It accepts a config object only — passing a URL string throws a `TypeError` at the call site (as does a missing or wrong-typed `id` / `url` / `title`). Build the config with `deriveWindowId` for the id, or use the routing callbacks above.

---

### `listSystemTiles()` — Stable *(since 0.6.0)*

Snapshot of every JS-registered system tile across both rails. Returns `[]` when the layout dispatcher hasn't booted yet (rare; only happens before `desktop-mode.init` fires).

Each entry is a read-only descriptor — the underlying `SystemDockItem` (with its `onOpen` / `isOpen` callbacks) lives behind `getSystemTile( id )`.

```typescript
[
    {
        id:       string,
        title:    string,
        icon:     string,
        affinity: 'core' | 'plugin',  // 'core' tiles route to side rail in Classic
    },
    …
]
```

```js
const tiles = wp.desktop.listSystemTiles();
const settings = tiles.find( ( t ) => t.id === 'desktop-mode-os-settings' );
// settings → { id, title: 'OS Settings', icon: 'dashicons-desktop', affinity: 'core' }
```

A custom rail renderer that wants to compose against the same tile set the default renderer paints — e.g., a launcher palette that lists every native-window plugin tile + the OS Settings tile in one place — uses this to enumerate.

---

### `getSystemTile( id )` — Stable *(since 0.6.0)*

Look up a system tile by id. Returns the underlying `SystemDockItem` so callers can read its `title` / `icon` / `isOpen()` predicate, or invoke `onOpen()` to forward the action.

Returns `null` when the id isn't registered or the dispatcher hasn't booted yet.

```js
// Open a known system tile from anywhere — no DOM scraping.
wp.desktop.getSystemTile( 'desktop-mode-os-settings' )?.onOpen();
```

---

### `getMenuItems()` — Stable *(since 0.6.0)*

Read the complete admin-menu list, regardless of how the active layout would partition it across rails. The default Classic layout splits the menu (core to side rail, plugin to primary rail), so a custom rail renderer's `mount-deps.items` is layout-scoped — `getMenuItems()` returns the full picture for renderers that want to paint a unified view of the entire admin.

```js
const everything = wp.desktop.getMenuItems();   // [ DockItem, DockItem, … ]
```

Returns a defensive copy — mutating the result doesn't change shell state. Updates with every live menu refresh; call from inside [`desktop-mode-registry-changed`](#desktop-mode-registry-changed--stable-since-070) CustomEvent listeners (or the rail renderer's `replaceItems`) to get the fresh post-refresh snapshot.

> **For renderers using the registry path:** `DockRailMountDeps.fullMenu` and `fullSystemTiles` carry the same data and are preferable inside a `mount()` body — they're snapshots at the moment the rail mounts, so a renderer holding the arrays sees stable references.

---

### `renderIcon( icon, opts )` — Stable *(since 0.6.0)*

Render an icon-string into a DOM element using the canonical dispatch the default dock uses. One implementation, five shapes:

| Input | Output |
|---|---|
| `'dashicons-…'` | `<span class="dashicons dashicons-…">` |
| `'data:image/svg+xml;base64,…'` | `<span>` with the SVG as a CSS background-image |
| `'data:image/png;base64,…'` (any raster data URI — png, jpeg, gif, webp, x-icon) | `<img src=…>` |
| `'http(s)://…'` | `<img src=…>` |
| Anything else (`''`, `'none'`, `'div'`, …) | Letter-badge fallback — coloured circle with the first one or two letters of `opts.title`, hue hashed from the title so the swatch is stable per plugin |

```js
const iconEl = wp.desktop.renderIcon( item.icon, {
    title: item.title,
    className: 'my-renderer__icon',
} );
host.appendChild( iconEl );
```

Custom rail renderers should use this so their icons look consistent with the default dock (and the letter-badge fallback colour stays stable across reloads — same hash function).

---

### `applyTileClasses( base, item, ctx )` / `applyTileElement` / `applyTileTooltip` / `dispatchTileRendered` — Stable *(since 0.6.0)*

Run the registered dock decoration hooks against a tile your custom renderer is building. **Custom rail renderers SHOULD invoke these** at the equivalent points the default `Dock` renderer does — otherwise decoration plugins (glow, animations, custom tooltips) silently fail to apply when the user picks your renderer.

```js
const classes = wp.desktop.applyTileClasses(
    [ 'my-renderer__tile' ],
    item,
    { dockId: 'my-renderer', orientation: 'bottom', isSystem: false },
);
tile.className = classes.join( ' ' );

const tooltip = wp.desktop.applyTileTooltip( item.title, item, ctx );
if ( tooltip ) {
    tile.title = tooltip;
}

const finalEl = wp.desktop.applyTileElement( tile, item, ctx );
host.appendChild( finalEl );

wp.desktop.dispatchTileRendered( finalEl, item, ctx );
```

`ctx` shape: `{ dockId: string; orientation: 'left' | 'right' | 'bottom'; isSystem: boolean; rail?: 'dock' | 'taskbar'; container?: HTMLElement }`.

---

### `isDockElement( target )` / `registerDockSelector( selector )` — Stable *(since 0.6.0)*

`isDockElement` walks an event target's `composedPath` looking for a known dock element. Returns `true` when the click landed on the default dock, the side dock, the dock tooltip, the submenu popover, or any custom-renderer root registered via `registerDockSelector`. Use in click-outside-to-dismiss handlers so plugins compose cleanly.

```js
document.addEventListener( 'pointerdown', ( e ) => {
    if ( wp.desktop.isDockElement( e.target ) ) {
        return; // click landed on the dock — keep my popover open
    }
    closeMyPopover();
} );
```

`registerDockSelector` adds a CSS selector to the "inside the dock" set. Custom rail renderers should call this from `mount()` so other plugins' click-outside handlers correctly classify clicks on the renderer's surface. Returns an unregister function.

```js
const unregister = wp.desktop.registerDockSelector( '.my-renderer__root' );
// later, in destroy():
unregister();
```

---

### `registerPalette( def )` — Stable  *(since 0.5.0)*

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

The built-in AI Assistant is already registered as palette 0 (`id: 'desktop-mode-ai-assistant'`) — your palette lands at position 1 and the cycle goes AI → yours → closed → AI → …

---

### `unregisterPalette( id )` — Stable  *(since 0.5.0)*

Remove a palette from the cycle. Idempotent.

```javascript
window.wp.desktop.unregisterPalette( 'my-plugin/launcher' );
```

---

### `listPalettes()` — Stable  *(since 0.5.0)*

Snapshot of all palettes in registration order.

---

### `openPalette( id )` — Stable  *(since 0.5.0)*

Open one palette by id, closing any other palette that's currently visible. Useful for deeplinks, menu items, or programmatic triggers that should target a specific palette rather than advance the cycle.

```javascript
window.wp.desktop.openPalette( 'my-plugin/launcher' );
```

---

### Built-in `/open` — Stable
The shell registers one built-in command at boot: `/open [window]`. It opens any admin menu entry (dock or taskbar) in a legacy iframe window — `/open Posts`, `/open Plugins`, `/open Media`, etc. Autocomplete starts with the first 12 openable entries; as the user types, the list filters by case-insensitive substring match against label and id (max 12 shown).

Plugins extend the `/open` autocomplete via the **`desktop-mode.open-command.items`** filter:

```javascript
wp.hooks.addFilter(
    'desktop-mode.open-command.items',
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

        const res = await wp.desktop.fetch( `/wp-json/wp/v2/users?search=${ encodeURIComponent( q ) }` );
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

> **Most plugin authors should never look at this section.** The unified [`Window.send/on`](#windowsend-channel-payload---stable-since-055) and iframe-side [`wp.desktop.send/on`](#wpdesktopsend--wpdesktopon--stable-since-055) hide every postMessage type catalogued below. This section is for: (a) debugging the bridge, (b) writing low-level shell internals, (c) integrating an iframe page that doesn't enqueue the standard `desktop-mode-iframe-bridge` script. If your goal is "tell my window's content something happened," reach for `Window.send/on` first.

### iframe → parent

All messages are dispatched via `window.parent.postMessage( { type, ... }, window.location.origin )` from inside the chromeless admin iframe.

#### `desktop-mode-window-publish` — Stable *(since 0.5.5)*

The unified channel-API outbound primitive. Posted internally by `wp.desktop.send( channel, payload )` inside the iframe. The parent shell forwards every match to `Window.on( channel, cb )` subscribers for this iframe's window. **Plugin authors should call `wp.desktop.send` instead of posting this manually** — the latter is documented for debugging.

```typescript
{ type: 'desktop-mode-window-publish'; channel: string; payload?: unknown }
```

#### `desktop-mode-title-change` — Stable
Update the window's title bar.

```typescript
{ type: 'desktop-mode-title-change'; title: string }
```

#### `desktop-mode-navigate` — Stable
Request a navigation from the iframe. `target: 'new'` opens a new browser tab (with `noopener,noreferrer`); `'self'` replaces the iframe's current page. The URL is validated same-origin against the shell's origin snapshot — cross-origin URLs are silently refused, so an iframe cannot use this to break out of the shell.

```typescript
{ type: 'desktop-mode-navigate'; url: string; target: 'self' | 'new' }
```

#### `desktop-mode-notification` — Stable
Raise a transient toast at the parent-shell level. The toast survives the iframe's lifecycle — a "Settings saved" message stays visible even after the user closes the window that triggered it. Title is required; body is optional (concatenated with an em-dash when present). Empty titles are dropped.

```typescript
{ type: 'desktop-mode-notification'; title: string; body?: string }
```

#### `desktop-mode-ready` — Stable
Posted once by the chromeless bridge script when its message listeners are attached. Dispatches `HOOKS.IFRAME_READY` on the parent with `{ windowId }`. Prefer subscribing to `IFRAME_READY` over the browser's native iframe `load` event when timing matters — `load` fires before our bridge wires up, so messages sent on `load` can race the listener and drop.

```typescript
{ type: 'desktop-mode-ready' }
```

#### `desktop-mode-focus-request` — Stable
Posted by the chromeless bridge on every pointerdown inside the iframe. The parent focuses the window, unless it's currently in the overview grid (where clicks are absorbed by the grid controller).

```typescript
{ type: 'desktop-mode-focus-request' }
```

#### `desktop-mode-external-link` — Stable
Posted when a link inside the iframe points off-site; the parent opens an external-tab card inside the window's tab strip.

```typescript
{ type: 'desktop-mode-external-link'; url: string; label?: string }
```

#### `desktop-mode-open-user-footprint` — Stable *(since 0.9.1)*
Posted when a `[data-desktop-mode-footprint]` link is clicked inside a chromeless iframe — the "View activity footprint" row action on the classic Users table. Checked *before* the admin-link classifier, so the link's fallback `href` is never followed inside the shell. The parent opens (or focuses) the My WordPress window on that user's footprint route and leaves the source window open (it's an auxiliary peek, not a navigation away — contrast `desktop-mode-iframe-admin-link`, which closes the source on a remap hit). The public entry point is [`wp.desktop.myWordpress.openUserFootprint`](#public-api--wpdesktopmywordpress); see also `bridge-protocol.md`.

```typescript
{ type: 'desktop-mode-open-user-footprint'; userId: number; userName: string }
```

#### `desktop-mode-iframe-error` — Stable
Posted from inside the chromeless iframe's `error` / `unhandledrejection` handlers. The parent re-dispatches as `HOOKS.IFRAME_ERROR` with `{ windowId, kind, message, filename, lineno, colno, stack }` so monitor widgets can subscribe.

```typescript
{
    type: 'desktop-mode-iframe-error';
    kind: 'error' | 'unhandledrejection';
    message: string;
    filename?: string;
    lineno?: number;
    colno?: number;
    stack?: string;
}
```

#### `desktop-mode-iframe-network` — Stable
Posted by the chromeless bridge's `fetch` and `XMLHttpRequest` wrappers whenever an HTTP call completes (success or failure). The parent re-dispatches as `HOOKS.IFRAME_NETWORK_COMPLETED` with `{ windowId, method, url, status, duration, failed }`. `status === 0` indicates a network-level failure before a response arrived.

```typescript
{
    type: 'desktop-mode-iframe-network';
    method: string;
    url: string;
    status: number;
    duration: number;
    failed: boolean;
}
```

#### `desktop-mode-screen-meta` — Stable
Announces the screen-meta panels (Screen Options / Help) that the iframe page exposes. The parent renders one title-bar button per announced panel, replacing any previously rendered set.

```typescript
{ type: 'desktop-mode-screen-meta'; panels: ( 'screen-options' | 'help' )[] }
```

The iframe sends this on every load — **including an empty `panels: []`** — so the parent can clear stale buttons when a page (e.g. after an in-place same-slug navigation) exposes no screen meta. A panel is announced only when its toggle link is present **and** the panel actually has content: a Screen Options panel with no form controls, or a Help tab registered with empty `content` and no callback, is omitted so the title bar never shows a button that opens an empty panel.

#### `desktop-mode-screen-meta-state` — Stable
Reports which screen-meta panel (if any) is currently open inside the iframe.

```typescript
{ type: 'desktop-mode-screen-meta-state'; open: 'screen-options' | 'help' | null }
```

#### `desktop-mode-commands-list` — Experimental
Reports the current `wp.data.select('core/commands')` registry of this iframe to the parent shell. Emitted after the iframe receives `desktop-mode-commands-subscribe`, and then re-emitted (de-duplicated) whenever a re-render of the in-iframe React harvester changes the merged list. The parent re-publishes each entry as a slash-command in the shell palette tagged `owner: 'iframe:<windowId>'` and `eager: true` so the command surfaces before the user types `/`.

Collection spans tier-2 (context-scoped `getCommands(true)`) and tier-3 (dynamic `getCommandLoaders(true)` hooks — invoked inside a mounted React tree so the rules of hooks hold). Global tier-1 navigation commands are deliberately skipped: the user already has them via the dock.

Each `HarvestedCommand` carries a `kind` field the iframe computes by **statically matching** `callback.toString()` against a string-literal navigation target (`location.href = '…'`, `.assign('…')`, `.replace('…')`). An earlier dry-run approach triggered infinite window spawning because `Location.prototype.href` is non-configurable — the shim silently failed and every nav callback actually navigated. Computed URLs fall back to `action` and proxy back into the iframe via `desktop-mode-commands-invoke`.

`iconSvg` carries the `@wordpress/icons` React element flattened to SVG markup via `wp.element.renderToString`; the structured-clone algorithm behind `postMessage` would refuse the raw element.

```typescript
{
    type: 'desktop-mode-commands-list';
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

#### `desktop-mode-plugins-changed` — Stable

Carries a full menu payload harvested from real admin context. Emitted by the chromeless bridge when the iframe lands on a page whose completion commonly mutates the admin menu (`plugins.php`, `plugin-install.php`, `update.php`, `themes.php`), and by the hidden refresh probe [`wp.desktop.refreshMenu()`](#refreshmenu) spawns. The shell diffs the payload against its prior snapshot by `id` and repaints only the registries that actually changed (dock, native windows, widgets, …) — no browser reload. The payload also carries `menuSig`, its own [menu signature](#desktop-mode-menu-signature--stable-since-094), which the shell adopts as its last-known value.

```typescript
{ type: 'desktop-mode-plugins-changed'; payload: { dockItems: unknown[]; nativeWindows: unknown[]; /* … */ menuSig: string } }
```

#### `desktop-mode-menu-signature` — Stable *(since 0.9.4)*

A lightweight structural fingerprint of the admin menu, emitted by the chromeless bridge on **every** chromeless admin page that does *not* already carry a full `desktop-mode-plugins-changed` payload. The shell compares `sig` against its last-known value (seeded from `desktopModeConfig.menuSig` at boot, updated on every applied payload) and — only when it differs — spends one [`wp.desktop.refreshMenu()`](#refreshmenu) probe to reconcile the dock.

This closes the gap where a custom post type registered through a settings tool (CPT UI, Pods, ACF, …) saves on its own `admin.php?page=…` / `options.php` screen — none of which is on the full-payload allowlist — so the new menu item never reached the live dock until a full browser reload (GH#325). An unchanged menu costs nothing beyond the tiny message; a full harvest happens only on a real change.

```typescript
{ type: 'desktop-mode-menu-signature'; sig: string }
```

---

### parent → iframe

```javascript
iframe.contentWindow.postMessage( { type, ... }, window.location.origin );
```

#### `desktop-mode-window-send` — Stable *(since 0.5.5)*

The unified channel-API inbound primitive. Posted internally by `Window.send( channel, payload )` for iframe targets. Inside the iframe the bridge forwards each match to `wp.desktop.on( channel, cb )` subscribers. **Plugin authors should call `Window.send` instead of posting this manually** — the latter is documented for debugging.

```typescript
{ type: 'desktop-mode-window-send'; channel: string; payload?: unknown }
```

#### `desktop-mode-focus` — Stable
Instructs the iframe that its containing window has been focused.

```typescript
{ type: 'desktop-mode-focus' }
```

#### `desktop-mode-color-scheme` — Stable
Notifies the iframe of a parent-side color scheme change so CSS Custom Properties can be synced.

```typescript
{ type: 'desktop-mode-color-scheme'; scheme: string }
```

#### `desktop-mode-toggle-panel` — Stable
Asks the iframe to toggle a named screen-meta panel. The iframe is the authority — it responds by emitting a `desktop-mode-screen-meta-state` message.

```typescript
{ type: 'desktop-mode-toggle-panel'; panel: 'screen-options' | 'help' }
```

#### `desktop-mode-commands-subscribe` — Experimental
Tells the iframe to begin streaming its `wp.data.select('core/commands')` registry to the parent via `desktop-mode-commands-list`. The shell sends this to the iframe owned by the currently focused window and rescinds it (`desktop-mode-commands-unsubscribe`) when focus moves elsewhere.

```typescript
{ type: 'desktop-mode-commands-subscribe' }
```

#### `desktop-mode-commands-unsubscribe` — Experimental
Tells the iframe to stop streaming its command list. The parent unregisters any shell-palette entries still tagged with this window's owner.

```typescript
{ type: 'desktop-mode-commands-unsubscribe' }
```

#### `desktop-mode-commands-invoke` — Experimental
Asks the iframe to run a previously harvested `action`-kind command. Sent when the user selects the command from the shell palette. Navigation-kind commands are handled parent-side by opening a new desktop window — the iframe never sees them.

```typescript
{ type: 'desktop-mode-commands-invoke'; name: string }
```

---

### Safety guidelines for bridge messages

- **Always validate `event.origin`** against `window.location.origin`. Cross-origin messages are rejected by the parent today; your iframe adapter should do the same.
- **Never pass raw HTML** through the bridge. If you need to display text, pass a string and let the parent render it via `textContent`.
- **Be idempotent.** A bridge message may arrive twice during navigations. Design payloads so the second arrival is a no-op.

---

## 4. Hooks — `desktop-mode.*`

Desktop Mode exposes WordPress-style filters and actions via the standard `@wordpress/hooks` package. The plugin declares `wp-hooks` as a script dependency so `window.wp.hooks` is always available before the shell boots, and all hook names live in the `desktop-mode.` namespace to avoid collisions with Core or Gutenberg.

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

`ready()` runs the callback **synchronously via a microtask** if `desktop-mode.init` has already fired, or queues it via `addAction( 'desktop-mode.init', … )` otherwise. It's a shorter alias of `wp.desktop.whenReady()` (`whenReady` has been Stable since 0.5.0; the `ready` alias ships in 0.5.1).

> **Why not `wp.hooks.addAction( 'desktop-mode.init', … )` directly?**
>
> `addAction()` queues a callback for *future* firings of the action. When a plugin script is loaded **after** `desktop-mode.init` has already fired — the normal case for anything registered by a server-sync module — the callback is never invoked. `ready()` handles both cases: already-fired (call immediately) and not-yet-fired (queue on the action). Use `ready()` as the default; reach for `addAction()` directly only if you specifically want multi-fire semantics.

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
| `desktop-mode.init` | action | Stable | `{ config: DesktopConfig }` |
| `desktop-mode.shell.resized` | action | Stable | `{ width, height }` — debounced ~120 ms after the browser stops resizing |
| `desktop-mode.shell.visibility` | action | Stable | `{ state: 'visible' \| 'hidden' }` — mirrors `document.visibilitychange` |
| `desktop-mode.wallpapers` | filter | Stable | `WallpaperDef[] → WallpaperDef[]` |
| `desktop-mode.wallpaper.mounting` | action | Stable | `{ id, container, ctx }` |
| `desktop-mode.wallpaper.mounted` | action | Stable | `{ id, container, ctx }` |
| `desktop-mode.wallpaper.unmounting` | action | Stable | `{ id }` |
| `desktop-mode.wallpaper.mount-failed` | action | Stable | `{ id, error }` |
| `desktop-mode.wallpaper.visibility` | action | Stable | `{ id, state: 'visible' \| 'hidden' }` |
| `desktop-mode.wallpaper.preview-params` | filter | Experimental *(since 0.9.5)* | `Record<string, unknown> → Record<string, unknown>`, second arg `wallpaperId` — override a wallpaper's live-preview parameters before its `renderPreview` runs |
| `desktop-mode.wallpaper.settings-changed` | action | Experimental *(since 0.9.5)* | `{ id, settings }` — the user edited the wallpaper's settings through its `renderConfig` dialog; `settings` is the full post-merge bag. Mounted wallpapers live-apply from here |
| `desktop-mode.wallpaper.surfaces` | filter | Stable | `WallpaperSurface[] → WallpaperSurface[]` — see below |

#### Arrange & Overview

Fired by the admin-bar "Arrange" menu's layout algorithms. The overview hooks come in pairs (enter/exit, hover/unhover) so plugins can maintain accurate state counts.

| Hook | Kind | Status | Payload |
|---|---|---|---|
| `desktop-mode.overview.entering` | action | Stable | `{}` — before the enter animation starts |
| `desktop-mode.overview.entered` | action | Stable | `{}` — fires ~300 ms later, after the grid settles |
| `desktop-mode.overview.exiting` | action | Stable | `{ windowId?: string, reason: 'select' \| 'cancel' }` |
| `desktop-mode.overview.exited` | action | Stable | same payload as `exiting` |
| `desktop-mode.overview.window-hover` | action | Stable | `{ windowId }` |
| `desktop-mode.overview.window-unhover` | action | Stable | `{ windowId }` |
| `desktop-mode.overview.window-click` | action | Stable | `{ windowId }` — fires just before `exiting` when a thumbnail is clicked |
| `desktop-mode.arrange.cascade.starting` | action | Stable | `{ windowCount }` |
| `desktop-mode.arrange.cascade.applied` | action | Stable | `{ windowCount }` |
| `desktop-mode.arrange.tile.starting` | action | Stable | `{ windowCount, cols, rows }` — before tile lays out the grid |
| `desktop-mode.arrange.tile.applied` | action | Stable | `{ windowCount, cols, rows }` |
| `desktop-mode.arrange.tile.dimensions` | filter | Stable | filters `{ cols, rows }`; context `{ windowCount, areaWidth, areaHeight }`. Override the auto-chosen grid (e.g., force a 3-column newsroom layout). Returns must be positive integers and `cols * rows >= windowCount`, otherwise the filter is ignored. |
| `desktop-mode.arrange.snap.changed` | action | Stable | `{ enabled }` — fires when the user toggles "Snap to grid" |
| `desktop-mode.arrange.snap.cell-size` | filter | Stable | filters `{ cellWidth, cellHeight }`; context `{ areaWidth, areaHeight }`. Override the auto-computed snap cell size (e.g., enforce a fixed 100×100 grid). Non-positive returns are ignored. |
| `desktop-mode.arrange.custom-action` | action | Stable | `{ id }` — fires when the user clicks a plugin-registered Arrange-menu item (registered server-side via the `desktop_mode_arrange_menu_items` PHP filter). The `id` matches the `id` field the plugin supplied. |

#### Virtual desktops ("Spaces")

Each user can have multiple desktops, each owning its own set of windows. Switching desktops swaps which windows are visible without destroying any. The overview top bar surfaces tile-per-desktop UI for switching, creating, and closing.

| Hook | Kind | Status | Payload |
|---|---|---|---|
| `desktop-mode.desktop.created` | action | Stable | `{ desktopId }` — fires after a new desktop joins the registry |
| `desktop-mode.desktop.closed` | action | Stable | `{ desktopId, migratedTo }` — `migratedTo` is the desktop that received any orphaned windows |
| `desktop-mode.desktop.switched` | action | Stable | `{ from, to }` — the active desktop changed |

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

User-placed geometry (position + size of liberated widgets) persists per-user in `localStorage` under `desktop-mode-widgets-geometry`. Height resizes made while a resizable widget is docked in the column persist separately under `desktop-mode-widgets-docked-heights` (height only — column widgets have no free position, and a full geometry record would mark the widget as floating at boot). Removing a widget clears both records so a re-add starts docked at its natural height.

##### `wp.desktop.widgets.redock( id )` — Stable since 0.6.0

Programmatically un-float a liberated widget back into the right-side column. Idempotent — already-docked widgets and unknown ids silently no-op. Mirrors what the user gets by clicking the re-dock affordance in the floating widget's chrome header.

```js
// "Reset widget positions" command for a power-user palette.
for ( const id of wp.desktop.widgetLayer?.getEnabledIds() ?? [] ) {
    wp.desktop.widgets.redock( id );
}
```

Equivalent legacy entry point: `wp.desktop.widgetLayer?.redock( id )`. New code should prefer `wp.desktop.widgets.redock`, which keeps a stable namespace as the widget surface grows.

| Hook | Kind | Status | Payload |
|---|---|---|---|
| `desktop-mode.widgets` | filter | Stable | the registry array |
| `desktop-mode.widget.mounting` | action | Stable | `{ id, container, ctx }` — before paint |
| `desktop-mode.widget.mounted` | action | Stable | `{ id, container, ctx }` — after paint |
| `desktop-mode.widget.unmounting` | action | Stable | `{ id }` — before teardown |
| `desktop-mode.widget.mount-failed` | action | Stable | `{ id, error }` |
| `desktop-mode.widget.added` | action | Stable | `{ id }` — user added via the picker |
| `desktop-mode.widget.removed` | action | Stable | `{ id }` — user removed via the card's × |

The `ctx` argument exposes `{ id, pluginUrl, storage }` — `storage` is a per-widget key/value store auto-namespaced in `localStorage` (`desktop-mode.widget.<id>.<key>`), so two widgets can both persist a `layout` key without colliding. (Canvas wallpapers receive a different context: `{ id, pluginUrl, prefersReducedMotion, visible, settings }`.) Enabled widgets persist per-user in `localStorage` (`desktop-mode-widgets`).

#### Window lifecycle

All window actions include at minimum `{ windowId: string }` — additional fields called out in the payload column.

| Hook | Kind | Status | Payload |
|---|---|---|---|
| `desktop-mode.window.geometry` | filter | Stable *(0.8.6)* | `( geometry, ctx ) => geometry` — last call before `WindowConfig` is baked. See [the geometry filter section below](#window-geometry-filter) for the contract and a recipe. |
| `desktop-mode.window.opened` | action | Stable | `{ windowId, page, title, url }` |
| `desktop-mode.window.reopened` | action | Stable | `{ windowId, baseId, wasMinimized, navigated }` — fires when `openWindow()` is called for an already-open window; `navigated` *(0.9.4)* is `true` when the request carried a URL the window wasn't showing and the framework navigated the existing iframe to it in place |
| `desktop-mode.window.content-loading` | action | Stable *(0.6.0)* | `{ windowId }` — fires on the loading entry edge (construction + every `markContentLoading()`). Edge-triggered. |
| `desktop-mode.window.content-loaded` | action | Stable *(0.6.0)* | `{ windowId }` — fires on the loading → ready transition (iframe `load` / `desktop-mode-ready`, native render Promise resolves, or `markContentLoaded()`). Edge-triggered. |
| `desktop-mode.window.loading-overlay` | filter | Stable *(0.6.0)* | `(host: HTMLElement, ctx: { windowId, config }) → HTMLElement`. Receives the default overlay element (or whatever a per-window `config.loading.render` produced) and may mutate it or return a replacement. Plugins use this to brand every window's loader, swap the spinner preset, append status text. |
| `desktop-mode.window.closing` | action | Stable | `{ windowId, element }` — fires BEFORE the element is detached (use this when you need an element reference, e.g. for anchored wallpaper overlays) |
| `desktop-mode.window.closed` | action | Stable | `{ windowId }` |
| `desktop-mode.window.focused` | action | Stable | `{ windowId }` — fires on focus changes |
| `desktop-mode.window.blurred` | action | Stable *(0.5.5)* | `{ windowId, focusedTo }` — fires on the window that lost focus when another window is promoted |
| `desktop-mode.window.title-changed` | action | Stable | `{ windowId, title }` — iframe-sourced title updates |
| `desktop-mode.window.minimized` | action | Stable | `{ windowId, element }` — element ride-along matches `closing`'s shape so wallpaper plugins anchored to window tops (snow, leaves) can match stuck particles by identity. Minimized windows render at `opacity: 0` so `offsetParent === null` checks miss them. |
| `desktop-mode.window.restored` | action | Stable | `{ windowId, element }` — restored from minimized |
| `desktop-mode.window.maximized` | action | Stable | `{ windowId, element }` |
| `desktop-mode.window.unmaximized` | action | Stable | `{ windowId, element }` |
| `desktop-mode.window.fullscreen-entered` | action | Stable | `{ windowId, element }` |
| `desktop-mode.window.fullscreen-exited` | action | Stable | `{ windowId, element }` |
| `desktop-mode.window.auto-exit-fullscreen` | filter | Stable *(0.8.6)* | `( shouldExit: boolean, ctx: { windowId, focusedTo } ) => boolean` — decides whether a fullscreen window should auto-exit when focus moves elsewhere. Default `true`. Return `false` to keep persistent-fullscreen surfaces (slideshow, video, game) in fullscreen across focus changes. |
| `desktop-mode.window.focus-on-drag-hover` | filter | Stable *(0.9.4)* | `( shouldFocus: boolean, ctx: { windowId, payloadType } ) => boolean` — decides whether the window under the cursor is raised (focused) after a ~250 ms hover dwell during any drag. `payloadType` is the DragManager payload's `type` slug (`'desktop-file'`, `'shortcut'`, plugin-defined), the bridge payload's `kind` (`'attachment'`, `'post'`, `'user'`), `'os-file'` for OS file drags, or `'external'` for any other native drag. Default `true`. Return `false` to keep HUD/palette/pinned-reference windows from stealing z-order during drags. |
| `desktop-mode.window.drag-start` | action | Stable | `{ windowId }` |
| `desktop-mode.window.drag-end` | action | Stable | `{ windowId, x, y }` |
| `desktop-mode.window.moved` | action | Stable | `{ windowId, x, y }` — fires with drag-end |
| `desktop-mode.window.resize-start` | action | Stable | `{ windowId }` |
| `desktop-mode.window.resize-end` | action | Stable | `{ windowId, width, height }` |
| `desktop-mode.window.resized` | action | Stable | `{ windowId, width, height }` — fires with resize-end |
| `desktop-mode.window.bounds-changed` | action | Stable | `{ windowId, x, y, width, height, state, phase: 'drag' \| 'resize' }` — rAF-coalesced, fires at most once per animation frame during an active drag or resize. See below. |
| `desktop-mode.window.detached` | action | Stable | `{ windowId, url }` — user opened in a classic-admin tab |

**About `bounds-changed`.** Intended for per-frame collision-aware effects (snow piling on window tops, rain splashes, physics-driven overlays). Coalesced via `requestAnimationFrame` so a pointermove storm collapses to one fire per paint — matches the cadence a canvas wallpaper's own ticker runs at, and replaces the "poll `getBoundingClientRect` every rAF" pattern. NOT fired at drag/resize end — use `desktop-mode.window.drag-end` / `desktop-mode.window.resize-end` for settled geometry.

The window hooks fan out alongside the existing `desktop-mode-window-*` CustomEvents (see section 2) — both APIs fire for every state change. New code should prefer the hook bus.

All hooks can be listed via `wp.hooks.hasAction()` / `hasFilter()` for defensive checks.

<a id="window-geometry-filter"></a>
##### `desktop-mode.window.geometry` filter — Stable since 0.8.6

Last call before a window's resolved `x` / `y` / `width` / `height` / `initialState` are baked into the `WindowConfig` the constructor consumes. Plugins use it to:

- **Override the default size of windows they own.** Compute "this should open at 40% of the desktop in the bottom-right corner" once at filter time, instead of resizing after `open()` settles.
- **Snap restored bounds to a different region.** Re-anchor a window the user previously dragged off-screen, or clamp to a per-plugin region.
- **Force an initial state** (e.g. always-maximized for a fullscreen-y tool).

```js
const { HOOKS } = wp.desktop;

wp.desktop.hooks.addFilter(
    HOOKS.WINDOW_GEOMETRY,
    'my-plugin/place-shop',
    ( geometry, ctx ) => {
        // Only retouch the window WE own, and only when the user
        // hasn't dragged or resized it yet — once they have, respect
        // their layout.
        if ( ctx.baseId !== 'my-shop' || ctx.hasSavedGeometry ) {
            return geometry;
        }
        const { width, height } = ctx.desktopRect;
        return {
            ...geometry,
            width:  Math.min( 720, width  - 40 ),
            height: Math.min( 540, height - 80 ),
            x:      width  - Math.min( 720, width  - 40 ) - 20,
            y:      height - Math.min( 540, height - 80 ) - 20,
        };
    }
);
```

**Signature:**

```ts
type WindowState =
    | 'normal' | 'maximized' | 'minimized'
    | 'fullscreen' | 'snapped-left' | 'snapped-right';

type ResolvedWindowGeometry = {
    x: number;
    y: number;
    width: number;
    height: number;
    state?: WindowState;            // optional initial state — e.g. force 'maximized' or 'snapped-left'
};

type WindowGeometryContext = {
    windowId:         string;        // unique per-instance id (multi-window windows differ)
    baseId:           string;        // registry id — stable across instances
    hasSavedGeometry: boolean;       // user previously dragged/resized — respect their layout
    callerPinned:     boolean;       // caller passed at least one explicit dim (native windows: usually true)
    desktopRect:      { width: number; height: number };
};

// Filter shape
( geometry: ResolvedWindowGeometry, ctx: WindowGeometryContext )
    => ResolvedWindowGeometry
```

**About the booleans.** `hasSavedGeometry` and `callerPinned` carry the only two distinctions a filter actually needs:

- **`hasSavedGeometry: true`** — the user previously dragged or resized this window and the values you're being handed are the restored layout. Bail in this case to respect the user's choice. (`hasSavedGeometry` is the most common guard plugins want.)
- **`callerPinned: true`** — the caller of `manager.open()` passed at least one explicit dimension. For **native windows** this is usually `true` (the framework's native-window opener passes the registry's declared `width`/`height` defaults); for **iframe admin pages opened from the dock** this is usually `false`. The filter is free to override registry-declared defaults — `callerPinned: true` does NOT mean "leave the window alone."

**Guarantees:**

- The shell re-clamps `width`/`height` to the window's registered `minWidth`/`minHeight` after the filter returns — a buggy filter cannot ship a sub-minimum window.
- `x`/`y` are NOT re-clamped to the desktop rect; plugins sometimes deliberately place windows partially off-screen. The filter is responsible for its own viewport math when it cares.
- The filter runs *every time the window opens*, not just at registration — so a deactivation/reactivation of a plugin re-runs its filter with fresh `desktopRect` numbers.
- Companion of `desktop_mode_register_window`'s server-side `width` / `height` defaults: the filter sees those defaults as the starting `geometry` value, and `ctx.callerPinned` is `true` for native windows because the framework's own opener passes them through as explicit `manager.open()` args. The filter is free to override anyway — `callerPinned` is signal, not veto.

#### `DockItem` shape

The canonical menu-item type, surfaced everywhere a custom dock surface needs to read what the admin menu contains: `wp.desktop.getMenuItems()`, the rail renderer's `mount-deps.items` and `mount-deps.fullMenu`, the controller's `replaceItems( items )` parameter, every dock decoration hook context.

```typescript
interface DockItem {
    id:       string;        // menu slug — `'edit.php'`, `'wpseo_dashboard'`, …
    title:    string;        // human-readable label
    icon:     string;        // dashicon class | `data:` URI | `http(s):` URL
    url:      string;        // admin URL the tile opens
    badge:    number;        // numeric badge; 0 = no badge
    submenu:  { title: string; url: string }[];
    multi:    boolean;       // hover-peek + Ghost Card eligibility
    isCore:   boolean;       // true for WP-shipped menus, false for plugin-contributed
    pluginFile: string | null; // owning plugin file (e.g. `woocommerce/woocommerce.php`)
                               // when the menu was registered by an active,
                               // deactivatable plugin; null for core menus,
                               // mu-plugins, drop-ins, and Desktop Mode itself.
                               // Drives the dock right-click "Deactivate …" action.
                               // Resolved server-side by snapshotting $menu/$submenu
                               // around every admin_menu callback (registration-time
                               // attribution), with page-hook reflection + a CPT/
                               // taxonomy registration tracker as fallbacks.
                               // Stable since 0.8.2.
    pluginName: string | null; // owning plugin's display name (the `Name:` field
                               // from its plugin header). Used in the right-click
                               // "Deactivate <pluginName>…" label so sub-page tiles
                               // (e.g. WC's Analytics) read as the parent plugin.
                               // Always null when pluginFile is null.
                               // Stable since 0.8.2.
}
```

**`submenu` invariant** — the shell strips self-link entries server-side before the array reaches the JS layer (WordPress's `$submenu[$slug]` includes a self-link as the first entry; the dock data builder removes it). So:

- `submenu.length === 0` reliably means "no real children" — the right-click context menu suppresses the popover trigger, the in-window tab strip stays hidden.
- `submenu.length > 0` reliably means "has real child links" — every entry points at a distinct URL.

A custom rail renderer that decides whether to show a submenu indicator (a chevron, a hover treatment) can read `item.submenu.length > 0` without defensive `submenu.length > 1` or self-URL filtering. The framework owns the contract.

**Lifecycle pairing — `replaceItems` ↔ `appendSystemItem`** — these are independent update paths. `replaceItems( items )` swaps the menu-derived tiles wholesale (the live menu refresh fires it on every plugin activation / deactivation). `appendSystemItem` / `removeSystemItem` track the JS-owned cohort (OS Settings, plugin native-window launchers).

A custom rail renderer's controller MUST persist its system-tile DOM across `replaceItems` calls — the shell does NOT re-emit `appendSystemItem` for previously-added tiles after a menu refresh. Practical pattern: track system tiles in a closure-scoped `Map`, re-paint them in `replaceItems()` after rebuilding the menu cohort.

```js
let systemTiles = new Map();
return {
    replaceItems( menu ) {
        renderMenu( menu );
        // Re-attach every tracked system tile so a menu refresh
        // doesn't lose them.
        for ( const item of systemTiles.values() ) {
            renderSystemTile( item );
        }
    },
    appendSystemItem( item ) {
        systemTiles.set( item.id, item );
        renderSystemTile( item );
    },
    removeSystemItem( id ) {
        systemTiles.delete( id );
        unrenderSystemTile( id );
    },
    destroy() { /* clean both cohorts */ },
};
```

The default renderer uses exactly this pattern internally — `Dock.replaceItems()` re-renders menu tiles + re-applies cached badge overrides + leaves system tiles in place untouched.

---

#### Dock decoration

Render-pipeline hooks the default `Dock` renderer fires while painting tiles. Use these to add classNames, wrap tiles, customize tooltips, or animate tiles in — without forking the renderer. See [`docs/examples/dock-decoration-hooks.md`](./examples/dock-decoration-hooks.md).

Custom rail renderers (registered via `wp.desktop.registerDockRailRenderer`, see below) **should** fire the same hooks at equivalent points so plugin decoration keeps working when the user picks a different renderer.

| Hook | Kind | Status | Payload |
|---|---|---|---|
| `desktop-mode.dock.before-render` | action | Stable *(0.6.0)* | `DockRenderContext` — fires at start of every paint pass (initial mount + every `replaceItems`) |
| `desktop-mode.dock.tile-class` | filter | Stable *(0.6.0)* | `( classes: string[], ctx: DockTileContext ) → string[]` — order preserved |
| `desktop-mode.dock.tile-element` | filter | Stable *(0.6.0)* | `( el: HTMLElement, ctx: DockTileContext ) → HTMLElement` — wrap, don't replace; the shell still finds `[data-menu-slug]` / `[data-system-id]` descendants for active state |
| `desktop-mode.dock.tile-tooltip` | filter | Stable *(0.6.0)* | `( label: string, ctx: DockTileContext ) → string` — runs once at bind time; empty string suppresses the tooltip |
| `desktop-mode.dock.tile-rendered` | action | Stable *(0.6.0)* | `DockTileContext & { el: HTMLElement }` — fires once per tile after insertion (computed layout is ready) |
| `desktop-mode.dock.after-render` | action | Stable *(0.6.0)* | `DockRenderContext` with frozen `tileElements: ReadonlyMap<string, HTMLElement>` |
| `desktop-mode.dock.item-appended` | action | Stable *(0.5.0)* | `{ id }` — fires when `wp.desktop.registerSystemTile()` lands a tile |
| `desktop-mode.dock.item-removed` | action | Stable *(0.6.0)* | `{ id, placement }` — symmetric counterpart to `item-appended` |

**`DockHookContextBase`** (shared by both context types):

```typescript
{
    rail: 'dock' | 'taskbar';            // mirrors Dock.rail discriminator
    orientation: 'left' | 'right' | 'bottom';
    dockId: string;                       // host element id — disambiguates two-rail layouts
    container: HTMLElement;
}
```

**`DockTileContext`** (per-tile hooks): `DockHookContextBase` plus `{ item: DockItem | SystemDockItem; isSystem: boolean }`. `isSystem` is the discriminator for narrowing `item`.

**`DockRenderContext`** (bulk hooks): `DockHookContextBase` plus `{ items: DockItem[]; tileElements: ReadonlyMap<string, HTMLElement> }`. The map is read-only — mutating it desyncs the rail.

#### Iframe observability

Lifecycle + instrumentation for the chromeless iframe inside each window. Re-dispatched from `postMessage` payloads the iframe bridge forwards, so subscribers get a unified event stream without juggling the lower-level message bus themselves.

| Hook | Kind | Status | Payload |
|---|---|---|---|
| `desktop-mode.iframe.ready` | action | Stable | `{ windowId }` — fires once per iframe when the chromeless bridge script has attached its listeners. Use this instead of the iframe's `load` event when timing matters (the native `load` fires before our bridge attaches, so messages sent on `load` can miss the listener). |
| `desktop-mode.iframe.error` | action | Stable | `{ windowId, kind: 'error' \| 'unhandledrejection', message, filename, lineno, colno, stack }` — bridged from the iframe's `error` / `unhandledrejection` handlers. Cross-origin iframe errors are origin-filtered at the bridge and never reach this hook. |
| `desktop-mode.iframe.network-completed` | action | Stable | `{ windowId, method, url, status, duration, failed }` — every `fetch` + `XMLHttpRequest` call inside the iframe. `status === 0` indicates a network-level failure with no response received. |

Use `IFRAME_READY` when you need to send a `desktop-mode-focus` (or any parent→iframe message) as early as possible without racing the bridge setup. Use `IFRAME_ERROR` / `IFRAME_NETWORK_COMPLETED` to build a monitor widget that surfaces per-window reliability data.

#### Native-window lifecycle

These hooks fire only for native windows (`wp.desktop.registerWindow({ native: true, render })`). They let a plugin wrap or decorate another plugin's render output — e.g. injecting a consistent panel theme around every native window, or tagging the body for test automation.

| Hook | Kind | Status | Payload |
|---|---|---|---|
| `desktop-mode.native-window.before-render` | filter | Stable | body `HTMLElement`, context `{ windowId, config }` — return the same element or a new wrapper the plugin should render into |
| `desktop-mode.native-window.after-render` | action | Stable | `{ windowId, body, config }` — fires after the plugin's `render` callback has painted |
| `desktop-mode.native-window.before-close` | filter | Stable | `( proceed: boolean, ctx: { windowId, config } ) → boolean` — applied when a native window is about to start its close animation; return `false` to cancel the close (any other return, including `undefined`, lets it proceed). Does not apply to iframe windows. |

**Iframe windows have their own, separate pre-close guard** *(since 0.9.4)* — not this filter. Closing an iframe-backed window posts a `desktop-mode-bridge-beforeunload-query` into the iframe and waits (up to 500ms) for a response before destroying; if the page inside has unsaved changes (`window.onbeforeunload` or a `beforeunload` listener sets a message), the user sees a confirm dialog first. See [`bridge-protocol.md`](./bridge-protocol.md#pre-close-unsaved-changes-query--desktop-mode-bridge-beforeunload-) for the full message shape — there's no plugin-facing filter for this path, it's automatic for every iframe window.

#### Window body resize

| Hook | Kind | Status | Payload |
|---|---|---|---|
| `desktop-mode.window.body-resized` | action | Stable | `{ windowId, width, height }` — fires when the window body element's size actually changes (mount, resize, reflow). Coalesced by the underlying `ResizeObserver`; use this instead of polling from inside a native-window render. |

### Filter: `desktop-mode.wallpapers`

Receives the registered wallpaper list. Plugins can add entries, remove entries, or reorder — callback returns the (possibly modified) array.

```javascript
// Remove the 'aurora' preset from the picker grid.
wp.hooks.addFilter(
    'desktop-mode.wallpapers',
    'my-plugin/hide-aurora',
    ( list ) => list.filter( ( w ) => w.id !== 'aurora' )
);
```

In practice most plugins use the `wp.desktop.registerWallpaper()` convenience — internally it adds a filter callback under a namespace the shell generates for you, so the raw filter API is only needed for non-additive operations.

---

## 5. Wallpaper registration API

The shell ships a registry-driven wallpaper picker: every entry in the registry becomes a swatch in the OS Settings panel, and the WallpaperLayer resolves whichever is currently selected onto the desktop. Plugins register their own via `wp.desktop.registerWallpaper()` (or the `desktop-mode.wallpapers` filter).

Two shapes ship today: `css` (a static CSS background value) and `canvas` (a plugin-managed DOM subtree, typically a WebGL/2D canvas).

### Shape

```typescript
type WallpaperDef =
    | {
          type: 'css';
          id: string;
          label: string;
          preview: string;            // CSS `background` value for the swatch
          description?: string;       // Plain text, shown in OS Settings when selected (since 0.9.4)
          value?: string;             // Applied to --desktop-mode-bg
          resolveValue?: ( ctx: WallpaperContext ) => string;  // Dynamic alternative
          renderEditor?: WallpaperEditor;
          renderPreview?: WallpaperPreview;              // Live tile preview (since 0.9.5)
          previewParams?: Record<string, unknown>;       // Preview defaults (since 0.9.5)
          renderConfig?: WallpaperConfig;                // Settings dialog (since 0.9.5)
      }
    | {
          type: 'canvas';
          id: string;
          label: string;
          preview: string;            // CSS `background` for the swatch (pre-mount)
          description?: string;       // Plain text, shown in OS Settings when selected (since 0.9.4)
          mount: ( container: HTMLElement, ctx: WallpaperContext ) =>
                  ( () => void ) | Promise<() => void>;
          renderEditor?: WallpaperEditor;
          renderPreview?: WallpaperPreview;              // Live tile preview (since 0.9.5)
          previewParams?: Record<string, unknown>;       // Preview defaults (since 0.9.5)
          renderConfig?: WallpaperConfig;                // Settings dialog (since 0.9.5)
      };

interface WallpaperContext {
    id: string;
    pluginUrl: string;                // no trailing slash
    prefersReducedMotion: boolean;
    visible: boolean;                 // current document visibility
    settings: Record<string, unknown>; // persisted per-wallpaper settings (since 0.9.5)
}

// Passed to renderPreview (since 0.9.5).
interface WallpaperPreviewContext extends WallpaperContext {
    params: Record<string, unknown>;  // previewParams after the preview-params filter
    width: number;                    // tile content size in CSS px at mount time
    height: number;
}

type WallpaperPreview = ( container: HTMLElement, ctx: WallpaperPreviewContext ) =>
        ( () => void ) | Promise<() => void>;

// Passed to renderConfig (since 0.9.5).
interface WallpaperConfigContext extends WallpaperContext {
    setSettings( partial: Record<string, string | number | boolean> ): void;
}

type WallpaperConfig = ( container: HTMLElement, ctx: WallpaperConfigContext ) =>
        ( () => void ) | Promise<() => void>;
```

**`description`** — *Experimental (since 0.9.4).* A sentence or two shown in a styled card under the OS Settings picker grid whenever the wallpaper is the active selection: what it is, where its data comes from, the story behind it. Plain text only — it renders as text, never as HTML. Server-registered wallpapers can pass `description` to `desktop_mode_register_wallpaper()` instead; the shell overlays the server value onto the JS def when the def doesn't set one (handy for translatable descriptions).

### Minimal CSS wallpaper

```javascript
wp.desktop.ready( () => {
    wp.desktop.registerWallpaper( {
        id: 'my-plugin/ocean',
        label: 'Ocean',
        type: 'css',
        value: 'linear-gradient(180deg, #0ea5e9, #1e3a8a)',
        preview: 'linear-gradient(180deg, #0ea5e9, #1e3a8a)',
        description: 'Sea-surface blues fading into deep water.',
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

            return () => app.destroy( { removeView: true } );
        },
    } );
} );
```

Unknown module ids fail loudly via `desktop-mode.wallpaper.mount-failed` — no silent non-activations.

**Never call `app.destroy( true )`.** In PixiJS v8 a literal `true` as the first argument runs `releaseGlobalResources()`, which clears Pixi's *page-global* texture and object pools — corrupting every **other** live Application on the page (the OS Settings live previews, other canvas wallpapers, any plugin's Pixi window). Symptoms are crash loops in `Batcher.break()` and teardown throws in `TexturePool.returnTexture()`. Use `app.destroy( { removeView: true } )` — same canvas cleanup, no global wipe.

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

Canvas wallpapers receive `ctx.prefersReducedMotion` and should render a single static frame rather than starting an animation loop when it's true. The shell also fires `desktop-mode.wallpaper.visibility` on every `document.visibilitychange` so wallpapers can pause their tickers when the tab is backgrounded.

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

### `renderPreview` — live tile previews *(Experimental, since 0.9.5)*

Without `renderPreview`, a canvas wallpaper's swatch in the OS Settings picker is just its static CSS `preview` string — a flat gradient standing in for a living scene. With it, the picker mounts a live preview directly inside the tile.

The shell owns the lifecycle so previews stay cheap:

- **Lazy** — the preview mounts only when the tile is actually visible (IntersectionObserver), and tears down when the tile scrolls away, the settings tab is switched, or the panel closes. Every torn-down or failed state falls back to the CSS `preview` string.
- **Capped** — at most 4 live previews run concurrently (WebGL contexts are a scarce per-page resource, shared with the active wallpaper). Tiles beyond the cap keep the CSS fallback until a slot frees up.
- **Declared dependencies work** — the def's `needs: [...]` modules are loaded before `renderPreview` fires, exactly like `mount`.
- **Reduced motion is your job** — when `ctx.prefersReducedMotion` is true, render a still frame; don't start a ticker.

`ctx.params` is the parametrization hook: the def's `previewParams` seed, run through the `desktop-mode.wallpaper.preview-params` filter. Use it for anything the preview should idealize instead of mirroring the real site. The built-in Living Tree is the canonical case — its real mount grows the tree from the site's actual age and content, which on a day-old site is a bare sprout; its preview instead renders a showcase snapshot (`{ siteAgeDays: 540, totalPosts: 120, … }`) so the picker always shows what the wallpaper can become.

```javascript
wp.desktop.registerWallpaper( {
    id: 'my-plugin/starfield',
    label: 'Starfield',
    type: 'canvas',
    preview: '#050510',                       // instant paint + fallback
    needs: [ 'pixijs' ],
    previewParams: { starCount: 400 },        // preview-only knobs
    mount: async ( container, ctx ) => { /* the real thing */ },
    renderPreview: async ( container, ctx ) => {
        const app = new window.PIXI.Application();
        await app.init( { resizeTo: container, resolution: 1 } );
        container.appendChild( app.canvas );
        drawStars( app, Number( ctx.params.starCount ) || 400 );
        if ( ctx.prefersReducedMotion ) {
            app.render();                     // one still frame
            app.ticker.stop();
        }
        return () => app.destroy( { removeView: true } );
    },
} );
```

Overriding another wallpaper's preview parameters from a plugin (or a devtools console):

```javascript
// Preview the Living Tree as a brand-new site instead of the showcase.
wp.hooks.addFilter(
    'desktop-mode.wallpaper.preview-params',
    'my-plugin/sprout-preview',
    ( params, wallpaperId ) =>
        wallpaperId === 'wp-living-tree'
            ? { ...params, siteAgeDays: 0, totalPosts: 0 }
            : params
);
```

The same fields work on `type: 'css'` defs too (rarely needed — a CSS wallpaper's `preview` string usually IS the wallpaper).

### `renderConfig` — the wallpaper settings dialog *(Experimental, since 0.9.5)*

Wallpapers with real tunables (particle counts, palettes, physics) can ship a `renderConfig` callback. When the wallpaper is the active selection in OS Settings, a **"Wallpaper settings"** button appears below the picker grid; clicking it opens a `<wpd-modal>` whose body is handed to your callback. Wallpapers without `renderConfig` show no button — the surface is invisible unless you opt in.

Contrast with `renderEditor`: the editor is an always-visible inline panel below the grid (right for one or two controls the user plays with constantly, like the custom gradient's colours); `renderConfig` is a modal for a fuller settings form that would crowd the panel.

The shell owns everything except the form:

- **Chrome** — title (`<label> settings`), focus trap, ESC / click-outside, a Done button. Your callback renders only the controls, and returns a teardown (sync or via Promise) that runs when the dialog closes.
- **Persistence** — `ctx.setSettings( partial )` merges into the wallpaper's settings bag and saves through the normal OS Settings pipeline (localStorage + debounced user-meta sync, so values follow the user across devices). Scalar values only (`string | number | boolean`) — anything else is dropped by the server-side sanitizer. The bag round-trips through PHP capped at 64 wallpapers × 32 keys, strings at 256 chars.
- **Read-back** — every wallpaper context (`mount`, `renderPreview`, `renderEditor`, `renderConfig`) carries `ctx.settings`: the persisted bag, empty object when never configured. Treat the values as untrusted; clamp to your own defaults.
- **Live apply** — each `setSettings` fires the `desktop-mode.wallpaper.settings-changed` action with `{ id, settings }` (the full post-merge bag). A mounted wallpaper subscribes and applies the change in place — no remount, so the dialog behaves as a live tuning panel.

```javascript
window.desktopModeWallpapers[ 'my-plugin/aquarium' ] = {
    id: 'my-plugin/aquarium',
    label: 'Aquarium',
    type: 'canvas',
    preview: '#03252e',
    needs: [ 'pixijs' ],

    mount: async ( container, ctx ) => {
        const fishCount = Number( ctx.settings.fishCount ) || 12;
        const scene = await buildScene( container, fishCount );

        const onSettings = ( detail ) => {
            if ( detail?.id !== 'my-plugin/aquarium' ) {
                return;
            }
            scene.setFishCount( Number( detail.settings.fishCount ) || 12 );
        };
        wp.hooks.addAction(
            'desktop-mode.wallpaper.settings-changed',
            'my-plugin/aquarium-live',
            onSettings
        );
        return () => {
            wp.hooks.removeAction(
                'desktop-mode.wallpaper.settings-changed',
                'my-plugin/aquarium-live'
            );
            scene.destroy();
        };
    },

    renderConfig: ( container, ctx ) => {
        const field = document.createElement( 'wpd-range-field' );
        field.setAttribute( 'label', 'Fish' );
        field.setAttribute( 'min', '1' );
        field.setAttribute( 'max', '60' );
        field.setAttribute( 'value', String( Number( ctx.settings.fishCount ) || 12 ) );
        field.addEventListener( 'wpd-range-change', ( e ) => {
            ctx.setSettings( { fishCount: e.detail.value } );   // persists + fires the action
        } );
        container.appendChild( field );
        return () => {};
    },
};
```

The built-in Snow wallpaper (`src/plugins/snow-wallpaper/`) is the canonical in-tree consumer — wind, snowflake count, flake size, and backdrop colour, all applied live.

### `window.wp.desktop` members

| Member | Status | Notes |
|---|---|---|
| `windowManager` | Stable | WindowManager instance |
| `dock` | Stable | Dock instance (null if no dock element) |
| `saveSession()` | Stable | Force a session write |
| `hooks` | Stable | Alias of `window.wp.hooks` |
| `isActive()` | Stable | `true` when the desktop shell is mounted and active on this page. Cheap capability check for plugins that also run in classic admin — branch desktop-vs-classic without probing the DOM yourself. |
| `sideDock` | Stable | Classic-layout left-edge Dock instance hosting core admin menus (null in Unified / Spatial layouts) |
| `registerWallpaper( def )` | Stable | Add a wallpaper to the registry + re-apply |
| `registerWidget( def )` | Stable | Add a widget to the registry |
| `registerSystemTile( item )` | Stable | Add a JS-owned launcher tile to the bottom dock rail, alongside plugin admin menus. Returns nothing; fires `desktop-mode.dock.item-appended`. See "System tiles" below. |
| `loadVendorScript( url )` | Stable | Memoized `<script>` injector. Low-level; most plugins use `needs` instead. |
| `getWallpaperSurfaces()` | Stable | Live `WallpaperSurface[]` for collision-aware wallpapers. See "Wallpaper surfaces" below. |
| `registerModule( def )` | Stable | Register a shared vendor library under a stable id. |
| `loadModules( ids )` | Stable | Imperatively load registered modules. Usually unnecessary — canvas wallpapers declare `needs[]` and the shell resolves. |
| `ready( cb )` | Stable *(since 0.5.1)* | **Recommended bootstrap entry point.** Run `cb` after `desktop-mode.init` has fired — immediately (via microtask) if it already fired, queued otherwise. Safe for scripts loaded at any point in the lifecycle, including server-sync-injected plugin scripts. Short alias of `whenReady( cb )`. |
| `whenReady( cb )` | Stable | Original name for `ready( cb )` — same behaviour; keep using it if you've already adopted it. |
| `isReady()` | Stable | Synchronous boolean — has `desktop-mode.init` fired yet. Branch between "register directly" and "schedule via `ready`" without racing. |
| `refreshMenu()` | Stable | Force a refresh of the live admin-menu split. Auto-fired on plugin activation / deactivation, and (since 0.9.4) whenever a chromeless page reports a [`desktop-mode-menu-signature`](#desktop-mode-menu-signature--stable-since-094) that differs from the shell's last-known value — so a custom post type added via a settings tool surfaces without a browser reload (GH#325). Manual calls spawn a hidden iframe at `admin.php?desktop_mode_chromeless=1&desktop_mode_menu_refresh=1` whose server-side handler short-circuits the response with the fresh menu payload (a `<script>` that postMessages `desktop-mode-plugins-changed`) without rendering admin-header / admin-footer — resolves in milliseconds. The full chromeless bridge still emits the same payload when the iframe lands on a real admin page (`plugins.php` etc.). |
| `setDefaultWindow( url \| null )` | Stable | Update the user's "open on startup" preference (`null` clears it). Async — persists through the REST endpoint; on success updates `config.defaultWindow` in place and dispatches the [`desktop-mode-default-window-changed`](#desktop-mode-default-window-changed--stable-since-070) CustomEvent on `document`. |
| `openNewWindow( id, opts? )` | Stable *(since 0.8.3)* | Spawn a brand-new instance of a registered native window, even when one is already open. See [`wp.desktop.openNewWindow`](#wpdesktopopennewwindow-id-opts---stable-since-083). |
| `cloneTemplate( templateOrId )` | Stable | Clone a `<template>` element's contents into a fresh `DocumentFragment`. Accepts the element's DOM id or the element itself; throws if the reference doesn't resolve to a template. `desktop_mode_register_window()` plugins don't need it — the shell pre-clones the declared template into the window body — it's for advanced re-cloning / custom hydration. |
| `createInfiniteList( options )` | Stable *(since 0.8.2)* | Infinite-scroll renderer: sentinel-driven `IntersectionObserver`, abortable in-flight pages, dedup-by-id, cursor pagination. Full recipe: [`docs/examples/infinite-list.md`](./examples/infinite-list.md). |
| `startOAuth( service, options? )` | Stable *(since 0.8.2)* | Start the OAuth relay flow for a service declared via PHP `desktop_mode_register_oauth_relay()`. Resolves with the success payload, rejects with a tagged Error on failure. Full recipe: [`docs/examples/oauth-relay.md`](./examples/oauth-relay.md). |
| `getOsSettings()` | Stable | Defensive copy of the persisted OS Settings snapshot — same shape a settings tab's `ctx.getOsSettings()` returns. |
| `subscribeOsSettings( cb )` | Stable | Subscribe to OS Settings changes; returns an unsubscribe function. Mirrors the settings-tab `ctx.subscribeOsSettings` API. |
| `updateOsSettings( patch, opts? )` | Stable *(since 0.7.2)* | Patch + persist the OS Settings state (whitelisted keys only). See [`updateOsSettings`](#updateossettings-patch-opts---stable-since-072). |
| `config` | Stable | The `DesktopConfig` that booted the shell. Notable read-only fields plugins reach for: `pluginUrl` (no trailing slash) and `pluginVersion` (the active plugin semver — surfaced in OS Settings → About; useful for version-gated features); `stickyNotes.available` (boolean, since 0.9.1 — whether Gutenberg's Guidelines experiment is registered, so the sticky-notes layer only boots when its REST routes exist); `notesUrl` (string, since 0.9.6 — REST base for the pinned-notes controller at `/desktop-mode/v1/notes`; the notes layer only boots when present); `canCreatePosts` (boolean, since 0.9.6 — whether the current user has `edit_posts`, gating the note "Convert to post" affordances). Filterable server-side via `desktop_mode_shell_config`. |

### System tiles

A **system tile** is a JS-owned launcher that isn't part of the admin menu — Jorvy, a plugin's native-window quick tool, a custom shortcut. The shell appends these to the **bottom dock rail** (the macOS-style pill, alongside installed-plugin admin menus) via the layout dispatcher, so the tile re-attaches automatically after a layout rebuild.

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
} );
```

`registerSystemTile( item )` takes the tile definition only — there is no placement parameter and no return value. Every registration fires the `desktop-mode.dock.item-appended` action with `{ id }`.

**Why the bottom rail:** plugin-contributed admin menus live in the bottom pill already (see `desktop_mode_dock_placement`). Putting plugin-contributed shell launchers next to them keeps "everything plugin" in one place and keeps the left rail focused on core WP.

---

### Wallpaper surfaces

Collision-aware wallpapers (snow, rain, leaves, particle effects) need to know where things can "land" — window tops, the desktop floor, each dock's desktop-facing edge, widget cards. Rather than having every wallpaper hand-query the shell's DOM + hope the class names don't move, the shell emits a live surface list through `wp.desktop.getWallpaperSurfaces()`.

```typescript
interface WallpaperSurface {
    id: string;             // 'window:foo', 'shell:floor', 'dock:edge', 'widget:clock', or plugin-supplied
    kind: 'window' | 'shell' | 'dock' | 'widget' | 'custom';
    rect: { x: number; y: number; width: number; height: number };  // viewport coordinates
    face: 'top' | 'bottom' | 'left' | 'right';  // which edge is solid
    element: HTMLElement | null;                // null for synthetic surfaces
}
```

**Shell-seeded surfaces** (the baseline, before the filter runs):

- `window:<id>` — every non-minimized window's top edge (`face: 'top'`), one per window.
- `shell:floor` — bottom edge of the shell container.
- `dock:edge` — a 1px strip along whichever edge of each live dock faces the desktop area (top edge for the bottom pill, inline edge for side rails); additional simultaneous docks get `dock:edge:<n>`.
- `widget:<id>` — top edge of every mounted widget card.

**Adding a custom surface.** Plugins that own floating DOM use the `desktop-mode.wallpaper.surfaces` filter:

```javascript
wp.hooks.addFilter(
    'desktop-mode.wallpaper.surfaces',
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

Call it each frame (or throttled — the function is cheap but it does walk the DOM). Rects are in viewport coordinates so a canvas mounted inside `#desktop-mode-wallpaper` can translate to its own drawing space using the wallpaper element's own `getBoundingClientRect()`.

**Pair with `desktop-mode.window.bounds-changed`.** During a drag or resize the shell fires `bounds-changed` once per animation frame with the live `{ x, y, width, height }`. Subscribe there to invalidate your surface cache instead of polling `getBoundingClientRect()` each tick.

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

The shell polls `GET /desktop-mode/v1/debug?sessionId=…&since=…` every 1 s while at least one subscription is active for the session, and stops polling when the last subscription disposes.

### `Window.config.ownerHandle` — Experimental

The script handle of the plugin that registered a native window. Read for attribution:

```js
wp.desktop.registerTitleBarButton( {
    id: 'sql-inspector/attach',
    match: ( win ) => !! win.config.ownerHandle,
    // ...
} );
```

Always populated for windows registered via PHP `desktop_mode_register_window( $args )` (carries `$args['script']`); undefined for iframe windows backed by a core admin page.

### postMessage protocol additions

| Type | Direction | Payload |
|---|---|---|
| `desktop-mode-instrument-set` | parent → iframe | `{ headers: { name: value, … }, observe: boolean }`. Replaces the iframe's instrumentation slot wholesale on every change. |
| `desktop-mode-iframe-network` | iframe → parent | Existing payload + optional `requestHeaders`, `responseHeaders` when the parent has set `observe: true`. |

See [`docs/examples/devtools-instrumentation.md`](./examples/devtools-instrumentation.md) for a complete worked example.

---

## Window attention API

**Stable** — shipped 0.6.0. See
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

`Window.requestAttention()` fans the request out to every rail that
exposes a `setAttention()` function (`wp.desktop.dock` in a normal
shell) and counts the request as routed when the rail API exists —
a rail that doesn't host a tile for this window silently no-ops.
The `setHighlight('persistent')` fallback (auto-cleared after
`durationMs`) only fires when **no** rail API is present at all, so
windows without a rail tile (`placement: 'none'`) get no visual
fallback while a dock is mounted.

JS filter: `desktop-mode.window.attention( mode, { windowId, opts } )`
— return `null` to mute the request (Do Not Disturb integration).

All three rails (`dock`, `sideDock`, `icons`) emit on the
activity bus channel `desktop-mode/badge-changed` with payload
`{ itemId, count, rail }`. The icon rail also fires
`HOOKS.ICON_BADGE_CHANGED` on the hook bus with
`{ iconId, count, previousCount }` for callers that only care
about the icon surface.

## `wp.desktop.icons` — the wallpaper-icon rail *(since 0.6.0)*

**Stable.** Third badge surface, sibling of `wp.desktop.dock`
and `wp.desktop.sideDock`. Same `setBadge( id, count )` shape, so
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
wp.desktop.icons.setBadge(   'desktop-mode-messages', 5 );
wp.desktop.icons.clearBadge( 'desktop-mode-messages' );
wp.desktop.icons.getBadge(   'desktop-mode-messages' ); // → 0 (after clear)
```

- **Idempotent.** Same count twice = no DOM mutation, no re-emit.
- **Silent no-op when the id isn't on the rail.** Lets the
  fan-to-all-rails pattern work without triple-emitting.
- **Survives a full grid rebuild.** The framework persists the
  badge across plugin activations / live menu refreshes — set
  once, the renderer re-paints from internal state.
- **`>99` renders as `99+`** so the pill stays compact.

Every applied change publishes on:

- `desktop-mode/badge-changed` activity channel with
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

## `<wpd-avatar>` — Stable (0.6.0)

```html
<wpd-avatar
    src="https://…/me.jpg"
    name="Daniel López"
    size="40"               <!-- px or 'xs' | 'sm' | 'md' | 'lg' | 'xl' -->
    presence="online"       <!-- 'online' | 'inactive' | 'offline' -->
    user-id="42"            <!-- auto-subscribes to desktop-mode-presence-changed -->
></wpd-avatar>
```

Falls back to a deterministic-hue letter tile when `src` is empty
or fails to load. Emits `wpd-avatar-click` `{ userId: number | null }`
when the `clickable` boolean attribute is set; without it the tile
is decorative and clicks pass through to the surrounding row.

## `<wpd-textarea>` — Stable (0.6.0)

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

// Window notices — Experimental (since 0.6.0). See subsection below.
wp.desktop.registerWindowNotice( entry );
wp.desktop.unregisterWindowNotice( id );
wp.desktop.listWindowNotices();
wp.desktop.dismissWindowNotice( id );
wp.desktop.undismissWindowNotice( id );
```

### Window notices — Experimental *(since 0.6.0)*

Tone-coded banners pinned to the top of any matching window. The
shell renders each entry as a `<wpd-notice>` web component inside
the matching window's `after-titlebar` slot host, and each user's
dismissal of a given `id` is persisted in `localStorage` under
`desktop-mode-notice-dismissed:<userId>` so the banner never
reappears for them.

```ts
type WindowNoticeTone =
    | 'info' | 'success' | 'warning' | 'error' | 'danger' | 'neutral';

interface WindowNoticeEntry {
    id: string;                              // persistence + dedupe key — recommend `<plugin>/<slug>`
    message: string;                         // HTML; links + inline formatting allowed. Treat as trusted.
    tone?: WindowNoticeTone;                 // default 'info'
    dismissible?: boolean;                   // default true
    icon?: string;                           // dashicons class (e.g. 'dashicons-info')
    match?: ( win: Window ) => boolean;      // default: every window
    order?: number;                          // default 100. Lower renders higher in a stack.
    owner?: string;                          // tag for bulk teardown
}

wp.desktop.registerWindowNotice( entry );   // returns an unregister fn
wp.desktop.unregisterWindowNotice( id );
wp.desktop.listWindowNotices();              // snapshot, sorted by (order, id)
wp.desktop.dismissWindowNotice( id );        // imperative dismiss (writes localStorage)
wp.desktop.undismissWindowNotice( id );      // clear a prior dismissal
```

`message` is written via `innerHTML` on the client. Include only
content you author; if you must include user-supplied data, run it
through an HTML sanitizer first. PHP-registered notices are passed
through `wp_kses_post()` automatically — see
[`docs/examples/window-notice.md`](examples/window-notice.md).

`match` runs once per window-paint and any throw is treated as
"don't render this notice on this window."

Persistence key layout:

| Key | Shape | Notes |
|-----|-------|-------|
| `desktop-mode-notice-dismissed:<userId>` | `Record< noticeId, true >` (JSON) | Falls back to `…:anon` for logged-out / pre-hydration. |

### JS hooks (under `wp.hooks` / `addFilter`-`addAction`)

| Name | Type | Status | Notes |
|------|------|--------|-------|
| `desktop-mode.window.chrome.theme` | filter | Stable | Mutate the resolved CSS-variable map per window. |
| `desktop-mode.window.chrome.theme-changed` | action | Stable | Fires after each successful theme apply. |
| `desktop-mode.window.chrome.controls` | filter | Stable | Mutate the resolved per-placement control list. |
| `desktop-mode.window.chrome.slot` | filter | Stable | Mutate the host element of each slot after content settles. |
| `desktop-mode.window.chrome.render` | filter | Experimental | Mutate the chrome id selected for a window. |
| `desktop-mode.window.chrome.applied` | action | Stable | Fires per layer after a paint completes. `layer` is `'controls' \| 'slots' \| 'chrome'`. |

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
{ type: 'desktop-mode-chrome-theme',    tokens: Record< string, string > }
{ type: 'desktop-mode-chrome-controls', config: WindowControlsConfig }
{ type: 'desktop-mode-chrome-slot',     slot: string, html: string }
```

Each is origin-gated to the parent shell's origin and source-gated to the matching window's iframe `contentWindow`.

---

## Progressive Web App (since 0.8.0)

`wp.desktop.notify( opts )` is the public surface for local
notifications. v1 uses the browser `Notification` API directly with a
toast fallback when permission is denied; v2 will route the same call
through the SW for push.

```ts
wp.desktop.notify( {
    title: 'Build complete',
    body: '12 files updated.',
    icon: '/favicon.png',
    tag: 'my-plugin/build',          // collapse repeat alerts
    requireInteraction: false,
    onClick: ( n ) => { window.focus(); n.close(); },
} ); // returns a dismiss callback
```

Routes through the activity-bus filter
`desktop-mode/notification-requested` (return `cancel: true` to
suppress) and broadcasts on `desktop-mode/notification-shown` after
rendering.

### `wp.desktop.pwa.*` — programmatic install + permission control

```ts
wp.desktop.pwa.promptInstall();
//   Promise<'accepted' | 'dismissed' | 'unavailable'>

wp.desktop.pwa.requestNotificationPermission();
//   Promise<'granted' | 'denied' | 'default' | 'unsupported'>

wp.desktop.pwa.getNotificationPermission();
//   'granted' | 'denied' | 'default' | 'unsupported'

wp.desktop.pwa.getState();
//   { installHintDismissed: boolean, notificationsEnabled: boolean }

const off = wp.desktop.pwa.subscribe( ( s ) => { /* ... */ } );

wp.desktop.pwa.undismissInstallHint();
//   Re-surface the floating install pill after the user dismissed it.
```

See [`docs/pwa.md`](./pwa.md) for the full architecture and
[`docs/examples/pwa-install.md`](./examples/pwa-install.md) /
[`docs/examples/notify.md`](./examples/notify.md) for recipes.

---

## `wp.desktop.files` — the Files-on-the-Desktop registry *(Experimental, since 0.9.0)*

Mirror of the PHP file-type registry on the JS side. Plugin authors use it to register custom file types and to resolve serialized shapes into `DesktopFile` instances at render time. The full surface, motivation, and PHP side are documented in [files-on-desktop.md](./files-on-desktop.md).

```ts
interface DesktopFileShape {
    type: string;
    ref: string;
    title: string;
    icon: string;
    previewUrl: string;
    exists: boolean;
    [ key: string ]: unknown; // subclass-specific extras
}

interface DesktopFileTypeDef {
    type: string;
    label: string;
    sort: number;
    DesktopFile?: new ( shape: DesktopFileShape ) => DesktopFile;
}

abstract class DesktopFile {
    readonly shape: DesktopFileShape;
    abstract type(): string;
    title(): string;       // defaults to shape.title
    icon(): string;        // defaults to shape.icon
    previewUrl(): string;  // defaults to shape.previewUrl
    ref(): string;
    exists(): boolean;
}

interface FilesApi {
    DesktopFile: typeof DesktopFile;
    registerType( def: DesktopFileTypeDef ): void;
    unregisterType( type: string ): void;
    getType( type: string ): DesktopFileTypeDef | null;
    getTypes(): DesktopFileTypeDef[];
    resolve( shape: DesktopFileShape ): DesktopFile;
    subscribe( cb: () => void ): () => void;
}
```

The ten built-in types (`shortcut`, `folder`, `post`, `attachment`, `user`, `term`, `comment`, `bookmark`, `link`, `embed`) register themselves on bundle boot. Late registrations win — registering the same slug twice overwrites the entry. When a `DesktopFile` subclass isn't registered for a slug, `resolve()` falls back to a `DefaultDesktopFile` that just exposes the shape verbatim — so a placement for a deactivated plugin still renders something.

### Placement shape — viewer-scoped extras *(since 0.8.5)*

Every `RestPlacementShape` carries two viewer-scoped flags the server computes per request from the file-type and share state:

```ts
interface RestPlacementShape {
    id: number;
    parentId: number;
    x: number;
    y: number;
    sortOrder: number;
    updatedAtMs: number;
    meta: Record< string, unknown > | null;
    file: DesktopFileShape;
    /**
     * True when the viewer is allowed to see this placement (because
     * the owner shared the parent folder) but doesn't have read
     * access on the underlying entity. The tile renderer paints a
     * lock overlay + tooltip; dblclick shows an "access denied"
     * toast instead of routing to the opener. Default falsy.
     *
     * When true, the server redacts the accompanying `file` shape —
     * the entity resolver is skipped so no entity metadata crosses
     * the read-access boundary. Only `type` and `ref` carry through
     * from the placement row; `title` is the generic localized
     * "Restricted item", `icon` is `'dashicons-lock'`, `previewUrl`
     * is `''`, and `exists` is `true`.
     */
    accessGated?: boolean;
    /**
     * Server's answer to "may the current viewer trash this
     * placement?". Drives two client-side gates so the user never
     * sees an action they can't complete:
     *   - layer.ts hides "Move to Trash" / "Move folder to Trash"
     *     from the tile right-click menu when `=== false`.
     *   - recycle-bin-targets.ts makes the bin drop target reject
     *     the drag when `=== false`.
     * Falsy for read-only recipients of a shared folder, for any
     * non-owner's root-placement of a shared folder (use "Leave
     * shared folder" instead), and anything a `desktop_mode_files_user_can_trash_placement`
     * filter customisation has vetoed. `undefined` (legacy
     * payloads) falls through to existing REST-403 behavior.
     */
    canTrash?: boolean;
}
```

Plugin authors building custom tile renderers should respect these flags. The drop-target convention is to gate `accept` on `canTrash !== false` so the indicator never lights up for a placement the server will reject:

```ts
dragManager.registerDropTarget( {
    id: 'my-plugin/destructive-drop',
    element: targetEl,
    accept: ( payload ) => {
        if ( payload.type !== 'desktop-file' ) return false;
        const placement = ( payload.data as { placement?: RestPlacementShape } ).placement;
        return placement?.canTrash !== false;
    },
    onDrop: ( session ) => { /* … */ },
} );
```

### `desktop-mode.files.types` filter

```ts
applyFilters( 'desktop-mode.files.types', list: DesktopFileTypeDef[] ): DesktopFileTypeDef[];
```

Plugins reorder, hide, or swap entries here.

### `desktop-mode.files.type-registered` / `type-unregistered` actions

```ts
doAction( 'desktop-mode.files.type-registered', type: string, def: DesktopFileTypeDef );
doAction( 'desktop-mode.files.type-unregistered', type: string );
```

### Openers — file-association layer *(since 0.9.0)*

```ts
type OpenerHandler =
    | { kind: 'url'; url: ( file: DesktopFile ) => string | Promise< string >; windowId?: ( file ) => string; title?: ( file ) => string }
    | { kind: 'window'; windowId: string; config?: ( file: DesktopFile ) => unknown }
    | { kind: 'js'; open: ( file: DesktopFile ) => void | Promise< void > };

interface FileOpenerDef {
    id: string;
    label: string;
    types: string[];
    isDefault?: boolean;
    sort?: number;
    handler: OpenerHandler;
}
```

Methods on `wp.desktop.files`:

```ts
registerOpener( def: FileOpenerDef ): void;
unregisterOpener( id: string ): void;
getOpener( id: string ): FileOpenerDef | null;
getOpeners(): FileOpenerDef[];
getOpenersForType( type: string ): FileOpenerDef[];
resolveOpener( type: string ): FileOpenerDef | null;
subscribeOpeners( cb: () => void ): () => void;
getUserAssociations(): Record< string, string >;
open( file: DesktopFile ): Promise< boolean >;
```

Resolution chain inside `resolveOpener`: user override (read from `userFileAssociations` in the shell config) → `isDefault` opener → first match → `null`. The result passes through the `desktop-mode.files.resolve-opener` filter.

`open( file )` invokes the resolved opener's handler:
- `kind: 'url'` → opens a chromeless iframe via `wp.desktop.windowManager.open`.
- `kind: 'window'` → opens a registered native window via `wp.desktop.openWindow`. The optional `config( file )` callback is currently **not delivered** to the window — the shell's opener wiring drops the computed value, so `wp.desktop.getWindowConfig( windowId )` keeps returning only the PHP-registered config blob. Don't rely on per-file config until this gap is closed.
- `kind: 'js'` → runs the plugin's free-form callback.

Lifecycle actions fired during `open()`:

```ts
doAction( 'desktop-mode.files.opening', { file: DesktopFile, openerId: string } );
doAction( 'desktop-mode.files.opened',  { file, openerId, kind: 'url' | 'window' | 'js' } );
doAction( 'desktop-mode.files.open-failed', { reason: 'no-opener' | 'handler-threw', type, ref, openerId?, error? } );
```

Filter for the registry list:

```ts
applyFilters( 'desktop-mode.files.openers', FileOpenerDef[] ): FileOpenerDef[];
applyFilters( 'desktop-mode.files.resolve-opener', FileOpenerDef | null, type: string ): FileOpenerDef | null;
```

---

## Native Plugins window (since 0.9.0)

The `desktop-mode-plugins` native window replaces the chromeless `plugins.php` and `plugin-install.php` iframes. Two tabs (Installed + Browse), a `<wpd-flyout>` detail panel, .zip upload (button + drop-on-window), and drag-card-to-dock pinning via the framework drag bridge.

### URL routing

Both `plugins.php` and `plugin-install.php` are claimed by `registerNativeUrlRemap`. The latter stashes a `tab: 'browse'` hint in the shared store `'desktop-mode/plugins-window/tab-target'` so the bundle's first paint activates the Browse tab. When `nativePluginsEnabled` is `false`, the click falls through to the classic iframe path.

### Drag bridge integration

Cards in the Browse gallery call `wp.desktop.dragManager.start({ … })` on pointer-down. The payload is:

```ts
{
  type: 'wporg-plugin',
  source: HTMLElement,
  data: {
    slug: string,
    name: string,
    iconUrl: string | null,
    homepage: string,
    authorName: string,
    shortDescription: string,
  },
  ghost: { offsetX: number, offsetY: number, element: HTMLElement },
}
```

The bundle pre-installs a drop target on the dock element that accepts this payload type and calls `wp.desktop.registerSystemTile()` to pin a transient tile pointing at the plugin's wp.org page. **Plugin authors can register their own drop targets** (e.g. on a custom canvas) that filter on `payload.type === 'wporg-plugin'` and react to a card drop with no further coordination.

### Live-refresh

After every install / activate / deactivate / delete the bundle calls `await wp.desktop.refreshMenu()`. That spawns a hidden chromeless iframe to capture the real-admin-context menu payload (handles plugins that gate `admin_menu` on `is_admin()`) — same primitive the chromeless bridge uses. Plugin authors that mutate plugin state from elsewhere should mirror this:

```ts
await myInstallFlow();
await window.wp.desktop.refreshMenu();
```

### Shared state — initial tab hint

```ts
import { setPluginsWindowTab } from 'desktop-mode/plugins-window/tab-target';

setPluginsWindowTab( 'browse' ); // call BEFORE openById( 'desktop-mode-plugins' )
```

Backed by `wp.desktop.createSharedStore( 'desktop-mode/plugins-window/tab-target', … )` so multiple bundles see the same value.

---

## My WordPress — extensibility surface (Experimental, since 0.8.0)

The native window registered under id `desktop-mode-my-wordpress`
exposes three JS hook points and a small public API. Every section
(Posts, Pages, Users, Media, plugin-defined kinds) uses the same
hooks, so a single plugin descriptor can decorate any preview pane.

### Public API — `wp.desktop.myWordpress`

```ts
interface MyWordpressApi {
    /**
     * Open the post-detail dossier for a given post id. Idempotent
     * — opens the window first if it isn't already.
     */
    openDetail( args: { entityId: string; postId: number; postTitle: string } ): void;

    /**
     * Open the Media drill-in ("used in") view for an attachment.
     * Mirror of `openDetail`.
     *
     * @since 0.8.6
     */
    openMedia( args: { mediaId: number; mediaTitle?: string } ): void;

    /**
     * Open a user's GitHub-style activity footprint. Mirror of
     * `openDetail` / `openMedia`, for users. Idempotent and
     * cold-start safe — opens (or focuses) the window and navigates
     * it to the footprint route even from a session that never
     * opened My WordPress.
     *
     * This is the same window the "View activity footprint" row
     * action in the classic Users table reaches (that path routes
     * through the `desktop-mode-open-user-footprint` bridge message;
     * see § 3 and `bridge-protocol.md`).
     *
     * @since 0.9.1
     */
    openUserFootprint( args: { userId: number; userName?: string } ): void;

    /**
     * Register a renderer for a custom entity kind so a plugin
     * can ship its own section type without patching the bundle.
     * Pair with a PHP entry in `desktop_mode_my_wordpress_entities`
     * carrying the same `kind` slug.
     *
     * Returns an unregister function.
     *
     * @since 0.8.6
     */
    registerEntityKind(
        kind: string,
        renderer: ( host: EntityRenderHost, entity: MyWordPressEntity ) => void,
    ): () => void;

    /**
     * Trash an entity by its My WordPress entity id (`'posts'`,
     * `'pages'`, `'users'`, plugin-defined). Resolves when the
     * REST DELETE succeeds and broadcasts
     * `desktop-mode-my-wordpress-entity-trashed` on `document`
     * so every live list view drops the tile reactively.
     *
     * Does NOT show a confirm dialog — that UX layer is the
     * caller's responsibility. The right-click "Move to Trash"
     * menu wraps this with its own confirm; the recycle-bin
     * drag-to-trash calls it directly (macOS pattern: the drag
     * is the deliberate gesture, no extra confirm).
     *
     * @since 0.8.9
     */
    trashEntity( entityId: string, id: number ): Promise< void >;
}
```

`EntityRenderHost` surfaces just enough state to paint and navigate:

```ts
interface EntityRenderHost {
    body: HTMLElement;
    route: Route;
    navigate( route: Route ): void;
    addTeardown( fn: () => void ): void;
}
```

### Filter — `desktop-mode.my-wordpress.preview-actions`

Decorate the right-pane action button row. Receives the
server-declared descriptors (already capability-gated) merged with
any client-only entries the filter chain has added on prior calls.
Wire the `onSelect` handler here — server descriptors only carry
metadata.

```ts
wp.hooks.addFilter(
    'desktop-mode.my-wordpress.preview-actions',
    'my-plugin/compress',
    ( actions, ctx ) =>
        actions.map( ( a ) =>
            a.id === 'my-plugin/compress-image'
                ? { ...a, onSelect: ( c ) => { /* run */ } }
                : a,
        ),
);
```

Context shape: `{ entityId, kind, mime?, item }`. `item` is the
raw server record (a `MediaListItem`, post `EntityListItem`, etc.).

### Action — `desktop-mode.my-wordpress.preview-extras`

Inject DOM into named slots on the right pane (`'header' | 'meta'
| 'footer'`). Fires once per slot per preview render.

```ts
wp.hooks.addAction(
    'desktop-mode.my-wordpress.preview-extras',
    'my-plugin/footer',
    ( ctx ) => {
        if ( ctx.slot === 'footer' ) {
            const badge = document.createElement( 'span' );
            badge.textContent = '✓ checked';
            ctx.container.appendChild( badge );
        }
    },
);
```

### Filter — `desktop-mode.my-wordpress.tile-context-menu`

Decorate the per-tile right-click menu. Same descriptor shape as
the preview-actions row; plugin entries must carry an `onSelect`
handler (built-ins are dispatched by the bundle's static switch).

```ts
wp.hooks.addFilter(
    'desktop-mode.my-wordpress.tile-context-menu',
    'my-plugin/duplicate',
    ( options, ctx ) => {
        options.push( {
            id: 'my-plugin/duplicate',
            label: 'Duplicate',
            icon: 'dashicons-admin-page',
            onSelect: () => duplicatePost( ctx.item.id ),
        } );
        return options;
    },
);
```

Context: `{ entityId, kind, item }`. Currently wired on the post /
page tile menu (`kind` from the entity, default `'post'`) and the
media tile menu (`kind: 'attachment'`); the user tile menu will
subscribe to the same hook in a follow-up — write the filter as if
the hook fires for every section.

### Filter — `desktop-mode.my-wordpress.status-bar` (existing)

Already documented above — unchanged.

### postMessage / CustomEvents

No new postMessage types. Media drag-out uses the existing
`'shortcut'` drag payload with `data.kind === 'attachment'`.

One CustomEvent:

#### `desktop-mode-my-wordpress-entity-trashed` — Experimental *(since 0.8.9)*

Dispatched on `document` after a
`wp.desktop.myWordpress.trashEntity()` REST DELETE succeeds —
the recycle-bin drag-to-trash routes through it, as does any
plugin calling the method directly. Live list views (any
bundle) listen here to drop the trashed tile reactively.

**`detail` shape:**

```typescript
{ entityId: string, id: number }
```

See [Examples — My WordPress media action](./examples/my-wordpress-media-action.md).

---

## Nonce refresh — heartbeat field *(Stable, since 0.8.7)*

WordPress nonces expire after `nonce_life` (24 h by default). The
desktop shell is a long-running SPA, so cached nonces stamped
into `window.desktopModeConfig.restNonce` (auto-injected by
`injectRestNonce`) and per-window config blobs like
`window.desktopModeWindowConfig['desktop-mode-plugins']` would
otherwise go stale after a day. The server's
`heartbeat_received` filter (see
[`desktop_mode_nonce_refresh_actions`](./hooks-reference.md#desktop_mode_nonce_refresh_actions--stable-filter-since-087))
ships a fresh `{ action: nonce }` map on every tick under the
`desktop_mode_nonces` heartbeat field; the framework overwrites
its own cached values in place. Defaults cover `wp_rest`,
`desktop-mode-plugins`, and `updates`.

**Out of the box**: the shell-wide `restNonce` and every
per-window blob's `restNonce` are refreshed automatically — most
plugin authors don't need to wire anything by hand.

**For plugins that ship their own cached nonce** (an admin-ajax
nonce keyed by a custom action, a private REST nonce, …): publish
the action on PHP via
[`desktop_mode_nonce_refresh_actions`](./hooks-reference.md#desktop_mode_nonce_refresh_actions--stable-filter-since-087),
then subscribe to the heartbeat field and read the action key off
the returned map:

```ts
wp.desktop.heartbeat.subscribe( 'desktop_mode_nonces', ( nonces ) => {
    const fresh = nonces[ 'my-plugin/admin-ajax' ];
    if ( typeof fresh === 'string' && fresh !== '' ) {
        window.myPluginConfig.ajaxNonce = fresh;
    }
} );
```

The same heartbeat surface (`wp.desktop.heartbeat.subscribe` /
`.contribute`) is already used for presence, recycle-bin badges,
files realtime, etc. — see the
[heartbeat bus](#heartbeat--stable-since-055) section for the full
contract.

`src/nonce-refresh.ts` ships an internal `registerNonceTarget()`
helper used by the framework's built-in updaters, but it's not
exposed across bundles — third-party plugins should use the
heartbeat subscription above.

---

## See also

- [Hooks Reference](./hooks-reference.md) — the PHP side of the API.
- [Examples — React to window events](./examples/react-to-window-events.md)
- [Examples — Add a dock badge](./examples/dock-badge.md)
- [Examples — Register a wallpaper](./examples/register-wallpaper.md)
- [Examples — Cross-window devtools](./examples/devtools-instrumentation.md)
- [Examples — Pulse a window's icon](./examples/window-request-attention.md)
- [Examples — Window themes](./examples/window-theme.md)
- [Examples — Window controls](./examples/window-controls.md)
- [Examples — Window slots](./examples/window-slot.md)
- [Examples — Custom window chrome (Experimental)](./examples/custom-chrome.md)
