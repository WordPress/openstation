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

/**
 * The shell screen's one-shot boot args, mirroring
 * `OPENSTATION_SHELL_TARGET_ARG` and `OPENSTATION_SHELL_INTENT_ARG`.
 *
 * `target` names the page the shell opens first and `intent` says the
 * user asked for it by name. PHP reads both once, on the request that
 * carries them, and hands the answer to the shell as `currentPage` /
 * `fromPortalIntent` — nothing on the JS side reads them from the URL.
 */
const SHELL_BOOT_ARGS = [ 'target', 'intent' ] as const;

/**
 * The same shell-screen URL with the consumed boot args removed, or
 * `null` when there is nothing to strip.
 *
 * `target` is an instruction, not an address: "open this page first."
 * Left in the address bar it stops being one-shot — every reload
 * re-reads it and re-opens the page on top of the restored session,
 * which is how a single visit to a page-less `admin.php` could pin an
 * empty window to every refresh for the life of the tab (and past it,
 * through a bookmark or browser session restore). Dropping the args
 * once they have been acted on leaves the canonical screen URL, and a
 * reload of that re-resolves against the live session — which is what
 * `openstation_shell_boot_target()` has always documented it does.
 *
 * Deliberately NOT the `/openstation/` normalisation reverted in
 * `init()`: this stays on the same screen and the same route, so a
 * reload still costs no redirect and the address bar does not flash.
 *
 * @param url  Parsed URL, or a raw one.
 * @param base Base for resolving a relative string.
 */
export function shellUrlWithoutBootArgs(
	url: URL | string,
	base?: string,
): string | null {
	let parsed: URL;
	try {
		parsed = new URL(
			typeof url === 'string' ? url : url.href,
			base ??
				( typeof window !== 'undefined'
					? window.location.href
					: undefined ),
		);
	} catch {
		return null;
	}

	// Only the screen that consumes them. Anywhere else the same arg
	// names could belong to the page itself.
	if ( ! isShellDocumentUrl( parsed ) ) {
		return null;
	}

	if ( ! SHELL_BOOT_ARGS.some( ( arg ) => parsed.searchParams.has( arg ) ) ) {
		return null;
	}
	SHELL_BOOT_ARGS.forEach( ( arg ) => parsed.searchParams.delete( arg ) );

	return parsed.href;
}
