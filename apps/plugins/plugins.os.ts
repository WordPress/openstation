/**
 * Plugins — the client view of the Plugins app.
 *
 * The body of the Plugins window: the tab strip (Installed / Add
 * Plugin / OpenStation plugins), the Installed toolbar, `<os-table>`
 * and bulk bar on the framework's list furniture, the Browse toolbar
 * and card gallery with the .zip upload and the window-wide drop
 * overlay, the curated gallery, and the detail flyout. The framework
 * owns the registration and template, the config blob, the installed
 * list (`data()` rides every response, so the three tabs share one
 * list), the landing tab (a window param the server applies on
 * `mount` / `reopen`), and the toast / confirm / broadcast plumbing
 * the parts reach through {@link PluginsHost}.
 *
 * What stays imperative, under `os-preserve` hosts driven from
 * `updated()`: the table (`parts/installed-table.ts`), the galleries
 * (`parts/gallery.ts`), the flyout (`parts/flyout-detail.ts`) and the
 * upload dialog (`parts/upload-dialog.ts`) — DOM the kit renders
 * itself, fed from the live `data()`.
 *
 * @public
 */

import { __, defineApp, html, sprintf, statusControl, type TemplateResult } from '@openstation/app';
import { isMobileStamped } from '../../src/mode/stamp';
import type { OsTable } from '../../src/ui/components/os-table/os-table';
import { bulkButtons, freshBusy } from './parts/actions';
import { installPluginDropTargets } from './parts/card-drag';
import { createBrowseGallery, createFeaturedGallery, type BrowseGallery, type FeaturedGallery } from './parts/gallery';
import { countUpdates, freshInstalledUi, syncInstalledTable, type InstalledUi } from './parts/installed-table';
import { createPluginsRest } from './parts/rest';
import {
	PLUGINS_CHANGED_SOURCE,
	PLUGINS_CHANGED_TOPIC,
	fullPluginFile,
	indexKeyFor,
	pluginChangeId,
	type AppData,
	type AppState,
	type BrowseFilter,
	type Ctx,
	type InstalledPlugin,
	type PluginsChangedPayload,
	type PluginsExtra,
	type PluginsHost,
} from './parts/types';
import { openUploadDialog } from './parts/upload-dialog';

/** The app id — the legacy window's FROZEN identifier (see AGENTS.md). */
const APP_ID = 'desktop-mode-plugins';

/** The Heartbeat relay's `source` for a change it recorded server-side. */
const HEARTBEAT_SOURCE = 'heartbeat';

/** How long a mutation of ours may take to come back through Heartbeat. */
const OWN_CHANGE_TTL_MS = 5 * 60 * 1000;

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
	/** Heartbeat ids of the plugins this window mutated, with when. */
	ownChanges: Map< number, number >;
	teardown: Array< () => void >;
}

