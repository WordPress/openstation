/**
 * `<wpd-context-menu>` + `<wpd-context-menu-option>` styles.
 * Visual language matches the wallpaper / tile menus that
 * preceded these components, so migrating doesn't change the
 * pixels — just the markup.
 */
import { css } from '../../core';

export const menuStyles = css`
	:host {
		display: none;
		position: fixed;
		min-width: 180px;
		/* Longhand on purpose: the texture slot below owns
		   background-image, and the shorthand would reset it. The
		   fallback must be a literal colour — --desktop-mode-bg is the
		   wallpaper token and can hold a gradient, which is invalid as
		   a background-color and would leave the menu transparent. */
		background-color: var( --wpd-context-menu-bg, #1d2327 );
		/* Desktop-theme texture slot: unset resolves to none. */
		background-image: var( --wpd-menu-bg-image, none );
		background-repeat: var( --wpd-menu-bg-image-repeat, repeat );
		background-size: var( --wpd-menu-bg-image-size, auto );
		background-position: var( --wpd-menu-bg-image-position, center );
		color: var( --wpd-context-menu-fg, var( --desktop-mode-fg, #fff ) );
		border: 1px solid var( --wpd-border, rgba( 255, 255, 255, 0.08 ) );
		border-radius: 8px;
		box-shadow: 0 8px 24px rgba( 0, 0, 0, 0.45 );
		padding: 4px;
		font-size: 13px;
		line-height: 1.3;
		z-index: 9999;
	}

	:host( [ open ] ) {
		display: block;
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
		background: var( --wpd-hover, rgba( 255, 255, 255, 0.1 ) );
		outline: none;
	}

	:host( [ disabled ] ) {
		opacity: 0.45;
		cursor: not-allowed;
	}

	/* The menu surface is always dark, so danger takes the LIFTED red
	   (--wpd-danger-hover) rather than --wpd-danger — the base red is
	   tuned to carry on a light surface and goes muddy here. */
	:host( [ danger ] ) {
		color: var( --wpd-danger-hover, #ff8a8a );
	}

	:host( [ danger ]:hover ) {
		background: var( --wpd-badge-danger-bg, rgba( 255, 90, 90, 0.18 ) );
	}

	:host( [ heading ] ) {
		padding: 8px 10px 4px;
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var( --wpd-context-menu-fg-muted, var( --wpd-fg-muted, rgba( 255, 255, 255, 0.5 ) ) );
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
