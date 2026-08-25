# Track who's around — `wp.os.presence`

**Stable.**

The framework keeps a running map of who's currently in the
OpenStation WP-Admin. Three states — `online`, `inactive`,
`offline` — derived from the WordPress Heartbeat plus a
pointerdown / keydown listener. Storage is server-side
(`_desktop_mode_presence` option) so every tab in every browser
sees the same map.

This example builds a tiny "Who's online" widget on the desktop
to show the pattern. Drop it into a plugin file:

```php
<?php
/**
 * Plugin Name: Whos Online Widget
 */
defined( 'ABSPATH' ) || exit;

add_action( 'admin_enqueue_scripts', function () {
    if ( ! function_exists( 'openstation_is_enabled' ) || ! openstation_is_enabled() ) {
        return;
    }
    wp_register_script(
        'whos-online-widget',
        plugins_url( 'whos-online.js', __FILE__ ),
        array( 'openstation' ),
        '1.0',
        true
    );
    wp_enqueue_script( 'whos-online-widget' );
} );

// Surface the user's display name on every presence record so
// the JS can render names without a follow-up REST call.
add_filter( 'openstation_shell_config', function ( $config ) {
    $names = array();
    foreach ( openstation_presence_get_all() as $uid => $_ ) {
        $u = get_userdata( (int) $uid );
        if ( $u ) {
            $names[ (string) $uid ] = $u->display_name;
        }
    }
    $config['whosOnlineNames'] = $names;
    return $config;
} );
```

```js
// whos-online.js
( function () {
    wp.os.ready( () => {
        const root = document.createElement( 'div' );
        root.id = 'whos-online-widget';
        root.style.cssText =
            'position:fixed;right:16px;bottom:16px;padding:12px;' +
            'background:rgba(0,0,0,0.6);color:#fff;border-radius:8px;' +
            'font:12px sans-serif;z-index:9999';
        document.body.appendChild( root );

        const names = wp.os.config?.whosOnlineNames ?? {};

        function render() {
            const map = wp.os.presence.getAll();
            const lines = [ '<strong>Who\'s online</strong>' ];
            for ( const [ userId, entry ] of map ) {
                if ( entry.status === 'offline' ) continue;
                const dot = entry.status === 'online' ? '🟢' : '🟡';
                const name = names[ userId ] || `User #${ userId }`;
                lines.push( `${ dot } ${ name }` );
            }
            root.innerHTML = lines.join( '<br>' );
        }

        // Initial paint + every heartbeat tick that lands a snapshot.
        render();
        wp.os.presence.subscribe( render );

        // Per-transition CustomEvent when you want one-shot reactions
        // (toast on come-online, sound on go-offline, …).
        document.addEventListener( 'os-presence-changed', ( e ) => {
            const { userId, oldStatus, newStatus } = e.detail;
            if ( oldStatus !== 'online' && newStatus === 'online' ) {
                console.log( names[ userId ], 'came online' );
            }
        } );
    } );
} )();
```

## API summary

```js
// Synchronous read for one user.
wp.os.presence.getStatus( userId );    // 'online' | 'inactive' | 'offline'

// Full snapshot — clone, safe to iterate.
wp.os.presence.getAll();                // Map<number, { status, lastSeenMs, lastActiveMs }>

// One user's full record or null.
wp.os.presence.getEntry( userId );

// React to changes — fires every tick that lands a snapshot.
const off = wp.os.presence.subscribe( ( state ) => { … } );

// Transition-only events.
document.addEventListener( 'os-presence-changed', ( e ) => {
    e.detail; // { userId, oldStatus, newStatus, lastSeenMs, lastActiveMs }
} );

// Force the next heartbeat tick to flag the current user as active
// (e.g. after a modal-driven interaction the input listeners can't see).
wp.os.presence.markActive();
```

## State machine

| Status     | Meaning |
|---|---|
| `online`   | Heartbeat tick within the offline threshold AND user input within the inactive threshold. |
| `inactive` | Heartbeat tick present, but no input within the inactive threshold (default 5 min). |
| `offline`  | No heartbeat in the offline threshold (default 2 min). |

## Server-side hooks

```php
// Read.
openstation_presence_status_for_user( $user_id );    // 'online' | 'inactive' | 'offline'
openstation_presence_get_all();                       // raw map
openstation_presence_snapshot();                      // computed snapshot
openstation_presence_snapshot( array( $user_id ) );   // narrowed

// Write — usually you don't, the heartbeat does it for you.
openstation_presence_record( $user_id, $active = true );

// Tune thresholds (seconds).
add_filter( 'openstation_presence_inactive_after', fn () => 600 );  // 10 min
add_filter( 'openstation_presence_offline_after',  fn () => 300 );  // 5 min

// Per-user veto.
add_filter( 'openstation_presence_can_track', function ( $can, $user_id ) {
    if ( get_user_meta( $user_id, 'invisible_mode', true ) ) {
        return false;
    }
    return $can;
}, 10, 2 );

// Privacy gate — narrow the visible-users set per viewer.
add_filter( 'openstation_presence_visible_users', function ( $ids, $viewer_id ) {
    if ( ! user_can( $viewer_id, 'manage_options' ) ) {
        // Non-admins only see other non-admins.
        return array_filter( $ids, fn ( $uid ) => ! user_can( $uid, 'manage_options' ) );
    }
    return $ids;
}, 10, 2 );

// React to transitions.
add_action( 'openstation_presence_changed', function ( $user_id, $new, $old ) {
    error_log( "User {$user_id} went from {$old} to {$new}" );
}, 10, 3 );

// Per-tick fan-out (every Heartbeat — be cheap here).
add_action( 'openstation_presence_recorded', function ( $user_id, $record ) {
    // …
}, 10, 2 );
```

## REST

```http
GET  /wp-json/desktop-mode/v1/presence
POST /wp-json/desktop-mode/v1/presence    body: { active: true }
                                         body: { active: false }
                                         body: { inactive: true }   // "set yourself away"
```

## Related

- [`docs/javascript-reference.md#presence`](../javascript-reference.md#presence--stable) — full JS API surface.
- [`docs/javascript-reference.md#os-presence-changed`](../javascript-reference.md#os-presence-changed--stable) — transition CustomEvent.
- [`docs/hooks-reference.md`](../hooks-reference.md) — full PHP filter / action signatures.
