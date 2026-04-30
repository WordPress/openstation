# Hooks Reference

Every PHP action and filter the plugin fires, with signatures, examples, and **implementation status**.

- **Stable** — shipping today, keep working across the current major version.
- **Experimental** — shipping, but signature may change.
- **Planned** — reserved name, not yet fired. Do not subscribe in production.

If something you need isn't here, open an issue. New hooks are welcome — our rule of thumb: *if a function decides something, wrap it in a filter; if it does something, fire an action around it.*

> **Looking for JavaScript hooks?** The browser-side shell exposes WordPress-style filters and actions via `window.wp.hooks` under the `wp-desktop.*` namespace — including hooks for wallpaper registration, window lifecycle, and the animated logo wallpaper's visibility events. See the [JavaScript Reference](./javascript-reference.md#4-hooks--wp-desktop) for the full catalog.

### PHP vs. JS hook parity

The two hook surfaces are **deliberately not mirrored** — they target different extension points:

- **PHP hooks** (this file) fire on the server: shell mount, chromeless render, dock-items composition, portal / session logic. If you're changing server-rendered state, you want PHP.
- **JS hooks** (javascript-reference.md) fire in the browser: window lifecycle, drag / resize, overview, arrange actions, wallpaper + widget mount lifecycle, virtual-desktop transitions. If you're reacting to user interaction, you want JS.

A few concepts ARE mirrored (e.g. `desktop_mode_dock_items` PHP filter ↔ `wp-desktop.widgets` JS filter — both shape registries), but most aren't. Don't be surprised if a JS hook has no PHP counterpart or vice versa — that's the design.

---

## Actions

### `desktop_mode_mode_init` — Stable
Fires once inside the parent shell render, after desktop assets have been enqueued. Use this to enqueue your own shell-side JS/CSS.

```php
do_action( 'desktop_mode_mode_init' );
```

**Example:**

```php
add_action( 'desktop_mode_mode_init', function () {
    wp_enqueue_script(
        'my-ext',
        plugin_dir_url( __FILE__ ) . 'ext.js',
        array(),
        '1.0',
        true
    );
} );
```

---

### `desktop_mode_shell_before` — Stable
Fires just before the shell's opening `<div id="wp-desktop-shell">`. Echo HTML here to prepend sibling markup (e.g. a global announcement banner that sits above the shell).

```php
do_action( 'desktop_mode_shell_before' );
```

---

### `desktop_mode_shell_after` — Stable
Fires just after the shell's closing `</div>`. Echo HTML to append below it.

```php
do_action( 'desktop_mode_shell_after' );
```

---

### `desktop_mode_chromeless_styles` — Stable
Fires inside iframe (chromeless) requests, during `admin_enqueue_scripts`. Use it to enqueue **iframe-scoped** CSS that fine-tunes how specific admin pages render inside a window.

```php
do_action( 'desktop_mode_chromeless_styles' );
```

**Example:**

```php
add_action( 'desktop_mode_chromeless_styles', function () {
    wp_add_inline_style(
        'wp-desktop-chromeless',
        'body.edit-php .subsubsub { margin-top: 4px; }'
    );
} );
```

---

### `desktop_mode_native_window_registered` — Stable

Fires after `desktop_mode_register_window()` successfully stores a window. Does NOT fire when the registration returns a `WP_Error`.

```php
do_action( 'desktop_mode_native_window_registered', string $id, array $entry );
```

**Example — react when another plugin registers a window:**

```php
add_action( 'desktop_mode_native_window_registered', function ( $id, $entry ) {
    if ( 'jorvy' === $id ) {
        // Attach a companion behavior only when Jorvy is present.
    }
}, 10, 2 );
```

---

### `desktop_mode_widget_registered` — Stable

Fires after `desktop_mode_register_widget()` successfully stores a widget. Same contract as the native-window action.

```php
do_action( 'desktop_mode_widget_registered', string $id, array $entry );
```

---

### `desktop_mode_wallpaper_registered` — Stable

Fires after `desktop_mode_register_wallpaper()` successfully stores a wallpaper. Same contract.

```php
do_action( 'desktop_mode_wallpaper_registered', string $id, array $entry );
```

---

### `desktop_mode_icon_registered` — Stable

Fires after `desktop_mode_register_icon()` successfully stores a desktop shortcut tile. Same contract as the other registration actions — no fire on `WP_Error` return.

---

### `desktop_mode_command_script_registered` — Stable

Fires after `desktop_mode_register_command_script()` stores a command-palette script handle. Also fires when `desktop_mode_register_command()` implicitly registers its `script` argument.

```php
do_action( 'desktop_mode_command_script_registered', string $handle );
```

### `desktop_mode_command_registered` — Stable

Fires after `desktop_mode_register_command()` successfully stores a command's metadata. Does not fire on `WP_Error`.

```php
do_action( 'desktop_mode_command_registered', string $slug, array $entry );
```

### `desktop_mode_register_command_script( $handle )` — Stable (PHP function)

Declares a WP-registered script handle as a command-palette provider. The shell injects the resolved URL on plugin activation so `wp.desktop.registerCommand()` calls made by the plugin's JS appear in the palette **without a page reload**. Primary (minimum-ceremony) opt-in — plugin authors keep command definitions in TypeScript and only touch PHP to declare the handle.

```php
add_action( 'admin_enqueue_scripts', function () {
    wp_register_script(
        'home-assistant-commands',
        plugins_url( 'js/commands.js', __FILE__ ),
        array( 'wp-desktop-mode' ),
        '1.0.0',
        true
    );
    wp_enqueue_script( 'home-assistant-commands' );
} );
desktop_mode_register_command_script( 'home-assistant-commands' );
```

For live *unregistration* on deactivation, the plugin's JS should set `owner: 'home-assistant-commands'` on each `registerCommand` call — see `docs/javascript-reference.md`. Untagged commands stay until the next page reload.

### `desktop_mode_register_command( $args )` — Stable (PHP function)

