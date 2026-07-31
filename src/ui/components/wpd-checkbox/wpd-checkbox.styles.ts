import { css } from '../../core';

/**
 * Styles for the standalone checkbox. Paired-label counterpart lives
 * in `<wpd-checkbox-label>`; this component paints just the box so
 * callers can place labels above/beside/after freely.
 *
 * The native checkbox is styled via `accent-color` so it picks up the
 * active admin theme color. Size is fixed at 16 px to match the
 * WordPress admin's prevailing checkbox metrics.
 */

export const styles = css`
	:host {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 13px;
		color: var( --wpd-fg, #1d2327 );
		cursor: pointer;
	}

	:host( [ disabled ] ) {
		cursor: not-allowed;
		opacity: 0.55;
	}

	label {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		cursor: inherit;
	}

	input[ type='checkbox' ] {
		appearance: auto;
		-webkit-appearance: auto;
		accent-color: var( --wp-admin-theme-color, #2271b1 );
		width: 16px;
		height: 16px;
		margin: 0;
		cursor: inherit;
	}

	input[ type='checkbox' ]:focus-visible {
		outline: 2px solid var( --wp-admin-theme-color, #2271b1 );
		outline-offset: 2px;
	}

	.wpd-checkbox__label {
		line-height: 1.3;
	}

	/* When no label is passed, collapse the label wrapper so the
	 * component is exactly one 16 px box — useful when the caller
	 * is supplying its own label elsewhere (a table cell, a
	 * separate <label for>, a settings row with a custom layout). */
	.wpd-checkbox__label:empty {
		display: none;
	}
`;
