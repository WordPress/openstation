# Hooks Reference

Every PHP action and filter the plugin fires, with signatures, examples, and **implementation status**.

- **Stable** — shipping today, keep working across the current major version.
- **Experimental** — shipping, but signature may change.
- **Planned** — reserved name, not yet fired. Do not subscribe in production.

If something you need isn't here, open an issue. New hooks are welcome — our rule of thumb: *if a function decides something, wrap it in a filter; if it does something, fire an action around it.*

> **Looking for JavaScript hooks?** The browser-side shell exposes WordPress-style filters and actions via `window.wp.hooks` under the `desktop-mode.*` namespace — including hooks for wallpaper registration, window lifecycle, and the animated logo wallpaper's visibility events. See the [JavaScript Reference](./javascript-reference.md#4-hooks--desktop-mode) for the full catalog.

### PHP vs. JS hook parity

The two hook surfaces are **deliberately not mirrored** — they target different extension points:

- **PHP hooks** (this file) fire on the server: shell mount, chromeless render, dock-items composition, portal / session logic. If you're changing server-rendered state, you want PHP.
- **JS hooks** (javascript-reference.md) fire in the browser: window lifecycle, drag / resize, overview, arrange actions, wallpaper + widget mount lifecycle, virtual-desktop transitions. If you're reacting to user interaction, you want JS.

A few concepts ARE mirrored (e.g. `desktop_mode_dock_items` PHP filter ↔ `desktop-mode.widgets` JS filter — both shape registries), but most aren't. Don't be surprised if a JS hook has no PHP counterpart or vice versa — that's the design.

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
Fires just before the shell's opening `<div id="desktop-mode-shell">`. Echo HTML here to prepend sibling markup (e.g. a global announcement banner that sits above the shell).

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
        'desktop-mode-chromeless',
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

```php
do_action( 'desktop_mode_icon_registered', string $id, array $entry );
```

---

### `desktop_mode_file_type_registered` — Experimental (since 0.9.0)

Fires after `desktop_mode_register_file_type()` successfully stores a desktop file type (used by the Files-on-the-Desktop system — see [files-on-desktop.md](./files-on-desktop.md)). Does NOT fire on `WP_Error`.

```php
do_action( 'desktop_mode_file_type_registered', string $type, array $entry );
```

`$entry` keys: `type`, `label`, `class`, `script`, `sort`.

---

### Files-on-the-Desktop store actions — Experimental (since 0.9.0)

Fired by the placement / folder store when rows are written. Subscribers see the canonical row arrays from the custom tables (see [files-on-desktop.md](./files-on-desktop.md)).

```php
do_action( 'desktop_mode_file_placed',   int $id, array $row );
do_action( 'desktop_mode_file_moved',    int $id, array $next, array $prev );
do_action( 'desktop_mode_file_unplaced', int $id, array $row );

do_action( 'desktop_mode_folder_created', int $id, array $row );
do_action( 'desktop_mode_folder_updated', int $id, array $next, array $prev );
do_action( 'desktop_mode_folder_shared',  int $id, array $next, array $prev ); // share_mode or share_meta changed
do_action( 'desktop_mode_folder_renamed', int $id, string $new_name, string $old_name, int $user_id ); // fires AFTER the folder row + pointing-placements are bumped
do_action( 'desktop_mode_folder_deleted', int $id, array $row );

// Folder delete cascade (since 0.8.5). Owner-only deletion runs
// the cascade described in folder-sharing.md — sub-folder recursion,
// share-row revocation, pointing-placement removal across users.
do_action( 'desktop_mode_files_before_delete_folder',        int $id, int $user_id, array $row );
do_action( 'desktop_mode_files_after_delete_folder_cascade', int $id, int $user_id, array $summary );
// `$summary` carries lists keyed by:
//   folders_deleted, shares_revoked, placements_pointing, placements_inside

do_action( 'desktop_mode_files_schema_installed', string $version );
do_action( 'desktop_mode_files_daily_prune' );

// Soft-trash lifecycle (since 0.8.0). Fires for every state
// transition — placements and folders both. Trashing a folder
// cascades to its child placements; the per-child action fires
// before/after the cascade write.
do_action( 'desktop_mode_files_before_trash_placement',   int $id, int $user_id, array $row );
do_action( 'desktop_mode_files_after_trash_placement',    int $id, int $user_id );
do_action( 'desktop_mode_files_before_restore_placement', int $id, int $user_id, array $row );
do_action( 'desktop_mode_files_after_restore_placement',  int $id, int $user_id );
do_action( 'desktop_mode_files_before_purge_placement',   int $id, int $user_id, array $row );
do_action( 'desktop_mode_files_after_purge_placement',    int $id, int $user_id );

// Cascade trash (since 0.8.9). Fires for each placement that is
// soft-trashed because the source entity it points at (post,
// attachment, user, …) was trashed — distinct from the
// user-initiated per-placement trash actions above.
do_action( 'desktop_mode_files_after_cascade_trash_placement', int $placement_id, int $owner_id, string $file_type, string|int $file_ref );

do_action( 'desktop_mode_files_before_trash_folder',   int $id, int $user_id, array $row );
do_action( 'desktop_mode_files_after_trash_folder',    int $id, int $user_id );
do_action( 'desktop_mode_files_before_restore_folder', int $id, int $user_id, array $row );
do_action( 'desktop_mode_files_after_restore_folder',  int $id, int $user_id );
do_action( 'desktop_mode_files_before_purge_folder',   int $id, int $user_id, array $row );
do_action( 'desktop_mode_files_after_purge_folder',    int $id, int $user_id );
```

### Folder sharing (since 0.8.5, Experimental)

Per-principal grants (read / write) with opt-in flow. The shares
table is `wp_desktop_mode_folder_shares`; rows are keyed by
`(target_type, folder_id, principal_type, principal_ref)` and
carry a `state` of `pending | accepted | denied`.

Actions:

```php
do_action( 'desktop_mode_files_share_invited',             int $share_id, array $row, int $actor_id );
do_action( 'desktop_mode_files_share_accepted',            int $share_id, array $row, int $user_id );
do_action( 'desktop_mode_files_share_denied',              int $share_id, array $row, int $user_id );
do_action( 'desktop_mode_files_share_left',                int $share_id, array $row, int $user_id ); // recipient-initiated leave
do_action( 'desktop_mode_files_share_revoked',             int $share_id, array $row, int $actor_id );
do_action( 'desktop_mode_files_share_capability_changed',  int $share_id, array $next, array $prev, int $actor_id );
do_action( 'desktop_mode_files_sharing_tables_purged',     string[] $dropped ); // after the "Delete folder sharing data" admin action drops the sharing tables
```

Filters:

```php
apply_filters( 'desktop_mode_files_share_eligible_roles', array $roles ); // [{ slug, name }, ...]
apply_filters( 'desktop_mode_files_share_can_manage',     bool $can, int $folder_id, int $user_id, ?array $folder ); // default: owner only
apply_filters( 'desktop_mode_folder_share_user_capability', string $cap, int $folder_id, int $user_id, array $folder ); // 'none'|'read'|'write'
apply_filters( 'desktop_mode_files_share_all_default_capability', string $cap, int $folder_id, int $user_id ); // default 'read' for share_mode='all'
apply_filters( 'desktop_mode_files_share_user_query_args', array $args, array $request_params ); // WP_User_Query args for /files/users/search
apply_filters( 'desktop_mode_folder_share_accept_default_parent', int $parent_id, int $folder_id, int $user_id, array $share_row ); // where the recipient's placement lands
apply_filters( 'desktop_mode_files_sharing_enabled_for', bool $enabled, int $user_id ); // per-user kill switch; default reads `foldersSharingEnabled` from OS Settings
apply_filters( 'desktop_mode_files_user_can_see_folder', bool $can, array $folder, int $user_id, string[] $roles ); // per-folder visibility decision (owner / share_mode / shares table)
apply_filters( 'desktop_mode_files_sharing_tables_for_purge', string[] $tables ); // tables dropped by "Delete folder sharing data"; default shares + decisions

// Polymorphic shape (future-proof). v1 ships with target_type='folder' only.
apply_filters( 'desktop_mode_files_shareable_types',     string[] $types ); // default [ 'folder' ]
apply_filters( 'desktop_mode_files_share_target_owner',  int $owner_id, string $target_type, string $target_id );
```

Filters:

```php
apply_filters( 'desktop_mode_files_can_place', bool $can, int $user_id, string $type, string $ref );
apply_filters( 'desktop_mode_files_query_args', array $args, int $user_id, int $parent_id );
apply_filters( 'desktop_mode_files_share_modes', string[] $modes );
apply_filters( 'desktop_mode_files_visible_folders', array $folders, int $viewer_id );

// Folder delete + rename customization (since 0.8.5).
// `can_delete_folder` runs AFTER the ownership check; return false
// or a WP_Error to veto the cascade (UX-side confirmation prompts,
// "too many recipients" guard).
apply_filters( 'desktop_mode_files_can_delete_folder',  bool|WP_Error $can, int $folder_id, int $user_id, array $row );
// `folder_rename_bump_where` controls the SQL WHERE used to bump
// placements pointing at a renamed folder. Default = every row with
// `file_type='folder' AND file_ref=$folder_id`. Return '' to opt out.
apply_filters( 'desktop_mode_folder_rename_bump_where', string $where, int $folder_id, int $user_id );

// Capability gates for soft-trash / restore / purge (since 0.8.0).
// Default behavior is "owner of the row". Plugins can broaden
// (e.g. let editors restore other authors' shortcuts) or tighten.
apply_filters( 'desktop_mode_files_user_can_trash_placement',   bool $can, int $user_id, array $row );
apply_filters( 'desktop_mode_files_user_can_restore_placement', bool $can, int $user_id, array $row );
apply_filters( 'desktop_mode_files_user_can_purge_placement',   bool $can, int $user_id, array $row );
apply_filters( 'desktop_mode_files_user_can_trash_folder',      bool $can, int $user_id, array $row );
apply_filters( 'desktop_mode_files_user_can_restore_folder',    bool $can, int $user_id, array $row );
apply_filters( 'desktop_mode_files_user_can_purge_folder',      bool $can, int $user_id, array $row );

// Heartbeat delta row cap (since 0.9.0). Default 200, floored at 1.
// Lower it on slow links to force REST fallback sooner; raise it for
// fast-LAN intranets where a fatter Heartbeat is fine. When the cap
// is hit the payload is flagged `truncated: true` and the client
// issues a full REST resync — see files-on-desktop.md.
apply_filters( 'desktop_mode_files_heartbeat_max_rows', int $cap );
```

The recycle-bin REST list / restore / purge dispatch the new
`placement` and `folder` types into the functions above
automatically (`desktop_mode_recycle_bin_restore` /
`desktop_mode_recycle_bin_purge` route by `$type`). The
`desktop_mode_recycle_bin_count` filter signature gained a fourth
arg in 0.8.0: `int $files_count`. The `$post_count` / `$total`
inputs are capability-scoped per user: tracked post types the
viewer cannot edit at all contribute zero, and types where the
viewer can only edit their own posts are counted author-scoped —
the badge never discloses the global trash total to
low-capability users.

---

### `desktop_mode_file_opener_registered` — Experimental (since 0.9.0)

Fires after `desktop_mode_register_file_opener()` successfully stores a file opener (used by the Files-on-the-Desktop association layer — see [files-on-desktop.md](./files-on-desktop.md)). Does NOT fire on `WP_Error`.

```php
do_action( 'desktop_mode_file_opener_registered', string $id, array $entry );
```

`$entry` keys: `id`, `label`, `types`, `is_default`, `sort`, `script`.

---

### `desktop_mode_register_file_opener( $id, $args )` — Experimental (PHP function, since 0.9.0)

Registers a file opener — the desktop-OS equivalent of a default-app association. PHP-side metadata only; the actual handler that opens the URL / native window / runs JS lives on the JS side via `wp.desktop.files.registerOpener()`.

```php
desktop_mode_register_file_opener( 'classic-editor', array(
    'label'      => __( 'Classic Editor', 'classic-editor' ),
    'types'      => array( 'post' ),
    'is_default' => false,
    'sort'       => 20,
) );
```

| Arg | Type | Default | Notes |
|---|---|---|---|
| `label` | `string` | required | Picker label. |
| `types` | `string[]` | required | File-type slugs this opener handles. |
| `is_default` | `bool` | `false` | Ship-time default for its types. |
| `sort` | `int` | `100` | Sort order in pickers. |
| `script` | `string` | `''` | Optional JS handle the shell loads on activation. |
| `capabilities` | `string[]` | `[]` | All caps must match. |

Return: `true` on success, `WP_Error` otherwise. Error codes: `desktop_mode_missing_id`, `desktop_mode_missing_label`, `desktop_mode_missing_types`, `desktop_mode_capability_denied`.

---

### `desktop_mode_register_file_type( $type, $args )` — Experimental (PHP function, since 0.9.0)

Registers a `Desktop_Mode_File` subclass against the desktop file-type registry. The ten built-in types (`post`, `attachment`, `user`, `term`, `comment`, `folder`, `bookmark`, `shortcut`, `link`, `embed`) register through this same surface.

```php
desktop_mode_register_file_type( 'jorvy-quote', array(
    'label' => __( 'Marvel quote', 'jorvy' ),
    'class' => 'Jorvy_Quote_File', // must extend Desktop_Mode_File
    'sort'  => 200,
) );
```

| Arg | Type | Default | Notes |
|---|---|---|---|
| `label` | `string` | required | Picker label. |
| `class` | `string` | required | FQCN of a `Desktop_Mode_File` subclass. |
| `script` | `string` | `''` | Optional handle for the JS-side mirror class. |
| `sort` | `int` | `100` | Sort order in pickers. |
| `capabilities` | `string[]` | `[]` | All caps must match the current user. |

Return: `true` on success, `WP_Error` otherwise. Error codes: `desktop_mode_missing_id`, `desktop_mode_missing_label`, `desktop_mode_invalid_class`, `desktop_mode_capability_denied`.

---

### `desktop_mode_command_script_registered` — Stable

