/**
 * Native Plugins window — Installed tab expandable-row detail panel.
 *
 * Rendered inside `<os-table>`'s sub-row slot. Shows a hero band
 * (banner + icon + title + author + status chips), a tab strip
 * (Overview / Details / Changelog / FAQ / Reviews), and lazy-loads
 * the wp.org `plugin_information` payload the first time a row is
 * expanded so plugins on the directory get rich content inline.
 *
 * Composed almost entirely from `<os-*>` primitives so it picks up
 * the framework's theming, hover, and dark-mode treatment for free.
 *
 * @public
 */

import { __, sprintf } from '../i18n';
import { buildStarCluster } from './card';
import { fetchPluginInfo, fetchPluginReviews } from './rest';
import { attachIconFallback } from './icon-fallback';
import type {
	InstalledPlugin,
	PluginReview,
	PluginReviewsResponse,
	WpOrgPluginInfo,
} from './types';
import '../ui/components/os-tabs/os-tabs';
import '../ui/components/os-chip/os-chip';
import '../ui/components/os-card/os-card';
import '../ui/components/os-cluster/os-cluster';
import '../ui/components/os-stack/os-stack';
import '../ui/components/os-grid/os-grid';
import '../ui/components/os-spinner/os-spinner';
import '../ui/components/os-empty-state/os-empty-state';
import '../ui/components/os-button/os-button';
import '../ui/components/os-icon/os-icon';
import '../ui/components/os-badge/os-badge';
import '../ui/components/os-rating-summary/os-rating-summary';
import type {
	OsRatingBuckets,
	OsRatingSummary,
} from '../ui/components/os-rating-summary/os-rating-summary';

/** Resolved wp.org payloads keyed by slug — survives row re-paints. */
const wpOrgCache = new Map< string, WpOrgPluginInfo >();
/** Resolved review payloads keyed by slug. */
const reviewsCache = new Map< string, PluginReviewsResponse >();

type DetailTab = 'overview' | 'details' | 'changelog' | 'faq' | 'reviews';

/**
 * Build the expandable-row detail panel for a single installed
 * plugin. Returns synchronously; wp.org-dependent tabs hydrate
 * themselves once the lazy fetch lands.
 */
export function buildInstalledDetail( row: InstalledPlugin ): HTMLElement {
	const root = document.createElement( 'div' );
	root.className = 'os-plugins__detail';
	// Click inside the detail panel should NOT bubble up to the table
	// row-click toggle — the user is interacting with the panel, not
	// asking to collapse it.
	root.setAttribute( 'data-noclick', '' );

	// The detail panel lives inside `<os-table>`'s shadow DOM (the
	// sub-table mechanism appends our element into a `<td>` inside
	// the table's shadow root). Document-level stylesheets do NOT
	// pierce shadow boundaries, so we ship a `<style>` element
	// alongside the panel — its rules apply inside the same shadow
	// tree where the panel renders. All selectors are uniquely
	// namespaced under `.os-plugins__detail*`.
	const style = document.createElement( 'style' );
	style.textContent = PANEL_STYLES;
	root.appendChild( style );

	const slug = deriveSlug( row );

	root.appendChild( buildHero( row, slug ) );

	const tabsHost = document.createElement( 'div' );
	tabsHost.className = 'os-plugins__detail-tabs-wrap';
	root.appendChild( tabsHost );

	const body = document.createElement( 'div' );
	body.className = 'os-plugins__detail-body';
	root.appendChild( body );

	// Build tab strip. Tabs that depend on wp.org are always present
	// when the plugin is on the directory — they paint a spinner
	// until the lazy fetch lands, swapping content in place.
	const tabs = document.createElement( 'os-tabs' );
	tabs.className = 'os-plugins__detail-tabs';
	tabs.setAttribute( 'value', 'overview' );

	const tabDefs: Array< { value: DetailTab; label: string; show: boolean } > = [
		{ value: 'overview', label: __( 'Overview', 'desktop-mode' ), show: true },
		{ value: 'details', label: __( 'Details', 'desktop-mode' ), show: true },
		{ value: 'changelog', label: __( 'Changelog', 'desktop-mode' ), show: !! slug },
		{ value: 'faq', label: __( 'FAQ', 'desktop-mode' ), show: !! slug },
		{ value: 'reviews', label: __( 'Reviews', 'desktop-mode' ), show: !! slug },
	];

	for ( const def of tabDefs ) {
		if ( ! def.show ) {
			continue;
		}
		const tab = document.createElement( 'os-tab' );
		tab.setAttribute( 'value', def.value );
		tab.textContent = def.label;
		tabs.appendChild( tab );
	}
	tabsHost.appendChild( tabs );

	// Local state — kept in closures so we don't refetch within a row.
	let info: WpOrgPluginInfo | null = slug ? wpOrgCache.get( slug ) ?? null : null;
	let infoFetching = false;
	let active: DetailTab = 'overview';

	const ensureInfo = (): void => {
		if ( ! slug || info || infoFetching ) {
			return;
		}
		infoFetching = true;
		void ( async () => {
			try {
				info = await fetchPluginInfo( slug );
				wpOrgCache.set( slug, info );
				if ( root.isConnected ) {
					paintActive();
				}
			} catch {
				if ( root.isConnected ) {
					paintActive(); // shows error in the active section
				}
			} finally {
				infoFetching = false;
			}
		} )();
	};

	const paintActive = (): void => {
		body.replaceChildren( renderTab( active, row, slug, info ) );
	};

	tabs.addEventListener( 'os-tab-change', ( ev: Event ) => {
		const detail = ( ev as CustomEvent< { value: string } > ).detail;
		active = ( detail?.value as DetailTab ) ?? 'overview';
		// wp.org-dependent tabs trigger the fetch on first activation.
		if ( slug && active !== 'overview' && active !== 'details' ) {
			ensureInfo();
		}
		paintActive();
	} );

	// First paint: Overview is local-only, no wp.org fetch needed yet.
	paintActive();

	return root;
}

// ─── Hero ──────────────────────────────────────────────────────────

