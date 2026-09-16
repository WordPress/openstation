import { css } from '../../core';
import { holoTokens } from '../../holo';

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
	${ holoTokens }

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
	 * Accent variant: the rounded square, at the guide's inner radius.
	 *
	 * A circle is the obvious shape for a colour chip and the wrong one
	 * here. Everything else in this panel that can be picked is a
	 * rounded rectangle (wallpaper tiles, theme cards, layout cards),
	 * so a row of discs read as a legend rather than as a row of
	 * choices. Slightly smaller than the plain small size for the same
	 * reason: a colour is the least of the decisions on this page.
	 */
	:host( [ variant='accent' ] ) {
		display: inline-block;
		width: 28px;
		height: 28px;
		aspect-ratio: 1 / 1;
		flex: 0 0 auto;
	}
	/*
	 * Both selectors name the small size as well, which is not
	 * redundant: the circle comes from the size-only button rule
	 * further down this sheet, and at equal specificity the later rule
	 * wins. Naming both attributes puts this one above it whatever the
	 * order.
	 */
	:host( [ size='small' ][ variant='accent' ] ) button {
		border-radius: 8px;
	}
	/*
	 * The accent chip's ring holds the surface colour as a gap between
	 * chip and ring, so the ring reads as drawn AROUND the colour
	 * rather than retinting its edge, which matters more here than on
	 * any tile, because the colour is the entire content.
	 */
	:host( [ size='small' ][ variant='accent' ] )
		button[ aria-pressed='true' ] {
		box-shadow: 0 0 0 2px var( --os-ui-surface-sunken, #f0f0f1 ),
			0 0 0 4px var( --os-ui-accent, #2271b1 );
	}
	/*
	 * Keyboard focus outranks the selection ring while it is visible.
	 * The focus ring is a strict superset of the selection ring's
	 * shape (gap, accent, bloom), so nothing is lost while it shows;
	 * without this the selected chip is the one chip focus cannot be
	 * seen on, because the selected rules above outrank the plain
	 * focus rule below.
	 */
	:host( [ size='small' ][ variant='accent' ] )
		button[ aria-pressed='true' ]:focus-visible {
		box-shadow: var( --_holo-focus );
	}
	/*
	 * Wallpaper variant: 16:10 aspect (the mockup's desk proportion),
	 * and positions slotted overlay content (e.g. a label chip) at the
	 * bottom-left so it reads like a photo-corner caption. Caller owns
	 * the label's own visual treatment; we just place it.
	 */
	:host( [ variant='wallpaper' ] ) {
		aspect-ratio: 16 / 10;
	}
	:host( [ variant='wallpaper' ] ) button {
		display: flex;
		align-items: flex-end;
		justify-content: flex-start;
		padding: 8px;
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
		/* The tile's base, visible wherever the swatch image is
		   transparent or still loading. A fixed light grey punched a
		   hole in a dark station, so it follows the surface ramp. */
		background-color: var( --os-ui-surface-sunken, #eee );
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
	button:focus-visible {
		outline: none;
		box-shadow: var( --_holo-focus );
	}
	/*
	 * Chosen. Two layers, and the palette decides how much of each
	 * shows: a flat accent ring whose width is a token (2px unless the
	 * palette says otherwise), and a lift (a stroke plus a shadow)
	 * that is nothing unless the palette declares one. The OpenStation
	 * palette sets the ring to 0 and lifts the tile instead; Legacy
	 * keeps the ring. Never the mesh either way: the brand reserves
	 * meshes for hero surfaces, and a grid of iridescent tiles is
	 * wallpaper.
	 *
	 * box-shadow rather than border so both layers sit OUTSIDE the
	 * tile, which matters for a wallpaper swatch: the artwork is the
	 * content, and a ring drawn on top of it would crop the thing the
	 * user is choosing.
	 */
	button[ aria-pressed='true' ] {
		border-color: transparent;
		box-shadow: 0 0 0 var( --os-ui-swatch-ring-width, 2px ) var( --os-ui-accent, #2271b1 ),
			var( --os-ui-swatch-lift, 0 0 0 0 transparent );
	}
	/*
	 * The badge: a disc with the tick punched out of it, so the tile's
	 * own artwork shows through the tick and one colour is enough. It
	 * is drawn on every chosen tile and painted from a token with a
	 * transparent fallback, which is how a palette that marks its
	 * selection with a ring gets no badge without knowing this exists.
	 * Not on the accent chips: the ring is the whole statement there.
	 */
	:host( :not( [ variant='accent' ] ) ) button[ aria-pressed='true' ]::after {
		content: '';
		position: absolute;
		top: 6px;
		inset-inline-end: 6px;
		width: 18px;
		height: 18px;
		border-radius: 50%;
		background: var( --os-ui-swatch-badge-bg, transparent );
		pointer-events: none;
		-webkit-mask: url( "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 12.5l4 4 8-9'/%3E%3C/svg%3E" )
				center / 12px no-repeat,
			linear-gradient( #000 0 0 );
		-webkit-mask-composite: xor;
		mask: url( "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 12.5l4 4 8-9'/%3E%3C/svg%3E" )
				center / 12px no-repeat,
			linear-gradient( #000 0 0 );
		mask-composite: exclude;
	}
	/* See the accent-variant note: focus wins while it is visible. */
	button[ aria-pressed='true' ]:focus-visible {
		box-shadow: var( --_holo-focus );
	}
	/*
	 * Wallpaper variant uses a softer lift to pair with the
	 * larger visible surface — hover scale on a 200 px tile can
	 * feel cartoonish.
	 */
	:host( [ variant='wallpaper' ] ) button:hover {
		transform: translateY( -2px );
	}
`;
