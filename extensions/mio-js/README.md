# `extensions/mio-js/`

**Mio, on any page, in one `<script>` tag.**

```html
<script src="mio.min.js"></script>
```

That is the whole integration. No WordPress, no build step on the page's side, no globals to set up first — the file carries PixiJS, the soft-body simulation, and the renderer. Drop it in a blog's footer, a "custom HTML" block, or a plain static page, and the official Mio is there: floating over the article, watching the cursor, draggable, throwable, and bouncing off the edges of the viewport.

## This is not a copy of Mio

The simulation, the renderer, the soft body, the silhouettes and the palette are imported **straight from the plugin's own `src/mio/`**. `extensions/mio-js/src/` adds a little over three hundred lines: a layer to live in, PixiJS, a place to remember where Mio was put down, and an optional way to make page elements solid.

So there is one Mio and one place to change it. A retune of the springs or a correction to the brand hues lands here on the next build, without anyone remembering to port it.

**Nothing is configurable, deliberately.** The shell has a "Make it yours" panel with sliders for hue, glow and silhouette; this library ships `MIO_DEFAULTS` — the reference design, wearing the brand — and no way to alter it. If you want a teal Mio, you want the plugin.

## What it does on a page with no windows

On an OpenStation desk Mio has furniture. It is drawn toward windows and widget cards, lands on them, squashes against their top edge, and hops clear if one opens on top of it. A blog has none of that, so out of the box Mio floats — which is exactly what the shell's Mio does when every window is closed. Throw it and it drifts, bounces off the viewport walls, and slowly comes to rest.

**Collision markers** give it furniture back. Any CSS selector:

```html
<script src="mio.min.js" data-mio-colliders="h1, h2"></script>
```

Every matching element becomes solid: Mio bumps into it, is pulled toward it, and settles on it. Two things worth knowing:

- The rect is the element's **content box**. Margin and padding are both taken off, so the boundary is the text rather than the whitespace a stylesheet parked around it. A heading with `4rem` of margin above it is a heading, not a `4rem` wall.
- It is re-read about twenty times a second, so it follows the page. Mio riding a heading stays on that heading while you scroll, and elements added later (infinite scroll, a lazy comment thread) become solid the moment they exist.

## API

`window.Mio`, published as soon as the script runs:

| Member | What it does |
|---|---|
| `start()` | Put Mio on the page. Resolves once it renders. Idempotent. |
| `stop()` | Remove Mio and release its WebGL context. |
| `isRunning()` | Whether Mio is on the page. |
| `getPosition()` | Body centre in viewport coordinates, or `null`. |
| `setPosition( x, y )` | Move Mio. |
| `setColliders( selector )` | Make matching elements solid. `null` clears. |
| `getColliders()` | The selector in force, or `null`. |
| `config` | The configuration in force — `MIO_DEFAULTS`. |

Mio mounts by itself unless you say otherwise — either `window.MIO_AUTO_BOOT = false` before the tag, or `data-mio-auto="false"` on the tag, which is the only opt-out available to a page that can't add a second inline script.

Position is remembered in `localStorage` under `mio-js/position`.

### Events

Lifecycle is reported as DOM CustomEvents on `document`. The shell routes these through `wp.hooks`; here they are plain events, so a page needs nothing but `addEventListener`.

| Event | `detail` |
|---|---|
| `mio:mounted` | `{ position }` |
| `mio:grabbed` | `{ position }` |
| `mio:dropped` | `{ position }` |
| `mio:displaced` | `{ position }` — pushed out of something that landed on it |
| `mio:shape-changed` | `{ shape, from }` |
| `mio:unmounted` | `{}` |

## Build & demo

Run from this directory. `vite` and `pixi.js` resolve from the repo root's `node_modules`, so there is nothing to install here.

```bash
npm run build       # → dist/mio.js (readable) and dist/mio.min.js (shipping)
npm run typecheck   # this library + the plugin src it imports
npm run demo        # → http://localhost:4321/
```

`demo/index.html` is a single static file with headings as collision markers, dashed so you can see the exact rect Mio is colliding with.

`dist/` is committed on purpose. The deliverable *is* a file you can hand someone, and a build output nobody can find is not one.

### Size, and how PixiJS was trimmed

**420 kB minified, 124 kB gzipped**, down from 880 kB / 259 kB before the build was measured. Two things got it there, and neither is tree-shaking doing its job by itself.

Run `BUNDLE_REPORT=1 npm run build` to regenerate `dist/mio.report.html`, the treemap this came from.

**1. Never `import * as PIXI`.** A namespace import must produce a complete object, so every export of Pixi's barrel is retained and tree-shaking cannot start. `src/entry.ts` names the four symbols Mio uses — `Application`, `Container`, `Graphics`, `BlurFilter` — and builds the `window.PIXI` object it hands over. That one line was worth ~400 kB.

**2. Stub the features Mio doesn't use.** Pixi registers each feature by side effect: `lib/index.mjs` imports two dozen `init.mjs` files that call `extensions.add( … )`, and every one is named in Pixi's own `sideEffects` allowlist — which is correct, and is exactly why no bundler can remove them. The four-line init is never the cost; the pipes it registers drag their whole renderer subtree in behind them.

So `vite.config.js` redirects the ones Mio can't reach to an empty module. `PIXI_UNUSED` there lists each with its measured size and the argument for why it is unreachable; the big ones are the event system (83 kB — the canvas is `pointer-events: none` and nothing has an `eventMode`), the WebGPU renderer (84 kB — `autoDetectRenderer` tries WebGL first, and no browser has WebGPU without WebGL), and `@xmldom/xmldom` (166 kB — an XML parser reachable only from Pixi's *Web Worker* environment adapter, which a document never selects).

The canvas renderer is deliberately kept: unlike WebGPU, that fallback is genuinely reachable on a machine with WebGL disabled.

**The trim list is pinned to a PixiJS version** (`PIXI_PINNED`) and the build fails if an entry stops matching. Both guards exist because the failure mode is silence — a moved path just quietly stops trimming, and the bundle gets 400 kB heavier with nothing to show for it.

## How it stands alone

Three things the shell provides that a blog does not, and where each is answered:

| What the shell gives Mio | Here |
|---|---|
| PixiJS via `wp.os.loadModules( [ 'pixijs' ] )` | Bundled, published on `window.PIXI` **for the duration of the mount only** and then restored, so a page with its own PixiJS doesn't find its global swapped. |
| `#os-mio` inside the shell chrome, styled by `desktop.css` | A fixed full-viewport layer appended to `<body>`, with the two rules that matter inlined. `pointer-events: none` on the layer is load-bearing — only the small round handle riding on the body takes clicks, so a click one pixel off Mio reaches the link underneath. |
| `wp.os.getWallpaperSurfaces()` — the live desk | `src/colliders.ts` implements the same interface from a CSS selector. Only ever installed when `wp.os` is genuinely free; on a page that already has the shell, Mio uses the real desk. |

Two shell dependencies are replaced at build time by aliases in `vite.config.js`, each pointing at a stand-in in `src/shims/` whose header explains what it stands in for:

- **`../hooks`** → `wp.hooks` doesn't exist on a blog, and the real module throws without it. Actions come out as DOM events instead.
- **`./style-panel`** → the "Make it yours" panel, which would drag the `<os-*>` component kit, the overlay loader and the i18n layer into a bundle whose whole point is being one file.

If a future `src/mio/*` module picks up a third shell dependency, the build fails rather than shipping something broken — answer it with another shim, not by loosening the aliases.

## License

GPL-2.0-or-later — same as the OpenStation plugin.
