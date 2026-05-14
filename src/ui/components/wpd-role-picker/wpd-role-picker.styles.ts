import { css } from '../../core';

export const rolePickerStyles = css`
	:host {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		font-size: 13px;
	}

	.chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 4px 10px;
		border-radius: 999px;
		background: rgba( 255, 255, 255, 0.06 );
		color: inherit;
		border: 1px solid rgba( 255, 255, 255, 0.12 );
		cursor: pointer;
		font: inherit;
	}
	.chip:hover {
		background: rgba( 255, 255, 255, 0.12 );
	}
	.chip[ aria-pressed='true' ] {
		background: var( --wp-admin-theme-color, #2271b1 );
		border-color: var( --wp-admin-theme-color, #2271b1 );
		color: #fff;
	}

	.empty {
		color: rgba( 255, 255, 255, 0.5 );
		font-size: 12px;
	}
`;
