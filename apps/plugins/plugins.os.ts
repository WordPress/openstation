/**
 * Plugins — the client view of the Plugins app.
 *
 * The 1:1 rebuild of the legacy Plugins window's body: the tab strip
 * (Installed / Add Plugin / OpenStation plugins), the Installed
 * toolbar, `<os-table>` and bulk bar, the Browse toolbar and card
 * gallery with the .zip upload and the window-wide drop overlay, the
 * curated gallery, and the detail flyout. What the framework absorbed
 * from the old implementation: the registration and template, the
 * config blob and the REST client for the installed list (`data()`
 * now rides every response, so the three tabs share one installed
 * list instead of fetching three), the tab-target store (the landing
 * tab is a window param the server applies on `mount` / `reopen`),
 * and the per-view mutation flows (`parts/mutations.ts`).
 *
 * What stays imperative, under `os-preserve` hosts driven from
 * `updated()`: the table (`parts/installed-table.ts`), the galleries
 * (`parts/gallery.ts`), the flyout (`parts/flyout-detail.ts`) and the
 * upload dialog (`parts/upload-dialog.ts`) — DOM the kit renders
 * itself, fed from the live `data()`.
 *
 * @public
 */

import { __, defineApp, html, sprintf, type TemplateResult } from '@openstation/app';
import { isMobileStamped } from '../../src/mode/stamp';
import type { OsTable } from '../../src/ui/components/os-table/os-table';
import { createBrowseGallery, createFeaturedGallery, type BrowseGallery, type FeaturedGallery } from './parts/gallery';
import {
	bulkButtons,
	countUpdates,
	freshInstalledUi,
	syncInstalledTable,
	type InstalledUi,
} from './parts/installed-table';
import { createPluginsRest } from './parts/rest';
import {
	PLUGINS_CHANGED_SOURCE,
	PLUGINS_CHANGED_TOPIC,
	indexKeyFor,
	type AppData,
	type AppState,
	type Ctx,
	type InstalledPlugin,
	type PluginsChangedPayload,
	type PluginsExtra,
	type PluginsHost,
} from './parts/types';
import { openUploadDialog } from './parts/upload-dialog';
import '../../src/ui/components/os-badge/os-badge';
import '../../src/ui/components/os-button/os-button';
import '../../src/ui/components/os-flyout/os-flyout';
import '../../src/ui/components/os-segmented/os-segmented';
import '../../src/ui/components/os-table/os-table';
import '../../src/ui/components/os-tabs/os-tabs';
import '../../src/ui/components/os-text-field/os-text-field';

/** The app id — the legacy window's FROZEN identifier (see AGENTS.md). */
const APP_ID = 'desktop-mode-plugins';

/** Client-only per-window state — none of it may reach the server. */
interface UiState {
	host: PluginsHost;
	installed: InstalledUi;
	browse: BrowseGallery | null;
	featured: FeaturedGallery | null;
	/** installed-list identity the galleries last painted their CTAs from. */
	ctaKey: string;
	/** Nesting depth of the window-wide .zip drag (child enter/leave pairs). */
	dragDepth: number;
	teardown: Array< () => void >;
}

/** Build the host every part works against — once per mounted view. */
function createHost( ctx: Ctx ): PluginsHost {
	const extra = (): PluginsExtra => ctx.extra as unknown as PluginsExtra;
	const rest = createPluginsRest( extra );
	return {
		get extra() {
			return extra();
		},
		get installed() {
			return ctx.data?.installed ?? [];
		},
		rest,
		root: ctx.root,
		dispatch: ctx.dispatch,
		refresh: () => ctx.dispatch( 'refresh' ),
		repaint: () => ctx.repaint(),
		toast: ( message, duration = 3500 ) => {
			// The shell's toast takes a duration; the runtime host's does not.
			const api = window.wp?.os;
			if ( typeof api?.showToast === 'function' ) {
				api.showToast( { message, duration } );
			} else {
				ctx.host.toast?.( { message } );
			}
		},
		confirm: ( opts ) => {
			const api = window.wp?.os;
			if ( typeof api?.confirm === 'function' ) {
				return api.confirm( opts );
			}
			return ctx.host.confirm?.( opts ) ?? Promise.resolve( true );
		},
		installedFor: ( slug ) => ( ctx.data?.installed ?? [] ).find( ( r ) => indexKeyFor( r ) === slug ),
		broadcastChange: ( payload ) => {
			const api = window.wp?.os;
			if ( typeof api?.broadcast === 'function' ) {
				api.broadcast< PluginsChangedPayload >( PLUGINS_CHANGED_TOPIC, {
					source: PLUGINS_CHANGED_SOURCE,
					...payload,
				} );
			}
		},
	};
}

