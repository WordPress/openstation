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
    // parent shell page. @since 0.18.1
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
//    `window.wpDesktopNativeWindows[ 'jorvy' ]` so the shell can
//    invoke it when the window opens.
add_action( 'admin_enqueue_scripts', function () {
    if ( ! function_exists( 'desktop_mode_is_enabled' ) || ! desktop_mode_is_enabled() ) {
        return;
    }
    wp_enqueue_script(
        'jorvy-desktop',
        plugin_dir_url( __FILE__ ) . 'jorvy-desktop.js',
        array( 'wp-desktop' ),
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

    window.wpDesktopNativeWindows = window.wpDesktopNativeWindows || {};
    window.wpDesktopNativeWindows.jorvy = function ( body ) {
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

Declares the native window — its title, icon, initial dimensions, template markup, and render script. Returns `true` on success, `WP_Error` on any validation failure (missing `title`, missing `script`, non-callable `template`, unmet capability).

### `desktop_mode_register_icon( $id, $args )`

Drops a clickable tile on the wallpaper at the `position` you specify (lower numbers render top-left). The `window` key must match the id of a registered native window; the alternative is `url` (either a same-origin admin URL that opens as an iframe window, or an off-site URL that opens in a new browser tab). Mutually exclusive.

### The render script

Native windows render in JS because a `render( body )` callback can't cross the PHP→client wire. The script declares its render function on `window.wpDesktopNativeWindows[ <id> ]`; the shell invokes it when the window opens and captures the return value as a teardown (interval cleanup, DOM detach, whatever the plugin needs).

**The body comes pre-populated.** Before invoking the callback, the shell clones the registered `template` into the window body — so `body.querySelector( '.jorvy__quote' )` returns the `<p>` declared in the PHP template above, with no manual cloning. Render callbacks are pure enhancement: query the mount points your template declared, light them up. To start from a blank canvas anyway, call `body.replaceChildren()` first.

## Confirming it worked

1. Activate the plugin at **Plugins → Jorvy**.
2. Enable desktop mode via the admin-bar toggle.
3. A star icon labeled *Jorvy* appears on the wallpaper.
4. Click it — the Marvel-quote panel opens; the quote rotates every ten seconds.
5. Check the action history: `desktop_mode_window_registered` and `desktop_mode_icon_registered` each fired once.

## Error handling

If you want to see the error path in action, comment out the `'title'` argument in the icon registration and watch the error log:

```
[jorvy] registration failed: desktop_mode_missing_title — Desktop icon registration requires a non-empty `title`.
```

The `WP_Error` contract means you find typos at plugin-load time, not at first-click time.

## See also

- [`desktop_mode_register_window()`](../hooks-reference.md#registration-functions) — full argument reference and error-code table.
- [`desktop_mode_icon_registered`](../hooks-reference.md#desktop_mode_icon_registered--stable) — the post-registration action.
- [`desktop_mode_icons`](../hooks-reference.md#desktop_mode_icons--stable) — filter for hiding/reordering icons registered by others.
