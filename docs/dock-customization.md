# Dock customization — two registries, one mental model

The dock is one of the most visible surfaces in the shell. It's also
one of the most extensible. Two customization registries layer on
top of each other, each carrying a different scope of "how much of
the dock you want to own":

| Layer | Owns… | Use it when… |
|---|---|---|
| [**Decoration hooks**](./examples/dock-decoration-hooks.md) | A few classNames, a wrapper, a tooltip, an after-render decoration. | You want to nudge the visual without owning the rail. Cheap, composable across plugins. |
| [**Dock rail renderer**](./examples/dock-rail-renderer.md) | The entire rail. Layout, animation, click-handling, lifecycle. | You want a circular ring, Stage-Manager stack, floating cluster, or anything that doesn't fit a row of tiles. |

Both are **Stable**. Pick the smallest layer that
solves your problem.

---

## How they compose

The two registries are deliberately orthogonal — a plugin author
can use either without the other, and combinations work cleanly.

**Decoration hooks fire from inside the *default* rail renderer.**
Custom rail renderers SHOULD fire equivalent hooks at equivalent
points in their `mount()`. The shell can't enforce this (a custom
renderer that ignores the hooks still works), but it's the social
contract that keeps the ecosystem composable. Plugin authors who
write a rail renderer get the hook surface for free by emitting
the same `applyFilters` / `doAction` calls — or by using the
`wp.os.applyTileClasses` / `applyTileElement` /
`applyTileTooltip` / `dispatchTileRendered` helpers.

**Rail renderer is the radical layer.** It owns the rail's
container element entirely; the shell does not paint into it after
`mount()` returns. Decoration hooks continue to work because the
rail renderer participates in the same hook contracts.

---

## Picking a starting point

A 30-second decision tree:

```
Want to change a tile's appearance?
├─ One className / wrapper / tooltip → Decoration hooks
├─ Animate tiles in or pulse on activity → Decoration hooks
└─ Different layout shape (ring, fan, stack) → Rail renderer

Want to ship a complete redesign — your own dock implementation?
└─ Rail renderer
```

When in doubt, **start with the smallest layer that works.** A
plugin that uses decoration hooks composes with whichever rail
renderer the user has active; a plugin that ships a rail renderer
takes responsibility for the whole UX. The decoration-hooks path
is almost always the right answer for "I want my plugin's tiles
to look distinctive" — the rail-renderer path is for "I want to
ship an entirely different dock paradigm."

---

## A complete example: a plugin that uses both

```php
<?php
/**
 * Plugin Name: Aurora Dock
 * Description: Decoration + rail customization.
 */
defined( 'ABSPATH' ) || exit;

add_action( 'admin_enqueue_scripts', function () {
    wp_register_script(
        'aurora-dock',
        plugin_dir_url( __FILE__ ) . 'aurora-dock.js',
        array( 'openstation' ),
        '1.0.0',
        true
    );
    wp_enqueue_script( 'aurora-dock' );
} );

// Live-syncs the script on plugin activate / deactivate.
openstation_register_dock_rail_renderer_script( 'aurora-dock' );
```

```js
// aurora-dock.js
wp.os.ready( () => {
    // 1. Decoration: glowing classNames on plugin tiles regardless
    //    of which rail renderer is active.
    wp.os.hooks.addFilter(
        'os.dock.tile-class',
        'aurora-dock/glow',
        ( classes, ctx ) => {
            if ( ! ctx.isSystem && ! ctx.item.isCore ) {
                return [ ...classes, 'aurora-dock-glow' ];
            }
            return classes;
        },
    );

    // 2. Rail renderer: a curved arc.
    wp.os.registerDockRailRenderer( {
        id:    'aurora-arc',
        label: 'Aurora Arc',
        owner: 'aurora-dock',  // matches the PHP script handle
        mount: ( deps ) => mountArcRail( deps ),
    } );
} );
```

The user picks `Aurora Arc` in OpenStation Preferences → Appearance → Dock
style. The glow decoration applies regardless. If the plugin is
deactivated, the rail renderer sweeps away (matching `owner:
'aurora-dock'`) and the user falls back to the shipped baseline
without a reload; the decoration filter stays registered on the
hook bus until the next full page load.

---

## Zones

A rail paints three zones, with a divider between each adjacent pair
of non-empty ones:

| Zone | Holds |
|---|---|
| `core` | WordPress's own admin menus. Empty on the dock while the split layout is on — they are in the sidebar. |
| `apps` | Plugin admin menus, app launchers, and any running window with no home of its own. |
| `controls` | OpenStation's own affordances: Mio, Overview, System, the Trash, the way out. |

Zone membership is derived from what each item IS, never stored, which
is what makes "a tile cannot be dragged into another zone" structural
rather than a rule to enforce. The shell hands a rail its whole
contents through one controller call:

```js
setZones( {
    core:     [ { type: 'menu', item }, … ],
    apps:     [ { type: 'menu', item }, { type: 'system', item }, … ],
    controls: [ { type: 'system', item }, … ],
} );
```

The `DockEntry` union is there because a zone mixes cohorts: a plugin's
admin menu and a plugin's app launcher sit side by side in `apps`.

