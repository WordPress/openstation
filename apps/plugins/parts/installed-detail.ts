/**
 * Plugins app — the Installed tab's expandable-row detail panel.
 *
 * Part of the `desktop-mode-plugins` client view. Rendered inside
 * `<os-table>`'s sub-row slot: a hero band (icon + title + author +
 * status chips), a tab strip (Overview / Details / Changelog / FAQ /
 * Reviews), and the wp.org `plugin_information` payload lazy-loaded
 * the first time a row is expanded (cached per slug for the window),
 * so directory plugins get rich content inline. Composed from `<os-*>`
 * primitives so it picks up the framework's theming for free; the
 * Changelog / FAQ parsers are `wporg-sections.ts`, the Reviews section
 * `reviews.ts`.
 *
 * @public
 */

import { __, formatBytes, formatDate, sprintf } from '@openstation/app';
// The panel paints inside `<os-table>`'s shadow root, outside the
// runtime's on-demand component loading — the tags it builds register here.
import '../../../src/ui/components/os-badge/os-badge';
import '../../../src/ui/components/os-card/os-card';
import '../../../src/ui/components/os-chip/os-chip';
import '../../../src/ui/components/os-cluster/os-cluster';
import '../../../src/ui/components/os-grid/os-grid';
import '../../../src/ui/components/os-stack/os-stack';
import '../../../src/ui/components/os-tabs/os-tabs';
import { externalLink, fallbackGlyph, htmlBlock, linkButton, stripHtml, wpOrgUrl } from './html';
import { attachIconFallback } from './icon-fallback';
import { buildStarCluster } from './card';
import { emptyState, loadingLine, renderReviews } from './reviews';
import { isActiveStatus, type InstalledPlugin, type PluginsHost, type WpOrgPluginInfo } from './types';
import { renderChangelog, renderFaq } from './wporg-sections';

type DetailTab = 'overview' | 'details' | 'changelog' | 'faq' | 'reviews';

/**
 * Build the detail panel for one installed plugin. Returns
 * synchronously; wp.org-dependent tabs hydrate once the lazy fetch
 * lands.
 */
export function buildInstalledDetail( row: InstalledPlugin, host: PluginsHost ): HTMLElement {
	const root = document.createElement( 'div' );
	root.className = 'os-plugins__detail';
	// A click inside the panel must not bubble to the row-click toggle.
	root.setAttribute( 'data-noclick', '' );

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

	let info: WpOrgPluginInfo | null = slug ? host.caches.info.get( slug ) ?? null : null;
	let infoFetching = false;
	let active: DetailTab = 'overview';

	const paintActive = (): void => {
		body.replaceChildren( renderTab( active, row, slug, info, host ) );
	};

	const ensureInfo = (): void => {
		if ( ! slug || info || infoFetching ) {
			return;
		}
		infoFetching = true;
		void ( async () => {
			try {
				info = await host.rest.fetchPluginInfo( slug );
				host.caches.info.set( slug, info );
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
			iconTile.replaceChildren( fallbackGlyph() );
		} );
		iconTile.appendChild( img );
	} else {
		iconTile.appendChild( fallbackGlyph() );
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
	titleRow.appendChild( statusBadge( row ) );
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
		byline.append( __( 'by', 'desktop-mode' ) + ' ', externalLink( row.author_uri, authorText ) );
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

/** The Active / Inactive badge — the same `<os-badge>` in the table and the panel. */
export function statusBadge( row: InstalledPlugin ): HTMLElement {
	const isActive = isActiveStatus( row.status );
	const badge = document.createElement( 'os-badge' );
	badge.setAttribute( 'tone', isActive ? 'success' : 'neutral' );
	badge.textContent = isActive ? __( 'Active', 'desktop-mode' ) : __( 'Inactive', 'desktop-mode' );
	return badge;
}

// ─── Tab bodies ────────────────────────────────────────────────────

function renderTab(
	tab: DetailTab,
	row: InstalledPlugin,
	slug: string,
	info: WpOrgPluginInfo | null,
	host: PluginsHost,
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
	return renderReviews( host, slug, info );
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
		stack.appendChild( htmlBlock( descHtml, 'os-plugins__detail-html' ) );
	} else if ( slug && ! info ) {
		stack.appendChild( loadingLine( __( 'Loading description…', 'desktop-mode' ) ) );
	} else {
		stack.appendChild(
			emptyState(
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
		actions.appendChild( linkButton( 'primary', __( 'View on WordPress.org', 'desktop-mode' ), wpOrgUrl( slug ), 'small' ) );
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
						formatDate( info.last_updated.slice( 0, 10 ), 'long' ),
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
		pushFactCard( grid, 'database', __( 'Size on disk', 'desktop-mode' ), formatBytes( row.openstation_size_kb * 1024 ) );
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
		pushFactCard( grid, 'admin-links', __( 'Plugin URL', 'desktop-mode' ), externalLink( row.plugin_uri, row.plugin_uri ) );
	}
	if ( row.author_uri ) {
		pushFactCard( grid, 'admin-users', __( 'Author URL', 'desktop-mode' ), externalLink( row.author_uri, row.author_uri ) );
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

function codeNode( text: string ): HTMLElement {
	const code = document.createElement( 'code' );
	code.textContent = text;
	return code;
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
