# Gate desktop mode by role

Block desktop mode for contributors; force-disable for a specific user id.

```php
<?php
/**
 * Plugin Name: Desktop Mode Policy
 */
defined( 'ABSPATH' ) || exit;

add_filter( 'desktop_mode_mode_enabled', function ( $enabled, $user_id ) {
    // Contributors stay in classic admin.
    if ( user_can( $user_id, 'contributor' ) && ! user_can( $user_id, 'edit_posts' ) ) {
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

1. The **AJAX save** endpoint refuses to flip the user meta to `'1'` (it returns `desktop_mode_disabled`).
2. Any existing `'1'` value is ignored — `desktop_mode_is_enabled()` returns `false` for this user.

## Disable the portal auto-enable too

If you always want desktop mode off for a user, also stop the portal from flipping it back on when they happen to visit `/wp-desktop/`:

```php
add_filter( 'desktop_mode_portal_auto_enable', function ( $auto, $user_id ) {
    if ( 7 === (int) $user_id ) {
        return false;
    }
    return $auto;
}, 10, 2 );
```

## Related

- [Hooks Reference — `desktop_mode_mode_enabled`](../hooks-reference.md#desktop_mode_mode_enabled--stable)
- [Hooks Reference — `desktop_mode_portal_auto_enable`](../hooks-reference.md#desktop_mode_portal_auto_enable--stable)
