/**
 * Native Plugins window — detail flyout.
 *
 * Slides in from the inline-end edge over the active tab. Sticky
 * hero (banner background + icon + name + author + rating + active
 * installs) plus `<wpd-tabs>` for Overview / Screenshots / Reviews /
 * Changelog / FAQ. Action footer pinned to the bottom: Install /
 * Activate / Deactivate / Delete + a "View on WordPress.org" link.
 *
 * `plugin_information` lazy-fetches on flyout open ONLY (never per
 * card). Reviews lazy-fetch on Reviews tab activation.
 *
 * @public
 * @since 0.9.0
 */

import { __, sprintf } from '../i18n';
import { buildStarCluster, pickIcon } from './card';
import {
	activateInstalledPlugin,
	deactivateInstalledPlugin,
	deleteInstalledPlugin,
	fetchPluginInfo,
	fetchPluginReviews,
	getConfig,
	installPluginBySlug,
	refreshFrameworkMenu,
} from './rest';
import type {
	InstalledPlugin,
	WpOrgBrowsePlugin,
	WpOrgPluginInfo,
} from './types';

interface FlyoutCallbacks {
	getInstalled: ( slug: string ) => InstalledPlugin | undefined;
	onPluginInstalled: ( pluginFile: string, slug: string ) => Promise< void >;
	onPluginActivated: ( plugin: InstalledPlugin ) => void;
	onPluginDeactivated: ( plugin: InstalledPlugin ) => void;
	onPluginDeleted: ( plugin: InstalledPlugin ) => void;
}

/** Toast helper, shell-routed when available. */
function toast( message: string, duration = 3500 ): void {
	const api = window.wp?.desktop;
	if ( api && typeof api.showToast === 'function' ) {
		api.showToast( { message, duration } );
		return;
	}
	// eslint-disable-next-line no-console
	console.log( '[plugins-window]', message );
}

/** Confirm-dialog helper, shell-routed when available. */
async function confirm( opts: {
	title?: string;
	message: string;
	confirmLabel?: string;
	danger?: boolean;
} ): Promise< boolean > {
	const api = window.wp?.desktop;
	if ( api && typeof api.confirm === 'function' ) {
		return api.confirm( opts );
	}
	return Promise.resolve( true );
}

/**
 * Open the detail flyout for the given slug. The flyout element is
 * already in the template (`data-desktop-mode-plugins-flyout`) — we
 * paint into it.
 */
export function openDetailFlyout(
	flyout: HTMLElement,
	slug: string,
	hint: WpOrgBrowsePlugin | undefined,
	callbacks: FlyoutCallbacks,
): void {
	flyout.replaceChildren();

	const card = document.createElement( 'div' );
	card.className = 'desktop-mode-plugins__flyout';

	// Build skeleton sections; we'll fill in once `plugin_information`
	// resolves, but render the hint header eagerly so the user sees
	// something IMMEDIATELY (no flash-of-empty).
	const hero = buildHeroSkeleton( hint );
	const tabs = buildTabs();
	const body = document.createElement( 'div' );
	body.className = 'desktop-mode-plugins__flyout-body';
	const footer = document.createElement( 'footer' );
	footer.className = 'desktop-mode-plugins__flyout-footer';

	card.append( hero.root, tabs.root, body, footer );
	flyout.appendChild( card );
	flyout.setAttribute( 'open', '' );

	let info: WpOrgPluginInfo | null = null;
	const reviewsCache = { loaded: false };

	const refreshFooter = (): void => {
		paintFooter( footer, slug, info, callbacks, () => closeFlyout( flyout ) );
	};
	refreshFooter();

	tabs.onChange( ( tab ) => {
		paintTabBody( body, tab, info, slug, reviewsCache );
	} );

	// Initial body — Overview shows the skeleton hint description until
	// `plugin_information` lands.
	paintTabBody( body, 'overview', info, slug, reviewsCache );

	// Lazy-fetch the rich detail.
	void ( async () => {
		try {
			info = await fetchPluginInfo( slug );
			paintHero( hero, info );
			refreshFooter();
			const current = tabs.current();
			paintTabBody( body, current, info, slug, reviewsCache );
		} catch ( err ) {
			body.innerHTML = '';
			const failure = document.createElement( 'p' );
			failure.className = 'desktop-mode-plugins__flyout-error';
			failure.textContent =
				err instanceof Error
					? err.message
					: __( 'Could not load plugin details.', 'desktop-mode' );
			body.appendChild( failure );
		}
	} )();
}

