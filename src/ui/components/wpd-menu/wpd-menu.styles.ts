import { css } from '../../core';

/**
 * Menu / menu-item share a frame (padding, font, radius) but each
 * controls its own shadow root. Two exported stylesheets;
 * co-located so the visual language stays in one file.
 */

export const menuStyles = css`
	:host {
		display: block;
		min-width: 220px;
		padding: 4px;
		background: var( --desktop-mode-window-bg, #fff );
		color: var( --wpd-fg, #1d2327 );
		border: 1px solid var( --desktop-mode-window-border, #c3c4c7 );
		border-radius: 8px;
		box-shadow: 0 8px 24px rgba( 0, 0, 0, 0.18 ),
			0 2px 6px rgba( 0, 0, 0, 0.08 );
	}
	:host( [ hidden ] ) {
		display: none;
	}
`;

export const menuItemStyles = css`
	:host {
		display: block;
	}
	button {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		min-height: 32px;
		padding: 6px 10px;
		border: none;
		border-radius: 6px;
		background: transparent;
		color: inherit;
		font: inherit;
		font-size: 13px;
		line-height: 1.3;
		text-align: start;
		cursor: pointer;
		transition: background-color 0.12s ease, color 0.12s ease;
	}
	button:hover,
	button:focus-visible {
		background: var( --wpd-hover, rgba( 0, 0, 0, 0.06 ) );
		color: var( --wpd-fg, #000 );
		outline: none;
	}
	button:focus-visible {
		outline: 2px solid var( --wp-admin-theme-color, #2271b1 );
		outline-offset: -2px;
	}
	.wpd-menu-item__icon {
		flex-shrink: 0;
		width: 18px;
		height: 18px;
		font-size: 18px;
		line-height: 1;
		color: var( --wp-admin-theme-color, #2271b1 );
	}
	.wpd-menu-item__icon[ hidden ] {
		display: none;
	}
	.wpd-menu-item__label {
		flex: 1;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	/*
	 * Check indicator for role="menuitemcheckbox" variants. Small
	 * 16 px square so unchecked items align with icon-bearing items.
	 */
	.wpd-menu-item__check {
		flex-shrink: 0;
		width: 16px;
		height: 16px;
		border-radius: 3px;
		border: 1.5px solid var( --wpd-border, rgba( 0, 0, 0, 0.25 ) );
		position: relative;
		background: transparent;
		transition: background-color 0.12s ease, border-color 0.12s ease;
	}
	.wpd-menu-item__check[ hidden ] {
		display: none;
	}
	:host( [ checked ] ) .wpd-menu-item__check {
		background: var( --wp-admin-theme-color, #2271b1 );
		border-color: var( --wp-admin-theme-color, #2271b1 );
	}
	:host( [ checked ] ) .wpd-menu-item__check::after {
		content: '';
		position: absolute;
		top: 1px;
		left: 4px;
		width: 4px;
		height: 8px;
		border: solid var( --wpd-fg-on-accent, #fff );
		border-width: 0 2px 2px 0;
		transform: rotate( 45deg );
	}
`;
