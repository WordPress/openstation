/**
 * My WordPress — the user activity footprint.
 *
 * Part of the `my-wordpress` client view: imported by the
 * `my-wordpress.os.ts` entry. WP Explorer's full-body footprint
 * surface, ported 1:1 — the sections, their order, and every class
 * name are the original's, so its stylesheet rules and any plugin CSS
 * written against them keep applying:
 *
 *   1. Hero header  — big avatar, name, role chips, member-since.
 *   2. Stat strip   — totals + current/longest streak callouts.
 *   3. Calendar     — 52-week × 7-day GitHub-style heatmap of daily
 *                     activity (posts + comments + update saves folded
 *                     into a single intensity score).
 *   4. Rhythm       — weekday distribution + hour-of-day distribution.
 *   5. Most-prolific month callout.
 *   6. Recent timeline.
 *   7. Action footer.
 *
 * All data comes from one round-trip to
 * `/desktop-mode/v1/user-footprint/<id>`, fetched here and cached per
 * window+user, so a `watch` repaint never re-asks for a year of
 * aggregates it already holds.
 *
 * @public
 */

import { __, _n, html, sprintf, type TemplateResult } from '@openstation/app';
import { trackedFetch } from '../../../src/tracked-fetch';
import type { UserFootprint } from '../../../src/my-wordpress/types';
import { openUserEditWindow } from '../../../src/posts-window/user-edit-target';
import { uiOf, type Ctx } from './types';

/** Per-window fetch cache — lives in the UI bag, keyed by user. */
export interface FootprintCache {
	userId: number;
	status: 'loading' | 'error' | 'ready';
	payload: UserFootprint | null;
}

/** Kick (or reuse) the fetch for the open footprint. */
function ensureFootprint( ctx: Ctx, userId: number ): FootprintCache {
	const ui = uiOf( ctx.root );
	if ( ui.fp && ui.fp.userId === userId ) {
		return ui.fp;
	}
	const cache: FootprintCache = { userId, status: 'loading', payload: null };
	ui.fp = cache;
	const root = String( ctx.data.restRoot ?? '' );
	void trackedFetch(
		`${ root }desktop-mode/v1/user-footprint/${ userId }`,
		{
			method: 'GET',
			credentials: 'same-origin',
			headers: {
				'X-WP-Nonce': String( ctx.data.restNonce ?? '' ),
				Accept: 'application/json',
			},
		},
		{ source: 'my-wordpress/footprint' },
	)
		.then( async ( response ) => {
			if ( ! response.ok ) {
				throw new Error( String( response.status ) );
			}
			return ( await response.json() ) as UserFootprint;
		} )
		.then( ( payload ) => {
			// Guard against late arrivals after the user navigated on.
			if ( uiOf( ctx.root ).fp === cache ) {
				cache.status = 'ready';
				cache.payload = payload;
				ctx.local( 'repaint' );
			}
		} )
		.catch( () => {
			if ( uiOf( ctx.root ).fp === cache ) {
				cache.status = 'error';
				ctx.local( 'repaint' );
			}
		} );
	return cache;
}

/**
 * The status-bar strings while the footprint is open — the same
 * pair the original painted: totals on the left, the window's date
 * range on the right.
 */
export function footprintStatus( ctx: Ctx ): [ string, string ] | null {
	const userId = Number( ctx.state.footprint );
	if ( ! ( userId > 0 ) ) {
		return null;
	}
	const cache = uiOf( ctx.root ).fp;
	if ( ! cache || cache.userId !== userId || cache.status === 'loading' ) {
		return [ __( 'Loading footprint…' ), '' ];
	}
	if ( cache.status === 'error' || ! cache.payload ) {
		return [ __( 'Could not load footprint.' ), '' ];
	}
	const payload = cache.payload;
	return [
		sprintf(
			/* translators: 1: post total, 2: comment total. */
			__( '%1$d posts · %2$d comments tracked' ),
			payload.totals.posts + payload.totals.pages,
			payload.totals.comments,
		),
		sprintf(
			/* translators: 1: window-start date, 2: window-end date. */
			__( 'Window %1$s → %2$s' ),
			shortDate( payload.range.from ),
			shortDate( payload.range.to ),
		),
	];
}

// ------------------------------------------------------------ helpers

