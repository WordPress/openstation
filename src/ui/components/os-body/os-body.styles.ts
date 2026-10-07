import { css } from '../../core';

export const styles = css`
	:host {
		display: flex;
		flex-direction: column;
		gap: var( --os-ui-body-gap, 12px );
		padding: var( --os-ui-body-padding, 16px );
		box-sizing: border-box;
		width: 100%;
		height: 100%;
		min-width: 0;
		min-height: 0;
	}

	:host( [ scroll ] ) {
		overflow: auto;
	}

	:host( [ hidden ] ) {
		display: none;
	}

	::slotted( * ) {
		min-width: 0;
	}
`;
