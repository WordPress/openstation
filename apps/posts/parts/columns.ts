/**
 * Posts app — the column descriptors, the toolbar registries and the
 * hook-bus surface plugin authors extend.
 *
 * Filters (`wp.hooks`):
 *   - `openstation.postsWindow.columns` — the column descriptors.
 *   - `openstation.postsWindow.statusSegments` — the status pills.
 *   - `openstation.postsWindow.bulkActions` — the bulk-bar buttons.
 *   - `openstation.postsWindow.toolbarTrailing` — extra toolbar nodes.
 *
 * @public
 */

import { __, _n, sprintf } from '@openstation/app';
import '../../../src/ui/components/os-table/os-table';
import '../../../src/ui/components/os-multiselect/os-multiselect';
import type { OsTableColumn } from '../../../src/ui/components/os-table/os-table';
import { buildAuthorCell, buildDateCell, buildTitleCell } from './cells/basic';
import { memoCell, type CellCache, type CellEnv } from './cells/env';
import { buildCommentsCell, buildParentCell, buildSlugCell, buildTemplateCell } from './cells/pages';
import type {
	AuthorOption,
	BulkAction,
	PostListItem,
	PostsWindowContext,
	StatusSegment,
	TagOption,
} from './types';

const HOOK_FILTER_COLUMNS = 'openstation.postsWindow.columns';
const HOOK_FILTER_STATUS_SEGMENTS = 'openstation.postsWindow.statusSegments';
const HOOK_FILTER_BULK_ACTIONS = 'openstation.postsWindow.bulkActions';
const HOOK_FILTER_TOOLBAR_TRAILING = 'openstation.postsWindow.toolbarTrailing';
export const HOOK_ACTION_OPENED = 'openstation.postsWindow.opened';
export const HOOK_ACTION_DATA_LOADED = 'openstation.postsWindow.dataLoaded';

const LOG = '[openstation:desktop-mode-posts]';

/**
 * Title is the always-visible sticky column — toggling it would leave
 * users with no row identity. Every other key is togglable.
 */
export const REQUIRED_COLUMN_KEYS = new Set< string >( [ 'title' ] );

/**
 * The columns a phone shows: a card per row (`<os-table stacked>`)
 * has room for the title, the author, a page's parent and the date.
 */
const MOBILE_COLUMN_KEYS = new Set< string >( [ 'title', 'author', 'parent', 'date' ] );

/** The REST `orderby` values a column click may send; anything else is the default. */
export const ALLOWED_ORDERBY = [ 'date', 'title', 'author', 'modified', 'comment_count', 'menu_order' ] as const;

/** The user's hidden-column preference, from the OS Settings API. */
export function getHiddenColumns(): Set< string > {
	try {
		const api = window.wp?.os;
		if ( api && typeof api.getOsSettings === 'function' ) {
			const snap = api.getOsSettings() as { nativePostsHiddenColumns?: string[] };
			if ( Array.isArray( snap.nativePostsHiddenColumns ) ) {
				return new Set( snap.nativePostsHiddenColumns );
			}
		}
	} catch {
		// fall through
	}
	return new Set();
}

/**
 * Pre-fetched filter-dropdown options, threaded into the Author and
 * Tags columns' filter row so the dropdown lists the server's
 * authoritative options rather than what landed on the current page.
 */
export interface ColumnFilterData {
	authors: AuthorOption[];
	tags: TagOption[];
	/** True while the tag list has unfetched pages remaining. */
	tagsHasMore?: boolean;
	/** Trigger the next tag page fetch — wired by the app. */
	loadMoreTags?: () => void;
}

const EMPTY_FILTER_DATA: ColumnFilterData = { authors: [], tags: [] };

interface FilterTagOption {
	id: number;
	name: string;
}

/**
 * Mount or refresh a `<os-multiselect>` inside a column's filter
 * cell. Idempotent — the first call mounts and binds, later calls
 * reconcile options + value.
 */
