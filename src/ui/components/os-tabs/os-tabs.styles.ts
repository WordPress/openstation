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
	 */
	:host( [ orientation='vertical' ] ) {
		flex-direction: column;
		align-items: stretch;
		gap: 2px;
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
	}
	:host( [ data-orientation='vertical' ] ) button {
		width: 100%;
		padding: 10px 14px;
		margin-bottom: 0;
		text-align: start;
		font-size: 13px;
		border-radius: 6px;
	}
	/*
	 * The accent moves from an underline to a leading edge: same mesh,
	 * same transition, grown from the middle of the row's height
	 * rather than the middle of its width.
	 */
	:host( [ data-orientation='vertical' ] ) button::after {
		inset-inline: 0 auto;
		inset-block: 50%;
		width: 2px;
		height: auto;
		border-radius: 0 2px 2px 0;
		transition: inset-block var( --_holo-t ) ease, opacity var( --_holo-t ) ease;
	}
	:host( [ data-orientation='vertical' ] ) button:hover::after {
		inset-block: 30%;
	}
	:host( [ data-orientation='vertical' ][ aria-selected='true' ] ) button::after {
		inset-block: 15%;
	}
	:host( [ data-orientation='vertical' ][ aria-selected='true' ] ) button {
		background: var( --os-ui-hover, rgba( 0, 0, 0, 0.05 ) );
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
