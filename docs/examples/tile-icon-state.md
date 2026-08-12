# Give a tile two icons, one per state

Some tiles don't count anything. They mean something different depending on what
state the app is in, and the clearest way to say so is to draw the object
differently.

The Recycle Bin is the in-tree case: an empty bin and a bin holding something are
two drawings of one object. It used to carry a count badge instead, and the pill
sits *on* the artwork rather than beside it, so at the smallest dock size it
covered about a third of the icon it was annotating. A tile that changes shape
says the same thing in space the icon already owns.

Reach for `setArt` when the answer to "what does this tile mean right now?"
changes. Reach for [`setBadge`](./dock-badge.md) when the answer to "how many?"
changes.

## Register the tile with its resting icon

```php
<?php
/**
 * Plugin Name: My Sync Status
 */
defined( 'ABSPATH' ) || exit;

add_filter( 'openstation_dock_items', function ( $items ) {
    $items[] = array(
        'id'      => 'my-sync',
        'title'   => __( 'Sync', 'my-ext' ),
        'icon'    => my_sync_icon_svg_uri( false ),
        'url'     => admin_url( 'admin.php?page=my-sync' ),
        'badge'   => 0,
        'submenu' => array(),
    );

    return $items;
} );
```

Ship **both** drawings to the page, so switching between them is a local swap
rather than a round trip:

```php
add_filter( 'openstation_shell_config', function ( $config ) {
    $config['mySyncIconIdle']    = my_sync_icon_svg_uri( false );
    $config['mySyncIconRunning'] = my_sync_icon_svg_uri( true );
    return $config;
} );
```

## Swapping it live

**Stable.**

`setArt( id, svg )` is the same shape on all three rails: **dock** (bottom),
**sideDock** (Classic-layout left rail), and **icons** (wallpaper shortcuts).
Fan it to all three and let whichever one hosts the tile do the painting:

```js
function paintSyncState( isRunning ) {
    const cfg = window.openStationConfig;
    const art = isRunning ? cfg.mySyncIconRunning : cfg.mySyncIconIdle;

    wp.os.dock?.setArt?.(     'my-sync', art );
    wp.os.sideDock?.setArt?.( 'my-sync', art );
    wp.os.icons?.setArt?.(    'my-sync', art );
}

paintSyncState( true );
wp.os.icons?.setArt?.( 'my-sync', '' );  // back to the registered icon
```

`svg` takes any shape a registered icon takes: a `data:` URI, an `http(s)` URL,
or a dashicon class. Art drawn in `currentColor` is painted as a mask and follows
the tile's own glyph colour, so one drawing works on the dark dock, on a light
title bar, and under a desktop theme that recolours the slot.

Four things worth knowing:

- **Setting art before the tile renders is fine, and normal.** The rails append
  system tiles asynchronously, so a call during boot usually beats the tile into
  existence. The value is recorded and applied when the tile appears.
- **It survives a live menu refresh.** The rails re-apply the override after a
  rebuild, so a plugin activation elsewhere on the site doesn't silently revert
  the swap.
- **`wp.os.icons.setArt` covers both desktop layouts.** Classic renders the
  `.os-icons` grid, Spatial renders an `<os-tile>` placement. You ask for "the
  desktop icon for this id" and get whichever is on screen.
- **`''` restores the registered icon**, immediately, the way `setBadge( id, 0 )`
  removes a pill immediately.

Same id space as the badge surface: a dock item's `id`, a system tile's id, or a
desktop icon's id. Idempotent on the icon rail, and a silent no-op on a rail that
doesn't own the id.

### Subscribing to changes

```js
wp.os.activity.subscribe(
    'os/art-changed',
    ( { itemId, icon, rail } ) => {
        console.log( `${ rail }:${ itemId } → ${ icon.slice( 0, 32 ) }` );
    },
);
```

`wp.os.icons.getArt( id )` reads the current override back, or `''` when the
registered icon is still in charge.

### State is not a notification

A badge is a message to the user, so hiding it while they're looking at the
window it points to is often right. An icon describing an object is not a
message, and suppressing it would just be inaccurate. A bin drawn empty while
it's holding something is wrong whether or not you're looking at the bin.

So `setArt` has no equivalent of the "show 0 while my window is active" recipe in
[`dock-badge.md`](./dock-badge.md). Paint the state the object is actually in.

## Related

- [`dock-badge.md`](./dock-badge.md), counts rather than states
- [`../event-driven-framework.md`](../event-driven-framework.md), the mental model
- [JavaScript Reference, `setArt`](../javascript-reference.md#setart--stable)
- In-tree: [`src/recycle-bin/icon-state.ts`](../../src/recycle-bin/icon-state.ts)
