import { css } from '../../core';

export const styles = css`
	:host {
		display: block;
		margin-block-end: 36px;
	}
	:host( [ hidden ] ) {
		display: none;
	}

	.os-section__heading {
		margin: 0 0 5px;
		font-size: 20px;
		font-weight: 500;
		letter-spacing: -0.01em;
		color: var( --os-ui-fg, #1d2327 );
	}
	.os-section__description {
		margin: 0 0 14px;
		max-width: 78ch;
		font-size: 14px;
		color: var( --os-ui-fg-muted, #646970 );
		line-height: 1.55;
	}

	.os-section__description:empty {
		display: none;
	}

	:host( [ stack ] ) .os-section__body {
		display: flex;
		flex-direction: column;
		gap: var( --os-ui-section-gap, 12px );
	}
`;
