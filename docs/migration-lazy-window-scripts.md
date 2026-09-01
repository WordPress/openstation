# Migration: window, wallpaper and widget bundles load on demand

**Who this affects:** plugins whose native-window bundle does something at script-load time *other* than publish its render callback — installs an API on `wp.os`, starts a poller, subscribes to a shell hook, registers a dock decoration.

**Who it does not:** the overwhelming majority. A bundle that ends in

```js
window.openStationNativeWindows[ 'my-plugin/inbox' ] = ( body, ctx ) => { … };
```

and does nothing else needs no change at all. Neither does a wallpaper registered with `openstation_register_wallpaper()`, a widget registered with `openstation_register_widget()`, nor any plugin that only *opens* windows.

## What changed

Every registered native window's script used to be enqueued on every admin page the shell rendered, and every registered wallpaper's and widget's script alongside it. On a stock install that was well over a megabyte of JavaScript — WP Explorer, Posts, Plugins, Comments, the Recycle Bin, Content Graph, Games, the agent runner, Living Tree, Snow, nine desktop widgets — downloaded and parsed before the user had clicked anything, for windows most sessions never open, wallpapers most users are not wearing, and widgets most desktops don't show.

Now:

- **A native window's `script` loads the first time that window opens.** The shell reads the render callback off `window.openStationNativeWindows[ <id> ]` *after* the load, which is why nothing is required of an ordinary bundle. The window shows its declared `<template>` immediately and its loading spinner covers the fetch.
- **A canvas wallpaper's script loads when the wallpaper is applied, or when the user opens the wallpaper picker.** The shell registers a metadata-only stub from the payload — label, preview swatch, description — so the picker paints a tile with no bundle in the tab.
- **A widget's script loads when the widget mounts.** Its def is assembled entirely from `openstation_register_widget()`'s metadata; the bundle's only contribution is `mount`. An enabled widget still appears in the same beat as before, because `mountIfEnabled()` runs immediately after registration.

Delivery is otherwise identical. `wp_localize_script`, `wp_add_inline_script` and `wp_set_script_translations` data is harvested off the registered handle into the boot payload and replayed as inline `<script>` tags around the injected `<script src>`, in `wp_print_scripts` order. The `'config'` arg keeps working on both paths.

## What to do

### If your bundle only publishes a render callback

Nothing.

### If your bundle also has a boot-time job

Two options, in order of preference.

**1. Split it.** Move the always-on part into its own small bundle enqueued the normal way, and leave the window's UI in the window's bundle. This is what the shell does for the Recycle Bin: the dock-tile state poller lives in the always-loaded shell bundle, and the 83 KB window bundle waits for a click.

**2. Opt out.** Declare `preload_script` and the bundle is enqueued at boot exactly as before:

```php
openstation_register_window( 'my-plugin/inbox', array(
    'title'          => 'Inbox',
    'template'       => 'my_plugin_inbox_template',
    'script'         => 'my-plugin-inbox',
    'preload_script' => true,
) );
```

This costs every admin page the full weight of the bundle. It is the right call when the job genuinely cannot be split, and the wrong one when it can.

### If your bundle extends *another* plugin's window

Declare it as a companion of that window rather than enqueueing it. Companions load in order immediately before the window's own script, so your subscriptions are in place before its render callback paints:

```php
add_filter( 'openstation_my_wordpress_window_args', function ( $args ) {
    $args['scripts'][] = 'my-plugin-explorer-extras';
    return $args;
} );
```

(That filter is WP Explorer's; every window that ships one exposes the same shape. A window you own takes `'scripts' => array( … )` directly.)

A stylesheet that only paints surfaces inside the window travels the same way, through `'styles'` — injected on the window's first open, after the window's own `style`, so its equal-specificity overrides win by source order. Without it, the sheet has to be enqueued eagerly, which stamps it into every admin document (chromeless iframes included) where it can style nothing:

```php
add_filter( 'openstation_my_wordpress_window_args', function ( $args ) {
    $args['scripts'][] = 'my-plugin-explorer-extras';
    $args['styles'][]  = 'my-plugin-explorer-extras';
    return $args;
} );
```

The in-tree example is `my-wordpress-woocommerce`, which hooks WP Explorer's `preview-extras` / `group-extras` actions. It used to be enqueued on every admin page of every WooCommerce store; the bundle and its stylesheet now ride the window they extend.

### If you call an API another window's bundle publishes

Load it first:

```js
await wp.os.loadWindowScript( 'desktop-mode-agent-run' );
// …then read the API that bundle publishes on `wp.os`.
```

## How to tell which path a window took

`wp.os.debug.window( id )` reports the resolved handle, URL, and `loadPath` (`'eager'` | `'lazy'` | `'unknown'`). In DevTools, a deferred bundle appears in the network log at the moment its window opens rather than at page load.

## Related

- [`architecture.md`](./architecture.md#when-a-windows-bundle-loads--and-what-gets-injected) — the full delivery model.
- [`hooks-reference.md`](./hooks-reference.md#registration-functions) — `script`, `scripts`, `styles`, `preload_script`.
- [`javascript-reference.md`](./javascript-reference.md#wposloadwindowscript-id---stable) — `wp.os.loadWindowScript`.