function closeFlyout( flyout: HTMLElement ): void {
	flyout.removeAttribute( 'open' );
}

function buildHeroSkeleton( hint?: WpOrgBrowsePlugin ): {
	root: HTMLElement;
	icon: HTMLElement;
	title: HTMLElement;
	byline: HTMLElement;
	stars: HTMLElement;
	meta: HTMLElement;
	banner: HTMLElement;
} {
	const root = document.createElement( 'header' );
	root.className = 'desktop-mode-plugins__flyout-hero';

	const banner = document.createElement( 'div' );
	banner.className = 'desktop-mode-plugins__flyout-banner';
	root.appendChild( banner );

	const inner = document.createElement( 'div' );
	inner.className = 'desktop-mode-plugins__flyout-hero-inner';

	const icon = document.createElement( 'div' );
	icon.className = 'desktop-mode-plugins__flyout-hero-icon';

	const text = document.createElement( 'div' );
	text.className = 'desktop-mode-plugins__flyout-hero-text';
	const title = document.createElement( 'h2' );
	title.className = 'desktop-mode-plugins__flyout-hero-title';
	const byline = document.createElement( 'p' );
	byline.className = 'desktop-mode-plugins__flyout-hero-byline';
	const meta = document.createElement( 'div' );
	meta.className = 'desktop-mode-plugins__flyout-hero-meta';
	const stars = document.createElement( 'div' );
	stars.className = 'desktop-mode-plugins__flyout-hero-stars';
	meta.appendChild( stars );

	text.append( title, byline, meta );
	inner.append( icon, text );

	root.appendChild( inner );

	// Circular glass close button — pinned top-right, floats over the
	// banner. Plain `<button>` so we can inline-style every visual
	// without fighting `<wpd-button>`'s own padding/min-width. The
	// `data-flyout-close` attribute is the contract `<wpd-flyout>`
	// listens for, so the click still wires up to the framework's
	// dismiss flow.
	const close = document.createElement( 'button' );
	close.type = 'button';
	close.className = 'desktop-mode-plugins__flyout-close';
	close.setAttribute( 'data-flyout-close', '' );
	close.setAttribute(
		'aria-label',
		__( 'Close plugin details', 'desktop-mode' ),
	);
	// Stroke-based X — crisp at every DPR, scales with the button's
	// `color` so the glass works in both light and color-scheme
	// backgrounds.
	close.innerHTML =
		'<svg viewBox="0 0 24 24" width="14" height="14" fill="none" ' +
		'stroke="currentColor" stroke-width="2.4" stroke-linecap="round" ' +
		'aria-hidden="true">' +
		'<path d="M18 6 L6 18"></path>' +
		'<path d="M6 6 L18 18"></path>' +
		'</svg>';
	root.appendChild( close );

	if ( hint ) {
		title.textContent = hint.name;
		byline.textContent = sprintf(
			/* translators: %s: plugin author */
			__( 'by %s', 'desktop-mode' ),
			stripHtml( hint.author ?? '' ),
		);
		const iconUrl = pickIcon( hint.icons );
		if ( iconUrl ) {
			const img = document.createElement( 'img' );
			img.src = iconUrl;
			img.alt = '';
			icon.appendChild( img );
		}
		stars.appendChild(
			buildStarCluster( hint.rating ?? 0, hint.num_ratings ?? 0 ),
		);
	}

	return { root, icon, title, byline, stars, meta, banner };
}

