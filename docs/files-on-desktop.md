# Files on the Desktop

**Status:** Experimental.

The Files-on-the-Desktop system lets users place WordPress entities — posts, users, media, terms, comments, bookmarks — on their desktop wallpaper, organize them inside folders, and (in later phases) share folders with other users via Heartbeat-driven sync. Plugin authors extend the system by registering their own file types through the same surface the ten built-ins use.

This is an evolving feature. Phase 0 (this document's current scope) establishes the registry and the `Desktop_Mode_File` base class. Future phases layer in:

| Phase | Adds |
|---|---|
| 1 | File-opener registry + per-user associations *(landed)* |
| 2 | Custom-table schema + REST + store *(landed)* |
| 3 | Desktop UI: tile rendering, in-desktop drag *(landed)* |
| 4 | Wallpaper context menu (replaces "minimize all" click) *(landed)* |
| 5 | OS Settings → File Associations tab *(landed)* |
| 6 | Folder sharing (private / users / roles / all) + Heartbeat sync *(landed)* |
| 7 | Drag from the Trash onto the desktop *(landed as "Pin to desktop"; HTML5 drag UX is a follow-up)* |

Each phase ships independently and is documented as it lands.

## Mental model

A **file** on the desktop is a `Desktop_Mode_File` subclass adapting one WordPress entity (a post, a user, a comment …) to the shape the desktop UI expects: title, icon, preview, and a capability gate. Files don't know how to open themselves — that's a separate concern (Phase 1: the opener registry).

### Files are references, not copies

A placement is a **reference** to a WordPress entity, not a copy of it. Removing a placement drops the placement row only — the underlying post, user, attachment, comment, or term is **never** touched. The REST `DELETE /placements/<id>` defaults to a soft-trash into the recycle bin (restorable); `?force=1` permanently purges the row, and `desktop_mode_files_remove()` is the hard-remove PHP API. Folder deletion cascades placements via tombstones but still leaves referenced entities intact. This is asserted in `Tests_DesktopMode_FilesStore::test_remove_does_not_delete_underlying_entity` and is the core safety contract of the system. Plugins that want a "delete the post too" flow must call `wp_delete_post()` (or equivalent) themselves — the framework will not do it for them.

**The one deliberate exception is the `upload` type** (real file storage): an uploaded file has no life outside the desktop, so its placement OWNS the entity. Soft-trash keeps the bytes (restore works); when the owner's last placement of a file is **permanently** removed (recycle-bin purge / `?force=1`), the stored bytes, the row, its shares, and every recipient placement are deleted too. See [Real file storage](#real-file-storage-upload--experimental) below. Every other type keeps the reference contract unchanged.

A **file type** is a slug that points the registry at the right subclass. The built-ins are:

| Slug | Class | Reference shape |
|---|---|---|
| `post` | `Desktop_Mode_Post_File` | post id (numeric string) |
| `attachment` | `Desktop_Mode_Attachment_File` | attachment id |
| `upload` | `Desktop_Mode_Upload_File` | stored-file row id (real bytes on the server — see [Real file storage](#real-file-storage-upload--experimental)) |
| `user` | `Desktop_Mode_User_File` | user id |
| `term` | `Desktop_Mode_Term_File` | `"<taxonomy>:<term_id>"` |
| `comment` | `Desktop_Mode_Comment_File` | comment id |
| `folder` | `Desktop_Mode_Folder_File` | folder row id (Phase 2) |
| `shortcut` | `Desktop_Mode_Shortcut_File` | shortcut id; serialized shape carries `shortcutWindow` (registered native-window id) or `shortcutUrl` |
| `bookmark` | `Desktop_Mode_Bookmark_File` | URL string |
| `link` | `Desktop_Mode_Link_File` | URL string — opens in a new browser tab |
| `embed` | `Desktop_Mode_Embed_File` | URL string — opens in an iframe-backed desktop window; geometry persists on `placement.meta.window` |

`link` and `embed` placements both carry an optional human-friendly label on `placement.meta.name`. The wallpaper-menu "New bookmark" entry, URL drops, and URL pastes create `embed` placements. A user-entered name is preserved; otherwise the hostname appears immediately and is replaced by a fetched page title when enrichment succeeds. The tile renderer prefers the placement name over `file.title()` so two tiles pointing at the same URL can carry different labels. `embed` placements additionally persist `{ x, y, width, height }` on `placement.meta.window` after every drag-end / resize-end of the spawned window; the next open clamps that geometry to the current desktop area before restoring.

Web placements can carry a server-resolved favicon on `placement.meta.iconUrl`. The string is a base64 data URI of the form `data:image/(png|jpeg|gif|webp|x-icon|svg+xml);base64,<payload>`. External `link` and `bookmark` creation resolves it inline; the tile uses it immediately when present and updates in place if the metadata arrives later. Favicons render at their intrinsic size, capped at 24 px, inside a 48 px monitor frame so small native artwork stays crisp while matching the visual weight of neighboring desktop icons. New `embed` bookmarks are usable immediately, then call `POST /placements/<id>/web-metadata` in the background to merge a sanitized page title and favicon without replacing a later rename, saved window geometry, or other metadata. Resolution uses `wp_safe_remote_get` + `DOMDocument`, with a `/favicon.ico` fallback. When it fails — bad host, network error, oversized body, content-type mismatch — metadata is left alone and the tile keeps its hostname and generic icon. Icons are capped at 256 KB raw bytes and page HTML at 1 MB. Plugins can continue to short-circuit or override favicon resolution through the `desktop_mode_resolve_favicon` filter. The `meta.iconUrl` precedence is generic — any plugin can attach a custom per-placement icon (URL or data URI) on any type.

`page` and any custom post type collapse into `post`; `category` and `post_tag` collapse into `term`. UI labels per concrete post type / taxonomy come from the `desktop_mode_file_serialize` filter — there's no need to register a separate type for every CPT.

## Registering a file type

PHP:

```php
add_action( 'init', static function () {
    require_once __DIR__ . '/class-jorvy-quote-file.php';
    desktop_mode_register_file_type( 'jorvy-quote', array(
        'label' => __( 'Marvel quote', 'jorvy' ),
        'class' => 'Jorvy_Quote_File',
        'sort'  => 200,
    ) );
}, 6 ); // priority 6 so we land after the built-ins (5).
```

`Jorvy_Quote_File` extends `Desktop_Mode_File` and overrides the methods that don't fit the defaults. The base shape is intentionally minimal:

```php
class Jorvy_Quote_File extends Desktop_Mode_File {

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
class JorvyQuoteFile extends wp.desktop.files.DesktopFile {
    type() {
        return 'jorvy-quote';
    }
    title() {
        return `🦸 ${ this.shape.title }`;
    }
}

wp.desktop.files.registerType( {
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
| `desktop_mode_file_types` | filter | `( array[] $registry ) => array[]` | Final list of registered types, keyed by slug. Plugins can hide built-ins or swap a class out. |
| `desktop_mode_file_type_registered` | action | `( string $type, array $entry ) => void` | Fires after a successful `desktop_mode_register_file_type()` call. Does NOT fire on `WP_Error`. |
| `desktop_mode_file_serialize` | filter | `( array $shape, Desktop_Mode_File $file ) => array` | Last-mile mutation of the JS-bound shape. Attach badges, override labels, splice in custom render hints. |
| `desktop_mode_file_openers` | filter | `( array[] $registry ) => array[]` | Filter the opener registry. Hide built-ins, swap labels. |
| `desktop_mode_resolve_file_opener` | filter | `( string $opener_id, string $type, int $user_id ) => string` | Override the resolution chain — useful for forced role-based associations. |
| `desktop_mode_file_opener_registered` | action | `( string $id, array $entry ) => void` | Fires after a successful `desktop_mode_register_file_opener()` call. |

### JavaScript

| Hook | Type | Signature | Purpose |
|---|---|---|---|
| `desktop-mode.files.types` | filter | `( DesktopFileTypeDef[] ) => DesktopFileTypeDef[]` | Reorder / hide / override types in pickers. |
| `desktop-mode.files.type-registered` | action | `( type: string, def: DesktopFileTypeDef ) => void` | Fires after a successful `wp.desktop.files.registerType()` call. |
| `desktop-mode.files.type-unregistered` | action | `( type: string ) => void` | Fires after `unregisterType()`. |
| `desktop-mode.files.openers` | filter | `( FileOpenerDef[] ) => FileOpenerDef[]` | Filter the opener list shown in pickers. |
| `desktop-mode.files.resolve-opener` | filter | `( FileOpenerDef \| null, type: string ) => FileOpenerDef \| null` | Override the resolution chain at click time. |
| `desktop-mode.files.opener-registered` | action | `( id: string, def: FileOpenerDef ) => void` | Fires after `registerOpener()`. |
| `desktop-mode.files.opener-unregistered` | action | `( id: string ) => void` | Fires after `unregisterOpener()`. |
| `desktop-mode.files.opening` | action | `( { file, openerId } ) => void` | Fires before the opener handler runs. |
| `desktop-mode.files.opened` | action | `( { file, openerId, kind } ) => void` | Fires on successful open. |
| `desktop-mode.files.open-failed` | action | `( { reason, type, ref, openerId?, error? } ) => void` | Fires when no opener resolved or the handler threw. |

## Public API

### PHP

- `desktop_mode_register_file_type( string $type, array $args ): true|WP_Error`
- `desktop_mode_get_file_type( string $type ): array|null`
- `desktop_mode_get_file_types(): array[]`
- `desktop_mode_resolve_file( string $type, $ref ): Desktop_Mode_File|null`
- `desktop_mode_register_file_opener( string $id, array $args ): true|WP_Error`
- `desktop_mode_get_file_openers(): array[]`
- `desktop_mode_get_file_openers_for_type( string $type ): array[]`
- `desktop_mode_resolve_file_opener_id( string $type, int $user_id ): string`
- `desktop_mode_get_user_file_associations( int $user_id ): array<string,string>`

### JavaScript (`wp.desktop.files`)

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

A **file opener** answers the question "what should happen when the user double-clicks a `post`?" It's the desktop-OS equivalent of an `.app` association. Multiple openers can register for the same file type; the user picks their preferred one (in OS Settings → File Associations, Phase 5), and the JS side resolves on every double-click.

### Resolution chain

1. The user's per-type override (`desktop_mode_file_associations` user meta).
2. The opener flagged `is_default` for the type.
3. The first registered opener for the type (sort order).
4. No-op (the file simply can't be opened — `wp.desktop.files.open()` returns `false`).

### Registering an opener

PHP-side metadata (the entry the OS Settings tab will show, and the entry the user-meta override is validated against):

```php
desktop_mode_register_file_opener( 'classic-editor', array(
    'label'      => __( 'Classic Editor', 'classic-editor' ),
    'types'      => array( 'post' ),
    'is_default' => false,        // user must opt in via OS Settings
    'sort'       => 20,
) );
```

JS-side handler (the actual logic — closures don't serialize across the shell payload):

```js
wp.desktop.files.registerOpener( {
    id: 'classic-editor',
    label: 'Classic Editor',
    types: [ 'post' ],
    sort: 20,
    handler: {
        kind: 'url',
        url: ( file ) =>
            `${ wp.desktop.config.adminUrl }post.php?post=${ file.ref() }&action=edit&classic-editor`,
    },
} );
```

Three handler kinds:

- `url` — handler returns a URL; the framework opens it in a chromeless iframe window via `wp.desktop.windowManager.open`. Optional `windowId(file)` and `title(file)` overrides.
- `window` — handler points at a `desktop_mode_register_window`-registered native-window id, with optional per-file `config(file)`. **Caveat:** the computed config is currently dropped by the shell's opener wiring (it opens the window by id without forwarding the config), so it never reaches `wp.desktop.getWindowConfig` — don't rely on per-file config delivery yet.
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
| `desktop-mode-shortcut-opener` | `shortcut` | `js` | Opens the shortcut's registered native window (`shortcutWindow`) or its URL (`shortcutUrl`) in a desktop window — external origins fall back to a new browser tab. |

The `desktop-mode-folder-window` and `desktop-mode-shortcut-opener` openers are registered JS-side only — unlike the other eight, they have no entry in the PHP metadata mirror (`includes/desktop-files/built-in-openers.php`), so don't expect them in `desktop_mode_get_file_openers()`.

### Opening a file

```js
const file = wp.desktop.files.resolve( shape ); // shape from server
wp.desktop.files.open( file ); // returns Promise< boolean >
```

The dispatcher fires `desktop-mode.files.opening` before invoking the handler and `desktop-mode.files.opened` after success (or `desktop-mode.files.open-failed` on no-opener / handler-throw). `opening` carries `{ file, openerId }`, `opened` carries `{ file, openerId, kind }`, and `open-failed` carries `{ reason, type, ref, openerId?, error? }` (see the hooks table above).

### User associations

The current user's `{ type → openerId }` choices live in user meta `desktop_mode_file_associations`. Phase 5's OS Settings tab is the canonical writer; reading happens automatically — the shell config seeds `wp.desktop.files.getUserAssociations()` on boot, and `setUserAssociations()` is called once during init.

Plugins that ship a "force-this-opener-for-role-X" feature should hook the resolution filter rather than touching user meta:

```php
add_filter( 'desktop_mode_resolve_file_opener', function ( $opener_id, $type, $user_id ) {
    if ( 'post' === $type && user_can( $user_id, 'editor' ) ) {
        return 'classic-editor';
    }
    return $opener_id;
}, 10, 3 );
```

## Persistence — schema, REST, store *(Phase 2)*

### Custom tables

Three tables back the system, created via `dbDelta` on plugin activation and refreshed lazily on `admin_init` when `DESKTOP_MODE_FILES_SCHEMA_VERSION` mismatches the option.

| Table | Purpose | Key columns |
|---|---|---|
| `{prefix}desktop_mode_file_placements` | One row per placed tile | `owner_id`, `parent_id`, `file_type`, `file_ref`, `x`, `y`, `sort_order`, `updated_at_ms`, `meta` (JSON) |
| `{prefix}desktop_mode_folders` | Folder rows | `owner_id`, `name`, `share_mode`, `share_meta` (JSON), `updated_at_ms` |
| `{prefix}desktop_mode_file_tombstones` | Removal ledger for delta sync | `kind` (`placement` / `folder`), `ref_id`, `removed_at_ms` |

Tombstones are pruned daily via `desktop_mode_files_daily_prune` (default retention: 7 days).

### REST endpoints

All under `/wp-json/desktop-mode/v1/files`. Permission gate: logged-in + desktop mode enabled. Per-row gating happens inside the store.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/placements?folder=<id>` | List the viewer's placements under `<id>` (0 = desktop root). |
| `POST` | `/placements` | `{ parentId?, type, ref, x?, y?, sortOrder?, meta? }` |
| `PATCH` | `/placements/<id>` | `{ parentId?, x?, y?, sortOrder?, meta? }` |
| `DELETE` | `/placements/<id>` | Soft-trash to the recycle bin (restorable). Pass `?force=1` to permanently purge. |
| `POST` | `/placements/<id>/web-metadata` | Resolve and merge the stored `embed` URL's page title and favicon. The request body cannot choose a URL. |
| `GET` | `/folders` | List folders the viewer owns (Phase 6 expands to shared folders). |
| `POST` | `/folders` | `{ name, shareMode?, shareMeta? }` |
| `PATCH` | `/folders/<id>` | `{ name?, shareMode?, shareMeta? }` |
| `DELETE` | `/folders/<id>` | Soft-trash the folder + cascades child placements (restorable). `?force=1` permanently deletes the folder and the cascaded placements. |
| `PUT` | `/associations` | Replace the viewer's `{ type → openerId }` map (Phase 5 settings tab writer). |

### PHP store API

```php
desktop_mode_files_place( int $user_id, int $parent_id, string $type, string $ref, array $args = [] ): int|WP_Error;
desktop_mode_files_move( int $placement_id, int $user_id, array $changes ): true|WP_Error;
desktop_mode_files_remove( int $placement_id, int $user_id ): true|WP_Error;
desktop_mode_files_get_placement( int $placement_id ): array|null;
desktop_mode_files_get_for_user_folder( int $user_id, int $parent_id = 0 ): array;

desktop_mode_files_create_folder( int $owner_id, array $args ): int|WP_Error;
desktop_mode_files_update_folder( int $folder_id, int $user_id, array $changes ): true|WP_Error;
desktop_mode_files_delete_folder( int $folder_id, int $user_id ): true|WP_Error;
desktop_mode_files_get_folder( int $folder_id ): array|null;
desktop_mode_files_get_visible_folders( int $user_id ): array;

desktop_mode_files_share_modes(): array;          // ['private','users','roles','all']
desktop_mode_files_table_names(): array;
desktop_mode_files_now_ms(): int;
```

Placement-write path actions: `desktop_mode_file_placed( $id, $row )`, `desktop_mode_file_moved( $id, $next, $prev )`, `desktop_mode_file_unplaced( $id, $row )`.
Folder-write path: `desktop_mode_folder_created`, `_updated`, `_shared`, `_deleted`.
Read filter: `desktop_mode_files_query_args( $args, $user_id, $parent_id )`.
Visibility filter (advisory in Phase 2, load-bearing in Phase 6): `desktop_mode_files_visible_folders( $folders, $viewer_id )`.

### JS store + REST

`wp.desktop.files.store` exposes a `createSharedStore`-backed cross-bundle state holder; `wp.desktop.files.rest` is the typed REST client.

Boot hydration of the **root folder** (`folderId 0`) does not hit REST: the shell config inlines `filesBootPlacements` (built server-side by the same code path as `GET /files/placements?folder=0`) and the file layer seeds the store from it one-shot. Any later hydration — subfolders, restore-sync re-fetches, heartbeat resyncs — goes through `listPlacements()` as before.

```ts
interface FilesState {
    placementsByFolder: Map< number, RestPlacementShape[] >;
    folders: Map< number, RestFolderShape >;
    hydratedFolders: Set< number >;
}

wp.desktop.files.store.getState();
wp.desktop.files.store.subscribe( ( state ) => repaint( state ) );

wp.desktop.files.rest.listPlacements( folderId );
wp.desktop.files.rest.createPlacement( body );
wp.desktop.files.rest.updatePlacement( id, body );
wp.desktop.files.rest.deletePlacement( id );
wp.desktop.files.rest.listFolders();
wp.desktop.files.rest.createFolder( body );
wp.desktop.files.rest.updateFolder( id, body );
wp.desktop.files.rest.deleteFolder( id );
wp.desktop.files.rest.saveAssociations( map );
```

Every store mutation also dispatches a `desktop-mode-files-changed` CustomEvent on `document` with `{ kind, placementId?, folderId?, source: 'local' | 'remote' }` so non-store consumers (toasts, devtools) hear about it without reading the store.

## Rendering — `FilesLayer` + tiles *(Phase 3)*

A `FilesLayer` is the renderer that mounts on a host element (the `#desktop-mode-area` for the root) and paints one tile per placement. The shell automatically mounts a root layer at boot when the desktop area DOM is present.

### Tile DOM contract

```html
<button class="desktop-mode-file-tile"
        data-placement-id="42"
        data-file-type="post"
        data-file-ref="13"
        data-folder-id="0"
        style="position: absolute; left: 100px; top: 200px;">
    <span class="desktop-mode-file-tile__visual">
        <span class="desktop-mode-file-tile__icon dashicons dashicons-admin-post"></span>
    </span>
    <span class="desktop-mode-file-tile__label">My post</span>
</button>
```

The class names and `data-*` attributes are part of the stable contract. The tile is built with `buildTile()` in `src/desktop-files/file-tile.ts`.

### Drag

Drag is owned end-to-end by the centralized `DragManager`
(`wp.desktop.dragManager`). A tile's `pointerdown` calls
`dragManager.start({ payload, origin, … })`; the manager attaches its
own document-level pointermove / pointerup / pointercancel listeners
and drives the gesture from there. Tiles do NOT call `setPointerCapture`
— pointer capture is incompatible with HTML5 `dragstart` detection on
draggable elements (the site-folder entity-tile drag-out bug).

Lifecycle:

  1. `pointerdown` → manager session armed (no visual change yet).
  2. First `pointermove` past 4 px threshold → ghost mounts under the
     pointer; source tile gets `--dragging` (opacity 0.4).
  3. Subsequent moves → ghost follows; the registry hit-tests under
     the cursor; matching drop targets fire `onEnter` / `onLeave`;
     ghost cursor flips between `copy` / `no-drop`.
  4. `pointerup` → re-hit-test; an accepting target fires `onDrop`
     (the FilesLayer's canvas / a folder tile / the Trash);
     non-accepting hover ends with `desktop-mode.drag.cancel`
     (`reason: 'rejected'` or `'no-target'`).

Drop target contract (`wp.desktop.dragManager.registerDropTarget`):

```ts
const deregister = wp.desktop.dragManager.registerDropTarget( {
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
from `elementFromPoint` and crosses a `.desktop-mode-window` element
BEFORE finding a registered target, it returns null. This is what
makes "drop over a Gutenberg admin window" produce reject feedback
instead of silently routing the drop to the wallpaper underneath. A
window opts INTO accepting drops by registering a target on its own
body — the Trash's `[data-desktop-mode-recycle-bin-root]` is
the canonical example.

Cancellation: `Escape`, `window.blur`, `document.visibilitychange` to
hidden, and `pointercancel` all cancel the active session and run a
single idempotent cleanup (`--dragging`, `--drop-target`,
`data-desktop-mode-trash-drop-active`, `data-files-drop-active` are
all stripped from the document). Plugins observing the bus see
`document` CustomEvents — `desktop-mode.drag.{start,move,enter,leave,
rejected,commit,cancel,end}`.

Visual feedback: while a drag is in
flight the manager sets three attributes on `document.body` so
shell CSS can coordinate without each surface having to subscribe
to the CustomEvents:

- `data-desktop-mode-dragging` *(empty value)* — present iff a drag
  session is lifted.
- `data-desktop-mode-drag-type` — the `payload.type` slug (e.g.
  `'shortcut'`, `'desktop-file'`, plugin-defined).
- `data-desktop-mode-drag-mode` — `'accept'` when the cursor is over
  an accepting drop target, `'reject'` over a rejecting region,
  `'neutral'` after the lift before the first hover transition.

In parallel, the framework paints a small "Drop here" / "Can't drop
here" chip next to the cursor (`.desktop-mode-drag-hint`). Default
labels are picked from `payload.type`; pass `payload.ghost.hint =
{ accept, reject, neutral }` to customise (or `{ hidden: true }`
to opt out for plugin-defined gestures that prefer no chip).

For desktop-files specifically, the FilesLayer registers two drop
targets:

  - The layer host (`#desktop-mode-area` for the wallpaper, the
    folder window's body for sub-folders) — accepts `'desktop-file'`
    moves and `'shortcut'` creations. On drop, computes the snapped
    grid cell and `PATCH`/`POST`s.
  - Each folder tile — accepts the same payloads but routes them
    INTO that folder (sets `parentId` on the move, or POSTs a new
    placement with `parentId = folderId`).

Pinned tiles (registered with `pinned: true` via
`desktop_mode_register_icon`) skip drag wiring entirely. A pointerdown
on a pinned tile flashes a `--bump` animation and shows the
`not-allowed` cursor so the (lack of) interaction reads as
intentional rather than buggy.

Legacy: HTML5 drag (`setShortcutDragPayload` /
`hasShortcutPayload` / `readShortcutPayload`) remains exported from
`drag-shortcut.ts` for plugins that emit cross-window drags via
`dataTransfer`, but is deprecated. New code uses the
manager.

### URL intake and open

Dropping one URL on the wallpaper or an open folder creates an `embed` bookmark in the nearest free grid cell. Dropping on a closed folder tile creates it inside that folder. Paste uses the currently active desktop or folder surface and the next free cell. Intake prefers `text/uri-list` (ignoring comment lines) and falls back to standalone `text/plain`; it accepts HTTP/HTTPS URLs and domain-like values normalized to HTTPS, and rejects credentials, unsafe schemes, arbitrary prose, and file drags. Paste is ignored while an editable control, modal, or iframe owns focus. Only one bookmark is created per gesture.

When the same URL already exists in a folder, a drop repositions and selects it while paste only selects it; stored names, icons, and window geometry remain intact. The layer announces creation, duplicate selection, and invalid input through the accessible toast surface.

Double-click or Enter on a selected tile resolves the placement's serialized shape into a `DesktopFile` instance and calls `wp.desktop.files.open()`, which routes through the opener registry (Phase 1). Single-click and Space select without opening. `embed` URLs are validated again before an iframe window is created. Because sites may block framing with `X-Frame-Options` or CSP and that cannot be detected reliably, bookmark windows always show an **Open in browser** title-bar action as well as the overflow-menu command. External URLs are passed through exactly when detached; only same-origin WordPress/admin URLs receive Desktop Mode query adjustments.

### Plugin extension points

```ts
applyFilters( 'desktop-mode.files.tile-class', className: string, placement: RestPlacementShape ): string;
applyFilters( 'desktop-mode.files.tile-element', extra: Element | null, placement: RestPlacementShape ): Element | null;
doAction( 'desktop-mode.files.tile-rendered', { tile: HTMLElement, placement: RestPlacementShape } );
doAction( 'desktop-mode.files.grid-rendered', { folderId: number, count: number } );

// Generic tile surface — fires on every `<wpd-tile>` paint anywhere
// in the shell (desktop, folders, the site folder, plugin windows).
applyFilters( 'desktop-mode.tile.class', className: string, spec: TileSpec ): string;
doAction( 'desktop-mode.tile.rendered', { tile: HTMLElement } );
```

`tile-rendered` is the canonical hook for plugin decorations (badges, status dots, drag handles) on the **desktop-files** surface. The layer's fingerprint cache preserves your decoration across no-op repaints; you only need to re-apply on `tile-rendered`.

Use the generic `desktop-mode.tile.*` pair when you want to decorate tiles **everywhere** (site-folder sections, drill-in usage grids, any future surface using `<wpd-tile>`). The placement-shaped pair stays scoped to desktop files. Both are **Stable** (placement-shaped) and **Experimental** (generic).

### Public API

```ts
import { mountFilesLayer } from 'desktop-mode/desktop-files';
const handle = mountFilesLayer( hostElement, folderId );
// later
handle.dispose();
```

## Wallpaper context menu *(Phase 4)*

Clicking empty wallpaper used to call `windowManager.toggleShowDesktop()` directly. Phase 4 replaces that with a small floating menu — the desktop-OS equivalent of right-click on the desktop.

### Built-in items

| Id | Label | Behavior |
|---|---|---|
| `create-folder` | New folder | Prompts for a name, then `POST /folders`. |
| `new-url` | New bookmark | Prompts for an optional name + URL, then creates an `embed` placement that opens inside an iframe-backed desktop window. |
| `sort-by` | Sort by | Submenu with checkable options: Name (A → Z), Name (Z → A), Date (newest first), Date (oldest first); re-sorts the desktop icons. |
| `show-desktop` | Show desktop | Calls `windowManager.toggleShowDesktop()` (the legacy single-click gesture). |
| `os-settings` | OS Settings | Opens the OS Settings window. |

### Plugin extension

JS — for runtime / closure-bearing items:

```js
wp.desktop.hooks.addFilter(
    'desktop-mode.wallpaper-context-menu',
    'my-plugin/menu',
    ( items ) => [
        ...items,
        {
            id: 'my-plugin/sticky-note',
            label: 'New sticky note',
            icon: 'dashicons-format-aside',
            sort: 50,
            onClick: () => myPlugin.createNote(),
        },
    ],
);
```

PHP — for declarative items shipped with the plugin (no closures, since they don't serialize):

```php
add_filter( 'desktop_mode_wallpaper_context_menu_items', function ( $items ) {
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

PHP-shipped items are routed through a JS bundle's `serverCallbacks` map, or fire `desktop-mode.wallpaper-context-menu.activated` so plugins that didn't ship a JS callback can still subscribe.

### Lifecycle actions

```ts
doAction( 'desktop-mode.wallpaper-menu.opened', { items: string[] } );
doAction( 'desktop-mode.wallpaper-menu.closed', {} );
doAction( 'desktop-mode.wallpaper-context-menu.activated', { id: string, callbackId: string } );
```

## Sharing + Heartbeat sync *(Phase 6)*

### Visibility logic

`desktop_mode_files_get_visible_folders( $user_id )` returns the union of:

- Folders owned by `$user_id`.
- Folders not owned by them whose `share_mode` resolves true for them:
  - `'all'` — every desktop-mode user.
  - `'users'` / `'roles'` — resolved through the shares + decisions tables via `desktop_mode_folder_share_user_capability()`: an accepted user-principal share, or an accepted per-user decision on a role-principal share (see [folder-sharing.md](folder-sharing.md)). `share_meta` on the folders row is diagnostic only — it is never consulted for visibility.

Plugins can register a custom share mode by adding it to `desktop_mode_files_share_modes` and computing the per-folder decision via `desktop_mode_files_user_can_see_folder`.

### Heartbeat protocol

Wire format:

**Send (client → server):**

```js
data.desktop_mode_files_subscribe = {
    folderVersions: { '<folderId>': lastSeenUpdatedAtMs, … },
    placementsVersion: lastSeenUpdatedAtMs,
    sharesVersion: lastSeenInviteMs, // highwater of invitedAtMs across received invites
};
```

**Receive (server → client):**

```js
response.desktop_mode_files = {
    placements: [ RestPlacementShape, … ], // upserts since placementsVersion
    folders:    [ RestFolderShape, … ],    // upserts (incl. share-mode flips)
    removed:    { placements: number[], folders: number[] }, // tombstone ids
    shares:     { pending: [ /* ShareShape + folderName / ownerId / ownerName / ownerAvatar */ ] },
    serverTimeMs: number,
    truncated: boolean,
};
```

Pending share invites ride the same heartbeat — `shares.pending` carries every undecided invite newer than `sharesVersion`, each share shape enriched with `folderName`, `ownerId`, `ownerName`, and `ownerAvatar` for the invite banner. See [folder-sharing.md](folder-sharing.md) for the accept/deny opt-in flow.

The client merges upserts via the existing store helpers with `source: 'remote'`, so plugins listening to `desktop-mode-files-changed` can disambiguate between local edits and incoming sync.

When `truncated: true`, the framework issues a one-shot REST resync of every hydrated folder — the cap (`desktop_mode_files_heartbeat_max_rows`, default 200 rows per payload) was hit and a partial delta would leave the client wedged.

### Setting share mode

Interactive sharing goes through the in-shell Share dialog — the folder tile's context menu ("Share folder…" / "Manage sharing…") or the folder window's title-bar Share button — backed by the `/files/folders/<id>/shares` REST routes; see [folder-sharing.md](folder-sharing.md). Plugins (or admin REST tools) can still set sharing programmatically via the low-level folders endpoint:

```
PATCH /wp-json/desktop-mode/v1/files/folders/<id>
{
    "shareMode": "roles",
    "shareMeta": { "roles": [ "editor" ] }
}
```

The `desktop_mode_folder_shared` action fires whenever `share_mode` or `share_meta` changes, giving plugins a single signal to subscribe to.

## Real file storage (`upload`) — Experimental

Real desktop-style file storage: users upload arbitrary files (or whole folder trees) and the bytes land on the server, tied to the uploading user, downloadable later — the file as-is, a folder as an on-demand `.zip`.

### Storage model

Bytes live **flat** on disk under `wp-content/uploads/desktop-mode-files/<user_id>/` with server-generated, extensionless UUID names — hierarchy, display names, and sharing are entirely DB concerns (the existing folders + placements + shares tables). Metadata lives in the `{prefix}desktop_mode_stored_files` table (`owner_id`, `display_name`, `disk_name`, `size_bytes`, `mime`). Renames and moves are single-row updates; no user input ever composes a disk path.

The storage dir is protected by `.htaccess` (both Apache 2.2/2.4 syntaxes) + `index.php`, and bytes are only ever served through the authenticated download endpoints with `Content-Disposition: attachment` + `X-Content-Type-Options: nosniff` (uploaded SVG/HTML never renders from the site origin). **nginx ignores `.htaccess`** — add this to the server config:

```nginx
location ^~ /wp-content/uploads/desktop-mode-files/ { deny all; }
```

Even without it, the extensionless UUID names and the PHP-gated serving are the effective floor. Back up the DB and the storage dir together.

### Uploading

- **Drag from the OS** onto the wallpaper, a folder window, or a closed folder tile. The upload dialog offers a destination selector — Desktop storage or Media Library (the pre-0.9.6 behavior). Defaults follow the drop's intent: folder-targeted drops go to Desktop (into that folder); flat desk drops default to Media Library when every file is a media kind (`image/*`, `video/*`, `audio/*`) and to Desktop otherwise; WordPress admin windows keep Media Library. Folder drops force Desktop storage and recreate the tree (empty directories included, via the drag path only). Dropping again while the dialog is open updates it to the latest drop (the earlier, unconfirmed batch is discarded).
- **Pickers**: wallpaper context menu → "Upload files…" / "Upload folder…".
- Capability gate: `upload_files` by default, filterable via `desktop_mode_stored_files_upload_capability`. Per-file cap: `wp_max_upload_size()`, filterable down via `desktop_mode_stored_files_max_upload_bytes`. Optional per-user quota: `desktop_mode_stored_files_user_quota_bytes` (default unlimited). MIME policy: the user-scoped WordPress allow-list (widen with `desktop_mode_stored_files_allowed_mimes` — it keeps core's re-check in agreement) plus a hard executable/config denylist (`php*`, `phtml`, `phar`, `.htaccess`, …) that also rejects double extensions.

### REST routes

All under `/wp-json/desktop-mode/v1/files`, cookie + nonce auth:

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/uploads` | Multipart intake, ONE file per request: `file` + `parentId` + optional `relativePath` (`a/b/c.ext` — directory segments are created mkdir-p style, deduped) + optional `x`/`y` (omit both → next free grid slot). Returns `{ placement, storedFileId }`. |
| `POST` | `/uploads/paths` | mkdir-p a directory path with no file (`parentId`, `relativePath`). Preserves empty directories from tree drops. |
| `PATCH` | `/uploads/<id>` | Rename the display name (owner only). |
| `GET` | `/uploads/<id>/download` | Stream the bytes, unmodified. `_wpnonce` accepted as a query param so plain `<a>` navigations work. |
| `GET` | `/folders/<id>/download` | On-demand `.zip` of the folder's stored files (reference-type placements are skipped; empty sub-folders round-trip). Requires the PHP zip extension — 501 + a hidden affordance otherwise. Caps filterable via `desktop_mode_stored_files_zip_caps` (default 1000 entries / 500 MB input). |
| `GET/POST` | `/uploads/<id>/shares` (+ `/<shareId>`, `/accept`, `/deny`, `/leave`) | Single-file sharing — see [folder-sharing.md](folder-sharing.md#single-file-shares). |

Downloads answer **404** for files the viewer cannot read (existence masking). Not-found and no-access are indistinguishable.

### Ownership and sharing

Uploaded files are **owner-locked**: only the stored file's owner may move, rename, or trash them — folder write-collaborators included (`desktop_mode_files_upload_owner_locked` error, and `canTrash: false` in the shape). Recipients — via a shared folder or a direct file share — get read + download only. Direct file shares are hard-limited to the read tier.

### Lifecycle

Reconciliation runs on the existing daily prune: placement-less rows and row-less bytes older than a day are removed in both directions. `deleted_user` purges the user's entire storage. Zip temp files are cleaned on stream end, shutdown, and by the daily sweep.

### PHP surface

`desktop_mode_stored_files_get/create/rename/delete/purge()`, `desktop_mode_stored_file_path()`, `desktop_mode_stored_file_user_can_read()`, `desktop_mode_stored_files_total_bytes()`, `desktop_mode_stored_file_share_{invite,accept,deny,leave,revoke}()`. Actions: `desktop_mode_stored_file_{created,uploaded,renamed,deleted,downloaded}`, `desktop_mode_folder_zip_downloaded`. See [hooks-reference.md](hooks-reference.md#real-file-storage) for the filters.

## What's NOT here yet

- Drag-from-Recycle-Bin via HTML5 native drag (the "Pin to desktop" toolbar button ships the equivalent action today).
- The folder-sharing v1 non-goals — owner transfer, cascade share grants (sub-folders need their own grant), recipient-side rename of a shared folder. See [folder-sharing.md](folder-sharing.md). (Sharing of non-folder types is available for stored uploads — read-only, user principals.)
- Upload previews/thumbnails (double-click downloads in v1) and resumable/chunked uploads (the intake keeps receive and register separate so a tus/Content-Range layer can drop in).

If you need any of these today, watch the changelog — the registry shape from Phase 0 is forwards-compatible with every later phase.
