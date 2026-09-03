import { css } from '../../core';
import { holoTokens, holoCheck } from '../../holo';

/**
 * Styles for `<os-table>`.
 *
 * ## The sticky-cell rule
 *
 * Two invariants every cell rule has to respect:
 *
 *   1. Every cell carries an **opaque base background-color**. Sticky
 *      cells need this so non-sticky siblings sliding under them on
 *      horizontal scroll don't bleed through. We never paint over
 *      this with a translucent value (the classic
 *      tr:hover td { background: rgba(0,0,0,0.04) } mistake leaves
 *      sticky cells effectively transparent).
 *
 *   2. State overlays (stripe / hover / sub-table inset) layer on top
 *      via background-image: linear-gradient(rgba, rgba), which
 *      stacks above background-color instead of replacing it.
 *      Result: solid base + translucent overlay = opaque cell, even
 *      when stripe + hover combine on a sticky row.
 *
 *   3. Selection state uses color-mix to *compute* an opaque tint
 *      from the theme color and the base — same effect, different
 *      mechanism (cleaner for the "deeper hover on selected" case).
 *
 * ## Z-index ladder
 *
 * Wide gaps (10 / 20 / 30 / 40) so there's no ambiguity in stacking
 * across browser table-cell quirks:
 *
 *   - 10  body sticky cells (above non-sticky body cells)
 *   - 20  sticky-header non-sticky thead cells (above body sticky)
 *   - 30  sticky-column thead cells (above sticky-header non-sticky)
 *   - 40  the corner cell (sticky-header AND sticky-column)
 *
 * ## Why the defaults are `--_aliases`
 *
 * A custom property declared on `:host` matches the host element, so
 * it outranks anything that element would otherwise INHERIT. The
 * palette (`body.os-active`) and every desktop theme
 * (`body.os-desktop-theme-<slug>`) declare on an ancestor,
 * so `--os-ui-table-bg: …` on `:host` did not set a default — it made
 * the public token unreachable from either. The Legacy snapshot
 * carries all nine of these names and not one of them reached a
 * table.
 *
 * Reading the public token INTO a private alias inverts it: with no
 * declaration on the host to find, the `var()` resolves the inherited
 * value — theme first, palette next, the pre-brand literal last.
 * Per-instance overrides (`os-table { --os-ui-table-bg: … }` in the
 * document tree) always worked and still do; this is what fixes the
 * ancestor case. Same pattern as `<os-rating-summary>`.
 */
