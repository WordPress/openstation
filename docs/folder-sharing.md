# Folder sharing

**Status:** Experimental (since 0.18.0). The hooks, schema, and
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

| Action                                | Owner | Writer | Reader | Pending | Denied |
|---------------------------------------|:-----:|:------:|:------:|:-------:|:------:|
| See the folder in their desktop       |  ✓    |   ✓    |   ✓    |    -    |   -    |
| Open and view icons inside            |  ✓    |   ✓    |   ✓    |    -    |   -    |
| Drag icons in / out                   |  ✓    |   ✓    |   -    |    -    |   -    |
| Trash icons inside                    |  ✓    |   ✓    |   -    |    -    |   -    |
| Rename the folder                     |  ✓    |   -    |   -    |    -    |   -    |
| Manage shares (invite / revoke)       |  ✓    |   -    |   -    |    -    |   -    |
| Delete the folder for everyone        |  ✓    |   -    |   -    |    -    |   -    |
| Remove their own copy from desktop    |  ✓    |   ✓    |   ✓    |    -    |   -    |

(Owner can move/trash freely; non-owners can only act through the
shared folder's gate.)

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

Resolution rule, expressed as `desktop_mode_files_share_user_state()`:

- `principal_type='user'` → state from the shares row.
- `principal_type='role'` → state from the decisions row for
  `(share_id, user_id)`, defaulting to `'pending'` when absent.

Pre-0.18.0 sites kept share lists in `wp_desktop_mode_folders.share_meta`
as JSON. A one-shot migration (`desktop_mode_files_migrate_share_meta_to_shares`)
backfills them into the new tables as `state='accepted'` rows.

### Why `target_type`?

The column ships from day one so a future plugin can register a
NEW shareable target without a schema migration:

```php
add_filter( 'desktop_mode_files_shareable_types', function ( $types ) {
    $types[] = 'post';
    return $types;
} );
add_filter( 'desktop_mode_files_share_target_owner', function ( $owner, $type, $ref ) {
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

`desktop_mode_files_compute_visible_folders( $owned, $user_id )`
returns the union of:

1. **Owned folders** (`$owned` is the seed — owner-side).
2. **share_mode='all'** folders the viewer doesn't own.
3. **Accepted shares** matching the viewer — direct user grant OR
   any role the viewer holds.
4. **Legacy `share_meta`** rows (back-compat for pre-0.18 data).

Filtered via `desktop_mode_files_visible_folders` (priority 5) and
`desktop_mode_files_user_can_see_folder` (per-row decision).

## Write enforcement

`desktop_mode_files_move()`, `_place()`, and the
`desktop_mode_files_user_can_trash_placement` gate consult
`desktop_mode_folder_share_user_capability( $folder_id, $user_id )`:

- Owner always returns `'write'`.
- `share_mode='all'` returns `'read'` by default (filterable).
- Accepted shares contribute their `capability`; most permissive
  wins (write > read > none).
- Pending and denied shares do not contribute.

A non-write recipient that tries to move an icon into or out of
the shared folder, or trash an icon inside it, gets a 403:

```
WP_Error( 'desktop_mode_files_no_write_in_shared_folder', ... )
```

## Conflict detection (If-Match)

`PATCH /files/placements/{id}` and `PATCH /files/folders/{id}`
honour an optional `If-Match: <updated_at_ms>` header. When the
header is present AND the stored row's `updated_at_ms` differs,
the server returns 409 with a structured body:

```json
{
    "code": "desktop_mode_files_conflict",
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

The JS client throws `FilesConflictError` and the layer surfaces a
toast: *"Alice moved this to 'Backlog' just now. [View folder]"*.

Clients that omit the header retain last-write-wins semantics for
back-compat. The desktop-mode shell always sends the header.

## Opt-in flow

1. Owner invites — share row written with `state='pending'`.
2. Recipient's next heartbeat tick carries the invite in
   `desktop_mode_files.shares.pending[]`.
3. The shell shows an Accept / Deny / Later modal on first sight.
4. Accept → row becomes `state='accepted'`, server places the
   folder at the recipient's desktop root via
   `desktop_mode_folder_share_accept_default_parent` filter.
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
with `desktop_mode_files_owner_cannot_leave`).

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
```

All require `desktop_mode_is_enabled` + logged-in. Share-management
mutations (POST/PATCH/DELETE on `/shares`) are gated by
`desktop_mode_files_share_can_manage` (owner-only by default).
`/leave` is open to any logged-in user who is currently a recipient
of the folder. `/users/search` requires `edit_posts`.

## Hooks

See [hooks-reference.md](hooks-reference.md#folder-sharing-since-0180-experimental).

## JS surface

The `wp.desktop.activity` bus publishes:

- `desktop-mode/folder-share-invited`
- `desktop-mode/folder-share-accepted`
- `desktop-mode/folder-share-denied`
- `desktop-mode/folder-share-revoked`
- `desktop-mode/folder-share-capability-changed`

The shares store is a `createSharedStore( 'desktop-files/shares' )`
slot; subscribe to its updates to react.

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
  `desktop_mode_files_share_can_manage`. Default decision is
  owner-only. Plugins that ship a "team admin" concept can
  broaden it; non-owners always get a 403 otherwise.
- **Client** — the title-bar Share button's `match` predicate
  consults the folders shared store and only renders for the
  owner. The tile context menu's "Share folder…" / "Manage
  sharing…" entries follow the same rule; recipients see the
  "Leave shared folder" entry instead.

## Non-goals (v1)

- Owner transfer.
- Sharing of non-folder file types (the schema is ready;
  the REST + modal aren't).
- Cascade share (sub-folders need their own grant).
- Recipient-side rename of the shared folder.

## Related

- [hooks-reference.md](hooks-reference.md)
- [javascript-reference.md](javascript-reference.md)
- [files-on-desktop.md](files-on-desktop.md)
