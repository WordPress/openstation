# `<wpd-*>` component reference

Canonical mapping of every shipped web component: tag name → exported class → source file → one-line purpose. The runtime missing-component warner (`src/ui/components/missing-import-warner.ts`) points readers here.

Components are **side-effect registered** at import time, per bundle, into the page-global custom-element registry. The shell bundle (`desktop[.min].js`) registers a core subset and pre-loads `shell-overlays[.min].js` (the toast / confirm-dialog / context-menu / menu / select / window-chrome kit) right after first paint, so those tags upgrade anywhere once the shell is up. Every other component registers only when a bundle that imports its module loads — emitting a `<wpd-foo>` tag that no loaded bundle has imported renders inert HTML, and the missing-component warner logs a `console.error` with the exact import line to add. Plugin bundles that render additional tags should import from `'desktop-mode'`: the package entry re-exports the component barrel, so any import from it registers every tag as a side effect. The class export is only needed for TypeScript types or programmatic instantiation.

## Source of truth

`src/ui/components/index.ts` re-exports every component class AND the `WPD_COMPONENT_TAGS` constant — the array all the dev-time guards iterate. The constant itself is defined in `src/ui/components/tags.ts` (the single source of truth, kept side-effect-free); the index re-exports it. If this doc and the index disagree, the index wins. To add a new component:

1. Create `src/ui/components/<name>/<name>.ts`, `<name>.styles.ts`, `<name>.test.ts`.
2. Add the class export to `src/ui/components/index.ts`.
3. Add the tag to `src/ui/components/tags.ts` (the single source of `WPD_COMPONENT_TAGS`, re-exported by `index.ts`).
4. Add a row to this table.
5. Document via the `static help = { … }` block on the class — surfaced in OS Settings → Help live.

## Layout & structure

| Tag | Class | Source | Purpose |
| --- | --- | --- | --- |
| `<wpd-body>` | `WpdBody` | `wpd-body/wpd-body.ts` | Page-body scroll container. |
| `<wpd-panel>` | `WpdPanel` | `wpd-panel/wpd-panel.ts` | Collapsible content section with header. |
| `<wpd-section>` | `WpdSection` | `wpd-section/wpd-section.ts` | Titled section block within a panel. |
| `<wpd-row>` | `WpdRow` | `wpd-row/wpd-row.ts` | Horizontal flex row primitive. |
| `<wpd-stack>` | `WpdStack` | `wpd-stack/wpd-stack.ts` | Vertical flex stack with consistent gap. |
| `<wpd-cluster>` | `WpdCluster` | `wpd-cluster/wpd-cluster.ts` | Wrapped flex row for chips / tags / actions. |
| `<wpd-grid>` | `WpdGrid` | `wpd-grid/wpd-grid.ts` | Auto-fit CSS grid primitive. |
| `<wpd-card>` | `WpdCard` | `wpd-card/wpd-card.ts` | Bordered surface for entity-card UIs. |
| `<wpd-display>` | `WpdDisplay` | `wpd-display/wpd-display.ts` | Hero / display-typography container. |

## Form controls

| Tag | Class | Source | Purpose |
| --- | --- | --- | --- |
| `<wpd-form>` | `WpdForm` | `wpd-form/wpd-form.ts` | Form host with auto value-collection + validation. |
| `<wpd-text-field>` | `WpdTextField` | `wpd-text-field/wpd-text-field.ts` | Single-line text input. |
| `<wpd-textarea>` | `WpdTextarea` | `wpd-textarea/wpd-textarea.ts` | Multi-line text input. |
| `<wpd-number-field>` | `WpdNumberField` | `wpd-number-field/wpd-number-field.ts` | Numeric input with min/max/step. |
| `<wpd-color-field>` | `WpdColorField` | `wpd-color-field/wpd-color-field.ts` | Color picker with swatches. |
| `<wpd-range-field>` | `WpdRangeField` | `wpd-range-field/wpd-range-field.ts` | Slider with live numeric readout. |
| `<wpd-checkbox>` | `WpdCheckbox` | `wpd-checkbox/wpd-checkbox.ts` | Standalone checkbox. |
| `<wpd-checkbox-label>` | `WpdCheckboxLabel` | `wpd-checkbox-label/wpd-checkbox-label.ts` | Checkbox + inline label pair. |
| `<wpd-select>` / `<wpd-option>` | `WpdSelect`, `WpdOption` | `wpd-select/wpd-select.ts` | Native select with custom chrome. |
| `<wpd-multiselect>` | `WpdMultiselect` | `wpd-multiselect/wpd-multiselect.ts` | Multi-select with chips. |
| `<wpd-segmented>` / `<wpd-segment>` | `WpdSegmented`, `WpdSegment` | `wpd-segmented/wpd-segmented.ts` | Segmented control (radio group as buttons). |
| `<wpd-tag-input>` | `WpdTagInput` | `wpd-tag-input/wpd-tag-input.ts` | Free-text tag entry with autocomplete. |
| `<wpd-category-picker>` | `WpdCategoryPicker` | `wpd-category-picker/wpd-category-picker.ts` | Category tree picker. |
| `<wpd-role-picker>` | `WpdRolePicker` | `wpd-role-picker/wpd-role-picker.ts` | WP role select. |
| `<wpd-user-search>` | `WpdUserSearch` | `wpd-user-search/wpd-user-search.ts` | Live user autocomplete (`/desktop-mode/v1/files/users/search` REST). |

