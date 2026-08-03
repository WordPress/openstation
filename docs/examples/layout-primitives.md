# Example: layout primitives (body → panel → row → col)

The shell ships a small set of layout components that compose into the usual native-window shapes without anyone hand-rolling a padding/gap/grid recipe. The recommended stack, outermost to innermost:

1. **`<os-body>`** — fills the window, owns padding + vertical gap + scroll.
2. **`<os-panel>`** — a grouped section inside the body (think settings card).
3. **`<os-row>`** — a 12-column grid for horizontal layouts. Children declare width with `col="N"`.
4. **Any element** (`<os-*>`, `<div>`, third-party custom elements) — the leaf controls.

None of these are mandatory — mix and match as the window's UI dictates.

## The 12-column grid

`<os-row>` is Bootstrap-style: 12 equal tracks, children declare their width via `col="N"` (1..12). The `col` attribute lives on the **child**, not on `<os-row>`, so any element type works:

```html
<os-row>
    <os-text-field col="6" label="First name"></os-text-field>
    <os-text-field col="6" label="Last name"></os-text-field>
</os-row>

<os-row>
    <os-select      col="4" label="Currency">…</os-select>
    <os-number-field col="8" label="Amount"></os-number-field>
</os-row>

<os-row>
    <div col="3">sidebar</div>
    <div col="9">main</div>
</os-row>
```

**Children without `col` span the full row** — matching the intuition that a lone child shouldn't shrink to 1/12th.

### Row attributes

| Attribute | Default | What it does |
|---|---|---|
| `gap` | `12` | Pixel gap between children on both axes. |
| `column-gap` | inherits `gap` | Override just the horizontal gap. |
| `row-gap` | inherits `gap` | Override just the vertical gap (when children wrap). |

## The body wrapper

`<os-body>` is the outermost container inside a native-window render. It sets up the common shape so plugin authors don't re-derive it every time:

| Attribute | Default | What it does |
|---|---|---|
| `gap` | `12` | Vertical gap between top-level children. |
| `padding` | `16` | Inset around all children. Pass `padding="0"` for edge-to-edge canvas content. |
| `scroll` | off | When present, overflow scrolls within the body rather than the window frame. |

```html
<os-body scroll>
    <os-panel>…</os-panel>
    <os-panel>…</os-panel>
</os-body>
```

## Why `<os-body>` is distinct from `<os-panel>`

Short answer: **body wraps the whole window, panels group sections inside the body**.

- **`<os-body>`** fills the window, owns the scroll region, sets the outer padding. One per native window.
- **`<os-panel>`** is a grouped section — think settings card. Zero-to-many per body. Panels compose with their own `gap` and `padding` that's independent of the body's.

You can use `<os-panel>` directly inside a render callback without a body — that works too. The body just codifies the "I want the default native-window layout" case.

## Full example — the converter re-implemented

```php
open_station_register_window( 'converter', array(
    'title'    => __( 'Unit Converter', 'my-plugin' ),
    'width'    => 420,
    'height'   => 320,
    'script'   => 'converter-render',
    'template' => function () {
        ?>
        <os-body scroll>
            <os-panel>
                <os-row>
                    <os-select
                        col="6"
                        label="<?php esc_attr_e( 'From', 'my-plugin' ); ?>"
                        data-role="from"
                    ></os-select>
                    <os-select
                        col="6"
                        label="<?php esc_attr_e( 'To', 'my-plugin' ); ?>"
                        data-role="to"
                    ></os-select>
                </os-row>
                <os-row>
                    <os-number-field
                        col="8"
                        label="<?php esc_attr_e( 'Amount', 'my-plugin' ); ?>"
                        data-role="amount"
                        value="0"
                    ></os-number-field>
                    <os-display
                        col="4"
                        data-role="result"
                        size="xl"
                    >0</os-display>
                </os-row>
            </os-panel>
        </os-body>
        <?php
    },
) );
```

