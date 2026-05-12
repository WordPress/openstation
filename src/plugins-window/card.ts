/**
 * Native Plugins window — gallery card factory.
 *
 * Renders a single wp.org plugin as a clickable card. Whole card click
 * opens the detail flyout; a primary CTA on the card surfaces the
 * fast path (Install / Activate / Open). Hover lift + image fade-in
 * are CSS-only (`assets/css/plugins-window.css`).
 *
 * The card also escalates pointer-down to the framework's drag
 * bridge so the user can drag a card to the dock (pin) — we don't
 * install drop targets here; that's `card-drag.ts`'s job.
 *
 * @public
 * @since 0.9.0
 */

import { __, sprintf } from '../i18n';
import type { InstalledPlugin, WpOrgBrowsePlugin } from './types';
import '../ui/components/wpd-button/wpd-button';
import '../ui/components/wpd-card/wpd-card';

/**
 * What the card knows about an installed counterpart, so the CTA can
 * say "Activate" / "Active" instead of "Install" when the plugin is
 * already on disk.
 */
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
	// `<wpd-card interactive>` gives us the focusable + click-emitting
	// behaviour the gallery needs without any handcoded ARIA / role /
	// tabindex / hover-lift CSS. The component dispatches
	// `wpd-card-click` skipping `[data-noclick]` descendants — the CTA
	// button below opts out via that attribute, so we don't need a
	// per-event `event.target.closest()` guard.
	const card = document.createElement( 'wpd-card' );
	card.classList.add( 'desktop-mode-plugins__card' );
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

	// ─── Header (icon + title + author) ─────────────────────────────
	// Plain `<header>` slot — `<wpd-card>` styles the slotted element
	// as a flex row with a 12px gap automatically.
	const header = document.createElement( 'header' );
	header.className = 'desktop-mode-plugins__card-header';

	const iconWrap = document.createElement( 'div' );
	iconWrap.className = 'desktop-mode-plugins__card-icon';
	const iconUrl = pickIcon( plugin.icons );
	if ( iconUrl ) {
		const img = document.createElement( 'img' );
		img.src = iconUrl;
		img.alt = '';
		img.loading = 'lazy';
		img.decoding = 'async';
		img.addEventListener(
			'load',
			() => img.classList.add( 'is-loaded' ),
		);
		img.addEventListener( 'error', () => {
			iconWrap.replaceChildren( buildFallbackGlyph() );
		} );
		iconWrap.appendChild( img );
	} else {
		iconWrap.appendChild( buildFallbackGlyph() );
	}

	const titleBlock = document.createElement( 'div' );
	titleBlock.className = 'desktop-mode-plugins__card-titleblock';
	const title = document.createElement( 'h3' );
	title.className = 'desktop-mode-plugins__card-title';
	title.textContent = decodeEntities( plugin.name );
	const byline = document.createElement( 'p' );
	byline.className = 'desktop-mode-plugins__card-byline';
	byline.innerHTML = sprintf(
		/* translators: %s: plugin author name (HTML-stripped) */
		__( 'by %s', 'desktop-mode' ),
		`<span>${ escapeHtml( stripHtml( plugin.author ?? '' ) ) }</span>`,
	);
	titleBlock.append( title, byline );

	header.setAttribute( 'slot', 'header' );
	header.append( iconWrap, titleBlock );

	// ─── Description ─────────────────────────────────────────────────
	const desc = document.createElement( 'p' );
	desc.className = 'desktop-mode-plugins__card-desc';
	desc.textContent = decodeEntities( plugin.short_description ?? '' );

	// ─── Footer (rating + installs + CTA) ───────────────────────────
	const footer = document.createElement( 'footer' );
	footer.className = 'desktop-mode-plugins__card-footer';
	footer.setAttribute( 'slot', 'footer' );

	const meta = document.createElement( 'div' );
	meta.className = 'desktop-mode-plugins__card-meta';
	meta.appendChild( buildStarCluster( plugin.rating ?? 0, plugin.num_ratings ?? 0 ) );
	const installs = document.createElement( 'span' );
	installs.className = 'desktop-mode-plugins__card-installs';
	installs.textContent = formatInstalls( plugin.active_installs ?? 0 );
	meta.appendChild( installs );

	const cta = buildCta( plugin, installed, callbacks, card );

	footer.append( meta, cta );

	card.append( header, desc, footer );

	// `<wpd-card interactive>` already handles role / tabindex /
	// click + keyboard activation and skips `[data-noclick]`
	// descendants. We just listen for its `wpd-card-click` event.
	card.addEventListener( 'wpd-card-click', () => {
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
	const footer = card.querySelector< HTMLElement >(
		'.desktop-mode-plugins__card-footer',
	);
	if ( ! footer ) {
		return;
	}
	const previous = footer.querySelector< HTMLElement >(
		'[data-plugin-card-cta]',
	);
	if ( previous ) {
		previous.remove();
	}
	footer.appendChild( buildCta( plugin, installed, callbacks, card ) );
}

function buildCta(
	plugin: WpOrgBrowsePlugin,
	installed: InstalledIndex,
	callbacks: CardCallbacks,
	card: HTMLElement,
): HTMLElement {
	const installedRow = installed.get( plugin.slug );
	const button = document.createElement( 'wpd-button' );
	button.setAttribute( 'data-plugin-card-cta', '' );
	button.setAttribute( 'data-noclick', '' );
	if ( installedRow ) {
		if (
			installedRow.status === 'active' ||
			installedRow.status === 'active-network'
		) {
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
 * Render a 5-star cluster using `<wpd-icon>` glyphs. Half-star
 * support: ratings come back as 0–100 from wp.org.
 */
export function buildStarCluster(
	rating0to100: number,
	totalRatings: number,
): HTMLElement {
	const wrap = document.createElement( 'span' );
	wrap.className = 'desktop-mode-plugins__stars';
	wrap.setAttribute( 'aria-label', formatStarsAriaLabel( rating0to100 ) );

	const stars5 = Math.max( 0, Math.min( 5, ( rating0to100 / 100 ) * 5 ) );
	const full = Math.floor( stars5 );
	const half = stars5 - full >= 0.5 ? 1 : 0;
	const empty = 5 - full - half;
	for ( let i = 0; i < full; i++ ) {
		wrap.appendChild( buildStar( 'filled' ) );
	}
	for ( let i = 0; i < half; i++ ) {
		wrap.appendChild( buildStar( 'half' ) );
	}
	for ( let i = 0; i < empty; i++ ) {
		wrap.appendChild( buildStar( 'empty' ) );
	}

	if ( totalRatings > 0 ) {
		const count = document.createElement( 'span' );
		count.className = 'desktop-mode-plugins__stars-count';
		count.textContent = `(${ formatThousands( totalRatings ) })`;
		wrap.appendChild( count );
	}
	return wrap;
}

function buildStar( kind: 'filled' | 'half' | 'empty' ): HTMLElement {
	const span = document.createElement( 'span' );
	span.className = 'desktop-mode-plugins__star';
	span.setAttribute( 'aria-hidden', 'true' );
	const icon = document.createElement( 'span' );
	if ( kind === 'filled' ) {
		icon.className = 'dashicons dashicons-star-filled';
	} else if ( kind === 'half' ) {
		icon.className = 'dashicons dashicons-star-half';
	} else {
		icon.className = 'dashicons dashicons-star-empty';
	}
	span.appendChild( icon );
	return span;
}

function buildFallbackGlyph(): HTMLElement {
	const fallback = document.createElement( 'span' );
	fallback.className =
		'dashicons dashicons-admin-plugins desktop-mode-plugins__card-icon-fallback';
	fallback.setAttribute( 'aria-hidden', 'true' );
	return fallback;
}

/** Pick the best available icon URL (svg > 256 > 128 > 1x). */
export function pickIcon(
	icons: Record< string, string > | undefined,
): string | null {
	if ( ! icons ) {
		return null;
	}
	return (
		icons.svg ??
		icons[ '256' ] ??
		icons[ '256x256' ] ??
		icons.default ??
		icons[ '128' ] ??
		icons[ '128x128' ] ??
		icons[ '2x' ] ??
		icons[ '1x' ] ??
		Object.values( icons )[ 0 ] ??
		null
	);
}

/**
 * Format an active-installs count like wp.org does:
 *   - 50         → "50+ active"
 *   - 1,234      → "1,000+ active"
 *   - 100,000    → "100,000+ active"
 *   - 5,000,000  → "5+ million active"
 */
function formatInstalls( n: number ): string {
	if ( n <= 0 ) {
		return __( 'Fewer than 10 active', 'desktop-mode' );
	}
	if ( n >= 1_000_000 ) {
		const millions = Math.floor( n / 1_000_000 );
		return sprintf(
			/* translators: %d: integer number of millions of active installs */
			__( '%d+ million active', 'desktop-mode' ),
			millions,
		);
	}
	if ( n >= 1000 ) {
		return sprintf(
			/* translators: %s: comma-grouped active install count */
			__( '%s+ active', 'desktop-mode' ),
			formatThousands( roundTo3SigFigs( n ) ),
		);
	}
	return sprintf(
		/* translators: %s: comma-grouped active install count */
		__( '%s+ active', 'desktop-mode' ),
		formatThousands( n ),
	);
}

function roundTo3SigFigs( n: number ): number {
	const order = Math.pow( 10, Math.floor( Math.log10( n ) ) - 2 );
	return Math.floor( n / order ) * order;
}

function formatStarsAriaLabel( rating0to100: number ): string {
	const stars5 = Math.max( 0, Math.min( 5, ( rating0to100 / 100 ) * 5 ) );
	return sprintf(
		/* translators: %s: rating out of 5 (one decimal) */
		__( 'Rated %s out of 5', 'desktop-mode' ),
		stars5.toFixed( 1 ),
	);
}

function formatThousands( n: number ): string {
	try {
		return new Intl.NumberFormat().format( n );
	} catch {
		return String( n );
	}
}

const _entityCache = document.createElement( 'textarea' );
function decodeEntities( html: string ): string {
	if ( ! html ) {
		return '';
	}
	_entityCache.innerHTML = html;
	return _entityCache.value;
}

function escapeHtml( raw: string ): string {
	const tmp = document.createElement( 'div' );
	tmp.textContent = raw;
	return tmp.innerHTML;
}

function stripHtml( html: string ): string {
	const tmp = document.createElement( 'div' );
	tmp.innerHTML = html;
	return tmp.textContent ?? '';
}
