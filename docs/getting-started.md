# Getting Started

Five minutes, a new dock icon, and a window that opens a custom URL.

## 1. Your plugin skeleton

Create a plugin alongside OpenStation (anywhere under `wp-content/plugins/`):

```php
<?php
/**
 * Plugin Name: My Desktop Extension
 */
defined( 'ABSPATH' ) || exit;
```

Activate it in WP Admin → Plugins.

## 2. Check if OpenStation is active

The plugin exposes a single helper your code should use:

```php
if ( function_exists( 'openstation_is_enabled' ) && openstation_is_enabled() ) {
    // The current user has OpenStation on. Adapt behavior if needed.
}
```

`openstation_is_enabled()` returns `true` only when the active user has the `desktop_mode_mode` user meta set to `'1'`. If the plugin is inactive, the function does not exist — always guard with `function_exists()`.

## 3. Add a dock item

The dock is built from the admin `$menu` global by default. To surface a purely virtual entry (one that isn't in the admin menu), filter `openstation_dock_items`:

```php
add_filter( 'openstation_dock_items', function ( $items ) {
    $items[] = array(
        'id'       => 'my-extension-panel',
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

## 4. Make HTTP calls — `wp.os.fetch`

Every HTTP call from a OpenStation plugin should route through the framework helper instead of native `fetch()`. Doing so lights up the active window's title-bar **modem activity dot** for free, attributes the request to the activity bus (so the dev panel + plugin observers see it), and flashes red on failure with the error message exposed as the dot's tooltip.

```javascript
const res = await wp.os.fetch( '/wp-json/myplugin/v1/save', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': nonce },
    body:    JSON.stringify( payload ),
} );
```

Same return type and resolution semantics as native `fetch()`. The third options arg attributes the request:

```javascript
wp.os.fetch( url, init, {
    windowId: 'my-plugin/inbox',  // attribute to a specific window
    silent:   true,                // background poll — don't pulse the dot
} );
```

For modules compiled into a separate Vite target (a feature bundle, an external plugin), import `trackedFetch` from `tracked-fetch`:

```typescript
import { trackedFetch } from '<…>/tracked-fetch';

await trackedFetch( '/wp-json/myplugin/v1/save', init, {
    source: 'my-plugin/save',
} );
```

`trackedFetch` finds `wp.os.fetch` at runtime and falls back to native `fetch` only during the boot window before the shell exists.

> **Lint enforces this.** Raw `fetch()` and `window.fetch()` calls fail lint. The handful of legitimate exceptions (the wrapper itself, the PWA service worker, genuinely-silent background pollers) are documented inline with `eslint-disable-next-line` comments.

See [`javascript-reference.md`](./javascript-reference.md#wpdesktopfetch-input-init-opts---stable) for the full signature.

## 5. React to window events (JavaScript)

The shell dispatches CustomEvents on `document` when windows open, close, focus, or change state:

```javascript
document.addEventListener( 'os-window-opened', function ( e ) {
    console.log( 'Opened', e.detail.windowId, e.detail.title );
} );
```

Enqueue this file only in OpenStation:

```php
add_action( 'openstation_mode_init', function () {
    wp_enqueue_script(
        'my-extension-shell',
        plugin_dir_url( __FILE__ ) . 'shell.js',
        array(),
        '1.0.0',
        true
    );
} );
```

`openstation_mode_init` fires inside the parent shell render — perfect for enqueueing shell-level code.

## 6. Gate by role

Block OpenStation for a specific user class:

```php
add_filter( 'openstation_mode_enabled', function ( $enabled, $user_id ) {
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