const uiOf = ( ctx: Ctx ): UiState =>
	ctx.ui< UiState >( () => ( {
		host: createHost( ctx ),
		installed: freshInstalledUi(),
		browse: null,
		featured: null,
		ctaKey: '',
		dragDepth: 0,
		teardown: [],
	} ) );

const table = ( ctx: Ctx ): OsTable< InstalledPlugin > | null =>
	ctx.root.querySelector< OsTable< InstalledPlugin > >( '[data-os-plugins-table]' );

const flyout = ( ctx: Ctx ): HTMLElement | null =>
	ctx.root.querySelector< HTMLElement >( '[data-os-plugins-flyout]' );

/** The selection's actions — in the toolbar on a desk, a bar along the bottom on a phone. */
function bulkBar( ui: UiState, footer: boolean ): TemplateResult {
	const buttons = bulkButtons( ui.host, ui.installed, () => ui.host.root.querySelector( '[data-os-plugins-table]' ) );
	return html`<div class="os-plugins__bulk${ footer ? ' os-plugins__bulk--footer' : '' }" ?hidden=${ ui.installed.selected.length === 0 }>
		<span class="os-plugins__bulk-count">${ sprintf(
			/* translators: %d: number of selected plugins */
			__( '%d selected', 'desktop-mode' ),
			ui.installed.selected.length,
		) }</span>
		${ buttons.map(
			( b ) => html`<os-button variant=${ b.variant } size="small" @click=${ b.run }>${ b.label }</os-button>`,
		) }
	</div>`;
}

function installedPanel( ctx: Ctx, ui: UiState, phone: boolean ): TemplateResult {
	const { state, data } = ctx;
	if ( ! ui.host.extra.caps.activate ) {
		return html`<p style="padding:20px;color:var(--os-ui-fg-muted, #666);">${ __(
			'You do not have permission to manage plugins.',
			'desktop-mode',
		) }</p>`;
	}
	const updates = countUpdates( data.installed );
	return html`
		<header class="os-plugins__toolbar">
			<div class="os-plugins__toolbar-left">
				<os-segmented os-bind="status" value=${ state.status } label=${ __( 'Filter by status', 'desktop-mode' ) }>
					<os-segment value="">${ __( 'All', 'desktop-mode' ) }</os-segment>
					<os-segment value="active">${ __( 'Active', 'desktop-mode' ) }</os-segment>
					<os-segment value="inactive">${ __( 'Inactive', 'desktop-mode' ) }</os-segment>
					<os-segment value="update">
						<span>${ __( 'Update available', 'desktop-mode' ) }</span>
						<os-badge tone="warning" no-dot style="margin-inline-start:6px;" ?hidden=${ updates === 0 }>${ updates > 0 ? String( updates ) : '' }</os-badge>
					</os-segment>
				</os-segmented>
				<os-text-field
					os-bind="search"
					os-debounce="200"
					placeholder=${ __( 'Search installed plugins…', 'desktop-mode' ) }
				></os-text-field>
			</div>
			${ phone ? '' : html`<div class="os-plugins__toolbar-right">${ bulkBar( ui, false ) }</div>` }
			<div class="os-plugins__toolbar-trailing">
				<os-button variant="ghost" os-action="reload" title=${ __( 'Refresh', 'desktop-mode' ) }>
					<span class="dashicons dashicons-update" aria-hidden="true"></span>
				</os-button>
			</div>
		</header>
		<div class="os-plugins__body">
			${ data.error ? html`<p class="os-plugins__gallery-status">${ sprintf(
				/* translators: %s: error message */
				__( 'Could not load plugins: %s', 'desktop-mode' ),
				data.error,
			) }</p>` : '' }
			<os-table
				data-os-plugins-table
				data-installed-rows
				os-preserve
				selectable="multi"
				sticky-header
				sticky-columns="1"
				hover
				striped
				bordered
			>
				<div slot="empty" class="os-plugins__empty">
					<span class="dashicons dashicons-admin-plugins" aria-hidden="true"></span>
					<p>${ __( 'No plugins match your filters.', 'desktop-mode' ) }</p>
				</div>
			</os-table>
		</div>
		${ phone ? bulkBar( ui, true ) : '' }
	`;
}

