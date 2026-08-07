# Related entities — extend the title bar's "Related" menu

Any window whose content identity carries **related-entity items** shows a "Related" button in its title bar (network icon, right side). The dropdown lists ready-to-open navigation targets — for posts and pages the plugin builds Comments (`edit-comments.php?p={id}`, with count), one item per assigned term (`term.php?taxonomy=…&tag_ID=…`), one item per associated media (`upload.php?item={id}`), and one **Linked posts** item per internal hyperlink resolving to another post on this site, automatically. Picking an item opens it as its own desktop window. Inside the block editor the list refreshes after every save (the bridge refetches a server-recomputed identity over REST) — no reload needed.

Both ends are open: a **PHP filter** adds items for any screen (runs server-side in real admin context, right after the content identity resolves), and a **JS filter** rewrites the resolved list per window.

## PHP — related items for a custom post type / custom screen

Built-ins cover `post` and `page` only. A CPT (or any screen that announces an identity — see [`window-links.md`](./window-links.md)) contributes its own:

```php
add_filter( 'openstation_window_related_entities', function ( $related, $identity, $screen ) {
	if ( 'acme_order' !== $identity['type'] ) {
		return $related;
	}
	$order_id = (int) $identity['id'];

	// Jump to the order's customer profile.
	$related[] = array(
		'id'         => 'acme/customer-' . acme_order_customer_id( $order_id ),
		'group'      => 'acme/customers',                       // your own menu section
		'groupLabel' => __( 'Customer', 'acme' ),               // section header
		'label'      => acme_order_customer_name( $order_id ),
		'icon'       => 'dashicons-businessperson',
		'url'        => admin_url( 'admin.php?page=acme-customer&c=' . acme_order_customer_id( $order_id ) ),
	);

	// Jump to the order's invoices, with a count suffix.
	$related[] = array(
		'id'         => 'acme/invoices',
		'group'      => 'acme/invoices',
		'groupLabel' => __( 'Billing', 'acme' ),
		'label'      => __( 'Invoices', 'acme' ),
		'icon'       => 'dashicons-media-spreadsheet',
		'url'        => admin_url( 'admin.php?page=acme-invoices&order=' . $order_id ),
		'count'      => acme_order_invoice_count( $order_id ),  // renders "Invoices (3)"
	);

	return $related;
}, 10, 3 );
```

`id`, `group`, `label`, and `url` are required (non-empty strings); malformed entries are dropped server-side, unknown fields stripped. The filter runs **only when an identity resolved** and **after** the `openstation_window_content_identity` filter — so an identity you inject for your own screen gets the related pass too. Removing built-ins works the same way: filter `$related` down.

## JS — rewrite the list per window

The resolved list runs through `os.related-entities.items` on every visibility check and menu build. Context carries the window id and its current `WindowContentRef`:

```javascript
wp.hooks.addFilter(
	'os.related-entities.items',
	'my-plugin/hide-media-group',
	( items, { windowId, content } ) => {
		// Drop the Media section everywhere…
		items = items.filter( ( item ) => item.group !== 'media' );

		// …and add a client-side target for posts.
		if ( content?.type === 'post' ) {
			items.push( {
				id: 'my-plugin/preview',
				group: 'my-plugin/tools',
				groupLabel: 'Tools',
				label: 'Live preview',
				icon: 'dashicons-visibility',
				url: `${ window.openStationConfig.adminUrl }admin.php?page=my-preview&post=${ content.id }`,
			} );
		}
		return items;
	},
);
```

Return an empty array to hide the button for a window entirely. Malformed entries are dropped item-wise; a non-array return falls back to the identity's own list.

## Reading the current list

```javascript
const ref = wp.os.relations.get( windowId );
console.log( ref?.related ); // → RelatedEntityItem[] | undefined
```

The button repaints automatically whenever the window's content identity changes (`os.window-links.content-changed`), including in-window navigations — no manual refresh needed.

**Group ordering** in the menu: `comments`, then every `terms/{taxonomy}`, then `media`, then `links`, then vendor groups in arrival order. Reference: [hooks-reference](../hooks-reference.md#openstation_window_related_entities--experimental) · [javascript-reference](../javascript-reference.md).
