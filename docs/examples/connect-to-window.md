# Connect to a window — title-bar button + iframe pub/sub

End-to-end recipe for the connection bridge: a plugin adds a button in the Gutenberg window's title bar, the button shows a dropdown of other open windows, hovering an item highlights the candidate window, clicking opens a `wp.desktop.connect()` channel, and Gutenberg keystrokes stream into a preview window in real time.

This is the canonical use case for the four 0.17.0 APIs working together:

1. `wp.desktop.registerTitleBarButton` — UI entry point
2. `Window.setHighlight` — visual feedback
3. `wp.desktop.connect` — parent-side channel
4. `wp.desktop.iframe.publish` / `subscribe` / `onConnection` — iframe-side channel

## 1. PHP — declare the script handles

```php
// my-plugin.php

add_action( 'admin_enqueue_scripts', function () {
    // Parent-shell script — the title-bar button + the connect logic.
    wp_register_script(
        'my-plugin-titlebar',
        plugins_url( 'js/titlebar.js', __FILE__ ),
        array( 'desktop-mode' ),
        '1.0.0',
        true
    );
    wp_enqueue_script( 'my-plugin-titlebar' );

    // Iframe-side script — runs inside the Gutenberg page, publishes
    // editor state. Use the standard admin enqueue; the chromeless
    // bridge already wires up `wp.desktop.iframe.*`.
    wp_register_script(
        'my-plugin-iframe',
        plugins_url( 'js/iframe.js', __FILE__ ),
        array( 'wp-data', 'wp-edit-post' ),
        '1.0.0',
        true
    );
    wp_enqueue_script( 'my-plugin-iframe' );
} );

// Tell the shell our titlebar script registers buttons — gets the
// live-refresh injection on plugin activation.
desktop_mode_register_titlebar_button_script( 'my-plugin-titlebar' );
```

## 2. Parent-side — register the button

```javascript
// js/titlebar.js

wp.desktop.ready( () => {
    wp.desktop.registerTitleBarButton( {
        id:       'live-preview/connect',
        label:    'Live preview',
        icon:     'dashicons-visibility',
        // Only show on Gutenberg windows.
        match:    ( w ) => /post(?:-new)?\.php/.test( w.config.url ?? '' ),
        owner:    'my-plugin-titlebar',
        // Custom render — we own the host so we can wire a popover
        // dropdown without fighting `<wpd-window-button>` defaults.
        render: ( host, hostWindow ) => {
            host.addEventListener( 'click', () =>
                showCandidatesPopover( host, hostWindow ),
            );
        },
    } );
} );

function showCandidatesPopover( anchor, hostWindow ) {
    // Build a quick popover listing every other open window.
    const popover = document.createElement( 'wpd-menu' );
    popover.style.position = 'absolute';
    popover.style.top = `${ anchor.getBoundingClientRect().bottom }px`;
    popover.style.left = `${ anchor.getBoundingClientRect().left }px`;
    document.body.appendChild( popover );

    const others = wp.desktop.windowManager
        .getAll()
        .filter( ( w ) => w.id !== hostWindow.id );

    others.forEach( ( target ) => {
        const item = document.createElement( 'wpd-menu-item' );
        item.textContent = target.config.title;

        // Hover-preview → highlight the candidate window.
        item.addEventListener( 'mouseenter', () => target.setHighlight( 'preview' ) );
        item.addEventListener( 'mouseleave', () => target.setHighlight( null ) );

        // Click → open the connection.
        item.addEventListener( 'click', () => {
            target.setHighlight( null );
            popover.remove();
            wireUpLivePreview( hostWindow, target );
        } );
        popover.appendChild( item );
    } );

    // Dismiss on outside click.
    setTimeout( () => {
        const dismiss = ( e ) => {
            if ( ! popover.contains( e.target ) ) {
                popover.remove();
                others.forEach( ( w ) => w.setHighlight( null ) );
                document.removeEventListener( 'click', dismiss );
            }
        };
        document.addEventListener( 'click', dismiss );
    }, 0 );
}

function wireUpLivePreview( gutenbergWin, previewWin ) {
    // Subscribe to Gutenberg edits + forward into the preview window.
    const editorConn = wp.desktop.connect( gutenbergWin.id, {
        topics: [ 'gutenberg:content' ],
    } );

    // The preview window is also an iframe — open a second connection
    // and `send` the latest content on every keystroke.
    const previewConn = wp.desktop.connect( previewWin.id );

    editorConn.subscribe( 'gutenberg:content', ( html ) => {
        previewConn.send( 'preview:html', html );
    } );

    // Tear both down when either closes.
    editorConn.subscribe( '*', ( _p, m ) => {
        if ( m.topic === 'gutenberg:closed' ) {
            editorConn.disconnect();
            previewConn.disconnect();
        }
    } );
}
```

## 3. Iframe-side — publish editor state

