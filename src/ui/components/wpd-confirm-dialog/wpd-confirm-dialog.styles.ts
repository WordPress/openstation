import { css } from '../../core';

export const dialogStyles = css`
	:host {
		display: none;
		position: fixed;
		inset: 0;
		align-items: center;
		justify-content: center;
		background: var( --wpd-scrim, rgba( 0, 0, 0, 0.45 ) );
		backdrop-filter: blur( 2px );
		z-index: 10000;
	}

	:host( [ open ] ) {
		display: flex;
	}

	.dialog {
		width: min( 420px, 92vw );
		background: var( --wpd-confirm-dialog-bg, var( --desktop-mode-bg, #1d2327 ) );
		color: var( --wpd-confirm-dialog-fg, var( --desktop-mode-fg, #fff ) );
		border: 1px solid var( --wpd-border, rgba( 255, 255, 255, 0.08 ) );
		border-radius: 10px;
		box-shadow: 0 20px 50px rgba( 0, 0, 0, 0.6 );
		padding: 20px 22px 18px;
		display: flex;
		flex-direction: column;
		gap: 10px;
		position: relative;
	}

	.close {
		position: absolute;
		top: 8px;
		right: 10px;
		width: 28px;
		height: 28px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: 0;
		border-radius: 6px;
		color: var( --wpd-confirm-dialog-fg-muted, var( --wpd-fg-muted, rgba( 255, 255, 255, 0.7 ) ) );
		cursor: pointer;
		font-size: 22px;
		line-height: 1;
		padding: 0;
	}
	.close:hover {
		background: var( --wpd-hover, rgba( 255, 255, 255, 0.08 ) );
		color: inherit;
	}

	.title {
		margin: 0 0 4px;
		font-size: 16px;
		font-weight: 600;
	}

	.message {
		margin: 0;
		color: var( --wpd-confirm-dialog-fg-muted, var( --wpd-fg-muted, rgba( 255, 255, 255, 0.7 ) ) );
		line-height: 1.45;
		white-space: pre-line;
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 6px;
	}

	.btn {
		border: 0;
		border-radius: 6px;
		padding: 8px 14px;
		font-size: 13px;
		cursor: pointer;
		font-weight: 500;
	}

	.btn--secondary {
		background: var( --wpd-hover, rgba( 255, 255, 255, 0.08 ) );
		color: inherit;
	}
	.btn--secondary:hover {
		background: var( --wpd-hover, rgba( 255, 255, 255, 0.14 ) );
	}

	.btn--primary {
		background: var( --wp-admin-theme-color, #2271b1 );
		color: var( --wpd-fg-on-accent, #fff );
	}
	.btn--primary:hover {
		filter: brightness( 1.08 );
	}

	.btn--danger {
		background: var( --wpd-danger, #d63638 );
		color: var( --wpd-fg-on-accent, #fff );
	}
	.btn--danger:hover {
		filter: brightness( 1.08 );
	}
`;
