# Example: loading spinner

`<wpd-spinner>` is a self-contained, animated WordPress-mark loading indicator with four curated presets and full per-attribute overrides. CSS variables drive both the disc color and the W-mark accent so the spinner matches any theme.

> Status: **Experimental** since 0.18.0.

## Drop-in

```html
<wpd-spinner></wpd-spinner>                              <!-- classic, 48px, WP blue -->
<wpd-spinner preset="comet" size="80"></wpd-spinner>
<wpd-spinner preset="orbit" color="#0f4c6b"></wpd-spinner>
<wpd-spinner preset="pulse" accent="#fff8e7"></wpd-spinner>
```

## Presets

| Preset | Look |
|---|---|
| `classic` (default) | Three concentric arcs, no dots, no pulse — the canonical WordPress loader. |
| `comet` | Long arcs + 5 trailing dots all spinning the same way. Reads as a comet trail. |
| `orbit` | Half-rings counter-rotating with an opacity breathe. Reads as a planetary orbit. |
| `pulse` | Short arcs + 8 dots + scale + opacity pulse. Reads as a heartbeat. |

Pick one and stop:

```html
<wpd-spinner preset="comet"></wpd-spinner>
```

Want to remix? Every knob from the prototype is overridable on the same element. Attribute-specified values win over the preset's defaults:

```html
<wpd-spinner preset="comet" sp1="6" dots="8"></wpd-spinner>
```

## Colors

Two colors, both CSS-variable-driven:

| Variable | Default | Drives |
|---|---|---|
| `--wpd-spinner-color` | `var(--wp-admin-theme-color, #21759b)` | Disc + ring + dot color |
| `--wpd-spinner-accent` | `#fff` | The W mark inside the disc |
| `--wpd-spinner-size` | `48px` | Host width/height |

Set them via attribute shortcuts (HTML-friendly) or via CSS directly (themeable):

```html
<wpd-spinner color="#1a5f85" accent="#fff8e7" size="80"></wpd-spinner>
```

```css
/* Theme override — works without touching markup */
wpd-spinner.brand {
    --wpd-spinner-color: #6f42c1;
    --wpd-spinner-accent: #ffe;
    --wpd-spinner-size: 64px;
}
```

The accent (W mark) defaults to white because the canonical WP loader is white-on-blue, but it's a real CSS variable — set it to anything for dark-on-light marks, themed brands, or accessibility-driven contrast tweaks.

## Sizing

`size` accepts a bare number (treated as px) or any CSS length:

```html
<wpd-spinner size="32"></wpd-spinner>      <!-- 32px -->
<wpd-spinner size="2em"></wpd-spinner>     <!-- 2em — scales with font-size -->
<wpd-spinner size="clamp(40px, 6vw, 96px)"></wpd-spinner>
```

## Full attribute reference

| Attribute | Type | What it does |
|---|---|---|
| `preset` | `"classic" \| "comet" \| "orbit" \| "pulse"` | Visual personality. Default `classic`. |
| `size` | integer (px) or CSS length | Sets `--wpd-spinner-size`. |
| `color` | CSS color | Sets `--wpd-spinner-color`. |
| `accent` | CSS color | Sets `--wpd-spinner-accent` (the W). |
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
<wpd-spinner label="Saving changes"></wpd-spinner>
<wpd-spinner label="Uploading 3 files"></wpd-spinner>
```

`prefers-reduced-motion: reduce` disables every animation inside the SVG; the mark + rings still render, just statically.

## Common patterns

**Inline with text** — the host is `display: inline-block; vertical-align: middle`:

```html
<button disabled>
    <wpd-spinner size="16"></wpd-spinner>
    Saving…
</button>
```

**Centered overlay** — combine with `<wpd-empty-state>` or any container:

```html
<div class="loading-overlay">
    <wpd-spinner preset="orbit" size="120"></wpd-spinner>
</div>
```

**Programmatic preset switching** — the component re-paints on attribute change:

```js
spinner.setAttribute( 'preset', isError ? 'pulse' : 'classic' );
```

## Programmatic preset registry

Need the preset config in JS (e.g. to render a "preset picker" UI)? The exported `WPD_SPINNER_PRESETS` is a frozen record of every config:

```ts
import { WPD_SPINNER_PRESETS, type WpdSpinnerPreset } from 'desktop-mode/ui';

const names: WpdSpinnerPreset[] = Object.keys( WPD_SPINNER_PRESETS ) as WpdSpinnerPreset[];
console.log( WPD_SPINNER_PRESETS.comet.dots ); // 5
```
