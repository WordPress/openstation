import { css } from '../../core';

export const factsStyles = css`
	:host {
		--_gap-row: var( --os-ui-facts-row-gap, 6px );
		--_gap-column: var( --os-ui-facts-column-gap, 14px );
		display: block;
		font-size: var( --os-ui-facts-font-size, 13px );
		min-inline-size: 0;
	}
	:host( [ hidden ] ) {
		display: none;
	}
	dl {
		display: grid;
		grid-template-columns: max-content minmax( 0, 1fr );
		gap: var( --_gap-row ) var( --_gap-column );
		align-items: var( --os-ui-facts-align, baseline );
		margin: 0;
	}

	:host( [ layout='between' ] ) dl {
		display: block;
	}
	:host( [ layout='between' ] ) ::slotted( os-fact ) {
		display: flex;
		justify-content: space-between;
		gap: var( --_gap-column );
		margin-block: var( --_gap-row );
	}

	:host( [ stacked ] ) dl {
		display: block;
	}
	:host( [ stacked ] ) ::slotted( os-fact ) {
		display: block;
		margin-block: var( --_gap-row );
	}
`;

export const factStyles = css`
	:host {

		display: contents;
	}
	:host( [ hidden ] ) {
		display: none;
	}
	dt {
		color: var( --os-ui-facts-label-color, var( --os-ui-fg-muted, #646970 ) );
	}
	dd {
		margin: 0;

		overflow-wrap: anywhere;
	}

	::slotted( os-code ) {
		--os-ui-code-bg: var( --os-ui-facts-code-bg, transparent );
		--os-ui-code-border: var( --os-ui-facts-code-border, none );
		--os-ui-code-padding: var( --os-ui-facts-code-padding, 0 );
		--os-ui-code-font-size: var( --os-ui-facts-code-font-size, 1em );
	}
`;
