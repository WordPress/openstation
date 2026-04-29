# Add a dock item with a badge

Adds a new "Pending Orders" icon to the dock, with a live badge showing the current count.

```php
<?php
/**
 * Plugin Name: My Order Badge
 */
defined( 'ABSPATH' ) || exit;

add_filter( 'desktop_mode_dock_items', function ( $items ) {
    $pending = (int) get_option( 'my_pending_order_count', 0 );

    $items[] = array(
        'slug'    => 'my-orders',
        'title'   => __( 'Orders', 'my-ext' ),
        'icon'    => 'dashicons-cart',
        'url'     => admin_url( 'admin.php?page=my-orders' ),
        'badge'   => $pending,         // 0 hides the badge
        'submenu' => array(),
    );

    return $items;
} );
```

## Updating the badge live (without a refresh)

**Stable** — shipped 0.22.0.

Use the platform API instead of poking the DOM:

```js
wp.desktop.dock?.setBadge( 'my-orders', 7 );
wp.desktop.taskbar?.setBadge( 'my-orders', 7 );  // if it lives on the bottom rail
wp.desktop.dock?.clearBadge( 'my-orders' );      // shorthand for setBadge( id, 0 )
```

The id is the dock item's `slug` (or, for system tiles registered
via `wp.desktop.registerSystemTile()`, the system id). Idempotent —
applying the same count twice does not mutate the DOM.

Both methods fire `wpd-dock-item-badge-changed` on `document` with
`{ itemId, count }` so plugins can mirror the change anywhere.

For attention-grabbing animations (pulse / shake / bounce on the
tile), see
[`window-request-attention.md`](./window-request-attention.md).

## Related

- [`window-request-attention.md`](./window-request-attention.md) — pulse / shake / bounce a tile
- [Hooks Reference — `desktop_mode_dock_items`](../hooks-reference.md#desktop_mode_dock_items--stable)
- [Hooks Reference — `desktop_mode_dock_item`](../hooks-reference.md#desktop_mode_dock_item--stable)
