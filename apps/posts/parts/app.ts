/**
 * Posts app — the client view the Posts and Pages apps share.
 *
 * `createPostsApp( id, options )` declares the whole list window as a
 * function of the state the `.os.php` declares and the page `data()`
 * returns: the toolbar (status control, search, bulk bar, plugin
 * extras, Refresh, Add New), the `<os-table>` fed through `updated()`,
 * the pager, and — for Posts — the in-body tabs that mount the
 * Categories mind map and the Tags cloud on first activation.
 *
 * What the framework absorbed from the legacy bundle: the REST list
 * fetch and its config blob (`data()` + `ctx.extra`), the pager and
 * status wiring (`os-bind` / `os-action` over `parts/query.php`), the
 * `os.post.changed` subscription (`watch`), the loading overlay, and
 * the teardown choreography.
 *
 * @public
 */

import {
	__,
	defineApp,
	html,
	mountMenuCheckboxes,
	pager,
	sprintf,
	statusControl,
	type MenuCheckboxes,
	type TemplateResult,
	type ViewContext,
} from '@openstation/app';
import { isMobileStamped } from '../../../src/mode/stamp';
import { stackOnPhone } from '../../../src/ui/components/os-table/stack-on-phone';
import type { OsTable } from '../../../src/ui/components/os-table/os-table';
import {
	broadcastFreshCategoryTreeToPickers,
	clearCategoryTreeCache,
	refreshParentTitleRoster,
	type CellCache,
	type CellEnv,
} from './cells';
import {
	HOOK_ACTION_DATA_LOADED,
	HOOK_ACTION_OPENED,
	REQUIRED_COLUMN_KEYS,
	buildAllColumns,
	buildBulkActionButton,
	buildColumns,
	defaultBulkActions,
	getHiddenColumns,
	mapColumnToOrderby,
	mapOrderbyToColumn,
	resolveBulkActions,
	resolveStatusSegments,
	resolveToolbarTrailing,
	type ColumnFilterData,
} from './columns';
import { createPostsRestClient, type PostsRestClient } from './rest';
import type {
	BulkAction,
	ListData,
	ListExtra,
	ListState,
	PostListItem,
	PostsListParams,
	PostsMode,
	PostsWindowContext,
} from './types';

export type Ctx = ViewContext< ListState, ListData >;

/** A term canvas: mounts into a host, returns its teardown. */
export type TermsCanvas = ( host: HTMLElement, env: CanvasEnv ) => Promise< () => void >;

export interface CanvasEnv {
	client: PostsRestClient;
	extra: ListExtra;
	/** The window this canvas lives in — for the fullscreen exit before opening a post. */
	windowId: string;
}

export interface PostsAppOptions {
	/** The Categories / Tags tabs (Posts only). */
	terms?: { categories: TermsCanvas; tags: TermsCanvas };
}

const TAG_PAGE_SIZE = 50;

interface UiState {
	client: PostsRestClient | null;
	cellCache: CellCache;
	filterData: ColumnFilterData;
	columnsKey: string;
	fingerprint: string;
	listKey: string;
	selected: number;
	bulkButtons: HTMLElement[];
	extras: HTMLElement[];
	tab: string;
	canvases: { categories: ( () => void ) | null; tags: ( () => void ) | null };
	canvasPending: Set< string >;
	menu: MenuCheckboxes | null;
	wired: boolean;
	postsCtx: PostsWindowContext | null;
	tagPage: number;
	tagTotalPages: number;
	tagFetching: boolean;
}

const freshUi = (): UiState => ( {
	client: null,
	cellCache: new Map(),
	filterData: { authors: [], tags: [] },
	columnsKey: '',
	fingerprint: '',
	listKey: '',
	selected: 0,
	bulkButtons: [],
	extras: [],
	tab: 'posts',
	canvases: { categories: null, tags: null },
	canvasPending: new Set(),
	menu: null,
	wired: false,
	postsCtx: null,
	tagPage: 0,
	tagTotalPages: 1,
	tagFetching: false,
} );

const modeOf = ( extra: Record< string, unknown > ): PostsMode =>
	( extra as ListExtra ).mode === 'pages' ? 'pages' : 'posts';

const tableOf = ( ctx: Ctx ): OsTable< PostListItem > | null =>
	ctx.root.querySelector< OsTable< PostListItem > >( '[data-os-posts-table]' );

