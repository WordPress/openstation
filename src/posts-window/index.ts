/**
 * Native Posts window — render entry point.
 *
 * Lazy-loaded by the native-window sync the first time the
 * `desktop-mode-posts` window opens. Wires up the toolbar (status
 * segments, search, refresh, "Add New", bulk-trash bar), populates a
 * `<wpd-table>` from `wp/v2/posts` with server-side pagination /
 * sorting / filtering, mounts an excerpt + featured-image sub-row,
 * and exposes prev/next + per-page controls in the footer.
 *
 * Web-component registrations: the main `desktop.min.js` bundle ships
 * only the `<wpd-*>` tags it actually constructs itself. Anything
 * unique to this window — `<wpd-table>`, `<wpd-tag-input>`,
 * `<wpd-category-picker>`, `<wpd-avatar>`, `<wpd-multiselect>`,
 * `<wpd-relative-time>`, `<wpd-form>`, `<wpd-textarea>` — registers
 * itself here via leaf side-effect imports. `defineComponent()` is
 * idempotent so the imports cost nothing in cases where main also
 * ships a tag.
 *
 * @public
 * @since 0.8.0
 */

import { __, sprintf } from '../i18n';
import { trackedFetch } from '../tracked-fetch';
import { applyAvatarSrc } from '../ui/util/avatar-resolve';
import { showPostsIntroDialog } from './intro-dialog';
import { decodeHTML } from '../utils';
// Side-effect imports — register the `<wpd-*>` components this
// bundle constructs that the main shell does not ship. See the
// header docblock for the rationale.
import '../ui/components/wpd-table/wpd-table';
// `<wpd-tabs>` (with `<wpd-tab>` children + `<wpd-tabpanel>` siblings)
// is emitted by `includes/posts-window/window.php`, never built via
// `document.createElement` here — so the lint rule that scans
// `createElement('wpd-*')` doesn't see it. Register the compound
// class set explicitly so the server-rendered tabs work.
import '../ui/components/wpd-tabs/wpd-tabs';
import '../ui/components/wpd-tag-input/wpd-tag-input';
import '../ui/components/wpd-category-picker/wpd-category-picker';
import '../ui/components/wpd-avatar/wpd-avatar';
import '../ui/components/wpd-multiselect/wpd-multiselect';
import '../ui/components/wpd-relative-time/wpd-relative-time';
import '../ui/components/wpd-form/wpd-form';
import '../ui/components/wpd-textarea/wpd-textarea';
// Posts-specific custom element — adds <wpd-user-profile>.
import './wpd-user-profile';
import {
	createPostsWindowClient,
	type AuthorOption,
	type CategoryTerm,
	type PostListItem,
	type PostsListParams,
	type PostsWindowClient,
	type PostsWindowConfig,
	type TagOption,
	type TagTerm,
} from './rest';
import { createUsersWindowClient } from './users-rest';
import type {
	BulkAction,
	PostsWindowContext,
	StatusSegment,
} from './types';
import type {
	WpdTagInput,
	WpdTagItem,
} from '../ui/components/wpd-tag-input/wpd-tag-input';
import type {
	WpdCategoryItem,
	WpdCategoryPicker,
} from '../ui/components/wpd-category-picker/wpd-category-picker';

import type {
	WpdTable,
	WpdTableColumn,
} from '../ui/components/wpd-table/wpd-table';
import '../ui/components/wpd-button/wpd-button';
import '../ui/components/wpd-segmented/wpd-segmented';
import '../ui/components/wpd-menu/wpd-menu';

export type { BulkAction, PostsWindowContext, StatusSegment } from './types';

// Match the recycle-bin module's declaration shape exactly so the
// global `Window.desktopModeNativeWindows` augmentation merges
// instead of clashing — TS errors when two augmentations declare
// the same field with structurally different types. Returning a
// teardown is still wired internally via `desktop-mode-window-closed`.
type RenderCallback = ( body: HTMLElement ) => void;

declare global {
	interface Window {
		desktopModeNativeWindows?: Record< string, RenderCallback | undefined >;
	}
}

/**
 * Bridge to `wp.desktop.confirm` (the main bundle's
 * `<wpd-confirm-dialog>` wrapper). The posts-window script lists
 * `desktop-mode` as a dependency so the global is always set by
 * the time this code runs.
 */
interface ConfirmOptions {
	title?: string;
	message: string;
	confirmLabel?: string;
	cancelLabel?: string;
	danger?: boolean;
}
function wpdConfirmGlobal( options: ConfirmOptions ): Promise< boolean > {
	const fn = ( window.wp as { desktop?: { confirm?: ( o: ConfirmOptions ) => Promise< boolean > } } | undefined )
		?.desktop?.confirm;
	if ( typeof fn !== 'function' ) {
		return Promise.reject(
			new Error(
				'[desktop-mode] wp.desktop.confirm is missing — the main desktop bundle must load before the posts-window script.',
			),
		);
	}
	return fn( options );
}

/**
 * Posts-window first-open intro. Mirrors the seen-intros surface in
 * `includes/seen-intros.php`: gated on `config.introSeen`, marks
 * itself seen on dismiss via `POST config.introUrl`. Runs once per
 * user — OS Settings → Features exposes a "Reset what's-new dialogs"
 * button that wipes the list so it appears again from scratch.
 *
 * Posts is the first ported native app, so the copy explicitly
 * points at the OS Settings escape hatch. Future ported apps drop
 * that line.
 */
/**
 * Per-window-mode intro tracker — `'posts'` and `'pages'` each gate
 * independently so opening one window doesn't suppress the other's
 * first-open dialog.
 */
const _introShown: Record< string, boolean > = Object.create( null );

// "Reset what's-new dialogs" in OS Settings dispatches this event
// after the DELETE round-trip completes — clear the per-mode cache
// so the next window-open re-fires the dialog without a page reload.
document.addEventListener( 'desktop-mode-intros-reset', () => {
	for ( const slug of Object.keys( _introShown ) ) {
		_introShown[ slug ] = false;
	}
} );

function maybeShowIntro( client: PostsWindowClient ): void {
	let cfg: PostsWindowConfig;
	try {
		cfg = client.getConfig();
	} catch {
		return;
	}
	const slug = cfg.introSlug || cfg.mode || 'posts';
	if ( _introShown[ slug ] ) {
		return;
	}
	if ( cfg.introSeen ) {
		return;
	}
	_introShown[ slug ] = true;

	const dialogPromise =
		slug === 'pages'
			? import( './pages-intro-dialog' ).then( ( m ) =>
				m.showPagesIntroDialog(),
			)
			: showPostsIntroDialog();

	void dialogPromise
		.then( ( result ) => {
			// Escape / backdrop click resolve `'cancel'` and explicitly
			// MUST NOT mark the intro seen — that's the testing escape
			// hatch so we can iterate on the dialog without resetting
			// OS Settings between runs.
			if ( result === 'cancel' ) {
				_introShown[ slug ] = false;
				return;
			}
			void markIntroSeen( cfg, slug, client );
			if ( result === 'settings' ) {
				openOsSettingsFeatures();
			}
		} )
		.catch( () => {
			// Dialog mount failed; keep gating off so a re-open can retry.
			_introShown[ slug ] = false;
		} );
}

async function markIntroSeen(
	cfg: PostsWindowConfig,
	slug: string,
	client: PostsWindowClient,
): Promise< void > {
	if ( ! cfg.introUrl ) {
		return;
	}
	try {
		await trackedFetch(
			cfg.introUrl,
			{
				method: 'POST',
				credentials: 'same-origin',
				headers: {
					'Content-Type': 'application/json',
					'X-WP-Nonce': cfg.restNonce,
				},
				body: JSON.stringify( { slug } ),
			},
			{
				windowId: client.windowId,
				source: `${ slug }-window/intro`,
			},
		);
		// Mirror the server change locally so a re-open inside the
		// same shell session doesn't re-fire the dialog.
		( cfg as { introSeen: boolean } ).introSeen = true;
	} catch {
		// Swallow — the worst case is showing the intro one more time.
	}
}

function openOsSettingsFeatures(): void {
	const api = ( window.wp as { desktop?: { openOsSettings?: () => void } } | undefined )?.desktop;
	api?.openOsSettings?.();
}

const ROOT = '[data-desktop-mode-posts-root]';
const STATUS = '[data-desktop-mode-posts-status]';
const SEARCH = '[data-desktop-mode-posts-search]';
const REFRESH = '[data-desktop-mode-posts-refresh]';
const NEW_BTN = '[data-desktop-mode-posts-new]';
const TABLE = '[data-desktop-mode-posts-table]';
const BULK = '[data-desktop-mode-posts-bulk]';
const COUNT = '[data-desktop-mode-posts-count]';
const PAGE_INDICATOR = '[data-desktop-mode-posts-page-indicator]';
const PREV = '[data-desktop-mode-posts-prev]';
const NEXT = '[data-desktop-mode-posts-next]';
const PER_PAGE = '[data-desktop-mode-posts-per-page]';
const TOOLBAR_TRAILING_EXTRAS = '[data-desktop-mode-posts-toolbar-extras]';
const BULK_ACTIONS_HOST = '[data-desktop-mode-posts-bulk-actions]';

const HOOK_FILTER_COLUMNS = 'desktop_mode.postsWindow.columns';
const HOOK_FILTER_STATUS_SEGMENTS = 'desktop_mode.postsWindow.statusSegments';
const HOOK_FILTER_BULK_ACTIONS = 'desktop_mode.postsWindow.bulkActions';
const HOOK_FILTER_TOOLBAR_TRAILING = 'desktop_mode.postsWindow.toolbarTrailing';
const HOOK_ACTION_OPENED = 'desktop_mode.postsWindow.opened';
const HOOK_ACTION_DATA_LOADED = 'desktop_mode.postsWindow.dataLoaded';

const SEARCH_DEBOUNCE_MS = 250;

const STATUS_LABELS: Record< string, string > = {
	publish: __( 'Published' ),
	future: __( 'Scheduled' ),
	draft: __( 'Draft' ),
	pending: __( 'Pending' ),
	private: __( 'Private' ),
	trash: __( 'Trash' ),
};

interface ViewState {
	page: number;
	perPage: number;
	search: string;
	status: string;
	orderby: string;
	order: 'asc' | 'desc';
	/** Author user ids to filter by (empty = no filter). */
	author: number[];
	/** Tag term ids to filter by (empty = no filter). */
	tag: number[];
	searchDebounce: number | null;
}

function statusBadgeColor( status: string ): { bg: string; fg: string } {
	switch ( status ) {
		case 'publish':
			return { bg: '#e6f4ea', fg: '#1d6f42' };
		case 'draft':
			return { bg: '#fdecea', fg: '#a02622' };
		case 'pending':
			return { bg: '#fef7e0', fg: '#8a6d00' };
		case 'private':
			return { bg: '#e8f0fe', fg: '#1a52a8' };
		case 'future':
			return { bg: '#ede7f6', fg: '#5b3aa0' };
		case 'trash':
			return { bg: '#f1f1f2', fg: '#50575e' };
		default:
			return { bg: '#f1f1f2', fg: '#50575e' };
	}
}

function decodeTitle( raw: string ): string {
	return decodeHTML( raw );
}

function authorOf( row: PostListItem ): {
	id: number;
	name: string;
	avatar?: string;
} {
	const embedded = row._embedded?.author?.[ 0 ];
	if ( embedded ) {
		const avatars = embedded.avatar_urls ?? {};
		return {
			id: embedded.id,
			name: embedded.name,
			avatar: avatars[ '48' ] ?? avatars[ '96' ] ?? avatars[ '24' ],
		};
	}
	return { id: row.author, name: __( 'Unknown' ) };
}

/**
 * Returns the embedded term records for the given taxonomy — needed
 * to seed the Tags column's `<wpd-tag-input>` and the Categories
 * column's `<wpd-category-picker>` with id + name.
 */
function termRecordsOf(
	row: PostListItem,
	taxonomy: 'category' | 'post_tag',
): Array< { id: number; name: string } > {
	const groups = row._embedded?.[ 'wp:term' ] ?? [];
	for ( const group of groups ) {
		if ( group.length === 0 ) {
			continue;
		}
		if ( group[ 0 ].taxonomy === taxonomy ) {
			return group.map( ( t ) => ( { id: t.id, name: t.name } ) );
		}
	}
	return [];
}

function featuredMediaOf( row: PostListItem ): { url: string; alt: string } | null {
	const media = row._embedded?.[ 'wp:featuredmedia' ]?.[ 0 ];
	if ( ! media ) {
		return null;
	}
	const sizes = media.media_details?.sizes ?? {};
	const small =
		sizes.thumbnail?.source_url ??
		sizes.medium?.source_url ??
		media.source_url;
	return { url: small, alt: media.alt_text ?? '' };
}

