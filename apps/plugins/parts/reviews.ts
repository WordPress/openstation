/**
 * Plugins app — the Reviews section.
 *
 * Part of the `desktop-mode-plugins` client view. The Installed tab's
 * detail panel and the Browse flyout both show a plugin's wp.org
 * ratings: the `<os-rating-summary>` histogram from the
 * `plugin_information` payload, then the recent reviews scraped by
 * `parts/reviews.php` (loaded on first sight, cached per slug for the
 * window). One renderer, one loading and one fallback state for both.
 *
 * @public
 */

import { __ } from '@openstation/app';
// Both surfaces paint outside the runtime's on-demand component
// loading (a shadow root, an `os-preserve` host) — register here.
import '../../../src/ui/components/os-card/os-card';
import '../../../src/ui/components/os-empty-state/os-empty-state';
import '../../../src/ui/components/os-rating-summary/os-rating-summary';
import type { OsRatingBuckets, OsRatingSummary } from '../../../src/ui/components/os-rating-summary/os-rating-summary';
import { buildStarCluster } from './card';
import { externalLink, linkButton, wpOrgUrl } from './html';
import type { PluginReview, PluginReviewsResponse, PluginsHost, WpOrgPluginInfo } from './types';

/** The stylesheet the section needs wherever it is mounted. */
export const REVIEW_STYLES = `
.os-plugins__reviews { display: flex; flex-direction: column; gap: 16px; }
.os-plugins__reviews-grid { display: grid; grid-template-columns: repeat( auto-fill, minmax( 240px, 1fr ) ); gap: 12px; }
.os-plugins__reviews-more, .os-plugins__reviews-cta { display: flex; justify-content: center; padding-top: 12px; }
.os-plugins__review { width: 100%; height: 100%; box-sizing: border-box; }
.os-plugins__review-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.os-plugins__review-date { margin-inline-start: auto; font-size: 11.5px; color: var( --os-ui-fg-muted, #888 ); }
.os-plugins__review-body { margin: 0; font-size: 13px; color: var( --os-ui-fg, inherit ); line-height: 1.55; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
.os-plugins__review-link { font-size: 12px; font-weight: 600; color: var( --wp-admin-theme-color, #2271b1 ); text-decoration: none; }
.os-plugins__review-link:hover { text-decoration: underline; }
.os-plugins__reviews-loading { display: inline-flex; align-items: center; gap: 10px; padding: 12px 14px; border-radius: 10px; background: var( --os-ui-surface-raised, rgba( 255, 255, 255, 0.7 ) ); border: 1px solid var( --os-ui-border, rgba( 0, 0, 0, 0.08 ) ); color: var( --os-ui-fg-muted, #666 ); font-size: 13px; }
`;

/** The histogram card from a `plugin_information` payload. */
function buildRatingSummary( info: WpOrgPluginInfo ): HTMLElement {
	const el = document.createElement( 'os-rating-summary' ) as OsRatingSummary;
	if ( typeof info.rating === 'number' ) {
		el.setAttribute( 'rating', String( info.rating ) );
	}
	if ( info.num_ratings ) {
		el.setAttribute( 'total', String( info.num_ratings ) );
	}
	const buckets: OsRatingBuckets = {};
	const ratings = info.ratings ?? {};
	for ( const key of [ '1', '2', '3', '4', '5' ] as const ) {
		const v = ratings[ key ];
		if ( typeof v === 'number' ) {
			buckets[ key ] = v;
		}
	}
	el.ratings = buckets;
	return el;
}

/** A loading line with a spinner. */
export function loadingLine( label: string ): HTMLElement {
	const wrap = document.createElement( 'div' );
	wrap.className = 'os-plugins__reviews-loading';
	const spinner = document.createElement( 'os-spinner' );
	spinner.setAttribute( 'preset', 'classic' );
	spinner.setAttribute( 'size', '20' );
	const text = document.createElement( 'span' );
	text.textContent = label;
	wrap.append( spinner, text );
	return wrap;
}

/** An `<os-empty-state>` with a dashicon. */
export function emptyState( icon: string, heading: string, description: string ): HTMLElement {
	const e = document.createElement( 'os-empty-state' );
	e.setAttribute( 'icon', `dashicons-${ icon }` );
	e.setAttribute( 'heading', heading );
	e.setAttribute( 'description', description );
	return e;
}

/**
 * The whole section: the histogram, then the review list — from the
 * window's cache when the slug was seen, fetched once otherwise.
 */
