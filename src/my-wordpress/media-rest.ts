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
 * @since 0.21.0
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
 * @since 0.21.0
 */
export async function fetchMediaPage(
	entity: MyWordPressEntity,
	params: { page: number; perPage: number },
): Promise< MediaListResult > {
	const cfg = getConfig();
	const url = new URL( buildUrl( entity.restPath ) );
	url.searchParams.set( 'page', String( params.page ) );
	url.searchParams.set( 'per_page', String( params.perPage ) );
	url.searchParams.set(
		'_fields',
		'id,title,date,mime_type,source_url,alt_text,caption,description,author,media_details,_embedded',
	);
	url.searchParams.set( '_embed', 'author' );
	url.searchParams.set( 'orderby', 'date' );
	url.searchParams.set( 'order', 'desc' );
	// Attachments are stored under `status=inherit`; the default
	// `publish` filter on `wp/v2/media` returns an empty list.
	url.searchParams.set( 'status', 'inherit' );

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
 * Drill-in payload — every public post/page/CPT that references the
 * given attachment.
 *
 * @public
 * @since 0.21.0
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
