# Replace the dock rail entirely

> **Where this fits.** Dock customization has three layers — see
> [the overview](../dock-customization.md). This page covers the
> radical layer: owning the entire rail. Decoration hooks and the
> submenu renderer continue to work alongside whatever you build.
>
> | If you want to… | Use… |
> |---|---|
> | Add classNames, wrap tiles, animate them in | [Decoration hooks](./dock-decoration-hooks.md) |
> | Replace the right-click submenu popover | [Submenu renderer](./submenu-renderer.md) |
> | Replace the entire rail (ring, stack, etc.) | **Rail renderer** *(this page)* |

The radical end of dock customization: a plugin can take over the
entire rail and paint it however they want — a circular ring, a
Stage-Manager-style stack, a floating cluster, anything that fits
the controller contract. The user picks among registered renderers
in OS Settings → Appearance → Dock style.

For lighter touches (animations, classNames, wrappers, custom
tooltips), use the [decoration hooks](./dock-decoration-hooks.md)
instead — they layer on top of *any* renderer.

**Status:** Stable since 0.18.0. Versioned (`apiVersion: 1`); a
renderer that doesn't speak the current version is rejected at
registration.

## The renderer contract

```ts
interface DockRailRenderer {
    id: string;                // 'default' | 'ring' | 'stage-manager' | …
    label: string;             // shown in OS Settings picker
    description?: string;
    icon?: string;             // dashicon for the picker
    apiVersion?: 1;            // forward-compat gate
    owner?: string;            // for live unregistration
    mount( deps: DockRailMountDeps ): DockRailController;
}

interface DockRailMountDeps {
    container:     HTMLElement;          // your renderer owns this
    items:         DockItem[];           // initial menu items
    orientation:   'left' | 'right' | 'bottom';
    openItem(      item ): void;         // primary tile click — routes through window manager
    openSystemItem( item ): void;        // OS Settings / plugin native-window tiles
    requestSubmenu( item, anchor ): void;
    windowManager: WindowManager;
    adminUrl:      string;
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

## Routing — call the deps, don't reach for the manager

The mount-deps include three routing callbacks: `openItem`,
`openSystemItem`, `requestSubmenu`. Renderers should use these
instead of calling `windowManager.open()` directly because they
encapsulate the right behaviour:

- multi-instance handling (`+` chip semantics)
- session restore wiring
- submenu propagation into the in-window tab strip
- per-window theming

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
wp.desktop.ready( () => {
    wp.desktop.registerDockRailRenderer( {
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

## What `wp.desktop.dock` does with a custom renderer

When the active renderer is `'default'`, `wp.desktop.dock` and
`wp.desktop.sideDock` keep returning the underlying `Dock`
instance — backwards compat for plugins that read the API
directly. With a custom renderer active, both return `null`
because the controller doesn't expose a `Dock`. Plugins that need
renderer-agnostic access (drive a badge from somewhere else) should
prefer the **public API methods** that route through the dispatcher
rather than reading `wp.desktop.dock` directly:

```js
// Renderer-agnostic: works regardless of active renderer.
wp.desktop.windowManager.broadcast( /* … */ );

// Renderer-specific: only works when the default renderer is active.
wp.desktop.dock?.setBadge( 'edit.php', 3 );
```

## Live registration on plugin activation

Same lifecycle as commands and settings tabs: register from a
script that loads with the shell, set `owner` so plugin
deactivation auto-removes the renderer.

```php
add_action( 'wp_desktop_shell_assets', function () {
    wp_enqueue_script(
        'my-rail-renderer',
        plugin_dir_url( __FILE__ ) . 'assets/rail-renderer.js',
        array( 'wp-desktop-mode' ),
        '1.0.0',
        true
    );
} );
```

```js
// assets/rail-renderer.js
wp.desktop.ready( () => {
    wp.desktop.registerDockRailRenderer( {
        id:    'my-ring',
        label: 'Ring',
        owner: 'my-rail-renderer',   // matches the script handle above
        mount( deps ) { /* … */ },
    } );
} );
```

When the plugin is deactivated mid-session, the shell calls
`unregisterDockRailRenderersByOwner('my-rail-renderer')` — every
renderer the plugin registered disappears from the picker, and if
the user had it active, the dispatcher rebuilds the rail with the
shipped baseline. No reload required.

## Composability

Three customization registries, all orthogonal:

- **Decoration hooks** — fire from inside the *default* rail
  renderer. Custom rail renderers SHOULD fire equivalent hooks for
  ecosystem compatibility (the shell can't enforce, but it's a
  signed contract).
- **Submenu renderer** — owns the popover that opens on right-click.
  Custom rail renderers call `requestSubmenu( item, anchor )` to
  invoke whichever submenu renderer is active; combinations work.
- **Dock rail renderer** — owns the entire rail. The radical
  customization layer.

Pick the smallest layer that solves your problem. A glow effect
and a custom tooltip is decoration hooks. A radial submenu is a
submenu renderer. A circular dock with springy physics is a rail
renderer. Plugin authors composing all three is a normal flow.
