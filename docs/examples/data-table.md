# Example: render a data table

`<wpd-table>` is the data-grid primitive: assign a `columns` descriptor and a `data` array and you get a styled table with optional per-column filters, click-to-sort, multi-row selection, sticky columns, sticky header, custom cell renderers, a loading skeleton, and a slottable empty state.

> Status: **Experimental** since 0.6.0. The component shape is stable; the named events / filter kinds may grow.

## Minimum viable table

```html
<wpd-table id="users"></wpd-table>
```

```js
const table = document.getElementById( 'users' );
table.columns = [
    { key: 'name',  label: 'Name' },
    { key: 'email', label: 'Email' },
    { key: 'role',  label: 'Role' },
];
table.data = [
    { name: 'Alice', email: 'alice@a.com', role: 'admin' },
    { name: 'Bob',   email: 'bob@b.com',   role: 'editor' },
];
```

That's the entire happy path. Everything below is opt-in.

## TypeScript usage

The `WpdTable` class is generic over the row type, but it is not yet on the **Stable** export list of the `desktop-mode` package (see [Importing the classes](../components-reference.md#importing-the-classes-for-typescript)) — there is no class or type import for it. Until it joins that list, declare the slice of the element API you use as a local structural type; the property contract below is the documented surface:

```ts
interface User extends Record< string, unknown > {
    name: string;
    email: string;
    role: 'admin' | 'editor';
    logins: number;
}

interface UserColumn {
    key: string;
    label?: string;
    filter?: boolean | 'text' | 'select';
    sortable?: boolean;
    align?: 'start' | 'center' | 'end';
    sortValue?: ( row: User, value: unknown ) => unknown;
    render?: ( value: unknown, row: User, index: number ) => string | Node;
}

type UserTable = HTMLElement & {
    columns: UserColumn[];
    data: User[];
    getRowId: ( row: User, index: number ) => string | number;
};

const columns: UserColumn[] = [
    { key: 'name',   label: 'Name',   filter: 'text', sortable: true },
    { key: 'email',  label: 'Email',  filter: 'text' },
    { key: 'role',   label: 'Role',   filter: 'select' },
    { key: 'logins', label: 'Logins', align: 'end', sortable: true },
];

const table = document.querySelector< UserTable >( '#users' )!;
table.columns = columns;
table.data    = users;
table.getRowId = ( row ) => row.email; // stable id for selection
```

## Per-column filters

Set `column.filter` to put a filter input under the header. Two kinds:

- `'text'` (or `true`) — substring, case-insensitive.
- `'select'` — dropdown built from the unique column values.

```js
table.columns = [
    { key: 'name',  label: 'Name',  filter: 'text' },
    { key: 'email', label: 'Email', filter: 'text' },
    { key: 'role',  label: 'Role',  filter: 'select' },
];
```

Filter inputs are persistent across re-paints, so typing never loses focus or caret position. Read or pre-seed the filter map via `table.filters`, listen for changes, and clear them with the built-in method:

```js
table.filters = { role: 'admin' };          // pre-seed
table.addEventListener( 'wpd-table-filter-change', ( e ) => {
    console.log( e.detail.filters );
} );
table.clearFilters();                       // drop everything (emits filter-change)
```

## Click-to-sort

Set `column.sortable = true` and the header cycles **asc → desc → unsorted** on click. Numbers compare numerically; everything else falls back to a locale-aware string compare. Provide `column.sortValue` for shaped sorts:

```js
table.columns = [
    { key: 'name',     label: 'Name',     sortable: true },
    { key: 'created',  label: 'Created',  sortable: true,
      sortValue: ( row ) => Date.parse( row.created ) },
    { key: 'priority', label: 'Priority', sortable: true,
      sortValue: ( row ) => ({ low: 0, med: 1, high: 2 }[ row.priority ]) },
];
```

Read or set the active sort programmatically:

```js
table.sort = { key: 'name', direction: 'asc' };
table.addEventListener( 'wpd-table-sort-change', ( e ) => {
    persist( e.detail.sort );               // null when cleared
} );
table.clearSort();
```

If you don't want the built-in sort but want to react to header clicks (e.g. server-side sort), declare `sortable: true` and listen for `wpd-table-sort-change` — your handler can re-fetch and reassign `table.data` while letting the indicator UI handle itself.

## Selection

Set `selectable="single"` or `selectable="multi"` and a checkbox column is auto-prepended. Multi mode adds a select-all checkbox in the header; single mode enforces at-most-one selected.

```html
<wpd-table id="users" selectable="multi"></wpd-table>
```

```js
table.getRowId = ( row ) => row.email;      // stable id (default: row index)
table.addEventListener( 'wpd-table-selection-change', ( e ) => {
    console.log( e.detail.selection ); // ids[]
    console.log( e.detail.rows );      // resolved row objects
} );

// Programmatic API
table.select( 'alice@a.com' );
table.deselect( 'alice@a.com' );
table.selectAll();                          // multi only — selects the VISIBLE rows
table.clearSelection();
table.selection = new Set( savedIds );      // bulk replace
```

`selectAll()` (and the header select-all checkbox) selects the rows passing the active client-side filters — never rows a filter is currently hiding. The header checkbox tri-state follows the same rule: "checked" means every *visible* row is selected. Tables without client-side filters are unaffected.

**Why `getRowId` matters:** when the user reloads `data` from the server, selections survive the refresh because they're keyed by stable id, not array index. Fall back to the default (index) only when rows have no natural identifier.

**Ids must be unique across the whole data set.** If the table mixes entity kinds whose id sequences are independent (e.g. posts and comments carry numeric ids from different tables), qualify the id with the kind — ``getRowId = ( row ) => `${ row.type }:${ row.id }` `` — or two different rows will share one selection key and select (and act) together.

**Destructive consumers: clear the selection when the data set changes.** Selection deliberately survives `data` reassignment, so ids from a previous page / search / filter linger invisibly. If your bulk actions consume `table.selection` (trash, delete, role changes…), call `table.clearSelection()` whenever the query changes — otherwise a forgotten off-page selection rides silently into the next action. See `src/comments-window/index.ts` and `src/posts-window/index.ts` for the pattern.

## Sticky columns and sticky header

```html
<wpd-table sticky-columns="2" sticky-header striped hover></wpd-table>
```

- `sticky-columns="N"` pins the first `N` columns. Widths are measured after layout and re-measured automatically — every paint runs three measurement passes (synchronous, microtask, animation frame) and a `ResizeObserver` watches the inner scroll element + the host so window resizes, hidden→visible transitions, sibling reflow, font loads, and scrollbar appearance all trigger a recompute. You don't have to call anything; offsets stay correct. Variable-width columns work, including RTL via `inset-inline-start`.

  If a column-1+ sticky cell ever ends up at `inset-inline-start: 0px` while the host is visible, the component logs a one-time `console.warn` with the measured widths and a pointer to `recomputeLayout()`. That should never fire in practice — it's an "if you see this, you've found the bug" tripwire.
- `sticky-header` keeps the header (plus the filter row, if any) pinned.
- Per-column override: `column.sticky = true` opts in even outside the band, `column.sticky = false` opts out within it.

For sticky to engage the table needs a scrolling container. Set `--wpd-table-max-height` (or wrap in any scrolling parent):

```css
wpd-table { --wpd-table-max-height: 400px; }
```

If you set `sticky-header` on a table with no scroll container, the component logs a one-time `console.warn` after enough data has loaded to need scrolling — saves the "why isn't it sticking?" debug session.

### Worked example: sticky-columns counting

The auto-injected expander (subTable) and select (selectable) columns count as **leading** sticky columns. Plan `sticky-columns` accordingly:

| Setup | `sticky-columns="N"` keeps pinned |
|---|---|
| 4 data columns, no sub-table, no selection | `2` → cols 0, 1 |
| 4 data columns + `subTable` (expander prepended) | `2` → expander, col 0 |
| 4 data columns + `selectable="multi"` | `2` → checkbox, col 0 |
| 4 data columns + `selectable="multi"` + `subTable` | `3` → checkbox, expander, col 0 |

Rule of thumb: count from the visible left edge after all auto-prepended columns. If you want the *checkbox + expander + name + email* pinned in the busy case, that's `sticky-columns="4"`.

## Sub-tables (expandable rows)

Set `subTable( row, index )` and an expander column is auto-prepended. Return any of:

- `null` / `undefined` — no children for this row (no caret).
- `{ columns, data, subTable? }` — a nested `<wpd-table>` is rendered. Sub-tables can themselves declare a `subTable` for unlimited nesting.
- A `Node` — fully custom expanded content (build it with `document.createElement` or by cloning a `<template>`).

```js
table.subTable = ( order ) => order.items?.length
    ? {
        columns: [
            { key: 'sku',  label: 'SKU' },
            { key: 'qty',  label: 'Qty', align: 'end' },
            { key: 'name', label: 'Item' },
        ],
        data: order.items,
    }
    : null;
```

Programmatic control of expansion:

```js
table.expand( 3 );
table.collapse( 3 );
table.expandAll();        // every row that has children
table.collapseAll();
table.isExpanded( 3 );    // boolean

// Read or replace the full open set — useful for restoring state.
const open = Array.from( table.expanded );
localStorage.setItem( 'orders.open', JSON.stringify( open ) );
table.expanded = JSON.parse( localStorage.getItem( 'orders.open' ) || '[]' );
```

## Loading state

```html
<wpd-table loading loading-rows="5"></wpd-table>
```

While `loading` is set, the body paints shimmering skeleton rows. Headers, filters, and sort indicators remain live. Toggle the attribute when the fetch resolves:

```js
table.toggleAttribute( 'loading', true );
const data = await fetch( '/api/users' ).then( ( r ) => r.json() );
table.data = data;
table.toggleAttribute( 'loading', false );
```

`prefers-reduced-motion: reduce` disables the shimmer animation automatically.

## Empty state with a CTA

The `empty` attribute is the text fallback. For richer empty states (button, illustration, multi-line copy) project light-DOM into the `empty` slot:

```html
<wpd-table id="orders">
    <div slot="empty">
        <p>No orders yet.</p>
        <wpd-button id="orders-cta">Create your first order</wpd-button>
    </div>
</wpd-table>
```

```js
document.getElementById( 'orders-cta' ).addEventListener( 'click', openWizard );
```

The slotted content shows whenever `data.length === 0` OR every row got filtered out. If you want different empty states for "no data" vs "no matches," check `table.filters` from your handler and swap the slotted children accordingly.

## Custom cell renderers

`column.render( value, row, index )` returns a string (rendered as text via `textContent`, so it's XSS-safe) or a `Node`. The `html\`\`` tagged-template helper the component sources use internally is not part of the package's public exports, so plugin code builds nodes with `document.createElement`:

```js
table.columns = [
    { key: 'avatar', label: '', width: '32px',
      render: ( v ) => {
          const img = document.createElement( 'img' );
          img.src = String( v );
          img.width = 24;
          img.height = 24;
          return img;
      } },
    { key: 'name',   label: 'Name' },
    { key: 'status', label: 'Status',
      render: ( v ) => {
          const badge = document.createElement( 'wpd-badge' );
          badge.setAttribute( 'tone', v === 'active' ? 'success' : 'warning' );
          badge.textContent = String( v );
          return badge;
      } },
];
```

**Best practice — pick one return shape per column.** Mixing `string` and `Node` across columns is legal but harder to read at a glance. For plain text, return a string; for anything with markup, build the node imperatively with `document.createElement`. If you find yourself returning both from the same `render` based on a runtime check, that's usually a smell that the column wants splitting.

## Row clicks

```js
table.addEventListener( 'wpd-table-row-click', ( e ) => {
    const { row, index, originalEvent } = e.detail;
    openOrder( row.id );
} );
```

Clicks on filter inputs, the expander button, and selection checkboxes do **not** fire `wpd-table-row-click` — they're marked `data-noclick`. Mark any of your own interactive cell content the same way to opt out:

```js
render: ( v, row ) => {
    const btn = document.createElement( 'button' );
    btn.dataset.noclick = '';
    btn.textContent = '×';
    btn.addEventListener( 'click', () => del( row.id ) );
    return btn;
}
```

## Editable cells

Same pattern as custom renderers — return an input. Two real gotchas:

1. **Mark the control `data-noclick`** so clicks on it don't fire `wpd-table-row-click`.
2. **Avoid full-table repaints on every keystroke** — they tear down and rebuild the input, losing focus/caret. Either commit on blur/Enter (mutate `row.field` in place; reassign `table.data` only on save), or keep edits in a side buffer (`Map<rowId, edits>`) that the renderer reads from.

```js
{ key: 'name', label: 'Name',
  render: ( v, row ) => {
      const i = document.createElement( 'input' );
      i.value = String( v );
      i.dataset.noclick = '';
      i.addEventListener( 'change', () => { row.name = i.value; } );
      return i;
  } }
```

If editing is the primary use case, request a first-class `column.editor` API — the persistent-input plumbing is already in place for filters and would generalize naturally.

## Programmatic API reference

| Method | What it does |
|---|---|
| `expand(i)` / `collapse(i)` | Open/close one row. |
| `expandAll()` / `collapseAll()` | Open every row that has children / close everything. |
| `isExpanded(i)` | Boolean. |
| `expanded` | Get/set the full open-set (for state persistence). |
| `clearFilters()` | Drop every filter; emits `filter-change`. |
| `clearSort()` | Drop the active sort; emits `sort-change`. |
| `select(id)` / `deselect(id)` | Mutate the selection by id. |
| `selectAll()` / `clearSelection()` | Bulk operations (multi-mode). `selectAll()` selects only the rows passing the active client-side filters. |
| `selection` | Get/set the selection set. |
| `selectedRows` | Resolved row objects matching `selection`. |
| `getRowId` | Stable-id extractor (default: index). |
| `sort` | Get/set the active `{ key, direction }` (or `null`). |
| `filters` | Get/set the filter map. |
| `scrollToRow(i)` | Bring the (filtered) row at index `i` into view. |
| `recomputeLayout()` | Force a sticky-offset / header-height recompute. Public escape hatch — usually not needed. |

## Attributes reference

| Attribute | Type | What it does |
|---|---|---|
| `sticky-columns` | integer | Pin the first N columns. Auto-injected expander/select columns count toward N. |
| `sticky-header` | boolean | Pin the header (and filter row). Needs a scrolling container. |
| `striped` | boolean | Zebra rows. |
| `hover` | boolean | Row hover highlight. |
| `compact` | boolean | Tighter padding + smaller font. |
| `bordered` | boolean | Vertical cell borders. |
| `selectable` | `"single" \| "multi"` | Prepends a checkbox column. |
| `loading` | boolean | Shimmering skeleton rows in place of body. |
| `loading-rows` | integer | Skeleton-row count when loading. Default 5. |
| `empty` | string | Text fallback when there are no rows. Slot `empty` for rich content. |

## CSS custom properties

| Property | Default |
|---|---|
| `--wpd-table-bg` | `var( --wpd-surface, #fff )` |
| `--wpd-table-border` | `var( --wpd-border, rgba(0,0,0,0.08) )` |
| `--wpd-table-header-bg` | `var( --wpd-surface-elevated, #f6f7f7 )` |
| `--wpd-table-row-hover` | `rgba(0,0,0,0.04)` |
| `--wpd-table-stripe` | `rgba(0,0,0,0.02)` |
| `--wpd-table-cell-padding` | `8px 12px` |
| `--wpd-table-font-size` | `13px` |
| `--wpd-table-max-height` | `none` |
| `--wpd-table-skeleton-color` | `rgba(0,0,0,0.06)` |
| `--wpd-table-skeleton-highlight` | `rgba(0,0,0,0.14)` |

## Events

| Name | `event.detail` | Fires when |
|---|---|---|
| `wpd-table-filter-change` | `{ filters }` | A filter input changed (or `clearFilters()` ran). |
| `wpd-table-sort-change` | `{ sort }` (or `{ sort: null }`) | A sortable header was clicked or `sort` was set. |
| `wpd-table-selection-change` | `{ selection: id[], rows: T[] }` | Selection mutated. |
| `wpd-table-row-click` | `{ row, index, originalEvent }` | A body row was clicked (excluding `data-noclick`). |
| `wpd-table-expand-change` | `{ row, index, expanded }` | A row's sub-table was toggled. |

## Slots

| Name | Default content | When it shows |
|---|---|---|
| `empty` | The `empty` attribute text | `data` is empty OR all rows got filtered out. |

## Common pitfalls

- **`sticky-header` with no scroll container.** If `--wpd-table-max-height` is unset and no ancestor scrolls, sticky positioning is inert. The component warns once via `console.warn` after the data has filled the viewport.
- **`sticky-columns` counting auto columns.** The expander and select columns are *prepended*; `sticky-columns="2"` pins them, not your first two data columns. Pad accordingly (see "Worked example" above).
- **Mixing `column.align: 'end'` with custom `render`.** Alignment applies to the cell, but if your renderer returns a `display: block`-ish element it may not pick up text-align. Either set `text-align: end` on the rendered element or wrap in a `<span>`.
- **Editable cells losing focus.** Reassigning `table.data` on every keystroke triggers a full body repaint — the new `<input>` is a different element, so focus is lost. Commit on blur/Enter, or hold edits in a side buffer until save.
- **Selection going stale on data refresh.** Without `getRowId`, ids are array indices — selections drift if rows reorder. Set `getRowId = ( row ) => row.id` whenever rows have a natural identifier.
- **Colliding ids across mixed row kinds.** Two rows whose `getRowId` returns the same value are one row as far as selection is concerned — ticking one ticks both. Qualify the id (``( row ) => `${ row.type }:${ row.id }` ``) when a list mixes entities from independent id sequences.
- **Stale selection feeding destructive bulk actions.** Selection survives `data` reassignment by design. If your bulk actions read `table.selection` (trash, delete…), call `clearSelection()` whenever the query (page, search, filter) changes, or resolve the selection against the currently rendered rows before acting.

## See also

- [Layout primitives](./layout-primitives.md) — wrap the table in `<wpd-body>` / `<wpd-panel>` for the standard window shape.
- [JavaScript reference](../javascript-reference.md) — every wpd-* component.