function buildHero( row: InstalledPlugin, _slug: string ): HTMLElement {
	const hero = document.createElement( 'div' );
	hero.className = 'os-plugins__detail-hero';

	const inner = document.createElement( 'div' );
	inner.className = 'os-plugins__detail-hero-inner';

	// Icon tile — small, square, on a clean surface. No banner backdrop:
	// wp.org banners are often just the icon stretched, which makes the
	// expanded row look like a billboard. The icon alone gives identity
	// without the visual shouting.
	const iconTile = document.createElement( 'div' );
	iconTile.className = 'os-plugins__detail-hero-icon';
	const iconUrl = row.openstation_icon_url;
	if ( iconUrl ) {
		const img = document.createElement( 'img' );
		img.alt = '';
		img.loading = 'lazy';
		img.decoding = 'async';
		img.src = attachIconFallback( img, iconUrl, () => {
			iconTile.replaceChildren( buildFallbackGlyph() );
		} );
		iconTile.appendChild( img );
	} else {
		iconTile.appendChild( buildFallbackGlyph() );
	}

	// Title block — vertical stack of title row + byline + chip strip
	const titleBlock = document.createElement( 'os-stack' );
	titleBlock.setAttribute( 'gap', '6' );
	titleBlock.className = 'os-plugins__detail-hero-text';

	const titleRow = document.createElement( 'os-cluster' );
	titleRow.setAttribute( 'gap', '10' );
	titleRow.setAttribute( 'align', 'center' );
	const title = document.createElement( 'h3' );
	title.className = 'os-plugins__detail-title';
	title.textContent = row.name || row.plugin;
	titleRow.appendChild( title );
	if ( row.version ) {
		const ver = document.createElement( 'os-badge' );
		ver.setAttribute( 'tone', 'neutral' );
		ver.setAttribute( 'no-dot', '' );
		ver.textContent = sprintf(
			/* translators: %s: version number */
			__( 'v%s', 'desktop-mode' ),
			row.version,
		);
		titleRow.appendChild( ver );
	}
	const isActive = row.status === 'active' || row.status === 'active-network';
	const statusBadge = document.createElement( 'os-badge' );
	statusBadge.setAttribute( 'tone', isActive ? 'success' : 'neutral' );
	statusBadge.textContent = isActive
		? __( 'Active', 'desktop-mode' )
		: __( 'Inactive', 'desktop-mode' );
	titleRow.appendChild( statusBadge );

	const update = row.openstation_update_available;
	if ( update?.available && update.new_version ) {
		const upd = document.createElement( 'os-badge' );
		upd.setAttribute( 'tone', 'warning' );
		upd.textContent = sprintf(
			/* translators: %s: new version available */
			__( 'Update to %s', 'desktop-mode' ),
			update.new_version,
		);
		titleRow.appendChild( upd );
	}

	titleBlock.appendChild( titleRow );

	// Byline
	const byline = document.createElement( 'p' );
	byline.className = 'os-plugins__detail-byline';
	const authorText = stripHtml( row.author ?? '' ) || __( 'Unknown author', 'desktop-mode' );
	if ( row.author_uri ) {
		const a = document.createElement( 'a' );
		a.href = row.author_uri;
		a.target = '_blank';
		a.rel = 'noopener noreferrer';
		a.textContent = authorText;
		a.setAttribute( 'data-noclick', '' );
		byline.append( __( 'by', 'desktop-mode' ) + ' ', a );
	} else {
		byline.textContent = sprintf(
			/* translators: %s: plugin author */
			__( 'by %s', 'desktop-mode' ),
			authorText,
		);
	}
	titleBlock.appendChild( byline );

	inner.append( iconTile, titleBlock );
	hero.appendChild( inner );

	return hero;
}

// ─── Tab body dispatch ─────────────────────────────────────────────

function renderTab(
	tab: DetailTab,
	row: InstalledPlugin,
	slug: string,
	info: WpOrgPluginInfo | null,
): HTMLElement {
	if ( tab === 'overview' ) {
		return renderOverview( row, slug, info );
	}
	if ( tab === 'details' ) {
		return renderDetails( row );
	}
	if ( tab === 'changelog' ) {
		return renderChangelog( info );
	}
	if ( tab === 'faq' ) {
		return renderFaq( info );
	}
	return renderReviews( slug, info );
}

// ─── Overview ──────────────────────────────────────────────────────

function renderOverview(
	row: InstalledPlugin,
	slug: string,
	info: WpOrgPluginInfo | null,
): HTMLElement {
	const stack = document.createElement( 'os-stack' );
	stack.setAttribute( 'gap', '20' );

	// Meta chips strip (rating, installs, last updated, tested up to)
	const chipStrip = buildOverviewChips( row, info );
	if ( chipStrip.children.length > 0 ) {
		stack.appendChild( chipStrip );
	}

	// Description (prefer wp.org rich description, fall back to plugin
	// header `description`).
	const descHtml =
		info?.sections?.description ??
		info?.short_description ??
		readDescription( row );
	if ( descHtml ) {
		const desc = document.createElement( 'div' );
		desc.className = 'os-plugins__detail-html';
		desc.innerHTML = sanitizeHtml( descHtml );
		sanitizeLinks( desc );
		stack.appendChild( desc );
	} else if ( slug && ! info ) {
		// wp.org plugin but info still loading — show a spinner where
		// the rich description will land.
		stack.appendChild( buildLoadingBlock( __( 'Loading description…', 'desktop-mode' ) ) );
	} else {
		stack.appendChild(
			buildEmpty(
				'admin-plugins',
				__( 'No description', 'desktop-mode' ),
				__( 'This plugin doesn’t ship a description in its header.', 'desktop-mode' ),
			),
		);
	}

	// Action cluster — links to wp.org / plugin site / author site.
	const actions = document.createElement( 'os-cluster' );
	actions.setAttribute( 'gap', '8' );
	actions.className = 'os-plugins__detail-actions';
	if ( slug ) {
		actions.appendChild(
			linkButton(
				'primary',
				__( 'View on WordPress.org', 'desktop-mode' ),
				`https://wordpress.org/plugins/${ encodeURIComponent( slug ) }/`,
			),
		);
	}
	if ( row.plugin_uri ) {
		actions.appendChild(
			linkButton( 'secondary', __( 'Plugin website', 'desktop-mode' ), row.plugin_uri ),
		);
	}
	if ( row.author_uri ) {
		actions.appendChild(
			linkButton( 'ghost', __( 'Author website', 'desktop-mode' ), row.author_uri ),
		);
	}
	if ( actions.children.length > 0 ) {
		stack.appendChild( actions );
	}

	return stack;
}

function buildOverviewChips(
	row: InstalledPlugin,
	info: WpOrgPluginInfo | null,
): HTMLElement {
	const strip = document.createElement( 'os-cluster' );
	strip.setAttribute( 'gap', '8' );
	strip.className = 'os-plugins__detail-chip-strip';

	if ( info ) {
		// Stars + rating count — render the existing star cluster.
		if ( typeof info.rating === 'number' && info.rating > 0 ) {
			const stars = document.createElement( 'span' );
			stars.className = 'os-plugins__detail-stars-pill';
			stars.appendChild( buildStarCluster( info.rating, info.num_ratings ?? 0 ) );
			strip.appendChild( stars );
		}
		if ( info.active_installs ) {
			strip.appendChild(
				chip(
					'admin-users',
					sprintf(
						/* translators: %s: comma-grouped active install count */
						__( '%s+ active installs', 'desktop-mode' ),
						new Intl.NumberFormat().format( info.active_installs ),
					),
				),
			);
		}
		if ( info.last_updated ) {
			strip.appendChild(
				chip(
					'update',
					sprintf(
						/* translators: %s: date the plugin was last updated */
						__( 'Updated %s', 'desktop-mode' ),
						humanDate( info.last_updated ),
					),
				),
			);
		}
		if ( info.tested ) {
			strip.appendChild(
				chip(
					'wordpress-alt',
					sprintf(
						/* translators: %s: maximum tested WordPress version */
						__( 'Tested up to WP %s', 'desktop-mode' ),
						info.tested,
					),
				),
			);
		}
	}

	if ( row.requires_wp ) {
		strip.appendChild(
			chip(
				'wordpress',
				sprintf(
					/* translators: %s: minimum WordPress version */
					__( 'Requires WP %s+', 'desktop-mode' ),
					row.requires_wp,
				),
			),
		);
	}
	if ( row.requires_php ) {
		strip.appendChild(
			chip(
				'editor-code',
				sprintf(
					/* translators: %s: minimum PHP version */
					__( 'Requires PHP %s+', 'desktop-mode' ),
					row.requires_php,
				),
			),
		);
	}
	if ( row.network_only ) {
		strip.appendChild(
			chip( 'networking', __( 'Network only', 'desktop-mode' ) ),
		);
	}

	return strip;
}

