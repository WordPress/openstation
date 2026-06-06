# Example: native Posts window

A `<wpd-table>`-driven replacement for the chromeless `edit.php` iframe. Server-paginated, sortable, filterable, multi-select bulk-trash, sub-row excerpt + featured image. **Opt-IN Beta as of 0.10.0** (was opt-out in 0.8.0–0.9.0) — fresh installs use the classic iframe; users turn it on via **OS Settings → Features → Beta features → Use the native Posts window**. The dock tile stays where it is; only the destination changes.

> Status: **Experimental** since 0.8.0. Hook names are stable; the JS column-filter shape may grow.

## How the swap works

The dock tile that points at `edit.php` is unchanged. Every code path that opens an admin URL (dock click, portal deep-link, `<a href="/wp-admin/edit.php">` anywhere in the shell) consults a central registry — [`src/native-url-remap.ts`](../../src/native-url-remap.ts) — before falling back to the iframe.

```
User clicks the Posts dock tile
       │
       ▼
Dock.openPage(item)
       │
       ▼
tryNativeUrlRemap(item.url) ── matches "edit.php" ─┐
       │                                          │
       ▼                                          ▼
   no match                               nativePostsEnabled?
       │                                          │
       ▼                                          ▼
iframe edit.php                              openById('desktop-mode-posts')
```

Future native windows (Pages, Media, Users) register themselves with one line — they don't need to touch the Dock or any dispatcher.

## Register your own URL → native-window remap

```js
const unsub = wp.desktop.registerNativeUrlRemap( {
    id: 'myplugin-pages',
    nativeWindowId: 'myplugin-pages',
    matches: ( _url, parsed ) =>
        parsed.pathname.endsWith( '/edit.php' ) &&
        parsed.searchParams.get( 'post_type' ) === 'page',
    enabled: ( settings ) => settings.nativePagesEnabled === true,
} );
```

Returning `false` from `enabled` (or returning `false` from `matches`) lets the click fall through to the iframe path. Returning a `nativeWindowId` that isn't registered for the current user (cap-gated, opt-in-gated) also falls through — `openById()` reports `false` and the registry walks on.

> The `wp.desktop.registerNativeUrlRemap` public API will be exposed in 0.9.0; today, this same primitive is consumed internally by the bundled Posts window.

## Filter the column descriptors

```js
wp.hooks.addFilter(
    'desktop_mode.postsWindow.columns',
    'myplugin/word-count-column',
    ( cols ) => [
        ...cols,
        {
            key: 'wordCount',
            label: 'Words',
            sortable: false,
            width: '100px',
            align: 'end',
            render: ( _v, row ) => {
                const text = ( row.excerpt?.rendered ?? '' ).replace( /<[^>]+>/g, '' );
                return text.trim() ? text.split( /\s+/ ).length.toString() : '—';
            },
        },
    ],
);
```

The columns render inside `<wpd-table>`'s shadow DOM — outer stylesheets do not reach the cells. Inline styles on the returned element are the working contract.

## End-to-end: add a Comments column

Walks all three legs of the extensibility surface — server-side data, REST projection, JS column. The default `/wp/v2/posts` response doesn't expose a comments count, so we expose one ourselves with `register_rest_field`, ask the bundle to fetch it via the existing query-args filter, and render it via the columns filter.

**1. Server: expose the comment count on `/wp/v2/posts`.**

```php
add_action( 'rest_api_init', function () {
    register_rest_field( 'post', 'desktop_mode_comment_count', array(
        'get_callback'    => static function ( $post ) {
            return (int) get_post_field( 'comment_count', $post['id'] );
        },
        'schema'          => array(
            'type'        => 'integer',
            'description' => 'Approved + pending comment count for the post.',
            'context'     => array( 'view', 'edit' ),
            'readonly'    => true,
        ),
    ) );
} );
```

**2. Server: ask the bundle to fetch the new field.**

