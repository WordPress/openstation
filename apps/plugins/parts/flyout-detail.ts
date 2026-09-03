/**
 * Plugins app — the detail flyout.
 *
 * Part of the `desktop-mode-plugins` client view. Slides in from the
 * inline-end edge over the active tab: a hero (banner + icon + name +
 * author + rating + installs), `<os-tabs>` for Overview / Screenshots
 * / Reviews / Changelog / FAQ, and an action footer pinned to the
 * bottom (Install / Activate / Deactivate / Delete + the wp.org link).
 * `plugin_information` fetches on open only; reviews on tab activation.
 *
 * @public
 */

import { __, sprintf } from '@openstation/app';
import { osIconSvg } from '../../../src/ui/icons';
import { buildStarCluster, pickIcon } from './card';
import { humanDate, sanitizeHtml } from './html';
import { activatePlugin, deactivatePlugin, deletePlugin, installBySlug } from './mutations';
import {
	describeError,
	isActiveStatus,
	stripHtml,
	type PluginsHost,
	type WpOrgBrowsePlugin,
	type WpOrgPluginInfo,
} from './types';
import '../../../src/ui/components/os-button/os-button';
import '../../../src/ui/components/os-tabs/os-tabs';

type DetailTab = 'overview' | 'screenshots' | 'reviews' | 'changelog' | 'faq';

/**
 * Open the flyout for a slug. The `<os-flyout data-os-plugins-flyout>`
 * is in the template; we paint into it. `hint` (a Browse row) paints
 * the hero eagerly so the user sees something immediately.
 */
export function openDetailFlyout(
	flyout: HTMLElement,
	slug: string,
	hint: WpOrgBrowsePlugin | undefined,
	host: PluginsHost,
): void {
	flyout.replaceChildren();

	const card = document.createElement( 'div' );
	card.className = 'os-plugins__flyout';
	const hero = buildHeroSkeleton( hint );
	const tabs = buildTabs();
	const body = document.createElement( 'div' );
	body.className = 'os-plugins__flyout-body';
	const footer = document.createElement( 'footer' );
	footer.className = 'os-plugins__flyout-footer';
	card.append( hero.root, tabs.root, body, footer );
	flyout.appendChild( card );
	flyout.setAttribute( 'open', '' );

	let info: WpOrgPluginInfo | null = null;
	const reviewsCache = { loaded: false };
	const refreshFooter = (): void => {
		paintFooter( footer, slug, info, host, () => flyout.removeAttribute( 'open' ), refreshFooter );
	};
	refreshFooter();

	tabs.onChange( ( tab ) => paintTabBody( body, tab, info, slug, reviewsCache, host ) );
	paintTabBody( body, 'overview', info, slug, reviewsCache, host );

	void ( async () => {
		try {
			info = await host.rest.fetchPluginInfo( slug );
			paintHero( hero, info );
			refreshFooter();
			paintTabBody( body, tabs.current(), info, slug, reviewsCache, host );
		} catch ( err ) {
			body.innerHTML = '';
			const failure = document.createElement( 'p' );
			failure.className = 'os-plugins__flyout-error';
			failure.textContent =
				err instanceof Error ? err.message : __( 'Could not load plugin details.', 'desktop-mode' );
			body.appendChild( failure );
		}
	} )();
}

interface HeroParts {
	root: HTMLElement;
	icon: HTMLElement;
	title: HTMLElement;
	byline: HTMLElement;
	stars: HTMLElement;
	meta: HTMLElement;
	banner: HTMLElement;
}

