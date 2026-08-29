# Hooks Reference

Every PHP action and filter the plugin fires, with signatures, examples, and **implementation status**.

- **Stable** — shipping today, keep working across the current major version.
- **Experimental** — shipping, but signature may change.
- **Planned** — reserved name, not yet fired. Do not subscribe in production.

If something you need isn't here, open an issue. New hooks are welcome — our rule of thumb: *if a function decides something, wrap it in a filter; if it does something, fire an action around it.*

> **Looking for JavaScript hooks?** The browser-side shell exposes WordPress-style filters and actions via `window.wp.hooks` under the `os.*` namespace — including hooks for wallpaper registration, window lifecycle, and the animated logo wallpaper's visibility events. See the [JavaScript Reference](./javascript-reference.md#4-hooks--openstation) for the full catalog.

### PHP vs. JS hook parity

The two hook surfaces are **deliberately not mirrored** — they target different extension points:

- **PHP hooks** (this file) fire on the server: shell mount, chromeless render, dock-items composition, portal / session logic. If you're changing server-rendered state, you want PHP.
- **JS hooks** (javascript-reference.md) fire in the browser: window lifecycle, drag / resize, overview, arrange actions, wallpaper + widget mount lifecycle, virtual-desktop transitions. If you're reacting to user interaction, you want JS.

A few concepts ARE mirrored (e.g. `openstation_dock_items` PHP filter ↔ `os.widgets` JS filter — both shape registries), but most aren't. Don't be surprised if a JS hook has no PHP counterpart or vice versa — that's the design.

---

## Actions

### `openstation_mode_init` — Stable
Fires once inside the parent shell render, after desktop assets have been enqueued. Use this to enqueue your own shell-side JS/CSS.

```php
do_action( 'openstation_mode_init' );
```

**Example:**

```php
add_action( 'openstation_mode_init', function () {
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

### `openstation_shell_before` — Stable
Fires just before the shell's opening `<div id="os-shell">`. Echo HTML here to prepend sibling markup (e.g. a global announcement banner that sits above the shell).

```php
do_action( 'openstation_shell_before' );
```

---

### `openstation_shell_after` — Stable
Fires just after the shell's closing `</div>`. Echo HTML to append below it.

```php
do_action( 'openstation_shell_after' );
```

---

### `openstation_chromeless_styles` — Stable
Fires inside iframe (chromeless) requests, during `admin_enqueue_scripts`. Use it to enqueue **iframe-scoped** CSS that fine-tunes how specific admin pages render inside a window.

```php
do_action( 'openstation_chromeless_styles' );
```

**Example:**

```php
add_action( 'openstation_chromeless_styles', function () {
    wp_add_inline_style(
        'os-chromeless',
        'body.edit-php .subsubsub { margin-top: 4px; }'
    );
} );
```

---

### `openstation_native_window_registered` — Stable

Fires after `openstation_register_window()` successfully stores a window. Does NOT fire when the registration returns a `WP_Error`.

```php
do_action( 'openstation_native_window_registered', string $id, array $entry );
```

**Example — react when another plugin registers a window:**

```php
add_action( 'openstation_native_window_registered', function ( $id, $entry ) {
    if ( 'jorvy' === $id ) {
        // Attach a companion behavior only when Jorvy is present.
    }
}, 10, 2 );
```

---

### `openstation_native_window_config` — Experimental (filter)

```php
apply_filters( 'openstation_native_window_config', array $config, string $window_id ): array
```

A native window's `config` blob, at emit time. The registry snapshots `config` when `openstation_register_window()` runs (usually `init`); this filter runs when the blob is serialized for the browser — at enqueue time for preloaded bundles, at payload-build time for lazy ones — so values that depend on hooks registered later in the bootstrap can be refreshed without moving the whole registration. Runs per request after the current user is determined, so capability-gated values are safe to compute here. Return value must be an array; anything else ships nothing.

The WP Explorer uses it to re-collect its `previewActions` (see [`openstation_my_wordpress_preview_actions`](#openstation_my_wordpress_preview_actions--experimental-filter)) so action descriptors registered after `init` 99 still reach the bundle.

```php
add_filter( 'openstation_native_window_config', function ( $config, $window_id ) {
    if ( 'my-plugin-window' === $window_id ) {
        $config['launchCount'] = (int) get_user_option( 'my_plugin_launches' );
    }
    return $config;
}, 10, 2 );
```

Mid-session caveat: the blob is delivered alongside the window's script, and an already-loaded bundle keeps the copy it booted with until the next full page load.

---

### `openstation_widget_registered` — Stable

Fires after `openstation_register_widget()` successfully stores a widget. Same contract as the native-window action.

```php
do_action( 'openstation_widget_registered', string $id, array $entry );
```

---

### `openstation_register_station_home_card( $id, $args )` — Experimental (PHP function)

Registers a structured card in Station Home's **From your plugins** area. The registration metadata always powers the current user's picker; the callback runs only when the effective per-user state is enabled. This is a data contract, not an HTML injection hook.

```php
openstation_register_station_home_card( 'my-plugin-orders', array(
    'label'           => __( 'Orders', 'my-plugin' ),
    'description'     => __( 'Orders waiting to be fulfilled.', 'my-plugin' ),
    'provider'        => __( 'My Plugin', 'my-plugin' ),
    'icon'            => 'dashicons-cart',
    'default_enabled' => false,
    'order'           => 20,
    'capabilities'    => array( 'manage_options' ),
    'callback'        => function ( $user_id, $entry ) {
        return array(
            'value'        => '4',
            'detail'       => __( 'Ready to fulfil', 'my-plugin' ),
            'url'          => admin_url( 'admin.php?page=my-plugin-orders' ),
            'action_label' => __( 'Open orders', 'my-plugin' ),
            'tone'         => 'warning',
        );
    },
) );
```

`label` and a callable `callback` are required. IDs must already be `sanitize_key()`-clean. `default_enabled` defaults to `false`, making first use an explicit opt-in; a plugin may set it to `true`, after which the user can opt out. Supported callback fields are `value`, `detail`, `url`, `action_label`, `external`, and `tone` (`neutral|info|success|warning|danger`). Returning `WP_Error` or a non-array omits the card for that snapshot. `openstation_unregister_station_home_card( $id )` removes a registration.

Returns `true` or `WP_Error` (`openstation_invalid_station_home_card_id`, `openstation_missing_label`, `openstation_invalid_callback`, or `openstation_capability_denied`). Full recipe: [`examples/station-home-card.md`](./examples/station-home-card.md).

### Station Home card actions — Experimental

```php
do_action( 'openstation_station_home_card_registered', string $id, array $entry );
do_action( 'openstation_station_home_card_preference_updated', int $user_id, string $id, bool $enabled );
do_action( 'openstation_station_home_card_error', Throwable $error, string $id, array $entry );
```

The first fires only after a successful registration. The second fires after an explicit per-user opt-in/opt-out is stored. The error action reports a thrown callback without allowing one plugin to take down Station Home.

---

### `openstation_wallpaper_registered` — Stable

Fires after `openstation_register_wallpaper()` successfully stores a wallpaper. Same contract.

```php
do_action( 'openstation_wallpaper_registered', string $id, array $entry );
```

---

### `openstation_icon_registered` — Stable

Fires after `openstation_register_icon()` successfully stores a desktop shortcut tile. Same contract as the other registration actions — no fire on `WP_Error` return.

```php
do_action( 'openstation_icon_registered', string $id, array $entry );
```

---

### `openstation_register_game( $id, $args )` — Experimental (PHP function)

Register a desktop game with the games framework. The game appears as a launcher tile in the **Games** window and gets a tab in the unified scoreboard; its JS bundle (declared via `script`) is loaded **lazily on first launch** — unlike wallpapers, game scripts are never fetched at boot. The loaded script publishes the full game def (with its `render` callback) on `window.openStationGames[ $id ]` — see `docs/examples/register-game.md`.

```php
openstation_register_game( 'my-plugin-puzzle', array(
    'title'         => __( 'Puzzle', 'my-plugin' ),        // required
    'description'   => __( 'Slide the tiles.', 'my-plugin' ),
    'icon'          => 'dashicons-screenoptions',           // or `icon_svg` (raw <svg>, wins over icon)
    'script'        => 'my-plugin-puzzle-game',             // required — registered handle
    'score_columns' => array(                               // scoreboard columns, in order
        array( 'key' => 'score', 'label' => __( 'Score', 'my-plugin' ), 'type' => 'number' ),
        array( 'key' => 'time',  'label' => __( 'Time', 'my-plugin' ),  'type' => 'time' ),
    ),
    'config'        => array( 'assetUrl' => '…' ),          // arbitrary blob → the game's launch context
    'capabilities'  => array(),                             // ALL must pass for the registering user
    'window'        => array(                               // window size, known before the bundle is
        'width'     => 860,
        'height'    => 660,
        'minWidth'  => 600,
        'minHeight' => 500,
    ),
) );
```

Returns `true` or `WP_Error` (`openstation_missing_id` / `openstation_missing_title` / `openstation_missing_script` / `openstation_invalid_icon_svg` / `openstation_capability_denied`). Only server-registered games can persist scores and challenges — the REST routes 404 unknown ids. `openstation_unregister_game( $id )` removes an entry.

**Declare `window` here as well as in your JS def.** The two look redundant and are not. A game's bundle is heavy — the game, its engine, sometimes a dictionary — so the shell opens the window on the click and fetches the bundle *inside* the render callback, where the window manager's loading spinner covers the wait. That means the size is needed one round trip before the def that also carries it. Any subset of `{ width, height, minWidth, minHeight }` is accepted, in pixels; values are clamped rather than rejected, and anything non-numeric or non-positive is dropped. Declaring it only in JS still works — the window just opens at the framework default (760×560) the first time a player launches that game in a session, and at its own size from then on.

**Framework config keys**: the `serverGames` payload merges framework-level keys underneath every game's `config` (the game's own keys win on collision). Currently: **`wordsUrl`** — the URL of the shared ~20k-word dictionary asset (`assets/games/words.txt`), identical for every player, which is what lets seeded games generate the same puzzle worldwide. See `openstation_games_words_url` below.

---

### `openstation_game_registered` — Experimental

Fires after `openstation_register_game()` successfully stores a game. Same contract as the other registration actions — no fire on `WP_Error` return.

```php
do_action( 'openstation_game_registered', string $id, array $entry );
```

---

### `openstation_game_score_saved` — Experimental

Fires after a leaderboard score row is written (both free play and challenge completions).

```php
do_action( 'openstation_game_score_saved', int $score_id, string $game, int $user_id, int $score, array $meta );
```

---

### `openstation_game_playtime_recorded` — Experimental

Fires after a play-time increment lands. The framework's launcher measures active window time (the clock pauses while the game window is minimized) and flushes increments roughly once a minute plus once on close; lifetime totals accumulate in the `desktop_mode_game_playtime` user-meta map (`game id => whole seconds`), readable via `openstation_games_get_playtime( $user_id, $game = '' )`. Each increment is also bucketed by site-timezone day into `desktop_mode_game_playtime_days` (`game id => array( 'YYYY-MM-DD' => seconds )`, readable via `openstation_games_get_playtime_daily()`), pruned past a rolling window (`openstation_games_playtime_history_days`, default 30) — this backs the hub's Steam-style "last two weeks" figure; the lifetime totals are never pruned.

```php
do_action( 'openstation_game_playtime_recorded', string $game, int $user_id, int $seconds, int $total );
```

`$seconds` is the recorded increment (post-clamp), `$total` the user's new total for the game.

---

### Game challenge lifecycle actions — Experimental

One action per state transition of a score-to-beat challenge:

```php
do_action( 'openstation_game_challenge_created', int $id, array $row );
do_action( 'openstation_game_challenge_accepted', int $id, array $row );   // $row is pre-transition
do_action( 'openstation_game_challenge_declined', int $id, array $row );   // $row is pre-transition
do_action( 'openstation_game_challenge_completed', int $id, string $result, array $row );
```

`$result` is `'beaten'` or `'not_beaten'`. `openstation_games_schema_installed` also fires after the two games tables (`{$prefix}desktop_mode_game_scores`, `{$prefix}desktop_mode_game_challenges`) install or migrate.

---

### `openstation_file_type_registered` — Experimental

Fires after `openstation_register_file_type()` successfully stores a desktop file type (used by the Files-on-the-Desktop system — see [files-on-desktop.md](./files-on-desktop.md)). Does NOT fire on `WP_Error`.

```php
do_action( 'openstation_file_type_registered', string $type, array $entry );
```

`$entry` keys: `type`, `label`, `class`, `script`, `sort`.

---

### Files-on-the-Desktop store actions — Experimental

Fired by the placement / folder store when rows are written. Subscribers see the canonical row arrays from the custom tables (see [files-on-desktop.md](./files-on-desktop.md)).

```php
do_action( 'openstation_file_placed',   int $id, array $row );
do_action( 'openstation_file_moved',    int $id, array $next, array $prev );
do_action( 'openstation_file_unplaced', int $id, array $row );

do_action( 'openstation_folder_created', int $id, array $row );
do_action( 'openstation_folder_updated', int $id, array $next, array $prev );
do_action( 'openstation_folder_shared',  int $id, array $next, array $prev ); // share_mode or share_meta changed
do_action( 'openstation_folder_renamed', int $id, string $new_name, string $old_name, int $user_id ); // fires AFTER the folder row + pointing-placements are bumped
do_action( 'openstation_folder_deleted', int $id, array $row );

// Folder delete cascade. Owner-only deletion runs
// the cascade described in folder-sharing.md — sub-folder recursion,
// share-row revocation, pointing-placement removal across users.
do_action( 'openstation_files_before_delete_folder',        int $id, int $user_id, array $row );
do_action( 'openstation_files_after_delete_folder_cascade', int $id, int $user_id, array $summary );
// `$summary` carries lists keyed by:
//   folders_deleted, shares_revoked, placements_pointing, placements_inside

do_action( 'openstation_files_schema_installed', string $version );
do_action( 'desktop_mode_files_daily_prune' );

// Soft-trash lifecycle. Fires for every state
// transition — placements and folders both. Trashing a folder
// cascades to its child placements; the per-child action fires
// before/after the cascade write.
do_action( 'openstation_files_before_trash_placement',   int $id, int $user_id, array $row );
do_action( 'openstation_files_after_trash_placement',    int $id, int $user_id );
do_action( 'openstation_files_before_restore_placement', int $id, int $user_id, array $row );
do_action( 'openstation_files_after_restore_placement',  int $id, int $user_id );
do_action( 'openstation_files_before_purge_placement',   int $id, int $user_id, array $row );
do_action( 'openstation_files_after_purge_placement',    int $id, int $user_id );

// Cascade trash. Fires for each placement that is
// soft-trashed because the source entity it points at (post,
// attachment, user, …) was trashed — distinct from the
// user-initiated per-placement trash actions above.
do_action( 'openstation_files_after_cascade_trash_placement', int $placement_id, int $owner_id, string $file_type, string|int $file_ref );

do_action( 'openstation_files_before_trash_folder',   int $id, int $user_id, array $row );
do_action( 'openstation_files_after_trash_folder',    int $id, int $user_id );
do_action( 'openstation_files_before_restore_folder', int $id, int $user_id, array $row );
do_action( 'openstation_files_after_restore_folder',  int $id, int $user_id );
do_action( 'openstation_files_before_purge_folder',   int $id, int $user_id, array $row );
do_action( 'openstation_files_after_purge_folder',    int $id, int $user_id );
```

### Folder sharing (Experimental)

Per-principal grants (read / write) with opt-in flow. The shares
table is `wp_desktop_mode_folder_shares`; rows are keyed by
`(target_type, folder_id, principal_type, principal_ref)` and
carry a `state` of `pending | accepted | denied`.

Actions:

```php
do_action( 'openstation_files_share_invited',             int $share_id, array $row, int $actor_id );
do_action( 'openstation_files_share_accepted',            int $share_id, array $row, int $user_id );
do_action( 'openstation_files_share_denied',              int $share_id, array $row, int $user_id );
do_action( 'openstation_files_share_left',                int $share_id, array $row, int $user_id ); // recipient-initiated leave
do_action( 'openstation_files_share_revoked',             int $share_id, array $row, int $actor_id );
do_action( 'openstation_files_share_capability_changed',  int $share_id, array $next, array $prev, int $actor_id );
do_action( 'openstation_files_sharing_tables_purged',     string[] $dropped ); // after the "Delete folder sharing data" admin action drops the sharing tables
```

Filters:

```php
apply_filters( 'openstation_files_share_eligible_roles', array $roles ); // [{ slug, name }, ...]
apply_filters( 'openstation_files_share_can_manage',     bool $can, int $folder_id, int $user_id, ?array $folder ); // default: owner only
apply_filters( 'openstation_folder_share_user_capability', string $cap, int $folder_id, int $user_id, array $folder ); // 'none'|'read'|'write'
apply_filters( 'openstation_files_share_all_default_capability', string $cap, int $folder_id, int $user_id ); // default 'read' for share_mode='all'
apply_filters( 'openstation_files_share_user_query_args', array $args, array $request_params ); // WP_User_Query args for /files/users/search
apply_filters( 'openstation_folder_share_accept_default_parent', int $parent_id, int $folder_id, int $user_id, array $share_row ); // where the recipient's placement lands
apply_filters( 'openstation_files_sharing_enabled_for', bool $enabled, int $user_id ); // per-user kill switch; default reads `foldersSharingEnabled` from OpenStation Preferences
apply_filters( 'openstation_files_user_can_see_folder', bool $can, array $folder, int $user_id, string[] $roles ); // per-folder visibility decision (owner / share_mode / shares table)
apply_filters( 'openstation_files_sharing_tables_for_purge', string[] $tables ); // tables dropped by "Delete folder sharing data"; default shares + decisions

// Polymorphic shape (future-proof).
apply_filters( 'openstation_files_shareable_types',     string[] $types ); // default [ 'folder', 'file' ]
apply_filters( 'openstation_files_share_target_owner',  int $owner_id, string $target_type, string $target_id );
```

Filters:

```php
apply_filters( 'openstation_files_can_place', bool $can, int $user_id, string $type, string $ref );
apply_filters( 'openstation_files_query_args', array $args, int $user_id, int $parent_id );
apply_filters( 'openstation_files_share_modes', string[] $modes );
apply_filters( 'openstation_files_visible_folders', array $folders, int $viewer_id );

// Folder delete + rename customization.
// `can_delete_folder` runs AFTER the ownership check; return false
// or a WP_Error to veto the cascade (UX-side confirmation prompts,
// "too many recipients" guard).
apply_filters( 'openstation_files_can_delete_folder',  bool|WP_Error $can, int $folder_id, int $user_id, array $row );
// `folder_rename_bump_where` controls the SQL WHERE used to bump
// placements pointing at a renamed folder. Default = every row with
// `file_type='folder' AND file_ref=$folder_id`. Return '' to opt out.
apply_filters( 'openstation_folder_rename_bump_where', string $where, int $folder_id, int $user_id );

// Capability gates for soft-trash / restore / purge.
// Default behavior is "owner of the row". Plugins can broaden
// (e.g. let editors restore other authors' shortcuts) or tighten.
apply_filters( 'openstation_files_user_can_trash_placement',   bool $can, int $user_id, array $row );
apply_filters( 'openstation_files_user_can_restore_placement', bool $can, int $user_id, array $row );
apply_filters( 'openstation_files_user_can_purge_placement',   bool $can, int $user_id, array $row );
apply_filters( 'openstation_files_user_can_trash_folder',      bool $can, int $user_id, array $row );
apply_filters( 'openstation_files_user_can_restore_folder',    bool $can, int $user_id, array $row );
apply_filters( 'openstation_files_user_can_purge_folder',      bool $can, int $user_id, array $row );