// ─── Details (metadata cards) ──────────────────────────────────────

function renderDetails( row: InstalledPlugin ): HTMLElement {
	const grid = document.createElement( 'os-grid' );
	grid.setAttribute( 'columns', '2' );
	grid.setAttribute( 'gap', '12' );
	grid.className = 'os-plugins__detail-grid';

	pushFactCard( grid, 'media-document', __( 'Plugin file', 'desktop-mode' ), codeNode( row.plugin ) );
	if ( row.version ) {
		pushFactCard( grid, 'tag', __( 'Version', 'desktop-mode' ), row.version );
	}
	if ( row.openstation_size_kb !== null && row.openstation_size_kb !== undefined ) {
		pushFactCard(
			grid,
			'database',
			__( 'Size on disk', 'desktop-mode' ),
			formatSize( row.openstation_size_kb ),
		);
	}
	if ( row.requires_wp ) {
		pushFactCard(
			grid,
			'wordpress-alt',
			__( 'Requires WordPress', 'desktop-mode' ),
			sprintf( /* translators: %s: version */ __( '%s+', 'desktop-mode' ), row.requires_wp ),
		);
	}
	if ( row.requires_php ) {
		pushFactCard(
			grid,
			'editor-code',
			__( 'Requires PHP', 'desktop-mode' ),
			sprintf( /* translators: %s: version */ __( '%s+', 'desktop-mode' ), row.requires_php ),
		);
	}
	if ( row.textdomain ) {
		pushFactCard(
			grid,
			'translation',
			__( 'Text domain', 'desktop-mode' ),
			codeNode( String( row.textdomain ) ),
		);
	}
	if ( row.plugin_uri ) {
		pushFactCard( grid, 'admin-links', __( 'Plugin URL', 'desktop-mode' ), externalLink( row.plugin_uri ) );
	}
	if ( row.author_uri ) {
		pushFactCard( grid, 'admin-users', __( 'Author URL', 'desktop-mode' ), externalLink( row.author_uri ) );
	}
	if ( row.network_only ) {
		pushFactCard(
			grid,
			'networking',
			__( 'Scope', 'desktop-mode' ),
			__( 'Network only', 'desktop-mode' ),
		);
	}
	pushFactCard(
		grid,
		row.status === 'active' || row.status === 'active-network' ? 'yes-alt' : 'marker',
		__( 'Status', 'desktop-mode' ),
		row.status === 'active' || row.status === 'active-network'
			? __( 'Active', 'desktop-mode' )
			: __( 'Inactive', 'desktop-mode' ),
	);
	return grid;
}

function pushFactCard(
	parent: HTMLElement,
	icon: string,
	label: string,
	value: HTMLElement | string,
): void {
	const card = document.createElement( 'os-card' );
	card.setAttribute( 'compact', '' );
	card.className = 'os-plugins__detail-fact';

	const head = document.createElement( 'div' );
	head.setAttribute( 'slot', 'header' );
	head.className = 'os-plugins__detail-fact-head';
	const ico = document.createElement( 'span' );
	ico.className = `dashicons dashicons-${ icon }`;
	ico.setAttribute( 'aria-hidden', 'true' );
	const lab = document.createElement( 'span' );
	lab.className = 'os-plugins__detail-fact-label';
	lab.textContent = label;
	head.append( ico, lab );
	card.appendChild( head );

	const val = document.createElement( 'div' );
	val.className = 'os-plugins__detail-fact-value';
	if ( typeof value === 'string' ) {
		val.textContent = value;
	} else {
		val.appendChild( value );
	}
	card.appendChild( val );

	parent.appendChild( card );
}

// ─── Changelog — version-grouped cards ─────────────────────────────

/**
 * Parse a wp.org changelog into a sequence of `{ version, body }`
 * blocks. wp.org changelogs are loose — sometimes `<h4>1.2.3</h4>`,
 * sometimes `= 1.2.3 =` text headings, sometimes a flat list. We
 * walk the parsed DOM and group nodes under each heading; when no
 * recognised heading is present we fall back to the unsegmented
 * sanitized HTML.
 */
function renderChangelog( info: WpOrgPluginInfo | null ): HTMLElement {
	if ( ! info ) {
		return buildLoadingBlock( __( 'Loading from WordPress.org…', 'desktop-mode' ) );
	}
	const html = info.sections?.changelog;
	if ( ! html ) {
		return buildEmpty(
			'list-view',
			__( 'No changelog', 'desktop-mode' ),
			__( 'This plugin doesn’t ship a changelog.', 'desktop-mode' ),
		);
	}

	const entries = parseChangelogEntries( html );
	if ( entries.length === 0 ) {
		// Fall back to the plain sanitized HTML — better than nothing.
		const wrap = document.createElement( 'div' );
		wrap.className = 'os-plugins__detail-html';
		wrap.innerHTML = sanitizeHtml( html );
		sanitizeLinks( wrap );
		return wrap;
	}

	const stack = document.createElement( 'os-stack' );
	stack.setAttribute( 'gap', '12' );
	stack.className = 'os-plugins__detail-changelog';

	entries.forEach( ( entry, i ) => {
		const card = document.createElement( 'os-card' );
		card.className = 'os-plugins__detail-changelog-entry';

		const head = document.createElement( 'div' );
		head.setAttribute( 'slot', 'header' );
		head.className = 'os-plugins__detail-changelog-head';

		const ver = document.createElement( 'os-badge' );
		ver.setAttribute( 'tone', i === 0 ? 'success' : 'neutral' );
		ver.textContent = entry.version;
		head.appendChild( ver );

		if ( i === 0 ) {
			const latest = document.createElement( 'span' );
			latest.className = 'os-plugins__detail-changelog-latest';
			latest.textContent = __( 'Latest', 'desktop-mode' );
			head.appendChild( latest );
		}

		card.appendChild( head );

		const body = document.createElement( 'div' );
		body.className = 'os-plugins__detail-html';
		body.innerHTML = sanitizeHtml( entry.body );
		sanitizeLinks( body );
		card.appendChild( body );

		stack.appendChild( card );
	} );

	return stack;
}

