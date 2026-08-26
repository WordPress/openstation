# Add an action that works on a whole selection

Every tile canvas in OpenStation is multi-select: the wallpaper, folder windows, and each list inside WP Explorer. A menu entry you add through `os.files.tile-menu` or `os.my-wordpress.tile-context-menu` keeps working exactly as before — and appears only when **one** item is selected — until you tell the framework it is safe for a set.

This recipe adds an "Archive" action that appears for a single tile *and* for a selection of many, and that hits the server once for the whole set rather than once per item.

## The whole thing

```php
<?php
/**
 * Plugin Name: Archive Action
 */
defined( 'ABSPATH' ) || exit;

add_action( 'admin_enqueue_scripts', function () {
    if ( ! function_exists( 'openstation_is_enabled' ) || ! openstation_is_enabled() ) {
        return;
    }
    wp_enqueue_script(
        'my-archive-action',
        plugin_dir_url( __FILE__ ) . 'archive-action.js',
        array( 'wp-hooks' ),
        '1.0.0',
        true
    );
} );
```

```js
// archive-action.js
( function () {
    async function archive( placements ) {
        const ids = placements.map( ( p ) => p.id );
        // One request for the set. Always route HTTP through
        // wp.os.fetch so the window's spinner and the activity bus
        // see it.
        await window.wp.os.fetch(
            '/wp-json/my-plugin/v1/archive',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify( { ids } ),
            },
            { source: 'my-plugin/archive' }
        );
        window.wp.os.showToast( {
            message:
                ids.length === 1
                    ? 'Archived.'
                    : `${ ids.length } items archived.`,
        } );
    }

    window.wp.hooks.addFilter(
        'os.files.tile-menu',
        'my-plugin/archive',
        function ( items, placement ) {
            // Only archive real user files.
            if ( placement.file.type === 'shortcut' ) {
                return items;
            }
            items.push( {
                id: 'my-plugin/archive',
                label: 'Archive',
                icon: 'dashicons-archive',
                sort: 50,

                // Opt in. Without this the entry is single-item only.
                multi: true,

                // What the entry says about a set.
                bulkLabel: ( n ) => `Archive ${ n } items`,

                // ONE call for the whole selection.
                bulk: ( placements ) => archive( placements ),

                // The single-item handler. Still required — it is what
                // runs when exactly one tile is selected.
                onClick: () => archive( [ placement ] ),
            } );
            return items;
        }
    );
} )();
```

## What the framework does with that

When the user right-clicks with several tiles selected, the shell asks *every* selected placement for its actions and keeps the ids that all of them offer **and** that all of them mark `multi: true`. Your entry survives a selection of five posts; it drops out the moment one of the five is a `shortcut`, because your own guard didn't offer it there. That is the point — the menu can only ever show you what is true for the whole set.

Then it runs `bulk( items )` once. Had you omitted `bulk`, the framework would have fanned out instead, calling each item's own `onClick` in turn — correct, but five requests and five toasts where one of each will do.

## Two things worth knowing

**`multiId` merges actions that are the same deed under different labels.** A folder tile offers `delete-folder` ("Move folder to Trash") and a file tile offers `remove` ("Move to Trash"). Selecting one of each is ordinary, and intersecting on the raw ids would leave that selection with nothing to do. Both declare `multiId: 'trash'` and merge into one entry. If your plugin adds a differently-labelled variant of an existing action, give it the same `multiId`.

Merging does **not** hand one runner the whole set. The framework groups the selection by `bulk` function identity and calls each runner once with the items whose own contributor declared it — so a folder is never pushed through a file's implementation just because the user happened to select it first. If you want your merged action to batch as a single call alongside a built-in, share the same function reference:

```js
// Shared once, at module scope — not a fresh arrow at each site,
// which is a different identity and therefore a second batch.
const archiveAll = ( placements ) => archive( placements );

// …then `bulk: archiveAll` everywhere the action is offered.
```

**Don't opt in what can't take it.** An action that opens a modal, prompts for a name, or navigates the window is about one thing. Left as-is it simply won't appear for a set, which is the honest outcome — better than twelve stacked dialogs.

## Acting on a set from outside the menu

`os.selection.actions` fires on the already-resolved list for a multi-selection (never for a single item), so you can add an entry that only makes sense for several things at once:

```js
window.wp.hooks.addFilter(
    'os.selection.actions',
    'my-plugin/compare',
    ( actions, { items, count } ) =>
        count === 2
            ? [
                ...actions,
                {
                    id: 'my-plugin/compare',
                    label: 'Compare these two',
                    icon: 'dashicons-columns',
                    onClick: () => openComparison( items ),
                },
            ]
            : actions
);
```

## Accepting a dropped selection

A drop target sees the same set the menu does. `data.placements` is
absent for a single-item drag, so fall back to the grabbed tile —
one code path for "one" and "many":

```js
const placementsOf = ( data ) => data.placements ?? [ data.placement ];

wp.os.dragManager.registerDropTarget( {
    id: 'my-plugin/zone',
    element: myZone,
    // Every member has to be acceptable. Taking a set and handling
    // part of it tells the user the whole drop worked.
    accept: ( payload ) =>
        payload.type === 'desktop-file' &&
        placementsOf( payload.data ).every( ( p ) => p.file.type === 'post' ),
    onDrop: ( session ) => {
        const placements = placementsOf( session.payload.data );
        // One request for the set, not one per item.
        void archiveAll( placements );
    },
} );
```

Targets that ignore `placements` entirely still work — they act on
`data.placement`, the tile the user actually grabbed.

## Reacting to selection

To react anywhere in the shell without owning a menu at all:

```js
document.addEventListener( 'os-selection-changed', ( e ) => {
    const { surface, keys, count } = e.detail;
    console.log( count, 'selected in', surface, keys );
} );
```

**See also:** [`wp.os.selection`](../javascript-reference.md#selection--experimental) for the full field table, and [files on the desktop](../files-on-desktop.md) for the FilesLayer handle's `getSelection()` / `onSelectionChanged()`.
