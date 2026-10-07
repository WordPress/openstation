import { css } from '../../core';

export const flyoutStyles = css`
	:host {
		display: block;
		position: absolute;
		z-index: 10;

		background: var(
			--os-ui-flyout-bg,
			var( --os-ui-surface-elevated, #ffffff )
		);

		background-image: var( --os-ui-panel-bg-image, none );
		background-repeat: var( --os-ui-panel-bg-image-repeat, repeat );
		background-size: var( --os-ui-panel-bg-image-size, auto );
		background-position: var( --os-ui-panel-bg-image-position, center );
		color: var( --os-ui-flyout-fg, var( --os-fg, #1d2327 ) );
		border-radius: 14px;
		box-shadow: var(
			--os-ui-flyout-shadow,
			0 16px 48px rgba( 0, 25, 53, 0.4 )
		);

		transform: translateX( 110% );
		opacity: 0;
		pointer-events: none;
		transition:
			transform 220ms cubic-bezier( 0.22, 1, 0.36, 1 ),
			opacity 180ms ease;
	}

	:host( [ open ] ) {
		transform: translateX( 0 );
		opacity: 1;
		pointer-events: auto;
	}

	:host( [ placement='end' ] ),
	:host( :not( [ placement ] ) ) {
		inset-block: 64px 14px;
		inset-inline-end: 14px;
		width: min( 320px, calc( 100% - 28px ) );
	}

	:host( [ placement='start' ] ) {
		inset-block: 64px 14px;
		inset-inline-start: 14px;
		width: min( 320px, calc( 100% - 28px ) );
		transform: translateX( -110% );
	}
	:host( [ placement='start' ][ open ] ) {
		transform: translateX( 0 );
	}

	:host( [ placement='top' ] ) {
		inset-block-start: 14px;
		inset-inline: 14px;
		max-block-size: calc( 100% - 28px );
		transform: translateY( -110% );
	}
	:host( [ placement='top' ][ open ] ) {
		transform: translateY( 0 );
	}

	:host-context( [ dir='rtl' ] ):host( [ placement='end' ] ),
	:host-context( [ dir='rtl' ] ):host( :not( [ placement ] ) ) {
		transform: translateX( -110% );
	}
	:host-context( [ dir='rtl' ] ):host( [ placement='end' ][ open ] ),
	:host-context( [ dir='rtl' ] ):host( :not( [ placement ] ) [ open ] ) {
		transform: translateX( 0 );
	}
	:host-context( [ dir='rtl' ] ):host( [ placement='start' ] ) {
		transform: translateX( 110% );
	}
	:host-context( [ dir='rtl' ] ):host( [ placement='start' ][ open ] ) {
		transform: translateX( 0 );
	}

	:host::before {
		content: '';
		position: fixed;
		inset: 0;
		background: var( --os-ui-flyout-backdrop, transparent );
		z-index: -1;
		pointer-events: none;
		transition: opacity 180ms ease;
		opacity: 0;
	}
	:host( [ open ] )::before {
		opacity: 1;
	}

	@media ( prefers-reduced-motion: reduce ) {
		:host {
			transition: none;
		}
		:host::before {
			transition: none;
		}
	}
`;
