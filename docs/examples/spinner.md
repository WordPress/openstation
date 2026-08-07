# Example: loading spinner

`<os-spinner>` is a self-contained, animated WordPress-mark loading indicator with five curated presets and full per-attribute overrides. CSS variables drive both the disc color and the W-mark accent so the spinner matches any theme.

Four of the presets are re-tunings of the same mark-and-rings artwork. The fifth, `inline`, is a different indicator for a different job — see [Inline: spinners that sit beside text](#inline-spinners-that-sit-beside-text).

> Status: **Experimental**.

## Drop-in

```html
<os-spinner></os-spinner>                              <!-- classic, 48px, WP blue -->
<os-spinner preset="comet" size="80"></os-spinner>
<os-spinner preset="orbit" color="#0f4c6b"></os-spinner>
<os-spinner preset="pulse" accent="#fff8e7"></os-spinner>
<os-spinner preset="inline"></os-spinner>              <!-- 16px bare arc, currentColor -->
```

## Presets

| Preset | Look |
|---|---|
| `classic` (default) | Three concentric arcs, no dots, no pulse — the canonical WordPress loader. |
| `comet` | Long arcs + 5 trailing dots all spinning the same way. Reads as a comet trail. |
| `orbit` | Half-rings counter-rotating with an opacity breathe. Reads as a planetary orbit. |
| `pulse` | Short arcs + 8 dots + scale + opacity pulse. Reads as a heartbeat. |
| `inline` | One track ring, one rotating arc. No WordPress mark, no concentric rings, no dots. Defaults to 16px and `currentColor`. |

Pick one and stop:

```html
<os-spinner preset="comet"></os-spinner>
```

Want to remix? Every knob from the prototype is overridable on the same element. Attribute-specified values win over the preset's defaults:

```html
<os-spinner preset="comet" sp1="6" dots="8"></os-spinner>
```

## Inline: spinners that sit beside text

The other four presets share one piece of artwork: a filled disc carrying the four-path WordPress "W", ringed by three concentric arcs and optionally a fourth ring of dots. It is built for a viewBox roughly 150 units across, and it needs about **40px** of real estate to be recognisable. Below that, every stroke lands under a physical pixel and the whole thing greys out into a smudge — the user sees *something moved*, not *the site is working*.

`inline` is the answer for the other case: a spinner that has to live beside a line of text — inside a button, at the head of a list row, next to a status line.

```html
<os-spinner preset="inline"></os-spinner>
<os-spinner preset="inline" size="14" label="Thinking"></os-spinner>
```

Two differences beyond the artwork, both deliberate:

- **It defaults to 16px**, not 48px. An inline spinner that has to be told its own size every time is a footgun.
- **It inherits `currentColor`** instead of `--wp-admin-theme-color`. It belongs to the text it interrupts, so it tints itself from that text and can never lose contrast against a surface the component knows nothing about — a glass widget card over an arbitrary wallpaper, say. Pass `color` to override.

The tempo and arc-length knobs still apply, so you can slow it down or lengthen the arc like any other preset:

```html
<os-spinner preset="inline" sp1="14" a1="35"></os-spinner>
```

Everything else (`dots`, `gap`, `pulse`, `sp2`/`sp3`, `a2`/`a3`, `accent`) is inert here — there is no disc, no mark, and no second or third ring for them to act on.

## Colors

Two colors, both CSS-variable-driven:

| Variable | Default | Drives |
|---|---|---|
| `--os-ui-spinner-color` | `var(--wp-admin-theme-color, #21759b)` | Disc + ring + dot color |
| `--os-ui-spinner-accent` | `#fff` | The W mark inside the disc |
| `--os-ui-spinner-size` | `48px` | Host width/height |

Set them via attribute shortcuts (HTML-friendly) or via CSS directly (themeable):

```html
<os-spinner color="#1a5f85" accent="#fff8e7" size="80"></os-spinner>
```

```css
/* Theme override — works without touching markup */
os-spinner.brand {
    --os-ui-spinner-color: #6f42c1;
    --os-ui-spinner-accent: #ffe;
    --os-ui-spinner-size: 64px;
}
```

The accent (W mark) defaults to white because the canonical WP loader is white-on-blue, but it's a real CSS variable — set it to anything for dark-on-light marks, themed brands, or accessibility-driven contrast tweaks.

## Sizing

`size` accepts a bare number (treated as px) or any CSS length:

```html
<os-spinner size="32"></os-spinner>      <!-- 32px -->
<os-spinner size="2em"></os-spinner>     <!-- 2em — scales with font-size -->
<os-spinner size="clamp(40px, 6vw, 96px)"></os-spinner>
```

## Full attribute reference

| Attribute | Type | What it does |
|---|---|---|
| `preset` | `"classic" \| "comet" \| "orbit" \| "pulse" \| "inline"` | Visual personality. Default `classic`. |
| `size` | integer (px) or CSS length | Sets `--os-ui-spinner-size`. Default `48` — `16` under `preset="inline"`. |
| `color` | CSS color | Sets `--os-ui-spinner-color`. |
| `accent` | CSS color | Sets `--os-ui-spinner-accent` (the W). |
| `sp1`, `sp2`, `sp3` | integer (deciseconds) | Per-ring rotation duration; 12 → 1.2s. |
| `a1`, `a2`, `a3` | integer (0–100) | Per-ring arc length as % of circumference. |
| `gap` | integer | Gap between concentric rings. |
| `dir2`, `dir3` | `"1" \| "-1" \| "cw" \| "ccw"` | Per-ring direction; ring 1 is always CW. |
| `pulse` | `"none" \| "scale" \| "opacity" \| "both"` | Pulse animation on the disc + W mark. |
| `dots` | integer | Outer trailing dot count. Sensible: 0, 3, 5, 8. |
| `label` | string | Accessible name. Default `"Loading"`. |

## Accessibility

The component renders an `<svg role="img" aria-label="Loading">`. Customize the label whenever the spinner has a more specific meaning:

```html
<os-spinner label="Saving changes"></os-spinner>
<os-spinner label="Uploading 3 files"></os-spinner>
```

`prefers-reduced-motion: reduce` disables every animation inside the SVG; the mark + rings still render, just statically.

## Common patterns

**Inline with text** — the host is `display: inline-block; vertical-align: middle`:

```html
<button disabled>
    <os-spinner size="16"></os-spinner>
    Saving…
</button>
```

**Centered overlay** — combine with `<os-empty-state>` or any container:

```html
<div class="loading-overlay">
    <os-spinner preset="orbit" size="120"></os-spinner>
</div>
```

**Programmatic preset switching** — the component re-paints on attribute change:

```js
spinner.setAttribute( 'preset', isError ? 'pulse' : 'classic' );
```

## Programmatic preset registry

Need the preset config in JS (e.g. to render a "preset picker" UI)? The exported `OS_SPINNER_PRESETS` is a frozen record of every config:

```ts
import { OS_SPINNER_PRESETS, type OsSpinnerPreset } from 'openstation/ui';

const names: OsSpinnerPreset[] = Object.keys( OS_SPINNER_PRESETS ) as OsSpinnerPreset[];
console.log( OS_SPINNER_PRESETS.comet.dots ); // 5
```