function shortDate( iso: string ): string {
	if ( ! iso ) {
		return '';
	}
	try {
		return new Date( iso ).toLocaleDateString( undefined, {
			month: 'short',
			day: 'numeric',
		} );
	} catch {
		return iso;
	}
}

function longDate( iso: string ): string {
	if ( ! iso ) {
		return '';
	}
	try {
		return new Date( iso ).toLocaleDateString( undefined, {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
		} );
	} catch {
		return iso;
	}
}

function yearMonth( iso: string ): string {
	if ( ! iso ) {
		return '';
	}
	try {
		return new Date( iso ).toLocaleString( undefined, {
			year: 'numeric',
			month: 'long',
		} );
	} catch {
		return iso;
	}
}

function initialsOf( name: string ): string {
	const parts = name
		.trim()
		.split( /\s+/ )
		.filter( ( s ) => s.length > 0 );
	if ( parts.length === 0 ) {
		return '?';
	}
	if ( parts.length === 1 ) {
		return parts[ 0 ].slice( 0, 2 ).toUpperCase();
	}
	return ( parts[ 0 ][ 0 ] + parts[ parts.length - 1 ][ 0 ] ).toUpperCase();
}

function statCard( value: string, label: string, caption: string ): TemplateResult {
	return html`
		<div class="os-my-wordpress__user-stat">
			<span class="os-my-wordpress__user-stat-value">${ value }</span>
			<span class="os-my-wordpress__user-stat-label">${ label }</span>
			${ caption
				? html`<span class="os-my-wordpress__user-stat-caption">${ caption }</span>`
				: '' }
		</div>
	`;
}

// ------------------------------------------------------------ sections

function hero( payload: UserFootprint ): TemplateResult {
	const roles = payload.profile.roleLabels ?? [];
	return html`
		<header class="os-my-wordpress__footprint-hero">
			<div class="os-my-wordpress__footprint-avatar">
				${ payload.profile.avatarUrl
					? html`<img src=${ payload.profile.avatarUrl } alt="" />`
					: html`<span class="os-my-wordpress__user-tile-initials">${ initialsOf( payload.profile.name ) }</span>` }
			</div>
			<div class="os-my-wordpress__footprint-headline">
				<h1 class="os-my-wordpress__footprint-title">${ payload.profile.name }</h1>
				<div class="os-my-wordpress__footprint-meta">
					${ roles.map( ( r ) => html`<span class="os-my-wordpress__user-role">${ r }</span>` ) }
					${ payload.profile.registered
						? html`<span class="os-my-wordpress__user-role os-my-wordpress__footprint-since">${ sprintf(
							/* translators: %s is a year-month label like "January 2023". */
							__( 'Member since %s' ),
							yearMonth( payload.profile.registered ),
						) }</span>`
						: '' }
				</div>
				${ payload.profile.link
					? html`<div class="os-my-wordpress__user-links">
						<a href=${ payload.profile.link } target="_blank" rel="noopener noreferrer">${ __( 'Author archive' ) }</a>
					</div>`
					: '' }
			</div>
		</header>
	`;
}

function headlineStats( payload: UserFootprint ): TemplateResult {
	const totalContent = payload.totals.posts + payload.totals.pages;
	const updates = payload.totals.updates ?? 0;
	const longestRange = payload.streak.longestRange;
	return html`
		<section class="os-my-wordpress__footprint-section os-my-wordpress__footprint-stats-row">
			${ statCard(
				totalContent.toLocaleString(),
				__( 'Total content' ),
				payload.totals.posts > 0 && payload.totals.pages > 0
					? sprintf(
						/* translators: 1: post count, 2: page count. */
						__( '%1$d posts · %2$d pages' ),
						payload.totals.posts,
						payload.totals.pages,
					)
					: '',
			) }
			${ statCard( payload.totals.comments.toLocaleString(), __( 'Comments left' ), '' ) }
			${ updates > 0
				? statCard(
					updates.toLocaleString(),
					__( 'Updates' ),
					__( 'Saves on existing posts' ),
				)
				: '' }
			${ statCard(
				sprintf(
					/* translators: %d is the length in days of the user's longest publishing streak. */
					_n( '%d day', '%d days', payload.streak.longest ),
					payload.streak.longest,
				),
				__( 'Longest streak' ),
				longestRange.from && longestRange.to
					? sprintf(
						/* translators: 1: start date, 2: end date. */
						__( '%1$s → %2$s' ),
						shortDate( longestRange.from ),
						shortDate( longestRange.to ),
					)
					: '',
			) }
			${ statCard(
				sprintf(
					/* translators: %d is the length in days of the user's current active streak. */
					_n( '%d day', '%d days', payload.streak.current ),
					payload.streak.current,
				),
				__( 'Current streak' ),
				payload.streak.current === 0
					? __( 'No activity today' )
					: __( 'Including today' ),
			) }
		</section>
	`;
}

