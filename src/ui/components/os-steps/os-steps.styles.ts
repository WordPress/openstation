/**
 * `<os-steps>` + `<os-step>` — shadow-DOM styles.
 *
 * Numbers come from a CSS counter (`--os-ui-step-counter`) established
 * on `<os-steps>` and incremented by each `<os-step>` host via
 * `:host` — that's why counters-in-shadow-DOM works here: the host
 * itself lives in the parent's light DOM, so it inherits the
 * counter scope from the `<os-steps>` ancestor.
 */
import { css } from '../../core';

export const stepsStyles = css`
	:host {
		display: block;
		counter-reset: os-step;
	}
	:host( [ hidden ] ) {
		display: none;
	}
	.os-steps__list {
		display: flex;
		flex-direction: column;
		gap: var( --os-ui-steps-gap, 16px );
		margin: 0;
		padding: 0;
		list-style: none;
	}
	/*
	 * A trail rather than a list: the steps sit on one line with a
	 * rule between them, which is the shape a wizard header takes.
	 * The connector itself is drawn by <os-step>, which is the only
	 * element that knows whether it is the last one; the width is
	 * declared here because it is a fact about the layout, and on a
	 * state modifier rather than the bare :host so a theme can still
	 * reach the token.
	 */
	:host( [ horizontal ] ) {
		--os-ui-step-connector-width: 20px;
		/* A trail is read as a line of labels, so the one you are on
		   has to be the one that stands out. Muting the rest is what
		   makes the current step visible at all; in the vertical layout each
		   title is a heading over its own body and stays full
		   contrast. */
		--os-ui-step-title-color: var( --os-ui-fg-muted, #646970 );
		--os-ui-step-title-weight: 400;
	}
	:host( [ horizontal ] ) .os-steps__list {
		flex-direction: row;
		align-items: center;
		flex-wrap: wrap;
		gap: var( --os-ui-steps-gap, 10px );
	}
`;

export const stepStyles = css`
	:host {
		display: grid;
		grid-template-columns:
			var( --os-ui-step-chip-size, 28px ) 1fr
			var( --os-ui-step-connector-width, 0 );
		column-gap: var( --os-ui-step-gap, 12px );
		align-items: start;
		counter-increment: os-step;
	}
	:host( [ hidden ] ) {
		display: none;
	}
	/* Number chip — rendered via ::before on the host so the CSS
	 * counter (reset on <os-steps>) is in scope. */
	:host::before {
		content: counter( os-step );
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: var( --os-ui-step-chip-size, 28px );
		height: var( --os-ui-step-chip-size, 28px );
		border-radius: 50%;
		/*
		 * The step number sits on a bright fill, which is exactly the
		 * shape an identity moment takes: small, round, one per row.
		 * The mesh arrives through --os-ui-step-chip-bg from the
		 * palette rather than from here, so this literal stays the
		 * pre-brand blue Legacy collected.
		 */
		background: var(
			--os-ui-step-chip-bg,
			var( --wp-admin-theme-color, #2271b1 )
		);
		background-size: 200% 200%;
		background-position: 30% 40%;
		color: var( --os-ui-step-chip-fg, var( --os-ui-fg-on-accent, #fff ) );
		/* Zero-width by default so nothing moves for existing trails;
		   an instrument-voiced trail turns the idle chip into an
		   outline by setting the border and clearing the fill. */
		border: var( --os-ui-step-chip-border, 0 );
		font-family: var( --os-ui-step-chip-family, inherit );
		font-size: var( --os-ui-step-chip-font-size, 13px );
		font-weight: 600;
		line-height: 1;
		flex-shrink: 0;
	}
	/* Completed state — tick instead of number, muted chip. */
	:host( [ done ] )::before {
		content: '✓';
		background: var(
			--os-ui-step-chip-done-bg,
			var( --os-ui-fg-muted, #646970 )
		);
	}
	/*
	 * Where you are now. The chip already wears the brand; what marks
	 * the current step is the title going from muted to full contrast,
	 * because a wizard header is read as a line of labels and the one
	 * you are on should be the one you can read.
	 */
	:host( [ current ] ) .os-step__title {
		color: var( --os-ui-fg, #1d2327 );
		font-weight: 600;
	}
	:host( [ interactive ] ) {
		cursor: pointer;
	}
	:host( [ interactive ]:focus-visible ) {
		outline: var( --os-ui-focus-ring, 2px solid #2271b1 );
		outline-offset: 2px;
		border-radius: var( --os-ui-radius, 4px );
	}
	/*
	 * The connector between two steps on a trail. ::before is spent on
	 * the number chip, so this takes ::after, which nothing else in
	 * this component uses. It collapses to zero width when the parent
	 * is not horizontal, so there is no vertical-layout special case.
	 */
	:host::after {
		content: '';
		inline-size: var( --os-ui-step-connector-width, 0 );
		block-size: 1px;
		background: var( --os-ui-border, rgba( 0, 0, 0, 0.08 ) );
		align-self: center;
	}
	:host( :last-of-type )::after {
		content: none;
	}
	.os-step__body {
		min-width: 0;
	}
	/* On a trail the row is one line, so the chip and the label centre
	   against each other and the title loses its heading margin. The
	   parent sets these on its children rather than the child guessing:
	   horizontal is the container's fact, not the step's. */
	:host( [ trail ] ) {
		align-items: center;
	}
	:host( [ trail ] ) .os-step__title {
		margin: 0;
	}
	.os-step__title {
		margin: 0 0 4px;
		font-family: var( --os-ui-step-title-family, inherit );
		font-size: var( --os-ui-step-title-size, 14px );
		font-weight: var( --os-ui-step-title-weight, 600 );
		color: var( --os-ui-step-title-color, var( --os-ui-fg, #1d2327 ) );
		text-transform: var( --os-ui-step-title-transform, none );
		letter-spacing: var( --os-ui-step-title-spacing, normal );
		line-height: 1.3;
	}
	.os-step__title:empty {
		display: none;
	}
	.os-step__body ::slotted( * ) {
		margin-block: 0;
	}
`;
