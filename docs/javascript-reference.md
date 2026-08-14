# JavaScript Reference

The browser-side contract. Four layers:

1. **WordPress-style hooks** via `window.wp.hooks` — the primary extension surface.
2. **CustomEvents** dispatched on `document` in the parent shell — for shell-side plugins.
3. **`window.wp.os`** — the in-tree JS API for the WindowManager, Dock, and hook helpers.
4. **`postMessage`** bridge — typed messages between the parent shell and iframe windows.

Status labels match the [Hooks Reference](./hooks-reference.md): **Stable / Experimental / Planned**.

> **Looking for the full inventory?** [`api-index.md`](./api-index.md) lists every `wp.os.*` method, CustomEvent, and `postMessage` type with its current status — one table, one place to grep.

## Must-know APIs

These four cover ~90% of plugin code. Reach for them before anything else:

| API | Use it for | Status |
|---|---|---|
| [`wp.os.fetch( input, init?, opts? )`](#wposfetch-input-init-opts---stable) | **Every HTTP call from a plugin.** Routes through the framework so the active window's activity phase + the activity bus pick the request up automatically. ESLint forbids raw `fetch()` in-tree. | **Stable** |
| `wp.os.confirm( opts )` / `osConfirm()` | Modal Yes/No replacement for `window.confirm()`. Traps focus, restores it to the opener on close, and routes Enter to the focused button. ESLint forbids `confirm`/`alert`/`prompt` — use this. | **Stable** |
| [`wp.os.ready( cb )`](#whenready--ready--isready) | Run a callback once the shell has booted (or immediately if already booted). Idiomatic boot pattern for any script enqueued with the `openstation` dep. | **Stable** |
| [`wp.os.openWindow( id, opts? )`](#wposopenwindow-id-opts---stable) | Open or focus a registered native window by id. Symmetric with `openstation_register_window( $id, … )` PHP-side. | **Stable** |

---

## 1. CustomEvents

All events bubble from `document`. The shell dispatches them; plugins listen.

### `os-init` — Stable
Fires once, after the shell has initialized and before any session restoration completes. `detail.restored` is `true` if a saved session was restored; `false` for a fresh session.

```javascript
document.addEventListener( 'os-init', ( e ) => {
    const { config, restored } = e.detail;
    console.log( 'Desktop up; restored?', restored );
} );
```

**`detail` shape:**

```typescript
{ config: DesktopConfig, restored: boolean }
```

> **Use `wp.os.ready( cb )` for bootstrap, not this event.** `ready()` (and its alias `whenReady()`) handles both the already-fired and not-yet-fired cases — a script loaded after `os-init` (server-sync-injected widgets, settings tabs, command scripts) still gets its callback invoked via microtask. A raw `addEventListener( 'os-init', cb )` listener registered after the event has dispatched silently never fires. The CustomEvent stays around for non-bootstrap analytics / instrumentation; bootstrap goes through `ready`. See ["Bootstrap" under Hooks](#bootstrap) for the full story.

---

### `os-window-opened` — Stable
Fires every time a window is added to the stack — both fresh opens and session-restored windows.

```javascript
document.addEventListener( 'os-window-opened', ( e ) => {
    const { windowId, page, title } = e.detail;
} );
```

**`detail` shape:**

```typescript
{ windowId: string, page: string, title: string, url: string }
```

`page` and `url` currently carry the same value (the window's URL).

---

### `os-window-reopened` — Stable
Fires when `wp.os.openWindow(id)` (or `windowManager.open(...)`) is called for a `baseId` whose window already exists on the active desktop. The framework focuses + restores the existing window — the render callback does NOT re-run, and `os-window-opened` does NOT fire again. This event is the unambiguous "user requested an open while already open" signal — exactly once per `open()` call on an existing instance.

The reuse is **URL-aware**: when the `open()` call carries a URL the window is not already showing — and it isn't the window's home / dock landing URL — the framework also navigates the existing iframe to that URL in place (so e.g. `plugins.php?action=activate&plugin=…&_wpnonce=…` actually runs instead of being dropped by a bare focus). The `navigated` flag in the detail reports which path was taken.

Plugins that hold per-window state (e.g. the code editor's active file) should listen here to re-orient the existing window's content to whatever the caller wants to show. The open call is synchronous, so any state the caller sets BEFORE invoking `openWindow` is already in place when this fires.

```javascript
document.addEventListener( 'os-window-reopened', ( e ) => {
    if ( e.detail.windowId !== 'my-plugin/inbox' ) return;
    // Re-orient the window's main pane to whatever the caller
    // wanted to show.
    refreshFocusedItem();
} );
```

**`detail` shape:**

```typescript
{
    windowId: string,
    baseId: string,
    wasMinimized: boolean,
    navigated: boolean,
    // The window's open-time params AFTER the reopen — the framework
    // applies any the caller passed before firing this. `{}` when the
    // window takes none. See `opts.params` on `wp.os.openWindow`.
    params: Record< string, string | number | boolean >,
}
```

`wasMinimized` reflects the state at the moment of the call, BEFORE the framework's automatic restore-from-minimized happens. Useful for animating "popped from the dock".

`navigated` is `true` when the open request carried a URL the window wasn't already showing and the framework navigated the existing iframe to it in place. Always `false` for native windows and for re-opens that resolve to a plain focus.

---

### `os-window-content-loading` — Stable

Fires every time a window enters the **loading** state — at construction (every window starts loading) and whenever a plugin calls `Window.markContentLoading()` or the native render context's `ctx.window.markLoading()` mid-life (e.g. before refetching data).

The shell paints a `<os-spinner>` overlay over the body while the window is loading and fades the body content out. The overlay's spinner is sized responsively (`clamp(96px, 14vw, 192px)`) so it scales with the window's width.

The overlay element is attached immediately (so `config.loading.render` and the `WINDOW_LOADING_OVERLAY` filter always have a host) but stays **invisible for the first 120 ms**. A load that finishes inside that window never paints a spinner at all.

**Assistive tech.** The window element carries `aria-busy="true"` for the duration of the loading state (stamped at construction, cleared on the ready edge), and the overlay is a `role="status"` / `aria-live="polite"` region whose spinner supplies the announced text. A custom overlay supplied via `config.loading.render` or the `WINDOW_LOADING_OVERLAY` filter inherits the region — keep some text or a labelled indicator inside it, and don't set `aria-hidden` on the host.

**Edge-triggered.** Idempotent calls don't re-fire — a plugin that calls `markLoading()` twice in a row sees the event exactly once.

```javascript
document.addEventListener( 'os-window-content-loading', ( e ) => {
    if ( e.detail.windowId === 'my-plugin/inbox' ) {
        analytics.start( 'inbox-load' );
    }
} );
```

**`detail` shape:** `{ windowId: string }`

Companion `wp.hooks` action: `HOOKS.WINDOW_CONTENT_LOADING` (`os.window.content-loading`).

---

### `os-window-content-loaded` — Stable

Fires when a window's body content becomes ready — for iframe windows the moment the chromeless bridge announces `os-ready`, for native windows after the user's `render( body )` callback (or its returned Promise) resolves, and whenever a plugin calls `Window.markContentLoaded()` or `ctx.window.markReady()` mid-life. The shell removes the loading overlay and fades the body content in on this transition.

**The overlay and the content are never on screen together.** If the spinner never painted (the load finished inside the 120 ms show delay), the overlay is removed in the same tick, so nothing is held back. A native body appears immediately; an iframe still fades in over 250 ms via its own base rule. If it did paint, it gets its 250 ms fade-out to itself and the content fades in after that, not underneath it.

**Use this instead of branching on iframe vs. native.** The unified signal across both render strategies. Iframe-only consumers can still subscribe to `os.iframe.ready`, which fires alongside this event for iframe windows.

**Edge-triggered.** Only fires on a loading → ready transition. A plugin that arms loading via `markContentLoading()` and then calls `markContentLoaded()` again will see a fresh event each cycle.

```javascript
document.addEventListener( 'os-window-content-loaded', ( e ) => {
    if ( e.detail.windowId === 'my-plugin/inbox' ) {
        analytics.complete( 'inbox-load' );
    }
} );
```

**`detail` shape:** `{ windowId: string }`

Companion `wp.hooks` action: `HOOKS.WINDOW_CONTENT_LOADED` (`os.window.content-loaded`).

#### Programmatic equivalent — `Window.whenContentReady()`

For code paths that don't want to wire a CustomEvent listener (e.g. a plugin coordinating with an `iframeContent: { bridge: true }` native window before its first `send`), the `Window` facade exposes a Promise-returning version:

```javascript
wp.os.openWindow( 'my-plugin/inbox' ); // returns boolean, not the Window

// The Window instance is registered asynchronously — grab it via the
// `opened` lifecycle, or directly when it was already open.
const init = async ( win ) => {
    await win.whenContentReady();
    // Bridge listeners are guaranteed wired here; safe to send / connect.
    win.send( 'init', { … } );
};

const existing = wp.os.windowManager.getById( 'my-plugin/inbox' );
if ( existing ) {
    init( existing );
} else {
    wp.os.onWindow( 'my-plugin/inbox', {
        opened: () => init( wp.os.windowManager.getById( 'my-plugin/inbox' ) ),
    } );
}
```

Resolves immediately for windows that are already ready, otherwise on the next matching `os-window-content-loaded` for this window's id. Mirrors `HOOKS.WINDOW_CONTENT_LOADED` semantics — works for both iframe and native windows.

---

### `os-window-focused` — Stable
Fires when a window is focused (promoted to topmost z-index).

```javascript
document.addEventListener( 'os-window-focused', ( e ) => {
    console.log( 'Focused', e.detail.windowId );
} );
```

**`detail` shape:** `{ windowId: string }`

---

### `os-window-blurred` — Stable

Fires on the window that **lost** focus when another window is promoted to topmost. Pairs with `os-window-focused` for the symmetric "I am no longer the active window" signal — without this event, apps had to track focus transitions themselves to derive blur. Useful for badge policies, attention timers, and any "render differently when not active" UI.

```javascript
document.addEventListener( 'os-window-blurred', ( e ) => {
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

Companion `wp.hooks` action: `HOOKS.WINDOW_BLURRED` (`os.window.blurred`).

---

### `os-window-closing` — Stable
Fires when the user closes a window, BEFORE the outer element is detached from the DOM. Subscribers needing an element reference (wallpaper overlays anchored to specific windows, snow that has piled on the window top, measurement caches) should listen here rather than to `os-window-closed` — by the time the `closed` handler runs the element may be mid-fade-out.

**`detail` shape:** `{ windowId: string, element: HTMLElement }`

---

### `os-window-closed` — Stable
Fires after the window is removed from the stack and begins its closing animation. Payload intentionally minimal; use `os-window-closing` above when you need the element reference.

**`detail` shape:** `{ windowId: string }`

---

### `os-window-tab-change` — Stable
Fires when a native window's tab changes, whether the user clicked it, chose it with the keyboard, or code called `Window.activateTab()`. Dispatched on the window element and bubbles, so a listener on the element or on `document` both work.

Only panel tabs fire this. A submenu tab on an iframe window navigates instead, and `os-window-content-loading` / `os-window-content-loaded` are the events for that.

**`detail` shape:** `{ value: string }`

---

### `os-window-changed` — Experimental
Internal event used by the session saver. Fires for geometry changes (drag-end, resize-end) and state transitions (minimize, maximize, fullscreen, restore). Signature may change — prefer the per-operation events above for external use.

**`detail` shape:**

```typescript
{ windowId?: string, reason: 'moved' | 'resized' | 'state' | 'cascade' | 'tile', state?: WindowState }
```

Batch-arrange dispatches (`reason: 'cascade'` / `'tile'`) omit `windowId` and `state` — only the per-window dispatches (`'moved'`, `'resized'`, `'state'`) carry them.

---

### `os-presence-changed` — Stable

Fires when a tracked user's presence transitions between `online`,
`inactive`, and `offline`. Does NOT fire on stable ticks where the
status didn't change — listeners only see real transitions, so
"user came online" / "user went away" UIs hook here without
debouncing themselves.

The viewer-side filter (`openstation_presence_visible_users`) gates
which users surface in any one viewer's tab — a transition for a
user the viewer can't see produces no event.

```javascript
document.addEventListener( 'os-presence-changed', ( e ) => {
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

### `os-selection-changed` — Experimental

Fires whenever the selection changes on any tile canvas in the shell — the wallpaper, a folder window, or a list inside My WordPress. Every surface routes through the same controller, so one listener covers all of them.

```javascript
document.addEventListener( 'os-selection-changed', ( e ) => {
    const { surface, scope, keys, count } = e.detail;
    if ( surface === 'files' && count > 1 ) {
        showBulkHint( count );
    }
} );
```

**`detail` shape:**

```typescript
{
    surface: string,   // 'files' | 'my-wordpress' | a plugin's own slug
    scope:   string,   // folder id, entity id — narrows the surface
    keys:    string[], // the surface's item keys, in visual order
    count:   number,
}
```

An empty selection fires too, with `keys: []` and `count: 0`. See [`wp.os.selection`](#selection--experimental) for the synchronous reader and the action-resolution rules.

---

### `os-layout-changed` — Stable
Fires when the user picks a new top-level desktop layout **or moves the dock to another edge** in OpenStation Preferences → Appearance. Both tear down and rebuild the dock(s) before the event fires, so plugins that cached `wp.os.dock` should re-fetch from the event detail (or read `wp.os.dock` again — it's mutated in place). The shell root reflects the layout in its `data-os-layout` attribute and each rail its edge in `data-os-dock-placement` by the time this fires, so CSS selectors keyed on either will already match.

```javascript
document.addEventListener( 'os-layout-changed', ( e ) => {
    const { layout, placement, primary, side } = e.detail;
    console.log( 'Desktop layout is now', layout, 'on the', placement, 'edge' );
} );
```

**`detail` shape:**

```typescript
{
    layout:    'classic' | 'unified',
    placement: 'bottom' | 'left' | 'right',   // edge the primary rail mounted on
    primary:   Dock | null,   // primary dock — always present
    side:      Dock | null,   // left side bar — non-null only in classic
}
```

`placement` is the edge the primary rail **actually mounted on**, not the raw preference: `classic` owns both of its edges, so it reports `bottom` however `dockPlacement` is set.

---

### `os-item-menu-opening` — Stable
Fires on `document` the moment a tile's own menu is asked for, before anything is painted. The detail carries the item id and the surface it was opened from.

It exists because a tile can carry two surfaces at once: the menu, and whichever hover affordance the tile has (the constellation flyout on menu tiles, the peek card on system ones). Both anchor to the same tile, so opening one over the other leaves two panels fighting for the same corner of the screen. The shipped hover surfaces listen for this and dismiss themselves; a plugin that paints its own hover affordance on a dock tile should do the same.

```javascript
document.addEventListener( 'os-item-menu-opening', ( e ) => {
    const { id, surface } = e.detail;
    myHoverCard?.close();
} );
```

**`detail` shape:**

```typescript
{
    id:      string,   // dock item slug, system-tile id, or desktop-icon id
    surface: 'dock' | 'desktop',
}
```

Named for the intent rather than the input: a menu opened from the keyboard has the same collision, and so does one opened programmatically.

---

### Drag-and-drop CustomEvents — Stable

Fired on `document` by `wp.os.dragManager` for every in-shell
drag gesture (file tile, entity tile, plugin-defined sources). All
share `event.detail.payload` carrying the originating
`{ type, source, data, ghost? }`.

```javascript
document.addEventListener( 'os.drag.start', ( e ) => {
    // The drag has crossed the threshold; ghost is mounted.
    // e.detail.payload — see `DragPayload`.
} );
document.addEventListener( 'os.drag.move', ( e ) => {
    // Each pointermove past lift. e.detail.{ payload, clientX, clientY }
} );
document.addEventListener( 'os.drag.enter', ( e ) => {
    // Cursor entered an accepting target. e.detail.{ payload, targetId }
} );
document.addEventListener( 'os.drag.leave', ( e ) => {
    // Cursor left an accepting target. e.detail.{ payload, targetId }
} );
document.addEventListener( 'os.drag.rejected', ( e ) => {
    // Cursor over a registered target whose accept() returned false.
    // e.detail.{ payload, targetId }
} );
document.addEventListener( 'os.drag.commit', ( e ) => {
    // Drop landed; target.onDrop has fired.
    // e.detail.{ payload, targetId }
} );
document.addEventListener( 'os.drag.cancel', ( e ) => {
    // Drag aborted (Escape, blur, no-target, rejected, …).
    // e.detail.{ payload, reason }
} );
document.addEventListener( 'os.drag.end', ( e ) => {
    // Always fires last — pair with .start for symmetric bookkeeping.
    // e.detail.{ payload, reason }
} );
```

**Multi-item drags** — *Experimental.* A drag that starts on a tile
belonging to the current selection carries the whole selection. Two
optional payload fields express it, and a target that ignores them
still behaves correctly:

| Payload type | Grabbed item | The whole set |
|---|---|---|
| `'desktop-file'` | `data.placement` | `data.placements?` |
| `'shortcut'` | `data.{ kind, ref, … }` | `data.items?` |

Both are **absent for a single-item drag**, so payloads for the
ordinary gesture are unchanged. Read them through
`dragPlacements( data )` / `dragShortcutItems( data )`, which fall
back to the grabbed item — one code path for "one" and "many". A
target that keeps reading `data.placement` acts on the tile the user
pointed at, which is a defensible outcome rather than a broken one.

If your target supports sets, apply its accept-gates to every member
and refuse the whole drop when any one fails: accepting a set and
handling part of it reports success for an operation that
half-happened. See [files on the desktop](./files-on-desktop.md#dragging-a-selection)
for the full contract.

The cross-iframe `os-drag-*` / `os-drop`
postMessages and the `os-cross-frame-drag-start` /
`-end` CustomEvents from `wp.os.dragBridge` (Media Library
payload channel) are a separate, lower-level surface and remain
Stable.

**Focus follows the drag**: while a drag is in
flight — any drag, whatever its source or payload: a DragManager
session, a cross-iframe bridge drag (Media Library), an OS file, an
image or text selection lifted from anywhere — the window under the
cursor is raised (focused) after a ~250 ms hover dwell, macOS
spring-loading style, so the drop target comes forward. Sweeping
across a window without resting on it does not raise it. Drags
hovering an iframe window from outside a bridge session are detected
via the `os-drag-hover` heartbeat the chromeless bridge
forwards (see `bridge-protocol.md`). Plugins can veto per activation
via the `os.window.focus-on-drag-hover` filter (see the
[window lifecycle hooks table](#window-lifecycle)).

### Pinned-note drag payloads — Experimental

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
surfaces, registered only when `openStationConfig.canCreatePosts` is
true (the current user has `edit_posts`):

1. The Posts **dock tile** (`[data-menu-slug="menu-posts"]`) and
2. the open **native Posts window** body (`[data-os-posts-root]`)
   — both get a real `DropTarget` and set
   `data-os-posts-drop-active` while a note hovers.
3. A Posts **shortcut tile on the desktop**. A promoted menu icon is a
   files-layer shortcut tile already claimed by the
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
document.addEventListener( 'os-note-created', ( e ) => {
    // e.detail.note — the REST `Note` shape from /desktop-mode/v1/notes.
} );
```

The REST base is surfaced to the shell as `openStationConfig.notesUrl`
(`/desktop-mode/v1/notes`); the notes layer only boots when it is
present. The controller's routes are `GET`/`POST /notes`, `PATCH`/
`DELETE /notes/:id`, `POST /notes/:id/restore`, and
`POST /notes/:id/convert`, which spawns a draft post from the note,
trashes the note, and returns `{ noteId, postId, editUrl }`. The
convert route is owner-only and requires the `edit_posts` capability;
the shell exposes whether the current user qualifies as
`openStationConfig.canCreatePosts` so the "Convert to
post" affordances only render for eligible users. Restoring a
convert-trashed note (the Undo path) also discards the draft it
spawned.

### `wp.os.dragBridge` — cross-iframe drag — Stable

The bridge is the postMessage channel that lets shell-side drags
(WP Explorer media tiles, post tiles, user tiles) land inside iframe
windows (the Gutenberg editor, the site editor). When a DragManager
session begins on a shell tile carrying a `bridgePayload`, the shell
fans the payload into `dragBridge.start(payload)`. While the gesture
is in flight, the shell routes pointer events through a per-window
overlay (`src/drag/iframe-drop-targets.ts`) and posts the following
messages into the iframe under the cursor:

| postMessage type | Direction | When | Payload shape |
| --- | --- | --- | --- |
| `os-drag-over` | parent → iframe | cursor entered the iframe | `{ type, payload: DragBridgePayload }` |
| `os-drag-leave` | parent → iframe | cursor left the iframe | `{ type }` |
| `os-drop` | parent → iframe | pointerup over the iframe | `{ type, payload: DragBridgePayload, position: { x, y } }` |
| `os-drag-start` | iframe → parent | iframe initiated its own drag | `{ type, payload: DragBridgePayload }` |
| `os-drag-end` | iframe → parent | iframe-initiated drag ended | `{ type }` |
| `os-drag-payload-request` | iframe → parent | iframe wants the current payload | reply: `{ type: 'os-drag-payload', payload }` |

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
listens for `os-drop` and inserts a block:

- `attachment` `image/*` → `core/image`
- `attachment` `video/*` → `core/video`
- `attachment` `audio/*` → `core/audio`
- `attachment` other → `core/file`
- `post` / `user` → `core/paragraph` with `<a href="URL">title</a>`

### OS-file drop hooks — Experimental

When the user drags a file in from the host operating system
(Finder, Explorer, Nautilus) onto any surface in OpenStation
— the wallpaper, a folder, a native window, or a chromeless
admin iframe — the shell catches it and routes it through a
confirmation dialog. The full pipeline is hookable via
`window.wp.hooks`:

| Hook | Kind | Notes |
| --- | --- | --- |
| `os.drop.files-detected` | filter | `(files: File[], ctx) => File[]` — before mime / size filter. Return `[]` to abort. |
| `os.drop.files-rejected` | action | `{ rejections, context }` — files that failed the allow-list. |
| `os.drop.dialog-fields` | filter | `(entry, ctx) => entry` — mutate per-file defaults. |
| `os.drop.before-upload` | filter | `(payload, ctx) => payload \| null` — last call before `wp/v2/media`; `null` cancels. |
| `os.drop.after-upload` | action | `{ result, fields, context }` |
| `os.drop.upload-failed` | action | `{ file, error, context }` |

Iframes forward OS drops to the parent shell via
`postMessage` of type `os-file-drop` with a
`{ files: File[], x, y }` payload — same-origin only.

See [`docs/examples/os-file-drop.md`](examples/os-file-drop.md)
for two end-to-end recipes (stamping the active folder on
every upload, hand-off to a CSV importer).

---

### `os-registry-changed` — Stable

Fires when a server-side registry (dock items, native windows, desktop icons) is mutated by the live-refresh applier — i.e. when the chromeless `plugins.php` iframe `postMessage`s `os-plugins-changed` after a peer plugin is activated or deactivated. The shell diffs the new payload against its prior snapshot by `id` and dispatches one event per registry that actually changed. No event fires when the diff is empty.

> **Naming.** This event uses the `os-` prefix — not a `wp-` prefix, which is reserved for WordPress Core per plugin reviewer guidelines.

```javascript
document.addEventListener( 'os-registry-changed', ( e ) => {
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

- Activation outside the open shell (another browser tab, `wp-cli plugin activate`, REST). The broadcast is bound to the chromeless `plugins.php` iframe's load — there is no cross-tab or out-of-band push today. Plugins that need to handle that case can call `wp.os.refreshMenu()` themselves on a signal of their own choosing.

The `server*` registries (commands, settings tabs, widgets, wallpapers, …) already publish their own per-registry subscribe APIs — those are the right surface for plugin authors hooking into those layers, not this event.

---

### `os-settings-save-lifecycle` — Stable

Fires on every phase transition of an OpenStation Preferences save — both the built-in panel's edits and programmatic patches via [`wp.os.updateOsSettings()`](#updateossettings-patch-opts---stable).

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

`<os-save-status auto>` subscribes to exactly this event by default — drop the component into a settings surface and the saving / saved / failed indicator wires itself.

---

### `os-default-window-changed` — Stable

Fires after `wp.os.setDefaultWindow( url | null )` **successfully** persists the user's "open on startup" preference through the REST endpoint. No event fires when the save errors. The same payload is assigned to `wp.os.config.defaultWindow` in place; the ⋯-menu listens here to repaint its checkmarks live.

**`detail` shape:**

```typescript
{
    enabled: boolean,  // false when the default was cleared via setDefaultWindow( null )
    url: string,
}
```

---

### `os-open-ai` — Experimental

**Direction inverted:** plugins dispatch this one; the shell listens. Dispatching it on `document` opens the AI Assistant spotlight overlay — equivalent to `wp.os.ai.open()` for code that runs without a `wp.os` reference in scope (the admin-bar "Ask AI ⌘K" button is the in-tree dispatcher). No detail payload. The shell routes the open through the palette cycle, so any other open palette is dismissed first (single-palette-at-a-time invariant).

```javascript
document.dispatchEvent( new CustomEvent( 'os-open-ai' ) );
```

---

### `os-intros-reset` — Experimental

Fires after the user resets the one-time announcement flags in **OpenStation Preferences → Features** and the REST delete succeeds. The shell itself does nothing in response — it is dispatched purely so bundles that cache their own dismissed-dialog state can invalidate it and let the dialog appear again without an F5. No detail payload.

---

## 2. `window.wp.os` API

Populated after `os-init`. Do not access before that event fires.

```typescript
window.wp.os = {
    // Window management
    windowManager:     WindowManager,
    openWindow:        ( id, opts? ) => boolean,
    onWindow:          ( id, handlers, opts? ) => () => void,

    // Surfaces
    dock:              Dock | null,                            // primary (bottom)
    sideDock:          Dock | null,                            // left, classic only
    desktopLayout:     'classic' | 'unified',
    dockPlacement:     'bottom' | 'left' | 'right',           // edge the primary dock sits on
    icons:             IconsApi,
    saveSession:       () => void,

    // Cross-bundle / cross-window primitives
    createSharedStore: < T >( key, init ) => SharedStore< T >,
    activity:          ActivityApi,                            // typed pub/sub
    heartbeat:         HeartbeatBus,                           // wp Heartbeat bus
    broadcast:         < T >( topic, payload ) => void,        // cross-window
    subscribe:         ( topic, cb ) => () => void,            // cross-window

    // Framework features
    presence:          PresenceApi,
    ai:                AiApi,
    devtools:          DevtoolsApi,

    // Native-window glue
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
manager.raise( windowId: string ): void;                                 // restack to just below the top WITHOUT focusing; no focus/blur events

// Lookup
manager.getById( id: string ): Window | undefined;
manager.getByBaseId( baseId: string ): Window | undefined;
manager.getAllByBaseId( baseId: string ): Window[];                      // every instance sharing baseId, any desktop
manager.getAllByBaseIdOnActiveDesktop( baseId: string ): Window[];       // same, filtered to the active desktop
manager.getAll(): Window[];
manager.getFocused(): Window | undefined;
manager.isActive( id: string ): boolean;                                 // exists, not minimized, focused, on the active desktop
manager.isActiveByBaseId( baseId: string ): boolean;                     // isActive() for any instance sharing baseId

// Snapshot / surface
manager.snapshot(): Session;
manager.getVisibleRects(): VisibleWindowRect[];
manager.seedWindowRestoreState(                                          // stage config for the NEXT open of each id
    entries: Record< string, Partial< WindowConfig > >,
): void;

// Batch operations
manager.closeAll( options?: { exceptIds?: string[] } ): number;
manager.minimizeAll(): Window[];
manager.restoreFrom( windows: Window[] ): void;
manager.toggleShowDesktop(): boolean;
manager.cascade(): void;
manager.tile(): void;

// Virtual desktops ("Spaces")
manager.getDesktops(): Desktop[];
manager.getActiveDesktop(): Desktop;
manager.getActiveDesktopId(): string;
manager.getPrimaryDesktopId(): string;
manager.createDesktop(): Desktop;
manager.switchDesktop( id: string ): void;
manager.closeDesktop( id: string ): void;
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

> **`open()` requires a config object.** Passing a URL string used to silently produce a window stuck on a loading spinner with no error in the console. The manager throws `TypeError` at the call site if `config` isn't an object, or if `id` / `url` / `title` are missing or wrong-typed. Build the config; don't shorthand it.

**`config.submenu`** — when present, the shell renders the array as an in-window tab strip below the title bar so the user can navigate child pages without leaving the window. Pass `item.submenu` whenever you open a window from a dock context — `openItem` and `openSubmenuPick` (in custom rail renderers) propagate it for you. Skip it for native windows that don't have admin sub-pages. The shell strips WordPress's auto-prepended self-link entry server-side, so `submenu.length > 0` reliably means "has real children" (no defensive filtering needed in your code). The shell prepends a synthetic "back to parent" tab (label = `config.title`, URL = `config.url`) as the first tab so the user can return to the parent listing without closing the window. If a caller-supplied submenu entry already points at `config.url` the synthetic tab is suppressed to avoid two tabs claiming the same URL.

Every iframe window gets the strip element, whether or not it has a submenu, because external sub-tabs can be added to it later. Its navigation semantics follow its contents: `role="tablist"` plus an `aria-label` of `"<title> sub-pages"` while it holds tabs, `role="presentation"` while it is empty — so a window with no sub-pages never advertises an empty tab list to assistive tech.

The active tab is re-matched against the iframe's URL after every navigation. An exact URL match wins; otherwise the shell lights the tab whose *page* the current URL belongs to, so a screen's own sub-views keep their tab highlighted (`nav-menus.php?action=locations` stays on Menus, `edit.php?post_type=post&paged=2` stays on All Posts). A tab owns a URL when the page-identity params agree (`post_type`, `taxonomy`, `page`, `path`, …) **and** every param the tab's own URL declares is present with the same value — so `admin.php?page=x&tab=test` never claims `admin.php?page=x&tab=logs`, which falls back to the `admin.php?page=x` entry. When two entries both qualify, the more specific one (more params declared) wins. Exactly one tab is ever active.

**`seedWindowRestoreState( entries )`** — stage config to merge into the *next* window opened under each id, then forget it. For openers that build their own `manager.open()` config and have no argument to thread extra values through: you can't hand geometry to `wp.os.openWindow( id )` or to a native window's own opener, but you can state it up front and let the manager apply it when the window materialises.

Session restore is the built-in consumer — it stages each saved native window's geometry, desktop, and state before asking the registry to reopen them. Entries are consumed on first use, so a later user-initiated open of the same window is unaffected, and each call replaces whatever the previous one left staged.

```js
const manager = wp.os.windowManager;
manager.seedWindowRestoreState( {
    'my-plugin-panel': { x: 240, y: 150, width: 640, height: 520 },
} );
wp.os.openWindow( 'my-plugin-panel' ); // opens at that geometry
```

**`minimizeAll()` / `restoreFrom( windows )` / `toggleShowDesktop()`** — the "Show Desktop" gesture decomposed into reusable primitives. `minimizeAll()` returns the windows it actually minimized (skipping windows already in the `'minimized'` state), so you can pair it with a later `restoreFrom( minimizedSet )` that touches only what you minimized. `toggleShowDesktop()` is the higher-level call mirroring the wallpaper-click behaviour exactly — minimize when anything is visible, restore when everything's hidden. Returns `true` when the new state is "showing the desktop." All three are scoped to the **active virtual desktop only** — a window parked on a Space the user isn't currently viewing is left alone, unlike `closeAll()` below, which still acts across every desktop.

```js
// Plugin building an expand/collapse UI.
let parked = [];
function expand() {
    parked = wp.os.windowManager.minimizeAll();
}
function collapse() {
    wp.os.windowManager.restoreFrom( parked );
    parked = [];
}
```

**`getVisibleRects()`** — snapshot every open window's current geometry + state. One entry per window in the stack (regardless of virtual desktop), carrying a live element reference. Intended for wallpaper / overlay plugins that previously scraped `document.querySelectorAll( '.os-window' )` and sniffed modifier class names to derive state. Callers filter on `state` themselves — minimized windows are included so the consumer can decide.

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
document.addEventListener( 'os-init', () => {
    window.wp.os.windowManager.open( {
        id:    'my-ext-window',
        url:   '/wp-admin/admin.php?page=my-analytics',
        title: 'Analytics',
        icon:  'dashicons-chart-bar',
    } );
} );
```

Calling `open()` with an id (or `baseId`) that's already on screen focuses the existing window and restores it if minimized.

**URL-aware reuse**: focusing is the whole story only when the requested URL is one the window is already showing — its live iframe URL, the URL it was opened with, or its home / dock landing URL (`parentUrl`); the comparison ignores the chromeless / portal flags, `_wp_http_referer`, and param order. Any *other* URL is treated as a real navigation request: the existing iframe navigates to it in place (via `location.assign()`, so in-frame Back still works) instead of the URL being silently dropped. This is what makes action links routed through `open()` — e.g. the post-install **Activate** link `plugins.php?action=activate&plugin=…&_wpnonce=…` while a Plugins window is already open — actually execute. Dock clicks keep their old behavior: clicking a tile whose window has sub-navigated only focuses it (the tile's URL is the window's home URL), never yanks it back to the landing page. The `os-window-reopened` detail reports the outcome via `navigated`.

**Title-bar actions menu (iframe windows).** Every iframe-backed window renders a three-dots actions menu on the leading edge of its title bar. Built-in items:

- **"Open on startup"** — checkable; toggles this window as the user's default-window preference.
- **"Open another <Page>"** — only when the window was opened with `multi: true`. Calls `openNew()` with the window's *original* landing URL.
- **"Open in new window"** — opens a fresh sibling window seeded with the *current* iframe URL (post in-window navigation). Useful when the user has drilled into a sub-page (e.g. editing a specific post) and wants to peel a copy off without losing their place. The new window cascades and uses the same multi-instance id suffixing as `openNew()`.

**Multi-instance windows.** When `multi: true` is passed, the window gets the "Open another" item described above. `openNew()` always creates a fresh window — even when one with the same `baseId` is already open — assigning a suffixed id (`${baseId}-2`, `${baseId}-3`, …) so every instance can be tracked independently while the dock still groups them under the same icon.

One exception to the suffixing: if you pass an `id` that differs from `baseId` and isn't currently taken, `openNew()` honours it verbatim instead of allocating the next free slot. This is how a caller re-materialises a *specific* instance — session restore replays saved ids (`edit-php-2`) so that anything keyed by window id (the saved focused-window pointer, per-window plugin state, `wp.os.onWindow( id )` subscriptions) still lines up after the reload. Pass `id === baseId` (or omit `baseId`) for the ordinary "just give me another one" case and you get slot allocation as described above.

**Dock hover-peek.** Multi-capable dock tiles render a hover-reveal *peek* popover instead of the legacy "+" chip. Hovering a multi tile that has at least one open instance fans out a stack of cards next to the tile (works on left, right, and bottom dock orientations):

- **Instance cards** — one per currently open window of this dock item **on the active virtual desktop** (an instance parked on another Space doesn't clutter the peek for a desktop it isn't on), styled as miniature windows: faux titlebar with traffic-light dots, the page icon, the live window title (titlebar background uses `--os-titlebar-bg-focused` so the mini-window matches the real window's chrome), plus a hash-tinted body. **Hovering an instance card raises that window to front** ("scrub through windows" — Mission Control / Aero Peek). **Clicking** focuses the window through `document.startViewTransition()` so the card morphs into the window position.
- **Ghost Card** — the trailing card with a dashed outline and a slow breathing pulse. Clicking it calls `windowManager.openNew()` for this tile, also animated through `startViewTransition()` (graceful fade fallback otherwise).

The popover caps at `min(80vh, 480px)` and **scrolls internally** when more cards exist than fit. After mount, JS measures and clamps the popover position so it never overflows the viewport edges (top/bottom/sides).

The peek is mouse-only — touch and pen pointers fall back to plain tap-to-focus / tap-to-open. It also suppresses itself for singleton tiles (no Ghost Card is meaningful) and for multi tiles with zero open instances (a plain click already does the only useful thing). The icon itself springs up + magnifies on hover for tactile feedback even when the peek isn't shown. `prefers-reduced-motion` disables every animation.

**Customizing peek cards.** Two filters let plugins reshape what each card looks like:

- `os.dock.peek-card-content` — receives the default body element (`<span class="os-dock-peek__card-body">`) and a `{ window, item }` context. Return a different element to replace just the body — perfect for rendering a real thumbnail, a status block, a chart, or anything else inside the card while keeping the default mini-window chrome (titlebar with dots + icon + title). When a plugin returns a non-default body, the peek adds a `--custom` modifier class so the default tinted background and ghost-line padding drop out, giving the plugin a clean canvas.
- `os.dock.peek-card-element` — receives the fully-built default card and the same `{ window, item }` context. Return a different element to replace the **whole card** (chrome included). Plugins that take this path are responsible for preserving the `os-dock-peek__card` class (the fan-out animation keys off it) and for re-wiring the click handler if focus-on-click should still work. Use `peek-card-content` when you only need to swap the body; reach for `peek-card-element` when you need to control titlebar + body together.

```javascript
window.wp.hooks.addFilter(
    'os.dock.peek-card-content',
    'my-plugin/thumbnail',
    ( body, { window: win } ) => {
        const img = document.createElement( 'img' );
        img.src = `/wp-json/my-plugin/v1/thumbnail/${ win.id }`;
        img.alt = win.config.title;
        return img;
    }
);
```

#### The notch

A small pill fixed to the **top centre** of the shell, `#os-notch`. It is the site assistant's front door — click it, or press `⌘/Ctrl + K` — and it is where the shell says short things: `say( text )` expands it with a message and collapses it again after a couple of seconds.

**It never reserves work area, and that is the contract.** A full-width bar that permanently stole height is what OpenStation removed; an element that reserved space would be the same mistake in a nicer shape, and it would make the notch a second hardcoded claimant on a work-area rectangle that already has several disagreeing answers. So it is positioned against the shell rather than the viewport, which places it correctly whichever admin-bar mode is on, and it dims itself under a maximized window rather than pushing that window down. Top-*centre* is chosen rather than incidental: window title text reads from the leading edge of the title bar's `flex: 1` region, so the centre of a maximized window's top edge is the one strip that is reliably empty.

The message region is always in the DOM with `aria-live="polite"` — a live region created at the moment it gains text is announced unreliably — and `say()` replaces rather than queues, because two things happening at once is one situation, not two messages.

Hidden entirely in solo mode.

#### The constellation

**Menu tiles** hand the hover gesture to the **constellation**, a flyout that fans a menu's *submenu* out of its tile, in place of the hover-peek. Without it the submenu is dropped at the dock — the tile opens the landing page and the child pages are only reachable from inside the window, through its tab strip. The tab strip is unchanged; this is the shortcut in front of it.

It is on every rail, in every layout. The panel fans **away from the edge its rail is parked on** — up from a bottom dock, right from a left-hand one, left from a right-hand one — which it reads off that rail's own `data-os-dock-placement` rather than off the layout, because Split puts one rail down the left and another along the bottom at the same time. The panel carries the direction as `data-os-cn-side` (`top` / `left` / `right`), naming where the panel is relative to its tile; a plugin replacing the panel through the filter below inherits the attribute and the positioning that goes with it.

A **system tile** joins in only if it declared a `submenu` of its own (System is the shipped one); every other system tile keeps the peek. Its menu is a list of *actions* rather than admin pages, but it wears the same panel as an admin menu does: same head, same live-windows section, same "Open" heading. See [System tiles](#system-tiles) for how to declare one.

One panel, up to three sections, top to bottom — the same three whichever kind of tile it belongs to. The two kinds differ in what fills the sections, never in which sections exist:

| Section | Class | What it does |
|---|---|---|
| Head | `.os-constellation__head` | The tile's icon and title, nothing else. Click opens the menu's own page; on a system tile, which has none, it runs the first row. |
| Open windows | `.os-constellation__row--live` | One row per live instance **on the active virtual desktop**. Click focuses (restoring a minimized window first). An admin menu resolves these from its own window key; a system tile's action menu resolves them from its rows' `windowId`. |
| Open | `.os-constellation__row--sub` | One row per submenu entry, each with a hue derived from its own title. |

Rows route through the same window ids a dock click would address, so the flyout and the tile share one window between them rather than opening two. A submenu row pins `parentUrl` to the **menu's** landing page, not to the child — that is what keeps a way back to the parent screen in the window's tab strip.

Mouse and keyboard, not touch. `ArrowUp` on a focused tile fans the panel open and lands focus on the first row; `ArrowUp`/`ArrowDown` rove, `Home`/`End` jump, `Enter` activates, `Escape` collapses and hands focus back to the tile. Submenu-less system tiles (Recycle Bin, Mio, plugin-registered native windows) keep the ordinary hover-peek in every layout.

**The flyout is one tab stop, not one per row** — the conventional ARIA menu pattern. Every `.os-constellation__row` is given `tabindex="-1"` (including rows a plugin appended through the filter below, which are normalised after it runs), arrow keys do the moving, and `Tab` collapses the panel and returns focus to the tile *without* preventing the default, so the browser then continues from the rail's own place in the document order. Without that a fifteen-child submenu would put fifteen stops between the dock and whatever follows it.

**Vertical sizing.** The panel hangs off the top of the dock and is never nudged downward to fit — that would push it over the rail and under the pointer. Instead the JS writes `--os-cn-max-h` on every placement (the distance from the panel's bottom edge to the top of the viewport, floored at 160px) and the surface reads it as a `max-height`; a menu too tall for the space shrinks and its submenu group takes the scroll, leaving the head and the new-window row pinned. Horizontally it *is* nudged, with `--os-cn-beam-x` keeping the beam pointed at the tile.

Three hooks:

- `os.constellation.panel` — **filter**, runs once per flyout right before it's appended. Receives the fully-built panel root and `{ item, instances, tile }`. Return a mutated node or a replacement. A replacement owns the `os-constellation` class (positioning + the transitions), `role="menu"`, and the `os-constellation__row` class on anything that should take part in arrow-key roving.
- `os.constellation.opened` — **action**, `{ menuSlug, item, instances, handoff }`. `handoff` is `true` when this panel replaced one that was already up (the pointer moved along the rail) rather than arriving on an empty desk — the same flag the matching `closed` carries.
- `os.constellation.closed` — **action**, `{ menuSlug, handoff }`. Fires when the panel is dismissed, **not** when its node leaves the DOM: the panel stays in the document under `.os-constellation--closing` (inert, `pointer-events: none`) until it has finished leaving. Query `.os-constellation:not( .os-constellation--closing )` if you need "is a flyout actually open". `handoff` is `true` when another tile is already taking over, so you can tell "the menu closed" from "the menu moved" without diffing against the next `opened`.

`item` is a `ConstellationMenu`: `{ id, title, icon, submenu, menuItem }`. `menuItem` is the `DockItem` the flyout was built from, or **`null`** for a system tile's action menu — filter on it if your subscriber only means to handle admin menus. `menuSlug` follows the same split: the admin-menu slug for a menu tile, the system tile's id otherwise.

**More than one panel can be on screen.** `wp.os` never exposes a "the flyout" singleton for exactly this reason: a dismissed panel keeps its own anchor and finishes its own exit while the next one is already rising over a different tile. Moving along the rail is **two** panels, each animating where it belongs — the one you left playing its dismissal, the one you arrived at playing its entrance — not one panel sliding across and swapping contents. Each panel is a menu bound to a specific tile; morphing one into another would claim they are the same object and would drag a beam across the rail pointing at a tile its panel has nothing to do with. The retiring panel is painted one z-index step below the live one so it can never fade out on top of the menu being read.

**Two ways to leave:**

| | When | What happens |
|---|---|---|
| **Exit** | Any dismissal — pointer left, Escape, a row activated, or another tile taking over | Falls back into the rail: shrinks toward `bottom center` (where the beam meets its own tile) on an ease-**in** curve, beam cutting first. Rows are pinned so the panel leaves as one object. |
| **Cut** | The anchor rect was invalidated (scroll, resize, layout switch), or `prefers-reduced-motion: reduce` | The node is removed outright. A panel gliding away from a tile that has already moved points at nothing. |

```javascript
// Add a "recently edited" row to the Posts flyout.
window.wp.hooks.addFilter(
    'os.constellation.panel',
    'my-plugin/recent',
    ( panel, { item } ) => {
        if ( item.id !== 'edit.php' ) {
            return panel;
        }
        const row = document.createElement( 'button' );
        row.type = 'button';
        row.className = 'os-constellation__row';
        row.setAttribute( 'role', 'menuitem' );
        row.textContent = 'Recently edited';
        row.addEventListener( 'click', () => openRecent() );
        panel.querySelector( '.os-constellation__surface' ).append( row );
        return panel;
    }
);
```

**Theming.** The panel reads `--os-cn-*` (surface, border, shadow, text, legend, divider, row fill + ink, beam, radius, stacking order) plus the seam tokens `--os-cn-seam` / `--os-cn-seam-node` for the rail's core→plugin divider. All are declared in `variables.css` and re-pointable by a desktop theme like any other token. The mesh is spent deliberately in exactly two places — the row under the pointer, and the head's icon — because those are the moments the panel is answering the user; the surface itself stays Obsidian.

```javascript
// Open a second Posts list alongside the first.
window.wp.os.windowManager.openNew( {
    id:      'edit-php',
    baseId:  'edit-php',
    url:     '/wp-admin/edit.php',
    title:   'Posts',
    icon:    'dashicons-admin-post',
    multi:   true,
} );
```

The server-side `openstation_dock_item_multi` filter controls which admin pages ship with `multi: true` by default — see the [Hooks reference](./hooks-reference.md#openstation_dock_item_multi--stable).

---

#### `Window` instance methods

`manager.open()` / `openNew()` resolve to, and `getById()`, `getAll()`, etc. synchronously return, `Window` instances. Public surface:

```typescript
interface Window {
    readonly id:      string;     // stable identifier
    readonly config:  WindowConfig;
    readonly element: HTMLElement; // outer .os-window node
    state: 'normal' | 'minimized' | 'maximized' | 'fullscreen' | 'snapped-left' | 'snapped-right';

    // State predicates — equivalent to `state === '…'`
    // but easier to discover and harder to misspell at the call site.
    isMinimized():  boolean;
    isMaximized():  boolean;
    isFullscreen(): boolean;
    isSnapped( side?: 'left' | 'right' ): boolean;
    isFocused():    boolean;        // mirrors the os-window--focused class

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

The `state` property is read-only-ish — mutate via the methods (`minimize()`, `restore()`, `maximize()`) so the manager fires the right lifecycle hooks (`os.window.minimized`, etc.). Reading it is fine and cheap; the `is…()` predicates are equivalent, so you don't have to remember the canonical state-string values.

```javascript
const win = wp.os.windowManager.getById( 'edit-php' );
// Both work; the predicate is harder to misuse than `! win.isMinimized?.()`
// (which used to silently coerce undefined → true on every plugin author's
// first attempt before the predicates landed).
if ( win && ! win.isMinimized() ) win.minimize();
```

#### `Window.send( channel, payload? )` — Stable

Publish a payload into this window's content. **The unified abstraction over iframe `postMessage` and native render-callback dispatch — plugin authors write the same call regardless of how the window is rendered.**

For iframe windows (real iframes OR `iframeContent`-shorthand natives) the payload is delivered as `os-window-send` via `postMessage` and surfaces inside the iframe via `wp.os.on( channel, cb )` (the iframe-bridge installs the API on `wp.os`). For pure-native windows the payload is dispatched in-process to subscribers the render callback registered through its `windowApi.on( channel, cb )`.

```javascript
const win = wp.os.windowManager.getById( 'wpdc-editor' );
win.send( 'editor:open-file', { path: 'plugins/foo/bar.php', line: 42 } );
```

Plugin authors **never** branch on window type, **never** reach for `postMessage`, **never** read `win.iframe` to decide a code path. Same call, same channel, same payload — the framework picks the right delivery mechanism.

#### `Window.on( channel, cb )` — Stable

Subscribe to a channel published BY this window's content. Mirror of `send()` for the inbound direction. Iframe content publishes via `wp.os.send( channel, payload )` (installed by the iframe-bridge); native render code publishes via the `windowApi.send` it received in the render context. Both land here.

Use `'*'` for a wildcard subscription that fires on every channel from this window.

```javascript
const win = wp.os.windowManager.getById( 'wpdc-editor' );
const off = win.on( 'editor:saved', ( { path } ) => {
    toast( `${ path } saved.` );
} );
```

Returns an unsubscribe handle. Subscribers are dropped automatically when the window closes — no leak even if the caller forgets to detach.

#### Cross-window peer connections — `wp.os.connect()` works for both types

`wp.os.connect( windowId )` opens a typed pub/sub channel with a peer window. **The connection works identically whether the target is iframe or native**: for iframe targets the bridge negotiates a handshake then crosses the iframe boundary via `postMessage`; for native targets it routes synchronously through the same in-process channel bus that powers `Window.send/on`. The caller writes the same `conn.send(topic, payload)` / `conn.subscribe(topic, cb)` regardless.

```javascript
const conn = wp.os.connect( 'jorvy', {
    topics: [ 'jorvy:quote-changed' ],
    onOpen: () => conn.send( 'jorvy:next-quote', {} ),
} );
conn.subscribe( 'jorvy:quote-changed', ( payload ) => {
    repaintQuoteWidget( payload );
} );
```

Native targets fire `onOpen` on the next microtask (no handshake to wait for); iframe targets fire it after the iframe acks the handshake. `isOpen()`, `disconnect()`, and the `os.connection.*` hook lifecycle behave identically for both kinds.

---

### `Window.setTabs( entries, activeValue? )` — Stable

Declare a native window's tabs in the window chrome. They render in the same strip an admin-page window wears under its title bar, with the same keyboard and the same look — one tab system, whatever is behind the window.

Each entry's `value` matches the `for` attribute of an `<os-tabpanel>` in the window body. The shell shows one pane and hides the rest by toggling `hidden`, never re-rendering, so a pane that owns a canvas or a live preview keeps it across tab changes.

```js
wp.os.registerWindow( {
    id: 'jorvy',
    title: 'Jorvy',
    render: ( body ) => {
        body.innerHTML = `
            <os-tabpanel for="calc">…</os-tabpanel>
            <os-tabpanel for="convert">…</os-tabpanel>
        `;
        const win = body.closest( '.os-window' );
        wp.os.windowManager.getById( 'jorvy' ).setTabs( [
            { value: 'calc',    label: 'Calc' },
            { value: 'convert', label: 'Convert' },
        ] );
        win.addEventListener( 'os-window-tab-change', ( e ) => {
            console.log( 'now on', e.detail.value );
        } );
    },
} );
```

Call it again whenever the list changes. It reconciles by `value` rather than rebuilding, so adding a tab mid-session leaves the user on the tab they were on and does not drop keyboard focus out of the strip. Pass `activeValue` only when you mean to move them deliberately; omit it and the current tab is kept.

`Window.activateTab( value )` switches tabs programmatically and fires the same event.

**Accessibility.** The strip is a `role="tablist"`, each tab a `role="tab"` wired to its pane with `aria-controls` / `aria-labelledby`. Tab enters the strip once and leaves it once (roving `tabindex`); arrow keys move within it, Home and End reach the ends, and Enter or Space activates. Activation is deliberate rather than follow-focus, because arrowing past a tab must not mount its pane.

**A tab group inside content** — a switcher within one pane, say — is not this. Use `<os-tabs>` for that; see [`components-reference.md`](components-reference.md).

---

### `wp.os.openWindow( id, opts? )` — Stable

Open (or focus) a server-registered native window by id. Symmetric with `openstation_register_window( $id, ... )` — pass the same string.

```typescript
wp.os.openWindow(
    id:    string,
    opts?: {
        source?: string;
        params?: Record< string, string | number | boolean >;
    },
): boolean;
```

Returns `true` if a window with that id is registered and was opened (or already open and focused), `false` otherwise.

Goes through the same canonical opener as the dock click + the wallpaper-icon click — so the body comes pre-populated with the cloned `<template>` declared at registration time. Plugin authors can rely on the same render-callback contract no matter which entry point opens the window.

> **Render-callback registry — `window.openStationNativeWindows`.** A PHP-registered native window pairs its `<template>` with an optional JS render callback the plugin's `script` registers at `window.openStationNativeWindows[ <id> ]`; the shell looks it up by id and invokes it with the window body. `window.openStationNativeWindows` is a **deprecated compat alias** for bundles built before the rename — the shell merges both bags at read time when opening a native window, with the canonical `openStationNativeWindows` winning on id collisions. New code must register on `openStationNativeWindows`.

**`opts.source`** — optional string identifying who triggered the open. The framework publishes `os/open-requested` on the activity bus *before* the open is processed, so analytics, do-not-disturb modes, and audit subscribers can observe the user's intent independently of the outcome:

```javascript
wp.os.openWindow( 'my-plugin/inbox', { source: 'global-search' } );

wp.os.activity.subscribe( 'os/open-requested', ( { windowId, source } ) => {
    track( 'window.open.requested', { windowId, source } );
} );
```

Conventional `source` values: `'dock'`, `'taskbar'`, `'icon'`, `'shortcut'`, `'palette'`, `'api'` (default when omitted). Custom strings are fine — pick one that matches the surface the user clicked.

**`opts.params`** — open-time arguments: *what* the window is showing this time, as opposed to *what it is*.

A native window is addressed by id, and its id is its identity: `desktop-mode-user-edit` is "the profile editor", not "the profile editor for user 12". Anything that varies per open has nowhere else to live — and a module-level variable or a shared store **does not survive a page reload**, so a restored window comes back on its default. That is exactly how the profile window used to reopen showing whoever was logged in rather than the person the user had open.

```javascript
wp.os.openWindow( 'my-plugin/contact', {
    source: 'contacts-list',
    params: { contactId: 42 },
} );
```

Read them in the render callback:

```javascript
window.openStationNativeWindows[ 'my-plugin/contact' ] = ( body, { params } ) => {
    paint( body, Number( params.contactId ) || 0 );
};
```

Rules worth knowing:

- **Params are persisted.** They are written into the session snapshot and staged back onto the window on restore, so the window reopens showing the same thing. Keep them small and serializable — ids and slugs, not objects. Values that aren't strings, finite numbers, or booleans are dropped on save rather than crashing it (one plugin's careless value must not cost every window its geometry).
- **Reopening with params retargets a live window.** `open()` focuses an existing window rather than rebuilding it, so the render callback does not re-run. The framework updates the window's params first and puts them on the [`os-window-reopened`](#os-window-reopened--stable) detail — subscribe there to repaint.
- **An argument-less reopen leaves them alone.** A dock click on an already-open profile window must not wipe whose profile it is.
- **Iframe windows ignore this.** Their URL already says what they're showing, and it round-trips through the session on its own.

```javascript
// Open the Code editor (requires the desktop-mode-code-editor extension).
wp.os.openWindow( 'wpdc-editor' );

// Cross-plugin: surface a sister plugin's monitoring dashboard.
if ( ! wp.os.openWindow( 'alcazaba-monitor' ) ) {
    // Sibling plugin isn't active — handle gracefully.
}
```

The Code editor ships as the standalone **OpenStation — Code Editor** extension; `wpdc-editor` only resolves when that plugin is active.

For programmatic deep-linking into the **Code editor** specifically (open + jump to a path/line), pair `openWindow` with the [`os-code-open` postMessage](./examples/code-editor-open.md) protocol. The shortcut `Ctrl/Cmd+Shift+E` does the same thing the user-facing way.

---

### `wp.os.openNewWindow( id, opts? )` — Stable

Spawn a **brand-new instance** of a registered native window — even when one is already open. Where `openWindow` focuses an existing instance, `openNewWindow` always mounts a duplicate.

```typescript
wp.os.openNewWindow(
    id:    string,
    opts?: { source?: string },
): boolean;
```

Returns `true` when the registry matched the id (a fresh window with id `<base>-2` / `-3` / … is now mounted), `false` when no native window is registered with that id.

Powers the dock-peek "+" button for native windows so they behave like iframe windows do: every "+" yields a duplicate. `opts.source` carries the same semantics as `openWindow`'s — it tags the `os/open-requested` activity-bus publish.

---

### `wp.os.fetch( input, init?, opts? )` — Stable

Drop-in wrapper around the global `fetch()` that drives the target window's **activity phase** while the request is in flight, and attributes the request on the activity bus. Same return type and resolution semantics as native `fetch()` — callers can `.then(r => r.json())` / `await` / `catch` unchanged.

> **The phase is painted as the status ring** — the leading mark of the title bar, in the position the app icon used to hold. That icon was a copy of the window's own dock tile a few hundred pixels below it, and a title bar has room for one mark of that size; it now carries one that changes.
>
> The ring is an `<os-save-status variant="ring" mode="icon">`, and only one of its four states fills:
>
> | Phase | Ring | Gesture |
> |---|---|---|
> | `idle` | white outline | — |
> | `pending` / `saving` | accent outline | breathes, 1.6s |
> | `saved` | accent fill, white check | overshoots and settles; the glyph fades up just behind the fill |
> | `failed` | open red outline, red bang | two decaying swells, then stops |
>
> Colour alone is not a distinction every user can make, which is why the two outcomes differ in **shape** — filled versus open, check versus bang — and not only in hue. The gestures are emphasis, so `prefers-reduced-motion` drops all three and keeps every colour, fill and glyph.
>
> The resting ring is one value in both title-bar states rather than dimming when unfocused: the ring reports a phase, and `idle` shouldn't mean something different depending on which window you last clicked.
>
> Three consequences worth knowing:
>
> - **The framework's ring claims no private channel.** It is found by `[data-os-activity-indicator]`, the same public attribute a plugin uses to mount its own `<os-save-status>` in a title-bar slot, and **every** matching element in the title bar is driven — a window showing two different phases at once would be worse than one showing none.
> - **The phase is announced too.** A ring says nothing to a screen reader, so the title bar carries a visually-hidden live region: successes politely (`Saved`), failures assertively and with the error text (`Not saved. Request failed (HTTP 500 Internal Server Error).`). The in-flight phase is deliberately silent — interrupting a user to tell them a save they started is still going is noise.
> - **The phase is mirrored to CSS** as `data-os-activity` on the title-bar element, absent while idle, so a desktop theme can react to window state without reaching into the component's shadow root.
>
> Restyling is five themeable tokens: `--os-titlebar-activity-idle-color` (at rest), `--os-titlebar-activity-color` (in flight), `--os-titlebar-activity-saved-color`, `--os-titlebar-activity-failed-color`, and `--os-titlebar-activity-size`.
>
> **Iframe windows report too.** See [`os-iframe-activity`](#os-iframe-activity--experimental) — the chromeless bridge brackets every `fetch` and `XMLHttpRequest` inside the iframe, so an admin page's own jQuery calls move the ring without knowing the shell exists.

```js
// In any window's render callback / event handler:
const res = await wp.os.fetch( '/wp-json/myplugin/v1/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify( payload ),
} );
```

That's the whole pattern. The window is `saving` for the duration of the round-trip, `saved` when the server answers with a success status, and `failed` on any other outcome — an HTTP error status (`4xx` / `5xx`, carrying `Request failed (HTTP 500 Internal Server Error).`) or a rejected fetch (network error, CORS, abort, carrying the `Error.message`) — then back to `idle`. **No CSS, no per-window plumbing, no DOM.** The ring breathes while the request is in flight, fills with a check when it lands, and stays an open red ring if it didn't.

#### Auto X-WP-Nonce

`wp.os.fetch` automatically attaches `X-WP-Nonce: openStationConfig.restNonce` to **same-origin** requests whose URL targets a WordPress REST endpoint — either pretty-permalink (`/wp-json/...`) or plain-permalink (`?rest_route=...`). Without the header, WordPress's `rest_cookie_check_errors()` demotes the cookie session to anonymous and any capability-gated route returns `401`. You no longer need to remember to attach it by hand.

When composing REST URLs inside the shell, prefer the server-provided
`openStationConfig.restUrl` root over hard-coded `/wp-json/` paths so
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

`opts` is the only addition. Resolution order for "which window's activity phase moves":

1. **`opts.window`** — explicit `Window` reference. Use when you have the handle in scope (e.g. inside a render callback that received `ctx.window`).
2. **`opts.windowId`** — id looked up via `wp.os.windowManager.getById(id)`. Use when you have the id but not the instance (it's the most common case for native-window bundles — they know their own id from `openstation_register_window( '…' )`).
3. **focused window** — `manager.getFocused()`. Default. So inside a click handler, the click already focused the window and the fetch attributes to it without any extra wiring.

`opts.silent: true` skips the phase entirely. Reserved for background polls (heartbeat, presence, count-bumps) that shouldn't read as user-initiated activity every tick. The fetch is otherwise identical.

#### Why it works

Internally, `wp.os.fetch` calls `Window.trackActivity( promise )` on the resolved target. **An HTTP error status settles the phase as `failed`, not `saved`** — native `fetch` resolves for 4xx/5xx, so the tracked promise is a derived one that rejects when `response.ok` is false, carrying `Request failed (HTTP 500 Internal Server Error).` as the indicator's tooltip. The promise you receive is the untouched native one: it still *resolves* with the error response, and your own `if ( ! res.ok )` handling is unchanged. The window enforces a **minimum saving-display time of 1.2s** so even a 50ms fetch holds `saving` long enough for an indicator to be seen — fast successes don't get lost between the click and the next paint. Concurrent fetches reference-count: 5 in-flight settle as one burst when the **last** one lands, and the burst settles **failed** if **any** of them failed (the most recent error is the one carried) — even when the final fetch itself succeeded — matching the user's "did everything go through?" mental model.

#### Migration tip

You don't need to migrate everything. Bundles that currently call native `fetch` keep working unchanged — they just don't move the window's phase or reach the activity bus. Adopt `wp.os.fetch` per call where that attribution is valuable: REST mutations (saves, deletes, tag-add/remove), data refreshes that take more than a frame, anything users would otherwise wonder "did that work?". Keep using native `fetch` for fire-and-forget telemetry, prefetches, anything users shouldn't notice.

#### Source

`src/desktop.ts` `trackedFetch`. The component built to render these phases is `<os-save-status>` — read on for the standalone component, plus `Window.trackActivity` / `Window.markActivity` for non-fetch async work.

See also [`examples/window-activity.md`](./examples/window-activity.md) for end-to-end recipes.

---

### `Window.trackActivity( promise )` — Experimental

The lower-level primitive `wp.os.fetch()` is built on. Call it directly when you have a Promise from a non-fetch source — a `postMessage` handshake, an IndexedDB transaction, a `BroadcastChannel` round-trip, a long client-side computation wrapped in `requestAnimationFrame` chains.

```js
const win = wp.os.windowManager.getById( 'my-plugin/inbox' );
await win.trackActivity( indexedDbWrite( record ) );
```

Returns the Promise unchanged so callers can chain. Multiple concurrent calls are reference-counted and the **minimum 1.2s saving-display floor** still applies — so even a 100ms IDB write holds `saving` long enough to be seen.

### `Window.markActivity( phase, opts? )` — Experimental

Manual escape hatch when the activity isn't a single Promise. Phases:

- `'idle'`    — clear. An `<os-save-status>` mounted on this window shows nothing.
- `'pending'` / `'saving'` — work in flight. Stays in this phase until you transition out; an indicator renders it as a modem-blink with a soft glow.
- `'saved'`   — settled ok. Auto-clears to `idle` after ~2.2s; an indicator flashes green.
- `'failed'`  — settled with an error. `opts.error` becomes the indicator's `error` attribute, and so its `title` tooltip. Auto-clears after ~6s.

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

### `wp.os.getWindowConfig( id )` — Stable

Read the bundle-bound config blob shipped via the `'config'` arg on `openstation_register_window( $id, [ 'config' => … ] )`. Returns `undefined` when no config was registered for `id`.

```js
const cfg = wp.os.getWindowConfig( 'my-plugin-cron' );
// → { restNonce: '…', eventsUrl: 'https://…', … }
```

The blob is delivered through the same payload path as `wp_localize_script` `extra['data']` — it lands on both eager and lazy script-load paths, so it's the recommended way to ship REST URLs / nonces / capability flags / anything session-bound to a native-window bundle.

See [`examples/window-with-config.md`](./examples/window-with-config.md) for a full recipe.

### `wp.os.debug.window( id )` — Stable

Read-only diagnostic snapshot of what the shell knows about a registered native window:

```js
wp.os.debug.window( 'my-plugin-cron' );
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
- `'lazy'` — only the shell-injected `<script data-os-vendor>` tag is present.
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
manager.getPrimaryDesktopId(): string;     // see below
manager.createDesktop(): Desktop;          // append a new one + return it
manager.switchDesktop( id ): void;         // make `id` the active desktop
manager.closeDesktop( id ): void;          // delete `id`; its windows migrate to the active desktop
```

Lifecycle hooks fire on each operation: `HOOKS.DESKTOP_CREATED`, `HOOKS.DESKTOP_CLOSED { desktopId, migratedTo }`, `HOOKS.DESKTOP_SWITCHED { from, to }`.

##### Primary desktop — `getPrimaryDesktopId()`

The "primary" desktop is the canonical one batch operations and migration logic treat as the survivor. Default: the first desktop returned by `getDesktops()` (typically `desktop-1`). Filterable via the `os.primary-desktop-id` filter so plugins that pin a different convention (e.g. an "Inbox" desktop) can override:

```javascript
wp.hooks.addFilter(
    'os.primary-desktop-id',
    'my-plugin',
    ( defaultId, desktops ) => {
        const inbox = desktops.find( ( d ) => d.label === 'Inbox' );
        return inbox ? inbox.id : defaultId;
    }
);
```

Filter receives `( defaultId: string, desktops: Desktop[] )` and must return a string id that matches one of the existing desktops — the manager validates the result and falls back to `defaultId` on any miss.

---

#### Batch close — `closeAll()`

```typescript
manager.closeAll( options?: { exceptIds?: string[] } ): number;
```

Closes every open window (across all desktops) and returns the number actually closed. Optional `exceptIds` skips specific windows entirely — never even passed to the filter. Unlike `minimizeAll()` / `restoreFrom()` / `toggleShowDesktop()` (above, active-desktop-only), `closeAll()` is not desktop-scoped.

**Hook chain:**

| Hook | Type | Payload | Use |
|---|---|---|---|
| `os.windows.before-close-all` | action | `{ candidates: Window[] }` | Cleanup, dismiss menus, cancel pending saves |
| `os.windows.close-all` | filter | `Window[]` → `Window[]` | **Protect specific windows** by removing them from the list. Returning `[]` cancels the close entirely. |
| `os.windows.after-close-all` | action | `{ closed: number, skipped: Window[] }` | Toast, telemetry, refocus a tile |

```javascript
// Protect any window with unsaved Gutenberg edits.
wp.hooks.addFilter(
    'os.windows.close-all',
    'my-plugin/protect-drafts',
    ( windows ) => windows.filter( ( w ) => ! w.element.dataset.hasUnsaved )
);
```

```javascript
// Run from a slash-command handler:
const closed = wp.os.windowManager.closeAll();
return `Closed ${ closed } window${ closed === 1 ? '' : 's' }.`;
```

If a `Window.close()` throws, the loop catches and continues — one bad window can't abort the batch.

---

### `dock` — Stable
The **primary `Dock` instance** (or `null` if the dock element wasn't in the DOM). Always present once the shell has booted. It sits on the edge named by `dockPlacement` — `bottom` by default, `left` or `right` when the user moves it. What it holds depends on the active `desktopLayout`:

- **Unified** *(default)* — every menu, core and plugin alike, sharing one rail, with OpenStation's own system tiles grouped behind a divider.
- **Classic** — plugin-contributed top-level menus only (core menus go to `sideDock`).

`setBadge( id, count )` is the canonical way to surface a numeric count on a tile; calls fire `os/badge-changed` on the activity bus with the rail discriminator. **The discriminator follows the rail's orientation, not its role:** `rail: 'taskbar'` for a horizontal rail (the primary dock on the bottom edge), `rail: 'dock'` for a vertical one — the Classic side rail (`sideDock`), and also the primary dock itself once the user moves it to the left or right. Code that reacts to badges should key off `itemId`, or accept both values; treating `'taskbar'` as "the primary rail" holds only while the dock is on the bottom. `Dock.removeSystemItem( id )` fires `HOOKS.DOCK_ITEM_REMOVED` — the symmetric counterpart of `HOOKS.DOCK_ITEM_APPENDED`. See [`docs/examples/dock-badge.md`](./examples/dock-badge.md).

> **Layout switching note** — the underlying instance is replaced when the user picks a new layout **or moves the dock to another edge** in OpenStation Preferences → Appearance. `wp.os.dock` is mutated in place so a fresh property read returns the current dock; plugins that **cache** the reference earlier should listen for `os-layout-changed` and refresh.

---

### `sideDock` — Stable
Secondary `Dock` instance that hosts **core WordPress admin menus** (Dashboard, Posts, Pages, Media, Users, Settings, CPTs, taxonomies) along the **left edge**. Non-null only when `desktopLayout === 'classic'` — `null` in Unified.

Same `Dock` API as `dock`, just with `data-os-dock-placement="left"` so its CSS selectors don't collide with the bottom rail.

```js
wp.os.sideDock?.setBadge( 'edit.php', 3 );
```

**Icon fallback:** as with the primary dock, a menu without dashicon / SVG / URL renders a letter badge in a hue derived from the title — same plugin, same colour across reloads.

---

### `desktopLayout` — Stable
Currently-active top-level layout, `'unified'` or `'classic'`. Mirrors the user's OpenStation Preferences → Appearance pick (shown there as **Unified** and **Split**) and the `data-os-layout` attribute on the shell root.

| Layout | Rails | Where core menus live |
|---|---|---|
| `unified` *(default)* | bottom | the one rail, **grouped core-first**, then a divider, then plugins |
| `classic` | side + bottom | left side bar (`sideDock`) |

```js
if ( wp.os.desktopLayout === 'classic' ) {
    // Core menus live on their own rail; `sideDock` is the one holding them.
}
```

Listen for `os-layout-changed` to react to a switch.

**`unified` re-sorts the rail** so every `isCore` tile precedes every plugin tile, which is what makes the single `.os-dock__separator--group` divider land on the core→plugin boundary. Hovering a menu tile fans its submenu out — see [the constellation](#the-constellation) below.

---

### `setBadge` — Stable

Three rails — the primary (bottom) dock, the Classic-layout side dock, and the wallpaper icons — share the same `setBadge( id, count )` shape. **The id space is unified** (a dock item's `slug`, a system tile's id, or a desktop icon's id), so plugin authors fan a count to every rail without branching to figure out which one happens to host the tile under the user's current layout:

```js
function setOrdersBadge( count ) {
    wp.os.dock?.setBadge?.(     'my-orders', count );
    wp.os.sideDock?.setBadge?.( 'my-orders', count );
    wp.os.icons?.setBadge?.(    'my-orders', count );
}
setOrdersBadge( 7 );
setOrdersBadge( 0 );  // clear
```

Three calls; the rail that owns the id paints, the others bow out silently. Each call:

- **Idempotent on the icon rail** — same count twice = no DOM mutation, no re-emit. The two Dock rails currently re-paint and re-publish `os/badge-changed` on every call, so avoid hot-looping `setBadge` with an unchanged count.
- **`0` clears** — and on the two Dock rails it also drops the client-side override so the server-declared `item.badge` resumes ownership on the next live menu refresh.
- **`> 99` renders as `99+`**.
- **Silent no-op when the id isn't on this rail** — keeps the fan-to-all-rails pattern from triple-emitting.
- **Survives a full grid rebuild** — plugin-set values persist across plugin activations / live menu refreshes.

Every applied change publishes on:

- `os/badge-changed` activity channel with `{ itemId, count, rail: 'dock' | 'taskbar' | 'icon' }`.
- `HOOKS.ICON_BADGE_CHANGED` action with `{ iconId, count, previousCount }` *(icon rail only)*.

The rails do NOT auto-suppress based on window state — that's per-app UX policy. The canonical "show 0 while my window is active" recipe lives in [`docs/examples/dock-badge.md`](./examples/dock-badge.md).

### `setArt` — Stable

The same three rails share `setArt( id, svg )`, for a tile whose icon means something different depending on state rather than counting something. Same unified id space and the same fan-to-all-rails pattern:

```js
function paintBinState( isFull ) {
    const art = isFull ? FULL_BIN_URI : EMPTY_BIN_URI;
    wp.os.dock?.setArt?.(     'my-bin', art );
    wp.os.sideDock?.setArt?.( 'my-bin', art );
    wp.os.icons?.setArt?.(    'my-bin', art );
}
paintBinState( true );
wp.os.icons?.setArt?.( 'my-bin', '' );  // restore the registered icon
```

`svg` takes the shapes `renderIcon()` accepts: a `data:` URI, an `http(s)` URL, or a dashicon class. Art naming `currentColor` is painted as a mask and follows the tile's own glyph colour; fixed-colour art keeps its own. Each call:

- **Idempotent on the icon rail** — the same art twice is a no-op.
- **`''` clears** the override and hands the tile back to its registered icon.
- **Silent no-op when the id isn't on this rail.**
- **Survives a full grid rebuild**, and applies to a tile that has not rendered yet. Setting art during boot is the normal case (the rail appends system tiles asynchronously), so the value is recorded first and painted when the tile appears.
- **Covers both desktop surfaces** — `wp.os.icons.setArt` paints the legacy `.os-icons` grid *and* the files layer's `<os-tile>` placement, since "the desktop icon for this id" means whichever one is on screen.

Every applied change publishes `os/art-changed` on the activity channel with `{ itemId, icon, rail: 'dock' | 'taskbar' | 'icon' }`.

`wp.os.icons.getArt( id )` reads the current override back, or `''` when the registered icon is still in charge.

In-tree reference: [`src/recycle-bin/icon-state.ts`](../src/recycle-bin/icon-state.ts). The Recycle Bin uses it to draw an empty bin and a bin holding something as two states of one object. It replaced a count badge there: the badge pill is positioned onto the artwork rather than beside it, and at a 20px dock tile it covered about 30% of the icon.

### `icons` — Stable

The wallpaper-icon rail. Same `setBadge` shape as `dock` / `sideDock`, plus two read helpers:

```ts
interface IconsApi {
    setBadge:   ( iconId: string, count: number ) => void;
    clearBadge: ( iconId: string ) => void;
    getBadge:   ( iconId: string ) => number;
}
```

```js
wp.os.icons.setBadge(   'os-messages', 5 );
wp.os.icons.clearBadge( 'os-messages' );
wp.os.icons.getBadge(   'os-messages' ); // → 0
```

See [`setBadge`](#setbadge--stable) above for the full rules across all three rails.

#### `DesktopIconServerEntry.pinned` — Stable

Server-declared icons (registered via `openstation_register_icon( $id, [ 'pinned' => true ] )`) ship a boolean `pinned` flag in `config.desktopIcons[ n ].pinned`. Pinned icons render before any unpinned icon regardless of `position`, and the framework treats them as a stable system surface — built-in shortcuts like the pinned **WP Explorer** use it. Plugins that decorate icons (drag handles, custom menus) should opt out for tiles where `pinned === true`.

---

### `saveSession` — Stable
A debounced function that schedules a session write. The shell calls it automatically for window lifecycle and virtual-desktop lifecycle changes; call it after mutating session-backed state from your own code.

```javascript
window.wp.os.windowManager.focus( someWindow );
window.wp.os.saveSession();
```

Calling it is cheap and safe to do liberally — it schedules, it does not send. Writes are trailing-edge debounced and then rate limited to at most one network request per interval, so a burst of changes collapses into a single POST. Nothing is dropped to achieve that: a call that arrives too soon is delayed rather than discarded, a call made while a request is in flight is re-sent after it settles, and `pagehide` flushes the current snapshot past both the debounce and the rate limit via `navigator.sendBeacon`. The last state always reaches the server.

---

### `presence` — Stable

Framework-level presence tracking — who's currently in the OpenStation WP-Admin and what their state is. Always available, regardless of which feature plugins (chat, collaboration, …) happen to be installed. Useful for any UI that wants to surface who's around: avatar dots, "online now" lists, collaborative cursors, real-time co-editing indicators, etc.

The probe boots automatically on `os-init` and piggy-backs the WordPress Heartbeat — every tick (~15 s default in admin) the client sends `openstation_presence_active: true` plus `openstation_user_active: <bool>` (true when the user moused / typed within the last 5 minutes), and the server responds with the visible-users snapshot.

```javascript
// Synchronous lookup for a single user.
wp.os.presence.getStatus( userId );          // 'online' | 'inactive' | 'offline'

// Full snapshot (clone — safe to iterate).
const map = wp.os.presence.getAll();          // Map<number, { status, lastSeenMs, lastActiveMs }>

// Single-user record or null.
const entry = wp.os.presence.getEntry( userId );

// React to changes.
const off = wp.os.presence.subscribe( ( state ) => {
    // state.byUser is a ReadonlyMap. Fires on every tick that lands a snapshot.
    repaintBadges( state.byUser );
} );

// Force the next heartbeat tick to flag the current user as active.
wp.os.presence.markActive();

// Push a batch of presence updates into the framework store. Use this
// when your plugin has a faster delivery channel than the heartbeat
// (e.g. an SSE stream that emits per-conversation presence events) and
// you want every consumer of `wp.os.presence.*` — including
// `getStatus()` callers in unrelated plugins — to see the freshest data.
// `lastSeenMs` / `lastActiveMs` are optional; when omitted, the existing
// timestamps are preserved.
wp.os.presence.applyBatch( [
    { userId: 7, status: 'online' },
    { userId: 12, status: 'inactive', lastSeenMs: Date.now() - 90_000 },
] );
```

**State machine:**

| Status     | Meaning                                                                                     |
|------------|---------------------------------------------------------------------------------------------|
| `online`   | Heartbeat within `openstation_presence_offline_after` AND user input within `openstation_presence_inactive_after`. |
| `inactive` | Heartbeat present, but no input within `openstation_presence_inactive_after` (default 5 min). |
| `offline`  | No heartbeat in `openstation_presence_offline_after` (default 2 min).                        |

**Visibility:**

The server-side `openstation_presence_visible_users` filter gates which users surface to a given viewer. By default everyone tracked is visible to everyone tracked; plugins can narrow (e.g. "subscribers only see other subscribers") without the client knowing.

**Companion CustomEvent:** [`os-presence-changed`](#os-presence-changed--stable) fires once per status transition per user, with a `null` oldStatus on first sighting.

**See also:** [`docs/examples/presence.md`](./examples/presence.md) for an end-to-end recipe.

---

### `selection` — Experimental

Multi-selection is framework-level. Every tile canvas in the shell — the wallpaper, folder windows, and each list inside My WordPress — runs the same selection controller, so the gestures are identical everywhere: click replaces, `Ctrl`/`Cmd`+click toggles, `Shift`+click extends from the anchor, a drag on empty space draws a marquee, `Ctrl`/`Cmd`+A selects all, `Escape` clears.

```javascript
// Snapshot of the most recent selection change anywhere in the shell.
wp.os.selection.active();
// → { surface: 'files', scope: '0', keys: [ '12', '19' ], count: 2 } | null

// React to selection anywhere.
document.addEventListener( 'os-selection-changed', ( e ) => {
    console.log( e.detail.count, 'selected in', e.detail.surface );
} );
```

`surface` is `'files'` for a FilesLayer canvas and `'my-wordpress'` for a My WordPress list; `scope` narrows it (folder id, entity id). `keys` are the surface's own item keys — placement ids on the desktop, entry ids in My WordPress — as strings.

#### What a mixed selection may do

The hard part of multi-selection isn't the highlight, it's deciding what a set of unlike things can be asked to do. The rule lives in one place, `wp.os.selection.resolveCommonActions( items, actionsFor )`:

- **One item selected** → that item's own action list, untouched. Single-item menus are exactly what they were before multi-selection existed.
- **Several** → intersect by action `id`, and keep an id only when **every** contributing action declares `multi: true`.

So selecting a post and an image leaves *Move to Trash* (both offer it, both marked multi-safe) and drops *Navigate into* (post-only) and *Download* (image-only).

`multi` is opt-in on purpose. An action written against one item — "Rename…", "Share folder…", anything that opens a modal — would misbehave run twelve times over, and its author never agreed to that. Your menu entries keep working unchanged and simply don't appear in a multi-selection until you opt in.

Four fields control the multi-selection behaviour of any menu entry, on both the `os.files.tile-menu` and `os.my-wordpress.tile-context-menu` filters:

| Field | Meaning |
|---|---|
| `multi` | `true` to allow the action into a multi-selection menu. Default `false`. |
| `multiId` | Identity to intersect on, when the same *deed* carries different single-item labels. The folder tile's `delete-folder` and the file tile's `remove` both declare `multiId: 'trash'`, so a mixed selection can still be thrown away. Defaults to `id`. |
| `bulkLabel( n )` | Label for a set. Falls back to `"<label> (N items)"`. |
| `bulk( items )` | Batched runner. Called once with **the items that declared it** — see below. Without it, that item's own `onClick` runs instead. |

**Every item goes to the runner its own contributor declared.** When
actions merge under a shared `multiId` there is no rule that they
share an implementation — the folder tile and the file tile could
trash things differently, and a plugin can merge a third of its own.
So the framework groups the selection by `bulk` *function identity*
and calls each runner once with its own subset; contributors that
ship no `bulk` fan out through `onClick`.

Two things follow:

- If your action merges with a built-in and you want one batched
  call for the whole set, **share the same function reference** —
  `bulk: theSameFn`, not a fresh `bulk: ( items ) => theSameFn( items )`
  arrow at each site, which is a different identity and therefore a
  second batch. The built-in Trash entries share one reference for
  exactly this reason, so a mixed folder + file selection is one
  toast with one Undo.
- If your runner only understands your own items, you don't have to
  do anything: it will only ever be handed those.

```javascript
wp.os.hooks.addFilter(
    'os.files.tile-menu',
    'my-plugin/archive',
    ( items, placement ) => [
        ...items,
        {
            id: 'my-plugin/archive',
            label: 'Archive',
            icon: 'dashicons-archive',
            sort: 50,
            multi: true,
            bulkLabel: ( n ) => `Archive ${ n } items`,
            bulk: ( placements ) => archiveAll( placements ),
            onClick: () => archiveAll( [ placement ] ),
        },
    ],
);
```

Prefer a `bulk` runner over fan-out whenever the action talks to the server or the user: it is what turns twelve REST calls, twelve toasts and twelve Undo buttons into one of each. The built-in "Move to Trash" does exactly this.

#### `os.selection.actions` — JS filter

Fires on the **resolved** action list for a multi-selection (never for a single item, whose menu is the surface's own). Receives the merged actions plus `{ items, count }`, so you can add an entry that only makes sense for a set.

```javascript
wp.os.hooks.addFilter(
    'os.selection.actions',
    'my-plugin/compare',
    ( actions, { items, count } ) =>
        count === 2
            ? [ ...actions, { id: 'compare', label: 'Compare these two', onClick: () => compare( items ) } ]
            : actions,
);
```

#### Building your own selectable canvas

`wp.os.selection.createModel( { order } )` returns the set + anchor primitive (`set` / `add` / `remove` / `toggle` / `selectRange` / `selectAll` / `clear` / `prune` / `subscribe`) if you are wiring a surface the shell doesn't own. `order()` must return the item keys in the order the user *sees* them — that is what a `Shift`+click range walks.

---

### `createSharedStore( key, initialState )` — Stable

Cross-bundle reactive state primitive. Every plugin in OpenStation is typically built as its own Vite IIFE bundle, and module-level state defined in one bundle is **invisible** to another bundle even when both import the same source file — each bundle ends up with its own compiled copy. `createSharedStore` solves this by attaching state to a window-level slot keyed by the string you pass; the first call with a given key creates the store, every subsequent call (in any bundle) returns the SAME store. Mutations propagate; subscribers from any bundle fire on any mutation.

You only need this when you split your plugin's JS across more than one bundle. A plugin that ships a single bundle can use plain module-level state and skip the primitive entirely.

```javascript
const store = wp.os.createSharedStore( 'my-plugin/state', () => ( {
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
    setState( patch: Partial< T > ): void;          // patch + notify in one call (// object-shaped state only — warns and
                                                    // no-ops on primitive-shaped stores)
    notify(): void;                                 // wake subscribers
    subscribe( cb: ( s: Readonly< T > ) => void ): () => void;
    reset(): void;                                  // tests only
}

wp.os.createSharedStore< T >(
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

### `onWindow( id, handlers, options? )` — Stable

The typed wrapper for "subscribe to *this one* window's lifecycle." Filters every action by `windowId`, lets you bind every event in one shot, and returns a single unsubscribe handle. Use this instead of hand-rolling `addAction(HOOKS.WINDOW_*)` calls + windowId checks unless you specifically want lifetime control over each subscription.

```typescript
wp.os.onWindow(
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
const off = wp.os.onWindow( 'my-plugin/inbox', {
    focused:   () => clearAttention(),
    blurred:   () => repaintBadge(),
    closed:    () => recordSession(),
} );

// App-lifetime — keeps firing every time the window reopens.
wp.os.onWindow(
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

### `activity` — Stable

Cross-plugin activity bus. The transport layer for "thing X happened in plugin A; plugin B might care." Built on top of `wp.hooks` with three benefits over raw `doAction`/`addAction`:

1. **A documented naming convention** (`<plugin>/<event>`).
2. **A predictable hook prefix** (`os.activity.<channel>`) so devtools can list activity traffic as a discrete group. The channel's separator becomes a period on the hook bus: `my-plugin/thing-happened` is registered as `os.activity.my-plugin.thing-happened`. This only matters if you reach the bus through raw `wp.hooks`; `publish`/`subscribe`/`filter` take the channel slug and handle the mapping.
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

**Built-in channels** — every framework primitive that publishes mirrors here. The `os/` namespace is the shell's own: subscribe and filter freely, but publish your own events under your plugin's slug.

| Channel | Direction | Payload | Filterable? |
|---|---|---|---|
| `os/toast-requested` | Pre-show — `showToast()` calls run through this. | `{ message, action?, duration?, persistent?, source?, meta?, cancel? }` | **Yes.** Set `cancel: true` to drop the toast. Mutate `message`/`duration`/`action`/`persistent` to rewrite. |
| `os/toast-shown` | Fire-and-forget — fires after the toast lands in the DOM. | Same shape as above. | No (filtering is too late). |
| `os/window-attention-requested` | Pre-attention — `Window.requestAttention()` runs through this filter, then routes the filtered result to the rails' `setAttention()`; direct `dock.setAttention()` / `taskbar.setAttention()` calls bypass it. | `{ windowId, mode, durationMs?, intensity?, source?, cancel? }` | **Yes.** Set `cancel: true` for DND. Mutate `mode`/`durationMs`/`intensity` to scale the animation. |
| `os/badge-changed` | Fire-and-forget — every `setBadge()` on dock / taskbar / icons mirrors here on every change. | `{ itemId, count, rail?: 'dock' \| 'taskbar' \| 'icon' }` *(rail)* | No. |
| `os/open-requested` | Fire-and-forget — `wp.os.openWindow()` publishes here BEFORE deciding `opened` vs `reopened`. | `{ windowId, source }` | No. |
| `os/presence-changed` | Per-transition mirror of the `os-presence-changed` CustomEvent. | `{ userId, oldStatus, newStatus, lastSeenMs, lastActiveMs }` | No. |
| `os/presence-snapshot-applied` | Batch-level — fires after every presence snapshot OR `applyPresenceBatch()`. | `{ applied: number, transitions: number }` | No. |
| `os/game-score-recorded` | Fire-and-forget. Fires after a game's `submitScore()` write resolves, on both the free-play and challenge-completion paths. | `{ game, score, meta, windowId, challengeId? }` | No. |
| `os/upload-hud-complete` | Fire-and-forget. Fires when a file dropped on the shell finishes uploading. Published by the progress HUD rather than the uploader — the upload runs on XHR (the only transport reporting determinate progress) and never routes through `wp.os.fetch`. | `{ filename, attachmentId }` | No. |

**Plugin channels** — pick a `<plugin>/<event>` slug and publish. Augment `ActivityChannelMap` for compile-time payload checking:

```ts
import type {} from 'openstation/activity';

declare module 'openstation/activity' {
    interface ActivityChannelMap {
        'my-plugin/something-happened': { id: number; reason: string };
    }
}
```

```javascript
// Publish — peers see it immediately.
wp.os.activity.publish( 'inbox/unread-changed', { total: 5 } );

// Subscribe.
const off = wp.os.activity.subscribe(
    'inbox/unread-changed',
    ( { total } ) => repaintWidget( total ),
);

// Filter — let plugins veto / shape a value before peers see it.
const safeOutgoing = wp.os.activity.filter(
    'inbox/outgoing-payload',
    payload,
    { author: currentUserId },
);
```

**See also:** [`docs/event-driven-framework.md`](./event-driven-framework.md) for the bigger pattern.

**Comments window channels** — the native Comments window publishes on:

- `desktop-mode-comments/approved` — `{ ids: number[]; counts: CommentCounts }`
- `desktop-mode-comments/unapproved` — same payload shape
- `desktop-mode-comments/spamd` / `desktop-mode-comments/unspamd` — same
- `desktop-mode-comments/trashd` / `desktop-mode-comments/untrashd` — same
- `desktop-mode-comments/replied` — `{ parentId: number; postId: number }`
- `desktop-mode-comments/edited` — `{ id: number }`
- `desktop-mode-comments/insights-opened` — `{ email: string }`

Subscribe to drive plugin badges, audit logs, or to refresh widgets that surface pending counts.

---

### `heartbeat` — Stable

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
const off = wp.os.heartbeat.contribute(
    'my-plugin/active',
    () => isActive() ? true : undefined,
);
```

**Incoming — `subscribe`.** React to a field on the `heartbeat-tick` response. Multiple subscribers compose; one failing subscriber doesn't strand peers (errors go to `console.error`).

```javascript
const off = wp.os.heartbeat.subscribe( 'my-plugin/payload', ( v ) => {
    applyServerSnapshot( v );
} );
```

**Why this exists.** Without a shared bus, every feature that wants to ride Heartbeat re-binds `jQuery(document).on('heartbeat-send', …)` itself. Three problems: (1) the boilerplate is identical, (2) no plugin can see what other plugins are contributing on the same tick, (3) a thrown error in any handler can strand later handlers on the same event. The bus consolidates the wiring, exposes the typed channel surface, and isolates errors per supplier/subscriber.

**Built-in consumer.** `presence` contributes `openstation_presence_active` + `openstation_user_active` and subscribes to `openstation_presence`. Read [`src/presence/index.ts`](../src/presence/index.ts) for the canonical pattern.

---

### `wp.os.wallpaper` — suspend / resume — Experimental

Pause the animated wallpaper while a foreground surface (a game, a heavy canvas tool) renders its own scene, without tearing the wallpaper down.

```typescript
interface WallpaperSuspendApi {
    suspend( reason: string ): void;   // hold a reason (refcounted)
    resume( reason: string ): void;    // release one hold on the reason
    isSuspended(): boolean;            // any reason currently held?
}
```

Refcounted per reason string: two `suspend( 'my-plugin/thing' )` calls need two `resume( 'my-plugin/thing' )` calls; distinct reasons stack independently. On the first held reason the shell freezes the current frame into a bitmap overlay (best-effort — WebGL capture can fail on some drivers, in which case the stopped canvas simply keeps its last frame) and re-emits **`os.wallpaper.visibility`** with the *effective* state (`document.hidden || suspended`), so every wallpaper that wires the standard visibility action pauses its ticker with zero changes. A tab re-focus while suspended keeps reporting `hidden` — suspension wins. The scene is never destroyed.

The precise signal is the companion action **`os.wallpaper.suspend`** *(Experimental)*, fired on every suspended/resumed transition with `{ id, suspended, reasons }` (`id` = active canvas wallpaper id or `null`; `reasons` = currently held reason strings). Wallpapers that want to distinguish "tab hidden" from "game running" subscribe to it via `wp.os.hooks`.

The games framework calls `suspend( 'game:<windowId>' )` / `resume(…)` around every game window automatically.

---

### `wp.os.mio` — Experimental

Mio: a soft-body companion that floats over the wallpaper, falls onto nearby windows, watches the pointer, and can be dragged anywhere. Off by default; users toggle it from its **Mio** tile on the bottom dock, and can hide that tile from OpenStation Preferences → Apps & Plugins.

Full documentation — architecture, the simulation, the configuration table, the reason the canvas is never interactive — is in [mio.md](./mio.md).

```typescript
interface MioApi {
    isEnabled(): boolean;
    enable(): Promise< void >;             // persists the preference
    disable(): void;                       // persists; stops + hides, keeps the context
    setStyle( partial ): void;             // the user's look; applies live AND saves to their account
    getLook(): MioLook;                    // the user's own look, as stored
    commitStyle(): void;                   // write it now — what closing the panel calls
    resetStyle(): void;                    // forget the saved look, restore the site's Mio
    toggle(): Promise< void >;             // what the menu entry calls
    getPosition(): { x: number; y: number } | null;   // viewport coords, null when off
    setPosition( x: number, y: number ): void;        // no-op when off
    getConfig(): MioConfig;
    setConfig( partial: PartialMioConfig ): void;  // merged, clamped, applied live
}

interface MioLook {
    appearance: Partial< MioAppearance >;   // colour, ring, glow, hologram, body, eyes
    physics: Partial< MioLookPhysics >;     // silhouette, shuffle, idle wobble
}
```

`enable()` / `disable()` / `toggle()` write the per-user OS setting `mioEnabled` exactly as the dock tile does. **The user's look is per-user too** — it rides the same OpenStation Preferences blob as `mioStyle`, so a Mio built on a laptop is waiting on the phone. Only the resting position is browser-local (`localStorage`, `os-mio-position`): where Mio sits is a fact about one screen, how it looks is a fact about the person.

`setStyle()` takes a **flat bag** of appearance keys and the look-physics keys — `shapePreset`, `shapeLobes`, `shapeAmount`, `shapeAngle`, `shapeShuffle`, `idleWobble`, `idleWobbleSpeed` — and splits them itself. Anything else is dropped: `radius` is a size rather than a look, and the spring constants are the site's. Every call applies live *and* records the change; `commitStyle()` flushes it immediately (the style panel calls it on close). Reach for `setConfig()` when a plugin wants to adjust Mio programmatically without that adjustment becoming the user's saved look.

```js
// Give Mio a shape, and stop it changing on its own.
wp.os.mio.setStyle( { shapePreset: 'star', shapeShuffle: 0 } );
```

The first `enable()` lazy-loads `assets/js/mio[.min].js` and PixiJS — nothing about the simulation ships in `desktop.min.js`, so a user who never switches Mio on never downloads it.

```js
wp.os.ready( () => {
    // A bigger, calmer Mio for a kiosk screen.
    wp.os.mio.setConfig( {
        appearance: { radius: 90, glow: 14 },
        physics: { magnetStrength: 1400, floatAmplitude: 20 },
    } );
    void wp.os.mio.enable();
} );
```

Server-side defaults come from the `openstation_mio_config` PHP filter; the `os.mio.config` JS filter gets the last word before mount. Both are re-sanitized, so out-of-range values are clamped rather than rejected.

---

### `wp.os.games` — Experimental

The desktop games surface: a shared registry (the hub's game grid + per-game detail panel repaint live), and a launcher that opens games in native windows.

The framework is **off by default** — an admin opts in site-wide (OpenStation Preferences → Features → Extended options; PHP filter `openstation_games_enabled`). While disabled, the shell config carries **`gamesEnabled: false`**: the server registers no games, no hub window, and no REST routes, and the shell skips the challenges Heartbeat channel. `wp.os.games` still exists (same API object), but the registry stays empty unless your own JS registers into it — check `window.openStationConfig?.gamesEnabled` before wiring games UI of your own.

```typescript
interface GamesApi {
    register( entry: GameRegistryEntry ): void;
    unregister( id: string ): void;
    list(): GameRegistryEntry[];              // `os.games` filter applied
    get( id: string ): GameRegistryEntry | undefined;
    subscribe( cb: () => void ): () => void;  // registry-change listener
    launch( id: string, opts?: { challenge?: GameChallengeContext } ): Promise< void >;
    getPlaytime(): Promise< Record< string, number > >;  // my `game id => total seconds`
}
```

**Registration model.** The canonical path is PHP: `openstation_register_game( $id, $args )` declares the discovery metadata (title, icon, description, `score_columns`, `config`) plus a `script` handle. The shell registers a metadata **stub** at boot — enough to paint the hub tile and the game's scoreboard — and `launch()` loads the script lazily on first play. The loaded script publishes the full def on the global:

```javascript
// Inside the game bundle (window.openStationGames is the games
// analogue of window.openStationWallpapers):
window.openStationGames = window.openStationGames || {};
window.openStationGames[ 'my-plugin-puzzle' ] = {
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

`render` receives a `GameLaunchContext`: `container` (the window body), `config` (the PHP-registered blob), `challenge` (set when the run is an accepted score-to-beat challenge: `{ id, scoreToBeat, scoreMeta, challengerName }`), `submitScore( { score, meta } )` (routes to the leaderboard, or to the challenge-completion endpoint in challenge mode), and `close()`. The framework suspends the wallpaper for the window's lifetime and opens the window as `os-game-<id>` (no dock tile).

**Score announcements.** Once a `submitScore()` write resolves, the launcher publishes `os/game-score-recorded` on the activity bus with `{ game, score, meta, windowId, challengeId? }` (both paths publish; `challengeId` only on challenge completion). Games play in their own window, so this is how leaderboards elsewhere in the shell find out they went stale: the hub's scoreboard subscribes and reloads the page the viewer is on. Subscribe to it if your plugin paints anything derived from scores. A failed write publishes nothing.

**Framework config keys**. For server-registered games, the payload merges framework-level keys underneath the game's own `config` (the game's keys win): **`config.wordsUrl`** is the URL of the shared ~20k-word dictionary asset (`assets/games/words.txt`) — identical for every player, so seeded games (Alphabet Soup's date-seeded daily puzzle) generate the same grid worldwide. Parse it with the framework loader (`src/games/dictionary.ts` — `loadDictionary( url )` → `{ size, pick( minLen, maxLen, rng ) }`); the PHP-side URL + filter is `openstation_games_words_url` in [hooks-reference.md](./hooks-reference.md).

**Share cards**. `src/games/share-card.ts` renders a finished run as a 1200×630 PNG on a plain canvas (`renderShareCard( canvas, data )`) and `shareScoreCard( canvas, filename, title )` runs the one-tap chain: native share sheet with the file attached → clipboard image → download, reporting which path ran. Deliberately image-only — no URL, no caption. Alphabet Soup's game-over panel is the reference integration.

JS-only registrations (passing `render` directly to `register()`) work for the launcher, but scores/challenges only persist for games also registered server-side — the REST routes 404 unknown ids.

The registry mirrors onto the **`os.games`** JS filter (constant `HOOKS.GAMES`), applied on every `list()` read.

**Play time**. The launcher automatically tracks how long each game window is in front of the player — the clock pauses while the window is minimized — and flushes whole-second increments to `POST /desktop-mode/v1/games/{game}/playtime` (silently, roughly once a minute plus once on close). Totals are per user per game and accumulate for life across sessions and days; increments are also bucketed per site-timezone day (rolling window, default 30 days). `getPlaytime()` returns the current user's lifetime map; the full `GET /desktop-mode/v1/games/playtime` response is `{ playtime: { <game>: seconds }, daily: { <game>: { 'YYYY-MM-DD': seconds } }, today: 'YYYY-MM-DD' }`. The hub's detail panel renders a Steam-style strip from it — "Play time (last two weeks)" + "Play time (total)". Games don't need to do anything to participate. Server-side see `openstation_games_get_playtime()` / `openstation_games_get_playtime_daily()` and the `openstation_game_playtime_recorded` action in [hooks-reference.md](./hooks-reference.md).

**Heartbeat channel.** Challenges deliver live over the shared bus: the shell contributes `openstation_games_subscribe: { challengesVersion: <lastSeenUpdatedAtMs> }` on every tick and the server answers with `openstation_games: { challenges: GameChallengeRow[], serverTimeMs, truncated }` — version-gated (quiet ticks carry nothing) and capped via the `openstation_games_heartbeat_max_rows` PHP filter. Recipients of a fresh challenge get a browser notification (toast fallback) + a persistent **Accept & Play** toast; challengers are notified when their challenge completes.

**Config global.** The Games hub bundle reads `window.openStationGamesConfig` (`restNonce`, `gamesUrlBase`, `challengesUrl`, `usersSearchUrl`), localized onto the `desktop-mode-games` handle.

---

### `broadcast` / `subscribe` — Stable

Cross-window pub/sub. Fan-out fan-in primitive — any module can publish on a topic and every subscriber (in the parent shell, in any open iframe) receives the payload. Distinct from `wp.os.activity` in two ways: it crosses iframe boundaries, and it has no `<plugin>/<event>` typing — topics are free-form strings.

```typescript
wp.os.broadcast< T >( topic: string, payload: T ): void;

wp.os.subscribe< T >(
    topic: string,                         // or '*' for wildcard
    cb:    ( payload: T, meta: { topic: string } ) => void,
): () => void;
```

```javascript
// Notify every window that a record changed.
wp.os.broadcast( 'posts/updated', { id: 42 } );

// React across windows.
wp.os.subscribe( 'posts/updated', ( { id } ) => {
    refetchIfShowing( id );
} );
```

**Mirror onto activity** — every `broadcast()` *also* publishes on the activity bus under the same topic name (so long as it matches the `<plugin>/<event>` shape), so in-tab subscribers can use the unified `activity.subscribe` surface without knowing whether the producer ran broadcast vs activity. Cross-iframe fan-out stays the broadcast bus's job.

**The `os.<type>.changed` topic family** — the framework's own content-change traffic rides this bus. One topic per content type (`post`, `page`, `attachment`, `comment`, any CPT slug, `shop_order` for WooCommerce orders), payload:

```typescript
{
    source: 'admin' | 'editor' | 'heartbeat' | 'recycle-bin' | string, // emitter id
    action: 'created' | 'updated' | 'trashed' | 'untrashed' | 'deleted',
    ids:    number[],
}
```

Publishers: the server-side changelog relayed through the chromeless footer (`source: 'admin'`), the block-editor save-watcher (`'editor'`), the Heartbeat catch-all (`'heartbeat'` — may repeat a change delivered earlier by a faster path; treat refreshes as idempotent), and client-side emitters that identify themselves (`'recycle-bin'`, `'posts-window'`, your plugin). Subscribing to your type's topic is all a list window needs to stay live; publishing is one `openstation_content_changes_record()` call server-side (see [hooks-reference.md → Content-change realtime layer](./hooks-reference.md#content-change-realtime-layer)) or a direct `wp.os.broadcast()` client-side — set a distinctive `source` so you can skip your own echoes.

**Heartbeat fields** — the shell contributes `openstation_content_changes_seen_ts` (server-ms high-water mark, `0` on the handshake tick) and consumes `openstation_content_changes: { ts, entries: [ { ts, type, action, ids } ] }`, re-broadcasting each fresh entry on this bus. Timestamps are server-clock; the first tick is a pure handshake so client/server skew can never drop changes.

---

### `showToast( opts )` — Stable

Show a top-of-shell toast. Returns a dismiss callback the caller can invoke early — useful when the state the toast was reporting changes (e.g. dismiss "X arrived" toasts the moment the related window mounts).

```typescript
wp.os.showToast( {
    message: string;
    duration?: number;                                     // ms; default 4000. Ignored when persistent.
    action?: { label: string; onClick: () => void };       // optional CTA
    persistent?: boolean;                                  // never auto-dismiss
    dismissible?: boolean;                                 // show a close (×) button
    onDismiss?: () => void;                                // called when × is clicked
} ): () => void;
```

```javascript
// Transient (default) — auto-dismisses after `duration`.
const dismiss = wp.os.showToast( {
    message: 'Saved',
    duration: 3000,
    action: { label: 'Undo', onClick: () => undo() },
} );

// Persistent — never auto-dismisses; stays until the user acts on it
// or a caller invokes the returned dismiss fn. This is how the shell
// surfaces a pending WordPress core update (once, instead of the
// per-window nag). Add `dismissible` for a close (×) button, and
// `onDismiss` to persist the fact it was closed.
const clear = wp.os.showToast( {
    message: 'WordPress 7.0.2 is available.',
    persistent: true,
    dismissible: true,
    onDismiss: () => rememberDismissed(),
    action: { label: 'Update now', onClick: () => openUpdateScreen() },
} );
```

A `persistent` toast has no auto-dismiss timer — clear it via the action button (which dismisses on click), the close (×) button when `dismissible` is set, or the returned dismiss callback. `duration` is ignored when `persistent` is set.

**`duration` is a countdown, not a deadline.** It only runs while the toast is unattended: hovering the toast, or moving focus into it (Tab to the action button, a screen reader entering it), pauses the timer and resumes it on release with the time it had left, floored at 1.2s. So an `action` the user is reaching for cannot be deleted mid-reach — which also means a toast can outlive its `duration` by as long as the user keeps it under the pointer. And if a dismissal happens while the toast holds focus — clicking `Undo` removes the element the button lives in — focus is handed back to the last element outside the toast stack that had it, instead of falling to `<body>`. Both behaviours are the `<os-toast>` element's `held` state driving the timer; see the [`<os-toast>` hold contract](components-reference.md#menus--overlays) if you are building on the element directly.

Routes through the `os/toast-requested` activity filter before painting; plugins can register a filter that returns `null` (or sets `cancel: true`) to suppress, or mutates the payload to amplify / quiet the toast.

---

### `repaintLoadingOverlays()` — Stable

Re-paint every currently-loading window's spinner overlay through the customization pipeline (per-window `config.loading.render` + `WINDOW_LOADING_OVERLAY` filter).

**You almost never need this.** Filters registered inside `wp.os.whenReady( … )` are picked up automatically by the shell's post-`HOOKS.INIT` sweep, including for F5 / session-restored windows that were constructed before the plugin script ran. The canonical plugin shape:

```js
wp.os.whenReady( () => {
    wp.os.hooks.addFilter(
        'os.window.loading-overlay',
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
    wp.os.hooks.addFilter(
        'os.window.loading-overlay',
        'my-skin/lazy-branded',
        brandRenderer,
    );
    wp.os.repaintLoadingOverlays();
}
```

Idempotent + cheap — windows that already finished loading are unaffected.

---

### `renderKeyedList( host, items, opts )` / `clearKeyedList( host )` — Stable

Keyed-list reconciler for any plugin that paints a dynamic list of items into a DOM container. Reuses element instances when keys match across renders so event listeners survive data updates — the only reliable way to keep clicks working on rows that may re-render mid-press.

```javascript
wp.os.renderKeyedList( hostEl, items, {
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
wp.os.clearKeyedList( hostEl );
```

**Why this matters.** Without keyed reconciliation, list re-renders typically do `host.innerHTML = ''` followed by a full rebuild. If the user is mid-press on a row when the repaint happens, `mousedown` fires on the OLD node, the rebuild destroys it, and `mouseup` lands on a new node — the browser does NOT synthesize a `click` and the user's tap silently does nothing. Use `mousedown` (not `click`) for selection-style listeners on elements that may be removed by future state changes.

---

### `registerNamespace( name, api )` — Stable

Bless a plugin-owned subnamespace under `wp.os`. Plugins that ship their own public surface (`wp.os.<your-plugin>`) call this once at boot to publish their api object on the shell.

```javascript
wp.os.registerNamespace( 'my-plugin', {
    open:  () => { /* ... */ },
    close: () => { /* ... */ },
    state: () => readState(),
} );

// Later, in any other plugin:
wp.os[ 'my-plugin' ].open();
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
| `iconSvg` | `string` | no | Raw `<svg>…</svg>` markup rendered inline; takes precedence over `icon`. Used internally by the iframe-command bridge to forward `@wordpress/icons` elements; plugins may set it when shipping a one-off glyph is easier than enqueueing a dashicon. |
| `eager` | `boolean` | no | When `true`, the command appears on the empty-input palette without the user typing `/`. When falsy (default), it only surfaces after `/`. Eager and slash-only surfaces are **disjoint** — typing `/` hides eager commands. Use `eager: true` for contextual / always-relevant actions (block editor shortcuts, site-wide toggles); leave it off for utility commands the user deliberately invokes. |
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
- `ctx.confirm( message, details? ) → Promise<boolean>` — ask the user to confirm a destructive action. Default implementation renders the framework's `<os-confirm-dialog>` (same surface as `wp.os.confirm`); the `Promise<boolean>` contract is stable. Use this from any command whose `run()` does something irreversible.

  ```javascript
  run: async ( args, ctx ) => {
      const ok = await ctx.confirm(
          'Close every open window?',
          'You will lose any unsaved iframe state.'
      );
      if ( ! ok ) return 'Cancelled.';
      const closed = wp.os.windowManager.closeAll();
      return `Closed ${ closed } window${ closed === 1 ? '' : 's' }.`;
  }
  ```

**Command lifecycle hooks** — fire around every `run()`. Subscribe via `wp.hooks`:

| Hook | Type | Payload | Use |
|---|---|---|---|
| `os.command.before-run` | filter | `{ proceed: true, slug, args, command }` → return same shape with `proceed: false` (and optional `reason`) to cancel | Capability gates, audit log, "developer mode only" commands |
| `os.command.after-run` | action | `{ slug, args, command, result }` | Telemetry, post-run toast |
| `os.command.error` | action | `{ slug, args, command, error }` | Centralised error reporting |

```javascript
// Block /close_all_windows for non-admin users.
wp.hooks.addFilter(
    'os.command.before-run',
    'my-plugin/gate',
    ( gate ) => {
        if ( gate.slug === 'close_all_windows' && ! openStationConfig.currentUserIsAdmin ) {
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
window.wp.os.registerCommand( {
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
window.wp.os.registerCommand( {
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
            headers: { 'X-WP-Nonce': openStationConfig.restNonce },
        } );

        ctx.close();
        return `Comments enabled on post ${ id }.`;
    },
} );
```

**Errors** thrown from `run` are caught and rendered as an error bubble — the panel doesn't crash.

**Live-refresh on plugin install/activate.** If your plugin's script is declared via `openstation_register_command_script()` (see the PHP docs), the shell injects it into the current shell page when the user installs or activates your plugin — your commands appear in the palette **without a reload**. For live *unregistration* on deactivation, set `owner` to the same WordPress script handle:

```javascript
window.wp.os.registerCommand( {
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
window.wp.os.unregisterCommand( 'echo' );
```

---

### `listCommands()` — Stable
Returns a snapshot of every currently registered command as an array. Useful for a debug console or a "help" meta-command.

```javascript
window.wp.os.listCommands().forEach( ( c ) => console.log( `/${ c.slug } — ${ c.label }` ) );
```

---

### `registerDestructiveAdminAction( entry )` — Stable

Mark a wp-admin URL pattern as a **destructive (redirect-back) action** so a click on that URL navigates the *source* iframe in place instead of opening a new window. The same UX vanilla wp-admin gives for Trash / Untrash / Delete row actions — the row disappears, the list refreshes with an "Undo" notice on the same screen.

Built-ins are pinned with no opt-in: Core's `trash`, `untrash`, `delete` on posts plus the comment-moderation set (`spam`, `unspam`, `spamcomment`, `unspamcomment`, `trashcomment`, `untrashcomment`, `deletecomment`, `approvecomment`, `unapprovecomment`). Register a predicate for any plugin-specific equivalent.

```javascript
const unregister = window.wp.os.registerDestructiveAdminAction( {
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

**Cross-bundle:** the registry routes through `wp.os.createSharedStore`. A `register…` call from a plugin's own Vite IIFE is visible to the dispatcher (which runs inside the shell's `window-system` bundle). See `AGENTS.md` § "Cross-bundle state".

---

### `unregisterDestructiveAdminAction( id )` — Stable

Remove a previously registered predicate. Idempotent — no-op when the id is unknown.

```javascript
window.wp.os.unregisterDestructiveAdminAction( 'woocommerce/trash-order' );
```

---

### `listDestructiveAdminActions()` — Stable

Snapshot (defensive copy) of every plugin-registered destructive-admin-action predicate. Built-in Core whitelist entries are NOT included — they're not registry entries.

```javascript
window.wp.os.listDestructiveAdminActions().forEach( ( e ) => console.log( e.id ) );
```

---

### `wp.os.ai.ask( query, opts? )` — Experimental

Programmatic access to the AI Copilot — same endpoint the built-in overlay talks to. Resolves to an `AskResult`; rejects on network errors, HTTP failures, or abort.

The built-in content tools (`search_posts`, `search_pages`, `search_comments`, `search_comments_by_post`) run WordPress's native keyword search — the model derives a `query` from the user's request and the tools return matching titles + excerpts. (Posts, pages, and terms are no longer pre-analyzed; comment spam scoring is the only automatic AI analysis.) When you continue an exhausted search with `resumeTool` / `startOffset`, the original query is reused automatically.

```javascript
const res = await wp.os.ai.ask( 'where do I manage categories?' );
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
wp.os.ready( () => {
    wp.os.registerCommand( {
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
const res = await wp.os.ai.ask( 'hey turn on the lights', {
    tools: 'aiCallable',
} );
// res.answer_type === 'tool_call'
// res.toolCall === { slug: 'turn_lights', args: 'ON', result: 'Lights ON.' }
// res.message   === 'Lights ON.'  // string returns are lifted into message
```

Why opt-in: AI tool-calling is a paraphrasing channel, and handing the model every registered command (including destructive ones like `/delete_all_posts`) would turn a typo into a catastrophe. `aiCallable` is the single flag each command author decides for themselves. The PHP-side filter `openstation_ai_command_allowed` provides a second line of defence for per-role gating.

**Security notes.**

1. The server never executes a client-harvested command — it returns `{ answer_type: 'tool_call', tool: { slug, args } }` and the client invokes `run()` locally. The model can't reach through to any server-side code via this path.
2. For server-side tools, register a read-only [WordPress Ability](https://developer.wordpress.org/apis/abilities-api/) with `wp_register_ability()` — the assistant picks up every read-only ability automatically. Its `permission_callback` gates execution and input/output are schema-validated by Core.
3. Command `description` is fed to the model verbatim — treat it as untrusted surface for plugin authors exactly as you'd treat any other plugin string.

**Natural-language replies — `followUp: true`**

By default, `ask()` runs in **one-shot** mode: when the AI picks a command, `res.message` is whatever the command's `run()` returned (typically a short status string like `"Light is ON."`). That's fast and cheap — one OpenAI round-trip — but the AI never actually writes anything about the action.

Opt into **agentic** mode with `followUp: true` and `ask()` fires a second `/ai/search` request after the command runs. The server summarises the outcome in the voice of the system prompt:

```javascript
const res = await wp.os.ai.ask( 'hey turn on the office light', {
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
    const res = await wp.os.ai.ask( 'find my post about málaga', {
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

### `registerTitleBarButton( def )` — Experimental

Add a custom button to the title bar of any matching window. The right surface for cross-window verbs ("connect to", "live preview", "broadcast"). Predicate decides which windows show the button; you can render an `<os-window-button>` with a click handler, or own the host entirely with a custom `render`.

**Returns** nothing on success. **Throws** a `RegistrationError` on validation failure — the error message names the bad fields, so wrap the call in `try`/`catch` if you need to branch or route it through your own monitor pipeline.

**`TitleBarButtonDef`:**

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | Unique. `[a-z0-9_/-]+` — same `vendor/sub-id` shape that `openstation_register_window` / `openstation_register_widget` accept (slashes welcome). Wider than `registerSettingsTab`'s id, which can't use slashes (that value is also used in CSS selectors). Re-registering replaces. |
| `label` | `string` | Tooltip + aria-label. |
| `icon` | `string` | Dashicons class (`'dashicons-foo'`), inline SVG (`'<svg>…</svg>'`), or built-in key (`'minimize'` / `'menu'` / etc.). |
| `placement` | `'left' \| 'right'` | Default `'left'` (next to title). `'right'` lands before the window controls. |
| `order` | `number` | Default 100. Sorts within placement. |
| `match` | `( window ) => boolean` | Predicate against the live `Window` instance. Throwing equals not-matching. |
| `onClick` | `( window, ev ) => void` | Optional. Fires **exactly once per user activation** — wired to the button's `os-button-activate` CustomEvent (not raw `click`), so no doubles, no swallowed events when the title-bar drag tracker races. Skip if you use `render`. |
| `render` | `( host, window ) => void` | Optional. Owns the `<os-window-button>` host entirely; bind your own click + dropdown. |
| `owner` | `string` | Optional. Set to your script handle for live-unregister-on-deactivate. |

```javascript
wp.os.ready( () => {
    wp.os.registerTitleBarButton( {
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
openstation_register_titlebar_button_script( 'my-plugin-titlebar' );
```

### `unregisterTitleBarButton( id )` / `listTitleBarButtons()` — Experimental

Remove a title-bar button by id, or read a snapshot of every registered button def (sorted by `order`). Unregistering is idempotent — unknown ids are silent no-ops — and every open window's title bar repaints to drop the button. Buttons registered with an `owner` are also auto-unregistered when the owning plugin deactivates.

---

### `registerUnfocusEffect( def )` — Experimental

Register a visual treatment applied to every window that **isn't** focused — surfaced in **OpenStation Preferences → Effects → "Unfocused windows"**. The built-in effects (`darken` dims, `frost` blurs to frosted glass, `grayscale` drains colour) are registered through this same hook; plugins add their own the identical way. The framework owns *when* the effect runs (focus changes, the user's selection, minimized-window exclusion); your def owns *what* it does.

**Throws** a `RegistrationError` on validation failure (bad/missing `id`, the reserved id `'none'`, or neither `className` nor `apply` provided).

**`UnfocusEffectDef`:**

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | Unique. `[a-z0-9_/-]+` (slashes welcome for `vendor/sub-id`). `'none'` is reserved (it is the selector's "no effect" sentinel). Re-registering replaces. |
| `label` | `string` | Shown in the selector. |
| `description` | `string` | Optional. Shown under the selector when this effect is active. |
| `className` | `string` | Optional. CSS class toggled on the window root (`.os-window`) while unfocused. The cheap, declarative path — ship the matching rule in your stylesheet. |
| `apply` | `( el ) => void` | Optional. Imperative apply, called with the window root when it becomes unfocused under this effect. Use when a static class isn't enough. |
| `clear` | `( el ) => void` | Optional. Teardown, called when the window regains focus or the effect is switched away. Must undo `apply`; the framework removes `className` for you. |
| `owner` | `string` | Optional. Set to your script handle for live-unregister-on-deactivate. |

At least one of `className` / `apply` is required.

> **Windows hosting a WebGL `<canvas>` are exempt.** Native Pixi scenes (content graph, posts mind-map / tag-cloud, the About scene) render a live WebGL canvas in the parent DOM; a CSS `filter` over such an element can trigger a GPU context loss that crashes the canvas's render loop. The engine detects a `<canvas>` in the window root and skips the effect for that window. Canvases inside *iframe* windows live in a separate document and aren't affected.

```javascript
wp.os.ready( () => {
    wp.os.registerUnfocusEffect( {
        id:        'acme/blur',
        label:     'Blur',
        className: 'acme-window--blur', // ship `.acme-window--blur { filter: blur(2px); }`
        owner:     'my-plugin-effects',
    } );
} );
```

PHP companion (so plugins activated mid-session surface in the selector live):

```php
openstation_register_unfocus_effect_script( 'my-plugin-effects' );
```

The raw `os.unfocus-effects` JS filter receives the registry array on every read, mirroring `os.wallpapers` — use it to reorder, remove, or conditionally swap effects. The user's selection persists in the `unfocusEffect` OS-settings key (effect id or `'none'`; default `'darken'`), readable via `getOsSettings().unfocusEffect`.

### `unregisterUnfocusEffect( id )` / `listUnfocusEffects()` — Experimental

Remove an effect by id, or read the current list (post-filter). `listUnfocusEffects()` always includes the built-ins (`darken`, `frost`, `grayscale`) unless a filter removed them.

---

### `registerWindowReveal( def )` — Experimental

Register a **window reveal** — the transition that uncovers a window's content once it has finished loading, surfaced in **OpenStation Preferences → Effects → "Window reveal"**. The shell paints an opaque surface over the window body for the whole load (the same span the `<os-spinner>` overlay covers), then animates that surface's `clip-path` away. The twelve built-ins (`sweep`, `rise`, `diagonal`, `iris`, `diamond`, `curtain`, `shutter`, `blinds`, `slats`, `mosaic`, `radar`, `obturator`) are registered through this same hook.

The surface is a **sibling of the `<iframe>`** inside `.os-window__body`, never a wrapper and never inside the framed document. Nothing is injected into the page being revealed, the content keeps its own compositing layer and hit-testing, and native windows are treated identically to iframe windows. A reveal cannot interfere with what it reveals.

**Throws** a `RegistrationError` on validation failure (bad/missing `id`, the reserved id `'none'`, a missing `from`/`to`, a `from`/`to` pair that cannot interpolate, or an `easing` the browser cannot parse).

**`WindowRevealDef`:**

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | Unique. `[a-z0-9_/-]+` (slashes welcome for `vendor/sub-id`). `'none'` is reserved (the selector's "no reveal" sentinel). Re-registering replaces. |
| `label` | `string` | Shown in the selector. |
| `description` | `string` | Optional. Shown under the selector when this reveal is active. |
| `from` | `string` | `clip-path` for the covering surface at the START. Must cover the whole body — anything it leaves uncovered shows the content early. Required unless you supply `layers`. |
| `to` | `string` | `clip-path` at the END. Must be empty or fully off-box, so the content is completely uncovered when the animation lands. Required unless you supply `layers`. |
| `layers` | `{ from, to, color? }[]` | Several independent covering layers instead of one. See **Multi-layer reveals** below. |
| `render` | `() => { element, play }` | Build the covering DOM yourself. See **Rendering your own** below. Supply exactly one of `from`/`to`, `layers`, or `render`. |
| `duration` | `number` | Optional, ms. Defaults to `460`. Clamped to 80–4000. Overridden by the user's OS-Settings speed and by the theme token — see **Speed** below. |
| `easing` | `string` | Optional CSS easing. Defaults to `cubic-bezier( 0.33, 0, 0.2, 1 )`. Validated at registration: an easing `Element.animate()` cannot parse is rejected there, instead of throwing at play time with the covering surface over the window. |
| `surfaceColor` | `string` | Optional `background` for the covering surface, overriding the theme token. Reach for it only when the paint **is** the reveal — see the note below. |
| `edgeColor` | `string` | Optional `background` for the trailing edge, overriding the theme token. A multi-layer reveal usually wants this **darker** than its surface. |
| `edgeLag` | `number` | Optional, ms the leading edge trails the surface. Defaults to `70`; `0` drops the edge layer. Clamped to 0–600. Overridden outright by the `--os-window-reveal-edge-thickness` theme token. |
| `owner` | `string` | Optional. Your script handle, as a grouping tag. The live-unregister sweep on plugin deactivation is **not wired for reveals yet** — see **Registration is JS-only** below. Setting it now means your reveal is swept the moment that sweep lands, with no def change. |

> **`from` and `to` are a matched pair, not two independent values.** CSS only interpolates a `clip-path` between values using the **same shape function** — and, for `polygon()`, the same **vertex count** and fill rule. A mismatched pair is not an error to the browser: it jumps between the two values at the halfway mark, which reads as a flicker on a window that just finished loading. Registration rejects a mismatched shape function outright rather than letting that ship. Vertex counts are your responsibility; build both endpoints from one function so the ring structure cannot drift.

```javascript
wp.os.ready( () => {
    wp.os.registerWindowReveal( {
        id:       'acme/rise',
        label:    'Rise',
        // Same shape function at both ends, so the pair interpolates.
        from:     'inset( 0% 0% 0% 0% )',
        to:       'inset( 0% 0% 100% 0% )',
        duration: 420,
        owner:    'my-plugin-reveals',
    } );
} );
```

**Multi-layer reveals.** One `clip-path` describes one region, so anything it leaves uncovered *is* uncovered. When the effect depends on pieces **overlapping** each other, that isn't enough — and `layers` is the answer: what the user sees uncovered becomes whatever *all* the layers leave uncovered, an intersection rather than a shape.

**Rendering your own.** `render` is the escape hatch for effects a stack of clipped boxes cannot express. It returns `{ element, play }`: the shell appends your element as the reveal's single layer, then calls `play({ duration, easing, delay })` when the moment comes and hangs teardown off the animations you return.

You still get the shell's timing for free — when the reveal plays, how long, the user's speed override, the spinner hand-off, reduced-motion, and cleanup. What you own is the DOM and the animations over it.

`obturator` is the built-in that needs it, and the reason is instructive. A lens iris has a **cyclic** overlap: every leaf lies over the next, and the last tucks back under the first. That is a circular dependency, and paint order is a linear one — no stack of DOM layers can represent it. Built from layers, the last one has nothing drawn over it and keeps a visibly disproportionate share of the covered area, which reads as one flat region exactly where a seam belongs.

As SVG the problem dissolves rather than being worked around: six equilateral wedges tile a hexagon over the window and each slides tangentially, under a `<mask>` built from the same paths. Nothing restacks — every frame is one `translate` per wedge plus mask compositing, so it stays deterministic and on the compositor. Each wedge's own stroke is what makes the seams render regardless of what is painted over it.

```javascript
wp.os.registerWindowReveal( {
    id:      'acme/iris',
    label:   'Iris',
    edgeLag: 0,             // a rendered reveal has no trailing-edge layer
    render:  () => {
        const element = buildMySvg();
        return {
            element,
            play: ( { duration, easing, delay } ) =>
                bladesOf( element ).map( ( blade ) =>
                    blade.animate(
                        [ { transform: 'rotate(0deg)' }, { transform: 'rotate(48deg)' } ],
                        { duration, easing, delay, fill: 'both' },
                    ),
                ),
        };
    },
} );
```

Every layer shares the reveal's duration and easing.

**Give neighbouring layers different `color`s.** This is not decoration — it is the only thing that makes an overlap visible. Layers of one colour composite into a single silhouette however they are shaped: the part on top is indistinguishable from the part beneath, so the lying-across that makes a mechanism a mechanism never renders. Different tones and every overlap draws itself, because the upper layer's tone wins and its boundary across the lower one *is* the seam. `obturator` shades its six leaves as if lit from above.

The trailing edge cannot do this job. Every edge layer paints behind every surface layer, so an edge only ever shows `union( edges ) − union( surfaces )` — one band around the uncovered area, never per-part seams. Multi-layer reveals normally want `edgeLag: 0`.

```javascript
wp.os.registerWindowReveal( {
    id:      'acme/split-doors',
    label:   'Split doors',
    edgeLag: 0,
    layers:  [
        { from: 'inset( 0% 50% 0% 0% )', to: 'inset( 0% 100% 0% 0% )', color: '#3a3a47' },
        { from: 'inset( 0% 0% 0% 50% )', to: 'inset( 0% 0% 0% 100% )', color: '#4a4a59' },
    ],
} );
```

**Two layer kinds.** The **surface**, painted in `--os-window-reveal-surface` (**white** by default — it has to be opaque or there is nothing to reveal *from*), and behind it an optional **edge**, painted in `--os-window-reveal-edge` (**`transparent`** by default, i.e. off).

Either layer whose paint resolves to nothing is **dropped rather than animated**. That is what makes `transparent` a working "turn this layer off" value for a theme, and what keeps the off-by-default edge from costing an animation on every window load. The edge runs the *same* `from` → `to` keyframes over a slightly longer duration, so it is permanently a little less far along and peeks out past the surface as a band hugging the clip boundary.

That is why you never describe an edge shape: a time lag follows any geometry. `blinds` gets six thin lines, `iris` an opening ring, `radar` a rotating spoke — and so does a shape you invent, with no extra work.

The edge colour ships as **`transparent`**, and while it computes that way the shell drops the layer instead of animating something invisible — so the default costs no element and no animation. A theme turns it on by giving the token a colour (or a gradient), with no JS and no per-reveal configuration. Two further knobs:

| | |
|---|---|
| `--os-window-reveal-edge-thickness` | How wide the band is. `15%` / `0.15` is a fraction of the reveal's **travel** (holds its apparent width at any speed or window size); `70ms` / `0.07s` is an absolute lag. Undeclared by default, in which case the def's `edgeLag` decides. Overrides `edgeLag` outright — thickness belongs to the theme's look, not to one reveal. |
| `edgeLag: 0` on a def | Opts a single reveal out of having an edge at all. |

**Speed.** The duration a reveal actually runs at resolves highest-first:

1. **The user's OS-Settings speed** (`windowRevealDuration`, ms; `0` means "per reveal"). An explicit choice, and the one thing a theme must not out-rank.
2. **The `--os-window-reveal-duration` theme token** — a theme's house pace. Undeclared by default. Accepts `420ms`, `0.42s`, or a bare `420`.
3. **The def's own `duration`.**

Whatever wins, `edgeLag` is scaled by the same ratio, so the edge band keeps its apparent width at any speed — its width is a fraction of the travel, not a span of time.

**Behaviour worth knowing:**

- **The reveal always plays**, including on loads fast enough that the spinner's 120 ms entry delay meant it never painted. What varies is only when the animation starts: after the spinner's 250 ms fade-out when there was a spinner, immediately when there was not.
- **It replays on every load edge** the spinner replays on — a reload, an in-window navigation, a tab switch — not only on first open.
- **`prefers-reduced-motion` skips the animation** and uncovers the content directly. Same for environments without the Web Animations API.
- **The colours are theme tokens**: `--os-window-reveal-surface` (white) and `--os-window-reveal-edge` (`transparent` — no edge). A def can override them with `surfaceColor` / `edgeColor`, or per layer with `layers[].color`, but should not unless the paint is the point. `obturator` is the only built-in that does, and only per layer: its six leaves have to differ from one another or the mechanism reads as a single shape.
- **A desktop theme can recommend a reveal**, via `recommendedOsSettings.windowReveal` and `recommendedOsSettings.windowRevealDuration` — applied once on first activation, or on demand from the Themes tab's "Apply recommended layout and effects" button.
- **Registration is JS-only.** Unlike unfocus effects, there is no `openstation_register_window_reveal_script()` PHP companion yet, so a reveal registered by a plugin activated mid-session appears in the selector only after a reload — and a deactivated plugin's reveal stays listed until a reload too (`owner` is recorded, but nothing sweeps by it on deactivation yet). Same known gap as palettes.

The raw `os.window-reveals` JS filter receives the registry array on every read, mirroring `os.unfocus-effects` — use it to reorder, remove, or conditionally swap reveals. The user's selection persists in the `windowReveal` OS-settings key (reveal id or `'none'`, the default — reveals are opt-in), readable via `getOsSettings().windowReveal`. An unknown id (a deactivated plugin's reveal still named in user meta) resolves to no reveal rather than to a substitute, and starts working again the moment that plugin re-registers it.

See [`docs/examples/window-reveal.md`](./examples/window-reveal.md) for a copy-paste recipe, including how to build an interpolable `polygon()` pair.

### `unregisterWindowReveal( id )` / `listWindowReveals()` — Experimental

Remove a reveal by id, or read the current list (post-filter). `listWindowReveals()` always includes the twelve built-ins unless a filter removed them. Unregistering is idempotent; a reveal unregistered while a window is mid-load leaves that window's content uncovered rather than stranded under a surface it can no longer animate.

---

### `wp.os.relations` — Experimental

Window content relations: which piece of content each window shows, and how windows group around a shared **root** (a post edit window is the root; its comment / media windows are children). The shell draws visual ties between group members — see [`registerWindowLinkRenderer`](#registerwindowlinkrenderer-def---experimental) for the pluggable rendering and [`docs/examples/window-links.md`](./examples/window-links.md) for recipes.

**`WindowContentRef`** — the per-window identity record:

| Field | Type | Notes |
|---|---|---|
| `type` | `string` | Object type: any post type slug, `comment`, `media`, or your namespaced `vendor/order`. Must match `/^[a-z0-9_/-]+$/`. |
| `id` | `number \| string` | Object id. |
| `root` | `{ type, id }` | Optional. The root object this window's content belongs to. Omit when this window IS the root. |
| `links` | `Array<{ type, id, rel? }>` | Optional. Outbound references from this content to OTHER objects (the bridge fills these for post editors automatically, capped at 32). `rel: 'references'` (default) draws the tie FROM this window TO the target ("my content points at that" — hyperlinks, terms); `rel: 'child'` reverses it ("that belongs to ME" — a post's embedded/featured media) and renders as a `child-root` edge, identical to a `root` tie. Links never re-root anything. |
| `label` | `string` | Optional human label for renderers/tooltips. |
| `related` | `RelatedEntityItem[]` | Optional. Ready-to-open navigation targets related to this content — what the title bar's **"Related" button** lists (see below). Built server-side for posts/pages and capped at 64; never affects group membership or edges. |
| `previewUrl` | `string` | Optional. Front-end preview URL for this content — what the title bar's **"Preview" (eye) button** opens (see below). Built server-side for post/page/CPT editors of viewable post types (autosave-aware, carries a `preview_nonce`); the engine silently drops non-same-origin values. Never affects group membership or edges. |
| `source` | `'config' \| 'bridge' \| 'api'` | Stamped by the engine — never set it yourself. |

**API:**

| Method | Returns | Notes |
|---|---|---|
| `get( windowId )` | `WindowContentRef \| undefined` | Current identity of a window. |
| `set( windowId, ref \| null )` | `void` | Set or clear an identity. Throws a `RegistrationError` on a malformed ref. The `os.window-links.content` JS filter runs on every set. |
| `groups()` | `WindowLinkGroup[]` | Every relation group: `{ key, root, rootWindowIds, children }`. `rootWindowIds` is focus-recency ordered and may be empty (children open, root closed). The `os.window-links.groups` filter applies on every read. |
| `edges()` | `WindowLinkEdge[]` | The derived directed ties between open windows — `{ fromWindowId, toWindowId, kind: 'child-root' \| 'reference', bidirectional }`. `child-root` points a child at its root ("belongs to" — the built-in renderer puts its larger endpoint dot there); `reference` points at a window showing something this content `links` to; mutual references merge into ONE edge with `bidirectional: true` (large dots at both ends). The `os.window-links.edges` filter applies on every read. This is what the render host feeds to the active renderer. |
| `groupOf( windowId )` | `WindowLinkGroup \| undefined` | The group a window belongs to. |
| `related( windowId )` | `string[]` | The other window ids tied to this one — same-group members plus reference-edge endpoints. |
| `subscribe( cb )` | `() => void` | Fires on identity/membership changes; returns an unsubscribe. |

**How identities arrive** (any of the three):

1. **Automatically** — the chromeless bridge announces the identity of every admin iframe page ([`os-content-identity`](./bridge-protocol.md)), resolved server-side in real admin context: post/page/CPT editors are roots; comment-edit and attached-media screens arrive pre-rooted at their parent post. PHP plugins extend this via the `openstation_window_content_identity` filter (see [hooks-reference](./hooks-reference.md)).
2. **At open time** — `WindowConfig.content?: WindowContentRef` seeds the identity the moment a window opens (native windows, session restores).
3. **Programmatically** — `wp.os.relations.set( windowId, ref )`.

```javascript
wp.os.relations.set( myWindowId, {
    type: 'acme/order',
    id: 77,
    root: { type: 'acme/customer', id: 12 },
    label: 'Order #77',
} );
wp.os.relations.related( myWindowId ); // → sibling window ids
```

**Events** — both dispatched as document CustomEvents and on the hook bus:

| CustomEvent | Hook | Detail |
|---|---|---|
| `os-window-content-changed` | `os.window-links.content-changed` | `{ windowId, content, previous, source }` |
| `os-window-link-groups-changed` | `os.window-links.groups-changed` | `{ groups }` — fires on MEMBERSHIP change only, never on move/resize or focus reorder. |

**JS filters:** `os.window-links.content` (`( ref, { windowId, source } ) => ref | null` — rewrite or suppress an identity as it's set), `os.window-links.groups` (reshape the computed group list on read), `os.window-links.edges` (reshape the derived directed-edge list on read — add, drop, or redirect ties), `os.window-links.renderers` (the renderer registry list), `os.window-links.renderer` (`( id ) => id` — force-swap the active renderer without touching the user's setting).

### The "Related" title-bar button — Experimental

Any window whose content identity carries `related` items shows a **Related** button (network icon, right side of the title bar, registered through the public `registerTitleBarButton` surface as `desktop-mode/related-entities`). Clicking it opens a dropdown grouped by `item.group` — built-in groups render first (`comments`, then `terms/*`, then `media`, then `links`), vendor groups after in arrival order, each headed by its `groupLabel` — and picking an item opens `item.url` as its own desktop window. Native URL remaps are deliberately **not** consulted: the menu exists for filtered deep links (`edit-comments.php?p={id}`), which a native window opened by id would drop — so the classic filtered screen always opens, even when a native replacement is enabled. The button appears/disappears live as the identity changes: iframe navigation re-announces it, and inside the block editor the bridge's save-watcher refetches a server-recomputed identity after every real (non-autosave) save — adding a category, linking a post, or attaching media updates the menu without a reload. It hides whenever the resolved list is empty.

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

**Where items come from:** the server builds them for posts/pages during the admin page render (comments with count, assigned terms, associated media) and any screen can contribute via the `openstation_window_related_entities` PHP filter (see [hooks-reference](./hooks-reference.md)). Client-side, the resolved list runs through the **`os.related-entities.items` JS filter** on every visibility check and menu build:

```javascript
// ( items, { windowId, content } ) => items
wp.hooks.addFilter(
    'os.related-entities.items',
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

Malformed entries are dropped item-wise; a non-array return falls back to the identity's own list. Read a window's current items via `wp.os.relations.get( windowId )?.related`. Recipes: [`docs/examples/related-entities.md`](./examples/related-entities.md).

### The "Preview" (eye) title-bar button — Experimental

Any window whose content identity carries a `previewUrl` shows a **Preview** button (eye icon, right side of the title bar, just before Related; registered through the public `registerTitleBarButton` surface as `desktop-mode/editor-preview`). The URL is built server-side by `openstation_window_preview_url()` for post/page/CPT edit screens — Gutenberg **and** classic — of viewable post types, so the eye appears exactly where the front end has something to show. On `post-new.php` (unsaved auto-draft, nothing to preview yet) the eye renders **disabled** — `aria-disabled="true"`, dimmed, tooltip "Save the post to enable its preview", a click explains via toast — and enables itself the moment the first save lands (the block editor's save-watcher refetches the identity live, no reload).

Clicking the eye:

1. **Snaps the editor to the left half** (skipped below 768px, where windows maximize anyway) and puts the button in a busy state.
2. **Opens the official front-end preview immediately** (`get_preview_post_link()` output) as a companion window snapped to the right half, wearing the standard window loading overlay while it boots — id `editor-preview-{type}-{id}`, singleton per post, `ephemeral: true` (never session-restored: the URL embeds a nonce scoped to an autosave revision). The click never waits on the network: a slow save used to read as a hang.
3. **In parallel, asks the editor iframe to autosave** over the bridge (see [bridge-protocol](./bridge-protocol.md), "Editor-autosave query") — the same thing Gutenberg's own Preview button does. When the round-trip reports an actual save, the companion is silently `swapReload`ed (at the fresher preview link when one was returned), so the preview reflects what's on screen even when its first load raced the save. The eye's busy pulse clears when the save settles; `not-dirty` / no-editor settles change nothing server-side and schedule no refresh.

Front-end documents carry no chromeless bridge, so the shell wires click-to-focus for them directly: a pointerdown anywhere inside a same-origin non-admin iframe document (the preview companion, the home-page default window) focuses its window, exactly like clicking inside an admin iframe does — re-wired across navigations and silent refreshes.

The recorded editor↔preview **pairing** then drives the lifecycle: the companion **tracks typing live** (see below), **auto-reloads whenever the post is saved** (via the `os.{type}.changed` broadcast every save path emits — block-editor save-watcher, classic-editor footer emitter, Heartbeat catch-up — debounced, and navigating instead of reloading when the previewUrl itself changed, e.g. draft→publish), **closes when the editor closes or navigates to different content**, and **toggles off on a second eye click** (`aria-pressed` tracks the state). Closing the preview never touches the editor. After the initial placement the shell never re-snaps either window — move, resize, or unsnap freely; the pairing survives.

**Live updates while typing.** While a pairing is open, the shell asks the editor iframe to watch its own content (`os-editor-live-watch` — typing detection must live iframe-side, keystrokes never cross the frame boundary). In Gutenberg the watcher observes block-list / title **reference** changes (an autosave round-trip leaves both references untouched, so its own saves can never loop) and, after a settle window (default **1500 ms** since the last edit), autosaves via `__unstableSaveForPreview()` and nudges the shell (`os-editor-live-saved`) to refresh the companion. The classic editor has no reactive store — there the watcher listens for typing on the title/content/excerpt fields and inside every TinyMCE editor, and each settle forces the server autosave core would otherwise only run on its ~60 s heartbeat. Because those events also fire for things that are not user edits (TinyMCE adds an undo level on **blur**, and emits `SetContent` on any programmatic write), and because core's own autosave can go out for a post nobody touched (`getPostData()` re-serializes TinyMCE into `#content` as a side effect, which moves core's compare string on its own), both the settle and the refresh nudge are gated on a content fingerprint read directly off the editors. A settle or a completed autosave carrying content the preview already shows is silent; see [`bridge-protocol.md`](bridge-protocol.md) for the full mechanics. The watch is re-armed automatically whenever the editor page reloads while the pairing is open — the classic editor reloads on every manual save, and the pairing keeps tracking typing across it. Tune or disable via the `os.editor-preview.live` filter below; the settle window is deliberately a pause-detector, not per-keystroke.

**Refreshes are double-buffered and silent.** Live (and save-driven) refreshes go through `Window.swapReload( url? )`: the new front-end render loads into a twin iframe stacked **underneath** the visible one at full opacity — a normal, fully-rasterized paint target, covered by the opaque old frame while it loads (deliberately not `opacity: 0`-on-top or `visibility: hidden`: browsers defer rasterizing invisible iframes and revealing one flashes its blank background first). When the load lands, the old frame is removed in the same tick — an **instant, animation-free cut** to the ready-painted new content, with **no loading overlay, no blank frame, and the scroll position carried across** (same-origin only). A newer refresh supersedes an in-flight one; a hung load is abandoned after 20 s with the visible frame untouched; explicit URLs pass the same same-origin gate as `navigateTo()`. On completion the `os.window.reloaded` action fires with `silent: true` (the classic overlay reload fires it without the flag, at reload start). `swapReload` is a public method on every iframe-backed window — any plugin refreshing a window on a timer can use it instead of `reload()` to avoid strobing the overlay.

**JS surface** (hook bus + matching document CustomEvents):

| Hook | Kind | Payload |
|---|---|---|
| `os.editor-preview.window-config` | Filter | `( config: WindowConfig, { editorWindowId, content } ) => config` — reshape the companion before it opens (geometry, `initialState`, title). An invalid return is ignored with a console warning. |
| `os.editor-preview.live` | Filter | `( { enabled: true, debounceMs: 1500 }, { editorWindowId, content } ) => config` — live-update behavior per pairing. Return `{ enabled: false }` for save-driven reloads only; `debounceMs` clamps to 500–30000 iframe-side. |
| `os.editor-preview.opened` (CustomEvent `os-editor-preview-opened`) | Action | `{ editorWindowId, previewWindowId, content }` |
| `os.editor-preview.closed` (CustomEvent `os-editor-preview-closed`) | Action | `{ editorWindowId, previewWindowId, reason: 'toggled' \| 'editor-closed' \| 'preview-closed' \| 'content-changed' }` |

```javascript
// Open every preview as a free-floating window instead of split view.
wp.hooks.addFilter(
    'os.editor-preview.window-config',
    'my-plugin/floating-previews',
    ( config ) => ( { ...config, initialState: 'normal', width: 480, height: 720 } ),
);
```

The PHP-side control point is the `openstation_window_preview_url` filter (rewrite or suppress the URL per post — see [hooks-reference](./hooks-reference.md)). Related: `WindowConfig.ephemeral?: boolean` is a general flag — any window opened with it is excluded from session snapshots and never restored on boot.

### `registerWindowLinkRenderer( def )` — Experimental

Register (or replace) a **window-link renderer** — how the relation ties between related windows are drawn. The built-in `svg-splines` (curved connectors terminated by circular dots on a `pointer-events: none` layer *behind* the windows: the larger dot marks a child's root, both ends large for mutual references — circles are rotation-invariant, so ties look right at any approach angle) registers through this same hook. The user picks the active renderer in **OpenStation Preferences → Windows → Window links**; only one renderer is mounted at a time.

**`WindowLinkRendererDef`:**

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | Unique, `/^[a-z0-9_/-]+$/`; namespace yours `vendor/sub-id`. `none` is reserved. |
| `label` | `string` | Shown in the OpenStation Preferences selector. |
| `description` | `string` | Optional, shown under the selector. |
| `mount` | `( ctx ) => teardown` | Mount into the link layer; return (or resolve to) a teardown. |
| `owner` | `string` | Optional script handle for live unregistration on plugin deactivation. |

**`WindowLinkRendererContext`** (the `ctx` handed to `mount`): `container` (the BASE link layer — always behind every window; you own its children), `elevatedContainer` (a sibling layer the host lifts to the focused group's z-ceiling — draw an edge here when `edge.elevated` is true so the focused window's ties ride above other windows; ignore it entirely for the old everything-behind-windows behavior), `getFrame()` (pull the current `WindowLinkFrame` snapshot), `onFrame( cb )` (push subscription — fires rAF-coalesced during window drag/resize and on group-structure changes; returns an unsubscribe).

**`WindowLinkFrame`**: `{ groups, edges, obstacles, container: { width, height } }`. **`edges` is what renderers should iterate** — `[ { fromWindowId, toWindowId, kind, bidirectional, focused, elevated, from, to, fromZIndex, toZIndex } ]` with direction and mutual-merging already resolved (`elevated` marks edges touching the focused window — route those to `ctx.elevatedContainer`); `from`/`to` are `{ x, y, width, height }` rects relative to the layer, `null` when that endpoint is minimized / snapped into split view (`snapped-left` / `snapped-right` — a half-screen tile draws no ties; they reappear the moment the window is dragged back out) / on another virtual desktop (skip the edge). `obstacles` (`[ { windowId, rect, zIndex } ]`) lists EVERY visible window on the desk for occlusion-aware anchoring. The built-in renderer anchors each endpoint by preference: (1) the **shortest edge-to-edge connection** between the two windows (side-by-side windows connect straight across the gap at the overlap midpoint, offset windows via their facing corners) when that point is visible; (2) the classic center-ray border anchor while visible; (3) the midpoint of the closest visible border stretch when a higher window covers both — so a tie never appears to sprout from a window that is hiding its real endpoint. The pure helpers (`closestBorderAnchors`, `visibleBorderAnchor`, `isPointVisible`, `anchorOnBorder`, `controlPoint`) are exported from `src/window-links/geometry.ts` for custom renderers. `groups` (`[ { key, root, members: [ { windowId, role, content, rect, focused, state } ] } ]`) remains available for renderers that want group-level visuals (hulls, badges).

The dual pull/push contract makes SVG/DOM **and** canvas/Pixi renderers first-class: DOM renderers redraw in `onFrame`; a Pixi renderer appends its canvas to `container`, runs its own ticker, and polls `getFrame()` (load Pixi via `wp.os.loadModules( [ 'pixijs' ] )`). See [`docs/examples/window-links.md`](./examples/window-links.md) for both shapes, plus the PHP `openstation_register_window_link_renderer_script()` opt-in that live-loads your renderer on plugin activation.

The user's choices persist in OS-settings keys, all readable via `getOsSettings()`:

| Key | Values | Where |
|---|---|---|
| `windowLinksEnabled` | `boolean` (default `true`) — master switch; off unmounts the visuals and disables the group behaviors | Features |
| `windowLinkRaiseOnFocus` | `boolean` (default `true`) — raise directly-tied windows when a group member is focused | Features |
| `windowLinkHighlight` | `boolean` (default `true`) — outline + glow on related windows of the focused member | Features |
| `windowLinkRenderer` | renderer id or `'none'` (default `'svg-splines'`; unknown ids fall back to the built-in) | Effects |
| `windowLinkVisibility` | `'always'` (default) \| `'focus'` \| `'off'` | Effects |

Whatever the visibility setting, the link layers **hide while Overview runs** (fading out on `os.overview.entering`, back in on `os.overview.exited`): overview lays windows out as scaled CSS-transform thumbnails, which the offset-based frame geometry can't see, so ties would keep pointing at the pre-overview positions.

While a group member is focused (and the switches allow it), the render host stamps `os-window--linked` on its relative windows (an accent outline plus a soft halo, themeable via `--os-window-link-accent` / `--os-window-link-glow`) and **raises the windows directly tied to it** via `windowManager.raise()` (a silent restack; no focus events, minimized windows stay minimized). The raise is direction-aware, following the derived edges rather than raw group membership: focusing the **root** surfaces every child and reference peer (each carries an edge to it); focusing a **child** surfaces its parent and reference peers only — its siblings share the group (and still get the highlight) but stay where they are. And the ELEVATED link layer lifts to the group's z-ceiling so the ties **touching the focused window** draw over every other window, the group's own lower members included (a root-focused group shows its lines across the children); only the top window paints above them, and since edges anchor on window borders its endpoint dots sit right on its edge. Ties between two unfocused windows stay on the base layer, behind everything — an edge never draws over a window just because that window shares a group with the focused one. Focus a window with no ties and both layers rest behind all windows.

### `unregisterWindowLinkRenderer( id )` / `listWindowLinkRenderers()` — Experimental

Remove a renderer by id, or read the current list (post-filter). `listWindowLinkRenderers()` always includes the built-in `svg-splines` unless a filter removed it.

---

### `Window.setTitle( title )` — Stable

Update a window's title bar from outside it. Useful for plugins that want to retitle a preview window as the user types ("Live Preview — My Post"), prefix with status, etc. Fires `os.window.title-changed` with `{ windowId, title }` so other subscribers can react.

```javascript
const w = wp.os.windowManager.getById( 'my-preview' );
w.setTitle( `Live Preview — ${ postTitle }` );
```

---

### `Window.markContentLoading()` / `Window.markContentLoaded()` — Stable

Drive the spinner overlay over a window's body programmatically. Mirrors the `ctx.window.markLoading` / `ctx.window.markReady` pair available inside a native `render` callback — these methods are the equivalent for code that holds a `Window` instance from outside.

```javascript
const w = wp.os.windowManager.getById( 'my-app' );

// Show the spinner (e.g. before refetching the body's data).
w.markContentLoading();

await refetchData();
w.appendBody( renderTable( data ) );

// Hide the spinner, then fade the content in.
w.markContentLoaded();
```

Idempotent: calling `markContentLoading()` twice in a row only fires `WINDOW_CONTENT_LOADING` once; the same edge-trigger logic applies to `markContentLoaded()`.

A refetch that resolves inside the 120 ms show delay never paints a spinner, so the pair is cheap to reach for on work that is usually fast. When one does paint, the content waits for its fade-out rather than appearing under it.

The framework calls `markContentLoaded()` automatically when:
- An iframe window's chromeless bridge posts `os-ready`.
- A native window's `render( body )` callback returns synchronously (next animation frame).
- A native window's `render( body )` returns a `Promise` (when the promise resolves).

Plugins only need to call these directly for **refetch** patterns or for **event-listener-driven async loads** the framework can't observe.

See also: [the `os-window-content-loaded` CustomEvent](#os-window-content-loaded--stable) and the [`HOOKS.WINDOW_CONTENT_LOADED`](#hookswindow_content_loaded) action.

---

### `Window.setHighlight( mode, opts? )` — Experimental

Toggle a visual ring on a window from outside it.

```javascript
const w = wp.os.windowManager.getById( 'edit-post' );
w.setHighlight( 'preview' );           // temporary ring (clear yourself on mouseleave)
w.setHighlight( 'persistent' );        // sticky ring
w.setHighlight( null );                // clear
w.setHighlight( 'preview', { color: '#f59e0b' } );  // override colour
```

`'preview'` and `'persistent'` are visually distinct; the shell does NOT auto-clear either — that's the caller's responsibility. CSS variable: `--wp-window-highlight-color` (default `--wp-admin-theme-color`).

Every change fires `HOOKS.WINDOW_HIGHLIGHT_CHANGED` on the hook bus with `{ windowId, mode, color? }`, so onboarding / drag-bridge / guidance plugins can react without observing DOM mutations:

```js
wp.os.hooks.addAction(
    wp.os.HOOKS.WINDOW_HIGHLIGHT_CHANGED,
    'my-plugin/highlight-tracker',
    ( { windowId, mode } ) => { /* … */ },
);
```

---

### `Window.shake()` — Stable

Briefly jiggle the window element horizontally — the classic MSN-Messenger nudge affordance. Lets any plugin request "look at me" attention on its own window programmatically (e.g. a chat plugin on inbound nudge, a CI plugin on a broken build).

```javascript
const w = wp.os.windowManager.getById( 'my-window' );
w.shake();
```

Composes with the inline `left`/`top` the window manager writes (the shake is a CSS `transform`, not a position change). Auto-clears on `animationend`. If a second shake is requested while one is mid-flight, the class is removed and re-added so the animation restarts.

**Reduced-motion fallback:** a static accent ring for the same duration. Plugins that want to mute shakes for a specific window can register a `os.window.shake` filter that returns `false`:

```javascript
wp.hooks.addFilter(
    'os.window.shake',
    'my-plugin/no-shake',
    ( allow, { windowId } ) => ( windowId === 'my-window' ? false : allow ),
);
```

---

### `wp.os.connect( windowId, opts? )` — Experimental

Open a typed pub/sub channel with another window's iframe. Returns a `WindowConnection`. Ideal for plugins that need to listen to or talk to content inside an iframe — first use case: live-preview a Gutenberg editor.

```javascript
const conn = wp.os.connect( 'edit-post', {
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

### `wp.os.send` / `wp.os.on` — Stable

**Window-side counterpart to `Window.send/on`.** Available on every chromeless wp-admin page (the shell injects it into the page footer) AND inside every native render's render context. **The single, unified API plugin authors use to talk to / from a window's content — same shape regardless of whether the window is an iframe or a pure-native render.**

**Inside an iframe** (chromeless wp-admin page or `iframeContent` body):

```javascript
// Tell the parent that the editor saved.
wp.os.send( 'editor:saved', { path: '/wp-content/...', size: 1234 } );

// Listen for parent → window messages.
const off = wp.os.on( 'editor:open-file', ( { path, line } ) => {
    openFile( path, line );
} );
```

**Inside a native render callback** — the second arg of the render carries a window-scoped binding so plugin authors don't need to look up their own window:

```javascript
wp.os.registerWindow( {
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
const win = wp.os.windowManager.getById( 'my-tool' );
win.send( 'tool:reset', {} );           // → wp.os.on( 'tool:reset' ) inside the window
win.on( 'tool:saved', ( payload ) => {  // ← wp.os.send( 'tool:saved' ) inside the window
    log( 'saved', payload );
} );
```

**Why this matters.** Pre-0.5.5 the iframe-side API was namespaced as `wp.os.iframe.*` and pure-native windows had no equivalent — plugin authors targeting native windows had to reach into the DOM. The `send/on` pair removes the leak: same code on either side, same code regardless of render strategy.

---

### `wp.os.iframe.publish` / `subscribe` / `onConnection` — Experimental

Iframe-side counterpart to `wp.os.connect()` — the older multi-listener / handshake-aware bridge. Most plugin code should reach for [`wp.os.send` / `wp.os.on`](#wpossend--wposon--stable) instead; this surface is only useful when (a) the iframe wants to know how many parent-side callers are listening (`onConnection`), or (b) the iframe wants to broadcast on a topic that fans out to every open `connect()` rather than to a single window-scoped channel.

```javascript
// Inside an iframe — e.g. a plugin script that runs on post.php:
wp.os.iframe.onConnection( () => {
    const editor = wp.data.select( 'core/editor' );
    wp.data.subscribe( () => {
        wp.os.iframe.publish(
            'gutenberg:content',
            editor.getEditedPostContent(),
        );
    } );
} );

// Receive parent → iframe traffic too:
wp.os.iframe.subscribe( 'preview:zoom', ( payload ) => {
    document.body.style.zoom = String( payload.factor );
} );
```

`publish( topic, payload )` fans the message out to every parent-side connection currently open against this iframe. **Calls with zero open connections log a `console.warn`** — the previous silent drop was a recurring footgun for plugin authors publishing before the parent's `connect()` lands. `onConnection` callbacks are replayed for currently-open connections, so a late registration still sees who's already there.

#### `wp.os.iframe.windowId` / `whenWindowId()` — Stable

The id of the native window the parent shell opened to host this iframe. Populated automatically once the parent issues the first connection handshake (the handshake carries `targetWindowId`); `null` until then. Removes the cross-origin-fragile `iframe.contentWindow ===` walk that parent-side plugin code used to identify iframes.

```javascript
// Inside the iframe:
const id = wp.os.iframe.windowId; // string | null

// Or wait for it (Promise resolves once known):
const id = await wp.os.iframe.whenWindowId();
wp.os.iframe.publish( 'sidebar-opened', { windowId: id } );
```

The id is exactly what `wp.os.openWindow(...)` returns parent-side and what `Window.id` exposes — a stable cross-side handle for self-identification.

**Lifecycle hooks** (parent-side, observability):

```javascript
wp.os.hooks.addAction( 'os.connection.opened', 'me', ( e ) => {
    // e = { connectionId, targetWindowId, topics, connection? }
    // `connection` is the live WindowConnection —
    // subscribe to it directly without a `getConnection` round-trip.
    // Caveat: connections to pure-native windows (no iframe) omit
    // `connection`; fall back to
    // `wp.os.getConnection( e.connectionId )` for those.
    e.connection?.subscribe( 'live-pings', ( payload ) => { … } );
} );
wp.os.hooks.addAction( 'os.connection.closed', 'me', ( e ) => {
    // e = { connectionId, reason }
} );
wp.os.hooks.addAction( 'os.connection.message', 'me', ( e ) => {
    // e = { connectionId, topic, direction: 'in' | 'out' }
    // High-volume — keep subscribers cheap.
} );
```

For connections opened by the iframe (`requestConnection`), the parent can later look up the live connection by id:

```javascript
const conn = wp.os.getConnection( connectionId );
if ( conn ) {
    conn.subscribe( 'topic', cb );
}
```

`wp.os.getConnection( id )` returns the same `WindowConnection` reference the `connect()` factory produces (or what `CONNECTION_OPENED` ships as `connection`). Returns `null` for unknown / destroyed ids.

See [`docs/examples/connect-to-window.md`](./examples/connect-to-window.md) for the full live-preview recipe.

---

### `registerSettingsTab( def )` — Stable

Register a tab in the OpenStation Preferences window. The tab is appended (or sorted-in by `order`) alongside the built-in tabs — Appearance, AI Settings, Apps & Plugins, Features, Effects, Components, About — and renders its body via your `render( body, ctx )` callback.

**Definition shape:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | `string` | yes | Unique. `[a-z0-9_-]+`. Re-registering with the same id replaces the previous entry. |
| `label` | `string` | yes | Tab label. |
| `capability` | `string` | no | Gates visibility. `'manage_options'` → admin-only; any other value (including omitting) → visible to everyone. |
| `order` | `number` | no | Default `100`. Built-ins: appearance=10, themes=12, apps-icons=22, features=25, effects=27, help=40 (Components is admin-only; About is pinned last with a sentinel order). |
| `owner` | `string` | no | When set, plugin deactivation live-unregisters every tab with this owner. Typically matches the WordPress script handle registered with `openstation_register_settings_tab_script()`. |
| `render( body, ctx )` | `function` | yes | Receives the tabpanel body element and a ctx object (see below). Must be idempotent — the panel rebuilds on state resets. |

**`ctx` shape:**

| Field | Type | Notes |
|---|---|---|
| `isAdmin` | `boolean` | `true` when current user has `manage_options`. |
| `getOsSettings()` | `function` | Snapshot of the persisted OpenStation Preferences state — `{ wallpaper, accent, dockSize, windowRadius, unfocusEffect, ai: { enabled } }` plus `adminBarMode` (`'static'` \| `'dynamic'` \| `'hidden'` — how the WordPress admin bar presents above the shell; emitted as a `os-admin-bar-<mode>` body class), `desktopLayout`, `dockPlacement` (`'bottom'` \| `'left'` \| `'right'` — which edge the dock sits on; read by the one-rail layouts, ignored by `classic`), `dockRailRenderer`, `desktopTheme`, `appliedThemeRecommendations`, the native-window opt-ins (`nativePostsEnabled`, `nativePostsHiddenColumns`, `nativePagesEnabled`, `nativeUsersEnabled`, `nativePluginsEnabled`, `nativeCommentsEnabled`), `developerModeEnabled`, `foldersSharingEnabled`, `itemVisibility`, `dockOrder`, and `dockPromotedPositions` — see `OsSettingsSnapshot` in `src/settings/registry.ts` for the authoritative shape. `unfocusEffect` is the active unfocused-window effect id (`'darken'` default, `'none'` disables). `windowReveal` is the active window-reveal id — the clip-path transition that uncovers a window's content when it finishes loading (`'none'` by default; reveals are opt-in) — and `windowRevealDuration` is the global speed override in ms (`0`, the default, means each reveal keeps its own timing). `ai.enabled` is the per-user AI assistant toggle (opt-in, default off; enable-able only once a provider is configured in Settings → Connectors). `developerModeEnabled` (default `false`) gates developer-facing surfaces — the Starter Widget in the add-widget picker and the OpenStation Preferences → Components tab's missing-import-warner demo — set from OpenStation Preferences → Features. **Removed:** `ai.apiKey`, `ai.transport`, `ai.provider` and `ai.model` were removed — credentials live in WordPress Core's Settings → Connectors and provider + model selection is delegated to the Core AI Client. Read-only; returns a defensive copy. |
| `subscribeOsSettings( cb )` | `function` | Subscribe to in-panel OpenStation Preferences changes (user toggles a feature in the Features tab, etc.). Returns an unsubscribe function. Fires on local edits only — cross-device changes arrive on the next page load. |

```javascript
// Use `wp.os.ready()` (not `addAction( 'os.init', … )`) —
// plugin settings scripts are loaded via server-sync AFTER
// `os.init` has already fired, so a raw addAction callback
// would never run. `ready()` handles both the already-fired and
// not-yet-fired cases. See "Bootstrap" above for the full story.
wp.os.ready( () => {
    wp.os.registerSettingsTab( {
        id:         'my-plugin',
        label:      'My Plugin',
        capability: 'manage_options',
        order:      50,
        owner:      'my-plugin-settings',
        render( body, ctx ) {
            // Layout: use <os-section stack> (or <os-stack> inside a
            // vanilla <os-section>) so children get consistent gap.
            // The default slot of <os-section> has no gap — cramped
            // is the default without opt-in.
            body.innerHTML = `
                <os-section
                    heading="My Plugin"
                    description="Configure the plugin."
                    stack
                >
                    <os-text-field label="Name"></os-text-field>
                    <os-button>Save</os-button>
                </os-section>
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

Tabs registered after the OpenStation Preferences window is already open repaint live — the panel subscribes to the registry.

**Layout tip — `<os-section stack>`**

The default slot of `<os-section>` has no gap between children. For third-party tabs that put raw fields directly in the slot, opt into flex-column layout with the `stack` attribute:

```html
<os-section heading="Settings" stack>
    <os-text-field label="Name"></os-text-field>
    <os-checkbox-label label="Enabled"></os-checkbox-label>
    <os-button>Save</os-button>
</os-section>
```

Gap is `--os-ui-section-gap` (default `12px`). Alternative: wrap the content in an explicit `<os-stack>`. Built-in sections omit `stack` because their slotted components already carry their own `margin-block-end`.

**Inline code — `<os-code>`**

Use `<os-code>` for inline URLs, flag names, slugs, or any monospace string. **Don't** use `<os-key>` for these: `<os-key>` installs a global `keydown` listener so the tile flashes on matching keystrokes — rendering `chrome://flags` inside a `<os-key>` would steal `c`, `h`, `r`, `o`, `m`, `e`. `<os-code>` has no listeners.

```html
Open <os-code>chrome://flags</os-code> and enable
<os-code>experimental-web-platform-features</os-code>.

<os-code block>
openstation_register_settings_tab( array(
    'id'    => 'my-plugin',
    'label' => 'My Plugin',
) );
</os-code>
```

**Ordered steps — `<os-steps>` + `<os-step>`**

Auto-numbered setup / onboarding flows. Numbers come from a CSS counter, so inserting or removing a `<os-step>` renumbers the rest automatically. Set `done` on a step to render a ✓ chip instead of the number.

```html
<os-steps>
    <os-step title="Install the plugin">
        Search the plugin directory for “My Plugin” and click Install.
    </os-step>
    <os-step title="Open Settings">
        Go to <os-code>Settings → My Plugin</os-code>.
    </os-step>
    <os-step title="Enter your API key" done>
        Already done earlier in this flow.
    </os-step>
</os-steps>
```

For live *unregistration on deactivation*, either set `owner` (as above) to your script handle, or declare the tab with `openstation_register_settings_tab()` in PHP.

---

### `unregisterSettingsTab( id )` — Stable

Remove a previously registered tab. Idempotent.

```javascript
wp.os.unregisterSettingsTab( 'my-plugin' );
```

---

### `listSettingsTabs()` — Stable

Snapshot of every currently registered third-party settings tab, sorted by `order`. Built-in tabs are not included.

---

### `registerDockRailRenderer( def )` — Stable

Register a renderer that **replaces the dock rail entirely**. The default `'default'` renderer is the shipped icon-strip backed by the `Dock` class; plugin authors can ship anything from a circular ring to a Stage-Manager-style stack to a floating cluster. The user picks among registered renderers in OpenStation Preferences → Appearance → Dock style (persisted to user meta as `dockRailRenderer`).

The active renderer is mounted into the dock container by the layout dispatcher; the controller it returns drives every subsequent live update (live menu refresh, system tile add/remove, badge updates, attention animations). A renderer that throws from `mount()` is caught — the failure is logged via `HOOKS.SHELL_ERROR` and the dispatcher falls back to the built-in `'default'` so the user never sees an empty dock.

**Definition shape:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | `string` | yes | Unique. `[a-z0-9_-]+`. Re-registering with the same id replaces the previous entry. `'default'` is reserved for the shipped icon-strip renderer; a plugin that registers `id: 'default'` replaces the baseline. |
| `label` | `string` | yes | Shown in the OpenStation Preferences picker. |
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
| `fullSystemTiles` | `SystemDockItem[]` | Snapshot of every JS-registered system tile across both rails at mount time (OpenStation Preferences, plugin-owned launchers, recycle bin, …). Tiles the user hid via OpenStation Preferences → Apps & Plugins are excluded — the dispatcher applies the per-item visibility overrides to the system-tile cohort too, delivering hide/unhide live as `removeSystemItem` / `appendSystemItem` calls on the controller. Other live updates flow through the same pair. |
| `orientation` | `'left' \| 'right' \| 'bottom'` | Reflected on the container's `data-os-dock-placement` attribute. |
| `openItem( item )` | `function` | Primary tile click. Routes through the same `windowManager.open()` the default renderer uses (multi-instance, submenu propagation, session restore). Renderers SHOULD use this instead of calling the manager directly. |
| `openSubmenuPick( item, sub )` | `function` | Submenu pick — opens the child URL while preserving the parent's identity for `baseId`, icon, and the in-window tab strip. Renderers that surface submenus (popovers, fan-outs) call this instead of deriving window ids themselves. |
| `openSystemItem( item )` | `function` | System-tile click (OpenStation Preferences, plugin-owned native windows). Mirrors `openItem` for the non-menu cohort. |
| `windowManager` | `WindowManager` | Full instance. Use sparingly; prefer the routing callbacks. |
| `adminUrl` | `string` | Admin URL prefix for window-id derivation. |

**Returned controller — `DockRailController`:**

Required: `replaceItems`, `appendSystemItem`, `removeSystemItem`, `destroy`. Optional: `setBadge`, `setAttention`, `setOrientation`. Optional methods are silently skipped when the active renderer doesn't implement them — a renderer without a badge surface still works; those signals just don't paint.

```javascript
wp.os.ready( () => {
    wp.os.registerDockRailRenderer( {
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

> **`wp.os.dock` with a custom renderer.** When the default renderer is active, `wp.os.dock` / `wp.os.sideDock` continue to return the underlying `Dock` instance (backwards compat). With a custom renderer active, both return `null` — plugins that need renderer-agnostic access should reach for `windowManager`, `activity`, or the public hook surface instead.

---

### `unregisterDockRailRenderer( id )` — Stable

Remove a rail renderer by id. Idempotent — unknown ids are silent no-ops.

---

### `listDockRailRenderers()` — Stable

Snapshot of every currently registered rail renderer in registration order. Used by the OpenStation Preferences picker; plugin authors rarely need it directly.

---

### `openOsSettings( opts? )` — Stable

Open (or focus, if already open) the shell's OpenStation Preferences window. Routes through the same `windowManager.open()` call the dock's OpenStation Preferences tile uses, so a window opened via `wp.os.openOsSettings()` is indistinguishable from one opened by clicking the dock tile — same id, same render callback, same dimensions, same focus / minimize behaviour.

```js
wp.os.openOsSettings();
```

Pass `{ tabId }` to land directly on a specific settings tab. The built-in tab ids are `'appearance'`, `'themes'`, `'windows'`, `'apps-icons'`, `'features'`, `'help'` (labelled Components, admin-only), and `'about'`; a tab registered via `registerSettingsTab()` is addressable by its own id. Two ids are accepted as aliases for the page that absorbed them: `'extended'` → `'features'`, and `'effects'` → `'windows'`. The tab is selected before the window opens, and if OpenStation Preferences is already open the live tab strip switches in place:

```js
// Deep-link straight to the AI Settings tab.
wp.os.openOsSettings( { tabId: 'ai' } );
```

| Param | Type | Notes |
|---|---|---|
| `opts.tabId` | `string` (optional) | Settings tab to activate. On a fresh open, unknown ids fall back to the default tab; passing an unknown id while OpenStation Preferences is already open deselects every tab in the live strip — validate the id first. |

The motivating use case: a custom dock rail renderer in **Classic** layout doesn't see the OpenStation Preferences tile (it lives on the side rail with the core menus, not the primary rail the custom renderer owns). Opening OpenStation Preferences from inside the renderer used to require DOM-scraping `[data-system-id="os-settings"]` and clicking it; this method is the documented portable path.

---

### `updateOsSettings( patch, opts? )` — Stable

Patch the OpenStation Preferences state and persist it — the programmatic equivalent of the user flipping a control in the OpenStation Preferences panel.

```typescript
wp.os.updateOsSettings(
    patch: Partial< OsSettingsSnapshot >,
    opts?: { windowId?: string },
): void;
```

- **Whitelist semantics.** Only keys present on the public `OsSettingsSnapshot` shape are honored; unknown (or wrong-typed) keys are silently ignored, so a typo'd field can't bloat the persisted state. Collection fields are sanitized on the way in (`nativePostsHiddenColumns` / `dockOrder` entries must be non-empty strings, `itemVisibility` values must be one of `'both' | 'dock' | 'desktop' | 'hidden'`, `dockPromotedPositions` values must be finite `{ x, y }` coordinates).
- **Persistence.** The write runs through the same pipeline as the panel: a `localStorage` cache write plus a debounced REST sync (250 ms window).
- **Presentation keys apply live.** A patch touching `wallpaper`, `accent`, `dockSize`, `windowRadius`, `adminBarMode`, `desktopLayout`, `dockPlacement`, `dockRailRenderer` or `desktopTheme` also runs the shell's apply pass, so the change is visible immediately rather than on the next page load. `unfocusEffect` repaints too, through the subscriber above rather than the apply pass. `windowReveal` and `windowRevealDuration` reach the shell the same way, and take effect on the next window load. Every other key is state-only.
- **Subscribers fire.** Both the top-level `wp.os.subscribeOsSettings( cb )` and every settings tab's `ctx.subscribeOsSettings` see the new snapshot.
- **Observable save lifecycle.** Each phase fires on `document` as [`os-settings-save-lifecycle`](#os-settings-save-lifecycle--stable) (`'pending'` → `'saving'` → `'saved'` / `'failed'`), same as a built-in tab's save. `<os-save-status auto>` renders it for free.
- **`opts.windowId`** attributes the in-flight REST sync to a specific window's activity phase (defaults to the OpenStation Preferences window).

The read-side companions are also top-level members: `wp.os.getOsSettings()` returns a defensive copy of the current snapshot and `wp.os.subscribeOsSettings( cb )` returns an unsubscribe function — both mirror the settings-tab `ctx.getOsSettings` / `ctx.subscribeOsSettings` API documented under [`registerSettingsTab`](#registersettingstab-def---stable), usable from any feature plugin without registering a tab.

---

### `deriveWindowId( url, adminUrl? )` — Stable

Derive a stable window id from an admin URL — the same id the default rail renderer uses when it opens a tile. Matches the shell's internal slugifier; a custom renderer that calls `wp.os.deriveWindowId( url )` and `wp.os.windowManager.open( { id, … } )` addresses the same window the default renderer would. Switching renderer mid-session preserves the user's open windows because both renderers agree on ids.

`adminUrl` defaults to `wp.os.config.adminUrl` so callers normally pass just the URL:

```js
const id = wp.os.deriveWindowId( '/wp-admin/edit.php' );
// → 'edit-php' (or whatever the shell's slugifier produces)
wp.os.windowManager.open( { id, baseId: id, url: '/wp-admin/edit.php', /* … */ } );
```

> **For rail renderers** — prefer `openItem( item )` / `openSubmenuPick( item, sub )` from `DockRailMountDeps`. They call `deriveWindowId` internally with the right `adminUrl` and build the rest of the window config for you. Only reach for `deriveWindowId` directly when you need the id for something other than `windowManager.open()` (e.g., an indicator, a deep-link, an analytics event).

> **Don't pass a string to `windowManager.open()`.** It accepts a config object only — passing a URL string throws a `TypeError` at the call site (as does a missing or wrong-typed `id` / `url` / `title`). Build the config with `deriveWindowId` for the id, or use the routing callbacks above.

---

### `listSystemTiles()` — Stable

Snapshot of every JS-registered system tile across both rails. Returns `[]` when the layout dispatcher hasn't booted yet (rare; only happens before `os.init` fires).

Each entry is a read-only descriptor — the underlying `SystemDockItem` (with its `onOpen` / `isOpen` callbacks) lives behind `getSystemTile( id )`.

```typescript
[
    {
        id:        string,
        title:     string,
        icon:      string,
        affinity:  'core' | 'plugin',  // shell affordance vs plugin launcher
        placeable: boolean,            // opted into OpenStation Preferences → Apps & Plugins
    },
    …
]
```

`placeable` is opt-in (`SystemDockItem.placeable`), because most system tiles are load-bearing — OpenStation Preferences is how you reach the very screen that would hide it. Set it on tiles that are genuinely optional decoration; Mio's toggle is the shipped example. Note the visibility override is honoured whether or not the flag is set: all it controls is whether the user is offered a row.

```js
const tiles = wp.os.listSystemTiles();
const settings = tiles.find( ( t ) => t.id === 'os-settings' );
// settings → { id, title: 'OpenStation Preferences', icon: 'dashicons-desktop', affinity: 'core' }
```

A custom rail renderer that wants to compose against the same tile set the default renderer paints — e.g., a launcher palette that lists every native-window plugin tile + the OpenStation Preferences tile in one place — uses this to enumerate.

---

### `getSystemTile( id )` — Stable

Look up a system tile by id. Returns the underlying `SystemDockItem` so callers can read its `title` / `icon` / `isOpen()` predicate, or invoke `onOpen()` to forward the action.

Returns `null` when the id isn't registered or the dispatcher hasn't booted yet.

```js
// Open a known system tile from anywhere — no DOM scraping.
wp.os.getSystemTile( 'os-settings' )?.onOpen();
```

---

### `getMenuItems()` — Stable

Read the complete admin-menu list, regardless of how the active layout would partition it across rails. The default Classic layout splits the menu (core to side rail, plugin to primary rail), so a custom rail renderer's `mount-deps.items` is layout-scoped — `getMenuItems()` returns the full picture for renderers that want to paint a unified view of the entire admin.

```js
const everything = wp.os.getMenuItems();   // [ DockItem, DockItem, … ]
```

Returns a defensive copy — mutating the result doesn't change shell state. Updates with every live menu refresh; call from inside [`os-registry-changed`](#os-registry-changed--stable) CustomEvent listeners (or the rail renderer's `replaceItems`) to get the fresh post-refresh snapshot.

> **For renderers using the registry path:** `DockRailMountDeps.fullMenu` and `fullSystemTiles` carry the same data and are preferable inside a `mount()` body — they're snapshots at the moment the rail mounts, so a renderer holding the arrays sees stable references.

---

### `renderIcon( icon, opts )` — Stable

Render an icon-string into a DOM element using the canonical dispatch the default dock uses. One implementation, six shapes:

| Input | Output |
|---|---|
| `'dashicons-…'` | `<span class="dashicons dashicons-…">` |
| `'data:image/svg+xml;base64,…'` **drawn in `currentColor`** | `<span>` with the SVG as a CSS **mask**, filled with `currentColor` — see [Silhouette icons](#silhouette-icons) below |
| `'data:image/svg+xml;base64,…'` (fixed colours) | `<span>` with the SVG as a CSS background-image |
| `'data:image/png;base64,…'` (any raster data URI — png, jpeg, gif, webp, x-icon) | `<img src=…>` |
| `'http(s)://…'` | `<img src=…>` |
| Anything else (`''`, `'none'`, `'div'`, …) | Letter-badge fallback — coloured circle with the first one or two letters of `opts.title`, hue hashed from the title so the swatch is stable per plugin |

```js
const iconEl = wp.os.renderIcon( item.icon, {
    title: item.title,
    className: 'my-renderer__icon',
} );
host.appendChild( iconEl );
```

Custom rail renderers should use this so their icons look consistent with the default dock (and the letter-badge fallback colour stays stable across reloads — same hash function).

#### Silhouette icons

**Draw your SVG in `currentColor` and it adapts to every surface automatically.** No flag, no registration field: the art declares its own intent, and the declaration cannot drift out of sync with the drawing because it *is* the drawing.

```php
// PHP — openstation_register_icon()
'icon_svg' => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
    . '<rect x="8" y="12" width="48" height="40" rx="4" fill="none"'
    . ' stroke="currentColor" stroke-width="4"/>'
    . '</svg>',
```

A CSS `background-image` has no colour to inherit, so an SVG drawn in `currentColor` and painted that way comes out black — invisible on a dark dock. `renderIcon()` therefore paints such art as a CSS **mask** filled with `currentColor`: only the alpha channel survives, and the fill comes from whatever the surface is already using for text. One drawing stays legible on the dark dock, on a light title bar, on a hover state, and under a desktop theme that recolours the slot.

Two rules follow:

- **All of it, or none of it.** Any literal `fill="#…"` / `stroke="#…"` in otherwise-silhouette art still contributes only its alpha, so it renders as a solid region in the inherited colour — not in the colour you named. Mixed art is a bug that looks like a design choice.
- **Fixed-colour art is unaffected.** An SVG with no `currentColor` keeps the background-image path exactly as before, so a plugin shipping a full-colour brand mark gets back exactly what it drew. The two built-in games are the in-tree examples: `openstation_inkfall_icon_svg()` and `openstation_alphabet_soup_icon_svg()` are both full-colour, and `src/games/launch.ts` hands them to `renderIcon()` through the window registration, so their dock and desktop icons resolve to a `background-image` with `mask-image: none`.

An explicit desktop-theme icon colour still wins over `currentColor` — a theme that recolours a slot recolours silhouettes too.

In-tree reference: `openstation_content_graph_icon_svg()` (the Corkboard).

---

### `applyTileClasses( base, item, ctx )` / `applyTileElement` / `applyTileTooltip` / `dispatchTileRendered` — Stable

Run the registered dock decoration hooks against a tile your custom renderer is building. **Custom rail renderers SHOULD invoke these** at the equivalent points the default `Dock` renderer does — otherwise decoration plugins (glow, animations, custom tooltips) silently fail to apply when the user picks your renderer.

```js
const classes = wp.os.applyTileClasses(
    [ 'my-renderer__tile' ],
    item,
    { dockId: 'my-renderer', orientation: 'bottom', isSystem: false },
);
tile.className = classes.join( ' ' );

const tooltip = wp.os.applyTileTooltip( item.title, item, ctx );
if ( tooltip ) {
    tile.title = tooltip;
}

const finalEl = wp.os.applyTileElement( tile, item, ctx );
host.appendChild( finalEl );

wp.os.dispatchTileRendered( finalEl, item, ctx );
```

`ctx` shape: `{ dockId: string; orientation: 'left' | 'right' | 'bottom'; isSystem: boolean; rail?: 'dock' | 'taskbar'; container?: HTMLElement }`.

---

### `isDockElement( target )` / `registerDockSelector( selector )` — Stable

`isDockElement` walks an event target's `composedPath` looking for a known dock element. Returns `true` when the click landed on the default dock, the side dock, the dock tooltip, the submenu popover, or any custom-renderer root registered via `registerDockSelector`. Use in click-outside-to-dismiss handlers so plugins compose cleanly.

```js
document.addEventListener( 'pointerdown', ( e ) => {
    if ( wp.os.isDockElement( e.target ) ) {
        return; // click landed on the dock — keep my popover open
    }
    closeMyPopover();
} );
```

`registerDockSelector` adds a CSS selector to the "inside the dock" set. Custom rail renderers should call this from `mount()` so other plugins' click-outside handlers correctly classify clicks on the renderer's surface. Returns an unregister function.

```js
const unregister = wp.os.registerDockSelector( '.my-renderer__root' );
// later, in destroy():
unregister();
```

---

### `registerPalette( def )` — Stable

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
wp.os.ready( () => {
    const unregister = wp.os.registerPalette( {
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

### `unregisterPalette( id )` — Stable

Remove a palette from the cycle. Idempotent.

```javascript
window.wp.os.unregisterPalette( 'my-plugin/launcher' );
```

---

### `listPalettes()` — Stable

Snapshot of all palettes in registration order.

---

### `openPalette( id )` — Stable

Open one palette by id, closing any other palette that's currently visible. Useful for deeplinks, menu items, or programmatic triggers that should target a specific palette rather than advance the cycle.

```javascript
window.wp.os.openPalette( 'my-plugin/launcher' );
```

---

### Built-in `/open` — Stable
The shell registers one built-in command at boot: `/open [window]`. It opens any admin menu entry (dock or taskbar) in a legacy iframe window — `/open Posts`, `/open Plugins`, `/open Media`, etc. Autocomplete starts with the first 12 openable entries; as the user types, the list filters by case-insensitive substring match against label and id (max 12 shown).

Plugins extend the `/open` autocomplete via the **`os.open-command.items`** filter:

```javascript
wp.hooks.addFilter(
    'os.open-command.items',
    'my-plugin',
    ( items ) => [
        ...items,
        {
            id: 'jorvy',
            label: 'Jorvy',
            description: 'Marvel quotes',
            icon: 'dashicons-star-filled',
            open: () => wp.os.windowManager.focus( 'jorvy' ),
        },
    ],
);
```

Each entry is `{ id, label, description?, icon?, open }`. The filter runs every time the user opens the palette, so a plugin can show/hide entries dynamically (e.g. by user capability).

---

### Example: a command with `suggest()` autocomplete

```javascript
window.wp.os.registerCommand( {
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

        const res = await wp.os.fetch( `/wp-json/wp/v2/users?search=${ encodeURIComponent( q ) }` );
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

> **Most plugin authors should never look at this section.** The unified [`Window.send/on`](#windowsend-channel-payload---stable) and iframe-side [`wp.os.send/on`](#wpossend--wposon--stable) hide every postMessage type catalogued below. This section is for: (a) debugging the bridge, (b) writing low-level shell internals, (c) integrating an iframe page that doesn't enqueue the standard `os-iframe-bridge` script. If your goal is "tell my window's content something happened," reach for `Window.send/on` first.

### iframe → parent

All messages are dispatched via `window.parent.postMessage( { type, ... }, window.location.origin )` from inside the chromeless admin iframe.

#### `os-window-publish` — Stable

The unified channel-API outbound primitive. Posted internally by `wp.os.send( channel, payload )` inside the iframe. The parent shell forwards every match to `Window.on( channel, cb )` subscribers for this iframe's window. **Plugin authors should call `wp.os.send` instead of posting this manually** — the latter is documented for debugging.

```typescript
{ type: 'os-window-publish'; channel: string; payload?: unknown }
```

#### `os-title-change` — Stable
Update the window's title bar. Overrides whatever the shell resolved at open time, including a title it derived from the destination page itself (see [Window titles the shell had to guess](#window-titles-the-shell-had-to-guess)).

```typescript
{ type: 'os-title-change'; title: string }
```

#### `os-navigate` — Stable
Request a navigation from the iframe. `target: 'new'` opens a new browser tab (with `noopener,noreferrer`); `'self'` replaces the iframe's current page. The URL is validated same-origin against the shell's origin snapshot — cross-origin URLs are silently refused, so an iframe cannot use this to break out of the shell.

```typescript
{ type: 'os-navigate'; url: string; target: 'self' | 'new' }
```

#### `os-notification` — Stable
Raise a transient toast at the parent-shell level. The toast survives the iframe's lifecycle — a "Settings saved" message stays visible even after the user closes the window that triggered it. Title is required; body is optional (concatenated with an em-dash when present). Empty titles are dropped.

```typescript
{ type: 'os-notification'; title: string; body?: string }
```

#### `os-ready` — Stable
Posted once by the chromeless bridge script when its message listeners are attached. Dispatches `HOOKS.IFRAME_READY` on the parent with `{ windowId }`. Prefer subscribing to `IFRAME_READY` over the browser's native iframe `load` event when timing matters — `load` fires before our bridge wires up, so messages sent on `load` can race the listener and drop.

```typescript
{ type: 'os-ready' }
```

#### `os-focus-request` — Stable
Posted by the chromeless bridge on every pointerdown inside the iframe. The parent focuses the window, unless it's currently in the overview grid (where clicks are absorbed by the grid controller).

```typescript
{ type: 'os-focus-request' }
```

#### `os-external-link` — Stable
Posted when a link inside the iframe points off-site; the parent opens an external-tab card inside the window's tab strip.

```typescript
{ type: 'os-external-link'; url: string; label?: string }
```

#### `os-open-user-footprint` — Stable
Posted when a `[data-os-footprint]` link is clicked inside a chromeless iframe — the "View activity footprint" row action on the classic Users table. Checked *before* the admin-link classifier, so the link's fallback `href` is never followed inside the shell. The parent opens (or focuses) the WP Explorer window on that user's footprint route and leaves the source window open (it's an auxiliary peek, not a navigation away — contrast `os-iframe-admin-link`, which closes the source on a remap hit). The public entry point is [`wp.os.myWordpress.openUserFootprint`](#public-api--wposmywordpress); see also `bridge-protocol.md`.

```typescript
{ type: 'os-open-user-footprint'; userId: number; userName: string }
```

#### `os-iframe-error` — Stable
Posted from inside the chromeless iframe's `error` / `unhandledrejection` handlers. The parent re-dispatches as `HOOKS.IFRAME_ERROR` with `{ windowId, kind, message, filename, lineno, colno, stack }` so monitor widgets can subscribe.

```typescript
{
    type: 'os-iframe-error';
    kind: 'error' | 'unhandledrejection';
    message: string;
    filename?: string;
    lineno?: number;
    colno?: number;
    stack?: string;
}
```

#### `os-iframe-network` — Stable
Posted by the chromeless bridge's `fetch` and `XMLHttpRequest` wrappers whenever an HTTP call completes (success or failure). The parent re-dispatches as `HOOKS.IFRAME_NETWORK_COMPLETED` with `{ windowId, method, url, status, duration, failed }`. `status === 0` indicates a network-level failure before a response arrived.

```typescript
{
    type: 'os-iframe-network';
    method: string;
    url: string;
    status: number;
    duration: number;
    failed: boolean;
}
```

#### `os-iframe-activity` — Experimental
Posted by the same `fetch` / `XMLHttpRequest` wrappers as `os-iframe-network`, but **bracketing** the request rather than only reporting its completion — an indicator that can only be told "it finished" never shows the part the user waits through. This is what makes an iframe window report activity like a native one: native windows route through `wp.os.fetch`, which the shell owns, while an admin page inside an iframe does its own jQuery / XHR / `fetch` calls the parent has no other way to see.

```typescript
{ type: 'os-iframe-activity'; phase: 'start' }
{ type: 'os-iframe-activity'; phase: 'end'; failed: boolean; status: number }
```

The parent feeds these to the same reference-counted `Window._markActivityStart()` / `_markActivitySettled()` pair `wp.os.fetch` uses, so a page firing six requests at once settles as one burst — and settles `failed` if any of them did. `status === 0` means no response arrived (network error, CORS, abort); the failure message omits the number in that case.

**Only writes report.** Three deliberate exclusions:

- **Reads never reach the ring** — `GET`, `HEAD`, `OPTIONS`, and `QUERY`. The ring answers "did my change go through?", and a read has no *through*: nothing changed, so nothing can have failed to change. An admin page also fires reads constantly on its own (list-table refreshes, dashboard widgets, autosave checks, media queries) and the user never asked about any of them. `QUERY` is in the list because it carries a **body** — it is a safe, idempotent read whose parameters wouldn't fit in a URL, so any "does it have a payload?" test would classify it backwards.
- **WordPress Heartbeat** never reports even though it POSTs. It is a poll the user did not initiate, on a timer, forever; reporting it would light every open window's ring every 15 seconds and flash a success check for a save nobody made. Same judgement `wp.os.fetch`'s `silent: true` exists for. The action name is read from the request body, since Heartbeat POSTs to `admin-ajax.php` with no action in the URL.
- **A new document resets the count.** An iframe that navigates mid-request takes its pending `end` messages with it, so `os-ready` calls `Window._resetActivity()`; without it the ring would stay lit for the rest of the window's life.

This is the automatic path, and it is conservative on purpose. `wp.os.fetch` is the deliberate one: a call site that passes a `GET` there **does** move the phase, because someone chose to report it. Pass `silent: true` to opt a single call out.

#### `os-screen-meta` — Stable
Announces the screen-meta panels (Screen Options / Help) that the iframe page exposes. The parent renders one title-bar button per announced panel, replacing any previously rendered set.

```typescript
{ type: 'os-screen-meta'; panels: ( 'screen-options' | 'help' )[] }
```

The iframe sends this on every load — **including an empty `panels: []`** — so the parent can clear stale buttons when a page (e.g. after an in-place same-slug navigation) exposes no screen meta. A panel is announced only when its toggle link is present **and** the panel actually has content: a Screen Options panel with no form controls, or a Help tab registered with empty `content` and no callback, is omitted so the title bar never shows a button that opens an empty panel.

#### `os-screen-meta-state` — Stable
Reports which screen-meta panel (if any) is currently open inside the iframe.

```typescript
{ type: 'os-screen-meta-state'; open: 'screen-options' | 'help' | null }
```

#### `os-commands-list` — Experimental
Reports the current `wp.data.select('core/commands')` registry of this iframe to the parent shell. Emitted after the iframe receives `os-commands-subscribe`, and then re-emitted (de-duplicated) whenever a re-render of the in-iframe React harvester changes the merged list. The parent re-publishes each entry as a slash-command in the shell palette tagged `owner: 'iframe:<windowId>'` and `eager: true` so the command surfaces before the user types `/`.

Collection spans tier-2 (context-scoped `getCommands(true)`) and tier-3 (dynamic `getCommandLoaders(true)` hooks — invoked inside a mounted React tree so the rules of hooks hold). Global tier-1 navigation commands are deliberately skipped: the user already has them via the dock.

Each `HarvestedCommand` carries a `kind` field the iframe computes by **statically matching** `callback.toString()` against a string-literal navigation target (`location.href = '…'`, `.assign('…')`, `.replace('…')`). An earlier dry-run approach triggered infinite window spawning because `Location.prototype.href` is non-configurable — the shim silently failed and every nav callback actually navigated. Computed URLs fall back to `action` and proxy back into the iframe via `os-commands-invoke`.

`iconSvg` carries the `@wordpress/icons` React element flattened to SVG markup via `wp.element.renderToString`; the structured-clone algorithm behind `postMessage` would refuse the raw element.

```typescript
{
    type: 'os-commands-list';
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

#### `os-plugins-changed` — Stable

Carries a full menu payload harvested from real admin context. Emitted by the chromeless bridge when the iframe lands on a page whose completion commonly mutates the admin menu (`plugins.php`, `plugin-install.php`, `update.php`, `themes.php`), and by the hidden refresh probe [`wp.os.refreshMenu()`](#refreshmenu) spawns. The shell diffs the payload against its prior snapshot by `id` and repaints only the registries that actually changed (dock, native windows, widgets, …) — no browser reload. The payload also carries `menuSig`, its own [menu signature](#os-menu-signature--stable), which the shell adopts as its last-known value, and `updateCounts`, the aggregate pending-update numbers the shell mirrors onto the admin-bar circle-arrows notifier (`#wp-admin-bar-updates`) so an in-window update run resets it without a hard refresh (GH#296).

The bridge posts this message (and `os-menu-signature`) to the **top** window rather than the immediate parent. For a normal window iframe they're the same frame; the distinction matters for nested flows like the bulk updater, where `update-core.php` hosts a progress iframe of `update.php` whose post-upgrade payload must still reach the shell.

```typescript
{
    type: 'os-plugins-changed';
    payload: {
        dockItems: unknown[];
        nativeWindows: unknown[];
        /* … */
        updateCounts?: { total: number; formatted: string; text: string; url: string };
        menuSig: string;
    };
}
```

#### `os-updates-changed` — Stable

A payload-less nudge emitted by the chromeless bridge when Core's shiny updater (`wp-admin/js/updates.js`) finishes an AJAX plugin/theme update or delete run inside the iframe — the jQuery events `wp-plugin-update-success` / `-error`, `wp-plugin-delete-success`, and their theme counterparts. Those runs mutate the update transients server-side without any navigation, so no full payload is coming on its own; on receipt the shell debounces briefly and spends one [`wp.os.refreshMenu()`](#refreshmenu) probe, whose payload carries the fresh dock badge and `updateCounts` (GH#296). While updates.js is still draining a bulk queue the bridge stays quiet and lets the final job send the single nudge.

```typescript
{ type: 'os-updates-changed' }
```

#### `os-menu-signature` — Stable

A lightweight structural fingerprint of the admin menu, emitted by the chromeless bridge on **every** chromeless admin page that does *not* already carry a full `os-plugins-changed` payload. The shell compares `sig` against its last-known value (seeded from `openStationConfig.menuSig` at boot, updated on every applied payload) and — only when it differs — spends one [`wp.os.refreshMenu()`](#refreshmenu) probe to reconcile the dock.

This closes the gap where a custom post type registered through a settings tool (CPT UI, Pods, ACF, …) saves on its own `admin.php?page=…` / `options.php` screen — none of which is on the full-payload allowlist — so the new menu item never reached the live dock until a full browser reload (GH#325). An unchanged menu costs nothing beyond the tiny message; a full harvest happens only on a real change.

```typescript
{ type: 'os-menu-signature'; sig: string }
```

---

#### `os-pointer-move` — Experimental

The cursor's position inside this iframe, in the iframe's own client coordinates. Sent **only** while the parent has armed the frame with [`os-pointer-track`](#os-pointer-track--experimental), throttled to ~25 Hz, from a passive capture-phase listener that never calls `preventDefault()`.

Pointer events don't cross iframe boundaries, so the shell goes blind to the cursor the moment it enters a window. Anything shell-side that needs the true cursor position over window content consumes this and rebases it through the iframe element's bounding rect. Today's consumer is Mio's gaze ([mio.md](./mio.md#looking-at-the-pointer-across-iframes)).

Coordinates only — no target element, no event object, nothing about the page's content.

```typescript
{ type: 'os-pointer-move'; x: number; y: number }
```

---

### parent → iframe

```javascript
iframe.contentWindow.postMessage( { type, ... }, window.location.origin );
```

#### `os-window-send` — Stable

The unified channel-API inbound primitive. Posted internally by `Window.send( channel, payload )` for iframe targets. Inside the iframe the bridge forwards each match to `wp.os.on( channel, cb )` subscribers. **Plugin authors should call `Window.send` instead of posting this manually** — the latter is documented for debugging.

```typescript
{ type: 'os-window-send'; channel: string; payload?: unknown }
```

#### `os-focus` — Stable
Instructs the iframe that its containing window has been focused.

```typescript
{ type: 'os-focus' }
```

#### `os-color-scheme` — Stable
Notifies the iframe of a parent-side color scheme change so CSS Custom Properties can be synced.

```typescript
{ type: 'os-color-scheme'; scheme: string }
```

#### `os-toggle-panel` — Stable
Asks the iframe to toggle a named screen-meta panel. The iframe is the authority — it responds by emitting a `os-screen-meta-state` message.

```typescript
{ type: 'os-toggle-panel'; panel: 'screen-options' | 'help' }
```

#### `os-commands-subscribe` — Experimental
Tells the iframe to begin streaming its `wp.data.select('core/commands')` registry to the parent via `os-commands-list`. The shell sends this to the iframe owned by the currently focused window and rescinds it (`os-commands-unsubscribe`) when focus moves elsewhere.

```typescript
{ type: 'os-commands-subscribe' }
```

#### `os-commands-unsubscribe` — Experimental
Tells the iframe to stop streaming its command list. The parent unregisters any shell-palette entries still tagged with this window's owner.

```typescript
{ type: 'os-commands-unsubscribe' }
```

#### `os-commands-invoke` — Experimental
Asks the iframe to run a previously harvested `action`-kind command. Sent when the user selects the command from the shell palette. Navigation-kind commands are handled parent-side by opening a new desktop window — the iframe never sees them.

```typescript
{ type: 'os-commands-invoke'; name: string }
```

---

#### `os-pointer-track` — Experimental

Arms or disarms the iframe's pointer forwarder (see [`os-pointer-move`](#os-pointer-move--experimental)). **Off by default**: a shell with no consumer never sends this and the iframe never installs the listener.

The shell posts `{ enabled: true }` to every live iframe when a consumer starts, again to any frame that announces `os-bridge-ready` (which fires on every navigation, so a frame re-arms itself after a page load), and `{ enabled: false }` when the last consumer tears down.

```typescript
{ type: 'os-pointer-track'; enabled: boolean }
```

---

### Safety guidelines for bridge messages

- **Always validate `event.origin`** against `window.location.origin`. Cross-origin messages are rejected by the parent today; your iframe adapter should do the same.
- **Never pass raw HTML** through the bridge. If you need to display text, pass a string and let the parent render it via `textContent`.
- **Be idempotent.** A bridge message may arrive twice during navigations. Design payloads so the second arrival is a no-op.

---

## 4. Hooks — `os.*`

OpenStation exposes WordPress-style filters and actions via the standard `@wordpress/hooks` package. The plugin declares `wp-hooks` as a script dependency so `window.wp.hooks` is always available before the shell boots, and all hook names live in the `os.` namespace to avoid collisions with Core or Gutenberg.

If you've used `addFilter` / `addAction` in Gutenberg, you already know how these work — there's nothing new to learn.

### Bootstrap

**Recommended:** use `wp.os.ready( fn )` — it mirrors `jQuery( fn )` and is safe for scripts loaded at any point in the lifecycle, including scripts injected mid-session by the server-sync modules (widgets, wallpapers, commands, settings tabs).

```javascript
wp.os.ready( () => {
    // wp.os is fully populated; register away.
    wp.os.registerWallpaper( myWallpaper );
    wp.os.registerSettingsTab( { ... } );
} );
```

`ready()` runs the callback **synchronously via a microtask** if `os.init` has already fired, or queues it via `addAction( 'os.init', … )` otherwise. It's a shorter alias of `wp.os.whenReady()`.

> **Why not `wp.hooks.addAction( 'os.init', … )` directly?**
>
> `addAction()` queues a callback for *future* firings of the action. When a plugin script is loaded **after** `os.init` has already fired — the normal case for anything registered by a server-sync module — the callback is never invoked. `ready()` handles both cases: already-fired (call immediately) and not-yet-fired (queue on the action). Use `ready()` as the default; reach for `addAction()` directly only if you specifically want multi-fire semantics.

If you need a synchronous check (e.g. to branch between "register directly" and "schedule"), use `wp.os.isReady()`:

```javascript
if ( wp.os.isReady() ) {
    wp.os.registerCommand( myCommand );
} else {
    wp.os.ready( () => wp.os.registerCommand( myCommand ) );
}
```

### Hooks catalog

#### Shell & wallpapers

| Hook | Kind | Status | Payload |
|---|---|---|---|
| `os.init` | action | Stable | `{ config: DesktopConfig }` |
| `os.shell.resized` | action | Stable | `{ width, height }` — debounced ~120 ms after the browser stops resizing |
| `os.shell.visibility` | action | Stable | `{ state: 'visible' \| 'hidden' }` — mirrors `document.visibilitychange` |
| `os.wallpapers` | filter | Stable | `WallpaperDef[] → WallpaperDef[]` |
| `os.wallpaper.mounting` | action | Stable | `{ id, container, ctx }` |
| `os.wallpaper.mounted` | action | Stable | `{ id, container, ctx }` |
| `os.wallpaper.unmounting` | action | Stable | `{ id }` |
| `os.wallpaper.mount-failed` | action | Stable | `{ id, error }` |
| `os.wallpaper.visibility` | action | Stable | `{ id, state: 'visible' \| 'hidden' }` |
| `os.wallpaper.preview-params` | filter | Experimental | `Record<string, unknown> → Record<string, unknown>`, second arg `wallpaperId` — override a wallpaper's live-preview parameters before its `renderPreview` runs |
| `os.wallpaper.settings-changed` | action | Experimental | `{ id, settings }` — the user edited the wallpaper's settings through its `renderConfig` dialog; `settings` is the full post-merge bag. Mounted wallpapers live-apply from here |
| `os.wallpaper.surfaces` | filter | Stable | `WallpaperSurface[] → WallpaperSurface[]` — see below |

#### Mio

The desk companion. Full documentation in [mio.md](./mio.md).

| Hook | Kind | Status | Payload |
|---|---|---|---|
| `os.mio.config` | filter | Experimental | `MioConfig → MioConfig` — last word on appearance + physics before mount, on top of the `openstation_mio_config` PHP filter. Re-sanitized after your filter runs, so out-of-range values are clamped rather than rejected |
| `os.mio.enabled` | action | Experimental | `{}` — the user switched it on |
| `os.mio.disabled` | action | Experimental | `{}` — the user switched it off |
| `os.mio.mounted` | action | Experimental | `{ position: { x, y } }` — on screen and simulating; viewport coordinates |
| `os.mio.unmounted` | action | Experimental | `{}` — the instance was genuinely destroyed and its WebGL context released. **Not** the signal for "the user switched Mio off": that parks the instance and fires `disabled`. In practice this only fires on page teardown |
| `os.mio.grabbed` | action | Experimental | `{ position: { x, y } }` — the user started dragging it |
| `os.mio.dropped` | action | Experimental | `{ position: { x, y } }` — dropped; the position is already persisted |
| `os.mio.displaced` | action | Experimental | `{ position: { x, y } }` — a window opened, moved, or maximised on top of it, so it hopped clear of the window cluster |
| `os.mio.shape-changed` | action | Experimental | `{ shape, from }` — the silhouette shuffle picked a new stock shape (`circle` \| `blob` \| `ghost` \| `potato`). Fires when the morph starts, not when it finishes |

#### Arrange & Overview

Fired by the admin-bar "Arrange" menu's layout algorithms. The overview hooks come in pairs (enter/exit, hover/unhover) so plugins can maintain accurate state counts.

The pairing holds even when a user re-enters overview inside the ~280 ms exit animation (a double-tap of the trigger): the outgoing session is settled first, so `exited` arrives ahead of the next `entering` rather than landing partway into the new session. A listener can rely on the sequence never interleaving.

| Hook | Kind | Status | Payload |
|---|---|---|---|
| `os.overview.entering` | action | Stable | `{}` — before the enter animation starts |
| `os.overview.entered` | action | Stable | `{}` — fires ~300 ms later, after the grid settles |
| `os.overview.exiting` | action | Stable | `{ windowId?: string, reason: 'select' \| 'cancel' }` |
| `os.overview.exited` | action | Stable | same payload as `exiting` — fires ~280 ms later, once the windows have animated home |
| `os.overview.window-hover` | action | Stable | `{ windowId }` |
| `os.overview.window-unhover` | action | Stable | `{ windowId }` |
| `os.overview.window-click` | action | Stable | `{ windowId }` — fires just before `exiting` when a thumbnail is clicked |
| `os.arrange.cascade.starting` | action | Stable | `{ windowCount }` |
| `os.arrange.cascade.applied` | action | Stable | `{ windowCount }` |
| `os.arrange.tile.starting` | action | Stable | `{ windowCount, cols, rows }` — before tile lays out the grid |
| `os.arrange.tile.applied` | action | Stable | `{ windowCount, cols, rows }` |
| `os.arrange.tile.dimensions` | filter | Stable | filters `{ cols, rows }`; context `{ windowCount, areaWidth, areaHeight }`. Override the auto-chosen grid (e.g., force a 3-column newsroom layout). Returns must be positive integers and `cols * rows >= windowCount`, otherwise the filter is ignored. |
| `os.arrange.snap.changed` | action | Stable | `{ enabled }` — fires when the user toggles "Snap to grid" |
| `os.arrange.snap.cell-size` | filter | Stable | filters `{ cellWidth, cellHeight }`; context `{ areaWidth, areaHeight }`. Override the auto-computed snap cell size (e.g., enforce a fixed 100×100 grid). Non-positive returns are ignored. |
| `os.arrange.custom-action` | action | Stable | `{ id }` — fires when the user clicks a plugin-registered Arrange-menu item (registered server-side via the `openstation_arrange_menu_items` PHP filter). The `id` matches the `id` field the plugin supplied. |

#### Virtual desktops ("Spaces")

Each user can have multiple desktops, each owning its own set of windows. Switching desktops swaps which windows are visible without destroying any. The overview top bar surfaces tile-per-desktop UI for switching, creating, and closing.

| Hook | Kind | Status | Payload |
|---|---|---|---|
| `os.desktop.created` | action | Stable | `{ desktopId }` — fires after a new desktop joins the registry |
| `os.desktop.closed` | action | Stable | `{ desktopId, migratedTo }` — `migratedTo` is the desktop that received any orphaned windows |
| `os.desktop.switched` | action | Stable | `{ from, to }` — the active desktop changed |

Closing the last remaining desktop is rejected silently (the shell needs at least one). Closing a desktop that has windows migrates them to the surviving desktop on its left (falling back to the right when the leftmost is closed) — no work is silently destroyed.

#### Widgets

Small cards that paint in the right-side column above the wallpaper but beneath every window. Lifecycle mirrors canvas wallpapers — `mount(container)` returns a teardown the layer calls on remove / page unload.

Register via the public helper:

```js
wp.os.registerWidget( {
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

**Optional placement / sizing fields** (all default off, fully back-compat with existing widgets):

| Field | Type | What it does |
|---|---|---|
| `movable` | `boolean` | Show a thin chrome header at the top of the card with a drag grip + label + × button. The user can drag the card from the chrome to place the widget anywhere on the desktop (first drag "liberates" it from the right-side column). Text inputs / buttons inside the widget body are unaffected — drag only initiates from the chrome. |
| `resizable` | `boolean` | Add resize handles. With `movable: true`, 8 handles (corners + edges). Without it, only the bottom edge is draggable so width stays locked to the column. |
| `minWidth`, `minHeight` | `number` | Lower bounds enforced during user resize (px). |
| `maxWidth`, `maxHeight` | `number` | Upper bounds enforced during user resize (px). |
| `defaultWidth`, `defaultHeight` | `number` | Initial floating size — used the first time the widget is liberated. |

```js
wp.os.registerWidget( {
    id: 'my/notes',
    label: 'Scratchpad',
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

User-placed geometry (position + size of liberated widgets) persists per-user in `localStorage` under `os-widgets-geometry`. Height resizes made while a resizable widget is docked in the column persist separately under `os-widgets-docked-heights` (height only — column widgets have no free position, and a full geometry record would mark the widget as floating at boot). Removing a widget clears both records so a re-add starts docked at its natural height.

##### `wp.os.widgets.redock( id )` — Stable

Programmatically un-float a liberated widget back into the right-side column. Idempotent — already-docked widgets and unknown ids silently no-op. Mirrors what the user gets by clicking the re-dock affordance in the floating widget's chrome header.

```js
// "Reset widget positions" command for a power-user palette.
for ( const id of wp.os.widgetLayer?.getEnabledIds() ?? [] ) {
    wp.os.widgets.redock( id );
}
```

Equivalent legacy entry point: `wp.os.widgetLayer?.redock( id )`. New code should prefer `wp.os.widgets.redock`, which keeps a stable namespace as the widget surface grows.

| Hook | Kind | Status | Payload |
|---|---|---|---|
| `os.widgets` | filter | Stable | the registry array |
| `os.widget.mounting` | action | Stable | `{ id, container, ctx }` — before paint |
| `os.widget.mounted` | action | Stable | `{ id, container, ctx }` — after paint |
| `os.widget.unmounting` | action | Stable | `{ id }` — before teardown |
| `os.widget.mount-failed` | action | Stable | `{ id, error }` |
| `os.widget.added` | action | Stable | `{ id }` — user added via the picker |
| `os.widget.removed` | action | Stable | `{ id }` — user removed via the card's × |

The `ctx` argument exposes `{ id, pluginUrl, storage }` — `storage` is a per-widget key/value store auto-namespaced in `localStorage` (`os.widget.<id>.<key>`), so two widgets can both persist a `layout` key without colliding. (Canvas wallpapers receive a different context: `{ id, pluginUrl, prefersReducedMotion, visible, settings }`.) Enabled widgets persist per-user in `localStorage` (`os-widgets`).

#### Window lifecycle

All window actions include at minimum `{ windowId: string }` — additional fields called out in the payload column.

| Hook | Kind | Status | Payload |
|---|---|---|---|
| `os.window.geometry` | filter | Stable | `( geometry, ctx ) => geometry` — last call before `WindowConfig` is baked. See [the geometry filter section below](#window-geometry-filter) for the contract and a recipe. |
| `os.window.opened` | action | Stable | `{ windowId, page, title, url }` |
| `os.window.reopened` | action | Stable | `{ windowId, baseId, wasMinimized, navigated }` — fires when `openWindow()` is called for an already-open window; `navigated` is `true` when the request carried a URL the window wasn't showing and the framework navigated the existing iframe to it in place |
| `os.window.content-loading` | action | Stable | `{ windowId }` — fires on the loading entry edge (construction + every `markContentLoading()`). Edge-triggered. |
| `os.window.content-loaded` | action | Stable | `{ windowId }` — fires on the loading → ready transition (iframe `load` / `os-ready`, native render Promise resolves, or `markContentLoaded()`). Edge-triggered. |
| `os.window.loading-overlay` | filter | Stable | `(host: HTMLElement, ctx: { windowId, config }) → HTMLElement`. Receives the default overlay element (or whatever a per-window `config.loading.render` produced) and may mutate it or return a replacement. Plugins use this to brand every window's loader, swap the spinner preset, append status text. |
| `os.window.closing` | action | Stable | `{ windowId, element }` — fires BEFORE the element is detached (use this when you need an element reference, e.g. for anchored wallpaper overlays) |
| `os.window.closed` | action | Stable | `{ windowId }` |
| `os.window.focused` | action | Stable | `{ windowId }` — fires on focus changes |
| `os.window.blurred` | action | Stable | `{ windowId, focusedTo }` — fires on the window that lost focus when another window is promoted |
| `os.window.title-changed` | action | Stable | `{ windowId, title }` — iframe-sourced title updates |
| `os.window.minimized` | action | Stable | `{ windowId, element }` — element ride-along matches `closing`'s shape so wallpaper plugins anchored to window tops (snow, leaves) can match stuck particles by identity. Minimized windows render at `opacity: 0` so `offsetParent === null` checks miss them. |
| `os.window.restored` | action | Stable | `{ windowId, element }` — restored from minimized |
| `os.window.maximized` | action | Stable | `{ windowId, element }` |
| `os.window.unmaximized` | action | Stable | `{ windowId, element }` |
| `os.window.fullscreen-entered` | action | Stable | `{ windowId, element }` |
| `os.window.fullscreen-exited` | action | Stable | `{ windowId, element }` |
| `os.window.auto-exit-fullscreen` | filter | Stable | `( shouldExit: boolean, ctx: { windowId, focusedTo } ) => boolean` — decides whether a fullscreen window should auto-exit when focus moves elsewhere. Default `true`. Return `false` to keep persistent-fullscreen surfaces (slideshow, video, game) in fullscreen across focus changes. |
| `os.window.focus-on-drag-hover` | filter | Stable | `( shouldFocus: boolean, ctx: { windowId, payloadType } ) => boolean` — decides whether the window under the cursor is raised (focused) after a ~250 ms hover dwell during any drag. `payloadType` is the DragManager payload's `type` slug (`'desktop-file'`, `'shortcut'`, plugin-defined), the bridge payload's `kind` (`'attachment'`, `'post'`, `'user'`), `'os-file'` for OS file drags, or `'external'` for any other native drag. Default `true`. Return `false` to keep HUD/palette/pinned-reference windows from stealing z-order during drags. |
| `os.window.drag-start` | action | Stable | `{ windowId }` |
| `os.window.drag-end` | action | Stable | `{ windowId, x, y }` |
| `os.window.moved` | action | Stable | `{ windowId, x, y }` — fires with drag-end |
| `os.window.resize-start` | action | Stable | `{ windowId }` |
| `os.window.resize-end` | action | Stable | `{ windowId, width, height }` |
| `os.window.resized` | action | Stable | `{ windowId, width, height }` — fires with resize-end |
| `os.window.bounds-changed` | action | Stable | `{ windowId, x, y, width, height, state, phase: 'drag' \| 'resize' }` — rAF-coalesced, fires at most once per animation frame during an active drag or resize. See below. |
| `os.window.detached` | action | Stable | `{ windowId, url }` — user opened in a classic-admin tab |

**About `bounds-changed`.** Intended for per-frame collision-aware effects (snow piling on window tops, rain splashes, physics-driven overlays). Coalesced via `requestAnimationFrame` so a pointermove storm collapses to one fire per paint — matches the cadence a canvas wallpaper's own ticker runs at, and replaces the "poll `getBoundingClientRect` every rAF" pattern. NOT fired at drag/resize end — use `os.window.drag-end` / `os.window.resize-end` for settled geometry.

The window hooks fan out alongside the existing `os-window-*` CustomEvents (see section 2) — both APIs fire for every state change. New code should prefer the hook bus.

All hooks can be listed via `wp.hooks.hasAction()` / `hasFilter()` for defensive checks.

<a id="window-geometry-filter"></a>
##### `os.window.geometry` filter — Stable

Last call before a window's resolved `x` / `y` / `width` / `height` / `initialState` are baked into the `WindowConfig` the constructor consumes. Plugins use it to:

- **Override the default size of windows they own.** Compute "this should open at 40% of the desktop in the bottom-right corner" once at filter time, instead of resizing after `open()` settles.
- **Snap restored bounds to a different region.** Re-anchor a window the user previously dragged off-screen, or clamp to a per-plugin region.
- **Force an initial state** (e.g. always-maximized for a fullscreen-y tool).

```js
const { HOOKS } = wp.os;

wp.os.hooks.addFilter(
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
- Companion of `openstation_register_window`'s server-side `width` / `height` defaults: the filter sees those defaults as the starting `geometry` value, and `ctx.callerPinned` is `true` for native windows because the framework's own opener passes them through as explicit `manager.open()` args. The filter is free to override anyway — `callerPinned` is signal, not veto.

#### `DockItem` shape

The canonical menu-item type, surfaced everywhere a custom dock surface needs to read what the admin menu contains: `wp.os.getMenuItems()`, the rail renderer's `mount-deps.items` and `mount-deps.fullMenu`, the controller's `replaceItems( items )` parameter, every dock decoration hook context.

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
                               // mu-plugins, drop-ins, and OpenStation itself.
                               // Drives the dock right-click "Deactivate …" action.
                               // Resolved server-side by snapshotting $menu/$submenu
                               // around every admin_menu callback (registration-time
                               // attribution), with page-hook reflection + a CPT/
                               // taxonomy registration tracker as fallbacks.
                               // Stable.
    pluginName: string | null; // owning plugin's display name (the `Name:` field
                               // from its plugin header). Used in the right-click
                               // "Deactivate <pluginName>…" label so sub-page tiles
                               // (e.g. WC's Analytics) read as the parent plugin.
                               // Always null when pluginFile is null.
                               // Stable.
}
```

**`submenu` invariant** — the shell strips self-link entries server-side before the array reaches the JS layer (WordPress's `$submenu[$slug]` includes a self-link as the first entry; the dock data builder removes it). So:

- `submenu.length === 0` reliably means "no real children" — the right-click context menu suppresses the popover trigger, the in-window tab strip stays hidden.
- `submenu.length > 0` reliably means "has real child links" — every entry points at a distinct URL.

A custom rail renderer that decides whether to show a submenu indicator (a chevron, a hover treatment) can read `item.submenu.length > 0` without defensive `submenu.length > 1` or self-URL filtering. The framework owns the contract.

**Lifecycle pairing — `replaceItems` ↔ `appendSystemItem`** — these are independent update paths. `replaceItems( items )` swaps the menu-derived tiles wholesale (the live menu refresh fires it on every plugin activation / deactivation). `appendSystemItem` / `removeSystemItem` track the JS-owned cohort (OpenStation Preferences, plugin native-window launchers).

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

Custom rail renderers (registered via `wp.os.registerDockRailRenderer`, see below) **should** fire the same hooks at equivalent points so plugin decoration keeps working when the user picks a different renderer.

| Hook | Kind | Status | Payload |
|---|---|---|---|
| `os.dock.before-render` | action | Stable | `DockRenderContext` — fires at start of every paint pass (initial mount + every `replaceItems`) |
| `os.dock.tile-class` | filter | Stable | `( classes: string[], ctx: DockTileContext ) → string[]` — order preserved |
| `os.dock.tile-element` | filter | Stable | `( el: HTMLElement, ctx: DockTileContext ) → HTMLElement` — wrap, don't replace; the shell still finds `[data-menu-slug]` / `[data-system-id]` descendants for active state |
| `os.dock.tile-tooltip` | filter | Stable | `( label: string, ctx: DockTileContext ) → string` — runs once at bind time; empty string suppresses the tooltip |
| `os.dock.tile-rendered` | action | Stable | `DockTileContext & { el: HTMLElement }` — fires once per tile after insertion (computed layout is ready) |
| `os.dock.after-render` | action | Stable | `DockRenderContext` with frozen `tileElements: ReadonlyMap<string, HTMLElement>` |
| `os.dock.item-appended` | action | Stable | `{ id }` — fires when `wp.os.registerSystemTile()` lands a tile |
| `os.dock.item-removed` | action | Stable | `{ id, placement }` — symmetric counterpart to `item-appended` |
| `os.dock.refresh-active` | action | Experimental | No payload. One you **fire**, not listen to: repaints every tile's active dot. The dock already repaints on window lifecycle events, so this is only for a system tile whose `isOpen()` asks something other than "is a window open?" — Mio's asks whether the companion is on screen, and no window event will ever fire for that |

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
| `os.iframe.ready` | action | Stable | `{ windowId }` — fires once per iframe when the chromeless bridge script has attached its listeners. Use this instead of the iframe's `load` event when timing matters (the native `load` fires before our bridge attaches, so messages sent on `load` can miss the listener). |
| `os.iframe.error` | action | Stable | `{ windowId, kind: 'error' \| 'unhandledrejection', message, filename, lineno, colno, stack }` — bridged from the iframe's `error` / `unhandledrejection` handlers. Cross-origin iframe errors are origin-filtered at the bridge and never reach this hook. |
| `os.iframe.network-completed` | action | Stable | `{ windowId, method, url, status, duration, failed }` — every `fetch` + `XMLHttpRequest` call inside the iframe. `status === 0` indicates a network-level failure with no response received. |

Use `IFRAME_READY` when you need to send a `os-focus` (or any parent→iframe message) as early as possible without racing the bridge setup. Use `IFRAME_ERROR` / `IFRAME_NETWORK_COMPLETED` to build a monitor widget that surfaces per-window reliability data.

#### Native-window lifecycle

These hooks fire only for native windows (`wp.os.registerWindow({ native: true, render })`). They let a plugin wrap or decorate another plugin's render output — e.g. injecting a consistent panel theme around every native window, or tagging the body for test automation.

| Hook | Kind | Status | Payload |
|---|---|---|---|
| `os.native-window.before-render` | filter | Stable | body `HTMLElement`, context `{ windowId, config }` — return the same element or a new wrapper the plugin should render into |
| `os.native-window.after-render` | action | Stable | `{ windowId, body, config }` — fires after the plugin's `render` callback has painted |
| `os.native-window.before-close` | filter | Stable | `( proceed: boolean, ctx: { windowId, config } ) → boolean` — applied when a native window is about to start its close animation; return `false` to cancel the close (any other return, including `undefined`, lets it proceed). Does not apply to iframe windows. |

**Iframe windows have their own, separate pre-close guard** — not this filter. Closing an iframe-backed window posts a `os-bridge-beforeunload-query` into the iframe and waits (up to 500ms) for a response before destroying; if the page inside has unsaved changes (`window.onbeforeunload` or a `beforeunload` listener sets a message), the user sees a confirm dialog first. See [`bridge-protocol.md`](./bridge-protocol.md#pre-close-unsaved-changes-query--os-bridge-beforeunload-) for the full message shape — there's no plugin-facing filter for this path, it's automatic for every iframe window.

#### Window body resize

| Hook | Kind | Status | Payload |
|---|---|---|---|
| `os.window.body-resized` | action | Stable | `{ windowId, width, height }` — fires when the window body element's size actually changes (mount, resize, reflow). Coalesced by the underlying `ResizeObserver`; use this instead of polling from inside a native-window render. |

### Filter: `os.wallpapers`

Receives the registered wallpaper list. Plugins can add entries, remove entries, or reorder — callback returns the (possibly modified) array.

```javascript
// Remove the 'aurora' preset from the picker grid.
wp.hooks.addFilter(
    'os.wallpapers',
    'my-plugin/hide-aurora',
    ( list ) => list.filter( ( w ) => w.id !== 'aurora' )
);
```

In practice most plugins use the `wp.os.registerWallpaper()` convenience — internally it adds a filter callback under a namespace the shell generates for you, so the raw filter API is only needed for non-additive operations.

---

## 5. Wallpaper registration API

The shell ships a registry-driven wallpaper picker: every entry in the registry becomes a swatch in the OpenStation Preferences panel, and the WallpaperLayer resolves whichever is currently selected onto the desktop. Plugins register their own via `wp.os.registerWallpaper()` (or the `os.wallpapers` filter).

Two shapes ship today: `css` (a static CSS background value) and `canvas` (a plugin-managed DOM subtree, typically a WebGL/2D canvas).

### Shape

```typescript
type WallpaperDef =
    | {
          type: 'css';
          id: string;
          label: string;
          preview: string;            // CSS `background` value for the swatch
          description?: string;       // Plain text, shown in OpenStation Preferences when selected
          value?: string;             // Applied to --os-bg
          resolveValue?: ( ctx: WallpaperContext ) => string;  // Dynamic alternative
          renderEditor?: WallpaperEditor;
          renderPreview?: WallpaperPreview;              // Live tile preview
          previewParams?: Record<string, unknown>;       // Preview defaults
          renderConfig?: WallpaperConfig;                // Settings dialog
      }
    | {
          type: 'canvas';
          id: string;
          label: string;
          preview: string;            // CSS `background` for the swatch (pre-mount)
          description?: string;       // Plain text, shown in OpenStation Preferences when selected
          mount: ( container: HTMLElement, ctx: WallpaperContext ) =>
                  ( () => void ) | Promise<() => void>;
          renderEditor?: WallpaperEditor;
          renderPreview?: WallpaperPreview;              // Live tile preview
          previewParams?: Record<string, unknown>;       // Preview defaults
          renderConfig?: WallpaperConfig;                // Settings dialog
      };

interface WallpaperContext {
    id: string;
    pluginUrl: string;                // no trailing slash
    prefersReducedMotion: boolean;
    visible: boolean;                 // current document visibility
    settings: Record<string, unknown>; // persisted per-wallpaper settings
}

// Passed to renderPreview.
interface WallpaperPreviewContext extends WallpaperContext {
    params: Record<string, unknown>;  // previewParams after the preview-params filter
    width: number;                    // tile content size in CSS px at mount time
    height: number;
}

type WallpaperPreview = ( container: HTMLElement, ctx: WallpaperPreviewContext ) =>
        ( () => void ) | Promise<() => void>;

// Passed to renderConfig.
interface WallpaperConfigContext extends WallpaperContext {
    setSettings( partial: Record<string, string | number | boolean> ): void;
}

type WallpaperConfig = ( container: HTMLElement, ctx: WallpaperConfigContext ) =>
        ( () => void ) | Promise<() => void>;
```

**`description`** — *Experimental.* A sentence or two shown in a styled card under the OpenStation Preferences picker grid whenever the wallpaper is the active selection: what it is, where its data comes from, the story behind it. Plain text only — it renders as text, never as HTML. Server-registered wallpapers can pass `description` to `openstation_register_wallpaper()` instead; the shell overlays the server value onto the JS def when the def doesn't set one (handy for translatable descriptions).

### Minimal CSS wallpaper

```javascript
wp.os.ready( () => {
    wp.os.registerWallpaper( {
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
wp.os.ready( () => {
    wp.os.registerWallpaper( {
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

Unknown module ids fail loudly via `os.wallpaper.mount-failed` — no silent non-activations.

**Never call `app.destroy( true )`.** In PixiJS v8 a literal `true` as the first argument runs `releaseGlobalResources()`, which clears Pixi's *page-global* texture and object pools — corrupting every **other** live Application on the page (the OpenStation Preferences live previews, other canvas wallpapers, any plugin's Pixi window). Symptoms are crash loops in `Batcher.break()` and teardown throws in `TexturePool.returnTexture()`. Use `app.destroy( { removeView: true } )` — same canvas cleanup, no global wipe.

### Registering your own module

If your plugin ships a library other plugins might want to share, register it once and let them `needs:` it by id.

```javascript
wp.os.registerModule( {
    id: 'three-js',
    url: `${ wp.os.config.pluginUrl }/vendor/three.min.js`,
    // Optional: skip re-loading if already present (e.g. Core shipped it).
    isReady: () => typeof window.THREE !== 'undefined',
} );
```

### Lifecycle guarantees

The shell protects against mount/unmount races with a monotonic generation counter. Rapid wallpaper switching is safe — a mount that resolves after the user has already picked something else tears itself down immediately and doesn't pollute the DOM.

Canvas wallpapers receive `ctx.prefersReducedMotion` and should render a single static frame rather than starting an animation loop when it's true. The shell also fires `os.wallpaper.visibility` on every `document.visibilitychange` so wallpapers can pause their tickers when the tab is backgrounded.

### `renderEditor` — in-panel controls

Any wallpaper can ship a `renderEditor` callback — when that wallpaper is the selected swatch in OpenStation Preferences, a collapsible panel opens below the grid and the editor is rendered into it. Same animation as the built-in custom-gradient editor.

Every mount receives a brand-new `container` element — the shell never recycles the previous mount's DOM, so editors built on renderers that cache state per container (lit-html and friends) work across select-away-and-back cycles without any special handling. Treat the container as yours until your returned teardown runs; don't keep references to it afterwards.

```javascript
wp.os.registerWallpaper( {
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

### `renderPreview` — live tile previews *(Experimental)*

Without `renderPreview`, a canvas wallpaper's swatch in the OpenStation Preferences picker is just its static CSS `preview` string — a flat gradient standing in for a living scene. With it, the picker mounts a live preview directly inside the tile.

The shell owns the lifecycle so previews stay cheap:

- **Lazy** — the preview mounts only when the tile is actually visible (IntersectionObserver), and tears down when the tile scrolls away, the settings tab is switched, or the panel closes. Every torn-down or failed state falls back to the CSS `preview` string.
- **Capped** — at most 4 live previews run concurrently (WebGL contexts are a scarce per-page resource, shared with the active wallpaper). Tiles beyond the cap keep the CSS fallback until a slot frees up.
- **Declared dependencies work** — the def's `needs: [...]` modules are loaded before `renderPreview` fires, exactly like `mount`.
- **Reduced motion is your job** — when `ctx.prefersReducedMotion` is true, render a still frame; don't start a ticker.

`ctx.params` is the parametrization hook: the def's `previewParams` seed, run through the `os.wallpaper.preview-params` filter. Use it for anything the preview should idealize instead of mirroring the real site. The built-in Living Tree is the canonical case — its real mount grows the tree from the site's actual age and content, which on a day-old site is a bare sprout; its preview instead renders a showcase snapshot (`{ siteAgeDays: 540, totalPosts: 120, … }`) so the picker always shows what the wallpaper can become.

```javascript
wp.os.registerWallpaper( {
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
    'os.wallpaper.preview-params',
    'my-plugin/sprout-preview',
    ( params, wallpaperId ) =>
        wallpaperId === 'wp-living-tree'
            ? { ...params, siteAgeDays: 0, totalPosts: 0 }
            : params
);
```

The same fields work on `type: 'css'` defs too (rarely needed — a CSS wallpaper's `preview` string usually IS the wallpaper).

### `renderConfig` — the wallpaper settings dialog *(Experimental)*

Wallpapers with real tunables (particle counts, palettes, physics) can ship a `renderConfig` callback. When the wallpaper is the active selection in OpenStation Preferences, a **"Wallpaper settings"** button appears below the picker grid; clicking it opens a `<os-modal>` whose body is handed to your callback. Wallpapers without `renderConfig` show no button — the surface is invisible unless you opt in.

Contrast with `renderEditor`: the editor is an always-visible inline panel below the grid (right for one or two controls the user plays with constantly, like the custom gradient's colours); `renderConfig` is a modal for a fuller settings form that would crowd the panel.

The shell owns everything except the form:

- **Chrome** — title (`<label> settings`), focus trap, ESC / click-outside, a Done button. Your callback renders only the controls, and returns a teardown (sync or via Promise) that runs when the dialog closes.
- **Persistence** — `ctx.setSettings( partial )` merges into the wallpaper's settings bag and saves through the normal OpenStation Preferences pipeline (localStorage + debounced user-meta sync, so values follow the user across devices). Scalar values only (`string | number | boolean`) — anything else is dropped by the server-side sanitizer. The bag round-trips through PHP capped at 64 wallpapers × 32 keys, strings at 256 chars.
- **Read-back** — every wallpaper context (`mount`, `renderPreview`, `renderEditor`, `renderConfig`) carries `ctx.settings`: the persisted bag, empty object when never configured. Treat the values as untrusted; clamp to your own defaults.
- **Live apply** — each `setSettings` fires the `os.wallpaper.settings-changed` action with `{ id, settings }` (the full post-merge bag). A mounted wallpaper subscribes and applies the change in place — no remount, so the dialog behaves as a live tuning panel.

```javascript
window.openStationWallpapers[ 'my-plugin/aquarium' ] = {
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
            'os.wallpaper.settings-changed',
            'my-plugin/aquarium-live',
            onSettings
        );
        return () => {
            wp.hooks.removeAction(
                'os.wallpaper.settings-changed',
                'my-plugin/aquarium-live'
            );
            scene.destroy();
        };
    },

    renderConfig: ( container, ctx ) => {
        const field = document.createElement( 'os-range-field' );
        field.setAttribute( 'label', 'Fish' );
        field.setAttribute( 'min', '1' );
        field.setAttribute( 'max', '60' );
        field.setAttribute( 'value', String( Number( ctx.settings.fishCount ) || 12 ) );
        field.addEventListener( 'os-range-change', ( e ) => {
            ctx.setSettings( { fishCount: e.detail.value } );   // persists + fires the action
        } );
        container.appendChild( field );
        return () => {};
    },
};
```

The built-in Snow wallpaper (`src/plugins/snow-wallpaper/`) is the canonical in-tree consumer — wind, snowflake count, flake size, and backdrop colour, all applied live.

### `window.wp.os` members

| Member | Status | Notes |
|---|---|---|
| `windowManager` | Stable | WindowManager instance |
| `dock` | Stable | Dock instance (null if no dock element) |
| `saveSession()` | Stable | Force a session write |
| `hooks` | Stable | Alias of `window.wp.hooks` |
| `isActive()` | Stable | `true` when the desktop shell is mounted and active on this page. Cheap capability check for plugins that also run in classic admin — branch desktop-vs-classic without probing the DOM yourself. |
| `sideDock` | Stable | Classic-layout left-edge Dock instance hosting core admin menus (null in Unified) |
| `registerWallpaper( def )` | Stable | Add a wallpaper to the registry + re-apply |
| `registerWidget( def )` | Stable | Add a widget to the registry |
| `registerSystemTile( item )` | Stable | Add a JS-owned launcher tile to the bottom dock rail, alongside plugin admin menus. Returns nothing; fires `os.dock.item-appended`. See "System tiles" below. |
| `loadVendorScript( url )` | Stable | Memoized `<script>` injector. Low-level; most plugins use `needs` instead. |
| `getWallpaperSurfaces()` | Stable | Live `WallpaperSurface[]` for collision-aware wallpapers. See "Wallpaper surfaces" below. |
| `registerModule( def )` | Stable | Register a shared vendor library under a stable id. |
| `loadModules( ids )` | Stable | Imperatively load registered modules. Usually unnecessary — canvas wallpapers declare `needs[]` and the shell resolves. |
| `ready( cb )` | Stable | **Recommended bootstrap entry point.** Run `cb` after `os.init` has fired — immediately (via microtask) if it already fired, queued otherwise. Safe for scripts loaded at any point in the lifecycle, including server-sync-injected plugin scripts. Short alias of `whenReady( cb )`. |
| `whenReady( cb )` | Stable | Original name for `ready( cb )` — same behaviour; keep using it if you've already adopted it. |
| `isReady()` | Stable | Synchronous boolean — has `os.init` fired yet. Branch between "register directly" and "schedule via `ready`" without racing. |
| `refreshMenu()` | Stable | Force a refresh of the live admin-menu split. Auto-fired on plugin activation / deactivation, and whenever a chromeless page reports a [`os-menu-signature`](#os-menu-signature--stable) that differs from the shell's last-known value — so a custom post type added via a settings tool surfaces without a browser reload (GH#325). Manual calls spawn a hidden iframe at `admin.php?openstation_chromeless=1&openstation_menu_refresh=1` whose server-side handler short-circuits the response with the fresh menu payload (a `<script>` that postMessages `os-plugins-changed`) without rendering admin-header / admin-footer — resolves in milliseconds. The full chromeless bridge still emits the same payload when the iframe lands on a real admin page (`plugins.php` etc.). |
| `setDefaultWindow( url \| null )` | Stable | Update the user's "open on startup" preference (`null` clears it). Async — persists through the REST endpoint; on success updates `config.defaultWindow` in place and dispatches the [`os-default-window-changed`](#os-default-window-changed--stable) CustomEvent on `document`. |
| `openNewWindow( id, opts? )` | Stable | Spawn a brand-new instance of a registered native window, even when one is already open. See [`wp.os.openNewWindow`](#wposopennewwindow-id-opts---stable). |
| `cloneTemplate( templateOrId )` | Stable | Clone a `<template>` element's contents into a fresh `DocumentFragment`. Accepts the element's DOM id or the element itself; throws if the reference doesn't resolve to a template. `openstation_register_window()` plugins don't need it — the shell pre-clones the declared template into the window body — it's for advanced re-cloning / custom hydration. |
| `createInfiniteList( options )` | Stable | Infinite-scroll renderer: sentinel-driven `IntersectionObserver`, abortable in-flight pages, dedup-by-id, cursor pagination. Full recipe: [`docs/examples/infinite-list.md`](./examples/infinite-list.md). |
| `startOAuth( service, options? )` | Stable | Start the OAuth relay flow for a service declared via PHP `openstation_register_oauth_relay()`. Resolves with the success payload, rejects with a tagged Error on failure. Full recipe: [`docs/examples/oauth-relay.md`](./examples/oauth-relay.md). |
| `getOsSettings()` | Stable | Defensive copy of the persisted OpenStation Preferences snapshot — same shape a settings tab's `ctx.getOsSettings()` returns. |
| `subscribeOsSettings( cb )` | Stable | Subscribe to OpenStation Preferences changes; returns an unsubscribe function. Mirrors the settings-tab `ctx.subscribeOsSettings` API. |
| `updateOsSettings( patch, opts? )` | Stable | Patch + persist the OpenStation Preferences state (whitelisted keys only). See [`updateOsSettings`](#updateossettings-patch-opts---stable). |
| `config` | Stable | The `DesktopConfig` that booted the shell. Notable read-only fields plugins reach for: `pluginUrl` (no trailing slash) and `pluginVersion` (the active plugin semver — surfaced in OpenStation Preferences → About; useful for version-gated features); `notesUrl` (string — REST base for the pinned-notes controller at `/desktop-mode/v1/notes`; the notes layer only boots when present); `canCreatePosts` (boolean — whether the current user has `edit_posts`, gating the note "Convert to post" affordances). Filterable server-side via `openstation_shell_config`. |

### System tiles

A **system tile** is a JS-owned launcher that isn't part of the admin menu — Jorvy, a plugin's native-window quick tool, a custom shortcut. The shell appends these to the **bottom dock rail** (the macOS-style pill, alongside installed-plugin admin menus) via the layout dispatcher, so the tile re-attaches automatically after a layout rebuild.

Register via `wp.os.registerSystemTile()`:

```javascript
wp.os.whenReady( () => {
    wp.os.registerSystemTile( {
        id:     'jorvy',
        title:  'Jorvy',
        icon:   'dashicons-star-filled',
        onOpen: () => {
            wp.os.windowManager.open( {
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
        isOpen: () => !! wp.os.windowManager.getById( 'jorvy' ),
    } );
} );
```

`registerSystemTile( item )` takes the tile definition only — there is no placement parameter and no return value. Every registration fires the `os.dock.item-appended` action with `{ id }`.

**Why the bottom rail:** plugin-contributed admin menus live in the bottom pill already (see `openstation_dock_placement`). Putting plugin-contributed shell launchers next to them keeps "everything plugin" in one place and keeps the left rail focused on core WP.

#### Where the tile lands

| Field | Type | Default | Meaning |
|---|---|---|---|
| `order` | `number` | `0` | Sort key within the zone, ascending; ties keep registration order. |

Set `order` whenever the tile's position matters. Registration order alone cannot express it: native-window tiles (including other plugins') register when their lazy script resolves, so a tile registered last can still be overtaken by one that arrived late. The shell's own trailing cluster uses `10` (Mio), `20` (Overview) and `30` (System), so anything left at the default sorts ahead of them.

#### Tiles with a menu

A system tile that declares a `submenu` fans it out of the rail on hover, through the same constellation flyout the admin menus use. Rows are `SubmenuItem`s, and on a system tile they normally carry an **`onSelect` callback** rather than a URL:

```javascript
wp.os.registerSystemTile( {
    id:    'my-plugin-tools',
    title: 'Tools',
    icon:  'dashicons-admin-tools',
    // Runs on click, and on every keyboard and touch activation —
    // the flyout is a hover gesture and never fans out for those.
    onOpen:  () => openMyDefaultTool(),
    submenu: [
        {
            title:  'Run import',
            url:    '',
            onSelect: () => openImportWindow(),
            // Declares which window this row opens, so the flyout can
            // list it under "Open windows" when it already is.
            windowId: 'my-plugin-import',
        },
        // Opens nothing, so no `windowId`.
        { title: 'Clear cache', url: '', onSelect: () => clearCache() },
        // A row with only a `url` opens it in a new browser tab.
        { title: 'Docs',        url: 'https://example.com/docs' },
    ],
} );
```

Four things follow from a system tile's menu being *actions* rather than admin pages:

- The panel is the same three sections an admin menu gets. The head shows the tile's icon and title and, having no landing page to open, runs the **first row** on click.
- Live windows are resolved from the rows. An admin menu has one window key; an action menu has none, so each row that opens a window declares it with `windowId` and the section lists the union. Rows that open nothing leave it unset.
- `onSelect` is **client-side only**. The server builds admin-menu submenus as JSON and a function cannot survive that trip; only JS-registered tiles can set it.
- `dock-peek` stands down for the tile, the same way it does for menu tiles. Give the tile an `onOpen` that does something defensible on its own, because a keyboard or touch user never sees the menu.

Declare `submenu` as a getter if the rows depend on live state — it is read fresh each time the flyout opens.

---

### Wallpaper surfaces

Collision-aware wallpapers (snow, rain, leaves, particle effects) need to know where things can "land" — window tops, the desktop floor, each dock's desktop-facing edge, widget cards. Rather than having every wallpaper hand-query the shell's DOM + hope the class names don't move, the shell emits a live surface list through `wp.os.getWallpaperSurfaces()`.

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

**Adding a custom surface.** Plugins that own floating DOM use the `os.wallpaper.surfaces` filter:

```javascript
wp.hooks.addFilter(
    'os.wallpaper.surfaces',
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
    const surfaces = wp.os.getWallpaperSurfaces();
    // Rebuild collision cache from `surfaces`, run physics step, draw.
}
```

Call it each frame (or throttled — the function is cheap but it does walk the DOM). Rects are in viewport coordinates so a canvas mounted inside `#os-wallpaper` can translate to its own drawing space using the wallpaper element's own `getBoundingClientRect()`.

**Pair with `os.window.bounds-changed`.** During a drag or resize the shell fires `bounds-changed` once per animation frame with the live `{ x, y, width, height }`. Subscribe there to invalidate your surface cache instead of polling `getBoundingClientRect()` each tick.

### Pre-registered modules

| id | ships from | global |
|---|---|---|
| `pixijs` | `assets/vendor/pixi.min.js` (PixiJS v8) | `window.PIXI` |

---

## DevTools / cross-plugin instrumentation

`wp.os.devtools` is the supported surface for third-party plugins that instrument windows registered by other plugins (SQL inspector, perf profiler, request logger). Reach for these primitives instead of wrapping `iframe.contentWindow` globals — multiple devtools can compose against the same window without fighting each other.

### `wp.os.devtools.addRequestHeader( windowId, name, value )` — Experimental

Contribute an HTTP header that the target window's iframe attaches to every fetch / XHR / sendBeacon. Returns a disposer.

```js
const stop = wp.os.devtools.addRequestHeader(
    'wp-window-edit-php',
    'X-WP-Debug-Session',
    sessionId,
);
// later:
stop();
```

`value` may be a literal string or a `() => string` thunk that recomputes per-request. Multiple contributors to the same name are joined with `, ` per RFC 7230. The header is removed when the last contributor disposes.

### `wp.os.devtools.onRequest( windowId, cb, { observe } )` — Experimental

Subscribe to every completed request from the target window. Returns a disposer.

```js
const stop = wp.os.devtools.onRequest(
    windowId,
    ( req ) => console.log( req.method, req.url, req.status ),
    { observe: true }, // include request + response headers
);
```

Default payload: `{ windowId, method, url, status, duration, failed }`. With `observe: true`: also `requestHeaders`, `responseHeaders`. The shell aggregates — as long as any active subscriber wants `observe`, the iframe runs in observation mode; otherwise it ships only the privacy-conscious summary.

### `wp.os.devtools.reloadWithDebugSession( windowId, sessionId, opts? )` — Experimental

Reload a window's iframe with a debug session id baked into both the URL and the request-header contribution registry. Bundles four boilerplate steps every devtool would otherwise re-derive:

```js
const sessionId = wp.os.devtools.debug.startSession();
const handle = wp.os.devtools.reloadWithDebugSession( windowId, sessionId );
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
    $sid = openstation_debug_session_for_request();
    if ( '' === $sid && isset( $_GET['wp_debug_session'] ) ) {
        $sid = sanitize_key( wp_unslash( $_GET['wp_debug_session'] ) );
    }
    if ( '' === $sid ) {
        return;
    }
    if ( ! defined( 'SAVEQUERIES' ) ) {
        define( 'SAVEQUERIES', true );
    }
    // … shutdown hook publishes via openstation_debug_publish( $sid, … )
}, 1 );
```

### `wp.os.devtools.debug` — Experimental

Generic per-session pub/sub bus. Pair with PHP `openstation_debug_publish()`.

```js
const sessionId = wp.os.devtools.debug.startSession();   // opaque uuid

// Tag every request with this session.
wp.os.devtools.addRequestHeader( windowId, 'X-WP-Debug-Session', sessionId );

// Subscribe to a channel.
const stop = wp.os.devtools.debug.subscribe(
    sessionId, 'query',
    ( ev ) => console.log( ev.payload ),
);

// Optional — local-echo without a server round-trip.
wp.os.devtools.debug.publish( sessionId, 'query', { sql: '…' } );
```

The shell polls `GET /desktop-mode/v1/debug?sessionId=…&since=…` every 1 s while at least one subscription is active for the session, and stops polling when the last subscription disposes.

### `Window.config.ownerHandle` — Experimental

The script handle of the plugin that registered a native window. Read for attribution:

```js
wp.os.registerTitleBarButton( {
    id: 'sql-inspector/attach',
    match: ( win ) => !! win.config.ownerHandle,
    // ...
} );
```

Always populated for windows registered via PHP `openstation_register_window( $args )` (carries `$args['script']`); undefined for iframe windows backed by a core admin page.

### postMessage protocol additions

| Type | Direction | Payload |
|---|---|---|
| `os-instrument-set` | parent → iframe | `{ headers: { name: value, … }, observe: boolean }`. Replaces the iframe's instrumentation slot wholesale on every change. |
| `os-iframe-network` | iframe → parent | Existing payload + optional `requestHeaders`, `responseHeaders` when the parent has set `observe: true`. |

See [`docs/examples/devtools-instrumentation.md`](./examples/devtools-instrumentation.md) for a complete worked example.

---

## Window attention API

**Stable.** See
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
exposes a `setAttention()` function (`wp.os.dock` in a normal
shell) and counts the request as routed when the rail API exists —
a rail that doesn't host a tile for this window silently no-ops.
The `setHighlight('persistent')` fallback (auto-cleared after
`durationMs`) only fires when **no** rail API is present at all, so
windows without a rail tile (`placement: 'none'`) get no visual
fallback while a dock is mounted.

JS filter: `os.window.attention( mode, { windowId, opts } )`
— return `null` to mute the request (Do Not Disturb integration).

All three rails (`dock`, `sideDock`, `icons`) emit on the
activity bus channel `os/badge-changed` with payload
`{ itemId, count, rail }`. The icon rail also fires
`HOOKS.ICON_BADGE_CHANGED` on the hook bus with
`{ iconId, count, previousCount }` for callers that only care
about the icon surface.

## `wp.os.icons` — the wallpaper-icon rail

**Stable.** Third badge surface, sibling of `wp.os.dock`
and `wp.os.sideDock`. Same `setBadge( id, count )` shape, so
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
wp.os.icons.setBadge(   'os-messages', 5 );
wp.os.icons.clearBadge( 'os-messages' );
wp.os.icons.getBadge(   'os-messages' ); // → 0 (after clear)
```

- **Idempotent.** Same count twice = no DOM mutation, no re-emit.
- **Silent no-op when the id isn't on the rail.** Lets the
  fan-to-all-rails pattern work without triple-emitting.
- **Survives a full grid rebuild.** The framework persists the
  badge across plugin activations / live menu refreshes — set
  once, the renderer re-paints from internal state.
- **`>99` renders as `99+`** so the pill stays compact.

Every applied change publishes on:

- `os/badge-changed` activity channel with
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

## `<os-avatar>` — Stable

```html
<os-avatar
    src="https://…/me.jpg"
    name="Daniel López"
    size="40"               <!-- px or 'xs' | 'sm' | 'md' | 'lg' | 'xl' -->
    presence="online"       <!-- 'online' | 'inactive' | 'offline' -->
    user-id="42"            <!-- auto-subscribes to os-presence-changed -->
></os-avatar>
```

Falls back to a deterministic-hue letter tile when `src` is empty
or fails to load. Emits `os-avatar-click` `{ userId: number | null }`
when the `clickable` boolean attribute is set; without it the tile
is decorative and clicks pass through to the surrounding row.

## `<os-textarea>` — Stable

```html
<os-textarea
    label="Message"
    rows="2"
    auto-grow
    max-rows="8"
    submit-on-enter        <!-- Enter sends; Shift+Enter newlines -->
    maxlength="4000"
></os-textarea>
```

Same event shape as `<os-text-field>`: `os-input-change`,
`os-input-commit`, `os-submit`. Imperative methods:
`focusInput()`, `clear()`, `refreshAutosize()`.

---

## Window-chrome customization framework

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

### Public APIs on `wp.os.*`

```ts
// Layer 1 — Themes (Stable)
wp.os.registerWindowTheme( def );          // throws RegistrationError on bad input
wp.os.unregisterWindowTheme( id );
wp.os.listWindowThemes();
wp.os.applyWindowTheme( windowId, override );

// Layer 2 — Controls (Stable)
wp.os.registerWindowControl( def );        // `label` becomes the button's accessible name
wp.os.unregisterWindowControl( id );       // pass 'core/close' to hide globally
wp.os.listWindowControls();
wp.os.applyWindowControls( windowId, override );

// Layer 3 — Slots (Stable)
wp.os.registerWindowSlot( def );
wp.os.unregisterWindowSlot( id );
wp.os.listWindowSlots();
wp.os.applyWindowSlot( windowId, slot, config );

// Layer 4 — Custom chrome (Experimental)
wp.os.registerWindowChrome( def );
wp.os.unregisterWindowChrome( id );
wp.os.listWindowChromes();
wp.os.applyWindowChrome( windowId, chromeId );

// Window notices — Experimental. See subsection below.
wp.os.registerWindowNotice( entry );
wp.os.unregisterWindowNotice( id );
wp.os.listWindowNotices();
wp.os.dismissWindowNotice( id );
wp.os.undismissWindowNotice( id );
```

### Window notices — Experimental

Tone-coded banners pinned to the top of any matching window. The
shell renders each entry as a `<os-notice>` web component inside
the matching window's `after-titlebar` slot host, and each user's
dismissal of a given `id` is persisted in `localStorage` under
`os-notice-dismissed:<userId>` so the banner never
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

wp.os.registerWindowNotice( entry );   // returns an unregister fn
wp.os.unregisterWindowNotice( id );
wp.os.listWindowNotices();              // snapshot, sorted by (order, id)
wp.os.dismissWindowNotice( id );        // imperative dismiss (writes localStorage)
wp.os.undismissWindowNotice( id );      // clear a prior dismissal
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
| `os-notice-dismissed:<userId>` | `Record< noticeId, true >` (JSON) | Falls back to `…:anon` for logged-out / pre-hydration. |

### JS hooks (under `wp.hooks` / `addFilter`-`addAction`)

| Name | Type | Status | Notes |
|------|------|--------|-------|
| `os.window.chrome.theme` | filter | Stable | Mutate the resolved CSS-variable map per window. |
| `os.window.chrome.theme-changed` | action | Stable | Fires after each successful theme apply. |
| `os.window.chrome.controls` | filter | Stable | Mutate the resolved per-placement control list. |
| `os.window.chrome.slot` | filter | Stable | Mutate the host element of each slot after content settles. |
| `os.window.chrome.render` | filter | Experimental | Mutate the chrome id selected for a window. |
| `os.window.chrome.applied` | action | Stable | Fires per layer after a paint completes. `layer` is `'controls' \| 'slots' \| 'chrome'`. |

### Iframe-side bridge (`wp.os.iframe.chrome.*`) — Stable

Inside any chromeless iframe, plugin code can drive its own window's chrome via these helpers (parent-side handlers route them to the matching `Window.setAppearance*` methods):

```ts
wp.os.iframe.chrome.setTheme( tokens );    // CSS-var map
wp.os.iframe.chrome.setControls( config ); // WindowControlsConfig
wp.os.iframe.chrome.setSlot( name, html ); // sandboxed via textContent
```

### postMessage protocol additions

```ts
// iframe → parent
{ type: 'os-chrome-theme',    tokens: Record< string, string > }
{ type: 'os-chrome-controls', config: WindowControlsConfig }
{ type: 'os-chrome-slot',     slot: string, html: string }
```

Each is origin-gated to the parent shell's origin and source-gated to the matching window's iframe `contentWindow`.

---

## Progressive Web App

`wp.os.notify( opts )` is the public surface for local
notifications. v1 uses the browser `Notification` API directly with a
toast fallback when permission is denied; v2 will route the same call
through the SW for push.

```ts
wp.os.notify( {
    title: 'Build complete',
    body: '12 files updated.',
    icon: '/favicon.png',
    tag: 'my-plugin/build',          // collapse repeat alerts
    requireInteraction: false,
    onClick: ( n ) => { window.focus(); n.close(); },
} ); // returns a dismiss callback
```

Routes through the activity-bus filter
`os/notification-requested` (return `cancel: true` to
suppress) and broadcasts on `os/notification-shown` after
rendering.

### `wp.os.pwa.*` — programmatic install + permission control

```ts
wp.os.pwa.promptInstall();
//   Promise<'accepted' | 'dismissed' | 'unavailable'>

wp.os.pwa.requestNotificationPermission();
//   Promise<'granted' | 'denied' | 'default' | 'unsupported'>

wp.os.pwa.getNotificationPermission();
//   'granted' | 'denied' | 'default' | 'unsupported'

wp.os.pwa.getState();
//   { installHintDismissed: boolean, notificationsEnabled: boolean }

const off = wp.os.pwa.subscribe( ( s ) => { /* ... */ } );

wp.os.pwa.undismissInstallHint();
//   Re-surface the floating install pill after the user dismissed it.
```

See [`docs/pwa.md`](./pwa.md) for the full architecture and
[`docs/examples/pwa-install.md`](./examples/pwa-install.md) /
[`docs/examples/notify.md`](./examples/notify.md) for recipes.

---

## `wp.os.files` — the Files-on-the-Desktop registry *(Experimental)*

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

### Placement shape — viewer-scoped extras

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
     * shared folder" instead), and anything a `openstation_files_user_can_trash_placement`
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

### `os.files.types` filter

```ts
applyFilters( 'os.files.types', list: DesktopFileTypeDef[] ): DesktopFileTypeDef[];
```

Plugins reorder, hide, or swap entries here.

### `os.files.type-registered` / `type-unregistered` actions

```ts
doAction( 'os.files.type-registered', type: string, def: DesktopFileTypeDef );
doAction( 'os.files.type-unregistered', type: string );
```

### Openers — file-association layer

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

Methods on `wp.os.files`:

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
registerTilePayloadHandler(
    type: string,
    handler: TilePayloadHandler,
): () => void;
```

### `registerTilePayloadHandler` — accepting drops on your own icon

Every non-folder desktop tile carries a claimant that hard-rejects
foreign payloads, so a drop can't fall through to the wallpaper
underneath. That claimant is what shows the red "Can't drop here" chip.

**Registering a competing `DropTarget` on the tile element does not
work.** The drop-target registry allows one target per element and the
claimant is installed last, so a target installed during
`os.files.tile-rendered` — which fires from inside
`buildTile`, before the claimant — is immediately displaced. This is
the cooperative seam instead: the layer keeps owning the target and
consults registered handlers for the accept predicate, the hover chip,
and the drop.

```ts
interface TilePayloadContext {
    /** The placement backing the tile under the cursor. */
    placement: RestPlacementShape;
}

interface TilePayloadHandler {
    /**
     * Cheap, payload-independent check on the placement — "is this a
     * tile I care about?". Keep it as narrow as possible.
     */
    appliesTo( ctx: TilePayloadContext ): boolean;
    /** Whether a concrete payload is acceptable on this tile. */
    accept( data: Record< string, unknown >, ctx: TilePayloadContext ): boolean;
    /** Chip label shown while a matching payload hovers the tile. */
    acceptLabel: string;
    onDrop(
        session: DragSession,
        ev: { clientX: number; clientY: number },
        ctx: TilePayloadContext,
    ): void;
}
```

```js
const off = wp.os.files.registerTilePayloadHandler( 'shortcut', {
    appliesTo: ( { placement } ) => placement.file.ref === 'lienzo',
    accept: ( data ) => data.kind === 'attachment',
    acceptLabel: 'Open in Lienzo',
    onDrop: ( session ) => {
        openInLienzo( session.payload.data );
    },
} );
```

Several handlers may share a payload type — resolution is
**first-registered whose `appliesTo` matches**, so handlers only ever
compete when they claim the same tile for the same type. A handler
whose `appliesTo` returns true for every placement will shadow every
handler registered after it, so scope the predicate to your own icon.

Payload `type` is the drag payload's type, not the file type:
`'shortcut'` covers desktop icons, post/page references, and dock-item
promotions; `'attachment'` covers Media Library drags; `'note'` covers
pinned notes. Read `session.payload.data` for the payload itself.

Returns a deregister function.

See [Examples — accept drops on your desktop icon](./examples/tile-drop-handler.md).

Resolution chain inside `resolveOpener`: user override (read from `userFileAssociations` in the shell config) → `isDefault` opener → first match → `null`. The result passes through the `os.files.resolve-opener` filter.

`open( file )` invokes the resolved opener's handler:
- `kind: 'url'` → opens a chromeless iframe via `wp.os.windowManager.open`.
- `kind: 'window'` → opens a registered native window via `wp.os.openWindow`. The optional `config( file )` callback is currently **not delivered** to the window — the shell's opener wiring drops the computed value, so `wp.os.getWindowConfig( windowId )` keeps returning only the PHP-registered config blob. Don't rely on per-file config until this gap is closed.
- `kind: 'js'` → runs the plugin's free-form callback.

Lifecycle actions fired during `open()`:

```ts
doAction( 'os.files.opening', { file: DesktopFile, openerId: string } );
doAction( 'os.files.opened',  { file, openerId, kind: 'url' | 'window' | 'js' } );
doAction( 'os.files.open-failed', { reason: 'no-opener' | 'handler-threw', type, ref, openerId?, error? } );
```

Filter for the registry list:

```ts
applyFilters( 'os.files.openers', FileOpenerDef[] ): FileOpenerDef[];
applyFilters( 'os.files.resolve-opener', FileOpenerDef | null, type: string ): FileOpenerDef | null;
```

---

## Real file storage — client surface (Experimental)

Real per-user desktop storage (the `upload` file type). Server-side
contract: [files-on-desktop.md → Real file storage](files-on-desktop.md#real-file-storage-upload--experimental).

**Shell config key** — `config.desktopStorage`:

```ts
interface DesktopStorageConfig {
	canUpload: boolean;    // viewer holds the (filterable) upload capability
	maxBytes: number;      // per-file cap, 0 = no client cap
	quotaBytes: number;    // per-user quota, 0 = unlimited
	zipAvailable: boolean; // server has ZipArchive → folder-zip affordances render
}
```

**Drop hook chain** — desktop-storage uploads fire the exact same
`os.drop.*` actions and filters the Media Library sink
does (`files-detected`, `dialog-fields`, `before-upload`,
`upload-started`, `upload-progress`, `after-upload`,
`upload-failed`) — subscribers don't branch on the destination. The
`AFTER_UPLOAD` payload's `result` is `{ placement, storedFileId }`
for the desktop sink (vs. the attachment shape for media). The
upload dialog's destination default follows the drop's intent:
folder-targeted drops and the desktop pickers → Desktop; WordPress
admin windows → Media Library; flat desk drops → Media Library when
every file is `image/*` / `video/*` / `audio/*`, Desktop otherwise;
folder-tree drops force Desktop. Dropping again while the dialog is
open replaces its pending batch with the latest drop (one dialog,
never stacked modals, never mixed batches).

**Serialized shape** — `upload` placements carry
`file.ownerId`, `file.sizeBytes`, `file.mime`, and `file.kind`
(`image | video | audio | pdf | archive | text | file`) on top of
the base `DesktopFileShape`.

**Tile menu** — the built-in entries injected through the standard
`os.files.tile-menu` filter: `desktop-mode/upload-download`
(every viewer), `desktop-mode/upload-share` (owner),
`desktop-mode/upload-leave` (recipient's root tile), and
`desktop-mode/folder-zip-download` on folder tiles when
`zipAvailable`. Plugins reorder/hide them like any other item.

**Heartbeat invites** — single-file share invites ride the existing
`shares.pending` channel with `targetType: 'file'`, `fileId`, and
`fileName` on the shape; folder invites are unchanged (no
`targetType`).

**Download URLs** are minted at click time (cookie +
`_wpnonce`-in-query GET navigations) and must never be persisted —
nonces expire.

**Preview pane** — image/video/audio uploads render inline in the
folder-window preview (subresource loads via the authenticated
download URL); other kinds show a no-preview note + Download.
Plugins preview further types (PDF, …) through the pre-existing
`os.files.preview` filter — return an element for the
placements you recognize; see
[examples/desktop-file-storage.md](examples/desktop-file-storage.md#extend-the-preview-pane-eg-pdfs).

---

## Native Plugins window

The `desktop-mode-plugins` native window replaces the chromeless `plugins.php` and `plugin-install.php` iframes. Two tabs (Installed + Browse), a `<os-flyout>` detail panel, .zip upload (button + drop-on-window), and drag-card-to-dock pinning via the framework drag bridge.

### URL routing

Both `plugins.php` and `plugin-install.php` are claimed by `registerNativeUrlRemap`. The latter stashes a `tab: 'browse'` hint in the shared store `'desktop-mode/plugins-window/tab-target'` so the bundle's first paint activates the Browse tab. When `nativePluginsEnabled` is `false`, the click falls through to the classic iframe path.

**Threading state into the window a remap opens.** A remap entry may declare a `params( url, parsed )` hook returning open-time [`params`](#wposopenwindow-id-opts---stable) for its native window. **Prefer it over a shared store**: params are persisted with the session and staged back on restore, so the window reopens on the same subject after a reload — a shared store does not survive the reload and the window comes back on its default. A throwing hook is logged and the window still opens, the same tolerance `onMatch` has. Remaps that declare no hook call the opener with one argument exactly as before.

**Two views of the same object.** Some URLs are the only address WordPress has for a thing, and more than one window may legitimately want them. `user-edit.php?user_id=12` is the only URL for a person, but a shop asks a different question about that person than "edit their role". The `os_person_view` query flag resolves it: the built-in profile remap stands down on any person-URL carrying it, so a specific view can claim the URL without having to win a registration-order race. The value is the claiming view's id (`wc-customer`), so a third view can join without either existing one changing. Exported as `OS_PERSON_VIEW_PARAM`; the PHP side that builds such URLs must use the same literal.

### Drag bridge integration

Cards in the Browse gallery call `wp.os.dragManager.start({ … })` on pointer-down. The payload is:

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

The bundle pre-installs a drop target on the dock element that accepts this payload type and calls `wp.os.registerSystemTile()` to pin a transient tile pointing at the plugin's wp.org page. **Plugin authors can register their own drop targets** (e.g. on a custom canvas) that filter on `payload.type === 'wporg-plugin'` and react to a card drop with no further coordination.

### Live-refresh

After every install / activate / deactivate / delete the bundle calls `await wp.os.refreshMenu()`. That spawns a hidden chromeless iframe to capture the real-admin-context menu payload (handles plugins that gate `admin_menu` on `is_admin()`) — same primitive the chromeless bridge uses. Plugin authors that mutate plugin state from elsewhere should mirror this:

```ts
await myInstallFlow();
await window.wp.os.refreshMenu();
```

### Shared state — initial tab hint

```ts
import { setPluginsWindowTab } from 'openstation/plugins-window/tab-target';

setPluginsWindowTab( 'browse' ); // call BEFORE openById( 'desktop-mode-plugins' )
```

Backed by `wp.os.createSharedStore( 'desktop-mode/plugins-window/tab-target', … )` so multiple bundles see the same value.

---

## WP Explorer — extensibility surface (Experimental)

The native window registered under id `desktop-mode-my-wordpress`
exposes three JS hook points and a small public API. Every section
(Posts, Pages, Users, Media, plugin-defined kinds) uses the same
hooks, so a single plugin descriptor can decorate any preview pane.

### Public API — `wp.os.myWordpress`

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
     */
    openMedia( args: { mediaId: number; mediaTitle?: string } ): void;

    /**
     * Open a user's GitHub-style activity footprint. Mirror of
     * `openDetail` / `openMedia`, for users. Idempotent and
     * cold-start safe — opens (or focuses) the window and navigates
     * it to the footprint route even from a session that never
     * opened WP Explorer.
     *
     * This is the same window the "View activity footprint" row
     * action in the classic Users table reaches (that path routes
     * through the `os-open-user-footprint` bridge message;
     * see § 3 and `bridge-protocol.md`).
     *
     */
    openUserFootprint( args: { userId: number; userName?: string } ): void;

    /**
     * Register a renderer for a custom entity kind so a plugin
     * can ship its own section type without patching the bundle.
     * Pair with a PHP entry in `openstation_my_wordpress_entities`
     * carrying the same `kind` slug.
     *
     * Returns an unregister function.
     *
     */
    registerEntityKind(
        kind: string,
        renderer: ( host: EntityRenderHost, entity: MyWordPressEntity ) => void,
    ): () => void;

    /**
     * Trash an entity by its WP Explorer entity id (`'posts'`,
     * `'pages'`, `'users'`, plugin-defined). Resolves when the
     * REST DELETE succeeds and broadcasts
     * `os-my-wordpress-entity-trashed` on `document`
     * so every live list view drops the tile reactively.
     *
     * Does NOT show a confirm dialog — that UX layer is the
     * caller's responsibility. The right-click "Move to Trash"
     * menu wraps this with its own confirm; the recycle-bin
     * drag-to-trash calls it directly (macOS pattern: the drag
     * is the deliberate gesture, no extra confirm).
     *
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

### Filter — `os.my-wordpress.preview-actions`

Decorate the right-pane action button row. Receives the
server-declared descriptors (already capability-gated) merged with
any client-only entries the filter chain has added on prior calls.
Wire the `onSelect` handler here — server descriptors only carry
metadata.

```ts
wp.hooks.addFilter(
    'os.my-wordpress.preview-actions',
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

### Action — `os.my-wordpress.preview-extras`

Inject DOM into named slots on the right pane (`'header' | 'meta'
| 'footer'`). Fires once per slot per preview render, for media
previews, post-kind previews (posts, pages, and every CPT section),
and user-kind previews (the Users section and any section serving
people) — one contract covers every section.

```ts
wp.hooks.addAction(
    'os.my-wordpress.preview-extras',
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

Payload:

```ts
interface PreviewExtras {
    slot: 'header' | 'meta' | 'footer';
    /** Append your DOM here. Always present, even when empty. */
    container: HTMLElement;
    /** Section id — `'posts'`, `'media'`, `'cpt-product'`, … */
    entityId: string;
    /** Render kind — `'post'`, `'user'`, `'media'`, or a custom one. */
    kind: string;
    /** The row being previewed (post, attachment, or user). */
    item: Record< string, unknown >;
}
```

Slot order in a post-kind pane is `header` (above the featured image
and the rendered content), `meta` (below the content, above the action
row), then `footer`.

A user-kind pane fires all three, and the useful one is `meta`:
`header` sits above the identity header, `meta` sits directly under
the name, face and biography, and `footer` sits below the action row.
**A summary of a person belongs in `meta`** — money or metrics placed
above someone's avatar read as a label on them, and a reader cannot
tell whose figure it is until they have scrolled past it to the name.
The WooCommerce customer panel paints into `meta` for exactly that
reason.

Subscribers that fetch data should re-check
`container.isConnected` before painting — the pane repaints on every
selection change, and a slow request can outlive its pane.

### Filter — `os.my-wordpress.user-dossier-sections`

Choose which blocks a user preview renders. The identity header (name,
face, roles) is not in the list — a dossier without it is not a
dossier.

```ts
wp.hooks.addFilter(
    'os.my-wordpress.user-dossier-sections',
    'my-plugin/customers',
    ( sections, ctx ) =>
        ctx.entityId === 'wc-customers'
            ? sections.filter( ( id ) => id === 'bio' )
            : sections,
);
```

Sections, in render order: `'bio' | 'stats' | 'activity' |
'milestones' | 'recent' | 'terms'`. Context:
`{ entityId: string; kind: string; userId: number }`.

The built-in dossier answers *"what has this person written"* — post
and page counts, a publishing sparkline, recent posts, top categories.
That is right in the Users folder and wrong in a section whose people
have never written anything: four zeroes above the figure you came for
read as the answer. Drop what doesn't apply.

The filter does not fire for the author / contributor sub-folders
inside a post's detail view — those have no section context and always
render every block.

### Filter — `os.my-wordpress.user-activate`

Claim "the user opened this person" — the double-click on a user tile.

```ts
wp.hooks.addFilter(
    'os.my-wordpress.user-activate',
    'my-plugin/contacts',
    ( handled, ctx ) => {
        if ( handled || ctx.entityId !== 'my-contacts' ) {
            return handled;
        }
        return wp.os.openWindow( 'my-plugin/contact', {
            params: { contactId: Number( ctx.item.id ) },
        } );
    },
);
```

Context: `{ entityId: string; kind: string; item: Record< string, unknown > }`.
Return `true` to say you handled it — the built-in navigation is then skipped. Anything else falls through, so a filter that forgets to return can't leave double-click doing nothing.

The built-in answer is the activity footprint, which is right in the Users folder (a person there is someone who writes) and wrong anywhere they aren't. The WooCommerce Customers section claims it for the Customer window.

### Filter — `os.my-wordpress.user-preview-actions`

The buttons in a user preview's action row. Built-ins are
`'footprint'` ("View activity footprint", primary) and
`'open-profile'` ("Show profile", secondary).

```ts
wp.hooks.addFilter(
    'os.my-wordpress.user-preview-actions',
    'my-plugin/orders',
    ( actions, ctx ) => {
        if ( ctx.entityId !== 'wc-customers' ) {
            return actions;
        }
        return [
            {
                id: 'wc-orders',
                label: 'View their orders',
                variant: 'primary',
                onSelect: () => openOrders( ctx.item.id ),
            },
            ...actions.filter( ( a ) => a.id !== 'footprint' ),
        ];
    },
);
```

```ts
interface UserPreviewAction {
    id: string;
    label: string;
    /** Native tooltip. */
    title?: string;
    variant?: 'primary' | 'secondary';
    onSelect: () => void;
}
```

Context: `{ entityId: string; kind: string; item: Record< string, unknown > }`.
Entries without a callable `onSelect` are dropped; returning an empty
array removes the action row entirely rather than leaving an empty bar.

### Filter — `os.my-wordpress.list-bands`

Split a section's tiles into labelled bands instead of one flat
canvas. Return `null` (the default) to leave the section ungrouped.

```ts
wp.hooks.addFilter(
    'os.my-wordpress.list-bands',
    'my-plugin/by-status',
    ( banding, entity ) => {
        if ( entity.id !== 'cpt-ticket' ) {
            return banding;
        }
        return {
            bands: [
                { id: 'open', label: 'Open', order: 10 },
                { id: 'done', label: 'Closed', order: 20 },
            ],
            assign: ( item ) => ( item.ticket_state === 'open' ? 'open' : 'done' ),
        };
    },
);
```

```ts
interface ListBanding {
    /** Bands in render order. Lower `order` renders first. */
    bands: Array< { id: string; label: string; order?: number } >;
    /**
     * Which band a row belongs to. Return null — or an id not in
     * `bands` — to fall into the last band, so keep a catch-all last.
     */
    assign: ( item: EntityListItem ) => string | null;
}
```

A band renders the moment its first row lands, in its `order`
position, so bands that stay empty never take up space. Each band gets
its **own tile layout**, keyed `entity:<id>:band:<bandId>`, so
rearranging icons in one band doesn't disturb another.

Rows are banded as they arrive from the paginated list, so on a
section with more rows than one page a band fills in as the user
scrolls. Bands order the view; they don't re-query the server.

**Custom fields:** the window sends an explicit `_fields` list, so a
key your endpoint returns is stripped before the bundle sees it unless
the section declares it in `listFields` (see
[`openstation_my_wordpress_entities`](./hooks-reference.md#openstation_my_wordpress_entities--experimental)).

**`editUrl` — rows that don't live in `wp_posts`.** Opening a row for
editing normally means `post.php?post=<id>`, derived from the row's
id. A section whose records are stored somewhere else has no such URL:
a WooCommerce order under High-Performance Order Storage is the
in-tree case, and `post.php` on its id opens a different post or
nothing at all.

Return an `editUrl` on the row and the window uses it verbatim
wherever it would have built one:

```php
add_filter( 'rest_prepare_my_thing', function ( $response, $thing ) {
    $response->data['editUrl'] = admin_url( 'admin.php?page=my-thing&id=' . $thing->id );
    return $response;
}, 10, 2 );
```

Declare it in the section's `listFields` — otherwise `_fields` strips
it off the list rows and only the single-row fetch carries it, which
reads as "edit works from the preview pane but not from a tile".

### Action — `os.my-wordpress.list-tile`

Decorate a list tile. Fires once per tile, after the built-in chrome
(status ribbon, lock badge) and before the tile is placed.

```ts
wp.hooks.addAction(
    'os.my-wordpress.list-tile',
    'my-plugin/badge',
    ( { tile, entityId, item } ) => {
        if ( entityId !== 'cpt-product' || item.in_stock ) {
            return;
        }
        const badge = document.createElement( 'span' );
        badge.className = 'my-plugin-badge';
        badge.textContent = 'Out of stock';
        tile.appendChild( badge );
    },
);
```

Payload: `{ tile: HTMLElement; entityId: string; kind: string; item: EntityListItem }`.
The tile is positioned, so a badge should be absolutely positioned
within it.

Fires for post-kind and user-kind tiles alike. Check `kind` rather
than `entityId` when your decoration is about the *thing* rather than
about the section — a user who has spent money is a customer whether
you are looking at the Users list or a shop's Customers list, and the
WooCommerce integration keys its tile decoration off `kind === 'user'`
for exactly that reason.

A user tile carries a `.os-my-wordpress__user-tile-sub` sub-line
("role · N posts" by default). Rewriting its `textContent` is the
supported way to say something truer about the person for your
section.

### Action — `os.my-wordpress.group-extras`

Inject a panel above the folder tiles when the user opens a plugin or
theme folder. For whole-folder context worth showing before a section
is picked — store totals on a shop folder, sync status on an
importer's.

```ts
wp.hooks.addAction(
    'os.my-wordpress.group-extras',
    'my-plugin/store-totals',
    ( ctx ) => {
        if ( ctx.groupId !== 'plugin:my-plugin' ) {
            return;
        }
        ctx.container.appendChild( buildTotalsPanel() );
    },
);
```

Payload:

```ts
interface GroupExtras {
    container: HTMLElement;
    /** e.g. `'plugin:woocommerce'`, `'theme:twentytwentyfive'`. */
    groupId: string;
    group: { id: string; label: string; icon: string; order: number } | null;
    /** Section ids inside this folder. */
    entityIds: string[];
}
```

The container is appended empty when nothing subscribes, and
`:empty` hides it, so an unsubscribed folder is visually unchanged.

### Filter — `os.my-wordpress.tile-context-menu`

Decorate the per-tile right-click menu. Same descriptor shape as
the preview-actions row; plugin entries must carry an `onSelect`
handler (built-ins are dispatched by the bundle's static switch).

```ts
wp.hooks.addFilter(
    'os.my-wordpress.tile-context-menu',
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

Context: `{ entityId, kind, item }`. Wired on the post / page tile
menu (`kind` from the entity, default `'post'`), the media tile menu
(`kind: 'attachment'`), and the user tile menu (`kind: 'user'`) —
write the filter as if the hook fires for every section.

**Multi-selection.** These lists are multi-select, and an entry you
add here appears only while ONE tile is selected until it opts in.
Add `multi: true` (plus optionally `sort`, `bulkLabel( n )`, and a
`bulk( items )` runner) to let it act on a set — the fields and the
intersection rules are the same ones the file-tile menu uses, and
they're documented under
[`wp.os.selection`](#selection--experimental).

#### Built-in bulk actions

The lists carry wp-admin's own bulk actions, as multi-safe entries
on the same menu. Your filter sees them in `options` and can reorder
or remove them by id.

| Section | Id | Equivalent in wp-admin |
|---|---|---|
| Posts / Pages / CPTs | `open` | Row action → Edit |
| | `navigate-into` | *(no equivalent — the dossier view)* |
| | `bulk-edit` | **Bulk actions → Edit** — status, author, comments, sticky, add categories, add tags |
| | `publish` | Row action → Publish *(hidden for already-published entries)* |
| | `to-draft` | Row action → Switch to Draft *(hidden for entries already drafts)* |
| | `copy-links` | *(no equivalent)* |
| | `trash` | **Bulk actions → Move to Trash** |
| Media | `navigate-into`, `open-source` | Row actions |
| | `detach` | Row action → Detach *(hidden for unattached files)* |
| | `copy-links` | *(copies `source_url`)* |
| | `delete` | **Bulk actions → Delete permanently** |
| Users | `footprint`, `open-profile`, `author-archive` | Row actions |
| | `change-role` | **Bulk actions → Change role to…** |
| | `delete-user` | **Bulk actions → Delete** — asks core's "delete their content or reassign it" question |

Two behaviours of the bulk-edit modal are worth knowing because they
are core's, not ours: every control starts on **— No change —** and a
field left alone is absent from the request (so a bulk edit can never
overwrite eleven entries with the twelfth's values), and **categories
and tags are additive** — the terms you pick are added to what each
entry already has. Controls appear only where the post type supports
them: no `categories` key in the REST response means no category
picker, and sticky is offered for the built-in `post` type only.

The status actions are a good illustration of the intersection rule
in the wild: `publish` is offered only for an entry that isn't
published and `to-draft` only for one that isn't a draft, so a
selection holding one of each has neither in common and the menu
shows only what applies to all of them.

### Filter — `os.my-wordpress.status-bar` (existing)

Already documented above — unchanged, except that `ctx.view` gained a
`'group'` member for the plugin-folder view described below.

### Navigation — routes

The window's internal `Route` union drives the breadcrumb and the back
button. Renderers installed via `registerEntityKind()` receive the
current route on their host and can navigate to any of these:

```ts
type Route =
    | { kind: 'root' }
    | { kind: 'group'; groupId: string }
    | { kind: 'list'; entityId: string }
    | { kind: 'detail'; entityId: string; postId: number; postTitle: string }
    | { kind: 'sub-list'; entityId: string; postId: number; postTitle: string; relation: SubRelation }
    | { kind: 'user-footprint'; entityId: string; userId: number; userName: string }
    | { kind: 'media-detail'; entityId: string; mediaId: number; mediaTitle: string };
```

`'group'` renders the folder that collects every section sharing a
`group` id — one per plugin or theme that registered custom post types.
Its members are the sections whose descriptor carries that id; the
breadcrumb reads `Site › WooCommerce › Products`, and a grouped
section's parent route is its group rather than the root.

### Section descriptors — grouping and thumbnails

Entity descriptors reaching the bundle (from
`openstation_my_wordpress_entities` server-side, or appended in JS)
carry four optional fields beyond the documented core set:

```ts
interface MyWordPressEntity {
    // …id, label, icon, restPath, kind, post_type
    /** false keeps the section icon on every tile. Default: on. */
    thumbnails?: boolean;
    /** Root folder id this section nests under. null → loose at root. */
    group?: string | null;
    groupLabel?: string | null;
    groupIcon?: string | null;
    groupOrder?: number | null;
    /**
     * Extra REST fields to keep on this section's list rows —
     * anything outside the built-in `_fields` set, `editUrl`
     * included.
     */
    listFields?: string[];
    /** Extra query params sent with this section's list requests. */
    listQuery?: Record< string, string >;
    /** `'large'` roughly doubles the icon well. Default `'regular'`. */
    tileSize?: 'regular' | 'large';
}
```

Groups from the server and groups derived from entity descriptors are
**merged**, not either-or: a section appended from JS with a `group` the
server doesn't know about still gets a folder, slotted by its
`groupOrder` among the server's. Server-declared groups keep the order
PHP gave them, so the
`openstation_my_wordpress_post_type_groups` filter's ordering is
preserved.

`listQuery` exists so a server-side query filter can tell a site-window
request from any other REST caller's. `rest_product_query` fires for
every consumer of that collection — the Product Collection block
included — so a filter that reorders unconditionally silently replaces
a storefront's chosen sort.

With `thumbnails` unset or `true`, a `'post'`-kind entry that has a
featured image renders it in place of the section icon — the list
request already asks for `_embed=wp:featuredmedia`, so no extra
request is made. Entries without a featured image fall back to `icon`.

The window config also ships the resolved folder list as
`groups: MyWordPressGroup[]` (`{ id, label, icon, order }`). When it is
absent the bundle derives the same list from the entity descriptors, so
a JS-only plugin can group its sections without a server round trip.

### postMessage / CustomEvents

No new postMessage types. Media drag-out uses the existing
`'shortcut'` drag payload with `data.kind === 'attachment'`.

One CustomEvent:

#### `os-my-wordpress-entity-trashed` — Experimental

Dispatched on `document` after a
`wp.os.myWordpress.trashEntity()` REST DELETE succeeds —
the recycle-bin drag-to-trash routes through it, as does any
plugin calling the method directly. Live list views (any
bundle) listen here to drop the trashed tile reactively.

**`detail` shape:**

```typescript
{ entityId: string, id: number }
```

See [Examples — WP Explorer media action](./examples/my-wordpress-media-action.md).

---

## Nonce refresh — heartbeat field *(Stable)*

WordPress nonces expire after `nonce_life` (24 h by default). The
desktop shell is a long-running SPA, so cached nonces stamped
into `window.openStationConfig.restNonce` (auto-injected by
`injectRestNonce`) and per-window config blobs like
`window.openStationWindowConfig['desktop-mode-plugins']` would
otherwise go stale after a day. The server's
`heartbeat_received` filter (see
[`openstation_nonce_refresh_actions`](./hooks-reference.md#openstation_nonce_refresh_actions--stable-filter))
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
[`openstation_nonce_refresh_actions`](./hooks-reference.md#openstation_nonce_refresh_actions--stable-filter),
then subscribe to the heartbeat field and read the action key off
the returned map:

```ts
wp.os.heartbeat.subscribe( 'desktop_mode_nonces', ( nonces ) => {
    const fresh = nonces[ 'my-plugin/admin-ajax' ];
    if ( typeof fresh === 'string' && fresh !== '' ) {
        window.myPluginConfig.ajaxNonce = fresh;
    }
} );
```

The same heartbeat surface (`wp.os.heartbeat.subscribe` /
`.contribute`) is already used for presence, recycle-bin badges,
files realtime, etc. — see the
[heartbeat bus](#heartbeat--stable) section for the full
contract.

`src/nonce-refresh.ts` ships an internal `registerNonceTarget()`
helper used by the framework's built-in updaters, but it's not
exposed across bundles — third-party plugins should use the
heartbeat subscription above.

The map also rides core's `wp_refresh_nonces` short-circuit
response — the tick that reports `nonces_expired`
(the first one after a session re-login, or after plain 24-hour
nonce expiry) already carries the replacements, so the shell heals
in a single round trip.

---

## Session expiry & recovery *(Stable)*

When the login session expires, the desktop shows **one** login
prompt: core's `wp-auth-check` modal in the parent shell. Chromeless
iframes have theirs suppressed server-side
(`openstation_chromeless_suppress_auth_check()`), so N open windows
no longer stack N identical modals.

After the user re-authenticates (in the modal, or in another tab),
the shell recovers **in place** — no full-page reload. The
`src/auth-recovery/index.ts` module forces a Heartbeat tick (which
delivers fresh nonces, see the section above), reloads each
chromeless iframe (their PHP-rendered nonce globals can't be patched
live), and announces the transition on both event surfaces:

| Surface | Loss | Recovery |
|---|---|---|
| `document` CustomEvent | `os-auth-lost` | `os-auth-restored` |
| Hook bus (`wp.os.hooks`) | `os.auth.lost` | `os.auth.restored` |

Neither event carries a payload. `os-auth-lost` fires once
per outage; pause pollers and hold off on mutations — requests made
while the session is down will 401. `os-auth-restored`
means cached nonces are valid again (refreshed on the same tick):
resume pollers and re-fetch anything that may have failed during the
outage. It can fire without a preceding `-lost` when the re-auth was
detected from an iframe or another tab before the shell's own
heartbeat noticed the expiry.

```ts
document.addEventListener( 'os-auth-restored', () => {
    // The session is back and nonces are fresh — re-sync.
    void refreshMyPluginState();
} );
```

Recovery decisions key off authoritative Heartbeat state only: the
`wp-auth-check` flag, or a `nonces_expired` response arriving during
a known outage (core only ever sends that field to an authenticated
session, so it doubles as the earliest possible re-auth signal). A
`401`/`403` response seen by `wp.os.fetch` merely *accelerates*
the next tick (debounced) — a permission `403` from a live session
(`rest_forbidden` on a route the user can't access) never triggers
any user-visible reaction.

One case still hard-reloads the shell: the re-login authenticated a
**different user** (detected via the `desktop_mode_auth` heartbeat
field, `{ uid }`). In-place recovery would leave the previous user's
desktop issuing the new user's requests, so the shell reloads and
re-renders for the new account.

---

## Desktop themes *(Experimental)*

Whole-OS reskins. See [Desktop themes](./desktop-themes.md) for the
manifest format and the full slot tables; this section is the JS
surface only.

> Distinct from the per-window **window themes**
> (`wp.os.registerWindowTheme`). A window theme restyles one
> window's chrome; a desktop theme restyles everything.

### `wp.os.desktopThemes`

```ts
wp.os.desktopThemes.list(): DesktopThemeEntry[];
wp.os.desktopThemes.getActive(): string | null;
wp.os.desktopThemes.setActive( themeId: string ): void;
wp.os.desktopThemes.subscribe(
    cb: ( state: { themes; activeId; activeIcons } ) => void,
): () => void;
wp.os.desktopThemes.resolveIcon( slot: string ): string | null;
wp.os.desktopThemes.resolveIconColor( slot: string ): string | null;
wp.os.desktopThemes.applyRecommendedOsSettings(
    themeId?: string,
): RecommendedOsSettings;
```

`DesktopThemeEntry`:

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | Manifest id (`acme/neon-glass`). |
| `slug` | `string` | Storage slug (`acme-neon-glass`). |
| `name`, `version`, `author`, `description` | `string` | May be empty. |
| `previewUrl` | `string` | Absolute URL, or `''`. |
| `cssUrl` | `string` | Compiled stylesheet URL (uploaded themes). |
| `cssText` | `string` | Compiled stylesheet text (code-registered themes). |
| `tokens` | `Record<string,string>` | Informational — the CSS is authoritative. |
| `fonts` | `string[]` | Bundled font families, de-duplicated across weights, in declaration order. Informational; the compiled stylesheet carries the `@font-face` rules. Empty when the theme ships none. |
| `icons` | `Record<string,string>` | Slot => dashicon class or absolute image URL. |
| `iconColors` | `Record<string,string>` | Slot => fill colour, for the slots the theme tints. A slot present here is painted as a tinted CSS mask (images) or with that `color` (dashicons); `currentColor` defers to the surface. Absent = default rendering. |
| `recommendedOsSettings` | `RecommendedOsSettings` | Presentation preferences the theme suggests. Always an object; `{}` means it suggests nothing. |
| `installedAt` | `number` | Unix timestamp; `0` for code themes. |
| `source` | `'upload' \| 'code'` | |

`RecommendedOsSettings` — every field optional:

| Field | Type | Values |
|---|---|---|
| `dockSize` | `string` | `compact` \| `default` \| `large` |
| `desktopLayout` | `string` | `classic` \| `unified` |
| `dockPlacement` | `string` | `bottom` \| `left` \| `right` — which edge the dock sits on (Unified) |
| `windowRadius` | `string` | `sharp` \| `default` \| `round` |
| `adminBarMode` | `string` | `static` \| `dynamic` \| `hidden` |
| `dockRailRenderer` | `string` | A registered dock rail renderer id. |

**`setActive()` is presentation only.** It swaps the stylesheet and
repaints, but does not persist — use it for a preview (a hover, a
try-before-you-buy picker) you intend to revert.

To change the user's theme for real, patch the setting. That both
persists *and* applies, so there is no need to pair it with
`setActive()`:

```js
wp.os.updateOsSettings( { desktopTheme: 'acme-neon-glass' } );
```

`resolveIcon()` returns `null` when no theme is active, when the slot
name is empty, or when the active theme doesn't override that slot —
all three mean "paint the default".

`resolveIconColor()` follows the same contract for the slot's fill.
A non-null value means the glyph is painted as a **tinted CSS mask**
rather than an image, so only its alpha is used; `currentColor` defers
to whatever the surface is already using for text. Both resolvers
short-circuit on a null check when no theme is active, so an unthemed
shell pays nothing.

Two filters sit on these:

```js
wp.hooks.addFilter(
    'os.desktop-theme.icon',
    'my-plugin',
    ( icon, { slot, themeId } ) => icon,
);
wp.hooks.addFilter(
    'os.desktop-theme.icon-color',
    'my-plugin',
    ( color, { slot, themeId } ) => color,
);
```

Returning a colour where the theme set none switches that icon to
mask rendering — a way to make any iconset monochrome without
touching the theme.

### `applyRecommendedOsSettings()`

Applies a theme's `recommendedOsSettings` and persists them. Defaults
to the active theme. Returns the keys actually written — `{}` when the
theme is unknown or recommends nothing this shell can apply (a
`dockRailRenderer` naming a renderer no plugin registered resolves to
nothing, and so does an `accent` naming a swatch the site does not
offer).

```js
const applied = wp.os.desktopThemes.applyRecommendedOsSettings();
// → { dockSize: 'large', desktopLayout: 'unified' }
```

The empty string — the **OpenStation** card, meaning "no theme" — is a
valid argument and recommends the accent the shell's own palette was
drawn against. It is the only recommendation set that lives in the
shell rather than in a manifest, because the default look has no
manifest.

**The shell already does this once**, the first time a user activates a
theme that ships recommendations; that is the entire automatic path,
and it never runs again for the same user and theme. This method is
the deliberate re-apply — the "restore the author's intended
presentation" action, which is also what the button in **OpenStation Preferences →
Themes** calls. It writes only keys that already exist on the settings
object and already hold a string, so it can never introduce a setting
or flip a feature toggle. See
[Desktop themes → Recommended OS settings](./desktop-themes.md#recommended-os-settings).

### `desktopTheme` — OS settings key

`string`. The active theme slug, or `''` for the system default.
Available on the snapshot from `wp.os.getOsSettings()` and
`subscribeOsSettings()`, and writable through
`wp.os.updateOsSettings()`. Persisted in the
`desktop_mode_os_settings` user meta; sanitized server-side as a
`sanitize_key()`-clean string (empty is a legitimate value).

### `appliedThemeRecommendations` — OS settings key

`string[]`. Slugs of the desktop themes whose
[recommended OS settings](./desktop-themes.md#recommended-os-settings)
have already been seeded for this user. A slug in this list means "we
have offered this user this theme's arrangement" — which is what stops
a theme from ever re-applying over a preference the user set
afterwards.

Slugs of themes that are no longer installed are kept on purpose: a
delete-and-reinstall must not re-seed. Capped at the most recent 64.

Readable from `wp.os.getOsSettings()` and `subscribeOsSettings()`;
the shell owns the writing. To re-apply a theme's arrangement, call
`desktopThemes.applyRecommendedOsSettings()` rather than editing the
ledger.

### CustomEvent: `os-desktop-theme-changed`

Dispatched on `document` **only when the active theme actually
changed** — a redundant re-apply (boot, an unrelated settings save)
does not fire it. Treat every firing as "repaint anything that
resolved a themed icon".

```js
document.addEventListener( 'os-desktop-theme-changed', ( e ) => {
    const { themeId, previous } = e.detail;   // string | null
    myPanel.repaintIcons();
} );
```

### Hook: `os.desktop-theme.changed` *(action)*

Same payload as the CustomEvent, on the hook bus.

```js
wp.hooks.addAction(
    'os.desktop-theme.changed',
    'my-plugin',
    ( { themeId, previous } ) => { /* … */ },
);
```

### Hook: `os.desktop-theme.icon` *(filter)*

Applied to every themed icon the active theme resolves.

```js
wp.hooks.addFilter(
    'os.desktop-theme.icon',
    'my-plugin',
    ( icon, { slot, themeId } ) => {
        if ( slot === 'APP:my-plugin' ) {
            return myBrandedIconUrl;
        }
        return icon;
    },
);
```

Only runs while a theme is **active** — with no theme the resolver
short-circuits on a null check and never reaches the filter, so
subscribers cost nothing on an unthemed shell.

### `<os-window-button icon-src>`

New observed attribute. Precedence: `icon-src` > `icon` > slotted
content. Accepts an `http(s)` or `data:image/` URL and paints it as a
`currentColor`-tinted CSS mask, which preserves the `--os-ui-btn-*`
focused/unfocused tinting contract. **Only the alpha channel is used**
— control glyphs are monochrome silhouettes by design.

---

## AI Agents — client surface *(Experimental)*

Opt-in behind the `agents` extended option; nothing below exists while
the flag is off. The PHP contract lives in
[Hooks Reference — AI Agents](./hooks-reference.md#ai-agents).

### REST client

The Agents section talks to `/desktop-mode/v1/agents` (see
`includes/rest/README.md` for the route map). The canonical agent
shape every route returns:

```ts
interface Agent {
	id: number;          // wp_users.ID
	slug: string;        // user_login minus the 'agent-' prefix
	name: string;
	description: string;
	instructions: string; // system prompt
	role: string;
	abilities: string[]; // ability slugs (allowlist)
	triggers: Array< { kind: string; config: Record< string, unknown > } >;
	model: string;
	rateLimit: number;   // invocations/hour, 0 = platform default
	avatarUrl: string;
}
```

`POST /agents/{id}/invoke` with `{ message, source?, history? }`
returns `{ text, toolCalls, turns }` where each tool call is
`{ callId, name, args, output, error }`.

`history` is the prior conversation (`[ { role: 'user'|'agent', text },
… ]`, oldest first) and is **required for multi-turn work**: each
invocation is otherwise stateless, so a follow-up ("yes, do it")
arrives with no idea which entity was being discussed. The server caps
it at the 20 most recent turns, 4000 characters each. Both in-tree
intakes (typing in the chat window, and drops) go through
`invokeAgentIntoTranscript()` in `src/agents-dispatch.ts`, which
snapshots the transcript before appending the new message.

### WP Explorer integration

The server appends an `agents` entity (`kind: 'agent'`) to the site
folder window via the `openstation_my_wordpress_entities` filter,
and ships an `agents` block on the window config:

```ts
interface AgentsSectionConfig {
	canManage: boolean;   // edit_users (filterable)
	canInvoke: boolean;   // edit_posts (filterable)
	aiAvailable: boolean; // WP 7.0 AI Client + Abilities API present
	aiStatusUrl: string;  // live provider probe (/ai/status)
	connectorsUrl: string;
	runWindowId: string;  // 'desktop-mode-agent-run'
}
```

The `agent` entity-kind renderer is registered through the standard
`registerEntityKind()` seam — plugins can override it like any other
kind.

### Chat window + shared store

The `desktop-mode-agent-run` native window is a lazy bundle
(`agent-run-window[.min].js`) that registers its render callback on
`window.openStationNativeWindows['desktop-mode-agent-run']`. Openers
seed the cross-bundle store and open the window:

```ts
// Both bundles share one live object via createSharedStore.
const store = wp.os.createSharedStore( 'desktop-mode/agents-chat', () => ( {
	activeAgent: null, // { id, name, description, avatarUrl } | null
	transcripts: {},   // Record<agentId, Array<{ role, text, toolCalls?, at, pending? }>>
} ) );
store.state.activeAgent = { id, name, description, avatarUrl };
store.notify();
wp.os.openWindow( 'desktop-mode-agent-run', { source: 'my-plugin' } );
```

Transcripts are session-only; nothing persists client-side.

### Drag & drop intake

Agents accept entity drops (`post`, `page`, `media`, `user`,
`comment`) on three surfaces, all dispatching through the shared
`src/agents-dispatch.ts` engine (compose message → seed the chat
store → open the chat window → `POST /invoke` with `source: 'drag'`):

- **Agent rows** in WP Explorer's Agents section — drop targets
  registered per row via `wp.os.dragManager`.
- **Agent user tiles on the wallpaper** — opted in through the files
  layer's tile-payload-handler seam. Gating is payload-driven: the
  server inlines `isAgent: true` and `agentDragKinds` into the
  desktop user-file payload (`agentDragKinds` mirrors the drag
  trigger's `entityKinds`; `null` = no drag trigger, drops rejected;
  `[]` = accepts every kind).
- **The open Agent chat window** — accepts drops for the active agent
  without drag-trigger gating (dropping into an open conversation is
  explicit intent, like typing).

Double-clicking an agent's user tile on the desktop opens the Agent
chat window (the built-in `agent-chat` opener, gated by a per-file
`appliesTo` predicate on `file.shape.isAgent`) instead of the user
profile; human user tiles are unaffected. The user-file payload
carries `agentDescription` so the chat header can show the agent's
"when to use" line without a REST roundtrip.

Accepted drag payload types are the in-tree entity carriers:
`'shortcut'` (WP Explorer tiles, `os-tile` drag-out; `attachment`
maps to `media`, pages are detected via `bridgePayload.postType`) and
`'desktop-file'` (wallpaper tiles, via `placement.file`).

---

## `wp.os.registerWindowAction()` — *Experimental*

Adds a row to the ⋯ actions menu in **every** window's title bar — the
right surface for an infrequent, wordy, per-window verb that has not
earned a permanent title-bar button. (For something the user reaches
for constantly, use
[`registerTitleBarButton`](#wposregistertitlebarbutton--stable)
instead.)

```js
wp.os.registerWindowAction( {
    id: 'my-plugin/pin',
    label: ( win ) => ( isPinned( win.id ) ? 'Unpin' : 'Pin to top' ),
    icon: 'dashicons-sticky',
    order: 60,
    isVisible: ( win ) => ! win.config.native,
    onSelect: ( win ) => togglePin( win.id ),
    owner: 'my-plugin-shell',
} );
```

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | Required. `/^[a-z0-9_/-]+$/`; `vendor/sub-id` namespacing encouraged. |
| `label` | `string \| ( win ) => string` | Required. A function is re-read on **every menu open**. |
| `icon` | `string \| ( win ) => string` | Dashicons class. Optional; also re-read per open. |
| `order` | `number` | Sort order among registered rows. Default `100`. |
| `isVisible` | `( win ) => boolean` | Optional. Re-read per open; omit to show everywhere. |
| `onSelect` | `( win ) => void` | Required. The menu is closed before it is called. |
| `owner` | `string` | Script handle, for live unregistration on deactivation. See below. |

Also: `wp.os.unregisterWindowAction( id )` and
`wp.os.listWindowActions()`.

**Making `owner` mean something.** Pair it with the PHP opt-in
[`openstation_register_window_action_script( 'my-plugin-shell' )`](./hooks-reference.md#openstation_register_window_action_script-handle--experimental-php-function)
and pass the same handle. That puts your script in the live-refresh
payload, so activating your plugin loads it — the row is in the next ⋯
menu that opens, no reload — and deactivating it sweeps every action
tagged with that handle back out.

Without the PHP call there is nothing to diff, so an `owner` tag is
inert: the row stays until the next page reload. That is deliberate
backwards-compat, the same bargain commands and title-bar buttons
offer, but it does mean `owner` alone is not the whole opt-in.

**Why `label` / `icon` / `isVisible` may be functions.** They are read
fresh every time the menu opens, not once at registration. That is what
lets one row express a toggle whose meaning depends on state — "Send to
your Mac" becoming "Bring back into OpenStation" for the same window —
without the plugin re-registering itself on every transition. A window
is in one place or the other, so one row that answers "what does this
do right now?" is the honest shape; two competing rows would
misdescribe it.

A row whose resolver or handler throws is contained: the row hides (or
the click is swallowed) and the rest of the menu keeps working. The ⋯
menu is shared surface, and the user's "Reload" lives there.

Registering or unregistering repaints menus on their next open;
`registerWindowAction` throws a `RegistrationError` naming the bad
field when validation fails.

### `HOOKS.WINDOW_MENU_OPENED` — *Experimental*

Fires when a window's ⋯ actions menu opens, **after** its rows have
been painted. Payload: `{ windowId: string, element: HTMLElement }`,
where `element` is the `<os-menu>` panel.

The moment to do work a menu's contents depend on but that is too
expensive, or too perishable, to do up front — probing the network,
re-reading a permission, checking whether a companion app has started
since the page loaded.

**An open menu repaints itself when the registry changes.** So
registering an action from this hook — even asynchronously — puts the
row under the user's pointer rather than on their next click:

```js
wp.os.hooks.addAction( wp.os.HOOKS.WINDOW_MENU_OPENED, 'my-plugin/probe', () => {
    void probeForCompanionApp().then( ( found ) => {
        if ( found ) {
            wp.os.registerWindowAction( { /* … */ } );
        }
    } );
} );
```

That is why it fires after the paint rather than before. The
subscription lives only while the menu is open.

---

## Native desktop host — `wp.os.electron` *(Experimental)*

Published by the **Electron Adapter extension**, not by core, when the
desktop is being viewed through the OpenStation Desktop app. Absent in
a browser, so check before use:

```js
if ( wp.os.electron?.isAvailable() ) {
    console.log( wp.os.electron.getSendLabel() ); // "Send to your Mac"
    await wp.os.electron.free( 'edit-php' );
}
```

Full narrative, the REST surface, and the adapter's PHP hooks:
[Native Desktop Host](./desktop-host.md).

| Method | Returns | Notes |
|---|---|---|
| `isAvailable()` | `boolean` | Always true when the namespace exists. |
| `getInfo()` | `HostInfo \| null` | Platform, app version, host id, currently-freed ids. |
| `getSendLabel()` | `string` | Translated and OS-adapted. |
| `getDockLabel()` | `string` | "Bring back into OpenStation". |
| `isFreedWindow()` | `boolean` | Whether *this page* is itself a freed window. |
| `free( windowId )` | `Promise<boolean>` | Set a window free; focuses it if already free. |
| `dock( windowId )` | `Promise<boolean>` | Bring a freed window back into the shell. |
| `listFreed()` | `string[]` | Ids currently out on the desktop. |
| `isFreed( windowId )` | `boolean` | Whether one specific window is out there. |
| `getConnection()` | `ConnectionState` | Last liveness-pulse snapshot. |

Anything that would surface a freed window inside the shell — a dock
click, the switcher, a plugin calling `openWindow()` — raises the
**native** window instead. Plugin authors get that for free.

### CustomEvents

| Event | `detail` | Fires when |
|---|---|---|
| `os-desktop-host-freed` | `{ windowId: string }` | A window went out to the real desktop. |
| `os-desktop-host-docked` | `{ windowId: string }` | A freed window came back into the shell. |
| `os-desktop-host-connection` | `ConnectionState` | The connection changed phase. |

### Shell config key

| Key | Type | Notes |
|---|---|---|
| `soloWindow` | `string` | Window id when the shell was asked to paint exactly one window (`?openstation_solo=<id>`); `''` otherwise. No dock, taskbar, wallpaper, desk or admin bar, and no session restore. Generic — an embed or a kiosk can use it too. |

### `window.openStationChromelessHost` — *Experimental*

Set this to `true` **before a page's own scripts run** to claim a
top-level chromeless page as deliberately hosted. Without it, the
chromeless bridge treats a top-level `?openstation_chromeless=1` page
as an accident and rescues the user by stripping the flag and reloading
as classic admin — correct for a stale bookmark, wrong for an embedder
that put the page there on purpose and provides its own way out.

It must be a global rather than a query flag: a flag is lost on the
first in-page navigation. See
[bridge-protocol.md](./bridge-protocol.md#top-frame-escape-hatch--and-how-to-opt-out).

---

## See also

- [Native Desktop Host](./desktop-host.md) — the Electron layer, solo mode, and the liveness pulse.
- [Hooks Reference](./hooks-reference.md) — the PHP side of the API.
- [Examples — React to window events](./examples/react-to-window-events.md)
- [Examples — Add a dock badge](./examples/dock-badge.md)
- [Examples — Register a wallpaper](./examples/register-wallpaper.md)
- [Examples — Cross-window devtools](./examples/devtools-instrumentation.md)
- [Examples — Pulse a window's icon](./examples/window-request-attention.md)
- [Examples — Window themes](./examples/window-theme.md)
- [Desktop themes](./desktop-themes.md) — whole-OS reskins
- [Examples — Register a desktop theme](./examples/register-desktop-theme.md)
- [Examples — Window controls](./examples/window-controls.md)
- [Examples — Window slots](./examples/window-slot.md)
- [Examples — Custom window chrome (Experimental)](./examples/custom-chrome.md)
