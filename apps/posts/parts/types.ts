/**
 * Posts app — the shapes: the REST rows the list renders, the state
 * the `.os.php` declares, and the public extensibility contract
 * plugin authors type their `wp.hooks` callbacks against.
 *
 * The plugin-facing surface is intentionally narrow and unchanged
 * from the legacy window:
 *
 *   - `BulkAction` — items registered into the bulk-actions toolbar
 *     when one or more rows are selected.
 *   - `StatusSegment` — entries in the segmented control above the
 *     table (All / Published / Drafts / …).
 *   - `PostsWindowContext` — the handle handed to `BulkAction.run()`
 *     and to `openstation.postsWindow.opened` subscribers.
 *
 * Columns added via `openstation.postsWindow.columns` reach into
 * `PostListItem`.
 *
 * @public
 */

import type { OsTable } from '../../../src/ui/components/os-table/os-table';

export type PostsMode = 'posts' | 'pages';

/** The declared state — what `parts/query.php` declares. */
export interface ListState extends Record< string, unknown > {
	page: number;
	perPage: number;
	search: string;
	status: string;
	orderby: string;
	order: 'asc' | 'desc';
	author: number[];
	tag: number[];
}

/** What `data()` returns: the current page as the paged-list envelope. */
export interface ListData {
	list: {
		items: PostListItem[];
		total: number;
		pages: number;
		page: number;
		perPage: number;
		error: string;
	};
}

/** What `App::config()` ships once (`ctx.extra`). */
export interface ListExtra {
	mode?: PostsMode;
	editPostUrlBase?: string;
	newPostUrl?: string;
	currentUserId?: number;
	defaultPerPage?: number;
	frontPageId?: number;
	postsPageId?: number;
	pageTemplates?: Record< string, string >;
}

/**
 * Active edit-lock holder for a row, surfaced via the
 * `openstation_lock` REST field registered in
 * `includes/my-wordpress/lock.php`. `null` when the row isn't
 * locked, when the requester lacks edit caps, or when the
 * requester is the lock holder.
 */
export interface PostListItemLock {
	userId: number;
	userName: string;
	userAvatarUrl: string;
	/** ISO-8601 timestamp of the lock heartbeat. */
	time: string;
}

export interface PostListItem {
	id: number;
	title: { rendered: string };
	status: string;
	date: string;
	date_gmt: string;
	modified: string;
	modified_gmt: string;
	author: number;
	categories: number[];
	tags: number[];
	/** Parent post id (`0` for top-level rows). Pages are hierarchical. */
	parent?: number;
	menu_order?: number;
	slug?: string;
	/** Public permalink (front-end view URL). */
	link?: string;
	/** Page-template slug, or `''` for the default. `/wp/v2/pages` only. */
	template?: string;
	/** The `openstation_comment_count` REST field (`page` only). */
	openstation_comment_count?: number;
	comment_status: 'open' | 'closed';
	excerpt?: { rendered: string; protected?: boolean };
	openstation_lock?: PostListItemLock | null;
	_embedded?: {
		author?: Array< {
			id: number;
			name: string;
			avatar_urls?: Record< string, string >;
		} >;
		'wp:term'?: Array<
			Array< {
				id: number;
				name: string;
				taxonomy: string;
				link: string;
			} >
		>;
		'wp:featuredmedia'?: Array< {
			id: number;
			source_url: string;
			alt_text: string;
			media_details?: {
				sizes?: Record< string, { source_url: string } | undefined >;
			};
		} >;
	};
	[ key: string ]: unknown;
}

/** Snapshot of the outbound query — `PostsWindowContext.getCurrentParams()`. */
export interface PostsListParams {
	page?: number;
	perPage?: number;
	search?: string;
	status?: string;
	orderby?: string;
	order?: 'asc' | 'desc';
	author?: number | number[];
	tag?: number | number[];
}

