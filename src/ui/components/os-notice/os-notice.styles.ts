/**
 * `<os-notice>` — full-width banner styles.
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
			--os-ui-notice-font,
			13px/1.5 var( --os-font, system-ui )
		);
		color: var( --os-ui-notice-color, var( --os-ui-fg, #1d2327 ) );
		background: var( --os-ui-notice-bg, var( --os-ui-hover, rgba( 0, 0, 0, 0.04 ) ) );
		border-block-end: 1px solid
			var( --os-ui-notice-border, var( --os-ui-border, rgba( 0, 0, 0, 0.08 ) ) );
		border-inline-start: 4px solid
			var( --os-ui-notice-accent, var( --os-ui-border, #646970 ) );
	}
	:host( [ hidden ] ) {
		display: none;
	}

	.os-notice__icon {
		flex: 0 0 auto;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		color: var( --os-ui-notice-accent, var( --os-ui-accent, #646970 ) );
	}
	.os-notice__icon[ hidden ] {
		display: none;
	}

	.os-notice__label {
		flex: 1;
		min-width: 0;
		word-wrap: break-word;
	}
	::slotted( a ) {
		color: var( --os-ui-notice-link, var( --wp-admin-theme-color, #2271b1 ) );
	}
	::slotted( p:first-child ) {
		margin-block-start: 0;
	}
	::slotted( p:last-child ) {
		margin-block-end: 0;
	}

	.os-notice__close {
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
	.os-notice__close:hover {
		opacity: 1;
		background: var( --os-ui-hover, rgba( 0, 0, 0, 0.06 ) );
	}
	.os-notice__close:focus-visible {
		opacity: 1;
		outline: 2px solid
			var( --wp-admin-theme-color, #2271b1 );
		outline-offset: 1px;
	}
	.os-notice__close[ hidden ] {
		display: none;
	}
	.os-notice__close svg {
		width: 14px;
		height: 14px;
	}

	/* ─── Tones ──────────────────────────────────────────────────────
	   Same palette as <os-badge> so the two surfaces feel like a set.
	   Plugins can override any single tone via the variables below
	   without redefining the rest. */
	:host( [ tone='info' ] ) {
		--os-ui-notice-accent: var( --os-ui-notice-info, var( --os-ui-info-fg, #0969da ) );
		--os-ui-notice-bg: var( --os-ui-notice-info-bg, rgba( 9, 105, 218, 0.08 ) );
		--os-ui-notice-border: var(
			--os-ui-notice-info-border,
			rgba( 9, 105, 218, 0.16 )
		);
	}
	:host( [ tone='success' ] ) {
		--os-ui-notice-accent: var( --os-ui-notice-success, var( --os-ui-success-fg, #1a7f37 ) );
		--os-ui-notice-bg: var( --os-ui-notice-success-bg, rgba( 26, 127, 55, 0.08 ) );
		--os-ui-notice-border: var(
			--os-ui-notice-success-border,
			rgba( 26, 127, 55, 0.16 )
		);
	}
	:host( [ tone='warning' ] ) {
		--os-ui-notice-accent: var( --os-ui-notice-warning, var( --os-ui-warning-fg, #9a6700 ) );
		--os-ui-notice-bg: var( --os-ui-notice-warning-bg, rgba( 154, 103, 0, 0.08 ) );
		--os-ui-notice-border: var(
			--os-ui-notice-warning-border,
			rgba( 154, 103, 0, 0.16 )
		);
	}
	:host( [ tone='error' ] ),
	:host( [ tone='danger' ] ) {
		--os-ui-notice-accent: var( --os-ui-notice-error, var( --os-ui-danger, #cf222e ) );
		--os-ui-notice-bg: var( --os-ui-notice-error-bg, rgba( 207, 34, 46, 0.08 ) );
		--os-ui-notice-border: var(
			--os-ui-notice-error-border,
			rgba( 207, 34, 46, 0.16 )
		);
	}
	:host( [ tone='neutral' ] ) {
		--os-ui-notice-accent: var( --os-ui-notice-neutral, var( --os-ui-fg-muted, #57606a ) );
		--os-ui-notice-bg: var( --os-ui-notice-neutral-bg, rgba( 87, 96, 106, 0.08 ) );
		--os-ui-notice-border: var(
			--os-ui-notice-neutral-border,
			rgba( 87, 96, 106, 0.16 )
		);
	}
`;
