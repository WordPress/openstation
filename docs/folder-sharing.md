# Folder sharing

**Status:** Experimental. The hooks, schema, and
REST contract may change in minor releases — track this doc.

## What it is

The owner of a desktop folder can grant **read** or **read + write**
access to:

- specific WordPress users (anyone with `edit_posts`), or
- WordPress roles (default: roles carrying `edit_posts`).

Recipients see a pending invite on their desktop, accept or deny,
and on accept the folder appears at their desktop root as an
icon. The icon's permissions are independent of the underlying
items inside the folder — sharing a folder that contains a post
does NOT grant `edit_posts` on that post.

Owners cannot transfer ownership. The folder's `owner_id` is
immutable.

## Conceptual model

```
+--------- Owner-side ---------+         +-------- Recipient-side --------+
| Folder "Marketing"           |         | Pending invite (heartbeat)     |
|   owner_id = 1               | invite  |   → first-sight prompt         |
|   share_mode = 'private'     | ─────►  |     [Accept] [Deny] [Later]    |
|   Shares:                    |         |                                |
|     - user 2 → read          |         | After Accept:                  |
|     - role 'editor' → write  |         |   - Folder placement at root   |
+------------------------------+         |   - Heartbeat surfaces members |
                                          |   - Can move icons in/out      |
                                          |     (only if 'write')          |
                                          +--------------------------------+
```

## Capability matrix

| Action                                       | Owner | Writer | Reader | Pending | Denied |
|----------------------------------------------|:-----:|:------:|:------:|:-------:|:------:|
| See the folder in their desktop              |  ✓    |   ✓    |   ✓    |    -    |   -    |
| Open and view icons inside                   |  ✓    |   ✓    |   ✓    |    -    |   -    |
| Drag icons in / out                          |  ✓    |   ✓    |   -    |    -    |   -    |
| Trash icons inside                           |  ✓    |   ✓    |   -    |    -    |   -    |
| Rename the folder                            |  ✓    |   -    |   -    |    -    |   -    |
| Manage shares (invite / revoke)              |  ✓    |   -    |   -    |    -    |   -    |
| Delete the folder for everyone (cascade)     |  ✓    |   -    |   -    |    -    |   -    |
| Move folder to Trash (root placement)        |  ✓    |   -    |   -    |    -    |   -    |
| Leave shared folder (recipient-side)         |  -    |   ✓    |   ✓    |    -    |   -    |

Non-owners — read OR write — cannot move the shared-folder root
placement to the Trash. The "Move to Trash" affordance is hidden
and the recycle-bin drop target rejects the drag. The intended
action is **Leave shared folder** (the dedicated tile-menu entry),
which fires the share-leave flow: revoke the recipient's decision,
scrub their placement, and leave the original intact.

## Path independence

Sharing is keyed on **the folder row**, not on where the folder
happens to be placed. That's true in both directions:

- **Owner moves their copy** (root → sub-folder, between
  containers, etc.). Recipients' placements are untouched. Their
  capability stays the same.
- **Recipient moves their copy** (out of root, into one of their
  own folders, between their containers). Owner is untouched.
  Recipient keeps write capability if granted; the folder's
  contents stay visible because every read goes through
  `openstation_folder_share_user_capability( folder_id, viewer )`
  — never through "what's the placement path."
- **Recipient's placement starts at desktop root.** Regardless of
  where the owner has the folder placed (root, deep inside a
  parent the recipient cannot see, …), `share_accept` plants the
  recipient's tile at `parent_id = 0`. The
  `openstation_folder_share_accept_default_parent` filter lets a
  future "Shared with me" tray plugin override.
- **Cascade still works through moves.** Sub-folders inherit
  access via the canonical (owner-side) ancestor chain. Moving a
  sub-folder OUT of a shared folder revokes the recipient's
  cascade access to it; moving one IN grants it.

## Folder rename

The owner can rename a shared folder at any time. The implementation
bumps two things in lock-step:

1. The folder row's `updated_at_ms` → heartbeat re-delivers the
   folder upsert.
2. Every placement that points at the folder (`file_type='folder'`,
   `file_ref=<id>`) has its `updated_at_ms` bumped → heartbeat
   re-delivers each placement with a fresh `file.title`.

Step 2 matters because the tile's title comes from
`placement.file.title` (captured at shape time). Without bumping
the placement rows, the heartbeat's folder upsert reaches every
client but the placement upsert query skips them — leaving tiles
showing the old name until F5.

