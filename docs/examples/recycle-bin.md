# Example: extend the Recycle Bin

The Recycle Bin window (id `desktop-mode-recycle-bin`) catches deleted attachments into the WordPress trash and lists every trashed post / page / media item with restore + permanent-delete actions. It's filterable end-to-end so plugins can add post types, columns, audit logging, or custom capability gates.

> Status: **Experimental** since 0.19.0. Hook names are stable; the JS column-filter shape may grow.

## Add a custom post type to the bin

```php
add_filter( 'desktop_mode_recycle_bin_capture_post_types', function ( $types ) {
    $types[] = 'product';
    return $types;
} );
```

That's it — products that go through `wp_trash_post()` will now show up alongside posts/pages/media. The bin uses the same `delete_post` capability gate WP applies to untrash, so per-CPT cap maps just work.

## Audit-log every restore

```php
add_action( 'desktop_mode_recycle_bin_after_restore', function ( $post_id ) {
    $user = wp_get_current_user();
    error_log( sprintf(
        '[recycle-bin] %s restored #%d',
        $user->user_login,
        $post_id
    ) );
} );
```

The matching `..._after_purge` action gives you the post type as the second arg, so you can keep separate counters for media vs. content.

## Restrict who can use the bin

By default the bin shows up for anyone with `edit_posts`. Lock it down to administrators:

```php
add_filter( 'desktop_mode_recycle_bin_user_can_use', function () {
    return current_user_can( 'manage_options' );
} );
```

The window + icon registrations are skipped entirely when the gate returns false — there's no hidden UI footprint.

## Bypass the bin for a specific deletion

When a plugin needs to permanently delete an attachment without the round-trip through trash:

```php
$result = apply_filters( 'desktop_mode_recycle_bin_should_capture', false, $post );
// or, more idiomatically, force-delete:
wp_delete_attachment( $attachment_id, true );
```

`wp_delete_attachment( $id, true )` with the force flag skips capture automatically — the filter is the per-call escape hatch when you can't pass `force_delete = true`.

## Add a custom column to the table

The JS layer applies a filter to the column descriptor before assignment:

```js
wp.hooks.addFilter(
    'desktop_mode.recycleBin.columns',
    'myplugin/owner-column',
    ( cols ) => [
        ...cols,
        {
            key: 'deleted_by_id',
            label: 'Owner',
            sortable: true,
            render: ( _v, row ) => row.deleted_by_id
                ? `User #${ row.deleted_by_id }`
                : '—',
        },
    ],
);
```

To populate a brand-new field on the row, mirror it on the PHP side via `desktop_mode_recycle_bin_item`:

```php
add_filter( 'desktop_mode_recycle_bin_item', function ( $item, $post ) {
    $item[ 'department' ] = (string) get_post_meta( $post->ID, '_dept', true );
    return $item;
}, 10, 2 );
```

The `type_label` field on every row carries a human-readable label for the entity kind (`Post`, `Page`, `Media`, `Comment`, or the CPT's singular label). The bin renders it as a small inline badge next to the title; column-filter authors can also reuse it for their own cells. Override it from the same filter if your CPT needs a custom label:

```php
add_filter( 'desktop_mode_recycle_bin_item', function ( $item, $post ) {
    if ( 'product' === $post->post_type ) {
        $item[ 'type_label' ] = __( 'Catalog item', 'myplugin' );
    }
    return $item;
}, 10, 2 );
```

## Push your own real-time channel

If you run a websocket or SSE service alongside WordPress, hook the unified signal so you don't have to subscribe to every delete action individually:

```php
add_action( 'desktop_mode_recycle_bin_signal', function ( $ts_ms ) {
    My_Realtime::publish( 'recycle-bin-changed', [ 'ts' => $ts_ms ] );
} );
```

The action fires once per request that triggered a delete (coalesced across multiple bulk-trash hooks in the same request).

## React to bulk operations across windows

The Media Library (or any other window) can re-fetch when items leave/return the trash:

```js
document.addEventListener( 'desktop-mode-recycle-bin-changed', ( e ) => {
    const { kind, ok, errors, source } = e.detail;
    // `source` is 'local' | 'chromeless' | 'heartbeat'.
    if ( kind === 'restore' && ok > 0 ) {
        myPlugin.refreshMedia();
    }
} );
```

Or via the hook bus:

```js
wp.hooks.addAction(
    'desktop_mode.recycleBin.changed',
    'myplugin/refresh-media',
    ( payload ) => myPlugin.refreshMedia( payload ),
);
```

## See also

- [Hooks reference — Recycle Bin](../hooks-reference.md#recycle-bin) — every filter and action with full signatures.
- [Data table example](./data-table.md) — the `<wpd-table>` primitive the bin renders.
- [Native windows](./native-windows.md) — the `desktop_mode_register_window()` API the bin builds on.
