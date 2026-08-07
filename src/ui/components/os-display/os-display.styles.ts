import { css } from '../../core';

export const styles = css`
	:host {
		display: flex;
		align-items: center;
		justify-content: var( --os-ui-display-align, flex-end );
		width: 100%;
		min-height: calc( var( --os-ui-display-size, 28px ) * 1.4 );
		padding: 8px 14px;
		box-sizing: border-box;
		font-size: var( --os-ui-display-size, 28px );
		font-variant-numeric: tabular-nums;
		font-weight: 500;
		letter-spacing: 0.01em;
		color: var( --os-ui-display-fg, var( --os-ui-fg, #1d2327 ) );
		background: var( --os-ui-display-bg, transparent );
		border-radius: var( --os-ui-display-border-radius, 0 );
		line-height: 1.1;
		overflow: hidden;
		/* A readout SHOULD truncate on overflow — a numeric display
		 * that silently wraps is a UX bug. Callers that want the full
		 * value visible size their display or cap their input upstream. */
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	:host( [ hidden ] ) {
		display: none;
	}
	.os-display__output {
		display: block;
		font: inherit;
		color: inherit;
		text-align: var( --os-ui-display-align, end );
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}
`;
