/**
 * My WordPress — REST glue.
 *
 * Reads the bundle's localized config via the standard
 * `desktop_mode_register_window` config delivery channel, and wraps
 * `trackedFetch` so every request feeds the window's title-bar
 * activity indicator.
 *
 * @since 0.8.0
 */

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
		desktopModeWindowConfig?: Record< string, unknown >;
	}
}

const WINDOW_ID = 'desktop-mode-my-wordpress';

export function getConfig(): MyWordPressConfig {
	const store = window.desktopModeWindowConfig;
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
}

export async function fetchEntityList(
	entity: MyWordPressEntity,
	params: ListParams,
): Promise< ListResult > {
	const cfg = getConfig();
	const url = new URL( buildUrl( entity.restPath ) );
	url.searchParams.set( 'page', String( params.page ) );
	url.searchParams.set( 'per_page', String( params.perPage ) );
	url.searchParams.set(
		'_fields',
		'id,title,excerpt,date,featured_media,link,desktop_mode_lock,_links,_embedded',
	);
	url.searchParams.set( '_embed', 'wp:featuredmedia' );
	// Surface drafts/private/pending so authors see their unpublished
	// content too. Endpoint enforces `edit_posts` for non-publish
	// statuses, so unauthorized users still only see what they can
	// read.
	url.searchParams.set( 'status', 'publish,future,draft,pending,private' );

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
	url.searchParams.set(
		'_fields',
		'id,title,content,excerpt,date,modified,status,link,author,featured_media,categories,tags,comment_status,desktop_mode_contributors,_links,_embedded',
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
 * @since 0.8.0
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
 * Paged fetch of `/wp/v2/users` rows with the `desktop_mode_summary`
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
 * 403. The `desktop_mode_summary` REST field gates its own private
 * bits internally, so the fall-through doesn't leak data.
 *
 * @public
 * @since 0.20.0
 */
export async function fetchUserList(
	entity: MyWordPressEntity,
	params: { page: number; perPage: number },
): Promise< UserListResult > {
	const cfg = getConfig();
	const buildRequestUrl = ( mode: 'edit' | 'authors' ): string => {
		const url = new URL( buildUrl( entity.restPath ) );
		url.searchParams.set( 'page', String( params.page ) );
		url.searchParams.set( 'per_page', String( params.perPage ) );
		url.searchParams.set(
			'_fields',
			'id,name,slug,description,link,avatar_urls,desktop_mode_summary',
		);
		url.searchParams.set( 'orderby', 'name' );
		url.searchParams.set( 'order', 'asc' );
		if ( mode === 'edit' ) {
			url.searchParams.set( 'context', 'edit' );
		} else {
			url.searchParams.set( 'who', 'authors' );
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
 * @since 0.20.0
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
 * @since 0.20.0
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
 * @since 0.8.0
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
 * @since 0.8.0
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
 * `desktop_mode/v1/term-stats/<taxonomy>/<id>` endpoint returns.
 *
 * @public
 * @since 0.8.0
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
 * @since 0.8.0
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
 * @since 0.8.0
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
 * @since 0.8.0
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
