/**
 * Plugins app — the Installed tab's expandable-row detail panel.
 *
 * Part of the `desktop-mode-plugins` client view. Rendered inside
 * `<os-table>`'s sub-row slot: a hero band (icon + title + author +
 * status chips), a tab strip (Overview / Details / Changelog / FAQ /
 * Reviews), and the wp.org `plugin_information` payload lazy-loaded
 * the first time a row is expanded, so directory plugins get rich
 * content inline. Composed from `<os-*>` primitives so it picks up the
 * framework's theming for free.
 *
 * @public
 */

import { __, sprintf } from '@openstation/app';
import { osIconSvg } from '../../../src/ui/icons';
import { buildStarCluster } from './card';
import { formatSize, humanDate, linkButton, sanitizeHtml, sanitizeLinks } from './html';
import { attachIconFallback } from './icon-fallback';
import { PANEL_STYLES } from './installed-detail-styles';
import type { PluginsRest } from './rest';
import {
	isActiveStatus,
	stripHtml,
	type InstalledPlugin,
	type PluginReview,
	type PluginReviewsResponse,
	type WpOrgPluginInfo,
} from './types';
import '../../../src/ui/components/os-tabs/os-tabs';
import '../../../src/ui/components/os-chip/os-chip';
import '../../../src/ui/components/os-card/os-card';
import '../../../src/ui/components/os-cluster/os-cluster';
import '../../../src/ui/components/os-stack/os-stack';
import '../../../src/ui/components/os-grid/os-grid';
import '../../../src/ui/components/os-spinner/os-spinner';
import '../../../src/ui/components/os-empty-state/os-empty-state';
import '../../../src/ui/components/os-button/os-button';
import '../../../src/ui/components/os-badge/os-badge';
import '../../../src/ui/components/os-rating-summary/os-rating-summary';
import type {
	OsRatingBuckets,
	OsRatingSummary,
} from '../../../src/ui/components/os-rating-summary/os-rating-summary';

/** Resolved wp.org payloads keyed by slug — survives row re-paints. */
const wpOrgCache = new Map< string, WpOrgPluginInfo >();
/** Resolved review payloads keyed by slug. */
const reviewsCache = new Map< string, PluginReviewsResponse >();

type DetailTab = 'overview' | 'details' | 'changelog' | 'faq' | 'reviews';

/**
 * Build the detail panel for one installed plugin. Returns
 * synchronously; wp.org-dependent tabs hydrate once the lazy fetch
 * lands.
 */
export function buildInstalledDetail( row: InstalledPlugin, rest: PluginsRest ): HTMLElement {
	const root = document.createElement( 'div' );
	root.className = 'os-plugins__detail';
	// A click inside the panel must not bubble to the row-click toggle.
	root.setAttribute( 'data-noclick', '' );

	// The panel lives inside `<os-table>`'s shadow DOM, which document
	// stylesheets never reach — ship the rules in the same shadow tree.
	const style = document.createElement( 'style' );
	style.textContent = PANEL_STYLES;
	root.appendChild( style );

	const slug = deriveSlug( row );
	root.appendChild( buildHero( row ) );

	const tabsHost = document.createElement( 'div' );
	tabsHost.className = 'os-plugins__detail-tabs-wrap';
	root.appendChild( tabsHost );

	const body = document.createElement( 'div' );
	body.className = 'os-plugins__detail-body';
	root.appendChild( body );

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

	let info: WpOrgPluginInfo | null = slug ? wpOrgCache.get( slug ) ?? null : null;
	let infoFetching = false;
	let active: DetailTab = 'overview';

	const paintActive = (): void => {
		body.replaceChildren( renderTab( active, row, slug, info, rest ) );
	};

	const ensureInfo = (): void => {
		if ( ! slug || info || infoFetching ) {
			return;
		}
		infoFetching = true;
		void ( async () => {
			try {
				info = await rest.fetchPluginInfo( slug );
				wpOrgCache.set( slug, info );
			} catch {
				// The active section shows its own error state.
			} finally {
				infoFetching = false;
				if ( root.isConnected ) {
					paintActive();
				}
			}
		} )();
	};

	tabs.addEventListener( 'os-tab-change', ( ev: Event ) => {
		const detail = ( ev as CustomEvent< { value: string } > ).detail;
		active = ( detail?.value as DetailTab ) ?? 'overview';
		if ( slug && active !== 'overview' && active !== 'details' ) {
			ensureInfo();
		}
		paintActive();
	} );

	paintActive();
	return root;
}