// Heartbeat delta row cap. Default 200, floored at 1.
// Lower it on slow links to force REST fallback sooner; raise it for
// fast-LAN intranets where a fatter Heartbeat is fine. When the cap
// is hit the payload is flagged `truncated: true` and the client
// issues a full REST resync — see files-on-desktop.md.
apply_filters( 'openstation_files_heartbeat_max_rows', int $cap );
```

The recycle-bin REST list / restore / purge dispatch the new
`placement` and `folder` types into the functions above
automatically (`openstation_recycle_bin_restore` /
`openstation_recycle_bin_purge` route by `$type`). The
`openstation_recycle_bin_count` filter takes a fourth
arg: `int $files_count`. The `$post_count` / `$total`
inputs are capability-scoped per user: tracked post types the
viewer cannot edit at all contribute zero, and types where the
viewer can only edit their own posts are counted author-scoped —
the badge never discloses the global trash total to
low-capability users.

---

### `openstation_file_opener_registered` — Experimental

Fires after `openstation_register_file_opener()` successfully stores a file opener (used by the Files-on-the-Desktop association layer — see [files-on-desktop.md](./files-on-desktop.md)). Does NOT fire on `WP_Error`.

```php
do_action( 'openstation_file_opener_registered', string $id, array $entry );
```

`$entry` keys: `id`, `label`, `types`, `is_default`, `sort`, `script`.

---

### `openstation_register_file_opener( $id, $args )` — Experimental (PHP function)

Registers a file opener — the desktop-OS equivalent of a default-app association. PHP-side metadata only; the actual handler that opens the URL / native window / runs JS lives on the JS side via `wp.os.files.registerOpener()`.

```php
openstation_register_file_opener( 'classic-editor', array(
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

Return: `true` on success, `WP_Error` otherwise. Error codes: `openstation_missing_id`, `openstation_missing_label`, `openstation_missing_types`, `openstation_capability_denied`.

---

### `openstation_register_file_type( $type, $args )` — Experimental (PHP function)

Registers a `OpenStation_File` subclass against the desktop file-type registry. The eleven built-in types (`post`, `attachment`, `user`, `term`, `comment`, `folder`, `bookmark`, `shortcut`, `link`, `embed`, `upload`) register through this same surface.

```php
openstation_register_file_type( 'jorvy-quote', array(
    'label' => __( 'Marvel quote', 'jorvy' ),
    'class' => 'Jorvy_Quote_File', // must extend OpenStation_File
    'sort'  => 200,
) );
```

| Arg | Type | Default | Notes |
|---|---|---|---|
| `label` | `string` | required | Picker label. |
| `class` | `string` | required | FQCN of a `OpenStation_File` subclass. |
| `script` | `string` | `''` | Optional handle for the JS-side mirror class. |
| `sort` | `int` | `100` | Sort order in pickers. |
| `capabilities` | `string[]` | `[]` | All caps must match the current user. |

Return: `true` on success, `WP_Error` otherwise. Error codes: `openstation_missing_id`, `openstation_missing_label`, `openstation_invalid_class`, `openstation_capability_denied`.

---

### `openstation_command_script_registered` — Stable

Fires after `openstation_register_command_script()` stores a command-palette script handle. Also fires when `openstation_register_command()` implicitly registers its `script` argument (it routes through `openstation_register_command_script()`).

```php
do_action( 'openstation_command_script_registered', string $handle );
```

### `openstation_command_registered` — Stable

Fires after `openstation_register_command()` successfully stores a command's metadata. Does not fire on `WP_Error`.

```php
do_action( 'openstation_command_registered', string $slug, array $entry );
```

### `openstation_register_command_script( $handle )` — Stable (PHP function)

Declares a WP-registered script handle as a command-palette provider. The shell injects the resolved URL on plugin activation so `wp.os.registerCommand()` calls made by the plugin's JS appear in the palette **without a page reload**. Primary (minimum-ceremony) opt-in — plugin authors keep command definitions in TypeScript and only touch PHP to declare the handle.

```php
add_action( 'admin_enqueue_scripts', function () {
    wp_register_script(
        'home-assistant-commands',
        plugins_url( 'js/commands.js', __FILE__ ),
        array( 'openstation' ),
        '1.0.0',
        true
    );
    wp_enqueue_script( 'home-assistant-commands' );
} );
openstation_register_command_script( 'home-assistant-commands' );
```

For live *unregistration* on deactivation, the plugin's JS should set `owner: 'home-assistant-commands'` on each `registerCommand` call — see `docs/javascript-reference.md`. Untagged commands stay until the next page reload.

### `openstation_register_command( $args )` — Stable (PHP function)

Optional companion that also declares command metadata server-side. Advisory today — reserved for future pre-registration shims (showing a greyed-out command before the plugin's JS loads). Implicitly registers `$args['script']` in the command-script registry when `script` is provided (routing through `openstation_register_command_script()`, so `openstation_command_script_registered` fires on this path too).

```php
openstation_register_command( array(
    'slug'        => 'ha-lights',
    'label'       => __( 'Home Assistant: Lights', 'home-assistant' ),
    'description' => __( 'Toggle smart lights from the palette.', 'home-assistant' ),
    'icon'        => 'dashicons-lightbulb',
    'hint'        => '[room]',
    'script'      => 'home-assistant-commands',
) );
```

**No `ai_callable` PHP-side flag — by design.** The [`aiCallable`](./javascript-reference.md#wpdesktopaiask-query-opts---experimental) opt-in lives on the JS-side `registerCommand` call only, because `wp.os.ai.ask()` harvests from the client registry (not server metadata). To gate further per-user once a command has opted in, use the `openstation_ai_command_allowed` filter below.

---

### `openstation_titlebar_button_script_registered` — Experimental

Fires after `openstation_register_titlebar_button_script()` stores a title-bar button script handle.

```php
do_action( 'openstation_titlebar_button_script_registered', string $handle );
```

### `openstation_register_titlebar_button_script( $handle )` — Experimental (PHP function)

Declares a WP-registered script handle as a title-bar button provider. The shell injects the resolved URL on plugin activation so `wp.os.registerTitleBarButton()` calls made by the plugin's JS render in matching window title bars **without a page reload**.

```php
add_action( 'admin_enqueue_scripts', function () {
    wp_register_script(
        'my-plugin-titlebar',
        plugins_url( 'js/titlebar.js', __FILE__ ),
        array( 'openstation' ),
        '1.0.0',
        true
    );
    wp_enqueue_script( 'my-plugin-titlebar' );
} );
openstation_register_titlebar_button_script( 'my-plugin-titlebar' );
```

For live unregistration on deactivation, set `owner: 'my-plugin-titlebar'` on each `registerTitleBarButton` call. Untagged buttons survive past deactivation until the next page reload — graceful backwards-compat.

---

### `openstation_window_action_script_registered` — Experimental

Fires after `openstation_register_window_action_script()` stores a window-action script handle.

```php
do_action( 'openstation_window_action_script_registered', string $handle );
```

### `openstation_register_window_action_script( $handle )` — Experimental (PHP function)

Declares a WP-registered script handle as a provider of rows in every window's ⋯ actions menu. The shell injects the resolved URL on plugin activation so [`wp.os.registerWindowAction()`](./javascript-reference.md#wposregisterwindowaction--experimental) calls made by the plugin's JS land **without a page reload** — the row is in the next ⋯ menu that opens, and a menu that happens to be open already repaints in place.

```php
add_action( 'admin_enqueue_scripts', function () {
    wp_register_script(
        'my-plugin-window-actions',
        plugins_url( 'js/window-actions.js', __FILE__ ),
        array( 'openstation' ),
        '1.0.0',
        true
    );
    wp_enqueue_script( 'my-plugin-window-actions' );
} );
openstation_register_window_action_script( 'my-plugin-window-actions' );
```

For live unregistration on deactivation, set `owner: 'my-plugin-window-actions'` on each `registerWindowAction` call. Untagged actions survive past deactivation until the next page reload — graceful backwards-compat.

---

### `openstation_unfocus_effect_script_registered` — Experimental

Fires after `openstation_register_unfocus_effect_script()` stores an unfocus-effect script handle.

```php
do_action( 'openstation_unfocus_effect_script_registered', string $handle );
```

### `openstation_register_unfocus_effect_script( $handle )` — Experimental (PHP function)

Declares a WP-registered script handle as an unfocused-window-effect provider. The shell injects the resolved URL on plugin activation so `wp.os.registerUnfocusEffect()` calls made by the plugin's JS surface in **OpenStation Preferences → Effects** (and apply to unfocused windows) **without a page reload**.

```php
add_action( 'admin_enqueue_scripts', function () {
    wp_register_script(
        'my-plugin-effects',
        plugins_url( 'js/effects.js', __FILE__ ),
        array( 'openstation' ),
        '1.0.0',
        true
    );
    wp_enqueue_script( 'my-plugin-effects' );
} );
openstation_register_unfocus_effect_script( 'my-plugin-effects' );
```

For live unregistration on deactivation, set `owner: 'my-plugin-effects'` on each `registerUnfocusEffect` call. Untagged effects survive past deactivation until the next page reload — graceful backwards-compat.

The built-in effects (`darken`, `frost`, `grayscale`) are registered through the same JS hook (`wp.os.registerUnfocusEffect`) — there is no PHP for them, since they are pure CSS shipped with the plugin.

---

### `openstation_window_content_identity` — Experimental

Filters the content identity the chromeless bridge announces for the current admin screen — the "which object does this page show" record behind [window links](./examples/window-links.md) (visual ties between related windows). Runs inside the iframe's `admin_footer`, in real admin context, so relations the URL can't answer (comment → parent post) resolve here.

```php
apply_filters(
    'openstation_window_content_identity',
    array|null $identity,   // null when the screen shows no single object
    WP_Screen|null $screen
);
```

`$identity` shape (mirrors the JS `WindowContentRef`): `type` (lowercase object-type slug; namespace yours `vendor/order`), `id` (int|string), optional `label`, optional `root => array( 'type', 'id' )`, optional `links => array( array( 'type', 'id', 'rel'? ), … )`. A ref **without** `root` is itself a root (the post a comment window points back to); a ref **with** `root` joins that root's relation group as a child (an edge pointing at the root — the built-in renderer marks the target end with its larger endpoint dot). `links` declare outbound ties: the default (`rel` omitted) is a `reference` — an edge FROM this window TO the linked object ("my content points at that"); `rel => 'child'` reverses it — the linked object BELONGS TO this content (a post's embedded media), drawn exactly like a root tie. Mutual references merge into one bidirectional edge. One reading everywhere: **the edge points at what its source belongs to or refers to** — relational structure, never navigation history.

Built-in detection covers `post.php` (post/page/CPT edit → root, with `links` extracted from the content's internal hyperlinks, its embedded media — `wp-image-{id}`, which catches inserted-but-unattached images — its featured image, and its assigned public-taxonomy terms as `term/{taxonomy}` refs), attachment edit — both the classic `post.php` screen and the `upload.php?item=N` Media Library grid detail — (`media`, rooted at `post_parent` when attached), `comment.php` (`comment`, rooted at the parent post), `edit-comments.php?p=N` — the per-post filtered comments list the Related menu opens — (`comments`, rooted at the post; the unfiltered list stays identity-less;), `term.php` (`term/{taxonomy}` → root, which assigned posts reference), and `user-edit.php` / `profile.php` (`user` → root, gated on `edit_user` — a person is what a post's author and an order's customer both point at). Use this filter to add identities for your own admin screens, or return `null` to suppress detection:

```php
add_filter( 'openstation_window_content_identity', function ( $identity, $screen ) {
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

After this filter resolves, the builder attaches a `related` key — the navigation targets behind the title bar's "Related" button — via the `openstation_window_related_entities` filter below. Identities may ship their own `related` array; it is folded into that pass and sanitized with everything else.

Post-editor identities also carry a `previewUrl` key — the front-end preview link behind the title bar's "Preview" (eye) button, built by `openstation_window_preview_url()` **before** this filter runs (so you can inspect or strip it here). The client engine only accepts same-origin `previewUrl` values.

---

### `openstation_window_related_entities` — Experimental

Filters the related-entity navigation items announced alongside the content identity — the entries behind the window title bar's **"Related" button** (a dropdown listing the content's comments, terms, media, linked posts, …; picking one opens it as its own desktop window). Runs in the same real-admin-context pass as `openstation_window_content_identity`, **after** that filter and **only when an identity resolved** — so an identity you inject for a custom screen receives the related pass too, and identity-less screens (list tables, dashboards) never do. It also runs on the `GET /desktop-mode/v1/content-identity` REST recompute the block editor's save-watcher triggers (so the menu refreshes after every save without a reload) — in that context `$screen` is `null`; don't assume a `WP_Screen`.

```php
apply_filters(
    'openstation_window_related_entities',
    array $related,         // built-in items; empty for non-post screens
    array $identity,        // the resolved (already filtered) content identity
    WP_Screen|null $screen
);
```

Item shape (mirrors the JS `RelatedEntityItem`):

```php
array(
    'id'         => 'comments',                 // unique in the list; namespace yours 'vendor/sub-id'
    'group'      => 'comments',                 // menu section key; built-ins: 'comments', 'terms/{taxonomy}', 'media'
    'groupLabel' => __( 'Comments' ),           // optional translated section header
    'label'      => __( 'Comments' ),           // translated item label
    'icon'       => 'dashicons-admin-comments', // optional Dashicons class
    'url'        => admin_url( 'edit-comments.php?p=123' ), // admin URL the item opens
    'count'      => 4,                          // optional count suffix ("Comments (4)")
)
```

Built-in items cover **posts and pages only**: Comments (`edit-comments.php?p={id}`, only when the post type supports comments and at least one approved-or-pending comment exists; the count is the same approved + awaiting-moderation total the opened screen lists), one item per assigned public-taxonomy term (`term.php?taxonomy={tax}&tag_ID={id}`, grouped per taxonomy, budgeted at 32 terms across taxonomies), one item per associated attachment — featured image, `post_parent`-attached uploads, `wp-image-{id}` embeds — deep-linking the Media Library detail (`upload.php?item={id}`, capped at 20), and one **Linked posts** item per internal hyperlink in the content that resolves to another post on this site (group `links`, opening the target's editor, capped at 10; external and cross-site hrefs don't resolve to a post id and are excluded). The client engine hard-caps the final list at **64 items** (built-ins never reach it; filter-added floods are truncated silently). Built-ins attach **only while the filtered identity still refers to the detected post** — an identity filter that rewrites a post's identity to a different `type`/`id` (a gated post remapped to a minimal ref) suppresses them automatically, so nothing about the underlying post leaks through the menu. Other screens contribute via this filter:

```php
add_filter( 'openstation_window_related_entities', function ( $related, $identity, $screen ) {
    if ( 'acme/order' === $identity['type'] ) {
        $related[] = array(
            'id'         => 'acme/customer-' . acme_order_customer( $identity['id'] ),
            'group'      => 'acme/customers',
            'groupLabel' => __( 'Customer', 'acme' ),
            'label'      => acme_customer_name( $identity['id'] ),
            'icon'       => 'dashicons-businessperson',
            'url'        => admin_url( 'admin.php?page=acme-customer&c=' . acme_order_customer( $identity['id'] ) ),
        );
    }
    return $related;
}, 10, 3 );
```

Malformed entries (missing/empty `id`, `group`, `label`, or `url`) are dropped before the payload is announced, and unknown fields are stripped — one bad entry can't invalidate the whole identity client-side. The client-side counterpart is the `os.related-entities.items` JS filter (see [javascript-reference](./javascript-reference.md)); a recipe lives in [`docs/examples/related-entities.md`](./examples/related-entities.md).

---

### `openstation_window_preview_url` — Experimental

Filters the front-end preview URL attached to a post-editor content identity as `previewUrl` — the target of the window title bar's **"Preview" (eye) button** (click it on a post/page/CPT editor window and the shell autosaves the editor, snaps it to the left half, and opens this URL as a companion window snapped to the right half; the companion tracks typing — debounced autosave + reload — and refreshes on every save). On the unsaved `post-new.php` screen the eye renders disabled until the first save. Runs in the same pass as `openstation_window_content_identity`, **before** that filter, on both the page-render build and the `GET /desktop-mode/v1/content-identity` REST recompute the block editor's save-watcher triggers — so a long-lived editor window always holds a fresh nonce.

```php
apply_filters(
    'openstation_window_preview_url',
    string $preview_url,   // '' when no preview applies
    WP_Post $post
);
```

The unfiltered value is `get_preview_post_link( $post, array( 'preview_id' => $post->ID, 'preview_nonce' => wp_create_nonce( 'post_preview_' . $post->ID ) ) )` — the same arguments core's own `post_preview()` passes, so `_set_preview()` swaps the newest autosave revision into the front-end render. It is `''` (and the eye button hidden) for attachments, non-viewable post types (`is_post_type_viewable()` false), and users lacking `edit_post` for the post. Return `''` to suppress the preview button, or rewrite the URL:

```php
// Point previews at a headless front end.
add_filter( 'openstation_window_preview_url', function ( $url, $post ) {
    if ( '' === $url ) {
        return $url;
    }
    // NOTE: the shell only accepts SAME-ORIGIN preview URLs — a
    // cross-origin rewrite hides the button. Proxy through your own
    // origin if the preview renders elsewhere.
    return home_url( '/preview-proxy/' . $post->ID . '/' );
}, 10, 2 );
```

The JS-side surface (pairing lifecycle hooks, the companion `WindowConfig` filter) is documented in [javascript-reference](./javascript-reference.md) under "The Preview (eye) title-bar button"; the autosave bridge round-trip in [bridge-protocol](./bridge-protocol.md).

---

### `openstation_window_link_renderer_script_registered` — Experimental

Fires after `openstation_register_window_link_renderer_script()` stores a window-link renderer script handle.

```php
do_action( 'openstation_window_link_renderer_script_registered', string $handle );
```

### `openstation_register_window_link_renderer_script( $handle )` — Experimental (PHP function)

Declares a WP-registered script handle as a window-link renderer provider. The shell injects the resolved URL on plugin activation so `wp.os.registerWindowLinkRenderer()` calls made by the plugin's JS surface in **OpenStation Preferences → Windows → Window links** **without a page reload**.

```php
add_action( 'admin_enqueue_scripts', function () {
    wp_register_script(
        'my-plugin-link-renderer',
        plugins_url( 'js/link-renderer.js', __FILE__ ),
        array( 'openstation' ),
        '1.0.0',
        true
    );
    wp_enqueue_script( 'my-plugin-link-renderer' );
} );
openstation_register_window_link_renderer_script( 'my-plugin-link-renderer' );
```

For live unregistration on deactivation, set `owner: 'my-plugin-link-renderer'` on each `registerWindowLinkRenderer` call. Untagged renderers survive past deactivation until the next page reload; should the *active* renderer depart, the render host falls back to the built-in `svg-splines`.

The built-in `svg-splines` renderer is registered through the same JS hook — there is no PHP for it.

---

### `openstation_settings_tab_script_registered` — Stable

Fires after `openstation_register_settings_tab_script()` stores an OpenStation Preferences tab script handle. Also fires when `openstation_register_settings_tab()` implicitly registers its `script` argument (it routes through `openstation_register_settings_tab_script()`).

```php
do_action( 'openstation_settings_tab_script_registered', string $handle );
```

### `openstation_settings_tab_registered` — Stable

Fires after `openstation_register_settings_tab()` successfully stores a tab's metadata. Does not fire on `WP_Error`.

```php
do_action( 'openstation_settings_tab_registered', string $id, array $entry );
```

### `openstation_register_settings_tab_script( $handle )` — Stable *(PHP function)*

Declares a WP-registered script handle as an OpenStation Preferences tab provider. The shell injects the resolved URL on plugin activation so `wp.os.registerSettingsTab()` calls made by the plugin's JS appear in the OpenStation Preferences window **without a page reload**. Primary (minimum-ceremony) opt-in — plugin authors keep tab definitions in TypeScript and only touch PHP to declare the handle.

```php
add_action( 'admin_enqueue_scripts', function () {
    wp_register_script(
        'my-plugin-settings',
        plugins_url( 'js/settings.js', __FILE__ ),
        array( 'openstation' ),
        '1.0.0',
        true
    );
    wp_enqueue_script( 'my-plugin-settings' );
} );
openstation_register_settings_tab_script( 'my-plugin-settings' );
```

For live *unregistration* on deactivation, either:
- set `owner: 'my-plugin-settings'` on the JS `registerSettingsTab()` call, OR
- declare the tab with `openstation_register_settings_tab()` below (the `script` arg ties the id to the handle server-side).

Tabs using neither mechanism stay until the next page reload.

### `openstation_register_settings_tab( $args )` — Stable *(PHP function)*

Optional companion that declares a settings tab server-side. Primary benefit: enables live-unregistration on plugin deactivation without every `registerSettingsTab()` call having to set `owner`. Implicitly registers `$args['script']` in the settings-tab script registry when `script` is provided (routing through `openstation_register_settings_tab_script()`, so `openstation_settings_tab_script_registered` fires on this path too).

```php
openstation_register_settings_tab( array(
    'id'         => 'my-plugin',
    'label'      => __( 'My Plugin', 'my-plugin' ),
    'capability' => 'manage_options', // optional — admin-only when set to exactly this
    'order'      => 50,               // optional — default 100 (after built-ins)
    'script'     => 'my-plugin-settings',
) );
```

**Built-in tab orders** (for reference when picking `order`):
- `appearance` = 10
- `themes` = 12
- `windows` = 18
- `navigation` = 22
- `features` = 30
- `help` = 40
- `about` = pinned last
- Third-party default = 100 (appended after built-ins)

**Capability gating today**: the shell collapses `capability` to a simple admin-vs-everyone distinction. `'manage_options'` means admin-only; any other value (including empty) means visible to everyone. Widening to arbitrary capabilities is a future expansion.

---

### `openstation_dock_rail_renderer_script_registered` — Stable

Fires after `openstation_register_dock_rail_renderer_script()` stores a dock rail renderer script handle.

```php
do_action( 'openstation_dock_rail_renderer_script_registered', string $handle );
```

---

### `openstation_register_dock_rail_renderer_script( $handle )` — Stable *(PHP function)*

Declare a WP-registered script handle as a dock rail renderer provider. The shell injects the resolved URL on plugin activation so `wp.os.registerDockRailRenderer()` calls made by the plugin's JS surface in OpenStation Preferences → Dock style **without a page reload**. Primary (minimum-ceremony) opt-in — plugin authors keep renderer definitions in TypeScript and only touch PHP to declare the handle.

```php
add_action( 'admin_enqueue_scripts', function () {
    wp_register_script(
        'my-plugin-rail',
        plugins_url( 'js/rail.js', __FILE__ ),
        array( 'openstation' ),
        '1.0.0',
        true
    );
    wp_enqueue_script( 'my-plugin-rail' );
} );
openstation_register_dock_rail_renderer_script( 'my-plugin-rail' );
```

The plugin's JS calls `wp.os.registerDockRailRenderer({ id, label, owner: 'my-plugin-rail', mount })` — the matching `owner` enables live unregistration when the plugin deactivates. Renderers without `owner` stay until the next page reload (graceful backwards-compat).

See [`docs/examples/dock-rail-renderer.md`](./examples/dock-rail-renderer.md) for the full plugin author walk-through.

---

### `openstation_window_tab_registered` — Stable

Fires after `openstation_register_window_tab()` successfully attaches a tab to a native window. Useful for companion plugins that need to follow up (e.g. register a help overlay only when a Stats tab actually exists).

```php
do_action( 'openstation_window_tab_registered', string $window_id, string $value, array $entry );
```

---

### `openstation_oauth_relay_registered` — Stable

Fires after `openstation_register_oauth_relay()` stores a relay entry. `$entry` is the stored registry entry with `client_secret` redacted, so observability logs can't leak credentials. See [`examples/oauth-relay.md`](./examples/oauth-relay.md) for the full relay walk-through.

```php
do_action( 'openstation_oauth_relay_registered', string $service, array $entry );
```

---

### `openstation_oauth_relay_connected` — Stable

Fires after a successful OAuth round-trip — once the relay's `on_success` callback has persisted the tokens. Use it to refresh badges, re-render dock items, or surface a "connected" toast in sibling windows via the activity bus. See [`examples/oauth-relay.md`](./examples/oauth-relay.md).

```php
do_action( 'openstation_oauth_relay_connected', string $service, int $user_id );
```

---

### `openstation_chromeless_after` — Stable
Fires in the `admin_footer` of chromeless iframe requests. Receives the current admin page's `$hook_suffix`.

```php
do_action( 'openstation_chromeless_after', $hook_suffix );
```

**Example — emit a ready ping from the iframe:**

```php
add_action( 'openstation_chromeless_after', function ( $hook_suffix ) {
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

### `openstation_prepare_window` — Planned
Will fire once per window the shell is about to construct (both on fresh open and session restore). Planned signature:

```php
do_action( 'openstation_prepare_window', string $page, array $args );
```

---

## Filters

### Station Home card filters — Experimental

```php
apply_filters( 'openstation_station_home_cards', array $cards, int $user_id ): array;
apply_filters( 'openstation_station_home_card_data', array $data, string $id, array $entry, int $user_id ): array;
```

`openstation_station_home_cards` filters the registration map before capability-safe metadata becomes the user's picker. Add, remove, reorder, or replace entries using the same shape accepted by `openstation_register_station_home_card()`. `openstation_station_home_card_data` filters an enabled card's callback result immediately before its values are sanitized for the REST snapshot.

---

### `openstation_site_title` — Experimental

Filters the site title used to label desktop objects — WP Explorer's breadcrumb root, the Corkboard's site label, and every "Open in &lt;site&gt;" action that hands off to them.

The desktop is meant to contain objects, not a mention of the OS you're already standing in, so the *root folder* holding a site's content is named after the site rather than after WordPress. (The app that browses it is WP Explorer, which is a fixed name this filter does not reach.) `openstation_site_title()` reads `get_bloginfo( 'name' )`, decodes its HTML entities (titles land in `title=` attributes and JS text nodes), and falls back to `WordPress` when the site has no name set.

```php
apply_filters( 'openstation_site_title', string $title ): string
```

A filtered value that isn't a non-empty string is discarded and the unfiltered title is used.

**Example — label the root folder after a network-wide brand instead of `blogname`:**

```php
add_filter( 'openstation_site_title', function ( $title ) {
	return get_network_option( null, 'site_name', $title );
} );
```

---

### `openstation_load_admin_modules` — Experimental

Filters whether the admin-rendering module set (shell renderer, asset enqueues, chromeless bridge, admin notices, migrations, the `wp_ajax_save-openstation` handler) loads on the current request. By default it loads for admin (including admin-ajax), REST, cron, and WP-CLI requests, and is skipped on pure frontend page views — every hook those modules register only fires inside wp-admin, so frontend requests save the parse + hook-registration cost.

Runs at plugin-file load time, **before** any WordPress hook fires — so you cannot hook it from a theme or a plugin that loads after OpenStation; use an mu-plugin or a plugin that loads earlier if you need to force the full load.

```php
apply_filters( 'openstation_load_admin_modules', bool $needs );
```

**Example — force the full module set on frontend requests** (e.g. a frontend integration that internally dispatches `desktop-mode/v1` REST routes via `rest_do_request()`):

```php
add_filter( 'openstation_load_admin_modules', '__return_true' );
```

---

### `openstation_file_types` — Experimental

Filters the file-type registry used by the Files-on-the-Desktop system. Plugins can hide built-ins or swap a class out at runtime. Keyed by type slug; the `class` field of an entry must remain a `OpenStation_File` subclass FQCN.

```php
apply_filters( 'openstation_file_types', array $registry );
```

---

### `openstation_file_serialize` — Experimental

Last-mile mutation point for the JS-bound shape produced by `OpenStation_File::serialize()`. Plugins use this to attach badges, override labels, or splice in custom render hints without subclassing.

```php
apply_filters( 'openstation_file_serialize', array $shape, OpenStation_File $file );
```

**Example — attach a "draft" badge to draft posts:**

```php
add_filter( 'openstation_file_serialize', function ( $shape, $file ) {
    if ( $file instanceof OpenStation_Post_File && 'draft' === ( $shape['status'] ?? '' ) ) {
        $shape['badge'] = __( 'Draft', 'my-plugin' );
    }
    return $shape;
}, 10, 2 );
```

---

### `openstation_file_openers` — Experimental

Filters the file-opener registry. Plugins can hide built-ins, swap labels, or rearrange sort order. Keyed by opener id.

```php
apply_filters( 'openstation_file_openers', array $registry );
```

---

### `openstation_resolve_file_opener` — Experimental

Override the resolution chain at `openstation_resolve_file_opener_id()` time. Useful for forced role-based associations.

```php
apply_filters( 'openstation_resolve_file_opener', string $opener_id, string $type, int $user_id );
```

**Example — force the Classic Editor for a specific role:**

```php
add_filter( 'openstation_resolve_file_opener', function ( $opener_id, $type, $user_id ) {
    if ( 'post' === $type && user_can( $user_id, 'editor' ) ) {
        return 'classic-editor';
    }
    return $opener_id;
}, 10, 3 );
```

---

### `openstation_resolve_favicon` — Stable

Last-mile filter on the favicon data URI returned by `openstation_resolve_favicon()`. The resolver runs inline during `POST /placements` for `link`-type placements: it fetches the page via `wp_safe_remote_get`, walks `<link rel="icon|shortcut icon|apple-touch-icon">`, falls back to `/favicon.ico`, and base64-encodes the bytes into a `data:image/<subtype>;base64,…` URI for the placement's `meta.iconUrl`. The filter lets plugins short-circuit the network round-trips (return a synthetic data URI), force-skip caching (return `null`), or post-process whatever the resolver produced.

```php
apply_filters( 'openstation_resolve_favicon', ?string $data_uri, string $page_url );
```

**Example — short-circuit with a cached value from a transient:**

```php
add_filter( 'openstation_resolve_favicon', function ( $data_uri, $page_url ) {
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

### `openstation_mode_enabled` — Stable

Gates whether OpenStation can be activated (or stay active) for a given user. The central helper `openstation_is_enabled()` consults this filter after the user-meta check, so render-time gates (chromeless detection, payload generation, REST permission callbacks, the admin-bar toggle, the portal entry, the AJAX save endpoint) all honor a `false` return.

```php
apply_filters( 'openstation_mode_enabled', bool $enabled, int $user_id );
```

**Example — disable for contributors:**

```php
add_filter( 'openstation_mode_enabled', function ( $enabled, $user_id ) {
    if ( user_can( $user_id, 'contributor' ) ) {
        return false;
    }
    return $enabled;
}, 10, 2 );
```

A `false` return has two effects:

1. The AJAX save endpoint refuses to flip the user meta to `'1'` (it returns `openstation_disabled`).
2. `openstation_is_enabled()` returns `false` for that user even when their existing meta is `'1'`. Every render-time gate that consults the helper (and there are many — see `includes/render.php`, `includes/components.php`, `includes/recycle-bin/rest.php`, `includes/pwa.php`, `includes/presence.php`, `includes/admin-bar.php`) treats the user as not-enabled.

---

### `openstation_show_welcome_dialog` — Stable

Decides whether the first-run welcome dialog (rendered in classic `/wp-admin` on `admin_footer`, never inside the desktop shell or a chromeless iframe) should display for the current user on the current request.

```php
apply_filters( 'openstation_show_welcome_dialog', bool $show, int $user_id );
```

The filter only fires after OpenStation has already verified that:

1. The request is an admin page (`is_admin()`).
2. The user is logged in and can `read`.
3. The request is NOT chromeless.
4. The user has not yet dismissed the `activation-welcome` intro (stored in the `desktop_mode_seen_intros` user meta — the same surface the "Reset what's-new dialogs" button in OpenStation Preferences → Features wipes).
5. OpenStation is not already enabled for the user — this is a "switch to OpenStation" promo, so it has nothing to say once the user is in the shell.

Dismissal persists through the same `POST /desktop-mode/v1/intros/seen` route the in-shell announcements use, with one wrinkle: because the dialog only appears while OpenStation is **disabled**, that route makes a scoped exception for the `activation-welcome` slug and accepts it from any logged-in `read`-capable account (every other slug still requires OpenStation enabled). Without it the dismissal would `403` and the dialog would re-appear on every classic-admin page load.

Return `false` to suppress the dialog — useful for managed-host onboarding flows that ship their own welcome UX.

---

### `openstation_shell_config` — Stable

The JS configuration blob injected as `window.openStationConfig`. Powers the window manager, dock, and session restore. Filter this to inject custom payloads the shell can read at boot.

```php
apply_filters( 'openstation_shell_config', array $config );
```

Core keys (non-exhaustive — the full blob carries many more keys, e.g. `colorScheme`, `pluginVersion`, the `server*` registry-sync arrays, lazy-bundle URLs, and feature payloads; the authoritative shape is the array passed to `apply_filters( 'openstation_shell_config', … )` in `includes/render/assets.php`. Do not treat absence from this list as unavailability):

```php
array(
    'currentPage'      => string,   // the admin URL the shell opens first: the shell screen's validated `target`, else the session's focused window, the default window, the Dashboard
    'currentTitle'     => string,   // the dock entry's title for that page ('' when no entry matches; the iframe reports its own title once it lands)
    'currentIcon'      => string,   // dashicons-* class of that dock entry
    'adminUrl'         => string,   // admin_url()
    'homeUrl'          => string,   // home_url() — the System tile's "View site"
    'logoutUrl'        => string,   // wp_logout_url(), nonced; the shell cannot build this itself
    'portalUrl'        => string,   // openstation_portal_url()
    'sessionUrl'       => string,   // REST session URL
    'restUrl'          => string,   // REST API root from rest_url(); compose with joinRestUrl() for pretty/plain permalink safety
    'restNonce'        => string,   // X-WP-Nonce
    'aboutFeedUrl'     => string,   // nonced admin-AJAX URL for the lazy About journal feed
    'dockItems'        => array[],  // see openstation_dock_items
    'session'          => array,    // prior session snapshot or empty
    'fromPortal'       => bool,     // request was forwarded by the /openstation/ portal
    'fromPortalIntent' => bool,     // portal forward resolved from a user-supplied `target` URL — the user expressed navigation intent toward `currentPage`, not just a bare `/openstation/` visit.
    'soloWindow'       => string,   // window id when the shell was asked to paint exactly one window; '' otherwise
)
```

**Example — add a flag for your feature:**

```php
add_filter( 'openstation_shell_config', function ( $config ) {
    $config['myFeature'] = array(
        'enabled'  => (bool) get_option( 'my_ext_shell_feature' ),
        'endpoint' => rest_url( 'my-ext/v1/data' ),
    );
    return $config;
} );
```

Read it from JS:

```javascript
const cfg = window.openStationConfig;
if ( cfg.myFeature && cfg.myFeature.enabled ) { /* ... */ }
```

---

### `openstation_dock_items` — Stable

The final list of dock items, as an array of item arrays. Return a modified list — add, remove, reorder.

```php
apply_filters( 'openstation_dock_items', array $items );
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

Items built from the admin menu also carry `selfLabel`, `multi`, `placement`, `isCore`, `pluginFile`, and `pluginName` keys — see the `openstation_dock_item_multi` and `openstation_dock_placement` filters below.

**`submenu` excludes the menu's own page.** WordPress auto-prepends a self-link to every parent menu (`All Posts` → `edit.php`, the same URL as the parent), and the builder strips it so `count( $submenu )` reliably means "how many distinct child pages" — the in-window tab strip would otherwise grow a duplicate first tab, and the right-click popover keys its suppression off an empty list. The stripped entry's label survives on **`selfLabel`** (`''` when the menu had none), so a surface that *lists* a menu's pages can put the main page back where wp-admin has it. The constellation flyout does exactly that, pointing the row at the item's `url`.

**Off-site menu entries never reach the dock.** Nothing on another host can load in a window, so a menu whose URL points off-site is dropped rather than turned into a tile that can only escape to a browser tab. The one exception is a child of a menu a regular plugin registered (`pluginFile` is non-null) whose own URL stays on-site: those keep their row and carry `'offSite' => true`, which the constellation marks as leaving the site and the in-window tab strip skips. The classifier is [`openstation_menu_item_is_external`](#openstation_menu_item_is_external--stable).

**A rescued menu takes on the identity of the slug it adopted.** When a menu's own slug points off-site and a surviving child stands in for it, `multi`, `placement`, `isCore`, `pluginFile` and the `$menu_slug` passed to `openstation_dock_item` are all derived from that child's slug, not from the off-site one. Otherwise a rescued Plugins tile reports as a plugin menu owned by whoever registered the replacement.

**Rows a host hid stay hidden, unless dropping them would lose the page.** A `$menu` / `$submenu` row carrying the `hide-if-js` class is out of the classic sidebar and out of the dock too. WordPress.com is why the rule has an exception: rather than repoint a Core entry at wordpress.com, Jetpack marks the wp-admin original `hide-if-js` and appends a Calypso duplicate beside it. When the duplicate is dropped as off-site, the original takes its place in the list — so Appearance → Themes, Plugins → Add Plugin and Users → All Users open the wp-admin screens Core registered.

**Example — add a virtual dock item:**

```php
add_filter( 'openstation_dock_items', function ( $items ) {
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
add_filter( 'openstation_dock_items', function ( $items ) {
    return array_values( array_filter( $items, fn( $i ) => 'edit-comments.php' !== $i['id'] ) );
} );
```

---

### `openstation_dock_item` — Stable

Fires for each item as the dock is assembled, with the source admin-menu slug for context.

```php
apply_filters( 'openstation_dock_item', array $item, string $menu_slug );
```

**Example — rewrite the Posts icon:**

```php
add_filter( 'openstation_dock_item', function ( $item, $slug ) {
    if ( 'edit.php' === $slug ) {
        $item['icon'] = 'dashicons-welcome-write-blog';
    }
    return $item;
}, 10, 2 );
```

---

### `openstation_dock_item_multi` — Stable

Controls whether a dock item supports multiple simultaneous windows. Multi-capable pages expose a hover-peek popover on the dock icon (one card per open instance + a Ghost Card that spawns a new instance) and an "Open another" action in the window's title-bar menu; singletons always focus the existing window when re-opened.

Built-in defaults: `edit.php`, `edit-tags.php`, `upload.php`, `users.php`, and `edit-comments.php` are multi; everything else is singleton. The base filename is matched against the list, so every CPT (`edit.php?post_type=page`) and every taxonomy inherits the same rule as its parent admin file.

```php
apply_filters( 'openstation_dock_item_multi', bool $multi, string $menu_slug );
```

**Example — let a custom plugin page open multiple windows:**

```php
add_filter( 'openstation_dock_item_multi', function ( $multi, $slug ) {
    if ( 'my-plugin-entities' === $slug ) {
        return true;
    }
    return $multi;
}, 10, 2 );
```

**Example — force Users into singleton mode:**

```php
add_filter( 'openstation_dock_item_multi', function ( $multi, $slug ) {
    return 'users.php' === $slug ? false : $multi;
}, 10, 2 );
```

---

### `openstation_dock_placement` — Stable

Chooses whether a menu item appears in the dock. Two values are recognized:

- `'dock'` (default) — render the item on the unified dock.
- `'hidden'` — suppress the item entirely. The underlying admin menu entry still exists server-side; this only prevents rendering on the dock. Plugins that don't want to claim chrome real estate (utility tools, background services, plugins that render only into existing surfaces) set this.

```php
apply_filters( 'openstation_dock_placement', string $placement, string $menu_slug );
```

Return values other than `'dock'` or `'hidden'` coerce to `'dock'` — a defensive guard so a misbehaving filter (returning `null`, a bool, etc.) can't corrupt the rail.

**Example — hide a plugin from the shell entirely (from inside that plugin's own PHP):**

```php
add_filter( 'openstation_dock_placement', function ( $placement, $slug ) {
    if ( 'my-background-tool' === $slug ) {
        return 'hidden';
    }
    return $placement;
}, 10, 2 );
```

Ordering within the dock is set server-side: core WordPress menus (Dashboard, Posts, Media, Users, Settings, CPTs, taxonomies, …) are sorted before plugin-contributed top-level menus. To fully reorder, use `openstation_dock_items` — it receives the built list and returns a reshaped one.

The live menu-refresh path (chromeless `plugins.php` iframe postMessage, plus the hidden iframe spawned by `wp.os.refreshMenu()`) runs the same builder from real admin context, so a filter change takes effect without a full tab reload.

---

### `openstation_menu_item_is_external` — Stable

Whether a resolved admin-menu URL counts as off-site. Off-site entries are dropped from the dock payload (see [`openstation_dock_items`](#openstation_dock_items--stable) for the exception plugin menus get), because nothing on another host can load in a window.

```php
apply_filters( 'openstation_menu_item_is_external', bool $external, string $url );
```

By default a URL is off-site when its host matches neither `admin_url()`'s nor `home_url()`'s. Both count, so a site running its admin on a separate domain from its front end isn't misread.

**Example — keep a trusted sibling domain in the dock:**

```php
add_filter( 'openstation_menu_item_is_external', function ( $external, $url ) {
    if ( str_contains( $url, 'admin.internal.example.com' ) ) {
        return false;
    }
    return $external;
}, 10, 2 );
```

An entry you allow back in still has to survive the browser: a host that sends `X-Frame-Options` or a `frame-ancestors` policy refuses the iframe whatever this filter says.

---

### `openstation_arrange_menu_items` — Stable

The list of plugin-contributed items appended to the admin bar's **Arrange** submenu — the dropdown that sits next to the "Switch to…" toggle when OpenStation is active. Built-ins (Cascade, Overview, Snap to grid, Tile all windows) are always present; this filter adds to them. Only invoked when the user is viewing the desktop shell.

```php
apply_filters( 'openstation_arrange_menu_items', array $items );
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

**Click wiring:** clicking a custom item fires the JS action `os.arrange.custom-action` with payload `{ id }`. Subscribe via `wp.hooks.addAction()`:

```php
add_filter( 'openstation_arrange_menu_items', function ( $items ) {
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
    'os.arrange.custom-action',
    'my-ext/diagonal',
    function ( payload ) {
        if ( payload.id !== 'diagonal' ) {
            return;
        }
        const windows = wp.os.windowManager.getAll();
        windows.forEach( ( w, i ) => w.move( i * 40, i * 40 ) );
    }
);
```

---

### `openstation_portal_auto_enable` — Stable

When a user lands on `/openstation/` without OpenStation enabled, the portal auto-enables it for them by default. Return `false` to require an explicit toggle instead.

```php
apply_filters( 'openstation_portal_auto_enable', bool $auto_enable, int $user_id );
```

**Example:**

```php
add_filter( 'openstation_portal_auto_enable', '__return_false' );
```

---

### `openstation_admin_redirect_to_portal` — Stable

Governs the `admin_init` redirect from classic `/wp-admin/` URLs into the desktop for users with OpenStation on. Return `false` to keep the user on the classic URL even when they have the mode enabled (useful for support sessions). The page then renders as classic admin — the shell boots only from its own screen (`admin.php?page=openstation`, reached through `/openstation/`), never over another admin page. A URL carrying the frozen `desktop_mode_portal` flag is an alias for the desktop and is redirected to the shell screen before this filter runs.

```php
apply_filters( 'openstation_admin_redirect_to_portal', bool $redirect, int $user_id );
```

---

### `openstation_skip_redundant_portal_forward` — Stable

Governs whether a plain admin GET skips the `/openstation/` hop and goes straight to the shell screen. Applied only after `openstation_admin_redirect_to_portal` has allowed the redirect, and only for requests the portal would hand straight back as the shell's target — an allowlisted wp-admin file that is also the page `$pagenow` reports, carrying no query arg the portal would strip.

Default `true`. For those URLs the request is redirected once, to `admin.php?page=openstation&target=<the URL>&intent=1`; routing through the portal would spend a WordPress bootstrap to learn what is already known.

Return `false` to route through `/openstation/?target=…` anyway — the one reason to do so is a plugin that hooks `openstation_handle_portal_request` for side effects and needs it to run on every admin entry.

```php
apply_filters( 'openstation_skip_redundant_portal_forward', bool $skip, string $request_uri );
```

**Example — keep the portal hop so a portal-entry hook keeps firing:**

```php
add_filter( 'openstation_skip_redundant_portal_forward', '__return_false' );
```

---

### `openstation_shell_dequeue_handles` — Experimental

Handles to dequeue from the shell screen (`admin.php?page=openstation`, the document the desktop boots from). With no host screen under the shell, what still prints there is OpenStation's own assets, Core's every-admin-page set (`common`, jQuery, `admin-bar`, `heartbeat`, `wp-auth-check`, …) and whatever plugins enqueue on every admin page — a global nag, a tracker, a chat bubble. The framework does not guess which of those belong in the shell; the site says so through this filter.

Called once for scripts and once for styles, at `admin_enqueue_scripts` priority `PHP_INT_MAX` so every plugin has enqueued, and only on a shell boot — windows keep the chromeless trims, classic pages keep everything. Default empty. A named handle that a surviving script or style still depends on is refused with a `_doing_it_wrong()` rather than dropped, because dequeuing it would strand the dependent. Handles are dequeued, never deregistered, so anything that genuinely depends on one still resolves it.

```php
apply_filters( 'openstation_shell_dequeue_handles', string[] $handles, string $kind ); // $kind is 'script' or 'style'
```

**Example — keep a plugin's global upsell off the desktop:**

```php
add_filter( 'openstation_shell_dequeue_handles', function ( $handles, $kind ) {
    if ( 'script' === $kind ) {
        $handles[] = 'acme-upsell-nag';
    } else {
        $handles[] = 'acme-upsell-nag-css';
    }
    return $handles;
}, 10, 2 );
```

Related PHP predicates, all Stable:

- `openstation_is_shell_request()` — true when this request paints the shell: the shell screen for a user with OpenStation enabled, or a solo boot. Never inside a window or on a classic-flagged request. Gate shell-only enqueues and output on this, never on a screen id.
- `openstation_is_shell_screen_request()` — true on the shell screen whether or not the shell renders there.
- `openstation_shell_url( $target = '', $intent = false )` — the screen's URL, optionally carrying the admin URL to open first.
- `openstation_url_is_shell_screen( $url )` — whether a URL names the screen; the shell never opens itself.

See [`migration-shell-screen.md`](./migration-shell-screen.md).

---

### `openstation_accent_colors` — Stable

Extends or restricts the accent-color swatches shown in OpenStation Preferences. Applied to `--wp-admin-theme-color` on the shell's `<html>`. Each entry is `{ id: string, label: string, value: string }` — `id` is a stable slug persisted to `localStorage`, `label` is the picker tooltip, `value` is a hex color validated server-side via `sanitize_hex_color()`. Invalid entries are dropped; a filter that leaves the list empty falls back to the ten built-in swatches.

```php
apply_filters( 'openstation_accent_colors', array $colors );
```

**Example — add a brand swatch:**

```php
add_filter( 'openstation_accent_colors', function ( $colors ) {
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
add_filter( 'openstation_accent_colors', function () {
    return array(
        array( 'id' => 'corporate', 'label' => 'Corporate', 'value' => '#003366' ),
    );
} );
```

---

### `openstation_admin_bar_mode` — Stable

Overrides how the WordPress admin bar presents above the shell for the current request, regardless of the user's own **OpenStation Preferences → Appearance → Admin bar** pick. The resolved value is emitted as a `os-admin-bar-<mode>` body class on `admin_body_class`, which is what `assets/css/desktop.css` keys off.

```php
apply_filters( 'openstation_admin_bar_mode', string $mode );
```

| Mode | Behavior |
|---|---|
| `static` | The bar is pinned above the shell and the shell starts below it. Vanilla behavior. |
| `dynamic` | The bar parks off the top edge leaving a visible seam (`--os-admin-bar-peek`, `4px`), and slides back in on hover, keyboard focus, or tap. The pointer target is larger than the seam — an invisible reveal zone extends `--os-admin-bar-reveal-zone` (`16px`) below it, so the band to hit is `20px` from the top of the viewport. The shell takes the full viewport. |
| `hidden` | The bar is not rendered. The shell takes the full viewport. The default: a desktop whose navigation is consolidated into one dock has no second place for navigation to live. |

A value outside the three coerces back to `static`. The same three ids are the user-facing setting (`adminBarMode` in `wp.os.getOsSettings()`) and a [theme recommendation key](desktop-themes.md#fields).

**`hidden` removes the "Switch to Classic Admin" toggle**, so it is not the only way out of the shell — the dock's core rail always carries an **Exit OpenStation** tile hitting the same endpoint. Keep it that way if you add modes of your own.

**Example — pin the bar for anyone who can't reach the dock's exit tile:**

```php
add_filter( 'openstation_admin_bar_mode', function ( $mode ) {
    return current_user_can( 'manage_options' ) ? $mode : 'static';
} );
```

**Example — kiosk: no admin bar, ever:**

```php
add_filter( 'openstation_admin_bar_mode', function () {
    return 'hidden';
} );
```

---

### `openstation_dock_behavior` — Experimental

Overrides how the dock presents for the current request, regardless of the user's own **OpenStation Preferences → Appearance → Desktop layout → Dock behavior** pick. The resolved value is stamped as `data-os-dock-behavior` on `#os-dock` by the shell template, which is what `assets/css/dock.css` and `src/dock-behavior.ts` key off. It answers for the dock only (the single rail in Unified, the bottom dock in Split); the Split sidebar carries its own `sideDockBehavior`, synthesised and stamped client-side, and is not filtered here.

```php
apply_filters( 'openstation_dock_behavior', string $behavior );
```

| Behavior | What it does |
|---|---|
| `static` | The rail is always on screen, and the band it floats over is reserved from the [work area](javascript-reference.md#workarea--experimental) so default window placement stays clear of it. The default. |
| `dynamic` | The rail folds into a thin indicator line at its edge (`--os-dock-indicator-length` × `--os-dock-indicator-thickness`, `180px` × `5px`, in `--os-dock-indicator-bg`, the accent at 72% alpha; a theme retunes all three) and morphs back into the full rail — through the View Transitions API where the browser has it — when the pointer reaches that edge of the screen (a `20px` band, the full width or height of it). Once out it stays out while the pointer is on the rail or just above it (a band reaching twice the rail's height from the screen edge), or on an open dock flyout (the constellation, the peek cards — body-level surfaces that would otherwise retract the rail out from under the pointer), and while something on the rail has keyboard focus; the pointer leaving the browser window changes nothing. A flyout only ever **holds a rail out — it never summons a parked one**, so a menu fanned out of another rail (Split's static sidebar, say) leaves this one folded rather than rising over the panel being read. It reserves nothing: windows get the whole desktop and the rail rides over them when summoned. |

A value outside the two coerces back to `static`. The same two ids are the user-facing settings (`dockBehavior` and `sideDockBehavior` in `wp.os.getOsSettings()`).

**Example — keep the rail on screen for anyone who might not find the seam:**

```php
add_filter( 'openstation_dock_behavior', function ( $behavior ) {
    return current_user_can( 'manage_options' ) ? $behavior : 'static';
} );
```

---

### `openstation_toast_types` — Stable

Extends the toast-notification type map the shell consumes when a plugin calls `wp.os.toast( id, … )`. Each entry is `{ id, label, icon, tone }` where `tone` is one of `positive | warning | critical | neutral`. Entries with an unknown tone are dropped.

```php
apply_filters( 'openstation_toast_types', array $types );
```

**Example — register an `update-available` toast style:**

```php
add_filter( 'openstation_toast_types', function ( $types ) {
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

### `openstation_default_wallpaper` — Stable

Chooses the wallpaper slug applied on first boot for a new user (and as the fallback when a user's saved wallpaper was registered by a plugin that's since been deactivated). Return a registered wallpaper id. Output is normalised with `sanitize_key()`.

```php
apply_filters( 'openstation_default_wallpaper', string $id );
```

**Example — ship `aurora` as the brand default:**

```php
add_filter( 'openstation_default_wallpaper', fn () => 'aurora' );
```

---

### `openstation_wallpapers` — Stable

Last-chance filter over the full wallpaper registry before it ships to the shell as `config.serverWallpapers`. Each entry is the shape stored by `openstation_register_wallpaper()` (`id`, `label`, `preview`, `type`, `value`, `script`, `description`). Use this to reorder, rename, remove, or override wallpaper entries — including the built-in presets.

`description` — *Experimental.* Optional plain-text copy shown in OpenStation Preferences when the wallpaper is the active selection (a styled card under the picker grid). Sanitized with `sanitize_textarea_field()` at registration; the shell renders it as text, never HTML. When the wallpaper's JS def also sets `description`, the JS value wins — the server value is an overlay for defs that don't carry one.

Mirrors the client-side `os.wallpapers` JS filter but runs earlier, before any wallpaper reaches the browser.

```php
apply_filters( 'openstation_wallpapers', array $registry );
```

---

### `openstation_games_enabled` — Experimental

Whether the games framework is enabled site-wide. The default comes from the `games` extended option (OpenStation Preferences → Features → Extended options, admins only) — **off by default**: games are opt-in. When the resolved value is `false`, `includes/games/bootstrap.php` loads **none** of the games module — no Games window/icon, no `openstation_register_game()`, no REST routes, no Heartbeat challenge channel, no schema check — and the shell config ships `gamesEnabled: false` so the client skips the challenges channel too. For third-party plugins the disabled state looks exactly like OpenStation being inactive: guard `openstation_register_game()` calls with `function_exists()` (as [the recipe](./examples/register-game.md) already does).

The load decision is made on `plugins_loaded` (priority 5), so hook the filter from any plugin's main file — just not later than that.

```php
apply_filters( 'openstation_games_enabled', bool $enabled );
```

---

### `openstation_games` — Experimental

Last-chance filter over the full games registry before it ships to the shell as `config.serverGames` — and the same filtered view backs REST validation, so filter-added game ids can persist scores. Each entry is the shape stored by `openstation_register_game()` (`id`, `title`, `description`, `icon`, `script`, `score_columns`, `config`). Mirrors the client-side `os.games` JS filter.

```php
apply_filters( 'openstation_games', array $registry );
```

---

### `openstation_games_words_url` — Experimental

Filters the URL of the shared games dictionary asset (`assets/games/words.txt`, ~20k lowercase English words, one per line, `#` comments, sorted by length then frequency — regenerated by `bin/build-game-words.mjs`). The resolved URL reaches every game as the framework-injected `wordsUrl` key on its launch-context `config`.

Seeded games (Alphabet Soup's daily puzzle) generate identical grids worldwide only while every player resolves the same word list — swap the URL for **all** users (a translated list, a themed list), never per user.

```php
apply_filters( 'openstation_games_words_url', string $words_url );
```

---

### Games permission + tuning filters — Experimental

```php
// Who sees the Games window / icon and may use the games REST surface.
// Default: logged-in + `read`.
apply_filters( 'openstation_games_user_can_use', bool $can );

// Base REST verdict on top of the capability gate. Return `false` or a
// `WP_Error` to lock the whole surface down.
apply_filters( 'openstation_games_rest_permission', true, int $user_id );

// Veto / short-circuit for score saves — THE anti-cheat extension
// point (rate limits, plausibility checks). Return a `WP_Error` to
// reject; `null` proceeds.
apply_filters( 'openstation_game_score_pre_save', null, string $game, int $user_id, int $score, array $meta );

// Whether $challenger may challenge $recipient at $game. Return
// `false` or a `WP_Error` to block (do-not-disturb, role policy).
apply_filters( 'openstation_games_can_challenge', true, int $challenger_id, int $recipient_id, string $game );

// Veto / short-circuit for play-time increments — same contract as
// the score pre-save filter. Return a `WP_Error` to reject; `null`
// proceeds.
apply_filters( 'openstation_game_playtime_pre_record', null, string $game, int $user_id, int $seconds );

// Largest play-time increment (seconds) accepted in one request. The
// framework flushes roughly once a minute; the clamp bounds what a
// hostile client can mint per request. Default 900 (15 minutes).
apply_filters( 'openstation_games_playtime_max_increment', 900, string $game, int $user_id );

// How many days of daily play-time buckets to retain (the hub needs
// 14 for its "last two weeks" figure). Default 30.
apply_filters( 'openstation_games_playtime_history_days', 30 );

// WP_User_Query args for the opponent-picker autocomplete.
apply_filters( 'openstation_games_user_query_args', array $args, array $request_params );

// Per-tick row cap for the challenges Heartbeat channel. Default 50;
// past it the payload flags `truncated` and clients resync over REST.
apply_filters( 'openstation_games_heartbeat_max_rows', 50 );

// Registration args for the Games hub window / desktop icon.
apply_filters( 'openstation_games_window_args', array $window_args );
apply_filters( 'openstation_games_icon_args', array $icon_args );

// The Games window's template HTML. Keep the
// `data-os-games-*` hooks intact.
apply_filters( 'openstation_games_template_html', string $html );
```

**Example — hide the `sunset` preset from this site:**

```php
add_filter( 'openstation_wallpapers', function ( $registry ) {
    unset( $registry['sunset'] );
    return $registry;
} );
```

**Example — rename the `dark` preset to match a brand:**

```php
add_filter( 'openstation_wallpapers', function ( $registry ) {
    if ( isset( $registry['dark'] ) ) {
        $registry['dark']['label'] = __( 'Acme Dark', 'my-plugin' );
    }
    return $registry;
} );
```

A filter that returns a non-array value drops the list entirely (empty `serverWallpapers` in the shell config). The built-in presets register on `init` priority 5, so any filter hooking later than that sees the full built-in set in its input.

---

### `openstation_icons` — Stable

Last-chance filter over the desktop-icon registry before it ships to the shell as `config.desktopIcons`. Each entry is the shape stored by `openstation_register_icon()` (`id`, `title`, `icon`, `window`, `url`, `position`, `pinned`).

```php
apply_filters( 'openstation_icons', array $registry );
```

**Example — hide a plugin's icon for users on a specific role:**

```php
add_filter( 'openstation_icons', function ( $registry ) {
    if ( ! current_user_can( 'manage_options' ) ) {
        unset( $registry['jorvy'] );
    }
    return $registry;
} );
```

---

### `openstation_window_tabs` — Stable

Last-chance filter over the ordered tab list for a native window. Each entry is `{ value, label, template, script, is_main, position }`. Lets a late-loading plugin reorder, hide, or relabel tabs another plugin registered (or the window's own main tab).

```php
apply_filters( 'openstation_window_tabs', array $tabs, string $window_id );
```

**Example — hide the About tab on production sites:**

```php
add_filter( 'openstation_window_tabs', function ( $tabs, $window_id ) {
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

### `openstation_native_window_tab_wrap_padding` — Stable

Overrides the inline padding (in pixels) of the auto-generated tab wrapper the shell injects around a multi-tab native window. Only fires when `openstation_register_window_tab()` produces the auto-wrap (a native window with at least one additional tab); single-pane windows never see this filter. Return an integer number of pixels — the value is cast via `(int)` before being emitted as the wrapper's `padding` attribute, so CSS length strings like `'1.5rem'` will cast to `0`. Pass `0` for edge-to-edge content.

```php
apply_filters( 'openstation_native_window_tab_wrap_padding', int $padding, string $window_id );
```

**Example — zero-pad one specific window's tab panels:**

```php
add_filter( 'openstation_native_window_tab_wrap_padding', function ( $padding, $window_id ) {
    return 'my-plugin/editor' === $window_id ? 0 : $padding;
}, 10, 2 );
```

---

### `openstation_admin_target_allowlist` — Experimental

The wp-admin filename allowlist consulted when resolving portal `target=` query args — only files on the list may resolve as a window target. Filtered values are restricted to strings, lowercased, and deduplicated after the filter runs.

```php
apply_filters( 'openstation_admin_target_allowlist', string[] $files );
```

---

### `openstation_chromeless_sec_fetch_fallback` — Experimental

Controls the `Sec-Fetch-*` fallback in chromeless detection: when a request arrives without the explicit `?openstation_chromeless=1` query flag but the browser reports `Sec-Fetch-Dest: iframe` + `Sec-Fetch-Site: same-origin`, it is treated as chromeless. Default `true`. Return `false` to require the explicit query flag — useful for environments where a reverse proxy strips the `Sec-Fetch-*` headers and they can't be trusted.

```php
apply_filters( 'openstation_chromeless_sec_fetch_fallback', bool $allow );
```

### `openstation_chromeless_silence_admin_bar` — Experimental

Whether a window skips **building** the admin bar it never draws. Default `true` inside windows.

Suppressing the render stops the markup, not the work. `_wp_admin_bar_init()` is hooked on `admin_init`, `is_admin_bar_showing()` short-circuits to true for any admin request, and so every window still instantiated `WP_Admin_Bar` and called `add_menus()` — which fires `admin_bar_menu` and runs **every** registered callback, core's twenty-odd nodes and every plugin's, each resolving links and checking capabilities — before dropping the finished object on the floor. The shell draws a real bar once; a window drawing none should pay for none.

The class is swapped rather than the init unhooked, deliberately. `remove_action( 'admin_init', '_wp_admin_bar_init' )` would leave `$wp_admin_bar` null, and a plugin that touches the global outside the hook would fatal on it. Core exposes `wp_admin_bar_class` for exactly this, so a window gets a real `WP_Admin_Bar` subclass that works in every respect — `add_node()`, `get_nodes()`, the global is still an object — except that it never solicits nodes.

How much this saves is a property of the site's admin bar: roughly 1.5% of a window's server time on a stock-ish install, and materially more wherever the bar is expensive (a WordPress.com masterbar, a plugin adding counted nodes).

```php
// Let a window build the bar, for a plugin that relies on
// `admin_bar_menu` firing for a side effect rather than a node.
add_filter( 'openstation_chromeless_silence_admin_bar', '__return_false' );
```

---

### `openstation_chromeless_admin_bar_top_values` — Experimental

The set of `top` pixel values the chromeless offset neutralizer treats as admin-bar offset clones. Defaults match the two admin-bar heights Core ships: `32px` (desktop) and `46px` (mobile breakpoint). Sites that customize the admin-bar height (some accessibility themes raise it to 50px) can extend the list. See [plugin-compat-layer.md](./plugin-compat-layer.md) for where the neutralizer sits in the compat stack.

```php
apply_filters( 'openstation_chromeless_admin_bar_top_values', string[] $values );
```

---

### `openstation_chromeless_trimmed_scripts` — Experimental

Script handles dequeued inside chromeless windows, where the admin bar is suppressed and its assets would load, parse and execute against markup that never reaches the DOM. Defaults cover the whole admin-bar family: core's `admin-bar`, OpenStation's own `os-admin-bar` toggle bundle, and the WordPress.com / Jetpack masterbar handles (`wpcom-admin-bar`, `wpcom-notes-common`, `wpcom-notes-admin-bar`, `a8c-faux-inline-help`). Measured on a live install, that family cost **48.8 KB and three cross-origin round trips per window**.

The whole family ships in the defaults deliberately — leaving one queued drags core's `admin-bar` back in as its dependency and undoes the trim. Handles are **dequeued, never deregistered**, so a script that genuinely declares one as a dependency still resolves it and keeps working.

```php
// Reclaim another chrome-only bundle per window.
add_filter( 'openstation_chromeless_trimmed_scripts', static function ( array $handles ) {
    $handles[] = 'my-plugin-admin-bar-widget';
    return $handles;
} );
```

### `openstation_chromeless_trimmed_styles` — Experimental

The stylesheet counterpart. Defaults: `admin-bar`, `wpcom-notes-admin-bar`. Dropping core's `admin-bar` stylesheet also removes the source of the 32px `html.wp-toolbar` padding — the `!important` override in `chromeless.css` stays as the belt-and-braces half of that pair and must not be removed.

```php
apply_filters( 'openstation_chromeless_trimmed_styles', string[] $handles );
```

### `openstation_chromeless_trim_emoji` — Experimental

Whether WordPress's emoji polyfill is dropped inside chromeless windows. Default `true`.

Worth being precise about what this is: the inline detection script tests the browser against the newest Unicode emoji set and, when anything is missing, pulls in `wp-emoji-release.min.js` (Twemoji, 22 KB) to swap those characters for images. It is a real polyfill, not dead code — measured loading on current Chrome inside a window. Dropping it means a very new emoji in admin content renders with the operating system's own glyph instead of a Twemoji image. Core sets the precedent: `wp-admin/edit-form-blocks.php` removes the same action on the block-editor screen.

```php
// Keep Twemoji's image replacement inside windows.
add_filter( 'openstation_chromeless_trim_emoji', '__return_false' );
```

### `openstation_chromeless_trimmed_assets` — Experimental (action)

Fires after the trim runs inside a window — the point to dequeue anything else that only decorates chrome a window does not draw.

```php
add_action( 'openstation_chromeless_trimmed_assets', static function () {
    wp_dequeue_script( 'my-plugin-toolbar-extras' );
} );
```

---

### `openstation_chromeless_trim_command_palette` — Experimental

Whether Core's command-palette runtime is dropped inside a window. Default `true` on every screen except block-editor screens.

The shell owns ⌘K: the keystroke is handled in the parent frame, and the parent only asks a window for its commands when the palette is actually opened (`os-commands-subscribe`). The runtime that answers is nevertheless enqueued by Core on every admin page, so each window paid for it eagerly on the chance the user might one day press ⌘K while that window held focus. Measured on a live install opening **Settings** in a window, that was 43 files, **10.66 MB raw / 1.94 MB gzipped — 73.6% of everything the window downloaded** — parsed and executed again in each window's own JavaScript realm, where an HTTP cache hit buys nothing.

`post.php`, `post-new.php`, `site-editor.php` and `widgets.php` are exempt: they load the same Gutenberg chain for their own reasons, so the palette rides along for the cost of `commands.js` + `core-commands.js`, and those are exactly the screens whose stores hold commands worth harvesting ("Duplicate block", pattern commands). Everywhere else the store holds only the WordPress baseline, which the shell already publishes from its own lazily-loaded runtime.

`customize.php` is **not** exempt. It was, on the assumption that the block-widgets panel made it an editor screen; measured, the exemption bought nothing. The Customizer's own consumers hold its Gutenberg chain either way, so the trim removes only the palette and the palette extensions there and leaves `wp-block-editor`, `wp-blocks`, `wp-components` and every plugin block script in place.

```php
// Keep Core's palette (and its Gutenberg chain) inside windows.
add_filter( 'openstation_chromeless_trim_command_palette', '__return_false' );
```

### `openstation_command_palette_root_handles` — Experimental

The handles treated as command-palette roots. Defaults: `wp-commands` (the `core/commands` store package) and `wp-core-commands` (WordPress's baseline command set). A queued script whose dependency closure reaches one of these is considered a palette contributor.

```php
apply_filters( 'openstation_command_palette_root_handles', string[] $handles );
```


### `openstation_command_palette_trim_dependents` — Experimental

Whether handles that merely *depend on* the palette are dropped alongside the roots. Default `true`.

Dropping the roots alone reclaims nothing while one dependent survives — `WP_Dependencies::all_deps()` pulls the whole chain back in on its behalf — so the walk earns its place. Return `false` to trim only the two Core roots: that gives up the saving on sites carrying palette extensions, and keeps all of it on a site where Core's palette is the only consumer of that chain. It is the safest setting and rarely a necessary one; prefer naming the individual exception through `openstation_command_palette_family` below.

```php
add_filter( 'openstation_command_palette_trim_dependents', '__return_false' );
```

### `openstation_command_palette_family` — Experimental

The full set of handles dropped by the palette trim: the roots plus every scanned handle that reaches one of them and survives the structural exclusions below.

**The dependency graph records "needs", not "is."** `wp-block-editor` declares `wp-commands`; so does Gutenberg's Connectors bootstrap; so does a genuine palette extension — all three because their UI needs the commands *store*. Nothing about the dependency separates the palette from something merely using it, and both regressions in this area came from pretending otherwise.

Conviction is therefore fenced by **structural** exclusions, never by inference about intent, and each says something about what trimming could possibly save:

- **Core's own packages** (`/wp-includes/js/dist/`) are never convicted, and the walk will not travel *through* one to reach a root. They are libraries `WP_Dependencies` already knows how to include or omit, and the palette is a feature *of* the editor, so the dependency there runs backwards. Without this, a plugin's block script is convicted by way of `wp-block-editor` — Contact Form 7's was the real case.
- **A handle with no `src`** is never convicted. There is no file to stop downloading, so the saving is zero, while dropping it discards its inline payload. Gutenberg's Connectors screen registers exactly such a handle and hangs its whole app bootstrap on it; convicting it rendered a blank page for a saving of nothing.

Neither rule names a plugin or reads a handle's name, so a site with a completely different plugin set gets the same treatment, derived from the graph in front of it.

A residue remains: a plugin bundle with a real `src` that depends on the palette *and* paints part of its own screen would still be convicted. This filter is the escape hatch for it — a site knows its own handles, and can name the exception the framework has no way to infer.

This is a family trim for the same reason the admin-bar trim above is: dropping the roots alone saves nothing while a single dependent survives, because `WP_Dependencies::all_deps()` pulls the whole chain back in on that dependent's behalf. Measured with only Core's enqueue deferred, a Settings window still pulled 14.28 MB of the original 14.49 MB — Astra's `command-palette.js` and WooCommerce's `command-palette.js` / `command-palette-analytics.js` each declare `wp-commands` and were still queued.

Note that handles pulled in only *as dependencies of* a palette contributor need no special handling: they stop being requested once their last dependent leaves, and stay if anything else still needs them. That cuts both ways, and it is why the size of the win is a property of the site rather than of this trim. On a stock install the palette is the only thing holding the Gutenberg chain onto an ordinary admin screen, and dropping it takes all ~10.66 MB with it. On a site where some other plugin genuinely depends on that chain and enqueues on every screen — a WooCommerce install pulls `wp-core-data` in through its abilities-api client — the chain stays, correctly, and the trim reclaims only the palette's own bundles.

Use this filter as the escape hatch for a script that registers commands *and* renders part of its own admin screen — a distinction the dependency walk cannot make.

```php
// Keep a bundle that registers commands but also draws its own screen.
add_filter( 'openstation_command_palette_family', static function ( array $family ) {
    return array_values( array_diff( $family, array( 'my-plugin-admin-app' ) ) );
} );
```

### `openstation_command_palette_contributors` — Experimental

The detected palette **contributors** on their own: the family above, minus the roots. A contributor is a queued handle whose reason to exist is the command palette — Astra's `command-palette.js`, WooCommerce's `command-palette.js` / `command-palette-analytics.js`, each enqueued on every admin screen.

Same conviction rule as the family, and the same escape hatch: filter a handle out here for a script that registers commands *and* renders part of its own admin screen, which the dependency walk cannot tell apart.

```php
add_filter( 'openstation_command_palette_contributors', static function ( array $contributors ) {
    return array_values( array_diff( $contributors, array( 'my-plugin-admin-app' ) ) );
} );
```

### `openstation_command_palette_contributor_owns_screen` — Experimental

Whether a contributor's own plugin owns the current admin screen, and may therefore keep its palette script inside a window. This is the "under its own route" exemption: on its own screen a plugin registers screen-specific commands, rather than the site-wide ones the shell already carries.

The default is deliberately conservative, because a false positive costs that window the entire Gutenberg chain — keeping a contributor means keeping the roots it depends on, so the drop set collapses to nothing. It matches when the request is for a file inside the plugin's own directory, or when the `page` query var is prefixed by the plugin's directory slug. A plugin whose menu slug does not resemble its folder name should claim its route through this filter.

```php
add_filter(
    'openstation_command_palette_contributor_owns_screen',
    static function ( $owns, $handle, $owner, $page ) {
        if ( 'acme-palette' === $handle && 'crm-dashboard' === $page ) {
            return true;
        }
        return $owns;
    },
    10,
    4
);
```

### `openstation_command_palette_contributors_hoisted` — Experimental (action)

Fires on the shell after contributors are moved off the boot document and appended to the deferred palette manifest.

The shell already defers Core's palette runtime and replays it on the first ⌘K; contributors defeated that, because they are enqueued normally and `all_deps()` pulled the chain back in on their behalf. Hoisting also fixes a real bug rather than only a cost: a contributor that ran at boot registered its commands against a `core/commands` store that did not exist yet, and lost them. It now executes as part of the replay, after the store exists — so a plugin's commands reach the palette **once, on the shell**, and cost no window anything.

```php
add_action( 'openstation_command_palette_contributors_hoisted', static function ( array $handles ) {
    // $handles no longer print at boot; they replay on first ⌘K.
} );
```

### `openstation_chromeless_trimmed_command_palette` — Experimental (action)

Fires after the palette family is dropped in a window.

```php
add_action( 'openstation_chromeless_trimmed_command_palette', static function () {
    wp_dequeue_script( 'my-plugin-palette-extras' );
} );
```

---

### `openstation_native_window_allowed_html` — Experimental

The `wp_kses`-shaped allowlist used when escaping native-window `<template>` payloads. The default extends `wp_kses_allowed_html( 'post' )` with form controls, `<os-*>` web components, dashicon spans, and permissive `data-*` / `aria-*` attributes. Plugins registering their own native windows can extend the list with custom tags or attributes if their templates need markup not covered by the default.

```php
apply_filters( 'openstation_native_window_allowed_html', array $allowed );
```

---

### `openstation_cascade_deactivate_dependents` — Experimental

The list of plugin files to cascade-deactivate when OpenStation itself is deactivated. Defaults to every plugin whose `Requires Plugins` header lists OpenStation's directory slug. Return an empty array to opt out of the cascade entirely.

```php
apply_filters( 'openstation_cascade_deactivate_dependents', string[] $dependents, string $slug );
```

---

### `openstation_track_type_registrants` — Experimental

Whether this request records which plugin, mu-plugin or theme registered each non-builtin post type and taxonomy. Defaults to `is_admin()`.

```php
apply_filters( 'openstation_track_type_registrants', bool $track );
```

The recorded map is what lets the dock offer `Deactivate <plugin>` on a menu item, and what files a custom post type under its plugin's folder in WP Explorer (see [`openstation_my_wordpress_post_type_group`](#openstation_my_wordpress_post_type_group--experimental-filter)). Both consumers are admin-side, so the gate is admin-side too.

Recording costs one bounded `debug_backtrace()` per non-builtin type registration, and a front-end page view registers exactly the same types (WooCommerce alone brings several) for a map nothing there reads. Return `true` on the front end only if something there does read it.

---

### `openstation_heartbeat_widget_eager_css` — Experimental

Whether the heartbeat widget's stylesheet is eagerly enqueued on shell requests once the OpenStation and chromeless gates have passed (chromeless iframes never receive it — they don't mount widgets). Default `true`. Sites that never plan to ship the heartbeat widget can return `false` and save the stylesheet roundtrip.

```php
apply_filters( 'openstation_heartbeat_widget_eager_css', bool $eager );
```

---

### `openstation_oauth_authorize_query` — Stable

The query parameters appended to an OAuth relay's authorize URL. Lets plugins inject service-specific extras (`access_type=offline` for Google, `force_login=true` for Twitter, `prompt=consent`, …) without forking the relay. `$entry` is the registry entry with `client_secret` redacted. See [`examples/oauth-relay.md`](./examples/oauth-relay.md).

```php
apply_filters( 'openstation_oauth_authorize_query', array $query, string $service, array $entry );
```

---

### `openstation_wallpaper_context_menu_items` — Experimental

The server-borne items appended to the wallpaper's right-click context menu. Each item must carry at least `id` and `label`; optional keys are `icon`, `sort`, `disabled`, and `callbackId`. Items missing `id` or `label` are dropped. See [files-on-desktop.md](./files-on-desktop.md) for the item shape and the JS-side activation hook (`os.wallpaper-context-menu.activated`).

```php
apply_filters( 'openstation_wallpaper_context_menu_items', array[] $items );
```

---

### `openstation_mio_config` — Experimental

Mio's appearance and physics, shipped to the shell as `openStationConfig.mio`. Returning a partial array is fine — anything you leave out keeps the reference design, and every value is re-clamped client-side before it reaches the simulation, so a filter can't produce a broken shell. Colours accept integers (`0x05050a`) or CSS hex strings (`'#05050a'`).

Full key/range table in [mio.md](./mio.md#configuration-reference).

```php
apply_filters( 'openstation_mio_config', array $config );
```

```php
add_filter( 'openstation_mio_config', function ( $config ) {
	// A slower, heavier, teal companion.
	$config['appearance']['hueStart'] = 170;
	$config['appearance']['hueSpan']  = 40;
	$config['physics']['magnetStrength'] = 3400;
	return $config;
} );
```

The on/off state is not part of this filter — it is the per-user OS setting `mioEnabled`, toggled from Mio's dock tile.

---

## AI Copilot hooks — Stable

The AI assistant (Cmd+K palette) runs an agentic loop server-side, analyses entities on save, and exposes a search REST endpoint. Every decision point is hookable so plugins can adjust model selection, customise prompts, limit which entities get analysed, or react to analysis completion.

Credentials and model routing are owned by **WordPress 7.0 Core**: configure a provider in **Settings → Connectors** and the Copilot generates through the Core AI Client (`wp_ai_client_prompt()`), which injects the key automatically. The assistant is available only when the Connectors + Abilities APIs and `wp_supports_ai()` are present.

> **Removed.** The self-managed provider registry and credential surface were replaced by Core Connectors. These no longer exist: the functions `openstation_register_ai_provider()` / `openstation_unregister_ai_provider()`, the actions `openstation_ai_register_providers` / `openstation_ai_provider_registered`, and the filters `openstation_ai_active_provider` / `openstation_ai_model`. The three-callable provider contract (`make_turn_input` / `agentic_call` / `structured_request`) and the `$api_key` argument are gone. Register providers with the Core AI Client / Connectors instead. The `/ai/search` extensibility hooks below are unaffected.

> The built-in Copilot tools are [WordPress Abilities](https://developer.wordpress.org/apis/abilities-api/), listed at `GET /wp-abilities/v1/abilities`. Register a read-only ability and the assistant picks it up automatically — see "Extending the Copilot's tools" below.

> **Removed.** Automatic AI analysis of posts, pages, and taxonomy terms was removed — the copilot now only analyzes comments (for the spam score), and the AI assistant finds content with WordPress's native keyword search. The following filters/actions no longer fire and have been removed: `openstation_ai_supported_post_types`, `openstation_ai_supported_taxonomies`, `openstation_ai_supported_types`, `openstation_ai_schema_content`, `openstation_ai_post_prompt`, `openstation_ai_term_prompt`, `openstation_ai_post_analyzed`, `openstation_ai_term_analyzed`.

### `openstation_ai_schema_comment` — Experimental

Mutate the JSON Schema handed to the provider for structured-output comment analysis. Use this to add custom fields (compliance flags, sentiment buckets, …) the model should populate alongside the built-in `spam` / `harmful` verdict.

```php
apply_filters( 'openstation_ai_schema_comment', array $schema );
```

You don't need to write the provider's strict-mode boilerplate: after the filter runs, every object subschema in the tree is stamped with `additionalProperties: false` (the key strict structured output requires and JSON Schema treats as optional). Add a nested object and it will pass validation. Strict mode does still reject numeric/string constraints (`minimum`, `maxLength`, …) and recursive `$ref`s — those are not repaired for you.

### `openstation_ai_comment_prompt` — Stable

Customise the user-side prompt handed to the model for comment analysis. The filter receives the default prompt plus the comment object.

```php
apply_filters( 'openstation_ai_comment_prompt', string $prompt, WP_Comment $comment );
```

### `openstation_ai_comment_analyzed` — Stable

Fires after a comment has been successfully analyzed. The result array contains the fields emitted by the schema (`topic`, `ai_summary`, `harmful`, `spam`). Use it to mirror the verdict into a custom moderation queue or trigger downstream jobs.

```php
do_action( 'openstation_ai_comment_analyzed', int $comment_id, array $result, WP_Comment $comment );
```

### `openstation_ai_admin_page_catalog` — Stable

Last-chance filter over the catalog of admin pages the AI search tool can link to. Each entry is `{ title, url, icon, description }` — `icon` is a Dashicons class used when the assistant opens the page in an iframe window. Plugins that expose admin UIs typically inject their top-level pages here so the assistant can offer them as navigation results.

```php
apply_filters( 'openstation_ai_admin_page_catalog', array $catalog );
```

### `openstation_ai_error_log_candidates` — Experimental

Filter the ordered list of log-file paths the `get_php_error_log` AI tool probes. Defaults to `WP_CONTENT_DIR . '/debug.log'`, then the PHP `error_log` ini value (omitted when empty or `'syslog'`). Return `string[]` file paths in probe order — the first readable file wins. Plugins that redirect PHP errors to a non-standard location can prepend their path here.

```php
apply_filters( 'openstation_ai_error_log_candidates', string[] $candidates );
```

### `openstation_ai_model_config` — Experimental

Model config for one AI turn. Fires on every path that generates: the Copilot search loop, the command follow-up, the comment scorer, the Agents runner, and the Drafts widget's writing assistant.

```php
apply_filters( 'openstation_ai_model_config', array $config, array $context );
// $config  = { model?: string|ModelInterface, max_tokens?: int, temperature?: float, custom_options?: array<string, mixed> }
// $context = { user_id, request_id, source, has_tools, has_schema }
```

`model` takes a model id or an SDK `ModelInterface`; anything else is ignored. `custom_options` keys are **provider-native parameter names**, forwarded verbatim into the request body; nothing there is validated, and a bad key fails the turn as a `WP_Error`. `source` is one of `ai-copilot/search`, `ai-copilot/followup`, `ai-copilot/comment-analysis`, `agents/runner`, `widgets/drafts-suggestions`.

`custom_options` also feeds model discovery, not just the request body: the AI Client turns each key into a required option when it picks a model, so on a multi-provider connector an option only one model supports narrows the selection to it (or fails to match any).

**Defaults to empty.** OpenStation pins neither provider nor model, since the keys that control reasoning depth are model-family-specific.

Recipe: [`examples/ai-model-config.md`](./examples/ai-model-config.md).

---

## Drafts widget — AI writing assistant (Experimental)

The Drafts widget offers per-draft title / excerpt / tag / category suggestions plus a readiness check, generated through the Core AI Client. Two REST routes back it:

| Route | Method | Gate | Purpose |
|---|---|---|---|
| `/wp-json/desktop-mode/v1/draft-suggestions` | POST `{ post_id }` | `edit_post`, then a configured text-generation provider | Read-only. Returns `{ titles, excerpt, tags, categories, readiness: { summary, missing } }`. |
| `/wp-json/desktop-mode/v1/draft-apply` | POST `{ post_id, title?, excerpt?, tags?, categories? }` | `edit_post` | Writes an accepted suggestion onto the post. Tags and categories are **appended**, never clobbered. New categories are only created for users who can `manage_categories`; unknown ones are skipped. |

The capability check runs **before** the provider check, so an unauthorized caller gets the same `403` whether or not the site has AI configured. With no provider, an authorized caller gets `503 openstation_ai_unavailable` and the 💡 button never renders — the widget degrades to exactly its pre-AI behavior.

### `openstation_drafts_ai_instructions` — Experimental

The system instruction sent with a draft-suggestions request. Retune the assistant's voice, add house style rules, or tighten the readiness rubric without forking the route.

```php
apply_filters( 'openstation_drafts_ai_instructions', string $instructions, WP_Post $post );
```

### `openstation_drafts_ai_schema` — Experimental

The JSON Schema the model must answer in. Changing the shape changes the REST response shape too — the route only normalizes the keys it knows about (`titles`, `excerpt`, `tags`, `categories`, `readiness`), and anything else passes through untouched.

```php
apply_filters( 'openstation_drafts_ai_schema', array $schema, WP_Post $post );
```

As with [`openstation_ai_schema_comment`](#openstation_ai_schema_comment--experimental), object subschemas are stamped with `additionalProperties: false` after the filter runs, so a nested object you add doesn't have to carry the provider's strict-mode boilerplate itself.

### `openstation_drafts_ai_content_limit` — Experimental

How many characters of the draft body are sent to the model. Default `4000`; truncation is multibyte-safe. Return `0` or a negative number to send the whole draft.

```php
apply_filters( 'openstation_drafts_ai_content_limit', int $limit, WP_Post $post );
```

### `openstation_drafts_ai_suggestions` — Experimental

Last-mile filter over the normalized suggestions, after tag-stripping and truncation. Drop, reorder or append entries without re-sanitizing.

```php
apply_filters( 'openstation_drafts_ai_suggestions', array $suggestions, WP_Post $post );
```

### `openstation_drafts_suggestion_applied` — Experimental

Fires after an accepted suggestion has been written onto a post. `$applied` holds **only** the fields that actually changed — an empty array means the request was a no-op (e.g. an unknown category the user couldn't create). `$post` is the post as it was *before* the update.

```php
do_action( 'openstation_drafts_suggestion_applied', int $post_id, array $applied, WP_Post $post );
```

---

## AI Copilot extensibility — `/ai/search` (Experimental)

Every `POST /desktop-mode/v1/ai/search` call — whether driven by the built-in overlay or by `wp.os.ai.ask()` — runs through this layered hook surface. Use it to:

- Inject domain context into the system prompt.
- Add or remove tools the AI can call.
- Gate which slash-commands the AI is allowed to invoke.
- Transform tool results on their way back to the model.
- Rewrite the final answer.
- Observe / log / cost-track every call via the start/tool/complete/error action trio.

Every filter receives a `$context` array with at least `{ user_id, request_id }`. `request_id` is a UUID minted once per call — use it to correlate `openstation_ai_search_started`, each `openstation_ai_tool_called`, and the final `openstation_ai_search_completed`.

### `openstation_ai_system_prompt_appendix` — Stable

Most-common extension point. Every plugin's return value is concatenated onto the built-in instructions. Safe to stack across plugins — none overwrite each other.

```php
add_filter( 'openstation_ai_system_prompt_appendix', function ( $appendix, $ctx ) {
    return $appendix . "\n\nThis site controls a smart home. Rooms: kitchen, living room, bedroom.";
}, 10, 2 );
```

### `openstation_ai_system_prompt` — Stable

Final transform pass on the composed prompt (built-in + appendix + any client override). Reserved for deep integrations — compliance disclaimers, restructured instructions. Most plugins should reach for the appendix filter instead.

```php
apply_filters( 'openstation_ai_system_prompt', string $instructions, array $context );
```

### `openstation_ai_system_prompt_replace_capability` — Stable

Capability the client must hold to send `system_prompt: { mode: 'replace' }`. Default `manage_options`. Non-admin requests with `mode: 'replace'` silently downgrade to `append` — text is never dropped.

```php
apply_filters( 'openstation_ai_system_prompt_replace_capability', string $capability, array $context );
```

### `openstation_ai_request` — Stable

Last-mile filter on the whole request bundle, right before `openstation_ai_run_search()` fires. Mutable — return a modified array to rewrite `command_tools`, inject default `system_prompt_text`, add a sub-request flag that downstream filters observe.

```php
apply_filters( 'openstation_ai_request', array $extra, array $core );
// $extra = { user_id, request_id, command_tools, system_prompt_text, system_prompt_mode }
// $core  = { query, resume_tool, start_offset }
```

### `openstation_ai_tools` — Stable

Transforms the full tool list (built-in ability tools + client commands) once per run, just before it goes to the provider. Add tools, remove tools, rewrite descriptions. (To add a server-dispatched tool, register a read-only ability — see "Extending the Copilot's tools" below.)

```php
apply_filters( 'openstation_ai_tools', array $tools, array $context );
```

### `openstation_ai_command_tools` — Stable

Narrower sibling — fires on only the command-derived subset. Right hook for bulk gating ("strip every command from this tool list for unauthenticated requests").

```php
apply_filters( 'openstation_ai_command_tools', array $command_defs, array $context );
```

### `openstation_ai_command_allowed` — Stable

Per-slug gate. Fired once per client-supplied command, before it's converted into a tool definition. Return `false` to drop the command entirely.

```php
add_filter( 'openstation_ai_command_allowed', function ( $entry, $slug, $ctx ) {
    // Non-admins can't invoke the /delete_* family via the AI.
    if ( str_starts_with( $slug, 'delete_' ) && ! user_can( $ctx['user_id'], 'manage_options' ) ) {
        return false;
    }
    return $entry;
}, 10, 3 );
```

### `openstation_ai_tool_result` — Stable

Transform a tool's result on its way back to the model. Fires for **every** built-in ability tool (search_*, list_admin_pages, …) as it returns.

```php
apply_filters( 'openstation_ai_tool_result', array $result, string $tool_name, array $args, array $context );
```

### `openstation_ai_answer` — Stable

Final transform hook — fires immediately before the HTTP response is returned. Also fires for the `tool_call` short-circuit, the follow-up composed reply, and the budget-exhausted path.

```php
apply_filters( 'openstation_ai_answer', array $answer, array $context );
// $answer shape: { answer_type, message, entity, admin_links, tool?, iterations, exhausted, continue, request_id }
// $context: { query, user_id, request_id, phase? }  — phase='follow_up' on the second leg
```

### `openstation_ai_followup_outcome_max_chars` — Stable

Caps the size of the serialised tool result the follow-up leg sends to the provider. Default `4000` characters — enough for a status string, a small result list, or a short error envelope. Set `0` to disable truncation (not recommended — a buggy or malicious plugin that returns a 5 MB blob would then inflate token usage unbounded).

```php
apply_filters( 'openstation_ai_followup_outcome_max_chars', int $max_chars );
```

### `openstation_ai_search_started` — Stable

Fires once per `/ai/search` invocation, after validation, before any provider call. First anchor of the observability trio.

```php
do_action( 'openstation_ai_search_started', array $context );
// $context = { query, user_id, request_id, phase? }
```

`phase` is `'follow_up'` when the event fires for the second leg of the agentic command-dispatch flow (triggered by the client sending `ask( q, { followUp: true } )`). Omitted on the primary leg.

### `openstation_ai_tool_called` — Stable

Fires each time a tool runs — a search/navigation **ability** or a command-tool short-circuit. `tool_name` is the model-facing name (e.g. `search_posts`), which is the ability slug with its namespace stripped.

```php
do_action( 'openstation_ai_tool_called', array $payload );
// $payload = { tool_name, args, user_id, request_id }
```

### `openstation_ai_search_completed` — Stable

Fires after the final answer is composed (every success path). Observability partner to `openstation_ai_search_started`.

```php
do_action( 'openstation_ai_search_completed', array $payload );
// $payload = { query, user_id, request_id, answer_type, iterations, usage, model }
```

`usage` is the summed token usage across every turn — `{ prompt, completion, total }` (integers) — and `model` is the last model the AI Client resolved — `{ id, name }`. Either may be `null` when the provider didn't report it.

### `openstation_ai_search_error` — Stable

Fires on any `WP_Error` from the search / follow-up run (provider failure, response-parse failure, etc.) and when an ability's `execute()` returns a `WP_Error` (permission denied, invalid input/output). REST permission denials do NOT fire it — REST core rejects those requests before the route callback runs. Includes the `request_id` so subscribers can correlate with `openstation_ai_search_started`.

```php
do_action( 'openstation_ai_search_error', array $error );
// $error = { code, message, data, user_id?, request_id? }
```

On an ability-execution failure the payload is `{ stage: 'tool_execute', tool_name, error, message, user_id, request_id }` — the failed tool call is surfaced to the model as a clean error result (never a fatal), so the agent can recover.

---

### Extending the Copilot's tools

The Copilot's tools are [WordPress Abilities](https://developer.wordpress.org/apis/abilities-api/) — its own search/navigation abilities (`search_posts`, `search_comments`, `list_admin_pages`, …) plus **any read-only ability registered on the site** (Core's, or another plugin's), listed at `GET /wp-abilities/v1/abilities`. To give the assistant a new tool, just register a read-only ability with `wp_register_ability()` on `wp_abilities_api_init` — no opt-in step. The agent loop advertises every read-only ability and dispatches calls through `wp_get_ability()->execute()`, so its `permission_callback` and input/output schemas are enforced by Core.

Only read-only abilities are offered on purpose: a search turn can be steered by attacker-controlled content (comment / post text in a tool result), so the model is never handed an ability that can change the site. See [`examples/ai-ask.md`](examples/ai-ask.md) for a full ability recipe.

---

## OS-file drop manager — Experimental

The drop manager (`src/os-file-drop/`) catches files dragged from the user's native OS (Finder / Explorer / Nautilus) anywhere on the shell and routes them through a confirmation dialog before uploading to the Media Library. See [`docs/examples/os-file-drop.md`](examples/os-file-drop.md) for the full recipe.

### `openstation_drop_allowed_mimes`

Narrows or widens the allowed-MIMEs list surfaced to the JS drop manager. Default is `get_allowed_mime_types( $user_id )` when the user has `upload_files`, otherwise an empty array — the plugin applies the `upload_files` gate itself. A filter can widen the (empty) map for such users, but `openstation_drop_enabled` still defaults to off for them.

```php
apply_filters( 'openstation_drop_allowed_mimes', array $mimes_map, int $user_id );
```

`$mimes_map` is the `ext => mime` map (same shape `get_allowed_mime_types()` returns). The drop manager flattens to canonical MIMEs before the policy check.

---

### `openstation_drop_max_size`

Caps the per-file size the JS drop manager enforces locally before upload. Default is `wp_max_upload_size()`. Returning `0` disables the client-side cap — the server still enforces its own.

```php
apply_filters( 'openstation_drop_max_size', int $max_size, int $user_id );
```

---

### `openstation_drop_enabled`

Master gate for the OS-file drop manager. Defaults to `current_user_can( 'upload_files' )`. Return `false` to disable drop handling entirely for the current user (e.g. role-gated, multisite-gated, or environment-gated).

```php
apply_filters( 'openstation_drop_enabled', bool $enabled, int $user_id );
```

---

### JS hooks fired by the drop manager

| Hook | Kind | Notes |
| --- | --- | --- |
| `os.drop.files-detected` | filter | `(files: File[], ctx) => File[]`, before mime / size filter. Return `[]` to abort silently. |
| `os.drop.files-rejected` | action | `{ rejections, context }` — files that failed the allow-list. |
| `os.drop.dialog-fields` | filter | `(entry, ctx) => entry` — mutate the per-file defaults. |
| `os.drop.before-upload` | filter | `(payload, ctx) => payload \| null` — return `null` to cancel. |
| `os.drop.upload-started` | action | `{ file, fields, context, abort }` — fires once the XHR is `open()`ed and immediately before `send()`. Call `abort()` to cancel the in-flight upload; the manager rejects with `UploadAbortedError` and emits `upload-failed`. If `abort()` is called after the request body has been fully sent, the manager lets the server respond and then DELETEs the resulting attachment so the user's Media Library never shows a "cancelled" file. |
| `os.drop.upload-progress` | action | `{ file, fields, context, loaded, total, indeterminate }` — per `XMLHttpRequestUpload.progress` event. `total === 0` / `indeterminate === true` when the request length isn't known. A synthetic 100% event is dispatched on `upload.load` so a HUD can show "wrapping up" while the server finishes the response. |
| `os.drop.after-upload` | action | `{ file, result, fields, context }` — `file` is the same `File` reference exposed by `upload-started` / `upload-progress`, so per-file state can be looked up by identity rather than filename. |
| `os.drop.upload-failed` | action | `{ file, error, context }` — `file` carries the same identity as `upload-started` / `upload-progress` / `after-upload` (the post-`before-upload` `File`, in case a plugin swapped it). Match by reference, not filename. `error.name === 'UploadAbortedError'` when the failure came from a `upload-started` `abort()` call. |

---

## Planned (not yet fired)

The filters and actions below are **reserved names** documented for forward compatibility. They will land with the phase indicated. Do not register listeners in production code until the status flips to Stable.

### Window — Phase 3
```php
apply_filters( 'openstation_window_args',           array $args, string $page );
apply_filters( 'openstation_window_reuse',          bool  $reuse, string $page );
apply_filters( 'openstation_window_excluded_pages', array $excluded );
```

### Dock (extended) — Phase 3+
```php
apply_filters( 'openstation_dock_style', array $style );      // icon size, gap, blur
```

> Dock placement (left / right / bottom) ships as a user preference in OpenStation Preferences, persisted via the standard settings REST endpoint. No server-side filter is wired today — a plugin that wants to force a placement can set the user meta directly or post to `/desktop-mode/v1/os-settings`.

### Desktop area — Phase 4+
```php
apply_filters( 'openstation_wallpaper',    string $url,   string $color_scheme );
apply_filters( 'openstation_context_menu', array  $menu_items );
apply_filters( 'openstation_icon',         array  $icon_config, string $icon_id );
```

> `openstation_icons` and `openstation_wallpapers` and the widget registry filter are **shipped** — see their Stable entries above. `openstation_widgets` is not a PHP filter; the JS-side `os.widgets` filter is the canonical hook (widgets are declared via `openstation_register_widget()` server-side).

### Responsive — Phase 5–6
```php
apply_filters( 'openstation_mode_type',           string $mode );   // 'desktop' | 'tablet' | 'mobile'
apply_filters( 'openstation_mobile_grid_items',   array  $items );
apply_filters( 'openstation_mobile_tab_bar',      array  $tabs );
apply_filters( 'openstation_mobile_app_switcher', array  $cards );
apply_filters( 'openstation_tablet_split_config', array  $config );
```

### Native windows — reserved extensions
```php
apply_filters( 'openstation_native_windows',       array $windows );
apply_filters( 'openstation_native_window_config', array $window_config, string $window_id );
```

> Native windows themselves are **shipped** — plugins declare them with `openstation_register_window()` and react via the Stable registration actions (`openstation_native_window_registered`) and JS lifecycle hooks (`os.native-window.before-render` / `after-render` / `before-close`). The two filter names above are reserved for a future read-only view of the registry and per-window config overrides.

### Drag & Drop — Phase 8
```php
apply_filters( 'openstation_drag_mime_types', array $mime_types );
apply_filters( 'openstation_drag_payload',    array $payload, string $source_page, string $target_page );
apply_filters( 'openstation_drop_accepts',    bool  $accepts, array $payload, string $target_page );
```

### Body classes — Stable (applied, filter planned)
```php
apply_filters( 'openstation_body_classes', string $classes );
```
Currently the `os-active` / `os-chromeless` classes are added unfiltered via `admin_body_class`. A named filter is planned.

---

## Registration functions

Shell extension points — windows, widgets, wallpapers — are declared through `openstation_register_*()` PHP functions that mirror Core's `register_*` conventions. Every function returns `true` on success and `WP_Error` on any validation failure, with a stable error code callers can branch on.

```php
$result = openstation_register_window( 'jorvy', array(
    'title'    => 'Jorvy',
    'template' => 'jorvy_render_template',
    'script'   => 'jorvy-render',
    'style'    => 'jorvy-render', // optional) );

if ( is_wp_error( $result ) ) {
    error_log( '[jorvy] registration failed: ' . $result->get_error_code() . ' — ' . $result->get_error_message() );
}
```

> **`style`.** Optional `wp_register_style()` handle. The shell resolves it to a `styleUrl` (and any `wp_add_inline_style()` blobs) and lazy-injects a `<link rel="stylesheet">` when the window's plugin is activated mid-session. Without `style`, a peer plugin activated from inside an open shell renders its window with **no CSS** until the user reloads — the parent shell already finished `wp_print_styles` before the plugin existed. If the handle isn't registered, the field is silently dropped (no error, no link); plugins active at boot continue to print through the normal `wp_print_styles` pipeline as before.

> **`script` loads on first open.** The shell reads your render callback off `window.openStationNativeWindows[ <id> ]` *after* fetching the bundle, so nothing is required of you: register the handle, publish the callback, and the window works. What changes is *when* — a bundle is no longer printed on every admin page for a window the user may never open. `wp_localize_script` / `wp_add_inline_script` / `wp_set_script_translations` data is harvested off the registered handle into the payload and replayed around the injected `<script>` tag, so it arrives either way.
>
> **`scripts`** *(optional, `string[]`)* — companion handles loaded in order immediately **before** `script`. For a bundle that extends the window from outside it — subscribing to actions the window's own bundle fires, contributing a section — and therefore has to be listening before that bundle is parsed. Declaring it here is what keeps it off the boot critical path: it travels with the window it extends. Handles that were never registered are dropped silently, the same way `style` is.
>
> **`styles`** *(optional, `string[]`)* — companion stylesheet handles injected on the window's **first open**, after the window's own `style`, in declared order. The styles-side mirror of `scripts`, with deliberately different timing from `style`: the window's own stylesheet lands when the window registers (so a mid-session activation paints), but a companion sheet exists to be deferred — one that only paints surfaces inside the window is dead weight on every document that never shows it, chromeless iframes included. Injected-after means a companion's equal-specificity overrides win by source order, the same guarantee a `wp_register_style()` dependency gives on the print path — but declare real dependencies on the handle anyway, so the eager `preload_script` path resolves them. Unregistered handles drop silently.
>
> **`preload_script`** *(optional, `bool`, default `false`)* — load `script` (and `scripts`, and enqueue `styles`) at shell boot instead. Opt in **only** when the bundle has a job to do whether or not the window is ever opened: a dock-badge poller, an API it installs on `wp.os`. Prefer splitting that job into an always-loaded bundle over paying the whole window's weight on every admin page. For a one-off call into an API a window's bundle publishes, [`wp.os.loadWindowScript( id )`](./javascript-reference.md#wposloadwindowscript-id---stable) fetches it on demand without this flag.

> **Wallpaper and widget `script` handles defer too**, with no flag to think about. `openstation_register_wallpaper()`'s bundle loads when the wallpaper is applied or the picker opens (the shell paints the swatch from your `preview` / `label` / `description` meanwhile); `openstation_register_widget()`'s loads when the widget mounts (the picker row comes entirely from your metadata). Both contracts — `window.openStationWallpapers[ id ]` and `window.openStationWidgets[ id ]` — are unchanged. See [`migration-lazy-window-scripts.md`](./migration-lazy-window-scripts.md).

### Backwards compatibility

Early development builds of these functions returned `bool`; every tagged release returns `true|WP_Error`. `WP_Error` is an object and therefore truthy, so legacy `if ( openstation_register_window( … ) )` guards continue to compile and reach their success branch. New code should use `is_wp_error()` to distinguish success from failure.

### Error codes

| Code | Raised by | Meaning |
|---|---|---|
| `openstation_missing_id` | window / widget / wallpaper / icon | The `$id` argument was empty. |
| `openstation_missing_window_id` | `openstation_register_window_tab` | The `$window_id` argument was empty. |
| `openstation_missing_title` | `openstation_register_window`, `openstation_register_icon` | The `title` field was empty. |
| `openstation_missing_label` | `openstation_register_widget`, `openstation_register_wallpaper`, `openstation_register_window_tab` | The `label` field was empty. |
| `openstation_missing_script` | `openstation_register_wallpaper` (canvas) | The `script` handle was empty. (`script` is optional on `openstation_register_window` — native windows can be template-only.) |
| `openstation_missing_tab_value` | `openstation_register_window_tab` | The `value` field was empty. |
| `openstation_reserved_tab_value` | `openstation_register_window_tab` | Tab `value` was `main` (reserved for the window's own template tab). |
| `openstation_invalid_template` | `openstation_register_window`, `openstation_register_window_tab` | The `template` callback is not callable. |
| `openstation_missing_target` | `openstation_register_icon` | Neither `window` nor `url` was declared. |
| `openstation_conflicting_target` | `openstation_register_icon` | Both `window` and `url` were declared (pick one). |
| `openstation_invalid_url` | `openstation_register_icon` | The `url` argument isn't a valid http(s) URL. |
| `openstation_capability_denied` | all five | Current user lacks a capability declared in `capabilities`. The offending cap is available on `get_error_data()['capability']`. |

All five functions ship as **Stable**.

### `openstation_register_window_tab()`

Attaches an additional tab to a native window. The window's own `template` becomes the first tab automatically (its label comes from `main_tab_label` on `openstation_register_window()`, falling back to `title`); each call to this function adds another tab after the main one. Cross-plugin extension is supported — a companion plugin can attach a tab to someone else's window with no coordination other than knowing the window id.

```php
openstation_register_window_tab( string $window_id, array $args );
```

**Args**: `value` (required, kebab slug, cannot be `main`), `label` (required), `template` (required callable), `script` (optional handle), `position` (optional int; lower renders earlier), `capabilities` (optional cap list).

When at least one additional tab is registered, the shell wraps the entire window template in `<os-stack>` + `<os-tabs>` + one `<os-tabpanel>` per tab automatically — plugin authors stop hand-writing that markup. Single-pane windows (zero additional tabs) are unchanged.

See [`docs/examples/native-window-with-tabs.md`](./examples/native-window-with-tabs.md) for a full walkthrough.

---

## DevTools / debug bus

### `openstation_debug_publish( $session_id, $channel, $payload )` — Experimental (PHP function)

Publish a payload onto the per-session debug bus. Plugins running inside an admin / REST / AJAX request hook a capture (e.g. `SAVEQUERIES` for SQL, `pre_http_request` for outbound HTTP, output buffering for response inspection), then call this to stream events to a client-side inspector window.

```php
$session_id = openstation_debug_session_for_request();
if ( '' !== $session_id ) {
    openstation_debug_publish( $session_id, 'query', array(
        'sql'  => $sql,
        'time' => $duration,
    ) );
}
```

**Args**: `$session_id` (string from the `X-WP-Debug-Session` header — see helper below), `$channel` (free-form lowercase ASCII; convention: `query`, `log`, `rest_timing`), `$payload` (anything `wp_json_encode()` can serialise).

**Storage**: per-(session, channel) ring buffer in a transient, capped at 500 events (filterable via `openstation_debug_ring_size`), TTL 1 hour.

### `openstation_debug_session_for_request()` — Experimental (PHP function)

Read the debug session id from the current request's `X-WP-Debug-Session` header. Sanitises against UUID-shape input; returns `''` when absent or invalid. Use this to gate capture work so non-instrumented requests pay zero cost.

### `openstation_debug_publish` — Experimental (action)

Fires synchronously after a publish lands in the ring buffer.

```php
do_action( 'openstation_debug_publish', string $session_id, string $channel, mixed $payload );
```

### `openstation_debug_ring_size` — Experimental (filter)

Override the per-(session, channel) ring buffer cap. Default 500.

### `openstation_debug_channels` — Experimental (filter)

Declare the full set of channels for a given session id. Read by `GET /desktop-mode/v1/debug` when no `channel` / `channels[]` query parameter is present.

### `openstation_debug_rest_permission` — Experimental (filter)

Override the default `manage_options` permission gate on `GET /desktop-mode/v1/debug`.

See [`docs/examples/devtools-instrumentation.md`](./examples/devtools-instrumentation.md) for the full walkthrough — header contributions, observe mode, debug bus.

---

## Content-change realtime layer

`includes/content-changes.php` — the generic "something changed,
every window listing that type should refresh" system. Any create /
update / trash of a post, page, `show_ui` CPT, comment, or
WooCommerce order is recorded into a per-request changelog and
relayed to the parent shell as a cross-window broadcast
(`os.<type>.changed`, see the topic contract under
[Trash → Cross-window broadcast](#cross-window-broadcast)).
Consumers already in place: the chromeless soft-reload for iframe
list pages, and the native Posts / Pages / Users / Comments windows.

Three delivery paths:

1. **Chromeless footer (instant).** Form-POST → redirect flows
   (classic editor, WooCommerce order Update, bulk actions). The
   changelog survives the redirect in a 60 s per-user transient and
   is flushed by the next chromeless `admin_footer` render.
2. **Block editor (instant).** Gutenberg saves over REST with no
   navigation; the chromeless bridge's save-watcher posts the
   broadcast directly (`source: 'editor'`).
3. **Heartbeat (catch-all, ≤ one tick).** Every record is appended to
   the pruned `_desktop_mode_content_changes_log` option
   (autoload=false, 5-minute window, 100 entries max); opted-in
   shells send `openstation_content_changes_seen_ts` per tick and
   re-broadcast the fresh entries (`source: 'heartbeat'`). Covers
   Quick Edit, AJAX moderation / status flips, other browser tabs,
   REST and WP-CLI mutations. Tabs that never opt in pay zero.

Built-in publishers: `wp_after_insert_post` (revisions, autosaves,
auto-drafts, trash-status writes, and non-`show_ui` types skipped),
`wp_insert_comment` / `edit_comment` / `transition_comment_status`
(trash transitions skipped — the Trash module owns the trash verbs),
and — when WooCommerce is active — `woocommerce_new_order` /
`woocommerce_update_order` / `woocommerce_order_status_changed` /
`woocommerce_trash_order` / `woocommerce_untrash_order` /
`woocommerce_delete_order`, always recorded as type `shop_order` so
one topic serves both HPOS and legacy storage.

### `openstation_content_changes_record()` — Stable *(function)*

The public recorder — call it from your own mutation paths (custom
tables, settings screens) and every window listing your type
refreshes exactly like core content:

```php
openstation_content_changes_record( string $type, int $id, string $action ): bool
// $action: 'created' | 'updated' | 'trashed' | 'untrashed' | 'deleted'
```

Dedupe is first-writer-wins per `type:id` within a request — the more
specific verb (recorded by an earlier hook) wins over a later generic
`updated`. If your list screen is not a standard
`edit.php?post_type=<type>` page, pair the recorder with a
`openstation_soft_reload_rules` entry (below).

### `openstation_content_changes_should_record` — Stable *(filter)*

Veto gate in front of every record — return `false` to keep a
mutation out of the realtime system entirely (footer broadcast AND
heartbeat log).

```php
apply_filters( 'openstation_content_changes_should_record', bool $record, string $type, int $id, string $action );
```

### `openstation_content_change_recorded` — Stable *(action)*

Fires after every successful record. Push your own real-time channel
(websocket, SSE) here without re-hooking every mutation path.

```php
do_action( 'openstation_content_change_recorded', string $type, int $id, string $action );
```

### `openstation_content_change_topic` — Experimental *(filter)*

Broadcast topic per type, applied while the footer emitter builds
envelopes. Default `os.<type>.changed`.

```php
apply_filters( 'openstation_content_change_topic', string $topic, string $type, string $action );
```

### `openstation_content_changes_broadcasts` — Experimental *(filter)*

The full envelope list (`array( array( 'topic' => …, 'payload' => … ) )`)
just before the chromeless footer emits. Return an empty array to
suppress the emit for this render.

```php
apply_filters( 'openstation_content_changes_broadcasts', array $broadcasts );
```

### `openstation_content_changes_emitted` — Experimental *(action)*

Fires after the footer printed the emit script, with the envelopes it
carried.

```php
do_action( 'openstation_content_changes_emitted', array $broadcasts );
```

### `openstation_soft_reload_rules` — Stable *(filter)*

Declarative soft-reload rules injected into every chromeless iframe,
for list screens that are **not** a standard `edit.php?post_type=X` /
`upload.php` / `edit-comments.php` page (those are matched
generically — see the soft-reload contract under
[Trash → Cross-window broadcast](#cross-window-broadcast)).

```php
apply_filters( 'openstation_soft_reload_rules', array $rules );
```

Rule shape (all matched against the iframe's current URL):

```php
array(
    'topic'       => 'os.my_type.changed', // broadcast topic to react to
    'path'        => 'admin.php',                    // wp-admin filename
    'query'       => array( 'page' => 'my-list' ),   // required query params (exact match)
    'queryAbsent' => array( 'action' ),              // params that must NOT be present
)
```

The default rule set ships one entry — WooCommerce's HPOS orders list
(`admin.php?page=wc-orders`, topic `os.shop_order.changed`),
with `queryAbsent: [ 'action' ]` so the single-order **editor**
(`…&action=edit`) keeps the single-edit exclusion and never loses
unsaved state to a background refresh.

### Heartbeat contract

| Direction | Field | Shape |
|---|---|---|
| client → server | `openstation_content_changes_seen_ts` | `int` server-ms high-water mark; `0` on the first (handshake) tick. |
| server → client | `openstation_content_changes` | `{ ts: int, entries: [ { ts, type, action, ids } ] }` — entries newer than the client's seen ts. |

The shell's first tick is a pure handshake (adopts the server clock,
broadcasts nothing) so client/server clock skew can never drop
changes. A change that already arrived via the footer or editor path
is re-broadcast once on the next tick — consumers are idempotent by
contract.

See [`docs/examples/content-changes.md`](./examples/content-changes.md)
for an end-to-end third-party recipe.

---

## Trash

The window and its dock tile are titled **Trash** — WordPress's own word for deleted content. The module directory, window id (`desktop-mode-recycle-bin`), REST routes, and every hook below keep the `recycle_bin` slug, so nothing a plugin binds to moves.

The Trash stamps who-deleted-what-when metadata on posts, pages, attachments, and comments as they pass through the WordPress trash (attachments only reach trash when `MEDIA_TRASH` is enabled) and exposes browse / restore / purge over REST. Every decision the bin makes is filterable.

### `openstation_recycle_bin_capture_post_types` — Experimental (filter)

Post types whose deletions the bin tracks. Defaults to `[ 'post', 'page', 'attachment' ]` **plus every non-builtin post type registered with `show_ui => true`** — so custom post types with an admin UI surface in the bin out of the box, with their own singular label and menu Dashicon on the row. Per-item visibility still gates on `edit_post`, so the list never shows a user rows they couldn't manage.

Remove a type here to keep its trash out of the bin, or add a headless (`show_ui => false`) type to opt it in — the pinned-notes feature opts its `wpd_note` CPT in exactly this way (with owner-only gates layered via `openstation_recycle_bin_user_can_view` / `_restore` / `_purge`; see `includes/notes/recycle-bin.php` for the reference wiring).

Returning a list excluding `attachment` stops the bin from stamping and listing trashed attachments; it does not change how WordPress deletes media (that is governed by `MEDIA_TRASH`).

```php
// Keep a state-machine CPT's trash out of the bin.
add_filter( 'openstation_recycle_bin_capture_post_types', function ( $types ) {
    return array_diff( $types, array( 'shop_order' ) );
} );
```

### `openstation_recycle_bin_should_capture` — Planned (filter, not yet fired)

**Reserved name — not yet fired.** Intended as a per-deletion opt-out: returning `false` for a specific `WP_Post` would let that single deletion bypass the bin's metadata stamping. Today the capture path consults `openstation_recycle_bin_capture_post_types` only. Do not subscribe in production until the status flips.

```php
apply_filters( 'openstation_recycle_bin_should_capture', bool $capture, WP_Post $post );
```

### `openstation_recycle_bin_query_args` — Experimental (filter)

Customize the `WP_Query` args used to populate the bin — scope it to the current user, restrict by role, or interleave additional post types beyond the capture list.

```php
apply_filters( 'openstation_recycle_bin_query_args', array $query_args, array $caller_args );
```

### `openstation_recycle_bin_comment_query_args` — Experimental (filter)

Mirror of `openstation_recycle_bin_query_args` for the comment side of the bin — customize the `get_comments()` args used to populate the trashed-comments list.

```php
apply_filters( 'openstation_recycle_bin_comment_query_args', array $comment_args, array $caller_args );
```

### `openstation_recycle_bin_comments_enabled` — Experimental (filter)

Whether the bin tracks trashed comments at all. Default: `current_user_can( 'moderate_comments' )`. Return `false` to hide the comments segment without touching the JS — e.g. read-only blogs or headless setups that don't moderate comments.

```php
apply_filters( 'openstation_recycle_bin_comments_enabled', bool $on );
```

### `openstation_recycle_bin_items` / `openstation_recycle_bin_item` — Experimental (filter)

`..._item` reshapes a single row before it's returned to JS; `..._items` filters the final list. The `id`, `type`, and `deleted_at` fields are load-bearing — keep them when extending.

```php
apply_filters( 'openstation_recycle_bin_item', array $item, WP_Post $post );
apply_filters( 'openstation_recycle_bin_items', array $items, $query );
```

The second argument of `..._items` is currently always `null` — the bin merges posts, comments, and desktop files into one list, so there is no single underlying `WP_Query`. Do not type-hint the second parameter; it is reserved (`array|null` per the in-code docblock).

### `openstation_recycle_bin_comment_item` — Experimental (filter)

Mirror of `openstation_recycle_bin_item` for trashed comments — reshapes a single comment row before it's returned to JS. The same `id`, `type`, and `deleted_at` fields are load-bearing.

```php
apply_filters( 'openstation_recycle_bin_comment_item', array $item, WP_Comment $comment );
```

### `openstation_recycle_bin_user_can_view|restore|purge|use` — Experimental (filter)

Per-item capability gates. `_use` controls whether the bin window is registered at all for the current user; the others gate individual operations. Defaults: `_use` → `edit_posts`, `_view` → `edit_post`, `_restore`/`_purge` → `delete_post` (the same gate WP itself uses for trash/untrash).

### `openstation_recycle_bin_user_can_view|restore|purge_comment` — Experimental (filter)

Per-comment capability gates — mirrors of the post gates above, each receiving `( bool $can, WP_Comment $comment )`. Unlike the post variants, all three default to `edit_comment` (the WP-native moderation check).

### `openstation_recycle_bin_count` — Experimental (filter)

The total surfaced to the dock/icon badge. `$total` defaults to `$post_count + $comment_count + $files_count` — the trashed-post query (capability-scoped to what the current user can edit), the trashed-comment count (only counted when comments are enabled for the bin), and the desktop-files trash.

```php
apply_filters( 'openstation_recycle_bin_count', int $total, int $post_count, int $comment_count, int $files_count );
```

### `openstation_recycle_bin_window_args` — Experimental (filter)

Tweak the args passed to `openstation_register_window()` for the bin — useful to change dimensions, swap the icon, or drop the dock tile entirely (`'placement' => 'none'`). The bin ships its own silhouette; `openstation_recycle_bin_icon_svg()` returns the raw markup and `openstation_recycle_bin_icon_uris()` returns both states as data URIs, so a plugin substituting its own art has the same pair to replace.

The bin registers **no desktop icon**, so it lands on the dock and nowhere else. That is the default, not the whole story: the window is registered `placeable`, so its row in OpenStation Preferences → Navigation offers the wallpaper, both, or hidden, like any other item.

### `openstation_recycle_bin_template_html` — Experimental (filter)

The full template body before it's emitted into the native-window template element. Keep the `data-os-recycle-bin-*` hooks intact so the JS bundle can find its mount points.

Some are visibility hooks rather than mount points: while the bin is empty the JS hides `[data-os-recycle-bin-toolbar]` and the `<os-table>`, and shows `[data-os-recycle-bin-empty-state]`. Put added toolbar controls inside the toolbar element or they stay visible over an empty bin. A filter or search that matches nothing keeps the toolbar and shows the table's own `empty` text instead; so does a failed load, which swaps that text for a retry message.

### `openstation_recycle_bin_empty_chunk_size` — Experimental (filter)

```php
apply_filters( 'openstation_recycle_bin_empty_chunk_size', int $chunk_size );
```

Per-call cap on `openstation_recycle_bin_empty()` — protects against PHP `max_execution_time` on huge bins. Default `200`. The client iterates while `remaining > 0`, so raising this just means fewer roundtrips per "Empty bin" click. Lower it on shared hosts with tight execution budgets; raise it on dedicated servers handling 10k+ item bins.

### Lifecycle actions

```php
do_action( 'openstation_recycle_bin_item_captured', int $post_id, int $user_id, string $now_gmt );
do_action( 'openstation_recycle_bin_before_restore', int $post_id, WP_Post $post );
do_action( 'openstation_recycle_bin_after_restore',  int $post_id );
do_action( 'openstation_recycle_bin_before_purge',   int $post_id, WP_Post $post );
do_action( 'openstation_recycle_bin_after_purge',    int $post_id, string $type );
do_action( 'openstation_recycle_bin_emptied',        int $purged, int $skipped );

// Comment twins — same lifecycle, keyed by comment id.
do_action( 'openstation_recycle_bin_comment_captured',       int $comment_id, int $user_id, string $now_gmt );
do_action( 'openstation_recycle_bin_before_restore_comment', int $comment_id, WP_Comment $comment );
do_action( 'openstation_recycle_bin_after_restore_comment',  int $comment_id );
do_action( 'openstation_recycle_bin_before_purge_comment',   int $comment_id, WP_Comment $comment );
do_action( 'openstation_recycle_bin_after_purge_comment',    int $comment_id );
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

- `wp.hooks.applyFilters( 'openstation.recycleBin.columns', cols )` — append/replace `<os-table>` columns.
- `document.addEventListener( 'os-recycle-bin-changed', e => …)` — fired after every restore / purge / empty with `{ kind, ok, errors, source }`. `source` is `'local'` (the bin's own action), `'chromeless'` (a delete in another window's iframe), or `'heartbeat'` (a delete elsewhere — other tab, REST, WP-CLI).
- `wp.hooks.doAction( 'openstation.recycleBin.changed', …)` — same payload, hook-bus form.

### Cross-window broadcast

After every restore / purge / empty the bin publishes one topic
**per affected post type** on the shell-wide broadcast bus
(`wp.os.broadcast`). The bin's changelog delegates
into the generic
[content-change realtime layer](#content-change-realtime-layer),
whose chromeless footer emits the same topics for any admin request
that trashed, restored, deleted — or **created / updated** — content.
The recycle bin learns instantly when a list-table trashes
something, list iframes refresh when the bin restores something,
and list windows also refresh when content is saved in
another window.

Topic format: **`os.<type>.changed`** — the literal
post-type slug (`post`, `page`, `attachment`, `comment`, any CPT, or
`shop_order` for WooCommerce orders under both HPOS and legacy
storage). Payload:

```js
{ source: 'recycle-bin' | 'admin' | 'editor' | 'heartbeat' | <plugin>,
  action: 'created' | 'updated' | 'trashed' | 'untrashed' | 'deleted',
  ids:    number[] }
```

`source` values: `'admin'` (server-recorded, chromeless-footer
relay), `'editor'` (block-editor save-watcher), `'heartbeat'` (the
catch-all re-broadcast — note this MAY repeat a change your window
already handled; consumers must treat refreshes as idempotent),
`'recycle-bin'` / `'posts-window'` / plugin names (client-side
emitters identifying themselves for echo suppression).

**Iframe-side default behaviour: soft reload.** The chromeless
bridge installs a built-in subscriber that, when the topic
matches the iframe's current page, *fetches the URL it's already
on* and replaces the contents of `#wpbody-content` in place. The
user sees the list update — restored post appears, trashed media
disappears — without the WP loading spinner that
`location.reload()` would show. Matching is generic: the page's
list type is derived from the URL and compared to the `<type>` in
the topic —

| List page | Reacts to |
|---|---|
| `edit.php` (post type unset / `post`) | `os.post.changed` |
| `edit.php?post_type=<X>` (any CPT) | `os.<X>.changed` |
| `upload.php` | `os.attachment.changed` |
| `edit-comments.php` | `os.comment.changed` |
| `admin.php?page=wc-orders` (HPOS orders list) | `os.shop_order.changed` |

— plus any declarative rule added via the
`openstation_soft_reload_rules` filter (how the `wc-orders` row
above is implemented).

Single-edit pages (`post.php`, `post-new.php`, the HPOS order editor
`admin.php?page=wc-orders&action=edit`) deliberately have
**no** soft-reload handler, because replacing their body would
destroy unsaved editor state. Plugins wanting specific behaviour
for those pages subscribe to the same topic themselves and decide
how to react.

**What survives the swap, and what the bridge re-binds.** The
`#wpbody-content` element itself is kept and only its children are
replaced, so anything delegated on `document`, `body` or
`#wpbody-content` keeps working untouched — that covers wp-lists,
`updates.js`, and Core's select-all checkboxes and row-actions
focus reveal. Handlers bound to elements *inside* it do not
survive, and Core's inline editors are bound that way
(`$( '#the-list' ).on( 'click', '.editinline', … )` and friends).
The bridge therefore re-runs Core's own init entry points after
each swap — `inlineEditPost.init()`, `inlineEditTax.init()`,
`commentReply.init()` — which restores Quick Edit, Bulk Edit and
comment Quick Edit / Reply. Custom list tables that enqueue
`inline-edit-post` get this for free.

Only an init whose every binding lands inside the replaced subtree
is safe to re-run. `setCommentsList()` is not, and is deliberately
left out: it re-runs `wpList`, which binds on `document`, so each
call would stack another set of comment row-action handlers.

If your own code binds to an element inside the list table, bind
it on `document` (best), or re-bind on `os-soft-reloaded`, which
the bridge dispatches on the iframe's `document` after every
successful soft-reload — and after the Core re-init above, so a
listener always sees a working list table.

**Plugin extension.** Subscribers from anywhere (parent shell,
native windows, iframes) can use the bus directly:

```js
wp.os.subscribe( 'os.post.changed', ( payload ) => {
    if ( payload.action === 'untrashed' ) {
        myEditorRedrawSidebar( payload.ids );
    }
} );
```

Iframe-side admin pages subscribe via plain DOM:

```js
document.addEventListener( 'os-broadcast', ( e ) => {
    if ( e.detail.topic !== 'os.post.changed' ) return;
    // your custom handling — fires after the built-in soft reload
} );
```

### Real-time signal

The bin window updates without polling via two channels:

1. **Chromeless `postMessage` (instant).** Whenever a delete fires inside an iframe-rendered admin page (e.g. "Move to Trash" on `post.php`), `realtime.php` emits an inline footer script that posts `{ type: 'os-recycle-bin-changed', ts }` to the parent shell.
2. **Heartbeat (catch-all, ≤15 s).** A delete also bumps `_desktop_mode_recycle_bin_change_ts` (autoload=false). While the bin window is open, its tab enqueues `openstation_recycle_bin_seen_ts` on every Heartbeat tick; the `heartbeat_received` filter answers `{ changed, ts }`. Closed-bin tabs send nothing — zero per-tick cost.

Hook this to push your own real-time channel (websocket, SSE) without re-listening on every delete action:

```php
do_action( 'openstation_recycle_bin_signal', int $ts_ms );
```

Suppress the chromeless footer emit per request:

```php
apply_filters( 'openstation_recycle_bin_emit_footer_signal', bool $emit );
```

See [`docs/examples/recycle-bin.md`](./examples/recycle-bin.md) for end-to-end recipes (custom post types, audit logging, custom columns).

---

## Native Posts window

`<os-table>`-driven native window that replaces the chromeless `edit.php` iframe. **Opt-in Beta** — fresh installs land on the classic iframe; users turn it on via **OpenStation Preferences → Features → Beta features → Use the native Posts window** (persisted as `OsSettingsState.nativePostsEnabled`, default `false`). The dock tile that points at `edit.php` is unchanged — every click path consults the URL → native-window remap registry first and falls back to the iframe on no-match. See [`examples/native-posts.md`](./examples/native-posts.md) for end-to-end recipes.

### `openstation_posts_window_user_can_register` — Stable *(filter)*

Cap-only gate (`edit_posts`) that decides whether the native Posts window is registered for this user at boot. Returning `false` skips the entire registration — no script handle, no template, no entry in the native-window registry — so every click path falls back to the classic chromeless `edit.php` iframe. Deliberately decoupled from the opt-in toggle: registration runs once on `init`, while the toggle is enforced at runtime by the JS-side URL remap, so flipping the OS-Settings flag mid-session never requires an F5.

```php
apply_filters( 'openstation_posts_window_user_can_register', bool $can, int $user_id ): bool
```

Use cases:
- Restrict to `edit_others_posts` on a multi-author site so contributors stay on the iframe.
- Per-user A/B rollouts driven by an external flag store.

### `openstation_posts_window_user_can_use` — Stable *(filter)*

The combined cap-and-opt-in answer: `edit_posts` AND the user has turned the opt-in toggle on. **Informational only** — this filter has no effect on window registration (that's `openstation_posts_window_user_can_register` above) or on the dock-click URL remap (that consults the JS-side `nativePostsEnabled` settings snapshot). Hook it when your own code needs the combined answer (analytics, conditional UI), not to gate the window.

```php
apply_filters( 'openstation_posts_window_user_can_use', bool $can, int $user_id );
```

To keep a user or role on the classic iframe, return `false` from `openstation_posts_window_user_can_register` instead. Note that "force the native window on for everyone" is not possible from either PHP filter — the opt-in lives in the JS-side settings snapshot.

### `openstation_posts_window_args` — Experimental *(filter)*

Args passed to `openstation_register_window( 'desktop-mode-posts', … )`. Customize the title / icon / dimensions, or extend the `config` blob with extra REST URLs the bundle should know about.

```php
apply_filters( 'openstation_posts_window_args', array $args );
```

### `openstation_posts_window_template_html` — Experimental *(filter)*

The full template body before it's `wp_kses`'d into the native-window template element. Keep the `data-os-posts-*` hooks intact so the JS bundle can find its mount points (search input, status segmented, table, bulk bar, pager).

```php
apply_filters( 'openstation_posts_window_template_html', string $html );
```

### `openstation_posts_window_query_args` — Experimental *(filter)*

Default outbound REST query args the bundle merges into every `/wp/v2/posts` request. Drop in `'post_type' => 'product'` to point the window at a CPT, or extend `_fields` to ship more columns. The bundle merges page / per_page / search / status / sort args on top.

```php
apply_filters( 'openstation_posts_window_query_args', array $args );
```

Default args:

```php
[
    '_embed'  => 'author,wp:term,wp:featuredmedia',
    '_fields' => 'id,title,status,date,date_gmt,modified,modified_gmt,author,categories,tags,comment_status,excerpt,openstation_lock,_links,_embedded',
]
```

### JS extension points

Every JS hook below is also documented on `wp.hooks` so plugins can register with priorities + namespaces. Filter signatures match `wp.hooks.applyFilters( name, default, ...args )`.

| Hook | Type | Default | Args / Detail |
|---|---|---|---|
| `openstation.postsWindow.columns` | filter | built-in 5 columns | `OsTableColumn< PostListItem >[]` — append, replace, or remove cells. |
| `openstation.postsWindow.statusSegments` | filter | All / Published / Drafts / Pending / Scheduled / Trash | `StatusSegment[]` — `{ value, label }` pairs. `value` is sent verbatim as `?status=…`; use `''` for "All" (the bundle remaps to `?status=any`). |
| `openstation.postsWindow.bulkActions` | filter | one entry: "Move to trash" | `BulkAction[]` — `{ id, label, icon?, variant?, confirm?, run( ids, ctx ) }`. `confirm` is `string \| ( count: number ) => string`; the function form is the one `_n()` can pluralize. Filter out by id to remove. |
| `openstation.postsWindow.toolbarTrailing` | filter | `[]` | `HTMLElement[]` rendered before Refresh + Add New. Receives the live `PostsWindowContext` as the second arg. |
| `openstation.postsWindow.opened` | action | — | `( ctx: PostsWindowContext )` — fired after the first paint with a populated table. |
| `openstation.postsWindow.dataLoaded` | action | — | `( payload: { items, total, totalPages, page } )` — fired after every successful refresh. |

`PostsWindowContext`: `{ body, table, refresh(), getSelectedIds(), getSelectedRows(), getCurrentParams() }` — see [`src/posts-window/types.ts`](../src/posts-window/types.ts) for the full TypeScript surface.

### CustomEvents (same payloads as the hook-bus actions)

```js
document.addEventListener( 'os-posts-window-opened',      e => /* e.detail = PostsWindowContext */ );
document.addEventListener( 'os-posts-window-data-loaded', e => /* e.detail = { items, total, totalPages, page } */ );
```

### Cross-window broadcast

```js
wp.os.broadcast( 'os.post.changed', {
    source: 'posts-window',
    action: 'trashed',
    ids: number[],
} );
```

Fired after every bulk trash. The recycle bin and any other listener are cross-window subscribers via `wp.os.subscribe`.

### URL → native-window remap registry

Centralized in `src/native-url-remap.ts`. Every code path that opens an admin URL consults `tryNativeUrlRemap()` before falling back to the iframe — dock click, dock constellation, portal deep-link, session restore, Related-entities menu, command palette, `<a href="/wp-admin/…">` anywhere in the shell, and **wallpaper shortcut tiles** (a dock item promoted to the wallpaper points at the same `edit.php`, so it is reachable from two surfaces and both must answer the same way). If you add a surface that turns a URL into a window, it belongs on this list: a path that skips the registry doesn't degrade gracefully, it silently contradicts a preference the user set.

Future native windows (Pages, Media, Users) register themselves with one line:

```js
wp.os.registerNativeUrlRemap( {           // planned public API; internal today — not yet exposed on wp.os
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

## Native Pages window

Reuses the Posts window bundle (the registration passes `mode: 'pages'` on the config blob as the JS-side discriminator) to replace the chromeless `edit.php?post_type=page` iframe — parent column, menu-order default sort, Template column, "Front page" / "Posts page" badges. Per-user opt-in Beta (default `false`) via OpenStation Preferences → Features → Beta features → `nativePagesEnabled`.

### `openstation_pages_window_user_can_register` — Stable *(filter)*

```php
apply_filters( 'openstation_pages_window_user_can_register', bool $can, int $user_id ): bool
```

Cap-only gate (`edit_pages`) that decides whether the native Pages window is registered for this user at boot. Returning `false` skips the entire registration, so every click path falls back to the classic iframe. Decoupled from the opt-in toggle — same register/use split as the Posts window.

### `openstation_pages_window_user_can_use` — Stable *(filter)*

```php
apply_filters( 'openstation_pages_window_user_can_use', bool $can, int $user_id ): bool
```

The combined cap-and-opt-in answer (`edit_pages` AND `nativePagesEnabled`). Informational only — it does not affect registration or the dock-click remap; same semantics as `openstation_posts_window_user_can_use`.

### `openstation_pages_window_args` — Experimental *(filter)*

```php
apply_filters( 'openstation_pages_window_args', array $window_args ): array
```

Filters the args passed to `openstation_register_window( 'desktop-mode-pages', … )` — title, icon, dimensions, `config` blob (including `frontPageId`, `postsPageId`, and the `pageTemplates` label map).

### `openstation_pages_window_template_html` — Experimental *(filter)*

```php
apply_filters( 'openstation_pages_window_template_html', string $html ): string
```

The full template body before it's `wp_kses`'d into the native-window template element. Keep the `data-os-posts-*` hooks intact — the shared bundle reuses the Posts mount points.

### `openstation_pages_window_query_args` — Experimental *(filter)*

```php
apply_filters( 'openstation_pages_window_query_args', array $args ): array
```

Default outbound REST query args the bundle merges into every `/wp/v2/pages` request. Defaults include `orderby=menu_order`, `order=asc`, and a `_fields` whitelist carrying `parent`, `menu_order`, `slug`, `link`, `template`, `openstation_lock`, and `openstation_comment_count` for the Pages-only columns.

### `openstation_pages_window_template_labels` — Experimental *(filter)*

```php
apply_filters( 'openstation_pages_window_template_labels', array $labels ): array
```

The `{ slug: label }` map for the active theme's registered page templates, used by the Template column. The default template is keyed under the empty string (`''`) for parity with core's `/wp/v2/pages` responses. Pages-only — the Posts window has no equivalent.

---

## Native Plugins window

A two-tab native window that replaces the chromeless `plugins.php` (Installed list) and `plugin-install.php` (Browse the .org repo) iframes. **Opt-in Beta** — fresh installs land on the classic iframe; users turn it on via **OpenStation Preferences → Features → Beta features → Use the native Plugins window** (persisted as `OsSettingsState.nativePluginsEnabled`, default `false`). `plugin-editor.php` is intentionally NOT claimed; that surface stays on the existing iframe.

Architecture summary: read paths use Core REST (`/wp/v2/plugins`); admin-only paths (browse / info / reviews / .zip upload) live on `admin-ajax.php` (`wp_ajax_openstation_plugins_*`) so we never need to `require_once ABSPATH . 'wp-admin/…'`. Install-by-slug delegates to Core's existing `wp_ajax_install_plugin` handler. Mutations are followed by `wp.os.refreshMenu()` so the dock repaints live.

### `openstation_plugins_window_user_can_register` — Stable *(filter)*

Cap-only gate (`activate_plugins`) that decides whether the window is registered for this user. Decoupled from the opt-in toggle so flipping the OS-Settings flag mid-session doesn't require an F5.

```php
apply_filters( 'openstation_plugins_window_user_can_register', bool $can, int $user_id ): bool
```

### `openstation_plugins_window_user_can_use` — Stable *(filter)*

Combined cap-and-opt-in. Returns `true` when the user has `activate_plugins` AND has turned `nativePluginsEnabled` on (default `false`).

```php
apply_filters( 'openstation_plugins_window_user_can_use', bool $can, int $user_id ): bool
```

### `openstation_plugins_window_args` — Experimental *(filter)*

Last-mile mutation of the args passed to `openstation_register_window( 'desktop-mode-plugins', … )`. Title, icon, default size, config blob — same shape as the Posts/Users window filter.

### `openstation_plugins_window_template_html` — Experimental *(filter)*

Filters the rendered template HTML before `wp_kses` runs. Keep `data-os-plugins-{root,tabs,installed-host,browse-host,featured-host,flyout}` intact or rename them and update the matching constants in `src/plugins-window/index.ts`.

### `openstation_plugins_window_browse_args` — Stable *(filter)*

Mutates the args passed to `plugins_api( 'query_plugins', … )` from the `wp_ajax_openstation_plugins_browse` handler.

```php
apply_filters( 'openstation_plugins_window_browse_args', array $api_args, array $raw_params ): array
```

`$raw_params` carries the sanitized request: `browse`, `search`, `tag`, `page`, `per_page`. Use this to pin a corporate plugin allow-list, force a specific `tag`, or extend the `fields` payload.

### `openstation_plugins_window_browse_response` — Stable *(filter)*

Mutates the wp.org browse response before it's cached + sent to the client. The payload is `{ plugins: array, info: array }`.

```php
apply_filters( 'openstation_plugins_window_browse_response', array $payload, array $api_args ): array
```

### `openstation_plugins_window_info_response` — Stable *(filter)*

Same pattern for `plugins_api( 'plugin_information', … )`. Lets a plugin amend the description sections, prepend a notice, or splice in an extra screenshot.

```php
apply_filters( 'openstation_plugins_window_info_response', array $payload, string $slug ): array
```

### `openstation_plugins_window_review_parser` — Experimental *(filter)*

Override the default DOMDocument-based parser for the wp.org reviews page. Return an array of `{ author, stars, excerpt, date, url }` items to short-circuit the default parser. Return `null` to fall through to the built-in DOM parsing.

```php
apply_filters( 'openstation_plugins_window_review_parser', array|null $items, string $slug ): array|null
```

The use case: wp.org HTML changes occasionally. A plugin author who maintains a more robust parser (or who has access to a private reviews API) can swap in their own implementation without forking the upstream.

### `openstation_plugins_window_icon_url` — Experimental *(filter)*

Filter the resolved card icon URL for an installed plugin row. Return `null` to suppress (forces the placeholder); return a different URL to override (useful for premium plugins shipping a known asset URL).

```php
apply_filters( 'openstation_plugins_window_icon_url', string|null $url, string $slug, array $row ): string|null
```

The default URL is resolved in priority:

1. **Local file** — if the plugin's own folder ships an icon at `assets/icon.svg`, `assets/icon-256x256.png`, `assets/icon-128x128.png`, or the same names at the folder root, and also with the file extension includes jpg and jpeg, the `plugins_url()` for that file is used. This is what makes premium / internal / native-bundled plugins (not on the .org repo) display their own art without any plugin-side wiring.
2. **The directory's own `icons` map** — whatever wp.org returned for this plugin, cached in the `update_plugins` transient, read `svg` → `2x` → `1x` exactly as core's "Add Plugins" cards read it. Used verbatim, `?rev=` cache-buster included. `default` (wp.org's generated geopattern for plugins that uploaded no art) is skipped — and because that map is wp.org stating the plugin has no art, the field returns `null` rather than falling through to step 3, so the placeholder paints without a wasted request.
3. **Guessed wp.org SVN asset** — `https://ps.w.org/<slug>/assets/icon.svg`, for when that metadata isn't cached. `<slug>` is the directory slug when known, else the folder name, else the textdomain. Guessing is last because both halves are unknowable: the format (Gutenberg and UpdraftPlus ship JPEG only) and the slug (`hello.php` is listed as `hello-dolly`). The JS card walks a candidate chain (SVG → 256 PNG/JPG/JPEG/GIF → 128 PNG/JPG/JPEG/GIF) on `<img>` error for URLs of exactly this shape, then drops to the placeholder. Local, `icons`-map and custom URLs are one-shot, then placeholder.

### `openstation_plugins_window_local_icon_candidates` — Experimental *(filter)*

Filter the ordered list of relative paths probed inside an installed plugin's folder when looking for a card icon. The first existing file wins; later entries are ignored. Use this to support a non-standard icon convention (e.g. `branding/logo.svg`, `icon@2x.svg`) without forking the resolver.

```php
apply_filters( 'openstation_plugins_window_local_icon_candidates', string[] $candidates, string $folder ): string[]
```

```php
add_filter(
    'openstation_plugins_window_local_icon_candidates',
    static function ( $candidates ) {
        $candidates[] = 'branding/logo.svg';
        return $candidates;
    }
);
```

### `openstation_plugins_window_refresh_updates` — Stable *(filter)*

Short-circuit the lazy refresh of the `update_plugins` site transient that runs on the first row of every REST plugins collection. Core only refreshes that transient on `load-plugins.php` / `load-update-core.php` / cron — REST is not on that list — so without this hop the Plugins window can show "no updates" while the dock badge (computed off `$menu`) reports pending updates. The refresh inherits Core's own 12h throttle (`_maybe_update_plugins()`), so the steady-state cost is a single transient read per request.

```php
apply_filters( 'openstation_plugins_window_refresh_updates', bool $refresh, bool $force ): bool
```

Return `false` to skip the refresh — useful for hosts that run their own update orchestration (managed WordPress, internal mirrors) and don't want REST hits to potentially trigger a wp.org HTTPS check. The filter is also called on the explicit force-refresh path (when the in-window Refresh button passes `?openstation_force_refresh=1`); returning `false` there keeps the no-network posture even on user-initiated refreshes. Inspect `$force` to apply different policies for opportunistic vs. user-initiated refreshes.

### `openstation_plugins_window_auto_updates_enabled` — Experimental *(filter)*

Whether the Plugins window's "Automatic Updates" column should be shown to the current user. Mirrors Core's `WP_Plugins_List_Table::$show_autoupdates` gate (`wp_is_auto_update_enabled_for_type( 'plugin' )` + `update_plugins` cap + network-admin on multisite). Return `false` to suppress the column entirely — useful for managed-hosting environments that orchestrate auto-updates externally and don't want users toggling per-plugin state from within the shell.

```php
apply_filters( 'openstation_plugins_window_auto_updates_enabled', bool $enabled, int $user_id ): bool
```

The flag is surfaced to the JS bundle on the window's `config` blob as `autoUpdatesEnabled` and consumed at column-build time — flipping it via the filter takes effect on the next reload of the window.

### REST-field decorators on `/wp/v2/plugins` — Stable

Server-injected enrichment fields. The JS reads them on every list paint:

| Field | Shape | What it carries |
|---|---|---|
| `openstation_update_available` | `{ available: bool, new_version: string\|null, package: string, slug: string }` | Pending wp.org update for this row, derived from `get_site_transient( 'update_plugins' )`. The transient is lazily refreshed at REST-time (subject to Core's 12h throttle, and the `openstation_plugins_window_refresh_updates` filter) so the window stays in sync with the dock update badge. The in-window Refresh button can bypass the 12h throttle by adding `?openstation_force_refresh=1` to the REST request — Core's `wp_clean_plugins_cache( true )` then deletes the transient and fans out to api.wordpress.org, mirroring what classic `plugins.php` does on load. `package` carries the download URL (empty for plugins without a wp.org zip — the JS surfaces the same "Auto-update unavailable" fallback Core renders); `slug` is what `wp_ajax_update_plugin` echoes back in its event payload. |
| `openstation_can_manage` | `{ activate, deactivate, delete: bool }` | Per-row capability flags so the JS doesn't re-derive caps. Server still re-validates every mutation. |
| `openstation_wporg_slug` | `string\|null` | The plugin's slug on the WordPress.org directory or `null` if hosted elsewhere. |
| `openstation_icon_url` | `string\|null` | Best-effort card icon URL. Prefers a local file under the plugin's folder (`assets/icon.svg` and a handful of variants — see [`openstation_plugins_window_local_icon_candidates`](#openstation_plugins_window_local_icon_candidates--experimental-filter)), then the `icons` map wp.org returned for the plugin (cached in the `update_plugins` transient, read `svg` → `2x` → `1x` exactly as core's Add Plugins cards do), and only then guesses `https://ps.w.org/<slug>/assets/icon.svg`. A non-null value is not a "listed on wp.org" signal — the last step is a guess that 404s to a placeholder for plugins that aren't on the directory; `openstation_wporg_slug` is that signal. Filterable via `openstation_plugins_window_icon_url`. |
| `openstation_size_kb` | `int\|null` | Disk footprint of the plugin folder in kilobytes. Cached 6h. |
| `openstation_auto_update` | `{ enabled: bool, forced: bool\|null, supported: bool }` | Per-row auto-update state, mirroring Core's "Automatic Updates" column on `plugins.php`. `enabled` reflects the `auto_update_plugins` site option (overridden by `forced` when a filter pins it). `forced` is `null` for user-toggleable rows, `true`/`false` when the `auto_update_plugin` filter has pinned the state. `supported` is true when the `update_plugins` transient has an entry for the plugin (either `response` or `no_update`); when false the JS hides the toggle — premium / private plugins that never check in with wp.org. The toggle itself routes through Core's `wp_ajax_toggle_auto_updates` handler (action `toggle-auto-updates`, `'updates'` nonce). |

### Actions — Stable

```php
do_action( 'openstation_plugins_window_installed', string $plugin_file );
```

Fires after the upload-AJAX handler installs a plugin from an uploaded .zip. `$plugin_file` is the resolved plugin file (e.g. `"akismet/akismet.php"`). Hook this to seed default settings for first-install plugins, send an audit-log entry, or chain a network-wide deploy.

### `openstation_plugins_featured_slugs` — Experimental *(filter)*

The Plugins window's third tab — "OpenStation plugins" — leads with a hand-curated list because wp.org's `plugins_api` does not yet expose a usable `requires_plugins` filter. The handler hydrates each curated slug through `plugins_api( 'plugin_information' )` so card metadata stays fresh; it then scans the wp.org popular feed for rows whose `requires_plugins` array contains `openstation` and appends them after the curated entries.

Use this filter to append your own companion plugins (or remove the default seed). Order is preserved — the first slug renders first in the gallery. Output is run through `sanitize_key()` and deduplicated.

```php
apply_filters( 'openstation_plugins_featured_slugs', string[] $slugs ): string[]
```

```php
add_filter( 'openstation_plugins_featured_slugs', static function ( $slugs ) {
    $slugs[] = 'my-companion-plugin';
    return $slugs;
} );
```

**Cache scope caveat.** The Featured tab response is cached in a single site-wide transient (`dm_pwfeatured_v1`, 1h TTL) — the cache key does not vary by user or role. If your filter returns role-specific or capability-specific slugs (e.g. surfacing a premium plugin only to administrators), the first viewer's payload will be served to every viewer for the cache window. Either keep the curated list cap-agnostic, or use `openstation_plugins_featured_response` to drop disallowed rows for the current viewer *after* the shared payload is composed (you'd lose the cache hit benefit per user, but no leak).

### `openstation_plugins_featured_response` — Experimental *(filter)*

Last hop before the Featured tab payload is cached (1h transient) and sent to the client. Inject premium / private rows that aren't on wp.org, or enforce a hard cap on the response.

```php
apply_filters( 'openstation_plugins_featured_response', array $payload, array $curated ): array
```

`$payload` shape: `{ plugins: [ … ], info: { curated: int, discovered: int, results: int } }`. Each entry in `plugins` matches the `plugins_api( 'query_plugins' )` row shape plus a boolean `featured` (true for curated, false for auto-discovered).

---

## Native Comments window

Replaces the chromeless `edit-comments.php` iframe with a moderation queue native window: Pending / All / Spam / Trash / Mine tabs, bulk approve / spam / trash with an 8-second undo, inline reply editor, keyboard moderation (`j/k/a/s/d/r/e/u/?`), spam-confidence chip per row, author-insights drawer.

Per-user opt-in Beta (default `false`) via OpenStation Preferences → Features → Beta features → `nativeCommentsEnabled`. URL remap claims `edit-comments.php`; `comment.php?action=editcomment&c=…` still falls through to the chromeless iframe path.

### `openstation_comments_window_user_can_register` — Stable *(filter)*

```php
apply_filters( 'openstation_comments_window_user_can_register', bool $can, int $user_id ): bool
```

Whether the window should be registered for `$user_id`. Default: `user_can( $user_id, 'edit_posts' )`.

### `openstation_comments_window_user_can_use` — Stable *(filter)*

```php
apply_filters( 'openstation_comments_window_user_can_use', bool $can, int $user_id ): bool
```

Combined cap-and-opt-in check. Hooks here override the default ("can register AND the user toggled `nativeCommentsEnabled` on").

### `openstation_comments_window_args` — Experimental *(filter)*

```php
apply_filters( 'openstation_comments_window_args', array $window_args ): array
```

Filters the args passed to `openstation_register_window()` for the Comments window — title, icon, dimensions, `config` blob. The `config` keys are the bundle's source of truth; treat the shape as Experimental.

### `openstation_comments_window_template_html` — Experimental *(filter)*

```php
apply_filters( 'openstation_comments_window_template_html', string $html ): string
```

Filters the rendered template body. The output is run through `openstation_kses_native_window_template()` after this filter, so unsafe HTML is dropped regardless.

### `openstation_comments_window_query_args` — Experimental *(filter)*

```php
apply_filters( 'openstation_comments_window_query_args', array $args ): array
```

Filters the outbound `wp/v2/comments` query args the bundle uses for its first list paint. Use to whitelist additional `_fields`, override `per_page`, or scope the default tab.

### `openstation_comments_window_spam_score` — Experimental *(filter)*

```php
apply_filters( 'openstation_comments_window_spam_score', int $score, WP_Comment $comment ): int
```

Filters the 0–100 spam-confidence score the bundle paints per row. Hook here to plug in an AI-provider fallback when Akismet isn't installed but a OpenStation AI provider is configured. Return value is clamped to `0..100`.

### `openstation_comments_window_reply_editor` — Experimental *(filter)*

```php
apply_filters( 'openstation_comments_window_reply_editor', string $editor, int $user_id ): string
```

Selects the inline-reply editor flavor — `'rich'` (default contenteditable rich editor), `'plain'` (textarea), or `'gutenberg'` (planned — currently falls back to `'rich'`).

### `openstation_comments_window_after_bulk` — Stable *(action)*

```php
do_action( 'openstation_comments_window_after_bulk', string $action, int[] $processed, int[] $skipped );
```

Fires after `/desktop-mode/v1/comments/bulk` finishes a batch. `$action` is one of `approve|unapprove|spam|unspam|trash|untrash`. `$processed` is the list of ids successfully acted on; `$skipped` is the list that failed a per-target cap or soft error.

### `openstation_comments_ai_is_enabled` — Experimental *(filter)*

```php
apply_filters( 'openstation_comments_ai_is_enabled', bool $enabled ): bool
```

Whether AI moderation for new comments is enabled. Site-wide, not per-user — hooks here override the `desktop_mode_comments_ai_moderation` site option, which is useful for gating by environment (staging vs. production) or by feature flag.

### `openstation_comments_ai_toggled` — Experimental *(action)*

```php
do_action( 'openstation_comments_ai_toggled', bool $enabled );
```

Fires after the Comments AI moderation toggle is changed via `POST /desktop-mode/v1/comments/ai-settings`. `$enabled` is the new state.

---

## Native Users window

Reuses the Posts window bundle (`mode: 'users'` config discriminator) to replace the chromeless `users.php` iframe: role filter, bulk role change / delete / remove, "Add new user" form, per-row quick actions, and a Profile tab. Per-user opt-in Beta (default `false`) via OpenStation Preferences → Features → Beta features → `nativeUsersEnabled`. UI-side gating is UX polish only — the REST routes re-validate every capability and per-target permission before mutating anything.

### `openstation_users_window_user_can_register` — Stable *(filter)*

```php
apply_filters( 'openstation_users_window_user_can_register', bool $can, int $user_id ): bool
```

Cap-only gate (`list_users`) that decides whether the native Users window is registered for this user at boot. Returning `false` skips the entire registration. Decoupled from the opt-in toggle — same register/use split as the Posts window.

### `openstation_users_window_user_can_use` — Stable *(filter)*

```php
apply_filters( 'openstation_users_window_user_can_use', bool $can, int $user_id ): bool
```

The combined cap-and-opt-in answer (`list_users` AND `nativeUsersEnabled`). Informational only — it does not affect registration or the dock-click remap; same semantics as `openstation_posts_window_user_can_use`.

### `openstation_users_window_assignable_roles` — Experimental *(filter)*

```php
apply_filters( 'openstation_users_window_assignable_roles', string[] $slugs, int $viewer_id, int $target_id ): string[]
```

The role slugs `$viewer_id` may assign to `$target_id`. Default: the keys of core's `get_editable_roles()` evaluated from the viewer's perspective (empty when the viewer lacks `promote_users`). Use it to LOCK DOWN role assignment further — e.g. "site managers can't promote anyone to administrator". Returning an empty array fully disables role mutation for the viewer. Returning a superset widens the REST endpoints too — both the bulk-role route and the create-user route validate the requested role against this same filtered list, so only add roles you genuinely intend to make assignable.

### `openstation_users_window_args` — Experimental *(filter)*

```php
apply_filters( 'openstation_users_window_args', array $window_args ): array
```

Filters the args passed to `openstation_register_window( 'desktop-mode-users', … )` — title, icon, dimensions, `config` blob (capability flags, role maps, locale map, REST mutation routes).

### `openstation_users_window_template_html` — Experimental *(filter)*

```php
apply_filters( 'openstation_users_window_template_html', string $html ): string
```

The full template body before it's `wp_kses`'d into the native-window template element.

### `openstation_users_window_query_args` — Experimental *(filter)*

```php
apply_filters( 'openstation_users_window_query_args', array $args ): array
```

Default outbound REST query args the bundle merges into every `/wp/v2/users` request. Defaults ship a `_fields` whitelist (including the `openstation_user_stats`, `openstation_last_login`, `openstation_presence`, `openstation_can_edit`, and `openstation_assignable_roles` REST fields), `context=edit` (required for `email` / `roles` / `registered_date` to appear at all), and `per_page=20`.

### `openstation_users_window_user_created` — Stable *(action)*

```php
do_action( 'openstation_users_window_user_created', int $user_id, WP_User $user, array $args );
```

Fires after the Users window's create-user REST route has created a new account (and queued the optional notification email). `$args` is the sanitized `wp_insert_user()` arg array used for creation.

### `openstation_users_window_login_recorded` — Stable *(action)*

```php
do_action( 'openstation_users_window_login_recorded', int $user_id, int $timestamp );
```

Fires on `wp_login` after the last-login user meta has been written — piggy-back here to update your own last-seen tracking without duplicating the `wp_login` listener.

---

## Native User Edit window

A native profile-editing window (`desktop-mode-user-edit`) that opens when a row in the native Users window is clicked, or when a chromeless `user-edit.php?user_id=N` navigation is remapped. The window is registered for any logged-in user (everyone has a profile to edit); per-target capability is re-checked at REST time — saving uses core's `/wp/v2/users/<id>` PUT, which enforces `edit_user`, and the insights endpoint applies the same check.

### `openstation_user_edit_window_user_can_register` — Experimental *(filter)*

```php
apply_filters( 'openstation_user_edit_window_user_can_register', bool $can, int $user_id ): bool
```

Fires inside the `openstation_user_edit_window_user_can_register()` helper. Default: `true` for any logged-in user. The framework's own registration path consults this helper — returning `false` from the filter skips registering the window entirely.

### `openstation_user_edit_window_args` — Experimental *(filter)*

```php
apply_filters( 'openstation_user_edit_window_args', array $window_args ): array
```

Filters the args passed to `openstation_register_window( 'desktop-mode-user-edit', … )` — title, icon, dimensions, `config` blob (role / locale / color-scheme maps, contact methods, insights endpoint base).

### `openstation_user_edit_window_template_html` — Experimental *(filter)*

```php
apply_filters( 'openstation_user_edit_window_template_html', string $html ): string
```

The template body (a `<os-user-profile>` host element) before it's `wp_kses`'d into the native-window template element.

### `openstation_user_edit_window_insights` — Experimental *(filter)*

```php
apply_filters( 'openstation_user_edit_window_insights', array $payload, WP_User $user ): array
```

The per-user insights payload returned by `GET /desktop-mode/v1/users/<id>/insights` — drives the profile sidebar tiles. Plugins can append their own metrics (security-event counts, subscription tier, …) by extending the `stats` map or adding new top-level keys; the JS bundle tolerates unknown keys. **The filtered output is transient-cached for 60 seconds** (`dm_user_insights_<id>`), so make the filter deterministic — a request with `?fresh=1` bypasses the cache.

---

## WP Explorer

A pinned virtual folder on the wallpaper that opens a native file-explorer window for browsing WordPress entities. Ships with Posts, Pages, Users, and Media. The entity list is filterable so plugin authors can extend it without forking the bundle.

The window and its pinned icon are **titled "WP Explorer"**. Its *root folder* is named after the site — whatever [`openstation_site_title()`](#openstation_site_title--experimental) returns, defaulting to `get_bloginfo( 'name' )` — which also seeds the breadcrumb root and the "Open in &lt;site&gt;" actions in the media detail pane and the Corkboard. The module directory, window id (`desktop-mode-my-wordpress`), REST fields, and every hook below keep the `my_wordpress` slug.

### `openstation_my_wordpress_user_can_use` — Experimental (filter)

```php
apply_filters( 'openstation_my_wordpress_user_can_use', bool $can ): bool
```

Gates icon registration and window registration in one shot. Default `current_user_can( 'edit_posts' )`. Return `false` to hide the entry point for a role; return `true` to opt a role back in.

### `openstation_my_wordpress_window_args` / `openstation_my_wordpress_icon_args` — Experimental (filter)

Tweak the args passed to `openstation_register_window()` / `openstation_register_icon()` for WP Explorer — useful to change dimensions, swap the icon, or remove the `pinned` flag so the icon participates in the normal sort order. Retitling the window here retitles the app; to rename the *root folder* the window opens on, filter [`openstation_site_title`](#openstation_site_title--experimental) instead, which also covers the breadcrumb root and the cross-window "Open in &lt;site&gt;" actions.

### `openstation_my_wordpress_entities` — Experimental (filter)

```php
apply_filters( 'openstation_my_wordpress_entities', array[] $entities ): array[]
```

The list of entity types rendered as folder tiles in the window's root view. Each entry must declare:

- `id` — slug, used in the route hash and tile `data-entity-id`.
- `label` — human-readable folder name.
- `icon` — Dashicons class.
- `restPath` — appended to `restRoot` (e.g. `wp/v2/posts`, `wp/v2/comments`).
- `post_type` *(optional)* — WP post-type slug used to build the cross-window broadcast topic `os.<slug>.changed`. Omit for entities without trash/restore support (e.g. Users). CPT entities registered via this filter should set `post_type` so list views refresh reactively on trash/restore.
- `kind` *(optional)* — `'post'` (default for back-compat), `'user'`, or `'media'`. Drives the in-window render path: `'post'`-shaped entities use the title/excerpt/featured-image tile + rendered-HTML preview; `'user'`-shaped entities use the avatar-tile, the dossier preview, and the activity-footprint surface; `'media'`-shaped entities use the media-grid tile and the media drill-in preview ("used in" view). Omit the field to inherit the post path — works for any REST collection that ships `title.rendered` + `content.rendered`. Plugins can register further kinds on the JS side via `wp.os.myWordpress.registerEntityKind()`.
- `listQuery` *(optional)* — extra query parameters sent with this section's list requests, as `key => value`. Lets a server-side query filter scope itself to the site window instead of rewriting every REST caller's query — `rest_product_query` fires for the Product Collection block too, so the WooCommerce sections mark their own requests rather than reordering everyone's.
- `listFields` *(optional)* — extra REST field names to request for this section's rows, on list **and** detail requests. The window sends an explicit `_fields` list, so a custom key your endpoint returns is stripped before the bundle sees it unless it's named here. Used by the WooCommerce sections to carry the order status and product stock their tiles are banded and badged by.
- `thumbnails` *(optional)* — `false` keeps the section icon on every tile. Defaults to on: a `'post'`-kind entry that has a featured image renders it in place of the icon (the list request already asks for `_embed=wp:featuredmedia`, so this costs no extra round trip). Entries without one fall back to `icon`.
- `editAction` *(optional)* — who edits this section's rows. A preview-action **id** (declared via [`openstation_my_wordpress_preview_actions`](#openstation_my_wordpress_preview_actions--experimental-filter), so it stays capability-gated and its script auto-enqueues) replaces "Open in editor" at every edit surface: the pane's primary button, the context menu's open entry (and its bulk fan-out — the action's `onSelect( ctx )` runs once per selected item), and tile double-click. The named action stops rendering in the generic action row/menu. If it didn't ship for this user or no JS wired its `onSelect`, the edit affordances hide rather than fall back — for a type without an editor screen, the classic URL is known-broken. **`false`** removes every edit affordance; double-click falls back to the detail dossier and the bulk "Edit…" modal is suppressed (a *string* keeps that modal: it PATCHes over REST and doesn't involve the classic editor). Omit for the classic editor, where a row-supplied `editUrl` field still wins when present.
- `group` *(optional)* — id of the root-level folder this section nests under. Sections sharing a group id collapse into one folder tile at the root that drills into its members. Omit or pass `null` to render the section loose at the root next to Posts and Pages.
- `groupLabel` / `groupIcon` / `groupOrder` *(optional)* — folder label, icon, and sort weight. Every member of a group should carry the same values; the first entry seen wins.

Defaults ship `posts`, `pages`, `users`, and `media`, followed by one section per eligible custom post type (see [`openstation_my_wordpress_post_types`](#openstation_my_wordpress_post_types--experimental)). Plugins can pre-stage Comments / Tags / Categories without waiting for new code in this module — the bundle treats every entry uniformly.

### `openstation_my_wordpress_post_types` — Experimental (filter)

```php
apply_filters( 'openstation_my_wordpress_post_types', string[] $slugs ): string[]
```

Post type slugs rendered as sections. The default set is every post type that is **not** a Core builtin, declares `show_ui => true`, and whose `cap->edit_posts` the current user holds — so `post` / `page` / `attachment` (already root sections) and editor infrastructure (`wp_block`, `wp_template`, `wp_navigation`) are excluded, as are internal bookkeeping types.

The capability check has already run by the time this filter fires, so anything still in the array is editable by the current user. Adding a slug that is neither `show_in_rest` nor bridged produces a folder with no working endpoint.

### `openstation_my_wordpress_post_type_entity` — Experimental (filter)

```php
apply_filters( 'openstation_my_wordpress_post_type_entity', array $entity, WP_Post_Type $post_type ): array
```

The descriptor built for a single post type, before it is appended to `openstation_my_wordpress_entities`. Same field contract as an entry in that filter.

### `openstation_my_wordpress_post_type_rest_enabled` — Experimental (filter)

```php
apply_filters( 'openstation_my_wordpress_post_type_rest_enabled', bool $enabled, string $post_type ): bool
```

Whether a post type registered with `show_in_rest => false` may be re-exposed on the OpenStation bridge route `desktop-mode/v1/post-type/<slug>` so the site window can browse it.

Defaults to `true` for non-builtin `show_ui` types. The bridge is **read-and-trash only** (`GET` collection, `GET` item, `DELETE` item — no create or update) and requires the type's `edit_posts` capability in every context, never public. Return `false` to keep a type off the REST API entirely; the section then disappears from the window rather than rendering a folder that cannot open.

### `openstation_my_wordpress_post_type_group` — Experimental (filter)

```php
apply_filters( 'openstation_my_wordpress_post_type_group', array|null $group, string $post_type ): array|null
```

The root-level folder a post type belongs to, resolved from the file that called `register_post_type()`:

| Registrant location | Group id | Label |
|---|---|---|
| `WP_PLUGIN_DIR/<folder>/…` | `plugin:<folder>` | the plugin's `Plugin Name` header |
| `WPMU_PLUGIN_DIR/…` | `mu-plugin:<slug>` | the mu-plugin's `Plugin Name` header |
| a theme root | `theme:<stylesheet>` | the theme's `Name` |
| anything else | `null` | — renders loose at the root |

Return `null` to pull a type out of its folder, or a descriptor (`id`, `label`, `icon`, `order`) to override the attribution — useful for a suite of plugins that should share one folder.

### `openstation_my_wordpress_post_type_groups` — Experimental (filter)

```php
apply_filters( 'openstation_my_wordpress_post_type_groups', array[] $groups, array[] $entities ): array[]
```

The ordered folder list shipped to the bundle, deduped from the entity descriptors and sorted by `order` then label. Removing an entry does not hide its post types — they fall back to rendering loose at the root. To move a type between folders, use `openstation_my_wordpress_post_type_group` instead.

### WooCommerce integration — Experimental (filters)

Active only when WooCommerce is. See
[Plugin compat layer](./plugin-compat-layer.md#the-site-window-side-woocommerce)
for what the integration does and why.

Every filter here is Experimental. The integration is young and its
payload shapes are still moving, so treat the argument lists as
liable to grow. Index, in the order they are documented below:

| Filter | Shapes |
|---|---|
| `openstation_my_wordpress_woo_order_args` | the `wc_get_orders()` args behind the Orders section |
| `openstation_my_wordpress_woo_summary` | the merchant summary rendered in the right pane |
| `openstation_my_wordpress_woo_summary_type` | the summary payload for a type the plugin doesn't know |
| `openstation_my_wordpress_woo_summary_capability` | who may read a summary of that type |
| `openstation_my_wordpress_woo_store` | the store headline numbers on the Woo folder |
| `openstation_my_wordpress_woo_order_bands` | the status bands the Orders section groups by |
| `openstation_my_wordpress_woo_product_bands` | the stock / category bands the Products section groups by |
| `openstation_my_wordpress_woo_coupon_bands` | the bands the Coupons section groups by |
| `openstation_my_wordpress_woo_section_icons` | post type slug to dashicon for the Woo sections |
| `openstation_my_wordpress_woo_customer_spend_map` | the per-customer order aggregate the Customers section is built from |
| `openstation_my_wordpress_woo_customer_bands` | the bands the Customers section groups by |
| `openstation_my_wordpress_woo_customer_band` | which band one aggregate lands in |
| `openstation_my_wordpress_woo_vip_threshold` | the spend a customer clears to count as VIP |
| `openstation_my_wordpress_woo_customer_lapse_days` | how long since the last order counts as lapsed |
| `openstation_my_wordpress_woo_customer_ids` | the candidate set the Customers section draws from |
| `openstation_my_wordpress_woo_customer_query_args` | the `WP_User_Query` args behind the customers route |
| `openstation_my_wordpress_woo_customer_facts` | the fact payload carried on every customer row |
| `openstation_my_wordpress_woo_customer_window_template_html` | the Customer window's static template body |
| `openstation_my_wordpress_woo_customer_window_args` | the Customer window's registration args |

```php
apply_filters( 'openstation_my_wordpress_woo_order_args', array $args, WP_REST_Request $request ): array
```

`wc_get_orders()` args for the site window's Orders section. Defaults
to every registered order status, newest first, so the folder count
matches WooCommerce's own Orders screen.

```php
apply_filters( 'openstation_my_wordpress_woo_summary', array $data, string $type, int $id ): array
```

The merchant summary rendered in the right pane. `$type` is one of
`product`, `order`, `coupon`, `customer`. Add keys and the bundle
ignores them — paint them yourself by also subscribing to
[`os.my-wordpress.preview-extras`](./javascript-reference.md#action--openstationmy-wordpresspreview-extras).

```php
apply_filters( 'openstation_my_wordpress_woo_summary_type', array|null $data, string $type, int $id ): array|null
apply_filters( 'openstation_my_wordpress_woo_summary_capability', true|WP_Error|null $allowed, string $type, int $id ): true|WP_Error|null
```

Add a whole new summary type to `GET
desktop-mode/v1/woocommerce/summary/<type>/<id>` — a subscription, a
booking, a membership. The route is the one place the site window asks
"tell me about this shop object", so joining here means a new object
type needs neither its own endpoint nor its own client transport.

Return `null` from the first filter (the default) to leave the type
unknown, which answers 400. Whatever you return then passes through
`openstation_my_wordpress_woo_summary` like the built-in types do.

**Answer the capability filter too.** Without it your type inherits a
`current_user_can( 'edit_post', $id )` check, which is meaningless for
an id that isn't a post — and, where post and user ids collide, wrong.
Return `true` to allow or a `WP_Error` to deny; `null` falls through
to the post check.

The built-in `customer` type is the first consumer of both.

```php
apply_filters( 'openstation_my_wordpress_woo_store', array $data ): array
```

The store headline numbers shown on the Woo folder — revenue this
month, orders awaiting action, out-of-stock count, and (for a viewer
with customer access) the customer count, the VIP / lapsed split, and
guest-checkout revenue.

```php
apply_filters( 'openstation_my_wordpress_woo_order_bands', array[] $bands ): array[]
```

The status bands the Orders section groups tiles into, ordered so the
ones a merchant must act on come first. Each entry declares `id`,
`label`, `order` (lower renders first), and `statuses` — WooCommerce
status slugs **without** the `wc-` prefix. Keep a catch-all with no
statuses last; it collects anything no other band claims.

```php
apply_filters( 'openstation_my_wordpress_woo_product_bands', array[] $bands ): array[]
```

The bands the Products section groups tiles into: out-of-stock and
backorder first, then one band per `product_cat` term, then an
uncategorised catch-all. Each entry declares `id`, `label`, `order`,
and one matcher — `stock` (a stock-status slug) or `category` (a term
slug). Stock bands win over category bands, so an empty shelf surfaces
wherever the product is filed.

```php
apply_filters( 'openstation_my_wordpress_woo_coupon_bands', array[] $bands ): array[]
```

The bands the Coupons section groups tiles into, ordered so the codes
still worth handing out come first: `coupon:active`,
`coupon:expiring`, `coupon:used-up`, `coupon:expired`. Each entry
declares `id`, `label`, `order`, and an optional `tone` (`warn` on
expiring, `danger` on a code that has hit its usage limit).

Membership is not filterable, unlike the customer bands: a coupon is
expiring within 30 days of its expiry date, used-up once its usage
count reaches its usage limit, and expired once the date has passed.

```php
apply_filters( 'openstation_my_wordpress_woo_section_icons', array $icons ): array
```

Post type slug → dashicon class for the WooCommerce sections. These
types are submenu entries under the WooCommerce menu, so they carry no
`menu_icon` of their own and would otherwise fall back to the generic
post pin.

#### Customers

The **Customers** section renders through the built-in `user` entity
kind — avatar tiles, the dossier preview, the footprint route, the
drag-out seam — with a `openstation_woo_customer` payload on every row
carrying lifetime spend, order count, average order value, first and
last order, days since the last one, and the band that summarises all
of it. The same field is registered on the core `user` REST resource,
so the built-in Users section (and any plugin reading `/wp/v2/users`)
gets it for free.

Who appears: every user who has placed a paid order, plus every user
holding the `customer` role. Guests have no account to render — their
revenue is reported on the folder's Store panel instead of being
dropped.

Access needs **both** order access and `list_users`. An editor has
neither.

```php
apply_filters( 'openstation_my_wordpress_woo_customer_spend_map', array $map ): array
```

The per-customer order aggregate the whole section is built from —
band definitions, band ordering, per-row facts and folder counts all
read this one map, gathered in a single grouped query over the order
store (HPOS or legacy) and cached for five minutes.

Keyed by user id; `0` is the guest aggregate. Each value is
`array( 'orders' => int, 'spend' => float, 'first' => gmt datetime,
'last' => gmt datetime )`. A store that keeps order money somewhere
else — a subscriptions plugin, a marketplace split — can rewrite the
whole map here and every band, tile and panel follows.

```php
apply_filters( 'openstation_my_wordpress_woo_customer_bands', array[] $bands ): array[]
apply_filters( 'openstation_my_wordpress_woo_customer_band', string $band, array $stats ): string
```

The bands the Customers section groups by, and which one a given
aggregate lands in. Defaults, in render order: `vip`, `lapsed`,
`repeat`, `new`, `none` — the two a merchant can act on first.

The definitions filter only names and orders the bands; changing a
membership rule means filtering `..._customer_band` as well. A band id
the definitions don't declare is parked under `none` rather than
dropped, because a customer missing from the list is worse than one in
an unexpected group.

```php
apply_filters( 'openstation_my_wordpress_woo_vip_threshold', float $threshold, float $aov ): float
apply_filters( 'openstation_my_wordpress_woo_customer_lapse_days', int $days ): int
```

The two numbers the default banding turns on. The VIP threshold is
derived rather than fixed — three times the store's average order
value — because "spent over 500" means nothing without knowing whether
the store sells postcards or pianos. A store with no paid orders has an
average of zero, and a zero threshold promotes nobody.

The lapse window defaults to 180 days and is floored at 1.

```php
apply_filters( 'openstation_my_wordpress_woo_customer_ids', array $ids ): array
apply_filters( 'openstation_my_wordpress_woo_customer_query_args', array $args, WP_REST_Request $request ): array
apply_filters( 'openstation_my_wordpress_woo_customer_facts', array $facts, int $user_id ): array
```

The candidate set, the `WP_User_Query` args behind
`GET desktop-mode/v1/woocommerce/customers`, and the compact fact
payload carried on every row. `number` and `paged` are set by the
paginator and will be overwritten.

Past `OPENSTATION_WOO_MAX_ORDERED_CUSTOMERS` (5000) candidates the
section stops band-ordering and falls back to newest-registered-first,
exactly like the catalogue does past its own cap. Read
`X-Desktop-Mode-Woo-Customers-Mode` off the response to tell which
mode you got.

Past the cap the folder's Store panel reports the band counts as
**not counted** rather than as zero — the payload carries
`bandsCapped: true` and omits `vips` / `lapsed` entirely, because a
large store being told it has "0 VIPs" is a wrong answer stated
confidently.

#### The Customer window

A native window on one person, opened with a `customerId` param from a
customer tile, an order's Related menu, or a session restore. It is a
retargetable singleton: opening it on a second customer repaints the
open window rather than stacking a new one.

```php
apply_filters( 'openstation_my_wordpress_woo_customer_window_template_html', string $html ): string
```

The window's static template body before it is emitted into the
native-window template element. The default is a bare mount point —
the whole surface is data-driven, so a markup skeleton would only be a
second place for the layout to live and drift.

Keep the `data-os-woo-customer-root` attribute intact: the render
callback mounts into it, and a template without it paints into the
window body instead. The result is passed through
`openstation_kses_native_window_template()`.

```php
apply_filters( 'openstation_my_wordpress_woo_customer_window_args', array $args ): array
```

The `openstation_register_window()` args for the Customer window —
title, icon, size and minimums, the `desktop-mode-woo-customer` id's
script and style handles, and `placement => 'none'` (it is never
opened from a dock tile, because "the customer window" with no
customer means nothing).

Both filters only run when WooCommerce is active and the viewer passes
the customers permission gate — order access **and** `list_users`.

### `openstation_my_wordpress_template_html` — Experimental (filter)

The static template body before it's emitted into the native-window template element. Keep the `data-os-my-wordpress-*` data hooks intact so the JS bundle can find its mount points.

### `openstation_my_wordpress_user_stats` — Experimental (filter)

```php
apply_filters( 'openstation_my_wordpress_user_stats', array $payload, int $user_id ): array
```

The aggregated per-user dossier payload returned by `GET /desktop-mode/v1/user-stats/<id>` — drives the right-pane preview for a selected user (Author / Contributors sub-folders, and the Users folder root). Plugins can drop additional sections (badges, milestones, contribution streaks) without forking the JS render.

The payload is permission-shaped before this filter runs: viewers without `list_users` (who are not the subject user) receive a published-only dossier — the recent-posts list is restricted to `publish`, `counts.posts` / `counts.pages` collapse to published-only totals, and sensitive profile fields (email, registered date, role) are withheld.

### `openstation_my_wordpress_user_footprint` — Experimental (filter)

```php
apply_filters( 'openstation_my_wordpress_user_footprint', array $payload, int $user_id ): array
```

The per-user activity-footprint payload returned by `GET /desktop-mode/v1/user-footprint/<id>` — drives the full-body "View activity footprint" surface (right-click on a user tile → footprint). Carries a year of day-by-day activity, weekday + hour-of-day distribution, streak math, recent-events timeline, and totals. Plugins can extend the timeline with their own activity rows (deploys, badges earned, etc.) or replace the streak math with a domain-specific definition.

Timeline rows whose underlying post is not published (draft, pending, private, future) are only emitted when the viewer passes `current_user_can( 'read_post' )` for that post — the gate applies across the post, post-update, and comment row sources — so unpublished titles never leak to ordinary logged-in users.

### `openstation_user_footprint_row_action` — Stable (filter)

```php
apply_filters( 'openstation_user_footprint_row_action', bool $show, WP_User $user_object ): bool
```

Gates the **"View activity footprint"** row action added to the classic Users list table (`users.php`). The action is only ever appended on a chromeless request (inside the desktop shell's iframe, where the bridge is present to receive the click); this filter is the final say within that context. Return `false` to suppress the action for a given user — e.g. to scope it to a role, or hide it on the viewer's own row. Default `true`.

The action carries the target user id in a `data-os-footprint` attribute; the chromeless bridge escalates the click as the `os-open-user-footprint` message (see [`bridge-protocol.md`](bridge-protocol.md) and [`javascript-reference.md`](javascript-reference.md)), opening the WP Explorer window on that user's footprint without closing the Users list. The link's `href` is a real `user-edit.php` / `profile.php` URL — the graceful fallback for no-JS or modifier clicks.

### `openstation_my_wordpress_comment_stats` — Experimental (filter)

```php
apply_filters( 'openstation_my_wordpress_comment_stats', array $payload, int $comment_id ): array
```

The per-comment dossier payload returned by `GET /desktop-mode/v1/comment-stats/<id>` — carries the comment body (`comment`), the author aggregate (`author`), the post it belongs to (`post`), its parent (`parent`), and replies (`replies`). Plugins can append their own sections without forking the JS render.

### `openstation_my_wordpress_term_stats` — Experimental (filter)

```php
apply_filters( 'openstation_my_wordpress_term_stats', array $payload, string $taxonomy, int $term_id ): array
```

The per-term stats payload returned by `GET /desktop-mode/v1/term-stats/<taxonomy>/<id>` — profile, counts, recent posts, top authors, co-terms, activity, and milestones. Filter it to splice in extra metrics before it reaches the WP Explorer window.

### `openstation_my_wordpress_post_contributors` — Experimental (filter)

```php
apply_filters( 'openstation_my_wordpress_post_contributors', int[] $ids, int $post_id ): int[]
```

The contributor user ids for a post — drives the Contributors sub-folder. Defaults gather Co-Authors Plus authors, revision authors, and the `_edit_last` meta; plugins that track contributors via custom meta, a taxonomy, a join table, or any other mechanism append their ids here. Each id should resolve to a `WP_User`; non-resolving ids, duplicates, and the primary author are dropped after the filter runs.

### `openstation_my_wordpress_media_usage` — Experimental (filter)

```php
apply_filters( 'openstation_my_wordpress_media_usage', array $payload, int $attachment_id ): array
```

The "used in" payload returned by `GET /desktop-mode/v1/media-usage/<id>` — drives the Media drill-in view (double-click a media tile). Each `usedIn` row carries `{ postId, postType, postTypeLabel, title, status, link, editLink, usedAs:'featured'|'content'|'meta', authorId, authorName, date }`. Plugins (ACF, page builders, Yoast image meta) can push additional rows describing references their own data layer holds — e.g. ACF image fields, gallery blocks, theme-mod backgrounds.

Rows are already filtered per-row through `current_user_can('read_post', $row['postId'])`, so the viewer never sees drafts they can't read. Only the viewer-independent reference scan (post id → `usedAs` map, the heavy SQL portion) is transient-cached (default 5 min), keyed by attachment + a coarse capability bucket (key hygiene, not a security boundary) — the per-row `read_post` gate and this filter both run on every request, so a cache hit can never leak unreadable rows across viewers and filter extensions stay live. Cache busts on `save_post`, `before_delete_post` (deliberately not `deleted_post` — by then the post's refs are gone and the stale cache would survive), and `delete_attachment`.

### `openstation_my_wordpress_attached_media` — Experimental (filter)

```php
apply_filters( 'openstation_my_wordpress_attached_media', int[] $ids, int $post_id ): int[]
```

Attachment ids referenced by a post — featured image plus everything resolved from `post_content` (block-class scan, classic `[caption]` shortcodes, `data-id` / `data-attachment-id`, and raw `<img src>` URL resolution including `-scaled.jpg` ↔ original swaps). Exposed on every public post type as the `openstation_attached_media` REST field (read-only, integer array). Plugins that store attachment references outside `post_content` (ACF image fields, page-builder block storage, post-meta galleries) should append their ids here. Sanitized post-filter — non-positive values and non-arrays are discarded.

### `openstation_my_wordpress_media_usage_cache_ttl` — Experimental (filter)

```php
apply_filters( 'openstation_my_wordpress_media_usage_cache_ttl', int $seconds, int $attachment_id ): int
```

Lifetime (seconds) of the per-attachment media-usage transient. Lower it on sites that frequently bulk-import or rewrite content; raise it on stable libraries.

### `openstation_my_wordpress_preview_actions` — Experimental (filter)

```php
apply_filters( 'openstation_my_wordpress_preview_actions', array[] $actions ): array[]
```

Server-declared descriptors for plugin actions on a selected Explorer entry. Each descriptor renders twice, from the one declaration: as a button in the right-pane action row and as an entry in the tile context menu — in every WP Explorer section (posts, pages, users, media, plugin-defined kinds). Each entry:

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

`capability` is enforced server-side before the descriptor ships to the bundle, so an action the current user can't run never appears in their UI. `script`, if registered, is auto-enqueued. Wire the click handler on the JS side via `wp.hooks.addFilter('os.my-wordpress.preview-actions', …)` — the handler receives a context object carrying the selected entity; see [`examples/my-wordpress-media-action.md`](./examples/my-wordpress-media-action.md) and the [JS reference](./javascript-reference.md#filter--osmy-wordpresspreview-actions).

**`sections` matching.** An entry in `sections` matches a section's **id**, its declared **post type slug**, or `'*'` (every section). Note the id shapes: the built-ins are `'posts'`, `'pages'`, `'users'`, `'media'`, while a custom post type the Explorer auto-registers gets the id `cpt-<post_type>` (e.g. post type `atf-form` → section `cpt-atf-form`); hand-registered sections choose their own ids. When in doubt, scope by post type slug — it matches wherever that type's section came from. A `mime` pattern additionally fails closed outside media contexts: a MIME-scoped action never appears on a post/user pane.

**Timing.** Descriptors are re-collected when the window config is serialized for the browser (the same late pass that enqueues declared `script` handles), so registering this filter any time during a normal bootstrap — `init`, `admin_init`, plugin bootstrap order regardless — works. One caveat: on a mid-session plugin activation the already-loaded Explorer bundle keeps its config until the next full page load (F5).

---

## Corkboard

An interactive PixiJS map of post links — every public post type participates as a node, and a **thread** is drawn between two nodes when one post's content links to the other. Terms, authors, comments, media and revisions are not threads: they fan out as satellites around the focused post, and terms, authors and dates double as the Group by facets that cluster the board. Registers a native window (`desktop-mode-content-graph`) plus a desktop icon on `init` priority 20. The filterable surface mirrors WP Explorer’s module shape.

The window and icon are titled **Corkboard** — a thing you can have on a desk, rather than the name of the data structure behind it. The module directory, window id, REST routes, and every hook below keep the `content_graph` slug.

Nodes are drawn as **discs coloured by post type**, using the same palette the relationship satellites use so a focused post and the bubbles fanned around it read as one system. The original **pin** look — the post type's Dashicon glyph as the node body — is one row away in the window's ⋯ menu ("Show pins"), and the choice persists in `localStorage` under `desktop-mode/corkboard-node-style`. Either way the focused node reveals its glyph, so focus never costs the user the type information. The row is an ordinary checkbox registered through the public [`registerWindowAction`](./javascript-reference.md#wposregisterwindowaction--experimental) surface — see [`examples/window-action.md`](./examples/window-action.md) to add your own.

A sparse board explains itself. Small boards (up to twelve nodes) are laid out deterministically around the centre of the stage and settled before the first paint, so a site with two posts opens onto two nodes side by side rather than two dots drifting off under the dock. A board with nodes but no thread between any of them carries a note saying what a thread is and where the other relationships live (hidden while a grouping is active, when the cluster labels need the space); an empty board says whether the site has nothing to pin yet, the toolbar has filtered everything out, or every type is switched off. The full-canvas loading wash paints only for a graph fetch that runs past 400 ms; shorter waits show as the toolbar's status line, and the window shell's own loader covers just the cold bundle + renderer start-up. The `/nodes` route tells an omitted `types` query (every registered type) apart from an explicitly empty one (no types); the shell sends the latter when every chip is off.

### `openstation_content_graph_user_can_use` — Experimental (filter)

```php
apply_filters( 'openstation_content_graph_user_can_use', bool $can ): bool
```

Gates icon registration and window registration in one shot. Default `current_user_can( 'edit_posts' )` — anyone who can edit posts can view the link map of the content they author and maintain.

### `openstation_content_graph_post_types` — Experimental (filter)

```php
apply_filters( 'openstation_content_graph_post_types', array[] $post_types ): array[]
```

The list of post types shown in the graph's filter bar. Each entry declares `slug`, `label`, `icon`, and `taxonomies` (`array( 'category' => bool, 'post_tag' => bool )`), used to keep types without a taxonomy out of the shared Uncategorized/Untagged clusters. Entries added without `taxonomies` get it derived via `is_object_in_taxonomy()`. Default: every public post type except `attachment` (media renders in the side panel rather than as nodes). Removing an entry hides it from the filter bar AND excludes it from the graph entirely.

### `openstation_content_graph_template_html` — Experimental (filter)

```php
apply_filters( 'openstation_content_graph_template_html', string $html ): string
```

The window's static template body before it's `wp_kses`'d. The bundle mounts into `[data-os-content-graph-root]` — keep the `data-os-content-graph-*` hooks intact.

### `openstation_content_graph_window_args` / `openstation_content_graph_icon_args` — Experimental (filter)

```php
apply_filters( 'openstation_content_graph_window_args', array $window_args ): array
apply_filters( 'openstation_content_graph_icon_args',   array $icon_args ): array
```

Tweak the args passed to `openstation_register_window()` / `openstation_register_icon()` for the Corkboard — dimensions, dashicon, icon position, or the `config` blob (REST endpoints, edit-URL bases, `siteName`, post-type descriptors).

---

## Code Blue

An error-log reader: tails the logs the install can produce (WP debug log, PHP error log, anything a plugin registers), parses them into structured entries, and renders a severity histogram plus a grouped issue list. Registers a native window (`openstation-code-blue`) plus a desktop icon on `init` priority 20. Server module: `includes/code-blue/`. The REST routes live under the plugin's frozen `desktop-mode/v1` namespace like every other route.

The whole surface — icon, window, nav entry, and REST routes — sits behind one gate with two conditions, both required: **Developer mode** (`developerModeEnabled` in OpenStation Preferences, off by default — Code Blue is a developer-facing surface and registers nothing until the user flips it) and a capability — `manage_options`, raised to `manage_network_options` on multisite, since log content leaks server paths and SQL and the debug/PHP error logs are network-wide files. Flipping the Preferences toggle takes effect live: once the settings save persists, the panel spends one [`wp.os.refreshMenu()`](./javascript-reference.md) probe and the icon/window appear (or disappear) without a reload.

### REST — `desktop-mode/v1/code-blue/*` — Experimental

- `GET /sources` — log sources plus the environment card (`WP_DEBUG*` constants, versions, environment type).
- `GET /entries?source=<id>` — parsed entries from one source's trailing window: `{ source, entries, truncated, scanned_bytes, dropped_entries, generated_at }`. Each entry: `{ timestamp, level, label, message, file, line, trace, signature }` where `level` is one of `fatal | error | warning | deprecated | notice | info` and `signature` is the server-computed grouping key.
- `DELETE /entries?source=<id>` — truncates the log file to zero bytes.

### `openstation_code_blue_user_can_use` — Experimental (filter)

```php
apply_filters( 'openstation_code_blue_user_can_use', bool $can ): bool
```

Permission gate for the icon, the window, and every REST route. Default: Developer mode enabled in OpenStation Preferences AND `current_user_can( 'manage_options' )` (`manage_network_options` on multisite).

### `openstation_code_blue_log_sources` — Experimental (filter)

```php
apply_filters( 'openstation_code_blue_log_sources', array[] $sources ): array[]
```

The log files the window offers. Each entry declares `id` (slug), `label`, and `path` (absolute file path); file metadata (`exists`, `readable`, `writable`, `size`, `mtime`) is derived after filtering. Defaults: the WP debug log (`WP_DEBUG_LOG`, string form respected) and the `error_log` PHP directive. See [`examples/code-blue-log-source.md`](./examples/code-blue-log-source.md).

### `openstation_code_blue_entries` — Experimental (filter)

```php
apply_filters( 'openstation_code_blue_entries', array[] $entries, array $source, string $raw ): array[]
```

The parsed entries for one source, before the entry cap is applied. The escape hatch for logs the built-in parser doesn't understand (Monolog, ISO-timestamped formats): re-parse `$raw` yourself for your own `$source` and return your own entry array. Each entry: `timestamp` (int|null), `level`, `label`, `message`, `file`, `line`, `trace`, `signature` — build them with `openstation_code_blue_make_entry()` to get the location extraction and grouping signature for free.

### `openstation_code_blue_environment` — Experimental (filter)

```php
apply_filters( 'openstation_code_blue_environment', array[] $rows ): array[]
```

The environment rows shown as chips in the window. Each: `key`, `label`, `value` (string), `on` (bool renders an on/off tone, null renders neutral).

### `openstation_code_blue_max_bytes` / `openstation_code_blue_max_entries` — Experimental (filter)

```php
apply_filters( 'openstation_code_blue_max_bytes',   int $max_bytes ):   int // default 1 MiB, floor 4 KiB
apply_filters( 'openstation_code_blue_max_entries', int $max_entries ): int // default 3000, floor 100
```

Caps on the trailing window read from a log file per request, and on how many parsed entries a response may carry (the oldest are dropped first).

### `openstation_code_blue_template_html` — Experimental (filter)

```php
apply_filters( 'openstation_code_blue_template_html', string $html ): string
```

The window's static template body before it's `wp_kses`'d. The bundle mounts into `[data-os-code-blue-root]` — keep that hook intact.

### `openstation_code_blue_window_args` / `openstation_code_blue_icon_args` — Experimental (filter)

```php
apply_filters( 'openstation_code_blue_window_args', array $window_args ): array
apply_filters( 'openstation_code_blue_icon_args',   array $icon_args ):   array
```

Tweak the args passed to `openstation_register_window()` / `openstation_register_icon()` for Code Blue — dimensions, icon, icon position, or the `config` blob (`apiBase`, `restNonce`).

### `openstation_code_blue_log_cleared` — Experimental (action)

```php
do_action( 'openstation_code_blue_log_cleared', string $id, string $path )
```

Fires after the `DELETE /entries` route truncates a log file.

---

## Living Tree wallpaper

The `wp-living-tree` canvas wallpaper renders the site as a growing plant organism. WordPress emits only *hormones* (age, vigour, health, diversity, bloom…) via a compact REST snapshot; the JS growth simulator decides all geometry. The full algorithm is documented in [`living-tree-algorithm.md`](./living-tree-algorithm.md).

Server module: `includes/living-tree/`. Exposes one REST route and one gate filter.

### REST — `GET desktop-mode/v1/living-tree/snapshot` — Experimental

Returns the compact site DNA (the `TreeSnapshot` shape): aggregate counts, install epoch, a small tag co-occurrence edge list, and per-year branch hints — never the full post list. Cached in the `desktop_mode_living_tree_snapshot` transient (TTL 6h), invalidated on `save_post` / `deleted_post` / `comment_post`.

### `openstation_living_tree_user_can_use` — Experimental (filter)

```php
apply_filters( 'openstation_living_tree_user_can_use', bool $can ): bool
```

Permission gate for the snapshot endpoint. Default `current_user_can( 'read' )` — anyone who can see the admin can see their own site's wallpaper. Widen or restrict as needed.

### `openstation_living_tree_snapshot` — Experimental (filter)

```php
apply_filters( 'openstation_living_tree_snapshot', array $snapshot ): array
```

The full snapshot before it is cached and served. Keep the shape intact — the JS client trusts this contract — and keep it aggregates-only (the golden rule: hormones, never geometry).

### `openstation_living_tree_seo_health` — Experimental (filter)

```php
apply_filters( 'openstation_living_tree_seo_health', float $health ); // default 0.7
```

The SEO-health hormone (0..1) — drives the canopy's colour temperature: green → yellow → red → grey. **Known gap:** unlike `traffic` and `performance`, this hormone has no first-party source yet — WordPress ships nothing SEO-shaped to read, so it sits at a neutral 0.7 unless a plugin hooks this filter. The planned future source is aggregating the per-post scores SEO plugins keep in post-meta into a site-wide average; until that lands, this filter is the only integration point. Values are clamped to [0, 1].

### `openstation_living_tree_performance` — Experimental (filter)

```php
apply_filters( 'openstation_living_tree_performance', float $performance );
```

The growth-vigour hormone (0..1). The default is derived from core's own **Site Health** tallies: WordPress runs every Site Health test on a weekly cron and persists the counts in the `health-check-site-status-result` transient; the tree starts at 1.0, subtracts 0.15 per critical issue and 0.04 per recommendation, clamped to [0.2, 1] — a clean install grows vigorously, a neglected one visibly slows but never fully stalls. When the transient doesn't exist yet (brand-new site, weekly cron hasn't fired, Site Health never opened) the default falls back to 0.8. Note Site Health measures broad install health (PHP version, HTTPS, updates, object caching…), not raw runtime speed — the right flavour for growth vigour. Monitoring plugins with real telemetry can hook this filter as the final word; values are clamped to [0, 1].

### `openstation_living_tree_traffic` — Experimental (filter)

```php
apply_filters( 'openstation_living_tree_traffic', int $views ): int
```

The recent-traffic hormone (drives the wind — canopy sway amplitude and frequency). The default value follows the same source ladder as the site-views widget: **Jetpack Stats** (last 14 days of visits via `WPCOM_Stats::get_visits()`) when Jetpack is available, else the sum of the `_post_views_YYYY-MM-DD` post-meta convention over the same window, else `0` (a windless day). Analytics plugins with their own counters should hook this and return their real 14-day view count; the value is clamped non-negative.

---

## Presence

Framework-level presence tracking. Storage in
`_desktop_mode_presence` (autoload=false, single row keyed by user
id). The WordPress Heartbeat carries the bumps + visibility
snapshot; the JS API at `wp.os.presence.*` fans out to
plugin code. See [`examples/presence.md`](./examples/presence.md)
for a copy-pasteable recipe.

### Filters — Stable

```php
apply_filters( 'openstation_presence_inactive_after', $seconds );  // default 300 (5m)
apply_filters( 'openstation_presence_offline_after',  $seconds );  // default 120 (2m)
apply_filters( 'openstation_presence_can_track',      $can, $user_id );
apply_filters( 'openstation_presence_visible_users',  $ids, $viewer_id );
```

- **`openstation_presence_inactive_after`** — seconds without
  user input before `online` demotes to `inactive`. Tune up for
  long-form writing tools, down for chat-heavy environments.
- **`openstation_presence_offline_after`** — seconds without a
  heartbeat before any tracked user is considered `offline`.
- **`openstation_presence_can_track`** — per-user veto. Return
  `false` to skip the bump entirely (compliance flags,
  "appear invisible" toggles, allow-list policies).
- **`openstation_presence_visible_users`** — privacy gate.
  Receives the candidate id list + the viewer id, returns the
  list narrowed to whoever this viewer should see. Default
  passes through unchanged. Plugins building team boundaries
  hook here.

### Actions — Stable

```php
do_action( 'openstation_presence_recorded', $user_id, $record );
do_action( 'openstation_presence_changed',  $user_id, $new_status, $old_status );
```

- **`openstation_presence_recorded`** — fires on every heartbeat
  bump, whether status changed or not. Be cheap inside this
  callback — it runs on every Heartbeat tick for every active
  OpenStation user.
- **`openstation_presence_changed`** — fires only on real status
  transitions (`online ↔ inactive ↔ offline`). The right hook
  for "user came online → notify a slack channel" type work.

### PHP helpers

```php
openstation_presence_record( $user_id, $active = true );
openstation_presence_status_for_user( $user_id );
openstation_presence_get_all();
openstation_presence_snapshot( $user_ids = null );
openstation_presence_status_from_record( $record );    // pure compute helper
openstation_presence_visible_users( $ids, $viewer_id );
```

### REST endpoints

| Method | Route | Purpose |
|---|---|---|
| `GET`  | `/desktop-mode/v1/presence` | Visible-users snapshot for the current viewer. |
| `POST` | `/desktop-mode/v1/presence` | Bump (`{active:true}`), heartbeat-only (`{active:false}`), or "set yourself away" (`{inactive:true}`). |

---

## Window-chrome customization framework — Stable

Four-layer per-window appearance system. Layers 1-3 are Stable;
Layer 4 (custom chrome render) is **Experimental**. Full recipes:
[themes](./examples/window-theme.md), [controls](./examples/window-controls.md),
[slots](./examples/window-slot.md), [custom chrome](./examples/custom-chrome.md).

### Layer 1 — Themes (Stable)

```php
openstation_register_window_theme_script( $handle );        // primary, low-ceremony
openstation_register_window_theme( $args );                  // optional metadata
```

`$args`: `id`, `label`, `tokens` (CSS-variable map, keys must start with `--`), `priority` (default 100), `script` (optional handle).

Actions:
- `openstation_window_theme_script_registered( $handle )`
- `openstation_window_theme_registered( $id, $entry )`

### Layer 2 — Controls (Stable)

```php
openstation_register_window_control_script( $handle );
openstation_register_window_control( $args );
```

`$args`: `id`, `label`, `icon`, `placement` (`'left'|'right'|'controls'`, default `'left'`), `order` (default 100), `script`.

Built-in control ids registered by the framework: `core/minimize`, `core/maximize`, `core/focus-tab`, `core/close`. (`core/detach` and `core/reload` are no longer title-bar controls — detach/reload moved into the title-bar three-dots menu.) Plugins can `unregisterWindowControl()` any of them globally, or use per-window `appearance.controls.{order, hide, custom}` for window-scoped mutations.

Actions:
- `openstation_window_control_script_registered( $handle )`
- `openstation_window_control_registered( $id, $entry )`

### Layer 3 — Slots (Stable)

```php
openstation_register_window_slot_script( $handle );
openstation_register_window_slot( $args );
```

`$args`: `id`, `slot` (one of `before-titlebar`, `before-icon`, `icon`, `title`, `after-title`, `before-controls`, `after-controls`, `after-titlebar`), `order` (default 100), `script`.

Actions:
- `openstation_window_slot_script_registered( $handle )`
- `openstation_window_slot_registered( $id, $entry )`

### Layer 4 — Custom chrome (Experimental)

```php
openstation_register_window_chrome_script( $handle );
openstation_register_window_chrome( $args );
```

`$args`: `id`, `label`, `script`. **Experimental** — chrome render contract may change.

Actions:
- `openstation_window_chrome_script_registered( $handle )`
- `openstation_window_chrome_registered( $id, $entry )`

### Window notices — Experimental

```php
openstation_register_window_notice( $args );
```

`$args`:
- `id` *(required)* — persistence + dedupe key.
- `message` *(required)* — HTML body. Passed through `wp_kses_post()`.
- `tone` — `info` (default) | `success` | `warning` | `error` | `danger` | `neutral`.
- `dismissible` — show a close button. Default `true`.
- `icon` — optional Dashicons class.
- `match` — optional selector: `{ window?: 'edit-php' }`, `{ windows?: [ 'edit-php', 'edit-php-page' ] }`, or `{ urlContains?: 'wc-admin' }`. Combine freely; omit for "every window."
- `order` — sort order. Lower renders higher in a stack. Default 100.

Notices render as `<os-notice>` inside the matching window's
`after-titlebar` slot. Each user's dismissal is persisted in
`localStorage` so the same banner never reappears for them.

Actions / filters:
- `openstation_window_notice_registered( $id, $entry )` — action.
- `openstation_window_notices( $entries )` — filter the final list right before it ships to the shell (request-time banners).

See [`docs/examples/window-notice.md`](examples/window-notice.md).

### Core-update notice — `openstation_show_core_update_notice` — Experimental (filter)

Return `false` to turn off the desktop core-update notification (defaults to `true`):

```php
add_filter( 'openstation_show_core_update_notice', '__return_false' );
```

### Core notices — `openstation_core_notices` — Experimental (filter)

The other global WordPress Core admin notices (maintenance / failed update,
recovery mode, default-password, force-deactivated plugins, paused
plugins/themes) are detached inside desktop windows and re-derived from server
state so the shell surfaces each **once** as a toast. This filter receives the
array of descriptors (`{ id, title, message, actionLabel, actionUrl }`) —
return an empty array to suppress them all, or unset entries by `id`.

```php
// Drop the "you're using an auto-generated password" notice only.
add_filter( 'openstation_core_notices', static function ( array $notices ) {
    return array_values( array_filter(
        $notices,
        static fn ( $n ) => 'default-password' !== $n['id']
    ) );
} );
```

### Plugin/library notices — `openstation_plugin_notices` — Experimental (filter)

A small opt-in allowlist of shared **library** notices that also render globally
(e.g. Action Scheduler's "past-due actions" warning, bundled by WooCommerce and
others) gets the same treatment: detached in-window, re-derived from state,
surfaced once. Arbitrary plugin `admin_notices` are *not* touched — only the
allowlisted libraries. Same descriptor shape as `openstation_core_notices`;
return an empty array to suppress them all.

```php
add_filter( 'openstation_plugin_notices', '__return_empty_array' );
```

---

## Progressive Web App

### `openstation_pwa_manifest` — Stable (filter)

Filters the web-app manifest payload before it's encoded and served at
`/openstation/manifest.webmanifest`. Mutate icons, name, theme color,
or add `shortcuts`. Returning a non-array silently disables the
manifest.

```php
add_filter( 'openstation_pwa_manifest', static function ( array $manifest ) {
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

### `openstation_pwa_force_replace_sw` — Stable (filter)

Opt OpenStation in to replace a foreign root-scope service worker on
this origin. Default `false` — OpenStation yields to any existing SW
(Super PWA, Jetpack Boost, etc.) and the install tile shows a toast
naming this filter as the path forward. Return `true` to take over.

```php
add_filter( 'openstation_pwa_force_replace_sw', '__return_true' );
```

Use this to unblock the "Install \<site\> as an app" affordance on sites
where another PWA plugin's SW is shadowing OpenStation and Chromium
therefore won't fire `beforeinstallprompt`.

### `openstation_pwa_admin_asset_cache` — Experimental (filter)

Opt in to the service worker's **shared admin-asset cache**. When
enabled, versioned admin static assets — Core CSS/JS, the
`load-scripts.php` / `load-styles.php` concat responses, and
plugin/theme assets carrying a `?ver=` query — are served from one
origin-wide Cache Storage bucket shared by the shell and every window's
chromeless iframe. An asset fetched by one window is answered locally
for every later window, revalidation round-trips included.

The filter's default is the requesting user's OpenStation preference
(**OpenStation Preferences → Features → Beta features → "Shared asset
cache (experimental)"**, `adminAssetCacheEnabled`, default `false`) —
the toggle is the intended opt-in path. Hook the filter to force the
cache site-wide or to veto every per-user opt-in:

```php
add_filter( 'openstation_pwa_admin_asset_cache', '__return_true' );  // force on
add_filter( 'openstation_pwa_admin_asset_cache', '__return_false' ); // kill switch
```

The value reaches the SW inside the served script bytes, so flipping
the filter triggers a normal SW update on the next page load — no
re-registration needed. Core-path assets are cached exact-URL
cache-first (their `ver` embeds the WordPress version); plugin/theme
assets use stale-while-revalidate so an author editing files without a
version bump self-heals on the next load. Uploads, unversioned URLs,
HTML, REST, and AJAX are never cached. See
[`docs/pwa.md`](./pwa.md#caching-policy) for the full policy table.

### PHP helpers — Stable

```php
openstation_pwa_manifest_url();
openstation_pwa_sw_url();
openstation_pwa_sw_fallback_url();
openstation_pwa_force_replace_sw();
openstation_pwa_admin_asset_cache_enabled();
openstation_pwa_get_user_state( $user_id = 0 );
openstation_pwa_update_user_state( array $patch, $user_id = 0 );
```

`openstation_pwa_get_user_state` returns
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

## Nonce refresh

The desktop shell is a long-running SPA whose nonces would
otherwise go stale past WordPress's `nonce_life` (24 h). To
prevent this, `includes/nonce-refresh.php` registers a
`heartbeat_received` filter that ships fresh values for a fixed
set of nonce actions on every Heartbeat tick — the client
overwrites the cached values in `window.openStationConfig` and
the per-window blobs in place.

### `openstation_nonce_refresh_actions` — Stable *(filter)*

Filter the list of nonce-action strings the server refreshes on
every Heartbeat tick.

```php
add_filter( 'openstation_nonce_refresh_actions', function ( $actions ) {
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
[`wp.os.heartbeat.subscribe`](./javascript-reference.md#nonce-refresh--heartbeat-field-stable)
and write the value where your code reads from.

The same payload also rides core's `wp_refresh_nonces`
filter, so the tick that reports `nonces_expired` (the first one
after a session re-login, or after plain 24-hour expiry) already
carries the fresh map — the shell heals in one round trip. Both
paths additionally attach the `desktop_mode_auth` heartbeat field
(`{ uid: <current user id> }`), which the shell's session recovery
uses to detect a user switch (see
[Session expiry & recovery](./javascript-reference.md#session-expiry--recovery-stable)).

---

## Pinned notes

Pinned notes are the paper notes composed in the **Note Pad** widget
(or straight on the wallpaper, via its right-click **New note** entry)
and pinned to the desktop with a pushpin. They are backed by the
`wpd_note` CPT (non-public, custom REST controller at
`/desktop-mode/v1/notes`). Visibility maps to post status: `private`
(default, owner-only) or `publish` ("public" — read-only on every other
OpenStation user's wallpaper). Only the owner can edit, move, recolor,
or delete a note; administrators do not bypass ownership through this
controller.

### `openstation_notes_user_can_create` — Experimental *(filter)*

Filters whether the current user may create a note. Defaults to
`true` for every logged-in OpenStation user, which includes
publishing PUBLIC notes onto every other user's wallpaper. Sites
that want to restrict that gate here — by role, capability, or the
request itself (e.g. only restrict `public: true` creates).

```php
apply_filters( 'openstation_notes_user_can_create', bool $can_create, int $user_id, WP_REST_Request $request );
```

**Example — only editors may share public notes:**

```php
add_filter( 'openstation_notes_user_can_create', static function ( $can, $user_id, $request ) {
	if ( $request['public'] && ! user_can( $user_id, 'edit_others_posts' ) ) {
		return false;
	}
	return $can;
}, 10, 3 );
```

- **Param** `bool $can_create` — whether creation is allowed. Default `true`.
- **Param** `int $user_id` — current user id.
- **Param** `WP_REST_Request $request` — the create request (`text`, `color`, `x`, `y`, `public`, `seed`).
- **Return** `bool` — `false` makes the route return 403 `openstation_notes_forbidden`.

### `openstation_notes_colors` — Experimental *(filter)*

Filters the pastel paper color slugs a note may use. Slugs added here
must also ship CSS custom properties (`--dm-note-paper`,
`--dm-note-paper-deep`, `--dm-note-ink`) for a
`[data-note-color="<slug>"]` selector — otherwise notes using them
fall back to the default paper (`butter`). The whitelist is enforced
on every REST write and on meta sanitization.

```php
apply_filters( 'openstation_notes_colors', string[] $colors );
```

**Example — add a paper color:**

```php
add_filter( 'openstation_notes_colors', static function ( $colors ) {
	$colors[] = 'seafoam';
	return $colors;
} );
```

- **Param** `string[] $colors` — allowed slugs. Default `butter`, `blush`, `sky`, `mint`, `lilac`, `peach`.
- **Return** `string[]` — each entry passes through `sanitize_key()`; empties are dropped.

### `openstation_notes_convert_post_args` — Experimental *(filter)*

Filters the arguments passed to `wp_insert_post()` when a note is
converted to a post via `POST /desktop-mode/v1/notes/:id/convert` (the
inline "Convert to post" button and the drag-onto-Posts gesture). The
default spawns a **draft `post`** authored by the note owner, titled
from the note's first line, with the note body wrapped in
`wp:paragraph` blocks (blank lines split paragraphs; single newlines
become `<br>`). Hook here to change the post type/status, assign a
category, or rewrite the block markup. The convert route itself is
gated on the owner + the `edit_posts` capability, which this filter
does not loosen.

```php
apply_filters( 'openstation_notes_convert_post_args', array $post_args, WP_Post $note, WP_REST_Request $request );
```

**Example — file converted notes into a "Notes" category as pending drafts:**

```php
add_filter( 'openstation_notes_convert_post_args', static function ( $args, $note ) {
	$args['post_status'] = 'pending';
	$term = get_term_by( 'slug', 'notes', 'category' );
	if ( $term ) {
		$args['post_category'] = array( $term->term_id );
	}
	return $args;
}, 10, 2 );
```

- **Param** `array $post_args` — the `wp_insert_post()` array (`post_type`, `post_status`, `post_author`, `post_title`, `post_content`).
- **Param** `WP_Post $note` — the source note (about to be trashed).
- **Param** `WP_REST_Request $request` — the convert request.
- **Return** `array` — the (possibly modified) insert args.

### `openstation_notes_converted` — Experimental *(action)*

Fires after a note has been converted to a draft post: the draft
exists and the source note has been trashed (and linked to the draft
so the restore route can undo both sides).

```php
do_action( 'openstation_notes_converted', int $new_post_id, WP_Post $note, WP_REST_Request $request );
```

- **Param** `int $new_post_id` — the new draft post id.
- **Param** `WP_Post $note` — the source note (now trashed).
- **Param** `WP_REST_Request $request` — the convert request.

---

## Real file storage

Real per-user desktop storage (the `upload` file type): multipart
uploads into a protected uploads subdirectory, PHP-served downloads,
on-demand folder zips, and read-only single-file sharing. Feature
doc: [files-on-desktop.md → Real file storage](files-on-desktop.md#real-file-storage-upload--experimental).
All Experimental.

### Filters

| Hook | Signature | Purpose |
|---|---|---|
| `openstation_stored_files_base_dir` | `( string $base ) => string` | Storage base directory (default `uploads/desktop-mode-files` — the pre-rebrand segment is a frozen identifier). Sites that can write outside the webroot point this there. |
| `openstation_stored_files_upload_capability` | `( string $cap ) => string` | Capability required to upload. Default `'upload_files'`. |
| `openstation_stored_files_max_upload_bytes` | `( int $max, int $user_id ) => int` | Per-file cap. Default `wp_max_upload_size()`; can only effectively lower it. |
| `openstation_stored_files_user_quota_bytes` | `( int $quota, int $user_id ) => int` | Per-user total quota. `0` (default) = unlimited. |
| `openstation_stored_files_allowed_mimes` | `( array $mimes, int $user_id ) => array` | `ext => mime` allowlist for desktop uploads. Defaults to the user-scoped `get_allowed_mime_types()`; additions here genuinely widen the policy (a scoped `upload_mimes` hook keeps core's `wp_check_filetype_and_ext()` re-check in agreement). |
| `openstation_stored_files_denied_extensions` | `( string[] $denied ) => string[]` | Hard-denied executable extensions, matched against EVERY dot-segment of the client filename. Narrowing below the shipped set is strongly discouraged. |
| `openstation_stored_files_upload_overrides` | `( array $overrides, int $user_id ) => array` | `wp_handle_upload()` overrides for the intake. Exists for tests and future resumable layers; never remove `test_form => false`. |
| `openstation_stored_files_zip_caps` | `( array $caps ) => array` | `{ max_entries, max_bytes }` bounds for folder zips. Default 1000 entries / 500 MB of input. |
| `openstation_stored_file_can_read` | `( bool $can, int $file_id, int $user_id, array $row ) => bool` | Last-mile read-access override after owner / file-share / folder-capability resolution all said no. |
| `openstation_stored_files_share_can_manage` | `( bool $can, int $file_id, int $user_id, ?array $file ) => bool` | Who may manage a stored file's shares. Owner-only by default. |

### Actions

| Hook | Signature | Fires |
|---|---|---|
| `openstation_stored_file_created` | `( int $file_id, int $owner_id )` | After a stored-file row is created (bytes already on disk). |
| `openstation_stored_file_uploaded` | `( int $file_id, int $placement_id, int $user_id )` | After a full upload lands (bytes + row + placement). |
| `openstation_stored_file_renamed` | `( int $file_id, string $new_name, string $old_name )` | After a display-name rename. |
| `openstation_stored_file_deleted` | `( int $file_id, array $row )` | After bytes + row are deleted. |
| `openstation_stored_file_downloaded` | `( int $file_id, int $user_id )` | Download audit — just before a file streams. |
| `openstation_folder_zip_downloaded` | `( int $folder_id, int $user_id, int $count )` | Just before a folder zip streams. |

Single-file shares fire the SAME share actions folder shares use
(`openstation_files_share_{invited,accepted,denied,left,revoked}`)
with the share row carrying `target_type => 'file'`. The
`openstation_files_shareable_types` default is now
`[ 'folder', 'file' ]`, and `openstation_files_share_target_owner`
resolves `'file'` targets to the stored file's owner.

## Asset loading

### `openstation_preload_hints` — Stable *(filter)*

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
add_filter( 'openstation_preload_hints', function ( $hints ) {
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

### `openstation_deferred_styles` — Stable *(filter)*

Filters the list of stylesheet **handles** loaded via the
`media="print"` + `onload` deferral pattern (so they don't block first
paint). Default: `os-dock-peek`, `desktop-mode-ai-assistant`,
`desktop-mode-bug-report`, `os-window-overview`,
`os-settings`, `os-openstation-layout`. Add a handle to defer it, or
remove one to keep it on the critical path.

```php
add_filter( 'openstation_deferred_styles', function ( $handles ) {
    $handles[] = 'my-plugin-heavy-panel';
    return $handles;
} );
```

### `openstation_guarded_styles` / `openstation_guarded_scripts` — Stable *(filters)*

Filter the asset handles the **asset guard** re-asserts at print time.

Some plugins force-dequeue every style and script that isn't on their
own allowlist when one of their admin screens renders (MailPoet's
`ConflictResolver` is the canonical example). Inside a chromeless
iframe that would strip `os-chromeless` and put the raw admin chrome
back inside the window; on a shell page it would strip the desktop
itself. The guard snapshots every enqueued handle served from the
OpenStation plugin URL and re-adds any that went missing via Core's
`print_styles_array` / `print_scripts_array` filters — which run inside
the print pass itself, after every dequeue at every priority has
already happened.

The snapshot only covers OpenStation's own handles. If your plugin
enqueues chromeless overrides (via `openstation_chromeless_styles`) or
iframe-side scripts and an asset-cleanup plugin strips them, add your
handles here:

```php
apply_filters( 'openstation_guarded_styles', string[] $handles );
apply_filters( 'openstation_guarded_scripts', string[] $handles );
```

```php
add_filter( 'openstation_guarded_styles', function ( $handles ) {
    $handles[] = 'my-plugin-chromeless-overrides';
    return $handles;
} );
```

- **Param** `string[] $handles` — default: every handle the current
  page enqueued from the OpenStation plugin directory.
- **Return** `string[]` — handles must be registered; unregistered
  entries are skipped. Dependencies are re-added automatically.
  Scripts are only re-asserted during the admin footer print pass.

---

## Desktop themes

Whole-OS reskins: an admin uploads a ZIP of `theme.json` plus images,
or a plugin registers one from code. PHP validates the manifest and
*compiles* a stylesheet of custom-property declarations from it — no
author-supplied CSS or JS is ever executed. See
[Desktop themes](./desktop-themes.md) for the manifest format, the
full slot tables, and the value grammar.

> Not to be confused with the per-window **window themes**
> (`openstation_register_window_theme()`), which restyle one window's
> chrome.

### `openstation_desktop_theme_registered` — Experimental *(action)*

Fires after `openstation_register_desktop_theme()` succeeds. Does NOT
fire when registration returned a `WP_Error`.

- **Param** `string $slug` — storage slug (the manifest `id` with `/` flattened to `-`).
- **Param** `array $entry` — `{ slug, manifest, cssText }`.

### `openstation_desktop_theme_installed` — Experimental *(action)*

Fires after a ZIP has been installed **or updated** (re-uploading a
theme with the same `id` replaces it in place).

- **Param** `string $slug`
- **Param** `array $entry` — `{ slug, manifest, installedAt, installedBy }`.

### `openstation_desktop_theme_deleted` — Experimental *(action)*

Fires after a theme's directory and index entry have been removed.

- **Param** `string $slug`
- **Param** `array $entry` — the index entry as it was before removal.

### `openstation_desktop_themes` — Experimental *(filter)*

Filters the whole library, keyed by slug, just before it ships to the
shell in the `serverDesktopThemes` payload. Removing an entry hides it
from every picker without touching the stored files.

```php
add_filter( 'openstation_desktop_themes', function ( $themes ) {
    // Editors only get the house theme.
    if ( ! current_user_can( 'manage_options' ) ) {
        return array_intersect_key( $themes, array( 'acme-house' => true ) );
    }
    return $themes;
} );
```

- **Param** `array[] $themes` — map of slug => payload entry.
- **Return** `array[]`

> Runs **after** sanitization. Anything you add here bypasses the
> validator and lands in the payload verbatim — treat it as
> trusted-code territory.

### `openstation_desktop_theme_manifest` — Experimental *(filter)*

Filters one sanitized manifest before it is compiled and stored.

- **Param** `array $manifest` — sanitized: `manifestVersion`, `id`, `slug`, `name`, `version`, `author`, `description`, `preview`, `tokens`, `icons`, `textures`.
- **Param** `array $raw` — the manifest exactly as the author wrote it.
- **Param** `string $slug`
- **Return** `array`

### `openstation_legacy_theme_manifest_path` — Experimental *(filter)*

Absolute path the built-in **Desktop Mode (Legacy)** theme reads its
`theme.json` from. Legacy is a frozen snapshot of the shell's own
defaults, registered from code on `init` priority 5 — see
[desktop-themes.md](./desktop-themes.md#the-legacy-theme--start-here).
Point this at your own file to ship a forked token set under the same
registration; to remove the theme entirely, call
`openstation_unregister_desktop_theme( 'desktop-mode/legacy' )` on
`init` at a priority above 5.

- **Param** `string $path` — defaults to `assets/desktop-themes/legacy/theme.json` inside the plugin.
- **Return** `string`

### `openstation_desktop_theme_upload_capability` — Experimental *(filter)*

Capability required to upload or delete themes. Default
`manage_options`. **Picking** a theme is per-user and never gated.

- **Param** `string $capability`
- **Return** `string`

### `openstation_desktop_theme_icon_slots` — Experimental *(filter)*

The icon slots a manifest may address. Entries not on this list — and
not matching the dynamic `APP:<slug>` pattern — are dropped during
sanitization.

**This list must stay equal to the `DESKTOP_THEME_SLOTS` constants in
`src/desktop-themes/slots.ts`.** A slot added on one side only is
either silently dropped at upload time or silently never consulted at
render time.

- **Param** `string[] $slots`
- **Return** `string[]`

### `openstation_desktop_theme_texture_slots` — Experimental *(filter)*

Map of texture slot => slot definition. **The compiler reads this table
and nothing else**, so an entry with both `type` and `prop` is fully
wired end to end: the sanitizer accepts it and the compiler emits it.
All that is left is a CSS rule reading the property, which the plugin
adding the slot ships in its own stylesheet.

```php
add_filter( 'openstation_desktop_theme_texture_slots', function ( $slots ) {
    $slots['ACME_SIDEBAR'] = array(
        'type' => 'image',
        'prop' => '--acme-sidebar-image',
    );
    return $slots;
} );
```

Definition keys:

| Key | Meaning |
|---|---|
| `type` | `image` or `border-image`. Selects the descriptor grammar and the properties written. |
| `prop` | Custom-property base name. `image` emits `<prop>`, `<prop>-repeat`, `<prop>-size`; `border-image` emits `<prop>-source`, `-slice`, `-width`, `-repeat`. |
| `companions` | `false` for a variant slot that inherits another's repeat + size (`TITLEBAR_FOCUSED`). |
| `sizeGroup` | Custom property shared by slots that must render at one size; first declared wins (the window corners). |

An entry with no `prop` is accepted but emits nothing.

- **Param** `array<string,array> $slots`
- **Return** `array<string,array>`
See [Texturing your own surface](./desktop-themes.md#texturing-your-own-surface).

> **Icon tinting** is a manifest field (`iconColor`, and `color` per
> icon), not a PHP filter. Its JS-side filter is
> `os.os-theme.icon-color` — see the
> [JavaScript reference](./javascript-reference.md#desktop-themes-experimental).

### `openstation_desktop_theme_wallpaper_label` — Experimental *(filter)*

Picker label for a wallpaper contributed by a desktop theme. Default
`<name> - (theme)`, or `<name>: <own label> - (theme)` when the
wallpaper carries its own label.

- **Param** `string $label`
- **Param** `string $name` — theme display name.
- **Param** `string $slug` — theme slug.
- **Param** `string $own_label` — the wallpaper's own label, or `''`.
- **Return** `string`

### `openstation_desktop_theme_max_wallpapers` — Experimental *(filter)*

How many wallpapers one theme may contribute to the picker.

- **Param** `int $max` — default 12.
- **Return** `int`

### `openstation_desktop_theme_asset_extensions` — Experimental *(filter)*

File extensions accepted for one kind of theme asset. Two kinds exist
and they are deliberately disjoint, so an icon reference can never
resolve to a font file or the other way round.

- **Param** `string[] $extensions` — `image`: `png jpg jpeg gif webp avif svg`. `font`: `woff2 woff ttf otf`.
- **Param** `string $kind` — `'image'` or `'font'`.
- **Return** `string[]`

> An unrecognised `$kind` returns an empty list, so a typo fails closed.

> Adding anything the browser parses as script (`css`, `js`, `html`,
> `xml`, `svgz`) or anything the server executes defeats the security
> model of the whole feature.

### `openstation_desktop_theme_recommended_os_settings_schema` — Experimental *(filter)*

The OS-settings keys a theme's `recommendedOsSettings` block may
address, and the grammar each is validated against. Keys not on this
list are dropped during sanitization.

```php
add_filter(
    'openstation_desktop_theme_recommended_os_settings_schema',
    function ( $schema ) {
        // A closed set of values PHP knows in full.
        $schema['acmeDensity'] = array( 'enum' => array( 'cosy', 'roomy' ) );
        // An id resolved against a JS registry at apply time.
        $schema['acmeRenderer'] = array( 'slug' => true );
        // A whole number, clamped into range.
        $schema['acmeDelay'] = array( 'int' => array( 'min' => 0, 'max' => 500 ) );
        return $schema;
    }
);
```

Core ships eight entries: `dockSize`, `desktopLayout`, `dockPlacement`,
`windowRadius` and `adminBarMode` as `enum` rules mirroring the matching
`OPENSTATION_OS_SETTINGS_*` constants; `dockRailRenderer` and
`windowReveal` as `slug` rules; and `windowRevealDuration` as an `int`
rule bounded by `OPENSTATION_OS_SETTINGS_REVEAL_DURATION_MIN` /
`_MAX`.

Three grammars:

| Grammar | Shape | Validation |
|---|---|---|
| `enum` | `array( 'enum' => array( … ) )` | Value must be in the list, else the key drops. |
| `slug` | `array( 'slug' => true )` | PHP checks the `sanitize_key()` charset; the shell drops the key at apply time when nothing is registered under that id. |
| `int` | `array( 'int' => array( 'min' => …, 'max' => … ) )` | Numeric values are **clamped** into range rather than dropped; non-numeric values drop. |

An entry with none of a non-empty `enum` array, `slug => true`, or a
well-formed `int` range (`min` and `max` both numeric, `min <= max`) is
dropped — a malformed rule fails closed rather than admitting
anything.

> Whatever is added here gets written into user meta the first time a
> user activates a theme that recommends it, so keep the list to
> **presentation**. Feature switches and capability-adjacent settings
> do not belong in a theme manifest. The shell applies a recommended
> key only when the setting already exists and its current value has
> the **same type** as the recommended one, so a widened schema still
> cannot introduce a setting, retype one, or flip a boolean.

- **Param** `array<string,array> $schema` — map of settings key => `{ enum }`, `{ slug }`, or `{ int }`.
- **Return** `array<string,array>`

### `openstation_desktop_theme_font_caps` — Experimental *(filter)*

How many `@font-face` rules one theme may declare, and how many source
files each may list.

- **Param** `array $caps` — `max_faces` (16), `max_sources` (4).
- **Return** `array`

### `openstation_desktop_theme_zip_caps` — Experimental *(filter)*

Caps enforced while walking an uploaded archive.

```php
add_filter( 'openstation_desktop_theme_zip_caps', function ( $caps ) {
    $caps['max_uncompressed'] = 64 * 1024 * 1024;
    return $caps;
} );
```

- **Param** `array $caps` — `max_entries` (256), `max_uncompressed` (32 MB), `max_file` (8 MB), `extensions` (`json txt md` plus both lists from `openstation_desktop_theme_asset_extensions`).
- **Return** `array`

> `txt` / `md` are accepted so an archive can carry the licence notice a
> bundled font obliges an author to ship. No manifest field can
> reference them, so they are validated and then discarded with the
> staging directory — they never reach the live theme directory.

> Widening `extensions` to anything executable, or anything the browser
> parses as script (`css`, `js`, `html`, `xml`), defeats the security
> model of the whole feature.

### `openstation_desktop_themes_base_dir` — Experimental *(filter)*

Absolute path of the theme storage directory (no trailing slash).
Default `uploads/desktop-mode-themes`. Whatever this points at **must
be web-servable** — the compiled stylesheet and every image are loaded
by the browser.

- **Param** `string $base`
- **Return** `string`

### `openstation_desktop_themes_base_url` — Experimental *(filter)*

Public URL of the same directory. Must resolve to the same bytes as
`openstation_desktop_themes_base_dir`.

- **Param** `string $url`
- **Return** `string`

### `openstation_agent_faces_base_dir` — Experimental *(filter)*

Absolute path of the agent-face storage directory (no trailing slash).
Default `uploads/desktop-mode-agent-faces`. Each agent's portrait is
written here as an SVG named `<agentId>-<hash>.svg`, and served as its
avatar wherever `get_avatar()` runs.

Whatever this points at **must be web-servable**. The directory is
hardened exec-off rather than deny-all for exactly that reason: a
portrait that cannot be fetched is a broken avatar on every screen the
agent appears on.

- **Param** `string $base`
- **Return** `string`

### `openstation_agent_faces_base_url` — Experimental *(filter)*

Public URL of the same directory. Must resolve to the same bytes as
`openstation_agent_faces_base_dir`.

- **Param** `string $url`
- **Return** `string`

### `openstation_desktop_themes_payload_cap` — Experimental *(filter)*

How many themes are announced to the shell. Default 24.

- **Param** `int $cap`
- **Return** `int`

---

## AI Agents

Opt-in module behind the `agents` extended option (OpenStation Preferences →
Features → Extended options, admin-only, default off). While the flag
is off none of these hooks exist — `includes/agents/bootstrap.php`
skips every module file.

**Two exceptions** load unconditionally, ahead of the flag:

- `includes/agents/guard.php` owns `openstation_agent_is_agent()` and
  every login/session block. Disabling the feature does not delete
  agent user rows, and a row whose blocks unloaded with the feature
  would accept application passwords and password resets again — so
  the blocks are a property of the rows, not of the feature.
- `includes/agents/my-wordpress.php` adds the Agents section to WP
  Explorer, so the section is always listed for anyone who passes
  `openstation_agents_user_can_read`. While the flag is off the
  section config carries `enabled => false` and the bundle paints it
  read-only without issuing a single request — the REST routes below
  genuinely do not exist then. The three capability filters and
  `openstation_agent_avatar_url()` live in `bootstrap.php` for the
  same reason: the section descriptor needs them while `rest.php` and
  `identity.php` are unloaded.

An agent is a synthetic `wp_users` row (login-blocked) whose entire
definition lives as user meta on that row: description, instructions
(system prompt), ability allowlist, triggers, model override, rate
limit. There are no revisions on user meta — the
`openstation_agent_{created,updated,deleted}` actions below ARE the
audit trail; each carries before/after values for logging plugins to
persist.

Agents act with capability, so read
[Agents security model](./agents-security.md) before registering an
ability agents can call or widening any of the gates below. The short
version: an agent's run is ceilinged at the invoker's own capabilities,
and tool output is untrusted input.

### `openstation_agents_enabled` — Experimental *(filter)*

Whether the agents framework is enabled site-wide. Runs on
`plugins_loaded` (priority 5) to decide whether the module loads at
all, and again wherever the enabled state is consulted.

- **Param** `bool $enabled` — default: the `agents` extended option.

### `openstation_agent_created` — Experimental *(action)*

Fires after `openstation_agent_create()` finishes writing the user
row and definition meta.

- **Param** `int $user_id` — agent user id.
- **Param** `array $args` — sanitized creation fields `{ name, role, description, instructions, abilities }`.
- **Param** `int $actor_id` — user who created the agent.

### `openstation_agent_updated` — Experimental *(action)*

Fires once per `openstation_agent_update()` call that changed at
least one field. No-op updates never fire it.

- **Param** `int $user_id` — agent user id.
- **Param** `array $changed` — map of `field => { from, to }` for every field that changed (`name`, `role`, `description`, `instructions`, `abilities`, `triggers`, `model`, `rateLimit`).
- **Param** `int $actor_id` — user who made the change.

### `openstation_agent_deleted` — Experimental *(action)*

Fires after `openstation_agent_delete()` removed the user row (and
with it every definition meta row).

- **Param** `int $user_id` — agent user id (row no longer exists when this fires).
- **Param** `int $actor_id` — user who deleted the agent.

### `openstation_agent_completed` — Experimental *(action)*

Fires after every successful invocation. The audit + chaining seam:
logging plugins persist the run, and the future agent-to-agent trigger
consumes it.

- **Param** `int $agent_user_id`
- **Param** `string $message` — the submitted message.
- **Param** `array $result` — `{ text, toolCalls, turns }`.
- **Param** `array $context` — invocation context; convention: `source` names the trigger (`chat`, `send-to`, `hook`, …).

### `openstation_agent_tool_result` — Experimental *(filter)*

Filters one tool result before it re-enters the LLM context and
before it lands in the invocation trace. The sanitization seam —
strip fields the model has no business seeing.

Tool output is **untrusted input**: it carries site content that a
lower-privileged user may have authored (a comment body, a submitted
draft, alt text). The runner wraps every result in an
`<untrusted-tool-output>` fence and instructs the model to treat the
contents as data, never instructions. That is mitigation, not a
guarantee — this filter is where you strip anything an ability returns
that the model should never see in the first place. See
[Agents security model](./agents-security.md).

- **Param** `mixed $output` — raw ability output.
- **Param** `string $slug` — ability slug.
- **Param** `array $args` — call arguments.
- **Param** `int $agent_user_id`

### `openstation_agent_runner_generate` — Experimental *(filter)*

Pre-filter for one generation turn. Return a non-null
`{ text, function_calls, message }` array (or a `WP_Error`) to
short-circuit the Core AI Client — the seam PHPUnit and alternative
runtimes plug into. When any callback is attached, the runner
considers itself available even without the WP 7.0 AI Client. On a
transient provider failure (a gateway 5xx, a timeout, an empty
Anthropic `content`, a failed models-list fetch) the loop retries the
turn once, so the filter can be invoked twice for the same turn.

- **Param** `array|WP_Error|null $generated` — null to proceed with the AI Client.
- **Param** `array $history` — neutral history rows (`{ type: 'user_text'|'assistant'|'tool_results', … }`).
- **Param** `array $tool_defs` — neutral tool definitions (`{ name, description, parameters }`).
- **Param** `string $instructions` — system instruction.
- **Param** `int $agent_user_id`

### `openstation_agent_history_turn_cap` — Experimental *(filter)*

How many conversation turns a caller may replay into one agent run
via the `history` param of `POST /agents/{id}/invoke`. Each turn is
additionally capped to 4000 characters, so this is the knob that
bounds the prompt (and the bill) per invocation. Default 50.

- **Param** `int $turn_cap`

### `openstation_agent_draft` — Experimental *(filter)*

Pre-filter for `POST /agents/draft`, the "Draft it for me" step of
the create flow. Return a non-null array shaped like the route's
response (`{ name, description, vibes, instructions, role, abilities }`,
or a `WP_Error`) to short-circuit the Core AI Client, the seam PHPUnit
and alternative runtimes plug into. Whatever comes back is still
filtered against the site's catalogues: a role outside
`openstation_agent_allowed_roles()` becomes `''`, unknown ability
slugs are dropped, `vibes` is cut at 120 characters. Nothing is
created; the wizard shows the draft for review.

- **Param** `array|WP_Error|null $draft` — null to proceed with the AI Client.
- **Param** `string $brief` — the brief, trimmed.
- **Param** `string[] $roles` — role slugs the site allows for agents.
- **Param** `array $catalogue` — the abilities catalogue rows (`{ slug, label, description, category, readonly }`).
- **Param** `int $user_id` — requesting user id.

### `openstation_agent_conversation_cap` — Experimental *(filter)*

How many persisted chat conversations are kept per user (the
`desktop_mode_chat` post type behind `/agents/conversations`).
Creating past the cap prunes the caller's least recently updated
rows. Default 100.

- **Param** `int $cap`

### `openstation_agent_trigger_kinds` — Experimental *(filter)*

The trigger-kind catalogue (`chat`, `send-to`, `drag`, `hook`,
`endpoint`, `agent`). Each entry declares `slug`, `label`,
`description`, `icon`, and a JSON-Schema `config_schema` for its
`trigger.config` shape. `chat`, `send-to` and `drag` are wired; the other kinds
are declared so configuration can be stored ahead of their intakes. The
UI draws one fixed card per wired kind (chat always on; a kind whose
`config_schema` has `entityKinds` gets the entity-kind checkboxes, any
other wired kind an On switch), and preserves stored rows of kinds it
does not draw.
The `drag` config's `entityKinds` gates which entity drops the agent
accepts (empty = every kind; no drag trigger = drops rejected), and
ships inline on the agent's desktop user-file payload as
`agentDragKinds` so tile drop gating is synchronous.

- **Param** `array $kinds`

### `openstation_agent_hooks_catalogue` — Experimental *(filter)*

Curated hook suggestions offered by the Hook-trigger configurator
(`{ hook, when }` rows). Not a whitelist yet — the intake lands in a
later phase.

- **Param** `array $hooks`

### `openstation_agent_abilities_catalogue` — Experimental *(filter)*

The abilities catalogue behind the Tools picker: every registered
ability projected to `{ slug, label, description, category, readonly }`.
Sites can narrow the pickable set or append rows; the preferred
extension path stays `wp_register_ability()`.

- **Param** `array $catalogue`

### `openstation_agent_allowed_roles` — Experimental *(filter)*

Candidate roles an agent may be assigned. Each survivor is intersected
with `get_editable_roles()` and then run through
`openstation_agent_actor_can_assign_role`, so this filter can narrow
or extend the candidate list but a role it adds still has to clear both
constraints.

- **Param** `string[] $whitelist` — default `administrator`, `editor`, `author`, `contributor`.

### `openstation_agent_actor_can_assign_role` — Experimental *(filter)*

Whether the acting user may grant a role to an agent. An agent runs
with its role's capabilities, so granting the role IS granting
capability. Defaults require `promote_users`, plus a genuine
administrator (super admin on multisite) for the `administrator` role.

Note `get_editable_roles()` alone is **not** a per-user constraint —
core implements it as a bare `apply_filters( 'editable_roles',
wp_roles()->roles )` with no reference to the current user, so on a
stock install it excludes nothing. This filter is the actual gate.

Use it for automation that creates agents outside a request context
(activation routines, WP-CLI, provisioning jobs), where there is no
current user and the default answer is a hard no.

- **Param** `bool $can`
- **Param** `string $role` — role slug being assigned.
- **Param** `int $user_id` — acting user id (0 when there is none).

### `openstation_agent_restrict_to_invoker` — Experimental *(filter)*

Whether one run is capped at the invoking user's capabilities. Default
true whenever a human triggered the run.

The runner switches the current user to the agent for the whole tool
loop, so ability `permission_callback`s evaluate against the agent's
role. Alongside that switch it installs a `user_has_cap` filter that
turns off every primitive capability the invoker does not hold — an
agent must never do on your behalf what you could not do yourself.
Without it the module is a confused deputy: invoking is gated on
`edit_posts`, agents may hold `administrator`.

Returning `false` lets the agent act with its full role. Only
appropriate when the message cannot be influenced by a lower-privileged
user. Returning `true` for a system-context run (`$invoker_id` 0) is a
no-op — there is no cap set to intersect with.

- **Param** `bool $restrict`
- **Param** `int $agent_user_id`
- **Param** `int $invoker_id` — 0 when there is no invoker.

### `openstation_agent_user_can_invoke_agent` — Experimental *(filter)*

Whether the current user may invoke a **specific** agent through a
specific source. `openstation_agents_user_can_invoke` is the site-wide
half ("may this user invoke agents at all"); this is the per-agent
half.

Default: honours the `capability` declared in the matching trigger's
config. An agent with no trigger for that source, or one declaring no
capability, falls back to the route-level check — requiring a
configured trigger would lock out every agent created before triggers
were set up.

- **Param** `bool $can`
- **Param** `int $agent_user_id`
- **Param** `string $source` — `chat`, `drag`, or `send-to`.
- **Param** `array|null $trigger` — the matching trigger row, if any.

### `openstation_agent_default_rate_limit` — Experimental *(filter)*

Default invocations-per-hour cap applied when the agent has no
per-agent override. Bounds one agent.

- **Param** `int $limit` — default 60.
- **Param** `int $agent_user_id`

### `openstation_agent_invoker_rate_limit` — Experimental *(filter)*

Per-user cap on agent invocations per hour, counted across every agent
on the site. Bounds the *person*: the per-agent limit does nothing to
stop one user walking every agent in turn and spending the AI budget N
times over. System-context runs (no invoker) are not counted.

- **Param** `int $limit` — default 120.
- **Param** `int $invoker_id`

### `openstation_agent_http_timeout` — Experimental *(filter)*

Seconds allowed for one agent generation request to the AI provider,
replacing the WordPress HTTP default of 5.

The AI Client's HTTP adapter issues provider calls through
`wp_safe_remote_request()` and sets a `timeout` arg only when the caller
supplies `RequestOptions`. Without one the WordPress default applies,
and a generation over a long post routinely exceeds it — the transport
aborts mid-flight and the SDK reports it as a *network* error, which at
the UI is indistinguishable from the provider being down.

The override is scoped to the AI Client call, so tool dispatch between
turns keeps the site's normal timeout, and it only ever **raises** the
value — a site already allowing longer keeps its own. It bounds a single
request, not the whole run: the loop makes up to 8.

Return `0` to leave the site's timeout untouched.

- **Param** `int $timeout` — seconds; default 180 (`OPENSTATION_AGENT_HTTP_TIMEOUT`).

```php
// Slow local model — allow five minutes per turn.
add_filter( 'openstation_agent_http_timeout', fn() => 300 );
```

### `openstation_agents_user_can_read` / `openstation_agents_user_can_manage` / `openstation_agents_user_can_invoke` — Experimental *(filters)*

The three permission gates on the REST surface and the UI. Defaults:
read `edit_posts`, manage `edit_users`, invoke `edit_posts`.

All three are available even when the agents feature is off
(bootstrap.php) — `openstation_agents_user_can_read` decides whether
the always-listed WP Explorer section appears at all.

- **Param** `bool $can`

### PHP helpers — Experimental

- `openstation_agent_is_agent( $user )` — marker-meta test. Available even when the agents feature is off (guard.php).
- `openstation_agent_avatar_url()` — the bot avatar file URL. Available even when the agents feature is off (bootstrap.php).
- `openstation_agent_create( $args )` / `openstation_agent_update( $user_id, $fields )` / `openstation_agent_delete( $user_id, $reassign )` — the orchestrators (the only write paths; each fires its audit action). These are **privileged internal APIs**: they enforce role assignment (see `openstation_agent_actor_can_assign_role`) but assume the caller already checked who is asking. The REST surface does that with `edit_users`; a direct caller must do the same.
- `openstation_agent_get_agents( $args )` — list every agent.
- `openstation_agent_get_{description,instructions,abilities,triggers,model,rate_limit}( $user_id )` — definition getters.
- `openstation_agent_invoke( $agent_user_id, $message, $context )` — run the agent (identity switch, invoker cap ceiling, tool loop, turn cap 8, rate limits). `$context['source']` names the trigger; `$context['invoker']` is the user whose capabilities ceiling the run (defaults to `get_current_user_id()`; pass `0` deliberately for a system-context run); `$context['history']` replays prior conversation turns (`[ { role: 'user'|'agent', text }, … ]`, oldest first, capped at the 50 most recent × 4000 chars each). **Pass the history for any follow-up message**: without it the run is contextless, so "yes, do it" resolves against nothing and the agent may act on a different entity than the one just discussed.
- `openstation_agent_user_can_invoke_agent( $agent_user_id, $source )` — the per-agent invocation gate. Call it before `openstation_agent_invoke()` from any new trigger intake.
- `openstation_agent_trigger_for_source( $agent_user_id, $source )` — the agent's trigger row for an invocation source, or null.
- `openstation_agent_runner_get_log( $agent_user_id )` — recent invocations (capped at 50).
- `openstation_agents_abilities_catalogue()` — the picker catalogue.

---

## Solo window rendering mode — Experimental

`?openstation_solo=<window-id>` boots the whole shell and paints exactly
one window: no dock, taskbar, wallpaper or desk, and no session restore.
Built for the native desktop host, which uses it to give a *native*
window — one with no URL of its own — to a real OS window. Nothing about
it is Electron-specific: an embed, a kiosk screen or a PWA shortcut can
point at the same flag.

It is a **rendering mode, not an access grant**. The flag is ignored for
a user who has not turned OpenStation on, and every capability check on
the underlying screen applies exactly as it would anywhere else.

Full narrative: [Native Desktop Host](./desktop-host.md).

### `openstation_solo_window_id` — Experimental *(filter)*

The window id booted in solo mode. Return `''` to refuse solo mode for
this request — the hook for gating single-window rendering by role or by
window.

```php
apply_filters( 'openstation_solo_window_id', string $id, string $raw );
```

### PHP helpers — Experimental

- `openstation_solo_window_id()` — `''` unless this is a solo request.
- `openstation_is_solo_request()`.

Shell config gains one key, `soloWindow`.

### Electron Adapter hooks

The desktop-host contract — handshake, liveness heartbeat, and the
`openstation_electron_*` filters and actions — lives in the **Electron
Adapter extension**, not in core. See
[Native Desktop Host → Adapter hooks](./desktop-host.md#adapter-hooks).

### Other bundled-extension hooks

The extensions under `extensions/` fire their own prefixed hooks, which
this reference does not enumerate: `openstation_code_editor_*`
(capability gate, workspace root, extension allowlist, save
pipeline, PHP indexing, REST limits, template/window/icon args —
`extensions/desktop-mode-code-editor/includes/`),
`openstation_cron_manager_*` (capability gate, template/window/icon
args — `extensions/desktop-mode-cron-manager/includes/`), and
`openstation_phpmyadmin_user_can_use`
(`extensions/desktop-mode-phpmyadmin/includes/window.php`). Each hook
carries a docblock at its call site; the extension source is the
reference until these graduate into a doc of their own.

---

## See also

- [Native Desktop Host](./desktop-host.md) — solo mode, the Electron Adapter extension, and `wp.os.electron`.
- [JavaScript Reference](./javascript-reference.md) — the event + postMessage side of the contract.
- [Examples](./examples/README.md) — full-plugin recipes.
