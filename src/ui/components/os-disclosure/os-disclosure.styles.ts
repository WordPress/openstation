/**
 * `<os-disclosure>` — shadow-DOM styles.
 *
 * The summary is a real `<button>` rather than a styled `<div>`: it is
 * the control that opens the thing, so it has to be reachable by Tab,
 * operable by Enter and Space, and announced with its state. Every
 * visual choice below is on top of that, not instead of it.
 *
 * Card styling (background, border, radius) is deliberately NOT here.
 * Like `<os-section>`, how a disclosure looks is surface-specific —
 * the Components tab wants it to read as one of its section boxes,
 * another surface may want it bare — so the call-site stylesheet owns
 * it and reaches the parts exposed in the render.
 */
import { css } from '../../core';

export const styles = css`
	:host {
		display: block;
	}
	:host( [ hidden ] ) {
		display: none;
	}
	.os-disclosure__summary {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 0;
		background: none;
		border: 0;
		font: inherit;
		color: var( --os-ui-fg, #1d2327 );
		text-align: start;
		cursor: pointer;
	}
	/*
	 * The focus ring is the component's own, not the surface's: a
	 * disclosure dropped into a stylesheet that never thought about it
	 * would otherwise be keyboard-operable and invisibly so.
	 */
	.os-disclosure__summary:focus-visible {
		outline: 2px solid var( --os-ui-accent, #f252fc );
		outline-offset: 2px;
		border-radius: 4px;
	}
	.os-disclosure__heading {
		flex: 1 1 auto;
		min-width: 0;
		margin: 0;
		font-size: 20px;
		font-weight: 500;
		letter-spacing: -0.01em;
	}
	/* Body Small on the muted step — a count, a hint, a status. */
	.os-disclosure__hint {
		flex: 0 0 auto;
		font-size: 13px;
		font-weight: 400;
		color: var( --os-ui-fg-muted, #646970 );
	}
	/*
	 * A chevron drawn from a rotated border, so it needs no icon font
	 * and no asset. It points right when closed and down when open —
	 * the direction IS the state, which is why it is not decorative and
	 * why reduced motion below stops the turn, never the turn's result.
	 */
	.os-disclosure__marker {
		flex: 0 0 auto;
		width: 8px;
		height: 8px;
		margin-inline-end: 2px;
		border-inline-end: 2px solid currentColor;
		border-block-end: 2px solid currentColor;
		transform: rotate( -45deg );
		transition: transform 160ms ease;
		opacity: 0.7;
	}
	:host( [ open ] ) .os-disclosure__marker {
		transform: rotate( 45deg );
	}
	@media ( prefers-reduced-motion: reduce ) {
		.os-disclosure__marker {
			transition: none;
		}
	}
	/*
	 * The hidden ATTRIBUTE on the body, rather than display:none from a
	 * class, so the element is genuinely out of the accessibility tree
	 * and out of the tab order while closed. A collapsed panel whose
	 * contents are still focusable is the classic disclosure bug: Tab
	 * appears to jump into nothing.
	 */
	.os-disclosure__body {
		margin-block-start: 14px;
	}
	.os-disclosure__body[ hidden ] {
		display: none;
	}
`;
