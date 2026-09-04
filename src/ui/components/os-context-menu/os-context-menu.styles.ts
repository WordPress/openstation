/**
 * `<os-context-menu>` + `<os-context-menu-option>` styles.
 * Visual language matches the wallpaper / tile menus that
 * preceded these components, so migrating doesn't change the
 * pixels — just the markup.
 */
import { css } from '../../core';
import { holoTokens, holoEnter } from '../../holo';

export const menuStyles = css`
	${ holoTokens }
	${ holoEnter }

	:host {
		display: none;
		position: fixed;
		min-width: 180px;
		/* Longhand on purpose: the texture slot below owns
		   background-image, and the shorthand would reset it. The
		   fallback must be a literal colour — --os-bg is the
		   wallpaper token and can hold a gradient, which is invalid as
		   a background-color and would leave the menu transparent. */
		background-color: var( --os-ui-context-menu-bg, #1d2327 );
		/* Desktop-theme texture slot: unset resolves to none. */
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

	/*
	 * The menu grows from the pointer. Its top inline-start corner is
	 * placed at the click, so that corner is the one thing on screen
	 * the user is already looking at — scaling from the centre would
	 * have it expand back over the spot they just clicked.
	 *
	 * The animation hangs off [open] rather than off :host, because
	 * this component toggles display rather than mounting: a keyframe
	 * on the base rule would only ever run once, the first time the
	 * element was painted.
	 */
	:host( [ open ] ) {
		display: block;
		animation: os-holo-enter var( --_holo-t-fast ) var( --_holo-ease );
		transform-origin: top left;
		/*
		 * Never taller than the screen. A long menu on a phone — WP
		 * Explorer's item menu runs past twenty rows — used to open
		 * off the bottom edge with no way to reach the rest: the
		 * viewport clamp in menu-position.ts can only slide a box that
		 * fits. Capped to the viewport (the dynamic unit follows the
		 * phone's collapsing browser bar; the static one is the floor
		 * for engines without it), the menu scrolls inside itself and
		 * the clamp has a box it can place. Submenu flyouts are
		 * separate elements, so the overflow clips nothing of theirs.
		 */
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

	/* The menu surface is always dark, so danger takes the LIFTED red
	   (--os-ui-danger-hover) rather than --os-ui-danger — the base red is
	   tuned to carry on a light surface and goes muddy here. */
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
