/**
 * About — the OpenStation journal, sourced from the public RSS feed.
 *
 * The browser does not call the cross-origin feed directly. PHP fetches and
 * normalizes it behind an authenticated admin-AJAX URL, and this section waits
 * until its hidden tab has a real layout box before making that request. That
 * keeps the shell boot path independent from the remote blog.
 */

import { __, sprintf } from '../../i18n';
import { trackedFetch } from '../../tracked-fetch';
import { html, render, type TemplateResult } from '../../ui/core';

const BLOG_URL = 'https://openstation.blog/';
const FEED_URL = 'https://openstation.blog/feed/';
const PROJECT_URL = 'https://github.com/WordPress/openstation/';

export interface DesktopGlobalShape {
	pluginUrl?: string;
	pluginVersion?: string;
	aboutFeedUrl?: string;
}

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

/** Resolve when a section hidden inside a tab first becomes visible. */
function waitForSize( el: HTMLElement, signal: AbortSignal ): Promise<void> {
	if ( el.clientWidth > 0 && el.clientHeight > 0 ) {
		return Promise.resolve();
	}
	return new Promise( ( resolve ) => {
		const finish = (): void => {
			observer.disconnect();
			signal.removeEventListener( 'abort', finish );
			resolve();
		};
		const observer = new ResizeObserver( () => {
			if ( el.clientWidth > 0 && el.clientHeight > 0 ) {
				finish();
			}
		} );
		signal.addEventListener( 'abort', finish, { once: true } );
		observer.observe( el );
	} );
}

/** Accept only browser-safe HTTP(S) links from the remote payload. */
function httpUrl( value: unknown ): string {
	if ( typeof value !== 'string' || value === '' ) {
		return '';
	}
	try {
		const url = new URL( value, window.location.href );
		return url.protocol === 'http:' || url.protocol === 'https:'
			? url.href
			: '';
	} catch {
		return '';
	}
}

function text( value: unknown ): string {
	return typeof value === 'string' ? value.trim() : '';
}

