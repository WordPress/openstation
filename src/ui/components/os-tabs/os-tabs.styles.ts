/**
 * Styles for `<os-tabs>` + `<os-tab>` + `<os-tabpanel>`. Three
 * exported stylesheets because each element adopts its own. Keeping
 * them in one file makes the visual decisions (underline accent,
 * tight spacing, panel focus outline) side-by-side.
 */
import { css } from '../../core';
import { holoTokens } from '../../holo';

export const tabsStyles = css`
	:host {
		display: flex;
		gap: 4px;
		margin-bottom: 10px;
		border-bottom: 1px solid var( --os-ui-border, #dcdcde );
	}

	/*
	 * Vertical: a sidebar rather than a strip. The bottom border goes
	 * with it, because the boundary is now the column edge, and that
	 * belongs to whoever is laying the strip out.
	 *
	 * Rows sit flush against each other. The gap that separates one
	 * GROUP from the next is the only vertical space in the column, so
	 * it has to be the only thing that looks like one.
	 */
	:host( [ orientation='vertical' ] ) {
		flex-direction: column;
		align-items: stretch;
		gap: 0;
		margin-bottom: 0;
		border-bottom: 0;
	}
`;

export const tabPanelStyles = css`
	/*
	 * Shadow-DOM styles. :host targets the panel element; slotted
	 * light children flow through the single <slot> in the render.
	 * The :host([hidden]) rule spells out display: none because the
	 * :host block above sets display: block and that would otherwise
	 * beat the UA [hidden] { display: none } rule.
	 */
	:host {
		display: block;
	}
	:host( [ hidden ] ) {
		display: none;
	}
	:host( :focus-visible ) {
		outline: 2px solid var( --os-ui-accent, #2271b1 );
		outline-offset: 4px;
		border-radius: 4px;
	}
`;

/**
 * The selected tab's underline is the mesh.
 *
 * `border-bottom-color` takes a colour, so the underline is drawn as
 * an `::after` bar instead — which also lets it animate its width from
 * the centre out, and lets the mesh sit at the bar's own scale rather
 * than being stretched across a 2 px strip of a nine-layer gradient.
 *
 * The bar exists on every tab and is simply zero-width until the tab
 * is chosen. Growing an element that is already in the layout costs a
 * transform-adjacent repaint; inserting one on selection would cost a
 * layout pass and would arrive after the colour change rather than
 * with it.
 */
