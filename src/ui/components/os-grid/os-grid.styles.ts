import { css } from '../../core';

export const styles = css`
	:host {
		display: grid;
		grid-template-columns: var( --os-ui-grid-columns, 1fr );
		grid-template-rows: var( --os-ui-grid-rows, auto );
		gap: var( --os-ui-grid-gap, 8px );
		column-gap: var( --os-ui-grid-column-gap, var( --os-ui-grid-gap, 8px ) );
		row-gap: var( --os-ui-grid-row-gap, var( --os-ui-grid-gap, 8px ) );
	}
	:host( [ hidden ] ) {
		display: none;
	}
`;
