# Gate OpenStation by role

Block OpenStation for contributors; force-disable for a specific user id.

```php
<?php
/**
 * Plugin Name: OpenStation Policy
 */
defined( 'ABSPATH' ) || exit;

add_filter( 'openstation_mode_enabled', function ( $enabled, $user_id ) {
    // Contributors stay in classic admin.
    if ( user_can( $user_id, 'contributor' ) ) {
        return false;
    }

    // A specific user: hard-off regardless of their preference.
    if ( 7 === (int) $user_id ) {
        return false;
    }

    return $enabled;
}, 10, 2 );
```

Returning `false` has two effects:

1. The **AJAX save** endpoint refuses to flip the user meta to `'1'` (it returns `openstation_disabled`).
2. Any existing `'1'` value is ignored — `openstation_is_enabled()` returns `false` for this user, which propagates to every render-time gate that consults the helper (chromeless detection, payload generation, the admin-bar toggle's "active" state, the recycle-bin REST permission callback, the PWA service-worker hookup, presence tracking).

## Disable the portal auto-enable too

If you always want OpenStation off for a user, also stop the portal from flipping it back on when they happen to visit `/openstation/`:

```php
add_filter( 'openstation_portal_auto_enable', function ( $auto, $user_id ) {
    if ( 7 === (int) $user_id ) {
        return false;
    }
    return $auto;
}, 10, 2 );
```

## Related

- [Hooks Reference — `openstation_mode_enabled`](../hooks-reference.md#openstation_mode_enabled--stable)
- [Hooks Reference — `openstation_portal_auto_enable`](../hooks-reference.md#openstation_portal_auto_enable--stable)
