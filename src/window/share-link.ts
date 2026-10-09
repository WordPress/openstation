/**
 * OpenStation — the address a window's "Copy link" hands out.
 *
 * The link is the page's own wp-admin URL with the shell's flags and
 * the request's nonces removed. No new routing is needed to open it:
 * for someone in OpenStation the plain-admin redirect forwards it into
 * the shell as a window, anyone else gets the classic page, a signed-out
 * visitor goes through `wp-login.php` first, and the page's own
 * capability check refuses anyone without access.
 */
import { isShellDocumentUrl } from '../shell-url';

/** Query args that belong to this session or this request, never to the page. */
const PRIVATE_ARGS = [
	'openstation_chromeless',
	'openstation_solo',
	'desktop_mode_portal',
	'desktop_mode_portal_intent',
	'desktop_mode_classic',
	'_wpnonce',
	'_ajax_nonce',
	'_wp_http_referer',
	'preview_nonce',
];

/**
 * The shareable form of `raw`, or `''` when there is nothing safe to
 * share: another origin, a non-web scheme, embedded credentials, or the
 * shell screen itself.
 */
export function shareableUrl( raw: string, origin: string ): string {
	let url: URL;
	try {
		url = new URL( raw, origin );
	} catch {
		return '';
	}
	if (
		url.origin !== new URL( origin ).origin ||
		! [ 'http:', 'https:' ].includes( url.protocol ) ||
		url.username ||
		url.password ||
		isShellDocumentUrl( url )
	) {
		return '';
	}
	// Re-serialise only a query that carried something to drop, so the
	// page's own spelling of its args survives untouched.
	if ( PRIVATE_ARGS.some( ( key ) => url.searchParams.has( key ) ) ) {
		PRIVATE_ARGS.forEach( ( key ) => url.searchParams.delete( key ) );
	}
	return url.href;
}