interface ChangelogEntry {
	version: string;
	body: string;
}

function parseChangelogEntries( html: string ): ChangelogEntry[] {
	const tmp = document.createElement( 'div' );
	tmp.innerHTML = html;
	if ( tmp.childNodes.length === 0 ) {
		return [];
	}

	const entries: ChangelogEntry[] = [];
	let current: { version: string; html: string } | null = null;
	const versionRegex = /([0-9]+\.[0-9]+(?:\.[0-9]+)?(?:[\w.+-]*)?)/;

	const flush = (): void => {
		if ( ! current ) {
			return;
		}
		entries.push( { version: current.version, body: current.html.trim() } );
		current = null;
	};

	for ( const node of Array.from( tmp.childNodes ) ) {
		if ( node.nodeType === Node.ELEMENT_NODE ) {
			const el = node as Element;
			const isHeading = /^H[1-6]$/.test( el.tagName );
			const text = ( el.textContent ?? '' ).trim();
			// Accept `1.2.3`, `= 1.2.3 =`, `Version 1.2.3`, optionally
			// followed by a date in parens or after a dash.
			const cleaned = text.replace( /^=+\s*|\s*=+$/g, '' ).trim();
			const headingMatch = isHeading ? cleaned.match( versionRegex ) : null;
			if ( headingMatch ) {
				flush();
				current = { version: cleaned, html: '' };
				continue;
			}
			if ( ! current ) {
				continue;
			}
			current.html += el.outerHTML;
			continue;
		}
		if ( node.nodeType === Node.TEXT_NODE ) {
			const text = node.textContent ?? '';
			if ( ! current ) {
				continue;
			}
			if ( text.trim() === '' ) {
				if ( current.html !== '' ) {
					current.html += text;
				}
				continue;
			}
			current.html += `<p>${ escapeHtml( text ) }</p>`;
		}
	}
	flush();
	return entries;
}

// ─── FAQ — accordion of Q/A pairs ──────────────────────────────────

function renderFaq( info: WpOrgPluginInfo | null ): HTMLElement {
	if ( ! info ) {
		return buildLoadingBlock( __( 'Loading from WordPress.org…', 'desktop-mode' ) );
	}
	const html = info.sections?.faq;
	if ( ! html ) {
		return buildEmpty(
			'editor-help',
			__( 'No FAQ', 'desktop-mode' ),
			__( 'This plugin doesn’t ship an FAQ.', 'desktop-mode' ),
		);
	}

	const pairs = parseFaqPairs( html );
	if ( pairs.length === 0 ) {
		const wrap = document.createElement( 'div' );
		wrap.className = 'os-plugins__detail-html';
		wrap.innerHTML = sanitizeHtml( html );
		sanitizeLinks( wrap );
		return wrap;
	}

	const stack = document.createElement( 'os-stack' );
	stack.setAttribute( 'gap', '8' );
	stack.className = 'os-plugins__detail-faq';

	pairs.forEach( ( pair, i ) => {
		const item = document.createElement( 'details' );
		item.className = 'os-plugins__detail-faq-item';
		// Open the first question by default — gives the user a sample
		// of the answer style without making them click first.
		if ( i === 0 ) {
			item.setAttribute( 'open', '' );
		}

		const summary = document.createElement( 'summary' );
		summary.className = 'os-plugins__detail-faq-q';
		const qText = document.createElement( 'span' );
		qText.className = 'os-plugins__detail-faq-q-text';
		qText.textContent = pair.question;
		const chevron = document.createElement( 'span' );
		chevron.className = 'os-plugins__detail-faq-chevron';
		chevron.setAttribute( 'aria-hidden', 'true' );
		// SVG so the rotation animates smoothly via CSS.
		chevron.innerHTML =
			'<svg viewBox="0 0 12 12" width="12" height="12" fill="none" ' +
			'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" ' +
			'stroke-linejoin="round"><path d="M3 4.5 L6 7.5 L9 4.5"/></svg>';
		summary.append( qText, chevron );

		const body = document.createElement( 'div' );
		body.className = 'os-plugins__detail-faq-a os-plugins__detail-html';
		body.innerHTML = sanitizeHtml( pair.answer );
		sanitizeLinks( body );

		item.append( summary, body );
		stack.appendChild( item );
	} );

	return stack;
}

interface FaqPair {
	question: string;
	answer: string;
}

/**
 * Parse a wp.org plugin FAQ section into Q/A pairs.
 *
 * wp.org ships **malformed** HTML for FAQ — verified by curl against
 * api.wordpress.org for woocommerce, wordpress-seo, elementor,
 * fluent-support, jetpack, wpforms-lite. The shape is:
 *
 *     <dt id="...">
 *     Question text
 *     </h4>                      ← bogus close tag, ignored by parser
 *     <p>                        ← outer P opens
 *     <p>Real answer paragraph</p>  ← inner P closes outer P (HTML5
 *     <p>Another answer paragraph</p>  rule: <p> can't nest)
 *     </p>
 *     <dt id="..."> …            ← starts the next pair
 *
 * The HTML5 parser handles this by:
 *   1. Opening a `<dt>` element.
 *   2. Ignoring the `</h4>` (no matching open tag).
 *   3. Treating subsequent `<p>` as children of `<dt>` (P doesn't
 *      close DT).
 *   4. Auto-closing the `<dt>` when the next `<dt>` starts.
 *
 * Net effect in the DOM: each top-level `<dt>` has the question as
 * leading text and the answer paragraphs as element children. We
 * walk every `<dt>` and split on "first child element".
 *
 * Also handles two cleaner shapes as fallbacks:
 *   - Real `<dl><dt>…</dt><dd>…</dd></dl>` pairs.
 *   - Conventional `<h4>Q</h4><p>A</p>` sibling headings.
 */
