import { css } from '../../core';

export const styles = css`
	:host {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		color: var( --desktop-mode-text, #1d2327 );
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
`;
