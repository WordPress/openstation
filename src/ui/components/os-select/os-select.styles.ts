import { css } from '../../core';
import { holoTokens } from '../../holo';

/**
 * Styles for the dropdown picker. Two stylesheets in one file —
 * one for the parent `<os-select>` (label + trigger + popup), one
 * for `<os-option>` (hidden data carrier). Visual language matches
 * `<os-segmented>` so swapping the tag name inside a settings
 * panel doesn't create a visual discontinuity.
 *
 * The popup is the component's own listbox in the top layer (see
 * the class docblock for why), so the open state wears the station:
 * an Obsidian panel, Astro border, and the accent on the active row
 * — the same accent every selected control in the kit resolves
 * through.
 */

export const selectStyles = css`
	${ holoTokens }

	/*
	 * Host is block-level flex so the component fills its parent
	 * cell (grid row col=N, flex container, plain block container).
	 * The 8px gap is the label-to-field step of the space scale; the
	 * label used to sit 4px off the field and read as touching it.
	 */
	:host {
		display: flex;
		flex-direction: column;
		gap: 8px;
		font-size: 13px;
		color: var( --os-ui-fg, #1d2327 );
		min-width: 0;
	}

	:host( [ hidden ] ) {
		display: none;
	}

	.os-select__label {
		font-size: 13px;
		line-height: 1.5;
		color: var( --os-ui-fg-muted, #646970 );
	}

	.os-select__trigger {
		appearance: none;
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		min-width: 0;
		padding: 8px 12px;
		background: var( --os-ui-hover, rgba( 0, 0, 0, 0.05 ) );
		border: 1px solid transparent;
		border-radius: 8px;
		font: inherit;
		font-size: 13px;
		line-height: 1.5;
		color: var( --os-ui-fg, #1d2327 );
		text-align: start;
		cursor: pointer;
		transition: background-color var( --_holo-t ) ease,
			border-color var( --_holo-t ) ease,
			box-shadow var( --_holo-t ) ease;
	}

	.os-select__trigger:hover:not( :disabled ) {
		background: var( --os-ui-hover, rgba( 0, 0, 0, 0.08 ) );
		border-color: var( --os-ui-border-strong, #8c8f94 );
	}

	.os-select__trigger:focus,
	.os-select__trigger:focus-visible {
		outline: none;
		border-color: var( --os-ui-accent, #2271b1 );
		box-shadow: var( --_holo-focus-field );
	}

	.os-select__trigger:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/*
	 * Plain: the picker as a row's trailing control rather than as a
	 * field of its own.
	 *
	 * A settings list already draws the container — one box, hairlines
	 * between rows — so a bordered, filled field inside each row draws
	 * a second box around a value that has no label of its own to sit
	 * under. macOS Control Center is the reference: the value reads as
	 * the row's answer, and the chrome only appears under the pointer.
	 *
	 * Shrinks to its content and hugs the trailing edge, which is what
	 * lets a row put it opposite the title without a grid.
	 */
	:host( [ plain ] ) {
		display: inline-flex;
		flex-direction: row;
		align-items: center;
	}

	/*
	 * The visible label goes, the accessible one stays: the host
	 * mirrors the label prop onto aria-label, so a plain picker still
	 * announces which row it answers for. Pass the row's own title as
	 * the label — it is the control's name whether or not it is drawn
	 * twice.
	 */
	:host( [ plain ] ) .os-select__label {
		display: none;
	}

	:host( [ plain ] ) .os-select__trigger {
		width: auto;
		padding: 4px 6px;
		background: transparent;
		border-color: transparent;
		border-radius: 6px;
	}

	:host( [ plain ] ) .os-select__trigger:hover:not( :disabled ) {
		background: var( --os-ui-hover, rgba( 0, 0, 0, 0.05 ) );
		border-color: transparent;
	}

	/* The ring still lands: a keyboard user has to find this. */
	:host( [ plain ] ) .os-select__trigger:focus,
	:host( [ plain ] ) .os-select__trigger:focus-visible {
		border-color: var( --os-ui-accent, #2271b1 );
	}

	:host( [ plain ] ) .os-select__value {
		flex: 0 1 auto;
	}

	.os-select__value {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.os-select__value--placeholder {
		color: var( --os-ui-fg-muted, #646970 );
	}

	.os-select__chevron {
		flex: 0 0 auto;
		pointer-events: none;
		color: var( --os-ui-fg-muted, #646970 );
	}

	.os-select__trigger:hover .os-select__chevron {
		color: var( --os-ui-fg, #1d2327 );
	}

	/* On focus it goes all the way to the accent, so the caret agrees
	   with the ring instead of staying grey inside a lit field. */
	.os-select__trigger:focus .os-select__chevron,
	.os-select__trigger:focus-visible .os-select__chevron {
		color: var( --os-ui-accent, #2271b1 );
	}

	/*
	 * The popup. A top-layer popover, so the UA gives it
	 * display: none until shown and we position it with inline
	 * left/top measured from the trigger. inset: auto clears the
	 * UA's centering; the margin reset clears its auto margins.
	 *
	 * Obsidian panel, Astro border, inner radius: the same surface
	 * grammar as every flyout in the shell.
	 */
	.os-select__popup {
		position: fixed;
		inset: auto;
		margin: 0;
		max-height: min( 320px, 60vh );
		overflow-y: auto;
		padding: 4px;
		background: var( --os-ui-surface, #fff );
		border: 1px solid var( --os-ui-border, #dcdcde );
		border-radius: 8px;
		box-shadow: 0 12px 32px rgba( 0, 0, 0, 0.45 );
		color: var( --os-ui-fg, #1d2327 );
	}

	/*
	 * Fallback path (no Popover API): the popup is a plain block
	 * under the trigger, shown by the data-open attribute the
	 * component stamps. position: absolute against the host, which
	 * keeps it attached inside scrolling panes; without the top
	 * layer it can be clipped by an ancestor's overflow, which is
	 * the accepted cost of the fallback.
	 *
	 * TWO rules, and that is the whole point. Chained into one
	 * selector, an engine that has never heard of :popover-open throws
	 * the whole thing out as invalid — and that is exactly the engine
	 * on the fallback path, so every select on it rendered its option
	 * list permanently open.
	 *
	 * Apart, the hide rule is valid everywhere and the re-show rule is
	 * the one that gets dropped where it means nothing. Equal
	 * specificity, so source order decides: hide unless the component
	 * stamped data-open, then let an open popover out again.
	 */
	.os-select__popup:not( [ data-open ] ) {
		display: none;
	}

	.os-select__popup:popover-open {
		display: block;
	}

	.os-select__popup[ data-open ] {
		position: absolute;
		top: calc( 100% + 4px );
		left: 0;
		min-width: 100%;
		z-index: 1000;
	}

	:host {
		position: relative;
	}

	.os-select__option {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 7px 10px;
		border-radius: 6px;
		font-size: 13px;
		line-height: 1.5;
		cursor: pointer;
		white-space: nowrap;
	}

	/*
	 * The check column is always reserved, so labels align whether
	 * or not a row is the chosen one — the native menu does the
	 * same. Only the selected row's check is visible.
	 */
	.os-select__check {
		flex: 0 0 auto;
		visibility: hidden;
	}

	.os-select__option[ aria-selected='true' ] .os-select__check {
		visibility: visible;
	}

	/*
	 * The active row wears the accent: keyboard (data-active) and
	 * pointer (hover) resolve to the same look, and the on-accent
	 * ink keeps the label readable on it.
	 */
	.os-select__option[ data-active ],
	.os-select__option:hover {
		background: var( --os-ui-accent, #2271b1 );
		color: var( --os-ui-fg-on-accent, #fff );
	}

	.os-select__option[ aria-disabled='true' ] {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.os-select__option[ aria-disabled='true' ]:hover {
		background: transparent;
		color: inherit;
	}

	@media ( prefers-reduced-motion: reduce ) {
		.os-select__trigger {
			transition-duration: 1ms;
		}
	}
`;

export const optionStyles = css`
	/*
	 * Data-carrier only — children of <os-select> that convey
	 * value + label. The parent reads textContent + the value
	 * attribute to build its listbox; the element itself never
	 * paints.
	 */
	:host {
		display: none;
	}
`;
