import { css } from '../../core';
import { holoTokens } from '../../holo';

export const styles = css`
	${ holoTokens }

	:host {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
		color: var( --os-ui-fg-muted, #646970 );
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
		border: 1px solid var( --os-ui-border, #c3c4c7 );
		border-radius: 6px;
		background: transparent;
		cursor: pointer;
		transition: border-color var( --_holo-t ) ease,
			box-shadow var( --_holo-t ) ease;
	}
	input[ type='color' ]:hover {
		border-color: var( --os-ui-border-strong, #8c8f94 );
	}
	/*
	 * The target ring, not the field one. A colour swatch is a small
	 * filled tile that could be any colour at all — including Pulse
	 * itself — so it needs the ring that carries a Void spacer and a
	 * bloom rather than the one that merely tints its own border.
	 */
	input[ type='color' ]:focus-visible {
		outline: none;
		box-shadow: var( --_holo-focus );
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