function buildHeroSkeleton( hint?: WpOrgBrowsePlugin ): HeroParts {
	const root = document.createElement( 'header' );
	root.className = 'os-plugins__flyout-hero';
	const banner = document.createElement( 'div' );
	banner.className = 'os-plugins__flyout-banner';
	root.appendChild( banner );

	const inner = document.createElement( 'div' );
	inner.className = 'os-plugins__flyout-hero-inner';
	const icon = document.createElement( 'div' );
	icon.className = 'os-plugins__flyout-hero-icon';
	const text = document.createElement( 'div' );
	text.className = 'os-plugins__flyout-hero-text';
	const title = document.createElement( 'h2' );
	title.className = 'os-plugins__flyout-hero-title';
	const byline = document.createElement( 'p' );
	byline.className = 'os-plugins__flyout-hero-byline';
	const meta = document.createElement( 'div' );
	meta.className = 'os-plugins__flyout-hero-meta';
	const stars = document.createElement( 'div' );
	stars.className = 'os-plugins__flyout-hero-stars';
	meta.appendChild( stars );
	text.append( title, byline, meta );
	inner.append( icon, text );
	root.appendChild( inner );

	// Circular glass close button, floating over the banner. A plain
	// `<button>` so every visual is inline-styleable; `data-flyout-close`
	// is the contract `<os-flyout>` listens for.
	const close = document.createElement( 'button' );
	close.type = 'button';
	close.className = 'os-plugins__flyout-close';
	close.setAttribute( 'data-flyout-close', '' );
	close.setAttribute( 'aria-label', __( 'Close plugin details', 'desktop-mode' ) );
	close.innerHTML = osIconSvg( 'close', { size: 20 } );
	root.appendChild( close );

	const parts = { root, icon, title, byline, stars, meta, banner };
	if ( hint ) {
		paintIdentity( parts, hint );
	}
	return parts;
}

function paintIdentity( parts: HeroParts, plugin: WpOrgBrowsePlugin ): void {
	parts.title.textContent = plugin.name;
	parts.byline.textContent = sprintf(
		/* translators: %s: plugin author */
		__( 'by %s', 'desktop-mode' ),
		stripHtml( plugin.author ?? '' ),
	);
	parts.icon.replaceChildren();
	const iconUrl = pickIcon( plugin.icons );
	if ( iconUrl ) {
		const img = document.createElement( 'img' );
		img.src = iconUrl;
		img.alt = '';
		parts.icon.appendChild( img );
	}
	parts.stars.replaceChildren( buildStarCluster( plugin.rating ?? 0, plugin.num_ratings ?? 0 ) );
}

function paintHero( parts: HeroParts, info: WpOrgPluginInfo ): void {
	paintIdentity( parts, info );
	const bannerUrl = info.banners?.high ?? info.banners?.low;
	if ( bannerUrl ) {
		parts.banner.style.backgroundImage = `url("${ bannerUrl }")`;
		parts.banner.classList.add( 'has-banner' );
	}
	parts.meta.querySelectorAll( ':scope > .os-plugins__flyout-meta-row' ).forEach( ( n ) => n.remove() );
	const metaRow = document.createElement( 'div' );
	metaRow.className = 'os-plugins__flyout-meta-row';
	const installs = document.createElement( 'span' );
	installs.textContent = sprintf(
		/* translators: %s: comma-grouped active install count */
		__( '%s+ active', 'desktop-mode' ),
		new Intl.NumberFormat().format( info.active_installs ?? 0 ),
	);
	const updated = document.createElement( 'span' );
	updated.textContent = sprintf(
		/* translators: %s: human-readable date string from wp.org */
		__( 'Updated %s', 'desktop-mode' ),
		humanDate( info.last_updated ),
	);
	metaRow.append( installs, updated );
	if ( info.tested ) {
		const tested = document.createElement( 'span' );
		tested.textContent = sprintf(
			/* translators: %s: maximum tested WordPress version */
			__( 'Tested up to WordPress %s', 'desktop-mode' ),
			info.tested,
		);
		metaRow.appendChild( tested );
	}
	parts.meta.appendChild( metaRow );
}