// ─── Hero ──────────────────────────────────────────────────────────

function buildHero( row: InstalledPlugin ): HTMLElement {
	const hero = document.createElement( 'div' );
	hero.className = 'os-plugins__detail-hero';
	const inner = document.createElement( 'div' );
	inner.className = 'os-plugins__detail-hero-inner';

	// The icon alone gives identity — wp.org banners are often the icon
	// stretched, which would make the expanded row a billboard.
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
	const isActive = isActiveStatus( row.status );
	const statusBadge = document.createElement( 'os-badge' );
	statusBadge.setAttribute( 'tone', isActive ? 'success' : 'neutral' );
	statusBadge.textContent = isActive ? __( 'Active', 'desktop-mode' ) : __( 'Inactive', 'desktop-mode' );
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

// ─── Tab bodies ────────────────────────────────────────────────────

function renderTab(
	tab: DetailTab,
	row: InstalledPlugin,
	slug: string,
	info: WpOrgPluginInfo | null,
	rest: PluginsRest,
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
	return renderReviews( slug, info, rest );
}

function renderOverview( row: InstalledPlugin, slug: string, info: WpOrgPluginInfo | null ): HTMLElement {
	const stack = document.createElement( 'os-stack' );
	stack.setAttribute( 'gap', '20' );

	const chipStrip = buildOverviewChips( row, info );
	if ( chipStrip.children.length > 0 ) {
		stack.appendChild( chipStrip );
	}

	const descHtml = info?.sections?.description ?? info?.short_description ?? readDescription( row );
	if ( descHtml ) {
		stack.appendChild( htmlBlock( descHtml ) );
	} else if ( slug && ! info ) {
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

	const actions = document.createElement( 'os-cluster' );
	actions.setAttribute( 'gap', '8' );
	actions.className = 'os-plugins__detail-actions';
	if ( slug ) {
		actions.appendChild(
			linkButton(
				'primary',
				__( 'View on WordPress.org', 'desktop-mode' ),
				`https://wordpress.org/plugins/${ encodeURIComponent( slug ) }/`,
				'small',
			),
		);
	}
	if ( row.plugin_uri ) {
		actions.appendChild( linkButton( 'secondary', __( 'Plugin website', 'desktop-mode' ), row.plugin_uri, 'small' ) );
	}
	if ( row.author_uri ) {
		actions.appendChild( linkButton( 'ghost', __( 'Author website', 'desktop-mode' ), row.author_uri, 'small' ) );
	}
	if ( actions.children.length > 0 ) {
		stack.appendChild( actions );
	}
	return stack;
}

function buildOverviewChips( row: InstalledPlugin, info: WpOrgPluginInfo | null ): HTMLElement {
	const strip = document.createElement( 'os-cluster' );
	strip.setAttribute( 'gap', '8' );
	strip.className = 'os-plugins__detail-chip-strip';

	if ( info ) {
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
		strip.appendChild( chip( 'networking', __( 'Network only', 'desktop-mode' ) ) );
	}
	return strip;
}

function renderDetails( row: InstalledPlugin ): HTMLElement {
	const grid = document.createElement( 'os-grid' );
	grid.setAttribute( 'columns', '2' );
	grid.setAttribute( 'gap', '12' );
	grid.className = 'os-plugins__detail-grid';
	const isActive = isActiveStatus( row.status );

	pushFactCard( grid, 'media-document', __( 'Plugin file', 'desktop-mode' ), codeNode( row.plugin ) );
	if ( row.version ) {
		pushFactCard( grid, 'tag', __( 'Version', 'desktop-mode' ), row.version );
	}
	if ( row.openstation_size_kb !== null && row.openstation_size_kb !== undefined ) {
		pushFactCard( grid, 'database', __( 'Size on disk', 'desktop-mode' ), formatSize( row.openstation_size_kb ) );
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
		pushFactCard( grid, 'translation', __( 'Text domain', 'desktop-mode' ), codeNode( String( row.textdomain ) ) );
	}
	if ( row.plugin_uri ) {
		pushFactCard( grid, 'admin-links', __( 'Plugin URL', 'desktop-mode' ), externalLink( row.plugin_uri ) );
	}
	if ( row.author_uri ) {
		pushFactCard( grid, 'admin-users', __( 'Author URL', 'desktop-mode' ), externalLink( row.author_uri ) );
	}
	if ( row.network_only ) {
		pushFactCard( grid, 'networking', __( 'Scope', 'desktop-mode' ), __( 'Network only', 'desktop-mode' ) );
	}
	pushFactCard(
		grid,
		isActive ? 'yes-alt' : 'marker',
		__( 'Status', 'desktop-mode' ),
		isActive ? __( 'Active', 'desktop-mode' ) : __( 'Inactive', 'desktop-mode' ),
	);
	return grid;
}

function pushFactCard( parent: HTMLElement, icon: string, label: string, value: HTMLElement | string ): void {
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
		return htmlBlock( html );
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
		card.appendChild( htmlBlock( entry.body ) );
		stack.appendChild( card );
	} );
	return stack;
}

