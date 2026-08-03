/**
 * Native Posts window — REST glue.
 *
 * Thin wrapper around the framework `trackedFetch` that talks to
 * core's `/wp/v2/posts` endpoint with the WP REST nonce attached.
 * The list endpoint is the canonical paginated source —
 * `X-WP-Total` and `X-WP-TotalPages` response headers give us the
 * total row count and last page number without a separate count
 * query.
 *
 * # Per-window client
 *
 * `createPostsWindowClient(windowId)` returns a {@link PostsWindowClient}
 * bound to one window's localized config blob. Each registry entry
 * in `./index.ts` builds its own client at mount time and threads
 * it into render code through closures. This replaces a
 * module-level `_activeWindowId` singleton, which
 * silently drifted whenever a sibling window opened (notably the
 * Users window opening User-edit) and caused REST calls to read
 * the wrong window's config — observed as
 * "Failed to construct 'URL': Invalid URL" on the Users window's
 * Refresh button. A per-window client makes the wrong-id call
 * structurally impossible.
 *
 * @public
 */

import { joinRestUrl } from '../rest-url';
import { trackedFetch } from '../tracked-fetch';

declare global {
	interface Window {
		openStationWindowConfig?: Record< string, unknown >;
	}
}

export interface PostsWindowConfig {
	/**
	 * Window mode — `'posts'` (default) or `'pages'`. Drives JS-side
	 * branches: which intro dialog to show, whether to bind taxonomy
	 * tabs, the column set, and the {@link introSlug} default. Absent
	 * on older Posts-window configs (treated as
	 * `'posts'`).
	 */
	mode?: 'posts' | 'pages' | 'users';
	/**
	 * Intro-dialog slug — `'posts'` for the canonical Posts window,
	 * `'pages'` for the Pages window, plus any plugin-introduced
	 * variant. Falls back to `mode` (or `'posts'` if `mode` is also
	 * absent) so legacy Posts configs keep working unchanged.
	 */
	introSlug?: string;
	/**
	 * Page id assigned as the static front page (`page_on_front`),
	 * or `0` when the site uses the latest-posts homepage. Pages-mode
	 * only — the title cell paints a "Front page" badge on the row
	 * matching this id.
	 */
	frontPageId?: number;
	/**
	 * Page id assigned as the blog-posts page (`page_for_posts`), or
	 * `0` when unset. Same pattern as {@link frontPageId}.
	 */
	postsPageId?: number;
	/**
	 * `{ slug: label }` map for the active theme's registered page
	 * templates. The Template column reads this to paint friendly
	 * names instead of raw filenames. Falls back to the slug when a
	 * theme registers a template the table doesn't yet know.
	 */
	pageTemplates?: Record< string, string >;
	// ─── Users window only ───────────────────────────────────────────
	/** Viewer can `edit_users`. UI-side flag; server re-checks. */
	canEdit?: boolean;
	/** Viewer can `promote_users` (i.e. show role-change menu). */
	canPromote?: boolean;
	/** Viewer can `create_users` (show "Add new"). */
	canCreate?: boolean;
	/** Viewer can `delete_users` / `remove_users` (show bulk-delete). */
	canDelete?: boolean;
	/** True on multisite (changes the bulk-delete semantics). */
	isMultisite?: boolean;
	/** `{ slug: label }` for roles the viewer can assign (role-change menu). */
	assignableRoles?: Record< string, string >;
	/** `{ slug: label }` for every role on the install (role filter). */
	allRoles?: Record< string, string >;
	/** REST URLs for the Users-window mutation endpoints. */
	bulkRoleUrl?: string;
	bulkDeleteUrl?: string;
	/** Base URL for `/users/<id>/{send-password-reset,resend-welcome}` — id appended client-side. */
	sendResetUrlBase?: string;
	/** REST URL for `POST /desktop-mode/v1/users` (create). */
	createUserUrl?: string;
	/** Available locales: `{ slug: label }`. Empty slug = site default. */
	locales?: Record< string, string >;
	/** Site locale string (e.g. `en_US`) — surfaced for the form's default-locale label. */
	siteLocale?: string;
	/** `default_role` option — used as the fallback when none chosen. */
	defaultRole?: string;
	/** Base REST URL — used to derive sibling endpoints (`/wp/v2/users`, …). */
	restRoot: string;
	/** Nonce for `X-WP-Nonce`. */
	restNonce: string;
	/** Full URL of `/wp/v2/posts`. */
	postsUrl: string;
	/** Base URL for `post.php` — append `?post=<id>&action=edit` to get the editor URL. */
	editPostUrlBase: string;
	/** URL for `post-new.php`. */
	newPostUrl: string;
	/** REST URL for `/wp/v2/users`. */
	usersUrl: string;
	/** Current user id — used to highlight own posts (future). */
	currentUserId: number;
	/** Default page size on cold open. */
	defaultPerPage: number;
	/** Default outbound query args (e.g. `_fields`, `_embed`, `post_type`). */
	queryArgs: Record< string, string >;
	/**
	 * Boot-time snapshot of whether the user has already dismissed the
	 * Posts intro dialog. When false, the bundle shows the dialog the
	 * first time the window opens and POSTs to {@link introUrl} on
	 * dismiss.
	 */
	introSeen: boolean;
	/** REST URL for `POST /desktop-mode/v1/intros/seen`. */
	introUrl: string;
}