Plugins can react via `do_action( 'openstation_folder_renamed',
$folder_id, $new_name, $old_name, $user_id )`.

## Folder delete cascade

When the owner deletes a folder, everything that depends on it is
cleaned up in one transaction:

1. Sub-folders the owner owns are recursively deleted (their own
   shares, placements, and children chain through the same
   cleanup). Sub-folders owned by **another user** — e.g. a
   writer recipient who built their own folder inside this one —
   are left intact; only the containment placement inside the
   parent is removed.
2. Every share row + per-user decision row for the folder is
   deleted.
3. Every placement pointing at the folder is deleted across **all
   users** (each with a tombstone so heartbeat scrubs the tile on
   every connected client).
4. Every placement inside the folder is deleted with a tombstone.
5. The folder row itself is deleted with a folder tombstone.

Plugins can subscribe to:

- `apply_filters( 'openstation_files_can_delete_folder', $can,
  $folder_id, $user_id, $row )` — return `false` or a
  `WP_Error` to veto the cascade (e.g. for a UX confirmation
  prompt when many recipients are involved).
- `do_action( 'openstation_files_before_delete_folder',
  $folder_id, $user_id, $row )` — runs once before the walk.
- `do_action( 'openstation_files_share_revoked', $share_id, $row,
  $user_id )` — fires per share row torn down by the cascade
  (same signature plugin authors already use for explicit
  revokes).
- `do_action( 'openstation_files_after_delete_folder_cascade',
  $root_folder_id, $user_id, $summary )` — single summary event
  with lists keyed by `folders_deleted`, `shares_revoked`,
  `placements_pointing`, `placements_inside`.

## Storage

Two tables back the feature:

```sql
CREATE TABLE wp_desktop_mode_folder_shares (
    id              BIGINT UNSIGNED AUTO_INCREMENT,
    target_type     VARCHAR(32) DEFAULT 'folder',
    folder_id       BIGINT UNSIGNED,
    principal_type  VARCHAR(16),     -- 'user' | 'role'
    principal_ref   VARCHAR(191),    -- user id stringified, or role slug
    capability      VARCHAR(8) DEFAULT 'read',
    state           VARCHAR(16) DEFAULT 'pending',
    invited_by      BIGINT UNSIGNED,
    invited_at_ms   BIGINT UNSIGNED,
    decided_at_ms   BIGINT UNSIGNED NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uniq_principal (target_type, folder_id, principal_type, principal_ref)
);
```

For **user-principal** shares (`principal_type='user'`), the row's
`state` column carries the single recipient's opt-in state — no
per-user fan-out is needed.

For **role-principal** shares (`principal_type='role'`), the
shares row's `state` is just the row's lifecycle marker. The
per-recipient opt-in lives in a second table so each role member
decides independently — without this, the first member to click
"Accept" or "Deny" would decide for the entire role.

```sql
CREATE TABLE wp_desktop_mode_share_user_decisions (
    id              BIGINT UNSIGNED AUTO_INCREMENT,
    share_id        BIGINT UNSIGNED,
    user_id         BIGINT UNSIGNED,
    state           VARCHAR(16) DEFAULT 'pending',
    decided_at_ms   BIGINT UNSIGNED,
    PRIMARY KEY (id),
    UNIQUE KEY uniq_share_user (share_id, user_id)
);
```

Resolution rule, expressed as `openstation_files_share_user_state()`:

- `principal_type='user'` → state from the shares row.
- `principal_type='role'` → state from the decisions row for
  `(share_id, user_id)`, defaulting to `'pending'` when absent.

Pre-0.8.5 sites kept share lists in `wp_desktop_mode_folders.share_meta`
as JSON. Those lists are NOT migrated; the column is retained for
diagnostics only and is never consulted for visibility. Owners
must re-invite recipients through the shares API.

### Why `target_type`?

The column ships from day one so a future plugin can register a
NEW shareable target without a schema migration:

```php
add_filter( 'openstation_files_shareable_types', function ( $types ) {
    $types[] = 'post';
    return $types;
} );
add_filter( 'openstation_files_share_target_owner', function ( $owner, $type, $ref ) {
    if ( 'post' === $type ) {
        return (int) get_post_field( 'post_author', (int) $ref );
    }
    return $owner;
}, 10, 3 );
```