export function renderMultiSelectFilter(
	host: HTMLTableCellElement,
	ctx: { value: string; setValue: ( next: string ) => void },
	all: FilterTagOption[],
	opts: { label: string; ariaLabel: string; dataKey?: string; hasMore?: boolean; onLoadMore?: () => void },
): void {
	type MultiselectEl = HTMLElement & {
		items: ReadonlyArray< { value: string; label: string } >;
		values: string[];
		hasMore: boolean;
		loadingMore: boolean;
	};
	const HOST_KEY = 'osPostsFilterMounted';
	type HostWithState = HTMLTableCellElement & { [ HOST_KEY ]?: { picker: MultiselectEl; listSig: string } };
	const tagged = host as HostWithState;

	const optionsForPicker = all.map( ( o ) => ( { value: String( o.id ), label: o.name } ) );
	const nextSig = optionsForPicker.map( ( o ) => `${ o.value }:${ o.label }` ).join( '|' );

	if ( tagged[ HOST_KEY ] ) {
		const state = tagged[ HOST_KEY ];
		if ( state.listSig !== nextSig ) {
			state.picker.items = optionsForPicker;
			state.listSig = nextSig;
		}
		if ( state.picker.getAttribute( 'value' ) !== ctx.value ) {
			state.picker.setAttribute( 'value', ctx.value );
		}
		state.picker.hasMore = !! opts.hasMore;
		return;
	}

	const picker = document.createElement( 'os-multiselect' ) as MultiselectEl;
	picker.setAttribute( 'placeholder', opts.label );
	picker.setAttribute( 'aria-label', opts.ariaLabel );
	picker.setAttribute( 'data-noclick', '' );
	picker.setAttribute( 'value', ctx.value );
	if ( opts.dataKey ) {
		picker.setAttribute( 'data-key', opts.dataKey );
	}
	host.appendChild( picker );
	picker.items = optionsForPicker;
	picker.hasMore = !! opts.hasMore;

	picker.addEventListener( 'os-pick', ( e: Event ) => {
		const next = ( e as CustomEvent< { value: string } > ).detail?.value ?? '';
		ctx.value = next;
		ctx.setValue( next );
	} );
	if ( opts.onLoadMore ) {
		const onLoadMore = opts.onLoadMore;
		picker.addEventListener( 'os-multiselect-load-more', () => {
			picker.loadingMore = true;
			onLoadMore();
		} );
	}
	tagged[ HOST_KEY ] = { picker, listSig: nextSig };
}

