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

The dock reads `badge` at render time, so it only changes on shell reload. To push live updates, dispatch a custom message from your shell-side JS and have the dock re-render. That API is planned — for now, rely on a page refresh or a short `setInterval` in your own code that manipulates the DOM under `#wp-desktop-dock`.

## Related

- [Hooks Reference — `desktop_mode_dock_items`](../hooks-reference.md#desktop_mode_dock_items--stable)
- [Hooks Reference — `desktop_mode_dock_item`](../hooks-reference.md#desktop_mode_dock_item--stable)
