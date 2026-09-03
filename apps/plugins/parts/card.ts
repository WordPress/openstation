/**
 * Plugins app — the gallery card.
 *
 * Part of the `desktop-mode-plugins` client view. Renders one wp.org
 * plugin as a clickable `<os-card>`: the whole card opens the detail
 * flyout; the CTA in its footer is the fast path (Install / Activate /
 * Active). Hover lift and image fade-in are CSS (`plugins.css`).
 * The drag-to-dock escalation is `card-drag.ts`'s job.
 *
 * @public
 */

import { __, sprintf } from '@openstation/app';
import { isActiveStatus, stripHtml, type InstalledPlugin, type WpOrgBrowsePlugin } from './types';
import '../../../src/ui/components/os-button/os-button';
import '../../../src/ui/components/os-card/os-card';

/** Installed rows keyed by wp.org slug (text domain) — what the CTA reads. */
export type InstalledIndex = Map< string, InstalledPlugin >;

export interface CardCallbacks {
	onOpen: ( slug: string, hint?: WpOrgBrowsePlugin ) => void;
	onInstall: ( plugin: WpOrgBrowsePlugin, card: HTMLElement ) => Promise< void >;
	onActivate: ( installed: InstalledPlugin, card: HTMLElement ) => Promise< void >;
}

/** Render a single card. */
export function buildCard(
	plugin: WpOrgBrowsePlugin,
	installed: InstalledIndex,
	callbacks: CardCallbacks,
): HTMLElement {
	// `<os-card interactive>` handles role / tabindex / click + keyboard
	// activation and skips `[data-noclick]` descendants — the CTA opts
	// out through that attribute.
	const card = document.createElement( 'os-card' );
	card.classList.add( 'os-plugins__card' );
	card.setAttribute( 'interactive', '' );
	card.dataset.slug = plugin.slug;
	card.setAttribute(
		'aria-label',
		sprintf(
			/* translators: %s: plugin name */
			__( 'View details for %s', 'desktop-mode' ),
			plugin.name,
		),
	);

	const header = document.createElement( 'header' );
	header.className = 'os-plugins__card-header';
	header.setAttribute( 'slot', 'header' );

	const iconWrap = document.createElement( 'div' );
	iconWrap.className = 'os-plugins__card-icon';
	const iconUrl = pickIcon( plugin.icons );
	if ( iconUrl ) {
		const img = document.createElement( 'img' );
		img.src = iconUrl;
		img.alt = '';
		img.loading = 'lazy';
		img.decoding = 'async';
		img.addEventListener( 'load', () => img.classList.add( 'is-loaded' ) );
		img.addEventListener( 'error', () => {
			iconWrap.replaceChildren( buildFallbackGlyph() );
		} );
		iconWrap.appendChild( img );
	} else {
		iconWrap.appendChild( buildFallbackGlyph() );
	}

	const titleBlock = document.createElement( 'div' );
	titleBlock.className = 'os-plugins__card-titleblock';
	const title = document.createElement( 'h3' );
	title.className = 'os-plugins__card-title';
	title.textContent = decodeEntities( plugin.name );
	const byline = document.createElement( 'p' );
	byline.className = 'os-plugins__card-byline';
	byline.innerHTML = sprintf(
		/* translators: %s: plugin author name (HTML-stripped) */
		__( 'by %s', 'desktop-mode' ),
		`<span>${ escapeHtml( stripHtml( plugin.author ?? '' ) ) }</span>`,
	);
	titleBlock.append( title, byline );
	header.append( iconWrap, titleBlock );

	const desc = document.createElement( 'p' );
	desc.className = 'os-plugins__card-desc';
	desc.textContent = decodeEntities( plugin.short_description ?? '' );

	const footer = document.createElement( 'footer' );
	footer.className = 'os-plugins__card-footer';
	footer.setAttribute( 'slot', 'footer' );

	const meta = document.createElement( 'div' );
	meta.className = 'os-plugins__card-meta';
	meta.appendChild( buildStarCluster( plugin.rating ?? 0, plugin.num_ratings ?? 0 ) );
	const installs = document.createElement( 'span' );
	installs.className = 'os-plugins__card-installs';
	installs.textContent = formatInstalls( plugin.active_installs ?? 0 );
	meta.appendChild( installs );

	footer.append( meta, buildCta( plugin, installed, callbacks, card ) );
	card.append( header, desc, footer );

	card.addEventListener( 'os-card-click', () => {
		callbacks.onOpen( plugin.slug, plugin );
	} );

	return card;
}

/** Recompute the CTA after install / activate state changes. */
export function repaintCardCta(
	card: HTMLElement,
	plugin: WpOrgBrowsePlugin,
	installed: InstalledIndex,
	callbacks: CardCallbacks,
): void {
	const footer = card.querySelector< HTMLElement >( '.os-plugins__card-footer' );
	if ( ! footer ) {
		return;
	}
	footer.querySelector( '[data-plugin-card-cta]' )?.remove();
	footer.appendChild( buildCta( plugin, installed, callbacks, card ) );
}

