import { css } from '../../core';

export const styles = css`
	:host {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		color: var( --wpd-fg, #1d2327 );
		cursor: pointer;
	}
	label {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		cursor: pointer;
	}
	input[ type='checkbox' ] {
		accent-color: var( --wp-admin-theme-color, #2271b1 );
		cursor: pointer;
	}
	:host( [ disabled ] ) {
		opacity: 0.5;
		cursor: not-allowed;
	}
	:host( [ disabled ] ) label,
	:host( [ disabled ] ) input[ type='checkbox' ] {
		cursor: not-allowed;
	}
`;
