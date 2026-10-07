import { css } from '../../core';

export const styles = css`
	:host {
		display: block;
		position: relative;
		overflow-y: auto;
		overflow-x: hidden;
		font: var( --os-ui-log-font, 12px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace );
		color: var( --os-ui-log-fg, var( --os-ui-fg, #1d2327 ) );
		background: var( --os-ui-log-bg, transparent );
		border: var( --os-ui-log-border, 1px solid rgba( 0, 0, 0, 0.06 ) );
		border-radius: var( --os-ui-log-border-radius, 4px );
		min-height: var( --os-ui-log-min-height, 120px );

		contain: strict;
	}
	:host( [ hidden ] ) {
		display: none;
	}

	.spacer {
		position: relative;
		width: 100%;
	}

	.window {
		position: absolute;
		left: 0;
		right: 0;
		top: 0;
	}

	.row {
		box-sizing: border-box;
		display: block;
		padding: var( --os-ui-log-row-padding, 2px 8px );
		min-height: var( --os-ui-log-row-height, 22px );
		border-bottom: var( --os-ui-log-row-border, 1px solid rgba( 0, 0, 0, 0.04 ) );
		white-space: var( --os-ui-log-row-white-space, pre );
		overflow: hidden;
		text-overflow: ellipsis;
	}

	:host( [ auto-row-height ] ) .row {
		min-height: 0;
		overflow: visible;
		text-overflow: clip;
		white-space: var( --os-ui-log-row-white-space, normal );
	}

	.empty {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 16px;
		color: var( --os-ui-fg-muted, #57606a );
		font-style: italic;
	}
`;