function buildBaseColumns( env: CellEnv, cache: CellCache, filterData: ColumnFilterData ): OsTableColumn< PostListItem >[] {
	const titleCol: OsTableColumn< PostListItem > = {
		key: 'title',
		label: __( 'Title' ),
		sortable: true,
		sticky: true,
		render: ( _v, row ) => memoCell( cache, row.id, 'title', () => buildTitleCell( row, env ) ),
	};
	const authorCol: OsTableColumn< PostListItem > = {
		key: 'author',
		label: __( 'Author' ),
		sortable: true,
		width: '180px',
		filterRender: ( host, ctx ) =>
			renderMultiSelectFilter( host, ctx, filterData.authors, {
				label: __( 'All authors' ),
				ariaLabel: __( 'Filter by author' ),
			} ),
		render: ( _v, row ) => memoCell( cache, row.id, 'author', () => buildAuthorCell( row ) ),
	};
	const dateCol: OsTableColumn< PostListItem > = {
		key: 'date',
		label: __( 'Date' ),
		sortable: true,
		width: '170px',
		sortValue: ( row ) => Date.parse( row.date_gmt + 'Z' ) || 0,
		render: ( _v, row ) => memoCell( cache, row.id, 'date', () => buildDateCell( row ) ),
	};

	if ( env.extra.mode === 'pages' ) {
		return [
			titleCol,
			authorCol,
			{
				key: 'parent',
				label: __( 'Parent' ),
				width: '200px',
				render: ( _v, row ) => memoCell( cache, row.id, 'parent', () => buildParentCell( row, env ) ),
			},
			{
				key: 'template',
				label: __( 'Template' ),
				width: '180px',
				render: ( _v, row ) => memoCell( cache, row.id, 'template', () => buildTemplateCell( row, env ) ),
			},
			{
				key: 'slug',
				label: __( 'Slug' ),
				width: '200px',
				render: ( _v, row ) => memoCell( cache, row.id, 'slug', () => buildSlugCell( row, env ) ),
			},
			{
				key: 'comments',
				label: __( 'Comments' ),
				width: '110px',
				sortValue: ( row ) => ( typeof row.openstation_comment_count === 'number' ? row.openstation_comment_count : 0 ),
				render: ( _v, row ) => memoCell( cache, row.id, 'comments', () => buildCommentsCell( row ) ),
			},
			dateCol,
		];
	}

	// The taxonomy cells arrive with the Posts entry; a build without
	// them (the Pages bundle) never asks for this branch.
	const cols: OsTableColumn< PostListItem >[] = [ titleCol, authorCol ];
	const { categories, tags } = env.cells;
	if ( categories ) {
		cols.push( {
			key: 'categories',
			label: __( 'Categories' ),
			width: '260px',
			render: ( _v, row ) => memoCell( cache, row.id, 'categories', () => categories( row, env ) ),
		} );
	}
	if ( tags ) {
		cols.push( {
			key: 'tags',
			label: __( 'Tags' ),
			// Flexes with the space; the minimum holds ~4 chips on a line.
			minWidth: '360px',
			filterRender: ( host, ctx ) =>
				renderMultiSelectFilter(
					host,
					ctx,
					filterData.tags.map( ( t ) => ( { id: t.id, name: t.name } ) ),
					{
						label: __( 'All tags' ),
						ariaLabel: __( 'Filter by tag' ),
						dataKey: 'tags',
						hasMore: !! filterData.tagsHasMore,
						onLoadMore: filterData.loadMoreTags,
					},
				),
			render: ( _v, row ) => memoCell( cache, row.id, 'tags', () => tags( row, env ) ),
		} );
	}
	cols.push( dateCol );
	return cols;
}

/**
 * Every column (visible AND hidden), through the columns filter —
 * what the "Show columns" menu lists.
 */
export function buildAllColumns(
	env: CellEnv,
	cache: CellCache,
	filterData: ColumnFilterData = EMPTY_FILTER_DATA,
): OsTableColumn< PostListItem >[] {
	const cols = buildBaseColumns( env, cache, filterData );
	const hooks = window.wp?.hooks;
	return hooks && typeof hooks.applyFilters === 'function'
		? ( hooks.applyFilters( HOOK_FILTER_COLUMNS, cols ) as OsTableColumn< PostListItem >[] )
		: cols;
}

/** The togglable columns' keys and labels — what the ⋯ menu needs, nothing more. */
export function columnLabels( env: CellEnv ): Array< { key: string; label: string } > {
	return buildAllColumns( env, new Map() )
		.filter( ( c ) => ! REQUIRED_COLUMN_KEYS.has( c.key ) )
		.map( ( c ) => ( { key: c.key, label: c.label || c.key } ) );
}

/**
 * The columns the table paints: the filtered list minus the user's
 * hidden set (title stays), narrowed to the phone set on a phone —
 * applied last, so nothing is hidden on a desk by a phone's rule.
 */
export function buildColumns(
	env: CellEnv,
	cache: CellCache,
	filterData: ColumnFilterData = EMPTY_FILTER_DATA,
	phone = false,
	hidden: ReadonlySet< string > = getHiddenColumns(),
): OsTableColumn< PostListItem >[] {
	const all = buildAllColumns( env, cache, filterData );
	const visible =
		hidden.size === 0 ? all : all.filter( ( col ) => REQUIRED_COLUMN_KEYS.has( col.key ) || ! hidden.has( col.key ) );
	return phone ? visible.filter( ( col ) => MOBILE_COLUMN_KEYS.has( col.key ) ) : visible;
}

export function defaultStatusSegments(): StatusSegment[] {
	return [
		{ value: '', label: __( 'All' ) },
		{ value: 'publish', label: __( 'Published' ) },
		{ value: 'draft', label: __( 'Drafts' ) },
		{ value: 'pending', label: __( 'Pending' ) },
		{ value: 'future', label: __( 'Scheduled' ) },
		{ value: 'trash', label: __( 'Trash' ) },
	];
}

