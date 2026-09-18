import { css } from '../../core';

/**
 * `<os-coachmark>` — an anchored callout with a step counter.
 *
 * Two pieces in one top-layer overlay: an outline that traces the
 * anchor, and the card that points at it. The overlay itself passes
 * every pointer through (the user has to be able to drag a window
 * while step 2 of the shell tour is up); only the card takes events.
 *
 * Every colour is read through a private alias so the palette and a
 * desktop theme both reach it. The accent is the flat brand accent,
 * not the mesh: a coachmark is instruction, not a hero moment.
 */
export const styles = css`
	:host {
		display: contents;
		--_accent: var( --os-ui-accent, #f252fc );
		--_glow: var( --os-ui-accent-dim, #d846e0 );
		--_bg: var( --os-ui-surface-elevated, #ffffff );
		--_fg: var( --os-ui-fg, #1d2327 );
		--_muted: var( --os-ui-fg-muted, #646970 );
		--_border: var( --os-ui-border-strong, rgba( 0, 0, 0, 0.12 ) );
		--_shadow: var( --os-ui-flyout-shadow, 0 16px 48px rgba( 0, 25, 53, 0.4 ) );
	}

	/* The top-layer overlay. Manual popover so nothing light-dismisses
	   it; fixed + inset 0 so the outline and the card share viewport
	   coordinates; pointer-events none so the desk stays usable. */
	.layer {
		position: fixed;
		inset: 0;
		margin: 0;
		padding: 0;
		border: 0;
		width: auto;
		height: auto;
		max-width: none;
		max-height: none;
		overflow: visible;
		background: transparent;
		color: inherit;
		pointer-events: none;
	}
	.layer[hidden] {
		display: none;
	}

	.outline {
		position: fixed;
		box-sizing: border-box;
		border: 2px solid var( --_accent );
		border-radius: 12px;
		box-shadow: 0 0 0 4px color-mix( in srgb, var( --_glow ) 28%, transparent );
		pointer-events: none;
		animation: os-coachmark-pulse 1.6s ease-in-out infinite;
	}
	.outline[hidden] {
		display: none;
	}
	@keyframes os-coachmark-pulse {
		0%,
		100% {
			box-shadow: 0 0 0 4px color-mix( in srgb, var( --_glow ) 28%, transparent );
		}
		50% {
			box-shadow: 0 0 0 8px color-mix( in srgb, var( --_glow ) 12%, transparent );
		}
	}

	.card {
		position: fixed;
		box-sizing: border-box;
		width: min( 320px, calc( 100vw - 24px ) );
		padding: 16px 18px 14px;
		border-radius: 14px;
		background: var( --_bg );
		background-image: var( --os-ui-panel-bg-image, none );
		background-repeat: var( --os-ui-panel-bg-image-repeat, repeat );
		background-size: var( --os-ui-panel-bg-image-size, auto );
		background-position: var( --os-ui-panel-bg-image-position, center );
		color: var( --_fg );
		border: 1px solid var( --_border );
		box-shadow: var( --_shadow );
		pointer-events: auto;
		outline: none;
		font-size: 13px;
		line-height: 1.5;
		animation: os-coachmark-in 220ms cubic-bezier( 0.22, 1, 0.36, 1 );
	}
	.card:focus-visible {
		box-shadow:
			var( --_shadow ),
			0 0 0 2px var( --_accent );
	}
	@keyframes os-coachmark-in {
		from {
			opacity: 0;
			transform: translateY( 6px );
		}
		to {
			opacity: 1;
			transform: none;
		}
	}

	.meta {
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var( --_accent );
		margin: 0 0 4px;
	}
	.meta:empty {
		display: none;
	}
	h2 {
		margin: 0 0 6px;
		font-size: 15px;
		font-weight: 600;
		line-height: 1.3;
		color: inherit;
	}
	.body {
		color: var( --_muted );
	}
	.body ::slotted( p ) {
		margin: 0 0 8px;
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 12px;
	}
	.actions os-button[hidden] {
		display: none;
	}

	@media ( prefers-reduced-motion: reduce ) {
		.outline {
			animation: none;
		}
		.card {
			animation: none;
		}
	}
`;
