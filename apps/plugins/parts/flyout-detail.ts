/**
 * Plugins app — the detail flyout.
 *
 * Part of the `desktop-mode-plugins` client view. Slides in from the
 * inline-end edge over the active tab: a hero (banner + icon + name +
 * author + rating + installs), `<os-tabs>` for Overview / Screenshots
 * / Reviews / Changelog / FAQ, and an action footer pinned to the
 * bottom (Install, or the same verbs the table offers, plus the wp.org
 * link). `plugin_information` fetches on open only (cached per slug
 * for the window); reviews on tab activation. Every open takes a new
 * generation, so a slow fetch for one slug never paints into the
 * next.
 *
 * @public
 */

import { __, formatDate, sprintf } from '@openstation/app';
import { osIconSvg } from '../../../src/ui/icons';
// The flyout paints under an `os-preserve` host, outside the runtime's
// on-demand component loading — the tags it builds register here.
import '../../../src/ui/components/os-tabs/os-tabs';
import { pluginActionButtons, setBusy } from './actions';
import { buildStarCluster, pickIcon } from './card';
import { externalLink, htmlBlock, sanitizeHtml, sanitizeLinks, stripHtml, wpOrgUrl } from './html';
import { installBySlug } from './mutations';
import { REVIEW_STYLES, renderReviews } from './reviews';
import { describeError, type PluginsHost, type WpOrgBrowsePlugin, type WpOrgPluginInfo } from './types';

type DetailTab = 'overview' | 'screenshots' | 'reviews' | 'changelog' | 'faq';

/** The open the flyout is currently showing; a newer open supersedes it. */
let generation = 0;

/**
 * Open the flyout for a slug. The `<os-flyout data-os-plugins-flyout>`
 * is in the view; we paint into it. `hint` (a Browse row) paints the
 * hero eagerly so the user sees something immediately.
 */
export function openDetailFlyout(
	flyout: HTMLElement,
	slug: string,
	hint: WpOrgBrowsePlugin | undefined,
	host: PluginsHost,
): void {
	const mine = ++generation;
	const current = (): boolean => mine === generation && flyout.isConnected;
	flyout.replaceChildren();

	const card = document.createElement( 'div' );
	card.className = 'os-plugins__flyout';
	const style = document.createElement( 'style' );
	style.textContent = REVIEW_STYLES;
	const hero = buildHeroSkeleton( hint );
	const tabs = buildTabs();
	const body = document.createElement( 'div' );
	body.className = 'os-plugins__flyout-body';
	const footer = document.createElement( 'footer' );
	footer.className = 'os-plugins__flyout-footer';
	card.append( style, hero.root, tabs.root, body, footer );
	flyout.appendChild( card );
	flyout.setAttribute( 'open', '' );

	let info: WpOrgPluginInfo | null = host.caches.info.get( slug ) ?? null;
	const refreshFooter = (): void => {
		paintFooter( footer, slug, info, host, () => flyout.removeAttribute( 'open' ), refreshFooter );
	};
	refreshFooter();

	const paint = ( tab: DetailTab ): void => paintTabBody( body, tab, info, slug, host );
	tabs.onChange( paint );
	if ( info ) {
		paintHero( hero, info );
	}
	paint( 'overview' );

	if ( info ) {
		return;
	}
	void ( async () => {
		try {
			const fetched = await host.rest.fetchPluginInfo( slug );
			host.caches.info.set( slug, fetched );
			if ( ! current() ) {
				return;
			}
			info = fetched;
			paintHero( hero, info );
			refreshFooter();
			paint( tabs.current() );
		} catch ( err ) {
			if ( ! current() ) {
				return;
			}
			const failure = document.createElement( 'p' );
			failure.className = 'os-plugins__flyout-error';
			failure.textContent = err instanceof Error ? err.message : __( 'Could not load plugin details.', 'desktop-mode' );
			body.replaceChildren( failure );
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
	const stars = document.createElement( 'div' );
	meta.appendChild( stars );
	text.append( title, byline, meta );
	inner.append( icon, text );
	root.appendChild( inner );

	// Circular glass close button, floating over the banner.
	// `data-flyout-close` is the contract `<os-flyout>` listens for.
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
		/* translators: %s: date the plugin was last updated */
		__( 'Updated %s', 'desktop-mode' ),
		info.last_updated ? formatDate( info.last_updated.slice( 0, 10 ), 'long' ) : '—',
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

function paintTabBody( body: HTMLElement, tab: DetailTab, info: WpOrgPluginInfo | null, slug: string, host: PluginsHost ): void {
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
		body.appendChild( renderReviews( host, slug, info ) );
	}
}

function buildHtmlSection( html: string ): HTMLElement {
	if ( ! html ) {
		const wrap = document.createElement( 'div' );
		wrap.className = 'os-plugins__html';
		wrap.appendChild( emptyLine( __( 'No content available.', 'desktop-mode' ) ) );
		return wrap;
	}
	return htmlBlock( html, 'os-plugins__html' );
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
		img.alt = stripHtml( shot.caption ?? '' );
		fig.appendChild( img );
		if ( shot.caption ) {
			const cap = document.createElement( 'figcaption' );
			cap.innerHTML = sanitizeHtml( shot.caption );
			sanitizeLinks( cap );
			fig.appendChild( cap );
		}
		wrap.appendChild( fig );
	}
	return wrap;
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
	left.appendChild( externalLink( wpOrgUrl( slug ), __( 'View on WordPress.org ↗', 'desktop-mode' ), 'os-plugins__flyout-wporg' ) );

	const right = document.createElement( 'div' );
	right.className = 'os-plugins__flyout-footer-right';

	if ( installed ) {
		right.append(
			...pluginActionButtons( host, installed, {
				size: '',
				onDone: ( ok, verb ) => {
					if ( ok && verb === 'delete' ) {
						close();
					} else {
						repaint();
					}
				},
			} ),
		);
	} else if ( caps.install ) {
		const btn = document.createElement( 'os-button' );
		btn.setAttribute( 'variant', 'primary' );
		btn.textContent = __( 'Install', 'desktop-mode' );
		btn.addEventListener( 'click', () => {
			setBusy( btn, __( 'Installing…', 'desktop-mode' ) );
			// Either way the footer repaints: Activate on success, the
			// Install button back on failure (the toast said why).
			void installBySlug( host, slug, info?.name ?? slug )
				.catch( ( err ) => host.toast( describeError( err ), 6000 ) )
				.finally( repaint );
		} );
		right.appendChild( btn );
	}

	footer.append( left, right );
}