export function resolveStatusSegments(): StatusSegment[] {
	const hooks = window.wp?.hooks;
	const defaults = defaultStatusSegments();
	if ( ! hooks || typeof hooks.applyFilters !== 'function' ) {
		return defaults;
	}
	try {
		const out = hooks.applyFilters( HOOK_FILTER_STATUS_SEGMENTS, defaults );
		return Array.isArray( out ) && out.length > 0 ? ( out as StatusSegment[] ) : defaults;
	} catch ( err ) {
		// eslint-disable-next-line no-console
		console.error( `${ LOG } status-segments filter threw; falling back to defaults:`, err );
		return defaults;
	}
}

/**
 * The shipped bulk action: "Move to trash". `trash` runs the app's
 * server action over the ids not already in the trash (a second
 * delete would remove them for good) and returns `false` — the
 * action's own dispatch already refreshed the list.
 */
export function defaultBulkActions(
	mode: 'posts' | 'pages',
	trash: ( ids: number[] ) => Promise< boolean >,
): BulkAction[] {
	return [
		{
			id: 'trash',
			label: __( 'Move to trash' ),
			icon: 'dashicons-trash',
			variant: 'danger',
			confirm: ( count: number ) =>
				mode === 'pages'
					? sprintf(
						/* translators: %d: row count. */
						_n( 'Move %d page to the trash?', 'Move %d pages to the trash?', count ),
						count,
					)
					: sprintf(
						/* translators: %d: row count. */
						_n( 'Move %d post to the trash?', 'Move %d posts to the trash?', count ),
						count,
					),
			run: async ( ids, ctx ): Promise< false > => {
				const data = ctx.table.data ?? [];
				const trashable = ids.filter( ( id ) => {
					const row = data.find( ( r ) => r.id === id );
					return row && row.status !== 'trash';
				} );
				if ( trashable.length > 0 ) {
					await trash( trashable );
				}
				ctx.table.clearSelection();
				return false;
			},
		},
	];
}

export function resolveBulkActions( defaults: BulkAction[] ): BulkAction[] {
	const hooks = window.wp?.hooks;
	if ( ! hooks || typeof hooks.applyFilters !== 'function' ) {
		return defaults;
	}
	try {
		const out = hooks.applyFilters( HOOK_FILTER_BULK_ACTIONS, defaults );
		return Array.isArray( out ) ? ( out as BulkAction[] ) : defaults;
	} catch ( err ) {
		// eslint-disable-next-line no-console
		console.error( `${ LOG } bulk-actions filter threw; falling back to defaults:`, err );
		return defaults;
	}
}

export function resolveToolbarTrailing( ctx: PostsWindowContext ): HTMLElement[] {
	const hooks = window.wp?.hooks;
	if ( ! hooks || typeof hooks.applyFilters !== 'function' ) {
		return [];
	}
	try {
		const out = hooks.applyFilters( HOOK_FILTER_TOOLBAR_TRAILING, [], ctx );
		return Array.isArray( out ) ? out.filter( ( el ): el is HTMLElement => el instanceof HTMLElement ) : [];
	} catch ( err ) {
		// eslint-disable-next-line no-console
		console.error( `${ LOG } toolbar-trailing filter threw; ignoring:`, err );
		return [];
	}
}

/**
 * Map a column key to the REST `orderby` value. Unknown keys (plugin
 * columns) fall back to the declared default — core's collections
 * cannot sort by them anyway.
 */
export function mapColumnToOrderby( key: string, fallback = 'date' ): string {
	switch ( key ) {
		case 'title':
		case 'author':
		case 'date':
		case 'modified':
			return key;
		case 'comments':
			return 'comment_count';
		default:
			return fallback;
	}
}

/** The column whose header shows the sort arrow for a REST `orderby`. */
export function mapOrderbyToColumn( orderby: string ): string {
	return orderby === 'comment_count' ? 'comments' : orderby;
}
