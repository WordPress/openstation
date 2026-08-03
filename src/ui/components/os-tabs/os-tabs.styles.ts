/**
 * Styles for `<os-tabs>` + `<os-tab>` + `<os-tabpanel>`. Three
 * exported stylesheets because each element adopts its own. Keeping
 * them in one file makes the visual decisions (underline accent,
 * tight spacing, panel focus outline) side-by-side.
 */
import { css } from '../../core';

export const tabsStyles = css`
	:host {
		display: flex;
		gap: 4px;
		margin-bottom: 10px;
		border-bottom: 1px solid var( --os-ui-border, #dcdcde );
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
		outline: 2px solid var( --wp-admin-theme-color, #2271b1 );
		outline-offset: 4px;
		border-radius: 4px;
	}
`;

export const tabStyles = css`
	:host {
		display: inline-block;
	}
	button {
		appearance: none;
		padding: 6px 10px;
		border: none;
		background: transparent;
		color: var( --os-ui-fg-muted, #50575e );
		font: inherit;
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		border-bottom: 2px solid transparent;
		margin-bottom: -1px;
		transition: color 0.15s ease, border-color 0.15s ease;
	}
	button:hover {
		color: var( --wp-admin-theme-color, #2271b1 );
	}
	button:focus-visible {
		outline: 2px solid var( --wp-admin-theme-color, #2271b1 );
		outline-offset: 2px;
	}
	:host( [ aria-selected='true' ] ) button {
		color: var( --wp-admin-theme-color, #2271b1 );
		border-bottom-color: var( --wp-admin-theme-color, #2271b1 );
	}
`;
