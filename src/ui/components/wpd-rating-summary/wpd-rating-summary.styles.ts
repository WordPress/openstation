/**
 * `<wpd-rating-summary>` — shadow-DOM styles.
 *
 * Two-column layout: a left "summary" tile with the big rating
 * number, 5-star cluster, and total-ratings line; and a right
 * "histogram" with one row per star bucket. Every paintable token
 * reads from a CSS custom property so callers can theme just the
 * fills (matching their plugin brand) without overriding the layout.
 *
 * @since 0.8.5
 */
import { css } from '../../core';

export const styles = css`
	:host {
		display: block;
		--_track: var( --wpd-rating-track, rgba( 0, 0, 0, 0.08 ) );
		--_fill: var( --wpd-rating-fill,
			linear-gradient( 90deg, #f5af00 0%, #ffd245 100% ) );
		--_star: var( --wpd-rating-star, #f5af00 );
		--_star-empty: var( --wpd-rating-star-empty, rgba( 0, 0, 0, 0.18 ) );
		--_surface: var( --wpd-rating-surface, var( --wpd-surface-raised, rgba( 255, 255, 255, 0.7 ) ) );
		--_border: var( --wpd-rating-border, var( --wpd-border, rgba( 0, 0, 0, 0.08 ) ) );
		--_fg: var( --wpd-rating-fg, var( --wpd-fg, inherit ) );
		--_fg-muted: var( --wpd-rating-fg-muted, var( --wpd-fg-muted, #666 ) );
	}
	:host( [ hidden ] ) {
		display: none;
	}

	.summary-card {
		display: grid;
		grid-template-columns: minmax( 140px, 180px ) 1fr;
		gap: 28px;
		align-items: center;
		padding: 18px 20px;
		background: var( --_surface );
		border: 1px solid var( --_border );
		border-radius: 14px;
		color: var( --_fg );
	}

	.summary {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		padding-inline-end: 20px;
		border-inline-end: 1px solid var( --_border );
	}

	.big {
		font-size: 44px;
		font-weight: 700;
		line-height: 1;
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.02em;
		color: var( --_fg );
	}

	.stars {
		display: inline-flex;
		gap: 2px;
		color: var( --_star );
	}

	.stars svg {
		width: 16px;
		height: 16px;
		display: block;
	}

	.stars .empty {
		color: var( --_star-empty );
	}

	.total {
		font-size: 12px;
		color: var( --_fg-muted );
	}

	.bars {
		display: grid;
		gap: 6px;
		min-width: 0;
	}

	.row {
		display: grid;
		grid-template-columns: 42px 1fr 60px;
		gap: 12px;
		align-items: center;
		font-size: 12.5px;
		color: var( --_fg-muted );
	}

	.row__label {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-variant-numeric: tabular-nums;
		font-weight: 600;
	}

	.row__label svg {
		width: 11px;
		height: 11px;
		color: var( --_star );
	}

	.row__track {
		position: relative;
		height: 10px;
		background: var( --_track );
		border-radius: 999px;
		overflow: hidden;
	}

	.row__fill {
		position: absolute;
		inset: 0;
		background: var( --_fill );
		border-radius: 999px;
		transform-origin: left center;
		transform: scaleX( var( --ratio, 0 ) );
		transition: transform 600ms cubic-bezier( 0.2, 0.8, 0.2, 1 );
	}

	:host( :dir( rtl ) ) .row__fill,
	:host-context( [ dir='rtl' ] ) .row__fill {
		transform-origin: right center;
	}

	.row__count {
		text-align: end;
		font-variant-numeric: tabular-nums;
		color: var( --_fg );
	}

	@media ( prefers-reduced-motion: reduce ) {
		.row__fill {
			transition: none;
		}
	}

	@media ( max-width: 540px ) {
		.summary-card {
			grid-template-columns: 1fr;
			gap: 16px;
		}
		.summary {
			padding-inline-end: 0;
			border-inline-end: 0;
			border-block-end: 1px solid var( --_border );
			padding-block-end: 14px;
		}
	}
`;
