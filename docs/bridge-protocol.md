# Bridge protocol — wiring overview

A single page that maps every layer of the cross-window connection bridge end-to-end. You shouldn't need this to build a plugin — the public APIs in [`javascript-reference.md`](./javascript-reference.md) are sufficient. Read this when you're debugging a stuck handshake, building unusual integrations (cross-origin frames, custom transports), or contributing to the shell itself.

## The pieces

```
                        PARENT SHELL                              IFRAME
                        (one per browser tab)                     (one per window)
                        ────────────────                          ────────────
   Plugin code
       │
       │  wp.desktop.connect( id, opts )
       ▼
  ┌─────────────────────────────┐                            ┌──────────────────────┐
  │  src/connection/index.ts    │                            │  iframe-bridge.js    │
  │  ────────────────           │ ── handshake ──────────▶   │  (or inline bridge   │
  │  • createConnectionBridge   │ ◀── handshake-ack ──       │   from includes/     │
  │  • _connections (Map)       │                            │   render/chromeless- │
  │  • _connectionsByTarget     │ ── publish ───────────▶    │   bridge.php)        │
  │  • _syntheticIframes        │ ◀── publish ────────       │  • wp.desktop.iframe │
  │  • routeIncomingFromIframe  │ ── disconnect ────────▶    │     .publish         │
  │  • handleConnectionRequest  │ ◀── disconnect ─────       │     .subscribe       │
  └────────────┬────────────────┘                            │     .onConnection    │
               │                                             │     .requestConnection│
               │ window.__desktopModeConnectionBridge          │                      │
               │ (side-channel install)                      │                      │
               ▼                                             │                      │
  ┌─────────────────────────────┐                            │                      │
  │ src/window/iframe-bridge.ts │                            │                      │
  │ handleWindowMessage         │ ◀── postMessage events ──  │                      │
  │ (per-Window listener)       │                            │                      │
  └────────────┬────────────────┘                            │                      │
               │                                             │                      │
               │ — OR for native windows with `iframeContent`:                       │
               │                                             │                      │
  ┌────────────▼────────────────┐                            │                      │
  │  src/native-windows.ts      │                            │                      │
  │  buildIframeContentRender   │ ◀── postMessage events ──  └──────────────────────┘
  │  (synthesised iframe holder)│
  │   • registerSyntheticIframe │
  │   • forwards bridge-* msgs  │
  │   • shell-managed lifecycle │
  └─────────────────────────────┘
```

## Message types

Two protocol families flow over the same `postMessage` boundary:

