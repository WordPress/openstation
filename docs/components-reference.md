# `<os-*>` component reference

Canonical mapping of every shipped web component: tag name → exported class → source file → one-line purpose. The runtime missing-component warner (`src/ui/components/missing-import-warner.ts`) points readers here.

Components are **side-effect registered** at import time, per bundle, into the page-global custom-element registry. The shell bundle (`desktop[.min].js`) registers a core subset and pre-loads `shell-overlays[.min].js` (the toast / confirm-dialog / context-menu / menu / select / window-chrome kit) right after first paint, so those tags upgrade anywhere once the shell is up. That is 26 of the 67 tags below. Every other component registers only when a bundle that imports its module loads — emitting a `<os-foo>` tag that no loaded bundle has imported renders inert HTML, and the missing-component warner logs a `console.error` with the exact import line to add.

**Two ways to get the other 41.**

1. **Import the module** — `import 'openstation'` (the package entry re-exports the barrel, so any import registers every tag) or a single leaf module. Right for code built inside this repo, or beside it via the `file:` dependency in [`use-from-a-plugin.md`](./use-from-a-plugin.md). The class export is only needed for TypeScript types or programmatic instantiation.
2. **Load the kit at runtime** — `await wp.os.loadComponents( [ 'os-switch' ] )`. No build-time relationship with this repo required, which is what a plugin distributed as a zip has. See [`wp.os.loadComponents()`](./javascript-reference.md#wposloadcomponents-tags---stable) for the cost, and [`examples/load-components.md`](./examples/load-components.md) for a working panel.

Neither registers a tag twice: `defineComponent()` no-ops on a tag the registry already has, and the runtime loader skips the fetch when the tags asked for are all present.

## Source of truth

`src/ui/components/index.ts` re-exports every component class AND the `OS_COMPONENT_TAGS` constant — the array all the dev-time guards iterate. The constant itself is defined in `src/ui/components/tags.ts` (the single source of truth, kept side-effect-free); the index re-exports it. If this doc and the index disagree, the index wins. To add a new component:

1. Create `src/ui/components/<name>/<name>.ts`, `<name>.styles.ts`, `<name>.test.ts`.
2. Add the class export to `src/ui/components/index.ts`.
3. Add the tag to `src/ui/components/tags.ts` (the single source of `OS_COMPONENT_TAGS`, re-exported by `index.ts`).
4. Add a row to this table.
5. Document via the `static help = { … }` block on the class — surfaced in OpenStation Preferences → Components live.

## Browsing the kit at runtime

**OpenStation Preferences → Components** (admin-only) renders this table live: every tag in `OS_COMPONENT_TAGS`, with its props, slots, events, parts, CSS custom properties, and a working example rendered from the `static help.example` template.

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
| `<os-disclosure>` | `OsDisclosure` | `os-disclosure/os-disclosure.ts` | Titled section that folds away. Closed by default. |

## Form controls

| Tag | Class | Source | Purpose |
| --- | --- | --- | --- |
| `<os-form>` | `OsForm` | `os-form/os-form.ts` | Form host with auto value-collection + validation. |
| `<os-field-row>` | `OsFieldRow` | `os-field-row/os-field-row.ts` | Label + control + hint + error. Wires the accessible pairing a light-DOM control can't get from a shadow-root `<label for>`: `aria-describedby`, `aria-invalid`, `required`, click-to-focus. |
| `<os-token-field>` | `OsTokenField` | `os-token-field/os-token-field.ts` | Text / textarea whose value contains tokens (`{field:2}`, `{all_fields}`), with a grouped catalogue that inserts at the caret and a live "reads as" preview built from each token's sample. |
| `<os-repeater>` | `OsRepeater` | `os-repeater/os-repeater.ts` | Add / remove / reorder a list of rows whose content you supply. Keyed by stable strings, so a remove or move never rebuilds the rows that didn't change. Reports intent; the consumer owns the data. |
| `<os-text-field>` | `OsTextField` | `os-text-field/os-text-field.ts` | Single-line text input. |
| `<os-textarea>` | `OsTextarea` | `os-textarea/os-textarea.ts` | Multi-line text input. |
| `<os-number-field>` | `OsNumberField` | `os-number-field/os-number-field.ts` | Numeric input with min/max/step. |
| `<os-color-field>` | `OsColorField` | `os-color-field/os-color-field.ts` | Color picker with swatches. |
| `<os-range-field>` | `OsRangeField` | `os-range-field/os-range-field.ts` | Slider with live numeric readout. |
| `<os-checkbox>` | `OsCheckbox` | `os-checkbox/os-checkbox.ts` | Standalone checkbox. |
| `<os-checkbox-label>` | `OsCheckboxLabel` | `os-checkbox-label/os-checkbox-label.ts` | Checkbox + inline label pair. |
| `<os-switch>` | `OsSwitch` | `os-switch/os-switch.ts` | On/off switch for settings that apply immediately. Tap, drag or keyboard. |
| `<os-select>` / `<os-option>` | `OsSelect`, `OsOption` | `os-select/os-select.ts` | Combobox trigger with a custom top-layer listbox popup. |
| `<os-multiselect>` | `OsMultiselect` | `os-multiselect/os-multiselect.ts` | Multi-select with chips. |
| `<os-segmented>` / `<os-segment>` | `OsSegmented`, `OsSegment` | `os-segmented/os-segmented.ts` | Segmented control (radio group as buttons). |
| `<os-tag-input>` | `OsTagInput` | `os-tag-input/os-tag-input.ts` | Free-text tag entry with autocomplete. |
| `<os-category-picker>` | `OsCategoryPicker` | `os-category-picker/os-category-picker.ts` | Category tree picker. |
| `<os-role-picker>` | `OsRolePicker` | `os-role-picker/os-role-picker.ts` | WP role select. |
| `<os-user-search>` | `OsUserSearch` | `os-user-search/os-user-search.ts` | Live user autocomplete (`/desktop-mode/v1/files/users/search` REST). |

### A raw `<input>` in the shell is not a styling choice

The desktop shell is a real `wp-admin` document, so WordPress's own
`forms.css` is loaded and reaches every raw control you put in it:

```css
input[ type="text" ], … , select, textarea {
    background-color: #fff;
    color: #1e1e1e;
    border: 1px solid #949494;
}
```

That selector weighs **(0,1,1)** — one type plus one attribute — which
outranks any single class of your own. A field you had already
tokenized still renders as a white core-chrome box, and on a dark
surface (a dialog, an overlay, a themed panel) the result is a bright
rectangle whose contents are painted by whichever rule *did* win. If
the control also pre-selects its text, the shell's `::selection` —
tuned for dark surfaces — lands light ink on a pale wash over that
white, and the value is effectively unreadable.

The form components above live in shadow DOM, where `forms.css` cannot
follow, and they resolve the palette and the active desktop theme
instead. **Use them.** Raising specificity works too and is what
`.os-window__body :is( input[ type ], … )` in `window-chrome.css` does
for admin markup we don't control — but for markup you *are* writing,
the component is the fix that stays fixed.

Slotting a component into a dark light-DOM surface, re-point the token
family the way `<os-modal>` does on its host, so the field resolves
dark-surface colours:

```css
.my-plugin-dialog {
    /* Foreground. */
    --os-ui-fg:               var( --os-ui-modal-text, #f0f0f1 );
    --os-ui-fg-muted:         var( --os-ui-modal-text-muted, #a7aaad );
    --os-ui-border:           var( --os-ui-modal-border, rgba( 255, 255, 255, 0.25 ) );
    --os-ui-border-strong:    var( --os-ui-modal-border-strong, rgba( 255, 255, 255, 0.35 ) );
    /* Surface — the half that is easy to forget. */
    --os-window-bg:           var( --os-ui-modal-field-bg, #2c3338 );
    --os-ui-surface:          var( --os-ui-modal-surface, #2c3338 );
    --os-ui-surface-elevated: var( --os-ui-modal-surface-elevated, #3c434a );
    /* Washes, which are read against the surface they sit on. */
    --os-ui-hover:            var( --os-ui-modal-hover, rgba( 255, 255, 255, 0.08 ) );
    --os-ui-button-bg-hover:  var( --os-ui-modal-button-bg-hover, rgba( 255, 255, 255, 0.08 ) );
    /* Cards. Their own tokens fall through to --os-ui-surface, so the
       re-point above already reaches them — unless a desktop theme pins
       one flat (Legacy: --os-ui-card-bg: #fff). Own the set. */
    --os-ui-card-bg:           var( --os-ui-modal-surface, #2c3338 );
    --os-ui-card-fg:           var( --os-ui-modal-text, #f0f0f1 );
    --os-ui-card-border:       var( --os-ui-modal-border, rgba( 255, 255, 255, 0.25 ) );
    --os-ui-card-border-hover: var( --os-ui-modal-border-strong, rgba( 255, 255, 255, 0.35 ) );
}
```

Read a palette-owned `--os-ui-modal-*` name first in every one of
them. Declaring the literal directly would make the name unreachable
from a desktop theme — the same trap described in
[`desktop-themes.md`](desktop-themes.md).

**Take the whole list, not the colours you notice.** Foreground and
surface are a pair, and re-pointing only the half you can see is a bug
that hides itself: while the palette outside your dialog is dark, every
token you left behind happens to agree, and the dialog looks right. Put
a light palette outside it — [Legacy](desktop-themes.md#the-legacy-theme--start-here),
or any theme in the admin's own colours — and the halves come apart.
`--os-ui-surface` is the one that bit us: it stayed `#fff`, so an
`<os-select>` in the dialog painted a white trigger and the re-pointed
`--os-ui-fg` wrote near-white text onto it. `--os-ui-hover` was a black
wash over a dark row.

If your surface is dark, you own every token that names a surface or a
wash on one — not just the text.

## Buttons & actions

| Tag | Class | Source | Purpose |
| --- | --- | --- | --- |
| `<os-button>` | `OsButton` | `os-button/os-button.ts` | Primary / secondary / ghost button. |
| `<os-window-button>` | `OsWindowButton` | `os-window-button/os-window-button.ts` | Title-bar icon button (minimize / maximize / close / custom). |

`<os-window-button>` paints an `aria-hidden` glyph inside a shadow
`<button>`, so it has no accessible name of its own — **always set
`aria-label` on the host**. The component forwards it onto that inner
button (which is the element focus lands on) and keeps it in sync when
you relabel the host, e.g. Maximize ⇄ Restore.

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

**`<os-toast>` hold contract.** A toast reports when the user is attending to it — pointer over it, or focus anywhere inside it, including its action and close buttons in the shadow root. While that is true it carries a reflected `held` attribute and, on every transition, emits `os-toast-hold` with `{ held: boolean }`. `showToast()` listens and pauses the auto-dismiss countdown for the duration; a released countdown resumes with the time it had left, floored at 1.2s so a nearly-expired toast doesn't vanish the instant the pointer leaves. `held` is set by the component and is not something to write by hand — a toast that should never expire on its own is `persistent`. Dismissing a toast that currently holds focus hands focus back to the last element outside the toast stack that had it, so clicking `Undo` never drops the user on `<body>`.

**`<os-confirm-dialog>` "don't ask again".** `rememberLabel` (attribute: `remember-label`) renders a checkbox above the buttons, and its state rides along on the `os-confirm` detail as `remember`; the `osConfirm()` wrapper surfaces it as an `onRemember( remember )` callback so the Promise stays a plain `Promise<boolean>`. `onRemember` fires **only on confirm** — a question the user backed out of was never answered, so it cannot have meant "stop asking". Offer the checkbox only where you have somewhere to persist the answer *and* somewhere to turn it back on: an opt-out with no way back is a trap. The shell's own use is the close-all-windows shortcut, which persists to `confirmCloseAllWindows` in OpenStation Preferences → Windows.

**`<os-confirm-dialog>` keyboard contract.** Opening the dialog remembers what had focus and moves focus inside; Tab and Shift+Tab cycle between the dialog's own controls and cannot reach the page behind the scrim; closing — by any route, including `osConfirm()` unmounting the element — hands focus back to the control that opened it. Escape always cancels. Enter is the dialog's *default* action only while no control inside it owns the key: with a button focused, Enter activates **that** button, so Enter on `Cancel` cancels. A `danger` dialog has **no** default action — it opens on the safe control (`Cancel`, or the X that `dismissable` adds, or the container when `hideCancel` leaves neither) and never on its destructive button, and Enter from the container does nothing. Reaching the destructive action is always deliberate: Tab to it, or click it.

## Display & feedback

| Tag | Class | Source | Purpose |
| --- | --- | --- | --- |
| `<os-icon>` | `OsIcon` | `os-icon/os-icon.ts` | Icon by dashicon slug or SVG content. |
| `<os-avatar>` | `OsAvatar` | `os-avatar/os-avatar.ts` | User avatar with presence dot. |
| `<os-badge>` | `OsBadge` | `os-badge/os-badge.ts` | Number badge with tone color. |
| `<os-ribbon>` | `OsRibbon` | `os-ribbon/os-ribbon.ts` | Corner ribbon for tiles. |
| `<os-chip>` | `OsChip` | `os-chip/os-chip.ts` | Tag/category chip with tone. |
| `<os-key>` | `OsKey` | `os-key/os-key.ts` | Keyboard shortcut display. |
| `<os-code>` | `OsCode` | `os-code/os-code.ts` | Inline / block monospace code with copy; `wrap` folds long lines instead of scrolling them sideways. |
| `<os-spinner>` | `OsSpinner` | `os-spinner/os-spinner.ts` | Loading spinner with preset variants; `preset="inline"` is a bare arc for text-adjacent use. |
| `<os-progress-bar>` | `OsProgressBar` | `os-progress-bar/os-progress-bar.ts` | Determinate or indeterminate progress. |
| `<os-save-status>` | `OsSaveStatus` | `os-save-status/os-save-status.ts` | Save indicator (idle / saving / saved / failed). `variant="ring"` is the window title bar's status ring: outline for every phase but success, which fills. |
| `<os-relative-time>` | `OsRelativeTime` | `os-relative-time/os-relative-time.ts` | Auto-updating "2 min ago". |
| `<os-histogram>` | `OsHistogram` | `os-histogram/os-histogram.ts` | Stacked time histogram (inline SVG) with a toggle legend; `series` + `columns` JSON in, `os-series-toggle` out. Colours ride the status tokens. |
| `<os-stat>` | `OsStat` | `os-stat/os-stat.ts` | One stat tile: big value, small uppercase label, optional caption; `swatch` adds a severity chip coloured by the app tone contract (`data-tone` on the host). |
| `<os-empty-state>` | `OsEmptyState` | `os-empty-state/os-empty-state.ts` | Empty-list / no-results placeholder. |
| `<os-rating-summary>` | `OsRatingSummary` | `os-rating-summary/os-rating-summary.ts` | Star average + per-star bucket bars. |

## Lists & tables

| Tag | Class | Source | Purpose |
| --- | --- | --- | --- |
| `<os-table>` | `OsTable` | `os-table/os-table.ts` | Sortable, filterable data table with sub-tables. `stacked` lays every row out as a card — the first column its title, the labelled ones captioned lines, a label-less one the actions row (`column.stack` overrides the role) — for a phone or any width the columns cannot fit; `stack-on-phone.ts` makes that decision from the shell's mode stamp for every list window. |
| `<os-log>` | `OsLog` | `os-log/os-log.ts` | Virtualized streaming log container. |
| `<os-tile>` | `OsTile` | `os-tile/os-tile.ts` | Desktop-style icon tile (used by the desktop file layer, folder windows, and WP Explorer). `selectable` switches it from `listitem` to `option` so it can carry `aria-selected` — the selection controller sets it. |

## Tabs & navigation

| Tag | Class | Source | Purpose |
| --- | --- | --- | --- |
| `<os-tabs>` / `<os-tab>` / `<os-tabpanel>` | `OsTabs`, `OsTab`, `OsTabPanel` | `os-tabs/os-tabs.ts` | Tab strip with associated panels, for a tab group **inside** content. A window's own top-level tabs belong in the window chrome instead — see `Window.setTabs()` in [`javascript-reference.md`](javascript-reference.md). |
| `<os-tab-chip>` | `OsTabChip` | `os-tab-chip/os-tab-chip.ts` | Single chip tab (e.g. window tabs). |
| `<os-steps>` / `<os-step>` | `OsSteps`, `OsStep` | `os-steps/os-steps.ts` | Numbered steps, stacked or as a horizontal trail. `current` marks where the reader is, `interactive` makes a step a way back. |
| `<os-crumb-chain>` | `OsCrumbChain` | `os-crumb-chain/os-crumb-chain.ts` | Breadcrumb trail with chevron separators. |

## Color & theming

| Tag | Class | Source | Purpose |
| --- | --- | --- | --- |
| `<os-swatch>` | `OsSwatch` | `os-swatch/os-swatch.ts` | Single color swatch button. |
| `<os-swatch-grid>` | `OsSwatchGrid` | `os-swatch-grid/os-swatch-grid.ts` | Grid of color swatches with selection. |

## The holographic layer

The kit wears the [OpenStation brand](https://nuriapenya.github.io/open-station-brand/), and the brand ships five mesh gradients with one instruction attached: *"meshes reserved for hero surfaces."* `src/ui/holo.ts` is how a control gets to be one without every component reinventing what holographic means.

**It is a moment, not a skin.** Form controls (checkboxes, radios, switches, sliders, the segmented thumb) wear the flat accent when they are on; selection and state across the kit resolve through `--os-ui-accent`, which follows the accent the user picked in OpenStation Preferences; the mesh appears only where a single surface speaks for the brand, such as `<os-button variant="holo">`. A panel where every surface is iridescent has no identity moments left to spend.

Three treatments, in ascending loudness:

| Fragment | What it does | Who gets it |
| --- | --- | --- |
| `holoEdge` | An iridescent hairline, invisible at rest, lit on hover and focus. | `<os-button>` (all variants but `link`/`danger`), and the *selected* state of `<os-chip>` and `<os-card>` (the selected `<os-swatch>` wears a flat accent ring instead). |
| `holoSheen` | A ~10%-alpha film of the mesh's hues over the existing surface, faded in under the pointer. | `<os-button>`, `<os-key>`, unselected `<os-segment>`. |
| `holoFill` | The mesh itself, at full strength, with Void ink on top. | Checked `<os-menu-item>`, the fill of `<os-progress-bar>`, the `<os-step>` chip, and `<os-button variant="holo">`. Form controls — the on `<os-switch>`, checked `<os-checkbox>` / `<os-checkbox-label>`, the selected `<os-segment>`, the elapsed `<os-range-field>` track — wear the flat accent instead. |

…and five motions, which are what make the surfaces read as foil rather than as paint:

| Fragment | What it does | Who gets it |
| --- | --- | --- |
| `holoGlint` | A specular band crosses the surface once on hover. The single most "holographic" thing in the kit. | `<os-button>`, `<os-key>`, interactive `<os-card>`. |
| `holoRing` | A ring expands out of the control and fades on `:active`, so a press reads as received before its result paints. | `<os-button>`, `<os-key>`. |
| `holoShimmer` | The mesh travelling, for waits of unknown length. | Indeterminate `<os-progress-bar>`. |
| `holoDrift` | The mesh slowly traversing the surface, running for as long as the state lasts. | `<os-button variant="holo" busy>`. |
| `holoEnter` | Scale-and-fade arrival on the spring. | `<os-menu>`, `<os-context-menu>` (`<os-modal>` and `<os-confirm-dialog>` arrive on their own dialog keyframes). |

Plus the motions that belong to one component and stayed there: the `<os-segmented>` thumb that slides between segments, the `<os-tabs>` underline that grows from the centre, the `<os-switch>` knob's spring-and-squash, the `<os-checkbox>` tick landing with an overshoot, `<os-toast>` arriving from above and leaving sideways, and the `<os-avatar>` presence ring — which pulses **only** on `online`, so "who is here" survives being read by someone who cannot separate the three dot colours.

**The pseudo-element budget.** An element has two, and this module wants four effects. `holoSheen` takes `::before` and `holoEdge` takes `::after` — that is the whole budget for a control wearing both, as `<os-button>` does. So `holoGlint` and `holoRing` are **element-based**: the component stamps a `<span class="os-holo-glint">` / `<span class="os-holo-ring">` and the fragment styles it. Both are driven from the parent's state via the **child** combinator (`:active > .os-holo-ring`), which is load-bearing: `:active` matches an activated element *and every ancestor of it*, so a descendant selector would fire every ring on the page.

Two shared fragments carry the states that are not decorative:

- **`holoField`** — one hover, one focus ring, one transition duration and one placeholder colour for every text-like control (`<os-text-field>`, `<os-textarea>`, `<os-number-field>`, `<os-select>`, and any component that renders a bare `input` / `select` / `textarea` in its shadow root). Its selectors wrap their type exclusions in `:where()` so a component's own `aria-invalid` ring still outranks it — an invalid field focuses in red, not in Pulse.
- **`holoCheck`** — the checkbox and radio paint, shared by `<os-checkbox>`, `<os-checkbox-label>` and `<os-table>`'s selection column. It replaced `accent-color` so the checked paint resolves through `--os-ui-accent` — following the accent the user picked — instead of a browser-painted colour the tokens can't reach.

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
| `--os-ui-tab-edge` | The selected row's leading edge in a vertical `<os-tabs>`. The flat accent, so the row says "this one" in the same colour as every control beside it. |
| `--os-ui-tab-wash` / `--os-ui-tab-bloom` | That row's surface wash, and the bloom the edge throws back across it. Both ambient, so both resolve through `--os-ui-accent-dim`. |
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

Not every class in the tables above is importable from `'openstation'`. The package `exports` map exposes the entry point (`src/public-api.ts`) plus two subpaths — `openstation/activity` and `openstation/global` (ambient types); the entry point re-exports the **Stable** kit: `OsAvatar`, `OsBadge`, `OsButton`, `OsCheckboxLabel`, `OsCluster`, `OsCode`, `OsColorField`, `OsDisplay`, `OsEmptyState`, `OsGrid`, `OsIcon`, `OsKey`, `OsLog`, `OsMenu`, `OsMenuItem`, `OsPanel`, `OsRangeField`, `OsSection`, `OsSegment`, `OsSegmented`, `OsStack`, `OsStep`, `OsSteps`, `OsSwatch`, `OsSwatchGrid`, `OsTab`, `OsTabChip`, `OsTabs`, `OsTextarea`, `OsToast`, `OsToastContainer`, `OsWindowButton`. If `src/public-api.ts` and this list disagree, the source wins.

The remaining classes are internal-only for now — any other subpath / source-path import is blocked by the `exports` map — though their *tags* still work wherever a loaded bundle has registered them. The class import is for type-checking, subclassing, or programmatic instantiation; importing anything from `'openstation'` also registers every tag as a side effect. See [`use-from-a-plugin.md`](./use-from-a-plugin.md) for the local-install workflow.

## Per-component help

Every class has a `static help = { … }` block with full props / slots / events / examples / status. The OpenStation Preferences → Components tab iterates `OS_COMPONENT_TAGS` and renders these descriptors live; that's the authoritative per-component reference. The table above is a directory; the `static help` block is the manual.
