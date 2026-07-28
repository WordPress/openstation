import { css } from '../../core';

export const styles = css`
	:host {
		display: flex;
		align-items: center;
		justify-content: var( --wpd-display-align, flex-end );
		width: 100%;
		min-height: calc( var( --wpd-display-size, 28px ) * 1.4 );
		padding: 8px 14px;
		box-sizing: border-box;
		font-size: var( --wpd-display-size, 28px );
		font-variant-numeric: tabular-nums;
		font-weight: 500;
		letter-spacing: 0.01em;
		color: var( --wpd-display-fg, var( --wpd-fg, #1d2327 ) );
		background: var( --wpd-display-bg, transparent );
		border-radius: var( --wpd-display-border-radius, 0 );
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
	.wpd-display__output {
		display: block;
		font: inherit;
		color: inherit;
		text-align: var( --wpd-display-align, end );
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}
`;