Fires after `desktop_mode_register_command_script()` stores a command-palette script handle. Also fires when `desktop_mode_register_command()` implicitly registers its `script` argument (it routes through `desktop_mode_register_command_script()`).

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
        array( 'desktop-mode' ),
        '1.0.0',
        true
    );
    wp_enqueue_script( 'home-assistant-commands' );
} );
desktop_mode_register_command_script( 'home-assistant-commands' );
```

For live *unregistration* on deactivation, the plugin's JS should set `owner: 'home-assistant-commands'` on each `registerCommand` call — see `docs/javascript-reference.md`. Untagged commands stay until the next page reload.

### `desktop_mode_register_command( $args )` — Stable (PHP function)

Optional companion that also declares command metadata server-side. Advisory today — reserved for future pre-registration shims (showing a greyed-out command before the plugin's JS loads). Implicitly registers `$args['script']` in the command-script registry when `script` is provided (without firing `desktop_mode_command_script_registered`).

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

**No `ai_callable` PHP-side flag — by design.** The [`aiCallable`](./javascript-reference.md#wpdesktopaiask-query-opts--experimental-since-051) opt-in lives on the JS-side `registerCommand` call only, because `wp.desktop.ai.ask()` harvests from the client registry (not server metadata). To gate further per-user once a command has opted in, use the `desktop_mode_ai_command_allowed` filter below.

---

### `desktop_mode_titlebar_button_script_registered` — Experimental (since 0.5.2)

Fires after `desktop_mode_register_titlebar_button_script()` stores a title-bar button script handle.

```php
do_action( 'desktop_mode_titlebar_button_script_registered', string $handle );
```

### `desktop_mode_register_titlebar_button_script( $handle )` — Experimental (PHP function, since 0.5.2)

Declares a WP-registered script handle as a title-bar button provider. The shell injects the resolved URL on plugin activation so `wp.desktop.registerTitleBarButton()` calls made by the plugin's JS render in matching window title bars **without a page reload**.

```php
add_action( 'admin_enqueue_scripts', function () {
    wp_register_script(
        'my-plugin-titlebar',
        plugins_url( 'js/titlebar.js', __FILE__ ),
        array( 'desktop-mode' ),
        '1.0.0',
        true
    );
    wp_enqueue_script( 'my-plugin-titlebar' );
} );
desktop_mode_register_titlebar_button_script( 'my-plugin-titlebar' );
```

For live unregistration on deactivation, set `owner: 'my-plugin-titlebar'` on each `registerTitleBarButton` call. Untagged buttons survive past deactivation until the next page reload — graceful backwards-compat.

---

### `desktop_mode_unfocus_effect_script_registered` — Experimental (since 0.9.1)

Fires after `desktop_mode_register_unfocus_effect_script()` stores an unfocus-effect script handle.

```php
do_action( 'desktop_mode_unfocus_effect_script_registered', string $handle );
```

### `desktop_mode_register_unfocus_effect_script( $handle )` — Experimental (PHP function, since 0.9.1)

Declares a WP-registered script handle as an unfocused-window-effect provider. The shell injects the resolved URL on plugin activation so `wp.desktop.registerUnfocusEffect()` calls made by the plugin's JS surface in **OS Settings → Effects** (and apply to unfocused windows) **without a page reload**.

```php
add_action( 'admin_enqueue_scripts', function () {
    wp_register_script(
        'my-plugin-effects',
        plugins_url( 'js/effects.js', __FILE__ ),
        array( 'desktop-mode' ),
        '1.0.0',
        true
    );
    wp_enqueue_script( 'my-plugin-effects' );
} );
desktop_mode_register_unfocus_effect_script( 'my-plugin-effects' );
```

For live unregistration on deactivation, set `owner: 'my-plugin-effects'` on each `registerUnfocusEffect` call. Untagged effects survive past deactivation until the next page reload — graceful backwards-compat.

The built-in effects (`darken`, `frost`, `grayscale`) are registered through the same JS hook (`wp.desktop.registerUnfocusEffect`) — there is no PHP for them, since they are pure CSS shipped with the plugin.

---

### `desktop_mode_window_content_identity` — Experimental (since 0.9.4)

Filters the content identity the chromeless bridge announces for the current admin screen — the "which object does this page show" record behind [window links](./examples/window-links.md) (visual ties between related windows). Runs inside the iframe's `admin_footer`, in real admin context, so relations the URL can't answer (comment → parent post) resolve here.

```php
apply_filters(
    'desktop_mode_window_content_identity',
    array|null $identity,   // null when the screen shows no single object
    WP_Screen|null $screen
);
```

`$identity` shape (mirrors the JS `WindowContentRef`): `type` (lowercase object-type slug; namespace yours `vendor/order`), `id` (int|string), optional `label`, optional `root => array( 'type', 'id' )`, optional `links => array( array( 'type', 'id', 'rel'? ), … )`. A ref **without** `root` is itself a root (the post a comment window points back to); a ref **with** `root` joins that root's relation group as a child (single arrowhead pointing at the root). `links` declare outbound ties: the default (`rel` omitted) is a `reference` — arrow FROM this window TO the linked object ("my content points at that"); `rel => 'child'` reverses it — the linked object BELONGS TO this content (a post's embedded media), drawn exactly like a root tie. Mutual references merge into one bidirectional arrow. One reading everywhere: **the arrow points at what its source belongs to or refers to** — relational structure, never navigation history.

Built-in detection covers `post.php` (post/page/CPT edit → root, with `links` extracted from the content's internal hyperlinks, its embedded media — `wp-image-{id}`, which catches inserted-but-unattached images — its featured image, and its assigned public-taxonomy terms as `term/{taxonomy}` refs), attachment edit — both the classic `post.php` screen and the `upload.php?item=N` Media Library grid detail — (`media`, rooted at `post_parent` when attached), `comment.php` (`comment`, rooted at the parent post), and `term.php` (`term/{taxonomy}` → root, which assigned posts reference). Use this filter to add identities for your own admin screens, or return `null` to suppress detection:

```php
add_filter( 'desktop_mode_window_content_identity', function ( $identity, $screen ) {
    if ( $screen && 'acme_order_page' === $screen->id && isset( $_GET['order'] ) ) {
        $order = acme_get_order( absint( $_GET['order'] ) );
        if ( $order ) {
            return array(
                'type'  => 'acme/order',
                'id'    => $order->id,
                'label' => $order->title,
                'root'  => array( 'type' => 'acme/customer', 'id' => $order->customer_id ),
            );
        }
    }
    return $identity;
}, 10, 2 );
```

---

### `desktop_mode_window_link_renderer_script_registered` — Experimental (since 0.9.4)

Fires after `desktop_mode_register_window_link_renderer_script()` stores a window-link renderer script handle.

```php
do_action( 'desktop_mode_window_link_renderer_script_registered', string $handle );
```

### `desktop_mode_register_window_link_renderer_script( $handle )` — Experimental (PHP function, since 0.9.4)

Declares a WP-registered script handle as a window-link renderer provider. The shell injects the resolved URL on plugin activation so `wp.desktop.registerWindowLinkRenderer()` calls made by the plugin's JS surface in **OS Settings → Effects → Window links** **without a page reload**.

```php
add_action( 'admin_enqueue_scripts', function () {
    wp_register_script(
        'my-plugin-link-renderer',
        plugins_url( 'js/link-renderer.js', __FILE__ ),
        array( 'desktop-mode' ),
        '1.0.0',
        true
    );
    wp_enqueue_script( 'my-plugin-link-renderer' );
} );
desktop_mode_register_window_link_renderer_script( 'my-plugin-link-renderer' );
```

For live unregistration on deactivation, set `owner: 'my-plugin-link-renderer'` on each `registerWindowLinkRenderer` call. Untagged renderers survive past deactivation until the next page reload; should the *active* renderer depart, the render host falls back to the built-in `svg-splines`.

The built-in `svg-splines` renderer is registered through the same JS hook — there is no PHP for it.

---

### `desktop_mode_settings_tab_script_registered` — Stable *(since 0.5.2)*

Fires after `desktop_mode_register_settings_tab_script()` stores an OS Settings tab script handle. Also fires when `desktop_mode_register_settings_tab()` implicitly registers its `script` argument (it routes through `desktop_mode_register_settings_tab_script()`).

```php
do_action( 'desktop_mode_settings_tab_script_registered', string $handle );
```

### `desktop_mode_settings_tab_registered` — Stable *(since 0.5.2)*

Fires after `desktop_mode_register_settings_tab()` successfully stores a tab's metadata. Does not fire on `WP_Error`.

```php
do_action( 'desktop_mode_settings_tab_registered', string $id, array $entry );
```

### `desktop_mode_register_settings_tab_script( $handle )` — Stable *(PHP function, since 0.5.2)*

Declares a WP-registered script handle as an OS Settings tab provider. The shell injects the resolved URL on plugin activation so `wp.desktop.registerSettingsTab()` calls made by the plugin's JS appear in the OS Settings window **without a page reload**. Primary (minimum-ceremony) opt-in — plugin authors keep tab definitions in TypeScript and only touch PHP to declare the handle.

```php
add_action( 'admin_enqueue_scripts', function () {
    wp_register_script(
        'my-plugin-settings',
        plugins_url( 'js/settings.js', __FILE__ ),
        array( 'desktop-mode' ),
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

### `desktop_mode_register_settings_tab( $args )` — Stable *(PHP function, since 0.5.2)*

Optional companion that declares a settings tab server-side. Primary benefit: enables live-unregistration on plugin deactivation without every `registerSettingsTab()` call having to set `owner`. Implicitly registers `$args['script']` in the settings-tab script registry when `script` is provided (without firing `desktop_mode_settings_tab_script_registered`).

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
- `apps-icons` = 22
- `features` = 25
- `effects` = 27
- `help` = 40
- Third-party default = 100 (appended after built-ins)

**Capability gating today**: the shell collapses `capability` to a simple admin-vs-everyone distinction. `'manage_options'` means admin-only; any other value (including empty) means visible to everyone. Widening to arbitrary capabilities is a future expansion.

---

### `desktop_mode_dock_rail_renderer_script_registered` — Stable *(since 0.6.0)*

Fires after `desktop_mode_register_dock_rail_renderer_script()` stores a dock rail renderer script handle.

```php
do_action( 'desktop_mode_dock_rail_renderer_script_registered', string $handle );
```

---

### `desktop_mode_register_dock_rail_renderer_script( $handle )` — Stable *(PHP function, since 0.6.0)*

Declare a WP-registered script handle as a dock rail renderer provider. The shell injects the resolved URL on plugin activation so `wp.desktop.registerDockRailRenderer()` calls made by the plugin's JS surface in OS Settings → Dock style **without a page reload**. Primary (minimum-ceremony) opt-in — plugin authors keep renderer definitions in TypeScript and only touch PHP to declare the handle.

```php
add_action( 'admin_enqueue_scripts', function () {
    wp_register_script(
        'my-plugin-rail',
        plugins_url( 'js/rail.js', __FILE__ ),
        array( 'desktop-mode' ),
        '1.0.0',
        true
    );
    wp_enqueue_script( 'my-plugin-rail' );
} );
desktop_mode_register_dock_rail_renderer_script( 'my-plugin-rail' );
```

The plugin's JS calls `wp.desktop.registerDockRailRenderer({ id, label, owner: 'my-plugin-rail', mount })` — the matching `owner` enables live unregistration when the plugin deactivates. Renderers without `owner` stay until the next page reload (graceful backwards-compat).

See [`docs/examples/dock-rail-renderer.md`](./examples/dock-rail-renderer.md) for the full plugin author walk-through.

---

### `desktop_mode_window_tab_registered` — Stable

Fires after `desktop_mode_register_window_tab()` successfully attaches a tab to a native window. Useful for companion plugins that need to follow up (e.g. register a help overlay only when a Stats tab actually exists).

```php
do_action( 'desktop_mode_window_tab_registered', string $window_id, string $value, array $entry );
```

---

### `desktop_mode_oauth_relay_registered` — Stable *(since 0.8.2)*

Fires after `desktop_mode_register_oauth_relay()` stores a relay entry. `$entry` is the stored registry entry with `client_secret` redacted, so observability logs can't leak credentials. See [`examples/oauth-relay.md`](./examples/oauth-relay.md) for the full relay walk-through.

```php
do_action( 'desktop_mode_oauth_relay_registered', string $service, array $entry );
```

---

### `desktop_mode_oauth_relay_connected` — Stable *(since 0.8.2)*

Fires after a successful OAuth round-trip — once the relay's `on_success` callback has persisted the tokens. Use it to refresh badges, re-render dock items, or surface a "connected" toast in sibling windows via the activity bus. See [`examples/oauth-relay.md`](./examples/oauth-relay.md).

```php
do_action( 'desktop_mode_oauth_relay_connected', string $service, int $user_id );
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

### `desktop_mode_file_types` — Experimental (since 0.9.0)

Filters the file-type registry used by the Files-on-the-Desktop system. Plugins can hide built-ins or swap a class out at runtime. Keyed by type slug; the `class` field of an entry must remain a `Desktop_Mode_File` subclass FQCN.

```php
apply_filters( 'desktop_mode_file_types', array $registry );
```

---

### `desktop_mode_file_serialize` — Experimental (since 0.9.0)

Last-mile mutation point for the JS-bound shape produced by `Desktop_Mode_File::serialize()`. Plugins use this to attach badges, override labels, or splice in custom render hints without subclassing.

```php
apply_filters( 'desktop_mode_file_serialize', array $shape, Desktop_Mode_File $file );
```

**Example — attach a "draft" badge to draft posts:**

```php
add_filter( 'desktop_mode_file_serialize', function ( $shape, $file ) {
    if ( $file instanceof Desktop_Mode_Post_File && 'draft' === ( $shape['status'] ?? '' ) ) {
        $shape['badge'] = __( 'Draft', 'my-plugin' );
    }
    return $shape;
}, 10, 2 );
```

---

### `desktop_mode_file_openers` — Experimental (since 0.9.0)

Filters the file-opener registry. Plugins can hide built-ins, swap labels, or rearrange sort order. Keyed by opener id.

```php
apply_filters( 'desktop_mode_file_openers', array $registry );
```

---

### `desktop_mode_resolve_file_opener` — Experimental (since 0.9.0)

Override the resolution chain at `desktop_mode_resolve_file_opener_id()` time. Useful for forced role-based associations.

```php
apply_filters( 'desktop_mode_resolve_file_opener', string $opener_id, string $type, int $user_id );
```

**Example — force the Classic Editor for a specific role:**

```php
add_filter( 'desktop_mode_resolve_file_opener', function ( $opener_id, $type, $user_id ) {
    if ( 'post' === $type && user_can( $user_id, 'editor' ) ) {
        return 'classic-editor';
    }
    return $opener_id;
}, 10, 3 );
```

---

### `desktop_mode_resolve_favicon` — Stable (since 0.8.2)

Last-mile filter on the favicon data URI returned by `desktop_mode_resolve_favicon()`. The resolver runs inline during `POST /placements` for `link`-type placements: it fetches the page via `wp_safe_remote_get`, walks `<link rel="icon|shortcut icon|apple-touch-icon">`, falls back to `/favicon.ico`, and base64-encodes the bytes into a `data:image/<subtype>;base64,…` URI for the placement's `meta.iconUrl`. The filter lets plugins short-circuit the network round-trips (return a synthetic data URI), force-skip caching (return `null`), or post-process whatever the resolver produced.

```php
apply_filters( 'desktop_mode_resolve_favicon', ?string $data_uri, string $page_url );
```

**Example — short-circuit with a cached value from a transient:**

```php
add_filter( 'desktop_mode_resolve_favicon', function ( $data_uri, $page_url ) {
    $key    = 'fav_' . md5( $page_url );
    $cached = get_transient( $key );
    if ( false !== $cached ) {
        return $cached === '' ? null : $cached;
    }
    if ( null !== $data_uri ) {
        set_transient( $key, $data_uri, DAY_IN_SECONDS );
    } else {
        // Negative-cache for an hour so we don't re-fetch a broken
        // host on every "New URL" submit.
        set_transient( $key, '', HOUR_IN_SECONDS );
    }
    return $data_uri;
}, 10, 2 );
```

The resolver itself catches every error path and returns `null` — never raises. Bodies above 256 KB and HTML pages spoofing image content-types are rejected. SSRF is mitigated by `wp_safe_remote_get`.

---

### `desktop_mode_mode_enabled` — Stable

Gates whether desktop mode can be activated (or stay active) for a given user. The central helper `desktop_mode_is_enabled()` consults this filter after the user-meta check, so render-time gates (chromeless detection, payload generation, REST permission callbacks, the admin-bar toggle, the portal entry, the AJAX save endpoint) all honor a `false` return.

```php
apply_filters( 'desktop_mode_mode_enabled', bool $enabled, int $user_id );
```

**Example — disable for contributors:**

```php
add_filter( 'desktop_mode_mode_enabled', function ( $enabled, $user_id ) {
    if ( user_can( $user_id, 'contributor' ) ) {
        return false;
    }
    return $enabled;
}, 10, 2 );
```

A `false` return has two effects:

1. The AJAX save endpoint refuses to flip the user meta to `'1'` (it returns `desktop_mode_disabled`).
2. `desktop_mode_is_enabled()` returns `false` for that user even when their existing meta is `'1'`. Every render-time gate that consults the helper (and there are many — see `includes/render.php`, `includes/components.php`, `includes/recycle-bin/rest.php`, `includes/pwa.php`, `includes/presence.php`, `includes/admin-bar.php`) treats the user as not-enabled.

---

### `desktop_mode_show_welcome_dialog` — Stable *(since 0.8.2)*

Decides whether the first-run welcome dialog (rendered in classic `/wp-admin` on `admin_footer`, never inside the desktop shell or a chromeless iframe) should display for the current user on the current request.

```php
apply_filters( 'desktop_mode_show_welcome_dialog', bool $show, int $user_id );
```

The filter only fires after Desktop Mode has already verified that:

1. The request is an admin page (`is_admin()`).
2. The user is logged in and can `read`.
3. The request is NOT chromeless.
4. The user has not yet dismissed the `activation-welcome` intro (stored in the `desktop_mode_seen_intros` user meta — the same storage every other native-app intro uses, and the same surface the "Reset what's-new dialogs" button in OS Settings → Features wipes).
5. Desktop Mode is not already enabled for the user — this is a "switch to Desktop Mode" promo, so it has nothing to say once the user is in the shell.

Dismissal persists through the same `POST /desktop-mode/v1/intros/seen` route the in-shell intros use, with one wrinkle: because the dialog only appears while Desktop Mode is **disabled**, that route makes a scoped exception for the `activation-welcome` slug and accepts it from any logged-in `read`-capable account (every other slug still requires Desktop Mode enabled). Without it the dismissal would `403` and the dialog would re-appear on every classic-admin page load.

Return `false` to suppress the dialog — useful for managed-host onboarding flows that ship their own welcome UX.

---

### `desktop_mode_shell_config` — Stable

The JS configuration blob injected as `window.desktopModeConfig`. Powers the window manager, dock, and session restore. Filter this to inject custom payloads the shell can read at boot.

```php
apply_filters( 'desktop_mode_shell_config', array $config );
```

Core keys (non-exhaustive — the full blob carries many more keys, e.g. `colorScheme`, `pluginVersion`, the `server*` registry-sync arrays, lazy-bundle URLs, and feature payloads; the authoritative shape is the array passed to `apply_filters( 'desktop_mode_shell_config', … )` in `includes/render/assets.php`. Do not treat absence from this list as unavailability):

```php
array(
    'currentPage'      => string,   // e.g. 'http://localhost:8889/wp-admin/'
    'currentTitle'     => string,   // human title of the current page
    'currentIcon'      => string,   // dashicons-* class
    'adminUrl'         => string,   // admin_url()
    'portalUrl'        => string,   // desktop_mode_portal_url()
    'sessionUrl'       => string,   // REST session URL
    'restUrl'          => string,   // REST API root from rest_url(); compose with joinRestUrl() for pretty/plain permalink safety
    'restNonce'        => string,   // X-WP-Nonce
    'dockItems'        => array[],  // see desktop_mode_dock_items
    'session'          => array,    // prior session snapshot or empty
    'fromPortal'       => bool,     // request was forwarded by the /desktop-mode/ portal
    'fromPortalIntent' => bool,     // portal forward resolved from a user-supplied `target` URL — the user expressed navigation intent toward `currentPage`, not just a bare `/desktop-mode/` visit. Since 0.8.4.
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
const cfg = window.desktopModeConfig;
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
    'id'      => string,   // stable ID; drives the window ID too
    'title'   => string,   // hover tooltip
    'icon'    => string,   // dashicons-* or a sanitized http(s)/data: URL
    'url'     => string,   // page to open when clicked
    'badge'   => int,      // e.g. update count; 0 = hidden
    'submenu' => array[]?, // optional [ [ 'title' => ..., 'url' => ... ], ... ]
)
```

Items built from the admin menu also carry `multi`, `placement`, `isCore`, `pluginFile`, and `pluginName` keys — see the `desktop_mode_dock_item_multi` and `desktop_mode_dock_placement` filters below.

**Example — add a virtual dock item:**

```php
add_filter( 'desktop_mode_dock_items', function ( $items ) {
    $items[] = array(
        'id'      => 'analytics',
        'title'   => __( 'Analytics', 'my-ext' ),
        'icon'    => 'dashicons-chart-bar',
        'url'     => admin_url( 'admin.php?page=my-analytics' ),
        'badge'   => 0,
        'submenu' => array(),
    );
    return $items;
} );
```

**Example — remove an item by id:**

```php
add_filter( 'desktop_mode_dock_items', function ( $items ) {
    return array_values( array_filter( $items, fn( $i ) => 'edit-comments.php' !== $i['id'] ) );
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

Controls whether a dock item supports multiple simultaneous windows. Multi-capable pages expose a hover-peek popover on the dock icon (one card per open instance + a Ghost Card that spawns a new instance) and an "Open another" action in the window's title-bar menu; singletons always focus the existing window when re-opened.

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

Chooses whether a menu item appears in the dock. Two values are recognized:

- `'dock'` (default) — render the item on the unified dock.
- `'hidden'` — suppress the item entirely. The underlying admin menu entry still exists server-side; this only prevents rendering on the dock. Plugins that don't want to claim chrome real estate (utility tools, background services, plugins that render only into existing surfaces) set this.

```php
apply_filters( 'desktop_mode_dock_placement', string $placement, string $menu_slug );
```

Return values other than `'dock'` or `'hidden'` coerce to `'dock'` — a defensive guard so a misbehaving filter (returning `null`, a bool, etc.) can't corrupt the rail.

**Example — hide a plugin from the shell entirely (from inside that plugin's own PHP):**

```php
add_filter( 'desktop_mode_dock_placement', function ( $placement, $slug ) {
    if ( 'my-background-tool' === $slug ) {
        return 'hidden';
    }
    return $placement;
}, 10, 2 );
```

Ordering within the dock is set server-side: core WordPress menus (Dashboard, Posts, Media, Users, Settings, CPTs, taxonomies, …) are sorted before plugin-contributed top-level menus. To fully reorder, use `desktop_mode_dock_items` — it receives the built list and returns a reshaped one.

The live menu-refresh path (chromeless `plugins.php` iframe postMessage, plus the hidden iframe spawned by `wp.desktop.refreshMenu()`) runs the same builder from real admin context, so a filter change takes effect without a full tab reload.

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

**Click wiring:** clicking a custom item fires the JS action `desktop-mode.arrange.custom-action` with payload `{ id }`. Subscribe via `wp.hooks.addAction()`:

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
    'desktop-mode.arrange.custom-action',
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

When a user lands on `/desktop-mode/` without desktop mode enabled, the portal auto-enables it for them by default. Return `false` to require an explicit toggle instead.

```php
apply_filters( 'desktop_mode_portal_auto_enable', bool $auto_enable, int $user_id );
```

**Example:**

```php
add_filter( 'desktop_mode_portal_auto_enable', '__return_false' );
```

---

### `desktop_mode_admin_redirect_to_portal` — Stable

Governs the `admin_init` redirect from classic `/wp-admin/` URLs to `/desktop-mode/` for users with desktop mode on. Return `false` to keep the user on the classic URL even when they have the mode enabled (useful for support sessions).

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

Mirrors the client-side `desktop-mode.wallpapers` JS filter but runs earlier, before any wallpaper reaches the browser.

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

Last-chance filter over the desktop-icon registry before it ships to the shell as `config.desktopIcons`. Each entry is the shape stored by `desktop_mode_register_icon()` (`id`, `title`, `icon`, `window`, `url`, `position`, `pinned`).

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

### `desktop_mode_admin_target_allowlist` — Experimental (since 0.7.0)

The wp-admin filename allowlist consulted when resolving portal `target=` query args — only files on the list may resolve as a window target. Filtered values are restricted to strings, lowercased, and deduplicated after the filter runs.

```php
apply_filters( 'desktop_mode_admin_target_allowlist', string[] $files );
```

---

### `desktop_mode_chromeless_sec_fetch_fallback` — Experimental (since 0.5.2)

Controls the `Sec-Fetch-*` fallback in chromeless detection: when a request arrives without the explicit `?desktop_mode_chromeless=1` query flag but the browser reports `Sec-Fetch-Dest: iframe` + `Sec-Fetch-Site: same-origin`, it is treated as chromeless. Default `true`. Return `false` to require the explicit query flag — useful for environments where a reverse proxy strips the `Sec-Fetch-*` headers and they can't be trusted.

```php
apply_filters( 'desktop_mode_chromeless_sec_fetch_fallback', bool $allow );
```

---

### `desktop_mode_chromeless_admin_bar_top_values` — Experimental (since 0.6.1)

The set of `top` pixel values the chromeless offset neutralizer treats as admin-bar offset clones. Defaults match the two admin-bar heights Core ships: `32px` (desktop) and `46px` (mobile breakpoint). Sites that customize the admin-bar height (some accessibility themes raise it to 50px) can extend the list. See [plugin-compat-layer.md](./plugin-compat-layer.md) for where the neutralizer sits in the compat stack.

```php
apply_filters( 'desktop_mode_chromeless_admin_bar_top_values', string[] $values );
```

---

### `desktop_mode_native_window_allowed_html` — Experimental (since 0.7.0)

The `wp_kses`-shaped allowlist used when escaping native-window `<template>` payloads. The default extends `wp_kses_allowed_html( 'post' )` with form controls, `<wpd-*>` web components, dashicon spans, and permissive `data-*` / `aria-*` attributes. Plugins registering their own native windows can extend the list with custom tags or attributes if their templates need markup not covered by the default.

```php
apply_filters( 'desktop_mode_native_window_allowed_html', array $allowed );
```

---

### `desktop_mode_cascade_deactivate_dependents` — Experimental (since 0.8.2)

The list of plugin files to cascade-deactivate when Desktop Mode itself is deactivated. Defaults to every plugin whose `Requires Plugins` header lists Desktop Mode's directory slug. Return an empty array to opt out of the cascade entirely.

```php
apply_filters( 'desktop_mode_cascade_deactivate_dependents', string[] $dependents, string $slug );
```

---

### `desktop_mode_heartbeat_widget_eager_css` — Experimental (since 0.8.5)

Whether the heartbeat widget's stylesheet is eagerly enqueued on shell requests once the desktop-mode and chromeless gates have passed (chromeless iframes never receive it — they don't mount widgets). Default `true`. Sites that never plan to ship the heartbeat widget can return `false` and save the stylesheet roundtrip.

```php
apply_filters( 'desktop_mode_heartbeat_widget_eager_css', bool $eager );
```

---

### `desktop_mode_oauth_authorize_query` — Stable (since 0.8.2)

The query parameters appended to an OAuth relay's authorize URL. Lets plugins inject service-specific extras (`access_type=offline` for Google, `force_login=true` for Twitter, `prompt=consent`, …) without forking the relay. `$entry` is the registry entry with `client_secret` redacted. See [`examples/oauth-relay.md`](./examples/oauth-relay.md).

```php
apply_filters( 'desktop_mode_oauth_authorize_query', array $query, string $service, array $entry );
```

---

### `desktop_mode_wallpaper_context_menu_items` — Experimental (since 0.9.0)

The server-borne items appended to the wallpaper's right-click context menu. Each item must carry at least `id` and `label`; optional keys are `icon`, `sort`, `disabled`, and `callbackId`. Items missing `id` or `label` are dropped. See [files-on-desktop.md](./files-on-desktop.md) for the item shape and the JS-side activation hook (`desktop-mode.wallpaper-context-menu.activated`).

```php
apply_filters( 'desktop_mode_wallpaper_context_menu_items', array[] $items );
```

---

## AI Copilot hooks — Stable

The AI assistant (Cmd+K palette) runs an agentic loop server-side, analyses entities on save, and exposes a search REST endpoint. Every decision point is hookable so plugins can adjust model selection, customise prompts, limit which entities get analysed, or react to analysis completion.

Credentials and model routing are owned by **WordPress 7.0 Core**: configure a provider in **Settings → Connectors** and the Copilot generates through the Core AI Client (`wp_ai_client_prompt()`), which injects the key automatically. The assistant is available only when the Connectors + Abilities APIs and `wp_supports_ai()` are present.

> **Removed in 0.9.4.** The self-managed provider registry and credential surface were replaced by Core Connectors. These no longer exist: the functions `desktop_mode_register_ai_provider()` / `desktop_mode_unregister_ai_provider()`, the actions `desktop_mode_ai_register_providers` / `desktop_mode_ai_provider_registered`, and the filters `desktop_mode_ai_active_provider` / `desktop_mode_ai_model`. The three-callable provider contract (`make_turn_input` / `agentic_call` / `structured_request`) and the `$api_key` argument are gone. Register providers with the Core AI Client / Connectors instead. See [`migration-ai-connectors.md`](migration-ai-connectors.md). The `/ai/search` extensibility hooks below and `desktop_mode_register_ai_tool()` are unaffected.

> **Removed in 0.9.1.** Automatic AI analysis of posts, pages, and taxonomy terms was removed — the copilot now only analyzes comments (for the spam score), and the AI assistant finds content with WordPress's native keyword search. The following filters/actions no longer fire and have been removed: `desktop_mode_ai_supported_post_types`, `desktop_mode_ai_supported_taxonomies`, `desktop_mode_ai_supported_types`, `desktop_mode_ai_schema_content`, `desktop_mode_ai_post_prompt`, `desktop_mode_ai_term_prompt`, `desktop_mode_ai_post_analyzed`, `desktop_mode_ai_term_analyzed`. See [`migration-ai-comment-only.md`](migration-ai-comment-only.md).

### `desktop_mode_ai_schema_comment` — Experimental

Mutate the JSON Schema handed to the provider for structured-output comment analysis. Use this to add custom fields (compliance flags, sentiment buckets, …) the model should populate alongside the built-in `spam` / `harmful` verdict.

```php
apply_filters( 'desktop_mode_ai_schema_comment', array $schema );
```

### `desktop_mode_ai_comment_prompt` — Stable

Customise the user-side prompt handed to the model for comment analysis. The filter receives the default prompt plus the comment object.

```php
apply_filters( 'desktop_mode_ai_comment_prompt', string $prompt, WP_Comment $comment );
```

### `desktop_mode_ai_comment_analyzed` — Stable

Fires after a comment has been successfully analyzed. The result array contains the fields emitted by the schema (`topic`, `ai_summary`, `harmful`, `spam`). Use it to mirror the verdict into a custom moderation queue or trigger downstream jobs.

```php
do_action( 'desktop_mode_ai_comment_analyzed', int $comment_id, array $result, WP_Comment $comment );
```

### `desktop_mode_ai_admin_page_catalog` — Stable

Last-chance filter over the catalog of admin pages the AI search tool can link to. Each entry is `{ title, url, icon, description }` — `icon` is a Dashicons class used when the assistant opens the page in an iframe window. Plugins that expose admin UIs typically inject their top-level pages here so the assistant can offer them as navigation results.

```php
apply_filters( 'desktop_mode_ai_admin_page_catalog', array $catalog );
```

### `desktop_mode_ai_error_log_candidates` — Experimental

Filter the ordered list of log-file paths the `get_php_error_log` AI tool probes. Defaults to `WP_CONTENT_DIR . '/debug.log'`, then the PHP `error_log` ini value (omitted when empty or `'syslog'`). Return `string[]` file paths in probe order — the first readable file wins. Plugins that redirect PHP errors to a non-standard location can prepend their path here.

```php
apply_filters( 'desktop_mode_ai_error_log_candidates', string[] $candidates );
```

---

## AI Copilot extensibility — `/ai/search` (Experimental, since 0.5.2)

Every `POST /desktop-mode/v1/ai/search` call — whether driven by the built-in overlay or by `wp.desktop.ai.ask()` — runs through this layered hook surface. Use it to:

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

Fires on any `WP_Error` from the search / follow-up run (provider failure, response-parse failure, etc.) or on a tool handler exception. REST permission denials do NOT fire it — REST core rejects those requests before the route callback runs. Includes the `request_id` so subscribers can correlate with `desktop_mode_ai_search_started`.

```php
do_action( 'desktop_mode_ai_search_error', array $error );
// $error = { code, message, data, user_id?, request_id? }
```

On the tool-exception path the action additionally receives `string $tool_name` and `Throwable $e` — register with `add_action( ..., 10, 3 )` to receive them.

---

### `desktop_mode_register_ai_tool( $args )` — Experimental (PHP function, since 0.5.2)

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

Handler signature: `function( array $args, int $user_id ): array|WP_Error`. A `WP_Error` return, or a thrown exception, is caught automatically — the error envelope goes back to the model as the tool result so the agent can try something else. Only thrown exceptions additionally fire `desktop_mode_ai_search_error`; a `WP_Error` return is treated as a handled outcome and does not fire the action. Never surfaces raw exception messages to the user.

`capability` is enforced **before** the tool is visible to the model — unauthorised users never see it exists.

---

## OS-file drop manager — Experimental (since 0.8.6)

The drop manager (`src/os-file-drop/`) catches files dragged from the user's native OS (Finder / Explorer / Nautilus) anywhere on the shell and routes them through a confirmation dialog before uploading to the Media Library. See [`docs/examples/os-file-drop.md`](examples/os-file-drop.md) for the full recipe.

### `desktop_mode_drop_allowed_mimes`

Narrows or widens the allowed-MIMEs list surfaced to the JS drop manager. Default is `get_allowed_mime_types( $user_id )` when the user has `upload_files`, otherwise an empty array — the plugin applies the `upload_files` gate itself. A filter can widen the (empty) map for such users, but `desktop_mode_drop_enabled` still defaults to off for them.

```php
apply_filters( 'desktop_mode_drop_allowed_mimes', array $mimes_map, int $user_id );
```

`$mimes_map` is the `ext => mime` map (same shape `get_allowed_mime_types()` returns). The drop manager flattens to canonical MIMEs before the policy check.

---

### `desktop_mode_drop_max_size`

Caps the per-file size the JS drop manager enforces locally before upload. Default is `wp_max_upload_size()`. Returning `0` disables the client-side cap — the server still enforces its own.

```php
apply_filters( 'desktop_mode_drop_max_size', int $max_size, int $user_id );
```

---

### `desktop_mode_drop_enabled`

Master gate for the OS-file drop manager. Defaults to `current_user_can( 'upload_files' )`. Return `false` to disable drop handling entirely for the current user (e.g. role-gated, multisite-gated, or environment-gated).

```php
apply_filters( 'desktop_mode_drop_enabled', bool $enabled, int $user_id );
```

---

### JS hooks fired by the drop manager

| Hook | Kind | Notes |
| --- | --- | --- |
| `desktop-mode.drop.files-detected` | filter | `(files: File[], ctx) => File[]`, before mime / size filter. Return `[]` to abort silently. |
| `desktop-mode.drop.files-rejected` | action | `{ rejections, context }` — files that failed the allow-list. |
| `desktop-mode.drop.dialog-fields` | filter | `(entry, ctx) => entry` — mutate the per-file defaults. |
| `desktop-mode.drop.before-upload` | filter | `(payload, ctx) => payload \| null` — return `null` to cancel. |
| `desktop-mode.drop.upload-started` | action | _Since 0.8.6._ `{ file, fields, context, abort }` — fires once the XHR is `open()`ed and immediately before `send()`. Call `abort()` to cancel the in-flight upload; the manager rejects with `UploadAbortedError` and emits `upload-failed`. If `abort()` is called after the request body has been fully sent, the manager lets the server respond and then DELETEs the resulting attachment so the user's Media Library never shows a "cancelled" file. |
| `desktop-mode.drop.upload-progress` | action | _Since 0.8.6._ `{ file, fields, context, loaded, total, indeterminate }` — per `XMLHttpRequestUpload.progress` event. `total === 0` / `indeterminate === true` when the request length isn't known. A synthetic 100% event is dispatched on `upload.load` so a HUD can show "wrapping up" while the server finishes the response. |
| `desktop-mode.drop.after-upload` | action | `{ file, result, fields, context }` — `file` (since 0.8.6) is the same `File` reference exposed by `upload-started` / `upload-progress`, so per-file state can be looked up by identity rather than filename. |
| `desktop-mode.drop.upload-failed` | action | `{ file, error, context }` — `file` carries the same identity as `upload-started` / `upload-progress` / `after-upload` (the post-`before-upload` `File`, in case a plugin swapped it). Match by reference, not filename. `error.name === 'UploadAbortedError'` when the failure came from a `upload-started` `abort()` call. |

---

## Planned (not yet fired)

The filters and actions below are **reserved names** documented for forward compatibility. They will land with the phase indicated. Do not register listeners in production code until the status flips to Stable.

### Window — Phase 3
```php
apply_filters( 'desktop_mode_window_args',           array $args, string $page );
apply_filters( 'desktop_mode_window_reuse',          bool  $reuse, string $page );
apply_filters( 'desktop_mode_window_excluded_pages', array $excluded );
```

### Dock (extended) — Phase 3+
```php
apply_filters( 'desktop_mode_dock_style', array $style );      // icon size, gap, blur
```

> Dock placement (left / right / bottom) ships as a user preference in OS Settings, persisted via the standard settings REST endpoint. No server-side filter is wired today — a plugin that wants to force a placement can set the user meta directly or post to `/desktop-mode/v1/os-settings`.

### Desktop area — Phase 4+
```php
apply_filters( 'desktop_mode_wallpaper',    string $url,   string $color_scheme );
apply_filters( 'desktop_mode_context_menu', array  $menu_items );
apply_filters( 'desktop_mode_icon',         array  $icon_config, string $icon_id );
```

> `desktop_mode_icons` and `desktop_mode_wallpapers` and the widget registry filter are **shipped** — see their Stable entries above. `desktop_mode_widgets` is not a PHP filter; the JS-side `desktop-mode.widgets` filter is the canonical hook (widgets are declared via `desktop_mode_register_widget()` server-side).

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

> Native windows themselves are **shipped** — plugins declare them with `desktop_mode_register_window()` and react via the Stable registration actions (`desktop_mode_native_window_registered`) and JS lifecycle hooks (`desktop-mode.native-window.before-render` / `after-render` / `before-close`). The two filter names above are reserved for a future read-only view of the registry and per-window config overrides.

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
Currently the `desktop-mode-active` / `desktop-mode-chromeless` classes are added unfiltered via `admin_body_class`. A named filter is planned.

---

## Registration functions

Shell extension points — windows, widgets, wallpapers — are declared through `desktop_mode_register_*()` PHP functions that mirror Core's `register_*` conventions. Every function returns `true` on success and `WP_Error` on any validation failure, with a stable error code callers can branch on.

```php
$result = desktop_mode_register_window( 'jorvy', array(
    'title'    => 'Jorvy',
    'template' => 'jorvy_render_template',
    'script'   => 'jorvy-render',
    'style'    => 'jorvy-render', // optional, since 0.7.0
) );

if ( is_wp_error( $result ) ) {
    error_log( '[jorvy] registration failed: ' . $result->get_error_code() . ' — ' . $result->get_error_message() );
}
```

> **`style` (since 0.7.0).** Optional `wp_register_style()` handle. The shell resolves it to a `styleUrl` (and any `wp_add_inline_style()` blobs) and lazy-injects a `<link rel="stylesheet">` when the window's plugin is activated mid-session. Without `style`, a peer plugin activated from inside an open shell renders its window with **no CSS** until the user reloads — the parent shell already finished `wp_print_styles` before the plugin existed. If the handle isn't registered, the field is silently dropped (no error, no link); plugins active at boot continue to print through the normal `wp_print_styles` pipeline as before.

### Backwards compatibility

Early development builds of these functions returned `bool`; every tagged release returns `true|WP_Error`. `WP_Error` is an object and therefore truthy, so legacy `if ( desktop_mode_register_window( … ) )` guards continue to compile and reach their success branch. New code should use `is_wp_error()` to distinguish success from failure.

### Error codes

| Code | Raised by | Meaning |
|---|---|---|
| `desktop_mode_missing_id` | window / widget / wallpaper / icon | The `$id` argument was empty. |
| `desktop_mode_missing_window_id` | `desktop_mode_register_window_tab` | The `$window_id` argument was empty. |
| `desktop_mode_missing_title` | `desktop_mode_register_window`, `desktop_mode_register_icon` | The `title` field was empty. |
| `desktop_mode_missing_label` | `desktop_mode_register_widget`, `desktop_mode_register_wallpaper`, `desktop_mode_register_window_tab` | The `label` field was empty. |
| `desktop_mode_missing_script` | `desktop_mode_register_wallpaper` (canvas) | The `script` handle was empty. (`script` is optional on `desktop_mode_register_window` — native windows can be template-only.) |
| `desktop_mode_missing_tab_value` | `desktop_mode_register_window_tab` | The `value` field was empty. |
| `desktop_mode_reserved_tab_value` | `desktop_mode_register_window_tab` | Tab `value` was `main` (reserved for the window's own template tab). |
| `desktop_mode_invalid_template` | `desktop_mode_register_window`, `desktop_mode_register_window_tab` | The `template` callback is not callable. |
| `desktop_mode_missing_target` | `desktop_mode_register_icon` | Neither `window` nor `url` was declared. |
| `desktop_mode_conflicting_target` | `desktop_mode_register_icon` | Both `window` and `url` were declared (pick one). |
| `desktop_mode_invalid_url` | `desktop_mode_register_icon` | The `url` argument isn't a valid http(s) URL. |
| `desktop_mode_capability_denied` | all five | Current user lacks a capability declared in `capabilities`. The offending cap is available on `get_error_data()['capability']`. |

All five functions ship as **Stable**.

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

Declare the full set of channels for a given session id. Read by `GET /desktop-mode/v1/debug` when no `channel` / `channels[]` query parameter is present.

### `desktop_mode_debug_rest_permission` — Experimental (filter)

Override the default `manage_options` permission gate on `GET /desktop-mode/v1/debug`.

See [`docs/examples/devtools-instrumentation.md`](./examples/devtools-instrumentation.md) for the full walkthrough — header contributions, observe mode, debug bus.

---

## Recycle Bin

The Recycle Bin stamps who-deleted-what-when metadata on posts, pages, attachments, and comments as they pass through the WordPress trash (attachments only reach trash when `MEDIA_TRASH` is enabled) and exposes browse / restore / purge over REST. Every decision the bin makes is filterable.

### `desktop_mode_recycle_bin_capture_post_types` — Experimental (filter)

Post types whose deletions the bin tracks. Defaults to `[ 'post', 'page', 'attachment' ]`. Returning a list excluding `attachment` stops the bin from stamping and listing trashed attachments; it does not change how WordPress deletes media (that is governed by `MEDIA_TRASH`).

```php
add_filter( 'desktop_mode_recycle_bin_capture_post_types', function ( $types ) {
    $types[] = 'product';
    return $types;
} );
```

### `desktop_mode_recycle_bin_should_capture` — Planned (filter, not yet fired)

**Reserved name — not yet fired.** Intended as a per-deletion opt-out: returning `false` for a specific `WP_Post` would let that single deletion bypass the bin's metadata stamping. Today the capture path consults `desktop_mode_recycle_bin_capture_post_types` only. Do not subscribe in production until the status flips.

```php
apply_filters( 'desktop_mode_recycle_bin_should_capture', bool $capture, WP_Post $post );
```

### `desktop_mode_recycle_bin_query_args` — Experimental (filter)

Customize the `WP_Query` args used to populate the bin — scope it to the current user, restrict by role, or interleave additional post types beyond the capture list.

```php
apply_filters( 'desktop_mode_recycle_bin_query_args', array $query_args, array $caller_args );
```

### `desktop_mode_recycle_bin_comment_query_args` — Experimental (filter)

Mirror of `desktop_mode_recycle_bin_query_args` for the comment side of the bin — customize the `get_comments()` args used to populate the trashed-comments list.

```php
apply_filters( 'desktop_mode_recycle_bin_comment_query_args', array $comment_args, array $caller_args );
```

### `desktop_mode_recycle_bin_comments_enabled` — Experimental (filter)

Whether the bin tracks trashed comments at all. Default: `current_user_can( 'moderate_comments' )`. Return `false` to hide the comments segment without touching the JS — e.g. read-only blogs or headless setups that don't moderate comments.

```php
apply_filters( 'desktop_mode_recycle_bin_comments_enabled', bool $on );
```

### `desktop_mode_recycle_bin_items` / `desktop_mode_recycle_bin_item` — Experimental (filter)

`..._item` reshapes a single row before it's returned to JS; `..._items` filters the final list. The `id`, `type`, and `deleted_at` fields are load-bearing — keep them when extending.

```php
apply_filters( 'desktop_mode_recycle_bin_item', array $item, WP_Post $post );
apply_filters( 'desktop_mode_recycle_bin_items', array $items, $query );
```

The second argument of `..._items` is currently always `null` — the bin merges posts, comments, and desktop files into one list, so there is no single underlying `WP_Query`. Do not type-hint the second parameter; it is reserved (`array|null` per the in-code docblock).

### `desktop_mode_recycle_bin_comment_item` — Experimental (filter)

Mirror of `desktop_mode_recycle_bin_item` for trashed comments — reshapes a single comment row before it's returned to JS. The same `id`, `type`, and `deleted_at` fields are load-bearing.

```php
apply_filters( 'desktop_mode_recycle_bin_comment_item', array $item, WP_Comment $comment );
```

### `desktop_mode_recycle_bin_user_can_view|restore|purge|use` — Experimental (filter)

Per-item capability gates. `_use` controls whether the bin window is registered at all for the current user; the others gate individual operations. Defaults: `_use` → `edit_posts`, `_view` → `edit_post`, `_restore`/`_purge` → `delete_post` (the same gate WP itself uses for trash/untrash).

### `desktop_mode_recycle_bin_user_can_view|restore|purge_comment` — Experimental (filter)

Per-comment capability gates — mirrors of the post gates above, each receiving `( bool $can, WP_Comment $comment )`. Unlike the post variants, all three default to `edit_comment` (the WP-native moderation check).

### `desktop_mode_recycle_bin_count` — Experimental (filter)

The total surfaced to the dock/icon badge. `$total` defaults to `$post_count + $comment_count + $files_count` — the trashed-post query (capability-scoped to what the current user can edit), the trashed-comment count (only counted when comments are enabled for the bin), and the desktop-files trash. The `$files_count` argument was added in 0.8.0.

```php
apply_filters( 'desktop_mode_recycle_bin_count', int $total, int $post_count, int $comment_count, int $files_count );
```

### `desktop_mode_recycle_bin_window_args` / `desktop_mode_recycle_bin_icon_args` — Experimental (filter)

Tweak the args passed to `desktop_mode_register_window()` / `desktop_mode_register_icon()` for the bin — useful to change dimensions, swap the dashicon, or move the window from the taskbar to the dock.

### `desktop_mode_recycle_bin_template_html` — Experimental (filter)

The full template body before it's emitted into the native-window template element. Keep the `data-desktop-mode-recycle-bin-*` hooks intact so the JS bundle can find its mount points.

### `desktop_mode_recycle_bin_empty_chunk_size` — Experimental (filter)

```php
apply_filters( 'desktop_mode_recycle_bin_empty_chunk_size', int $chunk_size );
```

Per-call cap on `desktop_mode_recycle_bin_empty()` — protects against PHP `max_execution_time` on huge bins. Default `200`. The client iterates while `remaining > 0`, so raising this just means fewer roundtrips per "Empty bin" click. Lower it on shared hosts with tight execution budgets; raise it on dedicated servers handling 10k+ item bins.

### Lifecycle actions

```php
do_action( 'desktop_mode_recycle_bin_item_captured', int $post_id, int $user_id, string $now_gmt );
do_action( 'desktop_mode_recycle_bin_before_restore', int $post_id, WP_Post $post );
do_action( 'desktop_mode_recycle_bin_after_restore',  int $post_id );
do_action( 'desktop_mode_recycle_bin_before_purge',   int $post_id, WP_Post $post );
do_action( 'desktop_mode_recycle_bin_after_purge',    int $post_id, string $type );
do_action( 'desktop_mode_recycle_bin_emptied',        int $purged, int $skipped );

// Comment twins — same lifecycle, keyed by comment id.
do_action( 'desktop_mode_recycle_bin_comment_captured',       int $comment_id, int $user_id, string $now_gmt );
do_action( 'desktop_mode_recycle_bin_before_restore_comment', int $comment_id, WP_Comment $comment );
do_action( 'desktop_mode_recycle_bin_after_restore_comment',  int $comment_id );
do_action( 'desktop_mode_recycle_bin_before_purge_comment',   int $comment_id, WP_Comment $comment );
do_action( 'desktop_mode_recycle_bin_after_purge_comment',    int $comment_id );
```

### REST endpoints

| Method | Route | Purpose |
|---|---|---|
| `GET`  | `/desktop-mode/v1/recycle-bin` | List trashed items (`page`, `per_page`, `type`, `search`). |
| `GET`  | `/desktop-mode/v1/recycle-bin/count` | Global trash count for the dock/icon badge. |
| `POST` | `/desktop-mode/v1/recycle-bin/restore` | Restore. Body: `{ items: [{ id, type }] }` (preferred — `type` matches the item's `type` field from the list response, e.g. `'post'`, `'comment'`, `'placement'`, `'folder'`). `{ ids: int[] }` accepted as legacy, posts only. |
| `POST` | `/desktop-mode/v1/recycle-bin/purge` | Permanently delete. Same body shapes as restore. |
| `POST` | `/desktop-mode/v1/recycle-bin/empty` | Empty everything the current user can purge. |

### JS extension points

- `wp.hooks.applyFilters( 'desktop_mode.recycleBin.columns', cols )` — append/replace `<wpd-table>` columns.
- `document.addEventListener( 'desktop-mode-recycle-bin-changed', e => …)` — fired after every restore / purge / empty with `{ kind, ok, errors, source }`. `source` is `'local'` (the bin's own action), `'chromeless'` (a delete in another window's iframe), or `'heartbeat'` (a delete elsewhere — other tab, REST, WP-CLI).
- `wp.hooks.doAction( 'desktop_mode.recycleBin.changed', …)` — same payload, hook-bus form.

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

Topic format: **`desktop-mode.<post_type>.changed`** — the literal
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
| `desktop-mode.post.changed`          | `edit.php` (post type unset / `post`) |
| `desktop-mode.page.changed`          | `edit.php?post_type=page`           |
| `desktop-mode.attachment.changed`    | `upload.php`                        |
| `desktop-mode.comment.changed`       | `edit-comments.php`                 |

Single-edit pages (`post.php`, `post-new.php`) deliberately have
**no** soft-reload handler, because replacing their body would
destroy unsaved Gutenberg / classic-editor state. Plugins wanting
specific behaviour for those pages subscribe to the same topic
themselves and decide how to react.

After every successful soft-reload the bridge dispatches
`desktop-mode-soft-reloaded` on the iframe's `document` so plugins
that need to re-bind state (e.g. their own custom widgets in the
list table) have a single signal to listen for.

**Plugin extension.** Subscribers from anywhere (parent shell,
native windows, iframes) can use the bus directly:

```js
wp.desktop.subscribe( 'desktop-mode.post.changed', ( payload ) => {
    if ( payload.action === 'untrashed' ) {
        myEditorRedrawSidebar( payload.ids );
    }
} );
```

Iframe-side admin pages subscribe via plain DOM:

```js
document.addEventListener( 'desktop-mode-broadcast', ( e ) => {
    if ( e.detail.topic !== 'desktop-mode.post.changed' ) return;
    // your custom handling — fires after the built-in soft reload
} );
```

### Real-time signal

The bin window updates without polling via two channels:

1. **Chromeless `postMessage` (instant).** Whenever a delete fires inside an iframe-rendered admin page (e.g. "Move to Trash" on `post.php`), `realtime.php` emits an inline footer script that posts `{ type: 'desktop-mode-recycle-bin-changed', ts }` to the parent shell.
2. **Heartbeat (catch-all, ≤15 s).** A delete also bumps `_desktop_mode_recycle_bin_change_ts` (autoload=false). While the bin window is open, its tab enqueues `desktop_mode_recycle_bin_seen_ts` on every Heartbeat tick; the `heartbeat_received` filter answers `{ changed, ts }`. Closed-bin tabs send nothing — zero per-tick cost.

Hook this to push your own real-time channel (websocket, SSE) without re-listening on every delete action:

```php
do_action( 'desktop_mode_recycle_bin_signal', int $ts_ms );
```

Suppress the chromeless footer emit per request:

```php
apply_filters( 'desktop_mode_recycle_bin_emit_footer_signal', bool $emit );
```

See [`docs/examples/recycle-bin.md`](./examples/recycle-bin.md) for end-to-end recipes (custom post types, audit logging, custom columns).

---

## Native Posts window

`<wpd-table>`-driven native window that replaces the chromeless `edit.php` iframe. **Opt-IN Beta as of 0.9.1** (was opt-out in 0.8.0–0.9.0) — fresh installs land on the classic iframe; users turn it on via **OS Settings → Features → Beta features → Use the native Posts window** (persisted as `OsSettingsState.nativePostsEnabled`, default `false`). The dock tile that points at `edit.php` is unchanged — every click path consults the URL → native-window remap registry first and falls back to the iframe on no-match. See [`examples/native-posts.md`](./examples/native-posts.md) for end-to-end recipes.

### `desktop_mode_posts_window_user_can_register` — Stable *(filter, since 0.8.0)*

Cap-only gate (`edit_posts`) that decides whether the native Posts window is registered for this user at boot. Returning `false` skips the entire registration — no script handle, no template, no entry in the native-window registry — so every click path falls back to the classic chromeless `edit.php` iframe. Deliberately decoupled from the opt-in toggle: registration runs once on `init`, while the toggle is enforced at runtime by the JS-side URL remap, so flipping the OS-Settings flag mid-session never requires an F5.

```php
apply_filters( 'desktop_mode_posts_window_user_can_register', bool $can, int $user_id ): bool
```

Use cases:
- Restrict to `edit_others_posts` on a multi-author site so contributors stay on the iframe.
- Per-user A/B rollouts driven by an external flag store.

### `desktop_mode_posts_window_user_can_use` — Stable *(filter, since 0.8.0)*

The combined cap-and-opt-in answer: `edit_posts` AND the user has turned the opt-in toggle on. **Informational only** — this filter has no effect on window registration (that's `desktop_mode_posts_window_user_can_register` above) or on the dock-click URL remap (that consults the JS-side `nativePostsEnabled` settings snapshot). Hook it when your own code needs the combined answer (analytics, conditional UI), not to gate the window.

```php
apply_filters( 'desktop_mode_posts_window_user_can_use', bool $can, int $user_id );
```

To keep a user or role on the classic iframe, return `false` from `desktop_mode_posts_window_user_can_register` instead. Note that "force the native window on for everyone" is not possible from either PHP filter — the opt-in lives in the JS-side settings snapshot.

### `desktop_mode_posts_window_args` — Experimental *(filter, since 0.8.0)*

Args passed to `desktop_mode_register_window( 'desktop-mode-posts', … )`. Customize the title / icon / dimensions, or extend the `config` blob with extra REST URLs the bundle should know about.

```php
apply_filters( 'desktop_mode_posts_window_args', array $args );
```

### `desktop_mode_posts_window_template_html` — Experimental *(filter, since 0.8.0)*

The full template body before it's `wp_kses`'d into the native-window template element. Keep the `data-desktop-mode-posts-*` hooks intact so the JS bundle can find its mount points (search input, status segmented, table, bulk bar, pager).

```php
apply_filters( 'desktop_mode_posts_window_template_html', string $html );
```

### `desktop_mode_posts_window_query_args` — Experimental *(filter, since 0.8.0)*

Default outbound REST query args the bundle merges into every `/wp/v2/posts` request. Drop in `'post_type' => 'product'` to point the window at a CPT, or extend `_fields` to ship more columns. The bundle merges page / per_page / search / status / sort args on top.

```php
apply_filters( 'desktop_mode_posts_window_query_args', array $args );
```

Default args:

```php
[
    '_embed'  => 'author,wp:term,wp:featuredmedia',
    '_fields' => 'id,title,status,date,date_gmt,modified,modified_gmt,author,categories,tags,comment_status,excerpt,desktop_mode_lock,_links,_embedded',
]
```

### JS extension points

Every JS hook below is also documented on `wp.hooks` so plugins can register with priorities + namespaces. Filter signatures match `wp.hooks.applyFilters( name, default, ...args )`.

| Hook | Type | Default | Args / Detail |
|---|---|---|---|
| `desktop_mode.postsWindow.columns` | filter | built-in 5 columns | `WpdTableColumn< PostListItem >[]` — append, replace, or remove cells. |
| `desktop_mode.postsWindow.statusSegments` | filter | All / Published / Drafts / Pending / Scheduled / Trash | `StatusSegment[]` — `{ value, label }` pairs. `value` is sent verbatim as `?status=…`; use `''` for "All" (the bundle remaps to `?status=any`). |
| `desktop_mode.postsWindow.bulkActions` | filter | one entry: "Move to trash" | `BulkAction[]` — `{ id, label, icon?, variant?, confirm?, run( ids, ctx ) }`. Filter out by id to remove. |
| `desktop_mode.postsWindow.toolbarTrailing` | filter | `[]` | `HTMLElement[]` rendered before Refresh + Add New. Receives the live `PostsWindowContext` as the second arg. |
| `desktop_mode.postsWindow.opened` | action | — | `( ctx: PostsWindowContext )` — fired after the first paint with a populated table. |
| `desktop_mode.postsWindow.dataLoaded` | action | — | `( payload: { items, total, totalPages, page } )` — fired after every successful refresh. |

`PostsWindowContext`: `{ body, table, refresh(), getSelectedIds(), getSelectedRows(), getCurrentParams() }` — see [`src/posts-window/types.ts`](../src/posts-window/types.ts) for the full TypeScript surface.

### CustomEvents (same payloads as the hook-bus actions)

```js
document.addEventListener( 'desktop-mode-posts-window-opened',      e => /* e.detail = PostsWindowContext */ );
document.addEventListener( 'desktop-mode-posts-window-data-loaded', e => /* e.detail = { items, total, totalPages, page } */ );
```

### Cross-window broadcast

```js
wp.desktop.broadcast( 'desktop-mode.post.changed', {
    source: 'posts-window',
    action: 'trashed',
    ids: number[],
} );
```

Fired after every bulk trash. The recycle bin and any other listener are cross-window subscribers via `wp.desktop.subscribe`.

### URL → native-window remap registry

Centralized in `src/native-url-remap.ts`. Every code path that opens an admin URL (dock click, portal deep-link, `<a href="/wp-admin/…">` anywhere in the shell) consults `tryNativeUrlRemap()` before falling back to the iframe. Future native windows (Pages, Media, Users) register themselves with one line:

```js
wp.desktop.registerNativeUrlRemap( {           // planned public API; internal today — not yet exposed on wp.desktop
    id: 'myplugin-pages',
    nativeWindowId: 'myplugin-pages',
    matches: ( _url, parsed ) =>
        parsed.pathname.endsWith( '/edit.php' ) &&
        parsed.searchParams.get( 'post_type' ) === 'page',
    enabled: ( settings ) => settings.nativePagesEnabled === true,
} );
```

Returning `false` from `enabled` (or `matches`) lets the click fall through. An `openById( nativeWindowId )` call that reports the window isn't registered for the current user (cap-gated, opt-in-gated) also falls through — the registry walks on to the next entry, then to the iframe path.

---

## Native Pages window (since 0.8.1)

Reuses the Posts window bundle (the registration passes `mode: 'pages'` on the config blob as the JS-side discriminator) to replace the chromeless `edit.php?post_type=page` iframe — parent column, menu-order default sort, Template column, "Front page" / "Posts page" badges. Per-user opt-in Beta (default `false`) via OS Settings → Features → Beta features → `nativePagesEnabled`.

### `desktop_mode_pages_window_user_can_register` — Stable *(filter, since 0.8.1)*

```php
apply_filters( 'desktop_mode_pages_window_user_can_register', bool $can, int $user_id ): bool
```

Cap-only gate (`edit_pages`) that decides whether the native Pages window is registered for this user at boot. Returning `false` skips the entire registration, so every click path falls back to the classic iframe. Decoupled from the opt-in toggle — same register/use split as the Posts window.

### `desktop_mode_pages_window_user_can_use` — Stable *(filter, since 0.8.1)*

```php
apply_filters( 'desktop_mode_pages_window_user_can_use', bool $can, int $user_id ): bool
```

The combined cap-and-opt-in answer (`edit_pages` AND `nativePagesEnabled`). Informational only — it does not affect registration or the dock-click remap; same semantics as `desktop_mode_posts_window_user_can_use`.

### `desktop_mode_pages_window_args` — Experimental *(filter, since 0.8.1)*

```php
apply_filters( 'desktop_mode_pages_window_args', array $window_args ): array
```

Filters the args passed to `desktop_mode_register_window( 'desktop-mode-pages', … )` — title, icon, dimensions, `config` blob (including `frontPageId`, `postsPageId`, and the `pageTemplates` label map).

### `desktop_mode_pages_window_template_html` — Experimental *(filter, since 0.8.1)*

```php
apply_filters( 'desktop_mode_pages_window_template_html', string $html ): string
```

The full template body before it's `wp_kses`'d into the native-window template element. Keep the `data-desktop-mode-posts-*` hooks intact — the shared bundle reuses the Posts mount points.

### `desktop_mode_pages_window_query_args` — Experimental *(filter, since 0.8.1)*

```php
apply_filters( 'desktop_mode_pages_window_query_args', array $args ): array
```

Default outbound REST query args the bundle merges into every `/wp/v2/pages` request. Defaults include `orderby=menu_order`, `order=asc`, and a `_fields` whitelist carrying `parent`, `menu_order`, `slug`, `link`, `template`, `desktop_mode_lock`, and `desktop_mode_comment_count` for the Pages-only columns.

### `desktop_mode_pages_window_template_labels` — Experimental *(filter, since 0.8.1)*

```php
apply_filters( 'desktop_mode_pages_window_template_labels', array $labels ): array
```

The `{ slug: label }` map for the active theme's registered page templates, used by the Template column. The default template is keyed under the empty string (`''`) for parity with core's `/wp/v2/pages` responses. Pages-only — the Posts window has no equivalent.

---

## Native Plugins window (since 0.9.0)

A two-tab native window that replaces the chromeless `plugins.php` (Installed list) and `plugin-install.php` (Browse the .org repo) iframes. **Opt-IN Beta as of 0.9.1** (was opt-out in 0.9.0) — fresh installs land on the classic iframe; users turn it on via **OS Settings → Features → Beta features → Use the native Plugins window** (persisted as `OsSettingsState.nativePluginsEnabled`, default `false`). `plugin-editor.php` is intentionally NOT claimed; that surface stays on the existing iframe.

Architecture summary: read paths use Core REST (`/wp/v2/plugins`); admin-only paths (browse / info / reviews / .zip upload) live on `admin-ajax.php` (`wp_ajax_desktop_mode_plugins_*`) so we never need to `require_once ABSPATH . 'wp-admin/…'`. Install-by-slug delegates to Core's existing `wp_ajax_install_plugin` handler. Mutations are followed by `wp.desktop.refreshMenu()` so the dock repaints live.

### `desktop_mode_plugins_window_user_can_register` — Stable *(filter, since 0.9.0)*

Cap-only gate (`activate_plugins`) that decides whether the window is registered for this user. Decoupled from the opt-in toggle so flipping the OS-Settings flag mid-session doesn't require an F5.

```php
apply_filters( 'desktop_mode_plugins_window_user_can_register', bool $can, int $user_id ): bool
```

### `desktop_mode_plugins_window_user_can_use` — Stable *(filter, since 0.9.0)*

Combined cap-and-opt-in. Returns `true` when the user has `activate_plugins` AND has turned `nativePluginsEnabled` on (default `false`).

```php
apply_filters( 'desktop_mode_plugins_window_user_can_use', bool $can, int $user_id ): bool
```

### `desktop_mode_plugins_window_args` — Experimental *(filter, since 0.9.0)*

Last-mile mutation of the args passed to `desktop_mode_register_window( 'desktop-mode-plugins', … )`. Title, icon, default size, config blob — same shape as the Posts/Users window filter.

### `desktop_mode_plugins_window_template_html` — Experimental *(filter, since 0.9.0)*

Filters the rendered template HTML before `wp_kses` runs. Keep `data-desktop-mode-plugins-{root,tabs,installed-host,browse-host,featured-host,flyout}` intact or rename them and update the matching constants in `src/plugins-window/index.ts`.

### `desktop_mode_plugins_window_browse_args` — Stable *(filter, since 0.9.0)*

Mutates the args passed to `plugins_api( 'query_plugins', … )` from the `wp_ajax_desktop_mode_plugins_browse` handler.

```php
apply_filters( 'desktop_mode_plugins_window_browse_args', array $api_args, array $raw_params ): array
```

`$raw_params` carries the sanitized request: `browse`, `search`, `tag`, `page`, `per_page`. Use this to pin a corporate plugin allow-list, force a specific `tag`, or extend the `fields` payload.

### `desktop_mode_plugins_window_browse_response` — Stable *(filter, since 0.9.0)*

Mutates the wp.org browse response before it's cached + sent to the client. The payload is `{ plugins: array, info: array }`.

```php
apply_filters( 'desktop_mode_plugins_window_browse_response', array $payload, array $api_args ): array
```

### `desktop_mode_plugins_window_info_response` — Stable *(filter, since 0.9.0)*

Same pattern for `plugins_api( 'plugin_information', … )`. Lets a plugin amend the description sections, prepend a notice, or splice in an extra screenshot.

```php
apply_filters( 'desktop_mode_plugins_window_info_response', array $payload, string $slug ): array
```

### `desktop_mode_plugins_window_review_parser` — Experimental *(filter, since 0.9.0)*

Override the default DOMDocument-based parser for the wp.org reviews page. Return an array of `{ author, stars, excerpt, date, url }` items to short-circuit the default parser. Return `null` to fall through to the built-in DOM parsing.

```php
apply_filters( 'desktop_mode_plugins_window_review_parser', array|null $items, string $slug ): array|null
```

The use case: wp.org HTML changes occasionally. A plugin author who maintains a more robust parser (or who has access to a private reviews API) can swap in their own implementation without forking the upstream.

### `desktop_mode_plugins_window_icon_url` — Experimental *(filter, since 0.9.0)*

Filter the resolved card icon URL for an installed plugin row. Return `null` to suppress (forces the placeholder); return a different URL to override (useful for premium plugins shipping a known asset URL).

```php
apply_filters( 'desktop_mode_plugins_window_icon_url', string|null $url, string $slug, array $row ): string|null
```

The default URL is resolved in priority:

1. **Local file** — if the plugin's own folder ships an icon at `assets/icon.svg`, `assets/icon-256x256.png`, `assets/icon-128x128.png`, or the same names at the folder root, the `plugins_url()` for that file is used. This is what makes premium / internal / native-bundled plugins (not on the .org repo) display their own art without any plugin-side wiring.
2. **wp.org SVN asset** — `https://ps.w.org/<slug>/assets/icon.svg`, keyed off the plugin's folder name (the .org repo slug). The JS card walks a candidate chain (SVG → 256 PNG → 256 GIF → 128 PNG → 128 GIF) on `<img>` error for wp.org URLs, then drops to the placeholder. Local URLs and custom URLs (anything not under `ps.w.org/<slug>/assets/`) are one-shot, then placeholder.

### `desktop_mode_plugins_window_local_icon_candidates` — Experimental *(filter, since 0.8.6)*

Filter the ordered list of relative paths probed inside an installed plugin's folder when looking for a card icon. The first existing file wins; later entries are ignored. Use this to support a non-standard icon convention (e.g. `branding/logo.svg`, `icon@2x.svg`) without forking the resolver.

```php
apply_filters( 'desktop_mode_plugins_window_local_icon_candidates', string[] $candidates, string $folder ): string[]
```

```php
add_filter(
    'desktop_mode_plugins_window_local_icon_candidates',
    static function ( $candidates ) {
        $candidates[] = 'branding/logo.svg';
        return $candidates;
    }
);
```

### `desktop_mode_plugins_window_refresh_updates` — Stable *(filter, since 0.8.3; `$force` argument added 0.8.5)*

Short-circuit the lazy refresh of the `update_plugins` site transient that runs on the first row of every REST plugins collection. Core only refreshes that transient on `load-plugins.php` / `load-update-core.php` / cron — REST is not on that list — so without this hop the Plugins window can show "no updates" while the dock badge (computed off `$menu`) reports pending updates. The refresh inherits Core's own 12h throttle (`_maybe_update_plugins()`), so the steady-state cost is a single transient read per request.

```php
apply_filters( 'desktop_mode_plugins_window_refresh_updates', bool $refresh, bool $force ): bool
```

Return `false` to skip the refresh — useful for hosts that run their own update orchestration (managed WordPress, internal mirrors) and don't want REST hits to potentially trigger a wp.org HTTPS check. The filter is also called on the explicit force-refresh path (when the in-window Refresh button passes `?desktop_mode_force_refresh=1`); returning `false` there keeps the no-network posture even on user-initiated refreshes. Inspect `$force` to apply different policies for opportunistic vs. user-initiated refreshes.

### `desktop_mode_plugins_window_auto_updates_enabled` — Experimental *(filter, since 0.8.6)*

Whether the Plugins window's "Automatic Updates" column should be shown to the current user. Mirrors Core's `WP_Plugins_List_Table::$show_autoupdates` gate (`wp_is_auto_update_enabled_for_type( 'plugin' )` + `update_plugins` cap + network-admin on multisite). Return `false` to suppress the column entirely — useful for managed-hosting environments that orchestrate auto-updates externally and don't want users toggling per-plugin state from within the shell.

```php
apply_filters( 'desktop_mode_plugins_window_auto_updates_enabled', bool $enabled, int $user_id ): bool
```

The flag is surfaced to the JS bundle on the window's `config` blob as `autoUpdatesEnabled` and consumed at column-build time — flipping it via the filter takes effect on the next reload of the window.

### REST-field decorators on `/wp/v2/plugins` — Stable (since 0.9.0)

Server-injected enrichment fields. The JS reads them on every list paint:

| Field | Shape | What it carries |
|---|---|---|
| `desktop_mode_update_available` | `{ available: bool, new_version: string\|null, package: string, slug: string }` | Pending wp.org update for this row, derived from `get_site_transient( 'update_plugins' )`. Since 0.8.3 the transient is lazily refreshed at REST-time (subject to Core's 12h throttle, and the `desktop_mode_plugins_window_refresh_updates` filter) so the window stays in sync with the dock update badge. Since 0.8.5 the in-window Refresh button can bypass the 12h throttle by adding `?desktop_mode_force_refresh=1` to the REST request — Core's `wp_clean_plugins_cache( true )` then deletes the transient and fans out to api.wordpress.org, mirroring what classic `plugins.php` does on load. `package` carries the download URL (empty for plugins without a wp.org zip — the JS surfaces the same "Auto-update unavailable" fallback Core renders); `slug` is what `wp_ajax_update_plugin` echoes back in its event payload. |
| `desktop_mode_can_manage` | `{ activate, deactivate, delete: bool }` | Per-row capability flags so the JS doesn't re-derive caps. Server still re-validates every mutation. |
| `desktop_mode_icon_url` | `string\|null` | Best-effort card icon URL. Prefers a local file under the plugin's folder (`assets/icon.svg` and a handful of variants — see [`desktop_mode_plugins_window_local_icon_candidates`](#desktop_mode_plugins_window_local_icon_candidates--experimental-filter-since-086)) and falls back to `https://ps.w.org/<slug>/assets/icon.svg`. Filterable via `desktop_mode_plugins_window_icon_url`. |
| `desktop_mode_size_kb` | `int\|null` | Disk footprint of the plugin folder in kilobytes. Cached 6h. |
| `desktop_mode_auto_update` | `{ enabled: bool, forced: bool\|null, supported: bool }` | (Since 0.8.6) Per-row auto-update state, mirroring Core's "Automatic Updates" column on `plugins.php`. `enabled` reflects the `auto_update_plugins` site option (overridden by `forced` when a filter pins it). `forced` is `null` for user-toggleable rows, `true`/`false` when the `auto_update_plugin` filter has pinned the state. `supported` is true when the `update_plugins` transient has an entry for the plugin (either `response` or `no_update`); when false the JS hides the toggle — premium / private plugins that never check in with wp.org. The toggle itself routes through Core's `wp_ajax_toggle_auto_updates` handler (action `toggle-auto-updates`, `'updates'` nonce). |

### Actions — Stable (since 0.9.0)

```php
do_action( 'desktop_mode_plugins_window_installed', string $plugin_file );
```

Fires after the upload-AJAX handler installs a plugin from an uploaded .zip. `$plugin_file` is the resolved plugin file (e.g. `"akismet/akismet.php"`). Hook this to seed default settings for first-install plugins, send an audit-log entry, or chain a network-wide deploy.

### `desktop_mode_plugins_featured_slugs` — Experimental *(filter, since 0.8.6)*

The Plugins window's third tab — "Desktop Mode plugins" — leads with a hand-curated list because wp.org's `plugins_api` does not yet expose a usable `requires_plugins` filter. The handler hydrates each curated slug through `plugins_api( 'plugin_information' )` so card metadata stays fresh; it then scans the wp.org popular feed for rows whose `requires_plugins` array contains `desktop-mode` and appends them after the curated entries.

Use this filter to append your own companion plugins (or remove the default seed). Order is preserved — the first slug renders first in the gallery. Output is run through `sanitize_key()` and deduplicated.

```php
apply_filters( 'desktop_mode_plugins_featured_slugs', string[] $slugs ): string[]
```

```php
add_filter( 'desktop_mode_plugins_featured_slugs', static function ( $slugs ) {
    $slugs[] = 'my-companion-plugin';
    return $slugs;
} );
```

**Cache scope caveat.** The Featured tab response is cached in a single site-wide transient (`dm_pwfeatured_v1`, 1h TTL) — the cache key does not vary by user or role. If your filter returns role-specific or capability-specific slugs (e.g. surfacing a premium plugin only to administrators), the first viewer's payload will be served to every viewer for the cache window. Either keep the curated list cap-agnostic, or use `desktop_mode_plugins_featured_response` to drop disallowed rows for the current viewer *after* the shared payload is composed (you'd lose the cache hit benefit per user, but no leak).

### `desktop_mode_plugins_featured_response` — Experimental *(filter, since 0.8.6)*

Last hop before the Featured tab payload is cached (1h transient) and sent to the client. Inject premium / private rows that aren't on wp.org, or enforce a hard cap on the response.

```php
apply_filters( 'desktop_mode_plugins_featured_response', array $payload, array $curated ): array
```

`$payload` shape: `{ plugins: [ … ], info: { curated: int, discovered: int, results: int } }`. Each entry in `plugins` matches the `plugins_api( 'query_plugins' )` row shape plus a boolean `featured` (true for curated, false for auto-discovered).

---

## Native Comments window (since 0.8.3)

Replaces the chromeless `edit-comments.php` iframe with a moderation queue native window: Pending / All / Spam / Trash / Mine tabs, bulk approve / spam / trash with an 8-second undo, inline reply editor, keyboard moderation (`j/k/a/s/d/r/e/u/?`), spam-confidence chip per row, author-insights drawer.

Per-user opt-in Beta (default `false` as of 0.9.1) via OS Settings → Features → Beta features → `nativeCommentsEnabled`. URL remap claims `edit-comments.php`; `comment.php?action=editcomment&c=…` still falls through to the chromeless iframe path.

### `desktop_mode_comments_window_user_can_register` — Stable *(filter, since 0.8.3)*

```php
apply_filters( 'desktop_mode_comments_window_user_can_register', bool $can, int $user_id ): bool
```

Whether the window should be registered for `$user_id`. Default: `user_can( $user_id, 'edit_posts' )`.

### `desktop_mode_comments_window_user_can_use` — Stable *(filter, since 0.8.3)*

```php
apply_filters( 'desktop_mode_comments_window_user_can_use', bool $can, int $user_id ): bool
```

Combined cap-and-opt-in check. Hooks here override the default ("can register AND the user toggled `nativeCommentsEnabled` on").

### `desktop_mode_comments_window_args` — Experimental *(filter, since 0.8.3)*

```php
apply_filters( 'desktop_mode_comments_window_args', array $window_args ): array
```

Filters the args passed to `desktop_mode_register_window()` for the Comments window — title, icon, dimensions, `config` blob. The `config` keys are the bundle's source of truth; treat the shape as Experimental.

### `desktop_mode_comments_window_template_html` — Experimental *(filter, since 0.8.3)*

```php
apply_filters( 'desktop_mode_comments_window_template_html', string $html ): string
```

Filters the rendered template body. The output is run through `desktop_mode_kses_native_window_template()` after this filter, so unsafe HTML is dropped regardless.

### `desktop_mode_comments_window_query_args` — Experimental *(filter, since 0.8.3)*

```php
apply_filters( 'desktop_mode_comments_window_query_args', array $args ): array
```

Filters the outbound `wp/v2/comments` query args the bundle uses for its first list paint. Use to whitelist additional `_fields`, override `per_page`, or scope the default tab.

### `desktop_mode_comments_window_spam_score` — Experimental *(filter, since 0.8.3)*

```php
apply_filters( 'desktop_mode_comments_window_spam_score', int $score, WP_Comment $comment ): int
```

Filters the 0–100 spam-confidence score the bundle paints per row. Hook here to plug in an AI-provider fallback when Akismet isn't installed but a Desktop Mode AI provider is configured. Return value is clamped to `0..100`.

### `desktop_mode_comments_window_reply_editor` — Experimental *(filter, since 0.8.3)*

```php
apply_filters( 'desktop_mode_comments_window_reply_editor', string $editor, int $user_id ): string
```

Selects the inline-reply editor flavor — `'rich'` (default contenteditable rich editor), `'plain'` (textarea), or `'gutenberg'` (planned — currently falls back to `'rich'`).

### `desktop_mode_comments_window_after_bulk` — Stable *(action, since 0.8.3)*

```php
do_action( 'desktop_mode_comments_window_after_bulk', string $action, int[] $processed, int[] $skipped );
```

Fires after `/desktop-mode/v1/comments/bulk` finishes a batch. `$action` is one of `approve|unapprove|spam|unspam|trash|untrash`. `$processed` is the list of ids successfully acted on; `$skipped` is the list that failed a per-target cap or soft error.

### `desktop_mode_comments_ai_is_enabled` — Experimental *(filter, since 0.8.3)*

```php
apply_filters( 'desktop_mode_comments_ai_is_enabled', bool $enabled ): bool
```

Whether AI moderation for new comments is enabled. Site-wide, not per-user — hooks here override the `desktop_mode_comments_ai_moderation` site option, which is useful for gating by environment (staging vs. production) or by feature flag.

### `desktop_mode_comments_ai_toggled` — Experimental *(action, since 0.8.3)*

```php
do_action( 'desktop_mode_comments_ai_toggled', bool $enabled );
```

Fires after the Comments AI moderation toggle is changed via `POST /desktop-mode/v1/comments/ai-settings`. `$enabled` is the new state.

---

## Native Users window (since 0.8.1)

Reuses the Posts window bundle (`mode: 'users'` config discriminator) to replace the chromeless `users.php` iframe: role filter, bulk role change / delete / remove, "Add new user" form, per-row quick actions, and a Profile tab. Per-user opt-in Beta (default `false`) via OS Settings → Features → Beta features → `nativeUsersEnabled`. UI-side gating is UX polish only — the REST routes re-validate every capability and per-target permission before mutating anything.

### `desktop_mode_users_window_user_can_register` — Stable *(filter, since 0.8.1)*

```php
apply_filters( 'desktop_mode_users_window_user_can_register', bool $can, int $user_id ): bool
```

Cap-only gate (`list_users`) that decides whether the native Users window is registered for this user at boot. Returning `false` skips the entire registration. Decoupled from the opt-in toggle — same register/use split as the Posts window.

### `desktop_mode_users_window_user_can_use` — Stable *(filter, since 0.8.1)*

```php
apply_filters( 'desktop_mode_users_window_user_can_use', bool $can, int $user_id ): bool
```

The combined cap-and-opt-in answer (`list_users` AND `nativeUsersEnabled`). Informational only — it does not affect registration or the dock-click remap; same semantics as `desktop_mode_posts_window_user_can_use`.

### `desktop_mode_users_window_assignable_roles` — Experimental *(filter, since 0.8.1)*

```php
apply_filters( 'desktop_mode_users_window_assignable_roles', string[] $slugs, int $viewer_id, int $target_id ): string[]
```

The role slugs `$viewer_id` may assign to `$target_id`. Default: the keys of core's `get_editable_roles()` evaluated from the viewer's perspective (empty when the viewer lacks `promote_users`). Use it to LOCK DOWN role assignment further — e.g. "site managers can't promote anyone to administrator". Returning an empty array fully disables role mutation for the viewer. Returning a superset widens the REST endpoints too — both the bulk-role route and the create-user route validate the requested role against this same filtered list, so only add roles you genuinely intend to make assignable.

### `desktop_mode_users_window_args` — Experimental *(filter, since 0.8.1)*

```php
apply_filters( 'desktop_mode_users_window_args', array $window_args ): array
```

Filters the args passed to `desktop_mode_register_window( 'desktop-mode-users', … )` — title, icon, dimensions, `config` blob (capability flags, role maps, locale map, REST mutation routes).

### `desktop_mode_users_window_template_html` — Experimental *(filter, since 0.8.1)*

```php
apply_filters( 'desktop_mode_users_window_template_html', string $html ): string
```

The full template body before it's `wp_kses`'d into the native-window template element.

### `desktop_mode_users_window_query_args` — Experimental *(filter, since 0.8.1)*

```php
apply_filters( 'desktop_mode_users_window_query_args', array $args ): array
```

Default outbound REST query args the bundle merges into every `/wp/v2/users` request. Defaults ship a `_fields` whitelist (including the `desktop_mode_user_stats`, `desktop_mode_last_login`, `desktop_mode_presence`, `desktop_mode_can_edit`, and `desktop_mode_assignable_roles` REST fields), `context=edit` (required for `email` / `roles` / `registered_date` to appear at all), and `per_page=20`.

### `desktop_mode_users_window_user_created` — Stable *(action, since 0.8.1)*

```php
do_action( 'desktop_mode_users_window_user_created', int $user_id, WP_User $user, array $args );
```

Fires after the Users window's create-user REST route has created a new account (and queued the optional notification email). `$args` is the sanitized `wp_insert_user()` arg array used for creation.

### `desktop_mode_users_window_login_recorded` — Stable *(action, since 0.8.1)*

```php
do_action( 'desktop_mode_users_window_login_recorded', int $user_id, int $timestamp );
```

Fires on `wp_login` after the last-login user meta has been written — piggy-back here to update your own last-seen tracking without duplicating the `wp_login` listener.

---

## Native User Edit window (since 0.8.1)

A native profile-editing window (`desktop-mode-user-edit`) that opens when a row in the native Users window is clicked, or when a chromeless `user-edit.php?user_id=N` navigation is remapped. The window is registered for any logged-in user (everyone has a profile to edit); per-target capability is re-checked at REST time — saving uses core's `/wp/v2/users/<id>` PUT, which enforces `edit_user`, and the insights endpoint applies the same check.

### `desktop_mode_user_edit_window_user_can_register` — Experimental *(filter, since 0.8.1)*

```php
apply_filters( 'desktop_mode_user_edit_window_user_can_register', bool $can, int $user_id ): bool
```

Fires inside the `desktop_mode_user_edit_window_user_can_register()` helper. Default: `true` for any logged-in user. Note the framework's own registration path currently registers the window for every logged-in user without consulting this helper — hook it for plugin code that mirrors the gate, not to unregister the window.

### `desktop_mode_user_edit_window_args` — Experimental *(filter, since 0.8.1)*

```php
apply_filters( 'desktop_mode_user_edit_window_args', array $window_args ): array
```

Filters the args passed to `desktop_mode_register_window( 'desktop-mode-user-edit', … )` — title, icon, dimensions, `config` blob (role / locale / color-scheme maps, contact methods, insights endpoint base).

### `desktop_mode_user_edit_window_template_html` — Experimental *(filter, since 0.8.1)*

```php
apply_filters( 'desktop_mode_user_edit_window_template_html', string $html ): string
```

The template body (a `<wpd-user-profile>` host element) before it's `wp_kses`'d into the native-window template element.

### `desktop_mode_user_edit_window_insights` — Experimental *(filter, since 0.8.1)*

```php
apply_filters( 'desktop_mode_user_edit_window_insights', array $payload, WP_User $user ): array
```

The per-user insights payload returned by `GET /desktop-mode/v1/users/<id>/insights` — drives the profile sidebar tiles. Plugins can append their own metrics (security-event counts, subscription tier, …) by extending the `stats` map or adding new top-level keys; the JS bundle tolerates unknown keys. **The filtered output is transient-cached for 60 seconds** (`dm_user_insights_<id>`), so make the filter deterministic — a request with `?fresh=1` bypasses the cache.

---

## My WordPress (since 0.8.0)

A pinned virtual folder on the wallpaper that opens a native file-explorer window for browsing WordPress entities. Ships with Posts, Pages, (since 0.8.2) Users, and (since 0.8.6) Media. The entity list is filterable so plugin authors can extend it without forking the bundle.

### `desktop_mode_my_wordpress_user_can_use` — Experimental (filter)

```php
apply_filters( 'desktop_mode_my_wordpress_user_can_use', bool $can ): bool
```

Gates icon registration and window registration in one shot. Default `current_user_can( 'edit_posts' )`. Return `false` to hide the entry point for a role; return `true` to opt a role back in.

### `desktop_mode_my_wordpress_window_args` / `desktop_mode_my_wordpress_icon_args` — Experimental (filter)

Tweak the args passed to `desktop_mode_register_window()` / `desktop_mode_register_icon()` for My WordPress — useful to change dimensions, swap the dashicon, or remove the `pinned` flag so the icon participates in the normal sort order.

### `desktop_mode_my_wordpress_entities` — Experimental (filter)

```php
apply_filters( 'desktop_mode_my_wordpress_entities', array[] $entities ): array[]
```

The list of entity types rendered as folder tiles in the window's root view. Each entry must declare:

- `id` — slug, used in the route hash and tile `data-entity-id`.
- `label` — human-readable folder name.
- `icon` — Dashicons class.
- `restPath` — appended to `restRoot` (e.g. `wp/v2/posts`, `wp/v2/comments`).
- `kind` *(optional, since 0.8.2)* — `'post'` (default for back-compat), `'user'`, or (since 0.8.6) `'media'`. Drives the in-window render path: `'post'`-shaped entities use the title/excerpt/featured-image tile + rendered-HTML preview; `'user'`-shaped entities use the avatar-tile, the dossier preview, and the activity-footprint surface; `'media'`-shaped entities use the media-grid tile and the media drill-in preview ("used in" view). Omit the field to inherit the post path — works for any REST collection that ships `title.rendered` + `content.rendered`. Plugins can register further kinds on the JS side via `wp.desktop.myWordpress.registerEntityKind()`.

Defaults ship `posts`, `pages`, `users`, and `media`. Plugins can pre-stage Comments / Tags / Categories without waiting for new code in this module — the bundle treats every entry uniformly.

### `desktop_mode_my_wordpress_template_html` — Experimental (filter)

The static template body before it's emitted into the native-window template element. Keep the `data-desktop-mode-my-wordpress-*` data hooks intact so the JS bundle can find its mount points.

### `desktop_mode_my_wordpress_user_stats` — Experimental (filter, since 0.8.0)

```php
apply_filters( 'desktop_mode_my_wordpress_user_stats', array $payload, int $user_id ): array
```

The aggregated per-user dossier payload returned by `GET /desktop-mode/v1/user-stats/<id>` — drives the right-pane preview for a selected user (Author / Contributors sub-folders, and the Users folder root). Plugins can drop additional sections (badges, milestones, contribution streaks) without forking the JS render.

The payload is permission-shaped before this filter runs: viewers without `list_users` (who are not the subject user) receive a published-only dossier — the recent-posts list is restricted to `publish`, `counts.posts` / `counts.pages` collapse to published-only totals, and sensitive profile fields (email, registered date, role) are withheld.

### `desktop_mode_my_wordpress_user_footprint` — Experimental (filter, since 0.8.2)

```php
apply_filters( 'desktop_mode_my_wordpress_user_footprint', array $payload, int $user_id ): array
```

The per-user activity-footprint payload returned by `GET /desktop-mode/v1/user-footprint/<id>` — drives the full-body "View activity footprint" surface (right-click on a user tile → footprint). Carries a year of day-by-day activity, weekday + hour-of-day distribution, streak math, recent-events timeline, and totals. Plugins can extend the timeline with their own activity rows (deploys, badges earned, etc.) or replace the streak math with a domain-specific definition.

Timeline rows whose underlying post is not published (draft, pending, private, future) are only emitted when the viewer passes `current_user_can( 'read_post' )` for that post — the gate applies across the post, post-update, and comment row sources — so unpublished titles never leak to ordinary logged-in users.

### `desktop_mode_user_footprint_row_action` — Stable (filter, since 0.9.1)

```php
apply_filters( 'desktop_mode_user_footprint_row_action', bool $show, WP_User $user_object ): bool
```

Gates the **"View activity footprint"** row action added to the classic Users list table (`users.php`). The action is only ever appended on a chromeless request (inside the desktop shell's iframe, where the bridge is present to receive the click); this filter is the final say within that context. Return `false` to suppress the action for a given user — e.g. to scope it to a role, or hide it on the viewer's own row. Default `true`.

The action carries the target user id in a `data-desktop-mode-footprint` attribute; the chromeless bridge escalates the click as the `desktop-mode-open-user-footprint` message (see [`bridge-protocol.md`](bridge-protocol.md) and [`javascript-reference.md`](javascript-reference.md)), opening the My WordPress window on that user's footprint without closing the Users list. The link's `href` is a real `user-edit.php` / `profile.php` URL — the graceful fallback for no-JS or modifier clicks.

### `desktop_mode_my_wordpress_comment_stats` — Experimental (filter, since 0.8.0)

```php
apply_filters( 'desktop_mode_my_wordpress_comment_stats', array $payload, int $comment_id ): array
```

The per-comment dossier payload returned by `GET /desktop-mode/v1/comment-stats/<id>` — carries the comment body (`comment`), the author aggregate (`author`), the post it belongs to (`post`), its parent (`parent`), and replies (`replies`). Plugins can append their own sections without forking the JS render.

### `desktop_mode_my_wordpress_term_stats` — Experimental (filter, since 0.8.0)

```php
apply_filters( 'desktop_mode_my_wordpress_term_stats', array $payload, string $taxonomy, int $term_id ): array
```

The per-term stats payload returned by `GET /desktop-mode/v1/term-stats/<taxonomy>/<id>` — profile, counts, recent posts, top authors, co-terms, activity, and milestones. Filter it to splice in extra metrics before it reaches the My WordPress folder window.

### `desktop_mode_my_wordpress_post_contributors` — Experimental (filter, since 0.8.0)

```php
apply_filters( 'desktop_mode_my_wordpress_post_contributors', int[] $ids, int $post_id ): int[]
```

The contributor user ids for a post — drives the Contributors sub-folder. Defaults gather Co-Authors Plus authors, revision authors, and the `_edit_last` meta; plugins that track contributors via custom meta, a taxonomy, a join table, or any other mechanism append their ids here. Each id should resolve to a `WP_User`; non-resolving ids, duplicates, and the primary author are dropped after the filter runs.

### `desktop_mode_my_wordpress_media_usage` — Experimental (filter, since 0.8.6)

```php
apply_filters( 'desktop_mode_my_wordpress_media_usage', array $payload, int $attachment_id ): array
```

The "used in" payload returned by `GET /desktop-mode/v1/media-usage/<id>` — drives the Media drill-in view (double-click a media tile). Each `usedIn` row carries `{ postId, postType, postTypeLabel, title, status, link, editLink, usedAs:'featured'|'content'|'meta', authorId, authorName, date }`. Plugins (ACF, page builders, Yoast image meta) can push additional rows describing references their own data layer holds — e.g. ACF image fields, gallery blocks, theme-mod backgrounds.

Rows are already filtered per-row through `current_user_can('read_post', $row['postId'])`, so the viewer never sees drafts they can't read. Only the viewer-independent reference scan (post id → `usedAs` map, the heavy SQL portion) is transient-cached (default 5 min), keyed by attachment + a coarse capability bucket (key hygiene, not a security boundary) — the per-row `read_post` gate and this filter both run on every request, so a cache hit can never leak unreadable rows across viewers and filter extensions stay live. Cache busts on `save_post`, `before_delete_post` (deliberately not `deleted_post` — by then the post's refs are gone and the stale cache would survive), and `delete_attachment`.

### `desktop_mode_my_wordpress_attached_media` — Experimental (filter, since 0.8.6)

```php
apply_filters( 'desktop_mode_my_wordpress_attached_media', int[] $ids, int $post_id ): int[]
```

Attachment ids referenced by a post — featured image plus everything resolved from `post_content` (block-class scan, classic `[caption]` shortcodes, `data-id` / `data-attachment-id`, and raw `<img src>` URL resolution including `-scaled.jpg` ↔ original swaps). Exposed on every public post type as the `desktop_mode_attached_media` REST field (read-only, integer array). Plugins that store attachment references outside `post_content` (ACF image fields, page-builder block storage, post-meta galleries) should append their ids here. Sanitized post-filter — non-positive values and non-arrays are discarded.

### `desktop_mode_my_wordpress_media_usage_cache_ttl` — Experimental (filter, since 0.8.6)

```php
apply_filters( 'desktop_mode_my_wordpress_media_usage_cache_ttl', int $seconds, int $attachment_id ): int
```

Lifetime (seconds) of the per-attachment media-usage transient. Lower it on sites that frequently bulk-import or rewrite content; raise it on stable libraries.

### `desktop_mode_my_wordpress_preview_actions` — Experimental (filter, since 0.8.6)

```php
apply_filters( 'desktop_mode_my_wordpress_preview_actions', array[] $actions ): array[]
```

Server-declared descriptors for the right-pane action button row that appears in every My WordPress section (posts, pages, users, media, plugin-defined kinds). Each entry:

```php
array(
    'id'         => 'my-plugin/compress-image', // required, unique
    'label'      => 'Compress this image',      // required
    'icon'       => 'dashicons-image-rotate',   // optional
    'capability' => 'upload_files',             // optional, default 'read'
    'mime'       => '^image/',                  // optional PCRE
    'sections'   => array( 'media' ),           // optional, default all
    'script'     => 'my-plugin-actions',        // optional wp_register_script handle
)
```

`capability` is enforced server-side before the descriptor ships to the bundle, so an action the current user can't run never appears in their UI. `script`, if registered, is auto-enqueued. Wire the click handler on the JS side via `wp.hooks.addFilter('desktop-mode.my-wordpress.preview-actions', …)` — see [`examples/my-wordpress-media-action.md`](./examples/my-wordpress-media-action.md).

---

## Content Graph (since 0.8.1)

An interactive PixiJS map of post links — every public post type participates as a node; internal links, terms, authors, and comments form the edges. Registers a native window (`desktop-mode-content-graph`) plus a desktop icon on `init` priority 20. The filterable surface mirrors the My WordPress module shape.

### `desktop_mode_content_graph_user_can_use` — Experimental (filter)

```php
apply_filters( 'desktop_mode_content_graph_user_can_use', bool $can ): bool
```

Gates icon registration and window registration in one shot. Default `current_user_can( 'edit_posts' )` — anyone who can edit posts can view the link map of the content they author and maintain.

### `desktop_mode_content_graph_post_types` — Experimental (filter)

```php
apply_filters( 'desktop_mode_content_graph_post_types', array[] $post_types ): array[]
```

The list of post types shown in the graph's filter bar. Each entry declares `slug`, `label`, and `icon`. Default: every public post type except `attachment` (media renders in the side panel rather than as nodes). Removing an entry hides it from the filter bar AND excludes it from the graph entirely.

### `desktop_mode_content_graph_template_html` — Experimental (filter)

```php
apply_filters( 'desktop_mode_content_graph_template_html', string $html ): string
```

The window's static template body before it's `wp_kses`'d. The bundle mounts into `[data-desktop-mode-content-graph-root]` — keep the `data-desktop-mode-content-graph-*` hooks intact.

### `desktop_mode_content_graph_window_args` / `desktop_mode_content_graph_icon_args` — Experimental (filter)

```php
apply_filters( 'desktop_mode_content_graph_window_args', array $window_args ): array
apply_filters( 'desktop_mode_content_graph_icon_args',   array $icon_args ): array
```

Tweak the args passed to `desktop_mode_register_window()` / `desktop_mode_register_icon()` for the Content Graph — dimensions, dashicon, icon position, or the `config` blob (REST endpoints, edit-URL bases, post-type descriptors).

---

## Presence

Framework-level presence tracking. Storage in
`_desktop_mode_presence` (autoload=false, single row keyed by user
id). The WordPress Heartbeat carries the bumps + visibility
snapshot; the JS API at `wp.desktop.presence.*` fans out to
plugin code. See [`examples/presence.md`](./examples/presence.md)
for a copy-pasteable recipe.

### Filters — Stable

```php
apply_filters( 'desktop_mode_presence_inactive_after', $seconds );  // default 300 (5m)
apply_filters( 'desktop_mode_presence_offline_after',  $seconds );  // default 120 (2m)
apply_filters( 'desktop_mode_presence_can_track',      $can, $user_id );
apply_filters( 'desktop_mode_presence_visible_users',  $ids, $viewer_id );
```

- **`desktop_mode_presence_inactive_after`** — seconds without
  user input before `online` demotes to `inactive`. Tune up for
  long-form writing tools, down for chat-heavy environments.
- **`desktop_mode_presence_offline_after`** — seconds without a
  heartbeat before any tracked user is considered `offline`.
- **`desktop_mode_presence_can_track`** — per-user veto. Return
  `false` to skip the bump entirely (compliance flags,
  "appear invisible" toggles, allow-list policies).
- **`desktop_mode_presence_visible_users`** — privacy gate.
  Receives the candidate id list + the viewer id, returns the
  list narrowed to whoever this viewer should see. Default
  passes through unchanged. Plugins building team boundaries
  hook here.

### Actions — Stable

```php
do_action( 'desktop_mode_presence_recorded', $user_id, $record );
do_action( 'desktop_mode_presence_changed',  $user_id, $new_status, $old_status );
```

- **`desktop_mode_presence_recorded`** — fires on every heartbeat
  bump, whether status changed or not. Be cheap inside this
  callback — it runs on every Heartbeat tick for every active
  desktop-mode user.
- **`desktop_mode_presence_changed`** — fires only on real status
  transitions (`online ↔ inactive ↔ offline`). The right hook
  for "user came online → notify a slack channel" type work.

### PHP helpers (since 0.6.0)

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
| `GET`  | `/desktop-mode/v1/presence` | Visible-users snapshot for the current viewer. |
| `POST` | `/desktop-mode/v1/presence` | Bump (`{active:true}`), heartbeat-only (`{active:false}`), or "set yourself away" (`{inactive:true}`). |

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

Built-in control ids registered by the framework: `core/minimize`, `core/maximize`, `core/focus-tab`, `core/close`. (`core/detach` and `core/reload` are no longer title-bar controls — detach/reload moved into the title-bar three-dots menu in 0.6.2.) Plugins can `unregisterWindowControl()` any of them globally, or use per-window `appearance.controls.{order, hide, custom}` for window-scoped mutations.

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

### Window notices — Experimental  *(since 0.8.6)*

```php
desktop_mode_register_window_notice( $args );
```

`$args`:
- `id` *(required)* — persistence + dedupe key.
- `message` *(required)* — HTML body. Passed through `wp_kses_post()`.
- `tone` — `info` (default) | `success` | `warning` | `error` | `danger` | `neutral`.
- `dismissible` — show a close button. Default `true`.
- `icon` — optional Dashicons class.
- `match` — optional selector: `{ window?: 'edit-php' }`, `{ windows?: [ 'edit-php', 'edit-php-page' ] }`, or `{ urlContains?: 'wc-admin' }`. Combine freely; omit for "every window."
- `order` — sort order. Lower renders higher in a stack. Default 100.

Notices render as `<wpd-notice>` inside the matching window's
`after-titlebar` slot. Each user's dismissal is persisted in
`localStorage` so the same banner never reappears for them.

Actions / filters:
- `desktop_mode_window_notice_registered( $id, $entry )` — action.
- `desktop_mode_window_notices( $entries )` — filter the final list right before it ships to the shell (request-time banners).

See [`docs/examples/window-notice.md`](examples/window-notice.md).

---

## Progressive Web App (since 0.8.0)

### `desktop_mode_pwa_manifest` — Stable (filter)

Filters the web-app manifest payload before it's encoded and served at
`/desktop-mode/manifest.webmanifest`. Mutate icons, name, theme color,
or add `shortcuts`. Returning a non-array silently disables the
manifest.

```php
add_filter( 'desktop_mode_pwa_manifest', static function ( array $manifest ) {
    $manifest['theme_color'] = '#7e22ce';
    $manifest['shortcuts']   = [
        [
            'name' => 'New Post',
            'url'  => '/wp-admin/post-new.php',
        ],
    ];
    return $manifest;
} );
```

### `desktop_mode_pwa_force_replace_sw` — Stable (filter)

Opt desktop-mode in to replace a foreign root-scope service worker on
this origin. Default `false` — desktop-mode yields to any existing SW
(Super PWA, Jetpack Boost, etc.) and the install tile shows a toast
naming this filter as the path forward. Return `true` to take over.

```php
add_filter( 'desktop_mode_pwa_force_replace_sw', '__return_true' );
```

Use this to unblock the "Install \<site\> as an app" affordance on sites
where another PWA plugin's SW is shadowing desktop-mode and Chromium
therefore won't fire `beforeinstallprompt`.

### PHP helpers — Stable

```php
desktop_mode_pwa_manifest_url();
desktop_mode_pwa_sw_url();
desktop_mode_pwa_force_replace_sw();
desktop_mode_pwa_get_user_state( $user_id = 0 );
desktop_mode_pwa_update_user_state( array $patch, $user_id = 0 );
```

`desktop_mode_pwa_get_user_state` returns
`array{ installHintDismissed: bool, notificationsEnabled: bool }`.

### REST endpoints — Stable

- `GET  /wp-json/desktop-mode/v1/pwa-state`
- `POST /wp-json/desktop-mode/v1/pwa-state` — body
  `{ installHintDismissed?: bool, notificationsEnabled?: bool }`.

Both require `read` capability and a valid `X-WP-Nonce`.

See [`docs/pwa.md`](./pwa.md) for the full architecture and
[`docs/examples/pwa-install.md`](./examples/pwa-install.md) /
[`docs/examples/notify.md`](./examples/notify.md) for recipes.

---

## Nonce refresh (since 0.8.7)

The desktop shell is a long-running SPA whose nonces would
otherwise go stale past WordPress's `nonce_life` (24 h). To
prevent this, `includes/nonce-refresh.php` registers a
`heartbeat_received` filter that ships fresh values for a fixed
set of nonce actions on every Heartbeat tick — the client
overwrites the cached values in `window.desktopModeConfig` and
the per-window blobs in place.

### `desktop_mode_nonce_refresh_actions` — Stable *(filter, since 0.8.7)*

Filter the list of nonce-action strings the server refreshes on
every Heartbeat tick.

```php
add_filter( 'desktop_mode_nonce_refresh_actions', function ( $actions ) {
    $actions[] = 'my-plugin/admin-ajax';
    return $actions;
} );
```

- **Param** `string[] $actions` — default set: `[ 'wp_rest',
  'desktop-mode-plugins', 'updates' ]`.
- **Return** `string[]` — non-string / empty entries are
  silently dropped.

Each action string is passed verbatim to `wp_create_nonce()`,
so it MUST match whatever was used to mint the original cached
nonce. On the client side, subscribe to the `desktop_mode_nonces`
heartbeat field via
[`wp.desktop.heartbeat.subscribe`](./javascript-reference.md#nonce-refresh--heartbeat-field-stable-since-087)
and write the value where your code reads from.

---

## Sticky notes (since 0.8.8)

Sticky notes are backed by **Gutenberg's Guidelines experiment** — the
`wp_guideline` CPT and `wp_guideline_type` taxonomy (exposed at
`wp/v2/guidelines` and `wp/v2/wp_guideline_type`). That experiment is
opt-in (Gutenberg plugin 22.7+, under Gutenberg → Experiments). When it
isn't active those REST routes 404, so both the Heartbeat delta handler
and the client-side layer gate on availability.

### `desktop_mode_sticky_notes_available` — Stable *(filter, since 0.9.1)*

Filters whether the sticky-notes surface is treated as available. The
default is `post_type_exists( 'wp_guideline' ) && taxonomy_exists(
'wp_guideline_type' )`. The result is read by
`desktop_mode_sticky_notes_is_available()`, which gates both the
`heartbeat_received` delta handler and the `stickyNotes.available` flag
in the shell config (so the client skips booting the layer — and its
404-prone REST probes — when `false`).

```php
apply_filters( 'desktop_mode_sticky_notes_available', bool $available );
```

**Example — force sticky notes off site-wide even when Guidelines is enabled:**

```php
add_filter( 'desktop_mode_sticky_notes_available', '__return_false' );
```

- **Param** `bool $available` — whether the guideline CPT + taxonomy are registered.
- **Return** `bool` — coerced with `(bool)`.

---

## Asset loading

### `desktop_mode_preload_hints` — Stable *(filter, since 0.8.9)*

Filters the `<link>` resource hints emitted in `<head>` for the shell's
critical-path and lazy bundles. Each entry is
`{ 'href' => string, 'as' => string, 'rel' => 'preload'|'prefetch' }`.
`rel` is optional and defaults to `preload`; any value other than
`prefetch` is coerced back to `preload`. Entries missing `href` or `as`
are skipped.

Use `preload` for resources consumed on the current load (high priority,
must be used within a few seconds or the browser warns); use `prefetch`
for lazy bundles `<script>`-injected on a later interaction.

```php
add_filter( 'desktop_mode_preload_hints', function ( $hints ) {
    // Warm a settings-tab bundle the user opens on every visit.
    $hints[] = array(
        'href' => plugins_url( 'assets/my-tab.min.js', __FILE__ ),
        'as'   => 'script',
        'rel'  => 'prefetch',
    );
    return $hints;
} );
```

- **Param** `array $hints` — default: shell bundle + `desktop.css` as `preload`; `window-system` + `shell-overlays` lazy bundles as `prefetch`.
- **Return** `array` — non-array entries are skipped.

**Note.** A `preload` hint only counts as "used" when an actual request
for the *exact same URL* (including `?ver=`) follows. The shell stamps
`desktop.css` (and the JS bundles) with `filemtime` in both the hint and
the enqueue so the two URLs match — a `?ver=` mismatch makes the browser
log "preloaded but not used in time".

### `desktop_mode_deferred_styles` — Stable *(filter, since 0.8.9)*

Filters the list of stylesheet **handles** loaded via the
`media="print"` + `onload` deferral pattern (so they don't block first
paint). Default: `desktop-mode-dock-peek`, `desktop-mode-ai-assistant`,
`desktop-mode-bug-report`. Add a handle to defer it, or remove one to
keep it on the critical path.

```php
add_filter( 'desktop_mode_deferred_styles', function ( $handles ) {
    $handles[] = 'my-plugin-heavy-panel';
    return $handles;
} );
```

---

## See also

- [JavaScript Reference](./javascript-reference.md) — the event + postMessage side of the contract.
- [Examples](./examples/README.md) — full-plugin recipes.
