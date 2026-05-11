# Files on the Desktop

**Status:** Experimental (since 0.9.0).

The Files-on-the-Desktop system lets users place WordPress entities — posts, users, media, terms, comments, bookmarks — on their desktop wallpaper, organize them inside folders, and (in later phases) share folders with other users via Heartbeat-driven sync. Plugin authors extend the system by registering their own file types through the same surface the seven built-ins use.

This is an evolving feature. Phase 0 (this document's current scope) establishes the registry and the `Desktop_Mode_File` base class. Future phases layer in:

| Phase | Adds |
|---|---|
| 1 | File-opener registry + per-user associations *(landed)* |
| 2 | Custom-table schema + REST + store *(landed)* |
| 3 | Desktop UI: tile rendering, in-desktop drag *(landed; folder windows deferred to Phase 4)* |
| 4 | Wallpaper context menu (replaces "minimize all" click) *(landed)* |
| 5 | OS Settings → File Associations tab *(landed)* |
| 6 | Folder sharing (private / users / roles / all) + Heartbeat sync *(landed; share dialog UI deferred)* |
| 7 | Drag from Recycle Bin onto the desktop *(landed as "Pin to desktop"; HTML5 drag UX is a follow-up)* |

Each phase ships independently and is documented as it lands.

## Mental model

A **file** on the desktop is a `Desktop_Mode_File` subclass adapting one WordPress entity (a post, a user, a comment …) to the shape the desktop UI expects: title, icon, preview, and a capability gate. Files don't know how to open themselves — that's a separate concern (Phase 1: the opener registry).

### Files are references, not copies

A placement is a **reference** to a WordPress entity, not a copy of it. Removing a placement (`DELETE /placements/<id>` or `desktop_mode_files_remove()`) drops the placement row only — the underlying post, user, attachment, comment, or term is **never** touched. Folder deletion cascades placements via tombstones but still leaves referenced entities intact. This is asserted in `Tests_DesktopMode_FilesStore::test_remove_does_not_delete_underlying_entity` and is the core safety contract of the system. Plugins that want a "delete the post too" flow must call `wp_delete_post()` (or equivalent) themselves — the framework will not do it for them.

A **file type** is a slug that points the registry at the right subclass. The built-ins are:

| Slug | Class | Reference shape |
|---|---|---|
| `post` | `Desktop_Mode_Post_File` | post id (numeric string) |
| `attachment` | `Desktop_Mode_Attachment_File` | attachment id |
| `user` | `Desktop_Mode_User_File` | user id |
| `term` | `Desktop_Mode_Term_File` | `"<taxonomy>:<term_id>"` |
| `comment` | `Desktop_Mode_Comment_File` | comment id |
| `folder` | `Desktop_Mode_Folder_File` | folder row id (Phase 2) |
| `bookmark` | `Desktop_Mode_Bookmark_File` | URL string |
| `link` | `Desktop_Mode_Link_File` | URL string — opens in a new browser tab |
| `embed` | `Desktop_Mode_Embed_File` | URL string — opens in an iframe-backed desktop window; geometry persists on `placement.meta.window` |

`link` and `embed` placements both carry an optional human-friendly label on `placement.meta.name` (set by the wallpaper-menu "New URL" entry) — the tile renderer prefers it over `file.title()` so two tiles pointing at the same URL can carry different labels. `embed` placements additionally persist `{ x, y, width, height }` on `placement.meta.window` after every drag-end / resize-end of the spawned window; the next open clamps that geometry to the current desktop area before restoring.

`link` placements also carry a server-resolved favicon on `placement.meta.iconUrl` (since 0.20.0). The string is a base64 data URI of the form `data:image/(png|jpeg|gif|webp|x-icon|svg+xml);base64,<payload>`. The favicon resolver runs inline during `POST /placements` (server-side, via `wp_safe_remote_get` + `DOMDocument` parsing of the page's `<link rel="icon">` tags, with a `/favicon.ico` fallback). When the resolver fails — bad host, network error, oversized body, content-type mismatch — `meta.iconUrl` is omitted and the tile falls back to the file type's dashicon. Icons are capped at 256 KB raw bytes; the cap keeps `meta` blobs small. Plugins can short-circuit or override the resolved value via the `desktop_mode_resolve_favicon` filter. The `meta.iconUrl` precedence is generic — any plugin can attach a custom per-placement icon (URL or data URI) on any type, not just `link`.

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
- `registerOpener( FileOpenerDef ): void`
- `unregisterOpener( id: string ): void`
- `getOpener( id: string ): FileOpenerDef | null`
- `getOpeners(): FileOpenerDef[]`
- `getOpenersForType( type: string ): FileOpenerDef[]`
- `resolveOpener( type: string ): FileOpenerDef | null`
- `subscribeOpeners( cb ): () => void`
- `getUserAssociations(): Record< string, string >`
- `open( file: DesktopFile ): Promise< boolean >` — full dispatcher.

## Openers — the file-association layer *(Phase 1, since 0.9.0)*

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
- `window` — handler points at a `desktop_mode_register_window`-registered native-window id, with optional per-file `config(file)` (consumed by the window via `wp.desktop.getWindowConfig`).
- `js` — handler runs free-form code in the shell context. Useful for modals, quick-actions, "preview" affordances.

### Built-in openers

| Opener id | Type | Kind | URL / target |
|---|---|---|---|
| `wp-post-editor` | `post` | `url` | `post.php?post=…&action=edit` |
| `wp-media-editor` | `attachment` | `url` | `post.php?post=…&action=edit` |
| `wp-user-profile` | `user` | `url` | `user-edit.php?user_id=…` |
| `wp-term-editor` | `term` | `url` | `term.php?taxonomy=…&tag_ID=…` |
| `wp-comment-editor` | `comment` | `url` | `comment.php?action=editcomment&c=…` |
| `browser-navigate` | `bookmark` | `js` | `window.open(url, '_blank', 'noopener,noreferrer')` |
| `desktop-mode-link-opener` | `link` | `js` | `window.open(url, '_blank', 'noopener,noreferrer')` |
| `desktop-mode-embed-opener` | `embed` | `js` | Opens an iframe-backed window at `url`. Reads `placement.meta.window` for restored geometry, clamps it to the current desktop area, and persists subsequent drag-end / resize-end back to `placement.meta.window` via REST. |

The `folder` type doesn't ship a built-in opener yet — it lands in Phase 3 alongside the folder native window.

### Opening a file

```js
const file = wp.desktop.files.resolve( shape ); // shape from server
wp.desktop.files.open( file ); // returns Promise< boolean >
```

The dispatcher fires `desktop-mode.files.opening` before invoking the handler and `desktop-mode.files.opened` after success (or `desktop-mode.files.open-failed` on no-opener / handler-throw). All three actions carry `{ file, openerId, kind }` so plugins can observe.

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

## Persistence — schema, REST, store *(Phase 2, since 0.9.0)*

### Custom tables

Three tables back the system, created via `dbDelta` on plugin activation and refreshed lazily on `admin_init` when `DESKTOP_MODE_FILES_SCHEMA_VERSION` mismatches the option.

| Table | Purpose | Key columns |
|---|---|---|
| `{prefix}desktop_mode_file_placements` | One row per placed tile | `user_id`, `parent_id`, `file_type`, `file_ref`, `x`, `y`, `sort_order`, `updated_at_ms`, `meta` (JSON) |
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
| `DELETE` | `/placements/<id>` | Remove. |
| `GET` | `/folders` | List folders the viewer owns (Phase 6 expands to shared folders). |
| `POST` | `/folders` | `{ name, shareMode?, shareMeta? }` |
| `PATCH` | `/folders/<id>` | `{ name?, shareMode?, shareMeta? }` |
| `DELETE` | `/folders/<id>` | Removes the folder + cascades placements (each tombstone'd). |
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

## Rendering — `FilesLayer` + tiles *(Phase 3, since 0.9.0)*

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

### Drag *(reworked in 0.18.0)*

Drag is owned end-to-end by the centralized `DragManager`
(`wp.desktop.dragManager`). A tile's `pointerdown` calls
`dragManager.start({ payload, origin, … })`; the manager attaches its
own document-level pointermove / pointerup / pointercancel listeners
and drives the gesture from there. Tiles do NOT call `setPointerCapture`
— pointer capture is incompatible with HTML5 `dragstart` detection on
draggable elements (the My WordPress entity-tile drag-out bug, fixed
in 0.18.0).

Lifecycle:

  1. `pointerdown` → manager session armed (no visual change yet).
  2. First `pointermove` past 4 px threshold → ghost mounts under the
     pointer; source tile gets `--dragging` (opacity 0.4).
  3. Subsequent moves → ghost follows; the registry hit-tests under
     the cursor; matching drop targets fire `onEnter` / `onLeave`;
     ghost cursor flips between `copy` / `no-drop`.
  4. `pointerup` → re-hit-test; an accepting target fires `onDrop`
     (the FilesLayer's canvas / a folder tile / the Recycle Bin);
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
body — the Recycle Bin's `[data-desktop-mode-recycle-bin-root]` is
the canonical example.

Cancellation: `Escape`, `window.blur`, `document.visibilitychange` to
hidden, and `pointercancel` all cancel the active session and run a
single idempotent cleanup (`--dragging`, `--drop-target`,
`data-desktop-mode-trash-drop-active`, `data-files-drop-active` are
all stripped from the document). Plugins observing the bus see
`document` CustomEvents — `desktop-mode.drag.{start,move,enter,leave,
rejected,commit,cancel,end}`.

Visual feedback *(strengthened in 0.20.0)*: while a drag is in
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
`dataTransfer`, but is `@deprecated since 0.18.0`. New code uses the
manager.

### Open

Double-click on a tile resolves the placement's serialized shape into a `DesktopFile` instance and calls `wp.desktop.files.open()`, which routes through the opener registry (Phase 1).

### Plugin extension points

```ts
applyFilters( 'desktop-mode.files.tile-class', className: string, placement: RestPlacementShape ): string;
applyFilters( 'desktop-mode.files.tile-element', extra: Element | null, placement: RestPlacementShape ): Element | null;
doAction( 'desktop-mode.files.tile-rendered', { tile: HTMLElement, placement: RestPlacementShape } );
doAction( 'desktop-mode.files.grid-rendered', { folderId: number, count: number } );
```

`tile-rendered` is the canonical hook for plugin decorations (badges, status dots, drag handles). The layer's fingerprint cache preserves your decoration across no-op repaints; you only need to re-apply on `tile-rendered`.

### Public API

```ts
import { mountFilesLayer } from 'desktop-mode/desktop-files';
const handle = mountFilesLayer( hostElement, folderId );
// later
handle.dispose();
```

## Wallpaper context menu *(Phase 4, since 0.9.0)*

Clicking empty wallpaper used to call `windowManager.toggleShowDesktop()` directly. Phase 4 replaces that with a small floating menu — the desktop-OS equivalent of right-click on the desktop.

### Built-in items

| Id | Label | Behavior |
|---|---|---|
| `create-folder` | New folder | Prompts for a name, then `POST /folders`. |
| `show-desktop` | Show desktop | Calls `windowManager.toggleShowDesktop()` (the legacy single-click gesture). |
| `os-settings` | OS Settings | Opens the OS Settings window. |
| `wallpapers` | Wallpapers | Opens the OS Settings window (Phase-5 will deep-link to the Appearance tab). |

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

## Sharing + Heartbeat sync *(Phase 6, since 0.9.0)*

### Visibility logic

`desktop_mode_files_get_visible_folders( $user_id )` returns the union of:

- Folders owned by `$user_id`.
- Folders not owned by them whose `share_mode` resolves true for them:
  - `'all'` — every desktop-mode user.
  - `'users'` — `$user_id` is in `share_meta.users`.
  - `'roles'` — `$user_id` has any role in `share_meta.roles`.

Plugins can register a custom share mode by adding it to `desktop_mode_files_share_modes` and computing the per-folder decision via `desktop_mode_files_user_can_see_folder`.

### Heartbeat protocol

Wire format:

**Send (client → server):**

```js
data.desktop_mode_files_subscribe = {
    folderVersions: { '<folderId>': lastSeenUpdatedAtMs, … },
    placementsVersion: lastSeenUpdatedAtMs,
};
```

**Receive (server → client):**

```js
response.desktop_mode_files = {
    placements: [ RestPlacementShape, … ], // upserts since placementsVersion
    folders:    [ RestFolderShape, … ],    // upserts (incl. share-mode flips)
    removed:    { placements: number[], folders: number[] }, // tombstone ids
    serverTimeMs: number,
    truncated: boolean,
};
```

The client merges upserts via the existing store helpers with `source: 'remote'`, so plugins listening to `desktop-mode-files-changed` can disambiguate between local edits and incoming sync.

When `truncated: true`, the framework issues a one-shot REST resync of every hydrated folder — the cap (`desktop_mode_files_heartbeat_max_rows`, default 200 rows per payload) was hit and a partial delta would leave the client wedged.

### Setting share mode

The Phase-6 ship is data-path only — the kebab dialog UI lands once folder native windows arrive. Today plugins (or admin REST tools) set sharing via the existing endpoint:

```
PATCH /wp-json/desktop-mode/v1/files/folders/<id>
{
    "shareMode": "roles",
    "shareMeta": { "roles": [ "editor" ] }
}
```

The `desktop_mode_folder_shared` action fires whenever `share_mode` or `share_meta` changes, giving plugins a single signal to subscribe to.

## What's NOT here yet

- Folder native windows + the kebab "Share…" dialog.
- Drag-from-Recycle-Bin via HTML5 native drag (the "Pin to desktop" toolbar button ships the equivalent action today).
- The wallpaper-click context menu (Phase 4).
- File associations UI (Phase 5).
- Folder sharing + cross-user sync (Phase 6).
- Drag from the Recycle Bin (Phase 7).

If you need any of these today, watch the changelog for the relevant phase to land — the registry shape from Phase 0 is forwards-compatible with every later phase.
