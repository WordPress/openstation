/**
 * OpenStation — "is this URL the shell screen?"
 *
 * The desktop boots from its own admin screen,
 * `admin.php?page=openstation` (`includes/shell-screen.php`). That URL
 * is where a target is opened, never a target: loaded inside a window
 * it would boot a second desktop in an iframe, and fetched ahead of a
 * click it would build one nobody asked for. Every path that turns a
 * URL into a document — the iframe src, a saved session, hover
 * prewarming, the service worker's speculative documents — refuses it
 * through this one predicate, so the answer cannot drift between them.
 *
 * Kept in its own module so the service-worker bundle and the shell can
 * both import it without dragging the other's code along.
 */

/** The `page=` slug of the shell screen. Mirrors `OPENSTATION_SHELL_PAGE_SLUG`. */
export const SHELL_PAGE_SLUG = 'openstation';

/**
 * Whether `url` addresses the shell screen.
 *
 * Matches on the path's last segment and the `page` query arg, so a
 * subdirectory install or a renamed admin folder is handled the same
 * way. A string is resolved against `base` (or the document's own
 * location); an unparseable string is not the shell.
 *
 * @param url  Parsed URL, or a raw one.
 * @param base Base for resolving a relative string.
 */
export function isShellDocumentUrl( url: URL | string, base?: string ): boolean {
	let parsed: URL;
	if ( typeof url === 'string' ) {
		try {
			parsed = new URL(
				url,
				base ??
					( typeof window !== 'undefined'
						? window.location.href
						: undefined ),
			);
		} catch {
			return false;
		}
	} else {
		parsed = url;
	}
	const file = parsed.pathname.slice( parsed.pathname.lastIndexOf( '/' ) + 1 );
	return file === 'admin.php' && parsed.searchParams.get( 'page' ) === SHELL_PAGE_SLUG;
}
