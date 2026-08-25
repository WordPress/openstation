# Icons

*Stable.*

OpenStation draws from a set of exactly thirty icons. Nineteen are WordPress's
own, taken from [`@wordpress/icons`](https://developer.wordpress.org/block-editor/reference-guides/packages/packages-icons/).
Eleven are drawn for this plugin. There is one rule for which is which, and it
is worth learning before adding any UI:

> **Core owns the verbs, OpenStation owns the nouns.**

If WordPress already has a concept, its icon comes from Core and looks the way
it does in every other WordPress screen the user has ever seen. We draw one only
when the thing exists *because* this is a desktop and wp-admin is not. Save,
search, trash, settings and download are Core's every time. A window you can
drag is not a WordPress concept, so `window` is ours.

## The set

The eleven that are ours:

`window` · `windows` · `dock` · `spaces` · `copilot` · `snap` · `command` ·
`apps` · `widgets` · `user` · `lock`

Core's nineteen, under the name the shell uses for each:

`close` · `check` · `chevron-right` · `arrow-up-right` · `plus` · `search` ·
`pin` · `trash` · `download` · `settings` · `info` · `bell` · `more` ·
`maximize` · `edit` · `color` · `wallpaper` · `warning` · `minimize`

Six of those are the same concept under a different word upstream: `more` is
`more-horizontal`, `maximize` is `fullscreen`, `edit` is `pencil`, `wallpaper`
is `image`, `warning` is `caution`, `minimize` is `line-solid`. The shell says
what it means rather than what upstream filed it under.

There is deliberately **no `palette`**. It reads as *command palette*, which is
`command` in this very set, so the colour droplet takes Core's own name.

## Using them

```ts
import { osIcon, osIconSvg, osIconDataUri } from '<…>/ui/icons';

// A node, for `html` template slots.
html`<button aria-label="Dismiss">${ osIcon( 'close', { size: 16 } ) }</button>`

// Markup, for string-built UI and `innerHTML`.
el.innerHTML = osIconSvg( 'trash', { size: 20 } );

// A data URI, for the `icon:` field of the dock / window / desktop-icon APIs.
wp.os.registerDockItem( { icon: osIconDataUri( 'spaces' ) } );
```

Options: `size` (CSS pixels, default 24, `null` to let CSS own the box),
`className`, `title`, and `rotate` (90 / 180 / 270). The set ships **one
chevron**, pointing right, the way Core does; a menu that opens downwards asks
for `rotate: 90` rather than a second drawing.

An unknown name renders nothing rather than throwing. A missing glyph is a
blemish; an error inside a render pass takes the surface down with it.

### From a plugin

Third-party plugins reach the same thirty through `wp.os.iconSet`, so a window
you register can wear the icons the shell wears instead of your own:

```js
el.innerHTML = wp.os.iconSet.svg( 'trash', { size: 20 } );
button.append( wp.os.iconSet.node( 'close', { size: 16 } ) );
wp.os.registerDockItem( { icon: wp.os.iconSet.dataUri( 'spaces' ) } );

wp.os.iconSet.names           // all thirty
wp.os.iconSet.ours            // the eleven that are OpenStation's
wp.os.iconSet.has( 'window' ) // true
```

Not to be confused with `wp.os.icons`, which is the wallpaper icon rail's badge
and art API. The two are unrelated; the name here is singular-plus-`Set` for
exactly that reason.

The object is frozen, including its two lists. Every plugin on the page reaches
the same one, so a reassignment would change what everyone else draws.

TypeScript plugins can import instead of reaching through the global:

```ts
import { osIconSvg, type OsIconName } from 'openstation';
```

### Accessibility

Icons are `aria-hidden` by default, because the common case is a glyph inside a
button that already carries its own label, and announcing both reads the control
twice. Pass `title` only when the icon is the sole carrier of meaning; it
becomes `role="img"` with an accessible name.

### Sizing

The default is 24, Core's native size and what WordPress renders these at.
Core's glyphs carry 1.5-unit strokes on a 24 grid, so at 10px those are 0.6px
wide and the shape goes faint. **Below about 16px an icon stops being an icon**
and becomes part of the drawing it sits in: that is why the spinner's arc, the
save-status check inside its 8px dot, and the Mio mark are drawn where they are
used rather than taken from here.

## What is not in the set, and why

Three groups stay hand-drawn on purpose, and each says so at the code:

- **Window chrome** (`os-window-button`, `os-tab-chip`). The set covers `close`
  but has no `detach`, `fullscreen-exit` or `reload`, and neither does Core.
  Converting only `close` would put one filled glyph beside a monoline one
  inside a cluster two buttons wide, which is the exact inconsistency the set
  exists to remove. Chrome stays whole at its own 12-grid, 1.25-stroke weight.
- **Dock tile art** (`dock-shell-tiles.ts`, `gear-icon.ts`, `shortcuts.ts`). A
  64-grid family with heavier strokes, shipped as `data:` URIs because the dock
  API takes an `icon:` string. Two of them have no member in the set at all: the
  gear is deliberately *not* Core's `settings`, because the System tile beside
  it already means settings.
- **Marks and motion**: the WordPress logo, the Mio face, spinners, stars, the
  eye in `os-text-field`. Not vocabulary.

Adding a thirty-first icon is a design decision rather than a drive-by
addition; `tests/vitest/ui-icons.test.ts` pins the counts so it cannot happen by
accident.

## Where the drawings live

`src/ui/icons/set.ts` is **generated** from the brand repository and must not be
hand-edited. `src/ui/icons/index.ts` beside it is hand-written and is what call
sites import. Core's paths are copied verbatim, so a fix upstream is
re-exported, never re-drawn.

The same eleven appear twice more in the tree, for different consumers:

| Where | What | Why |
| --- | --- | --- |
| `src/ui/icons/set.ts` | monoline, as drawn | what the shell renders |
| `assets/icons/*.svg` | outlines of the strokes | what WordPress's icon registry accepts |
| The brand repository | the sources | what everything else is generated from |

The outlines exist because WordPress sanitises registered icon markup through
`wp_kses` and keeps no `stroke` attribute, so a monoline icon registered as
drawn loses its stroke and renders as a blob. That constraint applies to the
registry only; nothing in our own shadow roots passes through `wp_kses`, which
is why the shell draws the real strokes. See
[`assets/icons/README.md`](../assets/icons/README.md) and
[`includes/wp-icon-registry.php`](../includes/wp-icon-registry.php).

On WordPress 7.1 and newer the eleven are also reachable from PHP as
`wp_get_icon( 'openstation/window' )`. Every call is feature-detected, so the
plugin's 6.0 floor is unaffected.

## Drawing rules, if you ever add one

24 x 24 grid, 17.5 live area, 1.5 stroke, round caps and joins, corner radius 2
(Core's value), `currentColor` and never a hex. `currentColor` is not a
preference: it is what routes art down the mask path in the dock and title-bar
painters, and a fixed fill survives neither. Start from an existing icon rather
than a blank grid.
