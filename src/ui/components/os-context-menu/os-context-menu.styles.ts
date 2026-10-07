import { css } from '../../core';
import { holoTokens, holoEnter } from '../../holo';

export const menuStyles = css`
	${ holoTokens }
	${ holoEnter }

	:host {
		display: none;
		position: fixed;
		min-width: 180px;

		background-color: var( --os-ui-context-menu-bg, #1d2327 );

		background-image: var( --os-ui-menu-bg-image, none );
		background-repeat: var( --os-ui-menu-bg-image-repeat, repeat );
		background-size: var( --os-ui-menu-bg-image-size, auto );
		background-position: var( --os-ui-menu-bg-image-position, center );
		color: var( --os-ui-context-menu-fg, var( --os-fg, #fff ) );
		border: 1px solid var( --os-ui-border, rgba( 255, 255, 255, 0.08 ) );
		border-radius: 8px;
		box-shadow: 0 8px 24px rgba( 0, 0, 0, 0.45 );
		padding: 4px;
		font-size: 13px;
		line-height: 1.3;
		z-index: 9999;
	}

	:host( [ open ] ) {
		display: block;
		animation: os-holo-enter var( --_holo-t-fast ) var( --_holo-ease );
		transform-origin: top left;

		box-sizing: border-box;
		max-block-size: calc( 100vh - 16px );
		max-block-size: calc( 100dvh - 16px );
		overflow-y: auto;
		overscroll-behavior: contain;
		-webkit-overflow-scrolling: touch;
	}

	:host( [ open ]:dir( rtl ) ) {
		transform-origin: top right;
	}

	@media ( prefers-reduced-motion: reduce ) {
		:host( [ open ] ) {
			animation: none;
		}
	}
`;

export const optionStyles = css`
	:host {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 8px 10px;
		border: 0;
		background: transparent;
		color: inherit;
		text-align: start;
		cursor: pointer;
		border-radius: 4px;
		box-sizing: border-box;
		user-select: none;
	}

	:host( :hover ),
	:host( [ active ] ) {
		background: var( --os-ui-hover, rgba( 255, 255, 255, 0.1 ) );
		outline: none;
	}

	:host( [ disabled ] ) {
		opacity: 0.45;
		cursor: not-allowed;
	}

	:host( [ danger ] ) {
		color: var( --os-ui-danger-hover, #ff8a8a );
	}

	:host( [ danger ]:hover ) {
		background: var( --os-ui-badge-danger-bg, rgba( 255, 90, 90, 0.18 ) );
	}

	:host( [ heading ] ) {
		padding: 8px 10px 4px;
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var( --os-ui-context-menu-fg-muted, var( --os-ui-fg-muted, rgba( 255, 255, 255, 0.5 ) ) );
		pointer-events: none;
	}

	.icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-size: 18px;
		width: 20px;
		height: 20px;
	}

	.label {
		flex: 1;
	}

	.chevron {
		margin-inline-start: auto;
		padding-inline-start: 8px;
		font-size: 16px;
		line-height: 1;
		opacity: 0.7;
	}

	.check {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 14px;
		font-size: 13px;
		line-height: 1;
		opacity: 0.95;
	}
`;
