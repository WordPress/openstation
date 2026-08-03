# `<os-*>` component reference

Canonical mapping of every shipped web component: tag name → exported class → source file → one-line purpose. The runtime missing-component warner (`src/ui/components/missing-import-warner.ts`) points readers here.

Components are **side-effect registered** at import time, per bundle, into the page-global custom-element registry. The shell bundle (`desktop[.min].js`) registers a core subset and pre-loads `shell-overlays[.min].js` (the toast / confirm-dialog / context-menu / menu / select / window-chrome kit) right after first paint, so those tags upgrade anywhere once the shell is up. Every other component registers only when a bundle that imports its module loads — emitting a `<os-foo>` tag that no loaded bundle has imported renders inert HTML, and the missing-component warner logs a `console.error` with the exact import line to add. Plugin bundles that render additional tags should import from `'openstation'`: the package entry re-exports the component barrel, so any import from it registers every tag as a side effect. The class export is only needed for TypeScript types or programmatic instantiation.

## Source of truth

`src/ui/components/index.ts` re-exports every component class AND the `OS_COMPONENT_TAGS` constant — the array all the dev-time guards iterate. The constant itself is defined in `src/ui/components/tags.ts` (the single source of truth, kept side-effect-free); the index re-exports it. If this doc and the index disagree, the index wins. To add a new component:

1. Create `src/ui/components/<name>/<name>.ts`, `<name>.styles.ts`, `<name>.test.ts`.
2. Add the class export to `src/ui/components/index.ts`.
3. Add the tag to `src/ui/components/tags.ts` (the single source of `OS_COMPONENT_TAGS`, re-exported by `index.ts`).
4. Add a row to this table.
5. Document via the `static help = { … }` block on the class — surfaced in OS Settings → Components live.

## Browsing the kit at runtime

**OS Settings → Components** (admin-only) renders this table live: every tag in `OS_COMPONENT_TAGS`, with its props, slots, events, parts, CSS custom properties, and a working example rendered from the `static help.example` template.

The tab side-effect-imports the whole component barrel so the list is the full kit rather than "whatever other bundles happen to have loaded" — the per-bundle registration model described above means an unimported component reaches no custom-element registry, and a tab that only enumerated registered tags silently under-reported itself.

The search box above the list filters on the flattened descriptor, not just the title: tag name, summary, status, `static props` names, and the name *and* description of every documented prop, slot, event, part, and CSS custom property. Terms are ANDed and order-independent, so `field number` and `number clamp` both reach `<os-number-field>`.

## Layout & structure

| Tag | Class | Source | Purpose |
| --- | --- | --- | --- |
| `<os-body>` | `OsBody` | `os-body/os-body.ts` | Page-body scroll container. |
| `<os-panel>` | `OsPanel` | `os-panel/os-panel.ts` | Collapsible content section with header. |
| `<os-section>` | `OsSection` | `os-section/os-section.ts` | Titled section block within a panel. |
| `<os-row>` | `OsRow` | `os-row/os-row.ts` | Horizontal flex row primitive. |
| `<os-stack>` | `OsStack` | `os-stack/os-stack.ts` | Vertical flex stack with consistent gap. |
| `<os-cluster>` | `OsCluster` | `os-cluster/os-cluster.ts` | Wrapped flex row for chips / tags / actions. |
| `<os-grid>` | `OsGrid` | `os-grid/os-grid.ts` | Auto-fit CSS grid primitive. |
| `<os-card>` | `OsCard` | `os-card/os-card.ts` | Bordered surface for entity-card UIs. |
| `<os-display>` | `OsDisplay` | `os-display/os-display.ts` | Hero / display-typography container. |

## Form controls

