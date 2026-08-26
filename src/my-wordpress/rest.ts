/**
 * My WordPress — REST glue.
 *
 * Reads the bundle's localized config via the standard
 * `openstation_register_window` config delivery channel, and wraps
 * `trackedFetch` so every request feeds the window's title-bar
 * activity indicator.
 */

import { __ } from '../i18n';
import { joinRestUrl } from '../rest-url';
import { trackedFetch } from '../tracked-fetch';
import type {
	EntityDetail,
	EntityListItem,
	ListResult,
	MyWordPressConfig,
	MyWordPressEntity,
	UserFootprint,
	UserListItem,
	UserListResult,
} from './types';

declare global {
	interface Window {
		openStationWindowConfig?: Record< string, unknown >;
	}
}

const WINDOW_ID = 'desktop-mode-my-wordpress';

export function getConfig(): MyWordPressConfig {
	const store = window.openStationWindowConfig;
	const cfg = store
		? ( store[ WINDOW_ID ] as MyWordPressConfig | undefined )
		: undefined;
	if ( ! cfg ) {
		throw new Error(
			'[desktop-mode-my-wordpress] config blob missing — was the window opened without registration?',
		);
	}
	return cfg;
}

/**
 * The site's own name — this window's title and its breadcrumb root.
 *
 * The desktop holds objects, not a mention of the OS you're already
 * standing in, so the folder of a site's content is named after the
 * site. The fallback only fires for a config blob that predates the
 * server sending `siteName`.
 */
export function getSiteName(): string {
	return getConfig().siteName?.trim() || __( 'WordPress', 'desktop-mode' );
}

export function getEntity( id: string ): MyWordPressEntity | undefined {
	return getConfig().entities.find( ( e ) => e.id === id );
}

function buildUrl( path: string ): string {
	return joinRestUrl( getConfig().restRoot, path );
}

async function shellFetch(
	input: RequestInfo,
	init: RequestInit,
): Promise< Response > {
	return trackedFetch( input, init, {
		windowId: WINDOW_ID,
		source: 'desktop-mode/my-wordpress',
	} );
}

interface ListParams {
	page: number;
	perPage: number;
	/**
	 * Optional server-side search query. Passed verbatim to the WP
	 * REST endpoint via `?search=…`, which runs a LIKE against the
	 * collection's indexed columns (`post_title` + `post_content` for
	 * posts; see the per-fetcher comments below for the others).
	 */
	search?: string;
	/**
	 * Optional `AbortSignal` so callers can cancel a stale page-fetch
	 * when the user types a new search query before the previous
	 * round-trip lands.
	 */
	signal?: AbortSignal;
}

export async function fetchEntityList(
	entity: MyWordPressEntity,
	params: ListParams,
): Promise< ListResult > {
	const cfg = getConfig();
	const url = new URL( buildUrl( entity.restPath ) );
	url.searchParams.set( 'page', String( params.page ) );
	url.searchParams.set( 'per_page', String( params.perPage ) );
	// Sections can widen the field list via `listFields` — anything
	// not named here is stripped from the response by
	// `rest_filter_response_fields()` before the bundle sees it.
	url.searchParams.set(
		'_fields',
		[
			'id',
			'title',
			'excerpt',
			'date',
			'status',
			'featured_media',
			'link',
			'openstation_lock',
			'_links',
			'_embedded',
			...( entity.listFields ?? [] ),
		].join( ',' ),
	);
	url.searchParams.set( '_embed', 'wp:featuredmedia' );
	// Section-declared markers, so a server-side query filter can tell
	// a site-window request from any other REST caller's.
	for ( const [ key, value ] of Object.entries( entity.listQuery ?? {} ) ) {
		url.searchParams.set( key, value );
	}
	// Surface drafts/private/pending so authors see their unpublished
	// content too. Endpoint enforces `edit_posts` for non-publish
	// statuses, so unauthorized users still only see what they can
	// read.
	url.searchParams.set( 'status', 'publish,future,draft,pending,private' );
	if ( params.search ) {
		url.searchParams.set( 'search', params.search );
	}

	const response = await shellFetch( url.toString(), {
		method: 'GET',
		credentials: 'same-origin',
		headers: {
			'X-WP-Nonce': cfg.restNonce,
			Accept: 'application/json',
		},
		signal: params.signal,
	} );

	if ( ! response.ok ) {
		throw new Error(
			await readErrorMessage( response, 'Failed to load list' ),
		);
	}

	const items = ( await response.json() ) as EntityListItem[];
	const total = Number( response.headers.get( 'X-WP-Total' ) ?? items.length );
	const totalPages = Number(
		response.headers.get( 'X-WP-TotalPages' ) ?? 1,
	);
	return { items, total, totalPages };
}