/**
 * Per-(rowId, columnKey) cell-node cache.
 *
 * `<wpd-table>` repaints the body on every selection / expand /
 * sort-direction change — so without a cache, every cell `render`
 * callback rebuilds its DOM, and the new `<img>` avatars (term
 * chips, status badges, …) flash for a frame before the browser
 * swaps in the cached image. Returning the SAME node across
 * repaints keeps each pixel stable: the node is moved from the
 * previous position in the tbody into the new one, retaining its
 * decoded image, layout, and computed styles.
 *
 * Lifetime: cleared on every `refresh()` (genuine data change) and
 * on window close. Safe across:
 *   - selection toggles (no data change)
 *   - sub-row expand/collapse (no data change)
 *   - sort flips that resolve to the same `orderby` column (we'd
 *     refresh and clear in that case anyway via the sort handler)
 */
type CellCache = Map< string, HTMLElement >;

function cacheKey( rowId: number, columnKey: string ): string {
	return `${ rowId }|${ columnKey }`;
}

function memoCell(
	cache: CellCache,
	rowId: number,
	columnKey: string,
	build: () => HTMLElement,
): HTMLElement {
	const key = cacheKey( rowId, columnKey );
	const cached = cache.get( key );
	if ( cached ) {
		return cached;
	}
	const built = build();
	cache.set( key, built );
	return built;
}

/**
 * Title is the always-visible sticky column — toggling it would leave
 * users with no row identity. Every other column key is togglable, both
 * built-ins (`author`, `categories`, `tags`, `date`) and any plugin-
 * added columns picked up by the `desktop_mode.postsWindow.columns`
 * filter.
 */
const REQUIRED_COLUMN_KEYS = new Set< string >( [ 'title' ] );

/**
 * Read the user's hidden-column preference from the OS Settings public
 * API. Falls back to an empty list when the API isn't ready yet
 * (defensive: `renderPostsWindow` runs after `wp.desktop` is populated,
 * but the bundle may load before in degraded boot paths).
 */
