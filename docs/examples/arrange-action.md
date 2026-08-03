# Custom arrange-menu action

Add a button to the admin bar's **Arrange** dropdown that runs your own layout algorithm. The shell ships Cascade / Overview / Snap / Tile; your item sits alongside them with identical styling.

The contract is a PHP filter (to register the menu item) plus a JS action (to run when the user clicks it). The two halves are decoupled — you can ship a plugin that registers the item without a JS callback, and some other code can subscribe to `os.arrange.custom-action` independently.

## PHP: register the item

```php
<?php
/**
 * Plugin Name: Diagonal Cascade
 */
defined( 'ABSPATH' ) || exit;

add_filter( 'open_station_arrange_menu_items', function ( $items ) {
    $items[] = array(
        'id'          => 'diagonal',
        'title'       => __( 'Diagonal cascade', 'diagonal-cascade' ),
        'description' => __( 'Lay windows on a 45° line from the top-left.', 'diagonal-cascade' ),
        'position'    => 15, // optional: default 10 → items sort after built-ins
    );
    return $items;
} );

// Enqueue your JS on the desktop shell. `openstation` is the shell's
// main script handle; adding it as a dep guarantees `window.wp.os`
// is populated by the time your code runs.
add_action( 'admin_enqueue_scripts', function () {
    if ( ! function_exists( 'open_station_is_enabled' ) || ! open_station_is_enabled() ) {
        return;
    }
    wp_enqueue_script(
        'diagonal-cascade',
        plugin_dir_url( __FILE__ ) . 'diagonal-cascade.js',
        array( 'openstation', 'wp-hooks' ),
        '1.0.0',
        true
    );
} );
```

## JS: run the arrangement

```js
// diagonal-cascade.js
( function () {
    wp.os.whenReady( function () {
        wp.os.hooks.addAction(
            'os.arrange.custom-action',
            'diagonal-cascade/apply',
            function ( payload ) {
                if ( payload.id !== 'diagonal' ) {
                    return;
                }
                var windows = wp.os.windowManager.getAll()
                    .filter( function ( w ) {
                        return w.state !== 'minimized';
                    } );
                windows.forEach( function ( w, i ) {
                    var offset = i * 60;
                    w.element.style.left = 40 + offset + 'px';
                    w.element.style.top  = 40 + offset + 'px';
                } );
            }
        );
    } );
} )();
```

## What you get

- A new "Diagonal cascade" entry in the **Arrange** submenu, styled identically to the built-ins.
- Clicking it fires `os.arrange.custom-action` with `{ id: 'diagonal' }`.
- Your subscriber runs the arrangement. Any other plugin can also subscribe (e.g. to play a sound, log analytics, etc.).

## Using typed hook constants

If your plugin is TS:

```ts
import { HOOKS } from 'openstation';

wp.os.hooks.addAction(
    HOOKS.ARRANGE_CUSTOM_ACTION,
    'diagonal-cascade/apply',
    ( payload: { id: string } ) => { /* ... */ }
);
```

## Related

- [`open_station_arrange_menu_items` filter](../hooks-reference.md#open_station_arrange_menu_items--stable) — full filter signature, field validation rules, position sorting.
- [`os.arrange.*` action family](../javascript-reference.md#arrange--overview) — `cascade.starting`, `cascade.applied`, `tile.*`, `snap.changed`, `custom-action`.
