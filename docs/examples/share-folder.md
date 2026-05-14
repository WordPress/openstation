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

Every store mutation publishes to the activity bus:

```js
wp.desktop.activity.subscribe( 'desktop-mode/folder-share-accepted', ( payload ) => {
    // payload: { folderId, shareId, principalType, principalRef, capability }
    console.log( 'Accepted invite for folder', payload.folderId );
} );
```

The cross-bundle shares store lives at the slot
`'desktop-files/shares'`:

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

## See also

- [folder-sharing.md](../folder-sharing.md) — full architecture.
- [hooks-reference.md](../hooks-reference.md#folder-sharing-since-0180-experimental).