export async function fetchEntityDetail(
	entity: MyWordPressEntity,
	id: number,
): Promise< EntityDetail > {
	const cfg = getConfig();
	const url = new URL( buildUrl( `${ entity.restPath }/${ id }` ) );
	// `editUrl` and the section's own `listFields` ride the detail
	// request too — the row-supplied editor URL (the HPOS escape
	// hatch, see `EntityListItem.editUrl`) has to reach the preview
	// pane's "Open in editor" button, not just the list tiles.
	url.searchParams.set(
		'_fields',
		[
			'id,title,content,excerpt,date,modified,status,link,author,featured_media,categories,tags,comment_status,openstation_contributors,openstation_attached_media,editUrl,_links,_embedded',
			...( entity.listFields ?? [] ),
		].join( ',' ),
	);
	url.searchParams.set( '_embed', 'author,wp:term,wp:featuredmedia,replies' );

	const response = await shellFetch( url.toString(), {
		method: 'GET',
		credentials: 'same-origin',
		headers: {
			'X-WP-Nonce': cfg.restNonce,
			Accept: 'application/json',
		},
	} );

	if ( ! response.ok ) {
		throw new Error(
			await readErrorMessage( response, 'Failed to load entry' ),
		);
	}
	return ( await response.json() ) as EntityDetail;
}

export async function trashEntity(
	entity: MyWordPressEntity,
	id: number,
): Promise< void > {
	const cfg = getConfig();
	const url = buildUrl( `${ entity.restPath }/${ id }` );
	const response = await shellFetch( url, {
		method: 'DELETE',
		credentials: 'same-origin',
		headers: {
			'X-WP-Nonce': cfg.restNonce,
			Accept: 'application/json',
		},
	} );
	if ( ! response.ok ) {
		throw new Error(
			await readErrorMessage( response, 'Failed to move to trash' ),
		);
	}
}

/**
 * Fields a bulk edit needs to read before it can write.
 *
 * Categories and tags are ADDITIVE in WordPress's own bulk edit — the
 * terms you pick are added to whatever each post already has, never
 * replacing them. The REST API only takes the full array, so we have
 * to know the current one per post. `sticky` and `comment_status`
 * come along because the modal pre-reads nothing else about them.
 */
export interface EntityBulkFields {
	id: number;
	categories?: number[];
	tags?: number[];
	sticky?: boolean;
	comment_status?: string;
	author?: number;
}

/**
 * Read the taxonomy + flag state for a set of entries in ONE request.
 *
 * A post type that has no categories or tags simply omits those keys
 * from the response, which is how the bulk-edit modal decides whether
 * to render those controls at all — no separate capability probe.
 */
