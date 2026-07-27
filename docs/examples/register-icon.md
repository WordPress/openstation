# Example: register a desktop icon (Jorvy)

A one-PHP-file companion plugin that puts a shortcut tile on the desktop wallpaper. Clicking the tile opens a native window showing a random Marvel quote. Modeled after `hello.php` — the whole plugin is under 60 lines of PHP plus a small JS render callback.

## The plugin

`jorvy/jorvy.php`:

```php
<?php
/**
 * Plugin Name: Jorvy
 * Description: A random Marvel quote lives on your desktop.
 */

defined( 'ABSPATH' ) || exit;

// 1. The native window — a small panel the shell renders into.
desktop_mode_register_window( 'jorvy', array(
    'title'    => __( 'Jorvy', 'jorvy' ),
    'icon'     => 'dashicons-star-filled',
    'width'    => 320,
    'height'   => 180,
    'script'   => 'jorvy-desktop',
    // Optional: associate a registered style handle with the window.
    // The shell injects a `<link rel="stylesheet">` for it on
    // mid-session activation — without this, a peer plugin activated
    // from inside an open shell renders its window with no CSS until
    // the user reloads, because `wp_print_styles` already ran for the
    // parent shell page.
    'style'    => 'jorvy-desktop',
    'template' => function () {
        ?>
        <div class="jorvy">
            <p class="jorvy__quote"></p>
            <cite class="jorvy__attr"></cite>
        </div>
        <?php
    },
) );

// 2. The shortcut tile on the wallpaper — clicking it opens the
//    registered native window (matched by id).
desktop_mode_register_icon( 'jorvy', array(
    'title'    => __( 'Jorvy', 'jorvy' ),
    'icon'     => 'dashicons-star-filled',
    'window'   => 'jorvy',
    'position' => 10,
) );

// 3. The render script — declares itself on
//    `window.desktopModeNativeWindows[ 'jorvy' ]` so the shell can
//    invoke it when the window opens.
add_action( 'admin_enqueue_scripts', function () {
    if ( ! function_exists( 'desktop_mode_is_enabled' ) || ! desktop_mode_is_enabled() ) {
        return;
    }
    wp_enqueue_script(
        'jorvy-desktop',
        plugin_dir_url( __FILE__ ) . 'jorvy-desktop.js',
        array( 'desktop-mode' ),
        '1.0.0',
        true
    );
    // Match: register the style handle named in `'style' => …` above.
    // `wp_register_style` is enough — `desktop_mode_register_window()`
    // resolves the handle on its own; the shell decides whether to
    // print it at boot or lazy-inject it mid-session.
    wp_register_style(
        'jorvy-desktop',
        plugin_dir_url( __FILE__ ) . 'jorvy-desktop.css',
        array(),
        '1.0.0'
    );
} );
```

`jorvy/jorvy-desktop.js`:

```js
( function () {
    const QUOTES = [
        { q: 'I am Iron Man.', by: 'Tony Stark, Iron Man' },
        { q: 'Hulk smash.', by: 'Bruce Banner, The Avengers' },
        { q: 'I love you 3000.', by: 'Morgan Stark, Endgame' },
        { q: 'On your left.', by: 'Captain America' },
    ];
    function pick() { return QUOTES[ Math.floor( Math.random() * QUOTES.length ) ]; }

    window.desktopModeNativeWindows = window.desktopModeNativeWindows || {};
    window.desktopModeNativeWindows.jorvy = function ( body ) {
        const q = body.querySelector( '.jorvy__quote' );
        const a = body.querySelector( '.jorvy__attr' );
        const render = () => {
            const { q: text, by } = pick();
            q.textContent = '"' + text + '"';
            a.textContent = '— ' + by;
        };
        render();
        const timer = setInterval( render, 10000 );
        return () => clearInterval( timer );
    };
} )();
```

## What each call buys you

### `desktop_mode_register_window( $id, $args )`

Declares the native window — its title, icon, initial dimensions, template markup, and render script. Returns `true` on success, `WP_Error` on any validation failure (missing `title`, non-callable `template`, unmet capability). `script` is optional — omit it for a purely declarative window whose body is exactly the cloned template.

### `desktop_mode_register_icon( $id, $args )`

Drops a clickable tile on the wallpaper at the `position` you specify (lower numbers render top-left). The `window` key must match the id of a registered native window; the alternative is `url` (either a same-origin admin URL that opens as an iframe window, or an off-site URL that opens in a new browser tab). Mutually exclusive.

### Picking an icon — four shapes

The `icon` arg accepts three formats. A fourth (`icon_svg`) is a convenience wrapper that produces the third for you.

