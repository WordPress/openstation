# Replace the dock rail entirely

> **Where this fits.** Dock customization has two layers — see
> [the overview](../dock-customization.md). This page covers the
> radical layer: owning the entire rail. Decoration hooks continue
> to work alongside whatever you build.
>
> | If you want to… | Use… |
> |---|---|
> | Add classNames, wrap tiles, animate them in | [Decoration hooks](./dock-decoration-hooks.md) |
> | Replace the entire rail (ring, stack, etc.) | **Rail renderer** *(this page)* |

The radical end of dock customization: a plugin can take over the
entire rail and paint it however they want — a circular ring, a
Stage-Manager-style stack, a floating cluster, anything that fits
the controller contract. The user picks among registered renderers
in OpenStation Settings → Appearance → Dock style.

For lighter touches (animations, classNames, wrappers, custom
tooltips), use the [decoration hooks](./dock-decoration-hooks.md)
instead — they layer on top of *any* renderer.

**Status:** Stable. Versioned (`apiVersion: 1`); a
renderer that doesn't speak the current version is rejected at
registration.

## The renderer contract

```ts
interface DockRailRenderer {
    id: string;                // 'default' | 'ring' | 'stage-manager' | …
    label: string;             // shown in OpenStation Settings picker
    description?: string;
    icon?: string;             // dashicon for the picker
    apiVersion?: 1;            // forward-compat gate
    owner?: string;            // for live unregistration
    mount( deps: DockRailMountDeps ): DockRailController;
}

interface DockRailMountDeps {
    container:        HTMLElement;                    // your renderer owns this
    items:            DockItem[];                     // rail-scoped slice (see "Two cohorts" below)
    fullMenu:         DockItem[];                     // complete admin menu
    fullSystemTiles:  SystemDockItem[];               // every JS-registered system tile
    orientation:      'left' | 'right' | 'bottom';
    openItem(         item ): void;                   // primary tile click — routes through window manager
    openSubmenuPick(  item, sub: SubmenuItem ): void; // submenu link click
    openSystemItem(   item ): void;                   // OpenStation Settings / plugin native-window tiles
    windowManager:    WindowManager;
    adminUrl:         string;
}

interface DockRailController {
    replaceItems(  items ): void;        // live menu refresh
    appendSystemItem( item ): void;
    removeSystemItem( id ): void;
    setBadge?(     itemId, count ): void;        // optional
    setAttention?( itemId, mode, opts? ): void;  // optional
    setOrientation?( orientation ): void;        // optional
    destroy(): void;
}
```

`mount()` builds and shows the rail; the controller drives every
subsequent live update. Required methods are `replaceItems`,
`appendSystemItem`, `removeSystemItem`, `destroy`. Others are
optional — renderers that don't support them silently skip the
update without breaking anything.

A `mount()` that throws is caught: the failure is logged via
`HOOKS.SHELL_ERROR` and the dispatcher falls back to the built-in
`'default'` renderer for that rail. The user sees a working dock
instead of nothing.

## Two cohorts: `items` vs `fullMenu`, plus system tiles

Dock items split into views the renderer can read at mount time:

| Field | What it carries | Use it when… |
|---|---|---|
| `items` | The **rail-scoped slice** the layout dispatcher routed to *this* rail. | You want to honour the layout's intent. Classic primary rail sees plugin items only; the side rail (default renderer) sees core items. Unified sees everything. Spatial sees plugin items only (core renders as wallpaper icons). |
| `fullMenu` | The **complete admin menu** regardless of rail. | You want to paint a unified view ignoring the layout's partitioning. A "ring" or "stage" renderer that surfaces every menu in one circle reads `fullMenu`. |
| `fullSystemTiles` | Every **JS-registered system tile** — OpenStation Settings, plugin-owned native-window launchers, the recycle bin, etc. | You want to apply uniform treatment (partition by `submenu.length > 0`, sort, decorate, badge) across every dockable thing in one pass — without maintaining parallel collections for menu items + system tiles. |

A renderer that doesn't care about the layout split (it draws every
menu on screen no matter which rail it's mounted on) reads
`fullMenu` AND `fullSystemTiles`:

```js
mount( { fullMenu, fullSystemTiles, openItem, openSystemItem, container } ) {
    // Partition every dockable thing in one pass — no parallel
    // collections, no "wait, did I forget the system tiles?" bug.
    const everything = [
        ...fullMenu.map( ( item ) => ( { item, isSystem: false } ) ),
        ...fullSystemTiles.map( ( item ) => ( { item, isSystem: true } ) ),
    ];
    for ( const { item, isSystem } of everything ) {
        const tile = document.createElement( 'button' );
        tile.textContent = item.title;
        tile.addEventListener( 'click', () =>
            isSystem ? openSystemItem( item ) : openItem( item ),
        );
        container.appendChild( tile );
    }
    // …
}
```

