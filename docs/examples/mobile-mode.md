# React to mobile / responsive mode

Available since: **0.7.0**.

The shell auto-detects mobile / tablet / desktop viewports, stamps
`data-wp-desktop-mode="…"` on `<html>`, and enforces a touch-shaped
window policy in mobile (force-maximize, no drag/resize, hidden dock,
bottom thumbnail switcher).

Plugins read the current mode via `wp.desktop.mode()` and subscribe
to flips via `wp.desktop.responsive.subscribe(fn)` or the hook bus.

## CSS-only branching

Most plugin CSS just needs to scope rules under the attribute:

```css
.my-plugin-sidebar {
    width: 320px;
}

html[data-wp-desktop-mode="mobile"] .my-plugin-sidebar {
    width: 100%;
    border-radius: 0;
}
```

## JS-side branching

```js
wp.desktop.ready( () => {
    if ( wp.desktop.mode() === 'mobile' ) {
        myPlugin.collapseSidebar();
    }

    wp.desktop.responsive.subscribe( ( mode ) => {
        document.documentElement.dataset.myAppLayout = mode;
    } );

    // Or via the action hook for plugin authors already on the bus:
    wp.desktop.hooks.addAction(
        wp.desktop.HOOKS.RESPONSIVE_MODE_CHANGED,
        'myplugin/responsive',
        ( { from, to, viewport } ) => {
            console.log( `flipped ${ from } → ${ to } @ ${ viewport.width }px` );
        }
    );
} );
```

## Force a mode (testing / power-user override)

```js
// Pin desktop layout regardless of viewport.
wp.desktop.responsive.override( 'desktop' );

// Resume viewport-driven detection.
wp.desktop.responsive.override( null );
```

The override is in-memory only — refresh restores the probe-driven
default. If you need a persistent "always desktop on this device"
preference, store the flag in your plugin's user-meta and re-apply
on every page load.

## Re-tune breakpoints (server-side)

```php
add_filter( 'desktop_mode_responsive_breakpoints', function ( $bp ) {
    $bp['mobile'] = 720; // treat 720px and below as mobile
    return $bp;
} );
```

## Veto drag / resize for a specific window

The mobile module already returns `false` for these filters when the
mode is `'mobile'`. Plugins can layer additional vetoes — e.g. while
a custom modal is showing inside a window:

```js
wp.desktop.hooks.addFilter(
    wp.desktop.HOOKS.WINDOW_DRAG_ALLOWED,
    'myplugin/lock-during-modal',
    ( allowed, { windowId } ) => (
        allowed && ! myPlugin.isModalOpen( windowId )
    )
);
```

## Replace the bottom switcher tile list

```js
wp.desktop.hooks.addFilter(
    'desktop_mode_mobile_app_switcher',
    'myplugin/highlight-active',
    ( windows ) => {
        // Move the focused window to the front of the strip.
        const focused = wp.desktop.windowManager.getFocused();
        if ( ! focused ) return windows;
        return [
            focused,
            ...windows.filter( ( w ) => w.id !== focused.id ),
        ];
    }
);
```
