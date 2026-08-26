# Add a dock item with a badge

Adds a new "Pending Orders" icon to the dock, with a live badge showing the current count.

```php
<?php
/**
 * Plugin Name: My Order Badge
 */
defined( 'ABSPATH' ) || exit;

add_filter( 'openstation_dock_items', function ( $items ) {
    $pending = (int) get_option( 'my_pending_order_count', 0 );

    $items[] = array(
        'id'      => 'my-orders',
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

**Stable.**

Use the platform API instead of poking the DOM. The framework
exposes the same `setBadge( id, count )` shape on three rails —
**dock** (bottom), **sideDock** (Classic-layout left rail), and
**icons** (wallpaper shortcuts) — so a plugin author can fan a
count to whichever rail happens to host the tile without
branching:

```js
function setOrdersBadge( count ) {
    wp.os.dock?.setBadge?.(     'my-orders', count );
    wp.os.sideDock?.setBadge?.( 'my-orders', count );
    wp.os.icons?.setBadge?.(    'my-orders', count );
}
setOrdersBadge( 7 );
setOrdersBadge( 0 );  // clear
```

Three calls, one painted tile. The two rails that don't own the
id silently no-op — the rail that does paints, records the
override (so a live menu refresh re-applies it), and emits
exactly once.

The id is the dock item's `id`, the system tile's id, or the
desktop icon's id — same id space across rails. Idempotent:
applying the same count twice does not mutate the DOM, does not
re-emit.

### Subscribing to changes

Every change publishes on the activity bus with a `rail`
discriminator — one subscription, every rail composed:

```js
wp.os.activity.subscribe(
    'os/badge-changed',
    ( { itemId, count, rail } ) => {
        console.log( `${ rail }:${ itemId } → ${ count }` );
    },
);
```

Per-rail hooks are also available for callers that only care
about one surface:

```js
// Icon rail only — also carries the previous count.
wp.os.hooks.addAction(
    wp.os.HOOKS.ICON_BADGE_CHANGED,
    'my-plugin/track-icon-badges',
    ( { iconId, count, previousCount } ) => { /* … */ },
);
```

### Apps own the "show 0 while my window is active" rule

The framework does NOT auto-suppress badges based on window
state — that decision belongs to the app. A "5 unread" badge
should hide while the inbox window is focused; a "5 failed
deploys" badge probably shouldn't. Subscribe to the relevant
window-lifecycle hook and decide for yourself:

```js
const WINDOW_ID = 'my-orders';
function repaintBadge() {
    const total  = myPlugin.getPendingCount();
    const active = wp.os.windowManager.isActive( WINDOW_ID );
    setOrdersBadge( active ? 0 : total );
}
[
    wp.os.HOOKS.WINDOW_FOCUSED,
    wp.os.HOOKS.WINDOW_BLURRED,
    wp.os.HOOKS.WINDOW_MINIMIZED,
    wp.os.HOOKS.WINDOW_RESTORED,
    wp.os.HOOKS.WINDOW_CLOSED,
    wp.os.HOOKS.WINDOW_OPENED,
].forEach( ( h ) =>
    wp.os.hooks.addAction( h, 'my-plugin/badge', ( p ) => {
        if ( p.windowId === WINDOW_ID ) repaintBadge();
    } )
);
repaintBadge();
```

For attention-grabbing animations (pulse / shake / bounce on the
tile), see
[`window-request-attention.md`](./window-request-attention.md).

## Related

- [`window-request-attention.md`](./window-request-attention.md) — pulse / shake / bounce a tile
- [`../event-driven-framework.md`](../event-driven-framework.md) — the mental model
- [Hooks Reference — `openstation_dock_items`](../hooks-reference.md#openstation_dock_items--stable)
- [Hooks Reference — `openstation_dock_item`](../hooks-reference.md#openstation_dock_item--stable)