function buildTabs(): {
	root: HTMLElement;
	current: () => DetailTab;
	onChange: ( cb: ( tab: DetailTab ) => void ) => void;
	} {
	const root = document.createElement( 'os-tabs' );
	root.className = 'os-plugins__flyout-tabs';
	root.setAttribute( 'value', 'overview' );
	const labels: Array< { value: DetailTab; label: string } > = [
		{ value: 'overview', label: __( 'Overview', 'desktop-mode' ) },
		{ value: 'screenshots', label: __( 'Screenshots', 'desktop-mode' ) },
		{ value: 'reviews', label: __( 'Reviews', 'desktop-mode' ) },
		{ value: 'changelog', label: __( 'Changelog', 'desktop-mode' ) },
		{ value: 'faq', label: __( 'FAQ', 'desktop-mode' ) },
	];
	for ( const opt of labels ) {
		const tab = document.createElement( 'os-tab' );
		tab.setAttribute( 'value', opt.value );
		tab.textContent = opt.label;
		root.appendChild( tab );
	}
	let current: DetailTab = 'overview';
	const subscribers = new Set<( tab: DetailTab ) => void >();
	root.addEventListener( 'os-tab-change', ( ev: Event ) => {
		const detail = ( ev as CustomEvent< { value: string } > ).detail;
		current = ( detail?.value ?? 'overview' ) as DetailTab;
		for ( const cb of subscribers ) {
			cb( current );
		}
	} );
	return { root, current: () => current, onChange: ( cb ) => subscribers.add( cb ) };
}

function paintTabBody(
	body: HTMLElement,
	tab: DetailTab,
	info: WpOrgPluginInfo | null,
	slug: string,
	reviewsCache: { loaded: boolean },
	host: PluginsHost,
): void {
	body.replaceChildren();
	if ( ! info ) {
		body.appendChild( buildSkeletonLines( 4 ) );
		return;
	}
	if ( tab === 'overview' ) {
		body.appendChild( buildHtmlSection( info.sections?.description ?? info.short_description ?? '' ) );
	} else if ( tab === 'screenshots' ) {
		body.appendChild( buildScreenshots( info.screenshots ) );
	} else if ( tab === 'changelog' ) {
		body.appendChild( buildHtmlSection( info.sections?.changelog ?? '' ) );
	} else if ( tab === 'faq' ) {
		body.appendChild( buildHtmlSection( info.sections?.faq ?? '' ) );
	} else {
		body.appendChild( buildRatingsHistogram( info ) );
		body.appendChild( buildReviewsList( slug, reviewsCache, host ) );
	}
}

function buildReviewsList( slug: string, reviewsCache: { loaded: boolean }, host: PluginsHost ): HTMLElement {
	const list = document.createElement( 'div' );
	list.className = 'os-plugins__reviews-list';
	const loadingLine = document.createElement( 'p' );
	loadingLine.className = 'os-plugins__reviews-loading';
	loadingLine.textContent = __( 'Loading recent reviews…', 'desktop-mode' );
	list.appendChild( loadingLine );
	if ( reviewsCache.loaded ) {
		return list;
	}
	void ( async () => {
		try {
			const resp = await host.rest.fetchPluginReviews( slug );
			list.replaceChildren();
			if ( ! resp.parsed || resp.items.length === 0 ) {
				const fallback = document.createElement( 'p' );
				fallback.className = 'os-plugins__reviews-fallback';
				fallback.innerHTML = sprintf(
					/* translators: %s: anchor tag with link to wp.org reviews */
					__( 'Recent reviews aren’t available right now. %s', 'desktop-mode' ),
					`<a href="https://wordpress.org/plugins/${ encodeURIComponent(
						slug,
					) }/#reviews" target="_blank" rel="noopener">${ __( 'Read reviews on WordPress.org ↗', 'desktop-mode' ) }</a>`,
				);
				list.appendChild( fallback );
			} else {
				for ( const item of resp.items ) {
					list.appendChild( buildReviewCard( item ) );
				}
			}
			reviewsCache.loaded = true;
		} catch {
			list.replaceChildren();
			const failure = document.createElement( 'p' );
			failure.className = 'os-plugins__reviews-fallback';
			failure.textContent = __( 'Could not load reviews.', 'desktop-mode' );
			list.appendChild( failure );
		}
	} )();
	return list;
}

