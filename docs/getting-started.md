# Getting Started

Five minutes, a new dock icon, and a window that opens a custom URL.

## 1. Your plugin skeleton

Create a plugin alongside desktop-mode (anywhere under `wp-content/plugins/`):

```php
<?php
/**
 * Plugin Name: My Desktop Extension
 */
defined( 'ABSPATH' ) || exit;
```

Activate it in WP Admin → Plugins.

## 2. Check if desktop mode is active

The plugin exposes a single helper your code should use:

```php
if ( function_exists( 'wpdm_is_enabled' ) && wpdm_is_enabled() ) {
    // The current user has desktop mode on. Adapt behavior if needed.
}
```

`wpdm_is_enabled()` returns `true` only when the active user has the `wp_desktop_mode` user meta set to `'1'`. If the plugin is inactive, the function does not exist — always guard with `function_exists()`.

## 3. Add a dock item

The dock is built from the admin `$menu` global by default. To surface a purely virtual entry (one that isn't in the admin menu), filter `wp_desktop_dock_items`:

```php
add_filter( 'wp_desktop_dock_items', function ( $items ) {
    $items[] = array(
        'slug'     => 'my-extension-panel',
        'title'    => 'My Panel',
        'icon'     => 'dashicons-superhero',
        'url'      => admin_url( 'admin.php?page=my-extension' ),
        'badge'    => 0,
        'submenu'  => array(),
    );
    return $items;
} );
```

Reload the shell; the new icon appears at the end of the dock. Click it and a window opens with `admin.php?page=my-extension` inside it.

## 4. React to window events (JavaScript)

The shell dispatches CustomEvents on `document` when windows open, close, focus, or change state:

```javascript
document.addEventListener( 'wp-desktop-window-opened', function ( e ) {
    console.log( 'Opened', e.detail.windowId, e.detail.title );
} );
```

Enqueue this file only in desktop mode:

```php
add_action( 'wp_desktop_mode_init', function () {
    wp_enqueue_script(
        'my-extension-shell',
        plugin_dir_url( __FILE__ ) . 'shell.js',
        array(),
        '1.0.0',
        true
    );
} );
```

`wp_desktop_mode_init` fires inside the parent shell render — perfect for enqueueing shell-level code.

## 5. Gate by role

Block desktop mode for a specific user class:

```php
add_filter( 'wp_desktop_mode_enabled', function ( $enabled, $user_id ) {
    // Contributors stay in classic admin.
    if ( user_can( $user_id, 'contributor' ) ) {
        return false;
    }
    return $enabled;
}, 10, 2 );
```

## Where to go next

- [Hooks Reference](./hooks-reference.md) — the full filter + action list.
- [JavaScript Reference](./javascript-reference.md) — the event and `postMessage` APIs.
- [Examples](./examples/README.md) — copy-paste recipes.
