/**
 * `<wpd-tag-input>` — shadow-DOM styles.
 *
 * Layout: a wrapping flex row of chips followed by either a "+ Add"
 * trigger button or, when expanded, an inline `<input>` with a
 * floating suggestions popover. The popover is absolutely positioned
 * relative to the editor span so it docks under the input regardless
 * of how the chip row wraps.
 */
import { css } from '../../core';

export const styles = css`
	:host {
		display: inline-flex;
		max-width: 100%;
	}

	.wpd-tag-input {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var( --wpd-tag-input-gap, 4px );
		padding: var( --wpd-tag-input-padding, 2px );
		min-height: 24px;
		max-width: 100%;
	}

	.wpd-tag-input__chips {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var( --wpd-tag-input-gap, 4px );
		min-width: 0;
	}

	/* The "+ Add" trigger is intentionally minimal — a single small
	 * button that doesn't compete with the chips. It expands into
	 * the inline input when clicked. */
	.wpd-tag-input__add {
		appearance: none;
		display: inline-flex;
		align-items: center;
		gap: 3px;
		padding: 1px 8px;
		min-height: 22px;
		font: inherit;
		font-size: 11px;
		font-weight: 500;
		line-height: 1;
		color: var( --wpd-tag-input-add-fg, #50575e );
		background: transparent;
		border: 1px dashed var( --wpd-tag-input-add-border, #c3c4c7 );
		border-radius: 999px;
		cursor: pointer;
		transition:
			background-color 0.12s ease,
			color 0.12s ease,
			border-color 0.12s ease;
	}
	.wpd-tag-input__add:hover:not( :disabled ) {
		background: rgba( 0, 0, 0, 0.04 );
		color: var( --wpd-tag-input-add-fg-hover, #1d2327 );
		border-color: var( --wpd-tag-input-add-border-hover, #8c8f94 );
	}
	.wpd-tag-input__add:focus-visible {
		outline: none;
		border-style: solid;
		box-shadow: 0 0 0 2px var( --wp-admin-theme-color, #2271b1 );
	}
	.wpd-tag-input__add:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.wpd-tag-input__add svg {
		display: block;
	}

	/* Editor — the inline input + the floating suggestions popover. */
	.wpd-tag-input__editor {
		position: relative;
		display: inline-flex;
		align-items: center;
		flex: 0 1 auto;
		min-width: 120px;
	}

	.wpd-tag-input__input {
		appearance: none;
		font: inherit;
		font-size: 12px;
		line-height: 1.4;
		padding: 2px 8px;
		border: 1px solid var( --wpd-tag-input-input-border, #2271b1 );
		border-radius: 999px;
		background: var( --wpd-tag-input-input-bg, #fff );
		color: var( --wpd-tag-input-input-fg, #1d2327 );
		min-width: 80px;
		max-width: 240px;
	}
	.wpd-tag-input__input:focus {
		outline: none;
		box-shadow: 0 0 0 2px
			color-mix(
				in srgb,
				var( --wp-admin-theme-color, #2271b1 ) 30%,
				transparent
			);
	}

	/* Popover — pinned to the editor, full width by default. Z-index
	 * is locked above wpd-table sticky-header (which sits at z-index
	 * ~3) but below the global toast layer (z-index ~10000). */
	.wpd-tag-input__suggestions {
		position: absolute;
		top: calc( 100% + 4px );
		left: 0;
		min-width: 220px;
		max-width: 320px;
		max-height: 240px;
		overflow-y: auto;
		padding: 4px 0;
		background: var( --wpd-tag-input-pop-bg, #fff );
		color: var( --wpd-tag-input-pop-fg, #1d2327 );
		border: 1px solid var( --wpd-tag-input-pop-border, #c3c4c7 );
		border-radius: 8px;
		box-shadow:
			0 6px 16px rgba( 0, 0, 0, 0.08 ),
			0 1px 2px rgba( 0, 0, 0, 0.06 );
		z-index: 50;
	}

	.wpd-tag-input__suggestion-item {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 12px;
		font-size: 13px;
		cursor: pointer;
		user-select: none;
	}
	.wpd-tag-input__suggestion-item[ aria-selected='true' ] {
		background: color-mix(
			in srgb,
			var( --wp-admin-theme-color, #2271b1 ) 10%,
			transparent
		);
		color: var( --wp-admin-theme-color, #2271b1 );
	}

	.wpd-tag-input__suggestion-create {
		font-style: italic;
		color: var( --wpd-tag-input-create-fg, #50575e );
		border-top: 1px solid var( --wpd-tag-input-pop-divider, #f0f0f1 );
	}
	.wpd-tag-input__suggestion-create[ aria-selected='true' ] {
		color: var( --wp-admin-theme-color, #2271b1 );
	}

	.wpd-tag-input__suggestion-empty,
	.wpd-tag-input__suggestion-loading {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 12px;
		font-size: 12px;
		color: var( --wpd-tag-input-pop-muted, #646970 );
	}

	.wpd-tag-input__suggestion-spinner {
		display: inline-block;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		border: 2px solid currentColor;
		border-top-color: transparent;
		animation: wpd-tag-input-spin 0.8s linear infinite;
	}

	@keyframes wpd-tag-input-spin {
		to {
			transform: rotate( 360deg );
		}
	}

	:host( [ disabled ] ) .wpd-tag-input {
		opacity: 0.6;
		pointer-events: none;
	}
`;
