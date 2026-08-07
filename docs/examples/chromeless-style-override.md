# Style a specific admin page inside the iframe

Chromeless iframes load the admin page with most WordPress chrome hidden, but the page's own CSS still applies. Use `openstation_chromeless_styles` to append overrides **inside the iframe only**.

```php
<?php
/**
 * Plugin Name: Tighten Posts List Inside Desktop
 */
defined( 'ABSPATH' ) || exit;

add_action( 'openstation_chromeless_styles', function () {
    // Only applies to the iframe's chromeless request, not the parent shell.
    wp_add_inline_style(
        'os-chromeless',
        '
        body.edit-php .wp-list-table { border-radius: 6px; overflow: hidden; }
        body.edit-php .subsubsub { margin-block: 4px 8px; }
        body.upload-php #wpbody-content { padding-top: 4px; }
        '
    );
} );
```

## Why scope via a body class

The chromeless CSS is loaded into **every** iframe. WordPress adds page-specific body classes (`body.edit-php`, `body.upload-php`, etc.), which lets you scope overrides to just the page you want without polluting others.

## When to use this vs. the shell-side CSS

- **This hook** (`openstation_chromeless_styles`) — tweaks inside the iframe: a form, a list table, a sidebar, an editor canvas.
- **Your own `admin_enqueue_scripts` handler** — parent shell changes: dock styling, window chrome, wallpaper.

If in doubt: the iframe contains WordPress admin pages; the shell contains *windows* that contain iframes.

## Related

- [Hooks Reference — `openstation_chromeless_styles`](../hooks-reference.md#openstation_chromeless_styles--stable)
- [Hooks Reference — `openstation_chromeless_after`](../hooks-reference.md#openstation_chromeless_after--stable)