interface ChangelogEntry {
	version: string;
	body: string;
}

/**
 * wp.org changelogs are loose — `<h4>1.2.3</h4>`, `= 1.2.3 =` text
 * headings, or a flat list. Group nodes under each recognised
 * heading; no heading means the caller falls back to the plain HTML.
 */
export function parseChangelogEntries( html: string ): ChangelogEntry[] {
	const tmp = document.createElement( 'div' );
	tmp.innerHTML = html;
	const entries: ChangelogEntry[] = [];
	let current: { version: string; html: string } | null = null;
	const versionRegex = /([0-9]+\.[0-9]+(?:\.[0-9]+)?(?:[\w.+-]*)?)/;
	const flush = (): void => {
		if ( current ) {
			entries.push( { version: current.version, body: current.html.trim() } );
			current = null;
		}
	};
	for ( const node of Array.from( tmp.childNodes ) ) {
		if ( node.nodeType === Node.ELEMENT_NODE ) {
			const el = node as Element;
			const isHeading = /^H[1-6]$/.test( el.tagName );
			const cleaned = ( el.textContent ?? '' ).trim().replace( /^=+\s*|\s*=+$/g, '' ).trim();
			if ( isHeading && versionRegex.test( cleaned ) ) {
				flush();
				current = { version: cleaned, html: '' };
				continue;
			}
			if ( current ) {
				current.html += el.outerHTML;
			}
			continue;
		}
		if ( node.nodeType === Node.TEXT_NODE && current ) {
			appendText( current, node.textContent ?? '' );
		}
	}
	flush();
	return entries;
}

function appendText( current: { html: string }, text: string ): void {
	if ( text.trim() === '' ) {
		if ( current.html !== '' ) {
			current.html += text;
		}
		return;
	}
	current.html += `<p>${ escapeText( text ) }</p>`;
}

// ─── FAQ — accordion of Q/A pairs ──────────────────────────────────

