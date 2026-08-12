# Desktop themes

**Status:** Experimental

A **desktop theme** reskins the whole OpenStation shell at once —
every design token, the typeface, a texture on any surface the shell
paints, the window frame and its corners, and a complete iconset down
to the window control glyphs. It ships as a ZIP containing a
`theme.json` manifest plus images and fonts. Nothing else.

> **Desktop themes vs window themes.** OpenStation also has
> *window themes* (`openstation_register_window_theme()`,
> `wp.os.registerWindowTheme`), which restyle **one window's**
> chrome. Desktop themes restyle **the entire OS**. They are separate
> features with separate registries; everything on this page uses the
> `desktop_theme` / `desktopTheme` naming to keep them apart.

- [The security model](#the-security-model)
- [The Legacy theme — start here](#the-legacy-theme--start-here)
- [ZIP layout](#zip-layout)
- [`theme.json`](#themejson)
- [Tokens](#tokens)
- [Fonts](#fonts)
- [Wallpapers](#wallpapers)
- [Recommended OS settings](#recommended-os-settings)
- [Icons](#icons)
- [Textures](#textures)
- [Texturing your own surface](#texturing-your-own-surface)
- [Value grammar](#value-grammar)
- [Fallback semantics](#fallback-semantics)
- [Installing and activating](#installing-and-activating)
- [Registering a theme from PHP](#registering-a-theme-from-php)
- [Non-goals](#non-goals)

---

## The security model

**A theme is data, never code.** There is no author-supplied CSS and no
author-supplied JavaScript, ever. What actually happens on upload:

1. The archive is walked entry-by-entry **before a single byte is
   written**. Traversal, absolute paths, backslashes, NUL bytes, and
   any extension outside
   `json txt md png jpg jpeg gif webp avif svg woff2 woff ttf otf`
   reject the whole upload. Entry-count and uncompressed-size caps
   apply.
2. The archive extracts into a staging directory.
3. `theme.json` is sanitized field by field. Every asset reference is
   resolved against the staging directory and must land inside it —
   against the **image** extension list for icons, textures and the
   preview, and against the **font** list for `fonts`. The two lists
   are disjoint, so an icon can never resolve to a font file or the
   other way round.
4. Every referenced SVG is parsed with DOMDocument and stripped of
   scripts, embedding elements, `on*` handlers, non-fragment `href`s,
   and `javascript:` / `url()` in style attributes. DTDs and entity
   declarations reject the upload outright. On a server without
   DOMDocument, SVGs are **refused** rather than shipped unexamined.
5. **Only the assets the sanitized manifest actually references** are
   moved into the live directory. Anything else in the ZIP is
   discarded with the staging directory — including `txt` / `md`
   files, which no manifest field can reference and which exist in
   the allowlist purely so an archive may carry the licence notice a
   bundled font obliges you to ship.
6. PHP *compiles* a stylesheet from the sanitized manifest: one rule
   of custom-property declarations, preceded by the `@font-face`
   rules it generated itself. It writes every `url()` from a
   `rawurlencode`d path.

`@font-face` is the only at-rule that ever appears, and no part of it
comes from you verbatim except the family name — which is restricted
to `^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$` precisely so that wrapping it
in double quotes is airtight. The `format()` hint is derived from the
file extension rather than read from the manifest.

The practical consequence for you: if a value isn't in the grammar
below, it silently doesn't apply. That is deliberate, and it is why
this feature can be open to site admins at all.

---

## The Legacy theme — start here

OpenStation ships one theme of its own, called **OpenStation
(Legacy)**, and it is both the way back to the old look and the
fastest way to write your first theme.

Legacy is the shell's pre-brand defaults *written down*: every design
token the chrome and the `<os-*>` component kit read, at the value it
resolved to before [the OpenStation
palette](https://nuriapenya.github.io/open-station-brand/) landed in
`assets/css/variables.css`. Roughly 380 declarations, in one file,
sorted — the WordPress-admin greys and blues, complete.

Two audiences, one file. If you liked the old look, pick it and you
have it back. If you are writing a theme, it saves you the archaeology
of finding out that `--os-ui-fg-muted` used to be `#50575e`, that the
dock glyph sits at 70% white, and that the unfocused close button is
`rgba( 0, 0, 0, 0.45 )` — and it is a complete worked example of every
token the system exposes.

**To write a theme, fork it.** The manifest lives at
`assets/desktop-themes/legacy/theme.json` inside the plugin, and
`npm run package:legacy-theme` writes
`dist/desktop-mode-legacy-theme.zip` — a normal, installable theme
ZIP. Change the `id`, change the `name`, change the twenty values you
care about, delete the rest (whatever you delete keeps its default —
see [Fallback semantics](#fallback-semantics)), and upload.

### It does not move

Legacy is a **snapshot, frozen on purpose**. When OpenStation's own
defaults change — a warmer dock, a different hairline, a new accent
— Legacy goes on declaring exactly what it declares today. Nothing
regenerates it: not the build, not CI, not the plugin at runtime. PHP
reads that one committed file and registers it, and that is the whole
mechanism.

This is the promise the theme is for. Someone who picks Legacy is
asking to keep the look they know, and a manifest that quietly
tracked the code would take it away from them one release at a time
— while also making the theme a no-op again for anyone forking it as
a reference. If a later release drifts far enough to be worth
capturing, that is a *new* snapshot theme under a new id, not a
rewrite of this one.

The practical consequence for you: fork it and you have a stable
floor. Values you keep will still mean what they meant, and values
the shell changes underneath you are exactly the ones your fork is
already pinning.

### It is always there, and it cannot be deleted

Legacy is **code-registered**
([from PHP](#registering-a-theme-from-php)) rather than uploaded, so
it is present on every install and the delete route does not apply to
it — there is no file to remove, and its card carries no delete
button. A site that genuinely does not want it in the picker
unregisters it:

```php
add_action( 'init', function () {
    openstation_unregister_desktop_theme( 'desktop-mode/legacy' );
}, 20 );
```

### What it deliberately leaves out

Legacy declares what is *fixed* about the default look, not what is
*conditional* about it. Four families stay out, each because naming a
literal would make the theme differ from the unthemed shell rather
than reproduce it:

| Left out | Why |
|---|---|
| Anything that follows `--wp-admin-theme-color` — the accent, the focused title bar, window-link splines, the selection ring | They track the user's WordPress admin colour scheme. A hex would pin Midnight and Ectoplasm to Fresh blue. |
| Context-dependent tokens — `--os-fg`, `--os-surface`, `--os-tooltip-bg` / `-fg`, the colour-picker greys | They read light on the desk and dark inside a window. One value breaks one of the two. |
| Derived sizes — the dock / icon / recycle badge families | They size themselves off the icon they decorate, so a literal freezes them against a large dock. |
| Texture-slot properties (`*-image`, `*-border-image-*`) | Those are written by [`textures`](#textures), not by `tokens`. |

If you want one of them, name it in your own theme — Legacy leaving
it undeclared is a statement about *defaults*, not a restriction.

### Two honest caveats

**It is a canonical snapshot, not a byte-for-byte one.** A handful of
palette names were read with slightly different literals at different
sites as the codebase grew — `--os-ui-hover` at 4% in one stylesheet and
6% in another, `--os-ui-surface-elevated` as `#f6f7f7` here and `#fff`
there. Legacy picks one value per name, which is what naming a palette
*means*; wearing it unifies those few near-duplicates rather than
reproducing each of them. Nothing moves and nothing changes contrast.

**It does not take back your accent.** The accent colour is a user
setting (OpenStation Preferences → Appearance), written as an inline style that
outranks every stylesheet, so it is yours rather than any theme's.
Legacy leaves it alone deliberately — pick `WordPress Blue` there if
you want the old accent back with the old palette.

---

## ZIP layout

Either shape works — the manifest may sit at the archive root, or one
directory deep (what "Compress this folder" produces on macOS and
Windows):

```
neon-glass.zip
├── theme.json
├── preview.png
├── LICENSE.txt          <- validated, never installed
├── icons/
│   ├── close.svg
│   ├── settings.svg
│   └── trash.svg
├── fonts/
│   ├── neon-grotesk-400.woff2
│   └── neon-mono-400.woff2
└── textures/
    ├── titlebar.png
    ├── frame.png
    └── desktop.jpg
```

`__MACOSX/` folders and dotfiles are ignored, not rejected. The archive
must contain **exactly one** `theme.json`.

**Re-uploading a theme with the same `id` is an update**, not an
error: the old directory is dropped wholesale so removed assets don't
linger, and every user already wearing it sees the new version on
their next page load.

---

## `theme.json`

```json
{
  "manifestVersion": 2,
  "id": "acme/neon-glass",
  "name": "Neon Glass",
  "version": "1.0.0",
  "author": "Acme Design",
  "description": "Deep indigo glass with a neon rim.",
  "preview": "preview.png",

  "tokens": {
    "--os-titlebar-bg-focused": "#1a1a2e",
    "--os-font": "\"Neon Grotesk\", system-ui, sans-serif"
  },

  "fonts": [
    { "family": "Neon Grotesk", "weight": "400", "display": "swap",
      "src": [ "fonts/neon-grotesk-400.woff2" ] }
  ],

  "iconColor": "currentColor",

  "icons": {
    "OS_SETTINGS":          { "type": "image",    "path": "icons/settings.svg" },
    "WINDOW_CONTROL_CLOSE": { "type": "image",    "path": "icons/close.svg" },
    "APP:edit-php":         { "type": "dashicon", "name": "dashicons-edit-large" }
  },

  "textures": {
    "TITLEBAR":     { "type": "image", "path": "textures/titlebar.png",
                      "repeat": "repeat-x", "size": "auto 100%" },
    "WINDOW_FRAME": { "type": "border-image", "path": "textures/frame.png",
                      "slice": "24 fill", "width": "12px", "repeat": "round" },
    "DESKTOP":      { "type": "image", "path": "textures/desktop.jpg",
                      "size": "cover", "repeat": "no-repeat" }
  },

  "recommendedOsSettings": {
    "dockSize":      "large",
    "desktopLayout": "unified"
  }
}
```

### Fatal fields

Get these wrong and the upload is rejected with a specific message:

| Field | Rule |
|---|---|
| `manifestVersion` | `1` or `2`. |
| `id` | `^[a-z0-9_-]+(/[a-z0-9_-]+)?$`, max 64 chars. Namespacing (`vendor/name`) is encouraged. |
| `name` | Non-empty. |

The storage **slug** is the `id` with `/` flattened to `-`
(`acme/neon-glass` → `acme-neon-glass`). It is what appears in the
compiled selector and the body class.

**On `manifestVersion`.** `2` says nothing about the shape of anything
else on this page — it exists so you can declare that your manifest
carries [`recommendedOsSettings`](#recommended-os-settings), and so a
reader can tell a deliberate omission from an older file. Every v1
manifest keeps working untouched, and a v1 manifest that ships the
block anyway still has it honoured: dropping a valid, sanitized field
over a version number would contradict the drop-and-continue rule the
rest of the sanitizer follows. Write `2` when you recommend settings,
leave `1` alone otherwise.

### Everything else

Optional, and **individually droppable** — see
[Fallback semantics](#fallback-semantics).

| Field | Notes |
|---|---|
| `version`, `author` | Plain text, ≤32 / ≤120 chars. |
| `description` | Plain text, ≤500 chars. |
| `preview` | Path to an image shown on the theme card in OpenStation Preferences. |
| `iconColor` | Default fill for every icon — see [Icon colour](#icon-colour). |
| `wallpaper` / `wallpapers` | One or more pickable wallpapers — see [Wallpapers](#wallpapers). |
| `recommendedOsSettings` | Layout preferences to seed on first activation — see [Recommended OS settings](#recommended-os-settings). |
| `tokens`, `fonts`, `icons`, `textures` | See below. |

---

## Tokens

A map of CSS custom property => value. Three namespaces are accepted;
anything else is dropped, so a theme can never reach a property the
shell didn't mean to expose.

> **Where the defaults live.** `assets/css/variables.css` declares the
> shell's own palette — the [OpenStation
> brand](https://nuriapenya.github.io/open-station-brand/) — scoped to
> `body.os-active`. A theme's compiled selector matches the
> same element and prints after it, so **every token below is yours to
> take** whether or not the shell already has an opinion about it.
> Behind both, every rule in the tree still reads its token as
> `var( --token, <literal> )`, and those literals are the pre-brand
> WordPress-admin values — which is what
> [Legacy](#the-legacy-theme--start-here) collects.
>
> That scope is also why **an admin page inside an iframe window looks
> exactly as it does outside one**: chromeless documents carry
> `body.os-chromeless`, match none of it, and render on the
> literals. See [Non-goals](#non-goals).

| Namespace | What it restyles |
|---|---|
| `--os-*` | The **shell**: dock, desktop, window frame, title bars, corners. |
| `--os-ui-*` | Window **bodies**: the `<os-*>` component kit *and* every feature stylesheet. |
| `--wp-admin-theme-color` | The WordPress admin accent. |

### The `--os-ui-*` UI palette

This is the one that matters most, and the one theme authors most
often miss: **`--os-*` alone restyles the frame around a
window and nothing inside it.** Window bodies — the Settings panel,
the Posts table, the Trash, file tiles, every dialog — read the
`--os-ui-*` palette. A theme that sets only the shell tokens produces a
dark frame around a white page.

| Token | Role |
|---|---|
| `--os-ui-surface` | Cards, panels, table rows |
| `--os-ui-surface-elevated` | Headers, raised strips |
| `--os-ui-surface-sunken` | Wells, recessed areas |
| `--os-ui-fg` | Body text |
| `--os-ui-fg-muted` | Secondary text, metadata |
| `--os-ui-fg-faint` | Disabled text |
| `--os-ui-fg-on-accent` | Text on a filled accent / danger surface |
| `--os-ui-border` | Hairlines |
| `--os-ui-border-strong` | Emphasized dividers |
| `--os-ui-hover` | Row / tile hover wash |
| `--os-ui-scrim` | Modal + overlay backdrop |
| `--os-ui-accent` | Primary action |
| `--os-ui-accent-strong` | Its hover / active state |
| `--os-ui-danger`, `--os-ui-danger-hover` | Destructive actions |
| `--os-ui-warning-fg`, `--os-ui-warning-bg`, `--os-ui-warning-border` | Warning notices |
| `--os-ui-info-fg`, `--os-ui-info-bg` | Info notices |
| `--os-ui-success-fg` | Success text |

Individual components expose finer-grained tokens on top of these
(`--os-ui-button-bg`, `--os-ui-card-bg`, `--os-ui-table-header-bg`, …) —
around 190 in all, each documented next to its component in
`src/ui/components/<name>/<name>.styles.ts`. **Every one of them falls
through to the palette above**, e.g.

```css
background: var( --os-ui-card-bg, var( --os-ui-surface, #fff ) );
```

so setting `--os-ui-surface` alone restyles cards, flyouts, menus,
tables and the rest. Reach for a component-local token only when you
want that one component to differ — it still wins when set. Any
`--os-ui-*` name is accepted by the manifest.

**These tokens have no default value.** Every consuming site reads
them as `var( --os-ui-x, <its own literal> )`, which is why an unthemed
shell looks exactly as it always did and why one theme value retints
a whole family at once.

That includes the ones inside a component's shadow DOM. A component
declaring `--os-ui-table-bg` on its own `:host` would make the name
unreachable — a declaration on the element beats anything the element
*inherits*, and your theme declares on an ancestor — so components read
their public tokens into private aliases instead. The one exception is
`<os-modal>`, whose dialog surface is dark whatever the admin colour
scheme says: it re-points `--os-ui-fg`, `--os-ui-fg-muted`, `--os-ui-border`
and `--os-window-bg` inside the dialog, and gives you
`--os-ui-modal-text`, `--os-ui-modal-text-muted`, `--os-ui-modal-border` and
`--os-ui-modal-field-bg` to set them by.

The palette is not limited to window bodies: the shell's own
body-mounted overlays — toasts, confirm dialogs, context menus, and
the **command palette / Site Assistant** (⌘K) — read it too, because
they render inside the `body.os-desktop-theme-<slug>` half
of the compiled selector. Set `--os-ui-surface` and the `--os-ui-fg`
family and the palette panel follows without any extra work.

A dark theme's minimum viable body palette:

```json
"tokens": {
  "--os-ui-surface":          "#161634",
  "--os-ui-surface-elevated": "#1e1c44",
  "--os-ui-surface-sunken":   "#101026",
  "--os-ui-fg":               "#e9e7ff",
  "--os-ui-fg-muted":         "#a5a1cc",
  "--os-ui-fg-faint":         "#6f6b99",
  "--os-ui-border":           "#2f2a63",
  "--os-ui-border-strong":    "#453e8c",
  "--os-ui-hover":            "rgba( 124, 92, 255, 0.16 )",
  "--os-ui-scrim":            "rgba( 6, 4, 24, 0.68 )"
}
```

### The holographic tokens

The kit has one more family, and it is the one that decides how a
control looks at the moment it is *on*. A switch that is on, a checked
checkbox, the selected segment, the filled part of a progress bar and
the step-number chip all paint `--os-ui-holo-fill` — by default the
brand's Holomesh, transcribed into CSS in `--os-mesh-holo`.

| Token | Role |
|---|---|
| `--os-ui-holo-fill` | What an on / selected / filled surface paints. |
| `--os-ui-holo-ink` | Glyphs and text on that fill. |
| `--os-ui-holo-sheen` | The hover film over a surface that is *not* lit. |
| `--os-ui-holo-edge`, `--os-ui-holo-edge-quiet` | The iridescent hairline, lit and at rest. |
| `--os-ui-holo-glow`, `--os-ui-holo-glow-strong` | The bloom around a lit surface. |
| `--os-ui-holo-track` | The unlit half — switch tracks, empty progress. |
| `--os-ui-accent-dim` | The accent, one step back. Every *ambient* use of it — glows, washes, focus blooms — resolves through this, so it is the single knob for how loud a theme reads. |
| `--os-ui-focus-ring` | Focus on a *target*: buttons, switches, checkboxes, swatches. |
| `--os-ui-focus-ring-field` | Focus on a *field*: quieter, tightens the input's own border. |
| `--os-ui-holo-transition` | Duration for every holographic transition in the kit. |

And the motion scale, which is worth setting as a group or not at all — a theme that changes one duration gets a panel where the controls disagree about how fast they are:

| Token | Role |
|---|---|
| `--os-ui-motion-fast` | A state flip with no travel: a colour, an opacity, a tick. |
| `--os-ui-motion-slow` | Something crossing a distance: a thumb, a drawer, a card. |
| `--os-ui-motion-ambient` | An ambient loop — a shimmer, a drift. |
| `--os-ui-ease-spring` | Overshoots and settles. Wrong for anything that changes *size*. |
| `--os-ui-ease-out` | Decelerating. The default for anything arriving. |
| `--os-ui-ease-loop` | Symmetric, for a loop that returns where it started. |

Setting all three durations to `1ms` is a supported way to build a still theme; every fragment in the kit already does exactly that under `prefers-reduced-motion`.

Setting `--os-ui-holo-fill` alone retints every one of those surfaces
at once, which is the shortest route to a theme that does not look
like OpenStation. A flat colour works:

```json
"tokens": {
  "--os-ui-holo-fill": "#7c5cff",
  "--os-ui-holo-ink":  "#ffffff"
}
```

**Change the ink when you change the fill.** The default ink is Void,
because every mesh in the brand is a *light* surface — a dark fill with
the default ink is near-black on near-black, and it looks fine in a
screenshot of the off state.

The five meshes themselves (`--os-mesh-holo`, `--os-mesh-pulse`,
`--os-mesh-auro`, `--os-mesh-star`, `--os-mesh-mio`) are also settable,
and are the right lever when you want your own gradient everywhere the
brand's would have gone. `--os-mesh-mio` belongs to the mascot; retint
it and Mio changes with the rest of the station, which may or may not
be what you meant.

### Shell tokens

`--os-*` names must match `^--os-[a-z0-9-]+$`.
Read `assets/css/variables.css` for the full set.

> **Set `--os-backstop` if your desk is light.** It is the
> flat colour painted on the shell behind every other layer, including
> the wallpaper. Nothing is normally seen through it — it exists so
> that a frame in which some layer fails to paint shows the desk's own
> colour rather than the white admin page the shell sits over. It
> defaults to the dark `#1d2327`, which would read as a dark blink on a
> light theme.

> **The icon grid is a token set, and it is one grid.**
> `--os-tile-w` / `--os-tile-h`, `--os-grid-gap-x` / `--os-grid-gap-y`
> and `--os-grid-padding` describe every surface that lays out
> placements: the wallpaper, folder windows, and each canvas in the
> WP Explorer. Widen a gap and all of them widen together — that is
> the point of them being one declaration.
>
> The **cell pitch is derived, never declared**: `cell = tile + gap`.
> The layout maths can't read CSS, so `src/desktop-files/grid.ts`
> mirrors these numbers and `tests/vitest/grid-metrics.test.ts` parses
> the stylesheet to prove the mirror is faithful. A theme retuning
> them shifts the *visual* spacing; stored icon coordinates snap to
> the new pitch the next time a tile is dragged or the canvas is
> sorted, so expect a one-time reshuffle rather than an instant
> re-layout. `--os-tile-w-large` / `--os-tile-h-large` do the same job
> for image-led sections (`tileSize: 'large'`).

> **`--os-window-radius` is not one of them in practice.**
> The Window-corners preset in OpenStation Preferences writes that property as an
> inline style on the shell root, which outranks any stylesheet rule,
> so a theme declaring it in `tokens` has no effect on windows. The
> user's corner preference stays the user's. If your frame artwork
> needs a particular radius, ask for it through
> [`recommendedOsSettings.windowRadius`](#recommended-os-settings) —
> that sets their preference once, on first activation, and leaves it
> theirs to change.

```json
"tokens": {
  "--os-window-bg": "#12122a",
  "--os-window-border": "#2b2b52",
  "--os-titlebar-bg": "#171733",
  "--os-titlebar-bg-focused": "#241f4d",
  "--os-titlebar-color": "#a8a8c0",
  "--os-dock-bg": "rgba( 12, 12, 30, 0.72 )",
  "--wp-admin-theme-color": "#7c5cff"
}
```

#### Window reveal

One token owns the surface a window's content is uncovered from once it
finishes loading (OpenStation Preferences → Effects → "Window reveal"):

| Token | Role |
|---|---|
| `--os-window-reveal-surface` | Fill of the receding reveal surface. White by default |
| `--os-window-reveal-edge` | Fill of the band trailing the reveal's clip boundary. `transparent` by default |
| `--os-window-reveal-edge-thickness` | How wide that band is. Undeclared by default |
| `--os-window-reveal-duration` | How long a reveal runs. Undeclared by default |

```json
"tokens": {
  "--os-window-reveal-surface": "#12122a",
  "--os-window-reveal-edge": "#7c5cff",
  "--os-window-reveal-edge-thickness": "12%",
  "--os-window-reveal-duration": "620ms"
}
```

**Surface** is **white** by default. It has to be opaque or there is
nothing to reveal *from* — the content would simply be visible the
whole time and the clip animation would paint nothing. Set it to
`var( --os-window-bg )` to follow your window colour, or to a
brand colour, a gradient, or an image; the surface is a plain element
and the animation clips it rather than recolouring it. `transparent` is
also a legitimate value, meaning "no covering surface" — the shell then
skips the layer rather than animating something invisible.

One reveal ignores this token: **Camera shutter** paints its own
near-black blades, because in any other colour it stops being a camera
shutter.

**Edge** is the band that travels with the clip boundary and draws each
reveal's shape — six lines on Blinds, an opening ring on Iris, a
rotating spoke on Radar. It is **`transparent` by default**: the reveal
reads as the page arriving, and a hard graphic edge on top of that is a
deliberate look rather than the neutral one. Give it a colour and the
band turns on for every reveal the user might pick, yours or a
plugin's, with nothing else to configure — the band follows whatever
shape the active reveal has. While the token computes transparent the
shell skips the layer entirely, so leaving it alone costs nothing.

Gradients and images work as well as flat colours.

**Edge thickness** takes either a fraction of the reveal's *travel* —
`12%`, or the equivalent unitless `0.12` — or an absolute time like
`70ms`. Prefer the fraction: the band then holds its apparent width at
any reveal speed and any window size, because its width is a share of
how far the shape moves rather than a span of time. Undeclared by
default, in which case each reveal's own `edgeLag` decides; declare it
and it wins outright, since thickness is a property of your look rather
than of any one reveal. `0%` suppresses the band while leaving the
colour in place.

**Duration** is **undeclared by default** and accepts `620ms`, `0.62s`,
or a bare `620` (read as ms). It sets the house pace for every reveal
the user might pick — but a user who has chosen a speed in OpenStation Preferences
→ Effects out-ranks it, the same way the window-corner preset out-ranks
a theme's `--os-window-radius`. Their choice stays theirs.

#### Tooltips

Two shell tokens own every tooltip in the shell — the dock tile
tooltip, the content-graph satellite tooltip, and WP Explorer
entity hover card:

| Token | Role |
|---|---|
| `--os-tooltip-bg` | The tooltip chip / card surface |
| `--os-tooltip-fg` | Its primary text |

```json
"tokens": {
  "--os-tooltip-bg": "#1e1c44",
  "--os-tooltip-fg": "#e9e7ff"
}
```

They are worth setting explicitly. Without them, tooltips fall back
to colours borrowed from other families — `--os-ui-scrim` or
`--os-ui-surface-elevated` for the surface, `--os-ui-fg-on-accent` for the
text — and those pairings come apart under a custom palette. Set
`--os-ui-scrim` to a translucent wash for your modals and the dock
tooltip goes translucent with it; keep a light `--os-ui-surface-elevated`
next to a white `--os-ui-fg-on-accent` and the satellite tooltip renders
white text on a white chip. Neither was fixable from the palette alone,
because fixing it would have broken the modal backdrop or the text on
accent-filled buttons.

Both tokens are **undeclared by default**, so a theme that ignores
them keeps the tooltip look the shell has always had.

Secondary text inside the richer tooltips — the hover card's excerpt —
still follows `--os-ui-fg-muted`; these two cover the surface and the
primary text on it.

#### Dock glyphs

`--os-dock-bg` repaints the strip. These four repaint what
sits *on* it:

| Token | Role |
|---|---|
| `--os-dock-icon-color` | The glyph at rest |
| `--os-dock-icon-color-hover` | The glyph on hover / peek |
| `--os-dock-item-bg-hover` | The wash behind a hovered tile |
| `--os-dock-item-outline` | The keyboard focus ring and the tile status indicator (active dot, all-minimized ring) |

```json
"tokens": {
  "--os-dock-bg": "rgba( 244, 243, 255, 0.86 )",
  "--os-dock-icon-color": "rgba( 26, 22, 58, 0.72 )",
  "--os-dock-icon-color-hover": "#12102b",
  "--os-dock-item-bg-hover": "rgba( 26, 22, 58, 0.1 )",
  "--os-dock-item-outline": "rgba( 26, 22, 58, 0.65 )"
}
```

**Set them whenever your dock is pale.** The four literals behind
these tokens are all white — a glyph at 70%, brightening to full on
hover, over a 15% white wash, with a 70% white focus ring, which also
paints the status marks on the tile: the solid dot under the running
or focused tile and the hollow ring under one whose windows are all
minimized. That reads against the default translucent-black strip and
disappears the moment you give the dock a light background.
Recolouring the strip alone is the most common way a first theme ends
up with an invisible dock.

Two more cover the **deck tabs** — the strip at the leading edge of a
bottom rail that names the group of tiles currently on screen (see
[Dock decks](javascript-reference.md#dock-decks)):

| Token | Role |
|---|---|
| `--os-dock-deck-fill` | The fill behind the active tab. Falls back to `--os-ui-holo-fill`, the brand mesh |
| `--os-dock-deck-ink` | Its label and glyph. Falls back to `--os-ui-holo-ink`, near-Void |

The inactive tabs deliberately have no tokens of their own: they read
through `--os-dock-icon-color` and `--os-dock-item-bg-hover`, the same
two the tiles beside them use, so a theme that recoloured its dock
glyphs gets the strip for free. **Set the pair together or not at
all** — an active tab with a repainted fill and default Void ink is
the one combination that can end up unreadable.

One more tunes how a deck switch *moves*:

| Token | Role |
|---|---|
| `--os-dock-deck-slide` | `<duration> <easing>` for the whole switch |
| `--os-dock-deck-idle-opacity` | How far the *unselected* tabs stand back (default `0.6`). Transparency rather than a dimmer ink, so the dock's surface comes through them; hover takes one back to full |

Everything a switch moves is on that single token: the tabs sliding
so the selected one lands at the trailing end of the strip, its name
unfurling to widen it, the outgoing tiles collapsing to zero width,
the incoming ones opening back out — and, since the pill is
`width: fit-content`, the pill resizing and re-centring around all of
it. The mesh fill itself is the one thing that does not move; it is
anchored at that trailing end and only its leading edge breathes as
labels of different lengths pass under it.

**One token rather than several is the design, not a shortcut.** An
earlier pass gave the tiles their own duration and their own staggered
entrance; the result was two clocks in one gesture, and the faster one
always read as the thing going wrong. It is deliberately slower than
the rest of the rail — this is the one dock state change worth
watching rather than just registering — so shorten it for a snappier
rail, and set `0s` to remove the choreography without losing any of
the state it carries.

`--os-dock-icon-color` is a **colour**, not a fill, which
matters if your iconset uses
[`"iconColor": "currentColor"`](#icon-slots): those icons are masked
with the glyph colour, so this single token drives dashicons, your own
artwork, and the hover transition together.

System tiles — OpenStation Preferences, the recycle bin, and their neighbours —
read the same `--os-dock-icon-color`. Unthemed they sit one
notch brighter than menu tiles; once you name a colour they join the
rest rather than staying stranded white.

This reaches **plugin and custom-post-type artwork too**, not just
dashicons and your own iconset. The dock has always flattened those
SVGs to one colour so a brand mark can't shout over its neighbours;
they are now flattened by a `currentColor` mask rather than by a
force-to-white filter, so they land on your glyph colour like
everything else. A URL the mask can't take — one carrying literal
quotes, spaces or parens — still falls back to the white filter.

All four are **undeclared by default**, so a theme that ignores them
keeps the dock the shell has always had.

### A note on WordPress core's CSS

Native windows render in the parent shell, not in an iframe, so
`wp-admin`'s own stylesheets reach into their content. Core styles a
few things with **bare element selectors** — `h1`, `h2`, `h3`, `a`,
`code` — which means a heading inside a themed window inherited
core's `#1d2327` regardless of your palette.

The shell now re-points those at the palette (see the specificity
note in `assets/css/window-chrome.css`), so headings follow
`--os-ui-fg`, links follow `--os-ui-accent`, and `<code>` follows
`--os-ui-surface-sunken`. Nothing is needed from a theme author — but
it explains why a heading might once have looked "stuck".

Raw form controls (`input`, `textarea`, `select`) are the known
exception: core styles those with attribute selectors that carry real
specificity, and native windows use the `<os-*>` components instead.
If you build a native window with raw form controls, style them
yourself.

The framework's own raw controls are already handled — window bodies
get a tokenized override in `assets/css/window-chrome.css`, and the
command palette's search field gets one in
`assets/css/ai-assistant.css`. Both out-specify core's
`input[type="…"]` rules and fall back to core's values, so nothing
changes without a theme.

### Typography tokens

Four tokens carry the shell's typefaces. Like the palette they are
**undeclared by default** — every rule reads
`font-family: var( --token, <the literal that was always there> )` —
so an unthemed shell renders exactly as it always did.

| Token | Applies to |
|---|---|
| `--os-font` | Shell chrome: dock labels, desktop icon labels, widgets, the overview |
| `--os-titlebar-font` | Window title bars. Falls back to `--os-font` |
| `--os-ui-font` | Window **bodies** and the whole `<os-*>` component kit |
| `--os-ui-font-mono` | Code, hashes, file sizes, log output |

The chrome / body split is the one real decision here, and it is the
one real desktop environments make: a display face on the title bars
and dock, a comfortable text face inside windows.

```json
"tokens": {
  "--os-font":          "\"Neon Grotesk\", system-ui, sans-serif",
  "--os-titlebar-font": "\"Neon Grotesk\", system-ui, sans-serif",
  "--os-ui-font":                   "\"Neon Grotesk\", system-ui, sans-serif",
  "--os-ui-font-mono":              "\"Neon Mono\", ui-monospace, monospace"
}
```

Always end a stack with a generic family. If the bundled face fails
to load — a slow network, a `unicodeRange` that doesn't cover the
user's script — that fallback is what they read.

Setting these tokens does **not** require bundling a font. A stack of
system faces (`"Iowan Old Style, Palatino, serif"`) is a complete,
zero-byte way to change how the OS reads. Bundle a font only when you
need one that isn't there.

### What stays fixed

Colour that encodes meaning or is composed artwork is deliberately
**not** themable: pinned-note paper, game palettes, the content-graph
node hues, the About scene. Retinting those would destroy the signal
they carry. The same applies to their typography — the note's
handwriting face and the Inkfall serif are part of the artwork.

---

## Fonts

A theme may bundle typefaces. Each entry in `fonts`
becomes one `@font-face` rule, generated by PHP from your descriptor.

```json
"fonts": [
  { "family": "Neon Grotesk", "weight": "400", "style": "normal",
    "display": "swap",
    "src": [ "fonts/neon-grotesk-400.woff2", "fonts/neon-grotesk-400.woff" ] },

  { "family": "Neon Grotesk", "weight": "700", "style": "normal",
    "display": "swap",
    "src": [ "fonts/neon-grotesk-700.woff2" ] }
]
```

Declaring a face does not *use* it. Point a
[typography token](#typography-tokens) at the family, or nothing
changes — the browser downloads a face only when something asks for
it, so an unreferenced face costs no bytes.

### Fields

| Field | Rule |
|---|---|
| `family` | **Required.** `^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$`. Letters, digits, spaces, `_`, `-`. Nothing else — see [the security model](#the-security-model). |
| `src` | **Required.** A path, or a list of paths in preference order. `{ "path": "…" }` objects work too. Extensions: `woff2`, `woff`, `ttf`, `otf`. |
| `weight` | One or two of `normal` / `bold` / an integer 1–1000. Two values declare a variable-font range (`"100 900"`). |
| `style` | `normal`, `italic`, `oblique`. |
| `display` | `auto`, `block`, `swap`, `fallback`, `optional`. |
| `stretch` | A `*-condensed` / `*-expanded` keyword, `normal`, or one to two percentages. |
| `unicodeRange` | `U+xxxx` ranges, comma separated, up to 32. |

The `format()` hint is derived from the extension — don't supply one,
it is ignored.

### Caps

16 faces per theme, 4 sources per face, 8 MB per file, 32 MB per
archive. Both face caps are filterable
(`openstation_desktop_theme_font_caps`).

### Practical notes

- **Ship `woff2`.** Every browser OpenStation targets supports it,
  and it is roughly half the size of `woff`. A `woff` second source is
  belt and braces; `ttf` / `otf` are accepted but rarely worth the
  bytes.
- **Subset.** A full Unicode face is megabytes. Latin-1 plus the
  punctuation you actually use is usually 15–30 kB. Declare what you
  subsetted to in `unicodeRange` so the browser can skip the download
  for text the face can't render.
- **`display: swap`** paints fallback text immediately and swaps when
  the face arrives. On admin chrome that is almost always right —
  `block` hides your dock labels while the font loads.
- **Licensing is yours.** A font you bundle is redistributed to every
  visitor of the site that installs the theme, and to whoever you hand
  the ZIP to. Ship one whose licence permits that, and put the notice
  in a `LICENSE.txt` inside the archive (the allowlist accepts `txt`
  and `md` for exactly this; they are never installed on the server).
- **Fonts reach the shell and native windows, not iframes.** An
  iframe window renders a real `wp-admin` document in its own browsing
  context, which the theme stylesheet does not enter. Your typeface
  restyles the desk, the dock, every title bar, and every native
  window body; the admin page inside an iframe keeps the admin's font.

---

## Wallpapers

** A theme may ship wallpapers. Each one appears in
**OpenStation Preferences → Wallpaper** as an ordinary pick, labelled
`<theme name> - (theme)` — or `<theme name>: <label> - (theme)` when
the theme ships more than one.

```json
"wallpapers": {
  "deep-field":   { "path": "wallpapers/deep-field.jpg",
                    "label": "Deep Field",
                    "description": "Violet light across a star field." },
  "grid-horizon": { "path": "wallpapers/grid-horizon.jpg",
                    "label": "Grid Horizon" }
}
```

### It is a pick, not an act

Applying a theme does **not** change the user's wallpaper, which is
where we deliberately part company with macOS and Windows.

A wallpaper here is a stored user preference. For theme activation to
swap it, we would have to either overwrite that preference silently or
keep a shadow record of "what they had before" to restore later — and
both are worse than simply putting the theme's artwork where the user
already goes to change wallpapers.

The upside is real: a theme's wallpaper can be worn **without** the
theme, and wearing the theme never costs a user the wallpaper they
chose. Every theme in the library contributes its wallpapers, not just
the active one.

> This is separate from the `DESKTOP` texture slot. That slot follows
> the theme and layers *over* whatever wallpaper is active; a wallpaper
> here is a picture the user selects.

### Four shapes, all accepted

```json
"wallpaper":  "wallpapers/desk.jpg"
"wallpaper":  { "path": "wallpapers/desk.jpg", "size": "cover" }
"wallpapers": [ "a.jpg", { "path": "b.jpg", "label": "Dusk" } ]
"wallpapers": { "dusk": { "path": "b.jpg" } }
```

`wallpaper` and `wallpapers` are interchangeable keys. A map's keys
become the wallpaper ids.

### Fields

| Field | Rule |
|---|---|
| `path` | **Required.** Image inside your ZIP (absolute URL for a code theme). |
| `label` | Shown in the picker after the theme name. Recommended once you ship more than one. |
| `id` | Explicit id. See the stability note below. |
| `description` | Shown in OpenStation Preferences when this wallpaper is selected. Falls back to the theme's description. |
| `size` | `cover` (default), `contain`, `auto`, or lengths. |
| `repeat` | `no-repeat` (default) or any `background-repeat` keyword. |
| `position` | `center center` (default), keywords, lengths, or percentages. |

Twelve per theme, filterable via
`openstation_desktop_theme_max_wallpapers`.

### Ids are a stored preference — keep them stable

The user's choice persists by id, so an id is derived from something
that survives an edit, **never the array position**: an explicit `id`,
then the map key, then a slug of `label`, then the image's filename.

Reordering your list is therefore safe. Renaming a file, or changing a
`label` that was supplying the id, is not — do that and anyone using
that wallpaper falls back to the default. Set `id` explicitly if you
expect either to change.

---

## Recommended OS settings

Some themes are designed against an arrangement, not just a palette: a
wide dock because the tiles carry artwork, a unified bottom bar
because the desktop is meant to read as one surface, square corners
because the frame texture has its own. `recommendedOsSettings` lets
that intent travel with the theme instead of living in a setup guide.

```json
"recommendedOsSettings": {
  "dockSize":             "large",
  "desktopLayout":        "unified",
  "windowRadius":         "default",
  "adminBarMode":         "dynamic",
  "dockRailRenderer":     "default",
  "windowReveal":         "iris",
  "windowRevealDuration": 620
}
```

### They are recommendations, and "once" is the whole contract

**A theme arranges the desktop once — the first time that user
activates it — and never again.**

- Applied on **activation**, never on page load. There is no pass that
  re-asserts a theme's preferences behind the user's back.
- Applied **once per user, per theme**. The shell records the theme in
  the user's `appliedThemeRecommendations` ledger; a second activation
  of a theme they have already worn changes nothing.
- **A later change by the user always wins.** Pick the theme, put the
  dock back to compact, re-pick the theme — it stays compact.

The way back is the user's to take: **OpenStation Preferences → Themes** shows an
**Apply &lt;theme&gt;'s recommended layout and effects** button for the
active theme when it recommends something, and that is the only path
that applies a recommendation a second time. It sets the settings and
nothing else — the dock resizing under the cursor is the feedback.

This is the same posture as [wallpapers](#it-is-a-pick-not-an-act),
for the same reason. Dock size and layout are stored user
preferences, and a theme that could silently overwrite them on every
load would be taking something the user chose.

### Fields

Every field is optional. A field you don't name is not touched, and
one you name with a value outside its set is dropped while the rest
still apply.

| Field | Values |
|---|---|
| `dockSize` | `compact`, `default`, `large` |
| `desktopLayout` | `classic`, `unified`, `spatial`, `openstation` |
| `dockPlacement` | `bottom`, `left`, `right` — which edge the dock sits on. Read by `unified` and `spatial`; `classic` owns both of its edges and `openstation` is drawn for a horizontal rail, so both ignore it. |
| `windowRadius` | `sharp`, `default`, `round` |
| `adminBarMode` | `static`, `dynamic`, `hidden` — how the WordPress admin bar presents above the shell. `dynamic` parks it off the top edge behind a peek strip that reveals on hover or keyboard focus; `hidden` removes it, leaving the dock's **Exit OpenStation** tile as the route back to classic admin. A theme wanting an edge-to-edge desk recommends one of the two. |
| `dockRailRenderer` | A registered dock rail renderer id. Core ships `default`; plugins register their own. |
| `windowReveal` | A registered window-reveal id — the transition that uncovers a window's content once it loads. Core ships twelve (`sweep`, `rise`, `diagonal`, `iris`, `diamond`, `curtain`, `shutter`, `blinds`, `slats`, `mosaic`, `radar`, `obturator`); `none` is always valid and means no transition. |
| `windowRevealDuration` | How long reveals run, in whole ms. Clamped to 80–4000. Omit it to leave the user's speed alone — recommending `0` is not a way to say "default". |
| `accent` | A registered accent-swatch id (OpenStation Preferences → Appearance). Core ships `pulse`, `nebula`, `wp-blue`, `indigo`, `teal`, `emerald`, `amber`, `rose`; sites extend the list through `openstation_accent_colors`. |

**`accent` is the one recommendation a theme cannot express any other
way, and most themes want it.** The accent is a user setting written as
an inline style on the shell document, which outranks every stylesheet
— so a manifest can restyle the entire OS through `tokens` and still
leave WordPress blue on every focus ring, tab underline, sort arrow and
selection wash. Declaring `--wp-admin-theme-color` in `tokens` does not
help: it is dropped, because the accent belongs to the user rather than
to the theme. Recommending it is how a palette says "and this hue with
it", once, on first activation.

The built-in **Desktop Mode (Legacy)** theme is the worked example —
its whole recommendation block is `{ "accent": "wp-blue" }`, which is
what makes the pre-brand chrome come back complete.

`dockRailRenderer`, `windowReveal` and `accent` are the fields validated in
two places: PHP checks the charset, and the shell checks — at apply
time — that something is actually registered under that id. Recommend
a renderer, reveal or swatch a site doesn't have and the key is
skipped; the rest of your recommendations still apply.
(`windowReveal: "none"` is exempt: it is the "no reveal" sentinel
rather than a registration.)

`windowRevealDuration` is the one **numeric** recommendation, and it is
**clamped rather than dropped** — a theme asking for something slower
than the shell will play is expressing "slow", and the nearest playable
duration is the honest reading of that.

Nothing else is reachable. The allow-list is presentation only, so a
manifest cannot flip a feature toggle, a capability-adjacent
preference, or another theme's activation. A site can widen the list
through `openstation_desktop_theme_recommended_os_settings_schema`
— `{ enum }` for a closed set, `{ slug }` for a registry id resolved
at apply time, `{ int => { min, max } }` for a clamped number — and
even then the shell only writes a key that already exists and whose
current value has the same type as the one being recommended.

### What a user actually sees

They pick your theme and the dock and layout move into the
arrangement you designed. That movement is the whole feedback — the
shell does not editorialize about it — and it does not happen again
for that theme. Anything they change afterwards in Appearance is
theirs and stays.

---

## Icons

A map of **slot** => icon descriptor. Two descriptor shapes:

```json
{ "type": "image",    "path": "icons/close.svg" }
{ "type": "dashicon", "name": "dashicons-no-alt" }
```

`path` must be a relative path inside your ZIP, with an image
extension. `name` must match `^dashicons-[a-z0-9-]+$`.

### Slot table

| Group | Slots |
|---|---|
| Window controls | `WINDOW_CONTROL_MINIMIZE`, `WINDOW_CONTROL_MAXIMIZE`, `WINDOW_CONTROL_FULLSCREEN`, `WINDOW_CONTROL_FULLSCREEN_EXIT`, `WINDOW_CONTROL_CLOSE`, `WINDOW_CONTROL_MENU`, `WINDOW_CONTROL_RELOAD`, `WINDOW_CONTROL_DETACH` |
| System tiles | `OS_SETTINGS`, `RECYCLE_BIN`, `BUG_REPORT`, `EXIT_OPENSTATION`, `PWA_INSTALL` |
| Apps | `DEFAULT_APP_ICON`, plus `APP:<slug>` for any individual dock tile, desktop icon, or native window id. These reach the dock and the desktop; the window title bar carries the status ring rather than an app icon, so it is not one of the surfaces they paint |
| Desktop files | `FOLDER`, `FILE_SHORTCUT`, `FILE_POST`, `FILE_ATTACHMENT`, `FILE_UPLOAD`, `FILE_USER`, `FILE_TERM`, `FILE_COMMENT`, `FILE_BOOKMARK`, `FILE_LINK`, `FILE_EMBED` |
| Recycle-bin row actions | `RECYCLE_RESTORE`, `RECYCLE_DELETE` |

`APP:<slug>` slugs are the tile ids the shell uses — `APP:edit-php`,
`APP:upload-php`, `APP:my-plugin-dashboard`. The quickest way to find
one is the browser console:

```js
wp.os.getMenuItems().map( ( i ) => i.id );
```

### Icon colour

**The single most useful line in a theme manifest:**

```json
"iconColor": "currentColor"
```

It applies to every icon that doesn't set its own, and it does more
than recolour — it changes how an image icon is *painted*:

| `color` | Image icons render as | Your artwork's colours |
|---|---|---|
| absent | plain `<img>` | **kept** as authored |
| set | a CSS **mask** filled with your colour | **discarded** — alpha only |

Which is why `currentColor` is the workhorse. Every surface in the
shell already sets a text colour that suits it: the dock dims its
glyphs and brightens them on hover, the title bar swaps on focus, file
tiles follow `--os-tile-fg`, a danger-hover goes red. A
masked icon filled with `currentColor` inherits all of that. One
monochrome silhouette set, drawn in any colour you like, reads
correctly everywhere.

Without it, a black-stroked iconset looks perfect in isolation and
then **disappears against your own dark dock** — the single most
common way a first theme goes wrong.

Per-slot overrides take a real colour, which is right when the colour
*is* the meaning:

```json
"iconColor": "currentColor",
"icons": {
  "OS_SETTINGS":       { "type": "image", "path": "icons/settings.svg" },
  "EXIT_OPENSTATION": { "type": "image", "path": "icons/exit.svg",
                         "color": "#ff6b81" },
  "BUG_REPORT":        { "type": "image", "path": "icons/bug.svg",
                         "color": "#ffcf70" },
  "APP:my-brand":      { "type": "image", "path": "icons/brand.svg",
                         "color": "none" }
}
```

`"color": "none"` is the opt-**out**: it keeps one multi-colour icon —
a brand mark, an app tile with real artwork — rendering as an `<img>`
inside an otherwise-tinted set, without giving up the manifest-wide
default.

Accepted values: `currentColor`, hex (3/4/6/8 digits), the functional
notations (`rgb()`, `rgba()`, `hsl()`, `oklch()`, …), a bare CSS
colour keyword, or `none`. Dashicons take the colour too — they are
font glyphs, so the tint is simply their `color`.

**Two slot groups always mask,** with or without a `color`:
`WINDOW_CONTROL_*` and the two `RECYCLE_*` row actions. They default
to `currentColor` so a themed close button still turns white on a
focused title bar and red on danger-hover. Naming an explicit colour
there is an opt-out of that state tinting — the glyph then holds one
colour throughout, which is occasionally what you want and usually
not.

**Design consequence:** if you are tinting, draw silhouettes. Only the
alpha channel survives, so a stroke colour in the source SVG is
irrelevant — pick whatever is easiest to see while you work.

### Window control glyphs are monochrome

Control buttons paint an `image`-type icon as a **CSS mask tinted with
`currentColor`**, not as an `<img>`. That is what keeps a themed close
button turning white on a focused title bar and red on danger-hover,
exactly like the built-in glyphs — an image would paint its own colours
and go deaf to the title bar's focused/unfocused state.

**So: only the alpha channel of the source image is used.** Design
control glyphs as solid silhouettes. Colour in them is discarded.

The same applies to the two recycle-bin row-action slots. Those also
ignore `dashicon`-type descriptors entirely — `<os-table>` renders
into a shadow root the global Dashicons stylesheet can't reach, so a
dashicon would come out blank and the built-in SVG is used instead.

---

## Textures

A map of **slot** => texture descriptor. Every slot is optional and
individually droppable; a surface you don't mention keeps its colour.

**Window chrome**

| Slot | Type | Paints on |
|---|---|---|
| `TITLEBAR` | `image` | Every window title bar |
| `TITLEBAR_FOCUSED` | `image` | The focused window's title bar (falls back to `TITLEBAR`) |
| `WINDOW_FRAME` | `border-image` | The window frame — replaces the 1px border |
| `WINDOW_FRAME_FOCUSED` | `border-image` | The focused window's frame (falls back to `WINDOW_FRAME`) |
| `WINDOW_CORNER_NE` / `_NW` / `_SE` / `_SW` | `image` | Corner ornaments on the resize handles |
| `WINDOW_BODY` | `image` | The window content area, behind native content |
| `TABBAR` | `image` | The in-window submenu tab strip |
| `TITLEBAR_CONTROLS` | `image` | The plate behind the window-control cluster |
| `TITLEBAR_BUTTON` | `image` | The face of each individual control button |

**Shell**

| Slot | Type | Paints on |
|---|---|---|
| `DESKTOP` | `image` | The wallpaper layer |
| `DOCK` | `image` | The dock strip, layered over its background colour |
| `DOCK_ITEM` | `image` | The face of a single dock tile |
| `ICON_TILE` | `image` | The plate behind each desktop icon |
| `WIDGET` | `image` | Desktop widget cards, over the frosted backdrop |

**Component kit** — these paint inside window bodies and in the
popovers that mount on `<body>`, so one slot reaches every instance
of that component anywhere in the OS.

| Slot | Type | Paints on |
|---|---|---|
| `MENU` | `image` | `<os-menu>` and `<os-context-menu>` panels |
| `DIALOG` | `image` | `<os-modal>` and `<os-confirm-dialog>` surfaces, and the command-palette / Site Assistant panel |
| `SCRIM` | `image` | The backdrop behind a modal, and behind the command palette |
| `PANEL` | `image` | `<os-card>`, `<os-panel>`, `<os-flyout>` |
| `TOAST` | `image` | `<os-toast>` notifications |
| `TABLE_HEADER` | `image` | `<os-table>` header cells, sticky included |
| `BUTTON` | `image` | `<os-button>` faces (except the `link` variant) |

Component textures tile across small surfaces, so subtle wins: a 2–4 px
noise or hairline pattern reads as material, a 200 px illustration
reads as a mistake.

### The window controls sit on nothing

By default the control cluster and every button face are
**transparent**, so a `TITLEBAR` texture runs edge to edge underneath
them and the glyphs float on your artwork. That is almost always what
a textured title bar wants, and it is why the default is transparent
rather than a plate.

If you want the opposite — controls in their own well, the way some
desktop environments do it — the shape is yours to build:

| Token | Controls |
|---|---|
| `--os-titlebar-controls-bg` | Cluster background colour |
| `--os-titlebar-controls-radius` | Its corner radius |
| `--os-titlebar-controls-padding` | Inline padding (block padding stays 0 so the title-bar height can't shift) |
| `--os-titlebar-controls-gap` | Space between buttons |
| `--os-titlebar-meta-bg` / `-radius` / `-image` | Same for the Screen Options / Help cluster; the radius falls through to the controls radius |
| `--os-ui-btn-bg` | Resting colour of one button face |
| `--os-ui-btn-radius` | Its corner radius |
| `--os-titlebar-divider` | The hairline between page chrome and window chrome. Set `transparent` to let your artwork carry the separation |
| `--os-titlebar-divider-unfocused` | Its unfocused counterpart |

The leading mark of the title bar is the **status ring** — the window's
activity phase, the one `wp.os.fetch` drives. It replaced the app icon
that used to sit there, which was a copy of the same window's dock
tile. Four states, and only success fills the ring.

| Token | Controls |
|---|---|
| `--os-titlebar-activity-idle-color` | The resting ring — white by default, and one value whether the window is focused or not |
| `--os-titlebar-activity-color` | The ring while a request is in flight |
| `--os-titlebar-activity-saved-color` | The fill when the request lands |
| `--os-titlebar-activity-failed-color` | The ring when it didn't. This one stays until the next request starts |
| `--os-titlebar-activity-size` | Ring diameter (default `16px`) |

Retint them if your title-bar artwork would swallow one, but keep the
outcomes distinguishable by more than hue — the built-in pair differs
in fill and glyph as well as colour, which is what makes it readable
for a user who can't separate the two.

```json
"tokens": {
  "--os-titlebar-controls-bg": "rgba( 10, 10, 26, 0.55 )",
  "--os-titlebar-controls-radius": "8px",
  "--os-titlebar-controls-padding": "4px",
  "--os-ui-btn-bg": "rgba( 255, 255, 255, 0.06 )",
  "--os-ui-btn-radius": "6px"
}
```

Add `TITLEBAR_CONTROLS` or `TITLEBAR_BUTTON` for artwork instead of a
flat colour. Hover, focus and danger states override the button's
background **colour** only, so a face texture survives all of them. Every one of them layers over the surface's
background *colour*, which the palette tokens still control — a
translucent texture composes with the colour instead of replacing it.

### `image` descriptors

```json
{ "type": "image", "path": "textures/titlebar.png",
  "repeat": "repeat-x", "size": "auto 100%", "position": "left center" }
```

- `repeat` — one of `repeat`, `repeat-x`, `repeat-y`, `no-repeat`, `space`, `round`.
- `size` — `auto`, `cover`, `contain`, or one-to-two components, each `auto` or a number with `px` / `%` / `rem` / `em`.
- `position` — one or two components: a keyword (`left`, `right`, `top`, `bottom`, `center`), a length, a percentage, or `0`. Negative offsets allowed.

### Tile or stretch — the choice that decides your artwork

Three combinations cover almost everything, and picking the wrong one
is why a texture looks blurry or repetitive:

| Intent | `size` | `repeat` | Draw |
|---|---|---|---|
| **Tile** a detailed motif across any width | `auto` or `auto 100%` | `repeat` / `repeat-x` | Seamless artwork at natural resolution |
| **Stretch** one image to fill the surface | `100% 100%` or `cover` | `no-repeat` | A gradient or a soft wash — detail smears |
| **Place** a fixed ornament | its pixel size | `no-repeat` | Exactly the pixels you want, at 2× |

**Tiling is what lets a texture be big and detailed.** A window title
bar can be 400px or 2000px wide; stretching one image across both
destroys it. A seamless 256px strip tiled with `repeat-x` looks
identical at every width, at full resolution, for a few kilobytes.

Two rules make a strip seamless:

1. **Match the edges.** Whatever touches `x = 0` must continue at
   `x = width`. For a wave, use a whole number of periods across the
   image; for scattered motifs, draw anything that crosses an edge
   twice, once on each side.
2. **Let one axis scale.** `size: auto 100%` scales the strip to the
   surface's height and keeps its aspect ratio, so the tile width
   follows automatically. Export at 2× the height you expect (a 72px
   strip for a 36px title bar) and it stays crisp on HiDPI.

`position` is what anchors the result. A repeating grid **must** be
positioned `top left`: with the default `center`, the lattice shifts
every time the window resizes and the grid appears to crawl. A
horizontal strip usually wants `left center` so its tiling origin is
the surface's leading edge rather than its midpoint.

The bundled Neon Glass theme ships both cases — a seamless 256×72
circuit-trace title bar that tiles, and a 24px grid pinned to
`top left` in the window body.

The four corner slots share one size token: whichever corner declares a
`size` first (in `NE, NW, SE, SW` order) sets it for all four.

**Corner ornaments paint INSIDE the window's rounded box.** The window
sets `overflow: hidden` — that is what clips iframe content to the
rounded corners — so anything hung off a corner is clipped by both the
window edge and the corner radius. Ornaments are therefore anchored
just inside the corner, clear of the arc.

Tune the distance with `--os-window-corner-inset`; it
defaults to the resize handle's overhang plus a share of
`--os-window-radius`, which is what keeps a large radius
from cutting into the artwork.

**Top corners paint over the title bar.** The resize handles sit at
`z-index: 999` and the title bar at `21`, so `WINDOW_CORNER_NE` and
`_NW` render *above* the chrome — NE over the close button, NW over
the status ring. They cannot be pushed underneath: the ornament is a
child of the z-999 handle, which is its own stacking context.

That makes the top two slots a different design problem from the
bottom two. Diffuse, low-alpha light works — it reads as the title bar
catching light and leaves every glyph legible. Hard edges do not: a
saturated bracket up there lands straight through the close glyph.

**Keep the falloff tight.** A broad bloom is the subtler version of
the same mistake: it washes out whatever `TITLEBAR` texture you spent
the effort making seamless, precisely in the strip where the controls
live. Aim to be under ~3% alpha within 10px of the corner.
The bundled example theme uses arcs and a bright node on the bottom
corners, and bloom only on the top.

If you want artwork that OVERHANGS the frame, use `WINDOW_FRAME`
instead: `border-image` paints in the border area, which `overflow`
does not clip, and its nine-slice corners are exactly the right tool
for a frame that extends past the window box.

### `border-image` descriptors

```json
{ "type": "border-image", "path": "textures/frame.png",
  "slice": "24 fill", "width": "12px", "repeat": "round" }
```

- `slice` — one to four unitless numbers, optional trailing `fill`.
- `width` — one to four lengths (unitless allowed: multiples of the border width).
- `repeat` — one or two of `stretch`, `repeat`, `round`, `space`.

### Layering notes

- **`DOCK`** paints *over* `--os-dock-bg`, so a
  semi-transparent texture still gets the translucent wash underneath.
- **`DESKTOP`** paints *over* the user's CSS wallpaper but *under* any
  canvas wallpaper. A theme that wants the user's wallpaper to stay
  visible should ship a texture with transparency; an opaque one takes
  the desk over. This is deliberate: a whole-OS reskin should be able
  to own the background, but a wallpaper the user actively chose and
  which animates should not be painted out.
- **`WINDOW_BODY`** shows behind native window content and behind an
  iframe whose page is transparent. A normal `wp-admin` page inside an
  iframe paints its own opaque background over it.
- **`SCRIM`** and `DIALOG` are separate on purpose: the scrim is the
  dimmed backdrop, the dialog is the card on top of it.

---

## Texturing your own surface

The slot table above is data, not code. The compiler
reads it and nothing else, which means a plugin can texture a surface
OpenStation has never heard of without touching the framework.

Two steps. Register the slot with the custom property you want it
written to:

```php
add_filter( 'openstation_desktop_theme_texture_slots', function ( $slots ) {
    $slots['ACME_SIDEBAR'] = array(
        'type' => 'image',                   // or 'border-image'
        'prop' => '--acme-sidebar-image',    // the property base name
    );
    return $slots;
} );
```

…then consume it in your own stylesheet, with the fallback that keeps
an unthemed shell unchanged:

```css
.acme-sidebar {
    background-color: var( --acme-panel-bg, #fff );
    background-image: var( --acme-sidebar-image, none );
    background-repeat: var( --acme-sidebar-image-repeat, repeat );
    background-size: var( --acme-sidebar-image-size, auto );
}
```

A theme can now write:

```json
"textures": {
  "ACME_SIDEBAR": { "type": "image", "path": "textures/sidebar.png",
                    "repeat": "repeat-y" }
}
```

### What each slot definition may declare

| Key | Meaning |
|---|---|
| `type` | `image` or `border-image`. Decides which descriptor grammar the sanitizer applies and which properties get written. |
| `prop` | The custom-property base name. An `image` slot emits `<prop>`, `<prop>-repeat`, `<prop>-size`; a `border-image` slot emits `<prop>-source`, `-slice`, `-width`, `-repeat`. |
| `companions` | Set to `false` for a variant slot that should inherit another slot's repeat + size rather than declare its own — how `TITLEBAR_FOCUSED` works. |
| `sizeGroup` | A custom property shared by a family of slots that must render at one size. First slot to declare a `size` wins; the four window corners use this. |

A slot with no `prop` is accepted by the sanitizer and emits nothing.
That combination is a bug, not a feature — it exists only so a
malformed filter can't produce malformed CSS.

Slot names should be `UPPER_SNAKE` and namespaced by prefix
(`ACME_SIDEBAR`, not `SIDEBAR`) so two plugins can't collide.

The same trick works for icons via
`openstation_desktop_theme_icon_slots`, with one extra obligation:
the JS side resolves icons, so a new icon slot must also exist in
`src/desktop-themes/slots.ts` or the shell will never look it up.
Texture slots have no such twin — they are pure CSS.

---

## Value grammar

Every token value is checked before it can reach the stylesheet:

- 1–256 characters.
- Characters limited to letters, digits, whitespace, and
  `# % . , ( ) / * + - _ ' "`. That excludes `;` `{` `}` `@` `\` `<`
  `>` `!` and the backtick, which is what makes declaration escape,
  at-rule injection, and `!important` overrides impossible.
- No CSS comment sequences (`/*`, `*/`).
- No `url(`, `image-set(`, `element(`, `attr(`, `var(`, or
  `expression`. External references are PHP's job — it generates the
  `url()`s for your declared assets itself. `var()` is banned so a
  theme can't alias a property outside the exposed namespace.
- Balanced parentheses.

Gradients, `rgba()`, `calc()`, and shorthand values all pass. If a
value of yours doesn't apply, run it past this list first.

---

## Fallback semantics

**Whatever your manifest doesn't say, the system default keeps
saying.** Concretely:

- A dropped token, icon, or texture entry leaves the built-in value in
  place. There is no "partially broken" state.
- Only structural fields (`manifestVersion`, `id`, `name`) can fail the
  whole upload. Everything else drops the offending entry and installs
  the rest.
- A slot you never mention is never consulted. With **no** theme
  active, icon resolution is a single null check — the shell pays
  nothing for this feature existing, no extra stylesheet, and no
  attribute on the shell root.
- If a user's selected theme is deleted, or the plugin registering it
  is deactivated, they degrade silently to the system default. No user
  meta is rewritten; the enqueue path existence-checks on every
  request.

---

## Installing and activating

**Install:** OpenStation Preferences → Themes → drop a `.zip` on the upload tile.
Requires `manage_options` by default (filterable via
`openstation_desktop_theme_upload_capability`).

**Window controls.** These are title-bar chrome, so they follow the
title bar's own colours rather than the body palette, and each focus
state is addressed separately.

*Unfocused* glyphs are derived for you: set
`--os-titlebar-color` and the shell mixes legible unfocused
controls out of it automatically. Override precisely with
`--os-titlebar-btn-color`, `-color-hover`, `-bg-hover`, and
`-bg-active` when you want exact control.

*Focused* glyphs cannot be derived — they sit on
`--os-titlebar-bg-focused`, which you may set to anything
from near-black to a pastel, and CSS has no contrast-safe function of
a background colour. So they stay white at 70% until you say
otherwise, through the mirror-image set:

| Token | Role |
|---|---|
| `--os-titlebar-btn-focused-color` | Glyph at rest |
| `--os-titlebar-btn-focused-color-hover` | Glyph on hover / press |
| `--os-titlebar-btn-focused-bg-hover` | Hover wash behind a control |
| `--os-titlebar-btn-focused-bg-active` | Pressed / active wash |
| `--os-titlebar-btn-focused-outline` | Keyboard focus ring |

```json
"tokens": {
  "--os-titlebar-bg-focused": "#ded9ff",
  "--os-titlebar-color-focused": "#12102b",
  "--os-titlebar-btn-focused-color": "rgba( 18, 16, 43, 0.7 )",
  "--os-titlebar-btn-focused-color-hover": "#12102b",
  "--os-titlebar-btn-focused-bg-hover": "rgba( 18, 16, 43, 0.12 )",
  "--os-titlebar-btn-focused-bg-active": "rgba( 18, 16, 43, 0.18 )",
  "--os-titlebar-btn-focused-outline": "rgba( 18, 16, 43, 0.65 )"
}
```

A pale focused title bar is exactly the case to set them for: without
them the active window is the one window whose close button you cannot
see. The screen-meta buttons (Screen Options, Help) and the `⋯` menu
trigger sit in the same bar and read the same tokens, so one pass
covers every button in the title bar.

Close-button red is deliberately not in either set — it is semantic
signal, not chrome, and both states resolve it through `--os-ui-danger`.

**Activate:** every user picks their own theme on the same tab —
including users who cannot upload. The library is site-wide;
activation is per-user, stored as `desktopTheme` in the
`desktop_mode_os_settings` user meta.

The first card in the grid is **OpenStation** — the shell's own look,
stored as the empty string. It is not a theme in the registry (its
palette is `assets/css/variables.css`, not a manifest), but the picker
treats it as a peer of everything beside it: it carries the same
"Apply …'s recommended layout and effects" button, and what it
recommends is the accent its palette was drawn against (Pulse) and the
layout it was drawn for (`classic`).

The switch is live: no reload. The stylesheet swaps, the shell
attribute and body class flip, and every themed icon repaints. On a
fresh page load PHP stamps the attribute, prints the body class, and
enqueues the stylesheet before the shell script runs, so there is no
flash of the default palette.

If the theme ships
[`recommendedOsSettings`](#recommended-os-settings), the user's first
activation of it also seeds those preferences — once — and the tab
grows an **Apply &lt;theme&gt;'s recommended layout** button for going
back to them later.

### From JavaScript

```js
wp.os.desktopThemes.list();        // the library
wp.os.desktopThemes.getActive();   // slug, or null
wp.os.desktopThemes.resolveIcon( 'WINDOW_CONTROL_CLOSE' );

// Presentation only — does NOT persist. For a preview you'll revert:
wp.os.desktopThemes.setActive( 'acme-neon-glass' );

// Change it for real — persists AND applies:
wp.os.updateOsSettings( { desktopTheme: 'acme-neon-glass' } );

// What the theme recommends, and re-applying it (persists):
wp.os.desktopThemes.list()[ 0 ].recommendedOsSettings;
wp.os.desktopThemes.applyRecommendedOsSettings();
```

See [JavaScript reference](./javascript-reference.md#desktop-themes-experimental)
for the event and filter surface.

---

## Registering a theme from PHP

A plugin can ship a theme without an upload. Same sanitizer, same
compiler, same constraints — the only difference is that assets are
absolute URLs you already serve instead of files in a ZIP.

```php
add_action( 'init', function () {
    openstation_register_desktop_theme( 'acme/neon-glass', array(
        'name'     => __( 'Neon Glass', 'acme' ),
        'version'  => '1.0.0',
        'preview'  => plugins_url( 'theme/preview.png', __FILE__ ),
        'tokens'   => array(
            '--os-titlebar-bg-focused' => '#241f4d',
            '--os-font'                => '"Neon Grotesk", sans-serif',
        ),
        'fonts'    => array(
            array(
                'family'  => 'Neon Grotesk',
                'weight'  => '400',
                'display' => 'swap',
                'src'     => array( plugins_url( 'theme/neon.woff2', __FILE__ ) ),
            ),
        ),
        'icons'    => array(
            'WINDOW_CONTROL_CLOSE' => array(
                'type' => 'image',
                'path' => plugins_url( 'theme/close.svg', __FILE__ ),
            ),
        ),
        'textures' => array(
            'TITLEBAR' => array(
                'type'   => 'image',
                'path'   => plugins_url( 'theme/titlebar.png', __FILE__ ),
                'repeat' => 'repeat-x',
            ),
        ),
        'recommendedOsSettings' => array(
            'dockSize'      => 'large',
            'desktopLayout' => 'unified',
        ),
    ) );
} );
```

Code themes have no compiled file, so the payload carries the compiled
stylesheet as text and PHP prints it via `wp_add_inline_style()`.
Uploaded themes win on a slug collision — a site admin who installed a
theme by hand outranks a plugin that later claims the same slug.

See [`examples/register-desktop-theme.md`](./examples/register-desktop-theme.md)
for a complete plugin.

---

## Non-goals

- **`<os-icon>` content icons.** Icons inside window *bodies* (tables,
  toolbars, empty states) are not themable. Only chrome is.
- **Letter badges.** The generated initial-letter tiles for items with
  no icon stay generated; retint them with the
  `--os-tile-*` tokens instead.
- **Art-direction colour and type.** Note paper, game palettes, graph
  node hues, the About scene — see "What stays fixed" above.
- **Layout.** A theme changes how things look, not where they are. No
  spacing scale, no dock geometry, no window metrics beyond the radius
  and title-bar height the tokens already expose.
  [`recommendedOsSettings`](#recommended-os-settings) is not an
  exception to this: it seeds the user's own layout preferences once,
  as a suggestion they own from that moment on, rather than giving the
  theme any say in how the shell is arranged.
- **Author CSS and JS.** Still never, and this is the line that makes
  everything else safe. `@font-face` is generated *for* you from a
  constrained descriptor; it is not an opening.
- **Inside iframe windows.** A theme styles the shell and native
  windows. The `wp-admin` page inside an iframe is a separate
  document that the theme stylesheet does not reach.

  This is a guarantee, not just a limitation. The shell's own palette
  is scoped to `body.os-active` precisely so it cannot leak
  in either: `variables.css` is a dependency of `chromeless.css` and
  therefore loads inside every iframe, and a palette on `:root` would
  repaint WordPress's own UI in there — `--wp-admin-theme-color` alone
  would move Core's primary buttons, links and focus rings on every
  admin screen. **Admin pages render in their own colours, in or out
  of a window.**
- **Uninstall cleanup.** The plugin has no `uninstall.php`; the
  `desktop_mode_desktop_themes` option and the uploads directory
  survive plugin deletion today.
