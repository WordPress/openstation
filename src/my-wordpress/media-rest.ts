/**
 * My WordPress — REST helpers for the Media section.
 *
 * Two endpoints:
 *
 *   - `wp/v2/media` for the browse-list grid (Core endpoint, no
 *     new server work).
 *   - `desktop-mode/v1/media-usage/<id>` for the drill-in "used
 *     in" rollup.
 *
 * Both route through `trackedFetch` so requests feed the window's
 * loading indicator + the activity bus.
 *
 * @public
 */

import { joinRestUrl } from '../rest-url';
import { trackedFetch } from '../tracked-fetch';
import { getConfig } from './rest';
import type {
	MediaListItem,
	MediaListResult,
	MediaUsage,
	MyWordPressEntity,
} from './types';

const WINDOW_ID = 'desktop-mode-my-wordpress';

function shellFetch(
	input: RequestInfo,
	init: RequestInit,
): Promise< Response > {
	return trackedFetch( input, init, {
		windowId: WINDOW_ID,
		source: 'desktop-mode/my-wordpress',
	} );
}

function buildUrl( path: string ): string {
	return joinRestUrl( getConfig().restRoot, path );
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
		// Non-JSON body — use the status line.
	}
	return message;
}

/**
 * Paged fetch of `/wp/v2/media`. Newest first, with featured-image
 * sized URLs + author embedded so the grid + preview pane can render
 * from a single round-trip per page.
 *
 * @public
 */
export async function fetchMediaPage(
	entity: MyWordPressEntity,
	params: {
		page: number;
		perPage: number;
		/**
		 * Optional search query. Passed verbatim to `/wp/v2/media` as
		 * `?search=…`, which matches attachment titles + filenames.
		 */
		search?: string;
		signal?: AbortSignal;
	},
): Promise< MediaListResult > {
	const cfg = getConfig();
	const url = new URL( buildUrl( entity.restPath ) );
	url.searchParams.set( 'page', String( params.page ) );
	url.searchParams.set( 'per_page', String( params.perPage ) );
	// `post` is the attachment's parent. It costs nothing to ask for
	// and it is what decides whether the Detach action applies to a
	// file — without it here, Detach could never appear.
	url.searchParams.set(
		'_fields',
		'id,title,date,mime_type,source_url,alt_text,caption,description,author,post,media_details,_embedded',
	);
	url.searchParams.set( '_embed', 'author' );
	url.searchParams.set( 'orderby', 'date' );
	url.searchParams.set( 'order', 'desc' );
	// Attachments are stored under `status=inherit`; the default
	// `publish` filter on `wp/v2/media` returns an empty list.
	url.searchParams.set( 'status', 'inherit' );
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
			await readErrorMessage( response, 'Failed to load media' ),
		);
	}

	const items = ( await response.json() ) as MediaListItem[];
	const total = Number( response.headers.get( 'X-WP-Total' ) ?? items.length );
	const totalPages = Number(
		response.headers.get( 'X-WP-TotalPages' ) ?? 1,
	);
	return { items, total, totalPages };
}

/**
 * Fetch one attachment by id. Used after an OS-drop upload to splice
 * the new item into the visible grid without reloading the whole
 * page (which would lose the user's scroll position).
 *
 * @public
 */
export async function fetchMediaItem(
	mediaId: number,
): Promise< MediaListItem > {
	const cfg = getConfig();
	const url = new URL( buildUrl( `wp/v2/media/${ mediaId }` ) );
	url.searchParams.set(
		'_fields',
		'id,title,date,mime_type,source_url,alt_text,caption,description,author,media_details,_embedded',
	);
	url.searchParams.set( '_embed', 'author' );
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
			await readErrorMessage( response, 'Failed to load media item' ),
		);
	}
	return ( await response.json() ) as MediaListItem;
}

/**
 * Permanently delete an attachment. `force=true` because attachments
 * don't go through the trash flow the way posts do — leaving them in
 * a soft-deleted limbo state isn't what users expect from a "Delete"
 * affordance in the media grid.
 *
 * @public
 */
export async function deleteMediaItem( mediaId: number ): Promise< void > {
	const cfg = getConfig();
	const url = new URL( buildUrl( `wp/v2/media/${ mediaId }` ) );
	url.searchParams.set( 'force', 'true' );
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
			await readErrorMessage( response, 'Failed to delete media item' ),
		);
	}
}

/**
 * Patch an attachment.
 *
 * Used by the bulk actions for two of core's own media operations:
 * "Detach" (`post: 0`, the same thing the media list table's Detach
 * row action does) and re-attributing an author.
 *
 * @public
 */
export async function updateMediaItem(
	mediaId: number,
	body: Record< string, unknown >,
): Promise< void > {
	const cfg = getConfig();
	const response = await shellFetch( buildUrl( `wp/v2/media/${ mediaId }` ), {
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
			await readErrorMessage( response, 'Failed to update media item' ),
		);
	}
}

/**
 * Drill-in payload — every public post/page/CPT that references the
 * given attachment.
 *
 * @public
 */
export async function fetchMediaUsage( mediaId: number ): Promise< MediaUsage > {
	const cfg = getConfig();
	const response = await shellFetch(
		buildUrl( `desktop-mode/v1/media-usage/${ mediaId }` ),
		{
			method: 'GET',
			credentials: 'same-origin',
			headers: {
				'X-WP-Nonce': cfg.restNonce,
				Accept: 'application/json',
			},
		},
	);
	if ( ! response.ok ) {
		throw new Error(
			await readErrorMessage( response, 'Failed to load media usage' ),
		);
	}
	return ( await response.json() ) as MediaUsage;
}