export const styles = css`
	${ holoTokens }
	${ holoCheck }

	:host {
		display: block;
		/* --os-ui-surface is the host theme's surface color; #fff is
		   the hard fallback so a missing theme variable can never
		   produce a transparent table. Consumers override
		   --os-ui-table-bg directly to opt out of the surface chain. */
		--_bg: var( --os-ui-table-bg, var( --os-ui-surface, #fff ) );
		--_border: var(
			--os-ui-table-border,
			var( --os-ui-border, rgba( 0, 0, 0, 0.08 ) )
		);
		/* Column dividers when [bordered] is set. Defaults darker
		 * than --os-ui-table-border because row separators read fine
		 * at low contrast (the eye scans top-to-bottom and the gap
		 * between rows is enough), but column separators need to
		 * actively SAY "this column ends here" to the user. Override
		 * to match --os-ui-table-border for the original ghosted look. */
		--_column-border: var(
			--os-ui-table-column-border,
			var( --os-ui-border-strong, rgba( 0, 0, 0, 0.14 ) )
		);
		--_header-bg: var(
			--os-ui-table-header-bg,
			var( --os-ui-surface-elevated, #f6f7f7 )
		);
		/* Translucent overlays — these are LAYERED, never replaced
		   into a base background. Keep them rgba so they compose
		   across stripe + hover combinations.

		   Both chain through a palette token after the public one, so
		   they follow the palette's direction even unthemed: a black
		   wash lightens nothing on a dark surface. The literals are
		   unchanged, so an unthemed table stripes and hovers exactly
		   as it always did. */
		--_row-hover: var(
			--os-ui-table-row-hover,
			var( --os-ui-hover, rgba( 0, 0, 0, 0.04 ) )
		);
		--_stripe: var(
			--os-ui-table-stripe,
			var( --os-ui-surface-subtle, rgba( 0, 0, 0, 0.03 ) )
		);
		--_cell-padding: var( --os-ui-table-cell-padding, 8px 12px );
		--_font-size: var( --os-ui-table-font-size, 13px );
		--_max-height: var( --os-ui-table-max-height, none );
		font-size: var( --_font-size );
		color: inherit;
	}
	:host( [ hidden ] ) {
		display: none;
	}

	.scroll {
		position: relative;
		overflow: auto;
		max-height: var( --_max-height );
		border: 1px solid var( --_border );
		border-radius: 4px;
		background: var( --_bg );
	}

	table {
		width: 100%;
		border-collapse: separate;
		border-spacing: 0;
		background: var( --_bg );
	}

	/* ---------------------------------------------------------------
	 * Cell base — opaque background-color always. State overlays are
	 * applied as background-images below.
	 * ------------------------------------------------------------- */
	thead th {
		text-align: start;
		font-weight: 600;
		background-color: var( --_header-bg );
		/* Desktop-theme texture slot: unset resolves to none. */
		background-image: var( --os-ui-table-header-bg-image, none );
		background-repeat: var( --os-ui-table-header-bg-image-repeat, repeat );
		background-size: var( --os-ui-table-header-bg-image-size, auto );
		background-position: var( --os-ui-table-header-bg-image-position, center );
		padding: var( --_cell-padding );
		border-bottom: 1px solid var( --_border );
		white-space: nowrap;
	}

	tbody td {
		padding: var( --_cell-padding );
		border-bottom: 1px solid var( --_border );
		background-color: var( --_bg );
		vertical-align: middle;
	}

	tbody tr:last-child td {
		border-bottom: 0;
	}

	/* Stripe + hover are LAYERED via background-image so they never
	   replace the opaque base color. The linear-gradient(rgba, rgba)
	   trick paints a flat translucent fill on top of background-color. */
	:host( [ striped ] ) tbody tr:nth-child( odd ) td {
		background-image: linear-gradient(
			var( --_stripe ),
			var( --_stripe )
		);
	}

	:host( [ hover ] ) tbody tr:hover td {
		background-image: linear-gradient(
			var( --_row-hover ),
			var( --_row-hover )
		);
	}

	/* Hover + stripe — both overlays stack. background-image accepts a
	   comma-separated list, painted top-to-bottom. */
	/* One compound selector inside :host() — a space between the two
	   attribute selectors would make it a descendant selector, which
	   :host() rejects, and the browser would drop the whole rule
	   without a word. (That is what it did, until it was written this
	   way.) */
	:host( [ hover ][ striped ] )
		tbody
		tr:nth-child( odd ):hover
		td {
		background-image:
			linear-gradient(
				var( --_row-hover ),
				var( --_row-hover )
			),
			linear-gradient(
				var( --_stripe ),
				var( --_stripe )
			);
	}

	/* Keeps declaring the PUBLIC tokens, not the aliases: the aliases
	   read them off the host, so compact still overrides the default,
	   and a consumer rule in the document tree still outranks compact
	   the way it always did. Only the base defaults moved. */
	:host( [ compact ] ) {
		--os-ui-table-cell-padding: 4px 8px;
		--os-ui-table-font-size: 12px;
	}

	:host( [ bordered ] ) thead th,
	:host( [ bordered ] ) tbody td {
		border-inline-end: 1px solid var( --_column-border );
	}
	:host( [ bordered ] ) thead th:last-child,
	:host( [ bordered ] ) tbody td:last-child {
		border-inline-end: 0;
	}

	/* ---------------------------------------------------------------
	 * Sticky positioning. Inline inset-inline-start is written by
	 * JS after layout (variable column widths can't be expressed in
	 * pure CSS). The class names drive position + z-index.
	 *
	 * Z-index ladder — see file header comment.
	 * ------------------------------------------------------------- */
	th.is-sticky,
	td.is-sticky {
		position: sticky;
		z-index: 10;
	}
	/* Body sticky cells inherit their opaque base + overlays from the
	   tbody td rules above. Re-asserting background-color here is
	   redundant but defensive: if a consumer ships a CSS rule that
	   targets .is-sticky and accidentally clears background-color,
	   this acts as a backstop. */
	tbody td.is-sticky {
		background-color: var( --_bg );
	}
	thead th.is-sticky {
		background-color: var( --_header-bg );
		/* Desktop-theme texture slot: unset resolves to none. */
		background-image: var( --os-ui-table-header-bg-image, none );
		background-repeat: var( --os-ui-table-header-bg-image-repeat, repeat );
		background-size: var( --os-ui-table-header-bg-image-size, auto );
		background-position: var( --os-ui-table-header-bg-image-position, center );
		z-index: 30;
	}

	/* Sticky header (whole thead pins to the scroll container's top). */
	:host( [ sticky-header ] ) thead th {
		position: sticky;
		top: 0;
		z-index: 20;
	}
	:host( [ sticky-header ] ) thead tr.filter-row th {
		top: var( --os-ui-table-header-height, 33px );
		z-index: 20;
	}
	/* The intersection — sticky-column header cell when sticky-header
	   is also on. This is the corner that has to win every stacking
	   contest. */
	:host( [ sticky-header ] ) thead th.is-sticky {
		z-index: 40;
	}
	:host( [ sticky-header ] ) thead tr.filter-row th.is-sticky {
		z-index: 40;
	}

	/* The last sticky column gets a solid divider on its right edge
	   so the boundary between pinned and scrolling content is always
	   visible — even when the table isn't scrolled and especially on
	   light themes. Themed via --os-ui-table-sticky-edge so consumers
	   can override (color, width, style). Border paints as part of
	   the cell box, so there are no stacking-context surprises. */
	th.is-sticky-edge,
	td.is-sticky-edge {
		border-inline-end: var(
			--os-ui-table-sticky-edge,
			2px solid var( --_border )
		);
	}

	/* Per-column alignment + width. */
	.align-center {
		text-align: center;
	}
	.align-end {
		text-align: end;
	}

	/* Filter row inputs. */
	.filter-row th {
		padding: 4px 8px;
		background-color: var( --_header-bg );
		/* Desktop-theme texture slot: unset resolves to none. */
		background-image: var( --os-ui-table-header-bg-image, none );
		background-repeat: var( --os-ui-table-header-bg-image-repeat, repeat );
		background-size: var( --os-ui-table-header-bg-image-size, auto );
		background-position: var( --os-ui-table-header-bg-image-position, center );
		border-bottom: 1px solid var( --_border );
		font-weight: 400;
	}
	.filter-input,
	.filter-select {
		width: 100%;
		min-width: 60px;
		box-sizing: border-box;
		padding: 4px 6px;
		font: inherit;
		color: inherit;
		background-color: var( --_bg );
		border: 1px solid var( --_border );
		border-radius: 3px;
	}
	.filter-input:focus,
	.filter-select:focus {
		outline: none;
		border-color: var( --os-ui-accent, #2271b1 );
		box-shadow: var( --_holo-focus-field );
	}

	/* Expander column. */
	.expander {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		padding: 0;
		border: 0;
		background: transparent;
		color: inherit;
		cursor: pointer;
		border-radius: 3px;
		font-size: 11px;
		line-height: 1;
	}
	.expander:hover {
		background: var( --os-ui-hover, rgba( 0, 0, 0, 0.06 ) );
	}
	/*
	 * System columns (expander + select) zero out horizontal cell
	 * padding so their fixed-width control isn't clipped by the
	 * default 12px side padding. The column WIDTH below is sized
	 * to leave a few px of visible gap around the control once
	 * text-align centers it.
	 */
	td.col-expander,
	th.col-expander {
		width: 36px;
		min-width: 36px;
		padding-left: 0;
		padding-right: 0;
		text-align: center;
	}

	/* Sub-table row — opaque base so the sticky cells in the parent
	   row above don't bleed visually into the inset stripe. */
	tr.subtable td {
		padding: 0;
		background-color: var( --_bg );
		background-image: linear-gradient(
			var( --_stripe ),
			var( --_stripe )
		);
		border-bottom: 1px solid var( --_border );
	}
	tr.subtable .subtable-inner {
		padding: 8px 12px 8px 32px;
	}

	/* Empty placeholder. */
	tr.empty td {
		padding: 24px;
		text-align: center;
		color: var( --os-ui-text-muted, var( --os-ui-fg-muted, rgba( 0, 0, 0, 0.55 ) ) );
		font-style: italic;
	}

	/* Sortable headers. Hover overlay layered, not replacing. */
	thead th.is-sortable {
		cursor: pointer;
		user-select: none;
	}
	thead th.is-sortable:hover {
		background-image: linear-gradient(
			var( --_row-hover ),
			var( --_row-hover )
		);
	}
	/* Inset — a header cell is flush with the table edge, so an
	   outward ring would be clipped on the first and last column. */
	thead th.is-sortable:focus-visible {
		outline: none;
		box-shadow: inset 0 0 0 2px var( --os-ui-accent, #2271b1 );
	}
	.sort-indicator {
		font-size: 10px;
		color: var( --os-ui-text-muted, var( --os-ui-fg-muted, rgba( 0, 0, 0, 0.55 ) ) );
		margin-inline-start: 2px;
	}
	thead th.sort-asc .sort-indicator,
	thead th.sort-desc .sort-indicator {
		color: var( --wp-admin-theme-color, #2271b1 );
	}

	/* Selection. color-mix produces an opaque tint from theme +
	   base, so sticky selected cells stay opaque without needing a
	   layered overlay. */
	td.col-select,
	th.col-select {
		width: 40px;
		min-width: 40px;
		padding-left: 0;
		padding-right: 0;
		text-align: center;
	}
	.select-all-checkbox,
	.select-row-checkbox {
		cursor: pointer;
		margin: 0;
	}
	tbody tr.is-selected td {
		background-color: color-mix(
			in srgb,
			var( --wp-admin-theme-color, #2271b1 ) 10%,
			var( --_bg )
		);
		background-image: none;
	}
	tbody tr.is-selected:hover td {
		background-color: color-mix(
			in srgb,
			var( --wp-admin-theme-color, #2271b1 ) 16%,
			var( --_bg )
		);
	}

	/*
	 * The selected row's leading-edge marker.
	 *
	 * A 10%-alpha wash is the correct selection tint and a weak
	 * signal: in a table of forty rows it is easy to lose, and for
	 * anyone who cannot separate those two greys it is not there at
	 * all. The marker states the same thing a second way — a 3 px
	 * accent bar down the leading edge of the first cell.
	 *
	 * An inset box-shadow rather than a background layer, because the
	 * cell backgrounds are already carrying the stripe and the hover
	 * overlay (see the sticky-cell rule at the top of this file) and
	 * a third layer would have to win an argument with both. An inset
	 * shadow paints above every one of them and costs no layout, which
	 * a border-inline-start would.
	 *
	 * box-shadow offsets are physical, so RTL takes the :dir() rule
	 * below. Where :dir() is unsupported the marker stays on the left
	 * in an RTL table — cosmetically wrong, still legible, and not
	 * worth a per-table direction probe in JS.
	 */
	tbody tr.is-selected td:first-child {
		box-shadow: inset 3px 0 0 0 var( --os-ui-accent, #2271b1 );
	}
	tbody:dir( rtl ) tr.is-selected td:first-child {
		box-shadow: inset -3px 0 0 0 var( --os-ui-accent, #2271b1 );
	}

	/* ---------------------------------------------------------------
	 * Stacked layout — a card per row (the phone's list).
	 *
	 * The table elements stay (the paint path, the selection sync and
	 * the events are shared with the grid); they are simply laid out
	 * as blocks. A row is a flex line: the leading system cells (the
	 * checkbox, the expander) sit at the start, and one td.stack-body
	 * holds the data columns as a column of .stack-cell blocks. The row
	 * owns the background now, so the cells paint nothing — the
	 * stripe, hover and selection overlays move up one level.
	 * ------------------------------------------------------------- */
	:host( [ stacked ] ) .scroll {
		border: 0;
		border-radius: 0;
	}
	:host( [ stacked ] ) table,
	:host( [ stacked ] ) tbody {
		display: block;
		width: 100%;
	}
	:host( [ stacked ] ) colgroup,
	:host( [ stacked ] ) thead {
		display: none;
	}
	:host( [ stacked ] ) tbody tr {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		padding: 12px 14px;
		border-bottom: 1px solid var( --_border );
		background-color: var( --_bg );
	}
	:host( [ stacked ] ) tbody tr:last-child {
		border-bottom: 0;
	}
	/* Every cell rule the grid has — the base, the stripe, the hover,
	   the selection tint, the column border — is undone here in one
	   list, at a specificity above each of them. The attribute pairs
	   inside :host() are ONE compound selector each (no space): a
	   space would make the list invalid and the browser would drop it
	   whole, leaving every card with the grid's chrome. */
	:host( [ stacked ] ) tbody td,
	:host( [ stacked ] ) tbody tr.is-selected td,
	:host( [ stacked ] ) tbody tr.is-selected:hover td,
	:host( [ stacked ][ striped ] ) tbody tr:nth-child( odd ) td,
	:host( [ stacked ][ hover ] ) tbody tr:hover td,
	:host( [ stacked ][ hover ][ striped ] ) tbody tr:nth-child( odd ):hover td,
	:host( [ stacked ][ bordered ] ) tbody td {
		display: block;
		padding: 0;
		border: 0;
		background-color: transparent;
		background-image: none;
		box-shadow: none;
		min-width: 0;
		width: auto;
		vertical-align: baseline;
	}
	:host( [ stacked ][ hover ] ) tbody tr:hover {
		background-image: linear-gradient(
			var( --_row-hover ),
			var( --_row-hover )
		);
	}
	:host( [ stacked ] ) tbody tr.is-selected,
	:host( [ stacked ] ) tbody tr.is-selected:hover {
		background-color: color-mix(
			in srgb,
			var( --wp-admin-theme-color, #2271b1 ) 10%,
			var( --_bg )
		);
		background-image: none;
		box-shadow: inset 3px 0 0 0 var( --os-ui-accent, #2271b1 );
	}
	:host( [ stacked ] ) tbody:dir( rtl ) tr.is-selected {
		box-shadow: inset -3px 0 0 0 var( --os-ui-accent, #2271b1 );
	}
	/* The leading cells: the checkbox cell is the tap target — 44px
	   square through its padding, pulled back by a negative margin so
	   the box itself still sits where the card's inset puts it. */
	:host( [ stacked ] ) tbody td.col-select,
	:host( [ stacked ] ) tbody td.col-expander {
		flex: 0 0 auto;
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 0;
	}
	:host( [ stacked ] ) tbody td.col-select {
		width: 44px;
		height: 44px;
		margin: -11px 0 -11px -11px;
		cursor: pointer;
	}
	:host( [ stacked ] ) .select-row-checkbox {
		width: 22px;
		height: 22px;
	}
	:host( [ stacked ] ) tbody td.col-expander {
		width: 28px;
		height: 22px;
		margin-inline-start: -4px;
	}
	:host( [ stacked ] ) tbody td.stack-body {
		flex: 1 1 auto;
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
	}
	.stack-cell {
		display: flex;
		align-items: baseline;
		gap: 6px;
		min-width: 0;
		line-height: 1.4;
	}
	.stack-title {
		font-size: 15px;
		font-weight: 600;
		line-height: 1.35;
	}
	.stack-meta {
		font-size: 13px;
	}
	.stack-label {
		flex: 0 0 auto;
		font-size: 12px;
		color: var( --os-ui-text-muted, var( --os-ui-fg-muted, rgba( 0, 0, 0, 0.55 ) ) );
	}
	.stack-label::after {
		content: '·';
		margin-inline-start: 6px;
	}
	.stack-value {
		flex: 1 1 auto;
		min-width: 0;
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 6px;
	}
	.stack-actions {
		margin-block-start: 6px;
	}
	.stack-actions .stack-value {
		gap: 8px;
	}
	/* Anything a renderer sized for a cell — a fixed-width action
	   cluster, a right-aligned wrap — flows with the card instead. */
	.stack-actions .stack-value > * {
		justify-content: flex-start;
		max-width: 100%;
	}
	:host( [ stacked ] ) tr.subtable,
	:host( [ stacked ] ) tr.empty {
		display: block;
		padding: 0;
	}
	:host( [ stacked ] ) tr.subtable td {
		background-image: linear-gradient(
			var( --_stripe ),
			var( --_stripe )
		);
	}
	:host( [ stacked ] ) tr.subtable .subtable-inner {
		padding: 8px 14px 12px;
	}
	:host( [ stacked ] ) tr.empty td {
		padding: 24px;
	}
	:host( [ stacked ] ) tr.skeleton {
		display: block;
		padding: 14px;
		border-bottom: 1px solid var( --_border );
	}
	:host( [ stacked ] ) tr.skeleton td.stack-body {
		gap: 8px;
	}
	:host( [ stacked ] ) tr.skeleton .skeleton-bar:first-child {
		height: 15px;
	}

	/* Loading skeleton. */
	tbody tr.skeleton td {
		padding: var( --_cell-padding );
	}
	.skeleton-bar {
		display: block;
		height: 12px;
		border-radius: 3px;
		background: linear-gradient(
			90deg,
			var( --os-ui-table-skeleton-color, var( --os-ui-hover, rgba( 0, 0, 0, 0.06 ) ) ) 0%,
			var( --os-ui-table-skeleton-highlight, var( --os-ui-hover, rgba( 0, 0, 0, 0.14 ) ) ) 50%,
			var( --os-ui-table-skeleton-color, var( --os-ui-hover, rgba( 0, 0, 0, 0.06 ) ) ) 100%
		);
		background-size: 200% 100%;
		animation: os-table-skeleton-pulse 1.4s ease-in-out infinite;
	}
	@keyframes os-table-skeleton-pulse {
		0% {
			background-position: 200% 50%;
		}
		100% {
			background-position: -200% 50%;
		}
	}
	@media ( prefers-reduced-motion: reduce ) {
		.skeleton-bar {
			animation: none;
		}
	}
`;
