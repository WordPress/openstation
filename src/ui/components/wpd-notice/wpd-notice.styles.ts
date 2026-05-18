/**
 * `<wpd-notice>` — full-width banner styles.
 *
 * The host stretches edge-to-edge of its container (intended for the
 * window's `after-titlebar` slot host, which itself spans the window
 * width). Tone variants colorize the left accent stripe + background;
 * the label inherits the surrounding text color so links inside slot
 * content still pick up the admin theme link color.
 */
import { css } from '../../core';

export const styles = css`
	:host {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		width: 100%;
		box-sizing: border-box;
		padding: 10px 14px;
		font: var(
			--wpd-notice-font,
			13px/1.5 var( --desktop-mode-font, system-ui )
		);
		color: var( --wpd-notice-color, var( --desktop-mode-text, #1d2327 ) );
		background: var( --wpd-notice-bg, rgba( 0, 0, 0, 0.04 ) );
		border-block-end: 1px solid
			var( --wpd-notice-border, rgba( 0, 0, 0, 0.08 ) );
		border-inline-start: 4px solid
			var( --wpd-notice-accent, #646970 );
	}
	:host( [ hidden ] ) {
		display: none;
	}

	.wpd-notice__icon {
		flex: 0 0 auto;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		color: var( --wpd-notice-accent, #646970 );
	}
	.wpd-notice__icon[ hidden ] {
		display: none;
	}

	.wpd-notice__label {
		flex: 1;
		min-width: 0;
		word-wrap: break-word;
	}
	::slotted( a ) {
		color: var( --wpd-notice-link, var( --wp-admin-theme-color, #2271b1 ) );
	}
	::slotted( p:first-child ) {
		margin-block-start: 0;
	}
	::slotted( p:last-child ) {
		margin-block-end: 0;
	}

	.wpd-notice__close {
		flex: 0 0 auto;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		padding: 0;
		border: none;
		background: transparent;
		color: inherit;
		opacity: 0.6;
		cursor: pointer;
		border-radius: 4px;
		transition: opacity 0.12s ease, background-color 0.12s ease;
	}
	.wpd-notice__close:hover {
		opacity: 1;
		background: rgba( 0, 0, 0, 0.06 );
	}
	.wpd-notice__close:focus-visible {
		opacity: 1;
		outline: 2px solid
			var( --wp-admin-theme-color, #2271b1 );
		outline-offset: 1px;
	}
	.wpd-notice__close[ hidden ] {
		display: none;
	}
	.wpd-notice__close svg {
		width: 14px;
		height: 14px;
	}

	/* ─── Tones ──────────────────────────────────────────────────────
	   Same palette as <wpd-badge> so the two surfaces feel like a set.
	   Plugins can override any single tone via the variables below
	   without redefining the rest. */
	:host( [ tone='info' ] ) {
		--wpd-notice-accent: var( --wpd-notice-info, #0969da );
		--wpd-notice-bg: var( --wpd-notice-info-bg, rgba( 9, 105, 218, 0.08 ) );
		--wpd-notice-border: var(
			--wpd-notice-info-border,
			rgba( 9, 105, 218, 0.16 )
		);
	}
	:host( [ tone='success' ] ) {
		--wpd-notice-accent: var( --wpd-notice-success, #1a7f37 );
		--wpd-notice-bg: var( --wpd-notice-success-bg, rgba( 26, 127, 55, 0.08 ) );
		--wpd-notice-border: var(
			--wpd-notice-success-border,
			rgba( 26, 127, 55, 0.16 )
		);
	}
	:host( [ tone='warning' ] ) {
		--wpd-notice-accent: var( --wpd-notice-warning, #9a6700 );
		--wpd-notice-bg: var( --wpd-notice-warning-bg, rgba( 154, 103, 0, 0.08 ) );
		--wpd-notice-border: var(
			--wpd-notice-warning-border,
			rgba( 154, 103, 0, 0.16 )
		);
	}
	:host( [ tone='error' ] ),
	:host( [ tone='danger' ] ) {
		--wpd-notice-accent: var( --wpd-notice-error, #cf222e );
		--wpd-notice-bg: var( --wpd-notice-error-bg, rgba( 207, 34, 46, 0.08 ) );
		--wpd-notice-border: var(
			--wpd-notice-error-border,
			rgba( 207, 34, 46, 0.16 )
		);
	}
	:host( [ tone='neutral' ] ) {
		--wpd-notice-accent: var( --wpd-notice-neutral, #57606a );
		--wpd-notice-bg: var( --wpd-notice-neutral-bg, rgba( 87, 96, 106, 0.08 ) );
		--wpd-notice-border: var(
			--wpd-notice-neutral-border,
			rgba( 87, 96, 106, 0.16 )
		);
	}
`;