function buildHtmlSection( html: string ): HTMLElement {
	const wrap = document.createElement( 'div' );
	wrap.className = 'os-plugins__html';
	if ( ! html ) {
		wrap.appendChild( emptyLine( __( 'No content available.', 'desktop-mode' ) ) );
		return wrap;
	}
	wrap.innerHTML = sanitizeHtml( html );
	openLinksInNewTab( wrap );
	return wrap;
}

function openLinksInNewTab( wrap: HTMLElement ): void {
	wrap.querySelectorAll( 'a' ).forEach( ( a ) => {
		a.setAttribute( 'target', '_blank' );
		a.setAttribute( 'rel', 'noopener nofollow' );
	} );
}

function emptyLine( text: string ): HTMLElement {
	const empty = document.createElement( 'p' );
	empty.className = 'os-plugins__empty-line';
	empty.textContent = text;
	return empty;
}

function buildScreenshots( shots: Record< string, { src: string; caption: string } > | undefined ): HTMLElement {
	const wrap = document.createElement( 'div' );
	wrap.className = 'os-plugins__screenshots';
	const items = shots ? Object.values( shots ) : [];
	if ( items.length === 0 ) {
		wrap.appendChild( emptyLine( __( 'This plugin doesn’t ship screenshots.', 'desktop-mode' ) ) );
		return wrap;
	}
	for ( const shot of items ) {
		const fig = document.createElement( 'figure' );
		fig.className = 'os-plugins__screenshot';
		const img = document.createElement( 'img' );
		img.src = shot.src;
		img.loading = 'lazy';
		img.alt = shot.caption ?? '';
		fig.appendChild( img );
		if ( shot.caption ) {
			const cap = document.createElement( 'figcaption' );
			cap.innerHTML = sanitizeHtml( shot.caption );
			openLinksInNewTab( cap );
			fig.appendChild( cap );
		}
		wrap.appendChild( fig );
	}
	return wrap;
}

function buildRatingsHistogram( info: WpOrgPluginInfo ): HTMLElement {
	const wrap = document.createElement( 'div' );
	wrap.className = 'os-plugins__histogram';
	const ratings = info.ratings ?? {};
	const total = Object.values( ratings ).reduce( ( a, b ) => a + ( typeof b === 'number' ? b : 0 ), 0 );
	if ( total === 0 ) {
		wrap.appendChild( emptyLine( __( 'No ratings yet.', 'desktop-mode' ) ) );
		return wrap;
	}
	for ( let star = 5; star >= 1; star-- ) {
		const count = ratings[ String( star ) ] ?? 0;
		const row = document.createElement( 'div' );
		row.className = 'os-plugins__histogram-row';
		const label = document.createElement( 'span' );
		label.className = 'os-plugins__histogram-label';
		label.textContent = sprintf(
			/* translators: %d: number of stars (1–5) */
			__( '%d ★', 'desktop-mode' ),
			star,
		);
		const track = document.createElement( 'span' );
		track.className = 'os-plugins__histogram-track';
		const fill = document.createElement( 'span' );
		fill.className = 'os-plugins__histogram-fill';
		fill.style.width = `${ Math.round( ( count / total ) * 100 ) }%`;
		track.appendChild( fill );
		const num = document.createElement( 'span' );
		num.className = 'os-plugins__histogram-count';
		num.textContent = new Intl.NumberFormat().format( count );
		row.append( label, track, num );
		wrap.appendChild( row );
	}
	return wrap;
}