## Buttons & actions

| Tag | Class | Source | Purpose |
| --- | --- | --- | --- |
| `<wpd-button>` | `WpdButton` | `wpd-button/wpd-button.ts` | Primary / secondary / ghost button. |
| `<wpd-window-button>` | `WpdWindowButton` | `wpd-window-button/wpd-window-button.ts` | Title-bar icon button (minimize / maximize / close / custom). |

## Menus & overlays

| Tag | Class | Source | Purpose |
| --- | --- | --- | --- |
| `<wpd-menu>` / `<wpd-menu-item>` | `WpdMenu`, `WpdMenuItem` | `wpd-menu/wpd-menu.ts` | Dropdown menu surface. |
| `<wpd-context-menu>` / `<wpd-context-menu-option>` | `WpdContextMenu`, `WpdContextMenuOption` | `wpd-context-menu/wpd-context-menu.ts` | Right-click / long-press menu. |
| `<wpd-flyout>` | `WpdFlyout` | `wpd-flyout/wpd-flyout.ts` | Anchored popover. Supports placement strategies. |
| `<wpd-modal>` | `WpdModal` | `wpd-modal/wpd-modal.ts` | Full-overlay modal with focus trap. |
| `<wpd-confirm-dialog>` | `WpdConfirmDialog`, `wpdConfirm` | `wpd-confirm-dialog/wpd-confirm-dialog.ts` | Confirm prompt — use `await wpdConfirm({...})` (never `window.confirm`). |
| `<wpd-toast>` / `<wpd-toast-container>` | `WpdToast`, `WpdToastContainer` | `wpd-toast/wpd-toast.ts` | Top-right (top inline-end) toast notifications. |
| `<wpd-notice>` | `WpdNotice` | `wpd-notice/wpd-notice.ts` | Inline informational/warning notice. |

## Display & feedback

| Tag | Class | Source | Purpose |
| --- | --- | --- | --- |
| `<wpd-icon>` | `WpdIcon` | `wpd-icon/wpd-icon.ts` | Icon by dashicon slug or SVG content. |
| `<wpd-avatar>` | `WpdAvatar` | `wpd-avatar/wpd-avatar.ts` | User avatar with presence dot. |
| `<wpd-badge>` | `WpdBadge` | `wpd-badge/wpd-badge.ts` | Number badge with tone color. |
| `<wpd-ribbon>` | `WpdRibbon` | `wpd-ribbon/wpd-ribbon.ts` | Corner ribbon for tiles. |
| `<wpd-chip>` | `WpdChip` | `wpd-chip/wpd-chip.ts` | Tag/category chip with tone. |
| `<wpd-key>` | `WpdKey` | `wpd-key/wpd-key.ts` | Keyboard shortcut display. |
| `<wpd-code>` | `WpdCode` | `wpd-code/wpd-code.ts` | Inline / block monospace code with copy. |
| `<wpd-spinner>` | `WpdSpinner` | `wpd-spinner/wpd-spinner.ts` | Loading spinner with preset variants; `preset="inline"` is a bare arc for text-adjacent use. |
| `<wpd-progress-bar>` | `WpdProgressBar` | `wpd-progress-bar/wpd-progress-bar.ts` | Determinate or indeterminate progress. |
| `<wpd-save-status>` | `WpdSaveStatus` | `wpd-save-status/wpd-save-status.ts` | Title-bar save indicator (idle / saving / saved / failed). |
| `<wpd-relative-time>` | `WpdRelativeTime` | `wpd-relative-time/wpd-relative-time.ts` | Auto-updating "2 min ago". |
| `<wpd-empty-state>` | `WpdEmptyState` | `wpd-empty-state/wpd-empty-state.ts` | Empty-list / no-results placeholder. |
| `<wpd-rating-summary>` | `WpdRatingSummary` | `wpd-rating-summary/wpd-rating-summary.ts` | Star average + per-star bucket bars. |

