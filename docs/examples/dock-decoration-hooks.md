# Decorate the dock without forking the renderer

> **Where this fits.** Dock customization has three layers — see
> [the overview](../dock-customization.md). This page covers the
> cheapest layer: decoration hooks. They compose with any rail
> renderer and across multiple plugins.
>
> | If you want to… | Use… |
> |---|---|
> | Add classNames, wrap tiles, animate them in | **Decoration hooks** *(this page)* |
> | Replace the entire rail (ring, stack, etc.) | [Rail renderer](./dock-rail-renderer.md) |

The default `Dock` renderer fires a small set of filters and actions while it
paints. Plugins compose decoration — animations, classNames, wrappers,
custom tooltips — through these instead of replacing the whole rail.

**Status:** Stable.

## The hook surface

| Hook | Kind | Signature |
|---|---|---|
| `os.dock.before-render` | Action | `( ctx: DockRenderContext ) => void` |
| `os.dock.tile-class` | Filter | `( classes: string[], ctx: DockTileContext ) => string[]` |
| `os.dock.tile-element` | Filter | `( el: HTMLElement, ctx: DockTileContext ) => HTMLElement` |
| `os.dock.tile-tooltip` | Filter | `( label: string, ctx: DockTileContext ) => string` |
| `os.dock.tile-rendered` | Action | `( ctx: DockTileContext & { el: HTMLElement } ) => void` |
| `os.dock.after-render` | Action | `( ctx: DockRenderContext ) => void` |

Both context shapes carry `{ rail, orientation, dockId, container }` so a
single subscriber can disambiguate when two rails coexist (Classic
layout's left side bar + bottom dock). `dockId` matches the host
element id — `'os-dock'` for the bottom rail,
`'os-side-dock'` for the Classic side rail.

`DockTileContext` adds `{ item, isSystem }`. When `isSystem` is true the
item is a `SystemDockItem` (OpenStation Preferences, plugin-owned native-window
launchers); otherwise it's a `DockItem` from the admin menu.

## Add a className per tile

Useful for theming a specific plugin's tiles or for marking tiles you
own without modifying the menu data.

```js
wp.os.hooks.addFilter(
    'os.dock.tile-class',
    'my-plugin/decorate',
    ( classes, ctx ) => {
        if ( ! ctx.isSystem && ctx.item.id === 'edit.php' ) {
            return [ ...classes, 'my-plugin-glow' ];
        }
        return classes;
    },
);
```

CSS:

```css
.my-plugin-glow .os-dock__item-primary {
    box-shadow: 0 0 12px rgba( 255, 255, 100, 0.6 );
}
```

## Wrap a tile in a custom container

Returning a different element from `os.dock.tile-element`
replaces the tile in the DOM. The shell still finds the original
`[data-menu-slug]` / `[data-system-id]` descendant for active-state
and badge updates, so **wrap the tile, don't replace it**.

```js
wp.os.hooks.addFilter(
    'os.dock.tile-element',
    'my-plugin/wrap',
    ( el, ctx ) => {
        if ( ctx.isSystem ) {
            return el;
        }
        const wrapper = document.createElement( 'div' );
        wrapper.className = 'my-plugin-tile-wrap';
        wrapper.appendChild( el );
        return wrapper;
    },
);
```

## Customize the tooltip text

The filter resolves once at bind time, so it never re-fires on
pointerenter. Returning an empty string suppresses the tooltip
entirely.

```js
wp.os.hooks.addFilter(
    'os.dock.tile-tooltip',
    'my-plugin/tooltip',
    ( label, ctx ) => {
        if ( ! ctx.isSystem && ctx.item.badge > 0 ) {
            return `${ label } — ${ ctx.item.badge } pending`;
        }
        return label;
    },
);
```

## Animate a tile after it lands in the DOM

`os.dock.tile-rendered` fires once per tile after insertion,
so computed layout (offsetWidth, getBoundingClientRect) is ready.

```js
wp.os.hooks.addAction(
    'os.dock.tile-rendered',
    'my-plugin/animate',
    ( { el, item, isSystem } ) => {
        if ( isSystem || ! item.multi ) {
            return;
        }
        el.animate(
            [
                { transform: 'translateY( 8px )', opacity: 0 },
                { transform: 'translateY( 0 )',   opacity: 1 },
            ],
            { duration: 240, easing: 'cubic-bezier( 0.2, 0.8, 0.2, 1 )' },
        );
    },
);
```

## Bulk decoration after every paint

`os.dock.after-render` fires once per pass with the full
tile element map. Use it when a decoration touches multiple tiles or
needs the post-paint geometry (e.g. measuring the rail's bounding
rect for a custom indicator).

```js
wp.os.hooks.addAction(
    'os.dock.after-render',
    'my-plugin/connector',
    ( { tileElements, container } ) => {
        // …draw a connector between two tiles, attach an
        //   IntersectionObserver, etc.
    },
);
```

## A note on CSS-variable transitions

A common decoration pattern is to drive a `transform` (scale,
translate) off a custom CSS property so a hover state interpolates
smoothly. By default, custom properties are typed as `<string>`,
which CSS can't interpolate — the transition snaps. Two paths:

- **Drive the transform inline from JS** — set `el.style.transform`
  directly in the relevant pointer / focus listener. Portable
  across every browser; the transition `transform 180ms` you set
  on the element interpolates the value the way CSS expects.

```js
wp.os.hooks.addAction(
    'os.dock.tile-rendered',
    'my-plugin/lift',
    ( { el } ) => {
        el.style.transition = 'transform 180ms ease';
        el.addEventListener( 'pointerenter', () => {
            el.style.transform = 'translateY( -2px ) scale( 1.05 )';
        } );
        el.addEventListener( 'pointerleave', () => {
            el.style.transform = '';
        } );
    },
);
```

- **Use `@property`** — declare your custom property with an
  explicit `syntax` so the browser can interpolate it:

```css
@property --tile-scale {
    syntax: '<number>';
    inherits: false;
    initial-value: 1;
}
.my-plugin-tile {
    transform: scale( var( --tile-scale ) );
    transition: --tile-scale 180ms ease;
}
.my-plugin-tile:hover { --tile-scale: 1.05; }
```

This is the cleaner authoring model but requires `@property`
support — Safari ≤15.3, Firefox ≤127, and several embedded
WebViews skip the transition silently and snap to the end value.
If your plugin must work on those, use the inline-JS path.

## Compatibility with custom renderers

A custom rail renderer (see [`dock-rail-renderer.md`](./dock-rail-renderer.md))
SHOULD fire the same hooks at equivalent points so plugins that decorate
through this surface keep working when the user picks a different
renderer. The shell does not enforce this — fire idiomatic
`applyFilters` / `doAction` calls in your renderer's `mount()`
implementation and you're ecosystem-compatible for free.