export async function fetchEntityBulkFields(
	entity: MyWordPressEntity,
	ids: readonly number[],
): Promise< EntityBulkFields[] > {
	if ( ids.length === 0 ) {
		return [];
	}
	const cfg = getConfig();
	const read = async ( context: 'edit' | 'view' ): Promise< Response > => {
		const url = new URL( buildUrl( entity.restPath ) );
		url.searchParams.set( 'include', ids.join( ',' ) );
		url.searchParams.set(
			'per_page',
			String( Math.min( ids.length, 100 ) ),
		);
		url.searchParams.set( 'context', context );
		url.searchParams.set(
			'_fields',
			'id,categories,tags,sticky,comment_status,author',
		);
		url.searchParams.set(
			'status',
			'publish,future,draft,pending,private',
		);
		return shellFetch( url.toString(), {
			method: 'GET',
			credentials: 'same-origin',
			headers: {
				'X-WP-Nonce': cfg.restNonce,
				Accept: 'application/json',
			},
		} );
	};

	// `context=edit` carries `sticky` and `comment_status`, but the
	// collection endpoint refuses it outright for a viewer who may not
	// edit the post type at all. Fall back to the view context rather
	// than failing the whole bulk edit: the taxonomy merge only needs
	// `categories` / `tags`, which come back either way, and any field
	// the viewer may not write is rejected per-row at write time
	// anyway.
	let response = await read( 'edit' );
	if ( response.status === 401 || response.status === 403 ) {
		response = await read( 'view' );
	}
	if ( ! response.ok ) {
		throw new Error(
			await readErrorMessage( response, 'Failed to read entries' ),
		);
	}
	return ( await response.json() ) as EntityBulkFields[];
}

/**
 * Patch one entry. WordPress's REST API takes POST for updates (not
 * PATCH), which is what core's own editor sends.
 */
export async function updateEntity(
	entity: MyWordPressEntity,
	id: number,
	body: Record< string, unknown >,
): Promise< void > {
	const cfg = getConfig();
	const response = await shellFetch(
		buildUrl( `${ entity.restPath }/${ id }` ),
		{
			method: 'POST',
			credentials: 'same-origin',
			headers: {
				'X-WP-Nonce': cfg.restNonce,
				Accept: 'application/json',
				'Content-Type': 'application/json',
			},
			body: JSON.stringify( body ),
		},
	);
	if ( ! response.ok ) {
		throw new Error(
			await readErrorMessage( response, 'Failed to update entry' ),
		);
	}
}

/** One term as the bulk-edit pickers need it. */
export interface TermOption {
	id: number;
	name: string;
	parent: number;
}

/**
 * Load a taxonomy's terms for the bulk-edit pickers. Capped at 100 —
 * the pickers are for choosing, not for browsing a folksonomy, and
 * the tag input has its own search-as-you-type path for the tail.
 */
export async function fetchTaxonomyTerms(
	taxonomy: 'categories' | 'tags',
	search = '',
): Promise< TermOption[] > {
	const cfg = getConfig();
	const url = new URL( buildUrl( `wp/v2/${ taxonomy }` ) );
	url.searchParams.set( 'per_page', '100' );
	url.searchParams.set( '_fields', 'id,name,parent' );
	url.searchParams.set( 'orderby', 'name' );
	url.searchParams.set( 'order', 'asc' );
	if ( search ) {
		url.searchParams.set( 'search', search );
	}
	const response = await shellFetch( url.toString(), {
		method: 'GET',
		credentials: 'same-origin',
		headers: {
			'X-WP-Nonce': cfg.restNonce,
			Accept: 'application/json',
		},
	} );
	if ( ! response.ok ) {
		return [];
	}
	const rows = ( await response.json() ) as Array< {
		id: number;
		name: string;
		parent?: number;
	} >;
	return rows.map( ( r ) => ( {
		id: r.id,
		name: r.name,
		parent: r.parent ?? 0,
	} ) );
}

/** Create a tag by name, returning its id. Used by the tag input. */
export async function createTag( name: string ): Promise< TermOption | null > {
	const cfg = getConfig();
	const response = await shellFetch( buildUrl( 'wp/v2/tags' ), {
		method: 'POST',
		credentials: 'same-origin',
		headers: {
			'X-WP-Nonce': cfg.restNonce,
			Accept: 'application/json',
			'Content-Type': 'application/json',
		},
		body: JSON.stringify( { name } ),
	} );
	if ( ! response.ok ) {
		return null;
	}
	const row = ( await response.json() ) as { id: number; name: string };
	return { id: row.id, name: row.name, parent: 0 };
}

