/**
 * Posts app — the client view the Posts and Pages apps share.
 *
 * `createPostsApp( id, options )` declares the whole list window as a
 * function of the state the `.os.php` declares and the page `data()`
 * returns: the toolbar (status control, search, bulk bar, plugin
 * extras, Refresh, Add New), the `<os-table>` kept in step through
 * `createListTableSync()`, continuous card browsing, and lazy canvas
 * tabs: Categories / Tags for Posts, Page atlas for Pages.
 *
 * @public
 */

import {
	__,
	createListTableSync,
	defineApp,
	html,
	mountMenuCheckboxes,
	sprintf,
	statusControl,
	type ListTableSync,
	type MenuCheckboxes,
	type TemplateResult,
} from '@openstation/app';
import type { ListTableLike } from '@openstation/app';
import { isMobileStamped } from '../../../src/mode/stamp';
import type { OsTable } from '../../../src/ui/components/os-table/os-table';
import { buildSubRow } from './cells/basic';
import { broadcastFreshCategoryTreeToPickers, clearCategoryTreeCache } from './cells/categories';
import type { CellCache, CellEnv, CellRenderers } from './cells/env';
import { refreshParentTitleRoster } from './cells/pages';
import {
	HOOK_ACTION_OPENED,
	buildColumns,
	columnLabels,
	defaultBulkActions,
	getHiddenColumns,
	mapColumnToOrderby,
	mapOrderbyToColumn,
	resolveBulkActions,
	resolveStatusSegments,
	resolveToolbarTrailing,
	type ColumnFilterData,
	type HiddenColumnsSettingKey,
} from './columns';
import { createPostsRestClient, type PostsRestClient } from './rest';
import type { BulkAction, ListData, ListExtra, ListState, PostListItem, PostsMode, PostsWindowContext } from './types';
import { fireDataLoaded, postsContext, runBulkAction, tableOf, type Ctx } from './window-context';

import { ContentFeed } from './content-feed';
import { createDeskStats } from './desk-stats';
import { paperStyles } from './paper.styles';
import { deskStyles } from './desk.styles';
import { deskTools, freshDesk, renderDesk, syncDeskControls, type DeskState } from './desk';

const LOG = '[openstation:desktop-mode-posts]';

/** A term canvas: mounts into a host, returns its teardown. */
export type TermsCanvas = ( host: HTMLElement, env: CanvasEnv ) => Promise< () => void >;

/** What a canvas needs from the app — its doors to the shell go through `ctx`. */
export interface CanvasEnv {
	client: PostsRestClient;
	extra: ListExtra;
	/** Open an admin URL in an iframe window. */
	openUrl: ( url: string, title: string, icon: string ) => void;
	/** Say a mutation failed, with the server's reason. */
	toast: ( title: string, err: unknown ) => void;
	/** Leave the list window's fullscreen, where a new window would open behind it. */
	leaveFullscreen: () => void;
}

interface PostsAppOptions {
	/** Optional Pages atlas; mounted only when its tab is opened. */
	atlas?: ( host: HTMLElement, ctx: Ctx ) => () => void;
	/** The Categories / Tags tabs (Posts only). */
	terms?: { categories: TermsCanvas; tags: TermsCanvas };
	/** The taxonomy cells (Posts only) — the Pages bundle ships none. */
	cells?: CellRenderers;
}

const TAG_PAGE_SIZE = 50;

interface UiState {
	desk: DeskState;
	feed: ContentFeed;
	stats?: ReturnType< typeof createDeskStats >;
	atlas?: () => void;
	client: PostsRestClient | null;
	env: CellEnv | null;
	cellCache: CellCache;
	table: ListTableSync< PostListItem >;
	filterData: ColumnFilterData;
	columnsKey: string;
	hidden: Set< string > | null;
	selected: number;
	bulkActions: BulkAction[] | null;
	extras: HTMLElement[] | null;
	postsCtx: PostsWindowContext | null;
	tab: string;
	canvases: { categories: ( () => void ) | null; tags: ( () => void ) | null };
	canvasPending: Set< string >;
	menu: MenuCheckboxes | null;
	disposed: boolean;
	tagPage: number;
	tagTotalPages: number;
	tagFetching: boolean;
}

