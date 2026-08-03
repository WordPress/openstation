/**
 * Styles for `<os-toast-container>` + `<os-toast>`. Two exported
 * stylesheets because each component adopts its own; keeping them
 * in one file anchors the visual decisions (container stacks its
 * children; each child has the same padding, rounded corners, fade
 * transition) side-by-side.
 */
import { css } from '../../core';
import { holoTokens } from '../../holo';

export const containerStyles = css`
	:host {
		position: fixed;
		top: calc( var( --wp-admin--admin-bar--height, 32px ) + 16px );
		inset-inline-end: 16px;
		display: flex;
		flex-direction: column;
		gap: 8px;
		z-index: calc( var( --os-z-fullscreen, 99999 ) + 10 );
		pointer-events: none;
	}
`;

export const toastStyles = css`
	${ holoTokens }

	:host {
		display: flex;
		align-items: center;
		gap: 12px;
		min-width: 280px;
		max-width: 420px;
		padding: 10px 14px;
		/* Longhand on purpose: the texture slot below owns
		   background-image, and the shorthand would reset it.

		   A toast is a dark chip whatever the admin colour scheme
		   says, which is the same constraint the dialog surface has —
		   so it chains through --os-ui-modal-bg rather than through
		   --os-ui-surface, which a light theme sets to white and would
		   pair with the light --os-ui-fg-on-accent text below.
		   --os-ui-toast-bg stays as the per-instance hook. */
		background-color: var( --os-ui-toast-bg, var( --os-ui-modal-bg, #1d2327 ) );
		/* Desktop-theme texture slot: unset resolves to none. */
		background-image: var( --os-ui-toast-bg-image, none );
		background-repeat: var( --os-ui-toast-bg-image-repeat, repeat );
		background-size: var( --os-ui-toast-bg-image-size, auto );
		background-position: var( --os-ui-toast-bg-image-position, center );
		color: var( --os-ui-fg-on-accent, #fff );
		border-radius: 10px;
		border: 1px solid var( --os-ui-border, rgba( 255, 255, 255, 0.12 ) );
		box-shadow: 0 10px 30px rgba( 0, 0, 0, 0.4 ),
			0 2px 6px rgba( 0, 0, 0, 0.18 ),
			inset 0 0 0 1px rgba( 255, 255, 255, 0.04 );
		font-size: 13px;
		line-height: 1.4;
		opacity: 0;
		/*
		 * Arrives from above and slightly small, on the spring — a
		 * toast drops in from the edge it is docked to, and the scale
		 * is what stops eight stacked toasts reading as one list
		 * scrolling.
		 */
		transform: translateY( -10px ) scale( 0.97 );
		transition: opacity var( --_holo-t-fast ) linear,
			transform var( --_holo-t ) var( --_holo-spring );
		pointer-events: auto;
	}
	:host( [ state='in' ] ) {
		opacity: 1;
		transform: translateY( 0 ) scale( 1 );
	}
	/*
	 * Leaving is not arriving in reverse. It exits sideways, toward
	 * the edge it is docked to, and on the plain ease rather than the
	 * spring: an overshoot on the way out reads as the toast being
	 * yanked back before it goes.
	 */
	:host( [ state='out' ] ) {
		opacity: 0;
		transform: translateX( 16px ) scale( 0.97 );
		transition: opacity var( --_holo-t-fast ) linear,
			transform var( --_holo-t ) var( --_holo-ease );
	}
	.os-toast__label {
		flex: 1;
	}
	/* Author styles beat the UA [hidden] rule, so the explicit display
	 * on .os-toast__close would otherwise keep a ?hidden button visible. */
	button[ hidden ] {
		display: none;
	}
	button {
		flex-shrink: 0;
		padding: 4px 10px;
		border: none;
		border-radius: 4px;
		background: var( --os-ui-hover, rgba( 255, 255, 255, 0.12 ) );
		color: var( --os-ui-fg-on-accent, #fff );
		font: inherit;
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		transition: background-color 0.12s ease;
	}
	button:hover {
		background: var( --os-ui-scrim, rgba( 255, 255, 255, 0.22 ) );
	}
	button:focus-visible {
		outline: 2px solid var( --os-ui-border, rgba( 255, 255, 255, 0.6 ) );
		outline-offset: 2px;
	}
	.os-toast__close {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 4px;
		border-radius: 6px;
		background: transparent;
		color: var( --os-ui-fg-muted, rgba( 255, 255, 255, 0.7 ) );
	}
	.os-toast__close:hover {
		background: var( --os-ui-hover, rgba( 255, 255, 255, 0.14 ) );
		color: var( --os-ui-fg-on-accent, #fff );
	}
	@media ( prefers-reduced-motion: reduce ) {
		:host {
			transition-duration: 0.01ms;
		}
	}
`;
