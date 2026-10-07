import { css } from '../../core';
import { holoTokens, holoCheck } from '../../holo';

export const styles = css`
	${ holoTokens }
	${ holoCheck }

	:host {
		display: block;

		--_bg: var( --os-ui-table-bg, var( --os-ui-surface, #fff ) );
		--_border: var(
			--os-ui-table-border,
			var( --os-ui-border, rgba( 0, 0, 0, 0.08 ) )
		);

		--_column-border: var(
			--os-ui-table-column-border,
			var( --os-ui-border-strong, rgba( 0, 0, 0, 0.14 ) )
		);
		--_header-bg: var(
			--os-ui-table-header-bg,
			var( --os-ui-surface-elevated, #f6f7f7 )
		);

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

	thead th {
		text-align: start;
		font-weight: 600;
		background-color: var( --_header-bg );

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

	th.is-sticky,
	td.is-sticky {
		position: sticky;
		z-index: 10;
	}

	tbody td.is-sticky {
		background-color: var( --_bg );
	}
	thead th.is-sticky {
		background-color: var( --_header-bg );

		background-image: var( --os-ui-table-header-bg-image, none );
		background-repeat: var( --os-ui-table-header-bg-image-repeat, repeat );
		background-size: var( --os-ui-table-header-bg-image-size, auto );
		background-position: var( --os-ui-table-header-bg-image-position, center );
		z-index: 30;
	}

	:host( [ sticky-header ] ) thead th {
		position: sticky;
		top: 0;
		z-index: 20;
	}
	:host( [ sticky-header ] ) thead tr.filter-row th {
		top: var( --os-ui-table-header-height, 33px );
		z-index: 20;
	}

	:host( [ sticky-header ] ) thead th.is-sticky {
		z-index: 40;
	}
	:host( [ sticky-header ] ) thead tr.filter-row th.is-sticky {
		z-index: 40;
	}

	th.is-sticky-edge,
	td.is-sticky-edge {
		border-inline-end: var(
			--os-ui-table-sticky-edge,
			2px solid var( --_border )
		);
	}

	.align-center {
		text-align: center;
	}
	.align-end {
		text-align: end;
	}

	.filter-row th {
		padding: 4px 8px;
		background-color: var( --_header-bg );

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

	td.col-expander,
	th.col-expander {
		width: 36px;
		min-width: 36px;
		padding-left: 0;
		padding-right: 0;
		text-align: center;
	}

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

	tr.empty td {
		padding: 24px;
		text-align: center;
		color: var( --os-ui-text-muted, var( --os-ui-fg-muted, rgba( 0, 0, 0, 0.55 ) ) );
		font-style: italic;
	}

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

	tbody tr.is-selected td:first-child {
		box-shadow: inset 3px 0 0 0 var( --os-ui-accent, #2271b1 );
	}
	tbody:dir( rtl ) tr.is-selected td:first-child {
		box-shadow: inset -3px 0 0 0 var( --os-ui-accent, #2271b1 );
	}

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

	:host( [ stacked ] ) tbody td {
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

	:host( [ stacked ] ) tbody tr.is-selected td,
	:host( [ stacked ] ) tbody tr.is-selected:hover td,
	:host( [ stacked ][ striped ] ) tbody tr:nth-child( odd ) td,
	:host( [ stacked ][ hover ] ) tbody tr:hover td,
	:host( [ stacked ][ hover ][ striped ] ) tbody tr:nth-child( odd ):hover td,
	:host( [ stacked ][ bordered ] ) tbody td {
		padding: 0;
		border: 0;
		background-color: transparent;
		background-image: none;
		box-shadow: none;
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
