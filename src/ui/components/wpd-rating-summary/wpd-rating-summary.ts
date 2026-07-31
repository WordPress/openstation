/**
 * `<wpd-rating-summary>` — wp.org-style rating distribution.
 *
 * Renders a two-pane summary card: the average rating + 5-star
 * cluster + total-ratings count on the left; one animated bar per
 * star bucket on the right. Designed for the Reviews surface of the
 * Plugins window but stays generic so future surfaces (theme
 * directory, product reviews) can reuse it.
 *
 * Usage:
 *
 *   const el = document.createElement( 'wpd-rating-summary' );
 *   el.rating = 92;        // 0–100 (wp.org convention)
 *   el.ratings = { '5': 320, '4': 80, '3': 12, '2': 4, '1': 6 };
 *   parent.appendChild( el );
 *
 * `total` is auto-summed from `ratings` when omitted.
 */

import { Component, defineComponent, html } from '../../core';
import { styles } from './wpd-rating-summary.styles';

/** Bucket-keyed rating counts. Missing keys are treated as zero. */
export type WpdRatingBuckets = Partial<
	Record< '1' | '2' | '3' | '4' | '5', number >
>;

export class WpdRatingSummary extends Component {
	static props = [ 'rating', 'total' ] as const;
	static styles = [ styles ];

	static help = {
		title: 'Rating summary',
		summary:
			'Two-pane rating distribution: big average + 5-star cluster + total count on the left, one animated bar per star bucket on the right. Mirrors the WordPress.org plugin reviews summary.',
		status: 'experimental',
		since: '0.8.5',
		props: [
			{
				name: 'rating',
				type: 'number (0–100)',
				description:
					'Average rating on the wp.org 0–100 scale. Converted to a 0–5 display inside.',
			},
			{
				name: 'total',
				type: 'number',
				description:
					'Total number of ratings. Optional — auto-summed from `ratings` when omitted.',
			},
		],
		cssProps: [
			{ name: '--wpd-rating-fill', description: 'Background of the bar fill.' },
			{ name: '--wpd-rating-track', description: 'Background of the empty bar track.' },
			{ name: '--wpd-rating-star', description: 'Color of filled stars.' },
			{ name: '--wpd-rating-star-empty', description: 'Color of empty stars.' },
			{ name: '--wpd-rating-surface', description: 'Card background.' },
			{ name: '--wpd-rating-border', description: 'Card border color.' },
			{ name: '--wpd-rating-fg', description: 'Primary text color.' },
			{ name: '--wpd-rating-fg-muted', description: 'Secondary text color.' },
		],
		example: html`
			<wpd-rating-summary rating="92"></wpd-rating-summary>
		`,
	} as const;

	private _ratings: WpdRatingBuckets = {};

	/**
	 * Per-star counts. Setting this triggers a re-render so consumers
	 * can swap data without recreating the element.
	 */
	get ratings(): WpdRatingBuckets {
		return { ...this._ratings };
	}
	set ratings( next: WpdRatingBuckets | null | undefined ) {
		this._ratings = next ? { ...next } : {};
		this.requestUpdate();
	}

