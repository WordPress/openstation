# Dock customization — three registries, one mental model

The dock is one of the most visible surfaces in the shell. It's also
one of the most extensible. Three customization registries layer
on top of each other, each carrying a different scope of "how much
of the dock you want to own":

| Layer | Owns… | Use it when… |
|---|---|---|
| [**Decoration hooks**](./examples/dock-decoration-hooks.md) | A few classNames, a wrapper, a tooltip, an after-render decoration. | You want to nudge the visual without owning the rail. Cheap, composable across plugins. |
| [**Submenu renderer**](./examples/submenu-renderer.md) | The popover that opens when the user right-clicks a dock tile. | You want a beautiful submenu — a radial menu, hovering cards, a centered command-K-style overlay. |
| [**Dock rail renderer**](./examples/dock-rail-renderer.md) | The entire rail. Layout, animation, click-handling, lifecycle. | You want a circular ring, Stage-Manager stack, floating cluster, or anything that doesn't fit a row of tiles. |

All three are **Stable** since 0.18.0. Pick the smallest layer that
solves your problem.

---

## How they compose

The three registries are deliberately orthogonal — a plugin author
can use any one without the others, and combinations work cleanly.

**Decoration hooks fire from inside the *default* rail renderer.**
Custom rail renderers SHOULD fire equivalent hooks at equivalent
points in their `mount()`. The shell can't enforce this (a custom
renderer that ignores the hooks still works), but it's the social
contract that keeps the ecosystem composable. Plugin authors who
write a rail renderer get the hook surface for free by emitting
the same `applyFilters` / `doAction` calls.

**Submenu renderers are invoked by the rail renderer.** The default
rail renderer wires a `contextmenu` listener on each tile that
calls `requestSubmenu( item, anchor )` — which resolves the active
submenu renderer and mounts its popover. Custom rail renderers do
the same: receive `requestSubmenu` in their mount-deps, call it on
right-click. The submenu registry doesn't care which rail renderer
you use; both layers compose.

**Rail renderer is the radical layer.** It owns the rail's
container element entirely; the shell does not paint into it after
`mount()` returns. Decoration hooks and submenu renderer continue
to work because the rail renderer participates in the same
contracts.

---

## Picking a starting point

A 60-second decision tree:

```
Want to change a tile's appearance?
├─ One className / wrapper / tooltip → Decoration hooks
├─ Animate tiles in or pulse on activity → Decoration hooks
└─ Different layout shape (ring, fan, stack) → Rail renderer

Want to change what the right-click does?
└─ Submenu renderer

Want to ship a complete redesign — your own dock implementation?
└─ Rail renderer (+ submenu renderer if you want to own that too)
```

When in doubt, **start with the smallest layer that works.** A
plugin that uses decoration hooks composes with whichever rail
renderer the user has active; a plugin that ships a rail renderer
takes responsibility for the whole UX. The decoration-hooks path
is almost always the right answer for "I want my plugin's tiles
to look distinctive" — the rail-renderer path is for "I want to
ship an entirely different dock paradigm."

---

## A complete example: a plugin that uses all three

```php
<?php
/**
 * Plugin Name: Aurora Dock
 * Description: Decoration + submenu + rail customization.
 */
defined( 'ABSPATH' ) || exit;

add_action( 'wp_desktop_shell_assets', function () {
    wp_enqueue_script(
        'aurora-dock',
        plugin_dir_url( __FILE__ ) . 'aurora-dock.js',
        array( 'wp-desktop-mode' ),
        '1.0.0',
        true
    );
} );
```