The Posts window sends a tight `_fields` projection on every request to keep the payload small. Append our field so it lands in the response:

```php
add_filter( 'desktop_mode_posts_window_query_args', function ( $args ) {
    $args['_fields'] .= ',desktop_mode_comment_count';
    return $args;
} );
```

**3. Client: render the column.**

```js
wp.hooks.addFilter(
    'desktop_mode.postsWindow.columns',
    'myplugin/comments-column',
    ( cols ) => [
        ...cols,
        {
            key: 'desktop_mode_comment_count',
            label: 'Comments',
            sortable: true,                         // server orderby=comment_count
            width: '110px',
            align: 'end',
            render: ( _v, row ) => {
                const span = document.createElement( 'span' );
                const n = row.desktop_mode_comment_count ?? 0;
                span.textContent = String( n );
                if ( n > 0 ) {
                    span.style.fontWeight = '600';
                }
                return span;
            },
        },
    ],
);
```

That's it. The column appears in every Posts window load, sorts via the server (`orderby=comment_count` is supported by core), and never makes a second round-trip per row.

## Add a bulk action

The default bulk action is "Move to trash". Plugins extend the registry via the `desktop_mode.postsWindow.bulkActions` filter — every entry shows up in the bulk bar when one or more rows are selected. The `run()` callback receives the selected row ids and a `PostsWindowContext` (`{ body, table, refresh, getSelectedIds, getSelectedRows, getCurrentParams }`):

```js
wp.hooks.addFilter(
    'desktop_mode.postsWindow.bulkActions',
    'myplugin/bulk-duplicate',
    ( actions ) => [
        ...actions,
        {
            id: 'duplicate',
            label: 'Duplicate',
            icon: 'dashicons-admin-page',
            variant: 'secondary',
            confirm: 'Duplicate %d post(s)?',
            run: async ( ids ) => {
                await fetch( '/wp-json/myplugin/v1/duplicate', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-WP-Nonce': wpApiSettings.nonce,
                    },
                    body: JSON.stringify( { ids } ),
                } );
                // Returning anything other than `false` triggers the
                // window's auto-clear-selection + auto-refresh after
                // the action resolves.
            },
        },
    ],
);
```

`confirm` is interpolated with the row count via `%d`. Returning `false` from `run()` opts out of the auto-refresh — useful when the action navigates away or shows its own modal.

To remove the default trash action (read-only views, audit-style mirrors), filter it out by id:

```js
wp.hooks.addFilter(
    'desktop_mode.postsWindow.bulkActions',
    'myplugin/no-trash',
    ( actions ) => actions.filter( ( a ) => a.id !== 'trash' ),
);
```

## Add a status segment

The segmented control above the table is built from the (filterable) status list. CPTs that register custom statuses can surface them here:

```js
wp.hooks.addFilter(
    'desktop_mode.postsWindow.statusSegments',
    'myplugin/awaiting-review',
    ( segs ) => [
        ...segs,
        { value: 'awaiting-review', label: 'Awaiting review' },
    ],
);
```

The `value` is sent verbatim as the REST `?status=…` param. Use `''` (empty string) for the "All" sentinel — the bundle remaps that to `?status=any` so the user sees every status they can edit.

## Add a button to the toolbar

The trailing slot sits before the built-in **Refresh** + **Add New** buttons:

```js
wp.hooks.addFilter(
    'desktop_mode.postsWindow.toolbarTrailing',
    'myplugin/export-button',
    ( elements, ctx ) => {
        const btn = document.createElement( 'wpd-button' );
        btn.setAttribute( 'variant', 'ghost' );
        btn.textContent = 'Export CSV';
        btn.addEventListener( 'click', () => {
            const params = ctx.getCurrentParams();
            window.open( `/wp-json/myplugin/v1/posts/export?status=${ params.status ?? 'any' }` );
        } );
        return [ ...elements, btn ];
    },
);
```