## Lists & tables

| Tag | Class | Source | Purpose |
| --- | --- | --- | --- |
| `<wpd-table>` | `WpdTable` | `wpd-table/wpd-table.ts` | Sortable, filterable data table with sub-tables. |
| `<wpd-log>` | `WpdLog` | `wpd-log/wpd-log.ts` | Virtualized streaming log container. |
| `<wpd-tile>` | `WpdTile` | `wpd-tile/wpd-tile.ts` | Desktop-style icon tile (used by the desktop file layer, folder windows, and My WordPress). |

## Tabs & navigation

| Tag | Class | Source | Purpose |
| --- | --- | --- | --- |
| `<wpd-tabs>` / `<wpd-tab>` / `<wpd-tabpanel>` | `WpdTabs`, `WpdTab`, `WpdTabPanel` | `wpd-tabs/wpd-tabs.ts` | Tab strip with associated panels. |
| `<wpd-tab-chip>` | `WpdTabChip` | `wpd-tab-chip/wpd-tab-chip.ts` | Single chip tab (e.g. window tabs). |
| `<wpd-steps>` / `<wpd-step>` | `WpdSteps`, `WpdStep` | `wpd-steps/wpd-steps.ts` | Wizard step indicator. |
| `<wpd-crumb-chain>` | `WpdCrumbChain` | `wpd-crumb-chain/wpd-crumb-chain.ts` | Breadcrumb trail with chevron separators. |

## Color & theming

| Tag | Class | Source | Purpose |
| --- | --- | --- | --- |
| `<wpd-swatch>` | `WpdSwatch` | `wpd-swatch/wpd-swatch.ts` | Single color swatch button. |
| `<wpd-swatch-grid>` | `WpdSwatchGrid` | `wpd-swatch-grid/wpd-swatch-grid.ts` | Grid of color swatches with selection. |

## Importing the classes (for TypeScript)

```typescript
import { WpdLog, type WpdLogRowRenderer } from 'desktop-mode';
```

Not every class in the tables above is importable from `'desktop-mode'`. The package `exports` map exposes only the entry point (`src/public-api.ts`), which re-exports the **Stable** kit: `WpdAvatar`, `WpdBadge`, `WpdButton`, `WpdCheckboxLabel`, `WpdCluster`, `WpdCode`, `WpdColorField`, `WpdDisplay`, `WpdEmptyState`, `WpdGrid`, `WpdIcon`, `WpdKey`, `WpdLog`, `WpdMenu`, `WpdMenuItem`, `WpdPanel`, `WpdRangeField`, `WpdSection`, `WpdSegment`, `WpdSegmented`, `WpdStack`, `WpdStep`, `WpdSteps`, `WpdSwatch`, `WpdSwatchGrid`, `WpdTab`, `WpdTabChip`, `WpdTabs`, `WpdTextarea`, `WpdToast`, `WpdToastContainer`, `WpdWindowButton`. If `src/public-api.ts` and this list disagree, the source wins.

The remaining classes are internal-only for now — subpath / source-path imports are blocked by the `exports` map — though their *tags* still work wherever a loaded bundle has registered them. The class import is for type-checking, subclassing, or programmatic instantiation; importing anything from `'desktop-mode'` also registers every tag as a side effect. See [`use-from-a-plugin.md`](./use-from-a-plugin.md) for the local-install workflow.

## Per-component help

Every class has a `static help = { … }` block with full props / slots / events / examples / status. The OS Settings → Help tab iterates `WPD_COMPONENT_TAGS` and renders these descriptors live; that's the authoritative per-component reference. The table above is a directory; the `static help` block is the manual.
