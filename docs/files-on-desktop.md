# Files on the Desktop

**Status:** Experimental.

The Files-on-the-Desktop system lets users place WordPress entities — posts, users, media, terms, comments, bookmarks — on their desktop wallpaper, organize them inside folders, and (in later phases) share folders with other users via Heartbeat-driven sync. Plugin authors extend the system by registering their own file types through the same surface the ten built-ins use.

This is an evolving feature. Phase 0 (this document's current scope) establishes the registry and the `OpenStation_File` base class. Future phases layer in:

| Phase | Adds |
|---|---|
| 1 | File-opener registry + per-user associations *(landed)* |
| 2 | Custom-table schema + REST + store *(landed)* |
| 3 | Desktop UI: tile rendering, in-desktop drag *(landed)* |
| 4 | Wallpaper context menu (replaces "minimize all" click) *(landed)* |
| 5 | OpenStation Preferences → File Associations tab *(landed)* |
| 6 | Folder sharing (private / users / roles / all) + Heartbeat sync *(landed)* |
| 7 | Drag from the Trash onto the desktop *(landed as "Pin to desktop"; HTML5 drag UX is a follow-up)* |

Each phase ships independently and is documented as it lands.

## Mental model

A **file** on the desktop is a `OpenStation_File` subclass adapting one WordPress entity (a post, a user, a comment …) to the shape the desktop UI expects: title, icon, preview, and a capability gate. Files don't know how to open themselves — that's a separate concern (Phase 1: the opener registry).

### Files are references, not copies

A placement is a **reference** to a WordPress entity, not a copy of it. Removing a placement drops the placement row only — the underlying post, user, attachment, comment, or term is **never** touched. The REST `DELETE /placements/<id>` defaults to a soft-trash into the recycle bin (restorable); `?force=1` permanently purges the row, and `openstation_files_remove()` is the hard-remove PHP API. Folder deletion cascades placements via tombstones but still leaves referenced entities intact. This is asserted in `Tests_OpenStation_FilesStore::test_remove_does_not_delete_underlying_entity` and is the core safety contract of the system. Plugins that want a "delete the post too" flow must call `wp_delete_post()` (or equivalent) themselves — the framework will not do it for them.

**The one deliberate exception is the `upload` type** (real file storage): an uploaded file has no life outside the desktop, so its placement OWNS the entity. Soft-trash keeps the bytes (restore works); when the owner's last placement of a file is **permanently** removed (recycle-bin purge / `?force=1`), the stored bytes, the row, its shares, and every recipient placement are deleted too. See [Real file storage](#real-file-storage-upload--experimental) below. Every other type keeps the reference contract unchanged.

A **file type** is a slug that points the registry at the right subclass. The built-ins are:

| Slug | Class | Reference shape |
|---|---|---|
| `post` | `OpenStation_Post_File` | post id (numeric string) |
| `attachment` | `OpenStation_Attachment_File` | attachment id |
| `upload` | `OpenStation_Upload_File` | stored-file row id (real bytes on the server — see [Real file storage](#real-file-storage-upload--experimental)) |
| `user` | `OpenStation_User_File` | user id |
| `term` | `OpenStation_Term_File` | `"<taxonomy>:<term_id>"` |
| `comment` | `OpenStation_Comment_File` | comment id |
| `folder` | `OpenStation_Folder_File` | folder row id (Phase 2) |
| `shortcut` | `OpenStation_Shortcut_File` | shortcut id; serialized shape carries `shortcutWindow` (registered native-window id) or `shortcutUrl`. Client-synthesized shortcuts for a promoted system tile carry `shortcutSystemTile` (the tile id) instead |
| `bookmark` | `OpenStation_Bookmark_File` | URL string |
| `link` | `OpenStation_Link_File` | URL string — opens in a new browser tab |
| `embed` | `OpenStation_Embed_File` | URL string — opens in an iframe-backed desktop window; geometry persists on `placement.meta.window` |

`link` and `embed` placements both carry an optional human-friendly label on `placement.meta.name` (set by the wallpaper-menu "New URL" entry) — the tile renderer prefers it over `file.title()` so two tiles pointing at the same URL can carry different labels. `embed` placements additionally persist `{ x, y, width, height }` on `placement.meta.window` after every drag-end / resize-end of the spawned window; the next open clamps that geometry to the current desktop area before restoring.

`link` placements also carry a server-resolved favicon on `placement.meta.iconUrl`. The string is a base64 data URI of the form `data:image/(png|jpeg|gif|webp|x-icon|svg+xml);base64,<payload>`. The favicon resolver runs inline during `POST /placements` (server-side, via `wp_safe_remote_get` + `DOMDocument` parsing of the page's `<link rel="icon">` tags, with a `/favicon.ico` fallback). When the resolver fails — bad host, network error, oversized body, content-type mismatch — `meta.iconUrl` is omitted and the tile falls back to the file type's dashicon. Icons are capped at 256 KB raw bytes, enforced during the download via `limit_response_size` (WP_Http stops reading one byte over the cap, and the truncated over-cap body is then rejected by the size check — never buffered whole); the cap keeps `meta` blobs small. The step-1 page-HTML fetch is itself capped at 1 MB (`OPENSTATION_FAVICON_MAX_PAGE_BYTES`). Plugins can short-circuit or override the resolved value via the `openstation_resolve_favicon` filter. The `meta.iconUrl` precedence is generic — any plugin can attach a custom per-placement icon (URL or data URI) on any type, not just `link`.

`page` and any custom post type collapse into `post`; `category` and `post_tag` collapse into `term`. UI labels per concrete post type / taxonomy come from the `openstation_file_serialize` filter — there's no need to register a separate type for every CPT.

## Registering a file type

PHP:

```php
add_action( 'init', static function () {
    require_once __DIR__ . '/class-jorvy-quote-file.php';
    openstation_register_file_type( 'jorvy-quote', array(
        'label' => __( 'Marvel quote', 'jorvy' ),
        'class' => 'Jorvy_Quote_File',
        'sort'  => 200,
    ) );
}, 6 ); // priority 6 so we land after the built-ins (5).
```

`Jorvy_Quote_File` extends `OpenStation_File` and overrides the methods that don't fit the defaults. The base shape is intentionally minimal:

```php
class Jorvy_Quote_File extends OpenStation_File {

    public static function type(): string {
        return 'jorvy-quote';
    }

    public function title(): string {
        return jorvy_get_quote( (int) $this->ref )['quote'];
    }

    public function icon(): string {
        return 'dashicons-star-filled';
    }

    public function can_read( int $user_id ): bool {
        return user_can( $user_id, 'read' );
    }
}
```

JS — to control how the tile renders beyond the metadata PHP serialized:

```js
class JorvyQuoteFile extends wp.os.files.DesktopFile {
    type() {
        return 'jorvy-quote';
    }
    title() {
        return `🦸 ${ this.shape.title }`;
    }
}

wp.os.files.registerType( {
    type: 'jorvy-quote',
    label: 'Marvel quote',
    sort: 200,
    DesktopFile: JorvyQuoteFile,
} );
```

The PHP and JS sides are independent: shipping only the PHP class is enough to get a tile rendering, because the JS registry falls back to `DefaultDesktopFile` when no JS class is registered for a slug. Plugins opt into JS-side rendering when they need title / icon / preview computation that depends on JS-side data the PHP serialization didn't ship.

## Hooks

### PHP

| Hook | Type | Signature | Purpose |
|---|---|---|---|
| `openstation_file_types` | filter | `( array[] $registry ) => array[]` | Final list of registered types, keyed by slug. Plugins can hide built-ins or swap a class out. |
| `openstation_file_type_registered` | action | `( string $type, array $entry ) => void` | Fires after a successful `openstation_register_file_type()` call. Does NOT fire on `WP_Error`. |
| `openstation_file_serialize` | filter | `( array $shape, OpenStation_File $file ) => array` | Last-mile mutation of the JS-bound shape. Attach badges, override labels, splice in custom render hints. |
| `openstation_file_openers` | filter | `( array[] $registry ) => array[]` | Filter the opener registry. Hide built-ins, swap labels. |
| `openstation_resolve_file_opener` | filter | `( string $opener_id, string $type, int $user_id ) => string` | Override the resolution chain — useful for forced role-based associations. |
| `openstation_file_opener_registered` | action | `( string $id, array $entry ) => void` | Fires after a successful `openstation_register_file_opener()` call. |

### JavaScript

| Hook | Type | Signature | Purpose |
|---|---|---|---|
| `os.files.types` | filter | `( DesktopFileTypeDef[] ) => DesktopFileTypeDef[]` | Reorder / hide / override types in pickers. |
| `os.files.type-registered` | action | `( type: string, def: DesktopFileTypeDef ) => void` | Fires after a successful `wp.os.files.registerType()` call. |
| `os.files.type-unregistered` | action | `( type: string ) => void` | Fires after `unregisterType()`. |
| `os.files.openers` | filter | `( FileOpenerDef[] ) => FileOpenerDef[]` | Filter the opener list shown in pickers. |
| `os.files.resolve-opener` | filter | `( FileOpenerDef \| null, type: string ) => FileOpenerDef \| null` | Override the resolution chain at click time. |
| `os.files.opener-registered` | action | `( id: string, def: FileOpenerDef ) => void` | Fires after `registerOpener()`. |
| `os.files.opener-unregistered` | action | `( id: string ) => void` | Fires after `unregisterOpener()`. |
| `os.files.opening` | action | `( { file, openerId } ) => void` | Fires before the opener handler runs. |
| `os.files.opened` | action | `( { file, openerId, kind } ) => void` | Fires on successful open. |
| `os.files.open-failed` | action | `( { reason, type, ref, openerId?, error? } ) => void` | Fires when no opener resolved or the handler threw. |

## Public API

### PHP

- `openstation_register_file_type( string $type, array $args ): true|WP_Error`
- `openstation_get_file_type( string $type ): array|null`
- `openstation_get_file_types(): array[]`
- `openstation_resolve_file( string $type, $ref ): OpenStation_File|null`
- `openstation_register_file_opener( string $id, array $args ): true|WP_Error`
- `openstation_get_file_openers(): array[]`
- `openstation_get_file_openers_for_type( string $type ): array[]`
- `openstation_resolve_file_opener_id( string $type, int $user_id ): string`
- `openstation_get_user_file_associations( int $user_id ): array<string,string>`

### JavaScript (`wp.os.files`)

- `DesktopFile` — abstract base class.
- `registerType( DesktopFileTypeDef ): void`
- `unregisterType( type: string ): void`
- `getType( type: string ): DesktopFileTypeDef | null`
- `getTypes(): DesktopFileTypeDef[]`
- `resolve( shape: DesktopFileShape ): DesktopFile`
- `subscribe( cb: () => void ): () => void` — registry-change listener.
- `registerOpener( FileOpenerDef ): void` — `FileOpenerDef` accepts an
  optional `appliesTo( file )` predicate for per-FILE openers (e.g. the
  built-in `agent-chat` opener applies only to user files whose user is
  an agent). Predicate-bearing openers are excluded from type-level
  listings where no file is available (the default-apps settings tab).
- `unregisterOpener( id: string ): void`
- `getOpener( id: string ): FileOpenerDef | null`
- `getOpeners(): FileOpenerDef[]`
- `getOpenersForType( type: string, file?: DesktopFile ): FileOpenerDef[]`
- `resolveOpener( type: string, file?: DesktopFile ): FileOpenerDef | null`
- `subscribeOpeners( cb ): () => void`
- `getUserAssociations(): Record< string, string >`
- `open( file: DesktopFile ): Promise< boolean >` — full dispatcher.

## Openers — the file-association layer *(Phase 1)*

A **file opener** answers the question "what should happen when the user double-clicks a `post`?" It's the desktop-OS equivalent of an `.app` association. Multiple openers can register for the same file type; the user picks their preferred one (in OpenStation Preferences → File Associations, Phase 5), and the JS side resolves on every double-click.

### Resolution chain

1. The user's per-type override (`desktop_mode_file_associations` user meta).
2. The opener flagged `is_default` for the type.
3. The first registered opener for the type (sort order).
4. No-op (the file simply can't be opened — `wp.os.files.open()` returns `false`).

### Registering an opener

PHP-side metadata (the entry the OpenStation Preferences tab will show, and the entry the user-meta override is validated against):

```php
openstation_register_file_opener( 'classic-editor', array(
    'label'      => __( 'Classic Editor', 'classic-editor' ),
    'types'      => array( 'post' ),
    'is_default' => false,        // user must opt in via OpenStation Preferences
    'sort'       => 20,
) );
```

JS-side handler (the actual logic — closures don't serialize across the shell payload):

```js
wp.os.files.registerOpener( {
    id: 'classic-editor',
    label: 'Classic Editor',
    types: [ 'post' ],
    sort: 20,
    handler: {
        kind: 'url',
        url: ( file ) =>
            `${ wp.os.config.adminUrl }post.php?post=${ file.ref() }&action=edit&classic-editor`,
    },
} );
```

Three handler kinds:

- `url` — handler returns a URL; the framework opens it in a chromeless iframe window via `wp.os.windowManager.open`. Optional `windowId(file)` and `title(file)` overrides.
- `window` — handler points at a `openstation_register_window`-registered native-window id, with optional per-file `config(file)`. **Caveat:** the computed config is currently dropped by the shell's opener wiring (it opens the window by id without forwarding the config), so it never reaches `wp.os.getWindowConfig` — don't rely on per-file config delivery yet.
- `js` — handler runs free-form code in the shell context. Useful for modals, quick-actions, "preview" affordances.

### Built-in openers

| Opener id | Type | Kind | URL / target |
|---|---|---|---|
| `wp-post-editor` | `post` | `url` | `post.php?post=…&action=edit` |
| `wp-media-editor` | `attachment` | `url` | `post.php?post=…&action=edit` |
| `wp-user-profile` | `user` | `url` | `user-edit.php?user_id=…` |
| `wp-term-editor` | `term` | `url` | `term.php?taxonomy=…&tag_ID=…` |
| `wp-comment-editor` | `comment` | `url` | `comment.php?action=editcomment&c=…` |
| `browser-navigate` | `bookmark` | `js` | `window.open(url, '_blank', 'noopener,noreferrer')` — `url` is the server-sanitized `url` field from the serialized shape (the `esc_url_raw()` output), not the raw placement ref, and the protocol is re-validated client-side (http/https only) before opening. |
| `desktop-mode-link-opener` | `link` | `js` | Same as `browser-navigate`: server-sanitized `shape.url`, http/https re-validated, then `window.open(url, '_blank', 'noopener,noreferrer')`. |
| `desktop-mode-embed-opener` | `embed` | `js` | Opens an iframe-backed window at `url`. Reads `placement.meta.window` for restored geometry, clamps it to the current desktop area, and persists subsequent drag-end / resize-end back to `placement.meta.window` via REST. |
| `desktop-mode-folder-window` | `folder` | `js` | Opens a native folder window (breadcrumbs, tile grid, preview pane, status bar). |
| `desktop-mode-shortcut-opener` | `shortcut` | `js` | Opens the shortcut's registered native window (`shortcutWindow`) or its URL (`shortcutUrl`) in a desktop window — external origins fall back to a new browser tab. A `shortcutSystemTile` shortcut runs that dock tile's own `onOpen` instead, so a tile that toggles rather than opens behaves the same on both surfaces. |

The `desktop-mode-folder-window` and `desktop-mode-shortcut-opener` openers are registered JS-side only — unlike the other eight, they have no entry in the PHP metadata mirror (`includes/desktop-files/built-in-openers.php`), so don't expect them in `openstation_get_file_openers()`.

### Opening a file

```js
const file = wp.os.files.resolve( shape ); // shape from server
wp.os.files.open( file ); // returns Promise< boolean >
```

The dispatcher fires `os.files.opening` before invoking the handler and `os.files.opened` after success (or `os.files.open-failed` on no-opener / handler-throw). `opening` carries `{ file, openerId }`, `opened` carries `{ file, openerId, kind }`, and `open-failed` carries `{ reason, type, ref, openerId?, error? }` (see the hooks table above).

### User associations

The current user's `{ type → openerId }` choices live in user meta `desktop_mode_file_associations`. Phase 5's OpenStation Preferences tab is the canonical writer; reading happens automatically — the shell config seeds `wp.os.files.getUserAssociations()` on boot, and `setUserAssociations()` is called once during init.

Plugins that ship a "force-this-opener-for-role-X" feature should hook the resolution filter rather than touching user meta:

```php
add_filter( 'openstation_resolve_file_opener', function ( $opener_id, $type, $user_id ) {
    if ( 'post' === $type && user_can( $user_id, 'editor' ) ) {
        return 'classic-editor';
    }
    return $opener_id;
}, 10, 3 );
```

## Persistence — schema, REST, store *(Phase 2)*

### Custom tables

Three tables back the system, created via `dbDelta` on plugin activation and refreshed lazily on `admin_init` when `OPENSTATION_FILES_SCHEMA_VERSION` mismatches the option.

| Table | Purpose | Key columns |
|---|---|---|
| `{prefix}desktop_mode_file_placements` | One row per placed tile | `owner_id`, `parent_id`, `file_type`, `file_ref`, `x`, `y`, `sort_order`, `updated_at_ms`, `meta` (JSON) |
| `{prefix}desktop_mode_folders` | Folder rows | `owner_id`, `name`, `share_mode`, `share_meta` (JSON), `updated_at_ms` |
| `{prefix}desktop_mode_file_tombstones` | Removal ledger for delta sync | `kind` (`placement` / `folder`), `ref_id`, `removed_at_ms` |

Tombstones are pruned daily via `desktop_mode_files_daily_prune` (default retention: 7 days).

### REST endpoints

All under `/wp-json/desktop-mode/v1/files`. Permission gate: logged-in + OpenStation enabled. Per-row gating happens inside the store.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/placements?folder=<id>` | List the viewer's placements under `<id>` (0 = desktop root). |
| `POST` | `/placements` | `{ parentId?, type, ref, x?, y?, sortOrder?, meta? }` |
| `PATCH` | `/placements/<id>` | `{ parentId?, x?, y?, sortOrder?, meta? }` |
| `DELETE` | `/placements/<id>` | Soft-trash to the recycle bin (restorable). Pass `?force=1` to permanently purge. |
| `GET` | `/folders` | List folders the viewer owns (Phase 6 expands to shared folders). |
| `POST` | `/folders` | `{ name, shareMode?, shareMeta? }` |
| `PATCH` | `/folders/<id>` | `{ name?, shareMode?, shareMeta? }` |
| `DELETE` | `/folders/<id>` | Soft-trash the folder + cascades child placements (restorable). `?force=1` permanently deletes the folder and the cascaded placements. |
| `PUT` | `/associations` | Replace the viewer's `{ type → openerId }` map (Phase 5 settings tab writer). |

### PHP store API

```php
openstation_files_place( int $user_id, int $parent_id, string $type, string $ref, array $args = [] ): int|WP_Error;
openstation_files_move( int $placement_id, int $user_id, array $changes ): true|WP_Error;
openstation_files_remove( int $placement_id, int $user_id ): true|WP_Error;
openstation_files_get_placement( int $placement_id ): array|null;
openstation_files_get_for_user_folder( int $user_id, int $parent_id = 0 ): array;

openstation_files_create_folder( int $owner_id, array $args ): int|WP_Error;
openstation_files_update_folder( int $folder_id, int $user_id, array $changes ): true|WP_Error;
openstation_files_delete_folder( int $folder_id, int $user_id ): true|WP_Error;
openstation_files_get_folder( int $folder_id ): array|null;
openstation_files_get_visible_folders( int $user_id ): array;

openstation_files_share_modes(): array;          // ['private','users','roles','all']
openstation_files_table_names(): array;
openstation_files_now_ms(): int;
```

Placement-write path actions: `openstation_file_placed( $id, $row )`, `openstation_file_moved( $id, $next, $prev )`, `openstation_file_unplaced( $id, $row )`.
Folder-write path: `openstation_folder_created`, `_updated`, `_shared`, `_deleted`.
Read filter: `openstation_files_query_args( $args, $user_id, $parent_id )`.
Visibility filter (advisory in Phase 2, load-bearing in Phase 6): `openstation_files_visible_folders( $folders, $viewer_id )`.

### JS store + REST

`wp.os.files.store` exposes a `createSharedStore`-backed cross-bundle state holder; `wp.os.files.rest` is the typed REST client.

Boot hydration of the **root folder** (`folderId 0`) does not hit REST: the shell config inlines `filesBootPlacements` (built server-side by the same code path as `GET /files/placements?folder=0`) and the file layer seeds the store from it one-shot. Any later hydration — subfolders, restore-sync re-fetches, heartbeat resyncs — goes through `listPlacements()` as before.

The **folders map** is seeded the same way, from `filesBootFolders` (same shape and visibility resolution as `GET /files/folders`), consumed one-shot by `seedBootFolders()`. Placements and folder rows are separate state: a placement says *where a tile sits*, a folder row says *who owns it and how it is shared*. Anything gating on ownership reads the folder row, so the map has to be populated on a plain reload and not only after a create, a rename or an untrash — see [folder-sharing.md](folder-sharing.md#what-the-desktop-can-see-about-a-share).

```ts
interface FilesState {
    placementsByFolder: Map< number, RestPlacementShape[] >;
    folders: Map< number, RestFolderShape >;
    hydratedFolders: Set< number >;
}

wp.os.files.store.getState();
wp.os.files.store.subscribe( ( state ) => repaint( state ) );

wp.os.files.rest.listPlacements( folderId );
wp.os.files.rest.createPlacement( body );
wp.os.files.rest.updatePlacement( id, body );
wp.os.files.rest.deletePlacement( id );
wp.os.files.rest.listFolders();
wp.os.files.rest.createFolder( body );
wp.os.files.rest.updateFolder( id, body );
wp.os.files.rest.deleteFolder( id );
wp.os.files.rest.saveAssociations( map );
```

Every store mutation also dispatches a `os-files-changed` CustomEvent on `document` with `{ kind, placementId?, folderId?, source: 'local' | 'remote' }` so non-store consumers (toasts, devtools) hear about it without reading the store.

## Rendering — `FilesLayer` + tiles *(Phase 3)*

A `FilesLayer` is the renderer that mounts on a host element (the `#os-area` for the root) and paints one tile per placement. The shell automatically mounts a root layer at boot when the desktop area DOM is present.

### The grid

There is **one** icon grid, and every surface that lays out
placements uses it — the wallpaper, folder windows, and each canvas
in WP Explorer. It is declared once, as design tokens in
`assets/css/variables.css`:

| Token | Default | What it is |
|---|---|---|
| `--os-tile-w` / `--os-tile-h` | `88px` / `104px` | The tile's box. Height is **fixed**, not a minimum — see below. |
| `--os-grid-gap-x` / `--os-grid-gap-y` | `20px` / `16px` | Air between neighbours. |
| `--os-grid-padding` | `16px` | Gutter from the canvas edge. |
| `--os-tile-w-large` / `--os-tile-h-large` | `132px` / `160px` | Image-led sections (`tileSize: 'large'`). |

**The cell pitch is derived, never declared** — `cell = tile + gap`.
A gap you can see is the thing worth tuning; the pitch just follows.
`src/desktop-files/grid.ts` mirrors these numbers for the layout
maths (which can't read CSS) and exports `GRID_METRICS` /
`GRID_METRICS_LARGE` so no surface has to restate them.
`tests/vitest/grid-metrics.test.ts` parses the stylesheet and fails
if the two ever drift.

Two consequences worth knowing, both learned the hard way:

- The tile is `box-sizing: border-box`, so its declared width **is**
  its real width. Without that the horizontal padding lands outside
  the declared box, fills the cell, and neighbouring icons touch
  while the arithmetic insists there is a gap between them.
- The height is **fixed**, not a minimum. The tile box is what the
  selection ring is drawn around, so a box that grows with its label
  gives a row of selected icons a ragged top edge — one height per
  label that happened to wrap to two lines. `--os-tile-h` has to fit
  the tallest a tile can be (icon well + two clamped label lines +
  padding); a test asserts it does, and tells you so if you change
  the icon size or the label clamp.

Surfaces that lay tiles out in CSS flow rather than on the canvas —
the media grid — opt out with `height: auto`, because a square
thumbnail is sized by its grid column, not by the icon cell.

### Tile DOM contract

```html
<button class="os-file-tile"
        data-placement-id="42"
        data-file-type="post"
        data-file-ref="13"
        data-folder-id="0"
        style="position: absolute; left: 100px; top: 200px;">
    <span class="os-file-tile__visual">
        <span class="os-file-tile__icon dashicons dashicons-admin-post"></span>
    </span>
    <span class="os-file-tile__label">My post</span>
</button>
```

The class names and `data-*` attributes are part of the stable contract. The tile is built with `buildTile()` in `src/desktop-files/file-tile.ts`.

### Drag

Drag is owned end-to-end by the centralized `DragManager`
(`wp.os.dragManager`). A tile's `pointerdown` calls
`dragManager.start({ payload, origin, … })`; the manager attaches its
own document-level pointermove / pointerup / pointercancel listeners
and drives the gesture from there. Tiles do NOT call `setPointerCapture`
— pointer capture is incompatible with HTML5 `dragstart` detection on
draggable elements (the WP Explorer entity-tile drag-out bug).

Lifecycle:

  1. `pointerdown` → manager session armed (no visual change yet).
  2. First `pointermove` past 4 px threshold → ghost mounts under the
     pointer; source tile gets `--dragging` (opacity 0.4).
  3. Subsequent moves → ghost follows; the registry hit-tests under
     the cursor; matching drop targets fire `onEnter` / `onLeave`;
     ghost cursor flips between `copy` / `no-drop`.
  4. `pointerup` → re-hit-test; an accepting target fires `onDrop`
     (the FilesLayer's canvas / a folder tile / the Trash);
     non-accepting hover ends with `os.drag.cancel`
     (`reason: 'rejected'` or `'no-target'`).

### Dragging a selection

A drag that starts on a **selected** tile carries the whole selection;
starting on an unselected one makes that tile the selection first and
drags it alone — Finder's rule, and the reason a drag never moves
something the user can't see is highlighted.

The payload grew one field per type, and nothing else changed:

```ts
// 'desktop-file'
{ placement: RestPlacementShape,       // the tile the user grabbed
  placements?: RestPlacementShape[],   // the whole set — absent when 1
  sourceFolderId: number, … }

// 'shortcut'
{ kind, ref, title?, icon?, entityId?, // the entity the user grabbed
  items?: ShortcutDragItem[], …  }     // the whole set — absent when 1
```

**A drop target written before multi-drag is not broken.** It reads
`data.placement` and acts on the grabbed tile, which is the one the
user pointed at. To handle sets, read them through the helper:

```ts
import { dragPlacements, dragShortcutItems } from 'openstation/desktop-files';

onDrop: ( session ) => {
    for ( const placement of dragPlacements( session.payload.data ) ) {
        // Runs once for a single drag, N times for a set.
    }
},
```

Two rules the built-in targets follow, and yours should:

- **Accept all or refuse all.** Every per-item gate (folder cycles,
  synthetic placements, `canTrash`) is applied to every member of the
  set, and one failure refuses the drop. Accepting a set and moving
  four of five reports success for an operation that half-happened.
- **One gesture, one outcome.** Dropping a set on the Trash produces
  one toast with one Undo that restores all of it, not N of each.

The ghost shows the grabbed tile over a stack with a count badge, and
the hover chip says the count too ("Move 3 items here").

Drop target contract (`wp.os.dragManager.registerDropTarget`):

```ts
const deregister = wp.os.dragManager.registerDropTarget( {
    id: 'my-plugin/dropzone',
    element: document.querySelector( '#my-zone' ),
    accept: ( payload ) => payload.type === 'desktop-file',
    onEnter: ( session ) => { /* visual feedback */ },
    onLeave: ( session ) => { /* clear feedback */ },
    onDrop: ( session, ev ) => { /* handle the drop */ },
} );
// Later, when the surface unmounts:
deregister();
```

Window claim boundary: when the manager's hit-test walks up the DOM
from `elementFromPoint` and crosses a `.os-window` element
BEFORE finding a registered target, it returns null. This is what
makes "drop over a Gutenberg admin window" produce reject feedback
instead of silently routing the drop to the wallpaper underneath. A
window opts INTO accepting drops by registering a target on its own
body — the Trash's `[data-os-recycle-bin-root]` is
the canonical example.

Cancellation: `Escape`, `window.blur`, `document.visibilitychange` to
hidden, and `pointercancel` all cancel the active session and run a
single idempotent cleanup (`--dragging`, `--drop-target`,
`data-os-trash-drop-active`, `data-files-drop-active` are
all stripped from the document). Plugins observing the bus see
`document` CustomEvents — `os.drag.{start,move,enter,leave,
rejected,commit,cancel,end}`.

Visual feedback: while a drag is in
flight the manager sets three attributes on `document.body` so
shell CSS can coordinate without each surface having to subscribe
to the CustomEvents:

- `data-os-dragging` *(empty value)* — present iff a drag
  session is lifted.
- `data-os-drag-type` — the `payload.type` slug (e.g.
  `'shortcut'`, `'desktop-file'`, plugin-defined).
- `data-os-drag-mode` — `'accept'` when the cursor is over
  an accepting drop target, `'reject'` over a rejecting region,
  `'neutral'` after the lift before the first hover transition.

In parallel, the framework paints a small "Drop here" / "Can't drop
here" chip next to the cursor (`.os-drag-hint`). Default
labels are picked from `payload.type`; pass `payload.ghost.hint =
{ accept, reject, neutral }` to customise (or `{ hidden: true }`
to opt out for plugin-defined gestures that prefer no chip).

For desktop-files specifically, the FilesLayer registers two drop
targets:

  - The layer host (`#os-area` for the wallpaper, the
    folder window's body for sub-folders) — accepts `'desktop-file'`
    moves and `'shortcut'` creations. On drop, computes the snapped
    grid cell and `PATCH`/`POST`s.
  - Each folder tile — accepts the same payloads but routes them
    INTO that folder (sets `parentId` on the move, or POSTs a new
    placement with `parentId = folderId`). Both branches also
    **re-pack row-major** into the destination's first free cells
    rather than carrying the coordinates the tile had outside. The
    destination window is usually not mounted, so there is nothing
    to measure and aim at; landing at the top-left is the outcome
    that's visible whatever size the folder turns out to be. A tile
    filed from low down a tall desktop would otherwise keep a `y`
    no folder canvas reaches.

A layer is `position: absolute; inset: 0` and does **not** scroll,
so a tile positioned past an edge isn't below a fold — there is no
fold — it is unreachable. `FilesLayer.reflow()` is the safety net:
after every paint, and on every host resize, any tile whose stored
cell falls outside the canvas (either edge) is packed into view.
The reflow is **visual only** — nothing is persisted until the user
drags or sorts — so a layout that merely doesn't fit the current
window size is restored the moment there's room for it again.

Pinned tiles (registered with `pinned: true` via
`openstation_register_icon`) skip drag wiring entirely. A pointerdown
on a pinned tile flashes a `--bump` animation and shows the
`not-allowed` cursor so the (lack of) interaction reads as
intentional rather than buggy.

Legacy: HTML5 drag (`setShortcutDragPayload` /
`hasShortcutPayload` / `readShortcutPayload`) remains exported from
`drag-shortcut.ts` for plugins that emit cross-window drags via
`dataTransfer`, but is deprecated. New code uses the
manager.

### Open

Double-click on a tile resolves the placement's serialized shape into a `DesktopFile` instance and calls `wp.os.files.open()`, which routes through the opener registry (Phase 1).

### Plugin extension points

```ts
applyFilters( 'os.files.tile-class', className: string, placement: RestPlacementShape ): string;
applyFilters( 'os.files.tile-element', extra: Element | null, placement: RestPlacementShape ): Element | null;
doAction( 'os.files.tile-rendered', { tile: HTMLElement, placement: RestPlacementShape } );
doAction( 'os.files.grid-rendered', { folderId: number, count: number } );

// Generic tile surface — fires on every `<os-tile>` paint anywhere
// in the shell (desktop, folders, WP Explorer, plugin windows).
applyFilters( 'os.tile.class', className: string, spec: TileSpec ): string;
doAction( 'os.tile.rendered', { tile: HTMLElement } );
```

`tile-rendered` is the canonical hook for plugin decorations (badges, status dots, drag handles) on the **desktop-files** surface. The layer's fingerprint cache preserves your decoration across no-op repaints; you only need to re-apply on `tile-rendered`.

Use the generic `os.tile.*` pair when you want to decorate tiles **everywhere** (WP Explorer sections, drill-in usage grids, any future surface using `<os-tile>`). The placement-shaped pair stays scoped to desktop files. Both are **Stable** (placement-shaped) and **Experimental** (generic).

### Selection

The layer runs the framework selection controller (see
[`wp.os.selection`](./javascript-reference.md#selection--experimental)), so
the wallpaper and every folder window behave like a file manager:
click replaces, `Ctrl`/`Cmd`+click toggles, `Shift`+click extends,
a drag on empty wallpaper draws a marquee, `Ctrl`/`Cmd`+A selects
all, `Escape` clears. Selection survives every repaint path — a
heartbeat delta or a peer's edit doesn't drop what the user is
holding — and a placement that disappears drops out of the set.

Right-clicking a tile that is **not** selected replaces the selection
with it before opening the menu (Finder / Explorer behaviour); one
that **is** selected leaves the set alone, so the menu acts on all of
it. What a mixed set may do is decided by `resolveCommonActions`:
actions common to every selected placement, and only those declaring
`multi: true`. `os.files.tile-menu` entries are unchanged and stay
single-item until they opt in — see the field table in the JS
reference.

The built-ins that opted in: **Open** (fan-out, with a confirm past
five windows), **Move to Trash** (one batched runner — one toast, one
Undo, one broadcast; folder and file entries share
`multiId: 'trash'` so a mixed set is still throwable-away), and
**Hide from desktop** (one settings write for the whole set).
*Rename…*, *Navigate into* and *Download* are inherently single-item.

The folder window's status bar gains a `selection` segment
(`"3 selected"`) while a selection exists, and its preview pane shows
a count-and-type summary instead of previewing one arbitrary member.
The `os.files.folder-window.status-bar` filter context carries
`selectedCount`.

### Public API

```ts
import { mountFilesLayer } from 'openstation/desktop-files';
const handle = mountFilesLayer( hostElement, folderId );

// Selection.
handle.getSelection();                    // RestPlacementShape[], visual order
handle.onSelectionChanged( ( ps ) => …);  // the whole set, every change
handle.onSelectionChange( ( p ) => … );   // the ONE selected placement, else null
handle.selectAll();
handle.clearSelection();

// later
handle.dispose();
```

`onSelectionChange` predates multi-selection and keeps its contract:
it reports the placement when exactly one is selected and `null`
otherwise — an empty selection and a multi-selection are the same
news to a consumer that shows one thing at a time. Use
`onSelectionChanged` to see the set.

## Wallpaper context menu *(Phase 4)*

Clicking empty wallpaper used to call `windowManager.toggleShowDesktop()` directly. Phase 4 replaces that with a small floating menu — the desktop-OS equivalent of right-click on the desktop.

### Built-in items

| Id | Label | Behavior |
|---|---|---|
| `create-folder` | New folder | Prompts for a name, then `POST /folders`. |
| `new-url` | New URL | Prompts for a name + URL, then `POST /placements` with a `link` placement (the tile opens the URL in a new browser tab). |
| `new-note` | New note | Pins an empty paper note where the click landed. Contributed by the pinned-notes layer via the filter below. |
| `sort-by` | Sort by | Submenu with checkable options: Name (A → Z), Name (Z → A), Date (newest first), Date (oldest first); re-sorts the desktop icons. |
| `show-desktop` | Show desktop | Calls `windowManager.toggleShowDesktop()` (the legacy single-click gesture). |
| `os-settings` | OpenStation Preferences | Opens the OpenStation Preferences window. |

### Plugin extension

JS — for runtime / closure-bearing items:

```js
wp.os.hooks.addFilter(
    'os.wallpaper-context-menu',
    'my-plugin/menu',
    ( items, { x, y } ) => [
        ...items,
        {
            id: 'my-plugin/reminder',
            label: 'New reminder',
            icon: 'dashicons-format-aside',
            sort: 50,
            onClick: () => myPlugin.createReminderAt( x, y ),
        },
    ],
);
```

The second argument is the right-click position in viewport
coordinates. Items that place something on the wallpaper need it:
`onClick` receives a synthetic `MouseEvent` carrying no position, so
close over `x` / `y` in the filter instead.

PHP — for declarative items shipped with the plugin (no closures, since they don't serialize):

```php
add_filter( 'openstation_wallpaper_context_menu_items', function ( $items ) {
    $items[] = [
        'id'         => 'my-plugin/help',
        'label'      => __( 'Help', 'my-plugin' ),
        'icon'       => 'dashicons-editor-help',
        'sort'       => 90,
        'callbackId' => 'help',
    ];
    return $items;
} );
```

PHP-shipped items are routed through a JS bundle's `serverCallbacks` map, or fire `os.wallpaper-context-menu.activated` so plugins that didn't ship a JS callback can still subscribe.

### Lifecycle actions

```ts
doAction( 'os.wallpaper-menu.opened', { items: string[] } );
doAction( 'os.wallpaper-menu.closed', {} );
doAction( 'os.wallpaper-context-menu.activated', { id: string, callbackId: string } );
```

## Sharing + Heartbeat sync *(Phase 6)*

### Visibility logic

`openstation_files_get_visible_folders( $user_id )` returns the union of:

- Folders owned by `$user_id`.
- Folders not owned by them whose `share_mode` resolves true for them:
  - `'all'` — every OpenStation user.
  - `'users'` / `'roles'` — resolved through the shares + decisions tables via `openstation_folder_share_user_capability()`: an accepted user-principal share, or an accepted per-user decision on a role-principal share (see [folder-sharing.md](folder-sharing.md)). `share_meta` on the folders row is diagnostic only — it is never consulted for visibility.

Plugins can register a custom share mode by adding it to `openstation_files_share_modes` and computing the per-folder decision via `openstation_files_user_can_see_folder`.

### Heartbeat protocol

Wire format:

**Send (client → server):**

```js
data.openstation_files_subscribe = {
    folderVersions: { '<folderId>': lastSeenUpdatedAtMs, … },
    placementsVersion: lastSeenUpdatedAtMs,
    sharesVersion: lastSeenInviteMs, // highwater of invitedAtMs across received invites
};
```

**Receive (server → client):**

```js
response.openstation_files = {
    placements: [ RestPlacementShape, … ], // upserts since placementsVersion
    folders:    [ RestFolderShape, … ],    // upserts (incl. share-mode flips)
    removed:    { placements: number[], folders: number[] }, // tombstone ids
    shares:     { pending: [ /* ShareShape + folderName / ownerId / ownerName / ownerAvatar */ ] },
    serverTimeMs: number,
    truncated: boolean,
};
```

Pending share invites ride the same heartbeat — `shares.pending` carries every undecided invite newer than `sharesVersion`, each share shape enriched with `folderName`, `ownerId`, `ownerName`, and `ownerAvatar` for the invite banner. See [folder-sharing.md](folder-sharing.md) for the accept/deny opt-in flow.

The client merges upserts via the existing store helpers with `source: 'remote'`, so plugins listening to `os-files-changed` can disambiguate between local edits and incoming sync.

When `truncated: true`, the framework issues a one-shot REST resync of every hydrated folder — the cap (`openstation_files_heartbeat_max_rows`, default 200 rows per payload) was hit and a partial delta would leave the client wedged.

### Setting share mode

Interactive sharing goes through the in-shell Share dialog — the folder tile's context menu ("Share folder…" / "Manage sharing…") or the folder window's title-bar Share button — backed by the `/files/folders/<id>/shares` REST routes; see [folder-sharing.md](folder-sharing.md). Plugins (or admin REST tools) can still set sharing programmatically via the low-level folders endpoint:

```
PATCH /wp-json/desktop-mode/v1/files/folders/<id>
{
    "shareMode": "roles",
    "shareMeta": { "roles": [ "editor" ] }
}
```

The `openstation_folder_shared` action fires whenever `share_mode` or `share_meta` changes, giving plugins a single signal to subscribe to.

## Real file storage (`upload`) — Experimental

Real desktop-style file storage: users upload arbitrary files (or whole folder trees) and the bytes land on the server, tied to the uploading user, downloadable later — the file as-is, a folder as an on-demand `.zip`.

### Storage model

Bytes live **flat** on disk under `wp-content/uploads/os-files/<user_id>/` with server-generated, extensionless UUID names — hierarchy, display names, and sharing are entirely DB concerns (the existing folders + placements + shares tables). Metadata lives in the `{prefix}desktop_mode_stored_files` table (`owner_id`, `display_name`, `disk_name`, `size_bytes`, `mime`). Renames and moves are single-row updates; no user input ever composes a disk path.

The storage dir is protected by `.htaccess` (both Apache 2.2/2.4 syntaxes) + `index.php`, and bytes are only ever served through the authenticated download endpoints with `Content-Disposition: attachment` + `X-Content-Type-Options: nosniff` (uploaded SVG/HTML never renders from the site origin). **nginx ignores `.htaccess`** — add this to the server config:

```nginx
location ^~ /wp-content/uploads/os-files/ { deny all; }
```

Even without it, the extensionless UUID names and the PHP-gated serving are the effective floor. Back up the DB and the storage dir together.

### Uploading

- **Drag from the OS** onto the wallpaper, a folder window, or a closed folder tile. The upload dialog offers a destination selector — Desktop storage or Media Library (the pre-0.9.6 behavior). Defaults follow the drop's intent: folder-targeted drops go to Desktop (into that folder); flat desk drops default to Media Library when every file is a media kind (`image/*`, `video/*`, `audio/*`) and to Desktop otherwise; WordPress admin windows keep Media Library. Folder drops force Desktop storage and recreate the tree (empty directories included, via the drag path only). Dropping again while the dialog is open updates it to the latest drop (the earlier, unconfirmed batch is discarded).
- **Pickers**: wallpaper context menu → "Upload files…" / "Upload folder…".
- Capability gate: `upload_files` by default, filterable via `openstation_stored_files_upload_capability`. Per-file cap: `wp_max_upload_size()`, filterable down via `openstation_stored_files_max_upload_bytes`. Optional per-user quota: `openstation_stored_files_user_quota_bytes` (default unlimited). MIME policy: the user-scoped WordPress allow-list (widen with `openstation_stored_files_allowed_mimes` — it keeps core's re-check in agreement) plus a hard executable/config denylist (`php*`, `phtml`, `phar`, `.htaccess`, …) that also rejects double extensions.

### REST routes

All under `/wp-json/desktop-mode/v1/files`, cookie + nonce auth:

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/uploads` | Multipart intake, ONE file per request: `file` + `parentId` + optional `relativePath` (`a/b/c.ext` — directory segments are created mkdir-p style, deduped) + optional `x`/`y` (omit both → next free grid slot). Returns `{ placement, storedFileId }`. |
| `POST` | `/uploads/paths` | mkdir-p a directory path with no file (`parentId`, `relativePath`). Preserves empty directories from tree drops. |
| `PATCH` | `/uploads/<id>` | Rename the display name (owner only). |
| `GET` | `/uploads/<id>/download` | Stream the bytes, unmodified. `_wpnonce` accepted as a query param so plain `<a>` navigations work. |
| `GET` | `/folders/<id>/download` | On-demand `.zip` of the folder's stored files (reference-type placements are skipped; empty sub-folders round-trip). Requires the PHP zip extension — 501 + a hidden affordance otherwise. Caps filterable via `openstation_stored_files_zip_caps` (default 1000 entries / 500 MB input). |
| `GET/POST` | `/uploads/<id>/shares` (+ `/<shareId>`, `/accept`, `/deny`, `/leave`) | Single-file sharing — see [folder-sharing.md](folder-sharing.md#single-file-shares). |

Downloads answer **404** for files the viewer cannot read (existence masking). Not-found and no-access are indistinguishable.

### Ownership and sharing

Uploaded files are **owner-locked**: only the stored file's owner may move, rename, or trash them — folder write-collaborators included (`openstation_files_upload_owner_locked` error, and `canTrash: false` in the shape). Recipients — via a shared folder or a direct file share — get read + download only. Direct file shares are hard-limited to the read tier.

### Lifecycle

Reconciliation runs on the existing daily prune: placement-less rows and row-less bytes older than a day are removed in both directions. `deleted_user` purges the user's entire storage. Zip temp files are cleaned on stream end, shutdown, and by the daily sweep.

### PHP surface

`openstation_stored_files_get/create/rename/delete/purge()`, `openstation_stored_file_path()`, `openstation_stored_file_user_can_read()`, `openstation_stored_files_total_bytes()`, `openstation_stored_file_share_{invite,accept,deny,leave,revoke}()`. Actions: `openstation_stored_file_{created,uploaded,renamed,deleted,downloaded}`, `openstation_folder_zip_downloaded`. See [hooks-reference.md](hooks-reference.md#real-file-storage) for the filters.

## What's NOT here yet

- Drag-from-Recycle-Bin via HTML5 native drag (the "Pin to desktop" toolbar button ships the equivalent action today).
- The folder-sharing v1 non-goals — owner transfer, cascade share grants (sub-folders need their own grant), recipient-side rename of a shared folder. See [folder-sharing.md](folder-sharing.md). (Sharing of non-folder types is available for stored uploads — read-only, user principals.)
- Upload previews/thumbnails (double-click downloads in v1) and resumable/chunked uploads (the intake keeps receive and register separate so a tus/Content-Range layer can drop in).

If you need any of these today, watch the changelog — the registry shape from Phase 0 is forwards-compatible with every later phase.