function parseFaqPairs( html: string ): FaqPair[] {
	const tmp = document.createElement( 'div' );
	tmp.innerHTML = html;

	// Strategy 1 — wp.org's malformed `<dt>` shape (the common case).
	const dts = Array.from( tmp.querySelectorAll( ':scope > dt' ) );
	if ( dts.length > 0 ) {
		const pairs: FaqPair[] = [];
		for ( const dt of dts ) {
			pairs.push( splitDtIntoPair( dt ) );
		}
		return pairs.filter( ( p ) => p.question !== '' );
	}

	// Strategy 2 — real `<dl><dt>Q</dt><dd>A</dd></dl>`.
	const dl = tmp.querySelector( ':scope > dl' );
	if ( dl ) {
		const pairs: FaqPair[] = [];
		let current: { q: string; html: string } | null = null;
		for ( const node of Array.from( dl.children ) ) {
			if ( node.tagName === 'DT' ) {
				if ( current ) {
					pairs.push( { question: current.q, answer: current.html.trim() } );
				}
				current = { q: ( node.textContent ?? '' ).trim(), html: '' };
			} else if ( node.tagName === 'DD' && current ) {
				current.html += node.innerHTML;
			} else if ( current ) {
				current.html += ( node as Element ).outerHTML;
			}
		}
		if ( current ) {
			pairs.push( { question: current.q, answer: current.html.trim() } );
		}
		return pairs.filter( ( p ) => p.question !== '' );
	}

	// Strategy 3 — conventional `<h*>Q</h*><p>A</p>` sibling shape.
	const pairs: FaqPair[] = [];
	let current: { q: string; html: string } | null = null;
	const flush = (): void => {
		if ( ! current ) {
			return;
		}
		pairs.push( { question: current.q, answer: current.html.trim() } );
		current = null;
	};
	for ( const node of Array.from( tmp.childNodes ) ) {
		if ( node.nodeType === Node.ELEMENT_NODE ) {
			const el = node as Element;
			const isHeading = /^H[1-6]$/.test( el.tagName );
			const text = ( el.textContent ?? '' ).trim();
			if ( isHeading && text ) {
				flush();
				current = { q: text, html: '' };
				continue;
			}
			if ( ! current ) {
				continue;
			}
			current.html += el.outerHTML;
			continue;
		}
		if ( node.nodeType === Node.TEXT_NODE && current ) {
			const text = node.textContent ?? '';
			if ( text.trim() === '' ) {
				if ( current.html !== '' ) {
					current.html += text;
				}
				continue;
			}
			current.html += `<p>${ escapeHtml( text ) }</p>`;
		}
	}
	flush();
	return pairs.filter( ( p ) => p.question !== '' );
}

/**
 * Split a wp.org-malformed `<dt>` element into its leading question
 * (text content up to the first element child) and trailing answer
 * (the rest, as inner HTML). Empty `<p></p>` fragments and bare
 * whitespace are stripped so the answer body is clean.
 */
function splitDtIntoPair( dt: Element ): FaqPair {
	let question = '';
	let answerHtml = '';
	let seenElement = false;
	for ( const child of Array.from( dt.childNodes ) ) {
		if ( child.nodeType === Node.TEXT_NODE ) {
			if ( ! seenElement ) {
				question += child.textContent ?? '';
			} else {
				const txt = child.textContent ?? '';
				if ( txt.trim() !== '' ) {
					answerHtml += `<p>${ escapeHtml( txt ) }</p>`;
				}
			}
			continue;
		}
		if ( child.nodeType !== Node.ELEMENT_NODE ) {
			continue;
		}
		const el = child as Element;
		// Skip empty `<p></p>` fragments left behind by the broken
		// `<p><p>…</p></p>` nesting in the wp.org source.
		if ( el.tagName === 'P' && ( el.textContent ?? '' ).trim() === '' ) {
			continue;
		}
		// First substantive child element → answer begins here.
		seenElement = true;
		answerHtml += el.outerHTML;
	}
	return {
		question: question.replace( /\s+/g, ' ' ).trim(),
		answer: answerHtml.trim(),
	};
}

function escapeHtml( text: string ): string {
	const tmp = document.createElement( 'span' );
	tmp.textContent = text;
	return tmp.innerHTML;
}

// ─── Reviews ───────────────────────────────────────────────────────

function renderReviews(
	slug: string,
	info: WpOrgPluginInfo | null,
): HTMLElement {
	const stack = document.createElement( 'os-stack' );
	stack.setAttribute( 'gap', '16' );

	if ( ! info ) {
		stack.appendChild( buildLoadingBlock( __( 'Loading from WordPress.org…', 'desktop-mode' ) ) );
		return stack;
	}

	stack.appendChild( buildHistogram( info ) );

	// Body slot is filled by `paintReviewList` once the scrape lands.
	// Lives as its own child so the histogram stays put and the grid
	// can grow/shrink without re-rendering the rest.
	const body = document.createElement( 'div' );
	body.className = 'os-plugins__detail-reviews';
	stack.appendChild( body );

	const cached = reviewsCache.get( slug );
	if ( cached ) {
		paintReviewList( body, cached, slug );
	} else {
		body.appendChild( buildLoadingBlock( __( 'Loading recent reviews…', 'desktop-mode' ) ) );
		void ( async () => {
			try {
				const resp = await fetchPluginReviews( slug );
				reviewsCache.set( slug, resp );
				if ( body.isConnected ) {
					paintReviewList( body, resp, slug );
				}
			} catch {
				if ( body.isConnected ) {
					body.replaceChildren(
						buildEmpty(
							'warning',
							__( 'Couldn’t load reviews', 'desktop-mode' ),
							__( 'WordPress.org didn’t respond. Try again in a moment.', 'desktop-mode' ),
						),
					);
				}
			}
		} )();
	}
	return stack;
}

function paintReviewList(
	host: HTMLElement,
	resp: PluginReviewsResponse,
	slug: string,
): void {
	host.replaceChildren();

	// The scrape can fail for a dozen reasons (HTML change, rate
	// limit, locale redirect, blocked egress). When parsed=false we
	// have NO signal about whether reviews actually exist — claiming
	// "No recent reviews" would be a lie. Be honest about it: tell
	// the user we couldn't load them here, and CTA out to wp.org.
	if ( ! resp.parsed ) {
		host.appendChild( buildReviewsFallback( slug ) );
		return;
	}
	if ( resp.items.length === 0 ) {
		// No reviews scraped — we DON'T want to claim the plugin has
		// no reviews (the histogram above may show hundreds). Just
		// surface the action: a centered button to write one on
		// wp.org. No misleading heading, no empty-state graphic.
		host.appendChild( buildWriteReviewCta( slug ) );
		return;
	}

	// Two-column grid of review cards. `os-grid columns="2"` keeps
	// the cards equal-width and aligned; on narrow widths the CSS
	// in `PANEL_STYLES` collapses it to a single column.
	const grid = document.createElement( 'os-grid' );
	grid.setAttribute( 'columns', '2' );
	grid.setAttribute( 'gap', '12' );
	grid.className = 'os-plugins__detail-reviews-grid';
	for ( const item of resp.items ) {
		grid.appendChild( buildReviewCard( item ) );
	}
	host.appendChild( grid );

	// Always offer a way out to the full wp.org thread — even when
	// we have items, the user may want the full discussion.
	const more = document.createElement( 'div' );
	more.className = 'os-plugins__detail-reviews-more';
	more.appendChild(
		linkButton(
			'ghost',
			__( 'Read all reviews on WordPress.org ↗', 'desktop-mode' ),
			`https://wordpress.org/plugins/${ encodeURIComponent( slug ) }/#reviews`,
		),
	);
	host.appendChild( more );
}

