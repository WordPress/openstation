# Content changes — live-refresh every window listing your type

The framework ships a generic content-change realtime
layer: any create / update / trash of a post, page, `show_ui` CPT,
comment, or WooCommerce order is broadcast to every window as
`os.<type>.changed`, and windows listing that type refresh
themselves — iframe list pages via the built-in soft reload, native
windows via their own subscriptions. This recipe shows what (little)
a third-party plugin needs to do to join in, on both sides.

## You probably need to do nothing

If your content is a registered post type with `show_ui => true` and
your list screen is the standard `edit.php?post_type=<type>`, the
framework already covers you end to end: saves are recorded by the
`wp_after_insert_post` publisher, and the soft-reload matcher derives
your list page's type from its URL. Open two windows, save in one,
watch the other repaint.

## Publisher — content that is NOT a post

A plugin with its own storage (custom table, settings blob) records
mutations explicitly. One call per mutation:

```php
/**
 * After my plugin writes a row.
 */
function myplugin_after_save_item( $item_id, $is_new ) {
	if ( function_exists( 'openstation_content_changes_record' ) ) {
		openstation_content_changes_record(
			'myplugin_item',                    // becomes os.myplugin_item.changed
			$item_id,
			$is_new ? 'created' : 'updated'     // or trashed / untrashed / deleted
		);
	}
}
```

That single call feeds every delivery path: the instant
chromeless-footer broadcast (survives the form-POST → redirect via a
per-user buffer) and the Heartbeat catch-all (other tabs, other
users, REST/WP-CLI, ≤ one tick).

## Consumer — a list screen on a custom admin URL

The generic soft-reload matcher only understands `edit.php` /
`upload.php` / `edit-comments.php`. If your list lives at
`admin.php?page=myplugin-items`, declare it:

```php
add_filter( 'openstation_soft_reload_rules', function ( $rules ) {
	$rules[] = array(
		'topic'       => 'os.myplugin_item.changed',
		'path'        => 'admin.php',
		'query'       => array( 'page' => 'myplugin-items' ),
		// Keep the single-item editor out — a background body swap
		// would destroy unsaved form state.
		'queryAbsent' => array( 'action' ),
	);
	return $rules;
} );
```

Now any `os.myplugin_item.changed` broadcast makes an open
`admin.php?page=myplugin-items` iframe refetch its own URL and swap
`#wpbody-content` in place — no spinner, no scroll jump. Re-bind any
custom JS after the swap by listening for `os-soft-reloaded`
on the iframe's `document`.

(This is exactly how the built-in WooCommerce HPOS orders rule works:
`admin.php?page=wc-orders` reacts to `os.shop_order.changed`,
with `queryAbsent: [ 'action' ]` protecting the order editor.)

## Consumer — a native window

Subscribe on the broadcast bus and refetch. Skip your own emissions
by `source` if your window also publishes:

```js
const unsubscribe = wp.os.subscribe(
	'os.myplugin_item.changed',
	( { source, action, ids } ) => {
		if ( source === 'myplugin-window' ) {
			return; // our own mutation already refreshed the table
		}
		void refreshTable();
	}
);
// Call unsubscribe() in your window-closed teardown.
```

Payload contract: `{ source, action, ids }` — `source` is `'admin'`
(server-recorded), `'editor'` (block-editor save), `'heartbeat'`
(catch-all — MAY repeat a change a faster path already delivered, so
refreshes must be idempotent), or a client emitter's own id.

## Suppressing / observing

```php
// Keep a high-churn internal type out of the realtime system.
add_filter( 'openstation_content_changes_should_record', function ( $record, $type ) {
	return 'myplugin_log_entry' === $type ? false : $record;
}, 10, 2 );

// Mirror every recorded change into your own realtime channel (SSE, websocket).
add_action( 'openstation_content_change_recorded', function ( $type, $id, $action ) {
	myplugin_sse_push( compact( 'type', 'id', 'action' ) );
}, 10, 3 );
```

Full surface: [hooks-reference.md → Content-change realtime layer](../hooks-reference.md#content-change-realtime-layer).
