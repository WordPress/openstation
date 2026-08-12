# Example: window activity & the icon glow

Every desktop window carries an **activity phase** — `idle`, `pending`, `saving`, `saved`, `failed` — that the framework moves for you on every `wp.os.fetch`, and that you can drive by hand for anything else.

The title bar renders it as a **soft glow behind the window icon**. Nothing is mounted and nothing occupies space: the phase lands on the title bar as `data-os-activity` and the glow is a pseudo-element on the icon slot. Idle removes the attribute, so an idle window — which is almost every window, almost all of the time — carries no mark at all. The icon is already the thing that says which app this is; lighting it is how a desk lamp reports work.

The three phases are a **traffic light**: amber while a request is in flight (breathing slowly, not blinking), green for the moment after it lands, red if it didn't — and red **persists** until the next request starts, because a failure that fades out is a failure the user misses.

It arrives quickly and leaves slowly: entry is 0.2s decelerating, exit dissolves and shrinks together over 0.55s. The colour is held by a second attribute, `data-os-activity-last`, which is never cleared — so the halo fades out in the colour it lit up in rather than reverting to the accent halfway through, which is the difference between a dissolve and a blink.

None of that needs any code from you. It is already happening on every window in the shell.

## Making it yours

Five tokens, all themeable from a desktop theme or a stylesheet of your own:

| Token | What it paints |
|---|---|
| `--os-titlebar-activity-color` | The in-flight glow — amber. Deliberately not the brand accent: it belongs to the traffic light, not to the identity. |
| `--os-titlebar-activity-saved-color` | The glow on success — green. |
| `--os-titlebar-activity-failed-color` | The glow on failure — red. |
| `--os-titlebar-activity-size` | Halo diameter (default `34px`). |
| `--os-titlebar-activity-strength` | Peak opacity (default `0.55`). Set it to `0` to turn the effect off. |

Reduced motion drops both movements — the breath and the shrink — and keeps the cross-fade: movement is decoration, the colour is the state.

## Adding a literal dot as well

The old modem LED is still available for anything that wants a discrete indicator — a panel header, a native window's toolbar — and it is driven by the same paint call:

```js
const host = document.createElement( 'span' );
host.className = 'os-window__activity';

const dot = document.createElement( 'os-save-status' );
dot.setAttribute( 'mode', 'dot' );
dot.setAttribute( 'animation', 'modem' );
dot.setAttribute( 'phase', 'idle' );
dot.setAttribute( 'data-os-activity-indicator', '' );

host.appendChild( dot );
// …render `host` into an after-title slot; the window finds it by that
// attribute and drives its `phase` and `error` from here on.
```

While work is in flight it blinks like a 1990s data modem; on success it briefly fills in green; on failure it goes solid red with the error message as a tooltip.

## Screen readers

The glow is invisible to assistive technology, so the title bar also carries a visually-hidden live region that the framework writes the **outcome** into: `Saved` politely, `Not saved. <error>` assertively. The in-flight phase is deliberately not announced — telling someone that the save they just started is still going interrupts them to say nothing.

> Status: `wp.os.fetch` is **Stable**; `Window.trackActivity`, `Window.markActivity`, and `<os-save-status>` are **Experimental**.

## The shortest possible adoption

Use `wp.os.fetch` instead of the global `fetch`:

```js
// Before:
const res = await fetch( '/wp-json/myplugin/v1/save', { method: 'POST' } );

// After:
const res = await wp.os.fetch( '/wp-json/myplugin/v1/save', { method: 'POST' } );
```

That's it. The window is `saving` for the round-trip, `saved` on success, `failed` on failure (carrying the error message). No CSS, no DOM, no per-window plumbing — and if you mounted a dot as above, it blinks, flashes green, then goes red with the error as its tooltip.

**"Failure" means the outcome, not the promise.** Native `fetch` resolves for 4xx/5xx, but the indicator doesn't: a response with `ok: false` settles the phase as `failed` with `Request failed (HTTP 500 Internal Server Error).` as its tooltip. Your side of the call is unaffected — `wp.os.fetch` hands back the native promise, so it still resolves with the error response and your own `if ( ! res.ok )` branch runs as before. Only a genuinely successful (2xx) response paints the green check.

## Where it lands

By default, `wp.os.fetch` attributes the request to the **focused window** at the moment of the call. Most fetches happen inside event handlers — clicks, key presses, form submits — and the click already focused the window. So in 95% of cases the default attribution is correct.

For the 5% where focus isn't your friend, pass an explicit attribution:

```js
// You have the window's id (most native-window bundles know their own id):
wp.os.fetch( url, init, { windowId: 'my-plugin/inbox' } );

// You have a Window instance in scope:
wp.os.fetch( url, init, { window: ctx.window } );

// Don't move the phase for this fetch (background polls, prefetches):
wp.os.fetch( url, init, { silent: true } );
```

## Bundle-level migration recipe

Wrap the bundle's fetch helper once, then every call inherits the attribution:

```js
// my-plugin/rest.js
function shellFetch( input, init ) {
    if ( window.wp?.os?.fetch ) {
        return wp.os.fetch( input, init, { windowId: 'my-plugin/inbox' } );
    }
    return fetch( input, init );
}

export async function fetchInbox() {
    return ( await shellFetch( '/wp-json/myplugin/v1/inbox' ) ).json();
}
export async function archive( id ) {
    return shellFetch( `/wp-json/myplugin/v1/inbox/${ id }/archive`, {
        method: 'POST',
    } );
}
```

Every call site (`fetchInbox`, `archive`) now moves the inbox window's activity phase, with no per-call adoption.

## Non-fetch async work

When the operation isn't a single fetch — a `postMessage` handshake, an IndexedDB write, a `BroadcastChannel` round-trip, a long client-side computation — reach for `Window.trackActivity( promise )`:

```js
const win = wp.os.windowManager.getById( 'my-plugin/dashboard' );

// Single Promise:
await win.trackActivity( indexedDbWrite( record ) );

// Sequence:
await win.trackActivity( ( async () => {
    const a = await load();
    const b = await transform( a );
    await commit( b );
} )() );
```

Returns the Promise unchanged so callers can chain. The minimum 1.2s saving-display floor still applies, so even a 100ms operation shows a full modem cycle.

## Streaming / event-driven flows

For activity that doesn't map to a single Promise — an SSE stream, a WebSocket, a chained subscription — drive the phase manually with `Window.markActivity()`:

```js
win.markActivity( 'saving' );

const sse = new EventSource( '/wp-json/myplugin/v1/stream' );
sse.addEventListener( 'data', applyChunk );
sse.addEventListener( 'end', () => {
    sse.close();
    win.markActivity( 'saved' );
} );
sse.addEventListener( 'error', ( err ) => {
    sse.close();
    win.markActivity( 'failed', { error: 'Connection lost' } );
} );
```

Phases:

| Phase | Visual | Auto-clears |
|---|---|---|
| `'idle'` | Always-on hollow ring (accent color). | — |
| `'pending'` / `'saving'` | Filled, modem-blink with soft glow. | No |
| `'saved'` | Brief green fill. | After 2.2s |
| `'failed'` | Solid red. `opts.error` → tooltip. | After 6s |

`markActivity()` is idempotent — setting the same phase twice is a no-op except for resetting the auto-clear timer.

## Concurrent fetches

`Window.trackActivity` is **reference-counted**, so concurrent operations on the same window don't fight:

```js
// Two fetches in parallel — dot stays lit until the LAST one settles.
await Promise.all( [
    wp.os.fetch( urlA ),
    wp.os.fetch( urlB ),
] );
```

The terminal phase reflects the **burst as a whole** — if any tracked operation in the burst failed, the indicator settles on "failed" (with the most recent error as the tooltip), even when the last operation succeeded. A burst of 5 successful fetches followed by 1 error reads "failed" — surface the bad news; the user wants to know.

## Subtle UX choices the framework already made

**Minimum 1.2s saving display** — even a 50ms fetch holds the saving phase for ~1.2s so the modem-blink animation has time to register. Concurrent fetches that re-start within the floor cancel any deferred settle, so chained operations keep blinking smoothly without dropping into "saved" between calls.

**Always-on idle ring** — at rest, the dot is a 12px hollow circle with a 2px border tinted by the user's accent (`color-mix(in srgb, var(--wp-admin-theme-color) 55%, transparent)`). It looks like a real modem's "ready" LED — quietly present, not flashing, not invisible. That "always on" is why the framework no longer mounts one in the title bar of its own accord: a ready LED is right on a surface a user chose to put it on, and wrong as a fixture on every window ever opened. Set `--os-ui-save-status-idle-color: transparent` on the host if you want a dot that only appears while work is in flight.

**Drift-by-design animation** — the modem stutter cycles at 1.8s, the soft-glow halo at 2.4s; the offset periods mean the combined pattern only truly repeats every 7.2s, so it never reads as a metronome.

**Reduced-motion** — users with `prefers-reduced-motion: reduce` get a calm solid-on dot during saving (no animation, same affordance).

## What about non-fetch HTTP calls (XHR, sendBeacon)?

Wrap them in a Promise and hand to `Window.trackActivity`:

```js
function trackedXhr( url, body, win ) {
    return win.trackActivity( new Promise( ( resolve, reject ) => {
        const xhr = new XMLHttpRequest();
        xhr.open( 'POST', url );
        xhr.onload = () =>
            xhr.status >= 200 && xhr.status < 300
                ? resolve( xhr.response )
                : reject( new Error( `${ xhr.status } ${ xhr.statusText }` ) );
        xhr.onerror = () => reject( new Error( 'Network error' ) );
        xhr.send( body );
    } ) );
}
```

`fetch` covers the vast majority of cases; this pattern is the escape hatch.

## See also

- [`docs/javascript-reference.md`](../javascript-reference.md#wpdesktopfetch-input-init-opts---stable) — full API surface.
- [`<os-save-status>`](../components-reference.md#display--feedback) — the standalone component the title-bar indicator uses. Drop one anywhere (panel headers, plugin own settings forms, custom toolbars) — it auto-listens to a configurable CustomEvent and renders the same modem dot.