`setZones` is **optional**. A renderer that doesn't implement it is
driven through `replaceItems` + `appendSystemItem` / `removeSystemItem`
exactly as before. It loses the zone boundaries, which it had no way to
paint, and reordering of system tiles, since that path only adds and
removes them. Either way `mount()` now receives an empty `items` array: the
shell fills the rail through the controller on the same turn, so a
rail's contents come from exactly one place. Read `fullMenu` for the
whole admin menu.

---

## Live registration on plugin activation

Both layers support live registration without an F5. Same pattern
WordPress plugins already know from commands and OpenStation Preferences tabs:

| Registry | PHP helper |
|---|---|
| Dock rail renderer | `openstation_register_dock_rail_renderer_script( $handle )` |
| Decoration hooks | None needed — plugins call `wp.hooks.addFilter()` from any boot path; the hook bus is global. |

```php
// Standard pattern: enqueue the script + register the handle.
add_action( 'admin_enqueue_scripts', function () {
    wp_register_script(
        'my-plugin-rail',
        plugins_url( 'js/rail.js', __FILE__ ),
        array( 'openstation' ),
        '1.0.0',
        true
    );
    wp_enqueue_script( 'my-plugin-rail' );
} );
openstation_register_dock_rail_renderer_script( 'my-plugin-rail' );
```

```js
// In the registered script — match `owner` to the script handle so
// deactivation auto-unregisters the renderer.
wp.os.ready( () => {
    wp.os.registerDockRailRenderer( {
        id:    'my-ring',
        label: 'Ring',
        owner: 'my-plugin-rail',
        mount( deps ) { /* … */ },
    } );
} );
```

The chromeless bridge re-emits the payload whenever the user
activates / deactivates a plugin in the Plugins admin window. The
shell loads new scripts via the registry sync, runs
`unregisterByOwner( handle )` for handles that disappeared, and
the dispatcher's subscription rebuilds the rails if the user's
active id resolved to a now-departed renderer.

---

## Status & versioning

`registerDockRailRenderer` accepts an optional `apiVersion: 1`
field that's reserved for forward-compat. The shell rejects
renderers whose version it doesn't speak yet — same pattern WP
uses for block API versioning. When a future shell ships v2,
plugins written against v1 keep working until they opt in to v2.

| Surface | API version |
|---|---|
| Decoration hooks | n/a — hook bus |
| `registerDockRailRenderer` | 1 |

---

## Companion APIs for renderer-agnostic plugin code

A plugin that wants to compose against the dock without committing
to a specific layer reaches for these instead of DOM scraping. All
**Stable**:

| API | Returns | Use it for |
|---|---|---|
| `wp.os.openOsSettings( opts? )` | `void` | Portable opener for the shell's OpenStation Preferences window — same window the dock tile opens. Avoids the Classic-layout gotcha where the OpenStation Preferences tile lives on a different rail than your custom renderer. Pass `{ tabId }` (e.g. `'ai'`, `'features'`) to deep-link to a specific tab. |
| `wp.os.listSystemTiles()` | `Array<{ id, title, icon, navKind, placeable, locked }>` | Enumerate every JS-registered system tile (Mio toggle, the Trash, plugin native-window launchers). Compose your own launcher palette without scraping the DOM. |
| `wp.os.getSystemTile( id )` | `SystemDockItem \| null` | Fetch a specific tile to invoke its `onOpen()` callback. |
| `wp.os.getMenuItems()` | `DockItem[]` | The complete admin-menu list, regardless of how the active layout would partition it. Renderer-agnostic alternative to `mount-deps.fullMenu`. |
| `wp.os.getNavItems()` | `NavItem[]` | Every navigable thing — admin menus, app launchers, registered icons, OpenStation's controls — as one list, each carrying the `kind` that decides its default placement and its zone. |
| `wp.os.getNav()` | `NavResult \| null` | The computed navigation: the dock's three zones, the sidebar, the wallpaper, and the ids present only because their window is open. Read this rather than re-deriving placement. |
| `wp.os.deriveWindowId( url )` | `string` | The same id the default renderer uses to open a tile. Custom renderers that build their own window configs use this so switching renderer mid-session preserves open windows. |

```js
// Open a known system tile from anywhere — no DOM scraping.
wp.os.getSystemTile( 'os-settings' )?.onOpen();

// Or the dedicated entry point for OpenStation Preferences:
wp.os.openOsSettings();

// Deep-link straight to a specific settings tab:
wp.os.openOsSettings( { tabId: 'ai' } );

// Iterate all system tiles for a custom launcher.
for ( const tile of wp.os.listSystemTiles() ) {
    console.log( tile.id, tile.title );
}
```

See the full reference for the [`DockItem` shape](./javascript-reference.md#dockitem-shape) — the canonical menu-item type these APIs return — including the `submenu` invariant that `submenu.length > 0` reliably means "has real children" (the shell strips self-link entries server-side).

---

## Where to go next

- **[Decoration hooks recipes](./examples/dock-decoration-hooks.md)** — six examples from one-line classNames to grid-wide IntersectionObservers.
- **[Rail renderer walk-through](./examples/dock-rail-renderer.md)** — full "ring" implementation with circular layout math.
- **[JavaScript Reference](./javascript-reference.md#dock-decoration)** — every API entry, every hook, every type.
- **[Architecture](./architecture.md#dock-customization--two-registries)** — how the registries plug into the layout dispatcher and the live menu-refresh pipeline.