function paintHero(
	parts: ReturnType< typeof buildHeroSkeleton >,
	info: WpOrgPluginInfo,
): void {
	parts.title.textContent = info.name;
	parts.byline.textContent = sprintf(
		/* translators: %s: plugin author */
		__( 'by %s', 'desktop-mode' ),
		stripHtml( info.author ?? '' ),
	);
	parts.icon.replaceChildren();
	const iconUrl = pickIcon( info.icons );
	if ( iconUrl ) {
		const img = document.createElement( 'img' );
		img.src = iconUrl;
		img.alt = '';
		parts.icon.appendChild( img );
	}
	parts.stars.replaceChildren(
		buildStarCluster( info.rating ?? 0, info.num_ratings ?? 0 ),
	);

	const bannerUrl = info.banners?.high ?? info.banners?.low;
	if ( bannerUrl ) {
		parts.banner.style.backgroundImage = `url("${ bannerUrl }")`;
		parts.banner.classList.add( 'has-banner' );
	}

	// Trailing meta line: active installs + last updated + tested up to.
	parts.meta.querySelectorAll( ':scope > .desktop-mode-plugins__flyout-meta-row' ).forEach( ( n ) => n.remove() );
	const metaRow = document.createElement( 'div' );
	metaRow.className = 'desktop-mode-plugins__flyout-meta-row';
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
	const tested = document.createElement( 'span' );
	tested.textContent = info.tested
		? sprintf(
			/* translators: %s: maximum tested WordPress version */
			__( 'Tested up to WordPress %s', 'desktop-mode' ),
			info.tested,
		)
		: '';
	metaRow.append( installs, updated );
	if ( tested.textContent ) {
		metaRow.appendChild( tested );
	}
	parts.meta.appendChild( metaRow );
}

type DetailTab = 'overview' | 'screenshots' | 'reviews' | 'changelog' | 'faq';

function buildTabs(): {
	root: HTMLElement;
	current: () => DetailTab;
	onChange: ( cb: ( tab: DetailTab ) => void ) => void;
	} {
	const root = document.createElement( 'wpd-tabs' );
	root.className = 'desktop-mode-plugins__flyout-tabs';
	root.setAttribute( 'value', 'overview' );
	const labels: Array< { value: DetailTab; label: string } > = [
		{ value: 'overview', label: __( 'Overview', 'desktop-mode' ) },
		{ value: 'screenshots', label: __( 'Screenshots', 'desktop-mode' ) },
		{ value: 'reviews', label: __( 'Reviews', 'desktop-mode' ) },
		{ value: 'changelog', label: __( 'Changelog', 'desktop-mode' ) },
		{ value: 'faq', label: __( 'FAQ', 'desktop-mode' ) },
	];
	for ( const opt of labels ) {
		const tab = document.createElement( 'wpd-tab' );
		tab.setAttribute( 'value', opt.value );
		tab.textContent = opt.label;
		root.appendChild( tab );
	}
	let current: DetailTab = 'overview';
	const subscribers = new Set<( tab: DetailTab ) => void >();
	root.addEventListener( 'wpd-tab-change', ( ev: Event ) => {
		const detail = ( ev as CustomEvent< { value: string } > ).detail;
		const value = ( detail?.value ?? 'overview' ) as DetailTab;
		current = value;
		for ( const cb of subscribers ) {
			cb( current );
		}
	} );
	return {
		root,
		current: () => current,
		onChange: ( cb ) => subscribers.add( cb ),
	};
}

