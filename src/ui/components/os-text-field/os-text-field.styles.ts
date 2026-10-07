import { css } from '../../core';
import { holoTokens, holoField } from '../../holo';

export const textFieldStyles = css`
	${ holoTokens }
	${ holoField }

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

	.os-text-field__suffix {
		position: absolute;
		inset-inline-end: 10px;
		top: 50%;
		transform: translateY( -50% );
		pointer-events: none;
		font-size: 12px;
		color: var( --os-ui-fg-muted, #646970 );
	}

	.os-text-field__row--has-reveal input {
		padding-inline-end: 36px;
	}

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

		box-shadow: inset 0 0 0 2px var( --os-ui-accent, #2271b1 );
		border-radius: 0 6px 6px 0;
	}
	.os-text-field__reveal:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

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

	input[ type='number' ]::-webkit-inner-spin-button,
	input[ type='number' ]::-webkit-outer-spin-button {
		-webkit-appearance: none;
		margin: 0;
	}
	input[ type='number' ] {
		-moz-appearance: textfield;
	}
`;