function calendar( payload: UserFootprint ): TemplateResult {
	const dayIntensity = ( d: UserFootprint[ 'daily' ][ number ] ): number =>
		d.posts + d.comments + ( d.updates ?? 0 );
	const maxIntensity = payload.daily.reduce( ( m, d ) => {
		const v = dayIntensity( d );
		return v > m ? v : m;
	}, 0 );
	const bucketize = ( v: number ): number => {
		if ( v <= 0 || maxIntensity <= 0 ) {
			return 0;
		}
		const ratio = v / maxIntensity;
		if ( ratio > 0.75 ) {
			return 4;
		}
		if ( ratio > 0.5 ) {
			return 3;
		}
		if ( ratio > 0.25 ) {
			return 2;
		}
		return 1;
	};

	const dates = payload.daily.map( ( d ) => new Date( d.date + 'T00:00:00Z' ) );
	if ( dates.length === 0 ) {
		return html`
			<section class="os-my-wordpress__footprint-section os-my-wordpress__footprint-calendar-section">
				<h3>${ __( 'A year of activity' ) }</h3>
				<p class="os-my-wordpress__article-meta">${ __( 'No activity recorded in the last year.' ) }</p>
			</section>
		`;
	}

	// Grid geometry — the original's, verbatim: row 1 is month labels,
	// col 1 is weekday labels, data cells start at (2, 2), a column per
	// week. See the legacy renderer for the reasoning on each rule.
	const firstDow = dates[ 0 ].getUTCDay();
	const place = ( linear: number ): string =>
		`grid-row:${ ( linear % 7 ) + 2 };grid-column:${ Math.floor( linear / 7 ) + 2 }`;

	// Mon / Wed / Fri labels, locale-formatted from a known Monday.
	const weekdaySource = [
		new Date( Date.UTC( 2024, 11, 2 ) ),
		new Date( Date.UTC( 2024, 11, 4 ) ),
		new Date( Date.UTC( 2024, 11, 6 ) ),
	];
	const weekdayRows = [ 3, 5, 7 ];

	const monthLabels: TemplateResult[] = [];
	let lastMonth = -1;
	for ( let i = 0; i < payload.daily.length; i += 1 ) {
		const m = dates[ i ].getUTCMonth();
		if ( m === lastMonth ) {
			continue;
		}
		lastMonth = m;
		const linear = firstDow + i;
		const week = Math.floor( linear / 7 );
		// A first-column label whose month starts mid-week would
		// half-overhang the weekday gutter.
		if ( week === 0 && linear % 7 !== 0 ) {
			continue;
		}
		monthLabels.push( html`<span
			class="os-my-wordpress__footprint-month"
			style="grid-row:1;grid-column:${ week + 2 }"
		>${ dates[ i ].toLocaleDateString( undefined, { month: 'short' } ) }</span>` );
	}

	return html`
		<section class="os-my-wordpress__footprint-section os-my-wordpress__footprint-calendar-section">
			<h3>${ __( 'A year of activity' ) }</h3>
			<div class="os-my-wordpress__footprint-calendar">
				<div class="os-my-wordpress__footprint-grid">
					${ weekdaySource.map( ( d, i ) => html`<span
						class="os-my-wordpress__footprint-weekday"
						style="grid-column:1;grid-row:${ weekdayRows[ i ] + 1 }"
					>${ d.toLocaleDateString( undefined, { weekday: 'short' } ) }</span>` ) }
					${ monthLabels }
					${ Array.from( { length: firstDow }, ( _unused, i ) => html`<span
						class="os-my-wordpress__footprint-cell os-my-wordpress__footprint-cell--pad"
						aria-hidden="true"
						style=${ place( i ) }
					></span>` ) }
					${ payload.daily.map( ( d, i ) => html`<span
						class="os-my-wordpress__footprint-cell os-my-wordpress__footprint-cell--l${ bucketize( dayIntensity( d ) ) }"
						title=${ sprintf(
							/* translators: 1: date, 2: post count, 3: comment count, 4: update (re-save) count. */
							__( '%1$s — %2$d posts, %3$d comments, %4$d updates' ),
							longDate( d.date ),
							d.posts,
							d.comments,
							d.updates ?? 0,
						) }
						data-date=${ d.date }
						style=${ place( firstDow + i ) }
					></span>` ) }
				</div>
				<div class="os-my-wordpress__footprint-legend">
					<span class="os-my-wordpress__footprint-legend-label">${ __( 'Less' ) }</span>
					${ [ 0, 1, 2, 3, 4 ].map( ( i ) => html`<span class="os-my-wordpress__footprint-cell os-my-wordpress__footprint-cell--l${ i }"></span>` ) }
					<span class="os-my-wordpress__footprint-legend-label">${ __( 'More' ) }</span>
				</div>
			</div>
		</section>
	`;
}

