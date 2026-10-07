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
	type MenuTab,
	type TemplateResult,
} from '@openstation/app';
import type { ListTableLike } from '@openstation/app';
import { isMobileStamped } from '../../../src/mode/stamp';
import { queryUnsavedGuard } from '../../../src/window/unsaved-guard';
import { toastRestFailure } from '../../../src/core/rest-failure';
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

export type TermsCanvas = ( host: HTMLElement, env: CanvasEnv ) => Promise< () => void >;

export interface CanvasEnv {
	client: PostsRestClient;
	extra: ListExtra;

	openUrl: ( url: string, title: string, icon: string ) => void;

	toast: ( title: string, err: unknown ) => void;

	leaveFullscreen: () => void;
}

interface PostsAppOptions {

	atlas?: ( host: HTMLElement, ctx: Ctx ) => () => void;

	terms?: { categories: TermsCanvas; tags: TermsCanvas };

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

	serverTab: string;

	editor: ( () => void ) | null;
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
	serverTab: 'posts',
	editor: null,
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

function fingerprint( items: PostListItem[] ): string {
	return items.map( ( r ) => `${ r.id }:${ r.status }:${ r.modified_gmt }` ).join( '|' );
}

function clientOf( ctx: Ctx, ui: UiState ): PostsRestClient {
	if ( ! ui.client ) {
		ui.client = createPostsRestClient( ctx.fetch );
	}
	return ui.client;
}

function hiddenOf( ui: UiState, settingKey: HiddenColumnsSettingKey ): Set< string > {
	if ( ! ui.hidden ) {
		ui.hidden = getHiddenColumns( settingKey );
	}
	return ui.hidden;
}

function toast( ctx: Ctx, title: string, err: unknown ): void {
	const lead = title.replace( /:\s*$/, '' );
	toastRestFailure(
		ctx.host.toast,
		err,
		lead === title
			? { fallback: title, duration: 6000 }
			: { lead, fallback: `${ lead }.`, duration: 6000 },
	);
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
			const win = window.wp?.os?.windowManager?.getById?.( ctx.windowId ) as
				| { isFullscreen?: () => boolean; toggleFullscreen?: () => void }
				| undefined;
			if ( win?.isFullscreen?.() ) {
				win.toggleFullscreen?.();
			}
		},
	};
}

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

