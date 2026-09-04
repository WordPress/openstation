import { css } from '../../core';
import { holoTokens, holoField } from '../../holo';

/**
 * Styles for `<os-textarea>` — multi-line text input. Visually
 * matches `<os-text-field>` (same border, padding, focus ring) so
 * forms can mix the two without a seam — and now literally so: both
 * take their hover, focus, placeholder and selection states from the
 * shared `holoField` fragment rather than each declaring its own.
 */
export const textareaStyles = css`
	${ holoTokens }
	${ holoField }

	/* Sizing tokens: see os-text-field.styles.ts. */
	:host {
		--_field-size: var( --os-ui-field-font-size, 13px );
		--_field-radius: var( --os-ui-field-radius, 6px );
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: var( --_field-size );
		color: var( --os-ui-fg, #1d2327 );
		min-width: 0;
	}
	:host( [ hidden ] ) {
		display: none;
	}

	.os-textarea__label {
		font-size: 12px;
		color: var( --os-ui-fg-muted, #646970 );
	}

	textarea {
		appearance: none;
		-webkit-appearance: none;
		display: block;
		width: 100%;
		min-width: 0;
		box-sizing: border-box;
		padding: 8px 10px;
		background: var( --os-window-bg, #fff );
		border: 1px solid var( --os-ui-border, #dcdcde );
		border-radius: var( --_field-radius );
		font: inherit;
		font-size: var( --_field-size );
		line-height: 1.45;
		color: var( --os-ui-fg, #1d2327 );
		resize: vertical;
	}

	textarea:disabled {
		opacity: 0.55;
		cursor: not-allowed;
		background: var( --os-ui-hover, rgba( 0, 0, 0, 0.03 ) );
	}

	/* Outranks the shared focus ring — see the :where() note in holoField. */
	textarea[ aria-invalid='true' ],
	textarea[ aria-invalid='true' ]:hover:not( :disabled ) {
		border-color: var( --os-ui-danger, #d63638 );
	}
	textarea[ aria-invalid='true' ]:focus,
	textarea[ aria-invalid='true' ]:focus-visible {
		border-color: var( --os-ui-danger, #d63638 );
		box-shadow: 0 0 0 1px var( --os-ui-danger, #d63638 ),
			0 0 0 4px rgba( 214, 54, 56, 0.18 );
	}

	/* Auto-grow mode: hide native resize affordance — we manage rows. */
	:host( [ auto-grow ] ) textarea {
		resize: none;
		overflow: hidden;
	}
`;
