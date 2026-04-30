import { css } from '../../core';

/**
 * Styles for `<wpd-table>`.
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
 */
export const styles = css`
	:host {
		display: block;
		/* --wpd-surface is the host theme's surface color; #fff is
		   the hard fallback so a missing theme variable can never
		   produce a transparent table. Consumers override
		   --wpd-table-bg directly to opt out of the surface chain. */
		--wpd-table-bg: var( --wpd-surface, #fff );
		--wpd-table-border: var( --wpd-border, rgba( 0, 0, 0, 0.08 ) );
		--wpd-table-header-bg: var( --wpd-surface-elevated, #f6f7f7 );
		/* Translucent overlays — these are LAYERED, never replaced
		   into a base background. Keep them rgba so they compose
		   across stripe + hover combinations. */
		--wpd-table-row-hover: rgba( 0, 0, 0, 0.04 );
		--wpd-table-stripe: rgba( 0, 0, 0, 0.03 );
		--wpd-table-cell-padding: 8px 12px;
		--wpd-table-font-size: 13px;
		--wpd-table-max-height: none;
		font-size: var( --wpd-table-font-size );
		color: inherit;
	}
	:host( [ hidden ] ) {
		display: none;
	}

	.scroll {
		position: relative;
		overflow: auto;
		max-height: var( --wpd-table-max-height );
		border: 1px solid var( --wpd-table-border );
		border-radius: 4px;
		background: var( --wpd-table-bg );
	}

	table {
		width: 100%;
		border-collapse: separate;
		border-spacing: 0;
		background: var( --wpd-table-bg );
	}

	/* ---------------------------------------------------------------
	 * Cell base — opaque background-color always. State overlays are
	 * applied as background-images below.
	 * ------------------------------------------------------------- */
	thead th {
		text-align: start;
		font-weight: 600;
		background-color: var( --wpd-table-header-bg );
		padding: var( --wpd-table-cell-padding );
		border-bottom: 1px solid var( --wpd-table-border );
		white-space: nowrap;
	}

	tbody td {
		padding: var( --wpd-table-cell-padding );
		border-bottom: 1px solid var( --wpd-table-border );
		background-color: var( --wpd-table-bg );
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
			var( --wpd-table-stripe ),
			var( --wpd-table-stripe )
		);
	}

	:host( [ hover ] ) tbody tr:hover td {
		background-image: linear-gradient(
			var( --wpd-table-row-hover ),
			var( --wpd-table-row-hover )
		);
	}

	/* Hover + stripe — both overlays stack. background-image accepts a
	   comma-separated list, painted top-to-bottom. */
	:host( [ hover ] [ striped ] )
		tbody
		tr:nth-child( odd ):hover
		td {
		background-image:
			linear-gradient(
				var( --wpd-table-row-hover ),
				var( --wpd-table-row-hover )
			),
			linear-gradient(
				var( --wpd-table-stripe ),
				var( --wpd-table-stripe )
			);
	}

	:host( [ compact ] ) {
		--wpd-table-cell-padding: 4px 8px;
		--wpd-table-font-size: 12px;
	}

	:host( [ bordered ] ) thead th,
	:host( [ bordered ] ) tbody td {
		border-inline-end: 1px solid var( --wpd-table-border );
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
		background-color: var( --wpd-table-bg );
	}
	thead th.is-sticky {
		background-color: var( --wpd-table-header-bg );
		z-index: 30;
	}

	/* Sticky header (whole thead pins to the scroll container's top). */
	:host( [ sticky-header ] ) thead th {
		position: sticky;
		top: 0;
		z-index: 20;
	}
	:host( [ sticky-header ] ) thead tr.filter-row th {
		top: var( --wpd-table-header-height, 33px );
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

	/* The last sticky column gets a soft shadow so the scrolling
	   content visibly slides underneath it. */
	th.is-sticky-edge,
	td.is-sticky-edge {
		box-shadow: 4px 0 6px -4px rgba( 0, 0, 0, 0.18 );
	}
	[ dir='rtl' ] th.is-sticky-edge,
	[ dir='rtl' ] td.is-sticky-edge {
		box-shadow: -4px 0 6px -4px rgba( 0, 0, 0, 0.18 );
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
		background-color: var( --wpd-table-header-bg );
		border-bottom: 1px solid var( --wpd-table-border );
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
		background-color: var( --wpd-table-bg );
		border: 1px solid var( --wpd-table-border );
		border-radius: 3px;
	}
	.filter-input:focus,
	.filter-select:focus {
		outline: 2px solid var( --wp-admin-theme-color, #2271b1 );
		outline-offset: -1px;
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
		background: rgba( 0, 0, 0, 0.06 );
	}
	.col-expander {
		width: 32px;
		text-align: center;
	}

	/* Sub-table row — opaque base so the sticky cells in the parent
	   row above don't bleed visually into the inset stripe. */
	tr.subtable td {
		padding: 0;
		background-color: var( --wpd-table-bg );
		background-image: linear-gradient(
			var( --wpd-table-stripe ),
			var( --wpd-table-stripe )
		);
		border-bottom: 1px solid var( --wpd-table-border );
	}
	tr.subtable .subtable-inner {
		padding: 8px 12px 8px 32px;
	}

	/* Empty placeholder. */
	tr.empty td {
		padding: 24px;
		text-align: center;
		color: var( --wpd-text-muted, rgba( 0, 0, 0, 0.55 ) );
		font-style: italic;
	}

	/* Sortable headers. Hover overlay layered, not replacing. */
	thead th.is-sortable {
		cursor: pointer;
		user-select: none;
	}
	thead th.is-sortable:hover {
		background-image: linear-gradient(
			var( --wpd-table-row-hover ),
			var( --wpd-table-row-hover )
		);
	}
	thead th.is-sortable:focus-visible {
		outline: 2px solid var( --wp-admin-theme-color, #2271b1 );
		outline-offset: -2px;
	}
	.sort-indicator {
		font-size: 10px;
		color: var( --wpd-text-muted, rgba( 0, 0, 0, 0.55 ) );
		margin-inline-start: 2px;
	}
	thead th.sort-asc .sort-indicator,
	thead th.sort-desc .sort-indicator {
		color: var( --wp-admin-theme-color, #2271b1 );
	}

	/* Selection. color-mix produces an opaque tint from theme +
	   base, so sticky selected cells stay opaque without needing a
	   layered overlay. */
	.col-select {
		width: 36px;
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
			var( --wpd-table-bg )
		);
		background-image: none;
	}
	tbody tr.is-selected:hover td {
		background-color: color-mix(
			in srgb,
			var( --wp-admin-theme-color, #2271b1 ) 16%,
			var( --wpd-table-bg )
		);
	}

	/* Loading skeleton. */
	tbody tr.skeleton td {
		padding: var( --wpd-table-cell-padding );
	}
	.skeleton-bar {
		display: block;
		height: 12px;
		border-radius: 3px;
		background: linear-gradient(
			90deg,
			var( --wpd-table-skeleton-color, rgba( 0, 0, 0, 0.06 ) ) 0%,
			var( --wpd-table-skeleton-highlight, rgba( 0, 0, 0, 0.14 ) ) 50%,
			var( --wpd-table-skeleton-color, rgba( 0, 0, 0, 0.06 ) ) 100%
		);
		background-size: 200% 100%;
		animation: wpd-table-skeleton-pulse 1.4s ease-in-out infinite;
	}
	@keyframes wpd-table-skeleton-pulse {
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
