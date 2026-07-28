/**
 * Native Comments window — REST helpers.
 *
 * Thin wrappers over `wp.desktop.fetch` (aka `trackedFetch`) so the
 * window's loading spinner + the activity bus get the request
 * attribution they need.
 *
 * @public
 */

import { trackedFetch } from '../tracked-fetch';
import type {
	AuthorInsights,
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
 */
function statusForTab( tab: CommentTab ): string {
	switch ( tab ) {
		case 'pending':
			return 'hold';
		case 'all':
			return 'approve';
		case 'spam':
			return 'spam';
		case 'trash':
			return 'trash';
		case 'mine':
			// 'Mine' is "all statuses the viewer authored on" — let the
			// server treat it as 'approve,hold,spam'; we filter author
			// id below.
			return 'approve,hold,spam';
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
 * Fetch every comment on a post (all depths) so the conversation pane can
 * build the full nested tree client-side. Unlike {@link fetchReplies} — a
 * single depth — this is one round trip for the whole thread. Drops the
 * `parent` and `status` query args the rail uses so replies-of-replies
 * aren't filtered out.
 */
export async function fetchThread(
	cfg: CommentsConfig,
	postId: number,
): Promise< CommentRow[] > {
	// `wp/v2/comments` rejects a multi-value `status` (400), so pull each
	// visible status in its own request and merge — a moderator wants to
	// see pending replies in context, not just approved ones. `hold` may
	// 401 for a non-moderator, so treat a failed leg as empty rather than
	// failing the whole thread.
	const one = async ( status: string ): Promise< CommentRow[] > => {
		const url = new URL( cfg.commentsUrl );
		const qa = cfg.queryArgs ?? {};
		Object.entries( qa ).forEach( ( [ k, v ] ) => {
			if ( k === 'status' || k === 'parent' ) {
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
		url.searchParams.set( 'status', status );
		try {
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
				return [];
			}
			return ( await response.json() ) as CommentRow[];
		} catch {
			return [];
		}
	};

	// All moderation statuses, so a thread renders in full on every tab
	// (a spam/trash root and its same-status replies included), not just
	// the approved/pending subset.
	const legs = await Promise.all(
		[ 'approve', 'hold', 'spam', 'trash' ].map( ( s ) => one( s ) ),
	);
	const seen = new Set< number >();
	const merged: CommentRow[] = [];
	legs.flat().forEach( ( row ) => {
		if ( ! seen.has( row.id ) ) {
			seen.add( row.id );
			merged.push( row );
		}
	} );
	return merged;
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

/** Fetch the author-insights drawer payload. */
export async function fetchAuthorInsights(
	cfg: CommentsConfig,
	email: string,
): Promise< AuthorInsights > {
	const url = `${ cfg.insightsUrlBase }${ encodeURIComponent( email ) }`;
	const response = await trackedFetch(
		url,
		{
			method: 'GET',
			credentials: 'same-origin',
			headers: authHeaders( cfg ),
		},
		{
			windowId: activeWindowId,
			source: 'desktop-mode/comments/insights',
		},
	);
	if ( ! response.ok ) {
		throw new Error( `Insights failed: ${ response.status }` );
	}
	return ( await response.json() ) as AuthorInsights;
}

/** Light-weight counts ping for the dock badge + "N new" pill. */
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

/** Fetch the replies belonging to a parent (`?parent=`). */
export async function fetchReplies(
	cfg: CommentsConfig,
	parentId: number,
): Promise< CommentRow[] > {
	const url = new URL( cfg.commentsUrl );
	url.searchParams.set( 'parent', String( parentId ) );
	url.searchParams.set( 'per_page', '50' );
	url.searchParams.set( 'orderby', 'date' );
	url.searchParams.set( 'order', 'asc' );
	url.searchParams.set( 'status', 'approve,hold' );

	const response = await trackedFetch(
		url.toString(),
		{
			method: 'GET',
			credentials: 'same-origin',
			headers: authHeaders( cfg ),
		},
		{
			windowId: activeWindowId,
			source: 'desktop-mode/comments/replies',
		},
	);
	if ( ! response.ok ) {
		throw new Error( `Replies fetch failed: ${ response.status }` );
	}
	return ( await response.json() ) as CommentRow[];
}