/** Build the host every part works against — once per mounted view. */
function createHost( ctx: Ctx, ownChanges: Map< number, number > ): PluginsHost {
	const extra = (): PluginsExtra => ctx.extra as unknown as PluginsExtra;
	const rest = createPluginsRest( extra, ( url, init ) => ctx.fetch( url, init ) );
	return {
		get extra() {
			return extra();
		},
		get installed() {
			return ctx.data?.installed ?? [];
		},
		rest,
		root: ctx.root,
		busy: freshBusy(),
		caches: { info: new Map(), reviews: new Map() },
		dispatch: ctx.dispatch,
		refresh: () => ctx.dispatch( 'refresh' ),
		repaint: () => ctx.repaint(),
		toast: ( message, duration = 3500 ) => ctx.host.toast?.( { message, duration } ),
		confirm: ( opts ) =>
			ctx.host.confirm?.( {
				title: opts.title,
				message: opts.message,
				label: opts.confirmLabel,
				confirmLabel: opts.confirmLabel,
				danger: opts.danger,
			} ) ?? Promise.resolve( true ),
		refreshMenu: () => ctx.host.refreshMenu?.(),
		installedFor: ( slug ) => ( ctx.data?.installed ?? [] ).find( ( r ) => indexKeyFor( r ) === slug ),
		broadcastChange: ( payload, touched = [] ) => {
			const now = Date.now();
			for ( const plugin of [ payload.plugin, ...touched ] ) {
				if ( plugin ) {
					ownChanges.set( pluginChangeId( fullPluginFile( plugin ) ), now );
				}
			}
			// The topic carries plugin paths and plugin verbs, which the
			// runtime's numeric `announce` cannot — so this one broadcast
			// goes out on the shell bus directly.
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

/**
 * Whether a Heartbeat relay describes only plugins this window changed
 * itself recently — its own mutations already returned fresh data.
 */
function isOwnEcho( ownChanges: Map< number, number >, ids: number[] | undefined ): boolean {
	const now = Date.now();
	for ( const [ id, at ] of ownChanges ) {
		if ( now - at > OWN_CHANGE_TTL_MS ) {
			ownChanges.delete( id );
		}
	}
	return !! ids && ids.length > 0 && ids.every( ( id ) => ownChanges.has( id ) );
}

const uiOf = ( ctx: Ctx ): UiState =>
	ctx.ui< UiState >( () => {
		const ownChanges = new Map< number, number >();
		return {
			host: createHost( ctx, ownChanges ),
			installed: freshInstalledUi(),
			browse: null,
			featured: null,
			ctaKey: '',
			dragDepth: 0,
			ownChanges,
			teardown: [],
		};
	} );

const table = ( ctx: Ctx ): OsTable< InstalledPlugin > | null =>
	ctx.root.querySelector< OsTable< InstalledPlugin > >( '[data-os-plugins-table]' );

const flyout = ( ctx: Ctx ): HTMLElement | null =>
	ctx.root.querySelector< HTMLElement >( '[data-os-plugins-flyout]' );

/** The selection's actions — in the toolbar on a desk, a bar along the bottom on a phone. */
function bulkBar( ctx: Ctx, ui: UiState, footer: boolean ): TemplateResult {
	const clear = (): void => {
		table( ctx )?.clearSelection();
		ui.installed.selected = [];
		ctx.repaint();
	};
	const buttons = bulkButtons( ui.host, ui.installed.selected, clear );
	return html`<div
		class="os-app-list__toolbar-right${ footer ? ' os-app-list__bulk--footer' : '' }"
		?hidden=${ ui.installed.selected.length === 0 }
	>
		<span class="os-app-list__count">${ sprintf(
			/* translators: %d: number of selected plugins */
			__( '%d selected', 'desktop-mode' ),
			ui.installed.selected.length,
		) }</span>
		<span class="os-app-list__bulk-actions">
			${ buttons.map(
				( b ) => html`<os-button variant=${ b.variant } size="small" @click=${ b.run }>${ b.label }</os-button>`,
			) }
		</span>
	</div>`;
}

function installedPanel( ctx: Ctx, ui: UiState, phone: boolean ): TemplateResult {
	const { state, data } = ctx;
	const updates = countUpdates( data.installed );
	const segments = [
		{ value: '', label: __( 'All', 'desktop-mode' ) },
		{ value: 'active', label: __( 'Active', 'desktop-mode' ) },
		{ value: 'inactive', label: __( 'Inactive', 'desktop-mode' ) },
		{
			value: 'update',
			label:
				updates > 0
					? sprintf(
						/* translators: %d: number of plugins with a pending update */
						__( 'Update available (%d)', 'desktop-mode' ),
						updates,
					)
					: __( 'Update available', 'desktop-mode' ),
		},
	];
	return html`
		<header class="os-app-list__toolbar">
			<div class="os-app-list__toolbar-left">
				${ statusControl( {
					segments,
					value: state.status,
					bind: 'status',
					action: 'set',
					label: __( 'Filter by status', 'desktop-mode' ),
					phone,
				} ) }
				<os-text-field
					class="os-app-list__search"
					os-bind="search"
					os-debounce="200"
					placeholder=${ __( 'Search installed plugins…', 'desktop-mode' ) }
				></os-text-field>
			</div>
			${ phone ? '' : bulkBar( ctx, ui, false ) }
			<div class="os-app-list__toolbar-trailing">
				<os-button variant="ghost" os-action="reload" title=${ __( 'Refresh', 'desktop-mode' ) }>
					<span class="dashicons dashicons-update" aria-hidden="true"></span>
				</os-button>
			</div>
		</header>
		<div class="os-app-list__body">
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
				<div slot="empty" class="os-app-list__empty">
					<span class="dashicons dashicons-admin-plugins" aria-hidden="true"></span>
					<p>${ __( 'No plugins match your filters.', 'desktop-mode' ) }</p>
				</div>
			</os-table>
		</div>
		${ phone ? bulkBar( ctx, ui, true ) : '' }
	`;
}

const BROWSE_FILTERS: ReadonlyArray< { value: BrowseFilter; label: () => string } > = [
	{ value: 'featured', label: () => __( 'Featured', 'desktop-mode' ) },
	{ value: 'popular', label: () => __( 'Popular', 'desktop-mode' ) },
	{ value: 'recommended', label: () => __( 'Recommended', 'desktop-mode' ) },
	{ value: 'favorites', label: () => __( 'Favorites', 'desktop-mode' ) },
	{ value: 'new', label: () => __( 'New', 'desktop-mode' ) },
	{ value: 'beta', label: () => __( 'Beta', 'desktop-mode' ) },
];

function browsePanel( ctx: Ctx, ui: UiState, phone: boolean ): TemplateResult {
	const { state } = ctx;
	return html`
		<header class="os-app-list__toolbar">
			<div class="os-app-list__toolbar-left">
				${ statusControl( {
					segments: BROWSE_FILTERS.map( ( f ) => ( { value: f.value, label: f.label() } ) ),
					value: state.browse,
					bind: 'browse',
					action: 'set',
					label: __( 'Browse', 'desktop-mode' ),
					phone,
				} ) }
				<os-text-field
					class="os-app-list__search"
					os-bind="query"
					os-debounce="300"
					placeholder=${ __( 'Search WordPress.org…', 'desktop-mode' ) }
				></os-text-field>
			</div>
			<div class="os-app-list__toolbar-trailing">
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
	local: {
		// A bound status / filter write repaints on its own; nothing to reduce.
		set: () => undefined,
	},

	view: ( ctx ) => {
		const ui = uiOf( ctx );
		const { caps } = ui.host.extra;
		const phone = isMobileStamped();
		const tab = ctx.state.tab;
		return html`
			<div class="os-app-list desktop-mode-plugins" data-os-plugins-root>
				<os-tabs value=${ tab } class="os-app-list__tabs os-plugins__tabs" data-os-plugins-tabs os-bind="tab">
					<os-tab value="installed">${ __( 'Installed', 'desktop-mode' ) }</os-tab>
					${ caps.install
						? html`<os-tab value="browse">${ __( 'Add Plugin', 'desktop-mode' ) }</os-tab>
							<os-tab value="featured">${ __( 'OpenStation plugins', 'desktop-mode' ) }</os-tab>`
						: '' }
				</os-tabs>
				<os-tabpanel for="installed" class="os-app-list__panel os-plugins__panel" ?hidden=${ tab !== 'installed' }>
					<div class="os-plugins__installed" data-os-plugins-installed-host>
						${ installedPanel( ctx, ui, phone ) }
					</div>
				</os-tabpanel>
				${ caps.install
					? html`<os-tabpanel for="browse" class="os-app-list__panel os-plugins__panel" ?hidden=${ tab !== 'browse' }>
							<div class="os-plugins__browse" data-os-plugins-browse-host>${ browsePanel( ctx, ui, phone ) }</div>
						</os-tabpanel>
						<os-tabpanel for="featured" class="os-app-list__panel os-plugins__panel" ?hidden=${ tab !== 'featured' }>
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
		// iframe through the chromeless bridge, another tab, the
		// Heartbeat relay) re-reads the list. Our own emissions already
		// carried fresh data, and so does the relay of our own change.
		const off = ctx.host.onBroadcast?.( PLUGINS_CHANGED_TOPIC, ( _topic, payload ) => {
			const change = payload as PluginsChangedPayload | undefined;
			if ( ! change || change.source === PLUGINS_CHANGED_SOURCE ) {
				return;
			}
			if ( change.source === HEARTBEAT_SOURCE && isOwnEcho( ui.ownChanges, change.ids ) ) {
				return;
			}
			void host.refresh();
		} );
		if ( off ) {
			ui.teardown.push( off );
		}

		// Drag a card to the dock: the drop target lives for the window.
		if ( host.extra.caps.install ) {
			ui.teardown.push( installPluginDropTargets() );
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
		// the status picker); a crossing between the desk and the phone
		// band is the one change that repaints nothing on its own.
		const onModeChange = (): void => ctx.repaint();
		document.addEventListener( 'os-mode-changed', onModeChange );
		ui.teardown.push( () => document.removeEventListener( 'os-mode-changed', onModeChange ) );

		return () => {
			for ( const dispose of ui.teardown ) {
				dispose();
			}
			ui.teardown.length = 0;
			ui.browse?.dispose();
		};
	},

	updated: ( ctx ) => {
		const ui = uiOf( ctx );
		const { host } = ui;

		const el = table( ctx );
		if ( el ) {
			syncInstalledTable( el, host, ui.installed, { status: ctx.state.status, search: ctx.state.search } );
		}

		if ( host.extra.caps.install ) {
			const galleryEl = ( kind: string ): HTMLElement | null =>
				ctx.root.querySelector< HTMLElement >( `[data-os-plugins-gallery="${ kind }"]` );
			const statusEl = ( kind: string ): HTMLElement | null =>
				ctx.root.querySelector< HTMLElement >( `[data-os-plugins-gallery-status="${ kind }"]` );
			ui.browse ??= createBrowseGallery( { host, flyout: () => flyout( ctx ) } );
			ui.browse.sync( {
				gallery: galleryEl( 'browse' ),
				status: statusEl( 'browse' ),
				filter: ctx.state.browse,
				query: ctx.state.query,
				active: ctx.state.tab === 'browse',
			} );
			ui.featured ??= createFeaturedGallery( { host, flyout: () => flyout( ctx ) } );
			ui.featured.sync( {
				gallery: galleryEl( 'featured' ),
				status: statusEl( 'featured' ),
				active: ctx.state.tab === 'featured',
			} );

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