/** Users who can be assigned as an author. */
export async function fetchAuthors(): Promise<
	Array< { id: number; name: string } >
	> {
	const cfg = getConfig();
	const url = new URL( buildUrl( 'wp/v2/users' ) );
	url.searchParams.set( 'per_page', '100' );
	url.searchParams.set( '_fields', 'id,name' );
	url.searchParams.set( 'orderby', 'name' );
	url.searchParams.set( 'order', 'asc' );
	// `who=authors` is deprecated in favour of a capability query;
	// asking for the edit context keeps the list to users the viewer
	// may actually assign.
	url.searchParams.set( 'context', 'view' );
	const response = await shellFetch( url.toString(), {
		method: 'GET',
		credentials: 'same-origin',
		headers: {
			'X-WP-Nonce': cfg.restNonce,
			Accept: 'application/json',
		},
	} );
	if ( ! response.ok ) {
		return [];
	}
	return ( await response.json() ) as Array< { id: number; name: string } >;
}

/** Patch a user (role changes). */
export async function updateUser(
	id: number,
	body: Record< string, unknown >,
): Promise< void > {
	const cfg = getConfig();
	const response = await shellFetch( buildUrl( `wp/v2/users/${ id }` ), {
		method: 'POST',
		credentials: 'same-origin',
		headers: {
			'X-WP-Nonce': cfg.restNonce,
			Accept: 'application/json',
			'Content-Type': 'application/json',
		},
		body: JSON.stringify( body ),
	} );
	if ( ! response.ok ) {
		throw new Error(
			await readErrorMessage( response, 'Failed to update user' ),
		);
	}
}

/**
 * Delete a user.
 *
 * WordPress has no trash for users, so the REST endpoint requires
 * `force=true` — and it requires an answer to "what happens to their
 * content": omit `reassign` and every post they wrote is deleted with
 * them; pass a user id and it is attributed to that user instead.
 * Core's own delete screen asks exactly this question, and so does
 * ours.
 */
export async function deleteUser(
	id: number,
	reassign: number | null,
): Promise< void > {
	const cfg = getConfig();
	const url = new URL( buildUrl( `wp/v2/users/${ id }` ) );
	url.searchParams.set( 'force', 'true' );
	url.searchParams.set(
		'reassign',
		reassign === null ? 'false' : String( reassign ),
	);
	const response = await shellFetch( url.toString(), {
		method: 'DELETE',
		credentials: 'same-origin',
		headers: {
			'X-WP-Nonce': cfg.restNonce,
			Accept: 'application/json',
		},
	} );
	if ( ! response.ok ) {
		throw new Error(
			await readErrorMessage( response, 'Failed to delete user' ),
		);
	}
}

async function readErrorMessage(
	response: Response,
	fallback: string,
): Promise< string > {
	let message = `${ response.status } ${ response.statusText || fallback }`;
	try {
		const json = ( await response.json() ) as { message?: string };
		if ( json && typeof json.message === 'string' ) {
			message = json.message;
		}
	} catch {
		// Non-JSON body, use the status line.
	}
	return message;
}

/**
 * Cheap "how many entries does this entity have" probe — fetches
 * page 1 with `per_page=1` and reads `X-WP-Total` off the response.
 * One round-trip, smallest possible payload (a single id field).
 *
 * Per-kind tweaks:
 *
 *   - `post`-shaped collections include drafts/pending/private in
 *     the count by passing `status=publish,future,…`.
 *   - `user`-shaped collections skip `status` (rejected as 400 by
 *     `/wp/v2/users`) and add `who=authors` as a fallback when the
 *     viewer doesn't have `list_users` — that's the only way to
 *     get a non-empty total for non-admin viewers.
 *
 * @public
 */