/**
 * Active edit-lock holder for a row, surfaced via the
 * `open_station_lock` REST field registered in
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
	/**
	 * Parent post id. `0` for top-level rows. Pages are hierarchical
	 * and surface this via `/wp/v2/pages`; the Posts collection always
	 * returns `0`. Optional so legacy callers don't need to add the
	 * field to their `_fields` whitelist.
	 */
	parent?: number;
	/**
	 * `menu_order` field (also primarily used by Pages). Optional for
	 * the same reason as {@link parent}.
	 */
	menu_order?: number;
	/** URL-friendly slug. Optional — Posts callers may not include it. */
	slug?: string;
	/** Public permalink (front-end view URL). */
	link?: string;
	/**
	 * Page-template slug (`'page-fullwidth.php'`, …) or `''` for the
	 * default. Surfaced on `/wp/v2/pages`; absent on `/wp/v2/posts`.
	 */
	template?: string;
	/**
	 * Comments count for this row, surfaced via the
	 * `open_station_comment_count` REST field registered in
	 * `includes/pages-window/window.php`. Absent for callers that
	 * don't include the field in `_fields`.
	 */
	open_station_comment_count?: number;
	comment_status: 'open' | 'closed';
	excerpt?: { rendered: string; protected?: boolean };
	open_station_lock?: PostListItemLock | null;
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

export interface PostsListResponse {
	items: PostListItem[];
	total: number;
	totalPages: number;
}

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

export interface TrashResult {
	id: number;
	ok: boolean;
	error?: string;
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
 * Common shape for both categories and tags as displayed in the term-
 * management tabs. The `parent` field is `0` for tags (flat taxonomy)
 * and the parent term id for categories.
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
	 * Uncategorized for category; populated server-side via the
	 * `open_station_is_default` REST field). `false` when the field
	 * isn't surfaced (older PHP build) or the term isn't the default.
	 */
	isDefault: boolean;
	// Index signature so `<os-table>`'s row constraint
	// (`Record<string, unknown>`) is satisfied — the table never
	// reads beyond the declared keys, but the type-level constraint
	// is structural.
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

interface RequestOptions extends RequestInit {
	/** Set to `false` to skip `response.json()` (e.g. `DELETE` 200 with no body). */
	expectJson?: boolean;
}

interface RequestResult< T > {
	data: T;
	headers: Headers;
}

/**
 * Per-window REST client. Returned by {@link createPostsWindowClient}
 * and threaded through render code instead of imported as free
 * functions.
 *
 * Every method reads config and attributes its `trackedFetch` call
 * to the client's bound `windowId`, so two windows of the same
 * bundle (Posts + Pages, Users + User-edit) cannot read each
 * other's config or steal each other's title-bar spinner.
 */
