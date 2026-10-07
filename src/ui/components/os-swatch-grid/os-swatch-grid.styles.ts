import { css } from '../../core';

export const styles = css`
	:host {
		display: grid;
		grid-template-columns: repeat(
			var( --os-ui-swatch-grid-cols, 4 ),
			1fr
		);
		gap: 12px;
	}
	:host( [ mode='row' ] ) {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px;
	}
`;
