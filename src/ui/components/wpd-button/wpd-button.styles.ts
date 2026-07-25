/**
 * `<wpd-button>` — shadow-DOM styles. Variants are selected via
 * host-attribute selectors (`:host([variant='primary'])`). Every
 * paintable property reads from a CSS custom property FIRST so
 * authors can tune individual buttons (or whole panels) without
 * reimplementing the component.
 */
import { css } from '../../core';

export const styles = css`
	:host {
		display: inline-flex;
	}
	:host( [ fill-cell ] ) {
		display: flex;
		width: 100%;
	}
	button {
		appearance: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		padding: var( --wpd-button-padding, 6px 12px );
		border-radius: var( --wpd-button-border-radius, 6px );
		font: inherit;
		font-weight: 500;
		cursor: pointer;
		transition: background-color 0.12s ease, color 0.12s ease,
			border-color 0.12s ease;
		/* Ghost (default) */
		background: var( --wpd-button-bg, transparent );
		color: var( --wpd-button-fg, var( --wpd-fg, #1d2327 ) );
		border: var(
			--wpd-button-border,
			1px solid var( --wpd-border, #c3c4c7 )
		);
	}
	:host( [ fill-cell ] ) button {
		width: 100%;
		min-height: var( --wpd-button-min-height, 44px );
	}
	button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	button:hover:not( :disabled ) {
		background: var( --wpd-button-bg-hover, var( --wpd-hover, rgba( 0, 0, 0, 0.04 ) ) );
	}
	/* Primary */
	:host( [ variant='primary' ] ) button {
		background: var( --wpd-button-bg, var( --wp-admin-theme-color, #2271b1 ) );
		color: var( --wpd-button-fg, var( --wpd-fg-on-accent, #fff ) );
		border: var( --wpd-button-border, 1px solid transparent );
	}
	:host( [ variant='primary' ] ) button:hover:not( :disabled ) {
		filter: brightness( 1.06 );
		background: var( --wpd-button-bg, var( --wp-admin-theme-color, #2271b1 ) );
	}
	/* Secondary — quiet filled control. Neutral chrome, no underline.
	 * Semantic fit for "not the primary action but also not a
	 * destructive one" (AC / ± / % on a calculator; Cancel in a
	 * two-button dialog). */
	:host( [ variant='secondary' ] ) button {
		background: var( --wpd-button-bg, var( --wpd-hover, rgba( 0, 0, 0, 0.06 ) ) );
		color: var( --wpd-button-fg, var( --wpd-fg, #1d2327 ) );
		border: var( --wpd-button-border, 1px solid transparent );
	}
	:host( [ variant='secondary' ] ) button:hover:not( :disabled ) {
		background: var( --wpd-button-bg-hover, var( --wpd-hover, rgba( 0, 0, 0, 0.1 ) ) );
	}
	/* Danger */
	:host( [ variant='danger' ] ) button {
		background: var( --wpd-button-bg, transparent );
		color: var( --wpd-button-fg, var( --wpd-danger, #d63638 ) );
		border: var( --wpd-button-border, 1px solid currentColor );
	}
	:host( [ variant='danger' ] ) button:hover:not( :disabled ) {
		background: var( --wpd-danger, #d63638 );
		color: var( --wpd-fg-on-accent, #fff );
	}
	/* Link */
	:host( [ variant='link' ] ) button {
		background: transparent;
		color: var( --wpd-button-fg, var( --wp-admin-theme-color, #2271b1 ) );
		border: 0;
		padding: 0;
		text-decoration: underline;
	}
	:host( [ busy ] ) button {
		pointer-events: none;
		opacity: 0.75;
	}
	.wpd-button__spinner {
		box-sizing: border-box;
		display: inline-block;
		width: 12px;
		height: 12px;
		border: 2px solid currentColor;
		border-right-color: transparent;
		border-radius: 50%;
		animation: wpd-button-spin 0.6s linear infinite;
		flex-shrink: 0;
	}
	@keyframes wpd-button-spin {
		to {
			transform: rotate( 360deg );
		}
	}
`;
