import { css } from '../../core';

export const styles = css`
	:host {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 6px;
		padding: 32px 24px;
		text-align: center;
		color: var( --os-ui-empty-state-fg, var( --os-ui-fg-muted, #646970 ) );
	}
	:host( [ hidden ] ) {
		display: none;
	}
	.os-empty-state__icon {
		margin-bottom: 4px;
		color: var( --os-ui-empty-state-icon-color, currentColor );
		opacity: 0.75;
	}
	.os-empty-state__heading {
		margin: 0;
		font-size: 14px;
		font-weight: 600;
		color: var( --os-ui-fg, #1d2327 );
	}
	.os-empty-state__description {
		margin: 0;
		font-size: 12px;
		line-height: 1.4;
		max-width: 48ch;
	}
	.os-empty-state__description:empty {
		display: none;
	}
	.os-empty-state__cta {
		margin-top: 8px;
	}
	.os-empty-state__cta:empty {
		display: none;
	}
`;
