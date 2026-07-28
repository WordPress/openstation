import { css } from '../../core';

export const styles = css`
	:host {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
		color: var( --wpd-fg-muted, #646970 );
	}
	label {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}
	input[ type='color' ] {
		width: 28px;
		height: 28px;
		padding: 0;
		border: 1px solid var( --wpd-border, #c3c4c7 );
		border-radius: 6px;
		background: transparent;
		cursor: pointer;
	}
	/*
	 * Block variant: the host fills its parent, the input stretches
	 * to take the remaining row after the label. Used by the
	 * gradient editor where each field lives in a 1fr flex column.
	 */
	:host( [ variant='block' ] ) {
		display: flex;
		width: 100%;
	}
	:host( [ variant='block' ] ) label {
		display: flex;
		flex: 1;
		align-items: center;
	}
	:host( [ variant='block' ] ) input[ type='color' ] {
		flex: 1;
		width: auto;
		height: 32px;
	}
	/*
	 * WebKit paints the color swatch inside an extra wrapper with
	 * a default border — strip it in EVERY variant so the input
	 * reads as a single flat colored panel with our border, not a
	 * double frame.
	 */
	input[ type='color' ]::-webkit-color-swatch-wrapper {
		padding: 2px;
	}
	input[ type='color' ]::-webkit-color-swatch {
		border: none;
		border-radius: 2px;
	}
`;