Render callback wires the inputs; the layout is zero hand-rolled CSS:

```js
window.openStationNativeWindows.converter = function ( body ) {
    const from = body.querySelector( '[data-role="from"]' );
    const to   = body.querySelector( '[data-role="to"]' );
    const amt  = body.querySelector( '[data-role="amount"]' );
    const out  = body.querySelector( '[data-role="result"]' );

    from.items = UNITS;
    to.items   = UNITS;
    from.setAttribute( 'value', 'm' );
    to.setAttribute( 'value', 'km' );

    const recompute = () => {
        out.textContent = convert(
            Number( amt.getAttribute( 'value' ) || '0' ),
            from.getAttribute( 'value' ),
            to.getAttribute( 'value' ),
        );
    };
    from.addEventListener( 'os-pick', recompute );
    to.addEventListener( 'os-pick', recompute );
    amt.addEventListener( 'os-input-change', recompute );
};
```

## Decision guide

| Want… | Use |
|---|---|
| Two fields on the same line, equal width | `<os-row>` + `col="6"` twice |
| Sidebar + main content | `<os-row>` + `col="3"` / `col="9"` |
| Three thirds | `col="4"` three times |
| Uniform cell grid (calculator keypad, photo thumbnails) | `<os-grid columns="4" gap="8">` — not `<os-row>` |
| A stack of full-width cards | `<os-stack gap="12">` — the common case, no col math needed |
| Single column with padding + scroll around the window body | `<os-body scroll>` |
| Grouped section with its own rhythm | `<os-panel gap="8">` |

`<os-row>` is the right reach for **mixed-width horizontal layouts**. For uniform grids (every cell the same size), `<os-grid>` is simpler. For vertical stacking, `<os-stack>` costs nothing.

## Inline styles via the `style` array

`open_station_component()` accepts `style` as either the usual string value or an associative array of CSS-property → value pairs. The array form serializes to a single `style="…"` attribute with auto-unit for length-shaped properties.

```php
open_station_component( 'os-stack', array(
    'gap'   => 12,
    'style' => array(
        'padding'       => 0,
        'background'    => 'rgba(0,0,0,0.04)',
        'border-radius' => 8,
    ),
), $children );
// → <os-stack gap="12" style="padding: 0; background: rgba(0,0,0,0.04); border-radius: 8px">
```

The array form is the ergonomic path — it mirrors the React/Vue `style` prop. Dynamic styling composes naturally: `'padding' => $dense ? 0 : 16`, `'color' => $isError ? '#d63638' : null` (null/false entries are dropped).

### Plain string form still works

```php
open_station_component( 'os-stack', array(
    'style' => 'padding: 0; margin-top: 16px',
), $children );
```

### Auto-unit for length-shaped properties

Bare integers on length-shaped properties (`padding`, `margin`, `width`, `height`, `gap`, `border-width`, `border-radius`, positional insets, …) auto-unit to pixels. Everything else passes through verbatim.

| Value in PHP | Serialized |
|---|---|
| `'padding' => 16` | `padding: 16px` |
| `'padding' => 0` | `padding: 0` (CSS treats `0` as dimensionless on any property) |
| `'padding' => '1rem'` | `padding: 1rem` |
| `'padding' => 'calc(1em + 4px)'` | `padding: calc(1em + 4px)` |
| `'z-index' => 5` | `z-index: 5` (non-length, no unit) |
| `'opacity' => 0.5` | `opacity: 0.5` (non-length, no unit) |
| `'margin' => null` | (entry dropped) |
| `'margin' => false` | (entry dropped) |

### Hand-written HTML: native `style="…"` attribute

Inline HTML keeps working the same as any other HTML element — `<os-stack style="padding: 0">` sets the host's inline style, which beats the component's shadow-CSS default via specificity. Use the PHP helper's `style` array when you want programmatic composition; use the raw `style="…"` attribute when you're writing markup by hand.

### Components that declare their own spacing props