export async function fetchEntityTotal(
	entity: MyWordPressEntity,
): Promise< number > {
	const cfg = getConfig();
	const buildRequestUrl = ( withWho: boolean ): string => {
		const url = new URL( buildUrl( entity.restPath ) );
		url.searchParams.set( 'page', '1' );
		url.searchParams.set( 'per_page', '1' );
		url.searchParams.set( '_fields', 'id' );
		if ( entity.kind === 'user' ) {
			if ( withWho ) {
				url.searchParams.set( 'who', 'authors' );
			}
		} else if ( entity.kind === 'media' ) {
			// Attachments live under `status=inherit` — passing the
			// post-status list above 400s on `wp/v2/media`.
			url.searchParams.set( 'status', 'inherit' );
		} else {
			url.searchParams.set( 'status', 'publish,future,draft,pending,private' );
		}
		return url.toString();
	};

	const send = ( target: string ): Promise< Response > =>
		shellFetch( target, {
			method: 'GET',
			credentials: 'same-origin',
			headers: {
				'X-WP-Nonce': cfg.restNonce,
				Accept: 'application/json',
			},
		} );

	let response = await send( buildRequestUrl( false ) );
	if ( response.status === 403 && entity.kind === 'user' ) {
		response = await send( buildRequestUrl( true ) );
	}
	if ( ! response.ok ) {
		throw new Error( await readErrorMessage( response, 'Failed to count' ) );
	}
	// Drain the body so the connection can be reused.
	await response.json().catch( () => null );
	const raw = response.headers.get( 'X-WP-Total' );
	const n = raw ? Number( raw ) : NaN;
	return Number.isFinite( n ) ? n : 0;
}

/**
 * Paged fetch of `/wp/v2/users` rows with the `openstation_summary`
 * REST field pulled in. Pagination via `X-WP-Total` / `X-WP-TotalPages`
 * matches the post list shape.
 *
 * The endpoint has two distinct access modes:
 *
 *   - `context=edit` — returns role + registration data, requires
 *     `list_users` (admins). 403 for everyone else.
 *   - `who=authors`  — returns only users who have authored a post,
 *     without `list_users` (open to authors / editors / etc.). The
 *     accepted enum for `who` is `'authors'` only; passing any
 *     other value (including `'all'`) yields a 400.
 *
 * We try `context=edit` first and fall back to `who=authors` on a
 * 403. The `openstation_summary` REST field gates its own private
 * bits internally, so the fall-through doesn't leak data.
 *
 * @public
 */
export async function fetchUserList(
	entity: MyWordPressEntity,
	params: {
		page: number;
		perPage: number;
		/**
		 * Optional search query. Passed verbatim to `/wp/v2/users` as
		 * `?search=…`, which matches against user_login, user_nicename,
		 * user_email, user_url, and display_name.
		 */
		search?: string;
		signal?: AbortSignal;
	},
): Promise< UserListResult > {
	const cfg = getConfig();
	const buildRequestUrl = ( mode: 'edit' | 'authors' ): string => {
		const url = new URL( buildUrl( entity.restPath ) );
		url.searchParams.set( 'page', String( params.page ) );
		url.searchParams.set( 'per_page', String( params.perPage ) );
		// Same `listFields` contract the post-shaped fetcher honours:
		// a section serving user-shaped rows from its own route (the
		// WooCommerce Customers list) carries extra payloads, and
		// `rest_filter_response_fields()` strips anything not named
		// here before the bundle ever sees it.
		url.searchParams.set(
			'_fields',
			[
				'id',
				'name',
				'slug',
				'description',
				'link',
				'avatar_urls',
				'openstation_summary',
				...( entity.listFields ?? [] ),
			].join( ',' ),
		);
		url.searchParams.set( 'orderby', 'name' );
		url.searchParams.set( 'order', 'asc' );
		// Section-declared markers, so a server-side query filter can
		// tell a site-window request from any other REST caller's.
		for ( const [ key, value ] of Object.entries( entity.listQuery ?? {} ) ) {
			url.searchParams.set( key, value );
		}
		if ( mode === 'edit' ) {
			url.searchParams.set( 'context', 'edit' );
		} else {
			url.searchParams.set( 'who', 'authors' );
		}
		if ( params.search ) {
			url.searchParams.set( 'search', params.search );
		}
		return url.toString();
	};

	const send = ( target: string ): Promise< Response > =>
		shellFetch( target, {
			method: 'GET',
			credentials: 'same-origin',
			headers: {
				'X-WP-Nonce': cfg.restNonce,
				Accept: 'application/json',
			},
			signal: params.signal,
		} );

	let response = await send( buildRequestUrl( 'edit' ) );
	if ( response.status === 403 ) {
		response = await send( buildRequestUrl( 'authors' ) );
	}

	if ( ! response.ok ) {
		throw new Error( await readErrorMessage( response, 'Failed to load users' ) );
	}

	const items = ( await response.json() ) as UserListItem[];
	const total = Number( response.headers.get( 'X-WP-Total' ) ?? items.length );
	const totalPages = Number(
		response.headers.get( 'X-WP-TotalPages' ) ?? 1,
	);
	return { items, total, totalPages };
}

