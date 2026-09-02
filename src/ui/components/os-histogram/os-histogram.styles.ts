/**
 * `<os-histogram>` — shadow-DOM styles.
 *
 * Series colours resolve through the STATUS tokens (danger, warning,
 * info, success, accent, neutral) rather than a categorical palette,
 * so a desktop theme re-skins every chart for free and a series
 * named "error" is the same red as every other error surface.
 * Identity never rides colour alone: each legend chip pairs its
 * swatch with a label and a count, stacked segments carry a 2px gap
 * of surface, and the tooltip repeats every count as text.
 */
import { css } from '../../core';

export const styles = css`
	:host {
		display: block;
		position: relative;
		color: var( --os-ui-fg, #1d2327 );
		font-family: var(
			--os-ui-font,
			-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif
		);
		font-size: 12px;
	}

	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		flex-wrap: wrap;
		margin-block-end: 6px;
	}

	:host( :not( [legend] ):not( [heading] ) ) .head {
		display: none;
	}

	.heading {
		margin: 0;
		font-size: 13px;
		font-weight: 600;
		color: var( --os-ui-fg, #1d2327 );
	}

	.heading[hidden] {
		display: none;
	}

	.legend {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
		margin-inline-start: auto;
	}

	:host( :not( [legend] ) ) .legend {
		display: none;
	}

	.chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 3px 9px;
		border: 1px solid var( --os-ui-border, #dcdcde );
		border-radius: 999px;
		background: transparent;
		color: var( --os-ui-fg-muted, #646970 );
		font: inherit;
		cursor: pointer;
		transition: opacity 0.12s ease, border-color 0.12s ease;
	}

	.chip[aria-pressed='false'] {
		opacity: 0.45;
	}

	.chip:hover {
		border-color: var( --os-ui-border-strong, #8c8f94 );
		color: var( --os-ui-fg, #1d2327 );
	}

	.chip:focus-visible {
		outline: 2px solid var( --os-ui-accent, #2271b1 );
		outline-offset: 1px;
	}

	.count {
		font-variant-numeric: tabular-nums;
		color: var( --os-ui-fg, #1d2327 );
	}

	.swatch {
		display: inline-block;
		width: 10px;
		height: 10px;
		border-radius: 3px;
		flex: none;
	}

	.swatch,
	.seg {
		background: var( --_tone );
		fill: var( --_tone );
	}

	[data-tone='danger'] {
		--_tone: var( --os-ui-danger, #d63638 );
	}

	[data-tone='warning'] {
		--_tone: var( --os-ui-warning, #dba617 );
	}

	[data-tone='info'] {
		--_tone: var( --os-ui-info-fg, #72aee6 );
	}

	[data-tone='success'] {
		--_tone: var( --os-ui-success, #00a32a );
	}

	[data-tone='accent'] {
		--_tone: var( --os-ui-accent, #2271b1 );
	}

	[data-tone='neutral'] {
		--_tone: var( --os-ui-fg-muted, #646970 );
	}

	.chart {
		position: relative;
	}

	svg {
		display: block;
		inline-size: 100%;
	}

	.grid {
		stroke: var( --os-ui-border, #dcdcde );
		stroke-width: 1;
	}

	.tick {
		fill: var( --os-ui-fg-muted, #646970 );
		font-size: 10px;
		font-variant-numeric: tabular-nums;
	}

	.hit {
		fill: transparent;
		cursor: crosshair;
	}

	.hover {
		fill: var( --os-ui-surface-raised, rgba( 0, 0, 0, 0.04 ) );
		pointer-events: none;
	}

	.empty {
		padding: 40px 0;
		text-align: center;
		font-size: 13px;
		color: var( --os-ui-fg-muted, #646970 );
	}

	.tooltip {
		position: absolute;
		inset-block-start: 4px;
		transform: translateX( -50% );
		min-inline-size: 150px;
		padding: 8px 10px;
		border-radius: 6px;
		border: 1px solid var( --os-ui-border, #dcdcde );
		background: var( --os-ui-surface-elevated, #fff );
		box-shadow: var( --os-ui-shadow, 0 2px 8px rgba( 0, 0, 0, 0.15 ) );
		pointer-events: none;
		z-index: 2;
	}

	.tooltip[hidden] {
		display: none;
	}

	.tooltip-head {
		margin-block-end: 6px;
		color: var( --os-ui-fg-muted, #646970 );
		font-size: 11px;
	}

	.tooltip-row {
		display: flex;
		align-items: center;
		gap: 6px;
		line-height: 1.6;
	}

	.tooltip-label {
		flex: 1;
	}

	.tooltip-value {
		font-variant-numeric: tabular-nums;
		font-weight: 600;
	}
`;
