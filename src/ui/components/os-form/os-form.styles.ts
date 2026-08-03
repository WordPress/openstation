import { css } from '../../core';

/**
 * Styles for `<os-form>` — a container-query-driven responsive
 * form layout with an auto-rendered footer.
 *
 * The fields container is the queried context, so the grid responds
 * to the FORM's own width (not the viewport's). That's what makes
 * `<os-form>` "just work" inside a draggable / resizable native
 * window: stretch the window narrower and the form collapses to one
 * column without any host CSS.
 */
export const osFormStyles = css`
	/*
	 * The HOST is the named container — descendants (the .fields
	 * grid) read its inline-size via @container os-form. A
	 * container can't query its own size, so putting
	 * container-type on .fields would have been a no-op (the
	 * exact bug we hit on the first cut).
	 */
	:host {
		display: block;
		container-type: inline-size;
		container-name: os-form;
		font-size: 13px;
		color: var( --os-ui-fg, #1d2327 );
	}
	:host( [ hidden ] ) {
		display: none;
	}

	/* ---------- Header (caller-provided) ---------- */
	.header {
		margin: 0 0 18px;
	}
	.header:empty {
		display: none;
	}

	/* ---------- Fields grid ---------- */
	/*
	 * Default: one column. The @container rules below promote it
	 * to 2 (or 3, when columns=3) once the form is wide enough —
	 * driven by the FORM's own width, not the viewport's.
	 */
	.fields {
		display: grid;
		grid-template-columns: 1fr;
		gap: 14px 16px;
		margin: 0 0 18px;
	}

	@container os-form ( min-width: 480px ) {
		.fields {
			grid-template-columns: repeat( 2, minmax( 0, 1fr ) );
		}
	}
	@container os-form ( min-width: 760px ) {
		:host( [ columns="3" ] ) .fields {
			grid-template-columns: repeat( 3, minmax( 0, 1fr ) );
		}
	}

	/*
	 * Force-1-column override — useful for narrow side panes where
	 * the caller knows two columns will look cramped regardless of
	 * the available width.
	 */
	:host( [ columns="1" ] ) .fields {
		grid-template-columns: 1fr;
	}

	/*
	 * Always-2-column override — for the rare case where a host
	 * needs to ignore container width and force a two-up layout.
	 */
	:host( [ columns="2" ] ) .fields {
		grid-template-columns: repeat( 2, minmax( 0, 1fr ) );
	}

	/*
	 * Slotted children opt into spanning the entire row width via
	 * the [full-width] attribute. Works for any descendant — os-*
	 * fields, plain divs, or composite blocks like a password field
	 * paired with a "Generate" button.
	 */
	::slotted( [ full-width ] ) {
		grid-column: 1 / -1;
	}
	::slotted( [ slot ] ) {
		/* Named-slot children opt out of the grid entirely. */
		display: contents;
	}

	/* ---------- Top-of-form error banner ---------- */
	.error {
		margin: 0 0 14px;
		padding: 10px 12px;
		border-radius: 6px;
		background: var( --os-ui-notice-error-bg, rgba( 179, 45, 46, 0.10 ) );
		color: var( --os-ui-danger-hover, #b32d2e );
		font-size: 13px;
		line-height: 1.4;
	}
	.error[ hidden ] {
		display: none;
	}

	/* ---------- Footer ---------- */
	.footer {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		align-items: center;
		justify-content: flex-end;
		border-top: 1px solid var( --os-ui-border, #dcdcde );
		padding-top: 14px;
	}
	:host( [ align="start" ] ) .footer {
		justify-content: flex-start;
	}
	:host( [ align="stretch" ] ) .footer {
		justify-content: stretch;
	}
	:host( [ align="stretch" ] ) .footer .footer-actions {
		flex: 1 1 auto;
	}
	.footer-leading,
	.footer-trailing {
		display: contents;
	}
	.footer-actions {
		display: inline-flex;
		gap: 8px;
		align-items: center;
		margin-inline-start: auto;
	}
	:host( [ align="start" ] ) .footer-actions {
		margin-inline-start: 0;
	}

	/* ---------- Busy state ---------- */
	:host( [ busy ] ) {
		pointer-events: none;
	}
	:host( [ busy ] ) .fields {
		opacity: 0.6;
	}
	:host( [ busy ] ) .footer {
		pointer-events: auto;
	}
	.busy-spinner {
		display: inline-flex;
		width: 14px;
		height: 14px;
		border-radius: 50%;
		border: 2px solid currentColor;
		border-right-color: transparent;
		animation: os-form-spin 0.7s linear infinite;
		vertical-align: -2px;
		margin-inline-end: 6px;
	}
	@keyframes os-form-spin {
		to {
			transform: rotate( 360deg );
		}
	}
	@media ( prefers-reduced-motion: reduce ) {
		.busy-spinner {
			animation-duration: 2s;
		}
	}
`;
