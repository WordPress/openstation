import { css } from '../../core';

export const styles = css`
	:host {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 12px;
		color: var( --desktop-mode-muted, #646970 );
	}
	input[ type='range' ] {
		flex: 1;
		accent-color: var( --wp-admin-theme-color, #2271b1 );
	}
	.wpd-range-field__value {
		min-width: 3ch;
		text-align: end;
		font-variant-numeric: tabular-nums;
		color: var( --desktop-mode-text, #1d2327 );
	}
`;
