import { css } from '../../core';

export const styles = css`
	:host {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 12px;
		color: var( --os-ui-fg-muted, #646970 );
	}
	input[ type='range' ] {
		flex: 1;
		accent-color: var( --wp-admin-theme-color, #2271b1 );
	}
	.os-range-field__value {
		/* Fixed, not min-width: the readout shares a row with the
		   track, so a box that grows with its contents shoves the
		   slider sideways under the thumb the user is dragging. The
		   width comes from the range's own bounds — see
		   \`readoutWidth()\`. */
		width: var( --os-ui-range-readout-width, 3ch );
		flex: none;
		text-align: end;
		font-variant-numeric: tabular-nums;
		color: var( --os-ui-fg, #1d2327 );
	}
`;