function buildCta(
	plugin: WpOrgBrowsePlugin,
	installed: InstalledIndex,
	callbacks: CardCallbacks,
	card: HTMLElement,
): HTMLElement {
	const installedRow = installed.get( plugin.slug );
	const button = document.createElement( 'os-button' );
	button.setAttribute( 'data-plugin-card-cta', '' );
	button.setAttribute( 'data-noclick', '' );
	if ( installedRow ) {
		if ( isActiveStatus( installedRow.status ) ) {
			button.setAttribute( 'variant', 'ghost' );
			button.setAttribute( 'disabled', '' );
			button.textContent = __( 'Active', 'desktop-mode' );
		} else {
			button.setAttribute( 'variant', 'primary' );
			button.textContent = __( 'Activate', 'desktop-mode' );
			button.addEventListener( 'click', ( ev ) => {
				ev.stopPropagation();
				void callbacks.onActivate( installedRow, card );
			} );
		}
	} else {
		button.setAttribute( 'variant', 'primary' );
		button.textContent = __( 'Install', 'desktop-mode' );
		button.addEventListener( 'click', ( ev ) => {
			ev.stopPropagation();
			void callbacks.onInstall( plugin, card );
		} );
	}
	return button;
}

/**
 * A 5-star cluster. Half-star support: ratings come back as 0–100
 * from wp.org.
 */
export function buildStarCluster( rating0to100: number, totalRatings: number ): HTMLElement {
	const wrap = document.createElement( 'span' );
	wrap.className = 'os-plugins__stars';
	const stars5 = Math.max( 0, Math.min( 5, ( rating0to100 / 100 ) * 5 ) );
	wrap.setAttribute(
		'aria-label',
		sprintf(
			/* translators: %s: rating out of 5 (one decimal) */
			__( 'Rated %s out of 5', 'desktop-mode' ),
			stars5.toFixed( 1 ),
		),
	);
	const full = Math.floor( stars5 );
	const half = stars5 - full >= 0.5 ? 1 : 0;
	const kinds: string[] = [
		...Array( full ).fill( 'dashicons-star-filled' ),
		...Array( half ).fill( 'dashicons-star-half' ),
		...Array( 5 - full - half ).fill( 'dashicons-star-empty' ),
	];
	for ( const kind of kinds ) {
		const span = document.createElement( 'span' );
		span.className = 'os-plugins__star';
		span.setAttribute( 'aria-hidden', 'true' );
		const icon = document.createElement( 'span' );
		icon.className = `dashicons ${ kind }`;
		span.appendChild( icon );
		wrap.appendChild( span );
	}
	if ( totalRatings > 0 ) {
		const count = document.createElement( 'span' );
		count.className = 'os-plugins__stars-count';
		count.textContent = `(${ formatThousands( totalRatings ) })`;
		wrap.appendChild( count );
	}
	return wrap;
}

function buildFallbackGlyph(): HTMLElement {
	const fallback = document.createElement( 'span' );
	fallback.className = 'dashicons dashicons-admin-plugins os-plugins__card-icon-fallback';
	fallback.setAttribute( 'aria-hidden', 'true' );
	return fallback;
}

/** Pick the best available icon URL (svg > 256 > 128 > 1x > default). */
export function pickIcon( icons: Record< string, string > | undefined ): string | null {
	if ( ! icons ) {
		return null;
	}
	return (
		icons.svg ??
		icons[ '256' ] ??
		icons[ '256x256' ] ??
		icons[ '128' ] ??
		icons[ '128x128' ] ??
		icons[ '2x' ] ??
		icons[ '1x' ] ??
		icons.default ??
		Object.values( icons )[ 0 ] ??
		null
	);
}

/**
 * Format an active-installs count like wp.org does:
 * 50 → "50+ active", 1,234 → "1,000+ active", 5,000,000 → "5+ million active".
 */
export function formatInstalls( n: number ): string {
	if ( n <= 0 ) {
		return __( 'Fewer than 10 active', 'desktop-mode' );
	}
	if ( n >= 1_000_000 ) {
		return sprintf(
			/* translators: %d: integer number of millions of active installs */
			__( '%d+ million active', 'desktop-mode' ),
			Math.floor( n / 1_000_000 ),
		);
	}
	const shown = n >= 1000 ? roundTo3SigFigs( n ) : n;
	return sprintf(
		/* translators: %s: comma-grouped active install count */
		__( '%s+ active', 'desktop-mode' ),
		formatThousands( shown ),
	);
}

function roundTo3SigFigs( n: number ): number {
	const order = Math.pow( 10, Math.floor( Math.log10( n ) ) - 2 );
	return Math.floor( n / order ) * order;
}

export function formatThousands( n: number ): string {
	try {
		return new Intl.NumberFormat().format( n );
	} catch {
		return String( n );
	}
}

const _entityCache = document.createElement( 'textarea' );
export function decodeEntities( html: string ): string {
	if ( ! html ) {
		return '';
	}
	_entityCache.innerHTML = html;
	return _entityCache.value;
}

export function escapeHtml( raw: string ): string {
	const tmp = document.createElement( 'div' );
	tmp.textContent = raw;
	return tmp.innerHTML;
}

/** A placeholder card for a page still loading. */
export function buildSkeletonCard(): HTMLElement {
	const card = document.createElement( 'os-card' );
	card.classList.add( 'os-plugins__card', 'os-plugins__card--skeleton' );
	card.setAttribute( 'aria-hidden', 'true' );
	for ( let i = 0; i < 4; i++ ) {
		const line = document.createElement( 'span' );
		line.className = 'os-plugins__skeleton-line';
		line.style.width = `${ 50 + ( ( i * 17 ) % 50 ) }%`;
		card.appendChild( line );
	}
	return card;
}
