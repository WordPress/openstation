# React to window events

Log every window open/close/focus, and re-focus a specific window if the user opens a conflicting one.

## Plugin file

```php
<?php
/**
 * Plugin Name: Desktop Window Logger
 */
defined( 'ABSPATH' ) || exit;

add_action( 'desktop_mode_mode_init', function () {
    wp_enqueue_script(
        'desktop-window-logger',
        plugin_dir_url( __FILE__ ) . 'logger.js',
        array(),
        '1.0.0',
        true
    );
} );
```

## `logger.js`

```javascript
document.addEventListener( 'desktop-mode-init', function () {
    console.log( 'desktop ready' );

    document.addEventListener( 'desktop-mode-window-opened', ( e ) => {
        console.log( 'opened', e.detail );
    } );

    document.addEventListener( 'desktop-mode-window-closed', ( e ) => {
        console.log( 'closed', e.detail );
    } );

    document.addEventListener( 'desktop-mode-window-focused', ( e ) => {
        console.log( 'focused', e.detail );
    } );
} );
```

## Reacting — open a helper window whenever Posts is focused

```javascript
document.addEventListener( 'desktop-mode-window-focused', function ( e ) {
    if ( e.detail.windowId !== 'wp-window-edit-php' ) {
        return;
    }
    // Open a companion analytics window if it's not already up.
    const mgr = window.wp.desktop.windowManager;
    if ( ! mgr.getById( 'my-ext-analytics' ) ) {
        mgr.open( {
            id:    'my-ext-analytics',
            url:   '/wp-admin/admin.php?page=my-analytics',
            title: 'Analytics',
            icon:  'dashicons-chart-bar',
        } );
    }
} );
```

## Notes

- Listeners attached on `document` continue to fire as long as desktop mode is up. No cleanup needed unless your plugin deactivates in-place.
- `desktop-mode-init` is dispatched **once**. If your code loads after it has already fired, attach directly; the `window.wp.desktop` API is already there by then.
- `desktop-mode-window-changed` is **experimental** and chatty (geometry + state). Prefer the individual `opened`/`closed`/`focused` events for external integrations.

## Related

- [JavaScript Reference — CustomEvents](../javascript-reference.md#1-customevents)
- [JavaScript Reference — `window.wp.desktop` API](../javascript-reference.md#2-windowwpdesktop-api)
