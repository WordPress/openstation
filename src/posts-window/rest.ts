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
 * @public
 * @since 0.8.0
 */

import { trackedFetch } from '../tracked-fetch';

declare global {
	interface Window {
		desktopModeWindowConfig?: Record< string, unknown >;
	}
}

export interface PostsWindowConfig {
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
}

/**
 * Active edit-lock holder for a row, surfaced via the
 * `desktop_mode_lock` REST field registered in
 * `includes/my-wordpress/lock.php`. `null` when the row isn't
 * locked, when the requester lacks edit caps, or when the
 * requester is the lock holder.
 *
 * @since 0.8.0
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
	comment_status: 'open' | 'closed';
	excerpt?: { rendered: string; protected?: boolean };
	desktop_mode_lock?: PostListItemLock | null;
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
	/**
	 * One or more author user ids. Multiple values are sent comma-
	 * joined (`?author=1,2`) — core's REST endpoint treats the list
	 * as a union (posts whose author is ANY of the listed users).
	 */
	author?: number | number[];
	/**
	 * One or more tag term ids. Multiple values are sent comma-
	 * joined (`?tags=1,2`) — core's REST endpoint treats the list
	 * as an intersection (posts that carry EVERY listed tag).
	 */
	tag?: number | number[];
}

export interface TrashResult {
	id: number;
	ok: boolean;
	error?: string;
}

const WINDOW_ID = 'desktop-mode-posts';

/**
 * Read the localized config blob. The window registers via PHP's
 * `desktop_mode_register_window( …, [ 'config' => [ … ] ] )` which
 * lands the data on `window.desktopModeWindowConfig[ <id> ]`. We
 * read it lazily so consumers don't fail at import time when the
 * bundle is loaded outside the window's lifecycle (tests, etc.).
 */