| Tag | Class | Source | Purpose |
| --- | --- | --- | --- |
| `<os-form>` | `OsForm` | `os-form/os-form.ts` | Form host with auto value-collection + validation. |
| `<os-text-field>` | `OsTextField` | `os-text-field/os-text-field.ts` | Single-line text input. |
| `<os-textarea>` | `OsTextarea` | `os-textarea/os-textarea.ts` | Multi-line text input. |
| `<os-number-field>` | `OsNumberField` | `os-number-field/os-number-field.ts` | Numeric input with min/max/step. |
| `<os-color-field>` | `OsColorField` | `os-color-field/os-color-field.ts` | Color picker with swatches. |
| `<os-range-field>` | `OsRangeField` | `os-range-field/os-range-field.ts` | Slider with live numeric readout. |
| `<os-checkbox>` | `OsCheckbox` | `os-checkbox/os-checkbox.ts` | Standalone checkbox. |
| `<os-checkbox-label>` | `OsCheckboxLabel` | `os-checkbox-label/os-checkbox-label.ts` | Checkbox + inline label pair. |
| `<os-select>` / `<os-option>` | `OsSelect`, `OsOption` | `os-select/os-select.ts` | Native select with custom chrome. |
| `<os-multiselect>` | `OsMultiselect` | `os-multiselect/os-multiselect.ts` | Multi-select with chips. |
| `<os-segmented>` / `<os-segment>` | `OsSegmented`, `OsSegment` | `os-segmented/os-segmented.ts` | Segmented control (radio group as buttons). |
| `<os-tag-input>` | `OsTagInput` | `os-tag-input/os-tag-input.ts` | Free-text tag entry with autocomplete. |
| `<os-category-picker>` | `OsCategoryPicker` | `os-category-picker/os-category-picker.ts` | Category tree picker. |
| `<os-role-picker>` | `OsRolePicker` | `os-role-picker/os-role-picker.ts` | WP role select. |
| `<os-user-search>` | `OsUserSearch` | `os-user-search/os-user-search.ts` | Live user autocomplete (`/desktop-mode/v1/files/users/search` REST). |

## Buttons & actions

| Tag | Class | Source | Purpose |
| --- | --- | --- | --- |
| `<os-button>` | `OsButton` | `os-button/os-button.ts` | Primary / secondary / ghost button. |
| `<os-window-button>` | `OsWindowButton` | `os-window-button/os-window-button.ts` | Title-bar icon button (minimize / maximize / close / custom). |

## Menus & overlays

| Tag | Class | Source | Purpose |
| --- | --- | --- | --- |
| `<os-menu>` / `<os-menu-item>` | `OsMenu`, `OsMenuItem` | `os-menu/os-menu.ts` | Dropdown menu surface. |
| `<os-context-menu>` / `<os-context-menu-option>` | `OsContextMenu`, `OsContextMenuOption` | `os-context-menu/os-context-menu.ts` | Right-click / long-press menu. |
| `<os-flyout>` | `OsFlyout` | `os-flyout/os-flyout.ts` | Anchored popover. Supports placement strategies. |
| `<os-modal>` | `OsModal` | `os-modal/os-modal.ts` | Full-overlay modal with focus trap. |
| `<os-confirm-dialog>` | `OsConfirmDialog`, `osConfirm` | `os-confirm-dialog/os-confirm-dialog.ts` | Confirm prompt — use `await osConfirm({...})` (never `window.confirm`). |
| `<os-toast>` / `<os-toast-container>` | `OsToast`, `OsToastContainer` | `os-toast/os-toast.ts` | Top-right (top inline-end) toast notifications. |
| `<os-notice>` | `OsNotice` | `os-notice/os-notice.ts` | Inline informational/warning notice. |

## Display & feedback

| Tag | Class | Source | Purpose |
| --- | --- | --- | --- |
| `<os-icon>` | `OsIcon` | `os-icon/os-icon.ts` | Icon by dashicon slug or SVG content. |
| `<os-avatar>` | `OsAvatar` | `os-avatar/os-avatar.ts` | User avatar with presence dot. |
| `<os-badge>` | `OsBadge` | `os-badge/os-badge.ts` | Number badge with tone color. |
| `<os-ribbon>` | `OsRibbon` | `os-ribbon/os-ribbon.ts` | Corner ribbon for tiles. |
| `<os-chip>` | `OsChip` | `os-chip/os-chip.ts` | Tag/category chip with tone. |
| `<os-key>` | `OsKey` | `os-key/os-key.ts` | Keyboard shortcut display. |
| `<os-code>` | `OsCode` | `os-code/os-code.ts` | Inline / block monospace code with copy. |
| `<os-spinner>` | `OsSpinner` | `os-spinner/os-spinner.ts` | Loading spinner with preset variants; `preset="inline"` is a bare arc for text-adjacent use. |
| `<os-progress-bar>` | `OsProgressBar` | `os-progress-bar/os-progress-bar.ts` | Determinate or indeterminate progress. |
| `<os-save-status>` | `OsSaveStatus` | `os-save-status/os-save-status.ts` | Title-bar save indicator (idle / saving / saved / failed). |
| `<os-relative-time>` | `OsRelativeTime` | `os-relative-time/os-relative-time.ts` | Auto-updating "2 min ago". |
| `<os-empty-state>` | `OsEmptyState` | `os-empty-state/os-empty-state.ts` | Empty-list / no-results placeholder. |
| `<os-rating-summary>` | `OsRatingSummary` | `os-rating-summary/os-rating-summary.ts` | Star average + per-star bucket bars. |

