import { css } from '../../core';

export const styles = css`
	:host {
		display: inline;
	}
	:host( [ hidden ] ) {
		display: none;
	}
	code {
		font-family: var(
			--os-ui-code-font-family,
			ui-monospace,
			SFMono-Regular,
			Menlo,
			Consolas,
			"Liberation Mono",
			monospace
		);
		font-size: var( --os-ui-code-font-size, 0.92em );
		padding: var( --os-ui-code-padding, 0.1em 0.4em );
		border-radius: var( --os-ui-code-border-radius, 4px );
		background: var( --os-ui-code-bg, var( --os-ui-hover, rgba( 0, 0, 0, 0.06 ) ) );
		color: var( --os-ui-code-fg, var( --os-ui-fg, #1d2327 ) );
		border: var( --os-ui-code-border, 1px solid rgba( 0, 0, 0, 0.08 ) );
		white-space: var( --os-ui-code-white-space, nowrap );
		overflow-wrap: anywhere;
	}

	:host( [ block ] ) {
		display: block;
	}

	:host( [ block ] ) code {
		display: block;
		padding: var( --os-ui-code-block-padding, 10px 12px );
		white-space: pre;
		max-block-size: var( --os-ui-code-block-max-block-size, none );
		overflow: auto;
	}

	:host( [ wrap ] ) code {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	:host( [ copy ] ) {
		position: relative;
	}
	:host( [ copy ] ):not( [ block ] ) {
		display: inline-flex;
		align-items: center;
		gap: var( --os-ui-code-copy-gap, 8px );
	}

	.copy {
		appearance: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex: none;
		inline-size: var( --os-ui-code-copy-size, 24px );
		block-size: var( --os-ui-code-copy-size, 24px );
		background: transparent;
		border: 0;
		border-radius: 4px;
		padding: 0;
		margin: 0;
		font: inherit;
		cursor: pointer;
		color: var( --os-ui-code-copy-color, var( --os-ui-fg-muted, #57606a ) );
		opacity: var( --os-ui-code-copy-opacity, 0.6 );
		transition: opacity 120ms ease, color 120ms ease, background-color 120ms ease;
		line-height: 1;
		font-size: 1.05em;
	}
	.copy:hover,
	.copy:focus-visible {
		opacity: 1;
		color: var( --os-ui-code-copy-color-hover, var( --wp-admin-theme-color, #007cba ) );
		background: var( --os-ui-code-copy-bg, var( --os-ui-hover, rgba( 0, 0, 0, 0.06 ) ) );
	}

	:host( [ block ] ) .copy {
		position: absolute;
		top: 6px;
		inset-inline-end: 6px;
		background: var( --os-ui-code-copy-bg, var( --os-ui-hover, rgba( 0, 0, 0, 0.06 ) ) );
		opacity: var( --os-ui-code-copy-opacity, 0.6 );
	}
	:host( [ block ] ):hover .copy,
	:host( [ block ] ):focus-within .copy {
		opacity: 1;
	}

	:host( [ block ][ copy ] ) code {
		padding-inline-end: var( --os-ui-code-copy-inset, 42px );
	}
`;