export function getConfig(): PostsWindowConfig {
	const store = window.desktopModeWindowConfig;
	const cfg = store ? ( store[ WINDOW_ID ] as PostsWindowConfig | undefined ) : undefined;
	if ( ! cfg ) {
		throw new Error(
			'[desktop-mode-posts] config blob is missing — was the window opened ' +
				'without registration? See `desktop_mode_register_window()` in ' +
				'`includes/posts-window/window.php`.',
		);
	}
	return cfg;
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
 * Resolve the fetch implementation. Prefers `wp.desktop.fetch` when
 * the shell exposes it (so every Posts-window REST call lights up
 * the window's title-bar activity indicator); falls back to native
 * `fetch` for tests / non-shell hosts. The third arg attributes the
 * request to the Posts native window so concurrent operations from
 * other windows don't fight for the same indicator.
 *
 * @internal
 */
function shellFetch( input: RequestInfo, init?: RequestInit ): Promise< Response > {
	return trackedFetch( input, init, { windowId: 'desktop-mode-posts' } );
}

async function request< T >(
	url: string,
	init: RequestOptions = {},
): Promise< RequestResult< T > > {
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
}

/**
 * Fetch a page of posts.
 *
 * Pagination headers (`X-WP-Total`, `X-WP-TotalPages`) are surfaced on
 * the response so the table footer can show "Page N of M · T posts"
 * without a second count query.
 *
 * @since 0.8.0
 */
export async function fetchPosts(
	params: PostsListParams = {},
): Promise< PostsListResponse > {
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

	const { data, headers } = await request< PostListItem[] >( url.toString(), {
		method: 'GET',
	} );

	return {
		items: Array.isArray( data ) ? data : [],
		total: parseInt( headers.get( 'X-WP-Total' ) ?? '0', 10 ) || 0,
		totalPages: parseInt( headers.get( 'X-WP-TotalPages' ) ?? '0', 10 ) || 0,
	};
}

/**
 * Move a single post to the trash. Errors are caught and returned in
 * the result so a bulk caller can keep going on partial failures.
 *
 * Posts that are already in the trash status `DELETE` *without* `force`
 * would be hard-deleted by core. Callers should gate trash actions on
 * `row.status !== 'trash'` to avoid accidental hard deletes.
 *
 * @since 0.8.0
 */
export async function trashPost( id: number ): Promise< TrashResult > {
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
}

/**
 * Build the editor URL for a given post id.
 */
export function buildEditPostUrl( id: number ): string {
	const cfg = getConfig();
	const sep = cfg.editPostUrlBase.includes( '?' ) ? '&' : '?';
	return `${ cfg.editPostUrlBase }${ sep }post=${ id }&action=edit`;
}

// ---------------------------------------------------------------------------
// Tag (post_tag taxonomy) CRUD — drives the inline `<wpd-tag-input>` in
// the Tags column. Three building blocks:
//
//   1. searchTags( query )    → autocomplete the popover
//   2. createTag( name )      → produce a fresh term server-side
//   3. updatePostTags( id, ids ) → persist the new set of tag ids on a post
//
// The bundle calls them in sequence: when the user picks an existing
// suggestion → updatePostTags. When the user picks "Create '…'" →
// createTag → updatePostTags. Errors flow back to the column render
// closure, which rolls back the optimistic UI and surfaces a toast.
// ---------------------------------------------------------------------------

/** REST shape of a tag (`/wp/v2/tags`). */
export interface TagTerm {
	id: number;
	name: string;
	slug: string;
	count?: number;
	link?: string;
}

/**
 * Fetch tag suggestions matching `query`. Empty `query` returns the
 * 20 most-popular tags (core's default order is `count desc`), which
 * is the "what should I add?" affordance the user gets when they
 * click + with an empty input.
 *
 * @since 0.8.0
 */
export async function searchTags(
	query: string,
	signal?: AbortSignal,
): Promise< TagTerm[] > {
	const cfg = getConfig();
	const url = new URL( `${ cfg.restRoot.replace( /\/$/, '' ) }/wp/v2/tags` );
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
}

/**
 * Create a new tag with the given name. Idempotent against duplicate
 * names — core returns the existing term's id with a `term_exists`
 * code, which we recover from rather than treating as an error so
 * the user can keep typing.
 *
 * Requires `manage_categories` (or filterable `assign_terms`) for
 * the tag taxonomy. Callers should gate the `creatable` flag on the
 * window-config side; we don't second-guess here.
 *
 * @since 0.8.0
 */
export async function createTag( name: string ): Promise< TagTerm > {
	const cfg = getConfig();
	const url = `${ cfg.restRoot.replace( /\/$/, '' ) }/wp/v2/tags`;
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
		// `request<T>` only throws the message; for the recovery we
		// need to round-trip the JSON body. Fall back to a fresh
		// search when we can't tell what id WordPress would have
		// returned — the user gets the existing term either way.
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
}

/**
 * Replace a post's tag set. The REST `tags` field on `/wp/v2/posts`
 * accepts an array of term ids, so `[]` clears all tags. Returns the
 * persisted post (subset) so callers can reconcile the embedded
 * term list against what the server actually saved.
 *
 * @since 0.8.0
 */
export async function updatePostTags(
	postId: number,
	tagIds: number[],
): Promise< { id: number; tags: number[] } > {
	const cfg = getConfig();
	const url = `${ cfg.postsUrl }/${ postId }`;
	const { data } = await request< { id: number; tags: number[] } >( url, {
		method: 'POST',
		body: JSON.stringify( { tags: tagIds } ),
	} );
	return data;
}

// ---------------------------------------------------------------------------
// Categories — hierarchical taxonomy. Same shape as tags
// (`/wp/v2/categories`) but the picker UI walks the `parent` field
// to render a tree.
// ---------------------------------------------------------------------------

/** REST shape of a category (`/wp/v2/categories`). */
export interface CategoryTerm {
	id: number;
	name: string;
	slug: string;
	parent: number;
	count?: number;
	link?: string;
}

/**
 * Fetch the full categories tree. Used once when the user first
 * opens a category picker; the result is cached at the bundle level
 * (see `getCategoryCache` in `src/posts-window/index.ts`) so every
 * row's picker share one round-trip per window-open. Capped at 100
 * — most sites have far fewer; sites with thousands need a separate
 * server-search-driven flow we can layer later.
 *
 * @since 0.8.0
 */
export async function fetchAllCategories(
	signal?: AbortSignal,
): Promise< CategoryTerm[] > {
	const cfg = getConfig();
	const url = new URL( `${ cfg.restRoot.replace( /\/$/, '' ) }/wp/v2/categories` );
	url.searchParams.set( 'per_page', '100' );
	url.searchParams.set( '_fields', 'id,name,slug,parent' );
	url.searchParams.set( 'orderby', 'name' );
	url.searchParams.set( 'order', 'asc' );
	const { data } = await request< CategoryTerm[] >( url.toString(), {
		method: 'GET',
		signal,
	} );
	return Array.isArray( data ) ? data : [];
}

export interface AuthorOption {
	id: number;
	name: string;
}

/**
 * List the authors who can write posts. Used to populate the Author
 * column's filter dropdown. Capped at 100 — sites with more authors
 * than that should ship a typeahead instead of a select; v1 trades
 * that off for simplicity.
 *
 * `who=authors` filters down to users with `edit_posts`-style caps
 * (matches the same scoping core uses for the classic Posts list's
 * Author select), so a site with hundreds of subscriber accounts
 * won't drown the dropdown in non-author users.
 *
 * @since 0.8.0
 */
export async function fetchAuthorOptions(
	signal?: AbortSignal,
): Promise< AuthorOption[] > {
	const cfg = getConfig();
	const url = new URL( `${ cfg.restRoot.replace( /\/$/, '' ) }/wp/v2/users` );
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
 * Fetch a single page of tag options for the Tag-column filter.
 * Ordered by post count (descending) so the dropdown leads with
 * the tags the user is most likely to filter by; falls back to
 * name-ordered for tags that don't have a count (fresh install).
 *
 * Server pagination — the consumer polls page=2, page=3, … as
 * the user scrolls the popover. `hide_empty` is intentionally OFF
 * so the dropdown lists every tag the user can pick, not just the
 * ones already assigned to a post.
 *
 * @since 0.8.0
 */
export async function fetchTagOptions(
	page: number = 1,
	perPage: number = 50,
	signal?: AbortSignal,
): Promise< TagOptionsPage > {
	const cfg = getConfig();
	const url = new URL( `${ cfg.restRoot.replace( /\/$/, '' ) }/wp/v2/tags` );
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
}

/**
 * Create a new category, optionally as a child of another. Idempotent
 * against duplicate names *under the same parent* — core returns a
 * `term_exists` error with the existing term's id, which we recover
 * from by re-searching for the name and returning the existing
 * record (so the user can keep typing without bumping into a
 * confusing error).
 *
 * Requires `manage_categories`. Callers should gate the inline
 * create button on their own capability check; we don't second-
 * guess here.
 *
 * @since 0.8.0
 */
export async function createCategory(
	name: string,
	parent: number = 0,
	opts: { slug?: string; description?: string } = {},
): Promise< CategoryTerm > {
	const cfg = getConfig();
	const url = `${ cfg.restRoot.replace( /\/$/, '' ) }/wp/v2/categories`;
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
}

/**
 * Notify other parts of the shell that a term was created, updated
 * or deleted. Subscribers (e.g. the post-row category picker, which
 * caches the full tree per window-open) clear their caches so they
 * pick up the change without needing F5.
 *
 * Channel: `desktop-mode.term.changed`. Payload:
 * `{ taxonomy: 'category' | 'post_tag', action, id }`.
 */
function broadcastTermChange(
	taxonomy: 'category' | 'post_tag',
	action: 'created' | 'updated' | 'deleted',
	id: number,
): void {
	const api = (
		window as unknown as {
			wp?: {
				desktop?: {
					broadcast?: (
						channel: string,
						payload: unknown,
					) => void;
				};
			};
		}
	).wp?.desktop;
	if ( api && typeof api.broadcast === 'function' ) {
		api.broadcast( 'desktop-mode.term.changed', {
			source: 'posts-window',
			taxonomy,
			action,
			id,
		} );
	}
}

/**
 * Replace a post's category set. WordPress auto-applies
 * "Uncategorized" server-side when the array is empty, so we don't
 * need to send the term explicitly — passing `[]` is the canonical
 * way to "clear all categories" and inherit the fallback.
 *
 * @since 0.8.0
 */
export async function updatePostCategories(
	postId: number,
	categoryIds: number[],
): Promise< { id: number; categories: number[] } > {
	const cfg = getConfig();
	const url = `${ cfg.postsUrl }/${ postId }`;
	const { data } = await request< { id: number; categories: number[] } >( url, {
		method: 'POST',
		body: JSON.stringify( { categories: categoryIds } ),
	} );
	return data;
}

// ---------------------------------------------------------------------------
// Term management (Categories + Tags tabs)
// ---------------------------------------------------------------------------

/**
 * Common shape for both categories and tags as displayed in the term-
 * management tabs. The `parent` field is `0` for tags (flat taxonomy)
 * and the parent term id for categories.
 *
 * @since 0.8.0
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
	 * `desktop_mode_is_default` REST field). `false` when the field
	 * isn't surfaced (older PHP build) or the term isn't the default.
	 */
	isDefault: boolean;
	// Index signature so `<wpd-table>`'s row constraint
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

/**
 * Page fetcher for either categories or tags. Returns the bare term
 * shape we render in the table (id/name/slug/parent/count/description)
 * plus the X-WP-Total / X-WP-TotalPages totals so the pager + stats
 * strip can show real numbers without re-counting.
 *
 * @since 0.8.0
 */
export async function fetchTerms(
	taxonomy: 'categories' | 'tags',
	params: TermsListParams = {},
): Promise< TermsListPage > {
	const cfg = getConfig();
	const url = new URL(
		`${ cfg.restRoot.replace( /\/$/, '' ) }/wp/v2/${ taxonomy }`,
	);
	url.searchParams.set( 'per_page', String( params.perPage ?? 50 ) );
	url.searchParams.set( 'page', String( params.page ?? 1 ) );
	url.searchParams.set(
		'_fields',
		'id,name,slug,parent,count,description,desktop_mode_count,desktop_mode_is_default',
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
			const anyCount = ( t as { desktop_mode_count?: number } )
				.desktop_mode_count;
			const isDefault = ( t as { desktop_mode_is_default?: boolean } )
				.desktop_mode_is_default === true;
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
		totalPages: parseInt( headers.get( 'X-WP-TotalPages' ) ?? '0', 10 ) || 0,
	};
}

/**
 * Update a term — rename, change slug, change parent (categories only),
 * or rewrite description. Pass only the fields the user changed; core
 * preserves untouched fields.
 *
 * @since 0.8.0
 */
export async function updateTerm(
	taxonomy: 'categories' | 'tags',
	id: number,
	patch: Partial< Pick< TermRow, 'name' | 'slug' | 'description' | 'parent' > >,
): Promise< TermRow > {
	const cfg = getConfig();
	const url = `${ cfg.restRoot.replace( /\/$/, '' ) }/wp/v2/${ taxonomy }/${ id }`;
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
}

/**
 * Force-delete a term. Matches WP core behavior: posts assigned to a
 * deleted category fall through to the "Uncategorized" default
 * automatically (taxonomy default term wiring); tags just disappear
 * from their assigned posts.
 *
 * @since 0.8.0
 */
export async function deleteTerm(
	taxonomy: 'categories' | 'tags',
	id: number,
): Promise< void > {
	const cfg = getConfig();
	const url = new URL(
		`${ cfg.restRoot.replace( /\/$/, '' ) }/wp/v2/${ taxonomy }/${ id }`,
	);
	url.searchParams.set( 'force', 'true' );
	await request( url.toString(), { method: 'DELETE' } );
	broadcastTermChange(
		taxonomy === 'categories' ? 'category' : 'post_tag',
		'deleted',
		id,
	);
}