const windowIdOf = ( ctx: Ctx, fallback: string ): string => {
	const win = ctx.root.closest< HTMLElement >( '[id^="wp-window-"]' );
	return win ? win.id.slice( 'wp-window-'.length ) : fallback;
};

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

function cellEnv( ctx: Ctx, ui: UiState ): CellEnv {
	return {
		extra: ctx.extra as ListExtra,
		client: clientOf( ctx, ui ),
		openUrl: ( url, title, icon ) => ctx.host.openUrl?.( url, title, icon ),
		confirm: ( options ) => ctx.host.confirm?.( options ) ?? Promise.resolve( false ),
	};
}

function currentParams( state: ListState ): PostsListParams {
	return {
		page: state.page,
		perPage: state.perPage,
		search: state.search || undefined,
		status: state.status || undefined,
		orderby: state.orderby,
		order: state.order,
		author: state.author.length > 0 ? state.author : undefined,
		tag: state.tag.length > 0 ? state.tag : undefined,
	};
}

/** The plugin-facing context — one per mounted window. */
function postsContext( ctx: Ctx, table: OsTable< PostListItem > ): PostsWindowContext {
	const context: PostsWindowContext = {
		body: ctx.root,
		table,
		refresh: () => ctx.dispatch( 'refresh' ).then( () => undefined ),
		getSelectedIds: () => Array.from( table.selection ?? [] ).map( ( id ) => Number( id ) ),
		getSelectedRows: () => {
			const ids = new Set( context.getSelectedIds() );
			return ( table.data ?? [] ).filter( ( r ) => ids.has( r.id ) );
		},
		getCurrentParams: () => currentParams( ctx.state ),
	};
	return context;
}

/** Confirm if asked, run, then clear + refresh unless the runner opted out. */
async function runBulkAction( ctx: Ctx, action: BulkAction, postsCtx: PostsWindowContext ): Promise< void > {
	const ids = postsCtx.getSelectedIds();
	if ( ids.length === 0 ) {
		return;
	}
	const { confirm } = action;
	if ( confirm ) {
		const message =
			typeof confirm === 'function'
				? confirm( ids.length )
				: sprintf(
					/* translators: %d: row count. */
					confirm,
					ids.length,
				);
		const ok = await ( ctx.host.confirm?.( { message, danger: true } ) ?? Promise.resolve( false ) );
		if ( ! ok ) {
			return;
		}
	}
	try {
		if ( ( await action.run( ids, postsCtx ) ) === false ) {
			return;
		}
	} catch ( err ) {
		// eslint-disable-next-line no-console
		console.error( `[posts-window] bulk action "${ action.id }" failed`, err );
	}
	postsCtx.table.clearSelection();
	await postsCtx.refresh();
}

function fireDataLoaded( data: ListData ): void {
	const detail = {
		items: data.list.items,
		total: data.list.total,
		totalPages: data.list.pages,
		page: data.list.page,
	};
	const hooks = window.wp?.hooks;
	if ( hooks && typeof hooks.doAction === 'function' ) {
		hooks.doAction( HOOK_ACTION_DATA_LOADED, detail );
	}
	document.dispatchEvent( new CustomEvent( 'os-posts-window-data-loaded', { detail } ) );
}