/** Runtime-check the private AJAX response before threading it into the DOM. */
export function normalizeAboutFeed( value: unknown ): AboutFeed | null {
	if ( ! value || typeof value !== 'object' ) {
		return null;
	}
	const raw = value as Record<string, unknown>;
	const rawItems = Array.isArray( raw.items ) ? raw.items : [];
	const items = rawItems
		.map( ( entry ): AboutFeedItem | null => {
			if ( ! entry || typeof entry !== 'object' ) {
				return null;
			}
			const item = entry as Record<string, unknown>;
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
			text( raw.description ) ||
			__( 'A public dev diary — building a desktop OS for wp-admin.' ),
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
	return date.toLocaleDateString( undefined, {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
	} );
}

function postMeta( item: AboutFeedItem ): string {
	const date = formatDate( item.publishedAt );
	if ( date && item.author ) {
		// translators: 1: publication date, 2: post author.
		return sprintf( '%1$s · %2$s', date, item.author );
	}
	return date || item.author;
}

function featuredPost( item: AboutFeedItem ): TemplateResult {
	return html`
		<article class="os-settings__about-featured">
			<a href=${ item.url } target="_blank" rel="noopener noreferrer">
				<div class="os-settings__about-featured-copy">
					<span class="os-settings__about-kicker"
						>${ __( 'Latest dispatch' ) }</span
					>
					<h3>${ item.title }</h3>
					${ item.excerpt ? html`<p>${ item.excerpt }</p>` : html`` }
				</div>
				<footer>
					<span>${ postMeta( item ) }</span>
					<strong
						>${ __( 'Read the dispatch' ) }
						<span aria-hidden="true">↗</span></strong
					>
				</footer>
			</a>
		</article>
	`;
}

function postCard( item: AboutFeedItem ): TemplateResult {
	return html`
		<article class="os-settings__about-card" role="listitem">
			<a href=${ item.url } target="_blank" rel="noopener noreferrer">
				<span class="os-settings__about-card-meta"
					>${ postMeta( item ) }</span
				>
				<h3>${ item.title }</h3>
				${ item.excerpt ? html`<p>${ item.excerpt }</p>` : html`` }
				<strong
					>${ __( 'Read more' ) }
					<span aria-hidden="true">↗</span></strong
				>
			</a>
		</article>
	`;
}

function feedBody( state: AboutFeedState ): TemplateResult {
	if ( state.kind === 'loading' ) {
		return html`
			<div
				class="os-settings__about-status"
				role="status"
				aria-live="polite"
			>
				<span
					class="os-settings__about-spinner"
					aria-hidden="true"
				></span>
				<div>
					<strong>${ __( 'Opening the journal…' ) }</strong>
					<span
						>${ __( 'The latest posts are arriving over RSS.' ) }</span
					>
				</div>
			</div>
		`;
	}

	if ( state.kind === 'error' ) {
		return html`
			<div
				class="os-settings__about-status os-settings__about-status--error"
				role="alert"
			>
				<span class="dashicons dashicons-rss" aria-hidden="true"></span>
				<div>
					<strong>${ __( 'The journal could not be reached.' ) }</strong>
					<span
						>${ __(
							'You can still read every post on openstation.blog.',
						) }</span
					>
				</div>
			</div>
		`;
	}

	if ( state.feed.items.length === 0 ) {
		return html`
			<div class="os-settings__about-status" role="status">
				<span class="dashicons dashicons-rss" aria-hidden="true"></span>
				<div>
					<strong>${ __( 'No dispatches yet.' ) }</strong>
					<span
						>${ __(
							'The journal is open and waiting for its next post.',
						) }</span
					>
				</div>
			</div>
		`;
	}

	const [ latest, ...more ] = state.feed.items;
	return html`
		${ state.feed.stale
			? html`<p class="os-settings__about-stale" role="status">
					${ __(
						'Showing the last saved copy while the journal reconnects.',
					) }
				</p>`
			: html`` }
		<section
			class="os-settings__about-feed"
			aria-label=${ __( 'Latest journal posts' ) }
		>
			${ featuredPost( latest ) }
			${ more.length > 0
				? html`<div class="os-settings__about-grid" role="list">
						${ more.map( postCard ) }
					</div>`
				: html`` }
		</section>
	`;
}

/** Paint one complete state of the About page. Exported for DOM coverage. */
export function paintAboutSection(
	wrapper: HTMLElement,
	config: DesktopGlobalShape,
	state: AboutFeedState,
): void {
	const feed = state.kind === 'ready' ? state.feed : null;
	const journalUrl = feed?.homeUrl || BLOG_URL;
	const feedUrl = feed?.feedUrl || FEED_URL;
	const description =
		feed?.description ||
		__( 'A public dev diary — building a desktop OS for wp-admin.' );
	const iconUrl = `${ config.pluginUrl ?? '' }/assets/images/openstation-mark.svg`;
	const version = config.pluginVersion ?? '';

	render(
		html`
			<div class="os-settings__about-inner">
				<header class="os-settings__about-overview">
					<div class="os-settings__about-identity">
						<img src=${ iconUrl } alt="" width="64" height="64" />
						<div>
							<span class="os-settings__about-eyebrow"
								>${ __( 'About OpenStation' ) }</span
							>
							<h2>${ __( 'A desktop for WordPress.' ) }</h2>
							<p>
								${ __(
									'OpenStation reshapes wp-admin into a personal workspace, with movable windows, a dock, themes, and focused tools that keep your site close at hand.',
								) }
							</p>
						</div>
					</div>
					<div class="os-settings__about-story">
						<p>
							${ __(
								'It is a playful, open-source experiment by Automattic exploring what WordPress can feel like when the dashboard becomes a place of its own.',
							) }
						</p>
						<div class="os-settings__about-meta">
							<span>
								<strong
									>OpenStation${ version
										? ` ${ version }`
										: '' }</strong
								>
								<small
									>${ __( 'An experiment by Automattic' ) }</small
								>
							</span>
							<a
								href=${ PROJECT_URL }
								target="_blank"
								rel="noopener noreferrer"
							>
								${ __( 'View the project' ) }
								<span aria-hidden="true">↗</span>
							</a>
						</div>
					</div>
				</header>

				<div class="os-settings__about-journal-head">
					<div>
						<span class="os-settings__about-eyebrow"
							>${ __( 'OpenStation Journal' ) }</span
						>
						<h2>${ __( 'Latest from the station' ) }</h2>
						<p>${ description }</p>
					</div>
					<a
						class="os-settings__about-journal-link"
						href=${ journalUrl }
						target="_blank"
						rel="noopener noreferrer"
					>
						${ __( 'Visit the journal' ) }
						<span aria-hidden="true">↗</span>
					</a>
				</div>

				${ feedBody( state ) }

				<footer class="os-settings__about-footer">
					<p>
						<strong>${ __( 'OpenStation Journal' ) }</strong>
						<span
							>${ __(
								'News and field notes, delivered over RSS.',
							) }</span
						>
					</p>
					<a
						href=${ feedUrl }
						target="_blank"
						rel="noopener noreferrer"
					>
						<span
							class="dashicons dashicons-rss"
							aria-hidden="true"
						></span>
						${ __( 'RSS feed' ) }
					</a>
				</footer>
			</div>
		`,
		wrapper,
	);
}

/** Build the About section and load its RSS data on first visibility. */
export function buildAboutSection(): HTMLElement {
	const wrapper = document.createElement( 'div' );
	wrapper.classList.add( 'os-settings__about' );

	const config =
		( window as unknown as { openStationConfig?: DesktopGlobalShape } )
			.openStationConfig ?? {};
	paintAboutSection( wrapper, config, { kind: 'loading' } );

	const controller = new AbortController();
	let disconnected = false;

	const load = async (): Promise<void> => {
		await waitForSize( wrapper, controller.signal );
		if ( disconnected || ! wrapper.isConnected ) {
			return;
		}
		if ( ! config.aboutFeedUrl ) {
			paintAboutSection( wrapper, config, { kind: 'error' } );
			return;
		}

		try {
			const response = await trackedFetch(
				config.aboutFeedUrl,
				{
					credentials: 'same-origin',
					signal: controller.signal,
				},
				{
					windowId: 'desktop-mode-os-settings',
					source: 'openstation/about-feed',
				},
			);
			if ( ! response.ok ) {
				throw new Error( `about feed returned ${ response.status }` );
			}
			const result = ( await response.json() ) as {
				success?: boolean;
				data?: unknown;
			};
			const feed = result.success
				? normalizeAboutFeed( result.data )
				: null;
			if ( ! feed ) {
				throw new Error( 'about feed returned an invalid payload' );
			}
			if ( ! disconnected && wrapper.isConnected ) {
				paintAboutSection( wrapper, config, { kind: 'ready', feed } );
			}
		} catch ( error ) {
			if ( controller.signal.aborted || disconnected ) {
				return;
			}
			if ( typeof console !== 'undefined' ) {
				// eslint-disable-next-line no-console
				console.error(
					'[openstation/about] journal feed failed:',
					error,
				);
			}
			paintAboutSection( wrapper, config, { kind: 'error' } );
		}
	};

	requestAnimationFrame( () => {
		void load();
	} );

	const observer = new MutationObserver( () => {
		if ( ! wrapper.isConnected ) {
			disconnected = true;
			controller.abort();
			observer.disconnect();
		}
	} );
	observer.observe( document.body, { childList: true, subtree: true } );

	return wrapper;
}
