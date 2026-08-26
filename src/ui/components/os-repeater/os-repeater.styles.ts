import { css } from '../../core';

export const styles = css`
	:host {
		/*
		 * Public tokens read into private aliases — see AGENTS.md,
		 * "Never declare a themeable token on a component's :host".
		 */
		--_gap: var( --os-ui-repeater-gap, 8px );
		--_row-bg: var( --os-ui-repeater-row-bg, var( --os-ui-surface, #fff ) );
		--_border: var( --os-ui-repeater-row-border, var( --os-ui-border, #dcdcde ) );

		display: flex;
		flex-direction: column;
		gap: var( --_gap );
	}
	:host( [ hidden ] ) {
		display: none;
	}

	.os-repeater__rows {
		display: flex;
		flex-direction: column;
		gap: var( --_gap );
	}

	.os-repeater__row {
		display: flex;
		align-items: start;
		gap: 6px;
		padding: 8px;
		border: 1px solid var( --_border );
		border-radius: 6px;
		background: var( --_row-bg );
	}

	.os-repeater__content {
		flex: 1 1 auto;
		min-width: 0;
	}

	.os-repeater__handles {
		display: flex;
		flex-direction: column;
		gap: 2px;
		flex: 0 0 auto;
	}

	.os-repeater__handle,
	.os-repeater__remove {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		padding: 0;
		border: 0;
		border-radius: 4px;
		background: transparent;
		color: var( --os-ui-fg-muted, #646970 );
		cursor: pointer;
	}
	.os-repeater__handle:hover:not( :disabled ),
	.os-repeater__remove:hover:not( :disabled ) {
		background: var( --os-ui-hover, rgba( 0, 0, 0, 0.06 ) );
		color: var( --os-ui-fg, #1d2327 );
	}
	.os-repeater__remove:hover:not( :disabled ) {
		color: var( --os-ui-danger, #d63638 );
	}
	.os-repeater__handle:disabled,
	.os-repeater__remove:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.os-repeater__handle:focus-visible,
	.os-repeater__remove:focus-visible {
		outline: 2px solid var( --os-ui-accent, #2271b1 );
		outline-offset: 1px;
	}

	.os-repeater__remove {
		flex: 0 0 auto;
	}

	.os-repeater__empty {
		padding: 12px;
		border: 1px dashed var( --_border );
		border-radius: 6px;
		font-size: 12px;
		color: var( --os-ui-fg-muted, #646970 );
	}
	.os-repeater__empty:has( slot[ name='empty' ]:not( :has( * ) ) ):empty {
		display: none;
	}

	.os-repeater__footer {
		display: flex;
		align-items: center;
		gap: 8px;
	}
`;
