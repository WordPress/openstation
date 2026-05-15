import { css } from '../../core';

export const userSearchStyles = css`
	:host {
		display: block;
		position: relative;
		font-size: 13px;
	}

	.input {
		width: 100%;
		padding: 8px 10px;
		background: var( --wpd-input-bg, rgba( 255, 255, 255, 0.06 ) );
		color: inherit;
		border: 1px solid rgba( 255, 255, 255, 0.12 );
		border-radius: 6px;
		font: inherit;
		box-sizing: border-box;
	}
	.input:focus {
		outline: 2px solid var( --wp-admin-theme-color, #2271b1 );
		outline-offset: -1px;
	}

	.dropdown {
		/* Inline style sets position: fixed + coords so the panel
		   escapes any overflow:auto ancestor (e.g. a modal body).
		   These rules cover the visual basics. */
		background: var( --desktop-mode-bg, #1d2327 );
		color: var( --desktop-mode-fg, #fff );
		border: 1px solid rgba( 255, 255, 255, 0.18 );
		border-radius: 6px;
		overflow: auto;
		z-index: 11000;
		box-shadow: 0 12px 32px rgba( 0, 0, 0, 0.5 );
	}

	.empty.error {
		color: #ff8080;
	}

	.item {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 10px;
		cursor: pointer;
		border: 0;
		background: transparent;
		color: inherit;
		width: 100%;
		text-align: start;
		font: inherit;
	}
	.item:hover,
	.item:focus {
		background: rgba( 255, 255, 255, 0.06 );
		outline: none;
	}

	.avatar {
		width: 24px;
		height: 24px;
		border-radius: 50%;
		flex: 0 0 auto;
		background: rgba( 255, 255, 255, 0.1 );
	}

	.name {
		font-weight: 500;
	}

	.slug {
		opacity: 0.6;
		font-size: 12px;
	}

	.empty {
		padding: 12px;
		color: rgba( 255, 255, 255, 0.5 );
		font-size: 12px;
	}
`;
