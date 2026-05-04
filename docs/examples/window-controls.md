# Window controls

The title-bar control cluster (close / minimize / maximize / focus / detach) is rendered from a registry plugins can extend, reorder, hide, or replace per-window. Built-in controls live in the same registry as plugin controls, addressed by the stable ids `core/minimize`, `core/maximize`, `core/focus-tab`, `core/detach`, `core/close`.

This is **Layer 2** of the four-layer window-chrome customization framework. See [Window themes](./window-theme.md) for Layer 1.

---

## Recipe 1 — Reorder built-in controls per window

Move the close button to the leftmost position on a specific native window:

```js
wp.desktop.registerWindow( {
    id:     'my-plugin/dashboard',
    title:  'Dashboard',
    icon:   'dashicons-dashboard',
    width:  640, height: 480,
    minWidth: 320, minHeight: 200,
    appearance: {
        controls: {
            order: [ 'core/close', 'core/minimize', 'core/maximize' ],
        },
    },
    render: ( body ) => { body.textContent = 'Hello'; },
} );
```

Controls listed in `order` render in that order; controls not listed keep their registry order and append after.

## Recipe 2 — Hide a built-in for one window

```js
wp.desktop.applyWindowControls( 'edit-post', {
    hide: [ 'core/detach', 'core/focus-tab' ],
} );
```

Other windows retain the full set. Pass `null` to clear the override.

## Recipe 3 — Add a custom control inside the cluster (window-scoped)

A control declared inline never enters the global registry — it lives only on this window:

```js
wp.desktop.applyWindowControls( 'edit-post', {
    custom: [
        {
            id:    'my-plugin/star',
            label: 'Star this draft',
            icon:  'dashicons-star-filled',
            placement: 'controls', // alongside close/min/max
            order: 5, // before core/minimize (order 10)
            onClick: ( ev ) => {
                console.log( 'starred', ev );
            },
        },
    ],
} );
```

`placement: 'controls'` puts the button inside the cluster. `'left'` and `'right'` are accepted but currently route through the legacy title-bar-button registry — see [Connect to a window](./connect-to-window.md) for the established pattern.

## Recipe 4 — Register a control globally (cross-window)

When the same control should appear in many windows, register it via `wp.desktop.registerWindowControl()` with a `match` predicate:

**plugin.php**

```php
add_action( 'admin_enqueue_scripts', function () {
    wp_register_script(
        'my-plugin-controls',
        plugins_url( 'controls.js', __FILE__ ),
        array( 'desktop-mode' ),
        '1.0.0', true
    );
    wp_enqueue_script( 'my-plugin-controls' );
} );
desktop_mode_register_window_control_script( 'my-plugin-controls' );
```

**controls.js**

```js
wp.desktop.whenReady( () => {
    wp.desktop.registerWindowControl( {
        id:    'my-plugin/info',
        label: 'Info',
        icon:  'dashicons-info',
        placement: 'controls',
        order: 5,
        match: ( win ) => win.config.url?.includes( 'post.php' ) ?? false,
        owner: 'my-plugin-controls',  // for live unregister on deactivation
        onClick: ( win ) => {
            console.log( 'info clicked on', win.id );
        },
    } );
} );
```

The `owner` field is the WP script handle. Deactivation drops every control with this owner without F5.

## Recipe 5 — Hide a built-in globally

```js
wp.desktop.unregisterWindowControl( 'core/focus-tab' );
```

Re-register at any time to bring it back; the registry is a Map and entries replace by id.

## Recipe 6 — Move the controls cluster to the left edge

```js
wp.desktop.applyWindowControls( 'my-plugin/dashboard', {
    placement: 'left',
} );
```

Sets the `desktop-mode-window__controls--left` class on the cluster — your CSS theme can react to that for the actual layout flip.

## Recipe 7 — Mutate the resolved list with a filter

When you don't want to register or unregister, use the `desktop-mode.window.chrome.controls` filter to mutate the list at paint time:

```js
wp.hooks.addFilter(
    'desktop-mode.window.chrome.controls',
    'my-plugin/never-close-the-shop',
    ( controls, ctx ) => {
        if ( ctx.placement !== 'controls' ) return controls;
        // Hide close on the woocommerce shop window.
        if ( ctx.config.url?.includes( 'admin.php?page=wc-admin' ) ) {
            return controls.filter( ( c ) => c.id !== 'core/close' );
        }
        return controls;
    }
);
```

---

## Hooks

### PHP

| Hook | Type | Signature | Purpose |
|------|------|-----------|---------|
| `desktop_mode_window_control_script_registered` | action | `( string $handle )` | Fires after `desktop_mode_register_window_control_script()` succeeds. |
| `desktop_mode_window_control_registered` | action | `( string $id, array $entry )` | Fires after `desktop_mode_register_window_control()` stores metadata. |

### JavaScript

| Hook | Type | Signature | Purpose |
|------|------|-----------|---------|
| `desktop-mode.window.chrome.controls` | filter | `( controls, { windowId, config, placement } ) => controls` | Mutate the resolved per-placement control list. Stable. |
| `desktop-mode.window.chrome.applied` | action | `( { windowId, layer } )` | Fires after a paint completes. `layer` is `'controls'` for this layer. Stable. |

---

## API surface

| Function | Purpose |
|----------|---------|
| `wp.desktop.registerWindowControl( def )` | Register a global control. Throws on validation failure. |
| `wp.desktop.unregisterWindowControl( id )` | Drop by id. No-op if not registered. |
| `wp.desktop.listWindowControls()` | Snapshot for tooling / inspectors. |
| `wp.desktop.applyWindowControls( windowId, override )` | Per-window mutation at runtime. Pass `null` to clear. |
| `WindowConfig.appearance.controls` | Per-window declaration at registration time. |