v1 ships with `'folder'` only. The REST routes live under
`/folders/{id}/shares`; a future generic surface (e.g.
`/share-targets/{type}/{id}/shares`) can hit the same store
functions.

## Visibility resolution

`openstation_files_compute_visible_folders( $owned, $user_id )`
returns the union of:

1. **Owned folders** (`$owned` is the seed — owner-side).
2. **share_mode='all'** folders the viewer doesn't own.
3. **Accepted shares** matching the viewer — direct user grant OR
   any role the viewer holds.

`share_meta` on the folders row is diagnostic-only and is never
consulted for visibility (a legacy fallback was deliberately
dropped because it re-granted access to revoked recipients).

Filtered via `openstation_files_visible_folders` (priority 5) and
`openstation_files_user_can_see_folder` (per-row decision).

## Write enforcement

`openstation_files_move()`, `_place()`, and the
`openstation_files_user_can_trash_placement` gate consult
`openstation_folder_share_user_capability( $folder_id, $user_id )`:

- Owner always returns `'write'`.
- `share_mode='all'` returns `'read'` by default (filterable).
- Accepted shares contribute their `capability`; most permissive
  wins (write > read > none).
- Pending and denied shares do not contribute.

A non-write recipient that tries to move an icon into or out of
the shared folder, or trash an icon inside it, gets a 403:

```
WP_Error( 'openstation_files_no_write_in_shared_folder', ... )
```

## Conflict detection (If-Match)

`PATCH /files/placements/{id}` and `PATCH /files/folders/{id}`
honour an optional `If-Match: <updated_at_ms>` header. When the
header is present AND the stored row's `updated_at_ms` differs,
the server returns 409 with a structured body:

```json
{
    "code": "openstation_files_conflict",
    "message": "...",
    "data": {
        "status": 409,
        "data": {
            "reason": "parent_changed",
            "actor": { "id": 7, "name": "Alice", "avatar": "https://..." },
            "current": { "parentId": 42, "parentName": "Backlog", "updatedAtMs": 1737130000000 }
        }
    }
}
```

The 409 body is **viewer-scoped**. The actor's identity and the
parent folder's id/name are included only when the requesting
viewer is in the same collaboration scope as the actor — they own
the row, own the parent folder, or hold at least read access to
the parent folder via the shares table. For any other viewer the
`actor` degrades to `{ "id": 0, "name": "", "avatar": "" }` and
`current.parentId` / `current.parentName` degrade to `0` / `""`,
so a write attempt can't be used to enumerate other users'
display names or folder names.

The JS client throws `FilesConflictError` and the layer surfaces a
toast: *"Alice moved this to 'Backlog' just now. [View folder]"*.

Clients that omit the header retain last-write-wins semantics for
back-compat. The OpenStation shell always sends the header.

## Opt-in flow

1. Owner invites — share row written with `state='pending'`.
2. Recipient's next heartbeat tick carries the invite in
   `openstation_files.shares.pending[]`.
3. The shell shows an Accept / Deny / Later modal on first sight.
4. Accept → row becomes `state='accepted'`, server places the
   folder at the recipient's desktop root via
   `openstation_folder_share_accept_default_parent` filter.
5. Deny → row becomes `state='denied'`; the shell adds the folder
   to a per-session denied set so the prompt does not re-fire.
6. Later → row stays `pending`; the shell remembers it was
   prompted this session and won't re-open the modal until next
   heartbeat tick after a page reload.

## Leave shared folder (recipient-initiated)

A recipient can leave a folder they've previously accepted via
the "Leave shared folder" item in the tile's right-click menu.
The endpoint is principal-aware:

- **User-principal share** — flips the shares row to
  `state='denied'`. The owner sees the user dropped in the share
  list.
- **Role-principal share** — writes a per-user decision row with
  `state='denied'`. Other role members are unaffected.

In both cases, the recipient's placement of the folder is
soft-trashed (lands in their recycle bin; the underlying icons
inside the folder, which belong to the shared namespace, are
untouched).

Owners cannot leave their own folder (the endpoint returns 400
with `openstation_files_owner_cannot_leave`).

## REST routes

