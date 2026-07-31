/**
 * `<wpd-steps>` + `<wpd-step>` — shadow-DOM styles.
 *
 * Numbers come from a CSS counter (`--wpd-step-counter`) established
 * on `<wpd-steps>` and incremented by each `<wpd-step>` host via
 * `:host` — that's why counters-in-shadow-DOM works here: the host
 * itself lives in the parent's light DOM, so it inherits the
 * counter scope from the `<wpd-steps>` ancestor.
 */
import { css } from '../../core';

export const stepsStyles = css`
	:host {
		display: block;
		counter-reset: wpd-step;
	}
	:host( [ hidden ] ) {
		display: none;
	}
	.wpd-steps__list {
		display: flex;
		flex-direction: column;
		gap: var( --wpd-steps-gap, 16px );
		margin: 0;
		padding: 0;
		list-style: none;
	}
`;

export const stepStyles = css`
	:host {
		display: grid;
		grid-template-columns: var( --wpd-step-chip-size, 28px ) 1fr;
		column-gap: var( --wpd-step-gap, 12px );
		align-items: start;
		counter-increment: wpd-step;
	}
	:host( [ hidden ] ) {
		display: none;
	}
	/* Number chip — rendered via ::before on the host so the CSS
	 * counter (reset on <wpd-steps>) is in scope. */
	:host::before {
		content: counter( wpd-step );
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: var( --wpd-step-chip-size, 28px );
		height: var( --wpd-step-chip-size, 28px );
		border-radius: 50%;
		background: var(
			--wpd-step-chip-bg,
			var( --wp-admin-theme-color, #2271b1 )
		);
		color: var( --wpd-step-chip-fg, var( --wpd-fg-on-accent, #fff ) );
		font-size: var( --wpd-step-chip-font-size, 13px );
		font-weight: 600;
		line-height: 1;
		flex-shrink: 0;
	}
	/* Completed state — tick instead of number, muted chip. */
	:host( [ done ] )::before {
		content: '✓';
		background: var(
			--wpd-step-chip-done-bg,
			var( --wpd-fg-muted, #646970 )
		);
	}
	.wpd-step__body {
		min-width: 0;
	}
	.wpd-step__title {
		margin: 0 0 4px;
		font-size: 14px;
		font-weight: 600;
		color: var( --wpd-fg, #1d2327 );
		line-height: 1.3;
	}
	.wpd-step__title:empty {
		display: none;
	}
	.wpd-step__body ::slotted( * ) {
		margin-block: 0;
	}
`;
