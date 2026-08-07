import { css } from '../../core';
import { holoTokens, holoCheck } from '../../holo';

/**
 * Styles for the standalone checkbox. Paired-label counterpart lives
 * in `<os-checkbox-label>`; this component paints just the box so
 * callers can place labels above/beside/after freely.
 *
 * The box itself comes from `holoCheck` in `src/ui/holo.ts`, shared
 * with `<os-checkbox-label>` so the tick is the same tick in both. It
 * replaced `accent-color`, which is the right answer for a native
 * checkbox and the wrong one here: `accent-color` takes a colour, and
 * checked in this kit is the Holomesh. Size stays 16 px, the
 * WordPress admin's prevailing checkbox metric.
 */

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

	/* Opt-in full-width row.
	 *
	 * The default host is shrink-to-fit, which is right for a table
	 * cell or a box sitting beside its own <label for>. It is wrong
	 * in a stack of settings controls: <os-range-field> is a
	 * block-level flex row, so a checkbox between two sliders stops
	 * short of the panel edge and two checkboxes in a row land side
	 * by side instead of stacking.
	 *
	 * Only the host box goes full width. The inner <label> stays
	 * shrink-to-fit, so the hit area is still exactly the box plus
	 * its text — a row that toggles when clicked near the panel
	 * margin is a different complaint, and a worse one. The pointer
	 * cursor moves with the hit area for the same reason. */
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

	/* When no label is passed, collapse the label wrapper so the
	 * component is exactly one 16 px box — useful when the caller
	 * is supplying its own label elsewhere (a table cell, a
	 * separate <label for>, a settings row with a custom layout). */
	.os-checkbox__label:empty {
		display: none;
	}
`;
