# Custom window chrome (Experimental)

> **Status: Experimental.** The chrome render contract may change in future minor versions. Layers 1-3 ([Window themes](./window-theme.md), [Window controls](./window-controls.md), [Window slots](./window-slot.md)) cover 95%+ of practical customization by composition — reach for Layer 4 only when you need to draw a fundamentally different title-bar architecture.

A **chrome** owns the title-bar DOM tree of any window that selects it via `WindowConfig.appearance.chrome`. The framework still owns drag, focus, resize, lifecycle, position persistence, and the postMessage bridge — your render only controls the title bar's interior.

The default chrome id is `'core/standard'`. Choosing it (or omitting `appearance.chrome`) means "use the standard title bar painted by Layers 1-3" — no chrome render runs.

---

## The contract

```ts
wp.os.registerWindowChrome( {
    id:    'my-plugin/macos',
    label: 'macOS-style chrome',
    match: ( win ) => true,
    render: ( host, ctx ) => {
        // host: the outer .os-window element. It already
        //       contains .os-window__body and the resize
        //       handles — leave those alone.
        // ctx.window — the Window instance.
        // ctx.state  — { title, icon, focused, state } at first paint.

        const titleBar = host.querySelector( '.os-window__titlebar' );
        // Replace its contents with whatever DOM you want.
        titleBar.innerHTML = '';
        const close = document.createElement( 'button' );
        close.textContent = '×';
        close.addEventListener( 'click', () => ctx.window.close() );
        titleBar.appendChild( close );

        return {
            update( state ) {
                // Called when title / icon / focus / state changes.
                // Re-paint the relevant DOM nodes.
            },
            destroy() {
                // Called when the chrome is swapped, the window is
                // closed, or the registration is removed. Drop event
                // listeners, observers, retained references.
            },
        };
    },
} );
```

`render` MUST return `{ destroy }`; `update` is optional.

The framework keeps the standard `.os-window__titlebar` element for you — pointer-down drag is bound on it, and removing/replacing the element entirely would break window dragging. Mutate its children instead.

---

## Recipe — Pick a chrome at registration time

```js
wp.os.registerWindow( {
    id:     'my-plugin/widget',
    title:  'Widget',
    icon:   'dashicons-admin-customizer',
    width:  400, height: 300,
    minWidth: 200, minHeight: 150,
    appearance: { chrome: 'my-plugin/macos' },
    render: ( body ) => { /* … */ },
} );
```

## Recipe — Swap chrome at runtime

```js
wp.os.applyWindowChrome( 'edit-post', 'my-plugin/macos' );

// Fall back to the standard chrome:
wp.os.applyWindowChrome( 'edit-post', null );
```

---

## What you do NOT control

- The outer `.os-window` element
- The body element + iframe / native render content
- The 4 corner resize handles
- The `os-window--focused` class toggle (the framework toggles it; you can read it via `ctx.state.focused`)
- The position persistence + drag pointer math

---

## Hooks

### PHP

| Hook | Type | Signature | Purpose |
|------|------|-----------|---------|
| `open_station_window_chrome_script_registered` | action | `( string $handle )` | Fires after `open_station_register_window_chrome_script()` succeeds. |
| `open_station_window_chrome_registered` | action | `( string $id, array $entry )` | Fires after `open_station_register_window_chrome()` stores metadata. |

### JavaScript

| Hook | Type | Signature | Purpose |
|------|------|-----------|---------|
| `os.window.chrome.render` | filter | `( chromeId, { windowId, config } ) => chromeId` | Mutate the resolved chrome id per window. **Experimental.** |
| `os.window.chrome.applied` | action | `( { windowId, layer, chromeId? } )` | Fires with `layer: 'chrome'` after a successful chrome mount. |

---

## API surface

| Function | Purpose |
|----------|---------|
| `wp.os.registerWindowChrome( def )` | Register a chrome implementation. |
| `wp.os.unregisterWindowChrome( id )` | Drop by id; windows fall back to `'core/standard'` on next paint. |
| `wp.os.listWindowChromes()` | Snapshot of registered chromes. |
| `wp.os.applyWindowChrome( windowId, chromeId )` | Set / clear at runtime. |
| `WindowConfig.appearance.chrome` | Pick at window-registration time. |
