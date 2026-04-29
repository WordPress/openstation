# Pulse a window's icon — `Window.requestAttention()`

**Stable** — shipped 0.22.0.

A live "pay attention to me" affordance for any registered native
window. Use it when something happens in the background that the
user should notice — a long task finishing, an error condition
becoming user-actionable, an inbound notification from a sister
plugin.

This API replaces the previous "rely on a `setInterval` that
manipulates the DOM under `#wp-desktop-dock`" workaround. The badge
+ attention paths are now first-class.

## Quick example

```js
// Pulse a registered window for 4 seconds.
const win = wp.desktop.windowManager.getById( 'my-plugin-inbox' );
win?.requestAttention( 'pulse', { durationMs: 4000 } );

// Or route through the rail directly:
wp.desktop.taskbar?.setAttention( 'my-plugin-inbox', 'shake', {
    durationMs: 1500,
    intensity: 'strong',
} );
```

## Modes

| Mode | Visual |
|---|---|
| `'pulse'` | Soft halo + scale, ~1.4s loop. Default for "you have a notification". |
| `'shake'` | Short horizontal jiggle. Good for nudges / urgent attention. |
| `'bounce'` | Vertical bob. Reads as "look here, now". |
| `null` | Clear any active attention. |

All three respect `prefers-reduced-motion: reduce` — the animation
is replaced by a static accent ring for the same duration.

## Options

```ts
window.requestAttention(
    mode: 'pulse' | 'shake' | 'bounce' | null,
    opts?: {
        durationMs?: number;          // default 4000; 0 = until cleared
        intensity?: 'subtle' | 'normal' | 'strong'; // default 'normal'
    },
): void;
```

## Live badge updates

Sister API for setting the numeric badge without poking the DOM:

```js
wp.desktop.taskbar?.setBadge( 'my-plugin-inbox', 7 );
wp.desktop.taskbar?.clearBadge( 'my-plugin-inbox' );
// `wp.desktop.dock.setBadge(...)` if your tile lives on the left rail.
```

The dock-vs-taskbar resolution mirrors the registered window's
`placement`. Both methods fire a
`wpd-dock-item-badge-changed` CustomEvent on `document` so other
plugins can mirror.

## Mute (Do Not Disturb) — JS hook

`Window.requestAttention` runs the request through the JS filter
`wp-desktop.window.attention` first. Return `null` to mute the
request entirely:

```js
wp.desktop.hooks.addFilter(
    'wp-desktop.window.attention',
    'my-plugin/dnd',
    ( mode, { windowId } ) => {
        if ( windowId === 'my-plugin-inbox' && isDoNotDisturbActive() ) {
            return null;
        }
        return mode;
    }
);
```

## Fallback for `placement: 'none'` windows

A window registered without a tile (e.g.,
`desktop_mode_register_window( ..., [ 'placement' => 'none' ] )`)
has no rail tile to pulse. `requestAttention` falls back to a
`setHighlight('persistent')` ring on the window itself, auto-cleared
after `durationMs`. The API is therefore safe to call regardless of
placement.

## Related

- [`docs/examples/dock-badge.md`](./dock-badge.md) — `Dock.setBadge` for live badge counts.
- [`docs/examples/connect-to-window.md`](./connect-to-window.md) — `Window.setHighlight` for cross-window pointing.