/** REST shape of a tag (`/wp/v2/tags`). */
export interface TagTerm {
	id: number;
	name: string;
	slug: string;
	count?: number;
	link?: string;
}

/** REST shape of a category (`/wp/v2/categories`). */
export interface CategoryTerm {
	id: number;
	name: string;
	slug: string;
	parent: number;
	count?: number;
	link?: string;
}

export interface AuthorOption {
	id: number;
	name: string;
}

export interface TagOption {
	id: number;
	name: string;
	count?: number;
}

export interface TagOptionsPage {
	items: TagOption[];
	totalPages: number;
}

/**
 * Common shape for both categories and tags as displayed in the
 * term canvases. `parent` is `0` for tags and the parent term id for
 * categories.
 */
export interface TermRow {
	id: number;
	name: string;
	slug: string;
	parent: number;
	count: number;
	description: string;
	/**
	 * Whether this term is the taxonomy's default fallback (e.g.
	 * Uncategorized), from the `openstation_is_default` REST field.
	 */
	isDefault: boolean;
	[ key: string ]: unknown;
}

export interface TermsListPage {
	items: TermRow[];
	total: number;
	totalPages: number;
}

export interface TermsListParams {
	page?: number;
	perPage?: number;
	search?: string;
	orderby?: 'name' | 'count' | 'slug' | 'description';
	order?: 'asc' | 'desc';
	parent?: number;
}

/**
 * One co-occurring sibling term as reported by
 * `/desktop-mode/v1/tag-cooccurrence`. `shared` is the number of
 * posts the two terms share.
 */
export interface TermNeighbor {
	id: number;
	shared: number;
}

/**
 * Context object handed to plugin extension points (bulk-action
 * runners, lifecycle subscribers). Stable read API; treat the
 * elements (`body`, `table`) as containers — mutating their
 * descendants outside the documented surface is unsupported.
 */
export interface PostsWindowContext {
	/** The window's body element (the app's mount root). */
	body: HTMLElement;
	/** The `<os-table>` instance the window populates. */
	table: OsTable< PostListItem >;
	/** Re-fetch + re-paint with the current view state. */
	refresh(): Promise< void >;
	/** Currently selected row ids. */
	getSelectedIds(): number[];
	/** Currently selected rows (resolved against the live `table.data`). */
	getSelectedRows(): PostListItem[];
	/** Snapshot of the outbound REST params on the next fetch. */
	getCurrentParams(): PostsListParams;
}

/**
 * A bulk action that appears in the toolbar when one or more rows
 * are selected. The shipped default is "Move to trash"; plugins
 * append/replace via the `openstation.postsWindow.bulkActions`
 * filter.
 */
export interface BulkAction {
	/** Stable id — used as a key, also the `data-os-posts-bulk-action` on the button. */
	id: string;
	label: string;
	/** Optional dashicon class (e.g. `'dashicons-trash'`). */
	icon?: string;
	/** `<os-button>` variant. Defaults to `'secondary'`. */
	variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
	/**
	 * Optional confirmation prompt shown before `run` is invoked. A
	 * function builds the message from the row count — the only form
	 * `_n()` can be used in; a plain string is interpolated with `%d`.
	 */
	confirm?: string | ( ( count: number ) => string );
	/**
	 * Action runner. After it resolves the window clears the selection
	 * and refreshes — return `false` to suppress the auto-refresh.
	 */
	run( ids: number[], ctx: PostsWindowContext ): void | false | Promise< void | false >;
}

/**
 * A status filter segment. `value` is sent verbatim as the REST
 * `?status=…` param; `''` is the "All" sentinel (sent as `any`).
 */
export interface StatusSegment {
	value: string;
	label: string;
}

/**
 * Detail shape of the `os-posts-window-data-loaded` CustomEvent (and
 * the matching `openstation.postsWindow.dataLoaded` hook action).
 */
export interface PostsWindowDataLoadedDetail {
	items: PostListItem[];
	total: number;
	totalPages: number;
	page: number;
}
