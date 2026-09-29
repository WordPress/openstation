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

	/*
	 * hide-label: the label is still rendered and still paired with the
	 * input by for=, it is only taken out of the visual flow. Hiding it
	 * with display: none would remove it from the accessibility tree too,
	 * which is the opposite of the point. Same idiom as
	 * .os-constellation__row-note in openstation-layout.css.
	 */
	.os-text-field__label--hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		margin: -1px;
		padding: 0;
		border: 0;
		overflow: hidden;
		white-space: nowrap;
		clip-path: inset( 50% );
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

	/* Native calendar artwork does not inherit color. Keep the native
	 * picker target, but paint its glyph through the same token as the
	 * other field affordances. The mask is WordPress's calendar icon:
	 * packages/icons/src/library/calendar.svg in WordPress/gutenberg. */
	input:is( [ type='date' ], [ type='datetime-local' ], [ type='month' ], [ type='week' ] )::-webkit-calendar-picker-indicator {
		--_calendar-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.5'%3E%3Cpath d='M4.75 7.25L4.75 18C4.75 18.6904 5.30964 19.25 6 19.25H18C18.6904 19.25 19.25 18.6904 19.25 18V7.25V6C19.25 5.30964 18.6904 4.75 18 4.75H6C5.30964 4.75 4.75 5.30964 4.75 6V7.25ZM19.25 7.25H4.75M7.25 10.75H9.25M11 10.75H13M14.75 10.75H16.75M7.25 14.5H9.25M11 14.5H13M14.75 14.5H16.75' vector-effect='non-scaling-stroke'/%3E%3Cpath d='M18 4.75H6C5.30964 4.75 4.75 5.30964 4.75 6V7.25H19.25V6C19.25 5.30964 18.6904 4.75 18 4.75Z' fill='currentColor' vector-effect='non-scaling-stroke'/%3E%3C/svg%3E");
		background: var( --os-ui-fg-muted, #646970 );
		-webkit-mask: var( --_calendar-icon ) center / contain no-repeat;
		mask: var( --_calendar-icon ) center / contain no-repeat;
		width: 16px;
		height: 16px;
		cursor: pointer;
	}
	@media ( forced-colors: active ) {
		input:is( [ type='date' ], [ type='datetime-local' ], [ type='month' ], [ type='week' ] )::-webkit-calendar-picker-indicator {
			background: ButtonText;
			forced-color-adjust: none;
		}
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
	 * hold a value, so a clearable field owns its own. Same seat and
	 * chrome as the reveal toggle; when both are present the clear
	 * shifts inward so they sit side by side.
	 *
	 * appearance: none on the input does NOT take WebKit's own
	 * search-cancel button with it: a type="search" field still drew
	 * one, in system blue, beside this one. A clearable field hides
	 * it, since it has its own. A search field that is not clearable
	 * keeps the native one, the only clear it has. */
	:host( [ clearable ] ) input::-webkit-search-cancel-button {
		-webkit-appearance: none;
		display: none;
	}
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
