/**
 * Web-URL helpers shared by bookmark creation and openers.
 *
 * Intake deliberately accepts only one standalone HTTP(S) URL. A bare
 * hostname is convenient enough to normalize to HTTPS, while arbitrary prose
 * containing a URL is left alone so a normal paste never turns into a desktop
 * item by surprise.
 */

import type { DesktopFile } from './file';

const EXPLICIT_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const BARE_WEB_TARGET = /^(?:localhost(?::\d+)?|(?:\[[0-9a-f:]+\]|(?:[^\s/?#]+\.)+[^\s./?#]+)(?::\d+)?)(?:[/?#].*)?$/i;

/** Normalize one user-supplied web URL, or return an empty string. */
export function normalizeWebUrl( input: string ): string {
	const raw = input.trim();
	if ( ! raw || /[\r\n]/.test( raw ) ) {
		return '';
	}

	let candidate = raw;
	if ( BARE_WEB_TARGET.test( candidate ) ) {
		candidate = `https://${ candidate }`;
	} else if ( ! EXPLICIT_SCHEME.test( candidate ) ) {
		return '';
	}

	try {
		const parsed = new URL( candidate );
		if ( parsed.protocol !== 'http:' && parsed.protocol !== 'https:' ) {
			return '';
		}
		if ( parsed.username || parsed.password || ! parsed.hostname ) {
			return '';
		}
		return parsed.toString();
	} catch {
		return '';
	}
}

/**
 * Read the server-sanitized URL serialized for a web file. Never fall back to
 * the raw ref: filters can alter shapes, so every opener re-validates the
 * final wire value immediately before using it.
 */
export function serializedWebUrl( file: DesktopFile ): string {
	const raw = typeof file.shape.url === 'string' ? file.shape.url : '';
	return normalizeWebUrl( raw );
}

/** Parse the first non-comment entry in a standard text/uri-list payload. */
export function urlFromUriList( value: string ): string {
	for ( const line of value.split( /\r?\n/ ) ) {
		const candidate = line.trim();
		if ( ! candidate || candidate.startsWith( '#' ) ) {
			continue;
		}
		return normalizeWebUrl( candidate );
	}
	return '';
}

/** Whether plain text looks intentional enough to treat as URL intake. */
export function looksLikeWebUrl( value: string ): boolean {
	const raw = value.trim();
	return EXPLICIT_SCHEME.test( raw ) || BARE_WEB_TARGET.test( raw );
}
