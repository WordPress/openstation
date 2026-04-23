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

A few concepts ARE mirrored (e.g. `wp_desktop_dock_items` PHP filter ↔ `wp-desktop.widgets` JS filter — both shape registries), but most aren't. Don't be surprised if a JS hook has no PHP counterpart or vice versa — that's the design.

---

## Actions

### `wp_desktop_mode_init` — Stable
Fires once inside the parent shell render, after desktop assets have been enqueued. Use this to enqueue your own shell-side JS/CSS.

```php
do_action( 'wp_desktop_mode_init' );
```

**Example:**

```php
add_action( 'wp_desktop_mode_init', function () {
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

### `wp_desktop_shell_before` — Stable
Fires just before the shell's opening `<div id="wp-desktop-shell">`. Echo HTML here to prepend sibling markup (e.g. a global announcement banner that sits above the shell).

```php
do_action( 'wp_desktop_shell_before' );
```

---

### `wp_desktop_shell_after` — Stable
Fires just after the shell's closing `</div>`. Echo HTML to append below it.

```php
do_action( 'wp_desktop_shell_after' );
```

---

### `wp_desktop_chromeless_styles` — Stable
Fires inside iframe (chromeless) requests, during `admin_enqueue_scripts`. Use it to enqueue **iframe-scoped** CSS that fine-tunes how specific admin pages render inside a window.

```php
do_action( 'wp_desktop_chromeless_styles' );
```

**Example:**

```php
add_action( 'wp_desktop_chromeless_styles', function () {
    wp_add_inline_style(
        'wp-desktop-chromeless',
        'body.edit-php .subsubsub { margin-top: 4px; }'
    );
} );
```

---

### `wp_desktop_native_window_registered` — Stable

Fires after `wp_register_desktop_window()` successfully stores a window. Does NOT fire when the registration returns a `WP_Error`.

```php
do_action( 'wp_desktop_native_window_registered', string $id, array $entry );
```

**Example — react when another plugin registers a window:**

```php
add_action( 'wp_desktop_native_window_registered', function ( $id, $entry ) {
    if ( 'jorvy' === $id ) {
        // Attach a companion behavior only when Jorvy is present.
    }
}, 10, 2 );
```

---

### `wp_desktop_widget_registered` — Stable

Fires after `wp_register_desktop_widget()` successfully stores a widget. Same contract as the native-window action.

```php
do_action( 'wp_desktop_widget_registered', string $id, array $entry );
```

---

### `wp_desktop_wallpaper_registered` — Stable

Fires after `wp_register_desktop_wallpaper()` successfully stores a wallpaper. Same contract.

```php
do_action( 'wp_desktop_wallpaper_registered', string $id, array $entry );
```

---

### `wp_desktop_icon_registered` — Stable

Fires after `wp_register_desktop_icon()` successfully stores a desktop shortcut tile. Same contract as the other registration actions — no fire on `WP_Error` return.

---

### `wp_desktop_command_script_registered` — Stable

Fires after `wp_desktop_register_command_script()` stores a command-palette script handle. Also fires when `wp_register_desktop_command()` implicitly registers its `script` argument.

```php
do_action( 'wp_desktop_command_script_registered', string $handle );
```

### `wp_desktop_command_registered` — Stable

Fires after `wp_register_desktop_command()` successfully stores a command's metadata. Does not fire on `WP_Error`.

```php
do_action( 'wp_desktop_command_registered', string $slug, array $entry );
```

### `wp_desktop_register_command_script( $handle )` — Stable (PHP function)

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
wp_desktop_register_command_script( 'home-assistant-commands' );
```

For live *unregistration* on deactivation, the plugin's JS should set `owner: 'home-assistant-commands'` on each `registerCommand` call — see `docs/javascript-reference.md`. Untagged commands stay until the next page reload.

### `wp_register_desktop_command( $args )` — Stable (PHP function)

