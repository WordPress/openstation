/**
 * About — the OpenStation journal, sourced from the public RSS feed.
 *
 * The browser does not call the cross-origin feed directly. PHP
 * fetches and normalizes it behind an authenticated admin-AJAX URL,
 * and the app only asks for it the first time the About page is
 * actually shown — most sessions never are, and the shell's boot path
 * stays independent from the remote blog.
 */

import { __, html, sprintf, type TemplateResult } from '@openstation/app';
import { extraOf, uiOf, type Ctx, type Section } from './types';

const BLOG_URL = 'https://openstation.blog/';
const FEED_URL = 'https://openstation.blog/feed/';
const PROJECT_URL = 'https://github.com/WordPress/openstation/';

export interface AboutFeedItem {
	title: string;
	url: string;
	author: string;
	publishedAt: string;
	excerpt: string;
}

export interface AboutFeed {
	title: string;
	description: string;
	homeUrl: string;
	feedUrl: string;
	items: AboutFeedItem[];
	stale: boolean;
}

export type AboutFeedState =
	| { kind: 'loading' }
	| { kind: 'ready'; feed: AboutFeed }
	| { kind: 'error' };

/** Accept only browser-safe HTTP(S) links from the remote payload. */
function httpUrl( value: unknown ): string {
	if ( typeof value !== 'string' || value === '' ) {
		return '';
	}
	try {
		const url = new URL( value, window.location.href );
		return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
	} catch {
		return '';
	}
}

const text = ( value: unknown ): string => ( typeof value === 'string' ? value.trim() : '' );

/** Runtime-check the private AJAX response before threading it into the DOM. */
export function normalizeAboutFeed( value: unknown ): AboutFeed | null {
	if ( ! value || typeof value !== 'object' ) {
		return null;
	}
	const raw = value as Record< string, unknown >;
	const items = ( Array.isArray( raw.items ) ? raw.items : [] )
		.map( ( entry ): AboutFeedItem | null => {
			if ( ! entry || typeof entry !== 'object' ) {
				return null;
			}
			const item = entry as Record< string, unknown >;
			const title = text( item.title );
			const url = httpUrl( item.url );
			if ( title === '' || url === '' ) {
				return null;
			}
			return {
				title,
				url,
				author: text( item.author ),
				publishedAt: text( item.publishedAt ),
				excerpt: text( item.excerpt ),
			};
		} )
		.filter( ( item ): item is AboutFeedItem => item !== null )
		.slice( 0, 5 );
	return {
		title: text( raw.title ) || __( 'OpenStation' ),
		description:
			text( raw.description ) || __( 'A public dev diary — building a desktop OS for wp-admin.' ),
		homeUrl: httpUrl( raw.homeUrl ) || BLOG_URL,
		feedUrl: httpUrl( raw.feedUrl ) || FEED_URL,
		items,
		stale: raw.stale === true,
	};
}

function formatDate( iso: string ): string {
	if ( iso === '' ) {
		return '';
	}
	const date = new Date( iso );
	if ( Number.isNaN( date.getTime() ) ) {
		return '';
	}
	return date.toLocaleDateString( undefined, { month: 'short', day: 'numeric', year: 'numeric' } );
}

function postMeta( item: AboutFeedItem ): string {
	const date = formatDate( item.publishedAt );
	if ( date && item.author ) {
		/* translators: 1: publication date, 2: post author. */
		return sprintf( '%1$s · %2$s', date, item.author );
	}
	return date || item.author;
}

const featuredPost = ( item: AboutFeedItem ) => html`
	<article class="os-settings__about-featured">
		<a href=${ item.url } target="_blank" rel="noopener noreferrer">
			<div class="os-settings__about-featured-copy">
				<span class="os-settings__about-kicker">${ __( 'Latest dispatch' ) }</span>
				<h3>${ item.title }</h3>
				${ item.excerpt ? html`<p>${ item.excerpt }</p>` : '' }
			</div>
			<footer>
				<span>${ postMeta( item ) }</span>
				<strong>${ __( 'Read the dispatch' ) } <span aria-hidden="true">↗</span></strong>
			</footer>
		</a>
	</article>
`;

const postCard = ( item: AboutFeedItem ) => html`
	<article class="os-settings__about-card" role="listitem">
		<a href=${ item.url } target="_blank" rel="noopener noreferrer">
			<span class="os-settings__about-card-meta">${ postMeta( item ) }</span>
			<h3>${ item.title }</h3>
			${ item.excerpt ? html`<p>${ item.excerpt }</p>` : '' }
			<strong>${ __( 'Read more' ) } <span aria-hidden="true">↗</span></strong>
		</a>
	</article>
`;

const status = ( title: string, hint: string, role: string, extraClass = '', spinner = false ) => html`
	<div class=${ `os-settings__about-status${ extraClass }` } role=${ role } aria-live=${ role === 'status' ? 'polite' : null }>
		${ spinner
			? html`<span class="os-settings__about-spinner" aria-hidden="true"></span>`
			: html`<span class="dashicons dashicons-rss" aria-hidden="true"></span>` }
		<div>
			<strong>${ title }</strong>
			<span>${ hint }</span>
		</div>
	</div>
`;