function barChart( values: number[], labels: string[], titles: string[] ): TemplateResult {
	const max = Math.max( 1, ...values );
	return html`
		<div class="os-my-wordpress__footprint-bars">
			${ values.map( ( v, i ) => html`
				<div class="os-my-wordpress__footprint-bar-col">
					<div
						class="os-my-wordpress__footprint-bar ${ v === 0 ? 'os-my-wordpress__footprint-bar--empty' : '' }"
						style="height:${ Math.round( ( v / max ) * 100 ) }%"
						title=${ sprintf(
							/* translators: 1: bucket label, 2: count. */
							__( '%1$s · %2$d' ),
							titles[ i ] ?? labels[ i ] ?? String( i ),
							v,
						) }
					></div>
					<span class="os-my-wordpress__footprint-bar-label">${ labels[ i ] ?? '' }</span>
				</div>
			` ) }
		</div>
	`;
}

function rhythm( payload: UserFootprint ): TemplateResult {
	const weekdayLabels = [ __( 'S' ), __( 'M' ), __( 'T' ), __( 'W' ), __( 'T' ), __( 'F' ), __( 'S' ) ];
	const weekdayFull = [
		__( 'Sunday' ),
		__( 'Monday' ),
		__( 'Tuesday' ),
		__( 'Wednesday' ),
		__( 'Thursday' ),
		__( 'Friday' ),
		__( 'Saturday' ),
	];
	const hourLabels = Array.from( { length: 24 }, ( _unused, i ) =>
		i % 3 === 0 ? String( i ) : '',
	);
	const hourFull = Array.from( { length: 24 }, ( _unused, i ) =>
		sprintf(
			/* translators: %d is an hour of the day (0-23). */
			__( '%d:00' ),
			i,
		),
	);
	return html`
		<section class="os-my-wordpress__footprint-section os-my-wordpress__footprint-rhythm">
			<h3>${ __( 'Publishing rhythm' ) }</h3>
			<div class="os-my-wordpress__footprint-rhythm-grid">
				<div class="os-my-wordpress__footprint-chart">
					<div class="os-my-wordpress__footprint-chart-caption">${ __( 'By weekday' ) }</div>
					${ barChart( payload.weekday, weekdayLabels, weekdayFull ) }
				</div>
				<div class="os-my-wordpress__footprint-chart">
					<div class="os-my-wordpress__footprint-chart-caption">${ __( 'By hour of day (site time)' ) }</div>
					${ barChart( payload.hour, hourLabels, hourFull ) }
				</div>
			</div>
		</section>
	`;
}

function monthCallout( payload: UserFootprint ): TemplateResult | '' {
	const m = payload.totals.mostProlificMonth;
	if ( ! m ) {
		return '';
	}
	return html`
		<section class="os-my-wordpress__footprint-section os-my-wordpress__footprint-callout">
			<span class="os-my-wordpress__footprint-callout-label">${ __( 'Most prolific month' ) }</span>
			<h3 class="os-my-wordpress__footprint-callout-value">${ yearMonth( m.ym + '-01T00:00:00Z' ) }</h3>
			<p class="os-my-wordpress__footprint-callout-detail">${ sprintf(
				/* translators: %d is a post count. */
				_n(
					'%d post published — their personal record.',
					'%d posts published — their personal record.',
					m.n,
				),
				m.n,
			) }</p>
		</section>
	`;
}