/** Tags load page-by-page; `os-multiselect-load-more` drives the next. */
async function fetchNextTagPage( ctx: Ctx, ui: UiState ): Promise< void > {
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
	table.getRowId = ( row ) => row.id;
	table.subTable = ( row ) => ( ctx.ui( freshUi ), buildSubRow( row ) );
	table.sort = { key: mapOrderbyToColumn( ctx.state.orderby ), direction: ctx.state.order };
	table.addEventListener( 'os-table-selection-change', () => {
		ui.selected = table.selection?.size ?? 0;
		ctx.repaint();
	} );
	table.addEventListener( 'os-table-sort-change', ( e: Event ) => {
		const sort = ( e as CustomEvent< { sort: { key: string; direction: 'asc' | 'desc' } | null } > ).detail?.sort;
		void ctx.dispatch( 'sort', sort ? { orderby: mapColumnToOrderby( sort.key ), order: sort.direction } : { orderby: 'date', order: 'desc' } );
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

// `buildSubRow` is imported lazily below to keep the cells module the
// one owner of every renderer.
import { buildSubRow } from './cells';

/**
 * Declare the list window's client view.
 *
 * @param id      The app id (`desktop-mode-posts` | `desktop-mode-pages`).
 * @param options The term canvases, for Posts.
 */
export function createPostsApp( id: string, options: PostsAppOptions = {} ) {
	const terms = options.terms;

	const mountCanvas = ( ctx: Ctx, ui: UiState, which: 'categories' | 'tags' ): void => {
		if ( ! terms || ui.canvases[ which ] || ui.canvasPending.has( which ) ) {
			return;
		}
		const host = ctx.root.querySelector< HTMLElement >( which === 'categories' ? '[data-os-posts-cats-host]' : '[data-os-posts-tags-host]' );
		if ( ! host ) {
			return;
		}
		ui.canvasPending.add( which );
		const env: CanvasEnv = { client: clientOf( ctx, ui ), extra: ctx.extra as ListExtra, windowId: windowIdOf( ctx, id ) };
		void terms[ which ]( host, env )
			.then( ( teardown ) => {
				ui.canvases[ which ] = teardown;
			} )
			.catch( ( err ) => {
				// eslint-disable-next-line no-console
				console.error( `[posts-window] ${ which } canvas failed`, err );
			} )
			.finally( () => ui.canvasPending.delete( which ) );
	};

	const bulkBar = ( ui: UiState, footer: boolean ): TemplateResult => html`
		<div
			class="os-app-list__toolbar-right os-posts__toolbar-right ${ footer ? 'os-app-list__bulk--footer os-posts__bulk--footer' : '' }"
			data-os-posts-bulk
			?hidden=${ ui.selected === 0 }
		>
			<span class="os-app-list__count os-posts__count" data-os-posts-count>${ sprintf(
				/* translators: %d: selected row count. */
				__( '%d selected' ),
				ui.selected,
			) }</span>
			<span class="os-app-list__bulk-actions os-posts__bulk-actions" data-os-posts-bulk-actions>${ ui.bulkButtons }</span>
		</div>
	`;

	const listPanel = ( ctx: Ctx, ui: UiState, mode: PostsMode, phone: boolean ): TemplateResult => {
		const { state, data } = ctx;
		const list = data?.list;
		const total = list?.total ?? 0;
		const pages = list?.pages ?? 0;
		const isPages = mode === 'pages';
		const extra = ctx.extra as ListExtra;
		let summary: string;
		if ( total === 0 ) {
			summary = isPages ? __( 'No pages' ) : __( 'No posts' );
		} else {
			const format = isPages
				? /* translators: 1: current page, 2: total pages, 3: total pages found. */ __( 'Page %1$d of %2$d · %3$d pages' )
				: /* translators: 1: current page, 2: total pages, 3: total posts. */ __( 'Page %1$d of %2$d · %3$d posts' );
			summary = sprintf( format, list?.page ?? state.page, Math.max( pages, 1 ), total );
		}
		const addNew = (): void =>
			ctx.host.openUrl?.(
				extra.newPostUrl ?? '',
				isPages ? __( 'Add New Page' ) : __( 'Add New Post' ),
				isPages ? 'dashicons-admin-page' : 'dashicons-admin-post',
			);
		return html`
			<header class="os-app-list__toolbar os-posts__toolbar" data-os-posts-toolbar>
				<div class="os-app-list__toolbar-left os-posts__toolbar-left">
					${ statusControl( {
						segments: resolveStatusSegments(),
						value: state.status,
						bind: 'status',
						action: 'filter',
						label: __( 'Filter by status' ),
						phone,
					} ) }
					<os-text-field
						class="os-app-list__search"
						data-os-posts-search
						os-bind="search"
						os-action="filter"
						os-debounce="250"
						value=${ state.search }
						placeholder=${ isPages ? __( 'Search pages…' ) : __( 'Search posts…' ) }
					></os-text-field>
				</div>
				${ phone ? '' : bulkBar( ui, false ) }
				<div class="os-app-list__toolbar-trailing os-posts__toolbar-trailing">
					<span class="os-posts__toolbar-extras" data-os-posts-toolbar-extras>${ ui.extras }</span>
					<os-button variant="ghost" os-action="refresh" data-os-posts-refresh title=${ __( 'Refresh' ) }>
						<span class="dashicons dashicons-update" aria-hidden="true"></span>
					</os-button>
					<os-button variant="primary" data-os-posts-new @click=${ addNew }>
						<span class="dashicons dashicons-plus" aria-hidden="true"></span>
						${ __( 'Add New' ) }
					</os-button>
				</div>
			</header>
			${ list?.error
				? html`<os-notice tone="danger" class="os-posts__notice">${ list.error }</os-notice>`
				: '' }
			<div class="os-app-list__body os-posts__body" data-os-posts-body>
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
					<div slot="empty" class="os-app-list__empty os-posts__empty">
						<span class="dashicons ${ isPages ? 'dashicons-admin-page' : 'dashicons-admin-post' }" aria-hidden="true"></span>
						<p>${ isPages ? __( 'No pages found.' ) : __( 'No posts found.' ) }</p>
						<p class="os-app-list__empty-hint os-posts__empty-hint">
							${ __( 'Try a different search or change the status filter.' ) }
						</p>
					</div>
				</os-table>
			</div>
			${ pager( {
				page: list?.page ?? state.page,
				pages,
				perPage: state.perPage,
				summary,
				pageAction: 'page',
				perPageBind: 'perPage',
				perPageAction: 'filter',
				labels: { previous: __( 'Previous' ), next: __( 'Next' ), perPage: __( 'Per page' ) },
			} ) }
			${ phone ? bulkBar( ui, true ) : '' }
		`;
	};

	return defineApp< ListState, ListData >( id, {
		local: {
			'set-column-filters': ( state, args ) => {
				state.author = Array.isArray( args.author ) ? ( args.author as number[] ) : [];
				state.tag = Array.isArray( args.tag ) ? ( args.tag as number[] ) : [];
			},
		},

		view: ( ctx ) => {
			const ui = ctx.ui( freshUi );
			const mode = modeOf( ctx.extra );
			const phone = isMobileStamped();
			const panel = listPanel( ctx, ui, mode, phone );
			const rootClass = `os-app-list desktop-mode-posts${ mode === 'pages' ? ' desktop-mode-pages' : '' }`;
			if ( ! terms ) {
				return html`<div class=${ rootClass } data-os-posts-root>
					<div class="os-app-list__panel os-posts__panel">${ panel }</div>
				</div>`;
			}
			const onTab = ( e: Event ): void => {
				const value = ( e as CustomEvent< { value: string } > ).detail?.value ?? 'posts';
				ui.tab = value;
				if ( value === 'categories' || value === 'tags' ) {
					mountCanvas( ctx, ui, value );
				}
			};
			return html`<div class=${ rootClass } data-os-posts-root>
				<os-tabs value=${ ui.tab } class="os-app-list__tabs os-posts__tabs" @os-tab-change=${ onTab }>
					<os-tab value="posts">${ __( 'All posts' ) }</os-tab>
					<os-tab value="categories">${ __( 'Categories' ) }</os-tab>
					<os-tab value="tags">${ __( 'Tags' ) }</os-tab>
				</os-tabs>
				<os-tabpanel for="posts" class="os-app-list__panel os-posts__panel">${ panel }</os-tabpanel>
				<os-tabpanel for="categories" class="os-app-list__panel os-posts__panel">
					<div data-os-posts-cats-host class="os-posts__terms-host" os-preserve></div>
				</os-tabpanel>
				<os-tabpanel for="tags" class="os-app-list__panel os-posts__panel">
					<div data-os-posts-tags-host class="os-posts__terms-host" os-preserve></div>
				</os-tabpanel>
			</div>`;
		},

		mounted: ( ctx ) => {
			const ui = ctx.ui( freshUi );
			const table = tableOf( ctx );
			const teardowns: Array< () => void > = [];
			const env = cellEnv( ctx, ui );
			const mode = modeOf( ctx.extra );
			const windowId = windowIdOf( ctx, id );

			if ( table ) {
				const postsCtx = postsContext( ctx, table );
				ui.postsCtx = postsCtx;
				const actions = resolveBulkActions(
					defaultBulkActions( mode, ( ids ) => ctx.dispatch( 'trash', { ids } ) ),
				);
				ui.bulkButtons = actions.map( ( action ) =>
					buildBulkActionButton( action, ( a ) => void runBulkAction( ctx, a, postsCtx ) ),
				);
				ui.extras = resolveToolbarTrailing( postsCtx );
			}

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
			const repaintMenu = (): void => ui.menu?.refresh();
			ui.menu = mountMenuCheckboxes( ctx.root, {
				section: __( 'Show columns' ),
				prefix: id,
				items: buildAllColumns( env, new Map() )
					.filter( ( c ) => ! REQUIRED_COLUMN_KEYS.has( c.key ) )
					.map( ( c ) => ( { key: c.key, label: c.label || c.key } ) ),
				isChecked: ( key ) => ! getHiddenColumns().has( key ),
				onToggle: ( key ) => {
					const hidden = getHiddenColumns();
					if ( hidden.has( key ) ) {
						hidden.delete( key );
					} else {
						hidden.add( key );
					}
					const api = window.wp?.os;
					if ( api && typeof api.updateOsSettings === 'function' ) {
						api.updateOsSettings( { nativePostsHiddenColumns: Array.from( hidden ).sort() }, { windowId } );
					}
					ctx.repaint();
				},
			} );
			teardowns.push( () => ui.menu?.dispose() );

			// An external settings change (another tab) repaints the
			// columns and the menu's checked state.
			const api = window.wp?.os;
			if ( api && typeof api.subscribeOsSettings === 'function' ) {
				let lastHidden = JSON.stringify( Array.from( getHiddenColumns() ).sort() );
				teardowns.push(
					api.subscribeOsSettings( () => {
						const next = JSON.stringify( Array.from( getHiddenColumns() ).sort() );
						if ( next === lastHidden ) {
							return;
						}
						lastHidden = next;
						ctx.repaint();
						repaintMenu();
					} ),
				);
			}
			// A category created / renamed elsewhere reaches every live
			// picker without an F5.
			if ( api && typeof api.subscribe === 'function' ) {
				teardowns.push(
					api.subscribe( 'os.term.changed', ( payload: unknown ) => {
						if ( ( payload as { taxonomy?: string } | null )?.taxonomy === 'category' ) {
							clearCategoryTreeCache();
							broadcastFreshCategoryTreeToPickers( clientOf( ctx, ui ) );
						}
					} ),
				);
			}
			// The view reads the mode stamp (the bulk bar's place, the
			// picker, the card list) — a desk/phone crossing repaints.
			const onModeChange = (): void => ctx.repaint();
			document.addEventListener( 'os-mode-changed', onModeChange );
			teardowns.push( () => document.removeEventListener( 'os-mode-changed', onModeChange ) );

			ctx.repaint();

			// The lifecycle action AFTER the first paint, so subscribers
			// read live data and can call `ctx.refresh()` on a populated
			// table.
			if ( ui.postsCtx ) {
				const hooks = window.wp?.hooks;
				if ( hooks && typeof hooks.doAction === 'function' ) {
					hooks.doAction( HOOK_ACTION_OPENED, ui.postsCtx );
				}
				document.dispatchEvent( new CustomEvent( 'os-posts-window-opened', { detail: ui.postsCtx } ) );
			}

			return () => {
				for ( const off of teardowns ) {
					off();
				}
				ui.canvases.categories?.();
				ui.canvases.tags?.();
				ui.canvases = { categories: null, tags: null };
				clearCategoryTreeCache();
			};
		},

		updated: ( ctx ) => {
			const table = tableOf( ctx );
			if ( ! table ) {
				return;
			}
			const ui = ctx.ui( freshUi );
			const { state, data } = ctx;
			if ( ! ui.wired ) {
				ui.wired = true;
				wireTable( ctx, ui, table );
			}
			// A card per row on a phone, and the columns built for it —
			// rebuilt when the phone answer, the hidden set or the filter
			// options change.
			const phone = stackOnPhone( table );
			const columnsKey = `${ phone ? 1 : 0 }|${ Array.from( getHiddenColumns() ).sort().join( ',' ) }|${ filterSig( ui.filterData ) }`;
			if ( columnsKey !== ui.columnsKey ) {
				ui.columnsKey = columnsKey;
				ui.cellCache.clear();
				table.columns = buildColumns( cellEnv( ctx, ui ), ui.cellCache, ui.filterData, phone );
			}
			// A query change replaces the result set — ids picked under
			// the previous view must not ride into the next bulk action.
			// A watch-driven refresh keeps the selection the user is
			// building.
			const listKey = [ state.page, state.perPage, state.search, state.status, state.orderby, state.order, state.author.join( ',' ), state.tag.join( ',' ) ].join( '|' );
			if ( listKey !== ui.listKey ) {
				ui.listKey = listKey;
				if ( ( table.selection?.size ?? 0 ) > 0 ) {
					table.clearSelection();
				}
				ui.selected = 0;
			}
			const items = data?.list?.items ?? [];
			const next = fingerprint( items );
			if ( next !== ui.fingerprint ) {
				ui.fingerprint = next;
				// A real data change: fresh DOM for the new rows.
				ui.cellCache.clear();
				refreshParentTitleRoster( items );
				table.data = items;
				if ( data ) {
					fireDataLoaded( data );
				}
			}
		},
	} );
}
