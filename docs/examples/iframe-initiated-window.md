# Iframe-initiated window opens

`docs/examples/connect-to-window.md` shows the case where the parent shell drives the conversation — a title-bar button mounted via `registerTitleBarButton` calls `wp.os.connect()` and pushes data into a sibling iframe. This recipe covers the **inverse topology**: code running *inside* a chromeless wp-admin iframe (a Gutenberg `PluginSidebar`, a custom meta-box, a settings page) needs to open or talk to a sibling window — without the parent shell having to register anything per-iframe-route.

The classic case: **Live Preview**. The user is editing a post; a sidebar button inside the Gutenberg iframe should open a "Preview" window next to it and stream content changes live.

## Patterns at a glance

| Need | Use | Why |
| --- | --- | --- |
| "Open a sibling window from inside this iframe" | `wp.os.send( 'request-open-window', { url } )` — parent listens via `Window.on` | Symmetric `Window.send` / `wp.os.send` channel, no per-target wiring. |
| "Connect back to the parent so I can publish updates" | `wp.os.iframe.requestConnection({ topics })` | Iframe initiates; parent's `HOOKS.IFRAME_CONNECTION_REQUEST` filter decides accept/reject. |
| "What window am I living in?" | `wp.os.iframe.windowId` / `await wp.os.iframe.whenWindowId()` | Resolved after the parent's first handshake. |
| "Did the parent shell even hear me?" | `wp.os.iframe.publish` now `console.warn`s on dropped messages | Watch DevTools. |

## Recipe: PluginSidebar opens a Preview window with live content streaming

### 1. Parent-side bootstrap (shell, once)

```javascript
// In your plugin's shell-side bundle (the main `desktop.min.js`-loaded entry).
//
// We listen on the publish channel for `request-open-preview` from any
// iframe window (Gutenberg post editor). When it arrives, open a sibling
// Preview window AND wire the live content forwarder.

import { addAction, HOOKS } from 'openstation';

addAction( HOOKS.WINDOW_OPENED, 'my-plugin/wire-editor', ( e ) => {
    // Iframe window ids are slugified admin filenames plus identity
    // params: post.php → `post-php`, post.php?post=123 → `post-php-post-123`,
    // post-new.php → `post-new-php`.
    if (
        ! e.windowId.startsWith( 'post-php' ) &&
        ! e.windowId.startsWith( 'post-new-php' )
    ) {
        return;
    }
    const editor = wp.os.windowManager.getById( e.windowId );
    if ( ! editor ) return;

    editor.on( 'request-open-preview', async ( payload ) => {
        const previewId = `preview-of-${ editor.id }`;
        // `registerWindow` takes a single definition object, opens (or
        // focuses) the window immediately, and resolves with its
        // DesktopWindow handle. `previewRender` is defined in step 3.
        const preview = await wp.os.registerWindow( {
            id: previewId,
            title: 'Live Preview',
            render: previewRender,
        } );
        // Open a connection back to the editor's iframe so we can forward
        // its content updates to the preview window's native render.
        const conn = wp.os.connect( editor.id, {
            topics: [ 'editor:content' ],
        } );
        conn.subscribe( 'editor:content', ( html ) => {
            preview.send( 'preview:html', html );
        } );
    } );
} );
```

### 2. Iframe-side trigger (PluginSidebar, runs inside post.php)

