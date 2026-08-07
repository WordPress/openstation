import { css } from '../../core';

export const styles = css`
	:host {
		display: flex;
		flex-direction: row;
		flex-wrap: wrap;
		gap: var( --os-ui-cluster-gap, 8px );
		justify-content: var( --os-ui-cluster-justify, flex-start );
		align-items: var( --os-ui-cluster-align, center );
	}
	:host( [ hidden ] ) {
		display: none;
	}
`;