export const tabStyles = css`
	${ holoTokens }

	:host {
		display: inline-block;
	}
	/*
	 * Vertical tabs fill the sidebar so the whole row is the target,
	 * not just the label. data-orientation is stamped by the parent
	 * strip; see the note in os-tabs.ts about :host-context().
	 */
	:host( [ data-orientation='vertical' ] ) {
		display: block;
		/*
		 * The three layers of the selected row, read into private
		 * aliases so the palette and every desktop theme keep the last
		 * word on them. Never declare the public names here: see
		 * AGENTS.md, "Never declare a themeable token on a component's
		 * :host".
		 */
		--_tab-edge: var(
			--os-ui-tab-edge,
			linear-gradient( 90deg, #f252fc 7%, #aa67ff 48.3%, #a580ff 70.7%, #4b3eff 93% )
		);
		--_tab-wash: var(
			--os-ui-tab-wash,
			linear-gradient(
				90deg,
				rgba( 242, 82, 252, 0.16 ) 0%,
				rgba( 255, 251, 255, 0.04 ) 42%,
				transparent 100%
			)
		);
		--_tab-bloom: var(
			--os-ui-tab-bloom,
			linear-gradient( 90deg, rgba( 242, 82, 252, 0.26 ), transparent )
		);
	}
	/*
	 * A row, not a chip. Full-bleed to both edges of the sidebar so
	 * the accent can sit ON the boundary; the 20px inline-start
	 * padding is what holds the label off it. No radius for the same
	 * reason: a rounded row would pull the edge inward and leave a
	 * notch above and below it.
	 *
	 * 40px tall and 14px Regular: Body Small, straight off the brand
	 * guide. isolation confines the two pseudos below to this row.
	 */
	:host( [ data-orientation='vertical' ] ) button {
		display: flex;
		align-items: center;
		gap: 11px;
		isolation: isolate;
		width: 100%;
		min-height: 40px;
		padding: 0 14px 0 20px;
		margin-bottom: 0;
		border-radius: 0;
		text-align: start;
		font-size: 14px;
		font-weight: 400;
		line-height: 1.5;
		white-space: nowrap;
	}
	/*
	 * A leading icon, if the caller slotted one. Sized here rather
	 * than left to the SVG so a Core icon on a 24 grid and one of ours
	 * on the same grid land identically.
	 *
	 * Write slot::slotted() and never a bare ::slotted() after a
	 * descendant combinator. The implied universal in
	 * :host( ... ) ::slotted( svg ) is parsed as part of the same
	 * compound rather than as a selector for the slot, so the rule
	 * silently matches nothing: no error, no warning, just an unsized
	 * SVG that renders at its intrinsic size and turns a 40px row into
	 * an 86px one. Naming the slot element removes the ambiguity.
	 */
	:host( [ data-orientation='vertical' ] ) slot::slotted( svg ) {
		flex: 0 0 17px;
		width: 17px;
		height: 17px;
		opacity: 0.8;
		transition: opacity var( --_holo-t ) var( --_holo-ease );
	}
	:host( [ data-orientation='vertical' ] ) button:hover slot::slotted( svg ),
	:host( [ data-orientation='vertical' ][ aria-selected='true' ] )
		slot::slotted( svg ) {
		opacity: 1;
	}
	/*
	 * The accent moves from an underline to a leading edge: the mesh
	 * spent as a hairline rather than as a fill, because nine
	 * iridescent rows in a column is wallpaper.
	 *
	 * Both pseudos sit at z-index -1: inside the row's own stacking
	 * context that paints them above its background and below its
	 * label, which is exactly the order the three layers need.
	 */
	:host( [ data-orientation='vertical' ] ) button::after {
		inset-inline: 0 auto;
		inset-block: 0;
		z-index: -1;
		width: 2px;
		height: auto;
		border-radius: 0;
		background-image: var( --_tab-edge );
		transition: opacity var( --_holo-t ) var( --_holo-ease );
	}
	/* The bloom the edge throws back across the row. */
	:host( [ data-orientation='vertical' ] ) button::before {
		content: '';
		position: absolute;
		inset-inline: 0 auto;
		inset-block: 0;
		z-index: -1;
		width: 44px;
		background-image: var( --_tab-bloom );
		filter: blur( 8px );
		opacity: 0;
		pointer-events: none;
		transition: opacity var( --_holo-t ) var( --_holo-ease );
	}
	/*
	 * Hover is the label and its icon coming up to full strength, and
	 * nothing else. The horizontal strip grows a half-width underline
	 * to say "this one is about to be it", but a row that lights its
	 * own edge on hover competes with the row that already owns it:
	 * in a column the eye reads the two as both selected.
	 */
	:host( [ data-orientation='vertical' ] ) button:hover::after {
		inset-inline: 0 auto;
		opacity: 0;
	}
	:host( [ data-orientation='vertical' ][ aria-selected='true' ] ) button {
		background-image: var( --_tab-wash );
		/*
		 * No weight bump. Body Small is Regular, and the edge already
		 * says which row this is. A second signal only makes the
		 * column jitter as the selection moves.
		 */
		font-weight: 400;
	}
	/*
	 * inset-inline is restated, not inherited: the horizontal selected
	 * rule sets it to 0 to grow the underline out to the full width of
	 * the tab, and that same declaration would stretch this edge
	 * across the whole row.
	 */
	:host( [ data-orientation='vertical' ][ aria-selected='true' ] ) button::after,
	:host( [ data-orientation='vertical' ][ aria-selected='true' ] )
		button:hover::after {
		inset-inline: 0 auto;
		opacity: 1;
	}
	:host( [ data-orientation='vertical' ][ aria-selected='true' ] )
		button::before {
		opacity: 1;
	}
	@media ( prefers-reduced-motion: reduce ) {
		:host( [ data-orientation='vertical' ] ) button::before,
		:host( [ data-orientation='vertical' ] ) slot::slotted( svg ) {
			transition-duration: 1ms;
		}
	}
	button {
		appearance: none;
		position: relative;
		padding: 6px 10px 8px;
		border: none;
		background: transparent;
		color: var( --os-ui-fg-muted, #50575e );
		font: inherit;
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		margin-bottom: -1px;
		transition: color var( --_holo-t ) ease;
	}
	button::after {
		content: '';
		position: absolute;
		inset-inline: 50%;
		bottom: 0;
		height: 2px;
		border-radius: 2px 2px 0 0;
		background-image: var( --_holo-fill );
		background-size: 100% 100%;
		opacity: 0;
		transition: inset-inline var( --_holo-t ) ease, opacity var( --_holo-t ) ease;
	}
	button:hover {
		color: var( --os-ui-fg, #1d2327 );
	}
	/* Half-width on hover: enough to read as "this one is about to
	   be it" without competing with the tab that already is. */
	button:hover::after {
		inset-inline: 30%;
		opacity: 0.45;
	}
	button:focus-visible {
		outline: none;
		box-shadow: var( --_holo-focus );
		border-radius: 4px;
	}
	:host( [ aria-selected='true' ] ) button {
		color: var( --os-ui-fg, #1d2327 );
		font-weight: 600;
	}
	:host( [ aria-selected='true' ] ) button::after,
	:host( [ aria-selected='true' ] ) button:hover::after {
		inset-inline: 0;
		opacity: 1;
	}
	@media ( prefers-reduced-motion: reduce ) {
		button::after {
			transition-duration: 1ms;
		}
	}

`;
