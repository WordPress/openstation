import { css } from '../../core';

/**
 * `<os-tooltip>` — the hover lozenge.
 *
 * Same surface as the dock's tooltip: `--os-tooltip-bg` and
 * `--os-tooltip-fg`, a fixed dark lozenge on every theme. Both are
 * read into private aliases rather than declared on the host, so a
 * desktop theme or the palette can still reach them.
 *
 * The host is fixed-positioned and lives on document.body, so no
 * window's overflow or transform can clip it. Its layer sits above
 * a fullscreen window: a tooltip is transient and always belongs on
 * top of whatever the pointer is over.
 */
export const styles = css`
	:host {
		--_bg: var( --os-tooltip-bg, var( --os-ui-scrim, rgba( 0, 0, 0, 0.85 ) ) );
		--_fg: var( --os-tooltip-fg, var( --os-ui-fg-on-accent, #fff ) );

		position: fixed;
		top: 0;
		left: 0;
		z-index: calc( var( --os-z-fullscreen, 99999 ) + 1 );
		display: block;
		max-width: 280px;
		pointer-events: none;
		opacity: 0;
		visibility: hidden;
		transform: translateY( -2px );
		transition:
			opacity 0.15s ease,
			transform 0.15s ease,
			visibility 0s linear 0.15s;
	}

	:host( [ open ] ) {
		opacity: 1;
		visibility: visible;
		transform: none;
		transition:
			opacity 0.15s ease,
			transform 0.15s ease,
			visibility 0s;
	}

	.surface {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 6px 12px;
		border-radius: 6px;
		background: var( --_bg );
		color: var( --_fg );
		font-size: 12px;
		font-weight: 400;
		line-height: 1.4;
		overflow-wrap: anywhere;
	}

	.heading {
		font-weight: 600;
	}

	.heading + .text {
		opacity: 0.8;
	}

	@media ( prefers-reduced-motion: reduce ) {
		:host,
		:host( [ open ] ) {
			transform: none;
			transition: none;
		}
	}
`;
