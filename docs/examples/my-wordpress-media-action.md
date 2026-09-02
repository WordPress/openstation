# Add an action button to a WP Explorer preview pane

**Status: Experimental**

The WP Explorer native window (Posts / Pages / Users / Media, and
every plugin-added section) exposes a uniform action surface: one
descriptor becomes a button in the right pane **and** an entry in the
tile context menu. Plugins declare the descriptor on the **PHP** side
(capability + MIME + script handle) and wire the JS handler via a
`wp.hooks` filter. This recipe walks through both halves.

The scenario: a "Compress this image" button that appears only on
image items in the Media section, hits a plugin-owned REST route,
and toasts on success.

## PHP — declare the descriptor

```php
add_filter( 'openstation_my_wordpress_preview_actions', function ( $actions ) {
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

// Register the JS bundle that wires the handler. OpenStation
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
  hidden on non-image rows, and a MIME-scoped action never leaks
  into a non-media section.
- `sections` scopes the button. Omit it to show the button on every
  section, or pass an array to opt in: entries match a section's
  **id** (`'media'`, `'posts'`), a section's **post type slug**
  (`'atf-form'` — handy because an auto-registered CPT section's id
  is `cpt-<post_type>`), or `'*'`.
- `script` is auto-enqueued for users who can see the action.
- The same descriptor also appears in the tile's right-click menu,
  between the navigation entries and the destructive ones.
- Timing is forgiving: descriptors are collected when the window
  config is emitted, so registering the filter on `init`,
  `admin_init`, or plain plugin bootstrap all work.

## JS — wire the click handler

`actions.js` (or a TS source you compile to it):

```js
( function () {
    if ( ! window.wp || ! window.wp.hooks || ! window.wp.os ) {
        return;
    }
    wp.hooks.addFilter(
        'os.my-wordpress.preview-actions',
        'my-plugin/compress',
        function ( actions, ctx ) {
            return actions.map( function ( a ) {
                if ( a.id !== 'my-plugin/compress-image' ) {
                    return a;
                }
                return Object.assign( {}, a, {
                    onSelect: async function ( c ) {
                        const id = c.item.id;
                        const response = await wp.os.fetch(
                            '/wp-json/my-plugin/v1/compress/' + id,
                            { method: 'POST' },
                            { source: 'my-plugin/compress' },
                        );
                        if ( response.ok ) {
                            wp.os.notify( {
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
    entityId: 'media',     // section id
    kind: 'media',         // render kind
    postType: 'attachment',// the section's post type slug, when declared
    mime: 'image/png',     // present on media items
    item: { /* the selected entity, as the server sent it */ },
    itemId: 42,            // Number( item.id ) when numeric
    surface: 'pane',       // or 'context-menu'
}
```

`item` is the detail record in the right pane and the list row in the
context menu — `item.id` is present on both, so deep-link from that.

## Deep-link from a custom section (non-media)

The same two halves give a CPT section a "open THIS entry in my app"
action. A forms plugin whose post type is `atf-form`:

```php
add_filter( 'openstation_my_wordpress_preview_actions', function ( $actions ) {
    $actions[] = array(
        'id'         => 'atf/open-builder',
        'label'      => __( 'Open in form builder', 'atf' ),
        'icon'       => 'dashicons-feedback',
        'capability' => 'edit_posts',
        'sections'   => array( 'atf-form' ), // post type slug — matches
                                             // the auto section cpt-atf-form
        'script'     => 'atf-explorer-actions',
    );
    return $actions;
} );
```

```js
wp.hooks.addFilter(
    'os.my-wordpress.preview-actions',
    'atf/open-builder',
    ( actions, ctx ) =>
        actions.map( ( a ) =>
            a.id === 'atf/open-builder'
                ? {
                    ...a,
                    onSelect: ( c ) =>
                        wp.os.openWindow( 'atf-builder', {
                            source: 'atf/explorer',
                            // c.item is THE selected form.
                        } ),
                }
                : a,
        ),
);
```

The button appears in the Forms section's pane and context menu, and
nowhere else — `sections` did the scoping, `ctx.item` carries the
form the user clicked on.

### Make it the section's editor

If the type has no classic-editor screen (a native window owns
editing), promote that action to be the section's editor via the
section descriptor's `editAction`:

```php
add_filter( 'openstation_my_wordpress_entities', function ( $entities ) {
    $entities[] = array(
        'id'         => 'atf-forms',
        'label'      => __( 'Forms', 'atf' ),
        'icon'       => 'dashicons-feedback',
        'restPath'   => 'wp/v2/atf-form',
        'post_type'  => 'atf-form',
        'editAction' => 'atf/open-builder', // this action IS the editor
    );
    return $entities;
} );
```

Now "Open in form builder" replaces "Open in editor" on the pane's
primary button, the context menu's open entry, and tile double-click
(a double-clicked form opens the builder, not a 404ing `post.php`).
Set `editAction => false` instead to remove editing entirely —
double-click then navigates into the entry's detail dossier.

## Inject HTML into the right pane

Sometimes a button isn't enough — you want to drop a custom info
panel into the metadata grid, or a footer with deeper links. Use
the slot action:

```js
wp.hooks.addAction(
    'os.my-wordpress.preview-extras',
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

Need a section beyond Posts / Pages / Users / Media? Register it
server-side with [`openstation_my_wordpress_app_sections`](../hooks-reference.md#openstation_my_wordpress_app_sections--experimental-filter)
— the explorer app renders it with the standard tile grid and preview
pane, and every JS seam on this page fires over it, so a plugin
decorates it exactly as it decorates the built-ins:

```php
add_filter( 'openstation_my_wordpress_app_sections', function ( $sections ) {
    $sections[] = array(
        'id'         => 'cpt-my-order',
        'label'      => __( 'Orders', 'my-plugin' ),
        'icon'       => 'dashicons-cart',
        'kind'       => 'post',
        'post_type'  => 'my_order',
        'capability' => 'edit_posts',
        'thumbnails' => false,
    );
    return $sections;
} );
```

(An eligible custom post type gets its section discovered
automatically — this filter is for the exotic cases: a hand-rolled
list, a section behind extra gating, a relabel.)

The legacy `registerEntityKind()` client renderer seam went with the
legacy window — see
[Migration — WP Explorer becomes the my-wordpress app](../migration-wp-explorer-app.md).
Custom *rendering* now happens through the seams above:
`os.my-wordpress.list-tile` and `os.tile.rendered` decorate tiles,
`preview-extras` owns the pane's plugin real estate, and
`list-bands` regroups the grid.
