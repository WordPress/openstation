import { css } from '../../core';

/**
 * Styles for the labelled text / number field shared between
 * `<os-text-field>` and `<os-number-field>`. Visual language
 * matches `<os-color-field>` / `<os-range-field>` — a stacked
 * label on top, the input beneath, muted label color, accent focus
 * ring.
 */

export const textFieldStyles = css`
	/*
	 * Host is block-level flex so the field fills its parent cell
	 * (grid row col=N, flex container, plain block container). An
	 * inline-flex default would leave the native <input> at its
	 * intrinsic width while the host spans the full cell, which
	 * looks wrong inside a os-row.
	 */
	:host {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 13px;
		color: var( --os-ui-fg, #1d2327 );
		min-width: 0;
	}
	:host( [ hidden ] ) {
		display: none;
	}

	.os-text-field__label {
		font-size: 12px;
		color: var( --os-ui-fg-muted, #646970 );
	}

	.os-text-field__row {
		position: relative;
		display: flex;
		align-items: center;
		width: 100%;
	}

	input {
		appearance: none;
		-webkit-appearance: none;
		display: block;
		width: 100%;
		min-width: 0;
		box-sizing: border-box;
		padding: 7px 10px;
		background: var( --os-window-bg, #fff );
		border: 1px solid var( --os-ui-border, #dcdcde );
		border-radius: 6px;
		font: inherit;
		font-size: 13px;
		color: var( --os-ui-fg, #1d2327 );
		transition: border-color 0.12s ease, box-shadow 0.12s ease;
	}

	/* Suffix slot for units / currency badges — rendered when the
	 * component has a suffix attribute. Inline-end anchored so RTL
	 * locales flip automatically via logical properties. */
	.os-text-field__suffix {
		position: absolute;
		inset-inline-end: 10px;
		top: 50%;
		transform: translateY( -50% );
		pointer-events: none;
		font-size: 12px;
		color: var( --os-ui-fg-muted, #646970 );
	}

	/* Reveal (show/hide) toggle — only rendered on password-type fields
	 * that carry the reveal attribute. Sits at the inline-end of the
	 * row; the input grows extra padding when the button is present so
	 * typed text doesn't slide under it. */
	.os-text-field__row--has-reveal input {
		padding-inline-end: 36px;
	}

	.os-text-field__reveal {
		position: absolute;
		inset-inline-end: 0;
		top: 0;
		bottom: 0;
		width: 34px;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		border: none;
		background: transparent;
		color: var( --os-ui-fg-muted, #646970 );
		cursor: pointer;
		border-radius: 0 6px 6px 0;
		transition: color 0.12s ease;
	}
	.os-text-field__reveal:hover {
		color: var( --wp-admin-theme-color, #2271b1 );
	}
	.os-text-field__reveal:focus-visible {
		outline: 2px solid var( --wp-admin-theme-color, #2271b1 );
		outline-offset: -2px;
		border-radius: 0 6px 6px 0;
	}
	.os-text-field__reveal:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	/* CSS-only password mask. We render type="password" declarations
	 * as actual type="text" inputs so Chrome / Edge / Firefox password
	 * managers never recognise them as credentials (they were ignoring
	 * autocomplete="new-password" and still offering to save / update
	 * the password for fields that are really API keys). The dots are
	 * applied via -webkit-text-security (the original Webkit extension,
	 * Chromium / Safari support it; Firefox 119+ ships the standard
	 * text-security). Older Firefox versions fall back to the input's
	 * letter-spacing trick — wide enough that the user sees the value
	 * exists but the characters bunch into an unreadable run.
	 *
	 * The reveal toggle simply removes this class. */
	.os-text-field__input--masked {
		-webkit-text-security: disc;
		text-security: disc;
	}
	@supports not ( ( -webkit-text-security: disc ) or ( text-security: disc ) ) {
		.os-text-field__input--masked {
			font-family: text-security-disc, "password", monospace;
			letter-spacing: 0.2em;
		}
	}

	input:hover {
		border-color: var( --os-ui-fg-muted, #8c8f94 );
	}
	input:focus-visible {
		outline: none;
		border-color: var( --wp-admin-theme-color, #2271b1 );
		box-shadow: 0 0 0 1px var( --wp-admin-theme-color, #2271b1 );
	}
	input:disabled {
		opacity: 0.55;
		cursor: not-allowed;
		background: var( --os-ui-hover, rgba( 0, 0, 0, 0.03 ) );
	}

	input[ aria-invalid='true' ] {
		border-color: var( --os-ui-danger, #d63638 );
	}
	input[ aria-invalid='true' ]:focus-visible {
		box-shadow: 0 0 0 1px var( --os-ui-danger, #d63638 );
	}

	/* Hide the native spinner on number inputs — the suffix slot and
	 * the keypad (when present) already handle increment / decrement.
	 * Callers that need spinners can unset this by restyling. */
	input[ type='number' ]::-webkit-inner-spin-button,
	input[ type='number' ]::-webkit-outer-spin-button {
		-webkit-appearance: none;
		margin: 0;
	}
	input[ type='number' ] {
		-moz-appearance: textfield;
	}
`;
