import { css } from '../../core';
import { holoTokens, holoCheck } from '../../holo';

export const styles = css`
	${ holoTokens }
	${ holoCheck }

	:host {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
		color: var( --os-ui-fg, #1d2327 );
		cursor: pointer;

		-webkit-user-select: none;
		user-select: none;
	}
	label {
		display: inline-flex;
		align-items: center;
		gap: 8px;
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
