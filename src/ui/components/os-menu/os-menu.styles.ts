import { css } from '../../core';
import { holoTokens, holoEnter } from '../../holo';

/**
 * Menu / menu-item share a frame (padding, font, radius) but each
 * controls its own shadow root. Two exported stylesheets;
 * co-located so the visual language stays in one file.
 *
 * The menu arrives rather than appears: `holoEnter` scales it from 96%
 * on the spring curve. The origin is the top inline-start corner
 * rather than the centre, because a menu is anchored — growing from
 * the middle makes it look like it came from nowhere, growing from the
 * corner makes it look like it came from the thing that opened it.
 */

export const menuStyles = css`
	${ holoTokens }
	${ holoEnter }

	:host {
		display: block;
		animation: os-holo-enter var( --_holo-t ) var( --_holo-spring );
		transform-origin: top left;
		min-width: 220px;
		padding: 4px;
		background: var( --os-window-bg, #fff );
		/* Desktop-theme texture slot: unset resolves to none. */
		background-image: var( --os-ui-menu-bg-image, none );
		background-repeat: var( --os-ui-menu-bg-image-repeat, repeat );
		background-size: var( --os-ui-menu-bg-image-size, auto );
		background-position: var( --os-ui-menu-bg-image-position, center );
		color: var( --os-ui-fg, #1d2327 );
		border: 1px solid var( --os-window-border, #c3c4c7 );
		border-radius: 8px;
		box-shadow: 0 8px 24px rgba( 0, 0, 0, 0.18 ),
			0 2px 6px rgba( 0, 0, 0, 0.08 );
	}

	:host( :dir( rtl ) ) {
		transform-origin: top right;
	}

	@media ( prefers-reduced-motion: reduce ) {
		:host {
			animation: none;
		}
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
		background: var( --os-ui-hover, rgba( 0, 0, 0, 0.06 ) );
		color: var( --os-ui-fg, #000 );
		outline: none;
	}
	/*
	 * Inset, not the kit's outer ring. A menu item is flush against
	 * the popover's padding edge, so an outward ring is clipped on one
	 * side and reads as a broken box; an inset ring traces the item
	 * itself and is the only one that survives at the top and bottom
	 * of the list.
	 */
	button:focus-visible {
		outline: none;
		box-shadow: inset 0 0 0 2px var( --os-ui-accent, #2271b1 );
	}
	.os-menu-item__icon {
		flex-shrink: 0;
		width: 18px;
		height: 18px;
		font-size: 18px;
		line-height: 1;
		color: var( --wp-admin-theme-color, #2271b1 );
	}
	.os-menu-item__icon[ hidden ] {
		display: none;
	}
	.os-menu-item__label {
		flex: 1;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	/*
	 * Check indicator for role="menuitemcheckbox" variants. Small
	 * 16 px square so unchecked items align with icon-bearing items.
	 */
	.os-menu-item__check {
		flex-shrink: 0;
		width: 16px;
		height: 16px;
		border-radius: 3px;
		border: 1.5px solid var( --os-ui-border, rgba( 0, 0, 0, 0.25 ) );
		position: relative;
		background: transparent;
		transition: background-color 0.12s ease, border-color 0.12s ease;
	}
	.os-menu-item__check[ hidden ] {
		display: none;
	}
	/*
	 * A checked menu item's box is the same identity moment as a
	 * checked <os-checkbox>, and now wears the same mesh — through
	 * --os-ui-holo-fill, so the two cannot drift apart. The tick
	 * turns Void with it: every mesh in the brand is a light surface
	 * and the white tick that used to sit here would vanish.
	 */
	:host( [ checked ] ) .os-menu-item__check {
		background-color: transparent;
		background-image: var(
			--os-ui-holo-fill,
			linear-gradient( 124deg, #afa2e8 0%, #f5a8ea 46%, #8ee9f7 100% )
		);
		background-size: 200% 200%;
		background-position: 25% 30%;
		border-color: transparent;
		box-shadow: var(
			--os-ui-holo-glow,
			0 0 0 1px rgba( 242, 82, 252, 0.28 ), 0 2px 10px rgba( 242, 82, 252, 0.22 )
		);
	}
	:host( [ checked ] ) .os-menu-item__check::after {
		content: '';
		position: absolute;
		top: 1px;
		left: 4px;
		width: 4px;
		height: 8px;
		border: solid var( --os-ui-holo-ink, #0c0b0f );
		border-width: 0 2px 2px 0;
		transform: rotate( 45deg );
	}
`;