export function renderReviews( host: PluginsHost, slug: string, info: WpOrgPluginInfo | null ): HTMLElement {
	const section = document.createElement( 'div' );
	section.className = 'os-plugins__reviews';
	if ( ! info ) {
		section.appendChild( loadingLine( __( 'Loading from WordPress.org…', 'desktop-mode' ) ) );
		return section;
	}
	section.appendChild( buildRatingSummary( info ) );

	const body = document.createElement( 'div' );
	section.appendChild( body );

	const cached = host.caches.reviews.get( slug );
	if ( cached ) {
		paintReviewList( body, cached, slug );
		return section;
	}
	body.appendChild( loadingLine( __( 'Loading recent reviews…', 'desktop-mode' ) ) );
	void ( async () => {
		try {
			const resp = await host.rest.fetchPluginReviews( slug );
			host.caches.reviews.set( slug, resp );
			if ( body.isConnected ) {
				paintReviewList( body, resp, slug );
			}
		} catch {
			if ( body.isConnected ) {
				body.replaceChildren(
					emptyState(
						'warning',
						__( 'Couldn’t load reviews', 'desktop-mode' ),
						__( 'WordPress.org didn’t respond. Try again in a moment.', 'desktop-mode' ),
					),
				);
			}
		}
	} )();
	return section;
}

function paintReviewList( host: HTMLElement, resp: PluginReviewsResponse, slug: string ): void {
	host.replaceChildren();
	const reviewsUrl = wpOrgUrl( slug, '#reviews' );
	// A failed scrape says nothing about whether reviews exist — say
	// where they live rather than claim there are none.
	if ( ! resp.parsed ) {
		const empty = emptyState(
			'external',
			__( 'Reviews live on WordPress.org', 'desktop-mode' ),
			__(
				'We couldn’t pull the review feed here. Open the full thread on WordPress.org to read every review.',
				'desktop-mode',
			),
		);
		const cta = linkButton( 'primary', __( 'Open reviews on WordPress.org ↗', 'desktop-mode' ), reviewsUrl, 'small' );
		cta.setAttribute( 'slot', 'cta' );
		empty.appendChild( cta );
		host.appendChild( empty );
		return;
	}
	// Zero items: the histogram already tells the story; just the CTA.
	if ( resp.items.length === 0 ) {
		const wrap = document.createElement( 'div' );
		wrap.className = 'os-plugins__reviews-cta';
		wrap.appendChild(
			linkButton(
				'primary',
				__( 'Write a review on WordPress.org ↗', 'desktop-mode' ),
				`https://wordpress.org/support/plugin/${ encodeURIComponent( slug ) }/reviews/#new-post`,
				'small',
			),
		);
		host.appendChild( wrap );
		return;
	}
	const grid = document.createElement( 'div' );
	grid.className = 'os-plugins__reviews-grid';
	for ( const item of resp.items ) {
		grid.appendChild( buildReviewCard( item ) );
	}
	host.appendChild( grid );
	const more = document.createElement( 'div' );
	more.className = 'os-plugins__reviews-more';
	more.appendChild( linkButton( 'ghost', __( 'Read all reviews on WordPress.org ↗', 'desktop-mode' ), reviewsUrl, 'small' ) );
	host.appendChild( more );
}

function buildReviewCard( item: PluginReview ): HTMLElement {
	const card = document.createElement( 'os-card' );
	card.setAttribute( 'compact', '' );
	card.className = 'os-plugins__review';
	const head = document.createElement( 'div' );
	head.setAttribute( 'slot', 'header' );
	head.className = 'os-plugins__review-head';
	const author = document.createElement( 'strong' );
	author.textContent = item.author || __( 'Anonymous', 'desktop-mode' );
	head.append( author, buildStarCluster( ( item.stars / 5 ) * 100, 0 ) );
	if ( item.date ) {
		const date = document.createElement( 'span' );
		date.className = 'os-plugins__review-date';
		date.textContent = item.date;
		head.appendChild( date );
	}
	card.appendChild( head );
	if ( item.excerpt ) {
		const body = document.createElement( 'p' );
		body.className = 'os-plugins__review-body';
		body.textContent = item.excerpt;
		card.appendChild( body );
	}
	if ( item.url ) {
		const foot = document.createElement( 'div' );
		foot.setAttribute( 'slot', 'footer' );
		foot.appendChild( externalLink( item.url, __( 'Read full review ↗', 'desktop-mode' ), 'os-plugins__review-link' ) );
		card.appendChild( foot );
	}
	return card;
}