const freshUi = (): UiState => ( {
	desk: freshDesk(),
	feed: new ContentFeed(),
	client: null,
	env: null,
	cellCache: new Map(),
	table: createListTableSync< PostListItem >(),
	filterData: { authors: [], tags: [] },
	columnsKey: '',
	hidden: null,
	selected: 0,
	bulkActions: null,
	extras: null,
	postsCtx: null,
	tab: 'posts',
	canvases: { categories: null, tags: null },
	canvasPending: new Set(),
	menu: null,
	disposed: false,
	tagPage: 0,
	tagTotalPages: 1,
	tagFetching: false,
} );

const modeOf = ( extra: Record< string, unknown > ): PostsMode =>
	( extra as ListExtra ).mode === 'pages' ? 'pages' : 'posts';

/** Stable key for the page — identical rows skip the table repaint. */
function fingerprint( items: PostListItem[] ): string {
	return items.map( ( r ) => `${ r.id }:${ r.status }:${ r.modified_gmt }` ).join( '|' );
}

function clientOf( ctx: Ctx, ui: UiState ): PostsRestClient {
	if ( ! ui.client ) {
		ui.client = createPostsRestClient( ctx.fetch );
	}
	return ui.client;
}

/** The hidden-column set, read from the settings once and kept in step by the subscription. */
function hiddenOf( ui: UiState, settingKey: HiddenColumnsSettingKey ): Set< string > {
	if ( ! ui.hidden ) {
		ui.hidden = getHiddenColumns( settingKey );
	}
	return ui.hidden;
}

function toast( ctx: Ctx, title: string, err: unknown ): void {
	let reason = '';
	if ( err instanceof Error ) {
		reason = err.message;
	} else if ( err !== null && err !== undefined ) {
		reason = String( err );
	}
	ctx.host.toast?.( { message: `${ title } ${ reason }`.trim(), duration: 6000 } );
}

function cellEnv( ctx: Ctx, ui: UiState, cells: CellRenderers ): CellEnv {
	if ( ! ui.env ) {
		ui.env = {
			extra: ctx.extra as ListExtra,
			client: clientOf( ctx, ui ),
			cells,
			openUrl: ( url, title, icon ) => ctx.host.openUrl?.( url, title, icon ),
			confirm: ( options ) => ctx.host.confirm?.( options ) ?? Promise.resolve( false ),
			toast: ( title, err ) => toast( ctx, title, err ),
			announce: ( action, ids ) => ctx.host.announce?.( 'post', action, ids ),
			parentTitles: new Map(),
			categories: { tree: null, pickers: new Set() },
		};
	}
	return ui.env;
}

function canvasEnv( ctx: Ctx, ui: UiState ): CanvasEnv {
	return {
		client: clientOf( ctx, ui ),
		extra: ctx.extra as ListExtra,
		openUrl: ( url, title, icon ) => ctx.host.openUrl?.( url, title, icon ),
		toast: ( title, err ) => toast( ctx, title, err ),
		leaveFullscreen: () => {
			// The window manager is the shell's public surface; a window
			// in fullscreen would open the editor behind itself.
			const win = window.wp?.os?.windowManager?.getById?.( ctx.windowId ) as
				| { isFullscreen?: () => boolean; toggleFullscreen?: () => void }
				| undefined;
			if ( win?.isFullscreen?.() ) {
				win.toggleFullscreen?.();
			}
		},
	};
}

