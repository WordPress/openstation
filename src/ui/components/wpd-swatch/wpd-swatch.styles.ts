import { css } from '../../core';

/**
 * Two size variants:
 *
 *   - default  — fills the parent cell with a 4:3 rectangle.
 *                Used by the wallpaper grid, where each swatch
 *                mirrors the desktop's aspect at a smaller scale.
 *   - small    — fixed 32×32 circle.
 *                Used by the accent-color row. A fixed chip size
 *                works better with `mode="row"` on the grid (flex-
 *                wrap) and avoids the overflow you get from a 1fr
 *                column becoming ~120 px wide on an 820 px panel.
 *
 * Both variants respect the same selection + hover styling — only
 * the outer shape changes.
 */
export const styles = css`
	:host {
		display: block;
		width: 100%;
		aspect-ratio: 4 / 3;
	}
	:host( [ size='small' ] ) {
		display: inline-block;
		width: 32px;
		height: 32px;
		aspect-ratio: 1 / 1;
		flex: 0 0 auto;
	}
	/*
	 * Wallpaper variant: 16:9 aspect (matches most desktop
	 * displays), and positions slotted overlay content (e.g. a
	 * label chip) at the bottom-left so it reads like a
	 * photo-corner caption. Caller owns the label's own visual
	 * treatment — we just place it.
	 */
	:host( [ variant='wallpaper' ] ) {
		aspect-ratio: 16 / 9;
	}
	:host( [ variant='wallpaper' ] ) button {
		display: flex;
		align-items: flex-end;
		justify-content: flex-start;
		padding: 6px 8px;
		overflow: hidden;
	}
	button {
		appearance: none;
		/* Anchor absolutely-positioned slotted overlays (the wallpaper
		 * grid's live-preview layer) to the tile. */
		position: relative;
		width: 100%;
		height: 100%;
		padding: 0;
		border-radius: 10px;
		border: 2px solid transparent;
		cursor: pointer;
		background-color: #eee;
		background-size: cover;
		background-position: center;
		transition: transform 0.15s ease, border-color 0.15s ease,
			box-shadow 0.15s ease;
	}
	:host( [ size='small' ] ) button {
		border-radius: 50%;
	}
	button:hover {
		transform: scale( 1.04 );
	}
	button[ aria-pressed='true' ] {
		border-color: var( --wp-admin-theme-color, #2271b1 );
		box-shadow: 0 0 0 2px var( --wp-admin-theme-color, #2271b1 );
	}
	/*
	 * Wallpaper variant uses a softer lift to pair with the
	 * larger visible surface — hover scale on a 200 px tile can
	 * feel cartoonish.
	 */
	:host( [ variant='wallpaper' ] ) button:hover {
		transform: translateY( -1px );
	}
`;