```js
// aurora-dock.js
wp.desktop.ready( () => {
    // 1. Decoration: glowing classNames on plugin tiles regardless
    //    of which rail renderer is active.
    wp.desktop.hooks.addFilter(
        'wp-desktop.dock.tile-class',
        'aurora-dock/glow',
        ( classes, ctx ) => {
            if ( ! ctx.isSystem && ! ctx.item.isCore ) {
                return [ ...classes, 'aurora-dock-glow' ];
            }
            return classes;
        },
    );

    // 2. Submenu renderer: a hovering cards popover.
    wp.desktop.registerSubmenuRenderer( {
        id:    'aurora-cards',
        label: 'Aurora Cards',
        owner: 'aurora-dock',
        mount: ( deps ) => mountCardsPopover( deps ),
    } );

    // 3. Rail renderer: a curved arc.
    wp.desktop.registerDockRailRenderer( {
        id:    'aurora-arc',
        label: 'Aurora Arc',
        owner: 'aurora-dock',
        mount: ( deps ) => mountArcRail( deps ),
    } );
} );
```

The user picks `Aurora Cards` and `Aurora Arc` independently in OS
Settings → Appearance. The glow decoration applies regardless. If
the plugin is deactivated, all three registrations sweep away
(matching `owner: 'aurora-dock'`); the user falls back to the
shipped baseline without a reload.

---

## Status & versioning

Every registration accepts an optional `apiVersion: 1` field
that's reserved for forward-compat. The shell rejects renderers
whose version it doesn't speak yet — same pattern WP uses for
block API versioning. When a future shell ships v2, plugins
written against v1 keep working until they opt in to v2.

| Surface | API version | Since |
|---|---|---|
| Decoration hooks | n/a — hook bus | 0.18.0 |
| `registerSubmenuRenderer` | 1 | 0.18.0 |
| `registerDockRailRenderer` | 1 | 0.18.0 |

If you need to ship a renderer that uses a version the shell
doesn't yet support, register a "downlevel" renderer with the
current version and detect the shell version at runtime.

---

## Companion APIs for renderer-agnostic plugin code

A plugin that wants to compose against the dock without committing to
a specific layer reaches for these instead of DOM scraping. All
**Stable since 0.18.0**:

| API | Returns | Use it for |
|---|---|---|
| `wp.desktop.openOsSettings()` | `void` | Portable opener for the shell's OS Settings window — same window the dock tile opens. Avoids the Classic-layout gotcha where the OS Settings tile lives on a different rail than your custom renderer. |
| `wp.desktop.listSystemTiles()` | `Array<{ id, title, icon, affinity }>` | Enumerate every JS-registered system tile (OS Settings, plugin native-window launchers). Compose your own launcher palette without scraping the DOM. |
| `wp.desktop.getSystemTile( id )` | `SystemDockItem \| null` | Fetch a specific tile to invoke its `onOpen()` callback. |
| `wp.desktop.getMenuItems()` | `DockItem[]` | The complete admin-menu list, regardless of how the active layout would partition it. Renderer-agnostic alternative to `mount-deps.fullMenu`. |

```js
// Open a known system tile from anywhere — no DOM scraping.
wp.desktop.getSystemTile( 'wp-desktop-os-settings' )?.onOpen();

// Or the dedicated entry point for OS Settings:
wp.desktop.openOsSettings();

// Iterate all system tiles for a custom launcher.
for ( const tile of wp.desktop.listSystemTiles() ) {
    console.log( tile.id, tile.title );
}
```

See the full reference for the [`DockItem` shape](./javascript-reference.md#dockitem-shape) — the canonical menu-item type these APIs return — including the `submenu` invariant that `submenu.length > 0` reliably means "has real children" (the shell strips self-link entries server-side).

---

## Where to go next

- **[Decoration hooks recipes](./examples/dock-decoration-hooks.md)** — six examples from one-line classNames to grid-wide IntersectionObservers.
- **[Submenu renderer walk-through](./examples/submenu-renderer.md)** — full "cards" implementation, ~100 lines.
- **[Rail renderer walk-through](./examples/dock-rail-renderer.md)** — full "ring" implementation with circular layout math.
- **[JavaScript Reference](./javascript-reference.md#dock-decoration)** — every API entry, every hook, every type.
- **[Architecture](./architecture.md#dock-customization-three-registries)** — how the registries plug into the layout dispatcher and the live menu-refresh pipeline.
