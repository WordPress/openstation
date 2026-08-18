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
 */

import { __, sprintf } from '../i18n';
import { getConfig } from './rest';
import type { InstalledPlugin, WpOrgBrowsePlugin } from './types';
import '../ui/components/os-button/os-button';
import '../ui/components/os-card/os-card';

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
	// `<os-card interactive>` gives us the focusable + click-emitting
	// behaviour the gallery needs without any handcoded ARIA / role /
	// tabindex / hover-lift CSS. The component dispatches
	// `os-card-click` skipping `[data-noclick]` descendants — the CTA
	// button below opts out via that attribute, so we don't need a
	// per-event `event.target.closest()` guard.
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

	// ─── Header (icon + title + author) ─────────────────────────────
	// Plain `<header>` slot — `<os-card>` styles the slotted element
	// as a flex row with a 12px gap automatically.
	const header = document.createElement( 'header' );
	header.className = 'os-plugins__card-header';

	const iconWrap = document.createElement( 'div' );
	iconWrap.className = 'os-plugins__card-icon';
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

	header.setAttribute( 'slot', 'header' );
	header.append( iconWrap, titleBlock );

	// ─── Description ─────────────────────────────────────────────────
	const desc = document.createElement( 'p' );
	desc.className = 'os-plugins__card-desc';
	desc.textContent = decodeEntities( plugin.short_description ?? '' );

	// ─── Site-fit signals ────────────────────────────────────────────
	// These are deliberately factual compatibility + maintenance
	// signals. They never imply that a plugin is secure or endorsed.
	const signals = document.createElement( 'div' );
	signals.className = 'os-plugins__card-signals';
	const environment = getConfig();
	const compatibility = evaluatePluginCompatibility(
		plugin,
		environment.wpVersion,
		environment.phpVersion,
	);
	const compatibilityChip = document.createElement( 'span' );
	compatibilityChip.className =
		`os-plugins__card-signal is-${ compatibility.tone }`;
	compatibilityChip.textContent = compatibility.label;
	compatibilityChip.title = compatibility.detail;

	const updatedChip = document.createElement( 'span' );
	const freshness = formatPluginFreshness( plugin.last_updated );
	updatedChip.className = `os-plugins__card-signal is-${ freshness.tone }`;
	updatedChip.textContent = freshness.label;
	signals.append( compatibilityChip, updatedChip );

	// ─── Footer (rating + installs + CTA) ───────────────────────────
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

	const cta = buildCta( plugin, installed, callbacks, card );

	footer.append( meta, cta );

	card.append( header, desc, signals, footer );

	// `<os-card interactive>` already handles role / tabindex /
	// click + keyboard activation and skips `[data-noclick]`
	// descendants. We just listen for its `os-card-click` event.
	card.addEventListener( 'os-card-click', () => {
		callbacks.onOpen( plugin.slug, plugin );
	} );

	return card;
}

export type PluginSignalTone = 'positive' | 'muted' | 'warning' | 'danger';

export interface PluginSignal {
	label: string;
	detail: string;
	tone: PluginSignalTone;
}

/**
 * Compare dotted release versions numerically. Suffixes are ignored
 * because WordPress.org requirement fields are minimum release lines,
 * not semver ranges.
 */
export function compareReleaseVersions( left: string, right: string ): number {
	const parts = ( value: string ): number[] =>
		value
			.split( '.' )
			.map( ( part ) => Number.parseInt( part, 10 ) )
			.map( ( part ) => ( Number.isFinite( part ) ? part : 0 ) );
	const a = parts( left );
	const b = parts( right );
	const length = Math.max( a.length, b.length );
	for ( let i = 0; i < length; i++ ) {
		const delta = ( a[ i ] ?? 0 ) - ( b[ i ] ?? 0 );
		if ( delta !== 0 ) {
			return delta > 0 ? 1 : -1;
		}
	}
	return 0;
}

