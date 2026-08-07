import { css } from '../../core';
import { holoTokens, holoCheck } from '../../holo';

/**
 * `<os-checkbox-label>` — the opinionated label-row checkbox.
 *
 * The box is `holoCheck` from `src/ui/holo.ts`, the same fragment
 * `<os-checkbox>` uses: one tick, one mesh, one focus ring across
 * both. Swapping between the two components is then purely a layout
 * decision, which is the only difference they were ever meant to have.
 */
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
		/*
		 * A label row is a target, not a text run. Selecting the text
		 * on a fast double-toggle leaves the row highlighted and is
		 * never what anyone meant by clicking it twice.
		 */
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
