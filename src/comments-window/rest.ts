/**
 * Native Comments window — REST helpers.
 *
 * Thin wrappers over `wp.os.fetch` (aka `trackedFetch`) so the
 * window's loading spinner + the activity bus get the request
 * attribution they need.
 *
 * @public
 */

import { trackedFetch } from '../tracked-fetch';
import type {
	BulkAction,
	CommentCounts,
	CommentRow,
	CommentTab,
	CommentsConfig,
} from './types';

/**
 * `tab` → wp/v2/comments `status` mapping. The bundle's tab vocabulary
 * differs from core's (`pending` ≠ `hold` to the human eye), so we
 * keep one translation point.
 *
 * **Single values only.** `wp/v2/comments` declares `status` as a
 * `string` with `sanitize_key`, which silently STRIPS commas rather
 * than erroring — so a comma list like `approve,hold,spam` reaches
 * `WP_Comment_Query` as the nonsense status `approveholdspam`, which
 * compiles to `comment_approved = 'approveholdspam'` and returns an
 * empty list with a 200. Use the vocabulary `WP_Comment_Query`
 * actually understands:
 *
 *   - `hold`    — pending only.
 *   - `approve` — approved only.
 *   - `all`     — approved + pending (NOT spam/trash).
 *   - `any`     — every status, spam and trash included.
 */
function statusForTab( tab: CommentTab ): string {
	switch ( tab ) {
		case 'pending':
			return 'hold';
		case 'all':
			// Approved *and* pending. `approve` alone made the "All"
			// tab hide every unmoderated comment — including on the
			// per-post scoped view, which opens on this tab precisely
			// to show the post's whole thread.
			return 'all';
		case 'spam':
			return 'spam';
		case 'trash':
			return 'trash';
		case 'mine':
			// 'Mine' is "every status the viewer authored on"; the
			// author id filter is applied below.
			return 'any';
	}
}

export interface ListParams {
	tab: CommentTab;
	page: number;
	perPage: number;
	search?: string;
	currentUserId: number;
	/** Scope the list to one post (the `edit-comments.php?p=` filter). */
	post?: number;
	/**
	 * Return only top-level comments (`parent=0`). The rail lists
	 * conversations, so it asks the server for roots rather than
	 * client-filtering a mixed page — otherwise a page whose rows
	 * happen to all be replies renders an empty rail while the badge
	 * still counts them.
	 */
	rootsOnly?: boolean;
}

export interface ListResult {
	rows: CommentRow[];
	total: number;
	totalPages: number;
}

let activeWindowId = 'desktop-mode-comments';
export function setActiveWindowId( id: string ): void {
	activeWindowId = id;
}

let activeConfig: CommentsConfig | null = null;
export function setActiveConfig( config: CommentsConfig | null ): void {
	activeConfig = config;
}
export function getActiveConfig(): CommentsConfig | null {
	return activeConfig;
}

function authHeaders( cfg: CommentsConfig ): Record< string, string > {
	return {
		'X-WP-Nonce': cfg.restNonce,
		'Content-Type': 'application/json',
	};
}

/**
 * List comments for the given tab + page.
 *
 * @param cfg    Window config.
 * @param params Pagination + filter params.
 */
export async function fetchComments(
	cfg: CommentsConfig,
	params: ListParams,
): Promise< ListResult > {
	const url = new URL( cfg.commentsUrl );
	const qa = cfg.queryArgs ?? {};
	Object.entries( qa ).forEach( ( [ k, v ] ) => {
		if ( k === 'status' ) {
			return;
		}
		if ( Array.isArray( v ) ) {
			v.forEach( ( item ) => url.searchParams.append( k, String( item ) ) );
		} else if ( v !== null && v !== undefined ) {
			url.searchParams.set( k, String( v ) );
		}
	} );
	url.searchParams.set( 'status', statusForTab( params.tab ) );
	url.searchParams.set( 'page', String( params.page ) );
	url.searchParams.set( 'per_page', String( params.perPage ) );
	if ( params.search && params.search.trim() !== '' ) {
		url.searchParams.set( 'search', params.search.trim() );
	}
	if ( params.tab === 'mine' && params.currentUserId > 0 ) {
		url.searchParams.set( 'author', String( params.currentUserId ) );
	}
	if ( params.post && params.post > 0 ) {
		url.searchParams.set( 'post', String( params.post ) );
	}
	if ( params.rootsOnly ) {
		// `parent` maps to `parent__in` server-side; `[0]` is a
		// non-empty array so the `comment_parent IN (0)` clause is
		// applied (an omitted `parent` defaults to `[]` = no clause).
		url.searchParams.set( 'parent', '0' );
	}

	const response = await trackedFetch(
		url.toString(),
		{
			method: 'GET',
			credentials: 'same-origin',
			headers: authHeaders( cfg ),
		},
		{
			windowId: activeWindowId,
			source: 'desktop-mode/comments/list',
		},
	);

	if ( ! response.ok ) {
		throw new Error( `Comments list failed: ${ response.status }` );
	}

	const rows = ( await response.json() ) as CommentRow[];
	const total = parseInt(
		response.headers.get( 'X-WP-Total' ) ?? String( rows.length ),
		10,
	);
	const totalPages = parseInt(
		response.headers.get( 'X-WP-TotalPages' ) ?? '1',
		10,
	);
	return { rows, total, totalPages };
}

/**
 * Fields the conversation pane actually renders for a thread message.
 *
 * Narrower than the window's default `_fields`: the rail needs
 * `open_station_replies_count` (one `get_comments()` COUNT per row) and
 * `open_station_post_title`, a thread message does not. At up to 100
 * rows per thread that per-row cost is the difference between one
 * cheap query and a hundred.
 */