Live updates flow through the controller's `replaceItems( items )`
the same way regardless of which view you read at mount —
`replaceItems` carries the same rail-scoped slice. If your renderer
needs the full menu after a refresh, call
`wp.os.getMenuItems()` from inside `replaceItems`.

## System tiles — `appendSystemItem` lifecycle

`replaceItems` and `appendSystemItem` are independent update paths.
The shell does **not** re-emit `appendSystemItem` for previously-added
tiles after a `replaceItems` refresh — your renderer is responsible
for persisting the system-tile cohort across menu refreshes.

The canonical pattern: track system tiles in a closure-scoped
`Map`, re-paint them in `replaceItems()` after rebuilding the menu
cohort.

```js
mount( { container, items, openItem } ) {
    const systemTiles = new Map();

    function paintMenu( list ) {
        // … build menu DOM, attach openItem click handlers …
    }
    function paintSystemTile( item ) {
        // … build system-tile DOM, attach item.onOpen click handler …
    }
    function unpaintSystemTile( id ) { /* … */ }

    paintMenu( items );

    return {
        replaceItems( menu ) {
            // Wipe and rebuild menu tiles.
            paintMenu( menu );
            // Re-attach every tracked system tile so the menu
            // refresh doesn't lose them.
            for ( const item of systemTiles.values() ) {
                paintSystemTile( item );
            }
        },
        appendSystemItem( item ) {
            systemTiles.set( item.id, item );
            paintSystemTile( item );
        },
        removeSystemItem( id ) {
            systemTiles.delete( id );
            unpaintSystemTile( id );
        },
        destroy() { /* clean both cohorts */ },
    };
}
```

The default renderer (the shipped `Dock` class) uses exactly this
pattern internally — see `Dock.replaceItems()` if you want the
reference implementation.

## Routing — call the deps, don't reach for the manager

The mount-deps include three routing callbacks: `openItem`,
`openSubmenuPick`, `openSystemItem`. Renderers should use these
instead of calling `windowManager.open()` directly because they
encapsulate the right behaviour:

- multi-instance handling (`+` chip semantics)
- session restore wiring
- submenu propagation into the in-window tab strip
- per-window theming
- **window-id derivation** — `openItem(item)` and
  `openSubmenuPick(item, sub)` both call `deriveWindowId(url, adminUrl)`
  internally, so a custom renderer addresses the same window the
  default renderer would. A renderer that rolls its own slugifier
  ends up with mismatched ids — switching renderer mid-session
  loses the user's open windows. Plugins that absolutely need to
  build a window config from scratch can call
  `wp.os.deriveWindowId(url)` for the same id semantics.

`openSubmenuPick(item, sub)` is the canonical path for surfacing
submenus. A renderer that paints a radial menu / fan-out / cards
popover and lets the user pick a child link calls this with the
parent item + the picked submenu entry. The framework opens the
child URL with `baseId` pinned to the parent's id so the in-window
tab strip propagates correctly.

```js
mount( { fullMenu, openItem, openSubmenuPick } ) {
    // …
    onTileClick: ( item ) => openItem( item ),
    onSubmenuPick: ( item, sub ) => openSubmenuPick( item, sub ),
}
```

> **Don't pass a string to `windowManager.open()`.** It accepts a
> config object only — passing a URL string throws a `TypeError`
> at the call site. Use `openItem` / `openSubmenuPick` instead;
> they build the right config shape.

A renderer that calls `windowManager.open()` directly works today
but might silently miss a future feature. Stick to the callbacks
unless you specifically need to override behaviour.

`windowManager` is provided too — sparingly. Renderers that need
raw access (active state, virtual desktops, `getById`) can reach
for it.

## Minimal replacement: a "ring" renderer

Items arranged on a circle in the middle of the desktop area.
About 80 lines including the simple animation. The shipped Dock is
ignored entirely; this owns the rail.