function renderFaq( info: WpOrgPluginInfo | null ): HTMLElement {
	if ( ! info ) {
		return buildLoadingBlock( __( 'Loading from WordPress.org…', 'desktop-mode' ) );
	}
	const html = info.sections?.faq;
	if ( ! html ) {
		return buildEmpty( 'editor-help', __( 'No FAQ', 'desktop-mode' ), __( 'This plugin doesn’t ship an FAQ.', 'desktop-mode' ) );
	}
	const pairs = parseFaqPairs( html );
	if ( pairs.length === 0 ) {
		return htmlBlock( html );
	}
	const stack = document.createElement( 'os-stack' );
	stack.setAttribute( 'gap', '8' );
	stack.className = 'os-plugins__detail-faq';
	pairs.forEach( ( pair, i ) => {
		const item = document.createElement( 'details' );
		item.className = 'os-plugins__detail-faq-item';
		// The first question opens by default — a sample of the answer
		// style without a click first.
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
		chevron.innerHTML = osIconSvg( 'chevron-right', { size: 16, rotate: 90 } );
		summary.append( qText, chevron );
		const body = htmlBlock( pair.answer );
		body.classList.add( 'os-plugins__detail-faq-a' );
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
 * wp.org ships MALFORMED HTML for FAQ: `<dt>Question</h4><p><p>Answer…`
 * — the HTML5 parser opens a `<dt>`, ignores the stray close tag, and
 * files the answer paragraphs as children of the `<dt>` until the next
 * `<dt>`. Strategy 1 splits every top-level `<dt>` on its first child
 * element. Real `<dl><dt>…</dt><dd>…</dd></dl>` pairs and conventional
 * `<h4>Q</h4><p>A</p>` siblings are handled as fallbacks.
 */
export function parseFaqPairs( html: string ): FaqPair[] {
	const tmp = document.createElement( 'div' );
	tmp.innerHTML = html;

	const dts = Array.from( tmp.querySelectorAll( ':scope > dt' ) );
	if ( dts.length > 0 ) {
		return dts.map( splitDtIntoPair ).filter( ( p ) => p.question !== '' );
	}

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
			} else if ( current ) {
				current.html += node.tagName === 'DD' ? node.innerHTML : node.outerHTML;
			}
		}
		if ( current ) {
			pairs.push( { question: current.q, answer: current.html.trim() } );
		}
		return pairs.filter( ( p ) => p.question !== '' );
	}

	const pairs: FaqPair[] = [];
	let current: { q: string; html: string } | null = null;
	const flush = (): void => {
		if ( current ) {
			pairs.push( { question: current.q, answer: current.html.trim() } );
			current = null;
		}
	};
	for ( const node of Array.from( tmp.childNodes ) ) {
		if ( node.nodeType === Node.ELEMENT_NODE ) {
			const el = node as Element;
			const text = ( el.textContent ?? '' ).trim();
			if ( /^H[1-6]$/.test( el.tagName ) && text ) {
				flush();
				current = { q: text, html: '' };
				continue;
			}
			if ( current ) {
				current.html += el.outerHTML;
			}
			continue;
		}
		if ( node.nodeType === Node.TEXT_NODE && current ) {
			appendText( current, node.textContent ?? '' );
		}
	}
	flush();
	return pairs.filter( ( p ) => p.question !== '' );
}

/** Leading text is the question; from the first substantive element on, the answer. */
function splitDtIntoPair( dt: Element ): FaqPair {
	let question = '';
	let answerHtml = '';
	let seenElement = false;
	for ( const child of Array.from( dt.childNodes ) ) {
		if ( child.nodeType === Node.TEXT_NODE ) {
			const txt = child.textContent ?? '';
			if ( ! seenElement ) {
				question += txt;
			} else if ( txt.trim() !== '' ) {
				answerHtml += `<p>${ escapeText( txt ) }</p>`;
			}
			continue;
		}
		if ( child.nodeType !== Node.ELEMENT_NODE ) {
			continue;
		}
		const el = child as Element;
		// Empty `<p></p>` fragments left by the broken nesting.
		if ( el.tagName === 'P' && ( el.textContent ?? '' ).trim() === '' ) {
			continue;
		}
		seenElement = true;
		answerHtml += el.outerHTML;
	}
	return { question: question.replace( /\s+/g, ' ' ).trim(), answer: answerHtml.trim() };
}

// ─── Reviews ───────────────────────────────────────────────────────

