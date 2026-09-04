import { css } from '../../core';
import { holoTokens, holoField } from '../../holo';

/**
 * Styles for the labelled text / number field shared between
 * `<os-text-field>` and `<os-number-field>`. Visual language
 * matches `<os-color-field>` / `<os-range-field>` — a stacked
 * label on top, the input beneath, muted label color, accent focus
 * ring.
 *
 * The hover, focus, placeholder and selection states come from
 * `holoField` in `src/ui/holo.ts`, shared with every other text-like
 * control so the whole form family reacts identically. This file
 * keeps only what is this component's own shape — padding, radius,
 * the suffix slot, the reveal button and the password mask — plus the
 * `aria-invalid` rings, which deliberately outweigh the shared focus
 * rule so an invalid field focuses in red.
 */

export const textFieldStyles = css`
	${ holoTokens }
	${ holoField }

	/*
	 * Host is block-level flex so the field fills its parent cell
	 * (grid row col=N, flex container, plain block container). An
	 * inline-flex default would leave the native <input> at its
	 * intrinsic width while the host spans the full cell, which
	 * looks wrong inside a os-row.
	 */
	/*
	 * The control's type size and corner read two sizing tokens the
	 * palette owns. The phone layer sets the size to 16px — the size
	 * under which iOS zooms the page into a focused control — and
	 * rounds the home search; a theme may do the same anywhere.
	 */
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
		border-radius: var( --_field-radius );
		font: inherit;
		font-size: var( --_field-size );
		color: var( --os-ui-fg, #1d2327 );
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

	/* Clear (x) affordance — rendered on clearable fields while they
	 * hold a value. The kit strips native input chrome (appearance:
	 * none takes WebKit's search-cancel button with it, and Firefox
	 * never had one), so a clearable field owns its own. Same seat and
	 * chrome as the reveal toggle; when both are present the clear
	 * shifts inward so they sit side by side. */
	.os-text-field__row--has-clear input {
		padding-inline-end: 36px;
	}
	.os-text-field__row--has-reveal.os-text-field__row--has-clear input {
		padding-inline-end: 68px;
	}

	.os-text-field__clear {
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
	}
	.os-text-field__row--has-reveal .os-text-field__clear {
		inset-inline-end: 34px;
		border-radius: 0;
	}
	.os-text-field__clear:hover {
		color: var( --os-ui-accent, #2271b1 );
	}
	.os-text-field__clear:focus-visible {
		outline: none;
		color: var( --os-ui-accent, #2271b1 );
		/* Inset, matching the reveal toggle — see the note there. */
		box-shadow: inset 0 0 0 2px var( --os-ui-accent, #2271b1 );
	}
	.os-text-field__clear:disabled {
		opacity: 0.45;
		cursor: default;
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
		color: var( --os-ui-accent, #2271b1 );
	}
	.os-text-field__reveal:focus-visible {
		outline: none;
		color: var( --os-ui-accent, #2271b1 );
		/* Inset, because the button sits flush inside the field's own
		   border — a ring outside it would trace the field, not the
		   button, and read as the wrong thing having focus. */
		box-shadow: inset 0 0 0 2px var( --os-ui-accent, #2271b1 );
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

	input:disabled {
		opacity: 0.55;
		cursor: not-allowed;
		background: var( --os-ui-hover, rgba( 0, 0, 0, 0.03 ) );
	}

	/*
	 * Invalid outranks the shared focus ring — see the note on
	 * :where() in holoField. An invalid field focuses in red, because
	 * the ring is the only thing on screen saying so at that moment.
	 */
	input[ aria-invalid='true' ],
	input[ aria-invalid='true' ]:hover:not( :disabled ) {
		border-color: var( --os-ui-danger, #d63638 );
	}
	input[ aria-invalid='true' ]:focus,
	input[ aria-invalid='true' ]:focus-visible {
		border-color: var( --os-ui-danger, #d63638 );
		box-shadow: 0 0 0 1px var( --os-ui-danger, #d63638 ),
			0 0 0 4px rgba( 214, 54, 56, 0.18 );
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