/**
 * Fetch the per-user footprint payload that powers the right-click
 * "View activity footprint" surface. Single round-trip to
 * `/desktop-mode/v1/user-footprint/<id>`.
 *
 * @public
 */
export function fetchUserFootprint(
	userId: number,
): Promise< UserFootprint > {
	return getJson< UserFootprint >(
		buildUrl( `desktop-mode/v1/user-footprint/${ userId }` ),
	);
}

/**
 * Build the classic admin URL for editing a specific user. Used as
 * a fallback when the `desktop-mode-user-edit` native window isn't
 * registered (legacy / disabled sites). Mirrors `buildEditUrl()`
 * for posts.
 *
 * @public
 */
export function buildEditUserUrl( id: number ): string {
	const cfg = getConfig();
	const base = cfg.editUserUrlBase || cfg.editPostUrlBase;
	const sep = base.includes( '?' ) ? '&' : '?';
	return `${ base }${ sep }user_id=${ encodeURIComponent( String( id ) ) }`;
}

export function buildEditUrl( id: number ): string {
	const cfg = getConfig();
	const base = cfg.editPostUrlBase;
	const sep = base.includes( '?' ) ? '&' : '?';
	return `${ base }${ sep }post=${ encodeURIComponent( String( id ) ) }&action=edit`;
}

/* ---------------------------------------------------------- *
 *  Related-entity fetchers — used by the post detail view
 *  ("Navigate into" → comments / categories / tags / …).
 * ---------------------------------------------------------- */

export interface RelatedUser {
	id: number;
	name: string;
	slug?: string;
	description?: string;
	avatar_urls?: Record< string, string >;
	link?: string;
}

export interface RelatedComment {
	id: number;
	post: number;
	author: number;
	author_name: string;
	author_avatar_urls?: Record< string, string >;
	date: string;
	content: { rendered: string };
	status: string;
	parent?: number;
}

export interface RelatedTerm {
	id: number;
	name: string;
	slug: string;
	taxonomy: string;
	description?: string;
	count?: number;
	link?: string;
}

export interface RelatedMedia {
	id: number;
	title: { rendered: string };
	source_url: string;
	mime_type: string;
	alt_text?: string;
	date: string;
	media_details?: {
		sizes?: Record< string, { source_url: string } | undefined >;
	};
}

export interface RelatedRevision {
	id: number;
	date: string;
	modified: string;
	author: number;
	title?: { rendered: string };
}

/**
 * Single-revision detail. Loaded lazily when the user selects a
 * revision tile in the right preview pane — keeps the listing
 * fetch lightweight (no content per row) while still letting the
 * pane show the rendered HTML of just-this-revision.
 *
 * @public
 */
export interface RelatedRevisionDetail extends RelatedRevision {
	content?: { rendered: string };
	excerpt?: { rendered: string };
}

