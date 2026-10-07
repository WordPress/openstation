import { css } from '../../core';
import { holoTokens, holoCheck } from '../../holo';

export const styles = css`
	${ holoTokens }
	${ holoCheck }

	:host {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 13px;
		color: var( --os-ui-fg, #1d2327 );
		cursor: pointer;
	}

	:host( [ disabled ] ) {
		cursor: not-allowed;
		opacity: 0.55;
	}

	:host( [ block ] ) {
		display: flex;
		cursor: default;
	}

	:host( [ block ] ) label {
		cursor: pointer;
	}

	:host( [ block ][ disabled ] ) label {
		cursor: not-allowed;
	}

	label {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		cursor: inherit;
	}

	.os-checkbox__label {
		line-height: 1.3;
	}

	.os-checkbox__label:empty {
		display: none;
	}
`;
