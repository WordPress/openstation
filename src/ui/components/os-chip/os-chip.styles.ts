/**
 * `<os-chip>` — shadow-DOM styles. The chip is a single inline-flex
 * pill with optional leading icon and trailing dismiss button. Tones
 * are switched via the `tone` host attribute; every paintable
 * property reads from a CSS custom property first so callers can
 * theme one chip, a row of chips (`os-chip-row > os-chip`), or
 * the global default.
 */
import { css } from '../../core';
import { holoTokens } from '../../holo';

export const styles = css`
	${ holoTokens }

	:host {
		display: inline-flex;
		max-width: 100%;
		vertical-align: middle;
	}
	:host( [ hidden ] ) {
		display: none;
	}

	.os-chip {
		display: inline-flex;
		align-items: center;
		gap: var( --os-ui-chip-gap, 4px );
		padding: var( --os-ui-chip-padding, 2px 8px );
		border-radius: var( --os-ui-chip-radius, 999px );
		font-size: var( --os-ui-chip-font-size, 12px );
		line-height: var( --os-ui-chip-line-height, 1.6 );
		font-weight: var( --os-ui-chip-font-weight, 500 );
		background: var( --os-ui-chip-bg, var( --os-ui-surface, #f0f0f1 ) );
		color: var( --os-ui-chip-fg, var( --os-ui-fg, #1d2327 ) );
		border: var( --os-ui-chip-border, 1px solid transparent );
		max-width: 100%;
		box-sizing: border-box;
		transition:
			background-color 0.12s ease,
			color 0.12s ease,
			border-color 0.12s ease,
			transform 0.12s ease,
			opacity 0.12s ease;
	}

	/* Tones — same surface as <os-badge> for consistency. */
	:host( [ tone='accent' ] ) .os-chip {
		background: var(
			--os-ui-chip-bg,
			color-mix( in srgb, var( --wp-admin-theme-color, #2271b1 ) 14%, transparent )
		);
		color: var( --os-ui-chip-fg, var( --wp-admin-theme-color, #2271b1 ) );
	}
	:host( [ tone='positive' ] ) .os-chip {
		background: var( --os-ui-chip-bg, rgba( 30, 132, 73, 0.14 ) );
		color: var( --os-ui-chip-fg, var( --os-ui-success-fg, #1d6f42 ) );
	}
	:host( [ tone='warning' ] ) .os-chip {
		background: var( --os-ui-chip-bg, rgba( 217, 119, 6, 0.18 ) );
		color: var( --os-ui-chip-fg, var( --os-ui-warning-fg, #8a4a06 ) );
	}
	:host( [ tone='danger' ] ) .os-chip {
		background: var( --os-ui-chip-bg, rgba( 214, 54, 56, 0.14 ) );
		color: var( --os-ui-chip-fg, var( --os-ui-danger-hover, #a02622 ) );
	}

	/* Pending shimmer — used by os-tag-input while a REST mutation
	 * is in flight. Subtle pulse so the user sees "this chip isn't
	 * settled yet" without alarming animation. */
	:host( [ pending ] ) .os-chip {
		opacity: 0.65;
		animation: os-chip-pulse 1.2s ease-in-out infinite;
	}

	@keyframes os-chip-pulse {
		0%, 100% { opacity: 0.55; }
		50%      { opacity: 0.95; }
	}

	.os-chip__label {
		max-width: var( --os-ui-chip-label-max, 220px );
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.os-chip__icon {
		display: inline-flex;
		align-items: center;
		flex-shrink: 0;
	}
	.os-chip__icon::slotted( * ) {
		display: inline-flex;
	}

	.os-chip__dismiss {
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
	.os-chip__dismiss:hover,
	.os-chip__dismiss:focus-visible {
		opacity: 1;
		background: var( --os-ui-hover, rgba( 0, 0, 0, 0.12 ) );
		outline: none;
	}
	.os-chip__dismiss:focus-visible {
		box-shadow: var( --_holo-focus );
	}
	.os-chip__dismiss[ disabled ] {
		opacity: 0.35;
		cursor: not-allowed;
	}
	/* 14, not the button's own 16. Core's cross carries about 63% of
	   its 24 grid in ink, so a box-filling glyph in a 16px button lands
	   heavier than the 14px label beside it. Two pixels back and the
	   cross reads as the label's peer rather than as its loudest part. */
	.os-chip__dismiss svg {
		display: block;
		width: 14px;
		height: 14px;
	}

	:host( [ disabled ] ) .os-chip {
		opacity: 0.55;
		cursor: not-allowed;
	}

	/* Compact density — half the horizontal padding. Used in dense
	 * lists like the posts-window Tags column. */
	:host( [ size='compact' ] ) .os-chip {
		padding: var( --os-ui-chip-padding, 1px 6px );
		font-size: var( --os-ui-chip-font-size, 11px );
	}

	/*
	 * The holographic hairline, and ONLY on a selected chip.
	 *
	 * Chips arrive in rows of eight and twelve — a tag column, a
	 * filter bar, a category picker — so the treatment here has to be
	 * the one that costs nothing when repeated. An edge on the one
	 * chip the user has chosen reads instantly in a row of otherwise
	 * flat pills; an edge on all of them reads as noise.
	 *
	 * Drawn on a mask-composited ::after rather than a border, because
	 * border-color takes a colour and this is a gradient. Same
	 * technique as .os-holo-edge; written out here because the chip's
	 * frame belongs to .os-chip, an inner element rather than the
	 * host, and the shared class hangs its ring on whatever carries
	 * the class.
	 */
	:host( [ selected ] ) .os-chip {
		position: relative;
		background: var( --os-ui-chip-bg, var( --os-ui-accent-soft, rgba( 34, 113, 177, 0.14 ) ) );
		color: var( --os-ui-chip-fg, var( --os-ui-fg, #1d2327 ) );
	}
	:host( [ selected ] ) .os-chip::after {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: inherit;
		padding: 1px;
		background-image: var( --_holo-edge );
		pointer-events: none;
		-webkit-mask: linear-gradient( #000 0 0 ) content-box,
			linear-gradient( #000 0 0 );
		-webkit-mask-composite: xor;
		mask: linear-gradient( #000 0 0 ) content-box, linear-gradient( #000 0 0 );
		mask-composite: exclude;
	}
`;
