# `<os-*>` component reference

Canonical mapping of every shipped web component: tag name → exported class → source file → one-line purpose. The runtime missing-component warner (`src/ui/components/missing-import-warner.ts`) points readers here.

Components are **side-effect registered** at import time, per bundle, into the page-global custom-element registry. The shell bundle (`desktop[.min].js`) registers a core subset and pre-loads `shell-overlays[.min].js` (the toast / confirm-dialog / context-menu / menu / select / window-chrome kit) right after first paint, so those tags upgrade anywhere once the shell is up. Every other component registers only when a bundle that imports its module loads — emitting a `<os-foo>` tag that no loaded bundle has imported renders inert HTML, and the missing-component warner logs a `console.error` with the exact import line to add. Plugin bundles that render additional tags should import from `'openstation'`: the package entry re-exports the component barrel, so any import from it registers every tag as a side effect. The class export is only needed for TypeScript types or programmatic instantiation.

## Source of truth

`src/ui/components/index.ts` re-exports every component class AND the `OS_COMPONENT_TAGS` constant — the array all the dev-time guards iterate. The constant itself is defined in `src/ui/components/tags.ts` (the single source of truth, kept side-effect-free); the index re-exports it. If this doc and the index disagree, the index wins. To add a new component:

1. Create `src/ui/components/<name>/<name>.ts`, `<name>.styles.ts`, `<name>.test.ts`.
2. Add the class export to `src/ui/components/index.ts`.
3. Add the tag to `src/ui/components/tags.ts` (the single source of `OS_COMPONENT_TAGS`, re-exported by `index.ts`).
4. Add a row to this table.
5. Document via the `static help = { … }` block on the class — surfaced in OpenStation Settings → Components live.

## Browsing the kit at runtime

**OpenStation Settings → Components** (admin-only) renders this table live: every tag in `OS_COMPONENT_TAGS`, with its props, slots, events, parts, CSS custom properties, and a working example rendered from the `static help.example` template.

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
| `<os-switch>` | `OsSwitch` | `os-switch/os-switch.ts` | On/off switch for settings that apply immediately. Tap, drag or keyboard. |
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

## The holographic layer