- **Window-self channel** (`desktop-mode-window-*`) — the unified [`Window.send/on`](./javascript-reference.md#windowsend-channel-payload---stable-since-055) API. The first thing most plugin code reaches for. Single channel, no handshake, scoped to one window's content.
- **Connection bridge** (`desktop-mode-bridge-*`) — multi-connection peer-to-peer with handshakes, used by `wp.desktop.connect()` / `wp.desktop.iframe.requestConnection()`.

Both sides validate `event.origin` against `window.location.origin` (or the iframe URL's resolved origin for `iframeContent` synthesised iframes); messages without a recognized prefix are dropped.

### Window-self channel — `desktop-mode-window-*`

| Type | Direction | Carries | Purpose |
|---|---|---|---|
| `desktop-mode-window-send` | parent → iframe | `{ channel, payload }` | Posted by `Window.send( channel, payload )`. The iframe-side bridge fires every `wp.desktop.on( channel, cb )` subscriber. |
| `desktop-mode-window-publish` | iframe → parent | `{ channel, payload }` | Posted by `wp.desktop.send( channel, payload )` inside the iframe. The parent forwards to every `Window.on( channel, cb )` subscriber for this window. |

Native (non-iframe) windows skip postMessage entirely — `Window.send` and the render's `windowApi.send` reach the parent / native channel-bus registries directly. Plugin authors don't need to know the window's render strategy; the framework picks the right delivery path.

### Content-identity announcement — `desktop-mode-content-identity` *(since 0.9.4)*

| Type | Direction | Carries | Purpose |
|---|---|---|---|
| `desktop-mode-content-identity` | iframe → parent | `{ identity: WindowContentRef \| null }` | Which object this admin page shows — `{ type, id, label?, root?, links? }`, resolved server-side in real admin context (post/page/CPT editors are roots and carry their content's internal hyperlinks as `links`; comment-edit and attached-media screens arrive pre-rooted at their parent post; the `desktop_mode_window_content_identity` PHP filter extends detection). Feeds `wp.desktop.relations` and the window-link visuals. |

Emitted on **every** chromeless page load, **including `identity: null`** — a full-page navigation away from an identified screen must clear the stale identity, and since every iframe navigation re-runs `admin_footer`, that same emission doubles as the re-announce-on-navigate path. It fires at the very TOP of the bridge script (right after the top-frame escape hatch, before any feature block) so a page-specific runtime failure elsewhere in the bridge can never cost the shell its window relations — unlike `desktop-mode-ready`, which intentionally posts last. See [`docs/examples/window-links.md`](./examples/window-links.md).

### Connection bridge — `desktop-mode-bridge-*`

| Type | Direction | Carries | Purpose |
|---|---|---|---|
| `desktop-mode-bridge-handshake` | parent → iframe | `{ connectionId, targetWindowId, topics }` | Open a new connection. Iframe must ack before parent flushes its message queue. The `targetWindowId` (since 0.8.8) is the host window's id — the iframe stores it for `wp.desktop.iframe.windowId` / `whenWindowId()`. |
| `desktop-mode-bridge-handshake-ack` | iframe → parent | `{ connectionId }` | Iframe acknowledges. Parent fires `HOOKS.CONNECTION_OPENED` + flushes. |
| `desktop-mode-bridge-publish` | both ways | `{ connectionId, topic, payload }` | Pub/sub message. Wildcard subscribers (`'*'`) see every topic. |
| `desktop-mode-bridge-disconnect` | both ways | `{ connectionId }` | Tear the connection down. Idempotent. |
| `desktop-mode-bridge-connection-request` | iframe → parent | `{ requestId, topics }` | `wp.desktop.iframe.requestConnection()`. Parent fires `HOOKS.IFRAME_CONNECTION_REQUEST` filter; default accept. |
| `desktop-mode-bridge-connection-ack` | parent → iframe | `{ requestId, accepted, connectionId? \| reason? }` | Reply to a request — accepts hand back the new connection id, rejects supply a reason. |

When the connection bridge targets a **native** window (since 0.5.5), no postMessages are exchanged — `connect()` opens synchronously and `conn.send/subscribe` route through the same in-process channel bus that powers `Window.send/on`. Same `onOpen` / `isOpen` / `disconnect` semantics, no observable difference to the caller.

### OS-file drop forwarder — `desktop-mode-os-file-drop`

When the user drags a file from the host operating system onto a chromeless admin iframe, the chromeless bridge (and the standalone iframe bridge) intercepts the `drop` event before the browser's default handler navigates the iframe, and forwards the raw `File[]` to the parent shell.

| Type | Direction | Carries | Purpose |
|---|---|---|---|
| `desktop-mode-os-file-drop` | iframe → parent | `{ files: File[], x: number, y: number }` | Native-OS file drop captured inside the iframe. Same-origin only — `postMessage` preserves `File` identity. The parent's `OsFileDropManager` resolves the source iframe's `data-window-id` via `MessageEvent.source` and routes the files through the drop pipeline. |

The forwarder listens in **bubble phase** at the iframe's `document`, so any in-page drop receiver runs first and gets the chance to claim the drop. Two bail conditions, in order:

1. **Curated allowlist** — `.components-drop-zone`, `[data-drop-zone]`, `.uploader-window`, `.media-frame-content` always yield, so Gutenberg's media uploader and the legacy media library keep working as before even on edge cases that skip the spec dance.
2. **`event.defaultPrevented === true`** — any inner handler that called `preventDefault()` on `dragover` or `drop` is signalling ownership per the HTML5 drag-and-drop contract. The forwarder yields. Third-party plugin drop zones (e.g. "Administrador de archivos WP") that already work in classic admin keep working untouched inside desktop-mode iframes — no opt-in required.

Only drops where neither bail fires (the empty page background, or an inner handler that never called `preventDefault()`) escalate to the shell.

### Pre-close unsaved-changes query — `desktop-mode-bridge-beforeunload-*`

*(since 0.9.4)* Before tearing down an iframe-backed (non-native) window, `Window.close()` gives the page inside a chance to veto — the same protection a real browser tab close gets from the page's `beforeunload` handler, which a same-origin admin iframe never triggers on its own (there's no real navigation happening).

| Type | Direction | Carries | Purpose |
|---|---|---|---|
| `desktop-mode-bridge-beforeunload-query` | parent → iframe | *(none)* | Sent once `close()` is called on a window whose bridge has announced readiness (`desktop-mode-ready` already fired). |
| `desktop-mode-bridge-beforeunload-response` | iframe → parent | `{ prevent: boolean, message?: string }` | Reply. `prevent: true` means the iframe's own `beforeunload` handling (`window.onbeforeunload` or an `addEventListener('beforeunload', …)` listener) set a message or called `preventDefault()`. |

Flow:

1. `close()` checks `win._iframeBridgeReady` — a window whose iframe never announced readiness (still loading, or a non-desktop-mode page) skips the query entirely and destroys immediately, same as before this feature existed.
2. Otherwise it posts the query, sets `win._closePending = true`, and returns **without** destroying — a 500ms safety timer (`win._iframeCloseTimeout`) forces the close through if no response arrives (a hung or unresponsive iframe can't block closing forever).
3. Both bridge implementations (the inline PHP script in `includes/render/chromeless-bridge.php` and the standalone `src/iframe-bridge-standalone.ts`) answer the query the same way: synthesize a `beforeunload` `Event`, invoke `window.onbeforeunload` with it if set, then (if not already prevented) dispatch a real `beforeunload` event so `addEventListener('beforeunload', …)` listeners run too. Whichever mechanism sets `event.returnValue` or calls `preventDefault()` flips `prevent: true`, carrying the handler's message string through if one was set.
4. On the parent side, `prevent: false` destroys the window immediately. `prevent: true` shows a `<wpd-confirm-dialog>` (title = the iframe's message, or a generic fallback) — the window is only destroyed if the user confirms.

Native windows are untouched — they still use the synchronous `desktop-mode.native-window.before-close` filter (see [`javascript-reference.md`](./javascript-reference.md#native-window-lifecycle)), not this postMessage round-trip.

## Lifecycle walkthrough — parent-initiated connection

1. **Plugin calls** `wp.desktop.connect( 'edit-post', { topics: [ 'gutenberg:content' ] } )`.
2. Connection bridge mints a `connectionId` (`desktop-mode-conn-N`), stores the connection in `_connections`, indexes it by target window in `_connectionsByTarget`.
3. Bridge looks up the iframe via `_syntheticIframes.get( id ) ?? manager.getById( id )?.iframe`.
4. Bridge `postMessage`s `desktop-mode-bridge-handshake` to the iframe's `contentWindow` with `targetOrigin = INITIAL_ORIGIN`.
5. Plugin code calls `conn.send( 'foo', payload )` before the ack arrives — message goes into the connection's `queue`, no `postMessage` yet.
6. Iframe's bridge handler receives the handshake, stores the connection in its own `connections` map, posts `desktop-mode-bridge-handshake-ack` back.
7. Parent's `routeIncomingFromIframe` receives the ack, dispatches to the connection's `_handleIframeMessage`, which:
   - Sets `isOpen = true`.
   - Fires `HOOKS.CONNECTION_OPENED` with `{ connectionId, targetWindowId, topics, connection }`. The `connection` field (since 0.8.8) is the live `WindowConnection` — plug in `.subscribe()` directly from the hook handler without an extra `wp.desktop.getConnection(id)` round-trip.
   - Calls `opts.onOpen?.()`.
   - Drains the queue with `flushQueue()` — every queued message becomes a real `postMessage`.
8. Iframe receives the publishes, looks up subscribers in `subs`, calls each in turn.

## Lifecycle walkthrough — iframe-initiated connection (`requestConnection`)

1. Iframe-side calls `wp.desktop.iframe.requestConnection({ topics: [ 'wpglp:content' ] })`.
2. Iframe bridge mints a `requestId`, registers a one-shot ack listener with a 5-second timeout, posts `desktop-mode-bridge-connection-request` to the parent.
3. Parent's `handleWindowMessage` (or the `iframeContent` synthesised render's listener) sees the bridge-prefixed message, calls `routeIncomingFromIframe( data, win.id )`.
4. `routeIncomingFromIframe` recognises `connection-request` and calls `handleConnectionRequest( windowId, requestId, topics )`.
5. The shell runs `applyFilters( HOOKS.IFRAME_CONNECTION_REQUEST, true, { windowId, requestId, topics } )`. Default value is `true` (accept). Plugin code can return `false` to reject, or `{ topics: [ ... ] }` to accept while narrowing.
6. On accept, `connect( windowId, { topics: finalTopics } )` opens a parent-side connection. The parent then posts `desktop-mode-bridge-connection-ack { requestId, accepted: true, connectionId }` back.
7. Iframe's ack listener resolves the original `requestConnection()` promise with `{ id, topics }` and calls `opts.onOpen?.()`.
8. The handshake completes normally between this new connection and the iframe (the iframe's existing `desktop-mode-bridge-handshake` listener picks it up and acks).

## How the synthesised iframe inside a native window joins the bridge

A native window registered via `wp.desktop.registerWindow({ iframeContent })` is special: `Window.iframe` is `null` (only chromeless wp-admin pages set that), but the body contains a real `<iframe>` the shell created.

`buildIframeContentRender`:

1. Creates the `<iframe>`.
2. Calls `registerSyntheticIframe( windowId, iframe )` — adds an entry to `_syntheticIframes` so the connection bridge's iframe lookup finds it.
3. Installs a `message` listener that:
   - Validates `event.source === iframe.contentWindow` and `event.origin` matches the iframe URL's origin.
   - Forwards bridge-prefixed messages (`desktop-mode-bridge-*`) to `routeIncomingFromIframe( data, windowId )` so the iframe can participate in `connect()` traffic.
   - Forwards every message (bridge or not) to `cfg.onMessage?.()` so plugins that want raw access still get it.
4. On window close, the cleanup chain (passed through `onClose`) calls `unregisterSynth()` so closed windows don't leak.

## Admin link routing inside chromeless iframes

The chromeless bridge intercepts every same-origin `<a href="/wp-admin/…">` click inside an iframe and lets the parent shell decide where the navigation should actually land. The decision lives in the parent because the iframe doesn't know the shell's window slug rules (which query params are identity-bearing, which URLs are remapped to a native window, which already-open window owns the destination, and so on).

| Type | Direction | Carries | Purpose |
|---|---|---|---|
| `desktop-mode-iframe-admin-link` | iframe → parent | `{ url, label }` | Posted from the chromeless bridge's link interceptor for every admin-internal click that survived the modifier-key / target / download filters. `label` is the clicked link's visible text (falling back to its `title` / `aria-label`, truncated to 80 chars). The bridge `preventDefault`s the click first; the parent owns the navigation. |

Parent dispatch (in `src/window/iframe-bridge.ts`, wired by `bindAdminLinkDispatch` in `desktop.ts`):

1. **Native-window remap** — the URL goes through `tryNativeUrlRemap`. On a hit the parent opens the native window and closes the source iframe so the brief in-flight nav never paints.
2. **Same-slug click** — `deriveWindowId(url, adminUrl)` matches the source window's `baseId`. The parent calls `iframe.contentWindow.location.assign(url)`, which navigates the iframe in place AND adds a session-history entry. Pagination, list filtering, and per-window tab strips ride this path.
3. **Cross-slug click** — slug differs from the source. The parent calls `windowManager.open({ id, baseId, url, title, icon })` with title/icon copied from the matching dock entry. When no dock tile owns the destination, the title falls back to the `label` from the message (the clicked link's visible text), then to the derived slug as a last resort. The source iframe is left untouched, so the user keeps both contexts. When a window for the destination slug is *already open*, `open()`'s URL-aware reuse *(since 0.9.4)* applies: if the clicked URL isn't what that window is showing (nor its home / dock landing URL), the existing window's iframe navigates to it in place — so an action URL like the post-install `plugins.php?action=activate&plugin=…&_wpnonce=…` link actually runs instead of being dropped by a bare focus.

Modifier-key clicks (cmd / ctrl / shift / alt, middle-click, `target="_blank"`, `target` other than `_self`, `download` attribute) short-circuit the bridge's interceptor entirely — the browser's native open-in-new-tab path runs unchanged.

Forms submit through a separate `submit` listener that only rewrites the action URL (to keep `desktop_mode_chromeless=1`) and never `preventDefault`s. Same-origin form posts to a different page would currently navigate the iframe in place; if that becomes a UX problem it can join this protocol as a `desktop-mode-iframe-admin-form-submit` message.

## Activity-footprint launcher inside chromeless iframes — Stable *(since 0.9.1)*

The classic Users list table (`users.php`, rendered as a chromeless iframe) grows a **"View activity footprint"** row action — added server-side by `desktop_mode_user_footprint_row_action` (see [`hooks-reference.md`](hooks-reference.md)). Clicking it opens the target user's GitHub-style activity footprint inside the **My WordPress** native window, *without* closing the Users list.

This deliberately does NOT reuse the admin-link path above: that path closes the source iframe on a native-window remap hit (it models a navigation *away*). A row action is an auxiliary *peek*, so it gets its own message.

**Carrier contract.** The row-action link declares the target on the anchor itself:

| Attribute | Value |
|---|---|
| `data-desktop-mode-footprint` | Target user id (positive integer). **Required** — its presence is what the bridge sniffs. |
| `data-desktop-mode-footprint-name` | Display name, used to seed the footprint breadcrumb before the REST payload resolves. Optional. |
| `href` | A real `user-edit.php?user_id=N` / `profile.php` URL — the graceful fallback followed only when JS is off or on a modifier / middle click. |

| Type | Direction | Carries | Purpose |
|---|---|---|---|
| `desktop-mode-open-user-footprint` | iframe → parent | `{ userId: number, userName: string }` | Posted from the chromeless bridge when a `[data-desktop-mode-footprint]` link is clicked (checked *before* the admin-link classifier, so the fallback `href` is never followed inside the shell). The parent opens / focuses the My WordPress window on that user's footprint route and leaves the source window open. |

**Parent dispatch** (`src/window/iframe-bridge.ts`): calls `openUserFootprintWindow( { userId, userName } )` (`src/my-wordpress/footprint-target.ts`), which stashes the target in the `desktop-mode/my-wordpress/footprint-target` shared store, then opens the window via `wp.desktop.openWindow`. Cold-start safe: the My WordPress bundle reads the target on mount and subscribes for re-targets while it's already open. See [`javascript-reference.md`](javascript-reference.md) for the public `wp.desktop.myWordpress.openUserFootprint`.

## Public hooks

| Hook | Kind | Status | Payload |
|---|---|---|---|
| `desktop-mode.connection.opened` | action | Experimental | `{ connectionId, targetWindowId, topics, connection? }` — `connection` (the live `WindowConnection`) is present for iframe-target opens; native-target opens currently omit it |
| `desktop-mode.connection.closed` | action | Experimental | `{ connectionId, reason: 'disconnect' \| 'window-closed' \| 'navigated' }` — `'navigated'` is reserved in the type union; no code path emits it yet, so today only the first two are observed |
| `desktop-mode.connection.message` | action | Experimental | `{ connectionId, topic, direction: 'in' \| 'out' }` — high-volume, keep subscribers cheap |
| `desktop-mode.iframe.connection-request` | filter | Experimental | `boolean \| { topics: string[] } ← (accept, ctx)` — return `false` to reject, an object to accept-with-narrowing |

## Internal sniff points

When something's not working:

- **`window.__desktopModeConnectionBridge`** — installed by `desktop.ts` on init. If it's `undefined` in DevTools, the shell hasn't booted yet (or you're in a frame that's not the parent shell).
- **`window.wp.desktop.iframe`** — the iframe-side API. If it's `undefined` inside an iframe, the bridge script wasn't loaded — for chromeless wp-admin pages it's inline; for `iframeContent: { bridge: true }` it's auto-injected after load; for any other same-origin iframe enqueue `desktop-mode-iframe-bridge`.
- **`window.location.origin`** check — every postMessage in both directions filters on this. A common cause of "messages don't arrive" is a shell mounted on `https://example.test` and an iframe loaded from `http://example.test` (different origin); same domain ≠ same origin.
- **`event.source === iframe.contentWindow`** check — even same-origin, a foreign caller posting `desktop-mode-bridge-*` messages from somewhere ELSE in the parent will be silently dropped.

## Cross-origin iframes — explicit non-goal

**Every bridge listener in this repo validates `event.origin`**, and three of the four are strictly same-origin:

- `src/iframe-bridge-standalone.ts` — `parentOrigin = window.location.origin`.
- `src/connection/index.ts` — `INITIAL_ORIGIN = window.location.origin`.
- `src/drag-bridge.ts` — `this._origin = window.location.origin`.

The fourth listener — `src/native-windows.ts`'s `iframeContent` message handler — validates against the iframe URL's *resolved* origin (falling back to the shell origin for relative / invalid URLs) and forwards `desktop-mode-bridge-*` messages into the connection registry. A native window configured with a cross-origin `iframeContent.url` therefore grants that foreign origin bridge access for that window: only point `iframeContent.url` at origins you trust.

Each postMessage's `targetOrigin` is set to its own captured origin, and each `'message'` listener rejects events whose `e.origin` doesn't match. Cross-origin parents silently drop every bridge message — no warn, no fallback. This is **deliberate**: the bridge payloads feed into drop handlers that insert HTML and into hook subscribers that may execute code, so widening the trust boundary would create a clear XSS surface.

Concretely, the bridge will not operate in these contexts:

- **Cross-origin parent** — desktop-mode loaded in an `<iframe>` whose parent is on a different origin (top-level admin opened outside the shell, or shell embedded in a foreign host).
- **Foreign-origin Gutenberg `srcdoc` canvas** — by default the editor-canvas iframe inherits the parent's origin (works fine), but some plugin / theme combos override `src` to a foreign URL.
- **Sandboxed iframes** (`<iframe sandbox>` without `allow-same-origin`) — the iframe's origin is `"null"`, which never matches.
- **PWA wrappers** loading desktop-mode in a foreign service-worker scope.

### Detecting it from inside an iframe

`wp.desktop.iframe.isParentReachable()` returns `true` when the parent is same-origin and addressable, `false` otherwise:

```javascript
if ( ! wp.desktop.iframe.isParentReachable() ) {
    // No bridge — fall back to in-iframe UI, skip the feature,
    // or surface a "this view requires desktop mode" notice.
    return;
}
// Bridge is live; publish away.
wp.desktop.iframe.publish( 'editor:content', html );
```

The predicate accesses `window.parent.location.origin` inside a try/catch — cross-origin parents throw on the access. Cheap, no postMessage round-trip. Use it before wiring expensive subscriptions or showing UI that promises cross-window behavior.

## Cross-window drag bridge — Stable *(since 0.6.0)*

A separate channel from the connection bridge. Where the connection bridge carries app-level pub/sub between a window and its iframe, the **drag bridge** carries an in-flight drag payload between the parent shell and ALL same-origin iframes — receivers don't need to be "connected" to receive it.

### When it fires

The drag bridge stores a single `DragBridgePayload` at any given time. Two ways the payload gets in:

- **Shell-side drag source** — a DragManager `'shortcut'` or `'desktop-file'` session whose payload carries `data.bridgePayload` starts (a shell-rendered tile from My WordPress media / post / user, or an existing wallpaper placement dragged off the desktop). The shell's `DRAG_EVENTS.START` listener (`src/desktop.ts`) reads `payload.data.bridgePayload` and calls `dragBridge.start(payload)`. Cleared on `DRAG_EVENTS.END`.
- **Iframe-side drag source** — an iframe postMessages `{ type: 'desktop-mode-drag-start', payload }` to the parent. The bridge stores the payload and broadcasts `DRAG_BRIDGE_EVENTS.START` as a `CustomEvent` on `document` so other shell modules can react.

### Receiver protocol

Drop-receiver iframes have two ways to consume the payload:

1. **Push** — `src/drag/iframe-drop-targets.ts` suppresses `pointer-events` on every iframe window for the drag's duration and registers each window body as a drop target. When the pointer is over an iframe window and the gesture is a `'shortcut'` or `'desktop-file'` drag carrying a `bridgePayload`, the shell postMessages:

   | Message | Direction | Payload |
   |---|---|---|
   | `desktop-mode-drag-over` | parent → iframe | `{ type, payload: DragBridgePayload }` |
   | `desktop-mode-drag-leave` | parent → iframe | `{ type }` |
   | `desktop-mode-drop` | parent → iframe | `{ type, payload: DragBridgePayload, position: { x, y } }` |

   Receivers listen on `window.message`, check `event.origin === window.location.origin`, and switch on `data.payload.kind`. The built-in Gutenberg receiver (`src/gutenberg-drop-receiver.ts`) is the canonical example.

2. **Pull** — any iframe can postMessage `{ type: 'desktop-mode-drag-payload-request' }` and the parent replies (directly to `event.source`) with `{ type: 'desktop-mode-drag-payload', payload }`. Useful for iframes that bind their own native `drop` handler and need the rich payload after the browser has stripped the custom MIME from DataTransfer.

### Payload union

```ts
type DragBridgePayload =
  | { kind: 'attachment'; id: number; url: string; title: string;
      alt: string; mime: string; thumbnailUrl?: string;
      sizes?: Record<string, unknown> }
  | { kind: 'post'; id: number; postType: string; url: string;
      title: string }
  | { kind: 'user'; id: number; url: string; title: string };
```

### Sniff points

- **`document.body[data-desktop-mode-dragging]`** — set by the DragManager while ANY drag is in flight. Pair with `[data-desktop-mode-drag-type="shortcut"]` to gate drag-state CSS in the shell.
- **`window.wp.desktop.dragBridge.getPayload()`** — read the current cross-frame payload from anywhere in the parent shell.
- **`desktop-mode-cross-frame-drag-start` / `-end` CustomEvents** — dispatched on `document` each time the bridge transitions. Plugins layer drop-zone highlights on these without polling.

## Don't reinvent the wiring

If you find yourself writing `window.parent.postMessage` or hand-rolling a handshake, check first:

- For shell-registered iframe windows (chromeless wp-admin) → use `wp.desktop.connect()` + `wp.desktop.iframe.publish/subscribe`.
- For your own iframe pages → enqueue `desktop-mode-iframe-bridge` OR set `iframeContent: { bridge: true }` on a native window.
- For iframe-initiated requests → `wp.desktop.iframe.requestConnection()`.
- For source-validation + load-vs-listener-race → `wp.desktop.registerWindow({ iframeContent: { bridge: true, onMessage } })` — `onMessage` is pre-validated against the iframe's `contentWindow`, and readiness needs no callback: `Window.send` payloads queue and flush automatically once the iframe loads (`HOOKS.IFRAME_READY` fires for observers).

The whole "shell.js coordinator" pattern is gone if you reach for these. The plugin's parent-shell footprint goes from ~150 lines of postMessage plumbing to a ~5-line config object.