```javascript
// js/iframe.js — runs inside the Gutenberg iframe.

if ( window.wp?.desktop?.iframe ) {
    wp.desktop.iframe.onConnection( () => {
        // Start emitting only when somebody connects — saves work.
        const editor = wp.data.select( 'core/editor' );
        let lastContent = '';

        wp.data.subscribe( () => {
            const next = editor.getEditedPostContent();
            if ( next === lastContent ) {
                return;
            }
            lastContent = next;
            wp.desktop.iframe.publish( 'gutenberg:content', next );
        } );
    } );
}
```

## 4. Iframe-side — receive into the preview window

If the preview is also an iframe (a custom plugin page), have it subscribe to `preview:html`:

```javascript
// js/preview-iframe.js — inside the preview window.

if ( window.wp?.desktop?.iframe ) {
    wp.desktop.iframe.subscribe( 'preview:html', ( html ) => {
        document.querySelector( '#preview-target' ).innerHTML = html;
    } );
}
```

That's the whole live-preview flow: keystroke in Gutenberg → `wp.data.subscribe` fires → `iframe.publish('gutenberg:content', html)` → parent shell routes the message → preview window's `iframe.subscribe('preview:html')` paints it.

## Bonus — opening the preview window via the `iframeContent` shorthand

If your preview window is itself an iframe pointing at a custom plugin URL, skip the manual `body.appendChild( iframe )` dance. The `iframeContent` shorthand lets `registerWindow` own the iframe lifecycle:

```javascript
const previewWin = wp.desktop.registerWindow( {
    id:    'live-preview/preview',
    title: 'Live Preview',
    icon:  'dashicons-visibility',
    width: 720,
    height: 720,
    iframeContent: {
        url:     '/wp-admin/admin.php?page=my-preview-page',
        bridge:  true,                                  // auto-inject `wp.desktop.iframe.*`
        onMessage: ( payload ) => {
            // Source-checked already by the shell — no need to validate event.source.
        },
    },
} );

// Push state into the preview window. `Window.send` is safe to
// call before the iframe has finished loading — pre-load sends
// queue and flush in FIFO order once the iframe-bridge announces
// itself ready.
previewWin.send( 'init', { theme: 'dark' } );

editorConn.subscribe( 'gutenberg:content', ( html ) => {
    previewWin.send( 'preview:html', html );
} );
```

If you want the live stream to collapse pre-load intermediates to the freshest snapshot (so three keystrokes during iframe load become one), keep your own latest-only ref outside the queue:

```javascript
let latest = null;
let queued = false;
editorConn.subscribe( 'gutenberg:content', ( html ) => {
    latest = html;
    if ( queued ) return;
    queued = true;
    queueMicrotask( () => {
        previewWin.send( 'preview:html', latest );
        queued = false;
    } );
} );
```

Then inside `my-preview-page`:

```javascript
wp.desktop.on( 'preview:html', ( html ) => {
    document.querySelector( '#preview-target' ).innerHTML = html;
} );
```

That's the whole preview frame — no `postMessage` plumbing, no source-check, no load-vs-listener race.

## Bonus — iframe-initiated connections (`requestConnection`)

If the editor sidebar (running inside the Gutenberg iframe) wants to *initiate* the connection rather than wait for the parent's button click:

```javascript
// Inside the Gutenberg iframe:
const conn = await wp.desktop.iframe.requestConnection( {
    topics: [ 'wpglp:content' ],
} );
// `conn` = { id, topics } — the parent already opened a connection back to us.
// From here, just `publish` like normal.
```

Parent-side, plugins can intervene with the `desktop-mode.iframe.connection-request` filter:

```javascript
wp.desktop.hooks.addFilter(
    'desktop-mode.iframe.connection-request',
    'my-plugin/gate',
    ( accept, ctx ) => {
        // ctx = { windowId, requestId, topics }
        if ( ctx.topics.includes( 'destructive:topic' ) && ! userIsAdmin() ) {
            return false;  // reject
        }
        return accept;
    },
);
```

Default behaviour is accept-with-original-topics — the iframe is same-origin and it asked, so the gate is opt-in.

## Notes

- **Origin guard:** every postMessage flowing through the bridge is `targetOrigin`-checked against the shell's own origin. Cross-origin iframes can't talk to the bridge — by design.
- **Topic naming:** prefix with your plugin slug (`gutenberg:content`, `live-preview:html`). Two plugins picking the same topic name will subscribe to each other's traffic.
- **Sanitisation:** payloads pass through verbatim. The shell does NOT sanitise. If the payload could include user-typed HTML rendered as innerHTML in the receiver, sanitise on the publish side or use safer DOM construction in the receiver.
- **Tear-down:** the shell auto-disconnects every connection targeting a window when that window closes (`onClose` reason: `'window-closed'`). Per-topic unsubscribe is the caller's responsibility.
- **Wildcard subscription:** `subscribe( '*', cb )` fires for every published payload. Cheap to wire up, expensive when the topic carries one event per keystroke — use sparingly.
