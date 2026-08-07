import { css } from '../../core';

/**
 * Styles for the native-window body wrapper.
 *
 * A os-body fills its parent edge-to-edge and stacks children in a
 * flex column with a default 12px vertical gap. Padding + scroll
 * behaviour are opt-in via attributes so a plugin that wants edge-
 * to-edge canvas (the calculator keypad, a Gutenberg surface) can
 * still use the component as a root without fighting it.
 *
 * The scroll switch (`scroll` attribute) sets `overflow: auto` on
 * the host so content taller than the window scrolls the body, not
 * the window frame. A window frame that scrolls drags the title
 * bar off-screen and feels wrong.
 */

export const styles = css`
	:host {
		display: flex;
		flex-direction: column;
		gap: var( --os-ui-body-gap, 12px );
		padding: var( --os-ui-body-padding, 16px );
		box-sizing: border-box;
		width: 100%;
		height: 100%;
		min-width: 0;
		min-height: 0;
	}

	:host( [ scroll ] ) {
		overflow: auto;
	}

	:host( [ hidden ] ) {
		display: none;
	}

	/*
	 * Children with a col attribute look like they should span a
	 * 12-column grid — but os-body itself is a flex column, not a
	 * grid. Plugin authors wanting 12-col layout wrap their
	 * children in a os-row. This rule catches the accidental
	 * "I put col on a os-body child" case and still renders the
	 * element full-width rather than squashed to nothing.
	 */
	::slotted( * ) {
		min-width: 0;
	}
`;