```
GET    /desktop-mode/v1/files/folders/{id}/shares
POST   /desktop-mode/v1/files/folders/{id}/shares
PATCH  /desktop-mode/v1/files/folders/{id}/shares/{shareId}
DELETE /desktop-mode/v1/files/folders/{id}/shares/{shareId}
POST   /desktop-mode/v1/files/folders/{id}/shares/{shareId}/accept
POST   /desktop-mode/v1/files/folders/{id}/shares/{shareId}/deny
POST   /desktop-mode/v1/files/folders/{id}/leave       ← recipient-initiated

GET    /desktop-mode/v1/files/users/search?q=&exclude=

POST   /desktop-mode/v1/files/folder-sharing-tables/purge   ← `manage_options` only
```

All require `openstation_is_enabled` + logged-in. Every share
route (including `/leave`) additionally requires the viewer's
folder-sharing OS Setting to be on; when it is off the routes
answer 404 (indistinguishable from the feature not being
installed). Share-management mutations (POST/PATCH/DELETE on
`/shares`) are gated by `openstation_files_share_can_manage`
(owner-only by default). `/leave` is open to any logged-in user
who is currently a recipient of the folder. `/users/search`
requires `edit_posts`. The table-purge route is a destructive
site-admin cleanup (drops the folder-sharing tables) and requires
`manage_options`.

## Hooks

See [hooks-reference.md](hooks-reference.md#folder-sharing-experimental).

## JS surface

To react to share changes today, subscribe to the shares store —
a `createSharedStore( 'desktop-files/shares' )` slot updated by
the heartbeat ingest.

**Planned** — `wp.os.activity` channels for the share
lifecycle are not yet published:

- `os/folder-share-invited`
- `os/folder-share-accepted`
- `os/folder-share-denied`
- `os/folder-share-revoked`
- `os/folder-share-capability-changed`

Programmatic entry points (from `src/desktop-files/rest.ts`):

```ts
import {
    listShares,
    inviteShare,
    revokeShare,
    updateShareCapability,
    acceptShare,
    denyShare,
    FilesConflictError,
} from '...';
```

The Share Settings modal (owner side) is opened via:

```ts
import { openShareSettingsModal } from '.../desktop-files/share-settings-modal';
openShareSettingsModal( { folderId, folderName } );
```

## Re-share prevention

A recipient cannot re-share a folder they've received:

- **Server** — every share mutation calls
  `openstation_files_share_can_manage`. Default decision is
  owner-only. Plugins that ship a "team admin" concept can
  broaden it; non-owners always get a 403 otherwise.
- **Client** — the title-bar Share button's `match` predicate
  consults the folders shared store and only renders for the
  owner. The tile context menu's "Share folder…" / "Manage
  sharing…" entries follow the same rule; recipients see the
  "Leave shared folder" entry instead.

## Single-file shares

Stored uploads (the `upload` file type — see
[files-on-desktop.md](files-on-desktop.md#real-file-storage-upload--experimental))
are shareable as single files, reusing this feature's tables via the
`target_type='file'` column (the `folder_id` column carries the
stored-file id on those rows). Deliberate divergences from folder
shares:

- **Read tier only.** Recipients get view + download; the write tier
  does not exist for files. An invite with `capability: write` is a
  400.
- **User principals only** in v1 (no role invites).
- Uploads are additionally **owner-locked** everywhere: even a
  folder write-collaborator cannot move, rename, or trash an
  `upload` placement inside a shared folder — only the stored file's
  owner can (`openstation_files_upload_owner_locked`). The
  read/write tiers of THIS page are unchanged for every other type.

Lifecycle mirrors folders: invite → heartbeat delivers the pending
shape (`targetType: 'file'`, `fileId`, `fileName` riding the same
`shares.pending` channel) → accept plants an `upload` placement at
the recipient's desktop root (`openstation_folder_share_accept_default_parent`
filter applies) → deny / leave / revoke scrub the recipient's tile.
Routes live under `/desktop-mode/v1/files/uploads/{id}/shares` and
mirror the folder routes below, including the 404-when-disabled
masking. Store functions:
`openstation_stored_file_share_{invite,accept,deny,leave,revoke}()`,
state resolver `openstation_stored_file_share_state()`, manage gate
`openstation_stored_files_share_can_manage` (owner-only default,
filterable).

## Non-goals (v1)

- Owner transfer.
- Sharing of non-upload, non-folder file types (posts, media
  references, …).
- Role-principal shares for single files.
- Cascade share (sub-folders need their own grant).
- Recipient-side rename of the shared folder.

## Related

- [hooks-reference.md](hooks-reference.md)
- [javascript-reference.md](javascript-reference.md)
- [files-on-desktop.md](files-on-desktop.md)
