/**
 * `<os-tag-input>` — shadow-DOM styles.
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

	.os-tag-input {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var( --os-ui-tag-input-gap, 4px );
		padding: var( --os-ui-tag-input-padding, 2px );
		min-height: 24px;
		max-width: 100%;
	}

	.os-tag-input__chips {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var( --os-ui-tag-input-gap, 4px );
		min-width: 0;
	}

	/* The "+ Add" trigger is intentionally minimal — a single small
	 * button that doesn't compete with the chips. It expands into
	 * the inline input when clicked. */
	.os-tag-input__add {
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
		color: var( --os-ui-tag-input-add-fg, var( --os-ui-fg-muted, #50575e ) );
		background: transparent;
		border: 1px dashed var( --os-ui-tag-input-add-border, var( --os-ui-border, #c3c4c7 ) );
		border-radius: 999px;
		cursor: pointer;
		transition:
			background-color 0.12s ease,
			color 0.12s ease,
			border-color 0.12s ease;
	}
	.os-tag-input__add:hover:not( :disabled ) {
		background: var( --os-ui-hover, rgba( 0, 0, 0, 0.04 ) );
		color: var( --os-ui-tag-input-add-fg-hover, var( --os-ui-fg, #1d2327 ) );
		border-color: var( --os-ui-tag-input-add-border-hover, var( --os-ui-border-strong, #8c8f94 ) );
	}
	.os-tag-input__add:focus-visible {
		outline: none;
		border-style: solid;
		box-shadow: 0 0 0 2px var( --wp-admin-theme-color, #2271b1 );
	}
	.os-tag-input__add:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.os-tag-input__add svg {
		display: block;
	}

	/* Editor — the inline input + the floating suggestions popover. */
	.os-tag-input__editor {
		position: relative;
		display: inline-flex;
		align-items: center;
		flex: 0 1 auto;
		min-width: 120px;
	}

	.os-tag-input__input {
		appearance: none;
		font: inherit;
		font-size: 12px;
		line-height: 1.4;
		padding: 2px 8px;
		border: 1px solid var( --os-ui-tag-input-input-border, var( --os-ui-border, #2271b1 ) );
		border-radius: 999px;
		background: var( --os-ui-tag-input-input-bg, var( --os-ui-surface, #fff ) );
		color: var( --os-ui-tag-input-input-fg, var( --os-ui-fg, #1d2327 ) );
		min-width: 80px;
		max-width: 240px;
	}
	.os-tag-input__input:focus {
		outline: none;
		box-shadow: 0 0 0 2px
			color-mix(
				in srgb,
				var( --wp-admin-theme-color, #2271b1 ) 30%,
				transparent
			);
	}

	/* Popover — pinned to the editor, full width by default. Z-index
	 * is locked above os-table sticky-header (which sits at z-index
	 * ~3) but below the global toast layer (z-index ~10000). */
	.os-tag-input__suggestions {
		position: absolute;
		top: calc( 100% + 4px );
		left: 0;
		min-width: 220px;
		max-width: 320px;
		max-height: 240px;
		overflow-y: auto;
		padding: 4px 0;
		background: var( --os-ui-tag-input-pop-bg, var( --os-ui-surface, #fff ) );
		color: var( --os-ui-tag-input-pop-fg, var( --os-ui-fg, #1d2327 ) );
		border: 1px solid var( --os-ui-tag-input-pop-border, var( --os-ui-border, #c3c4c7 ) );
		border-radius: 8px;
		box-shadow:
			0 6px 16px rgba( 0, 0, 0, 0.08 ),
			0 1px 2px rgba( 0, 0, 0, 0.06 );
		z-index: 50;
	}

	.os-tag-input__suggestion-item {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 12px;
		font-size: 13px;
		cursor: pointer;
		user-select: none;
	}
	.os-tag-input__suggestion-item[ aria-selected='true' ] {
		background: color-mix(
			in srgb,
			var( --wp-admin-theme-color, #2271b1 ) 10%,
			transparent
		);
		color: var( --wp-admin-theme-color, #2271b1 );
	}

	.os-tag-input__suggestion-create {
		font-style: italic;
		color: var( --os-ui-tag-input-create-fg, var( --os-ui-fg-muted, #50575e ) );
		border-top: 1px solid var( --os-ui-tag-input-pop-divider, var( --os-ui-border, #f0f0f1 ) );
	}
	.os-tag-input__suggestion-create[ aria-selected='true' ] {
		color: var( --wp-admin-theme-color, #2271b1 );
	}

	.os-tag-input__suggestion-empty,
	.os-tag-input__suggestion-loading {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 12px;
		font-size: 12px;
		color: var( --os-ui-tag-input-pop-muted, var( --os-ui-fg-muted, #646970 ) );
	}

	.os-tag-input__suggestion-spinner {
		display: inline-block;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		border: 2px solid currentColor;
		border-top-color: transparent;
		animation: os-tag-input-spin 0.8s linear infinite;
	}

	@keyframes os-tag-input-spin {
		to {
			transform: rotate( 360deg );
		}
	}

	:host( [ disabled ] ) .os-tag-input {
		opacity: 0.6;
		pointer-events: none;
	}
`;