`<os-body>`, `<os-panel>`, and `<os-stack>` still declare their own `padding` prop that routes through a CSS custom property (`--os-ui-body-padding`, `--os-ui-panel-padding`, `--os-ui-stack-padding`). Both paths coexist:

- `<os-body padding="0">` — uses the component's own prop, sets `--os-ui-body-padding: 0px`.
- `<os-body style="padding: 0">` (or `'style' => [ 'padding' => 0 ]`) — sets inline `style="padding: 0"`, wins via specificity.

Either works. The prop form is the older convention; the `style` array is the generic mechanism that works across every `<os-*>` regardless of whether it declared a matching prop.

## `classNames` — JS array setter for programmatic class lists

Plain HTML `class="foo bar"` works natively on every `<os-*>` component (they're all HTMLElements). For JS-driven styling where an array of conditional classes is already in hand, each component has a `classNames` property:

```js
const card = document.querySelector( 'os-panel' );

card.classNames = [ 'brand', 'is-active', 'is-focused' ];
// → <os-panel class="brand is-active is-focused">

card.classNames = [ 'dense' ];
// → <os-panel class="dense">  (replaces, doesn't merge)

card.classNames = null;
// → class attribute removed entirely

// Getter returns an array of currently-applied classes.
card.classNames; // ['dense']
```

The classes go on the host element, which lives in light DOM. That means external plugin CSS enqueued via `wp_enqueue_style()` targets the host directly — the shadow boundary doesn't block class selectors on the host itself. Useful for branding a shell component with a plugin-owned accent colour or typography setting:

```css
/* In the plugin's enqueued stylesheet */
os-panel.brand {
    --wp-admin-theme-color: #ff00ff;
    font-family: 'Marvelous Sans';
}
```

Passing a string also works — it's split on whitespace the same way `class="…"` parses:

```js
card.classNames = 'brand dense';
// → <os-panel class="brand dense">
```

The classes you apply don't automatically penetrate the shadow root. CSS custom properties (the `--foo` kind) DO inherit through, so setting `--wp-admin-theme-color` on the host via a plugin class propagates to everything inside.

## Auto-id — and how to override it

Input components (`<os-text-field>`, `<os-number-field>`, `<os-select>`) auto-generate a deterministic `id` on the host based on their DOM ancestry:

```
os-<window>-<tab-path>-<label-slug>
```

Example: a `<os-select label="From unit">` inside `<os-tabpanel for="convert">` inside `<div id="wp-window-calculator">` gets `id="os-calculator-tab-convert-from-unit"` automatically. The inner `<select>` gets the same id with a `__input` suffix, and the component's `<label>` uses `for=` to pair them — clicking the label focuses the control.

**Same ancestry + same label always produces the same id.** Plugin authors can `document.getElementById( 'os-calculator-tab-convert-from-unit' )` and know they're reaching the same element across rebuilds.

### Overriding the auto-id

Pass a custom `id` attribute and the auto-id machinery steps aside:

```html
<os-select id="my-brand-picker" label="Currency">
    <os-option value="eur">Euro</os-option>
    <os-option value="usd">US Dollar</os-option>
</os-select>
```

The host keeps `id="my-brand-picker"`, the inner `<select>` gets `id="my-brand-picker__input"`, and `<label for="my-brand-picker__input">` pairs correctly. Auto-id only fires when the caller didn't set one.

## Accessibility notes

- `<os-body>`, `<os-panel>`, `<os-row>`, `<os-grid>` are pure-layout elements with no implicit role. They don't affect the accessibility tree; children retain whatever role they declared.
- `<os-row>` uses CSS grid under the hood — standard browser behaviour for keyboard navigation and screen readers applies to its children.
- Auto-id guarantees that input controls have a stable `id` and a real `<label for>` pairing inside the shadow root — both silence Chrome's "form field needs an id or name" warning and give screen readers a proper accessible name.

## `<os-ribbon>` — corner ribbon decoration *(experimental)*

A 45° banner that wraps a corner of its parent — the classic "FEATURED / NEW / BETA / SALE" stamp on a card. The component owns its own clipping geometry; consumers only need to make the parent a positioned containing block.

```html
<article class="my-card" style="position: relative;">
    <os-ribbon>Featured</os-ribbon>
    <h3>Card title</h3>
    <p>Card body…</p>
</article>
```

> ⚠️ **Parent must be positioned.** `<os-ribbon>` uses `position: absolute` on its host. Without `position: relative` (or `absolute` / `fixed` / `sticky`) on the parent, the ribbon anchors to the next positioned ancestor up the tree — usually the window body — and floats over the wrong thing entirely.

### Attribute matrix

| Attribute | Values | Default | Notes |
|---|---|---|---|
| `placement` | `top-end` · `top-start` · `bottom-end` · `bottom-start` | `top-end` | Logical end/start, so LTR/RTL flip for free. The 45° rotation sign also flips under `[dir='rtl']`. |
| `tone` | `primary` · `success` · `warning` · `danger` · `info` · `neutral` | `primary` | Background tint. `primary` uses `--wp-admin-theme-color` so the ribbon picks up the active color scheme automatically. Matches `<os-badge>`'s palette so the two surfaces feel like a set. |

```html
<os-ribbon placement="bottom-start" tone="success">New</os-ribbon>
<os-ribbon placement="top-start" tone="warning">Beta</os-ribbon>
```

### CSS-variable surface

The host honours these custom properties for per-instance tuning without touching the component source. Set them on the host (or on any ancestor) to retheme:

| Variable | Default | What it controls |
|---|---|---|
| `--os-ui-ribbon-size` | `90px` | Square clipping window edge. Smaller cards usually want `60px–70px`. |
| `--os-ui-ribbon-banner-width` | `140px` | Width of the rotated strip (before clipping). |
| `--os-ui-ribbon-banner-offset` | `20px` | Distance from the corner to the strip's perpendicular centerline. |
| `--os-ui-ribbon-banner-pull` | `-36px` | How far the strip overhangs the clip edge along the inline axis. |
| `--os-ui-ribbon-bg` | `var(--wp-admin-theme-color, #2271b1)` | Banner background — overrides `tone` when set. |
| `--os-ui-ribbon-fg` | `#fff` | Banner text color. |
| `--os-ui-ribbon-shadow` | `0 2px 4px rgba(0,0,0,0.2)` | Drop shadow under the banner. |
| `--os-ui-ribbon-padding` | `4px 0` | Vertical padding of the strip. |
| `--os-ui-ribbon-font` | `700 10px/1.4 system-ui` | Banner text typography shorthand. |
| `--os-ui-ribbon-tracking` | `0.06em` | Letter-spacing. |
| `--os-ui-ribbon-z` | `2` | Stacking order relative to other absolutely-positioned children of the parent. |

### Styling the banner externally with `::part(banner)`

The rotated strip is exposed as the `banner` shadow part, so consumers can apply CSS that shadow-DOM `--os-ui-ribbon-*` variables don't cover (e.g. a gradient background, a custom font face):

```css
my-card os-ribbon::part(banner) {
    background: linear-gradient(135deg, #ff6a00, #ee0979);
}
```

### Accessibility

The ribbon is decorative — there is no implicit `role` and `pointer-events: none` is set on the host, so it never steals clicks. If the label carries meaningful information that screen readers shouldn't miss, surface it elsewhere in the card body (e.g. a visually-hidden span repeating the status), since rotated text inside a decorative shadow boundary isn't a reliable a11y surface.

## Related docs

- [`<os-stack>`, `<os-cluster>`, `<os-grid>`](../javascript-reference.md) — other layout primitives.
- [Native window with tabs](./native-window-with-tabs.md) — tab auto-swap pattern that composes with the layout stack.
- [`<os-select>`, `<os-text-field>`, `<os-number-field>`](../javascript-reference.md) — the form primitives used in the example above.