Optional companion that also declares command metadata server-side. Advisory today — reserved for future pre-registration shims (showing a greyed-out command before the plugin's JS loads). Implicitly calls `wp_desktop_register_command_script( $args['script'] )` when `script` is provided.

```php
wp_register_desktop_command( array(
    'slug'        => 'ha-lights',
    'label'       => __( 'Home Assistant: Lights', 'home-assistant' ),
    'description' => __( 'Toggle smart lights from the palette.', 'home-assistant' ),
    'icon'        => 'dashicons-lightbulb',
    'hint'        => '[room]',
    'script'      => 'home-assistant-commands',
) );
```

```php
do_action( 'wp_desktop_icon_registered', string $id, array $entry );
```

---

### `wp_desktop_window_tab_registered` — Stable

Fires after `wp_register_desktop_window_tab()` successfully attaches a tab to a native window. Useful for companion plugins that need to follow up (e.g. register a help overlay only when a Stats tab actually exists).

```php
do_action( 'wp_desktop_window_tab_registered', string $window_id, string $value, array $entry );
```

---

### `wp_desktop_chromeless_after` — Stable
Fires in the `admin_footer` of chromeless iframe requests. Receives the current admin page's `$hook_suffix`.

```php
do_action( 'wp_desktop_chromeless_after', $hook_suffix );
```

**Example — emit a ready ping from the iframe:**

```php
add_action( 'wp_desktop_chromeless_after', function ( $hook_suffix ) {
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

### `wp_desktop_prepare_window` — Planned
Will fire once per window the shell is about to construct (both on fresh open and session restore). Planned signature:

```php
do_action( 'wp_desktop_prepare_window', string $page, array $args );
```

---

## Filters

### `wp_desktop_mode_enabled` — Stable

Gates whether desktop mode can be activated (or stay active) for a given user. The AJAX save endpoint consults this after the nonce check.

```php
apply_filters( 'wp_desktop_mode_enabled', bool $enabled, int $user_id );
```

**Example — disable for contributors:**

```php
add_filter( 'wp_desktop_mode_enabled', function ( $enabled, $user_id ) {
    if ( user_can( $user_id, 'contributor' ) && ! user_can( $user_id, 'edit_posts' ) ) {
        return false;
    }
    return $enabled;
}, 10, 2 );
```

A `false` return means the user cannot toggle the mode on — the AJAX endpoint returns `desktop_mode_disabled`.

---

### `wp_desktop_shell_config` — Stable

The JS configuration blob injected as `window.wpDesktopConfig`. Powers the window manager, dock, and session restore. Filter this to inject custom payloads the shell can read at boot.

```php
apply_filters( 'wp_desktop_shell_config', array $config );
```

`$config` shape:

```php
array(
    'currentPage'    => string,   // e.g. 'http://localhost:8889/wp-admin/'
    'currentTitle'   => string,   // human title of the current page
    'currentIcon'    => string,   // dashicons-* class
    'adminUrl'       => string,   // admin_url()
    'portalUrl'      => string,   // wpdm_portal_url()
    'sessionUrl'     => string,   // REST session URL
    'restNonce'      => string,   // X-WP-Nonce
    'dockItems'      => array[],  // see wp_desktop_dock_items
    'session'        => array,    // prior session snapshot or empty
)
```

**Example — add a flag for your feature:**

```php
add_filter( 'wp_desktop_shell_config', function ( $config ) {
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

### `wp_desktop_dock_items` — Stable

The final list of dock items, as an array of item arrays. Return a modified list — add, remove, reorder.

```php
apply_filters( 'wp_desktop_dock_items', array $items );
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
add_filter( 'wp_desktop_dock_items', function ( $items ) {
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
add_filter( 'wp_desktop_dock_items', function ( $items ) {
    return array_values( array_filter( $items, fn( $i ) => 'edit-comments.php' !== $i['slug'] ) );
} );
```

---

### `wp_desktop_dock_item` — Stable

Fires for each item as the dock is assembled, with the source admin-menu slug for context.

```php
apply_filters( 'wp_desktop_dock_item', array $item, string $menu_slug );
```

**Example — rewrite the Posts icon:**

```php
add_filter( 'wp_desktop_dock_item', function ( $item, $slug ) {
    if ( 'edit.php' === $slug ) {
        $item['icon'] = 'dashicons-welcome-write-blog';
    }
    return $item;
}, 10, 2 );
```

---

### `wp_desktop_dock_item_multi` — Stable

Controls whether a dock item supports multiple simultaneous windows. Multi-capable pages expose a "+" chip on the dock icon and an "Open another" action in the window's title-bar menu; singletons always focus the existing window when re-opened.

Built-in defaults: `edit.php`, `edit-tags.php`, `upload.php`, `users.php`, and `edit-comments.php` are multi; everything else is singleton. The base filename is matched against the list, so every CPT (`edit.php?post_type=page`) and every taxonomy inherits the same rule as its parent admin file.

```php
apply_filters( 'wp_desktop_dock_item_multi', bool $multi, string $menu_slug );
```

**Example — let a custom plugin page open multiple windows:**

```php
add_filter( 'wp_desktop_dock_item_multi', function ( $multi, $slug ) {
    if ( 'my-plugin-entities' === $slug ) {
        return true;
    }
    return $multi;
}, 10, 2 );
```

**Example — force Users into singleton mode:**

```php
add_filter( 'wp_desktop_dock_item_multi', function ( $multi, $slug ) {
    return 'users.php' === $slug ? false : $multi;
}, 10, 2 );
```

---

### `wp_desktop_dock_placement` — Stable

Chooses where a menu item appears in the desktop shell. Three values are recognized:

- `'dock'` — left-edge vertical strip (core WordPress menus — Dashboard, Posts, Media, Users, Settings, CPTs, taxonomies…).
- `'taskbar'` — bottom horizontal pill (default for installed-plugin top-level menus routed through `admin.php?page=*`).
- `'hidden'` — suppress the item entirely. The underlying admin menu entry still exists server-side; this only prevents rendering on either desktop-mode rail. Plugins that don't want to claim chrome real estate (utility tools, background services, plugins that render only into existing surfaces) set this.

```php
apply_filters( 'wp_desktop_dock_placement', string $placement, string $menu_slug );
```

The built-in routing heuristic (`wpdm_dock_placement`) returns `'dock'` for:

- Hardcoded core menu files (`index.php`, `edit.php`, `upload.php`, `plugins.php`, `users.php`, `tools.php`, `options-*.php`, `themes.php`, `site-health.php`, `update-core.php`, and every admin file in the core allowlist).
- Every `edit.php?post_type=*` route (all Custom Post Types render alongside core menus).
- Every `edit-tags.php?taxonomy=*` route (taxonomies follow their parent).

Every other top-level menu returns `'taskbar'`. Return `'dock'` to promote a plugin menu onto the left rail, `'taskbar'` to demote a core-looking menu out of it, or `'hidden'` to remove it from the shell entirely.

Return values other than those three are silently ignored — the item falls back to the default. That keeps a misbehaving filter (returning `null`, a bool, etc.) from corrupting the rail split.

**Example — pin a plugin menu to the left dock because it's a first-class admin surface on this install:**

```php
add_filter( 'wp_desktop_dock_placement', function ( $placement, $slug ) {
    if ( 'woocommerce' === $slug ) {
        return 'dock';
    }
    return $placement;
}, 10, 2 );
```

**Example — move Tools down to the taskbar because the site never uses it:**

```php
add_filter( 'wp_desktop_dock_placement', function ( $placement, $slug ) {
    if ( 'tools.php' === $slug ) {
        return 'taskbar';
    }
    return $placement;
}, 10, 2 );
```

**Example — hide a plugin from the shell entirely (from inside that plugin's own PHP):**

```php
add_filter( 'wp_desktop_dock_placement', function ( $placement, $slug ) {
    if ( 'my-background-tool' === $slug ) {
        return 'hidden';
    }
    return $placement;
}, 10, 2 );
```

The split happens once per request, server-side, in `includes/render.php` — each item's `placement` key is computed when `wpdm_build_dock_items()` runs, then the shell splits the list into `config.dockItems` + `config.taskbarItems` before localizing to JS. Hidden items are dropped before either list is built. The client never re-sorts, so the filter is the only place to override routing.

The live menu-refresh endpoint (`GET /wp-desktop/v1/menu`, fired after plugin activation / deactivation inside a windowed `plugins.php`) runs the same builder, so a filter change takes effect without a full tab reload.

---

### `wp_desktop_arrange_menu_items` — Stable

The list of plugin-contributed items appended to the admin bar's **Arrange** submenu — the dropdown that sits next to the "Switch to…" toggle when desktop mode is active. Built-ins (Cascade, Overview, Snap to grid, Tile all windows) are always present; this filter adds to them. Only invoked when the user is viewing the desktop shell.

```php
apply_filters( 'wp_desktop_arrange_menu_items', array $items );
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
add_filter( 'wp_desktop_arrange_menu_items', function ( $items ) {
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

### `wp_desktop_portal_auto_enable` — Stable

When a user lands on `/wp-desktop/` without desktop mode enabled, the portal auto-enables it for them by default. Return `false` to require an explicit toggle instead.

```php
apply_filters( 'wp_desktop_portal_auto_enable', bool $auto_enable, int $user_id );
```

**Example:**

```php
add_filter( 'wp_desktop_portal_auto_enable', '__return_false' );
```

---

### `wp_desktop_admin_redirect_to_portal` — Stable

Governs the `admin_init` redirect from classic `/wp-admin/` URLs to `/wp-desktop/` for users with desktop mode on. Return `false` to keep the user on the classic URL even when they have the mode enabled (useful for support sessions).

```php
apply_filters( 'wp_desktop_admin_redirect_to_portal', bool $redirect, int $user_id );
```

---

### `wp_desktop_accent_colors` — Stable

Extends or restricts the accent-color swatches shown in OS Settings. Applied to `--wp-admin-theme-color` on the shell's `<html>`. Each entry is `{ id: string, label: string, value: string }` — `id` is a stable slug persisted to `localStorage`, `label` is the picker tooltip, `value` is a hex color validated server-side via `sanitize_hex_color()`. Invalid entries are dropped; a filter that leaves the list empty falls back to the built-in six swatches.

```php
apply_filters( 'wp_desktop_accent_colors', array $colors );
```

**Example — add a brand swatch:**

```php
add_filter( 'wp_desktop_accent_colors', function ( $colors ) {
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
add_filter( 'wp_desktop_accent_colors', function () {
    return array(
        array( 'id' => 'corporate', 'label' => 'Corporate', 'value' => '#003366' ),
    );
} );
```

---

### `wp_desktop_toast_types` — Stable

Extends the toast-notification type map the shell consumes when a plugin calls `wp.desktop.toast( id, … )`. Each entry is `{ id, label, icon, tone }` where `tone` is one of `positive | warning | critical | neutral`. Entries with an unknown tone are dropped.

```php
apply_filters( 'wp_desktop_toast_types', array $types );
```

**Example — register an `update-available` toast style:**

```php
add_filter( 'wp_desktop_toast_types', function ( $types ) {
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

### `wp_desktop_default_wallpaper` — Stable

Chooses the wallpaper slug applied on first boot for a new user (and as the fallback when a user's saved wallpaper was registered by a plugin that's since been deactivated). Return a registered wallpaper id. Output is normalised with `sanitize_key()`.

```php
apply_filters( 'wp_desktop_default_wallpaper', string $id );
```

**Example — ship `aurora` as the brand default:**

```php
add_filter( 'wp_desktop_default_wallpaper', fn () => 'aurora' );
```

---

### `wp_desktop_wallpapers` — Stable

Last-chance filter over the full wallpaper registry before it ships to the shell as `config.serverWallpapers`. Each entry is the shape stored by `wp_register_desktop_wallpaper()` (`id`, `label`, `preview`, `type`, `value`, `script`). Use this to reorder, rename, remove, or override wallpaper entries — including the built-in presets.

Mirrors the client-side `wp-desktop.wallpapers` JS filter but runs earlier, before any wallpaper reaches the browser.

```php
apply_filters( 'wp_desktop_wallpapers', array $registry );
```

**Example — hide the `sunset` preset from this site:**

```php
add_filter( 'wp_desktop_wallpapers', function ( $registry ) {
    unset( $registry['sunset'] );
    return $registry;
} );
```

**Example — rename the `dark` preset to match a brand:**

```php
add_filter( 'wp_desktop_wallpapers', function ( $registry ) {
    if ( isset( $registry['dark'] ) ) {
        $registry['dark']['label'] = __( 'Acme Dark', 'my-plugin' );
    }
    return $registry;
} );
```

A filter that returns a non-array value drops the list entirely (empty `serverWallpapers` in the shell config). The built-in presets register on `init` priority 5, so any filter hooking later than that sees the full built-in set in its input.

---

### `wp_desktop_icons` — Stable

Last-chance filter over the desktop-icon registry before it ships to the shell as `config.desktopIcons`. Each entry is the shape stored by `wp_register_desktop_icon()` (`id`, `title`, `icon`, `window`, `url`, `position`).

```php
apply_filters( 'wp_desktop_icons', array $registry );
```

**Example — hide a plugin's icon for users on a specific role:**

```php
add_filter( 'wp_desktop_icons', function ( $registry ) {
    if ( ! current_user_can( 'manage_options' ) ) {
        unset( $registry['jorvy'] );
    }
    return $registry;
} );
```

---

### `wp_desktop_window_tabs` — Stable

Last-chance filter over the ordered tab list for a native window. Each entry is `{ value, label, template, script, is_main, position }`. Lets a late-loading plugin reorder, hide, or relabel tabs another plugin registered (or the window's own main tab).

```php
apply_filters( 'wp_desktop_window_tabs', array $tabs, string $window_id );
```

**Example — hide the About tab on production sites:**

```php
add_filter( 'wp_desktop_window_tabs', function ( $tabs, $window_id ) {
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

### `wp_desktop_native_window_tab_wrap_padding` — Stable

Overrides the inline padding (in pixels) of the auto-generated tab wrapper the shell injects around a multi-tab native window. Only fires when `wp_register_desktop_window_tab()` produces the auto-wrap (a native window with at least one additional tab); single-pane windows never see this filter. Return an integer number of pixels — the value is cast via `(int)` before being emitted as the wrapper's `padding` attribute, so CSS length strings like `'1.5rem'` will cast to `0`. Pass `0` for edge-to-edge content.

```php
apply_filters( 'wp_desktop_native_window_tab_wrap_padding', int $padding, string $window_id );
```

**Example — zero-pad one specific window's tab panels:**

```php
add_filter( 'wp_desktop_native_window_tab_wrap_padding', function ( $padding, $window_id ) {
    return 'my-plugin/editor' === $window_id ? 0 : $padding;
}, 10, 2 );
```

---

## AI Copilot hooks — Stable

The AI assistant (Cmd+K palette) runs an OpenAI agentic loop server-side, analyses entities on save, and exposes a search REST endpoint. Every decision point is hookable so plugins can adjust model selection, customise prompts, limit which entities get analysed, or react to analysis completion.

### `wp_desktop_ai_model` — Stable

Overrides the OpenAI model used per schema. Defaults to `'gpt-4o-mini'`. `$schema_name` identifies the call site (`'search'`, `'analyze_content'`, `'analyze_comment'`, etc.).

```php
apply_filters( 'wp_desktop_ai_model', string $model, string $schema_name );
```

```php
add_filter( 'wp_desktop_ai_model', function ( $model, $schema ) {
    return 'search' === $schema ? 'gpt-4o' : $model;
}, 10, 2 );
```

### `wp_desktop_ai_supported_post_types` / `wp_desktop_ai_supported_taxonomies` — Stable

Gate which post types and taxonomies receive auto-analysis on save. Defaults include `post`, `page`, and all public custom post types / taxonomies.

```php
apply_filters( 'wp_desktop_ai_supported_post_types', array $types );
apply_filters( 'wp_desktop_ai_supported_taxonomies', array $taxonomies );
```

### `wp_desktop_ai_supported_types` — Stable

Umbrella gate applied by the job scheduler (`wpdm_ai_schedule_job`). Return a subset of `[ 'post', 'term', 'comment' ]` to disable a whole entity class.

```php
apply_filters( 'wp_desktop_ai_supported_types', array $types );
```

### `wp_desktop_ai_schema_content` / `wp_desktop_ai_schema_comment` — Experimental

Mutate the JSON Schema handed to OpenAI for structured-output post/term and comment analysis. Use this to add custom fields (brand voice scoring, compliance flags, …) the model should populate.

```php
apply_filters( 'wp_desktop_ai_schema_content', array $schema );
apply_filters( 'wp_desktop_ai_schema_comment', array $schema );
```

### `wp_desktop_ai_post_prompt` / `wp_desktop_ai_term_prompt` / `wp_desktop_ai_comment_prompt` — Stable

Customise the user-side prompt handed to the model per entity. Each filter receives the default prompt plus the entity object.

```php
apply_filters( 'wp_desktop_ai_post_prompt',    string $prompt, WP_Post    $post );
apply_filters( 'wp_desktop_ai_term_prompt',    string $prompt, WP_Term    $term );
apply_filters( 'wp_desktop_ai_comment_prompt', string $prompt, WP_Comment $comment );
```

### `wp_desktop_ai_post_analyzed` / `wp_desktop_ai_term_analyzed` / `wp_desktop_ai_comment_analyzed` — Stable

Fire after a successful analysis. The result array contains the fields emitted by the schema (typically `summary`, `topics`, `sentiment`, `embedding`, …). Use these to mirror data into a custom index or trigger downstream jobs.

```php
do_action( 'wp_desktop_ai_post_analyzed',    int $post_id,    array $result, WP_Post    $post );
do_action( 'wp_desktop_ai_term_analyzed',    int $term_id,    array $result, WP_Term    $term );
do_action( 'wp_desktop_ai_comment_analyzed', int $comment_id, array $result, WP_Comment $comment );
```

### `wp_desktop_ai_admin_page_catalog` — Stable

Last-chance filter over the catalog of admin pages the AI search tool can link to. Each entry is `{ id, title, url, description }`. Plugins that expose admin UIs typically inject their top-level pages here so the assistant can offer them as navigation results.

```php
apply_filters( 'wp_desktop_ai_admin_page_catalog', array $catalog );
```

### `wp_desktop_ai_error_log_candidates` — Experimental

Filter the set of error candidates the AI exposes when the user asks about site health. Return an array of `{ message, source, timestamp }`.

```php
apply_filters( 'wp_desktop_ai_error_log_candidates', array $candidates );
```

---

## Planned (not yet fired)

The filters and actions below are **reserved names** documented for forward compatibility. They will land with the phase indicated. Do not register listeners in production code until the status flips to Stable.

### Window — Phase 3
```php
apply_filters( 'wp_desktop_window_args',           array $args, string $page );
apply_filters( 'wp_desktop_window_reuse',          bool  $reuse, string $page );
apply_filters( 'wp_desktop_window_excluded_pages', array $excluded );
```

### Taskbar — Phase 3
```php
apply_filters( 'wp_desktop_taskbar_items',    array  $items );
apply_filters( 'wp_desktop_taskbar_tray',     array  $tray );
apply_filters( 'wp_desktop_taskbar_position', string $position );
```

### Dock (extended) — Phase 3+
```php
apply_filters( 'wp_desktop_dock_position', string $position );   // 'left' | 'bottom'
apply_filters( 'wp_desktop_dock_style',    array  $style );      // icon size, gap, blur
```

### Desktop area — Phase 4+
```php
apply_filters( 'wp_desktop_wallpaper',    string $url,   string $color_scheme );
apply_filters( 'wp_desktop_context_menu', array  $menu_items );
apply_filters( 'wp_desktop_icon',         array  $icon_config, string $icon_id );
```

> `wp_desktop_icons` and `wp_desktop_wallpapers` and the widget registry filter are **shipped** — see their Stable entries above. `wp_desktop_widgets` is not a PHP filter; the JS-side `wp-desktop.widgets` filter is the canonical hook (widgets are declared via `wp_register_desktop_widget()` server-side).

### Responsive — Phase 5–6
```php
apply_filters( 'wp_desktop_mode_type',           string $mode );   // 'desktop' | 'tablet' | 'mobile'
apply_filters( 'wp_desktop_mobile_grid_items',   array  $items );
apply_filters( 'wp_desktop_mobile_tab_bar',      array  $tabs );
apply_filters( 'wp_desktop_mobile_app_switcher', array  $cards );
apply_filters( 'wp_desktop_tablet_split_config', array  $config );
```

### Native windows — reserved extensions
```php
apply_filters( 'wp_desktop_native_windows',       array $windows );
apply_filters( 'wp_desktop_native_window_config', array $window_config, string $window_id );
```

> Native windows themselves are **shipped** (0.11.0) — plugins declare them with `wp_register_desktop_window()` and react via the Stable registration actions (`wp_desktop_native_window_registered`) and JS lifecycle hooks (`wp-desktop.native-window.before-render` / `after-render` / `before-close`). The two filter names above are reserved for a future read-only view of the registry and per-window config overrides.

### Drag & Drop — Phase 8
```php
apply_filters( 'wp_desktop_drag_mime_types', array $mime_types );
apply_filters( 'wp_desktop_drag_payload',    array $payload, string $source_page, string $target_page );
apply_filters( 'wp_desktop_drop_accepts',    bool  $accepts, array $payload, string $target_page );
```

### Body classes — Stable (applied, filter planned)
```php
apply_filters( 'wp_desktop_body_classes', string $classes );
```
Currently the `wp-desktop-active` / `wp-desktop-chromeless` classes are added unfiltered via `admin_body_class`. A named filter is planned.

---

## Registration functions

Shell extension points — windows, widgets, wallpapers — are declared through `wp_register_desktop_*()` PHP functions that mirror Core's `register_*` conventions. Every function returns `true` on success and `WP_Error` on any validation failure, with a stable error code callers can branch on.

```php
$result = wp_register_desktop_window( 'jorvy', array(
    'title'    => 'Jorvy',
    'template' => 'jorvy_render_template',
    'script'   => 'jorvy-render',
) );

if ( is_wp_error( $result ) ) {
    error_log( '[jorvy] registration failed: ' . $result->get_error_code() . ' — ' . $result->get_error_message() );
}
```

### Backwards compatibility

Prior to `0.11.0` these functions returned `bool`. `WP_Error` is an object and therefore truthy, so legacy `if ( wp_register_desktop_window( … ) )` guards continue to compile and reach their success branch. New code should use `is_wp_error()` to distinguish success from failure.

### Error codes

| Code | Raised by | Meaning |
|---|---|---|
| `wp_desktop_missing_id` | window / widget / wallpaper / icon | The `$id` argument was empty. |
| `wp_desktop_missing_window_id` | `wp_register_desktop_window_tab` | The `$window_id` argument was empty. |
| `wp_desktop_missing_title` | `wp_register_desktop_window`, `wp_register_desktop_icon` | The `title` field was empty. |
| `wp_desktop_missing_label` | `wp_register_desktop_widget`, `wp_register_desktop_wallpaper`, `wp_register_desktop_window_tab` | The `label` field was empty. |
| `wp_desktop_missing_script` | `wp_register_desktop_window`, `wp_register_desktop_wallpaper` (canvas) | The `script` handle was empty. |
| `wp_desktop_missing_tab_value` | `wp_register_desktop_window_tab` | The `value` field was empty. |
| `wp_desktop_reserved_tab_value` | `wp_register_desktop_window_tab` | Tab `value` was `main` (reserved for the window's own template tab). |
| `wp_desktop_invalid_template` | `wp_register_desktop_window`, `wp_register_desktop_window_tab` | The `template` callback is not callable. |
| `wp_desktop_missing_target` | `wp_register_desktop_icon` | Neither `window` nor `url` was declared. |
| `wp_desktop_conflicting_target` | `wp_register_desktop_icon` | Both `window` and `url` were declared (pick one). |
| `wp_desktop_invalid_url` | `wp_register_desktop_icon` | The `url` argument isn't a valid http(s) URL. |
| `wp_desktop_capability_denied` | all five | Current user lacks a capability declared in `capabilities`. The offending cap is available on `get_error_data()['capability']`. |

All five functions ship as **Stable** in `0.11.0`.

### `wp_register_desktop_window_tab()`

Attaches an additional tab to a native window. The window's own `template` becomes the first tab automatically (its label comes from `main_tab_label` on `wp_register_desktop_window()`, falling back to `title`); each call to this function adds another tab after the main one. Cross-plugin extension is supported — a companion plugin can attach a tab to someone else's window with no coordination other than knowing the window id.

```php
wp_register_desktop_window_tab( string $window_id, array $args );
```

**Args**: `value` (required, kebab slug, cannot be `main`), `label` (required), `template` (required callable), `script` (optional handle), `position` (optional int; lower renders earlier), `capabilities` (optional cap list).

When at least one additional tab is registered, the shell wraps the entire window template in `<wpd-stack>` + `<wpd-tabs>` + one `<wpd-tabpanel>` per tab automatically — plugin authors stop hand-writing that markup. Single-pane windows (zero additional tabs) are unchanged.

See [`docs/examples/native-window-with-tabs.md`](./examples/native-window-with-tabs.md) for a full walkthrough.

---

## See also

- [JavaScript Reference](./javascript-reference.md) — the event + postMessage side of the contract.
- [Examples](./examples/README.md) — full-plugin recipes.