function paintTabBody(
	body: HTMLElement,
	tab: DetailTab,
	info: WpOrgPluginInfo | null,
	slug: string,
	reviewsCache: { loaded: boolean },
): void {
	body.replaceChildren();
	if ( ! info ) {
		body.appendChild( buildSkeletonLines( 4 ) );
		return;
	}
	if ( tab === 'overview' ) {
		body.appendChild( buildHtmlSection( info.sections?.description ?? info.short_description ?? '' ) );
		return;
	}
	if ( tab === 'screenshots' ) {
		body.appendChild( buildScreenshots( info.screenshots ) );
		return;
	}
	if ( tab === 'changelog' ) {
		body.appendChild( buildHtmlSection( info.sections?.changelog ?? '' ) );
		return;
	}
	if ( tab === 'faq' ) {
		body.appendChild( buildHtmlSection( info.sections?.faq ?? '' ) );
		return;
	}
	if ( tab === 'reviews' ) {
		body.appendChild( buildRatingsHistogram( info ) );
		const list = document.createElement( 'div' );
		list.className = 'desktop-mode-plugins__reviews-list';
		const loadingLine = document.createElement( 'p' );
		loadingLine.className = 'desktop-mode-plugins__reviews-loading';
		loadingLine.textContent = __( 'Loading recent reviews…', 'desktop-mode' );
		list.appendChild( loadingLine );
		body.appendChild( list );
		if ( ! reviewsCache.loaded ) {
			void ( async () => {
				try {
					const resp = await fetchPluginReviews( slug );
					list.replaceChildren();
					if ( ! resp.parsed || resp.items.length === 0 ) {
						const fallback = document.createElement( 'p' );
						fallback.className = 'desktop-mode-plugins__reviews-fallback';
						fallback.innerHTML = sprintf(
							/* translators: %s: anchor tag with link to wp.org reviews */
							__(
								'Recent reviews aren’t available right now. %s',
								'desktop-mode',
							),
							`<a href="https://wordpress.org/plugins/${ encodeURIComponent( slug ) }/#reviews" target="_blank" rel="noopener">${ __(
								'Read reviews on WordPress.org ↗',
								'desktop-mode',
							) }</a>`,
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
					failure.className = 'desktop-mode-plugins__reviews-fallback';
					failure.textContent = __(
						'Could not load reviews.',
						'desktop-mode',
					);
					list.appendChild( failure );
				}
			} )();
		}
	}
}

function buildHtmlSection( html: string ): HTMLElement {
	const wrap = document.createElement( 'div' );
	wrap.className = 'desktop-mode-plugins__html';
	if ( ! html ) {
		const empty = document.createElement( 'p' );
		empty.className = 'desktop-mode-plugins__empty-line';
		empty.textContent = __( 'No content available.', 'desktop-mode' );
		wrap.appendChild( empty );
		return wrap;
	}
	// wp.org returns HTML strings — sanitize before injection. Use a
	// permissive whitelist: paragraphs, lists, headings, links, code,
	// images. Anything else is stripped to text.
	wrap.innerHTML = sanitizeHtml( html );
	wrap.querySelectorAll( 'a' ).forEach( ( a ) => {
		a.setAttribute( 'target', '_blank' );
		a.setAttribute( 'rel', 'noopener nofollow' );
	} );
	return wrap;
}

function buildScreenshots(
	shots: Record< string, { src: string; caption: string } > | undefined,
): HTMLElement {
	const wrap = document.createElement( 'div' );
	wrap.className = 'desktop-mode-plugins__screenshots';
	const items = shots ? Object.values( shots ) : [];
	if ( items.length === 0 ) {
		const empty = document.createElement( 'p' );
		empty.className = 'desktop-mode-plugins__empty-line';
		empty.textContent = __(
			'This plugin doesn’t ship screenshots.',
			'desktop-mode',
		);
		wrap.appendChild( empty );
		return wrap;
	}
	for ( const shot of items ) {
		const fig = document.createElement( 'figure' );
		fig.className = 'desktop-mode-plugins__screenshot';
		const img = document.createElement( 'img' );
		img.src = shot.src;
		img.loading = 'lazy';
		img.alt = shot.caption ?? '';
		fig.appendChild( img );
		if ( shot.caption ) {
			const cap = document.createElement( 'figcaption' );
			cap.innerHTML = sanitizeHtml( shot.caption );
			fig.appendChild( cap );
		}
		wrap.appendChild( fig );
	}
	return wrap;
}

function buildRatingsHistogram( info: WpOrgPluginInfo ): HTMLElement {
	const wrap = document.createElement( 'div' );
	wrap.className = 'desktop-mode-plugins__histogram';
	const ratings = info.ratings ?? {};
	const total = Object.values( ratings ).reduce(
		( a, b ) => a + ( typeof b === 'number' ? b : 0 ),
		0,
	);
	if ( total === 0 ) {
		const empty = document.createElement( 'p' );
		empty.className = 'desktop-mode-plugins__empty-line';
		empty.textContent = __( 'No ratings yet.', 'desktop-mode' );
		wrap.appendChild( empty );
		return wrap;
	}
	for ( let star = 5; star >= 1; star-- ) {
		const count = ratings[ String( star ) ] ?? 0;
		const ratio = count / total;
		const row = document.createElement( 'div' );
		row.className = 'desktop-mode-plugins__histogram-row';
		const label = document.createElement( 'span' );
		label.className = 'desktop-mode-plugins__histogram-label';
		label.textContent = sprintf(
			/* translators: %d: number of stars (1–5) */
			__( '%d ★', 'desktop-mode' ),
			star,
		);
		const track = document.createElement( 'span' );
		track.className = 'desktop-mode-plugins__histogram-track';
		const fill = document.createElement( 'span' );
		fill.className = 'desktop-mode-plugins__histogram-fill';
		fill.style.width = `${ Math.round( ratio * 100 ) }%`;
		track.appendChild( fill );
		const num = document.createElement( 'span' );
		num.className = 'desktop-mode-plugins__histogram-count';
		num.textContent = new Intl.NumberFormat().format( count );
		row.append( label, track, num );
		wrap.appendChild( row );
	}
	return wrap;
}

function buildReviewCard( item: {
	author: string;
	stars: number;
	excerpt: string;
	date: string;
	url: string;
} ): HTMLElement {
	const card = document.createElement( 'article' );
	card.className = 'desktop-mode-plugins__review';
	const head = document.createElement( 'header' );
	head.className = 'desktop-mode-plugins__review-head';
	const author = document.createElement( 'span' );
	author.className = 'desktop-mode-plugins__review-author';
	author.textContent = item.author || __( 'Anonymous', 'desktop-mode' );
	const star = buildStarCluster( ( item.stars / 5 ) * 100, 0 );
	head.append( author, star );
	if ( item.date ) {
		const date = document.createElement( 'time' );
		date.className = 'desktop-mode-plugins__review-date';
		date.textContent = item.date;
		head.appendChild( date );
	}
	const body = document.createElement( 'p' );
	body.className = 'desktop-mode-plugins__review-excerpt';
	body.textContent = item.excerpt;
	card.append( head, body );
	if ( item.url ) {
		const link = document.createElement( 'a' );
		link.href = item.url;
		link.target = '_blank';
		link.rel = 'noopener nofollow';
		link.textContent = __( 'Read on WordPress.org ↗', 'desktop-mode' );
		link.className = 'desktop-mode-plugins__review-link';
		card.appendChild( link );
	}
	return card;
}

function buildSkeletonLines( count: number ): HTMLElement {
	const wrap = document.createElement( 'div' );
	wrap.className = 'desktop-mode-plugins__skeleton';
	for ( let i = 0; i < count; i++ ) {
		const line = document.createElement( 'span' );
		line.className = 'desktop-mode-plugins__skeleton-line';
		line.style.width = `${ 60 + ( i * 10 ) % 40 }%`;
		wrap.appendChild( line );
	}
	return wrap;
}

function paintFooter(
	footer: HTMLElement,
	slug: string,
	info: WpOrgPluginInfo | null,
	callbacks: FlyoutCallbacks,
	close: () => void,
): void {
	footer.replaceChildren();
	const cfg = getConfig();

	const installed = callbacks.getInstalled( slug );
	const left = document.createElement( 'div' );
	left.className = 'desktop-mode-plugins__flyout-footer-left';
	const wpOrg = document.createElement( 'a' );
	wpOrg.href = `https://wordpress.org/plugins/${ encodeURIComponent( slug ) }/`;
	wpOrg.target = '_blank';
	wpOrg.rel = 'noopener';
	wpOrg.className = 'desktop-mode-plugins__flyout-wporg';
	wpOrg.textContent = __( 'View on WordPress.org ↗', 'desktop-mode' );
	left.appendChild( wpOrg );

	const right = document.createElement( 'div' );
	right.className = 'desktop-mode-plugins__flyout-footer-right';

	if ( installed ) {
		if ( cfg.caps.activate ) {
			if (
				installed.status === 'active' ||
				installed.status === 'active-network'
			) {
				const btn = button( __( 'Deactivate', 'desktop-mode' ), 'secondary' );
				btn.addEventListener( 'click', () => {
					void doDeactivate();
				} );
				right.appendChild( btn );
			} else {
				const btn = button( __( 'Activate', 'desktop-mode' ), 'primary' );
				btn.addEventListener( 'click', () => {
					void doActivate();
				} );
				right.appendChild( btn );
			}
		}
		if ( cfg.caps.delete && installed.status === 'inactive' ) {
			const btn = button( __( 'Delete', 'desktop-mode' ), 'danger' );
			btn.addEventListener( 'click', () => {
				void doDelete();
			} );
			right.appendChild( btn );
		}
	} else if ( cfg.caps.install ) {
		const btn = button( __( 'Install', 'desktop-mode' ), 'primary' );
		btn.addEventListener( 'click', () => {
			void doInstall( btn );
		} );
		right.appendChild( btn );
	}

	footer.append( left, right );

	async function doInstall( btn: HTMLElement ): Promise< void > {
		btn.setAttribute( 'busy', '' );
		btn.setAttribute( 'disabled', '' );
		try {
			const result = await installPluginBySlug( slug );
			toast(
				sprintf(
					/* translators: %s: plugin name */
					__( 'Installed %s.', 'desktop-mode' ),
					info?.name ?? slug,
				),
			);
			await refreshFrameworkMenu();
			await callbacks.onPluginInstalled( result.plugin ?? '', slug );
			paintFooter( footer, slug, info, callbacks, close );
		} catch ( err ) {
			btn.removeAttribute( 'busy' );
			btn.removeAttribute( 'disabled' );
			toast(
				sprintf(
					/* translators: %s: error message */
					__( 'Install failed: %s', 'desktop-mode' ),
					describe( err ),
				),
				6000,
			);
		}
	}

	async function doActivate(): Promise< void > {
		if ( ! installed ) {
			return;
		}
		try {
			const updated = await activateInstalledPlugin( installed );
			callbacks.onPluginActivated( updated );
			toast(
				sprintf(
					/* translators: %s: plugin name */
					__( '%s activated.', 'desktop-mode' ),
					updated.name || updated.plugin,
				),
			);
			await refreshFrameworkMenu();
			paintFooter( footer, slug, info, callbacks, close );
		} catch ( err ) {
			toast(
				sprintf(
					/* translators: %s: error message */
					__( 'Activation failed: %s', 'desktop-mode' ),
					describe( err ),
				),
				6000,
			);
		}
	}

	async function doDeactivate(): Promise< void > {
		if ( ! installed ) {
			return;
		}
		try {
			const updated = await deactivateInstalledPlugin( installed );
			callbacks.onPluginDeactivated( updated );
			toast(
				sprintf(
					/* translators: %s: plugin name */
					__( '%s deactivated.', 'desktop-mode' ),
					updated.name || updated.plugin,
				),
			);
			await refreshFrameworkMenu();
			paintFooter( footer, slug, info, callbacks, close );
		} catch ( err ) {
			toast(
				sprintf(
					/* translators: %s: error message */
					__( 'Deactivation failed: %s', 'desktop-mode' ),
					describe( err ),
				),
				6000,
			);
		}
	}

	async function doDelete(): Promise< void > {
		if ( ! installed ) {
			return;
		}
		const ok = await confirm( {
			title: __( 'Delete plugin?', 'desktop-mode' ),
			message: sprintf(
				/* translators: %s: plugin name */
				__(
					'Permanently delete %s? Its files will be removed from disk. This cannot be undone.',
					'desktop-mode',
				),
				installed.name || installed.plugin,
			),
			confirmLabel: __( 'Delete', 'desktop-mode' ),
			danger: true,
		} );
		if ( ! ok ) {
			return;
		}
		try {
			await deleteInstalledPlugin( installed );
			callbacks.onPluginDeleted( installed );
			toast(
				sprintf(
					/* translators: %s: plugin name */
					__( '%s deleted.', 'desktop-mode' ),
					installed.name || installed.plugin,
				),
			);
			await refreshFrameworkMenu();
			close();
		} catch ( err ) {
			toast(
				sprintf(
					/* translators: %s: error message */
					__( 'Delete failed: %s', 'desktop-mode' ),
					describe( err ),
				),
				6000,
			);
		}
	}
}

function button( label: string, variant: string ): HTMLElement {
	const b = document.createElement( 'wpd-button' );
	b.setAttribute( 'variant', variant );
	b.textContent = label;
	return b;
}

/**
 * Permissive HTML allow-list for `description` / `changelog` / `faq`
 * sections. Strips scripts, iframes, event handlers; keeps headings,
 * paragraphs, lists, links, images, code blocks.
 */
function sanitizeHtml( html: string ): string {
	const allowed = new Set( [
		'A',
		'ABBR',
		'B',
		'BLOCKQUOTE',
		'BR',
		'CODE',
		'DD',
		'DEL',
		'DIV',
		'DL',
		'DT',
		'EM',
		'FIGCAPTION',
		'FIGURE',
		'H1',
		'H2',
		'H3',
		'H4',
		'H5',
		'H6',
		'HR',
		'I',
		'IMG',
		'KBD',
		'LI',
		'OL',
		'P',
		'PRE',
		'Q',
		'S',
		'SMALL',
		'SPAN',
		'STRONG',
		'SUB',
		'SUP',
		'TABLE',
		'TBODY',
		'TD',
		'TFOOT',
		'TH',
		'THEAD',
		'TR',
		'U',
		'UL',
	] );
	const allowedAttrs = new Set( [
		'href',
		'src',
		'alt',
		'title',
		'name',
		'rel',
		'target',
		'colspan',
		'rowspan',
	] );

	const wrap = document.createElement( 'div' );
	wrap.innerHTML = html;
	const walker = document.createTreeWalker( wrap, NodeFilter.SHOW_ELEMENT );
	const toRemove: Element[] = [];
	let current: Element | null = walker.currentNode as Element;
	while ( current ) {
		const next = walker.nextNode() as Element | null;
		if ( current === wrap ) {
			current = next;
			continue;
		}
		if ( ! allowed.has( current.tagName ) ) {
			toRemove.push( current );
		} else {
			for ( const attr of Array.from( current.attributes ) ) {
				if ( ! allowedAttrs.has( attr.name.toLowerCase() ) ) {
					current.removeAttribute( attr.name );
				}
			}
			if ( current.tagName === 'A' ) {
				const href = current.getAttribute( 'href' ) ?? '';
				if ( href.startsWith( 'javascript:' ) ) {
					current.removeAttribute( 'href' );
				}
			}
			if ( current.tagName === 'IMG' ) {
				const src = current.getAttribute( 'src' ) ?? '';
				if ( src.startsWith( 'javascript:' ) ) {
					current.removeAttribute( 'src' );
				}
			}
		}
		current = next;
	}
	for ( const el of toRemove ) {
		const text = document.createTextNode( el.textContent ?? '' );
		el.replaceWith( text );
	}
	return wrap.innerHTML;
}

function describe( err: unknown ): string {
	if ( err instanceof Error ) {
		return err.message;
	}
	return String( err );
}

function stripHtml( html: string ): string {
	const tmp = document.createElement( 'div' );
	tmp.innerHTML = html;
	return tmp.textContent ?? '';
}

function humanDate( raw: string | undefined ): string {
	if ( ! raw ) {
		return '—';
	}
	const m = /^(\d{4})-(\d{2})-(\d{2})/.exec( raw );
	if ( m ) {
		const date = new Date( Date.UTC( +m[ 1 ], +m[ 2 ] - 1, +m[ 3 ] ) );
		try {
			return date.toLocaleDateString();
		} catch {
			return raw;
		}
	}
	return raw;
}