export interface PostsWindowClient {
	readonly windowId: string;
	getConfig(): PostsWindowConfig;
	fetchPosts( params?: PostsListParams ): Promise< PostsListResponse >;
	trashPost( id: number ): Promise< TrashResult >;
	buildEditPostUrl( id: number ): string;
	searchTags( query: string, signal?: AbortSignal ): Promise< TagTerm[] >;
	createTag( name: string ): Promise< TagTerm >;
	updatePostTags(
		postId: number,
		tagIds: number[],
	): Promise< { id: number; tags: number[] } >;
	fetchAllCategories( signal?: AbortSignal ): Promise< CategoryTerm[] >;
	fetchAuthorOptions( signal?: AbortSignal ): Promise< AuthorOption[] >;
	fetchTagOptions(
		page?: number,
		perPage?: number,
		signal?: AbortSignal,
	): Promise< TagOptionsPage >;
	createCategory(
		name: string,
		parent?: number,
		opts?: { slug?: string; description?: string },
	): Promise< CategoryTerm >;
	updatePostCategories(
		postId: number,
		categoryIds: number[],
	): Promise< { id: number; categories: number[] } >;
	fetchTerms(
		taxonomy: 'categories' | 'tags',
		params?: TermsListParams,
	): Promise< TermsListPage >;
	fetchTagCooccurrence(
		taxonomy?: 'tags' | 'categories',
		limit?: number,
	): Promise< Map< number, TermNeighbor[] > >;
	updateTerm(
		taxonomy: 'categories' | 'tags',
		id: number,
		patch: Partial< Pick< TermRow, 'name' | 'slug' | 'description' | 'parent' > >,
	): Promise< TermRow >;
	deleteTerm( taxonomy: 'categories' | 'tags', id: number ): Promise< void >;
}

/**
 * One co-occurring sibling term as reported by
 * `/desktop-mode/v1/tag-cooccurrence`. `shared` is the number of
 * posts the two terms share.
 *
 * @public
 */
export interface TermNeighbor {
	id: number;
	shared: number;
}

/**
 * Notify other parts of the shell that a term was created, updated
 * or deleted. Subscribers (e.g. the post-row category picker, which
 * caches the full tree per window-open) clear their caches so they
 * pick up the change without needing F5.
 *
 * Channel: `os.term.changed`. Payload:
 * `{ taxonomy: 'category' | 'post_tag', action, id }`.
 *
 * @internal
 */
function broadcastTermChange(
	taxonomy: 'category' | 'post_tag',
	action: 'created' | 'updated' | 'deleted',
	id: number,
): void {
	const api = (
		window as unknown as {
			wp?: {
				os?: {
					broadcast?: (
						channel: string,
						payload: unknown,
					) => void;
				};
			};
		}
	).wp?.os;
	if ( api && typeof api.broadcast === 'function' ) {
		api.broadcast( 'os.term.changed', {
			source: 'posts-window',
			taxonomy,
			action,
			id,
		} );
	}
}

/**
 * Build a Posts/Pages REST client bound to a single window id.
 *
 * @param windowId The native-window id this client is attached to
 *                 (`'desktop-mode-posts'`, `'desktop-mode-pages'`, …). All
 *                 `getConfig()` reads key off this id, and every fetch is
 *                 attributed to it via `trackedFetch`'s `windowId` option.
 */