/** Tags load page-by-page; `os-multiselect-load-more` drives the next. */
export async function fetchNextTagPage( ctx: Ctx, ui: UiState ): Promise< void > {
	if ( ui.tagFetching || ui.tagPage >= ui.tagTotalPages ) {
		return;
	}
	ui.tagFetching = true;
	try {
		const next = ui.tagPage + 1;
		const res = await clientOf( ctx, ui ).fetchTagOptions( next, TAG_PAGE_SIZE );
		ui.tagPage = next;
		ui.tagTotalPages = Math.max( ui.tagTotalPages, res.totalPages || next );
		const seen = new Set( ui.filterData.tags.map( ( t ) => t.id ) );
		for ( const item of res.items ) {
			if ( ! seen.has( item.id ) ) {
				ui.filterData.tags.push( item );
				seen.add( item.id );
			}
		}
		ui.filterData.tagsHasMore = ui.tagPage < ui.tagTotalPages;
		ctx.repaint();
	} finally {
		ui.tagFetching = false;
	}
}

const filterSig = ( fd: ColumnFilterData ): string =>
	`${ fd.authors.map( ( a ) => a.id ).join( ',' ) }|${ fd.tags.map( ( t ) => t.id ).join( ',' ) }|${ fd.tagsHasMore ? 1 : 0 }`;

const parseIds = ( raw: string ): number[] =>
	raw
		.split( ',' )
		.map( ( s ) => parseInt( s.trim(), 10 ) )
		.filter( ( n ) => Number.isFinite( n ) && n > 0 );
const sameIds = ( a: number[], b: number[] ): boolean => a.length === b.length && a.every( ( v, i ) => v === b[ i ] );

/** One-time table wiring: identity, sub-row, sort + filter + selection listeners. */
function wireTable( ctx: Ctx, ui: UiState, table: OsTable< PostListItem > ): void {
	const extra = ctx.extra as ListExtra;
	table.getRowId = ( row ) => row.id;
	table.subTable = ( row ) => buildSubRow( row );
	// The arrow only on a header that exists: `menu_order` is no
	// column, and the table refuses a sort it cannot show.
	const sortKey = mapOrderbyToColumn( ctx.state.orderby );
	table.sort = table.columns.some( ( c ) => c.key === sortKey ) ? { key: sortKey, direction: ctx.state.order } : null;
	table.addEventListener( 'os-table-selection-change', () => {
		ui.selected = table.selection?.size ?? 0;
		ctx.repaint();
	} );
	// Clearing a column sort returns to the DECLARED default — `date
	// desc` for posts, `menu_order asc` for pages.
	table.addEventListener( 'os-table-sort-change', ( e: Event ) => {
		const sort = ( e as CustomEvent< { sort: { key: string; direction: 'asc' | 'desc' } | null } > ).detail?.sort;
		const defaultOrderby = extra.defaultOrderby ?? 'date';
		void ctx.dispatch(
			'sort',
			sort
				? { orderby: mapColumnToOrderby( sort.key, defaultOrderby ), order: sort.direction }
				: { orderby: defaultOrderby, order: extra.defaultOrder ?? 'desc' },
		);
	} );
	// Column filter dropdowns (Author, Tags): comma-joined ids in the
	// table's filter map, written to the state, then a `filter` round
	// trip from page 1.
	table.addEventListener( 'os-table-filter-change', ( e: Event ) => {
		const filters = ( e as CustomEvent< { filters: Record< string, string > } > ).detail?.filters ?? {};
		const author = parseIds( filters.author ?? '' );
		const tag = parseIds( filters.tags ?? '' );
		if ( sameIds( author, ctx.state.author ) && sameIds( tag, ctx.state.tag ) ) {
			return;
		}
		ctx.local( 'set-column-filters', { author, tag } );
		void ctx.dispatch( 'filter' );
	} );
}

/**
 * Declare the list window's client view.
 *
 * @param id      The app id (`desktop-mode-posts` | `desktop-mode-pages`).
 * @param options The term canvases and taxonomy cells, for Posts.
 */