The kit wears the [OpenStation brand](https://nuriapenya.github.io/open-station-brand/), and the brand ships five mesh gradients with one instruction attached: *"meshes reserved for hero surfaces."* `src/ui/holo.ts` is how a control gets to be one without every component reinventing what holographic means.

**It is a moment, not a skin.** A control paints the mesh when it is on, selected, primary or filled — the one instant it speaks for the brand — and wears ordinary Obsidian the rest of the time. A panel where every surface is iridescent has no identity moments left to spend.

Three treatments, in ascending loudness:

| Fragment | What it does | Who gets it |
| --- | --- | --- |
| `holoEdge` | An iridescent hairline, invisible at rest, lit on hover and focus. | `<os-button>` (all variants but `link`/`danger`), and the *selected* state of `<os-chip>`, `<os-card>`, `<os-swatch>`. |
| `holoSheen` | A ~10%-alpha film of the mesh's hues over the existing surface, faded in under the pointer. | `<os-button>`, `<os-key>`, unselected `<os-segment>`. |
| `holoFill` | The mesh itself, at full strength, with Void ink on top. | The on state of `<os-switch>`, checked `<os-checkbox>` / `<os-checkbox-label>` / `<os-menu-item>`, the selected `<os-segment>`, the elapsed track of `<os-range-field>`, the fill of `<os-progress-bar>`, the `<os-step>` chip, and `<os-button variant="holo">`. |

…and four motions, which are what make the surfaces read as foil rather than as paint:

| Fragment | What it does | Who gets it |
| --- | --- | --- |
| `holoGlint` | A specular band crosses the surface once on hover. The single most "holographic" thing in the kit. | `<os-button>`, `<os-key>`, interactive `<os-card>`. |
| `holoRing` | A ring expands out of the control and fades on `:active`, so a press reads as received before its result paints. | `<os-button>`, `<os-key>`. |
| `holoShimmer` | The mesh travelling, for waits of unknown length. | Indeterminate `<os-progress-bar>`. |
| `holoEnter` | Scale-and-fade arrival on the spring. | `<os-menu>`, `<os-context-menu>`, `<os-modal>`, `<os-confirm-dialog>`. |

Plus the motions that belong to one component and stayed there: the `<os-segmented>` thumb that slides between segments, the `<os-tabs>` underline that grows from the centre, the `<os-switch>` knob's spring-and-squash, the `<os-checkbox>` tick landing with an overshoot, `<os-toast>` arriving from above and leaving sideways, and the `<os-avatar>` presence ring — which pulses **only** on `online`, so "who is here" survives being read by someone who cannot separate the three dot colours.

**The pseudo-element budget.** An element has two, and this module wants four effects. `holoSheen` takes `::before` and `holoEdge` takes `::after` — that is the whole budget for a control wearing both, as `<os-button>` does. So `holoGlint` and `holoRing` are **element-based**: the component stamps a `<span class="os-holo-glint">` / `<span class="os-holo-ring">` and the fragment styles it. Both are driven from the parent's state via the **child** combinator (`:active > .os-holo-ring`), which is load-bearing: `:active` matches an activated element *and every ancestor of it*, so a descendant selector would fire every ring on the page.

Two shared fragments carry the states that are not decorative:

- **`holoField`** — one hover, one focus ring, one transition duration and one placeholder colour for every text-like control (`<os-text-field>`, `<os-textarea>`, `<os-number-field>`, `<os-select>`, and any component that renders a bare `input` / `select` / `textarea` in its shadow root). Its selectors wrap their type exclusions in `:where()` so a component's own `aria-invalid` ring still outranks it — an invalid field focuses in red, not in Pulse.
- **`holoCheck`** — the checkbox and radio paint, shared by `<os-checkbox>`, `<os-checkbox-label>` and `<os-table>`'s selection column. It replaced `accent-color`, which takes a *colour* where the checked state here is a *gradient*.

### Tokens

Declared in `assets/css/variables.css`, on `body.os-active` (never `:root` — the file also loads inside every iframe window). Every component reads them through a private `--_holo-*` alias, so a desktop theme can re-point any of them and the whole kit changes together.

| Token | Meaning |
| --- | --- |
| `--os-mesh-holo` / `-pulse` / `-auro` / `-star` / `-mio` | The brand's five meshes, transcribed stop-for-stop from the SVGs into CSS gradient stacks. |
| `--os-ui-holo-fill` | What an "on" surface paints. Holomesh by default. |
| `--os-ui-holo-ink` | Glyphs and text on that fill. Void — every mesh in the brand is a light surface. |
| `--os-ui-holo-sheen` | The hover film. |
| `--os-ui-holo-edge` / `--os-ui-holo-edge-quiet` | The iridescent hairline, lit and at rest. |
| `--os-ui-holo-glow` / `--os-ui-holo-glow-strong` | The Pulse bloom around a lit surface. |
| `--os-ui-holo-track` | The unlit half — switch tracks, empty progress. |
| `--os-ui-accent-dim` | Pulse one step back (same hue, S and L pulled down together). **The single knob for how loud the station is** — every ambient use of the accent resolves through it. |
| `--os-ui-focus-ring` | The **target** ring: buttons, switches, checkboxes, swatches. Built to survive landing on a bright mesh. |
| `--os-ui-focus-ring-field` | The **field** ring: quieter, tightens the input's own border. A form of twelve inputs should not look alarmed. |
| `--os-ui-motion-fast` / `--os-ui-holo-transition` / `--os-ui-motion-slow` / `--os-ui-motion-ambient` | The duration scale: a state flip, the default tilt, something crossing a distance, an ambient loop. |
| `--os-ui-ease-spring` / `--os-ui-ease-out` / `--os-ui-ease-loop` | The three curves. `spring` overshoots ~9% and is wrong for anything that changes *size*. |

### Turning the station up or down

`--os-ui-accent` is Pulse `#f252fc` and stays there — it is what the brand guidelines name, and `brand-palette.test.ts` pins it. Pulse is also not a contrast problem: it carries 6.2:1 against Obsidian.

What makes a panel read as loud is the *ambient* use — a bloom behind a focused control, an 18% wash under a selected row, a fill wider than a chip. Those all resolve through `--os-ui-accent-dim`, so:

```css
body.os-active { --os-ui-accent-dim: #b02ab8; }  /* quieter still */
```

is the whole edit. The focus **ring** deliberately does not follow it — only the bloom behind the ring does. A focus indicator is the last place to trade legibility for calm.

Every fragment honours `prefers-reduced-motion` by stopping the tilt — never by removing the fill. A control that lost its mesh under reduced motion would lose its *state*, not just its animation.

### Using it in your own component

```ts
import { css } from '../../core';
import { holoTokens, holoEdge, holoFill } from '../../holo';

export const styles = css`
	${ holoTokens }
	${ holoEdge }
	${ holoFill }

	button:focus-visible { box-shadow: var( --_holo-focus ); }
`;
```

`holoTokens` declares the aliases the others read — include it once per component. Import `holo` instead for the whole vocabulary.

Two rules the guards enforce (`tests/vitest/holo-layer.test.ts`, `tests/vitest/component-token-reachability.test.ts`):

1. **Never declare a `--os-ui-*` name on a bare `:host`.** A property declared on the host beats anything it would inherit, so it kills the palette's *and* every theme's declaration of that name. Read the public token into a private `--_alias` instead.
2. **Comments inside a `` css`` `` template cannot contain backticks.** The template is a JS template literal; a backtick in a CSS comment terminates it and the file stops parsing.

## Importing the classes (for TypeScript)

```typescript
import { OsLog, type OsLogRowRenderer } from 'openstation';
```

Not every class in the tables above is importable from `'openstation'`. The package `exports` map exposes only the entry point (`src/public-api.ts`), which re-exports the **Stable** kit: `OsAvatar`, `OsBadge`, `OsButton`, `OsCheckboxLabel`, `OsCluster`, `OsCode`, `OsColorField`, `OsDisplay`, `OsEmptyState`, `OsGrid`, `OsIcon`, `OsKey`, `OsLog`, `OsMenu`, `OsMenuItem`, `OsPanel`, `OsRangeField`, `OsSection`, `OsSegment`, `OsSegmented`, `OsStack`, `OsStep`, `OsSteps`, `OsSwatch`, `OsSwatchGrid`, `OsTab`, `OsTabChip`, `OsTabs`, `OsTextarea`, `OsToast`, `OsToastContainer`, `OsWindowButton`. If `src/public-api.ts` and this list disagree, the source wins.

The remaining classes are internal-only for now — subpath / source-path imports are blocked by the `exports` map — though their *tags* still work wherever a loaded bundle has registered them. The class import is for type-checking, subclassing, or programmatic instantiation; importing anything from `'openstation'` also registers every tag as a side effect. See [`use-from-a-plugin.md`](./use-from-a-plugin.md) for the local-install workflow.

## Per-component help

Every class has a `static help = { … }` block with full props / slots / events / examples / status. The OpenStation Settings → Components tab iterates `OS_COMPONENT_TAGS` and renders these descriptors live; that's the authoritative per-component reference. The table above is a directory; the `static help` block is the manual.
