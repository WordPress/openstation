import { css } from '../../core';

export const styles = css`
	:host {
		display: block;
	}
	:host( [ hidden ] ) {
		display: none;
	}
	.os-disclosure__summary {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 0;
		background: none;
		border: 0;
		font: inherit;
		color: var( --os-ui-fg, #1d2327 );
		text-align: start;
		cursor: pointer;
	}

	.os-disclosure__summary:focus-visible {
		outline: 2px solid var( --os-ui-accent, #f252fc );
		outline-offset: 2px;
		border-radius: 4px;
	}
	.os-disclosure__heading {
		flex: 1 1 auto;
		min-width: 0;
		margin: 0;
		font-size: 20px;
		font-weight: 500;
		letter-spacing: -0.01em;
	}

	.os-disclosure__hint {
		flex: 0 0 auto;
		font-size: 13px;
		font-weight: 400;
		color: var( --os-ui-fg-muted, #646970 );
	}

	.os-disclosure__marker {
		flex: 0 0 auto;
		width: 8px;
		height: 8px;
		margin-inline-end: 2px;
		border-inline-end: 2px solid currentColor;
		border-block-end: 2px solid currentColor;
		transform: rotate( -45deg );
		transition: transform 160ms ease;
		opacity: 0.7;
	}
	:host( [ open ] ) .os-disclosure__marker {
		transform: rotate( 45deg );
	}
	@media ( prefers-reduced-motion: reduce ) {
		.os-disclosure__marker {
			transition: none;
		}
	}

	.os-disclosure__body {
		margin-block-start: 14px;
	}
	.os-disclosure__body[ hidden ] {
		display: none;
	}
`;