/**
 * Honest fallback when the wp.org review scrape fails outright
 * (HTML drift, rate limit, locale redirect, …). We have NO signal
 * about whether reviews actually exist, so we don't lie — we just
 * say where to find them.
 */
function buildReviewsFallback( slug: string ): HTMLElement {
	const empty = buildEmpty(
		'external',
		__( 'Reviews live on WordPress.org', 'desktop-mode' ),
		__(
			'We couldn’t pull the review feed here. Open the full thread on WordPress.org to read every review.',
			'desktop-mode',
		),
	);
	const cta = document.createElement( 'os-button' );
	cta.setAttribute( 'slot', 'cta' );
	cta.setAttribute( 'variant', 'primary' );
	cta.setAttribute( 'size', 'small' );
	cta.setAttribute( 'data-noclick', '' );
	cta.textContent = __( 'Open reviews on WordPress.org ↗', 'desktop-mode' );
	cta.addEventListener( 'click', () => {
		window.open(
			`https://wordpress.org/plugins/${ encodeURIComponent( slug ) }/#reviews`,
			'_blank',
			'noopener,noreferrer',
		);
	} );
	empty.appendChild( cta );
	return empty;
}

/**
 * Centered "Write a review" button shown when the scrape returned
 * zero items. The histogram above already tells the story — there's
 * no need for an empty-state heading.
 */
function buildWriteReviewCta( slug: string ): HTMLElement {
	const wrap = document.createElement( 'div' );
	wrap.className = 'os-plugins__detail-reviews-cta';
	wrap.appendChild(
		linkButton(
			'primary',
			__( 'Write a review on WordPress.org ↗', 'desktop-mode' ),
			`https://wordpress.org/support/plugin/${ encodeURIComponent( slug ) }/reviews/#new-post`,
		),
	);
	return wrap;
}

function buildReviewCard( item: PluginReview ): HTMLElement {
	const card = document.createElement( 'os-card' );
	card.setAttribute( 'compact', '' );
	card.className = 'os-plugins__detail-review';

	const head = document.createElement( 'div' );
	head.setAttribute( 'slot', 'header' );
	head.className = 'os-plugins__detail-review-head';
	const author = document.createElement( 'strong' );
	author.textContent = item.author || __( 'Anonymous', 'desktop-mode' );
	head.appendChild( author );
	const stars = buildStarCluster( ( item.stars / 5 ) * 100, 0 );
	head.appendChild( stars );
	if ( item.date ) {
		const date = document.createElement( 'span' );
		date.className = 'os-plugins__detail-review-date';
		date.textContent = item.date;
		head.appendChild( date );
	}
	card.appendChild( head );

	if ( item.excerpt ) {
		const body = document.createElement( 'p' );
		body.className = 'os-plugins__detail-review-body';
		body.textContent = item.excerpt;
		card.appendChild( body );
	}

	if ( item.url ) {
		const foot = document.createElement( 'div' );
		foot.setAttribute( 'slot', 'footer' );
		const link = document.createElement( 'a' );
		link.href = item.url;
		link.target = '_blank';
		link.rel = 'noopener noreferrer';
		link.setAttribute( 'data-noclick', '' );
		link.textContent = __( 'Read full review ↗', 'desktop-mode' );
		link.className = 'os-plugins__detail-review-link';
		foot.appendChild( link );
		card.appendChild( foot );
	}
	return card;
}