```javascript
// Loaded by your plugin on post.php / post-new.php (via enqueue_block_editor_assets).
//
// Inside Gutenberg, register a sidebar button that:
//   a) Asks the parent shell to open the Preview window.
//   b) Starts streaming editor content over the connection.

import { PluginSidebar, PluginSidebarMoreMenuItem } from '@wordpress/edit-post';
import { useSelect, subscribe } from '@wordpress/data';
import { Button } from '@wordpress/components';

function PreviewSidebar() {
    const [ streaming, setStreaming ] = useState( false );

    const open = async () => {
        // Guard before awaiting the window id. `whenWindowId()` never
        // rejects — if the parent shell never sends a handshake (e.g.
        // cross-origin parent, page opened outside OpenStation) the
        // Promise hangs forever. `isParentReachable()` resolves that
        // ambiguity synchronously.
        if ( ! wp.os.iframe.isParentReachable() ) {
            return; // Not running inside OpenStation — bail silently.
        }
        const myWindowId = await wp.os.iframe.whenWindowId();

        // Tell the parent shell to open a Preview window paired with us.
        // `wp.os.send( channel, payload )` posts a `os-window-publish`
        // message — the parent's `Window.on('request-open-preview')` handler
        // (wired in step 1) fires.
        wp.os.send( 'request-open-preview', {
            sourceWindowId: myWindowId,
        } );

        // Now start publishing editor content. The parent's connection's
        // subscriber forwards each batch into the preview window.
        setStreaming( true );
    };

    useEffect( () => {
        if ( ! streaming ) return;

        let last = '';
        const unsub = subscribe( () => {
            const editor = wp.data.select( 'core/editor' );
            const html = editor.getEditedPostContent();
            if ( html === last ) return;
            last = html;
            wp.os.iframe.publish( 'editor:content', html );
        } );

        return unsub;
    }, [ streaming ] );

    return (
        <PluginSidebar name="my-plugin/preview" title="Preview">
            <Button isPrimary onClick={ open }>
                { streaming ? 'Streaming…' : 'Open live preview' }
            </Button>
        </PluginSidebar>
    );
}

registerPlugin( 'my-plugin-preview', { render: PreviewSidebar } );
```

### 3. Preview window's native render (also runs in the shell bundle)

There is no separate register-now/open-later step — `wp.os.registerWindow( def )` registers AND opens in one call (step 1 makes it), so the render callback is just a plain function referenced from the definition:

```javascript
function previewRender( body, ctx ) {
    body.innerHTML = '<iframe id="preview-frame" style="width:100%; height:100%; border:none"></iframe>';
    const iframe = body.querySelector( '#preview-frame' );

    // Listen for content updates forwarded by the parent from the
    // editor iframe (step 1 wires the forwarder).
    ctx.window.on( 'preview:html', ( html ) => {
        iframe.srcdoc = html;
    } );
}
```

## What's happening under the hood

1. **PluginSidebar runs inside the Gutenberg iframe.** That iframe has the standalone iframe-bridge installed (auto-enqueued on every admin page for OpenStation users), which exposes `wp.os.send`, `wp.os.iframe.publish`, and `wp.os.iframe.windowId`.
2. **Step 2's `wp.os.send`** turns into a `os-window-publish` postMessage to the parent. The parent's `Window.on(...)` subscribers for THIS window's id fire — step 1's handler is one of them.
3. **Step 1 opens the Preview window** via `wp.os.registerWindow( def )` — which opens (or focuses) the window immediately and resolves with its `DesktopWindow` handle — and then opens a typed connection back to the editor's iframe via `wp.os.connect(editor.id, { topics })`. The connection handshakes through `os-bridge-handshake` / `…-ack`.
4. **Step 2's `wp.os.iframe.publish`** fans editor content out over every open connection. The parent's `conn.subscribe(...)` fires, and we forward into the preview window's native channel via `preview.send(...)`.
5. **Step 3 listens** on the preview's own channel via `ctx.window.on(...)` — no postMessage on this side; it's all in-process.

## When the parent silently ignores your message

If `wp.os.send(...)` (or `wp.os.iframe.publish(...)`) does nothing visible:

- **No connection open** → `publish` logs a `console.warn` when there are zero connections. Open DevTools (in the iframe's frame), look for `[openstation] wp.os.iframe.publish dropped`.
- **No subscriber** → no warning by design. Add an `addAction(HOOKS.CONNECTION_OPENED, …)` log on the parent side to confirm the connection actually opened.
- **Cross-origin iframe** → bridges hard-filter on `window.location.origin`. The Gutenberg editor-canvas (nested iframe inside post.php) uses `srcdoc` which inherits the parent's origin, so it's fine; arbitrary cross-origin iframes silently drop. See [`bridge-protocol.md`](../bridge-protocol.md#cross-origin-iframes--explicit-non-goal) for the explicit non-goal.

## Related

- [`connect-to-window.md`](./connect-to-window.md) — the inverse topology (parent-initiated).
- [`code-editor-open.md`](./code-editor-open.md) — sibling-window opens via a different protocol (`os-code-open` postMessage).
- [`../bridge-protocol.md`](../bridge-protocol.md) — full message catalog.
