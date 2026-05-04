# Open a file in the Code editor (deep-link from any window)

The Code editor ships as the standalone **Desktop Mode — Code Editor** extension (`extensions/desktop-mode-code-editor/`). The deep-link surfaces below only work when that plugin is active alongside Desktop Mode.

The editor exposes two surfaces for opening a file from elsewhere on the desktop — one for plugin authors writing JavaScript inside an iframe window, one for the user.

## Cmd / Ctrl + Shift + E

Pressing `Cmd+Shift+E` (macOS) / `Ctrl+Shift+E` (Linux/Windows) anywhere on the desktop opens the editor window — or focuses it if already open. No file picker; the editor returns to its last-active tab.

The shortcut is gated by the same `edit_plugins` capability that gates the editor window itself, so users without the cap never get the affordance (the JS bundle isn't enqueued for them).

## `desktop-mode-code-open` postMessage

Any frame on the desktop — an iframe-based plugin window, a chromeless wp-admin page, the shell itself — can request the editor open at a specific path + line by posting:

```js
window.parent.postMessage(
    {
        type: 'desktop-mode-code-open',
        path: 'plugins/my-plugin/main.php',
        line: 42, // optional, defaults to 1
    },
    window.location.origin,
);
```

Behaviour:

- If the editor window is closed → it opens, then the message is replayed once the editor's render callback has mounted, then it scrolls to the requested line.
- If the editor is already open → the message goes straight to the in-window listener, which fetches the file, opens (or focuses) a tab, and scrolls to the line.
- The path is resolved through the editor's normal `desktop_mode_code_editor_resolve_path()` safety check — `..` escapes, symlinks pointing outside the workspace, and disallowed extensions all fail closed.

### Use case: "view source" link in a plugin's admin page

A plugin that renders an admin page inside an iframe window (the standard wp-admin path) can offer a "View source" link that jumps the user straight into the editor:

```php
?>
<a href="#" id="my-view-source" class="button">View source</a>
<script>
document.getElementById('my-view-source').addEventListener('click', (e) => {
    e.preventDefault();
    window.parent.postMessage(
        {
            type: 'desktop-mode-code-open',
            path: 'plugins/my-plugin/admin/page.php',
            line: 1,
        },
        window.location.origin
    );
});
</script>
<?php
```

### Use case: AI Copilot tool that opens the file it just discussed

A registered AI command that returns a code reference can drop the user into the editor at the relevant line:

```js
wp.desktop.registerCommand( {
    slug: 'open-in-editor',
    label: 'Open in Code editor',
    aiCallable: true,
    run( args ) {
        const [ path, line ] = args.split( ':' );
        window.postMessage(
            { type: 'desktop-mode-code-open', path, line: parseInt( line, 10 ) || 1 },
            window.location.origin
        );
    },
} );
```

### Same-origin only

The editor's listener rejects messages from any origin other than `window.location.origin`. Cross-origin embeds (rare in WP admin) won't work; this is intentional — the editor exposes file-read capability and we don't want a third-party origin to drive it.

## `wp.desktop.openWindow( id )`

For JS code running in the same realm as the desktop shell (rare — most plugin code runs inside iframes), the same effect is one call away:

```js
wp.desktop.openWindow( 'wpdc-editor' );
// then — once you know the editor is ready —
window.postMessage(
    { type: 'desktop-mode-code-open', path: '...', line: 12 },
    window.location.origin
);
```

`openWindow( id )` works for any registered native window, not just the editor. Returns `true` if a window with that id exists and was opened (or focused), `false` otherwise.

## Related

- [Register a desktop icon](./register-icon.md) — the canonical pattern for a clickable wallpaper tile that opens any registered native window.
- [`wp.desktop.windowManager`](../javascript-reference.md) — full window-manager API for advanced cases.