function timeline( payload: UserFootprint ): TemplateResult {
	const iconFor = ( kind: string ): string => {
		if ( kind === 'comment' ) {
			return 'dashicons-admin-comments';
		}
		if ( kind === 'post-update' ) {
			return 'dashicons-edit';
		}
		return 'dashicons-admin-post';
	};
	const titleFor = ( ev: UserFootprint[ 'timeline' ][ number ] ): string => {
		const title = ev.title || __( '(no title)' );
		if ( ev.kind === 'comment' ) {
			return sprintf(
				/* translators: %s is a post title the user commented on. */
				__( 'Commented on “%s”' ),
				title,
			);
		}
		if ( ev.kind === 'post-update' ) {
			return sprintf(
				/* translators: %s is the post title the user re-saved. */
				__( 'Updated “%s”' ),
				title,
			);
		}
		return title;
	};
	const metaFor = ( ev: UserFootprint[ 'timeline' ][ number ] ): string => {
		const parts = [ longDate( ev.date ) ];
		if ( ev.status && ev.status !== 'publish' && ev.status !== 'approved' ) {
			parts.push( ev.status );
		}
		return parts.join( ' · ' );
	};
	return html`
		<section class="os-my-wordpress__footprint-section os-my-wordpress__footprint-timeline-section">
			<h3>${ __( 'Recent activity' ) }</h3>
			${ payload.timeline.length === 0
				? html`<p class="os-my-wordpress__article-meta">${ __( 'Nothing to show yet.' ) }</p>`
				: html`<ul class="os-my-wordpress__footprint-timeline">
					${ payload.timeline.map( ( ev ) => html`
						<li class="os-my-wordpress__footprint-event os-my-wordpress__footprint-event--${ ev.kind }">
							<span class="os-my-wordpress__footprint-dot">
								<span class="dashicons ${ iconFor( ev.kind ) }" aria-hidden="true"></span>
							</span>
							<div class="os-my-wordpress__footprint-event-body">
								${ ev.link
									? html`<a
										class="os-my-wordpress__footprint-event-title"
										href=${ ev.link }
										target="_blank"
										rel="noopener noreferrer"
									>${ titleFor( ev ) }</a>`
									: html`<span class="os-my-wordpress__footprint-event-title">${ titleFor( ev ) }</span>` }
								<span class="os-my-wordpress__footprint-event-meta">${ metaFor( ev ) }</span>
							</div>
						</li>
					` ) }
				</ul>` }
		</section>
	`;
}

function footer( ctx: Ctx, payload: UserFootprint, userId: number ): TemplateResult {
	return html`
		<footer class="os-my-wordpress__footprint-section os-my-wordpress__footprint-footer">
			<os-button
				variant="ghost"
				?disabled=${ ! payload.profile.link }
				@click=${ () => {
					if ( payload.profile.link ) {
						window.open( payload.profile.link, '_blank', 'noopener,noreferrer' );
					}
				} }
			>${ __( 'View author archive' ) }</os-button>
			<os-button
				variant="primary"
				@click=${ () =>
					openUserEditWindow( userId, {
						source: 'my-wordpress-app/footprint',
						fallback: () => void ctx.dispatch( 'edit', { item: userId } ),
					} ) }
			>${ __( 'Show profile' ) }</os-button>
		</footer>
	`;
}

/** The full-body footprint view — replaces the split list/preview. */
export function renderFootprint( ctx: Ctx ): TemplateResult {
	const userId = Number( ctx.state.footprint );
	const cache = ensureFootprint( ctx, userId );

	if ( cache.status === 'loading' ) {
		return html`
			<div class="os-my-wordpress__footprint">
				<div class="os-my-wordpress__preview-loading"><os-spinner></os-spinner></div>
			</div>
		`;
	}
	if ( cache.status === 'error' || ! cache.payload ) {
		return html`
			<div class="os-my-wordpress__footprint">
				<os-empty-state>${ __( 'Could not load footprint.' ) }</os-empty-state>
			</div>
		`;
	}
	const payload = cache.payload;
	return html`
		<div class="os-my-wordpress__footprint">
			${ hero( payload ) }
			${ headlineStats( payload ) }
			${ calendar( payload ) }
			${ rhythm( payload ) }
			${ monthCallout( payload ) }
			${ timeline( payload ) }
			${ footer( ctx, payload, userId ) }
		</div>
	`;
}