The filter receives a fresh array on every window open (and an empty default), plus the live `PostsWindowContext` so the button can refresh, read the selection, or read the current view params at click time.

## React to lifecycle events

Two actions on the hook bus, both with matching CustomEvents on `document`:

```js
// Fired AFTER the first paint with a populated table.
wp.hooks.addAction(
    'desktop_mode.postsWindow.opened',
    'myplugin/track-open',
    ( ctx ) => {
        analytics.track( 'posts-window-opened', {
            count: ctx.table.data?.length ?? 0,
        } );
    },
);

// Fired after every successful refresh (initial + every search /
// sort / pagination change).
wp.hooks.addAction(
    'desktop_mode.postsWindow.dataLoaded',
    'myplugin/track-page',
    ( payload ) => {
        analytics.track( 'posts-window-page', {
            page: payload.page,
            total: payload.total,
        } );
    },
);

// CustomEvent equivalents — same payloads.
document.addEventListener( 'desktop-mode-posts-window-opened', ( e ) => { /* … */ } );
document.addEventListener( 'desktop-mode-posts-window-data-loaded', ( e ) => { /* … */ } );
```

The `opened` action's `ctx` is the same `PostsWindowContext` passed to bulk-action runners — read the table, fire `ctx.refresh()`, etc.

## Restrict who sees the window

```php
add_filter( 'desktop_mode_posts_window_user_can_use', function ( $can, $user_id ) {
    return $can && user_can( $user_id, 'edit_others_posts' );
}, 10, 2 );
```

The default gate is `edit_posts` AND the user has flipped the toggle on. Returning `false` here forces the classic chromeless `edit.php` iframe to remain the destination.

## Point the window at a CPT

```php
add_filter( 'desktop_mode_posts_window_query_args', function ( $args ) {
    $args['post_type'] = 'product';
    return $args;
} );
```

The bundle threads `post_type` straight through to `/wp/v2/posts` (or, if your CPT registers its own REST base, swap `postsUrl` via `desktop_mode_posts_window_args`). v1 ships with `post`; v1.1 will add a CPT picker in the toolbar.

## Add a custom REST query param

```php
add_filter( 'desktop_mode_posts_window_query_args', function ( $args ) {
    $args['meta_key']   = 'featured';
    $args['meta_value'] = '1';
    return $args;
} );
```

Anything `/wp/v2/posts` accepts is fair game — `meta_*`, `categories_exclude`, `sticky`, etc.

## React to a bulk trash

The window broadcasts `desktop-mode.post.changed` after every bulk trash. Subscribe to keep your own UI in sync without re-fetching:

```js
const unsub = wp.desktop.subscribe( 'desktop-mode.post.changed', ( payload ) => {
    if ( payload.source !== 'posts-window' ) {
        return;
    }
    console.log( 'posts trashed:', payload.ids );
} );
```

The recycle bin window is already a subscriber — that's how trashing 12 posts here makes the bin tile's badge tick up to 12 without a refresh.

## Hooks reference (Experimental, 0.8.0)

PHP:
- `desktop_mode_posts_window_user_can_use( $can, $user_id )` — gate. Default: `edit_posts` AND the user has turned the opt-in toggle on.
- `desktop_mode_posts_window_args( $args )` — args passed to `desktop_mode_register_window()` (title, icon, dimensions, config blob).
- `desktop_mode_posts_window_template_html( $html )` — the rendered template HTML before `wp_kses`.
- `desktop_mode_posts_window_query_args( $args )` — outbound REST query params (`_fields`, `_embed`, `post_type`).

JavaScript:
- `desktop_mode.postsWindow.columns` (filter) — column descriptors before `table.columns =` is set.

CustomEvents / broadcasts:
- `desktop-mode.post.changed` — broadcast on bulk trash; `{ source: 'posts-window', action: 'trashed', ids }`.