function feedBody( state: AboutFeedState ): TemplateResult {
	if ( state.kind === 'loading' ) {
		return status(
			__( 'Opening the journal…' ),
			__( 'The latest posts are arriving over RSS.' ),
			'status',
			'',
			true,
		);
	}
	if ( state.kind === 'error' ) {
		return status(
			__( 'The journal could not be reached.' ),
			__( 'You can still read every post on openstation.blog.' ),
			'alert',
			' os-settings__about-status--error',
		);
	}
	if ( state.feed.items.length === 0 ) {
		return status(
			__( 'No dispatches yet.' ),
			__( 'The journal is open and waiting for its next post.' ),
			'status',
		);
	}
	const [ latest, ...more ] = state.feed.items;
	return html`
		${ state.feed.stale
			? html`<p class="os-settings__about-stale" role="status">
				${ __( 'Showing the last saved copy while the journal reconnects.' ) }
			</p>`
			: '' }
		<section class="os-settings__about-feed" aria-label=${ __( 'Latest journal posts' ) }>
			${ featuredPost( latest ) }
			${ more.length > 0 ? html`<div class="os-settings__about-grid" role="list">${ more.map( postCard ) }</div>` : '' }
		</section>
	`;
}

/** One complete state of the About page. Exported for DOM coverage. */
export function renderAbout(
	config: { pluginUrl?: string; pluginVersion?: string },
	state: AboutFeedState,
): TemplateResult {
	const feed = state.kind === 'ready' ? state.feed : null;
	const iconUrl = `${ config.pluginUrl ?? '' }/assets/images/openstation-mark.svg`;
	const version = config.pluginVersion ?? '';
	return html`
		<div class="os-settings__about-inner">
			<header class="os-settings__about-overview">
				<div class="os-settings__about-identity">
					<img src=${ iconUrl } alt="" width="64" height="64" />
					<div>
						<span class="os-settings__about-eyebrow">${ __( 'About OpenStation' ) }</span>
						<h2>${ __( 'A desktop for WordPress.' ) }</h2>
						<p>
							${ __( 'OpenStation reshapes wp-admin into a personal workspace, with movable windows, a dock, themes, and focused tools that keep your site close at hand.' ) }
						</p>
					</div>
				</div>
				<div class="os-settings__about-story">
					<p>
						${ __( 'It is a playful, open-source experiment by Automattic exploring what WordPress can feel like when the dashboard becomes a place of its own.' ) }
					</p>
					<div class="os-settings__about-meta">
						<span>
							<strong>OpenStation${ version ? ` ${ version }` : '' }</strong>
							<small>${ __( 'An experiment by Automattic' ) }</small>
						</span>
						<a href=${ PROJECT_URL } target="_blank" rel="noopener noreferrer">
							${ __( 'View the project' ) } <span aria-hidden="true">↗</span>
						</a>
					</div>
				</div>
			</header>
			<div class="os-settings__about-journal-head">
				<div>
					<span class="os-settings__about-eyebrow">${ __( 'OpenStation Journal' ) }</span>
					<h2>${ __( 'Latest from the station' ) }</h2>
					<p>${ feed?.description || __( 'A public dev diary — building a desktop OS for wp-admin.' ) }</p>
				</div>
				<a class="os-settings__about-journal-link" href=${ feed?.homeUrl || BLOG_URL } target="_blank" rel="noopener noreferrer">
					${ __( 'Visit the journal' ) } <span aria-hidden="true">↗</span>
				</a>
			</div>
			${ feedBody( state ) }
			<footer class="os-settings__about-footer">
				<p>
					<strong>${ __( 'OpenStation Journal' ) }</strong>
					<span>${ __( 'News and field notes, delivered over RSS.' ) }</span>
				</p>
				<a href=${ feed?.feedUrl || FEED_URL } target="_blank" rel="noopener noreferrer">
					<span class="dashicons dashicons-rss" aria-hidden="true"></span>
					${ __( 'RSS feed' ) }
				</a>
			</footer>
		</div>
	`;
}

/** The page: whatever state the feed is in (loading until first shown). */
export const renderAboutPage: Section = ( _s, ctx ) =>
	html`<div class="os-settings__about">${ renderAbout( extraOf( ctx ), uiOf( ctx ).about ?? { kind: 'loading' } ) }</div>`;

/** Fetch the feed the first time the page is on screen. Called after every paint. */
export function ensureAboutLoaded( ctx: Ctx ): void {
	const ui = uiOf( ctx );
	if ( ctx.state.tab !== 'about' || ui.about !== null ) {
		return;
	}
	ui.about = { kind: 'loading' };
	const url = extraOf( ctx ).aboutFeedUrl;
	if ( ! url ) {
		ui.about = { kind: 'error' };
		ctx.repaint();
		return;
	}
	void ( async () => {
		try {
			const response = await ctx.fetch( url, { credentials: 'same-origin' } );
			if ( ! response.ok ) {
				throw new Error( `about feed returned ${ response.status }` );
			}
			const result = ( await response.json() ) as { success?: boolean; data?: unknown };
			const feed = result.success ? normalizeAboutFeed( result.data ) : null;
			if ( ! feed ) {
				throw new Error( 'about feed returned an invalid payload' );
			}
			ui.about = { kind: 'ready', feed };
		} catch ( error ) {
			// eslint-disable-next-line no-console
			console.error( '[openstation/about] journal feed failed:', error );
			ui.about = { kind: 'error' };
		}
		ctx.repaint();
	} )();
}
