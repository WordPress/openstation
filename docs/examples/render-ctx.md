# The native-window render `ctx`

Native windows registered via `desktop_mode_register_window()` (or `wp.desktop.registerWindow()`) get a `render` callback. The callback receives a second `ctx` argument carrying the channel API and the rest of the window-scoped helpers — a close-bound `AbortSignal`, lazy resize/hide/show subscribers, and top-level `markLoading`/`markReady` aliases for the loading-overlay controls.

```ts
render: (
    body: HTMLElement,
    ctx: NativeRenderContext,
) => void | ( () => void ) | Promise< void | ( () => void ) >;
```

Legacy unary callbacks (`render: ( body ) => …`) keep working — the second arg is optional and JS just ignores extras.

## What's on `ctx`

| Field | Type | Use |
|---|---|---|
| `signal` | `AbortSignal` | Aborts when the window starts closing. Pass to `wp.desktop.fetch( url, { signal } )` so in-flight requests cancel. |
| `onResize( cb )` | `( cb: ( w, h ) => void ) => () => void` | Subscribe to body-resize events for this window. Returns an unsubscribe; auto-detaches on close. |
| `onHide( cb )` | `( cb: () => void ) => () => void` | Fires when the window is minimized. Pause animations/intervals here. |
| `onShow( cb )` | `( cb: () => void ) => () => void` | Fires when the window is restored. Resume what `onHide` paused. |
| `markLoading()` | `() => void` | Re-show the loading overlay (e.g. before a refetch). |
| `markReady()` | `() => void` | Hide the overlay + fade body in. |
| `window.send( channel, payload? )` | typed pub | Publish on this window's channel — every `Window.on(channel, cb)` subscriber sees it. |
| `window.on( channel, cb )` | typed sub | Subscribe to messages sent FROM outside via `Window.send()`. |

`markLoading` / `markReady` exist both at the top level (`ctx.markLoading()`) and under `ctx.window` (`ctx.window.markLoading()`). The top-level shape exists for `{ markLoading, markReady, signal, onResize }` destructuring; `ctx.window` is the original surface and stays.

## Recipe — feed reader that cancels on close, pauses while hidden

```ts
window.desktopModeNativeWindows = window.desktopModeNativeWindows || {};
window.desktopModeNativeWindows[ 'my-feed-inbox' ] = async (
    body,
    { signal, onResize, onHide, onShow, markLoading, markReady, window: ch },
) => {
    const list = body.querySelector< HTMLElement >( '.feed' )!;
    let paused = false;
    let cursor: string | undefined;

    async function loadPage() {
        markLoading();
        try {
            const res = await wp.desktop.fetch(
                '/wp-json/my-feed/v1/items?cursor=' + ( cursor ?? '' ),
                { signal },
            );
            if ( signal.aborted ) return;
            const json = await res.json();
            cursor = json.nextCursor;
            renderItems( list, json.items );
        } catch ( err ) {
            if ( ( err as DOMException ).name === 'AbortError' ) return;
            throw err;
        } finally {
            if ( ! signal.aborted ) markReady();
        }
    }

    onResize( ( w ) => list.style.setProperty( '--feed-width', w + 'px' ) );
    onHide( () => { paused = true; } );
    onShow( () => { paused = false; loadPage(); } );

    // Listen for parent → window pushes, e.g. someone clicked
    // "Refresh" from a sibling toolbar.
    ch.on( 'feed:refresh', () => { cursor = undefined; loadPage(); } );

    await loadPage();

    // Optional: a render-returned teardown still runs at close —
    // useful for resources the framework can't track on its own.
    return () => {
        // No need to abort `signal` here — the framework already did.
    };
};
```

## What "auto-detach" means

The framework stores the ctx's disposer on the `Window` instance and runs it pre-animation when the window closes:

1. `controller.abort()` fires on `ctx.signal`.
2. Every `onResize`/`onHide`/`onShow` subscription is removed.

The user's render-returned teardown runs AFTER the closing animation. So async paths inside the teardown that branch on `signal.aborted` already see the flipped value.

## Backwards compatibility

- Existing unary `( body ) => …` callbacks: continue to work. JS ignores the extra arg.
- Existing callers using `ctx.window.markLoading()` (the 0.6.0 surface): still work — that surface is unchanged.
- `WindowConfig.onResize` (registration-time field): still fires alongside `ctx.onResize`. Use whichever fits your code shape — the registration-time field is an inline bag for plugins that prefer not to subscribe inside the render body.

## See also

- [`native-windows.md`](./native-windows.md) — the registration end of the contract.
- [`window-loading.md`](./window-loading.md) — the spinner-overlay lifecycle that `markLoading` / `markReady` drive.
- [`react-to-window-events.md`](./react-to-window-events.md) — observability hooks for code outside the render body.