function renderReviews( slug: string, info: WpOrgPluginInfo | null, rest: PluginsRest ): HTMLElement {
	const stack = document.createElement( 'os-stack' );
	stack.setAttribute( 'gap', '16' );
	if ( ! info ) {
		stack.appendChild( buildLoadingBlock( __( 'Loading from WordPress.org…', 'desktop-mode' ) ) );
		return stack;
	}
	stack.appendChild( buildHistogram( info ) );

	const body = document.createElement( 'div' );
	body.className = 'os-plugins__detail-reviews';
	stack.appendChild( body );

	const cached = reviewsCache.get( slug );
	if ( cached ) {
		paintReviewList( body, cached, slug );
		return stack;
	}
	body.appendChild( buildLoadingBlock( __( 'Loading recent reviews…', 'desktop-mode' ) ) );
	void ( async () => {
		try {
			const resp = await rest.fetchPluginReviews( slug );
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
	return stack;
}

function paintReviewList( host: HTMLElement, resp: PluginReviewsResponse, slug: string ): void {
	host.replaceChildren();
	const reviewsUrl = `https://wordpress.org/plugins/${ encodeURIComponent( slug ) }/#reviews`;
	// A failed scrape says nothing about whether reviews exist — say
	// where they live rather than claim there are none.
	if ( ! resp.parsed ) {
		const empty = buildEmpty(
			'external',
			__( 'Reviews live on WordPress.org', 'desktop-mode' ),
			__(
				'We couldn’t pull the review feed here. Open the full thread on WordPress.org to read every review.',
				'desktop-mode',
			),
		);
		const cta = linkButton( 'primary', __( 'Open reviews on WordPress.org ↗', 'desktop-mode' ), reviewsUrl, 'small' );
		cta.setAttribute( 'slot', 'cta' );
		empty.appendChild( cta );
		host.appendChild( empty );
		return;
	}
	// Zero items: the histogram already tells the story; just the CTA.
	if ( resp.items.length === 0 ) {
		const wrap = document.createElement( 'div' );
		wrap.className = 'os-plugins__detail-reviews-cta';
		wrap.appendChild(
			linkButton(
				'primary',
				__( 'Write a review on WordPress.org ↗', 'desktop-mode' ),
				`https://wordpress.org/support/plugin/${ encodeURIComponent( slug ) }/reviews/#new-post`,
				'small',
			),
		);
		host.appendChild( wrap );
		return;
	}
	const grid = document.createElement( 'os-grid' );
	grid.setAttribute( 'columns', '2' );
	grid.setAttribute( 'gap', '12' );
	grid.className = 'os-plugins__detail-reviews-grid';
	for ( const item of resp.items ) {
		grid.appendChild( buildReviewCard( item ) );
	}
	host.appendChild( grid );
	const more = document.createElement( 'div' );
	more.className = 'os-plugins__detail-reviews-more';
	more.appendChild( linkButton( 'ghost', __( 'Read all reviews on WordPress.org ↗', 'desktop-mode' ), reviewsUrl, 'small' ) );
	host.appendChild( more );
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
	head.append( author, buildStarCluster( ( item.stars / 5 ) * 100, 0 ) );
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

function htmlBlock( html: string ): HTMLElement {
	const wrap = document.createElement( 'div' );
	wrap.className = 'os-plugins__detail-html';
	wrap.innerHTML = sanitizeHtml( html );
	sanitizeLinks( wrap );
	return wrap;
}

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
	const text = document.createElement( 'span' );
	text.textContent = label;
	wrap.append( spinner, text );
	return wrap;
}

function buildEmpty( icon: string, heading: string, description: string ): HTMLElement {
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

function escapeText( text: string ): string {
	const tmp = document.createElement( 'span' );
	tmp.textContent = text;
	return tmp.innerHTML;
}

/**
 * The plugin's wp.org directory slug, or `''` when it isn't listed —
 * only the server's affirmative answer counts, never the folder name
 * (a private plugin got a 404 "View on WordPress.org" that way).
 */
export function deriveSlug( row: InstalledPlugin ): string {
	const slug = row.openstation_wporg_slug;
	return typeof slug === 'string' ? slug : '';
}

function readDescription( row: InstalledPlugin ): string {
	const d = row.description;
	if ( ! d ) {
		return '';
	}
	return typeof d === 'string' ? d : d.rendered || d.raw || '';
}