```php
// 1. Dashicons class — simplest, best for built-in glyphs.
'icon' => 'dashicons-star-filled',

// 2. http(s) URL to an image asset — useful for plugin-hosted PNGs / SVGs.
'icon' => plugin_dir_url( __FILE__ ) . 'assets/jorvy.svg',

// 3. data:image/svg+xml URI — inline SVG, base64 or URL-encoded.
'icon' => 'data:image/svg+xml;base64,' . base64_encode( '<svg …>…</svg>' ),

// 4. icon_svg shorthand — pass raw SVG and the framework
//    encodes it for you. Wins over `icon` when both are given.
'icon_svg' => file_get_contents( __DIR__ . '/assets/jorvy.svg' ),
```

The shared sanitizer rejects `javascript:` URIs and any non-`image/svg+xml` `data:` scheme. SVG markup with an embedded `<script>` tag is rejected outright when passed via `icon_svg` (defence-in-depth — browsers also sandbox scripts inside `<img src="data:…">` SVGs, but we belt-and-braces). All four forms run through `desktop_mode_sanitize_dock_icon`, so a malformed value silently falls back to `dashicons-admin-generic`.

### Pinning a system icon

Pass `pinned => true` for built-in shortcuts that should always sit in the same place. Pinned icons render before any unpinned icon regardless of `position`, and the framework treats them as non-draggable surface — useful for "always there" launchers like the in-tree **My WordPress** folder.

```php
desktop_mode_register_icon( 'my-wordpress', array(
    'title'    => __( 'My WordPress', 'desktop-mode' ),
    'icon'     => 'dashicons-wordpress',
    'window'   => 'desktop-mode-my-wordpress',
    'pinned'   => true,
    'position' => -1, // sort below pinned siblings if you ever add more
) );
```

The flag is intentionally minimal — there is no "lock" persistence layer. Reserve it for shortcuts that are part of the desktop's identity, not user content.

### The render script

Native windows render in JS because a `render( body )` callback can't cross the PHP→client wire. The script declares its render function on `window.desktopModeNativeWindows[ <id> ]`; the shell invokes it when the window opens and captures the return value as a teardown (interval cleanup, DOM detach, whatever the plugin needs).

**The body comes pre-populated.** Before invoking the callback, the shell clones the registered `template` into the window body — so `body.querySelector( '.jorvy__quote' )` returns the `<p>` declared in the PHP template above, with no manual cloning. Render callbacks are pure enhancement: query the mount points your template declared, light them up. To start from a blank canvas anyway, call `body.replaceChildren()` first.

## Confirming it worked

1. Activate the plugin at **Plugins → Jorvy**.
2. Enable desktop mode via the admin-bar toggle.
3. A star icon labeled *Jorvy* appears on the wallpaper.
4. Click it — the Marvel-quote panel opens; the quote rotates every ten seconds.
5. Check the action history: `desktop_mode_native_window_registered` and `desktop_mode_icon_registered` each fired once.

## Error handling

If you want to see the error path in action, comment out the `'title'` argument in the icon registration and watch the error log:

```
[jorvy] registration failed: desktop_mode_missing_title — Desktop icon registration requires a non-empty `title`.
```

The `WP_Error` contract means you find typos at plugin-load time, not at first-click time.

## Decorating the rendered grid

When you need to enhance the wallpaper icons themselves — a cursor adornment, a status dot, a drag handle — subscribe to `HOOKS.DESKTOP_ICONS_RENDERED`. The payload hands you the rendered container *and* a map of `id → tile element`, so your decorator doesn't have to query the DOM (and doesn't have to re-query on every live menu refresh — the hook fires exactly when the grid is rebuilt):

```js
wp.desktop.hooks.addAction(
    wp.desktop.HOOKS.DESKTOP_ICONS_RENDERED,
    'my-plugin/icon-status-dot',
    ( payload ) => {
        const { ids, container, tiles } = payload;
        if ( ! ids.includes( 'jorvy' ) ) {
            return;
        }
        const tile = tiles.get( 'jorvy' );
        if ( ! tile ) {
            return;
        }
        const dot = document.createElement( 'span' );
        dot.className = 'my-plugin__status-dot';
        tile.appendChild( dot );
        // `container` is the <div class="desktop-mode-icons"> grid root —
        // use it if your decoration spans multiple tiles (a connector
        // line, a hover halo) instead of decorating a single tile.
    }
);
```

The hook is suppressed when the rendered DOM is unchanged (fingerprint short-circuit), so decorators run exactly when the grid actually rebuilds — not on every live menu refresh.

## See also

- [`desktop_mode_register_window()`](../hooks-reference.md#registration-functions) — full argument reference and error-code table.
- [`desktop_mode_icon_registered`](../hooks-reference.md#desktop_mode_icon_registered--stable) — the post-registration action.
- [`desktop_mode_icons`](../hooks-reference.md#desktop_mode_icons--stable) — filter for hiding/reordering icons registered by others.
