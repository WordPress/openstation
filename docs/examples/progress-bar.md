# Example: progress bar

`<os-progress-bar>` is a linear progress indicator with two modes
(determinate, indeterminate), four tones, and a built-in label /
percent header. Used by the OS-file-drop upload HUD and available
to any feature that needs a value-driven bar.

> Status: **Experimental**.

## Drop-in

```html
<os-progress-bar value="42"></os-progress-bar>

<os-progress-bar indeterminate label="Uploading…"></os-progress-bar>

<os-progress-bar
    value="280"
    max="320"
    tone="success"
    label="hero.jpg"
    show-percent
></os-progress-bar>
```

## Modes

| Mode | When to use | How |
|---|---|---|
| Determinate | You have a running `loaded / total`. | Set `value` (and optionally `max`, default `100`). The fill width animates between updates. |
| Indeterminate | You don't know the total, or the work is open-ended. | Set the boolean `indeterminate` attribute. A 33%-wide bar sweeps across the track on a 1.1s linear loop. |

Switch modes live by toggling the `indeterminate` attribute — the
component repaints on every attribute change.

## Tones

Tints the fill via the shared `--os-status-*` palette so
the bar reads the same as toasts, ribbons, and notices.

```html
<os-progress-bar value="80" tone="success"></os-progress-bar>
<os-progress-bar value="80" tone="warning"></os-progress-bar>
<os-progress-bar value="80" tone="danger"></os-progress-bar>
```

## Inline label + percent

```html
<os-progress-bar
    value="42"
    label="Uploading hero.jpg"
    show-percent
></os-progress-bar>
```

Renders the label on the left of a small header row and a
right-aligned `42%` readout. The label is also wired into the
track's `aria-label`. `show-percent` is a boolean attribute.

## Driving it from JS

```js
const bar = document.createElement( 'os-progress-bar' );
bar.setAttribute( 'indeterminate', '' );
bar.setAttribute( 'show-percent', '' );
host.appendChild( bar );

// …a moment later, real progress arrives:
bar.removeAttribute( 'indeterminate' );
bar.setAttribute( 'max', String( total ) );
bar.setAttribute( 'value', String( loaded ) );
```

## Theming

Every surface is overridable via CSS variables on the host:

| Variable | Default | Purpose |
|---|---|---|
| `--os-ui-progress-track-bg` | `var(--os-control-bg, rgba(0,0,0,0.08))` | Track background. |
| `--os-ui-progress-fill` | `var(--wp-admin-theme-color, #2271b1)` | Fill color (overridden by the `tone` attribute). |
| `--os-ui-progress-height` | `6px` | Track height. |
| `--os-ui-progress-radius` | `999px` | Track + fill border-radius. |
| `--os-ui-progress-label-color` | `inherit` | Header text color. |
| `--os-ui-progress-label-size` | `12px` | Header font size. |
| `--os-ui-progress-label-gap` | `4px` | Space between header and track. |

```css
my-feature {
    --os-ui-progress-height: 10px;
    --os-ui-progress-radius: 4px;
    --os-ui-progress-fill: #5e3aee;
}
```

## Accessibility

Determinate mode wires `role="progressbar"` with
`aria-valuemin / aria-valuemax / aria-valuenow`. Indeterminate
mode drops the `aria-valuenow / aria-valuemax` attributes (which
is the spec's signal for indeterminate state). `label` is mirrored
onto `aria-label`. `prefers-reduced-motion: reduce` disables the
indeterminate sweep and the fill-width transition.

## Where it's used in the shell

- OS-file-drop upload HUD — `src/os-file-drop/progress-hud.ts`
  (see [`docs/examples/os-file-drop.md`](os-file-drop.md)).
