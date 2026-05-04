# Native window with bundle-bound config

**Status:** Stable (since 0.6.0)

Most non-trivial native windows need session-bound config — REST URLs, an
auth nonce, capability flags. This page shows the recommended way to ship
that config to your bundle so it lands reliably on **both** the eager and
lazy load paths.

## Why a dedicated mechanism

Desktop Mode lazy-loads native-window scripts on mid-session plugin
activation by appending a raw `<script src="…">` tag to the document
head. That bypasses `wp_print_scripts()` entirely, which means data
attached to the handle via `wp_localize_script` /
`wp_add_inline_script` / `wp_set_script_translations` would be silently
dropped on the lazy path. Since 0.6.0 the shell harvests that data into
the payload and re-injects it inline alongside the lazy `<script>` tag,
preserving the standard WordPress contract — but the `'config'` arg
below is the discoverable, supported way to ship config and is the one
we recommend for new windows.

## Recipe — `'config'` arg on `desktop_mode_register_window`

```php
<?php
add_action( 'init', function () {
    wp_register_script(
        'my-plugin-cron',
        plugin_dir_url( __FILE__ ) . 'assets/js/cron.min.js',
        array( 'wp-i18n', 'desktop-mode' ),
        '1.0.0',
        true
    );
}, 20 );

add_action( 'init', function () {
    if ( ! current_user_can( 'manage_options' ) ) {
        return;
    }

    desktop_mode_register_window( 'my-plugin/cron', array(
        'title'    => __( 'Cron Jobs', 'my-plugin' ),
        'icon'     => 'dashicons-clock',
        'template' => 'my_plugin_render_cron_template',
        'script'   => 'my-plugin-cron',
        // Anything serializable. Lands on both eager AND lazy
        // load paths — no admin-template hooks required.
        'config'   => array(
            'restNonce'    => wp_create_nonce( 'wp_rest' ),
            'eventsUrl'    => esc_url_raw( rest_url( 'my-plugin/v1/events' ) ),
            'schedulesUrl' => esc_url_raw( rest_url( 'my-plugin/v1/schedules' ) ),
        ),
    ) );
}, 20 );
```

In the bundle:

```js
( function () {
    const cfg = wp.desktop.getWindowConfig( 'my-plugin/cron' );
    if ( ! cfg ) {
        // Plugin not registered (capability gate, hook order, etc.) —
        // bail rather than throwing.
        return;
    }

    window.desktopModeNativeWindows ??= {};
    window.desktopModeNativeWindows[ 'my-plugin/cron' ] = ( body ) => {
        const events = await fetch( cfg.eventsUrl, {
            headers: { 'X-WP-Nonce': cfg.restNonce },
        } ).then( ( r ) => r.json() );

        // … render `events` into `body` …
    };
} )();
```

## When to use `wp_localize_script` instead

If you already attach config via `wp_localize_script( $handle, $name, $data )`
on a handle declared as `'script'` of `desktop_mode_register_window()`,
that path also lands on both eager and lazy since 0.6.0 — the shell
harvests the handle's `extra` data into the payload and re-injects it
before the lazy `<script>` tag. So `wp_localize_script` keeps working,
but the new `'config'` arg is more discoverable and avoids the
"localized variable name" bookkeeping.

## Debugging

When you suspect config didn't reach the page, ask the framework
directly:

```js
wp.desktop.debug.window( 'my-plugin/cron' )
// → { id, scriptHandle, scriptUrl, loadPath: 'eager'|'lazy'|'unknown',
//     tagInDom, configPresent, extras: { … } }
```

`loadPath` tells you whether the script came in eagerly via
`wp_print_scripts` or lazily via `loadVendorScript`. `configPresent`
reflects whether `window.desktopModeWindowConfig[ id ]` is set. `extras`
counts the inline snippets the shell injected for you.

## See also

- [`docs/examples/native-windows.md`](native-windows.md) — the bare
  registration recipe (no config).
- [`docs/architecture.md`](../architecture.md) — the lazy vs eager
  load-path contract.
- [`docs/javascript-reference.md`](../javascript-reference.md) — the
  full `wp.desktop.*` surface.
