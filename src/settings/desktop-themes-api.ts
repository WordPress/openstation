/**
 * REST client for the desktop-theme library.
 *
 * Lives in the lazy OS Settings panel bundle, not in the always-on
 * `src/desktop-themes/` module: uploading and deleting are admin
 * actions taken inside the Settings panel, and the shell has no
 * reason to carry the code for them.
 *
 * @since 0.9.7
 */

import { trackedFetch } from '../tracked-fetch';
import type { DesktopThemeServerEntry } from '../types';
import type { OsSettingsConfig } from './types';

/**
 * Pull the best available error message out of a failed response.
 *
 * The install pipeline returns specific, actionable `WP_Error`
 * messages ("that archive contains an unsafe file path", "theme.json
 * is not valid JSON", plus `unzip_file`'s verbatim filesystem
 * complaint on FTP-credentialed hosts). Collapsing all of that into
 * "Upload failed" would throw away the only thing that tells a theme
 * author what to fix.
 */
async function errorMessage( response: Response, fallback: string ): Promise< string > {
	try {
		const data = ( await response.json() ) as { message?: unknown };
		if ( data && typeof data.message === 'string' && data.message !== '' ) {
			return data.message;
		}
	} catch {
		/* Not JSON — fall through to the generic message. */
	}
	return `${ fallback } (HTTP ${ response.status }).`;
}

/**
 * Upload a theme ZIP.
 *
 * @since 0.9.7
 *
 * @param config OS Settings config (needs `desktopThemesUrl` + nonce).
 * @param file   The `.zip` the user picked.
 * @return The installed theme's payload entry.
 */
export async function uploadDesktopTheme(
	config: OsSettingsConfig,
	file: File,
): Promise< DesktopThemeServerEntry > {
	const url = config.desktopThemesUrl ?? '';
	if ( url === '' ) {
		throw new Error(
			'[desktop-mode] No desktopThemesUrl in the shell config — the desktop-themes REST route is unavailable.',
		);
	}

	// `FormData`, not a raw body: the route reads `$_FILES['file']`,
	// which PHP only populates for genuine multipart POSTs.
	const form = new FormData();
	form.append( 'file', file, file.name );

	const response = await trackedFetch(
		url,
		{
			method: 'POST',
			credentials: 'same-origin',
			// Content-Type is deliberately NOT set — the browser has
			// to add its own multipart boundary.
			headers: { 'X-WP-Nonce': config.restNonce },
			body: form,
		},
		{ source: 'desktop-mode/desktop-themes/upload' },
	);

	if ( ! response.ok ) {
		throw new Error( await errorMessage( response, 'Theme upload failed' ) );
	}
	return ( await response.json() ) as DesktopThemeServerEntry;
}

/**
 * Delete an installed theme.
 *
 * @since 0.9.7
 *
 * @param config OS Settings config.
 * @param slug   Theme slug.
 */
export async function deleteDesktopTheme(
	config: OsSettingsConfig,
	slug: string,
): Promise< void > {
	const base = config.desktopThemesUrl ?? '';
	if ( base === '' ) {
		throw new Error(
			'[desktop-mode] No desktopThemesUrl in the shell config — the desktop-themes REST route is unavailable.',
		);
	}

	const response = await trackedFetch(
		`${ base }/${ encodeURIComponent( slug ) }`,
		{
			method: 'DELETE',
			credentials: 'same-origin',
			headers: { 'X-WP-Nonce': config.restNonce },
		},
		{ source: 'desktop-mode/desktop-themes/delete' },
	);

	if ( ! response.ok ) {
		throw new Error( await errorMessage( response, 'Theme delete failed' ) );
	}
}
