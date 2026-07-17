/**
 * Styles for `<wpd-toast-container>` + `<wpd-toast>`. Two exported
 * stylesheets because each component adopts its own; keeping them
 * in one file anchors the visual decisions (container stacks its
 * children; each child has the same padding, rounded corners, fade
 * transition) side-by-side.
 */
import { css } from '../../core';

export const containerStyles = css`
	:host {
		position: fixed;
		top: calc( var( --wp-admin--admin-bar--height, 32px ) + 16px );
		inset-inline-end: 16px;
		display: flex;
		flex-direction: column;
		gap: 8px;
		z-index: calc( var( --desktop-mode-z-fullscreen, 99999 ) + 10 );
		pointer-events: none;
	}
`;

export const toastStyles = css`
	:host {
		display: flex;
		align-items: center;
		gap: 12px;
		min-width: 280px;
		max-width: 420px;
		padding: 10px 14px;
		background: #1d2327;
		color: #fff;
		border-radius: 10px;
		border: 1px solid rgba( 255, 255, 255, 0.12 );
		box-shadow: 0 10px 30px rgba( 0, 0, 0, 0.4 ),
			0 2px 6px rgba( 0, 0, 0, 0.18 ),
			inset 0 0 0 1px rgba( 255, 255, 255, 0.04 );
		font-size: 13px;
		line-height: 1.4;
		opacity: 0;
		transform: translateY( -8px );
		transition: opacity 0.18s ease, transform 0.18s ease;
		pointer-events: auto;
	}
	:host( [ state='in' ] ) {
		opacity: 1;
		transform: translateY( 0 );
	}
	:host( [ state='out' ] ) {
		opacity: 0;
		transform: translateY( -8px );
	}
	.wpd-toast__label {
		flex: 1;
	}
	/* Author styles beat the UA [hidden] rule, so the explicit display
	 * on .wpd-toast__close would otherwise keep a ?hidden button visible. */
	button[ hidden ] {
		display: none;
	}
	button {
		flex-shrink: 0;
		padding: 4px 10px;
		border: none;
		border-radius: 4px;
		background: rgba( 255, 255, 255, 0.12 );
		color: #fff;
		font: inherit;
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		transition: background-color 0.12s ease;
	}
	button:hover {
		background: rgba( 255, 255, 255, 0.22 );
	}
	button:focus-visible {
		outline: 2px solid rgba( 255, 255, 255, 0.6 );
		outline-offset: 2px;
	}
	.wpd-toast__close {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 4px;
		border-radius: 6px;
		background: transparent;
		color: rgba( 255, 255, 255, 0.7 );
	}
	.wpd-toast__close:hover {
		background: rgba( 255, 255, 255, 0.14 );
		color: #fff;
	}
	@media ( prefers-reduced-motion: reduce ) {
		:host {
			transition-duration: 0.01ms;
		}
	}
`;