function buildReviewCard( item: { author: string; stars: number; excerpt: string; date: string; url: string } ): HTMLElement {
	const card = document.createElement( 'article' );
	card.className = 'os-plugins__review';
	const head = document.createElement( 'header' );
	head.className = 'os-plugins__review-head';
	const author = document.createElement( 'span' );
	author.className = 'os-plugins__review-author';
	author.textContent = item.author || __( 'Anonymous', 'desktop-mode' );
	head.append( author, buildStarCluster( ( item.stars / 5 ) * 100, 0 ) );
	if ( item.date ) {
		const date = document.createElement( 'time' );
		date.className = 'os-plugins__review-date';
		date.textContent = item.date;
		head.appendChild( date );
	}
	const body = document.createElement( 'p' );
	body.className = 'os-plugins__review-excerpt';
	body.textContent = item.excerpt;
	card.append( head, body );
	if ( item.url ) {
		const link = document.createElement( 'a' );
		link.href = item.url;
		link.target = '_blank';
		link.rel = 'noopener nofollow';
		link.textContent = __( 'Read on WordPress.org ↗', 'desktop-mode' );
		link.className = 'os-plugins__review-link';
		card.appendChild( link );
	}
	return card;
}

function buildSkeletonLines( count: number ): HTMLElement {
	const wrap = document.createElement( 'div' );
	wrap.className = 'os-plugins__skeleton';
	for ( let i = 0; i < count; i++ ) {
		const line = document.createElement( 'span' );
		line.className = 'os-plugins__skeleton-line';
		line.style.width = `${ 60 + ( ( i * 10 ) % 40 ) }%`;
		wrap.appendChild( line );
	}
	return wrap;
}

function paintFooter(
	footer: HTMLElement,
	slug: string,
	info: WpOrgPluginInfo | null,
	host: PluginsHost,
	close: () => void,
	repaint: () => void,
): void {
	footer.replaceChildren();
	const caps = host.extra.caps;
	const installed = host.installedFor( slug );

	const left = document.createElement( 'div' );
	left.className = 'os-plugins__flyout-footer-left';
	const wpOrg = document.createElement( 'a' );
	wpOrg.href = `https://wordpress.org/plugins/${ encodeURIComponent( slug ) }/`;
	wpOrg.target = '_blank';
	wpOrg.rel = 'noopener';
	wpOrg.className = 'os-plugins__flyout-wporg';
	wpOrg.textContent = __( 'View on WordPress.org ↗', 'desktop-mode' );
	left.appendChild( wpOrg );

	const right = document.createElement( 'div' );
	right.className = 'os-plugins__flyout-footer-right';

	const button = ( label: string, variant: string, onClick: () => void ): void => {
		const b = document.createElement( 'os-button' );
		b.setAttribute( 'variant', variant );
		b.textContent = label;
		b.addEventListener( 'click', onClick );
		right.appendChild( b );
	};

	if ( installed ) {
		if ( caps.activate ) {
			if ( isActiveStatus( installed.status ) ) {
				button( __( 'Deactivate', 'desktop-mode' ), 'secondary', () => {
					void deactivatePlugin( host, installed ).then( repaint );
				} );
			} else {
				button( __( 'Activate', 'desktop-mode' ), 'primary', () => {
					void activatePlugin( host, installed ).then( repaint );
				} );
			}
		}
		if ( caps.delete && installed.status === 'inactive' ) {
			button( __( 'Delete', 'desktop-mode' ), 'danger', () => {
				void deletePlugin( host, installed ).then( ( ok ) => {
					if ( ok ) {
						close();
					}
				} );
			} );
		}
	} else if ( caps.install ) {
		button( __( 'Install', 'desktop-mode' ), 'primary', () => {
			const btn = right.querySelector< HTMLElement >( 'os-button' );
			btn?.setAttribute( 'busy', '' );
			btn?.setAttribute( 'disabled', '' );
			if ( btn ) {
				btn.textContent = __( 'Installing…', 'desktop-mode' );
			}
			// Either way the footer repaints: Activate on success, the
			// Install button back on failure (the toast said why).
			void installBySlug( host, slug, info?.name ?? slug )
				.catch( ( err ) => host.toast( describeError( err ), 6000 ) )
				.finally( repaint );
		} );
	}

	footer.append( left, right );
}
