# Cross-window devtools — instrumentation primitives

Build a third-party devtool (SQL inspector, network logger, perf profiler) that attaches to a window registered by another plugin without reaching into iframe globals.

The shell exposes three primitives that compose into a complete devtool:

| Primitive | Purpose |
|---|---|
| `wp.os.devtools.addRequestHeader(windowId, name, value)` | Contribute an HTTP header to every fetch / XHR / sendBeacon from the target window. Multiple devtools can contribute the same header — the shell joins values per RFC 7230 (`v1, v2, v3`). |
| `wp.os.devtools.onRequest(windowId, cb, { observe })` | Subscribe to every completed request from the target window. `observe: true` includes request + response headers in the payload. |
| `wp.os.devtools.debug.{startSession, publish, subscribe}` | Generic per-session pub/sub bus, server- and client-side. PHP capture publishes via `openstation_debug_publish()`; the JS shell polls and replays. |

Plus a server-side helper:

```php
$session_id = openstation_debug_session_for_request();
if ( '' !== $session_id ) {
    // request came from an instrumented window
}
```

## Worked example — minimal SQL inspector

The end goal: when the user clicks the bug-icon dropdown on any window's title bar and chooses "Attach SQL Inspector," every SQL query that window's iframe triggers shows up in a separate inspector window.

### Server side — capture queries during instrumented requests

```php
add_action( 'init', function () {
    $session_id = openstation_debug_session_for_request();
    if ( '' === $session_id || ! current_user_can( 'manage_options' ) ) {
        return;
    }
    if ( ! defined( 'SAVEQUERIES' ) ) {
        define( 'SAVEQUERIES', true );
    }

    add_action( 'shutdown', function () use ( $session_id ) {
        global $wpdb;
        if ( empty( $wpdb->queries ) ) {
            return;
        }
        foreach ( $wpdb->queries as $q ) {
            openstation_debug_publish( $session_id, 'query', array(
                'sql'    => $q[0],
                'time'   => $q[1],
                'caller' => $q[2],
            ) );
        }
    } );
}, 1 );
```

### Client side — bug-icon dropdown that opens the inspector

```js
wp.os.ready( () => {
    wp.os.registerTitleBarButton( {
        id:    'sql-inspector/attach',
        label: 'Devtools',
        icon:  'dashicons-bug',
        match: () => true,                // every window gets the bug
        onClick: ( win ) => {
            const sessionId = wp.os.devtools.debug.startSession();

            // Attach the session header to every outgoing request.
            const stop = wp.os.devtools.addRequestHeader(
                win.id,
                'X-WP-Debug-Session',
                sessionId,
            );

            // Open (or focus) the inspector window.
            const inspector = wp.os.registerWindow( {
                id:    `sql-inspector-${ win.id }`,
                title: `SQL — ${ win.config.title }`,
                icon:  'dashicons-search',
                native: true,
                width:  640,
                height: 480,
                onClose: () => stop(),    // remove the header on close
                render: ( body ) => {
                    body.innerHTML = `
                        <os-stack gap="8" style="padding:8px;">
                            <os-cluster gap="6">
                                <os-badge tone="success">Attached</os-badge>
                                <span style="opacity:0.7">${ win.config.ownerHandle || 'core' }</span>
                            </os-cluster>
                            <!--
                              row-height="22" is fixed-row-height mode (fast path).
                              Each row MUST fit in 22px or it clips silently. For
                              variable-content rows (header line + body block,
                              expandable details), set `auto-row-height` instead —
                              the component will measure each row and use cumulative
                              offsets for the virtualizer.
                            -->
                            <os-log id="log" row-height="22" max-rows="2000"></os-log>
                        </os-stack>
                    `;
                    const log = body.querySelector( '#log' );
                    log.renderRow = ( ev ) => {
                        const row = document.createElement( 'div' );
                        row.innerHTML = `
                            <os-code copy>${ ev.payload.sql }</os-code>
                            <span style="opacity:0.6;margin-inline-start:8px">
                                ${ ev.payload.time.toFixed( 4 ) }s
                            </span>
                        `;
                        return row;
                    };
                    wp.os.devtools.debug.subscribe(
                        sessionId,
                        'query',
                        ( ev ) => log.push( ev ),
                    );
                },
            } );
        },
    } );
} );
```

That's the whole thing. The pattern generalises: swap `'query'` for `'rest_timing'`, `'log'`, or any channel name your capture publishes on.

## Header contributions are ref-counted

If two devtools both want `X-WP-Debug-Session` on the same window, the shell concatenates with `, ` — neither overwrites the other. When each devtool calls its disposer, the contribution drops; only when the last contributor goes away is the header removed entirely.

```js
const stopA = wp.os.devtools.addRequestHeader( 'win-1', 'X-Trace', 'a' );
const stopB = wp.os.devtools.addRequestHeader( 'win-1', 'X-Trace', 'b' );
// Iframe sees: X-Trace: a, b
stopA();
// Iframe sees: X-Trace: b
stopB();
// Iframe sees: header removed
```

## Observation mode includes request + response headers

Default `onRequest` payloads carry only the privacy-conscious summary (`method`, `url`, `status`, `duration`, `failed`). Pass `{ observe: true }` to opt in to header capture for the duration of your subscription:

```js
wp.os.devtools.onRequest( windowId, ( req ) => {
    console.log( req.method, req.url, req.requestHeaders, req.responseHeaders );
}, { observe: true } );
```

The shell aggregates: as long as any subscriber for the window has `observe: true`, the iframe runs in observation mode. When the last observer disposes, the iframe falls back to summary mode automatically.

## ownerHandle attribution

Every window registered via `openstation_register_window( $id, $args )` (with `'script' => 'my-plugin-handle'` in `$args`) carries that handle through to `Window.config.ownerHandle`. Devtools read it for attribution:

```js
wp.os.registerTitleBarButton( {
    id: 'sql-inspector/attach',
    match: ( win ) => win.config.ownerHandle !== 'core-stuff',
    // ...
} );
```

When the URL is the only attribution surface (a window backed by a core admin page), `ownerHandle` is undefined — fall back to `win.config.url` parsing.

## REST endpoint surface

The debug bus exposes a single REST route: `GET /desktop-mode/v1/debug?sessionId=…&since=…&channel=…` (or `channels[]=…&channels[]=…`). Permission: logged-in admin (`manage_options`); override via the `openstation_debug_rest_permission` filter. The `openstation_debug_publish` action fires synchronously on every publish for observability widgets that don't want to round-trip through the poll loop.

### Talking to the endpoint directly

`wp.os.devtools.debug.subscribe()` is the supported path — it polls, dedupes, and replays events to your callback. If you need to bypass the poll loop (custom UI cadence, batched drains on demand, integration with a non-shell consumer), use **`wp.apiFetch`** rather than rolling your own `fetch()`:

```js
const events = await wp.apiFetch( {
    path: `/desktop-mode/v1/debug?sessionId=${ sid }&channels[]=query&since=${ cursor }`,
} );
```

`wp.apiFetch` handles two things you'd otherwise re-derive: nonce attachment and URL composition under both pretty-permalink (`/wp-json/`) and ugly-permalink (`?rest_route=/`) installs. Hand-built `fetch( restUrl + 'desktop-mode/v1/debug?sessionId=…' )` works on pretty-permalink sites and silently breaks on ugly-permalink sites — the URL ends up with two `?` separators, WordPress routes to the homepage, the response is HTML, and `JSON.parse` throws.

The shell's own poll loop uses WHATWG `URL` + `searchParams` for the same reason — both permalink schemes round-trip cleanly.