export function createPostsWindowClient(
	windowId: string,
): PostsWindowClient {
	const getConfig = (): PostsWindowConfig => {
		const store = window.openStationWindowConfig;
		const cfg = store
			? ( store[ windowId ] as PostsWindowConfig | undefined )
			: undefined;
		if ( ! cfg ) {
			throw new Error(
				`[${ windowId }] config blob is missing — was the window opened ` +
					'without registration? See the matching `open_station_register_window()` ' +
					'call in `includes/{posts,pages}-window/window.php`.',
			);
		}
		return cfg;
	};

	const shellFetch = (
		input: RequestInfo,
		init?: RequestInit,
	): Promise< Response > => {
		return trackedFetch( input, init, { windowId } );
	};

	const request = async < T >(
		url: string,
		init: RequestOptions = {},
	): Promise< RequestResult< T > > => {
		const cfg = getConfig();
		const response = await shellFetch( url, {
			...init,
			credentials: 'same-origin',
			headers: {
				'X-WP-Nonce': cfg.restNonce,
				Accept: 'application/json',
				...( init.body ? { 'Content-Type': 'application/json' } : {} ),
				...( init.headers ?? {} ),
			},
		} );

		if ( ! response.ok ) {
			// Surface WP_Error JSON when present; fall back to the status
			// line otherwise. Either way callers get a thrown Error they
			// can show inline.
			let message = `${ response.status } ${ response.statusText }`;
			try {
				const json = ( await response.json() ) as { message?: string };
				if ( json && typeof json.message === 'string' ) {
					message = json.message;
				}
			} catch {
				// Ignore — non-JSON body, use the status line.
			}
			throw new Error( message );
		}

		const data =
			init.expectJson === false
				? ( null as unknown as T )
				: ( ( await response.json() ) as T );
		return { data, headers: response.headers };
	};

	const fetchPosts = async (
		params: PostsListParams = {},
	): Promise< PostsListResponse > => {
		const cfg = getConfig();
		const url = new URL( cfg.postsUrl );

		// Merge the PHP-declared default query args first (so `_fields`,
		// `_embed`, and a custom `post_type` from the filter all flow through).
		for ( const [ key, value ] of Object.entries( cfg.queryArgs ?? {} ) ) {
			if ( typeof value === 'string' && value !== '' ) {
				url.searchParams.set( key, value );
			}
		}

		if ( params.page ) {
			url.searchParams.set( 'page', String( params.page ) );
		}
		if ( params.perPage ) {
			url.searchParams.set( 'per_page', String( params.perPage ) );
		}
		if ( params.search ) {
			url.searchParams.set( 'search', params.search );
		}
		// `status` quirk: when the param is omitted, core's REST handler
		// defaults to `publish` only — drafts / pending / scheduled /
		// private silently disappear from "All". Send `status=any` for
		// the empty-segment case so the "All" tab actually means *all*
		// the statuses the current user can see (excluding `trash`,
		// which has its own segment).
		if ( params.status ) {
			url.searchParams.set( 'status', params.status );
		} else {
			url.searchParams.set( 'status', 'any' );
		}
		if ( params.orderby ) {
			url.searchParams.set( 'orderby', params.orderby );
		}
		if ( params.order ) {
			url.searchParams.set( 'order', params.order );
		}
		// Both `author` and `tags` REST params are registered as arrays
		// of integers. We send them as `author[]=1&author[]=2` (and
		// `tags[]=...`) — PHP's `parse_str` handles bracketed array
		// notation unambiguously, whereas comma-separated values can be
		// interpreted as a single string by some hosts / security
		// modules / REST middleware that don't run the schema-aware
		// `rest_sanitize_value_from_schema` splitter. Result: WP_Query
		// gets `author__in` / `tag__in` arrays, which are union (OR)
		// semantics — "posts whose author / tag is ANY of these".
		const appendIds = ( key: string, v: number | number[] ): void => {
			const list = Array.isArray( v ) ? v : [ v ];
			for ( const id of list ) {
				if ( Number.isFinite( id ) && id > 0 ) {
					url.searchParams.append( `${ key }[]`, String( id ) );
				}
			}
		};
		if ( params.author ) {
			appendIds( 'author', params.author );
		}
		if ( params.tag ) {
			appendIds( 'tags', params.tag );
		}

		const { data, headers } = await request< PostListItem[] >(
			url.toString(),
			{ method: 'GET' },
		);

		return {
			items: Array.isArray( data ) ? data : [],
			total: parseInt( headers.get( 'X-WP-Total' ) ?? '0', 10 ) || 0,
			totalPages:
				parseInt( headers.get( 'X-WP-TotalPages' ) ?? '0', 10 ) || 0,
		};
	};

	const trashPost = async ( id: number ): Promise< TrashResult > => {
		const cfg = getConfig();
		try {
			await request< unknown >( `${ cfg.postsUrl }/${ id }`, {
				method: 'DELETE',
			} );
			return { id, ok: true };
		} catch ( err ) {
			return {
				id,
				ok: false,
				error: err instanceof Error ? err.message : String( err ),
			};
		}
	};

	const buildEditPostUrl = ( id: number ): string => {
		const cfg = getConfig();
		const sep = cfg.editPostUrlBase.includes( '?' ) ? '&' : '?';
		return `${ cfg.editPostUrlBase }${ sep }post=${ id }&action=edit`;
	};

	const searchTags = async (
		query: string,
		signal?: AbortSignal,
	): Promise< TagTerm[] > => {
		const cfg = getConfig();
		const url = new URL( joinRestUrl( cfg.restRoot, 'wp/v2/tags' ) );
		url.searchParams.set( 'per_page', '20' );
		url.searchParams.set( '_fields', 'id,name,slug,count' );
		url.searchParams.set( 'orderby', 'count' );
		url.searchParams.set( 'order', 'desc' );
		if ( query ) {
			url.searchParams.set( 'search', query );
			url.searchParams.set( 'orderby', 'name' );
			url.searchParams.set( 'order', 'asc' );
		}
		const { data } = await request< TagTerm[] >( url.toString(), {
			method: 'GET',
			signal,
		} );
		return Array.isArray( data ) ? data : [];
	};

	const createTag = async ( name: string ): Promise< TagTerm > => {
		const cfg = getConfig();
		const url = joinRestUrl( cfg.restRoot, 'wp/v2/tags' );
		try {
			const { data } = await request< TagTerm >( url, {
				method: 'POST',
				body: JSON.stringify( { name } ),
			} );
			broadcastTermChange( 'post_tag', 'created', data.id );
			return data;
		} catch ( err ) {
			// Core returns a `term_exists` error with the existing id in
			// `data.term_id` — recover by fetching that term and pretending
			// we just created it. Otherwise re-throw.
			const message = err instanceof Error ? err.message : String( err );
			if ( /term[\s_]?exists/i.test( message ) ) {
				const matches = await searchTags( name );
				const exact = matches.find(
					( t ) => t.name.toLowerCase() === name.toLowerCase(),
				);
				if ( exact ) {
					return exact;
				}
			}
			throw err;
		}
	};

	const updatePostTags = async (
		postId: number,
		tagIds: number[],
	): Promise< { id: number; tags: number[] } > => {
		const cfg = getConfig();
		const url = `${ cfg.postsUrl }/${ postId }`;
		const { data } = await request< { id: number; tags: number[] } >( url, {
			method: 'POST',
			body: JSON.stringify( { tags: tagIds } ),
		} );
		return data;
	};

	const fetchAllCategories = async (
		signal?: AbortSignal,
	): Promise< CategoryTerm[] > => {
		const cfg = getConfig();
		const url = new URL( joinRestUrl( cfg.restRoot, 'wp/v2/categories' ) );
		url.searchParams.set( 'per_page', '100' );
		url.searchParams.set( '_fields', 'id,name,slug,parent' );
		url.searchParams.set( 'orderby', 'name' );
		url.searchParams.set( 'order', 'asc' );
		const { data } = await request< CategoryTerm[] >( url.toString(), {
			method: 'GET',
			signal,
		} );
		return Array.isArray( data ) ? data : [];
	};

	const fetchAuthorOptions = async (
		signal?: AbortSignal,
	): Promise< AuthorOption[] > => {
		const cfg = getConfig();
		const url = new URL( joinRestUrl( cfg.restRoot, 'wp/v2/users' ) );
		url.searchParams.set( 'per_page', '100' );
		url.searchParams.set( 'who', 'authors' );
		url.searchParams.set( '_fields', 'id,name' );
		url.searchParams.set( 'orderby', 'name' );
		url.searchParams.set( 'order', 'asc' );
		try {
			const { data } = await request< AuthorOption[] >( url.toString(), {
				method: 'GET',
				signal,
			} );
			return Array.isArray( data ) ? data : [];
		} catch {
			// Capabilities-gated 401/403 fall through to "no filter
			// dropdown" rather than killing the table render.
			return [];
		}
	};

	const fetchTagOptions = async (
		page: number = 1,
		perPage: number = 50,
		signal?: AbortSignal,
	): Promise< TagOptionsPage > => {
		const cfg = getConfig();
		const url = new URL( joinRestUrl( cfg.restRoot, 'wp/v2/tags' ) );
		url.searchParams.set( 'per_page', String( Math.max( 1, perPage ) ) );
		url.searchParams.set( 'page', String( Math.max( 1, page ) ) );
		url.searchParams.set( '_fields', 'id,name,count' );
		url.searchParams.set( 'orderby', 'count' );
		url.searchParams.set( 'order', 'desc' );
		try {
			const { data, headers } = await request< TagOption[] >(
				url.toString(),
				{ method: 'GET', signal },
			);
			return {
				items: Array.isArray( data ) ? data : [],
				totalPages:
					parseInt( headers.get( 'X-WP-TotalPages' ) ?? '0', 10 ) || 0,
			};
		} catch {
			return { items: [], totalPages: 0 };
		}
	};

	const createCategory = async (
		name: string,
		parent: number = 0,
		opts: { slug?: string; description?: string } = {},
	): Promise< CategoryTerm > => {
		const cfg = getConfig();
		const url = joinRestUrl( cfg.restRoot, 'wp/v2/categories' );
		const body: Record< string, unknown > = { name, parent };
		if ( opts.slug ) {
			body.slug = opts.slug;
		}
		if ( opts.description ) {
			body.description = opts.description;
		}
		try {
			const { data } = await request< CategoryTerm >( url, {
				method: 'POST',
				body: JSON.stringify( body ),
			} );
			broadcastTermChange( 'category', 'created', data.id );
			return data;
		} catch ( err ) {
			const message = err instanceof Error ? err.message : String( err );
			if ( /term[\s_]?exists/i.test( message ) ) {
				// Recover by searching for the name and returning the
				// matching existing term — nicer UX than surfacing the
				// raw "term exists" error to the user.
				const matches = await fetchAllCategories();
				const exact = matches.find(
					( t ) =>
						t.name.toLowerCase() === name.toLowerCase() &&
						t.parent === parent,
				);
				if ( exact ) {
					return exact;
				}
			}
			throw err;
		}
	};

	const updatePostCategories = async (
		postId: number,
		categoryIds: number[],
	): Promise< { id: number; categories: number[] } > => {
		const cfg = getConfig();
		const url = `${ cfg.postsUrl }/${ postId }`;
		const { data } = await request< { id: number; categories: number[] } >(
			url,
			{
				method: 'POST',
				body: JSON.stringify( { categories: categoryIds } ),
			},
		);
		return data;
	};

	const fetchTerms = async (
		taxonomy: 'categories' | 'tags',
		params: TermsListParams = {},
	): Promise< TermsListPage > => {
		const cfg = getConfig();
		const url = new URL( joinRestUrl( cfg.restRoot, `wp/v2/${ taxonomy }` ) );
		url.searchParams.set( 'per_page', String( params.perPage ?? 50 ) );
		url.searchParams.set( 'page', String( params.page ?? 1 ) );
		url.searchParams.set(
			'_fields',
			'id,name,slug,parent,count,description,open_station_count,open_station_is_default',
		);
		url.searchParams.set( 'orderby', params.orderby ?? 'name' );
		url.searchParams.set( 'order', params.order ?? 'asc' );
		if ( params.search ) {
			url.searchParams.set( 'search', params.search );
		}
		if ( typeof params.parent === 'number' && params.parent >= 0 ) {
			url.searchParams.set( 'parent', String( params.parent ) );
		}
		const { data, headers } = await request< Array< Partial< TermRow > > >(
			url.toString(),
			{ method: 'GET' },
		);
		const items: TermRow[] = Array.isArray( data )
			? data.map( ( t ) => {
				// Prefer the any-status count (includes drafts + pending)
				// when the server emits it; fall back to core's `count`
				// for older PHP builds that predate the custom field.
				const anyCount = ( t as { open_station_count?: number } )
					.open_station_count;
				const isDefault =
					( t as { open_station_is_default?: boolean } )
						.open_station_is_default === true;
				return {
					id: ( t.id as number ) ?? 0,
					name: ( t.name as string ) ?? '',
					slug: ( t.slug as string ) ?? '',
					parent: ( t.parent as number ) ?? 0,
					count:
						typeof anyCount === 'number'
							? anyCount
							: ( t.count as number ) ?? 0,
					description: ( t.description as string ) ?? '',
					isDefault,
				};
			} )
			: [];
		return {
			items,
			total: parseInt( headers.get( 'X-WP-Total' ) ?? '0', 10 ) || 0,
			totalPages:
				parseInt( headers.get( 'X-WP-TotalPages' ) ?? '0', 10 ) || 0,
		};
	};

	const fetchTagCooccurrence = async (
		taxonomy: 'tags' | 'categories' = 'tags',
		limit = 8,
	): Promise< Map< number, TermNeighbor[] > > => {
		const cfg = getConfig();
		const url = new URL(
			joinRestUrl(
				cfg.restRoot,
				'desktop-mode/v1/tag-cooccurrence',
			),
		);
		// Server speaks WP taxonomy slugs, not the wp/v2 plural form.
		url.searchParams.set(
			'taxonomy',
			taxonomy === 'tags' ? 'post_tag' : 'category',
		);
		url.searchParams.set( 'limit', String( limit ) );
		const { data } = await request<
			{ pairs?: Record< string, TermNeighbor[] > } | TermNeighbor[]
		>( url.toString(), { method: 'GET' } );
		const out = new Map< number, TermNeighbor[] >();
		const pairs =
			data && typeof data === 'object' && ! Array.isArray( data )
				? data.pairs
				: undefined;
		if ( ! pairs ) {
			return out;
		}
		for ( const [ key, neighbors ] of Object.entries( pairs ) ) {
			const id = parseInt( key, 10 );
			if ( ! Number.isFinite( id ) || id <= 0 ) {
				continue;
			}
			const clean: TermNeighbor[] = [];
			for ( const raw of neighbors ) {
				const nid = Number( raw?.id );
				const sh = Number( raw?.shared );
				if (
					Number.isFinite( nid ) &&
					nid > 0 &&
					Number.isFinite( sh ) &&
					sh > 0
				) {
					clean.push( { id: nid, shared: sh } );
				}
			}
			if ( clean.length > 0 ) {
				out.set( id, clean );
			}
		}
		return out;
	};

	const updateTerm = async (
		taxonomy: 'categories' | 'tags',
		id: number,
		patch: Partial<
			Pick< TermRow, 'name' | 'slug' | 'description' | 'parent' >
		>,
	): Promise< TermRow > => {
		const cfg = getConfig();
		const url = joinRestUrl( cfg.restRoot, `wp/v2/${ taxonomy }/${ id }` );
		const { data } = await request< Partial< TermRow > >( url, {
			method: 'POST',
			body: JSON.stringify( patch ),
		} );
		broadcastTermChange(
			taxonomy === 'categories' ? 'category' : 'post_tag',
			'updated',
			id,
		);
		return {
			id: data.id ?? id,
			name: data.name ?? '',
			slug: data.slug ?? '',
			parent: data.parent ?? 0,
			count: data.count ?? 0,
			description: data.description ?? '',
			isDefault: ( data.isDefault as boolean | undefined ) ?? false,
		};
	};

	const deleteTerm = async (
		taxonomy: 'categories' | 'tags',
		id: number,
	): Promise< void > => {
		const cfg = getConfig();
		const url = new URL(
			joinRestUrl( cfg.restRoot, `wp/v2/${ taxonomy }/${ id }` ),
		);
		url.searchParams.set( 'force', 'true' );
		await request( url.toString(), { method: 'DELETE' } );
		broadcastTermChange(
			taxonomy === 'categories' ? 'category' : 'post_tag',
			'deleted',
			id,
		);
	};

	return {
		windowId,
		getConfig,
		fetchPosts,
		trashPost,
		buildEditPostUrl,
		searchTags,
		createTag,
		updatePostTags,
		fetchAllCategories,
		fetchAuthorOptions,
		fetchTagOptions,
		createCategory,
		updatePostCategories,
		fetchTerms,
		fetchTagCooccurrence,
		updateTerm,
		deleteTerm,
	};
}