function browsePanel( ctx: Ctx, ui: UiState ): TemplateResult {
	const { state } = ctx;
	const filters: Array< [ string, string ] > = [
		[ 'featured', __( 'Featured', 'desktop-mode' ) ],
		[ 'popular', __( 'Popular', 'desktop-mode' ) ],
		[ 'recommended', __( 'Recommended', 'desktop-mode' ) ],
		[ 'favorites', __( 'Favorites', 'desktop-mode' ) ],
		[ 'new', __( 'New', 'desktop-mode' ) ],
		[ 'beta', __( 'Beta', 'desktop-mode' ) ],
	];
	return html`
		<header class="os-plugins__toolbar">
			<div class="os-plugins__toolbar-left">
				<os-segmented os-bind="browse" value=${ state.browse } label=${ __( 'Browse', 'desktop-mode' ) }>
					${ filters.map( ( [ value, label ] ) => html`<os-segment value=${ value }>${ label }</os-segment>` ) }
				</os-segmented>
				<os-text-field os-bind="query" placeholder=${ __( 'Search WordPress.org…', 'desktop-mode' ) }></os-text-field>
			</div>
			<div class="os-plugins__toolbar-trailing">
				${ ui.host.extra.caps.upload
					? html`<os-button variant="secondary" @click=${ () => void openUploadDialog( ui.host, null ) }>
						<span class="dashicons dashicons-upload" aria-hidden="true"></span>
						${ __( 'Upload Plugin', 'desktop-mode' ) }
					</os-button>`
					: '' }
				<os-button
					variant="ghost"
					title=${ __( 'Refresh', 'desktop-mode' ) }
					@click=${ () => {
						void ui.host.refresh();
						ui.browse?.reset();
					} }
				>
					<span class="dashicons dashicons-update" aria-hidden="true"></span>
				</os-button>
			</div>
		</header>
		<div class="os-plugins__gallery" os-preserve data-os-plugins-gallery="browse"></div>
		<p class="os-plugins__gallery-status" hidden data-os-plugins-gallery-status="browse"></p>
	`;
}

const featuredPanel = (): TemplateResult => html`
	<header class="os-plugins__featured-intro">
		<h2 class="os-plugins__featured-heading">${ __( 'Made for OpenStation', 'desktop-mode' ) }</h2>
		<p class="os-plugins__featured-blurb">${ __(
			'Plugins that extend OpenStation — desktop decorations, native windows, widgets, and other companions.',
			'desktop-mode',
		) }</p>
	</header>
	<div class="os-plugins__gallery" os-preserve data-os-plugins-gallery="featured"></div>
	<p class="os-plugins__gallery-status" hidden data-os-plugins-gallery-status="featured"></p>
`;

