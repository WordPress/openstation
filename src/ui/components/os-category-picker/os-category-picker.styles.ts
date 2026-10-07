import { css } from '../../core';

export const styles = css`
	:host {
		display: flex;
		width: 100%;
		min-width: 0;
		max-width: 100%;
		align-items: stretch;
	}

	.os-cat {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 4px;
		padding: var( --os-ui-cat-padding, 2px );
		min-height: 24px;
		max-width: 100%;
		width: 100%;
	}

	.os-cat__chips {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var( --os-ui-cat-gap, 4px );
		min-width: 0;
	}

	.os-cat__chains {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		min-width: 0;
	}

	.os-cat__viz-host {
		display: flex;
		align-items: center;
		gap: 4px;
		min-width: 0;
		flex: 1 1 auto;
		max-width: 100%;
		min-height: 28px;
		cursor: pointer;
		position: relative;
	}

	.os-cat__viz-svg {
		display: block;
		width: 100%;
		max-width: 100%;
		min-width: 0;
		overflow: visible;
		flex: 1 1 auto;
	}

	.os-cat__viz-svg .os-cat-edge {
		fill: none;
		stroke: var( --os-ui-cat-edge-color, currentColor );
		stroke-width: 1.25;
		stroke-linecap: round;
		opacity: 0.55;
		transition: stroke-width 0.18s ease, opacity 0.18s ease;
	}
	.os-cat__viz-svg .os-cat-edge[ data-active='true' ] {
		stroke-width: 2;
		opacity: 1;
	}

	.os-cat__viz-svg .os-cat-node {
		cursor: pointer;
		transition:
			r 0.2s cubic-bezier( 0.34, 1.56, 0.64, 1 ),
			fill 0.18s ease,
			stroke-width 0.18s ease,
			filter 0.18s ease;
	}
	.os-cat__viz-svg .os-cat-node[ data-selected='true' ] {
		filter: drop-shadow(
			0 0 6px var( --os-ui-cat-node-glow, rgba( 0, 0, 0, 0.18 ) )
		);
	}
	.os-cat__viz-svg .os-cat-node:hover,
	.os-cat__viz-svg .os-cat-node:focus-visible {
		filter: drop-shadow(
			0 0 8px var( --os-ui-cat-node-glow, rgba( 0, 0, 0, 0.3 ) )
		);
		outline: none;
	}

	.os-cat__viz-svg .os-cat-label {
		font-family: var( --os-ui-font, system-ui, sans-serif );
		font-size: 10.5px;
		fill: var( --os-ui-cat-label-fg, var( --os-ui-fg, #1d2327 ) );
		font-weight: 500;
		pointer-events: none;
		user-select: none;
	}
	.os-cat__viz-svg .os-cat-label[ data-selected='false' ] {
		fill: var( --os-ui-cat-label-muted, var( --os-ui-fg-muted, #8c8f94 ) );
		font-weight: 400;
		font-style: italic;
	}

	.os-cat__trigger {
		appearance: none;
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 1px 8px;
		min-height: 22px;
		font: inherit;
		font-size: 11px;
		font-weight: 500;
		line-height: 1;
		color: var( --os-ui-cat-trigger-fg, var( --os-ui-fg-muted, #50575e ) );
		background: transparent;
		border: 1px dashed var( --os-ui-cat-trigger-border, var( --os-ui-border, #c3c4c7 ) );
		border-radius: 999px;
		cursor: pointer;
		transition:
			background-color 0.12s ease,
			color 0.12s ease,
			border-color 0.12s ease;
	}
	.os-cat__trigger:hover:not( :disabled ) {
		background: var( --os-ui-hover, rgba( 0, 0, 0, 0.04 ) );
		color: var( --os-ui-cat-trigger-fg-hover, var( --os-ui-fg, #1d2327 ) );
		border-color: var( --os-ui-cat-trigger-border-hover, var( --os-ui-border-strong, #8c8f94 ) );
	}
	.os-cat__trigger:focus-visible {
		outline: none;
		border-style: solid;
		box-shadow: 0 0 0 2px var( --wp-admin-theme-color, #2271b1 );
	}
	.os-cat__trigger svg {
		display: block;
	}

	.os-cat__uncategorized {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 1px 10px;
		min-height: 22px;
		font-size: 11px;
		font-weight: 500;
		line-height: 1.6;
		color: var( --os-ui-cat-uncat-fg, var( --os-ui-fg-muted, #8c8f94 ) );
		background: transparent;
		border: 1px dashed var( --os-ui-cat-uncat-border, var( --os-ui-border, #c3c4c7 ) );
		border-radius: 999px;
		font-style: italic;
	}

	.os-cat__popover {
		position: fixed;
		top: 0;
		left: 0;
		min-width: 280px;
		max-width: 360px;
		max-height: 360px;
		display: flex;
		flex-direction: column;
		background: var( --os-ui-cat-pop-bg, var( --os-ui-surface, #fff ) );
		color: var( --os-ui-cat-pop-fg, var( --os-ui-fg, #1d2327 ) );
		border: 1px solid var( --os-ui-cat-pop-border, var( --os-ui-border, #c3c4c7 ) );
		border-radius: 8px;
		box-shadow:
			0 6px 16px rgba( 0, 0, 0, 0.08 ),
			0 1px 2px rgba( 0, 0, 0, 0.06 );
		z-index: 1000;
	}

	.os-cat__editor {
		position: relative;
		display: inline-flex;
		align-items: center;
	}

	.os-cat__search {
		appearance: none;
		font: inherit;
		font-size: 13px;
		padding: 8px 12px;
		border: 0;
		border-bottom: 1px solid var( --os-ui-cat-pop-divider, var( --os-ui-border, #f0f0f1 ) );
		background: transparent;
		color: inherit;
		outline: none;
	}
	.os-cat__search:focus {
		border-bottom-color: var( --wp-admin-theme-color, #2271b1 );
	}

	.os-cat__tree {
		flex: 1 1 auto;
		min-height: 0;
		overflow-y: auto;
		padding: 4px 0;
	}

	.os-cat__row-block {
		display: contents;
	}

	.os-cat__row {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 4px 8px 4px var( --os-ui-cat-row-indent, 12px );
		cursor: pointer;
		user-select: none;
		font-size: 13px;
		line-height: 1.4;
		position: relative;
	}
	.os-cat__row:hover,
	.os-cat__row[ data-focused='true' ] {
		background: var( --os-ui-hover, rgba( 0, 0, 0, 0.04 ) );
	}
	.os-cat__row[ data-selected='true' ] {
		color: var( --wp-admin-theme-color, #2271b1 );
		font-weight: 600;
	}

	.os-cat__row::before {
		content: '';
		position: absolute;
		left: 0;
		top: 0;
		bottom: 0;
		width: var( --os-ui-cat-guide-width, 0px );
		border-left: 1px dotted
			var( --os-ui-cat-guide-color, var( --os-ui-border, rgba( 0, 0, 0, 0.08 ) ) );
	}

	.os-cat__expander {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 14px;
		height: 14px;
		border: 0;
		background: transparent;
		color: inherit;
		cursor: pointer;
		flex-shrink: 0;
		opacity: 0.65;
	}
	.os-cat__expander:hover {
		opacity: 1;
	}
	.os-cat__expander svg {
		display: block;
		transition: transform 0.12s ease;
	}
	.os-cat__row[ data-expanded='true' ] .os-cat__expander svg {
		transform: rotate( 90deg );
	}
	.os-cat__expander--placeholder {
		visibility: hidden;
	}

	.os-cat__create-row {
		display: flex;
		align-items: center;
		padding: 2px 8px 2px var( --os-ui-cat-row-indent, 28px );
		position: relative;
	}
	.os-cat__create-row::before {
		content: '';
		position: absolute;
		left: 0;
		top: 0;
		bottom: 0;
		width: var( --os-ui-cat-guide-width, 0px );
		border-left: 1px dotted
			var( --os-ui-cat-guide-color, var( --os-ui-border, rgba( 0, 0, 0, 0.08 ) ) );
	}
	.os-cat__create-wrap {
		display: inline-flex;
		align-items: center;
		flex: 1 1 auto;
		min-width: 0;
		gap: 4px;
		padding: 1px 1px 1px 0;
		border: 1px solid transparent;
		border-radius: 6px;
		background: transparent;
		transition: border-color 0.12s ease, background-color 0.12s ease,
			box-shadow 0.12s ease;
	}
	.os-cat__create-wrap:hover {
		border-color: var( --os-ui-border, rgba( 0, 0, 0, 0.12 ) );
		background: var( --os-ui-cat-pop-bg, var( --os-ui-surface, #fff ) );
	}
	.os-cat__create-wrap:focus-within {
		border-color: var( --wp-admin-theme-color, #2271b1 );
		background: var( --os-ui-cat-pop-bg, var( --os-ui-surface, #fff ) );
		box-shadow: 0 0 0 2px
			color-mix(
				in srgb,
				var( --wp-admin-theme-color, #2271b1 ) 15%,
				transparent
			);
	}
	.os-cat__create-input {
		flex: 1 1 auto;
		min-width: 0;
		appearance: none;
		font: inherit;

		font-size: var( --os-ui-field-font-size-compact, 12px );
		padding: 3px 6px;
		border: 0;
		background: transparent;
		color: inherit;
		outline: none;
	}
	.os-cat__create-input::placeholder {
		color: var( --os-ui-cat-pop-muted, var( --os-ui-fg-muted, #8c8f94 ) );
		font-style: italic;
		opacity: 1;
	}
	.os-cat__create-submit {
		appearance: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		flex-shrink: 0;
		padding: 0;
		border: 0;
		border-radius: 4px;
		background: transparent;
		color: var( --os-ui-cat-pop-muted, var( --os-ui-fg-muted, #8c8f94 ) );
		cursor: pointer;
		transition: background-color 0.12s ease, color 0.12s ease;
	}
	.os-cat__create-wrap:focus-within .os-cat__create-submit:not(
			[ disabled ]
		) {
		background: var( --wp-admin-theme-color, #2271b1 );
		color: var( --os-ui-accent-ink, var( --os-ui-fg-on-accent, #fff ) );
	}
	.os-cat__create-submit:hover:not( [ disabled ] ) {
		filter: brightness( 1.05 );
	}
	.os-cat__create-submit[ disabled ] {
		cursor: default;
		opacity: 0.5;
	}
	.os-cat__create-submit svg {
		display: block;
	}
	.os-cat__create-spinner {
		display: inline-block;
		width: 12px;
		height: 12px;
		margin: 0 4px;
		border-radius: 50%;
		border: 2px solid var( --wp-admin-theme-color, #2271b1 );
		border-top-color: transparent;
		animation: os-cat-spin 0.8s linear infinite;
		flex-shrink: 0;
	}

	.os-cat__check {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 14px;
		height: 14px;
		flex-shrink: 0;
		border: 1.5px solid var( --os-ui-cat-check-border, var( --os-ui-border, #8c8f94 ) );
		border-radius: 3px;
		color: transparent;
		transition: background-color 0.12s ease, border-color 0.12s ease, color 0.12s ease;
	}
	.os-cat__row[ data-selected='true' ] .os-cat__check {
		background: var( --wp-admin-theme-color, #2271b1 );
		border-color: var( --wp-admin-theme-color, #2271b1 );
		color: var( --os-ui-accent-ink, var( --os-ui-fg-on-accent, #fff ) );
	}
	.os-cat__check svg {
		display: block;
		width: 14px;
		height: 14px;
	}

	.os-cat__label {
		min-width: 0;
		flex: 1 1 auto;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.os-cat__delete {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex: 0 0 auto;
		width: 18px;
		height: 18px;
		border: 0;
		border-radius: 50%;
		padding: 0;
		background: transparent;
		color: var( --os-ui-cat-delete-color, var( --os-ui-danger, #d63638 ) );
		cursor: pointer;
		opacity: 0;
		transition: opacity 0.12s ease, background-color 0.12s ease;
	}
	.os-cat__row:hover .os-cat__delete,
	.os-cat__row[ data-focused='true' ] .os-cat__delete,
	.os-cat__delete:focus-visible {
		opacity: 1;
	}
	.os-cat__delete:hover,
	.os-cat__delete:focus-visible {
		background: var( --os-ui-badge-danger-bg, rgba( 214, 54, 56, 0.12 ) );
	}
	.os-cat__delete svg {
		display: block;
		width: 14px;
		height: 14px;
	}

	.os-cat__match {
		background: var( --os-ui-search-highlight-bg, rgba( 252, 211, 77, 0.45 ) );
		border-radius: 2px;
		padding: 0 1px;
	}

	.os-cat__empty,
	.os-cat__loading {
		padding: 12px;
		font-size: 12px;
		color: var( --os-ui-cat-pop-muted, var( --os-ui-fg-muted, #646970 ) );
		text-align: center;
	}

	.os-cat__loading-spinner {
		display: inline-block;
		width: 12px;
		height: 12px;
		border-radius: 50%;
		border: 2px solid currentColor;
		border-top-color: transparent;
		animation: os-cat-spin 0.8s linear infinite;
		margin-inline-end: 8px;
		vertical-align: middle;
	}

	@keyframes os-cat-spin {
		to { transform: rotate( 360deg ); }
	}

	.os-cat__footer {
		padding: 8px 12px;
		font-size: 11px;
		color: var( --os-ui-cat-pop-muted, var( --os-ui-fg-muted, #646970 ) );
		border-top: 1px solid var( --os-ui-cat-pop-divider, var( --os-ui-border, #f0f0f1 ) );
		border-radius: 10px;
		background: var( --os-ui-cat-pop-footer-bg, var( --os-ui-surface, #fafafb ) );
		display: flex;
		align-items: center;
		gap: 6px;
		line-height: 1.4;
	}
	.os-cat__footer .dashicons {
		font-size: 14px;
		width: 14px;
		height: 14px;
		flex-shrink: 0;
	}

	:host( [ disabled ] ) .os-cat {
		opacity: 0.6;
		pointer-events: none;
	}
`;
