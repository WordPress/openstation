import { css } from '../../core';

export const styles = css`
	:host {
		/*
		 * Public tokens read into private aliases so a theme or the
		 * palette can still reach them — a declaration on the bare
		 * host would pin the name and nothing outside could set it
		 * again. See AGENTS.md, "Never declare a themeable token on a
		 * component's :host".
		 */
		--_gap: var( --os-ui-field-row-gap, 6px );
		--_label-width: var( --os-ui-field-row-label-width, 12rem );

		display: flex;
		flex-direction: column;
		gap: var( --_gap );
		container-type: inline-size;
	}
	:host( [ hidden ] ) {
		display: none;
	}

	.os-field-row__head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		min-height: 0;
	}
	.os-field-row__head:empty {
		display: none;
	}

	.os-field-row__label {
		font-size: 13px;
		font-weight: 500;
		line-height: 1.4;
		color: var( --os-ui-fg, #1d2327 );
		cursor: default;
	}
	.os-field-row__required {
		margin-inline-start: 2px;
		color: var( --os-ui-danger, #d63638 );
	}

	.os-field-row__action:empty {
		display: none;
	}

	.os-field-row__control {
		min-width: 0;
	}

	.os-field-row__hint,
	.os-field-row__error {
		margin: 0;
		font-size: 12px;
		line-height: 1.4;
	}
	.os-field-row__hint {
		color: var( --os-ui-fg-muted, #646970 );
	}
	.os-field-row__error {
		color: var( --os-ui-danger, #d63638 );
	}

	/*
	 * Inline layout: label column, control beside it. Container-
	 * queried rather than media-queried — a row inside a 320px
	 * inspector pane should stack even on a wide screen, and the
	 * pane is what it can measure.
	 */
	:host( [ layout='inline' ] ) {
		display: grid;
		grid-template-columns: var( --_label-width ) minmax( 0, 1fr );
		align-items: start;
		column-gap: 12px;
		row-gap: 2px;
	}
	:host( [ layout='inline' ] ) .os-field-row__head {
		grid-column: 1;
		grid-row: 1;
		padding-block-start: 5px;
	}
	:host( [ layout='inline' ] ) .os-field-row__control {
		grid-column: 2;
		grid-row: 1;
	}
	:host( [ layout='inline' ] ) .os-field-row__hint,
	:host( [ layout='inline' ] ) .os-field-row__error {
		grid-column: 2;
		grid-row: 2;
	}
	@container ( max-width: 30rem ) {
		:host( [ layout='inline' ] ) {
			display: flex;
			flex-direction: column;
			gap: var( --_gap );
		}
		:host( [ layout='inline' ] ) .os-field-row__head {
			padding-block-start: 0;
		}
	}

	/*
	 * Light-DOM controls get the field palette applied for them.
	 * ::slotted reaches exactly one level, which is the level a bare
	 * input sits at, and the selector is held at (0,1,0) so anything
	 * the consumer writes outranks it.
	 */
	::slotted( input:where( :not( [ type='checkbox' ], [ type='radio' ] ) ) ),
	::slotted( select ),
	::slotted( textarea ) {
		box-sizing: border-box;
		width: 100%;
		padding: 6px 8px;
		border-radius: 4px;
		background: var( --os-ui-field-bg, #fff );
		border: 1px solid var( --os-ui-field-border, #8c8f94 );
		color: var( --os-ui-field-fg, #2c3338 );
		font: inherit;
	}
`;