/** Build the card's factual WordPress/PHP requirement signal. */
export function evaluatePluginCompatibility(
	plugin: Pick< WpOrgBrowsePlugin, 'requires' | 'requires_php' | 'tested' >,
	wpVersion: string,
	phpVersion: string,
): PluginSignal {
	if (
		plugin.requires &&
		compareReleaseVersions( plugin.requires, wpVersion ) > 0
	) {
		return {
			label: sprintf(
				/* translators: %s: minimum WordPress version */
				__( 'Requires WordPress %s', 'desktop-mode' ),
				plugin.requires,
			),
			detail: sprintf(
				/* translators: %s: current WordPress version */
				__( 'This site is running WordPress %s.', 'desktop-mode' ),
				wpVersion,
			),
			tone: 'danger',
		};
	}
	if (
		plugin.requires_php &&
		compareReleaseVersions( plugin.requires_php, phpVersion ) > 0
	) {
		return {
			label: sprintf(
				/* translators: %s: minimum PHP version */
				__( 'Requires PHP %s', 'desktop-mode' ),
				plugin.requires_php,
			),
			detail: sprintf(
				/* translators: %s: current PHP version */
				__( 'This site is running PHP %s.', 'desktop-mode' ),
				phpVersion,
			),
			tone: 'danger',
		};
	}
	if ( ! plugin.tested ) {
		return {
			label: __( 'Compatibility not reported', 'desktop-mode' ),
			detail: __( 'The WordPress.org listing does not report a tested version.', 'desktop-mode' ),
			tone: 'muted',
		};
	}
	if ( compareReleaseVersions( plugin.tested, wpVersion ) < 0 ) {
		return {
			label: sprintf(
				/* translators: %s: WordPress version */
				__( 'Last tested with WordPress %s', 'desktop-mode' ),
				plugin.tested,
			),
			detail: sprintf(
				/* translators: %s: current WordPress version */
				__( 'This site is running WordPress %s.', 'desktop-mode' ),
				wpVersion,
			),
			tone: 'warning',
		};
	}
	return {
		label: sprintf(
			/* translators: %s: WordPress version */
			__( 'Tested with WordPress %s', 'desktop-mode' ),
			plugin.tested,
		),
		detail: __( 'Reported by the plugin author on WordPress.org.', 'desktop-mode' ),
		tone: 'positive',
	};
}

/** Turn the WordPress.org timestamp into a compact maintenance signal. */
export function formatPluginFreshness(
	lastUpdated: string,
	now = Date.now(),
): Pick< PluginSignal, 'label' | 'tone' > {
	// Directory browse responses use values such as
	// `2026-08-17 10:12pm GMT`. Safari and Chromium both reject the
	// missing space before `am` / `pm`, while the plugin-information
	// endpoint may return an ISO timestamp. Normalize only that wp.org
	// quirk and leave already-valid formats untouched.
	const normalized = lastUpdated.replace(
		/(\d{1,2}:\d{2})(am|pm)\b/i,
		'$1 $2',
	);
	const timestamp = Date.parse( normalized );
	if ( ! Number.isFinite( timestamp ) ) {
		return {
			label: __( 'Update date unavailable', 'desktop-mode' ),
			tone: 'muted',
		};
	}
	const days = Math.max( 0, Math.floor( ( now - timestamp ) / 86_400_000 ) );
	if ( days < 45 ) {
		return {
			label: __( 'Updated recently', 'desktop-mode' ),
			tone: 'positive',
		};
	}
	if ( days < 365 ) {
		const months = Math.max( 1, Math.round( days / 30 ) );
		return {
			label: sprintf(
				/* translators: %s: number of months */
				__( 'Updated %s months ago', 'desktop-mode' ),
				String( months ),
			),
			tone: 'muted',
		};
	}
	const years = Math.max( 1, Math.floor( days / 365 ) );
	if ( years === 1 ) {
		return {
			label: __( 'Updated last year', 'desktop-mode' ),
			tone: 'muted',
		};
	}
	return {
		label: sprintf(
			/* translators: %s: number of years */
			__( 'Updated %s years ago', 'desktop-mode' ),
			String( years ),
		),
		tone: years >= 2 ? 'warning' : 'muted',
	};
}

/** Recompute the CTA after install / activate state changes. */
export function repaintCardCta(
	card: HTMLElement,
	plugin: WpOrgBrowsePlugin,
	installed: InstalledIndex,
	callbacks: CardCallbacks,
): void {
	const footer = card.querySelector< HTMLElement >(
		'.os-plugins__card-footer',
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
	const button = document.createElement( 'os-button' );
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
 * Render a 5-star cluster using `<os-icon>` glyphs. Half-star
 * support: ratings come back as 0–100 from wp.org.
 */
export function buildStarCluster(
	rating0to100: number,
	totalRatings: number,
): HTMLElement {
	const wrap = document.createElement( 'span' );
	wrap.className = 'os-plugins__stars';
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
		count.className = 'os-plugins__stars-count';
		count.textContent = `(${ formatThousands( totalRatings ) })`;
		wrap.appendChild( count );
	}
	return wrap;
}

function buildStar( kind: 'filled' | 'half' | 'empty' ): HTMLElement {
	const span = document.createElement( 'span' );
	span.className = 'os-plugins__star';
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
		'dashicons dashicons-admin-plugins os-plugins__card-icon-fallback';
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
