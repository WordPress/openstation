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
  │  ────────────────           │ ── handshake ──────────▶   │  (or chromeless      │
  │  • createConnectionBridge   │ ◀── handshake-ack ──       │   inline equivalent  │
  │  • _connections (Map)       │                            │   in render.php)     │
  │  • _connectionsByTarget     │ ── publish ───────────▶    │                      │
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

### Connection bridge — `desktop-mode-bridge-*`

| Type | Direction | Carries | Purpose |
|---|---|---|---|
| `desktop-mode-bridge-handshake` | parent → iframe | `{ connectionId, topics }` | Open a new connection. Iframe must ack before parent flushes its message queue. |
| `desktop-mode-bridge-handshake-ack` | iframe → parent | `{ connectionId }` | Iframe acknowledges. Parent fires `HOOKS.CONNECTION_OPENED` + flushes. |
| `desktop-mode-bridge-publish` | both ways | `{ connectionId, topic, payload }` | Pub/sub message. Wildcard subscribers (`'*'`) see every topic. |
| `desktop-mode-bridge-disconnect` | both ways | `{ connectionId }` | Tear the connection down. Idempotent. |
| `desktop-mode-bridge-connection-request` | iframe → parent | `{ requestId, topics }` | `wp.desktop.iframe.requestConnection()`. Parent fires `HOOKS.IFRAME_CONNECTION_REQUEST` filter; default accept. |
| `desktop-mode-bridge-connection-ack` | parent → iframe | `{ requestId, accepted, connectionId? \| reason? }` | Reply to a request — accepts hand back the new connection id, rejects supply a reason. |

When the connection bridge targets a **native** window (since 0.5.5), no postMessages are exchanged — `connect()` opens synchronously and `conn.send/subscribe` route through the same in-process channel bus that powers `Window.send/on`. Same `onOpen` / `isOpen` / `disconnect` semantics, no observable difference to the caller.

## Lifecycle walkthrough — parent-initiated connection

1. **Plugin calls** `wp.desktop.connect( 'edit-post', { topics: [ 'gutenberg:content' ] } )`.
2. Connection bridge mints a `connectionId` (`desktop-mode-conn-N`), stores the connection in `_connections`, indexes it by target window in `_connectionsByTarget`.
3. Bridge looks up the iframe via `_syntheticIframes.get( id ) ?? manager.getById( id )?.iframe`.
4. Bridge `postMessage`s `desktop-mode-bridge-handshake` to the iframe's `contentWindow` with `targetOrigin = INITIAL_ORIGIN`.
5. Plugin code calls `conn.send( 'foo', payload )` before the ack arrives — message goes into the connection's `queue`, no `postMessage` yet.
6. Iframe's bridge handler receives the handshake, stores the connection in its own `connections` map, posts `desktop-mode-bridge-handshake-ack` back.
7. Parent's `routeIncomingFromIframe` receives the ack, dispatches to the connection's `_handleIframeMessage`, which:
   - Sets `isOpen = true`.
   - Fires `HOOKS.CONNECTION_OPENED` with `{ connectionId, targetWindowId, topics }`.
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

## Public hooks

| Hook | Kind | Status | Payload |
|---|---|---|---|
| `desktop-mode.connection.opened` | action | Experimental | `{ connectionId, targetWindowId, topics }` |
| `desktop-mode.connection.closed` | action | Experimental | `{ connectionId, reason: 'disconnect' \| 'window-closed' \| 'navigated' }` |
| `desktop-mode.connection.message` | action | Experimental | `{ connectionId, topic, direction: 'in' \| 'out' }` — high-volume, keep subscribers cheap |
| `desktop-mode.iframe.connection-request` | filter | Experimental | `boolean \| { topics: string[] } ← (accept, ctx)` — return `false` to reject, an object to accept-with-narrowing |

## Internal sniff points

When something's not working:

- **`window.__desktopModeConnectionBridge`** — installed by `desktop.ts` on init. If it's `undefined` in DevTools, the shell hasn't booted yet (or you're in a frame that's not the parent shell).
- **`window.wp.desktop.iframe`** — the iframe-side API. If it's `undefined` inside an iframe, the bridge script wasn't loaded — for chromeless wp-admin pages it's inline; for `iframeContent: { bridge: true }` it's auto-injected after load; for any other same-origin iframe enqueue `desktop-mode-iframe-bridge`.
- **`window.location.origin`** check — every postMessage in both directions filters on this. A common cause of "messages don't arrive" is a shell mounted on `https://example.test` and an iframe loaded from `http://example.test` (different origin); same domain ≠ same origin.
- **`event.source === iframe.contentWindow`** check — even same-origin, a foreign caller posting `desktop-mode-bridge-*` messages from somewhere ELSE in the parent will be silently dropped.

## Don't reinvent the wiring

If you find yourself writing `window.parent.postMessage` or hand-rolling a handshake, check first:

- For shell-registered iframe windows (chromeless wp-admin) → use `wp.desktop.connect()` + `wp.desktop.iframe.publish/subscribe`.
- For your own iframe pages → enqueue `desktop-mode-iframe-bridge` OR set `iframeContent: { bridge: true }` on a native window.
- For iframe-initiated requests → `wp.desktop.iframe.requestConnection()`.
- For source-validation + load-vs-listener-race → `wp.desktop.registerWindow({ iframeContent: { onReady, onMessage } })`.

The whole "shell.js coordinator" pattern is gone if you reach for these. The plugin's parent-shell footprint goes from ~150 lines of postMessage plumbing to a ~5-line config object.