function buildHistogram( info: WpOrgPluginInfo ): HTMLElement {
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

// ─── Small helpers ─────────────────────────────────────────────────

function chip( icon: string, label: string ): HTMLElement {
	const c = document.createElement( 'os-chip' );
	c.setAttribute( 'label', label );
	c.setAttribute( 'tone', 'neutral' );
	const ico = document.createElement( 'span' );
	ico.setAttribute( 'slot', 'icon' );
	ico.className = `dashicons dashicons-${ icon }`;
	ico.setAttribute( 'aria-hidden', 'true' );
	c.appendChild( ico );
	return c;
}

function buildLoadingBlock( label: string ): HTMLElement {
	const wrap = document.createElement( 'div' );
	wrap.className = 'os-plugins__detail-loading-block';
	const spinner = document.createElement( 'os-spinner' );
	spinner.setAttribute( 'preset', 'classic' );
	spinner.setAttribute( 'size', '20' );
	wrap.appendChild( spinner );
	const text = document.createElement( 'span' );
	text.textContent = label;
	wrap.appendChild( text );
	return wrap;
}

function buildEmpty(
	icon: string,
	heading: string,
	description: string,
): HTMLElement {
	const e = document.createElement( 'os-empty-state' );
	e.setAttribute( 'icon', `dashicons-${ icon }` );
	e.setAttribute( 'heading', heading );
	e.setAttribute( 'description', description );
	return e;
}

function buildFallbackGlyph(): HTMLElement {
	const span = document.createElement( 'span' );
	span.className = 'dashicons dashicons-admin-plugins';
	span.setAttribute( 'aria-hidden', 'true' );
	return span;
}

function linkButton( variant: string, label: string, href: string ): HTMLElement {
	const btn = document.createElement( 'os-button' );
	btn.setAttribute( 'variant', variant );
	btn.setAttribute( 'size', 'small' );
	btn.textContent = label;
	btn.setAttribute( 'data-noclick', '' );
	btn.addEventListener( 'click', () => {
		window.open( href, '_blank', 'noopener,noreferrer' );
	} );
	return btn;
}

function codeNode( text: string ): HTMLElement {
	const code = document.createElement( 'code' );
	code.textContent = text;
	return code;
}

function externalLink( href: string ): HTMLElement {
	const a = document.createElement( 'a' );
	a.href = href;
	a.target = '_blank';
	a.rel = 'noopener noreferrer';
	a.textContent = href;
	a.setAttribute( 'data-noclick', '' );
	return a;
}

function sanitizeLinks( wrap: HTMLElement ): void {
	wrap.querySelectorAll( 'a' ).forEach( ( a ) => {
		a.setAttribute( 'target', '_blank' );
		a.setAttribute( 'rel', 'noopener noreferrer' );
		a.setAttribute( 'data-noclick', '' );
	} );
}

function deriveSlug( row: InstalledPlugin ): string {
	if ( ! row.openstation_icon_url ) {
		return '';
	}
	// `update_plugins` transient carries the canonical wp.org slug
	// when the plugin has a pending update — prefer it.
	const fromUpdate = row.openstation_update_available?.slug;
	if ( fromUpdate ) {
		return fromUpdate;
	}
	// Folder name is the wp.org repo slug for nearly every installed
	// plugin on the directory. Textdomain only matches for a minority,
	// so it's the last-resort fallback (single-file plugins where the
	// folder is `.`).
	const file = typeof row.plugin === 'string' ? row.plugin : '';
	if ( file ) {
		const slash = file.indexOf( '/' );
		if ( slash > 0 ) {
			return file.slice( 0, slash );
		}
	}
	if ( row.textdomain ) {
		return String( row.textdomain );
	}
	return '';
}

function readDescription( row: InstalledPlugin ): string {
	const d = row.description;
	if ( ! d ) {
		return '';
	}
	if ( typeof d === 'string' ) {
		return d;
	}
	return d.rendered || d.raw || '';
}

function formatSize( kb: number ): string {
	if ( kb < 1024 ) {
		return sprintf( /* translators: %d: kilobytes */ __( '%d KB', 'desktop-mode' ), kb );
	}
	return sprintf(
		/* translators: %s: megabytes (one decimal) */
		__( '%s MB', 'desktop-mode' ),
		( kb / 1024 ).toFixed( 1 ),
	);
}

function humanDate( raw: string ): string {
	const m = /^(\d{4})-(\d{2})-(\d{2})/.exec( raw );
	if ( ! m ) {
		return raw;
	}
	try {
		return new Date( Date.UTC( +m[ 1 ], +m[ 2 ] - 1, +m[ 3 ] ) ).toLocaleDateString();
	} catch {
		return raw;
	}
}

function stripHtml( html: string ): string {
	const tmp = document.createElement( 'div' );
	tmp.innerHTML = html;
	return tmp.textContent ?? '';
}

function sanitizeHtml( html: string ): string {
	const allowed = new Set( [
		'A', 'ABBR', 'B', 'BLOCKQUOTE', 'BR', 'CODE', 'DD', 'DEL', 'DIV',
		'DL', 'DT', 'EM', 'FIGCAPTION', 'FIGURE', 'H1', 'H2', 'H3', 'H4',
		'H5', 'H6', 'HR', 'I', 'IMG', 'KBD', 'LI', 'OL', 'P', 'PRE', 'Q',
		'S', 'SMALL', 'SPAN', 'STRONG', 'SUB', 'SUP', 'TABLE', 'TBODY',
		'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'U', 'UL',
	] );
	const allowedAttrs = new Set( [
		'href', 'src', 'alt', 'title', 'name', 'rel', 'target',
		'colspan', 'rowspan',
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
				if ( href.toLowerCase().startsWith( 'javascript:' ) ) {
					current.removeAttribute( 'href' );
				}
			}
			if ( current.tagName === 'IMG' ) {
				const src = current.getAttribute( 'src' ) ?? '';
				if ( src.toLowerCase().startsWith( 'javascript:' ) ) {
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

// ─── Panel styles (injected into the shadow tree at mount) ─────────
//
// `<os-table>` renders the sub-row inside its own shadow DOM, so
// document-level CSS (`plugins-window.css`) does NOT reach the
// panel. We ship this stylesheet as a `<style>` element appended
// inside the panel root so the rules live in the same shadow tree
// as the markup. Every selector is namespaced under
// `.os-plugins__detail*` so the rules don't bleed into
// other rows of the table.

const PANEL_STYLES = `
.os-plugins__detail {
	display: block;
	background: var( --os-ui-surface-subtle, rgba( 0, 0, 0, 0.025 ) );
	border-block-start: 1px solid var( --os-ui-border, rgba( 0, 0, 0, 0.08 ) );
	border-block-end: 1px solid var( --os-ui-border, rgba( 0, 0, 0, 0.08 ) );
	color: var( --os-ui-fg, inherit );
	font-size: 13px;
	line-height: 1.55;
}

/* Hero */
.os-plugins__detail-hero {
	background: var( --os-ui-surface-raised, rgba( 255, 255, 255, 0.6 ) );
	border-block-end: 1px solid var( --os-ui-border, rgba( 0, 0, 0, 0.08 ) );
}
.os-plugins__detail-hero-inner {
	display: flex;
	align-items: center;
	gap: 14px;
	padding: 14px 24px;
}
.os-plugins__detail-hero-icon {
	flex: 0 0 44px;
	width: 44px;
	height: 44px;
	border-radius: 10px;
	overflow: hidden;
	background: var( --os-ui-surface, rgba( 0, 0, 0, 0.04 ) );
	box-shadow: 0 0 0 1px var( --os-ui-border, rgba( 0, 0, 0, 0.08 ) ) inset;
	display: flex;
	align-items: center;
	justify-content: center;
}
.os-plugins__detail-hero-icon img {
	width: 100%;
	height: 100%;
	max-width: 100%;
	max-height: 100%;
	object-fit: contain;
	display: block;
}
.os-plugins__detail-hero-icon .dashicons {
	font-size: 20px;
	width: 20px;
	height: 20px;
	line-height: 20px;
	color: var( --os-ui-fg-muted, #888 );
}
.os-plugins__detail-hero-text {
	flex: 1 1 auto;
	min-width: 0;
}
.os-plugins__detail-title {
	margin: 0;
	font-size: 15px;
	font-weight: 600;
	line-height: 1.25;
	letter-spacing: -0.005em;
	color: var( --os-ui-fg, inherit );
}
.os-plugins__detail-byline {
	margin: 0;
	font-size: 12.5px;
	color: var( --os-ui-fg-muted, #666 );
}
.os-plugins__detail-byline a {
	color: inherit;
	text-decoration: underline;
	text-decoration-color: var( --os-ui-border-strong, rgba( 0, 0, 0, 0.25 ) );
}
.os-plugins__detail-byline a:hover {
	color: var( --wp-admin-theme-color, #2271b1 );
}

/* Tab strip */
.os-plugins__detail-tabs-wrap {
	padding: 0 24px;
	background: var( --os-ui-surface-raised, rgba( 255, 255, 255, 0.6 ) );
	border-block-end: 1px solid var( --os-ui-border, rgba( 0, 0, 0, 0.08 ) );
}
.os-plugins__detail-tabs {
	display: block;
}

/* Body */
.os-plugins__detail-body {
	padding: 22px 24px 26px;
	max-width: 100%;
}

/* Overview chip strip */
.os-plugins__detail-chip-strip {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
	align-items: center;
}
.os-plugins__detail-stars-pill {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	padding: 4px 12px;
	border-radius: 999px;
	background: rgba( 234, 179, 8, 0.12 );
	color: #8a5a00;
	font-size: 12px;
	font-weight: 600;
}
.os-plugins__detail-actions {
	padding-top: 4px;
}

/* Sanitized HTML body (description / changelog / FAQ answers) */
.os-plugins__detail-html {
	color: var( --os-ui-fg, inherit );
	font-size: 14px;
	line-height: 1.65;
	max-width: 78ch;
}
.os-plugins__detail-html h1,
.os-plugins__detail-html h2,
.os-plugins__detail-html h3,
.os-plugins__detail-html h4 {
	margin: 16px 0 6px;
	line-height: 1.3;
	font-weight: 600;
}
.os-plugins__detail-html h1 { font-size: 18px; }
.os-plugins__detail-html h2 { font-size: 16px; }
.os-plugins__detail-html h3 { font-size: 14.5px; }
.os-plugins__detail-html h4 { font-size: 13.5px; }
.os-plugins__detail-html p {
	margin: 0 0 10px;
}
.os-plugins__detail-html ul,
.os-plugins__detail-html ol {
	margin: 0 0 10px;
	padding-inline-start: 22px;
}
.os-plugins__detail-html li { margin-bottom: 4px; }
.os-plugins__detail-html code,
.os-plugins__detail-html pre {
	font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
	font-size: 12px;
	background: rgba( 0, 0, 0, 0.06 );
	border-radius: 4px;
}
.os-plugins__detail-html code { padding: 1px 6px; }
.os-plugins__detail-html pre {
	padding: 10px 12px;
	overflow-x: auto;
	margin: 0 0 10px;
}
.os-plugins__detail-html pre code {
	background: transparent;
	padding: 0;
}
.os-plugins__detail-html a {
	color: var( --wp-admin-theme-color, #2271b1 );
}
.os-plugins__detail-html img {
	display: block;
	max-width: 100%;
	max-height: 220px;
	width: auto;
	height: auto;
	object-fit: contain;
	margin: 8px 0;
	border-radius: 6px;
}

/* Details fact cards */
.os-plugins__detail-grid {
	width: 100%;
}
.os-plugins__detail-fact {
	min-width: 0;
}
.os-plugins__detail-fact-head {
	display: flex;
	align-items: center;
	gap: 8px;
	color: var( --os-ui-fg-muted, #666 );
	font-size: 11px;
	font-weight: 600;
	letter-spacing: 0.06em;
	text-transform: uppercase;
}
.os-plugins__detail-fact-head .dashicons {
	font-size: 14px;
	width: 14px;
	height: 14px;
	line-height: 14px;
}
.os-plugins__detail-fact-value {
	font-size: 14px;
	color: var( --os-ui-fg, inherit );
	word-break: break-word;
	overflow-wrap: anywhere;
	font-weight: 500;
}
.os-plugins__detail-fact-value code {
	font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
	font-size: 12.5px;
	background: rgba( 0, 0, 0, 0.06 );
	padding: 2px 7px;
	border-radius: 4px;
	font-weight: 400;
}
.os-plugins__detail-fact-value a {
	color: var( --wp-admin-theme-color, #2271b1 );
	text-decoration: none;
}
.os-plugins__detail-fact-value a:hover {
	text-decoration: underline;
}

/* Changelog — version-grouped cards */
.os-plugins__detail-changelog {
	width: 100%;
}
.os-plugins__detail-changelog-entry {
	width: 100%;
}
.os-plugins__detail-changelog-head {
	display: flex;
	align-items: center;
	gap: 10px;
}
.os-plugins__detail-changelog-latest {
	font-size: 11px;
	font-weight: 600;
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var( --os-ui-fg-muted, #666 );
}

/* FAQ — accordion */
.os-plugins__detail-faq {
	width: 100%;
}
.os-plugins__detail-faq-item {
	background: var( --os-ui-surface-raised, rgba( 255, 255, 255, 0.7 ) );
	border: 1px solid var( --os-ui-border, rgba( 0, 0, 0, 0.08 ) );
	border-radius: 12px;
	overflow: hidden;
	transition: box-shadow 160ms ease, border-color 160ms ease;
}
.os-plugins__detail-faq-item[open] {
	border-color: var( --wp-admin-theme-color, #2271b1 );
	box-shadow: 0 4px 14px rgba( 0, 0, 0, 0.06 );
}
.os-plugins__detail-faq-q {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 14px 16px;
	cursor: pointer;
	list-style: none;
	user-select: none;
}
.os-plugins__detail-faq-q::-webkit-details-marker {
	display: none;
}
.os-plugins__detail-faq-q:hover {
	background: rgba( 0, 0, 0, 0.025 );
}
.os-plugins__detail-faq-q-text {
	flex: 1 1 auto;
	font-size: 14px;
	font-weight: 600;
	color: var( --os-ui-fg, inherit );
	line-height: 1.4;
}
.os-plugins__detail-faq-chevron {
	flex: 0 0 auto;
	width: 24px;
	height: 24px;
	border-radius: 50%;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	background: rgba( 0, 0, 0, 0.05 );
	color: var( --os-ui-fg-muted, #555 );
	transition: transform 200ms cubic-bezier( 0.2, 0.8, 0.2, 1 ), background 160ms ease;
}
.os-plugins__detail-faq-item[open] .os-plugins__detail-faq-chevron {
	transform: rotate( 180deg );
	background: var( --wp-admin-theme-color, #2271b1 );
	color: #fff;
}
.os-plugins__detail-faq-a {
	padding: 4px 16px 16px;
	border-block-start: 1px solid var( --os-ui-border, rgba( 0, 0, 0, 0.06 ) );
	background: rgba( 0, 0, 0, 0.012 );
}
@media ( prefers-reduced-motion: reduce ) {
	.os-plugins__detail-faq-chevron,
	.os-plugins__detail-faq-item {
		transition: none;
	}
}

/* Reviews */
.os-plugins__detail-reviews {
	width: 100%;
}
.os-plugins__detail-reviews-grid {
	width: 100%;
}
.os-plugins__detail-reviews-more,
.os-plugins__detail-reviews-cta {
	display: flex;
	justify-content: center;
	padding-top: 12px;
}
.os-plugins__detail-review {
	width: 100%;
	height: 100%;
	box-sizing: border-box;
}
.os-plugins__detail-review-body {
	display: -webkit-box;
	-webkit-line-clamp: 4;
	-webkit-box-orient: vertical;
	overflow: hidden;
}
@media ( max-width: 720px ) {
	.os-plugins__detail-reviews-grid {
		grid-template-columns: 1fr !important;
	}
}
.os-plugins__detail-review-head {
	display: flex;
	align-items: center;
	gap: 10px;
	flex-wrap: wrap;
}
.os-plugins__detail-review-date {
	margin-inline-start: auto;
	font-size: 11.5px;
	color: var( --os-ui-fg-muted, #888 );
}
.os-plugins__detail-review-body {
	margin: 0;
	font-size: 13px;
	color: var( --os-ui-fg, inherit );
	line-height: 1.55;
}
.os-plugins__detail-review-link {
	font-size: 12px;
	font-weight: 600;
	color: var( --wp-admin-theme-color, #2271b1 );
	text-decoration: none;
}
.os-plugins__detail-review-link:hover {
	text-decoration: underline;
}

/* Loading block */
.os-plugins__detail-loading-block {
	display: inline-flex;
	align-items: center;
	gap: 10px;
	padding: 12px 14px;
	border-radius: 10px;
	background: var( --os-ui-surface-raised, rgba( 255, 255, 255, 0.7 ) );
	border: 1px solid var( --os-ui-border, rgba( 0, 0, 0, 0.08 ) );
	color: var( --os-ui-fg-muted, #666 );
	font-size: 13px;
}

@media ( max-width: 720px ) {
	.os-plugins__detail-grid {
		grid-template-columns: 1fr !important;
	}
}
`;
