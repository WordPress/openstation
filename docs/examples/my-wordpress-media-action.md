# Add an action button to a site folder preview pane

**Status: Experimental**

The site folder native window (Posts / Pages / Users / Media)
exposes a uniform right-pane action surface. Plugins declare a
descriptor on the **PHP** side (capability + MIME + script handle)
and wire the JS handler via a `wp.hooks` filter. This recipe walks
through both halves.

The scenario: a "Compress this image" button that appears only on
image items in the Media section, hits a plugin-owned REST route,
and toasts on success.

## PHP — declare the descriptor

```php
add_filter( 'desktop_mode_my_wordpress_preview_actions', function ( $actions ) {
    $actions[] = array(
        'id'         => 'my-plugin/compress-image',
        'label'      => __( 'Compress this image', 'my-plugin' ),
        'icon'       => 'dashicons-image-rotate',
        'capability' => 'upload_files',
        'mime'       => '^image/',           // PCRE — server pre-filters
        'sections'   => array( 'media' ),
        'script'     => 'my-plugin-actions', // wp_register_script handle
    );
    return $actions;
} );

// Register the JS bundle that wires the handler. Desktop Mode
// auto-enqueues the handle for users who can see the action.
add_action( 'init', function () {
    wp_register_script(
        'my-plugin-actions',
        plugins_url( 'actions.js', __FILE__ ),
        array( 'wp-hooks' ),
        '1.0.0',
        true
    );
} );
```

What you got for free:

- `capability` is enforced before the descriptor ships to the
  bundle, so the button never appears for users who can't run it.
- `mime` is re-evaluated client-side per item — the button stays
  hidden on non-image rows.
- `sections` scopes the button. Omit it to show the button on every
  section, or pass `array( 'media', 'posts' )` to opt in to more.
- `script` is auto-enqueued for users who can see the action.

## JS — wire the click handler

`actions.js` (or a TS source you compile to it):

```js
( function () {
    if ( ! window.wp || ! window.wp.hooks || ! window.wp.desktop ) {
        return;
    }
    wp.hooks.addFilter(
        'desktop-mode.my-wordpress.preview-actions',
        'my-plugin/compress',
        function ( actions, ctx ) {
            return actions.map( function ( a ) {
                if ( a.id !== 'my-plugin/compress-image' ) {
                    return a;
                }
                return Object.assign( {}, a, {
                    onSelect: async function ( c ) {
                        const id = c.item.id;
                        const response = await wp.desktop.fetch(
                            '/wp-json/my-plugin/v1/compress/' + id,
                            { method: 'POST' },
                            { source: 'my-plugin/compress' },
                        );
                        if ( response.ok ) {
                            wp.desktop.notify( {
                                title: 'Compressed!',
                                body: c.item.title.rendered,
                            } );
                        }
                    },
                } );
            } );
        },
    );
} )();
```

The handler's `ctx` argument:

```ts
{
    entityId: 'media',     // section slug
    kind: 'media',         // render kind
    mime: 'image/png',     // present on media items
    item: { /* full server record */ },
}
```

## Inject HTML into the right pane

Sometimes a button isn't enough — you want to drop a custom info
panel into the metadata grid, or a footer with deeper links. Use
the slot action:

```js
wp.hooks.addAction(
    'desktop-mode.my-wordpress.preview-extras',
    'my-plugin/cdn-status',
    function ( ctx ) {
        if ( ctx.slot !== 'meta' || ctx.kind !== 'media' ) {
            return;
        }
        const row = document.createElement( 'div' );
        row.textContent = 'CDN: cached at 3 edges';
        ctx.container.appendChild( row );
    },
);
```

The available slots are `'header'`, `'meta'`, and `'footer'`. Each
fires once per preview render with a `container` element for
that slot.

## Ship your own section type

Need a section beyond Posts / Pages / Users / Media? Register a
`kind` server-side **and** a renderer client-side:

```php
add_filter( 'desktop_mode_my_wordpress_entities', function ( $entities ) {
    $entities[] = array(
        'id'       => 'my-orders',
        'label'    => __( 'Orders', 'my-plugin' ),
        'icon'     => 'dashicons-cart',
        'restPath' => 'wp/v2/my-order',
        'kind'     => 'my-plugin/order',
    );
    return $entities;
} );
```

```js
wp.desktop.myWordpress.registerEntityKind(
    'my-plugin/order',
    function ( host, entity ) {
        host.body.replaceChildren();
        const h = document.createElement( 'h2' );
        h.textContent = entity.label;
        host.body.appendChild( h );
        // Fetch, render tiles, paint preview pane, call
        // host.navigate(...) on drill-in, host.addTeardown(...)
        // on every subscription.
    },
);
```

You can call `registerEntityKind` at script-load time — no timing
guard needed. The main desktop bundle installs an early-load stub
that buffers calls; when the lazy site-folder bundle mounts (on
first open of the window), it drains the queue.

The renderer receives the same `EntityRenderHost` the built-in
sections do — paint into `host.body`, route via `host.navigate`,
register cleanup via `host.addTeardown`.