```js
wp.os.ready( () => {
    wp.os.registerDockRailRenderer( {
        id:    'my-ring',
        label: 'Ring',
        description: 'Items orbit a central button.',
        icon:  'dashicons-marker',
        owner: 'my-plugin',
        mount( { container, items, openItem } ) {
            container.innerHTML = '';
            container.classList.add( 'my-ring' );

            // Lay items around a 120px-radius circle.
            const layout = ( list ) => {
                const radius = 120;
                const n = list.length;
                container.innerHTML = '';
                list.forEach( ( item, i ) => {
                    const angle = ( i / n ) * Math.PI * 2 - Math.PI / 2;
                    const x = Math.cos( angle ) * radius;
                    const y = Math.sin( angle ) * radius;
                    const tile = document.createElement( 'button' );
                    tile.type = 'button';
                    tile.className = 'my-ring__tile';
                    tile.style.transform = `translate( ${ x }px, ${ y }px )`;
                    tile.title = item.title;
                    tile.dataset.menuSlug = item.id;
                    if ( item.icon.startsWith( 'dashicons-' ) ) {
                        const icon = document.createElement( 'span' );
                        icon.className = `dashicons ${ item.icon }`;
                        tile.appendChild( icon );
                    } else {
                        tile.textContent = item.title.slice( 0, 2 );
                    }
                    tile.addEventListener( 'click', () => openItem( item ) );
                    container.appendChild( tile );
                } );
            };
            layout( items );

            // Track system tiles separately so a layout-rebuild
            // reattaches them in registration order.
            const systemTiles = new Map();

            return {
                replaceItems( next ) {
                    layout( next );
                    // Re-attach system tiles after the menu sweep.
                    for ( const [ id, item ] of systemTiles ) {
                        appendSystem( item );
                    }
                },
                appendSystemItem( item ) {
                    systemTiles.set( item.id, item );
                    appendSystem( item );
                },
                removeSystemItem( id ) {
                    systemTiles.delete( id );
                    container
                        .querySelector( `[data-system-id="${ id }"]` )
                        ?.remove();
                },
                destroy() {
                    container.innerHTML = '';
                    container.classList.remove( 'my-ring' );
                },
            };

            function appendSystem( item ) {
                const tile = document.createElement( 'button' );
                tile.type = 'button';
                tile.className = 'my-ring__tile my-ring__tile--system';
                tile.dataset.systemId = item.id;
                tile.title = item.title;
                if ( item.icon.startsWith( 'dashicons-' ) ) {
                    const icon = document.createElement( 'span' );
                    icon.className = `dashicons ${ item.icon }`;
                    tile.appendChild( icon );
                }
                tile.addEventListener( 'click', () => item.onOpen() );
                container.appendChild( tile );
            }
        },
    } );
} );
```

Style the tiles with whatever CSS makes sense — `position: absolute`
on `.my-ring__tile`, transitions, hover scaling, glow, particle
trails. The renderer owns the visual treatment entirely.

## What `wp.os.dock` does with a custom renderer

When the active renderer is `'default'`, `wp.os.dock` and
`wp.os.sideDock` keep returning the underlying `Dock`
instance — backwards compat for plugins that read the API
directly. With a custom renderer active, both return `null`
because the controller doesn't expose a `Dock`. Plugins that need
renderer-agnostic access (drive a badge from somewhere else) should
fan the update across every rail with optional chaining (see
[the dock-badge example](./dock-badge.md)) rather than reading
`wp.os.dock` alone:

```js
// Renderer-agnostic: the rails that own the id paint, the
// missing handles silently no-op.
wp.os.dock?.setBadge?.(    'edit.php', 3 );
wp.os.taskbar?.setBadge?.( 'edit.php', 3 );
wp.os.icons?.setBadge?.(   'edit.php', 3 );

// Renderer-specific: only works when the default renderer is active.
wp.os.dock?.setBadge( 'edit.php', 3 );
```

## Live registration on plugin activation

Same lifecycle as commands and settings tabs. Register the script
handle server-side via
`openstation_register_dock_rail_renderer_script()`; the shell
loads the script over the chromeless bridge on activation, the JS
calls `registerDockRailRenderer()`, and OpenStation Settings → Dock style
surfaces the new option immediately — no F5.

```php
<?php
/**
 * Plugin Name: My Ring Dock
 */
defined( 'ABSPATH' ) || exit;

add_action( 'admin_enqueue_scripts', function () {
    wp_register_script(
        'my-rail-renderer',
        plugin_dir_url( __FILE__ ) . 'assets/rail-renderer.js',
        array( 'openstation' ),
        '1.0.0',
        true
    );
    wp_enqueue_script( 'my-rail-renderer' );
} );

// Opt this script into the live-refresh payload so it loads
// the moment the plugin activates (and unloads on deactivation).
openstation_register_dock_rail_renderer_script( 'my-rail-renderer' );
```