Optional companion that also declares command metadata server-side. Advisory today — reserved for future pre-registration shims (showing a greyed-out command before the plugin's JS loads). Implicitly calls `desktop_mode_register_command_script( $args['script'] )` when `script` is provided.

```php
desktop_mode_register_command( array(
    'slug'        => 'ha-lights',
    'label'       => __( 'Home Assistant: Lights', 'home-assistant' ),
    'description' => __( 'Toggle smart lights from the palette.', 'home-assistant' ),
    'icon'        => 'dashicons-lightbulb',
    'hint'        => '[room]',
    'script'      => 'home-assistant-commands',
) );
```

**No `ai_callable` PHP-side flag — by design.** The [`aiCallable`](./javascript-reference.md#wpdesktopaiask-query-opts--stable-since-0170) opt-in lives on the JS-side `registerCommand` call only, because `wp.desktop.ai.ask()` harvests from the client registry (not server metadata). To gate further per-user once a command has opted in, use the `desktop_mode_ai_command_allowed` filter below.

```php
do_action( 'desktop_mode_icon_registered', string $id, array $entry );
```

---

### `desktop_mode_titlebar_button_script_registered` — Experimental (since 0.17.0)

Fires after `desktop_mode_register_titlebar_button_script()` stores a title-bar button script handle.

```php
do_action( 'desktop_mode_titlebar_button_script_registered', string $handle );
```

### `desktop_mode_register_titlebar_button_script( $handle )` — Experimental (PHP function, since 0.17.0)

Declares a WP-registered script handle as a title-bar button provider. The shell injects the resolved URL on plugin activation so `wp.desktop.registerTitleBarButton()` calls made by the plugin's JS render in matching window title bars **without a page reload**.

```php
add_action( 'admin_enqueue_scripts', function () {
    wp_register_script(
        'my-plugin-titlebar',
        plugins_url( 'js/titlebar.js', __FILE__ ),
        array( 'wp-desktop-mode' ),
        '1.0.0',
        true
    );
    wp_enqueue_script( 'my-plugin-titlebar' );
} );
desktop_mode_register_titlebar_button_script( 'my-plugin-titlebar' );
```

For live unregistration on deactivation, set `owner: 'my-plugin-titlebar'` on each `registerTitleBarButton` call. Untagged buttons survive past deactivation until the next page reload — graceful backwards-compat.

---

### `desktop_mode_settings_tab_script_registered` — Stable *(since 0.17.0)*

Fires after `desktop_mode_register_settings_tab_script()` stores an OS Settings tab script handle. Also fires when `desktop_mode_register_settings_tab()` implicitly registers its `script` argument.

```php
do_action( 'desktop_mode_settings_tab_script_registered', string $handle );
```

### `desktop_mode_settings_tab_registered` — Stable *(since 0.17.0)*

Fires after `desktop_mode_register_settings_tab()` successfully stores a tab's metadata. Does not fire on `WP_Error`.

```php
do_action( 'desktop_mode_settings_tab_registered', string $id, array $entry );
```

### `desktop_mode_register_settings_tab_script( $handle )` — Stable *(PHP function, since 0.17.0)*

Declares a WP-registered script handle as an OS Settings tab provider. The shell injects the resolved URL on plugin activation so `wp.desktop.registerSettingsTab()` calls made by the plugin's JS appear in the OS Settings window **without a page reload**. Primary (minimum-ceremony) opt-in — plugin authors keep tab definitions in TypeScript and only touch PHP to declare the handle.

```php
add_action( 'admin_enqueue_scripts', function () {
    wp_register_script(
        'my-plugin-settings',
        plugins_url( 'js/settings.js', __FILE__ ),
        array( 'wp-desktop-mode' ),
        '1.0.0',
        true
    );
    wp_enqueue_script( 'my-plugin-settings' );
} );
desktop_mode_register_settings_tab_script( 'my-plugin-settings' );
```

For live *unregistration* on deactivation, either:
- set `owner: 'my-plugin-settings'` on the JS `registerSettingsTab()` call, OR
- declare the tab with `desktop_mode_register_settings_tab()` below (the `script` arg ties the id to the handle server-side).

Tabs using neither mechanism stay until the next page reload.

### `desktop_mode_register_settings_tab( $args )` — Stable *(PHP function, since 0.17.0)*

Optional companion that declares a settings tab server-side. Primary benefit: enables live-unregistration on plugin deactivation without every `registerSettingsTab()` call having to set `owner`. Implicitly calls `desktop_mode_register_settings_tab_script( $args['script'] )` when `script` is provided.

```php
desktop_mode_register_settings_tab( array(
    'id'         => 'my-plugin',
    'label'      => __( 'My Plugin', 'my-plugin' ),
    'capability' => 'manage_options', // optional — admin-only when set to exactly this
    'order'      => 50,               // optional — default 100 (after built-ins)
    'script'     => 'my-plugin-settings',
) );
```

**Built-in tab orders** (for reference when picking `order`):
- `appearance` = 10
- `ai` = 20
- `extended` = 30
- `help` = 40
- Third-party default = 100 (appended after built-ins)

**Capability gating today**: the shell collapses `capability` to a simple admin-vs-everyone distinction. `'manage_options'` means admin-only; any other value (including empty) means visible to everyone. Widening to arbitrary capabilities is a future expansion.

---

### `desktop_mode_window_tab_registered` — Stable

Fires after `desktop_mode_register_window_tab()` successfully attaches a tab to a native window. Useful for companion plugins that need to follow up (e.g. register a help overlay only when a Stats tab actually exists).

```php
do_action( 'desktop_mode_window_tab_registered', string $window_id, string $value, array $entry );
```

---

### `desktop_mode_chromeless_after` — Stable
Fires in the `admin_footer` of chromeless iframe requests. Receives the current admin page's `$hook_suffix`.

```php
do_action( 'desktop_mode_chromeless_after', $hook_suffix );
```

**Example — emit a ready ping from the iframe:**

```php
add_action( 'desktop_mode_chromeless_after', function ( $hook_suffix ) {
    ?>
    <script>
        window.parent.postMessage(
            { type: 'my-ext-ready', hook: <?php echo wp_json_encode( $hook_suffix ); ?> },
            window.location.origin
        );
    </script>
    <?php
} );
```

---

### `desktop_mode_prepare_window` — Planned
Will fire once per window the shell is about to construct (both on fresh open and session restore). Planned signature:

```php
do_action( 'desktop_mode_prepare_window', string $page, array $args );
```

---

## Filters

### `desktop_mode_mode_enabled` — Stable

Gates whether desktop mode can be activated (or stay active) for a given user. The AJAX save endpoint consults this after the nonce check.

```php
apply_filters( 'desktop_mode_mode_enabled', bool $enabled, int $user_id );
```

**Example — disable for contributors:**

```php
add_filter( 'desktop_mode_mode_enabled', function ( $enabled, $user_id ) {
    if ( user_can( $user_id, 'contributor' ) && ! user_can( $user_id, 'edit_posts' ) ) {
        return false;
    }
    return $enabled;
}, 10, 2 );
```

A `false` return means the user cannot toggle the mode on — the AJAX endpoint returns `desktop_mode_disabled`.

---

### `desktop_mode_shell_config` — Stable

The JS configuration blob injected as `window.wpDesktopConfig`. Powers the window manager, dock, and session restore. Filter this to inject custom payloads the shell can read at boot.

```php
apply_filters( 'desktop_mode_shell_config', array $config );
```

`$config` shape:

```php
array(
    'currentPage'    => string,   // e.g. 'http://localhost:8889/wp-admin/'
    'currentTitle'   => string,   // human title of the current page
    'currentIcon'    => string,   // dashicons-* class
    'adminUrl'       => string,   // admin_url()
    'portalUrl'      => string,   // desktop_mode_portal_url()
    'sessionUrl'     => string,   // REST session URL
    'restNonce'      => string,   // X-WP-Nonce
    'dockItems'      => array[],  // see desktop_mode_dock_items
    'session'        => array,    // prior session snapshot or empty
)
```

**Example — add a flag for your feature:**

```php
add_filter( 'desktop_mode_shell_config', function ( $config ) {
    $config['myFeature'] = array(
        'enabled'  => (bool) get_option( 'my_ext_shell_feature' ),
        'endpoint' => rest_url( 'my-ext/v1/data' ),
    );
    return $config;
} );
```

Read it from JS:

```javascript
const cfg = window.wpDesktopConfig;
if ( cfg.myFeature && cfg.myFeature.enabled ) { /* ... */ }
```

---

### `desktop_mode_dock_items` — Stable

The final list of dock items, as an array of item arrays. Return a modified list — add, remove, reorder.

```php
apply_filters( 'desktop_mode_dock_items', array $items );
```

Each item:

```php
array(
    'slug'    => string,   // stable ID; drives the window ID too
    'title'   => string,   // hover tooltip
    'icon'    => string,   // dashicons-* or a sanitized http(s)/data: URL
    'url'     => string,   // page to open when clicked
    'badge'   => int,      // e.g. update count; 0 = hidden
    'submenu' => array[]?, // optional [ [ 'title' => ..., 'url' => ... ], ... ]
)
```

**Example — add a virtual dock item:**

```php
add_filter( 'desktop_mode_dock_items', function ( $items ) {
    $items[] = array(
        'slug'    => 'analytics',
        'title'   => __( 'Analytics', 'my-ext' ),
        'icon'    => 'dashicons-chart-bar',
        'url'     => admin_url( 'admin.php?page=my-analytics' ),
        'badge'   => 0,
        'submenu' => array(),
    );
    return $items;
} );
```

**Example — remove an item by slug:**

```php
add_filter( 'desktop_mode_dock_items', function ( $items ) {
    return array_values( array_filter( $items, fn( $i ) => 'edit-comments.php' !== $i['slug'] ) );
} );
```

---

### `desktop_mode_dock_item` — Stable

Fires for each item as the dock is assembled, with the source admin-menu slug for context.

```php
apply_filters( 'desktop_mode_dock_item', array $item, string $menu_slug );
```

**Example — rewrite the Posts icon:**

```php
add_filter( 'desktop_mode_dock_item', function ( $item, $slug ) {
    if ( 'edit.php' === $slug ) {
        $item['icon'] = 'dashicons-welcome-write-blog';
    }
    return $item;
}, 10, 2 );
```

---

### `desktop_mode_dock_item_multi` — Stable

Controls whether a dock item supports multiple simultaneous windows. Multi-capable pages expose a "+" chip on the dock icon and an "Open another" action in the window's title-bar menu; singletons always focus the existing window when re-opened.

Built-in defaults: `edit.php`, `edit-tags.php`, `upload.php`, `users.php`, and `edit-comments.php` are multi; everything else is singleton. The base filename is matched against the list, so every CPT (`edit.php?post_type=page`) and every taxonomy inherits the same rule as its parent admin file.

```php
apply_filters( 'desktop_mode_dock_item_multi', bool $multi, string $menu_slug );
```

**Example — let a custom plugin page open multiple windows:**

```php
add_filter( 'desktop_mode_dock_item_multi', function ( $multi, $slug ) {
    if ( 'my-plugin-entities' === $slug ) {
        return true;
    }
    return $multi;
}, 10, 2 );
```

**Example — force Users into singleton mode:**

```php
add_filter( 'desktop_mode_dock_item_multi', function ( $multi, $slug ) {
    return 'users.php' === $slug ? false : $multi;
}, 10, 2 );
```

---

### `desktop_mode_dock_placement` — Stable

Chooses where a menu item appears in the desktop shell. Three values are recognized:

- `'dock'` — left-edge vertical strip (core WordPress menus — Dashboard, Posts, Media, Users, Settings, CPTs, taxonomies…).
- `'taskbar'` — bottom horizontal pill (default for installed-plugin top-level menus routed through `admin.php?page=*`).
- `'hidden'` — suppress the item entirely. The underlying admin menu entry still exists server-side; this only prevents rendering on either desktop-mode rail. Plugins that don't want to claim chrome real estate (utility tools, background services, plugins that render only into existing surfaces) set this.

```php
apply_filters( 'desktop_mode_dock_placement', string $placement, string $menu_slug );
```

The built-in routing heuristic (`desktop_mode_dock_placement`) returns `'dock'` for:

- Hardcoded core menu files (`index.php`, `edit.php`, `upload.php`, `plugins.php`, `users.php`, `tools.php`, `options-*.php`, `themes.php`, `site-health.php`, `update-core.php`, and every admin file in the core allowlist).
- Every `edit.php?post_type=*` route (all Custom Post Types render alongside core menus).
- Every `edit-tags.php?taxonomy=*` route (taxonomies follow their parent).

Every other top-level menu returns `'taskbar'`. Return `'dock'` to promote a plugin menu onto the left rail, `'taskbar'` to demote a core-looking menu out of it, or `'hidden'` to remove it from the shell entirely.

Return values other than those three are silently ignored — the item falls back to the default. That keeps a misbehaving filter (returning `null`, a bool, etc.) from corrupting the rail split.

**Example — pin a plugin menu to the left dock because it's a first-class admin surface on this install:**

```php
add_filter( 'desktop_mode_dock_placement', function ( $placement, $slug ) {
    if ( 'woocommerce' === $slug ) {
        return 'dock';
    }
    return $placement;
}, 10, 2 );
```

**Example — move Tools down to the taskbar because the site never uses it:**

```php
add_filter( 'desktop_mode_dock_placement', function ( $placement, $slug ) {
    if ( 'tools.php' === $slug ) {
        return 'taskbar';
    }
    return $placement;
}, 10, 2 );
```

**Example — hide a plugin from the shell entirely (from inside that plugin's own PHP):**

```php
add_filter( 'desktop_mode_dock_placement', function ( $placement, $slug ) {
    if ( 'my-background-tool' === $slug ) {
        return 'hidden';
    }
    return $placement;
}, 10, 2 );
```

The split happens once per request, server-side, in `includes/render.php` — each item's `placement` key is computed when `desktop_mode_build_dock_items()` runs, then the shell splits the list into `config.dockItems` + `config.taskbarItems` before localizing to JS. Hidden items are dropped before either list is built. The client never re-sorts, so the filter is the only place to override routing.

The live menu-refresh endpoint (`GET /wp-desktop/v1/menu`, fired after plugin activation / deactivation inside a windowed `plugins.php`) runs the same builder, so a filter change takes effect without a full tab reload.

---

### `desktop_mode_arrange_menu_items` — Stable

The list of plugin-contributed items appended to the admin bar's **Arrange** submenu — the dropdown that sits next to the "Switch to…" toggle when desktop mode is active. Built-ins (Cascade, Overview, Snap to grid, Tile all windows) are always present; this filter adds to them. Only invoked when the user is viewing the desktop shell.

```php
apply_filters( 'desktop_mode_arrange_menu_items', array $items );
```

Each item is an associative array:

```php
array(
    'id'          => string, // unique slug; letters/digits/dashes only
    'title'       => string, // menu label (already translated)
    'description' => string, // optional; tooltip + accessible description
    'position'    => int,    // optional sort key (default 10); lower sorts earlier
)
```

Items with missing `id` or `title` are silently dropped — plugins can't accidentally create an unrouteable entry. Ties on `position` preserve registration order.

**Click wiring:** clicking a custom item fires the JS action `wp-desktop.arrange.custom-action` with payload `{ id }`. Subscribe via `wp.hooks.addAction()`:

```php
add_filter( 'desktop_mode_arrange_menu_items', function ( $items ) {
    $items[] = array(
        'id'          => 'diagonal',
        'title'       => __( 'Diagonal cascade', 'my-ext' ),
        'description' => __( 'Cascade windows along a 45° line.', 'my-ext' ),
        'position'    => 15,
    );
    return $items;
} );
```

```js
// In your shell-side script (enqueued with `wp-hooks` as a dependency):
wp.hooks.addAction(
    'wp-desktop.arrange.custom-action',
    'my-ext/diagonal',
    function ( payload ) {
        if ( payload.id !== 'diagonal' ) {
            return;
        }
        const windows = wp.desktop.windowManager.getAll();
        windows.forEach( ( w, i ) => w.move( i * 40, i * 40 ) );
    }
);
```

---

### `desktop_mode_portal_auto_enable` — Stable

When a user lands on `/wp-desktop/` without desktop mode enabled, the portal auto-enables it for them by default. Return `false` to require an explicit toggle instead.

```php
apply_filters( 'desktop_mode_portal_auto_enable', bool $auto_enable, int $user_id );
```

**Example:**

```php
add_filter( 'desktop_mode_portal_auto_enable', '__return_false' );
```

---

### `desktop_mode_admin_redirect_to_portal` — Stable

Governs the `admin_init` redirect from classic `/wp-admin/` URLs to `/wp-desktop/` for users with desktop mode on. Return `false` to keep the user on the classic URL even when they have the mode enabled (useful for support sessions).

```php
apply_filters( 'desktop_mode_admin_redirect_to_portal', bool $redirect, int $user_id );
```

---

### `desktop_mode_accent_colors` — Stable

Extends or restricts the accent-color swatches shown in OS Settings. Applied to `--wp-admin-theme-color` on the shell's `<html>`. Each entry is `{ id: string, label: string, value: string }` — `id` is a stable slug persisted to `localStorage`, `label` is the picker tooltip, `value` is a hex color validated server-side via `sanitize_hex_color()`. Invalid entries are dropped; a filter that leaves the list empty falls back to the built-in six swatches.

```php
apply_filters( 'desktop_mode_accent_colors', array $colors );
```

**Example — add a brand swatch:**

```php
add_filter( 'desktop_mode_accent_colors', function ( $colors ) {
    $colors[] = array(
        'id'    => 'brand',
        'label' => __( 'Brand', 'my-plugin' ),
        'value' => '#ff00ff',
    );
    return $colors;
} );
```

**Example — collapse to a single approved accent (compliance theme):**

```php
add_filter( 'desktop_mode_accent_colors', function () {
    return array(
        array( 'id' => 'corporate', 'label' => 'Corporate', 'value' => '#003366' ),
    );
} );
```

---

### `desktop_mode_toast_types` — Stable

Extends the toast-notification type map the shell consumes when a plugin calls `wp.desktop.toast( id, … )`. Each entry is `{ id, label, icon, tone }` where `tone` is one of `positive | warning | critical | neutral`. Entries with an unknown tone are dropped.

```php
apply_filters( 'desktop_mode_toast_types', array $types );
```

**Example — register an `update-available` toast style:**

```php
add_filter( 'desktop_mode_toast_types', function ( $types ) {
    $types[] = array(
        'id'    => 'update-available',
        'label' => __( 'Update available', 'my-plugin' ),
        'icon'  => 'dashicons-update',
        'tone'  => 'neutral',
    );
    return $types;
} );
```

---

### `desktop_mode_default_wallpaper` — Stable

Chooses the wallpaper slug applied on first boot for a new user (and as the fallback when a user's saved wallpaper was registered by a plugin that's since been deactivated). Return a registered wallpaper id. Output is normalised with `sanitize_key()`.

```php
apply_filters( 'desktop_mode_default_wallpaper', string $id );
```

**Example — ship `aurora` as the brand default:**

```php
add_filter( 'desktop_mode_default_wallpaper', fn () => 'aurora' );
```

---

### `desktop_mode_wallpapers` — Stable

Last-chance filter over the full wallpaper registry before it ships to the shell as `config.serverWallpapers`. Each entry is the shape stored by `desktop_mode_register_wallpaper()` (`id`, `label`, `preview`, `type`, `value`, `script`). Use this to reorder, rename, remove, or override wallpaper entries — including the built-in presets.

Mirrors the client-side `wp-desktop.wallpapers` JS filter but runs earlier, before any wallpaper reaches the browser.

```php
apply_filters( 'desktop_mode_wallpapers', array $registry );
```

**Example — hide the `sunset` preset from this site:**

```php
add_filter( 'desktop_mode_wallpapers', function ( $registry ) {
    unset( $registry['sunset'] );
    return $registry;
} );
```

**Example — rename the `dark` preset to match a brand:**

```php
add_filter( 'desktop_mode_wallpapers', function ( $registry ) {
    if ( isset( $registry['dark'] ) ) {
        $registry['dark']['label'] = __( 'Acme Dark', 'my-plugin' );
    }
    return $registry;
} );
```

A filter that returns a non-array value drops the list entirely (empty `serverWallpapers` in the shell config). The built-in presets register on `init` priority 5, so any filter hooking later than that sees the full built-in set in its input.

---

### `desktop_mode_icons` — Stable

Last-chance filter over the desktop-icon registry before it ships to the shell as `config.desktopIcons`. Each entry is the shape stored by `desktop_mode_register_icon()` (`id`, `title`, `icon`, `window`, `url`, `position`).

```php
apply_filters( 'desktop_mode_icons', array $registry );
```

**Example — hide a plugin's icon for users on a specific role:**

```php
add_filter( 'desktop_mode_icons', function ( $registry ) {
    if ( ! current_user_can( 'manage_options' ) ) {
        unset( $registry['jorvy'] );
    }
    return $registry;
} );
```

---

### `desktop_mode_window_tabs` — Stable

Last-chance filter over the ordered tab list for a native window. Each entry is `{ value, label, template, script, is_main, position }`. Lets a late-loading plugin reorder, hide, or relabel tabs another plugin registered (or the window's own main tab).

```php
apply_filters( 'desktop_mode_window_tabs', array $tabs, string $window_id );
```

**Example — hide the About tab on production sites:**

```php
add_filter( 'desktop_mode_window_tabs', function ( $tabs, $window_id ) {
    if ( 'jorvy' !== $window_id || defined( 'WP_LOCAL_DEV' ) ) {
        return $tabs;
    }
    return array_values( array_filter(
        $tabs,
        fn( $tab ) => 'about' !== $tab['value']
    ) );
}, 10, 2 );
```

---

### `desktop_mode_native_window_tab_wrap_padding` — Stable

Overrides the inline padding (in pixels) of the auto-generated tab wrapper the shell injects around a multi-tab native window. Only fires when `desktop_mode_register_window_tab()` produces the auto-wrap (a native window with at least one additional tab); single-pane windows never see this filter. Return an integer number of pixels — the value is cast via `(int)` before being emitted as the wrapper's `padding` attribute, so CSS length strings like `'1.5rem'` will cast to `0`. Pass `0` for edge-to-edge content.

```php
apply_filters( 'desktop_mode_native_window_tab_wrap_padding', int $padding, string $window_id );
```

**Example — zero-pad one specific window's tab panels:**

```php
add_filter( 'desktop_mode_native_window_tab_wrap_padding', function ( $padding, $window_id ) {
    return 'my-plugin/editor' === $window_id ? 0 : $padding;
}, 10, 2 );
```

---

## AI Copilot hooks — Stable

The AI assistant (Cmd+K palette) runs an agentic loop server-side, analyses entities on save, and exposes a search REST endpoint. Every decision point is hookable so plugins can adjust model selection, customise prompts, limit which entities get analysed, or react to analysis completion.

The shell ships with a built-in **OpenAI** provider (Responses API). Other providers are pluggable — see [`desktop_mode_register_ai_provider`](#desktop_mode_register_ai_provider-args--experimental-php-function-since-0180) below.

### `desktop_mode_register_ai_provider( $args )` — Experimental (PHP function, since 0.18.0)

Register an alternative AI back-end (Anthropic, Gemini, a local LLM, …). Each provider supplies three callables that fully encapsulate its wire format; the shell drives the agentic loop, observability, and tool dispatch unchanged.

```php
desktop_mode_register_ai_provider( string $id, array $args ): true|WP_Error
```

`$args`:

| Key | Type | Required | Notes |
|---|---|---|---|
| `label` | `string` | optional | Human-readable display name. |
| `description` | `string` | optional | Shown under the picker. |
| `api_key_label` | `string` | optional | Label for the API-key field in OS Settings → AI. |
| `api_key_link` | `string` | optional | URL where the user obtains a key. |
| `default_model` | `string` | optional | Model id used when `desktop_mode_ai_model` returns ''. |
| `capabilities` | `string[]` | optional | Informational tags (e.g., `tools`, `structured_output`). |
| `make_turn_input` | `callable` | **required** | Builds an opaque turn-input the shell hands to `agentic_call` next turn. |
| `agentic_call` | `callable` | **required** | One turn of the agentic loop. |
| `structured_request` | `callable` | **required** | Single-shot structured-output request. |

Required callable signatures:

```php
// $kind: 'user_message' | 'tool_results'
// payload: string for 'user_message'; array of [{call_id, output (json string)}, …] for 'tool_results'.
function make_turn_input( string $kind, mixed $payload ): mixed;

// Returns array{ text:?string, function_calls: array, next_state: mixed, raw: mixed }
// or WP_Error. function_calls items: { name, call_id, arguments (json string) }.
function agentic_call(
    string $api_key,
    mixed  $turn_input,
    array  $tools,
    ?array $text_format,
    string $instructions,
    mixed  $state
): array|WP_Error;

function structured_request(
    string $api_key,
    array  $messages,    // [ { role, content }, … ]
    array  $schema,       // JSON Schema
    string $schema_name,
    string $model         // '' → use the provider's default_model
): array|WP_Error;
```

Hook `desktop_mode_ai_register_providers` (fires lazily on first lookup) for registration:

```php
add_action( 'desktop_mode_ai_register_providers', function () {
    desktop_mode_register_ai_provider( 'anthropic', array(
        'label'              => 'Anthropic Claude',
        'api_key_label'      => 'Anthropic API key',
        'api_key_link'       => 'https://console.anthropic.com/settings/keys',
        'default_model'      => 'claude-sonnet-4-6',
        'make_turn_input'    => 'my_anthropic_make_turn_input',
        'agentic_call'       => 'my_anthropic_agentic_call',
        'structured_request' => 'my_anthropic_structured_request',
    ) );
} );
```

See [`docs/examples/register-ai-provider.md`](./examples/register-ai-provider.md) for a worked example.

### `desktop_mode_unregister_ai_provider( $id )` — Experimental (PHP function, since 0.18.0)

Removes a provider from the registry. Returns `true` if a provider was removed, `false` if the id was unknown.

### `desktop_mode_ai_register_providers` — Experimental (since 0.18.0)

Action fired exactly once per request, the first time the registry is read. Hook it to call `desktop_mode_register_ai_provider()`.

```php
do_action( 'desktop_mode_ai_register_providers' );
```

### `desktop_mode_ai_provider_registered` — Experimental (since 0.18.0)

Fires after a provider has been successfully registered.

```php
do_action( 'desktop_mode_ai_provider_registered', string $id, array $def );
```

### `desktop_mode_ai_active_provider` — Experimental (since 0.18.0)

Filter the resolved active-provider id. Useful for per-request pinning (e.g., based on capability or query content).

```php
apply_filters( 'desktop_mode_ai_active_provider', string $provider_id, int $user_id );
```

```php
// Force admins to use Anthropic; everyone else stays on the default.
add_filter( 'desktop_mode_ai_active_provider', function ( $id, $user_id ) {
    return user_can( $user_id, 'manage_options' ) ? 'anthropic' : $id;
}, 10, 2 );
```


### `desktop_mode_ai_model` — Stable

Overrides the OpenAI model used per schema. Defaults to `'gpt-4o-mini'`. `$schema_name` identifies the call site (`'search'`, `'analyze_content'`, `'analyze_comment'`, etc.).

```php
apply_filters( 'desktop_mode_ai_model', string $model, string $schema_name );
```

```php
add_filter( 'desktop_mode_ai_model', function ( $model, $schema ) {
    return 'search' === $schema ? 'gpt-4o' : $model;
}, 10, 2 );
```

### `desktop_mode_ai_supported_post_types` / `desktop_mode_ai_supported_taxonomies` — Stable

Gate which post types and taxonomies receive auto-analysis on save. Defaults include `post`, `page`, and all public custom post types / taxonomies.

```php
apply_filters( 'desktop_mode_ai_supported_post_types', array $types );
apply_filters( 'desktop_mode_ai_supported_taxonomies', array $taxonomies );
```

### `desktop_mode_ai_supported_types` — Stable

Umbrella gate applied by the job scheduler (`desktop_mode_ai_schedule_job`). Return a subset of `[ 'post', 'term', 'comment' ]` to disable a whole entity class.

```php
apply_filters( 'desktop_mode_ai_supported_types', array $types );
```

### `desktop_mode_ai_schema_content` / `desktop_mode_ai_schema_comment` — Experimental

Mutate the JSON Schema handed to OpenAI for structured-output post/term and comment analysis. Use this to add custom fields (brand voice scoring, compliance flags, …) the model should populate.

```php
apply_filters( 'desktop_mode_ai_schema_content', array $schema );
apply_filters( 'desktop_mode_ai_schema_comment', array $schema );
```

### `desktop_mode_ai_post_prompt` / `desktop_mode_ai_term_prompt` / `desktop_mode_ai_comment_prompt` — Stable

Customise the user-side prompt handed to the model per entity. Each filter receives the default prompt plus the entity object.

```php
apply_filters( 'desktop_mode_ai_post_prompt',    string $prompt, WP_Post    $post );
apply_filters( 'desktop_mode_ai_term_prompt',    string $prompt, WP_Term    $term );
apply_filters( 'desktop_mode_ai_comment_prompt', string $prompt, WP_Comment $comment );
```

### `desktop_mode_ai_post_analyzed` / `desktop_mode_ai_term_analyzed` / `desktop_mode_ai_comment_analyzed` — Stable

Fire after a successful analysis. The result array contains the fields emitted by the schema (typically `summary`, `topics`, `sentiment`, `embedding`, …). Use these to mirror data into a custom index or trigger downstream jobs.

```php
do_action( 'desktop_mode_ai_post_analyzed',    int $post_id,    array $result, WP_Post    $post );
do_action( 'desktop_mode_ai_term_analyzed',    int $term_id,    array $result, WP_Term    $term );
do_action( 'desktop_mode_ai_comment_analyzed', int $comment_id, array $result, WP_Comment $comment );
```

### `desktop_mode_ai_admin_page_catalog` — Stable

Last-chance filter over the catalog of admin pages the AI search tool can link to. Each entry is `{ id, title, url, description }`. Plugins that expose admin UIs typically inject their top-level pages here so the assistant can offer them as navigation results.

```php
apply_filters( 'desktop_mode_ai_admin_page_catalog', array $catalog );
```

### `desktop_mode_ai_error_log_candidates` — Experimental

Filter the set of error candidates the AI exposes when the user asks about site health. Return an array of `{ message, source, timestamp }`.

```php
apply_filters( 'desktop_mode_ai_error_log_candidates', array $candidates );
```

---

## AI Copilot extensibility — `/ai/search` (Experimental, since 0.17.0)

Every `POST /wp-desktop/v1/ai/search` call — whether driven by the built-in overlay or by `wp.desktop.ai.ask()` — runs through this layered hook surface. Use it to:

- Inject domain context into the system prompt.
- Add or remove tools the AI can call.
- Gate which slash-commands the AI is allowed to invoke.
- Transform tool results on their way back to the model.
- Rewrite the final answer.
- Observe / log / cost-track every call via the start/tool/complete/error action trio.

Every filter receives a `$context` array with at least `{ user_id, request_id }`. `request_id` is a UUID minted once per call — use it to correlate `desktop_mode_ai_search_started`, each `desktop_mode_ai_tool_called`, and the final `desktop_mode_ai_search_completed`.

### `desktop_mode_ai_system_prompt_appendix` — Stable

Most-common extension point. Every plugin's return value is concatenated onto the built-in instructions. Safe to stack across plugins — none overwrite each other.

```php
add_filter( 'desktop_mode_ai_system_prompt_appendix', function ( $appendix, $ctx ) {
    return $appendix . "\n\nThis site controls a smart home. Rooms: kitchen, living room, bedroom.";
}, 10, 2 );
```

### `desktop_mode_ai_system_prompt` — Stable

Final transform pass on the composed prompt (built-in + appendix + any client override). Reserved for deep integrations — compliance disclaimers, restructured instructions. Most plugins should reach for the appendix filter instead.

```php
apply_filters( 'desktop_mode_ai_system_prompt', string $instructions, array $context );
```

### `desktop_mode_ai_system_prompt_replace_capability` — Stable

Capability the client must hold to send `system_prompt: { mode: 'replace' }`. Default `manage_options`. Non-admin requests with `mode: 'replace'` silently downgrade to `append` — text is never dropped.

```php
apply_filters( 'desktop_mode_ai_system_prompt_replace_capability', string $capability, array $context );
```

### `desktop_mode_ai_request` — Stable

Last-mile filter on the whole request bundle, right before `desktop_mode_ai_run_search()` fires. Mutable — return a modified array to rewrite `command_tools`, inject default `system_prompt_text`, add a sub-request flag that downstream filters observe.

```php
apply_filters( 'desktop_mode_ai_request', array $extra, array $core );
// $extra = { user_id, request_id, command_tools, system_prompt_text, system_prompt_mode }
// $core  = { query, resume_tool, start_offset }
```

### `desktop_mode_ai_tools` — Stable

Transforms the full tool list (built-in search + PHP-registered + client commands) once per run, just before it goes to OpenAI. Add tools, remove tools, rewrite descriptions.

```php
apply_filters( 'desktop_mode_ai_tools', array $tools, array $context );
```

### `desktop_mode_ai_command_tools` — Stable

Narrower sibling — fires on only the command-derived subset. Right hook for bulk gating ("strip every command from this tool list for unauthenticated requests").

```php
apply_filters( 'desktop_mode_ai_command_tools', array $command_defs, array $context );
```

### `desktop_mode_ai_command_allowed` — Stable

Per-slug gate. Fired once per client-supplied command, before it's converted into a tool definition. Return `false` to drop the command entirely.

```php
add_filter( 'desktop_mode_ai_command_allowed', function ( $entry, $slug, $ctx ) {
    // Non-admins can't invoke the /delete_* family via the AI.
    if ( str_starts_with( $slug, 'delete_' ) && ! user_can( $ctx['user_id'], 'manage_options' ) ) {
        return false;
    }
    return $entry;
}, 10, 3 );
```

### `desktop_mode_ai_tool_result` — Stable

Transform a tool's result on its way back to the model. Fires for **every** tool — built-in search_*, PHP-registered via `desktop_mode_register_ai_tool()`, and command tools alike.

```php
apply_filters( 'desktop_mode_ai_tool_result', array $result, string $tool_name, array $args, array $context );
```

### `desktop_mode_ai_answer` — Stable

Final transform hook — fires immediately before the HTTP response is returned. Also fires for the `tool_call` short-circuit, the follow-up composed reply, and the budget-exhausted path.

```php
apply_filters( 'desktop_mode_ai_answer', array $answer, array $context );
// $answer shape: { answer_type, message, entity, admin_links, tool?, iterations, exhausted, continue, request_id }
// $context: { query, user_id, request_id, phase? }  — phase='follow_up' on the second leg
```

### `desktop_mode_ai_followup_outcome_max_chars` — Stable

Caps the size of the serialised tool result the follow-up leg sends to OpenAI. Default `4000` characters — enough for a status string, a small result list, or a short error envelope. Set `0` to disable truncation (not recommended — a buggy or malicious plugin that returns a 5 MB blob would then inflate token usage unbounded).

```php
apply_filters( 'desktop_mode_ai_followup_outcome_max_chars', int $max_chars );
```

### `desktop_mode_ai_tool_registered` — Stable

Fires after `desktop_mode_register_ai_tool()` successfully stores a tool definition. Does not fire on `WP_Error`.

```php
do_action( 'desktop_mode_ai_tool_registered', string $name, array $entry );
```

### `desktop_mode_ai_search_started` — Stable

Fires once per `/ai/search` invocation, after validation, before any OpenAI call. First anchor of the observability trio.

```php
do_action( 'desktop_mode_ai_search_started', array $context );
// $context = { query, user_id, request_id, phase? }
```

`phase` is `'follow_up'` when the event fires for the second leg of the agentic command-dispatch flow (triggered by the client sending `ask( q, { followUp: true } )`). Omitted on the primary leg.

### `desktop_mode_ai_tool_called` — Stable

Fires each time a tool runs — search_*, PHP-registered, or a command tool short-circuit.

```php
do_action( 'desktop_mode_ai_tool_called', array $payload );
// $payload = { tool_name, args, user_id, request_id }
```

### `desktop_mode_ai_search_completed` — Stable

Fires after the final answer is composed (every success path). Observability partner to `desktop_mode_ai_search_started`.

```php
do_action( 'desktop_mode_ai_search_completed', array $payload );
// $payload = { query, user_id, request_id, answer_type, iterations }
```

### `desktop_mode_ai_search_error` — Stable

Fires on any `WP_Error` path — REST permission deny, OpenAI failure, tool handler exception. Includes the `request_id` so subscribers can correlate with `desktop_mode_ai_search_started`.

```php
do_action( 'desktop_mode_ai_search_error', array $error );
// $error = { code, message, data, user_id?, request_id? }
```

---

### `desktop_mode_register_ai_tool( $args )` — Experimental (PHP function, since 0.17.0)

Register a server-dispatched AI tool. Tool handlers run on the server, return a JSON-serialisable array, and the result is fed straight back to the OpenAI agent loop. This is the right home for integrations that are inherently server-side: site-health checks, order lookups, WP-CLI wrappers, database-heavy queries.

```php
desktop_mode_register_ai_tool( array(
    'name'             => 'list_recent_orders',
    'description'      => 'List the site\'s most recent WooCommerce orders.',
    'parameters'       => array(
        'type'       => 'object',
        'properties' => array(
            'limit'  => array( 'type' => 'integer' ),
            'status' => array( 'type' => 'string', 'enum' => array( 'processing', 'completed' ) ),
        ),
        'required'   => array( 'limit' ),
    ),
    'handler'          => 'my_plugin_list_orders',
    'capability'       => 'manage_woocommerce',
    'progress_message' => 'Checking recent orders…',
) );

function my_plugin_list_orders( array $args, int $user_id ) : array {
    return array( 'orders' => array( /* ... */ ) );
}
```

Handler signature: `function( array $args, int $user_id ): array|WP_Error`. A `WP_Error` return, or a thrown exception, is caught automatically — the error envelope goes back to the model as the tool result (so the agent can try something else) and fires `desktop_mode_ai_search_error`. Never surfaces raw exception messages to the user.

`capability` is enforced **before** the tool is visible to the model — unauthorised users never see it exists.

---

## Planned (not yet fired)

The filters and actions below are **reserved names** documented for forward compatibility. They will land with the phase indicated. Do not register listeners in production code until the status flips to Stable.

### Window — Phase 3
```php
apply_filters( 'desktop_mode_window_args',           array $args, string $page );
apply_filters( 'desktop_mode_window_reuse',          bool  $reuse, string $page );
apply_filters( 'desktop_mode_window_excluded_pages', array $excluded );
```

### Taskbar — Phase 3
```php
apply_filters( 'desktop_mode_taskbar_items',    array  $items );
apply_filters( 'desktop_mode_taskbar_tray',     array  $tray );
apply_filters( 'desktop_mode_taskbar_position', string $position );
```

### Dock (extended) — Phase 3+
```php
apply_filters( 'desktop_mode_dock_position', string $position );   // 'left' | 'bottom'
apply_filters( 'desktop_mode_dock_style',    array  $style );      // icon size, gap, blur
```

### Desktop area — Phase 4+
```php
apply_filters( 'desktop_mode_wallpaper',    string $url,   string $color_scheme );
apply_filters( 'desktop_mode_context_menu', array  $menu_items );
apply_filters( 'desktop_mode_icon',         array  $icon_config, string $icon_id );
```

> `desktop_mode_icons` and `desktop_mode_wallpapers` and the widget registry filter are **shipped** — see their Stable entries above. `desktop_mode_widgets` is not a PHP filter; the JS-side `wp-desktop.widgets` filter is the canonical hook (widgets are declared via `desktop_mode_register_widget()` server-side).

### Responsive — Phase 5–6
```php
apply_filters( 'desktop_mode_mode_type',           string $mode );   // 'desktop' | 'tablet' | 'mobile'
apply_filters( 'desktop_mode_mobile_grid_items',   array  $items );
apply_filters( 'desktop_mode_mobile_tab_bar',      array  $tabs );
apply_filters( 'desktop_mode_mobile_app_switcher', array  $cards );
apply_filters( 'desktop_mode_tablet_split_config', array  $config );
```

### Native windows — reserved extensions
```php
apply_filters( 'desktop_mode_native_windows',       array $windows );
apply_filters( 'desktop_mode_native_window_config', array $window_config, string $window_id );
```

> Native windows themselves are **shipped** (0.11.0) — plugins declare them with `desktop_mode_register_window()` and react via the Stable registration actions (`desktop_mode_native_window_registered`) and JS lifecycle hooks (`wp-desktop.native-window.before-render` / `after-render` / `before-close`). The two filter names above are reserved for a future read-only view of the registry and per-window config overrides.

### Drag & Drop — Phase 8
```php
apply_filters( 'desktop_mode_drag_mime_types', array $mime_types );
apply_filters( 'desktop_mode_drag_payload',    array $payload, string $source_page, string $target_page );
apply_filters( 'desktop_mode_drop_accepts',    bool  $accepts, array $payload, string $target_page );
```

### Body classes — Stable (applied, filter planned)
```php
apply_filters( 'desktop_mode_body_classes', string $classes );
```
Currently the `wp-desktop-active` / `wp-desktop-chromeless` classes are added unfiltered via `admin_body_class`. A named filter is planned.

---

## Registration functions

Shell extension points — windows, widgets, wallpapers — are declared through `desktop_mode_register_*()` PHP functions that mirror Core's `register_*` conventions. Every function returns `true` on success and `WP_Error` on any validation failure, with a stable error code callers can branch on.

```php
$result = desktop_mode_register_window( 'jorvy', array(
    'title'    => 'Jorvy',
    'template' => 'jorvy_render_template',
    'script'   => 'jorvy-render',
) );

if ( is_wp_error( $result ) ) {
    error_log( '[jorvy] registration failed: ' . $result->get_error_code() . ' — ' . $result->get_error_message() );
}
```

### Backwards compatibility

Prior to `0.11.0` these functions returned `bool`. `WP_Error` is an object and therefore truthy, so legacy `if ( desktop_mode_register_window( … ) )` guards continue to compile and reach their success branch. New code should use `is_wp_error()` to distinguish success from failure.

### Error codes

| Code | Raised by | Meaning |
|---|---|---|
| `desktop_mode_missing_id` | window / widget / wallpaper / icon | The `$id` argument was empty. |
| `desktop_mode_missing_window_id` | `desktop_mode_register_window_tab` | The `$window_id` argument was empty. |
| `desktop_mode_missing_title` | `desktop_mode_register_window`, `desktop_mode_register_icon` | The `title` field was empty. |
| `desktop_mode_missing_label` | `desktop_mode_register_widget`, `desktop_mode_register_wallpaper`, `desktop_mode_register_window_tab` | The `label` field was empty. |
| `desktop_mode_missing_script` | `desktop_mode_register_window`, `desktop_mode_register_wallpaper` (canvas) | The `script` handle was empty. |
| `desktop_mode_missing_tab_value` | `desktop_mode_register_window_tab` | The `value` field was empty. |
| `desktop_mode_reserved_tab_value` | `desktop_mode_register_window_tab` | Tab `value` was `main` (reserved for the window's own template tab). |
| `desktop_mode_invalid_template` | `desktop_mode_register_window`, `desktop_mode_register_window_tab` | The `template` callback is not callable. |
| `desktop_mode_missing_target` | `desktop_mode_register_icon` | Neither `window` nor `url` was declared. |
| `desktop_mode_conflicting_target` | `desktop_mode_register_icon` | Both `window` and `url` were declared (pick one). |
| `desktop_mode_invalid_url` | `desktop_mode_register_icon` | The `url` argument isn't a valid http(s) URL. |
| `desktop_mode_capability_denied` | all five | Current user lacks a capability declared in `capabilities`. The offending cap is available on `get_error_data()['capability']`. |

All five functions ship as **Stable** in `0.11.0`.

### `desktop_mode_register_window_tab()`

Attaches an additional tab to a native window. The window's own `template` becomes the first tab automatically (its label comes from `main_tab_label` on `desktop_mode_register_window()`, falling back to `title`); each call to this function adds another tab after the main one. Cross-plugin extension is supported — a companion plugin can attach a tab to someone else's window with no coordination other than knowing the window id.

```php
desktop_mode_register_window_tab( string $window_id, array $args );
```

**Args**: `value` (required, kebab slug, cannot be `main`), `label` (required), `template` (required callable), `script` (optional handle), `position` (optional int; lower renders earlier), `capabilities` (optional cap list).

When at least one additional tab is registered, the shell wraps the entire window template in `<wpd-stack>` + `<wpd-tabs>` + one `<wpd-tabpanel>` per tab automatically — plugin authors stop hand-writing that markup. Single-pane windows (zero additional tabs) are unchanged.

See [`docs/examples/native-window-with-tabs.md`](./examples/native-window-with-tabs.md) for a full walkthrough.

---

## DevTools / debug bus (since 0.6.0)

### `desktop_mode_debug_publish( $session_id, $channel, $payload )` — Experimental (PHP function)

Publish a payload onto the per-session debug bus. Plugins running inside an admin / REST / AJAX request hook a capture (e.g. `SAVEQUERIES` for SQL, `pre_http_request` for outbound HTTP, output buffering for response inspection), then call this to stream events to a client-side inspector window.

```php
$session_id = desktop_mode_debug_session_for_request();
if ( '' !== $session_id ) {
    desktop_mode_debug_publish( $session_id, 'query', array(
        'sql'  => $sql,
        'time' => $duration,
    ) );
}
```

**Args**: `$session_id` (string from the `X-WP-Debug-Session` header — see helper below), `$channel` (free-form lowercase ASCII; convention: `query`, `log`, `rest_timing`), `$payload` (anything `wp_json_encode()` can serialise).

**Storage**: per-(session, channel) ring buffer in a transient, capped at 500 events (filterable via `desktop_mode_debug_ring_size`), TTL 1 hour.

### `desktop_mode_debug_session_for_request()` — Experimental (PHP function)

Read the debug session id from the current request's `X-WP-Debug-Session` header. Sanitises against UUID-shape input; returns `''` when absent or invalid. Use this to gate capture work so non-instrumented requests pay zero cost.

### `desktop_mode_debug_publish` — Experimental (action)

Fires synchronously after a publish lands in the ring buffer.

```php
do_action( 'desktop_mode_debug_publish', string $session_id, string $channel, mixed $payload );
```

### `desktop_mode_debug_ring_size` — Experimental (filter)

Override the per-(session, channel) ring buffer cap. Default 500.

### `desktop_mode_debug_channels` — Experimental (filter)

Declare the full set of channels for a given session id. Read by `GET /wp-desktop/v1/debug` when no `channel` / `channels[]` query parameter is present.

### `desktop_mode_debug_rest_permission` — Experimental (filter)

Override the default `manage_options` permission gate on `GET /wp-desktop/v1/debug`.

See [`docs/examples/devtools-instrumentation.md`](./examples/devtools-instrumentation.md) for the full walkthrough — header contributions, observe mode, debug bus.

---

## Recycle Bin

The Recycle Bin window captures attachments into the WordPress trash (posts and pages already trash by default) and exposes browse / restore / purge over REST. Every decision the bin makes is filterable.

### `wp_desktop_recycle_bin_capture_post_types` — Experimental (filter)

Post types whose deletions the bin tracks. Defaults to `[ 'post', 'page', 'attachment' ]`. Returning a list excluding `attachment` disables the soft-delete interception entirely — vanilla `wp_delete_attachment()` resumes.

```php
add_filter( 'wp_desktop_recycle_bin_capture_post_types', function ( $types ) {
    $types[] = 'product';
    return $types;
} );
```

### `wp_desktop_recycle_bin_should_capture` — Experimental (filter)

Per-attachment opt-out. Returning `false` for a specific `WP_Post` lets that single deletion bypass the bin.

```php
apply_filters( 'wp_desktop_recycle_bin_should_capture', bool $capture, WP_Post $post );
```

### `wp_desktop_recycle_bin_query_args` — Experimental (filter)

Customize the `WP_Query` args used to populate the bin — scope it to the current user, restrict by role, or interleave additional post types beyond the capture list.

```php
apply_filters( 'wp_desktop_recycle_bin_query_args', array $query_args, array $caller_args );
```

### `wp_desktop_recycle_bin_items` / `wp_desktop_recycle_bin_item` — Experimental (filter)

`..._item` reshapes a single row before it's returned to JS; `..._items` filters the final list. The `id`, `type`, and `deleted_at` fields are load-bearing — keep them when extending.

```php
apply_filters( 'wp_desktop_recycle_bin_item', array $item, WP_Post $post );
apply_filters( 'wp_desktop_recycle_bin_items', array $items, WP_Query $query );
```

### `wp_desktop_recycle_bin_user_can_view|restore|purge|use` — Experimental (filter)

Per-item capability gates. `_use` controls whether the bin window is registered at all for the current user; the others gate individual operations. Defaults: `_use` → `edit_posts`, `_view` → `edit_post`, `_restore`/`_purge` → `delete_post` (the same gate WP itself uses for trash/untrash).

### `wp_desktop_recycle_bin_window_args` / `wp_desktop_recycle_bin_icon_args` — Experimental (filter)

Tweak the args passed to `desktop_mode_register_window()` / `desktop_mode_register_icon()` for the bin — useful to change dimensions, swap the dashicon, or move the window from the taskbar to the dock.

### `wp_desktop_recycle_bin_template_html` — Experimental (filter)

The full template body before it's emitted into the native-window template element. Keep the `data-wpdm-recycle-bin-*` hooks intact so the JS bundle can find its mount points.

### Lifecycle actions

```php
do_action( 'wp_desktop_recycle_bin_item_captured', int $post_id, int $user_id, string $now_gmt );
do_action( 'wp_desktop_recycle_bin_before_restore', int $post_id, WP_Post $post );
do_action( 'wp_desktop_recycle_bin_after_restore',  int $post_id );
do_action( 'wp_desktop_recycle_bin_before_purge',   int $post_id, WP_Post $post );
do_action( 'wp_desktop_recycle_bin_after_purge',    int $post_id, string $type );
do_action( 'wp_desktop_recycle_bin_emptied',        int $purged, int $skipped );
```

### REST endpoints

| Method | Route | Purpose |
|---|---|---|
| `GET`  | `/wp-desktop/v1/recycle-bin` | List trashed items (`page`, `per_page`, `type`, `search`). |
| `POST` | `/wp-desktop/v1/recycle-bin/restore` | Restore by id. Body: `{ ids: int[] }`. |
| `POST` | `/wp-desktop/v1/recycle-bin/purge` | Permanently delete. Body: `{ ids: int[] }`. |
| `POST` | `/wp-desktop/v1/recycle-bin/empty` | Empty everything the current user can purge. |

### JS extension points

- `wp.hooks.applyFilters( 'wp_desktop.recycleBin.columns', cols )` — append/replace `<wpd-table>` columns.
- `document.addEventListener( 'wp-desktop-recycle-bin-changed', e => …)` — fired after every restore / purge / empty with `{ kind, ok, errors, source }`. `source` is `'local'` (the bin's own action), `'chromeless'` (a delete in another window's iframe), or `'heartbeat'` (a delete elsewhere — other tab, REST, WP-CLI).
- `wp.hooks.doAction( 'wp_desktop.recycleBin.changed', …)` — same payload, hook-bus form.

### Cross-window broadcast

After every restore / purge / empty the bin publishes one topic
**per affected post type** on the shell-wide broadcast bus
(`wp.desktop.broadcast`). The same chromeless footer in
`realtime.php` also emits these topics for any admin request
that ran `wp_trash_post` / `untrash_post` / `before_delete_post`
/ `trashed_comment` / `untrashed_comment` / `deleted_comment` —
so the recycle bin learns instantly when a list-table trashes
something, and the corresponding list iframe refreshes when the
bin restores something.

Topic format: **`wp-desktop.<post_type>.changed`** — the literal
post-type slug (`post`, `page`, `attachment`, `comment`, or any
CPT). Payload:

```js
{ source: 'recycle-bin' | 'admin' | <plugin>,
  action: 'trashed' | 'untrashed' | 'deleted',
  ids:    number[] }
```

**Iframe-side default behaviour: soft reload.** The chromeless
bridge installs a built-in subscriber that, when the topic
matches the iframe's current page, *fetches the URL it's already
on* and replaces `#wpbody-content` in place. The user sees the
list update — restored post appears, trashed media disappears —
without the WP loading spinner that `location.reload()` would
show. Mappings:

| Topic                              | List page                           |
|------------------------------------|-------------------------------------|
| `wp-desktop.post.changed`          | `edit.php` (post type unset / `post`) |
| `wp-desktop.page.changed`          | `edit.php?post_type=page`           |
| `wp-desktop.attachment.changed`    | `upload.php`                        |
| `wp-desktop.comment.changed`       | `edit-comments.php`                 |

Single-edit pages (`post.php`, `post-new.php`) deliberately have
**no** soft-reload handler, because replacing their body would
destroy unsaved Gutenberg / classic-editor state. Plugins wanting
specific behaviour for those pages subscribe to the same topic
themselves and decide how to react.

After every successful soft-reload the bridge dispatches
`wp-desktop-soft-reloaded` on the iframe's `document` so plugins
that need to re-bind state (e.g. their own custom widgets in the
list table) have a single signal to listen for.

**Plugin extension.** Subscribers from anywhere (parent shell,
native windows, iframes) can use the bus directly:

```js
wp.desktop.subscribe( 'wp-desktop.post.changed', ( payload ) => {
    if ( payload.action === 'untrashed' ) {
        myEditorRedrawSidebar( payload.ids );
    }
} );
```

Iframe-side admin pages subscribe via plain DOM:

```js
document.addEventListener( 'wp-desktop-broadcast', ( e ) => {
    if ( e.detail.topic !== 'wp-desktop.post.changed' ) return;
    // your custom handling — fires after the built-in soft reload
} );
```

### Real-time signal

The bin window updates without polling via two channels:

1. **Chromeless `postMessage` (instant).** Whenever a delete fires inside an iframe-rendered admin page (e.g. "Move to Trash" on `post.php`), `realtime.php` emits an inline footer script that posts `{ type: 'wp-desktop-recycle-bin-changed', ts }` to the parent shell.
2. **Heartbeat (catch-all, ≤15 s).** A delete also bumps `_wpdm_recycle_bin_change_ts` (autoload=false). While the bin window is open, its tab enqueues `wpdm_recycle_bin_seen_ts` on every Heartbeat tick; the `heartbeat_received` filter answers `{ changed, ts }`. Closed-bin tabs send nothing — zero per-tick cost.

Hook this to push your own real-time channel (websocket, SSE) without re-listening on every delete action:

```php
do_action( 'wp_desktop_recycle_bin_signal', int $ts_ms );
```

Suppress the chromeless footer emit per request:

```php
apply_filters( 'wp_desktop_recycle_bin_emit_footer_signal', bool $emit );
```

See [`docs/examples/recycle-bin.md`](./examples/recycle-bin.md) for end-to-end recipes (custom post types, audit logging, custom columns).

---

## Presence

Framework-level presence tracking. Storage in
`_wp_desktop_presence` (autoload=false, single row keyed by user
id). The WordPress Heartbeat carries the bumps + visibility
snapshot; the JS API at `wp.desktop.presence.*` fans out to
plugin code. See [`examples/presence.md`](./examples/presence.md)
for a copy-pasteable recipe.

### Filters — Stable

```php
apply_filters( 'wp_desktop_presence_inactive_after', $seconds );  // default 300 (5m)
apply_filters( 'wp_desktop_presence_offline_after',  $seconds );  // default 120 (2m)
apply_filters( 'wp_desktop_presence_can_track',      $can, $user_id );
apply_filters( 'wp_desktop_presence_visible_users',  $ids, $viewer_id );
```

- **`wp_desktop_presence_inactive_after`** — seconds without
  user input before `online` demotes to `inactive`. Tune up for
  long-form writing tools, down for chat-heavy environments.
- **`wp_desktop_presence_offline_after`** — seconds without a
  heartbeat before any tracked user is considered `offline`.
- **`wp_desktop_presence_can_track`** — per-user veto. Return
  `false` to skip the bump entirely (compliance flags,
  "appear invisible" toggles, allow-list policies).
- **`wp_desktop_presence_visible_users`** — privacy gate.
  Receives the candidate id list + the viewer id, returns the
  list narrowed to whoever this viewer should see. Default
  passes through unchanged. Plugins building team boundaries
  hook here.

### Actions — Stable

```php
do_action( 'wp_desktop_presence_recorded', $user_id, $record );
do_action( 'wp_desktop_presence_changed',  $user_id, $new_status, $old_status );
```

- **`wp_desktop_presence_recorded`** — fires on every heartbeat
  bump, whether status changed or not. Be cheap inside this
  callback — it runs on every Heartbeat tick for every active
  desktop-mode user.
- **`wp_desktop_presence_changed`** — fires only on real status
  transitions (`online ↔ inactive ↔ offline`). The right hook
  for "user came online → notify a slack channel" type work.

### PHP helpers (since 0.5.5)

```php
desktop_mode_presence_record( $user_id, $active = true );
desktop_mode_presence_status_for_user( $user_id );
desktop_mode_presence_get_all();
desktop_mode_presence_snapshot( $user_ids = null );
desktop_mode_presence_status_from_record( $record );    // pure compute helper
desktop_mode_presence_visible_users( $ids, $viewer_id );
```

### REST endpoints

| Method | Route | Purpose |
|---|---|---|
| `GET`  | `/wp-desktop/v1/presence` | Visible-users snapshot for the current viewer. |
| `POST` | `/wp-desktop/v1/presence` | Bump (`{active:true}`), heartbeat-only (`{active:false}`), or "set yourself away" (`{inactive:true}`). |

---

## Window-chrome customization framework — Stable (since 0.6.0)

Four-layer per-window appearance system. Layers 1-3 are Stable;
Layer 4 (custom chrome render) is **Experimental**. Full recipes:
[themes](./examples/window-theme.md), [controls](./examples/window-controls.md),
[slots](./examples/window-slot.md), [custom chrome](./examples/custom-chrome.md).

### Layer 1 — Themes (Stable)

```php
desktop_mode_register_window_theme_script( $handle );        // primary, low-ceremony
desktop_mode_register_window_theme( $args );                  // optional metadata
```

`$args`: `id`, `label`, `tokens` (CSS-variable map, keys must start with `--`), `priority` (default 100), `script` (optional handle).

Actions:
- `desktop_mode_window_theme_script_registered( $handle )`
- `desktop_mode_window_theme_registered( $id, $entry )`

### Layer 2 — Controls (Stable)

```php
desktop_mode_register_window_control_script( $handle );
desktop_mode_register_window_control( $args );
```

`$args`: `id`, `label`, `icon`, `placement` (`'left'|'right'|'controls'`, default `'left'`), `order` (default 100), `script`.

Built-in control ids registered by the framework: `core/minimize`, `core/maximize`, `core/focus-tab`, `core/detach`, `core/close`. Plugins can `unregisterWindowControl()` any of them globally, or use per-window `appearance.controls.{order, hide, custom}` for window-scoped mutations.

Actions:
- `desktop_mode_window_control_script_registered( $handle )`
- `desktop_mode_window_control_registered( $id, $entry )`

### Layer 3 — Slots (Stable)

```php
desktop_mode_register_window_slot_script( $handle );
desktop_mode_register_window_slot( $args );
```

`$args`: `id`, `slot` (one of `before-titlebar`, `before-icon`, `icon`, `title`, `after-title`, `before-controls`, `after-controls`, `after-titlebar`), `order` (default 100), `script`.

Actions:
- `desktop_mode_window_slot_script_registered( $handle )`
- `desktop_mode_window_slot_registered( $id, $entry )`

### Layer 4 — Custom chrome (Experimental)

```php
desktop_mode_register_window_chrome_script( $handle );
desktop_mode_register_window_chrome( $args );
```

`$args`: `id`, `label`, `script`. **Experimental** — chrome render contract may change.

Actions:
- `desktop_mode_window_chrome_script_registered( $handle )`
- `desktop_mode_window_chrome_registered( $id, $entry )`

---

## See also

- [JavaScript Reference](./javascript-reference.md) — the event + postMessage side of the contract.
- [Examples](./examples/README.md) — full-plugin recipes.
