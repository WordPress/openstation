/**
 * `<wpd-chip>` — shadow-DOM styles. The chip is a single inline-flex
 * pill with optional leading icon and trailing dismiss button. Tones
 * are switched via the `tone` host attribute; every paintable
 * property reads from a CSS custom property first so callers can
 * theme one chip, a row of chips (`wpd-chip-row > wpd-chip`), or
 * the global default.
 */
import { css } from '../../core';

export const styles = css`
	:host {
		display: inline-flex;
		max-width: 100%;
		vertical-align: middle;
	}
	:host( [ hidden ] ) {
		display: none;
	}

	.wpd-chip {
		display: inline-flex;
		align-items: center;
		gap: var( --wpd-chip-gap, 4px );
		padding: var( --wpd-chip-padding, 2px 8px );
		border-radius: var( --wpd-chip-radius, 999px );
		font-size: var( --wpd-chip-font-size, 12px );
		line-height: var( --wpd-chip-line-height, 1.6 );
		font-weight: var( --wpd-chip-font-weight, 500 );
		background: var( --wpd-chip-bg, var( --wpd-surface, #f0f0f1 ) );
		color: var( --wpd-chip-fg, var( --wpd-fg, #1d2327 ) );
		border: var( --wpd-chip-border, 1px solid transparent );
		max-width: 100%;
		box-sizing: border-box;
		transition:
			background-color 0.12s ease,
			color 0.12s ease,
			border-color 0.12s ease,
			transform 0.12s ease,
			opacity 0.12s ease;
	}

	/* Tones — same surface as <wpd-badge> for consistency. */
	:host( [ tone='accent' ] ) .wpd-chip {
		background: var(
			--wpd-chip-bg,
			color-mix( in srgb, var( --wp-admin-theme-color, #2271b1 ) 14%, transparent )
		);
		color: var( --wpd-chip-fg, var( --wp-admin-theme-color, #2271b1 ) );
	}
	:host( [ tone='positive' ] ) .wpd-chip {
		background: var( --wpd-chip-bg, rgba( 30, 132, 73, 0.14 ) );
		color: var( --wpd-chip-fg, var( --wpd-success-fg, #1d6f42 ) );
	}
	:host( [ tone='warning' ] ) .wpd-chip {
		background: var( --wpd-chip-bg, rgba( 217, 119, 6, 0.18 ) );
		color: var( --wpd-chip-fg, var( --wpd-warning-fg, #8a4a06 ) );
	}
	:host( [ tone='danger' ] ) .wpd-chip {
		background: var( --wpd-chip-bg, rgba( 214, 54, 56, 0.14 ) );
		color: var( --wpd-chip-fg, var( --wpd-danger-hover, #a02622 ) );
	}

	/* Pending shimmer — used by wpd-tag-input while a REST mutation
	 * is in flight. Subtle pulse so the user sees "this chip isn't
	 * settled yet" without alarming animation. */
	:host( [ pending ] ) .wpd-chip {
		opacity: 0.65;
		animation: wpd-chip-pulse 1.2s ease-in-out infinite;
	}

	@keyframes wpd-chip-pulse {
		0%, 100% { opacity: 0.55; }
		50%      { opacity: 0.95; }
	}

	.wpd-chip__label {
		max-width: var( --wpd-chip-label-max, 220px );
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.wpd-chip__icon {
		display: inline-flex;
		align-items: center;
		flex-shrink: 0;
	}
	.wpd-chip__icon::slotted( * ) {
		display: inline-flex;
	}

	.wpd-chip__dismiss {
		appearance: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 16px;
		height: 16px;
		margin-inline-start: 2px;
		padding: 0;
		border: 0;
		border-radius: 50%;
		background: transparent;
		color: inherit;
		cursor: pointer;
		opacity: 0.55;
		transition: opacity 0.12s ease, background-color 0.12s ease;
	}
	.wpd-chip__dismiss:hover,
	.wpd-chip__dismiss:focus-visible {
		opacity: 1;
		background: var( --wpd-hover, rgba( 0, 0, 0, 0.12 ) );
		outline: none;
	}
	.wpd-chip__dismiss:focus-visible {
		box-shadow: 0 0 0 2px var( --wp-admin-theme-color, #2271b1 );
	}
	.wpd-chip__dismiss[ disabled ] {
		opacity: 0.35;
		cursor: not-allowed;
	}
	.wpd-chip__dismiss svg {
		display: block;
		width: 10px;
		height: 10px;
	}

	:host( [ disabled ] ) .wpd-chip {
		opacity: 0.55;
		cursor: not-allowed;
	}

	/* Compact density — half the horizontal padding. Used in dense
	 * lists like the posts-window Tags column. */
	:host( [ size='compact' ] ) .wpd-chip {
		padding: var( --wpd-chip-padding, 1px 6px );
		font-size: var( --wpd-chip-font-size, 11px );
	}
`;
