import { css } from '../../core';
import { holoTokens } from '../../holo';

export const selectStyles = css`
	${ holoTokens }

	:host {
		display: flex;
		flex-direction: column;
		gap: 8px;
		font-size: 13px;
		color: var( --os-ui-fg, #1d2327 );
		min-width: 0;
	}

	:host( [ hidden ] ) {
		display: none;
	}

	.os-select__label {
		font-size: 13px;
		line-height: 1.5;
		color: var( --os-ui-fg-muted, #646970 );
	}

	.os-select__trigger {
		appearance: none;
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		min-width: 0;
		padding: 8px 12px;
		background: var( --os-ui-hover, rgba( 0, 0, 0, 0.05 ) );
		border: 1px solid transparent;
		border-radius: 8px;
		font: inherit;
		font-size: 13px;
		line-height: 1.5;
		color: var( --os-ui-fg, #1d2327 );
		text-align: start;
		cursor: pointer;
		transition: background-color var( --_holo-t ) ease,
			border-color var( --_holo-t ) ease,
			box-shadow var( --_holo-t ) ease;
	}

	.os-select__trigger:hover:not( :disabled ) {
		background: var( --os-ui-hover, rgba( 0, 0, 0, 0.08 ) );
		border-color: var( --os-ui-border-strong, #8c8f94 );
	}

	.os-select__trigger:focus,
	.os-select__trigger:focus-visible {
		outline: none;
		border-color: var( --os-ui-accent, #2271b1 );
		box-shadow: var( --_holo-focus-field );
	}

	.os-select__trigger:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	:host( [ plain ] ) {
		display: inline-flex;
		flex-direction: row;
		align-items: center;
	}

	:host( [ plain ] ) .os-select__label {
		display: none;
	}

	:host( [ plain ] ) .os-select__trigger {
		width: auto;
		padding: 4px 6px;
		background: transparent;
		border-color: transparent;
		border-radius: 6px;
	}

	:host( [ plain ] ) .os-select__trigger:hover:not( :disabled ) {
		background: var( --os-ui-hover, rgba( 0, 0, 0, 0.05 ) );
		border-color: transparent;
	}

	:host( [ plain ] ) .os-select__trigger:focus,
	:host( [ plain ] ) .os-select__trigger:focus-visible {
		border-color: var( --os-ui-accent, #2271b1 );
	}

	:host( [ plain ] ) .os-select__value {
		flex: 0 1 auto;
	}

	.os-select__value {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.os-select__value--placeholder {
		color: var( --os-ui-fg-muted, #646970 );
	}

	.os-select__chevron {
		flex: 0 0 auto;
		pointer-events: none;
		color: var( --os-ui-fg-muted, #646970 );
	}

	.os-select__trigger:hover .os-select__chevron {
		color: var( --os-ui-fg, #1d2327 );
	}

	.os-select__trigger:focus .os-select__chevron,
	.os-select__trigger:focus-visible .os-select__chevron {
		color: var( --os-ui-accent, #2271b1 );
	}

	.os-select__popup {
		position: fixed;
		inset: auto;
		margin: 0;
		max-height: min( 320px, 60vh );
		overflow-y: auto;
		padding: 4px;
		background: var( --os-ui-surface, #fff );
		border: 1px solid var( --os-ui-border, #dcdcde );
		border-radius: 8px;
		box-shadow: 0 12px 32px rgba( 0, 0, 0, 0.45 );
		color: var( --os-ui-fg, #1d2327 );
	}

	.os-select__popup:not( [ data-open ] ) {
		display: none;
	}

	.os-select__popup:popover-open {
		display: block;
	}

	.os-select__popup[ data-open ] {
		position: absolute;
		top: calc( 100% + 4px );
		left: 0;
		min-width: 100%;
		z-index: 1000;
	}

	:host {
		position: relative;
	}

	.os-select__option {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 7px 10px;
		border-radius: 6px;
		font-size: 13px;
		line-height: 1.5;
		cursor: pointer;
		white-space: nowrap;
	}

	.os-select__check {
		flex: 0 0 auto;
		visibility: hidden;
	}

	.os-select__option[ aria-selected='true' ] .os-select__check {
		visibility: visible;
	}

	.os-select__option[ data-active ],
	.os-select__option:hover {
		background: var( --os-ui-accent, #2271b1 );
		color: var( --os-ui-accent-ink, var( --os-ui-fg-on-accent, #fff ) );
	}

	.os-select__option[ aria-disabled='true' ] {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.os-select__option[ aria-disabled='true' ]:hover {
		background: transparent;
		color: inherit;
	}

	@media ( prefers-reduced-motion: reduce ) {
		.os-select__trigger {
			transition-duration: 1ms;
		}
	}
`;

export const optionStyles = css`

	:host {
		display: none;
	}
`;
