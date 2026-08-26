import { css } from '../../core';

export const styles = css`
	:host {
		display: flex;
		flex-direction: column;
		gap: var( --os-ui-panel-gap, 12px );
		padding: var( --os-ui-panel-padding, 16px );
		/* Desktop-theme texture slot: unset resolves to none. */
		background-image: var( --os-ui-panel-bg-image, none );
		background-repeat: var( --os-ui-panel-bg-image-repeat, repeat );
		background-size: var( --os-ui-panel-bg-image-size, auto );
		background-position: var( --os-ui-panel-bg-image-position, center );
		box-sizing: border-box;
	}
	:host( [ hidden ] ) {
		display: none;
	}
`;
