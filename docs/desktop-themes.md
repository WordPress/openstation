# Desktop themes

**Status:** Experimental · **Since:** 0.9.7

A **desktop theme** reskins the whole Desktop Mode shell at once —
every design token, the title-bar / dock / desktop textures, the window
frame and its corners, and a complete iconset down to the window
control glyphs. It ships as a ZIP containing a `theme.json` manifest
plus images. Nothing else.

> **Desktop themes vs window themes.** Desktop Mode also has
> *window themes* (`desktop_mode_register_window_theme()`,
> `wp.desktop.registerWindowTheme`), which restyle **one window's**
> chrome. Desktop themes restyle **the entire OS**. They are separate
> features with separate registries; everything on this page uses the
> `desktop_theme` / `desktopTheme` naming to keep them apart.

- [The security model](#the-security-model)
- [ZIP layout](#zip-layout)
- [`theme.json`](#themejson)
- [Tokens](#tokens)
- [Icons](#icons)
- [Textures](#textures)
- [Value grammar](#value-grammar)
- [Fallback semantics](#fallback-semantics)
- [Installing and activating](#installing-and-activating)
- [Registering a theme from PHP](#registering-a-theme-from-php)
- [Non-goals in v1](#non-goals-in-v1)

---

## The security model

**A theme is data, never code.** There is no author-supplied CSS and no
author-supplied JavaScript, ever. What actually happens on upload:

1. The archive is walked entry-by-entry **before a single byte is
   written**. Traversal, absolute paths, backslashes, NUL bytes, and
   any extension outside `json png jpg jpeg gif webp avif svg` reject
   the whole upload. Entry-count and uncompressed-size caps apply.
2. The archive extracts into a staging directory.
3. `theme.json` is sanitized field by field. Every asset reference is
   resolved against the staging directory and must land inside it.
4. Every referenced SVG is parsed with DOMDocument and stripped of
   scripts, embedding elements, `on*` handlers, non-fragment `href`s,
   and `javascript:` / `url()` in style attributes. DTDs and entity
   declarations reject the upload outright. On a server without
   DOMDocument, SVGs are **refused** rather than shipped unexamined.
5. **Only the assets the sanitized manifest actually references** are
   moved into the live directory. Anything else in the ZIP is
   discarded with the staging directory.
6. PHP *compiles* a stylesheet from the sanitized manifest — a single
   rule containing custom-property declarations. It generates every
   `url()` itself from a `rawurlencode`d path.

The practical consequence for you: if a value isn't in the grammar
below, it silently doesn't apply. That is deliberate, and it is why
this feature can be open to site admins at all.

---

## ZIP layout

Either shape works — the manifest may sit at the archive root, or one
directory deep (what "Compress this folder" produces on macOS and
Windows):

```
neon-glass.zip
├── theme.json
├── preview.png
├── icons/
│   ├── close.svg
│   ├── settings.svg
│   └── trash.svg
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
  "manifestVersion": 1,
  "id": "acme/neon-glass",
  "name": "Neon Glass",
  "version": "1.0.0",
  "author": "Acme Design",
  "description": "Deep indigo glass with a neon rim.",
  "preview": "preview.png",

  "tokens": {
    "--desktop-mode-window-radius": "14px",
    "--desktop-mode-titlebar-bg-focused": "#1a1a2e"
  },

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
  }
}
```

### Fatal fields

Get these wrong and the upload is rejected with a specific message:

| Field | Rule |
|---|---|
| `manifestVersion` | Must be exactly `1`. |
| `id` | `^[a-z0-9_-]+(/[a-z0-9_-]+)?$`, max 64 chars. Namespacing (`vendor/name`) is encouraged. |
| `name` | Non-empty. |

The storage **slug** is the `id` with `/` flattened to `-`
(`acme/neon-glass` → `acme-neon-glass`). It is what appears in the
compiled selector and the body class.

### Everything else

Optional, and **individually droppable** — see
[Fallback semantics](#fallback-semantics).

| Field | Notes |
|---|---|
| `version`, `author` | Plain text, ≤32 / ≤120 chars. |
| `description` | Plain text, ≤500 chars. |
| `preview` | Path to an image shown on the theme card in OS Settings. |
| `tokens`, `icons`, `textures` | See below. |

---

## Tokens

A map of CSS custom property => value. Three namespaces are accepted;
anything else is dropped, so a theme can never reach a property the
shell didn't mean to expose.

| Namespace | What it restyles |
|---|---|
| `--desktop-mode-*` | The **shell**: dock, desktop, window frame, title bars, corners. |
| `--wpd-*` | Window **bodies**: the `<wpd-*>` component kit *and* every feature stylesheet. |
| `--wp-admin-theme-color` | The WordPress admin accent. |

### The `--wpd-*` UI palette

This is the one that matters most, and the one theme authors most
often miss: **`--desktop-mode-*` alone restyles the frame around a
window and nothing inside it.** Window bodies — the Settings panel,
the Posts table, the Recycle Bin, file tiles, every dialog — read the
`--wpd-*` palette. A theme that sets only the shell tokens produces a
dark frame around a white page.

| Token | Role |
|---|---|
| `--wpd-surface` | Cards, panels, table rows |
| `--wpd-surface-elevated` | Headers, raised strips |
| `--wpd-surface-sunken` | Wells, recessed areas |
| `--wpd-fg` | Body text |
| `--wpd-fg-muted` | Secondary text, metadata |
| `--wpd-fg-faint` | Disabled text |
| `--wpd-fg-on-accent` | Text on a filled accent / danger surface |
| `--wpd-border` | Hairlines |
| `--wpd-border-strong` | Emphasized dividers |
| `--wpd-hover` | Row / tile hover wash |
| `--wpd-scrim` | Modal + overlay backdrop |
| `--wpd-accent` | Primary action |
| `--wpd-accent-strong` | Its hover / active state |
| `--wpd-danger`, `--wpd-danger-hover` | Destructive actions |
| `--wpd-warning-fg`, `--wpd-warning-bg`, `--wpd-warning-border` | Warning notices |
| `--wpd-info-fg`, `--wpd-info-bg` | Info notices |
| `--wpd-success-fg` | Success text |

Individual components expose finer-grained tokens on top of these
(`--wpd-button-bg`, `--wpd-card-bg`, `--wpd-table-header-bg`, …) —
around 190 in all, each documented next to its component in
`src/ui/components/<name>/<name>.styles.ts`. **Every one of them falls
through to the palette above**, e.g.

```css
background: var( --wpd-card-bg, var( --wpd-surface, #fff ) );
```

so setting `--wpd-surface` alone restyles cards, flyouts, menus,
tables and the rest. Reach for a component-local token only when you
want that one component to differ — it still wins when set. Any
`--wpd-*` name is accepted by the manifest.

**These tokens have no default value.** Every consuming site reads
them as `var( --wpd-x, <its own literal> )`, which is why an unthemed
shell looks exactly as it always did and why one theme value retints
a whole family at once.

A dark theme's minimum viable body palette:

```json
"tokens": {
  "--wpd-surface":          "#161634",
  "--wpd-surface-elevated": "#1e1c44",
  "--wpd-surface-sunken":   "#101026",
  "--wpd-fg":               "#e9e7ff",
  "--wpd-fg-muted":         "#a5a1cc",
  "--wpd-fg-faint":         "#6f6b99",
  "--wpd-border":           "#2f2a63",
  "--wpd-border-strong":    "#453e8c",
  "--wpd-hover":            "rgba( 124, 92, 255, 0.16 )",
  "--wpd-scrim":            "rgba( 6, 4, 24, 0.68 )"
}
```

### Shell tokens

`--desktop-mode-*` names must match `^--desktop-mode-[a-z0-9-]+$`.
Read `assets/css/variables.css` for the full set.

```json
"tokens": {
  "--desktop-mode-window-bg": "#12122a",
  "--desktop-mode-window-border": "#2b2b52",
  "--desktop-mode-window-radius": "14px",
  "--desktop-mode-titlebar-bg": "#171733",
  "--desktop-mode-titlebar-bg-focused": "#241f4d",
  "--desktop-mode-titlebar-color": "#a8a8c0",
  "--desktop-mode-dock-bg": "rgba( 12, 12, 30, 0.72 )",
  "--wp-admin-theme-color": "#7c5cff"
}
```

### A note on WordPress core's CSS

Native windows render in the parent shell, not in an iframe, so
`wp-admin`'s own stylesheets reach into their content. Core styles a
few things with **bare element selectors** — `h1`, `h2`, `h3`, `a`,
`code` — which means a heading inside a themed window inherited
core's `#1d2327` regardless of your palette.

The shell now re-points those at the palette (see the specificity
note in `assets/css/window-chrome.css`), so headings follow
`--wpd-fg`, links follow `--wpd-accent`, and `<code>` follows
`--wpd-surface-sunken`. Nothing is needed from a theme author — but
it explains why a heading might once have looked "stuck".

Raw form controls (`input`, `textarea`, `select`) are the known
exception: core styles those with attribute selectors that carry real
specificity, and native windows use the `<wpd-*>` components instead.
If you build a native window with raw form controls, style them
yourself.

### What stays fixed

Colour that encodes meaning or is composed artwork is deliberately
**not** themable: sticky-note paper, game palettes, the content-graph
node hues, the About scene. Retinting those would destroy the signal
they carry.

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
| System tiles | `OS_SETTINGS`, `RECYCLE_BIN`, `BUG_REPORT`, `EXIT_DESKTOP_MODE`, `PWA_INSTALL` |
| Apps | `DEFAULT_APP_ICON`, plus `APP:<slug>` for any individual dock tile, desktop icon, or native window id |
| Desktop files | `FOLDER`, `FILE_SHORTCUT`, `FILE_POST`, `FILE_ATTACHMENT`, `FILE_UPLOAD`, `FILE_USER`, `FILE_TERM`, `FILE_COMMENT`, `FILE_BOOKMARK`, `FILE_LINK`, `FILE_EMBED` |
| Recycle-bin row actions | `RECYCLE_RESTORE`, `RECYCLE_DELETE` |

`APP:<slug>` slugs are the tile ids the shell uses — `APP:edit-php`,
`APP:upload-php`, `APP:my-plugin-dashboard`. The quickest way to find
one is the browser console:

```js
wp.desktop.getMenuItems().map( ( i ) => i.id );
```

### Icon colour: two rendering paths

An `image` icon is painted one of two ways depending on the slot, and
the difference decides how you should draw the art:

| Slots | Rendered as | Your colours |
|---|---|---|
| `WINDOW_CONTROL_*`, `RECYCLE_RESTORE`, `RECYCLE_DELETE` | CSS **mask** tinted with `currentColor` | **discarded** — alpha only |
| Everything else (title bar, dock tiles, desktop icons, file tiles) | plain `<img>` | **kept** as authored |

So the second group has to be drawn for the surfaces your theme
actually paints. A black-stroked iconset looks perfect in isolation,
survives the masked slots (which throw the colour away), and then
disappears against your own dark title bar and dock. Pick a stroke
colour that reads against your `--desktop-mode-titlebar-bg` and
`--desktop-mode-dock-bg`; the masked slots cost you nothing either way.

### Window control glyphs are monochrome

Control buttons paint an `image`-type icon as a **CSS mask tinted with
`currentColor`**, not as an `<img>`. That is what keeps a themed close
button turning white on a focused title bar and red on danger-hover,
exactly like the built-in glyphs — an image would paint its own colours
and go deaf to the title bar's focused/unfocused state.

**So: only the alpha channel of the source image is used.** Design
control glyphs as solid silhouettes. Colour in them is discarded.

The same applies to the two recycle-bin row-action slots. Those also
ignore `dashicon`-type descriptors entirely — `<wpd-table>` renders
into a shadow root the global Dashicons stylesheet can't reach, so a
dashicon would come out blank and the built-in SVG is used instead.

---

## Textures

A map of **slot** => texture descriptor.

| Slot | Type | Paints on |
|---|---|---|
| `TITLEBAR` | `image` | Every window title bar |
| `TITLEBAR_FOCUSED` | `image` | The focused window's title bar (falls back to `TITLEBAR`) |
| `WINDOW_FRAME` | `border-image` | The window frame — replaces the 1px border |
| `WINDOW_CORNER_NE` / `_NW` / `_SE` / `_SW` | `image` | Corner ornaments on the resize handles |
| `DOCK` | `image` | The dock, layered over its background colour |
| `DESKTOP` | `image` | The wallpaper layer |

### `image` descriptors

```json
{ "type": "image", "path": "textures/titlebar.png",
  "repeat": "repeat-x", "size": "auto 100%" }
```

- `repeat` — one of `repeat`, `repeat-x`, `repeat-y`, `no-repeat`, `space`, `round`.
- `size` — `auto`, `cover`, `contain`, or one-to-two components, each `auto` or a number with `px` / `%` / `rem` / `em`.

The four corner slots share one size token: whichever corner declares a
`size` first (in `NE, NW, SE, SW` order) sets it for all four.

**Corner ornaments paint INSIDE the window's rounded box.** The window
sets `overflow: hidden` — that is what clips iframe content to the
rounded corners — so anything hung off a corner is clipped by both the
window edge and the corner radius. Ornaments are therefore anchored
just inside the corner, clear of the arc.

Tune the distance with `--desktop-mode-window-corner-inset`; it
defaults to the resize handle's overhang plus a share of
`--desktop-mode-window-radius`, which is what keeps a large radius
from cutting into the artwork.

**Top corners paint over the title bar.** The resize handles sit at
`z-index: 999` and the title bar at `21`, so `WINDOW_CORNER_NE` and
`_NW` render *above* the chrome — NE over the close button, NW over
the window icon. They cannot be pushed underneath: the ornament is a
child of the z-999 handle, which is its own stacking context.

That makes the top two slots a different design problem from the
bottom two. Diffuse, low-alpha light works — it reads as the title bar
catching light and leaves every glyph legible. Hard edges do not: a
saturated bracket up there lands straight through the close glyph.
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

- **`DOCK`** paints *over* `--desktop-mode-dock-bg`, so a
  semi-transparent texture still gets the translucent wash underneath.
- **`DESKTOP`** paints *over* the user's CSS wallpaper but *under* any
  canvas wallpaper. A theme that wants the user's wallpaper to stay
  visible should ship a texture with transparency; an opaque one takes
  the desk over. This is deliberate: a whole-OS reskin should be able
  to own the background, but a wallpaper the user actively chose and
  which animates should not be painted out.

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

**Install:** OS Settings → Themes → drop a `.zip` on the upload tile.
Requires `manage_options` by default (filterable via
`desktop_mode_desktop_theme_upload_capability`).

**Unfocused window controls.** These are title-bar chrome, so they
follow the title bar's own text colour rather than the body palette.
Set `--desktop-mode-titlebar-color` and the shell derives legible
unfocused glyphs from it automatically. Override precisely with
`--desktop-mode-titlebar-btn-color`, `-color-hover`, `-bg-hover`, and
`-bg-active` when you want exact control.

**Activate:** every user picks their own theme on the same tab —
including users who cannot upload. The library is site-wide;
activation is per-user, stored as `desktopTheme` in the
`desktop_mode_os_settings` user meta.

The switch is live: no reload. The stylesheet swaps, the shell
attribute and body class flip, and every themed icon repaints. On a
fresh page load PHP stamps the attribute, prints the body class, and
enqueues the stylesheet before the shell script runs, so there is no
flash of the default palette.

### From JavaScript

```js
wp.desktop.desktopThemes.list();        // the library
wp.desktop.desktopThemes.getActive();   // slug, or null
wp.desktop.desktopThemes.resolveIcon( 'WINDOW_CONTROL_CLOSE' );

// Presentation only — does NOT persist:
wp.desktop.desktopThemes.setActive( 'acme-neon-glass' );

// Persist the user's choice:
wp.desktop.updateOsSettings( { desktopTheme: 'acme-neon-glass' } );
```

See [JavaScript reference](./javascript-reference.md#desktop-themes)
for the event and filter surface.

---

## Registering a theme from PHP

A plugin can ship a theme without an upload. Same sanitizer, same
compiler, same constraints — the only difference is that assets are
absolute URLs you already serve instead of files in a ZIP.

```php
add_action( 'init', function () {
    desktop_mode_register_desktop_theme( 'acme/neon-glass', array(
        'name'     => __( 'Neon Glass', 'acme' ),
        'version'  => '1.0.0',
        'preview'  => plugins_url( 'theme/preview.png', __FILE__ ),
        'tokens'   => array(
            '--desktop-mode-window-radius'       => '14px',
            '--desktop-mode-titlebar-bg-focused' => '#241f4d',
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

## Non-goals in v1

- **`<wpd-icon>` content icons.** Icons inside window *bodies* (tables,
  toolbars, empty states) are not themable. Only chrome is.
- **Letter badges.** The generated initial-letter tiles for items with
  no icon stay generated; retint them with the
  `--desktop-mode-tile-*` tokens instead.
- **Art-direction colour.** Note paper, game palettes, graph node
  hues, the About scene — see "What stays fixed" above.
- **Fonts.** No `@font-face`, which would need an at-rule and a
  `url()` from an author string.
- **Layout.** A theme changes how things look, not where they are.
- **Uninstall cleanup.** The plugin has no `uninstall.php`; the
  `desktop_mode_desktop_themes` option and the uploads directory
  survive plugin deletion today.
