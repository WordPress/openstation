import { css } from '../../core';

/**
 * Styles for the iOS-style segmented control. We ship TWO
 * stylesheets — one per child element — so each class can adopt
 * only the rules that apply to it. Keeping them in one file keeps
 * the visual decisions co-located (the parent pill + the inner
 * buttons share a visual language).
 */

export const segmentedStyles = css`
	:host {
		display: inline-flex;
		padding: 3px;
		background: rgba( 0, 0, 0, 0.05 );
		border-radius: 7px;
		gap: 2px;
	}
`;

export const segmentStyles = css`
	:host {
		flex: 1 1 auto;
		min-width: 0;
	}
	button {
		appearance: none;
		display: block;
		width: 100%;
		padding: 8px 12px;
		background: transparent;
		border: 0;
		font: inherit;
		font-size: 13px;
		color: var( --desktop-mode-muted, #646970 );
		cursor: pointer;
		border-radius: 5px;
		transition: background-color 0.12s ease, color 0.12s ease;
		/* Single-line labels — let the host grow horizontally to fit
		 * the widest segment instead of wrapping mid-word. The pill
		 * is naturally inline-flex so width follows content. */
		white-space: nowrap;
	}
	:host( [ aria-checked='true' ] ) button {
		background: var( --desktop-mode-window-bg, #fff );
		color: var( --desktop-mode-text, #1d2327 );
		box-shadow: 0 1px 3px rgba( 0, 0, 0, 0.12 );
		font-weight: 500;
	}
`;