	protected render() {
		const rating = clamp01to100( numAttr( this, 'rating' ) );
		const stars0to5 = ( rating / 100 ) * 5;
		const totalAttr = numAttr( this, 'total' );
		const total =
			totalAttr > 0
				? totalAttr
				: ( this._ratings[ '5' ] ?? 0 ) +
					( this._ratings[ '4' ] ?? 0 ) +
					( this._ratings[ '3' ] ?? 0 ) +
					( this._ratings[ '2' ] ?? 0 ) +
					( this._ratings[ '1' ] ?? 0 );

		const fmt = new Intl.NumberFormat();
		const big = rating > 0 ? ( rating / 100 * 5 ).toFixed( 1 ) : '—';

		return html`
			<div class="summary-card" role="img" aria-label=${ ariaLabel( rating, total ) }>
				<div class="summary">
					<div class="big">${ big }</div>
					<div class="stars" aria-hidden="true">
						${ renderStarRow( stars0to5 ) }
					</div>
					<div class="total">
						${ total === 1 ? '1 rating' : `${ fmt.format( total ) } ratings` }
					</div>
				</div>
				<div class="bars">
					${ [ 5, 4, 3, 2, 1 ].map( ( star ) => {
						const count = this._ratings[ String( star ) as '1' | '2' | '3' | '4' | '5' ] ?? 0;
						const ratio = total === 0 ? 0 : count / total;
						return html`
							<div
								class="row"
								role="presentation"
								aria-label=${ `${ star } stars: ${ fmt.format( count ) }` }
							>
								<span class="row__label">
									${ star } ${ filledStarSvg() }
								</span>
								<span class="row__track">
									<span
										class="row__fill"
										style=${ `--ratio: ${ ratio.toFixed( 4 ) }` }
									></span>
								</span>
								<span class="row__count">${ fmt.format( count ) }</span>
							</div>
						`;
					} ) }
				</div>
			</div>
		`;
	}
}

function numAttr( host: HTMLElement, name: string ): number {
	const raw = host.getAttribute( name );
	if ( raw === null || raw === '' ) {
		return 0;
	}
	const n = Number( raw );
	return Number.isFinite( n ) ? n : 0;
}

function clamp01to100( n: number ): number {
	if ( n < 0 ) {
		return 0;
	}
	if ( n > 100 ) {
		return 100;
	}
	return n;
}

function ariaLabel( rating: number, total: number ): string {
	if ( total === 0 ) {
		return 'No ratings yet';
	}
	const stars = ( rating / 100 ) * 5;
	return `Average rating ${ stars.toFixed( 1 ) } out of 5, from ${ total } ratings`;
}

function renderStarRow( stars0to5: number ) {
	const full = Math.floor( stars0to5 );
	const half = stars0to5 - full >= 0.5 ? 1 : 0;
	const empty = 5 - full - half;
	const list = [];
	for ( let i = 0; i < full; i++ ) {
		list.push( filledStarSvg() );
	}
	for ( let i = 0; i < half; i++ ) {
		list.push( halfStarSvg() );
	}
	for ( let i = 0; i < empty; i++ ) {
		list.push( emptyStarSvg() );
	}
	return list;
}

function filledStarSvg() {
	return html`
		<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
			<path
				d="M8 1.5l2.06 4.17 4.6.67-3.33 3.25.79 4.58L8 12L3.88 14.17l.79-4.58L1.34 6.34l4.6-.67L8 1.5z"
			/>
		</svg>
	`;
}

function halfStarSvg() {
	return html`
		<svg viewBox="0 0 16 16" aria-hidden="true">
			<defs>
				<linearGradient id="wpd-half-star">
					<stop offset="50%" stop-color="currentColor" />
					<stop
						offset="50%"
						stop-color="currentColor"
						stop-opacity="0.22"
					/>
				</linearGradient>
			</defs>
			<path
				fill="url(#wpd-half-star)"
				d="M8 1.5l2.06 4.17 4.6.67-3.33 3.25.79 4.58L8 12L3.88 14.17l.79-4.58L1.34 6.34l4.6-.67L8 1.5z"
			/>
		</svg>
	`;
}

function emptyStarSvg() {
	return html`
		<svg
			class="empty"
			viewBox="0 0 16 16"
			fill="currentColor"
			aria-hidden="true"
		>
			<path
				d="M8 1.5l2.06 4.17 4.6.67-3.33 3.25.79 4.58L8 12L3.88 14.17l.79-4.58L1.34 6.34l4.6-.67L8 1.5z"
			/>
		</svg>
	`;
}

defineComponent( 'wpd-rating-summary', WpdRatingSummary );