function wireTable( ctx: Ctx, ui: UiState, table: OsTable< PostListItem > ): void {
	const extra = ctx.extra as ListExtra;
	table.getRowId = ( row ) => row.id;
	table.subTable = ( row ) => buildSubRow( row );

	const sortKey = mapOrderbyToColumn( ctx.state.orderby );
	table.sort = table.columns.some( ( c ) => c.key === sortKey ) ? { key: sortKey, direction: ctx.state.order } : null;
	table.addEventListener( 'os-table-selection-change', () => {
		ui.selected = table.selection?.size ?? 0;
		ctx.repaint();
	} );

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
				if ( ui.disposed ) {
					teardown();
					return;
				}
				ui.canvases[ which ] = teardown;
			} )
			.catch( ( err ) => {
				console.error( `${ LOG } ${ which } canvas failed`, err );
			} )
			.finally( () => ui.canvasPending.delete( which ) );
	};

	const bulkBar = ( ctx: Ctx, ui: UiState, mode: PostsMode, footer: boolean ): TemplateResult => {
		if ( ! ui.bulkActions ) {
			ui.bulkActions = resolveBulkActions( defaultBulkActions( mode, ( ids ) => ctx.dispatch( 'trash', { ids } ) ) );
		}
		return html`
			<div class="os-app-list__toolbar-right ${ footer ? 'os-app-list__bulk--footer' : '' }" data-os-posts-bulk ?hidden=${ ui.selected === 0 }>
				<span class="os-app-list__count" data-os-posts-count>${ sprintf(

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

	const editorIsHolding = ( ctx: Ctx ): Promise< boolean > =>
		queryUnsavedGuard(
			ctx.root.querySelector< HTMLIFrameElement >(
				'[data-os-posts-editor] iframe',
			),
		);

	const releaseEditorIfClean = ( ctx: Ctx, ui: UiState ): void => {
		if ( ! ui.editor ) {
			return;
		}
		void editorIsHolding( ctx ).then( ( holding ) => {
			if ( holding || ui.disposed || ! ui.editor ) {
				return;
			}
			ui.editor();
			ui.editor = null;
		} );
	};

	const guardEmbeddedEditor = ( ctx: Ctx, ui: UiState ): ( () => void ) => {
		const HOOK_BEFORE_CLOSE = 'os.native-window.before-close';
		const hooks = window.wp?.hooks;
		if ( ! hooks?.addFilter || ! hooks.removeFilter ) {
			return () => {};
		}
		const namespace = `desktop-mode/posts/close-guard/${ ctx.windowId }`;
		let asking = false;
		hooks.addFilter(
			HOOK_BEFORE_CLOSE,
			namespace,
			( ...args: unknown[] ) => {
				const proceed = args[ 0 ];
				const context = args[ 1 ] as { windowId?: string } | undefined;
				if ( context?.windowId !== ctx.windowId || ! ui.editor || asking ) {
					return proceed;
				}
				asking = true;
				void ( async () => {
					const holding = await editorIsHolding( ctx );
					const leave =
						! holding ||
						( await ctx.host.confirm?.( {
							title: __( 'Leave without saving?' ),
							message: __(
								'This post has changes that have not been saved. Closing the window discards them.',
							),
							confirmLabel: __( 'Discard and close' ),
							danger: true,
						} ) ) === true;
					asking = false;
					if ( ! leave ) {
						return;
					}

					ui.editor?.();
					ui.editor = null;
					window.wp?.os?.windowManager?.getById( ctx.windowId )?.close();
				} )();
				return false;
			},
		);
		return () => hooks.removeFilter?.( HOOK_BEFORE_CLOSE, namespace );
	};

	const mountEditor = ( ctx: Ctx, ui: UiState ): void => {
		if ( ui.editor ) {
			return;
		}
		const host = ctx.root.querySelector< HTMLElement >(
			'[data-os-posts-editor]',
		);
		const url = ( ctx.extra as ListExtra ).newPostUrl ?? '';
		if ( host && url ) {
			ui.editor = window.wp?.os?.embedAdminPage?.( host, url ) ?? null;
		}
	};

	const showEditorTab = ( ctx: Ctx, ui: UiState, mode: PostsMode ): void => {
		const strip = ctx.root.querySelector< HTMLElement & { value: string } >(
			'os-tabs',
		);
		if ( ! strip ) {
			const isPages = mode === 'pages';
			ctx.host.openUrl?.(
				( ctx.extra as ListExtra ).newPostUrl ?? '',
				isPages ? __( 'Add Page' ) : __( 'Add Post' ),
				isPages ? 'dashicons-admin-page' : 'dashicons-admin-post',
			);
			return;
		}
		strip.value = 'new';
		activateTab( ctx, ui, 'new' );
	};

	const menuTabs = ( ctx: Ctx ): MenuTab[] =>
		( ( ctx.extra as { menuTabs?: MenuTab[] } ).menuTabs ?? [] );

	const activateTab = ( ctx: Ctx, ui: UiState, value: string ): void => {
		if ( ui.tab === 'new' && value !== 'new' ) {
			releaseEditorIfClean( ctx, ui );
		}
		ui.tab = value;
		if ( value === 'new' ) {
			mountEditor( ctx, ui );
			return;
		}
		if ( value === 'atlas' && ! ui.atlas && options.atlas ) {
			const host = ctx.root.querySelector< HTMLElement >( '[data-os-pages-atlas]' );
			if ( host ) {
				ui.atlas = options.atlas( host, ctx );
			}
			return;
		}
		if ( value === 'categories' || value === 'tags' ) {
			mountCanvas( ctx, ui, value );
		}
	};

	const adoptServerTab = ( ctx: Ctx, ui: UiState ): void => {
		const wanted = String( ( ctx.state as { tab?: unknown } ).tab ?? '' ) || 'posts';
		if ( wanted === ui.serverTab ) {
			return;
		}
		ui.serverTab = wanted;
		if ( wanted === ui.tab ) {
			return;
		}
		const strip = ctx.root.querySelector< HTMLElement & { value: string } >(
			'os-tabs',
		);
		if ( strip ) {
			strip.value = wanted;
		}
		activateTab( ctx, ui, wanted );
	};

	const listPanel = ( ctx: Ctx, ui: UiState, mode: PostsMode, phone: boolean ): TemplateResult => {
		const displayCtx = ui.feed.reconcile( ctx );
		const { state, data } = displayCtx;
		const list = data?.list;
		const isPages = mode === 'pages';
		const env = cellEnv( ctx, ui, cells );
		refreshParentTitleRoster( env, list?.items ?? [] );
		const addNew = (): void => showEditorTab( ctx, ui, mode );

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
				activateTab( ctx, ui, value );
			};
			return html`<div class=${ rootClass } data-os-posts-root data-desk-options=${ String( ui.desk.filters ) }><style>${ deskStyles.cssText }${ paperStyles.cssText }</style>
				<os-tabs value=${ ui.tab } class="os-app-list__tabs" @os-tab-change=${ onTab }>
					${ menuTabs( ctx ).map(
						( tab ) => html`<os-tab value=${ tab.id }>${ tab.label }</os-tab>`,
					) }
				</os-tabs>
				<os-tabpanel for="posts" class="os-app-list__panel">${ panel }</os-tabpanel>
				<os-tabpanel for="new" class="os-app-list__panel">
					<div data-os-posts-editor class="os-posts__embed-host" os-preserve></div>
				</os-tabpanel>
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

			const busy = new MutationObserver( () => {
				tableOf( ctx )?.toggleAttribute( 'loading', ctx.root.getAttribute( 'aria-busy' ) === 'true' );
			} );
			busy.observe( ctx.root, { attributes: true, attributeFilter: [ 'aria-busy' ] } );
			teardowns.push( () => busy.disconnect() );

			void clientOf( ctx, ui ).fetchAuthorOptions().then( ( authors ) => {
				ui.filterData.authors = authors;
				ctx.repaint();
			} );
			ui.filterData.loadMoreTags = () => void fetchNextTagPage( ctx, ui );
			void fetchNextTagPage( ctx, ui );

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

			const onModeChange = (): void => ctx.repaint();
			document.addEventListener( 'os-mode-changed', onModeChange );
			teardowns.push( () => document.removeEventListener( 'os-mode-changed', onModeChange ) );

			teardowns.push( guardEmbeddedEditor( ctx, ui ) );

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
				ui.editor?.();
				ui.editor = null;
				ui.canvases.categories?.();
				ui.canvases.tags?.();
				ui.canvases = { categories: null, tags: null };
				clearCategoryTreeCache( env );
			};
		},

		updated: ( ctx ) => {
			syncDeskControls( ctx.root );
			adoptServerTab( ctx, ctx.ui( freshUi ) );
			const table = tableOf( ctx );
			if ( ! table ) {
				return;
			}

			if ( ctx.loading ) {
				table.setAttribute( 'loading', '' );
			}
			const ui = ctx.ui( freshUi );
			ui.stats?.sync();
			ui.feed.observe( ctx.root );
			const { state, data } = ctx;
			const env = cellEnv( ctx, ui, cells );

			const columnsKey = `${ Array.from( hiddenOf( ui, hiddenColumnsKey ) ).sort().join( ',' ) }|${ filterSig( ui.filterData ) }`;
			if ( columnsKey !== ui.columnsKey ) {
				ui.columnsKey = columnsKey;
				ui.cellCache.clear();
				ui.table.invalidateColumns();
			}
			const items = ui.feed.items;
			const result = ui.table.sync( {

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

				ui.cellCache.clear();
				refreshParentTitleRoster( env, items );
				if ( data ) {
					fireDataLoaded( data );
				}
			}
		},
	} );
}
