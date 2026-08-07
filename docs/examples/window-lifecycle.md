# Subscribe to window lifecycle events

The shell fires a hook at every meaningful window state change — open, focus, minimize, maximize, drag-end, close, detach, fullscreen. Plugins can subscribe to any of them to drive their own UI or send analytics.

## The hook bus

Every event goes through `window.wp.hooks` (the `@wordpress/hooks` API). The shell aliases it at `wp.os.hooks` for convenience; either works. All window actions include at minimum `{ windowId: string }`; the richer payloads are documented in [javascript-reference.md](../javascript-reference.md#window-lifecycle).

## Minimum viable subscriber

```js
// my-plugin.js
( function () {
    // whenReady fires immediately if the shell has already booted, or
    // subscribes to `os.init` otherwise. Either way, your
    // subscribers land after `window.wp.os` is populated.
    wp.os.whenReady( function () {
        wp.os.hooks.addAction(
            'os.window.opened',
            'my-plugin/track-open',
            function ( payload ) {
                // payload: { windowId, page, title, url }
                console.log( 'Opened', payload.title, '→', payload.url );
            }
        );

        wp.os.hooks.addAction(
            'os.window.closed',
            'my-plugin/track-close',
            function ( payload ) {
                // payload: { windowId }
                console.log( 'Closed', payload.windowId );
            }
        );
    } );
} )();
```

## Typed subscribers (TypeScript)

Use the `HOOKS` enum so a renamed hook fails at typecheck instead of silently disconnecting:

```ts
import { HOOKS } from 'openstation';

wp.os.whenReady( () => {
    wp.os.hooks.addAction(
        HOOKS.WINDOW_MAXIMIZED,
        'my-plugin/maximize-fanfare',
        ( e: { windowId: string } ) => {
            console.log( 'Maximized', e.windowId );
        }
    );
} );
```

## What to listen for

| Event | Payload | When |
|---|---|---|
| `os.window.opened` | `{ windowId, page, title, url }` | After mount, before the opening animation completes |
| `os.window.focused` | `{ windowId }` | Every focus change (click, keyboard, iframe bridge) |
| `os.window.closed` | `{ windowId }` | After the close animation starts |
| `os.window.minimized` | `{ windowId }` | User clicks minimize or hits a dock shortcut |
| `os.window.restored` | `{ windowId }` | From minimized back to whichever state preceded the minimize (maximized / fullscreen / snapped / normal) |
| `os.window.maximized` | `{ windowId }` | Full desktop-area fill |
| `os.window.unmaximized` | `{ windowId }` | Back to floating (e.g. drag-restore) |
| `os.window.fullscreen-entered` | `{ windowId }` | Covers the entire viewport |
| `os.window.fullscreen-exited` | `{ windowId }` | Back to whichever state preceded |
| `os.window.moved` | `{ windowId, x, y }` | Fires with `drag-end` |
| `os.window.resized` | `{ windowId, width, height }` | Fires with `resize-end` |
| `os.window.title-changed` | `{ windowId, title }` | Iframe-sourced title updates |
| `os.window.detached` | `{ windowId, url }` | Open-in-new-tab via the detach button |

### Restoring from minimized — what fires

`os.window.restored` is the **only** action that fires when a window comes back from minimized. Even if the window was maximized / fullscreen / snapped at the moment it was minimized — and therefore returns to that same state on restore — `os.window.maximized` / `os.window.fullscreen-entered` / etc. do **not** re-fire. From the framework's perspective the window never left those states; minimize only hid it.

If your subscriber cares about "the window is now visible AND in state X," combine the events:

```js
wp.os.hooks.addAction(
    'os.window.restored',
    'my-plugin/visible-in-state-x',
    ( { windowId } ) => {
        const win = wp.os.windowManager.getById( windowId );
        if ( win?.isMaximized() ) {
            // Treat this like a fresh maximize for your UI purposes.
        }
    }
);
```

## Cleaning up

`@wordpress/hooks` subscribers stay registered until the page unloads or you explicitly remove them:

```js
wp.os.hooks.removeAction(
    'os.window.opened',
    'my-plugin/track-open'
);
```

## Related

- [JavaScript reference: window lifecycle](../javascript-reference.md#window-lifecycle) — full payload shapes.
- [Dock badges react to window counts](./dock-badge.md) — worked example using these events.