## Lists & tables

| Tag | Class | Source | Purpose |
| --- | --- | --- | --- |
| `<os-table>` | `OsTable` | `os-table/os-table.ts` | Sortable, filterable data table with sub-tables. |
| `<os-log>` | `OsLog` | `os-log/os-log.ts` | Virtualized streaming log container. |
| `<os-tile>` | `OsTile` | `os-tile/os-tile.ts` | Desktop-style icon tile (used by the desktop file layer, folder windows, and the site folder). |

## Tabs & navigation

| Tag | Class | Source | Purpose |
| --- | --- | --- | --- |
| `<os-tabs>` / `<os-tab>` / `<os-tabpanel>` | `OsTabs`, `OsTab`, `OsTabPanel` | `os-tabs/os-tabs.ts` | Tab strip with associated panels. |
| `<os-tab-chip>` | `OsTabChip` | `os-tab-chip/os-tab-chip.ts` | Single chip tab (e.g. window tabs). |
| `<os-steps>` / `<os-step>` | `OsSteps`, `OsStep` | `os-steps/os-steps.ts` | Wizard step indicator. |
| `<os-crumb-chain>` | `OsCrumbChain` | `os-crumb-chain/os-crumb-chain.ts` | Breadcrumb trail with chevron separators. |

## Color & theming

| Tag | Class | Source | Purpose |
| --- | --- | --- | --- |
| `<os-swatch>` | `OsSwatch` | `os-swatch/os-swatch.ts` | Single color swatch button. |
| `<os-swatch-grid>` | `OsSwatchGrid` | `os-swatch-grid/os-swatch-grid.ts` | Grid of color swatches with selection. |

## Importing the classes (for TypeScript)

```typescript
import { OsLog, type OsLogRowRenderer } from 'openstation';
```

Not every class in the tables above is importable from `'openstation'`. The package `exports` map exposes only the entry point (`src/public-api.ts`), which re-exports the **Stable** kit: `OsAvatar`, `OsBadge`, `OsButton`, `OsCheckboxLabel`, `OsCluster`, `OsCode`, `OsColorField`, `OsDisplay`, `OsEmptyState`, `OsGrid`, `OsIcon`, `OsKey`, `OsLog`, `OsMenu`, `OsMenuItem`, `OsPanel`, `OsRangeField`, `OsSection`, `OsSegment`, `OsSegmented`, `OsStack`, `OsStep`, `OsSteps`, `OsSwatch`, `OsSwatchGrid`, `OsTab`, `OsTabChip`, `OsTabs`, `OsTextarea`, `OsToast`, `OsToastContainer`, `OsWindowButton`. If `src/public-api.ts` and this list disagree, the source wins.

The remaining classes are internal-only for now — subpath / source-path imports are blocked by the `exports` map — though their *tags* still work wherever a loaded bundle has registered them. The class import is for type-checking, subclassing, or programmatic instantiation; importing anything from `'openstation'` also registers every tag as a side effect. See [`use-from-a-plugin.md`](./use-from-a-plugin.md) for the local-install workflow.

## Per-component help

Every class has a `static help = { … }` block with full props / slots / events / examples / status. The OS Settings → Components tab iterates `OS_COMPONENT_TAGS` and renders these descriptors live; that's the authoritative per-component reference. The table above is a directory; the `static help` block is the manual.
