import { css } from '../../core';

export const styles = css`
	:host {
		/*
		 * Public tokens read into private aliases — see AGENTS.md,
		 * "Never declare a themeable token on a component's :host".
		 */
		--_bg: var( --os-ui-token-field-bg, var( --os-ui-field-bg, #fff ) );
		--_border: var(
			--os-ui-token-field-border,
			var( --os-ui-field-border, #8c8f94 )
		);
		--_fg: var( --os-ui-token-field-fg, var( --os-ui-field-fg, #2c3338 ) );
		--_chip-bg: var(
			--os-ui-token-field-chip-bg,
			var( --os-ui-surface-raised, rgba( 0, 0, 0, 0.06 ) )
		);

		display: block;
		position: relative;
	}
	:host( [ hidden ] ) {
		display: none;
	}

	.os-token-field {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.os-token-field__label {
		font-size: 13px;
		font-weight: 500;
		color: var( --os-ui-fg, #1d2327 );
	}

	.os-token-field__input {
		box-sizing: border-box;
		width: 100%;
		padding: 6px 8px;
		border-radius: 4px;
		background: var( --_bg );
		border: 1px solid var( --_border );
		color: var( --_fg );
		font: inherit;
		resize: vertical;
	}
	.os-token-field__input:focus-visible {
		outline: 2px solid var( --os-ui-accent, #2271b1 );
		outline-offset: 1px;
	}
	.os-token-field__input:disabled {
		opacity: 0.6;
	}

	.os-token-field__toolbar {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	/*
	 * The catalogue is absolutely positioned rather than a popover:
	 * it belongs to this field, and a field is very often inside a
	 * scrolling inspector pane where a fixed overlay would detach
	 * from the control it describes on the first scroll.
	 */
	.os-token-field__catalogue {
		position: absolute;
		inset-inline-start: 0;
		inset-block-start: 100%;
		z-index: 20;
		max-height: 18rem;
		overflow-y: auto;
		width: 100%;
		padding: 4px;
		box-sizing: border-box;
		border: 1px solid var( --os-ui-border, #dcdcde );
		border-radius: 6px;
		background: var( --os-ui-surface-elevated, #fff );
		box-shadow: 0 8px 24px rgba( 0, 0, 0, 0.18 );
	}

	.os-token-field__group {
		margin: 6px 6px 2px;
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var( --os-ui-fg-faint, #8c8f94 );
	}

	.os-token-field__option {
		display: grid;
		grid-template-columns: minmax( 0, 1fr ) auto;
		gap: 2px 8px;
		width: 100%;
		padding: 6px 8px;
		border: 0;
		border-radius: 4px;
		background: transparent;
		color: var( --os-ui-fg, #1d2327 );
		font: inherit;
		text-align: start;
		cursor: pointer;
	}
	.os-token-field__option:hover,
	.os-token-field__option:focus-visible {
		background: var( --os-ui-hover, rgba( 0, 0, 0, 0.06 ) );
		outline: none;
	}

	.os-token-field__option-label {
		font-size: 13px;
		min-width: 0;
	}
	.os-token-field__option-token {
		grid-column: 2;
		grid-row: 1;
		padding: 1px 5px;
		border-radius: 3px;
		background: var( --_chip-bg );
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 11px;
		color: var( --os-ui-fg-muted, #646970 );
	}
	.os-token-field__option-sample,
	.os-token-field__option-description {
		grid-column: 1 / -1;
		font-size: 11px;
		color: var( --os-ui-fg-muted, #646970 );
	}
	.os-token-field__option-sample {
		font-style: italic;
	}

	.os-token-field__hint {
		margin: 0;
		font-size: 12px;
		color: var( --os-ui-fg-muted, #646970 );
	}

	.os-token-field__preview {
		display: flex;
		gap: 6px;
		margin: 0;
		font-size: 12px;
		line-height: 1.4;
		color: var( --os-ui-fg-muted, #646970 );
	}
	.os-token-field__preview-label {
		flex: 0 0 auto;
		font-weight: 600;
	}
	.os-token-field__preview-body {
		min-width: 0;
		overflow-wrap: anywhere;
		white-space: pre-wrap;
	}
`;
