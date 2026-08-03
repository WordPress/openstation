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
`;

export const stepStyles = css`
	:host {
		display: grid;
		grid-template-columns: var( --os-ui-step-chip-size, 28px ) 1fr;
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
	.os-step__body {
		min-width: 0;
	}
	.os-step__title {
		margin: 0 0 4px;
		font-size: 14px;
		font-weight: 600;
		color: var( --os-ui-fg, #1d2327 );
		line-height: 1.3;
	}
	.os-step__title:empty {
		display: none;
	}
	.os-step__body ::slotted( * ) {
		margin-block: 0;
	}
`;