export default defineApp< AppState, AppData >( APP_ID, {
	view: ( ctx ) => {
		const ui = uiOf( ctx );
		const { caps } = ui.host.extra;
		const phone = isMobileStamped();
		return html`
			<div class="desktop-mode-plugins" data-os-plugins-root>
				<os-tabs value=${ ctx.state.tab } class="os-plugins__tabs" data-os-plugins-tabs os-bind="tab">
					<os-tab value="installed">${ __( 'Installed', 'desktop-mode' ) }</os-tab>
					${ caps.install
						? html`<os-tab value="browse">${ __( 'Add Plugin', 'desktop-mode' ) }</os-tab>
							<os-tab value="featured">${ __( 'OpenStation plugins', 'desktop-mode' ) }</os-tab>`
						: '' }
				</os-tabs>
				<os-tabpanel for="installed" class="os-plugins__panel">
					<div class="os-plugins__installed" data-os-plugins-installed-host>
						${ installedPanel( ctx, ui, phone ) }
					</div>
				</os-tabpanel>
				${ caps.install
					? html`<os-tabpanel for="browse" class="os-plugins__panel">
							<div class="os-plugins__browse" data-os-plugins-browse-host>${ browsePanel( ctx, ui ) }</div>
						</os-tabpanel>
						<os-tabpanel for="featured" class="os-plugins__panel">
							<div class="os-plugins__featured" data-os-plugins-featured-host>${ featuredPanel() }</div>
						</os-tabpanel>`
					: '' }
				<os-flyout
					placement="end"
					data-os-plugins-flyout
					os-preserve
					aria-label=${ __( 'Plugin details', 'desktop-mode' ) }
				></os-flyout>
				<div class="os-plugins__window-drop" aria-hidden="true">
					<p>${ __( 'Drop the .zip to install.', 'desktop-mode' ) }</p>
				</div>
			</div>
		`;
	},

	mounted: ( ctx ) => {
		const ui = uiOf( ctx );
		const { host } = ui;
		const root = ctx.root;

		// Cross-window sync: a mutation elsewhere (a `plugins.php`
		// iframe through the chromeless bridge, another tab) re-reads
		// the list; our own emissions already carried fresh data.
		const api = window.wp?.os;
		if ( typeof api?.subscribe === 'function' ) {
			ui.teardown.push(
				api.subscribe< PluginsChangedPayload >( PLUGINS_CHANGED_TOPIC, ( payload ) => {
					if ( payload?.source !== PLUGINS_CHANGED_SOURCE ) {
						void host.refresh();
					}
				} ),
			);
		}

		// The whole window body is a drop zone for a .zip from the
		// desktop — the overlay lights up, the drop opens the upload
		// dialog with the file pre-applied.
		const isFileDrag = ( ev: DragEvent ): boolean => !! ev.dataTransfer?.types.includes( 'Files' );
		const canUpload = (): boolean => !! host.extra.caps.upload;
		const onDragEnter = ( ev: DragEvent ): void => {
			if ( canUpload() && isFileDrag( ev ) ) {
				ui.dragDepth++;
				root.classList.add( 'has-zip-dragover' );
			}
		};
		const onDragLeave = ( ev: DragEvent ): void => {
			if ( canUpload() && isFileDrag( ev ) ) {
				ui.dragDepth = Math.max( 0, ui.dragDepth - 1 );
				if ( ui.dragDepth === 0 ) {
					root.classList.remove( 'has-zip-dragover' );
				}
			}
		};
		const onDragOver = ( ev: DragEvent ): void => {
			if ( canUpload() && isFileDrag( ev ) ) {
				ev.preventDefault();
			}
		};
		const onDrop = ( ev: DragEvent ): void => {
			if ( ! canUpload() ) {
				return;
			}
			ui.dragDepth = 0;
			root.classList.remove( 'has-zip-dragover' );
			const file = ev.dataTransfer?.files?.[ 0 ];
			if ( ! file ) {
				return;
			}
			ev.preventDefault();
			void openUploadDialog( host, file );
		};
		root.addEventListener( 'dragenter', onDragEnter );
		root.addEventListener( 'dragleave', onDragLeave );
		root.addEventListener( 'dragover', onDragOver );
		root.addEventListener( 'drop', onDrop );
		ui.teardown.push( () => {
			root.removeEventListener( 'dragenter', onDragEnter );
			root.removeEventListener( 'dragleave', onDragLeave );
			root.removeEventListener( 'dragover', onDragOver );
			root.removeEventListener( 'drop', onDrop );
		} );

		// The view reads the shell's mode stamp (the bulk bar's place,
		// the cards); a crossing between the desk and the phone band is
		// the one change that repaints nothing on its own.
		const onModeChange = (): void => ctx.repaint();
		document.addEventListener( 'os-mode-changed', onModeChange );
		ui.teardown.push( () => document.removeEventListener( 'os-mode-changed', onModeChange ) );

		return () => {
			for ( const off of ui.teardown ) {
				off();
			}
			ui.teardown.length = 0;
			ui.browse?.dispose();
		};
	},

	updated: ( ctx ) => {
		const ui = uiOf( ctx );
		const { host } = ui;
		const { caps } = host.extra;

		const el = table( ctx );
		if ( el && caps.activate ) {
			syncInstalledTable( el, host, ui.installed, { status: ctx.state.status, search: ctx.state.search } );
		}

		if ( caps.install ) {
			const galleryEl = ( kind: string ): HTMLElement | null =>
				ctx.root.querySelector< HTMLElement >( `[data-os-plugins-gallery="${ kind }"]` );
			const statusEl = ( kind: string ): HTMLElement | null =>
				ctx.root.querySelector< HTMLElement >( `[data-os-plugins-gallery-status="${ kind }"]` );
			// Card drop targets (drag a card to the dock) live for the
			// window; the galleries wire themselves to their hosts.
			if ( ! ui.browse ) {
				ui.browse = createBrowseGallery( { host, flyout: () => flyout( ctx ) } );
				void import( './parts/card-drag' ).then( ( m ) => {
					ui.teardown.push( m.installPluginDropTargets() );
				} );
			}
			ui.browse.sync( {
				gallery: galleryEl( 'browse' ),
				status: statusEl( 'browse' ),
				filter: ctx.state.browse,
				query: ctx.state.query,
			} );
			if ( ! ui.featured ) {
				ui.featured = createFeaturedGallery( { host, flyout: () => flyout( ctx ) } );
			}
			ui.featured.sync( { gallery: galleryEl( 'featured' ), status: statusEl( 'featured' ) } );

			// A card's CTA reads the installed list; repaint them when it
			// changed (an install, an activation from anywhere).
			const ctaKey = host.installed.map( ( r ) => `${ indexKeyFor( r ) }:${ r.status }` ).join( '|' );
			if ( ctaKey !== ui.ctaKey ) {
				ui.ctaKey = ctaKey;
				ui.browse.repaintCtas();
				ui.featured.repaintCtas();
			}
		}
	},
} );