function getHiddenColumns(): Set< string > {
	try {
		const api = window.wp?.desktop;
		if ( api && typeof api.getOsSettings === 'function' ) {
			const snap = api.getOsSettings() as {
				nativePostsHiddenColumns?: string[];
			};
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
 * Pre-fetched filter-dropdown options. Threaded through the column
 * builders so the Author and Tags columns' filter row gets a server-
 * authoritative option list instead of the few values that happen to
 * land on the current page.
 */
interface ColumnFilterData {
	authors: AuthorOption[];
	tags: TagOption[];
	/** True while the tag list has unfetched pages remaining. */
	tagsHasMore?: boolean;
	/** Trigger the next tag page fetch — wired by `renderPostsWindow`. */
	loadMoreTags?: () => void;
}

const EMPTY_FILTER_DATA: ColumnFilterData = { authors: [], tags: [] };

/**
 * Build the full, unfiltered column descriptor list — passes through
 * the `desktop_mode.postsWindow.columns` filter but does NOT apply
 * the user's hidden-columns preference. Used by the kebab "Show
 * columns" menu so every column (visible AND hidden) shows up as a
 * toggle.
 */
function buildAllColumns(
	cache: CellCache,
	client: PostsWindowClient,
	filterData: ColumnFilterData = EMPTY_FILTER_DATA,
): WpdTableColumn< PostListItem >[] {
	const cols = _buildBaseColumns( cache, filterData, client );
	const hooks = window.wp?.hooks;
	return hooks && typeof hooks.applyFilters === 'function'
		? ( hooks.applyFilters(
			HOOK_FILTER_COLUMNS,
			cols,
		) as WpdTableColumn< PostListItem >[] )
		: cols;
}

/**
 * Build the column descriptors. Filterable through the `wp.hooks` bus
 * — plugins can append/replace columns on
 * `desktop_mode.postsWindow.columns`. Applies the user's hidden-column
 * preference so the table only paints the columns they want to see.
 */
function buildColumns(
	cache: CellCache,
	client: PostsWindowClient,
	filterData: ColumnFilterData = EMPTY_FILTER_DATA,
): WpdTableColumn< PostListItem >[] {
	const all = buildAllColumns( cache, client, filterData );
	const hidden = getHiddenColumns();
	if ( hidden.size === 0 ) {
		return all;
	}
	// Filter out user-hidden columns. The sticky `title` column is
	// pinned visible regardless of the user's preference — without
	// it the table has no row identity.
	return all.filter(
		( col ) => REQUIRED_COLUMN_KEYS.has( col.key ) || ! hidden.has( col.key ),
	);
}

function _buildBaseColumns(
	cache: CellCache,
	filterData: ColumnFilterData,
	client: PostsWindowClient,
): WpdTableColumn< PostListItem >[] {
	// `mode` lets us swap the taxonomy columns out for hierarchical
	// pages without the column hook bus knowing the difference.
	// Plugins that filter `desktop_mode.postsWindow.columns` see the
	// already-mode-appropriate base list and append/replace from there.
	let mode: 'posts' | 'pages' = 'posts';
	try {
		const cfg = client.getConfig();
		if ( cfg.mode === 'pages' ) {
			mode = 'pages';
		}
	} catch {
		// Pre-render code paths (the kebab column-toggle menu mounts
		// from the table descriptor before render) might call this
		// before a config is available — fall back to posts mode.
	}

	const titleCol: WpdTableColumn< PostListItem > = {
		key: 'title',
		label: __( 'Title' ),
		sortable: true,
		sticky: true,
		render: ( _v, row ) =>
			memoCell( cache, row.id, 'title', () => buildTitleCell( row, client ) ),
	};
	const authorCol: WpdTableColumn< PostListItem > = {
		key: 'author',
		label: __( 'Author' ),
		sortable: true,
		width: '180px',
		filterRender: ( host, ctx ) =>
			renderMultiSelectFilter( host, ctx, filterData.authors, {
				label: __( 'All authors' ),
				ariaLabel: __( 'Filter by author' ),
			} ),
		render: ( _v, row ) =>
			memoCell( cache, row.id, 'author', () => buildAuthorCell( row ) ),
	};
	const dateCol: WpdTableColumn< PostListItem > = {
		key: 'date',
		label: __( 'Date' ),
		sortable: true,
		width: '170px',
		sortValue: ( row ) => Date.parse( row.date_gmt + 'Z' ) || 0,
		render: ( _v, row ) =>
			memoCell( cache, row.id, 'date', () => buildDateCell( row ) ),
	};

	if ( mode === 'pages' ) {
		const parentCol: WpdTableColumn< PostListItem > = {
			key: 'parent',
			label: __( 'Parent' ),
			width: '200px',
			render: ( _v, row ) =>
				memoCell( cache, row.id, 'parent', () => buildParentCell( row ) ),
		};
		const templateCol: WpdTableColumn< PostListItem > = {
			key: 'template',
			label: __( 'Template' ),
			width: '180px',
			render: ( _v, row ) =>
				memoCell( cache, row.id, 'template', () => buildTemplateCell( row, client ) ),
		};
		const slugCol: WpdTableColumn< PostListItem > = {
			key: 'slug',
			label: __( 'Slug' ),
			width: '200px',
			render: ( _v, row ) =>
				memoCell( cache, row.id, 'slug', () => buildSlugCell( row ) ),
		};
		const commentsCol: WpdTableColumn< PostListItem > = {
			key: 'comments',
			label: __( 'Comments' ),
			width: '110px',
			sortValue: ( row ) =>
				typeof row.desktop_mode_comment_count === 'number'
					? row.desktop_mode_comment_count
					: 0,
			render: ( _v, row ) =>
				memoCell( cache, row.id, 'comments', () =>
					buildCommentsCell( row ),
				),
		};
		return [
			titleCol,
			authorCol,
			parentCol,
			templateCol,
			slugCol,
			commentsCol,
			dateCol,
		];
	}

	return [
		titleCol,
		authorCol,
		{
			key: 'categories',
			label: __( 'Categories' ),
			width: '260px',
			render: ( _v, row ) =>
				memoCell( cache, row.id, 'categories', () =>
					buildCategoriesCell( row, client ),
				),
		},
		{
			key: 'tags',
			// Drop the fixed width so the column flexes with the
			// available space; pin a minimum that comfortably holds
			// ~4 chips on one line so the cell doesn't collapse the
			// tags into a vertical stack on narrow tables.
			label: __( 'Tags' ),
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
			render: ( _v, row ) =>
				memoCell( cache, row.id, 'tags', () => buildTagsCell( row, client ) ),
		},
		dateCol,
	];
}

/**
 * Cache of in-page parent titles, populated from the current page's
 * row roster on every refresh. Pages outside this page (cross-page
 * parents) display their numeric id with a small "Parent #42" label
 * — acceptable for v1; a small batched-include fetch can lift this
 * to full-title resolution later.
 *
 * @since 0.8.1
 */
const _parentTitleByPageRoster: Map< number, string > = new Map();

/**
 * Build the Parent cell for a Pages-window row. Top-level pages
 * (`parent === 0`) render an em-dash — like core's classic list.
 * Otherwise we render the parent's title (if known) or a fallback
 * numeric label.
 *
 * @since 0.8.1
 */
function buildParentCell( row: PostListItem ): HTMLElement {
	const cell = document.createElement( 'span' );
	cell.className = 'desktop-mode-posts__parent';
	const pid = typeof row.parent === 'number' ? row.parent : 0;
	if ( pid === 0 ) {
		cell.classList.add( 'desktop-mode-posts__parent--top' );
		cell.textContent = '—';
		cell.setAttribute( 'aria-label', __( 'Top-level page' ) );
		return cell;
	}
	cell.classList.add( 'desktop-mode-posts__parent--child' );
	const titleFromRoster = _parentTitleByPageRoster.get( pid );
	if ( titleFromRoster ) {
		cell.textContent = `↳ ${ titleFromRoster }`;
	} else {
		// translators: %d is the numeric id of a parent page whose title isn't on the current page roster.
		cell.textContent = sprintf( __( '↳ #%d' ), pid );
	}
	return cell;
}

/**
 * Refresh the in-page parent-title roster from the current page's
 * row list. Called by the render flow after every fetch — the
 * `<wpd-table>` repaints cells from cache, and the parent cell's
 * `textContent` reflects the freshly-known titles on the next
 * memoized rebuild (cell cache is wiped per refresh).
 *
 * @since 0.8.1
 */
function refreshParentTitleRoster( rows: PostListItem[] ): void {
	_parentTitleByPageRoster.clear();
	for ( const row of rows ) {
		_parentTitleByPageRoster.set( row.id, decodeTitle( row.title.rendered ) );
	}
}

/**
 * Build the Template cell — surfaces the human label for the page's
 * registered template, or "Default template" for the empty slug.
 * Falls back to the raw slug when the active theme registers a
 * template the config blob doesn't carry a label for, so users see
 * SOMETHING rather than a blank cell.
 *
 * @since 0.8.1
 */
function buildTemplateCell( row: PostListItem, client: PostsWindowClient ): HTMLElement {
	const cell = document.createElement( 'span' );
	cell.className = 'desktop-mode-posts__template';
	const slug = typeof row.template === 'string' ? row.template : '';
	let label = slug;
	try {
		const cfg = client.getConfig();
		const map = cfg.pageTemplates ?? {};
		label = map[ slug ] ?? ( slug === '' ? __( 'Default template' ) : slug );
	} catch {
		label = slug === '' ? __( 'Default template' ) : slug;
	}
	cell.textContent = label;
	if ( slug !== '' ) {
		cell.title = slug;
	}
	return cell;
}

/**
 * Build the Slug cell — renders the URL slug with a click-to-copy
 * affordance. Common pain in the classic Pages list when configuring
 * redirects or sharing canonical URLs; one click puts the slug on
 * the clipboard.
 *
 * @since 0.8.1
 */
function buildSlugCell( row: PostListItem ): HTMLElement {
	const cell = document.createElement( 'button' );
	cell.type = 'button';
	cell.className = 'desktop-mode-posts__slug';
	const slug = typeof row.slug === 'string' ? row.slug : '';
	cell.textContent = slug || '—';
	cell.disabled = slug === '';
	cell.title = slug ? __( 'Click to copy slug' ) : '';
	Object.assign( cell.style, {
		appearance: 'none',
		background: 'transparent',
		border: 'none',
		padding: '2px 6px',
		font: 'inherit',
		color: 'inherit',
		cursor: slug ? 'copy' : 'default',
		textAlign: 'left',
		fontFamily:
			'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
		fontSize: '12px',
		borderRadius: '4px',
		maxWidth: '100%',
		overflow: 'hidden',
		textOverflow: 'ellipsis',
		whiteSpace: 'nowrap',
	} as Partial< CSSStyleDeclaration > );
	cell.addEventListener( 'click', ( e ) => {
		e.stopPropagation();
		if ( ! slug ) {
			return;
		}
		void navigator.clipboard
			?.writeText( slug )
			.then( () => {
				cell.textContent = __( 'Copied!' );
				cell.style.color = 'var(--wp-admin-theme-color, #2271b1)';
				setTimeout( () => {
					cell.textContent = slug;
					cell.style.color = '';
				}, 1200 );
			} )
			.catch( () => {
				/* clipboard blocked; no-op */
			} );
	} );
	return cell;
}

/**
 * Build the Comments cell — surfaces `desktop_mode_comment_count`
 * from the REST field with a small icon. Top-asked parity feature
 * with the classic Pages list. Renders "—" when the field is
 * absent (e.g. a plugin-restricted query).
 *
 * @since 0.8.1
 */
function buildCommentsCell( row: PostListItem ): HTMLElement {
	const cell = document.createElement( 'span' );
	cell.className = 'desktop-mode-posts__comments';
	Object.assign( cell.style, {
		display: 'inline-flex',
		alignItems: 'center',
		gap: '6px',
		fontVariantNumeric: 'tabular-nums',
	} as Partial< CSSStyleDeclaration > );

	const count =
		typeof row.desktop_mode_comment_count === 'number'
			? row.desktop_mode_comment_count
			: null;

	if ( count === null ) {
		cell.textContent = '—';
		cell.style.color = 'var(--wp-admin-theme-fg-muted, #8c8f94)';
		return cell;
	}

	const icon = document.createElement( 'span' );
	icon.className = 'dashicons dashicons-admin-comments';
	icon.setAttribute( 'aria-hidden', 'true' );
	Object.assign( icon.style, {
		fontSize: '16px',
		width: '16px',
		height: '16px',
		color:
			count > 0
				? 'var(--wp-admin-theme-color, #2271b1)'
				: 'var(--wp-admin-theme-fg-muted, #8c8f94)',
	} as Partial< CSSStyleDeclaration > );

	const label = document.createElement( 'span' );
	label.textContent = String( count );
	if ( count === 0 ) {
		label.style.color = 'var(--wp-admin-theme-fg-muted, #8c8f94)';
	}

	cell.appendChild( icon );
	cell.appendChild( label );
	cell.setAttribute(
		'aria-label',
		// translators: %d is the comment count for a row.
		`${ sprintf( __( '%d comments' ), count ) }`,
	);
	return cell;
}

/**
 * One opaque option in the multi-select filter — `id` is the
 * server-side term/user id (lives in the filter value), `name` is
 * the visible label.
 */
interface FilterTagOption {
	id: number;
	name: string;
}

/**
 * Mount or refresh a `<wpd-multiselect>` inside a column's filter
 * cell. The component owns the trigger button + popover; we just
 * keep its `<wpd-option>` children + `value` in sync with the
 * fetched list and the column's current filter value.
 *
 * Idempotent — first call mounts the picker + binds the change
 * listener, subsequent calls reconcile options + value (e.g. after
 * fetched options arrive or the column re-paints).
 *
 * @param host            The `<th>` cell the column owns.
 * @param ctx             Filter context.
 * @param ctx.value       Current comma-joined ids.
 * @param ctx.setValue    Setter that re-emits `wpd-table-filter-change`.
 * @param all             Full option list (server-fetched at mount).
 * @param opts            Display + behaviour options.
 * @param opts.label      Placeholder shown when no option is selected.
 * @param opts.ariaLabel  Accessible label for the trigger.
 * @param opts.dataKey    Optional data-key attribute for DOM lookups.
 * @param opts.hasMore    Initial value for the multiselect's hasMore.
 * @param opts.onLoadMore Callback fired on `wpd-multiselect-load-more`.
 */
function renderMultiSelectFilter(
	host: HTMLTableCellElement,
	ctx: {
		value: string;
		setValue: ( next: string ) => void;
	},
	all: FilterTagOption[],
	opts: {
		label: string;
		ariaLabel: string;
		dataKey?: string;
		hasMore?: boolean;
		onLoadMore?: () => void;
	},
): void {
	type MultiselectEl = HTMLElement & {
		items: ReadonlyArray< { value: string; label: string } >;
		values: string[];
		hasMore: boolean;
		loadingMore: boolean;
		appendItems: (
			more: ReadonlyArray< { value: string; label: string } >,
		) => void;
	};
	const HOST_KEY = 'wpdPostsFilterMounted';
	type MountedState = {
		picker: MultiselectEl;
		listSig: string;
	};
	type HostWithState = HTMLTableCellElement & {
		[ HOST_KEY ]?: MountedState;
	};
	const tagged = host as HostWithState;

	const optionsForPicker = all.map( ( o ) => ( {
		value: String( o.id ),
		label: o.name,
	} ) );
	const nextSig = optionsForPicker
		.map( ( o ) => `${ o.value }:${ o.label }` )
		.join( '|' );

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

	const picker = document.createElement( 'wpd-multiselect' ) as MultiselectEl;
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

	picker.addEventListener( 'wpd-pick', ( e: Event ) => {
		const detail = ( e as CustomEvent< { value: string } > ).detail;
		const next = detail?.value ?? '';
		ctx.value = next;
		ctx.setValue( next );
	} );

	if ( opts.onLoadMore ) {
		const onLoadMore = opts.onLoadMore;
		picker.addEventListener( 'wpd-multiselect-load-more', () => {
			picker.loadingMore = true;
			onLoadMore();
		} );
	}

	tagged[ HOST_KEY ] = { picker, listSig: nextSig };
}

/**
 * Append a "Show columns" section (label + checkbox menu items per
 * togglable column) to the Posts window's title-bar ⋯ menu. The
 * window's kebab is built statically at construction time in
 * `src/window/dom.ts`; we extend it imperatively here so this feature
 * stays scoped to the Posts window without touching the framework.
 *
 * Returns a tiny handle so the caller can:
 *   - `refresh()` — re-paint the items' checked state when the OS
 *     Settings snapshot changes externally.
 *   - `dispose()` — remove the appended nodes when the window closes.
 *
 * Returns `null` if the window's kebab can't be located (e.g. the
 * shell rebuilt the chrome between renders); callers tolerate the
 * null and skip kebab features.
 */
function mountKebabColumnToggles(
	body: HTMLElement,
	cache: CellCache,
	repaintColumns: () => void,
	client: PostsWindowClient,
): { refresh: () => void; dispose: () => void } | null {
	const winEl = body.closest( '.desktop-mode-window' ) as HTMLElement | null;
	const panel = winEl?.querySelector(
		'.desktop-mode-window__menu-panel',
	) as HTMLElement | null;
	if ( ! panel ) {
		return null;
	}

	const SECTION_CLASS = 'desktop-mode-posts-window__menu-columns';
	const ITEM_CLASS = 'desktop-mode-posts-window__menu-column-item';
	const VALUE_PREFIX = 'desktop-mode-posts-column:';

	// Idempotent — if the user closes and re-opens the window without
	// the chrome being rebuilt, drop any earlier injection first.
	panel
		.querySelectorAll( `.${ SECTION_CLASS }, .${ ITEM_CLASS }` )
		.forEach( ( n ) => n.remove() );

	const allCols = buildAllColumns( cache, client );
	const togglable = allCols.filter(
		( c ) => ! REQUIRED_COLUMN_KEYS.has( c.key ),
	);
	if ( togglable.length === 0 ) {
		return null;
	}

	const sectionLabel = document.createElement( 'div' );
	sectionLabel.className = SECTION_CLASS;
	sectionLabel.setAttribute( 'role', 'presentation' );
	sectionLabel.textContent = __( 'Show columns' );
	panel.appendChild( sectionLabel );

	const itemEls = new Map< string, HTMLElement >();
	for ( const col of togglable ) {
		const item = document.createElement( 'wpd-menu-item' );
		item.setAttribute( 'role', 'menuitemcheckbox' );
		item.setAttribute( 'value', VALUE_PREFIX + col.key );
		item.classList.add( 'desktop-mode-window__menu-item' );
		item.classList.add( ITEM_CLASS );
		item.textContent = col.label || col.key;
		panel.appendChild( item );
		itemEls.set( col.key, item );
	}

	const paintChecked = (): void => {
		const hidden = getHiddenColumns();
		for ( const [ key, el ] of itemEls ) {
			if ( hidden.has( key ) ) {
				el.removeAttribute( 'checked' );
			} else {
				el.setAttribute( 'checked', '' );
			}
		}
	};
	paintChecked();

	const onClick = ( e: Event ): void => {
		const detail = ( e as CustomEvent< { value: string | null } > ).detail;
		const value = detail?.value;
		if ( typeof value !== 'string' || ! value.startsWith( VALUE_PREFIX ) ) {
			return;
		}
		const key = value.slice( VALUE_PREFIX.length );
		if ( ! itemEls.has( key ) || REQUIRED_COLUMN_KEYS.has( key ) ) {
			return;
		}
		// Optimistic flip first so the menu reads correct INSTANTLY,
		// then update the persisted set + repaint the table.
		const hidden = getHiddenColumns();
		if ( hidden.has( key ) ) {
			hidden.delete( key );
		} else {
			hidden.add( key );
		}
		const next = Array.from( hidden ).sort();
		const api = window.wp?.desktop;
		if ( api && typeof api.updateOsSettings === 'function' ) {
			// Attribute the in-flight save to the Posts window so the
			// title-bar activity dot blinks on this window, not on the
			// (probably-closed) OS Settings window.
			api.updateOsSettings(
				{ nativePostsHiddenColumns: next },
				{ windowId: 'desktop-mode-posts' },
			);
		}
		paintChecked();
		repaintColumns();
	};
	panel.addEventListener( 'wpd-menu-item-click', onClick );

	return {
		refresh: paintChecked,
		dispose: () => {
			panel.removeEventListener( 'wpd-menu-item-click', onClick );
			sectionLabel.remove();
			for ( const el of itemEls.values() ) {
				el.remove();
			}
			itemEls.clear();
		},
	};
}

/**
 * Default status segments — the segmented control above the table.
 * Plugins customize via `desktop_mode.postsWindow.statusSegments`.
 */
function defaultStatusSegments(): StatusSegment[] {
	return [
		{ value: '', label: __( 'All' ) },
		{ value: 'publish', label: __( 'Published' ) },
		{ value: 'draft', label: __( 'Drafts' ) },
		{ value: 'pending', label: __( 'Pending' ) },
		{ value: 'future', label: __( 'Scheduled' ) },
		{ value: 'trash', label: __( 'Trash' ) },
	];
}

/**
 * Default bulk actions — the buttons rendered in the bulk bar when
 * one or more rows are selected. Plugins extend via
 * `desktop_mode.postsWindow.bulkActions`. The shipped action is
 * "Move to trash"; remove it (return an empty array, or filter it
 * out by id) for read-only views.
 */
function defaultBulkActions( client: PostsWindowClient ): BulkAction[] {
	return [
		{
			id: 'trash',
			label: __( 'Move to trash' ),
			icon: 'dashicons-trash',
			variant: 'danger',
			/* translators: %d: row count. */
			confirm: __( 'Move %d post(s) to the trash?' ),
			run: async ( ids, ctx ) => {
				// Don't try to trash rows already in trash — a `DELETE`
				// without `force` would hard-delete them.
				const data = ctx.table.data ?? [];
				const trashable = ids.filter( ( id ) => {
					const row = data.find( ( r ) => r.id === id );
					return row && row.status !== 'trash';
				} );
				if ( trashable.length === 0 ) {
					return;
				}
				const results = await Promise.all(
					trashable.map( ( id ) => client.trashPost( id ) ),
				);
				const errors = results.filter( ( r ) => ! r.ok );
				if ( errors.length > 0 ) {
					// eslint-disable-next-line no-console
					console.error( '[posts-window] some trashes failed', errors );
				}
				const okIds = results.filter( ( r ) => r.ok ).map( ( r ) => r.id );
				const api = window.wp?.desktop;
				if ( api && typeof api.broadcast === 'function' ) {
					api.broadcast( 'desktop-mode.post.changed', {
						source: 'posts-window',
						action: 'trashed',
						ids: okIds,
					} );
				}
			},
		},
	];
}

/**
 * Apply the bulk-actions JS filter, with defensive fallbacks so a
 * misbehaving filter (returning `null`, throwing) doesn't strand the
 * bulk bar.
 */
function resolveBulkActions( client: PostsWindowClient ): BulkAction[] {
	const hooks = window.wp?.hooks;
	const defaults = defaultBulkActions( client );
	if ( ! hooks || typeof hooks.applyFilters !== 'function' ) {
		return defaults;
	}
	try {
		const out = hooks.applyFilters( HOOK_FILTER_BULK_ACTIONS, defaults );
		return Array.isArray( out ) ? ( out as BulkAction[] ) : defaults;
	} catch ( err ) {
		// eslint-disable-next-line no-console
		console.error(
			'[posts-window] bulk-actions filter threw; falling back to defaults:',
			err,
		);
		return defaults;
	}
}

function resolveStatusSegments(): StatusSegment[] {
	const hooks = window.wp?.hooks;
	const defaults = defaultStatusSegments();
	if ( ! hooks || typeof hooks.applyFilters !== 'function' ) {
		return defaults;
	}
	try {
		const out = hooks.applyFilters( HOOK_FILTER_STATUS_SEGMENTS, defaults );
		return Array.isArray( out ) && out.length > 0
			? ( out as StatusSegment[] )
			: defaults;
	} catch ( err ) {
		// eslint-disable-next-line no-console
		console.error(
			'[posts-window] status-segments filter threw; falling back to defaults:',
			err,
		);
		return defaults;
	}
}

function resolveToolbarTrailing( ctx: PostsWindowContext ): HTMLElement[] {
	const hooks = window.wp?.hooks;
	if ( ! hooks || typeof hooks.applyFilters !== 'function' ) {
		return [];
	}
	try {
		const out = hooks.applyFilters( HOOK_FILTER_TOOLBAR_TRAILING, [], ctx );
		if ( ! Array.isArray( out ) ) {
			return [];
		}
		return out.filter( ( el ): el is HTMLElement => el instanceof HTMLElement );
	} catch ( err ) {
		// eslint-disable-next-line no-console
		console.error(
			'[posts-window] toolbar-trailing filter threw; ignoring:',
			err,
		);
		return [];
	}
}

function buildTitleCell( row: PostListItem, client: PostsWindowClient ): HTMLElement {
	const cell = document.createElement( 'span' );
	cell.style.cssText =
		'display:flex;flex-direction:column;gap:4px;min-width:0;';

	const titleRow = document.createElement( 'span' );
	titleRow.style.cssText =
		'display:flex;align-items:center;gap:8px;min-width:0;';

	const link = document.createElement( 'a' );
	link.href = client.buildEditPostUrl( row.id );
	link.setAttribute( 'data-noclick', '' );
	const title = decodeTitle( row.title.rendered ) || __( '(no title)' );
	link.textContent = title;
	link.title = title;
	link.style.cssText =
		'font-weight:600;color:inherit;text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:340px;';
	link.addEventListener( 'mouseenter', () => {
		link.style.textDecoration = 'underline';
	} );
	link.addEventListener( 'mouseleave', () => {
		link.style.textDecoration = 'none';
	} );
	link.addEventListener( 'click', ( e ) => {
		e.preventDefault();
		e.stopPropagation();
		openAdminUrl( link.href, {
			title,
			icon: 'dashicons-admin-post',
		} );
	} );
	titleRow.appendChild( link );

	// Lock badge — another user is editing this row right now. Read
	// the `desktop_mode_lock` REST field surfaced by My WordPress'
	// `lock.php`. Same affordance the My WordPress folder window
	// uses, scoped to the table-row context (smaller, alongside the
	// status badge instead of overlaying the icon).
	const lock = row.desktop_mode_lock ?? null;
	if ( lock ) {
		const lockBadge = document.createElement( 'span' );
		lockBadge.style.cssText = [
			'display:inline-flex',
			'align-items:center',
			'gap:4px',
			'padding:2px 8px',
			'border-radius:10px',
			'font-size:11px',
			'font-weight:600',
			'background:rgba(179, 45, 46, 0.1)',
			'color:#b32d2e',
			'white-space:nowrap',
			'flex-shrink:0',
		].join( ';' );
		const lockIcon = document.createElement( 'span' );
		lockIcon.setAttribute( 'aria-hidden', 'true' );
		// `<wpd-table>` cells live inside shadow DOM. Document-level
		// CSS rules — `.dashicons { font-family: dashicons }` and
		// `.dashicons-lock:before { content: "\f160" }` — DO NOT pierce
		// that boundary, so the standard `class="dashicons dashicons-lock"`
		// recipe paints an empty box. The dashicons `@font-face` is
		// global (font faces are document-wide), so we sidestep by
		// setting font-family inline AND emitting the glyph character
		// directly as text content. Same visual, no CSS-encapsulation
		// surprise.
		lockIcon.style.cssText = [
			'font-family:dashicons',
			'font-size:14px',
			'line-height:1',
			'display:inline-block',
			'speak:none',
			'-webkit-font-smoothing:antialiased',
		].join( ';' );
		// Dashicons "lock" glyph (codepoint U+F160). Kept as an escape
		// so the source file doesn't depend on a Private-Use-Area
		// character round-tripping through editors and version control.
		lockIcon.textContent = '';
		lockBadge.appendChild( lockIcon );
		const lockText = document.createElement( 'span' );
		lockText.textContent = lock.userName;
		lockBadge.appendChild( lockText );
		// translators: %s is the user name currently editing the post.
		const tipFmt = __( '%s is currently editing', 'desktop-mode' );
		lockBadge.title = sprintf( tipFmt, lock.userName );
		titleRow.appendChild( lockBadge );
	}

	// Pages mode: paint "Front page" / "Posts page" badges when the
	// row matches the reading-page assignments. Answers the most-asked
	// classic-list pain — "which page is set as the homepage?" —
	// without making the user crack open Settings → Reading.
	let cfgForBadges: PostsWindowConfig | null = null;
	try {
		cfgForBadges = client.getConfig();
	} catch {
		cfgForBadges = null;
	}
	if ( cfgForBadges && cfgForBadges.mode === 'pages' ) {
		if (
			typeof cfgForBadges.frontPageId === 'number' &&
			cfgForBadges.frontPageId === row.id
		) {
			titleRow.appendChild(
				buildAssignmentBadge(
					__( 'Front page' ),
					'dashicons-admin-home',
					'#0a4b78',
					'rgba(34,113,177,0.12)',
				),
			);
		}
		if (
			typeof cfgForBadges.postsPageId === 'number' &&
			cfgForBadges.postsPageId === row.id
		) {
			titleRow.appendChild(
				buildAssignmentBadge(
					__( 'Posts page' ),
					'dashicons-admin-post',
					'#5b3aa0',
					'rgba(91,58,160,0.12)',
				),
			);
		}
	}

	if ( row.status && row.status !== 'publish' ) {
		const badge = document.createElement( 'span' );
		const colors = statusBadgeColor( row.status );
		badge.textContent = STATUS_LABELS[ row.status ] ?? row.status;
		badge.style.cssText = [
			'display:inline-flex',
			'align-items:center',
			'padding:2px 8px',
			'border-radius:10px',
			'font-size:11px',
			'font-weight:600',
			'text-transform:uppercase',
			'letter-spacing:0.04em',
			`background:${ colors.bg }`,
			`color:${ colors.fg }`,
			'white-space:nowrap',
			'flex-shrink:0',
		].join( ';' );
		titleRow.appendChild( badge );
	}

	// Pages mode: small "View" link to the public URL — opens in a
	// new tab so the user keeps the table state. Surfaces a feature
	// the classic list buries inside a hover-row-actions strip.
	if (
		cfgForBadges?.mode === 'pages' &&
		typeof row.link === 'string' &&
		row.link &&
		row.status === 'publish'
	) {
		const view = document.createElement( 'a' );
		view.href = row.link;
		view.target = '_blank';
		view.rel = 'noreferrer noopener';
		view.textContent = __( 'View' );
		view.title = row.link;
		view.setAttribute( 'data-noclick', '' );
		view.style.cssText = [
			'font-size:11px',
			'color:var(--wp-admin-theme-color, #2271b1)',
			'text-decoration:none',
			'flex-shrink:0',
		].join( ';' );
		view.addEventListener( 'click', ( e ) => e.stopPropagation() );
		view.addEventListener( 'mouseenter', () => {
			view.style.textDecoration = 'underline';
		} );
		view.addEventListener( 'mouseleave', () => {
			view.style.textDecoration = 'none';
		} );
		titleRow.appendChild( view );
	}

	cell.appendChild( titleRow );
	return cell;
}

/**
 * Render a small inline assignment badge (Front page / Posts page).
 *
 * @since 0.8.1
 */
function buildAssignmentBadge(
	label: string,
	dashicon: string,
	fg: string,
	bg: string,
): HTMLElement {
	const badge = document.createElement( 'span' );
	badge.style.cssText = [
		'display:inline-flex',
		'align-items:center',
		'gap:4px',
		'padding:2px 8px',
		'border-radius:10px',
		'font-size:11px',
		'font-weight:600',
		`background:${ bg }`,
		`color:${ fg }`,
		'white-space:nowrap',
		'flex-shrink:0',
	].join( ';' );
	const icon = document.createElement( 'span' );
	icon.className = `dashicons ${ dashicon }`;
	icon.setAttribute( 'aria-hidden', 'true' );
	icon.style.cssText =
		'font-size:13px;width:13px;height:13px;line-height:1;';
	const text = document.createElement( 'span' );
	text.textContent = label;
	badge.appendChild( icon );
	badge.appendChild( text );
	return badge;
}

function buildAuthorCell( row: PostListItem ): HTMLElement {
	const a = authorOf( row );
	const wrap = document.createElement( 'span' );
	wrap.style.cssText =
		'display:inline-flex;align-items:center;gap:8px;min-width:0;';

	// `<wpd-avatar>` — the framework component: initials fallback,
	// hue-by-name, the cursor-tracking 3D hover effect. We probe the
	// Gravatar URL via the shared helper so emails with no registered
	// avatar drop straight to initials instead of the mystery-person
	// silhouette — and the console stays clean (the helper uses a
	// canvas-alpha trick instead of provoking 404s).
	const avatar = document.createElement( 'wpd-avatar' );
	avatar.setAttribute( 'size', '24' );
	if ( a.name ) {
		avatar.setAttribute( 'name', a.name );
	}
	if ( a.id > 0 ) {
		avatar.setAttribute( 'user-id', String( a.id ) );
	}
	if ( a.avatar ) {
		applyAvatarSrc( avatar, a.avatar );
	}
	wrap.appendChild( avatar );

	const name = document.createElement( 'span' );
	name.textContent = a.name;
	name.style.cssText =
		'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
	wrap.appendChild( name );
	return wrap;
}

/**
 * Build the Tags column cell — a `<wpd-tag-input>` per row with
 * autocomplete suggestions, free-form creation, and optimistic
 * persistence to `/wp/v2/posts/{id}` (`tags` field).
 *
 * Robustness:
 *   - Suggestions are debounced (200 ms) and cancelled with an
 *     `AbortController` when a newer keystroke fires — no stale
 *     popover content.
 *   - Adds + removes are optimistic: the chip appears (with a
 *     `pending` pulse) immediately, and rolls back to the prior
 *     set on REST failure. The user sees a toast describing what
 *     went wrong.
 *   - Creation goes through `createTag()` → `updatePostTags()`
 *     atomically per add. A race between two rapid creates is
 *     fine — each gets its own term id.
 *   - The current `tags`/`_embedded` on the row stays the source of
 *     truth between paints; the cell cache (memoCell) keeps the
 *     same `<wpd-tag-input>` instance across selection-only
 *     repaints, so its open state and pending chips don't reset.
 */
function buildTagsCell( row: PostListItem, client: PostsWindowClient ): HTMLElement {
	const wrap = document.createElement( 'span' );
	wrap.style.cssText =
		'display:inline-flex;align-items:center;width:100%;min-width:0;';

	const picker = document.createElement( 'wpd-tag-input' ) as WpdTagInput;
	picker.setAttribute( 'creatable', '' );
	picker.setAttribute( 'removable', '' );
	picker.setAttribute( 'min-query', '0' );
	picker.setAttribute( 'placeholder', __( 'Add tag…' ) );
	picker.setAttribute( 'add-label', __( 'Tag' ) );
	picker.setAttribute( 'data-noclick', '' );

	// Seed from the row's embedded terms. `_embedded['wp:term'][1]`
	// is the post_tag group; `termRecordsOf` does the lookup.
	const seed: WpdTagItem[] = termRecordsOf( row, 'post_tag' ).map( ( t ) => ( {
		id: t.id,
		label: t.name,
	} ) );
	picker.value = seed;

	const cellState = {
		// Mirror of `picker.value` we mutate optimistically. Keeping
		// it here (rather than reading back from the picker) avoids
		// double-source-of-truth bugs when two events fire in the
		// same tick.
		tags: seed.slice(),
		// AbortController for the in-flight suggest fetch.
		suggestAbort: null as AbortController | null,
		suggestDebounce: null as number | null,
		// Last query the user typed — used to drop stale responses
		// even after AbortController has fired.
		lastQuery: '',
	};

	const setValue = ( next: WpdTagItem[] ): void => {
		cellState.tags = next.slice();
		picker.value = next;
	};

	picker.addEventListener( 'wpd-tag-suggest', ( e: Event ) => {
		const detail = ( e as CustomEvent< { query: string } > ).detail;
		const query = detail?.query ?? '';
		cellState.lastQuery = query;

		if ( cellState.suggestDebounce !== null ) {
			window.clearTimeout( cellState.suggestDebounce );
			cellState.suggestDebounce = null;
		}
		cellState.suggestDebounce = window.setTimeout( async () => {
			cellState.suggestDebounce = null;
			if ( cellState.suggestAbort ) {
				cellState.suggestAbort.abort();
			}
			const ac = new AbortController();
			cellState.suggestAbort = ac;
			try {
				const matches = await client.searchTags( query, ac.signal );
				if ( cellState.lastQuery !== query ) {
					return;
				}
				// Filter out tags the post already has — the picker
				// also de-dupes, but pre-filtering keeps the popover
				// from showing rows that resolve to a no-op click.
				const existingIds = new Set( cellState.tags.map( ( t ) => t.id ) );
				picker.suggestions = matches
					.filter( ( m ) => ! existingIds.has( m.id ) )
					.map( ( m ) => ( { id: m.id, label: m.name } ) );
			} catch ( err ) {
				if ( ( err as Error )?.name === 'AbortError' ) {
					return;
				}
				picker.suggestions = [];
				// eslint-disable-next-line no-console
				console.warn(
					'[posts-window] tag search failed',
					err,
				);
			} finally {
				picker.suggestionsLoading = false;
			}
		}, 200 ) as unknown as number;
	} );

	picker.addEventListener( 'wpd-tag-add', async ( e: Event ) => {
		const detail = ( e as CustomEvent< { tag: WpdTagItem; isNew: boolean } > )
			.detail;
		if ( ! detail?.tag ) {
			return;
		}
		const optimistic: WpdTagItem = {
			id: detail.tag.id,
			label: detail.tag.label,
			pending: true,
		};
		const next = [ ...cellState.tags, optimistic ];
		setValue( next );

		try {
			let resolvedTag: TagTerm | null = null;
			if ( detail.isNew || typeof detail.tag.id !== 'number' ) {
				resolvedTag = await client.createTag( detail.tag.label );
			} else {
				resolvedTag = {
					id: Number( detail.tag.id ),
					name: detail.tag.label,
					slug: '',
				};
			}

			const desiredIds = [
				...cellState.tags
					.filter( ( t ) => ! t.pending )
					.map( ( t ) => Number( t.id ) ),
				resolvedTag.id,
			];
			await client.updatePostTags( row.id, desiredIds );

			// Reconcile: replace the pending placeholder with the
			// canonical term, drop the pulse.
			setValue(
				cellState.tags.map( ( t ) => {
					if (
						t.label.toLowerCase() ===
						detail.tag.label.toLowerCase()
					) {
						return {
							id: resolvedTag!.id,
							label: resolvedTag!.name,
						};
					}
					return t;
				} ),
			);

			// Cross-window broadcast so other listeners (e.g. a Tags
			// admin window) can resync.
			const api = window.wp?.desktop;
			if ( api && typeof api.broadcast === 'function' ) {
				api.broadcast( 'desktop-mode.post.changed', {
					source: 'posts-window',
					action: 'tagged',
					ids: [ row.id ],
				} );
			}
		} catch ( err ) {
			// Roll back — drop the optimistic chip and show what
			// went wrong.
			setValue(
				cellState.tags.filter(
					( t ) =>
						t.label.toLowerCase() !== detail.tag.label.toLowerCase(),
				),
			);
			showTagError(
				sprintf(
					/* translators: %s: tag label */
					__( 'Couldn’t add tag "%s".' ),
					detail.tag.label,
				),
				err,
			);
		}
	} );

	picker.addEventListener( 'wpd-tag-remove', async ( e: Event ) => {
		const detail = ( e as CustomEvent< { tag: WpdTagItem } > ).detail;
		if ( ! detail?.tag ) {
			return;
		}
		const removed = detail.tag;
		const previous = cellState.tags.slice();
		setValue(
			cellState.tags.map( ( t ) =>
				t.label === removed.label ? { ...t, pending: true } : t,
			),
		);

		try {
			const desiredIds = previous
				.filter( ( t ) => t.label !== removed.label )
				.map( ( t ) => Number( t.id ) )
				.filter( ( n ) => Number.isFinite( n ) );
			await client.updatePostTags( row.id, desiredIds );
			setValue(
				previous.filter( ( t ) => t.label !== removed.label ),
			);

			const api = window.wp?.desktop;
			if ( api && typeof api.broadcast === 'function' ) {
				api.broadcast( 'desktop-mode.post.changed', {
					source: 'posts-window',
					action: 'untagged',
					ids: [ row.id ],
				} );
			}
		} catch ( err ) {
			// Roll back to the previous set.
			setValue( previous );
			showTagError(
				sprintf(
					/* translators: %s: tag label */
					__( 'Couldn’t remove tag "%s".' ),
					removed.label,
				),
				err,
			);
		}
	} );

	wrap.appendChild( picker );
	return wrap;
}

/**
 * Surface a tag-mutation error. Prefers the shell's toast surface
 * (`wp.desktop.showToast`) when available, falls back to console.
 */
function showTagError( title: string, err: unknown ): void {
	const reason = err instanceof Error ? err.message : String( err );
	const api = window.wp?.desktop;
	if ( api && typeof api.showToast === 'function' ) {
		api.showToast( {
			message: `${ title } ${ reason }`.trim(),
			duration: 6000,
		} );
		return;
	}
	// eslint-disable-next-line no-console
	console.error( title, err );
}

/**
 * Categories cell — a `<wpd-category-picker>` per row, hooked to the
 * shared category tree cache (one fetch per window-open across every
 * row's picker) with optimistic UX + REST roll-back on failure.
 *
 * Mirrors `buildTagsCell` but speaks the hierarchical taxonomy:
 *
 *   - Picker shows a search-filtered, indent-guided tree.
 *   - "Uncategorized" sentinel rendered as a muted dashed chip when
 *     the user's category set is empty (matches WP's server-side
 *     fallback — sending `categories: []` to the REST endpoint
 *     auto-applies term 1).
 *   - Errors roll the chip set back to its prior state and surface
 *     a toast via the shell.
 */
function buildCategoriesCell( row: PostListItem, client: PostsWindowClient ): HTMLElement {
	const wrap = document.createElement( 'span' );
	wrap.className = 'wpd-cat-cell-dropzone';
	wrap.style.cssText =
		'display:inline-flex;align-items:center;width:100%;min-width:0;border-radius:6px;transition:background-color 0.12s ease, box-shadow 0.12s ease;';

	const picker = document.createElement(
		'wpd-category-picker',
	) as WpdCategoryPicker;
	picker.setAttribute( 'placeholder', __( 'Search categories…' ) );
	picker.setAttribute( 'add-label', __( 'Categorize' ) );
	picker.setAttribute( 'data-noclick', '' );
	// Register so the term-changed broadcast can push a fresh tree
	// to this picker when categories are created/edited elsewhere.
	_activePickers.add( picker );

	// Seed the picker with the row's currently-assigned ids.
	picker.value = row.categories ?? [];

	// Categories live in `_embedded['wp:term'][0]` (taxonomy ===
	// 'category'). Pre-seed the picker's tree from the embedded
	// terms so the first-paint shows the chips with proper names
	// even before the global tree fetch resolves. The first
	// `openPicker()` will replace `items` with the full tree.
	const seedItems: WpdCategoryItem[] = termRecordsOf( row, 'category' ).map(
		( t ) => ( { id: t.id, name: t.name, parent: 0 } ),
	);
	picker.items = seedItems;

	const cellState = {
		categoryIds: ( row.categories ?? [] ).slice(),
	};

	const setValue = ( next: number[] ): void => {
		cellState.categoryIds = next.slice();
		picker.value = next;
	};

	// Eagerly load the full category tree so the in-cell breadcrumb
	// chains can render full hierarchy paths from the very first
	// paint — without this, `picker.items` is just the seed items
	// embedded with the post (which carry `parent: 0`), so each
	// chain collapses to a single chip even when the term has
	// real ancestors. The shared `getCategoriesTree()` promise
	// dedupes across every row's cell, so 50 rows = ONE round-trip
	// per window-open.
	void getCategoriesTree( client )
		.then( ( tree ) => {
			if ( ! picker.isConnected ) {
				return; // window closed / row scrolled away
			}
			picker.items = tree;
		} )
		.catch( ( err ) => {
			// eslint-disable-next-line no-console
			console.warn( '[posts-window] category tree fetch failed', err );
		} );

	picker.addEventListener( 'wpd-categories-open', () => {
		// The tree is already on its way (or arrived) thanks to
		// the eager prefetch above. If it landed before the
		// picker opened, no-op; otherwise prime via the cached
		// promise so the popover paints with full hierarchy as
		// soon as data arrives.
		void primePickerFromCache( picker );
	} );

	picker.addEventListener(
		'wpd-categories-create',
		async ( e: Event ) => {
			const detail = ( e as CustomEvent< { name: string; parent: number } > )
				.detail;
			const parent = detail?.parent ?? 0;
			if ( ! detail || ! detail.name ) {
				picker.failCreating( parent );
				return;
			}
			try {
				const created = await client.createCategory( detail.name, parent );
				// Drop the cache so any future picker open re-fetches
				// the tree (won't include the new term until that
				// happens, but each picker that's already loaded
				// gets the new term spliced in below).
				_categoryTreePromise = null;
				// Splice the new term into this picker's items so
				// the user sees it immediately under the parent
				// they typed it into.
				const nextItems: WpdCategoryItem[] = [
					...picker.items,
					{
						id: created.id,
						name: created.name,
						parent: created.parent,
					},
				];
				picker.items = nextItems;
				// Auto-select the newly-created term so the chain
				// updates instantly. The `wpd-categories-change`
				// handler below picks up the persistence + REST
				// round-trip.
				const nextValue = [ ...cellState.categoryIds, created.id ];
				setValue( nextValue );
				picker.endCreating( parent );
				// Persist the post's new category set.
				try {
					await client.updatePostCategories( row.id, nextValue );
					const api = window.wp?.desktop;
					if ( api && typeof api.broadcast === 'function' ) {
						api.broadcast( 'desktop-mode.post.changed', {
							source: 'posts-window',
							action: 'categorized',
							ids: [ row.id ],
						} );
					}
				} catch ( err ) {
					setValue( cellState.categoryIds.filter( ( id ) => id !== created.id ) );
					showTagError( __( 'Couldn’t assign new category.' ), err );
				}
			} catch ( err ) {
				picker.failCreating(
					parent,
					err instanceof Error ? err.message : String( err ),
				);
				showTagError( __( 'Couldn’t create category.' ), err );
			}
		},
	);

	picker.addEventListener( 'wpd-categories-change', async ( e: Event ) => {
		const detail = ( e as CustomEvent< { value: number[] } > ).detail;
		if ( ! detail || ! Array.isArray( detail.value ) ) {
			return;
		}
		const previous = cellState.categoryIds.slice();
		const next = detail.value.slice();
		setValue( next );

		try {
			await client.updatePostCategories( row.id, next );

			const api = window.wp?.desktop;
			if ( api && typeof api.broadcast === 'function' ) {
				api.broadcast( 'desktop-mode.post.changed', {
					source: 'posts-window',
					action: 'categorized',
					ids: [ row.id ],
				} );
			}
		} catch ( err ) {
			// Roll back to the prior set; surface what went wrong.
			setValue( previous );
			showTagError( __( 'Couldn’t update categories.' ), err );
		}
	} );

	// --- Drag-and-drop: ship a breadcrumb chain to another row -------
	// Drag from any segment OTHER than the × button picks up the
	// segment + its descendants in the chain (so a drag from the
	// middle of [Tech > Web Dev > Frontend] yields [Web Dev,
	// Frontend], NOT Tech). The drop target merges those ids into
	// the receiving row's category set.

	picker.addEventListener( 'wpd-categories-delete', async ( e: Event ) => {
		const detail = ( e as CustomEvent< { id: number; name: string } > )
			.detail;
		if ( ! detail || typeof detail.id !== 'number' ) {
			return;
		}
		// Confirm via the framework's `<wpd-confirm-dialog>`
		// (proxied through `wp.desktop.confirm`). WP cascades
		// posts that previously belonged to the deleted term
		// back to Uncategorized automatically.
		const ok = await wpdConfirmGlobal( {
			title: __( 'Delete category?' ),
			message: sprintf(
				/* translators: %s: category name. */
				__(
					'Delete the category "%s"? Posts assigned only to it will fall back to Uncategorized.',
				),
				detail.name,
			),
			confirmLabel: __( 'Delete' ),
			danger: true,
		} );
		if ( ! ok ) {
			return;
		}
		try {
			await client.deleteTerm( 'categories', detail.id );
			// `deleteTerm` already broadcasts desktop-mode.term.changed,
			// which clears the cache and pushes the fresh tree to
			// every live picker. We just need to drop the deleted
			// id from THIS row's value if it was assigned.
			if ( cellState.categoryIds.includes( detail.id ) ) {
				const next = cellState.categoryIds.filter(
					( id ) => id !== detail.id,
				);
				setValue( next );
				try {
					await client.updatePostCategories( row.id, next );
				} catch ( err ) {
					// The term IS gone server-side; failing to write
					// back the post's now-shorter list is recoverable
					// via the next refresh. Surface so the user knows.
					showTagError(
						__( 'Couldn’t update post categories after delete.' ),
						err,
					);
				}
			}
		} catch ( err ) {
			showTagError( __( 'Couldn’t delete category.' ), err );
		}
	} );

	picker.addEventListener( 'wpd-chain-segment-dragstart', ( e: Event ) => {
		const detail = ( e as CustomEvent< {
			segments: Array< { id?: number | string } >;
			dragEvent: DragEvent;
		} > ).detail;
		if ( ! detail || ! detail.dragEvent || ! detail.dragEvent.dataTransfer ) {
			return;
		}
		const ids: number[] = [];
		for ( const seg of detail.segments ) {
			if ( typeof seg.id === 'number' ) {
				ids.push( seg.id );
			}
		}
		if ( ids.length === 0 ) {
			return;
		}
		const dt = detail.dragEvent.dataTransfer;
		dt.setData(
			'application/x-desktop-mode-categories',
			JSON.stringify( {
				ids,
				source: 'posts-window',
				sourcePostId: row.id,
			} ),
		);
		// Fallback so debug consumers (drag into the URL bar, into a
		// text editor, etc.) get something legible.
		dt.setData( 'text/plain', ids.join( ',' ) );
		dt.effectAllowed = 'copy';
	} );

	// Drop-target plumbing on the cell wrapper. We use an enter-
	// counter to dodge the classic "dragleave fires when entering
	// every child" gotcha — the highlight stays put until the
	// pointer is genuinely outside the cell.
	let dropEnterCount = 0;
	const setDropTargetActive = ( on: boolean ): void => {
		// Inlined because the cell renders inside <wpd-table>'s shadow
		// DOM, which document stylesheets can't reach. Tinted in the
		// admin theme color via `--wp-admin-theme-color` with a fallback.
		if ( on ) {
			wrap.style.backgroundColor =
				'color-mix(in srgb, var(--wp-admin-theme-color, #2271b1) 12%, transparent)';
			wrap.style.boxShadow =
				'inset 0 0 0 2px var(--wp-admin-theme-color, #2271b1)';
		} else {
			wrap.style.backgroundColor = '';
			wrap.style.boxShadow = '';
		}
	};
	const acceptsCategoriesDrag = ( e: DragEvent ): boolean => {
		const types = e.dataTransfer?.types;
		if ( ! types ) {
			return false;
		}
		// `types` is a DOMStringList in some engines; spread + includes
		// works against both DOMStringList and string[].
		return Array.from( types ).includes(
			'application/x-desktop-mode-categories',
		);
	};
	wrap.addEventListener( 'dragenter', ( e: DragEvent ) => {
		if ( ! acceptsCategoriesDrag( e ) ) {
			return;
		}
		e.preventDefault();
		dropEnterCount++;
		setDropTargetActive( true );
	} );
	wrap.addEventListener( 'dragover', ( e: DragEvent ) => {
		if ( ! acceptsCategoriesDrag( e ) ) {
			return;
		}
		e.preventDefault();
		if ( e.dataTransfer ) {
			e.dataTransfer.dropEffect = 'copy';
		}
	} );
	wrap.addEventListener( 'dragleave', () => {
		if ( dropEnterCount > 0 ) {
			dropEnterCount--;
		}
		if ( dropEnterCount === 0 ) {
			setDropTargetActive( false );
		}
	} );
	wrap.addEventListener( 'drop', async ( e: DragEvent ) => {
		dropEnterCount = 0;
		setDropTargetActive( false );
		if ( ! acceptsCategoriesDrag( e ) ) {
			return;
		}
		e.preventDefault();
		const json = e.dataTransfer?.getData(
			'application/x-desktop-mode-categories',
		);
		if ( ! json ) {
			return;
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse( json );
		} catch {
			return;
		}
		const payload = parsed as
			| { ids?: unknown; sourcePostId?: number }
			| null;
		if ( ! payload || ! Array.isArray( payload.ids ) ) {
			return;
		}
		const incoming: number[] = [];
		for ( const v of payload.ids ) {
			if ( typeof v === 'number' && Number.isFinite( v ) ) {
				incoming.push( v );
			}
		}
		if ( incoming.length === 0 ) {
			return;
		}
		// No-op if user dropped on the same row they dragged from
		// (avoids a redundant REST round-trip).
		if (
			payload.sourcePostId === row.id &&
			incoming.every( ( id ) => cellState.categoryIds.includes( id ) )
		) {
			return;
		}
		const merged = Array.from(
			new Set( [ ...cellState.categoryIds, ...incoming ] ),
		);
		if ( merged.length === cellState.categoryIds.length ) {
			return; // nothing actually new
		}
		const previous = cellState.categoryIds.slice();
		setValue( merged );
		try {
			await client.updatePostCategories( row.id, merged );
			const api = window.wp?.desktop;
			if ( api && typeof api.broadcast === 'function' ) {
				api.broadcast( 'desktop-mode.post.changed', {
					source: 'posts-window',
					action: 'categorized',
					ids: [ row.id ],
				} );
			}
		} catch ( err ) {
			setValue( previous );
			showTagError( __( 'Couldn’t add category.' ), err );
		}
	} );

	wrap.appendChild( picker );
	return wrap;
}

/**
 * Window-scoped category tree cache. The full tree fetch happens
 * once per window-open and is shared across every row's picker.
 * Cleared when the window closes (the cache lives in module scope
 * and is intentionally re-populated on the next open so a category
 * created elsewhere shows up without an F5).
 */
let _categoryTreePromise: Promise< WpdCategoryItem[] > | null = null;

function getCategoriesTree( client: PostsWindowClient ): Promise< WpdCategoryItem[] > {
	if ( ! _categoryTreePromise ) {
		_categoryTreePromise = client.fetchAllCategories().then(
			( terms: CategoryTerm[] ) =>
				terms.map( ( t ) => ( {
					id: t.id,
					name: t.name,
					parent: t.parent,
				} ) ),
		);
	}
	return _categoryTreePromise;
}

/** Reset the cache when the posts window closes. */
function clearCategoryTreeCache(): void {
	_categoryTreePromise = null;
}

/**
 * Live registry of every category picker currently mounted in the
 * window. Populated by `buildCategoriesCell`; iterated by the
 * term-changed broadcast handler so newly-created categories show
 * up in EVERY row's picker (and chain) without a refresh.
 *
 * Lazy cleanup — disconnected pickers are removed on the next
 * iteration via `isConnected`. We don't need a WeakSet because
 * we explicitly drop dead entries when we walk the set.
 */
const _activePickers = new Set< WpdCategoryPicker >();

/**
 * Re-fetch the category tree from scratch and push it onto every
 * live picker. Called from the `desktop-mode.term.changed`
 * subscriber after `clearCategoryTreeCache()`. Without this, a
 * category created elsewhere (mindmap, terms tab, another tab)
 * isn't visible in any row's picker — neither in the popover tree
 * NOR in the cell breadcrumbs — until the user closes and reopens
 * the posts window. That broke the drag-and-drop case the user
 * reported: a chip can't be the drag source for a term that
 * `picker.items` doesn't know about, so freshly-created
 * categories silently couldn't be dragged.
 */
function broadcastFreshCategoryTreeToPickers( client: PostsWindowClient ): void {
	void getCategoriesTree( client )
		.then( ( tree ) => {
			for ( const picker of _activePickers ) {
				if ( picker.isConnected ) {
					picker.items = tree;
				} else {
					_activePickers.delete( picker );
				}
			}
		} )
		.catch( () => {
			// Fetch failed — pickers keep their existing items list.
			// Next picker open will retry via the cache miss path.
		} );
}

/**
 * If the cache is already warm by the time another picker opens,
 * sync the tree onto it without spinning. Used when a sibling
 * picker primed the cache before this one opened.
 */
async function primePickerFromCache( picker: WpdCategoryPicker ): Promise< void > {
	if ( ! _categoryTreePromise ) {
		return;
	}
	try {
		picker.items = await _categoryTreePromise;
	} catch {
		// Fetch failed — nothing to do; picker keeps the seed items.
	}
}

function buildDateCell( row: PostListItem ): HTMLElement {
	const wrap = document.createElement( 'span' );
	wrap.style.cssText =
		'display:flex;flex-direction:column;line-height:1.2;';
	const time = document.createElement( 'wpd-relative-time' );
	time.setAttribute( 'datetime', row.date );
	wrap.appendChild( time );
	if ( row.modified_gmt && row.modified_gmt !== row.date_gmt ) {
		const meta = document.createElement( 'span' );
		meta.textContent = __( 'modified' );
		meta.style.cssText = 'font-size:11px;color:#646970;';
		wrap.appendChild( meta );
	}
	return wrap;
}

function buildSubRow( row: PostListItem ): Node {
	const wrap = document.createElement( 'div' );
	wrap.style.cssText =
		'display:flex;gap:16px;padding:12px 16px;background:#fafafa;align-items:flex-start;';

	const featured = featuredMediaOf( row );
	if ( featured ) {
		const img = document.createElement( 'img' );
		img.src = featured.url;
		img.alt = featured.alt;
		img.loading = 'lazy';
		img.style.cssText =
			'width:96px;height:96px;border-radius:6px;object-fit:cover;flex-shrink:0;';
		wrap.appendChild( img );
	}

	const text = document.createElement( 'div' );
	text.style.cssText =
		'flex:1;min-width:0;display:flex;flex-direction:column;gap:6px;';

	const heading = document.createElement( 'div' );
	heading.style.cssText =
		'font-size:13px;color:#646970;text-transform:uppercase;letter-spacing:0.04em;';
	heading.textContent = __( 'Excerpt' );
	text.appendChild( heading );

	const excerpt = document.createElement( 'div' );
	excerpt.style.cssText = 'color:#1d2327;line-height:1.5;';
	const raw = row.excerpt?.rendered ?? '';
	if ( raw ) {
		// `excerpt.rendered` is HTML. Render through a textarea-decoder
		// then strip tags — we want plain text in the sub-row, not
		// arbitrary nested elements.
		const stripped = raw.replace( /<[^>]+>/g, '' ).trim();
		excerpt.textContent = stripped || __( '(no excerpt)' );
	} else {
		excerpt.textContent = __( '(no excerpt)' );
		excerpt.style.color = '#a7aaad';
	}
	text.appendChild( excerpt );

	wrap.appendChild( text );
	return wrap;
}

/**
 * Render entry. Called once per window-open with a fresh body
 * containing the cloned template.
 *
 * Returns a `Promise` so the shell's window-loading overlay stays up
 * until the first `refresh()` resolves — without this, a synchronous
 * return triggers the framework's "ready on next rAF" auto-mark and
 * the WordPress logo loader disappears before the table has rows,
 * yielding the brief flash of empty body the user reported.
 *
 * Cleanup is handled via the `desktop-mode-window-closed` document
 * event so the shell doesn't need a teardown return — matches the
 * recycle-bin pattern and lets us merge the shared
 * `Window.desktopModeNativeWindows` global type cleanly across both
 * modules.
 */
export async function renderPostsWindow(
	body: HTMLElement,
	client: PostsWindowClient,
): Promise< void > {
	const root = body.querySelector< HTMLElement >( ROOT );
	const table = body.querySelector< WpdTable< PostListItem > >( TABLE );
	if ( ! root || ! table ) {
		return;
	}

	maybeShowIntro( client );

	// Term-management tabs (Categories + Tags) — lazy-mounted on first
	// activation so cold-load of the Posts window never pays for them
	// when the user just wants to scan the post list.
	const catsHost = body.querySelector< HTMLElement >(
		'[data-desktop-mode-posts-cats-host]',
	);
	const tagsHost = body.querySelector< HTMLElement >(
		'[data-desktop-mode-posts-tags-host]',
	);
	let catsTeardown: ( () => void ) | null = null;
	let tagsTeardown: ( () => void ) | null = null;
	const tabsEl = body.querySelector( '.desktop-mode-posts__tabs' );
	if ( tabsEl ) {
		tabsEl.addEventListener( 'wpd-tab-change', ( e: Event ) => {
			const detail = ( e as CustomEvent< { value: string } > ).detail;
			const value = detail?.value;
			// Categories = Pixi mindmap. The mind-map IS the view; no
			// table fallback. Loads its own term list internally.
			if ( value === 'categories' && catsHost && ! catsTeardown ) {
				void import( './categories-mindmap' ).then(
					async ( { mountCategoriesMindmap } ) => {
						catsTeardown = await mountCategoriesMindmap( catsHost, client );
					},
				);
			}
			if ( value === 'tags' && tagsHost && ! tagsTeardown ) {
				// Tags = Pixi tag cloud — same shape as the Categories
				// mindmap (pan/zoom, click to focus + paginated post
				// fan, sidebar editor) but with a hashtag-pill layout
				// and no hierarchy. The tag cloud IS the view; no
				// table fallback. Loads its own term list internally.
				void import( './tags-cloud' ).then(
					async ( { mountTagsCloud } ) => {
						tagsTeardown = await mountTagsCloud( tagsHost, client );
					},
				);
			}
		} );
	}

	const cfg = client.getConfig();
	const view: ViewState = {
		page: 1,
		perPage: Math.max( 1, cfg.defaultPerPage || 20 ),
		search: '',
		status: '',
		orderby: 'date',
		order: 'desc',
		author: [],
		tag: [],
		searchDebounce: null,
	};

	// Per-window cell-node cache. Cleared on every `refresh()`; lets
	// repaints triggered by selection / expand / sort-state cycles
	// reuse the same `<img>` / `<wpd-relative-time>` / chip nodes
	// instead of rebuilding them — the original "avatar blink on
	// row select" bug.
	const cellCache: CellCache = new Map();

	// Author + tag filter options live on the column descriptors and
	// drive the `<wpd-table>` filter row's dropdowns. We seed them
	// empty so the first paint doesn't block on REST, then re-paint
	// the columns once the lists arrive — same shape as the category-
	// tree priming pattern below.
	const filterData: ColumnFilterData = { authors: [], tags: [] };

	table.columns = buildColumns( cellCache, client, filterData );
	table.getRowId = ( row ) => row.id;
	table.subTable = ( row ) => buildSubRow( row );
	table.sort = { key: 'date', direction: 'desc' };

	let totalPages = 0;
	let totalRows = 0;
	let refreshSeq = 0;

	const perPageEl = root.querySelector< HTMLSelectElement >( PER_PAGE );
	if ( perPageEl ) {
		// Reflect the current per-page on first paint so the select
		// matches the state we'll send on the first fetch.
		perPageEl.value = String( view.perPage );
	}

	const indicator = root.querySelector< HTMLElement >( PAGE_INDICATOR );
	const prevBtn = root.querySelector< HTMLButtonElement >( PREV );
	const nextBtn = root.querySelector< HTMLButtonElement >( NEXT );
	const bulkBar = root.querySelector< HTMLElement >( BULK );
	const countEl = root.querySelector< HTMLElement >( COUNT );
	const bulkActionsHost = root.querySelector< HTMLElement >( BULK_ACTIONS_HOST );
	const trailingExtras = root.querySelector< HTMLElement >(
		TOOLBAR_TRAILING_EXTRAS,
	);
	const statusHost = root.querySelector< HTMLElement >( STATUS );

	// Build the segmented control's children from the (filterable)
	// status-segment list. Built dynamically rather than echoed by
	// PHP so plugins can add CPT-specific statuses ("Awaiting
	// review", "Archived") or remove segments without forking the
	// template.
	const statusSegments = resolveStatusSegments();
	if ( statusHost ) {
		statusHost.replaceChildren();
		for ( const seg of statusSegments ) {
			const el = document.createElement( 'wpd-segment' );
			el.setAttribute( 'value', seg.value );
			el.textContent = seg.label;
			statusHost.appendChild( el );
		}
		// Mirror the initial view value so the right segment paints
		// as selected on first frame (parent's `value` attribute is
		// what `<wpd-segmented>` reads — see its source).
		statusHost.setAttribute( 'value', view.status );
	}

	const updatePager = (): void => {
		if ( indicator ) {
			if ( totalRows === 0 ) {
				indicator.textContent = __( 'No posts' );
			} else {
				indicator.textContent = sprintf(
					/* translators: 1: current page, 2: total pages, 3: total posts. */
					__( 'Page %1$d of %2$d · %3$d posts' ),
					view.page,
					Math.max( totalPages, 1 ),
					totalRows,
				);
			}
		}
		if ( prevBtn ) {
			prevBtn.toggleAttribute( 'disabled', view.page <= 1 );
		}
		if ( nextBtn ) {
			nextBtn.toggleAttribute( 'disabled', view.page >= totalPages );
		}
	};

	const updateBulkBar = (): void => {
		if ( ! bulkBar || ! countEl ) {
			return;
		}
		const sel = Array.from( table.selection ?? [] );
		if ( sel.length === 0 ) {
			bulkBar.hidden = true;
			return;
		}
		bulkBar.hidden = false;
		countEl.textContent = sprintf(
			/* translators: %d: selected row count. */
			__( '%d selected' ),
			sel.length,
		);
	};

	const buildParams = (): PostsListParams => ( {
		page: view.page,
		perPage: view.perPage,
		search: view.search || undefined,
		status: view.status || undefined,
		orderby: view.orderby,
		order: view.order,
		author: view.author.length > 0 ? view.author : undefined,
		tag: view.tag.length > 0 ? view.tag : undefined,
	} );

	// Context object handed to bulk actions and lifecycle subscribers.
	// Stable read API — see `./types.ts` for the public contract.
	const ctx: PostsWindowContext = {
		body,
		table,
		refresh: () => refresh(),
		getSelectedIds: () =>
			Array.from( table.selection ?? [] ).map( ( id ) => Number( id ) ),
		getSelectedRows: () => {
			const ids = new Set( ctx.getSelectedIds() );
			return ( table.data ?? [] ).filter( ( r ) => ids.has( r.id ) );
		},
		getCurrentParams: () => buildParams(),
	};

	const refresh = async (): Promise< void > => {
		const mySeq = ++refreshSeq;
		table.toggleAttribute( 'loading', true );
		try {
			const result = await client.fetchPosts( buildParams() );
			if ( mySeq !== refreshSeq ) {
				return;
			}

			// Auto-recover from "page out of range" — the typical
			// case is the user being on page 7 and changing per_page
			// from 10 → 100 (now there are only 2 pages). Re-fetch
			// page 1 silently rather than render an empty table.
			if (
				result.items.length === 0 &&
				view.page > 1 &&
				result.totalPages > 0 &&
				view.page > result.totalPages
			) {
				view.page = 1;
				await refresh();
				return;
			}

			// Real data change — drop every cached cell node so the
			// new rows get fresh DOM. Selection-only repaints don't
			// pass through here, which is exactly what makes the
			// cache useful.
			cellCache.clear();
			// In Pages mode the Parent cell resolves parent titles
			// from the in-page roster — refresh it BEFORE assigning
			// `table.data` so the first paint already has names.
			refreshParentTitleRoster( result.items );
			table.data = result.items;
			totalRows = result.total;
			totalPages = result.totalPages;
			updatePager();

			// Fire the lifecycle action so plugins can react to a
			// fresh data set landing — e.g. recompute their own
			// per-row decorations.
			const hooks = window.wp?.hooks;
			if ( hooks && typeof hooks.doAction === 'function' ) {
				hooks.doAction( HOOK_ACTION_DATA_LOADED, {
					items: result.items,
					total: result.total,
					totalPages: result.totalPages,
					page: view.page,
				} );
			}
			document.dispatchEvent(
				new CustomEvent( 'desktop-mode-posts-window-data-loaded', {
					detail: {
						items: result.items,
						total: result.total,
						totalPages: result.totalPages,
						page: view.page,
					},
				} ),
			);
		} catch ( err ) {
			if ( mySeq !== refreshSeq ) {
				return;
			}
			// eslint-disable-next-line no-console
			console.error( '[posts-window] list failed', err );
			table.data = [];
			totalRows = 0;
			totalPages = 0;
			updatePager();
		} finally {
			if ( mySeq === refreshSeq ) {
				table.toggleAttribute( 'loading', false );
				updateBulkBar();
			}
		}
	};

	const goToFirstPage = (): void => {
		if ( view.page !== 1 ) {
			view.page = 1;
		}
	};

	// --- Toolbar wiring ---------------------------------------------------

	root.querySelector( STATUS )?.addEventListener( 'wpd-pick', ( e: Event ) => {
		const value = ( e as CustomEvent< { value: string } > ).detail?.value ?? '';
		view.status = value;
		goToFirstPage();
		void refresh();
	} );

	root.querySelector( SEARCH )?.addEventListener(
		'wpd-input-change',
		( e: Event ) => {
			const value =
				( e as CustomEvent< { value: string } > ).detail?.value ?? '';
			view.search = value;
			if ( view.searchDebounce !== null ) {
				window.clearTimeout( view.searchDebounce );
			}
			view.searchDebounce = window.setTimeout( () => {
				goToFirstPage();
				void refresh();
			}, SEARCH_DEBOUNCE_MS );
		},
	);

	body.addEventListener( 'click', ( e: Event ) => {
		const target = e.target as HTMLElement | null;
		if ( ! target ) {
			return;
		}
		if ( target.closest( REFRESH ) ) {
			void refresh();
			return;
		}
		if ( target.closest( NEW_BTN ) ) {
			openAdminUrl( cfg.newPostUrl, {
				title: __( 'Add New Post' ),
				icon: 'dashicons-admin-post',
			} );
			return;
		}
		if ( target.closest( PREV ) ) {
			if ( view.page > 1 ) {
				view.page -= 1;
				void refresh();
			}
			return;
		}
		if ( target.closest( NEXT ) ) {
			if ( view.page < totalPages ) {
				view.page += 1;
				void refresh();
			}
		}
	} );

	// --- Bulk actions registry ---------------------------------------

	const bulkActions = resolveBulkActions( client );
	if ( bulkActionsHost ) {
		bulkActionsHost.replaceChildren();
		for ( const action of bulkActions ) {
			bulkActionsHost.appendChild( buildBulkActionButton( action, ctx ) );
		}
	}

	// --- Toolbar trailing extras (plugin-injected) -------------------

	if ( trailingExtras ) {
		const extras = resolveToolbarTrailing( ctx );
		// Insert AT the slot's position so plugin buttons appear
		// before the built-in Refresh + Add New buttons.
		trailingExtras.replaceChildren( ...extras );
	}

	perPageEl?.addEventListener( 'change', () => {
		const next = parseInt( perPageEl.value, 10 );
		if ( ! Number.isFinite( next ) || next < 1 ) {
			return;
		}
		view.perPage = next;
		goToFirstPage();
		void refresh();
	} );

	// --- Table wiring -----------------------------------------------------

	table.addEventListener( 'wpd-table-selection-change', () => {
		updateBulkBar();
	} );

	table.addEventListener( 'wpd-table-sort-change', ( e: Event ) => {
		const detail = ( e as CustomEvent< { sort: { key: string; direction: 'asc' | 'desc' } | null } > ).detail;
		if ( ! detail || ! detail.sort ) {
			view.orderby = 'date';
			view.order = 'desc';
		} else {
			view.orderby = mapColumnToOrderby( detail.sort.key );
			view.order = detail.sort.direction;
		}
		void refresh();
	} );

	// Column filter dropdowns (Author, Tag). The table emits
	// `wpd-table-filter-change` with the full filter map. The custom
	// `<wpd-tag-input>` filters serialize selection as comma-joined
	// ids — we parse them back into number[] for the view + REST
	// query. A filter change always resets to page 1 so the user
	// lands on a fresh result set.
	const parseIds = ( raw: string ): number[] =>
		raw
			.split( ',' )
			.map( ( s ) => parseInt( s.trim(), 10 ) )
			.filter( ( n ) => Number.isFinite( n ) && n > 0 );
	const sameIds = ( a: number[], b: number[] ): boolean =>
		a.length === b.length && a.every( ( v, i ) => v === b[ i ] );
	table.addEventListener( 'wpd-table-filter-change', ( e: Event ) => {
		const detail = ( e as CustomEvent< { filters: Record< string, string > } > )
			.detail;
		const filters = detail?.filters ?? {};
		const nextAuthor = parseIds( filters.author ?? '' );
		const nextTag = parseIds( filters.tags ?? '' );
		const changed =
			! sameIds( nextAuthor, view.author ) ||
			! sameIds( nextTag, view.tag );
		if ( ! changed ) {
			return;
		}
		view.author = nextAuthor;
		view.tag = nextTag;
		view.page = 1;
		void refresh();
	} );

	/**
	 * Run a registered bulk action: confirm if requested, invoke
	 * `run`, then auto-clear-selection + refresh unless the action
	 * explicitly returned `false`.
	 */
	activeRunBulkAction = async (
		action: BulkAction,
		actionCtx: PostsWindowContext,
	): Promise< void > => {
		const ids = actionCtx.getSelectedIds();
		if ( ids.length === 0 ) {
			return;
		}
		if ( action.confirm ) {
			const ok = await wpdConfirmGlobal( {
				message: sprintf(
					/* translators: %d: row count. */
					action.confirm,
					ids.length,
				),
				danger: true,
			} );
			if ( ! ok ) {
				return;
			}
		}
		try {
			const result = await action.run( ids, actionCtx );
			if ( result === false ) {
				return;
			}
		} catch ( err ) {
			// eslint-disable-next-line no-console
			console.error(
				`[posts-window] bulk action "${ action.id }" failed`,
				err,
			);
		}
		table.clearSelection();
		await refresh();
	};

	// --- Cross-window broadcast ------------------------------------------

	const broadcastUnsubs: Array< () => void > = [];
	if ( window.wp?.desktop && typeof window.wp.desktop.subscribe === 'function' ) {
		const onChange = ( payload: unknown ): void => {
			const detail = payload as { source?: string } | null;
			// Skip our own emissions — `handleBulkTrash` already
			// re-fetches, no need to double-load.
			if ( detail?.source === 'posts-window' ) {
				return;
			}
			void refresh();
		};
		broadcastUnsubs.push(
			window.wp.desktop.subscribe( 'desktop-mode.post.changed', onChange ),
		);
		// Term-change subscription. The category picker caches the
		// full tree per window-open (`_categoryTreePromise`); without
		// invalidation, terms created from the mindmap or terms tab
		// don't appear when the user reopens a picker for another
		// post — the user has to F5.
		//
		// Clearing the cache alone wasn't enough: existing cells had
		// already set `picker.items` from the stale tree. Their
		// breadcrumb chains rebuild from `picker.items`, so a
		// freshly-created category wasn't draggable from any cell
		// (the chain literally couldn't render a segment for an id
		// the picker didn't know about). We now also push the fresh
		// tree to every live picker.
		const onTermChange = ( payload: unknown ): void => {
			const detail = payload as { taxonomy?: string } | null;
			if ( detail?.taxonomy === 'category' ) {
				clearCategoryTreeCache();
				broadcastFreshCategoryTreeToPickers( client );
			}
		};
		broadcastUnsubs.push(
			window.wp.desktop.subscribe(
				'desktop-mode.term.changed',
				onTermChange,
			),
		);
	}

	// --- Column visibility (kebab "Show columns" sub-section) -----------

	const repaintColumns = (): void => {
		// Re-derive the column list against the current OS Settings
		// snapshot AND the latest filter-option lists, blow away the
		// cell-cache so newly visible cells build fresh DOM, and
		// reassign `table.columns` (the table component's own setter
		// triggers a re-render).
		cellCache.clear();
		table.columns = buildColumns( cellCache, client, filterData );
	};

	// Authors load once — sites with >100 active authors are rare
	// enough that a single REST call covers the dropdown.
	void client.fetchAuthorOptions().then( ( authors ) => {
		filterData.authors = authors;
		repaintColumns();
	} );

	// Tags load page-by-page. Most sites fit comfortably in the first
	// page; the multiselect's `wpd-multiselect-load-more` event
	// drives subsequent pages when the user scrolls deep in the
	// dropdown. We track the last-fetched page + the total so the
	// load-more handler can short-circuit once we're caught up.
	let tagPage = 0;
	let tagTotalPages = 1;
	let tagFetching = false;
	const TAG_PAGE_SIZE = 50;
	const fetchNextTagPage = async (): Promise< void > => {
		if ( tagFetching || tagPage >= tagTotalPages ) {
			return;
		}
		tagFetching = true;
		try {
			const next = tagPage + 1;
			const res = await client.fetchTagOptions( next, TAG_PAGE_SIZE );
			tagPage = next;
			tagTotalPages = Math.max( tagTotalPages, res.totalPages || next );
			const seen = new Set( filterData.tags.map( ( t ) => t.id ) );
			for ( const item of res.items ) {
				if ( ! seen.has( item.id ) ) {
					filterData.tags.push( item );
					seen.add( item.id );
				}
			}
			filterData.tagsHasMore = tagPage < tagTotalPages;
			repaintColumns();
		} finally {
			tagFetching = false;
		}
	};
	filterData.loadMoreTags = () => {
		void fetchNextTagPage();
	};
	// Kick off the first tag page in the background.
	void fetchNextTagPage();

	const teardownKebabColumns = mountKebabColumnToggles(
		body,
		cellCache,
		repaintColumns,
		client,
	);

	// Repaint when any OS Settings change lands — covers the user
	// toggling the columns themselves, AND covers an external save
	// from another tab updating the snapshot (the OS Settings
	// subscriber fires after every persist).
	let unsubOsSettings: ( () => void ) | null = null;
	if (
		window.wp?.desktop &&
		typeof window.wp.desktop.subscribeOsSettings === 'function'
	) {
		let lastHidden = JSON.stringify(
			Array.from( getHiddenColumns() ).sort(),
		);
		unsubOsSettings = window.wp.desktop.subscribeOsSettings( () => {
			const next = JSON.stringify(
				Array.from( getHiddenColumns() ).sort(),
			);
			if ( next === lastHidden ) {
				// Snapshot changed but the column-visibility slice
				// didn't — e.g. user toggled the wallpaper. Skip the
				// repaint to avoid an unnecessary cache wipe.
				return;
			}
			lastHidden = next;
			repaintColumns();
			// Re-paint the menu's checked state so an external change
			// (another window, another tab) is reflected.
			teardownKebabColumns?.refresh();
		} );
	}

	// --- Lifecycle --------------------------------------------------------

	const onWindowClosed = ( e: Event ): void => {
		const detail = ( e as CustomEvent< { windowId?: string } > ).detail;
		if ( detail?.windowId !== 'desktop-mode-posts' ) {
			return;
		}
		document.removeEventListener( 'desktop-mode-window-closed', onWindowClosed );
		for ( const unsub of broadcastUnsubs ) {
			try {
				unsub();
			} catch {
				/* swallow */
			}
		}
		broadcastUnsubs.length = 0;
		teardownKebabColumns?.dispose();
		unsubOsSettings?.();
		catsTeardown?.();
		catsTeardown = null;
		tagsTeardown?.();
		tagsTeardown = null;
		if ( view.searchDebounce !== null ) {
			window.clearTimeout( view.searchDebounce );
			view.searchDebounce = null;
		}
		// Drop the category tree cache so the next open re-fetches
		// (categories created / renamed elsewhere show up without an F5).
		clearCategoryTreeCache();
	};
	document.addEventListener( 'desktop-mode-window-closed', onWindowClosed );

	// Await the first fetch so the shell's loading overlay stays up
	// until rows are painted. Subsequent refreshes (search, sort,
	// pagination) toggle the table's own `loading` skeleton and do
	// NOT keep the shell overlay visible — that's the right
	// behaviour: the window IS ready, we're just refreshing.
	await refresh();

	// Fire the lifecycle action AFTER the first paint so plugin
	// subscribers can read live data (selection, current params)
	// and call `ctx.refresh()` against a populated table.
	const hooks = window.wp?.hooks;
	if ( hooks && typeof hooks.doAction === 'function' ) {
		hooks.doAction( HOOK_ACTION_OPENED, ctx );
	}
	document.dispatchEvent(
		new CustomEvent( 'desktop-mode-posts-window-opened', {
			detail: ctx,
		} ),
	);
}

/**
 * Build a `<wpd-button>` for a registered bulk action. Wires the
 * confirm prompt + `run()` invocation behind the click handler so
 * the click-handling logic doesn't leak into `renderPostsWindow`
 * (otherwise every plugin-defined action would need a dedicated
 * `data-` selector + branch in the body click delegation).
 */
function buildBulkActionButton(
	action: BulkAction,
	ctx: PostsWindowContext,
): HTMLElement {
	const btn = document.createElement( 'wpd-button' );
	btn.setAttribute( 'variant', action.variant ?? 'secondary' );
	btn.setAttribute( 'data-desktop-mode-posts-bulk-action', action.id );

	if ( action.icon ) {
		const icon = document.createElement( 'span' );
		icon.className = `dashicons ${ action.icon }`;
		icon.setAttribute( 'aria-hidden', 'true' );
		btn.appendChild( icon );
	}

	btn.appendChild( document.createTextNode( ' ' + action.label ) );

	btn.addEventListener( 'click', () => {
		void runBulkActionFor( action, ctx );
	} );
	return btn;
}

// Module-level dispatcher used by `buildBulkActionButton`. The actual
// runner closes over per-render state (refresh, table) so it lives
// inside `renderPostsWindow`; this function is just the thin
// indirection that binds the action's identity to the runner that
// the closure published last. Multiple opens overwrite each other —
// only one window instance is ever live at a time.
let activeRunBulkAction: ( action: BulkAction, ctx: PostsWindowContext ) => Promise< void > = async () => {};

async function runBulkActionFor(
	action: BulkAction,
	ctx: PostsWindowContext,
): Promise< void > {
	await activeRunBulkAction( action, ctx );
}

/**
 * Open an arbitrary admin URL as a chromeless iframe window. Mirrors
 * the path the global link interceptor takes for `<a>` clicks at the
 * shell level — but the table cell anchors live inside the wpd-table
 * shadow DOM, where retargeting hides them from `closest('a[href]')`,
 * so we hand the URL to the window manager directly.
 */
function openAdminUrl(
	url: string,
	opts: { title?: string; icon?: string } = {},
): void {
	const api = window.wp?.desktop;
	if ( ! api || ! api.windowManager || ! api.deriveWindowId ) {
		// As a last resort: navigate the whole tab. This should
		// virtually never happen — the shell exposes both APIs at
		// boot — but a `window.location.href` fallback is far less
		// surprising than a silently-dropped click.
		window.location.href = url;
		return;
	}
	const id = api.deriveWindowId( url );
	api.windowManager.open( {
		id,
		baseId: id,
		url,
		title: opts.title ?? url,
		icon: opts.icon ?? 'dashicons-admin-generic',
	} );
}

/**
 * Map a column key to the REST `orderby` value. Most map 1:1; the
 * exceptions (and future additions) live here so the mapping is in
 * one place.
 */
function mapColumnToOrderby( key: string ): string {
	switch ( key ) {
		case 'title':
			return 'title';
		case 'author':
			return 'author';
		case 'date':
			return 'date';
		case 'modified':
			return 'modified';
		case 'comments':
			return 'comment_count';
		default:
			return 'date';
	}
}

const registry = ( window.desktopModeNativeWindows ??
	( window.desktopModeNativeWindows = {} ) ) as Record<
	string,
	RenderCallback | undefined
>;
// Returning the `Promise` from `renderPostsWindow` is what holds the
// shell's WP-logo loading overlay up until the first fetch lands —
// the shell awaits whatever `render?.(body)` returns in
// `src/native-windows.ts`. The `RenderCallback` global type is
// `(body) => void`, but TypeScript allows void-typed callbacks to
// return any value; the runtime contract is what matters here.
registry[ 'desktop-mode-posts' ] = ( body: HTMLElement ) => {
	const client = createPostsWindowClient( 'desktop-mode-posts' );
	// Cast through `unknown` so the Record's `void`-returning member
	// type still accepts the Promise without forcing every consumer
	// (recycle-bin et al.) to widen their declaration.
	return renderPostsWindow( body, client ).catch( ( err ) => {
		// eslint-disable-next-line no-console
		console.error( '[posts-window] render failed:', err );
	} ) as unknown as void;
};

// Pages window — same render path with a Pages-scoped client so
// `client.getConfig()` reads the Pages config blob. Mode-driven
// branches inside `renderPostsWindow` (column set, intro slug,
// taxonomy-tab binding) gate the post-type-specific behavior.
registry[ 'desktop-mode-pages' ] = ( body: HTMLElement ) => {
	const client = createPostsWindowClient( 'desktop-mode-pages' );
	return renderPostsWindow( body, client ).catch( ( err ) => {
		// eslint-disable-next-line no-console
		console.error( '[pages-window] render failed:', err );
	} ) as unknown as void;
};

// Users window — different REST shape (`/wp/v2/users`), different
// columns, different bulk actions. Lives in its own renderer
// (`./users-render`) rather than wedging a third branch into
// `renderPostsWindow` — keeps the post-row code path untouched.
registry[ 'desktop-mode-users' ] = ( body: HTMLElement ) => {
	const client = createUsersWindowClient( 'desktop-mode-users' );
	return import( './users-render' )
		.then( ( m ) => m.renderUsersWindow( body, client ) )
		.catch( ( err ) => {
			// eslint-disable-next-line no-console
			console.error( '[users-window] render failed:', err );
		} ) as unknown as void;
};

// User Edit window — singleton native window opened by row
// clicks in the Users table (or the URL remap for `user-edit.php
// ?user_id=N` / `profile.php`). The template is just a
// `<wpd-user-profile>` element; this render shell resolves the
// target user id from the shared store (with a fallback to the
// viewer's own id) and sets the `user-id` attribute on the
// component. Subsequent target changes flip the same attribute,
// triggering an in-place re-mount.
registry[ 'desktop-mode-user-edit' ] = ( body: HTMLElement ) => {
	const profile = body.querySelector(
		'wpd-user-profile[data-wpd-user-profile-host]',
	) as HTMLElement | null;
	if ( ! profile ) {
		return;
	}
	void import( './user-edit-target' ).then( ( target ) => {
		const pending = target.readUserEditTarget();
		let userId = pending.userId && pending.userId > 0 ? pending.userId : 0;
		if ( userId <= 0 ) {
			try {
				userId =
					( window as unknown as {
						desktopModeWindowConfig?: Record<
							string,
							{ currentUserId?: number }
						>;
					} ).desktopModeWindowConfig?.[ 'desktop-mode-user-edit' ]
						?.currentUserId ?? 0;
			} catch {
				userId = 0;
			}
		}
		if ( userId > 0 ) {
			profile.setAttribute( 'user-id', String( userId ) );
		}
		target.clearUserEditTarget();

		target.subscribeUserEditTarget( ( next ) => {
			if ( ! profile.isConnected ) {
				return;
			}
			if (
				next.userId &&
				next.userId > 0 &&
				next.userId !== userId
			) {
				userId = next.userId;
				profile.setAttribute( 'user-id', String( userId ) );
				target.clearUserEditTarget();
			}
		} );
	} );
};