const THREAD_FIELDS = [
	'id',
	'post',
	'parent',
	'author',
	'author_name',
	'author_avatar_urls',
	'date_gmt',
	'content',
	'status',
	'open_station_post_title',
	'open_station_post_link',
	'open_station_can_edit',
	'open_station_can_moderate',
].join( ',' );

/**
 * Fetch every comment on a post (all depths, all statuses) so the
 * conversation pane can build the full nested tree client-side.
 *
 * One round trip: `status=any` is the vocabulary `WP_Comment_Query`
 * understands for "no status clause at all" (see {@link statusForTab}),
 * so a spam or trashed reply still renders in context. `status` is a
 * protected collection param requiring `edit_posts` — the cap this
 * window is already gated on.
 */
export async function fetchThread(
	cfg: CommentsConfig,
	postId: number,
): Promise< CommentRow[] > {
	const url = new URL( cfg.commentsUrl );
	const qa = cfg.queryArgs ?? {};
	Object.entries( qa ).forEach( ( [ k, v ] ) => {
		// `status` / `parent` / `_fields` are all set explicitly below —
		// inheriting the rail's would filter replies-of-replies out and
		// drag the per-row computed fields along for the ride.
		if ( k === 'status' || k === 'parent' || k === '_fields' ) {
			return;
		}
		if ( Array.isArray( v ) ) {
			v.forEach( ( item ) => url.searchParams.append( k, String( item ) ) );
		} else if ( v !== null && v !== undefined ) {
			url.searchParams.set( k, String( v ) );
		}
	} );
	url.searchParams.set( 'post', String( postId ) );
	url.searchParams.set( 'per_page', '100' );
	url.searchParams.set( 'orderby', 'date' );
	url.searchParams.set( 'order', 'asc' );
	url.searchParams.set( 'status', 'any' );
	url.searchParams.set( '_fields', THREAD_FIELDS );

	const response = await trackedFetch(
		url.toString(),
		{
			method: 'GET',
			credentials: 'same-origin',
			headers: authHeaders( cfg ),
		},
		{
			windowId: activeWindowId,
			source: 'desktop-mode/comments/thread',
		},
	);
	if ( ! response.ok ) {
		throw new Error( `Thread fetch failed: ${ response.status }` );
	}
	const rows = ( await response.json() ) as CommentRow[];

	// `orderby=date` already returns oldest-first, but the tree build
	// downstream relies on sibling order being chronological, so make
	// that a property of this function rather than of the query args.
	return rows
		.slice()
		.sort(
			( a, b ) =>
				Date.parse( a.date_gmt + 'Z' ) - Date.parse( b.date_gmt + 'Z' ),
		);
}

/** Approve / spam / trash / etc. bulk in one round trip. */
export async function bulkModerate(
	cfg: CommentsConfig,
	ids: number[],
	action: BulkAction,
): Promise< { processed: number[]; skipped: number[]; counts: CommentCounts } > {
	const response = await trackedFetch(
		cfg.bulkUrl,
		{
			method: 'POST',
			credentials: 'same-origin',
			headers: authHeaders( cfg ),
			body: JSON.stringify( { ids, action } ),
		},
		{
			windowId: activeWindowId,
			source: `desktop-mode/comments/bulk/${ action }`,
		},
	);

	if ( ! response.ok ) {
		throw new Error( `Bulk action ${ action } failed: ${ response.status }` );
	}
	return ( await response.json() ) as {
		processed: number[];
		skipped: number[];
		counts: CommentCounts;
	};
}

/** Update a comment's body. */
export async function updateCommentContent(
	cfg: CommentsConfig,
	id: number,
	content: string,
): Promise< CommentRow > {
	const url = `${ cfg.commentsUrl }/${ id }`;
	const response = await trackedFetch(
		url,
		{
			method: 'POST',
			credentials: 'same-origin',
			headers: authHeaders( cfg ),
			body: JSON.stringify( { content } ),
		},
		{
			windowId: activeWindowId,
			source: 'desktop-mode/comments/edit',
		},
	);
	if ( ! response.ok ) {
		throw new Error( `Comment edit failed: ${ response.status }` );
	}
	return ( await response.json() ) as CommentRow;
}

/** Post an inline reply. */
export async function postReply(
	cfg: CommentsConfig,
	parentId: number,
	content: string,
): Promise< { id: number; parent: number; content: string; date_gmt: string; author: string; avatarUrl: string } > {
	const response = await trackedFetch(
		cfg.replyUrl,
		{
			method: 'POST',
			credentials: 'same-origin',
			headers: authHeaders( cfg ),
			body: JSON.stringify( { parent: parentId, content } ),
		},
		{
			windowId: activeWindowId,
			source: 'desktop-mode/comments/reply',
		},
	);
	if ( ! response.ok ) {
		throw new Error( `Reply failed: ${ response.status }` );
	}
	return ( await response.json() ) as {
		id: number;
		parent: number;
		content: string;
		date_gmt: string;
		author: string;
		avatarUrl: string;
	};
}

/** Light-weight counts ping — feeds the per-tab count chips. */
export async function fetchCounts(
	cfg: CommentsConfig,
): Promise< CommentCounts > {
	const response = await trackedFetch(
		cfg.countsUrl,
		{
			method: 'GET',
			credentials: 'same-origin',
			headers: authHeaders( cfg ),
		},
		{
			windowId: activeWindowId,
			source: 'desktop-mode/comments/counts',
			silent: true,
		},
	);
	if ( ! response.ok ) {
		throw new Error( `Counts failed: ${ response.status }` );
	}
	return ( await response.json() ) as CommentCounts;
}
