import { css } from '../../core';

/**
 * Styles for the dropdown picker. Two stylesheets in one file —
 * one for the parent `<wpd-select>` (label + chrome), one for
 * `<wpd-option>` (hidden data carrier). Visual language matches
 * `<wpd-segmented>` so swapping the tag name inside a settings
 * panel doesn't create a visual discontinuity.
 *
 * The rendered chrome wraps a native `<select>` — the browser owns
 * the open/close popover, keyboard navigation, and type-ahead. We
 * only style the closed state and the focus ring so the component
 * inherits the OS's list UI (including the mobile full-screen
 * picker) for free.
 */

export const selectStyles = css`
	/*
	 * Host is block-level flex so the component fills its parent
	 * cell (grid row col=N, flex container, plain block container).
	 * Inline-flex was the 0.11 default, but stretched grid cells
	 * left the native <select> at its intrinsic width while the
	 * host spanned the full cell — the absolutely-positioned
	 * chevron then floated against the cell's right edge rather
	 * than hugging the select. Block-level flex removes the gap.
	 */
	:host {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 13px;
		color: var( --desktop-mode-text, #1d2327 );
		min-width: 0;
	}

	:host( [ hidden ] ) {
		display: none;
	}

	.wpd-select__label {
		font-size: 12px;
		color: var( --desktop-mode-muted, #646970 );
	}

	.wpd-select__wrap {
		position: relative;
		display: flex;
		align-items: center;
		width: 100%;
	}

	select {
		appearance: none;
		-webkit-appearance: none;
		display: block;
		width: 100%;
		min-width: 0;
		padding: 7px 28px 7px 12px;
		background: rgba( 0, 0, 0, 0.05 );
		border: 1px solid transparent;
		border-radius: 7px;
		font: inherit;
		font-size: 13px;
		color: var( --desktop-mode-text, #1d2327 );
		cursor: pointer;
		transition: background-color 0.12s ease, border-color 0.12s ease,
			box-shadow 0.12s ease;
	}

	select:hover {
		background: rgba( 0, 0, 0, 0.08 );
	}

	select:focus-visible {
		outline: none;
		border-color: var( --wp-admin-theme-color, #2271b1 );
		box-shadow: 0 0 0 1px var( --wp-admin-theme-color, #2271b1 );
	}

	select:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* Chevron — inline SVG sized to match the 12px viewBox.
	 * Positioned over the right edge of the native select so the
	 * caret is consistent across platforms. aria-hidden keeps it
	 * out of the accessibility tree; the native select retains its
	 * aria-label for screen readers. */
	.wpd-select__chevron {
		position: absolute;
		inset-inline-end: 10px;
		top: 50%;
		transform: translateY( -50% );
		pointer-events: none;
		color: var( --desktop-mode-muted, #646970 );
		display: inline-block;
	}

	/* Slight chevron tint on hover + focus — matches the select's
	 * own border transition so the two feel like one affordance. */
	select:hover ~ .wpd-select__chevron,
	select:focus-visible ~ .wpd-select__chevron {
		color: var( --desktop-mode-text, #1d2327 );
	}
`;

export const optionStyles = css`
	/*
	 * Data-carrier only — children of <wpd-select> that convey
	 * value + label. The parent reads textContent + the value
	 * attribute to build the native select; the element itself
	 * never paints.
	 */
	:host {
		display: none;
	}
`;
