import { css } from '../../core';

export const osFormStyles = css`

	:host {
		display: block;
		container-type: inline-size;
		container-name: os-form;
		font-size: 13px;
		color: var( --os-ui-fg, #1d2327 );
	}
	:host( [ hidden ] ) {
		display: none;
	}

	.header {
		margin: 0 0 18px;
	}
	.header:empty {
		display: none;
	}

	.fields {
		display: grid;
		grid-template-columns: 1fr;
		gap: 14px 16px;
		margin: 0 0 18px;
	}

	@container os-form ( min-width: 480px ) {
		.fields {
			grid-template-columns: repeat( 2, minmax( 0, 1fr ) );
		}
	}
	@container os-form ( min-width: 760px ) {
		:host( [ columns="3" ] ) .fields {
			grid-template-columns: repeat( 3, minmax( 0, 1fr ) );
		}
	}

	:host( [ columns="1" ] ) .fields {
		grid-template-columns: 1fr;
	}

	:host( [ columns="2" ] ) .fields {
		grid-template-columns: repeat( 2, minmax( 0, 1fr ) );
	}

	::slotted( [ full-width ] ) {
		grid-column: 1 / -1;
	}
	::slotted( [ slot ] ) {

		display: contents;
	}

	.error {
		margin: 0 0 14px;
		padding: 10px 12px;
		border-radius: 6px;
		background: var( --os-ui-notice-error-bg, rgba( 179, 45, 46, 0.10 ) );
		color: var( --os-ui-danger-hover, #b32d2e );
		font-size: 13px;
		line-height: 1.4;
	}
	.error[ hidden ] {
		display: none;
	}

	.footer {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		align-items: center;
		justify-content: flex-end;
		border-top: 1px solid var( --os-ui-border, #dcdcde );
		padding-top: 14px;
	}
	:host( [ align="start" ] ) .footer {
		justify-content: flex-start;
	}
	:host( [ align="stretch" ] ) .footer {
		justify-content: stretch;
	}
	:host( [ align="stretch" ] ) .footer .footer-actions {
		flex: 1 1 auto;
	}
	.footer-leading,
	.footer-trailing {
		display: contents;
	}
	.footer-actions {
		display: inline-flex;
		gap: 8px;
		align-items: center;
		margin-inline-start: auto;
	}
	:host( [ align="start" ] ) .footer-actions {
		margin-inline-start: 0;
	}

	:host( [ busy ] ) {
		pointer-events: none;
	}
	:host( [ busy ] ) .fields {
		opacity: 0.6;
	}
	:host( [ busy ] ) .footer {
		pointer-events: auto;
	}
	.busy-spinner {
		display: inline-flex;
		width: 14px;
		height: 14px;
		border-radius: 50%;
		border: 2px solid currentColor;
		border-right-color: transparent;
		animation: os-form-spin 0.7s linear infinite;
		vertical-align: -2px;
		margin-inline-end: 6px;
	}
	@keyframes os-form-spin {
		to {
			transform: rotate( 360deg );
		}
	}
	@media ( prefers-reduced-motion: reduce ) {
		.busy-spinner {
			animation-duration: 2s;
		}
	}
`;
