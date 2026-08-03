/**
 * `<wpd-category-picker>` — shadow-DOM styles. The host renders a
 * compact chip row with an optional inline trigger + popover. The
 * tree-style picker lives inside the popover; collapsible branches,
 * indent guides, search, keyboard nav.
 */
import { css } from '../../core';

export const styles = css`
	:host {
		display: flex;
		width: 100%;
		min-width: 0;
		max-width: 100%;
		align-items: stretch;
	}

	.wpd-cat {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 4px;
		padding: var( --wpd-cat-padding, 2px );
		min-height: 24px;
		max-width: 100%;
		width: 100%;
	}

	.wpd-cat__chips {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var( --wpd-cat-gap, 4px );
		min-width: 0;
	}

	/* Multiple breadcrumb chains stack as flex rows that can wrap;
	 * a small gap keeps vertical separation when chains break onto
	 * two lines so they don't read as a single solid block. */
	.wpd-cat__chains {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		min-width: 0;
	}


	/* --- In-cell tree visualization ------------------------------
	 * The cell renders an inline SVG of the user's selected category
	 * tree as a horizontal phylogenetic diagram. Root → leaves grow
	 * left → right, connected by smooth cubic-bezier curves. Each
	 * top-level category gets its own hashed hue so every node and
	 * connector under it shares one color, providing the visual
	 * grouping cue at a glance.
	 *
	 * Selected leaves are large filled circles with the accent
	 * glow; on-path ancestors that the user did NOT pick are
	 * smaller dim outline circles. The TREE itself, drawn in
	 * vectors, is the hierarchy — typography stays minimal and the
	 * eye reads structure from shapes and connectors instead of
	 * indentation or text decorations.
	 *
	 * Click anywhere on the cell to open the picker. Click a leaf
	 * node directly to toggle that leaf without leaving the cell.
	 * Hover any node to glow its path-to-root, so dense trees
	 * remain readable.
	 */
	.wpd-cat__viz-host {
		display: flex;
		align-items: center;
		gap: 4px;
		min-width: 0;
		flex: 1 1 auto;
		max-width: 100%;
		min-height: 28px;
		cursor: pointer;
		position: relative;
	}

	.wpd-cat__viz-svg {
		display: block;
		width: 100%;
		max-width: 100%;
		min-width: 0;
		overflow: visible;
		flex: 1 1 auto;
	}

	.wpd-cat__viz-svg .wpd-cat-edge {
		fill: none;
		stroke: var( --wpd-cat-edge-color, currentColor );
		stroke-width: 1.25;
		stroke-linecap: round;
		opacity: 0.55;
		transition: stroke-width 0.18s ease, opacity 0.18s ease;
	}
	.wpd-cat__viz-svg .wpd-cat-edge[ data-active='true' ] {
		stroke-width: 2;
		opacity: 1;
	}

	.wpd-cat__viz-svg .wpd-cat-node {
		cursor: pointer;
		transition:
			r 0.2s cubic-bezier( 0.34, 1.56, 0.64, 1 ),
			fill 0.18s ease,
			stroke-width 0.18s ease,
			filter 0.18s ease;
	}
	.wpd-cat__viz-svg .wpd-cat-node[ data-selected='true' ] {
		filter: drop-shadow(
			0 0 6px var( --wpd-cat-node-glow, rgba( 0, 0, 0, 0.18 ) )
		);
	}
	.wpd-cat__viz-svg .wpd-cat-node:hover,
	.wpd-cat__viz-svg .wpd-cat-node:focus-visible {
		filter: drop-shadow(
			0 0 8px var( --wpd-cat-node-glow, rgba( 0, 0, 0, 0.3 ) )
		);
		outline: none;
	}

	.wpd-cat__viz-svg .wpd-cat-label {
		font-family: var( --wpd-font, system-ui, sans-serif );
		font-size: 10.5px;
		fill: var( --wpd-cat-label-fg, var( --wpd-fg, #1d2327 ) );
		font-weight: 500;
		pointer-events: none;
		user-select: none;
	}
	.wpd-cat__viz-svg .wpd-cat-label[ data-selected='false' ] {
		fill: var( --wpd-cat-label-muted, var( --wpd-fg-muted, #8c8f94 ) );
		font-weight: 400;
		font-style: italic;
	}

/* Trigger — minimal compact button. Doubles as overflow indicator
	 * when there are more selected categories than fit. */
	.wpd-cat__trigger {
		appearance: none;
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 1px 8px;
		min-height: 22px;
		font: inherit;
		font-size: 11px;
		font-weight: 500;
		line-height: 1;
		color: var( --wpd-cat-trigger-fg, var( --wpd-fg-muted, #50575e ) );
		background: transparent;
		border: 1px dashed var( --wpd-cat-trigger-border, var( --wpd-border, #c3c4c7 ) );
		border-radius: 999px;
		cursor: pointer;
		transition:
			background-color 0.12s ease,
			color 0.12s ease,
			border-color 0.12s ease;
	}
	.wpd-cat__trigger:hover:not( :disabled ) {
		background: var( --wpd-hover, rgba( 0, 0, 0, 0.04 ) );
		color: var( --wpd-cat-trigger-fg-hover, var( --wpd-fg, #1d2327 ) );
		border-color: var( --wpd-cat-trigger-border-hover, var( --wpd-border-strong, #8c8f94 ) );
	}
	.wpd-cat__trigger:focus-visible {
		outline: none;
		border-style: solid;
		box-shadow: 0 0 0 2px var( --wp-admin-theme-color, #2271b1 );
	}
	.wpd-cat__trigger svg {
		display: block;
	}

	/* Uncategorized sentinel — same shape as the trigger but with
	 * "is-empty" affordance: muted color, no hover lift, signals
	 * "this is the fallback, not a chosen tag". */
	.wpd-cat__uncategorized {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 1px 10px;
		min-height: 22px;
		font-size: 11px;
		font-weight: 500;
		line-height: 1.6;
		color: var( --wpd-cat-uncat-fg, var( --wpd-fg-muted, #8c8f94 ) );
		background: transparent;
		border: 1px dashed var( --wpd-cat-uncat-border, var( --wpd-border, #c3c4c7 ) );
		border-radius: 999px;
		font-style: italic;
	}

	/* --- Popover ------------------------------------------------- */

	/*
	 * position: fixed so the popover escapes the table cell's
	 * overflow: auto clip plus the wpd-table shadow-DOM scrolling
	 * container. JS measures the trigger and the viewport, then
	 * sets top / left (or bottom / right for flips) inline — see
	 * _positionPopover() in wpd-category-picker.ts. The default
	 * values below place it at the top-left corner; the JS
	 * overrides on every open.
	 */
	.wpd-cat__popover {
		position: fixed;
		top: 0;
		left: 0;
		min-width: 280px;
		max-width: 360px;
		max-height: 360px;
		display: flex;
		flex-direction: column;
		background: var( --wpd-cat-pop-bg, var( --wpd-surface, #fff ) );
		color: var( --wpd-cat-pop-fg, var( --wpd-fg, #1d2327 ) );
		border: 1px solid var( --wpd-cat-pop-border, var( --wpd-border, #c3c4c7 ) );
		border-radius: 8px;
		box-shadow:
			0 6px 16px rgba( 0, 0, 0, 0.08 ),
			0 1px 2px rgba( 0, 0, 0, 0.06 );
		z-index: 1000;
	}

	.wpd-cat__editor {
		position: relative;
		display: inline-flex;
		align-items: center;
	}

	.wpd-cat__search {
		appearance: none;
		font: inherit;
		font-size: 13px;
		padding: 8px 12px;
		border: 0;
		border-bottom: 1px solid var( --wpd-cat-pop-divider, var( --wpd-border, #f0f0f1 ) );
		background: transparent;
		color: inherit;
		outline: none;
	}
	.wpd-cat__search:focus {
		border-bottom-color: var( --wp-admin-theme-color, #2271b1 );
	}

	.wpd-cat__tree {
		flex: 1 1 auto;
		min-height: 0;
		overflow-y: auto;
		padding: 4px 0;
	}

	/* Wrapper around a tree row + its trailing always-visible
	 * "add child" input. display:contents keeps layout identical
	 * to the unwrapped pair, but gives the row+input a single
	 * top-level node so the template engine can dispose them as a
	 * unit (avoids orphaned create-rows when the items list grows
	 * and the engine remounts the array). */
	.wpd-cat__row-block {
		display: contents;
	}

	/* One row in the tree. Indent is a CSS variable applied via
	 * inline style when the row is built (depth-based padding). */
	.wpd-cat__row {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 4px 8px 4px var( --wpd-cat-row-indent, 12px );
		cursor: pointer;
		user-select: none;
		font-size: 13px;
		line-height: 1.4;
		position: relative;
	}
	.wpd-cat__row:hover,
	.wpd-cat__row[ data-focused='true' ] {
		background: var( --wpd-hover, rgba( 0, 0, 0, 0.04 ) );
	}
	.wpd-cat__row[ data-selected='true' ] {
		color: var( --wp-admin-theme-color, #2271b1 );
		font-weight: 600;
	}

	/* Indent guides — a faint vertical line per nesting level so
	 * the eye reads the hierarchy without having to count
	 * indentation pixels. */
	.wpd-cat__row::before {
		content: '';
		position: absolute;
		left: 0;
		top: 0;
		bottom: 0;
		width: var( --wpd-cat-guide-width, 0px );
		border-left: 1px dotted
			var( --wpd-cat-guide-color, var( --wpd-border, rgba( 0, 0, 0, 0.08 ) ) );
	}

	.wpd-cat__expander {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 14px;
		height: 14px;
		border: 0;
		background: transparent;
		color: inherit;
		cursor: pointer;
		flex-shrink: 0;
		opacity: 0.65;
	}
	.wpd-cat__expander:hover {
		opacity: 1;
	}
	.wpd-cat__expander svg {
		display: block;
		transition: transform 0.12s ease;
	}
	.wpd-cat__row[ data-expanded='true' ] .wpd-cat__expander svg {
		transform: rotate( 90deg );
	}
	.wpd-cat__expander--placeholder {
		visibility: hidden;
	}

	/* Always-visible inline create input. One sits at the very top
	 * of the popover for "add root", and one sits beneath every
	 * visible row for "add child of that row". The wrap is the
	 * focus-ring host so the embedded "+" submit button visually
	 * lives inside the input chrome. Default state is quiet; on
	 * hover/focus the wrap picks up the WordPress admin theme
	 * color. */
	.wpd-cat__create-row {
		display: flex;
		align-items: center;
		padding: 2px 8px 2px var( --wpd-cat-row-indent, 28px );
		position: relative;
	}
	.wpd-cat__create-row::before {
		content: '';
		position: absolute;
		left: 0;
		top: 0;
		bottom: 0;
		width: var( --wpd-cat-guide-width, 0px );
		border-left: 1px dotted
			var( --wpd-cat-guide-color, var( --wpd-border, rgba( 0, 0, 0, 0.08 ) ) );
	}
	.wpd-cat__create-wrap {
		display: inline-flex;
		align-items: center;
		flex: 1 1 auto;
		min-width: 0;
		gap: 4px;
		padding: 1px 1px 1px 0;
		border: 1px solid transparent;
		border-radius: 6px;
		background: transparent;
		transition: border-color 0.12s ease, background-color 0.12s ease,
			box-shadow 0.12s ease;
	}
	.wpd-cat__create-wrap:hover {
		border-color: var( --wpd-border, rgba( 0, 0, 0, 0.12 ) );
		background: var( --wpd-cat-pop-bg, var( --wpd-surface, #fff ) );
	}
	.wpd-cat__create-wrap:focus-within {
		border-color: var( --wp-admin-theme-color, #2271b1 );
		background: var( --wpd-cat-pop-bg, var( --wpd-surface, #fff ) );
		box-shadow: 0 0 0 2px
			color-mix(
				in srgb,
				var( --wp-admin-theme-color, #2271b1 ) 15%,
				transparent
			);
	}
	.wpd-cat__create-input {
		flex: 1 1 auto;
		min-width: 0;
		appearance: none;
		font: inherit;
		font-size: 12px;
		padding: 3px 6px;
		border: 0;
		background: transparent;
		color: inherit;
		outline: none;
	}
	.wpd-cat__create-input::placeholder {
		color: var( --wpd-cat-pop-muted, var( --wpd-fg-muted, #8c8f94 ) );
		font-style: italic;
		opacity: 1;
	}
	.wpd-cat__create-submit {
		appearance: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		flex-shrink: 0;
		padding: 0;
		border: 0;
		border-radius: 4px;
		background: transparent;
		color: var( --wpd-cat-pop-muted, var( --wpd-fg-muted, #8c8f94 ) );
		cursor: pointer;
		transition: background-color 0.12s ease, color 0.12s ease;
	}
	.wpd-cat__create-wrap:focus-within .wpd-cat__create-submit:not(
			[ disabled ]
		) {
		background: var( --wp-admin-theme-color, #2271b1 );
		color: var( --wpd-fg-on-accent, #fff );
	}
	.wpd-cat__create-submit:hover:not( [ disabled ] ) {
		filter: brightness( 1.05 );
	}
	.wpd-cat__create-submit[ disabled ] {
		cursor: default;
		opacity: 0.5;
	}
	.wpd-cat__create-submit svg {
		display: block;
		width: 11px;
		height: 11px;
	}
	.wpd-cat__create-spinner {
		display: inline-block;
		width: 12px;
		height: 12px;
		margin: 0 4px;
		border-radius: 50%;
		border: 2px solid var( --wp-admin-theme-color, #2271b1 );
		border-top-color: transparent;
		animation: wpd-cat-spin 0.8s linear infinite;
		flex-shrink: 0;
	}

	.wpd-cat__check {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 14px;
		height: 14px;
		flex-shrink: 0;
		border: 1.5px solid var( --wpd-cat-check-border, var( --wpd-border, #8c8f94 ) );
		border-radius: 3px;
		color: transparent;
		transition: background-color 0.12s ease, border-color 0.12s ease, color 0.12s ease;
	}
	.wpd-cat__row[ data-selected='true' ] .wpd-cat__check {
		background: var( --wp-admin-theme-color, #2271b1 );
		border-color: var( --wp-admin-theme-color, #2271b1 );
		color: var( --wpd-fg-on-accent, #fff );
	}
	.wpd-cat__check svg {
		display: block;
		width: 10px;
		height: 10px;
	}

	.wpd-cat__label {
		min-width: 0;
		flex: 1 1 auto;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* Per-row delete button. Only visible when the row is hovered
	 * or keyboard-focused — invisible at rest so the tree reads as
	 * a flat list of selectable terms, not a "danger surface". The
	 * button emits wpd-categories-delete; the consumer is
	 * responsible for confirming + REST. Suppressed for
	 * Uncategorized in the row template, since core's fallback
	 * term must not be deletable. */
	.wpd-cat__delete {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex: 0 0 auto;
		width: 18px;
		height: 18px;
		border: 0;
		border-radius: 50%;
		padding: 0;
		background: transparent;
		color: var( --wpd-cat-delete-color, var( --wpd-danger, #d63638 ) );
		cursor: pointer;
		opacity: 0;
		transition: opacity 0.12s ease, background-color 0.12s ease;
	}
	.wpd-cat__row:hover .wpd-cat__delete,
	.wpd-cat__row[ data-focused='true' ] .wpd-cat__delete,
	.wpd-cat__delete:focus-visible {
		opacity: 1;
	}
	.wpd-cat__delete:hover,
	.wpd-cat__delete:focus-visible {
		background: var( --wpd-badge-danger-bg, rgba( 214, 54, 56, 0.12 ) );
	}
	.wpd-cat__delete svg {
		display: block;
		width: 10px;
		height: 10px;
	}

	/* Search-match highlight inside labels. A wash rather than a fill,
	   so the label keeps its own colour and stays readable on either
	   a light or a dark surface. */
	.wpd-cat__match {
		background: var( --wpd-search-highlight-bg, rgba( 252, 211, 77, 0.45 ) );
		border-radius: 2px;
		padding: 0 1px;
	}

	.wpd-cat__empty,
	.wpd-cat__loading {
		padding: 12px;
		font-size: 12px;
		color: var( --wpd-cat-pop-muted, var( --wpd-fg-muted, #646970 ) );
		text-align: center;
	}

	.wpd-cat__loading-spinner {
		display: inline-block;
		width: 12px;
		height: 12px;
		border-radius: 50%;
		border: 2px solid currentColor;
		border-top-color: transparent;
		animation: wpd-cat-spin 0.8s linear infinite;
		margin-inline-end: 8px;
		vertical-align: middle;
	}

	@keyframes wpd-cat-spin {
		to { transform: rotate( 360deg ); }
	}

	.wpd-cat__footer {
		padding: 8px 12px;
		font-size: 11px;
		color: var( --wpd-cat-pop-muted, var( --wpd-fg-muted, #646970 ) );
		border-top: 1px solid var( --wpd-cat-pop-divider, var( --wpd-border, #f0f0f1 ) );
		border-radius: 10px;
		background: var( --wpd-cat-pop-footer-bg, var( --wpd-surface, #fafafb ) );
		display: flex;
		align-items: center;
		gap: 6px;
		line-height: 1.4;
	}
	.wpd-cat__footer .dashicons {
		font-size: 14px;
		width: 14px;
		height: 14px;
		flex-shrink: 0;
	}

	:host( [ disabled ] ) .wpd-cat {
		opacity: 0.6;
		pointer-events: none;
	}
`;
