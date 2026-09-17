# App layout recipes

`os-app-frame`, `os-split`, and `os-grid`, including automatic column fitting
and child column/row spans, are **Stable**.
Use these in PHP views or client `html` templates. Load the components first:
`await wp.os.loadComponents( [ 'os-app-frame', 'os-split', 'os-grid', 'os-panel', 'os-stack', 'os-cluster', 'os-button' ] )`,
or import their leaf modules when building in this repository. Components appear
in Preferences → Components with live examples.

## Dashboard: automatic columns and spans

```html
<os-grid min-item-width="240" gap="12">
    <os-panel col-span="2">Main chart</os-panel>
    <os-panel row-span="2">Activity</os-panel>
    <os-panel>Orders</os-panel>
    <os-panel>Visitors</os-panel>
</os-grid>
```

`min-item-width` is a positive pixel number: the grid fits as many equal columns
as its own content width allows, including the computed column gap. It overrides
`columns`; removing it restores the fixed-column behavior. Below the minimum,
a single column fits the available width without horizontal overflow. This is
independent of viewport width and works inside nested panes.

Direct children of any element type can declare `col-span="1"` through `"12"`
and `row-span="1"` through `"12"`. Column spans clamp to the available columns;
in automatic one-column mode, row spans and the explicit `rows` count reset to
content sizing. Invalid spans behave as ordinary one-cell items. Spans never
cross between separate grids. Placement follows DOM order; no dense packing or
visual reordering changes the reading order. Existing `os-row` child `col`
attributes retain their twelve-track meaning.

The existing `columns`, `rows`, `gap`, `column-gap`, `row-gap` attributes and
`--os-ui-grid-*` tokens remain available. Gaps are nonnegative pixel integers;
row/column counts are positive integers. Removed or invalid attribute overrides
restore the prior inline token, or fall back to stylesheet defaults. Use `columns` or `min-item-width` when
using spans so the grid knows the track count.

## Settings: scrolling content, persistent actions

```html
<os-app-frame style="height: 480px">
    <h2 slot="header">Preferences</h2>
    <os-stack gap="16">
        <os-panel>Account fields</os-panel>
        <os-panel>Notification fields</os-panel>
    </os-stack>
    <os-cluster slot="footer" justify="end">
        <os-button variant="primary">Save</os-button>
    </os-cluster>
</os-app-frame>
```

The frame fills a parent with a definite height; standalone examples set one
explicitly. `header`, `toolbar`, and `footer` slots take their content height.
The default slot gets the remaining height and scrolls. The frame owns no
padding, colors, landmarks, or toolbar role: use panels for insets and provide
appropriate semantics on your slotted content. `::part(content)` exposes the
body region for app styling.

`contained` disables frame scrolling and stretches default-slot children into
the available height. Use it with a split pane, table, or other component that
owns its scrolling. Avoid nesting multiple scrolling wrappers unnecessarily.

## List/detail: bounded, resizable panes

```html
<os-app-frame contained style="height: 480px">
    <os-cluster slot="toolbar"><os-button>New item</os-button></os-cluster>
    <os-split resizable label="Resize item list" position="35"
        min-start="180" min-end="260" collapse-at="600" narrow="start">
        <os-panel slot="start">Item list</os-panel>
        <os-panel slot="end">Selected item</os-panel>
    </os-split>
    <span slot="footer">Ready</span>
</os-app-frame>
```

Each pane fills its region and scrolls independently. `position` is the start
pane's percentage of space excluding the 8px divider, default 35. `min-start`
and `min-end` are pixel minima, default 160 each. When both cannot fit, they
scale proportionally. Without `resizable`, there is no interactive divider.
`::part(start)`, `::part(end)`, and `::part(divider)` expose the regions;
the divider keeps an 8px pointer target around a hairline and rounded grip.
The seam reads `--os-ui-border`, the grip reads `--os-ui-fg-faint`,
and hover, dragging and keyboard focus use `--os-ui-accent`. Reduced motion
disables the color transition.

At `collapse-at` pixels or narrower (default 600), horizontal splits use `narrow`:
`stack` (default) shows both panes vertically, `start` or `end` shows only that
pane. Set `collapse-at="0"` to disable automatic collapse, or `compact` to force
it. Narrow mode disables resizing and preserves the requested wide position.
The app decides when to set `narrow="end"` after selection and must provide its
own Back control to set `narrow="start"`. Hidden panes remain mounted, preserving
drafts and component state. Comments uses this pattern, including `compact`
when the shell explicitly selects phone mode.

Provide a translated `label` for the focusable separator. Arrow keys move it
2 percentage points; Shift moves 10; Home/End go to the pane limits. Horizontal
arrows follow physical direction in RTL. Escape or `pointercancel` rolls back
a drag. Losing pointer capture without a preceding cancellation commits the
last visible position, even if `pointerup` never reaches the separator.
Layout reflow during a drag keeps it active at its current position;
crossing into narrow mode cancels it. Pointer capture and a temporary shield
keep dragging reliable over iframes. The separator exposes orientation, current value, limits and its
controlled pane to assistive technology. Layout containers add no tab stops
apart from an enabled separator.

Committed user resizing emits a bubbling, composed `os-split-change` with
`{ position: number }`. Attribute changes and container resizing emit nothing.
No storage is written; apps own persistence and may listen or use
`os-action="save_layout"` (the runtime passes `$args['position']`). Do not use
`os-bind` for this event: its payload has `position`, not `value`.

## Editor/preview: vertical split

```html
<os-split direction="vertical" resizable label="Resize preview"
    min-start="100" min-end="100" style="height: 480px">
    <os-panel slot="start">Editor</os-panel>
    <os-panel slot="end">Preview</os-panel>
</os-split>
```

Vertical splits use Up/Down keys and height-based minima. They do not
collapse automatically based on width. Nested splits are supported; each one
measures its own available space. `compact` can explicitly force narrow mode.

For basic rows, columns and twelve-track forms, see [layout primitives](./layout-primitives.md).
For responsive fields with labels, hints and errors, use `os-form` and
`os-field-row` from the [component kit](../components-reference.md).