export function createPostsApp( id: string, options: PostsAppOptions = {} ) {
	const terms = options.terms;
	const cells: CellRenderers = options.cells ?? {};
	const hiddenColumnsKey: HiddenColumnsSettingKey =
		id === 'desktop-mode-pages' ? 'nativePagesHiddenColumns' : 'nativePostsHiddenColumns';

	const mountCanvas = ( ctx: Ctx, ui: UiState, which: 'categories' | 'tags' ): void => {
		if ( ! terms || ui.canvases[ which ] || ui.canvasPending.has( which ) ) {
			return;
		}
		const host = ctx.root.querySelector< HTMLElement >( which === 'categories' ? '[data-os-posts-cats-host]' : '[data-os-posts-tags-host]' );
		if ( ! host ) {
			return;
		}
		ui.canvasPending.add( which );
		void terms[ which ]( host, canvasEnv( ctx, ui ) )
			.then( ( teardown ) => {
				// The window closed while PixiJS was loading: nothing to keep.
				if ( ui.disposed ) {
					teardown();
					return;
				}
				ui.canvases[ which ] = teardown;
			} )
			.catch( ( err ) => {
				// eslint-disable-next-line no-console
				console.error( `${ LOG } ${ which } canvas failed`, err );
			} )
			.finally( () => ui.canvasPending.delete( which ) );
	};

	const bulkBar = ( ctx: Ctx, ui: UiState, mode: PostsMode, footer: boolean ): TemplateResult => {
		// Resolved once, on the first paint: the registry filter sees the
		// same defaults it always did, and every button dispatches
		// against the live selection at click time.
		if ( ! ui.bulkActions ) {
			ui.bulkActions = resolveBulkActions( defaultBulkActions( mode, ( ids ) => ctx.dispatch( 'trash', { ids } ) ) );
		}
		return html`
			<div class="os-app-list__toolbar-right ${ footer ? 'os-app-list__bulk--footer' : '' }" data-os-posts-bulk ?hidden=${ ui.selected === 0 }>
				<span class="os-app-list__count" data-os-posts-count>${ sprintf(
					/* translators: %d: selected row count. */
					__( '%d selected' ),
					ui.selected,
				) }</span>
				<os-button variant="ghost" @click=${ () => tableOf( ctx )?.clearSelection() }>${ __( 'Clear selection' ) }</os-button>
				<span class="os-app-list__bulk-actions" data-os-posts-bulk-actions>${ ui.bulkActions.map(
					( action ) => html`<os-button
						variant=${ action.variant ?? 'secondary' }
						data-os-posts-bulk-action=${ action.id }
						@click=${ () => void runBulkAction( ctx, action, postsContext( ctx, ui ) ) }
					>${ action.icon ? html`<span class="dashicons ${ action.icon }" aria-hidden="true"></span>` : '' } ${ action.label }</os-button>`,
				) }</span>
			</div>
		`;
	};

	const listPanel = ( ctx: Ctx, ui: UiState, mode: PostsMode, phone: boolean ): TemplateResult => {
		const displayCtx = ui.feed.reconcile( ctx );
		const { state, data } = displayCtx;
		const list = data?.list;
		const isPages = mode === 'pages';
		const extra = ctx.extra as ListExtra;
		const env = cellEnv( ctx, ui, cells );
		refreshParentTitleRoster( env, list?.items ?? [] );
		const addNew = (): void =>
			ctx.host.openUrl?.(
				extra.newPostUrl ?? '',
				isPages ? __( 'Add New Page' ) : __( 'Add New Post' ),
				isPages ? 'dashicons-admin-page' : 'dashicons-admin-post',
			);
		// Plugin-injected toolbar nodes, resolved once with the live context.
		if ( ! ui.extras ) {
			ui.extras = resolveToolbarTrailing( postsContext( ctx, ui ) );
		}
		return html`
			<header class="os-posts-desk__hero">
				<div><span class="os-posts-desk__eyebrow">${ isPages ? __( 'THE SHAPE OF YOUR SITE' ) : __( 'YOUR EDITORIAL SPACE' ) }</span><h2>${ isPages ? __( 'A place for every page.' ) : __( 'Stories in motion.' ) }</h2><p>${ isPages ? __( 'Find a page. See where it belongs. Make it yours.' ) : __( 'From first thought to published story. Keep the words moving.' ) }</p></div>
				<os-button variant="holo" data-os-posts-new @click=${ addNew }><span class="dashicons dashicons-plus" aria-hidden="true"></span>${ isPages ? __( 'New page' ) : __( 'Write a post' ) }</os-button>
			</header>
			<header class="os-app-list__toolbar" data-os-posts-toolbar>
				<div class="os-app-list__toolbar-left">
					${ statusControl( {
						segments: resolveStatusSegments(),
						value: state.status,
						bind: 'status',
						action: 'filter',
						label: __( 'Filter by status' ),
						phone,
					} ) }
				</div>

				<div class="os-app-list__toolbar-trailing">
					<span data-os-posts-toolbar-extras>${ ui.extras }</span>
					<os-button variant="ghost" os-action="refresh" data-os-posts-refresh title=${ __( 'Refresh' ) }>
						<span class="dashicons dashicons-update" aria-hidden="true"></span>${ __( 'Refresh' ) }
					</os-button>
				</div>
			</header>
			${ list?.error ? html`<os-notice tone="danger">${ list.error }</os-notice>` : '' }
			${ deskTools( displayCtx, ui.desk ) }
			${ renderDesk( displayCtx, ui.desk, env, ui.filterData, hiddenOf( ui, hiddenColumnsKey ), ui.feed.tail() ) }
			<div class="os-app-list__body" data-os-posts-body ?hidden=${ ui.desk.view !== 'table' }>
				<os-table
					data-os-posts-table
					os-preserve
					selectable="multi"
					sticky-header
					sticky-columns="1"
					hover
					striped
					bordered
				>
					<div slot="empty" class="os-app-list__empty">
						<span class="dashicons ${ isPages ? 'dashicons-admin-page' : 'dashicons-admin-post' }" aria-hidden="true"></span>
						<p>${ isPages ? __( 'No pages found.' ) : __( 'No posts found.' ) }</p>
						<p class="os-app-list__empty-hint">
							${ __( 'Try a different search or change the status filter.' ) }
						</p>
					</div>
				</os-table>
			</div>
			${ ui.desk.view === 'table' ? ui.feed.tail() : '' }
			${ bulkBar( ctx, ui, mode, true ) }
		`;
	};

	return defineApp< ListState, ListData >( id, {
		local: {
			'set-column-filters': ( state, args ) => {
				state.author = Array.isArray( args.author ) ? ( args.author as number[] ) : [];
				state.tag = Array.isArray( args.tag ) ? ( args.tag as number[] ) : [];
			},
		},

		// The frame paints the moment the window opens — the tabs, the
		// toolbar, the content workspace and the table's skeleton (the runtime's busy
		// mark drives it, see `mounted`) — and the rows land with `mount`.
		placeholder: ( state ) => ( {
			list: { items: [], total: 0, pages: 0, page: state.page, perPage: state.perPage, error: '', code: '' },
		} ),

		view: ( ctx ) => {
			const ui = ctx.ui( freshUi );
			const mode = modeOf( ctx.extra );
			const phone = isMobileStamped();
			const panel = listPanel( ctx, ui, mode, phone );
			const rootClass = `os-app-list desktop-mode-posts${ mode === 'pages' ? ' desktop-mode-pages' : '' }`;
			if ( ! terms && ! options.atlas ) {
				return html`<div class=${ rootClass } data-os-posts-root data-desk-options=${ String( ui.desk.filters ) }><style>${ deskStyles.cssText }${ paperStyles.cssText }</style>
					<div class="os-app-list__panel">${ panel }</div>
				</div>`;
			}
			const onTab = ( e: Event ): void => {
				const value = ( e as CustomEvent< { value: string } > ).detail?.value ?? 'posts';
				ui.tab = value;
				if ( value === 'atlas' && ! ui.atlas && options.atlas ) {
					const host = ctx.root.querySelector< HTMLElement >( '[data-os-pages-atlas]' );
					if ( host ) {
						ui.atlas = options.atlas( host, ctx );
					}
				}
				if ( value === 'categories' || value === 'tags' ) {
					mountCanvas( ctx, ui, value );
				}
			};
			return html`<div class=${ rootClass } data-os-posts-root data-desk-options=${ String( ui.desk.filters ) }><style>${ deskStyles.cssText }${ paperStyles.cssText }</style>
				<os-tabs value=${ ui.tab } class="os-app-list__tabs" @os-tab-change=${ onTab }>
					<os-tab value="posts">${ mode === 'pages' ? __( 'All pages' ) : __( 'All posts' ) }</os-tab>
					${ options.atlas ? html`<os-tab value="atlas">${ __( 'Page atlas' ) }</os-tab>` : '' }
					${ terms ? html`<os-tab value="categories">${ __( 'Categories' ) }</os-tab><os-tab value="tags">${ __( 'Tags' ) }</os-tab>` : '' }
				</os-tabs>
				<os-tabpanel for="posts" class="os-app-list__panel">${ panel }</os-tabpanel>
				${ options.atlas ? html`<os-tabpanel for="atlas" class="os-app-list__panel"><div data-os-pages-atlas class="os-pages-atlas-host" os-preserve></div></os-tabpanel>` : '' }
				${ terms ? html`<os-tabpanel for="categories" class="os-app-list__panel">
					<div data-os-posts-cats-host class="os-posts__terms-host" os-preserve></div>
				</os-tabpanel>
				<os-tabpanel for="tags" class="os-app-list__panel">
					<div data-os-posts-tags-host class="os-posts__terms-host" os-preserve></div>
				</os-tabpanel>` : '' }
			</div>`;
		},

		mounted: ( ctx ) => {
			const ui = ctx.ui( freshUi );
			const teardowns: Array< () => void > = [];
			ui.stats = createDeskStats( ctx.root, ctx.fetch, modeOf( ctx.extra ) );
			ui.stats.sync();
			teardowns.push( () => ui.stats?.dispose() );
			const env = cellEnv( ctx, ui, cells );

			// The table's skeleton while a round trip is in flight — the
			// runtime marks the root busy; the table follows it.
			const busy = new MutationObserver( () => {
				tableOf( ctx )?.toggleAttribute( 'loading', ctx.root.getAttribute( 'aria-busy' ) === 'true' );
			} );
			busy.observe( ctx.root, { attributes: true, attributeFilter: [ 'aria-busy' ] } );
			teardowns.push( () => busy.disconnect() );

			// Author options load once; tags page by page.
			void clientOf( ctx, ui ).fetchAuthorOptions().then( ( authors ) => {
				ui.filterData.authors = authors;
				ctx.repaint();
			} );
			ui.filterData.loadMoreTags = () => void fetchNextTagPage( ctx, ui );
			void fetchNextTagPage( ctx, ui );

			// "Show columns" in the window's ⋯ menu, over the OS setting.
			ui.menu = mountMenuCheckboxes( ctx.root, {
				section: __( 'Show columns' ),
				prefix: id,
				items: columnLabels( env ),
				isChecked: ( key ) => ! hiddenOf( ui, hiddenColumnsKey ).has( key ),
				onToggle: ( key ) => {
					const hidden = hiddenOf( ui, hiddenColumnsKey );
					if ( hidden.has( key ) ) {
						hidden.delete( key );
					} else {
						hidden.add( key );
					}
					const api = window.wp?.os;
					if ( api && typeof api.updateOsSettings === 'function' ) {
						api.updateOsSettings( { [ hiddenColumnsKey ]: Array.from( hidden ).sort() }, { windowId: ctx.windowId } );
					}
					ctx.repaint();
				},
			} );
			teardowns.push( () => ui.menu?.dispose() );

			// An external settings change (another tab) repaints the
			// columns and the menu's checked state.
			const api = window.wp?.os;
			if ( api && typeof api.subscribeOsSettings === 'function' ) {
				let lastHidden = Array.from( hiddenOf( ui, hiddenColumnsKey ) ).sort().join( ',' );
				teardowns.push(
					api.subscribeOsSettings( () => {
						const next = getHiddenColumns( hiddenColumnsKey );
						const key = Array.from( next ).sort().join( ',' );
						if ( key === lastHidden ) {
							return;
						}
						lastHidden = key;
						ui.hidden = next;
						ctx.repaint();
						ui.menu?.refresh();
					} ),
				);
			}
			// A category created / renamed elsewhere reaches every live
			// picker without an F5.
			if ( api && typeof api.subscribe === 'function' ) {
				teardowns.push(
					api.subscribe( 'os.term.changed', ( payload: unknown ) => {
						if ( ( payload as { taxonomy?: string } | null )?.taxonomy === 'category' ) {
							clearCategoryTreeCache( env );
							broadcastFreshCategoryTreeToPickers( env );
						}
					} ),
				);
			}
			// The view reads the mode stamp (the bulk bar's place, the
			// picker, the card list) — a desk/phone crossing repaints.
			const onModeChange = (): void => ctx.repaint();
			document.addEventListener( 'os-mode-changed', onModeChange );
			teardowns.push( () => document.removeEventListener( 'os-mode-changed', onModeChange ) );

			// The lifecycle action AFTER the first paint, so subscribers
			// read live data and can call `ctx.refresh()` on a populated
			// table.
			const postsCtx = postsContext( ctx, ui );
			const hooks = window.wp?.hooks;
			if ( hooks && typeof hooks.doAction === 'function' ) {
				hooks.doAction( HOOK_ACTION_OPENED, postsCtx );
			}
			document.dispatchEvent( new CustomEvent( 'os-posts-window-opened', { detail: postsCtx } ) );

			return () => {
				ui.disposed = true;
				for ( const off of teardowns ) {
					off();
				}
				ui.feed.dispose();
				ui.atlas?.();
				ui.canvases.categories?.();
				ui.canvases.tags?.();
				ui.canvases = { categories: null, tags: null };
				clearCategoryTreeCache( env );
			};
		},

		updated: ( ctx ) => {
			syncDeskControls( ctx.root );
			const table = tableOf( ctx );
			if ( ! table ) {
				return;
			}
			// The placeholder paint: the skeleton is up before the busy
			// mark the observer in `mounted` follows has even been set.
			if ( ctx.loading ) {
				table.setAttribute( 'loading', '' );
			}
			const ui = ctx.ui( freshUi );
			ui.stats?.sync();
			ui.feed.observe( ctx.root );
			const { state, data } = ctx;
			const env = cellEnv( ctx, ui, cells );
			// The columns rebuild when the hidden set or the filter options
			// change (the phone crossing is the sync's own concern).
			const columnsKey = `${ Array.from( hiddenOf( ui, hiddenColumnsKey ) ).sort().join( ',' ) }|${ filterSig( ui.filterData ) }`;
			if ( columnsKey !== ui.columnsKey ) {
				ui.columnsKey = columnsKey;
				ui.cellCache.clear();
				ui.table.invalidateColumns();
			}
			const items = ui.feed.items;
			const result = ui.table.sync( {
				// `<os-table>` exposes `data` read-only; the sync writes through
				// its setter, which is the one the component declares.
				table: table as unknown as ListTableLike< PostListItem >,
				rows: items,
				listKey: [ state.perPage, state.search, state.status, state.orderby, state.order, state.author.join( ',' ), state.tag.join( ',' ) ].join( '|' ),
				fingerprint: fingerprint( items ),
				columns: ( phone ) => {
					ui.cellCache.clear();
					return buildColumns( env, ui.cellCache, ui.filterData, phone, hiddenOf( ui, hiddenColumnsKey ) );
				},
				wire: () => wireTable( ctx, ui, table ),
				onSelection: ( kept ) => {
					ui.selected = kept.length;
				},
			} );
			if ( result.dataChanged ) {
				if ( ! items.some( ( row ) => row.id === ui.desk.focused ) ) {
					ui.desk.focused = null;
				}
				queueMicrotask( () => {
					if ( ! ui.disposed ) {
						ctx.repaint();
					}
				} );
				// A real data change: fresh DOM for the new rows.
				ui.cellCache.clear();
				refreshParentTitleRoster( env, items );
				if ( data ) {
					fireDataLoaded( data );
				}
			}
		},
	} );
}