async function getJson< T >( url: string ): Promise< T > {
	const cfg = getConfig();
	const response = await shellFetch( url, {
		method: 'GET',
		credentials: 'same-origin',
		headers: {
			'X-WP-Nonce': cfg.restNonce,
			Accept: 'application/json',
		},
	} );
	if ( ! response.ok ) {
		throw new Error( await readErrorMessage( response, 'Failed to load' ) );
	}
	return ( await response.json() ) as T;
}

/**
 * Aggregated user dossier — profile + post/page counts +
 * comments-received / left + recent activity + top categories.
 * Single round-trip to `/desktop-mode/v1/user-stats/<id>`.
 *
 * @public
 */
export interface UserStats {
	profile: {
		id: number;
		name: string;
		description: string;
		link: string;
		website: string;
		avatarUrl: string;
		email?: string;
		username?: string;
		registered?: string;
		roles?: string[];
		roleLabels?: string[];
	};
	counts: {
		posts: {
			publish: number;
			draft: number;
			pending: number;
			private: number;
			future: number;
			total: number;
		};
		pages: {
			publish: number;
			draft: number;
			total: number;
		};
		commentsReceived: number;
		commentsLeft: number;
		cpt: number;
	};
	recent: Array< {
		id: number;
		title: string;
		date: string;
		status: string;
		type: string;
		link: string;
	} >;
	topTerms: Array< {
		id: number;
		name: string;
		slug: string;
		taxonomy: string;
		count: number;
	} >;
	activity: Array< { ym: string; count: number } >;
	milestones: {
		firstPublished: string | null;
		lastPublished: string | null;
	};
}

export function fetchUserStats( id: number ): Promise< UserStats > {
	return getJson< UserStats >( buildUrl( `desktop-mode/v1/user-stats/${ id }` ) );
}

/**
 * Aggregated category / tag dossier — matches the shape the
 * `openstation/v1/term-stats/<taxonomy>/<id>` endpoint returns.
 *
 * @public
 */
export interface TermStats {
	profile: {
		id: number;
		name: string;
		slug: string;
		taxonomy: string;
		taxonomyLabel: string;
		description: string;
		link: string;
		parent: number;
		parentName?: string;
		storedCount: number;
	};
	counts: {
		posts: {
			publish: number;
			draft: number;
			pending: number;
			private: number;
			future: number;
			total: number;
		};
		commentsReceived: number;
		distinctAuthors: number;
	};
	recent: Array< {
		id: number;
		title: string;
		date: string;
		status: string;
		type: string;
		link: string;
		author: {
			id: number;
			name: string;
			avatarUrl: string;
		} | null;
	} >;
	topAuthors: Array< {
		userId: number;
		userName: string;
		userAvatarUrl: string;
		count: number;
	} >;
	coTerms: Array< {
		id: number;
		name: string;
		slug: string;
		count: number;
	} >;
	activity: Array< { ym: string; count: number } >;
	milestones: {
		firstPosted: string | null;
		lastPosted: string | null;
	};
}

export function fetchTermStats(
	taxonomy: string,
	id: number,
): Promise< TermStats > {
	const slug = taxonomy.replace( /[^a-zA-Z0-9_-]/g, '' );
	return getJson< TermStats >(
		buildUrl( `desktop-mode/v1/term-stats/${ slug }/${ id }` ),
	);
}

/**
 * Aggregated comment dossier — matches the
 * `/desktop-mode/v1/comment-stats/<id>` endpoint shape.
 *
 * @public
 */
export interface CommentStats {
	comment: {
		id: number;
		parent: number;
		date: string;
		status: string;
		rendered: string;
		rendered_raw: string;
		editLink: string;
		type?: string;
		ip?: string;
		userAgent?: string;
		karma?: number;
	};
	author: {
		name: string;
		url: string;
		avatarUrl: string;
		userId: number;
		email?: string;
		displayName?: string;
		profileLink?: string;
		totalApprovedComments: number;
	};
	post: {
		id: number;
		title: string;
		link: string;
		editLink: string;
		status: string;
		type: string;
		date: string;
		author: {
			id: number;
			name: string;
			avatarUrl: string;
		} | null;
	} | null;
	parent: {
		id: number;
		authorName: string;
		date: string;
		excerpt: string;
	} | null;
	replies: Array< {
		id: number;
		authorName: string;
		avatarUrl: string;
		date: string;
		excerpt: string;
		status: string;
	} >;
}