```js
// assets/rail-renderer.js
wp.os.ready( () => {
    wp.os.registerDockRailRenderer( {
        id:    'my-ring',
        label: 'Ring',
        owner: 'my-rail-renderer',   // matches the script handle above
        mount( deps ) { /* … */ },
    } );
} );
```

When the plugin is deactivated mid-session, the chromeless bridge
emits a fresh payload without the handle; the shell's renderer
sync calls `unregisterDockRailRenderersByOwner( 'my-rail-renderer' )`
so every renderer the plugin contributed disappears from the
picker. If the user had it active, the dispatcher's subscription
to the registry resolves to `'default'` and rebuilds the rails
with the shipped baseline. No reload required either way.

> **Why `owner` matters.** Plugins that ship a renderer without
> setting `owner: '<script-handle>'` keep their renderer until the
> next full page load — graceful backwards-compat, but it means
> a stale renderer can outlive its plugin until the user F5s.
> Match `owner` to the script handle and live-unregister works.

## Composability with decoration hooks

The default `Dock` renderer fires the `os.dock.tile-class`,
`tile-element`, `tile-tooltip`, `tile-rendered`, `before-render`,
and `after-render` filters/actions while painting. Custom rail
renderers SHOULD fire the same hooks at equivalent points so
decoration plugins (glow, shake, pulse, custom tooltips) work
regardless of which renderer the user picked. The shell can't
enforce this — but the framework provides one-line helpers so
"running the hooks" is no harder than not running them:

```js
mount( { container, fullMenu } ) {
    const ctx = { dockId: 'my-renderer', orientation: 'bottom' };

    function buildTile( item, isSystem ) {
        // 1. Apply the registered tile-class filter.
        const baseClasses = [
            'my-renderer__tile',
            isSystem ? 'my-renderer__tile--system' : 'my-renderer__tile--menu',
        ];
        const classes = wp.os.applyTileClasses(
            baseClasses,
            item,
            { ...ctx, isSystem },
        );

        const tile = document.createElement( 'button' );
        tile.className = classes.join( ' ' );
        tile.dataset[ isSystem ? 'systemId' : 'menuSlug' ] = item.id;

        // 2. Render the icon via the canonical dispatch.
        tile.appendChild( wp.os.renderIcon( item.icon, {
            title: item.title,
            className: 'my-renderer__icon',
        } ) );

        // 3. Resolve the tooltip text through the filter (returns
        //    empty string if a plugin requested suppression).
        const tooltipLabel = wp.os.applyTileTooltip(
            item.title,
            item,
            { ...ctx, isSystem },
        );
        if ( tooltipLabel ) {
            tile.title = tooltipLabel;
        }

        // 4. Let decoration plugins wrap or replace the tile.
        const finalEl = wp.os.applyTileElement(
            tile,
            item,
            { ...ctx, isSystem },
        );

        container.appendChild( finalEl );

        // 5. Fire the after-insertion action so plugins doing
        //    layout-dependent decoration (animations,
        //    IntersectionObserver) get a chance.
        wp.os.dispatchTileRendered( finalEl, item, {
            ...ctx,
            isSystem,
        } );
    }

    // … paint everything, register the dock selector …
    const unregisterSelector = wp.os.registerDockSelector(
        '.my-renderer__root',
    );

    return {
        replaceItems( menu ) { /* repaint, re-fire hooks */ },
        appendSystemItem( item ) { buildTile( item, true ); },
        removeSystemItem( id ) { /* … */ },
        destroy() {
            unregisterSelector();
            container.innerHTML = '';
        },
    };
}
```

`registerDockSelector` registers your renderer's root selector with
`wp.os.isDockElement` so other plugins' click-outside handlers
correctly recognise clicks on your renderer as "inside the dock"
and don't dismiss themselves.

## Composability

Two customization registries, both orthogonal:

- **Decoration hooks** — fire from inside the *default* rail
  renderer. Custom rail renderers SHOULD fire equivalent hooks for
  ecosystem compatibility (the shell can't enforce, but it's a
  signed contract). Use the `wp.os.applyTileClasses` /
  `applyTileElement` / `applyTileTooltip` / `dispatchTileRendered`
  helpers to participate in two lines.
- **Dock rail renderer** — owns the entire rail. The radical
  customization layer.

Pick the smallest layer that solves your problem. A glow effect
and a custom tooltip is decoration hooks. A circular dock with
springy physics is a rail renderer. Plugin authors composing both
is a normal flow.
