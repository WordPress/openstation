/**
 * REST client for the Media Library picker + uploader.
 *
 * Both functions talk to the `wp/v2/media` endpoint with the shell's
 * REST nonce. `fetchMediaPage` narrows the response with `_fields` to
 * avoid shipping 60kb of Gutenberg-only metadata per page. `uploadImage`
 * posts a raw binary body with `Content-Disposition: attachment` — the
 * simplest shape WordPress accepts.
 */

import { HD_MIN_HEIGHT, HD_MIN_WIDTH, MEDIA_PER_PAGE } from './constants';
import type { MediaItem, OsSettingsConfig } from './types';
import { isUsableImage, sanitizeFilename } from './utils';
import { trackedFetch } from '../tracked-fetch';

export async function fetchMediaPage(
	config: OsSettingsConfig,
	page: number,
	search: string,
	hdOnly: boolean,
): Promise<{ items: MediaItem[]; totalPages: number }> {
	const url = new URL( config.mediaUrl );
	url.searchParams.set( 'media_type', 'image' );
	url.searchParams.set( 'per_page', String( MEDIA_PER_PAGE ) );
	url.searchParams.set( 'page', String( page ) );
	url.searchParams.set( 'orderby', 'date' );
	url.searchParams.set( 'order', 'desc' );
	url.searchParams.set(
		'_fields',
		'id,source_url,alt_text,title,media_details',
	);
	if ( search ) {
		url.searchParams.set( 'search', search );
	}
	if ( hdOnly ) {
		url.searchParams.set( 'openstation_min_width', String( HD_MIN_WIDTH ) );
		url.searchParams.set( 'openstation_min_height', String( HD_MIN_HEIGHT ) );
	}

	const response = await trackedFetch(
		url.toString(),
		{
			credentials: 'same-origin',
			headers: { 'X-WP-Nonce': config.restNonce },
		},
		{ source: 'desktop-mode/settings/media' },
	);

	if ( ! response.ok ) {
		let message = `HTTP ${ response.status }`;
		try {
			const data = ( await response.json() ) as { message?: string };
			if ( data && typeof data.message === 'string' ) {
				message = data.message;
			}
		} catch {
			/* keep status-code fallback */
		}
		throw new Error( message );
	}

	const totalPagesHeader = response.headers.get( 'X-WP-TotalPages' );
	const totalPages = totalPagesHeader ? parseInt( totalPagesHeader, 10 ) : 1;
	const items = ( await response.json() ) as MediaItem[];
	return { items: items.filter( isUsableImage ), totalPages: totalPages || 1 };
}

export async function uploadImage(
	config: OsSettingsConfig,
	file: File,
): Promise<{ id: number; url: string }> {
	const response = await trackedFetch(
		config.mediaUrl,
		{
			method: 'POST',
			credentials: 'same-origin',
			headers: {
				'X-WP-Nonce': config.restNonce,
				'Content-Type': file.type,
				'Content-Disposition': `attachment; filename="${ sanitizeFilename( file.name ) }"`,
			},
			body: file,
		},
		{ source: 'desktop-mode/settings/media-upload' },
	);

	if ( ! response.ok ) {
		let message = `Upload failed (HTTP ${ response.status }).`;
		try {
			const data = ( await response.json() ) as { message?: string };
			if ( data && typeof data.message === 'string' ) {
				message = data.message;
			}
		} catch {
			/* Response wasn't JSON — stick with the HTTP status. */
		}
		throw new Error( message );
	}

	const data = ( await response.json() ) as {
		id: number;
		source_url: string;
	};
	return { id: data.id, url: data.source_url };
}
