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
		background: var( --wpd-context-menu-bg, var( --desktop-mode-bg, #1d2327 ) );
		color: var( --wpd-context-menu-fg, var( --desktop-mode-fg, #fff ) );
		border: 1px solid rgba( 255, 255, 255, 0.08 );
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
		background: rgba( 255, 255, 255, 0.1 );
		outline: none;
	}

	:host( [ disabled ] ) {
		opacity: 0.45;
		cursor: not-allowed;
	}

	:host( [ danger ] ) {
		color: #ff8a8a;
	}

	:host( [ danger ]:hover ) {
		background: rgba( 255, 90, 90, 0.18 );
	}

	:host( [ heading ] ) {
		padding: 8px 10px 4px;
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var( --wpd-context-menu-fg-muted, rgba( 255, 255, 255, 0.5 ) );
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
		font-size: 14px;
		opacity: 0.7;
	}
`;
