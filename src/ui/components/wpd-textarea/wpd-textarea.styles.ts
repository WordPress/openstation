import { css } from '../../core';

/**
 * Styles for `<wpd-textarea>` — multi-line text input. Visually
 * matches `<wpd-text-field>` (same border, padding, focus ring) so
 * forms can mix the two without a seam.
 */
export const textareaStyles = css`
	:host {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 13px;
		color: var( --desktop-mode-text, #1d2327 );
		min-width: 0;
	}
	:host( [ hidden ] ) {
		display: none;
	}

	.wpd-textarea__label {
		font-size: 12px;
		color: var( --desktop-mode-muted, #646970 );
	}

	textarea {
		appearance: none;
		-webkit-appearance: none;
		display: block;
		width: 100%;
		min-width: 0;
		box-sizing: border-box;
		padding: 8px 10px;
		background: var( --desktop-mode-window-bg, #fff );
		border: 1px solid var( --desktop-mode-border, #dcdcde );
		border-radius: 6px;
		font: inherit;
		font-size: 13px;
		line-height: 1.45;
		color: var( --desktop-mode-text, #1d2327 );
		resize: vertical;
		transition: border-color 0.12s ease, box-shadow 0.12s ease;
	}

	textarea:hover {
		border-color: var( --desktop-mode-muted, #8c8f94 );
	}
	textarea:focus-visible {
		outline: none;
		border-color: var( --wp-admin-theme-color, #2271b1 );
		box-shadow: 0 0 0 1px var( --wp-admin-theme-color, #2271b1 );
	}
	textarea:disabled {
		opacity: 0.55;
		cursor: not-allowed;
		background: rgba( 0, 0, 0, 0.03 );
	}

	textarea[ aria-invalid='true' ] {
		border-color: #d63638;
	}
	textarea[ aria-invalid='true' ]:focus-visible {
		box-shadow: 0 0 0 1px #d63638;
	}

	/* Auto-grow mode: hide native resize affordance — we manage rows. */
	:host( [ auto-grow ] ) textarea {
		resize: none;
		overflow: hidden;
	}
`;