export function fetchCommentStats(
	id: number,
): Promise< CommentStats > {
	return getJson< CommentStats >(
		buildUrl( `desktop-mode/v1/comment-stats/${ id }` ),
	);
}

export function fetchUser( id: number ): Promise< RelatedUser > {
	return getJson< RelatedUser >(
		buildUrl( `wp/v2/users/${ id }?context=edit&_fields=id,name,slug,description,avatar_urls,link` ),
	);
}

export function fetchComments(
	postId: number,
): Promise< RelatedComment[] > {
	return getJson< RelatedComment[] >(
		buildUrl(
			`wp/v2/comments?post=${ postId }&per_page=100&_fields=id,post,author,author_name,author_avatar_urls,date,content,status,parent`,
		),
	);
}

export function fetchTerms(
	taxonomy: 'categories' | 'tags',
	ids: number[],
): Promise< RelatedTerm[] > {
	if ( ids.length === 0 ) {
		return Promise.resolve( [] );
	}
	return getJson< RelatedTerm[] >(
		buildUrl(
			`wp/v2/${ taxonomy }?include=${ ids.join( ',' ) }&per_page=100&_fields=id,name,slug,taxonomy,description,count,link`,
		),
	);
}

export function fetchAttachedMedia(
	postId: number,
): Promise< RelatedMedia[] > {
	return getJson< RelatedMedia[] >(
		buildUrl(
			`wp/v2/media?parent=${ postId }&per_page=100&_fields=id,title,source_url,mime_type,alt_text,date,media_details`,
		),
	);
}

/**
 * Batch-fetch media records by id. Used by the post detail view's
 * "Attached media" sub-folder, which combines media surfaced through
 * three different routes (featured image, `parent=postId`, and IDs
 * referenced from inside the post content). Single REST round-trip.
 *
 * @public
 */
export function fetchMediaByIds(
	ids: number[],
): Promise< RelatedMedia[] > {
	const unique = Array.from( new Set( ids.filter( ( id ) => id > 0 ) ) );
	if ( unique.length === 0 ) {
		return Promise.resolve( [] );
	}
	return getJson< RelatedMedia[] >(
		buildUrl(
			`wp/v2/media?include=${ unique.join( ',' ) }&per_page=${ unique.length }&_fields=id,title,source_url,mime_type,alt_text,date,media_details`,
		),
	);
}

export function fetchFeaturedMedia(
	id: number,
): Promise< RelatedMedia > {
	return getJson< RelatedMedia >(
		buildUrl(
			`wp/v2/media/${ id }?_fields=id,title,source_url,mime_type,alt_text,date,media_details`,
		),
	);
}

export function fetchRevisions(
	entity: MyWordPressEntity,
	postId: number,
): Promise< RelatedRevision[] > {
	return getJson< RelatedRevision[] >(
		buildUrl(
			`${ entity.restPath }/${ postId }/revisions?_fields=id,date,modified,author,title`,
		),
	);
}

/**
 * Fetch a single revision with rendered content. Lazy — only
 * called when the user selects a revision tile in the sub-list.
 * The listing fetch above stays cheap (title + date only).
 *
 * @public
 */
export function fetchRevision(
	entity: MyWordPressEntity,
	postId: number,
	revisionId: number,
): Promise< RelatedRevisionDetail > {
	return getJson< RelatedRevisionDetail >(
		buildUrl(
			`${ entity.restPath }/${ postId }/revisions/${ revisionId }?_fields=id,date,modified,author,title,content,excerpt`,
		),
	);
}
