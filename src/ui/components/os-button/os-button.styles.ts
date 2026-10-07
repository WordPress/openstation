import { css } from '../../core';
import {
	holoTokens,
	holoSheen,
	holoEdge,
	holoGlint,
	holoRing,
	holoDrift,
} from '../../holo';

export const styles = css`
	${ holoTokens }
	${ holoSheen }
	${ holoEdge }
	${ holoGlint }
	${ holoRing }
	${ holoDrift }

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
		padding: var( --os-ui-button-padding, 6px 12px );
		border-radius: var( --os-ui-button-border-radius, 6px );
		font: inherit;
		font-weight: 500;
		cursor: pointer;
		transition: background-color var( --_holo-t ) ease, color var( --_holo-t ) ease,
			border-color var( --_holo-t ) ease, box-shadow var( --_holo-t ) ease,
			transform 80ms ease;

		background: var( --os-ui-button-bg, transparent );

		background-image: var( --os-ui-button-bg-image, none );
		background-repeat: var( --os-ui-button-bg-image-repeat, repeat );
		background-size: var( --os-ui-button-bg-image-size, auto );
		background-position: var( --os-ui-button-bg-image-position, center );
		color: var( --os-ui-button-fg, var( --os-ui-fg, #1d2327 ) );
		border: var(
			--os-ui-button-border,
			1px solid var( --os-ui-border, #c3c4c7 )
		);
	}
	:host( [ fill-cell ] ) button {
		width: 100%;
		min-height: var( --os-ui-button-min-height, 44px );
	}
	button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	button:active:not( :disabled ) {
		transform: translateY( 1px );
	}
	button:hover:not( :disabled ) {
		background-color: var( --os-ui-button-bg-hover, var( --os-ui-hover, rgba( 0, 0, 0, 0.04 ) ) );
	}

	button:focus-visible {
		outline: none;
		box-shadow: var( --_holo-focus );
	}

	button:disabled::before,
	button:disabled::after,
	button:disabled .os-holo-glint {
		opacity: 0 !important;
	}

	:host( [ variant='primary' ] ) button {
		background-color: var( --os-ui-button-bg, var( --wp-admin-theme-color, #2271b1 ) );

		color: var( --os-ui-button-fg, var( --os-ui-accent-ink, var( --os-ui-fg-on-accent, #fff ) ) );
		border: var( --os-ui-button-border, 1px solid transparent );
	}
	:host( [ variant='primary' ] ) button:hover:not( :disabled ) {
		filter: brightness( 1.06 );
		background-color: var( --os-ui-button-bg, var( --wp-admin-theme-color, #2271b1 ) );
		box-shadow: var( --_holo-glow );
	}

	:host( [ variant='holo' ] ) button {
		background-color: transparent;
		background-image: var( --_holo-fill );
		background-size: 220% 220%;
		background-position: 22% 28%;
		background-repeat: no-repeat;
		color: var( --os-ui-button-fg, var( --_holo-ink ) );
		border: var( --os-ui-button-border, 1px solid transparent );
		box-shadow: var( --_holo-glow );
		font-weight: 600;
		transition: background-position var( --_holo-t ) ease,
			box-shadow var( --_holo-t ) ease, filter var( --_holo-t ) ease,
			transform 80ms ease;
	}
	:host( [ variant='holo' ] ) button:hover:not( :disabled ) {
		background-color: transparent;
		background-position: 74% 66%;
		box-shadow: var( --_holo-glow-strong );
	}
	:host( [ variant='holo' ] ) button:active:not( :disabled ) {
		background-position: 88% 82%;
		filter: brightness( 0.94 );
	}

	:host( [ variant='holo' ] ) button::before {
		display: none;
	}
	@media ( prefers-reduced-motion: reduce ) {
		:host( [ variant='holo' ] ) button:hover:not( :disabled ),
		:host( [ variant='holo' ] ) button:active:not( :disabled ) {
			background-position: 22% 28%;
		}
	}

	:host( [ variant='secondary' ] ) button {
		background-color: var( --os-ui-button-bg, var( --os-ui-hover, rgba( 0, 0, 0, 0.06 ) ) );
		color: var( --os-ui-button-fg, var( --os-ui-fg, #1d2327 ) );
		border: var( --os-ui-button-border, 1px solid transparent );
	}
	:host( [ variant='secondary' ] ) button:hover:not( :disabled ) {
		background-color: var( --os-ui-button-bg-hover, var( --os-ui-hover, rgba( 0, 0, 0, 0.1 ) ) );
	}

	:host( [ variant='danger' ] ) button {
		background-color: var( --os-ui-button-bg, transparent );
		color: var( --os-ui-button-fg, var( --os-ui-danger, #d63638 ) );
		border: var( --os-ui-button-border, 1px solid currentColor );
	}
	:host( [ variant='danger' ] ) button:hover:not( :disabled ) {
		background-color: var( --os-ui-danger, #d63638 );
		color: var( --os-ui-fg-on-accent, #fff );
	}

	:host( [ variant='danger' ] ) button::after {
		display: none;
	}

	:host( [ variant='link' ] ) button {
		background-color: transparent;
		background-image: none;
		color: var( --os-ui-button-fg, var( --wp-admin-theme-color, #2271b1 ) );
		border: 0;
		padding: 0;
		text-decoration: underline;
	}

	:host( [ variant='link' ] ) button::before,
	:host( [ variant='link' ] ) button::after,
	:host( [ variant='link' ] ) .os-holo-glint,
	:host( [ variant='link' ] ) .os-holo-ring {
		display: none;
	}
	:host( [ variant='link' ] ) button:active:not( :disabled ) {
		transform: none;
	}
	:host( [ busy ] ) button {
		pointer-events: none;
		opacity: 0.75;
	}

	:host( [ variant='holo' ][ busy ] ) button {
		animation: os-holo-drift 12s ease-in-out infinite;
	}
	@media ( prefers-reduced-motion: reduce ) {
		:host( [ variant='holo' ][ busy ] ) button {
			animation: none;
		}
	}
	.os-button__spinner {
		box-sizing: border-box;
		display: inline-block;
		width: 12px;
		height: 12px;
		border: 2px solid currentColor;
		border-right-color: transparent;
		border-radius: 50%;
		animation: os-button-spin 0.6s linear infinite;
		flex-shrink: 0;
	}
	@keyframes os-button-spin {
		to {
			transform: rotate( 360deg );
		}
	}
`;
