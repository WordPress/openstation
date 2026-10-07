import { css } from '../../core';

export const styles = css`
	:host {
		display: flex;
		flex-direction: column;
		gap: var( --os-ui-stack-gap, 12px );
		align-items: var( --os-ui-stack-align, stretch );
		padding: var( --os-ui-stack-padding, 0 );
	}
	:host( [ hidden ] ) {
		display: none;
	}
`;
