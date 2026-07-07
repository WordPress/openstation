# Programmatic folder sharing

Two recipes: server-side (invite from PHP) and client-side
(listen for share events).

## Invite a user from PHP

```php
add_action( 'init', function () {
    // Imagine we just created a folder via desktop_mode_files_create_folder
    // and want to grant the team Editor role read access programmatically.
    if ( ! function_exists( 'desktop_mode_folder_share_invite' ) ) {
        return;
    }
    $folder_id = (int) get_option( 'my_plugin_shared_folder_id' );
    $owner_id  = (int) get_post_field( 'post_author', $folder_id ); // or wherever you stash it

    $share_id = desktop_mode_folder_share_invite(
        $folder_id,
        $owner_id,
        'role',          // principal_type: 'user' | 'role'
        'editor',        // principal_ref:  user id (stringified) or role slug
        'read'           // capability:     'read' | 'write'
    );
    if ( is_wp_error( $share_id ) ) {
        error_log( 'Could not invite editor role: ' . $share_id->get_error_message() );
    }
} );
```

A pending share row appears in `wp_desktop_mode_folder_shares`.
The next heartbeat tick delivers it to every editor's desktop
shell. They accept or deny via the modal.

## React to share lifecycle events

```php
add_action( 'desktop_mode_files_share_accepted', function ( $share_id, $row, $user_id ) {
    // Send a welcome notification when someone accepts an invite.
    wp_mail(
        get_userdata( $user_id )->user_email,
        'Welcome to the team folder',
        'You can now collaborate inside the folder.'
    );
}, 10, 3 );

add_action( 'desktop_mode_files_share_revoked', function ( $share_id, $row, $actor_id ) {
    // Audit log every revoke.
    error_log( "Share #{$share_id} revoked by user {$actor_id}" );
}, 10, 3 );
```

## Broaden who can manage shares

The default is owner-only. Plugins that ship a "team admin"
concept can extend it:

```php
add_filter( 'desktop_mode_files_share_can_manage', function ( $can, $folder_id, $user_id, $folder ) {
    if ( $can ) {
        return $can;
    }
    return user_can( $user_id, 'manage_team_folders' );
}, 10, 4 );
```

## Filter eligible recipients

Default eligibility is "any role that carries `edit_posts`".
Restrict (or broaden) to your site's reality:

```php
add_filter( 'desktop_mode_files_share_eligible_roles', function ( $roles ) {
    // Only allow sharing with the Editor and a custom "team_lead" role.
    return array_filter( $roles, function ( $r ) {
        return in_array( $r['slug'], array( 'editor', 'team_lead' ), true );
    } );
} );
```

The user autocomplete (`GET /files/users/search`) is gated by
`edit_posts` at the request level; if you've added a custom role
that should appear in the picker, give it `edit_posts` or add a
custom permission callback via:

```php
add_filter( 'desktop_mode_files_share_user_query_args', function ( $args, $req_params ) {
    // E.g. only return users in the same multisite blog as the actor.
    $args[ 'blog_id' ] = get_current_blog_id();
    return $args;
}, 10, 2 );
```

## React from JS

Share state lives in the cross-bundle shares store at the slot
`'desktop-files/shares'` — subscribe to it to react to share
lifecycle changes (new pending invites, accepts, revokes) from
any bundle:

```ts
import { createSharedStore } from '...';
const store = createSharedStore( 'desktop-files/shares', () => ( {
    byFolder: new Map(),
    pending: [],
    sharesVersion: 0,
    deniedFolders: new Set(),
} ) );
store.subscribe( ( s ) => {
    console.log( 'Pending invites:', s.pending.length );
} );
```

## Open the Share Settings modal yourself

The default UI hooks are the title-bar button on folder windows
and the "Share folder…" item in the tile context menu. To open
the modal from your own code path:

```ts
import { openShareSettingsModal } from '/path/to/share-settings-modal';
openShareSettingsModal( {
    folderId: 42,
    folderName: 'Marketing assets',
    ownerName: 'Daniel',
} );
```

## Send an If-Match header on PATCH

Server-side conflict detection is opt-in per request:

```ts
import { updatePlacement } from '...';
try {
    await updatePlacement(
        placementId,
        { parentId: targetFolder },
        currentUpdatedAtMs,    // ← If-Match value
    );
} catch ( err ) {
    if ( err instanceof FilesConflictError ) {
        console.log( 'Lost to', err.detail.actor.name );
    }
}
```

Pass `0` (or omit) the third arg to keep last-write-wins
semantics.

## Veto a folder delete (confirmation prompts, audit guards)

`desktop_mode_files_can_delete_folder` runs after the ownership
check and before the cascade. Return a `WP_Error` or anything
other than `true` to block — the cascade proceeds only when the
filter resolves to exactly `true` (the default).

```php
add_filter(
    'desktop_mode_files_can_delete_folder',
    function ( $can, $folder_id, $user_id, $folder ) {
        // Block delete when the folder has >5 active recipients
        // until the owner explicitly revokes the shares first.
        if ( ! function_exists( 'desktop_mode_files_get_folder_shares' ) ) {
            return $can;
        }
        $shares = (array) desktop_mode_files_get_folder_shares( $folder_id );
        $active = array_filter( $shares, fn( $s ) => 'denied' !== $s['state'] );
        if ( count( $active ) > 5 ) {
            return new WP_Error(
                'my_plugin_too_many_recipients',
                'Revoke shares before deleting a folder with >5 recipients.',
                array( 'status' => 409 )
            );
        }
        return $can;
    },
    10,
    4
);
```

## React to the cascade summary

`desktop_mode_files_after_delete_folder_cascade` fires once per
folder delete with a structured summary of everything that was
torn down — useful for audit logs, cross-tenant cleanup, or
sending notifications to affected recipients.

```php
add_action(
    'desktop_mode_files_after_delete_folder_cascade',
    function ( $root_folder_id, $user_id, $summary ) {
        error_log( sprintf(
            'User %d deleted folder %d → cascade removed %d folder(s), %d share(s), %d pointing placement(s), %d inside placement(s).',
            $user_id,
            $root_folder_id,
            count( $summary['folders_deleted'] ),
            count( $summary['shares_revoked'] ),
            count( $summary['placements_pointing'] ),
            count( $summary['placements_inside'] )
        ) );
    },
    10,
    3
);
```

Per-share `desktop_mode_files_share_revoked` actions fire during
the cascade for each share that gets torn down, so plugins
already listening to that signal don't need to subscribe to the
summary too — both fire.

## React to a folder rename

```php
add_action(
    'desktop_mode_folder_renamed',
    function ( $folder_id, $new_name, $old_name, $user_id ) {
        // Mirror the rename into a sidecar plugin table.
        my_plugin_update_folder_label( $folder_id, $new_name );
    },
    10,
    4
);
```

The framework already bumps every placement pointing at the
renamed folder so connected clients see the new title via the
next heartbeat tick — no extra work needed for live UI sync.

## See also

- [folder-sharing.md](../folder-sharing.md) — full architecture.
- [hooks-reference.md](../hooks-reference.md#folder-sharing-since-085-experimental).
